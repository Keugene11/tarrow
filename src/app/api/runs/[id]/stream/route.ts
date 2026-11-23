import { sql } from "@/lib/db";
import { currentUser } from "@/lib/auth";
import { isUuid, json } from "@/lib/http";
import { ensureProgress } from "@/lib/agent/runtime";

export const maxDuration = 300;
const STREAM_MS = 120_000;

type Cursor = Record<string, number>;

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const user = await currentUser();
  if (!user) return json({ error: "Not signed in" }, 401);
  if (!isUuid(id)) return json({ error: "Bad id" }, 400);
  const owns = await sql`select id from runs where id = ${id} and user_id = ${user.id}`;
  if (!owns.length) return json({ error: "Not found" }, 404);

  let cursor: Cursor = {};
  try {
    const raw = new URL(req.url).searchParams.get("after");
    if (raw) cursor = JSON.parse(raw);
  } catch {}

  const encoder = new TextEncoder();
  const started = Date.now();
  let lastKickCheck = 0;
  let lastSend = Date.now();

  const stream = new ReadableStream({
    async start(controller) {
      // The client can disconnect between polls; stop quietly instead of throwing on a closed controller.
      let closed = false;
      const send = (payload: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(payload));
          lastSend = Date.now();
        } catch {
          closed = true;
        }
      };
      try {
        while (!closed && !req.signal.aborted && Date.now() - started < STREAM_MS) {
          const runs = await sql`
            select id, parent_run_id, title, status, kind, started_at, finished_at, state->>'mode' as mode
            from runs where id = ${id} or parent_run_id = ${id}`;
          const ids = runs.map((r) => r.id as string);
          const seqs = ids.map((rid) => Number(cursor[rid] ?? 0));
          const events = await sql`
            select e.run_id, e.seq, e.type, e.data, e.created_at
            from run_events e join unnest(${ids}::uuid[], ${seqs}::int[]) as c(rid, s) on e.run_id = c.rid and e.seq > c.s
            order by e.id limit 400`;
          for (const e of events) {
            const rid = e.run_id as string;
            cursor[rid] = Math.max(Number(cursor[rid] ?? 0), Number(e.seq));
          }
          const root = runs.find((r) => r.id === id);
          if (events.length) send(`data: ${JSON.stringify({ events, runs, cursor })}\n\n`);
          const terminal = root && ["done", "error", "cancelled"].includes(String(root.status));
          if (terminal && events.length < 400) {
            if (!events.length) send(`data: ${JSON.stringify({ events: [], runs, cursor })}\n\n`);
            send(`event: end\ndata: {}\n\n`);
            break;
          }
          if (Date.now() - lastKickCheck > 5000) {
            lastKickCheck = Date.now();
            const active = runs.filter((r) => ["queued", "running"].includes(String(r.status))).map((r) => r.id as string);
            await ensureProgress(active);
          }
          if (Date.now() - lastSend > 15_000) send(`: ping\n\n`);
          await new Promise((r) => setTimeout(r, events.length ? 150 : 450));
        }
      } catch (err) {
        console.error("stream error", err);
      } finally {
        try {
          controller.close();
        } catch {}
      }
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no" },
  });
}
