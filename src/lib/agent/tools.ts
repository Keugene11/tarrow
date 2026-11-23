import "server-only";
import { randomUUID } from "node:crypto";
import { sql } from "../db";
import type { User } from "../auth";
import { chat, type ToolDef } from "../llm";
import { webSearch, readPage, domainOf } from "../web";
import { findPlaces, getWeather } from "../places";
import { findFounders, findJobs, personFromLinkedInResult, type JobPosting, type Person } from "../careers";
import { createDraft, readThread, searchMail } from "../gmail";
import { isEmailList } from "../gmail-mime";
import { MEMORY_CATEGORIES, zonedDate } from "./context";
import type { Card, Mode, PlanItem, RunKind, RunState, Source } from "./types";
import { MODES } from "./types";
import type { EventWriter } from "./events";

export type ToolCtx = { user: User; runId: string; state: RunState; events: EventWriter; mode: Mode; kind: RunKind };
export type ToolOutput = {
  content: string;
  summary?: string;
  sources?: Source[];
  card?: Card;
  spawn?: { title: string; instructions: string }[];
  finishInterview?: boolean;
};

type Tool = {
  def: ToolDef;
  label: (args: Record<string, unknown>) => { label: string; detail?: string };
  run: (args: Record<string, unknown>, ctx: ToolCtx) => Promise<ToolOutput>;
};

const fn = (name: string, description: string, properties: Record<string, unknown>, required: string[] = []): ToolDef => ({
  type: "function",
  function: { name, description, parameters: { type: "object", properties, required } },
});

const str = (v: unknown, max = 2000) => (typeof v === "string" ? v.trim().slice(0, max) : "");

async function resolveId(table: "goals" | "tasks", userId: string, raw: unknown): Promise<string | null> {
  const prefix = str(raw, 64).replace(/^(goal|task)\s*/i, "").toLowerCase();
  if (!/^[0-9a-f-]{4,36}$/.test(prefix)) return null;
  const rows =
    table === "goals"
      ? await sql`select id from goals where user_id = ${userId} and id::text like ${prefix + "%"} limit 2`
      : await sql`select id from tasks where user_id = ${userId} and id::text like ${prefix + "%"} limit 2`;
  return rows.length === 1 ? (rows[0].id as string) : null;
}

/** Parse a model-written datetime; naive times are interpreted in the user's timezone. */
function parseWhen(raw: unknown, tz: string): Date | null {
  const s = str(raw, 64);
  if (!s) return null;
  // Naive local times ("2026-11-10T19:00" or just a date) use the offset in effect on that date, not today's.
  const naive = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::\d{2})?)?$/);
  if (naive) {
    const [, y, m, d, hh, mm] = naive;
    let zone = tz;
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: tz });
    } catch {
      zone = "America/New_York";
    }
    const date = zonedDate(Number(y), Number(m), Number(d), hh ? Number(hh) : 9, mm ? Number(mm) : 0, zone);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

const gcalStamp = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");

export const TOOLS: Record<string, Tool> = {
  web_search: {
    def: fn("web_search", "Search the web. Returns titles, URLs, snippets. Use specific queries; include city/dates when relevant.", {
      query: { type: "string" },
    }, ["query"]),
    label: (a) => ({ label: "Searching the web", detail: str(a.query, 120) }),
    async run(a) {
      const query = str(a.query, 300);
      if (!query) return { content: "Error: empty query" };
      let results;
      try {
        results = await webSearch(query, 7);
      } catch {
        return { content: "Web search is rate-limited right now. Don't retry immediately: use what you have, or read_page a known source directly (e.g. official sites, eventbrite.com/d/<state>--<city>/<topic>/, lu.ma/<city>, reddit).", summary: "Search busy" };
      }
      if (!results.length) return { content: `No results for "${query}". Try a shorter or different query.`, summary: "No results" };
      return {
        content: results.map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}\n   ${r.snippet.slice(0, 220)}`).join("\n"),
        summary: `${results.length} results`,
      };
    },
  },

  read_page: {
    def: fn("read_page", "Open a web page and read it. Pass `question` to extract just what you need (recommended for long pages).", {
      url: { type: "string" },
      question: { type: "string", description: "What to look for on the page" },
    }, ["url"]),
    label: (a) => ({ label: "Reading", detail: domainOf(str(a.url, 500)) }),
    async run(a) {
      const url = str(a.url, 2000);
      const question = str(a.question, 400);
      if (/(^|\.)google\.[a-z.]+$/.test(domainOf(url)) && /maps|cid=/.test(url)) return { content: "Google Maps pages can't be read. Use the find_places results (rating, address, open now) instead, or search the place's own website.", summary: "Skipped Maps page" };
      let page;
      try {
        page = await readPage(url, 24_000);
      } catch (err) {
        return { content: `Could not open ${url}: ${(err as Error).message}`, summary: "Failed to open" };
      }
      if (!page.text.trim() && !page.events.length) return { content: `Page at ${url} had no readable text.`, summary: "Empty page" };
      const events = page.events.length ? `\nStructured events found:\n${page.events.slice(0, 15).join("\n")}\n` : "";
      let body = page.text;
      if (body.length > 3200) {
        try {
          const res = await chat({
            tier: "fast",
            effort: "low",
            maxTokens: 700,
            temperature: 0.2,
            maxWaitMs: 20_000,
            messages: [
              { role: "system", content: "Extract the information relevant to the question from the page. Keep concrete facts: names, dates, times, prices, addresses, and URLs. Max 220 words, bullet points. If nothing relevant, say so." },
              { role: "user", content: `Question: ${question || "Summarize the key useful information."}\nURL: ${page.url}\n\nPAGE:\n${body.slice(0, 16_000)}` },
            ],
          });
          body = res.content.trim() || body.slice(0, 3000);
        } catch {
          body = body.slice(0, 3000);
        }
      }
      return {
        content: `# ${page.title || page.url}\n${page.url}\n${events}\n${body}`.slice(0, 5200),
        summary: page.title ? page.title.slice(0, 80) : "Read page",
        sources: [{ title: page.title || domainOf(page.url), url: page.url }],
      };
    },
  },

  find_places: {
    def: fn("find_places", "Search Google Maps for places (restaurants, bars, gyms, venues, shops...). Returns rating, price, address, links.", {
      query: { type: "string" },
      near: { type: "string", description: "Neighborhood or city" },
    }, ["query"]),
    label: (a) => ({ label: "Searching Google Maps", detail: [str(a.query, 80), str(a.near, 60)].filter(Boolean).join(" · ") }),
    async run(a, ctx) {
      const places = await findPlaces(str(a.query, 200), str(a.near, 120) || ctx.user.city || undefined, 6);
      if (!places.length) return { content: "No places found.", summary: "No places" };
      return {
        content: places
          .map((p, i) => `${i + 1}. ${p.name} — ${p.rating ?? "?"}★ (${p.reviews ?? 0})${p.price ? ` ${p.price}` : ""}${p.openNow === undefined ? "" : p.openNow ? " · open now" : " · closed now"}\n   ${p.address}${p.summary ? `\n   ${p.summary}` : ""}\n   maps: ${p.mapsUrl}${p.website ? `\n   site: ${p.website}` : ""}`)
          .join("\n"),
        summary: `${places.length} places`,
        sources: places.slice(0, 3).filter((p) => p.mapsUrl).map((p) => ({ title: p.name, url: p.mapsUrl! })),
      };
    },
  },

  find_events: {
    def: fn("find_events", "Find upcoming events (meetups, parties, talks, concerts, classes) via Eventbrite, Luma, Meetup and more. Then read_page the best listings for details.", {
      topic: { type: "string", description: "e.g. 'startup networking', 'run club', 'jazz'" },
      city: { type: "string" },
      when: { type: "string", description: "e.g. 'this weekend', 'September 2026'" },
    }, ["topic"]),
    label: (a) => ({ label: "Finding events", detail: [str(a.topic, 80), str(a.city, 40), str(a.when, 40)].filter(Boolean).join(" · ") }),
    async run(a, ctx) {
      const topic = str(a.topic, 120);
      const city = str(a.city, 80) || ctx.user.city || "";
      const when = str(a.when, 60);
      const queries = [`${topic} events ${city} ${when}`, `${topic} ${city} ${when} lu.ma OR eventbrite OR meetup`];
      const all = (await Promise.all(queries.map((q) => webSearch(q.replace(/\s+/g, " ").trim(), 6).catch(() => [])))).flat();
      const seen = new Set<string>();
      const results = all.filter((r) => (seen.has(r.url) ? false : (seen.add(r.url), true))).slice(0, 14);
      if (!results.length) return { content: "No event listings found. Try web_search with different wording.", summary: "No events" };
      return {
        content: results.map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}\n   ${r.snippet.slice(0, 200)}`).join("\n"),
        summary: `${results.length} listings`,
      };
    },
  },

  get_weather: {
    def: fn("get_weather", "Current weather and daily forecast for a location.", {
      location: { type: "string" },
      days: { type: "number" },
    }, ["location"]),
    label: (a) => ({ label: "Checking the weather", detail: str(a.location, 60) }),
    async run(a, ctx) {
      const w = await getWeather(str(a.location, 100) || ctx.user.city || "New York", Number(a.days) || 5);
      return { content: `${w.place}\nNow: ${w.now}\n${w.days.join("\n")}`, summary: `${w.place}: ${w.now}` };
    },
  },

  remember: {
    def: fn("remember", "Save durable facts about the user to long-term memory (life situation, goals, people, preferences, constraints). One fact per item, written in third person.", {
      facts: {
        type: "array",
        items: { type: "object", properties: { category: { type: "string", enum: [...MEMORY_CATEGORIES] }, content: { type: "string" } }, required: ["category", "content"] },
      },
    }, ["facts"]),
    label: (a) => ({ label: "Saving to memory", detail: str((a.facts as { content?: string }[] | undefined)?.[0]?.content, 90) }),
    async run(a, ctx) {
      const facts = (Array.isArray(a.facts) ? a.facts : []).slice(0, 10) as { category?: string; content?: string }[];
      let saved = 0;
      for (const f of facts) {
        const content = str(f.content, 400);
        if (content.length < 3) continue;
        const category = (MEMORY_CATEGORIES as readonly string[]).includes(String(f.category)) ? String(f.category) : "other";
        const dup = await sql`select 1 from memories where user_id = ${ctx.user.id} and lower(content) = lower(${content}) limit 1`;
        if (dup.length) continue;
        await sql`insert into memories (user_id, category, content, source) values (${ctx.user.id}, ${category}, ${content}, ${ctx.kind === "interview" ? "interview" : "chat"})`;
        saved++;
      }
      if (saved) ctx.state.memoriesChanged = true;
      return { content: saved ? `Saved ${saved} fact(s).` : "Nothing new to save.", summary: saved ? `${saved} saved` : "Already known" };
    },
  },

  create_goal: {
    def: fn("create_goal", "Create a goal for the user (only when they want it or clearly agreed).", {
      title: { type: "string" },
      why: { type: "string" },
      target_date: { type: "string", description: "YYYY-MM-DD" },
    }, ["title"]),
    label: (a) => ({ label: "Creating goal", detail: str(a.title, 90) }),
    async run(a, ctx) {
      const title = str(a.title, 200);
      if (!title) return { content: "Error: title required" };
      const existing = await sql`select id from goals where user_id = ${ctx.user.id} and status = 'active' and lower(title) = lower(${title}) limit 1`;
      if (existing.length) return { content: `Goal already exists [goal ${String(existing[0].id).slice(0, 8)}]`, summary: "Already exists" };
      const target = /^\d{4}-\d{2}-\d{2}$/.test(str(a.target_date, 10)) ? str(a.target_date, 10) : null;
      const rows = await sql`insert into goals (user_id, title, why, target_date) values (${ctx.user.id}, ${title}, ${str(a.why, 500) || null}, ${target}) returning id`;
      const id = rows[0].id as string;
      return { content: `Created [goal ${id.slice(0, 8)}] ${title}`, summary: title, card: { type: "goal", id: randomUUID(), goalId: id, title } };
    },
  },

  update_goal: {
    def: fn("update_goal", "Update a goal's progress (0-100), status, or title.", {
      goal: { type: "string", description: "goal id prefix from context" },
      progress: { type: "number" },
      status: { type: "string", enum: ["active", "done", "dropped"] },
      title: { type: "string" },
    }, ["goal"]),
    label: (a) => ({ label: "Updating goal", detail: str(a.title, 80) || undefined }),
    async run(a, ctx) {
      const id = await resolveId("goals", ctx.user.id, a.goal);
      if (!id) return { content: "Error: goal not found" };
      const progress = a.progress == null ? null : Math.max(0, Math.min(100, Math.round(Number(a.progress))));
      const status = ["active", "done", "dropped"].includes(String(a.status)) ? String(a.status) : null;
      const title = str(a.title, 200) || null;
      await sql`update goals set progress = coalesce(${progress}, progress), status = coalesce(${status}, status), title = coalesce(${title}, title), updated_at = now() where id = ${id}`;
      return { content: "Goal updated.", summary: "Updated" };
    },
  },

  create_task: {
    def: fn("create_task", "Add a to-do for the user, optionally with a due date/time (ISO, user's local time) and linked goal.", {
      title: { type: "string" },
      notes: { type: "string" },
      due: { type: "string", description: "YYYY-MM-DDTHH:MM" },
      goal: { type: "string", description: "goal id prefix" },
    }, ["title"]),
    label: (a) => ({ label: "Adding task", detail: str(a.title, 90) }),
    async run(a, ctx) {
      const title = str(a.title, 200);
      if (!title) return { content: "Error: title required" };
      const due = parseWhen(a.due, ctx.user.timezone);
      const goalId = a.goal ? await resolveId("goals", ctx.user.id, a.goal) : null;
      const rows = await sql`insert into tasks (user_id, goal_id, title, notes, due_at, created_by) values (${ctx.user.id}, ${goalId}, ${title}, ${str(a.notes, 1000) || null}, ${due?.toISOString() ?? null}, 'tarrow') returning id`;
      const id = rows[0].id as string;
      return { content: `Created [task ${id.slice(0, 8)}] ${title}`, summary: title, card: { type: "task", id: randomUUID(), taskId: id, title, due: due?.toISOString() ?? null } };
    },
  },

  complete_task: {
    def: fn("complete_task", "Mark a task done.", { task: { type: "string", description: "task id prefix" } }, ["task"]),
    label: () => ({ label: "Completing task" }),
    async run(a, ctx) {
      const id = await resolveId("tasks", ctx.user.id, a.task);
      if (!id) return { content: "Error: task not found" };
      await sql`update tasks set status = 'done', completed_at = now() where id = ${id}`;
      return { content: "Task completed.", summary: "Done" };
    },
  },

  update_plan: {
    def: fn("update_plan", "Show/update your step-by-step plan for this task (visible to the user as a checklist). Use for multi-step work; keep 3-7 items.", {
      items: { type: "array", items: { type: "object", properties: { title: { type: "string" }, status: { type: "string", enum: ["pending", "in_progress", "done"] } }, required: ["title", "status"] } },
    }, ["items"]),
    label: () => ({ label: "Updating plan" }),
    async run(a, ctx) {
      const items = (Array.isArray(a.items) ? a.items : []).slice(0, 10).map((i) => ({
        title: str((i as PlanItem).title, 120),
        status: (["pending", "in_progress", "done"].includes((i as PlanItem).status) ? (i as PlanItem).status : "pending") as PlanItem["status"],
      })).filter((i) => i.title);
      ctx.state.plan = items;
      ctx.events.emit("plan", { items });
      return { content: "Plan updated.", summary: `${items.filter((i) => i.status === "done").length}/${items.length} done` };
    },
  },

  spawn_agents: {
    def: fn("spawn_agents", "Launch parallel research sub-agents for independent parts of a big task. Each gets its own instructions and returns findings with links. You wait for all of them.", {
      agents: { type: "array", items: { type: "object", properties: { title: { type: "string", description: "3-6 words" }, instructions: { type: "string", description: "Specific, self-contained assignment incl. user context needed (city, budget, dates)" } }, required: ["title", "instructions"] } },
    }, ["agents"]),
    label: (a) => ({ label: `Launching ${Array.isArray(a.agents) ? a.agents.length : ""} agents`.replace("  ", " ") }),
    async run(a, ctx) {
      const limits = MODES[ctx.mode];
      if (!limits.subagents) return { content: "Sub-agents are not available in this mode; do the work yourself." };
      if (ctx.state.spawns >= limits.maxSpawns) return { content: "Sub-agent limit reached; finish with what you have." };
      const agents = (Array.isArray(a.agents) ? a.agents : [])
        .map((x) => ({ title: str((x as { title?: string }).title, 60), instructions: str((x as { instructions?: string }).instructions, 1500) }))
        .filter((x) => x.title && x.instructions)
        .slice(0, limits.maxAgents);
      if (!agents.length) return { content: "Error: no valid agents" };
      return { content: "", spawn: agents };
    },
  },

  save_document: {
    def: fn("save_document", "Save a long-form document (plan, report, guide, itinerary) to the user's Library in Markdown.", {
      title: { type: "string" },
      content: { type: "string", description: "Full markdown" },
    }, ["title", "content"]),
    label: (a) => ({ label: "Writing document", detail: str(a.title, 90) }),
    async run(a, ctx) {
      const title = str(a.title, 200) || "Untitled";
      const content = str(a.content, 60_000);
      if (content.length < 20) return { content: "Error: document content too short" };
      const rows = await sql`insert into documents (user_id, run_id, title, content) values (${ctx.user.id}, ${ctx.runId}, ${title}, ${content}) returning id`;
      const id = rows[0].id as string;
      return { content: `Saved "${title}" to Library.`, summary: title, card: { type: "document", id: randomUUID(), documentId: id, title } };
    },
  },

  calendar_event: {
    def: fn("calendar_event", "Create a calendar event card the user can add to Google/Apple Calendar in one tap.", {
      title: { type: "string" },
      start: { type: "string", description: "YYYY-MM-DDTHH:MM local time" },
      end: { type: "string", description: "YYYY-MM-DDTHH:MM local time" },
      location: { type: "string" },
      details: { type: "string" },
      url: { type: "string" },
    }, ["title", "start"]),
    label: (a) => ({ label: "Creating calendar event", detail: str(a.title, 90) }),
    async run(a, ctx) {
      const title = str(a.title, 200);
      const start = parseWhen(a.start, ctx.user.timezone);
      if (!title || !start) return { content: "Error: need title and a valid start datetime" };
      let end = parseWhen(a.end, ctx.user.timezone);
      if (!end || end <= start) end = new Date(start.getTime() + 60 * 60_000);
      const url = /^https?:\/\//.test(str(a.url, 1000)) ? str(a.url, 1000) : undefined;
      const details = [str(a.details, 1500), url].filter(Boolean).join("\n\n");
      const params = new URLSearchParams({ action: "TEMPLATE", text: title, dates: `${gcalStamp(start)}/${gcalStamp(end)}`, details, location: str(a.location, 300) });
      const card: Card = { type: "calendar", id: randomUUID(), title, start: start.toISOString(), end: end.toISOString(), location: str(a.location, 300) || undefined, details: str(a.details, 1500) || undefined, url, gcalUrl: `https://calendar.google.com/calendar/render?${params}` };
      return { content: `Calendar card ready: ${title} at ${start.toISOString()}. The user can add it with one tap.`, summary: title, card };
    },
  },

  draft_message: {
    def: fn("draft_message", "Draft a message/email for the user to send (they review, edit, and send with one tap).", {
      channel: { type: "string", enum: ["email", "text", "whatsapp", "dm", "other"] },
      to: { type: "string" },
      subject: { type: "string" },
      body: { type: "string" },
    }, ["channel", "body"]),
    label: (a) => ({ label: "Drafting message", detail: str(a.to, 60) || str(a.channel, 20) }),
    async run(a) {
      const body = str(a.body, 4000);
      if (!body) return { content: "Error: body required" };
      const channel = (["email", "text", "whatsapp", "dm", "other"].includes(String(a.channel)) ? a.channel : "other") as "email";
      return { content: "Draft ready for the user to review and send. Do not repeat the full draft in your reply.", summary: str(a.subject, 80) || "Draft", card: { type: "draft", id: randomUUID(), channel, to: str(a.to, 200) || undefined, subject: str(a.subject, 200) || undefined, body } };
    },
  },

  gmail_search: {
    def: fn("gmail_search", "Search the user's Gmail (they connected it). Gmail search syntax: from:, to:, subject:, newer_than:7d, older_than:, is:unread, has:attachment, label:, \"exact phrase\". Returns the newest matches with message and thread ids; use gmail_read for the full text.", {
      query: { type: "string", description: "e.g. 'from:delta newer_than:30d', 'subject:invoice', 'is:unread newer_than:2d'" },
      max: { type: "number", description: "1-25, default 10" },
    }, ["query"]),
    label: (a) => ({ label: "Searching Gmail", detail: str(a.query, 100) }),
    async run(a, ctx) {
      const query = str(a.query, 300);
      if (!query) return { content: "Error: query required" };
      const max = Math.max(1, Math.min(25, Math.round(Number(a.max) || 10)));
      const list = await searchMail(ctx.user.id, query, max);
      if (!list.length) return { content: `No emails match "${query}".`, summary: "0 emails" };
      const lines = list.map((m) => `- thread ${m.threadId} · msg ${m.id} · ${m.date.slice(0, 16).replace("T", " ")}${m.unread ? " · unread" : ""}\n  from: ${m.from}\n  subject: ${m.subject}\n  ${m.snippet.slice(0, 200)}`);
      return { content: `${list.length} emails (newest first):\n${lines.join("\n")}`, summary: `${list.length} email${list.length === 1 ? "" : "s"}` };
    },
  },

  gmail_read: {
    def: fn("gmail_read", "Read a full email thread from the user's Gmail (thread id or message id from gmail_search). Returns every message in the thread, newest last.", {
      thread: { type: "string" },
    }, ["thread"]),
    label: (a) => ({ label: "Reading email", detail: str(a.thread, 40) }),
    async run(a, ctx) {
      const id = str(a.thread, 80);
      if (!id) return { content: "Error: thread id required" };
      const t = await readThread(ctx.user.id, id);
      if (!t.messages.length) return { content: "Error: thread is empty" };
      const per = Math.max(1500, Math.floor(12_000 / t.messages.length));
      const body = t.messages
        .map((m) => `### msg ${m.id} · ${m.date.slice(0, 16).replace("T", " ")}\nfrom: ${m.from}\nto: ${m.to}${m.attachments.length ? `\nattachments: ${m.attachments.join(", ")}` : ""}\n\n${m.text.slice(0, per)}${m.text.length > per ? "\n…(truncated)" : ""}`)
        .join("\n\n");
      return { content: `Thread ${t.id}: ${t.subject} (${t.messages.length} message${t.messages.length === 1 ? "" : "s"})\n\n${body}`, summary: t.subject.slice(0, 80) };
    },
  },

  gmail_draft: {
    def: fn("gmail_draft", "Write an email as a real draft in the user's Gmail. They review it on a card and tap Send; you never send. For a reply, pass reply_to (a msg id from gmail_search/gmail_read): it threads correctly and fills in the recipient and subject, so `to` and `subject` are optional then. Plain text only, no markdown.", {
      to: { type: "string", description: "Recipient address(es), comma-separated. Optional with reply_to." },
      cc: { type: "string" },
      subject: { type: "string" },
      body: { type: "string" },
      reply_to: { type: "string", description: "Message id to reply to" },
    }, ["body"]),
    label: (a) => ({ label: a.reply_to ? "Drafting reply in Gmail" : "Drafting email in Gmail", detail: str(a.to, 60) || str(a.subject, 60) }),
    async run(a, ctx) {
      const body = str(a.body, 8000);
      if (!body) return { content: "Error: body required" };
      const to = str(a.to, 500);
      const cc = str(a.cc, 500);
      const replyTo = str(a.reply_to, 80) || undefined;
      if (!to && !replyTo) return { content: "Error: `to` is required unless this is a reply (reply_to)" };
      if ((to && !isEmailList(to)) || (cc && !isEmailList(cc))) return { content: "Error: to/cc must be email addresses" };
      const d = await createDraft(ctx.user.id, { to, cc: cc || undefined, subject: str(a.subject, 300), body, replyTo });
      const card: Card = { type: "gmail_draft", id: randomUUID(), draftId: d.draftId, account: d.from, to: d.to, cc: d.cc, subject: d.subject, body, threadId: d.threadId, reply: !!replyTo, status: "draft" };
      return { content: `Draft saved in their Gmail (to ${d.to}, subject "${d.subject}"). It's on a card with a Send button; don't repeat the full text in your reply, just say it's ready to send.`, summary: d.subject.slice(0, 80) || "Draft", card };
    },
  },

  schedule_routine: {
    def: fn("schedule_routine","Propose a recurring background job Tarrow runs automatically (e.g. 'every Monday find events for this week'). The user must approve it.", {
      title: { type: "string" },
      prompt: { type: "string", description: "Instructions Tarrow will run each time" },
      cadence: { type: "string", enum: ["daily", "weekly"] },
      weekday: { type: "number", description: "0=Sunday..6=Saturday, for weekly" },
    }, ["title", "prompt", "cadence"]),
    label: (a) => ({ label: "Proposing routine", detail: str(a.title, 90) }),
    async run(a, ctx) {
      const title = str(a.title, 120);
      const prompt = str(a.prompt, 2000);
      if (!title || !prompt) return { content: "Error: title and prompt required" };
      const cadence = a.cadence === "daily" ? "daily" : "weekly";
      const weekday = cadence === "weekly" ? Math.max(0, Math.min(6, Math.round(Number(a.weekday ?? 1)))) : null;
      const rows = await sql`insert into routines (user_id, title, prompt, cadence, weekday, next_run_at, active) values (${ctx.user.id}, ${title}, ${prompt}, ${cadence}, ${weekday}, now(), false) returning id`;
      const card: Card = { type: "routine", id: randomUUID(), routineId: rows[0].id as string, title, prompt, cadence, weekday, status: "pending" };
      return { content: "Routine proposed; it starts once the user taps Approve on the card.", summary: title, card };
    },
  },

  find_jobs: {
    def: fn("find_jobs", "Find open jobs from live sources: YC startups (with salary/equity), Hacker News 'Who is hiring?', and the public job boards of companies you name. Skips jobs already in their pipeline. Then rank by fit and save the best with save_to_pipeline.", {
      role: { type: "string", description: "e.g. 'software engineer', 'founding engineer', 'sales', 'new grad engineer'" },
      location: { type: "string", description: "City or 'remote'. Defaults to their city." },
      keywords: { type: "string", description: "Optional space/industry to favor, e.g. 'ai devtools', 'fintech'" },
      companies: { type: "array", items: { type: "string" }, description: "Optional specific companies to check job boards for (max 8)" },
    }, ["role"]),
    label: (a) => ({ label: "Finding jobs", detail: [str(a.role, 60), str(a.location, 40), str(a.keywords, 40)].filter(Boolean).join(" · ") }),
    async run(a, ctx) {
      const role = str(a.role, 120);
      if (!role) return { content: "Error: role required" };
      const location = str(a.location, 80) || ctx.user.city || "";
      const companies = (Array.isArray(a.companies) ? a.companies : []).map((c) => str(c, 80)).filter(Boolean);
      const saved = await sql`select lower(url) as url, lower(company) as company from jobs where user_id = ${ctx.user.id}`;
      const exclude = new Set(saved.map((r) => String(r.company).replace(/\s*\(yc .*\)$/, "")));
      const found = await findJobs({ role, location, keywords: str(a.keywords, 120), companies, exclude, excludeUrls: new Set(saved.map((r) => String(r.url))) });
      const fmt = (j: JobPosting, i: number) => `${i + 1}. ${j.title} — ${j.company}${j.location ? ` · ${j.location}` : ""}${j.salary ? ` · ${j.salary}` : ""}\n   ${j.url}${j.details ? `\n   ${j.details.slice(0, 280)}` : ""}`;
      const sections = [
        found.ats.length ? `## Company job boards\n${found.ats.map(fmt).join("\n")}` : "",
        found.yc.length ? `## YC startups hiring\n${found.yc.map(fmt).join("\n")}` : "",
        found.hn.length ? `## Hacker News "Who is hiring?" (this month)\n${found.hn.map(fmt).join("\n")}` : "",
      ].filter(Boolean);
      const total = found.ats.length + found.yc.length + found.hn.length;
      if (!total) return { content: `No new ${role} jobs found${location ? ` in ${location}` : ""}. Try a broader role, 'remote', or name companies to check.`, summary: "No jobs" };
      return {
        content: `${sections.join("\n\n")}\n\nThese are live postings. Rank them against what you know about the user, then save_to_pipeline the best fits (with fit score, why, and a short tailored pitch). You can't submit applications; the user applies via the link.`,
        summary: `${total} jobs`,
        sources: [...found.ats, ...found.yc].slice(0, 4).map((j) => ({ title: `${j.title} — ${j.company}`, url: j.url })),
      };
    },
  },

  find_people: {
    def: fn("find_people", "Find real people to reach out to. who='founders' pulls YC founders (with LinkedIn/X) near a location or in a space, or of named YC companies. Any other who (recruiters, engineers at X, investors, ...) searches LinkedIn profiles. Then save the best with save_to_pipeline, each with a personalized draft.", {
      who: { type: "string", description: "'founders', or a description like 'technical recruiters at Ramp', 'angel investors in fintech'" },
      location: { type: "string", description: "City or 'remote'. Defaults to their city." },
      keywords: { type: "string", description: "Space/industry, e.g. 'ai agents', 'consumer social'" },
      companies: { type: "array", items: { type: "string" }, description: "Optional specific companies" },
      count: { type: "number", description: "How many people (default 10, max 20)" },
    }, ["who"]),
    label: (a) => ({ label: "Finding people", detail: [str(a.who, 70), str(a.location, 40), str(a.keywords, 40)].filter(Boolean).join(" · ") }),
    async run(a, ctx) {
      const who = str(a.who, 160);
      if (!who) return { content: "Error: who required" };
      const location = str(a.location, 80) || ctx.user.city || "";
      const keywords = str(a.keywords, 120);
      const companies = (Array.isArray(a.companies) ? a.companies : []).map((c) => str(c, 80)).filter(Boolean);
      const count = Math.max(3, Math.min(20, Math.round(Number(a.count) || 10)));
      const saved = await sql`select lower(url) as url, lower(company) as company from contacts where user_id = ${ctx.user.id}`;
      const savedUrls = new Set(saved.map((r) => String(r.url)));
      let people: Person[] = [];
      if (/founder|ceo|cto|startup/i.test(who)) {
        const exclude = new Set(saved.map((r) => String(r.company ?? "").replace(/\s*\(yc .*\)$/, "")));
        people = await findFounders({ location, keywords, companies, limit: count + 6, exclude }).catch(() => []);
      }
      if (people.length < 3) {
        const place = /remote/i.test(location) ? "" : location.split(",")[0];
        const queries = companies.length ? companies.slice(0, 4).map((c) => `${who} ${c} site:linkedin.com/in`) : [`${who} ${keywords} ${place} site:linkedin.com/in`, `${who} ${keywords} ${place} linkedin`];
        const results = (await Promise.all(queries.map((q) => webSearch(q.replace(/\s+/g, " ").trim(), 10).catch(() => [])))).flat();
        people.push(...results.map(personFromLinkedInResult).filter((p): p is Person => !!p));
      }
      const seen = new Set<string>();
      people = people.filter((p) => {
        const k = p.url.toLowerCase();
        if (seen.has(k) || savedUrls.has(k)) return false;
        seen.add(k);
        return true;
      }).slice(0, count);
      if (!people.length) return { content: `No new people found for "${who}". Try different wording, a nearby city, or name companies. You can also web_search and read_page team pages.`, summary: "No people" };
      return {
        content: `${people.map((p, i) => `${i + 1}. ${p.name} — ${[p.role, p.company].filter(Boolean).join(" at ")}\n   ${p.links.join(" · ")}${p.about ? `\n   ${p.about.slice(0, 300)}` : ""}`).join("\n")}\n\nThese are real profiles. Pick the ones worth contacting for the user's goal, then save_to_pipeline them with why + a personalized draft (short, specific to that person's company or work, one clear ask). Never invent emails.`,
        summary: `${people.length} people`,
      };
    },
  },

  save_to_pipeline: {
    def: fn("save_to_pipeline", "Save people to contact and/or jobs to apply for into the user's Pipeline page, where they track status. Include a personalized draft for each person and a tailored pitch for each job.", {
      people: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            role: { type: "string" },
            company: { type: "string" },
            kind: { type: "string", enum: ["founder", "recruiter", "hiring_manager", "investor", "customer", "mentor", "other"] },
            url: { type: "string", description: "LinkedIn/X/profile URL from a tool result" },
            email: { type: "string", description: "Only if found in a tool result" },
            channel: { type: "string", enum: ["linkedin", "x", "email", "dm", "other"] },
            why: { type: "string", description: "One line: why this person, for their goal" },
            draft: { type: "string", description: "Ready-to-send message in their voice, under 90 words" },
          },
          required: ["name", "why", "draft"],
        },
      },
      jobs: {
        type: "array",
        items: {
          type: "object",
          properties: {
            title: { type: "string" },
            company: { type: "string" },
            location: { type: "string" },
            url: { type: "string", description: "Posting URL from a tool result" },
            source: { type: "string" },
            salary: { type: "string" },
            fit: { type: "number", description: "0-100 realistic fit for this user" },
            why: { type: "string", description: "One line on why it fits (or the stretch)" },
            pitch: { type: "string", description: "Ready to paste: 2-4 sentences in first person for the application (why me, why this company), not advice about the job" },
          },
          required: ["title", "company", "url", "fit", "why"],
        },
      },
    }),
    label: (a) => {
      const p = Array.isArray(a.people) ? a.people.length : 0;
      const j = Array.isArray(a.jobs) ? a.jobs.length : 0;
      return { label: "Saving to pipeline", detail: [p ? `${p} people` : "", j ? `${j} jobs` : ""].filter(Boolean).join(" · ") };
    },
    async run(a, ctx) {
      const url = (v: unknown) => (/^https?:\/\/\S+$/.test(str(v, 1000)) ? str(v, 1000) : null);
      let people = 0;
      let jobs = 0;
      for (const raw of (Array.isArray(a.people) ? a.people : []).slice(0, 25) as Record<string, unknown>[]) {
        const name = str(raw.name, 120);
        if (!name) continue;
        const email = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(str(raw.email, 200)) ? str(raw.email, 200) : null;
        const kind = ["founder", "recruiter", "hiring_manager", "investor", "customer", "mentor"].includes(String(raw.kind)) ? String(raw.kind) : "other";
        const channel = ["linkedin", "x", "email", "dm"].includes(String(raw.channel)) ? String(raw.channel) : email ? "email" : /linkedin\.com/.test(String(raw.url)) ? "linkedin" : /(x|twitter)\.com/.test(String(raw.url)) ? "x" : "dm";
        const rows = await sql`
          insert into contacts (user_id, name, role, company, kind, url, email, why, channel, draft)
          values (${ctx.user.id}, ${name}, ${str(raw.role, 160) || null}, ${str(raw.company, 160) || null}, ${kind}, ${url(raw.url)}, ${email}, ${str(raw.why, 400) || null}, ${channel}, ${str(raw.draft, 2000) || null})
          on conflict do nothing returning id`;
        people += rows.length;
      }
      for (const raw of (Array.isArray(a.jobs) ? a.jobs : []).slice(0, 25) as Record<string, unknown>[]) {
        const title = str(raw.title, 200);
        const company = str(raw.company, 160);
        const link = url(raw.url);
        if (!title || !company || !link) continue;
        const fit = Math.max(0, Math.min(100, Math.round(Number(raw.fit) || 0)));
        const rows = await sql`
          insert into jobs (user_id, title, company, location, url, source, salary, fit, why, pitch)
          values (${ctx.user.id}, ${title}, ${company}, ${str(raw.location, 120) || null}, ${link}, ${str(raw.source, 40) || null}, ${str(raw.salary, 120) || null}, ${fit}, ${str(raw.why, 400) || null}, ${str(raw.pitch, 2000) || null})
          on conflict do nothing returning id`;
        jobs += rows.length;
      }
      if (!people && !jobs) return { content: "Nothing new saved (missing fields or already in their pipeline).", summary: "Already saved" };
      return {
        content: `Saved ${people} people and ${jobs} jobs to their Pipeline (/pipeline). Don't repeat every draft in chat; summarize the top picks.`,
        summary: [people ? `${people} people` : "", jobs ? `${jobs} jobs` : ""].filter(Boolean).join(" · "),
        card: { type: "pipeline", id: randomUUID(), people, jobs },
      };
    },
  },

  finish_interview: {
    def: fn("finish_interview", "Call once you know enough about the user (all areas covered or they want to stop).", {
      summary: { type: "string", description: "2-3 sentence summary of who they are and what they want" },
    }, ["summary"]),
    label: () => ({ label: "Wrapping up the interview" }),
    async run(a, ctx) {
      ctx.state.finished = true;
      return { content: `Interview marked complete. Now write the final message: what you learned (brief), 3 sharp first recommendations, and tell them you're ready. Summary: ${str(a.summary, 600)}`, summary: "Interview complete", finishInterview: true };
    },
  },
};

const MAIN_TOOLS = ["web_search", "read_page", "find_places", "find_events", "get_weather", "remember", "create_goal", "update_goal", "create_task", "complete_task", "calendar_event", "draft_message", "schedule_routine", "save_document"];
const PERSONAL_TOOLS = ["find_jobs", "find_people", "save_to_pipeline"];
const GMAIL_TOOLS = ["gmail_search", "gmail_read", "gmail_draft"];

/** personal: the owner's account (lib/personal.ts) also gets the job/people tools. gmail: the user connected Gmail in Settings. */
export function toolsFor(kind: RunKind, mode: Mode, personal = false, gmail = false): string[] {
  // The interview can look things up too (their website, LinkedIn, startup, school) so reactions are specific.
  if (kind === "interview") return ["remember", "create_goal", "read_page", "web_search", "finish_interview"];
  if (kind === "sub") return ["web_search", "read_page", "find_places", "find_events", "get_weather", ...(personal ? ["find_jobs", "find_people"] : []), ...(gmail ? ["gmail_search", "gmail_read"] : [])];
  // Fast mode gets a lean toolset: fewer schemas per call means faster, cheaper steps.
  if (mode === "quick") return ["web_search", "read_page", "find_places", "get_weather", "remember", "create_task", "calendar_event", "draft_message", ...(gmail ? GMAIL_TOOLS : [])];
  const names = [...MAIN_TOOLS, ...(personal ? PERSONAL_TOOLS : []), ...(gmail ? GMAIL_TOOLS : [])];
  names.push("update_plan");
  if (MODES[mode].subagents) names.push("spawn_agents");
  return names;
}
