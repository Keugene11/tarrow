import { sql } from "@/lib/db";
import { createSession, hashPassword } from "@/lib/auth";
import { json } from "@/lib/http";

export async function POST(req: Request) {
  let b: { email?: string; password?: string; name?: string; city?: string; timezone?: string };
  try {
    b = await req.json();
  } catch {
    return json({ error: "Invalid request" }, 400);
  }
  const email = String(b.email ?? "").trim().toLowerCase();
  const password = String(b.password ?? "");
  const name = String(b.name ?? "").trim().slice(0, 60);
  const city = String(b.city ?? "").trim().slice(0, 80) || null;
  let timezone = String(b.timezone ?? "America/New_York").slice(0, 60);
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone });
  } catch {
    timezone = "America/New_York";
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 200) return json({ error: "Enter a valid email" }, 400);
  if (password.length < 8) return json({ error: "Password must be at least 8 characters" }, 400);
  if (password.length > 200) return json({ error: "Password is too long" }, 400);
  if (!name) return json({ error: "What should Tarrow call you?" }, 400);
  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "unknown";
  const recent = await sql`select count(*)::int as n from auth_attempts where key = ${`signup:${ip}`} and created_at > now() - interval '1 hour'`;
  if (Number(recent[0]?.n ?? 0) >= 20) return json({ error: "Too many signups from this network. Try again later." }, 429);
  const existing = await sql`select 1 from users where email = ${email}`;
  if (existing.length) return json({ error: "An account with that email already exists — log in instead" }, 409);
  const rows = await sql`insert into users (email, password_hash, name, city, timezone) values (${email}, ${await hashPassword(password)}, ${name}, ${city}, ${timezone}) returning id`;
  await sql`insert into auth_attempts (key) values (${`signup:${ip}`})`;
  await createSession(rows[0].id as string);
  return json({ ok: true });
}
