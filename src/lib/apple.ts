import "server-only";
import { createHash, createPublicKey, verify as verifyRsa } from "node:crypto";
import { sql } from "./db";
import { claimUnverifiedAccount } from "./google";

// Verifies identity tokens from native Sign in with Apple (audience = the iOS bundle id).
const JWKS_URL = "https://appleid.apple.com/auth/keys";
const AUDIENCES = [process.env.APPLE_BUNDLE_ID || "com.tarrow.app"];

type Jwk = { kty: string; kid: string; alg: string; use: string; n: string; e: string };
let jwks: { keys: Jwk[]; at: number } | null = null;

async function appleKeys(forceRefresh = false): Promise<Jwk[]> {
  if (!forceRefresh && jwks && Date.now() - jwks.at < 6 * 60 * 60 * 1000) return jwks.keys;
  const res = await fetch(JWKS_URL, { cache: "no-store", signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`Apple JWKS ${res.status}`);
  jwks = { keys: ((await res.json()) as { keys: Jwk[] }).keys, at: Date.now() };
  return jwks.keys;
}

export type AppleIdentity = { sub: string; email: string | null; emailVerified: boolean };

/** Checks signature (Apple JWKS), issuer, audience, expiry and, if given, the nonce (Apple embeds its SHA-256). */
export async function verifyAppleToken(idToken: string, rawNonce?: string): Promise<AppleIdentity | null> {
  const parts = idToken.split(".");
  if (parts.length !== 3) return null;
  let header: { kid?: string; alg?: string };
  let payload: { iss?: string; aud?: string | string[]; exp?: number; sub?: string; email?: string; email_verified?: boolean | string; nonce?: string };
  try {
    header = JSON.parse(Buffer.from(parts[0], "base64url").toString());
    payload = JSON.parse(Buffer.from(parts[1], "base64url").toString());
  } catch {
    return null;
  }
  if (payload.iss !== "https://appleid.apple.com" || !payload.sub) return null;
  if (!payload.exp || payload.exp * 1000 <= Date.now()) return null;
  const auds = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!auds.some((a) => a && AUDIENCES.includes(a))) return null;
  if (rawNonce && payload.nonce !== createHash("sha256").update(rawNonce).digest("hex")) return null;
  if (header.alg !== "RS256" || !header.kid) return null;

  let jwk = (await appleKeys()).find((k) => k.kid === header.kid);
  if (!jwk) jwk = (await appleKeys(true)).find((k) => k.kid === header.kid);
  if (!jwk) return null;
  const ok = verifyRsa("RSA-SHA256", Buffer.from(`${parts[0]}.${parts[1]}`), createPublicKey({ key: jwk as unknown as import("node:crypto").JsonWebKey, format: "jwk" }), Buffer.from(parts[2], "base64url"));
  if (!ok) return null;
  return { sub: payload.sub, email: payload.email?.toLowerCase() ?? null, emailVerified: payload.email_verified === true || payload.email_verified === "true" };
}

/** Finds the user by Apple id, links a verified email to an existing account, or creates one. */
export async function upsertAppleUser(identity: AppleIdentity, name: string, timezone?: string | null) {
  const bySub = await sql`select id, onboarded_at from users where apple_sub = ${identity.sub}`;
  if (bySub.length) return bySub[0] as { id: string; onboarded_at: string | null };
  if (identity.email && identity.emailVerified) {
    await claimUnverifiedAccount(identity.email);
    const byEmail = await sql`update users set apple_sub = ${identity.sub} where email = ${identity.email} and apple_sub is null returning id, onboarded_at`;
    if (byEmail.length) return byEmail[0] as { id: string; onboarded_at: string | null };
  }
  let tz = timezone || "America/New_York";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
  } catch {
    tz = "America/New_York";
  }
  // Apple can withhold the email entirely after the first sign-in; keep the unique email column filled.
  const email = identity.email ?? `apple-${identity.sub.replace(/[^a-zA-Z0-9]/g, "").slice(0, 40)}@privaterelay.appleid.com`;
  const first = (name.trim().split(/\s+/)[0] || (identity.email ? identity.email.split("@")[0] : "") || "there").slice(0, 60);
  const rows = await sql`insert into users (email, name, timezone, apple_sub) values (${email}, ${first}, ${tz}, ${identity.sub}) returning id, onboarded_at`;
  return rows[0] as { id: string; onboarded_at: string | null };
}
