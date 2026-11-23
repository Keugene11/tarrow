"use client";

import { confirmDialog, promptDialog } from "@/components/Dialog";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Check, ChevronRight, LoaderCircle, LogOut, Mail, MessageSquare, Monitor, Moon, Repeat, ShieldCheck, Sun } from "lucide-react";
import { manageSubscription, storePlatform } from "@/lib/purchases";
import type { SubscriptionInfo } from "@/components/PlansView";
import { api } from "@/lib/client";
import { NotificationsRow } from "@/components/NotifyPill";
import { getThemePref, setThemePref, type ThemePref } from "@/lib/theme";
import { isNative, unregisterNativePush } from "@/lib/native";
import { COACHES, type CustomCoach } from "@/lib/coaches";

const THEMES: { value: ThemePref; label: string; icon: typeof Sun }[] = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "System", icon: Monitor },
];

const STYLES = [
  { value: "direct", label: "Direct", hint: "Blunt, no fluff, like a smart friend" },
  { value: "warm", label: "Warm", hint: "Encouraging but still concrete" },
  { value: "coach", label: "Coach", hint: "Pushes you and holds you accountable" },
  { value: "analytical", label: "Analytical", hint: "Structured, tradeoffs and numbers" },
];

type Props = {
  user: { email: string; name: string; city: string; timezone: string; agent_style: string };
  /** Only on the owner's account (lib/personal.ts). */
  coach: { id: string; custom: CustomCoach | null; resume: string } | null;
  usage: { runs: number; limit: number };
  plan: "free" | "pro";
  subscription: SubscriptionInfo;
  gmail: { email: string; connectedAt: string } | null;
  /** Server has Google OAuth + GMAIL_TOKEN_KEY configured. */
  gmailAvailable: boolean;
  /** `?gmail=` status from the OAuth callback. */
  gmailNotice: string;
};

const GMAIL_NOTICES: Record<string, string> = {
  connected: "Gmail connected. Ask Tarrow about your email or to draft a reply.",
  cancelled: "Gmail connection cancelled.",
  scopes: "Tarrow needs both Gmail permissions (read mail, manage drafts). Try again and keep both boxes checked.",
  failed: "Couldn't connect Gmail. Try again.",
  state: "That sign-in link expired. Try again.",
  expired: "That link expired. Start again from the app.",
  unavailable: "Gmail connection isn't set up on this server yet.",
};

function ConnectedAccounts({ gmail, available, notice }: { gmail: Props["gmail"]; available: boolean; notice: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(GMAIL_NOTICES[notice] ?? "");
  const [error, setError] = useState("");

  const connect = async () => {
    setBusy(true);
    setError("");
    try {
      if (!isNative()) {
        window.location.href = "/api/integrations/gmail";
        return;
      }
      // Google blocks OAuth inside webviews: the system browser does it and returns via tarrow://gmail.
      const { url } = await api<{ url: string }>("/api/integrations/gmail/link", { method: "POST" });
      const { Browser } = await import("@capacitor/browser");
      await Browser.open({ url });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async () => {
    const ok = await confirmDialog({
      title: "Disconnect Gmail?",
      body: "Tarrow will no longer be able to read your email or create drafts. Its access token is deleted and revoked with Google. Drafts already in Gmail stay there.",
      confirmLabel: "Disconnect",
      danger: true,
    });
    if (!ok) return;
    setBusy(true);
    setError("");
    try {
      await api("/api/integrations/gmail", { method: "DELETE" });
      setMsg("Gmail disconnected.");
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section id="connected" className="scroll-mt-20 rounded-3xl border border-neutral-200 p-4">
      <h2 className="text-[15px] font-semibold">Connected accounts</h2>
      <p className="mt-0.5 text-[12.5px] text-neutral-500">Give Tarrow access to more of your life. It only reads what a request needs and never sends anything itself.</p>
      {msg && <p className="mt-2 rounded-2xl bg-neutral-100 px-3 py-2 text-[13px]">{msg}</p>}
      {error && <p className="mt-2 rounded-2xl bg-neutral-100 px-3 py-2 text-[13px]">{error}</p>}
      <div className="mt-3 flex items-center gap-3 rounded-2xl border border-neutral-200 px-4 py-3">
        <Mail className="h-4 w-4 shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="text-[14.5px] font-medium">Gmail</div>
          <div className="truncate text-[12.5px] text-neutral-500">
            {gmail ? `${gmail.email} · connected ${new Date(gmail.connectedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}` : available ? "Search and read your mail, draft replies you send in one tap" : "Not available on this server"}
          </div>
        </div>
        {gmail ? (
          <button type="button" disabled={busy} onClick={disconnect} className="press shrink-0 rounded-full border border-neutral-300 px-3.5 py-2 text-[13.5px] font-medium disabled:opacity-50">
            Disconnect
          </button>
        ) : (
          <button type="button" disabled={busy || !available} onClick={connect} className="press flex shrink-0 items-center gap-1.5 rounded-full bg-neutral-900 px-3.5 py-2 text-[13.5px] font-medium text-white disabled:bg-neutral-200 disabled:text-neutral-400">
            {busy && <LoaderCircle className="h-3.5 w-3.5 animate-spin" />} Connect
          </button>
        )}
      </div>
    </section>
  );
}

function CoachSection({ initial }: { initial: NonNullable<Props["coach"]> }) {
  const router = useRouter();
  const [coach, setCoach] = useState(initial.id);
  const [name, setName] = useState(initial.custom?.name ?? "");
  const [description, setDescription] = useState(initial.custom?.description ?? "");
  const [resume, setResume] = useState(initial.resume);
  const [status, setStatus] = useState<"" | "saving" | "saved">("");
  const [error, setError] = useState("");

  const patch = async (body: Record<string, unknown>) => {
    setStatus("saving");
    setError("");
    try {
      await api("/api/me", { method: "PATCH", body });
      setStatus("saved");
      setTimeout(() => setStatus(""), 1800);
      router.refresh();
      return true;
    } catch (err) {
      setError((err as Error).message);
      setStatus("");
      return false;
    }
  };
  const pick = async (id: string) => {
    if (id === "custom" && !name.trim()) {
      setCoach("custom");
      document.getElementById("coach-name")?.focus();
      return;
    }
    const prev = coach;
    setCoach(id);
    if (!(await patch({ coach: id }))) setCoach(prev);
  };
  const customDirty = name !== (initial.custom?.name ?? "") || description !== (initial.custom?.description ?? "");
  const input = "w-full rounded-2xl border border-neutral-200 px-4 py-2.5 text-[15px] outline-none focus:border-neutral-900";

  return (
    <section id="coach" className="scroll-mt-20 rounded-3xl border border-neutral-200 p-4">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-[15px] font-semibold">Coach</h2>
        <span className="text-[12.5px] text-neutral-500">{status === "saving" ? "Saving…" : status === "saved" ? "Saved" : "/coach in chat"}</span>
      </div>
      <p className="mt-0.5 text-[12.5px] text-neutral-500">Who Tarrow advises you as. It still knows your life and can do the work.</p>
      {error && <p className="mt-2 rounded-2xl bg-neutral-100 px-3 py-2 text-[13px]">{error}</p>}
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {COACHES.map((c) => (
          <button key={c.id} type="button" onClick={() => pick(c.id)} className={`press rounded-2xl border p-3 text-left ${coach === c.id ? "border-neutral-900 bg-neutral-50" : "border-neutral-200"}`}>
            <div className="flex items-center justify-between text-[14.5px] font-medium">
              {c.id === "custom" && initial.custom?.name ? initial.custom.name : c.label}
              {coach === c.id && <Check className="h-4 w-4" />}
            </div>
            <div className="text-[12.5px] text-neutral-500">{c.hint}</div>
          </button>
        ))}
      </div>
      {coach === "custom" && (
        <div className="mt-3 space-y-2">
          <input id="coach-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder="Who? e.g. Paul Graham, a Jane Street trader" className={input} />
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} maxLength={600} rows={3} placeholder="Optional: what you want from them (e.g. brutal feedback on my startup, how to think about risk)" className={`${input} resize-y`} />
          <div className="flex justify-end">
            <button type="button" disabled={!name.trim() || (!customDirty && initial.id === "custom")} onClick={() => patch({ coach: "custom", coach_custom: { name, description } })} className="press rounded-full bg-neutral-900 px-5 py-2 text-[14px] font-medium text-white disabled:bg-neutral-200 disabled:text-neutral-400">
              Use this coach
            </button>
          </div>
        </div>
      )}
      <label className="mt-4 block text-[12.5px] font-medium text-neutral-500">
        Resume
        <textarea value={resume} onChange={(e) => setResume(e.target.value)} maxLength={12000} rows={resume ? 6 : 3} placeholder="Paste your resume or LinkedIn summary. Tarrow uses it to match jobs and write pitches." className={`${input} mt-1 resize-y text-[13.5px]`} />
      </label>
      {resume !== initial.resume && (
        <div className="mt-2 flex justify-end">
          <button type="button" onClick={() => patch({ resume })} className="press rounded-full bg-neutral-900 px-5 py-2 text-[14px] font-medium text-white">
            Save resume
          </button>
        </div>
      )}
    </section>
  );
}

const STORE_NAME = { stripe: "the web", apple: "the App Store", google: "Google Play" } as const;

export function SettingsClient({ user, coach, usage, plan, subscription, gmail, gmailAvailable, gmailNotice }: Props) {
  const [managing, setManaging] = useState(false);
  // Known only in the browser; a web (Stripe) subscription is managed on the web, not inside the apps.
  const [onWeb, setOnWeb] = useState(true);
  useEffect(() => setOnWeb(storePlatform() === "web"), []);
  const manage = async () => {
    if (!subscription) return;
    setManaging(true);
    try {
      await manageSubscription(subscription.provider);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setManaging(false);
    }
  };
  const router = useRouter();
  const [form, setForm] = useState(user);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [theme, setTheme] = useState<ThemePref>("light");

  useEffect(() => setTheme(getThemePref()), []);

  const dirty = form.name !== user.name || form.city !== user.city || form.timezone !== user.timezone || form.agent_style !== user.agent_style;

  const save = async (patch: Partial<typeof form> = {}) => {
    const next = { ...form, ...patch };
    setForm(next);
    setSaving(true);
    setError("");
    try {
      await api("/api/me", { method: "PATCH", body: next });
      setSaved(true);
      setTimeout(() => setSaved(false), 1800);
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const logout = async () => {
    await unregisterNativePush();
    await api("/api/auth/logout", { method: "POST" }).catch(() => {});
    window.location.href = "/";
  };

  const withdrawConsent = async () => {
    const ok = await confirmDialog({
      title: "Stop sharing data with AI providers?",
      body: "Tarrow can't answer without its AI providers, so you'll be asked again before your next message. Your saved data stays until you delete it.",
      confirmLabel: "Withdraw",
      danger: true,
    });
    if (!ok) return;
    await api("/api/consent", { body: { agree: false } }).catch(() => {});
    window.location.href = "/consent";
  };

  const deleteAccount = async () => {
    const typed = await promptDialog({ title: "Delete your account?", body: "This permanently deletes your account, memories, chats, goals and documents. Type DELETE to confirm.", placeholder: "DELETE", mustEqual: "DELETE", confirmLabel: "Delete account", danger: true });
    if (typed?.trim() !== "DELETE") return;
    await unregisterNativePush();
    try {
      await api("/api/me", { method: "DELETE", body: { confirm: "DELETE" } });
      window.location.href = "/";
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const pct = Math.min(100, Math.round((usage.runs / usage.limit) * 100));
  const input = "w-full rounded-2xl border border-neutral-200 px-4 py-2.5 text-[15px] outline-none focus:border-neutral-900";

  return (
    <div className="mx-auto w-full max-w-[720px] space-y-6 px-4 pb-16 pt-4">
      {error && <p className="rounded-2xl bg-neutral-100 px-4 py-2.5 text-[14px]">{error}</p>}

      <section className="rounded-3xl border border-neutral-200 p-4">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-[15px] font-semibold">{plan === "pro" ? "Tarrow Pro" : "Free plan"}</h2>
            {plan === "pro" && subscription?.periodEnd && (
              <p className="text-[12.5px] text-neutral-500">
                {subscription.product === "yearly" ? "Yearly" : "Monthly"} · {subscription.willRenew ? "renews" : "ends"} {new Date(subscription.periodEnd).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })} · via {STORE_NAME[subscription.provider]}
              </p>
            )}
            {plan === "free" && <p className="text-[12.5px] text-neutral-500">Pro unlocks Deep and Marathon modes and 150 tasks a day.</p>}
          </div>
          {plan === "free" ? (
            <Link href="/upgrade" className="press shrink-0 rounded-full bg-neutral-900 px-3.5 py-2 text-[13.5px] font-medium text-white">
              Upgrade
            </Link>
          ) : subscription && (subscription.provider !== "stripe" || onWeb) ? (
            <button type="button" onClick={manage} disabled={managing} className="press flex shrink-0 items-center gap-1.5 rounded-full border border-neutral-300 px-3.5 py-2 text-[13.5px] font-medium disabled:opacity-50">
              {managing && <LoaderCircle className="h-3.5 w-3.5 animate-spin" />} Manage
            </button>
          ) : (
            <Link href="/upgrade" className="press shrink-0 rounded-full border border-neutral-300 px-3.5 py-2 text-[13.5px] font-medium">
              Plan
            </Link>
          )}
        </div>
        <div className="flex items-baseline justify-between">
          <h3 className="text-[13.5px] font-medium text-neutral-600">Today&apos;s usage</h3>
          <span className="text-[13px] tabular-nums text-neutral-500">
            {usage.runs} / {usage.limit} tasks
          </span>
        </div>
        <div className="mt-2.5 h-2 overflow-hidden rounded-full bg-neutral-100">
          <div className="h-full rounded-full bg-neutral-900" style={{ width: `${Math.max(1, pct)}%` }} />
        </div>
        <p className="mt-2 text-[12.5px] text-neutral-500">Resets at midnight.</p>
      </section>

      {coach && <CoachSection initial={coach} />}

      <section className="rounded-3xl border border-neutral-200 p-4">
        <h2 className="mb-3 text-[15px] font-semibold">Profile</h2>
        <label className="block text-[12.5px] font-medium text-neutral-500">
          Name
          <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} maxLength={60} className={`${input} mt-1`} />
        </label>
        <label className="mt-3 block text-[12.5px] font-medium text-neutral-500">
          City
          <input value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} maxLength={80} placeholder="e.g. Brooklyn, NY" className={`${input} mt-1`} />
        </label>
        <label className="mt-3 block text-[12.5px] font-medium text-neutral-500">
          Timezone
          <div className="mt-1 flex gap-2">
            <input value={form.timezone} onChange={(e) => setForm({ ...form, timezone: e.target.value })} className={input} />
            <button type="button" onClick={() => setForm({ ...form, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone })} className="press shrink-0 rounded-2xl border border-neutral-200 px-3 text-[13px] font-medium">
              Detect
            </button>
          </div>
        </label>
        <div className="mt-4 flex items-center justify-end gap-2">
          {saved && (
            <span className="inline-flex items-center gap-1 text-[13px] text-neutral-500">
              <Check className="h-3.5 w-3.5" /> Saved
            </span>
          )}
          <button type="button" disabled={!dirty || saving} onClick={() => save()} className="press rounded-full bg-neutral-900 px-5 py-2 text-[14px] font-medium text-white disabled:bg-neutral-200 disabled:text-neutral-400">
            {saving ? "Saving" : "Save"}
          </button>
        </div>
      </section>

      <section className="rounded-3xl border border-neutral-200 p-4">
        <h2 className="text-[15px] font-semibold">Appearance</h2>
        <div role="radiogroup" aria-label="Theme" className="mt-3 grid grid-cols-3 gap-2">
          {THEMES.map((t) => (
            <button
              key={t.value}
              type="button"
              role="radio"
              aria-checked={theme === t.value}
              onClick={() => {
                setTheme(t.value);
                setThemePref(t.value);
              }}
              className={`press flex items-center justify-center gap-2 rounded-2xl border px-3 py-2.5 text-[14px] font-medium ${theme === t.value ? "border-neutral-900 bg-neutral-50" : "border-neutral-200"}`}
            >
              <t.icon className="h-4 w-4" /> {t.label}
            </button>
          ))}
        </div>
      </section>

      <section className="rounded-3xl border border-neutral-200 p-4">
        <h2 className="text-[15px] font-semibold">How Tarrow talks to you</h2>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {STYLES.map((s) => (
            <button key={s.value} type="button" onClick={() => save({ agent_style: s.value })} className={`press rounded-2xl border p-3 text-left ${form.agent_style === s.value ? "border-neutral-900 bg-neutral-50" : "border-neutral-200"}`}>
              <div className="flex items-center justify-between text-[14.5px] font-medium">
                {s.label}
                {form.agent_style === s.value && <Check className="h-4 w-4" />}
              </div>
              <div className="text-[12.5px] text-neutral-500">{s.hint}</div>
            </button>
          ))}
        </div>
      </section>

      <ConnectedAccounts gmail={gmail} available={gmailAvailable} notice={gmailNotice} />

      <section className="overflow-hidden rounded-3xl border border-neutral-200">
        <Link href="/onboarding" className="press flex items-center gap-3 px-4 py-3.5 hover:bg-neutral-50">
          <MessageSquare className="h-4 w-4" /> <span className="flex-1 text-[14.5px]">Continue the interview</span> <ChevronRight className="h-4 w-4 text-neutral-300" />
        </Link>
        <Link href="/routines" className="press flex items-center gap-3 border-t border-neutral-100 px-4 py-3.5 hover:bg-neutral-50">
          <Repeat className="h-4 w-4" /> <span className="flex-1 text-[14.5px]">Routines</span> <ChevronRight className="h-4 w-4 text-neutral-300" />
        </Link>
        <NotificationsRow />
        <div className="flex items-center gap-3 border-t border-neutral-100 px-4 py-3.5">
          <ShieldCheck className="h-4 w-4" />
          <span className="flex-1 text-[14.5px]">
            AI &amp; data sharing{" "}
            <Link href="/privacy" className="text-[12.5px] text-neutral-500 underline underline-offset-2">
              details
            </Link>
          </span>
          <button type="button" onClick={withdrawConsent} className="press text-[12.5px] text-neutral-500 hover:text-neutral-900">
            On · withdraw
          </button>
        </div>
        <button type="button" onClick={logout} className="press flex w-full items-center gap-3 border-t border-neutral-100 px-4 py-3.5 text-left hover:bg-neutral-50">
          <LogOut className="h-4 w-4" /> <span className="flex-1 text-[14.5px]">Sign out</span>
          <span className="text-[12.5px] text-neutral-400">{user.email}</span>
        </button>
      </section>

      <div className="flex justify-between px-1 text-[12.5px] text-neutral-400">
        <span>
          <Link href="/privacy" className="hover:text-neutral-700">
            Privacy
          </Link>{" "}
          ·{" "}
          <Link href="/terms" className="hover:text-neutral-700">
            Terms
          </Link>
        </span>
        <button type="button" onClick={deleteAccount} className="press hover:text-red-600">
          Delete account
        </button>
      </div>
    </div>
  );
}
