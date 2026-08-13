import { Buffer } from "node:buffer";
import { type SeatIdV1 } from "@ai-story/shared";
import { compareAEmotionCanonicalText } from "./canonical-order";
import {
  A_EMOTION_PROJECTION_ERROR_CODES as ERROR,
  failAEmotionProjection,
} from "./errors";
import {
  A_EMOTION_PROJECTION_VERSION_V1,
  computeAEmotionProjectionHashV1,
  hasValidAEmotionProjectionHashV1,
  isAEmotionProjectionIdentityV1,
  isSameAEmotionProjectionV1,
} from "./identity";
import type {
  AEmotionAggregateRecordV1,
  AEmotionDeliveryRecordV1,
  AEmotionFeedRepositoryPortV1,
  AEmotionProjectionRecordV1,
  AEmotionViewerProjectionPortV1,
} from "./ports";

function assertProjectionRecordV1(record: AEmotionProjectionRecordV1): void {
  if (!Number.isSafeInteger(record.projection.projectionVersion) || record.projection.projectionVersion < A_EMOTION_PROJECTION_VERSION_V1) {
    failAEmotionProjection(
      ERROR.PROJECTION_VERSION_UNSUPPORTED,
      `${record.projection.eventId}:v${record.projection.projectionVersion}`,
    );
  }
  if (!hasValidAEmotionProjectionHashV1(record.projection)) {
    failAEmotionProjection(ERROR.PROJECTION_CONTENT_MISMATCH, `${record.projection.eventId}:HASH`);
  }
  if (!isAEmotionProjectionIdentityV1(record)) {
    failAEmotionProjection(ERROR.PROJECTION_IDENTITY_MISMATCH, record.projection.eventId);
  }
}

/** Creates or monotonically upgrades one causal event/viewer aggregate. */
export function createAEmotionAggregateV1(input: {
  current: AEmotionAggregateRecordV1 | null;
  record: AEmotionProjectionRecordV1;
  now: string;
}): AEmotionAggregateRecordV1 {
  const { current, record } = input;
  assertProjectionRecordV1(record);
  if (current) {
    if (
      current.aggregationKey !== record.aggregationKey
      || current.roomId !== record.projection.roomId
      || current.runId !== record.projection.runId
      || current.viewerSeatId !== record.projection.viewerSeatId
      || current.stageId !== record.stageId
      || current.sharedObjectId !== record.sharedObjectId
      || current.eventFamily !== record.eventFamily
      || record.projection.projectionVersion !== current.projectionVersion + 1
      || !isMonotonicDisclosure(current.projection.disclosure, record.projection.disclosure)
    ) failAEmotionProjection(ERROR.REPOSITORY_CONFLICT, `${record.aggregationKey}:NON_MONOTONIC`);
  }
  const incoming = structuredClone(record.projection);
  return {
    aggregationKey: record.aggregationKey,
    roomId: incoming.roomId,
    runId: incoming.runId,
    viewerSeatId: incoming.viewerSeatId,
    stageId: record.stageId,
    sharedObjectId: record.sharedObjectId,
    eventFamily: record.eventFamily,
    latestEventId: record.latestEventId,
    projectionVersion: incoming.projectionVersion,
    projection: incoming,
    createdAt: current?.createdAt ?? input.now,
    updatedAt: input.now,
  };
}

function isMonotonicDisclosure(
  from: AEmotionViewerProjectionPortV1["disclosure"],
  to: AEmotionViewerProjectionPortV1["disclosure"],
): boolean {
  return (from === "HIDDEN" && to === "SUSPECTED")
    || (from === "SUSPECTED" && to === "CONFIRMED");
}

function assertReplayMatches(
  record: AEmotionProjectionRecordV1,
  stored: AEmotionAggregateRecordV1,
): void {
  if (!isSameAEmotionProjectionV1({ stored, incoming: record })) {
    failAEmotionProjection(ERROR.PROJECTION_CONTENT_MISMATCH, record.idempotencyKey);
  }
}

function deliveryKey(input: {
  eventId: string;
  projectionVersion: number;
  viewerSeatId: SeatIdV1;
}): string {
  return `${input.eventId}:${input.projectionVersion}:${input.viewerSeatId}`;
}

function priorityRank(aggregate: AEmotionAggregateRecordV1, delivery: AEmotionDeliveryRecordV1 | null): number {
  const unresolved = delivery?.resolvedAt == null;
  const keyRelated = aggregate.projection.category === "RELATED"
    && unresolved
    && (
      aggregate.projection.centerCard !== null
      || aggregate.projection.severity === "CRITICAL"
      || aggregate.projection.keyModal !== null
    );
  if (!keyRelated) return 0;
  // Preserve the frozen modal order inside the "unresolved critical RELATED"
  // feed group: CRISIS 300 > PROMISE_BROKEN 200 > STAGE_VICTORY 100.
  return (aggregate.projection.keyModal?.priority ?? 0) + 1;
}

function compareFeedRows(
  left: { aggregate: AEmotionAggregateRecordV1; delivery: AEmotionDeliveryRecordV1 | null },
  right: { aggregate: AEmotionAggregateRecordV1; delivery: AEmotionDeliveryRecordV1 | null },
): number {
  return priorityRank(right.aggregate, right.delivery) - priorityRank(left.aggregate, left.delivery)
    || right.aggregate.projection.eventSequence - left.aggregate.projection.eventSequence
    || right.aggregate.projection.projectionVersion - left.aggregate.projection.projectionVersion
    || compareAEmotionCanonicalText(left.aggregate.aggregationKey, right.aggregate.aggregationKey);
}

interface CursorV1 {
  v: 1;
  roomId: string;
  runId: string;
  viewerSeatId: SeatIdV1;
  priority: number;
  eventSequence: number;
  projectionVersion: number;
  aggregationKey: string;
}

function encodeCursor(cursor: CursorV1): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

function decodeCursor(value: string, scope: Omit<CursorV1, "v" | "priority" | "eventSequence" | "projectionVersion" | "aggregationKey">): CursorV1 {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
  } catch {
    failAEmotionProjection(ERROR.CURSOR_INVALID, "MALFORMED");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    failAEmotionProjection(ERROR.CURSOR_INVALID, "NOT_OBJECT");
  }
  const record = parsed as Record<string, unknown>;
  const keys = ["v", "roomId", "runId", "viewerSeatId", "priority", "eventSequence", "projectionVersion", "aggregationKey"];
  if (Object.keys(record).length !== keys.length || keys.some((key) => !(key in record))) {
    failAEmotionProjection(ERROR.CURSOR_INVALID, "FIELDS");
  }
  if (
    record.v !== 1
    || record.roomId !== scope.roomId
    || record.runId !== scope.runId
    || record.viewerSeatId !== scope.viewerSeatId
    || !Number.isSafeInteger(record.priority)
    || !Number.isSafeInteger(record.eventSequence)
    || !Number.isSafeInteger(record.projectionVersion)
    || typeof record.aggregationKey !== "string"
  ) failAEmotionProjection(ERROR.CURSOR_INVALID, "SCOPE_OR_VALUES");
  return record as unknown as CursorV1;
}

function isAfterCursor(
  row: { aggregate: AEmotionAggregateRecordV1; delivery: AEmotionDeliveryRecordV1 | null },
  cursor: CursorV1,
): boolean {
  const rank = priorityRank(row.aggregate, row.delivery);
  if (rank !== cursor.priority) return rank < cursor.priority;
  if (row.aggregate.projection.eventSequence !== cursor.eventSequence) {
    return row.aggregate.projection.eventSequence < cursor.eventSequence;
  }
  if (row.aggregate.projection.projectionVersion !== cursor.projectionVersion) {
    return row.aggregate.projection.projectionVersion < cursor.projectionVersion;
  }
  return compareAEmotionCanonicalText(row.aggregate.aggregationKey, cursor.aggregationKey) > 0;
}

export class AEmotionFeedServiceV1 {
  constructor(private readonly repository: AEmotionFeedRepositoryPortV1) {}

  async ingest(record: AEmotionProjectionRecordV1, now: string): Promise<{
    status: "COMMITTED" | "REPLAYED";
    aggregate: AEmotionAggregateRecordV1;
  }> {
    assertProjectionRecordV1(record);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const receipt = await this.repository.readProjectionReceipt(record.idempotencyKey);
      if (receipt) {
        if (receipt.fingerprint !== record.inputFingerprint) {
          failAEmotionProjection(ERROR.IDEMPOTENCY_MISMATCH, record.idempotencyKey);
        }
        if (receipt.aggregationKey !== record.aggregationKey) {
          failAEmotionProjection(ERROR.PROJECTION_IDENTITY_MISMATCH, record.idempotencyKey);
        }
        const replayed = await this.repository.readAggregate(receipt.aggregationKey);
        if (!replayed) failAEmotionProjection(ERROR.REPOSITORY_CONFLICT, receipt.aggregationKey);
        if (replayed.latestEventId === record.latestEventId) assertReplayMatches(record, replayed);
        else if (replayed.projectionVersion < record.projection.projectionVersion) {
          failAEmotionProjection(ERROR.REPOSITORY_CONFLICT, record.aggregationKey);
        }
        return { status: "REPLAYED", aggregate: replayed };
      }
      const current = await this.repository.readAggregate(record.aggregationKey);
      const aggregate = createAEmotionAggregateV1({ current, record, now });
      const delivery: AEmotionDeliveryRecordV1 = {
        eventId: aggregate.projection.eventId,
        projectionVersion: aggregate.projection.projectionVersion,
        roomId: aggregate.roomId,
        runId: aggregate.runId,
        viewerSeatId: aggregate.viewerSeatId,
        deliveredAt: now,
        seenAt: null,
        acknowledgedAt: null,
        resolvedAt: null,
        keyModalShownAt: null,
      };
      const result = await this.repository.commitProjection({
        idempotencyKey: record.idempotencyKey,
        inputFingerprint: record.inputFingerprint,
        expectedAggregateVersion: current?.projectionVersion ?? 0,
        aggregate,
        delivery,
      });
      if (result.status === "COMMITTED") return { status: "COMMITTED", aggregate };
      if (result.status === "REPLAYED") {
        assertReplayMatches(record, result.aggregate);
        return { status: "REPLAYED", aggregate: result.aggregate };
      }
      if (result.status === "IDEMPOTENCY_MISMATCH") {
        failAEmotionProjection(ERROR.IDEMPOTENCY_MISMATCH, record.idempotencyKey);
      }
    }
    failAEmotionProjection(ERROR.REPOSITORY_CONFLICT, record.aggregationKey);
  }

  async list(input: {
    roomId: string;
    runId: string;
    viewerSeatId: SeatIdV1;
    cursor?: string | null;
    limit?: number;
  }): Promise<{
    schemaVersion: "a_emotion_feed_page_v1";
    roomId: string;
    runId: string;
    viewerSeatId: SeatIdV1;
    items: Array<AEmotionViewerProjectionPortV1 & {
      isUnread: boolean;
      isAcknowledged: boolean;
      isResolved: boolean;
    }>;
    unreadCount: number;
    nextCursor: string | null;
    serverSequence: number;
  }> {
    const limit = Math.min(10, Math.max(1, input.limit ?? 10));
    const aggregates = await this.repository.listAggregates(input);
    const rows = await Promise.all(aggregates.map(async (aggregate) => ({
      aggregate,
      delivery: await this.repository.readDelivery({
        eventId: aggregate.projection.eventId,
        projectionVersion: aggregate.projection.projectionVersion,
        roomId: input.roomId,
        runId: input.runId,
        viewerSeatId: input.viewerSeatId,
      }),
    })));
    const missingDelivery = rows.find((row) => row.delivery === null);
    if (missingDelivery) {
      failAEmotionProjection(ERROR.REPOSITORY_CONFLICT, `${missingDelivery.aggregate.aggregationKey}:DELIVERY_MISSING`);
    }
    rows.sort(compareFeedRows);
    const unreadCount = rows.filter((row) => row.delivery?.seenAt === null).length;
    const cursor = input.cursor ? decodeCursor(input.cursor, input) : null;
    const eligible = cursor ? rows.filter((row) => isAfterCursor(row, cursor)) : rows;
    const selected = eligible.slice(0, limit);
    const hasMore = eligible.length > selected.length;
    const last = selected.at(-1);
    const items = selected.map(({ aggregate, delivery }) => ({
      ...toDeliveryProjection(aggregate.projection, delivery!),
      isUnread: delivery?.seenAt === null,
      isAcknowledged: delivery?.acknowledgedAt !== null && delivery?.acknowledgedAt !== undefined,
      isResolved: delivery?.resolvedAt !== null && delivery?.resolvedAt !== undefined,
    }));
    const nextCursor = hasMore && last ? encodeCursor({
      v: 1,
      roomId: input.roomId,
      runId: input.runId,
      viewerSeatId: input.viewerSeatId,
      priority: priorityRank(last.aggregate, last.delivery),
      eventSequence: last.aggregate.projection.eventSequence,
      projectionVersion: last.aggregate.projection.projectionVersion,
      aggregationKey: last.aggregate.aggregationKey,
    }) : null;
    return {
      schemaVersion: "a_emotion_feed_page_v1",
      roomId: input.roomId,
      runId: input.runId,
      viewerSeatId: input.viewerSeatId,
      items,
      unreadCount,
      nextCursor,
      serverSequence: rows.reduce((maximum, row) => Math.max(maximum, row.aggregate.projection.eventSequence), 0),
    };
  }

  async listAfterSequence(input: {
    roomId: string;
    runId: string;
    viewerSeatId: SeatIdV1;
    afterSequence: number;
    limit?: number;
  }): Promise<{
    schemaVersion: "a_emotion_monotonic_delivery_page_v1";
    roomId: string;
    runId: string;
    viewerSeatId: SeatIdV1;
    items: Array<AEmotionViewerProjectionPortV1 & {
      isUnread: boolean;
      isAcknowledged: boolean;
      isResolved: boolean;
    }>;
    unreadCount: number;
    afterSequence: number;
    nextAfterSequence: number;
    hasMore: boolean;
    currentServerSequence: number;
  }> {
    if (!Number.isSafeInteger(input.afterSequence) || input.afterSequence < 0) {
      failAEmotionProjection(ERROR.CURSOR_INVALID, "afterSequence");
    }
    const limit = input.limit ?? 20;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50) {
      failAEmotionProjection(ERROR.CURSOR_INVALID, "limit");
    }
    const page = await this.repository.listAggregatesAfterSequence({
      roomId: input.roomId,
      runId: input.runId,
      viewerSeatId: input.viewerSeatId,
      afterSequence: input.afterSequence,
      limit,
    });
    if (
      !Number.isSafeInteger(page.currentServerSequence)
      || page.currentServerSequence < 0
      || page.aggregates.length > limit
      || (page.hasMore && page.aggregates.length !== limit)
    ) {
      failAEmotionProjection(ERROR.REPOSITORY_CONFLICT, "MONOTONIC_PAGE_INVALID");
    }
    let priorSequence = input.afterSequence;
    for (const aggregate of page.aggregates) {
      if (
        aggregate.roomId !== input.roomId
        || aggregate.runId !== input.runId
        || aggregate.viewerSeatId !== input.viewerSeatId
        || aggregate.projection.eventSequence <= priorSequence
        || aggregate.projection.eventSequence > page.currentServerSequence
      ) {
        failAEmotionProjection(ERROR.REPOSITORY_CONFLICT, "MONOTONIC_SCOPE_OR_ORDER");
      }
      priorSequence = aggregate.projection.eventSequence;
    }
    if (page.hasMore && priorSequence >= page.currentServerSequence) {
      failAEmotionProjection(ERROR.REPOSITORY_CONFLICT, "MONOTONIC_HAS_MORE_INVALID");
    }
    const selectedRows = await hydrateDeliveryRows(this.repository, input, page.aggregates);
    const allRows = await hydrateDeliveryRows(
      this.repository,
      input,
      await this.repository.listAggregates(input),
    );
    return {
      schemaVersion: "a_emotion_monotonic_delivery_page_v1",
      roomId: input.roomId,
      runId: input.runId,
      viewerSeatId: input.viewerSeatId,
      items: selectedRows.map(({ aggregate, delivery }) => ({
        ...toDeliveryProjection(aggregate.projection, delivery),
        isUnread: delivery.seenAt === null,
        isAcknowledged: delivery.acknowledgedAt !== null,
        isResolved: delivery.resolvedAt !== null,
      })),
      unreadCount: allRows.filter(({ delivery }) => delivery.seenAt === null).length,
      afterSequence: input.afterSequence,
      nextAfterSequence: priorSequence,
      hasMore: page.hasMore,
      currentServerSequence: page.currentServerSequence,
    };
  }

  async mark(input: {
    eventId: string;
    projectionVersion: number;
    roomId: string;
    runId: string;
    viewerSeatId: SeatIdV1;
    operation: "SEEN" | "ACKNOWLEDGED" | "RESOLVED" | "MODAL_SHOWN";
    occurredAt: string;
  }): Promise<AEmotionDeliveryRecordV1> {
    if (!Number.isSafeInteger(input.projectionVersion) || input.projectionVersion < A_EMOTION_PROJECTION_VERSION_V1) {
      failAEmotionProjection(ERROR.PROJECTION_VERSION_UNSUPPORTED, deliveryKey(input));
    }
    const existing = await this.repository.readDelivery(input);
    if (!existing) failAEmotionProjection(ERROR.DELIVERY_NOT_FOUND, deliveryKey(input));
    if (existing.projectionVersion !== input.projectionVersion) {
      failAEmotionProjection(ERROR.PROJECTION_VERSION_STALE, deliveryKey(input));
    }
    const updated = await this.repository.updateDelivery(input);
    if (!updated) failAEmotionProjection(ERROR.DELIVERY_NOT_FOUND, deliveryKey(input));
    return updated;
  }
}

function toDeliveryProjection(
  source: AEmotionViewerProjectionPortV1,
  delivery: AEmotionDeliveryRecordV1,
): AEmotionViewerProjectionPortV1 {
  const projection = structuredClone(source);
  if (delivery.keyModalShownAt !== null && projection.keyModal !== null) {
    // A modal is a one-shot delivery surface. Its central card remains in the
    // feed after dismissal, so refresh/retry can never resurrect the modal.
    projection.keyModal = null;
    projection.recommendedPresentation = "CENTER_CARD";
    projection.projectionHash = computeAEmotionProjectionHashV1(projection);
  }
  return projection;
}

async function hydrateDeliveryRows(
  repository: AEmotionFeedRepositoryPortV1,
  scope: { roomId: string; runId: string; viewerSeatId: SeatIdV1 },
  aggregates: AEmotionAggregateRecordV1[],
): Promise<Array<{ aggregate: AEmotionAggregateRecordV1; delivery: AEmotionDeliveryRecordV1 }>> {
  return Promise.all(aggregates.map(async (aggregate) => {
    const delivery = await repository.readDelivery({
      eventId: aggregate.projection.eventId,
      projectionVersion: aggregate.projection.projectionVersion,
      roomId: scope.roomId,
      runId: scope.runId,
      viewerSeatId: scope.viewerSeatId,
    });
    if (!delivery) {
      return failAEmotionProjection(
        ERROR.REPOSITORY_CONFLICT,
        `${aggregate.aggregationKey}:DELIVERY_MISSING`,
      );
    }
    return { aggregate, delivery };
  }));
}
