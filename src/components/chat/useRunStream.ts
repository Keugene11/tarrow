"use client";

import { useEffect, useReducer, useRef } from "react";
import type { Card, Mode, PlanItem, Source } from "@/lib/agent/types";

export type LiveStep = { id: string; name: string; label: string; detail?: string; summary?: string; ok?: boolean; done: boolean; sources?: Source[]; runId?: string };
export type LiveAgent = { id: string; title: string; detail?: string; status: string; statusText?: string; steps: LiveStep[] };
export type TimelineItem = { kind: "step"; id: string } | { kind: "note"; step: number } | { kind: "agents"; ids: string[] } | { kind: "thought"; step: number; ms: number };

export type LiveRun = {
  runId: string;
  status: string;
  mode?: Mode;
  modeLabel?: string;
  statusText: string;
  waitingUntil?: string;
  steps: Record<string, LiveStep>;
  agents: Record<string, LiveAgent>;
  timeline: TimelineItem[];
  texts: Record<number, string>;
  reasoning: Record<number, string>;
  interim: Record<number, boolean>;
  lastStep: number;
  plan?: PlanItem[];
  cards: Card[];
  done?: { messageId?: string; cancelled?: boolean; durationMs?: number };
  thinkMs: number;
  error?: string;
};

type RawEvent = { run_id: string; seq: number; type: string; data: Record<string, unknown> };
type RawRun = { id: string; parent_run_id: string | null; title: string; status: string; mode: string | null };
type Action = { type: "events"; events: RawEvent[]; runs: RawRun[] } | { type: "reset"; runId: string };

export function initialRun(runId: string): LiveRun {
  return { runId, status: "queued", statusText: "Starting", steps: {}, agents: {}, timeline: [], texts: {}, reasoning: {}, interim: {}, lastStep: 0, cards: [], thinkMs: 0 };
}

function apply(run: LiveRun, e: RawEvent): LiveRun {
  const d = e.data;
  const step = Number(d.step ?? 0);
  if (e.run_id !== run.runId) {
    const agent = run.agents[e.run_id];
    if (!agent) return run;
    const next = { ...agent };
    if (e.type === "status") next.statusText = String(d.text ?? "");
    else if (e.type === "tool_start") next.steps = [...next.steps, { id: String(d.id), name: String(d.name), label: String(d.label), detail: d.detail as string | undefined, done: false }];
    else if (e.type === "tool_end") next.steps = next.steps.map((s) => (s.id === d.id ? { ...s, done: true, ok: d.ok as boolean, summary: d.summary as string } : s));
    else if (e.type === "done") next.status = "done";
    else if (e.type === "error") next.status = "error";
    else if (e.type === "waiting") next.statusText = String(d.text ?? "Waiting");
    else return run;
    return { ...run, agents: { ...run.agents, [e.run_id]: next } };
  }
  switch (e.type) {
    case "status":
      return { ...run, statusText: String(d.text ?? ""), waitingUntil: undefined };
    case "mode":
      return { ...run, mode: d.mode as Mode, modeLabel: String(d.label ?? "") };
    case "delta":
      return { ...run, texts: { ...run.texts, [step]: (run.texts[step] ?? "") + String(d.text ?? "") }, lastStep: Math.max(run.lastStep, step) };
    case "reasoning":
      return { ...run, reasoning: { ...run.reasoning, [step]: (run.reasoning[step] ?? "") + String(d.text ?? "") }, lastStep: Math.max(run.lastStep, step) };
    case "discard": {
      const texts = { ...run.texts };
      const reasoning = { ...run.reasoning };
      delete texts[step];
      delete reasoning[step];
      return { ...run, texts, reasoning };
    }
    case "thought": {
      const ms = Number(d.ms ?? 0);
      return { ...run, thinkMs: run.thinkMs + ms, timeline: [...run.timeline, { kind: "thought", step, ms }] };
    }
    case "step_end": {
      if (d.final) return run;
      const hasText = !!run.texts[step]?.trim();
      return { ...run, interim: { ...run.interim, [step]: true }, timeline: hasText ? [...run.timeline, { kind: "note", step }] : run.timeline };
    }
    case "tool_start": {
      const s: LiveStep = { id: String(d.id), name: String(d.name), label: String(d.label), detail: d.detail as string | undefined, done: false };
      return { ...run, steps: { ...run.steps, [s.id]: s }, timeline: [...run.timeline, { kind: "step", id: s.id }] };
    }
    case "tool_end": {
      const prev = run.steps[String(d.id)];
      if (!prev) return run;
      return { ...run, steps: { ...run.steps, [prev.id]: { ...prev, done: true, ok: d.ok as boolean, summary: d.summary as string, sources: d.sources as Source[] } } };
    }
    case "plan":
      return { ...run, plan: d.items as PlanItem[] };
    case "agents": {
      const list = (d.agents as { id: string; title: string; detail?: string }[]) ?? [];
      const agents = { ...run.agents };
      for (const a of list) agents[a.id] = { id: a.id, title: a.title, detail: a.detail, status: "queued", steps: [] };
      return { ...run, agents, timeline: [...run.timeline, { kind: "agents", ids: list.map((a) => a.id) }] };
    }
    case "card": {
      const card = d.card as Card;
      if (run.cards.some((c) => c.id === card.id)) return run;
      return { ...run, cards: [...run.cards, card] };
    }
    case "waiting":
      return { ...run, statusText: String(d.text ?? "Waiting"), waitingUntil: d.until as string | undefined };
    case "done":
      return { ...run, done: { messageId: d.messageId as string | undefined, cancelled: !!d.cancelled, durationMs: d.durationMs as number | undefined } };
    case "error":
      return { ...run, error: String(d.message ?? "Something went wrong") };
    default:
      return run;
  }
}

function reducer(state: LiveRun, action: Action): LiveRun {
  if (action.type === "reset") return initialRun(action.runId);
  let next = state;
  for (const e of action.events) next = apply(next, e);
  const root = action.runs.find((r) => r.id === state.runId);
  if (root && root.status !== next.status) next = { ...next, status: root.status };
  let agents = next.agents;
  for (const r of action.runs) {
    if (r.parent_run_id !== state.runId) continue;
    const a = agents[r.id];
    if (a && a.status !== r.status) agents = { ...agents, [r.id]: { ...a, status: r.status } };
    else if (!a) agents = { ...agents, [r.id]: { id: r.id, title: r.title, status: r.status, steps: [] } };
  }
  return agents === next.agents ? next : { ...next, agents };
}

/** Subscribes to a run's live events (with its sub-agents), reconnecting until it finishes. */
export function useRunStream(runId: string | null, onFinished?: (run: LiveRun) => void) {
  const [run, dispatch] = useReducer(reducer, initialRun(runId ?? ""));
  const finishedRef = useRef(onFinished);
  finishedRef.current = onFinished;
  const runRef = useRef(run);
  runRef.current = run;

  useEffect(() => {
    if (!runId) return;
    dispatch({ type: "reset", runId });
    const controller = new AbortController();
    let cursor: Record<string, number> = {};
    let stopped = false;

    (async () => {
      let failures = 0;
      while (!stopped) {
        let ended = false;
        const openedAt = Date.now();
        try {
          const res = await fetch(`/api/runs/${runId}/stream?after=${encodeURIComponent(JSON.stringify(cursor))}`, { signal: controller.signal, cache: "no-store" });
          if (res.status === 401 || res.status === 404) {
            // The run (or chat) is gone: stop spinning and let the view reload.
            stopped = true;
            setTimeout(() => finishedRef.current?.(runRef.current), 30);
            break;
          }
          if (!res.ok || !res.body) throw new Error(`stream ${res.status}`);
          const reader = res.body.getReader();
          const decoder = new TextDecoder();
          let buffer = "";
          for (;;) {
            const { value, done } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            let idx: number;
            while ((idx = buffer.indexOf("\n\n")) >= 0) {
              const chunk = buffer.slice(0, idx);
              buffer = buffer.slice(idx + 2);
              if (chunk.startsWith("event: end")) {
                ended = true;
                continue;
              }
              const line = chunk.split("\n").find((l) => l.startsWith("data: "));
              if (!line) continue;
              try {
                const payload = JSON.parse(line.slice(6)) as { events: RawEvent[]; runs: RawRun[]; cursor: Record<string, number> };
                cursor = payload.cursor ?? cursor;
                dispatch({ type: "events", events: payload.events, runs: payload.runs });
              } catch {}
            }
          }
        } catch (err) {
          if (controller.signal.aborted) return;
          failures++;
          await new Promise((r) => setTimeout(r, Math.min(5000, 400 * 2 ** failures)));
          continue;
        }
        if (ended) {
          stopped = true;
          // Let React apply the last events before notifying.
          setTimeout(() => finishedRef.current?.(runRef.current), 30);
          break;
        }
        // A stream that closed quickly without finishing means the server hit an error: back off before reconnecting.
        if (!controller.signal.aborted && Date.now() - openedAt < 5_000) {
          failures++;
          await new Promise((r) => setTimeout(r, Math.min(8_000, 500 * 2 ** failures)));
        } else {
          failures = 0;
        }
      }
    })();

    return () => {
      stopped = true;
      controller.abort();
    };
  }, [runId]);

  return run;
}

/** The step whose text is the answer currently being written (not an interim note). */
export function liveAnswer(run: LiveRun): { text: string; step: number } | null {
  const steps = Object.keys(run.texts).map(Number).sort((a, b) => b - a);
  for (const s of steps) {
    if (run.interim[s]) continue;
    const text = run.texts[s];
    if (text?.trim()) return { text, step: s };
  }
  return null;
}
