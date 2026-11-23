// Gmail connector checks. Usage: node qa/gmail-check.mjs [base]
// 1. MIME/parsing helpers (no network). 2. With a base URL: the connect/draft endpoints refuse anonymous callers.
// Node 24 runs the .ts helpers directly (type stripping); no model or Gmail calls are made.
import { addressOf, buildMime, htmlToText, isEmailList, parseMime, replySubject, stripQuoted, messageText } from "../src/lib/gmail-mime.ts";

let failed = 0;
const check = (name, ok, extra = "") => {
  console.log(`${ok ? "✓" : "✗"} ${name}${extra ? ` — ${extra}` : ""}`);
  if (!ok) failed++;
};

// --- MIME round trip ---
const raw = buildMime({ from: "me@tarrow.test", to: "Jane <jane@example.com>", cc: "bob@example.com", subject: "Re: Café booking — Sí", body: "Hola Jane,\n\nÇa marche pour 19h? 🙂\n\nLine with 76+ chars: " + "x".repeat(120), inReplyTo: "<abc@mail.example.com>", references: "<root@mail.example.com> <abc@mail.example.com>" });
check("raw is base64url", /^[A-Za-z0-9_-]+$/.test(raw));
const parsed = parseMime(raw);
check("To header kept", parsed.headers.to === "Jane <jane@example.com>");
check("Cc header kept", parsed.headers.cc === "bob@example.com");
check("Subject is RFC 2047 encoded", parsed.headers.subject.startsWith("=?UTF-8?B?") && Buffer.from(parsed.headers.subject.slice(10, -2), "base64").toString("utf8") === "Re: Café booking — Sí");
check("reply headers kept", parsed.headers["in-reply-to"] === "<abc@mail.example.com>" && parsed.headers.references.includes("<root@mail.example.com>"));
check("content type utf-8 base64", /charset="UTF-8"/.test(parsed.headers["content-type"]) && parsed.headers["content-transfer-encoding"] === "base64");
check("body round-trips (unicode, emoji, long lines)", parsed.body.replace(/\r\n/g, "\n") === "Hola Jane,\n\nÇa marche pour 19h? 🙂\n\nLine with 76+ chars: " + "x".repeat(120));

const injected = parseMime(buildMime({ from: "me@tarrow.test", to: "x@example.com\r\nBcc: evil@example.com", subject: "Hi\nX-Injected: 1", body: "b" }));
check("header injection stripped", injected.headers.bcc === undefined && injected.headers["x-injected"] === undefined && injected.headers.to === "x@example.com Bcc: evil@example.com");

// --- parsing ---
check("htmlToText", htmlToText("<div>Hi <b>there</b><br>Second &amp; line<p>Third</p><style>p{}</style></div>") === "Hi there\nSecond & line\nThird");
check("stripQuoted removes reply chain", stripQuoted("Thanks, see you then.\n\nOn Tue, Sep 16, 2026 at 3:00 PM Jane <jane@example.com> wrote:\n> Are we on for Thursday?\n> Jane") === "Thanks, see you then.");
check("stripQuoted keeps text without quotes", stripQuoted("Line one\n> a quote in the middle\nLine three") === "Line one\n> a quote in the middle\nLine three");
check("replySubject", replySubject("Booking") === "Re: Booking" && replySubject("RE: Booking") === "RE: Booking");
check("addressOf", addressOf("Jane Doe <jane@x.com>") === "jane@x.com" && addressOf("bare@x.com") === "bare@x.com");
check("isEmailList", isEmailList("a@x.com, Bob <b@y.org>") && !isEmailList("not an email") && !isEmailList("a@x.com, nope"));

const b64 = (s) => Buffer.from(s, "utf8").toString("base64url");
const msg = {
  id: "m1",
  threadId: "t1",
  payload: {
    mimeType: "multipart/mixed",
    parts: [
      { mimeType: "multipart/alternative", parts: [{ mimeType: "text/plain", body: { data: b64("plain body") } }, { mimeType: "text/html", body: { data: b64("<p>html body</p>") } }] },
      { mimeType: "application/pdf", filename: "invoice.pdf", body: { attachmentId: "att1", size: 10 } },
    ],
  },
};
const mt = messageText(msg);
check("messageText prefers text/plain and lists attachments", mt.text === "plain body" && mt.attachments.join() === "invoice.pdf");
check("messageText falls back to html", messageText({ id: "m2", threadId: "t1", payload: { mimeType: "text/html", body: { data: b64("<p>only <i>html</i></p>") } } }).text === "only html");

// --- endpoints (anonymous) ---
const base = (process.argv[2] ?? "").replace(/\/$/, "");
if (base) {
  const get = (path) => fetch(`${base}${path}`, { redirect: "manual" });
  const location = (res) => res.headers.get("location") ?? "";
  let r = await get("/api/integrations/gmail");
  check("GET connect (signed out) → /login or unavailable", [302, 307].includes(r.status) && /\/(login|settings\?gmail=unavailable)/.test(location(r)), `${r.status} ${location(r)}`);
  r = await get("/api/integrations/gmail?t=bogus.1.sig");
  check("GET connect with bad native token → expired", [302, 307].includes(r.status) && /gmail=(expired|unavailable)/.test(location(r)), `${r.status} ${location(r)}`);
  r = await get("/api/integrations/gmail/callback?code=x&state=y");
  check("callback without state cookie → state error", [302, 307].includes(r.status) && /gmail=(state|unavailable)/.test(location(r)), `${r.status} ${location(r)}`);
  r = await fetch(`${base}/api/integrations/gmail/link`, { method: "POST" });
  check("POST link (signed out) → 401", r.status === 401, String(r.status));
  r = await fetch(`${base}/api/integrations/gmail`, { method: "DELETE" });
  check("DELETE connection (signed out) → 401", r.status === 401, String(r.status));
  r = await fetch(`${base}/api/integrations/gmail/drafts/r123`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
  check("POST send draft (signed out) → 401", r.status === 401, String(r.status));
  r = await fetch(`${base}/api/integrations/gmail/drafts/r123`, { method: "DELETE" });
  check("DELETE draft (signed out) → 401", r.status === 401, String(r.status));
} else {
  console.log("(pass a base URL to also check the endpoints)");
}

console.log(failed ? `\n${failed} check(s) failed` : "\nall good");
process.exit(failed ? 1 : 0);
