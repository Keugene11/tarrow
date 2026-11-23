"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Check, LoaderCircle, RefreshCw, Sparkles, X } from "lucide-react";
import { Composer } from "@/components/chat/Composer";
import { Elapsed } from "@/components/chat/Activity";
import type { Effort } from "@/lib/agent/types";
import { api } from "@/lib/client";
import { LocalTime } from "@/components/RelativeTime";

export function HomeComposer() {
  const router = useRouter();
  return (
    <Composer
      placeholder="What should Tarrow work on?"
      onSend={(text: string, effort: Effort) => {
        router.push(`/c/new?q=${encodeURIComponent(text)}&effort=${effort}&n=${Date.now()}`);
      }}
    />
  );
}

type Run = { id: string; title: string; status: string; started_at: string | null; created_at: string; conversation_id: string; conv_title: string };

export function RunningNow({ runs }: { runs: Run[] }) {
  const router = useRouter();
  // Refresh periodically so finished work drops off the list.
  useEffect(() => {
    const t = setInterval(() => router.refresh(), 15_000);
    return () => clearInterval(t);
  }, [router]);
  return (
    <div className="space-y-2">
      {runs.map((r) => (
        <Link key={r.id} href={`/c/${r.conversation_id}`} className="press flex items-center gap-3 rounded-2xl border border-neutral-200 px-4 py-3 hover:bg-neutral-50">
          <LoaderCircle className="h-4 w-4 shrink-0 animate-spin" />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[14.5px] font-medium">{r.title || r.conv_title}</span>
            <span className="block text-[12.5px] text-neutral-500">
              {r.status === "waiting" ? "Agents working" : "Working"} · <Elapsed since={new Date(r.started_at ?? r.created_at).getTime()} />
            </span>
          </span>
        </Link>
      ))}
    </div>
  );
}

type Suggestion = { id: string; kind: string; title: string; body: string; prompt: string };

export function SuggestionCards({ initial }: { initial: Suggestion[] }) {
  const router = useRouter();
  const [items, setItems] = useState(initial);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const refresh = async () => {
    setLoading(true);
    setError("");
    try {
      const d = await api<{ suggestions: Suggestion[] }>("/api/suggestions", { method: "POST" });
      setItems(d.suggestions);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const dismiss = async (id: string) => {
    setItems((s) => s.filter((x) => x.id !== id));
    await api(`/api/suggestions/${id}`, { method: "DELETE" }).catch(() => {});
  };

  return (
    <div>
      <div className="mb-2.5 flex items-center justify-between">
        <h2 className="flex items-center gap-1.5 text-[15px] font-semibold">
          <Sparkles className="h-4 w-4" /> For you
        </h2>
        <button type="button" onClick={refresh} disabled={loading} className="press inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-[13px] text-neutral-500 hover:text-neutral-900 disabled:opacity-50">
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} /> {loading ? "Thinking" : "New ideas"}
        </button>
      </div>
      {error && <p className="mb-2 text-[13px] text-neutral-500">{error}</p>}
      {items.length === 0 ? (
        <button type="button" onClick={refresh} disabled={loading} className="press w-full rounded-3xl border border-dashed border-neutral-300 px-4 py-6 text-center text-[14px] text-neutral-500 hover:border-neutral-500">
          {loading ? "Coming up with ideas based on your life…" : "Tap to get personalized ideas for what Tarrow can do for you"}
        </button>
      ) : (
        <div className="no-scrollbar -mx-4 flex snap-x scroll-px-4 gap-2.5 overflow-x-auto px-4 pb-1 sm:mx-0 sm:grid sm:grid-cols-2 sm:overflow-visible sm:px-0">
          {items.map((s) => (
            <div key={s.id} className="relative flex w-[78%] shrink-0 snap-start flex-col rounded-3xl border border-neutral-200 bg-white p-4 sm:w-auto">
              <button type="button" onClick={() => dismiss(s.id)} aria-label="Dismiss" className="press absolute right-2.5 top-2.5 flex h-7 w-7 items-center justify-center rounded-full text-neutral-300 hover:bg-neutral-100 hover:text-neutral-700">
                <X className="h-3.5 w-3.5" />
              </button>
              <span className="text-[11px] font-semibold uppercase tracking-wider text-neutral-400">{s.kind}</span>
              <h3 className="mt-1 pr-6 text-[15.5px] font-semibold leading-snug">{s.title}</h3>
              <p className="mt-1 flex-1 text-[13.5px] leading-snug text-neutral-600">{s.body}</p>
              <button type="button" onClick={() => router.push(`/c/new?q=${encodeURIComponent(s.prompt)}&n=${Date.now()}`)} className="press mt-3 self-start rounded-full bg-neutral-900 px-3.5 py-1.5 text-[13px] font-medium text-white">
                Do it
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

type Task = { id: string; title: string; due_at: string | null; status: string };

export function TaskQuickList({ initial }: { initial: Task[] }) {
  const [tasks, setTasks] = useState(initial);
  const toggle = async (t: Task) => {
    const status = t.status === "done" ? "open" : "done";
    setTasks((all) => all.map((x) => (x.id === t.id ? { ...x, status } : x)));
    try {
      await api(`/api/tasks/${t.id}`, { method: "PATCH", body: { status } });
    } catch {
      setTasks((all) => all.map((x) => (x.id === t.id ? { ...x, status: t.status } : x)));
    }
  };
  if (!tasks.length) return <p className="text-[14px] text-neutral-500">Nothing yet. Tarrow adds tasks when you commit to something.</p>;
  return (
    <div className="-mx-1">
      {tasks.map((t) => (
        <button key={t.id} type="button" onClick={() => toggle(t)} className="press flex w-full items-start gap-2.5 rounded-xl px-1 py-1.5 text-left hover:bg-neutral-50">
          <span className={`mt-0.5 flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full border-[1.5px] ${t.status === "done" ? "border-neutral-900 bg-neutral-900" : "border-neutral-300"}`}>
            {t.status === "done" && <Check className="h-3 w-3 text-white" strokeWidth={3} />}
          </span>
          <span className="min-w-0 flex-1">
            <span className={`block truncate text-[14px] ${t.status === "done" ? "text-neutral-400 line-through" : ""}`}>{t.title}</span>
            {t.due_at && <span className="block text-[12px] text-neutral-400"><LocalTime iso={t.due_at} options={{ weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }} /></span>}
          </span>
        </button>
      ))}
    </div>
  );
}
