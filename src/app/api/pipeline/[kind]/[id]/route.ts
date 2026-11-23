import { sql } from "@/lib/db";
import { authed, body, isUuid, json } from "@/lib/http";
import { isJobStatus, isPersonStatus } from "@/lib/pipeline";
import { hasPersonalFeatures } from "@/lib/personal";

type Ctx = { params: Promise<{ kind: string; id: string }> };

export const PATCH = authed<Ctx>(async (req, user, ctx) => {
  const { kind, id } = await ctx.params;
  if (!hasPersonalFeatures(user) || !isUuid(id) || !["people", "jobs"].includes(kind)) return json({ error: "Not found" }, 404);
  const b = await body<{ status?: string; draft?: string; pitch?: string; notes?: string }>(req);
  const text = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : null);
  if (kind === "people") {
    const status = isPersonStatus(b.status) ? String(b.status) : null;
    await sql`update contacts set status = coalesce(${status}, status), draft = coalesce(${text(b.draft, 2000)}, draft), notes = coalesce(${text(b.notes, 2000)}, notes), updated_at = now() where id = ${id} and user_id = ${user.id}`;
  } else {
    const status = isJobStatus(b.status) ? String(b.status) : null;
    await sql`update jobs set status = coalesce(${status}, status), pitch = coalesce(${text(b.pitch, 2000)}, pitch), updated_at = now() where id = ${id} and user_id = ${user.id}`;
  }
  return json({ ok: true });
});

export const DELETE = authed<Ctx>(async (_req, user, ctx) => {
  const { kind, id } = await ctx.params;
  if (!hasPersonalFeatures(user) || !isUuid(id) || !["people", "jobs"].includes(kind)) return json({ error: "Not found" }, 404);
  if (kind === "people") await sql`delete from contacts where id = ${id} and user_id = ${user.id}`;
  else await sql`delete from jobs where id = ${id} and user_id = ${user.id}`;
  return json({ ok: true });
});
