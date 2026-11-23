import "server-only";
import { sql } from "../db";
import { GUEST_LIMITS, LIMITS, type Interval, type PlanId } from "../plans";

export type Provider = "stripe" | "apple" | "google";
export type SubStatus = "active" | "trialing" | "grace" | "past_due" | "expired" | "refunded" | "incomplete";

/** Statuses that still grant Pro while the period hasn't ended. */
const ENTITLED: SubStatus[] = ["active", "trialing", "grace", "past_due"];

export type Entitlement = {
  plan: PlanId;
  subscription: { provider: Provider; product: Interval; status: SubStatus; periodEnd: string | null; willRenew: boolean; environment: string } | null;
};

export async function getEntitlement(userId: string): Promise<Entitlement> {
  const rows = await sql`
    select s.provider, s.product, s.status, s.current_period_end, s.will_renew, s.environment, s.external_id, s.checked_at, u.plan as comp
    from users u left join subscriptions s on s.user_id = u.id
    where u.id = ${userId}
    order by s.current_period_end desc nulls last`;
  // Google has no push notifications wired up, so re-check a lapsed Play subscription (it may have renewed).
  const lapsedGoogle = rows.find(
    (r) => r.provider === "google" && ENTITLED.includes(r.status as SubStatus) && r.current_period_end && new Date(String(r.current_period_end)) < new Date() && Date.now() - new Date(String(r.checked_at)).getTime() > 10 * 60_000,
  );
  if (lapsedGoogle) {
    try {
      const { refreshGoogleSubscription } = await import("./google");
      await refreshGoogleSubscription(userId, String(lapsedGoogle.external_id));
      return getEntitlement(userId);
    } catch (err) {
      console.warn("google refresh failed", err);
    }
  }
  const active = rows.find((r) => r.provider && ENTITLED.includes(r.status as SubStatus) && (!r.current_period_end || new Date(String(r.current_period_end)) > new Date()));
  const latest = active ?? rows.find((r) => r.provider) ?? null;
  const subscription = latest
    ? { provider: latest.provider as Provider, product: latest.product as Interval, status: latest.status as SubStatus, periodEnd: latest.current_period_end ? new Date(String(latest.current_period_end)).toISOString() : null, willRenew: !!latest.will_renew, environment: String(latest.environment) }
    : null;
  const comp = rows[0]?.comp === "pro";
  return { plan: active || comp ? "pro" : "free", subscription };
}

export async function limitsFor(userId: string) {
  const [ent, guest] = await Promise.all([getEntitlement(userId), sql`select is_guest from users where id = ${userId}`]);
  if (guest[0]?.is_guest) return { ...ent, guest: true, limits: { runsPerDay: GUEST_LIMITS.tasks, modes: GUEST_LIMITS.modes, routines: GUEST_LIMITS.routines } };
  return { ...ent, guest: false, limits: LIMITS[ent.plan] };
}

/** Tasks a guest has used in total (the interview doesn't count). */
export async function guestTasksUsed(userId: string) {
  const rows = await sql`select coalesce(sum(runs), 0)::int as runs from usage_daily where user_id = ${userId}`;
  return Number(rows[0]?.runs ?? 0);
}

/** Tasks started today that count toward the plan limit (the onboarding interview is free). */
export async function runsToday(userId: string) {
  const rows = await sql`select coalesce(sum(runs), 0)::int as runs from usage_daily where user_id = ${userId} and day = current_date`;
  return Number(rows[0]?.runs ?? 0);
}

export async function upsertSubscription(s: {
  userId: string;
  provider: Provider;
  externalId: string;
  product: Interval;
  status: SubStatus;
  periodEnd: Date | null;
  willRenew: boolean;
  environment?: string;
  raw?: unknown;
}) {
  await sql`
    insert into subscriptions (user_id, provider, external_id, product, status, current_period_end, will_renew, environment, raw, checked_at, updated_at)
    values (${s.userId}, ${s.provider}, ${s.externalId}, ${s.product}, ${s.status}, ${s.periodEnd?.toISOString() ?? null}, ${s.willRenew}, ${s.environment ?? "production"}, ${JSON.stringify(s.raw ?? {})}::jsonb, now(), now())
    on conflict (provider, external_id) do update set
      product = excluded.product, status = excluded.status, current_period_end = excluded.current_period_end,
      will_renew = excluded.will_renew, environment = excluded.environment, raw = excluded.raw, checked_at = now(), updated_at = now()`;
}

/** Who owns a store subscription already, if anyone (prevents one purchase unlocking several accounts). */
export async function subscriptionOwner(provider: Provider, externalId: string): Promise<string | null> {
  const rows = await sql`select user_id from subscriptions where provider = ${provider} and external_id = ${externalId}`;
  return rows[0] ? String(rows[0].user_id) : null;
}
