import { authed, body, HttpError, json } from "@/lib/http";
import { getEntitlement } from "@/lib/billing";
import { claimGooglePurchase } from "@/lib/billing/google";

/** The Android app sends Play Billing purchase tokens (purchase or restore) for verification. */
export const POST = authed(async (req, user) => {
  if (user.is_guest) return json({ error: "Create an account first, so your plan stays with you.", code: "signup" }, 403);
  const b = await body<{ purchaseTokens?: string[] }>(req);
  const list = (b.purchaseTokens ?? []).filter((t) => typeof t === "string" && t.length < 4000).slice(0, 10);
  if (!list.length) throw new HttpError(400, "No purchase to verify");
  const errors: string[] = [];
  for (const token of list) {
    try {
      await claimGooglePurchase(user.id, token);
    } catch (err) {
      errors.push((err as Error).message);
    }
  }
  const ent = await getEntitlement(user.id);
  if (ent.plan !== "pro" && errors.length) throw new HttpError(400, errors[0]);
  return json(ent);
});
