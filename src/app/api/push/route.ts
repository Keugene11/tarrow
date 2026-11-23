import { sql } from "@/lib/db";
import { authed, body, HttpError, json } from "@/lib/http";

type Sub = { endpoint?: string; keys?: { p256dh?: string; auth?: string } };

export const POST = authed(async (req, user) => {
  const b = await body<{ subscription?: Sub }>(req);
  const s = b.subscription;
  if (!s?.endpoint || !/^https:\/\//.test(s.endpoint) || !s.keys?.p256dh || !s.keys?.auth) throw new HttpError(400, "Bad subscription");
  await sql`
    insert into push_subscriptions (endpoint, user_id, p256dh, auth) values (${s.endpoint.slice(0, 1000)}, ${user.id}, ${s.keys.p256dh.slice(0, 200)}, ${s.keys.auth.slice(0, 200)})
    on conflict (endpoint) do update set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth`;
  return json({ ok: true });
});

export const DELETE = authed(async (req, user) => {
  const b = await body<{ endpoint?: string }>(req);
  if (b.endpoint) await sql`delete from push_subscriptions where endpoint = ${b.endpoint} and user_id = ${user.id}`;
  return json({ ok: true });
});
