import { notFound, redirect } from "next/navigation";
import { sql } from "@/lib/db";
import { requireConsentedUser } from "@/lib/auth";
import { ensureInterview } from "@/lib/onboarding";
import { isUuid } from "@/lib/http";
import type { ChatMessage } from "@/components/chat/ChatView";
import { ChatScreen } from "./ChatScreen";
import { hasPersonalFeatures } from "@/lib/personal";
import { guestTasksUsed } from "@/lib/billing";
import { GUEST_LIMITS } from "@/lib/plans";

export default async function ChatPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ q?: string; effort?: string; n?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const user = await requireConsentedUser();
  const guest = user.is_guest ? { tasks: GUEST_LIMITS.tasks, tasksLeft: Math.max(0, GUEST_LIMITS.tasks - (await guestTasksUsed(user.id))) } : undefined;

  if (id === "new") {
    // New users' first chat is the interview.
    if (!user.onboarded_at) redirect(`/c/${await ensureInterview(user)}`);
    const suggestions = sp.q ? [] : await sql`select title, prompt from suggestions where user_id = ${user.id} and not dismissed order by created_at desc limit 4`;
    return (
      <ChatScreen
        key={`new:${sp.n ?? ""}:${sp.q ?? ""}`}
        conversationId={null}
        title="new session"
        initialMessages={[]}
        initialRun={null}
        autoSend={sp.q ? { text: sp.q.slice(0, 4000), effort: sp.effort } : null}
        firstName={user.name?.split(" ")[0] ?? ""}
        city={user.city}
        coach={hasPersonalFeatures(user) ? { id: user.coach, custom: user.coach_custom } : undefined}
        guest={guest}
        suggestions={suggestions.map((s) => ({ title: String(s.title), prompt: String(s.prompt) }))}
      />
    );
  }
  if (!isUuid(id)) notFound();
  const conv = await sql`select id, title, kind from conversations where id = ${id} and user_id = ${user.id}`;
  if (!conv.length) notFound();
  const messages = (await sql`select id, role, content, run_id, meta, created_at from messages where conversation_id = ${id} order by created_at limit 500`) as unknown as ChatMessage[];
  const active = await sql`select id, started_at, created_at from runs where conversation_id = ${id} and parent_run_id is null and status in ('queued','running','waiting') order by created_at desc limit 1`;
  const initialRun = active[0] ? { id: active[0].id as string, startedAt: new Date((active[0].started_at ?? active[0].created_at) as string).getTime() } : null;
  const isInterview = conv[0].kind === "interview";
  const covered = isInterview ? await sql`select distinct category from memories where user_id = ${user.id}` : [];
  return (
    <ChatScreen
      key={id}
      conversationId={id}
      title={conv[0].title as string}
      kind={isInterview ? "interview" : conv[0].kind === "routine" ? "routine" : "chat"}
      initialMessages={JSON.parse(JSON.stringify(messages))}
      initialRun={initialRun}
      autoSend={null}
      firstName={user.name?.split(" ")[0] ?? ""}
      city={user.city}
      coach={hasPersonalFeatures(user) ? { id: user.coach, custom: user.coach_custom } : undefined}
      guest={guest}
      interview={isInterview ? { onboarded: !!user.onboarded_at, covered: covered.map((c) => String(c.category)) } : undefined}
    />
  );
}
