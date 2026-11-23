import { sql } from "@/lib/db";
import { authed, json } from "@/lib/http";
import { generateSuggestions } from "@/lib/agent/memory";

export const maxDuration = 60;

export const GET = authed(async (_req, user) => {
  const suggestions = await sql`select id, kind, title, body, prompt, created_at from suggestions where user_id = ${user.id} and not dismissed order by created_at desc limit 4`;
  return json({ suggestions });
});

/** Regenerate the "For you" cards. */
export const POST = authed(async (_req, user) => {
  try {
    await generateSuggestions(user.id);
  } catch (err) {
    console.warn("suggestions failed", err);
    return json({ error: "Couldn't come up with new ideas right now. Try again in a minute." }, 503);
  }
  const suggestions = await sql`select id, kind, title, body, prompt, created_at from suggestions where user_id = ${user.id} and not dismissed order by created_at desc limit 4`;
  return json({ suggestions });
});
