// The composer must stay visible above the on-screen keyboard. Browsers can't open a real keyboard,
// so this shrinks the viewport the way one does and checks the input still sits inside it.
// Usage: node qa/keyboard-check.mjs [base] [shotsDir]
import { chromium, devices } from "playwright";

const BASE = process.argv[2] || "http://localhost:3000";
const SHOTS = process.argv[3];
const browser = await chromium.launch();
const ctx = await browser.newContext({ ...devices["iPhone 13"] });
const page = await ctx.newPage();
// iOS Safari keeps the layout viewport (and 100dvh) full height when the keyboard opens and only shrinks
// window.visualViewport, which is the case that covered the composer. Emulate exactly that.
await page.addInitScript(() => {
  const vv = new EventTarget();
  Object.defineProperty(vv, "height", { get: () => window.__kb ? window.innerHeight - window.__kb : window.innerHeight });
  Object.defineProperty(vv, "width", { get: () => window.innerWidth });
  Object.defineProperty(vv, "offsetTop", { get: () => 0 });
  Object.defineProperty(window, "visualViewport", { get: () => vv });
  window.__setKeyboard = (px) => { window.__kb = px; vv.dispatchEvent(new Event("resize")); };
});
await page.goto(BASE + "/", { waitUntil: "networkidle" });

const box = () =>
  page.evaluate(() => {
    const ta = document.querySelector("textarea");
    const r = ta.getBoundingClientRect();
    return { bottom: Math.round(r.bottom), vh: Math.round(window.visualViewport.height), appH: getComputedStyle(document.documentElement).getPropertyValue("--app-h"), fontSize: getComputedStyle(ta).fontSize, scrollY: window.scrollY };
  });

let failed = 0;
const check = (label, b, maxBottom) => {
  const ok = b.bottom <= maxBottom && b.bottom > 0;
  if (!ok) failed++;
  console.log(ok ? "PASS" : "FAIL", label, JSON.stringify(b));
};

await page.locator("textarea").focus();
const before = await box();
check("keyboard closed", before, before.vh);
if (before.fontSize !== "16px") {
  failed++;
  console.log("FAIL input font-size should be 16px on touch (iOS zooms in otherwise):", before.fontSize);
}
if (SHOTS) await page.screenshot({ path: `${SHOTS}/kb-closed.png` });

// iPhone keyboard + suggestion bar is ~336px tall.
await page.evaluate(() => window.__setKeyboard(336));
await page.waitForTimeout(300);
check("keyboard open", await box(), before.vh - 336);

// Safari pans the page to reveal the input; the shell should snap back.
await page.evaluate(() => window.scrollTo(0, 120));
await page.waitForTimeout(300);
const panned = await box();
check("after Safari-style pan", panned, before.vh - 336);
if (panned.scrollY !== 0) {
  failed++;
  console.log("FAIL page stayed panned:", panned.scrollY);
}
await page.locator("textarea").fill("typing where i can see it");
if (SHOTS) await page.screenshot({ path: `${SHOTS}/kb-open.png` });

await page.evaluate(() => window.__setKeyboard(0));
await page.waitForTimeout(300);
check("keyboard closed again", await box(), before.vh);

await browser.close();
console.log(failed ? `${failed} check(s) failed` : "all keyboard checks passed");
process.exit(failed ? 1 : 0);
