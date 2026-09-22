"use client";

import { useEffect } from "react";

/**
 * Keeps `--app-height` and `--app-offset-top` CSS custom properties in sync
 * with the visual viewport.
 *
 * Mobile Safari has a long-standing quirk: focusing an input scrolls the
 * *layout* viewport to bring it above the keyboard, but `position: fixed`
 * elements stay anchored to the layout viewport's origin rather than
 * following that scroll — so a fixed app shell can end up rendered mostly
 * off-screen (only the bit that happens to overlap the visual viewport is
 * visible), which is exactly the "input jumps under the status bar" bug.
 * `visualViewport.offsetTop` reports how far Safari scrolled the layout
 * viewport away from the visual viewport's origin; applying that as the
 * fixed shell's `top` keeps it glued to whatever's actually visible.
 * `visualViewport.height` handles the keyboard shrinking the visible area.
 *
 * Consumers should position their root shell with
 * `top: var(--app-offset-top, 0px); height: var(--app-height, 100dvh)`.
 * Falls back to a static full-viewport shell where visualViewport isn't
 * available, or before this effect has run.
 */
export function useVisualViewport() {
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;

    const update = () => {
      document.documentElement.style.setProperty("--app-height", `${vv.height}px`);
      document.documentElement.style.setProperty("--app-offset-top", `${vv.offsetTop}px`);
    };

    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
    };
  }, []);
}
