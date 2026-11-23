import type { Metadata, Viewport } from "next";
import { DM_Sans, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { NativeBridge } from "@/components/NativeBridge";
import { DialogHost } from "@/components/Dialog";
import { THEME_SCRIPT } from "@/lib/theme";

const mono = JetBrains_Mono({ variable: "--font-jetbrains", subsets: ["latin"], weight: ["400", "500", "700"] });
const dmSans = DM_Sans({ variable: "--font-dm-sans", subsets: ["latin"], weight: ["400", "500", "600", "700"] });

export const metadata: Metadata = {
  title: { default: "Tarrow — the agent for your life", template: "%s · Tarrow" },
  description: "Tarrow gets to know your life, then does the work: research, plans, events, reminders and real advice that moves your goals forward.",
  applicationName: "Tarrow",
  appleWebApp: { capable: true, title: "Tarrow", statusBarStyle: "default" },
  openGraph: { title: "Tarrow — the agent for your life", description: "An AI agent that knows your life and does the work.", type: "website" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
  themeColor: "#ffffff",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="light" suppressHydrationWarning className={`${dmSans.variable} ${mono.variable} h-full antialiased`}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="min-h-full">
        <NativeBridge />
        {children}
        <DialogHost />
      </body>
    </html>
  );
}
