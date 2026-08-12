import { Prisma } from "@prisma/client";
import {
  validateRunRouteSnapshotV1,
  validateReplayCreationReceiptV1,
  type ReplayCreationReceiptV1,
  type RunRouteSnapshotV1,
} from "@ai-story/shared";
import type { PressurePersistenceTx } from "./cas";
import { assertIdempotencyFingerprint } from "./cas";
import {
  PRESSURE_PERSISTENCE_ERROR_CODES as ERROR,
  PressurePersistenceError,
} from "./errors";
import {
  assertPressureOutboxTaskType,
  pressureAudienceKey,
  type PressureOutboxTaskTypeV1,
} from "./vocabulary";

const json = (value: unknown): Prisma.InputJsonValue => value as Prisma.InputJsonValue;

export async function insertRunRouteSnapshot(
  tx: PressurePersistenceTx,
  rawSnapshot: RunRouteSnapshotV1,
) {
  const snapshot = validateRunRouteSnapshotV1(rawSnapshot);
  try {
    return await tx.pressureRunRouteSnapshot.create({
      data: {
        runId: snapshot.runId,
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
        routeJson: json(snapshot),
        routeHash: snapshot.routeHash,
      },
    });
  } catch (error) {
    if (!isUniqueConflict(error)) throw error;
    const existing = await tx.pressureRunRouteSnapshot.findUnique({
      where: { runId: snapshot.runId },
    });
    if (existing?.routeHash === snapshot.routeHash) return existing;
    throw new PressurePersistenceError(
      ERROR.FINGERPRINT_MISMATCH,
      "A Pressure Run route is already frozen with a different routeHash",
      { runId: snapshot.runId, routeHash: snapshot.routeHash, storedRouteHash: existing?.routeHash },
    );
  }
}

export async function readRunRouteSnapshot(
  tx: PressurePersistenceTx,
  runId: string,
): Promise<RunRouteSnapshotV1 | null> {
  const stored = await tx.pressureRunRouteSnapshot.findUnique({ where: { runId } });
  if (!stored) return null;
  const json = stored.routeJson as { snapshot?: unknown };
  return validateRunRouteSnapshotV1(
    json && typeof json === "object" && "snapshot" in json
      ? json.snapshot
      : stored.routeJson,
  );
}

export async function insertPressureOutboxTask(
  tx: PressurePersistenceTx,
  input: {
    runId: string;
    taskType: PressureOutboxTaskTypeV1;
    dedupeKey: string;
    sourceAuthority:
      | "GENESIS_FROZEN"
      | "CHAPTER_WORKING"
      | "CHAPTER_FROZEN"
      | "FINALE_FROZEN"
      | "LEGACY_TERMINAL_COMMITTED";
    sourceId: string;
    sourceCommitHash: string;
    payload: Prisma.InputJsonValue;
    payloadHash: string;
    maxAttempts?: number;
  },
) {
  assertPressureOutboxTaskType(input.taskType);
  try {
    return await tx.pressureOutboxTask.create({
      data: {
        runId: input.runId,
        taskType: input.taskType,
        dedupeKey: input.dedupeKey,
        sourceAuthority: input.sourceAuthority,
        sourceId: input.sourceId,
        sourceCommitHash: input.sourceCommitHash,
        payloadJson: input.payload,
        payloadHash: input.payloadHash,
        maxAttempts: input.maxAttempts ?? 5,
      },
    });
  } catch (error) {
    if (!isUniqueConflict(error)) throw error;
    const existing = await tx.pressureOutboxTask.findUnique({ where: { dedupeKey: input.dedupeKey } });
    if (existing?.payloadHash === input.payloadHash && existing.sourceCommitHash === input.sourceCommitHash) {
      return existing;
    }
    throw new PressurePersistenceError(
      ERROR.FINGERPRINT_MISMATCH,
      "A Pressure Outbox dedupe key was reused for a different source/payload",
      { dedupeKey: input.dedupeKey },
    );
  }
}

export async function insertReplayCommandReceipt(
  tx: PressurePersistenceTx,
  input: {
    idempotencyKey: string;
    requestFingerprint: string;
    actionFingerprint: string;
    receipt: ReplayCreationReceiptV1;
  },
) {
  const receipt = validateReplayCreationReceiptV1(input.receipt);
  const existing = await tx.pressureReplayCommandReceipt.findUnique({
    where: {
      sourceRunId_idempotencyKey: {
        sourceRunId: receipt.sourceRunId,
        idempotencyKey: input.idempotencyKey,
      },
    },
  });
  const disposition = assertIdempotencyFingerprint(existing, input.requestFingerprint, {
    sourceRunId: receipt.sourceRunId,
    idempotencyKey: input.idempotencyKey,
  });
  if (disposition === "REPLAY") return existing!;

  try {
    return await tx.pressureReplayCommandReceipt.create({
      data: {
        sourceRunId: receipt.sourceRunId,
        idempotencyKey: input.idempotencyKey,
        requestFingerprint: input.requestFingerprint,
        actionId: receipt.actionId,
        actionFingerprint: input.actionFingerprint,
        launchKind: receipt.launchKind,
        createdRunId: receipt.createdRunId,
        createdLobbyId: receipt.createdLobbyId,
        navigationTarget: receipt.navigationTarget,
        frozenTargetRouteHash: receipt.frozenTargetRouteHash,
        receiptJson: json(receipt),
        receiptHash: receipt.receiptHash,
      },
    });
  } catch (error) {
    if (!isUniqueConflict(error)) throw error;
    const concurrent = await tx.pressureReplayCommandReceipt.findUnique({
      where: {
        sourceRunId_idempotencyKey: {
          sourceRunId: receipt.sourceRunId,
          idempotencyKey: input.idempotencyKey,
        },
      },
    });
    assertIdempotencyFingerprint(concurrent, input.requestFingerprint, {
      sourceRunId: receipt.sourceRunId,
      idempotencyKey: input.idempotencyKey,
    });
    if (!concurrent) throw error;
    return concurrent;
  }
}

export function narrativeAudiencePersistenceKey(
  audience: { kind: "PUBLIC" | "SEAT"; seatId: string | null },
): string {
  return pressureAudienceKey(audience.kind, audience.seatId);
}

function isUniqueConflict(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}
