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
- Piši običnim tekstom, bez Markdown formatiranja (bez #, **, tabela). Korake navedi kao obične numerisane linije (npr. "1. ...").`;

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
    .map((e) => `### ${e.device} — ${e.section} — ${e.title}\n${e.content}`)
    .join("\n\n---\n\n");

  const userMessage = `Sadržaj priručnika:\n\n${contextBlock}\n\n---\n\nPitanje operatera: ${question}`;

  try {
    const response = await getClient().messages.create({
      model: MODEL,
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userMessage }],
    });

    const answer = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === "text")
      .map((block) => block.text)
      .join("\n")
      .trim();

    const sources: SourceRef[] = entries
      .slice(0, RELEVANT_CHUNK_LIMIT)
      .map((e) => ({ device: e.device, section: e.section, title: e.title }));

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
