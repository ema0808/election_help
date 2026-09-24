"use client";

import type { ReactNode } from "react";

export function Modal({ onClose, children }: { onClose: () => void; children: ReactNode }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-2xl bg-background p-4 text-foreground shadow-xl"
        onClick={(e) => e.stopPropagation()}
        style={{ paddingBottom: "max(1rem, env(safe-area-inset-bottom))" }}
      >
        <div className="mb-2 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            aria-label="Zatvori"
            className="rounded-full p-1 text-zinc-400 hover:text-foreground"
          >
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
