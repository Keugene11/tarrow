import "server-only";
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { sql } from "./db";
import { googleConfigured, verifyIdToken } from "./google";
import { addressOf, buildMime, header, messageText, replySubject, stripQuoted, type GmailMessage } from "./gmail-mime";

// Gmail connector: the user links their Gmail in Settings; the agent can then search and read mail and create
// drafts they send with one tap. Tarrow itself never sends. Tokens live in gmail_connections, encrypted at rest.

export const GMAIL_SCOPES = ["https://www.googleapis.com/auth/gmail.readonly", "https://www.googleapis.com/auth/gmail.compose"];

export const gmailConfigured = () => googleConfigured() && !!process.env.GMAIL_TOKEN_KEY;

// Same rule as appUrl() in agent/runtime.ts; duplicated so tools → gmail doesn't import the runtime back.
const appUrl = () => (process.env.APP_URL ? process.env.APP_URL.replace(/\/$/, "") : process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : `http://localhost:${process.env.PORT || 3000}`);
export const gmailRedirectUri = () => `${appUrl()}/api/integrations/gmail/callback`;

export class GmailError extends Error {
  constructor(public code: "not_connected" | "revoked" | "not_found" | "denied" | "api", message: string) {
    super(message);
  }
}

// ---------- token encryption (AES-256-GCM, key derived from GMAIL_TOKEN_KEY) ----------

function key() {
  const k = process.env.GMAIL_TOKEN_KEY;
  if (!k) throw new Error("GMAIL_TOKEN_KEY is not set");
  return createHash("sha256").update(k).digest();
}

export function encrypt(text: string) {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([c.update(text, "utf8"), c.final()]);
  return `v1.${iv.toString("base64url")}.${enc.toString("base64url")}.${c.getAuthTag().toString("base64url")}`;
}

export function decrypt(blob: string) {
  const [v, iv, enc, tag] = blob.split(".");
  if (v !== "v1" || !iv || !enc || !tag) throw new Error("Unreadable token");
  const d = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64url"));
  d.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([d.update(Buffer.from(enc, "base64url")), d.final()]).toString("utf8");
}

// ---------- connect token: lets the native app start OAuth in the system browser, which has no session cookie ----------

const sign = (s: string) => createHmac("sha256", key()).update(s).digest("base64url");

export function mintConnectToken(userId: string) {
  const payload = `${userId}.${Date.now() + 10 * 60_000}`;
  return `${payload}.${sign(payload)}`;
}

export function verifyConnectToken(token: string): string | null {
  const [userId, exp, sig] = token.split(".");
  if (!userId || !exp || !sig) return null;
  const expected = sign(`${userId}.${exp}`);
  if (expected.length !== sig.length || !timingSafeEqual(Buffer.from(expected), Buffer.from(sig))) return null;
  if (Number(exp) < Date.now()) return null;
  return userId;
}

// ---------- OAuth ----------

export function gmailAuthUrl(state: string, loginHint?: string) {
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID!,
    redirect_uri: gmailRedirectUri(),
    response_type: "code",
    scope: ["openid", "email", ...GMAIL_SCOPES].join(" "),
    state,
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
  });
  if (loginHint) params.set("login_hint", loginHint);
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

type TokenRes = { access_token?: string; refresh_token?: string; expires_in?: number; id_token?: string; scope?: string; error?: string; error_description?: string };

async function tokenRequest(body: Record<string, string>): Promise<TokenRes> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: process.env.GOOGLE_CLIENT_ID!, client_secret: process.env.GOOGLE_CLIENT_SECRET!, ...body }),
    signal: AbortSignal.timeout(10_000),
  });
  return (await res.json().catch(() => ({}))) as TokenRes;
}

/** Finishes the OAuth dance and stores the connection. Throws "scopes" if they unticked a Gmail permission. */
export async function connectGmail(userId: string, code: string): Promise<{ email: string }> {
  const t = await tokenRequest({ code, redirect_uri: gmailRedirectUri(), grant_type: "authorization_code" });
  if (!t.access_token || !t.id_token) throw new Error(t.error_description ?? t.error ?? "Google token exchange failed");
  const granted = (t.scope ?? "").split(" ");
  if (GMAIL_SCOPES.some((s) => !granted.includes(s))) throw new Error("scopes");
  if (!t.refresh_token) throw new Error("Google did not return a refresh token");
  const profile = await verifyIdToken(t.id_token);
  const expires = new Date(Date.now() + (t.expires_in ?? 3600) * 1000).toISOString();
  await sql`insert into gmail_connections (user_id, email, refresh_token, access_token, expires_at, scopes)
    values (${userId}, ${profile.email}, ${encrypt(t.refresh_token)}, ${encrypt(t.access_token)}, ${expires}, ${granted.join(" ")})
    on conflict (user_id) do update set email = excluded.email, refresh_token = excluded.refresh_token, access_token = excluded.access_token,
      expires_at = excluded.expires_at, scopes = excluded.scopes, updated_at = now()`;
  return { email: profile.email };
}

export type GmailConnection = { email: string; created_at: string };

export async function getGmailConnection(userId: string): Promise<GmailConnection | null> {
  if (!gmailConfigured()) return null;
  const rows = await sql`select email, created_at from gmail_connections where user_id = ${userId}`;
  return (rows[0] as GmailConnection | undefined) ?? null;
}

export async function disconnectGmail(userId: string) {
  const rows = await sql`delete from gmail_connections where user_id = ${userId} returning refresh_token`;
  const blob = rows[0]?.refresh_token as string | undefined;
  if (!blob) return;
  try {
    await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(decrypt(blob))}`, { method: "POST", signal: AbortSignal.timeout(8_000) });
  } catch {}
}

async function accessToken(userId: string, force = false): Promise<{ token: string; email: string }> {
  const rows = await sql`select email, refresh_token, access_token, expires_at from gmail_connections where user_id = ${userId}`;
  const row = rows[0] as { email: string; refresh_token: string; access_token: string | null; expires_at: string | null } | undefined;
  if (!row) throw new GmailError("not_connected", "Gmail isn't connected. They can connect it in Settings → Connected accounts.");
  if (!force && row.access_token && row.expires_at && new Date(row.expires_at).getTime() - Date.now() > 60_000) return { token: decrypt(row.access_token), email: row.email };
  const t = await tokenRequest({ refresh_token: decrypt(row.refresh_token), grant_type: "refresh_token" });
  if (!t.access_token) {
    if (t.error === "invalid_grant") {
      await sql`delete from gmail_connections where user_id = ${userId}`;
      throw new GmailError("revoked", "Gmail access was revoked. They need to reconnect it in Settings.");
    }
    throw new GmailError("api", t.error_description ?? t.error ?? "Could not refresh Gmail access");
  }
  const expires = new Date(Date.now() + (t.expires_in ?? 3600) * 1000).toISOString();
  await sql`update gmail_connections set access_token = ${encrypt(t.access_token)}, expires_at = ${expires}, updated_at = now() where user_id = ${userId}`;
  return { token: t.access_token, email: row.email };
}

// ---------- Gmail API ----------

async function gapi<T>(userId: string, path: string, init: RequestInit = {}, retry = true): Promise<T> {
  const { token } = await accessToken(userId);
  const res = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, ...(init.body ? { "Content-Type": "application/json" } : {}), ...(init.headers ?? {}) },
    signal: AbortSignal.timeout(20_000),
  });
  if (res.status === 401 && retry) {
    await accessToken(userId, true);
    return gapi<T>(userId, path, init, false);
  }
  if (res.status === 204) return undefined as T;
  const data = (await res.json().catch(() => ({}))) as { error?: { message?: string } } & T;
  if (!res.ok) {
    const msg = data.error?.message ?? `Gmail API error ${res.status}`;
    throw new GmailError(res.status === 404 ? "not_found" : res.status === 403 ? "denied" : "api", msg);
  }
  return data as T;
}

export type MailSummary = { id: string; threadId: string; from: string; to: string; subject: string; date: string; snippet: string; unread: boolean };

const META = "format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Subject&metadataHeaders=Date&metadataHeaders=Message-ID&metadataHeaders=References";

const summarize = (m: GmailMessage): MailSummary => ({
  id: m.id,
  threadId: m.threadId,
  from: header(m, "From"),
  to: header(m, "To"),
  subject: header(m, "Subject") || "(no subject)",
  date: m.internalDate ? new Date(Number(m.internalDate)).toISOString() : header(m, "Date"),
  snippet: (m.snippet ?? "").trim(),
  unread: !!m.labelIds?.includes("UNREAD"),
});

/** Gmail search (same syntax as the search box), newest first. */
export async function searchMail(userId: string, query: string, max = 10): Promise<MailSummary[]> {
  const list = await gapi<{ messages?: { id: string; threadId: string }[] }>(userId, `messages?${new URLSearchParams({ q: query, maxResults: String(Math.max(1, Math.min(25, max))) })}`);
  const ids = list.messages ?? [];
  const msgs = await Promise.all(ids.map((m) => gapi<GmailMessage>(userId, `messages/${m.id}?${META}`)));
  return msgs.map(summarize);
}

export type ThreadMessage = MailSummary & { text: string; attachments: string[]; messageIdHeader: string; references: string };

/** Every message in a thread, with quoted replies stripped. Accepts a thread id or a message id. */
export async function readThread(userId: string, id: string): Promise<{ id: string; subject: string; messages: ThreadMessage[] }> {
  let thread: { id: string; messages?: GmailMessage[] };
  try {
    thread = await gapi(userId, `threads/${encodeURIComponent(id)}?format=full`);
  } catch (err) {
    if (!(err instanceof GmailError && err.code === "not_found")) throw err;
    const m = await gapi<GmailMessage>(userId, `messages/${encodeURIComponent(id)}?format=minimal`);
    thread = await gapi(userId, `threads/${m.threadId}?format=full`);
  }
  const messages = (thread.messages ?? []).map((m) => {
    const { text, attachments } = messageText(m);
    return { ...summarize(m), text: stripQuoted(text), attachments, messageIdHeader: header(m, "Message-ID"), references: header(m, "References") };
  });
  return { id: thread.id, subject: messages[0]?.subject ?? "(no subject)", messages };
}

export type DraftInput = { to: string; cc?: string; subject: string; body: string; replyTo?: string };
export type DraftInfo = { draftId: string; from: string; to: string; cc?: string; subject: string; body: string; threadId?: string };

/** Creates a Gmail draft. With replyTo (a message id) it threads as a reply to that message's sender. */
export async function createDraft(userId: string, input: DraftInput): Promise<DraftInfo> {
  const { email } = await accessToken(userId);
  let { to, subject } = input;
  let threadId: string | undefined;
  let inReplyTo: string | undefined;
  let references: string | undefined;
  if (input.replyTo) {
    const orig = await gapi<GmailMessage>(userId, `messages/${encodeURIComponent(input.replyTo)}?${META}&metadataHeaders=Reply-To`);
    threadId = orig.threadId;
    inReplyTo = header(orig, "Message-ID") || undefined;
    references = [header(orig, "References"), inReplyTo].filter(Boolean).join(" ") || undefined;
    const sender = header(orig, "Reply-To") || header(orig, "From");
    // Replying to your own sent mail goes back to its recipients.
    if (!to) to = addressOf(sender).toLowerCase() === email.toLowerCase() ? header(orig, "To") : sender;
    if (!subject) subject = replySubject(header(orig, "Subject"));
  }
  if (!to) throw new GmailError("api", "A recipient is required");
  const raw = buildMime({ from: email, to, cc: input.cc, subject, body: input.body, inReplyTo, references });
  const d = await gapi<{ id: string; message: { id: string; threadId: string } }>(userId, "drafts", { method: "POST", body: JSON.stringify({ message: { raw, threadId } }) });
  return { draftId: d.id, from: email, to, cc: input.cc, subject, body: input.body, threadId: d.message?.threadId ?? threadId };
}

/** Sends a draft the user reviewed. Edits made on the card are written to the draft first (reply headers kept). */
export async function sendDraft(userId: string, draftId: string, edits?: { to?: string; subject?: string; body?: string }): Promise<{ messageId: string; threadId: string }> {
  if (edits && (edits.to != null || edits.subject != null || edits.body != null)) {
    const { email } = await accessToken(userId);
    const d = await gapi<{ id: string; message: GmailMessage }>(userId, `drafts/${encodeURIComponent(draftId)}?format=full`);
    const m = d.message;
    const { text } = messageText(m);
    const raw = buildMime({
      from: email,
      to: edits.to ?? header(m, "To"),
      cc: header(m, "Cc") || undefined,
      subject: edits.subject ?? header(m, "Subject"),
      body: edits.body ?? text,
      inReplyTo: header(m, "In-Reply-To") || undefined,
      references: header(m, "References") || undefined,
    });
    await gapi(userId, `drafts/${encodeURIComponent(draftId)}`, { method: "PUT", body: JSON.stringify({ message: { raw, threadId: m.threadId } }) });
  }
  const sent = await gapi<{ id: string; threadId: string }>(userId, "drafts/send", { method: "POST", body: JSON.stringify({ id: draftId }) });
  return { messageId: sent.id, threadId: sent.threadId };
}

export async function deleteDraft(userId: string, draftId: string) {
  await gapi(userId, `drafts/${encodeURIComponent(draftId)}`, { method: "DELETE" });
}
