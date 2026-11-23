import { sql } from "@/lib/db";
import { authed, body, isUuid, json } from "@/lib/http";

type Ctx = { params: Promise<{ id: string }> };

export const PATCH = authed<Ctx>(async (req, user, ctx) => {
  const { id } = await ctx.params;
  if (!isUuid(id)) return json({ error: "Not found" }, 404);
  const b = await body<{ status?: string; title?: string }>(req);
  const status = b.status === "done" || b.status === "open" ? b.status : null;
  const title = typeof b.title === "string" && b.title.trim() ? b.title.trim().slice(0, 200) : null;
  await sql`update tasks set status = coalesce(${status}, status), title = coalesce(${title}, title),
    completed_at = case when ${status}::text = 'done' then now() when ${status}::text = 'open' then null else completed_at end
    where id = ${id} and user_id = ${user.id}`;
  return json({ ok: true });
});

export const DELETE = authed<Ctx>(async (_req, user, ctx) => {
  const { id } = await ctx.params;
  if (!isUuid(id)) return json({ error: "Not found" }, 404);
  await sql`delete from tasks where id = ${id} and user_id = ${user.id}`;
  return json({ ok: true });
});
