import { createHash, randomUUID } from "node:crypto";
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import {
  A_EMOTION_M1_EVENT_TYPE,
  A_EMOTION_M2_EVENT_TYPE,
  A_EMOTION_M3_EVENT_TYPE,
  A_EMOTION_M4_EVENT_TYPE,
  A_EMOTION_M5_EVENT_TYPE,
  A_EMOTION_M2_FEED_SCHEMA_VERSION,
  EVENT_DELIVERY_PAGE_SCHEMA_VERSION,
  aEmotionM1ForbiddenPaths,
  aEmotionM1SemanticLeaks,
  isOpaqueAEmotionM1EventId,
  isOpaqueAEmotionM2AggregateId,
  isOpaqueAEmotionM2Cursor,
  isOpaqueAEmotionM2EventId,
  upgradeAEmotionM1ProjectionToM2,
  validateAEmotionM1ProjectionV1,
  validateAEmotionM2FeedV1,
  validateAEmotionM2ProjectionV1,
  type AEmotionM2DisclosureV1,
  type AEmotionM2FeedItemV1,
  type AEmotionM2FeedV1,
  type AEmotionM2ProjectionV1,
  type EventDeliveryPageV1
} from "@ai-story/shared";
import type { AuthenticatedUser } from "../auth/current-user.decorator";
import { PrismaService } from "../prisma.service";
import { isAEmotionM2EnabledForRun } from "../config/a-emotion-m2.config";
import { aEmotionViewerState } from "../config/a-emotion-room-flags";

export type AEmotionAggregateMetadata = {
  aggregateKey: string;
  aggregateId: string;
  stageId: string;
  sharedObjectId: string;
  eventFamily: string;
  category: "RELATED" | "PUBLIC" | "SUSPICIOUS";
  disclosure: AEmotionM2DisclosureV1;
  projectionVersion: number;
  stateVersion: number;
};

type Tx = Prisma.TransactionClient;
type ProjectedDelivery = {
  userId: string;
  roleId: string;
  aggregate?: AEmotionAggregateMetadata;
  buildPayload: (eventSequence: number, eventId: string) => Record<string, unknown>;
};

type InteractionRow = {
  id: string;
  eventId: string;
  roomId: string;
  userId: string;
  roleId: string | null;
  deliverySequence: number;
  aggregateKey: string | null;
  aggregateId: string | null;
  stageId: string | null;
  sharedObjectId: string | null;
  eventFamily: string | null;
  category: string | null;
  disclosure: string | null;
  projectionVersion: number;
  stateVersion: number;
  seenAt: Date | null;
  acknowledgedAt: Date | null;
  resolvedAt: Date | null;
  payloadJson: unknown;
  deliveredAt: Date;
  event: { id: string; runId: string; type: string; sequence: number | null; payloadJson: unknown };
};

type Membership = { roleId: string; userId: string; m2Enabled: boolean; aEmotionReadEnabled: boolean };

const INTERACTION_ROW_SELECT = {
  id: true, eventId: true, roomId: true, userId: true, roleId: true, deliverySequence: true,
  aggregateKey: true, aggregateId: true, stageId: true, sharedObjectId: true, eventFamily: true,
  category: true, disclosure: true, projectionVersion: true, stateVersion: true, seenAt: true,
  acknowledgedAt: true, resolvedAt: true, payloadJson: true, deliveredAt: true,
  event: { select: { id: true, runId: true, type: true, sequence: true, payloadJson: true } }
} satisfies Prisma.EventDeliverySelect;

export function aEmotionInteractionAggregateLockName(aggregateKey: string) {
  if (!aggregateKey) throw new Error("INTERACTION_AGGREGATE_KEY_REQUIRED");
  return `aemotion:interaction-aggregate:${aggregateKey}`;
}


@Injectable()
export class ContinuousEventDeliveryService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async publish(tx: Tx, input: {
    runId: string;
    nodeId?: string;
    type: string;
    messageType?: string;
    roleKey?: string;
    visibility: "PUBLIC" | "OBSERVABLE" | "LIMITED" | "PRIVATE";
    audienceType: "ALL_MEMBERS" | "ROLE" | "MEMBER";
    audienceUserIds: string[];
    audienceRoleIds?: string[];
    payload: Record<string, unknown>;
    dedupeKey: string;
    sourceActionId?: string;
    day: number;
    eventId?: string;
  }) {
    return this.publishProjected(tx, {
      ...input,
      canonicalPayload: input.payload,
      audienceRoleIds: input.audienceRoleIds,
      deliveries: [...new Set(input.audienceUserIds)].map((userId) => ({
        userId,
        roleId: input.audienceRoleIds?.length === 1 ? input.audienceRoleIds[0] : "",
        buildPayload: () => input.payload
      }))
    });
  }

  /** Persist one canonical event and separately materialize viewer-safe JSON. */
  async publishProjected(tx: Tx, input: {
    runId: string;
    nodeId?: string;
    type: string;
    messageType?: string;
    roleKey?: string;
    visibility: "PUBLIC" | "OBSERVABLE" | "LIMITED" | "PRIVATE";
    audienceType: "ALL_MEMBERS" | "ROLE" | "MEMBER";
    audienceRoleIds?: string[];
    canonicalPayload: Record<string, unknown>;
    deliveries: ProjectedDelivery[];
    dedupeKey: string;
    sourceActionId?: string;
    day: number;
    eventId?: string;
  }) {
    const interactionType = [A_EMOTION_M1_EVENT_TYPE, A_EMOTION_M2_EVENT_TYPE, A_EMOTION_M3_EVENT_TYPE, A_EMOTION_M4_EVENT_TYPE, A_EMOTION_M5_EVENT_TYPE].includes(input.type as never);
    if (input.type === A_EMOTION_M1_EVENT_TYPE) assertM1PublicationInput(input);
    if (input.type === A_EMOTION_M2_EVENT_TYPE) assertM2PublicationInput(input);
    if (input.type === A_EMOTION_M3_EVENT_TYPE) assertM3PublicationInput(input);
    if (input.type === A_EMOTION_M4_EVENT_TYPE) assertM4PublicationInput(input);
    if (input.type === A_EMOTION_M5_EVENT_TYPE) assertM5PublicationInput(input);
    if (interactionType) await lockProjectedInteractionAggregates(tx, input.deliveries);
    const existing = await tx.storyEvent.findUnique({ where: { dedupeKey: input.dedupeKey } });
    if (existing) {
      if (interactionType
        && (existing.runId !== input.runId
          || existing.type !== input.type
          || existing.sourceActionId !== (input.sourceActionId || null)
          || !isOpaqueAEmotionM2EventId(existing.id)
          || !sameInteractionCanonicalPublication(existing.payloadJson, input.canonicalPayload, input.type))) {
        throw new ServiceUnavailableException({
          code: input.type === A_EMOTION_M1_EVENT_TYPE
            ? "A_EMOTION_M1_IDEMPOTENCY_CONFLICT"
            : input.type === A_EMOTION_M2_EVENT_TYPE
              ? "A_EMOTION_M2_IDEMPOTENCY_CONFLICT"
              : input.type === A_EMOTION_M3_EVENT_TYPE
                ? "A_EMOTION_M3_IDEMPOTENCY_CONFLICT"
                : input.type === A_EMOTION_M4_EVENT_TYPE
                  ? "A_EMOTION_M4_IDEMPOTENCY_CONFLICT"
                  : "A_EMOTION_M5_IDEMPOTENCY_CONFLICT",
          message: "Interaction event idempotency state is inconsistent"
        });
      }
      return existing;
    }

    const existingEventCursor = await tx.storyEventCursor.findUnique({ where: { runId: input.runId }, select: { runId: true } });
    if (!existingEventCursor) await tx.storyEventCursor.create({ data: { runId: input.runId, nextSequence: 1 } });
    const cursor = await tx.storyEventCursor.update({
      where: { runId: input.runId },
      data: { nextSequence: { increment: 1 }, version: { increment: 1 } }
    });
    const eventSequence = cursor.nextSequence - 1;
    const event = await tx.storyEvent.create({
      data: {
        id: interactionType ? (input.eventId || opaqueEventId()) : `evt_${input.dedupeKey}`,
        runId: input.runId,
        day: input.day,
        type: input.type,
        messageType: input.messageType || "system",
        roleKey: input.roleKey,
        visibility: input.visibility,
        payloadJson: input.canonicalPayload as Prisma.InputJsonValue,
        sequence: eventSequence,
        dedupeKey: input.dedupeKey,
        audienceType: input.audienceType,
        audienceRoleIdsJson: [...new Set(input.audienceRoleIds || input.deliveries.map((delivery) => delivery.roleId).filter(Boolean))] as Prisma.InputJsonValue,
        sourceActionId: input.sourceActionId
      }
    });

    const unique = new Map<string, ProjectedDelivery>();
    for (const delivery of input.deliveries) {
      if (!delivery.userId) continue;
      const previous = unique.get(delivery.userId);
      if (previous && previous.roleId !== delivery.roleId) throw new Error("EVENT_DELIVERY_ROLE_AMBIGUOUS");
      unique.set(delivery.userId, delivery);
    }
    for (const delivery of unique.values()) {
      const cursorKey = { roomId: input.runId, userId: delivery.userId };
      const existingDeliveryCursor = await tx.eventDeliveryCursor.findUnique({ where: { roomId_userId: cursorKey }, select: { id: true } });
      if (!existingDeliveryCursor) await tx.eventDeliveryCursor.create({ data: { ...cursorKey, nextSequence: 1 } });
      const deliveryCursor = await tx.eventDeliveryCursor.update({
        where: { roomId_userId: cursorKey },
        data: { nextSequence: { increment: 1 }, version: { increment: 1 } }
      });
      const viewerPayload = delivery.buildPayload(eventSequence, event.id);
      if (input.type === A_EMOTION_M1_EVENT_TYPE) assertM1Payload(event.id, viewerPayload, eventSequence);
      if (input.type === A_EMOTION_M2_EVENT_TYPE) assertM2Payload(event.id, viewerPayload, eventSequence);
      if (input.type === A_EMOTION_M3_EVENT_TYPE) assertM3Payload(event.id, viewerPayload, eventSequence);
      if (input.type === A_EMOTION_M4_EVENT_TYPE) assertM4Payload(event.id, viewerPayload, eventSequence);
      if (input.type === A_EMOTION_M5_EVENT_TYPE) assertM5Payload(event.id, viewerPayload, eventSequence);
      if (delivery.aggregate) assertAggregateMetadata(delivery.aggregate, viewerPayload);
      await tx.eventDelivery.create({
        data: {
          eventId: event.id,
          roomId: input.runId,
          userId: delivery.userId,
          roleId: delivery.roleId || null,
          deliverySequence: deliveryCursor.nextSequence - 1,
          aggregateKey: delivery.aggregate?.aggregateKey || null,
          aggregateId: delivery.aggregate?.aggregateId || null,
          stageId: delivery.aggregate?.stageId || null,
          sharedObjectId: delivery.aggregate?.sharedObjectId || null,
          eventFamily: delivery.aggregate?.eventFamily || null,
          category: delivery.aggregate?.category || null,
          disclosure: delivery.aggregate?.disclosure || null,
          projectionVersion: delivery.aggregate?.projectionVersion || 1,
          stateVersion: delivery.aggregate?.stateVersion || 1,
          payloadJson: {
            type: input.type,
            visibility: input.visibility,
            eventSequence,
            payload: viewerPayload
          } as Prisma.InputJsonValue
        }
      });
    }
    return event;
  }

  async page(
    user: AuthenticatedUser,
    roomId: string,
    afterDeliverySequence = 0,
    pageSize = 100,
    interaction?: { cursor?: string; limit?: number }
  ): Promise<EventDeliveryPageV1> {
    const membership = await this.requireMembership(user, roomId);
    const normalizedAfter = Number.isSafeInteger(afterDeliverySequence) && afterDeliverySequence >= 0 ? afterDeliverySequence : 0;
    const take = Math.max(1, Math.min(100, pageSize));
    const rows = await this.prisma.eventDelivery.findMany({
      where: { roomId, userId: user.id, deliverySequence: { gt: normalizedAfter } },
      orderBy: { deliverySequence: "asc" },
      take: take + 1,
      select: {
        eventId: true,
        roleId: true,
        deliverySequence: true,
        payloadJson: true,
        deliveredAt: true,
        aggregateKey: true,
        projectionVersion: true,
        stateVersion: true,
        event: { select: { id: true, runId: true, type: true, sequence: true, payloadJson: true } }
      }
    });
    const hasMore = rows.length > take;
    const page = rows.slice(0, take);
    // A supplied interaction cursor is itself a viewer-scoped contract. Validate
    // it before serializing ordinary deliveries so a stale boundary cannot leak
    // a lower-level projection/state inconsistency error from the same row.
    const cursorCheckedFeed = membership.m2Enabled && interaction?.cursor
      ? await this.interactionFeed(user, roomId, membership, interaction.cursor, interaction.limit)
      : undefined;
    const deliveries = page.flatMap((row) => {
      if (row.roleId && row.roleId !== membership.roleId) throw new ForbiddenException({ code: "EVENT_DELIVERY_ROLE_MISMATCH", message: "Event delivery role mismatch" });
      const envelope = record(row.payloadJson);
      const eventType = String(envelope.type || "UNKNOWN");
      const payload = record(envelope.payload);
      const interactionType = [A_EMOTION_M1_EVENT_TYPE, A_EMOTION_M2_EVENT_TYPE, A_EMOTION_M3_EVENT_TYPE, A_EMOTION_M4_EVENT_TYPE, A_EMOTION_M5_EVENT_TYPE].includes(eventType as never);
      if (interactionType) {
        if (!membership.aEmotionReadEnabled) return [];
        assertInteractionOwnership(row, membership, roomId, envelope, payload);
      }
      return [{
        deliverySequence: row.deliverySequence,
        eventId: row.eventId,
        eventType,
        payload,
        createdAt: row.deliveredAt.toISOString()
      }];
    });
    const interactionFeed = membership.m2Enabled
      ? cursorCheckedFeed ?? await this.interactionFeed(user, roomId, membership, undefined, interaction?.limit)
      : undefined;
    return {
      schemaVersion: EVENT_DELIVERY_PAGE_SCHEMA_VERSION,
      deliveries,
      nextAfterDeliverySequence: page.at(-1)?.deliverySequence ?? normalizedAfter,
      hasMore,
      ...(interactionFeed ? { interactionFeed } : {})
    };
  }

  async interactionDetail(user: AuthenticatedUser, roomId: string, eventId: string, projectionVersion: number) {
    const membership = await this.requireMembership(user, roomId);
    const row = await this.requireLatestInteraction(user, roomId, membership, eventId, projectionVersion);
    return toFeedItem(row);
  }

  async markInteractionSeen(user: AuthenticatedUser, roomId: string, eventId: string, projectionVersion: number) {
    return this.mutateInteractionReceipt(user, roomId, eventId, projectionVersion, "seen");
  }

  async acknowledgeInteraction(user: AuthenticatedUser, roomId: string, eventId: string, projectionVersion: number) {
    return this.mutateInteractionReceipt(user, roomId, eventId, projectionVersion, "acknowledged");
  }

  async resolveInteraction(user: AuthenticatedUser, roomId: string, eventId: string, projectionVersion: number) {
    return this.mutateInteractionReceipt(user, roomId, eventId, projectionVersion, "resolved");
  }

  private async interactionFeed(user: AuthenticatedUser, roomId: string, membership: Membership, cursorToken?: string, requestedLimit = 10): Promise<AEmotionM2FeedV1 | undefined> {
    if (!Number.isInteger(requestedLimit) || requestedLimit < 1 || requestedLimit > 10) {
      throw new BadRequestException({ code: "INTERACTION_LIMIT_INVALID", message: "interactionLimit must be between 1 and 10" });
    }
    const limit = requestedLimit;
    const rows = await this.prisma.eventDelivery.findMany({
      where: {
        roomId,
        userId: user.id,
        roleId: membership.roleId,
        aggregateKey: { not: null },
        event: { runId: roomId, type: { in: [A_EMOTION_M1_EVENT_TYPE, A_EMOTION_M2_EVENT_TYPE, A_EMOTION_M3_EVENT_TYPE, A_EMOTION_M4_EVENT_TYPE, A_EMOTION_M5_EVENT_TYPE] } }
      },
      orderBy: [{ deliverySequence: "asc" }],
      take: 250,
      select: {
        id: true,
        eventId: true,
        roomId: true,
        userId: true,
        roleId: true,
        deliverySequence: true,
        aggregateKey: true,
        aggregateId: true,
        stageId: true,
        sharedObjectId: true,
        eventFamily: true,
        category: true,
        disclosure: true,
        projectionVersion: true,
        stateVersion: true,
        seenAt: true,
        acknowledgedAt: true,
        resolvedAt: true,
        payloadJson: true,
        deliveredAt: true,
        event: { select: { id: true, runId: true, type: true, sequence: true, payloadJson: true } }
      }
    });
    if (cursorToken && !isOpaqueAEmotionM2Cursor(cursorToken)) {
      throw new BadRequestException({ code: "INTERACTION_CURSOR_INVALID", message: "Interaction cursor is invalid" });
    }
    if (!rows.length) {
      if (cursorToken) throw staleOrScopedInteractionCursor();
      return undefined;
    }
    if (cursorToken) {
      assertCurrentInteractionCursor(
        rows as InteractionRow[],
        { roomId, runId: roomId, userId: user.id, roleId: membership.roleId },
        cursorToken
      );
    }
    const aggregates = latestAggregates(rows as InteractionRow[], membership, roomId);
    const ordered = aggregates.sort(compareFeedRows);
    let start = 0;
    if (cursorToken) {
      const index = ordered.findIndex((row) => interactionCursorForRow({ roomId, runId: roomId, userId: user.id, roleId: membership.roleId }, row) === cursorToken);
      if (index < 0) throw staleOrScopedInteractionCursor();
      start = index + 1;
    }
    const selected = ordered.slice(start, start + limit);
    const hasMore = start + limit < ordered.length;
    const items = selected.map(toFeedItem);
    const nextCursor = hasMore && selected.length
      ? interactionCursorForRow({ roomId, runId: roomId, userId: user.id, roleId: membership.roleId }, selected.at(-1)!)
      : null;
    const feed: AEmotionM2FeedV1 = {
      schemaVersion: A_EMOTION_M2_FEED_SCHEMA_VERSION,
      items,
      unreadCount: items.filter((item) => item.isUnread).length,
      nextCursor,
      hasMore
    };
    const validation = validateAEmotionM2FeedV1(feed);
    if (!validation.ok) throw new ServiceUnavailableException({ code: "A_EMOTION_M2_FEED_REJECTED", message: "Viewer feed failed validation" });
    return validation.value;
  }

  private async requireMembership(user: AuthenticatedUser, roomId: string): Promise<Membership> {
    const run = await this.prisma.storyRun.findUnique({
      where: { id: roomId },
      select: {
        id: true,
        mode: true,
        maxPlayers: true,
        templateKey: true,
        engineVersion: true,
        stateJson: true,
        players: { where: { userId: user.id, status: "active", playerType: "human" }, select: { userId: true, roleId: true } }
      }
    });
    if (!run || run.mode !== "room") throw new NotFoundException({ code: "ROOM_NOT_FOUND", message: "Room not found" });
    const player = run.players[0];
    if (!player?.userId || !player.roleId) throw new ForbiddenException({ code: "ROOM_MEMBERSHIP_REQUIRED", message: "Room membership required" });
    const m6 = aEmotionViewerState(run.stateJson);
    const aEmotionReadEnabled = m6
      ? m6.features.aEmotionEnabled && m6.features.situationFeedEnabled && !m6.paused
      : true;
    return {
      userId: player.userId,
      roleId: player.roleId,
      m2Enabled: aEmotionReadEnabled && isAEmotionM2EnabledForRun(run),
      aEmotionReadEnabled
    };
  }

  private async requireLatestInteraction(user: AuthenticatedUser, roomId: string, membership: Membership, eventId: string, projectionVersion: number): Promise<InteractionRow> {
    return this.requireLatestInteractionWithClient(this.prisma, user, roomId, membership, eventId, projectionVersion, false);
  }

  private async requireLatestInteractionWithClient(
    client: Prisma.TransactionClient | PrismaService,
    user: AuthenticatedUser,
    roomId: string,
    membership: Membership,
    eventId: string,
    projectionVersion: number,
    lockAggregate: boolean
  ): Promise<InteractionRow> {
    if (!membership.m2Enabled) {
      throw new NotFoundException({ code: "INTERACTION_EVENT_NOT_FOUND", message: "Interaction event not found" });
    }
    if (!isOpaqueAEmotionM2EventId(eventId) || !Number.isInteger(projectionVersion) || projectionVersion < 1) {
      throw new NotFoundException({ code: "INTERACTION_EVENT_NOT_FOUND", message: "Interaction event not found" });
    }
    let row = await client.eventDelivery.findFirst({
      where: { eventId, roomId, userId: user.id, roleId: membership.roleId, aggregateKey: { not: null } },
      select: INTERACTION_ROW_SELECT
    });
    if (!row?.aggregateKey) throw new NotFoundException({ code: "INTERACTION_EVENT_NOT_FOUND", message: "Interaction event not found" });
    if (lockAggregate) {
      await lockInteractionAggregate(client as Prisma.TransactionClient, row.aggregateKey);
      row = await client.eventDelivery.findFirst({
        where: { eventId, roomId, userId: user.id, roleId: membership.roleId, aggregateKey: row.aggregateKey },
        select: INTERACTION_ROW_SELECT
      });
      if (!row) throw new NotFoundException({ code: "INTERACTION_EVENT_NOT_FOUND", message: "Interaction event not found" });
    }
    normalizeInteractionRow(row as InteractionRow, membership, roomId);
    const latest = await client.eventDelivery.findFirst({
      where: { roomId, userId: user.id, roleId: membership.roleId, aggregateKey: row.aggregateKey },
      orderBy: [{ projectionVersion: "desc" }, { deliverySequence: "desc" }],
      select: { id: true, eventId: true, projectionVersion: true }
    });
    if (!latest || latest.id !== row.id || latest.eventId !== eventId || latest.projectionVersion !== projectionVersion) {
      throw new ConflictException({ code: "STALE_INTERACTION_PROJECTION", message: "Interaction projection is stale" });
    }
    return row as InteractionRow;
  }

  private async mutateInteractionReceipt(
    user: AuthenticatedUser,
    roomId: string,
    eventId: string,
    projectionVersion: number,
    kind: "seen" | "acknowledged" | "resolved"
  ) {
    const membership = await this.requireMembership(user, roomId);
    return this.prisma.$transaction(async (tx) => {
      const row = await this.requireLatestInteractionWithClient(tx, user, roomId, membership, eventId, projectionVersion, true);
      const now = new Date();
      if (kind === "seen" && !row.seenAt) {
        await tx.eventDelivery.updateMany({
          where: { id: row.id, projectionVersion, seenAt: null },
          data: { seenAt: now }
        });
      } else if (kind === "acknowledged" && !row.acknowledgedAt) {
        await tx.eventDelivery.updateMany({
          where: { id: row.id, projectionVersion, acknowledgedAt: null },
          data: { seenAt: row.seenAt || now, acknowledgedAt: now }
        });
      } else if (kind === "resolved" && !row.resolvedAt) {
        await tx.eventDelivery.updateMany({
          where: { id: row.id, projectionVersion, resolvedAt: null },
          data: { seenAt: row.seenAt || now, acknowledgedAt: row.acknowledgedAt || now, resolvedAt: now }
        });
      }
      const updated = await tx.eventDelivery.findUniqueOrThrow({ where: { id: row.id } });
      return this.interactionReceipt(updated);
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
  }

  private interactionReceipt(row: { eventId: string; projectionVersion: number; seenAt: Date | null; acknowledgedAt: Date | null; resolvedAt: Date | null }) {
    return {
      eventId: row.eventId,
      projectionVersion: row.projectionVersion,
      seenAt: row.seenAt?.toISOString() || null,
      acknowledgedAt: row.acknowledgedAt?.toISOString() || null,
      resolvedAt: row.resolvedAt?.toISOString() || null
    };
  }
}

async function lockProjectedInteractionAggregates(tx: Tx, deliveries: ProjectedDelivery[]) {
  const aggregateKeys = [...new Set(deliveries.map((delivery) => delivery.aggregate?.aggregateKey).filter((value): value is string => Boolean(value)))].sort();
  for (const aggregateKey of aggregateKeys) await lockInteractionAggregate(tx, aggregateKey);
}

async function lockInteractionAggregate(tx: Prisma.TransactionClient, aggregateKey: string) {
  const lockName = aEmotionInteractionAggregateLockName(aggregateKey);
  await tx.$queryRaw`SELECT 1::int AS locked FROM (SELECT pg_advisory_xact_lock(hashtextextended(${lockName}, 0))) AS acquired`;
}

function latestAggregates(rows: InteractionRow[], membership: Membership, roomId: string): InteractionRow[] {
  const byKey = new Map<string, InteractionRow[]>();
  for (const row of rows) {
    normalizeInteractionRow(row, membership, roomId);
    const key = requireText(row.aggregateKey, "INTERACTION_AGGREGATE_KEY_MISSING");
    const list = byKey.get(key) || [];
    list.push(row);
    byKey.set(key, list);
  }
  const output: InteractionRow[] = [];
  for (const values of byKey.values()) {
    values.sort((left, right) => left.projectionVersion - right.projectionVersion || left.deliverySequence - right.deliverySequence);
    let disclosureRankValue = -1;
    let previousVersion = 0;
    let previousPayload = "";
    for (const row of values) {
      const projection = normalizeInteractionRow(row, membership, roomId);
      const rank = disclosureRank(projection.disclosure);
      if (rank < disclosureRankValue) throw new ServiceUnavailableException({ code: "A_EMOTION_M2_DISCLOSURE_DOWNGRADE", message: "Interaction disclosure cannot move backwards" });
      const serialized = JSON.stringify(projection);
      if (row.projectionVersion === previousVersion && serialized !== previousPayload) throw new ServiceUnavailableException({ code: "A_EMOTION_M2_PROJECTION_VERSION_CONFLICT", message: "Interaction projection version conflicts" });
      if (row.projectionVersion < previousVersion) throw new ServiceUnavailableException({ code: "A_EMOTION_M2_PROJECTION_VERSION_CONFLICT", message: "Interaction projection version conflicts" });
      disclosureRankValue = rank;
      previousVersion = row.projectionVersion;
      previousPayload = serialized;
    }
    output.push(values.at(-1)!);
  }
  return output;
}

function compareFeedRows(left: InteractionRow, right: InteractionRow) {
  const leftCritical = left.resolvedAt === null && left.category === "RELATED" ? 0 : 1;
  const rightCritical = right.resolvedAt === null && right.category === "RELATED" ? 0 : 1;
  if (leftCritical !== rightCritical) return leftCritical - rightCritical;
  return requireInteger(right.event.sequence, "INTERACTION_EVENT_SEQUENCE_MISSING") - requireInteger(left.event.sequence, "INTERACTION_EVENT_SEQUENCE_MISSING");
}

function toFeedItem(row: InteractionRow): AEmotionM2FeedItemV1 {
  const projection = normalizeInteractionRow(row, { userId: row.userId, roleId: requireText(row.roleId, "INTERACTION_ROLE_MISSING"), m2Enabled: true, aEmotionReadEnabled: true }, row.roomId);
  return {
    ...projection,
    eventId: row.eventId,
    deliverySequence: row.deliverySequence,
    isUnread: row.seenAt === null && row.acknowledgedAt === null,
    isAcknowledged: row.acknowledgedAt !== null,
    isResolved: row.resolvedAt !== null
  };
}

function normalizeInteractionRow(row: InteractionRow, membership: Membership, roomId: string): AEmotionM2ProjectionV1 {
  if (row.roomId !== roomId || row.userId !== membership.userId || row.roleId !== membership.roleId
    || row.event.id !== row.eventId || row.event.runId !== roomId || !Number.isSafeInteger(row.event.sequence)
    || !row.aggregateKey || !isOpaqueAEmotionM2AggregateId(row.aggregateId)
    || !row.stageId || !row.sharedObjectId || !row.eventFamily
    || !Number.isInteger(row.projectionVersion) || row.projectionVersion < 1
    || !Number.isInteger(row.stateVersion) || row.stateVersion < 1) {
    throw new ForbiddenException({ code: "INTERACTION_VIEWER_SCOPE_MISMATCH", message: "Interaction viewer scope mismatch" });
  }
  const envelope = record(row.payloadJson);
  if (Number(envelope.eventSequence) !== row.event.sequence) throw new ServiceUnavailableException({ code: "A_EMOTION_M2_EVENT_SEQUENCE_MISMATCH", message: "Interaction event sequence is inconsistent" });
  const payload = record(envelope.payload);
  let projection: AEmotionM2ProjectionV1;
  if (row.event.type === A_EMOTION_M1_EVENT_TYPE) {
    const m1 = validateAEmotionM1ProjectionV1(payload);
    if (!m1.ok) throw new NotFoundException({ code: "INTERACTION_EVENT_NOT_FOUND", message: "Interaction event not found" });
    projection = upgradeAEmotionM1ProjectionToM2({ projection: m1.value, aggregateId: row.aggregateId, stageId: row.stageId });
  } else if ([A_EMOTION_M2_EVENT_TYPE, A_EMOTION_M3_EVENT_TYPE, A_EMOTION_M4_EVENT_TYPE].includes(row.event.type as never)) {
    const m2 = validateAEmotionM2ProjectionV1(payload);
    if (!m2.ok) throw new NotFoundException({ code: "INTERACTION_EVENT_NOT_FOUND", message: "Interaction event not found" });
    projection = m2.value;
  } else {
    throw new NotFoundException({ code: "INTERACTION_EVENT_NOT_FOUND", message: "Interaction event not found" });
  }
  if (projection.aggregateId !== row.aggregateId
    || projection.stageId !== row.stageId
    || projection.sharedObjectId !== row.sharedObjectId
    || projection.eventFamily !== row.eventFamily
    || projection.category !== row.category
    || projection.disclosure !== row.disclosure
    || projection.projectionVersion !== row.projectionVersion
    || projection.stateVersion !== row.stateVersion
    || projection.eventSequence !== row.event.sequence) {
    throw new ServiceUnavailableException({ code: "A_EMOTION_M2_PROJECTION_METADATA_MISMATCH", message: "Interaction projection metadata is inconsistent" });
  }
  return projection;
}

function assertInteractionOwnership(
  row: { eventId: string; roleId: string | null; aggregateKey: string | null; projectionVersion: number; stateVersion: number; event: { id: string; runId: string; type: string; sequence: number | null; payloadJson: unknown } },
  membership: Membership,
  roomId: string,
  envelope: Record<string, unknown>,
  payload: Record<string, unknown>
) {
  if (row.roleId !== membership.roleId || row.event.id !== row.eventId || row.event.runId !== roomId || !Number.isSafeInteger(row.event.sequence)) {
    throw new ForbiddenException({ code: "EVENT_DELIVERY_ROLE_MISMATCH", message: "Event delivery ownership mismatch" });
  }
  const envelopeSequence = Number(envelope.eventSequence);
  if (row.event.type === A_EMOTION_M1_EVENT_TYPE) assertM1Payload(row.eventId, payload, envelopeSequence);
  else if (row.event.type === A_EMOTION_M2_EVENT_TYPE) assertM2Payload(row.eventId, payload, envelopeSequence);
  else if (row.event.type === A_EMOTION_M3_EVENT_TYPE) assertM3Payload(row.eventId, payload, envelopeSequence);
  else if (row.event.type === A_EMOTION_M4_EVENT_TYPE) assertM4Payload(row.eventId, payload, envelopeSequence);
  else if (row.event.type === A_EMOTION_M5_EVENT_TYPE) assertM5Payload(row.eventId, payload, envelopeSequence);
  if (row.event.sequence !== envelopeSequence) throw new ServiceUnavailableException({ code: "A_EMOTION_M2_EVENT_SEQUENCE_MISMATCH", message: "Interaction delivery sequence is inconsistent" });
  const canonical = record(row.event.payloadJson);
  if (!Number.isInteger(canonical.stateVersion) || canonical.stateVersion !== payload.stateVersion) {
    throw new ServiceUnavailableException({ code: "A_EMOTION_M2_STATE_VERSION_MISMATCH", message: "Interaction delivery state is inconsistent" });
  }
  // Pre-M2 M1 rows do not have durable aggregate metadata. Preserve their
  // existing safe HTTP contract without interpreting default migration values
  // as authoritative state. Once aggregateKey is present, all metadata must
  // match exactly.
  if (row.aggregateKey !== null && (canonical.stateVersion !== row.stateVersion || payload.stateVersion !== row.stateVersion || payload.projectionVersion !== row.projectionVersion)) {
    throw new ServiceUnavailableException({ code: "A_EMOTION_M2_STATE_VERSION_MISMATCH", message: "Interaction delivery state is inconsistent" });
  }
}

function assertAggregateMetadata(metadata: AEmotionAggregateMetadata, payload: Record<string, unknown>) {
  if (!metadata.aggregateKey || !isOpaqueAEmotionM2AggregateId(metadata.aggregateId) || !metadata.stageId || !metadata.sharedObjectId || !metadata.eventFamily
    || !(metadata.category === "RELATED" || metadata.category === "PUBLIC" || metadata.category === "SUSPICIOUS")
    || !(metadata.disclosure === "HIDDEN" || metadata.disclosure === "SUSPECTED" || metadata.disclosure === "CONFIRMED")
    || !Number.isInteger(metadata.projectionVersion) || metadata.projectionVersion < 1
    || !Number.isInteger(metadata.stateVersion) || metadata.stateVersion < 1
    || payload.projectionVersion !== metadata.projectionVersion
    || payload.stateVersion !== metadata.stateVersion) {
    throw new ServiceUnavailableException({ code: "A_EMOTION_M2_AGGREGATE_METADATA_REJECTED", message: "Interaction aggregate metadata is invalid" });
  }
}

function assertM1PublicationInput(input: {
  visibility: string;
  audienceType: string;
  audienceRoleIds?: string[];
  canonicalPayload: Record<string, unknown>;
  deliveries: ProjectedDelivery[];
}) {
  if (input.visibility !== "LIMITED" || input.audienceType !== "ROLE" || input.deliveries.length !== 1) throw new ServiceUnavailableException({ code: "A_EMOTION_M1_PUBLICATION_REJECTED", message: "M1 requires one role-scoped limited delivery" });
  const delivery = input.deliveries[0];
  if (!delivery.userId || !delivery.roleId || input.audienceRoleIds?.length !== 1 || input.audienceRoleIds[0] !== delivery.roleId) throw new ServiceUnavailableException({ code: "A_EMOTION_M1_PUBLICATION_REJECTED", message: "M1 delivery ownership is incomplete" });
  const canonicalKeys = new Set(["schemaVersion", "resolutionId", "sharedObjectKey", "stateVersion"]);
  if (Object.keys(input.canonicalPayload).some((key) => !canonicalKeys.has(key))
    || input.canonicalPayload.schemaVersion !== "a_emotion_m1_canonical_impact_v1"
    || typeof input.canonicalPayload.resolutionId !== "string" || !input.canonicalPayload.resolutionId
    || input.canonicalPayload.sharedObjectKey !== "original-grain-ledger"
    || !Number.isInteger(input.canonicalPayload.stateVersion) || Number(input.canonicalPayload.stateVersion) < 1
    || aEmotionM1ForbiddenPaths(input.canonicalPayload).length
    || aEmotionM1SemanticLeaks(input.canonicalPayload).length) throw new ServiceUnavailableException({ code: "A_EMOTION_M1_PUBLICATION_REJECTED", message: "M1 canonical history payload is not viewer-safe" });
}

function assertM2PublicationInput(input: { visibility: string; audienceType: string; audienceRoleIds?: string[]; canonicalPayload: Record<string, unknown>; deliveries: ProjectedDelivery[] }) {
  if (input.visibility !== "LIMITED" || input.audienceType !== "ROLE" || input.deliveries.length !== 1) throw new ServiceUnavailableException({ code: "A_EMOTION_M2_PUBLICATION_REJECTED", message: "M2 requires one role-scoped limited delivery" });
  const delivery = input.deliveries[0];
  if (!delivery.userId || !delivery.roleId || !delivery.aggregate || input.audienceRoleIds?.length !== 1 || input.audienceRoleIds[0] !== delivery.roleId) throw new ServiceUnavailableException({ code: "A_EMOTION_M2_PUBLICATION_REJECTED", message: "M2 delivery ownership is incomplete" });
  const allowed = new Set(["schemaVersion", "resolutionId", "baseEventId", "sourceRoleId", "aggregateKey", "projectionVersion", "stateVersion", "nextDisclosure", "evidenceFactId"]);
  if (Object.keys(input.canonicalPayload).some((key) => !allowed.has(key))
    || input.canonicalPayload.schemaVersion !== "a_emotion_m2_canonical_upgrade_v1"
    || typeof input.canonicalPayload.resolutionId !== "string" || !input.canonicalPayload.resolutionId
    || typeof input.canonicalPayload.baseEventId !== "string" || !input.canonicalPayload.baseEventId
    || typeof input.canonicalPayload.sourceRoleId !== "string" || !input.canonicalPayload.sourceRoleId
    || input.canonicalPayload.aggregateKey !== delivery.aggregate.aggregateKey
    || input.canonicalPayload.projectionVersion !== delivery.aggregate.projectionVersion
    || input.canonicalPayload.stateVersion !== delivery.aggregate.stateVersion
    || !(input.canonicalPayload.nextDisclosure === "SUSPECTED" || input.canonicalPayload.nextDisclosure === "CONFIRMED")) throw new ServiceUnavailableException({ code: "A_EMOTION_M2_PUBLICATION_REJECTED", message: "M2 canonical payload is invalid" });
}

function assertM3PublicationInput(input: { visibility: string; audienceType: string; audienceRoleIds?: string[]; canonicalPayload: Record<string, unknown>; deliveries: ProjectedDelivery[] }) {
  if (input.visibility !== "PRIVATE" || input.audienceType !== "MEMBER" || input.deliveries.length !== 1) {
    throw new ServiceUnavailableException({ code: "A_EMOTION_M3_PUBLICATION_REJECTED", message: "M3 requires one viewer-scoped private delivery" });
  }
  const delivery = input.deliveries[0];
  if (!delivery.userId || !delivery.roleId || !delivery.aggregate || input.audienceRoleIds?.length !== 1 || input.audienceRoleIds[0] !== delivery.roleId) {
    throw new ServiceUnavailableException({ code: "A_EMOTION_M3_PUBLICATION_REJECTED", message: "M3 delivery ownership is incomplete" });
  }
  const allowed = new Set(["schemaVersion", "transitionId", "sourceResolutionId", "metricKey", "triggerCode", "triggerVersion", "stateVersion"]);
  const value = input.canonicalPayload;
  if (Object.keys(value).some((key) => !allowed.has(key))
    || value.schemaVersion !== "a_emotion_m3_crisis_canonical_v1"
    || typeof value.transitionId !== "string" || !value.transitionId
    || typeof value.sourceResolutionId !== "string" || !value.sourceResolutionId
    || typeof value.metricKey !== "string" || !value.metricKey
    || typeof value.triggerCode !== "string" || !value.triggerCode
    || !Number.isInteger(value.triggerVersion) || Number(value.triggerVersion) < 1
    || !Number.isInteger(value.stateVersion) || Number(value.stateVersion) < 1) {
    throw new ServiceUnavailableException({ code: "A_EMOTION_M3_PUBLICATION_REJECTED", message: "M3 canonical payload is invalid" });
  }
}

function assertM5PublicationInput(input: { visibility: string; audienceType: string; audienceRoleIds?: string[]; canonicalPayload: Record<string, unknown>; deliveries: ProjectedDelivery[] }) {
  if (input.visibility !== "PRIVATE" || input.audienceType !== "MEMBER" || input.deliveries.length !== 1) throw new ServiceUnavailableException({ code: "A_EMOTION_M5_PUBLICATION_REJECTED", message: "M5 requires one viewer-scoped private delivery" });
  const delivery = input.deliveries[0];
  if (!delivery.userId || !delivery.roleId || !delivery.aggregate || input.audienceRoleIds?.length !== 1 || input.audienceRoleIds[0] !== delivery.roleId) throw new ServiceUnavailableException({ code: "A_EMOTION_M5_PUBLICATION_REJECTED", message: "M5 delivery ownership is incomplete" });
  const allowed = new Set(["schemaVersion", "milestoneId", "sourceResolutionId", "milestoneCode", "stateVersion"]);
  const value = input.canonicalPayload;
  if (Object.keys(value).some((key) => !allowed.has(key)) || value.schemaVersion !== "a_emotion_m5_stage_victory_canonical_v1" || typeof value.milestoneId !== "string" || !value.milestoneId || typeof value.sourceResolutionId !== "string" || !value.sourceResolutionId || typeof value.milestoneCode !== "string" || !value.milestoneCode || !Number.isInteger(value.stateVersion) || Number(value.stateVersion) < 1) throw new ServiceUnavailableException({ code: "A_EMOTION_M5_PUBLICATION_REJECTED", message: "M5 canonical payload is invalid" });
}

function assertM5Payload(eventId: string, payload: Record<string, unknown>, expectedEventSequence?: number) {
  if (!isOpaqueAEmotionM2EventId(eventId)) throw new ServiceUnavailableException({ code: "A_EMOTION_M5_EVENT_ID_REJECTED", message: "Milestone event identifier is not opaque" });
  const validation = validateAEmotionM2ProjectionV1(payload);
  if (!validation.ok || validation.value.centerCardType !== "STAGE_VICTORY" || validation.value.eventFamily !== "STAGE_MILESTONE" || validation.value.sharedObjectId !== "stage-milestone") throw new ServiceUnavailableException({ code: "A_EMOTION_M5_DELIVERY_REJECTED", message: "Milestone delivery failed viewer-safety validation" });
  if (!Number.isInteger(expectedEventSequence) || validation.value.eventSequence !== expectedEventSequence) throw new ServiceUnavailableException({ code: "A_EMOTION_M5_EVENT_SEQUENCE_MISMATCH", message: "Milestone event sequence does not match its projection" });
}

function assertM4PublicationInput(input: { visibility: string; audienceType: string; audienceRoleIds?: string[]; canonicalPayload: Record<string, unknown>; deliveries: ProjectedDelivery[] }) {
  if (input.visibility !== "PRIVATE" || input.audienceType !== "MEMBER" || input.deliveries.length !== 1) throw new ServiceUnavailableException({ code: "A_EMOTION_M4_PUBLICATION_REJECTED", message: "M4 requires one viewer-scoped private delivery" });
  const delivery = input.deliveries[0];
  if (!delivery.userId || !delivery.roleId || !delivery.aggregate || input.audienceRoleIds?.length !== 1 || input.audienceRoleIds[0] !== delivery.roleId) throw new ServiceUnavailableException({ code: "A_EMOTION_M4_PUBLICATION_REJECTED", message: "M4 delivery ownership is incomplete" });
  const allowed = new Set(["schemaVersion", "promiseId", "sourceResolutionId", "brokenByActionId", "lifecycleVersion", "stateVersion"]);
  const value = input.canonicalPayload;
  if (Object.keys(value).some((key) => !allowed.has(key)) || value.schemaVersion !== "a_emotion_m4_promise_reveal_canonical_v1" || typeof value.promiseId !== "string" || !value.promiseId || typeof value.sourceResolutionId !== "string" || !value.sourceResolutionId || typeof value.brokenByActionId !== "string" || !value.brokenByActionId || !Number.isInteger(value.lifecycleVersion) || Number(value.lifecycleVersion) < 1 || !Number.isInteger(value.stateVersion) || Number(value.stateVersion) < 1 || value.stateVersion !== value.lifecycleVersion || value.stateVersion !== delivery.aggregate.stateVersion) throw new ServiceUnavailableException({ code: "A_EMOTION_M4_PUBLICATION_REJECTED", message: "M4 canonical payload is invalid" });
}

function assertM4Payload(eventId: string, payload: Record<string, unknown>, expectedEventSequence?: number) {
  if (!isOpaqueAEmotionM2EventId(eventId)) throw new ServiceUnavailableException({ code: "A_EMOTION_M4_EVENT_ID_REJECTED", message: "Promise event identifier is not opaque" });
  const validation = validateAEmotionM2ProjectionV1(payload);
  if (!validation.ok || validation.value.centerCardType !== "PROMISE_BROKEN" || validation.value.eventFamily !== "PROMISE_LIFECYCLE" || validation.value.sharedObjectId !== "formal-promise") throw new ServiceUnavailableException({ code: "A_EMOTION_M4_DELIVERY_REJECTED", message: "Promise delivery failed viewer-safety validation" });
  if (!Number.isInteger(expectedEventSequence) || validation.value.eventSequence !== expectedEventSequence) throw new ServiceUnavailableException({ code: "A_EMOTION_M4_EVENT_SEQUENCE_MISMATCH", message: "Promise event sequence does not match its projection" });
}

function assertM3Payload(eventId: string, payload: Record<string, unknown>, expectedEventSequence?: number) {
  if (!isOpaqueAEmotionM2EventId(eventId)) throw new ServiceUnavailableException({ code: "A_EMOTION_M3_EVENT_ID_REJECTED", message: "Crisis event identifier is not opaque" });
  const validation = validateAEmotionM2ProjectionV1(payload);
  if (!validation.ok || validation.value.centerCardType !== "CRISIS" || validation.value.eventFamily !== "METRIC_THRESHOLD" || validation.value.sharedObjectId !== "metric-pressure") {
    throw new ServiceUnavailableException({ code: "A_EMOTION_M3_DELIVERY_REJECTED", message: "Crisis delivery failed viewer-safety validation" });
  }
  if (!Number.isInteger(expectedEventSequence) || validation.value.eventSequence !== expectedEventSequence) throw new ServiceUnavailableException({ code: "A_EMOTION_M3_EVENT_SEQUENCE_MISMATCH", message: "Crisis event sequence does not match its projection" });
}

function assertM1Payload(eventId: string, payload: Record<string, unknown>, expectedEventSequence?: number) {
  if (!isOpaqueAEmotionM1EventId(eventId)) throw new ServiceUnavailableException({ code: "A_EMOTION_M1_EVENT_ID_REJECTED", message: "Interaction event identifier is not opaque" });
  const validation = validateAEmotionM1ProjectionV1(payload);
  if (!validation.ok) throw new ServiceUnavailableException({ code: "A_EMOTION_M1_DELIVERY_REJECTED", message: "Interaction delivery failed viewer-safety validation" });
  if (!Number.isInteger(expectedEventSequence) || validation.value.eventSequence !== expectedEventSequence) throw new ServiceUnavailableException({ code: "A_EMOTION_M1_EVENT_SEQUENCE_MISMATCH", message: "Interaction delivery sequence does not match its projection" });
}

function assertM2Payload(eventId: string, payload: Record<string, unknown>, expectedEventSequence?: number) {
  if (!isOpaqueAEmotionM2EventId(eventId)) throw new ServiceUnavailableException({ code: "A_EMOTION_M2_EVENT_ID_REJECTED", message: "Interaction event identifier is not opaque" });
  const validation = validateAEmotionM2ProjectionV1(payload);
  if (!validation.ok) throw new ServiceUnavailableException({ code: "A_EMOTION_M2_DELIVERY_REJECTED", message: "Interaction delivery failed viewer-safety validation" });
  if (!Number.isInteger(expectedEventSequence) || validation.value.eventSequence !== expectedEventSequence) throw new ServiceUnavailableException({ code: "A_EMOTION_M2_EVENT_SEQUENCE_MISMATCH", message: "Interaction delivery sequence does not match its projection" });
}

function sameInteractionCanonicalPublication(existing: unknown, requested: Record<string, unknown>, type: string) {
  const value = record(existing);
  if (type === A_EMOTION_M1_EVENT_TYPE) return value.schemaVersion === requested.schemaVersion && value.resolutionId === requested.resolutionId && value.sharedObjectKey === requested.sharedObjectKey && value.stateVersion === requested.stateVersion;
  if (type === A_EMOTION_M4_EVENT_TYPE) return value.schemaVersion === requested.schemaVersion
    && value.promiseId === requested.promiseId
    && value.sourceResolutionId === requested.sourceResolutionId
    && value.brokenByActionId === requested.brokenByActionId
    && value.lifecycleVersion === requested.lifecycleVersion
    && value.stateVersion === requested.stateVersion;
  if (type === A_EMOTION_M5_EVENT_TYPE) return value.schemaVersion === requested.schemaVersion
    && value.milestoneId === requested.milestoneId
    && value.sourceResolutionId === requested.sourceResolutionId
    && value.milestoneCode === requested.milestoneCode
    && value.stateVersion === requested.stateVersion;
  if (type === A_EMOTION_M3_EVENT_TYPE) return value.schemaVersion === requested.schemaVersion
    && value.transitionId === requested.transitionId
    && value.metricKey === requested.metricKey
    && value.triggerCode === requested.triggerCode
    && value.triggerVersion === requested.triggerVersion
    && value.stateVersion === requested.stateVersion
    && value.sourceResolutionId === requested.sourceResolutionId;
  return value.schemaVersion === requested.schemaVersion
    && value.resolutionId === requested.resolutionId
    && value.baseEventId === requested.baseEventId
    && value.aggregateKey === requested.aggregateKey
    && value.projectionVersion === requested.projectionVersion
    && value.stateVersion === requested.stateVersion
    && value.nextDisclosure === requested.nextDisclosure;
}


function staleOrScopedInteractionCursor() {
  return new ConflictException({
    code: "STALE_OR_SCOPED_INTERACTION_CURSOR",
    message: "Interaction cursor is stale or belongs to another viewer"
  });
}

function assertCurrentInteractionCursor(
  rows: InteractionRow[],
  scope: { roomId: string; runId: string; userId: string; roleId: string },
  cursorToken: string
) {
  const candidates = rows.filter((row) => rawInteractionRowCanBindCursor(row, scope));
  const boundary = candidates.find((row) => interactionCursorForRow(scope, row) === cursorToken);
  if (!boundary?.aggregateId || !boundary.aggregateKey) throw staleOrScopedInteractionCursor();

  const latest = candidates
    .filter((row) => row.aggregateId === boundary.aggregateId && row.aggregateKey === boundary.aggregateKey)
    .sort((left, right) => right.projectionVersion - left.projectionVersion
      || right.deliverySequence - left.deliverySequence)[0];
  if (!latest || latest.id !== boundary.id || latest.eventId !== boundary.eventId
    || latest.projectionVersion !== boundary.projectionVersion
    || latest.deliverySequence !== boundary.deliverySequence) {
    throw staleOrScopedInteractionCursor();
  }
}

function rawInteractionRowCanBindCursor(
  row: InteractionRow,
  scope: { roomId: string; runId: string; userId: string; roleId: string }
) {
  return row.roomId === scope.roomId
    && row.userId === scope.userId
    && row.roleId === scope.roleId
    && row.event.id === row.eventId
    && row.event.runId === scope.runId
    && isOpaqueAEmotionM2AggregateId(row.aggregateId)
    && typeof row.aggregateKey === "string"
    && row.aggregateKey.length > 0
    && Number.isInteger(row.projectionVersion)
    && row.projectionVersion >= 1
    && Number.isSafeInteger(row.event.sequence)
    && Number(row.event.sequence) >= 1;
}

function interactionCursorForRow(
  scope: { roomId: string; runId: string; userId: string; roleId: string },
  row: Pick<InteractionRow, "aggregateId" | "projectionVersion"> & { event: { sequence: number | null } }
) {
  const aggregateId = requireText(row.aggregateId, "INTERACTION_AGGREGATE_ID_MISSING");
  const eventSequence = requireInteger(row.event.sequence, "INTERACTION_EVENT_SEQUENCE_MISSING");
  const payload = [scope.roomId, scope.runId, scope.userId, scope.roleId, aggregateId, eventSequence, row.projectionVersion].join("\0");
  return `m2c_${createHash("sha256").update(payload).digest("base64url")}`;
}

function disclosureRank(value: AEmotionM2DisclosureV1) { return value === "HIDDEN" ? 0 : value === "SUSPECTED" ? 1 : 2; }
function opaqueEventId() { return `evt_${randomUUID().replaceAll("-", "")}`; }
function record(value: unknown): Record<string, any> { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {}; }
function requireText(value: unknown, code: string): string { if (typeof value !== "string" || !value) throw new Error(code); return value; }
function requireInteger(value: unknown, code: string): number { if (!Number.isInteger(value)) throw new Error(code); return Number(value); }
