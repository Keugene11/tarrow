// Checks routine approval scheduling + ICS route. Usage: node --env-file=.env.local qa/routines-check.mjs [base]
import { neon } from "@neondatabase/serverless";
const BASE = process.argv[2] || "https://tarrow.vercel.app";
const sql = neon(process.env.DATABASE_URL);
let cookie = "";
const j = async (path, body, method) => {
  const r = await fetch(BASE + path, { method: method ?? (body ? "POST" : "GET"), headers: { "content-type": "application/json", cookie }, body: body ? JSON.stringify(body) : undefined });
  const s = r.headers.get("set-cookie"); if (s) cookie = s.split(";")[0];
  return { status: r.status, data: await r.json().catch(() => null), headers: r.headers };
};
await j("/api/auth/signup", { email: `qa+rt${Date.now()}@tarrow.test`, password: "testpass123", name: "R", timezone: "America/Los_Angeles" });
await j("/api/consent", { agree: true });
const me = (await j("/api/me")).data.user;
const [r] = await sql`insert into routines (user_id, title, prompt, cadence, weekday, next_run_at, active) values (${me.id}, 'Weekly events', 'find events', 'weekly', 1, now(), false) returning id`;
const ap = await j(`/api/routines/${r.id}`, { action: "approve" }, "PATCH");
const next = new Date(ap.data.next_run_at);
const la = new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", weekday: "short", hour: "numeric", hour12: false }).format(next);
console.log("approve", ap.status, next.toISOString(), "LA:", la, la.startsWith("Mon") && la.endsWith("08") ? "OK" : "WRONG");
const pause = await j(`/api/routines/${r.id}`, { action: "pause" }, "PATCH");
console.log("pause", pause.status);
const other = await fetch(`${BASE}/api/routines/${r.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "approve" }) });
console.log("unauthenticated patch", other.status, other.status === 401 ? "OK" : "WRONG");
const ics = await fetch(`${BASE}/api/ics?title=Test&start=2026-09-20T18:00:00.000Z`);
const t = await ics.text();
console.log("ics", ics.status, ics.headers.get("content-type"), t.includes("BEGIN:VEVENT") ? "OK" : "WRONG");
const bad = await j("/api/auth/login", { email: "nobody@x.com", password: "x" });
console.log("bad login", bad.status);
