import { sql } from "@/lib/db";
import { createSession } from "@/lib/auth";
import { upsertAppleUser, verifyAppleToken } from "@/lib/apple";
import { json } from "@/lib/http";

// Completes native Sign in with Apple: the iOS app posts Apple's identity token from its own webview.
export async function POST(req: Request) {
  // Only the app's same-origin fetch should set a session here (prevents login CSRF).
  if (req.headers.get("sec-fetch-site") === "cross-site") return json({ error: "Forbidden" }, 403);
  let b: { identityToken?: string; nonce?: string; givenName?: string; familyName?: string; timezone?: string };
  try {
    b = await req.json();
  } catch {
    return json({ error: "Invalid request" }, 400);
  }
  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "unknown";
  const recent = await sql`select count(*)::int as n from auth_attempts where key = ${`apple:${ip}`} and created_at > now() - interval '15 minutes'`;
  if (Number(recent[0]?.n ?? 0) >= 20) return json({ error: "Too many attempts. Wait 15 minutes and try again." }, 429);

  const identity = b.identityToken ? await verifyAppleToken(String(b.identityToken).slice(0, 5000), b.nonce ? String(b.nonce) : undefined).catch(() => null) : null;
  if (!identity) {
    await sql`insert into auth_attempts (key) values (${`apple:${ip}`})`;
    return json({ error: "Apple sign-in couldn't be verified. Try again." }, 401);
  }
  const user = await upsertAppleUser(identity, `${b.givenName ?? ""} ${b.familyName ?? ""}`, b.timezone);
  await createSession(user.id);
  return json({ ok: true, onboarded: !!user.onboarded_at });
}
