import {
  PRESSURE_CHAPTER_SEAT_IDS_V1,
  isSha256,
  sha256Canonical,
  type PressureChapterSubmitDecisionCommandV1,
} from "@ai-story/shared";
import type { PreparedAutomationActionBatchV1 } from "../decision-automation/contracts";
import type { PressureChapterGameProjectionV1 } from "../game-projection";
import type {
  PressureChapterHttpPrincipalV1,
  PressureChapterSubmitDecisionHttpResponseV1,
} from "../http/contracts";
import type { SubmitOrchestratedActionCommandV1 } from "../orchestrator/contracts";
import {
  logPressureDecisionTimingV1,
  pressureDecisionElapsedMsV1,
  pressureDecisionFailureCodeV1,
} from "../observability/decision-timing-log";
import type {
  CommittedDecisionToNextProjectionAuthorityV1,
  PressureSql7CommitPlanV1,
} from "./commit-contract";
import type {
  PressureSql7CommitResultV1,
} from "./prisma-commit";
import { classifyPressureSql7BatchProgressionV1 } from "./progression-gate";
import type {
  DecisionToNextProjectionSnapshotReaderPortV1,
  DecisionToNextProjectionSnapshotV1,
} from "./snapshot-contract";

export interface PressureSql7CommandCompilerPortV1 {
  compile(input: Readonly<{
    principal: PressureChapterHttpPrincipalV1;
    roomId: string;
    command: PressureChapterSubmitDecisionCommandV1;
    snapshot: DecisionToNextProjectionSnapshotV1;
    nowMs: number;
  }>): Promise<SubmitOrchestratedActionCommandV1> | SubmitOrchestratedActionCommandV1;
}

export interface PressureSql7PreparedBatchPlannerPortV1 {
  plan(input: Readonly<{
    snapshot: DecisionToNextProjectionSnapshotV1;
    humanCommand: SubmitOrchestratedActionCommandV1;
    nowMs: number;
  }>): Promise<PreparedAutomationActionBatchV1> | PreparedAutomationActionBatchV1;
}

export interface PressureSql7SettlementN2PlanBuilderPortV1 {
  build(input: Readonly<{
    snapshot: DecisionToNextProjectionSnapshotV1;
    humanCommand: SubmitOrchestratedActionCommandV1;
    batch: PreparedAutomationActionBatchV1;
    nowMs: number;
  }>): Promise<PressureSql7CommitPlanV1> | PressureSql7CommitPlanV1;
}

export interface PressureSql7CommitRepositoryPortV1 {
  commit(plan: Readonly<PressureSql7CommitPlanV1>): Promise<PressureSql7CommitResultV1>;
}

/** Pure bridge: it may consume the committed receipt but has no read port. */
export interface PressureSql7ReceiptProjectionPortV1 {
  project(input: Readonly<{
    snapshot: DecisionToNextProjectionSnapshotV1;
    authority: CommittedDecisionToNextProjectionAuthorityV1;
  }>): Promise<PressureChapterGameProjectionV1> | PressureChapterGameProjectionV1;
}

export type PressureSql7NotApplicableReasonV1 =
  | "INPUT_NOT_ELIGIBLE"
  | "SNAPSHOT_UNAVAILABLE"
  | "PRIOR_ACTION_REQUIRES_RECOVERY"
  | "INTERMEDIATE_BEAT_REQUIRES_GENERIC_COMMIT";

export type PressureSql7SubmitResultV1 =
  | {
      status: "NOT_APPLICABLE";
      reason: PressureSql7NotApplicableReasonV1;
    }
  | {
      status: "COMMITTED";
      response: PressureChapterSubmitDecisionHttpResponseV1;
      authority: CommittedDecisionToNextProjectionAuthorityV1;
      applicationSqlCount: number;
    }
  | {
      status: "REPLAYED";
      idempotencyKey: string;
      applicationSqlCount: 1;
    };

export interface PressureSql7SubmitInputV1 {
  principal: PressureChapterHttpPrincipalV1;
  roomId: string;
  command: PressureChapterSubmitDecisionCommandV1;
  nowMs: number;
}

/**
 * Typed orchestration boundary for the ordinary first N1 submit only.
 * Snapshot is its sole read capability and commit is its sole write capability.
 */
export class PressureSql7FirstSubmitServiceV1 {
  constructor(
    private readonly snapshots: DecisionToNextProjectionSnapshotReaderPortV1,
    private readonly compiler: PressureSql7CommandCompilerPortV1,
    private readonly batches: PressureSql7PreparedBatchPlannerPortV1,
    private readonly settlementN2: PressureSql7SettlementN2PlanBuilderPortV1,
    private readonly commits: PressureSql7CommitRepositoryPortV1,
    private readonly projections: PressureSql7ReceiptProjectionPortV1,
  ) {}

  async submit(input: Readonly<PressureSql7SubmitInputV1>): Promise<PressureSql7SubmitResultV1> {
    const totalStartedAt = performance.now();
    const timings: Record<string, number> = {
      snapshotMs: 0,
      humanCompileMs: 0,
      aiBatchPlanMs: 0,
      settlementPlanMs: 0,
      commitMs: 0,
      projectionMs: 0,
      totalMs: 0,
    };
    let outcome = "FAILED";
    let failureCode: string | null = null;
    try {
      if (!isEligibleFirstN1Submit(input)) {
        outcome = "NOT_APPLICABLE:INPUT_NOT_ELIGIBLE";
        return { status: "NOT_APPLICABLE", reason: "INPUT_NOT_ELIGIBLE" };
      }

      const snapshotStartedAt = performance.now();
      const snapshot = await this.snapshots.capture({
        roomId: input.roomId,
        runId: input.command.runId,
        subjectId: input.principal.subjectId,
        seatId: input.command.seatId,
        chapterRuntimeId: input.command.chapterRuntimeId,
        decisionPointId: input.command.decisionPointId,
        expectedRouteHash: input.command.routeHash,
        expectedWorkingRevision: input.command.expectedWorkingRevision,
        expectedControlEpoch: input.command.controlEpoch,
        expectedSubmissionFenceToken: input.command.submissionFenceToken,
        idempotencyKey: input.command.idempotencyKey,
        capturedAtMs: input.nowMs,
      });
      timings.snapshotMs = pressureDecisionElapsedMsV1(snapshotStartedAt);
      if (!snapshot) {
        outcome = "NOT_APPLICABLE:SNAPSHOT_UNAVAILABLE";
        return { status: "NOT_APPLICABLE", reason: "SNAPSHOT_UNAVAILABLE" };
      }
      if (snapshot.schemaVersion === "pressure_decision_to_next_projection_prior_action_snapshot_v1") {
        assertPriorActionReplayBinding(snapshot, input);
        if (!snapshot.settlementCompleted) {
          outcome = "NOT_APPLICABLE:PRIOR_ACTION_REQUIRES_RECOVERY";
          return { status: "NOT_APPLICABLE", reason: "PRIOR_ACTION_REQUIRES_RECOVERY" };
        }
        outcome = "REPLAYED";
        return {
          status: "REPLAYED",
          idempotencyKey: input.command.idempotencyKey,
          applicationSqlCount: 1,
        };
      }

      assertSnapshotBinding(snapshot, input);
      const humanCompileStartedAt = performance.now();
      const humanCommand = await this.compiler.compile({
        principal: structuredClone(input.principal),
        roomId: input.roomId,
        command: structuredClone(input.command),
        snapshot,
        nowMs: input.nowMs,
      });
      timings.humanCompileMs = pressureDecisionElapsedMsV1(humanCompileStartedAt);
      assertHumanCommandBinding(humanCommand, snapshot, input);

      const aiBatchPlanStartedAt = performance.now();
      const batch = await this.batches.plan({ snapshot, humanCommand, nowMs: input.nowMs });
      timings.aiBatchPlanMs = pressureDecisionElapsedMsV1(aiBatchPlanStartedAt);
      assertBatchBinding(batch, humanCommand, snapshot);
      const progression = classifyPressureSql7BatchProgressionV1(batch);
      if (progression.kind === "NEXT_BEAT") {
        // The existing generic convergence transaction owns intermediate Beat
        // commits. Returning NOT_APPLICABLE before any write avoids the old
        // first-N1-is-always-N2 assumption without creating a parallel writer.
        outcome = "NOT_APPLICABLE:INTERMEDIATE_BEAT_REQUIRES_GENERIC_COMMIT";
        return {
          status: "NOT_APPLICABLE",
          reason: "INTERMEDIATE_BEAT_REQUIRES_GENERIC_COMMIT",
        };
      }
      const settlementPlanStartedAt = performance.now();
      const commitPlan = await this.settlementN2.build({
        snapshot,
        humanCommand,
        batch,
        nowMs: input.nowMs,
      });
      timings.settlementPlanMs = pressureDecisionElapsedMsV1(settlementPlanStartedAt);
      assertCommitPlanBinding(commitPlan, humanCommand, snapshot);

      // From here on no NOT_APPLICABLE result is legal: a failed commit or an
      // incomplete receipt must surface as an error and must never fall back.
      const commitStartedAt = performance.now();
      const committed = await this.commits.commit(commitPlan);
      timings.commitMs = pressureDecisionElapsedMsV1(commitStartedAt);
      assertCommittedReceipt(committed, commitPlan, snapshot);
      const projectionStartedAt = performance.now();
      const projection = await this.projections.project({
        snapshot,
        authority: committed.authority,
      });
      timings.projectionMs = pressureDecisionElapsedMsV1(projectionStartedAt);
      assertPublicProjection(projection, input, committed.authority);

      outcome = "COMMITTED";
      return {
        status: "COMMITTED",
        response: {
          schemaVersion: "pressure_chapter_submit_decision_http_response_v1",
          idempotencyKey: input.command.idempotencyKey,
          projection: structuredClone(projection),
        },
        authority: structuredClone(committed.authority),
        applicationSqlCount: 1 + committed.queryBudget.applicationSqlCount,
      };
    } catch (error) {
      failureCode = pressureDecisionFailureCodeV1(error);
      throw error;
    } finally {
      timings.totalMs = pressureDecisionElapsedMsV1(totalStartedAt);
      logPressureDecisionTimingV1({
        path: "SQL7",
        runId: input.command.runId,
        chapterId: input.command.chapterId,
        decisionPointId: input.command.decisionPointId,
        outcome,
        failureCode,
        timings,
      });
    }
  }
}

function assertPriorActionReplayBinding(
  snapshot: Extract<
    Awaited<ReturnType<DecisionToNextProjectionSnapshotReaderPortV1["capture"]>>,
    { schemaVersion: "pressure_decision_to_next_projection_prior_action_snapshot_v1" }
  >,
  input: Readonly<PressureSql7SubmitInputV1>,
): void {
  if (!snapshot) integrity("PRIOR_ACTION_SNAPSHOT_MISSING");
  const { action, request } = snapshot;
  const expectedPayload = {
    optionCode: input.command.optionCode,
    customText: input.command.customText,
  };
  if (
    snapshot.capturedAtMs !== input.nowMs
    || request.roomId !== input.roomId
    || request.runId !== input.command.runId
    || request.subjectId !== input.principal.subjectId
    || request.idempotencyKey !== input.command.idempotencyKey
    || action.runId !== input.command.runId
    || action.chapterRuntimeId !== input.command.chapterRuntimeId
    || action.chapterId !== "N1"
    || action.decisionPointId !== input.command.decisionPointId
    || action.seatId !== input.command.seatId
    || action.controlEpoch !== input.command.controlEpoch
    || action.expectedWorkingRevision !== input.command.expectedWorkingRevision
    || action.idempotencyKey !== input.command.idempotencyKey
    || sha256Canonical(action.payload) !== sha256Canonical(expectedPayload)
  ) replayConflict();
}

function replayConflict(): never {
  const error = new Error("Pressure SQL7 replay idempotency conflict") as Error & {
    code: string;
    path: string;
  };
  error.code = "PRESSURE_SQL7_IDEMPOTENCY_CONFLICT";
  error.path = "decision.idempotencyKey";
  throw error;
}

function isEligibleFirstN1Submit(input: Readonly<PressureSql7SubmitInputV1>): boolean {
  const { command, principal } = input;
  return Boolean(
    principal?.subjectId?.trim()
    && principal.viewerId?.trim()
    && principal.subjectId === principal.viewerId
    && input.roomId?.trim()
    && input.roomId === command?.runId
    && command.commandType === "SUBMIT_DECISION"
    && command.chapterId === "N1"
    && command.decisionPointId === "N1.weir_crisis"
    && command.runId?.trim()
    && command.chapterRuntimeId?.trim()
    && command.decisionPointId?.trim()
    && command.idempotencyKey?.trim()
    && isSha256(command.routeHash)
    && isSha256(command.submissionFenceToken)
    && Number.isSafeInteger(command.expectedWorkingRevision)
    && command.expectedWorkingRevision >= 0
    && Number.isSafeInteger(command.controlEpoch)
    && command.controlEpoch >= 1
    && Number.isSafeInteger(input.nowMs)
    && input.nowMs >= 0
    && command.sourceEventId === null
    && ((command.optionCode !== null) !== (command.customText !== null))
  );
}

function assertSnapshotBinding(
  snapshot: DecisionToNextProjectionSnapshotV1,
  input: Readonly<PressureSql7SubmitInputV1>,
): void {
  const { command } = input;
  if (
    snapshot.schemaVersion !== "pressure_decision_to_next_projection_snapshot_v1"
    || !isSha256(snapshot.snapshotHash)
    || snapshot.capturedAtMs !== input.nowMs
    || snapshot.request.roomId !== input.roomId
    || snapshot.request.runId !== command.runId
    || snapshot.request.subjectId !== input.principal.subjectId
    || snapshot.request.seatId !== command.seatId
    || snapshot.request.chapterRuntimeId !== command.chapterRuntimeId
    || snapshot.request.decisionPointId !== command.decisionPointId
    || snapshot.request.expectedRouteHash !== command.routeHash
    || snapshot.request.expectedWorkingRevision !== command.expectedWorkingRevision
    || snapshot.request.expectedControlEpoch !== command.controlEpoch
    || snapshot.request.expectedSubmissionFenceToken !== command.submissionFenceToken
    || snapshot.request.idempotencyKey !== command.idempotencyKey
    || snapshot.routeSnapshot.runId !== command.runId
    || snapshot.routeSnapshot.routeHash !== command.routeHash
    || snapshot.chapter.runId !== command.runId
    || snapshot.chapter.currentChapterId !== "N1"
    || snapshot.chapter.chapterRuntimeId !== command.chapterRuntimeId
    || snapshot.runtime.id !== command.chapterRuntimeId
    || snapshot.runtime.chapterId !== "N1"
    || snapshot.runtime.workingRevision !== command.expectedWorkingRevision
    || snapshot.workingProjection.state.revision !== command.expectedWorkingRevision
    || !isSha256(snapshot.workingProjection.stateHash)
    || !isSha256(snapshot.workingProjection.headHash)
    || snapshot.viewer.subjectId !== input.principal.subjectId
    || snapshot.viewer.roleKey !== command.seatId
    || snapshot.submitSeat.seatId !== command.seatId
    || snapshot.submitSeat.activeControllerId !== input.principal.subjectId
    || snapshot.submitSeat.controlEpoch !== command.controlEpoch
    || snapshot.submitSeat.submissionFenceToken !== command.submissionFenceToken
    || snapshot.existingDecisionActionRows.length !== 0
  ) integrity("SNAPSHOT_BINDING_MISMATCH");
}

function assertHumanCommandBinding(
  compiled: SubmitOrchestratedActionCommandV1,
  snapshot: DecisionToNextProjectionSnapshotV1,
  input: Readonly<PressureSql7SubmitInputV1>,
): void {
  if (
    compiled.subjectId !== input.principal.subjectId
    || compiled.nowMs !== input.nowMs
    || compiled.routeSnapshot.runId !== input.command.runId
    || compiled.routeSnapshot.routeHash !== input.command.routeHash
    || compiled.action.runId !== input.command.runId
    || compiled.action.chapterRuntimeId !== input.command.chapterRuntimeId
    || compiled.action.chapterId !== "N1"
    || compiled.action.decisionPointId !== input.command.decisionPointId
    || compiled.action.seatId !== input.command.seatId
    || compiled.action.idempotencyKey !== input.command.idempotencyKey
    || !compiled.action.actionId?.trim()
    || !isSha256(compiled.inputFingerprint)
    || snapshot.workingProjection.actionsByIdempotencyKey.has(input.command.idempotencyKey)
  ) integrity("COMPILED_COMMAND_BINDING_MISMATCH");
}

function assertBatchBinding(
  batch: PreparedAutomationActionBatchV1,
  human: SubmitOrchestratedActionCommandV1,
  snapshot: DecisionToNextProjectionSnapshotV1,
): void {
  const seats = batch.actions.map((item) => item.command.action.seatId);
  const uniqueSeats = new Set(seats);
  const humanInBatch = batch.actions.filter(
    (item) => item.command.action.actionId === human.action.actionId,
  );
  if (
    !isSha256(batch.snapshotHash)
    || batch.runId !== snapshot.request.runId
    || batch.routeHash !== snapshot.request.expectedRouteHash
    || batch.chapterRuntimeId !== snapshot.request.chapterRuntimeId
    || batch.chapterId !== "N1"
    || batch.decisionPointId !== snapshot.request.decisionPointId
    || batch.actions.length !== PRESSURE_CHAPTER_SEAT_IDS_V1.length
    || uniqueSeats.size !== PRESSURE_CHAPTER_SEAT_IDS_V1.length
    || PRESSURE_CHAPTER_SEAT_IDS_V1.some((seatId) => !uniqueSeats.has(seatId))
    || humanInBatch.length !== 1
    || batch.actions.some((item) => item.authority.snapshotHash !== batch.snapshotHash)
    || !isSha256(batch.batchHash)
  ) integrity("PREPARED_BATCH_BINDING_MISMATCH");
}

function assertCommitPlanBinding(
  plan: PressureSql7CommitPlanV1,
  human: SubmitOrchestratedActionCommandV1,
  snapshot: DecisionToNextProjectionSnapshotV1,
): void {
  const { fence, worldTransition, receipt } = plan;
  if (
    plan.schemaVersion !== "pressure_sql7_commit_plan_v1"
    || fence.runId !== snapshot.request.runId
    || fence.routeHash !== snapshot.request.expectedRouteHash
    || fence.chapterRuntimeId !== snapshot.request.chapterRuntimeId
    || fence.chapterId !== "N1"
    || fence.expectedRuntimeLockVersion !== snapshot.runtime.lockVersion
    || fence.expectedWorkingRevision !== snapshot.runtime.workingRevision
    || fence.expectedWorkingStateHash !== snapshot.runtime.workingStateHash
    || fence.expectedOrchestrationHash !== snapshot.runtime.orchestrationHash
    || fence.expectedWorldSequence !== snapshot.world.worldSequence
    || fence.expectedReservedWorldSequence !== snapshot.world.reservedWorldSequence
    || fence.expectedSeatStateRevision !== snapshot.persistenceFence.seatStateRevision
    || fence.expectedSeatVersion !== snapshot.persistenceFence.seatVersion
    || fence.expectedSeatStateHash !== snapshot.persistenceFence.seatStateHash
    || fence.expectedViewerPlayerId !== snapshot.viewer.playerId
    || fence.expectedViewerUserId !== snapshot.viewer.subjectId
    || fence.submissionActionId !== human.action.actionId
    || fence.submissionIdempotencyKey !== human.action.idempotencyKey
    || fence.submissionRequestFingerprint !== human.action.requestFingerprint
    || worldTransition.nextRuntime.runId !== snapshot.request.runId
    || worldTransition.nextRuntime.chapterId !== "N2"
    || worldTransition.nextRuntime.chapterSequence !== 2
    || worldTransition.committedWorldSequence !== snapshot.world.worldSequence + 1
    || receipt.runId !== snapshot.request.runId
    || receipt.previousChapterRuntimeId !== snapshot.runtime.id
    || receipt.nextChapterRuntimeId !== worldTransition.nextRuntime.id
    || receipt.settlementId !== plan.settlement.id
    || receipt.committedWorldSequence !== worldTransition.committedWorldSequence
    || !isSha256(receipt.commitHash)
    || !receipt.projectionAuthority
    || typeof receipt.projectionAuthority !== "object"
  ) integrity("COMMIT_PLAN_BINDING_MISMATCH");
}

function assertCommittedReceipt(
  result: PressureSql7CommitResultV1,
  plan: PressureSql7CommitPlanV1,
  snapshot: DecisionToNextProjectionSnapshotV1,
): void {
  const authority = result.authority;
  if (
    result.status !== "COMMITTED"
    || authority.schemaVersion !== "pressure_committed_decision_to_next_projection_authority_v1"
    || authority.runId !== snapshot.request.runId
    || authority.previousChapterRuntimeId !== snapshot.runtime.id
    || authority.nextChapterRuntimeId !== plan.receipt.nextChapterRuntimeId
    || authority.settlementId !== plan.receipt.settlementId
    || authority.committedWorldSequence !== plan.receipt.committedWorldSequence
    || authority.commitHash !== plan.receipt.commitHash
    || !authority.projectionAuthority
    || typeof authority.projectionAuthority !== "object"
    || result.queryBudget.applicationSqlCount !== 6
    || result.queryBudget.maxApplicationSql !== 6
  ) integrity("COMMITTED_RECEIPT_INCOMPLETE");
}

function assertPublicProjection(
  projection: PressureChapterGameProjectionV1,
  input: Readonly<PressureSql7SubmitInputV1>,
  authority: CommittedDecisionToNextProjectionAuthorityV1,
): void {
  if (
    projection.schemaVersion !== "pressure_chapter_game_projection_v1"
    || projection.roomId !== input.roomId
    || projection.runId !== input.command.runId
    || projection.chapter.chapterId !== "N2"
    || projection.chapter.chapterRuntimeId !== authority.nextChapterRuntimeId
    || !isSha256(projection.projectionHash)
  ) integrity("PUBLIC_PROJECTION_BINDING_MISMATCH");
}

function integrity(detail: string): never {
  throw new Error(`PRESSURE_SQL7_SERVICE_INTEGRITY:${detail}`);
}
