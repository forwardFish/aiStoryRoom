import { Prisma } from "@prisma/client";
import type { SeatIdV1 } from "@ai-story/shared";
import type {
  AEmotionDeliveryRecordV1,
  AEmotionFeedRepositoryPortV1,
  AEmotionInteractionEventPortV1,
  AEmotionProjectionCommitPortV1,
  AEmotionProjectionRecordV1,
} from "../a-emotion/ports";
import { isSameAEmotionProjectionV1 } from "../a-emotion/identity";
import {
  assertAEmotionProjectionCommitV1,
  assertAEmotionProjectionVersionV1,
  decodeAggregateEnvelope,
  decodeDeliveryMark,
  decodeDeliverySeed,
  decodeInteractionEnvelope,
  deliverySeedToRecord,
  encodeAggregateEnvelope,
  encodeDeliveryMark,
  encodeDeliverySeed,
  encodeInteractionEnvelope,
  withDeliveryEventId,
} from "./codec";
import type {
  AEmotionInteractionJournalPortV1,
  AEmotionSeatDeliveryBindingPortV1,
  AEmotionStoryDayPortV1,
} from "./contracts";
import {
  A_EMOTION_PERSISTENCE_ERROR_CODES as ERROR,
  failAEmotionPersistence,
} from "./errors";
import {
  isUniqueConflict,
  pressureSerializableTransaction,
  type PressureSerializableClient,
} from "../persistence/transaction";

const INTERACTION_EVENT_TYPE = "PRESSURE_A_EMOTION_INTERACTION_V1";
const AGGREGATE_EVENT_TYPE = "PRESSURE_A_EMOTION_AGGREGATE_V1";
const DELIVERY_MARK_EVENT_TYPE = "PRESSURE_A_EMOTION_DELIVERY_MARK_V1";

interface StoryEventRow {
  id: string;
  runId: string;
  day: number;
  type: string;
  payloadJson: unknown;
  sequence: number | null;
  dedupeKey: string | null;
  createdAt: Date;
}

interface EventDeliveryRow {
  id: string;
  eventId: string;
  roomId: string;
  userId: string;
  roleId: string | null;
  deliverySequence: number;
  payloadJson: unknown;
  deliveredAt: Date;
}

interface StoryEventCursorRow {
  runId: string;
  nextSequence: number;
  version: number;
}

interface EventDeliveryCursorRow {
  roomId: string;
  userId: string;
  nextSequence: number;
  version: number;
}

interface AEmotionTransaction {
  storyEvent: {
    findMany(input: Record<string, unknown>): Promise<StoryEventRow[]>;
    findUnique(input: Record<string, unknown>): Promise<StoryEventRow | null>;
    create(input: { data: Record<string, unknown> }): Promise<StoryEventRow>;
  };
  storyEventCursor: {
    findUnique(input: Record<string, unknown>): Promise<StoryEventCursorRow | null>;
    create(input: { data: Record<string, unknown> }): Promise<StoryEventCursorRow>;
    update(input: {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    }): Promise<StoryEventCursorRow>;
  };
  eventDelivery: {
    findMany(input: Record<string, unknown>): Promise<EventDeliveryRow[]>;
    findUnique(input: Record<string, unknown>): Promise<EventDeliveryRow | null>;
    create(input: { data: Record<string, unknown> }): Promise<EventDeliveryRow>;
  };
  eventDeliveryCursor: {
    findUnique(input: Record<string, unknown>): Promise<EventDeliveryCursorRow | null>;
    create(input: { data: Record<string, unknown> }): Promise<EventDeliveryCursorRow>;
    update(input: {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    }): Promise<EventDeliveryCursorRow>;
  };
}

export type AEmotionPersistencePrismaClient =
  PressureSerializableClient<AEmotionTransaction>;

export class PrismaAEmotionInteractionJournalV1
implements AEmotionInteractionJournalPortV1 {
  constructor(private readonly prisma: AEmotionPersistencePrismaClient) {}

  async readCommitted(idempotencyKey: string): Promise<AEmotionInteractionEventPortV1 | null> {
    const row = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.storyEvent.findUnique({
        where: { dedupeKey: interactionDedupeKey(idempotencyKey) },
      });
      return existing;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 10_000, timeout: 30_000 });
    if (!row) return null;
    return decodeInteractionEnvelope(row.payloadJson).event;
  }

  async append(input: {
    event: AEmotionInteractionEventPortV1;
    storyDay: number;
  }): Promise<{ status: "COMMITTED" | "REPLAYED"; event: AEmotionInteractionEventPortV1; }> {
    const dedupeKey = interactionDedupeKey(input.event.idempotencyKey);
    const payload = encodeInteractionEnvelope(input);
    try {
      await pressureSerializableTransaction(this.prisma, async (tx) => {
        const sequence = await claimStorySequence(tx, input.event.runId);
        await tx.storyEvent.create({
          data: {
            id: `evt_${dedupeKey}`,
            runId: input.event.runId,
            day: input.storyDay,
            type: INTERACTION_EVENT_TYPE,
            messageType: "system",
            visibility: "private",
            payloadJson: json(payload),
            sequence,
            dedupeKey,
            audienceType: "A_EMOTION_CANONICAL",
          },
        });
      });
      return { status: "COMMITTED", event: structuredClone(input.event) };
    } catch (error) {
      if (!isUniqueConflict(error)) throw error;
      const existing = await this.readCommitted(input.event.idempotencyKey);
      if (!existing) throw error;
      if (JSON.stringify(existing) !== JSON.stringify(input.event)) {
        failAEmotionPersistence(
          ERROR.FINGERPRINT_MISMATCH,
          "A-Emotion interaction dedupe key was reused for a different event",
          { idempotencyKey: input.event.idempotencyKey },
        );
      }
      return { status: "REPLAYED", event: existing };
    }
  }
}

export class PrismaAEmotionFeedRepositoryV1 implements AEmotionFeedRepositoryPortV1 {
  constructor(
    private readonly prisma: AEmotionPersistencePrismaClient,
    private readonly bindings: AEmotionSeatDeliveryBindingPortV1,
    private readonly storyDay: AEmotionStoryDayPortV1,
  ) {}

  async readProjectionReceipt(idempotencyKey: string) {
    const rows = await this.readAggregateRowsByType(AGGREGATE_EVENT_TYPE);
    const match = rows
      .map((row) => decodeAggregateEnvelope(row.payloadJson))
      .find((row) => row.idempotencyKey === idempotencyKey);
    return match
      ? {
          fingerprint: match.inputFingerprint,
          aggregationKey: match.commit.aggregate.aggregationKey,
        }
      : null;
  }

  async readAggregate(aggregationKey: string) {
    const rows = await this.readAggregateRowsByType(AGGREGATE_EVENT_TYPE);
    const committed = rows
      .map((row) => decodeAggregateEnvelope(row.payloadJson).commit.aggregate)
      .filter((aggregate) => aggregate.aggregationKey === aggregationKey)
      .sort((left, right) => left.projectionVersion - right.projectionVersion || left.aggregationKey.localeCompare(right.aggregationKey));
    for (let index = 0; index < committed.length; index += 1) {
      if (committed[index]!.projectionVersion !== index + 1) {
        failAEmotionPersistence(
          ERROR.RECORD_INVALID,
          "A-Emotion aggregate versions are not contiguous",
          { aggregationKey, projectionVersion: committed[index]!.projectionVersion },
        );
      }
    }
    return committed.at(-1) ? structuredClone(committed.at(-1)!) : null;
  }

  async commitProjection(input: AEmotionProjectionCommitPortV1) {
    assertAEmotionProjectionCommitV1(input);
    const incoming = projectionRecordFromCommit(input);
    const priorReceipt = await this.readProjectionReceipt(input.idempotencyKey);
    if (priorReceipt) {
      if (
        priorReceipt.fingerprint !== input.inputFingerprint
        || priorReceipt.aggregationKey !== input.aggregate.aggregationKey
      ) {
        return { status: "IDEMPOTENCY_MISMATCH" as const };
      }
      const priorAggregate = await this.readAggregate(priorReceipt.aggregationKey);
      if (
        !priorAggregate
        || (priorAggregate.latestEventId === incoming.latestEventId
          && !isSameAEmotionProjectionV1({ stored: priorAggregate, incoming }))
      ) {
        return { status: "IDEMPOTENCY_MISMATCH" as const };
      }
      return { status: "REPLAYED" as const, aggregate: priorAggregate };
    }
    const current = await this.readAggregate(input.aggregate.aggregationKey);
    if ((current?.projectionVersion ?? 0) !== input.expectedAggregateVersion) {
      return { status: "CONFLICT" as const };
    }
    const binding = await this.requireBinding(input.aggregate);
    const storyDay = await this.resolveStoryDay({
      roomId: input.aggregate.roomId,
      runId: input.aggregate.runId,
      viewerSeatId: input.aggregate.viewerSeatId,
      stageId: input.aggregate.stageId,
      occurredAt: input.aggregate.projection.occurredAt,
      eventSequence: input.aggregate.projection.eventSequence,
    });
    try {
      await pressureSerializableTransaction(this.prisma, async (tx) => {
        const seed = await tx.eventDelivery.findUnique({
          where: {
            eventId_userId: {
              eventId: input.delivery.eventId,
              userId: binding.userId,
            },
          },
        });
        if (seed) {
          const decodedSeed = decodeDeliverySeed(seed.payloadJson);
          if (
            decodedSeed.viewerSeatId !== input.delivery.viewerSeatId
            || decodedSeed.aggregationKey !== input.aggregate.aggregationKey
            || seed.roomId !== input.aggregate.roomId
          ) {
            failAEmotionPersistence(
              ERROR.FINGERPRINT_MISMATCH,
              "EventDelivery event/viewer identity was reused for different projection content",
              {
                eventId: input.delivery.eventId,
                userId: binding.userId,
                storedProjectionVersion: decodedSeed.projectionVersion,
                requestedProjectionVersion: input.delivery.projectionVersion,
              },
            );
          }
        }
        const sequence = await claimStorySequence(tx, input.aggregate.runId);
        await tx.storyEvent.create({
          data: {
            id: `evt_${aggregateDedupeKey(input.aggregate.aggregationKey, input.aggregate.projectionVersion)}`,
            runId: input.aggregate.runId,
            day: storyDay,
            type: AGGREGATE_EVENT_TYPE,
            messageType: "system",
            visibility: "private",
            payloadJson: json(encodeAggregateEnvelope({
              idempotencyKey: input.idempotencyKey,
              inputFingerprint: input.inputFingerprint,
              expectedAggregateVersion: input.expectedAggregateVersion,
              commit: input,
              storyDay,
            })),
            sequence,
            dedupeKey: aggregateDedupeKey(input.aggregate.aggregationKey, input.aggregate.projectionVersion),
            audienceType: "A_EMOTION_VIEWER",
          },
        });

        if (!seed) {
          const deliverySequence = await claimDeliverySequence(tx, input.aggregate.roomId, binding.userId);
          await tx.eventDelivery.create({
            data: {
              eventId: input.delivery.eventId,
              roomId: input.aggregate.roomId,
              userId: binding.userId,
              roleId: binding.roleId,
              deliverySequence,
              payloadJson: json(withDeliveryEventId(
                encodeDeliverySeed({
                  eventId: input.delivery.eventId,
                  projectionVersion: input.delivery.projectionVersion,
                  viewerSeatId: input.delivery.viewerSeatId,
                  aggregationKey: input.aggregate.aggregationKey,
                  storyDay,
                }),
                input.delivery.eventId,
              )),
            },
          });
        }
      });
      return { status: "COMMITTED" as const };
    } catch (error) {
      if (!(isUniqueConflict(error))) throw error;
      const receipt = await this.readProjectionReceipt(input.idempotencyKey);
      if (receipt) {
        if (
          receipt.fingerprint !== input.inputFingerprint
          || receipt.aggregationKey !== input.aggregate.aggregationKey
        ) {
          return { status: "IDEMPOTENCY_MISMATCH" as const };
        }
        const aggregate = await this.readAggregate(receipt.aggregationKey);
        if (
          aggregate
          && (aggregate.latestEventId !== incoming.latestEventId
            || isSameAEmotionProjectionV1({ stored: aggregate, incoming }))
        ) {
          return { status: "REPLAYED" as const, aggregate };
        }
        return { status: "IDEMPOTENCY_MISMATCH" as const };
      }
      const concurrent = await this.readAggregate(input.aggregate.aggregationKey);
      if (concurrent?.projectionVersion === input.expectedAggregateVersion + 1) {
        return { status: "CONFLICT" as const };
      }
      throw error;
    }
  }

  async listAggregates(input: {
    roomId: string;
    runId: string;
    viewerSeatId: SeatIdV1;
  }) {
    const rows = await this.readAggregateRowsByType(AGGREGATE_EVENT_TYPE, input.runId);
    const latest = new Map<string, ReturnType<typeof decodeAggregateEnvelope>["commit"]["aggregate"]>();
    for (const row of rows) {
      const aggregate = decodeAggregateEnvelope(row.payloadJson).commit.aggregate;
      if (
        aggregate.roomId !== input.roomId
        || aggregate.runId !== input.runId
        || aggregate.viewerSeatId !== input.viewerSeatId
      ) {
        continue;
      }
      const prior = latest.get(aggregate.aggregationKey);
      if (!prior || aggregate.projectionVersion > prior.projectionVersion) {
        latest.set(aggregate.aggregationKey, aggregate);
      } else if (aggregate.projectionVersion === prior.projectionVersion) {
        failAEmotionPersistence(
          ERROR.RECORD_INVALID,
          "A-Emotion aggregate projectionVersion was duplicated",
          { aggregationKey: aggregate.aggregationKey, projectionVersion: aggregate.projectionVersion },
        );
      }
    }
    return [...latest.values()].map((aggregate) => structuredClone(aggregate));
  }

  async listAggregatesAfterSequence(input: {
    roomId: string;
    runId: string;
    viewerSeatId: SeatIdV1;
    afterSequence: number;
    limit: number;
  }) {
    const all = (await this.listAggregates(input)).sort(
      (left, right) => left.projection.eventSequence - right.projection.eventSequence,
    );
    const duplicate = all.find((aggregate, index) =>
      index > 0
      && aggregate.projection.eventSequence === all[index - 1]!.projection.eventSequence);
    if (duplicate) {
      failAEmotionPersistence(
        ERROR.RECORD_INVALID,
        "viewer delivery eventSequence must be strictly monotonic",
        { eventSequence: duplicate.projection.eventSequence },
      );
    }
    const eligible = all.filter(
      (aggregate) => aggregate.projection.eventSequence > input.afterSequence,
    );
    return {
      aggregates: eligible.slice(0, input.limit).map((aggregate) => structuredClone(aggregate)),
      hasMore: eligible.length > input.limit,
      currentServerSequence: all.reduce(
        (maximum, aggregate) => Math.max(maximum, aggregate.projection.eventSequence),
        0,
      ),
    };
  }

  async readDelivery(input: {
    eventId: string;
    projectionVersion: number;
    roomId: string;
    runId: string;
    viewerSeatId: SeatIdV1;
  }): Promise<AEmotionDeliveryRecordV1 | null> {
    assertAEmotionProjectionVersionV1(input.projectionVersion, "readDelivery.projectionVersion");
    const binding = await this.requireBinding(input);
    const seed = await pressureSerializableTransaction(this.prisma, async (tx) => tx.eventDelivery.findUnique({
      where: {
        eventId_userId: {
          eventId: input.eventId,
          userId: binding.userId,
        },
      },
    }));
    if (!seed) return null;
    const decodedSeed = decodeDeliverySeed(seed.payloadJson);
    if (
      decodedSeed.viewerSeatId !== input.viewerSeatId
      || decodedSeed.projectionVersion !== input.projectionVersion
      || seed.roomId !== input.roomId
    ) {
      return null;
    }
    const aggregate = await this.readAggregate(decodedSeed.aggregationKey);
    if (!aggregate) return null;
    const delivery = deliverySeedToRecord(aggregate, {
      eventId: input.eventId,
      projectionVersion: decodedSeed.projectionVersion,
      viewerSeatId: decodedSeed.viewerSeatId,
      aggregationKey: decodedSeed.aggregationKey,
      storyDay: decodedSeed.storyDay,
    });
    delivery.deliveredAt = seed.deliveredAt.toISOString();
    const marks = await this.readMarks(input.runId, input.viewerSeatId, input.eventId, input.projectionVersion);
    applyMarks(delivery, marks);
    return delivery;
  }

  async updateDelivery(input: {
    eventId: string;
    projectionVersion: number;
    roomId: string;
    runId: string;
    viewerSeatId: SeatIdV1;
    operation: "SEEN" | "ACKNOWLEDGED" | "RESOLVED" | "MODAL_SHOWN";
    occurredAt: string;
  }) {
    assertAEmotionProjectionVersionV1(input.projectionVersion, "updateDelivery.projectionVersion");
    const current = await this.readDelivery(input);
    if (!current) return null;
    const storyDay = await this.resolveStoryDay({
      roomId: input.roomId,
      runId: input.runId,
      viewerSeatId: input.viewerSeatId,
      stageId: "A_EMOTION_DELIVERY",
      occurredAt: input.occurredAt,
      eventSequence: current.projectionVersion,
    });
    try {
      await pressureSerializableTransaction(this.prisma, async (tx) => {
        const sequence = await claimStorySequence(tx, input.runId);
        await tx.storyEvent.create({
          data: {
            id: `evt_${markDedupeKey(input)}`,
            runId: input.runId,
            day: storyDay,
            type: DELIVERY_MARK_EVENT_TYPE,
            messageType: "system",
            visibility: "private",
            payloadJson: json(encodeDeliveryMark({
              storyDay,
              roomId: input.roomId,
              runId: input.runId,
              viewerSeatId: input.viewerSeatId,
              eventId: input.eventId,
              projectionVersion: input.projectionVersion,
              operation: input.operation,
              occurredAt: input.occurredAt,
            })),
            sequence,
            dedupeKey: markDedupeKey(input),
            audienceType: "A_EMOTION_VIEWER",
          },
        });
      });
    } catch (error) {
      if (!isUniqueConflict(error)) throw error;
    }
    const replayed = await this.readDelivery(input);
    return replayed;
  }

  private async readAggregateRowsByType(type: string, runId?: string): Promise<StoryEventRow[]> {
    return pressureSerializableTransaction(this.prisma, async (tx) => tx.storyEvent.findMany({
      where: runId === undefined ? { type } : { type, runId },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    }));
  }

  private async readMarks(
    runId: string,
    viewerSeatId: SeatIdV1,
    eventId: string,
    projectionVersion: number,
  ) {
    const rows = await this.readAggregateRowsByType(DELIVERY_MARK_EVENT_TYPE, runId);
    return rows
      .map((row) => decodeDeliveryMark(row.payloadJson))
      .filter((row) => (
        row.runId === runId
        && row.viewerSeatId === viewerSeatId
        && row.eventId === eventId
        && row.projectionVersion === projectionVersion
      ))
      .sort((left, right) => left.occurredAt.localeCompare(right.occurredAt));
  }

  private async requireBinding(input: {
    roomId: string;
    runId: string;
    viewerSeatId: SeatIdV1;
  }) {
    const binding = await this.bindings.resolve(input);
    if (!binding?.userId?.trim()) {
      failAEmotionPersistence(
        ERROR.DELIVERY_BINDING_MISSING,
        "A-Emotion delivery requires an exact viewerSeatId to userId binding",
        input,
      );
    }
    return binding;
  }

  private async resolveStoryDay(input: {
    roomId: string;
    runId: string;
    viewerSeatId: SeatIdV1 | null;
    stageId: string;
    occurredAt: string;
    eventSequence: number;
  }) {
    const day = await this.storyDay.resolve(input);
    if (!Number.isSafeInteger(day) || day < 0) {
      failAEmotionPersistence(
        ERROR.DAY_RESOLUTION_REQUIRED,
        "A-Emotion persistence requires a resolved StoryEvent.day integer",
        { ...input, resolvedDay: day },
      );
    }
    return day;
  }
}

function applyMarks(
  delivery: AEmotionDeliveryRecordV1,
  marks: ReturnType<typeof decodeDeliveryMark>[],
): void {
  for (const mark of marks) {
    if (mark.operation === "SEEN") delivery.seenAt ??= mark.occurredAt;
    if (mark.operation === "ACKNOWLEDGED") delivery.acknowledgedAt ??= mark.occurredAt;
    if (mark.operation === "RESOLVED") delivery.resolvedAt ??= mark.occurredAt;
    if (mark.operation === "MODAL_SHOWN") delivery.keyModalShownAt ??= mark.occurredAt;
  }
}

async function claimStorySequence(tx: AEmotionTransaction, runId: string): Promise<number> {
  const existing = await tx.storyEventCursor.findUnique({ where: { runId } });
  if (!existing) {
    await tx.storyEventCursor.create({ data: { runId, nextSequence: 1 } });
  }
  const cursor = await tx.storyEventCursor.update({
    where: { runId },
    data: { nextSequence: { increment: 1 }, version: { increment: 1 } },
  });
  return cursor.nextSequence - 1;
}

async function claimDeliverySequence(
  tx: AEmotionTransaction,
  roomId: string,
  userId: string,
): Promise<number> {
  const key = { roomId, userId };
  const existing = await tx.eventDeliveryCursor.findUnique({
    where: { roomId_userId: key },
  });
  if (!existing) {
    await tx.eventDeliveryCursor.create({ data: { ...key, nextSequence: 1 } });
  }
  const cursor = await tx.eventDeliveryCursor.update({
    where: { roomId_userId: key },
    data: { nextSequence: { increment: 1 }, version: { increment: 1 } },
  });
  return cursor.nextSequence - 1;
}

function interactionDedupeKey(idempotencyKey: string): string {
  return `pressure:a-emotion:interaction:${idempotencyKey}`;
}

function projectionRecordFromCommit(
  input: AEmotionProjectionCommitPortV1,
): AEmotionProjectionRecordV1 {
  return {
    aggregationKey: input.aggregate.aggregationKey,
    latestEventId: input.aggregate.latestEventId,
    idempotencyKey: input.idempotencyKey,
    inputFingerprint: input.inputFingerprint,
    stageId: input.aggregate.stageId,
    sharedObjectId: input.aggregate.sharedObjectId,
    eventFamily: input.aggregate.eventFamily,
    projection: structuredClone(input.aggregate.projection),
  };
}

function aggregateDedupeKey(aggregationKey: string, projectionVersion: number): string {
  return `pressure:a-emotion:aggregate:${aggregationKey}:v${projectionVersion}`;
}

function markDedupeKey(input: {
  viewerSeatId: SeatIdV1;
  eventId: string;
  projectionVersion: number;
  operation: "SEEN" | "ACKNOWLEDGED" | "RESOLVED" | "MODAL_SHOWN";
}): string {
  return `pressure:a-emotion:mark:${input.viewerSeatId}:${input.eventId}:${input.projectionVersion}:${input.operation}`;
}

function json(value: unknown): Prisma.InputJsonValue {
  return structuredClone(value) as Prisma.InputJsonValue;
}
