import { Agent, fetch } from "undici";
import { lookup } from "node:dns";
const priv = (ip) => /^(127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(ip) || ip === "::1";
const agent = new Agent({ connect: { lookup: (h, o, cb) => lookup(h, { all: true }, (e, a) => { if (e) return cb(e, ""); if (a.some((x) => priv(x.address))) return cb(new Error("Blocked host"), ""); o?.all ? cb(null, a) : cb(null, a[0].address, a[0].family); }) } });
for (const u of ["https://example.com", "http://localhost:3000/"]) {
  try { const r = await fetch(u, { dispatcher: agent, signal: AbortSignal.timeout(8000) }); console.log(u, "->", r.status); }
  catch (e) { console.log(u, "->", e.cause?.message ?? e.message); }
}
