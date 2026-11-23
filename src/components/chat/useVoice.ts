"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type State = "idle" | "recording" | "transcribing";

/** Records from the mic and transcribes via /api/transcribe. */
export function useVoice(onText: (text: string) => void) {
  const [state, setState] = useState<State>("idle");
  const [error, setError] = useState("");
  const [seconds, setSeconds] = useState(0);
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const [supported, setSupported] = useState(false);

  const cleanup = () => {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
    recorder.current?.stream.getTracks().forEach((t) => t.stop());
    recorder.current = null;
  };
  useEffect(() => {
    setSupported(!!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== "undefined");
    return cleanup;
  }, []);

  const start = useCallback(async () => {
    setError("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg"].find((m) => MediaRecorder.isTypeSupported?.(m));
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      chunks.current = [];
      rec.ondataavailable = (e) => e.data.size && chunks.current.push(e.data);
      rec.onstop = async () => {
        const blob = new Blob(chunks.current, { type: rec.mimeType || "audio/webm" });
        cleanup();
        setState("transcribing");
        try {
          const form = new FormData();
          form.append("audio", blob, "voice");
          const res = await fetch("/api/transcribe", { method: "POST", body: form });
          const data = (await res.json().catch(() => ({}))) as { text?: string; error?: string };
          if (!res.ok) throw new Error(data.error ?? "Couldn't transcribe that");
          if (data.text) onText(data.text);
          else setError("Didn't catch that. Try again.");
        } catch (err) {
          setError((err as Error).message);
        } finally {
          setState("idle");
        }
      };
      recorder.current = rec;
      rec.start();
      setSeconds(0);
      timer.current = setInterval(() => {
        setSeconds((s) => {
          if (s + 1 >= 120) rec.state === "recording" && rec.stop();
          return s + 1;
        });
      }, 1000);
      setState("recording");
    } catch {
      cleanup();
      setError("Microphone access was blocked.");
      setState("idle");
    }
  }, [onText]);

  const stop = useCallback(() => {
    if (recorder.current?.state === "recording") recorder.current.stop();
  }, []);

  return { state, error, seconds, supported, start, stop, clearError: () => setError("") };
}
