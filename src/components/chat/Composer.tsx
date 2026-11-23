"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { CornerDownLeft, LoaderCircle, Mic, Square } from "lucide-react";
import type { Effort } from "@/lib/agent/types";
import { useVoice } from "./useVoice";
import { getThemePref, resolveTheme, setThemePref } from "@/lib/theme";
import { haptic } from "@/lib/native";
import { api } from "@/lib/client";
import { COACHES, coachLabel, type CustomCoach } from "@/lib/coaches";

export const EFFORTS: { value: Effort; label: string; hint: string; time: string }[] = [
  { value: "auto", label: "auto", hint: "Tarrow decides how hard to think", time: "" },
  { value: "quick", label: "fast", hint: "Quick answer, minimal lookups", time: "~10s" },
  { value: "standard", label: "standard", hint: "Researches and takes actions", time: "1–5 min" },
  { value: "deep", label: "deep", hint: "Plans and runs agents in parallel", time: "5–20 min · Pro" },
  { value: "marathon", label: "marathon", hint: "Exhaustive, long-running work + report", time: "up to 45 min · Pro" },
];

const COMMANDS: { cmd: string; desc: string; href?: string; effort?: Effort; theme?: boolean; coach?: boolean }[] = [
  { cmd: "/new", desc: "Start a new chat", href: "/c/new" },
  { cmd: "/coach", desc: "Pick who advises you (YC partner, investor…)", coach: true },
  { cmd: "/pipeline", desc: "People to contact & jobs to apply for", href: "/pipeline" },
  { cmd: "/for-you", desc: "Personalized ideas", href: "/for-you" },
  { cmd: "/goals", desc: "Goals & tasks", href: "/goals" },
  { cmd: "/memory", desc: "What Tarrow knows about you", href: "/memory" },
  { cmd: "/library", desc: "Saved reports & plans", href: "/library" },
  { cmd: "/routines", desc: "Background jobs", href: "/routines" },
  { cmd: "/gmail", desc: "Connect or manage Gmail", href: "/settings#connected" },
  { cmd: "/interview", desc: "Continue the interview", href: "/onboarding" },
  { cmd: "/settings", desc: "Profile & style", href: "/settings" },
  { cmd: "/theme", desc: "Toggle light / dark theme", theme: true },
  { cmd: "/auto", desc: "Auto effort", effort: "auto" },
  { cmd: "/fast", desc: "Fast mode (~10s)", effort: "quick" },
  { cmd: "/standard", desc: "Standard mode (1–5 min)", effort: "standard" },
  { cmd: "/deep", desc: "Deep mode with parallel agents", effort: "deep" },
  { cmd: "/marathon", desc: "Marathon mode (up to 45 min)", effort: "marathon" },
];

type Props = {
  onSend: (text: string, effort: Effort) => void | Promise<void>;
  onStop?: () => void;
  running?: boolean;
  disabled?: boolean;
  placeholder?: string;
  showEffort?: boolean;
  autoFocus?: boolean;
  initialText?: string;
  /** Signed-in users: the active coach, switchable from the footer or /coach. */
  coach?: { id: string; custom: CustomCoach | null };
};

export function Composer({ onSend, onStop, running = false, disabled = false, placeholder = "Ask Tarrow anything…", showEffort = true, autoFocus = false, initialText = "", coach }: Props) {
  const router = useRouter();
  const [text, setText] = useState(initialText);
  const [effort, setEffort] = useState<Effort>("auto");
  const [highlight, setHighlight] = useState(0);
  const [coachId, setCoachId] = useState(coach?.id ?? "tarrow");
  const [coachOpen, setCoachOpen] = useState(false);
  const [coachError, setCoachError] = useState("");
  useEffect(() => setCoachId(coach?.id ?? "tarrow"), [coach?.id]);
  const ref = useRef<HTMLTextAreaElement>(null);
  const onVoiceText = useCallback((t: string) => {
    setText((prev) => (prev.trim() ? `${prev.trim()} ${t}` : t));
    ref.current?.focus();
  }, []);
  const voice = useVoice(onVoiceText);

  useEffect(() => {
    try {
      const saved = localStorage.getItem("tarrow_effort") as Effort | null;
      if (saved && EFFORTS.some((e) => e.value === saved)) setEffort(saved);
    } catch {}
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [text]);

  useEffect(() => {
    if (!coachOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setCoachOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [coachOpen]);

  // Esc interrupts a running task, like a terminal agent.
  useEffect(() => {
    if (!running || !onStop) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onStop();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [running, onStop]);

  const setMode = (e: Effort) => {
    setEffort(e);
    try {
      localStorage.setItem("tarrow_effort", e);
    } catch {}
  };

  const cycleMode = () => {
    const i = EFFORTS.findIndex((e) => e.value === effort);
    setMode(EFFORTS[(i + 1) % EFFORTS.length].value);
  };

  const slash = text.startsWith("/") && !text.includes(" ") ? COMMANDS.filter((c) => c.cmd.startsWith(text.toLowerCase()) && (coach || (!c.coach && c.href !== "/pipeline"))) : [];

  const pickCoach = async (id: string) => {
    setCoachOpen(false);
    setCoachError("");
    if (id === "custom" && !coach?.custom?.name) {
      router.push("/settings#coach");
      return;
    }
    const prev = coachId;
    setCoachId(id);
    try {
      await api("/api/me", { method: "PATCH", body: { coach: id } });
      router.refresh();
    } catch (err) {
      setCoachId(prev);
      setCoachError((err as Error).message);
    }
  };

  const runCommand = (c: (typeof COMMANDS)[number]) => {
    setText("");
    if (c.effort) setMode(c.effort);
    if (c.theme) setThemePref(resolveTheme(getThemePref()) === "dark" ? "light" : "dark");
    if (c.coach) setCoachOpen(true);
    if (c.href) router.push(c.href === "/c/new" ? `/c/new?n=${Date.now()}` : c.href);
  };

  const submit = () => {
    const t = text.trim();
    if (!t || running || disabled) return;
    if (slash.length) return runCommand(slash[Math.min(highlight, slash.length - 1)]);
    setText("");
    void haptic("light");
    void onSend(t, effort);
  };

  const current = EFFORTS.find((e) => e.value === effort)!;

  return (
    <div className="relative">
      {coachOpen && coach && (
        <div className="absolute bottom-full left-0 right-0 z-30 mb-1 border t-line bg-t-panel py-1 fade-in" role="listbox" aria-label="Coach">
          <div className="flex justify-between px-3 pb-1 pt-0.5 text-[12px] t-dim">
            <span>who should advise you?</span>
            <button type="button" onClick={() => setCoachOpen(false)} className="hover:text-t-strong">
              esc
            </button>
          </div>
          {COACHES.map((c) => (
            <button key={c.id} type="button" role="option" aria-selected={coachId === c.id} onClick={() => pickCoach(c.id)} className={`flex w-full gap-[1ch] px-3 py-1 text-left hover:bg-t-hover ${coachId === c.id ? "text-t-strong" : "t-dim"}`}>
              <span className="w-[2ch] shrink-0">{coachId === c.id ? "●" : ""}</span>
              <span className="flex min-w-0 flex-1 flex-col sm:flex-row sm:gap-[1ch]">
                <span className="shrink-0 truncate font-bold sm:w-[15ch]">{c.id === "custom" && coach.custom?.name ? coach.custom.name : c.label}</span>
                <span className="min-w-0 truncate text-[12px] sm:text-[inherit]">{c.id === "custom" && !coach.custom?.name ? "Describe anyone in Settings" : c.hint}</span>
              </span>
            </button>
          ))}
          <a href="/settings#coach" className="block px-3 pb-0.5 pt-1 text-[12px] t-faint hover:text-t-strong">
            edit custom coach & resume in settings →
          </a>
        </div>
      )}
      {slash.length > 0 && (
        <div className="absolute bottom-full left-0 right-0 z-30 mb-1 border t-line bg-t-panel py-1 fade-in">
          {slash.map((c, i) => (
            <button
              key={c.cmd}
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                runCommand(c);
              }}
              className={`flex w-full gap-[2ch] px-3 py-0.5 text-left ${i === highlight ? "bg-t-hover text-t-strong" : "t-dim"}`}
            >
              <span className="w-[12ch] shrink-0 font-bold">{c.cmd}</span>
              <span className="truncate">{c.desc}</span>
            </button>
          ))}
        </div>
      )}
      <div className={`flex items-start gap-[1ch] rounded-md border px-3 py-2 ${running ? "border-t-line" : "border-t-edge focus-within:border-t-focus"}`}>
        <span className="select-none pt-px font-bold text-t-strong">&gt;</span>
        <textarea
          ref={ref}
          value={text}
          autoFocus={autoFocus}
          onChange={(e) => {
            setText(e.target.value);
            setHighlight(0);
          }}
          onKeyDown={(e) => {
            const coarse = typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches;
            if (e.key === "Tab" && e.shiftKey && showEffort) {
              e.preventDefault();
              cycleMode();
            } else if (slash.length && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
              e.preventDefault();
              setHighlight((h) => (h + (e.key === "ArrowDown" ? 1 : slash.length - 1)) % slash.length);
            } else if (e.key === "Enter" && !e.shiftKey && (!coarse || slash.length) && !e.nativeEvent.isComposing) {
              e.preventDefault();
              submit();
            }
          }}
          rows={1}
          placeholder={running ? "Tarrow is working…" : placeholder}
          disabled={disabled}
          aria-label="Message"
          spellCheck={false}
          className="block min-h-[22px] w-full resize-none bg-transparent leading-[22px] outline-none"
        />
        <div className="flex shrink-0 items-center gap-1">
          {voice.supported && !running &&
            (voice.state === "recording" ? (
              <button type="button" onClick={voice.stop} aria-label="Stop recording" className="flex h-[22px] items-center gap-1.5 px-1 text-red-400">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-red-400" />
                <span className="tabular-nums">0:{String(voice.seconds).padStart(2, "0")}</span>
              </button>
            ) : (
              <button type="button" onClick={voice.start} disabled={voice.state === "transcribing" || disabled} aria-label="Voice input" className="flex h-[22px] w-[22px] items-center justify-center t-dim hover:text-t-strong disabled:opacity-50">
                {voice.state === "transcribing" ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Mic className="h-3.5 w-3.5" />}
              </button>
            ))}
          {running ? (
            <button type="button" onClick={onStop} aria-label="Stop" className="flex h-[22px] w-[22px] items-center justify-center text-t-strong">
              <Square className="h-3 w-3 fill-t-strong" />
            </button>
          ) : (
            <button type="button" onClick={submit} disabled={!text.trim() || disabled} aria-label="Send" className="flex h-[22px] w-[22px] items-center justify-center text-t-strong disabled:text-t-faint">
              <CornerDownLeft className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>
      <div className="mt-1 flex min-h-[20px] items-center justify-between gap-2 px-1 text-[12px]">
        {showEffort ? (
          <button type="button" onClick={cycleMode} className="t-dim hover:text-t-strong" title={current.hint}>
            ⏵⏵ <span className="text-t-strong">{current.label}</span> mode
            {current.time ? <span className="hidden sm:inline">{` · ${current.time}`}</span> : null}
            <span className="hidden lg:inline t-faint"> (shift+tab to cycle)</span>
          </button>
        ) : (
          <span />
        )}
        {coach && showEffort && (
          <button type="button" onClick={() => setCoachOpen((o) => !o)} className="min-w-0 truncate t-dim hover:text-t-strong" title="Pick who advises you (/coach)">
            coach: <span className="text-t-strong">{coachLabel(coachId, coach.custom)}</span>
            {coachError && <span className="text-red-400"> · {coachError}</span>}
          </button>
        )}
        <span className="truncate t-faint">{voice.error ? <button type="button" onClick={voice.clearError}>{voice.error}</button> : <span className="hidden sm:inline">/ for commands · shift+enter for newline</span>}</span>
      </div>
    </div>
  );
}
