import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";
import { getKnowledgeBaseServer } from "@/lib/knowledge-base-server";
import type { SourceRef } from "@/lib/knowledge-base";
import { ManualSearchIndex } from "@/lib/search";

const MODEL = "claude-sonnet-4-6";
const MAX_QUESTION_LENGTH = 2000;
const RELEVANT_CHUNK_LIMIT = 8;

const SYSTEM_PROMPT = `Ti si asistent za tehničku podršku operaterima na biračkom mjestu koji rade na dan izbora u Bosni i Hercegovini. Pomažeš im da brzo pronađu rješenje u priručnicima za uređaj za identifikaciju birača i optički skener za brojanje glasova.

Pravila:
- Odgovaraj isključivo na bosanskom jeziku.
- Odgovaraj isključivo na osnovu sadržaja priručnika koji ti je dostavljen u nastavku poruke. Ne izmišljaj korake niti se oslanjaj na opće znanje o izbornim uređajima koje nije navedeno u tekstu.
- Ako dostavljeni sadržaj priručnika ne pokriva postavljeno pitanje, jasno to reci (npr. "Priručnici koje imam ne sadrže informacije o ovome.") i predloži da se operater obrati tehničkoj podršci.
- Budi kratak, jasan i praktičan — operateri ovo čitaju pod vremenskim pritiskom na biračkom mjestu, često nasred rješavanja problema.
- Kada je relevantno, navedi konkretne korake iz priručnika, po redoslijedu.
- Piši običnim tekstom, bez Markdown formatiranja (bez #, **, tabela). Korake navedi kao obične numerisane linije (npr. "1. ...").

Format odgovora:
- Polje "answer" sadrži tvoj odgovor operateru.
- Polje "usedSourceIds" sadrži isključivo ID-eve onih odjeljaka (označenih kao "[id: ...]") iz kojih si stvarno preuzeo informacije za svoj odgovor. Nemoj navoditi odjeljke koje nisi koristio, čak i ako se odnose na isti uređaj. Ako nijedan odjeljak ne pokriva pitanje, ostavi listu praznom.`;

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
  const index = new ManualSearchIndex(knowledgeBase);
  const results = index.search(question, RELEVANT_CHUNK_LIMIT);

  // Local fuzzy search found nothing above the relevance floor — fall back to
  // the full knowledge base (~27K tokens) so Claude's own understanding of
  // the question can still find the right section, rather than answering
  // with zero context.
  const entries = results.length > 0 ? results.map((r) => r.entry) : knowledgeBase;

  const contextBlock = entries
    .map((e) => `### [id: ${e.id}] ${e.device} — ${e.section} — ${e.title}\n${e.content}`)
    .join("\n\n---\n\n");

  const userMessage = `Sadržaj priručnika:\n\n${contextBlock}\n\n---\n\nPitanje operatera: ${question}`;

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
    const sourceEntries = parsed ? cited : entries.slice(0, RELEVANT_CHUNK_LIMIT);

    const sources: SourceRef[] = sourceEntries.map((e) => ({
      device: e.device,
      section: e.section,
      title: e.title,
      pageStart: e.pageStart,
      pageEnd: e.pageEnd,
    }));

    return NextResponse.json({ answer, sources });
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
