"use client";

import Link from "next/link";
import { useState } from "react";
import type { Card, Source } from "@/lib/agent/types";
import { api, domainOf } from "@/lib/client";
import { LocalTime } from "../RelativeTime";

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** A bordered terminal "panel" for actions Tarrow prepared. */
function Panel({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-md border t-line bg-t-panel px-3 py-2.5 fade-in">
      <div className="mb-1 text-[12px] uppercase tracking-wider t-dim">{label}</div>
      {children}
    </div>
  );
}

const btn = "inline-flex items-center gap-1 rounded border border-t-edge px-2.5 py-1 text-[12.5px] hover:border-t-strong hover:text-t-strong";
const btnPrimary = "inline-flex items-center gap-1 rounded bg-t-inv px-2.5 py-1 text-[12.5px] font-bold text-t-inv-fg hover:bg-t-inv-hover";

function CalendarCard({ card }: { card: Extract<Card, { type: "calendar" }> }) {
  const ics = `/api/ics?${new URLSearchParams({ title: card.title, start: card.start, end: card.end ?? "", location: card.location ?? "", details: [card.details, card.url].filter(Boolean).join("\n\n") })}`;
  return (
    <Panel label="Calendar event">
      <div className="font-bold text-t-strong">{card.title}</div>
      <div className="t-dim">
        <LocalTime iso={card.start} options={{ weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }} />
        {card.end ? (
          <>
            {" – "}
            <LocalTime iso={card.end} options={{ hour: "numeric", minute: "2-digit" }} />
          </>
        ) : null}
        {card.location ? ` · ${card.location}` : ""}
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        <a href={card.gcalUrl} target="_blank" rel="noopener noreferrer" className={btnPrimary}>
          Add to Google Calendar
        </a>
        <a href={ics} className={btn}>
          Apple / Outlook
        </a>
        {card.url && (
          <a href={card.url} target="_blank" rel="noopener noreferrer" className={btn}>
            Event page
          </a>
        )}
      </div>
    </Panel>
  );
}

function DraftCard({ card }: { card: Extract<Card, { type: "draft" }> }) {
  const [body, setBody] = useState(card.body);
  const [subject, setSubject] = useState(card.subject ?? "");
  const [copied, setCopied] = useState(false);
  const to = card.to ?? "";
  const isEmailish = card.channel === "email" || /@/.test(to);
  const isPhone = /^[+\d][\d\s().-]{6,}$/.test(to);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(isEmailish && subject ? `Subject: ${subject}\n\n${body}` : body);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {}
  };
  const label = { email: "Email draft", text: "Text draft", whatsapp: "WhatsApp draft", dm: "DM draft", other: "Message draft" }[card.channel] ?? "Draft";
  const field = "w-full rounded border border-t-line bg-t-bg px-2 py-1.5 outline-none focus:border-t-focus";
  return (
    <Panel label={label}>
      {to && <div className="mb-1 t-dim">to: {to}</div>}
      {isEmailish && <input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="subject" className={`${field} mb-1.5`} />}
      <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={Math.min(12, Math.max(4, body.split("\n").length + 1))} className={`${field} resize-y leading-relaxed`} />
      <div className="mt-2 flex flex-wrap gap-2">
        {isEmailish && (
          <a href={`mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`} className={btnPrimary}>
            Open in Mail
          </a>
        )}
        {(card.channel === "text" || isPhone) && (
          <a href={`sms:${isPhone ? to.replace(/[^\d+]/g, "") : ""}?&body=${encodeURIComponent(body)}`} className={btnPrimary}>
            Open in Messages
          </a>
        )}
        {card.channel === "whatsapp" && (
          <a href={`https://wa.me/${isPhone ? to.replace(/[^\d]/g, "") : ""}?text=${encodeURIComponent(body)}`} target="_blank" rel="noopener noreferrer" className={btnPrimary}>
            Open WhatsApp
          </a>
        )}
        <button type="button" onClick={copy} className={btn}>
          {copied ? "Copied ✓" : "Copy"}
        </button>
      </div>
    </Panel>
  );
}

function GmailDraftCard({ card }: { card: Extract<Card, { type: "gmail_draft" }> }) {
  const [to, setTo] = useState(card.to);
  const [subject, setSubject] = useState(card.subject);
  const [body, setBody] = useState(card.body);
  const [status, setStatus] = useState(card.status);
  const [busy, setBusy] = useState<"" | "send" | "discard">("");
  const [error, setError] = useState("");
  const edited = to !== card.to || subject !== card.subject || body !== card.body;
  const send = async () => {
    setBusy("send");
    setError("");
    try {
      await api(`/api/integrations/gmail/drafts/${encodeURIComponent(card.draftId)}`, { method: "POST", body: edited ? { to, subject, body } : {} });
      setStatus("sent");
    } catch (err) {
      const e = err as { status?: number; message: string };
      if (e.status === 410) setStatus("sent");
      setError(e.status === 410 ? "" : e.message);
    } finally {
      setBusy("");
    }
  };
  const discard = async () => {
    setBusy("discard");
    setError("");
    try {
      await api(`/api/integrations/gmail/drafts/${encodeURIComponent(card.draftId)}`, { method: "DELETE" });
      setStatus("discarded");
    } catch (err) {
      const e = err as { status?: number; message: string };
      if (e.status === 410) setStatus("discarded");
      else setError(e.message);
    } finally {
      setBusy("");
    }
  };
  const field = "w-full rounded border border-t-line bg-t-bg px-2 py-1.5 outline-none focus:border-t-focus";
  return (
    <Panel label={card.reply ? "Gmail reply · review and send" : "Gmail draft · review and send"}>
      <div className="mb-1 t-dim">from: {card.account}</div>
      {status === "draft" ? (
        <>
          <input value={to} onChange={(e) => setTo(e.target.value)} placeholder="to" className={`${field} mb-1.5`} />
          {card.cc && <div className="mb-1 t-dim">cc: {card.cc}</div>}
          <input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="subject" className={`${field} mb-1.5`} />
          <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={Math.min(14, Math.max(4, body.split("\n").length + 1))} className={`${field} resize-y leading-relaxed`} />
        </>
      ) : (
        <>
          <div className="t-dim">to: {to}</div>
          <div className="font-bold text-t-strong">{subject || "(no subject)"}</div>
        </>
      )}
      {status === "draft" ? (
        <div className="mt-2 flex flex-wrap gap-2">
          <button type="button" disabled={!!busy || !to.trim() || !body.trim()} onClick={send} className={`${btnPrimary} disabled:opacity-50`}>
            {busy === "send" ? "Sending…" : edited ? "Save & send" : "Send"}
          </button>
          <a href="https://mail.google.com/mail/u/0/#drafts" target="_blank" rel="noopener noreferrer" className={btn}>
            Open in Gmail
          </a>
          <button type="button" disabled={!!busy} onClick={discard} className={`${btn} disabled:opacity-50`}>
            {busy === "discard" ? "Discarding…" : "Discard"}
          </button>
        </div>
      ) : (
        <div className="mt-1.5 t-dim">{status === "sent" ? "✓ sent from Gmail" : "✗ draft discarded"}</div>
      )}
      {error && <p className="mt-1 text-red-400">{error}</p>}
    </Panel>
  );
}

function RoutineCard({ card }: { card: Extract<Card, { type: "routine" }> }) {
  const [status, setStatus] = useState(card.status);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const act = async (action: "approve" | "decline") => {
    setBusy(true);
    setError("");
    try {
      await api(`/api/routines/${card.routineId}`, { method: "PATCH", body: { action } });
      setStatus(action === "approve" ? "approved" : "declined");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const cadence = card.cadence === "daily" ? "every day at 8am" : `every ${WEEKDAYS[card.weekday ?? 1]} at 8am`;
  return (
    <Panel label="Routine · needs your approval">
      <div className="font-bold text-t-strong">{card.title}</div>
      <div className="t-dim">{cadence}</div>
      <p className="mt-1 line-clamp-3 t-dim">{card.prompt}</p>
      {status === "pending" ? (
        <div className="mt-2 flex gap-2">
          <button type="button" disabled={busy} onClick={() => act("approve")} className={`${btnPrimary} disabled:opacity-50`}>
            Approve
          </button>
          <button type="button" disabled={busy} onClick={() => act("decline")} className={`${btn} disabled:opacity-50`}>
            Decline
          </button>
        </div>
      ) : (
        <div className="mt-1.5 t-dim">
          {status === "approved" ? (
            <>
              ✓ approved ·{" "}
              <Link href="/routines" className="text-t-strong underline underline-offset-4">
                manage
              </Link>
            </>
          ) : (
            "✗ declined"
          )}
        </div>
      )}
      {error && (
        <p className="mt-1 text-red-400">
          {error}{" "}
          {/Pro/.test(error) && (
            <Link href="/upgrade" className="text-t-strong underline underline-offset-4">
              see plans
            </Link>
          )}
        </p>
      )}
    </Panel>
  );
}

export function CardView({ card }: { card: Card }) {
  switch (card.type) {
    case "calendar":
      return <CalendarCard card={card} />;
    case "draft":
      return <DraftCard card={card} />;
    case "gmail_draft":
      return <GmailDraftCard card={card} />;
    case "routine":
      return <RoutineCard card={card} />;
    case "pipeline":
      return (
        <Link href={`/pipeline?tab=${card.people ? "people" : "jobs"}`} className="block rounded-md border t-line bg-t-panel px-3 py-2 hover:border-t-focus fade-in">
          <span className="t-dim">Saved </span>
          <span className="font-bold text-t-strong">{[card.people ? `${card.people} ${card.people === 1 ? "person" : "people"}` : "", card.jobs ? `${card.jobs} job${card.jobs === 1 ? "" : "s"}` : ""].filter(Boolean).join(" + ")}</span>
          <span className="t-dim"> → Pipeline (drafts ready, open)</span>
        </Link>
      );
    case "document":
      return (
        <Link href={`/library/${card.documentId}`} className="block rounded-md border t-line bg-t-panel px-3 py-2 hover:border-t-focus fade-in">
          <span className="t-dim">Wrote </span>
          <span className="font-bold text-t-strong">{card.title}</span>
          <span className="t-dim"> → Library (open)</span>
        </Link>
      );
    default:
      return null;
  }
}

export function Chips({ cards }: { cards: Card[] }) {
  const chips = cards.filter((c) => c.type === "goal" || c.type === "task");
  if (!chips.length) return null;
  return (
    <div className="space-y-0.5">
      {chips.map((c) => (
        <Link key={c.id} href="/goals" className="flex min-w-0 t-dim hover:text-t-strong">
          <span className="shrink-0">└&nbsp;&nbsp;{c.type === "goal" ? "goal added: " : "task added: "}</span>
          <span className="truncate text-t-strong">{c.title}</span>
        </Link>
      ))}
    </div>
  );
}

export function Sources({ sources }: { sources: Source[] }) {
  const [open, setOpen] = useState(false);
  const list = sources.filter((s) => /^https?:/.test(s.url));
  if (!list.length) return null;
  const shown = open ? list : list.slice(0, 5);
  return (
    <div className="flex min-w-0 t-dim">
      <span className="shrink-0">└&nbsp;&nbsp;sources:&nbsp;</span>
      <span className="min-w-0">
        {shown.map((s, i) => (
          <span key={i}>
            {i > 0 && " · "}
            <a href={s.url} target="_blank" rel="noopener noreferrer" title={s.title} className="underline decoration-t-edge underline-offset-4 hover:text-t-strong">
              {/google\.[a-z.]+$/.test(domainOf(s.url)) && s.title ? s.title : domainOf(s.url)}
            </a>
          </span>
        ))}
        {list.length > 5 && (
          <button type="button" onClick={() => setOpen((o) => !o)} className="ml-[1ch] hover:text-t-strong">
            {open ? "(less)" : `(+${list.length - 5} more)`}
          </button>
        )}
      </span>
    </div>
  );
}
