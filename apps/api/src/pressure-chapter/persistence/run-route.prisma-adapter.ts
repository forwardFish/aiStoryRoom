import { Prisma } from "@prisma/client";
import {
  assertStoredRunRouteRecord,
  type RunRouteRepositoryPort,
  type StoredRunRouteRecordV1,
} from "../run-router";
import {
  PRESSURE_PERSISTENCE_ERROR_CODES as ERROR,
  PressurePersistenceError,
} from "./errors";
import {
  isUniqueConflict,
  pressureSerializableTransaction,
  type PressureSerializableClient,
} from "./transaction";

interface StoredRouteRow {
  runId: string;
  routeHash: string;
  routeJson: unknown;
}

interface RunRouteTransaction {
  pressureRunRouteSnapshot: {
    findUnique(input: {
      where: { runId: string };
      select: { runId: true; routeHash: true; routeJson: true };
    }): Promise<StoredRouteRow | null>;
    create(input: { data: Record<string, unknown> }): Promise<StoredRouteRow>;
  };
}

export type RunRoutePrismaClient = PressureSerializableClient<RunRouteTransaction>;

/**
 * Lossless Run Router persistence. routeJson deliberately stores the complete
 * StoredRunRouteRecordV1; the scalar columns remain independently queryable.
 */
export class PrismaRunRouteRepository implements RunRouteRepositoryPort {
  constructor(private readonly prisma: RunRoutePrismaClient) {}

  async findByRunId(runId: string): Promise<StoredRunRouteRecordV1 | null> {
    return pressureSerializableTransaction(this.prisma, async (tx) => {
      const row = await tx.pressureRunRouteSnapshot.findUnique({
        where: { runId },
        select: { runId: true, routeHash: true, routeJson: true },
      });
      return row ? decodeStoredRoute(row) : null;
    });
  }

  async insertIfAbsent(recordValue: StoredRunRouteRecordV1): Promise<{
    status: "INSERTED" | "EXISTING";
    record: StoredRunRouteRecordV1;
  }> {
    const record = structuredClone(assertStoredRunRouteRecord(recordValue));
    try {
      return await pressureSerializableTransaction(this.prisma, async (tx) => {
        const existing = await tx.pressureRunRouteSnapshot.findUnique({
          where: { runId: record.runId },
          select: { runId: true, routeHash: true, routeJson: true },
        });
        if (existing) {
          return { status: "EXISTING" as const, record: decodeStoredRoute(existing) };
        }
        const snapshot = record.snapshot;
        const row = await tx.pressureRunRouteSnapshot.create({
          data: {
            runId: record.runId,
            schemaVersion: snapshot.schemaVersion,
            engineVersion: snapshot.route.engineVersion,
            strategyVersion: snapshot.route.strategyVersion,
            runtimeProfile: snapshot.route.runtimeProfile,
            endgamePolicyVersion: snapshot.route.endgamePolicyVersion,
            resultSchemaVersion: snapshot.route.resultSchemaVersion,
            contentPackageVersion: snapshot.contentPackageVersion,
            contentPackageSha256: snapshot.contentPackageSha256,
            orchestrationPackageVersion: snapshot.orchestrationPackageVersion,
            orchestrationPackageSha256: snapshot.orchestrationPackageSha256,
            runtimeContractVersion: snapshot.runtimeContractVersion,
            runtimeContractSha256: snapshot.runtimeContractSha256,
            testMatrixVersion: snapshot.testMatrixVersion,
            testMatrixSha256: snapshot.testMatrixSha256,
            runSeed: snapshot.runSeed,
            narrativeProfileVersion: snapshot.narrativeProfileVersion,
            featureSetVersion: snapshot.featureSetVersion,
            resultContractRegistryVersion: snapshot.resultContractRegistryVersion,
            participantMode: snapshot.participantMode,
            seatIdsJson: json(snapshot.seatIds),
            humanSeatIdsAtStartJson: json(snapshot.humanSeatIdsAtStart),
            controlTopologyVersion: snapshot.controlTopologyVersion,
            initialRoleControlSnapshotHash: snapshot.initialRoleControlSnapshotHash,
            routeJson: json(record),
            routeHash: snapshot.routeHash,
          },
        });
        return { status: "INSERTED" as const, record: decodeStoredRoute(row) };
      });
    } catch (error) {
      if (!isUniqueConflict(error)) throw error;
      const concurrent = await this.findByRunId(record.runId);
      if (concurrent) return { status: "EXISTING", record: concurrent };
      throw error;
    }
  }
}

function decodeStoredRoute(row: StoredRouteRow): StoredRunRouteRecordV1 {
  try {
    const record = assertStoredRunRouteRecord(row.routeJson as StoredRunRouteRecordV1);
    if (record.runId !== row.runId || record.snapshot.routeHash !== row.routeHash) {
      throw new Error("ROW_BINDING_MISMATCH");
    }
    return structuredClone(record);
  } catch (cause) {
    if (cause instanceof PressurePersistenceError) throw cause;
    throw new PressurePersistenceError(
      ERROR.RECORD_INVALID,
      "Pressure Run route row does not contain a lossless stored route record",
      { runId: row.runId, cause: cause instanceof Error ? cause.message : String(cause) },
    );
  }
}

function json(value: unknown): Prisma.InputJsonValue {
  return structuredClone(value) as Prisma.InputJsonValue;
}
