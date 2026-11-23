import Link from "next/link";
import { ChevronRight, LoaderCircle, MessageSquare, Plus, Repeat } from "lucide-react";
import { sql } from "@/lib/db";
import { requireConsentedUser } from "@/lib/auth";
import { PageHeader } from "@/components/AppShell";
import { RelativeTime } from "@/components/RelativeTime";

export const metadata = { title: "Chats" };

export default async function ChatsPage() {
  const user = await requireConsentedUser();
  const rows = await sql`
    select c.id, c.title, c.kind, c.updated_at,
      (select status from runs r where r.conversation_id = c.id and r.parent_run_id is null order by created_at desc limit 1) as last_status,
      (select left(content, 140) from messages m where m.conversation_id = c.id and m.role = 'assistant' order by created_at desc limit 1) as preview
    from conversations c where c.user_id = ${user.id}
    order by c.updated_at desc limit 200`;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        title="Chats"
        right={
          <Link href="/c/new" className="press inline-flex items-center gap-1.5 rounded-full bg-neutral-900 px-3.5 py-2 text-[13.5px] font-medium text-white">
            <Plus className="h-4 w-4" /> New
          </Link>
        }
      />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[720px] px-4 py-4">
          {rows.length === 0 ? (
            <div className="flex flex-col items-center py-20 text-center">
              <MessageSquare className="h-8 w-8 text-neutral-300" />
              <p className="mt-3 text-[15px] font-medium">No chats yet</p>
              <p className="mt-1 text-[14px] text-neutral-500">Give Tarrow something to work on.</p>
              <Link href="/c/new" className="press mt-5 rounded-full bg-neutral-900 px-5 py-2.5 text-[14px] font-medium text-white">
                Start a task
              </Link>
            </div>
          ) : (
            <div className="overflow-hidden rounded-3xl border border-neutral-200">
              {rows.map((c, i) => {
                const active = ["queued", "running", "waiting"].includes(String(c.last_status));
                return (
                  <Link key={c.id as string} href={`/c/${c.id}`} className={`press flex items-center gap-3 px-4 py-3.5 hover:bg-neutral-50 ${i ? "border-t border-neutral-100" : ""}`}>
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-neutral-100">
                      {active ? <LoaderCircle className="h-4 w-4 animate-spin" /> : c.kind === "routine" ? <Repeat className="h-4 w-4" /> : <MessageSquare className="h-4 w-4" />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline justify-between gap-2">
                        <span className="truncate text-[15px] font-medium">{c.title as string}</span>
                        <span className="shrink-0 text-[12px] text-neutral-400">
                          <RelativeTime iso={String(c.updated_at)} />
                        </span>
                      </span>
                      <span className="block truncate text-[13px] text-neutral-500">{active ? "Tarrow is working on this…" : ((c.preview as string) ?? "").replace(/[#*_`>|[\]]/g, "") || " "}</span>
                    </span>
                    <ChevronRight className="h-4 w-4 shrink-0 text-neutral-300" />
                  </Link>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
