import {
  validateWorldStateV1,
  type WorldStateV1,
} from "@ai-story/shared";
import type { StoredRunRouteReaderPort, StoredRunRouteRecordV1 } from "../run-router";
import { assertStoredRunRouteRecord } from "../run-router";
import {
  SangtianPressureGameWorldReaderAdapterV1,
  type AuthoritativePressureGameWorldSourcePort,
} from "../integration/game-projection.adapters";
import type { PressureGameWorldReaderPort } from "../game-projection/contracts";
import {
  PRESSURE_LIVE_ADAPTER_ERROR_CODES as ERROR,
  failLiveAdapter,
} from "./errors";

interface StoredRouteRowV1 {
  runId: string;
  routeHash: string;
  routeJson: unknown;
}

export interface PressureRouteReadPrismaLikeV1 {
  pressureRunRouteSnapshot: {
    findUnique(input: {
      where: { runId: string };
      select: { runId: true; routeHash: true; routeJson: true };
    }): Promise<StoredRouteRowV1 | null>;
  };
}

/** Lossless, single-row RunRoute read. It exposes no mutation capability. */
export class PrismaStoredRunRouteReaderAdapterV1
implements StoredRunRouteReaderPort {
  constructor(private readonly prisma: PressureRouteReadPrismaLikeV1) {}

  async readStoredRoute(runId: string): Promise<StoredRunRouteRecordV1> {
    if (!runId.trim()) invalid("PressureRunRouteSnapshot", "RUN_ID_EMPTY");
    const row = await this.prisma.pressureRunRouteSnapshot.findUnique({
      where: { runId },
      select: { runId: true, routeHash: true, routeJson: true },
    });
    if (!row) {
      return failLiveAdapter(ERROR.AUTHORITY_NOT_FOUND, "PressureRunRouteSnapshot", runId);
    }
    try {
      const record = assertStoredRunRouteRecord(row.routeJson as StoredRunRouteRecordV1);
      if (record.runId !== row.runId || record.snapshot.routeHash !== row.routeHash) {
        invalid("PressureRunRouteSnapshot", "ROW_BINDING_MISMATCH");
      }
      return structuredClone(record);
    } catch (cause) {
      if (cause instanceof Error && cause.name === "PressureLiveAdapterError") throw cause;
      return invalid(
        "PressureRunRouteSnapshot",
        cause instanceof Error ? cause.message : String(cause),
      );
    }
  }
}

interface StoryRunWorldRowV1 {
  id: string;
  worldSequence: number;
  stateJson: unknown;
  pressureRouteSnapshot: { routeHash: string } | null;
}

export interface PressureWorldReadPrismaLikeV1 {
  storyRun: {
    findUnique(input: {
      where: { id: string };
      select: {
        id: true;
        worldSequence: true;
        stateJson: true;
        pressureRouteSnapshot: { select: { routeHash: true } };
      };
    }): Promise<StoryRunWorldRowV1 | null>;
  };
}

/**
 * Reads only the committed StoryRun world head. Working/narrative/result rows
 * are intentionally absent from this Prisma capability.
 */
export class PrismaAuthoritativePressureGameWorldSourceV1
implements AuthoritativePressureGameWorldSourcePort {
  constructor(private readonly prisma: PressureWorldReadPrismaLikeV1) {}

  async readCurrentWorld(runId: string): Promise<Readonly<{
    runId: string;
    routeHash: string;
    worldState: WorldStateV1;
  }> | null> {
    if (!runId.trim()) invalid("StoryRun.world", "RUN_ID_EMPTY");
    const row = await this.prisma.storyRun.findUnique({
      where: { id: runId },
      select: {
        id: true,
        worldSequence: true,
        stateJson: true,
        pressureRouteSnapshot: { select: { routeHash: true } },
      },
    });
    if (!row) return null;
    if (row.id !== runId || !row.pressureRouteSnapshot) {
      invalid("StoryRun.world", "ROUTE_BINDING_MISSING");
    }
    let world: WorldStateV1;
    try {
      world = validateWorldStateV1(row.stateJson);
    } catch (cause) {
      return invalid(
        "StoryRun.stateJson",
        cause instanceof Error ? cause.message : String(cause),
      );
    }
    if (world.worldSequence !== row.worldSequence) {
      invalid("StoryRun.world", "WORLD_SEQUENCE_MISMATCH");
    }
    return {
      runId,
      routeHash: row.pressureRouteSnapshot.routeHash,
      worldState: structuredClone(world),
    };
  }
}

export function createPrismaPressureGameWorldReaderV1(
  prisma: PressureWorldReadPrismaLikeV1,
): PressureGameWorldReaderPort {
  return new SangtianPressureGameWorldReaderAdapterV1(
    new PrismaAuthoritativePressureGameWorldSourceV1(prisma),
  );
}

function invalid(authority: string, detail: string): never {
  return failLiveAdapter(ERROR.RECORD_INVALID, authority, detail);
}
