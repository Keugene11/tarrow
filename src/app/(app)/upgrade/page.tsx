import { Suspense } from "react";
import { redirect } from "next/navigation";
import { requireConsentedUser } from "@/lib/auth";
import { limitsFor, runsToday } from "@/lib/billing";
import { PageHeader } from "@/components/AppShell";
import { PlansView } from "@/components/PlansView";

export const metadata = { title: "Plans" };

export default async function UpgradePage() {
  const user = await requireConsentedUser();
  if (user.is_guest) redirect("/signup");
  const [ent, runs] = await Promise.all([limitsFor(user.id), runsToday(user.id)]);
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader title="Plans" subtitle={ent.plan === "pro" ? "You're on Tarrow Pro" : "Unlock Deep and Marathon modes"} />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <Suspense>
          <PlansView signedIn userId={user.id} plan={ent.plan} subscription={ent.subscription} usage={{ runsToday: runs, limit: ent.limits.runsPerDay }} />
        </Suspense>
      </div>
    </div>
  );
}
