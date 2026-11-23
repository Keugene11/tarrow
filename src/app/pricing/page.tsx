import { Suspense } from "react";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { AppShell, PageHeader } from "@/components/AppShell";
import { PlansView } from "@/components/PlansView";

export const metadata = { title: "Pricing", description: "Tarrow is free to start. Pro is $20 a month or $100 a year." };

export default async function PricingPage() {
  if (await currentUser()) redirect("/upgrade");
  return (
    <AppShell userName={null}>
      <div className="flex min-h-0 flex-1 flex-col">
        <PageHeader title="Pricing" subtitle="Free to start. Pro when you want Tarrow to go deep." />
        <div className="min-h-0 flex-1 overflow-y-auto">
          <Suspense>
            <PlansView signedIn={false} plan="free" subscription={null} />
          </Suspense>
        </div>
      </div>
    </AppShell>
  );
}
