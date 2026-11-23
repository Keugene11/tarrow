"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createContext, useContext, useEffect, useState } from "react";
import { BookOpen, Brain, Gem, Menu, MessageSquareText, Repeat, Settings, Sparkles, SquarePen, Target, Users, X } from "lucide-react";
import { Logo } from "./Logo";
import { api } from "@/lib/client";

const NAV = [
  { href: "/for-you", label: "For you", icon: Sparkles },
  { href: "/goals", label: "Goals", icon: Target },
  { href: "/memory", label: "Memory", icon: Brain },
  { href: "/library", label: "Library", icon: BookOpen },
  { href: "/routines", label: "Routines", icon: Repeat },
];

type Conv = { id: string; title: string; last_status: string | null };

const DrawerContext = createContext<() => void>(() => {});

/** Opens the chat sidebar on mobile. */
export function MenuButton({ dark = false }: { dark?: boolean }) {
  const open = useContext(DrawerContext);
  return (
    <button type="button" onClick={open} aria-label="Open menu" className={`press -ml-1.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full md:hidden ${dark ? "text-t-soft hover:bg-t-hover" : "hover:bg-neutral-100"}`}>
      <Menu className="h-5 w-5" />
    </button>
  );
}

/**
 * userName null = logged-out visitor: same layout, but pages ask them to sign up.
 * guestAccount = trying Tarrow without an account (has chats, but sign-up replaces settings/upgrade).
 * interviewId = unfinished interview, pinned at the top so new users can always get back to it.
 */
export function AppShell({
  children,
  userName,
  plan = "free",
  personal = false,
  guestAccount = false,
  interviewId = null,
}: {
  children: React.ReactNode;
  userName: string | null;
  plan?: "free" | "pro";
  personal?: boolean;
  guestAccount?: boolean;
  interviewId?: string | null;
}) {
  const guest = userName === null;

  // In the apps, re-send store subscriptions once per launch so renewals made offline or while notifications lagged still count.
  useEffect(() => {
    if (guest || guestAccount) return;
    try {
      if (sessionStorage.getItem("tarrow_store_synced")) return;
      sessionStorage.setItem("tarrow_store_synced", "1");
    } catch {}
    import("@/lib/purchases").then(({ restorePurchases, storePlatform }) => {
      if (storePlatform() !== "web") restorePurchases({ silent: true }).catch(() => {});
    });
  }, [guest, guestAccount]);
  const pathname = usePathname();
  const router = useRouter();
  const [recent, setRecent] = useState<Conv[]>([]);
  const [drawer, setDrawer] = useState(false);

  useEffect(() => {
    if (guest) return;
    let alive = true;
    api<{ conversations: Conv[] }>("/api/conversations")
      .then((d) => alive && setRecent(d.conversations.slice(0, 40)))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [pathname, guest]);

  useEffect(() => setDrawer(false), [pathname]);
  const newChat = () => (guest ? setDrawer(false) : router.push(`/c/new?n=${Date.now()}`));

  const chats = recent.filter((c) => c.id !== interviewId);
  const active = (href: string) => pathname === href || pathname.startsWith(`${href}/`);

  const sidebar = (
    <div className="flex h-full flex-col">
      <div className="pt-safe flex items-center justify-between px-3 pb-2 pt-3">
        <Link href={guest ? "/" : "/c/new"} className="press px-1">
          <Logo size={26} />
        </Link>
        <div className="flex items-center gap-1">
          <button type="button" onClick={newChat} aria-label="New chat" className="press flex h-9 w-9 items-center justify-center rounded-full hover:bg-white">
            <SquarePen className="h-[18px] w-[18px]" />
          </button>
          <button type="button" onClick={() => setDrawer(false)} aria-label="Close menu" className="press flex h-9 w-9 items-center justify-center rounded-full hover:bg-white md:hidden">
            <X className="h-5 w-5" />
          </button>
        </div>
      </div>
      <div className="px-2">
        <button type="button" onClick={newChat} className="press flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-[14px] font-medium hover:bg-white">
          <SquarePen className="h-4 w-4" /> New chat
        </button>
      </div>
      <div className="mt-3 min-h-0 flex-1 overflow-y-auto px-2">
        {(guest || interviewId) && (
          <Link
            href={interviewId ? `/c/${interviewId}` : "/"}
            className={`press mb-3 flex items-center gap-2.5 rounded-xl border px-3 py-2.5 text-[14px] ${pathname === (interviewId ? `/c/${interviewId}` : "/") ? "border-neutral-900 bg-white" : "border-neutral-200 bg-white hover:border-neutral-900"}`}
          >
            <MessageSquareText className="h-4 w-4 shrink-0" />
            <span className="min-w-0 flex-1">
              <span className="block font-medium">{interviewId ? "Finish your interview" : "Start with the interview"}</span>
              <span className="block truncate text-[12px] text-neutral-500">5 min, so every answer fits your life</span>
            </span>
          </Link>
        )}
        {chats.length > 0 && <div className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-neutral-400">Chats</div>}
        {chats.map((c) => (
          <Link key={c.id} href={`/c/${c.id}`} className={`press flex items-center gap-2 rounded-xl px-3 py-2 text-[14px] ${pathname === `/c/${c.id}` ? "bg-white font-medium shadow-[0_0_0_1px_#e7e5e4]" : "text-neutral-700 hover:bg-white"}`}>
            {c.last_status && ["queued", "running", "waiting"].includes(c.last_status) && <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-neutral-900" />}
            <span className="truncate">{c.title}</span>
          </Link>
        ))}
        {chats.length === 0 && <p className="px-3 py-2 text-[13px] text-neutral-400">Your chats will show up here.</p>}
      </div>
      <nav className="space-y-0.5 border-t border-neutral-200 px-2 pt-2">
        {(guest || (plan === "free" && !guestAccount)) && (
          <Link href={guest ? "/pricing" : "/upgrade"} className={`press flex items-center gap-2.5 rounded-xl px-3 py-2 text-[14px] font-medium ${active("/upgrade") || active("/pricing") ? "bg-white shadow-[0_0_0_1px_#e7e5e4]" : "hover:bg-white"}`}>
            <Gem className="h-4 w-4" /> {guest ? "Pricing" : "Upgrade to Pro"}
          </Link>
        )}
        {(personal ? [NAV[0], { href: "/pipeline", label: "Pipeline", icon: Users }, ...NAV.slice(1)] : NAV).map((n) => (
          <Link key={n.href} href={guest ? "/signup" : n.href} className={`press flex items-center gap-2.5 rounded-xl px-3 py-2 text-[14px] ${active(n.href) ? "bg-white font-medium shadow-[0_0_0_1px_#e7e5e4]" : "text-neutral-600 hover:bg-white"}`}>
            <n.icon className="h-4 w-4" /> {n.label}
          </Link>
        ))}
      </nav>
      {guestAccount ? (
        <div className="m-2 mb-[max(8px,var(--safe-bottom))] rounded-xl border border-neutral-200 bg-white p-3">
          <p className="text-[13px] font-medium">You&apos;re trying Tarrow as a guest</p>
          <p className="mt-0.5 text-[12px] text-neutral-500">Sign up to keep your interview, memory and chats.</p>
          <div className="mt-2.5 flex gap-2">
            <Link href="/login" className="press flex-1 rounded-lg px-3 py-2 text-center text-[13.5px] font-medium hover:bg-neutral-100">
              Log in
            </Link>
            <Link href="/signup" className="press flex-1 rounded-lg bg-neutral-900 px-3 py-2 text-center text-[13.5px] font-medium text-white">
              Sign up
            </Link>
          </div>
        </div>
      ) : guest ? (
        <div className="m-2 mb-[max(8px,var(--safe-bottom))] flex gap-2">
          <Link href="/login" className="press flex-1 rounded-xl px-3 py-2.5 text-center text-[14px] font-medium hover:bg-white">
            Log in
          </Link>
          <Link href="/signup" className="press flex-1 rounded-xl bg-neutral-900 px-3 py-2.5 text-center text-[14px] font-medium text-white">
            Sign up
          </Link>
        </div>
      ) : (
      <Link href="/settings" className={`press m-2 mb-[max(8px,var(--safe-bottom))] flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-[14px] ${active("/settings") ? "bg-white shadow-[0_0_0_1px_#e7e5e4]" : "hover:bg-white"}`}>
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-neutral-900 text-[12px] font-semibold text-white">{(userName ?? "").slice(0, 1).toUpperCase()}</span>
        <span className="min-w-0 flex-1 truncate font-medium">{userName}</span>
        <Settings className="h-4 w-4 text-neutral-400" />
      </Link>
      )}
    </div>
  );

  return (
    <DrawerContext.Provider value={() => setDrawer(true)}>
      <div data-app-shell className="term flex h-app w-full overflow-hidden bg-white">
        <aside className="hidden w-[270px] shrink-0 border-r border-neutral-200 bg-[#fafaf9] md:block">{sidebar}</aside>
        {drawer && (
          <div className="fixed inset-0 z-50 md:hidden">
            <button type="button" aria-label="Close menu" onClick={() => setDrawer(false)} className="absolute inset-0 bg-black/30 fade-in" />
            <aside className="absolute inset-y-0 left-0 w-[84%] max-w-[320px] bg-[#fafaf9] shadow-2xl slide-in">{sidebar}</aside>
          </div>
        )}
        <main className="flex min-h-0 min-w-0 flex-1 flex-col">{children}</main>
      </div>
    </DrawerContext.Provider>
  );
}

export function PageHeader({ title, subtitle, right, back }: { title: string; subtitle?: string; right?: React.ReactNode; back?: React.ReactNode }) {
  return (
    <header className="pt-safe sticky top-0 z-20 shrink-0 border-b border-neutral-100 bg-white/95 backdrop-blur">
      <div className="mx-auto flex w-full max-w-[720px] items-center gap-2 px-4 py-3">
        {back ?? <MenuButton />}
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-[17px] font-semibold tracking-tight">{title}</h1>
          {subtitle && <p className="truncate text-[12.5px] text-neutral-500">{subtitle}</p>}
        </div>
        {right}
      </div>
    </header>
  );
}
