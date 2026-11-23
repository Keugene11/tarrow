import { authed, isUuid, json } from "@/lib/http";
import { cancelRun } from "@/lib/agent/runtime";

export const POST = authed<{ params: Promise<{ id: string }> }>(async (_req, user, ctx) => {
  const { id } = await ctx.params;
  if (!isUuid(id)) return json({ error: "Bad id" }, 400);
  const ok = await cancelRun(id, user.id);
  return json({ ok });
});
