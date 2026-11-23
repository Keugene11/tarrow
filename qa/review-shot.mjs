// App Store review screenshot of the paywall at an accepted iPhone size (1290x2796).
// Usage: node qa/review-shot.mjs [base] [out.png]
import { chromium } from "playwright";
const BASE = process.argv[2] || "https://tarrow.vercel.app";
const OUT = process.argv[3] || "qa/shots-billing/review-paywall.png";
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 430, height: 932 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148" });
const page = await ctx.newPage();
const email = `qa+review${Date.now()}@tarrow.test`;
await page.request.post(`${BASE}/api/auth/signup`, { data: { email, password: "testpass123", name: "Alex", city: "New York, NY", timezone: "America/New_York" } });
await page.request.post(`${BASE}/api/consent`, { data: { agree: true } });
await page.request.post(`${BASE}/api/onboarding/skip`, { data: {} });
await page.goto(`${BASE}/upgrade`, { waitUntil: "networkidle" });
await page.getByRole("button", { name: /Upgrade to Pro/ }).waitFor();
await page.screenshot({ path: OUT });
await browser.close();
console.log("saved", OUT);
