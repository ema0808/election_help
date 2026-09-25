"use client";

import { useEffect, useRef, useState } from "react";

const STORAGE_KEY = "electionhelp:chat-history";
// Offline-mode assistant messages can embed several multi-KB manual excerpts
// each, so this caps how much a single long session can grow — enough for a
// full election day of heavy use without approaching mobile browsers'
// (often ~5MB) localStorage quota.
const MAX_STORED_MESSAGES = 100;

/**
 * Persists a message list to localStorage so a conversation survives page
 * reloads, app relaunches, and navigating away and back — a drop-in
 * replacement for `useState<T[]>([])`.
 */
export function useChatHistory<T>() {
  const [messages, setMessages] = useState<T[]>([]);
  const hasRestoredRef = useRef(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        // Restoring persisted history requires localStorage, unavailable
        // during SSR, so this can only happen post-mount — not via a lazy
        // useState initializer, which would also mismatch the server-
        // rendered empty state during hydration.
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setMessages(JSON.parse(raw));
      }
    } catch {
      // corrupt JSON or storage unavailable (e.g. private browsing) — start
      // with an empty conversation rather than crashing
    }
    hasRestoredRef.current = true;
  }, []);

  useEffect(() => {
    if (!hasRestoredRef.current) return; // don't clobber storage before the restore above has run
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(messages.slice(-MAX_STORED_MESSAGES)));
    } catch {
      // storage full or unavailable — history just won't persist this time
    }
  }, [messages]);

  function clearHistory() {
    setMessages([]);
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignore — nothing to clean up if storage was never written
    }
  }

  return { messages, setMessages, clearHistory };
}
