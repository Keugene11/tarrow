"use client";

/**
 * Buying Pro on each platform: Stripe Checkout on the web, StoreKit 2 on iOS, Play Billing on Android.
 * Native purchases are verified by the server (/api/billing/apple, /api/billing/google) before Pro unlocks.
 */
import { api } from "./client";
import { isNative } from "./native";
import { APPLE_PRODUCTS, GOOGLE_BASE_PLANS, GOOGLE_PRODUCT, type Interval } from "./plans";

export type StorePlatform = "ios" | "android" | "web";
type CapWindow = Window & { Capacitor?: { getPlatform?: () => string } };

export function storePlatform(): StorePlatform {
  if (typeof window === "undefined" || !isNative()) return "web";
  const p = (window as CapWindow).Capacitor?.getPlatform?.();
  return p === "ios" ? "ios" : p === "android" ? "android" : "web";
}

async function plugin() {
  const mod = await import("@capgo/native-purchases");
  return { NativePurchases: mod.NativePurchases, SUBS: mod.PURCHASE_TYPE.SUBS };
}

export class PurchaseCancelled extends Error {}

/** Localized store prices ("$19.99", "€22,99") when running in the app; null on the web. */
export async function storePrices(): Promise<Partial<Record<Interval, string>> | null> {
  const platform = storePlatform();
  if (platform === "web") return null;
  try {
    const { NativePurchases, SUBS } = await plugin();
    const ids = platform === "ios" ? Object.values(APPLE_PRODUCTS) : [GOOGLE_PRODUCT];
    const { products } = await NativePurchases.getProducts({ productIdentifiers: ids, productType: SUBS });
    const out: Partial<Record<Interval, string>> = {};
    for (const p of products as { identifier: string; priceString: string; planIdentifier?: string }[]) {
      if (platform === "ios") {
        if (p.identifier === APPLE_PRODUCTS.monthly) out.monthly = p.priceString;
        if (p.identifier === APPLE_PRODUCTS.yearly) out.yearly = p.priceString;
      } else if (p.planIdentifier === GOOGLE_BASE_PLANS.monthly) out.monthly = p.priceString;
      else if (p.planIdentifier === GOOGLE_BASE_PLANS.yearly) out.yearly = p.priceString;
    }
    return out;
  } catch {
    return null;
  }
}

function cancelled(err: unknown) {
  const msg = String((err as Error)?.message ?? err).toLowerCase();
  return msg.includes("cancel") || msg.includes("user_canceled") || msg.includes("usercancelled");
}

/** Starts the purchase. On the web this navigates to Stripe Checkout and never resolves. */
export async function buyPro(interval: Interval, userId: string): Promise<void> {
  const platform = storePlatform();
  if (platform === "web") {
    const { url } = await api<{ url: string }>("/api/billing/checkout", { body: { interval } });
    window.location.href = url;
    return new Promise(() => {});
  }
  const { NativePurchases, SUBS } = await plugin();
  let tx: { jwsRepresentation?: string; purchaseToken?: string };
  try {
    tx =
      platform === "ios"
        ? await NativePurchases.purchaseProduct({ productIdentifier: APPLE_PRODUCTS[interval], productType: SUBS, appAccountToken: userId, quantity: 1 })
        : await NativePurchases.purchaseProduct({ productIdentifier: GOOGLE_PRODUCT, planIdentifier: GOOGLE_BASE_PLANS[interval], productType: SUBS, appAccountToken: userId, quantity: 1 });
  } catch (err) {
    if (cancelled(err)) throw new PurchaseCancelled("Purchase cancelled");
    throw new Error("The purchase didn't go through. You weren't charged.");
  }
  await verify(platform, [tx]);
}

async function verify(platform: StorePlatform, txs: { jwsRepresentation?: string; purchaseToken?: string }[]) {
  if (platform === "ios") {
    const transactions = txs.map((t) => t.jwsRepresentation).filter(Boolean) as string[];
    if (transactions.length) return api<{ plan: string }>("/api/billing/apple", { body: { transactions } });
  } else if (platform === "android") {
    const purchaseTokens = txs.map((t) => t.purchaseToken).filter(Boolean) as string[];
    if (purchaseTokens.length) return api<{ plan: string }>("/api/billing/google", { body: { purchaseTokens } });
  }
  return null;
}

/** Restore Purchases (required on iOS) and the silent re-sync on app launch. Returns the plan, or null if nothing was found. */
export async function restorePurchases({ silent = false } = {}): Promise<string | null> {
  const platform = storePlatform();
  if (platform === "web") return null;
  const { NativePurchases, SUBS } = await plugin();
  if (!silent) await NativePurchases.restorePurchases().catch(() => {});
  const { purchases } = await NativePurchases.getPurchases({ productType: SUBS, onlyCurrentEntitlements: true });
  const ours = (purchases as { productIdentifier: string; jwsRepresentation?: string; purchaseToken?: string }[]).filter((p) =>
    platform === "ios" ? Object.values(APPLE_PRODUCTS).includes(p.productIdentifier) : p.productIdentifier === GOOGLE_PRODUCT,
  );
  if (!ours.length) return null;
  const res = await verify(platform, ours);
  return res?.plan ?? null;
}

/** Where a subscriber manages or cancels, depending on where they bought. */
export async function manageSubscription(provider: "stripe" | "apple" | "google") {
  if (provider === "stripe") {
    const { url } = await api<{ url: string }>("/api/billing/portal", { method: "POST" });
    window.location.href = url;
    return;
  }
  const platform = storePlatform();
  if ((provider === "apple" && platform === "ios") || (provider === "google" && platform === "android")) {
    const { NativePurchases } = await plugin();
    await NativePurchases.manageSubscriptions();
    return;
  }
  window.open(provider === "apple" ? "https://apps.apple.com/account/subscriptions" : "https://play.google.com/store/account/subscriptions?package=com.tarrow.app", "_blank");
}
