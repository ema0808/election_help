export interface KnowledgeBaseEntry {
  id: string;
  // "manual" = one of the 4 device manuals; "faq" = the operator FAQ. Used
  // server-side to retrieve each source with its own independently-ranked
  // search rather than one merged ranking — see app/api/ask/route.ts for why
  // (a shared ranking let the FAQ's own near-exact question-phrase matches
  // crowd out richer manual answers, and skew the other group's relative
  // scores besides, since both were normalized against the same best match).
  source: "manual" | "faq";
  device: string;
  section: string;
  title: string;
  content: string;
  pageStart: number;
  pageEnd: number;
}

export interface SourceRef {
  id: string;
  device: string;
  section: string;
  title: string;
  pageStart: number;
  pageEnd: number;
}

let cache: KnowledgeBaseEntry[] | null = null;

/**
 * Fetches the static knowledge base shipped at /public/knowledge-base.json.
 * The service worker precaches this file, so the fetch resolves from cache
 * when offline.
 */
export async function getKnowledgeBase(): Promise<KnowledgeBaseEntry[]> {
  if (cache) return cache;
  const res = await fetch("/knowledge-base.json");
  if (!res.ok) {
    throw new Error(`Failed to load knowledge base: ${res.status}`);
  }
  cache = (await res.json()) as KnowledgeBaseEntry[];
  return cache;
}
