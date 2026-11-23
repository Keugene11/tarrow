import { sql } from "@/lib/db";
import { authed, body, isUuid, json } from "@/lib/http";

type Ctx = { params: Promise<{ id: string }> };

export const GET = authed<Ctx>(async (_req, user, ctx) => {
  const { id } = await ctx.params;
  if (!isUuid(id)) return json({ error: "Not found" }, 404);
  const conv = await sql`select id, title, kind, updated_at from conversations where id = ${id} and user_id = ${user.id}`;
  if (!conv.length) return json({ error: "Not found" }, 404);
  const messages = await sql`select id, role, content, run_id, meta, created_at from messages where conversation_id = ${id} order by created_at limit 500`;
  const active = await sql`select id, status, effort, created_at, started_at from runs where conversation_id = ${id} and parent_run_id is null and status in ('queued','running','waiting') order by created_at desc limit 1`;
  return json({ conversation: conv[0], messages, activeRun: active[0] ?? null });
});

export const PATCH = authed<Ctx>(async (req, user, ctx) => {
  const { id } = await ctx.params;
  const b = await body<{ title?: string }>(req);
  const title = String(b.title ?? "").trim().slice(0, 80);
  if (!isUuid(id) || !title) return json({ error: "Bad request" }, 400);
  await sql`update conversations set title = ${title} where id = ${id} and user_id = ${user.id}`;
  return json({ ok: true });
});

export const DELETE = authed<Ctx>(async (_req, user, ctx) => {
  const { id } = await ctx.params;
  if (!isUuid(id)) return json({ error: "Not found" }, 404);
  await sql`update runs set cancel_requested = true where conversation_id = ${id} and user_id = ${user.id} and status in ('queued','running','waiting')`;
  await sql`delete from conversations where id = ${id} and user_id = ${user.id} and kind <> 'interview'`;
  return json({ ok: true });
});
