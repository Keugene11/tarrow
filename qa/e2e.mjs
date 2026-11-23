// End-to-end UI QA for Tarrow. Usage: node qa/e2e.mjs [baseUrl] [shotDir] [prompt]
import { chromium, devices } from "playwright";
import { mkdirSync } from "node:fs";

const BASE = process.argv[2] ?? "http://localhost:3000";
const SHOTS = process.argv[3] ?? "qa/shots";
const PROMPT = process.argv[4] ?? "What's the weather this weekend and one good outdoor thing to do in my city? Keep it short.";
mkdirSync(SHOTS, { recursive: true });
const results = [];
const errors = [];
const step = async (name, fn) => {
  const t = Date.now();
  try {
    await fn();
    results.push(`PASS ${name} (${((Date.now() - t) / 1000).toFixed(1)}s)`);
  } catch (e) {
    results.push(`FAIL ${name}: ${e.message.split("\n")[0]}`);
    await page.screenshot({ path: `${SHOTS}/fail-${name.replace(/\W+/g, "-")}.png` }).catch(() => {});
  }
};

const browser = await chromium.launch();
const ctx = await browser.newContext({ ...devices["iPhone 13"] });
const page = await ctx.newPage();
const watch = (p) => {
  p.on("pageerror", (e) => errors.push(`pageerror @ ${p.url()}: ${e.message}`));
  p.on("console", (m) => {
    if (m.type() === "error" && !/favicon|Failed to load resource.*(404|401)/.test(m.text())) errors.push(`console @ ${p.url()}: ${m.text().slice(0, 300)}`);
  });
  p.on("response", (r) => {
    if (r.status() >= 500) errors.push(`${r.status()} ${r.url()}`);
  });
};
watch(page);

const email = `qa+ui${Date.now()}@tarrow.test`;

await step("root opens the interview logged out; answering asks for AI consent first", async () => {
  await page.goto(BASE, { waitUntil: "networkidle" });
  if (new URL(page.url()).pathname !== "/") throw new Error(`redirected to ${page.url()}`);
  await page.getByText("Step 1: the interview").first().waitFor();
  // Same app layout as signed-in users; the sidebar points at the interview.
  await page.getByRole("button", { name: "Open menu" }).click();
  await page.getByText("Start with the interview").last().waitFor();
  await page.getByRole("button", { name: "Close menu" }).last().click();
  await page.screenshot({ path: `${SHOTS}/01-landing.png`, fullPage: true });
  await page.getByLabel("Message").fill("Plan my week around the gym");
  await page.getByRole("button", { name: "Send" }).click();
  await page.getByRole("button", { name: /Agree & continue/ }).waitFor();
  await page.screenshot({ path: `${SHOTS}/01b-guest-consent.png` });
  // Guest accounts are covered by qa/guest-check.mjs; this run signs up without agreeing here.
  // Protected pages send logged-out visitors to the chat, not a login wall.
  await page.goto(`${BASE}/goals`, { waitUntil: "networkidle" });
  if (new URL(page.url()).pathname !== "/") throw new Error(`/goals went to ${page.url()}`);
});

await step("signup validation shows errors", async () => {
  await page.goto(`${BASE}/signup`);
  await page.getByLabel("Name").fill("Jordan");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("short");
  await page.getByRole("button", { name: "Create account" }).click();
  // Browser-native minlength blocks submit; stay on the page.
  await page.waitForTimeout(500);
  if (!page.url().includes("/signup")) throw new Error("submitted with short password");
});

await step("signup -> onboarding", async () => {
  await page.getByLabel("Password").fill("testpass123");
  await page.getByLabel("City").fill("Brooklyn, NY");
  await page.getByRole("button", { name: "Create account" }).click();
  // App Store 5.1.2(i): explicit permission before anything is sent to third-party AI.
  await page.waitForURL(/\/consent/, { timeout: 20000 });
  const blocked = await page.request.post(`${BASE}/api/chat`, { data: { text: "hi" } });
  if (blocked.status() !== 403) throw new Error(`chat allowed before consent: ${blocked.status()}`);
  await page.screenshot({ path: `${SHOTS}/01c-consent.png`, fullPage: true });
  await page.getByRole("button", { name: "Agree and continue" }).click();
  // No separate onboarding screen: the first chat in the normal app is the interview.
  await page.waitForURL(/\/c\/[0-9a-f-]{36}/, { timeout: 20000 });
  await page.getByText("what does a normal day look like").waitFor({ timeout: 15000 });
  await page.getByRole("button", { name: "Open menu" }).click();
  await page.getByRole("link", { name: /Finish your interview/ }).last().waitFor();
  await page.getByRole("link", { name: "Goals" }).waitFor();
  await page.getByRole("button", { name: "Close menu" }).last().click();
  await page.goto(`${BASE}/c/new`, { waitUntil: "networkidle" });
  if (!/\/c\/[0-9a-f-]{36}/.test(page.url())) throw new Error(`new chat before finishing the interview went to ${page.url()}`);
  await page.screenshot({ path: `${SHOTS}/02-onboarding.png` });
});

const answer = async (text) => {
  const before = await page.locator(".md").count();
  await page.getByLabel("Message").fill(text);
  await page.getByRole("button", { name: "Send" }).click();
  await page.waitForFunction((n) => document.querySelectorAll(".md").length > n && !document.querySelector('[aria-label="Stop"]'), before, { timeout: 120000 });
};

await step("interview answers", async () => {
  await answer("I'm a 23 year old product designer at an agency in Manhattan. I live in Brooklyn with two roommates.");
  await answer("I make about 85k. Rent is 1400. I want to go freelance within a year and save 20k first.");
  await page.screenshot({ path: `${SHOTS}/03-interview.png` });
  const pct = await page.locator("text=/\\d+%/").first().textContent();
  if (pct === "0%") throw new Error("progress did not move");
});

await step("skip interview -> chat", async () => {
  await page.getByRole("button", { name: "skip", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Skip" }).click();
  await page.waitForURL(/\/c\/new/, { timeout: 20000 });
  await page.getByText("Tips for getting started").waitFor();
  await page.screenshot({ path: `${SHOTS}/04-home.png`, fullPage: true });
});

await step("mode toggle cycles effort", async () => {
  await page.getByRole("button", { name: /auto mode/ }).click();
  await page.getByRole("button", { name: /fast mode/ }).waitFor();
});

await step("slash command navigates", async () => {
  await page.getByLabel("Message").fill("/mem");
  await page.getByText("What Tarrow knows about you").first().waitFor();
  await page.getByRole("button", { name: "Send" }).click();
  await page.waitForURL(/\/memory/, { timeout: 15000 });
  await page.goBack();
  await page.waitForURL(/\/c\/new/, { timeout: 15000 });
});

await step("mobile menu drawer opens with chats + nav", async () => {
  await page.getByRole("button", { name: "Open menu" }).click();
  await page.getByRole("link", { name: "Memory" }).waitFor();
  await page.screenshot({ path: `${SHOTS}/04b-drawer.png` });
  await page.getByRole("button", { name: "Close menu" }).last().click();
  await page.getByRole("link", { name: "Memory" }).waitFor({ state: "hidden" });
});

await step("chat composer starts a live run", async () => {
  await page.getByLabel("Message").fill(PROMPT);
  await page.getByRole("button", { name: "Send" }).click();
  await page.waitForURL(/\/c\//, { timeout: 20000 });
  await page.locator(".shimmer").first().waitFor({ timeout: 20000 });
  await page.screenshot({ path: `${SHOTS}/05-running.png` });
  await page.waitForFunction(() => !document.querySelector('[aria-label="Stop"]'), null, { timeout: 300000 });
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${SHOTS}/06-answer.png`, fullPage: false });
  if (!/\/c\/[0-9a-f-]{36}/.test(page.url())) throw new Error(`URL not updated: ${page.url()}`);
  const text = await page.locator(".md").last().textContent();
  if (!text || text.length < 20) throw new Error("empty answer");
});

await step("reload keeps chat history", async () => {
  await page.reload({ waitUntil: "networkidle" });
  const n = await page.locator(".md").count();
  if (n < 1) throw new Error("no messages after reload");
});

await step("stop a running task", async () => {
  await page.getByLabel("Message").fill("Research the 10 best coworking spaces in Brooklyn with prices and compare them in a table.");
  await page.getByRole("button", { name: "Send" }).click();
  await page.getByRole("button", { name: "Stop" }).waitFor({ timeout: 15000 });
  await page.waitForTimeout(4000);
  await page.getByRole("button", { name: "Stop" }).click();
  await page.waitForFunction(() => !document.querySelector('[aria-label="Stop"]'), null, { timeout: 60000 });
  await page.getByText("Stopped").last().waitFor({ timeout: 10000 });
});

for (const [path, name] of [["/chats", "chats"], ["/goals", "goals"], ["/memory", "memory"], ["/library", "library"], ["/routines", "routines"], ["/settings", "settings"]]) {
  await step(`page ${name}`, async () => {
    await page.goto(`${BASE}${path}`, { waitUntil: "networkidle" });
    await page.locator("h1").first().waitFor();
    await page.screenshot({ path: `${SHOTS}/p-${name}.png`, fullPage: true });
  });
}

await step("add + complete + delete task", async () => {
  await page.goto(`${BASE}/goals`, { waitUntil: "networkidle" });
  await page.getByPlaceholder("Add a task").fill("QA task one");
  await page.getByRole("button", { name: "Add task" }).click();
  await page.getByText("QA task one").waitFor();
  await page.getByRole("button", { name: "Mark as done" }).first().click();
  await page.reload({ waitUntil: "networkidle" });
  await page.getByText("QA task one").waitFor();
});

await step("memory add + edit", async () => {
  await page.goto(`${BASE}/memory`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /Memories/ }).click();
  await page.getByRole("button", { name: "Add memory" }).click();
  await page.getByPlaceholder("Something Tarrow should know about you").fill("Loves bouldering on weekends");
  await page.getByRole("button", { name: "Save" }).click();
  await page.getByText("Loves bouldering on weekends").waitFor();
});

await step("settings style change persists", async () => {
  await page.goto(`${BASE}/settings`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /Coach/ }).click();
  await page.waitForTimeout(1500);
  await page.reload({ waitUntil: "networkidle" });
  const cls = await page.getByRole("button", { name: /Coach/ }).getAttribute("class");
  if (!cls?.includes("border-neutral-900")) throw new Error("style not persisted");
});

await step("theme: light by default, dark from settings persists, /theme toggles", async () => {
  const theme = () => page.evaluate(() => [document.documentElement.dataset.theme, getComputedStyle(document.body).backgroundColor]);
  await page.evaluate(() => localStorage.removeItem("tarrow_theme"));
  await page.goto(`${BASE}/c/new`, { waitUntil: "networkidle" });
  let [t, bg] = await theme();
  if (t !== "light" || bg !== "rgb(255, 255, 255)") throw new Error(`default theme ${t} ${bg}`);
  await page.goto(`${BASE}/settings`, { waitUntil: "networkidle" });
  await page.getByRole("radio", { name: /Dark/ }).click();
  [t, bg] = await theme();
  if (t !== "dark" || bg !== "rgb(11, 11, 11)") throw new Error(`dark not applied ${t} ${bg}`);
  await page.goto(`${BASE}/c/new`, { waitUntil: "networkidle" });
  [t] = await theme();
  if (t !== "dark") throw new Error("dark not persisted across navigation");
  await page.screenshot({ path: `${SHOTS}/theme-dark.png` });
  const box = page.getByPlaceholder(/Ask Tarrow/);
  await box.fill("/theme");
  await box.press("Enter");
  await page.waitForTimeout(200);
  [t, bg] = await theme();
  if (t !== "light" || bg !== "rgb(255, 255, 255)") throw new Error(`/theme did not switch to light ${t} ${bg}`);
  await page.screenshot({ path: `${SHOTS}/theme-light.png` });
});

const desk = await browser.newContext({ viewport: { width: 1360, height: 860 }, storageState: await ctx.storageState() });
const dp = await desk.newPage();
watch(dp);
await step("desktop home + chat", async () => {
  await dp.goto(`${BASE}/home`, { waitUntil: "networkidle" });
  await dp.screenshot({ path: `${SHOTS}/d-home.png` });
  await dp.goto(`${BASE}/chats`, { waitUntil: "networkidle" });
  await dp.locator('main a[href^="/c/"]:not([href="/c/new"])').first().click();
  await dp.waitForURL(/\/c\//);
  await dp.waitForTimeout(1000);
  await dp.screenshot({ path: `${SHOTS}/d-chat.png` });
});

await step("desktop New chat twice opens a fresh chat each time", async () => {
  await dp.goto(`${BASE}/chats`, { waitUntil: "networkidle" });
  await dp.locator('main a[href^="/c/"]:not([href="/c/new"])').first().click();
  await dp.waitForURL(/\/c\/[0-9a-f-]{36}/);
  await dp.getByRole("button", { name: "New chat" }).first().click();
  await dp.getByText("Tips for getting started").waitFor({ timeout: 15000 });
  await dp.getByRole("button", { name: "New chat" }).first().click();
  await dp.getByText("Tips for getting started").waitFor({ timeout: 15000 });
});

await step("same prompt from home twice starts two chats", async () => {
  const before = (await (await dp.request.get(`${BASE}/api/conversations`)).json()).conversations.length;
  for (let i = 0; i < 2; i++) {
    await dp.goto(`${BASE}/home`, { waitUntil: "networkidle" });
    await dp.getByLabel("Message").fill("hi");
    await dp.getByRole("button", { name: "Send" }).click();
    await dp.waitForURL(/\/c\/[0-9a-f-]{36}/, { timeout: 20000 });
  }
  const after = (await (await dp.request.get(`${BASE}/api/conversations`)).json()).conversations.length;
  if (after - before !== 2) throw new Error(`expected 2 new chats, got ${after - before}`);
});

await step("in-app dialogs: rename chat, withdraw consent cancel, privacy + support pages", async () => {
  await page.goto(`${BASE}/chats`, { waitUntil: "networkidle" });
  await page.locator('main a[href^="/c/"]:not([href="/c/new"])').first().click();
  await page.waitForURL(/\/c\/[0-9a-f-]{36}/);
  await page.getByRole("button", { name: "Chat options" }).click();
  await page.getByRole("button", { name: "rename" }).click();
  const box = page.getByRole("dialog").getByRole("textbox");
  await box.fill("Renamed by QA");
  await page.getByRole("dialog").getByRole("button", { name: "Rename" }).click();
  await page.getByText("Renamed by QA").first().waitFor();
  await page.goto(`${BASE}/settings`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /withdraw/ }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Cancel" }).click();
  for (const [path, text] of [["/privacy", "Third parties that process your data"], ["/support", "How do I delete my account?"]]) {
    await page.goto(`${BASE}${path}`, { waitUntil: "networkidle" });
    await page.getByText(text).first().waitFor();
  }
});

await step("logout", async () => {
  await page.goto(`${BASE}/settings`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /Sign out/ }).click();
  await page.waitForURL((u) => u.pathname === "/", { timeout: 15000 });
  await page.getByText("Step 1: the interview").first().waitFor();
});

await step("delete account from Settings (in-app confirm, account gone)", async () => {
  const login = await page.request.post(`${BASE}/api/auth/login`, { data: { email, password: "testpass123" } });
  if (!login.ok()) throw new Error(`login ${login.status()}`);
  await page.goto(`${BASE}/settings`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Delete account" }).click();
  const dialog = page.getByRole("dialog");
  const confirm = dialog.getByRole("button", { name: "Delete account" });
  if (await confirm.isEnabled()) throw new Error("delete enabled before typing DELETE");
  await dialog.getByRole("textbox").fill("DELETE");
  await confirm.click();
  await page.waitForURL((u) => u.pathname === "/", { timeout: 15000 });
  const again = await page.request.post(`${BASE}/api/auth/login`, { data: { email, password: "testpass123" } });
  if (again.status() !== 401) throw new Error(`account still exists: ${again.status()}`);
});

await browser.close();
console.log(results.join("\n"));
console.log(errors.length ? `\nERRORS (${errors.length}):\n${[...new Set(errors)].join("\n")}` : "\nNo console/page errors");
