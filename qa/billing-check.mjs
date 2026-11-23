// Billing QA: plan limits, Pro gating, Stripe checkout/portal, the Stripe webhook with a real $0 subscription,
// and rejection of forged App Store / Google Play purchases. Cleans up the Stripe objects it creates.
// Usage: node --env-file=.env.local qa/billing-check.mjs [base]
import Stripe from "stripe";
import { neon } from "@neondatabase/serverless";

const BASE = process.argv[2] || "http://localhost:3000";
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const sql = neon(process.env.DATABASE_URL);
let cookie = "";
let failed = 0;
const check = (ok, label, detail = "") => {
  if (!ok) failed++;
  console.log(ok ? "PASS" : "FAIL", label, detail);
};
async function call(path, body, method = body ? "POST" : "GET", headers = {}) {
  const res = await fetch(BASE + path, { method, headers: { "Content-Type": "application/json", cookie, ...headers }, body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body) });
  const set = res.headers.get("set-cookie");
  if (set) cookie = set.split(";")[0];
  return { status: res.status, data: await res.json().catch(() => ({})) };
}

const email = `qa+bill${Date.now()}@tarrow.test`;
await call("/api/auth/signup", { email, password: "testpass123", name: "Bill", city: "New York, NY", timezone: "America/New_York" });
await call("/api/consent", { agree: true });
await call("/api/onboarding/skip", {});
const me = (await call("/api/me")).data.user;

let r = await call("/api/billing");
check(r.data.plan === "free" && r.data.limits.runsPerDay === 10 && !r.data.limits.modes.includes("deep"), "new users are on Free", JSON.stringify(r.data.limits));

r = await call("/api/chat", { text: "research everything about coworking in Brooklyn", effort: "deep" });
check(r.status === 402 && r.data.code === "pro_required", "Deep mode needs Pro", `${r.status} ${r.data.error}`);

await sql`insert into usage_daily (user_id, day, runs) values (${me.id}, current_date, 10) on conflict (user_id, day) do update set runs = 10`;
r = await call("/api/chat", { text: "hi", effort: "quick" });
check(r.status === 429 && /Upgrade to Pro/.test(r.data.error), "free daily limit asks to upgrade", `${r.status} ${r.data.error}`);
await sql`update usage_daily set runs = 0 where user_id = ${me.id}`;

r = await call("/api/billing/checkout", { interval: "yearly" });
check(r.status === 200 && /^https:\/\/checkout\.stripe\.com\//.test(r.data.url ?? ""), "checkout returns a Stripe Checkout URL", String(r.data.url ?? r.data.error).slice(0, 60));
const sessionId = r.data.url?.match(/(cs_(?:live|test)_[A-Za-z0-9]+)/)?.[1];
if (sessionId) {
  const s = await stripe.checkout.sessions.retrieve(sessionId, { expand: ["line_items"] });
  check(s.line_items.data[0].price.lookup_key === "tarrow_pro_yearly" && s.line_items.data[0].amount_total === 10000 && s.metadata.user_id === me.id, "checkout is $100/year for this user");
  await stripe.checkout.sessions.expire(sessionId).catch(() => {});
}

r = await call("/api/billing/portal", {});
check(r.status === 200 && /billing\.stripe\.com/.test(r.data.url ?? ""), "portal returns a Stripe billing portal URL", String(r.data.url ?? r.data.error).slice(0, 50));

// A real subscription at $0 (100% off once), delivered through the signed webhook.
const [{ stripe_customer_id: customer }] = await sql`select stripe_customer_id from users where id = ${me.id}`;
const coupon = await stripe.coupons.create({ percent_off: 100, duration: "once", name: "Tarrow QA", metadata: { app: "tarrow", qa: "1" } });
const [price] = (await stripe.prices.list({ lookup_keys: ["tarrow_pro_monthly"], limit: 1 })).data;
const sub = await stripe.subscriptions.create({ customer, items: [{ price: price.id }], discounts: [{ coupon: coupon.id }], metadata: { app: "tarrow", user_id: me.id, qa: "1" } });
check(sub.status === "active", "created a $0 test subscription", sub.status);

const deliver = async (type, object) => {
  const payload = JSON.stringify({ id: `evt_qa_${Date.now()}`, object: "event", type, data: { object }, livemode: object.livemode, created: Math.floor(Date.now() / 1000), api_version: null });
  const header = stripe.webhooks.generateTestHeaderString({ payload, secret: process.env.STRIPE_WEBHOOK_SECRET });
  return call("/api/billing/stripe", payload, "POST", { "stripe-signature": header });
};
r = await call("/api/billing/stripe", JSON.stringify({ type: "customer.subscription.created" }), "POST", { "stripe-signature": "t=1,v1=bad" });
check(r.status === 400, "webhook rejects a bad signature", String(r.status));
r = await deliver("customer.subscription.created", sub);
check(r.status === 200, "webhook accepts a signed event", JSON.stringify(r.data));
r = await call("/api/billing");
check(r.data.plan === "pro" && r.data.subscription?.provider === "stripe" && r.data.subscription?.product === "monthly" && r.data.limits.modes.includes("marathon"), "subscription unlocks Pro", JSON.stringify(r.data.subscription));

r = await call("/api/chat", { text: "hi", effort: "deep" });
check(r.status === 200, "Pro users can start Deep mode", String(r.status));
if (r.data.runId) await sql`update runs set cancel_requested = true where id = ${r.data.runId}`;

const canceled = await stripe.subscriptions.cancel(sub.id);
r = await deliver("customer.subscription.deleted", canceled);
r = await call("/api/billing");
check(r.data.plan === "free", "canceling returns to Free", r.data.plan);

r = await call("/api/billing/apple", { transactions: ["eyJhbGciOiJFUzI1NiJ9.eyJmYWtlIjp0cnVlfQ.c2ln"] });
check(r.status === 400, "forged App Store transaction is rejected", `${r.status} ${r.data.error}`);
r = await call("/api/billing/apple/notifications", { signedPayload: "eyJhbGciOiJFUzI1NiJ9.e30.c2ln" });
check(r.status === 400, "forged App Store notification is rejected", String(r.status));
r = await call("/api/billing/google", { purchaseTokens: ["not-a-real-token"] });
check(r.status === 400, "fake Google Play token is rejected", `${r.status} ${r.data.error}`);
r = await call("/api/billing", undefined, "GET");
check(r.data.plan === "free", "still Free after forged purchases");

// Cleanup Stripe test objects.
await stripe.coupons.del(coupon.id).catch(() => {});
await stripe.customers.del(customer).catch(() => {});
console.log(failed ? `${failed} check(s) failed` : "all billing checks passed");
process.exit(failed ? 1 : 0);
