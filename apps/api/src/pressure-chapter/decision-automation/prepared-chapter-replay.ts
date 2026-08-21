import {
  compareCanonicalText,
  sha256Canonical,
  validateRunRouteSnapshotV1,
} from "@ai-story/shared";
import {
  SangtianAuthoritativeBeatCompilerV1,
  planSynchronizedDecisionBeatV1,
} from "../integration/working-ledger.adapters";
import {
  planBeatProgressionV1,
  planRecordedActionsV1,
} from "../orchestrator/chapter-orchestrator.service";
import {
  validateAuthoredChapterRuntimeV1,
  validateOrchestratorStateV1,
} from "../orchestrator/validation";
import { planBeatAuthorityDownstreamV1 } from "../projection-plan/authority-downstream";
import type { WorkingLedgerProjectionV1 } from "../working-ledger/contracts";
import { appendBeatEventToWorkingLedgerProjection } from "../working-ledger/working-ledger";
import type {
  DecisionConvergenceAuthoritySnapshotV1,
  PreparedChapterReplayBatchV1,
  PreparedChapterReplayBeatV1,
} from "./contracts";

const RESOLVER_VERSION = "pressure_orchestrated_beat_v1";

/**
 * Folds every completed non-final Beat from one sealed authority snapshot.
 * The function is pure: no action, state, Beat, Narrative or Settlement write
 * is allowed while the replay plan is being assembled.
 */
export function planPreparedChapterReplayV1(input: Readonly<{
  batchId: string;
  snapshot: Pick<
    DecisionConvergenceAuthoritySnapshotV1,
    "routeSnapshot" | "chapter" | "projection" | "snapshotHash"
  >;
  chapterDescriptor: PreparedChapterReplayBatchV1["chapterDescriptor"];
  nowMs: number;
}>): PreparedChapterReplayBatchV1 | null {
  const route = validateRunRouteSnapshotV1(input.snapshot.routeSnapshot);
  const descriptor = validateAuthoredChapterRuntimeV1(input.chapterDescriptor);
  const initialState = validateOrchestratorStateV1(input.snapshot.chapter);
  if (
    !input.batchId.trim()
    || !Number.isSafeInteger(input.nowMs)
    || input.nowMs < 0
    || initialState.runId !== route.runId
    || initialState.routeHash !== route.routeHash
    || initialState.currentChapterId !== descriptor.chapterId
    || initialState.descriptorHash !== descriptor.descriptorHash
    || input.snapshot.projection.key.runId !== route.runId
    || input.snapshot.projection.key.chapterRuntimeId !== initialState.chapterRuntimeId
  ) throw new Error("PRESSURE_CHAPTER_REPLAY_AUTHORITY_MISMATCH");

  const finalDecisionPointId = descriptor.decisions.at(-1)?.decisionPointId;
  if (!finalDecisionPointId) throw new Error("PRESSURE_CHAPTER_REPLAY_FINAL_DECISION_MISSING");

  let state = initialState;
  let projection = structuredClone(input.snapshot.projection) as WorkingLedgerProjectionV1;
  const beats: PreparedChapterReplayBeatV1[] = [];
  const limit = descriptor.decisions.length + 1;

  for (let pass = 0; pass < limit; pass += 1) {
    if (state.phase !== "ACTIVE" || !state.activeDecision) {
      throw new Error("PRESSURE_CHAPTER_REPLAY_STATE_NOT_ACTIVE");
    }
    const decisionPointId = state.activeDecision.decisionPointId;
    if (decisionPointId === finalDecisionPointId) break;
    const decision = descriptor.decisions.find(
      (candidate) => candidate.decisionPointId === decisionPointId,
    );
    if (!decision) throw new Error("PRESSURE_CHAPTER_REPLAY_DECISION_MISSING");

    const recordedInputs = state.activeDecision.seats
      .filter((seat) => seat.requirement === "REQUIRED")
      .map((seat) => {
        const accepted = [...projection.acceptedActions.values()].filter((item) => (
          item.action.runId === route.runId
          && item.action.chapterRuntimeId === state.chapterRuntimeId
          && item.action.chapterId === state.currentChapterId
          && item.action.decisionPointId === decisionPointId
          && item.action.seatId === seat.seatId
        ));
        if (accepted.length !== 1) {
          throw new Error(`PRESSURE_CHAPTER_REPLAY_ACTION_COUNT:${decisionPointId}:${seat.seatId}:${accepted.length}`);
        }
        const actionBudget = decision.execution.perSeatActionBudget[seat.seatId];
        if (!actionBudget) {
          throw new Error(`PRESSURE_CHAPTER_REPLAY_ACTION_BUDGET:${decisionPointId}:${seat.seatId}`);
        }
        return {
          seatId: seat.seatId,
          actionId: accepted[0]!.action.actionId,
          defaultCode: null,
          actionBudget,
        };
      });
    const recordedState = planRecordedActionsV1(state, recordedInputs, true);
    const actionIds = [...new Set(
      recordedState.activeDecision?.seats.flatMap((seat) => seat.actionIds) ?? [],
    )].sort(compareCanonicalText);
    const beat = planSynchronizedDecisionBeatV1({
      routeSnapshot: route,
      chapterDefinition: descriptor.definition,
      chapterRuntimeId: state.chapterRuntimeId,
      actionIds,
      resolverVersion: RESOLVER_VERSION,
      projection,
      decisionPolicy: new SangtianAuthoritativeBeatCompilerV1(),
    });
    if (beat.status !== "PLANNED") {
      throw new Error(`PRESSURE_CHAPTER_REPLAY_BEAT_NOT_PLANNED:${decisionPointId}`);
    }
    const postBeatProjection = appendBeatEventToWorkingLedgerProjection(projection, beat.event);
    const progression = planBeatProgressionV1({
      state: recordedState,
      descriptor,
      projection: postBeatProjection,
      resolution: beat.resolution,
      nowMs: input.nowMs,
      participantMode: route.participantMode,
      humanSeatIds: route.humanSeatIdsAtStart,
    });
    if (progression.settlementInput || progression.nextState.phase !== "ACTIVE") {
      throw new Error(`PRESSURE_CHAPTER_REPLAY_PREFIX_REACHED_SETTLEMENT:${decisionPointId}`);
    }
    const downstream = planBeatAuthorityDownstreamV1({
      projection: postBeatProjection,
      beatEvent: beat.event,
      contentPackageSha256: route.contentPackageSha256,
      committedAt: new Date(input.nowMs).toISOString(),
      humanSeatIds: route.humanSeatIdsAtStart,
    });
    beats.push({
      decisionPointId,
      actionIds,
      recordedOrchestratorState: recordedState,
      event: beat.event,
      resolution: beat.resolution,
      postBeatOrchestratorState: progression.nextState,
      narrativeJobs: downstream.narrativeJobs,
      aEmotionEmissions: downstream.aEmotionEmissions,
      downstreamManifest: downstream.manifest,
    });
    state = progression.nextState;
    projection = postBeatProjection;
  }

  if (!beats.length) return null;
  if (state.activeDecision?.decisionPointId !== finalDecisionPointId) {
    throw new Error("PRESSURE_CHAPTER_REPLAY_DID_NOT_REACH_FINAL_DECISION");
  }
  const body = {
    schemaVersion: "pressure_prepared_chapter_replay_batch_v1" as const,
    batchId: input.batchId,
    snapshotHash: input.snapshot.snapshotHash,
    routeSnapshot: route,
    runId: route.runId,
    routeHash: route.routeHash,
    chapterRuntimeId: initialState.chapterRuntimeId,
    chapterId: initialState.currentChapterId,
    nowMs: input.nowMs,
    expectedOrchestratorRevision: initialState.revision,
    expectedOrchestratorHash: initialState.orchestratorHash,
    expectedWorkingRevision: input.snapshot.projection.state.revision,
    expectedWorkingStateHash: input.snapshot.projection.stateHash,
    expectedLedgerHeadHash: input.snapshot.projection.headHash,
    chapterDescriptor: descriptor,
    beats,
    finalOrchestratorState: state,
    finalWorkingRevision: projection.state.revision,
    finalWorkingStateHash: projection.stateHash,
    finalLedgerHeadHash: projection.headHash,
  };
  return {
    ...body,
    batchHash: sha256Canonical(body),
  };
}
