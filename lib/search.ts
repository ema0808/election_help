import Fuse, { type IFuseOptions } from "fuse.js";
import type { KnowledgeBaseEntry } from "./knowledge-base";

export interface SearchResult {
  entry: KnowledgeBaseEntry;
  /** Relevance, 0 (no match) to 1 (best match) — the inverse of Fuse's raw distance score. */
  score: number;
}

// Bosnian volunteers may type on phone keyboards without č/ć/š/ž/đ, so both
// the index and the query are diacritic-folded before matching. The score
// still surfaces the original entry with its correct diacritics.
export function normalizeBosnian(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D");
}

interface IndexedEntry {
  entry: KnowledgeBaseEntry;
  title: string;
  content: string;
}

const FUSE_OPTIONS: IFuseOptions<IndexedEntry> = {
  keys: [
    { name: "title", weight: 2 },
    { name: "content", weight: 1 },
  ],
  includeScore: true,
  threshold: 0.4,
  ignoreLocation: true,
  minMatchCharLength: 2,
};

export class ManualSearchIndex {
  private fuse: Fuse<IndexedEntry>;

  constructor(entries: KnowledgeBaseEntry[]) {
    const indexed: IndexedEntry[] = entries.map((entry) => ({
      entry,
      title: normalizeBosnian(entry.title),
      content: normalizeBosnian(entry.content),
    }));
    this.fuse = new Fuse(indexed, FUSE_OPTIONS);
  }

  /**
   * Natural-language questions ("štampač ne radi") rarely appear verbatim in
   * the manuals, so matching the whole query as a single fuzzy pattern (Fuse's
   * default) tends to miss even when most words are present. Instead, each
   * word is matched independently and per-entry relevance is accumulated
   * across word matches — an entry hit by more query words, and matched more
   * closely, ranks higher.
   */
  search(query: string, limit = 5): SearchResult[] {
    const words = normalizeBosnian(query)
      .split(/\s+/)
      .map((w) => w.trim())
      .filter((w) => w.length >= 2);
    if (words.length === 0) return [];

    const relevanceById = new Map<string, { entry: KnowledgeBaseEntry; total: number }>();
    for (const word of words) {
      for (const r of this.fuse.search(word)) {
        const relevance = 1 - (r.score ?? 1);
        const existing = relevanceById.get(r.item.entry.id);
        if (existing) {
          existing.total += relevance;
        } else {
          relevanceById.set(r.item.entry.id, { entry: r.item.entry, total: relevance });
        }
      }
    }

    const MIN_RELEVANCE = 0.15; // below this, matches are noise (e.g. unrelated queries)
    return [...relevanceById.values()]
      .map(({ entry, total }) => ({ entry, score: Math.min(total / words.length, 1) }))
      .filter((r) => r.score >= MIN_RELEVANCE)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }
}
