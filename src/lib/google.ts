import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { sql } from "./db";
import { appUrl } from "./agent/runtime";

export const googleConfigured = () => !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);

export const googleRedirectUri = () => `${appUrl()}/api/auth/google/callback`;

export function googleAuthUrl(state: string) {
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID!,
    redirect_uri: googleRedirectUri(),
    response_type: "code",
    scope: "openid email profile",
    state,
    prompt: "select_account",
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

export async function exchangeCode(code: string): Promise<string> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ code, client_id: process.env.GOOGLE_CLIENT_ID!, client_secret: process.env.GOOGLE_CLIENT_SECRET!, redirect_uri: googleRedirectUri(), grant_type: "authorization_code" }),
    signal: AbortSignal.timeout(10_000),
  });
  const data = (await res.json()) as { id_token?: string; error?: string };
  if (!res.ok || !data.id_token) throw new Error(data.error ?? "Google token exchange failed");
  return data.id_token;
}

export type GoogleProfile = { sub: string; email: string; name: string | null; picture: string | null };

/** Verifies a Google ID token (signature via Google's tokeninfo) and its audience. */
export async function verifyIdToken(idToken: string): Promise<GoogleProfile> {
  const res = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error("Invalid Google token");
  const p = (await res.json()) as { aud?: string; sub?: string; email?: string; email_verified?: string | boolean; name?: string; picture?: string; exp?: string };
  const audiences = [process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_IOS_CLIENT_ID].filter(Boolean);
  if (!p.aud || !audiences.includes(p.aud)) throw new Error("Google token audience mismatch");
  if (!p.sub || !p.email || !(p.email_verified === true || p.email_verified === "true")) throw new Error("Google account email is not verified");
  if (p.exp && Number(p.exp) * 1000 < Date.now()) throw new Error("Google token expired");
  return { sub: p.sub, email: p.email.toLowerCase(), name: p.name ?? null, picture: p.picture ?? null };
}

/**
 * Email signup isn't verified, so someone could register a victim's address with their own password before the
 * victim ever signs in. When a verified Google/Apple identity first claims a password-only account, drop that
 * password and end its sessions so only the identity's owner can get in.
 */
export async function claimUnverifiedAccount(email: string) {
  const rows = await sql`select id from users where email = ${email} and password_hash is not null and google_sub is null and apple_sub is null`;
  if (!rows.length) return;
  await sql`update users set password_hash = null where id = ${rows[0].id}`;
  await sql`delete from sessions where user_id = ${rows[0].id}`;
}

/** Finds the user for a Google account, linking by verified email or creating a new account. */
export async function upsertGoogleUser(profile: GoogleProfile, timezone?: string | null) {
  const bySub = await sql`select id, onboarded_at from users where google_sub = ${profile.sub}`;
  if (bySub.length) return bySub[0] as { id: string; onboarded_at: string | null };
  await claimUnverifiedAccount(profile.email);
  const byEmail = await sql`update users set google_sub = ${profile.sub}, avatar_url = coalesce(avatar_url, ${profile.picture}) where email = ${profile.email} returning id, onboarded_at`;
  if (byEmail.length) return byEmail[0] as { id: string; onboarded_at: string | null };
  let tz = timezone || "America/New_York";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
  } catch {
    tz = "America/New_York";
  }
  const first = profile.name?.split(" ")[0] ?? profile.email.split("@")[0];
  const rows = await sql`insert into users (email, name, timezone, google_sub, avatar_url) values (${profile.email}, ${first.slice(0, 60)}, ${tz}, ${profile.sub}, ${profile.picture}) returning id, onboarded_at`;
  return rows[0] as { id: string; onboarded_at: string | null };
}

const hash = (code: string) => createHash("sha256").update(code).digest("hex");

/** One-time code that hands a login from the system browser back to the native app. */
export async function createLoginCode(userId: string, challenge: string) {
  const code = randomBytes(24).toString("base64url");
  await sql`insert into login_codes (code_hash, user_id, expires_at, challenge) values (${hash(code)}, ${userId}, now() + interval '3 minutes', ${challenge})`;
  await sql`delete from login_codes where expires_at < now()`;
  return code;
}

/** The verifier proves the webview that started sign-in is the one finishing it (a hijacked deep link alone is useless). */
export async function consumeLoginCode(code: string, verifier: string): Promise<string | null> {
  const rows = await sql`delete from login_codes where code_hash = ${hash(code)} and challenge = ${hash(verifier)} and expires_at > now() returning user_id`;
  return (rows[0]?.user_id as string) ?? null;
}
