// Pure helpers for Gmail messages (no server-only imports so qa/gmail-check.mjs can test them).

export type GmailHeader = { name: string; value: string };
export type GmailPart = { mimeType?: string; filename?: string; headers?: GmailHeader[]; body?: { data?: string; size?: number; attachmentId?: string }; parts?: GmailPart[] };
export type GmailMessage = { id: string; threadId: string; labelIds?: string[]; snippet?: string; internalDate?: string; payload?: GmailPart };

export const header = (m: { payload?: GmailPart } | GmailPart | undefined, name: string) => {
  const headers = m && "payload" in m ? m.payload?.headers : (m as GmailPart | undefined)?.headers;
  return headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? "";
};

const decodeB64Url = (data: string) => Buffer.from(data.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");

/** Very small HTML → text: enough for quoting an email in a prompt. */
export function htmlToText(html: string) {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/?(p|div|tr|li|h[1-6]|blockquote|table|ul|ol)(\s[^>]*)?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Best text body of a message: text/plain first, else text/html converted. Attachments are listed by name. */
export function messageText(m: GmailMessage): { text: string; attachments: string[] } {
  let plain = "";
  let html = "";
  const attachments: string[] = [];
  const walk = (p: GmailPart | undefined) => {
    if (!p) return;
    if (p.filename && p.body?.attachmentId) attachments.push(p.filename);
    const data = p.body?.data;
    if (data && p.mimeType === "text/plain" && !plain) plain = decodeB64Url(data);
    else if (data && p.mimeType === "text/html" && !html) html = decodeB64Url(data);
    p.parts?.forEach(walk);
  };
  walk(m.payload);
  const text = (plain || htmlToText(html) || m.snippet || "").replace(/\r\n/g, "\n").trim();
  return { text, attachments };
}

/** Drop quoted replies ("On … wrote:", "> …") so threads don't repeat every earlier message. */
export function stripQuoted(text: string) {
  const lines = text.split("\n");
  const cut = lines.findIndex((l, i) => /^On .{5,200} wrote:\s*$/.test(l.trim()) || (l.startsWith(">") && lines.slice(i).every((x) => x.startsWith(">") || !x.trim())) || /^-{2,}\s*Original Message\s*-{2,}/i.test(l));
  return (cut > 0 ? lines.slice(0, cut) : lines).join("\n").trim();
}

const safe = (s: string) => s.replace(/[\r\n]+/g, " ").trim();
const encodeHeader = (s: string) => (/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${Buffer.from(s, "utf8").toString("base64")}?=`);

export type MimeInput = { from: string; to: string; cc?: string; subject: string; body: string; inReplyTo?: string; references?: string };

/** RFC 2822 message, base64url-encoded the way the Gmail API wants `raw`. */
export function buildMime(m: MimeInput) {
  const headers = [
    `From: ${safe(m.from)}`,
    `To: ${safe(m.to)}`,
    m.cc ? `Cc: ${safe(m.cc)}` : "",
    `Subject: ${encodeHeader(safe(m.subject))}`,
    m.inReplyTo ? `In-Reply-To: ${safe(m.inReplyTo)}` : "",
    m.references ? `References: ${safe(m.references)}` : "",
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
  ].filter(Boolean);
  const body = Buffer.from(m.body.replace(/\r?\n/g, "\r\n"), "utf8").toString("base64").replace(/(.{76})/g, "$1\r\n");
  return Buffer.from(`${headers.join("\r\n")}\r\n\r\n${body}`, "utf8").toString("base64url");
}

/** Decode a `raw` message back to its header block and text body (used by the QA check). */
export function parseMime(raw: string): { headers: Record<string, string>; body: string } {
  const text = Buffer.from(raw, "base64url").toString("utf8");
  const [head, ...rest] = text.split("\r\n\r\n");
  const headers: Record<string, string> = {};
  for (const line of head.split("\r\n")) {
    const i = line.indexOf(":");
    if (i > 0) headers[line.slice(0, i).toLowerCase()] = line.slice(i + 1).trim();
  }
  const body = Buffer.from(rest.join("\r\n\r\n").replace(/\r\n/g, ""), "base64").toString("utf8");
  return { headers, body };
}

export const replySubject = (subject: string) => (/^\s*re\s*:/i.test(subject) ? subject.trim() : `Re: ${subject.trim()}`.trim());

/** "Jane Doe <jane@x.com>" → "jane@x.com"; keeps a bare address as is. */
export const addressOf = (s: string) => s.match(/<([^>]+)>/)?.[1]?.trim() ?? s.trim();

export const isEmailList = (s: string) =>
  s
    .split(/[,;]/)
    .map((x) => addressOf(x))
    .every((a) => /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(a));
