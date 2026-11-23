// UI gating: a normal account sees none of the personal features; the personal QA account sees all of them.
// Usage: node --env-file=.env.local qa/personal-gating-check.mjs [base]
// (server started with PERSONAL_FEATURE_EMAILS=qa+personal@tarrow.test)
import { chromium } from "playwright";
import { neon } from "@neondatabase/serverless";

const BASE = process.argv[2] ?? "http://localhost:3000";
const sql = neon(process.env.DATABASE_URL);
let failed = 0;
const check = (name, ok) => {
  console.log(`${ok ? "✓" : "✗"} ${name}`);
  if (!ok) failed++;
};

const browser = await chromium.launch();
for (const [label, email, personal] of [["normal", `qa+gate${Date.now()}@tarrow.test`, false], ["personal", "qa+personal@tarrow.test", true]]) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  const req = ctx.request;
  const s = await req.post(`${BASE}/api/auth/signup`, { data: { email, password: "testpass123", name: "Gate", city: "New York, NY", timezone: "America/New_York" } });
  if (!s.ok()) await req.post(`${BASE}/api/auth/login`, { data: { email, password: "testpass123" } });
  await req.post(`${BASE}/api/consent`, { data: { agree: true } });
  await req.post(`${BASE}/api/onboarding/start`, { data: {} });
  await req.post(`${BASE}/api/onboarding/skip`, { data: {} });
  await req.patch(`${BASE}/api/me`, { data: { coach: "yc" } });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/c/new`, { waitUntil: "load" });
  await page.waitForTimeout(1500);
  check(`${label}: Pipeline in the menu = ${personal}`, (await page.getByRole("link", { name: "Pipeline" }).count() > 0) === personal);
  check(`${label}: coach control in the composer = ${personal}`, (await page.getByTitle("Pick who advises you (/coach)").count() > 0) === personal);
  await page.locator("textarea[aria-label=Message]").fill("/co");
  await page.waitForTimeout(200);
  check(`${label}: /coach command = ${personal}`, (await page.getByText("/coach", { exact: true }).count() > 0) === personal);
  await page.goto(`${BASE}/settings`, { waitUntil: "load" });
  await page.waitForTimeout(1200);
  check(`${label}: Settings → Coach = ${personal}`, (await page.locator("#coach").count() > 0) === personal);
  const res = await page.goto(`${BASE}/pipeline`, { waitUntil: "load" });
  check(`${label}: /pipeline renders = ${personal}`, (res.status() === 200) === personal);
  const [row] = await sql`select coach from users where email = ${email}`;
  check(`${label}: coach saved = ${personal}`, (row.coach === "yc") === personal);
  await ctx.close();
}
await browser.close();
process.exit(failed ? 1 : 0);
