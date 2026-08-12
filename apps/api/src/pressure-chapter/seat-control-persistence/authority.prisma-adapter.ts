import { Prisma } from "@prisma/client";
import type {
  CommittedSeatControlCommandV1,
  SeatControlAuthorityPort,
  SeatControlInitializePortResultV1,
  SeatControlTransitionCommitV1,
  SeatControlTransitionPortResultV1,
} from "../seat-control/types";
import { assertIdempotencyFingerprint } from "../persistence/cas";
import {
  decodeSeatEnvelope,
  emptySeatEnvelope,
  seatEnvelopeJson,
  type PressureSeatPersistenceEnvelopeV1,
  type PressureSeatSnapshotPrismaV1,
} from "./envelope";

interface PressureAuthorityTxV1 extends PressureSeatSnapshotPrismaV1 {}

export interface PressureSeatAuthorityPrismaLikeV1
extends PressureAuthorityTxV1 {
  $transaction<T>(
    operation: (tx: PressureAuthorityTxV1) => Promise<T>,
    options?: { isolationLevel?: Prisma.TransactionIsolationLevel },
  ): Promise<T>;
}

async function readEnvelope(
  tx: PressureSeatSnapshotPrismaV1,
  runId: string,
): Promise<PressureSeatPersistenceEnvelopeV1 | null> {
  const row = await tx.pressureSeatControlSnapshot.findUnique({ where: { runId } });
  return row ? decodeSeatEnvelope(row) : null;
}

export class PrismaSeatControlAuthorityPortV1
implements SeatControlAuthorityPort {
  constructor(private readonly prisma: PressureSeatAuthorityPrismaLikeV1) {}

  async readSnapshot(runId: string) {
    return (await readEnvelope(this.prisma, runId))?.snapshot ?? null;
  }

  async readCommittedCommand(runId: string, idempotencyKey: string) {
    const envelope = await readEnvelope(this.prisma, runId);
    return envelope?.commandReceipts[idempotencyKey]
      ? structuredClone(envelope.commandReceipts[idempotencyKey])
      : null;
  }

  async initializeOnce(
    candidate: CommittedSeatControlCommandV1,
  ): Promise<SeatControlInitializePortResultV1> {
    return this.prisma.$transaction(async (tx) => {
      const current = await readEnvelope(tx, candidate.snapshot.runId);
      const replayed = replay(current, candidate);
      if (replayed) return replayed;
      if (current) return { status: "ALREADY_INITIALIZED", current: current.snapshot };

      const envelope = emptySeatEnvelope(candidate.snapshot);
      envelope.commandReceipts[candidate.receipt.idempotencyKey] = structuredClone(candidate);
      try {
        await tx.pressureSeatControlSnapshot.create({
          data: snapshotData(candidate, envelope, 1),
        });
      } catch (error) {
        if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") {
          throw error;
        }
        const winner = await readEnvelope(tx, candidate.snapshot.runId);
        const wonReplay = replay(winner, candidate);
        if (wonReplay) return wonReplay;
        return { status: "ALREADY_INITIALIZED", current: winner!.snapshot };
      }
      return { status: "COMMITTED", committed: structuredClone(candidate) };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  async commitTransition(
    command: SeatControlTransitionCommitV1,
  ): Promise<SeatControlTransitionPortResultV1> {
    return this.prisma.$transaction(async (tx) => {
      const candidate = command.candidate;
      const row = await tx.pressureSeatControlSnapshot.findUnique({
        where: { runId: candidate.snapshot.runId },
      });
      const envelope = row ? decodeSeatEnvelope(row) : null;
      const prior = replay(envelope, candidate);
      if (prior) return prior;
      if (!row || !envelope) return { status: "CONFLICT", current: null };
      const current = envelope.snapshot;
      if (
        current.stateRevision !== command.expectedStateRevision
        || current.stateHash !== command.expectedStateHash
        || current.seatControls.find((seat) => seat.seatId === command.expectedSeatId)?.controlEpoch
          !== command.expectedControlEpoch
      ) return { status: "CONFLICT", current };

      if (current.frozenPolicy.policyHash !== candidate.snapshot.frozenPolicy.policyHash) {
        return { status: "CONFLICT", current };
      }
      envelope.snapshot = structuredClone(candidate.snapshot);
      envelope.commandReceipts[candidate.receipt.idempotencyKey] = structuredClone(candidate);
      const updated = await tx.pressureSeatControlSnapshot.updateMany({
        where: {
          runId: row.runId,
          version: row.version,
          stateRevision: command.expectedStateRevision,
          stateHash: command.expectedStateHash,
        },
        data: snapshotUpdateData(candidate, envelope),
      });
      if (updated.count !== 1) {
        const winner = await readEnvelope(tx, candidate.snapshot.runId);
        const wonReplay = replay(winner, candidate);
        return wonReplay ?? { status: "CONFLICT", current: winner?.snapshot ?? null };
      }
      return { status: "COMMITTED", committed: structuredClone(candidate) };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }
}

function replay(
  envelope: PressureSeatPersistenceEnvelopeV1 | null,
  candidate: CommittedSeatControlCommandV1,
): { status: "REPLAYED"; committed: CommittedSeatControlCommandV1 } | null {
  const existing = envelope?.commandReceipts[candidate.receipt.idempotencyKey];
  const disposition = assertIdempotencyFingerprint(
    existing ? { requestFingerprint: existing.receipt.requestFingerprint } : null,
    candidate.receipt.requestFingerprint,
    { runId: candidate.snapshot.runId, idempotencyKey: candidate.receipt.idempotencyKey },
  );
  return disposition === "REPLAY"
    ? { status: "REPLAYED", committed: structuredClone(existing!) }
    : null;
}

function snapshotData(
  candidate: CommittedSeatControlCommandV1,
  envelope: PressureSeatPersistenceEnvelopeV1,
  version: number,
): Record<string, unknown> {
  const snapshot = candidate.snapshot;
  return {
    runId: snapshot.runId,
    routeHash: snapshot.routeHash,
    genesisHash: snapshot.genesisHash,
    genesisAtomicRecordHash: snapshot.genesisAtomicRecordHash,
    initialTopologyHash: snapshot.initialTopologyHash,
    controlTopologyVersion: snapshot.controlTopologyVersion,
    participantMode: snapshot.participantMode,
    stateRevision: snapshot.stateRevision,
    timelineLength: snapshot.timelineLength,
    timelineHeadHash: snapshot.timelineHeadHash,
    initializationInputHash: snapshot.initializationInputHash,
    stateHash: snapshot.stateHash,
    snapshotJson: seatEnvelopeJson(envelope),
    version,
  };
}

function snapshotUpdateData(
  candidate: CommittedSeatControlCommandV1,
  envelope: PressureSeatPersistenceEnvelopeV1,
): Record<string, unknown> {
  const data = snapshotData(candidate, envelope, 0);
  delete data.runId;
  data.version = { increment: 1 };
  return data;
}
