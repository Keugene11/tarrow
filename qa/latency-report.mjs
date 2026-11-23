// Where do the seconds go? Timeline of recent main/interview runs from run_events (no model calls).
// Usage: node --env-file=.env.local qa/latency-report.mjs [limit]
import { neon } from "@neondatabase/serverless";

const sql = neon(process.env.DATABASE_URL);
const limit = Number(process.argv[2] || 25);

const runs = await sql`
  select id, kind, effort, status, state->>'mode' as mode, created_at, updated_at
  from runs where parent_run_id is null and kind in ('main', 'interview')
  order by created_at desc limit ${limit}`;

const sec = (a, b) => (a && b ? ((new Date(b) - new Date(a)) / 1000).toFixed(1) : "-");
console.log("kind       effort/mode        status  first_evt  mode_set  first_llm_out  first_answer  total");
for (const r of runs) {
  const ev = await sql`select type, data, created_at from run_events where run_id = ${r.id} order by seq`;
  const first = ev[0]?.created_at;
  const modeSet = ev.find((e) => e.type === "mode")?.created_at;
  const firstOut = ev.find((e) => ["reasoning", "delta", "thought", "tool_start"].includes(e.type))?.created_at;
  const firstAnswer = ev.find((e) => e.type === "delta")?.created_at;
  const done = ev.find((e) => e.type === "done")?.created_at ?? r.updated_at;
  console.log(
    [
      r.kind.padEnd(10),
      `${r.effort}/${r.mode}`.padEnd(18),
      String(r.status).padEnd(7),
      sec(r.created_at, first).padStart(9),
      sec(r.created_at, modeSet).padStart(9),
      sec(r.created_at, firstOut).padStart(14),
      sec(r.created_at, firstAnswer).padStart(13),
      sec(r.created_at, done).padStart(6),
    ].join(" "),
  );
}
