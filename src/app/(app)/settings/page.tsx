import { redirect } from "next/navigation";
import { requireConsentedUser } from "@/lib/auth";
import { limitsFor, runsToday } from "@/lib/billing";
import { PageHeader } from "@/components/AppShell";
import { SettingsClient } from "./SettingsClient";
import { hasPersonalFeatures } from "@/lib/personal";
import { getGmailConnection, gmailConfigured } from "@/lib/gmail";

export const metadata = { title: "Settings" };

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ gmail?: string }> }) {
  const user = await requireConsentedUser();
  if (user.is_guest) redirect("/signup");
  const [ent, runs, gmail, params] = await Promise.all([limitsFor(user.id), runsToday(user.id), getGmailConnection(user.id), searchParams]);
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader title="Settings" />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <SettingsClient
          user={{ email: user.email, name: user.name ?? "", city: user.city ?? "", timezone: user.timezone, agent_style: user.agent_style }}
          coach={hasPersonalFeatures(user) ? { id: user.coach, custom: user.coach_custom, resume: user.resume } : null}
          usage={{ runs, limit: ent.limits.runsPerDay }}
          plan={ent.plan}
          subscription={ent.subscription}
          gmail={gmail ? { email: gmail.email, connectedAt: String(gmail.created_at) } : null}
          gmailAvailable={gmailConfigured()}
          gmailNotice={typeof params.gmail === "string" ? params.gmail : ""}
        />
      </div>
    </div>
  );
}
