import "server-only";
import { sql } from "./db";
import type { User } from "./auth";
import { interviewGreeting } from "./interview-intro";

/** Returns the user's interview conversation, creating it (with Tarrow's opening question) if needed. */
export async function ensureInterview(user: User): Promise<string> {
  if (user.interview_conversation_id) {
    const exists = await sql`select id from conversations where id = ${user.interview_conversation_id}`;
    if (exists.length) return user.interview_conversation_id;
  }
  const rows = await sql`insert into conversations (user_id, kind, title) values (${user.id}, 'interview', 'Getting to know you') returning id`;
  const conversationId = rows[0].id as string;
  const greeting = interviewGreeting(user.name);
  await sql`insert into messages (conversation_id, user_id, role, content) values (${conversationId}, ${user.id}, 'assistant', ${greeting})`;
  const updated = await sql`
    update users set interview_conversation_id = ${conversationId}
    where id = ${user.id} and (interview_conversation_id is null or interview_conversation_id = ${user.interview_conversation_id ?? null}::uuid
      or not exists (select 1 from conversations c where c.id = users.interview_conversation_id))
    returning id`;
  if (!updated.length) {
    await sql`delete from conversations where id = ${conversationId}`;
    const u = await sql`select interview_conversation_id from users where id = ${user.id}`;
    return u[0].interview_conversation_id as string;
  }
  return conversationId;
}
