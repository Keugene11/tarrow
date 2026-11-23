// Captures App Store (6.7") and Play Store phone screenshots of the demo account.
// Usage: node qa/store-shots.mjs <base> <chatId> <liveId>
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const [BASE = "https://tarrow.vercel.app", CHAT, LIVE] = process.argv.slice(2);
const OUT = "docs/screenshots";
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();

// Play rejects screenshots taller than 2:1, so Android uses 360x720@3 = 1080x2160.
const devices = [["ios", { width: 430, height: 932 }, 3], ["android", { width: 360, height: 720 }, 3]].filter(([l]) => !process.env.ONLY || process.env.ONLY === l);
for (const [label, viewport, scale] of devices) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: scale, isMobile: true, hasTouch: true, userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1" });
  const page = await ctx.newPage();
  const res = await page.request.post(`${BASE}/api/auth/login`, { data: { email: "qa+demo@tarrow.test", password: "demo-tarrow-123" } });
  if (!res.ok()) throw new Error(`login failed ${res.status()}`);
  const shots = [
    ["1-welcome", `${BASE}/c/new`, async () => page.getByText("Tips for getting started").waitFor()],
    ["2-live-agents", `${BASE}/c/${LIVE}`, async () => { await page.getByText("Agent").first().waitFor({ timeout: 20000 }); await page.waitForTimeout(1500); }],
    ["3-answer", `${BASE}/c/${CHAT}`, async () => { await page.locator(".md").last().waitFor(); await page.evaluate(() => { const el = document.querySelector(".overflow-y-auto"); if (el) el.scrollTop = 40; }); await page.waitForTimeout(600); }],
    ["4-memory", `${BASE}/memory`, async () => page.getByText("Snapshot").waitFor()],
    ["5-goals", `${BASE}/goals`, async () => page.getByText("Land 3 freelance clients").waitFor()],
  ];
  for (const [name, url, ready] of shots) {
    await page.goto(url, { waitUntil: "load" });
    await ready();
    await page.screenshot({ path: `${OUT}/${label}-${name}.png` });
    console.log("wrote", `${OUT}/${label}-${name}.png`);
  }
  await ctx.close();
}
await browser.close();
