"use client";

import { useEffect } from "react";

export function RegisterServiceWorker() {
  useEffect(() => {
    // Skip in dev — intercepting Turbopack's HMR/dev requests with a service
    // worker causes confusing caching behavior while iterating. Test the real
    // service worker with `npm run build && npm run start`.
    if (process.env.NODE_ENV !== "production") return;
    if (!("serviceWorker" in navigator)) return;

    navigator.serviceWorker.register("/sw.js").catch((err) => {
      console.error("Service worker registration failed:", err);
    });
  }, []);

  return null;
}
