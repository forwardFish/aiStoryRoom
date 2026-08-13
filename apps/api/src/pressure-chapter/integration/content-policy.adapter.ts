import {
  compareCanonicalText,
  compileB0ChapterSettlementInputV1,
  sha256Canonical,
  validateWorldStateV1,
  type B0ChapterPolicyEvaluationDraftV1,
  type B0ChapterSettlementInputV1,
  type B0ChapterWorldMutationV1,
  type CanonicalJsonValue,
  type ChapterSettlementEvaluationV1,
  type WorldStateV1,
} from "@ai-story/shared";
import {
  evaluateContentOwnedChapterPolicyV1,
  loadPublishedSangtianActionReleaseV1,
  loadSangtianPressureChapterPackageV1,
  type PublishedSangtianActionReleaseV1,
} from "@ai-story/templates";
import type { ContentOwnedChapterPolicyPort } from "../chapter-settlement/types";
import { failPressureChapterIntegration } from "./errors";

/**
 * Production content-policy bridge. It executes the accepted templates policy
 * and only translates its canonical result into B0's internal execution DTO.
 * Settlement facts come exclusively from sealed action identities compiled by
 * the published action-effect release; payload/free text is never rule input.
 */
export class SangtianContentOwnedChapterPolicyAdapterV1
implements ContentOwnedChapterPolicyPort {
  private readonly loaded = loadSangtianPressureChapterPackageV1();

  constructor(
    private readonly actionEffects: PublishedSangtianActionReleaseV1 =
      loadPublishedSangtianActionReleaseV1(),
  ) {}

  async evaluateChapter(input: Readonly<{
    b0Input: Readonly<B0ChapterSettlementInputV1>;
    baseWorldState: Readonly<WorldStateV1>;
  }>): Promise<B0ChapterPolicyEvaluationDraftV1> {
    const b0Input = assertB0Input(input.b0Input);
    const baseWorldState = validateWorldStateV1(input.baseWorldState);
    const chapter = this.loaded.content.chapters.find(
      (candidate) => candidate.chapterId === b0Input.wireInput.chapterId,
    );
    if (!chapter) invalid("contentPolicy.chapterId", "UNKNOWN_CHAPTER");
    const settlementFacts = compileSettlementFacts(
      this.actionEffects,
      b0Input,
    );
    const evaluation = evaluateContentOwnedChapterPolicyV1({
      settlementInput: b0Input.wireInput,
      currentWorldState: baseWorldState,
      settlementFacts,
      package: this.loaded,
    });
    if (
      evaluation.inputHash !== b0Input.wireInput.inputHash
      || b0Input.wireInput.contentPolicyVersion
        !== chapter.settlementPolicy.policyVersion
      || b0Input.wireInput.contentPolicyHash
        !== sha256Canonical(chapter.settlementPolicy)
    ) {
      invalid("contentPolicy.binding", "INPUT_OR_POLICY_MISMATCH");
    }
    return compileB0Draft(b0Input, baseWorldState, evaluation);
  }
}

function assertB0Input(
  input: Readonly<B0ChapterSettlementInputV1>,
): B0ChapterSettlementInputV1 {
  const recomputed = compileB0ChapterSettlementInputV1({
    wireInput: input.wireInput,
    settlementMaterial: input.settlementMaterial,
  });
  if (
    recomputed.b0InputHash !== input.b0InputHash
    || recomputed.runChapterFingerprint !== input.runChapterFingerprint
  ) {
    invalid("contentPolicy.b0Input", "HASH_MISMATCH");
  }
  return recomputed;
}

function compileSettlementFacts(
  actionEffects: PublishedSangtianActionReleaseV1,
  input: Readonly<B0ChapterSettlementInputV1>,
): Record<string, string | number | boolean | null> {
  const actions = input.settlementMaterial.actions;
  const allDefaultPass = actions.every(
    (action) => action.actionType === "DEFAULT_PASS",
  );
  try {
    return actionEffects.compileChapterActionEffects({
      chapterId: input.wireInput.chapterId,
      confirmedActions: actions.map((action) => ({
        actionId: action.actionId,
        decisionPointKey: action.decisionPointId,
        seatId: action.seatId,
        actionType: action.actionType,
      })),
      defaultEvents: allDefaultPass
        ? [{
          eventId: `default_trajectory_${input.runChapterFingerprint}`,
          eventType: "APPLY_DEFAULT_TRAJECTORY",
        }]
        : [],
    }).settlementFacts;
  } catch (error) {
    invalid(
      "contentPolicy.actionEffects",
      error instanceof Error ? error.message : "RELEASE_COMPILATION_FAILED",
    );
  }
}

function compileB0Draft(
  input: Readonly<B0ChapterSettlementInputV1>,
  world: Readonly<WorldStateV1>,
  evaluation: Readonly<ChapterSettlementEvaluationV1>,
): B0ChapterPolicyEvaluationDraftV1 {
  const originActionIds = [...input.wireInput.sealedDecisionActionIds]
    .sort(compareCanonicalText);
  if (originActionIds.length === 0) {
    invalid("contentPolicy.actions", "AT_LEAST_ONE_SEALED_ACTION_REQUIRED");
  }
  const mutationIdsByEffect = new Map<string, string>();
  const mutations: B0ChapterWorldMutationV1[] = [];
  for (const mutation of evaluation.worldDelta.factMutations) {
    const mutationId = mutation.factRef;
    addMutation(mutations, mutationIdsByEffect, mutation.factRef, {
      mutationId,
      entityType: "WORLD",
      entityId: mutation.factRef,
      attribute: "canonical.fact",
      operation: "SET",
      value: { before: mutation.before, after: mutation.after },
      originActionIds,
    });
  }
  for (const state of evaluation.objectKnowledgeEvidenceResponsibilityDelta.objectStates) {
    addMutation(mutations, mutationIdsByEffect, state.objectId, {
      mutationId: `object.${state.objectId}`,
      // `canonical.object` is a carrier DTO; B0's entityType is not persisted
      // as the object's authored kind and must not be guessed here.
      entityType: "DOCUMENT",
      entityId: state.objectId,
      attribute: "canonical.object",
      operation: "SET",
      value: structuredClone(state) as unknown as CanonicalJsonValue,
      originActionIds,
    });
  }
  for (const state of evaluation.objectKnowledgeEvidenceResponsibilityDelta.knowledgeStates) {
    addMutation(mutations, mutationIdsByEffect, `knowledge.${state.seatId}`, {
      mutationId: `knowledge.${state.seatId}`,
      entityType: "ACTOR",
      entityId: state.seatId,
      attribute: "canonical.knowledge",
      operation: "SET",
      value: structuredClone(state) as unknown as CanonicalJsonValue,
      originActionIds,
    });
  }
  for (const state of evaluation.objectKnowledgeEvidenceResponsibilityDelta.evidenceStates) {
    addMutation(mutations, mutationIdsByEffect, `evidence.${state.evidenceId}`, {
      mutationId: `evidence.${state.evidenceId}`,
      entityType: "EVIDENCE",
      entityId: state.evidenceId,
      attribute: "canonical.evidence",
      operation: "SET",
      value: structuredClone(state) as unknown as CanonicalJsonValue,
      originActionIds,
    });
  }
  for (const state of evaluation.objectKnowledgeEvidenceResponsibilityDelta.responsibilityStates) {
    addMutation(mutations, mutationIdsByEffect, `responsibility.${state.responsibilityId}`, {
      mutationId: `responsibility.${state.responsibilityId}`,
      entityType: "INSTITUTION",
      entityId: state.responsibilityId,
      attribute: "canonical.responsibility",
      operation: "SET",
      value: structuredClone(state) as unknown as CanonicalJsonValue,
      originActionIds,
    });
  }
  const actionEvidence = new Set(
    input.settlementMaterial.actions.flatMap((action) => action.evidenceRefs),
  );
  const sealedContentEvidence = new Map(
    evaluation.objectKnowledgeEvidenceResponsibilityDelta.evidenceStates
      .filter((state) => state.status === "SEALED")
      .map((state) => [state.evidenceId, state] as const),
  );
  const causalEdges = evaluation.causalEdges.map((edge) => {
    const mutationId = mutationIdsByEffect.get(edge.effectRef);
    if (!mutationId) {
      invalid(`contentPolicy.causalEdges.${edge.effectRef}`, "UNKNOWN_EFFECT");
    }
    if (edge.evidenceRefs.some((ref) => {
      if (actionEvidence.has(ref)) return false;
      const contentEvidence = sealedContentEvidence.get(ref);
      return !contentEvidence
        || !contentEvidence.supportsFactRefs.includes(edge.effectRef);
    })) {
      invalid(`contentPolicy.causalEdges.${edge.effectRef}`, "UNSEALED_EVIDENCE_REF");
    }
    const body = {
      fromActionIds: originActionIds,
      toMutationIds: [mutationId],
      relation: edge.relation,
      evidenceRefs: [...edge.evidenceRefs].sort(compareCanonicalText),
    };
    return {
      edgeId: `edge.${sha256Canonical(body)}`,
      ...body,
    };
  }).sort((left, right) => compareCanonicalText(left.edgeId, right.edgeId));
  return {
    schemaVersion: "b0_chapter_policy_evaluation_v1",
    b0InputHash: input.b0InputHash,
    contentPolicyVersion: input.wireInput.contentPolicyVersion,
    contentPolicyHash: input.wireInput.contentPolicyHash,
    resourceDispositions: compileResourceDispositions(input, world, evaluation),
    mutations: mutations.sort(
      (left, right) => compareCanonicalText(left.mutationId, right.mutationId),
    ),
    seatArcDeltas: evaluation.seatArcDeltas.map((delta) => ({
      seatId: delta.seatId,
      delta: structuredClone(delta) as unknown as CanonicalJsonValue,
    })),
    trackDelta: structuredClone(evaluation.trackDelta) as CanonicalJsonValue,
    carryForward: structuredClone(evaluation.carryForward) as unknown as CanonicalJsonValue,
    causalEdges,
  };
}

function compileResourceDispositions(
  input: Readonly<B0ChapterSettlementInputV1>,
  world: Readonly<WorldStateV1>,
  evaluation: Readonly<ChapterSettlementEvaluationV1>,
): B0ChapterPolicyEvaluationDraftV1["resourceDispositions"] {
  const commitments = input.settlementMaterial.actions.flatMap((action) =>
    action.resourceCommitments.map((commitment) => ({
      ...commitment,
      actionId: action.actionId,
    })),
  );
  if (commitments.length === 0) {
    if (evaluation.worldDelta.resourceMutations.length !== 0) {
      invalid("contentPolicy.resourceMutations", "NO_SEALED_COMMITMENT");
    }
    return [];
  }
  const demand = new Map<string, { amount: number; actionIds: Set<string> }>();
  for (const commitment of commitments) {
    const aggregate = demand.get(commitment.resourceId) ?? {
      amount: 0,
      actionIds: new Set<string>(),
    };
    aggregate.amount += commitment.amount;
    aggregate.actionIds.add(commitment.actionId);
    demand.set(commitment.resourceId, aggregate);
  }
  if (evaluation.worldDelta.resourceMutations.length !== demand.size) {
    invalid("contentPolicy.resourceMutations", "EXACT_CONSUMPTION_RULE_REQUIRED");
  }
  for (const [resourceId, aggregate] of demand) {
    const mutation = evaluation.worldDelta.resourceMutations.find(
      (candidate) => candidate.resourceId === resourceId,
    );
    const before = world.resources[resourceId];
    if (
      !mutation
      || before === undefined
      || mutation.before !== before
      || mutation.after !== before - aggregate.amount
      || [...aggregate.actionIds].some((actionId) => !mutation.sourceRefs.includes(actionId))
    ) {
      invalid(
        `contentPolicy.resourceMutations.${resourceId}`,
        "SEALED_CONSUMPTION_MISMATCH",
      );
    }
  }
  return commitments
    .map((commitment) => ({
      commitmentId: commitment.commitmentId,
      disposition: "CONSUMED" as const,
    }))
    .sort((left, right) => compareCanonicalText(left.commitmentId, right.commitmentId));
}

function addMutation(
  target: B0ChapterWorldMutationV1[],
  byEffect: Map<string, string>,
  effectRef: string,
  mutation: B0ChapterWorldMutationV1,
): void {
  if (
    target.some((candidate) => candidate.mutationId === mutation.mutationId)
    || byEffect.has(effectRef)
  ) {
    invalid(`contentPolicy.mutations.${mutation.mutationId}`, "DUPLICATE");
  }
  target.push(structuredClone(mutation));
  byEffect.set(effectRef, mutation.mutationId);
}

function invalid(path: string, detail?: string): never {
  return failPressureChapterIntegration(
    "INTEGRATION_CONTENT_MISMATCH",
    path,
    detail,
  );
}
