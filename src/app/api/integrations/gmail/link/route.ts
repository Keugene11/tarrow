import { authed, HttpError, json } from "@/lib/http";
import { gmailConfigured, mintConnectToken } from "@/lib/gmail";

/** Native app: a one-time URL to open in the system browser, which has no session cookie. */
export const POST = authed(async (req, user) => {
  if (!gmailConfigured()) throw new HttpError(503, "Gmail connection isn't available right now");
  const origin = new URL(req.url).origin;
  return json({ url: `${origin}/api/integrations/gmail?t=${encodeURIComponent(mintConnectToken(user.id))}` });
});
