import Link from "next/link";
import { after } from "next/server";
import { ChevronRight, Repeat, Target } from "lucide-react";
import { sql } from "@/lib/db";
import { requireConsentedUser } from "@/lib/auth";
import { getWeather } from "@/lib/places";
import { generateSuggestions } from "@/lib/agent/memory";
import { runDueRoutines } from "@/lib/agent/routines";
import { sweepStale } from "@/lib/agent/runtime";
import { MenuButton } from "@/components/AppShell";
import { HomeComposer, RunningNow, SuggestionCards, TaskQuickList } from "./HomeClient";

export const metadata = { title: "For you" };

const weatherCache = new Map<string, { at: number; text: string }>();
async function weatherLine(city: string | null) {
  if (!city) return null;
  const hit = weatherCache.get(city);
  if (hit && Date.now() - hit.at < 30 * 60_000) return hit.text;
  try {
    const w = await Promise.race([getWeather(city, 1), new Promise<never>((_, rej) => setTimeout(() => rej(new Error("slow")), 2500))]);
    const text = `${w.now.split(",").slice(0, 2).join(",")} in ${city.split(",")[0]}`;
    weatherCache.set(city, { at: Date.now(), text });
    return text;
  } catch {
    return null;
  }
}

function greeting(tz: string) {
  let hour = new Date().getHours();
  try {
    hour = Number(new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", hourCycle: "h23" }).format(new Date()));
  } catch {}
  return hour < 5 ? "Up late" : hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
}

export default async function HomePage() {
  const user = await requireConsentedUser();
  const [suggestions, goals, tasks, running, recent, routines, weather] = await Promise.all([
    sql`select id, kind, title, body, prompt, created_at from suggestions where user_id = ${user.id} and not dismissed order by created_at desc limit 4`,
    sql`select id, title, progress, target_date from goals where user_id = ${user.id} and status = 'active' order by created_at limit 4`,
    sql`select id, title, due_at, status from tasks where user_id = ${user.id} and status = 'open' order by due_at nulls last, created_at desc limit 5`,
    sql`select r.id, r.title, r.status, r.started_at, r.created_at, r.conversation_id, c.title as conv_title from runs r join conversations c on c.id = r.conversation_id where r.user_id = ${user.id} and r.parent_run_id is null and r.status in ('queued','running','waiting') order by r.created_at desc limit 5`,
    sql`select id, title, updated_at from conversations where user_id = ${user.id} and kind <> 'interview' order by updated_at desc limit 4`,
    sql`select count(*)::int as n from routines where user_id = ${user.id} and active`,
    weatherLine(user.city),
  ]);

  const lastSuggestion = suggestions[0]?.created_at ? new Date(suggestions[0].created_at as string).getTime() : 0;
  after(async () => {
    try {
      await sweepStale(user.id);
      await runDueRoutines(user.id);
      if (Date.now() - lastSuggestion > 20 * 3600_000 && user.life_file) await generateSuggestions(user.id);
    } catch (err) {
      console.warn("home housekeeping failed", err);
    }
  });

  const first = user.name?.split(" ")[0] ?? "";
  const date = new Intl.DateTimeFormat("en-US", { timeZone: user.timezone, weekday: "long", month: "long", day: "numeric" }).format(new Date());

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="pt-safe mx-auto w-full max-w-[720px] px-4 pb-10">
        <div className="flex items-center justify-between pt-4 md:hidden">
          <MenuButton />
          <Link href="/settings" aria-label="Settings" className="press flex h-9 w-9 items-center justify-center rounded-full bg-neutral-900 text-[13px] font-semibold text-white">
            {(first || "?").slice(0, 1).toUpperCase()}
          </Link>
        </div>

        <section className="pt-6 md:pt-10">
          <p className="text-[13px] font-medium text-neutral-500">
            {date}
            {weather ? ` · ${weather}` : ""}
          </p>
          <h1 className="mt-1 text-[30px] font-semibold leading-tight tracking-tight">
            {greeting(user.timezone)}
            {first ? `, ${first}` : ""}.
          </h1>
        </section>

        <section className="mt-5">
          <HomeComposer />
        </section>

        {running.length > 0 && (
          <section className="mt-7">
            <SectionTitle>Working on it</SectionTitle>
            <RunningNow runs={JSON.parse(JSON.stringify(running))} />
          </section>
        )}

        <section className="mt-7">
          <SuggestionCards initial={JSON.parse(JSON.stringify(suggestions))} />
        </section>

        <section className="mt-7 grid gap-3 sm:grid-cols-2">
          <div className="rounded-3xl border border-neutral-200 p-4">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-[15px] font-semibold">Goals</h2>
              <Link href="/goals" className="press text-[13px] text-neutral-500 hover:text-neutral-900">
                All
              </Link>
            </div>
            {goals.length === 0 ? (
              <Link href="/c/new?q=Help%20me%20set%202-3%20concrete%20goals%20for%20the%20next%203%20months%20based%20on%20what%20you%20know%20about%20me" className="press flex items-center gap-2 text-[14px] text-neutral-500">
                <Target className="h-4 w-4" /> Set goals with Tarrow
              </Link>
            ) : (
              <div className="space-y-3">
                {goals.map((g) => (
                  <div key={g.id as string}>
                    <div className="flex justify-between gap-2 text-[14px]">
                      <span className="truncate font-medium">{g.title as string}</span>
                      <span className="tabular-nums text-neutral-400">{g.progress as number}%</span>
                    </div>
                    <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-neutral-100">
                      <div className="h-full rounded-full bg-neutral-900" style={{ width: `${Math.max(2, g.progress as number)}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="rounded-3xl border border-neutral-200 p-4">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-[15px] font-semibold">Up next</h2>
              <Link href="/goals" className="press text-[13px] text-neutral-500 hover:text-neutral-900">
                All
              </Link>
            </div>
            <TaskQuickList initial={JSON.parse(JSON.stringify(tasks))} />
          </div>
        </section>

        {recent.length > 0 && (
          <section className="mt-7">
            <div className="mb-2.5 flex items-center justify-between">
              <h2 className="text-[15px] font-semibold">Recent</h2>
              <Link href="/chats" className="press text-[13px] text-neutral-500 hover:text-neutral-900">
                All chats
              </Link>
            </div>
            <div className="overflow-hidden rounded-3xl border border-neutral-200">
              {recent.map((c, i) => (
                <Link key={c.id as string} href={`/c/${c.id}`} className={`press flex items-center gap-3 px-4 py-3 hover:bg-neutral-50 ${i ? "border-t border-neutral-100" : ""}`}>
                  <span className="min-w-0 flex-1 truncate text-[14.5px]">{c.title as string}</span>
                  <ChevronRight className="h-4 w-4 text-neutral-300" />
                </Link>
              ))}
            </div>
          </section>
        )}

        <Link href="/routines" className="press mt-3 flex items-center gap-3 rounded-3xl border border-neutral-200 px-4 py-3 hover:bg-neutral-50">
          <Repeat className="h-4 w-4" />
          <span className="flex-1 text-[14.5px]">Routines</span>
          <span className="text-[13px] text-neutral-400">{(routines[0]?.n as number) ?? 0} active</span>
          <ChevronRight className="h-4 w-4 text-neutral-300" />
        </Link>
      </div>
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h2 className="mb-2.5 text-[15px] font-semibold">{children}</h2>;
}
