"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { applyTheme, getThemePref, THEME_COLORS } from "@/lib/theme";
import { refreshNativePush } from "@/lib/native";
import { installAppHeight, nativeKeyboardHidden, nativeKeyboardShown } from "@/lib/viewport";

type CapWindow = Window & { Capacitor?: { isNativePlatform?: () => boolean; getPlatform?: () => string } };

/** Native-shell niceties when running inside the iOS/Android app. No-op on the web. */
export function NativeBridge() {
  const router = useRouter();

  useEffect(() => installAppHeight(), []);

  // "System" theme follows the OS setting live.
  useEffect(() => {
    const mq = matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => getThemePref() === "system" && applyTheme("system");
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    const cap = (window as CapWindow).Capacitor;
    if (!cap?.isNativePlatform?.()) return;
    document.documentElement.dataset.native = cap.getPlatform?.() ?? "native";
    const cleanups: (() => void)[] = [];

    (async () => {
      const [{ SplashScreen }, { StatusBar, Style }, { App }, { Browser }] = await Promise.all([
        import("@capacitor/splash-screen"),
        import("@capacitor/status-bar"),
        import("@capacitor/app"),
        import("@capacitor/browser"),
      ]);
      SplashScreen.hide({ fadeOutDuration: 200 }).catch(() => {});
      refreshNativePush().catch(() => {});
      // Style.Dark = light status bar text (for the dark theme), Style.Light = dark text.
      const syncStatusBar = () => {
        const dark = document.documentElement.dataset.theme === "dark";
        StatusBar.setStyle({ style: dark ? Style.Dark : Style.Light }).catch(() => {});
        if (cap.getPlatform?.() === "android") StatusBar.setBackgroundColor({ color: dark ? THEME_COLORS.dark : THEME_COLORS.light }).catch(() => {});
      };
      syncStatusBar();
      window.addEventListener("tarrow-theme", syncStatusBar);
      cleanups.push(() => window.removeEventListener("tarrow-theme", syncStatusBar));

      // Open external links in an in-app browser sheet instead of leaving the app.
      const onClick = (e: MouseEvent) => {
        const a = (e.target as HTMLElement)?.closest?.("a") as HTMLAnchorElement | null;
        if (!a || !a.href) return;
        let url: URL;
        try {
          url = new URL(a.href);
        } catch {
          return;
        }
        // .ics files need the system browser sheet, which hands them to Calendar.
        if (url.origin === window.location.origin && !url.pathname.startsWith("/api/ics")) return;
        if (!/^https?:$/.test(url.protocol)) return; // mailto:, sms: etc. go to the OS
        e.preventDefault();
        Browser.open({ url: url.toString() }).catch(() => window.open(url.toString(), "_blank"));
      };
      document.addEventListener("click", onClick, true);
      cleanups.push(() => document.removeEventListener("click", onClick, true));

      // Some WebViews (edge-to-edge Android) don't resize for the keyboard; make up the difference.
      const { Keyboard } = await import("@capacitor/keyboard");
      let heightBefore = window.visualViewport?.height ?? window.innerHeight;
      const kbWill = await Keyboard.addListener("keyboardWillShow", () => {
        heightBefore = window.visualViewport?.height ?? window.innerHeight;
      });
      const kbDid = await Keyboard.addListener("keyboardDidShow", ({ keyboardHeight }) => nativeKeyboardShown(heightBefore, keyboardHeight));
      const kbHide = await Keyboard.addListener("keyboardDidHide", nativeKeyboardHidden);
      cleanups.push(() => [kbWill, kbDid, kbHide].forEach((l) => l.remove()));

      const back = await App.addListener("backButton", ({ canGoBack }) => {
        if (canGoBack && window.location.pathname !== "/c/new") window.history.back();
        else App.minimizeApp().catch(() => {});
      });
      cleanups.push(() => back.remove());

      // Google sign-in returns from the system browser via tarrow://auth?code=…
      const deepLink = await App.addListener("appUrlOpen", ({ url }) => {
        // Gmail connect (Settings) also runs in the system browser and returns via tarrow://gmail?status=…
        if (url.startsWith("tarrow://gmail")) {
          const status = new URL(url.replace("tarrow://", "https://tarrow.invalid/")).searchParams.get("status") ?? "failed";
          Browser.close().catch(() => {});
          router.push(`/settings?gmail=${encodeURIComponent(status)}`);
          return;
        }
        if (!url.startsWith("tarrow://auth")) return;
        const code = new URL(url.replace("tarrow://", "https://tarrow.invalid/")).searchParams.get("code") ?? "";
        const verifier = localStorage.getItem("tarrow_google_verifier") ?? "";
        localStorage.removeItem("tarrow_google_verifier");
        Browser.close().catch(() => {});
        window.location.href = `/api/auth/native?code=${encodeURIComponent(code)}&verifier=${encodeURIComponent(verifier)}`;
      });
      cleanups.push(() => deepLink.remove());

      // Coming back to the app: refresh server data (runs may have finished in the background).
      const resume = await App.addListener("resume", () => {
        router.refresh();
        refreshNativePush().catch(() => {});
      });
      cleanups.push(() => resume.remove());
    })();

    return () => cleanups.forEach((fn) => fn());
  }, [router]);

  return null;
}
