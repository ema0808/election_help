import fs from "node:fs";
import path from "node:path";
import type { KnowledgeBaseEntry } from "./knowledge-base";

let cache: KnowledgeBaseEntry[] | null = null;

/**
 * Server-only counterpart to getKnowledgeBase() in ./knowledge-base.ts.
 * Reads public/knowledge-base.json from disk instead of fetching it, since
 * API routes have no base URL to fetch a relative path against. Next.js's
 * file tracing picks up this static fs.readFileSync path automatically when
 * bundling the route for deployment.
 */
export function getKnowledgeBaseServer(): KnowledgeBaseEntry[] {
  if (cache) return cache;
  const filePath = path.join(process.cwd(), "public", "knowledge-base.json");
  cache = JSON.parse(fs.readFileSync(filePath, "utf8")) as KnowledgeBaseEntry[];
  return cache;
}
