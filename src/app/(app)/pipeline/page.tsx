import { sql } from "@/lib/db";
import { requireConsentedUser } from "@/lib/auth";
import { PageHeader } from "@/components/AppShell";
import { notFound } from "next/navigation";
import { PipelineClient } from "./PipelineClient";
import { hasPersonalFeatures } from "@/lib/personal";

export const metadata = { title: "Pipeline" };

export default async function PipelinePage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const user = await requireConsentedUser();
  if (!hasPersonalFeatures(user)) notFound();
  const { tab } = await searchParams;
  const [people, jobs] = await Promise.all([
    sql`select id, name, role, company, kind, url, email, why, channel, draft, status, created_at from contacts where user_id = ${user.id} order by created_at desc limit 500`,
    sql`select id, title, company, location, url, source, salary, fit, why, pitch, status, created_at from jobs where user_id = ${user.id} order by created_at desc limit 500`,
  ]);
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader title="Pipeline" subtitle="People to reach out to and jobs to apply for" />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <PipelineClient
          initialPeople={JSON.parse(JSON.stringify(people))}
          initialJobs={JSON.parse(JSON.stringify(jobs))}
          initialTab={tab === "jobs" || (tab !== "people" && !people.length && jobs.length > 0) ? "jobs" : "people"}
          hasResume={!!user.resume.trim()}
        />
      </div>
    </div>
  );
}
