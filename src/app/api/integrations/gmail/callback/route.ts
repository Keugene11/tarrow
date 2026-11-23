import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { connectGmail, gmailConfigured } from "@/lib/gmail";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const jar = await cookies();
  let saved: { state?: string; native?: string; userId?: string } = {};
  try {
    saved = JSON.parse(jar.get("tarrow_gmail_oauth")?.value ?? "{}");
  } catch {}
  jar.delete({ name: "tarrow_gmail_oauth", path: "/api/integrations/gmail" });
  // The native app started this in the system browser and gets the result back through its deep link.
  const done = (status: string) => NextResponse.redirect(saved.native === "1" ? `tarrow://gmail?status=${status}` : new URL(`/settings?gmail=${status}`, url));

  if (!gmailConfigured()) return done("unavailable");
  const code = url.searchParams.get("code");
  if (url.searchParams.get("error")) return done("cancelled");
  if (!code || !saved.state || !saved.userId || saved.state !== url.searchParams.get("state")) return done("state");
  try {
    await connectGmail(saved.userId, code);
    return done("connected");
  } catch (err) {
    const msg = (err as Error).message;
    console.warn("gmail connect failed", msg);
    return done(msg === "scopes" ? "scopes" : "failed");
  }
}
