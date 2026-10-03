import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";
import { getKnowledgeBaseServer } from "@/lib/knowledge-base-server";
import type { KnowledgeBaseEntry, SourceRef } from "@/lib/knowledge-base";
import { ManualSearchIndex } from "@/lib/search";

const MODEL = "claude-sonnet-4-6";
const MAX_QUESTION_LENGTH = 2000;
// Per-source, not a shared total — see retrieveContext() for why a single
// merged ranking doesn't work once the knowledge base spans more than one
// source with different vocabulary (device manuals vs. the operator FAQ).
const PER_SOURCE_CHUNK_LIMIT = 8;

const SYSTEM_PROMPT = `Ti si asistent za tehničku podršku operaterima i terenskim tehničarima na biračkom mjestu koji rade na dan izbora u Bosni i Hercegovini. Pomažeš im da brzo pronađu odgovor u dostupnim izvorima: priručnicima za uređaj za identifikaciju birača i optički skener za brojanje glasova, te u FAQ dokumentu s čestim pitanjima o ulogama, procedurama i radu na biračkom mjestu.

Pravila:
- Odgovaraj isključivo na bosanskom jeziku.
- Odgovaraj isključivo na osnovu sadržaja izvora koji ti je dostavljen u nastavku poruke. Ne izmišljaj korake niti se oslanjaj na opće znanje o izbornim uređajima ili procedurama koje nije navedeno u tekstu.
- Ako dostavljeni sadržaj ne pokriva postavljeno pitanje, jasno to reci (npr. "Dostupni izvori ne sadrže informacije o ovome.") i predloži da se operater obrati tehničkoj podršci.
- Budi kratak, jasan i praktičan — operateri ovo čitaju pod vremenskim pritiskom na biračkom mjestu, često nasred rješavanja problema.
- Kada je relevantno, navedi konkretne korake iz izvora, po redoslijedu.
- Piši običnim tekstom, bez Markdown formatiranja (bez #, **, tabela). Korake navedi kao obične numerisane linije (npr. "1. ...").

Format odgovora:
- Polje "answer" sadrži tvoj odgovor operateru.
- Polje "usedSourceIds" sadrži isključivo ID-eve onih odjeljaka (označenih kao "[id: ...]") iz kojih si stvarno preuzeo informacije za svoj odgovor. Nemoj navoditi odjeljke koje nisi koristio, čak i ako se odnose na istu temu ili uređaj. Ako je tvoj odgovor zasnovan na bilo kakvom sadržaju iz dostupnih izvora, uvijek navedi makar jedan ID — čak i ako si informacije preuzeo iz više odjeljaka odjednom, navedi ih SVE. Praznu listu koristi isključivo kada odgovor ne koristi baš nikakav sadržaj iz dostupnih izvora (npr. kada jasno kažeš da izvori ne pokrivaju pitanje).`;

const ANSWER_SCHEMA = {
  type: "object" as const,
  properties: {
    answer: { type: "string" as const },
    usedSourceIds: { type: "array" as const, items: { type: "string" as const } },
  },
  required: ["answer", "usedSourceIds"],
  additionalProperties: false,
};

/**
 * Structured outputs make the JSON shape reliable, but a truncated response
 * (hitting max_tokens mid-object) still yields unparseable text — fall back
 * to showing the raw text as the answer rather than failing the request.
 */
function parseAnswer(raw: string): { answer: string; usedIds: string[]; parsed: boolean } {
  try {
    const parsed = JSON.parse(raw) as { answer?: unknown; usedSourceIds?: unknown };
    if (typeof parsed.answer !== "string" || !Array.isArray(parsed.usedSourceIds)) {
      return { answer: raw, usedIds: [], parsed: false };
    }
    return {
      answer: parsed.answer.trim(),
      usedIds: parsed.usedSourceIds.filter((id): id is string => typeof id === "string"),
      parsed: true,
    };
  } catch {
    return { answer: raw, usedIds: [], parsed: false };
  }
}

let anthropicClient: Anthropic | null = null;
function getClient(): Anthropic {
  if (!anthropicClient) anthropicClient = new Anthropic();
  return anthropicClient;
}

let manualIndex: ManualSearchIndex | null = null;
let faqIndex: ManualSearchIndex | null = null;
function getSourceIndexes(knowledgeBase: KnowledgeBaseEntry[]) {
  if (!manualIndex || !faqIndex) {
    manualIndex = new ManualSearchIndex(knowledgeBase.filter((e) => e.source === "manual"));
    faqIndex = new ManualSearchIndex(knowledgeBase.filter((e) => e.source === "faq"));
  }
  return { manualIndex, faqIndex };
}

/**
 * Searches the device manuals and the operator FAQ as two independently
 * ranked pools instead of one merged search over all 190 chunks.
 *
 * A single shared ranking seemed fine at first, but a real-world dry run
 * caught it badly undercounting manual content: the FAQ's own questions are
 * phrased as literal questions, so for any query that resembles one of them
 * even loosely, that FAQ chunk's near-exact text match dominates — both by
 * out-ranking manual prose for the few shared context slots, *and* because
 * the search's score normalization is relative to the best match in the
 * whole result set, so one outlier FAQ match compresses every manual
 * chunk's score too, sometimes below the relevance floor entirely. Example
 * caught in testing: "what happens after repeated wrong PINs" retrieved only
 * the FAQ's terse "59 seconds" and never the device manual's fuller answer
 * (a short lockout by default, or 5 minutes specifically after 5 attempts)
 * — the manual chunk never made the cut despite being clearly relevant.
 *
 * Ranking each source against only its own corpus removes that interaction
 * entirely: a source's top matches reflect its own relevance only.
 */
function retrieveContext(knowledgeBase: KnowledgeBaseEntry[], question: string): KnowledgeBaseEntry[] {
  const { manualIndex, faqIndex } = getSourceIndexes(knowledgeBase);
  const manualEntries = manualIndex.search(question, PER_SOURCE_CHUNK_LIMIT).map((r) => r.entry);
  const faqEntries = faqIndex.search(question, PER_SOURCE_CHUNK_LIMIT).map((r) => r.entry);
  return [...manualEntries, ...faqEntries];
}

interface AskRequestBody {
  question?: unknown;
}

export async function POST(request: Request) {
  let body: AskRequestBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Neispravan zahtjev." }, { status: 400 });
  }

  const question = body.question;
  if (typeof question !== "string" || !question.trim()) {
    return NextResponse.json({ error: "Pitanje ne smije biti prazno." }, { status: 400 });
  }
  if (question.length > MAX_QUESTION_LENGTH) {
    return NextResponse.json({ error: "Pitanje je predugačko." }, { status: 400 });
  }

  const knowledgeBase = getKnowledgeBaseServer();
  const retrieved = retrieveContext(knowledgeBase, question);

  // Local fuzzy search found nothing above the relevance floor in either
  // source — fall back to the full knowledge base (~35K tokens) so Claude's
  // own understanding of the question can still find the right section,
  // rather than answering with zero context.
  const entries = retrieved.length > 0 ? retrieved : knowledgeBase;

  const contextBlock = entries
    .map((e) => `### [id: ${e.id}] ${e.device} — ${e.section} — ${e.title}\n${e.content}`)
    .join("\n\n---\n\n");

  const userMessage = `Sadržaj izvora:\n\n${contextBlock}\n\n---\n\nPitanje operatera: ${question}`;

  try {
    const response = await getClient().messages.create({
      model: MODEL,
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userMessage }],
      output_config: { format: { type: "json_schema", schema: ANSWER_SCHEMA } },
    });

    const raw = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === "text")
      .map((block) => block.text)
      .join("")
      .trim();

    const { answer, usedIds, parsed } = parseAnswer(raw);

    // Cite only the sections Claude actually drew from, not everything search
    // retrieved — otherwise an unrelated-but-same-device section (e.g. the
    // login chapter on an assembly question) is presented as if it backed the
    // answer. An empty list is meaningful and preserved: when the answer is
    // "the manuals don't cover this", citing anything would be actively
    // misleading. Only an unparseable response falls back to the retrieved
    // set, so a truncated-but-useful answer still shows something.
    const byId = new Map(entries.map((e) => [e.id, e]));
    const cited = usedIds.map((id) => byId.get(id)).filter((e) => e !== undefined);
    const sourceEntries = parsed ? cited : entries.slice(0, PER_SOURCE_CHUNK_LIMIT * 2);

    const sources: SourceRef[] = sourceEntries.map((e) => ({
      id: e.id,
      device: e.device,
      section: e.section,
      title: e.title,
      pageStart: e.pageStart,
      pageEnd: e.pageEnd,
    }));

    return NextResponse.json({
      answer,
      sources,
      // Diagnostic fields, unused by the chat UI — exposed so the eval runner
      // (evals/ask-quality/) can record real cost/truncation data instead of
      // reconstructing the Claude call itself to get at them.
      model: response.model,
      usage: response.usage,
      stop_reason: response.stop_reason,
    });
  } catch (error) {
    console.error("/api/ask failed:", error);
    if (error instanceof Anthropic.RateLimitError) {
      return NextResponse.json(
        { error: "Servis je trenutno preopterećen. Pokušajte ponovo za koji trenutak." },
        { status: 429 },
      );
    }
    if (error instanceof Anthropic.AuthenticationError) {
      return NextResponse.json({ error: "Greška u konfiguraciji servisa." }, { status: 500 });
    }
    if (error instanceof Anthropic.APIError) {
      return NextResponse.json({ error: "Greška prilikom komunikacije sa servisom." }, { status: 502 });
    }
    return NextResponse.json({ error: "Neočekivana greška." }, { status: 500 });
  }
}
