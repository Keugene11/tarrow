import "server-only";
import { decodeEntities } from "./web";

// Keyless, structured sources for jobs and people:
// - YC's hiring companies (yc-oss mirror of the YC directory) + each company page (founders with LinkedIn/X, open roles with salary)
// - Hacker News "Who is hiring?" (Algolia API)
// - Public ATS job boards (Ashby, Greenhouse, Lever) for named companies

const UA = "Mozilla/5.0 (compatible; TarrowBot/1.0; +https://tarrow.vercel.app)";
const HOUR = 3600_000;

export type JobPosting = {
  title: string;
  company: string;
  location: string;
  url: string;
  source: "yc" | "hn" | "ashby" | "greenhouse" | "lever";
  salary?: string;
  details?: string;
};

export type Person = {
  name: string;
  role: string;
  company: string;
  url: string;
  links: string[];
  about?: string;
};

type YcListing = {
  name: string;
  slug: string;
  website: string;
  all_locations: string;
  one_liner: string;
  long_description: string;
  team_size: number | null;
  industry: string;
  tags: string[];
  batch: string;
  regions: string[];
  status: string;
  url: string;
};

const cache = new Map<string, { at: number; value: unknown }>();
async function cached<T>(key: string, ttl: number, load: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttl) return hit.value as T;
  const value = await load();
  if (cache.size > 200) cache.clear();
  cache.set(key, { at: Date.now(), value });
  return value;
}

async function getJson<T>(url: string, timeoutMs = 15_000): Promise<T | null> {
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" }, signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

const words = (s: string) =>
  s
    .toLowerCase()
    .split(/[^a-z0-9+#.]+/)
    .filter((w) => w.length >= 2 && !["and", "or", "the", "for", "in", "at", "of", "a", "to", "jobs", "job", "role", "roles"].includes(w));

/** "NYC" → patterns that match "New York" etc. Empty array = anywhere. */
function locationPatterns(location: string): RegExp[] {
  const l = location.toLowerCase().trim();
  if (!l || /^(any|anywhere|us|usa|united states)$/.test(l)) return [];
  const aliases: Record<string, string[]> = {
    nyc: ["new york", "nyc", "brooklyn", "manhattan"],
    "new york": ["new york", "nyc", "brooklyn", "manhattan"],
    sf: ["san francisco", "bay area", "sf"],
    "bay area": ["san francisco", "bay area", "palo alto", "mountain view", "oakland", "san mateo"],
    la: ["los angeles"],
    remote: ["remote"],
  };
  const key = Object.keys(aliases).find((k) => l === k || l.startsWith(`${k},`) || l.includes(k));
  const terms = key ? aliases[key] : [l.split(",")[0]];
  return terms.map((t) => new RegExp(`\\b${t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i"));
}
const matchesLocation = (text: string, pats: RegExp[]) => !pats.length || pats.some((p) => p.test(text));

const ROLE_GROUPS: Record<string, string[]> = {
  eng: ["engineer", "engineering", "developer", "swe", "software", "backend", "frontend", "full stack", "fullstack", "ml", "ai", "infra", "devops", "mobile", "ios", "android", "data engineer"],
  design: ["design", "designer", "ux", "ui"],
  product: ["product manager", "pm", "product"],
  sales: ["sales", "account executive", "ae", "sdr", "bdr", "business development", "partnerships"],
  marketing: ["marketing", "growth", "content", "brand", "community"],
  operations: ["operations", "ops", "chief of staff", "bizops", "strategy"],
  science: ["research", "scientist", "quant"],
};

function roleScore(query: string, title: string, extra = "") {
  const q = words(query);
  if (!q.length) return 1;
  const t = title.toLowerCase();
  const x = extra.toLowerCase();
  let score = q.filter((w) => t.includes(w)).length / q.length + (0.3 * q.filter((w) => !t.includes(w) && x.includes(w)).length) / q.length;
  const ql = query.toLowerCase();
  for (const terms of Object.values(ROLE_GROUPS)) {
    if (terms.some((term) => ql.includes(term)) && terms.some((term) => new RegExp(`\\b${term}\\b`).test(t))) score += 0.5;
  }
  // "software engineer" shouldn't surface mechanical or lab roles.
  const OTHER_FIELDS = /\b(mechanical|electrical|civil|chemical|hardware|manufacturing|process|biolog\w*|clinical|field service|robotics technician)\b/;
  if (OTHER_FIELDS.test(t) && !OTHER_FIELDS.test(ql)) score -= 0.8;
  if (/\b(research scientist|scientist)\b/.test(t) && !/scien|research/.test(ql)) score -= 0.5;
  if (/\b(intern|internship)\b/.test(t) && !/intern/.test(ql)) score -= 0.5;
  if (/\b(senior|staff|principal|lead|head of|director|vp)\b/.test(t) && /\b(junior|new grad|entry|early career)\b/.test(ql)) score -= 0.4;
  return score;
}

const batchYear = (b: string) => Number(b.match(/\d{4}/)?.[0] ?? 0);

export async function ycHiringCompanies(): Promise<YcListing[]> {
  return cached("yc-hiring", 6 * HOUR, async () => (await getJson<YcListing[]>("https://yc-oss.github.io/api/companies/hiring.json", 25_000)) ?? []);
}

/** Hiring YC companies near a location, ranked by keyword fit and recency. */
export async function ycCompaniesFor(opts: { location?: string; keywords?: string; limit?: number; exclude?: Set<string> }) {
  const all = await ycHiringCompanies();
  const pats = locationPatterns(opts.location ?? "");
  const kw = words(opts.keywords ?? "");
  const remoteOk = /remote/i.test(opts.location ?? "");
  const scored = all
    .filter((c) => c.status === "Active" || !c.status)
    .filter((c) => matchesLocation(c.all_locations, pats) || (remoteOk && c.regions.some((r) => /remote/i.test(r))))
    .filter((c) => !opts.exclude?.has(c.name.toLowerCase()))
    .map((c) => {
      const hay = `${c.name} ${c.one_liner} ${c.long_description} ${c.industry} ${c.tags.join(" ")}`.toLowerCase();
      const fit = kw.length ? kw.filter((w) => hay.includes(w)).length / kw.length : 0;
      const recency = Math.max(0, batchYear(c.batch) - 2015) / 11;
      return { c, score: fit * 2 + recency };
    })
    .filter((x) => !kw.length || x.score > 0.9 || x.c.one_liner.toLowerCase().includes(kw[0]))
    .sort((a, b) => b.score - a.score);
  return scored.slice(0, opts.limit ?? 12).map((x) => x.c);
}

type YcPage = {
  name: string;
  batch: string;
  oneLiner: string;
  website: string;
  location: string;
  teamSize: number | null;
  url: string;
  founders: { name: string; title: string; linkedin: string; twitter: string; bio: string }[];
  jobs: { title: string; url: string; location: string; salary: string; equity: string; experience: string; type: string; role: string; skills: string[]; visa: string }[];
};

export async function ycCompanyPage(slug: string): Promise<YcPage | null> {
  return cached(`yc:${slug}`, 6 * HOUR, async () => {
    try {
      const res = await fetch(`https://www.ycombinator.com/companies/${encodeURIComponent(slug)}`, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(15_000) });
      if (!res.ok) return null;
      const html = await res.text();
      const m = html.match(/data-page="([^"]+)"/);
      if (!m) return null;
      const data = JSON.parse(decodeEntities(m[1])) as { props: { company: Record<string, unknown>; jobPostings?: Record<string, unknown>[] } };
      const c = data.props.company;
      const s = (v: unknown) => (typeof v === "string" ? v : "");
      return {
        name: s(c.name),
        batch: s(c.batch_name) || s(c.batch),
        oneLiner: s(c.one_liner),
        website: s(c.website),
        location: s(c.location),
        teamSize: typeof c.team_size === "number" ? c.team_size : null,
        url: `https://www.ycombinator.com/companies/${slug}`,
        founders: ((c.founders as Record<string, unknown>[]) ?? [])
          .filter((f) => f.is_active !== false)
          .map((f) => ({ name: s(f.full_name), title: s(f.title), linkedin: s(f.linkedin_url), twitter: s(f.twitter_url), bio: s(f.founder_bio).slice(0, 240) })),
        jobs: (data.props.jobPostings ?? []).map((j) => ({
          title: s(j.title),
          url: `https://www.ycombinator.com${s(j.url)}`,
          location: s(j.location),
          salary: [s(j.salaryRange), s(j.equityRange)].filter(Boolean).join(" · "),
          equity: s(j.equityRange),
          experience: s(j.minExperience),
          type: s(j.type),
          role: `${s(j.prettyRole)} ${s(j.roleSpecificType)}`.trim(),
          skills: Array.isArray(j.skills) ? (j.skills as string[]).slice(0, 6) : [],
          visa: s(j.visa),
        })),
      };
    } catch {
      return null;
    }
  });
}

async function pool<T, R>(items: T[], size: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]);
      }
    }),
  );
  return out;
}

async function ycJobs(role: string, location: string, keywords: string, exclude: Set<string>): Promise<JobPosting[]> {
  const companies = await ycCompaniesFor({ location, keywords, limit: 18, exclude });
  const pages = await pool(companies, 6, (c) => ycCompanyPage(c.slug));
  const pats = locationPatterns(location);
  const remoteOk = /remote/i.test(location);
  const jobs: (JobPosting & { score: number })[] = [];
  for (const p of pages) {
    if (!p) continue;
    for (const j of p.jobs) {
      // A city search also takes remote roles open to the US, not remote roles limited to other countries.
      const usRemote = /remote/i.test(j.location) && (/^\s*remote\s*$/i.test(j.location) || /\b(US|USA|United States|Americas|North America|anywhere|worldwide|global)\b/i.test(j.location));
      if (!matchesLocation(j.location, pats) && !(remoteOk && /remote/i.test(j.location)) && !(pats.length && usRemote)) continue;
      const score = roleScore(role, j.title, `${j.role} ${j.skills.join(" ")}`);
      if (score <= 0.2) continue;
      jobs.push({
        title: j.title,
        company: `${p.name} (YC ${p.batch})`,
        location: j.location.length > 80 ? `${j.location.slice(0, 77)}...` : j.location,
        url: j.url,
        source: "yc",
        salary: j.salary || undefined,
        details: [p.oneLiner, j.type, j.experience && `${j.experience} exp`, j.skills.length ? j.skills.join(", ") : "", j.visa, p.teamSize ? `${p.teamSize} people` : ""].filter(Boolean).join(" · "),
        score,
      });
    }
  }
  return jobs.sort((a, b) => b.score - a.score);
}

type HnHit = { objectID: string; comment_text?: string; parent_id?: number; story_id?: number; created_at: string };

async function hnJobs(role: string, location: string): Promise<JobPosting[]> {
  const stories = await cached("hn-threads", 6 * HOUR, () => getJson<{ hits: { objectID: string; title: string }[] }>("https://hn.algolia.com/api/v1/search_by_date?tags=story,author_whoishiring&hitsPerPage=6"));
  const thread = stories?.hits.find((h) => /who is hiring/i.test(h.title));
  if (!thread) return [];
  const comments = await cached(`hn:${thread.objectID}`, 3 * HOUR, () => getJson<{ hits: HnHit[] }>(`https://hn.algolia.com/api/v1/search?tags=comment,story_${thread.objectID}&hitsPerPage=1000`, 25_000));
  const pats = locationPatterns(location);
  const remoteOk = /remote/i.test(location);
  const out: (JobPosting & { score: number })[] = [];
  for (const h of comments?.hits ?? []) {
    if (String(h.parent_id) !== thread.objectID || !h.comment_text) continue;
    const text = decodeEntities(h.comment_text.replace(/<p>/g, "\n").replace(/<[^>]+>/g, ""));
    const first = text.split("\n")[0].slice(0, 220);
    if (!matchesLocation(first, pats) && !(remoteOk && /remote/i.test(first))) continue;
    const score = roleScore(role, text.slice(0, 1200));
    if (score <= 0.3) continue;
    const parts = first.split("|").map((x) => x.trim()).filter(Boolean);
    const link = h.comment_text.match(/href="([^"]+)"/)?.[1];
    const isMeta = (x: string) => (pats.length && matchesLocation(x, pats)) || /\b(remote|onsite|on-site|hybrid|full[- ]?time|part[- ]?time|contract|visa)\b|https?:|www\.|\$|€|£|\d+k\b/i.test(x);
    const roleParts = parts.slice(1).filter((x) => !isMeta(x) && x.length <= 90);
    out.push({
      title: roleParts.slice(0, 2).join(", ") || "Several roles (see post)",
      company: parts[0].replace(/\s*\(https?:[^)]*\)/, "").slice(0, 80),
      location: parts.filter((x) => matchesLocation(x, pats) || /remote|onsite|on-site|hybrid/i.test(x)).join(", ").slice(0, 80),
      url: `https://news.ycombinator.com/item?id=${h.objectID}`,
      source: "hn",
      details: `${text.slice(first.length, first.length + 260).replace(/\s+/g, " ").trim()}${link ? ` · ${decodeEntities(link)}` : ""}`,
      score,
    });
  }
  return out.sort((a, b) => b.score - a.score);
}

const slugsFor = (company: string) => {
  const base = company.toLowerCase().replace(/\(.*?\)/g, "").trim();
  return [...new Set([base.replace(/[^a-z0-9]/g, ""), base.replace(/[^a-z0-9]+/g, "-")])].filter(Boolean);
};

async function atsJobs(company: string, role: string, location: string): Promise<JobPosting[]> {
  const pats = locationPatterns(location);
  const keep = (title: string, loc: string) => roleScore(role, title) > 0.2 && (matchesLocation(loc, pats) || /remote/i.test(loc));
  for (const slug of slugsFor(company)) {
    const ashby = await getJson<{ jobs?: { title: string; location: string; jobUrl: string; isRemote?: boolean; compensation?: { compensationTierSummary?: string } }[] }>(`https://api.ashbyhq.com/posting-api/job-board/${slug}?includeCompensation=true`);
    if (ashby?.jobs?.length)
      return ashby.jobs.filter((j) => keep(j.title, `${j.location}${j.isRemote ? " remote" : ""}`)).map((j) => ({ title: j.title, company, location: j.location, url: j.jobUrl, source: "ashby" as const, salary: j.compensation?.compensationTierSummary }));
    const gh = await getJson<{ jobs?: { title: string; location?: { name: string }; absolute_url: string }[] }>(`https://boards-api.greenhouse.io/v1/boards/${slug}/jobs`);
    if (gh?.jobs?.length) return gh.jobs.filter((j) => keep(j.title, j.location?.name ?? "")).map((j) => ({ title: j.title, company, location: j.location?.name ?? "", url: j.absolute_url, source: "greenhouse" as const }));
    const lever = await getJson<{ text: string; categories?: { location?: string }; hostedUrl: string }[]>(`https://api.lever.co/v0/postings/${slug}?mode=json`);
    if (Array.isArray(lever) && lever.length) return lever.filter((j) => keep(j.text, j.categories?.location ?? "")).map((j) => ({ title: j.text, company, location: j.categories?.location ?? "", url: j.hostedUrl, source: "lever" as const }));
  }
  return [];
}

export async function findJobs(opts: { role: string; location: string; keywords?: string; companies?: string[]; exclude?: Set<string>; excludeUrls?: Set<string> }) {
  const [yc, hn, ats] = await Promise.all([
    ycJobs(opts.role, opts.location, opts.keywords ?? "", opts.exclude ?? new Set()).catch(() => []),
    hnJobs(opts.role, opts.location).catch(() => []),
    Promise.all((opts.companies ?? []).slice(0, 8).map((c) => atsJobs(c, opts.role, opts.location).catch(() => []))).then((x) => x.flat()),
  ]);
  const seen = new Set<string>();
  const perCompany = new Map<string, number>();
  const pick = (list: JobPosting[], max: number) =>
    list
      .filter((j) => {
        const key = j.url.toLowerCase();
        if (seen.has(key) || opts.excludeUrls?.has(key)) return false;
        const n = perCompany.get(j.company) ?? 0;
        if (n >= 2) return false;
        seen.add(key);
        perCompany.set(j.company, n + 1);
        return true;
      })
      .slice(0, max);
  return { ats: pick(ats, 12), yc: pick(yc, 14), hn: pick(hn, 8) };
}

/** Founders of hiring YC companies near a location / in a space, or of named YC companies. */
export async function findFounders(opts: { location?: string; keywords?: string; companies?: string[]; limit?: number; exclude?: Set<string> }): Promise<Person[]> {
  let slugs: string[];
  if (opts.companies?.length) {
    const all = await ycHiringCompanies();
    slugs = opts.companies.map((name) => all.find((c) => c.name.toLowerCase() === name.toLowerCase())?.slug ?? slugsFor(name)[1] ?? slugsFor(name)[0]);
  } else {
    slugs = (await ycCompaniesFor({ location: opts.location, keywords: opts.keywords, limit: Math.ceil((opts.limit ?? 10) / 1.5) + 2, exclude: opts.exclude })).map((c) => c.slug);
  }
  const pages = await pool(slugs.slice(0, 16), 6, (s) => ycCompanyPage(s));
  const people: Person[] = [];
  for (const p of pages) {
    if (!p) continue;
    for (const f of p.founders) {
      const links = [f.linkedin, f.twitter].filter(Boolean);
      people.push({
        name: f.name,
        role: f.title || "Founder",
        company: `${p.name} (YC ${p.batch})`,
        url: f.linkedin || f.twitter || p.url,
        links: [...links, p.url],
        about: [p.oneLiner, p.location, p.teamSize ? `${p.teamSize} people` : "", p.jobs.length ? `hiring ${p.jobs.length} role${p.jobs.length === 1 ? "" : "s"}: ${p.jobs.slice(0, 3).map((j) => j.title).join(", ")}` : "", f.bio].filter(Boolean).join(" · "),
      });
    }
  }
  return people.slice(0, opts.limit ?? 12);
}

/** LinkedIn search result titles look like "Jane Doe - Technical Recruiter - Acme | LinkedIn". */
export function personFromLinkedInResult(r: { title: string; url: string; snippet: string }): Person | null {
  if (!/linkedin\.com\/in\//i.test(r.url)) return null;
  const clean = r.title.replace(/\s*\|\s*LinkedIn.*$/i, "").trim();
  const [name, ...rest] = clean.split(/\s+[-–—]\s+/);
  if (!name || name.length > 60) return null;
  return { name, role: rest[0] ?? "", company: rest.slice(1).join(" - "), url: r.url.replace(/[?#].*$/, ""), links: [r.url.replace(/[?#].*$/, "")], about: r.snippet.slice(0, 200) };
}
