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

// Short Bosnian function words (pronouns, conjunctions, prepositions,
// interrogatives) carry essentially no topical signal, but Fuse's fuzzy
// matching is unreliable for 2-3 letter patterns against long content
// strings — a pattern this short can spuriously "fuzzy-match" almost any
// chunk with deceptively high relevance (observed: "se" scoring 0.81 against
// an unrelated chunk). Filtered out before matching rather than relying on
// the relevance floor below, since the spurious scores clear that floor too.
const STOPWORDS = new Set([
  "se", "je", "da", "na", "za", "ne", "su", "li", "od", "do", "iz", "sa", "ka", "ko",
  "ce", "bi", "ili", "pa", "kao", "sto", "sta", "kako", "koji", "koja", "koje",
  "ovaj", "ova", "ovo", "taj", "ta", "to", "onaj", "ona", "ono", "biti",
  "jesam", "jesi", "jesmo", "jeste", "jesu", "moci", "ali", "vec", "jos",
  "samo", "kad", "kada", "gdje", "zasto", "koliko", "kome", "koga", "kojoj", "kojim",
]);

// Strips leading/trailing punctuation a query word picks up from natural
// sentence phrasing (a trailing "?" on the last word of a question was
// silently turning it into a near-unmatchable literal pattern).
function stripPunctuation(word: string): string {
  return word.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
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
   * word is matched independently against the corpus, and per-entry scores
   * are accumulated as a BM25-style sum of independent, saturating per-word
   * contributions — *not* normalized by the query's total matched weight.
   *
   * That normalization was tried first and reliably broke on two patterns,
   * caught by an eval's oracle sanity check against real operator questions:
   *   - A single highly-specific, correct word match (e.g. "baterija", which
   *     only occurs in 2 of 94 chunks) would get diluted into irrelevance by
   *     several other query words that each weakly matched *other* chunks —
   *     dividing by "how much of the query matched anywhere" punishes a
   *     precise hit just for coexisting with generic words in a full sentence.
   *   - A word that's both highly relevant to the correct chunk AND common
   *     across a topic family (e.g. "dijagnostiku" spanning ~28 diagnostics
   *     chunks) got its IDF crushed by that family size, even on the one
   *     chunk where it was the single best, correct signal.
   * BM25's per-term score is independent of what else matched, and TF is
   * saturated (via k1) rather than divided away, so a strong single match can
   * win outright instead of needing near-complete query coverage.
   */
  search(query: string, limit = 5): SearchResult[] {
    const words = normalizeBosnian(query)
      .toLowerCase()
      .split(/\s+/)
      .map((w) => stripPunctuation(w.trim()))
      .filter((w) => w.length >= 2 && !STOPWORDS.has(w));
    if (words.length === 0) return [];

    const MIN_WORD_RELEVANCE = 0.32; // per-word floor — see the comment below
    const K1 = 1.5; // BM25 term-frequency saturation constant (standard default range 1.2–2.0)
    const scoreById = new Map<string, { entry: KnowledgeBaseEntry; total: number }>();

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
          // all — a coincidental one-off match is also technically "rare",
          // so without this floor the IDF term below would amplify noise
          // exactly as readily as it rewards genuinely specific terms.
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

      for (const { entry, relevance } of bestByEntry.values()) {
        // BM25's saturating TF term, substituting Fuse's fuzzy relevance
        // (0–1) for a true term count: contribution grows with relevance but
        // flattens out rather than scaling linearly, so one very strong
        // match can't be arbitrarily outweighed by summing several
        // middling ones the way a linear sum would allow.
        const termScore = idf * ((relevance * (K1 + 1)) / (relevance + K1));
        const existing = scoreById.get(entry.id);
        if (existing) {
          existing.total += termScore;
        } else {
          scoreById.set(entry.id, { entry, total: termScore });
        }
      }
    }
    if (scoreById.size === 0) return [];

    // Normalized against the best-scoring entry *in this result set* (not a
    // query-wide theoretical ceiling that assumes every word must match —
    // that was the source of the bug above), so scores stay a well-behaved
    // 0–1 range for the MIN_RELEVANCE filter and any UI display.
    const maxScore = Math.max(...[...scoreById.values()].map((v) => v.total));
    const MIN_RELEVANCE = 0.1; // below this, matches are noise (e.g. unrelated queries)
    return [...scoreById.values()]
      .map(({ entry, total }) => ({ entry, score: total / maxScore }))
      .filter((r) => r.score >= MIN_RELEVANCE)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }
}
