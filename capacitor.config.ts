import type { CapacitorConfig } from "@capacitor/cli";
import type { KeyboardResize } from "@capacitor/keyboard";

// The native apps are a thin shell around the web app, so web deploys ship to iOS/Android instantly.
// CAP_LIVE=1 CAP_HOST=<lan-ip> points the shell at a local `next dev` for device testing.
const live = process.env.CAP_LIVE === "1";
const host = process.env.CAP_HOST || "192.168.1.10";

const config: CapacitorConfig = {
  appId: "com.tarrow.app",
  appName: "Tarrow",
  webDir: "out",
  server: live
    ? { url: `http://${host}:3000`, cleartext: true }
    : { url: "https://tarrow.vercel.app/home", cleartext: false, errorPath: "error.html" },
  ios: {
    contentInset: "never",
    scheme: "Tarrow",
    backgroundColor: "#ffffff",
  },
  android: {
    backgroundColor: "#ffffff",
    // Push on Android needs Firebase (FCM), which isn't set up yet; keep that plugin out of the Android build.
    includePlugins: ["@capgo/native-purchases", "@capacitor/app", "@capacitor/browser", "@capacitor/haptics", "@capacitor/keyboard", "@capacitor/share", "@capacitor/splash-screen", "@capacitor/status-bar"],
  },
  plugins: {
    SplashScreen: {
      launchAutoHide: true,
      launchShowDuration: 1500,
      backgroundColor: "#ffffff",
      androidScaleType: "CENTER_INSIDE",
      showSpinner: false,
    },
    Keyboard: {
      resize: "native" as KeyboardResize,
      resizeOnFullScreen: true,
    },
    StatusBar: {
      style: "LIGHT",
      backgroundColor: "#ffffff",
      overlaysWebView: false,
    },
  },
};

export default config;
