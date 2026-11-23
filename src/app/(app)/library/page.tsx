import Link from "next/link";
import { BookOpen, ChevronRight, FileText } from "lucide-react";
import { sql } from "@/lib/db";
import { requireConsentedUser } from "@/lib/auth";
import { PageHeader } from "@/components/AppShell";
import { RelativeTime } from "@/components/RelativeTime";

export const metadata = { title: "Library" };

export default async function LibraryPage() {
  const user = await requireConsentedUser();
  const docs = await sql`select id, title, left(content, 180) as preview, created_at from documents where user_id = ${user.id} order by created_at desc limit 200`;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader title="Library" subtitle="Plans, reports and guides Tarrow wrote for you" />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[720px] px-4 py-4">
          {docs.length === 0 ? (
            <div className="flex flex-col items-center py-20 text-center">
              <BookOpen className="h-8 w-8 text-neutral-300" />
              <p className="mt-3 text-[15px] font-medium">Nothing saved yet</p>
              <p className="mt-1 max-w-xs text-[14px] text-neutral-500">When Tarrow does deep work — research, plans, itineraries — the full report lands here.</p>
              <Link href={`/c/new?q=${encodeURIComponent("Do deep research and write me a detailed plan for my biggest goal. Save it as a document.")}&effort=deep`} className="press mt-5 rounded-full bg-neutral-900 px-5 py-2.5 text-[14px] font-medium text-white">
                Try a deep task
              </Link>
            </div>
          ) : (
            <div className="space-y-2.5">
              {docs.map((d) => (
                <Link key={d.id as string} href={`/library/${d.id}`} className="press flex items-center gap-3 rounded-3xl border border-neutral-200 p-4 hover:bg-neutral-50">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-neutral-900 text-white">
                    <FileText className="h-4 w-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[15px] font-semibold">{d.title as string}</span>
                    <span className="block truncate text-[13px] text-neutral-500">{String(d.preview ?? "").replace(/[#*_`>|[\]]/g, "")}</span>
                    <span className="block text-[12px] text-neutral-400">
                      <RelativeTime iso={String(d.created_at)} />
                    </span>
                  </span>
                  <ChevronRight className="h-4 w-4 shrink-0 text-neutral-300" />
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
