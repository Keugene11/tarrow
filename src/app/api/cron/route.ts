import { json } from "@/lib/http";
import { sweepStale } from "@/lib/agent/runtime";
import { runDueRoutines } from "@/lib/agent/routines";
import { deleteStaleGuests } from "@/lib/guest";

export const maxDuration = 120;

export async function GET(req: Request) {
  if (!process.env.CRON_SECRET || req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return json({ error: "Forbidden" }, 403);
  }
  const sweep = await sweepStale();
  const routines = await runDueRoutines();
  const guests = await deleteStaleGuests().catch(() => 0);
  return json({ ...sweep, routines, guests });
}
