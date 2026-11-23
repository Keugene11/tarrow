import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Tarrow",
    short_name: "Tarrow",
    description: "An AI agent that knows your life and does the work.",
    start_url: "/c/new",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#ffffff",
    icons: [{ src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" }],
  };
}
