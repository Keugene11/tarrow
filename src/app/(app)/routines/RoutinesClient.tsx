"use client";

import { confirmDialog } from "@/components/Dialog";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Pause, Play, Repeat, Trash2, Zap } from "lucide-react";
import { api } from "@/lib/client";
import { LocalTime } from "@/components/RelativeTime";

type Routine = { id: string; title: string; prompt: string; cadence: string; weekday: number | null; next_run_at: string; last_run_at: string | null; active: boolean; conversation_id: string | null };
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const EXAMPLES = [
  "Every Monday morning, find me the best 3-5 events this week in my city that fit my goals and interests, and add the best one as a calendar event.",
  "Every day, look at my goals and open tasks and tell me the one thing I should do today, with a reason.",
];

export function RoutinesClient({ initial }: { initial: Routine[] }) {
  const router = useRouter();
  const [routines, setRoutines] = useState(initial);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");

  const act = async (r: Routine, action: "pause" | "resume" | "run_now") => {
    setBusy(r.id);
    setError("");
    try {
      const d = await api<{ next_run_at?: string; conversationId?: string }>(`/api/routines/${r.id}`, { method: "PATCH", body: { action } });
      if (action === "run_now" && d.conversationId) {
        router.push(`/c/${d.conversationId}`);
        return;
      }
      setRoutines((all) => all.map((x) => (x.id === r.id ? { ...x, active: action !== "pause", next_run_at: d.next_run_at ?? x.next_run_at } : x)));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const remove = async (r: Routine) => {
    if (!(await confirmDialog({ title: `Delete routine "${r.title}"?`, confirmLabel: "Delete", danger: true }))) return;
    setRoutines((all) => all.filter((x) => x.id !== r.id));
    await api(`/api/routines/${r.id}`, { method: "DELETE" }).catch(() => {});
  };

  return (
    <div className="mx-auto w-full max-w-[720px] px-4 pb-12 pt-4">
      {error && <p className="mb-3 rounded-2xl bg-neutral-100 px-4 py-2.5 text-[14px]">{error}</p>}
      {routines.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-neutral-300 p-6 text-center">
          <Repeat className="mx-auto h-6 w-6 text-neutral-300" />
          <p className="mt-2 text-[15px] font-medium">No routines yet</p>
          <p className="mt-1 text-[14px] text-neutral-500">Ask Tarrow to do something on a schedule. It&apos;ll ask for your approval first.</p>
          <div className="mt-4 space-y-2 text-left">
            {EXAMPLES.map((e) => (
              <Link key={e} href={`/c/new?q=${encodeURIComponent(`Set up a routine: ${e}`)}`} className="press block rounded-2xl border border-neutral-200 p-3 text-[13.5px] hover:border-neutral-400">
                {e}
              </Link>
            ))}
          </div>
        </div>
      ) : (
        <div className="space-y-2.5">
          {routines.map((r) => (
            <div key={r.id} className={`rounded-3xl border border-neutral-200 p-4 ${r.active ? "" : "opacity-60"}`}>
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <div className="text-[15.5px] font-semibold">{r.title}</div>
                  <div className="text-[13px] text-neutral-500">
                    {r.cadence === "daily" ? "Every day" : `Every ${WEEKDAYS[r.weekday ?? 1]}`} at 8am ·{" "}
                    {r.active ? (
                      <>
                        next <LocalTime iso={r.next_run_at} options={{ weekday: "short", month: "short", day: "numeric", hour: "numeric" }} />
                      </>
                    ) : (
                      "paused"
                    )}
                  </div>
                </div>
                <button type="button" onClick={() => remove(r)} aria-label="Delete routine" className="press flex h-8 w-8 items-center justify-center rounded-full text-neutral-300 hover:bg-neutral-100 hover:text-neutral-700">
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
              <p className="mt-2 line-clamp-3 text-[13.5px] text-neutral-600">{r.prompt}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button type="button" disabled={busy === r.id} onClick={() => act(r, "run_now")} className="press inline-flex items-center gap-1.5 rounded-full bg-neutral-900 px-3.5 py-1.5 text-[13px] font-medium text-white disabled:opacity-50">
                  <Zap className="h-3.5 w-3.5" /> Run now
                </button>
                <button type="button" disabled={busy === r.id} onClick={() => act(r, r.active ? "pause" : "resume")} className="press inline-flex items-center gap-1.5 rounded-full border border-neutral-200 px-3.5 py-1.5 text-[13px] font-medium disabled:opacity-50">
                  {r.active ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />} {r.active ? "Pause" : "Resume"}
                </button>
                {r.conversation_id && (
                  <Link href={`/c/${r.conversation_id}`} className="press inline-flex items-center rounded-full border border-neutral-200 px-3.5 py-1.5 text-[13px] font-medium">
                    Results
                  </Link>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
