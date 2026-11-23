// Screenshots of the terminal UI mid-run and finished (against the mock LLM). Usage: node qa/term-shots.mjs [base] [dir]
import { chromium, devices } from "playwright";
import { mkdirSync } from "node:fs";
const BASE = process.argv[2] || "http://localhost:3000";
const DIR = process.argv[3] || "qa/shots-term";
mkdirSync(DIR, { recursive: true });
const b = await chromium.launch();
for (const [name, opts] of [["desk", { viewport: { width: 1360, height: 860 } }], ["mobile", devices["iPhone 13"]]]) {
  const ctx = await b.newContext(opts);
  const p = await ctx.newPage();
  await p.request.post(`${BASE}/api/auth/signup`, { data: { email: `qa+ts${name}${Date.now()}@tarrow.test`, password: "testpass123", name: "Sam", city: "Brooklyn, NY" } });
  await p.request.post(`${BASE}/api/consent`, { data: { agree: true } });
  await p.request.post(`${BASE}/api/onboarding/skip`, { data: {} });
  await p.goto(`${BASE}/c/new?q=${encodeURIComponent("deep research: compare weather for a Brooklyn vs Queens picnic")}&effort=deep&n=1`, { waitUntil: "load" });
  await p.getByText("Agent").first().waitFor({ timeout: 30000 });
  await p.waitForTimeout(700);
  await p.screenshot({ path: `${DIR}/${name}-running.png` });
  await p.waitForFunction(() => !document.querySelector('[aria-label="Stop"]'), null, { timeout: 60000 });
  await p.waitForTimeout(800);
  await p.screenshot({ path: `${DIR}/${name}-done.png` });
  await ctx.close();
}
await b.close();
console.log("ok");
