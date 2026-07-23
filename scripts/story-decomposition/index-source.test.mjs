import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  assertSourceIndex,
  buildSourceIndex,
  DEFAULT_SOURCE_PATH,
  EXPECTED_T0_SHA256,
  writeSourceIndex,
} from "./index-source.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const sourcePath = path.resolve(repositoryRoot, DEFAULT_SOURCE_PATH);

test("T0 index is deterministic and covers prologue plus chapters 1-39", async () => {
  const first = await buildSourceIndex(sourcePath);
  const second = await buildSourceIndex(sourcePath);
  assertSourceIndex(first);
  assert.deepEqual(second.sourceManifest, first.sourceManifest);
  assert.deepEqual(second.chapterIndex, first.chapterIndex);
  assert.deepEqual(second.paragraphs, first.paragraphs);
  assert.deepEqual(second.chunks, first.chunks);
  assert.equal(first.sourceManifest.sourceSha256, EXPECTED_T0_SHA256);
  assert.equal(first.sourceManifest.byteCount, 2018778);
  assert.equal(first.sourceManifest.decodedCodePointCount, 713684);
  assert.equal(first.sourceManifest.lineCount, 30547);
  assert.equal(first.sourceManifest.narrativeSectionCount, 40);
  assert.equal(first.sourceManifest.chapterCount, 39);
  assert.equal(first.chapterIndex.sections.length, 41);
  assert.equal(first.chapterIndex.sections[1].title, "\u6954\u5b50");
  assert.equal(first.chapterIndex.sections[1].headingLine, 30);
  assert.equal(first.chapterIndex.sections[2].headingLine, 63);
  assert.equal(first.chapterIndex.sections.at(-1).title, "\u7b2c\u4e09\u5341\u4e5d\u7ae0");
  assert.equal(first.chapterIndex.sections.at(-1).headingLine, 29975);
  assert.equal(first.chapterIndex.sections.at(-1).lineEnd, 30547);
});

test("each narrative paragraph has exactly one primary chunk owner", async () => {
  const index = await buildSourceIndex(sourcePath);
  const owners = index.chunks.flatMap((item) => item.primaryParagraphIds);
  const expected = index.paragraphs
    .filter((item) => item.kind === "content" && item.sectionId !== "DM1566-FRONTMATTER")
    .map((item) => item.paragraphId);
  assert.deepEqual(owners, expected);
  assert.equal(new Set(owners).size, owners.length);
  for (const chunk of index.chunks) {
    assert.ok(chunk.primaryParagraphIds.length > 0);
    const overlap = [
      ...chunk.readOnlyOverlapBeforeParagraphIds,
      ...chunk.readOnlyOverlapAfterParagraphIds,
    ];
    assert.equal(overlap.some((id) => chunk.primaryParagraphIds.includes(id)), false);
  }
});

test("written source index remains valid JSON and is idempotent", async () => {
  const outputPath = await mkdtemp(path.join(os.tmpdir(), "dm1566-index-"));
  try {
    const index = await buildSourceIndex(sourcePath);
    await writeSourceIndex(outputPath, index);
    const manifestPath = path.join(outputPath, "source-manifest.json");
    const chapterPath = path.join(outputPath, "chapter-index.json");
    const chunkPath = path.join(outputPath, "chunks/index.json");
    const firstManifest = await readFile(manifestPath, "utf8");
    const firstChapters = await readFile(chapterPath, "utf8");
    const firstChunks = await readFile(chunkPath, "utf8");
    assert.equal(JSON.parse(firstManifest).sourceSha256, EXPECTED_T0_SHA256);
    assert.equal(JSON.parse(firstChapters).sections.length, 41);
    assert.equal(JSON.parse(firstChunks).chunks.length, index.chunks.length);
    await writeSourceIndex(outputPath, index);
    assert.equal(await readFile(manifestPath, "utf8"), firstManifest);
    assert.equal(await readFile(chapterPath, "utf8"), firstChapters);
    assert.equal(await readFile(chunkPath, "utf8"), firstChunks);
  } finally {
    await rm(outputPath, { recursive: true, force: true });
  }
});
