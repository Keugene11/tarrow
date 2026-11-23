import { sql } from "@/lib/db";
import { authed, body, destroyAndRespond, HttpError, json } from "@/lib/http";
import { STYLE_TEXT } from "@/lib/agent/context";
import { limitsFor } from "@/lib/billing";
import { COACHES } from "@/lib/coaches";
import { hasPersonalFeatures } from "@/lib/personal";

export const GET = authed(async (_req, user) => {
  const [usage, ent] = await Promise.all([
    sql`select coalesce(sum(runs), 0)::int as runs, coalesce(sum(tokens), 0)::int as tokens from usage_daily where user_id = ${user.id} and day = current_date`,
    limitsFor(user.id),
  ]);
  return json({
    user: { id: user.id, email: user.email, name: user.name, city: user.city, timezone: user.timezone, agent_style: user.agent_style, onboarded: !!user.onboarded_at, plan: ent.plan, guest: user.is_guest },
    usage: { runsToday: usage[0]?.runs ?? 0, limit: ent.limits.runsPerDay },
  });
});

export const PATCH = authed(async (req, user) => {
  const b = await body<{ name?: string; city?: string; timezone?: string; agent_style?: string; coach?: string; coach_custom?: { name?: string; description?: string }; resume?: string }>(req);
  const name = typeof b.name === "string" ? b.name.trim().slice(0, 60) : null;
  if (name === "") throw new HttpError(400, "Name can't be empty");
  const city = typeof b.city === "string" ? b.city.trim().slice(0, 80) : null;
  let timezone: string | null = typeof b.timezone === "string" ? b.timezone.slice(0, 60) : null;
  if (timezone) {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: timezone });
    } catch {
      timezone = null;
    }
  }
  const style = typeof b.agent_style === "string" && STYLE_TEXT[b.agent_style] ? b.agent_style : null;
  const personal = hasPersonalFeatures(user);
  const coach = personal && typeof b.coach === "string" && COACHES.some((c) => c.id === b.coach) ? b.coach : null;
  const custom =
    personal && b.coach_custom && typeof b.coach_custom === "object" && typeof b.coach_custom.name === "string" && b.coach_custom.name.trim()
      ? JSON.stringify({ name: b.coach_custom.name.trim().slice(0, 80), description: String(b.coach_custom.description ?? "").trim().slice(0, 600) })
      : null;
  if (coach === "custom" && !custom && !user.coach_custom?.name) throw new HttpError(400, "Describe your custom coach first");
  const resume = personal && typeof b.resume === "string" ? b.resume.slice(0, 12_000) : null;
  await sql`update users set name = coalesce(${name}, name), city = coalesce(${city}, city), timezone = coalesce(${timezone}, timezone), agent_style = coalesce(${style}, agent_style),
    coach = coalesce(${coach}, coach), coach_custom = coalesce(${custom}::jsonb, coach_custom), resume = coalesce(${resume}, resume) where id = ${user.id}`;
  return json({ ok: true });
});

export const DELETE = authed(async (req, user) => {
  const b = await body<{ confirm?: string }>(req);
  if (b.confirm !== "DELETE") throw new HttpError(400, 'Type DELETE to confirm');
  await sql`delete from users where id = ${user.id}`;
  return destroyAndRespond();
});
