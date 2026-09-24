"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { InstallInstructions } from "@/components/InstallInstructions";
import { Modal } from "@/components/Modal";
import { getKnowledgeBase, type SourceRef } from "@/lib/knowledge-base";
import { useInstallPrompt } from "@/lib/useInstallPrompt";
import { ManualSearchIndex, type SearchResult } from "@/lib/search";
import { useNetworkStatus, type NetworkStatus } from "@/lib/useNetworkStatus";
import { useVisualViewport } from "@/lib/useVisualViewport";

type ChatMessage =
  | { id: string; role: "user"; text: string }
  | { id: string; role: "assistant"; mode: "online"; text: string; sources: SourceRef[] }
  | { id: string; role: "assistant"; mode: "offline"; results: SearchResult[] }
  | { id: string; role: "assistant"; mode: "notice"; text: string };

const OFFLINE_RESULT_LIMIT = 5;

// Matches the settle re-checks in useVisualViewport — the keyboard (and on
// iOS, its QuickType bar) keeps resizing the visible area for a moment after
// it starts opening, so scrolling to bottom needs a few follow-up attempts
// to land correctly once the container has actually finished shrinking.
const SCROLL_SETTLE_DELAYS_MS = [50, 150, 300, 500];

export default function ChatPage() {
  useVisualViewport();
  const status = useNetworkStatus();
  const { isStandalone } = useInstallPrompt();
  const [showInstallModal, setShowInstallModal] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const searchIndexRef = useRef<ManualSearchIndex | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Warm up the offline search index as soon as the app loads, while we're
  // (hopefully) still online — so it's already available the moment the
  // device actually goes offline, rather than needing a fetch at that point.
  useEffect(() => {
    getKnowledgeBase()
      .then((kb) => {
        searchIndexRef.current = new ManualSearchIndex(kb);
      })
      .catch(() => {
        // best-effort warm-up; a real error surfaces per-query if it still fails later
      });
  }, []);

  function scrollToBottom(behavior: ScrollBehavior = "smooth") {
    bottomRef.current?.scrollIntoView({ behavior });
  }

  function scrollToBottomWhileKeyboardSettles() {
    scrollToBottom("auto");
    SCROLL_SETTLE_DELAYS_MS.forEach((delay) => setTimeout(() => scrollToBottom("auto"), delay));
  }

  useEffect(() => {
    scrollToBottom();
  }, [messages, isLoading]);

  async function runOfflineSearch(question: string) {
    try {
      if (!searchIndexRef.current) {
        const kb = await getKnowledgeBase();
        searchIndexRef.current = new ManualSearchIndex(kb);
      }
      const results = searchIndexRef.current.search(question, OFFLINE_RESULT_LIMIT);
      setMessages((m) => [...m, { id: crypto.randomUUID(), role: "assistant", mode: "offline", results }]);
    } catch {
      setMessages((m) => [
        ...m,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          mode: "notice",
          text: "Baza znanja nije dostupna offline. Posjetite aplikaciju barem jednom dok ste povezani na internet.",
        },
      ]);
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const question = input.trim();
    if (!question || isLoading) return;

    setInput("");
    setMessages((m) => [...m, { id: crypto.randomUUID(), role: "user", text: question }]);
    setIsLoading(true);

    try {
      if (status !== "offline") {
        try {
          const res = await fetch("/api/ask", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ question }),
          });
          if (!res.ok) throw new Error("ask-failed");
          const data: { answer: string; sources: SourceRef[] } = await res.json();
          setMessages((m) => [
            ...m,
            { id: crypto.randomUUID(), role: "assistant", mode: "online", text: data.answer, sources: data.sources },
          ]);
          return;
        } catch {
          setMessages((m) => [
            ...m,
            {
              id: crypto.randomUUID(),
              role: "assistant",
              mode: "notice",
              text: "Online odgovor trenutno nije dostupan. Prikazujem rezultate lokalne pretrage:",
            },
          ]);
        }
      }
      await runOfflineSearch(question);
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div
      className="fixed inset-x-0 flex flex-col overflow-hidden bg-background text-foreground"
      style={{ top: "var(--app-offset-top, 0px)", height: "var(--app-height, 100dvh)" }}
    >
      <header
        className="flex shrink-0 items-center justify-between border-b border-black/10 px-4 pb-3 dark:border-white/10"
        style={{ paddingTop: "max(0.75rem, env(safe-area-inset-top))" }}
      >
        <div className="flex items-center gap-2">
          <Link href="/" className="text-zinc-400 hover:text-foreground dark:text-zinc-500" aria-label="Početna">
            ←
          </Link>
          <h1 className="text-lg font-semibold">Izbori - Tehnička podrška</h1>
        </div>
        <div className="flex items-center gap-3">
          {!isStandalone && (
            <button
              type="button"
              onClick={() => setShowInstallModal(true)}
              aria-label="Dodaj na početni ekran"
              className="text-zinc-400 hover:text-foreground dark:text-zinc-500"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 3v12m0 0-4-4m4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          )}
          <StatusBadge status={status} />
        </div>
      </header>

      <main className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 py-4">
        {messages.length === 0 && (
          <p className="m-auto max-w-sm text-center text-sm text-zinc-500 dark:text-zinc-400">
            Postavite pitanje o uređaju za identifikaciju birača ili optičkom skeneru za brojanje glasova.
          </p>
        )}
        {messages.map((m) => (
          <MessageBubble key={m.id} message={m} />
        ))}
        {isLoading && (
          <div className="mr-auto max-w-[85%] rounded-2xl rounded-bl-sm bg-zinc-100 px-4 py-2 text-sm text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
            Tražim odgovor…
          </div>
        )}
        <div ref={bottomRef} />
      </main>

      <form
        onSubmit={handleSubmit}
        className="flex shrink-0 gap-2 border-t border-black/10 p-3 dark:border-white/10"
        style={{ paddingBottom: "max(0.75rem, var(--app-keyboard-inset, env(safe-area-inset-bottom)))" }}
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onFocus={scrollToBottomWhileKeyboardSettles}
          placeholder="Postavite pitanje..."
          autoComplete="off"
          disabled={isLoading}
          className="flex-1 rounded-full border border-black/10 bg-transparent px-4 py-2 text-base focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-white/15"
        />
        <button
          type="submit"
          disabled={isLoading || !input.trim()}
          className="rounded-full bg-foreground px-5 py-2 text-sm font-medium text-background disabled:opacity-40"
        >
          Pošalji
        </button>
      </form>

      {showInstallModal && (
        <Modal onClose={() => setShowInstallModal(false)}>
          <InstallInstructions />
        </Modal>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: NetworkStatus }) {
  const config: Record<NetworkStatus, { dot: string; label: string }> = {
    checking: { dot: "bg-zinc-400", label: "Provjera veze…" },
    online: { dot: "bg-green-500", label: "Povezano" },
    offline: { dot: "bg-red-500", label: "Van mreže" },
  };
  const { dot, label } = config[status];
  return (
    <div className="flex items-center gap-1.5 text-xs text-zinc-500 dark:text-zinc-400">
      <span className={`h-2 w-2 rounded-full ${dot}`} />
      {label}
    </div>
  );
}

function MessageBubble({ message }: { message: ChatMessage }) {
  if (message.role === "user") {
    return (
      <div className="ml-auto max-w-[85%] whitespace-pre-line rounded-2xl rounded-br-sm bg-blue-600 px-4 py-2 text-sm text-white">
        {message.text}
      </div>
    );
  }

  if (message.mode === "notice") {
    return (
      <div className="mr-auto max-w-[85%] rounded-2xl rounded-bl-sm border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
        {message.text}
      </div>
    );
  }

  if (message.mode === "online") {
    return (
      <div className="mr-auto flex max-w-[85%] flex-col gap-2">
        <div className="whitespace-pre-line rounded-2xl rounded-bl-sm bg-zinc-100 px-4 py-2 text-sm dark:bg-zinc-800">
          {message.text}
        </div>
        {message.sources.length > 0 && <SourceList sources={message.sources} />}
      </div>
    );
  }

  // offline search results
  if (message.results.length === 0) {
    return (
      <div className="mr-auto max-w-[85%] rounded-2xl rounded-bl-sm bg-zinc-100 px-4 py-2 text-sm dark:bg-zinc-800">
        Nisam pronašao odgovarajući dio priručnika. Pokušajte drugačije formulisati pitanje.
      </div>
    );
  }
  return (
    <div className="mr-auto flex max-w-[85%] flex-col gap-2">
      {message.results.map((r) => (
        <ResultCard key={r.entry.id} result={r} />
      ))}
    </div>
  );
}

function SourceList({ sources }: { sources: SourceRef[] }) {
  return (
    <div className="flex flex-wrap gap-1.5 pl-1">
      {sources.slice(0, 4).map((s, i) => (
        <span
          key={i}
          className="rounded-full border border-black/10 px-2 py-0.5 text-[11px] text-zinc-500 dark:border-white/15 dark:text-zinc-400"
        >
          {s.device} · {s.title}
        </span>
      ))}
    </div>
  );
}

function ResultCard({ result }: { result: SearchResult }) {
  const [expanded, setExpanded] = useState(false);
  const { entry } = result;
  const isLong = entry.content.length > 400;
  const shown = expanded || !isLong ? entry.content : `${entry.content.slice(0, 400)}…`;

  return (
    <div className="rounded-2xl rounded-bl-sm bg-zinc-100 px-4 py-3 text-sm dark:bg-zinc-800">
      <div className="mb-1 flex flex-wrap items-center gap-1.5 text-[11px] text-zinc-500 dark:text-zinc-400">
        <span className="font-medium">{entry.device}</span>
        <span>·</span>
        <span>{entry.section}</span>
      </div>
      <div className="mb-1 font-medium">{entry.title}</div>
      <p className="whitespace-pre-line text-zinc-700 dark:text-zinc-300">{shown}</p>
      {isLong && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-1 text-xs font-medium text-blue-600 dark:text-blue-400"
        >
          {expanded ? "Prikaži manje" : "Prikaži više"}
        </button>
      )}
    </div>
  );
}
