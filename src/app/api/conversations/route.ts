import { after } from "next/server";
import { sql } from "@/lib/db";
import { authed, json } from "@/lib/http";
import { sweepStale } from "@/lib/agent/runtime";
import { runDueRoutines } from "@/lib/agent/routines";

export const GET = authed(async (_req, user) => {
  // The app shell calls this on every navigation, which makes it a cheap watchdog for the user's runs.
  after(async () => {
    try {
      await sweepStale(user.id);
      await runDueRoutines(user.id);
    } catch (err) {
      console.warn("sweep failed", err);
    }
  });
  const rows = await sql`
    select c.id, c.title, c.kind, c.updated_at,
      (select status from runs r where r.conversation_id = c.id and r.parent_run_id is null order by created_at desc limit 1) as last_status
    from conversations c where c.user_id = ${user.id}
    order by c.updated_at desc limit 100`;
  return json({ conversations: rows });
});
