import { Prisma } from "@prisma/client";
import type { SeatIdV1 } from "@ai-story/shared";
import type {
  SeatDefaultDirectivePort,
  SeatDefaultDirectiveV1,
  SeatPresencePort,
  SeatPresenceRecordV1,
  SeatPrivateProjectionPort,
  SeatPrivateProjectionRecordV1,
} from "../seat-control/types";
import { assertIdempotencyFingerprint } from "../persistence/cas";
import {
  PRESSURE_PERSISTENCE_ERROR_CODES as ERROR,
  PressurePersistenceError,
} from "../persistence/errors";
import {
  decodeSeatEnvelope,
  presenceKey,
  privateProjectionKey,
  seatEnvelopeJson,
  type PressureSeatPersistenceEnvelopeV1,
  type PressureSeatSnapshotPrismaV1,
  type PressureSeatSnapshotRowV1,
} from "./envelope";

interface PressureSeatAuxTxV1 extends PressureSeatSnapshotPrismaV1 {}

export interface PressureSeatAuxPrismaLikeV1 extends PressureSeatAuxTxV1 {
  $transaction<T>(
    operation: (tx: PressureSeatAuxTxV1) => Promise<T>,
    options?: { isolationLevel?: Prisma.TransactionIsolationLevel },
  ): Promise<T>;
}

export class PrismaSeatPresencePortV1 implements SeatPresencePort {
  constructor(private readonly prisma: PressureSeatAuxPrismaLikeV1) {}

  async record(record: SeatPresenceRecordV1): Promise<{
    status: "APPLIED" | "REPLAYED" | "STALE";
    record: SeatPresenceRecordV1;
  }> {
    return mutateEnvelope<{
      status: "APPLIED" | "REPLAYED" | "STALE";
      record: SeatPresenceRecordV1;
    }>(this.prisma, record.runId, (envelope) => {
      const existing = envelope.presenceReceipts[record.idempotencyKey];
      const disposition = assertIdempotencyFingerprint(
        existing ? { requestFingerprint: existing.requestFingerprint } : null,
        record.requestFingerprint,
        { runId: record.runId, idempotencyKey: record.idempotencyKey },
      );
      if (disposition === "REPLAY") {
        return { changed: false, value: { status: "REPLAYED" as const, record: structuredClone(existing!) } };
      }
      const key = presenceKey(record.runId, record.seatId, record.humanControllerId);
      const latest = envelope.latestPresence[key];
      if (latest && latest.signalSequence >= record.signalSequence) {
        return { changed: false, value: { status: "STALE" as const, record: structuredClone(latest) } };
      }
      envelope.presenceReceipts[record.idempotencyKey] = structuredClone(record);
      envelope.latestPresence[key] = structuredClone(record);
      return { changed: true, value: { status: "APPLIED" as const, record: structuredClone(record) } };
    });
  }

  async readForSeat(runId: string, seatId: SeatIdV1, humanControllerId: string) {
    const envelope = await readRequiredEnvelope(this.prisma, runId, false);
    const value = envelope?.latestPresence[presenceKey(runId, seatId, humanControllerId)];
    return value ? structuredClone(value) : null;
  }
}

export class PrismaSeatDefaultDirectivePortV1 implements SeatDefaultDirectivePort {
  constructor(private readonly prisma: PressureSeatAuxPrismaLikeV1) {}

  async readCommitted(runId: string, idempotencyKey: string) {
    const envelope = await readRequiredEnvelope(this.prisma, runId, false);
    const value = envelope?.directives[idempotencyKey];
    return value ? structuredClone(value) : null;
  }

  async commitOnce(directive: SeatDefaultDirectiveV1): Promise<{
    status: "COMMITTED" | "REPLAYED";
    directive: SeatDefaultDirectiveV1;
  }> {
    return mutateEnvelope<{
      status: "COMMITTED" | "REPLAYED";
      directive: SeatDefaultDirectiveV1;
    }>(this.prisma, directive.runId, (envelope) => {
      const existing = envelope.directives[directive.idempotencyKey];
      const disposition = assertIdempotencyFingerprint(
        existing ? { requestFingerprint: existing.requestFingerprint } : null,
        directive.requestFingerprint,
        { runId: directive.runId, idempotencyKey: directive.idempotencyKey },
      );
      if (disposition === "REPLAY") {
        return { changed: false, value: { status: "REPLAYED" as const, directive: structuredClone(existing!) } };
      }
      envelope.directives[directive.idempotencyKey] = structuredClone(directive);
      return { changed: true, value: { status: "COMMITTED" as const, directive: structuredClone(directive) } };
    });
  }
}

export class PrismaSeatPrivateProjectionPortV1 implements SeatPrivateProjectionPort {
  constructor(private readonly prisma: PressureSeatAuxPrismaLikeV1) {}

  async readForSeat(input: {
    runId: string;
    seatId: SeatIdV1;
    sourceAuthorityHash: string;
  }): Promise<SeatPrivateProjectionRecordV1> {
    const envelope = await readRequiredEnvelope(this.prisma, input.runId, false);
    const row = envelope?.privateProjections[
      privateProjectionKey(input.runId, input.seatId, input.sourceAuthorityHash)
    ];
    if (!row) {
      throw new PressurePersistenceError(
        ERROR.RECORD_NOT_FOUND,
        "No seat-private projection exists for this authority hash",
        input,
      );
    }
    return structuredClone(row);
  }
}

async function readRequiredEnvelope(
  prisma: PressureSeatSnapshotPrismaV1,
  runId: string,
  required = true,
): Promise<PressureSeatPersistenceEnvelopeV1 | null> {
  const row = await prisma.pressureSeatControlSnapshot.findUnique({ where: { runId } });
  if (!row && required) {
    throw new PressurePersistenceError(
      ERROR.RECORD_NOT_FOUND,
      "Pressure seat-control state does not exist",
      { runId },
    );
  }
  return row ? decodeSeatEnvelope(row) : null;
}

async function mutateEnvelope<T>(
  prisma: PressureSeatAuxPrismaLikeV1,
  runId: string,
  mutate: (envelope: PressureSeatPersistenceEnvelopeV1) => {
    changed: boolean;
    value: T;
  },
): Promise<T> {
  return prisma.$transaction(async (tx) => {
    const row = await tx.pressureSeatControlSnapshot.findUnique({ where: { runId } });
    if (!row) return missing(runId);
    const envelope = decodeSeatEnvelope(row);
    const result = mutate(envelope);
    if (!result.changed) return result.value;
    const updated = await updateEnvelope(tx, row, envelope);
    if (updated.count !== 1) return conflict(runId);
    return result.value;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

function updateEnvelope(
  tx: PressureSeatSnapshotPrismaV1,
  row: PressureSeatSnapshotRowV1,
  envelope: PressureSeatPersistenceEnvelopeV1,
) {
  return tx.pressureSeatControlSnapshot.updateMany({
    where: { runId: row.runId, version: row.version },
    data: { snapshotJson: seatEnvelopeJson(envelope), version: { increment: 1 } },
  });
}

function missing(runId: string): never {
  throw new PressurePersistenceError(ERROR.RECORD_NOT_FOUND, "Pressure seat-control state does not exist", { runId });
}

function conflict(runId: string): never {
  throw new PressurePersistenceError(ERROR.AUTHORITY_FENCE_MISMATCH, "Pressure seat-control state changed concurrently", { runId });
}
