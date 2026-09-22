import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { RegisterServiceWorker } from "./register-sw";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Izbori - Tehnička podrška",
  description: "Tehnička podrška za izborne uređaje — radi i bez interneta.",
  manifest: "/manifest.json",
  icons: {
    icon: [
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Tehnička podrška",
  },
  other: {
    // Next only emits the modern "mobile-web-app-capable" tag; older iOS
    // Safari versions only recognize this legacy Apple-prefixed one.
    "apple-mobile-web-app-capable": "yes",
  },
};

export const viewport: Viewport = {
  themeColor: "#1D407A",
  // On supporting browsers (Chrome/Android, iOS 17.4+), shrinks the visual
  // viewport when the on-screen keyboard opens instead of overlaying it, so
  // a dvh-based layout naturally keeps the input bar above the keyboard.
  interactiveWidget: "resizes-content",
  // Lets fixed/pinned elements (the chat header and input bar) extend under
  // the iPhone notch/home-indicator safe areas, which is required for the
  // env(safe-area-inset-*) padding used to keep content clear of them.
  viewportFit: "cover",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="bs"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        {children}
        <RegisterServiceWorker />
      </body>
    </html>
  );
}
