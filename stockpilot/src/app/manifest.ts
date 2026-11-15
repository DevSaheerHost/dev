import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "StockPilot AI",
    short_name: "StockPilot",
    description: "Your Inventory. Just a Conversation Away.",
    id: "/",
    start_url: "/dashboard",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#f6f7f9",
    theme_color: "#3b35a6",
    categories: ["business", "productivity"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "Voice audit", url: "/voice", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
      { name: "Photo audit", url: "/photo", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
    ],
  };
}
