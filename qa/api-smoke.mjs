// End-to-end API smoke test: signup -> interview turn -> skip -> chat run with streaming.
// Usage: node qa/api-smoke.mjs [baseUrl] "[prompt]" [effort]
const BASE = process.argv[2] || "http://localhost:3000";
const PROMPT = process.argv[3] || "Find me a highly rated ramen spot in the East Village for tonight and add a task to go.";
const EFFORT = process.argv[4] || "auto";
let cookie = "";
async function api(path, opts = {}) {
  const res = await fetch(BASE + path, { ...opts, headers: { "Content-Type": "application/json", cookie, ...(opts.headers || {}) } });
  const set = res.headers.get("set-cookie");
  if (set) cookie = set.split(";")[0];
  return res;
}
async function j(path, body, method = "POST") {
  const res = await api(path, { method, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${path} ${res.status} ${JSON.stringify(data)}`);
  return data;
}
async function stream(runId) {
  let cursor = {};
  const t0 = Date.now();
  for (;;) {
    const res = await api(`/api/runs/${runId}/stream?after=${encodeURIComponent(JSON.stringify(cursor))}`);
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = "", ended = false;
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf("\n\n")) >= 0) {
        const chunk = buf.slice(0, i); buf = buf.slice(i + 2);
        if (chunk.startsWith("event: end")) { ended = true; continue; }
        const line = chunk.split("\n").find((l) => l.startsWith("data: "));
        if (!line) continue;
        const payload = JSON.parse(line.slice(6));
        cursor = payload.cursor || cursor;
        for (const e of payload.events) {
          const s = ((Date.now() - t0) / 1000).toFixed(1);
          const tag = e.run_id === runId ? "" : `  [agent ${e.run_id.slice(0, 4)}]`;
          if (e.type === "delta" || e.type === "reasoning") continue;
          console.log(`${s}s${tag} ${e.type} ${JSON.stringify(e.data).slice(0, 160)}`);
        }
      }
    }
    if (ended) break;
  }
}
const email = `qa+${Date.now()}@tarrow.test`;
await j("/api/auth/signup", { email, password: "testpass123", name: "Sam", city: "New York, NY", timezone: "America/New_York" });
await j("/api/consent", { agree: true });
console.log("signed up", email);
const { conversationId: interview } = await j("/api/onboarding/start");
const r1 = await j("/api/chat", { conversationId: interview, text: "I'm 24, software engineer at a fintech startup in Brooklyn, live with a roommate in Bushwick. Want to start my own company within 2 years." });
await stream(r1.runId);
let conv = await j(`/api/conversations/${interview}`, null, "GET");
console.log("INTERVIEW REPLY:", conv.messages.at(-1).content);
await j("/api/onboarding/skip");
const r2 = await j("/api/chat", { text: PROMPT, effort: EFFORT });
await stream(r2.runId);
conv = await j(`/api/conversations/${r2.conversationId}`, null, "GET");
const last = conv.messages.at(-1);
console.log("TITLE:", conv.conversation.title);
console.log("ANSWER:\n" + last.content);
console.log("META:", JSON.stringify({ ...last.meta, steps: last.meta.steps?.length }).slice(0, 800));
