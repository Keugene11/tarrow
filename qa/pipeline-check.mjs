// Coach + Pipeline (personal features, owner's account only): gating for normal users, settings validation,
// a real agent run that finds jobs/people, pipeline API and isolation.
// Usage: node qa/pipeline-check.mjs [baseUrl] [--no-agent] [--gating-only]
// The personal half needs the server started with PERSONAL_FEATURE_EMAILS=qa+personal@tarrow.test (local only).
const BASE = process.argv[2]?.startsWith("http") ? process.argv[2] : "http://localhost:3000";
const AGENT = !process.argv.includes("--no-agent");
let failed = 0;
const check = (name, ok, extra = "") => {
  console.log(`${ok ? "✓" : "✗"} ${name}${extra ? ` — ${extra}` : ""}`);
  if (!ok) failed++;
};

function client() {
  let cookie = "";
  const req = async (path, body, method = body ? "POST" : "GET") => {
    const res = await fetch(BASE + path, { method, headers: { "Content-Type": "application/json", cookie }, body: body ? JSON.stringify(body) : undefined });
    const set = res.headers.get("set-cookie");
    if (set) cookie = set.split(";")[0];
    return { status: res.status, data: await res.json().catch(() => ({})) };
  };
  return req;
}

async function signup(name, email = `qa+pipe${Date.now()}${Math.random().toString(36).slice(2, 6)}@tarrow.test`) {
  const api = client();
  const r = await api("/api/auth/signup", { email, password: "testpass123", name, city: "New York, NY", timezone: "America/New_York" });
  if (r.status !== 200) await api("/api/auth/login", { email, password: "testpass123" });
  await api("/api/consent", { agree: true });
  await api("/api/onboarding/start", {});
  await api("/api/onboarding/skip", {});
  return api;
}

async function waitRun(api, conversationId, maxMs = 8 * 60_000) {
  const t0 = Date.now();
  while (Date.now() - t0 < maxMs) {
    const { data } = await api(`/api/conversations/${conversationId}`);
    if (!data.activeRun && data.messages?.some((m) => m.role === "assistant")) return data;
    await new Promise((r) => setTimeout(r, 4000));
  }
  throw new Error("run timed out");
}

const b = await signup("Bo");

// Normal users don't get any of it
let g = await b("/api/pipeline");
check("normal user: pipeline API is 404", g.status === 404);
g = await b("/api/me", { coach: "yc", resume: "x" }, "PATCH");
g = await b("/api/me");
check("normal user: coach not exposed or settable", g.data.user && !("coach" in g.data.user));
const page = await fetch(BASE + "/pipeline", { headers: { cookie: "" }, redirect: "manual" });
check("logged-out /pipeline doesn't render", page.status !== 200);
if (process.argv.includes("--gating-only")) process.exit(failed ? 1 : 0);

const a = await signup("Sam", "qa+personal@tarrow.test");
if ((await a("/api/pipeline")).status === 404) {
  console.log("✗ qa+personal isn't personal: start the server with PERSONAL_FEATURE_EMAILS=qa+personal@tarrow.test");
  process.exit(1);
}
for (const kind of ["people", "jobs"]) for (const x of (await a("/api/pipeline")).data[kind]) await a(`/api/pipeline/${kind}/${x.id}`, null, "DELETE");

// Coach settings
let r = await a("/api/me", { coach: "custom" }, "PATCH");
check("custom coach without a description is rejected", r.status === 400, r.data.error);
r = await a("/api/me", { coach: "custom", coach_custom: { name: "Paul Graham", description: "brutal startup feedback" } }, "PATCH");
check("custom coach saves", r.status === 200);
r = await a("/api/me");
r = await a("/api/me", { coach: "nonsense" }, "PATCH");
check("unknown coach ignored", r.status === 200);
r = await a("/api/me", { coach: "career", resume: "Alex Doe. Math, State University. Built and shipped 6 apps solo: Next.js, React Native/Capacitor, Postgres, LLM agents. Wingmate: 215 users. Tarrow: AI agent app on iOS/Android. Looking for founding/full-stack engineer roles at NYC AI startups." }, "PATCH");
check("career coach + resume saved", r.status === 200);

if (AGENT) {
  const t0 = Date.now();
  r = await a("/api/chat", { text: "Find 4 NYC AI startup engineering jobs that fit me and save them to my pipeline, plus 2 founders at those companies to DM for a referral.", effort: "standard" });
  check("agent run started", r.status === 200, r.data.error);
  const conv = await waitRun(a, r.data.conversationId);
  const last = conv.messages.at(-1);
  const tools = (last.meta?.steps ?? []).map((s) => s.name);
  console.log(`   ${((Date.now() - t0) / 1000).toFixed(0)}s · tools: ${tools.join(", ")}`);
  console.log(`   answer: ${last.content.slice(0, 700).replace(/\n+/g, " / ")}`);
  check("agent used find_jobs", tools.includes("find_jobs"));
  check("agent saved to pipeline", tools.includes("save_to_pipeline"));
  check("pipeline card in reply", (last.meta?.cards ?? []).some((c) => c.type === "pipeline"));
}

r = await a("/api/pipeline");
const { people = [], jobs = [] } = r.data;
console.log(`   pipeline: ${people.length} people, ${jobs.length} jobs`);
for (const j of jobs.slice(0, 4)) console.log(`   job: ${j.title} — ${j.company} · fit ${j.fit} · ${j.url}\n        why: ${j.why}\n        pitch: ${(j.pitch ?? "").slice(0, 160)}`);
for (const p of people.slice(0, 3)) console.log(`   person: ${p.name} — ${p.role} at ${p.company} · ${p.url}\n        draft: ${(p.draft ?? "").slice(0, 200)}`);
if (AGENT) {
  check("jobs saved with real URLs", jobs.length > 0 && jobs.every((j) => /^https?:\/\//.test(j.url)));
  check("people saved with drafts", people.length > 0 && people.every((p) => p.draft));
}

if (jobs[0] || people[0]) {
  const [kind, item] = jobs[0] ? ["jobs", jobs[0]] : ["people", people[0]];
  const status = kind === "jobs" ? "applied" : "contacted";
  r = await b(`/api/pipeline/${kind}/${item.id}`, { status }, "PATCH");
  check("normal user gets 404 on someone's pipeline item", r.status === 404);
  r = await a("/api/pipeline");
  check("other user can't change my pipeline", r.data[kind].find((x) => x.id === item.id)?.status === item.status);
  r = await b(`/api/pipeline/${kind}/${item.id}`, null, "DELETE");
  r = await a("/api/pipeline");
  check("other user can't delete my pipeline", !!r.data[kind].find((x) => x.id === item.id));
  await a(`/api/pipeline/${kind}/${item.id}`, { status }, "PATCH");
  r = await a("/api/pipeline");
  check("status update works", r.data[kind].find((x) => x.id === item.id)?.status === status);
  await a(`/api/pipeline/${kind}/${item.id}`, { status: "bogus" }, "PATCH");
  r = await a("/api/pipeline");
  check("bogus status ignored", r.data[kind].find((x) => x.id === item.id)?.status === status);
  await a(`/api/pipeline/${kind}/${item.id}`, null, "DELETE");
  r = await a("/api/pipeline");
  check("delete works", !r.data[kind].find((x) => x.id === item.id));
}
process.exit(failed ? 1 : 0);
