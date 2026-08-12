import {
  PRESSURE_CHAPTER_SEAT_IDS_V1,
  assertSangtianPressureRouteV1,
  compareCanonicalText,
  isSha256,
  sha256Canonical,
  validateRunRouteSnapshotV1,
  type SeatIdV1,
} from "@ai-story/shared";
import { validateAuthoredChapterRuntimeV1, validateOrchestratorStateV1 } from "../orchestrator/validation";
import type { SeatAuthorityRecordV1, SeatControlSnapshotV1 } from "../seat-control/types";
import { workingStateHash } from "../working-ledger/working-ledger";
import {
  DECISION_AUTOMATION_ERROR_CODES as ERROR,
  DecisionAutomationError,
  failDecisionAutomation,
} from "./errors";
import type {
  AiDecisionPolicyInputV1,
  AiDecisionPolicySelectionV1,
  DecisionAutomationConfigV1,
  DecisionAutomationDependenciesV1,
  DecisionAutomationDrainResultV1,
  DecisionAutomationOutcomeV1,
  DecisionAutomationStepResultV1,
  DecisionAutomationTaskV1,
} from "./contracts";

const DEFAULT_CONFIG: DecisionAutomationConfigV1 = Object.freeze({
  retryMs: 1_000,
});

export function withDecisionAutomationTaskHashV1(
  input: Omit<DecisionAutomationTaskV1, "taskHash">,
): DecisionAutomationTaskV1 {
  const body = structuredClone(input);
  return { ...body, taskHash: sha256Canonical(body) };
}

export function buildAiDecisionPolicyInputV1(
  input: Omit<AiDecisionPolicyInputV1, "schemaVersion" | "inputHash">,
): AiDecisionPolicyInputV1 {
  const body = {
    schemaVersion: "sangtian_ai_decision_policy_input_v1" as const,
    ...structuredClone(input),
    eligibleActionTypes: [...input.eligibleActionTypes].sort(compareCanonicalText),
  };
  return { ...body, inputHash: sha256Canonical(body) };
}

export function withAiDecisionPolicySelectionHashV1(
  input: Omit<AiDecisionPolicySelectionV1, "schemaVersion" | "selectionHash">,
): AiDecisionPolicySelectionV1 {
  const body = {
    schemaVersion: "sangtian_ai_decision_policy_selection_v1" as const,
    ...structuredClone(input),
  };
  return { ...body, selectionHash: sha256Canonical(body) };
}

export class PressureDecisionAutomationServiceV1 {
  private readonly config: DecisionAutomationConfigV1;

  constructor(
    private readonly ports: DecisionAutomationDependenciesV1,
    config: Partial<DecisionAutomationConfigV1> = {},
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    positive(this.config.retryMs, "config.retryMs");
  }

  /** Structurally compatible with PressureWorkerLanePortV1. */
  async tick(workerId: string): Promise<DecisionAutomationStepResultV1> {
    text(workerId, "workerId", ERROR.INVALID_CONFIGURATION);
    const nowMs = this.ports.clock.nowMs();
    nonNegative(nowMs, "clock.nowMs", ERROR.PORT_RESULT_INVALID);
    let task: DecisionAutomationTaskV1 | null = null;
    try {
      traceDecision("scan:start", null);
      const scanned = await this.ports.scanner.scanActive();
      traceDecision("scan:finish", null, { taskCount: scanned.length });
      const tasks = validateScannedTasks(scanned);
      if (!tasks.length) return { kind: "IDLE" };
      const processingOrder = [...tasks].sort((left, right) =>
        compareTasksForProcessing(left, right, nowMs));
      // Process at most one failed candidate per tick. A retry forces a fresh
      // scan on the next tick, so work created while this tick is running can
      // be prioritized instead of waiting behind an arbitrarily large stale
      // snapshot. Fresh AI work is sorted before deadline recovery below.
      for (const candidate of processingOrder) {
        task = candidate;
        try {
          traceDecision("task:start", task);
          const outcome = await this.process(task, nowMs);
          traceDecision("task:finish", task, { outcome: outcome.outcome });
          return {
            kind: "ACKNOWLEDGED",
            taskHash: task.taskHash,
            outcome: outcome.outcome,
            actionId: outcome.actionId,
          };
        } catch (error) {
          const errorCode = readErrorCode(error);
          logDecisionRetry(error, errorCode, task);
          return {
            kind: "RETRY_SCHEDULED",
            taskHash: task.taskHash,
            errorCode,
            retryAtMs: nowMs + this.config.retryMs,
          };
        }
      }
      return { kind: "IDLE" };
    } catch (error) {
      const errorCode = readErrorCode(error);
      logDecisionRetry(error, errorCode, task);
      const retryAtMs = nowMs + this.config.retryMs;
      return {
        kind: "RETRY_SCHEDULED",
        taskHash: task?.taskHash ?? sha256Canonical({ workerId, nowMs, errorCode }),
        errorCode,
        retryAtMs,
      };
    }
  }

  async drain(workerId: string, limit: number): Promise<DecisionAutomationDrainResultV1> {
    positive(limit, "limit");
    const results: DecisionAutomationStepResultV1[] = [];
    for (let index = 0; index < limit; index += 1) {
      const result = await this.tick(workerId);
      results.push(result);
      if (result.kind === "IDLE") return { results, stoppedBecause: "IDLE" };
      if (result.kind === "BUSY") return { results, stoppedBecause: "BUSY" };
    }
    return { results, stoppedBecause: "LIMIT" };
  }

  private async process(
    task: DecisionAutomationTaskV1,
    nowMs: number,
  ): Promise<DecisionAutomationOutcomeV1> {
    const routeRaw = await this.ports.routes.readRoute(task.runId);
    traceDecision("task:route", task);
    if (!routeRaw) mismatch(ERROR.ROUTE_MISMATCH, "route", "MISSING");
    const route = validateRunRouteSnapshotV1(routeRaw);
    assertSangtianPressureRouteV1(route.route);
    if (route.runId !== task.runId || route.routeHash !== task.routeHash) {
      mismatch(ERROR.ROUTE_MISMATCH, "route", "TASK_BINDING_MISMATCH");
    }
    const stateRaw = await this.ports.orchestrators.read(task.runId);
    traceDecision("task:orchestrator", task);
    if (!stateRaw) mismatch(ERROR.AUTHORITY_MISMATCH, "orchestrator", "MISSING");
    const state = validateOrchestratorStateV1(stateRaw);
    if (state.runId !== route.runId || state.routeHash !== route.routeHash) {
      mismatch(ERROR.AUTHORITY_MISMATCH, "orchestrator", "ROUTE_BINDING_MISMATCH");
    }
    if (
      state.phase !== "ACTIVE"
      || !state.activeDecision
      || state.revision !== task.expectedOrchestratorRevision
      || state.chapterRuntimeId !== task.chapterRuntimeId
      || state.currentChapterId !== task.chapterId
      || state.activeDecision.decisionPointId !== task.decisionPointId
      || state.activeDecision.deadlineAtMs !== task.expectedDeadlineAtMs
    ) {
      return outcome(task, "STALE_SKIPPED", null, null, nowMs);
    }
    const activeSeat = state.activeDecision.seats.find(
      (seat) => seat.seatId === task.seatId,
    );
    if (
      !activeSeat
      || activeSeat.requirement !== "REQUIRED"
      || activeSeat.completion !== "PENDING"
      || activeSeat.actionCount !== 0
      || activeSeat.actionIds.length !== 0
    ) {
      return outcome(task, "STALE_SKIPPED", null, state.orchestratorHash, nowMs);
    }
    if (
      state.activeDecision.deadlineAtMs !== null
      && nowMs >= state.activeDecision.deadlineAtMs
    ) {
      traceDecision("task:deadline:start", task);
      const handled = await this.ports.deadlineDefaults.advanceExpiredDecision({
        routeSnapshot: route,
        expected: expectedDecision(task),
        nowMs,
      });
      traceDecision("task:deadline:finish", task, { kind: handled.kind });
      const advanced = validateRuntimeState(
        handled.state,
        route.runId,
        route.routeHash,
      );
      return outcome(
        task,
        handled.kind === "APPLIED" ? "DEADLINE_ADVANCED" : "STALE_SKIPPED",
        null,
        advanced.orchestratorHash,
        nowMs,
      );
    }
    const projection = await this.ports.working.load({
      runId: route.runId,
      chapterRuntimeId: state.chapterRuntimeId,
    });
    if (
      projection.key.runId !== route.runId
      || projection.key.chapterRuntimeId !== state.chapterRuntimeId
      || projection.routeHash !== route.routeHash
      || projection.chapterId !== state.currentChapterId
      || projection.stateHash !== workingStateHash(projection.state)
      || projection.state.revision !== task.expectedWorkingRevision
      || projection.nextDecisionPin?.decisionPointId !== task.decisionPointId
    ) {
      return outcome(task, "STALE_SKIPPED", null, state.orchestratorHash, nowMs);
    }
    const seatSnapshotRaw = await this.ports.seats.readSnapshot(route.runId);
    if (!seatSnapshotRaw) mismatch(ERROR.AUTHORITY_MISMATCH, "seatAuthority", "MISSING");
    const seatSnapshot = validateSeatSnapshot(seatSnapshotRaw, route.runId, route.routeHash);
    const seatAuthority = seatSnapshot.seatControls.find(
      (seat) => seat.seatId === task.seatId,
    );
    if (!seatAuthority) mismatch(ERROR.AUTHORITY_MISMATCH, "seatAuthority", "SEAT_MISSING");
    if (
      seatSnapshot.stateHash !== task.expectedSeatAuthorityStateHash
      || seatAuthority.controlEpoch !== task.expectedControlEpoch
      || seatAuthority.mode !== task.expectedControllerMode
    ) {
      return outcome(task, "STALE_SKIPPED", null, state.orchestratorHash, nowMs);
    }
    if (
      seatAuthority.mode !== "AI_ACTIVE"
      || seatAuthority.activeControllerId !== seatAuthority.designatedAiControllerId
    ) {
      return outcome(task, "STALE_SKIPPED", null, state.orchestratorHash, nowMs);
    }
    const descriptor = validateAuthoredChapterRuntimeV1(await this.ports.content.load({
      routeSnapshot: route,
      chapterId: state.currentChapterId,
    }));
    if (descriptor.chapterId !== state.currentChapterId || descriptor.descriptorHash !== state.descriptorHash) {
      mismatch(ERROR.CONTENT_MISMATCH, "content", "DESCRIPTOR_BINDING_MISMATCH");
    }
    const decision = descriptor.decisions.find(
      (candidate) => candidate.decisionPointId === task.decisionPointId,
    );
    if (!decision || decision.seatRequirements[task.seatId] !== "REQUIRED") {
      mismatch(ERROR.CONTENT_MISMATCH, "content.decision", "SEAT_NOT_REQUIRED");
    }
    const eligibleActionTypes = [...new Set(decision.execution.allowedActionTypes)]
      .sort(compareCanonicalText);
    if (!eligibleActionTypes.length) {
      mismatch(ERROR.CONTENT_MISMATCH, "content.allowedActionTypes", "EMPTY");
    }
    const policyInput = buildAiDecisionPolicyInputV1({
      runId: route.runId,
      routeHash: route.routeHash,
      runSeed: route.runSeed,
      contentPackageVersion: route.contentPackageVersion,
      contentPackageSha256: route.contentPackageSha256,
      chapterRuntimeId: state.chapterRuntimeId,
      chapterId: state.currentChapterId,
      decisionPointId: task.decisionPointId,
      seatId: task.seatId,
      eligibleActionTypes,
    });
    let selection: AiDecisionPolicySelectionV1;
    let compiled: ReturnType<DecisionAutomationDependenciesV1["compiler"]["compile"]>;
    try {
      selection = validateSelection(
        await this.ports.policy.select(policyInput),
        policyInput,
        route.contentPackageVersion,
        route.contentPackageSha256,
      );
      compiled = this.ports.compiler.compile({
        routeSnapshot: route,
        chapter: state,
        projection,
        seatAuthority: {
          seatId: seatAuthority.seatId,
          activeControllerId: seatAuthority.activeControllerId,
          controlEpoch: seatAuthority.controlEpoch,
          submissionFenceToken: seatAuthority.submissionFenceToken,
        },
        selection,
        nowMs,
      });
    } catch (error) {
      const handled = await this.ports.deadlineDefaults.applyAiFailure({
        routeSnapshot: route,
        expected: expectedDecision(task),
        seatId: task.seatId,
        failureCode: readErrorCode(error),
        nowMs,
      });
      const defaulted = validateRuntimeState(
        handled.state,
        route.runId,
        route.routeHash,
      );
      return outcome(
        task,
        handled.kind === "APPLIED" ? "AI_FAILURE_DEFAULTED" : "STALE_SKIPPED",
        null,
        defaulted.orchestratorHash,
        nowMs,
      );
    }
    if (compiled.kind === "ALREADY_ACCEPTED") {
      const reconciled = validateRuntimeState(
        await this.ports.runtime.resume(route, nowMs),
        route.runId,
        route.routeHash,
      );
      return outcome(
        task,
        "ACTION_RECONCILED",
        compiled.actionId,
        reconciled.orchestratorHash,
        nowMs,
      );
    }
    const command = compiled.command;
    if (
      command.routeSnapshot.routeHash !== route.routeHash
      || command.subjectId !== seatAuthority.activeControllerId
      || command.action.runId !== route.runId
      || command.action.chapterRuntimeId !== state.chapterRuntimeId
      || command.action.chapterId !== state.currentChapterId
      || command.action.decisionPointId !== task.decisionPointId
      || command.action.seatId !== task.seatId
      || command.action.controlEpoch !== task.expectedControlEpoch
      || command.action.expectedWorkingRevision !== task.expectedWorkingRevision
      || command.action.actionType !== selection.actionType
    ) {
      mismatch(ERROR.COMPILER_INVALID, "compiler.command", "AUTHORITY_BINDING_MISMATCH");
    }
    const submitted = validateRuntimeState(
      await this.ports.runtime.submitAction(command),
      route.runId,
      route.routeHash,
    );
    return outcome(
      task,
      "ACTION_SUBMITTED",
      command.action.actionId,
      submitted.orchestratorHash,
      nowMs,
    );
  }
}

function validateScannedTasks(
  scanned: DecisionAutomationTaskV1[],
): DecisionAutomationTaskV1[] {
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

function compareTasks(
  left: DecisionAutomationTaskV1,
  right: DecisionAutomationTaskV1,
): number {
  return Number(left.expectedControllerMode === "HUMAN_ACTIVE")
    - Number(right.expectedControllerMode === "HUMAN_ACTIVE")
    || deadlineSortValue(left.expectedDeadlineAtMs)
      - deadlineSortValue(right.expectedDeadlineAtMs)
    || compareCanonicalText(left.runId, right.runId)
    || Number(left.chapterId.slice(1)) - Number(right.chapterId.slice(1))
    || compareCanonicalText(left.decisionPointId, right.decisionPointId)
    || compareCanonicalText(left.seatId, right.seatId);
}

function deadlineSortValue(deadlineAtMs: number | null): number {
  return deadlineAtMs ?? Number.MAX_SAFE_INTEGER;
}

function isExpiredTask(task: DecisionAutomationTaskV1, nowMs: number): boolean {
  return task.expectedDeadlineAtMs !== null && nowMs >= task.expectedDeadlineAtMs;
}

function compareTasksForProcessing(
  left: DecisionAutomationTaskV1,
  right: DecisionAutomationTaskV1,
  nowMs: number,
): number {
  const leftExpired = isExpiredTask(left, nowMs);
  const rightExpired = isExpiredTask(right, nowMs);
  if (leftExpired !== rightExpired) return Number(leftExpired) - Number(rightExpired);
  if (leftExpired && rightExpired) {
    return Number(left.expectedControllerMode === "HUMAN_ACTIVE")
      - Number(right.expectedControllerMode === "HUMAN_ACTIVE")
      || deadlineSortValue(right.expectedDeadlineAtMs)
        - deadlineSortValue(left.expectedDeadlineAtMs)
      || compareCanonicalText(left.runId, right.runId)
      || Number(left.chapterId.slice(1)) - Number(right.chapterId.slice(1))
      || compareCanonicalText(left.decisionPointId, right.decisionPointId)
      || compareCanonicalText(left.seatId, right.seatId);
  }
  return compareTasks(left, right);
}

function validateTask(task: DecisionAutomationTaskV1): void {
  if (task?.schemaVersion !== "pressure_decision_automation_task_v1") {
    mismatch(ERROR.CLAIM_INVALID, "claim.task.schemaVersion", "UNSUPPORTED");
  }
  text(task.runId, "claim.task.runId", ERROR.CLAIM_INVALID);
  if (!isSha256(task.routeHash)) mismatch(ERROR.CLAIM_INVALID, "claim.task.routeHash", "SHA256");
  text(task.chapterRuntimeId, "claim.task.chapterRuntimeId", ERROR.CLAIM_INVALID);
  text(task.decisionPointId, "claim.task.decisionPointId", ERROR.CLAIM_INVALID);
  if (!PRESSURE_CHAPTER_SEAT_IDS_V1.includes(task.seatId)) {
    mismatch(ERROR.CLAIM_INVALID, "claim.task.chapterOrSeat", "PLAYABLE_CHAPTER_AND_SEAT");
  }
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

function expectedDecision(task: DecisionAutomationTaskV1) {
  return {
    chapterRuntimeId: task.chapterRuntimeId,
    decisionPointId: task.decisionPointId,
    expectedOrchestratorRevision: task.expectedOrchestratorRevision,
  };
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
    || snapshot.seatControls.length !== PRESSURE_CHAPTER_SEAT_IDS_V1.length
  ) {
    mismatch(ERROR.AUTHORITY_MISMATCH, "seatAuthority.snapshot", "INVALID_BINDING");
  }
  const { stateHash, ...body } = snapshot;
  if (sha256Canonical(body) !== stateHash) {
    mismatch(ERROR.AUTHORITY_MISMATCH, "seatAuthority.stateHash", "SELF_HASH_MISMATCH");
  }
  for (let index = 0; index < PRESSURE_CHAPTER_SEAT_IDS_V1.length; index += 1) {
    const seat = snapshot.seatControls[index];
    if (!seat || seat.seatId !== PRESSURE_CHAPTER_SEAT_IDS_V1[index]) {
      mismatch(ERROR.AUTHORITY_MISMATCH, "seatAuthority.seatOrder", "EXACT_SIX_REQUIRED");
    }
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
): AiDecisionPolicySelectionV1 {
  if (
    selection?.schemaVersion !== "sangtian_ai_decision_policy_selection_v1"
    || !selection.policyRef?.trim()
    || !selection.policyVersion?.trim()
    || !isSha256(selection.policyHash)
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

function outcome(
  task: DecisionAutomationTaskV1,
  kind: DecisionAutomationOutcomeV1["outcome"],
  actionId: string | null,
  resultingOrchestratorHash: string | null,
  completedAtMs: number,
): DecisionAutomationOutcomeV1 {
  const body = {
    schemaVersion: "pressure_decision_automation_outcome_v1" as const,
    taskHash: task.taskHash,
    outcome: kind,
    actionId,
    resultingOrchestratorHash,
    completedAtMs,
  };
  return { ...body, outcomeHash: sha256Canonical(body) };
}

function readErrorCode(error: unknown): string {
  if (error instanceof DecisionAutomationError) return error.code;
  if (error && typeof error === "object" && "code" in error) {
    const code = String((error as { code?: unknown }).code ?? "").trim();
    if (code) return code;
  }
  return "PRESSURE_DECISION_AUTOMATION_UNCLASSIFIED_FAILURE";
}

function traceDecision(
  stage: string,
  task: DecisionAutomationTaskV1 | null,
  details: Record<string, unknown> = {},
): void {
  if (process.env.PRESSURE_CHAPTER_DIAGNOSTIC_ERRORS !== "1") return;
  console.error("Pressure decision automation trace", {
    stage,
    runId: task?.runId ?? null,
    seatId: task?.seatId ?? null,
    ...details,
  });
}

function logDecisionRetry(
  error: unknown,
  errorCode: string,
  task: DecisionAutomationTaskV1 | null,
): void {
  if (process.env.PRESSURE_CHAPTER_DIAGNOSTIC_ERRORS !== "1") return;
  console.error("Pressure decision automation retry", {
    errorCode,
    runId: task?.runId ?? null,
    chapterRuntimeId: task?.chapterRuntimeId ?? null,
    seatId: task?.seatId ?? null,
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
  return failDecisionAutomation(code, `Decision automation validation failed at ${path}`, {
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
