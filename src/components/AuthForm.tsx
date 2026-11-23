"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { LoaderCircle } from "lucide-react";
import { Logo } from "./Logo";
import { api } from "@/lib/client";
import { googleEnabled, startGoogleSignIn } from "@/lib/google-client";
import { isIOSApp, signInWithApple } from "@/lib/native";

const GOOGLE_ERRORS: Record<string, string> = {
  google_unavailable: "Google sign-in isn't set up yet. Use email for now.",
  google_cancelled: "Google sign-in was cancelled.",
  google_state: "Google sign-in expired. Try again.",
  google_failed: "Google sign-in failed. Try again.",
};

export function GoogleMark() {
  return (
    <svg width="16" height="16" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}

export function AppleMark() {
  return (
    <svg width="15" height="18" viewBox="0 0 814 1000" aria-hidden="true" fill="currentColor">
      <path d="M788 341c-6 4-107 61-107 187 0 146 128 198 132 199-1 3-20 70-67 139-42 60-86 120-152 120s-83-38-159-38c-74 0-101 40-161 40s-102-56-150-124C68 784 23 661 23 544c0-187 122-287 242-287 64 0 117 42 157 42 38 0 98-45 171-45 28 0 128 3 195 87zM554 158c30-36 51-85 51-135 0-7-1-14-2-19-49 2-107 33-142 73-27 31-53 80-53 131 0 8 1 15 2 18 3 1 9 1 14 1 44 0 99-29 130-69z" />
    </svg>
  );
}

/** Native Sign in with Apple, shown only inside the iOS app (required there alongside Google). */
export function AppleSignInButton({ onError }: { onError: (message: string) => void }) {
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => setShow(isIOSApp()), []);
  if (!show) return null;
  return (
    <button
      type="button"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          const res = await signInWithApple();
          if (res) window.location.href = "/c/new";
          else setBusy(false);
        } catch (err) {
          onError((err as Error).message || "Apple sign-in failed. Try again.");
          setBusy(false);
        }
      }}
      style={{ fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', system-ui, sans-serif" }}
      className="flex min-h-[44px] w-full items-center justify-center gap-2 rounded-md bg-t-inv py-2.5 text-[16px] font-semibold text-t-inv-fg hover:bg-t-inv-hover disabled:opacity-60"
    >
      {busy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <AppleMark />} Continue with Apple
    </button>
  );
}

export function AuthForm({ mode, guest = false }: { mode: "login" | "signup"; guest?: boolean }) {
  const [form, setForm] = useState({ name: "", email: "", password: "", city: "" });
  const [busy, setBusy] = useState(false);
  const [googleBusy, setGoogleBusy] = useState(false);
  const [error, setError] = useState("");
  const [apple, setApple] = useState(false);
  const signup = mode === "signup";
  const social = googleEnabled() || apple;

  useEffect(() => setApple(isIOSApp()), []);

  useEffect(() => {
    const code = new URLSearchParams(window.location.search).get("error");
    if (code && GOOGLE_ERRORS[code]) setError(GOOGLE_ERRORS[code]);
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      if (signup) {
        let timezone = "America/New_York";
        try {
          timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || timezone;
        } catch {}
        await api("/api/auth/signup", { body: { ...form, timezone } });
        window.location.href = "/c/new";
      } else {
        await api("/api/auth/login", { body: { email: form.email, password: form.password } });
        window.location.href = "/c/new";
      }
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  const google = async () => {
    setGoogleBusy(true);
    setError("");
    try {
      await startGoogleSignIn();
    } catch {
      setError(GOOGLE_ERRORS.google_failed);
    } finally {
      setTimeout(() => setGoogleBusy(false), 4000);
    }
  };

  const field = (label: string, input: React.ReactNode) => (
    <label className="flex items-center gap-[1ch] rounded-md border border-t-edge px-3 py-2 focus-within:border-t-focus">
      <span className="shrink-0 t-dim">
        <span className="text-t-strong">&gt;</span> {label}:
      </span>
      {input}
    </label>
  );
  const inputCls = "min-w-0 flex-1 bg-transparent text-[16px] outline-none md:text-[14px]";

  return (
    <div className="term flex min-h-[100dvh] flex-col bg-white">
      <div className="pt-safe px-5 py-4 md:px-8">
        <Logo size={22} />
      </div>
      <div className="flex flex-1 justify-center px-5 pb-16 pt-[5vh]">
        <div className="w-full max-w-[460px]">
          <div className="rounded-md border border-t-frame px-4 py-3">
            <div>
              <span className="text-t-strong">✻</span> Welcome to <span className="font-bold text-t-strong">Tarrow</span>
            </div>
            <div className="mt-2 t-dim">&nbsp;&nbsp;{signup ? "An agent that learns your life, then does the work." : "Log in to pick up where you left off."}</div>
            {guest && <div className="t-dim">&nbsp;&nbsp;Your interview, memory and chats so far come with you.</div>}
          </div>

          {social && (
            <>
              <div className="mt-6 space-y-2">
                <AppleSignInButton onError={setError} />
                {googleEnabled() && (
              <button type="button" onClick={google} disabled={googleBusy} className="flex w-full items-center justify-center gap-2 rounded-md border border-t-edge py-2.5 font-bold text-t-strong hover:border-t-strong disabled:opacity-60">
                {googleBusy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <GoogleMark />} Continue with Google
              </button>
                )}
              </div>
              <div className="my-5 flex items-center gap-3 t-faint">
                <span className="h-px flex-1 bg-t-line" /> or with email <span className="h-px flex-1 bg-t-line" />
              </div>
            </>
          )}

          <form onSubmit={submit} className={`space-y-2 ${social ? "" : "mt-6"}`}>
            {signup && field("name", <input className={inputCls} autoComplete="given-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required maxLength={60} aria-label="Name" />)}
            {field("email", <input className={inputCls} type="email" autoComplete="email" inputMode="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required aria-label="Email" />)}
            {field("password", <input className={inputCls} type="password" autoComplete={signup ? "new-password" : "current-password"} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required minLength={signup ? 8 : 1} placeholder={signup ? "8+ chars" : ""} aria-label="Password" />)}
            {signup && field("city", <input className={inputCls} autoComplete="address-level2" value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} maxLength={80} placeholder="optional" aria-label="City" />)}
            {error && (
              <p role="alert" className="pt-1 text-red-400">
                ⏺ {error}
              </p>
            )}
            <button type="submit" disabled={busy} className="mt-2 flex w-full items-center justify-center gap-2 rounded-md bg-t-inv py-2.5 font-bold text-t-inv-fg hover:bg-t-inv-hover disabled:opacity-60">
              {busy && <LoaderCircle className="h-4 w-4 animate-spin" />}
              {signup ? "Create account" : "Log in"} ↵
            </button>
          </form>

          <p className="mt-5 text-center t-dim">
            {signup ? "Already have an account? " : "New to Tarrow? "}
            <Link href={signup ? "/login" : "/signup"} className="text-t-strong underline underline-offset-4">
              {signup ? "log in" : "create an account"}
            </Link>
          </p>
          {signup && (
            <p className="mt-6 text-center text-[12px] t-faint">
              By continuing you agree to the{" "}
              <Link href="/terms" className="underline">
                Terms
              </Link>{" "}
              and{" "}
              <Link href="/privacy" className="underline">
                Privacy Policy
              </Link>
              .
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
