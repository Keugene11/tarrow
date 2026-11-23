import { sql } from "@/lib/db";
import { authed, body, isUuid, json } from "@/lib/http";

type Ctx = { params: Promise<{ id: string }> };

export const PATCH = authed<Ctx>(async (req, user, ctx) => {
  const { id } = await ctx.params;
  if (!isUuid(id)) return json({ error: "Not found" }, 404);
  const b = await body<{ title?: string; progress?: number; status?: string }>(req);
  const progress = typeof b.progress === "number" && Number.isFinite(b.progress) ? Math.max(0, Math.min(100, Math.round(b.progress))) : null;
  const status = ["active", "done", "dropped"].includes(String(b.status)) ? String(b.status) : null;
  const title = typeof b.title === "string" && b.title.trim() ? b.title.trim().slice(0, 200) : null;
  await sql`update goals set progress = coalesce(${progress}, progress), status = coalesce(${status}, status), title = coalesce(${title}, title), updated_at = now() where id = ${id} and user_id = ${user.id}`;
  return json({ ok: true });
});

export const DELETE = authed<Ctx>(async (_req, user, ctx) => {
  const { id } = await ctx.params;
  if (!isUuid(id)) return json({ error: "Not found" }, 404);
  await sql`delete from goals where id = ${id} and user_id = ${user.id}`;
  return json({ ok: true });
});
