import { authed, json } from "@/lib/http";
import { createPortal } from "@/lib/billing/stripe";

export const POST = authed(async (req, user) => json({ url: await createPortal(user, new URL(req.url).origin) }));
