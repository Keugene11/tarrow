import { sql } from "@/lib/db";
import { authed, isUuid, json } from "@/lib/http";

type Ctx = { params: Promise<{ id: string }> };

export const GET = authed<Ctx>(async (_req, user, ctx) => {
  const { id } = await ctx.params;
  if (!isUuid(id)) return json({ error: "Not found" }, 404);
  const rows = await sql`select id, title, content, created_at, updated_at from documents where id = ${id} and user_id = ${user.id}`;
  if (!rows.length) return json({ error: "Not found" }, 404);
  return json({ document: rows[0] });
});

export const DELETE = authed<Ctx>(async (_req, user, ctx) => {
  const { id } = await ctx.params;
  if (!isUuid(id)) return json({ error: "Not found" }, 404);
  await sql`delete from documents where id = ${id} and user_id = ${user.id}`;
  return json({ ok: true });
});
