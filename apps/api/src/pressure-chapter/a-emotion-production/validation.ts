import {
  PRESSURE_CHAPTER_SEAT_IDS_V1,
  hashWithoutField,
  isSha256,
  sha256Canonical,
  validateSeatIdV1,
  type SeatIdV1,
} from "@ai-story/shared";
import {
  validateAEmotionViewerProjectionV1,
} from "@ai-story/shared/pressure-chapter/a-emotion";
import type {
  AEmotionInteractionEventPortV1,
  AEmotionViewerContextPortV1,
  AEmotionViewerProjectionPortV1,
} from "../a-emotion/ports";
import {
  A_EMOTION_PRODUCTION_ERROR_CODES as ERROR,
  failAEmotionProduction,
} from "./errors";
import {
  A_EMOTION_AUTHORITY_SOURCE_KINDS_V1,
  type AEmotionAuthorityOutboxClaimV1,
  type AEmotionAuthorityOutboxJobV1,
  type AEmotionCommittedAuthoritySourceV1,
  type AEmotionViewerDeliveryContextV1,
} from "./contracts";

type RecordValue = Record<string, unknown>;

const SIGNAL_KEYS = [
  "signalId", "kind", "eventCode", "eventFamily", "severity", "sharedObjectId",
  "factRefs", "publicFactRefs", "impacts", "audienceSpec", "disclosure",
  "suspectedSeatIds", "suspicionBasisRefs", "evidenceRefs", "revealOfEventId",
  "promiseId", "milestoneId", "metricTransitionId", "presentation",
] as const;

export function validateAEmotionAuthorityOutboxClaimV1(
  value: unknown,
): AEmotionAuthorityOutboxClaimV1 {
  const claim = object(value, "claim", ERROR.OUTBOX_CLAIM_INVALID);
  if (claim.kind === "EMPTY") {
    exactKeys(claim, ["kind"], "claim", ERROR.OUTBOX_CLAIM_INVALID);
    return { kind: "EMPTY" };
  }
  if (claim.kind === "BUSY") {
    exactKeys(claim, ["kind", "retryAtMs"], "claim", ERROR.OUTBOX_CLAIM_INVALID);
    nonNegativeInteger(claim.retryAtMs, "claim.retryAtMs", ERROR.OUTBOX_CLAIM_INVALID);
    return { kind: "BUSY", retryAtMs: claim.retryAtMs };
  }
  if (claim.kind !== "CLAIMED") {
    failAEmotionProduction(ERROR.OUTBOX_CLAIM_INVALID, "claim.kind");
  }
  exactKeys(
    claim,
    ["kind", "outboxId", "fence", "attemptCount", "maxAttempts", "job"],
    "claim",
    ERROR.OUTBOX_CLAIM_INVALID,
  );
  nonEmpty(claim.outboxId, "claim.outboxId", ERROR.OUTBOX_CLAIM_INVALID);
  positiveInteger(claim.fence, "claim.fence", ERROR.OUTBOX_CLAIM_INVALID);
  nonNegativeInteger(claim.attemptCount, "claim.attemptCount", ERROR.OUTBOX_CLAIM_INVALID);
  positiveInteger(claim.maxAttempts, "claim.maxAttempts", ERROR.OUTBOX_CLAIM_INVALID);
  if (claim.attemptCount >= claim.maxAttempts) {
    failAEmotionProduction(ERROR.OUTBOX_CLAIM_INVALID, "claim.attemptCount", "EXHAUSTED");
  }
  return structuredClone(claim) as unknown as AEmotionAuthorityOutboxClaimV1;
}

export function validateAEmotionAuthorityOutboxJobV1(
  value: unknown,
): AEmotionAuthorityOutboxJobV1 {
  const job = object(value, "job", ERROR.OUTBOX_JOB_INVALID);
  exactKeys(
    job,
    ["schemaVersion", "sourceKind", "runId", "sourceId", "sourceCommitHash", "signalId", "jobHash"],
    "job",
    ERROR.OUTBOX_JOB_INVALID,
  );
  literal(job.schemaVersion, "a_emotion_authority_outbox_job_v1", "job.schemaVersion", ERROR.OUTBOX_JOB_INVALID);
  sourceKind(job.sourceKind, "job.sourceKind", ERROR.OUTBOX_JOB_INVALID);
  for (const key of ["runId", "sourceId", "signalId"] as const) {
    nonEmpty(job[key], `job.${key}`, ERROR.OUTBOX_JOB_INVALID);
  }
  sha(job.sourceCommitHash, "job.sourceCommitHash", ERROR.OUTBOX_JOB_INVALID);
  selfHash(job, "jobHash", "job", ERROR.OUTBOX_JOB_INVALID);
  return structuredClone(job) as unknown as AEmotionAuthorityOutboxJobV1;
}

export function validateAEmotionCommittedAuthoritySourceV1(
  value: unknown,
  job: Readonly<AEmotionAuthorityOutboxJobV1>,
): AEmotionCommittedAuthoritySourceV1 {
  const source = object(value, "source", ERROR.AUTHORITY_SOURCE_INVALID);
  exactKeys(source, [
    "schemaVersion", "sourceKind", "sourceId", "sourceCommitHash", "roomId", "runId",
    "stageId", "sourceActionId", "sourceSeatId", "committedAt", "eventSequence",
    "stateVersion", "storyDay", "signal", "sourceBindingHash",
  ], "source", ERROR.AUTHORITY_SOURCE_INVALID);
  literal(
    source.schemaVersion,
    "a_emotion_committed_authority_source_v1",
    "source.schemaVersion",
    ERROR.AUTHORITY_SOURCE_INVALID,
  );
  sourceKind(source.sourceKind, "source.sourceKind", ERROR.AUTHORITY_SOURCE_INVALID);
  for (const key of ["sourceId", "roomId", "runId", "stageId", "sourceActionId"] as const) {
    nonEmpty(source[key], `source.${key}`, ERROR.AUTHORITY_SOURCE_INVALID);
  }
  sha(source.sourceCommitHash, "source.sourceCommitHash", ERROR.AUTHORITY_SOURCE_INVALID);
  validateSeatIdV1(source.sourceSeatId, "source.sourceSeatId");
  timestamp(source.committedAt, "source.committedAt", ERROR.AUTHORITY_SOURCE_INVALID);
  positiveInteger(source.eventSequence, "source.eventSequence", ERROR.AUTHORITY_SOURCE_INVALID);
  positiveInteger(source.stateVersion, "source.stateVersion", ERROR.AUTHORITY_SOURCE_INVALID);
  positiveInteger(source.storyDay, "source.storyDay", ERROR.AUTHORITY_SOURCE_INVALID);
  if (source.sourceKind === "FINALE_COMMITTED") {
    if (source.stageId !== "FINALE") {
      failAEmotionProduction(ERROR.AUTHORITY_SOURCE_INVALID, "source.stageId", "FINALE_REQUIRED");
    }
  } else if (!/^N[1-7]$/u.test(String(source.stageId))) {
    failAEmotionProduction(ERROR.AUTHORITY_SOURCE_INVALID, "source.stageId", "N1_TO_N7_REQUIRED");
  }
  const signal = object(source.signal, "source.signal", ERROR.AUTHORITY_SOURCE_INVALID);
  exactKeys(signal, SIGNAL_KEYS, "source.signal", ERROR.AUTHORITY_SOURCE_INVALID);
  nonEmpty(signal.signalId, "source.signal.signalId", ERROR.AUTHORITY_SOURCE_INVALID);
  selfHash(source, "sourceBindingHash", "source", ERROR.AUTHORITY_SOURCE_INVALID);

  if (
    source.sourceKind !== job.sourceKind
    || source.sourceId !== job.sourceId
    || source.sourceCommitHash !== job.sourceCommitHash
    || source.runId !== job.runId
    || signal.signalId !== job.signalId
  ) {
    failAEmotionProduction(ERROR.AUTHORITY_BINDING_MISMATCH, "source", "JOB_SOURCE_MISMATCH");
  }
  return structuredClone(source) as unknown as AEmotionCommittedAuthoritySourceV1;
}

export function validateAEmotionViewerDeliveryContextsV1(
  value: unknown,
  event: Readonly<AEmotionInteractionEventPortV1>,
  sourceCommitHash: string,
): AEmotionViewerDeliveryContextV1[] {
  if (!Array.isArray(value)) {
    failAEmotionProduction(ERROR.VIEWER_CONTEXT_INVALID, "viewerContexts", "ARRAY");
  }
  const contexts = value.map((candidate, index) => {
    const path = `viewerContexts[${index}]`;
    const record = object(candidate, path, ERROR.VIEWER_CONTEXT_INVALID);
    exactKeys(record, ["viewer", "priorProjection", "priorAggregationKey", "contextHash"], path, ERROR.VIEWER_CONTEXT_INVALID);
    const viewer = validateViewer(record.viewer, `${path}.viewer`, event);
    const priorProjection = record.priorProjection === null
      ? null
      : validatePriorProjection(record.priorProjection, `${path}.priorProjection`, viewer, event);
    if (record.priorAggregationKey !== null) {
      nonEmpty(record.priorAggregationKey, `${path}.priorAggregationKey`, ERROR.VIEWER_CONTEXT_INVALID);
    }
    const priorAggregationKey = record.priorAggregationKey as string | null;
    if ((priorProjection === null) !== (priorAggregationKey === null)) {
      failAEmotionProduction(ERROR.VIEWER_CONTEXT_INVALID, `${path}.priorAggregationKey`, "PRIOR_PAIR");
    }
    sha(record.contextHash, `${path}.contextHash`, ERROR.VIEWER_CONTEXT_INVALID);
    const expectedHash = sha256Canonical({
      sourceCommitHash,
      viewer,
      priorProjectionHash: priorProjection?.projectionHash ?? null,
      priorAggregationKey,
    });
    if (record.contextHash !== expectedHash) {
      failAEmotionProduction(ERROR.VIEWER_CONTEXT_INVALID, `${path}.contextHash`, "HASH_MISMATCH");
    }
    return { viewer, priorProjection, priorAggregationKey, contextHash: record.contextHash };
  });
  const seatIds = contexts.map((context) => context.viewer.viewerSeatId);
  if (new Set(seatIds).size !== seatIds.length) {
    failAEmotionProduction(ERROR.VIEWER_CONTEXT_INVALID, "viewerContexts", "DUPLICATE_VIEWER_SEAT");
  }
  const order = new Map(PRESSURE_CHAPTER_SEAT_IDS_V1.map((seatId, index) => [seatId, index]));
  return contexts.sort((left, right) => (
    (order.get(left.viewer.viewerSeatId) ?? Number.MAX_SAFE_INTEGER)
    - (order.get(right.viewer.viewerSeatId) ?? Number.MAX_SAFE_INTEGER)
  ));
}

export function validateAEmotionPipelineReceiptV1(
  value: unknown,
  event: Readonly<AEmotionInteractionEventPortV1>,
  viewerSeatId: SeatIdV1,
): {
  eventStatus: "COMMITTED" | "REPLAYED";
  projectionStatus: "SKIPPED" | "COMMITTED" | "REPLAYED";
  projection: AEmotionViewerProjectionPortV1 | null;
} {
  const receipt = object(value, "pipelineReceipt", ERROR.PIPELINE_RECEIPT_INVALID);
  exactKeys(
    receipt,
    ["eventStatus", "projectionStatus", "projection"],
    "pipelineReceipt",
    ERROR.PIPELINE_RECEIPT_INVALID,
  );
  enumeration(receipt.eventStatus, ["COMMITTED", "REPLAYED"], "pipelineReceipt.eventStatus", ERROR.PIPELINE_RECEIPT_INVALID);
  enumeration(
    receipt.projectionStatus,
    ["SKIPPED", "COMMITTED", "REPLAYED"],
    "pipelineReceipt.projectionStatus",
    ERROR.PIPELINE_RECEIPT_INVALID,
  );
  if (receipt.projectionStatus === "SKIPPED") {
    if (receipt.projection !== null) {
      failAEmotionProduction(ERROR.PIPELINE_RECEIPT_INVALID, "pipelineReceipt.projection", "SKIPPED_REQUIRES_NULL");
    }
    return structuredClone(receipt) as ReturnType<typeof validateAEmotionPipelineReceiptV1>;
  }
  const projection = validateAEmotionViewerProjectionV1(receipt.projection);
  if (
    projection.eventId !== event.eventId
    || projection.roomId !== event.roomId
    || projection.runId !== event.runId
    || projection.viewerSeatId !== viewerSeatId
    || projection.projectionVersion !== 1
  ) {
    failAEmotionProduction(ERROR.PIPELINE_RECEIPT_INVALID, "pipelineReceipt.projection", "EVENT_VIEWER_MISMATCH");
  }
  return {
    eventStatus: receipt.eventStatus as "COMMITTED" | "REPLAYED",
    projectionStatus: receipt.projectionStatus as "COMMITTED" | "REPLAYED",
    projection: structuredClone(projection) as AEmotionViewerProjectionPortV1,
  };
}

function validateViewer(
  value: unknown,
  path: string,
  event: Readonly<AEmotionInteractionEventPortV1>,
): AEmotionViewerContextPortV1 {
  const viewer = object(value, path, ERROR.VIEWER_CONTEXT_INVALID);
  exactKeys(
    viewer,
    ["subjectId", "roomId", "runId", "viewerSeatId", "knownFactRefs", "authorizedEvidenceRefs"],
    path,
    ERROR.VIEWER_CONTEXT_INVALID,
  );
  for (const key of ["subjectId", "roomId", "runId"] as const) {
    nonEmpty(viewer[key], `${path}.${key}`, ERROR.VIEWER_CONTEXT_INVALID);
  }
  const viewerSeatId = validateSeatIdV1(viewer.viewerSeatId, `${path}.viewerSeatId`);
  if (viewer.roomId !== event.roomId || viewer.runId !== event.runId) {
    failAEmotionProduction(ERROR.VIEWER_CONTEXT_INVALID, path, "EVENT_CONTEXT_MISMATCH");
  }
  return {
    subjectId: viewer.subjectId as string,
    roomId: viewer.roomId as string,
    runId: viewer.runId as string,
    viewerSeatId,
    knownFactRefs: canonicalStrings(viewer.knownFactRefs, `${path}.knownFactRefs`),
    authorizedEvidenceRefs: canonicalStrings(viewer.authorizedEvidenceRefs, `${path}.authorizedEvidenceRefs`),
  };
}

function validatePriorProjection(
  value: unknown,
  path: string,
  viewer: AEmotionViewerContextPortV1,
  event: Readonly<AEmotionInteractionEventPortV1>,
): AEmotionViewerProjectionPortV1 {
  const projection = validateAEmotionViewerProjectionV1(value, path);
  if (
    projection.roomId !== event.roomId
    || projection.runId !== event.runId
    || projection.viewerSeatId !== viewer.viewerSeatId
  ) {
    failAEmotionProduction(ERROR.VIEWER_CONTEXT_INVALID, path, "PRIOR_CONTEXT_MISMATCH");
  }
  if (event.kind === "REVEAL" && projection.eventId !== event.revealOfEventId) {
    failAEmotionProduction(ERROR.VIEWER_CONTEXT_INVALID, path, "REVEAL_BASE_MISMATCH");
  }
  return structuredClone(projection) as AEmotionViewerProjectionPortV1;
}

function canonicalStrings(value: unknown, path: string): string[] {
  if (!Array.isArray(value)) failAEmotionProduction(ERROR.VIEWER_CONTEXT_INVALID, path, "ARRAY");
  const strings = value.map((item, index) => {
    nonEmpty(item, `${path}[${index}]`, ERROR.VIEWER_CONTEXT_INVALID);
    return item;
  });
  if (new Set(strings).size !== strings.length) {
    failAEmotionProduction(ERROR.VIEWER_CONTEXT_INVALID, path, "DUPLICATE_VALUE");
  }
  return [...strings].sort(compareText);
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function object(
  value: unknown,
  path: string,
  code: (typeof ERROR)[keyof typeof ERROR],
): RecordValue {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    failAEmotionProduction(code, path, "OBJECT");
  }
  return value as RecordValue;
}

function exactKeys(
  value: RecordValue,
  keys: readonly string[],
  path: string,
  code: (typeof ERROR)[keyof typeof ERROR],
): void {
  const unknown = Object.keys(value).find((key) => !keys.includes(key));
  if (unknown) failAEmotionProduction(code, `${path}.${unknown}`, "UNKNOWN_FIELD");
  const missing = keys.find((key) => !(key in value));
  if (missing) failAEmotionProduction(code, `${path}.${missing}`, "MISSING_FIELD");
}

function nonEmpty(
  value: unknown,
  path: string,
  code: (typeof ERROR)[keyof typeof ERROR],
): asserts value is string {
  if (typeof value !== "string" || value.trim().length === 0) {
    failAEmotionProduction(code, path, "NON_EMPTY_STRING");
  }
}

function literal(
  value: unknown,
  expected: string,
  path: string,
  code: (typeof ERROR)[keyof typeof ERROR],
): void {
  if (value !== expected) failAEmotionProduction(code, path, `EXPECTED_${expected}`);
}

function enumeration<T extends string>(
  value: unknown,
  allowed: readonly T[],
  path: string,
  code: (typeof ERROR)[keyof typeof ERROR],
): asserts value is T {
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    failAEmotionProduction(code, path, `ALLOWED_${allowed.join("|")}`);
  }
}

function sourceKind(
  value: unknown,
  path: string,
  code: (typeof ERROR)[keyof typeof ERROR],
): void {
  enumeration(value, A_EMOTION_AUTHORITY_SOURCE_KINDS_V1, path, code);
}

function positiveInteger(
  value: unknown,
  path: string,
  code: (typeof ERROR)[keyof typeof ERROR],
): asserts value is number {
  if (!Number.isSafeInteger(value) || Number(value) <= 0) {
    failAEmotionProduction(code, path, "POSITIVE_INTEGER");
  }
}

function nonNegativeInteger(
  value: unknown,
  path: string,
  code: (typeof ERROR)[keyof typeof ERROR],
): asserts value is number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    failAEmotionProduction(code, path, "NON_NEGATIVE_INTEGER");
  }
}

function timestamp(
  value: unknown,
  path: string,
  code: (typeof ERROR)[keyof typeof ERROR],
): void {
  nonEmpty(value, path, code);
  if (!Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) {
    failAEmotionProduction(code, path, "ISO_8601_UTC");
  }
}

function sha(
  value: unknown,
  path: string,
  code: (typeof ERROR)[keyof typeof ERROR],
): asserts value is string {
  if (!isSha256(value)) failAEmotionProduction(code, path, "SHA256_LOWER_HEX");
}

function selfHash(
  value: RecordValue,
  field: string,
  path: string,
  code: (typeof ERROR)[keyof typeof ERROR],
): void {
  sha(value[field], `${path}.${field}`, code);
  if (value[field] !== hashWithoutField(value, field)) {
    failAEmotionProduction(code, `${path}.${field}`, "HASH_MISMATCH");
  }
}
