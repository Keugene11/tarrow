import "server-only";
import Stripe from "stripe";
import { sql } from "../db";
import type { User } from "../auth";
import { intervalForProduct, STRIPE_LOOKUP, type Interval } from "../plans";
import { upsertSubscription, type SubStatus } from "./index";

let client: Stripe | null = null;
export function stripe() {
  if (!process.env.STRIPE_SECRET_KEY) throw new Error("Payments aren't configured");
  client ??= new Stripe(process.env.STRIPE_SECRET_KEY);
  return client;
}

/** The Stripe account is shared with other products, so Tarrow objects are tagged. */
const APP_TAG = { app: "tarrow" };

const prices = new Map<Interval, string>();
async function priceId(interval: Interval) {
  const hit = prices.get(interval);
  if (hit) return hit;
  const list = await stripe().prices.list({ lookup_keys: [STRIPE_LOOKUP[interval]], active: true, limit: 1 });
  if (!list.data[0]) throw new Error("Pricing isn't set up yet");
  prices.set(interval, list.data[0].id);
  return list.data[0].id;
}

async function customerFor(user: User & { stripe_customer_id?: string | null }) {
  const rows = await sql`select stripe_customer_id from users where id = ${user.id}`;
  const existing = rows[0]?.stripe_customer_id as string | null;
  if (existing) return existing;
  const customer = await stripe().customers.create({ email: user.email, name: user.name ?? undefined, metadata: { ...APP_TAG, user_id: user.id } });
  await sql`update users set stripe_customer_id = ${customer.id} where id = ${user.id} and stripe_customer_id is null`;
  const again = await sql`select stripe_customer_id from users where id = ${user.id}`;
  return String(again[0].stripe_customer_id);
}

export async function createCheckout(user: User, interval: Interval, origin: string) {
  const session = await stripe().checkout.sessions.create({
    mode: "subscription",
    customer: await customerFor(user),
    client_reference_id: user.id,
    line_items: [{ price: await priceId(interval), quantity: 1 }],
    allow_promotion_codes: true,
    subscription_data: { metadata: { ...APP_TAG, user_id: user.id } },
    metadata: { ...APP_TAG, user_id: user.id },
    success_url: `${origin}/upgrade?checkout=success`,
    cancel_url: `${origin}/upgrade`,
  });
  return session.url!;
}

export async function createPortal(user: User, origin: string) {
  const session = await stripe().billingPortal.sessions.create({
    customer: await customerFor(user),
    return_url: `${origin}/settings`,
    ...(process.env.STRIPE_PORTAL_CONFIG ? { configuration: process.env.STRIPE_PORTAL_CONFIG } : {}),
  });
  return session.url;
}

const STATUS: Record<string, SubStatus> = {
  active: "active",
  trialing: "trialing",
  past_due: "past_due",
  unpaid: "expired",
  canceled: "expired",
  incomplete: "incomplete",
  incomplete_expired: "expired",
  paused: "expired",
};

export async function saveStripeSubscription(sub: Stripe.Subscription) {
  const item = sub.items.data[0];
  const interval = intervalForProduct(item?.price.lookup_key ?? "");
  if (sub.metadata?.app !== "tarrow" || !interval) return false;
  let userId = sub.metadata.user_id;
  if (!userId) {
    const rows = await sql`select id from users where stripe_customer_id = ${typeof sub.customer === "string" ? sub.customer : sub.customer.id}`;
    userId = rows[0]?.id as string;
  }
  if (!userId) return false;
  const known = await sql`select 1 from users where id = ${userId}`;
  if (!known.length) return false;
  const end = item.current_period_end;
  await upsertSubscription({
    userId,
    provider: "stripe",
    externalId: sub.id,
    product: interval,
    status: STATUS[sub.status] ?? "expired",
    periodEnd: end ? new Date(end * 1000) : null,
    willRenew: !sub.cancel_at_period_end && !sub.cancel_at && sub.status !== "canceled",
    environment: sub.livemode ? "production" : "sandbox",
    raw: { status: sub.status, price: item.price.id },
  });
  return true;
}

/** After returning from Checkout, don't wait on the webhook. */
export async function syncStripeCustomer(userId: string) {
  const rows = await sql`select stripe_customer_id from users where id = ${userId}`;
  const customer = rows[0]?.stripe_customer_id as string | null;
  if (!customer) return;
  const subs = await stripe().subscriptions.list({ customer, status: "all", limit: 10 });
  for (const sub of subs.data) await saveStripeSubscription(sub);
}
