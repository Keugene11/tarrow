import { after } from "next/server";
import { sql } from "@/lib/db";
import { authed, body, HttpError, isUuid, json } from "@/lib/http";
import { createRun, kick } from "@/lib/agent/runtime";
import type { Effort } from "@/lib/agent/types";
import { guestTasksUsed, limitsFor, runsToday } from "@/lib/billing";
import { GUEST_LIMITS, LIMITS } from "@/lib/plans";

const EFFORTS: Effort[] = ["auto", "quick", "standard", "deep", "marathon"];

export const POST = authed(async (req, user) => {
  const b = await body<{ conversationId?: string; text?: string; effort?: string }>(req);
  if (!user.ai_consent_at) throw new HttpError(403, "Agree to how Tarrow uses AI first (Settings → AI & data).");
  const text = String(b.text ?? "").trim();
  if (!text) throw new HttpError(400, "Say something first");
  if (text.length > 8000) throw new HttpError(400, "That message is too long (8,000 characters max)");
  const effort = (EFFORTS.includes(b.effort as Effort) ? b.effort : "auto") as Effort;


  let conversationId = b.conversationId;
  let kind: "main" | "interview" = "main";
  if (conversationId) {
    if (!isUuid(conversationId)) throw new HttpError(400, "Bad conversation");
    const rows = await sql`select id, kind from conversations where id = ${conversationId} and user_id = ${user.id}`;
    if (!rows.length) throw new HttpError(404, "Chat not found");
    if (rows[0].kind === "interview") kind = "interview";
    const active = await sql`select id from runs where conversation_id = ${conversationId} and status in ('queued','running','waiting') and parent_run_id is null limit 1`;
    if (active.length) throw new HttpError(409, "Tarrow is still working on your last message");
  } else {
    if (!user.onboarded_at) throw new HttpError(403, "Finish the interview first");
  }

  if (user.is_guest) {
    // No account yet: the interview plus a few tasks, then sign up (everything carries over).
    const used = kind === "interview"
      ? Number((await sql`select count(*)::int as n from runs where user_id = ${user.id} and kind = 'interview'`)[0]?.n ?? 0)
      : await guestTasksUsed(user.id);
    if (used >= (kind === "interview" ? GUEST_LIMITS.interviewTurns : GUEST_LIMITS.tasks)) {
      return json({ error: `You've used your ${GUEST_LIMITS.tasks} free tasks without an account. Sign up free and your interview, memory and chats come with you.`, code: "signup" }, 403);
    }
    if (kind !== "interview" && effort !== "auto" && !GUEST_LIMITS.modes.includes(effort)) {
      return json({ error: `${effort === "deep" ? "Deep" : "Marathon"} mode needs an account and Tarrow Pro.`, code: "signup" }, 403);
    }
  } else if (kind !== "interview") {
    const [{ plan, limits }, runs] = await Promise.all([limitsFor(user.id), runsToday(user.id)]);
    if (effort !== "auto" && !limits.modes.includes(effort)) {
      return json({ error: `${effort === "deep" ? "Deep" : "Marathon"} mode is part of Tarrow Pro.`, code: "pro_required" }, 402);
    }
    if (runs >= limits.runsPerDay) {
      return json(
        { error: plan === "free" ? `You've used all ${limits.runsPerDay} free tasks today. Upgrade to Pro for ${LIMITS.pro.runsPerDay} a day, or come back tomorrow.` : "You've hit today's limit. It resets at midnight.", code: plan === "free" ? "upgrade" : "limit" },
        429,
      );
    }
  }

  if (!conversationId) {
    const rows = await sql`insert into conversations (user_id, kind, title) values (${user.id}, 'chat', 'New chat') returning id`;
    conversationId = rows[0].id as string;
  }

  const { runId, messageId } = await createRun({ user, conversationId: conversationId!, text, effort: kind === "interview" ? "quick" : effort, kind });
  after(() => kick(runId));
  return json({ conversationId, runId, messageId });
});
