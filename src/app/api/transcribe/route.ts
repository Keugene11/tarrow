import { authed, HttpError, json } from "@/lib/http";

export const maxDuration = 60;

export const POST = authed(async (req, user) => {
  if (!user.ai_consent_at) throw new HttpError(403, "Agree to how Tarrow uses AI first");
  if (!process.env.GROQ_API_KEY) throw new HttpError(503, "Voice input isn't configured");
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    throw new HttpError(400, "Expected audio upload");
  }
  const audio = form.get("audio");
  if (!(audio instanceof Blob) || audio.size < 1000) throw new HttpError(400, "That recording was too short");
  if (audio.size > 15 * 1024 * 1024) throw new HttpError(413, "Recording is too long");
  const type = audio.type || "audio/webm";
  const ext = type.includes("mp4") || type.includes("m4a") || type.includes("aac") ? "m4a" : type.includes("ogg") ? "ogg" : type.includes("wav") ? "wav" : "webm";
  const upstream = new FormData();
  upstream.append("file", audio, `voice.${ext}`);
  upstream.append("model", "whisper-large-v3-turbo");
  upstream.append("response_format", "json");
  upstream.append("language", "en");
  const res = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}` },
    body: upstream,
    signal: AbortSignal.timeout(45_000),
  });
  if (res.status === 429) throw new HttpError(429, "Voice is busy right now. Try again in a minute.");
  if (!res.ok) throw new HttpError(502, "Couldn't transcribe that. Try again.");
  const data = (await res.json()) as { text?: string };
  return json({ text: (data.text ?? "").trim() });
});
