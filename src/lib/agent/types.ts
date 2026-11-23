import type { ChatMessage } from "../llm";

export type Mode = "quick" | "standard" | "deep" | "marathon";
export type Effort = "auto" | Mode;
export type RunKind = "main" | "interview" | "sub" | "routine";

export type PlanItem = { title: string; status: "pending" | "in_progress" | "done" };
export type Source = { title: string; url: string };

export type Card =
  | { type: "calendar"; id: string; title: string; start: string; end?: string; location?: string; details?: string; url?: string; gcalUrl: string }
  | { type: "draft"; id: string; channel: "email" | "text" | "whatsapp" | "dm" | "other"; to?: string; subject?: string; body: string }
  | { type: "gmail_draft"; id: string; draftId: string; account: string; to: string; cc?: string; subject: string; body: string; threadId?: string; reply: boolean; status: "draft" | "sent" | "discarded" }
  | { type: "routine"; id: string; routineId: string; title: string; prompt: string; cadence: string; weekday?: number | null; status: "pending" | "approved" | "declined" }
  | { type: "document"; id: string; documentId: string; title: string }
  | { type: "goal"; id: string; goalId: string; title: string }
  | { type: "task"; id: string; taskId: string; title: string; due?: string | null }
  | { type: "pipeline"; id: string; people: number; jobs: number };

export type StepLog = { id: string; name: string; label: string; detail?: string; summary?: string; ok?: boolean; runId?: string };

export type RunState = {
  mode: Mode;
  messages: ChatMessage[];
  step: number;
  plan?: PlanItem[];
  sources: Source[];
  cards: Card[];
  steps: StepLog[];
  notes: string[];
  spawns: number;
  children?: { id: string; title: string; toolCallId: string }[];
  finished?: boolean;
  memoriesChanged?: boolean;
  forcedFinal?: boolean;
  triaged?: boolean;
  /** Total ms spent waiting on model rate limits (excluded from the time budget). */
  waitedMs?: number;
  /** Total time the model spent reasoning before answering or calling tools. */
  thinkMs?: number;
  startedAtMs?: number;
  /** Text for sub-agents: their assignment. */
  assignment?: string;
};

export type RunRow = {
  id: string;
  user_id: string;
  conversation_id: string | null;
  parent_run_id: string | null;
  kind: RunKind;
  title: string;
  effort: Effort;
  status: "queued" | "running" | "waiting" | "done" | "error" | "cancelled";
  state: RunState;
  result: string | null;
  error: string | null;
  seq: number;
  lease_id: string | null;
  lease_until: string | null;
  deadline_at: string | null;
  tokens_used: number;
  cancel_requested: boolean;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
};

export type RunEvent = { run_id: string; seq: number; type: string; data: Record<string, unknown>; created_at?: string };

export const MODES: Record<Mode, { maxSteps: number; budgetMs: number; subagents: boolean; maxAgents: number; maxSpawns: number; maxTokens: number; effort: "low" | "medium" | "high"; label: string }> = {
  quick: { maxSteps: 4, budgetMs: 2 * 60_000, subagents: false, maxAgents: 0, maxSpawns: 0, maxTokens: 1800, effort: "low", label: "Fast" },
  standard: { maxSteps: 12, budgetMs: 8 * 60_000, subagents: false, maxAgents: 0, maxSpawns: 0, maxTokens: 2800, effort: "medium", label: "Standard" },
  deep: { maxSteps: 24, budgetMs: 20 * 60_000, subagents: true, maxAgents: 4, maxSpawns: 2, maxTokens: 4000, effort: "medium", label: "Deep" },
  marathon: { maxSteps: 45, budgetMs: 45 * 60_000, subagents: true, maxAgents: 6, maxSpawns: 4, maxTokens: 5000, effort: "high", label: "Marathon" },
};

export const SUB_LIMITS = { maxSteps: 9, budgetMs: 8 * 60_000, maxTokens: 1400 };
