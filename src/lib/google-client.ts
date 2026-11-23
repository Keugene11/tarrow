"use client";

type CapWindow = Window & { Capacitor?: { isNativePlatform?: () => boolean } };

export const googleEnabled = () => process.env.NEXT_PUBLIC_GOOGLE_ENABLED === "1";

const toHex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");

/** Web: full-page OAuth redirect. Native: system browser + tarrow:// deep link, bound to a verifier kept in this webview. */
export async function startGoogleSignIn() {
  let tz = "America/New_York";
  try {
    tz = Intl.DateTimeFormat().resolvedOptions().timeZone || tz;
  } catch {}
  const native = (window as CapWindow).Capacitor?.isNativePlatform?.();
  if (!native) {
    window.location.href = `/api/auth/google?tz=${encodeURIComponent(tz)}`;
    return;
  }
  const verifier = toHex(crypto.getRandomValues(new Uint8Array(32)).buffer);
  const challenge = toHex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
  localStorage.setItem("tarrow_google_verifier", verifier);
  const { Browser } = await import("@capacitor/browser");
  await Browser.open({ url: `${window.location.origin}/api/auth/google?native=1&tz=${encodeURIComponent(tz)}&challenge=${challenge}` });
}
