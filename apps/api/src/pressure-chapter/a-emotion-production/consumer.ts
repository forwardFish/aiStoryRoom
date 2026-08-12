import type { AEmotionInteractionEventPortV1 } from "../a-emotion/ports";
import {
  A_EMOTION_PRODUCTION_ERROR_CODES as ERROR,
  AEmotionProductionError,
  failAEmotionProduction,
} from "./errors";
import { CanonicalAEmotionAuthorityEventCompilerV1 } from "./compiler";
import type {
  AEmotionAuthorityFeedPipelinePortV1,
  AEmotionAuthorityOutboxClaimV1,
  AEmotionAuthorityOutboxPortV1,
  AEmotionCommittedAuthorityReaderPortV1,
  AEmotionPostCommitWorkerPortV1,
  AEmotionProductionClockPortV1,
  AEmotionProductionConsumeResultV1,
  AEmotionProductionConsumerConfigV1,
  AEmotionViewerContextReaderPortV1,
  AEmotionViewerContextRequestV1,
} from "./contracts";
import {
  validateAEmotionAuthorityOutboxClaimV1,
  validateAEmotionAuthorityOutboxJobV1,
  validateAEmotionCommittedAuthoritySourceV1,
  validateAEmotionPipelineReceiptV1,
  validateAEmotionViewerDeliveryContextsV1,
} from "./validation";

export class AEmotionPostCommitConsumerV1 implements AEmotionPostCommitWorkerPortV1 {
  constructor(
    private readonly outbox: AEmotionAuthorityOutboxPortV1,
    private readonly authority: AEmotionCommittedAuthorityReaderPortV1,
    private readonly viewers: AEmotionViewerContextReaderPortV1,
    private readonly pipeline: AEmotionAuthorityFeedPipelinePortV1,
    private readonly clock: AEmotionProductionClockPortV1,
    private readonly config: AEmotionProductionConsumerConfigV1,
    private readonly compiler = new CanonicalAEmotionAuthorityEventCompilerV1(),
  ) {
    positiveInteger(config.leaseMs, "config.leaseMs");
    nonNegativeInteger(config.infrastructureRetryMs, "config.infrastructureRetryMs");
  }

  async consumeNext(workerId: string): Promise<AEmotionProductionConsumeResultV1> {
    nonEmpty(workerId, "workerId");
    const nowMs = this.clock.nowMs();
    nonNegativeInteger(nowMs, "clock.nowMs");
    const claim = validateAEmotionAuthorityOutboxClaimV1(await this.outbox.claimNext({
      workerId,
      nowMs,
      leaseMs: this.config.leaseMs,
    }));
    if (claim.kind === "EMPTY") return { kind: "IDLE" };
    if (claim.kind === "BUSY") return { kind: "BUSY", retryAtMs: claim.retryAtMs };

    let job;
    try {
      job = validateAEmotionAuthorityOutboxJobV1(claim.job);
    } catch (error) {
      return this.deadLetter(claim, ERROR.OUTBOX_JOB_INVALID, safeErrorName(error));
    }

    let rawSource: unknown;
    try {
      rawSource = await this.authority.readCommitted(job);
    } catch (error) {
      return this.retryOrDeadLetter(
        claim,
        ERROR.AUTHORITY_SOURCE_NOT_FOUND,
        nowMs + this.config.infrastructureRetryMs,
        safeErrorName(error),
      );
    }
    if (rawSource === null) {
      return this.retryOrDeadLetter(
        claim,
        ERROR.AUTHORITY_SOURCE_NOT_FOUND,
        nowMs + this.config.infrastructureRetryMs,
      );
    }

    let source;
    let event: AEmotionInteractionEventPortV1;
    try {
      source = validateAEmotionCommittedAuthoritySourceV1(rawSource, job);
      event = this.compiler.compile(job, source);
    } catch (error) {
      const reason = error instanceof AEmotionProductionError
        && error.code === ERROR.AUTHORITY_BINDING_MISMATCH
        ? ERROR.AUTHORITY_BINDING_MISMATCH
        : ERROR.AUTHORITY_SOURCE_INVALID;
      return this.deadLetter(claim, reason, safeErrorName(error));
    }

    const viewerRequest: AEmotionViewerContextRequestV1 = {
      sourceKind: source.sourceKind,
      sourceId: source.sourceId,
      sourceCommitHash: source.sourceCommitHash,
      roomId: source.roomId,
      runId: source.runId,
      stageId: source.stageId,
      eventId: event.eventId,
      eventFamily: event.eventFamily,
      sharedObjectId: event.sharedObjectId,
      revealOfEventId: event.revealOfEventId,
      audienceSpec: structuredClone(event.audienceSpec),
    };

    let rawViewerContexts: unknown;
    try {
      rawViewerContexts = await this.viewers.readForCommittedSource(viewerRequest);
    } catch (error) {
      return this.retryOrDeadLetter(
        claim,
        ERROR.VIEWER_CONTEXT_UNAVAILABLE,
        nowMs + this.config.infrastructureRetryMs,
        safeErrorName(error),
      );
    }

    let viewerContexts;
    try {
      viewerContexts = validateAEmotionViewerDeliveryContextsV1(
        rawViewerContexts,
        event,
        source.sourceCommitHash,
      );
    } catch (error) {
      return this.deadLetter(claim, ERROR.VIEWER_CONTEXT_INVALID, safeErrorName(error));
    }

    // A committed signal can legitimately address only AI-controlled seats.
    // Authority was fully validated above; having no active human delivery is
    // therefore a successful post-commit no-op, never a dead letter.
    if (viewerContexts.length === 0) {
      await this.outbox.acknowledge({ outboxId: claim.outboxId, fence: claim.fence });
      return {
        kind: "ACKNOWLEDGED",
        outboxId: claim.outboxId,
        viewerCount: 0,
        projectedViewerCount: 0,
      };
    }

    let projectedViewerCount = 0;
    try {
      for (const context of viewerContexts) {
        const receipt = validateAEmotionPipelineReceiptV1(await this.pipeline.ingest({
          event: structuredClone(event),
          storyDay: source.storyDay,
          viewer: structuredClone(context.viewer),
          priorProjection: structuredClone(context.priorProjection),
          priorAggregationKey: context.priorAggregationKey,
          // Delivery time is authority-derived, so a retry cannot rewrite it.
          now: source.committedAt,
        }), event, context.viewer.viewerSeatId);
        if (receipt.projectionStatus !== "SKIPPED") projectedViewerCount += 1;
      }
    } catch (error) {
      const reason = error instanceof AEmotionProductionError
        ? error.code
        : ERROR.PIPELINE_UNAVAILABLE;
      return this.retryOrDeadLetter(
        claim,
        reason,
        nowMs + this.config.infrastructureRetryMs,
        safeErrorName(error),
      );
    }

    if (projectedViewerCount === 0) {
      return this.deadLetter(claim, ERROR.NO_AUTHORIZED_VIEWER_PROJECTION);
    }

    // A stale fence must be surfaced by the adapter. Never reinterpret an ack
    // failure as an authority failure or roll back the committed source.
    await this.outbox.acknowledge({ outboxId: claim.outboxId, fence: claim.fence });
    return {
      kind: "ACKNOWLEDGED",
      outboxId: claim.outboxId,
      viewerCount: viewerContexts.length,
      projectedViewerCount,
    };
  }

  private async retryOrDeadLetter(
    claim: Extract<AEmotionAuthorityOutboxClaimV1, { kind: "CLAIMED" }>,
    reasonCode: string,
    nextAttemptAtMs: number,
    detail?: string,
  ): Promise<AEmotionProductionConsumeResultV1> {
    const attemptCount = claim.attemptCount + 1;
    const reason = detail ? `${reasonCode}:${detail}` : reasonCode;
    if (attemptCount >= claim.maxAttempts) return this.deadLetter(claim, reason);
    nonNegativeInteger(nextAttemptAtMs, "nextAttemptAtMs");
    if (nextAttemptAtMs < this.clock.nowMs()) {
      failAEmotionProduction(ERROR.CONFIG_INVALID, "nextAttemptAtMs", "PAST");
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
    claim: Extract<AEmotionAuthorityOutboxClaimV1, { kind: "CLAIMED" }>,
    reasonCode: string,
    detail?: string,
  ): Promise<AEmotionProductionConsumeResultV1> {
    const reason = detail ? `${reasonCode}:${detail}` : reasonCode;
    await this.outbox.deadLetter({
      outboxId: claim.outboxId,
      fence: claim.fence,
      attemptCount: claim.attemptCount + 1,
      reasonCode: reason,
    });
    return { kind: "DEAD_LETTERED", outboxId: claim.outboxId, reasonCode: reason };
  }
}

function nonEmpty(value: unknown, path: string): asserts value is string {
  if (typeof value !== "string" || value.trim().length === 0) {
    failAEmotionProduction(ERROR.CONFIG_INVALID, path, "NON_EMPTY_STRING");
  }
}

function positiveInteger(value: unknown, path: string): asserts value is number {
  if (!Number.isSafeInteger(value) || Number(value) <= 0) {
    failAEmotionProduction(ERROR.CONFIG_INVALID, path, "POSITIVE_INTEGER");
  }
}

function nonNegativeInteger(value: unknown, path: string): asserts value is number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    failAEmotionProduction(ERROR.CONFIG_INVALID, path, "NON_NEGATIVE_INTEGER");
  }
}

function safeErrorName(error: unknown): string {
  return error instanceof Error && error.name.trim() ? error.name : "UNKNOWN";
}
