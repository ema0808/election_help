# ElectionHelp

Offline-first PWA for the two technical-support roles (operateri, terenski tehničari) who staff a polling station during Bosnia and Herzegovina's elections. It answers device questions — "how do I clear a paper jam," "how many PIN attempts before lockout" — against the official manuals for the two devices used at a polling station: the voter-identification device (*uređaj za identifikaciju birača*) and the ballot-counting optical scanner (*optički skener za brojanje glasova*). Zero connectivity is the default assumption, not an edge case: a polling station may have no signal at all, so the app has to be fully usable offline and only get smarter when a connection happens to be available.

## Stack

Next.js (App Router, TypeScript), Tailwind CSS, deployed on Vercel. No database — the knowledge base is a static JSON file built once from the source PDFs and shipped with the app.

## Architecture decisions

### Static knowledge base, no runtime PDF parsing

`scripts/build-knowledge-base.mjs` is a one-time, locally-run script: it reads the 4 source manuals from `source-pdfs/` (not committed — see `.gitignore`), extracts text page-by-page with `pdf-parse`, and splits each device's manual into labeled chunks (`{ id, device, section, title, content, pageStart, pageEnd }`) written to `public/knowledge-base.json`. That JSON — not the PDFs — is what ships with the app and what both the client and the API route read from. Rebuilding it is a deliberate, reviewable step (`npm run build:kb`), not something that happens on every request or every deploy.

The chunking logic was built by first dumping raw `pdf-parse` output and reading actual page structure, rather than guessing a regex blind. Manual section headers (`ODJELJAK NN`) mark chunk boundaries; the two troubleshooting manuals additionally get split into one chunk per symptom/problem instead of one chunk per section, since those sections are internally a flat table of unrelated issues.

### Two answer paths: offline search always works, online is an enhancement

- **Offline (default, always available):** `lib/search.ts` runs a client-side fuzzy/keyword search directly over `knowledge-base.json` (via Fuse.js as the underlying fuzzy matcher, see below for the scoring layer built on top of it). No network call, no server. This is precached by the service worker (`public/sw.js`) along with the app shell, so it works from a completely cold, offline load after the first visit.
- **Online (enhancement):** `app/api/ask/route.ts` sends the question plus the most relevant retrieved chunks to Claude (`claude-sonnet-4-6`) with a Bosnian-only, manuals-only system prompt, and returns a synthesized answer. The chat UI (`app/chat/page.tsx`) picks between the two paths automatically based on real connectivity — see below — never asking the operator to toggle anything.

### Real connectivity detection, not `navigator.onLine`

`navigator.onLine` only reflects whether a network interface is up — it stays `true` on a wifi network with no actual internet access, which is common at a polling station. `lib/useNetworkStatus.ts` combines the browser's online/offline events (fast signal) with an actual `fetch` health check against `app/api/health/route.ts` (`Cache-Control: no-store`, `force-dynamic`, so it's never served stale). If a call to `/api/ask` itself fails despite a device reporting "online" (flaky venue wifi), the UI falls back to local search automatically rather than showing a dead end.

### Citations are what the model actually used, not what retrieval found

Early on, the online-mode UI showed 3–4 source chips per answer, most of them irrelevant — the retrieval step's raw candidate list was being presented as if it were the citation list. The fix: each candidate chunk is tagged with its `id` in the context sent to Claude, the response uses structured outputs (`output_config: { format: { type: "json_schema", ... } }`) to return `{ answer, usedSourceIds }` instead of free text, and the system prompt explicitly instructs the model not to list chunks it didn't draw from. Only `usedSourceIds` become the citation chips shown in the UI. See the failure story at the end of this document for the full debugging path.

### Search scoring: BM25-style, not naive TF-IDF-sum

`lib/search.ts` fuzzy-matches each query word against the corpus (Fuse.js), applies IDF weighting so words that appear in nearly every chunk (device names, generic terms) don't drown out genuinely distinguishing words, and folds Bosnian diacritics plus common Bosnian verb-noun suffix pairs (*sklopiti* / *sklapanje*) so an operator's natural phrasing matches the manual's phrasing. An early version normalized each chunk's score by the *sum* of the whole query's matched-word weight, which structurally punished a single highly-specific, correct match whenever the query also contained other words that happened to weakly match *different* chunks. It was rebuilt as an unnormalized, saturating per-word accumulation (BM25's actual approach) instead — a real match no longer needs near-total query coverage to win.

### Offline-first means the service worker owns caching, not the browser default

`public/sw.js` is hand-rolled rather than generated by a framework plugin, because this project builds with Turbopack and a webpack-based precache-manifest generator isn't a reliable fit. It precaches the few URLs known ahead of time (app shell routes, `knowledge-base.json`, manifest, icons) and caches everything else same-origin opportunistically on first successful fetch (network-first, cache fallback) — so after one visit, every asset that page actually loaded is available offline too. `/api/*` is explicitly excluded, so `/api/health` stays a real connectivity probe and `/api/ask` never serves a stale answer.

### Mobile chat UX: a real app shell, not a scrollable page

The chat screen is `position: fixed` with only the message list scrolling — `html`/`body` themselves never scroll — so the header and input bar behave like native app chrome instead of drifting when the on-screen keyboard opens. `lib/useVisualViewport.ts` tracks `visualViewport.offsetTop`/`height` into CSS custom properties, because iOS Safari scrolls the *layout* viewport to bring a focused input into view without moving `position: fixed` elements the same way, which otherwise strands a fixed shell mostly off-screen the moment the keyboard opens.

### Chat history persists locally, nothing server-side

`lib/useChatHistory.ts` mirrors a message list to `localStorage` (capped at the most recent ~100 messages, since offline search results can embed multi-KB manual excerpts) so a conversation survives a reload or app relaunch. There's no backend session or database — this is purely a client-side convenience, consistent with the rest of the app's no-database design.

### Eval set for the one Claude-powered flow

`evals/ask-quality/` measures `/api/ask` — the only flow that calls Claude — against 20 cases sourced from a real operator FAQ, graded two ways: a deterministic check that the response cites the correct manual chunk(s), and an LLM-judge (`claude-haiku-4-5`) pass checking the answer is actually grounded in whatever it cited and, for the deliberately-out-of-scope cases, that it's transparent about what isn't covered rather than fabricating. The runner calls the real running `/api/ask` endpoint rather than reconstructing the Claude request, so the eval exercises the actual retrieval + prompt + parsing path. Baseline: 100% grounded (zero fabrication across all 20 cases, including genuine knowledge-base gaps), 75% correct citation — the misses are known, diagnosed retrieval limitations (see `.claude/hillclimb/ask-quality/report.html`).

---

## Failure Story: Citations Showing Wrong Sources

**Symptom:** For device-setup questions, the UI showed 3-4 source chips, but only one section actually contained the answer. The extra chips looked like a retrieval ranking bug — irrelevant chunks outranking the right one.

**Initial hypothesis (wrong):** Treated it as a ranking problem and tuned retrieval scoring. This didn't fix it, because the diagnosis was wrong.

**Actual root cause:** The chips were rendering raw retrieval candidates, not citations. Any chunk mentioning the same device name got surfaced, whether or not Claude actually used it to answer. Ranking was never the bug — the system had no concept of "used to answer" versus "retrieved."

### Fix

- Tagged each chunk with an `id` in the context sent to the model.
- Switched `/api/ask` to structured outputs (JSON schema) so the response is `{ answer, usedSourceIds }` instead of free text.
- System prompt explicitly instructs the model not to list sections it didn't draw from, even if they mention the same device.
- Only `usedSourceIds` render as chips.

**Edge case caught during testing:** when the manuals don't cover a question, the model correctly returns an empty `usedSourceIds` list. My first fallback logic mistook "empty" for "failed" and substituted 3 irrelevant sources, which was worse than showing none. Fixed by treating empty as meaningful and only falling back on genuinely unparseable responses (e.g. truncation).

### Verification, not assumption

- Confirmed structured outputs work on this SDK/model combo by testing in isolation with a deliberate decoy source before shipping.
- Ran targeted cases: assembly (1 source, correct), PIN limits (2 sources, correctly spanning both devices), paper jam (2), off-topic (0).

**Result:** For the query that surfaced the bug, sources went from 4 chips to the 1 that was actually used (Fizičko sklapanje, str. 2-7).

### Lesson

Retrieval quality and citation faithfulness are separate problems. A search-relevance fix can be entirely correct and still not fix a bug that lives in how results are presented as "sources" downstream.
