// Verifies users can't access each other's data. Usage: node --env-file=.env.local qa/isolation-check.mjs [base]
import { neon } from "@neondatabase/serverless";
const BASE = process.argv[2] || "https://tarrow.vercel.app";
const sql = neon(process.env.DATABASE_URL);
async function session(tag) {
  let cookie = "";
  const j = async (path, body, method) => {
    const r = await fetch(BASE + path, { method: method ?? (body ? "POST" : "GET"), headers: { "content-type": "application/json", cookie }, body: body ? JSON.stringify(body) : undefined });
    const s = r.headers.get("set-cookie"); if (s) cookie = s.split(";")[0];
    return { status: r.status, data: await r.json().catch(() => null) };
  };
  await j("/api/auth/signup", { email: `qa+${tag}${Date.now()}@tarrow.test`, password: "testpass123", name: tag });
  await j("/api/consent", { agree: true });
  await j("/api/onboarding/skip", {});
  return j;
}
const a = await session("a"), b = await session("b");
const aId = (await a("/api/me")).data.user.id;
const [conv] = await sql`insert into conversations (user_id, title) values (${aId}, 'secret') returning id`;
const [run] = await sql`insert into runs (user_id, conversation_id, status) values (${aId}, ${conv.id}, 'done') returning id`;
const [mem] = await sql`insert into memories (user_id, content) values (${aId}, 'secret fact') returning id`;
const [goal] = await sql`insert into goals (user_id, title) values (${aId}, 'secret goal') returning id`;
const [doc] = await sql`insert into documents (user_id, title, content) values (${aId}, 'secret doc', 'x') returning id`;
const checks = [
  ["GET conversation", await b(`/api/conversations/${conv.id}`)],
  ["DELETE conversation", await b(`/api/conversations/${conv.id}`, null, "DELETE")],
  ["stream run", await b(`/api/runs/${run.id}/stream`)],
  ["cancel run", await b(`/api/runs/${run.id}/cancel`, {}, "POST")],
  ["chat into conversation", await b(`/api/chat`, { conversationId: conv.id, text: "hi" })],
  ["PATCH memory", await b(`/api/memories/${mem.id}`, { content: "hacked" }, "PATCH")],
  ["GET document", await b(`/api/documents/${doc.id}`)],
  ["PATCH goal", await b(`/api/goals/${goal.id}`, { title: "hacked" }, "PATCH")],
];
for (const [name, r] of checks) console.log(name, r.status, JSON.stringify(r.data).slice(0, 60));
const [m2] = await sql`select content from memories where id = ${mem.id}`;
const [g2] = await sql`select title from goals where id = ${goal.id}`;
const [c2] = await sql`select id from conversations where id = ${conv.id}`;
console.log("memory intact:", m2.content === "secret fact", "goal intact:", g2.title === "secret goal", "conversation intact:", !!c2);
