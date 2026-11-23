import { sql } from "@/lib/db";
import { createSession, currentUser, getUserById } from "@/lib/auth";
import { createGuestUser } from "@/lib/guest";
import { ensureInterview } from "@/lib/onboarding";
import { json } from "@/lib/http";

// Starts trying Tarrow without an account: creates a guest, signs this browser in as it, and opens the interview.
export async function POST(req: Request) {
  if (req.headers.get("sec-fetch-site") === "cross-site") return json({ error: "Forbidden" }, 403);
  let b: { agree?: boolean; timezone?: string; embedded?: boolean };
  try {
    b = await req.json();
  } catch {
    return json({ error: "Invalid request" }, 400);
  }
  // App Store 5.1.2(i): nothing goes to AI providers until they explicitly agree.
  if (b.agree !== true) return json({ error: "Agree to how Tarrow uses AI first" }, 400);

  const existing = await currentUser();
  if (existing) {
    if (!existing.ai_consent_at) await sql`update users set ai_consent_at = now() where id = ${existing.id}`;
    return json({ conversationId: existing.onboarded_at ? null : await ensureInterview(existing) });
  }

  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "unknown";
  const recent = await sql`select count(*)::int as n from auth_attempts where key = ${`guest:${ip}`} and created_at > now() - interval '1 hour'`;
  if (Number(recent[0]?.n ?? 0) >= 10) return json({ error: "Too many new sessions from this network. Sign up to keep going.", code: "signup" }, 429);
  await sql`insert into auth_attempts (key) values (${`guest:${ip}`})`;

  const id = await createGuestUser(b.timezone ? String(b.timezone).slice(0, 60) : null);
  // `embedded`: GuestChat is running in an iframe on another site, where only a partitioned cookie survives.
  await createSession(id, { adoptGuest: false, embedded: b.embedded === true });
  const user = await getUserById(id);
  return json({ conversationId: await ensureInterview(user!) });
}
