import { sql } from "@/lib/db";
import { authed, json } from "@/lib/http";
import { hasPersonalFeatures } from "@/lib/personal";

export const GET = authed(async (_req, user) => {
  if (!hasPersonalFeatures(user)) return json({ error: "Not found" }, 404);
  const [people, jobs] = await Promise.all([
    sql`select id, name, role, company, kind, url, email, why, channel, draft, status, notes, created_at, updated_at from contacts where user_id = ${user.id} order by created_at desc limit 500`,
    sql`select id, title, company, location, url, source, salary, fit, why, pitch, status, created_at, updated_at from jobs where user_id = ${user.id} order by created_at desc limit 500`,
  ]);
  return json({ people, jobs });
});
