import { ForbiddenException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { EVENT_DELIVERY_PAGE_SCHEMA_VERSION, type EventDeliveryPageV1 } from "@ai-story/shared";
import type { AuthenticatedUser } from "../auth/current-user.decorator";
import { PrismaService } from "../prisma.service";

type Tx = Prisma.TransactionClient;

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
  }) {
    const existing = await tx.storyEvent.findUnique({ where: { dedupeKey: input.dedupeKey } });
    if (existing) return existing;

    const existingEventCursor = await tx.storyEventCursor.findUnique({ where: { runId: input.runId }, select: { runId: true } });
    if (!existingEventCursor) {
      await tx.storyEventCursor.create({ data: { runId: input.runId, nextSequence: 1 } });
    }
    const cursor = await tx.storyEventCursor.update({
      where: { runId: input.runId },
      data: { nextSequence: { increment: 1 }, version: { increment: 1 } }
    });
    const event = await tx.storyEvent.create({
      data: {
        id: `evt_${input.dedupeKey}`,
        runId: input.runId,
        day: input.day,
        type: input.type,
        messageType: input.messageType || "system",
        roleKey: input.roleKey,
        visibility: input.visibility,
        payloadJson: input.payload as Prisma.InputJsonValue,
        sequence: cursor.nextSequence - 1,
        dedupeKey: input.dedupeKey,
        audienceType: input.audienceType,
        audienceRoleIdsJson: (input.audienceRoleIds || []) as Prisma.InputJsonValue,
        sourceActionId: input.sourceActionId
      }
    });

    for (const userId of [...new Set(input.audienceUserIds)]) {
      const cursorKey = { roomId: input.runId, userId };
      const existingDeliveryCursor = await tx.eventDeliveryCursor.findUnique({
        where: { roomId_userId: cursorKey },
        select: { id: true }
      });
      if (!existingDeliveryCursor) {
        await tx.eventDeliveryCursor.create({ data: { ...cursorKey, nextSequence: 1 } });
      }
      const deliveryCursor = await tx.eventDeliveryCursor.update({
        where: { roomId_userId: cursorKey },
        data: { nextSequence: { increment: 1 }, version: { increment: 1 } }
      });
      const roleId = input.audienceRoleIds?.length === 1 ? input.audienceRoleIds[0] : undefined;
      await tx.eventDelivery.create({
        data: {
          eventId: event.id,
          roomId: input.runId,
          userId,
          roleId,
          deliverySequence: deliveryCursor.nextSequence - 1,
          payloadJson: {
            type: input.type,
            visibility: input.visibility,
            eventSequence: event.sequence,
            payload: input.payload
          } as Prisma.InputJsonValue
        }
      });
    }
    return event;
  }

  async page(user: AuthenticatedUser, roomId: string, afterDeliverySequence = 0, pageSize = 100): Promise<EventDeliveryPageV1> {
    const run = await this.prisma.storyRun.findUnique({
      where: { id: roomId },
      select: { id: true, mode: true, players: { where: { userId: user.id, status: "active" }, select: { id: true } } }
    });
    if (!run || run.mode !== "room") throw new NotFoundException({ code: "ROOM_NOT_FOUND", message: "Room not found" });
    if (!run.players.length) throw new ForbiddenException({ code: "ROOM_MEMBERSHIP_REQUIRED", message: "Room membership required" });
    const normalizedAfter = Number.isSafeInteger(afterDeliverySequence) && afterDeliverySequence >= 0 ? afterDeliverySequence : 0;
    const take = Math.max(1, Math.min(100, pageSize));
    const rows = await this.prisma.eventDelivery.findMany({
      where: { roomId, userId: user.id, deliverySequence: { gt: normalizedAfter } },
      orderBy: { deliverySequence: "asc" },
      take: take + 1,
      select: { eventId: true, deliverySequence: true, payloadJson: true, deliveredAt: true }
    });
    const hasMore = rows.length > take;
    const page = rows.slice(0, take);
    const deliveries = page.map((row) => {
      const envelope = row.payloadJson as Record<string, unknown>;
      return {
        deliverySequence: row.deliverySequence,
        eventId: row.eventId,
        eventType: String(envelope.type || "UNKNOWN"),
        payload: envelope.payload && typeof envelope.payload === "object" && !Array.isArray(envelope.payload)
          ? envelope.payload as Record<string, unknown>
          : {},
        createdAt: row.deliveredAt.toISOString()
      };
    });
    return {
      schemaVersion: EVENT_DELIVERY_PAGE_SCHEMA_VERSION,
      deliveries,
      nextAfterDeliverySequence: page.at(-1)?.deliverySequence ?? normalizedAfter,
      hasMore
    };
  }
}
