"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Check, LoaderCircle } from "lucide-react";
import { api } from "@/lib/client";
import { haptic } from "@/lib/native";
import { PLAN_FEATURES, PRICES, YEARLY_SAVINGS_PCT, type Interval, type PlanId } from "@/lib/plans";
import { buyPro, manageSubscription, PurchaseCancelled, restorePurchases, storePlatform, storePrices, type StorePlatform } from "@/lib/purchases";

export type SubscriptionInfo = { provider: "stripe" | "apple" | "google"; product: Interval; status: string; periodEnd: string | null; willRenew: boolean } | null;

type Props = {
  signedIn: boolean;
  userId?: string;
  plan: PlanId;
  subscription: SubscriptionInfo;
  usage?: { runsToday: number; limit: number };
};

const WHERE: Record<"stripe" | "apple" | "google", string> = { stripe: "the web", apple: "the App Store", google: "Google Play" };

export function PlansView({ signedIn, userId, plan: initialPlan, subscription: initialSub, usage }: Props) {
  const router = useRouter();
  const params = useSearchParams();
  const [interval, setInterval] = useState<Interval>("monthly");
  const [platform, setPlatform] = useState<StorePlatform>("web");
  const [native, setNative] = useState<Partial<Record<Interval, string>> | null>(null);
  const [plan, setPlan] = useState(initialPlan);
  const [sub, setSub] = useState(initialSub);
  const [busy, setBusy] = useState<"buy" | "restore" | "manage" | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    const p = storePlatform();
    setPlatform(p);
    if (p !== "web") storePrices().then(setNative);
  }, []);

  // Back from Stripe Checkout: pick up the subscription without waiting for the webhook.
  useEffect(() => {
    if (params.get("checkout") !== "success" || !signedIn) return;
    setNotice("Finishing your upgrade…");
    api<{ plan: PlanId; subscription: SubscriptionInfo }>("/api/billing/sync", { method: "POST" })
      .then((d) => {
        setPlan(d.plan);
        setSub(d.subscription);
        setNotice(d.plan === "pro" ? "Welcome to Tarrow Pro. Deep and Marathon modes are unlocked." : "Payment received. Pro will unlock in a moment; refresh if it doesn't.");
        router.replace("/upgrade");
        router.refresh();
      })
      .catch(() => setNotice(""));
  }, [params, signedIn, router]);

  const price = (i: Interval) => native?.[i] ?? PRICES[i].label;
  const pro = plan === "pro";

  const upgrade = async () => {
    if (!signedIn || !userId) return router.push("/signup");
    setBusy("buy");
    setError("");
    try {
      await buyPro(interval, userId);
      const d = await api<{ plan: PlanId; subscription: SubscriptionInfo }>("/api/billing");
      setPlan(d.plan);
      setSub(d.subscription);
      if (d.plan === "pro") {
        haptic("success");
        setNotice("Welcome to Tarrow Pro. Deep and Marathon modes are unlocked.");
        router.refresh();
      }
    } catch (err) {
      if (!(err instanceof PurchaseCancelled)) setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const restore = async () => {
    setBusy("restore");
    setError("");
    setNotice("");
    try {
      const result = await restorePurchases();
      if (result === "pro") {
        const d = await api<{ plan: PlanId; subscription: SubscriptionInfo }>("/api/billing");
        setPlan(d.plan);
        setSub(d.subscription);
        setNotice("Your Pro subscription is restored.");
        router.refresh();
      } else setNotice("No active Tarrow Pro subscription found for this account.");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const manage = async () => {
    if (!sub) return;
    setBusy("manage");
    setError("");
    try {
      await manageSubscription(sub.provider);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  // Manage where it was bought; an App Store subscription can't be changed from the web and vice versa.
  const canManageHere = !!sub && (sub.provider === "stripe" ? platform === "web" : true);
  const renewal = sub?.periodEnd ? new Date(sub.periodEnd).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : null;

  return (
    <div className="mx-auto w-full max-w-[720px] space-y-4 px-4 pb-16 pt-4">
      {notice && <p className="rounded-2xl bg-neutral-100 px-4 py-2.5 text-[14px]">{notice}</p>}
      {error && <p className="rounded-2xl bg-neutral-100 px-4 py-2.5 text-[14px] text-red-600">{error}</p>}

      {!pro && (
        <div role="radiogroup" aria-label="Billing period" className="mx-auto flex w-fit rounded-full border border-neutral-200 p-1 text-[14px]">
          {(["monthly", "yearly"] as Interval[]).map((i) => (
            <button key={i} type="button" role="radio" aria-checked={interval === i} onClick={() => setInterval(i)} className={`press rounded-full px-4 py-1.5 font-medium ${interval === i ? "bg-neutral-900 text-white" : "text-neutral-600"}`}>
              {i === "monthly" ? "Monthly" : `Yearly · save ${YEARLY_SAVINGS_PCT}%`}
            </button>
          ))}
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <section className={`order-2 rounded-3xl border p-5 sm:order-1 ${!pro && signedIn ? "border-neutral-300" : "border-neutral-200"}`}>
          <h2 className="text-[15px] font-semibold">Free</h2>
          <div className="mt-2 flex items-baseline gap-1">
            <span className="text-[32px] font-semibold tracking-tight">$0</span>
          </div>
          <p className="text-[13px] text-neutral-500">Get to know Tarrow</p>
          <ul className="mt-4 space-y-2 text-[14px]">
            {PLAN_FEATURES.free.map((f) => (
              <li key={f} className="flex gap-2">
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-neutral-400" /> {f}
              </li>
            ))}
          </ul>
          {signedIn ? (
            !pro && <div className="mt-5 rounded-full border border-neutral-200 py-2.5 text-center text-[14px] font-medium text-neutral-500">Current plan</div>
          ) : (
            <Link href="/signup" className="press mt-5 block rounded-full border border-neutral-300 py-2.5 text-center text-[14px] font-medium">
              Start free
            </Link>
          )}
          {usage && !pro && (
            <p className="mt-2 text-center text-[12.5px] tabular-nums text-neutral-500">
              {usage.runsToday} / {usage.limit} tasks used today
            </p>
          )}
        </section>

        <section className="order-1 rounded-3xl border-2 border-neutral-900 p-5 sm:order-2">
          <div className="flex items-center justify-between">
            <h2 className="text-[15px] font-semibold">Pro</h2>
            {pro && <span className="rounded-full bg-neutral-900 px-2.5 py-0.5 text-[12px] font-medium text-white">Your plan</span>}
          </div>
          {pro && sub ? (
            <>
              <div className="mt-2 text-[32px] font-semibold tracking-tight">{sub.product === "yearly" ? price("yearly") : price("monthly")}</div>
              <p className="text-[13px] text-neutral-500">
                per {sub.product === "yearly" ? "year" : "month"} · {sub.willRenew ? `renews ${renewal}` : `ends ${renewal}`} · via {WHERE[sub.provider]}
              </p>
            </>
          ) : (
            <>
              <div className="mt-2 flex items-baseline gap-1">
                <span className="text-[32px] font-semibold tracking-tight">{price(interval)}</span>
                <span className="text-[14px] text-neutral-500">/ {PRICES[interval].per}</span>
              </div>
              <p className="text-[13px] text-neutral-500">{interval === "yearly" ? `Just $${(PRICES.yearly.amount / 12).toFixed(2)} a month, billed yearly` : "Billed monthly, cancel anytime"}</p>
            </>
          )}
          <ul className="mt-4 space-y-2 text-[14px]">
            {PLAN_FEATURES.pro.map((f) => (
              <li key={f} className="flex gap-2">
                <Check className="mt-0.5 h-4 w-4 shrink-0" /> {f}
              </li>
            ))}
          </ul>
          {pro ? (
            sub &&
            (canManageHere ? (
              <button type="button" onClick={manage} disabled={busy !== null} className="press mt-5 flex w-full items-center justify-center gap-2 rounded-full border border-neutral-900 py-2.5 text-[14px] font-medium disabled:opacity-50">
                {busy === "manage" && <LoaderCircle className="h-4 w-4 animate-spin" />} Manage subscription
              </button>
            ) : (
              <p className="mt-5 text-center text-[13px] text-neutral-500">You subscribed on {WHERE[sub.provider]}. Manage or cancel it there.</p>
            ))
          ) : (
            <button type="button" onClick={upgrade} disabled={busy !== null} className="press mt-5 flex w-full items-center justify-center gap-2 rounded-full bg-neutral-900 py-2.5 text-[14px] font-semibold text-white disabled:opacity-50">
              {busy === "buy" && <LoaderCircle className="h-4 w-4 animate-spin" />}
              {signedIn ? `Upgrade to Pro · ${price(interval)}/${interval === "yearly" ? "yr" : "mo"}` : "Get Pro"}
            </button>
          )}
        </section>
      </div>

      {platform !== "web" && signedIn && (
        <div className="text-center">
          <button type="button" onClick={restore} disabled={busy !== null} className="press inline-flex items-center gap-2 text-[14px] font-medium underline underline-offset-4 disabled:opacity-50">
            {busy === "restore" && <LoaderCircle className="h-4 w-4 animate-spin" />} Restore purchases
          </button>
        </div>
      )}

      <p className="text-center text-[12px] leading-relaxed text-neutral-500">
        {platform === "ios"
          ? "Payment is charged to your Apple Account when you confirm the purchase. Tarrow Pro renews automatically at the same price each month or year unless you cancel at least 24 hours before the period ends. Manage or cancel anytime in your App Store account settings."
          : platform === "android"
            ? "Tarrow Pro is billed through Google Play and renews automatically each month or year until you cancel. Manage or cancel anytime in Google Play subscriptions."
            : "Tarrow Pro renews automatically each month or year until you cancel. Cancel anytime from Settings; you keep Pro until the end of the period you paid for."}{" "}
        <Link href="/terms" className="underline underline-offset-2">
          Terms of Use
        </Link>{" "}
        ·{" "}
        <Link href="/privacy" className="underline underline-offset-2">
          Privacy Policy
        </Link>
      </p>
    </div>
  );
}
