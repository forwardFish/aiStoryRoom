import {
  compileB0ChapterSettlementInputV1,
  isSha256,
  sha256Canonical,
  validateFrozenChapterBundleV1,
  validateRunRouteSnapshotV1,
  validateSealedChapterSettlementInputV1,
  validateWorldStateV1,
  type FrozenChapterBundleV1,
} from "@ai-story/shared";
import type { ChapterWorkingState } from "@ai-story/templates";
import {
  computeChapterSettlementRequestFingerprintV1,
  sealChapterCloseFenceV1,
  sealChapterSettlementSourceV1,
} from "../chapter-settlement/chapter-commit-record";
import { planChapterSettlementV1 } from "../chapter-settlement/chapter-settlement.orchestrator";
import type {
  AtomicChapterCommitRecordV1,
  ChapterSettlementSourceV1,
  ContentOwnedChapterPolicyPort,
  SettleChapterCommandV1,
} from "../chapter-settlement/types";
import type { PreparedAutomationActionBatchV1 } from "../decision-automation/contracts";
import {
  computePreparedAutomationActionBatchHashV1,
  planPreparedActionLedgerV1,
  type PreparedActionLedgerPlanV1,
} from "../decision-automation/prepared-action-batch";
import {
  computeChapterSettlementIdempotencyKeyV1,
} from "../integration/chapter-settlement.adapter";
import { buildChapterSettlementMaterialV1 } from "../persistence/chapter-settlement-source.prisma-adapter";
import { planBeatAuthorityDownstreamV1 } from "../projection-plan/authority-downstream";
import {
  compileSeatParticipationV1,
  compileSettlementInputV1,
  planBeatProgressionV1,
  planChapterOpeningV1,
  planRecordedActionsV1,
  type PlannedChapterOpeningV1,
} from "../orchestrator/chapter-orchestrator.service";
import type {
  AuthoredChapterRuntimeV1,
  ChapterAuthorityBaseV1,
  ChapterOrchestratorStateV1,
} from "../orchestrator/contracts";
import {
  validateAuthoredChapterRuntimeV1,
  validateOrchestratorStateV1,
  withOrchestratorHashV1,
} from "../orchestrator/validation";
import {
  appendBeatEventToWorkingLedgerProjection,
} from "../working-ledger/working-ledger";
import type {
  WorkingLedgerEventV1,
  WorkingLedgerProjectionV1,
} from "../working-ledger/contracts";
import { workingLedgerProjectionCacheHashV1 } from "../working-ledger/projection-cache";
import type { DecisionToNextProjectionSnapshotV1 } from "./snapshot-contract";

export interface N2CommittedAuthoritySourceV1 {
  routeHash: string;
  sourceFrozenHash: string;
  worldState: FrozenChapterBundleV1["frozenWorldState"];
}

/** Content lookup that cannot silently fall back to a repository read. */
export interface N2AuthoredChapterContentAuthorityPortV1 {
  loadFromAuthority(input: Readonly<{
    routeSnapshot: DecisionToNextProjectionSnapshotV1["routeSnapshot"];
    chapterId: "N2";
    authorityBase: ChapterAuthorityBaseV1;
    source: N2CommittedAuthoritySourceV1;
  }>): Promise<AuthoredChapterRuntimeV1>;
}

/** Working seed lookup bound to the just-planned frozen authority. */
export interface N2ChapterWorkingSeedAuthorityPortV1 {
  loadFromAuthority(input: Readonly<{
    routeSnapshot: DecisionToNextProjectionSnapshotV1["routeSnapshot"];
    chapter: AuthoredChapterRuntimeV1;
    authorityBase: ChapterAuthorityBaseV1;
    source: N2CommittedAuthoritySourceV1;
  }>): Promise<ChapterWorkingState>;
}

export interface N1DecisionToN2SettlementPlanV1 {
  schemaVersion: "pressure_n1_decision_to_n2_settlement_plan_v1";
  settlementSource: ChapterSettlementSourceV1;
  actionLedger: PreparedActionLedgerPlanV1;
  settlementInput: ReturnType<typeof compileSettlementInputV1>;
  seatParticipation: ReturnType<typeof compileSeatParticipationV1>;
  settlementMaterial: ReturnType<typeof buildChapterSettlementMaterialV1>;
  settlementCommand: SettleChapterCommandV1;
  settlementPolicyEvaluation: Awaited<ReturnType<ContentOwnedChapterPolicyPort["evaluateChapter"]>>;
  atomicRecord: AtomicChapterCommitRecordV1;
  postBeatProjection: WorkingLedgerProjectionV1;
  frozenOrchestratorState: ChapterOrchestratorStateV1;
  nextChapterDescriptor: AuthoredChapterRuntimeV1;
  nextWorkingSeed: ChapterWorkingState;
  nextOpeningNowMs: number;
  nextChapterOpening: PlannedChapterOpeningV1;
  chapterLedgerEvents: WorkingLedgerEventV1[];
  beatPlan: {
    event: PreparedAutomationActionBatchV1["beatPlan"]["event"];
    resolution: PreparedAutomationActionBatchV1["beatPlan"]["resolution"];
    narrativeJobs: PreparedAutomationActionBatchV1["beatPlan"]["narrativeJobs"];
    aEmotionEmissions: PreparedAutomationActionBatchV1["beatPlan"]["aEmotionEmissions"];
    downstreamManifest: PreparedAutomationActionBatchV1["beatPlan"]["downstreamManifest"];
  };
}

/**
 * Pure database-free N1 close planner. The three ports expose content-owned
 * deterministic computation only; no repository capability crosses this boundary.
 */
export async function planN1DecisionToN2SettlementV1(input: Readonly<{
  snapshot: DecisionToNextProjectionSnapshotV1;
  batch: PreparedAutomationActionBatchV1;
  settlementPolicy: ContentOwnedChapterPolicyPort;
  nextContent: N2AuthoredChapterContentAuthorityPortV1;
  nextSeed: N2ChapterWorkingSeedAuthorityPortV1;
}>): Promise<N1DecisionToN2SettlementPlanV1> {
  const route = validateRunRouteSnapshotV1(input.snapshot.routeSnapshot);
  const chapter = validateOrchestratorStateV1(input.snapshot.chapter);
  const descriptor = validateAuthoredChapterRuntimeV1(input.batch.chapterDescriptor);
  assertSnapshotAuthority(input.snapshot);
  assertBatchAuthority(input.snapshot, input.batch, descriptor);

  if (
    chapter.currentChapterId !== "N1"
    || input.snapshot.runtime.chapterId !== "N1"
    || input.snapshot.workingProjection.chapterId !== "N1"
    || input.batch.chapterId !== "N1"
    || descriptor.chapterId !== "N1"
  ) {
    invalid("N1_ONLY");
  }

  const decision = descriptor.decisions.find(
    (candidate) => candidate.decisionPointId === input.batch.decisionPointId,
  );
  if (!decision) invalid("BATCH_DECISION_NOT_AUTHORED");
  const nowMs = commonBatchTime(input.batch);
  const recordedState = planRecordedActionsV1(
    chapter,
    input.batch.actions.map(({ command }) => ({
      seatId: command.action.seatId,
      actionId: command.action.actionId,
      defaultCode: null,
      actionBudget: decision.execution.perSeatActionBudget[command.action.seatId]!,
    })),
    true,
  );
  assertCanonicalEqual(
    recordedState,
    input.batch.nextOrchestratorState,
    "RECORDED_ORCHESTRATOR_STATE_MISMATCH",
  );

  const actionPlan = planPreparedActionLedgerV1({
    projection: input.snapshot.workingProjection,
    actions: input.batch.actions,
  });
  const postBeatProjection = appendBeatEventToWorkingLedgerProjection(
    actionPlan.projection,
    input.batch.beatPlan.event,
  );
  const progression = planBeatProgressionV1({
    state: recordedState,
    descriptor,
    projection: postBeatProjection,
    resolution: input.batch.beatPlan.resolution,
    nowMs,
    participantMode: input.snapshot.routeSnapshot.participantMode,
  });
  if (!progression.settlementInput || progression.nextState.phase !== "SETTLING") {
    invalid("N1_BATCH_DID_NOT_CLOSE_CHAPTER");
  }
  assertCanonicalEqual(
    progression.nextState,
    input.batch.beatPlan.postBeatOrchestratorState,
    "POST_BEAT_ORCHESTRATOR_STATE_MISMATCH",
  );
  const settlementInput = compileSettlementInputV1(
    progression.nextState,
    descriptor,
    postBeatProjection,
  );
  const batchSettlementInput = input.batch.beatPlan.settlementInput
    ? validateSealedChapterSettlementInputV1(input.batch.beatPlan.settlementInput)
    : invalid("BATCH_SETTLEMENT_INPUT_MISSING");
  assertCanonicalEqual(
    settlementInput,
    progression.settlementInput,
    "COMPILED_SETTLEMENT_INPUT_MISMATCH",
  );
  assertCanonicalEqual(
    settlementInput,
    batchSettlementInput,
    "BATCH_SETTLEMENT_INPUT_MISMATCH",
  );

  const downstream = planBeatAuthorityDownstreamV1({
    projection: postBeatProjection,
    beatEvent: input.batch.beatPlan.event,
    contentPackageSha256: route.contentPackageSha256,
    committedAt: new Date(nowMs).toISOString(),
    humanSeatIds: route.humanSeatIdsAtStart,
  });
  assertCanonicalEqual(
    downstream.narrativeJobs,
    input.batch.beatPlan.narrativeJobs,
    "NARRATIVE_PLAN_MISMATCH",
  );
  assertCanonicalEqual(
    downstream.aEmotionEmissions,
    input.batch.beatPlan.aEmotionEmissions,
    "A_EMOTION_PLAN_MISMATCH",
  );
  assertCanonicalEqual(
    downstream.manifest,
    input.batch.beatPlan.downstreamManifest,
    "DOWNSTREAM_MANIFEST_MISMATCH",
  );

  const world = validateWorldStateV1(input.snapshot.world.state);
  if (
    world.worldSequence !== settlementInput.baseWorldSequence
    || world.stateHash !== settlementInput.baseWorldStateHash
  ) {
    invalid("SETTLEMENT_WORLD_AUTHORITY_MISMATCH");
  }
  const seatParticipation = compileSeatParticipationV1(
    progression.nextState.chapterSeatSummaries,
  );
  const settlementMaterial = buildChapterSettlementMaterialV1(
    seatParticipation,
    postBeatProjection,
    world,
  );
  const source = sealChapterSettlementSourceV1({
    schemaVersion: "pressure_chapter_settlement_source_v1",
    closeFence: sealChapterCloseFenceV1({
      schemaVersion: "pressure_chapter_close_fence_v1",
      runId: route.runId,
      chapterRuntimeId: chapter.chapterRuntimeId,
      chapterId: "N1",
      lifecycleState: "CHAPTER_SETTLING",
      closedWorkingRevision: postBeatProjection.state.revision,
      observedWorkingRevision: postBeatProjection.state.revision,
      closedWorkingStateHash: postBeatProjection.stateHash,
      observedWorkingStateHash: postBeatProjection.stateHash,
      closedDecisionLedgerHash: postBeatProjection.headHash,
      observedDecisionLedgerHash: postBeatProjection.headHash,
      closedActionCount: postBeatProjection.acceptedActions.size,
      observedActionCount: postBeatProjection.acceptedActions.size,
      baseWorldSequenceAtClose: settlementInput.baseWorldSequence,
      observedWorldSequence: world.worldSequence,
      baseWorldStateHashAtClose: settlementInput.baseWorldStateHash,
      observedWorldStateHash: world.stateHash,
      runRouteHashAtClose: route.routeHash,
      previousFrozenHashAtClose: settlementInput.previousFrozenHash,
      reservationLedgerHashAtClose: settlementInput.reservationLedgerHash,
      contentPolicyVersionAtClose: settlementInput.contentPolicyVersion,
      contentPolicyHashAtClose: settlementInput.contentPolicyHash,
      settlementContractVersionAtClose: settlementInput.settlementContractVersion,
      settlementContractHashAtClose: settlementInput.settlementContractHash,
    }),
    sealedInput: settlementInput,
    settlementMaterial,
    baseWorldState: world,
  });
  const idempotencyKey = computeChapterSettlementIdempotencyKeyV1({
    runId: route.runId,
    chapterRuntimeId: chapter.chapterRuntimeId,
    settlementInputHash: settlementInput.inputHash,
  });
  const requestFingerprint = computeChapterSettlementRequestFingerprintV1({
    runId: route.runId,
    chapterRuntimeId: chapter.chapterRuntimeId,
    idempotencyKey,
    sealedInputHash: settlementInput.inputHash,
  });
  const b0Input = compileB0ChapterSettlementInputV1({
    wireInput: source.sealedInput,
    settlementMaterial: source.settlementMaterial,
  });
  const policyEvaluation = await input.settlementPolicy.evaluateChapter({
    b0Input,
    baseWorldState: source.baseWorldState,
  });
  const settlementCommand: SettleChapterCommandV1 = {
    authorityTrigger: "CHAPTER_CLOSE",
    runId: route.runId,
    chapterRuntimeId: chapter.chapterRuntimeId,
    idempotencyKey,
    requestFingerprint,
  };
  const atomicRecord = planChapterSettlementV1({
    command: settlementCommand,
    source,
    policyEvaluation,
  });
  const bundle = validateFrozenChapterBundleV1(
    atomicRecord.frozenChapterBundle,
    chapter.authorityBase.previousFrozenHash,
  );
  if (
    bundle.chapterId !== "N1"
    || bundle.runId !== route.runId
    || bundle.decisionLedgerHash !== postBeatProjection.headHash
    || bundle.finalWorkingStateHash !== postBeatProjection.stateHash
  ) {
    invalid("FROZEN_BUNDLE_BINDING_MISMATCH");
  }

  const frozenOrchestratorState = freezeOrchestratorState(
    progression.nextState,
    bundle,
  );
  const authorityBase = frozenOrchestratorState.authorityBase;
  const authoritySource: N2CommittedAuthoritySourceV1 = {
    routeHash: route.routeHash,
    sourceFrozenHash: bundle.bundleHash,
    worldState: structuredClone(bundle.frozenWorldState),
  };
  const nextChapterDescriptor = validateAuthoredChapterRuntimeV1(
    await input.nextContent.loadFromAuthority({
      routeSnapshot: route,
      chapterId: "N2",
      authorityBase,
      source: authoritySource,
    }),
  );
  if (nextChapterDescriptor.chapterId !== "N2") {
    invalid("NEXT_CONTENT_NOT_N2");
  }
  const seed = await input.nextSeed.loadFromAuthority({
    routeSnapshot: route,
    chapter: nextChapterDescriptor,
    authorityBase,
    source: authoritySource,
  });
  if (
    seed.runId !== route.runId
    || seed.chapterId !== "N2"
    || seed.revision !== 0
  ) {
    invalid("NEXT_WORKING_SEED_BINDING_MISMATCH");
  }
  const nextChapterOpening = planChapterOpeningV1({
    routeSnapshot: route,
    chapter: nextChapterDescriptor,
    authorityBase,
    expected: frozenOrchestratorState,
    seed,
    nowMs,
  });
  if (
    nextChapterOpening.state.currentChapterId !== "N2"
    || nextChapterOpening.state.authorityBase.previousFrozenHash !== bundle.bundleHash
    || nextChapterOpening.projection.chapterId !== "N2"
  ) {
    invalid("NEXT_OPENING_BINDING_MISMATCH");
  }

  return {
    schemaVersion: "pressure_n1_decision_to_n2_settlement_plan_v1",
    settlementSource: source,
    actionLedger: actionPlan,
    settlementInput,
    seatParticipation,
    settlementMaterial,
    settlementCommand,
    settlementPolicyEvaluation: policyEvaluation,
    atomicRecord,
    postBeatProjection,
    frozenOrchestratorState,
    nextChapterDescriptor,
    nextWorkingSeed: structuredClone(seed),
    nextOpeningNowMs: nowMs,
    nextChapterOpening,
    chapterLedgerEvents: [
      ...actionPlan.events.map((event) => structuredClone(event)),
      structuredClone(input.batch.beatPlan.event),
    ],
    beatPlan: {
      event: structuredClone(input.batch.beatPlan.event),
      resolution: structuredClone(input.batch.beatPlan.resolution),
      narrativeJobs: structuredClone(downstream.narrativeJobs),
      aEmotionEmissions: structuredClone(downstream.aEmotionEmissions),
      downstreamManifest: structuredClone(downstream.manifest),
    },
  };
}

function assertSnapshotAuthority(snapshot: DecisionToNextProjectionSnapshotV1): void {
  const route = validateRunRouteSnapshotV1(snapshot.routeSnapshot);
  const chapter = validateOrchestratorStateV1(snapshot.chapter);
  if (
    snapshot.schemaVersion !== "pressure_decision_to_next_projection_snapshot_v1"
    || snapshot.request.roomId !== route.runId
    || snapshot.request.runId !== route.runId
    || snapshot.request.expectedRouteHash !== route.routeHash
    || snapshot.storedRoute.runId !== route.runId
    || snapshot.storedRoute.snapshot.routeHash !== route.routeHash
    || snapshot.runtime.runId !== route.runId
    || snapshot.runtime.chapterId !== chapter.currentChapterId
    || snapshot.runtime.id !== chapter.chapterRuntimeId
    || snapshot.runtime.routeHash !== route.routeHash
    || snapshot.runtime.workingRevision !== snapshot.workingProjection.state.revision
    || snapshot.runtime.workingStateHash !== snapshot.workingProjection.stateHash
    || snapshot.request.expectedWorkingRevision !== snapshot.runtime.workingRevision
    || snapshot.workingProjection.key.runId !== route.runId
    || snapshot.workingProjection.key.chapterRuntimeId !== chapter.chapterRuntimeId
    || snapshot.workingProjection.routeHash !== route.routeHash
    || snapshot.world.runId !== route.runId
    || snapshot.world.worldSequence !== snapshot.world.state.worldSequence
    || snapshot.world.state.stateHash !== chapter.authorityBase.baseWorldStateHash
    || snapshot.world.worldSequence !== chapter.authorityBase.baseWorldSequence
    || snapshot.seatAuthority.runId !== route.runId
    || snapshot.seatAuthority.routeHash !== route.routeHash
    || snapshot.submitSeat.seatId !== snapshot.request.seatId
    || snapshot.submitSeat.activeControllerId !== snapshot.request.subjectId
    || snapshot.submitSeat.controlEpoch !== snapshot.request.expectedControlEpoch
    || snapshot.submitSeat.submissionFenceToken !== snapshot.request.expectedSubmissionFenceToken
    || snapshot.viewer.runId !== route.runId
    || snapshot.viewer.subjectId !== snapshot.request.subjectId
    || snapshot.viewer.roleKey !== snapshot.request.seatId
    || snapshot.persistenceFence.seatStateHash !== snapshot.seatAuthority.stateHash
    || snapshot.persistenceFence.orchestratorPayload === null
    || snapshot.existingDecisionActionRows.length !== 0
  ) {
    invalid("SNAPSHOT_AUTHORITY_MISMATCH");
  }
  const expectedSnapshotHash = sha256Canonical({
    schemaVersion: snapshot.schemaVersion,
    request: snapshot.request,
    storedRouteHash: snapshot.storedRoute.recordHash,
    routeHash: route.routeHash,
    world: {
      version: snapshot.world.version,
      worldSequence: snapshot.world.worldSequence,
      reservedWorldSequence: snapshot.world.reservedWorldSequence,
      stateHash: snapshot.world.state.stateHash,
    },
    chapter: { revision: chapter.revision, orchestratorHash: chapter.orchestratorHash },
    runtime: snapshot.runtime,
    workingProjectionHash: workingLedgerProjectionCacheHashV1(snapshot.workingProjection),
    seat: {
      stateRevision: snapshot.seatAuthority.stateRevision,
      stateHash: snapshot.seatAuthority.stateHash,
      seatId: snapshot.submitSeat.seatId,
      controllerId: snapshot.submitSeat.activeControllerId,
      controlEpoch: snapshot.submitSeat.controlEpoch,
      submissionFenceToken: snapshot.submitSeat.submissionFenceToken,
    },
    viewer: snapshot.viewer,
    viewerPrivateProjection: snapshot.viewerPrivateProjection,
    viewerPresence: snapshot.viewerPresence,
    persistenceFence: snapshot.persistenceFence,
    existingDecisionActionRowsHash: sha256Canonical(snapshot.existingDecisionActionRows),
    projectionSeedHash: sha256Canonical(snapshot.projectionSeed),
    capturedAtMs: snapshot.capturedAtMs,
  });
  if (snapshot.snapshotHash !== expectedSnapshotHash) invalid("SNAPSHOT_HASH_MISMATCH");
}

function assertBatchAuthority(
  snapshot: DecisionToNextProjectionSnapshotV1,
  batch: PreparedAutomationActionBatchV1,
  descriptor: AuthoredChapterRuntimeV1,
): void {
  const { batchHash: _batchHash, ...body } = batch;
  const chapter = snapshot.chapter;
  if (
    batch.batchHash !== computePreparedAutomationActionBatchHashV1(body)
    || !isSha256(batch.snapshotHash)
    || batch.runId !== snapshot.routeSnapshot.runId
    || batch.routeHash !== snapshot.routeSnapshot.routeHash
    || batch.chapterRuntimeId !== chapter.chapterRuntimeId
    || batch.chapterId !== chapter.currentChapterId
    || batch.decisionPointId !== chapter.activeDecision?.decisionPointId
    || batch.expectedOrchestratorRevision !== chapter.revision
    || batch.expectedOrchestratorHash !== chapter.orchestratorHash
    || batch.expectedWorkingRevision !== snapshot.workingProjection.state.revision
    || batch.expectedWorkingStateHash !== snapshot.workingProjection.stateHash
    || batch.expectedLedgerHeadHash !== snapshot.workingProjection.headHash
    || batch.expectedSeatAuthorityStateHash !== snapshot.seatAuthority.stateHash
    || descriptor.descriptorHash !== chapter.descriptorHash
    || batch.actions.length === 0
  ) {
    invalid("BATCH_AUTHORITY_MISMATCH");
  }
  for (const item of batch.actions) {
    if (
      item.command.routeSnapshot.routeHash !== batch.routeHash
      || item.command.action.runId !== batch.runId
      || item.command.action.chapterRuntimeId !== batch.chapterRuntimeId
      || item.command.action.chapterId !== batch.chapterId
      || item.command.action.decisionPointId !== batch.decisionPointId
      || item.authority.snapshotHash !== batch.snapshotHash
      || item.authority.expectedOrchestratorRevision !== chapter.revision
      || item.authority.expectedOrchestratorHash !== chapter.orchestratorHash
      || item.authority.expectedDescriptorHash !== descriptor.descriptorHash
      || item.authority.expectedWorkingRevision !== snapshot.workingProjection.state.revision
      || item.authority.expectedWorkingStateHash !== snapshot.workingProjection.stateHash
      || item.authority.expectedLedgerHeadHash !== snapshot.workingProjection.headHash
      || item.authority.expectedSeatAuthorityStateHash !== snapshot.seatAuthority.stateHash
    ) {
      invalid("PREPARED_ACTION_AUTHORITY_MISMATCH");
    }
  }
}

function commonBatchTime(batch: PreparedAutomationActionBatchV1): number {
  const nowMs = batch.actions[0]?.command.nowMs;
  if (
    !Number.isSafeInteger(nowMs)
    || Number(nowMs) < 0
    || batch.actions.some((item) => item.command.nowMs !== nowMs)
  ) {
    invalid("BATCH_TIME_MISMATCH");
  }
  return Number(nowMs);
}

function freezeOrchestratorState(
  stateValue: ChapterOrchestratorStateV1,
  bundle: FrozenChapterBundleV1,
): ChapterOrchestratorStateV1 {
  const state = validateOrchestratorStateV1(stateValue);
  if (state.phase !== "SETTLING" || state.currentChapterId !== "N1") {
    invalid("SETTLING_STATE_REQUIRED");
  }
  const { orchestratorHash: _orchestratorHash, ...body } = state;
  return withOrchestratorHashV1({
    ...body,
    revision: state.revision + 1,
    phase: "FROZEN",
    activeDecision: null,
    frozenBundleHash: bundle.bundleHash,
    authorityBase: {
      baseWorldSequence: bundle.committedWorldSequence,
      baseWorldStateHash: bundle.committedWorldStateHash,
      previousFrozenHash: bundle.bundleHash,
    },
  });
}

function assertCanonicalEqual(left: unknown, right: unknown, code: string): void {
  if (sha256Canonical(left) !== sha256Canonical(right)) invalid(code);
}

function invalid(code: string): never {
  throw new Error(`PRESSURE_SQL7_SETTLEMENT_PLANNER_INVALID:${code}`);
}
