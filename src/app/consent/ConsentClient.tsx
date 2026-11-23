"use client";

import Link from "next/link";
import { useState } from "react";
import { LoaderCircle } from "lucide-react";
import { LogoMark } from "@/components/Logo";
import { api } from "@/lib/client";
import { unregisterNativePush } from "@/lib/native";

const SHARED = [
  ["AI models", "Your messages, what Tarrow remembers about you (life file, goals), and your name and city are sent to the AI model providers that write Tarrow's replies: OpenRouter, which routes to Z.ai (GLM) or DeepSeek, with Groq as a backup. We only use hosts that don't store your data or train on it."],
  ["Voice", "If you use the mic, the recording is sent to Groq to turn it into text. It isn't kept."],
  ["Web research", "Search queries Tarrow writes for you go to search providers, and pages it reads are fetched from those websites. Place lookups use Google Maps."],
];

/** Explicit permission before any personal data goes to third-party AI (App Store guideline 5.1.2(i)). */
export function ConsentClient({ next }: { next: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const agree = async () => {
    setBusy(true);
    setError("");
    try {
      await api("/api/consent", { body: { agree: true } });
      window.location.href = next;
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  const signOut = async () => {
    await unregisterNativePush();
    await api("/api/auth/logout", { method: "POST" }).catch(() => {});
    window.location.href = "/";
  };

  return (
    <div className="term flex min-h-[100dvh] flex-col bg-white">
      <div className="pt-safe flex items-center gap-2 px-5 py-4 md:px-8">
        <LogoMark size={22} />
        <span className="font-bold">tarrow</span>
      </div>
      <div className="flex flex-1 justify-center px-5 pb-12 pt-[3vh]">
        <div className="w-full max-w-[560px]">
          <div className="rounded-md border border-t-frame px-4 py-3">
            <div>
              <span className="text-t-strong">✻</span> <span className="font-bold text-t-strong">Before we start: how Tarrow uses AI</span>
            </div>
            <div className="mt-2 t-dim">Tarrow is powered by third-party AI. To answer you, it has to share some of your information with them. Nothing is sent until you agree.</div>
          </div>

          <div className="mt-5 space-y-3">
            {SHARED.map(([title, text]) => (
              <div key={title} className="flex min-w-0">
                <span className="inline-block w-[2ch] shrink-0 t-dim">●</span>
                <div className="min-w-0">
                  <div className="font-bold text-t-strong">{title}</div>
                  <div className="flex min-w-0 t-dim">
                    <span className="shrink-0">└&nbsp;&nbsp;</span>
                    <span className="min-w-0">{text}</span>
                  </div>
                </div>
              </div>
            ))}
            <div className="flex min-w-0">
              <span className="inline-block w-[2ch] shrink-0 t-dim">●</span>
              <div className="min-w-0">
                <div className="font-bold text-t-strong">What we never do</div>
                <div className="flex min-w-0 t-dim">
                  <span className="shrink-0">└&nbsp;&nbsp;</span>
                  <span className="min-w-0">Sell your data, use it for ads, or track you across apps. You can withdraw this permission or delete everything in Settings at any time.</span>
                </div>
              </div>
            </div>
          </div>

          <p className="mt-5 t-dim">
            Tarrow can make mistakes. It&apos;s not a substitute for medical, legal or financial advice. Details in the{" "}
            <Link href="/privacy" className="text-t-strong underline underline-offset-4">
              Privacy Policy
            </Link>{" "}
            and{" "}
            <Link href="/terms" className="text-t-strong underline underline-offset-4">
              Terms
            </Link>
            .
          </p>

          {error && <p className="mt-3 text-red-400">⏺ {error}</p>}
          <button type="button" onClick={agree} disabled={busy} className="mt-6 flex w-full items-center justify-center gap-2 rounded-md bg-t-inv py-2.5 font-bold text-t-inv-fg hover:bg-t-inv-hover disabled:opacity-60">
            {busy && <LoaderCircle className="h-4 w-4 animate-spin" />} Agree and continue
          </button>
          <button type="button" onClick={signOut} className="mt-2 w-full rounded-md py-2 t-dim hover:text-t-strong">
            Don&apos;t agree, sign out
          </button>
        </div>
      </div>
    </div>
  );
}
