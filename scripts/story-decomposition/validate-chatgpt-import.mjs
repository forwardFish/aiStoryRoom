import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildSourceIndex,
  DEFAULT_DERIVED_PATH,
  DEFAULT_SOURCE_PATH,
  EXPECTED_T0_SHA256,
} from "./index-source.mjs";

const CLAIM_TYPES = new Set([
  "objective_fact",
  "character_statement",
  "character_belief",
  "rumor",
  "inference",
  "unknown",
]);
const CERTAINTIES = new Set(["explicit", "strong_inference", "weak_inference", "unknown"]);

function pushError(errors, file, message) {
  errors.push({ severity: "ERROR", file, message });
}

function pushWarning(warnings, file, message) {
  warnings.push({ severity: "WARNING", file, message });
}

function requireString(value, label, errors, file) {
  if (typeof value !== "string" || value.trim() === "") {
    pushError(errors, file, label + " must be a non-empty string");
    return false;
  }
  return true;
}

function requireArray(value, label, errors, file) {
  if (!Array.isArray(value)) {
    pushError(errors, file, label + " must be an array");
    return false;
  }
  return true;
}

async function readJson(filePath, errors) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    pushError(errors, filePath, "invalid JSON: " + error.message);
    return null;
  }
}

async function readJsonLines(filePath, errors) {
  let text;
  try {
    text = await readFile(filePath, "utf8");
  } catch (error) {
    pushError(errors, filePath, "cannot read JSONL: " + error.message);
    return [];
  }
  const records = [];
  for (const [index, line] of text.split(/\r?\n/).entries()) {
    if (!line.trim()) continue;
    try {
      records.push(JSON.parse(line));
    } catch (error) {
      pushError(errors, filePath, "line " + (index + 1) + " is invalid JSON: " + error.message);
    }
  }
  return records;
}

async function listFiles(directory, suffix) {
  try {
    return (await readdir(directory))
      .filter((item) => item.endsWith(suffix))
      .sort()
      .map((item) => path.join(directory, item));
  } catch (error) {
    if (error && error.code === "ENOENT") return [];
    throw error;
  }
}

function chapterFromFile(filePath, suffix) {
  return path.basename(filePath).slice(0, -suffix.length);
}

function validateSourceRefs({
  refs,
  chapterId,
  label,
  file,
  errors,
  paragraphs,
  chapterRange,
}) {
  if (!requireArray(refs, label + ".sourceRefs", errors, file) || refs.length === 0) {
    pushError(errors, file, label + ".sourceRefs must contain at least one reference");
    return;
  }
  for (const [index, ref] of refs.entries()) {
    const refLabel = label + ".sourceRefs[" + index + "]";
    if (!ref || typeof ref !== "object") {
      pushError(errors, file, refLabel + " must be an object");
      continue;
    }
    const hasStart = requireString(ref.paragraphStartId, refLabel + ".paragraphStartId", errors, file);
    const hasEnd = requireString(ref.paragraphEndId, refLabel + ".paragraphEndId", errors, file);
    if (!Number.isInteger(ref.lineStart) || !Number.isInteger(ref.lineEnd) || ref.lineStart > ref.lineEnd) {
      pushError(errors, file, refLabel + " must have an ordered integer lineStart/lineEnd");
      continue;
    }
    if (ref.lineStart < chapterRange.lineStart || ref.lineEnd > chapterRange.lineEnd) {
      pushError(errors, file, refLabel + " leaves chapter range " + chapterRange.lineStart + "-" + chapterRange.lineEnd);
    }
    if (hasStart && hasEnd) {
      const start = paragraphs.get(ref.paragraphStartId);
      const end = paragraphs.get(ref.paragraphEndId);
      if (!start) pushError(errors, file, refLabel + " references unknown paragraph " + ref.paragraphStartId);
      if (!end) pushError(errors, file, refLabel + " references unknown paragraph " + ref.paragraphEndId);
      if (start && start.sectionId !== chapterId) {
        pushError(errors, file, refLabel + " start paragraph belongs to " + start.sectionId);
      }
      if (end && end.sectionId !== chapterId) {
        pushError(errors, file, refLabel + " end paragraph belongs to " + end.sectionId);
      }
      if (start && end) {
        if (start.ordinal > end.ordinal) pushError(errors, file, refLabel + " paragraph range is reversed");
        if (ref.lineStart < start.lineStart || ref.lineEnd > end.lineEnd) {
          pushError(errors, file, refLabel + " line range is outside referenced paragraph range");
        }
      }
    }
  }
}

function validateSceneDocument({
  document,
  expectedChapterId,
  file,
  errors,
  warnings,
  paragraphs,
  chapterRange,
  sceneIds,
}) {
  if (!document) return;
  if (document.schemaVersion !== "dm1566_scene_evidence_v1") {
    pushError(errors, file, "schemaVersion must be dm1566_scene_evidence_v1");
  }
  if (document.sourceSha256 !== EXPECTED_T0_SHA256) pushError(errors, file, "sourceSha256 mismatch");
  if (document.chapterId !== expectedChapterId) pushError(errors, file, "chapterId does not match filename");
  if (!requireArray(document.scenes, "scenes", errors, file) || document.scenes.length === 0) return;

  for (const [index, scene] of document.scenes.entries()) {
    const label = "scenes[" + index + "]";
    const validId = requireString(scene.sceneId, label + ".sceneId", errors, file);
    if (validId) {
      if (!scene.sceneId.startsWith(expectedChapterId + "-S")) {
        pushError(errors, file, label + ".sceneId must start with " + expectedChapterId + "-S");
      }
      if (sceneIds.has(scene.sceneId)) pushError(errors, file, "duplicate sceneId " + scene.sceneId);
      sceneIds.add(scene.sceneId);
    }
    requireString(scene.title, label + ".title", errors, file);
    requireString(scene.openingState, label + ".openingState", errors, file);
    requireString(scene.closingState, label + ".closingState", errors, file);
    for (const field of ["locations", "presentCharacters", "referencedCharacters", "unresolvedThreads"]) {
      requireArray(scene[field], label + "." + field, errors, file);
    }
    validateSourceRefs({
      refs: scene.sourceRefs,
      chapterId: expectedChapterId,
      label,
      file,
      errors,
      paragraphs,
      chapterRange,
    });
    if (scene.summary || scene.fullText || scene.originalText) {
      pushWarning(warnings, file, label + " contains optional prose; evidence fields remain authoritative");
    }
  }
}

function validateClaim({
  claim,
  expectedChapterId,
  file,
  recordIndex,
  errors,
  paragraphs,
  chapterRange,
  sceneIds,
  claimIds,
}) {
  const label = "record[" + recordIndex + "]";
  const validId = requireString(claim.claimId, label + ".claimId", errors, file);
  if (validId) {
    if (!claim.claimId.startsWith(expectedChapterId + "-")) {
      pushError(errors, file, label + ".claimId must start with " + expectedChapterId + "-");
    }
    if (claimIds.has(claim.claimId)) pushError(errors, file, "duplicate claimId " + claim.claimId);
    claimIds.add(claim.claimId);
  }
  if (claim.chapterId !== expectedChapterId) pushError(errors, file, label + ".chapterId does not match filename");
  if (!requireString(claim.sceneId, label + ".sceneId", errors, file) || !sceneIds.has(claim.sceneId)) {
    pushError(errors, file, label + ".sceneId does not reference a loaded scene");
  }
  if (!CLAIM_TYPES.has(claim.claimType)) {
    pushError(errors, file, label + ".claimType is invalid");
  }
  requireString(claim.statement, label + ".statement", errors, file);
  requireArray(claim.knownBy, label + ".knownBy", errors, file);
  if (!CERTAINTIES.has(claim.certainty)) pushError(errors, file, label + ".certainty is invalid");

  const nonObjective = claim.claimType !== "objective_fact";
  if (claim.mustNotBeTreatedAsObjectiveFact !== nonObjective) {
    pushError(
      errors,
      file,
      label + ".mustNotBeTreatedAsObjectiveFact must be " + nonObjective + " for " + claim.claimType,
    );
  }
  if (claim.claimType === "character_statement") {
    requireString(claim.speaker, label + ".speaker", errors, file);
  } else if (claim.speaker !== null && claim.speaker !== undefined) {
    pushError(errors, file, label + ".speaker is only allowed for character_statement");
  }
  validateSourceRefs({
    refs: claim.sourceRefs,
    chapterId: expectedChapterId,
    label,
    file,
    errors,
    paragraphs,
    chapterRange,
  });
}

function validateContinuity(document, expectedChapterId, file, errors) {
  if (!document) return;
  if (document.schemaVersion !== "dm1566_chapter_continuity_v1") {
    pushError(errors, file, "schemaVersion must be dm1566_chapter_continuity_v1");
  }
  if (document.sourceSha256 !== EXPECTED_T0_SHA256) pushError(errors, file, "sourceSha256 mismatch");
  if (document.chapterId !== expectedChapterId) pushError(errors, file, "chapterId does not match filename");
  for (const field of [
    "characterPositions",
    "characterKnowledge",
    "activeGoals",
    "relationshipsChanged",
    "resourceChanges",
    "objectCustody",
    "unresolvedPromises",
    "openThreats",
    "secretsNotYetKnown",
    "causesWaitingForConsequences",
  ]) {
    requireArray(document[field], field, errors, file);
  }
}

export async function validateChatGptImport({ repositoryRoot, requireComplete = false }) {
  const sourcePath = path.resolve(repositoryRoot, DEFAULT_SOURCE_PATH);
  const incomingRoot = path.resolve(
    repositoryRoot,
    path.dirname(DEFAULT_DERIVED_PATH),
    "incoming",
    "chatgpt",
  );
  const index = await buildSourceIndex(sourcePath);
  const errors = [];
  const warnings = [];
  const paragraphs = new Map(index.paragraphs.map((item) => [item.paragraphId, item]));
  const chapters = new Map(
    index.chapterIndex.sections
      .filter((item) => item.sectionType !== "frontmatter")
      .map((item) => [item.sectionId, item]),
  );
  const sceneFiles = await listFiles(path.join(incomingRoot, "scenes"), ".scenes.json");
  const claimFiles = await listFiles(path.join(incomingRoot, "claims"), ".claims.jsonl");
  const continuityFiles = await listFiles(path.join(incomingRoot, "continuity"), ".continuity.json");
  const sceneIds = new Set();
  const claimIds = new Set();
  const loadedScenes = new Set();
  const loadedClaims = new Set();
  const loadedContinuity = new Set();

  for (const file of sceneFiles) {
    const chapterId = chapterFromFile(file, ".scenes.json");
    const range = chapters.get(chapterId);
    if (!range) {
      pushError(errors, file, "filename contains unknown chapterId " + chapterId);
      continue;
    }
    validateSceneDocument({
      document: await readJson(file, errors),
      expectedChapterId: chapterId,
      file,
      errors,
      warnings,
      paragraphs,
      chapterRange: range,
      sceneIds,
    });
    loadedScenes.add(chapterId);
  }

  for (const file of claimFiles) {
    const chapterId = chapterFromFile(file, ".claims.jsonl");
    const range = chapters.get(chapterId);
    if (!range) {
      pushError(errors, file, "filename contains unknown chapterId " + chapterId);
      continue;
    }
    const records = await readJsonLines(file, errors);
    for (const [recordIndex, claim] of records.entries()) {
      validateClaim({
        claim,
        expectedChapterId: chapterId,
        file,
        recordIndex,
        errors,
        paragraphs,
        chapterRange: range,
        sceneIds,
        claimIds,
      });
    }
    if (records.length === 0) pushError(errors, file, "claims file is empty");
    loadedClaims.add(chapterId);
  }

  for (const file of continuityFiles) {
    const chapterId = chapterFromFile(file, ".continuity.json");
    if (!chapters.has(chapterId)) {
      pushError(errors, file, "filename contains unknown chapterId " + chapterId);
      continue;
    }
    validateContinuity(await readJson(file, errors), chapterId, file, errors);
    loadedContinuity.add(chapterId);
  }

  for (const chapterId of chapters.keys()) {
    if (!loadedScenes.has(chapterId)) pushWarning(warnings, incomingRoot, "missing scenes for " + chapterId);
    if (!loadedClaims.has(chapterId)) pushWarning(warnings, incomingRoot, "missing claims for " + chapterId);
    if (!loadedContinuity.has(chapterId)) pushWarning(warnings, incomingRoot, "missing continuity for " + chapterId);
  }
  if (requireComplete && warnings.some((item) => item.message.startsWith("missing "))) {
    pushError(errors, incomingRoot, "complete import requires all 40 narrative sections");
  }

  return {
    schemaVersion: "dm1566_chatgpt_import_validation_v1",
    sourceSha256: index.sourceManifest.sourceSha256,
    incomingRoot,
    status: errors.length ? "FAIL" : (warnings.length ? "INCOMPLETE" : "PASS"),
    coverage: {
      expectedNarrativeSections: chapters.size,
      sceneSections: loadedScenes.size,
      claimSections: loadedClaims.size,
      continuitySections: loadedContinuity.size,
      sceneCount: sceneIds.size,
      claimCount: claimIds.size,
    },
    errors,
    warnings,
  };
}

async function runCli() {
  const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
  const report = await validateChatGptImport({
    repositoryRoot,
    requireComplete: process.argv.includes("--require-complete"),
  });
  console.log(JSON.stringify(report, null, 2));
  if (report.status === "FAIL") process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await runCli();
}
