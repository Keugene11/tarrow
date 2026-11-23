import type Stripe from "stripe";
import { json } from "@/lib/http";
import { saveStripeSubscription, stripe } from "@/lib/billing/stripe";

// Stripe webhook: subscription lifecycle for Tarrow Pro (the account also serves other apps; those events are ignored).
export async function POST(req: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  const signature = req.headers.get("stripe-signature");
  if (!secret || !signature) return json({ error: "Not configured" }, 400);
  let event: Stripe.Event;
  try {
    event = stripe().webhooks.constructEvent(await req.text(), signature, secret);
  } catch {
    return json({ error: "Bad signature" }, 400);
  }
  try {
    if (event.type === "checkout.session.completed") {
      const session = event.data.object;
      if (session.metadata?.app === "tarrow" && typeof session.subscription === "string") {
        await saveStripeSubscription(await stripe().subscriptions.retrieve(session.subscription));
      }
    } else if (event.type.startsWith("customer.subscription.")) {
      // Re-fetch so out-of-order deliveries can't roll the status back.
      const sub = event.data.object as Stripe.Subscription;
      await saveStripeSubscription(await stripe().subscriptions.retrieve(sub.id));
    }
    return json({ received: true });
  } catch (err) {
    console.error("stripe webhook failed", event.type, err);
    return json({ error: "Handler failed" }, 500);
  }
}
