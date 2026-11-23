"use client";

import { api } from "./client";

// Native-only features of the iOS/Android shell. Every function is a safe no-op on the web.
type CapWindow = Window & { Capacitor?: { isNativePlatform?: () => boolean; getPlatform?: () => string; Plugins?: Record<string, unknown> } };

const cap = () => (typeof window === "undefined" ? undefined : (window as CapWindow).Capacitor);
export const isNative = () => !!cap()?.isNativePlatform?.();
export const isIOSApp = () => isNative() && cap()?.getPlatform?.() === "ios";

// ---------- Sign in with Apple (iOS app) ----------

type AppleResult = { identityToken: string; givenName?: string; familyName?: string; email?: string };

export async function signInWithApple(): Promise<{ onboarded: boolean } | null> {
  const { registerPlugin } = await import("@capacitor/core");
  const plugin = registerPlugin<{ authorize(opts: { nonce: string }): Promise<AppleResult> }>("TarrowAppleSignIn");
  const nonce = [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, "0")).join("");
  // Apple embeds SHA-256(nonce) in the token; the server checks it against the raw nonce.
  const hashed = [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(nonce)))].map((b) => b.toString(16).padStart(2, "0")).join("");
  let res: AppleResult;
  try {
    res = await plugin.authorize({ nonce: hashed });
  } catch (err) {
    const e = err as { code?: string; message?: string };
    if (e.code === "CANCELLED" || /cancel/i.test(e.message ?? "")) return null;
    throw err;
  }
  let timezone = "America/New_York";
  try {
    timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || timezone;
  } catch {}
  return api<{ onboarded: boolean }>("/api/auth/apple", { body: { identityToken: res.identityToken, nonce, givenName: res.givenName, familyName: res.familyName, timezone } });
}

// ---------- Push notifications (iOS app, APNs) ----------

let listenersReady = false;

async function pushPlugin() {
  const { PushNotifications } = await import("@capacitor/push-notifications");
  if (!listenersReady) {
    listenersReady = true;
    await PushNotifications.addListener("registration", ({ value }) => {
      try {
        localStorage.setItem("tarrow_apns_token", value);
      } catch {}
      api("/api/push/native", { body: { token: value, platform: "ios" } }).catch(() => {});
    });
    await PushNotifications.addListener("pushNotificationActionPerformed", ({ notification }) => {
      const url = (notification.data as { url?: string } | undefined)?.url;
      if (url && url.startsWith("/")) window.location.href = url;
    });
  }
  return PushNotifications;
}

export type NativePushState = "unsupported" | "prompt" | "granted" | "denied";

export async function nativePushState(): Promise<NativePushState> {
  if (!isIOSApp()) return "unsupported";
  const p = await pushPlugin();
  const { receive } = await p.checkPermissions();
  return receive === "granted" ? "granted" : receive === "denied" ? "denied" : "prompt";
}

/** Every app open: re-registers only if already allowed (never prompts), so the server has a fresh token. */
export async function refreshNativePush() {
  if ((await nativePushState()) === "granted") await (await pushPlugin()).register();
}

/** Asks permission (call from a tap) and registers. */
export async function enableNativePush(): Promise<boolean> {
  if (!isIOSApp()) return false;
  const p = await pushPlugin();
  const { receive } = await p.requestPermissions();
  if (receive !== "granted") return false;
  await p.register();
  return true;
}

export async function unregisterNativePush() {
  if (!isIOSApp()) return;
  let token: string | null = null;
  try {
    token = localStorage.getItem("tarrow_apns_token");
    localStorage.removeItem("tarrow_apns_token");
  } catch {}
  if (token) await api("/api/push/native", { method: "DELETE", body: { token } }).catch(() => {});
}

// ---------- Haptics + share ----------

export async function haptic(kind: "light" | "success" = "light") {
  if (!isNative()) return;
  try {
    const { Haptics, ImpactStyle, NotificationType } = await import("@capacitor/haptics");
    if (kind === "success") await Haptics.notification({ type: NotificationType.Success });
    else await Haptics.impact({ style: ImpactStyle.Light });
  } catch {}
}

/** Native share sheet in the app, Web Share where available, otherwise copies to the clipboard. Returns "copied" for the fallback. */
export async function shareText(text: string, title = "Tarrow"): Promise<"shared" | "copied" | "cancelled"> {
  try {
    if (isNative()) {
      const { Share } = await import("@capacitor/share");
      await Share.share({ title, text });
      return "shared";
    }
    if (navigator.share) {
      await navigator.share({ title, text });
      return "shared";
    }
  } catch {
    return "cancelled";
  }
  await navigator.clipboard.writeText(text);
  return "copied";
}
