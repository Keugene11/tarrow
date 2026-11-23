import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { createSession } from "@/lib/auth";
import { createLoginCode, exchangeCode, googleConfigured, upsertGoogleUser, verifyIdToken } from "@/lib/google";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const fail = (reason: string) => NextResponse.redirect(new URL(`/login?error=${reason}`, url));
  if (!googleConfigured()) return fail("google_unavailable");
  const jar = await cookies();
  let saved: { state?: string; native?: string; tz?: string; challenge?: string } = {};
  try {
    saved = JSON.parse(jar.get("tarrow_oauth")?.value ?? "{}");
  } catch {}
  jar.delete({ name: "tarrow_oauth", path: "/api/auth/google" });
  const code = url.searchParams.get("code");
  if (url.searchParams.get("error")) return fail("google_cancelled");
  if (!code || !saved.state || saved.state !== url.searchParams.get("state")) return fail("google_state");

  try {
    const profile = await verifyIdToken(await exchangeCode(code));
    const user = await upsertGoogleUser(profile, saved.tz);
    if (saved.native === "1") {
      // Hand the login back to the app, which completes it inside its own webview.
      const loginCode = await createLoginCode(user.id, saved.challenge ?? "");
      return NextResponse.redirect(`tarrow://auth?code=${encodeURIComponent(loginCode)}`);
    }
    await createSession(user.id);
    return NextResponse.redirect(new URL("/c/new", url));
  } catch (err) {
    console.warn("google sign-in failed", (err as Error).message);
    return fail("google_failed");
  }
}
