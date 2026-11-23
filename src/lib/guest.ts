import "server-only";
import { randomBytes } from "node:crypto";
import { sql, transaction } from "./db";

// Guests: a logged-out visitor gets a real (passwordless, email-less) account on their first message, so the
// interview and a few tasks run through the normal app. Signing up or logging in merges it into the real account.

const GUEST_DOMAIN = "guest.invalid";

export async function createGuestUser(timezone?: string | null): Promise<string> {
  let tz = timezone || "America/New_York";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
  } catch {
    tz = "America/New_York";
  }
  const email = `guest-${randomBytes(12).toString("hex")}@${GUEST_DOMAIN}`;
  // They agreed to the AI data-sharing notice on the guest screen before this is called.
  const rows = await sql`insert into users (email, timezone, is_guest, ai_consent_at) values (${email}, ${tz}, true, now()) returning id`;
  return rows[0].id as string;
}

/** Moves everything a guest made into `userId`, then deletes the guest. The account's own profile wins where both have one. */
export async function adoptGuest(guestId: string, userId: string) {
  const [g] = await sql`select * from users where id = ${guestId} and is_guest`;
  const [u] = await sql`select onboarded_at, interview_conversation_id, is_guest from users where id = ${userId}`;
  if (!g || !u || u.is_guest) return;
  // An account that already did its own interview keeps it; the guest's interview comes along as a normal chat.
  // Otherwise the guest's interview becomes the account's (an unfinished older one turns into a normal chat).
  const takeInterview = !u.onboarded_at && !!g.interview_conversation_id;
  const oldInterview = takeInterview && u.interview_conversation_id !== g.interview_conversation_id ? (u.interview_conversation_id as string | null) : null;
  await transaction((q) => [
    q`update conversations set user_id = ${userId} where user_id = ${guestId}`,
    q`update messages set user_id = ${userId} where user_id = ${guestId}`,
    q`update runs set user_id = ${userId} where user_id = ${guestId}`,
    q`update memories set user_id = ${userId} where user_id = ${guestId}`,
    q`update goals set user_id = ${userId} where user_id = ${guestId}`,
    q`update tasks set user_id = ${userId} where user_id = ${guestId}`,
    q`update documents set user_id = ${userId} where user_id = ${guestId}`,
    q`update suggestions set user_id = ${userId} where user_id = ${guestId}`,
    q`update routines set user_id = ${userId} where user_id = ${guestId}`,
    q`update push_subscriptions set user_id = ${userId} where user_id = ${guestId}`,
    q`update native_push_tokens set user_id = ${userId} where user_id = ${guestId}`,
    takeInterview
      ? q`update users set onboarded_at = ${g.onboarded_at as string | null}, interview_conversation_id = ${g.interview_conversation_id as string | null},
            life_file = case when ${String(g.life_file ?? "")} <> '' then ${String(g.life_file ?? "")} else life_file end,
            agent_style = ${String(g.agent_style)}, city = coalesce(city, ${g.city as string | null}), name = coalesce(name, ${g.name as string | null}),
            ai_consent_at = coalesce(ai_consent_at, ${g.ai_consent_at as string | null})
          where id = ${userId}`
      : q`update conversations set kind = 'chat' where id = ${g.interview_conversation_id as string | null} and kind = 'interview'`,
    q`update conversations set kind = 'chat' where id = ${oldInterview} and kind = 'interview'`,
    q`delete from users where id = ${guestId} and is_guest`,
  ]);
}

/** Guests nobody claimed in 30 days. */
export async function deleteStaleGuests() {
  const rows = await sql`delete from users where is_guest and created_at < now() - interval '30 days' returning id`;
  return rows.length;
}
