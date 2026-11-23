import "server-only";
import { sql } from "../db";
import type { User } from "../auth";

export const MEMORY_CATEGORIES = ["identity", "work", "money", "goals", "blockers", "people", "health", "routine", "interests", "preferences", "other"] as const;
export type MemoryCategory = (typeof MEMORY_CATEGORIES)[number];

export const INTERVIEW_AREAS: { key: MemoryCategory; label: string }[] = [
  { key: "identity", label: "You" },
  { key: "work", label: "Work" },
  { key: "money", label: "Money" },
  { key: "goals", label: "Goals" },
  { key: "blockers", label: "Blockers" },
  { key: "people", label: "People" },
  { key: "health", label: "Health" },
  { key: "interests", label: "Interests" },
];

export function nowLine(tz: string) {
  const d = new Date();
  let zone = tz;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
  } catch {
    zone = "America/New_York";
  }
  const fmt = new Intl.DateTimeFormat("en-US", { timeZone: zone, weekday: "long", year: "numeric", month: "long", day: "numeric", hour: "numeric", minute: "2-digit" });
  return `${fmt.format(d)} (${zone})`;
}

/** UTC instant for a wall-clock time in a timezone, correct across DST changes. */
export function zonedDate(y: number, m: number, d: number, hh: number, mm: number, tz: string): Date {
  const offsetAt = (utcMs: number) => {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(utcMs));
    const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
    return Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute")) - utcMs;
  };
  const wall = Date.UTC(y, m - 1, d, hh, mm);
  let utc = wall - offsetAt(wall);
  utc = wall - offsetAt(utc);
  return new Date(utc);
}

export function formatInTz(iso: string | Date, tz: string) {
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(iso));
  } catch {
    return new Date(iso).toISOString();
  }
}

/** Offset like -04:00 for a timezone right now, so the model can write correct ISO datetimes. */
export function tzOffset(tz: string) {
  try {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "longOffset" }).formatToParts(new Date());
    const name = parts.find((p) => p.type === "timeZoneName")?.value ?? "GMT";
    const m = name.match(/GMT([+-]\d{2}):?(\d{2})?/);
    return m ? `${m[1]}:${m[2] ?? "00"}` : "+00:00";
  } catch {
    return "-04:00";
  }
}

export type UserContext = {
  lifeFile: string;
  memories: { id: string; category: string; content: string }[];
  goals: { id: string; title: string; progress: number; target_date: string | null }[];
  tasks: { id: string; title: string; due_at: string | null }[];
  /** Tarrow's closing read + recommendations from the onboarding interview, so later advice stays consistent. */
  interviewWrap: string;
  /** Pipeline counts by status, so the agent knows what's already in motion. */
  pipeline: { people: Record<string, number>; jobs: Record<string, number> };
};

export async function loadUserContext(userId: string): Promise<UserContext> {
  const [user, memories, goals, tasks, wrap, people, jobs] = await Promise.all([
    sql`select life_file from users where id = ${userId}`,
    sql`select id, category, content from memories where user_id = ${userId} order by updated_at desc limit 60`,
    sql`select id, title, progress, target_date from goals where user_id = ${userId} and status = 'active' order by created_at limit 8`,
    sql`select id, title, due_at from tasks where user_id = ${userId} and status = 'open' order by due_at nulls last, created_at limit 10`,
    sql`
      select m.content from messages m
      join runs r on r.id = m.run_id
      join users u on u.id = ${userId} and u.interview_conversation_id = r.conversation_id
      where m.role = 'assistant' and r.state->>'finished' = 'true'
      order by m.created_at desc limit 1`,
    sql`select status, count(*)::int as n from contacts where user_id = ${userId} group by status`,
    sql`select status, count(*)::int as n from jobs where user_id = ${userId} group by status`,
  ]);
  return {
    lifeFile: (user[0]?.life_file as string) ?? "",
    memories: memories as UserContext["memories"],
    goals: goals as UserContext["goals"],
    tasks: tasks as UserContext["tasks"],
    interviewWrap: String(wrap[0]?.content ?? "").replace(/You're all set[^\n]*$/i, "").trim().slice(0, 1400),
    pipeline: {
      people: Object.fromEntries(people.map((r) => [String(r.status), Number(r.n)])),
      jobs: Object.fromEntries(jobs.map((r) => [String(r.status), Number(r.n)])),
    },
  };
}

const short = (id: string) => id.slice(0, 8);

export function renderUserContext(user: User, ctx: UserContext, opts: { lifeFileChars?: number; memoryChars?: number } = {}) {
  const lines: string[] = [];
  lines.push(`Name: ${user.name ?? "unknown"}${user.city ? ` · Lives in: ${user.city}` : ""}`);
  const life = ctx.lifeFile.trim();
  lines.push("(Everything you know about them is below. If a detail isn't here or in the conversation, you don't know it.)");
  if (life) lines.push(`\n### Life file (your running notes on them)\n${life.slice(0, opts.lifeFileChars ?? 2600)}`);
  // Memories newer than the life file matter most; the life file already summarizes older ones.
  const memBudget = opts.memoryChars ?? (life ? 1400 : 3000);
  const mem: string[] = [];
  let used = 0;
  for (const m of ctx.memories) {
    const line = `- (${m.category}) ${m.content}`;
    if (used + line.length > memBudget) break;
    mem.push(line);
    used += line.length;
  }
  if (mem.length) lines.push(`\n### Recent memories\n${mem.join("\n")}`);
  if (ctx.goals.length) lines.push(`\n### Active goals\n${ctx.goals.map((g) => `- [goal ${short(g.id)}] ${g.title} — ${g.progress}%${g.target_date ? ` by ${String(g.target_date).slice(0, 10)}` : ""}`).join("\n")}`);
  const counts = (c: Record<string, number>) => Object.entries(c).map(([k, n]) => `${n} ${k.replace(/_/g, " ")}`).join(", ");
  if (Object.keys(ctx.pipeline?.people ?? {}).length || Object.keys(ctx.pipeline?.jobs ?? {}).length) {
    lines.push(`\n### Pipeline\nPeople: ${counts(ctx.pipeline.people) || "none"} · Jobs: ${counts(ctx.pipeline.jobs) || "none"}`);
  }
  if (user.resume?.trim()) lines.push(`\n### Resume (they pasted it)\n${user.resume.trim().slice(0, opts.lifeFileChars ? 1200 : 2400)}`);
  if (ctx.tasks.length) lines.push(`\n### Open tasks\n${ctx.tasks.map((t) => `- [task ${short(t.id)}] ${t.title}${t.due_at ? ` (due ${formatInTz(t.due_at, user.timezone)})` : ""}`).join("\n")}`);
  return lines.join("\n");
}

export const STYLE_TEXT: Record<string, string> = {
  direct: "Be direct and blunt like a smart friend. No fluff, no flattery, no lectures. Casual tone is fine.",
  warm: "Be warm and encouraging, but still concrete and honest.",
  coach: "Be a demanding coach: push them, hold them accountable, call out excuses kindly but firmly.",
  analytical: "Be analytical and structured: tradeoffs, numbers, clear reasoning.",
};
