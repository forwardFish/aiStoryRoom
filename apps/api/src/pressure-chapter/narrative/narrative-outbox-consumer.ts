import {
  NARRATIVE_STATUSES_V1,
  PressureChapterContractError,
  validateOpenNovelNarrativeArtifactV1,
  validateOpenNovelNarrativeProjectionJobV1,
  type OpenNovelNarrativeProjectionJobV1,
} from "@ai-story/shared";
import { PressureNarrativeAudienceProjectorV1 } from "./audience-projector";
import {
  PRESSURE_NARRATIVE_OUTBOX_ERROR_CODES as ERROR,
  PressureNarrativeOutboxError,
  failPressureNarrativeOutbox,
} from "./errors";
import type {
  AuthoritativeNarrativeSourceReaderPortV1,
  NarrativeOutboxClaimV1,
  NarrativeOutboxClockPortV1,
  NarrativeOutboxConsumeResultV1,
  NarrativeOutboxPortV1,
  OpenNovelNarrativeProjectorPortV1,
  OpenNovelProjectionReceiptV1,
} from "./ports";

export interface NarrativeOutboxConsumerConfigV1 {
  leaseMs: number;
  infrastructureRetryMs: number;
}

export class NarrativeOutboxConsumerV1 {
  constructor(
    private readonly outbox: NarrativeOutboxPortV1,
    private readonly authority: AuthoritativeNarrativeSourceReaderPortV1,
    private readonly projector: OpenNovelNarrativeProjectorPortV1,
    private readonly clock: NarrativeOutboxClockPortV1,
    private readonly config: NarrativeOutboxConsumerConfigV1,
    private readonly audienceProjector = new PressureNarrativeAudienceProjectorV1(),
  ) {
    positiveInteger(config.leaseMs, "config.leaseMs");
    nonNegativeInteger(config.infrastructureRetryMs, "config.infrastructureRetryMs");
  }

  async consumeNext(workerId: string): Promise<NarrativeOutboxConsumeResultV1> {
    nonEmpty(workerId, "workerId");
    const nowMs = this.clock.nowMs();
    const claim = validateClaim(await this.outbox.claimNext({
      workerId,
      nowMs,
      leaseMs: this.config.leaseMs,
    }));
    if (claim.kind === "EMPTY") return { kind: "IDLE" };
    if (claim.kind === "BUSY") return { kind: "BUSY", retryAtMs: claim.retryAtMs };

    let job: OpenNovelNarrativeProjectionJobV1;
    try {
      job = validateOpenNovelNarrativeProjectionJobV1(claim.job);
    } catch (error) {
      const detail = error instanceof PressureChapterContractError ? error.code : "UNKNOWN";
      return this.deadLetter(claim, ERROR.OUTBOX_JOB_INVALID, detail);
    }

    let source: unknown;
    try {
      source = await this.authority.readCommitted(job);
      if (source === null) {
        return this.retryOrDeadLetter(claim, ERROR.AUTHORITY_SOURCE_NOT_FOUND, nowMs + this.config.infrastructureRetryMs);
      }
    } catch (error) {
      return this.retryOrDeadLetter(claim, ERROR.AUTHORITY_SOURCE_NOT_FOUND, nowMs + this.config.infrastructureRetryMs, safeErrorName(error));
    }

    let audienceSafeSource: unknown;
    try {
      audienceSafeSource = this.audienceProjector.project(job, source);
    } catch (error) {
      const code = error instanceof PressureNarrativeOutboxError ? error.code : ERROR.AUTHORITY_SOURCE_INVALID;
      return this.deadLetter(claim, code, safeErrorName(error));
    }

    let receipt: OpenNovelProjectionReceiptV1;
    try {
      receipt = validateProjectionReceipt(await this.projector.project({
        job: structuredClone(job),
        audienceSafeSource,
        workerId,
      }), job);
    } catch (error) {
      const reason = error instanceof PressureNarrativeOutboxError
        ? error.code
        : error instanceof PressureChapterContractError
          ? ERROR.PROJECTOR_RECEIPT_INVALID
        : ERROR.PROJECTOR_UNAVAILABLE;
      return this.retryOrDeadLetter(claim, reason, nowMs + this.config.infrastructureRetryMs, safeErrorName(error));
    }

    if (receipt.deliveryState === "DEAD_LETTERED") {
      return this.deadLetter(claim, receipt.errorCode ?? "PROJECTION_DEAD_LETTERED");
    }
    if (receipt.status === "PUBLISHED" || receipt.status === "FALLBACK_PUBLISHED") {
      await this.outbox.acknowledge({ outboxId: claim.outboxId, fence: claim.fence });
      return { kind: "ACKNOWLEDGED", outboxId: claim.outboxId, status: receipt.status };
    }
    const retryAtMs = receipt.retryAtMs ?? nowMs + this.config.infrastructureRetryMs;
    return this.retryOrDeadLetter(claim, receipt.errorCode ?? receipt.status, retryAtMs);
  }

  private async retryOrDeadLetter(
    claim: Extract<NarrativeOutboxClaimV1, { kind: "CLAIMED" }>,
    reasonCode: string,
    nextAttemptAtMs: number,
    detail?: string,
  ): Promise<NarrativeOutboxConsumeResultV1> {
    const attemptCount = claim.attemptCount + 1;
    const reason = detail ? `${reasonCode}:${detail}` : reasonCode;
    if (attemptCount >= claim.maxAttempts) return this.deadLetter(claim, reason);
    if (!Number.isSafeInteger(nextAttemptAtMs) || nextAttemptAtMs < this.clock.nowMs()) {
      failPressureNarrativeOutbox(ERROR.PROJECTOR_RECEIPT_INVALID, "receipt.retryAtMs", "PAST_OR_INVALID");
    }
    await this.outbox.retry({
      outboxId: claim.outboxId,
      fence: claim.fence,
      attemptCount,
      nextAttemptAtMs,
      reasonCode: reason,
    });
    return { kind: "RETRY_SCHEDULED", outboxId: claim.outboxId, retryAtMs: nextAttemptAtMs, reasonCode: reason };
  }

  private async deadLetter(
    claim: Extract<NarrativeOutboxClaimV1, { kind: "CLAIMED" }>,
    reasonCode: string,
    detail?: string,
  ): Promise<NarrativeOutboxConsumeResultV1> {
    const reason = detail ? `${reasonCode}:${detail}` : reasonCode;
    const attemptCount = claim.attemptCount + 1;
    await this.outbox.deadLetter({
      outboxId: claim.outboxId,
      fence: claim.fence,
      attemptCount,
      reasonCode: reason,
    });
    return { kind: "DEAD_LETTERED", outboxId: claim.outboxId, reasonCode: reason };
  }
}

function validateClaim(value: unknown): NarrativeOutboxClaimV1 {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    failPressureNarrativeOutbox(ERROR.OUTBOX_CLAIM_INVALID, "claim", "OBJECT");
  }
  const claim = value as Record<string, unknown>;
  if (claim.kind === "EMPTY") {
    exactKeys(claim, ["kind"], "claim");
    return { kind: "EMPTY" };
  }
  if (claim.kind === "BUSY") {
    exactKeys(claim, ["kind", "retryAtMs"], "claim");
    nonNegativeInteger(claim.retryAtMs, "claim.retryAtMs");
    return { kind: "BUSY", retryAtMs: claim.retryAtMs };
  }
  if (claim.kind !== "CLAIMED") failPressureNarrativeOutbox(ERROR.OUTBOX_CLAIM_INVALID, "claim.kind");
  exactKeys(claim, ["kind", "outboxId", "fence", "attemptCount", "maxAttempts", "job"], "claim");
  nonEmpty(claim.outboxId, "claim.outboxId");
  positiveInteger(claim.fence, "claim.fence");
  nonNegativeInteger(claim.attemptCount, "claim.attemptCount");
  positiveInteger(claim.maxAttempts, "claim.maxAttempts");
  if (claim.attemptCount >= claim.maxAttempts) failPressureNarrativeOutbox(ERROR.OUTBOX_CLAIM_INVALID, "claim.attemptCount", "EXHAUSTED");
  return structuredClone(claim) as unknown as NarrativeOutboxClaimV1;
}

function validateProjectionReceipt(
  value: unknown,
  job: OpenNovelNarrativeProjectionJobV1,
): OpenNovelProjectionReceiptV1 {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    failPressureNarrativeOutbox(ERROR.PROJECTOR_RECEIPT_INVALID, "receipt", "OBJECT");
  }
  const receipt = value as Record<string, unknown>;
  exactKeys(receipt, [
    "logicalProjectionKey", "requestFingerprint", "projectionId", "status",
    "deliveryState", "artifact", "retryAtMs", "errorCode",
  ], "receipt", ERROR.PROJECTOR_RECEIPT_INVALID);
  sha256(receipt.logicalProjectionKey, "receipt.logicalProjectionKey");
  sha256(receipt.requestFingerprint, "receipt.requestFingerprint");
  if (receipt.projectionId !== null) nonEmpty(receipt.projectionId, "receipt.projectionId", ERROR.PROJECTOR_RECEIPT_INVALID);
  if (!NARRATIVE_STATUSES_V1.includes(receipt.status as never)) invalidReceipt("receipt.status");
  if (receipt.deliveryState !== "ACTIVE" && receipt.deliveryState !== "DEAD_LETTERED") invalidReceipt("receipt.deliveryState");
  if (receipt.retryAtMs !== null) nonNegativeInteger(receipt.retryAtMs, "receipt.retryAtMs", ERROR.PROJECTOR_RECEIPT_INVALID);
  if (receipt.errorCode !== null) nonEmpty(receipt.errorCode, "receipt.errorCode", ERROR.PROJECTOR_RECEIPT_INVALID);
  const published = receipt.status === "PUBLISHED" || receipt.status === "FALLBACK_PUBLISHED";
  if (published) {
    if (receipt.deliveryState !== "ACTIVE" || receipt.retryAtMs !== null || receipt.errorCode !== null) invalidReceipt("receipt", "PUBLISHED_STATE_MISMATCH");
    validateOpenNovelNarrativeArtifactV1(receipt.artifact, job);
  } else if (receipt.artifact !== null) {
    invalidReceipt("receipt.artifact", "UNPUBLISHED_REQUIRES_NULL");
  }
  if (receipt.deliveryState === "DEAD_LETTERED" && receipt.errorCode === null) invalidReceipt("receipt.errorCode", "REQUIRED");
  return structuredClone(receipt) as unknown as OpenNovelProjectionReceiptV1;
}

function exactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
  path: string,
  code: (typeof ERROR)[keyof typeof ERROR] = ERROR.OUTBOX_CLAIM_INVALID,
): void {
  const unknown = Object.keys(value).find((key) => !keys.includes(key));
  if (unknown) failPressureNarrativeOutbox(code, `${path}.${unknown}`, "UNKNOWN_FIELD");
  const missing = keys.find((key) => !(key in value));
  if (missing) failPressureNarrativeOutbox(code, `${path}.${missing}`, "MISSING_FIELD");
}
function nonEmpty(
  value: unknown,
  path: string,
  code: (typeof ERROR)[keyof typeof ERROR] = ERROR.OUTBOX_CLAIM_INVALID,
): asserts value is string {
  if (typeof value !== "string" || value.trim().length === 0) failPressureNarrativeOutbox(code, path, "NON_EMPTY_STRING");
}
function positiveInteger(
  value: unknown,
  path: string,
  code: (typeof ERROR)[keyof typeof ERROR] = ERROR.OUTBOX_CLAIM_INVALID,
): asserts value is number {
  if (!Number.isSafeInteger(value) || Number(value) <= 0) failPressureNarrativeOutbox(code, path, "POSITIVE_INTEGER");
}
function nonNegativeInteger(
  value: unknown,
  path: string,
  code: (typeof ERROR)[keyof typeof ERROR] = ERROR.OUTBOX_CLAIM_INVALID,
): asserts value is number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) failPressureNarrativeOutbox(code, path, "NON_NEGATIVE_INTEGER");
}
function sha256(value: unknown, path: string): asserts value is string {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) invalidReceipt(path, "SHA256_LOWER_HEX");
}
function invalidReceipt(path: string, detail?: string): never {
  failPressureNarrativeOutbox(ERROR.PROJECTOR_RECEIPT_INVALID, path, detail);
}
function safeErrorName(error: unknown): string {
  return error instanceof Error && error.name.trim() ? error.name : "UNKNOWN";
}
