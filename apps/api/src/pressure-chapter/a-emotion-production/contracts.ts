import type { SeatIdV1 } from "@ai-story/shared";
import type {
  AEmotionInteractionEventPortV1,
  AEmotionViewerContextPortV1,
  AEmotionViewerProjectionPortV1,
} from "../a-emotion/ports";

export const A_EMOTION_AUTHORITY_SOURCE_KINDS_V1 = Object.freeze([
  "BEAT_COMMITTED",
  "FORMAL_COMMITMENT_COMMITTED",
  "CHAPTER_SETTLEMENT_COMMITTED",
  "FINALE_COMMITTED",
] as const);

export type AEmotionAuthoritySourceKindV1 =
  (typeof A_EMOTION_AUTHORITY_SOURCE_KINDS_V1)[number];

export type AEmotionAuthoritySignalV1 = Pick<
  AEmotionInteractionEventPortV1,
  | "kind"
  | "eventCode"
  | "eventFamily"
  | "severity"
  | "sharedObjectId"
  | "factRefs"
  | "publicFactRefs"
  | "impacts"
  | "audienceSpec"
  | "disclosure"
  | "suspectedSeatIds"
  | "suspicionBasisRefs"
  | "evidenceRefs"
  | "revealOfEventId"
  | "promiseId"
  | "milestoneId"
  | "metricTransitionId"
  | "presentation"
> & {
  /** One authority commit may own several independently deduplicated signals. */
  signalId: string;
};

/**
 * Rule-produced, non-literary material read from committed authority.
 *
 * A W1 adapter may derive this only from a committed BeatResolution,
 * ChapterSettlement, or FinaleDecision plus frozen content policy. Narrative,
 * Provider output, and current mutable UI state are forbidden inputs.
 */
export interface AEmotionCommittedAuthoritySourceV1 {
  schemaVersion: "a_emotion_committed_authority_source_v1";
  sourceKind: AEmotionAuthoritySourceKindV1;
  sourceId: string;
  sourceCommitHash: string;
  roomId: string;
  runId: string;
  stageId: string;
  sourceActionId: string;
  sourceSeatId: SeatIdV1;
  committedAt: string;
  eventSequence: number;
  stateVersion: number;
  storyDay: number;
  signal: AEmotionAuthoritySignalV1;
  sourceBindingHash: string;
}

export interface AEmotionAuthorityOutboxJobV1 {
  schemaVersion: "a_emotion_authority_outbox_job_v1";
  sourceKind: AEmotionAuthoritySourceKindV1;
  runId: string;
  sourceId: string;
  sourceCommitHash: string;
  signalId: string;
  jobHash: string;
}

export type AEmotionAuthorityOutboxClaimV1 =
  | { kind: "EMPTY" }
  | { kind: "BUSY"; retryAtMs: number }
  | {
      kind: "CLAIMED";
      outboxId: string;
      fence: number;
      attemptCount: number;
      maxAttempts: number;
      job: unknown;
    };

/**
 * Dedicated queue capability. A production implementation must claim only
 * A-Emotion tasks created atomically with their authority commit; it must not
 * claim or mutate OpenNovel Narrative tasks.
 */
export interface AEmotionAuthorityOutboxPortV1 {
  claimNext(request: {
    workerId: string;
    nowMs: number;
    leaseMs: number;
  }): Promise<AEmotionAuthorityOutboxClaimV1>;
  acknowledge(request: { outboxId: string; fence: number }): Promise<void>;
  retry(request: {
    outboxId: string;
    fence: number;
    attemptCount: number;
    nextAttemptAtMs: number;
    reasonCode: string;
  }): Promise<void>;
  deadLetter(request: {
    outboxId: string;
    fence: number;
    attemptCount: number;
    reasonCode: string;
  }): Promise<void>;
}

/** Read-only capability; there is deliberately no authority mutation method. */
export interface AEmotionCommittedAuthorityReaderPortV1 {
  readCommitted(job: Readonly<AEmotionAuthorityOutboxJobV1>): Promise<unknown | null>;
}

export interface AEmotionViewerDeliveryContextV1 {
  viewer: AEmotionViewerContextPortV1;
  priorProjection: AEmotionViewerProjectionPortV1 | null;
  priorAggregationKey: string | null;
  /** Binds viewer knowledge and prior projection to this source commit. */
  contextHash: string;
}

export interface AEmotionViewerContextRequestV1 {
  sourceKind: AEmotionAuthoritySourceKindV1;
  sourceId: string;
  sourceCommitHash: string;
  roomId: string;
  runId: string;
  stageId: string;
  eventId: string;
  eventFamily: string;
  sharedObjectId: string | null;
  revealOfEventId: string | null;
  audienceSpec: AEmotionInteractionEventPortV1["audienceSpec"];
}

/**
 * Resolves frozen, viewer-authorized knowledge/evidence contexts. The request
 * intentionally contains no raw facts, impacts, or literary text.
 */
export interface AEmotionViewerContextReaderPortV1 {
  readForCommittedSource(request: Readonly<AEmotionViewerContextRequestV1>): Promise<unknown>;
}

export interface AEmotionAuthorityFeedPipelinePortV1 {
  ingest(input: {
    event: AEmotionInteractionEventPortV1;
    storyDay: number;
    viewer: AEmotionViewerContextPortV1;
    priorProjection?: AEmotionViewerProjectionPortV1 | null;
    priorAggregationKey?: string | null;
    now: string;
  }): Promise<{
    eventStatus: "COMMITTED" | "REPLAYED";
    projectionStatus: "SKIPPED" | "COMMITTED" | "REPLAYED";
    projection: AEmotionViewerProjectionPortV1 | null;
  }>;
}

export interface AEmotionProductionClockPortV1 {
  nowMs(): number;
}

export interface AEmotionProductionConsumerConfigV1 {
  leaseMs: number;
  infrastructureRetryMs: number;
}

export type AEmotionProductionConsumeResultV1 =
  | { kind: "IDLE" }
  | { kind: "BUSY"; retryAtMs: number }
  | {
      kind: "ACKNOWLEDGED";
      outboxId: string;
      viewerCount: number;
      projectedViewerCount: number;
    }
  | { kind: "RETRY_SCHEDULED"; outboxId: string; retryAtMs: number; reasonCode: string }
  | { kind: "DEAD_LETTERED"; outboxId: string; reasonCode: string };

/** Narrow ProductRoot/worker-runner capability; it exposes no authority writes. */
export interface AEmotionPostCommitWorkerPortV1 {
  consumeNext(workerId: string): Promise<AEmotionProductionConsumeResultV1>;
}

/**
 * Explicit composition boundary for the production post-commit worker.
 *
 * There are intentionally no default queue, authority reader, clock, or retry
 * values: ProductRoot must bind every production dependency deliberately.
 */
export interface AEmotionPostCommitProductionDependenciesV1 {
  outbox: AEmotionAuthorityOutboxPortV1;
  authority: AEmotionCommittedAuthorityReaderPortV1;
  viewers: AEmotionViewerContextReaderPortV1;
  pipeline: AEmotionAuthorityFeedPipelinePortV1;
  clock: AEmotionProductionClockPortV1;
  config: Readonly<AEmotionProductionConsumerConfigV1>;
}
