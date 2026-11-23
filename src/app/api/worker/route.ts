import { after } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { processRun } from "@/lib/agent/runtime";
import { isUuid, json } from "@/lib/http";

export const maxDuration = 300;

function authorized(req: Request) {
  const expected = Buffer.from(process.env.WORKER_SECRET ?? "");
  const given = Buffer.from(req.headers.get("x-worker-secret") ?? "");
  return expected.length > 0 && expected.length === given.length && timingSafeEqual(expected, given);
}

export async function POST(req: Request) {
  const started = Date.now();
  if (!authorized(req)) return json({ error: "Forbidden" }, 403);
  const { runId } = (await req.json().catch(() => ({}))) as { runId?: string };
  if (!isUuid(runId)) return json({ error: "Bad run id" }, 400);
  after(() => processRun(runId, started));
  return json({ accepted: true }, 202);
}
