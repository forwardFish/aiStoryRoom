import {
  PRESSURE_CHAPTER_SEAT_IDS_V1,
  compareCanonicalText,
  isSha256,
  nextChapterId,
  sha256Canonical,
  validateChapterSettlementEvaluationV1,
  validateSealedChapterSettlementInputV1,
  validateWorldStateV1,
  type ChapterIdV1,
  type ChapterSettlementEvaluationV1,
  type ScalarFactValueV1,
  type SealedChapterSettlementInputV1,
  type WorldStateV1,
} from "@ai-story/shared";
import {
  SANGTIAN_CONTENT_ERROR_CODES_V1 as ERROR,
  failSangtianContentV1,
} from "./errors";
import { loadSangtianPressureChapterPackageV1 } from "./loader";
import type {
  LoadedSangtianPressureChapterPackageV1,
  SangtianChapterPolicyMaterialV1,
  SangtianChapterSettlementBranchV1,
  SangtianSettlementPredicateV1,
} from "./types";

export interface CompileSangtianChapterPolicyMaterialInputV1 {
  settlementInput: SealedChapterSettlementInputV1;
  settlementFacts: Record<string, ScalarFactValueV1>;
  package?: LoadedSangtianPressureChapterPackageV1;
}

export interface EvaluateContentOwnedChapterPolicyInputV1
  extends CompileSangtianChapterPolicyMaterialInputV1 {
  currentWorldState: WorldStateV1;
}

/** Compile content-owned policy into the explicit, stable material consumed by B0. */
export function compileSangtianChapterPolicyMaterialV1(
  request: CompileSangtianChapterPolicyMaterialInputV1,
): SangtianChapterPolicyMaterialV1 {
  const settlementInput = validateSealedChapterSettlementInputV1(request.settlementInput);
  const loaded = request.package ?? loadSangtianPressureChapterPackageV1();
  const chapter = loaded.content.chapters.find((item) => item.chapterId === settlementInput.chapterId);
  if (!chapter) invalid("policy.chapterId", settlementInput.chapterId);
  const expectedPolicyHash = sha256Canonical(chapter.settlementPolicy);
  if (
    settlementInput.contentPolicyVersion !== chapter.settlementPolicy.policyVersion
    || settlementInput.contentPolicyHash !== expectedPolicyHash
  ) {
    invalid("policy.contentPolicy", "FROZEN_POLICY_MISMATCH");
  }
  const branch = selectBranch(chapter.settlementPolicy.branches, request.settlementFacts);
  const outcomeFactRef = `chapter.${chapter.chapterId}.outcome_band`;
  const withoutHash = {
    schemaVersion: "sangtian_chapter_policy_material_v1" as const,
    chapterId: chapter.chapterId,
    inputHash: settlementInput.inputHash,
    contentPolicyVersion: chapter.settlementPolicy.policyVersion,
    contentPolicyHash: expectedPolicyHash,
    branchId: branch.branchId,
    outcomeBand: branch.outcomeBand,
    factAssignments: [{
      factRef: outcomeFactRef,
      value: branch.outcomeBand,
      sourceRefs: [...branch.sourceRefs],
    }],
    trackDelta: structuredClone(branch.trackDelta),
    seatArcProgressDelta: branch.seatArcProgressDelta,
    objectRefs: [...branch.objectRefs],
    evidenceRefs: [...branch.evidenceRefs],
    carryForwardRefs: [...branch.carryForwardRefs],
    sourceRefs: sortedUnique([
      ...chapter.sourceRefs,
      ...branch.sourceRefs,
    ]),
  };
  return Object.freeze({
    ...withoutHash,
    materialHash: sha256Canonical(withoutHash),
  });
}

/**
 * Pure policy evaluation. It emits a canonical evaluation but does not commit,
 * increment worldSequence, call a Provider, or write through a repository.
 */
export function evaluateContentOwnedChapterPolicyV1(
  request: EvaluateContentOwnedChapterPolicyInputV1,
): ChapterSettlementEvaluationV1 {
  const settlementInput = validateSealedChapterSettlementInputV1(request.settlementInput);
  const currentWorldState = validateWorldStateV1(request.currentWorldState);
  if (
    currentWorldState.worldSequence !== settlementInput.baseWorldSequence
    || currentWorldState.stateHash !== settlementInput.baseWorldStateHash
  ) invalid("policy.currentWorldState", "STALE_BASE_WORLD");
  const material = compileSangtianChapterPolicyMaterialV1(request);
  const outcomeFact = material.factAssignments[0]!;
  const outcomeRef = `${outcomeFact.factRef}.${String(outcomeFact.value).toLowerCase()}`;
  const seatArcDeltas = PRESSURE_CHAPTER_SEAT_IDS_V1.map((seatId) => {
    const before = currentWorldState.seatArcs[seatId];
    const gainRefs = material.outcomeBand === "HIGH"
      ? sortedUnique([...before.gainRefs, outcomeRef])
      : [...before.gainRefs];
    const lossRefs = material.outcomeBand === "LOW"
      ? sortedUnique([...before.lossRefs, outcomeRef])
      : [...before.lossRefs];
    const costRefs = material.outcomeBand === "MID"
      ? sortedUnique([...before.costRefs, outcomeRef])
      : [...before.costRefs];
    const afterWithoutHash = {
      seatId,
      arcStage: `${material.chapterId}_${material.outcomeBand}_FROZEN`,
      publicGoalProgress: before.publicGoalProgress + material.seatArcProgressDelta,
      privateGoalProgress: before.privateGoalProgress + material.seatArcProgressDelta,
      gainRefs,
      lossRefs,
      costRefs,
    };
    return {
      seatId,
      beforeStateHash: before.stateHash,
      afterState: {
        ...afterWithoutHash,
        stateHash: sha256Canonical(afterWithoutHash),
      },
      sourceRefs: [...material.sourceRefs],
    };
  });
  const objectStates = material.objectRefs.map((objectRef) => {
    const before = currentWorldState.objects.find((item) => item.objectId === objectRef);
    if (!before) invalid("policy.objectRefs", `MISSING_${objectRef}`);
    return {
      ...structuredClone(before),
      version: before.version + 1,
      stateCode: `${material.chapterId}_${material.outcomeBand}_FROZEN`,
      tags: sortedUnique([...before.tags, outcomeRef]),
      factRefs: sortedUnique([...before.factRefs, outcomeFact.factRef]),
    };
  }).sort((left, right) => compareCanonicalText(left.objectId, right.objectId));
  const knowledgeStates = PRESSURE_CHAPTER_SEAT_IDS_V1.map((seatId) => {
    const before = currentWorldState.knowledgeBySeat[seatId];
    const withoutHash = {
      seatId,
      knownFactRefs: sortedUnique([...before.knownFactRefs, outcomeFact.factRef]),
      secretRefs: [...before.secretRefs],
      disclosedToSeatIds: [...before.disclosedToSeatIds],
    };
    return { ...withoutHash, stateHash: sha256Canonical(withoutHash) };
  });
  const carryWithoutHash = {
    nextChapterId: nextChapterId(material.chapterId),
    unlockedContentRefs: [`content.${nextChapterId(material.chapterId)}`],
    unresolvedCommitmentRefs: [],
    pendingConsequenceRefs: [...material.carryForwardRefs],
  };
  const withoutHash = {
    schemaVersion: "sangtian_chapter_settlement_evaluation_v1" as const,
    inputHash: settlementInput.inputHash,
    worldDelta: {
      factMutations: [{
        factRef: outcomeFact.factRef,
        before: currentWorldState.factValues[outcomeFact.factRef] ?? null,
        after: outcomeFact.value,
      }],
      resourceMutations: [],
    },
    seatArcDeltas,
    trackDelta: structuredClone(material.trackDelta),
    objectKnowledgeEvidenceResponsibilityDelta: {
      objectStates,
      knowledgeStates,
      evidenceStates: material.evidenceRefs.map((evidenceId) => ({
        evidenceId,
        version: 1,
        status: "SEALED" as const,
        holderSeatIds: [...PRESSURE_CHAPTER_SEAT_IDS_V1],
        supportsFactRefs: [outcomeFact.factRef],
        visibilityPolicyRef: "visibility.public.chapter_outcome",
      })),
      responsibilityStates: [],
    },
    causalEdges: [{
      causeRef: `policy.${material.contentPolicyVersion}.${material.branchId}`,
      effectRef: outcomeFact.factRef,
      relation: "SUPPORTS" as const,
      evidenceRefs: [...material.evidenceRefs],
    }],
    carryForward: {
      ...carryWithoutHash,
      carryForwardHash: sha256Canonical(carryWithoutHash),
    },
  };
  return validateChapterSettlementEvaluationV1({
    ...withoutHash,
    evaluationHash: sha256Canonical(withoutHash),
  }, settlementInput.inputHash);
}

export function contentPolicyHashForChapterV1(
  chapterId: ChapterIdV1,
  loaded = loadSangtianPressureChapterPackageV1(),
): string {
  const chapter = loaded.content.chapters.find((item) => item.chapterId === chapterId);
  if (!chapter) invalid("policy.chapterId", chapterId);
  return sha256Canonical(chapter.settlementPolicy);
}

function selectBranch(
  branches: readonly SangtianChapterSettlementBranchV1[],
  facts: Record<string, ScalarFactValueV1>,
): SangtianChapterSettlementBranchV1 {
  for (const branch of branches) {
    if (matches(branch.selector, facts)) return branch;
  }
  return invalid("policy.branches", "NO_MATCH");
}

function matches(
  predicate: SangtianSettlementPredicateV1,
  facts: Record<string, ScalarFactValueV1>,
): boolean {
  if (predicate.op === "DEFAULT") return true;
  if (predicate.op === "ALL" || predicate.op === "ANY") {
    return predicate.op === "ALL"
      ? predicate.clauses.every((clause) => matches(clause, facts))
      : predicate.clauses.some((clause) => matches(clause, facts));
  }
  if (predicate.op === "MIN_COMPARE") {
    const values = predicate.factRefs.map((factRef) => requiredNumber(facts, factRef));
    return compare(Math.min(...values), predicate.comparator, predicate.value);
  }
  if (!("factRef" in predicate)) invalid("policy.selector", "UNSUPPORTED_PREDICATE");
  if (!(predicate.factRef in facts)) invalid("policy.settlementFacts", `MISSING_${predicate.factRef}`);
  const actual = facts[predicate.factRef]!;
  if (predicate.comparator === "IN") {
    return (predicate.value as ScalarFactValueV1[]).some((item) => item === actual);
  }
  if (predicate.comparator === "EQ") return actual === predicate.value;
  if (predicate.comparator === "NE") return actual !== predicate.value;
  if (typeof actual !== "number" || typeof predicate.value !== "number") {
    invalid("policy.settlementFacts", `NON_NUMERIC_${predicate.factRef}`);
  }
  return compare(actual, predicate.comparator, predicate.value);
}

function requiredNumber(
  facts: Record<string, ScalarFactValueV1>,
  factRef: string,
): number {
  const value = facts[factRef];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    invalid("policy.settlementFacts", `MISSING_OR_NON_NUMERIC_${factRef}`);
  }
  return value;
}

function compare(
  actual: number,
  comparator: "GT" | "GTE" | "LT" | "LTE",
  expected: number,
): boolean {
  if (comparator === "GT") return actual > expected;
  if (comparator === "GTE") return actual >= expected;
  if (comparator === "LT") return actual < expected;
  return actual <= expected;
}

function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values)].sort(compareCanonicalText);
}

function invalid(path: string, detail?: string): never {
  failSangtianContentV1(ERROR.SETTLEMENT_POLICY_INVALID, path, detail);
}

export function assertSangtianPolicyMaterialV1(
  material: SangtianChapterPolicyMaterialV1,
): SangtianChapterPolicyMaterialV1 {
  if (!isSha256(material.inputHash) || !isSha256(material.contentPolicyHash)) {
    invalid("policy.material", "HASH");
  }
  const withoutHash = Object.fromEntries(
    Object.entries(material).filter(([key]) => key !== "materialHash"),
  );
  if (sha256Canonical(withoutHash) !== material.materialHash) {
    invalid("policy.materialHash", "MISMATCH");
  }
  return material;
}
