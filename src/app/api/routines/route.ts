import { sql } from "@/lib/db";
import { authed, json } from "@/lib/http";

export const GET = authed(async (_req, user) => {
  const routines = await sql`select id, title, prompt, cadence, weekday, next_run_at, last_run_at, active, conversation_id, created_at from routines where user_id = ${user.id} order by created_at desc`;
  return json({ routines });
});
