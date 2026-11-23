import { after } from "next/server";
import { sql } from "@/lib/db";
import { authed, body, isUuid, json } from "@/lib/http";
import { rebuildLifeFile } from "@/lib/agent/memory";

type Ctx = { params: Promise<{ id: string }> };

export const PATCH = authed<Ctx>(async (req, user, ctx) => {
  const { id } = await ctx.params;
  const b = await body<{ content?: string }>(req);
  const content = String(b.content ?? "").trim().slice(0, 400);
  if (!isUuid(id) || content.length < 3) return json({ error: "Bad request" }, 400);
  await sql`update memories set content = ${content}, updated_at = now() where id = ${id} and user_id = ${user.id}`;
  after(() => rebuildLifeFile(user.id).catch(() => {}));
  return json({ ok: true });
});

export const DELETE = authed<Ctx>(async (_req, user, ctx) => {
  const { id } = await ctx.params;
  if (!isUuid(id)) return json({ error: "Not found" }, 404);
  await sql`delete from memories where id = ${id} and user_id = ${user.id}`;
  after(() => rebuildLifeFile(user.id).catch(() => {}));
  return json({ ok: true });
});
