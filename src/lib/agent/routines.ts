import "server-only";
import { sql } from "../db";
import { getUserById } from "../auth";
import { createRun, kick } from "./runtime";

function localParts(date: Date, tz: string) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", weekday: "short", hour: "2-digit", hourCycle: "h23" }).formatToParts(date);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return { y: Number(get("year")), m: Number(get("month")), d: Number(get("day")), weekday: weekdays.indexOf(get("weekday")), hour: Number(get("hour")) };
}

/** UTC instant for a local wall-clock time in tz. */
function zonedTime(y: number, m: number, d: number, hour: number, tz: string) {
  const guess = new Date(Date.UTC(y, m - 1, d, hour));
  const p = localParts(guess, tz);
  const shownAsUtc = Date.UTC(p.y, p.m - 1, p.d, p.hour);
  return new Date(guess.getTime() - (shownAsUtc - guess.getTime()));
}

/** Next 8am local run strictly after `from`, matching weekday for weekly routines. */
export function nextRunAt(cadence: string, weekday: number | null, tz: string, from = new Date()) {
  let zone = tz;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
  } catch {
    zone = "America/New_York";
  }
  for (let i = 0; i <= 8; i++) {
    const day = new Date(from.getTime() + i * 864e5);
    const p = localParts(day, zone);
    const at = zonedTime(p.y, p.m, p.d, 8, zone);
    if (at <= from) continue;
    if (cadence === "weekly" && weekday != null && p.weekday !== weekday) continue;
    return at;
  }
  return new Date(from.getTime() + (cadence === "daily" ? 1 : 7) * 864e5);
}

export async function runDueRoutines(userId?: string) {
  const due = userId
    ? await sql`select * from routines where active and next_run_at <= now() and user_id = ${userId} limit 5`
    : await sql`select * from routines where active and next_run_at <= now() order by next_run_at limit 25`;
  for (const r of due) {
    // Claim it first so concurrent callers don't double-run.
    const user = await getUserById(r.user_id as string);
    if (!user) continue;
    const next = nextRunAt(String(r.cadence), r.weekday as number | null, user.timezone);
    const claimed = await sql`update routines set next_run_at = ${next.toISOString()}, last_run_at = now() where id = ${r.id} and active and next_run_at <= now() returning id`;
    if (!claimed.length) continue;
    let conversationId = r.conversation_id as string | null;
    if (conversationId) {
      const exists = await sql`select id from conversations where id = ${conversationId}`;
      if (!exists.length) conversationId = null;
    }
    if (!conversationId) {
      const c = await sql`insert into conversations (user_id, kind, title) values (${user.id}, 'routine', ${`Routine: ${r.title}`}) returning id`;
      conversationId = c[0].id as string;
      await sql`update routines set conversation_id = ${conversationId} where id = ${r.id}`;
    }
    const { runId } = await createRun({ user, conversationId, text: `Routine run: ${r.prompt}`, effort: "standard", kind: "routine", title: String(r.title) });
    await kick(runId);
  }
  return due.length;
}
