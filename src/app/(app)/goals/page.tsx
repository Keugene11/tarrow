import { sql } from "@/lib/db";
import { requireConsentedUser } from "@/lib/auth";
import { PageHeader } from "@/components/AppShell";
import { GoalsClient } from "./GoalsClient";

export const metadata = { title: "Goals" };

export default async function GoalsPage() {
  const user = await requireConsentedUser();
  const [goals, tasks] = await Promise.all([
    sql`select id, title, why, target_date, status, progress, created_at from goals where user_id = ${user.id} and status <> 'dropped' order by status = 'active' desc, created_at desc`,
    sql`select id, goal_id, title, notes, due_at, status, created_by, created_at, completed_at from tasks where user_id = ${user.id} and (status = 'open' or completed_at > now() - interval '7 days') order by status desc, due_at nulls last, created_at desc`,
  ]);
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader title="Goals & tasks" subtitle="Tarrow keeps these up to date as you talk" />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <GoalsClient initialGoals={JSON.parse(JSON.stringify(goals))} initialTasks={JSON.parse(JSON.stringify(tasks))} />
      </div>
    </div>
  );
}
