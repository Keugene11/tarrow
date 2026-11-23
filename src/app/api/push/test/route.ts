import { sql } from "@/lib/db";
import { apnsConfigured, sendApns } from "@/lib/apns";
import { authed, json } from "@/lib/http";

// Sends a test notification to the signed-in user's iPhones and reports Apple's verdict per reason.
// With a fake token, "BadDeviceToken" proves the key, team, topic and HTTP/2 transport all work.
export const POST = authed(async (_req, user) => {
  if (!apnsConfigured()) return json({ configured: false });
  const rows = await sql`select token from native_push_tokens where user_id = ${user.id} and platform = 'ios'`;
  const result = await sendApns(rows.map((r) => r.token as string), { title: "Tarrow", body: "Notifications are working.", url: "/c/new" });
  return json({ configured: true, devices: rows.length, ...result });
});
