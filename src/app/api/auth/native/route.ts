import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { createSession } from "@/lib/auth";
import { consumeLoginCode } from "@/lib/google";

// Completes a native Google sign-in: the app opens this URL in its webview with the one-time code.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code") ?? "";
  const verifier = url.searchParams.get("verifier") ?? "";
  const userId = code && verifier ? await consumeLoginCode(code, verifier) : null;
  if (!userId) return NextResponse.redirect(new URL("/login?error=google_failed", url));
  await createSession(userId);
  const rows = await sql`select onboarded_at from users where id = ${userId}`;
  return NextResponse.redirect(new URL("/c/new", url));
}
