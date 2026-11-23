import { sql } from "@/lib/db";
import { requireConsentedUser } from "@/lib/auth";
import { PageHeader } from "@/components/AppShell";
import { MemoryClient } from "./MemoryClient";

export const metadata = { title: "Memory" };

export default async function MemoryPage() {
  const user = await requireConsentedUser();
  const memories = await sql`select id, category, content, source, created_at from memories where user_id = ${user.id} order by created_at desc`;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader title="What Tarrow knows" subtitle="Private to you. Edit or delete anything." />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <MemoryClient initialMemories={JSON.parse(JSON.stringify(memories))} initialLifeFile={user.life_file} />
      </div>
    </div>
  );
}
