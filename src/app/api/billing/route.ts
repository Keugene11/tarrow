import { authed, json } from "@/lib/http";
import { limitsFor, runsToday } from "@/lib/billing";

/** Current plan, subscription and today's usage for the Plans page and Settings. */
export const GET = authed(async (_req, user) => {
  const [ent, runs] = await Promise.all([limitsFor(user.id), runsToday(user.id)]);
  return json({ plan: ent.plan, subscription: ent.subscription, limits: ent.limits, usage: { runsToday: runs } });
});
