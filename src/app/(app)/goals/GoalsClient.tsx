"use client";

import { confirmDialog } from "@/components/Dialog";
import Link from "next/link";
import { useState } from "react";
import { Check, Plus, Sparkles, Target, Trash2 } from "lucide-react";
import { api } from "@/lib/client";
import { LocalTime } from "@/components/RelativeTime";

type Goal = { id: string; title: string; why: string | null; target_date: string | null; status: string; progress: number };
type Task = { id: string; goal_id: string | null; title: string; due_at: string | null; status: string; created_by: string };

export function GoalsClient({ initialGoals, initialTasks }: { initialGoals: Goal[]; initialTasks: Task[] }) {
  const [goals, setGoals] = useState(initialGoals);
  const [tasks, setTasks] = useState(initialTasks);
  const [newGoal, setNewGoal] = useState("");
  const [newTask, setNewTask] = useState("");
  const [error, setError] = useState("");

  const addGoal = async (e: React.FormEvent) => {
    e.preventDefault();
    const title = newGoal.trim();
    if (!title) return;
    setError("");
    try {
      const d = await api<{ goal: Goal }>("/api/goals", { body: { title } });
      setGoals((g) => [d.goal, ...g]);
      setNewGoal("");
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const addTask = async (e: React.FormEvent) => {
    e.preventDefault();
    const title = newTask.trim();
    if (!title) return;
    setError("");
    try {
      const d = await api<{ task: Task }>("/api/tasks", { body: { title } });
      setTasks((t) => [d.task, ...t]);
      setNewTask("");
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const setProgress = async (g: Goal, progress: number) => {
    const status = progress >= 100 ? "done" : "active";
    setGoals((all) => all.map((x) => (x.id === g.id ? { ...x, progress, status } : x)));
    await api(`/api/goals/${g.id}`, { method: "PATCH", body: { progress, status } }).catch(() => {});
  };

  const removeGoal = async (g: Goal) => {
    if (!(await confirmDialog({ title: `Delete goal "${g.title}"?`, confirmLabel: "Delete", danger: true }))) return;
    setGoals((all) => all.filter((x) => x.id !== g.id));
    await api(`/api/goals/${g.id}`, { method: "DELETE" }).catch(() => {});
  };

  const toggleTask = async (t: Task) => {
    const status = t.status === "done" ? "open" : "done";
    setTasks((all) => all.map((x) => (x.id === t.id ? { ...x, status } : x)));
    await api(`/api/tasks/${t.id}`, { method: "PATCH", body: { status } }).catch(() => {});
  };

  const removeTask = async (t: Task) => {
    setTasks((all) => all.filter((x) => x.id !== t.id));
    await api(`/api/tasks/${t.id}`, { method: "DELETE" }).catch(() => {});
  };

  const open = tasks.filter((t) => t.status === "open");
  const done = tasks.filter((t) => t.status === "done");

  return (
    <div className="mx-auto w-full max-w-[720px] px-4 pb-12 pt-4">
      {error && <p className="mb-3 rounded-2xl bg-neutral-100 px-4 py-2.5 text-[14px]">{error}</p>}

      <h2 className="mb-2.5 text-[15px] font-semibold">Goals</h2>
      <form onSubmit={addGoal} className="mb-3 flex gap-2">
        <input value={newGoal} onChange={(e) => setNewGoal(e.target.value)} placeholder="Add a goal" maxLength={200} className="min-w-0 flex-1 rounded-full border border-neutral-200 px-4 py-2.5 text-[15px] outline-none focus:border-neutral-900" />
        <button type="submit" disabled={!newGoal.trim()} aria-label="Add goal" className="press flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-neutral-900 text-white disabled:bg-neutral-200">
          <Plus className="h-5 w-5" />
        </button>
      </form>
      {goals.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-neutral-300 p-6 text-center">
          <Target className="mx-auto h-6 w-6 text-neutral-300" />
          <p className="mt-2 text-[14px] text-neutral-500">No goals yet.</p>
          <Link href={`/c/new?q=${encodeURIComponent("Help me set 2-3 concrete, measurable goals for the next 3 months based on what you know about me, then create them.")}`} className="press mt-3 inline-flex items-center gap-1.5 rounded-full bg-neutral-900 px-4 py-2 text-[13.5px] font-medium text-white">
            <Sparkles className="h-3.5 w-3.5" /> Set goals with Tarrow
          </Link>
        </div>
      ) : (
        <div className="space-y-2.5">
          {goals.map((g) => (
            <div key={g.id} className={`rounded-3xl border border-neutral-200 p-4 ${g.status === "done" ? "opacity-60" : ""}`}>
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <div className="text-[15.5px] font-semibold leading-snug">{g.title}</div>
                  {g.why && <div className="mt-0.5 text-[13.5px] text-neutral-500">{g.why}</div>}
                  {g.target_date && <div className="mt-0.5 text-[12.5px] text-neutral-400">By {String(g.target_date).slice(0, 10)}</div>}
                </div>
                <button type="button" onClick={() => removeGoal(g)} aria-label="Delete goal" className="press flex h-8 w-8 items-center justify-center rounded-full text-neutral-300 hover:bg-neutral-100 hover:text-neutral-700">
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
              <div className="mt-3 flex items-center gap-3">
                <input type="range" min={0} max={100} step={5} value={g.progress} onChange={(e) => setGoals((all) => all.map((x) => (x.id === g.id ? { ...x, progress: Number(e.target.value) } : x)))} onPointerUp={(e) => setProgress(g, Number((e.target as HTMLInputElement).value))} onKeyUp={(e) => setProgress(g, Number((e.target as HTMLInputElement).value))} aria-label="Progress" className="h-1.5 flex-1 cursor-pointer accent-neutral-900" />
                <span className="w-10 text-right text-[13px] tabular-nums text-neutral-500">{g.progress}%</span>
              </div>
              <div className="mt-2.5 flex flex-wrap gap-2">
                <Link href={`/c/new?q=${encodeURIComponent(`Help me make progress on my goal "${g.title}". Give me a concrete plan for the next 7 days and create the tasks.`)}`} className="press inline-flex items-center gap-1.5 rounded-full border border-neutral-200 px-3 py-1.5 text-[12.5px] font-medium hover:bg-neutral-50">
                  <Sparkles className="h-3 w-3" /> Plan next steps
                </Link>
              </div>
            </div>
          ))}
        </div>
      )}

      <h2 className="mb-2.5 mt-8 text-[15px] font-semibold">Tasks</h2>
      <form onSubmit={addTask} className="mb-3 flex gap-2">
        <input value={newTask} onChange={(e) => setNewTask(e.target.value)} placeholder="Add a task" maxLength={200} className="min-w-0 flex-1 rounded-full border border-neutral-200 px-4 py-2.5 text-[15px] outline-none focus:border-neutral-900" />
        <button type="submit" disabled={!newTask.trim()} aria-label="Add task" className="press flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-neutral-900 text-white disabled:bg-neutral-200">
          <Plus className="h-5 w-5" />
        </button>
      </form>
      {open.length === 0 && <p className="px-1 text-[14px] text-neutral-500">No open tasks.</p>}
      <div className="space-y-0.5">
        {[...open, ...done].map((t) => (
          <div key={t.id} className="group flex items-start gap-3 rounded-2xl px-2 py-2 hover:bg-neutral-50">
            <button type="button" onClick={() => toggleTask(t)} aria-label={t.status === "done" ? "Mark as not done" : "Mark as done"} className={`press mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-[1.5px] ${t.status === "done" ? "border-neutral-900 bg-neutral-900" : "border-neutral-300"}`}>
              {t.status === "done" && <Check className="h-3 w-3 text-white" strokeWidth={3} />}
            </button>
            <div className="min-w-0 flex-1">
              <div className={`text-[15px] leading-snug ${t.status === "done" ? "text-neutral-400 line-through" : ""}`}>{t.title}</div>
              <div className="text-[12px] text-neutral-400">
                {t.due_at && <LocalTime iso={t.due_at} options={{ weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }} />}
                {t.due_at && t.created_by === "tarrow" ? " · " : ""}
                {t.created_by === "tarrow" ? "added by Tarrow" : ""}
              </div>
            </div>
            <button type="button" onClick={() => removeTask(t)} aria-label="Delete task" className="press flex h-8 w-8 items-center justify-center rounded-full text-neutral-300 hover:bg-neutral-100 hover:text-neutral-700">
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
