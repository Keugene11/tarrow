import { sql } from "@/lib/db";
import { authed, body, HttpError, json } from "@/lib/http";

// Registers the signed-in user's native device token (iOS APNs hex token).
export const POST = authed(async (req, user) => {
  const b = await body<{ token?: string; platform?: string }>(req);
  const token = String(b.token ?? "");
  if (b.platform !== "ios" || !/^[0-9a-fA-F]{64,200}$/.test(token)) throw new HttpError(400, "Bad token");
  await sql`
    insert into native_push_tokens (token, user_id, platform) values (${token}, ${user.id}, 'ios')
    on conflict (token) do update set user_id = excluded.user_id, updated_at = now()`;
  return json({ ok: true });
});

export const DELETE = authed(async (req, user) => {
  const b = await body<{ token?: string }>(req);
  if (b.token) await sql`delete from native_push_tokens where token = ${String(b.token)} and user_id = ${user.id}`;
  return json({ ok: true });
});
