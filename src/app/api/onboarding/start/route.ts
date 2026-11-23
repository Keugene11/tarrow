import { authed, json } from "@/lib/http";
import { ensureInterview } from "@/lib/onboarding";

export const POST = authed(async (_req, user) => {
  const conversationId = await ensureInterview(user);
  return json({ conversationId });
});
