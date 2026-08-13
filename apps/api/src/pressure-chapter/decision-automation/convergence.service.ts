import { performance } from "node:perf_hooks";
import {
  compareCanonicalText,
  isSha256,
  sha256Canonical,
  validateRunRouteSnapshotV1,
  type SeatIdV1,
} from "@ai-story/shared";
import {
  runWithPressureDecisionConvergenceTimingV1,
} from "../observability/decision-convergence-timing";
import {
  validateAuthoredChapterRuntimeV1,
  validateOrchestratorStateV1,
} from "../orchestrator/validation";
import type {
  ChapterOrchestratorStateV1,
} from "../orchestrator/contracts";
import type {
  SeatAuthorityRecordV1,
  SeatControlSnapshotV1,
} from "../seat-control/types";
import { workingStateHash } from "../working-ledger/working-ledger";
import {
  DECISION_AUTOMATION_ERROR_CODES as ERROR,
  DecisionAutomationError,
  failDecisionAutomation,
} from "./errors";
import { buildAiDecisionPolicyInputV1 } from "./service";
import type {
  AiDecisionAutomationPayloadV1,
  AppendPreparedAutomationActionCommandV1,
  AiDecisionPolicyInputV1,
  AiDecisionPolicySelectionV1,
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
import { createPreparedAutomationActionBatchV1 } from "./prepared-action-batch";

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
    const snapshotRaw = await this.ports.snapshots.capture({
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
    const snapshot = validateSnapshot(
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

    const classified = classifyPendingSeats(snapshot);
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

    if (classified.humans.length > 0) {
      // Frozen product rule: ordinary AI work never runs ahead of a required human.
      return this.finish(command, metrics, "WAITING_FOR_HUMANS", [], chapter, endToEndStartedAt);
    }

    if (classified.ai.length === 0) {
      const allRequiredComplete = active.seats
        .filter((seat) => seat.requirement === "REQUIRED")
        .every((seat) => seat.completion !== "PENDING");
      if (!allRequiredComplete) {
        return this.finish(command, metrics, "NO_PENDING_AI", [], chapter, endToEndStartedAt);
      }
      const resumed = await this.resumeOnce(snapshot, metrics, command.nowMs);
      return this.finish(command, metrics, "NO_PENDING_AI", [], resumed, endToEndStartedAt);
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

    const compileStartedAt = performance.now();
    const actionIds: string[] = [];
    const prepared: AppendPreparedAutomationActionCommandV1[] = [];
    for (const item of classified.ai) {
      if (decision.seatRequirements[item.seat.seatId] !== "REQUIRED") {
        mismatch(ERROR.CONTENT_MISMATCH, "content.seatRequirement", item.seat.seatId);
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
      let selection: AiDecisionPolicySelectionV1;
      let compiled: ReturnType<DecisionConvergenceDependenciesV1["compiler"]["compile"]>;
      try {
        metrics.policyCallCount += 1;
        selection = validateSelection(
          await this.ports.policy.select(policyInput),
          policyInput,
          route.contentPackageVersion,
          route.contentPackageSha256,
          this.ports.policy.artifactSha256,
        );
        metrics.compileCount += 1;
        compiled = this.ports.compiler.compile({
          routeSnapshot: route,
          chapter,
          projection: snapshot.projection,
          seatAuthority: {
            seatId: item.authority.seatId,
            activeControllerId: item.authority.activeControllerId,
            controlEpoch: item.authority.controlEpoch,
            submissionFenceToken: item.authority.submissionFenceToken,
          },
          selection,
          nowMs: command.nowMs,
        });
      } catch (error) {
        metrics.timings.compileAllMs = elapsed(compileStartedAt);
        // Deterministic policy/compiler execution has no transient Provider
        // failure mode. Any exception is an integrity failure and must stop
        // before the first W5 write; it must never be hidden by a default.
        if (error instanceof DecisionAutomationError) throw error;
        const code = readErrorCode(error);
        const policyFailure = /POLICY|AI_DECISION|CONTENT_PACKAGE|CONTENT_BINDING/i.test(code);
        mismatch(
          policyFailure ? ERROR.POLICY_INVALID : ERROR.COMPILER_INVALID,
          policyFailure ? "policy.select" : "compiler.compile",
          code,
        );
      }
      if (compiled.kind === "ALREADY_ACCEPTED") {
        actionIds.push(compiled.actionId);
        metrics.replayCount += 1;
        continue;
      }
      assertCompiledCommand(snapshot, item.authority, selection, compiled.command);
      prepared.push({
        command: compiled.command,
        authority: {
          snapshotHash: snapshot.snapshotHash,
          expectedOrchestratorRevision: chapter.revision,
          expectedOrchestratorHash: chapter.orchestratorHash,
          expectedDescriptorHash: chapter.descriptorHash,
          expectedDecisionPolicyHash: active.policyHash,
          expectedWorkingRevision: snapshot.projection.state.revision,
          expectedWorkingStateHash: snapshot.projection.stateHash,
          expectedLedgerHeadHash: snapshot.projection.headHash,
          expectedSeatAuthorityStateHash: snapshot.seatAuthority.stateHash,
          expectedControllerId: item.authority.activeControllerId,
          expectedControlEpoch: item.authority.controlEpoch,
          expectedSubmissionFenceToken: item.authority.submissionFenceToken,
          expectedAiPolicyHash: selection.policyHash,
        },
      });
    }
    metrics.timings.compileAllMs = elapsed(compileStartedAt);

    let complete = true;
    let batchConflict = false;
    const appendStartedAt = performance.now();
    if (this.ports.preparedActions.submitPreparedBatch) {
      const batch = createPreparedAutomationActionBatchV1({
        batchId: metrics.batchId,
        snapshotHash: snapshot.snapshotHash,
        routeSnapshot: snapshot.routeSnapshot,
        chapterRuntimeId: chapter.chapterRuntimeId,
        chapterId: chapter.currentChapterId,
        decisionPointId: active.decisionPointId,
        expectedOrchestratorRevision: chapter.revision,
        expectedOrchestratorHash: chapter.orchestratorHash,
        expectedWorkingRevision: snapshot.projection.state.revision,
        expectedWorkingStateHash: snapshot.projection.stateHash,
        expectedLedgerHeadHash: snapshot.projection.headHash,
        expectedSeatAuthorityStateHash: snapshot.seatAuthority.stateHash,
        actions: prepared,
      });
      metrics.appendTxCount = 1;
      const result = await this.ports.preparedActions.submitPreparedBatch(batch);
      if (
        result.batchId !== batch.batchId
        || !isSha256(result.ledgerHeadHash)
        || result.actionIds.some((actionId) => !prepared.some((item) => item.command.action.actionId === actionId))
      ) mismatch(ERROR.PORT_RESULT_INVALID, "preparedBatch.result", "INVALID_BINDING");
      actionIds.push(...result.actionIds);
      metrics.replayCount += result.replayedActionIds.length;
      if (result.status === "CONFLICT") {
        complete = false;
        batchConflict = true;
        if (result.conflictReason === "HEAD_CONFLICT") metrics.headConflictCount += 1;
      }
    } else {
      // Compatibility fallback for isolated legacy test doubles only. The
      // production Prisma adapter implements submitPreparedBatch.
      let expectedHead = snapshot.projection.headHash;
      for (const item of prepared) {
        const callStartedAt = performance.now();
        metrics.appendTxCount += 1;
        item.authority.expectedLedgerHeadHash = expectedHead;
        const result = await this.ports.preparedActions.submitPrepared(item);
        metrics.timings.ledgerAppendEachMs.push(elapsed(callStartedAt));
        if (result.actionId !== item.command.action.actionId || !isSha256(result.ledgerHeadHash)) {
          mismatch(ERROR.PORT_RESULT_INVALID, "preparedAppend.result", "INVALID_BINDING");
        }
        if (result.status === "APPENDED") {
          actionIds.push(result.actionId);
          expectedHead = result.ledgerHeadHash;
          continue;
        }
        if (result.status === "REPLAYED") {
          actionIds.push(result.actionId);
          metrics.replayCount += 1;
          expectedHead = result.ledgerHeadHash;
          continue;
        }
        complete = false;
        if (result.status === "HEAD_CONFLICT") {
          metrics.headConflictCount += 1;
        } else {
          countStale(metrics, result.staleReason);
        }
        break;
      }
    }
    metrics.timings.ledgerAppendTotalMs = elapsed(appendStartedAt);

    if (batchConflict) {
      return this.finish(
        command,
        metrics,
        "STALE_SKIPPED",
        [],
        chapter,
        endToEndStartedAt,
      );
    }

    const resumed = await this.resumeOnce(snapshot, metrics, command.nowMs);
    const outcome: DecisionAutomationOutcomeKindV1 = complete
      ? "BATCH_COMPLETED"
      : actionIds.length > 0
        ? "BATCH_PARTIAL"
        : "STALE_SKIPPED";
    return this.finish(
      command,
      metrics,
      outcome,
      canonicalStrings(actionIds),
      resumed,
      endToEndStartedAt,
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
  }

  private async resumeOnce(
    snapshot: DecisionConvergenceAuthoritySnapshotV1,
    metrics: DecisionConvergenceDiagnosticsV1,
    nowMs: number,
  ): Promise<ChapterOrchestratorStateV1> {
    if (metrics.resumeCount !== 0) {
      mismatch(ERROR.PORT_RESULT_INVALID, "runtime.resume", "AT_MOST_ONCE");
    }
    metrics.resumeCount = 1;
    const startedAt = performance.now();
    const state = await runWithPressureDecisionConvergenceTimingV1(
      metrics.timings,
      () => { metrics.w4ConflictCount += 1; },
      () => this.ports.runtime.resume(snapshot.routeSnapshot, nowMs),
    );
    metrics.timings.orchestratorTotalMs = elapsed(startedAt);
    return validateRuntimeState(
      state,
      snapshot.routeSnapshot.runId,
      snapshot.routeSnapshot.routeHash,
    );
  }

  private async finish(
    command: DecisionConvergenceCommandV1,
    metrics: DecisionConvergenceDiagnosticsV1,
    outcome: DecisionAutomationOutcomeKindV1,
    actionIds: string[],
    chapter: ChapterOrchestratorStateV1 | null,
    endToEndStartedAt: number,
  ): Promise<DecisionConvergenceResultV1> {
    metrics.outcome = outcome;
    metrics.timings.endToEndMs = elapsed(endToEndStartedAt);
    const result: DecisionConvergenceResultV1 = {
      schemaVersion: "pressure_decision_convergence_result_v1",
      batchId: metrics.batchId,
      outcome,
      actionIds: canonicalStrings(actionIds),
      chapter: chapter ? structuredClone(chapter) : null,
      metrics: structuredClone(metrics),
    };
    if (command.trigger === "RECOVERY") {
      await this.ports.diagnostics.record(result.metrics);
    }
    return result;
  }
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

function validateSnapshot(
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

function classifyPendingSeats(snapshot: DecisionConvergenceAuthoritySnapshotV1) {
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

function assertCompiledCommand(
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

function validateSelection(
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
