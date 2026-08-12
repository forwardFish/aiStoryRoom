import type {
  AEmotionAggregateRecordV1,
  AEmotionDeliveryRecordV1,
  AEmotionFeedRepositoryPortV1,
  AEmotionProjectionCommitPortV1,
} from "./ports";
import {
  A_EMOTION_PROJECTION_VERSION_V1,
  hasValidAEmotionProjectionHashV1,
  isAEmotionProjectionIdentityV1,
  isSameAEmotionProjectionV1,
} from "./identity";
import {
  A_EMOTION_PROJECTION_ERROR_CODES as ERROR,
  failAEmotionProjection,
} from "./errors";

function scope(input: { roomId: string; runId: string; viewerSeatId: string }): string {
  return JSON.stringify([input.roomId, input.runId, input.viewerSeatId]);
}

function deliveryKey(input: {
  eventId: string;
  roomId: string;
  runId: string;
  viewerSeatId: string;
}): string {
  return JSON.stringify([input.roomId, input.runId, input.viewerSeatId, input.eventId]);
}

/** Deterministic repository fixture; production persistence is supplied by PC-W1 wiring. */
export class InMemoryAEmotionFeedRepositoryV1 implements AEmotionFeedRepositoryPortV1 {
  readonly aggregates = new Map<string, AEmotionAggregateRecordV1>();
  readonly deliveries = new Map<string, AEmotionDeliveryRecordV1>();
  readonly receipts = new Map<string, { fingerprint: string; aggregationKey: string }>();
  aggregateWrites = 0;
  deliveryWrites = 0;

  async readProjectionReceipt(idempotencyKey: string) {
    return structuredClone(this.receipts.get(idempotencyKey) ?? null);
  }

  async readAggregate(aggregationKey: string): Promise<AEmotionAggregateRecordV1 | null> {
    return structuredClone(this.aggregates.get(aggregationKey) ?? null);
  }

  async commitProjection(input: AEmotionProjectionCommitPortV1) {
    const record = {
      aggregationKey: input.aggregate.aggregationKey,
      latestEventId: input.aggregate.latestEventId,
      idempotencyKey: input.idempotencyKey,
      inputFingerprint: input.inputFingerprint,
      stageId: input.aggregate.stageId,
      sharedObjectId: input.aggregate.sharedObjectId,
      eventFamily: input.aggregate.eventFamily,
      projection: input.aggregate.projection,
    };
    if (
      input.aggregate.projectionVersion < A_EMOTION_PROJECTION_VERSION_V1
      || input.delivery.projectionVersion !== input.aggregate.projectionVersion
      || input.aggregate.projection.projectionVersion !== input.aggregate.projectionVersion
    ) {
      failAEmotionProjection(ERROR.PROJECTION_VERSION_UNSUPPORTED, input.aggregate.latestEventId);
    }
    if (!isAEmotionProjectionIdentityV1(record)) {
      failAEmotionProjection(ERROR.PROJECTION_IDENTITY_MISMATCH, input.aggregate.latestEventId);
    }
    if (!hasValidAEmotionProjectionHashV1(input.aggregate.projection)) {
      failAEmotionProjection(ERROR.PROJECTION_CONTENT_MISMATCH, input.aggregate.latestEventId);
    }
    const receipt = this.receipts.get(input.idempotencyKey);
    if (receipt) {
      if (receipt.fingerprint !== input.inputFingerprint) return { status: "IDEMPOTENCY_MISMATCH" as const };
      const aggregate = this.aggregates.get(receipt.aggregationKey);
      if (!aggregate) throw new Error("corrupt A-Emotion fixture receipt");
      if (
        aggregate.latestEventId === record.latestEventId
        && !isSameAEmotionProjectionV1({ stored: aggregate, incoming: record })
      ) {
        return { status: "IDEMPOTENCY_MISMATCH" as const };
      }
      return { status: "REPLAYED" as const, aggregate: structuredClone(aggregate) };
    }
    const current = this.aggregates.get(input.aggregate.aggregationKey);
    if (
      input.expectedAggregateVersion !== (current?.projectionVersion ?? 0)
      || (current && input.aggregate.projectionVersion !== current.projectionVersion + 1)
      || this.deliveries.has(deliveryKey(input.delivery))
    ) {
      return { status: "CONFLICT" as const };
    }
    this.aggregates.set(input.aggregate.aggregationKey, structuredClone(input.aggregate));
    this.deliveries.set(deliveryKey(input.delivery), structuredClone(input.delivery));
    this.receipts.set(input.idempotencyKey, {
      fingerprint: input.inputFingerprint,
      aggregationKey: input.aggregate.aggregationKey,
    });
    this.aggregateWrites += 1;
    this.deliveryWrites += 1;
    return { status: "COMMITTED" as const };
  }

  async listAggregates(input: Parameters<AEmotionFeedRepositoryPortV1["listAggregates"]>[0]) {
    const wanted = scope(input);
    return [...this.aggregates.values()]
      .filter((aggregate) => scope(aggregate) === wanted)
      .map((aggregate) => structuredClone(aggregate));
  }

  async listAggregatesAfterSequence(
    input: Parameters<AEmotionFeedRepositoryPortV1["listAggregatesAfterSequence"]>[0],
  ) {
    const all = (await this.listAggregates(input)).sort(
      (left, right) => left.projection.eventSequence - right.projection.eventSequence,
    );
    const eligible = all.filter(
      (aggregate) => aggregate.projection.eventSequence > input.afterSequence,
    );
    return {
      aggregates: eligible.slice(0, input.limit),
      hasMore: eligible.length > input.limit,
      currentServerSequence: all.reduce(
        (maximum, aggregate) => Math.max(maximum, aggregate.projection.eventSequence),
        0,
      ),
    };
  }

  async readDelivery(input: Parameters<AEmotionFeedRepositoryPortV1["readDelivery"]>[0]) {
    return structuredClone(this.deliveries.get(deliveryKey(input)) ?? null);
  }

  async updateDelivery(input: Parameters<AEmotionFeedRepositoryPortV1["updateDelivery"]>[0]) {
    const key = deliveryKey(input);
    const current = this.deliveries.get(key);
    if (!current) return null;
    const next = structuredClone(current);
    if (input.operation === "SEEN") next.seenAt ??= input.occurredAt;
    if (input.operation === "ACKNOWLEDGED") next.acknowledgedAt ??= input.occurredAt;
    if (input.operation === "RESOLVED") next.resolvedAt ??= input.occurredAt;
    if (input.operation === "MODAL_SHOWN") next.keyModalShownAt ??= input.occurredAt;
    this.deliveries.set(key, next);
    this.deliveryWrites += 1;
    return structuredClone(next);
  }
}
