import "server-only";
import { sql } from "../db";
import { chat, chatJson } from "../llm";
import { getUserById } from "../auth";
import { nowLine } from "./context";

/** Rewrites the user's "life file" — Tarrow's running notes — from all memories. */
export async function rebuildLifeFile(userId: string) {
  const user = await getUserById(userId);
  if (!user) return;
  const memories = await sql`select category, content from memories where user_id = ${userId} order by category, created_at limit 250`;
  if (!memories.length) return;
  const goals = await sql`select title, progress from goals where user_id = ${userId} and status = 'active' limit 10`;
  // With only a few facts there's nothing to synthesize, and small models pad them with invented details.
  if (memories.length < 8) {
    const labels: Record<string, string> = { identity: "About", work: "Work", money: "Money", goals: "Goals", blockers: "What's in the way", people: "People", health: "Health", routine: "Routine", interests: "Interests", preferences: "Preferences", other: "Other" };
    const byCat = new Map<string, string[]>();
    for (const m of memories) byCat.set(String(m.category), [...(byCat.get(String(m.category)) ?? []), String(m.content)]);
    const text = [...byCat.entries()].map(([cat, items]) => `**${labels[cat] ?? cat}**\n${items.map((i) => `- ${i}`).join("\n")}`).join("\n\n");
    const goalText = goals.length ? `\n\n**Active goals**\n${goals.map((g) => `- ${g.title}`).join("\n")}` : "";
    await sql`update users set life_file = ${(text + goalText).slice(0, 6000)} where id = ${userId}`;
    return;
  }
  const facts = memories.map((m) => `- (${m.category}) ${m.content}`).join("\n").slice(0, 14_000);
  const res = await chat({
    tier: "main",
    effort: "low",
    maxTokens: 1400,
    temperature: 0.2,
    maxWaitMs: 60_000,
    messages: [
      {
        role: "system",
        content: `You maintain a concise "life file" about a person for their personal AI agent, built ONLY from the memories provided. Write in third person, in Markdown, max 350 words. Sections (omit any with no facts): **Snapshot** (1-2 lines), **Work & money**, **Goals**, **What's in the way**, **People**, **Health & routine**, **Interests**, **How to talk to them**.
STRICT: every statement must be directly supported by a listed memory or goal. Do NOT add salaries, benefits, projects, names, hobbies, numbers or plans that aren't in the memories. Do not guess or embellish. Short is fine. Newer facts override older ones.`,
      },
      { role: "user", content: `Name: ${user.name ?? "?"} · City: ${user.city ?? "?"} · Today: ${nowLine(user.timezone)}\n\nActive goals:\n${goals.map((g) => `- ${g.title} (${g.progress}%)`).join("\n") || "(none)"}\n\nAll memories:\n${facts}` },
    ],
  });
  const text = res.content.trim();
  if (text.length > 80) await sql`update users set life_file = ${text.slice(0, 6000)} where id = ${userId}`;
}

type Suggestion = { kind: string; title: string; body: string; prompt: string };

/** Proactive "For you" cards: things Tarrow could do next, based on the life file. */
export async function generateSuggestions(userId: string) {
  const user = await getUserById(userId);
  if (!user || !user.life_file) return;
  const goals = await sql`select title, progress from goals where user_id = ${userId} and status = 'active' limit 8`;
  const recent = await sql`select title from suggestions where user_id = ${userId} order by created_at desc limit 12`;
  const out = await chatJson<{ suggestions: Suggestion[] }>(
    `You are Tarrow, a proactive personal agent. Propose 4 specific things you could do for the user right now that would genuinely move their life forward. Mix: one research task (events, places, opportunities in their city), one goal-progress action, one bold idea they haven't considered, one small win for this week. Each "prompt" is the exact instruction the user would send you to kick it off (first person, specific). JSON: {"suggestions":[{"kind":"research|goal|idea|habit|event","title":"max 7 words","body":"1 sentence why it matters for THEM","prompt":"..."}]}`,
    `Today: ${nowLine(user.timezone)}\nCity: ${user.city ?? "unknown"}\n\nLife file:\n${user.life_file.slice(0, 3500)}\n\nGoals: ${goals.map((g) => g.title).join("; ") || "none"}\n\nAvoid repeating: ${recent.map((r) => r.title).join("; ") || "n/a"}`,
    { maxTokens: 1500 },
  );
  const items = (out.suggestions ?? []).filter((s) => s?.title && s?.prompt).slice(0, 4);
  if (!items.length) return;
  await sql`update suggestions set dismissed = true where user_id = ${userId} and dismissed = false`;
  for (const s of items) {
    await sql`insert into suggestions (user_id, kind, title, body, prompt) values (${userId}, ${String(s.kind || "idea").slice(0, 20)}, ${String(s.title).slice(0, 120)}, ${String(s.body || "").slice(0, 400)}, ${String(s.prompt).slice(0, 1000)})`;
  }
}
