import "server-only";

/**
 * OpenAI-compatible LLM router over open-weight models.
 * Order: custom endpoint → OpenRouter (GLM-5.3-Flash, DeepSeek V4.1 Flash) → Groq (gpt-oss) as the free fallback. Any
 * OpenAI-compatible endpoint via LLM_BASE_URL + LLM_API_KEY + LLM_MODELS.
 * Handles rate limits by rotating across (provider, model) candidates with cooldowns.
 */

export type ToolCall = { id: string; type: "function"; function: { name: string; arguments: string } };
export type ChatMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: ToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

export type ToolDef = {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
};

export type Tier = "main" | "fast";

type Candidate = { provider: string; baseUrl: string; apiKey: string; model: string; maxInput: number };

export type ChatResult = {
  content: string;
  reasoning: string;
  toolCalls: ToolCall[];
  usage: { prompt: number; completion: number; cost?: number };
  model: string;
};

export class RateLimitedError extends Error {
  /** quotedWaitMs: the provider's own "try again in" (hours-long for daily quotas), before our re-probe cap. */
  constructor(public waitMs: number, public quotedWaitMs = waitMs) {
    super(`All models are rate limited; retry in ${Math.ceil(waitMs / 1000)}s`);
  }
}

const cooldowns = new Map<string, number>();
const quotedUntil = new Map<string, number>();
const keyOf = (c: Candidate) => `${c.provider}:${c.model}`;

function list(v: string | undefined, fallback: string[]) {
  const items = (v ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  return items.length ? items : fallback;
}

function candidates(tier: Tier): Candidate[] {
  const out: Candidate[] = [];
  const maxInput = Number(process.env.LLM_MAX_INPUT_TOKENS || 6500);
  if (process.env.LLM_BASE_URL && process.env.LLM_API_KEY) {
    const models = list(tier === "fast" ? process.env.LLM_FAST_MODELS : process.env.LLM_MODELS, []);
    for (const model of models) out.push({ provider: "custom", baseUrl: process.env.LLM_BASE_URL, apiKey: process.env.LLM_API_KEY, model, maxInput: 60000 });
  }
  if (process.env.OPENROUTER_API_KEY) {
    const models = list(tier === "fast" ? process.env.OPENROUTER_FAST_MODELS : process.env.OPENROUTER_MODELS, ["z-ai/glm-5.3-flash", "deepseek/deepseek-v4.1-flash"]);
    // Input is ~85% of spend; 40K keeps a research step under ~$0.01 while fitting long chats and pages.
    const orMax = Number(process.env.OPENROUTER_MAX_INPUT_TOKENS || 40000);
    for (const model of models) out.push({ provider: "openrouter", baseUrl: "https://openrouter.ai/api/v1", apiKey: process.env.OPENROUTER_API_KEY, model, maxInput: orMax });
  }
  const groqKeys = [process.env.GROQ_API_KEY, process.env.GROQ_API_KEY_2].filter(Boolean) as string[];
  const groqModels = list(tier === "fast" ? process.env.GROQ_FAST_MODELS : process.env.GROQ_MODELS,
    tier === "fast" ? ["openai/gpt-oss-20b", "qwen/qwen3.8-27b", "openai/gpt-oss-120b"] : ["openai/gpt-oss-120b", "qwen/qwen3.8-27b", "openai/gpt-oss-20b"]);
  for (const model of groqModels) {
    groqKeys.forEach((apiKey, i) =>
      out.push({ provider: `groq${i || ""}`, baseUrl: "https://api.groq.com/openai/v1", apiKey, model, maxInput: model.startsWith("qwen") ? Math.min(maxInput, 6400) : maxInput }));
  }
  if (!out.length) throw new Error("No LLM provider configured (set GROQ_API_KEY)");
  return out;
}

/** Max input tokens we should build prompts for: sized to the primary provider (floor 4000). Smaller fallbacks are skipped for prompts they can't fit. */
export function inputBudget(tier: Tier = "main") {
  return Math.max(4000, candidates(tier)[0].maxInput - 400);
}

/** Rough token estimate (chars / 3.3 is conservative for English + JSON). */
export function estimateTokens(value: unknown): number {
  const s = typeof value === "string" ? value : JSON.stringify(value);
  return Math.ceil(s.length / 3.3);
}

function parseWait(res: Response, message: string): number {
  const header = res.headers.get("retry-after");
  if (header && !Number.isNaN(Number(header))) return Number(header) * 1000;
  const m = message.match(/try again in (?:(\d+)m)?(?:([\d.]+)s)?/i);
  if (m && (m[1] || m[2])) return (Number(m[1] || 0) * 60 + Number(m[2] || 0)) * 1000;
  return 20_000;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export type ChatOptions = {
  messages: ChatMessage[];
  tools?: ToolDef[];
  tier?: Tier;
  /** OpenRouter model to try first (e.g. a stronger model for a final synthesis); the tier's usual candidates stay as fallbacks. */
  model?: string;
  maxTokens?: number;
  temperature?: number;
  json?: boolean;
  effort?: "low" | "medium" | "high";
  onDelta?: (d: { content?: string; reasoning?: string }) => void;
  /** Longest we are willing to sleep waiting for a rate limit before giving up. */
  maxWaitMs?: number;
  onWait?: (ms: number) => void;
  /** Epoch ms after which no new attempt is started. */
  deadlineAt?: number;
  /** Called before a retry when the failed attempt already streamed partial output. */
  onReset?: () => void;
  signal?: AbortSignal;
};

export async function chat(opts: ChatOptions): Promise<ChatResult> {
  const tier = opts.tier ?? "main";
  const maxWait = opts.maxWaitMs ?? 25_000;
  const need = estimateTokens(opts.messages) + estimateTokens(opts.tools ?? []);
  const base = candidates(tier);
  const preferred: Candidate[] =
    opts.model && process.env.OPENROUTER_API_KEY
      ? [{ provider: "openrouter", baseUrl: "https://openrouter.ai/api/v1", apiKey: process.env.OPENROUTER_API_KEY, model: opts.model, maxInput: Number(process.env.OPENROUTER_MAX_INPUT_TOKENS || 40000) }]
      : [];
  const pool = [...preferred, ...base.filter((c) => !preferred.some((x) => keyOf(x) === keyOf(c)))];
  const fitting = pool.filter((c) => c.maxInput >= need);
  const all = fitting.length ? fitting : pool;
  const deadline = Math.min(Date.now() + maxWait + 90_000, opts.deadlineAt ?? Infinity);
  let lastError: unknown = null;
  let toolFailures = 0;
  const shrunk = new Map<string, number>();

  while (Date.now() < deadline) {
    const now = Date.now();
    const ready = all.filter((c) => (cooldowns.get(keyOf(c)) ?? 0) <= now);
    if (!ready.length) {
      const soonest = Math.min(...all.map((c) => cooldowns.get(keyOf(c)) ?? 0)) - now;
      if (soonest > maxWait || now + soonest > deadline) {
        const quoted = Math.min(...all.map((x) => quotedUntil.get(keyOf(x)) ?? 0)) - now;
        throw new RateLimitedError(soonest, Math.max(soonest, quoted));
      }
      if (soonest > 1500) opts.onWait?.(soonest);
      await sleep(Math.max(250, soonest));
      continue;
    }
    const c = ready[0];
    let streamed = false;
    const maxTokens = shrunk.get(keyOf(c)) ?? opts.maxTokens;
    try {
      return await callOnce(c, { ...opts, maxTokens, onDelta: (d) => { streamed = true; opts.onDelta?.(d); } });
    } catch (err) {
      lastError = err;
      if (streamed) opts.onReset?.();
      const e = err as { status?: number; waitMs?: number; code?: string; message?: string };
      if (e.status === 429) {
        // Near a daily/minute token limit the reservation includes max_tokens; retry once with a smaller output cap if it would fit.
        const m = e.message?.match(/Limit (\d+), Used (\d+), Requested (\d+)/);
        if (m && !shrunk.has(keyOf(c))) {
          const [limit, used, requested] = [Number(m[1]), Number(m[2]), Number(m[3])];
          const sent = maxTokens ?? 2048;
          const fits = limit - used - (requested - sent) - 50;
          if (fits >= 500 && fits < sent) {
            shrunk.set(keyOf(c), fits);
            continue;
          }
        }
        // Daily-limit errors quote long waits, but windows roll and smaller requests may fit sooner: re-probe within a minute.
        cooldowns.set(keyOf(c), Date.now() + Math.min(e.waitMs ?? 20_000, 60_000));
        quotedUntil.set(keyOf(c), Date.now() + (e.waitMs ?? 20_000));
        continue;
      }
      if (e.status === 413) {
        // Prompt is too big for this model; skip it for this call only.
        cooldowns.set(keyOf(c), Date.now() + 1500);
        if (ready.length === 1) throw err;
        continue;
      }
      if (e.code === "tool_use_failed" && toolFailures < 2) {
        toolFailures++;
        continue; // sampling again usually fixes a malformed tool call
      }
      if (e.status && e.status >= 500) {
        cooldowns.set(keyOf(c), Date.now() + 15_000);
        continue;
      }
      if (e.status === 402 || e.status === 401 || e.status === 403) {
        // Out of credits / bad key: fall back to the next provider for a while.
        cooldowns.set(keyOf(c), Date.now() + 5 * 60_000);
        continue;
      }
      if (e.status === 400 || e.status === 404) {
        cooldowns.set(keyOf(c), Date.now() + 5_000);
        continue;
      }
      if (opts.signal?.aborted) throw err;
      cooldowns.set(keyOf(c), Date.now() + 5_000);
    }
  }
  throw lastError ?? new Error("LLM call failed");
}

class LlmHttpError extends Error {
  constructor(public status: number, message: string, public waitMs?: number, public code?: string) {
    super(message);
  }
}

/** Hosts with multi-second median time-to-first-token or near-zero uptime on OpenRouter (checked Sep 2026). */
const SLOW_OPENROUTER_HOSTS = list(process.env.OPENROUTER_IGNORE_PROVIDERS, ["gmicloud", "open-inference", "sail-research"]);

async function callOnce(c: Candidate, opts: ChatOptions): Promise<ChatResult> {
  const isQwen = c.model.includes("qwen");
  const isOss = c.model.includes("gpt-oss");
  const body: Record<string, unknown> = {
    model: c.model,
    messages: opts.messages,
    stream: true,
    // Groq's free tier caps qwen output at 1,000 tokens/minute; larger max_tokens is rejected outright.
    max_tokens: isQwen && c.provider.startsWith("groq") ? Math.min(opts.maxTokens ?? 2048, Number(process.env.GROQ_QWEN_MAX_OUTPUT || 1000)) : opts.maxTokens ?? 2048,
    temperature: opts.temperature ?? 0.6,
  };
  if (c.provider.startsWith("groq")) body.stream_options = { include_usage: true };
  if (c.provider === "openrouter") {
    body.usage = { include: true };
    // Life data: only hosts that don't store or train on prompts; tools/JSON only on hosts that support them.
    // GLM reasons before every step, so tokens/sec decides latency: the default price-weighted routing lands on
    // ~12-20 tok/s hosts and turns an 8s step into 45s. Throughput-first still falls back to the others.
    body.provider = { data_collection: "deny", require_parameters: !!opts.tools?.length, ignore: SLOW_OPENROUTER_HOSTS, sort: process.env.OPENROUTER_SORT || "throughput" };
    // GLM-5.3-Flash always reasons (it can't be disabled), and reasoning counts toward max_tokens,
    // so small caps (e.g. triage) would leave no room for the answer. Output is only billed as generated.
    body.reasoning = { effort: opts.json ? "low" : opts.effort ?? "medium", exclude: !!opts.json };
    body.max_tokens = Math.max(Number(body.max_tokens) || 0, opts.json ? 1500 : 2000);
  }
  if (opts.tools?.length) {
    body.tools = opts.tools;
    body.tool_choice = "auto";
  }
  if (opts.json) body.response_format = { type: "json_object" };
  if (c.provider.startsWith("groq")) {
    if (isOss) body.reasoning_effort = opts.effort ?? "medium";
    if (isQwen) body.reasoning_format = opts.json ? "hidden" : "parsed";
  }

  const res = await fetch(`${c.baseUrl}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${c.apiKey}`, "Content-Type": "application/json", "HTTP-Referer": "https://tarrow.vercel.app", "X-Title": "Tarrow" },
    body: JSON.stringify(body),
    signal: opts.signal ? AbortSignal.any([opts.signal, AbortSignal.timeout(120_000)]) : AbortSignal.timeout(120_000),
  });
  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => "");
    let message = text;
    let code: string | undefined;
    try {
      const j = JSON.parse(text);
      message = j.error?.message ?? text;
      code = j.error?.code;
    } catch {}
    throw new LlmHttpError(res.status, `${c.model}: ${message.slice(0, 300)}`, res.status === 429 ? parseWait(res, message) : undefined, code);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let content = "";
  let reasoning = "";
  const calls: { id: string; name: string; args: string }[] = [];
  let usage: ChatResult["usage"] = { prompt: 0, completion: 0 };

  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (data === "[DONE]") continue;
      let chunk: {
        error?: { message?: string; code?: string };
        choices?: { delta?: { content?: string | null; reasoning?: string; reasoning_content?: string; tool_calls?: { index: number; id?: string; function?: { name?: string; arguments?: string } }[] } }[];
        usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: number };
        x_groq?: { usage?: { prompt_tokens?: number; completion_tokens?: number }; error?: string };
      };
      try {
        chunk = JSON.parse(data);
      } catch {
        continue;
      }
      if (chunk.error) throw new LlmHttpError(400, `${c.model}: ${chunk.error.message}`, undefined, chunk.error.code);
      const u = chunk.usage ?? chunk.x_groq?.usage;
      if (u) usage = { prompt: u.prompt_tokens ?? 0, completion: u.completion_tokens ?? 0, cost: (u as { cost?: number }).cost };
      const delta = chunk.choices?.[0]?.delta;
      if (!delta) continue;
      const r = delta.reasoning ?? delta.reasoning_content;
      if (r) {
        reasoning += r;
        opts.onDelta?.({ reasoning: r });
      }
      if (delta.content) {
        content += delta.content;
        opts.onDelta?.({ content: delta.content });
      }
      for (const tc of delta.tool_calls ?? []) {
        const slot = (calls[tc.index] ??= { id: "", name: "", args: "" });
        if (tc.id) slot.id = tc.id;
        if (tc.function?.name) slot.name += tc.function.name;
        if (tc.function?.arguments) slot.args += tc.function.arguments;
      }
    }
  }

  // Some open models leak <think> blocks into content.
  const thinkMatch = content.match(/^\s*<think>([\s\S]*?)<\/think>\s*/);
  if (thinkMatch) {
    reasoning += thinkMatch[1];
    content = content.slice(thinkMatch[0].length);
  }

  return {
    content,
    reasoning,
    toolCalls: calls.filter(Boolean).filter((t) => t.name).map((t, i) => ({
      id: t.id || `call_${Date.now()}_${i}`,
      type: "function" as const,
      function: { name: t.name, arguments: t.args || "{}" },
    })),
    usage,
    model: c.model,
  };
}

/** One-shot JSON completion on the fast tier. */
export async function chatJson<T>(system: string, user: string, opts: { tier?: Tier; maxTokens?: number } = {}): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await chat({
      tier: opts.tier ?? "fast",
      messages: [{ role: "system", content: system }, { role: "user", content: user }],
      json: true,
      maxTokens: opts.maxTokens ?? 1200,
      temperature: 0.4,
      effort: "low",
    });
    try {
      const text = res.content.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "");
      return JSON.parse(text) as T;
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr;
}
