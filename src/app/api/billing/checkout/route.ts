import { authed, body, HttpError, json } from "@/lib/http";
import { getEntitlement } from "@/lib/billing";
import { createCheckout } from "@/lib/billing/stripe";

export const POST = authed(async (req, user) => {
  if (user.is_guest) return json({ error: "Create an account first, so your plan stays with you.", code: "signup" }, 403);
  const b = await body<{ interval?: string }>(req);
  const interval = b.interval === "yearly" ? "yearly" : "monthly";
  const ent = await getEntitlement(user.id);
  if (ent.plan === "pro" && ent.subscription) throw new HttpError(409, "You already have Pro");
  return json({ url: await createCheckout(user, interval, new URL(req.url).origin) });
});
