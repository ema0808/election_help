"use client";

import { useEffect, useState } from "react";

export type Platform = "ios" | "android" | "other";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

function detectPlatform(): Platform {
  const ua = navigator.userAgent;
  // iPadOS 13+ reports as "MacIntel" in the UA string unless the user has
  // requested the mobile site, so touch-point count is the usual workaround
  // to still catch iPads.
  const isIOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  if (isIOS) return "ios";
  if (/Android/.test(ua)) return "android";
  return "other";
}

function detectStandalone(): boolean {
  const nav = navigator as Navigator & { standalone?: boolean };
  return window.matchMedia("(display-mode: standalone)").matches || nav.standalone === true;
}

/**
 * Wraps the "Add to Home Screen" flow. Android/Chrome exposes a real
 * `beforeinstallprompt` event that lets us trigger the native install dialog
 * from a button tap (`promptInstall`); iOS Safari has no such API at all —
 * it's always a manual Share -> Add to Home Screen flow, so consumers should
 * show instructions for that platform instead of a button.
 */
export function useInstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  // platform/standalone can only be detected client-side (they read
  // navigator/window, unavailable during SSR), so they start at safe
  // SSR-matching defaults and are filled in once this effect runs post-mount
  // — combined into one state object so that fill-in is a single render
  // rather than two.
  const [env, setEnv] = useState<{ platform: Platform; isStandalone: boolean }>({
    platform: "other",
    isStandalone: false,
  });

  useEffect(() => {
    // Detecting the platform requires browser APIs unavailable during SSR,
    // so this can only happen post-mount, not during the lazy useState
    // initializer — a legitimate exception to the rule below.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setEnv({ platform: detectPlatform(), isStandalone: detectStandalone() });

    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };
    const handleAppInstalled = () => {
      setDeferredPrompt(null);
      setEnv((prev) => ({ ...prev, isStandalone: true }));
    };

    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    window.addEventListener("appinstalled", handleAppInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
      window.removeEventListener("appinstalled", handleAppInstalled);
    };
  }, []);

  async function promptInstall() {
    if (!deferredPrompt) return false;
    await deferredPrompt.prompt();
    const choice = await deferredPrompt.userChoice;
    setDeferredPrompt(null);
    return choice.outcome === "accepted";
  }

  return {
    platform: env.platform,
    isStandalone: env.isStandalone,
    canPromptInstall: deferredPrompt !== null,
    promptInstall,
  };
}
