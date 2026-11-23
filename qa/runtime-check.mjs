// Runtime edge cases against a dev server running on the mock LLM (qa/mock-llm.mjs).
// Usage: node --env-file=.env.local qa/runtime-check.mjs [base]
import { neon } from "@neondatabase/serverless";
const BASE = process.argv[2] || "http://localhost:3000";
const sql = neon(process.env.DATABASE_URL);
let cookie = "";
const j = async (path, body, method) => {
  const r = await fetch(BASE + path, { method: method ?? (body ? "POST" : "GET"), headers: { "content-type": "application/json", cookie }, body: body ? JSON.stringify(body) : undefined });
  const s = r.headers.get("set-cookie"); if (s) cookie = s.split(";")[0];
  return { status: r.status, data: await r.json().catch(() => null) };
};
const waitStatus = async (runId, statuses, ms = 60000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const [r] = await sql`select status from runs where id = ${runId}`;
    if (statuses.includes(r.status)) return r.status;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`timeout waiting for ${statuses} on ${runId}`);
};
const results = [];
const check = (name, ok, extra = "") => results.push(`${ok ? "PASS" : "FAIL"} ${name} ${extra}`);

await j("/api/auth/signup", { email: `qa+rc${Date.now()}@tarrow.test`, password: "testpass123", name: "RC", timezone: "America/New_York" });

await j("/api/consent", { agree: true });
await j("/api/onboarding/skip", {});

// 1. Tool creates a task with a naive local time across DST (Nov 10 is EST, -05:00).
const t1 = await j("/api/chat", { text: "please add a task", effort: "standard" });
await waitStatus(t1.data.runId, ["done"]);
const [task] = await sql`select due_at from tasks where title = 'Mock task from agent' order by created_at desc limit 1`;
check("DST-correct due time", task && new Date(task.due_at).toISOString() === "2026-11-11T00:00:00.000Z", task && new Date(task.due_at).toISOString());

// 2. Cancel a slow standard run: exactly one assistant message.
const t2 = await j("/api/chat", { conversationId: t1.data.conversationId, text: "slow one", effort: "standard" });
await new Promise((r) => setTimeout(r, 1500));
await j(`/api/runs/${t2.data.runId}/cancel`, {}, "POST");
const s2 = await waitStatus(t2.data.runId, ["cancelled", "done"]);
await new Promise((r) => setTimeout(r, 5000));
const m2 = await sql`select count(*)::int n from messages where run_id = ${t2.data.runId} and role = 'assistant'`;
check("cancel slow run", s2 === "cancelled" && m2[0].n === 1, `status=${s2} messages=${m2[0].n}`);

// 3. Cancel a deep run while sub-agents are working: one message, children cancelled, no wake-up duplicate.
const t3 = await j("/api/chat", { text: "deep research with agents", effort: "deep" });
const end = Date.now() + 20000;
while (Date.now() < end) {
  const [r] = await sql`select status from runs where id = ${t3.data.runId}`;
  if (r.status === "waiting") break;
  await new Promise((r) => setTimeout(r, 200));
}
await j(`/api/runs/${t3.data.runId}/cancel`, {}, "POST");
await waitStatus(t3.data.runId, ["cancelled", "done"]);
await new Promise((r) => setTimeout(r, 8000));
const m3 = await sql`select count(*)::int n from messages where run_id = ${t3.data.runId} and role = 'assistant'`;
const [p3] = await sql`select status from runs where id = ${t3.data.runId}`;
check("cancel waiting parent", m3[0].n === 1 && p3.status === "cancelled", `status=${p3.status} messages=${m3[0].n}`);

// 4. Routine "run now" claims and starts a run.
const me = (await j("/api/me")).data.user;
const [rt] = await sql`insert into routines (user_id, title, prompt, cadence, weekday, next_run_at, active) values (${me.id}, 'Mock routine', 'give me the mock answer', 'weekly', 1, now() + interval '3 days', true) returning id`;
const rn = await j(`/api/routines/${rt.id}`, { action: "run_now" }, "PATCH");
const [rrow] = await sql`select next_run_at, last_run_at, conversation_id from routines where id = ${rt.id}`;
const runs = rrow.conversation_id ? await sql`select id, status from runs where conversation_id = ${rrow.conversation_id}` : [];
check("routine run_now", rn.status === 200 && runs.length === 1 && new Date(rrow.next_run_at) > new Date(), `runs=${runs.length} next=${rrow.next_run_at?.toISOString?.()}`);
if (runs[0]) check("routine run finishes", (await waitStatus(runs[0].id, ["done"])) === "done");

// 5. Stream of a finished run ends with a done event.
const res = await fetch(`${BASE}/api/runs/${t1.data.runId}/stream`, { headers: { cookie } });
const text = await res.text();
check("stream replays done + end", text.includes('"type":"done"') && text.includes("event: end"));

console.log(results.join("\n"));
