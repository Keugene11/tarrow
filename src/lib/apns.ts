import "server-only";
import { createSign } from "node:crypto";
import { connect, constants } from "node:http2";

// Sends iOS push straight to Apple over HTTP/2 (fetch/undici is HTTP/1.1 only, which APNs rejects).
// The app registers raw APNs tokens via @capacitor/push-notifications, so no Firebase is involved.
// Env: APNS_KEY_BASE64 (the .p8), APNS_KEY_ID, APNS_TEAM_ID; optional APNS_TOPIC, APNS_USE_SANDBOX=1.
// Verify without a phone: a fake token returning BadDeviceToken proves the key, topic and transport.

type Config = { keyPem: string; keyId: string; teamId: string; topic: string; host: string };

function config(): Config | null {
  const b64 = process.env.APNS_KEY_BASE64;
  const keyId = process.env.APNS_KEY_ID;
  const teamId = process.env.APNS_TEAM_ID;
  if (!b64 || !keyId || !teamId) return null;
  return {
    keyPem: Buffer.from(b64, "base64").toString("utf8"),
    keyId,
    teamId,
    topic: process.env.APNS_TOPIC || "com.tarrow.app",
    host: process.env.APNS_USE_SANDBOX === "1" ? "https://api.sandbox.push.apple.com" : "https://api.push.apple.com",
  };
}

export const apnsConfigured = () => config() !== null;

// Apple accepts a provider token for an hour and rejects re-minting more than every 20 minutes.
let cached: { token: string; at: number } | null = null;
function providerToken(c: Config) {
  if (cached && Date.now() - cached.at < 50 * 60 * 1000) return cached.token;
  const enc = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const head = `${enc({ alg: "ES256", kid: c.keyId })}.${enc({ iss: c.teamId, iat: Math.floor(Date.now() / 1000) })}`;
  const token = `${head}.${createSign("SHA256").update(head).sign({ key: c.keyPem, dsaEncoding: "ieee-p1363" }).toString("base64url")}`;
  cached = { token, at: Date.now() };
  return token;
}

export type ApnsOutcome = { sent: number; invalid: string[]; reasons: Record<string, number> };

async function attempt(c: Config, tokens: string[], payload: string): Promise<ApnsOutcome & { transportFailed: string[] }> {
  const out = { sent: 0, invalid: [] as string[], reasons: {} as Record<string, number>, transportFailed: [] as string[] };
  const session = connect(c.host);
  const jwt = providerToken(c);
  try {
    const fatal = new Promise<never>((_, reject) => {
      session.on("error", reject);
      session.setTimeout(15_000, () => reject(new Error("APNs timeout")));
    });
    await Promise.race([
      Promise.all(
        tokens.map(
          (token) =>
            new Promise<void>((resolve) => {
              const req = session.request({
                [constants.HTTP2_HEADER_METHOD]: "POST",
                [constants.HTTP2_HEADER_PATH]: `/3/device/${token}`,
                authorization: `bearer ${jwt}`,
                "apns-topic": c.topic,
                "apns-push-type": "alert",
                "apns-priority": "10",
              });
              let status = 0;
              let raw = "";
              req.on("response", (h) => (status = Number(h[constants.HTTP2_HEADER_STATUS]) || 0));
              req.setEncoding("utf8");
              req.on("data", (d) => (raw += d));
              req.on("end", () => {
                if (status === 200) out.sent++;
                else {
                  let reason = `http-${status}`;
                  try {
                    reason = JSON.parse(raw).reason ?? reason;
                  } catch {}
                  out.reasons[reason] = (out.reasons[reason] ?? 0) + 1;
                  if (reason === "Unregistered" || reason === "BadDeviceToken") out.invalid.push(token);
                }
                resolve();
              });
              req.on("error", () => {
                out.transportFailed.push(token);
                resolve();
              });
              req.end(payload);
            }),
        ),
      ),
      fatal,
    ]);
  } catch {
    // Connection died: nothing without a verdict was delivered.
    const answered = out.sent + Object.values(out.reasons).reduce((a, b) => a + b, 0);
    if (answered < tokens.length) out.transportFailed = tokens;
  } finally {
    try {
      session.close();
    } catch {}
  }
  return out;
}

/** One alert to many devices. Retries transport resets once (Apple resets cold connections often), never Apple's verdicts. */
export async function sendApns(tokens: string[], msg: { title: string; body: string; url?: string }): Promise<ApnsOutcome> {
  const c = config();
  if (!c || !tokens.length) return { sent: 0, invalid: [], reasons: {} };
  const payload = JSON.stringify({ aps: { alert: { title: msg.title, body: msg.body }, sound: "default", "thread-id": "tarrow" }, url: msg.url ?? "/" });
  const first = await attempt(c, tokens, payload);
  let result: ApnsOutcome = first;
  if (first.transportFailed.length) {
    await new Promise((r) => setTimeout(r, 250));
    const second = await attempt(c, first.transportFailed, payload);
    const reasons = { ...first.reasons };
    for (const [k, v] of Object.entries(second.reasons)) reasons[k] = (reasons[k] ?? 0) + v;
    result = { sent: first.sent + second.sent, invalid: [...first.invalid, ...second.invalid], reasons };
  }
  for (const [reason, n] of Object.entries(result.reasons)) console.warn(`[apns] ${n} × ${reason}`);
  return result;
}
