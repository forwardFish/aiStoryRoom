import {
  PRESSURE_CHAPTER_SEAT_IDS_V1,
  compareCanonicalText,
  sha256Canonical,
  validateCausalEdgesV1,
  validateCarryForwardV1,
  validateChapterSettlementEvaluationV1,
  validateObjectKnowledgeEvidenceResponsibilityDeltaV1,
  validateSeatArcDeltasV1,
  validateTrackDeltaV1,
  validateWorldDeltaV1,
  nextChapterId,
  type B0ChapterSettlementInputV1,
  type B0ChapterSettlementResultV1,
  type CausalEdgeV1,
  type ChapterSettlementEvaluationV1,
  type EvidenceStateV1,
  type KnowledgeStateV1,
  type ObjectStateV1,
  type ResponsibilityStateV1,
  type ScalarFactValueV1,
  type SeatArcDeltaV1,
  type TrackDeltaV1,
  type WorldDeltaV1,
} from "@ai-story/shared";
import {
  CHAPTER_SETTLEMENT_ERROR_CODES as ERROR,
  failChapterSettlement,
} from "./errors";

const CANONICAL_RELATIONS = new Set<CausalEdgeV1["relation"]>([
  "ENABLES",
  "PREVENTS",
  "SUPPORTS",
  "CONFLICTS",
  "COSTS",
  "REVEALS",
  "ASSIGNS_RESPONSIBILITY",
]);

/**
 * The only B0-internal -> canonical conversion. B0 values never become a
 * second persisted settlement wire; this function emits the shared contract.
 */
export function adaptB0SettlementToCanonicalV1(
  input: Readonly<B0ChapterSettlementInputV1>,
  result: Readonly<B0ChapterSettlementResultV1>,
): ChapterSettlementEvaluationV1 {
  assertB0ResultBinding(input, result);

  const factMutations: WorldDeltaV1["factMutations"] = [];
  const objectStates: ObjectStateV1[] = [];
  const knowledgeStates: KnowledgeStateV1[] = [];
  const evidenceStates: EvidenceStateV1[] = [];
  const responsibilityStates: ResponsibilityStateV1[] = [];

  for (const mutation of result.worldDelta.mutations) {
    if (mutation.operation !== "SET") {
      invalidMutation(mutation.mutationId, "ONLY_SET_IS_CANONICAL");
    }
    const value = plainRecord(
      mutation.value,
      `b0.worldDelta.mutations.${mutation.mutationId}.value`,
    );
    if (mutation.attribute === "canonical.fact") {
      if (mutation.entityType !== "WORLD") {
        invalidMutation(mutation.mutationId, "FACT_REQUIRES_WORLD");
      }
      exactKeys(value, ["before", "after"], mutation.mutationId);
      if (!isScalar(value.before) || !isScalar(value.after)) {
        invalidMutation(mutation.mutationId, "FACT_REQUIRES_SCALARS");
      }
      factMutations.push({
        factRef: mutation.entityId,
        before: value.before,
        after: value.after,
      });
      continue;
    }
    if (mutation.attribute === "canonical.object") {
      if (mutation.entityType === "WORLD" || value.objectId !== mutation.entityId) {
        invalidMutation(mutation.mutationId, "OBJECT_ID_MISMATCH");
      }
      objectStates.push(value as unknown as ObjectStateV1);
      continue;
    }
    if (mutation.attribute === "canonical.knowledge") {
      if (mutation.entityType !== "ACTOR" || value.seatId !== mutation.entityId) {
        invalidMutation(mutation.mutationId, "KNOWLEDGE_SEAT_MISMATCH");
      }
      knowledgeStates.push(value as unknown as KnowledgeStateV1);
      continue;
    }
    if (mutation.attribute === "canonical.evidence") {
      if (
        mutation.entityType !== "EVIDENCE" ||
        value.evidenceId !== mutation.entityId
      ) {
        invalidMutation(mutation.mutationId, "EVIDENCE_ID_MISMATCH");
      }
      evidenceStates.push(value as unknown as EvidenceStateV1);
      continue;
    }
    if (mutation.attribute === "canonical.responsibility") {
      if (
        mutation.entityType !== "INSTITUTION" ||
        value.responsibilityId !== mutation.entityId
      ) {
        invalidMutation(mutation.mutationId, "RESPONSIBILITY_ID_MISMATCH");
      }
      responsibilityStates.push(value as unknown as ResponsibilityStateV1);
      continue;
    }
    invalidMutation(mutation.mutationId, `UNKNOWN_ATTRIBUTE_${mutation.attribute}`);
  }

  factMutations.sort((left, right) =>
    compareCanonicalText(left.factRef, right.factRef),
  );
  objectStates.sort((left, right) =>
    compareCanonicalText(left.objectId, right.objectId),
  );
  knowledgeStates.sort((left, right) => seatIndex(left.seatId) - seatIndex(right.seatId));
  evidenceStates.sort((left, right) =>
    compareCanonicalText(left.evidenceId, right.evidenceId),
  );
  responsibilityStates.sort((left, right) =>
    compareCanonicalText(left.responsibilityId, right.responsibilityId),
  );

  const worldDelta = validateWorldDeltaV1({
    factMutations,
    resourceMutations: result.worldDelta.resourceDeltas
      .map((delta) => ({
        resourceId: delta.resourceId,
        before: delta.baseQuantity,
        after: delta.committedQuantity,
        sourceRefs: [...delta.originActionIds].sort(compareCanonicalText),
      }))
      .sort((left, right) =>
        compareCanonicalText(left.resourceId, right.resourceId),
      ),
  });
  const seatArcDeltas = validateSeatArcDeltasV1(
    result.worldDelta.seatArcDeltas.map((entry) => {
      const delta = plainRecord(
        entry.delta,
        `b0.worldDelta.seatArcDeltas.${entry.seatId}.delta`,
      );
      if (delta.seatId !== entry.seatId) {
        failChapterSettlement(
          ERROR.B0_CANONICAL_ADAPTER_INVALID,
          `seatArcDeltas.${entry.seatId}`,
          "SEAT_ID_MISMATCH",
        );
      }
      return delta as unknown as SeatArcDeltaV1;
    }),
  );
  const trackDelta = validateTrackDeltaV1(
    result.worldDelta.trackDelta as TrackDeltaV1,
  );
  const carryForward = validateCarryForwardV1(result.worldDelta.carryForward);
  const expectedNext = nextChapterId(input.wireInput.chapterId);
  if (carryForward.nextChapterId !== expectedNext) {
    failChapterSettlement(
      ERROR.B0_CANONICAL_ADAPTER_INVALID,
      "carryForward.nextChapterId",
      `EXPECTED_${expectedNext}`,
    );
  }
  const causalEdges = expandCausalEdges(result);
  const objectKnowledgeEvidenceResponsibilityDelta =
    validateObjectKnowledgeEvidenceResponsibilityDeltaV1({
      objectStates,
      knowledgeStates,
      evidenceStates,
      responsibilityStates,
    });
  const evaluationBase = {
    schemaVersion: "sangtian_chapter_settlement_evaluation_v1" as const,
    inputHash: input.wireInput.inputHash,
    worldDelta,
    seatArcDeltas,
    trackDelta,
    objectKnowledgeEvidenceResponsibilityDelta,
    causalEdges,
    carryForward,
  };
  return validateChapterSettlementEvaluationV1(
    {
      ...evaluationBase,
      evaluationHash: sha256Canonical(evaluationBase),
    },
    input.wireInput.inputHash,
  );
}

function expandCausalEdges(
  result: Readonly<B0ChapterSettlementResultV1>,
): CausalEdgeV1[] {
  const edges: CausalEdgeV1[] = [];
  for (const edge of result.worldDelta.causalEdges) {
    if (!CANONICAL_RELATIONS.has(edge.relation as CausalEdgeV1["relation"])) {
      failChapterSettlement(
        ERROR.B0_CANONICAL_ADAPTER_INVALID,
        `causalEdges.${edge.edgeId}.relation`,
        edge.relation,
      );
    }
    for (const actionId of [...edge.fromActionIds].sort(compareCanonicalText)) {
      for (const mutationId of [...edge.toMutationIds].sort(compareCanonicalText)) {
        edges.push({
          causeRef: actionId,
          effectRef: mutationId,
          relation: edge.relation as CausalEdgeV1["relation"],
          evidenceRefs: [...edge.evidenceRefs].sort(compareCanonicalText),
        });
      }
    }
  }
  edges.sort((left, right) =>
    compareCanonicalText(
      `${left.causeRef}\0${left.effectRef}\0${left.relation}`,
      `${right.causeRef}\0${right.effectRef}\0${right.relation}`,
    ),
  );
  return validateCausalEdgesV1(edges);
}

function assertB0ResultBinding(
  input: Readonly<B0ChapterSettlementInputV1>,
  result: Readonly<B0ChapterSettlementResultV1>,
): void {
  if (
    result.receipt.runId !== input.wireInput.runId ||
    result.receipt.chapterRuntimeId !== input.wireInput.chapterRuntimeId ||
    result.receipt.chapterId !== input.wireInput.chapterId ||
    result.receipt.wireInputHash !== input.wireInput.inputHash ||
    result.receipt.b0InputHash !== input.b0InputHash ||
    result.worldDelta.wireInputHash !== input.wireInput.inputHash ||
    result.worldDelta.b0InputHash !== input.b0InputHash ||
    result.worldDelta.baseWorldSequence !== input.wireInput.baseWorldSequence ||
    result.worldDelta.committedWorldSequence !==
      input.wireInput.baseWorldSequence + 1
  ) {
    failChapterSettlement(
      ERROR.B0_CANONICAL_ADAPTER_INVALID,
      "b0Result",
      "INPUT_OR_SEQUENCE_MISMATCH",
    );
  }
}

function plainRecord(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    failChapterSettlement(ERROR.B0_CANONICAL_ADAPTER_INVALID, path, "OBJECT");
  }
  return value as Record<string, unknown>;
}

function exactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
  path: string,
): void {
  const actual = Object.keys(value).sort(compareCanonicalText);
  const expected = [...keys].sort(compareCanonicalText);
  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])
  ) {
    failChapterSettlement(
      ERROR.B0_CANONICAL_ADAPTER_INVALID,
      path,
      `EXACT_KEYS_${expected.join(",")}`,
    );
  }
}

function isScalar(value: unknown): value is ScalarFactValueV1 {
  return (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value))
  );
}

function invalidMutation(mutationId: string, detail: string): never {
  return failChapterSettlement(
    ERROR.B0_CANONICAL_ADAPTER_INVALID,
    `b0.worldDelta.mutations.${mutationId}`,
    detail,
  );
}

function seatIndex(seatId: string): number {
  return (PRESSURE_CHAPTER_SEAT_IDS_V1 as readonly string[]).indexOf(seatId);
}
