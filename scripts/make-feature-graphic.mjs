// Renders the 1024x500 Google Play feature graphic in the terminal style. Usage: node scripts/make-feature-graphic.mjs
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

mkdirSync("docs/play", { recursive: true });
const html = `<!doctype html><html><head>
<link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;700&display=swap" rel="stylesheet">
<style>
  body { margin: 0; width: 1024px; height: 500px; background: #0b0b0b; color: #d4d4d4; font-family: "JetBrains Mono", monospace; font-size: 19px; overflow: hidden; }
  .wrap { display: flex; height: 100%; align-items: center; gap: 56px; padding: 0 64px; box-sizing: border-box; }
  .brand { flex: 0 0 300px; }
  .brand h1 { margin: 22px 0 10px; font-size: 56px; color: #fff; letter-spacing: -1px; }
  .brand p { margin: 0; color: #8b8b8b; font-size: 20px; line-height: 1.45; }
  .term { flex: 1; border: 1px solid #3a3a3a; border-radius: 10px; padding: 22px 24px; line-height: 1.75; }
  .w { color: #fff; } .d { color: #7a7a7a; } .g { color: #4ade80; } .o { color: #e8a26b; }
  .dot { display: inline-block; width: 9px; height: 9px; border-radius: 50%; background: #4ade80; margin: 0 10px 2px 2px; }
</style></head><body><div class="wrap">
  <div class="brand">
    <svg width="72" height="72" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="#f0f0f0"/><path d="M9 10.5h14M16 10.5v11.5" stroke="#0a0a0a" stroke-width="2.6" stroke-linecap="round" fill="none"/><path d="M12.2 18.4 16 22.2l3.8-3.8" stroke="#0a0a0a" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>
    <h1>Tarrow</h1>
    <p>An AI agent that learns your life, then does the work.</p>
  </div>
  <div class="term">
    <div><span class="w">&gt;</span> find events worth going to this week</div>
    <div><span class="dot"></span><span class="w">Search</span><span class="d">("design meetups nyc this week")</span></div>
    <div class="d">&nbsp;&nbsp;└ Found 8 results</div>
    <div><span class="dot"></span><span class="w">Places</span><span class="d">("coworking cafes near me")</span></div>
    <div class="d">&nbsp;&nbsp;└ 5 places · open now</div>
    <div><span class="dot"></span><span class="w">Agents</span><span class="d">(3 running in parallel)</span></div>
    <div><span class="o">✻</span> <span class="o">Researching…</span> <span class="d">(42s · esc to interrupt)</span></div>
  </div>
</div></body></html>`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1024, height: 500 } });
await page.setContent(html, { waitUntil: "networkidle" });
await page.evaluate(() => document.fonts.ready);
await page.screenshot({ path: "docs/play/feature-graphic.png" });
await browser.close();
console.log("wrote docs/play/feature-graphic.png");
