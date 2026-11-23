import { after } from "next/server";
import { sql } from "@/lib/db";
import { authed, body, HttpError, json } from "@/lib/http";
import { MEMORY_CATEGORIES } from "@/lib/agent/context";
import { rebuildLifeFile } from "@/lib/agent/memory";

export const GET = authed(async (_req, user) => {
  const memories = await sql`select id, category, content, source, created_at from memories where user_id = ${user.id} order by created_at desc`;
  return json({ memories, lifeFile: user.life_file });
});

export const POST = authed(async (req, user) => {
  const b = await body<{ content?: string; category?: string; rebuild?: boolean }>(req);
  if (b.rebuild) {
    await rebuildLifeFile(user.id);
    const u = await sql`select life_file from users where id = ${user.id}`;
    return json({ ok: true, lifeFile: u[0]?.life_file ?? "" });
  }
  const content = String(b.content ?? "").trim().slice(0, 400);
  if (content.length < 3) throw new HttpError(400, "Write a bit more");
  const category = (MEMORY_CATEGORIES as readonly string[]).includes(String(b.category)) ? String(b.category) : "other";
  const rows = await sql`insert into memories (user_id, category, content, source) values (${user.id}, ${category}, ${content}, 'user') returning id, category, content, source, created_at`;
  after(() => rebuildLifeFile(user.id).catch(() => {}));
  return json({ memory: rows[0] });
});
