import "server-only";
import webpush from "web-push";
import { sql } from "./db";
import { sendApns } from "./apns";
import { SUPPORT_EMAIL } from "@/lib/contact";

let configured = false;
function configure() {
  if (configured) return true;
  const pub = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  if (!pub || !priv) return false;
  webpush.setVapidDetails(`mailto:${SUPPORT_EMAIL}`, pub, priv);
  configured = true;
  return true;
}

/** Notifies every browser (web push) and iPhone (APNs) the user registered; prunes dead ones. */
export async function notifyUser(userId: string, payload: { title: string; body: string; url: string }) {
  const [subs, native] = await Promise.all([
    configure() ? sql`select endpoint, p256dh, auth from push_subscriptions where user_id = ${userId}` : Promise.resolve([]),
    sql`select token from native_push_tokens where user_id = ${userId} and platform = 'ios'`,
  ]);
  await Promise.all([
    ...subs.map(async (s) => {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint as string, keys: { p256dh: s.p256dh as string, auth: s.auth as string } }, JSON.stringify(payload), { TTL: 3600 });
      } catch (err) {
        const status = (err as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) await sql`delete from push_subscriptions where endpoint = ${s.endpoint as string}`;
      }
    }),
    (async () => {
      if (!native.length) return;
      const res = await sendApns(native.map((n) => n.token as string), payload).catch((err) => {
        console.warn("[apns] send failed", (err as Error).message);
        return null;
      });
      if (res?.invalid.length) await sql`delete from native_push_tokens where token = any(${res.invalid})`;
    })(),
  ]);
}
