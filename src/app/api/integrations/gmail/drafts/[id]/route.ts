import { authed, body, HttpError, json } from "@/lib/http";
import { deleteDraft, GmailError, sendDraft } from "@/lib/gmail";
import { isEmailList } from "@/lib/gmail-mime";

type Ctx = { params: Promise<{ id: string }> };

const draftId = async (ctx: Ctx) => {
  const { id } = await ctx.params;
  if (!/^[\w-]{1,200}$/.test(id)) throw new HttpError(400, "Bad draft id");
  return id;
};

const mapError = (err: unknown) => {
  if (err instanceof GmailError) {
    if (err.code === "not_found") return new HttpError(410, "This draft was already sent or deleted in Gmail.");
    if (err.code === "not_connected" || err.code === "revoked") return new HttpError(409, "Gmail is no longer connected. Reconnect it in Settings.");
    return new HttpError(502, err.message);
  }
  return err;
};

/** Sends a draft the user reviewed on the card. Optional edits {to, subject, body} are saved to the draft first. */
export const POST = authed(async (req, user, ctx: Ctx) => {
  const id = await draftId(ctx);
  const b = await body<{ to?: string; subject?: string; body?: string }>(req).catch(() => ({}) as { to?: string; subject?: string; body?: string });
  const edits: { to?: string; subject?: string; body?: string } = {};
  if (typeof b.to === "string") {
    const to = b.to.trim().slice(0, 500);
    if (!to || !isEmailList(to)) throw new HttpError(400, "Enter a valid recipient address");
    edits.to = to;
  }
  if (typeof b.subject === "string") edits.subject = b.subject.trim().slice(0, 300);
  if (typeof b.body === "string") {
    if (!b.body.trim()) throw new HttpError(400, "The email is empty");
    edits.body = b.body.slice(0, 20_000);
  }
  try {
    const sent = await sendDraft(user.id, id, Object.keys(edits).length ? edits : undefined);
    return json({ ok: true, ...sent });
  } catch (err) {
    throw mapError(err);
  }
});

export const DELETE = authed(async (_req, user, ctx: Ctx) => {
  const id = await draftId(ctx);
  try {
    await deleteDraft(user.id, id);
    return json({ ok: true });
  } catch (err) {
    throw mapError(err);
  }
});
