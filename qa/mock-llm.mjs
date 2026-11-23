// Deterministic OpenAI-compatible streaming mock for testing the agent runtime without a real model.
// Usage: node qa/mock-llm.mjs [port]   then run the app with LLM_BASE_URL=http://localhost:4010/v1 LLM_API_KEY=x LLM_MODELS=mock LLM_FAST_MODELS=mock
import http from "node:http";

const PORT = Number(process.argv[2] || 4010);
const DELAY = Number(process.env.MOCK_DELAY_MS || 1200);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const limited = new Map();

function decide(body) {
  const msgs = body.messages ?? [];
  const system = msgs[0]?.content ?? "";
  const toolNames = (body.tools ?? []).map((t) => t.function.name);
  const toolMsgs = msgs.filter((m) => m.role === "tool");
  const lastUser = [...msgs].reverse().find((m) => m.role === "user")?.content ?? "";
  if (body.response_format?.type === "json_object") {
    if (/Classify how much work/.test(system)) return { content: JSON.stringify({ mode: /deep/i.test(lastUser) ? "deep" : "standard", title: "Mock task" }), delay: /slowtriage/i.test(lastUser) ? 7000 : undefined };
    return { content: JSON.stringify({ suggestions: [{ kind: "idea", title: "Mock idea", body: "Because tests.", prompt: "Do the mock thing" }] }) };
  }
  if (/research sub-agent/.test(system)) {
    if (!toolMsgs.length && toolNames.includes("get_weather")) return { tool: { name: "get_weather", args: { location: "Brooklyn" } } };
    return { content: "- Finding from sub-agent: it's mild in Brooklyn. [Open-Meteo](https://open-meteo.com)" };
  }
  if (/running the onboarding interview/.test(system)) {
    if (!toolMsgs.length && toolNames.includes("remember")) return { tool: { name: "remember", args: { facts: [{ category: "work", content: `Mock fact: ${String(lastUser).slice(0, 60)}` }] } } };
    if (toolNames.includes("finish_interview") && !toolMsgs.some((m) => /Interview marked complete/.test(m.content))) return { tool: { name: "finish_interview", args: { summary: "Mock summary" } } };
    return { content: "Got it. What's the biggest thing you want to change this year?" };
  }
  if (/slow|coworking/i.test(lastUser)) return { content: "Slow answer done.", delay: 9000 };
  if (toolNames.includes("spawn_agents") && !toolMsgs.length) {
    return { tool: { name: "spawn_agents", args: { agents: [{ title: "Agent one", instructions: "Check weather in Brooklyn" }, { title: "Agent two", instructions: "Check weather in Queens" }] } } };
  }
  if (toolNames.includes("create_task") && !toolMsgs.length && /task/i.test(lastUser)) {
    return { tool: { name: "create_task", args: { title: "Mock task from agent", due: "2026-11-10T19:00" } } };
  }
  return { content: `## Mock answer\n\nHere is a **final** answer with a [link](https://example.com). Tool results seen: ${toolMsgs.length}.` };
}

const server = http.createServer(async (req, res) => {
  if (req.method === "GET") return res.end(JSON.stringify({ data: [{ id: "mock" }] }));
  let raw = "";
  for await (const chunk of req) raw += chunk;
  const body = JSON.parse(raw || "{}");
  // "ratelimit" in the user's message: answer 429 (as Groq does) for the first 3 calls of that conversation.
  const lastUserMsg = [...(body.messages ?? [])].reverse().find((m) => m.role === "user")?.content ?? "";
  if (/ratelimit/i.test(lastUserMsg) && body.response_format?.type !== "json_object") {
    limited.set(lastUserMsg, (limited.get(lastUserMsg) ?? 0) + 1);
    if (limited.get(lastUserMsg) <= 3) {
      res.writeHead(429, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ error: { message: "Rate limit reached for model `mock` on tokens per minute (TPM): Limit 8000, Used 7990, Requested 3000. Please try again in 8s.", code: "rate_limit_exceeded" } }));
    }
  }
  const out = decide(body);
  res.writeHead(200, { "Content-Type": "text/event-stream" });
  const send = (delta, finish = null) => res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`);
  await sleep(out.delay ?? DELAY);
  if (out.tool) {
    send({ tool_calls: [{ index: 0, id: `call_${Date.now()}`, type: "function", function: { name: out.tool.name, arguments: JSON.stringify(out.tool.args) } }] });
    send({}, "tool_calls");
  } else {
    for (const piece of out.content.match(/.{1,12}/gs) ?? []) {
      send({ content: piece });
      await sleep(15);
    }
    send({}, "stop");
  }
  res.write(`data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 100, completion_tokens: 20 } })}\n\n`);
  res.end("data: [DONE]\n\n");
});
server.listen(PORT, () => console.log(`mock llm on ${PORT}`));
