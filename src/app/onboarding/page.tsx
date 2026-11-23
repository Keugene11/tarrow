import { redirect } from "next/navigation";
import { requireConsentedUser } from "@/lib/auth";
import { ensureInterview } from "@/lib/onboarding";

// The interview is a normal chat inside the app now; kept for old links, Settings and /interview.
export default async function OnboardingPage() {
  const user = await requireConsentedUser();
  redirect(`/c/${await ensureInterview(user)}`);
}
