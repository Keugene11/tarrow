import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { sql } from "@/lib/db";
import { requireConsentedUser } from "@/lib/auth";
import { isUuid } from "@/lib/http";
import { PageHeader } from "@/components/AppShell";
import { Markdown } from "@/components/Markdown";
import { DocActions } from "./DocActions";

export default async function DocumentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireConsentedUser();
  if (!isUuid(id)) notFound();
  const rows = await sql`select id, title, content, created_at from documents where id = ${id} and user_id = ${user.id}`;
  const doc = rows[0];
  if (!doc) notFound();
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        title={doc.title as string}
        back={
          <Link href="/library" aria-label="Back to library" className="press -ml-1.5 flex h-9 w-9 items-center justify-center rounded-full hover:bg-neutral-100">
            <ArrowLeft className="h-5 w-5" />
          </Link>
        }
        right={<DocActions id={id} content={doc.content as string} />}
      />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <article className="mx-auto w-full max-w-[720px] px-5 py-6">
          <Markdown text={doc.content as string} />
        </article>
      </div>
    </div>
  );
}
