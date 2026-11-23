import { sql } from "@/lib/db";
import { authed, body, json } from "@/lib/http";

// Records (or withdraws) the user's permission to send their data to third-party AI providers.
export const POST = authed(async (req, user) => {
  const b = await body<{ agree?: boolean }>(req);
  if (b.agree === true) await sql`update users set ai_consent_at = coalesce(ai_consent_at, now()) where id = ${user.id}`;
  else await sql`update users set ai_consent_at = null where id = ${user.id}`;
  return json({ ok: true, consented: b.agree === true });
});
