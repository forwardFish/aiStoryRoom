import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { prettyJson, sha256 } from "./canonical";
import { compileEvidencePackage, hashLineRange, splitSourceLines } from "./evidence-compiler";
import { openovelPaths } from "./paths";
import { CLAIM_TYPES, type EvidencePackage, type ValidationIssue, type ValidationReport } from "./types";

export function validateEvidencePackage(evidencePackage: EvidencePackage, repoRoot?: string): ValidationReport {
  const paths = openovelPaths(repoRoot);
  const sourcePath = join(paths.repoRoot, ...evidencePackage.manifest.source.path.split("/"));
  const sourceBuffer = readFileSync(sourcePath);
  const sourceLines = splitSourceLines(sourceBuffer);
  const issues: ValidationIssue[] = [];
  const chapterById = new Map(evidencePackage.chapterIndex.map((chapter) => [chapter.chapterId, chapter]));
  const sceneById = new Map(evidencePackage.scenes.map((scene) => [scene.sceneId, scene]));
  const claimIds = new Set<string>();

  if (sha256(sourceBuffer) !== evidencePackage.manifest.source.sha256) {
    issues.push(error("SOURCE_HASH_MISMATCH", "Compiled evidence source hash no longer matches the original source file."));
  }
  if (evidencePackage.chapterIndex.length !== evidencePackage.manifest.source.chapterCount) {
    issues.push(error("CHAPTER_COUNT_MISMATCH", "Manifest chapter count differs from compiled chapter index."));
  }

  for (const scene of evidencePackage.scenes) {
    const chapter = chapterById.get(scene.chapterId);
    if (!chapter) {
      issues.push(error("SCENE_CHAPTER_MISSING", `Scene ${scene.sceneId} references unknown chapter ${scene.chapterId}.`, scene.sceneId));
      continue;
    }
    if (scene.lineStart < chapter.lineStart || scene.lineEnd > chapter.lineEnd || scene.lineStart > scene.lineEnd) {
      issues.push(error("SCENE_RANGE_OUTSIDE_CHAPTER", `Scene ${scene.sceneId} line range is outside ${scene.chapterId}.`, scene.sceneId));
    }
    if (hashLineRange(sourceLines, scene.lineStart, scene.lineEnd) !== scene.excerptSha256) {
      issues.push(error("SCENE_EXCERPT_HASH_MISMATCH", `Scene ${scene.sceneId} source excerpt changed.`, scene.sceneId));
    }
  }

  for (const claim of evidencePackage.claims) {
    if (claimIds.has(claim.claimId)) issues.push(error("CLAIM_ID_DUPLICATE", `Duplicate claim ID ${claim.claimId}.`, claim.claimId));
    claimIds.add(claim.claimId);
    const chapter = chapterById.get(claim.chapterId);
    const scene = sceneById.get(claim.sceneId);
    if (!CLAIM_TYPES.includes(claim.type)) issues.push(error("CLAIM_TYPE_INVALID", `Invalid claim type ${claim.type}.`, claim.claimId));
    if (!chapter) issues.push(error("CLAIM_CHAPTER_MISSING", `Claim references unknown chapter ${claim.chapterId}.`, claim.claimId));
    if (!scene) issues.push(error("CLAIM_SCENE_MISSING", `Claim references unknown scene ${claim.sceneId}.`, claim.claimId));
    if (chapter && (claim.evidence.lineStart < chapter.lineStart || claim.evidence.lineEnd > chapter.lineEnd)) {
      issues.push(error("CLAIM_RANGE_OUTSIDE_CHAPTER", `Claim line range is outside ${claim.chapterId}.`, claim.claimId));
    }
    if (scene && (claim.evidence.lineStart < scene.lineStart || claim.evidence.lineEnd > scene.lineEnd)) {
      issues.push(error("CLAIM_RANGE_OUTSIDE_SCENE", `Claim line range is outside ${claim.sceneId}.`, claim.claimId));
    }
    if (hashLineRange(sourceLines, claim.evidence.lineStart, claim.evidence.lineEnd) !== claim.evidence.excerptSha256) {
      issues.push(error("CLAIM_EXCERPT_HASH_MISMATCH", `Claim ${claim.claimId} source excerpt changed.`, claim.claimId));
    }
    if (["character_statement", "character_belief", "character_intention", "rumor"].includes(claim.type) && claim.truthStatus === "supported") {
      issues.push(error("EPISTEMIC_UPGRADE_FORBIDDEN", `${claim.type} ${claim.claimId} cannot default to supported objective truth.`, claim.claimId));
    }
    if (claim.type === "unknown" && claim.truthStatus !== "unknown") {
      issues.push(error("UNKNOWN_COMPILED_AS_FACT", `Unknown claim ${claim.claimId} must keep truthStatus=unknown.`, claim.claimId));
    }
  }

  for (const scene of evidencePackage.scenes) {
    for (const claimId of scene.claimIds) {
      if (!claimIds.has(claimId)) issues.push(error("SCENE_CLAIM_MISSING", `Scene references missing claim ${claimId}.`, scene.sceneId));
    }
  }
  for (const baton of evidencePackage.continuity) {
    if (!chapterById.has(baton.chapterId)) issues.push(error("CONTINUITY_CHAPTER_MISSING", `Continuity references unknown chapter ${baton.chapterId}.`, baton.chapterId));
    for (const claimId of baton.openClaimIds) {
      if (!claimIds.has(claimId)) issues.push(error("CONTINUITY_CLAIM_MISSING", `Continuity references missing claim ${claimId}.`, baton.chapterId));
    }
    for (const knowledge of baton.knownFactsByCharacter) {
      for (const claimId of knowledge.claimIds) {
        if (!claimIds.has(claimId)) issues.push(error("KNOWLEDGE_CLAIM_MISSING", `Knowledge baton references missing claim ${claimId}.`, baton.chapterId));
      }
    }
  }

  return {
    schemaVersion: "source_evidence_validation_v1",
    valid: !issues.some((issue) => issue.severity === "error"),
    packageId: evidencePackage.manifest.packageId,
    sourceSha256: evidencePackage.manifest.source.sha256,
    checked: {
      sourceHash: true,
      lineCount: sourceLines.length,
      chapterCount: evidencePackage.chapterIndex.length,
      sceneCount: evidencePackage.scenes.length,
      claimCount: evidencePackage.claims.length,
      continuityCount: evidencePackage.continuity.length
    },
    issues
  };
}

export function validateGeneratedFiles(repoRoot?: string): ValidationReport {
  const paths = openovelPaths(repoRoot);
  if (!existsSync(paths.manifestPath)) throw new Error("Generated evidence package is missing. Run evidence:build first.");
  const rebuilt = compileEvidencePackage(paths.repoRoot);
  const actualManifest = readFileSync(paths.manifestPath, "utf8");
  const expectedFiles: Record<string, string> = {
    "chapter-index.json": readFileSync(paths.chapterIndexPath, "utf8"),
    "scenes.json": readFileSync(paths.scenesPath, "utf8"),
    "claims.jsonl": readFileSync(paths.claimsPath, "utf8"),
    "continuity.json": readFileSync(paths.continuityPath, "utf8")
  };
  const report = validateEvidencePackage(rebuilt, paths.repoRoot);
  if (actualManifest !== prettyJson(rebuilt.manifest)) {
    report.issues.push(error("GENERATED_MANIFEST_DRIFT", "manifest.json differs from deterministic compiler output.", "manifest.json"));
  }
  for (const [name, content] of Object.entries(expectedFiles)) {
    const expectedHash = rebuilt.manifest.files[name];
    const actualHash = sha256(content);
    if (expectedHash !== actualHash) {
      report.issues.push(error("GENERATED_FILE_DRIFT", `${name} differs from deterministic compiler output.`, name));
    }
  }
  report.valid = !report.issues.some((issue) => issue.severity === "error");
  return report;
}

function error(code: string, message: string, itemId?: string): ValidationIssue {
  return { severity: "error", code, message, ...(itemId ? { itemId } : {}) };
}
