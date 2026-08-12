import { Prisma } from "@prisma/client";
import {
  PRESSURE_CHAPTER_SEAT_IDS_V1,
  type SeatIdV1,
} from "@ai-story/shared";
import type { PrismaService } from "../../prisma.service";
import {
  FrozenAEmotionPresentationCatalogV1,
  type AEmotionPresentationInputPortV1,
  type AEmotionPresentationPortV1,
} from "../a-emotion";
import type {
  AEmotionSeatDeliveryBindingPortV1,
  AEmotionStoryDayPortV1,
} from "../a-emotion-persistence";
import type { PressureGameCapabilityReaderPort } from "../game-projection";
import {
  PrismaCanonicalSeatViewerAuthorityReaderV1,
  PrismaPressureGameCapabilityReaderV1,
  type PressureLiveClockV1,
} from "../live-adapters";
import {
  PRESSURE_PRODUCT_ADAPTER_ERROR_CODES_V1 as ERROR,
  failPressureProductAdapterV1,
} from "./errors";
import { readPinnedPressureRouteV1 } from "./route-authority";

export class PrismaProductPressureGameCapabilityReaderV1
implements PressureGameCapabilityReaderPort {
  private readonly delegate: PrismaPressureGameCapabilityReaderV1;

  constructor(prisma: PrismaService, clock?: PressureLiveClockV1) {
    const viewers = new PrismaCanonicalSeatViewerAuthorityReaderV1(prisma, clock);
    this.delegate = new PrismaPressureGameCapabilityReaderV1(prisma, viewers);
  }

  readCapabilities(input: Parameters<PressureGameCapabilityReaderPort["readCapabilities"]>[0]) {
    return this.delegate.readCapabilities(input);
  }
}

export class PrismaAEmotionSeatDeliveryBindingAdapterV1
implements AEmotionSeatDeliveryBindingPortV1 {
  constructor(private readonly prisma: PrismaService) {}

  async resolve(input: { roomId: string; runId: string; viewerSeatId: SeatIdV1 }) {
    assertRoomAndSeat(input.roomId, input.runId, input.viewerSeatId);
    return this.prisma.$transaction(async (tx) => {
      await readPinnedPressureRouteV1(tx, input.runId);
      const role = await tx.storyRole.findUnique({
        where: { runId_roleKey: { runId: input.runId, roleKey: input.viewerSeatId } },
        select: { id: true, runId: true, roleKey: true },
      });
      if (!role) return null;
      const player = await tx.storyPlayer.findUnique({
        where: { runId_roleId: { runId: input.runId, roleId: role.id } },
        select: { runId: true, roleId: true, userId: true, playerType: true, status: true },
      });
      if (!player) return null;
      if (
        role.runId !== input.runId
        || role.roleKey !== input.viewerSeatId
        || player.runId !== input.runId
        || player.roleId !== role.id
      ) {
        return failPressureProductAdapterV1(ERROR.AUTHORITY_MISMATCH, "StoryPlayer", "SEAT_BINDING");
      }
      if (player.playerType !== "human" || player.status !== "active" || !player.userId?.trim()) {
        return null;
      }
      return { userId: player.userId, roleId: role.id };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }
}

export class PrismaAEmotionStoryDayAdapterV1 implements AEmotionStoryDayPortV1 {
  constructor(private readonly prisma: PrismaService) {}

  async resolve(input: {
    roomId: string;
    runId: string;
    viewerSeatId: SeatIdV1 | null;
    stageId: string;
    occurredAt: string;
    eventSequence: number;
  }): Promise<number> {
    if (input.roomId !== input.runId || !input.runId.trim()) {
      return failPressureProductAdapterV1(ERROR.AUTHORITY_MISMATCH, "roomId", "RUN_ID");
    }
    if (input.viewerSeatId !== null && !PRESSURE_CHAPTER_SEAT_IDS_V1.includes(input.viewerSeatId)) {
      return failPressureProductAdapterV1(ERROR.RECORD_INVALID, "viewerSeatId");
    }
    if (!Number.isSafeInteger(input.eventSequence) || input.eventSequence < 0 || !Number.isFinite(Date.parse(input.occurredAt))) {
      return failPressureProductAdapterV1(ERROR.RECORD_INVALID, "eventEnvelope");
    }
    return this.prisma.$transaction(async (tx) => {
      await readPinnedPressureRouteV1(tx, input.runId);
      if (input.stageId === "P0") return 0;
      const match = /^N([1-7])$/.exec(input.stageId);
      if (match) {
        const day = Number(match[1]);
        const runtime = await tx.pressureChapterRuntime.findUnique({
          where: { runId_chapterId: { runId: input.runId, chapterId: input.stageId } },
          select: { runId: true, chapterId: true, chapterSequence: true },
        });
        if (!runtime) {
          return failPressureProductAdapterV1(ERROR.AUTHORITY_NOT_FOUND, "PressureChapterRuntime", input.stageId);
        }
        if (runtime.runId !== input.runId || runtime.chapterId !== input.stageId || runtime.chapterSequence !== day) {
          return failPressureProductAdapterV1(ERROR.AUTHORITY_MISMATCH, "PressureChapterRuntime", "STAGE_SEQUENCE");
        }
        return day;
      }
      if (input.stageId === "FINALE") {
        const run = await tx.storyRun.findUnique({
          where: { id: input.runId },
          select: { id: true, currentNodeId: true, worldSequence: true },
        });
        if (!run) {
          return failPressureProductAdapterV1(ERROR.AUTHORITY_NOT_FOUND, "StoryRun", input.runId);
        }
        if (run.id !== input.runId || run.currentNodeId !== "FINALE" || run.worldSequence !== 7) {
          return failPressureProductAdapterV1(ERROR.AUTHORITY_MISMATCH, "StoryRun", "FINALE_STAGE");
        }
        return 7;
      }
      if (input.stageId === "A_EMOTION_DELIVERY") {
        const run = await tx.storyRun.findUnique({
          where: { id: input.runId },
          select: { id: true, currentNodeId: true, worldSequence: true },
        });
        if (!run || run.id !== input.runId) {
          return failPressureProductAdapterV1(ERROR.AUTHORITY_NOT_FOUND, "StoryRun", input.runId);
        }
        if (run.currentNodeId === "P0" && run.worldSequence === 0) return 0;
        const current = /^N([1-7])$/.exec(run.currentNodeId ?? "");
        if (current && run.worldSequence >= Number(current[1]) - 1 && run.worldSequence <= Number(current[1])) {
          return Number(current[1]);
        }
        if (run.currentNodeId === "FINALE" && run.worldSequence === 7) return 7;
        return failPressureProductAdapterV1(ERROR.AUTHORITY_MISMATCH, "StoryRun.currentNodeId", "WORLD_SEQUENCE");
      }
      return failPressureProductAdapterV1(ERROR.UNSUPPORTED_STAGE, "stageId", input.stageId);
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }
}

export class FrozenAEmotionPresentationAdapterV1 implements AEmotionPresentationPortV1 {
  private readonly delegate = new FrozenAEmotionPresentationCatalogV1();

  render(input: AEmotionPresentationInputPortV1) {
    return this.delegate.render(input);
  }

  /** Temporary compatibility alias for the ProductRoot reflection guard. */
  present(input: AEmotionPresentationInputPortV1) {
    return this.render(input);
  }
}

function assertRoomAndSeat(roomId: string, runId: string, seatId: SeatIdV1): void {
  if (!runId.trim() || roomId !== runId) {
    failPressureProductAdapterV1(ERROR.AUTHORITY_MISMATCH, "roomId", "RUN_ID");
  }
  if (!PRESSURE_CHAPTER_SEAT_IDS_V1.includes(seatId)) {
    failPressureProductAdapterV1(ERROR.RECORD_INVALID, "viewerSeatId");
  }
}
