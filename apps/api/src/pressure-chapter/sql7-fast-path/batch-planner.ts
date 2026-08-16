import {
  PRESSURE_CHAPTER_SEAT_IDS_V1,
  compareCanonicalText,
  sha256Canonical,
} from "@ai-story/shared";
import {
  SangtianAuthoritativeBeatCompilerV1,
  planSynchronizedDecisionBeatV1,
} from "../integration/working-ledger.adapters";
import {
  planBeatProgressionV1,
  planRecordedActionsV1,
} from "../orchestrator/chapter-orchestrator.service";
import type {
  AuthoredChapterRuntimeV1,
  SubmitOrchestratedActionCommandV1,
} from "../orchestrator/contracts";
import { validateAuthoredChapterRuntimeV1 } from "../orchestrator/validation";
import { planBeatAuthorityDownstreamV1 } from "../projection-plan/authority-downstream";
import { appendBeatEventToWorkingLedgerProjection } from "../working-ledger/working-ledger";
import {
  assertCompiledAiDecisionCommandV1,
  classifyPendingDecisionSeatsV1,
  prepareDecisionHumanActionV1,
  validateAiDecisionPolicySelectionV1,
  validateDecisionConvergenceSnapshotV1,
  withDecisionConvergenceSnapshotHashV1,
} from "../decision-automation/convergence.service";
import type {
  AppendPreparedAutomationActionCommandV1,
  DecisionAutomationCommandCompilerPortV1,
  DecisionAutomationContentPortV1,
  PreparedAutomationActionBatchV1,
  PublishedContentOwnedAiDecisionPolicyPortV1,
} from "../decision-automation/contracts";
import {
  canonicalizePreparedAutomationActionsV1,
  createPreparedAutomationActionBatchV1,
  planPreparedActionLedgerV1,
} from "../decision-automation/prepared-action-batch";
import { buildAiDecisionPolicyInputV1 } from "../decision-automation/service";
import type { DecisionToNextProjectionSnapshotV1 } from "./snapshot-contract";

export interface PressureSql7BatchPlannerPortsV1 {
  content: Pick<DecisionAutomationContentPortV1, "load">;
  policy: PublishedContentOwnedAiDecisionPolicyPortV1;
  compiler: Pick<DecisionAutomationCommandCompilerPortV1, "compile">;
}

export interface PressureSql7BatchPlannerInputV1 {
  snapshot: DecisionToNextProjectionSnapshotV1;
  humanCommand: SubmitOrchestratedActionCommandV1;
  nowMs: number;
}

/**
 * DB-free first-submit planner for the SQL7 path. Its ports expose only
 * published content selection and deterministic command compilation; no
 * persistence, Provider, model, network, clock or retry capability is present.
 */
export async function planPressureSql7PreparedAutomationActionBatchV1(
  input: Readonly<PressureSql7BatchPlannerInputV1>,
  ports: Readonly<PressureSql7BatchPlannerPortsV1>,
): Promise<PreparedAutomationActionBatchV1> {
  assertPlannerInput(input);
  const source = input.snapshot;
  const route = source.routeSnapshot;
  const convergenceSnapshot = validateDecisionConvergenceSnapshotV1(
    withDecisionConvergenceSnapshotHashV1({
      schemaVersion: "pressure_decision_convergence_authority_snapshot_v1",
      routeSnapshot: route,
      chapter: source.chapter,
      projection: source.workingProjection,
      seatAuthority: source.seatAuthority,
      aiPolicyArtifactHash: ports.policy.artifactSha256,
      capturedAtMs: source.capturedAtMs,
    }),
    source.request.runId,
    source.request.expectedRouteHash,
    ports.policy.artifactSha256,
  );
  const chapter = convergenceSnapshot.chapter;
  const active = chapter.activeDecision!;
  const classified = classifyPendingDecisionSeatsV1(convergenceSnapshot);
  if (classified.humans.length !== 1 || classified.ai.length !== 5) {
    invalid("pendingSeats", `EXPECTED_1_HUMAN_5_AI:${classified.humans.length}:${classified.ai.length}`);
  }
  if (
    active.seats.length !== PRESSURE_CHAPTER_SEAT_IDS_V1.length
    || active.seats.some((seat) => (
      seat.requirement !== "REQUIRED"
      || seat.completion !== "PENDING"
      || seat.actionIds.length !== 0
      || seat.actionCount !== 0
    ))
  ) invalid("activeDecision.seats", "ALL_SIX_REQUIRED_PENDING");

  const human = prepareDecisionHumanActionV1(
    convergenceSnapshot,
    classified.humans,
    input.humanCommand,
  );
  if (!human) invalid("humanCommand", "FIRST_SUBMIT_REPLAY");
  if (human.command.nowMs !== input.nowMs) {
    invalid("humanCommand.nowMs", "REQUEST_CLOCK_MISMATCH");
  }

  const descriptor = validateAuthoredChapterRuntimeV1(await ports.content.load({
    routeSnapshot: route,
    chapterId: chapter.currentChapterId,
  }));
  assertDescriptorBinding(descriptor, chapter.currentChapterId, chapter.descriptorHash);
  const decision = descriptor.decisions.find(
    (candidate) => candidate.decisionPointId === active.decisionPointId,
  );
  if (!decision || sha256Canonical(decision) !== active.policyHash) {
    invalid("content.decision", "POLICY_HASH_MISMATCH");
  }
  const eligibleActionTypes = [...new Set(decision.execution.allowedActionTypes)]
    .sort(compareCanonicalText);
  if (eligibleActionTypes.length === 0) {
    invalid("content.allowedActionTypes", "EMPTY");
  }

  const prepared: AppendPreparedAutomationActionCommandV1[] = [human];
  for (const item of classified.ai) {
    if (decision.seatRequirements[item.seat.seatId] !== "REQUIRED") {
      invalid("content.seatRequirements", item.seat.seatId);
    }
    const policyInput = buildAiDecisionPolicyInputV1({
      runId: route.runId,
      routeHash: route.routeHash,
      runSeed: route.runSeed,
      contentPackageVersion: route.contentPackageVersion,
      contentPackageSha256: route.contentPackageSha256,
      chapterRuntimeId: chapter.chapterRuntimeId,
      chapterId: chapter.currentChapterId,
      decisionPointId: active.decisionPointId,
      seatId: item.seat.seatId,
      eligibleActionTypes,
    });
    const selection = validateAiDecisionPolicySelectionV1(
      await ports.policy.select(policyInput),
      policyInput,
      route.contentPackageVersion,
      route.contentPackageSha256,
      ports.policy.artifactSha256,
    );
    const compiled = ports.compiler.compile({
      routeSnapshot: route,
      chapter,
      projection: convergenceSnapshot.projection,
      seatAuthority: {
        seatId: item.authority.seatId,
        activeControllerId: item.authority.activeControllerId,
        controlEpoch: item.authority.controlEpoch,
        submissionFenceToken: item.authority.submissionFenceToken,
      },
      selection,
      nowMs: input.nowMs,
    });
    if (compiled.kind !== "COMMAND") {
      invalid("compiler.result", `FIRST_SUBMIT_REPLAY:${item.seat.seatId}`);
    }
    assertCompiledAiDecisionCommandV1(
      convergenceSnapshot,
      item.authority,
      selection,
      compiled.command,
    );
    prepared.push({
      command: compiled.command,
      authority: {
        actorKind: "AI",
        snapshotHash: convergenceSnapshot.snapshotHash,
        expectedOrchestratorRevision: chapter.revision,
        expectedOrchestratorHash: chapter.orchestratorHash,
        expectedDescriptorHash: chapter.descriptorHash,
        expectedDecisionPolicyHash: active.policyHash,
        expectedWorkingRevision: convergenceSnapshot.projection.state.revision,
        expectedWorkingStateHash: convergenceSnapshot.projection.stateHash,
        expectedLedgerHeadHash: convergenceSnapshot.projection.headHash,
        expectedSeatAuthorityStateHash: convergenceSnapshot.seatAuthority.stateHash,
        expectedControllerId: item.authority.activeControllerId,
        expectedControlEpoch: item.authority.controlEpoch,
        expectedSubmissionFenceToken: item.authority.submissionFenceToken,
        expectedAiPolicyHash: selection.policyHash,
      },
    });
  }

  const canonicalPrepared = canonicalizePreparedAutomationActionsV1(route, prepared);
  assertCanonicalActionSet(canonicalPrepared);
  const recordedState = planRecordedActionsV1(
    chapter,
    canonicalPrepared.map((item) => ({
      seatId: item.command.action.seatId,
      actionId: item.command.action.actionId,
      defaultCode: null,
      actionBudget: decision.execution.perSeatActionBudget[item.command.action.seatId]!,
    })),
    true,
  );
  const actionPlan = planPreparedActionLedgerV1({
    projection: convergenceSnapshot.projection,
    actions: canonicalPrepared,
  });
  const actionIds = [...new Set(
    recordedState.activeDecision?.seats.flatMap((seat) => seat.actionIds) ?? [],
  )].sort(compareCanonicalText);
  if (actionIds.length !== PRESSURE_CHAPTER_SEAT_IDS_V1.length) {
    invalid("recordedActions", "SIX_UNIQUE_ACTIONS_REQUIRED");
  }
  const beat = planSynchronizedDecisionBeatV1({
    routeSnapshot: route,
    chapterDefinition: descriptor.definition,
    chapterRuntimeId: chapter.chapterRuntimeId,
    actionIds,
    resolverVersion: "pressure_orchestrated_beat_v1",
    projection: actionPlan.projection,
    decisionPolicy: new SangtianAuthoritativeBeatCompilerV1(),
  });
  if (beat.status !== "PLANNED") invalid("beatPlan", "FIRST_SUBMIT_REPLAY");
  const postBeatProjection = appendBeatEventToWorkingLedgerProjection(
    actionPlan.projection,
    beat.event,
  );
  const progression = planBeatProgressionV1({
    state: recordedState,
    descriptor,
    projection: postBeatProjection,
    resolution: beat.resolution,
    nowMs: input.nowMs,
    participantMode: input.snapshot.routeSnapshot.participantMode,
  });
  const downstream = planBeatAuthorityDownstreamV1({
    projection: postBeatProjection,
    beatEvent: beat.event,
    contentPackageSha256: route.contentPackageSha256,
    committedAt: new Date(input.nowMs).toISOString(),
    humanSeatIds: route.humanSeatIdsAtStart,
  });

  const batchId = `decision_batch_${sha256Canonical({
    schemaVersion: "pressure_sql7_first_submit_batch_identity_v1",
    snapshotHash: source.snapshotHash,
    convergenceSnapshotHash: convergenceSnapshot.snapshotHash,
    humanActionId: human.command.action.actionId,
    nowMs: input.nowMs,
  }).slice(0, 32)}`;
  return createPreparedAutomationActionBatchV1({
    batchId,
    snapshotHash: convergenceSnapshot.snapshotHash,
    routeSnapshot: route,
    chapterRuntimeId: chapter.chapterRuntimeId,
    chapterId: chapter.currentChapterId,
    decisionPointId: active.decisionPointId,
    expectedOrchestratorRevision: chapter.revision,
    expectedOrchestratorHash: chapter.orchestratorHash,
    expectedWorkingRevision: convergenceSnapshot.projection.state.revision,
    expectedWorkingStateHash: convergenceSnapshot.projection.stateHash,
    expectedLedgerHeadHash: convergenceSnapshot.projection.headHash,
    expectedSeatAuthorityStateHash: convergenceSnapshot.seatAuthority.stateHash,
    actions: canonicalPrepared,
    chapterDescriptor: descriptor,
    nextOrchestratorState: recordedState,
    beatPlan: {
      event: beat.event,
      resolution: beat.resolution,
      postBeatOrchestratorState: progression.nextState,
      settlementInput: progression.settlementInput,
      narrativeJobs: downstream.narrativeJobs,
      aEmotionEmissions: downstream.aEmotionEmissions,
      downstreamManifest: downstream.manifest,
    },
  });
}

function assertPlannerInput(input: Readonly<PressureSql7BatchPlannerInputV1>): void {
  const { snapshot, humanCommand, nowMs } = input;
  if (!Number.isSafeInteger(nowMs) || nowMs < 0) invalid("nowMs", "NON_NEGATIVE_INTEGER_REQUIRED");
  if (
    snapshot.schemaVersion !== "pressure_decision_to_next_projection_snapshot_v1"
    || snapshot.request.runId !== snapshot.routeSnapshot.runId
    || snapshot.request.expectedRouteHash !== snapshot.routeSnapshot.routeHash
    || snapshot.chapter.currentChapterId !== "N1"
    || snapshot.runtime.chapterId !== "N1"
    || snapshot.runtime.id !== snapshot.chapter.chapterRuntimeId
    || snapshot.workingProjection.key.chapterRuntimeId !== snapshot.chapter.chapterRuntimeId
    || snapshot.workingProjection.state.revision !== snapshot.request.expectedWorkingRevision
    || humanCommand.routeSnapshot.routeHash !== snapshot.routeSnapshot.routeHash
  ) invalid("snapshot", "N1_AUTHORITY_BINDING_MISMATCH");
  const active = snapshot.chapter.activeDecision;
  if (!active || snapshot.chapter.phase !== "ACTIVE") {
    invalid("chapter", "ACTIVE_DECISION_REQUIRED");
  }
  if (active.decisionPointId !== snapshot.request.decisionPointId) {
    invalid("chapter.activeDecision", "DECISION_POINT_MISMATCH");
  }
  if (active.deadlineAtMs !== null && nowMs >= active.deadlineAtMs) {
    invalid("chapter.activeDecision.deadlineAtMs", "EXPIRED");
  }
}

function assertDescriptorBinding(
  descriptor: AuthoredChapterRuntimeV1,
  chapterId: AuthoredChapterRuntimeV1["chapterId"],
  descriptorHash: string,
): void {
  if (descriptor.chapterId !== chapterId || descriptor.descriptorHash !== descriptorHash) {
    invalid("content.descriptor", "FROZEN_BINDING_MISMATCH");
  }
}

function assertCanonicalActionSet(
  actions: readonly AppendPreparedAutomationActionCommandV1[],
): void {
  if (actions.length !== PRESSURE_CHAPTER_SEAT_IDS_V1.length) {
    invalid("actions", "SIX_ACTIONS_REQUIRED");
  }
  const actorKinds = actions.map((item) => item.authority.actorKind);
  if (actorKinds.filter((kind) => kind === "HUMAN").length !== 1) {
    invalid("actions", "ONE_HUMAN_REQUIRED");
  }
  if (actorKinds.filter((kind) => kind === "AI").length !== 5) {
    invalid("actions", "FIVE_AI_REQUIRED");
  }
  const seatIds = actions.map((item) => item.command.action.seatId);
  if (
    new Set(seatIds).size !== PRESSURE_CHAPTER_SEAT_IDS_V1.length
    || seatIds.some((seatId, index) => seatId !== PRESSURE_CHAPTER_SEAT_IDS_V1[index])
  ) invalid("actions", "CANONICAL_SIX_SEAT_ORDER_REQUIRED");
}

function invalid(field: string, reason: string): never {
  throw new Error(`PRESSURE_SQL7_BATCH_PLANNER_INVALID:${field}:${reason}`);
}
