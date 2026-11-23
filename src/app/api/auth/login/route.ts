import { sql } from "@/lib/db";
import { createSession, verifyPassword } from "@/lib/auth";
import { json } from "@/lib/http";

const WINDOW = "15 minutes";
const MAX_FAILURES = 8;

export async function POST(req: Request) {
  let b: { email?: string; password?: string };
  try {
    b = await req.json();
  } catch {
    return json({ error: "Invalid request" }, 400);
  }
  const email = String(b.email ?? "").trim().toLowerCase().slice(0, 200);
  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "unknown";
  const failures = await sql`
    select count(*)::int as n from auth_attempts
    where (key = ${`email:${email}`} or key = ${`ip:${ip}`}) and created_at > now() - ${WINDOW}::interval`;
  if (Number(failures[0]?.n ?? 0) >= MAX_FAILURES * 2) return json({ error: "Too many attempts. Wait 15 minutes and try again." }, 429);

  const rows = await sql`select id, password_hash, onboarded_at from users where email = ${email}`;
  const user = rows[0];
  if (user && !user.password_hash) return json({ error: "This account uses Google or Apple sign-in. Use that button to continue." }, 400);
  if (!user || !(await verifyPassword(String(b.password ?? "").slice(0, 200), user.password_hash as string))) {
    await sql`insert into auth_attempts (key) values (${`email:${email}`}), (${`ip:${ip}`})`;
    await sql`delete from auth_attempts where created_at < now() - interval '1 day'`;
    return json({ error: "Wrong email or password" }, 401);
  }
  await createSession(user.id as string);
  return json({ ok: true, onboarded: !!user.onboarded_at });
}
