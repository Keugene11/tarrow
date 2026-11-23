// After finishing the interview, it must stay reachable and coming back must not wrap it up again.
// Run against the mock LLM. Usage: node qa/interview-continue-check.mjs [base]
const BASE = process.argv[2] || "http://localhost:3000";
let cookie = "";
let failed = 0;

async function j(path, body, method = body ? "POST" : "GET") {
  const res = await fetch(BASE + path, { method, headers: { "Content-Type": "application/json", cookie }, body: body ? JSON.stringify(body) : undefined });
  const set = res.headers.get("set-cookie");
  if (set) cookie = set.split(";")[0];
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${path} ${res.status} ${JSON.stringify(data)}`);
  return data;
}
async function turn(conversationId, text) {
  const { runId } = await j("/api/chat", { conversationId, text });
  for (let i = 0; i < 120; i++) {
    const { messages } = await j(`/api/conversations/${conversationId}`);
    const last = messages.at(-1);
    if (last.role === "assistant" && last.run_id === runId) return last.content;
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error("run did not finish");
}
const check = (ok, label, detail = "") => {
  if (!ok) failed++;
  console.log(ok ? "PASS" : "FAIL", label, detail);
};

await j("/api/auth/signup", { email: `qa+ivc${Date.now()}@tarrow.test`, password: "testpass123", name: "Sam", city: "New York, NY", timezone: "America/New_York" });
await j("/api/consent", { agree: true });
const { conversationId } = await j("/api/onboarding/start", {});

await turn(conversationId, "I'm a designer in Brooklyn trying to go freelance.");
check(!(await j("/api/me")).user.onboarded, "one answer doesn't finish the interview");

const wrap = await turn(conversationId, "done");
check((await j("/api/me")).user.onboarded, "asking to stop finishes it", JSON.stringify(wrap.slice(0, 60)));

const { conversations } = await j("/api/conversations");
check(conversations.some((c) => c.id === conversationId), "interview shows in the chat list");

const old = await fetch(BASE + "/onboarding", { headers: { cookie }, redirect: "manual" });
check(String(old.headers.get("location")).endsWith(`/c/${conversationId}`), "old /onboarding link opens the interview chat", old.headers.get("location"));
const page = await fetch(`${BASE}/c/${conversationId}`, { headers: { cookie } });
check(page.status === 200, "interview chat still opens after finishing", `status ${page.status}`);

const again = await turn(conversationId, "oh also I have 3 clients lined up already");
const { messages } = await j(`/api/conversations/${conversationId}`);
const wraps = messages.filter((m) => m.role === "assistant" && /Interview complete|Enter Tarrow/i.test(JSON.stringify(m))).length;
check(!/Enter Tarrow/i.test(again), "continuing gets a follow-up, not another wrap-up", JSON.stringify(again.slice(0, 80)));
check(wraps <= 1, "interview wasn't finished a second time", `wrap-ups: ${wraps}`);

console.log(failed ? `${failed} check(s) failed` : "all interview-continue checks passed");
process.exit(failed ? 1 : 0);
