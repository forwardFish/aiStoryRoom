import {
  hashWithoutField,
  isSha256,
  validateChapterIdV1,
} from "@ai-story/shared";
import {
  PRESSURE_PERSISTENCE_ERROR_CODES as PERSISTENCE_ERROR,
  PressurePersistenceError,
} from "../persistence/errors";
import {
  PRESSURE_PROGRESS_OUTBOX_ERROR_CODES as ERROR,
  PressureProgressOutboxError,
} from "./errors";
import type {
  ProgressComputeFinaleHandoffV1,
  ProgressOutboxClaimV1,
  ProgressOutboxClockPortV1,
  ProgressOutboxDrainResultV1,
  ProgressOutboxPortV1,
  ProgressOutboxStoredTaskV1,
  ProgressOutboxTickResultV1,
  ProgressOutboxWorkerConfigV1,
  RuntimeProgressFinalePortV1,
  RuntimeProgressOpenChapterPortV1,
} from "./ports";

type ParsedTaskV1 =
  | {
      taskType: "OPEN_CHAPTER";
      outboxId: string;
      runId: string;
      attemptCount: number;
      maxAttempts: number;
      fence: number;
      handoff: {
        sourceAuthority: "CHAPTER_FROZEN";
        runId: string;
        previousChapterRuntimeId: string;
        outboxDedupeKey: string;
        sourceBundleHash: string;
        sourceCommitHash: string;
        targetChapterId: "N2" | "N3" | "N4" | "N5" | "N6" | "N7";
      };
    }
  | {
      taskType: "COMPUTE_FINALE";
      outboxId: string;
      runId: string;
      attemptCount: number;
      maxAttempts: number;
      fence: number;
      handoff: ProgressComputeFinaleHandoffV1;
    };

export class PressureProgressOutboxWorkerV1 {
  constructor(
    private readonly outbox: ProgressOutboxPortV1,
    private readonly openNextChapter: RuntimeProgressOpenChapterPortV1,
    private readonly finale: RuntimeProgressFinalePortV1,
    private readonly clock: ProgressOutboxClockPortV1,
    private readonly config: ProgressOutboxWorkerConfigV1,
  ) {
    assertPositiveInteger(config.leaseMs, "config.leaseMs");
    assertPositiveInteger(config.baseRetryMs, "config.baseRetryMs");
    assertPositiveInteger(config.maxRetryMs, "config.maxRetryMs");
    if (config.maxRetryMs < config.baseRetryMs) {
      throw new PressureProgressOutboxError(
        ERROR.INVALID_CONFIGURATION,
        "Progress outbox maxRetryMs cannot be smaller than baseRetryMs",
      );
    }
  }

  async tick(workerId: string): Promise<ProgressOutboxTickResultV1> {
    assertText(workerId, "workerId");
    const nowMs = this.clock.nowMs();
    assertNonNegativeInteger(nowMs, "clock.nowMs()");

    const claim = validateClaim(await this.outbox.claimNext({
      workerId,
      nowMs,
      leaseMs: this.config.leaseMs,
    }));
    if (claim.kind === "EMPTY") return { kind: "IDLE" };
    if (claim.kind === "BUSY") return { kind: "BUSY", retryAtMs: claim.retryAtMs };

    let parsed: ParsedTaskV1 | null = null;
    try {
      parsed = parseClaimedTask(claim);
      if (parsed.taskType === "OPEN_CHAPTER") {
        const result = await this.openNextChapter.openNextChapter({
          handoff: structuredClone(parsed.handoff),
          workerId,
          nowMs,
        });
        validateOpenResult(result, parsed.handoff.targetChapterId);
        await this.outbox.acknowledge({
          outboxId: parsed.outboxId,
          fence: parsed.fence,
          workerId,
          completedAtMs: nowMs,
        });
        return {
          kind: "ACKNOWLEDGED",
          outboxId: parsed.outboxId,
          taskType: "OPEN_CHAPTER",
          effect: result.status,
        };
      }

      const result = await this.finale.computeFinale({
        handoff: structuredClone(parsed.handoff),
        workerId,
        nowMs,
      });
      validateFinaleResult(result, parsed.runId);
      await this.outbox.acknowledge({
        outboxId: parsed.outboxId,
        fence: parsed.fence,
        workerId,
        completedAtMs: nowMs,
      });
      return {
        kind: "ACKNOWLEDGED",
        outboxId: parsed.outboxId,
        taskType: "COMPUTE_FINALE",
        effect: result.status,
      };
    } catch (error) {
      if (isLeaseLost(error)) throw error;
      if (!parsed) {
        await this.outbox.deadLetter({
          outboxId: claim.outboxId,
          fence: claim.fence,
          workerId,
          nowMs,
          reasonCode: classifyReasonCode(error),
        });
        return {
          kind: "DEAD_LETTERED",
          outboxId: claim.outboxId,
          reasonCode: classifyReasonCode(error),
        };
      }
      const reasonCode = classifyReasonCode(error);
      const retryable = isRetryable(error) && parsed.attemptCount < parsed.maxAttempts;
      if (retryable) {
        const retryAtMs = nowMs + computeBackoffMs(
          parsed.attemptCount,
          this.config.baseRetryMs,
          this.config.maxRetryMs,
        );
        await this.outbox.retry({
          outboxId: parsed.outboxId,
          fence: parsed.fence,
          workerId,
          nowMs,
          nextAttemptAtMs: retryAtMs,
          reasonCode,
        });
        return {
          kind: "RETRY_SCHEDULED",
          outboxId: parsed.outboxId,
          reasonCode,
          retryAtMs,
        };
      }
      await this.outbox.deadLetter({
        outboxId: parsed.outboxId,
        fence: parsed.fence,
        workerId,
        nowMs,
        reasonCode,
      });
      return {
        kind: "DEAD_LETTERED",
        outboxId: parsed.outboxId,
        reasonCode,
      };
    }
  }

  async drain(
    workerId: string,
    limit = 32,
  ): Promise<ProgressOutboxDrainResultV1> {
    assertPositiveInteger(limit, "limit");
    const results: ProgressOutboxTickResultV1[] = [];
    for (let index = 0; index < limit; index += 1) {
      const result = await this.tick(workerId);
      results.push(result);
      if (result.kind === "IDLE") {
        return { results, stoppedBecause: "IDLE" };
      }
      if (result.kind === "BUSY") {
        return { results, stoppedBecause: "BUSY" };
      }
    }
    return { results, stoppedBecause: "LIMIT" };
  }
}

function validateClaim(value: ProgressOutboxClaimV1): ProgressOutboxClaimV1 {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new PressureProgressOutboxError(ERROR.INVALID_CLAIM, "Progress outbox claim must be an object");
  }
  if (value.kind === "EMPTY") return value;
  if (value.kind === "BUSY") {
    assertNonNegativeInteger(value.retryAtMs, "claim.retryAtMs");
    return value;
  }
  if (value.kind !== "CLAIMED") {
    throw new PressureProgressOutboxError(ERROR.INVALID_CLAIM, "Unknown progress outbox claim kind");
  }
  assertText(value.outboxId, "claim.outboxId");
  assertPositiveInteger(value.fence, "claim.fence");
  assertPositiveInteger(value.attemptCount, "claim.attemptCount");
  assertPositiveInteger(value.maxAttempts, "claim.maxAttempts");
  if (value.attemptCount > value.maxAttempts) {
    throw new PressureProgressOutboxError(ERROR.INVALID_CLAIM, "Progress outbox attemptCount exceeds maxAttempts");
  }
  validateStoredTask(value.task);
  return structuredClone(value);
}

function validateStoredTask(value: ProgressOutboxStoredTaskV1): ProgressOutboxStoredTaskV1 {
  assertText(value.outboxId, "task.outboxId");
  assertText(value.runId, "task.runId");
  assertText(value.taskType, "task.taskType");
  assertText(value.dedupeKey, "task.dedupeKey");
  assertText(value.sourceAuthority, "task.sourceAuthority");
  assertText(value.sourceId, "task.sourceId");
  assertHash(value.sourceCommitHash, "task.sourceCommitHash");
  assertHash(value.payloadHash, "task.payloadHash");
  assertPositiveInteger(value.attemptCount, "task.attemptCount");
  assertPositiveInteger(value.maxAttempts, "task.maxAttempts");
  return structuredClone(value);
}

function parseClaimedTask(
  claim: Extract<ProgressOutboxClaimV1, { kind: "CLAIMED" }>,
): ParsedTaskV1 {
  const row = claim.task;
  const payload = parsePayload(row);
  if (
    row.taskType !== payload.taskType ||
    row.runId !== payload.runId ||
    row.dedupeKey !== payload.dedupeKey ||
    row.sourceId !== payload.sourceBundleHash
  ) {
    throw new PressureProgressOutboxError(
      ERROR.TASK_TAMPERED,
      "Stored progress outbox row does not match its payload envelope",
      { outboxId: row.outboxId },
    );
  }
  if (payload.taskType === "OPEN_CHAPTER") {
    if (payload.target.kind !== "NEXT_CHAPTER" || payload.target.chapterId === "N1") {
      throw new PressureProgressOutboxError(
        ERROR.TASK_UNSUPPORTED,
        "Progress outbox worker only consumes W6 OPEN_CHAPTER handoffs for N2-N7",
        { outboxId: row.outboxId, target: payload.target },
      );
    }
    const chapterId = validateChapterIdV1(payload.target.chapterId, "payload.target.chapterId");
    if (chapterId === "N1") {
      throw new PressureProgressOutboxError(
        ERROR.TASK_UNSUPPORTED,
        "Progress outbox worker cannot open this chapter target",
        { outboxId: row.outboxId, chapterId },
      );
    }
    return {
      taskType: "OPEN_CHAPTER",
      outboxId: claim.outboxId,
      runId: row.runId,
      attemptCount: claim.attemptCount,
      maxAttempts: claim.maxAttempts,
      fence: claim.fence,
      handoff: {
        sourceAuthority: "CHAPTER_FROZEN",
        runId: row.runId,
        previousChapterRuntimeId: payload.chapterRuntimeId,
        outboxDedupeKey: row.dedupeKey,
        sourceBundleHash: row.sourceId,
        sourceCommitHash: row.sourceCommitHash,
        targetChapterId: chapterId,
      },
    };
  }
  if (payload.target.kind !== "FINALE" || payload.target.chapterId !== null) {
    throw new PressureProgressOutboxError(
      ERROR.TASK_TAMPERED,
      "COMPUTE_FINALE handoff must target FINALE exactly once",
      { outboxId: row.outboxId },
    );
  }
  return {
    taskType: "COMPUTE_FINALE",
    outboxId: claim.outboxId,
    runId: row.runId,
    attemptCount: claim.attemptCount,
    maxAttempts: claim.maxAttempts,
    fence: claim.fence,
    handoff: {
      sourceAuthority: "CHAPTER_FROZEN",
      runId: row.runId,
      terminalChapterRuntimeId: payload.chapterRuntimeId,
      outboxDedupeKey: row.dedupeKey,
      sourceBundleHash: row.sourceId,
      sourceCommitHash: row.sourceCommitHash,
    },
  };
}

function parsePayload(row: ProgressOutboxStoredTaskV1) {
  if (row.sourceAuthority !== "CHAPTER_FROZEN") {
    throw new PressureProgressOutboxError(
      ERROR.TASK_UNSUPPORTED,
      "Progress outbox worker only consumes CHAPTER_FROZEN rows",
      { outboxId: row.outboxId, sourceAuthority: row.sourceAuthority },
    );
  }
  if (hashWithoutField(row.payloadJson as Record<string, unknown>, "outboxHash") !== row.payloadHash) {
    throw new PressureProgressOutboxError(
      ERROR.TASK_TAMPERED,
      "Stored progress outbox payloadHash does not match payloadJson",
      { outboxId: row.outboxId },
    );
  }
  if (!row.payloadJson || typeof row.payloadJson !== "object" || Array.isArray(row.payloadJson)) {
    throw new PressureProgressOutboxError(
      ERROR.TASK_TAMPERED,
      "Stored progress outbox payload must be an object",
      { outboxId: row.outboxId },
    );
  }
  const payload = row.payloadJson as Record<string, unknown>;
  exactKeys(payload, [
    "schemaVersion",
    "taskType",
    "status",
    "dedupeKey",
    "runId",
    "chapterRuntimeId",
    "sourceRootEventId",
    "sourceRootEventHash",
    "sourceBundleHash",
    "target",
    "outboxHash",
  ], "payload");
  if (payload.schemaVersion !== "pressure_chapter_handoff_outbox_v1") {
    throw new PressureProgressOutboxError(ERROR.TASK_TAMPERED, "Unexpected progress outbox schemaVersion");
  }
  if (payload.status !== "PENDING") {
    throw new PressureProgressOutboxError(ERROR.TASK_TAMPERED, "Progress outbox payload status must remain PENDING");
  }
  if (payload.taskType !== "OPEN_CHAPTER" && payload.taskType !== "COMPUTE_FINALE") {
    throw new PressureProgressOutboxError(ERROR.TASK_UNSUPPORTED, "Unsupported progress outbox taskType");
  }
  assertText(payload.dedupeKey, "payload.dedupeKey");
  assertText(payload.runId, "payload.runId");
  assertText(payload.chapterRuntimeId, "payload.chapterRuntimeId");
  assertText(payload.sourceRootEventId, "payload.sourceRootEventId");
  assertHash(payload.sourceRootEventHash, "payload.sourceRootEventHash");
  assertHash(payload.sourceBundleHash, "payload.sourceBundleHash");
  assertHash(payload.outboxHash, "payload.outboxHash");
  if (payload.outboxHash !== row.payloadHash) {
    throw new PressureProgressOutboxError(
      ERROR.TASK_TAMPERED,
      "Stored progress outbox payloadHash must equal payload.outboxHash",
      { outboxId: row.outboxId },
    );
  }
  const target = payload.target;
  if (!target || typeof target !== "object" || Array.isArray(target)) {
    throw new PressureProgressOutboxError(ERROR.TASK_TAMPERED, "Progress outbox target must be an object");
  }
  const targetRecord = target as Record<string, unknown>;
  exactKeys(targetRecord, ["kind", "chapterId"], "payload.target");
  if (targetRecord.kind === "NEXT_CHAPTER") {
    validateChapterIdV1(targetRecord.chapterId, "payload.target.chapterId");
  } else if (targetRecord.kind === "FINALE") {
    if (targetRecord.chapterId !== null) {
      throw new PressureProgressOutboxError(ERROR.TASK_TAMPERED, "FINALE target chapterId must be null");
    }
  } else {
    throw new PressureProgressOutboxError(ERROR.TASK_TAMPERED, "Unknown progress outbox target kind");
  }
  return payload as {
    taskType: "OPEN_CHAPTER" | "COMPUTE_FINALE";
    dedupeKey: string;
    runId: string;
    chapterRuntimeId: string;
    sourceBundleHash: string;
    target:
      | { kind: "NEXT_CHAPTER"; chapterId: "N1" | "N2" | "N3" | "N4" | "N5" | "N6" | "N7" }
      | { kind: "FINALE"; chapterId: null };
  };
}

function validateOpenResult(
  value: unknown,
  expectedChapterId: string,
): asserts value is { status: "OPENED" | "REPLAYED"; chapterId: string; chapterRuntimeId: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new PressureProgressOutboxError(ERROR.DEPENDENCY_RESULT_INVALID, "openNextChapter result must be an object");
  }
  const result = value as Record<string, unknown>;
  exactKeys(result, ["status", "chapterId", "chapterRuntimeId"], "openResult");
  if (result.status !== "OPENED" && result.status !== "REPLAYED") {
    throw new PressureProgressOutboxError(ERROR.DEPENDENCY_RESULT_INVALID, "openNextChapter result status is invalid");
  }
  assertText(result.chapterRuntimeId, "openResult.chapterRuntimeId");
  if (result.chapterId !== expectedChapterId) {
    throw new PressureProgressOutboxError(
      ERROR.DEPENDENCY_RESULT_INVALID,
      "openNextChapter returned a different chapter authority",
      { expectedChapterId, actualChapterId: result.chapterId },
    );
  }
}

function validateFinaleResult(
  value: unknown,
  expectedRunId: string,
): asserts value is { status: "COMMITTED" | "REPLAYED"; runId: string; authorityCommitHash: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new PressureProgressOutboxError(ERROR.DEPENDENCY_RESULT_INVALID, "computeFinale result must be an object");
  }
  const result = value as Record<string, unknown>;
  exactKeys(result, ["status", "runId", "authorityCommitHash"], "finaleResult");
  if (result.status !== "COMMITTED" && result.status !== "REPLAYED") {
    throw new PressureProgressOutboxError(ERROR.DEPENDENCY_RESULT_INVALID, "computeFinale result status is invalid");
  }
  if (result.runId !== expectedRunId) {
    throw new PressureProgressOutboxError(
      ERROR.DEPENDENCY_RESULT_INVALID,
      "computeFinale returned a different run authority",
      { expectedRunId, actualRunId: result.runId },
    );
  }
  assertHash(result.authorityCommitHash, "finaleResult.authorityCommitHash");
}

function computeBackoffMs(
  attemptCount: number,
  baseRetryMs: number,
  maxRetryMs: number,
): number {
  const multiplier = 2 ** Math.max(0, attemptCount - 1);
  return Math.min(maxRetryMs, baseRetryMs * multiplier);
}

function isRetryable(error: unknown): boolean {
  if (error instanceof PressureProgressOutboxError) {
    return error.code !== ERROR.TASK_TAMPERED
      && error.code !== ERROR.TASK_UNSUPPORTED
      && error.code !== ERROR.DEPENDENCY_RESULT_INVALID
      && error.code !== ERROR.INVALID_CLAIM;
  }
  if (error instanceof PressurePersistenceError) {
    return error.code !== PERSISTENCE_ERROR.RECORD_INVALID
      && error.code !== PERSISTENCE_ERROR.AUTHORITY_FENCE_MISMATCH
      && error.code !== PERSISTENCE_ERROR.OUTBOX_VOCABULARY_INVALID
      && error.code !== PERSISTENCE_ERROR.OUTBOX_LEASE_LOST;
  }
  return true;
}

function classifyReasonCode(error: unknown): string {
  if (error instanceof PressureProgressOutboxError) return error.code;
  if (error instanceof PressurePersistenceError) return error.code;
  if (error instanceof Error && error.name.trim()) return error.name;
  return "UNKNOWN_ERROR";
}

function isLeaseLost(error: unknown): error is PressurePersistenceError {
  return error instanceof PressurePersistenceError
    && error.code === PERSISTENCE_ERROR.OUTBOX_LEASE_LOST;
}

function exactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
  path: string,
): void {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new PressureProgressOutboxError(
      ERROR.TASK_TAMPERED,
      `Unexpected keys at ${path}`,
      { actual, expected },
    );
  }
}

function assertText(value: unknown, path: string): asserts value is string {
  if (typeof value !== "string" || !value.trim()) {
    throw new PressureProgressOutboxError(ERROR.TASK_TAMPERED, `${path} must be a non-empty string`);
  }
}

function assertHash(value: unknown, path: string): asserts value is string {
  if (!isSha256(value)) {
    throw new PressureProgressOutboxError(ERROR.TASK_TAMPERED, `${path} must be a SHA-256 hash`);
  }
}

function assertPositiveInteger(value: unknown, path: string): asserts value is number {
  if (!Number.isSafeInteger(value) || Number(value) <= 0) {
    throw new PressureProgressOutboxError(ERROR.INVALID_CONFIGURATION, `${path} must be a positive integer`);
  }
}

function assertNonNegativeInteger(value: unknown, path: string): asserts value is number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw new PressureProgressOutboxError(ERROR.INVALID_CONFIGURATION, `${path} must be a non-negative integer`);
  }
}
