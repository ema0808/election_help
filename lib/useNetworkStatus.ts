"use client";

import { useEffect, useState } from "react";

export type NetworkStatus = "checking" | "online" | "offline";

const HEALTH_CHECK_URL = "/api/health";
const HEALTH_CHECK_TIMEOUT_MS = 4000;
const PERIODIC_CHECK_INTERVAL_MS = 30000;

async function checkHealth(): Promise<boolean> {
  // Fail fast without a network round-trip when the browser already knows
  // there's no interface up.
  if (typeof navigator !== "undefined" && !navigator.onLine) return false;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), HEALTH_CHECK_TIMEOUT_MS);
  try {
    const res = await fetch(HEALTH_CHECK_URL, { cache: "no-store", signal: controller.signal });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * True connectivity status, not just navigator.onLine (which can stay true
 * on a network with no real internet access — e.g. a venue wifi captive
 * portal). Combines the browser's online/offline events for fast feedback
 * with an actual fetch health check to confirm the server is reachable.
 */
export function useNetworkStatus(): NetworkStatus {
  const [status, setStatus] = useState<NetworkStatus>("checking");

  useEffect(() => {
    let cancelled = false;

    const runCheck = async () => {
      const ok = await checkHealth();
      if (!cancelled) setStatus(ok ? "online" : "offline");
    };

    const handleOffline = () => {
      if (!cancelled) setStatus("offline");
    };

    runCheck();
    const intervalId = setInterval(runCheck, PERIODIC_CHECK_INTERVAL_MS);
    window.addEventListener("online", runCheck);
    window.addEventListener("offline", handleOffline);

    return () => {
      cancelled = true;
      clearInterval(intervalId);
      window.removeEventListener("online", runCheck);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  return status;
}
