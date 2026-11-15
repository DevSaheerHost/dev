import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import { headers } from "next/headers";
import { ToastProvider } from "@/components/ui/toast";
import { ServiceWorkerRegistration } from "@/components/pwa/sw-register";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });

export const metadata: Metadata = {
  title: { default: "StockPilot AI", template: "%s · StockPilot AI" },
  description: "Your Inventory. Just a Conversation Away. Voice and photo inventory management for independent stores.",
  applicationName: "StockPilot AI",
  appleWebApp: { capable: true, title: "StockPilot", statusBarStyle: "default" },
  icons: { apple: "/icons/apple-touch-icon.png" },
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f6f7f9" },
    { media: "(prefers-color-scheme: dark)", color: "#0b0d12" },
  ],
};

// Applies the saved theme before paint (no flash). Runs under the CSP nonce.
const themeScript = `try{var t=localStorage.getItem("sp-theme");if(t==="light"||t==="dark")document.documentElement.dataset.theme=t}catch(e){}`;

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script nonce={nonce} dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className={`${inter.variable} min-h-dvh antialiased`}>
        <ToastProvider>{children}</ToastProvider>
        <ServiceWorkerRegistration />
      </body>
    </html>
  );
}
