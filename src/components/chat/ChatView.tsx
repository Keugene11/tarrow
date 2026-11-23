"use client";

import Link from "next/link";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { ArrowDown, RotateCcw } from "lucide-react";
import type { Card, Effort, PlanItem, Source, StepLog } from "@/lib/agent/types";
import { api, ApiError } from "@/lib/client";
import { haptic, shareText } from "@/lib/native";
import { Markdown } from "../Markdown";
import { NotifyPill } from "../NotifyPill";
import { ActivitySummary, Dot, LiveActivity, WorkedFor } from "./Activity";
import { CardView, Chips, Sources } from "./Cards";
import { Composer } from "./Composer";
import type { CustomCoach } from "@/lib/coaches";
import { initialRun as emptyLiveRun, liveAnswer, useRunStream, type LiveRun } from "./useRunStream";

export type MessageMeta = {
  runId?: string;
  mode?: string;
  durationMs?: number;
  thinkMs?: number;
  steps?: StepLog[];
  sources?: Source[];
  cards?: Card[];
  plan?: PlanItem[];
  cancelled?: boolean;
  error?: boolean;
};
export type ChatMessage = { id: string; role: "user" | "assistant"; content: string; run_id: string | null; meta: MessageMeta; created_at: string };

type Props = {
  conversationId: string | null;
  initialMessages: ChatMessage[];
  initialRun: { id: string; startedAt: number } | null;
  kind?: "chat" | "interview" | "routine";
  autoSend?: { text: string; effort?: Effort } | null;
  emptyState?: React.ReactNode;
  /** Shown above the messages (the interview banner). */
  prelude?: React.ReactNode;
  onTurnDone?: (messages: ChatMessage[]) => void;
  onConversationCreated?: (id: string) => void;
  placeholder?: string;
  footer?: React.ReactNode;
  coach?: { id: string; custom: CustomCoach | null };
};


export function ChatView({ conversationId: initialConversationId, initialMessages, initialRun, kind = "chat", autoSend, emptyState, prelude, onTurnDone, onConversationCreated, placeholder, footer, coach }: Props) {
  const [conversationId, setConversationId] = useState(initialConversationId);
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [run, setRun] = useState<{ id: string; startedAt: number } | null>(initialRun);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [lastFailed, setLastFailed] = useState<{ text: string; effort: Effort } | null>(null);
  // Guest used up what they get without an account.
  const [needSignup, setNeedSignup] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const [showJump, setShowJump] = useState(false);
  const convRef = useRef(conversationId);
  convRef.current = conversationId;

  const reload = useCallback(async () => {
    const id = convRef.current;
    if (!id) return;
    try {
      const data = await api<{ messages: ChatMessage[]; activeRun: { id: string; started_at: string | null; created_at: string } | null }>(`/api/conversations/${id}`);
      setMessages(data.messages);
      if (data.activeRun) setRun({ id: data.activeRun.id, startedAt: new Date(data.activeRun.started_at ?? data.activeRun.created_at).getTime() });
      else setRun(null);
      onTurnDone?.(data.messages);
    } catch (err) {
      setError((err as Error).message);
      setRun(null);
    }
  }, [onTurnDone]);

  const onFinished = useCallback(
    (live: LiveRun) => {
      if (live.error && !live.done) setError("Tarrow hit an error on that one. Try again.");
      else if (live.done && !live.done.cancelled) void haptic("success");
      void reload();
    },
    [reload],
  );

  const live = useRunStream(run?.id ?? null, onFinished);

  const send = useCallback(
    async (text: string, effort: Effort) => {
      setError("");
      setLastFailed(null);
      const temp: ChatMessage = { id: `tmp-${Date.now()}`, role: "user", content: text, run_id: null, meta: {}, created_at: new Date().toISOString() };
      setMessages((m) => [...m, temp]);
      setSending(true);
      stick.current = true;
      try {
        const r = await api<{ conversationId: string; runId: string }>("/api/chat", { body: { conversationId: convRef.current, text, effort } });
        if (!convRef.current) {
          setConversationId(r.conversationId);
          convRef.current = r.conversationId;
          window.history.replaceState(null, "", `/c/${r.conversationId}`);
          onConversationCreated?.(r.conversationId);
        }
        setRun({ id: r.runId, startedAt: Date.now() });
      } catch (err) {
        setMessages((m) => m.filter((x) => x.id !== temp.id));
        if (err instanceof ApiError && err.code === "signup") {
          setNeedSignup(err.message);
          return;
        }
        setError((err as Error).message);
        setLastFailed({ text, effort });
      } finally {
        setSending(false);
      }
    },
    [onConversationCreated],
  );

  // Once per mount (StrictMode re-runs effects on the same instance, so a ref guards against double sends).
  const autoSentRef = useRef(false);
  useEffect(() => {
    if (!autoSend?.text || autoSentRef.current) return;
    autoSentRef.current = true;
    void send(autoSend.text, autoSend.effort ?? "auto");
  }, [autoSend, send]);

  const stop = async () => {
    if (!run) return;
    try {
      await api(`/api/runs/${run.id}/cancel`, { method: "POST" });
    } catch (err) {
      setError((err as Error).message);
    }
  };

  // Keep pinned to the bottom while content streams in, unless the user scrolled up.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el && stick.current && (messages.length > 0 || run)) el.scrollTop = el.scrollHeight;
  });

  // The keyboard opening shrinks the transcript; stay on the latest line instead of hiding it.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      if (stick.current) el.scrollTop = el.scrollHeight;
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < 140;
    stick.current = near;
    setShowJump(!near);
  };

  const running = !!run || sending;
  // Until the hook resets for a new run, `live` may still hold the previous run's state.
  const liveCurrent = !!run && live.runId === run.id;
  const answer = liveCurrent ? liveAnswer(live) : null;
  const liveCards = liveCurrent ? live.cards : [];

  return (
    <div className="term flex min-h-0 flex-1 flex-col">
      <div ref={scrollRef} onScroll={onScroll} className="term-scroll relative min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <div className="w-full px-4 pb-4 pt-4 md:px-8">
          {prelude}
          {messages.length === 0 && !running && !needSignup && emptyState}
          {messages.map((m) => (m.role === "user" ? <UserLine key={m.id} text={m.content} /> : <AssistantMessage key={m.id} message={m} kind={kind} />))}
          {run && (
            <div className="mb-5 space-y-2">
              <LiveActivity run={liveCurrent ? live : emptyLiveRun(run.id)} startedAt={run.startedAt} />
              {liveCurrent && kind !== "interview" && live.mode && live.mode !== "quick" && !live.done && <NotifyPill />}
              {answer && (
                <div className="flex min-w-0">
                  <Dot />
                  <div className="min-w-0 flex-1">
                    <Markdown text={answer.text} streaming={!live.done} />
                  </div>
                </div>
              )}
              {liveCards.length > 0 && (
                <div className="space-y-2 pl-[2ch]">
                  {liveCards.map((c) => (
                    <CardView key={c.id} card={c} />
                  ))}
                  <Chips cards={liveCards} />
                </div>
              )}
            </div>
          )}
          {needSignup && (
            <div className="mb-5 flex min-w-0 fade-in">
              <Dot />
              <div className="min-w-0 flex-1">
                <div className="font-bold text-t-strong">Sign up to keep going</div>
                <div className="flex min-w-0 t-dim">
                  <span className="shrink-0">└&nbsp;&nbsp;</span>
                  <span className="min-w-0">{needSignup}</span>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-2 pl-[3ch]">
                  <Link href="/signup" className="press inline-flex items-center rounded-md bg-t-inv px-3 py-1.5 font-bold text-t-inv-fg hover:bg-t-inv-hover">
                    Sign up free
                  </Link>
                  <Link href="/login" className="press inline-flex items-center rounded-md px-3 py-1.5 t-dim underline underline-offset-4 hover:text-t-strong">
                    log in
                  </Link>
                </div>
              </div>
            </div>
          )}
          {error && (
            <div className="mb-4 flex flex-wrap items-center gap-x-[2ch] text-red-400 fade-in">
              <span>⏺ Error: {error}</span>
              {/Tarrow Pro|Upgrade to Pro/.test(error) && (
                <Link href="/upgrade" className="text-t-strong underline underline-offset-4">
                  see plans
                </Link>
              )}
              {lastFailed && (
                <button type="button" onClick={() => send(lastFailed.text, lastFailed.effort)} className="inline-flex items-center gap-1 text-t-strong underline underline-offset-4">
                  <RotateCcw className="h-3 w-3" /> retry
                </button>
              )}
            </div>
          )}
        </div>
      </div>
      <div className="relative w-full px-3 pb-[max(10px,var(--safe-bottom))] pt-1 md:px-8">
        {showJump && (
          <button
            type="button"
            onClick={() => {
              stick.current = true;
              scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
            }}
            aria-label="Jump to latest"
            className="absolute -top-9 right-4 flex items-center gap-1 rounded border t-line bg-t-panel-2 px-2 py-1 text-[12px] t-dim hover:text-t-strong md:right-8"
          >
            <ArrowDown className="h-3 w-3" /> latest
          </button>
        )}
        {footer}
        <Composer onSend={send} onStop={stop} running={running} showEffort={kind !== "interview"} placeholder={placeholder} coach={coach} />
      </div>
    </div>
  );
}

export function UserLine({ text }: { text: string }) {
  return (
    <div className="-mx-2 mb-4 flex min-w-0 rounded bg-t-panel-2 px-2 py-1.5 fade-in">
      <span className="inline-block w-[2ch] shrink-0 select-none t-dim">&gt;</span>
      <span className="min-w-0 flex-1 whitespace-pre-wrap break-words text-t-soft">{text}</span>
    </div>
  );
}

function AssistantMessage({ message, kind }: { message: ChatMessage; kind: string }) {
  const meta = message.meta ?? {};
  const cards = meta.cards ?? [];
  const bigCards = cards.filter((c) => c.type !== "goal" && c.type !== "task");
  const showActivity = kind !== "interview" && (meta.steps?.length ?? 0) > 0;
  return (
    <div className="mb-5 space-y-2 fade-in">
      {showActivity && <ActivitySummary steps={meta.steps ?? []} plan={meta.plan} mode={meta.mode} />}
      <div className="flex min-w-0">
        <Dot state={meta.cancelled || meta.error ? "failed" : "done"} />
        <div className={`min-w-0 flex-1 ${meta.cancelled || meta.error ? "t-dim" : ""}`}>
          <Markdown text={message.content} />
        </div>
      </div>
      {bigCards.length > 0 && (
        <div className="space-y-2 pl-[2ch]">
          {bigCards.map((c) => (
            <CardView key={c.id} card={c} />
          ))}
        </div>
      )}
      {(cards.length > bigCards.length || (meta.sources?.length ?? 0) > 0) && (
        <div className="space-y-1 pl-[2ch]">
          <Chips cards={cards} />
          <Sources sources={meta.sources ?? []} />
        </div>
      )}
      {!meta.cancelled && <WorkedFor durationMs={meta.durationMs} thinkMs={meta.thinkMs} onShare={kind === "interview" ? undefined : () => shareText(message.content)} />}
    </div>
  );
}
