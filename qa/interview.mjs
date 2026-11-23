// Runs the full onboarding interview with a scripted persona until Tarrow finishes it.
// Usage: node qa/interview.mjs [baseUrl]
const BASE = process.argv[2] || "http://localhost:3000";
let cookie = "";
async function j(path, body, method) {
  const res = await fetch(BASE + path, { method: method ?? (body ? "POST" : "GET"), headers: { "Content-Type": "application/json", cookie }, body: body ? JSON.stringify(body) : undefined });
  const set = res.headers.get("set-cookie");
  if (set) cookie = set.split(";")[0];
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${path} ${res.status} ${JSON.stringify(data)}`);
  return data;
}
async function waitRun(runId) {
  let cursor = {};
  for (;;) {
    const res = await fetch(`${BASE}/api/runs/${runId}/stream?after=${encodeURIComponent(JSON.stringify(cursor))}`, { headers: { cookie } });
    const text = await res.text();
    for (const chunk of text.split("\n\n")) {
      const line = chunk.split("\n").find((l) => l.startsWith("data: "));
      if (line) cursor = JSON.parse(line.slice(6)).cursor ?? cursor;
    }
    if (text.includes("event: end")) return;
  }
}

const persona = [
  "Product designer at a Manhattan agency, I live in Greenpoint with one roommate.",
  "I'm 26, studied graphic design.",
  "About 92k salary, rent is 1,650. Saving 1,200 a month toward a 15k runway.",
  "In 3 months: land my first 3 freelance clients. In 2-3 years: run my own small studio.",
  "No client pipeline yet, and agency work drains my evenings.",
  "Close with my sister in Philly, small friend group from college. I want to meet more people in the design scene.",
  "I sleep about 6.5 hours and run 3x a week. I want a consistent morning routine.",
  "Museums, film photography, long walks. A perfect Saturday is a gallery plus dinner with friends.",
  "Be blunt with me. No sugarcoating.",
  "I've done two small freelance logo jobs for friends, unpaid.",
  "Mostly design leads, I have a portfolio but no case studies written up.",
  "That's about it, let's get started.",
  "Yes, wrap it up.",
  "Done.",
];

const email = `qa+iv${Date.now()}@tarrow.test`;
await j("/api/auth/signup", { email, password: "testpass123", name: "Alex", city: "New York, NY", timezone: "America/New_York" });
await j("/api/consent", { agree: true });
const { conversationId } = await j("/api/onboarding/start", {});
const t0 = Date.now();
for (const [i, answer] of persona.entries()) {
  const { runId } = await j("/api/chat", { conversationId, text: answer });
  await waitRun(runId);
  const conv = await j(`/api/conversations/${conversationId}`);
  const reply = conv.messages.at(-1);
  console.log(`\n[${i + 1}] YOU: ${answer}\nTARROW: ${reply.content}`);
  const me = await j("/api/me");
  if (me.user.onboarded) {
    console.log(`\n✓ Interview finished after ${i + 1} answers in ${Math.round((Date.now() - t0) / 1000)}s`);
    break;
  }
}
const mem = await j("/api/memories");
console.log(`memories: ${mem.memories.length} across ${new Set(mem.memories.map((m) => m.category)).size} categories`);
await new Promise((r) => setTimeout(r, 25000));
const mem2 = await j("/api/memories");
console.log("LIFE FILE:\n" + (mem2.lifeFile || "(not yet)"));
const s = await j("/api/suggestions");
console.log("SUGGESTIONS:", s.suggestions.map((x) => `${x.title} — ${x.prompt}`));
const g = await j("/api/goals");
console.log("GOALS:", g.goals.map((x) => x.title));
