// One-time build script: PDF manuals -> public/knowledge-base.json
// Run with: npm run build:kb
//
// The 4 manuals share a consistent structure (verified by inspecting raw
// pdf-parse output before writing this):
//   - "ODJELJAK NN" marks a major section, followed by 1-2 title lines.
//   - Section numbers RESET across chapters, so they are not globally unique
//     — chunk identity comes from a running index, not the ODJELJAK number.
//   - The 2 troubleshooting manuals additionally use finer per-item markers
//     inside some sections:
//       * "<Category>\nSimptom Problem Rješenje" (voter ID device manual)
//       * "Osnovno rješavanje problema:\n<Category>\nProblem: ...\nRješenje: ..."
//         (scanner device manual)
//     Both are detected below to split those sections into one chunk per
//     symptom/problem instead of one giant chunk per ODJELJAK.

import fs from "node:fs/promises";
import path from "node:path";
import { PDFParse } from "pdf-parse";

const SRC_DIR = path.resolve(import.meta.dirname, "../source-pdfs");
const OUT_PATH = path.resolve(import.meta.dirname, "../public/knowledge-base.json");

const FILES = [
  {
    file: "01_Uređaj_za_identifikaciju_birača.pdf",
    device: "Uređaj za identifikaciju birača",
    deviceSlug: "identifikacija",
    manual: "Instalacija i podešavanje",
    manualSlug: "instalacija",
  },
  {
    file: "02_Uređaj_za_identifikaciju_birača_troubleshooting.pdf",
    device: "Uređaj za identifikaciju birača",
    deviceSlug: "identifikacija",
    manual: "Otklanjanje poteškoća",
    manualSlug: "troubleshooting",
  },
  {
    file: "03_Optički_skener_za_brojanje_glasova.pdf",
    device: "Optički skener za brojanje glasova",
    deviceSlug: "skener",
    manual: "Instalacija i podešavanje",
    manualSlug: "instalacija",
  },
  {
    file: "04_Optički_skener_za_brojanje_glasova_troubleshooting.pdf",
    device: "Optički skener za brojanje glasova",
    deviceSlug: "skener",
    manual: "Otklanjanje poteškoća",
    manualSlug: "troubleshooting",
  },
];

// Lines that are pure repeated boilerplate (disclaimers, footers, doc-title
// recaps, diagram callout numbers) and carry no searchable meaning.
// The "screens may differ" disclaimer wraps differently depending on where
// pdf-parse's page/line breaks happen to fall (sometimes splitting mid-phrase,
// e.g. "...na dan" / "izbora."), so it's stripped as one cross-line match
// against the raw page text *before* splitting into lines, rather than
// line-by-line. Bounded to 200 chars so the non-greedy match can't run away.
const DISCLAIMER_RE = /(Napomena: Ekrani|Odricanje\s+(od\s+)?odgovornosti)[\s\S]{0,200}?koristiti na dan\s+izbora\.?/gi;

const BOILERPLATE_PATTERNS = [
  /^Napomena: Ekrani/i, // safety net in case a fragment survives the cross-line strip above
  /^Odricanje\s+(od\s+)?odgovornosti/i,
  /koristiti na dan izbora/i,
  /^www\./i,
  /^Copyright ©/i,
  /^Hvala na pažnju/i,
  /Opći izbori u Bosni i Hercegovini 2026/i,
  /^\d{1,2}$/, // bare diagram callout numbers, e.g. a lone "1" or "2"
];

const SECTION_HEADER_RE = /^ODJELJAK\s+(\d+)/i;
const SIMPTOM_TABLE_MARKER = "Simptom Problem Rješenje";
const PROBLEM_CATEGORY_MARKER = "Osnovno rješavanje problema:";
const PROBLEM_ITEM_RE = /^Problem:\s*/;

function isBoilerplate(line) {
  return BOILERPLATE_PATTERNS.some((re) => re.test(line));
}

function truncateAtWord(text, maxLen) {
  if (text.length <= maxLen) return text;
  const cut = text.slice(0, maxLen);
  const lastSpace = cut.lastIndexOf(" ");
  return `${cut.slice(0, lastSpace > 0 ? lastSpace : maxLen)}…`;
}

function extractChunks({ device, manual }, pages) {
  /** @type {{title: string, lines: string[]}[]} */
  const rawChunks = [];
  let current = null;
  let currentSectionNum = null;
  let currentProblemCategory = null;
  let expectCategoryNext = false;

  const flush = () => {
    if (current && current.lines.some((l) => l.trim())) {
      rawChunks.push({ title: current.title, lines: current.lines });
    }
    current = null;
  };

  for (const page of pages) {
    const lines = page.text
      .replace(DISCLAIMER_RE, "")
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .filter((l) => !isBoilerplate(l));

    let idx = 0;

    if (lines.length && SECTION_HEADER_RE.test(lines[0])) {
      flush();
      currentSectionNum = lines[0].match(SECTION_HEADER_RE)[1];
      idx = 1;
      const titleLines = [];
      while (idx < lines.length && titleLines.length < 2 && !/^\d+[\s.)]/.test(lines[idx]) && lines[idx].length < 90) {
        titleLines.push(lines[idx]);
        idx++;
      }
      current = {
        title: titleLines.join(" ") || `Odjeljak ${currentSectionNum}`,
        lines: [],
      };
      currentProblemCategory = null;
      expectCategoryNext = false;
    }

    for (; idx < lines.length; idx++) {
      const line = lines[idx];

      if (!current) continue; // front matter before the first ODJELJAK

      // Voter-ID-device troubleshooting: "<Category>" line immediately
      // followed by the literal table header "Simptom Problem Rješenje".
      if (line === SIMPTOM_TABLE_MARKER) {
        const subTitle = current.lines.pop() || current.title;
        flush();
        current = { title: subTitle, lines: [] };
        continue;
      }

      // Scanner troubleshooting: category running header, e.g.
      // "Osnovno rješavanje problema:" followed by a category name line.
      if (line === PROBLEM_CATEGORY_MARKER) {
        expectCategoryNext = true;
        continue;
      }
      if (expectCategoryNext) {
        currentProblemCategory = line;
        expectCategoryNext = false;
        continue;
      }

      // Scanner troubleshooting: each "Problem: ..." line starts a new
      // self-contained chunk (problem + its "Rješenje:" that follows).
      if (PROBLEM_ITEM_RE.test(line)) {
        flush();
        const excerpt = truncateAtWord(line.replace(PROBLEM_ITEM_RE, ""), 70);
        const title = currentProblemCategory ? `${currentProblemCategory} – ${excerpt}` : excerpt;
        current = { title, lines: [line] };
        continue;
      }

      if (line === current.title) continue; // dedupe repeated running header
      current.lines.push(line);
    }
  }
  flush();

  return rawChunks.map((chunk) => ({
    device,
    manual,
    title: chunk.title,
    content: chunk.lines.join("\n"),
  }));
}

async function main() {
  const knowledgeBase = [];

  for (const meta of FILES) {
    const pdfPath = path.join(SRC_DIR, meta.file);
    const buf = await fs.readFile(pdfPath);
    const parser = new PDFParse({ data: new Uint8Array(buf) });
    const result = await parser.getText();
    await parser.destroy();

    const chunks = extractChunks(meta, result.pages);

    chunks.forEach((chunk, i) => {
      knowledgeBase.push({
        id: `${meta.deviceSlug}-${meta.manualSlug}-${String(i + 1).padStart(3, "0")}`,
        device: chunk.device,
        section: chunk.manual,
        title: chunk.title,
        content: chunk.content,
      });
    });

    console.log(`${meta.file}: ${result.pages.length} pages -> ${chunks.length} chunks`);
  }

  await fs.writeFile(OUT_PATH, JSON.stringify(knowledgeBase, null, 2), "utf8");
  console.log(`\nWrote ${knowledgeBase.length} chunks -> ${OUT_PATH}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
