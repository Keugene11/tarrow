import { sql } from "@/lib/db";
import { requireConsentedUser } from "@/lib/auth";
import { PageHeader } from "@/components/AppShell";
import { RoutinesClient } from "./RoutinesClient";

export const metadata = { title: "Routines" };

export default async function RoutinesPage() {
  const user = await requireConsentedUser();
  const routines = await sql`select id, title, prompt, cadence, weekday, next_run_at, last_run_at, active, conversation_id from routines where user_id = ${user.id} order by active desc, created_at desc`;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader title="Routines" subtitle="Background jobs Tarrow runs for you on a schedule" />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <RoutinesClient initial={JSON.parse(JSON.stringify(routines))} />
      </div>
    </div>
  );
}
