// Time-to-first-token and total time for GLM on OpenRouter under different provider routing.
// Costs ~$0.01. Usage: node --env-file=.env.local qa/provider-bench.mjs [rounds]
const rounds = Number(process.argv[2] || 2);
const filler = "The user is a product designer in Brooklyn saving toward going freelance and runs three times a week. ".repeat(90);
const messages = [
  { role: "system", content: `You are Tarrow, a personal agent.\n\n## About them\n${filler}` },
  { role: "user", content: process.env.BENCH_PROMPT || "what should i do this saturday in nyc? keep it to 3 bullets" },
];

const variants = {
  default: { data_collection: "deny", require_parameters: true, ignore: ["gmicloud", "open-inference", "sail-research"] },
  throughput: { data_collection: "deny", require_parameters: true, ignore: ["gmicloud", "open-inference", "sail-research"], sort: "throughput" },
};

async function once(name, provider) {
  const t0 = Date.now();
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "z-ai/glm-5.3-flash", messages, stream: true, max_tokens: 2000, reasoning: { effort: "medium" }, tools: [{ type: "function", function: { name: "web_search", description: "Search the web", parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"] } } }], tool_choice: "auto", usage: { include: true }, provider }),
  });
  if (!res.ok) return console.log(name, "HTTP", res.status, (await res.text()).slice(0, 200));
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "", firstAny = 0, firstContent = 0, host = "", usage = null;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop();
    for (const line of lines) {
      if (!line.startsWith("data: ") || line === "data: [DONE]") continue;
      let j;
      try { j = JSON.parse(line.slice(6)); } catch { continue; }
      host ||= j.provider ?? "";
      if (j.usage) usage = j.usage;
      const d = j.choices?.[0]?.delta ?? {};
      if ((d.reasoning || d.content) && !firstAny) firstAny = Date.now() - t0;
      if (d.content && !firstContent) firstContent = Date.now() - t0;
    }
  }
  console.log(name.padEnd(11), host.padEnd(12), "out", usage?.completion_tokens, `first token ${(firstAny / 1000).toFixed(1)}s`, `answer starts ${(firstContent / 1000).toFixed(1)}s`, `total ${((Date.now() - t0) / 1000).toFixed(1)}s`, `$${(usage?.cost ?? 0).toFixed(5)}`);
}

for (let i = 0; i < rounds; i++) for (const [name, p] of Object.entries(variants)) await once(name, p);
