import { type SeatIdV1 } from "@ai-story/shared";
import {
  validateAEmotionInteractionEventV1,
  validateAEmotionViewerProjectionV1,
} from "@ai-story/shared/pressure-chapter/a-emotion";
import type {
  AEmotionAggregateRecordV1,
  AEmotionDeliveryRecordV1,
  AEmotionInteractionEventPortV1,
  AEmotionProjectionCommitPortV1,
} from "../a-emotion/ports";
import {
  A_EMOTION_PROJECTION_VERSION_V1,
  aEmotionProjectionIdempotencyKey,
  isAEmotionProjectionIdentityV1,
} from "../a-emotion/identity";
import type {
  AEmotionAggregateEnvelopeV1,
  AEmotionDeliverySeedV1,
} from "./contracts";
import {
  A_EMOTION_PERSISTENCE_ERROR_CODES as ERROR,
  failAEmotionPersistence,
} from "./errors";

const STORY_EVENT_SCHEMA = "pressure_a_emotion_story_event_v1";
const DELIVERY_SCHEMA = "pressure_a_emotion_delivery_seed_v1";

interface InteractionEnvelopeV1 {
  schemaVersion: typeof STORY_EVENT_SCHEMA;
  kind: "INTERACTION";
  storyDay: number;
  event: AEmotionInteractionEventPortV1;
}

interface AggregateEnvelopeRowV1 {
  schemaVersion: typeof STORY_EVENT_SCHEMA;
  kind: "AGGREGATE";
  storyDay: number;
  idempotencyKey: string;
  inputFingerprint: string;
  expectedAggregateVersion: number;
  aggregate: AEmotionAggregateRecordV1;
  delivery: AEmotionDeliverySeedV1;
}

interface DeliveryMarkEnvelopeV1 {
  schemaVersion: typeof STORY_EVENT_SCHEMA;
  kind: "DELIVERY_MARK";
  storyDay: number;
  roomId: string;
  runId: string;
  viewerSeatId: SeatIdV1;
  eventId: string;
  projectionVersion: number;
  operation: "SEEN" | "ACKNOWLEDGED" | "RESOLVED" | "MODAL_SHOWN";
  occurredAt: string;
}

interface DeliverySeedEnvelopeV1 {
  schemaVersion: typeof DELIVERY_SCHEMA;
  kind: "A_EMOTION_DELIVERY";
  viewerSeatId: SeatIdV1;
  projectionVersion: number;
  aggregationKey: string;
  storyDay: number;
}

export function encodeInteractionEnvelope(input: {
  event: AEmotionInteractionEventPortV1;
  storyDay: number;
}): InteractionEnvelopeV1 {
  return {
    schemaVersion: STORY_EVENT_SCHEMA,
    kind: "INTERACTION",
    storyDay: input.storyDay,
    event: structuredClone(input.event),
  };
}

export function decodeInteractionEnvelope(value: unknown): {
  storyDay: number;
  event: AEmotionInteractionEventPortV1;
} {
  const record = object(value, "interactionEnvelope");
  if (record.schemaVersion !== STORY_EVENT_SCHEMA || record.kind !== "INTERACTION") {
    invalid("interaction envelope kind mismatch", { value: record.kind });
  }
  return {
    storyDay: integer(record.storyDay, "storyDay"),
    event: validateAEmotionInteractionEventV1(record.event),
  };
}

export function encodeAggregateEnvelope(value: AEmotionAggregateEnvelopeV1): AggregateEnvelopeRowV1 {
  assertAEmotionProjectionCommitV1(value.commit);
  const delivery = withDeliveryEventId(
    encodeDeliverySeed({
      eventId: value.commit.delivery.eventId,
      projectionVersion: value.commit.delivery.projectionVersion,
      viewerSeatId: value.commit.delivery.viewerSeatId,
      aggregationKey: value.commit.aggregate.aggregationKey,
      storyDay: value.storyDay,
    }),
    value.commit.delivery.eventId,
  );
  return {
    schemaVersion: STORY_EVENT_SCHEMA,
    kind: "AGGREGATE",
    storyDay: value.storyDay,
    idempotencyKey: value.idempotencyKey,
    inputFingerprint: value.inputFingerprint,
    expectedAggregateVersion: value.expectedAggregateVersion,
    aggregate: structuredClone(value.commit.aggregate),
    delivery,
  };
}

export function decodeAggregateEnvelope(value: unknown): AEmotionAggregateEnvelopeV1 {
  const record = object(value, "aggregateEnvelope");
  if (record.schemaVersion !== STORY_EVENT_SCHEMA || record.kind !== "AGGREGATE") {
    invalid("aggregate envelope kind mismatch", { value: record.kind });
  }
  const aggregate = decodeAggregateRecord(record.aggregate);
  const delivery = decodeDeliverySeed(record.delivery);
  const idempotencyKey = text(record.idempotencyKey, "idempotencyKey");
  const inputFingerprint = text(record.inputFingerprint, "inputFingerprint");
  const expectedAggregateVersion = integer(record.expectedAggregateVersion, "expectedAggregateVersion");
  if (
    aggregate.aggregationKey !== delivery.aggregationKey
    || aggregate.projection.eventId !== delivery.eventId
    || aggregate.projection.projectionVersion !== delivery.projectionVersion
    || aggregate.viewerSeatId !== delivery.viewerSeatId
  ) {
    invalid("aggregate and delivery seed diverged", {
      aggregationKey: aggregate.aggregationKey,
      deliveryAggregationKey: delivery.aggregationKey,
    });
  }
  const decoded: AEmotionAggregateEnvelopeV1 = {
    idempotencyKey,
    inputFingerprint,
    expectedAggregateVersion,
    storyDay: integer(record.storyDay, "storyDay"),
    commit: {
      idempotencyKey,
      inputFingerprint,
      expectedAggregateVersion,
      aggregate,
      delivery: deliverySeedToRecord(aggregate, delivery),
    },
  };
  assertAEmotionProjectionCommitV1(decoded.commit);
  return decoded;
}

export function encodeDeliverySeed(value: AEmotionDeliverySeedV1): DeliverySeedEnvelopeV1 {
  assertAEmotionProjectionVersionV1(value.projectionVersion, "deliverySeed.projectionVersion");
  return {
    schemaVersion: DELIVERY_SCHEMA,
    kind: "A_EMOTION_DELIVERY",
    viewerSeatId: value.viewerSeatId,
    projectionVersion: value.projectionVersion,
    aggregationKey: value.aggregationKey,
    storyDay: value.storyDay,
  };
}

export function decodeDeliverySeed(value: unknown): AEmotionDeliverySeedV1 {
  const record = object(value, "deliverySeed");
  if (record.schemaVersion !== DELIVERY_SCHEMA || record.kind !== "A_EMOTION_DELIVERY") {
    invalid("delivery seed schema mismatch", { value: record.kind });
  }
  const decoded = {
    eventId: text((record as Record<string, unknown>).eventId ?? "", "eventId", true),
    projectionVersion: integer(record.projectionVersion, "projectionVersion"),
    viewerSeatId: text(record.viewerSeatId, "viewerSeatId") as SeatIdV1,
    aggregationKey: text(record.aggregationKey, "aggregationKey"),
    storyDay: integer(record.storyDay, "storyDay"),
  };
  assertAEmotionProjectionVersionV1(decoded.projectionVersion, "deliverySeed.projectionVersion");
  return decoded;
}

export function withDeliveryEventId(
  value: DeliverySeedEnvelopeV1,
  eventId: string,
): DeliverySeedEnvelopeV1 & { eventId: string } {
  return { ...value, eventId };
}

export function encodeDeliveryMark(input: {
  storyDay: number;
  roomId: string;
  runId: string;
  viewerSeatId: SeatIdV1;
  eventId: string;
  projectionVersion: number;
  operation: "SEEN" | "ACKNOWLEDGED" | "RESOLVED" | "MODAL_SHOWN";
  occurredAt: string;
}): DeliveryMarkEnvelopeV1 {
  assertAEmotionProjectionVersionV1(input.projectionVersion, "deliveryMark.projectionVersion");
  return {
    schemaVersion: STORY_EVENT_SCHEMA,
    kind: "DELIVERY_MARK",
    storyDay: input.storyDay,
    roomId: input.roomId,
    runId: input.runId,
    viewerSeatId: input.viewerSeatId,
    eventId: input.eventId,
    projectionVersion: input.projectionVersion,
    operation: input.operation,
    occurredAt: input.occurredAt,
  };
}

export function decodeDeliveryMark(value: unknown): DeliveryMarkEnvelopeV1 {
  const record = object(value, "deliveryMark");
  if (record.schemaVersion !== STORY_EVENT_SCHEMA || record.kind !== "DELIVERY_MARK") {
    invalid("delivery mark kind mismatch", { value: record.kind });
  }
  const decoded: DeliveryMarkEnvelopeV1 = {
    schemaVersion: STORY_EVENT_SCHEMA,
    kind: "DELIVERY_MARK",
    storyDay: integer(record.storyDay, "storyDay"),
    roomId: text(record.roomId, "roomId"),
    runId: text(record.runId, "runId"),
    viewerSeatId: text(record.viewerSeatId, "viewerSeatId") as SeatIdV1,
    eventId: text(record.eventId, "eventId"),
    projectionVersion: integer(record.projectionVersion, "projectionVersion"),
    operation: deliveryOperation(record.operation),
    occurredAt: text(record.occurredAt, "occurredAt"),
  };
  assertAEmotionProjectionVersionV1(decoded.projectionVersion, "deliveryMark.projectionVersion");
  return decoded;
}

export function deliverySeedToRecord(
  aggregate: AEmotionAggregateRecordV1,
  seed: AEmotionDeliverySeedV1,
): AEmotionDeliveryRecordV1 {
  assertAEmotionProjectionVersionV1(seed.projectionVersion, "delivery.projectionVersion");
  return {
    eventId: seed.eventId,
    projectionVersion: seed.projectionVersion,
    roomId: aggregate.roomId,
    runId: aggregate.runId,
    viewerSeatId: seed.viewerSeatId,
    deliveredAt: aggregate.updatedAt,
    seenAt: null,
    acknowledgedAt: null,
    resolvedAt: null,
    keyModalShownAt: null,
  };
}

function decodeAggregateRecord(value: unknown): AEmotionAggregateRecordV1 {
  const record = object(value, "aggregate");
  const projection = validateAEmotionViewerProjectionV1(record.projection);
  const decoded: AEmotionAggregateRecordV1 = {
    aggregationKey: text(record.aggregationKey, "aggregationKey"),
    roomId: text(record.roomId, "roomId"),
    runId: text(record.runId, "runId"),
    viewerSeatId: text(record.viewerSeatId, "viewerSeatId") as SeatIdV1,
    stageId: text(record.stageId, "stageId"),
    sharedObjectId: nullableText(record.sharedObjectId, "sharedObjectId"),
    eventFamily: text(record.eventFamily, "eventFamily"),
    latestEventId: text(record.latestEventId, "latestEventId"),
    projectionVersion: integer(record.projectionVersion, "projectionVersion"),
    projection,
    createdAt: text(record.createdAt, "createdAt"),
    updatedAt: text(record.updatedAt, "updatedAt"),
  };
  assertAEmotionProjectionVersionV1(decoded.projectionVersion, "aggregate.projectionVersion");
  assertAEmotionProjectionVersionV1(decoded.projection.projectionVersion, "aggregate.projection.projectionVersion");
  if (
    decoded.latestEventId !== decoded.projection.eventId
    || decoded.roomId !== decoded.projection.roomId
    || decoded.runId !== decoded.projection.runId
    || decoded.viewerSeatId !== decoded.projection.viewerSeatId
    || !isAEmotionProjectionIdentityV1({
      aggregationKey: decoded.aggregationKey,
      latestEventId: decoded.latestEventId,
      idempotencyKey: aEmotionProjectionIdempotencyKey({
        eventId: decoded.latestEventId,
        viewerSeatId: decoded.viewerSeatId,
      }),
      inputFingerprint: decoded.projection.projectionHash,
      stageId: decoded.stageId,
      sharedObjectId: decoded.sharedObjectId,
      eventFamily: decoded.eventFamily,
      projection: decoded.projection,
    })
  ) {
    invalid("aggregate identity is not causal-chain scoped", { aggregationKey: decoded.aggregationKey });
  }
  return decoded;
}

export function assertAEmotionProjectionCommitV1(
  input: AEmotionProjectionCommitPortV1,
): void {
  assertAEmotionProjectionVersionV1(input.aggregate.projectionVersion, "aggregate.projectionVersion");
  assertAEmotionProjectionVersionV1(input.aggregate.projection.projectionVersion, "projection.projectionVersion");
  assertAEmotionProjectionVersionV1(input.delivery.projectionVersion, "delivery.projectionVersion");
  validateAEmotionViewerProjectionV1(input.aggregate.projection);
  const expectedIdempotencyKey = aEmotionProjectionIdempotencyKey({
    eventId: input.aggregate.projection.eventId,
    viewerSeatId: input.aggregate.viewerSeatId,
  });
  if (
    input.expectedAggregateVersion !== input.aggregate.projectionVersion - 1
    || input.idempotencyKey !== expectedIdempotencyKey
    || input.aggregate.latestEventId !== input.aggregate.projection.eventId
    || input.aggregate.roomId !== input.aggregate.projection.roomId
    || input.aggregate.runId !== input.aggregate.projection.runId
    || input.aggregate.viewerSeatId !== input.aggregate.projection.viewerSeatId
    || input.delivery.eventId !== input.aggregate.projection.eventId
    || input.delivery.roomId !== input.aggregate.roomId
    || input.delivery.runId !== input.aggregate.runId
    || input.delivery.viewerSeatId !== input.aggregate.viewerSeatId
    || !isAEmotionProjectionIdentityV1({
      aggregationKey: input.aggregate.aggregationKey,
      latestEventId: input.aggregate.latestEventId,
      idempotencyKey: input.idempotencyKey,
      inputFingerprint: input.inputFingerprint,
      stageId: input.aggregate.stageId,
      sharedObjectId: input.aggregate.sharedObjectId,
      eventFamily: input.aggregate.eventFamily,
      projection: input.aggregate.projection,
    })
  ) {
    invalid("projection commit identity diverged", {
      eventId: input.aggregate.projection.eventId,
      aggregationKey: input.aggregate.aggregationKey,
    });
  }
}

export function assertAEmotionProjectionVersionV1(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value < A_EMOTION_PROJECTION_VERSION_V1) {
    failAEmotionPersistence(
      ERROR.DELIVERY_VERSION_UNSUPPORTED,
      "A-Emotion projectionVersion must be a positive monotonic integer",
      { field, projectionVersion: value },
    );
  }
}

function deliveryOperation(
  value: unknown,
): "SEEN" | "ACKNOWLEDGED" | "RESOLVED" | "MODAL_SHOWN" {
  if (
    value === "SEEN"
    || value === "ACKNOWLEDGED"
    || value === "RESOLVED"
    || value === "MODAL_SHOWN"
  ) {
    return value;
  }
  invalid("delivery operation is invalid", { value });
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    invalid(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function text(value: unknown, field: string, allowEmpty = false): string {
  if (typeof value !== "string" || (!allowEmpty && !value.trim())) {
    invalid(`${field} must be a non-empty string`, { field });
  }
  return value;
}

function nullableText(value: unknown, field: string): string | null {
  if (value === null) return null;
  return text(value, field);
}

function integer(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value)) invalid(`${field} must be a safe integer`, { field });
  return value as number;
}

function invalid(message: string, details: Record<string, unknown> = {}): never {
  failAEmotionPersistence(ERROR.RECORD_INVALID, message, details);
}
