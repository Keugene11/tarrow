import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { authed, json } from "@/lib/http";
import { disconnectGmail, getGmailConnection, gmailAuthUrl, gmailConfigured, verifyConnectToken } from "@/lib/gmail";
import { sql } from "@/lib/db";

// Starts the Gmail connect flow. Web: the signed-in session starts it. Native: the app opens this in the system
// browser (no session cookie there) with a short-lived `t` token from POST /api/integrations/gmail/link.
export async function GET(req: Request) {
  const url = new URL(req.url);
  if (!gmailConfigured()) return NextResponse.redirect(new URL("/settings?gmail=unavailable", url));
  const token = url.searchParams.get("t");
  let userId: string | null = null;
  let native = "0";
  if (token) {
    userId = verifyConnectToken(token);
    native = "1";
  } else {
    userId = (await currentUser())?.id ?? null;
  }
  if (!userId) return NextResponse.redirect(new URL(token ? "/settings?gmail=expired" : "/login", url));
  const rows = await sql`select email from users where id = ${userId}`;
  // A connect link can be forwarded: someone could send theirs to a victim so the victim's Gmail lands on the
  // sender's account. Native links therefore stop on a page naming the Tarrow account before going to Google.
  if (token && url.searchParams.get("go") !== "1") return confirmPage(url, (rows[0]?.email as string | undefined) ?? "");
  const state = randomBytes(18).toString("base64url");
  const res = NextResponse.redirect(gmailAuthUrl(state, (rows[0]?.email as string | undefined) ?? undefined));
  res.cookies.set("tarrow_gmail_oauth", JSON.stringify({ state, native, userId }), { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/api/integrations/gmail", maxAge: 600 });
  return res;
}

const esc = (v: string) => v.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function confirmPage(url: URL, email: string) {
  const next = new URL(url);
  next.searchParams.set("go", "1");
  const html = `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>Connect Gmail</title>
<body style="font:16px ui-monospace,monospace;max-width:28rem;margin:15vh auto;padding:0 1rem;line-height:1.5">
<h1 style="font-size:1.2rem">Connect Gmail to Tarrow</h1>
<p>Your Gmail will be connected to the Tarrow account <b>${esc(email)}</b>.</p>
<p>If that isn't your account, close this page.</p>
<p><a href="${esc(next.toString())}" style="display:inline-block;padding:.6rem 1rem;background:#111;color:#fff;text-decoration:none;border-radius:8px">Continue to Google</a></p></body>`;
  return new NextResponse(html, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "referrer-policy": "no-referrer" } });
}

/** Connection status for the signed-in user. */
export const POST = authed(async (_req, user) => json({ gmail: await getGmailConnection(user.id), available: gmailConfigured() }));

export const DELETE = authed(async (_req, user) => {
  await disconnectGmail(user.id);
  return json({ ok: true });
});
