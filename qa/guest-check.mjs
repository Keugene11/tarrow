// Guest flow QA: logged-out visitor → interview → a few free tasks → sign-up wall → sign up keeps everything → a second
// guest logging into that account merges too. Run against the mock LLM (see CLAUDE.md), it spends nothing.
// Usage: node --env-file=.env.local qa/guest-check.mjs [baseUrl] [shotDir]
import { chromium, devices } from "playwright";
import { mkdirSync } from "node:fs";
import { neon } from "@neondatabase/serverless";

const BASE = process.argv[2] ?? "http://localhost:3000";
const SHOTS = process.argv[3] ?? "qa/shots/guest";
mkdirSync(SHOTS, { recursive: true });
const sql = neon(process.env.DATABASE_URL);
const email = `qa+guest${Date.now()}@tarrow.test`;
const password = "guest-check-pass-1";
const results = [];
const errors = [];
const guestIds = [];
let failed = false;

const browser = await chromium.launch();
const ctx = await browser.newContext({ ...devices["iPhone 13"] });
let page = await ctx.newPage();
const watch = (p) => {
  p.on("pageerror", (e) => errors.push(`pageerror @ ${p.url()}: ${e.message}`));
  p.on("console", (m) => {
    if (m.type() === "error" && !/favicon|Failed to load resource/.test(m.text())) errors.push(`console @ ${p.url()}: ${m.text().slice(0, 300)}`);
  });
};
watch(page);
const step = async (name, fn) => {
  const t = Date.now();
  try {
    await fn();
    results.push(`PASS ${name} (${((Date.now() - t) / 1000).toFixed(1)}s)`);
  } catch (e) {
    failed = true;
    results.push(`FAIL ${name}: ${e.message.split("\n")[0]}`);
    await page.screenshot({ path: `${SHOTS}/fail-${name.replace(/\W+/g, "-")}.png` }).catch(() => {});
  }
};
const assert = (ok, msg) => {
  if (!ok) throw new Error(msg);
};
const call = (path, body) =>
  page.evaluate(
    async ([path, body]) => {
      const r = await fetch(path, { method: body ? "POST" : "GET", headers: body ? { "Content-Type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined });
      return { status: r.status, data: await r.json().catch(() => ({})) };
    },
    [path, body],
  );
const me = async () => (await call("/api/me")).data.user;

await step("landing is the interview (no feature list, no starters)", async () => {
  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.getByText("Step 1: the interview").waitFor({ timeout: 15000 });
  await page.getByText("what does a normal day look like").waitFor();
  const body = await page.textContent("body");
  assert(!body.includes("What Tarrow does"), "old feature list still there");
  assert(!body.includes("Try:"), "old starters still there");
  await page.screenshot({ path: `${SHOTS}/1-landing.png` });
});

await step("first answer asks for AI consent, then starts a guest interview", async () => {
  const box = page.getByPlaceholder("Type your answer…");
  await box.fill("I'm a student in NYC, I code most days and go to the gym at night.");
  await page.getByRole("button", { name: "Send" }).click();
  await page.getByRole("button", { name: /Agree & continue/ }).waitFor();
  await page.screenshot({ path: `${SHOTS}/2-consent.png` });
  await page.getByRole("button", { name: /Agree & continue/ }).click();
  await page.waitForURL(/\/c\/[0-9a-f-]{36}/, { timeout: 20000 });
  await page.getByText("I'm a student in NYC").waitFor();
  const u = await me();
  assert(u?.guest === true, "not a guest account");
  guestIds.push(u.id);
  await page.getByText("Step 1: the interview").waitFor();
  // Wait for Tarrow's reply to the answer.
  await page.waitForFunction(() => document.querySelectorAll(".term-scroll .mb-5").length >= 3, null, { timeout: 60000 });
  await page.screenshot({ path: `${SHOTS}/3-interview.png` });
});

await step("new chat before finishing the interview goes back to the interview", async () => {
  const r = await call("/api/chat", { text: "find me events" });
  assert(r.status === 403, `expected 403, got ${r.status}`);
});

await step("guest gets 3 free tasks, then a sign-up wall", async () => {
  const skip = await call("/api/onboarding/skip", {});
  assert(skip.status === 200, "skip failed");
  for (let i = 0; i < 3; i++) {
    const r = await call("/api/chat", { text: `hi ${i}`, effort: "quick" });
    assert(r.status === 200, `task ${i + 1} got ${r.status}: ${r.data.error}`);
  }
  const deep = await call("/api/chat", { text: "deep one", effort: "deep" });
  assert(deep.status === 403 && deep.data.code === "signup", `deep: ${deep.status}`);
  await page.goto(`${BASE}/c/new`, { waitUntil: "networkidle" });
  await page.getByText(/0 of 3 free tasks left/).waitFor();
  const box = page.getByPlaceholder("Ask Tarrow anything…");
  await box.fill("one more please");
  await page.getByRole("button", { name: "Send" }).click();
  await page.getByText("Sign up to keep going", { exact: true }).waitFor();
  await page.screenshot({ path: `${SHOTS}/4-wall.png` });
});

await step("guest can't turn on routines or buy Pro", async () => {
  const r = await call("/api/billing/checkout", { interval: "monthly" });
  assert(r.status === 403, `checkout ${r.status}`);
});

await step("sign up keeps interview, chats and memory", async () => {
  const before = await sql`select count(*)::int n from conversations where user_id = ${guestIds[0]}`;
  await page.goto(`${BASE}/signup`, { waitUntil: "networkidle" });
  await page.getByText("come with you").waitFor();
  await page.getByLabel("Name").fill("Guesty");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: /Create account/ }).click();
  await page.waitForURL(/\/c\//, { timeout: 20000 });
  const u = await me();
  assert(u.guest === false && u.email === email, "not signed in as the new account");
  assert(u.onboarded === true, "onboarding didn't carry over");
  const after = await sql`select count(*)::int n from conversations where user_id = ${u.id}`;
  assert(after[0].n === before[0].n && after[0].n >= 4, `conversations ${before[0].n} → ${after[0].n}`);
  const gone = await sql`select 1 from users where id = ${guestIds[0]}`;
  assert(!gone.length, "guest row still exists");
  const acct = await sql`select interview_conversation_id, ai_consent_at from users where id = ${u.id}`;
  assert(acct[0].interview_conversation_id && acct[0].ai_consent_at, "interview/consent not carried");
});

await step("a new guest logging into an existing account merges into it", async () => {
  await call("/api/auth/logout", {});
  await ctx.clearCookies();
  await page.goto(BASE, { waitUntil: "networkidle" });
  const box = page.getByPlaceholder("Type your answer…");
  await box.fill("Second visit, I work at a bakery.");
  await page.getByRole("button", { name: "Send" }).click();
  await page.getByRole("button", { name: /Agree & continue/ }).click();
  await page.waitForURL(/\/c\/[0-9a-f-]{36}/, { timeout: 20000 });
  const g = await me();
  guestIds.push(g.id);
  const convId = page.url().split("/c/")[1];
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: /Log in/ }).click();
  await page.waitForURL(/\/c\//, { timeout: 20000 });
  const u = await me();
  assert(u.email === email, "not logged in");
  const conv = await sql`select user_id, kind from conversations where id = ${convId}`;
  assert(conv[0]?.user_id === u.id, "second guest's interview didn't move");
  assert(conv[0].kind === "chat", `already-onboarded account should keep its own interview (got kind ${conv[0].kind})`);
  await page.screenshot({ path: `${SHOTS}/5-merged.png` });
});

await browser.close();
await sql`delete from users where id = any(${guestIds}::uuid[]) or email = ${email}`;
console.log(results.join("\n"));
if (errors.length) console.log(`\n${errors.length} browser errors:\n${errors.slice(0, 10).join("\n")}`);
process.exit(failed ? 1 : 0);
