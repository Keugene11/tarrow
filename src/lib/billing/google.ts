import "server-only";
import { createSign } from "node:crypto";
import { GOOGLE_PRODUCT, intervalForProduct } from "../plans";
import { subscriptionOwner, upsertSubscription, type SubStatus } from "./index";

const PACKAGE = "com.tarrow.app";
const API = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${PACKAGE}`;

let cached: { token: string; exp: number } | null = null;

async function accessToken() {
  if (cached && cached.exp > Date.now() + 60_000) return cached.token;
  const raw = process.env.GOOGLE_PLAY_SA_JSON;
  if (!raw) throw new Error("Google Play billing isn't configured");
  const key = JSON.parse(raw) as { client_email: string; private_key: string };
  const now = Math.floor(Date.now() / 1000);
  const enc = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const head = `${enc({ alg: "RS256", typ: "JWT" })}.${enc({ iss: key.client_email, scope: "https://www.googleapis.com/auth/androidpublisher", aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600 })}`;
  const sig = createSign("RSA-SHA256").update(head).sign(key.private_key).toString("base64url");
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${head}.${sig}` }),
  });
  const data = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!data.access_token) throw new Error("Google auth failed");
  cached = { token: data.access_token, exp: Date.now() + (data.expires_in ?? 3600) * 1000 };
  return cached.token;
}

type SubscriptionV2 = {
  subscriptionState?: string;
  acknowledgementState?: string;
  testPurchase?: object;
  externalAccountIdentifiers?: { obfuscatedExternalAccountId?: string };
  lineItems?: { productId?: string; expiryTime?: string; autoRenewingPlan?: { autoRenewEnabled?: boolean }; offerDetails?: { basePlanId?: string } }[];
};

const STATES: Record<string, SubStatus> = {
  SUBSCRIPTION_STATE_ACTIVE: "active",
  SUBSCRIPTION_STATE_CANCELED: "active", // canceled = won't renew, still paid through expiryTime
  SUBSCRIPTION_STATE_IN_GRACE_PERIOD: "grace",
  SUBSCRIPTION_STATE_ON_HOLD: "expired",
  SUBSCRIPTION_STATE_PAUSED: "expired",
  SUBSCRIPTION_STATE_EXPIRED: "expired",
  SUBSCRIPTION_STATE_PENDING: "incomplete",
  SUBSCRIPTION_STATE_PENDING_PURCHASE_CANCELED: "expired",
};

async function fetchSubscription(purchaseToken: string): Promise<SubscriptionV2> {
  const res = await fetch(`${API}/purchases/subscriptionsv2/tokens/${encodeURIComponent(purchaseToken)}`, { headers: { Authorization: `Bearer ${await accessToken()}` } });
  if (!res.ok) throw new Error(`Google Play check failed (${res.status})`);
  return (await res.json()) as SubscriptionV2;
}

async function save(userId: string, purchaseToken: string, sub: SubscriptionV2) {
  const item = sub.lineItems?.find((l) => l.productId === GOOGLE_PRODUCT) ?? sub.lineItems?.[0];
  const product = intervalForProduct(item?.offerDetails?.basePlanId ?? "");
  if (!item || item.productId !== GOOGLE_PRODUCT || !product) throw new Error("Not a Tarrow Pro subscription");
  const periodEnd = item.expiryTime ? new Date(item.expiryTime) : null;
  let status = STATES[sub.subscriptionState ?? ""] ?? "expired";
  if (status === "active" && periodEnd && periodEnd < new Date()) status = "expired";
  await upsertSubscription({
    userId,
    provider: "google",
    externalId: purchaseToken,
    product,
    status,
    periodEnd,
    willRenew: !!item.autoRenewingPlan?.autoRenewEnabled && sub.subscriptionState === "SUBSCRIPTION_STATE_ACTIVE",
    environment: sub.testPurchase ? "sandbox" : "production",
    raw: { state: sub.subscriptionState, expiryTime: item.expiryTime, basePlanId: item.offerDetails?.basePlanId },
  });
  // Unacknowledged purchases are refunded by Google after 3 days.
  if (sub.acknowledgementState === "ACKNOWLEDGEMENT_STATE_PENDING" && (status === "active" || status === "grace")) {
    await fetch(`${API}/purchases/subscriptions/${GOOGLE_PRODUCT}/tokens/${encodeURIComponent(purchaseToken)}:acknowledge`, {
      method: "POST",
      headers: { Authorization: `Bearer ${await accessToken()}`, "Content-Type": "application/json" },
      body: "{}",
    }).catch(() => {});
  }
}

/** A purchase token the Android app just bought or restored. */
export async function claimGooglePurchase(userId: string, purchaseToken: string) {
  const sub = await fetchSubscription(purchaseToken);
  const account = sub.externalAccountIdentifiers?.obfuscatedExternalAccountId;
  if (account && account.toLowerCase() !== userId.toLowerCase()) throw new Error("This purchase belongs to a different Tarrow account");
  const owner = await subscriptionOwner("google", purchaseToken);
  if (owner && owner !== userId) throw new Error("This Google Play subscription is already linked to a different Tarrow account");
  await save(userId, purchaseToken, sub);
}

export async function refreshGoogleSubscription(userId: string, purchaseToken: string) {
  await save(userId, purchaseToken, await fetchSubscription(purchaseToken));
}
