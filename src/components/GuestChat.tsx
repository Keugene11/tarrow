"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { LoaderCircle } from "lucide-react";
import { MenuButton } from "./AppShell";
import { Composer } from "./chat/Composer";
import { Dot } from "./chat/Activity";
import { UserLine } from "./chat/ChatView";
import { InterviewBanner } from "./chat/InterviewBanner";
import { Markdown } from "./Markdown";
import { api } from "@/lib/client";
import { interviewGreeting } from "@/lib/interview-intro";
import { GUEST_LIMITS } from "@/lib/plans";
import { isNative } from "@/lib/native";

/**
 * What a logged-out visitor sees: the interview, already started. On the web their first answer goes straight through
 * (the API still records consent). In the native apps it first asks for the AI
 * data-sharing OK, which App Store 5.1.2(i) requires. Then it creates a guest account and continues in the real interview.
 */
export function GuestChat() {
  const [answer, setAnswer] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (answer && el) el.scrollTop = el.scrollHeight;
  }, [answer]);

  const start = async (text: string | null = answer) => {
    if (!text) return;
    setBusy(true);
    setError("");
    let timezone = "America/New_York";
    try {
      timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || timezone;
    } catch {}
    try {
      let embedded = false;
      try {
        embedded = window.top !== window.self;
      } catch {
        embedded = true; // reading window.top across origins throws: we're framed
      }
      const g = await api<{ conversationId: string | null }>("/api/auth/guest", { body: { agree: true, timezone, embedded } });
      if (!g.conversationId) {
        window.location.href = `/c/new?q=${encodeURIComponent(text)}`;
        return;
      }
      await api("/api/chat", { body: { conversationId: g.conversationId, text, effort: "auto" } }).catch(() => {});
      window.location.href = `/c/${g.conversationId}`;
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <div className="term flex h-full min-h-0 flex-col">
      <header className="pt-safe shrink-0 border-b t-line">
        <div className="flex items-center gap-2 px-3 py-2 md:px-8">
          <MenuButton dark />
          <div className="min-w-0 flex-1 truncate">
            <span className="t-dim">tarrow</span>
            <span className="t-faint"> › </span>
            <span className="text-t-strong">interview</span>
          </div>
          <Link href="/login" className="rounded px-2 py-1 t-dim hover:bg-t-hover hover:text-t-strong">
            log in
          </Link>
          <Link href="/signup" className="rounded bg-t-inv px-2.5 py-1 font-bold text-t-inv-fg hover:bg-t-inv-hover">
            sign up
          </Link>
        </div>
      </header>

      <div ref={scrollRef} className="term-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <div className="w-full px-4 pb-4 pt-4 md:px-8">
          <div className="fade-in">
            <InterviewBanner covered={[]} note={`No account needed, and ${GUEST_LIMITS.tasks} free tasks after.`} />
            <div className="mb-5 flex min-w-0">
              <Dot state="done" />
              <div className="min-w-0 flex-1">
                <Markdown text={interviewGreeting(null)} />
              </div>
            </div>
          </div>

          {answer && (
            <div className="fade-in">
              <UserLine text={answer} />
              {!isNative() ? (
                <div className="flex min-w-0">
                  <Dot />
                  <div className="min-w-0 flex-1 t-dim">{error ? <span className="text-red-400">⏺ {error}</span> : "thinking…"}</div>
                </div>
              ) : (
              <div className="flex min-w-0">
                <Dot />
                <div className="min-w-0 flex-1">
                  <div className="font-bold text-t-strong">One thing before I answer</div>
                  <div className="flex min-w-0 t-dim">
                    <span className="shrink-0">└&nbsp;&nbsp;</span>
                    <span className="min-w-0">
                      Tarrow is powered by third-party AI. Your messages and what it learns about you go to the model providers that write its replies (OpenRouter, routing to Z.ai or DeepSeek, with Groq as backup). They don&apos;t store it or train on it. Voice goes to Groq, web searches to search providers.{" "}
                      <Link href="/privacy" className="underline underline-offset-4 hover:text-t-strong">
                        details
                      </Link>
                    </span>
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-2 pl-[3ch]">
                    <button type="button" onClick={() => start()} disabled={busy} className="press inline-flex items-center gap-2 rounded-md bg-t-inv px-3 py-1.5 font-bold text-t-inv-fg hover:bg-t-inv-hover disabled:opacity-60">
                      {busy && <LoaderCircle className="h-4 w-4 animate-spin" />} Agree &amp; continue
                    </button>
                    <span className="t-faint">no account needed yet</span>
                  </div>
                  {error && <div className="mt-2 pl-[3ch] text-red-400">⏺ {error}</div>}
                </div>
              </div>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="w-full px-3 pb-[max(10px,var(--safe-bottom))] pt-1 md:px-8">
        <Composer onSend={(text) => {
            setAnswer(text);
            if (!isNative()) void start(text);
          }} disabled={busy} showEffort={false} autoFocus placeholder="Type your answer…" />
      </div>
    </div>
  );
}
