"use client";

import { confirmDialog } from "@/components/Dialog";
import Link from "next/link";
import { useMemo, useState } from "react";
import { Briefcase, Copy, ExternalLink, Repeat, Trash2, Users } from "lucide-react";
import { api } from "@/lib/client";
import { JOB_STATUSES, PERSON_STATUSES, PIPELINE_ROUTINES } from "@/lib/pipeline";
import { RelativeTime } from "@/components/RelativeTime";

type Person = { id: string; name: string; role: string | null; company: string | null; kind: string; url: string | null; email: string | null; why: string | null; channel: string; draft: string | null; status: string; created_at: string };
type Job = { id: string; title: string; company: string; location: string | null; url: string; source: string | null; salary: string | null; fit: number | null; why: string | null; pitch: string | null; status: string; created_at: string };

const FIND_JOBS = "Find open jobs that fit me right now (my city and remote). Rank them honestly by fit, save the best to my pipeline with a tailored pitch, and find someone to DM at the top 2.";
const FIND_PEOPLE = "Find founders and people worth reaching out to for my goals right now, and save the best to my pipeline with a personalized DM for each.";

const chip = (on: boolean) => `press rounded-full border px-2.5 py-1 text-[12.5px] ${on ? "border-neutral-900 bg-neutral-900 text-white" : "border-neutral-200 text-neutral-600 hover:border-neutral-400"}`;
const btn = "press inline-flex items-center gap-1.5 rounded-full border border-neutral-200 px-3 py-1.5 text-[13px] font-medium hover:border-neutral-400";
const btnPrimary = "press inline-flex items-center gap-1.5 rounded-full bg-neutral-900 px-3 py-1.5 text-[13px] font-medium text-white";

export function PipelineClient({ initialPeople, initialJobs, initialTab, hasResume }: { initialPeople: Person[]; initialJobs: Job[]; initialTab: "people" | "jobs"; hasResume: boolean }) {
  const [tab, setTab] = useState(initialTab);
  const [people, setPeople] = useState(initialPeople);
  const [jobs, setJobs] = useState(initialJobs);
  const [filter, setFilter] = useState<string>("all");

  const statuses = tab === "people" ? PERSON_STATUSES : JOB_STATUSES;
  const items = tab === "people" ? people : jobs;
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const i of items) c[i.status] = (c[i.status] ?? 0) + 1;
    return c;
  }, [items]);
  const shown = filter === "all" ? items : items.filter((i) => i.status === filter);

  const setPersonStatus = (p: Person, status: string) => {
    setPeople((all) => all.map((x) => (x.id === p.id ? { ...x, status } : x)));
    void api(`/api/pipeline/people/${p.id}`, { method: "PATCH", body: { status } }).catch(() => {});
  };
  const setJobStatus = (j: Job, status: string) => {
    setJobs((all) => all.map((x) => (x.id === j.id ? { ...x, status } : x)));
    void api(`/api/pipeline/jobs/${j.id}`, { method: "PATCH", body: { status } }).catch(() => {});
  };
  const remove = async (kind: "people" | "jobs", id: string, name: string) => {
    if (!(await confirmDialog({ title: `Remove ${name}?`, confirmLabel: "Remove", danger: true }))) return;
    if (kind === "people") setPeople((all) => all.filter((x) => x.id !== id));
    else setJobs((all) => all.filter((x) => x.id !== id));
    await api(`/api/pipeline/${kind}/${id}`, { method: "DELETE" }).catch(() => {});
  };

  return (
    <div className="mx-auto w-full max-w-[720px] px-4 pb-16 pt-4">
      <div className="mb-3 flex gap-2">
        {(["people", "jobs"] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => {
              setTab(t);
              setFilter("all");
            }}
            className={`press flex flex-1 items-center justify-center gap-2 rounded-2xl border px-3 py-2.5 text-[14px] font-medium ${tab === t ? "border-neutral-900 bg-neutral-50" : "border-neutral-200 text-neutral-500"}`}
          >
            {t === "people" ? <Users className="h-4 w-4" /> : <Briefcase className="h-4 w-4" />}
            {t} <span className="text-neutral-400">{t === "people" ? people.length : jobs.length}</span>
          </button>
        ))}
      </div>

      {items.length > 0 && (
        <div className="mb-3 flex flex-wrap gap-1.5">
          <button type="button" onClick={() => setFilter("all")} className={chip(filter === "all")}>
            all {items.length}
          </button>
          {statuses.map((s) =>
            counts[s.value] ? (
              <button key={s.value} type="button" onClick={() => setFilter(s.value)} className={chip(filter === s.value)}>
                {s.label} {counts[s.value]}
              </button>
            ) : null,
          )}
        </div>
      )}

      {items.length === 0 ? (
        <Empty tab={tab} hasResume={hasResume} />
      ) : (
        <div className="space-y-2.5">
          {tab === "people"
            ? (shown as Person[]).map((p) => <PersonRow key={p.id} person={p} onStatus={(s) => setPersonStatus(p, s)} onRemove={() => remove("people", p.id, p.name)} />)
            : (shown as Job[]).map((j) => <JobRow key={j.id} job={j} onStatus={(s) => setJobStatus(j, s)} onRemove={() => remove("jobs", j.id, `${j.title} at ${j.company}`)} />)}
          <div className="flex flex-wrap gap-2 pt-2">
            <Link href={`/c/new?q=${encodeURIComponent(tab === "people" ? FIND_PEOPLE : FIND_JOBS)}&effort=standard`} className={btn}>
              {tab === "people" ? "Find more people" : "Find more jobs"}
            </Link>
            <Link href={`/c/new?q=${encodeURIComponent(PIPELINE_ROUTINES[tab === "people" ? 1 : 0].prompt)}&effort=standard`} className={btn}>
              <Repeat className="h-3.5 w-3.5" /> {PIPELINE_ROUTINES[tab === "people" ? 1 : 0].title}
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}

function Empty({ tab, hasResume }: { tab: "people" | "jobs"; hasResume: boolean }) {
  const routine = PIPELINE_ROUTINES[tab === "people" ? 1 : 0];
  return (
    <div className="rounded-3xl border border-dashed border-neutral-300 p-6 text-center">
      {tab === "people" ? <Users className="mx-auto h-6 w-6 text-neutral-300" /> : <Briefcase className="mx-auto h-6 w-6 text-neutral-300" />}
      <p className="mt-2 text-[15px] font-medium">{tab === "people" ? "No one to reach out to yet" : "No jobs saved yet"}</p>
      <p className="mx-auto mt-1 max-w-sm text-[14px] text-neutral-500">
        {tab === "people"
          ? "Tarrow finds real founders, recruiters and investors (with LinkedIn/X) and writes a personal DM for each. You send it."
          : "Tarrow pulls live roles from YC startups, Hacker News \"Who is hiring?\" and company job boards, ranks them for you and writes the pitch. You apply."}
      </p>
      {tab === "jobs" && !hasResume && (
        <p className="mx-auto mt-2 max-w-sm text-[13px] text-neutral-500">
          Tip: paste your resume in{" "}
          <Link href="/settings#coach" className="underline underline-offset-2">
            Settings
          </Link>{" "}
          for better matches.
        </p>
      )}
      <div className="mt-4 flex flex-col items-center gap-2">
        <Link href={`/c/new?q=${encodeURIComponent(tab === "people" ? FIND_PEOPLE : FIND_JOBS)}&effort=standard`} className={btnPrimary}>
          {tab === "people" ? "Find people for me" : "Find jobs for me"}
        </Link>
        <Link href={`/c/new?q=${encodeURIComponent(routine.prompt)}&effort=standard`} className={btn}>
          <Repeat className="h-3.5 w-3.5" /> Set up a {routine.title.toLowerCase()}
        </Link>
      </div>
    </div>
  );
}

function StatusChips({ options, value, onChange }: { options: readonly { value: string; label: string }[]; value: string; onChange: (s: string) => void }) {
  return (
    <div className="flex flex-wrap gap-1">
      {options.map((s) => (
        <button key={s.value} type="button" onClick={() => onChange(s.value)} className={`${chip(value === s.value)} !px-2 !py-0.5 !text-[12px]`}>
          {s.label}
        </button>
      ))}
    </div>
  );
}

function useCopy() {
  const [copied, setCopied] = useState(false);
  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {}
  };
  return { copied, copy };
}

function PersonRow({ person: p, onStatus, onRemove }: { person: Person; onStatus: (s: string) => void; onRemove: () => void }) {
  const [open, setOpen] = useState(p.status === "to_contact");
  const [draft, setDraft] = useState(p.draft ?? "");
  const { copied, copy } = useCopy();
  const saveDraft = () => {
    if (draft !== (p.draft ?? "")) void api(`/api/pipeline/people/${p.id}`, { method: "PATCH", body: { draft } }).catch(() => {});
  };
  const where = p.email ? "Email" : /linkedin\.com/.test(p.url ?? "") ? "LinkedIn" : /(x|twitter)\.com/.test(p.url ?? "") ? "X" : "profile";
  const send = async () => {
    await copy(draft);
    if (p.email) window.location.href = `mailto:${encodeURIComponent(p.email)}?body=${encodeURIComponent(draft)}`;
    else if (p.url) window.open(p.url, "_blank", "noopener,noreferrer");
    if (p.status === "to_contact") onStatus("contacted");
  };
  return (
    <div className={`rounded-3xl border border-neutral-200 p-4 ${p.status === "closed" ? "opacity-60" : ""}`}>
      <div className="flex items-start gap-2">
        <button type="button" onClick={() => setOpen((o) => !o)} className="min-w-0 flex-1 text-left">
          <div className="text-[15.5px] font-semibold">{p.name}</div>
          <div className="text-[13px] text-neutral-500">{[p.role, p.company].filter(Boolean).join(" · ")}</div>
          {p.why && <p className="mt-1 text-[13.5px] text-neutral-600">{p.why}</p>}
        </button>
        <button type="button" onClick={onRemove} aria-label="Remove" className="press flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-neutral-300 hover:bg-neutral-100 hover:text-neutral-700">
          <Trash2 className="h-4 w-4" />
        </button>
      </div>
      {open && draft && (
        <textarea value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={saveDraft} rows={Math.min(8, Math.max(3, Math.ceil(draft.length / 60)))} className="mt-2 w-full resize-y rounded-2xl border border-neutral-200 px-3 py-2 text-[13.5px] leading-relaxed outline-none focus:border-neutral-900" />
      )}
      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        {draft && (
          <button type="button" onClick={send} className={btnPrimary}>
            {copied ? "Copied ✓" : `Copy & open ${where}`}
          </button>
        )}
        {draft && (
          <button type="button" onClick={() => copy(draft)} className={btn} aria-label="Copy draft">
            <Copy className="h-3.5 w-3.5" />
          </button>
        )}
        {!draft && p.url && (
          <a href={p.url} target="_blank" rel="noopener noreferrer" className={btn}>
            <ExternalLink className="h-3.5 w-3.5" /> {where}
          </a>
        )}
        <span className="ml-auto text-[12px] text-neutral-400">
          <RelativeTime iso={p.created_at} />
        </span>
      </div>
      <div className="mt-2">
        <StatusChips options={PERSON_STATUSES} value={p.status} onChange={onStatus} />
      </div>
    </div>
  );
}

function JobRow({ job: j, onStatus, onRemove }: { job: Job; onStatus: (s: string) => void; onRemove: () => void }) {
  const [open, setOpen] = useState(false);
  const { copied, copy } = useCopy();
  return (
    <div className={`rounded-3xl border border-neutral-200 p-4 ${j.status === "skipped" ? "opacity-60" : ""}`}>
      <div className="flex items-start gap-2">
        <button type="button" onClick={() => setOpen((o) => !o)} className="min-w-0 flex-1 text-left">
          <div className="text-[15.5px] font-semibold">{j.title}</div>
          <div className="text-[13px] text-neutral-500">{[j.company, j.location, j.salary].filter(Boolean).join(" · ")}</div>
          {j.why && <p className="mt-1 text-[13.5px] text-neutral-600">{j.why}</p>}
        </button>
        {j.fit != null && j.fit > 0 && <span className="shrink-0 rounded-full border border-neutral-200 px-2 py-0.5 text-[12px] tabular-nums text-neutral-600">fit {j.fit}</span>}
        <button type="button" onClick={onRemove} aria-label="Remove" className="press flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-neutral-300 hover:bg-neutral-100 hover:text-neutral-700">
          <Trash2 className="h-4 w-4" />
        </button>
      </div>
      {open && j.pitch && <p className="mt-2 whitespace-pre-wrap rounded-2xl bg-neutral-50 px-3 py-2 text-[13.5px] leading-relaxed">{j.pitch}</p>}
      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        <a href={j.url} target="_blank" rel="noopener noreferrer" className={btnPrimary}>
          <ExternalLink className="h-3.5 w-3.5" /> Open posting
        </a>
        {j.pitch && (
          <button type="button" onClick={() => (open ? copy(j.pitch ?? "") : setOpen(true))} className={btn}>
            {copied ? "Copied ✓" : open ? "Copy pitch" : "Pitch"}
          </button>
        )}
        <span className="ml-auto text-[12px] text-neutral-400">
          {j.source ? `${j.source} · ` : ""}
          <RelativeTime iso={j.created_at} />
        </span>
      </div>
      <div className="mt-2">
        <StatusChips options={JOB_STATUSES} value={j.status} onChange={onStatus} />
      </div>
    </div>
  );
}
