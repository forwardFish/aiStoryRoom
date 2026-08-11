import { ConflictException, Inject, Injectable, NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import {
  A_EMOTION_KEY_MODAL_RECEIPT_SCHEMA_VERSION,
  validateAEmotionKeyModalReceiptV1,
  validateAEmotionKeyModalV1,
  type AEmotionKeyModalReceiptV1,
  type AEmotionKeyModalV1
} from "@ai-story/shared";
import type { AuthenticatedUser } from "../auth/current-user.decorator";
import { PrismaService } from "../prisma.service";
import { isAEmotionM2EnabledForRun } from "../config/a-emotion-m2.config";

@Injectable()
export class AEmotionKeyModalService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async pending(user: AuthenticatedUser, roomId: string): Promise<AEmotionKeyModalV1[]> {
    const membership = await this.membership(user, roomId);
    if (!isAEmotionKeyModalEnabledForRun(membership.run)) return [];
    const rows = await this.prisma.aEmotionKeyModal.findMany({
      where: {
        runId: roomId,
        viewerUserId: user.id,
        viewerRoleId: membership.roleId,
        shownAt: null,
        acknowledgedAt: null
      },
      orderBy: [{ priority: "desc" }, { createdAt: "asc" }],
      take: 8
    });
    const result: AEmotionKeyModalV1[] = [];
    for (const row of rows) {
      const validation = validateAEmotionKeyModalV1(row.projectionJson);
      if (!validation.ok
        || validation.value.modalId !== row.id
        || validation.value.eventId !== row.eventId
        || validation.value.triggerVersion !== row.triggerVersion
        || validation.value.projectionVersion !== row.projectionVersion
        || validation.value.stateVersion !== row.stateVersion
        || validation.value.priority !== row.priority) {
        throw new ServiceUnavailableException({ code: "A_EMOTION_KEY_MODAL_STATE_MISMATCH", message: "Key modal state is inconsistent" });
      }
      result.push(validation.value);
    }
    return result;
  }

  markShown(user: AuthenticatedUser, roomId: string, modalId: string, projectionVersion: number, triggerVersion: number) {
    return this.mutate(user, roomId, modalId, projectionVersion, triggerVersion, "shown");
  }

  acknowledge(user: AuthenticatedUser, roomId: string, modalId: string, projectionVersion: number, triggerVersion: number) {
    return this.mutate(user, roomId, modalId, projectionVersion, triggerVersion, "acknowledged");
  }

  private async mutate(
    user: AuthenticatedUser,
    roomId: string,
    modalId: string,
    projectionVersion: number,
    triggerVersion: number,
    kind: "shown" | "acknowledged"
  ): Promise<AEmotionKeyModalReceiptV1> {
    if (!modalId || !Number.isInteger(projectionVersion) || projectionVersion < 1 || !Number.isInteger(triggerVersion) || triggerVersion < 1) {
      throw new ConflictException({ code: "STALE_KEY_MODAL_VERSION", message: "Key modal version is stale" });
    }
    const membership = await this.membership(user, roomId);
    if (!isAEmotionKeyModalEnabledForRun(membership.run)) throw new NotFoundException({ code: "KEY_MODAL_NOT_FOUND", message: "Key modal not found" });
    return this.prisma.$transaction(async (tx) => {
      await lockModal(tx, roomId, user.id, modalId);
      const row = await tx.aEmotionKeyModal.findFirst({
        where: { id: modalId, runId: roomId, viewerUserId: user.id, viewerRoleId: membership.roleId }
      });
      if (!row) throw new NotFoundException({ code: "KEY_MODAL_NOT_FOUND", message: "Key modal not found" });
      if (row.projectionVersion !== projectionVersion || row.triggerVersion !== triggerVersion) {
        throw new ConflictException({ code: "STALE_KEY_MODAL_VERSION", message: "Key modal version is stale" });
      }
      const projection = validateAEmotionKeyModalV1(row.projectionJson);
      if (!projection.ok || projection.value.modalId !== row.id || projection.value.eventId !== row.eventId
        || projection.value.triggerVersion !== row.triggerVersion || projection.value.projectionVersion !== row.projectionVersion
        || projection.value.stateVersion !== row.stateVersion) {
        throw new ServiceUnavailableException({ code: "A_EMOTION_KEY_MODAL_STATE_MISMATCH", message: "Key modal state is inconsistent" });
      }
      const now = new Date();
      if (kind === "shown") {
        if (!row.shownAt) await tx.aEmotionKeyModal.update({ where: { id: row.id }, data: { shownAt: now } });
      } else {
        if (!row.shownAt) throw new ConflictException({ code: "KEY_MODAL_NOT_SHOWN", message: "Key modal must be shown before acknowledgement" });
        if (!row.acknowledgedAt) await tx.aEmotionKeyModal.update({ where: { id: row.id }, data: { acknowledgedAt: now } });
      }
      const updated = await tx.aEmotionKeyModal.findUniqueOrThrow({ where: { id: row.id } });
      const receipt: AEmotionKeyModalReceiptV1 = {
        schemaVersion: A_EMOTION_KEY_MODAL_RECEIPT_SCHEMA_VERSION,
        modalId: updated.id,
        eventId: updated.eventId,
        projectionVersion: updated.projectionVersion,
        stateVersion: updated.stateVersion,
        triggerVersion: updated.triggerVersion,
        shownAt: (updated.shownAt || now).toISOString(),
        acknowledgedAt: updated.acknowledgedAt?.toISOString() || null
      };
      const validation = validateAEmotionKeyModalReceiptV1(receipt);
      if (!validation.ok) throw new ServiceUnavailableException({ code: "A_EMOTION_KEY_MODAL_RECEIPT_REJECTED", message: "Key modal receipt failed validation" });
      return validation.value;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  private async membership(user: AuthenticatedUser, roomId: string) {
    const run = await this.prisma.storyRun.findUnique({
      where: { id: roomId },
      select: {
        id: true,
        mode: true,
        maxPlayers: true,
        templateKey: true,
        engineVersion: true,
        stateJson: true,
        players: { where: { userId: user.id, status: "active", playerType: "human" }, select: { roleId: true } }
      }
    });
    if (!run || run.mode !== "room") throw new NotFoundException({ code: "ROOM_NOT_FOUND", message: "Room not found" });
    const roleId = run.players[0]?.roleId;
    if (!roleId) throw new NotFoundException({ code: "KEY_MODAL_NOT_FOUND", message: "Key modal not found" });
    return { roleId, run };
  }
}

async function lockModal(tx: Prisma.TransactionClient, roomId: string, userId: string, modalId: string) {
  const name = `aemotion:key-modal:${roomId}:${userId}:${modalId}`;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${name}, 0))`;
}

function isAEmotionKeyModalEnabledForRun(run: { mode: string; maxPlayers: number; templateKey: string; engineVersion: string; stateJson: unknown }) {
  if (!isAEmotionM2EnabledForRun(run)) return false;
  const root = record(run.stateJson);
  const flags = record(root.featureFlags);
  return flags.aEmotionKeyModals === true;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
