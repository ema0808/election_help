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
 * Also sets `--app-keyboard-inset`: 0px while the on-screen keyboard is open
 * (detected as the visual viewport being meaningfully shorter than the
 * layout viewport), otherwise `env(safe-area-inset-bottom)`. The keyboard
 * itself is already the bottom edge once open — adding the home-indicator
 * safe-area padding on top of that leaves a gap above the keyboard, it
 * should only apply when the input bar is really sitting above the home
 * indicator.
 *
 * Consumers should position their root shell with
 * `top: var(--app-offset-top, 0px); height: var(--app-height, 100dvh)`, and
 * their bottom-padded elements with
 * `padding-bottom: max(<base>, var(--app-keyboard-inset, env(safe-area-inset-bottom)))`.
 * Falls back to a static full-viewport shell where visualViewport isn't
 * available, or before this effect has run.
 */
// iOS fires visualViewport "resize" as soon as the keyboard *starts*
// animating in, before its QuickType predictive-text bar has finished being
// added to the layout — so the first event's height can be a bit taller
// than the keyboard's final size, leaving a gap above it. These are extra
// re-checks scheduled after each event to catch that late settling.
const SETTLE_DELAYS_MS = [50, 150, 300, 500];

export function useVisualViewport() {
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;

    const apply = () => {
      document.documentElement.style.setProperty("--app-height", `${vv.height}px`);
      document.documentElement.style.setProperty("--app-offset-top", `${vv.offsetTop}px`);
      const keyboardOpen = window.innerHeight - vv.height > 100;
      document.documentElement.style.setProperty(
        "--app-keyboard-inset",
        keyboardOpen ? "0px" : "env(safe-area-inset-bottom)",
      );
    };

    let timers: ReturnType<typeof setTimeout>[] = [];
    const update = () => {
      apply();
      timers.forEach(clearTimeout);
      timers = SETTLE_DELAYS_MS.map((delay) => setTimeout(apply, delay));
    };

    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    return () => {
      timers.forEach(clearTimeout);
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
    };
  }, []);
}
