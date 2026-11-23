"use client";

import { useEffect, useRef, useState } from "react";

// In-app replacements for window.confirm/prompt. Native JS dialogs inside the iOS WKWebView can
// deadlock or crash (Capacitor), and account deletion must always work, so the app never uses them.

type Request =
  | { kind: "confirm"; title: string; body?: string; confirmLabel: string; danger?: boolean; resolve: (v: boolean) => void }
  | { kind: "prompt"; title: string; body?: string; confirmLabel: string; danger?: boolean; defaultValue: string; placeholder?: string; mustEqual?: string; resolve: (v: string | null) => void };

let show: ((r: Request) => void) | null = null;

export function confirmDialog(opts: { title: string; body?: string; confirmLabel?: string; danger?: boolean }): Promise<boolean> {
  return new Promise((resolve) => {
    if (!show) return resolve(window.confirm(opts.title));
    show({ kind: "confirm", confirmLabel: "Confirm", ...opts, resolve });
  });
}

export function promptDialog(opts: { title: string; body?: string; confirmLabel?: string; danger?: boolean; defaultValue?: string; placeholder?: string; mustEqual?: string }): Promise<string | null> {
  return new Promise((resolve) => {
    if (!show) return resolve(window.prompt(opts.title, opts.defaultValue ?? ""));
    show({ kind: "prompt", confirmLabel: "OK", defaultValue: "", ...opts, resolve });
  });
}

/** Mounted once in the root layout. */
export function DialogHost() {
  const [req, setReq] = useState<Request | null>(null);
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    show = (r) => {
      setValue(r.kind === "prompt" ? r.defaultValue : "");
      setReq(r);
    };
    return () => {
      show = null;
    };
  }, []);

  useEffect(() => {
    if (req?.kind === "prompt") setTimeout(() => inputRef.current?.select(), 30);
  }, [req]);

  if (!req) return null;
  const close = (ok: boolean) => {
    if (req.kind === "confirm") req.resolve(ok);
    else req.resolve(ok ? value : null);
    setReq(null);
  };
  const blocked = req.kind === "prompt" && (req.mustEqual ? value.trim() !== req.mustEqual : !value.trim());

  return (
    <div className="term fixed inset-0 z-[100] flex items-end justify-center bg-black/40 p-4 sm:items-center" role="dialog" aria-modal="true" aria-label={req.title} onKeyDown={(e) => e.key === "Escape" && close(false)}>
      <button type="button" aria-label="Close dialog" tabIndex={-1} className="absolute inset-0 cursor-default" onClick={() => close(false)} />
      <form
        className="relative mb-[var(--safe-bottom)] w-full max-w-[420px] rounded-md border border-t-frame bg-t-bg p-4 fade-in"
        onSubmit={(e) => {
          e.preventDefault();
          if (!blocked) close(true);
        }}
      >
        <div className="font-bold text-t-strong">{req.title}</div>
        {req.body && <p className="mt-1.5 t-dim">{req.body}</p>}
        {req.kind === "prompt" && (
          <input
            ref={inputRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={req.placeholder}
            aria-label={req.title}
            autoCapitalize="off"
            autoCorrect="off"
            className="mt-3 w-full rounded-md border border-t-edge bg-transparent px-3 py-2 text-[16px] outline-none focus:border-t-focus md:text-[14px]"
          />
        )}
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={() => close(false)} className="rounded-md px-3 py-1.5 t-dim hover:text-t-strong">
            Cancel
          </button>
          <button type="submit" disabled={blocked} className={`rounded-md px-3 py-1.5 font-bold disabled:opacity-40 ${req.danger ? "bg-red-600 text-white" : "bg-t-inv text-t-inv-fg hover:bg-t-inv-hover"}`}>
            {req.confirmLabel}
          </button>
        </div>
      </form>
    </div>
  );
}
