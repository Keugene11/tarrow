// Screenshots of the coach picker, Pipeline and Settings → Coach (mobile + desktop, light + dark).
// Usage: node --env-file=.env.local qa/pipeline-shots.mjs [base] [outDir]
// Copies the pipeline of the newest qa+pipe user (from qa/pipeline-check.mjs) into a fresh QA user.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { neon } from "@neondatabase/serverless";

const BASE = process.argv[2] ?? "http://localhost:3000";
const OUT = process.argv[3] ?? "qa/shots-pipeline";
mkdirSync(OUT, { recursive: true });
const sql = neon(process.env.DATABASE_URL);
const email = `qa+pshots${Date.now()}@tarrow.test`;
const password = "testpass123";

const browser = await chromium.launch();
const setup = await browser.newContext();
const req = setup.request;
await req.post(`${BASE}/api/auth/signup`, { data: { email, password, name: "Sam", city: "New York, NY", timezone: "America/New_York" } });
await req.post(`${BASE}/api/consent`, { data: { agree: true } });
await req.post(`${BASE}/api/onboarding/start`, { data: {} });
await req.post(`${BASE}/api/onboarding/skip`, { data: {} });
await req.patch(`${BASE}/api/me`, { data: { coach: "yc", resume: "Math, State University. Shipped 6 apps solo." } });
const [me] = await sql`select id from users where email = ${email}`;
const [src] = await sql`select u.id from users u where u.email like 'qa+pipe%' and exists (select 1 from jobs j where j.user_id = u.id) order by u.created_at desc limit 1`;
if (src) {
  await sql`insert into jobs (user_id, title, company, location, url, source, salary, fit, why, pitch, status) select ${me.id}, title, company, location, url, source, salary, fit, why, pitch, status from jobs where user_id = ${src.id}`;
  await sql`insert into contacts (user_id, name, role, company, kind, url, email, why, channel, draft, status) select ${me.id}, name, role, company, kind, url, email, why, channel, draft, status from contacts where user_id = ${src.id}`;
}
await setup.close();

const errors = [];
for (const [device, viewport] of [["m", { width: 390, height: 844 }], ["d", { width: 1360, height: 860 }]]) {
  for (const theme of ["light", "dark"]) {
    const ctx = await browser.newContext({ viewport, deviceScaleFactor: device === "m" ? 2 : 1 });
    await ctx.addInitScript((t) => localStorage.setItem("tarrow_theme", t), theme);
    await ctx.request.post(`${BASE}/api/auth/login`, { data: { email, password } });
    const page = await ctx.newPage();
    page.on("pageerror", (e) => errors.push(`${device}-${theme} ${e.message}`));
    const shot = (name) => page.screenshot({ path: `${OUT}/${device}-${theme}-${name}.png` });

    await page.goto(`${BASE}/c/new`, { waitUntil: "load" });
    await page.waitForTimeout(1200);
    await shot("welcome");
    await page.getByTitle("Pick who advises you (/coach)").click();
    await page.waitForTimeout(300);
    await shot("coach-picker");
    await page.getByRole("option", { name: /Career agent/ }).click();
    await page.waitForTimeout(1500);
    const label = await page.getByTitle("Pick who advises you (/coach)").innerText();
    if (!/Career agent/.test(label)) errors.push(`${device}-${theme} coach label after pick: ${label}`);
    await page.locator("textarea[aria-label=Message]").fill("/co");
    await page.waitForTimeout(200);
    await shot("slash");
    await page.locator("textarea[aria-label=Message]").press("Enter");
    await page.waitForTimeout(300);
    if (!(await page.getByRole("listbox", { name: "Coach" }).isVisible())) errors.push(`${device}-${theme} /coach didn't open picker`);
    await page.getByRole("option", { name: /YC Partner/ }).click();
    await page.waitForTimeout(800);

    await page.goto(`${BASE}/pipeline`, { waitUntil: "load" });
    await page.waitForTimeout(1200);
    await shot("pipeline-people");
    await page.getByRole("button", { name: /^jobs/ }).click();
    await page.waitForTimeout(300);
    await shot("pipeline-jobs");
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    if (overflow) errors.push(`${device}-${theme} pipeline overflows horizontally`);

    await page.goto(`${BASE}/settings#coach`, { waitUntil: "load" });
    await page.waitForTimeout(1200);
    await page.locator("#coach").scrollIntoViewIfNeeded();
    await shot("settings-coach");
    await ctx.close();
  }
}
await browser.close();
await sql`delete from users where email = ${email}`;
console.log(errors.length ? `✗ ${errors.length} problems:\n${errors.join("\n")}` : "✓ no errors");
process.exit(errors.length ? 1 : 0);
