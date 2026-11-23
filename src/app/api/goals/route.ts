import { sql } from "@/lib/db";
import { authed, body, HttpError, json } from "@/lib/http";

export const GET = authed(async (_req, user) => {
  const goals = await sql`select id, title, why, target_date, status, progress, created_at from goals where user_id = ${user.id} order by status = 'active' desc, created_at desc`;
  const tasks = await sql`select id, goal_id, title, notes, due_at, status, created_by, created_at, completed_at from tasks where user_id = ${user.id} and (status = 'open' or completed_at > now() - interval '7 days') order by status desc, due_at nulls last, created_at desc`;
  return json({ goals, tasks });
});

export const POST = authed(async (req, user) => {
  const b = await body<{ title?: string; why?: string; target_date?: string }>(req);
  const title = String(b.title ?? "").trim().slice(0, 200);
  if (!title) throw new HttpError(400, "Give the goal a title");
  const target = /^\d{4}-\d{2}-\d{2}$/.test(String(b.target_date ?? "")) ? b.target_date : null;
  const rows = await sql`insert into goals (user_id, title, why, target_date) values (${user.id}, ${title}, ${String(b.why ?? "").slice(0, 500) || null}, ${target}) returning id, title, why, target_date, status, progress, created_at`;
  return json({ goal: rows[0] });
});
