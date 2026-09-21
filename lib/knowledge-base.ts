export interface KnowledgeBaseEntry {
  id: string;
  device: string;
  section: string;
  title: string;
  content: string;
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
