import { readFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import {
  readJson,
  repoRoot,
  sha256Bytes,
  validateWithSchema,
  writeJson,
} from "./lib/contract-utils.mjs";

const SOURCE_ID = "dm1566-liuheping";
const QUERY_VERSION = "sangtian-requirement-resolver-v1.0.0";
const DEFAULT_RUN_ID = "sangtian-part-one-source-resolution-v1";

function parseArgs(argv) {
  const result = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (key?.startsWith("--") && argv[index + 1]) {
      result.set(key.slice(2), argv[index + 1]);
      index += 1;
    }
  }
  return result;
}

function readJsonLines(text) {
  return text
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line));
}

function countTerm(text, term) {
  let count = 0;
  let offset = 0;
  while ((offset = text.indexOf(term, offset)) >= 0) {
    count += 1;
    offset += term.length;
  }
  return count;
}

function candidateWindows(paragraphs, terms) {
  const hitOrdinals = paragraphs
    .map((paragraph, index) => ({ index, score: terms.reduce((sum, term) => sum + countTerm(paragraph.text, term), 0) }))
    .filter((entry) => entry.score > 0);

  const windows = [];
  for (const hit of hitOrdinals) {
    const start = Math.max(0, hit.index - 2);
    const end = Math.min(paragraphs.length - 1, hit.index + 2);
    const previous = windows.at(-1);
    if (previous && start <= previous.end + 1) {
      previous.end = Math.max(previous.end, end);
    } else {
      windows.push({ start, end });
    }
  }
  return windows;
}

function makeSourceRef(sourceSha256, chapterId, paragraphs) {
  const text = paragraphs.map((paragraph) => paragraph.text).join("\n\n");
  return {
    sourceId: SOURCE_ID,
    sourceSha256,
    chapterId,
    paragraphStartId: paragraphs[0].paragraphId,
    paragraphEndId: paragraphs.at(-1).paragraphId,
    lineStart: paragraphs[0].lineStart,
    lineEnd: paragraphs.at(-1).lineEnd,
    textSpanSha256: sha256Bytes(Buffer.from(text, "utf8")),
  };
}

const args = parseArgs(process.argv.slice(2));
const runId = args.get("run-id") ?? DEFAULT_RUN_ID;
const sourceRoot = resolve(repoRoot, "docs/剧本/嘉靖财政危局");
const derivedRoot = resolve(sourceRoot, "derived");
const authoringRoot = resolve(repoRoot, "packages/templates/authoring/sangtian");
const candidateRoot = resolve(derivedRoot, `evidence-v2/candidates/${runId}/source-requirement-resolution`);
const sourceManifest = await readJson(resolve(derivedRoot, "source-manifest.json"));
const requirementSet = await readJson(resolve(authoringRoot, "requirements/part-01.requirements.json"));

if (!sourceManifest.hashMatchesExpected) {
  throw new Error("T0 source manifest hash does not match the frozen expected source hash");
}

const chapterCache = new Map();
async function loadChapter(chapterId) {
  if (!chapterCache.has(chapterId)) {
    const path = resolve(derivedRoot, `paragraphs/${chapterId}.jsonl`);
    const paragraphs = readJsonLines(await readFile(path, "utf8")).filter((entry) => entry.kind === "content");
    chapterCache.set(chapterId, paragraphs);
  }
  return chapterCache.get(chapterId);
}

const resolutions = [];
const failures = [];
for (const requirement of requirementSet.requirements) {
  const rawCandidates = [];
  for (const chapterId of requirement.sourceCandidateChapterIds) {
    const paragraphs = await loadChapter(chapterId);
    const windows = candidateWindows(paragraphs, requirement.sourceCandidateQueryTerms);
    for (const window of windows) {
      const selectedParagraphs = paragraphs.slice(window.start, window.end + 1);
      const text = selectedParagraphs.map((entry) => entry.text).join("\n\n");
      const matchedTerms = requirement.sourceCandidateQueryTerms.filter((term) => text.includes(term));
      const occurrenceScore = matchedTerms.reduce((sum, term) => sum + Math.min(3, countTerm(text, term)), 0);
      rawCandidates.push({ chapterId, selectedParagraphs, text, matchedTerms, occurrenceScore });
    }
  }

  const candidates = rawCandidates
    .sort((left, right) => right.matchedTerms.length - left.matchedTerms.length || right.occurrenceScore - left.occurrenceScore || left.selectedParagraphs[0].ordinal - right.selectedParagraphs[0].ordinal)
    .slice(0, 12)
    .map((candidate, index) => ({
      candidateId: `${requirement.requirementId}-CAND-${String(index + 1).padStart(2, "0")}`,
      chapterId: candidate.chapterId,
      sourceRefs: [makeSourceRef(sourceManifest.sourceSha256, candidate.chapterId, candidate.selectedParagraphs)],
      matchedMechanisms: candidate.matchedTerms,
      relevance: candidate.matchedTerms.length >= 4 ? "HIGH" : candidate.matchedTerms.length >= 2 ? "MEDIUM" : "LOW",
      selection: "NEEDS_REVIEW",
      reason: `Deterministic keyword recall only. Matched ${candidate.matchedTerms.join("、")} in ${candidate.selectedParagraphs[0].paragraphId}—${candidate.selectedParagraphs.at(-1).paragraphId}; an independent reviewer must read the source span before selection.`,
    }));

  const resolution = {
    schemaVersion: "source-requirement-resolution-v1",
    resolutionId: `RESOLVE-${requirement.requirementId}`,
    requirementId: requirement.requirementId,
    sourceSha256: sourceManifest.sourceSha256,
    queryVersion: QUERY_VERSION,
    searchedSectionIds: requirement.sourceCandidateChapterIds,
    candidateScenes: candidates,
    coveredMechanisms: [],
    missingMechanisms: requirement.requiredEvidenceMechanisms,
    mustNotAssume: requirement.mustNotAssume,
    recommendedAdaptationGaps: [],
    reviewerStatus: "PENDING",
  };
  const schemaResult = await validateWithSchema("source-requirement-resolution-v1", resolution);
  if (!schemaResult.valid) {
    failures.push({ requirementId: requirement.requirementId, errors: schemaResult.errors });
  }
  resolutions.push(resolution);
  await writeJson(resolve(candidateRoot, `${requirement.requirementId}.resolution.json`), resolution);
}

const aggregate = {
  schemaVersion: "source-requirement-resolution-set-v1",
  runId,
  sourceSha256: sourceManifest.sourceSha256,
  queryVersion: QUERY_VERSION,
  requirementCount: resolutions.length,
  resolutionIds: resolutions.map((entry) => entry.resolutionId),
  reviewerStatusCounts: resolutions.reduce((counts, entry) => ({ ...counts, [entry.reviewerStatus]: (counts[entry.reviewerStatus] ?? 0) + 1 }), {}),
  resolutions,
};
await writeJson(resolve(authoringRoot, "source-resolution/part-01.coverage.json"), aggregate);
await writeJson(resolve(candidateRoot, "resolution-set.json"), aggregate);

console.log(JSON.stringify({
  runId,
  source: basename(sourceManifest.sourcePath),
  sourceSha256: sourceManifest.sourceSha256,
  requirementCount: resolutions.length,
  candidateCount: resolutions.reduce((sum, entry) => sum + entry.candidateScenes.length, 0),
  requirementsWithNoCandidate: resolutions.filter((entry) => entry.candidateScenes.length === 0).map((entry) => entry.requirementId),
  reviewerStatusCounts: aggregate.reviewerStatusCounts,
  schemaFailures: failures,
  verdict: failures.length === 0 ? "PASS" : "FAIL",
}, null, 2));
if (failures.length > 0) process.exitCode = 1;
