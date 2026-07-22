import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { sha256Canonical, prettyJson } from "./canonical";
import { compileEvidencePackage } from "./evidence-compiler";
import { readEvidenceReviewQueue, validateEvidenceReviewQueue } from "./evidence-review";
import { validateWorldBibleAuthoringSchema } from "./evidence-schema-validator";
import { openovelPaths } from "./paths";
import type {
  CompiledWorldBible,
  EvidenceClaim,
  EvidencePackage,
  WorldBibleAuthoring,
  WorldBibleSourceMapEntry
} from "./types";

export function compileWorldBible(repoRoot?: string, suppliedEvidence?: EvidencePackage): CompiledWorldBible {
  const paths = openovelPaths(repoRoot);
  const evidencePackage = suppliedEvidence || compileEvidencePackage(paths.repoRoot);
  const authoring: unknown = JSON.parse(readFileSync(paths.worldBibleAuthoringPath, "utf8"));
  validateWorldBibleAuthoringSchema(authoring, paths.worldBibleAuthoringSchemaPath);
  assertWorldBibleAuthoring(authoring, evidencePackage);

  const reviewQueue = readEvidenceReviewQueue(paths.reviewQueuePath);
  let reviewGate: CompiledWorldBible["reviewGate"] = "MISSING";
  if (reviewQueue) {
    const report = validateEvidenceReviewQueue(reviewQueue, evidencePackage, paths.reviewSchemaPath);
    if (!report.valid) throw new Error(`EVIDENCE_REVIEW_INVALID: ${report.issues.map((item) => item.code).join(",")}`);
    reviewGate = report.approvalComplete ? "APPROVED" : "PENDING";
  }

  const chapterOrdinal = new Map(evidencePackage.chapterIndex.map((chapter) => [chapter.chapterId, chapter.ordinal]));
  const cutoff = chapterOrdinal.get(authoring.startPoint.sourceCutoffChapterId);
  if (!cutoff) throw new Error(`WORLD_BIBLE_START_POINT_UNKNOWN: ${authoring.startPoint.sourceCutoffChapterId}`);
  const historicalBaseline = evidencePackage.claims.filter((claim) =>
    (chapterOrdinal.get(claim.chapterId) || Number.MAX_SAFE_INTEGER) <= cutoff &&
    claim.truthStatus === "supported" &&
    (claim.type === "objective_event" || claim.type === "objective_state") &&
    claim.runtimeUse !== "forbidden_future"
  );
  const sourceFuture = evidencePackage.claims.filter((claim) =>
    (chapterOrdinal.get(claim.chapterId) || Number.MAX_SAFE_INTEGER) > cutoff || claim.runtimeUse === "forbidden_future"
  );
  const sourceFutureIds = new Set(sourceFuture.map((claim) => claim.claimId));
  const epistemic = evidencePackage.claims.filter((claim) =>
    !historicalBaseline.some((item) => item.claimId === claim.claimId) && !sourceFutureIds.has(claim.claimId)
  );
  validateWorldBibleReferences(authoring, evidencePackage, sourceFutureIds);

  const sourceMap: WorldBibleSourceMapEntry[] = [
    ...historicalBaseline.map((claim) => claimMap("HISTORICAL_BASELINE", claim)),
    ...epistemic.map((claim) => claimMap("EPISTEMIC_RECORD", claim)),
    ...sourceFuture.map((claim) => claimMap("SOURCE_FUTURE", claim)),
    ...authoring.runtimeFacts.map((fact) => referenceMap("RUNTIME_FACT", fact.factId, fact.sourceClaimIds, evidencePackage)),
    ...authoring.contextCards.map((card) => referenceMap("CONTEXT_CARD", card.cardId, card.sourceClaimIds, evidencePackage))
  ];
  const entities = extractEntities(evidencePackage);
  const withoutHash = {
    schemaVersion: "compiled_world_bible_v1" as const,
    worldId: authoring.worldId,
    version: authoring.version,
    sourceEvidence: {
      packageId: evidencePackage.manifest.packageId,
      packageVersion: evidencePackage.manifest.packageVersion,
      sourceSha256: evidencePackage.manifest.source.sha256
    },
    reviewGate,
    shadowOnly: true as const,
    startPoint: authoring.startPoint,
    historicalBaselineClaimIds: historicalBaseline.map((claim) => claim.claimId),
    epistemicClaimIds: epistemic.map((claim) => claim.claimId),
    sourceFutureClaimIds: sourceFuture.map((claim) => claim.claimId),
    entities,
    runtimeFacts: authoring.runtimeFacts,
    contextCards: authoring.contextCards,
    continuity: evidencePackage.continuity,
    sourceMap
  };
  return { ...withoutHash, manifestHash: sha256Canonical(withoutHash) };
}

export function writeWorldBible(repoRoot?: string): { worldBible: CompiledWorldBible; worldBiblePath: string; sourceMapPath: string } {
  const paths = openovelPaths(repoRoot);
  const worldBible = compileWorldBible(paths.repoRoot);
  mkdirSync(paths.worldBibleRoot, { recursive: true });
  writeFileSync(paths.worldBiblePath, prettyJson(worldBible), "utf8");
  writeFileSync(paths.worldBibleSourceMapPath, prettyJson(worldBible.sourceMap), "utf8");
  return { worldBible, worldBiblePath: paths.worldBiblePath, sourceMapPath: paths.worldBibleSourceMapPath };
}

function assertWorldBibleAuthoring(authoring: WorldBibleAuthoring, evidencePackage: EvidencePackage): void {
  if (authoring.schemaVersion !== "world_bible_authoring_v1") throw new Error("WORLD_BIBLE_AUTHORING_SCHEMA_INVALID");
  if (authoring.worldId !== evidencePackage.manifest.worldId) throw new Error("WORLD_BIBLE_WORLD_MISMATCH");
  if (authoring.evidencePackageId !== evidencePackage.manifest.packageId) throw new Error("WORLD_BIBLE_EVIDENCE_PACKAGE_MISMATCH");
  if (!authoring.version || !authoring.startPoint?.startPointId || !authoring.startPoint.sourceCutoffChapterId) {
    throw new Error("WORLD_BIBLE_IDENTITY_MISSING");
  }
  if (!Array.isArray(authoring.runtimeFacts) || !Array.isArray(authoring.contextCards)) {
    throw new Error("WORLD_BIBLE_COLLECTIONS_INVALID");
  }
}

function validateWorldBibleReferences(authoring: WorldBibleAuthoring, evidencePackage: EvidencePackage, sourceFutureIds: Set<string>): void {
  const claims = new Set(evidencePackage.claims.map((claim) => claim.claimId));
  const factIds = new Set<string>();
  for (const fact of authoring.runtimeFacts) {
    if (factIds.has(fact.factId)) throw new Error(`WORLD_BIBLE_FACT_DUPLICATE: ${fact.factId}`);
    factIds.add(fact.factId);
    if (!fact.sourceClaimIds.length || fact.sourceClaimIds.some((claimId) => !claims.has(claimId))) {
      throw new Error(`WORLD_BIBLE_FACT_SOURCE_MISSING: ${fact.factId}`);
    }
    if (fact.origin === "T0_EVIDENCE" && fact.sourceClaimIds.some((claimId) => sourceFutureIds.has(claimId))) {
      throw new Error(`WORLD_BIBLE_SOURCE_FUTURE_EXPOSED: ${fact.factId}`);
    }
  }
  const cardIds = new Set<string>();
  for (const card of authoring.contextCards) {
    if (cardIds.has(card.cardId)) throw new Error(`WORLD_BIBLE_CARD_DUPLICATE: ${card.cardId}`);
    cardIds.add(card.cardId);
    if (!card.groundedFactIds.length || card.groundedFactIds.some((factId) => !factIds.has(factId))) {
      throw new Error(`WORLD_BIBLE_CARD_FACT_MISSING: ${card.cardId}`);
    }
    if (!card.sourceClaimIds.length || card.sourceClaimIds.some((claimId) => !claims.has(claimId))) {
      throw new Error(`WORLD_BIBLE_CARD_SOURCE_MISSING: ${card.cardId}`);
    }
  }
}

function claimMap(targetType: WorldBibleSourceMapEntry["targetType"], claim: EvidenceClaim): WorldBibleSourceMapEntry {
  return { targetType, targetId: claim.claimId, sourceClaimIds: [claim.claimId], sourceHashes: [claim.evidence.excerptSha256] };
}

function referenceMap(
  targetType: WorldBibleSourceMapEntry["targetType"],
  targetId: string,
  sourceClaimIds: string[],
  evidencePackage: EvidencePackage
): WorldBibleSourceMapEntry {
  const claimById = new Map(evidencePackage.claims.map((claim) => [claim.claimId, claim]));
  return {
    targetType,
    targetId,
    sourceClaimIds,
    sourceHashes: sourceClaimIds.map((claimId) => claimById.get(claimId)!.evidence.excerptSha256)
  };
}

function extractEntities(evidencePackage: EvidencePackage): CompiledWorldBible["entities"] {
  const ids = new Set<string>();
  for (const claim of evidencePackage.claims) {
    if (claim.subjectId) ids.add(claim.subjectId);
    if (claim.speakerId) ids.add(claim.speakerId);
    claim.knownByCharacterIds.forEach((id) => ids.add(id));
  }
  for (const continuity of evidencePackage.continuity) {
    continuity.activeLocations.forEach((id) => ids.add(id));
    continuity.characterPositions.forEach((item) => { ids.add(item.characterId); ids.add(item.locationId); });
    continuity.objectHolders.forEach((item) => { ids.add(item.objectId); ids.add(item.holderId); });
  }
  const sorted = [...ids].sort();
  return {
    characterIds: sorted.filter((id) => id.includes("-CHAR-")),
    institutionIds: sorted.filter((id) => id.includes("-INST-")),
    locationIds: sorted.filter((id) => id.includes("-LOC-")),
    objectIds: sorted.filter((id) => /-(?:DOC|OBJ)-/.test(id))
  };
}
