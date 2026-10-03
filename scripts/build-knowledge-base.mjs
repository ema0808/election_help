// One-time build script: PDF manuals -> public/knowledge-base.json
// Run with: npm run build:kb
//
// The 4 device manuals share a consistent structure (verified by inspecting
// raw pdf-parse output before writing this):
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
//
// A 5th source, FAQ.pdf, has a different structure entirely (verified the
// same way — a raw pdf-parse dump, not a guessed regex) and gets its own
// extractor, extractFaqChunks(): top-level sections are bare "N. Title"
// lines, sub-questions are "N.M Question text?" lines followed by prose/
// bullet answers. See that function for the rest.

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
  /\.{3,}\s*\d+\s*$/, // FAQ.pdf's table-of-contents dotted leaders, e.g. "...4"
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
  /** @type {{title: string, lines: string[], pages: Set<number>}[]} */
  const rawChunks = [];
  let current = null;
  let currentSectionNum = null;
  let currentProblemCategory = null;
  let expectCategoryNext = false;

  const flush = () => {
    if (current && current.lines.some((l) => l.trim())) {
      rawChunks.push({ title: current.title, lines: current.lines, pages: current.pages });
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
        pages: new Set([page.num]),
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
        current = { title: subTitle, lines: [], pages: new Set([page.num]) };
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
        current = { title, lines: [line], pages: new Set([page.num]) };
        continue;
      }

      if (line === current.title) continue; // dedupe repeated running header
      current.lines.push(line);
      current.pages.add(page.num);
    }
  }
  flush();

  return rawChunks.map((chunk) => {
    const pageNums = [...chunk.pages];
    return {
      device,
      manual,
      title: chunk.title,
      content: chunk.lines.join("\n"),
      pageStart: Math.min(...pageNums),
      pageEnd: Math.max(...pageNums),
    };
  });
}

const FAQ_DEVICE_GENERAL = "Opće informacije (operater FAQ)";
const FAQ_DEVICE_ID = "Uređaj za identifikaciju birača";
const FAQ_DEVICE_SCANNER = "Optički skener za brojanje glasova";

// Checked BEFORE FAQ_SECTION_RE on every line — a question line ("1.1 ...")
// also matches the section pattern ("1. ...") on its leading digit, so the
// more specific pattern must win.
const FAQ_QUESTION_RE = /^(\d+)\.(\d+)\s+(.+)$/;
const FAQ_SECTION_RE = /^(\d+)\.\s+(.+)$/;

// Most FAQ content isn't about one specific device (roles, scheduling, PIN/
// card ownership, support escalation, the Smart Poll Worker app) — and an
// answer that legitimately covers both devices typically does so in
// separate bullets the answer body, not in the question line itself. So
// this only looks at the section title + question text (never the answer),
// and anything that doesn't clearly name one device falls to a shared
// bucket rather than being mislabeled as device-specific.
function inferFaqDevice(sectionTitle, questionText) {
  const text = `${sectionTitle} ${questionText}`.toLowerCase();
  const mentionsScanner = /skener|optičk/.test(text);
  const mentionsIdDevice = /biometrij|identifikacij\w* birača|uređaj\w* za identifikaciju/.test(text);
  if (mentionsScanner && !mentionsIdDevice) return FAQ_DEVICE_SCANNER;
  if (mentionsIdDevice && !mentionsScanner) return FAQ_DEVICE_ID;
  return FAQ_DEVICE_GENERAL;
}

function extractFaqChunks(pages) {
  /** @type {{title: string, lines: string[], pages: Set<number>, device: string, section: string}[]} */
  const rawChunks = [];
  let current = null;
  let currentSectionTitle = null;

  const flush = () => {
    if (current && current.lines.some((l) => l.trim())) {
      rawChunks.push(current);
    }
    current = null;
  };

  // Flattened to one line stream (each tagged with its source page) rather
  // than processed page-by-page, so a section-header candidate can look
  // ahead at the next line regardless of page boundaries — see why below.
  const allLines = [];
  for (const page of pages) {
    const lines = page.text
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .filter((l) => !isBoilerplate(l));
    for (const line of lines) allLines.push({ line, pageNum: page.num });
  }

  for (let i = 0; i < allLines.length; i++) {
    const { line, pageNum } = allLines[i];

    const questionMatch = FAQ_QUESTION_RE.exec(line);
    if (questionMatch) {
      flush();
      const questionText = questionMatch[3];
      current = {
        title: truncateAtWord(questionText, 110),
        // A question that doesn't yet end in "?" has wrapped onto the next
        // physical PDF line (pdf-parse has no concept of a logical
        // sentence) — absorb one more line into the title too, so e.g.
        // "...uređaja za identifikaciju birača? Mogu li" + "koristiti
        // svoju ličnu kartu?" becomes one complete question. Capped at one
        // extra line: every wrapped question observed in this document
        // only needed one.
        titleOpen: !questionText.trim().endsWith("?"),
        lines: [line],
        pages: new Set([pageNum]),
        device: inferFaqDevice(currentSectionTitle ?? "", questionText),
        section: currentSectionTitle ?? "Često postavljana pitanja",
      };
      continue;
    }

    const sectionMatch = FAQ_SECTION_RE.exec(line);
    if (sectionMatch) {
      // A numbered list item inside an answer ("8. Kada se postupak
      // završi...") has the exact same "N. text" shape as a real top-level
      // section header, and its number can coincidentally collide with the
      // real next section's number (caught by a dry run: the 10-step
      // consolidation procedure's own step "8." was swallowing the real
      // section 8 header's content). A genuine section header in this
      // document is always immediately followed by its own "N.1"
      // sub-question — a list item never is — so that's the real
      // disambiguator, not the number alone.
      const sectionNum = sectionMatch[1];
      const next = allLines[i + 1];
      const looksLikeRealSection = next && new RegExp(`^${sectionNum}\\.1\\b`).test(next.line);
      if (looksLikeRealSection) {
        flush();
        currentSectionTitle = sectionMatch[2];
        continue;
      }
      // Not a real header — fall through and treat it as regular content.
    }

    if (!current) continue; // front matter: cover, disclaimer, TOC, intro paragraph

    if (current.titleOpen) {
      current.title = truncateAtWord(`${current.title} ${line}`, 150);
      current.titleOpen = false;
    }
    current.lines.push(line);
    current.pages.add(pageNum);
  }
  flush();

  return rawChunks.map((chunk) => {
    const pageNums = [...chunk.pages];
    return {
      device: chunk.device,
      manual: chunk.section,
      title: chunk.title,
      content: chunk.lines.join("\n"),
      pageStart: Math.min(...pageNums),
      pageEnd: Math.max(...pageNums),
    };
  });
}

async function parsePdf(filename) {
  const pdfPath = path.join(SRC_DIR, filename);
  const buf = await fs.readFile(pdfPath);
  const parser = new PDFParse({ data: new Uint8Array(buf) });
  const result = await parser.getText();
  await parser.destroy();
  return result;
}

async function main() {
  const knowledgeBase = [];

  for (const meta of FILES) {
    const result = await parsePdf(meta.file);
    const chunks = extractChunks(meta, result.pages);

    chunks.forEach((chunk, i) => {
      knowledgeBase.push({
        id: `${meta.deviceSlug}-${meta.manualSlug}-${String(i + 1).padStart(3, "0")}`,
        source: "manual",
        device: chunk.device,
        section: chunk.manual,
        title: chunk.title,
        content: chunk.content,
        pageStart: chunk.pageStart,
        pageEnd: chunk.pageEnd,
      });
    });

    console.log(`${meta.file}: ${result.pages.length} pages -> ${chunks.length} chunks`);
  }

  // 5th source: FAQ.pdf — different structure, different extractor, device
  // inferred per-chunk instead of fixed per-file (see extractFaqChunks).
  const faqResult = await parsePdf("FAQ.pdf");
  const faqChunks = extractFaqChunks(faqResult.pages);
  faqChunks.forEach((chunk, i) => {
    knowledgeBase.push({
      id: `faq-${String(i + 1).padStart(3, "0")}`,
      source: "faq",
      device: chunk.device,
      section: chunk.manual,
      title: chunk.title,
      content: chunk.content,
      pageStart: chunk.pageStart,
      pageEnd: chunk.pageEnd,
    });
  });
  console.log(`FAQ.pdf: ${faqResult.pages.length} pages -> ${faqChunks.length} chunks`);

  await fs.writeFile(OUT_PATH, JSON.stringify(knowledgeBase, null, 2), "utf8");
  console.log(`\nWrote ${knowledgeBase.length} chunks -> ${OUT_PATH}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
