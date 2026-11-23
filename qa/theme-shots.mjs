// Screenshots every main screen in light and dark themes (mobile + desktop) for visual review.
// Usage: node qa/theme-shots.mjs [base] [outDir]   (uses the seeded demo account, see scripts/seed-demo.mjs)
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const BASE = process.argv[2] ?? "http://localhost:3000";
const OUT = process.argv[3] ?? "qa/theme-shots";
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();
const errors = [];

const login = async (ctx) => {
  const res = await ctx.request.post(`${BASE}/api/auth/login`, { data: { email: "qa+demo@tarrow.test", password: "demo-tarrow-123" } });
  if (!res.ok()) throw new Error(`login failed ${res.status()}`);
};

for (const [device, viewport] of [["m", { width: 390, height: 844 }], ["d", { width: 1360, height: 860 }]]) {
  for (const theme of ["light", "dark"]) {
    const ctx = await browser.newContext({ viewport, deviceScaleFactor: device === "m" ? 2 : 1 });
    await ctx.addInitScript((t) => localStorage.setItem("tarrow_theme", t), theme);
    const page = await ctx.newPage();
    page.on("pageerror", (e) => errors.push(`${device}-${theme} ${e.message}`));
    await login(ctx);
    const convos = await (await ctx.request.get(`${BASE}/api/conversations`)).json();
    const list = convos.conversations ?? convos;
    const chat = list.find((c) => /Design events/.test(c.title))?.id;
    const live = list.find((c) => /Freelance/.test(c.title))?.id;
    const pages = [["welcome", "/c/new"], ["answer", `/c/${chat}`], ["live", `/c/${live}`], ["goals", "/goals"], ["memory", "/memory"], ["settings", "/settings"], ["library", "/library"]];
    for (const [name, path] of pages) {
      await page.goto(`${BASE}${path}`, { waitUntil: "load" });
      await page.waitForTimeout(1500);
      const got = await page.evaluate(() => document.documentElement.dataset.theme);
      if (got !== theme) errors.push(`${device}-${theme} ${name}: data-theme=${got}`);
      await page.screenshot({ path: `${OUT}/${device}-${theme}-${name}.png` });
    }
    if (device === "m") {
      await page.goto(`${BASE}/c/new`, { waitUntil: "load" });
      await page.getByRole("button", { name: "Open menu" }).click();
      await page.waitForTimeout(400);
      await page.screenshot({ path: `${OUT}/${device}-${theme}-drawer.png` });
    }
    await ctx.close();
  }
}
for (const [theme] of [["light"], ["dark"]]) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  await ctx.addInitScript((t) => localStorage.setItem("tarrow_theme", t), theme);
  const page = await ctx.newPage();
  await page.goto(`${BASE}/signup`, { waitUntil: "load" });
  await page.screenshot({ path: `${OUT}/m-${theme}-signup.png` });
  await ctx.close();
}
await browser.close();
console.log(errors.length ? `ERRORS:\n${errors.join("\n")}` : "no page errors");
