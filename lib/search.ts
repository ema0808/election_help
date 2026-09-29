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

// Bosnian verbal nouns ("-anje/-enje", roughly English "-ing") are common as
// manual section titles ("sklapanje", "uključivanje", "instaliranje"), while
// an operator naturally asks "kako sklopiti/uključiti/instalirati..." using
// the infinitive. These can differ enough character-by-character — including
// a stem vowel alternation for some verbs, e.g. sklOPiti vs sklAPanje — that
// Fuse's fuzzy matching misses the connection entirely on the full word.
// Stripping these common suffix groups down to a shared root and searching
// that too (alongside the original word, not instead of it) recovers most of
// these pairs without a hand-maintained synonym list.
const STEM_SUFFIXES = ["ivanje", "ovanje", "anje", "enje", "ivati", "ovati", "jeti", "ati", "iti"];

function stem(word: string): string | null {
  for (const suffix of STEM_SUFFIXES) {
    if (word.length >= suffix.length + 4 && word.endsWith(suffix)) {
      return word.slice(0, -suffix.length);
    }
  }
  return null;
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
  private totalEntries: number;

  constructor(entries: KnowledgeBaseEntry[]) {
    const indexed: IndexedEntry[] = entries.map((entry) => ({
      entry,
      title: normalizeBosnian(entry.title),
      content: normalizeBosnian(entry.content),
    }));
    this.fuse = new Fuse(indexed, FUSE_OPTIONS);
    this.totalEntries = entries.length;
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

    const MIN_WORD_RELEVANCE = 0.32; // per-word floor — see the comment below
    const relevanceById = new Map<string, { entry: KnowledgeBaseEntry; total: number }>();
    let idfSum = 0;
    for (const word of words) {
      const stemmed = stem(word);
      const candidates = stemmed ? [word, stemmed] : [word];

      // A word and its stemmed root both search the same entries, so keep
      // only the *best* relevance per entry across candidate forms — summing
      // them would double-count what's conceptually one query term.
      const bestByEntry = new Map<string, { entry: KnowledgeBaseEntry; relevance: number }>();
      for (const candidate of candidates) {
        for (const r of this.fuse.search(candidate)) {
          const relevance = 1 - (r.score ?? 1);
          // A weak match (e.g. an unrelated word that happens to share a
          // few characters with something) shouldn't count as a match at
          // all — otherwise the IDF boost below (meant to reward genuinely
          // rare, specific terms) ends up amplifying noise instead, since a
          // coincidental one-off match is *also* technically "rare".
          if (relevance < MIN_WORD_RELEVANCE) continue;
          const existing = bestByEntry.get(r.item.entry.id);
          if (!existing || relevance > existing.relevance) {
            bestByEntry.set(r.item.entry.id, { entry: r.item.entry, relevance });
          }
        }
      }
      if (bestByEntry.size === 0) continue;

      // Device/manual names (e.g. "uređaj", "identifikaciju", "birača") are
      // repeated in nearly every chunk, so without down-weighting they'd
      // swamp genuinely distinguishing words like "sklopiti" and make
      // unrelated chunks score almost as high as the right one. Smoothed
      // IDF: a word matching most of the corpus gets a multiplier near 1x,
      // a word matching only a handful of chunks gets several times that.
      const idf = Math.log((this.totalEntries + 1) / (bestByEntry.size + 1)) + 1;
      idfSum += idf;

      for (const { entry, relevance } of bestByEntry.values()) {
        const weighted = relevance * idf;
        const existing = relevanceById.get(entry.id);
        if (existing) {
          existing.total += weighted;
        } else {
          relevanceById.set(entry.id, { entry, total: weighted });
        }
      }
    }
    if (idfSum === 0) return [];

    const MIN_RELEVANCE = 0.15; // below this, matches are noise (e.g. unrelated queries)
    return [...relevanceById.values()]
      // Normalize by total possible idf-weighted relevance (idfSum), not
      // word count — each word's max contribution is now `idf`, not 1.
      .map(({ entry, total }) => ({ entry, score: Math.min(total / idfSum, 1) }))
      .filter((r) => r.score >= MIN_RELEVANCE)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }
}
