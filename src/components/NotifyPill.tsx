"use client";

import { useEffect, useState } from "react";
import { Bell, BellRing } from "lucide-react";
import { enablePush, pushEnabled, pushSupported } from "@/lib/push-client";
import { enableNativePush, isIOSApp, nativePushState } from "@/lib/native";

/** Current notification state across web push (browsers) and APNs (iOS app). */
async function readState(): Promise<"unsupported" | "off" | "on" | "denied"> {
  if (isIOSApp()) {
    const s = await nativePushState();
    return s === "granted" ? "on" : s === "denied" ? "denied" : "off";
  }
  if (!pushSupported()) return "unsupported";
  if (await pushEnabled()) return "on";
  return Notification.permission === "denied" ? "denied" : "off";
}

const turnOn = () => (isIOSApp() ? enableNativePush() : enablePush()).catch(() => false);

/** Offers "notify me when done" for long-running tasks (web push in browsers, native push in the iOS app). */
export function NotifyPill() {
  const [state, setState] = useState<"hidden" | "offer" | "on">("hidden");
  useEffect(() => {
    let dismissed = false;
    try {
      dismissed = localStorage.getItem("tarrow_notify_dismissed") === "1";
    } catch {}
    readState().then((s) => setState(s === "off" && !dismissed ? "offer" : "hidden"));
  }, []);
  if (state === "hidden") return null;
  if (state === "on")
    return (
      <span className="inline-flex items-center gap-1.5 pl-[2ch] text-[12.5px] t-dim fade-in">
        <BellRing className="h-3.5 w-3.5" /> We&apos;ll notify you when it&apos;s done. Feel free to leave.
      </span>
    );
  return (
    <div className="flex items-center gap-[2ch] pl-[2ch] text-[12.5px] fade-in">
      <button type="button" onClick={async () => setState((await turnOn()) ? "on" : "hidden")} className="inline-flex items-center gap-1.5 t-dim hover:text-t-strong">
        <Bell className="h-3.5 w-3.5" /> Notify me when it&apos;s done
      </button>
      <button
        type="button"
        onClick={() => {
          setState("hidden");
          try {
            localStorage.setItem("tarrow_notify_dismissed", "1");
          } catch {}
        }}
        className="t-faint hover:text-t-strong"
      >
        Not now
      </button>
    </div>
  );
}

/** Settings row to turn on notifications. */
export function NotificationsRow() {
  const [state, setState] = useState<"unsupported" | "off" | "on" | "denied">("unsupported");
  useEffect(() => {
    readState().then(setState);
  }, []);
  if (state === "unsupported") return null;
  return (
    <div className="flex items-center gap-3 border-t border-neutral-100 px-4 py-3.5">
      <Bell className="h-4 w-4" />
      <span className="flex-1 text-[14.5px]">Notify me when long tasks finish</span>
      {state === "on" ? (
        <span className="text-[13px] text-neutral-500">On</span>
      ) : state === "denied" ? (
        <span className="text-[12.5px] text-neutral-400">{isIOSApp() ? "Turn on in iPhone Settings → Tarrow" : "Blocked in browser settings"}</span>
      ) : (
        <button type="button" onClick={async () => setState((await turnOn()) ? "on" : await readState())} className="press rounded-full bg-neutral-900 px-3 py-1.5 text-[12.5px] font-medium text-white">
          Turn on
        </button>
      )}
    </div>
  );
}
