"use client";

import { useEffect, useState } from "react";
import type { PlanItem, StepLog } from "@/lib/agent/types";
import { formatDuration } from "@/lib/client";
import type { LiveAgent, LiveRun, LiveStep } from "./useRunStream";

/** Claude Code-style tool names shown as `⏺ Name(args)`. */
const TOOL_NAMES: Record<string, string> = {
  web_search: "Search",
  read_page: "Fetch",
  find_places: "Maps",
  find_events: "Events",
  get_weather: "Weather",
  remember: "Remember",
  create_goal: "Goal",
  update_goal: "UpdateGoal",
  create_task: "Task",
  complete_task: "CompleteTask",
  update_plan: "Update Todos",
  save_document: "Write",
  calendar_event: "Calendar",
  draft_message: "Draft",
  schedule_routine: "Routine",
  finish_interview: "WrapUp",
  agent: "Agent",
};

const SPINNER = ["·", "✢", "✳", "✶", "✻", "✽", "✻", "✶", "✳", "✢"];

export function Spinner({ className = "" }: { className?: string }) {
  const [i, setI] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setI((n) => (n + 1) % SPINNER.length), 120);
    return () => clearInterval(t);
  }, []);
  return <span className={`inline-block w-[1ch] text-center ${className}`}>{SPINNER[i]}</span>;
}

export function Elapsed({ since, className = "" }: { since: number; className?: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  return (
    <span suppressHydrationWarning className={`tabular-nums ${className}`}>
      {formatDuration(now - since)}
    </span>
  );
}

/** `⏺` bullet: blinking while running, solid when done, dim when failed. */
export function Dot({ state = "done" }: { state?: "running" | "done" | "failed" }) {
  return (
    <span className="inline-block w-[2ch] shrink-0" aria-hidden="true">
      <span className={`mt-[0.62em] block h-[7px] w-[7px] rounded-full ${state === "running" ? "animate-pulse bg-t-dim" : state === "failed" ? "bg-t-faint" : "bg-t-inv"}`} />
    </span>
  );
}

function ToolLine({ step, indent = false }: { step: Pick<LiveStep, "name" | "label" | "detail" | "summary" | "ok" | "done">; indent?: boolean }) {
  const name = TOOL_NAMES[step.name] ?? step.label;
  const state = !step.done ? "running" : step.ok === false ? "failed" : "done";
  return (
    <div className={`fade-in ${indent ? "pl-[2ch]" : ""}`}>
      <div className="flex min-w-0">
        <Dot state={state} />
        <span className="min-w-0 break-words">
          <span className="font-bold text-t-strong">{name}</span>
          {step.detail ? <span className="t-dim">({step.detail})</span> : null}
        </span>
      </div>
      <div className="flex min-w-0 t-dim">
        <span className="inline-block w-[2ch] shrink-0" />
        <span className="shrink-0">└&nbsp;&nbsp;</span>
        <span className="min-w-0 break-words">{!step.done ? <span className="shimmer">{step.label}…</span> : step.summary || (step.ok === false ? "Failed" : "Done")}</span>
      </div>
    </div>
  );
}

export function PlanChecklist({ items }: { items: PlanItem[] }) {
  if (!items?.length) return null;
  return (
    <div className="fade-in">
      <div className="flex">
        <Dot state="done" />
        <span className="font-bold text-t-strong">Update Todos</span>
      </div>
      {items.map((item, i) => (
        <div key={i} className="flex min-w-0">
          <span className="inline-block w-[2ch] shrink-0" />
          <span className="shrink-0 t-dim">{i === 0 ? "└  " : "   "}</span>
          <span className={`min-w-0 break-words ${item.status === "done" ? "t-dim line-through" : item.status === "in_progress" ? "font-bold text-t-strong" : ""}`}>
            {item.status === "done" ? "☒" : "☐"} {item.title}
          </span>
        </div>
      ))}
    </div>
  );
}

function AgentBlock({ agent }: { agent: LiveAgent }) {
  const [open, setOpen] = useState(false);
  const running = !["done", "error", "cancelled"].includes(agent.status);
  const current = [...agent.steps].reverse().find((s) => !s.done);
  return (
    <div className="fade-in">
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex w-full min-w-0 text-left">
        <Dot state={running ? "running" : agent.status === "done" ? "done" : "failed"} />
        <span className="min-w-0 break-words">
          <span className="font-bold text-t-strong">Agent</span>
          <span className="t-dim">({agent.title})</span>
        </span>
      </button>
      <div className="flex min-w-0 t-dim">
        <span className="inline-block w-[2ch] shrink-0" />
        <span className="shrink-0">└&nbsp;&nbsp;</span>
        <span className="min-w-0 break-words">
          {running ? (
            <span className="shimmer">{current ? `${TOOL_NAMES[current.name] ?? current.label}(${current.detail ?? ""})` : agent.statusText || "Starting"}…</span>
          ) : (
            `${agent.status === "done" ? "Done" : agent.status} (${agent.steps.length} tool use${agent.steps.length === 1 ? "" : "s"})`
          )}
          {agent.steps.length > 0 && <span className="t-faint"> · {open ? "ctrl+r to collapse" : "click to expand"}</span>}
        </span>
      </div>
      {open && (
        <div className="pl-[4ch]">
          {agent.steps.map((s) => (
            <ToolLine key={s.id} step={s} />
          ))}
        </div>
      )}
    </div>
  );
}

/** `✻ Thought for 6s`, shown after each step where the model reasoned before acting. */
export function ThoughtLine({ ms }: { ms: number }) {
  return (
    <div className="flex t-dim fade-in">
      <span className="inline-block w-[2ch] shrink-0">✻</span>
      <span>Thought for {formatDuration(ms)}</span>
    </div>
  );
}

/** End-of-answer footer: `✻ Worked for 1m 3s · thought for 22s`. */
export function WorkedFor({ durationMs, thinkMs, onShare }: { durationMs?: number; thinkMs?: number; onShare?: () => Promise<"shared" | "copied" | "cancelled"> }) {
  const [copied, setCopied] = useState(false);
  const work = durationMs ?? 0;
  const think = thinkMs ?? 0;
  const timed = work >= 1000 || think >= 1000;
  if (!timed && !onShare) return null;
  return (
    <div className="flex t-dim">
      <span className="inline-block w-[2ch] shrink-0">✻</span>
      <span>
        {timed && (work >= 1000 ? `Worked for ${formatDuration(work)}` : `Thought for ${formatDuration(think)}`)}
        {work >= 1000 && think >= 1000 ? ` · thought for ${formatDuration(think)}` : ""}
        {onShare && (
          <>
            {timed ? " · " : ""}
            <button
              type="button"
              onClick={async () => {
                if ((await onShare()) === "copied") {
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                }
              }}
              className="underline decoration-t-edge underline-offset-4 hover:text-t-strong"
            >
              {copied ? "copied" : "share"}
            </button>
          </>
        )}
      </span>
    </div>
  );
}

/** Live transcript of a running agent: tool calls, notes, sub-agents, todos and the spinner line. */
export function LiveActivity({ run, startedAt }: { run: LiveRun; startedAt: number }) {
  const finished = !!run.done || !!run.error;
  const reasoningTail = (() => {
    const r = run.reasoning[run.lastStep];
    if (!r || run.texts[run.lastStep]) return "";
    const clean = r.replace(/\s+/g, " ").trim();
    return clean.length > 160 ? "…" + clean.slice(-160) : clean;
  })();

  return (
    <div className="space-y-2">
      {run.timeline.map((item, i) => {
        if (item.kind === "step") {
          const s = run.steps[item.id];
          return s ? <ToolLine key={item.id} step={s} /> : null;
        }
        if (item.kind === "thought") return <ThoughtLine key={`t${i}`} ms={item.ms} />;
        if (item.kind === "note") {
          return (
            <div key={`n${i}`} className="flex min-w-0 fade-in">
              <Dot state="done" />
              <span className="min-w-0 whitespace-pre-wrap break-words">{run.texts[item.step]}</span>
            </div>
          );
        }
        return (
          <div key={`a${i}`} className="space-y-2">
            {item.ids.map((id) => (run.agents[id] ? <AgentBlock key={id} agent={run.agents[id]} /> : null))}
          </div>
        );
      })}
      {run.plan && <PlanChecklist items={run.plan} />}
      {!finished && (
        <div className="pt-1">
          <div className="flex min-w-0 flex-wrap items-baseline">
            <Spinner className="mr-[1ch] text-t-strong" />
            <span className="shimmer font-bold">{reasoningTail && !/capacity|waiting/i.test(run.statusText) ? "Thinking" : run.statusText || "Thinking"}…</span>
            <span className="ml-[1ch] t-dim">
              (<Elapsed since={startedAt} />
              {run.modeLabel ? ` · ${run.modeLabel.toLowerCase()}` : ""} · <span className="hidden sm:inline">esc to interrupt</span>
              <span className="sm:hidden">tap ■ to stop</span>)
            </span>
          </div>
          {reasoningTail && <p className="line-clamp-2 pl-[2ch] italic t-faint">{reasoningTail}</p>}
        </div>
      )}
    </div>
  );
}

/** Finished run: tool lines stay in the transcript (collapsed past a few), like a terminal scrollback. */
export function ActivitySummary({ steps, plan }: { steps: StepLog[]; plan?: PlanItem[]; mode?: string }) {
  const [open, setOpen] = useState(false);
  if (!steps.length) return null;
  const shown = open ? steps : steps.slice(-3);
  const hidden = steps.length - shown.length;
  return (
    <div className="space-y-2">
      {hidden > 0 && (
        <button type="button" onClick={() => setOpen(true)} className="flex t-dim hover:text-t-strong">
          <Dot state="failed" />
          <span>+{hidden} more tool use{hidden === 1 ? "" : "s"} (click to expand)</span>
        </button>
      )}
      {shown.map((s) => (
        <ToolLine key={s.id} step={{ ...s, done: true, label: s.label }} />
      ))}
      {open && plan && <PlanChecklist items={plan} />}
    </div>
  );
}
