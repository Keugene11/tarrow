import { json } from "@/lib/http";
import { handleAppleNotification } from "@/lib/billing/apple";

// App Store Server Notifications V2 (set as the app's subscription status URL in App Store Connect).
export async function POST(req: Request) {
  let signedPayload: string | undefined;
  try {
    signedPayload = ((await req.json()) as { signedPayload?: string }).signedPayload;
  } catch {}
  if (!signedPayload) return json({ error: "Missing payload" }, 400);
  try {
    return json(await handleAppleNotification(signedPayload));
  } catch (err) {
    console.error("apple notification failed", err);
    return json({ error: "Invalid notification" }, 400);
  }
}
