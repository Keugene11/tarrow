import { sql } from "@/lib/db";
import { authed, isUuid, json } from "@/lib/http";

type Ctx = { params: Promise<{ id: string }> };

export const DELETE = authed<Ctx>(async (_req, user, ctx) => {
  const { id } = await ctx.params;
  if (!isUuid(id)) return json({ error: "Not found" }, 404);
  await sql`update suggestions set dismissed = true where id = ${id} and user_id = ${user.id}`;
  return json({ ok: true });
});
