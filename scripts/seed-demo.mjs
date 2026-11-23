// Seeds a demo account with sample content for store screenshots.
// Usage: node --env-file=.env.local scripts/seed-demo.mjs  → prints email/password. Remove with scripts/cleanup-qa.mjs.
import { neon } from "@neondatabase/serverless";
import { randomBytes, scryptSync } from "node:crypto";

const sql = neon(process.env.DATABASE_URL);
const email = "qa+demo@tarrow.test";
const password = "demo-tarrow-123";
await sql`delete from users where email = ${email}`;
const salt = randomBytes(16);
const hash = `scrypt$${salt.toString("hex")}$${scryptSync(password, salt, 64).toString("hex")}`;

const lifeFile = `**Snapshot** — Maya, 26, product designer at a Manhattan agency, lives in Greenpoint with one roommate. Wants to go freelance within a year.

**Work & money** — ~$92k salary, rent $1,650. Saving $1,200/mo toward a $15k runway (at $6.4k).

**Goals** — Land 3 freelance clients by March · Run a half marathon in the spring · Meet more people in the design scene.

**What's in the way** — No client pipeline yet; evenings drained by agency work.

**People** — Close with sister Ana (Philly). Small friend group, mostly from college.

**Health & routine** — Runs 3x/week, sleeps ~6.5h, wants a consistent morning routine.

**How to talk to her** — Direct, practical, no fluff.`;

const [u] = await sql`insert into users (email, password_hash, name, city, timezone, agent_style, life_file, onboarded_at) values (${email}, ${hash}, 'Maya', 'Brooklyn, NY', 'America/New_York', 'direct', ${lifeFile}, now()) returning id`;
const uid = u.id;

const memories = [
  ["identity", "Maya is 26 and lives in Greenpoint, Brooklyn with one roommate"],
  ["work", "Product designer at a Manhattan design agency"],
  ["money", "Earns about $92k; rent is $1,650/month"],
  ["money", "Saving $1,200/month toward a $15k freelance runway, currently at $6.4k"],
  ["goals", "Wants to go freelance within a year"],
  ["goals", "Training for a spring half marathon"],
  ["blockers", "Has no freelance client pipeline yet"],
  ["people", "Close with her sister Ana who lives in Philadelphia"],
  ["health", "Runs three times a week, sleeps about 6.5 hours"],
  ["interests", "Loves ceramics, natural wine bars and design meetups"],
];
for (const [category, content] of memories) await sql`insert into memories (user_id, category, content, source) values (${uid}, ${category}, ${content}, 'interview')`;

const [g1] = await sql`insert into goals (user_id, title, why, target_date, progress) values (${uid}, 'Land 3 freelance clients', 'Go freelance within a year', '2027-03-01', 35) returning id`;
await sql`insert into goals (user_id, title, target_date, progress) values (${uid}, 'Save a $15k runway', '2027-04-01', 43)`;
await sql`insert into goals (user_id, title, target_date, progress) values (${uid}, 'Run the Brooklyn Half', '2027-05-16', 20)`;
const soon = (h) => new Date(Date.now() + h * 3600_000).toISOString();
await sql`insert into tasks (user_id, goal_id, title, due_at, created_by) values (${uid}, ${g1.id}, 'Send portfolio to 5 agencies that outsource design', ${soon(20)}, 'tarrow')`;
await sql`insert into tasks (user_id, title, due_at, created_by) values (${uid}, 'Sign up for NYRR 9+1 qualifier race', ${soon(44)}, 'tarrow')`;
await sql`insert into tasks (user_id, title, created_by) values (${uid}, 'Update Dribbble case study', 'user')`;

const sugg = [
  ["event", "Design meetups this week", "You want more people in the design scene: there are 3 good ones near you this week.", "Find the best design meetups in Brooklyn or Manhattan this week and add the top one to my calendar."],
  ["goal", "Your first freelance pitch", "Your pipeline is empty. Five warm pitches this week gets you moving.", "Draft a short pitch email I can send to agencies that outsource product design."],
  ["research", "What freelancers really charge", "Knowing NYC day rates makes your runway math real.", "Research what freelance product designers in NYC charge per day and per project in 2026."],
  ["habit", "A 7am routine that sticks", "You sleep 6.5h and want mornings back. Start small.", "Build me a realistic weekday morning routine that fits my runs and a 9:30 start."],
];
for (const [kind, title, body, prompt] of sugg) await sql`insert into suggestions (user_id, kind, title, body, prompt) values (${uid}, ${kind}, ${title}, ${body}, ${prompt})`;

// A finished chat with rich output.
const [c1] = await sql`insert into conversations (user_id, title) values (${uid}, 'Design events this week') returning id`;
await sql`insert into messages (conversation_id, user_id, role, content, created_at) values (${c1.id}, ${uid}, 'user', 'Find me design events this week where I could meet potential freelance clients', now() - interval '20 minutes')`;
const answer = `Here are the three worth your time. All are this week and within 30 min of Greenpoint.

| Event | When | Why it's good for you |
|---|---|---|
| **[Creative Mornings NYC](https://creativemornings.com/cities/nyc)** | Fri 8:30am · Flatiron | Free, packed with agency leads and in-house design managers |
| **[Figma Community Meetup](https://lu.ma/figma-nyc)** | Wed 6:30pm · SoHo | Startup founders show up looking for contract designers |
| **[AIGA NY Portfolio Night](https://www.aigany.org/events)** | Thu 7pm · Midtown | Small room, easy to talk to everyone |

**My pick: the Figma meetup.** Founders there hire freelancers directly, which is exactly your pipeline problem. Bring 2–3 case studies on your phone and ask people what they're building before you pitch.

I added it to your calendar and drafted a follow-up message you can send the next morning.`;
const meta = {
  mode: "standard",
  durationMs: 142000,
  steps: [
    { id: "s1", name: "find_events", label: "Finding events", detail: "design meetups · Brooklyn · this week", summary: "14 listings", ok: true },
    { id: "s2", name: "read_page", label: "Reading", detail: "lu.ma", summary: "Figma Community Meetup NYC", ok: true },
    { id: "s3", name: "read_page", label: "Reading", detail: "creativemornings.com", summary: "CreativeMornings NYC", ok: true },
    { id: "s4", name: "calendar_event", label: "Creating calendar event", detail: "Figma Community Meetup", summary: "Figma Community Meetup", ok: true },
    { id: "s5", name: "draft_message", label: "Drafting message", detail: "text", summary: "Follow-up", ok: true },
  ],
  sources: [
    { title: "Figma Community Meetup", url: "https://lu.ma/figma-nyc" },
    { title: "CreativeMornings NYC", url: "https://creativemornings.com/cities/nyc" },
    { title: "AIGA NY", url: "https://www.aigany.org/events" },
  ],
  cards: [
    { type: "calendar", id: "k1", title: "Figma Community Meetup", start: soon(46), end: soon(48.5), location: "SoHo, New York", url: "https://lu.ma/figma-nyc", gcalUrl: "https://calendar.google.com/calendar/render?action=TEMPLATE&text=Figma+Community+Meetup" },
    { type: "task", id: "k2", taskId: "x", title: "Bring 3 case studies to the Figma meetup" },
  ],
};
await sql`insert into messages (conversation_id, user_id, role, content, meta, created_at) values (${c1.id}, ${uid}, 'assistant', ${answer}, ${JSON.stringify(meta)}::jsonb, now() - interval '18 minutes')`;

// A chat with a run "in progress" to show the live activity view.
const [c2] = await sql`insert into conversations (user_id, title) values (${uid}, 'Freelance launch plan') returning id`;
const [run] = await sql`insert into runs (user_id, conversation_id, kind, title, effort, status, state, started_at, lease_until, lease_id) values (${uid}, ${c2.id}, 'main', 'Freelance launch plan', 'deep', 'waiting', '{"mode":"deep","messages":[],"step":3,"sources":[],"cards":[],"steps":[],"notes":[],"spawns":1}'::jsonb, now() - interval '3 minutes 12 seconds', now() + interval '2 hours', 'demo') returning id`;
await sql`insert into messages (conversation_id, user_id, role, content, run_id, created_at) values (${c2.id}, ${uid}, 'user', 'Make me a real plan to go freelance by March: pricing, where to find clients, and how much runway I actually need.', ${run.id}, now() - interval '3 minutes 15 seconds')`;
const kids = [
  ["NYC freelance design rates", "running", [["web_search", "Searching the web", "freelance product designer day rate NYC 2026", true], ["read_page", "Reading", "reddit.com", false]]],
  ["Where clients hire designers", "running", [["web_search", "Searching the web", "agencies that outsource product design NYC", true], ["read_page", "Reading", "clutch.co", true], ["read_page", "Reading", "contra.com", false]]],
  ["Runway and taxes for freelancers", "done", [["web_search", "Searching the web", "NY self-employment tax freelancer 2026", true], ["read_page", "Reading", "nerdwallet.com", true]]],
];
const events = [
  ["mode", { mode: "deep", label: "Deep" }],
  ["tool_start", { id: "p1", name: "remember", label: "Saving to memory", detail: "Maya wants to go freelance by March 2027", step: 1 }],
  ["tool_end", { id: "p1", ok: true, summary: "1 saved", sources: [] }],
  ["plan", { items: [{ title: "Research NYC freelance rates", status: "in_progress" }, { title: "Find where clients hire designers", status: "in_progress" }, { title: "Calculate real runway incl. taxes", status: "done" }, { title: "Write the month-by-month plan", status: "pending" }] }],
];
const kidIds = [];
for (const [title, status] of kids) {
  const [k] = await sql`insert into runs (user_id, parent_run_id, kind, title, status, state, lease_until, lease_id) values (${uid}, ${run.id}, 'sub', ${title}, ${status}, '{}'::jsonb, now() + interval '2 hours', 'demo') returning id`;
  kidIds.push(k.id);
}
events.push(["agents", { agents: kids.map(([title], i) => ({ id: kidIds[i], title })) }]);
events.push(["status", { text: "Waiting on 3 agents" }]);
let seq = 0;
for (const [type, data] of events) await sql`insert into run_events (run_id, seq, type, data) values (${run.id}, ${++seq}, ${type}, ${JSON.stringify(data)}::jsonb)`;
await sql`update runs set seq = ${seq} where id = ${run.id}`;
for (const [i, [, status, steps]] of kids.entries()) {
  let s = 0;
  for (const [j, [name, label, detail, done]] of steps.entries()) {
    await sql`insert into run_events (run_id, seq, type, data) values (${kidIds[i]}, ${++s}, 'tool_start', ${JSON.stringify({ id: `k${i}${j}`, name, label, detail })}::jsonb)`;
    if (done) await sql`insert into run_events (run_id, seq, type, data) values (${kidIds[i]}, ${++s}, 'tool_end', ${JSON.stringify({ id: `k${i}${j}`, ok: true, summary: "Done" })}::jsonb)`;
  }
  if (status === "done") await sql`insert into run_events (run_id, seq, type, data) values (${kidIds[i]}, ${++s}, 'done', '{}'::jsonb)`;
  await sql`update runs set seq = ${s} where id = ${kidIds[i]}`;
}

console.log(JSON.stringify({ email, password, chat: c1.id, live: c2.id }));
