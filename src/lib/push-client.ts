"use client";

import { api } from "./client";

export function pushSupported() {
  if (typeof window === "undefined") return false;
  const native = (window as Window & { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.();
  return !native && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window && !!process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
}

function urlBase64ToUint8Array(base64: string) {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

/** Asks permission (must be called from a user gesture) and registers this browser for push. */
export async function enablePush(): Promise<boolean> {
  if (!pushSupported()) return false;
  const permission = await Notification.requestPermission();
  if (permission !== "granted") return false;
  const reg = await navigator.serviceWorker.register("/sw.js");
  await navigator.serviceWorker.ready;
  const existing = await reg.pushManager.getSubscription();
  const sub = existing ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!) }));
  await api("/api/push", { body: { subscription: sub.toJSON() } });
  return true;
}

export async function pushEnabled(): Promise<boolean> {
  if (!pushSupported() || Notification.permission !== "granted") return false;
  const reg = await navigator.serviceWorker.getRegistration("/sw.js");
  return !!(await reg?.pushManager.getSubscription());
}
