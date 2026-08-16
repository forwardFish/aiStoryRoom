import { Prisma } from "@prisma/client";
import {
  PRESSURE_CHAPTER_SEAT_IDS_V1,
  chapterSequence,
  isSha256,
  sha256Canonical,
  validateDecisionActionV1,
  validateRunRouteSnapshotV1,
  validateSeatIdV1,
  type SeatIdV1,
} from "@ai-story/shared";
import type {
  PressureInteractionAccessV1,
  SubmitFormalInteractionCommandV1,
} from "../interaction/contracts";
import {
  computeFormalInteractionInputFingerprint,
} from "../interaction/formal-interaction.service";
import type {
  AppendPreparedAutomationActionCommandV1,
  AppendPreparedAutomationActionResultV1,
  PreparedAutomationActionBatchResultV1,
  PreparedAutomationActionBatchV1,
  PreparedAutomationActionStaleReasonV1,
  PreparedAutomationActionSubmissionPortV1,
} from "../decision-automation/contracts";
import { computePreparedAutomationActionBatchHashV1 } from "../decision-automation/prepared-action-batch";
import type { ChapterOrchestratorStateV1 } from "../orchestrator/contracts";
import { planRecordedActionsV1 } from "../orchestrator/chapter-orchestrator.service";
import { planBeatProgressionV1 } from "../orchestrator/chapter-orchestrator.service";
import { validateOrchestratorStateV1 } from "../orchestrator/validation";
import { validateAuthoredChapterRuntimeV1 } from "../orchestrator/validation";
import type { SeatControlSnapshotV1 } from "../seat-control/types";
import { decodeSeatEnvelope } from "../seat-control-persistence/envelope";
import type {
  AcceptedFormalActionV1,
  FormalActionAcceptedPayloadV1,
  WorkingLedgerEventV1,
  WorkingLedgerProjectionV1,
} from "../working-ledger/contracts";
import {
  appendFormalActionEventsToWorkingLedgerProjection,
  appendBeatEventToWorkingLedgerProjection,
  buildWorkingLedgerEvents,
  buildWorkingLedgerEventsFromProjection,
  projectWorkingLedger,
} from "../working-ledger/working-ledger";
import {
  SangtianAuthoritativeBeatCompilerV1,
  planSynchronizedDecisionBeatV1,
} from "../integration/working-ledger.adapters";
import {
  buildAuthorityDownstreamManifestV1,
  downstreamDedupeKeysV1,
  insertAEmotionAuthorityEmissionsV1,
  insertNarrativeProjectionPlanV1,
  planBeatAuthorityDownstreamV1,
} from "../projection-plan/authority-downstream";
import { compileCommittedInvestigationLifecycleEmissionsV1 } from "../a-emotion-production/investigation-lifecycle.prisma-bridge";
import { planPreparedActionLedgerV1 } from "../decision-automation/prepared-action-batch";
import {
  decodeWorkingLedgerProjectionCacheV1,
  withWorkingLedgerProjectionCacheHashV1,
} from "../working-ledger/projection-cache";
import { isUniqueConflict } from "./transaction";
import {
  recordPressureDbTransactionAttemptV1,
  recordPressureDbTransactionCommitV1,
  recordPressureDbTransactionRollbackV1,
} from "../observability/pressure-db-metrics";
import {
  buildPressureMvpDecisionStateV1,
  decodePressureMvpDecisionStateV1,
} from "./mvp-decision-state";
import {
  PRESSURE_PERSISTENCE_ERROR_CODES as ERROR,
  PressurePersistenceError,
} from "./errors";

const LEDGER_EVENT_TYPE = "PRESSURE_WORKING_LEDGER_EVENT";
const ORCHESTRATOR_EVENT_TYPE = "PRESSURE_CHAPTER_ORCHESTRATOR_STATE";

interface PreparedEventRowV1 {
  id: string;
  runId: string;
  type: string;
  payloadJson: unknown;
  dedupeKey: string | null;
  createdAt?: Date;
}

interface PreparedRuntimeRowV1 {
  id: string;
  runId: string;
  chapterId: string;
  routeHash: string;
  workingRevision: number;
  workingStateJson: unknown;
  workingStateHash: string;
  ledgerProjectionJson: unknown;
  lockVersion: number;
  decisionStateJson: unknown;
  state: string;
}

interface PreparedRouteRowV1 {
  runId: string;
  routeHash: string;
  contentPackageVersion: string;
  contentPackageSha256: string;
}

interface PreparedSeatRowV1 {
  runId: string;
  stateRevision: number;
  snapshotJson: unknown;
  stateHash: string;
  version: number;
}

interface PreparedRunRowV1 {
  id: string;
  stateJson: unknown;
}

interface PreparedAutomationTransactionV1 {
  storyEvent: {
    findMany(input: Record<string, unknown>): Promise<PreparedEventRowV1[]>;
    findUnique(input: Record<string, unknown>): Promise<PreparedEventRowV1 | null>;
    create(input: { data: Record<string, unknown> }): Promise<PreparedEventRowV1>;
    createMany?(input: { data: Record<string, unknown>[] }): Promise<{ count: number }>;
  };
  pressureChapterRuntime: {
    findUnique(input: Record<string, unknown>): Promise<PreparedRuntimeRowV1 | null>;
    updateMany(input: {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    }): Promise<{ count: number }>;
  };
  pressureDecisionAction: {
    create(input: { data: Record<string, unknown> }): Promise<unknown>;
    createMany?(input: { data: Record<string, unknown>[] }): Promise<{ count: number }>;
  };
  pressureRunRouteSnapshot: {
    findUnique(input: Record<string, unknown>): Promise<PreparedRouteRowV1 | null>;
  };
  pressureSeatControlSnapshot: {
    findUnique(input: Record<string, unknown>): Promise<PreparedSeatRowV1 | null>;
  };
  storyRun: {
    findUnique(input: Record<string, unknown>): Promise<PreparedRunRowV1 | null>;
  };
  pressureNarrativeProjection: {
    create(input: { data: Record<string, unknown> }): Promise<{ id: string }>;
    createMany?(input: { data: Record<string, unknown>[] }): Promise<{ count: number }>;
  };
  pressureOutboxTask: {
    create(input: { data: Record<string, unknown> }): Promise<unknown>;
    createMany?(input: { data: Record<string, unknown>[] }): Promise<{ count: number }>;
  };
}

export interface PreparedAutomationPrismaClientV1 {
  $transaction<TResult>(
    operation: (tx: PreparedAutomationTransactionV1) => Promise<TResult>,
    options: typeof FAST_TRANSACTION_OPTIONS,
  ): Promise<TResult>;
}

const FAST_TRANSACTION_OPTIONS = Object.freeze({
  isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
  maxWait: 500,
  timeout: 10_000,
});

async function pressureFastSerializableTransaction<TResult>(
  prisma: PreparedAutomationPrismaClientV1,
  operation: (tx: PreparedAutomationTransactionV1) => Promise<TResult>,
): Promise<TResult> {
  recordPressureDbTransactionAttemptV1();
  try {
    const result = await prisma.$transaction(operation, FAST_TRANSACTION_OPTIONS);
    recordPressureDbTransactionCommitV1();
    return result;
  } catch (error) {
    recordPressureDbTransactionRollbackV1();
    throw error;
  }
}

/**
 * W5 fast append. The policy/compiler have already run in memory. This adapter
 * only rechecks current authority fences and appends one immutable Ledger event
 * plus its DecisionAction row in a short transaction.
 */
export class PrismaPreparedAutomationActionSubmissionV1
implements PreparedAutomationActionSubmissionPortV1 {
  constructor(private readonly prisma: PreparedAutomationPrismaClientV1) {}

  async submitPreparedBatch(
    batch: PreparedAutomationActionBatchV1,
  ): Promise<PreparedAutomationActionBatchResultV1> {
    const first = batch.actions[0];
    if (!first) throw invalid("Prepared automation batch is empty", batch.batchId);
    const route = validateRunRouteSnapshotV1(first.command.routeSnapshot);
    const routeSeatIds = route.seatIds.map((seatId, index) =>
      validateSeatIdV1(seatId, `routeSnapshot.seatIds[${index}]`));
    const { batchHash: suppliedBatchHash, ...batchBody } = structuredClone(batch);
    const expectedBatchHash = computePreparedAutomationActionBatchHashV1(batchBody);
    const selectedSeatOrder = routeSeatIds.filter((seatId) =>
      batch.actions.some((candidate) => candidate.command.action.seatId === seatId));
    if (
      batch.schemaVersion !== "pressure_prepared_automation_action_batch_v1"
      || batch.runId !== route.runId
      || batch.routeHash !== route.routeHash
      || suppliedBatchHash !== expectedBatchHash
      || batch.frozenSeatOrder.length !== routeSeatIds.length
      || batch.frozenSeatOrder.some((seatId, index) => seatId !== routeSeatIds[index])
      || new Set(batch.actions.map((item) => item.command.action.seatId)).size !== batch.actions.length
      || batch.actions.some((item, index) => item.command.action.seatId !== selectedSeatOrder[index])
      || batch.actions.some((item) => (
        item.command.routeSnapshot.routeHash !== batch.routeHash
        || item.command.action.runId !== batch.runId
        || item.command.action.chapterRuntimeId !== batch.chapterRuntimeId
        || item.command.action.chapterId !== batch.chapterId
        || item.command.action.decisionPointId !== batch.decisionPointId
        || item.authority.snapshotHash !== batch.snapshotHash
        || item.authority.expectedWorkingRevision !== batch.expectedWorkingRevision
        || item.authority.expectedWorkingStateHash !== batch.expectedWorkingStateHash
        || item.authority.expectedLedgerHeadHash !== batch.expectedLedgerHeadHash
      ))
    ) throw invalid("Prepared automation batch binding is invalid", batch.batchId);
    for (const item of batch.actions) {
      validatePreparedAuthorityFence(item, item.command.action.actionId);
      const action = validateDecisionActionV1(item.command.action);
      validateFormalInteractionIntentV1(item.command.intent);
      if (
        computeFormalInteractionInputFingerprint({
          routeSnapshot: item.command.routeSnapshot,
          action,
          intent: item.command.intent,
        }) !== item.command.inputFingerprint
      ) throw invalid("Prepared automation command fingerprint is invalid", action.actionId);
    }

    try {
      return await pressureFastSerializableTransaction(this.prisma, async (tx) => {
        const [runtime, seatRow, orchestratorRow] = await Promise.all([
          tx.pressureChapterRuntime.findUnique({
            where: { id: batch.chapterRuntimeId },
            select: {
              id: true,
              runId: true,
              chapterId: true,
              routeHash: true,
              workingRevision: true,
              workingStateJson: true,
              workingStateHash: true,
              ledgerProjectionJson: true,
              lockVersion: true,
              decisionStateJson: true,
              state: true,
            },
          }),
          tx.pressureSeatControlSnapshot.findUnique({
            where: { runId: batch.runId },
            select: {
              runId: true,
              stateRevision: true,
              snapshotJson: true,
              stateHash: true,
              version: true,
            },
          }),
          tx.storyEvent.findUnique({
            where: { dedupeKey: orchestratorDedupeKey(batch.runId, batch.expectedOrchestratorRevision) },
            select: { id: true, runId: true, type: true, payloadJson: true, dedupeKey: true },
          }),
        ]);
        if (!runtime || !seatRow || !orchestratorRow) {
          return batchConflict(batch, "CHAPTER_OR_DECISION");
        }
        if (
          runtime.routeHash !== batch.routeHash
          || runtime.runId !== batch.runId
          || runtime.chapterId !== batch.chapterId
        ) return batchConflict(batch, "ROUTE");
        const chapter = validateStoredOrchestratorEvent(
          orchestratorRow,
          batch.runId,
          batch.expectedOrchestratorRevision,
        );
        const expectedNextOrchestrator = planRecordedActionsV1(
          chapter,
          batch.actions.map((item) => ({
            seatId: item.command.action.seatId,
            actionId: item.command.action.actionId,
            defaultCode: null,
            actionBudget: 1,
          })),
          true,
        );
        const descriptor = validateAuthoredChapterRuntimeV1(batch.chapterDescriptor);
        const decisionState = decodePressureMvpDecisionStateV1(runtime.decisionStateJson);
        if (
          chapter.revision !== batch.expectedOrchestratorRevision
          || chapter.orchestratorHash !== batch.expectedOrchestratorHash
          || decisionState.orchestratorHash !== batch.expectedOrchestratorHash
          || decisionState.policyHash !== batch.actions[0]!.authority.expectedDecisionPolicyHash
          || chapter.chapterRuntimeId !== batch.chapterRuntimeId
          || chapter.currentChapterId !== batch.chapterId
          || chapter.activeDecision?.decisionPointId !== batch.decisionPointId
          || chapter.phase !== "ACTIVE"
          || descriptor.chapterId !== batch.chapterId
          || descriptor.descriptorHash !== batch.actions[0]!.authority.expectedDescriptorHash
          || descriptor.descriptorHash !== chapter.descriptorHash
          || !["DECISION_POINT_OPEN", "ACTION_DRAFTING"].includes(runtime.state)
          || expectedNextOrchestrator.orchestratorHash !== batch.nextOrchestratorState.orchestratorHash
          || sha256Canonical(expectedNextOrchestrator) !== sha256Canonical(batch.nextOrchestratorState)
        ) return batchConflict(batch, "ORCHESTRATOR_REVISION");
        const active = chapter.activeDecision;
        if (active?.deadlineAtMs !== null && active && batch.actions[0]!.command.nowMs >= active.deadlineAtMs) {
          return batchConflict(batch, "DEADLINE");
        }

        const projection = decodeWorkingLedgerProjectionCacheV1(
          runtime.ledgerProjectionJson,
          {
            runId: runtime.runId,
            chapterRuntimeId: runtime.id,
            chapterId: runtime.chapterId,
            routeHash: runtime.routeHash,
            workingRevision: runtime.workingRevision,
            workingState: runtime.workingStateJson,
            workingStateHash: runtime.workingStateHash,
          },
        );
        const currentHead = requireHead(projection);
        if (
          currentHead !== batch.expectedLedgerHeadHash
          || runtime.workingRevision !== batch.expectedWorkingRevision
          || projection.state.revision !== batch.expectedWorkingRevision
          || runtime.workingStateHash !== batch.expectedWorkingStateHash
          || projection.stateHash !== batch.expectedWorkingStateHash
        ) return batchConflict(batch, currentHead === batch.expectedLedgerHeadHash ? "WORKING_REVISION" : "HEAD_CONFLICT", currentHead);

        const seatSnapshot = decodeSeatEnvelope(seatRow).snapshot;
        if (
          seatSnapshot.runId !== batch.runId
          || seatSnapshot.routeHash !== batch.routeHash
          || seatSnapshot.stateHash !== seatRow.stateHash
          || seatSnapshot.stateHash !== batch.expectedSeatAuthorityStateHash
        ) return batchConflict(batch, "SEAT_AUTHORITY", currentHead);

        const newCommands: Array<{
          item: AppendPreparedAutomationActionCommandV1;
          command: SubmitFormalInteractionCommandV1;
          payload: FormalActionAcceptedPayloadV1;
        }> = [];
        const replayedActionIds: string[] = [];
        for (const item of batch.actions) {
          const action = validateDecisionActionV1(item.command.action);
          const seat = active?.seats.find((candidate) => candidate.seatId === action.seatId);
          const authority = seatSnapshot.seatControls.find((candidate) => candidate.seatId === action.seatId);
          if (
            !seat || !authority
            || seat.requirement !== "REQUIRED"
            || seat.completion !== "PENDING"
            || seat.actionCount !== 0
            || seat.actionIds.length !== 0
            || action.actionOrdinal !== 1
            || authority.controlEpoch !== item.authority.expectedControlEpoch
            || authority.submissionFenceToken !== item.authority.expectedSubmissionFenceToken
            || authority.activeControllerId !== item.authority.expectedControllerId
            || item.command.subjectId !== authority.activeControllerId
            || action.controlEpoch !== item.authority.expectedControlEpoch
          ) return batchConflict(batch, "SEAT_AUTHORITY", currentHead);
          if (item.authority.actorKind === "AI") {
            if (
              authority.mode !== "AI_ACTIVE"
              || authority.activeControllerId !== authority.designatedAiControllerId
              || action.payload.source !== "CONTENT_OWNED_AI_POLICY"
              || action.payload.policyHash !== item.authority.expectedAiPolicyHash
              || !isSha256(String(action.payload.selectionHash ?? ""))
            ) return batchConflict(batch, "AI_POLICY", currentHead);
          } else if (
            item.authority.actorKind !== "HUMAN"
            || authority.mode !== "HUMAN_ACTIVE"
            || item.authority.expectedAiPolicyHash !== null
            || action.payload.source === "CONTENT_OWNED_AI_POLICY"
          ) return batchConflict(batch, "SEAT_CONTROLLER", currentHead);

          const access = buildPreparedAccess(
            routeSeatIds,
            runtime,
            decisionState,
            seatSnapshot,
            action.seatId,
            runtime.workingStateJson,
          );
          const command: SubmitFormalInteractionCommandV1 = {
            routeSnapshot: route,
            subjectId: item.command.subjectId,
            action,
            intent: structuredClone(item.command.intent),
            inputFingerprint: item.command.inputFingerprint,
          };
          assertFormalInteractionProjectionBindingsV1(command, projection);
          const replay = findFormalInteractionReplayFromProjectionV1(command, projection);
          if (replay) {
            assertFormalInteractionReplayAccessV1(command, access);
            replayedActionIds.push(action.actionId);
            continue;
          }
          assertFormalInteractionAccessV1(command, projection, access);
          assertFormalInteractionIntentAccessV1(action.seatId, command.intent, projection, access);
          newCommands.push({
            item,
            command,
            payload: {
              eventType: "FORMAL_ACTION_ACCEPTED",
              routeHash: route.routeHash,
              inputFingerprint: command.inputFingerprint,
              action,
              intent: command.intent,
              audienceSeatIds: computeFormalInteractionAudienceV1(action.seatId, command.intent),
            },
          });
        }
        if (!newCommands.length) {
          return {
            status: "REPLAYED",
            batchId: batch.batchId,
            actionIds: batch.actions.map((item) => item.command.action.actionId),
            replayedActionIds,
            eventHashes: replayedActionIds.map((actionId) => {
              const accepted = projection.acceptedActions.get(actionId);
              return accepted?.eventHash ?? "";
            }).filter(Boolean),
            ledgerHeadHash: currentHead,
            orchestratorState: structuredClone(batch.nextOrchestratorState),
            projection: structuredClone(projection),
            conflictReason: null,
          };
        }
        const actionPlan = planPreparedActionLedgerV1({
          projection,
          actions: newCommands.map((entry) => entry.item),
        });
        const events = actionPlan.events;
        if (events.length !== newCommands.length) throw invalid("Prepared batch event count mismatch", batch.batchId);
        const nextProjection = actionPlan.projection;
        const actionIds = [...new Set(
          expectedNextOrchestrator.activeDecision?.seats.flatMap((seat) => seat.actionIds) ?? [],
        )].sort((left, right) => left.localeCompare(right));
        const beat = planSynchronizedDecisionBeatV1({
          routeSnapshot: route,
          chapterDefinition: descriptor.definition,
          chapterRuntimeId: batch.chapterRuntimeId,
          actionIds,
          resolverVersion: batch.beatPlan.resolution.resolverVersion,
          projection: nextProjection,
          decisionPolicy: new SangtianAuthoritativeBeatCompilerV1(),
        });
        if (
          beat.status !== "PLANNED"
          || beat.event.eventHash !== batch.beatPlan.event.eventHash
          || beat.resolution.resolutionHash !== batch.beatPlan.resolution.resolutionHash
          || sha256Canonical(beat.event) !== sha256Canonical(batch.beatPlan.event)
        ) throw invalid("Prepared batch Beat plan mismatch", batch.batchId);
        const postBeatProjection = appendBeatEventToWorkingLedgerProjection(nextProjection, beat.event);
        const progression = planBeatProgressionV1({
          state: expectedNextOrchestrator,
          descriptor,
          projection: postBeatProjection,
          resolution: beat.resolution,
          nowMs: batch.actions[0]!.command.nowMs,
          participantMode: route.participantMode,
        });
        if (
          progression.nextState.orchestratorHash
            !== batch.beatPlan.postBeatOrchestratorState.orchestratorHash
          || sha256Canonical(progression.nextState)
            !== sha256Canonical(batch.beatPlan.postBeatOrchestratorState)
          || sha256Canonical(progression.settlementInput)
            !== sha256Canonical(batch.beatPlan.settlementInput)
        ) throw invalid("Prepared batch post-Beat state mismatch", batch.batchId);
        const plannedDownstream = planBeatAuthorityDownstreamV1({
          projection: postBeatProjection,
          beatEvent: beat.event,
          contentPackageSha256: route.contentPackageSha256,
          committedAt: new Date(batch.actions[0]!.command.nowMs).toISOString(),
          humanSeatIds: route.humanSeatIdsAtStart,
        });
        if (
          sha256Canonical(plannedDownstream.narrativeJobs)
            !== sha256Canonical(batch.beatPlan.narrativeJobs)
          || sha256Canonical(plannedDownstream.aEmotionEmissions)
            !== sha256Canonical(batch.beatPlan.aEmotionEmissions)
        ) throw invalid("Prepared batch Beat downstream mismatch", batch.batchId);
        const lifecycleEmissions = await compileCommittedInvestigationLifecycleEmissionsV1({
          tx,
          beatEvent: beat.event,
          projection: postBeatProjection,
          committedAt: new Date(batch.actions[0]!.command.nowMs).toISOString(),
        });
        const allEmissions = [
          ...plannedDownstream.aEmotionEmissions,
          ...lifecycleEmissions,
        ];
        const downstreamManifest = buildAuthorityDownstreamManifestV1({
          authorityKind: "BEAT",
          sourceId: beat.resolution.resolutionHash,
          sourceCommitHash: beat.resolution.resolutionHash,
          dedupeKeys: downstreamDedupeKeysV1({
            narrativeJobs: plannedDownstream.narrativeJobs,
            aEmotionEmissions: allEmissions,
          }),
        });
        const actionRows = newCommands.map((entry, index) => preparedFormalActionRowV1(events[index]!, entry.command.action));
        const eventRows = [
          ...events.map(preparedLedgerEventRowV1),
          preparedLedgerEventRowV1(beat.event),
          preparedOrchestratorEventRowV1(expectedNextOrchestrator),
          preparedOrchestratorEventRowV1(progression.nextState),
        ];
        if (tx.pressureDecisionAction.createMany && tx.storyEvent.createMany) {
          const [insertedActions, insertedEvents] = await Promise.all([
            tx.pressureDecisionAction.createMany({ data: actionRows }),
            tx.storyEvent.createMany({ data: eventRows }),
          ]);
          if (
            insertedActions.count !== actionRows.length
            || insertedEvents.count !== eventRows.length
          ) throw invalid("Prepared batch insert count mismatch", batch.batchId);
        } else {
          for (const row of actionRows) await tx.pressureDecisionAction.create({ data: row });
          for (const row of eventRows) await tx.storyEvent.create({ data: row });
        }
        await insertNarrativeProjectionPlanV1(
          tx,
          "PROJECT_BEAT_NARRATIVE",
          plannedDownstream.narrativeJobs,
        );
        await insertAEmotionAuthorityEmissionsV1(tx, "CHAPTER_WORKING", allEmissions);
        const postBeatRequiredSeatIds = progression.nextState.activeDecision?.seats
          .filter((seat) => seat.requirement === "REQUIRED")
          .map((seat) => seat.seatId) ?? [];
        const locked = await tx.pressureChapterRuntime.updateMany({
          where: {
            id: runtime.id,
            runId: runtime.runId,
            lockVersion: runtime.lockVersion,
            workingRevision: batch.expectedWorkingRevision,
            workingStateHash: batch.expectedWorkingStateHash,
          },
          data: {
            lockVersion: { increment: 1 },
            decisionStateJson: json(preparedDecisionStateFromProjectionV1(
              postBeatProjection,
              postBeatRequiredSeatIds,
              progression.nextState.activeDecision?.policyHash,
              progression.nextState.orchestratorHash,
            )),
            workingRevision: postBeatProjection.state.revision,
            workingStateJson: json(postBeatProjection.state),
            workingStateHash: postBeatProjection.stateHash,
            ledgerProjectionJson: json(serializePreparedLedgerProjectionV1(
              postBeatProjection,
              downstreamManifest,
            )),
            state: progression.nextState.phase === "ACTIVE"
              ? "DECISION_POINT_OPEN"
              : "CHAPTER_SETTLING",
            ...(progression.nextState.phase === "SETTLING"
              ? { closingAt: new Date(batch.actions[0]!.command.nowMs) }
              : {}),
          },
        });
        if (locked.count !== 1) throw new PreparedLedgerRace();
        return {
          status: "COMMITTED",
          batchId: batch.batchId,
          actionIds: batch.actions.map((item) => item.command.action.actionId),
          replayedActionIds,
          eventHashes: [...events, beat.event].map((event) => event.eventHash),
          ledgerHeadHash: beat.event.eventHash,
          orchestratorState: structuredClone(progression.nextState),
          projection: structuredClone(postBeatProjection),
          conflictReason: null,
        };
      });
    } catch (error) {
      if (!(error instanceof PreparedLedgerRace) && !isUniqueConflict(error)) throw error;
      return batchConflict(batch, "HEAD_CONFLICT");
    }
  }

  async submitPrepared(
    raw: AppendPreparedAutomationActionCommandV1,
  ): Promise<AppendPreparedAutomationActionResultV1> {
    if (raw.authority.actorKind !== "AI") {
      throw invalid("Legacy prepared append only accepts AI authority", raw.command.action.actionId);
    }
    const route = validateRunRouteSnapshotV1(raw.command.routeSnapshot);
    const routeSeatIds = route.seatIds.map((seatId, index) =>
      validateSeatIdV1(seatId, `routeSnapshot.seatIds[${index}]`));
    const action = validateDecisionActionV1(raw.command.action);
    const intent = structuredClone(raw.command.intent);
    validateFormalInteractionIntentV1(intent);
    const command: SubmitFormalInteractionCommandV1 = {
      routeSnapshot: route,
      subjectId: raw.command.subjectId,
      action,
      intent,
      inputFingerprint: raw.command.inputFingerprint,
    };
    validatePreparedAuthorityFence(raw, action.actionId);
    if (
      computeFormalInteractionInputFingerprint(command) !== command.inputFingerprint
      || route.runId !== action.runId
      || action.controlEpoch !== raw.authority.expectedControlEpoch
      || action.expectedWorkingRevision !== raw.authority.expectedWorkingRevision
      || command.subjectId !== raw.authority.expectedControllerId
    ) throw invalid("Prepared automation command fingerprint is invalid", action.actionId);

    try {
      return await pressureFastSerializableTransaction(this.prisma, async (tx) => {
        const [runtime, routeRow, seatRow, run, orchestratorRow] = await Promise.all([
          tx.pressureChapterRuntime.findUnique({
            where: { id: action.chapterRuntimeId },
            select: {
              id: true,
              runId: true,
              chapterId: true,
              routeHash: true,
              workingRevision: true,
              workingStateJson: true,
              workingStateHash: true,
              lockVersion: true,
              decisionStateJson: true,
            },
          }),
          tx.pressureRunRouteSnapshot.findUnique({
            where: { runId: action.runId },
            select: {
              runId: true,
              routeHash: true,
              contentPackageVersion: true,
              contentPackageSha256: true,
            },
          }),
          tx.pressureSeatControlSnapshot.findUnique({
            where: { runId: action.runId },
            select: {
              runId: true,
              stateRevision: true,
              snapshotJson: true,
              stateHash: true,
              version: true,
            },
          }),
          tx.storyRun.findUnique({
            where: { id: action.runId },
            select: { id: true, stateJson: true },
          }),
          tx.storyEvent.findUnique({
            where: {
              dedupeKey: orchestratorDedupeKey(
                action.runId,
                raw.authority.expectedOrchestratorRevision,
              ),
            },
            select: {
              id: true,
              runId: true,
              type: true,
              payloadJson: true,
              dedupeKey: true,
            },
          }),
        ]);
        if (!runtime || !routeRow || !seatRow || !run || !orchestratorRow) {
          return stale(action.actionId, raw.authority.expectedLedgerHeadHash, "CHAPTER_OR_DECISION");
        }
        if (
          routeRow.runId !== route.runId
          || routeRow.routeHash !== route.routeHash
          || routeRow.contentPackageVersion !== route.contentPackageVersion
          || routeRow.contentPackageSha256 !== route.contentPackageSha256
          || runtime.routeHash !== route.routeHash
        ) return stale(action.actionId, raw.authority.expectedLedgerHeadHash, "ROUTE");
        const chapter = validateStoredOrchestratorEvent(
          orchestratorRow,
          action.runId,
          raw.authority.expectedOrchestratorRevision,
        );
        const decisionState = decodePressureMvpDecisionStateV1(runtime.decisionStateJson);
        if (
          decisionState.orchestratorHash !== raw.authority.expectedOrchestratorHash
        ) {
          return stale(action.actionId, raw.authority.expectedLedgerHeadHash, "ORCHESTRATOR_HASH");
        }
        if (decisionState.policyHash !== raw.authority.expectedDecisionPolicyHash) {
          return stale(action.actionId, raw.authority.expectedLedgerHeadHash, "DECISION_POLICY");
        }
        if (chapter.revision !== raw.authority.expectedOrchestratorRevision) {
          return stale(action.actionId, raw.authority.expectedLedgerHeadHash, "ORCHESTRATOR_REVISION");
        }
        if (chapter.orchestratorHash !== raw.authority.expectedOrchestratorHash) {
          return stale(action.actionId, raw.authority.expectedLedgerHeadHash, "ORCHESTRATOR_HASH");
        }
        const active = chapter.activeDecision;
        const activeSeat = active?.seats.find((candidate) => candidate.seatId === action.seatId);
        if (
          chapter.phase !== "ACTIVE"
          || !active
          || !activeSeat
          || activeSeat.requirement !== "REQUIRED"
          || activeSeat.completion !== "PENDING"
          || activeSeat.actionCount !== 0
          || activeSeat.actionIds.length !== 0
          || action.actionOrdinal !== 1
          || chapter.chapterRuntimeId !== action.chapterRuntimeId
          || chapter.currentChapterId !== action.chapterId
          || active.decisionPointId !== action.decisionPointId
          || runtime.id !== action.chapterRuntimeId
          || runtime.runId !== action.runId
          || runtime.chapterId !== action.chapterId
        ) return stale(action.actionId, raw.authority.expectedLedgerHeadHash, "CHAPTER_OR_DECISION");
        if (chapter.descriptorHash !== raw.authority.expectedDescriptorHash) {
          return stale(action.actionId, raw.authority.expectedLedgerHeadHash, "DESCRIPTOR");
        }
        if (active.policyHash !== raw.authority.expectedDecisionPolicyHash) {
          return stale(action.actionId, raw.authority.expectedLedgerHeadHash, "DECISION_POLICY");
        }
        if (active.deadlineAtMs !== null && raw.command.nowMs >= active.deadlineAtMs) {
          return stale(action.actionId, raw.authority.expectedLedgerHeadHash, "DEADLINE");
        }

        const current = await readLedgerEvents(tx, {
          runId: action.runId,
          chapterRuntimeId: action.chapterRuntimeId,
          chapterId: action.chapterId,
        });
        const projection = projectWorkingLedger(current);
        const currentHead = requireHead(projection);
        if (
          runtime.workingRevision !== raw.authority.expectedWorkingRevision
          || projection.state.revision !== raw.authority.expectedWorkingRevision
          || action.expectedWorkingRevision !== raw.authority.expectedWorkingRevision
        ) return stale(action.actionId, currentHead, "WORKING_REVISION");
        if (
          runtime.workingStateHash !== raw.authority.expectedWorkingStateHash
          || projection.stateHash !== raw.authority.expectedWorkingStateHash
        ) return stale(action.actionId, currentHead, "WORKING_STATE");

        const seatSnapshot = decodeSeatEnvelope(seatRow).snapshot;
        if (
          seatSnapshot.runId !== action.runId
          || seatSnapshot.routeHash !== route.routeHash
          || seatSnapshot.stateHash !== seatRow.stateHash
        ) return stale(action.actionId, currentHead, "SEAT_AUTHORITY");
        const seat = seatSnapshot.seatControls.find(
          (candidate) => candidate.seatId === action.seatId,
        );
        if (!seat || seat.controlEpoch !== raw.authority.expectedControlEpoch
          || action.controlEpoch !== raw.authority.expectedControlEpoch) {
          return stale(action.actionId, currentHead, "SEAT_EPOCH");
        }
        if (seat.submissionFenceToken !== raw.authority.expectedSubmissionFenceToken) {
          return stale(action.actionId, currentHead, "SEAT_FENCE");
        }
        if (
          seat.mode !== "AI_ACTIVE"
          || seat.activeControllerId !== raw.authority.expectedControllerId
          || seat.activeControllerId !== seat.designatedAiControllerId
          || raw.command.subjectId !== seat.activeControllerId
        ) return stale(action.actionId, currentHead, "SEAT_CONTROLLER");
        if (seatSnapshot.stateHash !== raw.authority.expectedSeatAuthorityStateHash) {
          return stale(action.actionId, currentHead, "SEAT_AUTHORITY");
        }
        const payload = action.payload as Record<string, unknown>;
        if (
          payload.source !== "CONTENT_OWNED_AI_POLICY"
          || payload.policyHash !== raw.authority.expectedAiPolicyHash
          || !isSha256(String(payload.selectionHash ?? ""))
        ) return stale(action.actionId, currentHead, "AI_POLICY");

        const access = buildPreparedAccess(
          routeSeatIds,
          runtime,
          decisionState,
          seatSnapshot,
          action.seatId,
          run?.stateJson ?? null,
        );
        assertFormalInteractionProjectionBindingsV1(command, projection);
        const replay = findFormalInteractionReplayV1(command, projection, current);
        if (replay) {
          assertFormalInteractionReplayAccessV1(command, access);
          return {
            status: "REPLAYED",
            actionId: action.actionId,
            eventHash: replay.eventHash,
            ledgerHeadHash: currentHead,
            staleReason: null,
          };
        }
        if (currentHead !== raw.authority.expectedLedgerHeadHash) {
          return {
            status: "HEAD_CONFLICT",
            actionId: action.actionId,
            eventHash: null,
            ledgerHeadHash: currentHead,
            staleReason: null,
          };
        }
        assertFormalInteractionAccessV1(command, projection, access);
        assertFormalInteractionIntentAccessV1(action.seatId, intent, projection, access);
        const payloadEvent: FormalActionAcceptedPayloadV1 = {
          eventType: "FORMAL_ACTION_ACCEPTED",
          routeHash: route.routeHash,
          inputFingerprint: command.inputFingerprint,
          action,
          intent,
          audienceSeatIds: computeFormalInteractionAudienceV1(action.seatId, intent),
        };
        const [event] = buildWorkingLedgerEvents({
          key: projection.key,
          chapterId: action.chapterId,
          previousEvents: current,
          payloads: [payloadEvent],
        });
        if (!event) throw invalid("Prepared action event was not built", action.actionId);
        const committed = [...current, event];
        const nextProjection = projectWorkingLedger(committed);
        await persistFormalAction(tx, event);
        await persistLedgerEvent(tx, event);
        const locked = await tx.pressureChapterRuntime.updateMany({
          where: {
            id: runtime.id,
            runId: runtime.runId,
            lockVersion: runtime.lockVersion,
            workingRevision: raw.authority.expectedWorkingRevision,
            workingStateHash: raw.authority.expectedWorkingStateHash,
          },
          data: {
            lockVersion: { increment: 1 },
            decisionStateJson: json(preparedDecisionStateFromProjectionV1(
              nextProjection,
              decisionState.requiredSeatIds,
              decisionState.policyHash,
              decisionState.orchestratorHash,
            )),
            ledgerProjectionJson: json(serializePreparedLedgerProjectionV1(nextProjection)),
          },
        });
        if (locked.count !== 1) throw new PreparedLedgerRace();
        return {
          status: "APPENDED",
          actionId: action.actionId,
          eventHash: event.eventHash,
          ledgerHeadHash: event.eventHash,
          staleReason: null,
        };
      });
    } catch (error) {
      if (!(error instanceof PreparedLedgerRace) && !isUniqueConflict(error)) throw error;
      return this.readAfterConflict(raw);
    }
  }

  private async readAfterConflict(
    raw: AppendPreparedAutomationActionCommandV1,
  ): Promise<AppendPreparedAutomationActionResultV1> {
    const action = raw.command.action;
    return pressureFastSerializableTransaction(this.prisma, async (tx) => {
      const events = await readLedgerEvents(tx, {
        runId: action.runId,
        chapterRuntimeId: action.chapterRuntimeId,
        chapterId: action.chapterId,
      });
      const projection = projectWorkingLedger(events);
      const replay = findFormalInteractionReplayV1(
        {
          routeSnapshot: raw.command.routeSnapshot,
          subjectId: raw.command.subjectId,
          action,
          intent: raw.command.intent,
          inputFingerprint: raw.command.inputFingerprint,
        },
        projection,
        events,
      );
      const head = requireHead(projection);
      return replay
        ? {
            status: "REPLAYED",
            actionId: action.actionId,
            eventHash: replay.eventHash,
            ledgerHeadHash: head,
            staleReason: null,
          }
        : {
            status: "HEAD_CONFLICT",
            actionId: action.actionId,
            eventHash: null,
            ledgerHeadHash: head,
            staleReason: null,
          };
    });
  }
}

function validatePreparedAuthorityFence(
  raw: AppendPreparedAutomationActionCommandV1,
  actionId: string,
): void {
  const authority = raw.authority;
  const hashes = [
    authority.snapshotHash,
    authority.expectedOrchestratorHash,
    authority.expectedDescriptorHash,
    authority.expectedDecisionPolicyHash,
    authority.expectedWorkingStateHash,
    authority.expectedLedgerHeadHash,
    authority.expectedSeatAuthorityStateHash,
    authority.expectedSubmissionFenceToken,
  ];
  if (
    hashes.some((value) => !isSha256(value))
    || (authority.actorKind !== "HUMAN" && authority.actorKind !== "AI")
    || (authority.actorKind === "AI" && !isSha256(authority.expectedAiPolicyHash ?? ""))
    || (authority.actorKind === "HUMAN" && authority.expectedAiPolicyHash !== null)
    || !Number.isSafeInteger(authority.expectedOrchestratorRevision)
    || authority.expectedOrchestratorRevision < 0
    || !Number.isSafeInteger(authority.expectedWorkingRevision)
    || authority.expectedWorkingRevision < 0
    || !Number.isSafeInteger(authority.expectedControlEpoch)
    || authority.expectedControlEpoch < 1
    || typeof authority.expectedControllerId !== "string"
    || !authority.expectedControllerId.trim()
  ) {
    throw invalid("Prepared automation authority fence is invalid", actionId);
  }
}

function validateStoredOrchestratorEvent(
  row: PreparedEventRowV1,
  runId: string,
  revision: number,
): ChapterOrchestratorStateV1 {
  try {
    if (!row.payloadJson || typeof row.payloadJson !== "object" || Array.isArray(row.payloadJson)) {
      throw new Error("ORCHESTRATOR_PAYLOAD_OBJECT_REQUIRED");
    }
    const state = validateOrchestratorStateV1(
      structuredClone(row.payloadJson) as ChapterOrchestratorStateV1,
    );
    if (
      row.runId !== runId
      || row.type !== ORCHESTRATOR_EVENT_TYPE
      || row.dedupeKey !== orchestratorDedupeKey(runId, revision)
      || state.runId !== runId
      || state.revision !== revision
    ) throw new Error("ORCHESTRATOR_ROW_BINDING_MISMATCH");
    return state;
  } catch (cause) {
    throw invalid(
      "Stored Orchestrator row binding is invalid",
      `${row.id}:${cause instanceof Error ? cause.message : String(cause)}`,
    );
  }
}

function orchestratorDedupeKey(runId: string, revision: number): string {
  return `pressure-orchestrator:${runId}:${revision}`;
}

export function preparedOrchestratorEventRowV1(stateValue: ChapterOrchestratorStateV1) {
  const state = validateOrchestratorStateV1(stateValue);
  return {
    id: `pc_orch_${sha256Canonical({
      runId: state.runId,
      revision: state.revision,
      stateHash: state.orchestratorHash,
    }).slice(0, 32)}`,
    runId: state.runId,
    day: chapterSequence(state.currentChapterId),
    type: ORCHESTRATOR_EVENT_TYPE,
    messageType: "system",
    visibility: "system",
    payloadJson: json(state),
    sequence: null,
    dedupeKey: orchestratorDedupeKey(state.runId, state.revision),
  };
}

function buildPreparedAccess(
  routeSeatIds: readonly SeatIdV1[],
  runtime: PreparedRuntimeRowV1,
  decisionState: ReturnType<typeof decodePressureMvpDecisionStateV1>,
  seatSnapshot: SeatControlSnapshotV1,
  seatId: SeatIdV1,
  world: unknown,
): PressureInteractionAccessV1 {
  const seat = seatSnapshot.seatControls.find((candidate) => candidate.seatId === seatId)!;
  return {
    routeHash: runtime.routeHash,
    runId: runtime.runId,
    chapterRuntimeId: runtime.id,
    chapterId: runtime.chapterId as PressureInteractionAccessV1["chapterId"],
    workingRevision: runtime.workingRevision,
    workingStateHash: runtime.workingStateHash,
    activeDecisionPointId: decisionState.activeDecisionPointId,
    controlledSeatIds: [seatId],
    controlEpochBySeat: { [seatId]: seat.controlEpoch },
    allowedActionTypes: stringArray(decisionState.allowedActionTypes),
    interactableSeatIds: routeSeatIds.filter((candidate) => candidate !== seatId),
    visibleEvidenceRefs: visibleEvidenceRefs(world, runtime.workingStateJson, [seatId]),
    resourceAvailability: resourceAvailability(world),
  };
}

async function readLedgerEvents(
  tx: Pick<PreparedAutomationTransactionV1, "storyEvent">,
  key: { runId: string; chapterRuntimeId: string; chapterId: string },
): Promise<WorkingLedgerEventV1[]> {
  const rows = await tx.storyEvent.findMany({
    where: {
      runId: key.runId,
      type: LEDGER_EVENT_TYPE,
      day: chapterNumber(key.chapterId),
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: {
      id: true,
      runId: true,
      type: true,
      payloadJson: true,
      dedupeKey: true,
      createdAt: true,
    },
  });
  const events = rows
    .map(decodeLedgerEvent)
    .filter((event) => event.chapterRuntimeId === key.chapterRuntimeId)
    .sort((left, right) => left.sequence - right.sequence);
  if (events.length) projectWorkingLedger(events);
  return events;
}

function decodeLedgerEvent(row: PreparedEventRowV1): WorkingLedgerEventV1 {
  const event = structuredClone(row.payloadJson) as WorkingLedgerEventV1;
  if (
    event.schemaVersion !== "pressure_working_ledger_event_v1"
    || row.runId !== event.runId
    || row.dedupeKey !== ledgerDedupeKey(event)
  ) throw invalid("Stored Working Ledger row binding is invalid", row.id);
  return event;
}

async function persistFormalAction(
  tx: PreparedAutomationTransactionV1,
  event: WorkingLedgerEventV1,
): Promise<void> {
  if (event.payload.eventType !== "FORMAL_ACTION_ACCEPTED") return;
  await tx.pressureDecisionAction.create({ data: preparedFormalActionRowV1(event, event.payload.action) });
}

async function persistLedgerEvent(
  tx: PreparedAutomationTransactionV1,
  event: WorkingLedgerEventV1,
): Promise<void> {
  await tx.storyEvent.create({ data: preparedLedgerEventRowV1(event) });
}

export function preparedFormalActionRowV1(
  event: WorkingLedgerEventV1,
  action: ReturnType<typeof validateDecisionActionV1>,
): Record<string, unknown> {
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
    payloadJson: json(action.payload),
    payloadHash: action.payloadHash,
    sealedHash: action.sealedHash,
    authorityEventHash: event.eventHash,
    confirmedAt: new Date(),
    sealedAt: new Date(),
  };
}

export function preparedLedgerEventRowV1(event: WorkingLedgerEventV1): Record<string, unknown> {
  return {
    id: `pressure_ledger_${event.eventHash.slice(0, 32)}`,
    runId: event.runId,
    day: chapterNumber(event.chapterId),
    type: LEDGER_EVENT_TYPE,
    messageType: "system",
    roleKey: event.payload.eventType === "FORMAL_ACTION_ACCEPTED"
      ? event.payload.action.seatId
      : null,
    visibility: "system",
    payloadJson: json(event),
    sequence: null,
    dedupeKey: ledgerDedupeKey(event),
  };
}

export function serializePreparedLedgerProjectionV1(
  projection: WorkingLedgerProjectionV1,
  beatDownstreamManifest: unknown = null,
): Record<string, unknown> {
  return withWorkingLedgerProjectionCacheHashV1({
    schemaVersion: "pressure_mvp_ledger_projection_v1",
    key: projection.key,
    chapterId: projection.chapterId,
    routeHash: projection.routeHash,
    chapterDefinitionHash: projection.chapterDefinitionHash,
    headHash: projection.headHash,
    headSequence: projection.headSequence,
    stateHash: projection.stateHash,
    nextDecisionPin: projection.nextDecisionPin,
    acceptedActions: mapEntries(projection.acceptedActions),
    actionsByIdempotencyKey: mapEntries(projection.actionsByIdempotencyKey),
    appliedBeats: mapEntries(projection.appliedBeats),
    pendingReservations: mapEntries(projection.pendingReservations),
    commitments: mapEntries(projection.commitments),
    commitmentActionsByIdempotencyKey: mapEntries(
      projection.commitmentActionsByIdempotencyKey ?? new Map(),
    ),
    evidenceRefsByAction: mapEntries(projection.evidenceRefsByAction),
    knowledgeBySeat: mapEntries(projection.knowledgeBySeat),
    seatArcProgressBySeat: mapEntries(projection.seatArcProgressBySeat),
    beatDownstreamManifest,
  });
}

export function preparedDecisionStateFromProjectionV1(
  projection: WorkingLedgerProjectionV1,
  requiredSeatIds: SeatIdV1[],
  policyHash: string | null | undefined,
  orchestratorHash: string | null | undefined,
) {
  return buildPressureMvpDecisionStateV1({
    workingRevision: projection.state.revision,
    pin: projection.nextDecisionPin,
    requiredSeatIds: projection.nextDecisionPin ? requiredSeatIds : [],
    ...(policyHash && orchestratorHash ? { policyHash, orchestratorHash } : {}),
  });
}

function mapEntries<T>(value: ReadonlyMap<string, T>): Array<[string, T]> {
  return [...value.entries()]
    .map(([key, entry]) => [key, structuredClone(entry)] as [string, T])
    .sort(([left], [right]) => left.localeCompare(right));
}

function requireHead(projection: WorkingLedgerProjectionV1): string {
  if (!isSha256(projection.headHash)) {
    throw invalid("Opened Working Ledger head is missing", projection.key.chapterRuntimeId);
  }
  return projection.headHash;
}

function stale(
  actionId: string,
  head: string,
  staleReason: PreparedAutomationActionStaleReasonV1,
): AppendPreparedAutomationActionResultV1 {
  return {
    status: "STALE",
    actionId,
    eventHash: null,
    ledgerHeadHash: head,
    staleReason,
  };
}

function batchConflict(
  batch: PreparedAutomationActionBatchV1,
  reason: PreparedAutomationActionBatchResultV1["conflictReason"] extends infer T
    ? Exclude<T, null>
    : never,
  head = batch.expectedLedgerHeadHash,
): PreparedAutomationActionBatchResultV1 {
  return {
    status: "CONFLICT",
    batchId: batch.batchId,
    actionIds: [],
    replayedActionIds: [],
    eventHashes: [],
    ledgerHeadHash: head,
    orchestratorState: structuredClone(batch.nextOrchestratorState),
    projection: null,
    conflictReason: reason,
  };
}

function ledgerDedupeKey(event: WorkingLedgerEventV1): string {
  return `pressure-ledger:${event.runId}:${event.chapterRuntimeId}:${event.eventHash}`;
}

function chapterNumber(chapterId: string): number {
  const value = Number(chapterId.replace(/^N/, ""));
  return Number.isSafeInteger(value) ? value : 0;
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) return [];
  return [...new Set(value)].sort();
}

function resourceAvailability(value: unknown): Array<{
  resourceId: string;
  availableAmount: number;
}> {
  if (!value || typeof value !== "object") return [];
  const resources = (value as Record<string, unknown>).resources;
  if (Array.isArray(resources)) {
    return resources.flatMap((entry) => {
      if (!entry || typeof entry !== "object") return [];
      const item = entry as Record<string, unknown>;
      const resourceId = String(item.resourceId ?? "");
      const amount = Number(item.amount ?? item.availableAmount);
      return resourceId && Number.isFinite(amount)
        ? [{ resourceId, availableAmount: amount }]
        : [];
    }).sort((left, right) => left.resourceId.localeCompare(right.resourceId));
  }
  if (!resources || typeof resources !== "object") return [];
  return Object.entries(resources as Record<string, unknown>)
    .flatMap(([resourceId, raw]) => {
      const amount = typeof raw === "number"
        ? raw
        : Number((raw as Record<string, unknown> | null)?.amount);
      return Number.isFinite(amount) ? [{ resourceId, availableAmount: amount }] : [];
    })
    .sort((left, right) => left.resourceId.localeCompare(right.resourceId));
}

function visibleEvidenceRefs(
  world: unknown,
  workingState: unknown,
  seats: SeatIdV1[],
): string[] {
  const refs = new Set<string>();
  collectEvidenceRefs(refs, workingState);
  if (world && typeof world === "object") {
    const record = world as Record<string, unknown>;
    if (Array.isArray(record.evidence)) {
      for (const item of record.evidence) {
        if (!item || typeof item !== "object") continue;
        const evidence = item as Record<string, unknown>;
        const id = String(evidence.evidenceId ?? evidence.evidenceRef ?? "");
        const authorized = stringArray(
          evidence.authorizedSeatIds ?? evidence.knownBySeatIds ?? [],
        );
        if (id && (!authorized.length || seats.some((seat) => authorized.includes(seat)))) {
          refs.add(id);
        }
      }
    }
    const knowledge = record.knowledgeBySeat;
    if (knowledge && typeof knowledge === "object") {
      for (const seat of seats) collectEvidenceRefs(
        refs,
        (knowledge as Record<string, unknown>)[seat],
      );
    }
  }
  return [...refs].sort();
}

function collectEvidenceRefs(target: Set<string>, value: unknown): void {
  if (Array.isArray(value)) {
    for (const entry of value) {
      if (typeof entry === "string" && /evidence|clue|proof|ref/i.test(entry)) {
        target.add(entry);
      } else collectEvidenceRefs(target, entry);
    }
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (/evidenceRefs?|clueRefs?|proofRefs?/i.test(key)) {
      stringArray(entry).forEach((item) => target.add(item));
    } else {
      collectEvidenceRefs(target, entry);
    }
  }
}


function assertFormalInteractionProjectionBindingsV1(
  command: SubmitFormalInteractionCommandV1,
  projection: WorkingLedgerProjectionV1,
): void {
  const { action, routeSnapshot } = command;
  if (
    projection.key.runId !== action.runId
    || projection.key.chapterRuntimeId !== action.chapterRuntimeId
    || projection.chapterId !== action.chapterId
    || projection.routeHash !== routeSnapshot.routeHash
  ) throw invalid("Prepared action ledger binding is stale", action.actionId);
}

function findFormalInteractionReplayV1(
  command: SubmitFormalInteractionCommandV1,
  projection: WorkingLedgerProjectionV1,
  events: readonly WorkingLedgerEventV1[],
): WorkingLedgerEventV1 | null {
  const prior = projection.actionsByIdempotencyKey.get(command.action.idempotencyKey);
  if (!prior) return null;
  if (
    prior.inputFingerprint !== command.inputFingerprint
    || prior.action.requestFingerprint !== command.action.requestFingerprint
    || prior.action.sealedHash !== command.action.sealedHash
  ) throw invalid("Prepared action idempotency key was reused", command.action.idempotencyKey);
  const event = events.find((candidate) => candidate.eventHash === prior.eventHash);
  if (!event) throw invalid("Prepared action replay event is missing", prior.eventHash);
  return structuredClone(event);
}

function findFormalInteractionReplayFromProjectionV1(
  command: SubmitFormalInteractionCommandV1,
  projection: WorkingLedgerProjectionV1,
): AcceptedFormalActionV1 | null {
  const prior = projection.actionsByIdempotencyKey.get(command.action.idempotencyKey);
  if (!prior) return null;
  if (
    prior.inputFingerprint !== command.inputFingerprint
    || prior.action.requestFingerprint !== command.action.requestFingerprint
    || prior.action.sealedHash !== command.action.sealedHash
  ) throw invalid("Prepared action idempotency key was reused", command.action.idempotencyKey);
  return structuredClone(prior);
}

function assertFormalInteractionReplayAccessV1(
  command: SubmitFormalInteractionCommandV1,
  access: PressureInteractionAccessV1,
): void {
  const { action, routeSnapshot } = command;
  if (
    access.routeHash !== routeSnapshot.routeHash
    || access.runId !== action.runId
    || access.chapterRuntimeId !== action.chapterRuntimeId
    || access.chapterId !== action.chapterId
    || !access.controlledSeatIds.includes(action.seatId)
    || access.controlEpochBySeat[action.seatId] !== action.controlEpoch
  ) throw invalid("Prepared action replay authority is stale", action.actionId);
}

function assertFormalInteractionAccessV1(
  command: SubmitFormalInteractionCommandV1,
  projection: WorkingLedgerProjectionV1,
  access: PressureInteractionAccessV1,
): void {
  const { action, routeSnapshot } = command;
  if (
    access.routeHash !== routeSnapshot.routeHash
    || access.runId !== action.runId
    || access.chapterRuntimeId !== action.chapterRuntimeId
    || access.chapterId !== action.chapterId
    || !access.controlledSeatIds.includes(action.seatId)
    || access.controlEpochBySeat[action.seatId] !== action.controlEpoch
    || access.workingRevision !== projection.state.revision
    || access.workingStateHash !== projection.stateHash
    || action.expectedWorkingRevision !== projection.state.revision
    || access.activeDecisionPointId !== action.decisionPointId
    || projection.nextDecisionPin?.decisionPointId !== action.decisionPointId
    || !access.allowedActionTypes.includes(action.actionType)
  ) throw invalid("Prepared action authority is stale", action.actionId);
}

function assertFormalInteractionIntentAccessV1(
  actorSeatId: SeatIdV1,
  intent: SubmitFormalInteractionCommandV1["intent"],
  projection: WorkingLedgerProjectionV1,
  access: PressureInteractionAccessV1,
): void {
  const allowedSeats = new Set([actorSeatId, ...access.interactableSeatIds]);
  const referencedSeats = [
    ...intent.targetSeatIds,
    ...intent.commitmentMutations.flatMap((item) => item.seatIds),
    ...intent.knowledgeGrants.map((item) => item.seatId),
    ...intent.seatArcProgress.map((item) => item.seatId),
  ];
  if (intent.visibility === "PRIVATE" && referencedSeats.some((seatId) => seatId !== actorSeatId)) {
    throw invalid("Private prepared action references another seat", actorSeatId);
  }
  for (const seatId of referencedSeats) {
    if (!allowedSeats.has(seatId)) throw invalid("Prepared action target is forbidden", seatId);
  }
  const visibleEvidence = new Set(access.visibleEvidenceRefs);
  for (const evidenceRef of intent.evidenceRefs) {
    if (!visibleEvidence.has(evidenceRef)) {
      throw invalid("Prepared action evidence is forbidden", evidenceRef);
    }
  }
  const pendingCommitmentIds = new Set(
    [...projection.acceptedActions.values()]
      .filter((accepted) => !projection.appliedBeats.has(accepted.action.actionId))
      .flatMap((accepted) => accepted.intent.commitmentMutations.map((item) => item.commitmentId)),
  );
  for (const mutation of intent.commitmentMutations) {
    const current = projection.commitments.get(mutation.commitmentId);
    if (
      (mutation.operation === "CREATE" && (current || pendingCommitmentIds.has(mutation.commitmentId)))
      || (mutation.operation !== "CREATE" && current?.operation !== "CREATE")
    ) throw invalid("Prepared action commitment state is invalid", mutation.commitmentId);
  }
  const availability = new Map(
    access.resourceAvailability.map((item) => [item.resourceId, item.availableAmount]),
  );
  const alreadyReserved = new Map<string, number>();
  for (const reservation of projection.pendingReservations.values()) {
    alreadyReserved.set(
      reservation.resourceId,
      (alreadyReserved.get(reservation.resourceId) ?? 0) + reservation.amount,
    );
  }
  const requested = new Map<string, number>();
  for (const reservation of intent.resourceReservations) {
    if (projection.pendingReservations.has(reservation.reservationKey)) {
      throw invalid("Prepared action reservation is duplicated", reservation.reservationKey);
    }
    requested.set(
      reservation.resourceId,
      (requested.get(reservation.resourceId) ?? 0) + reservation.amount,
    );
  }
  for (const [resourceId, amount] of requested) {
    const remaining = (availability.get(resourceId) ?? 0) - (alreadyReserved.get(resourceId) ?? 0);
    if (amount > remaining) throw invalid("Prepared action resource is unavailable", resourceId);
  }
}

function validateFormalInteractionIntentV1(
  intent: SubmitFormalInteractionCommandV1["intent"],
): void {
  if (!["PUBLIC", "PARTICIPANTS", "PRIVATE"].includes(intent.visibility)) {
    throw invalid("Prepared action visibility is invalid", intent.visibility);
  }
  const reservationKeys = new Set<string>();
  for (const reservation of intent.resourceReservations) {
    if (
      !reservation.reservationKey.trim()
      || !reservation.resourceId.trim()
      || !Number.isFinite(reservation.amount)
      || reservation.amount <= 0
      || reservationKeys.has(reservation.reservationKey)
    ) throw invalid("Prepared action reservation is invalid", reservation.reservationKey);
    reservationKeys.add(reservation.reservationKey);
  }
  if (new Set(intent.commitmentMutations.map((item) => item.commitmentId)).size
    !== intent.commitmentMutations.length) {
    throw invalid("Prepared action commitment is duplicated", "commitment");
  }
  for (const item of intent.commitmentMutations) {
    if (
      !item.commitmentId.trim()
      || !item.seatIds.length
      || !["CREATE", "FULFILL", "BREAK", "CANCEL"].includes(item.operation)
    ) throw invalid("Prepared action commitment is invalid", item.commitmentId);
  }
  if (new Set(intent.knowledgeGrants.map((item) => item.seatId)).size
    !== intent.knowledgeGrants.length) {
    throw invalid("Prepared action knowledge seat is duplicated", "knowledge");
  }
  if (intent.knowledgeGrants.some((item) => (
    !item.factRefs.length || item.factRefs.some((factRef) => !factRef.trim())
  ))) throw invalid("Prepared action knowledge grant is invalid", "knowledge");
  if (intent.evidenceRefs.some((evidenceRef) => !evidenceRef.trim())) {
    throw invalid("Prepared action evidence reference is invalid", "evidence");
  }
  if (new Set(intent.seatArcProgress.map((item) => item.seatId)).size
    !== intent.seatArcProgress.length) {
    throw invalid("Prepared action seat arc is duplicated", "seat-arc");
  }
  if (intent.seatArcProgress.some((item) => !Number.isFinite(item.progressDelta))) {
    throw invalid("Prepared action seat arc delta is invalid", "seat-arc");
  }
}

function computeFormalInteractionAudienceV1(
  actorSeatId: SeatIdV1,
  intent: SubmitFormalInteractionCommandV1["intent"],
): SeatIdV1[] {
  if (intent.visibility === "PUBLIC") return [...PRESSURE_CHAPTER_SEAT_IDS_V1];
  if (intent.visibility === "PRIVATE") return [actorSeatId];
  const participants = [
    actorSeatId,
    ...intent.targetSeatIds,
    ...intent.commitmentMutations.flatMap((item) => item.seatIds),
    ...intent.knowledgeGrants.map((item) => item.seatId),
  ];
  return PRESSURE_CHAPTER_SEAT_IDS_V1.filter((seatId) => participants.includes(seatId));
}

function json(value: unknown): Prisma.InputJsonValue {
  return structuredClone(value) as Prisma.InputJsonValue;
}

function invalid(message: string, reference: string): PressurePersistenceError {
  return new PressurePersistenceError(
    ERROR.RECORD_INVALID,
    message,
    { reference },
  );
}

class PreparedLedgerRace extends Error {}
