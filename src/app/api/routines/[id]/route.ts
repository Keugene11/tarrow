import { sql } from "@/lib/db";
import { authed, body, isUuid, json } from "@/lib/http";
import { nextRunAt } from "@/lib/agent/routines";
import { limitsFor } from "@/lib/billing";

type Ctx = { params: Promise<{ id: string }> };

async function setCardStatus(userId: string, routineId: string, status: "approved" | "declined") {
  const rows = await sql`select id, meta from messages where user_id = ${userId} and role = 'assistant' and meta::text like ${`%${routineId}%`} limit 5`;
  for (const row of rows) {
    const meta = row.meta as { cards?: { type: string; routineId?: string; status?: string }[] };
    let changed = false;
    for (const card of meta.cards ?? []) {
      if (card.type === "routine" && card.routineId === routineId) {
        card.status = status;
        changed = true;
      }
    }
    if (changed) await sql`update messages set meta = ${JSON.stringify(meta)}::jsonb where id = ${row.id}`;
  }
}

export const PATCH = authed<Ctx>(async (req, user, ctx) => {
  const { id } = await ctx.params;
  if (!isUuid(id)) return json({ error: "Not found" }, 404);
  const b = await body<{ action?: string }>(req);
  const rows = await sql`select * from routines where id = ${id} and user_id = ${user.id}`;
  const r = rows[0];
  if (!r) return json({ error: "Not found" }, 404);
  if ((b.action === "approve" || b.action === "resume" || b.action === "run_now") && !r.active) {
    const [{ plan, limits, guest }, active] = await Promise.all([limitsFor(user.id), sql`select count(*)::int as n from routines where user_id = ${user.id} and active`]);
    if (guest) return json({ error: "Sign up to turn on routines. Your interview and chats come with you.", code: "signup" }, 403);
    if (Number(active[0]?.n ?? 0) >= limits.routines) {
      return json({ error: plan === "free" ? "Free includes 1 active routine. Pause it or upgrade to Pro for up to 20." : `You can have up to ${limits.routines} active routines.`, code: plan === "free" ? "pro_required" : "limit" }, 402);
    }
  }
  if (b.action === "approve" || b.action === "resume") {
    const next = nextRunAt(String(r.cadence), r.weekday as number | null, user.timezone);
    await sql`update routines set active = true, next_run_at = ${next.toISOString()} where id = ${id}`;
    if (b.action === "approve") await setCardStatus(user.id, id, "approved");
    return json({ ok: true, next_run_at: next.toISOString() });
  }
  if (b.action === "decline") {
    await sql`delete from routines where id = ${id}`;
    await setCardStatus(user.id, id, "declined");
    return json({ ok: true });
  }
  if (b.action === "pause") {
    await sql`update routines set active = false where id = ${id}`;
    return json({ ok: true });
  }
  if (b.action === "run_now") {
    await sql`update routines set active = true, next_run_at = now() where id = ${id}`;
    const { runDueRoutines } = await import("@/lib/agent/routines");
    await runDueRoutines(user.id);
    const c = await sql`select conversation_id from routines where id = ${id}`;
    return json({ ok: true, conversationId: c[0]?.conversation_id ?? null });
  }
  return json({ error: "Unknown action" }, 400);
});

export const DELETE = authed<Ctx>(async (_req, user, ctx) => {
  const { id } = await ctx.params;
  if (!isUuid(id)) return json({ error: "Not found" }, 404);
  await sql`delete from routines where id = ${id} and user_id = ${user.id}`;
  return json({ ok: true });
});
