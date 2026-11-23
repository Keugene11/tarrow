"use client";

import { confirmDialog, promptDialog } from "@/components/Dialog";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowRight, MoreHorizontal, SquarePen } from "lucide-react";
import { MenuButton } from "@/components/AppShell";
import { ChatView, type ChatMessage } from "@/components/chat/ChatView";
import type { Effort } from "@/lib/agent/types";
import { api } from "@/lib/client";
import { coachById, coachLabel, type CustomCoach } from "@/lib/coaches";
import { INTERVIEW_TOPICS } from "@/lib/interview-intro";
import { InterviewBanner } from "@/components/chat/InterviewBanner";

const STARTERS = [
  "Find me 3 events worth going to this week based on what you know about me",
  "Look at my goals and tell me the single highest-leverage thing to do this week",
  "Research how people in my situation made their first $5k/month",
  "Plan a great Saturday for me with places, timing, and a rain backup",
];

type Props = {
  conversationId: string | null;
  title: string;
  kind?: "chat" | "interview" | "routine";
  initialMessages: ChatMessage[];
  initialRun: { id: string; startedAt: number } | null;
  autoSend: { text: string; effort?: string } | null;
  firstName: string;
  city?: string | null;
  suggestions?: { title: string; prompt: string }[];
  /** Set when this chat is the onboarding interview. */
  interview?: { onboarded: boolean; covered: string[] };
  coach?: { id: string; custom: CustomCoach | null };
  /** Trying Tarrow without an account. */
  guest?: { tasksLeft: number; tasks: number };
};

export function ChatScreen({ conversationId, title: initialTitle, kind = "chat", initialMessages, initialRun, autoSend, firstName, city, suggestions = [], interview, coach, guest }: Props) {
  const router = useRouter();
  const [title, setTitle] = useState(initialTitle);
  const [convId, setConvId] = useState(conversationId);
  const [menu, setMenu] = useState(false);
  const [starter, setStarter] = useState<string | null>(null);
  const [starterEffort, setStarterEffort] = useState<Effort>("auto");

  const menuRef = useRef<HTMLDivElement>(null);

  // Interview: progress by the areas Tarrow has saved something for, and a way into chats once it's done.
  const [covered, setCovered] = useState(interview?.covered ?? []);
  const [onboarded, setOnboarded] = useState(!!interview?.onboarded);
  const [skipping, setSkipping] = useState(false);
  const pct = Math.round((INTERVIEW_TOPICS.filter((t) => covered.includes(t.key)).length / INTERVIEW_TOPICS.length) * 100);

  const skip = async () => {
    if (!(await confirmDialog({ title: "Skip the rest of the interview?", body: "Tarrow gives much better advice when it knows you. You can pick it back up anytime from your chats.", confirmLabel: "Skip" }))) return;
    setSkipping(true);
    try {
      await api("/api/onboarding/skip", { method: "POST" });
      router.push("/c/new");
      router.refresh();
    } catch {
      setSkipping(false);
    }
  };

  useEffect(() => {
    if (!menu) return;
    const close = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenu(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [menu]);

  const refreshTitle = useCallback(async () => {
    const id = convId;
    if (!id) return;
    try {
      const d = await api<{ conversation: { title: string } }>(`/api/conversations/${id}`);
      setTitle(d.conversation.title);
    } catch {}
  }, [convId]);

  const onTurnDone = useCallback(async () => {
    refreshTitle();
    if (!interview) return;
    try {
      const [mem, me] = await Promise.all([api<{ memories: { category: string }[] }>("/api/memories"), api<{ user: { onboarded: boolean } }>("/api/me")]);
      setCovered([...new Set(mem.memories.map((m) => m.category))]);
      if (me.user.onboarded) setOnboarded(true);
    } catch {}
  }, [refreshTitle, interview]);

  const onCreated = useCallback((id: string) => {
    setConvId(id);
    // The title is set by the agent's triage a moment after the run starts.
    setTimeout(async () => {
      try {
        const d = await api<{ conversation: { title: string } }>(`/api/conversations/${id}`);
        setTitle(d.conversation.title);
      } catch {}
    }, 2500);
  }, []);

  const rename = async () => {
    setMenu(false);
    if (!convId) return;
    const next = await promptDialog({ title: "Rename chat", defaultValue: title, confirmLabel: "Rename" });
    if (!next?.trim()) return;
    setTitle(next.trim());
    await api(`/api/conversations/${convId}`, { method: "PATCH", body: { title: next.trim() } }).catch(() => {});
  };

  const remove = async () => {
    setMenu(false);
    if (!convId || !(await confirmDialog({ title: "Delete this chat?", body: "This can't be undone.", confirmLabel: "Delete", danger: true }))) return;
    await api(`/api/conversations/${convId}`, { method: "DELETE" }).catch(() => {});
    router.push("/c/new");
    router.refresh();
  };

  const effectiveAutoSend = starter ? { text: starter, effort: starterEffort } : autoSend ? { text: autoSend.text, effort: (autoSend.effort as Effort) ?? "auto" } : null;
  const lifePath = `~/${(city?.split(",")[0] || "life").toLowerCase().replace(/[^a-z0-9]+/g, "-")}/${(firstName || "you").toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  const coachStarters = coach && coach.id !== "tarrow" ? coachById(coach.id).starters : [];
  const tryItems = coachStarters.length
    ? coachStarters.map((s) => ({ label: s, prompt: s }))
    : suggestions.length
      ? suggestions.map((s) => ({ label: s.title, prompt: s.prompt }))
      : STARTERS.map((s) => ({ label: s, prompt: s }));

  return (
    <div className="term flex h-full min-h-0 flex-col">
      <header className="pt-safe shrink-0 border-b t-line">
        <div className="flex items-center gap-2 px-3 py-2 md:px-8">
          <MenuButton dark />
          <div className="min-w-0 flex-1 truncate">
            <span className="t-dim">tarrow</span>
            <span className="t-faint"> › </span>
            <span className="text-t-strong">{interview ? "interview" : title}</span>
            {kind === "routine" && <span className="t-dim"> (routine)</span>}
            {interview && !onboarded && <span className="t-dim"> · {pct}%</span>}
          </div>
          {interview && !onboarded && (
            <button type="button" onClick={skip} disabled={skipping} className="rounded px-2 py-1 t-dim hover:bg-t-hover hover:text-t-strong disabled:opacity-50">
              skip
            </button>
          )}
          <button type="button" aria-label="New chat" onClick={() => router.push(`/c/new?n=${Date.now()}`)} className="flex h-8 w-8 items-center justify-center rounded t-dim hover:bg-t-hover hover:text-t-strong">
            <SquarePen className="h-4 w-4" />
          </button>
          {convId && !interview && (
            <div ref={menuRef} className="relative">
              <button type="button" aria-label="Chat options" onClick={() => setMenu((m) => !m)} className="flex h-8 w-8 items-center justify-center rounded t-dim hover:bg-t-hover hover:text-t-strong">
                <MoreHorizontal className="h-4 w-4" />
              </button>
              {menu && (
                <div className="absolute right-0 top-full z-30 mt-1 w-40 border t-line bg-t-panel py-1 fade-in">
                  <button type="button" onClick={rename} className="block w-full px-3 py-1.5 text-left hover:bg-t-hover">
                    rename
                  </button>
                  <button type="button" onClick={remove} className="block w-full px-3 py-1.5 text-left text-red-400 hover:bg-t-hover">
                    delete
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </header>
      <ChatView
        key={starter ?? "chat"}
        conversationId={convId}
        initialMessages={initialMessages}
        initialRun={initialRun}
        kind={kind}
        autoSend={effectiveAutoSend}
        onConversationCreated={onCreated}
        onTurnDone={onTurnDone}
        placeholder={interview && !onboarded ? "Type your answer…" : undefined}
        coach={interview ? undefined : coach}
        footer={
          // Right after the interview wraps up; coming back to it later keeps the plain composer.
          interview && onboarded && !interview.onboarded ? (
            <Link href={`/c/new?n=${Date.now()}`} className="mb-2 flex items-center justify-center gap-2 rounded-md bg-t-inv px-4 py-2.5 font-bold text-t-inv-fg hover:bg-t-inv-hover fade-in">
              Start chatting with Tarrow <ArrowRight className="h-4 w-4" />
            </Link>
          ) : null
        }
        prelude={interview && !onboarded ? <InterviewBanner covered={covered} onSkip={skip} skipping={skipping} note={guest ? `No account needed, and ${guest.tasks} free tasks after.` : undefined} /> : null}
        emptyState={
          <div className="fade-in">
            <div className="inline-block max-w-full rounded-md border border-t-frame px-4 py-3">
              <div>
                <span className="text-t-strong">✻</span> Welcome to <span className="font-bold text-t-strong">Tarrow</span>
                {firstName ? `, ${firstName}` : ""}!
              </div>
              <div className="mt-3 t-dim">&nbsp;&nbsp;/ for commands, shift+tab to change effort</div>
              <div className="mt-2 t-dim">&nbsp;&nbsp;life: {lifePath}</div>
              {guest && (
                <div className="t-dim">
                  &nbsp;&nbsp;guest: {guest.tasksLeft} of {guest.tasks} free tasks left ·{" "}
                  <Link href="/signup" className="text-t-strong underline underline-offset-4">
                    sign up
                  </Link>{" "}
                  to keep everything
                </div>
              )}
              {coach && (
                <div className="t-dim">
                  &nbsp;&nbsp;coach: {coachLabel(coach.id, coach.custom)} <span className="t-faint">(/coach to switch)</span>
                </div>
              )}
            </div>
            <div className="mt-5 t-dim">Tips for getting started:</div>
            <ol className="mt-2 space-y-0.5 t-dim">
              <li>1. Ask for real work, like finding events, planning a week, or researching a decision</li>
              <li>2. Use /deep for research that runs minutes, with parallel agents</li>
              <li>3. Tarrow remembers your life. See or edit it with /memory</li>
              <li>4. Tasks keep running in the background. Close the app anytime</li>
              {coach && (
                <>
                  <li>5. Pick who advises you with /coach: a YC partner, an investor, a career agent, or anyone</li>
                  <li>6. Ask it to find jobs or people to DM. They land in /pipeline with drafts ready</li>
                </>
              )}
            </ol>
            <div className="mt-5 t-dim">※ Try:</div>
            <div className="mt-1 space-y-0.5">
              {tryItems.map((s) => (
                <button key={s.prompt} type="button" onClick={() => {
                    setStarterEffort("auto");
                    setStarter(s.prompt);
                  }} className="flex w-full min-w-0 text-left hover:text-t-strong">
                  <span className="inline-block w-[2ch] shrink-0 t-dim">›</span>
                  <span className="min-w-0 break-words text-t-soft underline decoration-t-edge underline-offset-4 hover:decoration-t-strong">{s.label}</span>
                </button>
              ))}
            </div>
          </div>
        }
      />
    </div>
  );
}
