import { INTERVIEW_TOPICS } from "@/lib/interview-intro";

/** Top of the interview: what it is, why it matters, and how far along they are. */
export function InterviewBanner({ covered, note, onSkip, skipping }: { covered: string[]; note?: string; onSkip?: () => void; skipping?: boolean }) {
  const done = INTERVIEW_TOPICS.filter((t) => covered.includes(t.key)).length;
  return (
    <div className="mb-5 max-w-full rounded-md border border-t-frame px-4 py-3">
      <div>
        <span className="text-t-strong">✻</span> <span className="font-bold text-t-strong">Step 1: the interview</span>
        <span className="t-dim"> · about 5 min</span>
      </div>
      <div className="mt-1.5 pl-[2ch] t-dim">
        Tarrow learns your life first, so every answer after this fits you.{note ? ` ${note}` : ""}
      </div>
      <div className="mt-2 flex min-w-0 flex-wrap items-center gap-x-[1.5ch] gap-y-0.5 pl-[2ch]">
        {INTERVIEW_TOPICS.map((t) => (
          <span key={t.key} className={`whitespace-nowrap ${covered.includes(t.key) ? "text-t-strong" : "t-faint"}`}>
            {covered.includes(t.key) ? "■" : "□"} {t.label}
          </span>
        ))}
        <span className="whitespace-nowrap t-dim">
          {done}/{INTERVIEW_TOPICS.length}
        </span>
        {onSkip && (
          <button type="button" onClick={onSkip} disabled={skipping} className="whitespace-nowrap t-dim underline underline-offset-4 hover:text-t-strong disabled:opacity-50">
            skip for now
          </button>
        )}
      </div>
    </div>
  );
}
