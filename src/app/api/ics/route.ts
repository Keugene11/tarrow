// Builds an .ics file from query params so calendar cards work with Apple Calendar / Outlook.
const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");

export async function GET(req: Request) {
  const p = new URL(req.url).searchParams;
  const title = (p.get("title") ?? "Event").slice(0, 200);
  const start = new Date(p.get("start") ?? "");
  let end = new Date(p.get("end") ?? "");
  if (Number.isNaN(start.getTime())) return new Response("Bad start", { status: 400 });
  if (Number.isNaN(end.getTime()) || end <= start) end = new Date(start.getTime() + 3600_000);
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Tarrow//EN",
    "BEGIN:VEVENT",
    `UID:${crypto.randomUUID()}@tarrow`,
    `DTSTAMP:${stamp(new Date())}`,
    `DTSTART:${stamp(start)}`,
    `DTEND:${stamp(end)}`,
    `SUMMARY:${esc(title)}`,
    p.get("location") ? `LOCATION:${esc(p.get("location")!.slice(0, 300))}` : "",
    p.get("details") ? `DESCRIPTION:${esc(p.get("details")!.slice(0, 2000))}` : "",
    "END:VEVENT",
    "END:VCALENDAR",
  ].filter(Boolean);
  const filename = title.replace(/[^a-z0-9]+/gi, "-").slice(0, 40) || "event";
  return new Response(lines.join("\r\n"), {
    headers: { "Content-Type": "text/calendar; charset=utf-8", "Content-Disposition": `attachment; filename="${filename}.ics"` },
  });
}
