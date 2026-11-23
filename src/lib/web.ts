import "server-only";
import { lookup } from "node:dns/promises";
import { lookup as dnsLookup } from "node:dns";
import { Agent, fetch as undiciFetch } from "undici";
import { isIP } from "node:net";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36";

export type SearchResult = { title: string; url: string; snippet: string };

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", "#39": "'", "#x27": "'", "#x2F": "/", mdash: "—", ndash: "–", hellip: "…", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“" };

export function decodeEntities(s: string) {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z0-9#]+);/gi, (m, name) => ENTITIES[name] ?? m);
}

const stripTags = (s: string) => decodeEntities(s.replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim();

async function fetchText(url: string, init: RequestInit = {}, timeoutMs = 10_000) {
  const res = await fetch(url, {
    ...init,
    headers: { "User-Agent": UA, "Accept-Language": "en-US,en;q=0.9", Accept: "text/html,application/xhtml+xml,*/*;q=0.8", ...(init.headers ?? {}) },
    signal: AbortSignal.timeout(timeoutMs),
    redirect: "follow",
  });
  return { res, text: await res.text() };
}

async function ddg(query: string): Promise<SearchResult[]> {
  const { res, text } = await fetchText("https://html.duckduckgo.com/html/", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ q: query, kl: "us-en" }).toString(),
  });
  if (!res.ok || text.includes("anomaly-modal")) throw new Error(`ddg blocked ${res.status}`);
  const out: SearchResult[] = [];
  const blocks = text.split(/<div class="result results_links/).slice(1);
  for (const b of blocks) {
    if (b.includes("result--ad")) continue;
    const a = b.match(/class="result__a" href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/);
    if (!a) continue;
    let href = decodeEntities(a[1]);
    const uddg = href.match(/[?&]uddg=([^&]+)/);
    if (uddg) href = decodeURIComponent(uddg[1]);
    if (href.startsWith("//")) href = "https:" + href;
    if (!/^https?:\/\//.test(href) || href.includes("duckduckgo.com/y.js")) continue;
    const sn = b.match(/class="result__snippet"[^>]*>([\s\S]*?)<\/a>/);
    out.push({ title: stripTags(a[2]), url: href, snippet: sn ? stripTags(sn[1]) : "" });
  }
  return out;
}

async function brave(query: string): Promise<SearchResult[]> {
  const { res, text } = await fetchText(`https://search.brave.com/search?q=${encodeURIComponent(query)}&source=web`);
  if (!res.ok) throw new Error(`brave ${res.status}`);
  const out: SearchResult[] = [];
  const blocks = text.split(/data-type="web"/).slice(1);
  for (const b of blocks) {
    const a = b.match(/<a href="(https?:\/\/[^"]+)"[^>]*>/);
    const t = b.match(/class="title[^"]*"[^>]*title="([^"]*)"/) ?? b.match(/class="title[^"]*"[^>]*>([\s\S]*?)<\/div>/);
    if (!a || !t) continue;
    const url = decodeEntities(a[1]);
    if (url.includes("search.brave.com")) continue;
    const sn = b.match(/class="content[^"]*"[^>]*>([\s\S]*?)<\/div>/);
    out.push({ title: stripTags(t[1]), url, snippet: sn ? stripTags(sn[1]).slice(0, 300) : "" });
  }
  return out;
}

async function bing(query: string): Promise<SearchResult[]> {
  const { res, text } = await fetchText(`https://www.bing.com/search?q=${encodeURIComponent(query)}&setlang=en-US&cc=US`);
  if (!res.ok) throw new Error(`bing ${res.status}`);
  const out: SearchResult[] = [];
  for (const b of text.split(/<li class="b_algo"/).slice(1)) {
    const a = b.match(/<h2[^>]*>\s*<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/);
    if (!a) continue;
    let url = decodeEntities(a[1]);
    const u = url.match(/[?&]u=a1([^&]+)/);
    if (u) {
      try {
        url = Buffer.from(u[1].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
      } catch {}
    }
    if (!/^https?:\/\//.test(url) || url.includes("bing.com/")) continue;
    const p = b.match(/<p[^>]*>([\s\S]*?)<\/p>/);
    out.push({ title: stripTags(a[2]), url, snippet: p ? stripTags(p[1]).slice(0, 300) : "" });
  }
  return out;
}

async function tavily(query: string): Promise<SearchResult[]> {
  const res = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.TAVILY_API_KEY}` },
    body: JSON.stringify({ query, max_results: 8 }),
    signal: AbortSignal.timeout(12_000),
  });
  if (!res.ok) throw new Error(`tavily ${res.status}`);
  const j = (await res.json()) as { results?: { title: string; url: string; content: string }[] };
  return (j.results ?? []).map((r) => ({ title: r.title, url: r.url, snippet: r.content?.slice(0, 300) ?? "" }));
}

async function braveApi(query: string): Promise<SearchResult[]> {
  const res = await fetch(`https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=10`, {
    headers: { Accept: "application/json", "X-Subscription-Token": process.env.BRAVE_API_KEY! },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`brave api ${res.status}`);
  const j = (await res.json()) as { web?: { results?: { title: string; url: string; description?: string }[] } };
  return (j.web?.results ?? []).map((r) => ({ title: stripTags(r.title), url: r.url, snippet: stripTags(r.description ?? "") }));
}

async function serper(query: string): Promise<SearchResult[]> {
  const res = await fetch("https://google.serper.dev/search", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-API-KEY": process.env.SERPER_API_KEY! },
    body: JSON.stringify({ q: query, num: 10 }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`serper ${res.status}`);
  const j = (await res.json()) as { organic?: { title: string; link: string; snippet?: string }[] };
  return (j.organic ?? []).map((r) => ({ title: r.title, url: r.link, snippet: r.snippet ?? "" }));
}

/** Last resort: Groq's hosted browser_search on a small open model. */
const GROQ_SEARCH_MODELS = ["openai/gpt-oss-20b", "openai/gpt-oss-120b"];
const groqSearchCooldown = new Map<string, number>();
let groqSearchActive = 0;

/** Groq's hosted browser_search (reliable from datacenter IPs). Rotates models, waits out short rate limits. */
async function groqSearch(query: string): Promise<SearchResult[]> {
  if (!process.env.GROQ_API_KEY) return [];
  const deadline = Date.now() + 45_000;
  while (groqSearchActive >= 2 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 300));
  groqSearchActive++;
  try {
    while (Date.now() < deadline) {
      const now = Date.now();
      const model = GROQ_SEARCH_MODELS.find((m) => (groqSearchCooldown.get(m) ?? 0) <= now);
      if (!model) {
        const soonest = Math.min(...GROQ_SEARCH_MODELS.map((m) => groqSearchCooldown.get(m) ?? 0)) - now;
        if (soonest > deadline - now) break;
        await new Promise((r) => setTimeout(r, soonest + 100));
        continue;
      }
      const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          messages: [{ role: "user", content: `Run exactly one web search for: ${query}\nThen reply with just "ok".` }],
          tools: [{ type: "browser_search" }],
          max_tokens: 200,
          reasoning_effort: "low",
        }),
        signal: AbortSignal.timeout(30_000),
      });
      if (res.status === 429 || res.status === 413 || res.status >= 500) {
        const text = await res.text().catch(() => "");
        const m = text.match(/try again in (?:(\d+)m)?(?:([\d.]+)s)?/i);
        const wait = m && (m[1] || m[2]) ? (Number(m[1] || 0) * 60 + Number(m[2] || 0)) * 1000 : 15_000;
        groqSearchCooldown.set(model, Date.now() + wait);
        continue;
      }
      if (!res.ok) throw new Error(`groq search ${res.status}`);
      const j = (await res.json()) as { choices?: { message?: { executed_tools?: { type: string; search_results?: { results?: { title: string; url: string; content?: string }[] } }[] } }[] };
      const tools = j.choices?.[0]?.message?.executed_tools ?? [];
      const results = tools.filter((t) => t.type === "browser_search").flatMap((t) => t.search_results?.results ?? []);
      return results.map((r) => ({ title: r.title, url: r.url, snippet: (r.content ?? "").replace(/\bL\d+:\s*/g, " ").replace(/\s+/g, " ").slice(0, 300) }));
    }
    throw new Error("groq search rate limited");
  } finally {
    groqSearchActive--;
  }
}

type Engine = { name: string; run: (q: string) => Promise<SearchResult[]>; enabled: () => boolean };

const ENGINES: Engine[] = [
  { name: "tavily", run: tavily, enabled: () => !!process.env.TAVILY_API_KEY },
  { name: "brave-api", run: braveApi, enabled: () => !!process.env.BRAVE_API_KEY },
  { name: "serper", run: serper, enabled: () => !!process.env.SERPER_API_KEY },
  { name: "ddg", run: ddg, enabled: () => true },
  { name: "brave", run: brave, enabled: () => true },
  { name: "bing", run: bing, enabled: () => true },
  { name: "groq", run: groqSearch, enabled: () => !!process.env.GROQ_API_KEY },
];

const engineCooldown = new Map<string, number>();
const searchCache = new Map<string, { at: number; results: SearchResult[] }>();

export async function webSearch(query: string, count = 8): Promise<SearchResult[]> {
  const key = query.toLowerCase().trim();
  const hit = searchCache.get(key);
  if (hit && Date.now() - hit.at < 15 * 60_000) return hit.results.slice(0, count);
  let lastErr: unknown = null;
  for (const engine of ENGINES) {
    if (!engine.enabled() || (engineCooldown.get(engine.name) ?? 0) > Date.now()) continue;
    try {
      const results = dedupe(await engine.run(query));
      // Scrapers sometimes serve bot-degraded, off-topic results; treat those as a miss.
      if (results.length && ["ddg", "bing", "brave"].includes(engine.name) && !relevant(query, results)) {
        lastErr = new Error(`${engine.name} returned off-topic results`);
        continue;
      }
      if (results.length) {
        if (searchCache.size > 300) searchCache.clear();
        searchCache.set(key, { at: Date.now(), results });
        return results.slice(0, count);
      }
      // Scrapers return zero results when they're serving a captcha; back off from them.
      if (["ddg", "bing", "brave"].includes(engine.name)) engineCooldown.set(engine.name, Date.now() + 5 * 60_000);
    } catch (err) {
      lastErr = err;
      engineCooldown.set(engine.name, Date.now() + ({ groq: 5_000, brave: 5 * 60_000, ddg: 15 * 60_000 } as Record<string, number>)[engine.name] || 5 * 60_000);
    }
  }
  if (lastErr) {
    console.warn("webSearch failed", query, (lastErr as Error).message);
    throw new SearchUnavailableError();
  }
  return [];
}

export class SearchUnavailableError extends Error {
  constructor() {
    super("Web search is temporarily unavailable");
  }
}

const STOPWORDS = new Set("the and for with near best top what where when how who why are was this that from into your you our site com www http https 2024 2025 2026 2027 in on of to a an is it at by or me my".split(" "));

function relevant(query: string, results: SearchResult[]) {
  const terms = query
    .toLowerCase()
    .replace(/site:\S+/g, " ")
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 3 && !STOPWORDS.has(t));
  if (!terms.length) return true;
  const top = results.slice(0, 6);
  const need = Math.max(1, Math.ceil(terms.length * 0.4));
  const hits = top.filter((r) => {
    const hay = `${r.title} ${r.snippet} ${r.url}`.toLowerCase();
    return terms.filter((t) => hay.includes(t.length > 5 ? t.slice(0, t.length - 1) : t)).length >= need;
  }).length;
  return hits >= Math.min(2, top.length) && hits / top.length >= 0.5;
}

function dedupe(results: SearchResult[]) {
  const seen = new Set<string>();
  return results.filter((r) => {
    const k = r.url.replace(/[#?].*$/, "").replace(/\/$/, "");
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

function privateIp(ip: string): boolean {
  if (isIP(ip) === 6) {
    // Allow only global unicast (2000::/3). This rejects loopback, link-local, ULA, IPv4-mapped (any notation),
    // NAT64 (64:ff9b::/96) and site-local; also reject 6to4, Teredo and documentation ranges that can embed or fake IPv4.
    const groups = ip.toLowerCase().split(":");
    if (!groups[0]) return true;
    const first = parseInt(groups[0], 16);
    const second = parseInt(groups[1] || "0", 16);
    if (first < 0x2000 || first > 0x3fff) return true;
    if (first === 0x2002 || (first === 0x2001 && (second === 0 || second === 0xdb8))) return true;
    return false;
  }
  if (isIP(ip) !== 4) return true;
  const [a, b] = ip.split(".").map(Number);
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
}

export async function assertPublicUrl(raw: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("Invalid URL");
  }
  if (!/^https?:$/.test(url.protocol)) throw new Error("Only http(s) URLs are allowed");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".local") || host.endsWith(".internal")) throw new Error("Blocked host");
  const addrs = isIP(host) ? [{ address: host }] : await lookup(host, { all: true });
  if (addrs.some((a) => privateIp(a.address))) throw new Error("Blocked host");
  return url;
}

export type PageContent = { url: string; title: string; text: string; events: string[] };

function htmlToText(html: string) {
  let h = html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|svg|iframe|template|form|button|select)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<(nav|footer|aside)[\s\S]*?<\/\1>/gi, " ");
  const main = h.match(/<(main|article)[\s\S]*?<\/\1>/i);
  if (main && main[0].length > 1500) h = main[0];
  h = h
    .replace(/<a [^>]*href="(https?:[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, (_, href, inner) => {
      const t = stripTags(inner);
      return t && t.length > 2 && t.length < 80 ? ` [${t}](${decodeEntities(href)}) ` : ` ${t} `;
    })
    .replace(/<(h[1-6])[^>]*>/gi, "\n\n## ")
    .replace(/<\/(h[1-6])>/gi, "\n")
    .replace(/<li[^>]*>/gi, "\n- ")
    .replace(/<(br|hr)[^>]*>/gi, "\n")
    .replace(/<\/(p|div|section|tr|ul|ol|table|header)>/gi, "\n")
    .replace(/<t[dh][^>]*>/gi, " | ")
    .replace(/<[^>]+>/g, " ");
  return decodeEntities(h)
    .split("\n")
    .map((l) => l.replace(/[ \t ]+/g, " ").trim())
    .filter((l, i, arr) => l && !(l === arr[i - 1]))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n");
}

/** Pull schema.org Event data out of JSON-LD — Eventbrite, Luma, Meetup etc. all publish it. */
function jsonLdEvents(html: string): string[] {
  const out: string[] = [];
  for (const m of html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const data = JSON.parse(m[1].trim());
      const items: unknown[] = [];
      const walk = (v: unknown) => {
        if (Array.isArray(v)) v.forEach(walk);
        else if (v && typeof v === "object") {
          const o = v as Record<string, unknown>;
          if (o["@graph"]) walk(o["@graph"]);
          if (o.itemListElement) walk((o.itemListElement as unknown[]).map((x) => (x as Record<string, unknown>)?.item ?? x));
          const t = o["@type"];
          if (typeof t === "string" ? /Event$/.test(t) : Array.isArray(t) && t.some((x) => /Event$/.test(String(x)))) items.push(o);
        }
      };
      walk(data);
      for (const it of items.slice(0, 25)) {
        const e = it as Record<string, unknown>;
        const loc = e.location as Record<string, unknown> | undefined;
        const addr = loc?.address;
        const place = [loc?.name, typeof addr === "string" ? addr : (addr as Record<string, unknown> | undefined)?.streetAddress].filter(Boolean).join(", ");
        const offers = (Array.isArray(e.offers) ? e.offers[0] : e.offers) as Record<string, unknown> | undefined;
        const price = offers?.price != null ? `${offers.price} ${offers.priceCurrency ?? ""}`.trim() : "";
        out.push([`EVENT: ${e.name}`, e.startDate && `start ${e.startDate}`, place && `@ ${place}`, price && `price ${price}`, e.url && `url ${e.url}`].filter(Boolean).join(" | "));
      }
    } catch {}
  }
  return out;
}

// Every connection re-validates the resolved IPs, so DNS rebinding between check and fetch can't reach private hosts.
const pinnedAgent = new Agent({
  connect: {
    lookup: ((hostname: string, options: { all?: boolean }, callback: (err: Error | null, address: string | { address: string; family: number }[], family?: number) => void) => {
      dnsLookup(hostname, { all: true }, (err, addresses) => {
        if (err) return callback(err, "");
        if (!addresses.length || addresses.some((a) => privateIp(a.address))) return callback(new Error("Blocked host"), "");
        if (options?.all) return callback(null, addresses);
        callback(null, addresses[0].address, addresses[0].family);
      });
    }) as never,
  },
});

function safeFetch(url: URL, init: { headers: Record<string, string>; signal: AbortSignal; redirect: "manual" }) {
  return undiciFetch(url, { ...init, dispatcher: pinnedAgent }) as unknown as Promise<Response>;
}

export async function readPage(raw: string, maxChars = 9000): Promise<PageContent> {
  const url = await assertPublicUrl(raw);
  let title = "";
  let text = "";
  let events: string[] = [];
  try {
    const res = await safeFetch(url, {
      headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml,text/plain,application/json;q=0.9,*/*;q=0.5", "Accept-Language": "en-US,en;q=0.9" },
      signal: AbortSignal.timeout(12_000),
      redirect: "manual",
    });
    let final = res;
    // Follow up to 4 redirects manually so every hop is SSRF-checked.
    let hops = 0;
    let current = url;
    while (final.status >= 300 && final.status < 400 && final.headers.get("location") && hops < 4) {
      current = await assertPublicUrl(new URL(final.headers.get("location")!, current).toString());
      final = await safeFetch(current, { headers: { "User-Agent": UA, Accept: "text/html,*/*;q=0.8" }, signal: AbortSignal.timeout(12_000), redirect: "manual" });
      hops++;
    }
    const type = final.headers.get("content-type") ?? "";
    const body = (await final.text()).slice(0, 3_000_000);
    if (final.ok) {
      if (type.includes("html")) {
        title = stripTags(body.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "");
        const desc = body.match(/<meta[^>]+(?:name|property)="(?:og:)?description"[^>]+content="([^"]*)"/i)?.[1];
        events = jsonLdEvents(body);
        text = (desc ? decodeEntities(desc) + "\n\n" : "") + htmlToText(body);
      } else if (type.includes("json") || type.includes("text")) {
        text = body;
      }
    }
  } catch (err) {
    if ((err as Error).message === "Blocked host") throw err;
  }
  // JS-heavy or blocked pages: fall back to Jina's reader, which renders them.
  if (text.replace(/\s/g, "").length < 400) {
    try {
      const r = await fetch(`https://r.jina.ai/${url.toString()}`, { headers: { Accept: "text/plain", "X-Return-Format": "markdown" }, signal: AbortSignal.timeout(20_000) });
      if (r.ok) {
        const md = await r.text();
        const t = md.match(/^Title:\s*(.+)$/m)?.[1];
        if (t) title = title || t;
        const content = md.split(/Markdown Content:\s*/)[1] ?? md;
        if (content.trim().length > text.trim().length) text = content;
      }
    } catch {}
  }
  return { url: url.toString(), title: title.slice(0, 200), text: text.slice(0, maxChars), events };
}

export function domainOf(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export async function debugSearch(query: string) {
  const out: Record<string, unknown> = {};
  for (const engine of ENGINES) {
    if (!engine.enabled()) continue;
    const t = Date.now();
    try {
      const results = dedupe(await engine.run(query));
      out[engine.name] = { ms: Date.now() - t, count: results.length, relevant: relevant(query, results), top: results.slice(0, 3).map((r) => r.title + " | " + r.url) };
    } catch (err) {
      out[engine.name] = { ms: Date.now() - t, error: (err as Error).message };
    }
  }
  return out;
}
