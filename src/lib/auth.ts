import "server-only";
import { randomBytes, scrypt as scryptCb, timingSafeEqual, createHash } from "node:crypto";
import { promisify } from "node:util";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { sql } from "./db";

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>;
const COOKIE = "tarrow_sid";
/**
 * The session cookie when Tarrow runs inside an iframe on another site (the live demo on keugenelee.com).
 * A Lax cookie is never stored or sent in a cross-site frame, so there the guest was created and then
 * immediately 401'd. This one is SameSite=None but Partitioned (CHIPS): the browser keys it to the top-level
 * site that embeds us, so it only ever exists inside that site's frame and never reaches a top-level visit to
 * Tarrow. The top-level cookie and its Lax CSRF protection are unchanged.
 */
const EMBED_COOKIE = "tarrow_sid_embed";
const SESSION_DAYS = 60;

export type User = {
  id: string;
  email: string;
  name: string | null;
  city: string | null;
  timezone: string;
  agent_style: string;
  life_file: string;
  onboarded_at: string | null;
  ai_consent_at: string | null;
  interview_conversation_id: string | null;
  plan: string;
  coach: string;
  coach_custom: { name: string; description: string } | null;
  resume: string;
  /** Logged-out visitor trying Tarrow without an account (see src/lib/guest.ts). */
  is_guest: boolean;
  created_at: string;
};

export async function hashPassword(password: string) {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, 64);
  return `scrypt$${salt.toString("hex")}$${key.toString("hex")}`;
}

export async function verifyPassword(password: string, stored: string) {
  const [scheme, saltHex, keyHex] = stored.split("$");
  if (scheme !== "scrypt" || !saltHex || !keyHex) return false;
  const key = await scrypt(password, Buffer.from(saltHex, "hex"), 64);
  const expected = Buffer.from(keyHex, "hex");
  return expected.length === key.length && timingSafeEqual(expected, key);
}

const tokenHash = (token: string) => createHash("sha256").update(token).digest("hex");

/** Signs `userId` in. If this browser was a guest until now, the guest's interview, chats and memory move to that account. */
export async function createSession(userId: string, opts: { adoptGuest?: boolean; embedded?: boolean } = {}) {
  if (opts.adoptGuest !== false) {
    const guest = await currentUser();
    if (guest?.is_guest && guest.id !== userId) {
      const { adoptGuest } = await import("./guest");
      await adoptGuest(guest.id, userId).catch((err) => console.warn("guest adopt failed", err));
    }
  }
  const token = randomBytes(32).toString("base64url");
  const expires = new Date(Date.now() + SESSION_DAYS * 864e5);
  await sql`insert into sessions (token_hash, user_id, expires_at) values (${tokenHash(token)}, ${userId}, ${expires.toISOString()})`;
  const jar = await cookies();
  // Already inside an embed (a guest made there, now signing up or logging in there): stay in the embed's cookie.
  const embedded = opts.embedded ?? Boolean(jar.get(EMBED_COOKIE));
  if (embedded) {
    jar.set(EMBED_COOKIE, token, { httpOnly: true, secure: true, sameSite: "none", partitioned: true, path: "/", expires });
  } else {
    jar.set(COOKIE, token, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", expires });
  }
}

export async function destroySession() {
  const jar = await cookies();
  for (const name of [COOKIE, EMBED_COOKIE]) {
    const token = jar.get(name)?.value;
    if (token) await sql`delete from sessions where token_hash = ${tokenHash(token)}`;
  }
  jar.delete(COOKIE);
  if (jar.get(EMBED_COOKIE)) jar.set(EMBED_COOKIE, "", { secure: true, sameSite: "none", partitioned: true, path: "/", maxAge: 0 });
}

export async function currentUser(): Promise<User | null> {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value ?? jar.get(EMBED_COOKIE)?.value;
  if (!token) return null;
  const rows = await sql`
    select u.id, u.email, u.name, u.city, u.timezone, u.agent_style, u.life_file, u.onboarded_at, u.ai_consent_at,
           u.interview_conversation_id, u.plan, u.coach, u.coach_custom, u.resume, u.is_guest, u.created_at
    from sessions s join users u on u.id = s.user_id
    where s.token_hash = ${tokenHash(token)} and s.expires_at > now() limit 1`;
  return (rows[0] as User | undefined) ?? null;
}

/** For pages: signed-in user or redirect to /login. */
export async function requireUser(): Promise<User> {
  const user = await currentUser();
  if (!user) redirect("/");
  return user;
}

/** Signed in and has agreed to AI processing (App Store 5.1.2(i): explicit permission before sharing with third-party AI). */
export async function requireConsentedUser(): Promise<User> {
  const user = await requireUser();
  if (!user.ai_consent_at) redirect("/consent");
  return user;
}

export async function getUserById(id: string): Promise<User | null> {
  const rows = await sql`
    select id, email, name, city, timezone, agent_style, life_file, onboarded_at, ai_consent_at, interview_conversation_id, plan, coach, coach_custom, resume, is_guest, created_at
    from users where id = ${id}`;
  return (rows[0] as User | undefined) ?? null;
}
