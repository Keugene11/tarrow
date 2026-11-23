import { after } from "next/server";
import { sql } from "@/lib/db";
import { authed, json } from "@/lib/http";
import { generateSuggestions, rebuildLifeFile } from "@/lib/agent/memory";

export const POST = authed(async (_req, user) => {
  await sql`update users set onboarded_at = coalesce(onboarded_at, now()) where id = ${user.id}`;
  after(async () => {
    try {
      await rebuildLifeFile(user.id);
      await generateSuggestions(user.id);
    } catch (err) {
      console.warn("skip housekeeping failed", err);
    }
  });
  return json({ ok: true });
});
