import { requireConsentedUser } from "@/lib/auth";
import { AppShell } from "@/components/AppShell";
import { getEntitlement } from "@/lib/billing";
import { hasPersonalFeatures } from "@/lib/personal";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireConsentedUser();
  const { plan } = await getEntitlement(user.id);
  return (
    <AppShell
      userName={user.is_guest ? "Guest" : (user.name ?? user.email)}
      plan={plan}
      personal={hasPersonalFeatures(user)}
      guestAccount={user.is_guest}
      interviewId={user.onboarded_at ? null : user.interview_conversation_id}
    >
      {children}
    </AppShell>
  );
}
