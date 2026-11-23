import "server-only";
import { Environment, SignedDataVerifier, type JWSTransactionDecodedPayload } from "@apple/app-store-server-library";
import { sql } from "../db";
import { APPLE_PRODUCTS, intervalForProduct } from "../plans";
import { APPLE_ROOT_CERTS_BASE64 } from "./apple-roots";
import { subscriptionOwner, upsertSubscription, type SubStatus } from "./index";

const BUNDLE_ID = "com.tarrow.app";
const APP_APPLE_ID = Number(process.env.APPLE_APP_ID || 6811780241);
const roots = APPLE_ROOT_CERTS_BASE64.map((b) => Buffer.from(b, "base64"));

// Production needs the app's Apple ID; sandbox (TestFlight, App Review) doesn't.
const verifiers = [
  new SignedDataVerifier(roots, true, Environment.PRODUCTION, BUNDLE_ID, APP_APPLE_ID),
  new SignedDataVerifier(roots, true, Environment.SANDBOX, BUNDLE_ID),
];

async function verify<T>(fn: (v: SignedDataVerifier) => Promise<T>): Promise<T> {
  let last: unknown;
  for (const v of verifiers) {
    try {
      return await fn(v);
    } catch (err) {
      last = err;
    }
  }
  throw last;
}

function statusOf(tx: JWSTransactionDecodedPayload, grace = false): SubStatus {
  if (tx.revocationDate) return "refunded";
  if (tx.expiresDate && tx.expiresDate > Date.now()) return "active";
  return grace ? "grace" : "expired";
}

async function save(userId: string, tx: JWSTransactionDecodedPayload, extra: { willRenew?: boolean; graceUntil?: number } = {}) {
  const product = intervalForProduct(String(tx.productId));
  if (!product || !tx.originalTransactionId) throw new Error("Not a Tarrow Pro subscription");
  const grace = !!extra.graceUntil && extra.graceUntil > Date.now();
  await upsertSubscription({
    userId,
    provider: "apple",
    externalId: tx.originalTransactionId,
    product,
    status: statusOf(tx, grace),
    periodEnd: grace ? new Date(extra.graceUntil!) : tx.expiresDate ? new Date(tx.expiresDate) : null,
    willRenew: extra.willRenew ?? true,
    environment: String(tx.environment ?? "Production").toLowerCase(),
    raw: { transactionId: tx.transactionId, productId: tx.productId, expiresDate: tx.expiresDate, revocationDate: tx.revocationDate },
  });
}

/** A transaction the app just bought or restored (StoreKit 2 jwsRepresentation). */
export async function claimAppleTransaction(userId: string, jws: string) {
  const tx = await verify((v) => v.verifyAndDecodeTransaction(jws)).catch(() => {
    throw new Error("We couldn't verify that App Store purchase. Try Restore Purchases.");
  });
  if (!Object.values(APPLE_PRODUCTS).includes(String(tx.productId))) throw new Error("Unknown product");
  if (tx.appAccountToken && tx.appAccountToken.toLowerCase() !== userId.toLowerCase()) throw new Error("This purchase belongs to a different Tarrow account");
  const owner = await subscriptionOwner("apple", String(tx.originalTransactionId));
  if (owner && owner !== userId) throw new Error("This App Store subscription is already linked to a different Tarrow account");
  await save(userId, tx);
}

/** App Store Server Notifications V2: renewals, expirations, refunds, billing retry. */
export async function handleAppleNotification(signedPayload: string) {
  const note = await verify((v) => v.verifyAndDecodeNotification(signedPayload));
  const data = note.data;
  if (!data?.signedTransactionInfo) return { ignored: note.notificationType };
  const tx = await verify((v) => v.verifyAndDecodeTransaction(data.signedTransactionInfo!));
  const renewal = data.signedRenewalInfo ? await verify((v) => v.verifyAndDecodeRenewalInfo(data.signedRenewalInfo!)) : null;
  const existing = await sql`select user_id from subscriptions where provider = 'apple' and external_id = ${String(tx.originalTransactionId)}`;
  const userId = existing[0] ? String(existing[0].user_id) : tx.appAccountToken ?? null;
  if (!userId) return { ignored: "unknown user" };
  const known = await sql`select 1 from users where id = ${userId}`;
  if (!known.length) return { ignored: "user deleted" };
  await save(userId, tx, {
    willRenew: renewal ? Number(renewal.autoRenewStatus) === 1 : undefined,
    graceUntil: renewal?.gracePeriodExpiresDate ?? undefined,
  });
  return { ok: note.notificationType };
}
