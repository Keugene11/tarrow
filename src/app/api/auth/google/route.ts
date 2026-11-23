import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { googleAuthUrl, googleConfigured } from "@/lib/google";

// Starts Google sign-in. `native=1` is used by the iOS/Android shell, which opens this in the system browser.
export async function GET(req: Request) {
  const url = new URL(req.url);
  if (!googleConfigured()) return NextResponse.redirect(new URL("/login?error=google_unavailable", url));
  const state = randomBytes(18).toString("base64url");
  const native = url.searchParams.get("native") === "1" ? "1" : "0";
  const tz = (url.searchParams.get("tz") ?? "").slice(0, 60);
  const challenge = (url.searchParams.get("challenge") ?? "").slice(0, 100);
  if (native === "1" && !/^[0-9a-f]{64}$/.test(challenge)) return NextResponse.redirect(new URL("/login?error=google_failed", url));
  const res = NextResponse.redirect(googleAuthUrl(state));
  res.cookies.set("tarrow_oauth", JSON.stringify({ state, native, tz, challenge }), { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/api/auth/google", maxAge: 600 });
  return res;
}
