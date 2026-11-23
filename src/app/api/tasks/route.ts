import { sql } from "@/lib/db";
import { authed, body, HttpError, isUuid, json } from "@/lib/http";

export const POST = authed(async (req, user) => {
  const b = await body<{ title?: string; due_at?: string; goal_id?: string }>(req);
  const title = String(b.title ?? "").trim().slice(0, 200);
  if (!title) throw new HttpError(400, "Task needs a title");
  const due = b.due_at && !Number.isNaN(new Date(b.due_at).getTime()) ? new Date(b.due_at).toISOString() : null;
  let goalId: string | null = null;
  if (isUuid(b.goal_id)) {
    const g = await sql`select id from goals where id = ${b.goal_id} and user_id = ${user.id}`;
    goalId = (g[0]?.id as string) ?? null;
  }
  const rows = await sql`insert into tasks (user_id, goal_id, title, due_at) values (${user.id}, ${goalId}, ${title}, ${due}) returning id, goal_id, title, notes, due_at, status, created_by, created_at, completed_at`;
  return json({ task: rows[0] });
});
