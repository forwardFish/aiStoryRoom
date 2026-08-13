import {
  chapterSequence,
  compareCanonicalText,
  compileB0ChapterSettlementInputV1,
  isSha256,
  sha256Canonical,
  type B0ChapterPolicyEvaluationDraftV1,
} from "@ai-story/shared";
import type { ChapterWorkingState } from "@ai-story/templates";
import type {
  AtomicChapterCommitRecordV1,
  ChapterSettlementSourceV1,
  SettleChapterCommandV1,
} from "../chapter-settlement/types";
import type { planChapterSettlementV1 } from "../chapter-settlement/chapter-settlement.orchestrator";
import type {
  PreparedActionLedgerPlanV1,
} from "../decision-automation/prepared-action-batch";
import {
  computePreparedAutomationActionBatchHashV1,
} from "../decision-automation/prepared-action-batch";
import type { PreparedAutomationActionBatchV1 } from "../decision-automation/contracts";
import type { SubmitOrchestratedActionCommandV1 } from "../orchestrator/contracts";
import type {
  PlanSynchronizedDecisionBeatV1Input,
  SynchronizedDecisionBeatPlanV1,
} from "../integration/working-ledger.adapters";
import type {
  AuthoredChapterRuntimeV1,
  ChapterOrchestratorStateV1,
} from "../orchestrator/contracts";
import type {
  ProjectPressureChapterGameProjectionFromSourcesV1,
} from "../game-projection/contracts";
import type {
  PlannedChapterOpeningV1,
  compileSeatParticipationV1,
  compileSettlementInputV1,
  planChapterOpeningV1,
} from "../orchestrator/chapter-orchestrator.service";
import type { buildChapterSettlementMaterialV1 } from "../persistence/chapter-settlement-source.prisma-adapter";
import {
  preparedDecisionStateFromProjectionV1,
  serializePreparedLedgerProjectionV1,
} from "../persistence/prepared-automation-action.prisma-adapter";
import type { WorkingLedgerEventV1, WorkingLedgerProjectionV1 } from "../working-ledger/contracts";
import type { DecisionToNextProjectionSnapshotV1 } from "./snapshot-contract";
import type { PressureSql7SettlementN2PlanBuilderPortV1 } from "./service";
import {
  PressureSql7CommitErrorV1,
  type PressureSql7ChapterSettlementRowV1,
  type PressureSql7CommitPlanV1,
  type PressureSql7DecisionActionRowV1,
  type PressureSql7NarrativeProjectionRowV1,
  type PressureSql7OutboxTaskRowV1,
  type PressureSql7StoryEventRowV1,
  validatePressureSql7CommitPlanV1,
} from "./commit-contract";

type SettlementInputV1 = ReturnType<typeof compileSettlementInputV1>;
type SeatParticipationV1 = ReturnType<typeof compileSeatParticipationV1>;
type SettlementMaterialV1 = ReturnType<typeof buildChapterSettlementMaterialV1>;
type PlannedSettlementV1 = ReturnType<typeof planChapterSettlementV1>;
type PlannedOpeningV1 = ReturnType<typeof planChapterOpeningV1>;

/**
 * Results of the existing side-effect-free domain planners. The P4 builder
 * binds them; it does not duplicate their gameplay or settlement rules.
 */
export interface PressureSql7PreparedDomainPlanV1 {
  actionLedger: PreparedActionLedgerPlanV1;
  beat: Pick<SynchronizedDecisionBeatPlanV1, "status" | "event" | "resolution">
    & Partial<Omit<SynchronizedDecisionBeatPlanV1, "status" | "event" | "resolution">>;
  beatInput: Pick<PlanSynchronizedDecisionBeatV1Input, "resolverVersion">;
  postBeatProjection: WorkingLedgerProjectionV1;
  settlementInput: SettlementInputV1;
  seatParticipation: SeatParticipationV1;
  settlementMaterial: SettlementMaterialV1;
  settlementCommand: SettleChapterCommandV1;
  settlementPolicyEvaluation: B0ChapterPolicyEvaluationDraftV1;
  settlementRecord: PlannedSettlementV1 & AtomicChapterCommitRecordV1;
  frozenOrchestratorState: ChapterOrchestratorStateV1;
  nextChapter: AuthoredChapterRuntimeV1;
  nextWorkingSeed: ChapterWorkingState;
  nextOpeningNowMs: number;
  nextOpening: PlannedOpeningV1 & PlannedChapterOpeningV1;
}

/** Precompiled persistence rows from Narrative/A-Emotion planners. */
export interface PressureSql7PreparedDownstreamRowsV1 {
  narrativeProjections: readonly PressureSql7NarrativeProjectionRowV1[];
  aEmotionStoryEvents: readonly PressureSql7StoryEventRowV1[];
  outboxTasks: readonly PressureSql7OutboxTaskRowV1[];
  settlementDownstreamManifest: unknown;
}

export interface BuildPressureSql7CommitPlanInputV1 {
  snapshot: DecisionToNextProjectionSnapshotV1;
  batch: PreparedAutomationActionBatchV1;
  settlementSource: ChapterSettlementSourceV1;
  domain: PressureSql7PreparedDomainPlanV1;
  downstream: PressureSql7PreparedDownstreamRowsV1;
  committedAt: Date;
  resolvedProjectionSources: ProjectPressureChapterGameProjectionFromSourcesV1;
}

export type PressureSql7SettlementN2PreparedInputsV1 = Omit<
  BuildPressureSql7CommitPlanInputV1,
  "snapshot" | "batch" | "committedAt"
>;

/**
 * Read-free integration seam for inputs that cannot be inferred from the
 * four-argument service contract. A production implementation composes the
 * existing pure planners and projection-source resolvers; it must not query.
 */
export interface PressureSql7SettlementN2PreparedInputsPortV1 {
  prepare(input: Readonly<{
    snapshot: DecisionToNextProjectionSnapshotV1;
    humanCommand: SubmitOrchestratedActionCommandV1;
    batch: PreparedAutomationActionBatchV1;
    nowMs: number;
  }>): Promise<PressureSql7SettlementN2PreparedInputsV1>
    | PressureSql7SettlementN2PreparedInputsV1;
}

/** Production-usable service adapter; product wiring only supplies the pure preparation port. */
export class PressureSql7SettlementN2PlanBuilderV1
implements PressureSql7SettlementN2PlanBuilderPortV1 {
  constructor(
    private readonly prepared: PressureSql7SettlementN2PreparedInputsPortV1,
  ) {}

  async build(input: Readonly<{
    snapshot: DecisionToNextProjectionSnapshotV1;
    humanCommand: SubmitOrchestratedActionCommandV1;
    batch: PreparedAutomationActionBatchV1;
    nowMs: number;
  }>): Promise<PressureSql7CommitPlanV1> {
    if (!Number.isSafeInteger(input.nowMs) || input.nowMs < 0) {
      invalid("SQL7 plan-builder nowMs is invalid");
    }
    assertServiceHumanBinding(input.humanCommand, input.batch, input.snapshot);
    const prepared = await this.prepared.prepare(input);
    return buildPressureSql7CommitPlanV1({
      snapshot: input.snapshot,
      batch: input.batch,
      ...prepared,
      committedAt: new Date(input.nowMs),
    });
  }
}

/**
 * Pure P4 mapper for the normal, first N1 -> N2 submit path. Every value that
 * is not derivable from the validated snapshot or an existing domain planner
 * is an explicit prepared input.
 */
export function buildPressureSql7CommitPlanV1(
  input: Readonly<BuildPressureSql7CommitPlanInputV1>,
): PressureSql7CommitPlanV1 {
  assertBindings(input);
  const { snapshot, batch, domain, downstream } = input;
  const record = domain.settlementRecord;
  const actionEvents = domain.actionLedger.events;
  const decisionActions = batch.actions.map((item, index) =>
    decisionActionRow(item.command.action, actionEvents[index]!, input.committedAt));
  const storyEvents = [
    ...actionEvents.map((event) => ledgerEventRow(event, input.committedAt)),
    ledgerEventRow(domain.beat.event, input.committedAt),
    orchestratorEventRow(batch.nextOrchestratorState, input.committedAt),
    orchestratorEventRow(batch.beatPlan.postBeatOrchestratorState, input.committedAt),
    orchestratorEventRow(domain.frozenOrchestratorState, input.committedAt),
    frozenRootEventRow(record, input.committedAt),
    ledgerEventRow(domain.nextOpening.event, input.committedAt),
    orchestratorEventRow(domain.nextOpening.state, input.committedAt),
    ...downstream.aEmotionStoryEvents.map((row) => structuredClone(row)),
  ];
  assertUniqueRows(decisionActions, storyEvents, downstream);

  const postBeat = domain.postBeatProjection;
  const next = domain.nextOpening;
  const nextRequiredSeats = next.state.activeDecision?.seats
    .filter((seat) => seat.requirement === "REQUIRED")
    .map((seat) => seat.seatId) ?? [];
  const human = requireHumanAction(input);
  const plan: PressureSql7CommitPlanV1 = {
    schemaVersion: "pressure_sql7_commit_plan_v1",
    fence: {
      runId: snapshot.world.runId,
      routeHash: snapshot.routeSnapshot.routeHash,
      chapterRuntimeId: snapshot.runtime.id,
      chapterId: snapshot.runtime.chapterId,
      chapterSequence: snapshot.runtime.chapterSequence,
      expectedRuntimeState: snapshot.runtime.state,
      expectedRuntimeLockVersion: snapshot.runtime.lockVersion,
      expectedWorkingRevision: snapshot.runtime.workingRevision,
      expectedWorkingStateHash: snapshot.runtime.workingStateHash,
      expectedWorkingStateJson: structuredClone(snapshot.runtime.workingState),
      expectedLedgerProjectionJson: structuredClone(snapshot.runtime.ledgerProjectionCache),
      // PressureChapterRuntime.orchestrationHash is the frozen package hash.
      expectedOrchestrationHash: snapshot.runtime.orchestrationHash,
      expectedWorldSequence: snapshot.world.worldSequence,
      expectedReservedWorldSequence: snapshot.world.reservedWorldSequence,
      expectedWorldStateJson: structuredClone(snapshot.world.state),
      expectedSeatStateRevision: snapshot.persistenceFence.seatStateRevision,
      expectedSeatVersion: snapshot.persistenceFence.seatVersion,
      expectedSeatStateHash: snapshot.persistenceFence.seatStateHash,
      expectedSeatSnapshotJson: structuredClone(snapshot.persistenceFence.seatSnapshotJson),
      expectedOrchestratorEventId: snapshot.persistenceFence.orchestratorEventId,
      expectedOrchestratorDedupeKey: snapshot.persistenceFence.orchestratorDedupeKey,
      expectedOrchestratorPayloadJson: structuredClone(
        snapshot.persistenceFence.orchestratorPayload,
      ),
      expectedViewerPlayerId: snapshot.viewer.playerId,
      expectedViewerUserId: snapshot.viewer.subjectId,
      expectedViewerRoleId: snapshot.viewer.roleId,
      expectedViewerPlayerType: snapshot.viewer.playerType,
      expectedViewerStatus: snapshot.viewer.status,
      submissionActionId: human.command.action.actionId,
      submissionIdempotencyKey: snapshot.request.idempotencyKey,
      submissionRequestFingerprint: human.command.action.requestFingerprint,
    },
    frozenRuntime: {
      workingRevision: postBeat.state.revision,
      workingStateJson: structuredClone(postBeat.state),
      workingStateHash: postBeat.stateHash,
      decisionStateJson: preparedDecisionStateFromProjectionV1(
        postBeat,
        [],
        null,
        null,
      ),
      ledgerProjectionJson: serializePreparedLedgerProjectionV1(
        postBeat,
        batch.beatPlan.downstreamManifest,
      ),
      closeInputHash: record.sealedInput.inputHash,
      frozenAt: new Date(input.committedAt),
    },
    worldTransition: {
      committedWorldSequence: record.receipt.committedWorldSequence,
      reservedWorldSequence: record.receipt.committedWorldSequence,
      committedWorldStateJson: structuredClone(record.frozenChapterBundle.frozenWorldState),
      currentChapter: chapterSequence(next.state.currentChapterId),
      currentNodeId: next.state.currentChapterId,
      nextRuntime: {
        id: next.chapterRuntimeId,
        runId: snapshot.world.runId,
        chapterId: next.state.currentChapterId,
        chapterSequence: chapterSequence(next.state.currentChapterId),
        state: "DECISION_POINT_OPEN",
        baseWorldSequence: record.receipt.committedWorldSequence,
        baseWorldStateHash: record.receipt.committedWorldStateHash,
        previousFrozenHash: record.frozenChapterBundle.bundleHash,
        routeHash: snapshot.routeSnapshot.routeHash,
        contentPackageVersion: snapshot.routeSnapshot.contentPackageVersion,
        contentHash: snapshot.routeSnapshot.contentPackageSha256,
        orchestrationPackageVersion: snapshot.routeSnapshot.orchestrationPackageVersion,
        orchestrationHash: snapshot.routeSnapshot.orchestrationPackageSha256,
        runtimeContractVersion: snapshot.routeSnapshot.runtimeContractVersion,
        runtimeContractHash: snapshot.routeSnapshot.runtimeContractSha256,
        workingRevision: next.projection.state.revision,
        workingStateJson: structuredClone(next.projection.state),
        workingStateHash: next.projection.stateHash,
        decisionStateJson: preparedDecisionStateFromProjectionV1(
          next.projection,
          nextRequiredSeats,
          next.state.activeDecision?.policyHash,
          next.state.orchestratorHash,
        ),
        ledgerProjectionJson: serializePreparedLedgerProjectionV1(next.projection),
        closeInputHash: null,
        lockVersion: 0,
        openedAt: new Date(domain.nextOpeningNowMs),
      },
    },
    decisionActions,
    storyEvents,
    settlement: settlementRow(
      record,
      downstream.settlementDownstreamManifest,
      input.committedAt,
    ),
    narrativeProjections: downstream.narrativeProjections.map((row) =>
      structuredClone(row)),
    outboxTasks: downstream.outboxTasks.map((row) => structuredClone(row)),
    receipt: {
      schemaVersion: "pressure_committed_decision_to_next_projection_authority_v1",
      runId: record.runId,
      previousChapterRuntimeId: record.chapterRuntimeId,
      nextChapterRuntimeId: next.chapterRuntimeId,
      settlementId: record.receipt.settlementId,
      committedWorldSequence: record.receipt.committedWorldSequence,
      commitHash: record.receipt.commitHash,
      projectionAuthority: structuredClone(input.resolvedProjectionSources),
    },
  };
  return validatePressureSql7CommitPlanV1(plan);
}

function assertBindings(input: Readonly<BuildPressureSql7CommitPlanInputV1>): void {
  const { snapshot, batch, domain, settlementSource: source } = input;
  const record = domain.settlementRecord;
  const b0Input = compileB0ChapterSettlementInputV1({
    wireInput: source.sealedInput,
    settlementMaterial: source.settlementMaterial,
  });
  if (
    snapshot.schemaVersion !== "pressure_decision_to_next_projection_snapshot_v1"
    || !isSha256(snapshot.snapshotHash)
    || snapshot.runtime.chapterSequence !== 1
    || chapterSequence(snapshot.runtime.chapterId) !== 1
    || snapshot.request.runId !== snapshot.world.runId
    || snapshot.request.roomId !== snapshot.world.runId
    || snapshot.routeSnapshot.runId !== snapshot.world.runId
    || snapshot.runtime.runId !== snapshot.world.runId
    || snapshot.chapter.runId !== snapshot.world.runId
    || snapshot.viewer.runId !== snapshot.world.runId
    || snapshot.existingDecisionActionRows.length !== 0
  ) invalid("snapshot is not the normal first N1 submit authority");
  const { batchHash, ...batchBody } = batch;
  if (
    batch.schemaVersion !== "pressure_prepared_automation_action_batch_v1"
    || batchHash !== computePreparedAutomationActionBatchHashV1(batchBody)
    || !isSha256(batch.snapshotHash)
    || batch.runId !== snapshot.world.runId
    || batch.routeHash !== snapshot.routeSnapshot.routeHash
    || batch.chapterRuntimeId !== snapshot.runtime.id
    || batch.chapterId !== snapshot.runtime.chapterId
    || batch.decisionPointId !== snapshot.request.decisionPointId
    || batch.expectedOrchestratorRevision !== snapshot.chapter.revision
    || batch.expectedOrchestratorHash !== snapshot.chapter.orchestratorHash
    || batch.expectedWorkingRevision !== snapshot.runtime.workingRevision
    || batch.expectedWorkingStateHash !== snapshot.runtime.workingStateHash
    || batch.expectedLedgerHeadHash !== snapshot.workingProjection.headHash
    || batch.expectedSeatAuthorityStateHash !== snapshot.seatAuthority.stateHash
    || batch.actions.length !== snapshot.routeSnapshot.seatIds.length
    || batch.actions.some((item) => item.authority.snapshotHash !== batch.snapshotHash)
  ) invalid("prepared action batch is not bound to the snapshot");
  const orderedSeats = batch.actions.map((item) => item.command.action.seatId);
  if (
    orderedSeats.some((seatId, index) => seatId !== snapshot.routeSnapshot.seatIds[index])
    || new Set(orderedSeats).size !== orderedSeats.length
  ) invalid("prepared action batch does not cover the frozen route order");
  if (
    domain.actionLedger.events.length !== batch.actions.length
    || domain.actionLedger.payloads.length !== batch.actions.length
    || domain.actionLedger.events.some((event, index) => (
      event.payload.eventType !== "FORMAL_ACTION_ACCEPTED"
      || event.payload.action.actionId !== batch.actions[index]!.command.action.actionId
    ))
    || domain.beat.status !== "PLANNED"
    || domain.beatInput.resolverVersion !== batch.beatPlan.resolution.resolverVersion
    || domain.beat.event.eventHash !== batch.beatPlan.event.eventHash
    || domain.beat.resolution.resolutionHash !== batch.beatPlan.resolution.resolutionHash
    || domain.beat.event.payload.eventType !== "BEAT_APPLIED"
    || domain.postBeatProjection.headHash !== domain.beat.event.eventHash
    || domain.postBeatProjection.stateHash !== domain.beat.event.payload.stateAfterHash
  ) invalid("prepared action or Beat derivation is inconsistent");
  if (
    sha256Canonical(domain.settlementInput) !== sha256Canonical(batch.beatPlan.settlementInput)
    || sha256Canonical(domain.settlementInput) !== sha256Canonical(source.sealedInput)
    || sha256Canonical(domain.seatParticipation)
      !== sha256Canonical(source.settlementMaterial.seats)
    || sha256Canonical(domain.settlementMaterial)
      !== sha256Canonical(source.settlementMaterial)
    || source.sourceHash !== record.sourceHash
    || sha256Canonical(source.sealedInput) !== sha256Canonical(record.sealedInput)
    || record.runId !== snapshot.world.runId
    || record.chapterRuntimeId !== snapshot.runtime.id
    || record.chapterId !== snapshot.runtime.chapterId
    || record.receipt.baseWorldSequence !== snapshot.world.worldSequence
    || record.receipt.baseWorldStateHash !== snapshot.world.state.stateHash
    || record.receipt.committedWorldSequence !== snapshot.world.worldSequence + 1
    || domain.settlementCommand.runId !== record.runId
    || domain.settlementCommand.chapterRuntimeId !== record.chapterRuntimeId
    || domain.settlementCommand.idempotencyKey !== record.idempotencyKey
    || domain.settlementCommand.requestFingerprint !== record.requestFingerprint
    || domain.settlementPolicyEvaluation.b0InputHash !== b0Input.b0InputHash
  ) invalid("settlement source, material, policy or atomic record is inconsistent");
  const handoff = input.downstream.outboxTasks.find(
    (row) => row.dedupeKey === record.outbox.dedupeKey,
  );
  if (
    !handoff
    || handoff.runId !== record.runId
    || handoff.taskType !== record.outbox.taskType
    || handoff.sourceAuthority !== "CHAPTER_FROZEN"
    || handoff.sourceId !== record.frozenChapterBundle.bundleHash
    || handoff.sourceCommitHash !== record.receipt.commitHash
    || sha256Canonical(handoff.payloadJson) !== sha256Canonical(record.outbox)
    || handoff.payloadHash !== record.outbox.outboxHash
  ) invalid("durable chapter handoff outbox row is missing or inconsistent");
  const frozen = domain.frozenOrchestratorState;
  const next = domain.nextOpening;
  if (
    frozen.phase !== "FROZEN"
    || frozen.runId !== record.runId
    || frozen.routeHash !== snapshot.routeSnapshot.routeHash
    || frozen.currentChapterId !== record.chapterId
    || frozen.chapterRuntimeId !== record.chapterRuntimeId
    || frozen.frozenBundleHash !== record.frozenChapterBundle.bundleHash
    || next.state.phase !== "ACTIVE"
    || next.state.runId !== record.runId
    || next.state.routeHash !== snapshot.routeSnapshot.routeHash
    || chapterSequence(next.state.currentChapterId) !== 2
    || next.chapterRuntimeId !== next.state.chapterRuntimeId
    || next.event.chapterRuntimeId !== next.chapterRuntimeId
    || next.projection.key.chapterRuntimeId !== next.chapterRuntimeId
    || next.projection.headHash !== next.event.eventHash
    || next.state.authorityBase.baseWorldSequence !== record.receipt.committedWorldSequence
    || next.state.authorityBase.baseWorldStateHash !== record.receipt.committedWorldStateHash
    || next.state.authorityBase.previousFrozenHash !== record.frozenChapterBundle.bundleHash
    || domain.nextChapter.chapterId !== next.state.currentChapterId
    || domain.nextWorkingSeed.runId !== record.runId
    || domain.nextWorkingSeed.chapterId !== next.state.currentChapterId
    || domain.nextWorkingSeed.revision !== 0
    || !Number.isSafeInteger(domain.nextOpeningNowMs)
  ) invalid("N2 opening authority is inconsistent");
  const currentOrchestratorRow = orchestratorEventRow(snapshot.chapter, input.committedAt);
  if (
    sha256Canonical(snapshot.runtime.workingState)
      !== sha256Canonical(snapshot.workingProjection.state)
    || snapshot.persistenceFence.orchestratorEventId !== currentOrchestratorRow.id
    || snapshot.persistenceFence.orchestratorDedupeKey !== currentOrchestratorRow.dedupeKey
    || sha256Canonical(snapshot.persistenceFence.orchestratorPayload)
      !== sha256Canonical(snapshot.chapter)
    || snapshot.persistenceFence.seatStateRevision !== snapshot.seatAuthority.stateRevision
    || snapshot.persistenceFence.seatStateHash !== snapshot.seatAuthority.stateHash
    || !Number.isSafeInteger(snapshot.persistenceFence.seatVersion)
    || snapshot.persistenceFence.seatVersion < 0
    || !(input.committedAt instanceof Date)
    || Number.isNaN(input.committedAt.getTime())
  ) invalid("captured persistence fence or commit time is invalid");
  assertResolvedProjectionSources(input);
}

function assertResolvedProjectionSources(
  input: Readonly<BuildPressureSql7CommitPlanInputV1>,
): void {
  const { snapshot, domain, resolvedProjectionSources: sources } = input;
  const next = domain.nextOpening;
  const record = domain.settlementRecord;
  if (
    sources.roomId !== snapshot.request.roomId
    || sources.runId !== snapshot.world.runId
    || sources.subjectId !== snapshot.request.subjectId
    || sources.viewerSeatId !== snapshot.viewer.roleKey
    || sources.routeSnapshot.runId !== snapshot.world.runId
    || sources.routeSnapshot.routeHash !== snapshot.routeSnapshot.routeHash
    || sources.chapter.runId !== snapshot.world.runId
    || sources.chapter.routeHash !== snapshot.routeSnapshot.routeHash
    || sources.chapter.chapterRuntimeId !== next.chapterRuntimeId
    || sources.chapter.orchestratorHash !== next.state.orchestratorHash
    || sources.workingProjection.key.runId !== snapshot.world.runId
    || sources.workingProjection.key.chapterRuntimeId !== next.chapterRuntimeId
    || sources.workingProjection.headHash !== next.projection.headHash
    || sources.workingProjection.stateHash !== next.projection.stateHash
    || sources.chapterDescriptor.chapterId !== next.state.currentChapterId
    || sources.chapterDescriptor.descriptorHash !== next.state.descriptorHash
    || sources.viewerSource.roomId !== snapshot.request.roomId
    || sources.viewerSource.runId !== snapshot.world.runId
    || sources.viewerSource.routeHash !== snapshot.routeSnapshot.routeHash
    || sources.viewerSource.subjectId !== snapshot.request.subjectId
    || sources.viewerSource.viewer.seatId !== snapshot.viewer.roleKey
    || sources.worldSource.runId !== snapshot.world.runId
    || sources.worldSource.routeHash !== snapshot.routeSnapshot.routeHash
    || sources.worldSource.worldSequence !== record.receipt.committedWorldSequence
    || sources.worldSource.worldStateHash !== record.receipt.committedWorldStateHash
    || sources.narrativeSource.runId !== snapshot.world.runId
    || sources.narrativeSource.routeHash !== snapshot.routeSnapshot.routeHash
    || sources.narrativeSource.viewerSeatId !== snapshot.viewer.roleKey
    || sources.narrativeSource.chapterRuntimeId !== next.chapterRuntimeId
    || sources.feedPage.roomId !== snapshot.request.roomId
    || sources.feedPage.runId !== snapshot.world.runId
    || sources.feedPage.viewerSeatId !== snapshot.viewer.roleKey
  ) invalid("resolved Projection sources are not fully bound to committed N2 authority");
}

function requireHumanAction(input: Readonly<BuildPressureSql7CommitPlanInputV1>) {
  const { snapshot, batch } = input;
  const candidates = batch.actions.filter((item) => item.authority.actorKind === "HUMAN");
  const human = candidates[0];
  if (
    candidates.length !== 1
    || !human
    || human.command.subjectId !== snapshot.request.subjectId
    || human.command.action.seatId !== snapshot.request.seatId
    || human.command.action.actionId !== snapshot.request.idempotencyKey
      && human.command.action.idempotencyKey !== snapshot.request.idempotencyKey
    || human.authority.expectedControllerId !== snapshot.submitSeat.activeControllerId
    || human.authority.expectedControlEpoch !== snapshot.request.expectedControlEpoch
    || human.authority.expectedSubmissionFenceToken
      !== snapshot.request.expectedSubmissionFenceToken
  ) invalid("HUMAN submission is not bound to request authority");
  return human;
}

function assertServiceHumanBinding(
  humanCommand: SubmitOrchestratedActionCommandV1,
  batch: PreparedAutomationActionBatchV1,
  snapshot: DecisionToNextProjectionSnapshotV1,
): void {
  const preparedHuman = batch.actions.filter((item) => item.authority.actorKind === "HUMAN");
  const item = preparedHuman[0];
  if (
    preparedHuman.length !== 1
    || !item
    || item.command.subjectId !== humanCommand.subjectId
    || item.command.inputFingerprint !== humanCommand.inputFingerprint
    || sha256Canonical(item.command.action) !== sha256Canonical(humanCommand.action)
    || sha256Canonical(item.command.intent) !== sha256Canonical(humanCommand.intent)
    || humanCommand.action.runId !== snapshot.world.runId
    || humanCommand.action.chapterRuntimeId !== snapshot.runtime.id
    || humanCommand.action.decisionPointId !== snapshot.request.decisionPointId
    || humanCommand.action.seatId !== snapshot.request.seatId
    || humanCommand.action.idempotencyKey !== snapshot.request.idempotencyKey
  ) invalid("service HUMAN command is not the HUMAN action frozen in the prepared batch");
}

function decisionActionRow(
  action: PreparedAutomationActionBatchV1["actions"][number]["command"]["action"],
  event: WorkingLedgerEventV1,
  committedAt: Date,
): PressureSql7DecisionActionRowV1 {
  if (event.payload.eventType !== "FORMAL_ACTION_ACCEPTED") {
    invalid("action event payload is not FORMAL_ACTION_ACCEPTED");
  }
  return {
    id: action.actionId,
    runId: action.runId,
    chapterRuntimeId: action.chapterRuntimeId,
    decisionPointId: action.decisionPointId,
    seatId: action.seatId,
    actionOrdinal: action.actionOrdinal,
    actionType: action.actionType,
    status: action.status,
    controlEpoch: action.controlEpoch,
    expectedWorkingRevision: action.expectedWorkingRevision,
    currentRevision: action.actionRevision,
    idempotencyKey: action.idempotencyKey,
    requestFingerprint: action.requestFingerprint,
    payloadJson: structuredClone(action.payload),
    payloadHash: action.payloadHash,
    sealedHash: action.sealedHash,
    authorityEventHash: event.eventHash,
    confirmedAt: new Date(committedAt),
    sealedAt: new Date(committedAt),
    createdAt: new Date(committedAt),
    updatedAt: new Date(committedAt),
  };
}

function ledgerEventRow(
  event: WorkingLedgerEventV1,
  createdAt: Date,
): PressureSql7StoryEventRowV1 {
  return {
    id: `pressure_ledger_${event.eventHash.slice(0, 32)}`,
    runId: event.runId,
    day: chapterSequence(event.chapterId),
    type: "PRESSURE_WORKING_LEDGER_EVENT",
    messageType: "system",
    roleKey: event.payload.eventType === "FORMAL_ACTION_ACCEPTED"
      ? event.payload.action.seatId
      : null,
    visibility: "system",
    payloadJson: structuredClone(event),
    sequence: null,
    dedupeKey: `pressure-ledger:${event.runId}:${event.chapterRuntimeId}:${event.eventHash}`,
    audienceType: null,
    audienceRoleIdsJson: null,
    sourceActionId: null,
    createdAt: new Date(createdAt),
  };
}

function orchestratorEventRow(
  state: ChapterOrchestratorStateV1,
  createdAt: Date,
): PressureSql7StoryEventRowV1 {
  return {
    id: `pc_orch_${sha256Canonical({
      runId: state.runId,
      revision: state.revision,
      stateHash: state.orchestratorHash,
    }).slice(0, 32)}`,
    runId: state.runId,
    day: chapterSequence(state.currentChapterId),
    type: "PRESSURE_CHAPTER_ORCHESTRATOR_STATE",
    messageType: "system",
    roleKey: null,
    visibility: "system",
    payloadJson: structuredClone(state),
    sequence: null,
    dedupeKey: `pressure-orchestrator:${state.runId}:${state.revision}`,
    audienceType: null,
    audienceRoleIdsJson: null,
    sourceActionId: null,
    createdAt: new Date(createdAt),
  };
}

function frozenRootEventRow(
  record: AtomicChapterCommitRecordV1,
  createdAt: Date,
): PressureSql7StoryEventRowV1 {
  return {
    id: record.rootEvent.eventId,
    runId: record.runId,
    day: record.rootEvent.chapterSequence,
    type: record.rootEvent.eventType,
    messageType: "system",
    roleKey: null,
    visibility: "system",
    payloadJson: structuredClone(record.rootEvent),
    sequence: record.rootEvent.committedWorldSequence,
    dedupeKey: record.rootEvent.eventId,
    audienceType: null,
    audienceRoleIdsJson: null,
    sourceActionId: null,
    createdAt: new Date(createdAt),
  };
}

function settlementRow(
  record: AtomicChapterCommitRecordV1,
  downstreamManifest: unknown,
  committedAt: Date,
): PressureSql7ChapterSettlementRowV1 {
  return {
    id: record.receipt.settlementId,
    runId: record.runId,
    chapterRuntimeId: record.chapterRuntimeId,
    chapterId: record.chapterId,
    chapterSequence: record.rootEvent.chapterSequence,
    schemaVersion: record.settlement.schemaVersion,
    idempotencyKey: record.idempotencyKey,
    requestFingerprint: record.requestFingerprint,
    baseWorldSequence: record.rootEvent.baseWorldSequence,
    committedWorldSequence: record.rootEvent.committedWorldSequence,
    baseWorldStateHash: record.sealedInput.baseWorldStateHash,
    committedWorldStateHash: record.frozenChapterBundle.committedWorldStateHash,
    inputJson: structuredClone(record.sealedInput),
    inputHash: record.sealedInput.inputHash,
    evaluationJson: structuredClone(record.settlement),
    evaluationHash: record.settlement.evaluationHash,
    worldDeltaJson: structuredClone(record.worldDelta),
    worldDeltaHash: sha256Canonical(record.worldDelta),
    decisionLedgerHash: record.sealedInput.decisionLedgerHash,
    finalWorkingStateHash: record.sealedInput.finalWorkingStateHash,
    reservationLedgerHash: record.sealedInput.reservationLedgerHash,
    frozenBundleHash: record.frozenChapterBundle.bundleHash,
    commitManifestJson: structuredClone(record),
    commitManifestHash: record.receipt.commitManifestHash,
    rootEventId: record.rootEvent.eventId,
    outboxDedupeKeysJson: structuredClone(downstreamManifest),
    commitHash: record.receipt.commitHash,
    committedAt: new Date(committedAt),
  };
}

function assertUniqueRows(
  actions: readonly PressureSql7DecisionActionRowV1[],
  events: readonly PressureSql7StoryEventRowV1[],
  downstream: PressureSql7PreparedDownstreamRowsV1,
): void {
  assertUnique(actions.map((row) => row.id), "DecisionAction IDs");
  assertUnique(actions.map((row) => row.idempotencyKey), "DecisionAction idempotency keys");
  assertUnique(events.map((row) => row.id), "StoryEvent IDs");
  assertUnique(
    events.flatMap((row) => row.dedupeKey ?? []),
    "StoryEvent dedupe keys",
  );
  assertUnique(downstream.narrativeProjections.map((row) => row.id), "Narrative IDs");
  assertUnique(downstream.outboxTasks.map((row) => row.id), "Outbox IDs");
  assertUnique(downstream.outboxTasks.map((row) => row.dedupeKey), "Outbox dedupe keys");
}

function assertUnique(values: readonly string[], label: string): void {
  const ordered = [...values].sort(compareCanonicalText);
  if (!ordered.length || ordered.some((value) => !value) || new Set(ordered).size !== ordered.length) {
    invalid(`${label} are empty or duplicated`);
  }
}

function invalid(message: string): never {
  throw new PressureSql7CommitErrorV1("INVALID_PLAN", message);
}
