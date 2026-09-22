"use client";

import { useEffect } from "react";

/**
 * Keeps a `--app-height` CSS custom property in sync with the visual
 * viewport height. On mobile, opening the on-screen keyboard shrinks the
 * visual viewport but not the layout viewport `100vh`/`100dvh` is normally
 * based on — so a `100dvh`-tall chat layout can end up with its input bar
 * covered by the keyboard instead of sitting above it. Consumers should size
 * their root container with `height: var(--app-height, 100dvh)` so it tracks
 * the visual viewport once JS runs, falling back to `100dvh` before that (or
 * on browsers without the visualViewport API).
 *
 * This is a fallback for the interactiveWidget: "resizes-content" viewport
 * meta set in the root layout — that alone already fixes this on newer
 * Chrome/Android and iOS 17.4+, but not on older Safari.
 */
export function useVisualViewportHeight() {
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;

    const setHeight = () => {
      document.documentElement.style.setProperty("--app-height", `${vv.height}px`);
    };

    setHeight();
    vv.addEventListener("resize", setHeight);
    vv.addEventListener("scroll", setHeight);
    return () => {
      vv.removeEventListener("resize", setHeight);
      vv.removeEventListener("scroll", setHeight);
    };
  }, []);
}
