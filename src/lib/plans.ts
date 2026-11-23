/** Plans, prices and store product IDs. Safe to import from client components. */
import type { Mode } from "./agent/types";

export type PlanId = "free" | "pro";
export type Interval = "monthly" | "yearly";

export const PRICES: Record<Interval, { amount: number; label: string; per: string }> = {
  monthly: { amount: 20, label: "$20", per: "month" },
  yearly: { amount: 100, label: "$100", per: "year" },
};
/** Yearly vs 12 months of monthly. */
export const YEARLY_SAVINGS_PCT = Math.round((1 - PRICES.yearly.amount / (PRICES.monthly.amount * 12)) * 100);

export const LIMITS: Record<PlanId, { runsPerDay: number; modes: Mode[]; routines: number }> = {
  free: { runsPerDay: 10, modes: ["quick", "standard"], routines: 1 },
  pro: { runsPerDay: 150, modes: ["quick", "standard", "deep", "marathon"], routines: 20 },
};

/** No account yet: the interview plus a few tasks in total (not per day), then sign up to keep going. */
export const GUEST_LIMITS = { tasks: 3, interviewTurns: 40, modes: ["quick", "standard"] as Mode[], routines: 0 };

export const PLAN_FEATURES: Record<PlanId, string[]> = {
  free: ["10 tasks a day", "Fast and Standard modes", "Web research, places, events, weather", "Memory, goals, tasks and drafts", "1 routine"],
  pro: ["150 tasks a day", "Deep and Marathon modes with parallel agents", "Long research up to 45 minutes, saved reports", "Up to 20 routines running in the background", "Everything in Free"],
};

/** Stripe price lookup keys (products are created by scripts/billing-stripe.mjs). */
export const STRIPE_LOOKUP: Record<Interval, string> = { monthly: "tarrow_pro_monthly", yearly: "tarrow_pro_yearly" };

/** App Store product IDs (subscription group "Tarrow Pro"). */
export const APPLE_PRODUCTS: Record<Interval, string> = { monthly: "com.tarrow.app.pro.monthly", yearly: "com.tarrow.app.pro.yearly" };

/** Google Play: one subscription with a base plan per interval. */
export const GOOGLE_PRODUCT = "tarrow_pro";
export const GOOGLE_BASE_PLANS: Record<Interval, string> = { monthly: "monthly", yearly: "yearly" };

export function intervalForProduct(id: string): Interval | null {
  if (id === APPLE_PRODUCTS.monthly || id === STRIPE_LOOKUP.monthly || id === GOOGLE_BASE_PLANS.monthly) return "monthly";
  if (id === APPLE_PRODUCTS.yearly || id === STRIPE_LOOKUP.yearly || id === GOOGLE_BASE_PLANS.yearly) return "yearly";
  return null;
}
