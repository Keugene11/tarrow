// Creates (or finds) Tarrow Pro in Stripe: product, $20/month + $100/year prices, a Tarrow-only customer
// portal configuration, and optionally the webhook endpoint. Idempotent.
// Usage: STRIPE_SECRET_KEY=sk_... node scripts/billing-stripe.mjs [--webhook https://tarrow.vercel.app] [--out file.json]
// The account is shared with other products, so everything is tagged metadata.app=tarrow.
import Stripe from "stripe";
import { writeFileSync } from "node:fs";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const arg = (name) => {
  const i = process.argv.indexOf(name);
  return i > -1 ? process.argv[i + 1] : null;
};
const SITE = "https://tarrow.vercel.app";

async function findProduct() {
  const found = await stripe.products.search({ query: "metadata['app']:'tarrow' AND active:'true'" });
  if (found.data[0]) return found.data[0];
  return stripe.products.create({
    name: "Tarrow Pro",
    description: "150 tasks a day, Deep and Marathon modes with parallel agents, up to 20 routines.",
    metadata: { app: "tarrow" },
    statement_descriptor: "TARROW PRO",
  });
}

async function price(product, lookup, amount, interval) {
  const existing = await stripe.prices.list({ lookup_keys: [lookup], active: true, limit: 1 });
  if (existing.data[0]) return existing.data[0];
  return stripe.prices.create({
    product: product.id,
    currency: "usd",
    unit_amount: amount,
    recurring: { interval },
    lookup_key: lookup,
    nickname: `Tarrow Pro ${interval}ly`,
    tax_behavior: "inclusive",
    metadata: { app: "tarrow" },
  });
}

async function portal(product, prices) {
  const configs = await stripe.billingPortal.configurations.list({ limit: 100 });
  const mine = configs.data.find((c) => c.metadata?.app === "tarrow" && c.active);
  const params = {
    business_profile: { headline: "Manage your Tarrow Pro subscription", privacy_policy_url: `${SITE}/privacy`, terms_of_service_url: `${SITE}/terms` },
    features: {
      customer_update: { enabled: true, allowed_updates: ["email", "address"] },
      invoice_history: { enabled: true },
      payment_method_update: { enabled: true },
      subscription_cancel: { enabled: true, mode: "at_period_end", cancellation_reason: { enabled: true, options: ["too_expensive", "missing_features", "switched_service", "unused", "other"] } },
      subscription_update: { enabled: true, default_allowed_updates: ["price"], proration_behavior: "create_prorations", products: [{ product: product.id, prices: prices.map((p) => p.id) }] },
    },
    default_return_url: `${SITE}/settings`,
    metadata: { app: "tarrow" },
  };
  return mine ? stripe.billingPortal.configurations.update(mine.id, params) : stripe.billingPortal.configurations.create(params);
}

async function webhook(base) {
  const url = `${base.replace(/\/$/, "")}/api/billing/stripe`;
  const events = ["checkout.session.completed", "customer.subscription.created", "customer.subscription.updated", "customer.subscription.deleted"];
  const all = await stripe.webhookEndpoints.list({ limit: 100 });
  const existing = all.data.find((w) => w.url === url);
  if (existing) {
    await stripe.webhookEndpoints.update(existing.id, { enabled_events: events, metadata: { app: "tarrow" } });
    return { id: existing.id, secret: null };
  }
  const created = await stripe.webhookEndpoints.create({ url, enabled_events: events, description: "Tarrow Pro subscriptions", metadata: { app: "tarrow" } });
  return { id: created.id, secret: created.secret };
}

const product = await findProduct();
const monthly = await price(product, "tarrow_pro_monthly", 2000, "month");
const yearly = await price(product, "tarrow_pro_yearly", 10000, "year");
const config = await portal(product, [monthly, yearly]);
const hook = arg("--webhook") ? await webhook(arg("--webhook")) : null;

const result = { livemode: monthly.livemode, product: product.id, monthly: monthly.id, yearly: yearly.id, portalConfig: config.id, webhook: hook?.id ?? null, webhookSecret: hook?.secret ?? null };
if (arg("--out")) writeFileSync(arg("--out"), JSON.stringify(result, null, 2));
console.log({ ...result, webhookSecret: result.webhookSecret ? "(written to --out)" : null });
