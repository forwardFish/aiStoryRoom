import { Prisma } from "@prisma/client";
import { PRESSURE_CHAPTER_ROUTE_V1 } from "@ai-story/shared";
import type {
  PressureChapterHttpAccessPort,
  PressureChapterHttpAccessV1,
} from "../http/contracts";
import type {
  PressureChapterHttpProductionAccessRowV1,
  PressureChapterHttpProductionPrismaPortV1,
} from "./ports";

const ROUTE_SCHEMA_VERSION = "pressure_run_route_snapshot_v1";
const HUMAN_PLAYER_TYPE = "human";
const ACTIVE_PLAYER_STATUS = "active";

/**
 * Authorizes one authenticated human against one exact StoryRun with one
 * parameterized read. It returns no seat, private projection, or route JSON.
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

    const rows = await this.prisma.$queryRaw<PressureChapterHttpProductionAccessRowV1[]>(
      Prisma.sql`
        SELECT
          run."id" AS "runId",
          run."engineVersion" AS "runEngineVersion",
          run."strategyVersion" AS "runStrategyVersion",
          route."runId" AS "routeRunId",
          route."schemaVersion" AS "routeSchemaVersion",
          route."engineVersion" AS "routeEngineVersion",
          route."strategyVersion" AS "routeStrategyVersion",
          route."runtimeProfile" AS "routeRuntimeProfile",
          route."participantMode" AS "routeParticipantMode",
          membership."runId" AS "membershipRunId",
          membership."userId" AS "membershipUserId",
          membership."playerType" AS "membershipPlayerType",
          membership."status" AS "membershipStatus"
        FROM "StoryRun" AS run
        INNER JOIN "PressureRunRouteSnapshot" AS route
          ON route."runId" = run."id"
        INNER JOIN (
          SELECT
            candidate."runId",
            candidate."userId",
            candidate."playerType",
            candidate."status",
            COUNT(*) OVER () AS "candidateCount"
          FROM "StoryPlayer" AS candidate
          WHERE candidate."runId" = ${input.roomId}
            AND candidate."userId" = ${input.subjectId}
          LIMIT 2
        ) AS membership
          ON membership."runId" = run."id"
         AND membership."candidateCount" = 1
         AND membership."playerType" = ${HUMAN_PLAYER_TYPE}
         AND membership."status" = ${ACTIVE_PLAYER_STATUS}
        WHERE run."id" = ${input.roomId}
          AND run."engineVersion" = ${PRESSURE_CHAPTER_ROUTE_V1.engineVersion}
          AND run."strategyVersion" = ${PRESSURE_CHAPTER_ROUTE_V1.strategyVersion}
          AND route."runId" = run."id"
          AND route."schemaVersion" = ${ROUTE_SCHEMA_VERSION}
          AND route."engineVersion" = ${PRESSURE_CHAPTER_ROUTE_V1.engineVersion}
          AND route."strategyVersion" = ${PRESSURE_CHAPTER_ROUTE_V1.strategyVersion}
          AND route."runtimeProfile" = ${PRESSURE_CHAPTER_ROUTE_V1.runtimeProfile}
        LIMIT 2
      `,
    );
    if (!Array.isArray(rows) || rows.length !== 1) return null;

    const row = rows[0];
    if (!isCanonicalPressureAccessRow(row, input.roomId, input.subjectId)) {
      return null;
    }
    return {
      schemaVersion: "pressure_chapter_http_access_v1",
      roomId: row.runId,
      runId: row.runId,
      subjectId: input.subjectId,
      viewerId: input.viewerId,
      ...(row.routeParticipantMode === "SOLO" || row.routeParticipantMode === "MULTIPLAYER"
        ? { participantMode: row.routeParticipantMode }
        : {}),
    };
  }
}

function isCanonicalPressureAccessRow(
  row: PressureChapterHttpProductionAccessRowV1 | undefined,
  roomId: string,
  subjectId: string,
): row is PressureChapterHttpProductionAccessRowV1 {
  return Boolean(
    row
    && row.runId === roomId
    && row.runEngineVersion === PRESSURE_CHAPTER_ROUTE_V1.engineVersion
    && row.runStrategyVersion === PRESSURE_CHAPTER_ROUTE_V1.strategyVersion
    && row.routeRunId === row.runId
    && row.routeSchemaVersion === ROUTE_SCHEMA_VERSION
    && row.routeEngineVersion === PRESSURE_CHAPTER_ROUTE_V1.engineVersion
    && row.routeStrategyVersion === PRESSURE_CHAPTER_ROUTE_V1.strategyVersion
    && row.routeRuntimeProfile === PRESSURE_CHAPTER_ROUTE_V1.runtimeProfile
    && (
      row.routeParticipantMode === undefined
      || row.routeParticipantMode === "SOLO"
      || row.routeParticipantMode === "MULTIPLAYER"
    )
    && row.membershipRunId === row.runId
    && row.membershipUserId === subjectId
    && row.membershipPlayerType === HUMAN_PLAYER_TYPE
    && row.membershipStatus === ACTIVE_PLAYER_STATUS,
  );
}

function nonEmpty(value: string): boolean {
  return typeof value === "string" && value.trim().length > 0;
}
