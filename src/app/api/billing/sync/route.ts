import { authed, json } from "@/lib/http";
import { getEntitlement } from "@/lib/billing";
import { syncStripeCustomer } from "@/lib/billing/stripe";

/** Called when returning from Stripe Checkout so Pro shows up without waiting for the webhook. */
export const POST = authed(async (_req, user) => {
  await syncStripeCustomer(user.id).catch((err) => console.warn("stripe sync failed", err));
  return json(await getEntitlement(user.id));
});
