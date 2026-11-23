import { authed, body, HttpError, json } from "@/lib/http";
import { getEntitlement } from "@/lib/billing";
import { claimAppleTransaction } from "@/lib/billing/apple";

/** The iOS app sends each StoreKit 2 transaction (purchase or restore) for verification. */
export const POST = authed(async (req, user) => {
  if (user.is_guest) return json({ error: "Create an account first, so your plan stays with you.", code: "signup" }, 403);
  const b = await body<{ transactions?: string[] }>(req);
  const list = (b.transactions ?? []).filter((t) => typeof t === "string" && t.length < 20000).slice(0, 20);
  if (!list.length) throw new HttpError(400, "No purchase to verify");
  const errors: string[] = [];
  for (const jws of list) {
    try {
      await claimAppleTransaction(user.id, jws);
    } catch (err) {
      errors.push((err as Error).message);
    }
  }
  const ent = await getEntitlement(user.id);
  if (ent.plan !== "pro" && errors.length) throw new HttpError(400, errors[0]);
  return json(ent);
});
