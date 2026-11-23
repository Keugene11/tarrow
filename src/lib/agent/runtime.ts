import "server-only";
import { randomUUID } from "node:crypto";
import { sql } from "../db";
import { getUserById, type User } from "../auth";
import { chat, chatJson, estimateTokens, inputBudget, RateLimitedError, type ChatMessage, type ToolCall } from "../llm";
import { EventWriter } from "./events";
import { loadUserContext, type UserContext } from "./context";
import { interviewPrompt, mainPrompt, subAgentPrompt, triagePrompt } from "./prompts";
import { TOOLS, toolsFor, type ToolCtx, type ToolOutput } from "./tools";
import { hasPersonalFeatures } from "../personal";
import { getGmailConnection } from "../gmail";
import { rebuildLifeFile, generateSuggestions } from "./memory";
import { notifyUser } from "../push";
import { limitsFor } from "../billing";
import { MODES, SUB_LIMITS, type Effort, type Mode, type RunKind, type RunRow, type RunState, type Source } from "./types";

/** Don't start a new step after this long in one invocation. */
const SLICE_MS = Number(process.env.WORKER_SLICE_MS || 160_000);
/** Absolute budget for an invocation (platform limit is 300s). */
const HARD_END_MS = 280_000;
const LEASE_SECONDS = 295;

export function appUrl() {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/$/, "");
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  return `http://localhost:${process.env.PORT || 3000}`;
}

/** Ask a fresh function invocation to work on the run. Returns once the worker accepted. */
export async function kick(runId: string) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(`${appUrl()}/api/worker`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-worker-secret": process.env.WORKER_SECRET ?? "" },
        body: JSON.stringify({ runId }),
        signal: AbortSignal.timeout(10_000),
      });
      if (res.ok) return;
      console.warn("kick rejected", runId, res.status);
      if (res.status < 500) return;
    } catch (err) {
      console.warn("kick failed", runId, (err as Error).message);
    }
    await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
  }
}

const emptyState = (mode: Mode | undefined): RunState => ({ mode: mode ?? "standard", messages: [], step: 0, sources: [], cards: [], steps: [], notes: [], spawns: 0 });

export async function createRun(opts: { user: User; conversationId: string; text: string; effort: Effort; kind?: RunKind; title?: string }) {
  const kind = opts.kind ?? "main";
  const state = emptyState(opts.effort === "auto" ? undefined : opts.effort);
  if (kind === "interview") state.mode = "quick";
  const runId = randomUUID();
  const messageId = randomUUID();
  await sql`insert into runs (id, user_id, conversation_id, kind, title, effort, status, state) values (${runId}, ${opts.user.id}, ${opts.conversationId}, ${kind}, ${opts.title ?? ""}, ${opts.effort}, 'queued', ${JSON.stringify(state)}::jsonb)`;
  await sql`insert into messages (id, conversation_id, user_id, role, content, run_id) values (${messageId}, ${opts.conversationId}, ${opts.user.id}, 'user', ${opts.text}, ${runId})`;
  await sql`update conversations set updated_at = now() where id = ${opts.conversationId}`;
  // The onboarding interview doesn't count toward the plan's daily task limit.
  if (kind !== "interview") await sql`insert into usage_daily (user_id, day, runs) values (${opts.user.id}, current_date, 1) on conflict (user_id, day) do update set runs = usage_daily.runs + 1`;
  return { runId, messageId };
}

type Outcome = { kind: "done" } | { kind: "continue" } | { kind: "wait" } | { kind: "retry"; at: number };

export async function processRun(runId: string, invocationStart = Date.now()) {
  const leaseId = randomUUID();
  const rows = await sql`
    update runs set lease_id = ${leaseId}, lease_until = now() + make_interval(secs => ${LEASE_SECONDS}),
      status = case when status = 'queued' then 'running' else status end,
      started_at = coalesce(started_at, now()), updated_at = now()
    where id = ${runId} and status in ('queued', 'running') and (lease_until is null or lease_until < now())
    returning *`;
  if (!rows.length) return;
  const run = rows[0] as unknown as RunRow;
  const events = new EventWriter(run.id, run.seq);
  const abort = new AbortController();
  events.onCancel = () => abort.abort();
  // Vercel kills the invocation at 300s; every step must fit inside this hard end.
  const hardEnd = invocationStart + HARD_END_MS;
  // Event flushes report cancellation, but a quiet step (waiting on the model) emits nothing, so also poll.
  const cancelPoll = setInterval(async () => {
    try {
      const r = await sql`select cancel_requested from runs where id = ${run.id}`;
      if (r[0]?.cancel_requested && !events.cancelRequested) {
        events.cancelRequested = true;
        abort.abort();
      }
    } catch {}
  }, 2000);
  let outcome: Outcome;
  try {
    outcome = await drive(run, leaseId, events, abort.signal, hardEnd);
  } catch (err) {
    console.error("run failed", runId, err);
    await events.flush();
    await failRun(run, leaseId, events, err);
    return;
  } finally {
    clearInterval(cancelPoll);
    // Never let a slow title hold up the hand-off to the next worker.
    const title = pendingTitles.get(run.id);
    if (title) {
      await withTimeout(title, 15_000);
      pendingTitles.delete(run.id);
    }
  }
  await events.flush();
  if (outcome.kind === "continue") {
    await sql`update runs set lease_id = null, lease_until = null where id = ${run.id} and lease_id = ${leaseId}`;
    // Hand-off must not be lost (e.g. during a deploy switchover): confirm the next worker took the lease.
    for (let attempt = 0; attempt < 3 && Date.now() < invocationStart + 295_000; attempt++) {
      await kick(run.id);
      await new Promise((r) => setTimeout(r, 4_000));
      const r = await sql`select lease_id, status from runs where id = ${run.id}`;
      if (!r[0] || r[0].lease_id || !["queued", "running"].includes(String(r[0].status))) break;
    }
  } else if (outcome.kind === "retry") {
    // Let the lease lapse at the retry time; the stream watchdog / cron re-kicks it.
    await sql`update runs set lease_id = null, lease_until = ${new Date(outcome.at).toISOString()} where id = ${run.id} and lease_id = ${leaseId}`;
    const wait = outcome.at - Date.now();
    if (wait < 60_000) {
      await new Promise((r) => setTimeout(r, Math.max(0, wait) + 500));
      await kick(run.id);
    }
  }
}

function normalizeState(raw: Partial<RunState> | null | undefined): RunState {
  return { ...emptyState(raw?.mode), ...(raw ?? {}) } as RunState;
}

async function persist(run: RunRow, leaseId: string, state: RunState, tokens = 0, extra: { status?: string } = {}) {
  const rows = await sql`
    update runs set state = ${JSON.stringify(state)}::jsonb, tokens_used = tokens_used + ${tokens}, updated_at = now(),
      status = coalesce(${extra.status ?? null}, status),
      lease_until = case when ${extra.status ?? null}::text = 'waiting' then null else lease_until end,
      lease_id = case when ${extra.status ?? null}::text = 'waiting' then null else lease_id end
    where id = ${run.id} and lease_id = ${leaseId}
    returning id`;
  if (!rows.length) throw new Error("Lost lease");
}

async function loadHistory(run: RunRow): Promise<ChatMessage[]> {
  if (!run.conversation_id) return [];
  const rows = await sql`
    select role, content from messages
    where conversation_id = ${run.conversation_id} and created_at <= (select coalesce(max(created_at), now()) from messages where run_id = ${run.id} and role = 'user')
    order by created_at desc limit ${run.kind === "interview" ? 30 : 14}`;
  return rows.reverse().map((r) => ({ role: r.role === "user" ? "user" : "assistant", content: String(r.content) })) as ChatMessage[];
}

/** Fit system + history + this run's transcript into the model's input budget. */
function fitMessages(system: string, history: ChatMessage[], runMsgs: ChatMessage[], toolTokens: number, pinned: ChatMessage[] = []): ChatMessage[] {
  const budget = inputBudget("main") - toolTokens - 150;
  const cap = (m: ChatMessage, n: number): ChatMessage => {
    const c = typeof m.content === "string" ? m.content : "";
    return c.length > n ? ({ ...m, content: c.slice(0, n) + "\n…[truncated]" } as ChatMessage) : m;
  };
  let hist = history.map((m, i) => cap(m, i === history.length - 1 ? 4000 : 1400));
  let msgs = runMsgs.map((m, i) => (m.role === "tool" && i < runMsgs.length - 4 ? cap(m, 1200) : m));
  const total = () => estimateTokens(system) + estimateTokens(pinned) + estimateTokens(hist) + estimateTokens(msgs);
  let guard = 0;
  while (total() > budget && guard++ < 200) {
    if (hist.length > 2) {
      hist = hist.slice(1);
      continue;
    }
    const bigTool = msgs.findIndex((m, i) => m.role === "tool" && (m.content?.length ?? 0) > 500 && i < msgs.length - 2);
    if (bigTool >= 0) {
      msgs = msgs.map((m, i) => (i === bigTool ? cap(m, 450) : m));
      continue;
    }
    // Drop the oldest assistant(tool_calls)+tool results group.
    const groups = msgs.reduce<number[]>((acc, m, i) => (m.role === "assistant" ? [...acc, i] : acc), []);
    if (groups.length > 1) {
      msgs = msgs.slice(groups[1]);
      continue;
    }
    if (hist.length > 1) {
      hist = hist.slice(1);
      continue;
    }
    const anyTool = msgs.findIndex((m) => m.role === "tool" && (m.content?.length ?? 0) > 300);
    if (anyTool >= 0) {
      msgs = msgs.map((m, i) => (i === anyTool ? cap(m, 280) : m));
      continue;
    }
    hist = hist.map((m) => cap(m, 1200));
    break;
  }
  // A transcript must not start with orphan tool results.
  while (msgs.length && msgs[0].role === "tool") msgs = msgs.slice(1);
  return [{ role: "system", content: system }, ...pinned, ...hist, ...msgs];
}

// Links (full URLs or bare domains like "keugenelee.com") in a message, excluding email addresses.
export function extractLinks(text: string): string[] {
  const found = text.match(/(?<![@\w.-])(?:https?:\/\/)?(?:[a-z0-9-]+\.)+(?:com|org|net|io|ai|app|dev|co|me|xyz|live|so|gg|us|uk|ca|edu|info|site|page|link|tech|studio|design|vercel\.app)(?::\d+)?(?:\/[^\s)>\]"']*)?/gi) ?? [];
  return [...new Set(found.map((l) => l.replace(/[.,;:!?]+$/, "")))].slice(0, 4);
}

async function planModes(userId: string): Promise<Mode[]> {
  try {
    return (await limitsFor(userId)).limits.modes;
  } catch {
    return ["quick", "standard"];
  }
}

/** Longest we hold up a reply deciding the mode; past this, go with standard and let the title arrive later. */
const TRIAGE_WAIT_MS = 4_000;
const GREETING = /^(hi|hey|yo|hello|sup|thanks|thank you|ty|ok|okay|cool|lol|nice|gm|good (morning|night))\b/i;
const ABOUT_APP = /\b(what(?: even)?(?:'s| is)(?: even)? (?:tarrow|this app)|what can (?:you|tarrow) do|what do you do|how (?:do(?:es)?|can) (?:you|tarrow|this app) (?:work|help)|who (?:made|built|created|owns) (?:you|tarrow|this)|how (?:do i|to) use (?:you|tarrow|this app)|are you (?:free|an ai|a bot|chatgpt|claude))\b/i;

type Triage = { mode: Mode; title: string; titleLater?: Promise<string> };

/** Resolves with the promise's value, or undefined once `ms` passes. */
async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | undefined> {
  let timer: Parameters<typeof clearTimeout>[0];
  try {
    return await Promise.race([p, new Promise<undefined>((r) => (timer = setTimeout(r, ms)))]);
  } finally {
    clearTimeout(timer);
  }
}

async function llmTriage(text: string, personal = false): Promise<{ mode: Mode; title: string }> {
  const out = await chatJson<{ mode?: string; title?: string }>(triagePrompt(personal), text.slice(0, 2000), { maxTokens: 200 });
  const mode = (["quick", "standard", "deep", "marathon"].includes(String(out.mode)) ? out.mode : "standard") as Mode;
  return { mode, title: String(out.title || "").slice(0, 60) || text.slice(0, 40) };
}

/** the owner's account: advice about the big stuff gets researched, never answered off the cuff. */
const ADVICE_ASK = /\b(advice|advise|thoughts?|opinion|what (should|do) i|how (should|do|can) i|help me|strategy|plan|roast|feedback)\b/i;
const ADVICE_TOPIC = /\b(startup|company|tarrow|thesis|idea|product|users?|customers?|yc|y combinator|invest\w*|rais\w*|fundrais\w*|jobs?|career|apply\w*|resume|interview\w*|recruit\w*|hir\w*|dm\w*|email\w*|outreach|network\w*|money|income|revenue|sales|sell\w*)\b/i;
const MODE_RANK: Mode[] = ["quick", "standard", "deep", "marathon"];

function adviceFloor(text: string): Mode | null {
  return ADVICE_ASK.test(text) && ADVICE_TOPIC.test(text) ? "deep" : null;
}

async function triage(text: string, personal = false): Promise<Triage> {
  const t = await baseTriage(text, personal);
  const floor = personal ? adviceFloor(text) : null;
  if (floor && MODE_RANK.indexOf(t.mode) < MODE_RANK.indexOf(floor)) t.mode = floor;
  return t;
}

async function baseTriage(text: string, personal: boolean): Promise<Triage> {
  const trimmed = text.trim();
  if (trimmed.length < 40 && GREETING.test(trimmed)) return { mode: "quick", title: "Quick chat" };
  if (trimmed.length < 160 && ABOUT_APP.test(trimmed) && !extractLinks(trimmed).length) return { mode: "quick", title: "About Tarrow" };
  const call = llmTriage(trimmed, personal);
  const settled = await withTimeout(call.catch(() => null), TRIAGE_WAIT_MS);
  if (settled) return settled;
  if (settled === null) return { mode: trimmed.length > 160 ? "standard" : "quick", title: trimmed.slice(0, 40) };
  // The model is slow right now: start working in standard (triage's own default) and name the chat when it answers.
  return { mode: "standard", title: trimmed.slice(0, 40), titleLater: call.then((t) => t.title) };
}

/** Chat titles are cosmetic, so they're written in the background; the invocation waits for them before exiting. */
const pendingTitles = new Map<string, Promise<void>>();

function setTitleLater(run: RunRow, title: Promise<string>, placeholder: string) {
  const job = title
    .then(async (t) => {
      if (!t) return;
      await sql`update runs set title = ${t} where id = ${run.id}`;
      if (run.conversation_id) await sql`update conversations set title = ${t} where id = ${run.conversation_id} and title in ('New chat', ${placeholder})`;
    })
    .catch(() => {});
  pendingTitles.set(run.id, job);
}

async function drive(run: RunRow, leaseId: string, events: EventWriter, signal: AbortSignal, hardEnd: number): Promise<Outcome> {
  const sliceEnd = Math.min(Date.now() + SLICE_MS, hardEnd - 120_000);
  const user = await getUserById(run.user_id);
  if (!user) throw new Error("User not found");
  const state = normalizeState(run.state);
  const gmail = run.kind === "interview" ? null : await getGmailConnection(user.id).catch(() => null);

  if (run.cancel_requested) return finalize(run, leaseId, state, events, "", { cancelled: true });

  // First slice of an auto-effort run: decide how hard to think.
  if (run.kind === "main" && run.effort === "auto" && !state.step && !state.triaged) {
    events.emit("status", { text: "Understanding your request" });
    const history = await loadHistory(run);
    const last = history[history.length - 1];
    const lastText = typeof last?.content === "string" ? last.content : "";
    const t = await triage(lastText, hasPersonalFeatures(user));
    // A shared link always gets looked at properly.
    if (t.mode === "quick" && extractLinks(lastText).length) t.mode = "standard";
    // Deep and Marathon are Pro; free users get the most thorough mode their plan has.
    if (!(await planModes(run.user_id)).includes(t.mode)) t.mode = "standard";
    state.mode = t.mode;
    state.triaged = true;
    events.emit("mode", { mode: t.mode, label: MODES[t.mode].label });
    await sql`update runs set title = ${t.title} where id = ${run.id}`;
    if (run.conversation_id) await sql`update conversations set title = ${t.title} where id = ${run.conversation_id} and title = 'New chat'`;
    if (t.titleLater) setTitleLater(run, t.titleLater, t.title);
    await persist(run, leaseId, state);
  } else if (!state.step && !state.triaged && run.kind === "main") {
    state.triaged = true;
    if (!(await planModes(run.user_id)).includes(state.mode)) state.mode = "standard";
    events.emit("mode", { mode: state.mode, label: MODES[state.mode].label });
    if (run.conversation_id) {
      const conv = await sql`select title from conversations where id = ${run.conversation_id}`;
      if (conv[0]?.title === "New chat") {
        const history = await loadHistory(run);
        const last = history[history.length - 1];
        const text = typeof last?.content === "string" ? last.content.trim() : "";
        // The mode is already chosen, so don't make them wait on a title.
        await sql`update conversations set title = ${text.slice(0, 40) || "New chat"} where id = ${run.conversation_id} and title = 'New chat'`;
        if (text) setTitleLater(run, llmTriage(text).then((t) => t.title), text.slice(0, 40));
      }
    }
    await persist(run, leaseId, state);
  }

  // Resuming after sub-agents finished.
  if (state.children?.length) {
    const ids = state.children.map((c) => c.id);
    const kids = await sql`select id, title, status, result, error, tokens_used from runs where id = any(${ids}::uuid[])`;
    if (kids.some((k) => !["done", "error", "cancelled"].includes(String(k.status)))) {
      await persist(run, leaseId, state, 0, { status: "waiting" });
      return { kind: "wait" };
    }
    const perAgent = Math.floor(9000 / Math.max(1, kids.length));
    const report = state.children
      .map((c) => {
        const k = kids.find((x) => x.id === c.id);
        const body = k?.status === "done" ? String(k.result ?? "") : `(agent ${k?.status ?? "failed"}: ${k?.error ?? "no result"})`;
        return `## Agent: ${c.title}\n${body.slice(0, perAgent)}`;
      })
      .join("\n\n");
    state.messages.push({ role: "tool", tool_call_id: state.children[0].toolCallId, content: `${report}

(When you use a finding above, link its URL inline in your answer.)` });
    for (const c of state.children) {
      const log = state.steps.find((s) => s.runId === c.id);
      const k = kids.find((x) => x.id === c.id);
      if (log) {
        log.ok = k?.status === "done";
        log.summary = k?.status === "done" ? "Finished" : "Failed";
      }
    }
    state.notes.push(`- Sub-agents finished: ${state.children.map((c) => c.title).join(", ")}`);
    events.emit("agents_done", { ids });
    state.children = undefined;
    await persist(run, leaseId, state);
  }

  const isSub = run.kind === "sub";
  const limits = isSub ? { ...SUB_LIMITS, effort: "medium" as const } : { ...MODES[state.mode], maxTokens: MODES[state.mode].maxTokens };
  const startedAt = run.started_at ? new Date(run.started_at).getTime() : Date.now();
  let ctx: UserContext | null = null;
  let history: ChatMessage[] | null = null;
  let emptyRetries = 0;
  let squeeze = 0;

  for (;;) {
    if (events.cancelRequested || signal.aborted) return finalize(run, leaseId, state, events, "", { cancelled: true });
    if (Date.now() > sliceEnd) {
      await persist(run, leaseId, state);
      return { kind: "continue" };
    }
    // Time spent waiting for model capacity doesn't count against the work budget.
    const elapsed = Date.now() - startedAt - (state.waitedMs ?? 0);
    const finalOnly = state.forcedFinal || elapsed > limits.budgetMs || state.step >= limits.maxSteps;
    if (!ctx) ctx = await loadUserContext(user.id);
    if (!history) history = isSub ? [] : await loadHistory(run);

    // Interview pacing: the model can't end it early unless the user asks to stop.
    const answers = history.filter((m) => m.role === "user");
    const lastAnswer = String(answers[answers.length - 1]?.content ?? "");
    const wantsOut = lastAnswer.length < 80 && /\b(stop|skip|enough|wrap (it )?up|that'?s (it|all)|let'?s (get )?start(ed)?|i'?m done|done|finish)\b/i.test(lastAnswer);
    // Coming back after finishing (Settings or /interview): keep learning, never wrap up again.
    const continuing = run.kind === "interview" && !!user.onboarded_at && !state.finished;
    const canFinish = !continuing && (!!state.finished || answers.length >= 12 || wantsOut);

    let system: string;
    const pinned: ChatMessage[] = [];
    if (run.kind === "interview") {
      const covered = [...new Set(ctx.memories.map((m) => m.category))];
      system = interviewPrompt(user, ctx, covered, answers.length, canFinish, continuing);
    } else if (isSub) {
      system = subAgentPrompt(user, state.assignment ?? "", !!gmail);
      pinned.push({ role: "user", content: `Begin. Assignment: ${state.assignment ?? ""}` });
    } else {
      const routine = run.kind === "routine" ? run.title : undefined;
      system = mainPrompt(user, ctx, state.mode, state, { lifeFileChars: squeeze ? 1200 : undefined, routine, gmail: gmail?.email });
    }
    // First step with a link in the latest message: make sure it actually gets opened.
    // Also covers "did you check my website?" when the link was in an earlier message.
    const refersToLink = /\b(web ?site|webiste|site|portfolio|link|linkedin|github|profile|page|check (it|that|this|out)|look (at|it up))\b/i.test(lastAnswer);
    const links = isSub || state.step !== 0 || finalOnly ? [] : extractLinks(lastAnswer).length ? extractLinks(lastAnswer) : refersToLink ? extractLinks(answers.slice(-8).map((m) => String(m.content)).join("\n")) : [];
    if (links.length) system += `\n\n## Links they shared\n${links.join("\n")}\nOpen these with read_page before you reply (in parallel with any other tool calls), and reference what you actually found.`;
    let toolNames = finalOnly ? [] : toolsFor(run.kind, state.mode, hasPersonalFeatures(user), !!gmail);
    if (run.kind === "interview" && !canFinish) toolNames = toolNames.filter((n) => n !== "finish_interview");
    const toolDefs = toolNames.map((n) => TOOLS[n].def);
    const runMsgs = [...state.messages];
    if (finalOnly) {
      runMsgs.push({
        role: "user",
        content:
          run.kind === "interview"
            ? "(System: reply to the user now without tools: one short reaction and your next single question, or the wrap-up if the interview is finished.)"
            : "(System: time/step budget reached. Write your final answer now using what you have. Do not call tools.)",
      });
    }
    const squeezedHistory = squeeze ? history.slice(-Math.max(1, 4 - squeeze * 2)) : history;
    const messages = fitMessages(system, squeezedHistory, runMsgs, estimateTokens(toolDefs), pinned);

    const step = state.step + 1;
    events.emit("status", { text: finalOnly ? "Writing the answer" : step === 1 ? "Thinking" : "Working" });
    let res;
    // the owner's account: once the research is in, a stronger model saves the finds and writes the advice (see qa/synth-compare.mjs).
    const synthModel =
      run.kind === "main" && (state.mode === "deep" || state.mode === "marathon") && hasPersonalFeatures(user) && !state.children?.length && (state.spawns > 0 || state.step >= 3)
        ? process.env.PERSONAL_SYNTH_MODEL || "z-ai/glm-5.3"
        : undefined;
    // A separate final writer only when PERSONAL_FINAL_MODEL names one — no premium model by default (Opus cost ~$0.15 a run).
    const finalModel = synthModel && process.env.PERSONAL_FINAL_MODEL && process.env.PERSONAL_FINAL_MODEL !== "off" ? process.env.PERSONAL_FINAL_MODEL : undefined;
    // "Thought for Ns": time from the call starting to its first answer text (or tool calls), minus capacity waits.
    const callStart = Date.now();
    let callWaited = 0;
    let thoughtAt = 0;
    let thoughtSent = false;
    let reasoned = false;
    const emitThought = () => {
      if (thoughtSent || !reasoned) return;
      thoughtSent = true;
      const ms = Math.max(0, (thoughtAt || Date.now()) - callStart - callWaited);
      if (ms < 1000) return;
      state.thinkMs = (state.thinkMs ?? 0) + ms;
      events.emit("thought", { step, ms });
    };
    // The model call must finish with enough time left in this invocation for tools and saving.
    const stepDeadline = hardEnd - 45_000;
    const stepTimeout = AbortSignal.timeout(Math.max(5_000, stepDeadline - Date.now()));
    try {
      res = await chat({
        messages,
        tools: finalOnly || !toolDefs.length ? undefined : toolDefs,
        tier: "main",
        model: synthModel,
        deadlineAt: stepDeadline,
        // Interview turns are short by design; the cap also stops weaker fallback models from rambling.
        maxTokens: run.kind === "interview" ? (canFinish ? 1400 : 1000) : synthModel ? Math.max(limits.maxTokens, 9000) : limits.maxTokens,
        effort: run.kind === "interview" ? "medium" : limits.effort,
        temperature: run.kind === "interview" ? 0.8 : 0.6,
        signal: AbortSignal.any([signal, stepTimeout]),
        maxWaitMs: Math.max(5_000, Math.min(30_000, sliceEnd - Date.now() - 5_000)),
        onReset: () => {
          events.emit("discard", { step });
          thoughtAt = 0;
          reasoned = false;
        },
        onWait: (ms) => {
          state.waitedMs = (state.waitedMs ?? 0) + ms;
          callWaited += ms;
          events.emit("status", { text: `Waiting for model capacity (${Math.ceil(ms / 1000)}s)` });
        },
        onDelta: (d) => {
          if (d.reasoning) {
            reasoned = true;
            events.emit("reasoning", { step, text: d.reasoning });
          }
          if (d.content) {
            if (!thoughtAt) {
              thoughtAt = Date.now();
              emitThought();
            }
            if (!finalModel) events.emit("delta", { step, text: d.content });
          }
        },
      });
    } catch (err) {
      if (events.cancelRequested || signal.aborted) return finalize(run, leaseId, state, events, "", { cancelled: true });
      if (stepTimeout.aborted || Date.now() >= stepDeadline) {
        // Out of time in this invocation: drop the partial step and continue in a fresh one.
        events.emit("discard", { step });
        await persist(run, leaseId, state);
        return { kind: "continue" };
      }
      if (err instanceof RateLimitedError) {
        // Give up gracefully if capacity has been gone for far longer than the task should take.
        // A daily quota (quoted wait of many minutes on every model) won't clear soon, so stop after a short grace period.
        const dailyQuota = err.quotedWaitMs > 10 * 60_000;
        const graceMs = run.kind === "interview" ? 2 * 60_000 : dailyQuota ? 6 * 60_000 : Math.max(limits.budgetMs * 1.5, 10 * 60_000);
        if ((state.waitedMs ?? 0) > graceMs || Date.now() - startedAt > Math.max(limits.budgetMs * 3, 90 * 60_000)) {
          const retryIn = Math.ceil(err.quotedWaitMs / 60_000);
          const partial =
            run.kind === "interview"
              ? `Tarrow's AI is at capacity right now, so I can't respond yet. Your answer is saved. Send your next message in ${retryIn > 60 ? "a few hours" : `about ${retryIn} min`} and we'll pick up where we left off.`
              : state.notes.length
                ? `I ran out of AI capacity before I could finish, so this is incomplete. Here's what I got done:\n\n${state.notes.slice(-15).join("\n")}\n\nAsk me again ${retryIn > 60 ? "later" : `in about ${retryIn} min`} and I'll pick it up.`
                : `Tarrow's AI is at capacity right now and couldn't work on this. Try again ${retryIn > 60 ? "later" : `in about ${retryIn} min`}.`;
          return finalize(run, leaseId, state, events, partial);
        }
        // Wait inside this invocation (never rely on a delayed kick), re-probing at least every minute.
        const wait = Math.min(err.waitMs, 55_000, Math.max(0, sliceEnd - Date.now() - 3_000));
        if (wait < 2_000) {
          // No room left to wait in this slice: hand off to a fresh invocation instead of spinning.
          await persist(run, leaseId, state);
          return { kind: "continue" };
        }
        events.emit("waiting", { text: "Tarrow is at capacity — picking back up automatically", until: new Date(Date.now() + wait).toISOString() });
        await persist(run, leaseId, state);
        await events.flush();
        await new Promise<void>((r) => {
          const t = setTimeout(r, wait);
          signal.addEventListener("abort", () => (clearTimeout(t), r()), { once: true });
        });
        state.waitedMs = (state.waitedMs ?? 0) + wait;
        continue;
      }
      if ((err as { status?: number }).status === 413 && squeeze < 3) {
        squeeze++;
        events.emit("discard", { step });
        continue;
      }
      throw err;
    }
    if (events.cancelRequested || signal.aborted) return finalize(run, leaseId, state, events, "", { cancelled: true });
    if (res.reasoning) reasoned = true;
    emitThought();
    const tokens = res.usage.prompt + res.usage.completion;
    state.step = step;

    // In the final step tools were withheld; ignore any tool calls a model emits anyway.
    const calls: ToolCall[] = finalOnly ? [] : res.toolCalls.slice(0, 8);
    if (!calls.length) {
      let content = res.content.trim();
      if (finalModel && content) {
        events.emit("status", { text: "Writing the answer" });
        try {
          const final = await chat({
            messages,
            tier: "main",
            model: finalModel,
            deadlineAt: stepDeadline,
            maxTokens: 9000,
            effort: "medium",
            temperature: 0.6,
            signal: AbortSignal.any([signal, stepTimeout]),
            maxWaitMs: 15_000,
            onReset: () => events.emit("discard", { step }),
            onDelta: (d) => {
              if (d.content) events.emit("delta", { step, text: d.content });
            },
          });
          if (final.content.trim()) {
            content = final.content.trim();
            res = { ...res, model: final.model };
          } else events.emit("delta", { step, text: content });
        } catch {
          if (events.cancelRequested || signal.aborted) return finalize(run, leaseId, state, events, "", { cancelled: true });
          // Keep the synth model's draft rather than failing the run.
          events.emit("discard", { step });
          events.emit("delta", { step, text: content });
        }
      }
      if (!content) {
        events.emit("discard", { step });
        if (emptyRetries++ < 2) {
          state.forcedFinal = emptyRetries > 1;
          await persist(run, leaseId, state, tokens);
          continue;
        }
      }
      events.emit("step_end", { step, final: true, model: res.model, tokens });
      await persist(run, leaseId, state, tokens);
      return finalize(run, leaseId, state, events, content || "Sorry — I couldn't put an answer together that time. Try asking again?");
    }

    events.emit("step_end", { step, final: false, model: res.model, tokens });
    state.messages.push({ role: "assistant", content: res.content || null, tool_calls: calls });
    if (res.content.trim()) state.notes.push(`- Thought: ${res.content.trim().slice(0, 200)}`);

    const toolCtx: ToolCtx = { user, runId: run.id, state, events, mode: state.mode, kind: run.kind };
    const allowed = new Set(toolNames);
    const outputs = await Promise.all(
      calls.map(async (tc): Promise<{ tc: ToolCall; out: ToolOutput }> => {
        const tool = TOOLS[tc.function.name];
        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(tc.function.arguments || "{}");
        } catch {
          return { tc, out: { content: "Error: arguments were not valid JSON. Retry with valid JSON." } };
        }
        if (!tool || !allowed.has(tc.function.name)) return { tc, out: { content: `Error: unknown tool ${tc.function.name}` } };
        const { label, detail } = tool.label(args);
        if (tc.function.name !== "spawn_agents") {
          state.steps.push({ id: tc.id, name: tc.function.name, label, detail });
          events.emit("tool_start", { id: tc.id, name: tc.function.name, label, detail, step });
        }
        let out: ToolOutput;
        try {
          out = await Promise.race([
            tool.run(args, toolCtx),
            new Promise<never>((_, rej) => setTimeout(() => rej(new Error("Tool timed out")), Math.max(5_000, Math.min(75_000, hardEnd - Date.now() - 15_000)))),
          ]);
        } catch (err) {
          out = { content: `Error: ${(err as Error).message}`, summary: "Failed" };
        }
        if (tc.function.name !== "spawn_agents") {
          const ok = !out.content.startsWith("Error");
          const log = state.steps.find((s) => s.id === tc.id);
          if (log) {
            log.ok = ok;
            log.summary = out.summary;
          }
          events.emit("tool_end", { id: tc.id, ok, summary: out.summary ?? "", sources: out.sources ?? [] });
          state.notes.push(`- ${label}${detail ? ` (${detail})` : ""}: ${out.summary ?? (ok ? "done" : "failed")}`);
        }
        for (const s of out.sources ?? []) {
          if (!state.sources.some((x) => x.url === s.url) && state.sources.length < 40) state.sources.push(s);
        }
        if (out.card) {
          state.cards.push(out.card);
          events.emit("card", { card: out.card });
        }
        return { tc, out };
      }),
    );

    if (outputs.some((o) => ["remember", "create_goal", "update_goal", "create_task", "complete_task"].includes(o.tc.function.name))) ctx = null;

    const spawnCall = outputs.find((o) => o.out.spawn?.length);
    for (const { tc, out } of outputs) {
      if (tc === spawnCall?.tc) continue;
      state.messages.push({ role: "tool", tool_call_id: tc.id, content: out.content || "ok" });
    }

    if (spawnCall) {
      const agents = spawnCall.out.spawn!;
      const children = agents.map((a) => ({ id: randomUUID(), title: a.title, toolCallId: spawnCall.tc.id, instructions: a.instructions }));
      for (const c of children) {
        const childState: RunState = { ...emptyState("standard"), assignment: c.instructions };
        await sql`insert into runs (id, user_id, parent_run_id, kind, title, effort, status, state) values (${c.id}, ${user.id}, ${run.id}, 'sub', ${c.title}, 'standard', 'queued', ${JSON.stringify(childState)}::jsonb)`;
        state.steps.push({ id: `agent-${c.id}`, name: "agent", label: c.title, detail: c.instructions.slice(0, 160), runId: c.id });
      }
      state.children = children.map(({ id, title, toolCallId }) => ({ id, title, toolCallId }));
      state.spawns++;
      state.notes.push(`- Launched ${children.length} agents: ${children.map((c) => c.title).join(", ")}`);
      events.emit("agents", { agents: children.map((c) => ({ id: c.id, title: c.title, detail: c.instructions.slice(0, 160) })) });
      events.emit("status", { text: `Waiting on ${children.length === 1 ? "1 agent" : `${children.length} agents`}` });
      await events.flush();
      await persist(run, leaseId, state, tokens, { status: "waiting" });
      await Promise.all(children.map((c) => kick(c.id)));
      return { kind: "wait" };
    }

    await persist(run, leaseId, state, tokens);
  }
}

async function finalize(run: RunRow, leaseId: string, state: RunState, events: EventWriter, content: string, opts: { cancelled?: boolean } = {}): Promise<Outcome> {
  // Only the current lease holder may finish a run, and only once (guards cancel/wake-up races).
  const claim = await sql`
    update runs set finished_at = now()
    where id = ${run.id} and lease_id = ${leaseId} and finished_at is null and status not in ('done', 'error', 'cancelled')
    returning id`;
  if (!claim.length) return { kind: "done" };

  const status = opts.cancelled ? "cancelled" : "done";
  const started = run.started_at ? new Date(run.started_at).getTime() : Date.now();
  const durationMs = Date.now() - started;
  if (opts.cancelled) {
    await sql`update runs set cancel_requested = true where parent_run_id = ${run.id} and status in ('queued','running','waiting')`;
    await sql`update runs set status = 'cancelled', finished_at = now() where parent_run_id = ${run.id} and status in ('queued','waiting')`;
  }
  if (run.kind === "sub") {
    // Emit before the status flips so streams that stop at a terminal status still receive "done".
    events.emit("done", { durationMs });
    await events.flush();
    await sql`update runs set status = ${status}, result = ${content}, lease_id = null, lease_until = null, state = ${JSON.stringify(state)}::jsonb where id = ${run.id}`;
    if (run.parent_run_id) await wakeParent(run.parent_run_id);
    return { kind: "done" };
  }

  // Routine cards may have been approved/declined while the run was still writing.
  const routineIds = state.cards.filter((c) => c.type === "routine").map((c) => (c as { routineId: string }).routineId);
  if (routineIds.length) {
    const rows = await sql`select id, active from routines where id = any(${routineIds}::uuid[])`;
    for (const card of state.cards) {
      if (card.type !== "routine") continue;
      const r = rows.find((x) => x.id === card.routineId);
      card.status = !r ? "declined" : r.active ? "approved" : card.status;
    }
  }

  const meta = {
    runId: run.id,
    mode: state.mode,
    durationMs,
    thinkMs: state.thinkMs ?? 0,
    steps: state.steps.slice(-40),
    sources: finalSources(content, state.sources),
    cards: state.cards,
    plan: state.plan,
    cancelled: !!opts.cancelled,
  };
  const text = opts.cancelled ? content || "_Stopped._" : content;
  let messageId: string | null = null;
  if (run.conversation_id) {
    const rows = await sql`insert into messages (conversation_id, user_id, role, content, run_id, meta) values (${run.conversation_id}, ${run.user_id}, 'assistant', ${text}, ${run.id}, ${JSON.stringify(meta)}::jsonb) returning id`;
    messageId = rows[0].id as string;
    await sql`update conversations set updated_at = now() where id = ${run.conversation_id}`;
  }
  if (run.kind === "interview" && state.finished) await sql`update users set onboarded_at = coalesce(onboarded_at, now()) where id = ${run.user_id}`;
  events.emit("done", { messageId, durationMs, cancelled: !!opts.cancelled });
  await events.flush();
  await sql`update runs set status = ${status}, result = ${text}, lease_id = null, lease_until = null, state = ${JSON.stringify(state)}::jsonb where id = ${run.id}`;
  await sql`
    insert into usage_daily (user_id, day, tokens)
    select ${run.user_id}::uuid, current_date, coalesce(sum(tokens_used), 0)::int from runs where id = ${run.id} or parent_run_id = ${run.id}
    on conflict (user_id, day) do update set tokens = usage_daily.tokens + excluded.tokens`;

  // Post-run housekeeping (runs inside the worker's after() budget).
  try {
    if (!opts.cancelled && run.conversation_id && run.kind !== "interview" && durationMs > 25_000) {
      const conv = await sql`select title from conversations where id = ${run.conversation_id}`;
      await notifyUser(run.user_id, { title: run.kind === "routine" ? "Routine results are in" : "Tarrow finished", body: String(conv[0]?.title ?? "Your task is done"), url: `/c/${run.conversation_id}` });
    }
  } catch (err) {
    console.warn("push failed", err);
  }
  try {
    if (run.kind === "interview" && state.finished) {
      await rebuildLifeFile(run.user_id);
      await generateSuggestions(run.user_id);
    } else if (state.memoriesChanged) {
      await rebuildLifeFile(run.user_id);
    }
  } catch (err) {
    console.warn("post-run housekeeping failed", err);
  }
  return { kind: "done" };
}

/** Links actually cited in the answer first, then pages Tarrow read. */
function finalSources(content: string, read: Source[]): Source[] {
  const out: Source[] = [];
  const seen = new Set<string>();
  const add = (s: Source) => {
    const key = s.url.replace(/[#?].*$/, "").replace(/\/$/, "");
    if (seen.has(key) || out.length >= 12) return;
    seen.add(key);
    out.push(s);
  };
  for (const m of content.matchAll(/\[([^\]]{1,140})\]\((https?:\/\/[^)\s]+)\)/g)) add({ title: m[1], url: m[2] });
  for (const s of read) add(s);
  return out;
}

export async function wakeParent(parentId: string) {
  const rows = await sql`
    update runs set status = 'running', lease_id = null, lease_until = null, updated_at = now()
    where id = ${parentId} and status = 'waiting' and not cancel_requested
      and (lease_until is null or lease_until < now())
      and not exists (select 1 from runs c where c.parent_run_id = ${parentId} and c.status in ('queued','running','waiting'))
    returning id`;
  if (rows.length) await kick(parentId);
}

async function failRun(run: RunRow, leaseId: string, events: EventWriter, err: unknown) {
  const message = (err as Error)?.message ?? "Unknown error";
  if (message === "Lost lease") return;
  // Only the lease holder may fail the run (a stale worker must not clobber a healthy one).
  const claimed = await sql`
    update runs set status = 'error', error = ${message.slice(0, 500)}, finished_at = now(), lease_id = null, lease_until = null
    where id = ${run.id} and lease_id = ${leaseId} and status not in ('done', 'error', 'cancelled')
    returning id`;
  if (!claimed.length) return;
  events.emit("error", { message: "Something went wrong while working on this." });
  await events.flush();
  if (run.kind === "sub") {
    if (run.parent_run_id) await wakeParent(run.parent_run_id);
    return;
  }
  if (run.conversation_id) {
    const state = normalizeState(run.state);
    await sql`insert into messages (conversation_id, user_id, role, content, run_id, meta) values (${run.conversation_id}, ${run.user_id}, 'assistant', ${"I hit an error and couldn't finish that. Try again in a moment."}, ${run.id}, ${JSON.stringify({ runId: run.id, error: true, steps: state.steps.slice(-40), sources: state.sources })}::jsonb)`;
  }
}

/**
 * Recovers runs nobody is watching: re-kicks queued/running runs whose lease lapsed, wakes parents whose
 * sub-agents all finished, and closes out runs stuck for hours with a message. Called from page loads and cron.
 */
export async function sweepStale(userId?: string) {
  const stale = userId
    ? await sql`select id from runs where user_id = ${userId} and status in ('queued','running') and (lease_until is null or lease_until < now()) and updated_at < now() - interval '20 seconds' limit 10`
    : await sql`select id from runs where status in ('queued','running') and (lease_until is null or lease_until < now()) and updated_at < now() - interval '20 seconds' limit 50`;
  await Promise.all(stale.map((r) => kick(r.id as string)));
  const parents = userId
    ? await sql`select p.id from runs p where p.user_id = ${userId} and p.status = 'waiting' and not exists (select 1 from runs c where c.parent_run_id = p.id and c.status in ('queued','running','waiting')) limit 10`
    : await sql`select p.id from runs p where p.status = 'waiting' and not exists (select 1 from runs c where c.parent_run_id = p.id and c.status in ('queued','running','waiting')) limit 50`;
  await Promise.all(parents.map((r) => wakeParent(r.id as string)));
  const dead = await sql`
    update runs set status = 'error', error = 'Timed out', finished_at = now(), lease_id = null, lease_until = null
    where status in ('queued','running','waiting') and created_at < now() - interval '3 hours' and (${userId ?? null}::uuid is null or user_id = ${userId ?? null}::uuid)
    returning id, user_id, conversation_id, parent_run_id`;
  for (const r of dead) {
    if (!r.parent_run_id && r.conversation_id) {
      await sql`insert into messages (conversation_id, user_id, role, content, run_id, meta) values (${r.conversation_id}, ${r.user_id}, 'assistant', ${"This task ran too long and was stopped. Try asking again, maybe with a narrower request."}, ${r.id}, ${JSON.stringify({ runId: r.id, error: true })}::jsonb)`;
    }
  }
  return { kicked: stale.length, woken: parents.length, timedOut: dead.length };
}

/** Re-kick runs whose worker died or whose rate-limit wait elapsed. */
export async function ensureProgress(runIds: string[]) {
  if (!runIds.length) return;
  const stale = await sql`
    select id from runs where id = any(${runIds}::uuid[]) and status in ('queued','running')
      and (lease_until is null or lease_until < now()) and updated_at < now() - interval '4 seconds'`;
  await Promise.all(stale.map((r) => kick(r.id as string)));
}

export async function cancelRun(runId: string, userId: string) {
  const rows = await sql`update runs set cancel_requested = true where id = ${runId} and user_id = ${userId} and status in ('queued','running','waiting') returning id, status, lease_until`;
  if (!rows.length) return false;
  // A run that nobody is working on (waiting on agents, or between leases) gets closed out right away.
  const r = rows[0];
  if (r.status === "waiting" || !r.lease_until || new Date(r.lease_until as string) < new Date()) {
    const leaseId = randomUUID();
    const leased = await sql`update runs set lease_id = ${leaseId}, lease_until = now() + interval '60 seconds' where id = ${runId} and (lease_until is null or lease_until < now() or status = 'waiting') returning *`;
    if (leased.length) {
      const run = leased[0] as unknown as RunRow;
      const events = new EventWriter(run.id, run.seq);
      await finalize(run, leaseId, normalizeState(run.state), events, "", { cancelled: true });
    }
  }
  return true;
}
