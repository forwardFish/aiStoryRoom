import { PRESSURE_CHAPTER_ROUTE_V1 } from "@ai-story/shared";
import type {
  PressureChapterHttpAccessPort,
  PressureChapterHttpAccessV1,
} from "../http/contracts";
import type { PressureChapterHttpProductionPrismaPortV1 } from "./ports";

const ROUTE_SCHEMA_VERSION = "pressure_run_route_snapshot_v1";

/**
 * Authorizes one authenticated human against one exact StoryRun. It performs
 * only two narrow reads and returns no seat or route data to the caller.
 */
export class PrismaPressureChapterHttpAccessAdapterV1
implements PressureChapterHttpAccessPort {
  constructor(
    private readonly prisma: PressureChapterHttpProductionPrismaPortV1,
  ) {}

  async authorize(input: {
    roomId: string;
    subjectId: string;
    viewerId: string;
  }): Promise<PressureChapterHttpAccessV1 | null> {
    if (
      !nonEmpty(input.roomId)
      || !nonEmpty(input.subjectId)
      || !nonEmpty(input.viewerId)
      || input.subjectId !== input.viewerId
    ) {
      return null;
    }

    const run = await this.prisma.storyRun.findUnique({
      where: { id: input.roomId },
      select: {
        id: true,
        engineVersion: true,
        strategyVersion: true,
        pressureRouteSnapshot: {
          select: {
            runId: true,
            schemaVersion: true,
            engineVersion: true,
            strategyVersion: true,
            runtimeProfile: true,
          },
        },
      },
    });
    if (!isCanonicalPressureRun(run, input.roomId)) return null;

    const membership = await this.prisma.storyPlayer.findUnique({
      where: {
        runId_userId: {
          runId: run.id,
          userId: input.subjectId,
        },
      },
      select: {
        runId: true,
        userId: true,
        playerType: true,
        status: true,
      },
    });
    if (
      !membership
      || membership.runId !== run.id
      || membership.userId !== input.subjectId
      || membership.playerType !== "human"
      || membership.status !== "active"
    ) {
      return null;
    }

    return {
      schemaVersion: "pressure_chapter_http_access_v1",
      roomId: run.id,
      runId: run.id,
      subjectId: input.subjectId,
      viewerId: input.viewerId,
    };
  }
}

function isCanonicalPressureRun(
  run: Awaited<ReturnType<PressureChapterHttpProductionPrismaPortV1["storyRun"]["findUnique"]>>,
  roomId: string,
): run is NonNullable<typeof run> {
  const route = run?.pressureRouteSnapshot;
  return Boolean(
    run
    && route
    && run.id === roomId
    && run.engineVersion === PRESSURE_CHAPTER_ROUTE_V1.engineVersion
    && run.strategyVersion === PRESSURE_CHAPTER_ROUTE_V1.strategyVersion
    && route.runId === run.id
    && route.schemaVersion === ROUTE_SCHEMA_VERSION
    && route.engineVersion === PRESSURE_CHAPTER_ROUTE_V1.engineVersion
    && route.strategyVersion === PRESSURE_CHAPTER_ROUTE_V1.strategyVersion
    && route.runtimeProfile === PRESSURE_CHAPTER_ROUTE_V1.runtimeProfile,
  );
}

function nonEmpty(value: string): boolean {
  return typeof value === "string" && value.trim().length > 0;
}
