import "server-only";
import { sql } from "../db";

type Pending = { type: string; data: Record<string, unknown> };

/**
 * Buffers run events and flushes them in batches. Only the lease holder writes a run's
 * events, so seq numbers are assigned locally. Each flush also reports whether the user
 * asked to cancel, so long LLM streams can be aborted promptly.
 */
export class EventWriter {
  private pending: Pending[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private flushing: Promise<void> = Promise.resolve();
  cancelRequested = false;
  onCancel?: () => void;

  constructor(private runId: string, private seq: number) {}

  emit(type: string, data: Record<string, unknown> = {}) {
    // Coalesce consecutive text deltas for the same step into one row.
    const last = this.pending[this.pending.length - 1];
    if (last && (type === "delta" || type === "reasoning") && last.type === type && last.data.step === data.step) {
      last.data.text = String(last.data.text ?? "") + String(data.text ?? "");
    } else {
      this.pending.push({ type, data });
    }
    if (!this.timer) this.timer = setTimeout(() => void this.flush(), type === "delta" || type === "reasoning" ? 350 : 120);
  }

  flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    const batch = this.pending.splice(0);
    this.flushing = this.flushing.then(async () => {
      if (!batch.length) return;
      const start = this.seq + 1;
      this.seq += batch.length;
      const seqs = batch.map((_, i) => start + i);
      const types = batch.map((b) => b.type);
      const datas = batch.map((b) => JSON.stringify(b.data));
      try {
        const rows = await sql`
          with ins as (
            insert into run_events (run_id, seq, type, data)
            select ${this.runId}::uuid, s, t, d::jsonb
            from unnest(${seqs}::int[], ${types}::text[], ${datas}::text[]) as x(s, t, d)
          )
          update runs set seq = ${this.seq}, updated_at = now() where id = ${this.runId}
          returning cancel_requested`;
        if (rows[0]?.cancel_requested && !this.cancelRequested) {
          this.cancelRequested = true;
          this.onCancel?.();
        }
      } catch (err) {
        console.error("event flush failed", err);
      }
    });
    return this.flushing;
  }

  get currentSeq() {
    return this.seq;
  }
}
