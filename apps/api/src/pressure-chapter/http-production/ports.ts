import type { Prisma } from "@prisma/client";

export interface PressureChapterHttpProductionRouteRowV1 {
  runId: string;
  schemaVersion: string;
  engineVersion: string;
  strategyVersion: string;
  runtimeProfile: string;
}

export interface PressureChapterHttpProductionRunRowV1 {
  id: string;
  engineVersion: string;
  strategyVersion: string;
  pressureRouteSnapshot: PressureChapterHttpProductionRouteRowV1 | null;
}

export interface PressureChapterHttpProductionMembershipRowV1 {
  runId: string;
  userId: string | null;
  playerType: string;
  status: string;
}

export interface PressureChapterHttpProductionAccessRowV1 {
  runId: string;
  runEngineVersion: string;
  runStrategyVersion: string;
  routeRunId: string;
  routeSchemaVersion: string;
  routeEngineVersion: string;
  routeStrategyVersion: string;
  routeRuntimeProfile: string;
  membershipRunId: string;
  membershipUserId: string | null;
  membershipPlayerType: string;
  membershipStatus: string;
}

/**
 * Read-only raw-query capability required by the production access adapter.
 * The adapter owns the fixed narrow statement and must not select seat, secret,
 * private projection, or full route JSON data.
 */
export interface PressureChapterHttpProductionPrismaPortV1 {
  $queryRaw<T = unknown>(query: Prisma.Sql): Promise<T>;
}
