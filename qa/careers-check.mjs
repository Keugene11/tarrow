// Live check of the keyless job/people sources (no model calls).
// Usage: node --conditions=react-server node_modules/jiti/lib/jiti-cli.mjs qa/careers-check.mjs
import { findJobs, findFounders } from "../src/lib/careers.ts";

let failed = 0;
const check = (name, ok, extra = "") => {
  console.log(`${ok ? "✓" : "✗"} ${name}${extra ? ` — ${extra}` : ""}`);
  if (!ok) failed++;
};

let t = Date.now();
const jobs = await findJobs({ role: "software engineer", location: "New York", keywords: "ai" });
check("find_jobs NYC software engineer", jobs.yc.length + jobs.hn.length >= 5, `${jobs.yc.length} yc, ${jobs.hn.length} hn in ${Date.now() - t}ms`);
for (const j of [...jobs.yc.slice(0, 4), ...jobs.hn.slice(0, 3)]) console.log(`   ${j.source} · ${j.title} — ${j.company} · ${j.location} · ${j.salary ?? ""}\n     ${j.url}`);
check("yc jobs are in NYC or remote", jobs.yc.every((j) => /new york|nyc|remote|brooklyn/i.test(j.location)));

t = Date.now();
const remote = await findJobs({ role: "founding engineer", location: "remote", companies: ["ramp", "linear"] });
check("find_jobs remote + ATS boards", remote.yc.length + remote.hn.length + remote.ats.length > 0, `${remote.ats.length} ats, ${remote.yc.length} yc, ${remote.hn.length} hn in ${Date.now() - t}ms`);
for (const j of remote.ats.slice(0, 3)) console.log(`   ${j.source} · ${j.title} — ${j.company} · ${j.location}\n     ${j.url}`);

t = Date.now();
const founders = await findFounders({ location: "New York", keywords: "developer tools", limit: 8 });
check("find_people founders NYC devtools", founders.length >= 4, `${founders.length} in ${Date.now() - t}ms`);
for (const p of founders.slice(0, 5)) console.log(`   ${p.name} — ${p.role} at ${p.company}\n     ${p.links.join(" · ")}\n     ${p.about?.slice(0, 140)}`);
check("founders have LinkedIn or X", founders.filter((p) => /linkedin|x\.com|twitter/.test(p.url)).length >= founders.length * 0.6);

const named = await findFounders({ companies: ["Reducto"], limit: 5 });
check("find_people named YC company", named.length > 0 && /reducto/i.test(named[0].company), named.map((p) => p.name).join(", "));
process.exit(failed ? 1 : 0);
