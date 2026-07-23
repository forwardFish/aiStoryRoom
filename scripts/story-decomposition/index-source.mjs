import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const EXTRACTOR_VERSION = "dm1566-source-indexer-v1";
export const EXPECTED_T0_SHA256 = "04D5E8D4533D86890A79058C25252D33E001668921A2BBD8FFDE401CDD2B6238";
export const DEFAULT_SOURCE_PATH = "docs/\u5267\u672c/\u5609\u9756\u8d22\u653f\u5371\u5c40/\u5927\u660e\u738b\u671d1566 (\u5218\u548c\u5e73).txt";
export const DEFAULT_DERIVED_PATH = "docs/\u5267\u672c/\u5609\u9756\u8d22\u653f\u5371\u5c40/derived";

const DIGITS = new Map([
  ["\u96f6", 0], ["\u3007", 0], ["\u4e00", 1], ["\u4e8c", 2], ["\u4e09", 3], ["\u56db", 4],
  ["\u4e94", 5], ["\u516d", 6], ["\u4e03", 7], ["\u516b", 8], ["\u4e5d", 9],
]);

function sha256(value) {
  return createHash("sha256").update(value).digest("hex").toUpperCase();
}

function codePoints(value) {
  return Array.from(value).length;
}

function parseChineseNumber(value) {
  if (value === "\u5341") return 10;
  if (value.includes("\u5341")) {
    const parts = value.split("\u5341");
    const tens = parts[0] ? DIGITS.get(parts[0]) : 1;
    const ones = parts[1] ? DIGITS.get(parts[1]) : 0;
    return tens === undefined || ones === undefined ? null : tens * 10 + ones;
  }
  return value.length === 1 ? (DIGITS.get(value) ?? null) : null;
}

function parseHeading(text) {
  if (text === "\u6954\u5b50") {
    return { sectionId: "DM1566-PROLOGUE", sectionType: "prologue", ordinal: 0, title: text };
  }
  const match = /^\u7b2c([\u96f6\u3007\u4e00\u4e8c\u4e09\u56db\u4e94\u516d\u4e03\u516b\u4e5d\u5341]+)\u7ae0$/.exec(text);
  if (!match) return null;
  const ordinal = parseChineseNumber(match[1]);
  if (!ordinal) return null;
  return {
    sectionId: "DM1566-C" + String(ordinal).padStart(2, "0"),
    sectionType: "chapter",
    ordinal,
    title: text,
  };
}

function decodeUtf8(buffer) {
  const decoded = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  return decoded.charCodeAt(0) === 0xfeff
    ? { text: decoded.slice(1), bomBytes: 3 }
    : { text: decoded, bomBytes: 0 };
}

function indexLines(buffer, decodedText, bomBytes) {
  const normalizedText = decodedText.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const texts = normalizedText.split("\n");
  if (texts.at(-1) === "" && normalizedText.endsWith("\n")) {
    texts.pop();
  }
  const lines = [];
  const lineEndings = { crlf: 0, lf: 0, cr: 0 };
  let byteCursor = bomBytes;
  let utf16Cursor = 0;
  let codePointCursor = 0;

  for (let index = 0; index < texts.length; index += 1) {
    const text = texts[index];
    const byteLength = Buffer.byteLength(text, "utf8");
    const newlineStart = byteCursor + byteLength;
    let newlineBytes = 0;
    let newlineKind = "none";
    if (newlineStart < buffer.length) {
      if (buffer[newlineStart] === 0x0d && buffer[newlineStart + 1] === 0x0a) {
        newlineBytes = 2;
        newlineKind = "crlf";
      } else if (buffer[newlineStart] === 0x0a) {
        newlineBytes = 1;
        newlineKind = "lf";
      } else if (buffer[newlineStart] === 0x0d) {
        newlineBytes = 1;
        newlineKind = "cr";
      } else {
        throw new Error("Unexpected byte after line " + (index + 1));
      }
      lineEndings[newlineKind] += 1;
    }
    const pointLength = codePoints(text);
    lines.push({
      lineNumber: index + 1,
      text,
      byteStart: byteCursor,
      byteEnd: byteCursor + byteLength,
      normalizedUtf16Start: utf16Cursor,
      normalizedUtf16End: utf16Cursor + text.length,
      normalizedCodePointStart: codePointCursor,
      normalizedCodePointEnd: codePointCursor + pointLength,
      newlineKind,
    });
    byteCursor += byteLength + newlineBytes;
    utf16Cursor += text.length + (index < texts.length - 1 ? 1 : 0);
    codePointCursor += pointLength + (index < texts.length - 1 ? 1 : 0);
  }
  if (byteCursor !== buffer.length) {
    throw new Error("Byte coverage mismatch: " + byteCursor + " of " + buffer.length);
  }
  return { normalizedText, lines, lineEndings };
}

function findSections(lines) {
  const headings = lines
    .map((line) => ({ line, heading: parseHeading(line.text.trim()) }))
    .filter((item) => item.heading);
  if (headings.length !== 40) {
    throw new Error("Expected prologue plus 39 chapters, found " + headings.length);
  }
  if (headings[0].heading.sectionType !== "prologue") {
    throw new Error("First narrative section is not prologue");
  }
  for (let ordinal = 1; ordinal <= 39; ordinal += 1) {
    const current = headings[ordinal] && headings[ordinal].heading;
    if (!current || current.sectionType !== "chapter" || current.ordinal !== ordinal) {
      throw new Error("Missing or out-of-order chapter " + ordinal);
    }
  }
  const sections = [{
    sectionId: "DM1566-FRONTMATTER",
    sectionType: "frontmatter",
    ordinal: -1,
    title: "\u4e66\u7c4d\u524d\u7f6e\u4fe1\u606f",
    headingLine: null,
    lineStart: 1,
    contentLineStart: 1,
    lineEnd: headings[0].line.lineNumber - 1,
  }];
  for (let index = 0; index < headings.length; index += 1) {
    const current = headings[index];
    const next = headings[index + 1];
    sections.push({
      ...current.heading,
      headingLine: current.line.lineNumber,
      lineStart: current.line.lineNumber,
      contentLineStart: current.line.lineNumber + 1,
      lineEnd: next ? next.line.lineNumber - 1 : lines.length,
    });
  }
  return sections;
}

function indexParagraphs(lines, sections) {
  const all = [];
  const bySection = new Map();
  for (const section of sections) {
    const records = [];
    let pending = [];
    const flush = () => {
      if (!pending.length) return;
      const first = pending[0];
      const last = pending[pending.length - 1];
      const ordinal = records.length + 1;
      const text = pending.map((line) => line.text).join("\n");
      const record = {
        paragraphId: section.sectionId + "-P" + String(ordinal).padStart(4, "0"),
        sectionId: section.sectionId,
        ordinal,
        kind: section.headingLine === first.lineNumber && pending.length === 1 ? "heading" : "content",
        lineStart: first.lineNumber,
        lineEnd: last.lineNumber,
        byteStart: first.byteStart,
        byteEnd: last.byteEnd,
        normalizedUtf16Start: first.normalizedUtf16Start,
        normalizedUtf16End: last.normalizedUtf16End,
        normalizedCodePointStart: first.normalizedCodePointStart,
        normalizedCodePointEnd: last.normalizedCodePointEnd,
        sha256: sha256(Buffer.from(text, "utf8")),
        text,
      };
      records.push(record);
      all.push(record);
      pending = [];
    };
    for (let number = section.lineStart; number <= section.lineEnd; number += 1) {
      const line = lines[number - 1];
      if (line.text.trim() === "") flush();
      else pending.push(line);
    }
    flush();
    bySection.set(section.sectionId, records);
  }
  return { all, bySection };
}

function addSectionPositions(sections, lines, bySection) {
  return sections.map((section) => {
    const first = lines[section.lineStart - 1];
    const last = lines[section.lineEnd - 1];
    const paragraphs = bySection.get(section.sectionId) || [];
    return {
      ...section,
      byteStart: first.byteStart,
      byteEnd: last.byteEnd,
      normalizedUtf16Start: first.normalizedUtf16Start,
      normalizedUtf16End: last.normalizedUtf16End,
      normalizedCodePointStart: first.normalizedCodePointStart,
      normalizedCodePointEnd: last.normalizedCodePointEnd,
      paragraphCount: paragraphs.length,
      contentParagraphCount: paragraphs.filter((item) => item.kind === "content").length,
    };
  });
}

function buildChunks(sections, bySection, targetCodePoints = 6000, overlapParagraphs = 1) {
  const chunks = [];
  for (const section of sections.filter((item) => item.sectionType !== "frontmatter")) {
    const paragraphs = (bySection.get(section.sectionId) || []).filter((item) => item.kind === "content");
    const ranges = [];
    let start = 0;
    let size = 0;
    for (let index = 0; index < paragraphs.length; index += 1) {
      const itemSize = paragraphs[index].normalizedCodePointEnd - paragraphs[index].normalizedCodePointStart;
      if (index > start && size + itemSize > targetCodePoints) {
        ranges.push([start, index - 1]);
        start = index;
        size = 0;
      }
      size += itemSize;
    }
    if (start < paragraphs.length) ranges.push([start, paragraphs.length - 1]);
    for (const [rangeStart, rangeEnd] of ranges) {
      const primary = paragraphs.slice(rangeStart, rangeEnd + 1);
      const before = paragraphs.slice(Math.max(0, rangeStart - overlapParagraphs), rangeStart);
      const after = paragraphs.slice(rangeEnd + 1, rangeEnd + 1 + overlapParagraphs);
      const first = primary[0];
      const last = primary[primary.length - 1];
      chunks.push({
        chunkId: section.sectionId + "-" + first.paragraphId.slice(-5) + "-" + last.paragraphId.slice(-5),
        sectionId: section.sectionId,
        primaryParagraphIds: primary.map((item) => item.paragraphId),
        readOnlyOverlapBeforeParagraphIds: before.map((item) => item.paragraphId),
        readOnlyOverlapAfterParagraphIds: after.map((item) => item.paragraphId),
        lineStart: first.lineStart,
        lineEnd: last.lineEnd,
        contentSha256: sha256(Buffer.from(primary.map((item) => item.text).join("\n\n"), "utf8")),
        codePointCount: primary.reduce(
          (total, item) => total + item.normalizedCodePointEnd - item.normalizedCodePointStart,
          0,
        ),
      });
    }
  }
  return chunks;
}

export async function buildSourceIndex(sourcePath) {
  const buffer = await readFile(sourcePath);
  const sourceSha256 = sha256(buffer);
  const decoded = decodeUtf8(buffer);
  const lineIndex = indexLines(buffer, decoded.text, decoded.bomBytes);
  const rawSections = findSections(lineIndex.lines);
  const paragraphIndex = indexParagraphs(lineIndex.lines, rawSections);
  const sections = addSectionPositions(rawSections, lineIndex.lines, paragraphIndex.bySection);
  const chunks = buildChunks(sections, paragraphIndex.bySection);
  const sourceManifest = {
    schemaVersion: "dm1566_source_manifest_v1",
    extractorVersion: EXTRACTOR_VERSION,
    sourceId: "DM1566-T0",
    sourcePath: DEFAULT_SOURCE_PATH,
    encoding: "UTF-8",
    utf8BomBytes: decoded.bomBytes,
    sourceSha256,
    expectedSourceSha256: EXPECTED_T0_SHA256,
    hashMatchesExpected: sourceSha256 === EXPECTED_T0_SHA256,
    byteCount: buffer.length,
    decodedUtf16CodeUnitCount: decoded.text.length,
    decodedCodePointCount: codePoints(decoded.text),
    normalizedSha256: sha256(Buffer.from(lineIndex.normalizedText, "utf8")),
    normalizedUtf16CodeUnitCount: lineIndex.normalizedText.length,
    normalizedCodePointCount: codePoints(lineIndex.normalizedText),
    lineCount: lineIndex.lines.length,
    lineEndings: lineIndex.lineEndings,
    frontmatterSectionCount: 1,
    narrativeSectionCount: 40,
    prologueCount: 1,
    chapterCount: 39,
    paragraphCount: paragraphIndex.all.length,
    chunkCount: chunks.length,
  };
  return {
    sourceManifest,
    chapterIndex: {
      schemaVersion: "dm1566_chapter_index_v1",
      sourceId: sourceManifest.sourceId,
      sourceSha256,
      sections,
    },
    paragraphs: paragraphIndex.all,
    paragraphsBySection: paragraphIndex.bySection,
    chunks,
  };
}

export function assertSourceIndex(index) {
  if (index.sourceManifest.sourceSha256 !== EXPECTED_T0_SHA256) throw new Error("T0 SHA-256 mismatch");
  const sections = index.chapterIndex.sections;
  if (sections.length !== 41 || sections[1].title !== "\u6954\u5b50" || sections.at(-1).title !== "\u7b2c\u4e09\u5341\u4e5d\u7ae0") {
    throw new Error("Narrative section contract failed");
  }
  for (let offset = 1; offset < sections.length; offset += 1) {
    if (sections[offset - 1].lineEnd + 1 !== sections[offset].lineStart) {
      throw new Error("Non-contiguous line coverage at " + sections[offset].sectionId);
    }
  }
  if (sections[0].lineStart !== 1 || sections.at(-1).lineEnd !== index.sourceManifest.lineCount) {
    throw new Error("Section index does not cover all source lines");
  }
  const owners = index.chunks.flatMap((item) => item.primaryParagraphIds);
  const expected = index.paragraphs
    .filter((item) => item.kind === "content" && item.sectionId !== "DM1566-FRONTMATTER")
    .map((item) => item.paragraphId);
  if (JSON.stringify(owners) !== JSON.stringify(expected) || new Set(owners).size !== owners.length) {
    throw new Error("Every narrative paragraph must have exactly one primary chunk owner");
  }
}

function json(value) {
  return JSON.stringify(value, null, 2) + "\n";
}

async function writeAtomic(filePath, content) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporary = filePath + ".tmp";
  await writeFile(temporary, content, "utf8");
  await rm(filePath, { force: true });
  await rename(temporary, filePath);
}

export async function writeSourceIndex(outputPath, index) {
  const paragraphsPath = path.join(outputPath, "paragraphs");
  const chunksPath = path.join(outputPath, "chunks");
  await mkdir(paragraphsPath, { recursive: true });
  await mkdir(chunksPath, { recursive: true });
  const expectedFiles = new Set();
  for (const section of index.chapterIndex.sections) {
    const fileName = section.sectionId.toLowerCase() + ".jsonl";
    expectedFiles.add(fileName);
    const records = index.paragraphsBySection.get(section.sectionId) || [];
    await writeAtomic(path.join(paragraphsPath, fileName), records.map(JSON.stringify).join("\n") + "\n");
  }
  for (const fileName of await readdir(paragraphsPath)) {
    if (fileName.endsWith(".jsonl") && !expectedFiles.has(fileName)) {
      await rm(path.join(paragraphsPath, fileName), { force: true });
    }
  }
  const chunkIndex = {
    schemaVersion: "dm1566_chunk_index_v1",
    sourceId: index.sourceManifest.sourceId,
    sourceSha256: index.sourceManifest.sourceSha256,
    targetCodePoints: 6000,
    overlapParagraphs: 1,
    ownershipRule: "Only primaryParagraphIds may emit claims; overlap is read-only context.",
    chunks: index.chunks,
  };
  const validationReport = {
    schemaVersion: "dm1566_validation_report_v1",
    sourceSha256: index.sourceManifest.sourceSha256,
    stages: {
      sourceIndex: {
        status: "PASS",
        checks: [
          "UTF-8 strict decode",
          "T0 SHA-256 matches pinned source",
          "frontmatter plus prologue plus chapters 1-39",
          "contiguous line and byte coverage",
          "stable paragraph IDs and hashes",
          "exactly one primary chunk owner per narrative paragraph",
        ],
      },
      t1Evidence: { status: "NOT_STARTED" },
      t2KnowledgeGraph: { status: "NOT_STARTED" },
      t3Adaptation: { status: "NOT_STARTED" },
      t4RuntimePackage: { status: "NOT_STARTED" },
    },
  };
  await writeAtomic(path.join(outputPath, "source-manifest.json"), json(index.sourceManifest));
  await writeAtomic(path.join(outputPath, "chapter-index.json"), json(index.chapterIndex));
  await writeAtomic(path.join(chunksPath, "index.json"), json(chunkIndex));
  await writeAtomic(path.join(outputPath, "validation-report.json"), json(validationReport));
}

async function runCli() {
  const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
  const sourcePath = path.resolve(repositoryRoot, process.argv[2] || DEFAULT_SOURCE_PATH);
  const outputPath = path.resolve(repositoryRoot, process.argv[3] || DEFAULT_DERIVED_PATH);
  const index = await buildSourceIndex(sourcePath);
  assertSourceIndex(index);
  await writeSourceIndex(outputPath, index);
  console.log(JSON.stringify({
    status: "PASS",
    sourcePath,
    outputPath,
    sourceSha256: index.sourceManifest.sourceSha256,
    bytes: index.sourceManifest.byteCount,
    lines: index.sourceManifest.lineCount,
    narrativeSections: index.sourceManifest.narrativeSectionCount,
    paragraphs: index.sourceManifest.paragraphCount,
    chunks: index.sourceManifest.chunkCount,
  }, null, 2));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await runCli();
}
