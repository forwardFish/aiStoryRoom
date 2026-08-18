import { performance } from "node:perf_hooks";
import {
  compareCanonicalText,
  isSha256,
  sha256Canonical,
  validateDecisionActionV1,
  validateRunRouteSnapshotV1,
  type SeatIdV1,
} from "@ai-story/shared";
import {
  readPressureDecisionCommittedAuthorityV1,
  runWithPressureDecisionConvergenceTimingV1,
} from "../observability/decision-convergence-timing";
import { logPressureDecisionTimingV1 } from "../observability/decision-timing-log";
import {
  validateAuthoredChapterRuntimeV1,
  validateOrchestratorStateV1,
} from "../orchestrator/validation";
import type {
  ChapterOrchestratorStateV1,
  CommittedSettlementResumeAuthorityV1,
  SubmitOrchestratedActionCommandV1,
} from "../orchestrator/contracts";
import { planBeatProgressionV1 } from "../orchestrator/chapter-orchestrator.service";
import type {
  SeatAuthorityRecordV1,
  SeatControlSnapshotV1,
} from "../seat-control/types";
import {
  appendBeatEventToWorkingLedgerProjection,
  workingStateHash,
} from "../working-ledger/working-ledger";
import type {
  AcceptedFormalActionV1,
  WorkingLedgerProjectionV1,
} from "../working-ledger/contracts";
import {
  SangtianAuthoritativeBeatCompilerV1,
  planSynchronizedDecisionBeatV1,
} from "../integration/working-ledger.adapters";
import {
  buildAuthorityDownstreamManifestV1,
  downstreamDedupeKeysV1,
  planBeatAuthorityDownstreamV1,
} from "../projection-plan/authority-downstream";
import {
  DECISION_AUTOMATION_ERROR_CODES as ERROR,
  DecisionAutomationError,
  failDecisionAutomation,
} from "./errors";
import type {
  AiDecisionAutomationPayloadV1,
  AiDecisionPolicyInputV1,
  AiDecisionPolicySelectionV1,
  AppendPreparedAutomationActionCommandV1,
  DecisionAutomationCompilationResultV1,
  PreparedNpcDecisionResolutionV1,
  ResolvedBeatSubmitAuthorityV1,
  DecisionAutomationConfigV1,
  DecisionConvergenceDependenciesV1,
  DecisionAutomationDrainResultV1,
  DecisionAutomationOutcomeKindV1,
  DecisionAutomationStepResultV1,
  DecisionAutomationTaskV1,
  DecisionConvergenceAuthoritySnapshotV1,
  DecisionConvergenceCommandV1,
  DecisionConvergenceDiagnosticsV1,
  DecisionConvergenceResultV1,
  DecisionConvergenceStageTimingsV1,
  PreparedAutomationActionStaleReasonV1,
} from "./contracts";
import {
  canonicalizePreparedAutomationActionsV1,
  createPreparedAutomationActionBatchV1,
  createPreparedMcBatchAuthorityV1,
  planMcRecordedActionsV1,
  validatePreparedNpcDecisionResolutionV1,
  validateResolvedBeatSubmitAuthorityV1,
  planPreparedActionLedgerV1,
} from "./prepared-action-batch";

const DEFAULT_CONFIG: DecisionAutomationConfigV1 = Object.freeze({
  retryMs: 1_000,
});

export function withDecisionConvergenceSnapshotHashV1(
  input: Omit<DecisionConvergenceAuthoritySnapshotV1, "snapshotHash">,
): DecisionConvergenceAuthoritySnapshotV1 {
  const body = structuredClone(input);
  const projection = input.projection;
  const summary = {
    schemaVersion: input.schemaVersion,
    routeSnapshot: input.routeSnapshot,
    chapter: input.chapter,
    projection: {
      key: projection.key,
      chapterId: projection.chapterId,
      routeHash: projection.routeHash,
      chapterDefinitionHash: projection.chapterDefinitionHash,
      headHash: projection.headHash,
      headSequence: projection.headSequence,
      state: projection.state,
      stateHash: projection.stateHash,
      nextDecisionPin: projection.nextDecisionPin,
      acceptedActions: [...projection.acceptedActions.values()]
        .map((item) => ({
          actionId: item.action.actionId,
          idempotencyKey: item.action.idempotencyKey,
          sealedHash: item.action.sealedHash,
          eventHash: item.eventHash,
        }))
        .sort((left, right) => compareCanonicalText(left.actionId, right.actionId)),
    },
    seatAuthority: input.seatAuthority,
    aiPolicyArtifactHash: input.aiPolicyArtifactHash,
    capturedAtMs: input.capturedAtMs,
  };
  return { ...body, snapshotHash: sha256Canonical(summary) };
}

export class PressureDecisionConvergenceServiceV1 {
  private readonly config: DecisionAutomationConfigV1;

  constructor(
    private readonly ports: DecisionConvergenceDependenciesV1,
    config: Partial<DecisionAutomationConfigV1> = {},
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    positive(this.config.retryMs, "config.retryMs");
    if (!isSha256(this.ports.policy.artifactSha256)) {
      mismatch(ERROR.POLICY_INVALID, "policy.artifactSha256", "SHA256_REQUIRED");
    }
  }

  /** WorkerRuntime entry: exactly one active DecisionPoint is processed per tick. */
  async tick(workerId: string): Promise<DecisionAutomationStepResultV1> {
    text(workerId, "workerId", ERROR.INVALID_CONFIGURATION);
    const nowMs = this.ports.clock.nowMs();
    nonNegative(nowMs, "clock.nowMs", ERROR.PORT_RESULT_INVALID);
    let task: DecisionAutomationTaskV1 | null = null;
    try {
      const scanned = validateScannedTasks(await this.ports.scanner.scanActive());
      if (!scanned.length) return { kind: "IDLE" };
      const ordered = [...scanned].sort((left, right) => compareTasksForProcessing(
        left,
        right,
        nowMs,
      ));
      task = ordered[0]!;
      const decisionTasks = ordered.filter((candidate) => sameDecision(candidate, task!));
      assertDecisionTaskGroup(decisionTasks, task);
      const result = await this.converge({
        trigger: "RECOVERY",
        runId: task.runId,
        expectedRouteHash: task.routeHash,
        source: {
          chapterRuntimeId: task.chapterRuntimeId,
          chapterId: task.chapterId,
          decisionPointId: task.decisionPointId,
        },
        nowMs,
        humanSubmitMs: 0,
        humanAction: null,
      });
      return {
        kind: "ACKNOWLEDGED",
        taskHash: task.taskHash,
        outcome: result.outcome,
        actionId: result.actionIds.at(-1) ?? null,
      };
    } catch (error) {
      const errorCode = readErrorCode(error);
      logDecisionRetry(error, errorCode, task);
      return {
        kind: "RETRY_SCHEDULED",
        taskHash: task?.taskHash ?? sha256Canonical({ workerId, nowMs, errorCode }),
        errorCode,
        retryAtMs: nowMs + this.config.retryMs,
      };
    }
  }

  async drain(workerId: string, limit: number): Promise<DecisionAutomationDrainResultV1> {
    positive(limit, "limit");
    // A recovery lane invocation is deliberately decision-scoped. Processing
    // another tick here could rediscover the same WAITING decision repeatedly
    // and recreate the old per-seat/per-poll hot path inside WorkerRuntime.
    const result = await this.tick(workerId);
    return {
      results: [result],
      stoppedBecause: result.kind === "IDLE"
        ? "IDLE"
        : result.kind === "BUSY"
          ? "BUSY"
          : "LIMIT",
    };
  }

  async converge(
    raw: Readonly<DecisionConvergenceCommandV1>,
  ): Promise<DecisionConvergenceResultV1> {
    const endToEndStartedAt = performance.now();
    const command = validateConvergenceCommand(raw);
    const metrics = createMetrics(command);
    const snapshotStartedAt = performance.now();
    metrics.snapshotReadCount = 1;
    const snapshotRaw = command.authoritySnapshot
      ? structuredClone(command.authoritySnapshot)
      : await this.ports.snapshots.capture({
          runId: command.runId,
          expectedRouteHash: command.expectedRouteHash,
          aiPolicyArtifactHash: this.ports.policy.artifactSha256,
          capturedAtMs: command.nowMs,
        });
    metrics.timings.snapshotMs = elapsed(snapshotStartedAt);
    if (!snapshotRaw) {
      metrics.staleRouteCount += 1;
      return this.finish(command, metrics, "STALE_SKIPPED", [], null, endToEndStartedAt);
    }
    const snapshot = validateDecisionConvergenceSnapshotV1(
      snapshotRaw,
      command.runId,
      command.expectedRouteHash,
      this.ports.policy.artifactSha256,
    );
    bindMetricsToSnapshot(metrics, snapshot);
    const route = snapshot.routeSnapshot;
    const chapter = snapshot.chapter;
    const active = chapter.activeDecision;

    if (
      command.source
      && (
        chapter.chapterRuntimeId !== command.source.chapterRuntimeId
        || chapter.currentChapterId !== command.source.chapterId
        || active?.decisionPointId !== command.source.decisionPointId
      )
    ) {
      return this.finish(command, metrics, "ALREADY_PROGRESSED", [], chapter, endToEndStartedAt);
    }
    if (chapter.phase !== "ACTIVE" || !active) {
      return this.finish(command, metrics, "ALREADY_PROGRESSED", [], chapter, endToEndStartedAt);
    }

    const classified = classifyPendingDecisionSeatsV1(snapshot);
    metrics.pendingHumanCount = classified.humans.length;
    metrics.pendingAiCount = classified.ai.length;

    if (active.deadlineAtMs !== null && command.nowMs >= active.deadlineAtMs) {
      const advanced = await this.ports.deadlineDefaults.advanceExpiredDecision({
        routeSnapshot: route,
        expected: {
          chapterRuntimeId: chapter.chapterRuntimeId,
          decisionPointId: active.decisionPointId,
          expectedOrchestratorRevision: chapter.revision,
        },
        nowMs: command.nowMs,
      });
      const state = validateRuntimeState(advanced.state, route.runId, route.routeHash);
      return this.finish(
        command,
        metrics,
        advanced.kind === "APPLIED" ? "DEADLINE_ADVANCED" : "STALE_SKIPPED",
        [],
        state,
        endToEndStartedAt,
      );
    }

    const human = resolveMcHumanSubmissionV1(snapshot, classified.humans, command);
    if (!human) {
      return this.finish(
        command,
        metrics,
        classified.humans.length > 0 ? "WAITING_FOR_HUMANS" : "NO_PENDING_AI",
        [],
        chapter,
        endToEndStartedAt,
      );
    }
    const descriptor = validateAuthoredChapterRuntimeV1(await this.ports.content.load({
      routeSnapshot: route,
      chapterId: chapter.currentChapterId,
    }));
    if (
      descriptor.chapterId !== chapter.currentChapterId
      || descriptor.descriptorHash !== chapter.descriptorHash
    ) {
      mismatch(ERROR.CONTENT_MISMATCH, "content.descriptor", "FROZEN_BINDING_MISMATCH");
    }
    const decision = descriptor.decisions.find(
      (candidate) => candidate.decisionPointId === active.decisionPointId,
    );
    if (!decision || sha256Canonical(decision) !== active.policyHash) {
      metrics.stalePolicyCount += 1;
      mismatch(ERROR.CONTENT_MISMATCH, "content.decision", "POLICY_HASH_MISMATCH");
    }
    const eligibleActionTypes = [...new Set(decision.execution.allowedActionTypes)]
      .sort(compareCanonicalText);
    if (!eligibleActionTypes.length) {
      mismatch(ERROR.CONTENT_MISMATCH, "content.allowedActionTypes", "EMPTY");
    }

    const beatSubmit = this.ports.beatSubmitAuthority.resolve({
      routeSnapshot: route,
      chapter,
      projection: snapshot.projection,
      seatAuthority: snapshot.seatAuthority,
      viewerSeatId: human.viewerSeatId,
    });
    assertMcBeatSubmitPlanV1(beatSubmit, human.viewerSeatId);

    const compileStartedAt = performance.now();
    const prepared: AppendPreparedAutomationActionCommandV1[] = [human.prepared];
    const npcDecisions: PreparedNpcDecisionResolutionV1[] = [];
    if (beatSubmit.plan.mode === "CHAPTER_COUNCIL_COMMIT") {
      const compileNpcDecision = this.ports.compiler.compileNpcDecision;
      if (!compileNpcDecision) {
        mismatch(ERROR.INVALID_CONFIGURATION, "compiler.compileNpcDecision", "REQUIRED");
      }
      for (const seatId of beatSubmit.plan.npcResolutionSeatIds) {
        const item = classified.ai.find((candidate) => candidate.seat.seatId === seatId);
        if (!item || decision.seatRequirements[seatId] !== "REQUIRED") {
          mismatch(ERROR.AUTHORITY_MISMATCH, "beatSubmit.npcResolutionSeatIds", seatId);
        }
        const preparedResolution = validatePreparedNpcDecisionResolutionV1(
          this.ports.npcCouncilPolicy.resolve({
            routeSnapshot: route,
            chapter,
            projection: snapshot.projection,
            seatAuthority: {
              seatId,
              mode: "AI_ACTIVE",
              activeControllerId: item.authority.activeControllerId,
              controlEpoch: item.authority.controlEpoch,
              submissionFenceToken: item.authority.submissionFenceToken,
              authorityStateHash: snapshot.seatAuthority.stateHash,
              requiresResolution: true,
            },
            eligibleActionTypes,
          }),
        );
        assertNpcPolicyAuthorityV1(
          preparedResolution,
          item.authority,
          snapshot,
          this.ports.npcCouncilPolicy.artifactSha256,
          this.ports.npcCouncilPolicy.identityPolicyArtifactSha256,
        );
        metrics.policyCallCount += 1;
        npcDecisions.push(preparedResolution);
        const compiled = compileNpcDecision.call(this.ports.compiler, {
          routeSnapshot: route,
          chapter,
          projection: snapshot.projection,
          seatAuthority: {
            seatId,
            activeControllerId: item.authority.activeControllerId,
            controlEpoch: item.authority.controlEpoch,
            submissionFenceToken: item.authority.submissionFenceToken,
          },
          prepared: preparedResolution,
          nowMs: command.nowMs,
        });
        metrics.compileCount += 1;
        const preparedAction = compiled.kind === "ALREADY_ACCEPTED"
          ? prepareAcceptedNpcReplayV1(
              snapshot,
              item.authority,
              preparedResolution,
              compiled,
              command.nowMs,
            )
          : prepareCompiledNpcActionV1(
              snapshot,
              item.authority,
              preparedResolution,
              compiled.command,
            );
        prepared.push(preparedAction);
      }
    } else if (
      beatSubmit.plan.npcResolutionSeatIds.length !== 0
      || beatSubmit.plan.invokeSettlement
    ) {
      mismatch(ERROR.AUTHORITY_MISMATCH, "beatSubmit.plan", "INTERMEDIATE_AUTHORITY_INVALID");
    }
    metrics.timings.compileAllMs = elapsed(compileStartedAt);

    if (!this.ports.preparedActions.submitPreparedBatch) {
      mismatch(ERROR.INVALID_CONFIGURATION, "preparedActions.submitPreparedBatch", "PRODUCTION_REQUIRED");
    }
    const mcAuthority = createPreparedMcBatchAuthorityV1({
      beatSubmit,
      npcDecisions,
    });
    const canonicalPrepared = canonicalizePreparedAutomationActionsV1(route, prepared);
    const recordedState = planMcRecordedActionsV1({
      state: chapter,
      actions: canonicalPrepared.map((item) => ({
        seatId: item.command.action.seatId,
        actionId: item.command.action.actionId,
        defaultCode: null,
        actionBudget: decision.execution.perSeatActionBudget[item.command.action.seatId]!,
      })),
      mcAuthority,
    });
    const newPrepared = canonicalPrepared.filter((item) => (
      !findExactAcceptedPreparedActionV1(snapshot.projection, item)
    ));
    const actionPlan = newPrepared.length > 0
      ? planPreparedActionLedgerV1({
          projection: snapshot.projection,
          actions: newPrepared,
        })
      : {
          payloads: [],
          events: [],
          projection: cloneWorkingProjectionV1(snapshot.projection),
        };
    const allActionIds = [...new Set(
      recordedState.activeDecision?.seats.flatMap((seat) => seat.actionIds) ?? [],
    )].sort(compareCanonicalText);
    const beat = planSynchronizedDecisionBeatV1({
      routeSnapshot: route,
      chapterDefinition: descriptor.definition,
      chapterRuntimeId: chapter.chapterRuntimeId,
      actionIds: allActionIds,
      resolverVersion: "pressure_orchestrated_beat_v1",
      projection: actionPlan.projection,
      decisionPolicy: new SangtianAuthoritativeBeatCompilerV1(),
    });
    if (beat.status !== "PLANNED") {
      mismatch(ERROR.AUTHORITY_MISMATCH, "beatPlan", "UNEXPECTED_REPLAY");
    }
    const postBeatProjection = appendBeatEventToWorkingLedgerProjection(
      actionPlan.projection,
      beat.event,
    );
    const progression = planBeatProgressionV1({
      state: recordedState,
      descriptor,
      projection: postBeatProjection,
      resolution: beat.resolution,
      nowMs: command.nowMs,
    });
    assertMcProgressionV1(beatSubmit, progression);
    const plannedDownstream = planBeatAuthorityDownstreamV1({
      projection: postBeatProjection,
      beatEvent: beat.event,
      contentPackageSha256: route.contentPackageSha256,
      committedAt: new Date(command.nowMs).toISOString(),
      humanSeatIds: route.humanSeatIdsAtStart,
    });
    const downstream = beatSubmit.plan.mode === "INTERMEDIATE_ACTION_ONLY"
      ? {
          narrativeJobs: plannedDownstream.narrativeJobs,
          aEmotionEmissions: [],
          manifest: buildAuthorityDownstreamManifestV1({
            authorityKind: "BEAT",
            sourceId: beat.resolution.resolutionHash,
            sourceCommitHash: beat.resolution.resolutionHash,
            dedupeKeys: downstreamDedupeKeysV1({
              narrativeJobs: plannedDownstream.narrativeJobs,
              aEmotionEmissions: [],
            }),
          }),
        }
      : plannedDownstream;
    const batch = createPreparedAutomationActionBatchV1({
      batchId: metrics.batchId,
      snapshotHash: snapshot.snapshotHash,
      routeSnapshot: route,
      chapterRuntimeId: chapter.chapterRuntimeId,
      chapterId: chapter.currentChapterId,
      decisionPointId: active.decisionPointId,
      expectedOrchestratorRevision: chapter.revision,
      expectedOrchestratorHash: chapter.orchestratorHash,
      expectedWorkingRevision: snapshot.projection.state.revision,
      expectedWorkingStateHash: snapshot.projection.stateHash,
      expectedLedgerHeadHash: snapshot.projection.headHash,
      expectedSeatAuthorityStateHash: snapshot.seatAuthority.stateHash,
      actions: canonicalPrepared,
      chapterDescriptor: descriptor,
      nextOrchestratorState: recordedState,
      mcAuthority,
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

    const appendStartedAt = performance.now();
    metrics.appendTxCount = 1;
    const result = await this.ports.preparedActions.submitPreparedBatch(batch);
    metrics.timings.ledgerAppendTotalMs = elapsed(appendStartedAt);
    const expectedActionIds = canonicalStrings(
      canonicalPrepared.map((item) => item.command.action.actionId),
    );
    if (
      result.batchId !== batch.batchId
      || !isSha256(result.ledgerHeadHash)
    ) mismatch(ERROR.PORT_RESULT_INVALID, "preparedBatch.result", "INVALID_ENVELOPE");
    if (result.status === "CONFLICT") {
      // Conflict payload fields are diagnostic only and are never consumed as
      // committed authority.  Bind the envelope and reason, then discard every
      // candidate action/projection so no partial success can escape.
      if (result.conflictReason === null) {
        mismatch(ERROR.PORT_RESULT_INVALID, "preparedBatch.conflict", "REASON_REQUIRED");
      }
      if (result.conflictReason === "HEAD_CONFLICT") metrics.headConflictCount += 1;
      else countStale(metrics, result.conflictReason);
      return this.finish(
        command,
        metrics,
        "STALE_SKIPPED",
        [],
        chapter,
        endToEndStartedAt,
      );
    }
    if (
      result.conflictReason !== null
      || sha256Canonical(canonicalStrings(result.actionIds))
        !== sha256Canonical(expectedActionIds)
      || result.orchestratorState.orchestratorHash
        !== batch.beatPlan.postBeatOrchestratorState.orchestratorHash
    ) mismatch(ERROR.PORT_RESULT_INVALID, "preparedBatch.result", "INVALID_BINDING");
    metrics.replayCount += result.replayedActionIds.length;
    const replayed = new Set(result.replayedActionIds);
    metrics.npcWriteCount = result.status === "COMMITTED"
      ? canonicalPrepared.filter((item) => (
          item.authority.actorKind === "AI"
          && !replayed.has(item.command.action.actionId)
        )).length
      : 0;
    if (result.status === "REPLAYED") {
      return this.finish(
        command,
        metrics,
        "BATCH_COMPLETED",
        expectedActionIds,
        result.orchestratorState,
        endToEndStartedAt,
      );
    }

    let resumedResult: {
      state: ChapterOrchestratorStateV1;
      committedAuthority: DecisionConvergenceResultV1["committedAuthority"];
    };
    if (result.orchestratorState.phase === "ACTIVE") {
      resumedResult = { state: result.orchestratorState, committedAuthority: null };
    } else {
      if (
        result.orchestratorState.phase !== "SETTLING"
        || !result.projection
        || !batch.beatPlan.settlementInput
      ) mismatch(ERROR.PORT_RESULT_INVALID, "preparedBatch.settlement", "COMMITTED_AUTHORITY_REQUIRED");
      resumedResult = await this.resumeOnce(
        snapshot,
        metrics,
        command.nowMs,
        {
          state: structuredClone(result.orchestratorState),
          chapterDescriptor: structuredClone(descriptor),
          workingProjection: structuredClone(result.projection),
          settlementInput: structuredClone(batch.beatPlan.settlementInput),
        },
      );
    }

    const resumed = resumedResult.state;
    let finalProjection = resumedResult.committedAuthority?.workingProjection
      ?? result.projection;
    const finalDescriptor = resumedResult.committedAuthority?.chapterDescriptor
      ?? (resumed.currentChapterId === descriptor.chapterId
      ? descriptor
      : validateAuthoredChapterRuntimeV1(await this.ports.content.load({
          routeSnapshot: route,
          chapterId: resumed.currentChapterId,
        })));
    if (
      resumed.phase === "ACTIVE"
      && !projectionMatchesChapter(finalProjection, resumed)
      && this.ports.snapshots.loadWorkingProjection
    ) {
      finalProjection = await this.ports.snapshots.loadWorkingProjection({
        runId: resumed.runId,
        routeHash: resumed.routeHash,
        chapterRuntimeId: resumed.chapterRuntimeId,
        chapterId: resumed.currentChapterId,
      });
    }
    const committedAuthority = resumed.phase === "ACTIVE"
      && finalDescriptor.descriptorHash === resumed.descriptorHash
      && projectionMatchesChapter(finalProjection, resumed)
      ? {
          chapter: structuredClone(resumed),
          workingProjection: structuredClone(finalProjection),
          chapterDescriptor: structuredClone(finalDescriptor),
        }
      : null;
    return this.finish(
      command,
      metrics,
      "BATCH_COMPLETED",
      expectedActionIds,
      resumed,
      endToEndStartedAt,
      committedAuthority,
    );
  }

  /** Completes the HTTP-only timing envelope without changing its response. */
  async recordHttpCompletion(
    result: Readonly<DecisionConvergenceResultV1>,
    input: Readonly<{ projectionMs: number; endToEndMs: number }>,
  ): Promise<void> {
    const metrics = structuredClone(result.metrics);
    metrics.timings.projectionMs = nonNegativeNumber(input.projectionMs);
    metrics.timings.endToEndMs = nonNegativeNumber(input.endToEndMs);
    await this.ports.diagnostics.record(metrics);
    logPressureDecisionTimingV1({
      path: "HTTP",
      runId: metrics.runId,
      chapterId: metrics.chapterId ?? "UNKNOWN",
      decisionPointId: metrics.decisionPointId ?? "UNKNOWN",
      outcome: result.outcome,
      failureCode: null,
      timings: metrics.timings,
    });
  }

  private async resumeOnce(
    snapshot: DecisionConvergenceAuthoritySnapshotV1,
    metrics: DecisionConvergenceDiagnosticsV1,
    nowMs: number,
    committedSettlementAuthority: CommittedSettlementResumeAuthorityV1 | null = null,
  ): Promise<{
    state: ChapterOrchestratorStateV1;
    committedAuthority: DecisionConvergenceResultV1["committedAuthority"];
  }> {
    if (metrics.resumeCount !== 0) {
      mismatch(ERROR.PORT_RESULT_INVALID, "runtime.resume", "AT_MOST_ONCE");
    }
    metrics.resumeCount = 1;
    const startedAt = performance.now();
    let committedAuthority: DecisionConvergenceResultV1["committedAuthority"] = null;
    const state = await runWithPressureDecisionConvergenceTimingV1(
      metrics.timings,
      () => { metrics.w4ConflictCount += 1; },
      async () => {
        const useFastSettlementResume = Boolean(
          committedSettlementAuthority
          && this.ports.runtime.resumeFromCommittedSettlementAuthority,
        );
        if (useFastSettlementResume) metrics.fastSettlementResumeCalls += 1;
        const resumed = useFastSettlementResume
          ? await this.ports.runtime.resumeFromCommittedSettlementAuthority!(
              snapshot.routeSnapshot,
              committedSettlementAuthority!,
              nowMs,
            )
          : await this.ports.runtime.resume(snapshot.routeSnapshot, nowMs);
        committedAuthority = readPressureDecisionCommittedAuthorityV1();
        return resumed;
      },
    );
    metrics.timings.orchestratorTotalMs = elapsed(startedAt);
    return {
      state: validateRuntimeState(
        state,
        snapshot.routeSnapshot.runId,
        snapshot.routeSnapshot.routeHash,
      ),
      committedAuthority,
    };
  }

  private async finish(
    command: DecisionConvergenceCommandV1,
    metrics: DecisionConvergenceDiagnosticsV1,
    outcome: DecisionAutomationOutcomeKindV1,
    actionIds: string[],
    chapter: ChapterOrchestratorStateV1 | null,
    endToEndStartedAt: number,
    committedAuthority: DecisionConvergenceResultV1["committedAuthority"] = null,
  ): Promise<DecisionConvergenceResultV1> {
    metrics.outcome = outcome;
    metrics.timings.endToEndMs = elapsed(endToEndStartedAt);
    const result: DecisionConvergenceResultV1 = {
      schemaVersion: "pressure_decision_convergence_result_v1",
      batchId: metrics.batchId,
      outcome,
      actionIds: canonicalStrings(actionIds),
      chapter: chapter ? structuredClone(chapter) : null,
      committedAuthority: committedAuthority
        ? structuredClone(committedAuthority)
        : null,
      metrics: structuredClone(metrics),
    };
    if (command.trigger === "RECOVERY") {
      await this.ports.diagnostics.record(result.metrics);
    }
    logPressureDecisionTimingV1({
      path: "GENERIC_CONVERGENCE",
      runId: command.runId,
      chapterId: metrics.chapterId ?? command.source?.chapterId ?? "UNKNOWN",
      decisionPointId: metrics.decisionPointId ?? command.source?.decisionPointId ?? "UNKNOWN",
      outcome,
      failureCode: null,
      timings: metrics.timings,
    });
    return result;
  }
}


type PendingHumanSeatV1 = Readonly<{
  seat: NonNullable<ChapterOrchestratorStateV1["activeDecision"]>["seats"][number];
  authority: SeatAuthorityRecordV1;
}>;

function resolveMcHumanSubmissionV1(
  snapshot: DecisionConvergenceAuthoritySnapshotV1,
  pendingHumans: ReadonlyArray<PendingHumanSeatV1>,
  command: DecisionConvergenceCommandV1,
): Readonly<{
  viewerSeatId: SeatIdV1;
  prepared: AppendPreparedAutomationActionCommandV1;
}> | null {
  const active = snapshot.chapter.activeDecision;
  if (!active) return null;
  if (command.humanAction) {
    const raw = structuredClone(command.humanAction);
    const action = validateDecisionActionV1(raw.action);
    const authority = requireHumanAuthorityV1(snapshot, action.seatId, raw.subjectId);
    const prepared = prepareDecisionHumanActionV1(snapshot, pendingHumans, raw);
    if (prepared) return { viewerSeatId: action.seatId, prepared };
    const accepted = requireExactAcceptedCommandV1(snapshot.projection, raw);
    return {
      viewerSeatId: action.seatId,
      prepared: preparedAcceptedActionV1(snapshot, authority, accepted, command.nowMs, "HUMAN"),
    };
  }

  const recovered: Array<{
    authority: SeatAuthorityRecordV1;
    accepted: AcceptedFormalActionV1;
  }> = [];
  for (const rawSeatId of snapshot.routeSnapshot.seatIds) {
    const seatId = rawSeatId as SeatIdV1;
    const authority = snapshot.seatAuthority.seatControls.find(
      (candidate) => candidate.seatId === seatId,
    );
    if (!authority || authority.mode !== "HUMAN_ACTIVE") continue;
    const accepted = [...snapshot.projection.acceptedActions.values()]
      .filter((candidate) => (
        candidate.action.seatId === seatId
        && candidate.action.runId === snapshot.routeSnapshot.runId
        && candidate.action.chapterRuntimeId === snapshot.chapter.chapterRuntimeId
        && candidate.action.chapterId === snapshot.chapter.currentChapterId
        && candidate.action.decisionPointId === active.decisionPointId
        && candidate.action.controlEpoch === authority.controlEpoch
      ))
      .sort((left, right) => compareCanonicalText(
        left.action.actionId,
        right.action.actionId,
      ));
    if (accepted.length > 1) {
      mismatch(ERROR.AUTHORITY_MISMATCH, "recovery.humanAction", `MULTIPLE:${seatId}`);
    }
    if (accepted.length === 1) recovered.push({ authority, accepted: accepted[0]! });
  }
  if (recovered.length > 1) {
    mismatch(ERROR.AUTHORITY_MISMATCH, "recovery.humanAction", "MULTIPLE_HUMAN_SEATS");
  }
  const recoveredHuman = recovered[0];
  if (!recoveredHuman) return null;
  const activeSeat = active.seats.find(
    (candidate) => candidate.seatId === recoveredHuman.authority.seatId,
  );
  if (!activeSeat || activeSeat.requirement !== "REQUIRED") {
    mismatch(ERROR.AUTHORITY_MISMATCH, "recovery.humanSeat", recoveredHuman.authority.seatId);
  }
  return {
    viewerSeatId: recoveredHuman.authority.seatId,
    prepared: preparedAcceptedActionV1(
      snapshot,
      recoveredHuman.authority,
      recoveredHuman.accepted,
      command.nowMs,
      "HUMAN",
    ),
  };
}

function requireHumanAuthorityV1(
  snapshot: DecisionConvergenceAuthoritySnapshotV1,
  seatId: SeatIdV1,
  controllerId: string,
): SeatAuthorityRecordV1 {
  const activeSeat = snapshot.chapter.activeDecision?.seats.find(
    (candidate) => candidate.seatId === seatId,
  );
  const authority = snapshot.seatAuthority.seatControls.find(
    (candidate) => candidate.seatId === seatId,
  );
  if (
    !activeSeat
    || activeSeat.requirement !== "REQUIRED"
    || !authority
    || authority.mode !== "HUMAN_ACTIVE"
    || authority.activeControllerId !== controllerId
    || authority.controlEpoch < 1
    || !isSha256(authority.submissionFenceToken)
  ) mismatch(ERROR.AUTHORITY_MISMATCH, "humanAction.authority", seatId);
  return authority;
}

function requireExactAcceptedCommandV1(
  projection: WorkingLedgerProjectionV1,
  command: NonNullable<DecisionConvergenceCommandV1["humanAction"]>,
) {
  const action = validateDecisionActionV1(command.action);
  const byAction = projection.acceptedActions.get(action.actionId);
  const byKey = projection.actionsByIdempotencyKey.get(action.idempotencyKey);
  if (!byAction || !byKey || byAction.eventHash !== byKey.eventHash) {
    mismatch(ERROR.AUTHORITY_MISMATCH, "humanAction.replay", "ACCEPTED_ACTION_REQUIRED");
  }
  if (
    byAction.action.sealedHash !== action.sealedHash
    || byAction.inputFingerprint !== command.inputFingerprint
    || sha256Canonical(byAction.action) !== sha256Canonical(action)
    || sha256Canonical(byAction.intent) !== sha256Canonical(command.intent)
  ) mismatch(ERROR.AUTHORITY_MISMATCH, "humanAction.replay", "IDEMPOTENCY_MISMATCH");
  return structuredClone(byAction);
}

function preparedAcceptedActionV1(
  snapshot: DecisionConvergenceAuthoritySnapshotV1,
  authority: SeatAuthorityRecordV1,
  accepted: WorkingLedgerProjectionV1["acceptedActions"] extends Map<string, infer V>
    ? V
    : never,
  nowMs: number,
  actorKind: "HUMAN" | "AI",
  preparedNpc: PreparedNpcDecisionResolutionV1 | null = null,
): AppendPreparedAutomationActionCommandV1 {
  const active = snapshot.chapter.activeDecision;
  if (!active || accepted.action.decisionPointId !== active.decisionPointId) {
    mismatch(ERROR.AUTHORITY_MISMATCH, "acceptedAction.decision", "MISMATCH");
  }
  if (
    accepted.action.seatId !== authority.seatId
    || accepted.action.controlEpoch !== authority.controlEpoch
    || accepted.action.expectedWorkingRevision !== snapshot.projection.state.revision
    || (actorKind === "HUMAN" && authority.mode !== "HUMAN_ACTIVE")
    || (actorKind === "AI" && (
      authority.mode !== "AI_ACTIVE"
      || authority.activeControllerId !== authority.designatedAiControllerId
      || !preparedNpc
    ))
  ) mismatch(ERROR.AUTHORITY_MISMATCH, "acceptedAction.authority", "MISMATCH");
  const command = {
    routeSnapshot: structuredClone(snapshot.routeSnapshot),
    subjectId: authority.activeControllerId,
    action: structuredClone(accepted.action),
    intent: structuredClone(accepted.intent),
    inputFingerprint: accepted.inputFingerprint,
    nowMs,
  };
  if (actorKind === "AI") {
    assertNpcCommandBindingV1(preparedNpc!, command);
  }
  return {
    command,
    authority: {
      actorKind,
      snapshotHash: snapshot.snapshotHash,
      expectedOrchestratorRevision: snapshot.chapter.revision,
      expectedOrchestratorHash: snapshot.chapter.orchestratorHash,
      expectedDescriptorHash: snapshot.chapter.descriptorHash,
      expectedDecisionPolicyHash: active.policyHash,
      expectedWorkingRevision: snapshot.projection.state.revision,
      expectedWorkingStateHash: snapshot.projection.stateHash,
      expectedLedgerHeadHash: snapshot.projection.headHash,
      expectedSeatAuthorityStateHash: snapshot.seatAuthority.stateHash,
      expectedControllerId: authority.activeControllerId,
      expectedControlEpoch: authority.controlEpoch,
      expectedSubmissionFenceToken: authority.submissionFenceToken,
      expectedAiPolicyHash: preparedNpc?.resolution.policyHash ?? null,
      expectedNpcResolutionHash: preparedNpc?.resolution.resolutionHash ?? null,
    },
  };
}

function prepareAcceptedNpcReplayV1(
  snapshot: DecisionConvergenceAuthoritySnapshotV1,
  authority: SeatAuthorityRecordV1,
  prepared: PreparedNpcDecisionResolutionV1,
  compiled: Extract<DecisionAutomationCompilationResultV1, { kind: "ALREADY_ACCEPTED" }>,
  nowMs: number,
): AppendPreparedAutomationActionCommandV1 {
  const byAction = snapshot.projection.acceptedActions.get(compiled.actionId);
  const byKey = snapshot.projection.actionsByIdempotencyKey.get(compiled.idempotencyKey);
  if (
    !byAction
    || !byKey
    || byAction.eventHash !== byKey.eventHash
    || byAction.inputFingerprint !== compiled.inputFingerprint
  ) mismatch(ERROR.COMPILER_INVALID, "compiler.npcReplay", "ACCEPTED_ACTION_REQUIRED");
  return preparedAcceptedActionV1(
    snapshot,
    authority,
    byAction,
    nowMs,
    "AI",
    prepared,
  );
}


function assertNpcPolicyAuthorityV1(
  prepared: PreparedNpcDecisionResolutionV1,
  authority: SeatAuthorityRecordV1,
  snapshot: DecisionConvergenceAuthoritySnapshotV1,
  expectedPolicyArtifactSha256: string,
  expectedIdentityPolicyArtifactSha256: string,
): void {
  if (
    !isSha256(expectedPolicyArtifactSha256)
    || !isSha256(expectedIdentityPolicyArtifactSha256)
    || prepared.seatId !== authority.seatId
    || prepared.input.runId !== snapshot.routeSnapshot.runId
    || prepared.input.routeHash !== snapshot.routeSnapshot.routeHash
    || prepared.input.chapterRuntimeId !== snapshot.chapter.chapterRuntimeId
    || prepared.input.chapterId !== snapshot.chapter.currentChapterId
    || prepared.input.decisionPointId
      !== snapshot.chapter.activeDecision?.decisionPointId
    || prepared.input.controllerAuthority.mode !== "AI_ACTIVE"
    || prepared.input.controllerAuthority.activeControllerId
      !== authority.activeControllerId
    || prepared.input.controllerAuthority.controlEpoch !== authority.controlEpoch
    || prepared.input.controllerAuthority.authorityStateHash
      !== snapshot.seatAuthority.stateHash
    || prepared.input.controllerAuthority.requiresResolution !== true
    || prepared.resolution.policyHash !== expectedPolicyArtifactSha256
    || prepared.resolution.identityPolicyArtifactSha256
      !== expectedIdentityPolicyArtifactSha256
  ) mismatch(ERROR.POLICY_INVALID, "npcCouncil.resolution", "PUBLISHED_AUTHORITY_MISMATCH");
}

function prepareCompiledNpcActionV1(
  snapshot: DecisionConvergenceAuthoritySnapshotV1,
  authority: SeatAuthorityRecordV1,
  prepared: PreparedNpcDecisionResolutionV1,
  command: AppendPreparedAutomationActionCommandV1["command"],
): AppendPreparedAutomationActionCommandV1 {
  assertNpcCommandBindingV1(prepared, command);
  if (
    authority.mode !== "AI_ACTIVE"
    || authority.activeControllerId !== authority.designatedAiControllerId
    || command.subjectId !== authority.activeControllerId
    || command.action.controlEpoch !== authority.controlEpoch
    || command.action.expectedWorkingRevision !== snapshot.projection.state.revision
    || command.action.seatId !== authority.seatId
  ) mismatch(ERROR.COMPILER_INVALID, "compiler.npcCommand", "AUTHORITY_BINDING_MISMATCH");
  const active = snapshot.chapter.activeDecision!;
  return {
    command: structuredClone(command),
    authority: {
      actorKind: "AI",
      snapshotHash: snapshot.snapshotHash,
      expectedOrchestratorRevision: snapshot.chapter.revision,
      expectedOrchestratorHash: snapshot.chapter.orchestratorHash,
      expectedDescriptorHash: snapshot.chapter.descriptorHash,
      expectedDecisionPolicyHash: active.policyHash,
      expectedWorkingRevision: snapshot.projection.state.revision,
      expectedWorkingStateHash: snapshot.projection.stateHash,
      expectedLedgerHeadHash: snapshot.projection.headHash,
      expectedSeatAuthorityStateHash: snapshot.seatAuthority.stateHash,
      expectedControllerId: authority.activeControllerId,
      expectedControlEpoch: authority.controlEpoch,
      expectedSubmissionFenceToken: authority.submissionFenceToken,
      expectedAiPolicyHash: prepared.resolution.policyHash,
      expectedNpcResolutionHash: prepared.resolution.resolutionHash,
    },
  };
}

function assertNpcCommandBindingV1(
  prepared: PreparedNpcDecisionResolutionV1,
  command: AppendPreparedAutomationActionCommandV1["command"],
): void {
  const payload = command.action.payload as Record<string, unknown>;
  if (
    command.action.seatId !== prepared.seatId
    || command.action.actionType !== prepared.resolution.actionType
    || payload.source !== "IDENTITY_NPC_DECISION_POLICY"
    || payload.policyRef !== prepared.resolution.policyRef
    || payload.policyVersion !== prepared.resolution.policyVersion
    || payload.policyHash !== prepared.resolution.policyHash
    || payload.identityPolicyRef !== prepared.resolution.identityPolicyRef
    || payload.identityPolicyVersion !== prepared.resolution.identityPolicyVersion
    || payload.identityPolicyHash !== prepared.resolution.identityPolicyHash
    || payload.identityPolicyArtifactSha256
      !== prepared.resolution.identityPolicyArtifactSha256
    || payload.inputHash !== prepared.input.inputHash
    || payload.resolutionHash !== prepared.resolution.resolutionHash
    || payload.providerCallCount !== 0
  ) mismatch(ERROR.COMPILER_INVALID, "compiler.npcCommand", "FINAL_MB_BINDING_MISMATCH");
}

function findExactAcceptedPreparedActionV1(
  projection: WorkingLedgerProjectionV1,
  item: AppendPreparedAutomationActionCommandV1,
): boolean {
  const action = validateDecisionActionV1(item.command.action);
  const byAction = projection.acceptedActions.get(action.actionId);
  const byKey = projection.actionsByIdempotencyKey.get(action.idempotencyKey);
  if (!byAction && !byKey) return false;
  if (
    !byAction
    || !byKey
    || byAction.eventHash !== byKey.eventHash
    || byAction.action.sealedHash !== action.sealedHash
    || byAction.inputFingerprint !== item.command.inputFingerprint
    || sha256Canonical(byAction.action) !== sha256Canonical(action)
    || sha256Canonical(byAction.intent) !== sha256Canonical(item.command.intent)
  ) mismatch(ERROR.AUTHORITY_MISMATCH, "preparedAction.replay", "IDEMPOTENCY_MISMATCH");
  return true;
}

function assertMcBeatSubmitPlanV1(
  raw: ResolvedBeatSubmitAuthorityV1,
  viewerSeatId: SeatIdV1,
): void {
  const authority = validateResolvedBeatSubmitAuthorityV1(raw);
  const plan = authority.plan;
  if (
    plan.viewerSeatId !== viewerSeatId
    || plan.humanSubmissionSeatIds.length !== 1
    || plan.humanSubmissionSeatIds[0] !== viewerSeatId
    || new Set(plan.npcResolutionSeatIds).size !== plan.npcResolutionSeatIds.length
    || plan.npcResolutionSeatIds.includes(viewerSeatId)
  ) mismatch(ERROR.AUTHORITY_MISMATCH, "beatSubmit.plan", "PARTICIPANT_BINDING_MISMATCH");
  if (plan.mode === "INTERMEDIATE_ACTION_ONLY") {
    if (
      plan.npcResolutionSeatIds.length !== 0
      || plan.invokeSettlement
      || authority.input.beat.closesChapter
    ) mismatch(ERROR.AUTHORITY_MISMATCH, "beatSubmit.plan", "INTERMEDIATE_BINDING_MISMATCH");
    return;
  }
  if (
    plan.mode !== "CHAPTER_COUNCIL_COMMIT"
    || !plan.invokeSettlement
    || !authority.input.beat.closesChapter
  ) mismatch(ERROR.AUTHORITY_MISMATCH, "beatSubmit.plan", "FINAL_BINDING_MISMATCH");
}

function assertMcProgressionV1(
  beatSubmit: ResolvedBeatSubmitAuthorityV1,
  progression: ReturnType<typeof planBeatProgressionV1>,
): void {
  if (beatSubmit.plan.mode === "INTERMEDIATE_ACTION_ONLY") {
    if (
      progression.settlementInput !== null
      || progression.nextState.phase !== "ACTIVE"
    ) mismatch(ERROR.AUTHORITY_MISMATCH, "beatProgression", "INTERMEDIATE_SETTLEMENT_FORBIDDEN");
    return;
  }
  if (
    progression.settlementInput === null
    || progression.nextState.phase !== "SETTLING"
  ) mismatch(ERROR.AUTHORITY_MISMATCH, "beatProgression", "FINAL_SETTLEMENT_REQUIRED");
}

function projectionMatchesChapter(
  projection: WorkingLedgerProjectionV1 | null,
  chapter: ChapterOrchestratorStateV1,
): projection is WorkingLedgerProjectionV1 {
  return Boolean(
    projection
    && projection.key.runId === chapter.runId
    && projection.key.chapterRuntimeId === chapter.chapterRuntimeId
    && projection.chapterId === chapter.currentChapterId
    && projection.routeHash === chapter.routeHash
    && projection.state.revision >= 0
    && projection.stateHash === workingStateHash(projection.state)
    && (
      chapter.activeDecision === null
      || projection.nextDecisionPin?.decisionPointId
        === chapter.activeDecision.decisionPointId
    ),
  );
}

function validateConvergenceCommand(
  value: Readonly<DecisionConvergenceCommandV1>,
): DecisionConvergenceCommandV1 {
  if (value.trigger !== "HTTP_POST_SUBMIT" && value.trigger !== "RECOVERY") {
    mismatch(ERROR.CLAIM_INVALID, "convergence.trigger", "KNOWN_TRIGGER_REQUIRED");
  }
  text(value.runId, "convergence.runId", ERROR.CLAIM_INVALID);
  if (!isSha256(value.expectedRouteHash)) {
    mismatch(ERROR.CLAIM_INVALID, "convergence.expectedRouteHash", "SHA256");
  }
  nonNegative(value.nowMs, "convergence.nowMs", ERROR.CLAIM_INVALID);
  if (!Number.isFinite(value.humanSubmitMs) || value.humanSubmitMs < 0) {
    mismatch(ERROR.CLAIM_INVALID, "convergence.humanSubmitMs", "NON_NEGATIVE_NUMBER");
  }
  if (value.source) {
    text(value.source.chapterRuntimeId, "convergence.source.chapterRuntimeId", ERROR.CLAIM_INVALID);
    text(value.source.decisionPointId, "convergence.source.decisionPointId", ERROR.CLAIM_INVALID);
  }
  if (value.trigger === "RECOVERY" && value.humanAction !== null) {
    mismatch(ERROR.CLAIM_INVALID, "convergence.humanAction", "RECOVERY_MUST_BE_NULL");
  }
  if (value.trigger === "RECOVERY" && value.authoritySnapshot) {
    mismatch(ERROR.CLAIM_INVALID, "convergence.authoritySnapshot", "RECOVERY_MUST_READ_CURRENT");
  }
  return structuredClone(value);
}

function createMetrics(command: DecisionConvergenceCommandV1): DecisionConvergenceDiagnosticsV1 {
  const timings: DecisionConvergenceStageTimingsV1 = {
    humanSubmitMs: command.humanSubmitMs,
    snapshotMs: 0,
    compileAllMs: 0,
    ledgerAppendTotalMs: 0,
    ledgerAppendEachMs: [],
    orchestratorReconcileMs: 0,
    orchestratorTotalMs: 0,
    beatMs: 0,
    settlementMs: 0,
    nextOpenMs: 0,
    projectionMs: 0,
    endToEndMs: 0,
  };
  return {
    schemaVersion: "pressure_decision_convergence_diagnostics_v1",
    batchId: `decision_batch_${sha256Canonical({
      schemaVersion: "pressure_decision_convergence_batch_identity_v1",
      trigger: command.trigger,
      runId: command.runId,
      expectedRouteHash: command.expectedRouteHash,
      source: command.source,
      nowMs: command.nowMs,
    }).slice(0, 32)}`,
    trigger: command.trigger,
    runId: command.runId,
    chapterRuntimeId: null,
    chapterId: null,
    decisionPointId: null,
    outcome: "STALE_SKIPPED",
    pendingHumanCount: 0,
    pendingAiCount: 0,
    snapshotReadCount: 0,
    policyCallCount: 0,
    compileCount: 0,
    npcWriteCount: 0,
    appendTxCount: 0,
    replayCount: 0,
    headConflictCount: 0,
    w4ConflictCount: 0,
    staleRouteCount: 0,
    staleRevisionCount: 0,
    staleEpochCount: 0,
    staleFenceCount: 0,
    stalePolicyCount: 0,
    resumeCount: 0,
    fastSettlementResumeCalls: 0,
    providerCallCount: 0,
    timings,
  };
}

function bindMetricsToSnapshot(
  metrics: DecisionConvergenceDiagnosticsV1,
  snapshot: DecisionConvergenceAuthoritySnapshotV1,
): void {
  metrics.chapterRuntimeId = snapshot.chapter.chapterRuntimeId;
  metrics.chapterId = snapshot.chapter.currentChapterId;
  metrics.decisionPointId = snapshot.chapter.activeDecision?.decisionPointId ?? null;
}

export function validateDecisionConvergenceSnapshotV1(
  raw: DecisionConvergenceAuthoritySnapshotV1,
  runId: string,
  routeHash: string,
  aiPolicyArtifactHash: string,
): DecisionConvergenceAuthoritySnapshotV1 {
  const route = validateRunRouteSnapshotV1(raw.routeSnapshot);
  const chapter = validateOrchestratorStateV1(raw.chapter);
  const seatAuthority = validateSeatSnapshot(raw.seatAuthority, runId, routeHash);
  const projection = raw.projection;
  if (
    raw.schemaVersion !== "pressure_decision_convergence_authority_snapshot_v1"
    || route.runId !== runId
    || route.routeHash !== routeHash
    || chapter.runId !== runId
    || chapter.routeHash !== routeHash
    || projection.key.runId !== runId
    || projection.key.chapterRuntimeId !== chapter.chapterRuntimeId
    || projection.routeHash !== routeHash
    || projection.chapterId !== chapter.currentChapterId
    || projection.stateHash !== workingStateHash(projection.state)
    || projection.state.revision < 0
    || raw.aiPolicyArtifactHash !== aiPolicyArtifactHash
    || !isSha256(raw.snapshotHash)
  ) {
    mismatch(ERROR.AUTHORITY_MISMATCH, "snapshot", "INVALID_BINDING");
  }
  if (
    chapter.phase === "ACTIVE"
    && chapter.activeDecision
    && projection.nextDecisionPin?.decisionPointId !== chapter.activeDecision.decisionPointId
  ) {
    mismatch(ERROR.AUTHORITY_MISMATCH, "snapshot.decisionPin", "MISMATCH");
  }
  const expected = withDecisionConvergenceSnapshotHashV1({
    schemaVersion: raw.schemaVersion,
    routeSnapshot: route,
    chapter,
    projection,
    seatAuthority,
    aiPolicyArtifactHash,
    capturedAtMs: raw.capturedAtMs,
  });
  if (expected.snapshotHash !== raw.snapshotHash) {
    mismatch(ERROR.AUTHORITY_MISMATCH, "snapshot.snapshotHash", "SELF_HASH_MISMATCH");
  }
  return expected;
}

export function classifyPendingDecisionSeatsV1(snapshot: DecisionConvergenceAuthoritySnapshotV1) {
  const active = snapshot.chapter.activeDecision;
  if (!active) return { humans: [], ai: [] };
  const routeOrder = new Map(
    snapshot.routeSnapshot.seatIds.map((seatId, index) => [seatId, index]),
  );
  const humans: Array<{ seat: typeof active.seats[number]; authority: SeatAuthorityRecordV1 }> = [];
  const ai: Array<{ seat: typeof active.seats[number]; authority: SeatAuthorityRecordV1 }> = [];
  for (const seat of active.seats) {
    const authority = snapshot.seatAuthority.seatControls.find(
      (candidate) => candidate.seatId === seat.seatId,
    );
    if (!authority) mismatch(ERROR.AUTHORITY_MISMATCH, "seatAuthority", `MISSING:${seat.seatId}`);
    if (seat.requirement !== "REQUIRED" || seat.completion !== "PENDING") continue;
    if (authority.mode === "HUMAN_ACTIVE") {
      humans.push({ seat, authority });
      continue;
    }
    if (
      authority.mode !== "AI_ACTIVE"
      || authority.activeControllerId !== authority.designatedAiControllerId
    ) {
      mismatch(ERROR.AUTHORITY_MISMATCH, "seatAuthority", `INVALID_AI:${seat.seatId}`);
    }
    ai.push({ seat, authority });
  }
  const compare = (
    left: { seat: { seatId: SeatIdV1 } },
    right: { seat: { seatId: SeatIdV1 } },
  ) => (routeOrder.get(left.seat.seatId) ?? Number.MAX_SAFE_INTEGER)
    - (routeOrder.get(right.seat.seatId) ?? Number.MAX_SAFE_INTEGER)
    || compareCanonicalText(left.seat.seatId, right.seat.seatId);
  humans.sort(compare);
  ai.sort(compare);
  return { humans, ai };
}

export function assertCompiledAiDecisionCommandV1(
  snapshot: DecisionConvergenceAuthoritySnapshotV1,
  authority: SeatAuthorityRecordV1,
  selection: AiDecisionPolicySelectionV1,
  command: AppendPreparedAutomationActionCommandV1["command"],
): void {
  const route = snapshot.routeSnapshot;
  const chapter = snapshot.chapter;
  const active = chapter.activeDecision!;
  const payload = command.action.payload as Partial<AiDecisionAutomationPayloadV1>;
  if (
    command.routeSnapshot.routeHash !== route.routeHash
    || command.subjectId !== authority.activeControllerId
    || command.action.runId !== route.runId
    || command.action.chapterRuntimeId !== chapter.chapterRuntimeId
    || command.action.chapterId !== chapter.currentChapterId
    || command.action.decisionPointId !== active.decisionPointId
    || command.action.seatId !== authority.seatId
    || command.action.controlEpoch !== authority.controlEpoch
    || command.action.expectedWorkingRevision !== snapshot.projection.state.revision
    || command.action.actionType !== selection.actionType
    || payload.source !== "CONTENT_OWNED_AI_POLICY"
    || payload.policyHash !== selection.policyHash
    || payload.selectionHash !== selection.selectionHash
  ) {
    mismatch(ERROR.COMPILER_INVALID, "compiler.command", "AUTHORITY_BINDING_MISMATCH");
  }
}

export function prepareDecisionHumanActionV1(
  snapshot: DecisionConvergenceAuthoritySnapshotV1,
  pendingHumans: ReadonlyArray<{
    seat: NonNullable<ChapterOrchestratorStateV1["activeDecision"]>["seats"][number];
    authority: SeatAuthorityRecordV1;
  }>,
  raw: NonNullable<DecisionConvergenceCommandV1["humanAction"]>,
): AppendPreparedAutomationActionCommandV1 | null {
  const command = structuredClone(raw);
  const action = validateDecisionActionV1(command.action);
  const route = snapshot.routeSnapshot;
  const chapter = snapshot.chapter;
  const active = chapter.activeDecision;
  if (!active) {
    mismatch(ERROR.AUTHORITY_MISMATCH, "humanAction", "NO_ACTIVE_DECISION");
  }
  const prior = snapshot.projection.acceptedActions.get(action.actionId)
    ?? snapshot.projection.actionsByIdempotencyKey.get(action.idempotencyKey);
  if (prior) {
    if (
      prior.action.actionId !== action.actionId
      || prior.inputFingerprint !== command.inputFingerprint
      || prior.action.sealedHash !== action.sealedHash
    ) mismatch(ERROR.AUTHORITY_MISMATCH, "humanAction", "IDEMPOTENCY_MISMATCH");
    return null;
  }
  const pending = pendingHumans.find((item) => item.seat.seatId === action.seatId);
  if (
    !pending
    || pending.authority.mode !== "HUMAN_ACTIVE"
    || pending.authority.activeControllerId !== command.subjectId
    || command.routeSnapshot.routeHash !== route.routeHash
    || action.runId !== route.runId
    || action.chapterRuntimeId !== chapter.chapterRuntimeId
    || action.chapterId !== chapter.currentChapterId
    || action.decisionPointId !== active.decisionPointId
    || action.controlEpoch !== pending.authority.controlEpoch
    || action.expectedWorkingRevision !== snapshot.projection.state.revision
  ) mismatch(ERROR.AUTHORITY_MISMATCH, "humanAction", "AUTHORITY_BINDING_MISMATCH");
  return {
    command,
    authority: {
      actorKind: "HUMAN",
      snapshotHash: snapshot.snapshotHash,
      expectedOrchestratorRevision: chapter.revision,
      expectedOrchestratorHash: chapter.orchestratorHash,
      expectedDescriptorHash: chapter.descriptorHash,
      expectedDecisionPolicyHash: active.policyHash,
      expectedWorkingRevision: snapshot.projection.state.revision,
      expectedWorkingStateHash: snapshot.projection.stateHash,
      expectedLedgerHeadHash: snapshot.projection.headHash,
      expectedSeatAuthorityStateHash: snapshot.seatAuthority.stateHash,
      expectedControllerId: pending.authority.activeControllerId,
      expectedControlEpoch: pending.authority.controlEpoch,
      expectedSubmissionFenceToken: pending.authority.submissionFenceToken,
      expectedAiPolicyHash: null,
    },
  };
}

function cloneWorkingProjectionV1(
  projection: WorkingLedgerProjectionV1,
): WorkingLedgerProjectionV1 {
  return structuredClone(projection);
}

function validateSeatSnapshot(
  snapshot: SeatControlSnapshotV1,
  runId: string,
  routeHash: string,
): SeatControlSnapshotV1 {
  if (
    snapshot?.schemaVersion !== "pressure_seat_control_snapshot_v1"
    || snapshot.runId !== runId
    || snapshot.routeHash !== routeHash
    || !isSha256(snapshot.stateHash)
    || !Array.isArray(snapshot.seatControls)
  ) {
    mismatch(ERROR.AUTHORITY_MISMATCH, "seatAuthority.snapshot", "INVALID_BINDING");
  }
  const { stateHash, ...body } = snapshot;
  if (sha256Canonical(body) !== stateHash) {
    mismatch(ERROR.AUTHORITY_MISMATCH, "seatAuthority.stateHash", "SELF_HASH_MISMATCH");
  }
  const seen = new Set<string>();
  for (const seat of snapshot.seatControls) {
    if (seen.has(seat.seatId)) {
      mismatch(ERROR.AUTHORITY_MISMATCH, "seatAuthority.seatId", "DUPLICATE");
    }
    seen.add(seat.seatId);
    validateSeatAuthority(seat);
  }
  return structuredClone(snapshot);
}

function validateSeatAuthority(seat: SeatAuthorityRecordV1): void {
  if (
    !seat.activeControllerId?.trim()
    || !seat.designatedAiControllerId?.trim()
    || !Number.isSafeInteger(seat.controlEpoch)
    || seat.controlEpoch < 1
    || !isSha256(seat.submissionFenceToken)
    || (seat.mode === "AI_ACTIVE" && seat.activeControllerId !== seat.designatedAiControllerId)
  ) {
    mismatch(ERROR.AUTHORITY_MISMATCH, "seatAuthority.seat", "INVALID_CONTROL_RECORD");
  }
}

export function validateAiDecisionPolicySelectionV1(
  selection: AiDecisionPolicySelectionV1,
  input: AiDecisionPolicyInputV1,
  contentPackageVersion: string,
  contentPackageSha256: string,
  expectedPolicyHash: string,
): AiDecisionPolicySelectionV1 {
  if (
    selection?.schemaVersion !== "sangtian_ai_decision_policy_selection_v1"
    || !selection.policyRef?.trim()
    || !selection.policyVersion?.trim()
    || selection.policyHash !== expectedPolicyHash
    || selection.resolvedContentPackageVersion !== contentPackageVersion
    || selection.resolvedContentPackageSha256 !== contentPackageSha256
    || selection.inputHash !== input.inputHash
    || !selection.actionType?.trim()
    || !isSha256(selection.selectionHash)
  ) {
    mismatch(ERROR.POLICY_INVALID, "policy.selection", "INVALID_OR_UNPINNED");
  }
  const { selectionHash, ...body } = selection;
  if (sha256Canonical(body) !== selectionHash) {
    mismatch(ERROR.POLICY_INVALID, "policy.selectionHash", "SELF_HASH_MISMATCH");
  }
  if (!input.eligibleActionTypes.includes(selection.actionType)) {
    mismatch(ERROR.POLICY_INVALID, "policy.actionType", "NOT_ELIGIBLE");
  }
  const nonDefault = input.eligibleActionTypes.filter(
    (actionType) => actionType !== "DEFAULT_PASS",
  );
  if (nonDefault.length > 0 && selection.actionType === "DEFAULT_PASS") {
    mismatch(ERROR.POLICY_INVALID, "policy.actionType", "NON_DEFAULT_REQUIRED");
  }
  return structuredClone(selection);
}

function validateRuntimeState(
  raw: Parameters<typeof validateOrchestratorStateV1>[0],
  runId: string,
  routeHash: string,
) {
  const state = validateOrchestratorStateV1(raw);
  if (state.runId !== runId || state.routeHash !== routeHash) {
    mismatch(ERROR.PORT_RESULT_INVALID, "runtime.state", "ROUTE_BINDING_MISMATCH");
  }
  return state;
}

function validateScannedTasks(scanned: DecisionAutomationTaskV1[]): DecisionAutomationTaskV1[] {
  if (!Array.isArray(scanned)) {
    mismatch(ERROR.CLAIM_INVALID, "scanner.tasks", "ARRAY_REQUIRED");
  }
  const tasks = scanned.map((task) => {
    validateTask(task);
    return structuredClone(task);
  });
  const sorted = [...tasks].sort(compareTasks);
  if (tasks.some((task, index) => task.taskHash !== sorted[index]?.taskHash)) {
    mismatch(ERROR.CLAIM_INVALID, "scanner.tasks", "CANONICAL_ORDER_REQUIRED");
  }
  if (new Set(tasks.map((task) => task.taskHash)).size !== tasks.length) {
    mismatch(ERROR.CLAIM_INVALID, "scanner.tasks", "DUPLICATE_TASK");
  }
  return tasks;
}

function validateTask(task: DecisionAutomationTaskV1): void {
  if (task?.schemaVersion !== "pressure_decision_automation_task_v1") {
    mismatch(ERROR.CLAIM_INVALID, "claim.task.schemaVersion", "UNSUPPORTED");
  }
  text(task.runId, "claim.task.runId", ERROR.CLAIM_INVALID);
  if (!isSha256(task.routeHash)) mismatch(ERROR.CLAIM_INVALID, "claim.task.routeHash", "SHA256");
  text(task.chapterRuntimeId, "claim.task.chapterRuntimeId", ERROR.CLAIM_INVALID);
  text(task.decisionPointId, "claim.task.decisionPointId", ERROR.CLAIM_INVALID);
  nonNegative(task.expectedOrchestratorRevision, "claim.task.expectedOrchestratorRevision", ERROR.CLAIM_INVALID);
  nonNegative(task.expectedWorkingRevision, "claim.task.expectedWorkingRevision", ERROR.CLAIM_INVALID);
  positive(task.expectedControlEpoch, "claim.task.expectedControlEpoch", ERROR.CLAIM_INVALID);
  if (
    task.expectedControllerMode !== "HUMAN_ACTIVE"
    && task.expectedControllerMode !== "AI_ACTIVE"
  ) {
    mismatch(ERROR.CLAIM_INVALID, "claim.task.expectedControllerMode", "KNOWN_MODE_REQUIRED");
  }
  if (
    task.expectedDeadlineAtMs !== null
    && (!Number.isSafeInteger(task.expectedDeadlineAtMs) || task.expectedDeadlineAtMs < 0)
  ) {
    mismatch(ERROR.CLAIM_INVALID, "claim.task.expectedDeadlineAtMs", "NON_NEGATIVE_OR_NULL");
  }
  if (!isSha256(task.expectedSeatAuthorityStateHash) || !isSha256(task.taskHash)) {
    mismatch(ERROR.CLAIM_INVALID, "claim.task.hash", "SHA256");
  }
  const { taskHash, ...body } = task;
  if (sha256Canonical(body) !== taskHash) {
    mismatch(ERROR.CLAIM_INVALID, "claim.task.taskHash", "SELF_HASH_MISMATCH");
  }
}

function assertDecisionTaskGroup(
  tasks: DecisionAutomationTaskV1[],
  first: DecisionAutomationTaskV1,
): void {
  if (!tasks.length) mismatch(ERROR.CLAIM_INVALID, "scanner.group", "NON_EMPTY");
  for (const task of tasks) {
    if (
      task.routeHash !== first.routeHash
      || task.expectedOrchestratorRevision !== first.expectedOrchestratorRevision
      || task.expectedWorkingRevision !== first.expectedWorkingRevision
      || task.expectedDeadlineAtMs !== first.expectedDeadlineAtMs
      || task.expectedSeatAuthorityStateHash !== first.expectedSeatAuthorityStateHash
    ) {
      mismatch(ERROR.CLAIM_INVALID, "scanner.group", "INCOHERENT_DECISION_DISCOVERY");
    }
  }
}

function sameDecision(left: DecisionAutomationTaskV1, right: DecisionAutomationTaskV1): boolean {
  return left.runId === right.runId
    && left.chapterRuntimeId === right.chapterRuntimeId
    && left.decisionPointId === right.decisionPointId;
}

function compareTasks(left: DecisionAutomationTaskV1, right: DecisionAutomationTaskV1): number {
  return Number(left.expectedControllerMode === "HUMAN_ACTIVE")
    - Number(right.expectedControllerMode === "HUMAN_ACTIVE")
    || deadlineSortValue(left.expectedDeadlineAtMs) - deadlineSortValue(right.expectedDeadlineAtMs)
    || compareCanonicalText(left.runId, right.runId)
    || Number(left.chapterId.slice(1)) - Number(right.chapterId.slice(1))
    || compareCanonicalText(left.decisionPointId, right.decisionPointId)
    || compareCanonicalText(left.seatId, right.seatId);
}

function compareTasksForProcessing(
  left: DecisionAutomationTaskV1,
  right: DecisionAutomationTaskV1,
  nowMs: number,
): number {
  const leftExpired = left.expectedDeadlineAtMs !== null && nowMs >= left.expectedDeadlineAtMs;
  const rightExpired = right.expectedDeadlineAtMs !== null && nowMs >= right.expectedDeadlineAtMs;
  if (leftExpired !== rightExpired) return Number(rightExpired) - Number(leftExpired);
  return compareTasks(left, right);
}

function deadlineSortValue(value: number | null): number {
  return value ?? Number.MAX_SAFE_INTEGER;
}

function countStale(
  metrics: DecisionConvergenceDiagnosticsV1,
  reason: PreparedAutomationActionStaleReasonV1 | null,
): void {
  switch (reason) {
    case "ROUTE":
      metrics.staleRouteCount += 1;
      return;
    case "ORCHESTRATOR_REVISION":
    case "ORCHESTRATOR_HASH":
    case "CHAPTER_OR_DECISION":
    case "DESCRIPTOR":
    case "DECISION_POLICY":
    case "WORKING_REVISION":
    case "WORKING_STATE":
    case "DEADLINE":
      metrics.staleRevisionCount += 1;
      return;
    case "SEAT_EPOCH":
      metrics.staleEpochCount += 1;
      return;
    case "SEAT_FENCE":
    case "SEAT_AUTHORITY":
    case "SEAT_CONTROLLER":
      metrics.staleFenceCount += 1;
      return;
    case "AI_POLICY":
      metrics.stalePolicyCount += 1;
      return;
    default:
      metrics.staleRevisionCount += 1;
  }
}

function canonicalStrings(values: string[]): string[] {
  return [...new Set(values)].sort(compareCanonicalText);
}

function elapsed(startedAt: number): number {
  return Math.max(0, performance.now() - startedAt);
}

function nonNegativeNumber(value: number): number {
  return Number.isFinite(value) && value >= 0 ? value : 0;
}

function readErrorCode(error: unknown): string {
  if (error instanceof DecisionAutomationError) return error.code;
  if (error && typeof error === "object" && "code" in error) {
    const code = String((error as { code?: unknown }).code ?? "").trim();
    if (code) return code;
  }
  return "PRESSURE_DECISION_AUTOMATION_UNCLASSIFIED_FAILURE";
}

function logDecisionRetry(
  error: unknown,
  errorCode: string,
  task: DecisionAutomationTaskV1 | null,
): void {
  if (process.env.PRESSURE_CHAPTER_DIAGNOSTIC_ERRORS !== "1") return;
  console.error("Pressure decision convergence retry", {
    errorCode,
    runId: task?.runId ?? null,
    chapterRuntimeId: task?.chapterRuntimeId ?? null,
    decisionPointId: task?.decisionPointId ?? null,
    message: error instanceof Error
      ? error.message.replace(/[\r\n]+/g, " ").slice(0, 1_000)
      : "UNKNOWN",
  });
}

function mismatch(
  code: Parameters<typeof failDecisionAutomation>[0],
  path: string,
  detail: string,
): never {
  return failDecisionAutomation(code, `Decision convergence validation failed at ${path}`, {
    path,
    detail,
  });
}

function text(
  value: unknown,
  path: string,
  code: Parameters<typeof failDecisionAutomation>[0],
): asserts value is string {
  if (typeof value !== "string" || !value.trim()) mismatch(code, path, "NON_EMPTY_STRING");
}

function positive(
  value: unknown,
  path: string,
  code: Parameters<typeof failDecisionAutomation>[0] = ERROR.INVALID_CONFIGURATION,
): asserts value is number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) mismatch(code, path, "POSITIVE_SAFE_INTEGER");
}

function nonNegative(
  value: unknown,
  path: string,
  code: Parameters<typeof failDecisionAutomation>[0],
): asserts value is number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) mismatch(code, path, "NON_NEGATIVE_SAFE_INTEGER");
}
