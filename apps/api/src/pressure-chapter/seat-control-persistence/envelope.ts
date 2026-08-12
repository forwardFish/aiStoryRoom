import type { Prisma } from "@prisma/client";
import type {
  CommittedSeatControlCommandV1,
  SeatControlSnapshotV1,
  SeatDefaultDirectiveV1,
  SeatPresenceRecordV1,
  SeatPrivateProjectionRecordV1,
} from "../seat-control/types";
import type {
  PersistPressureSeatDecisionProofCommandV1,
  PressureSeatDecisionProofKindV1,
} from "../deadline-default-production/contracts";
import {
  PRESSURE_PERSISTENCE_ERROR_CODES as ERROR,
  PressurePersistenceError,
} from "../persistence/errors";

export const PRESSURE_SEAT_PERSISTENCE_ENVELOPE_V1 =
  "pressure_seat_control_persistence_envelope_v1" as const;

export interface PressureSeatProofEnvelopeV1
extends PersistPressureSeatDecisionProofCommandV1 {}

export interface PressureSeatPersistenceEnvelopeV1 {
  schemaVersion: typeof PRESSURE_SEAT_PERSISTENCE_ENVELOPE_V1;
  snapshot: SeatControlSnapshotV1;
  commandReceipts: Record<string, CommittedSeatControlCommandV1>;
  proofs: Record<string, PressureSeatProofEnvelopeV1>;
  presenceReceipts: Record<string, SeatPresenceRecordV1>;
  latestPresence: Record<string, SeatPresenceRecordV1>;
  directives: Record<string, SeatDefaultDirectiveV1>;
  privateProjections: Record<string, SeatPrivateProjectionRecordV1>;
}

export interface PressureSeatSnapshotRowV1 {
  runId: string;
  stateRevision: number;
  stateHash: string;
  snapshotJson: unknown;
  version: number;
}

export interface PressureSeatSnapshotDelegateV1 {
  findUnique(input: {
    where: { runId: string };
    select?: Record<string, boolean>;
  }): Promise<PressureSeatSnapshotRowV1 | null>;
  create(input: { data: Record<string, unknown> }): Promise<PressureSeatSnapshotRowV1>;
  updateMany(input: {
    where: Record<string, unknown>;
    data: Record<string, unknown>;
  }): Promise<{ count: number }>;
}

export interface PressureSeatSnapshotPrismaV1 {
  pressureSeatControlSnapshot: PressureSeatSnapshotDelegateV1;
}

export function emptySeatEnvelope(
  snapshot: SeatControlSnapshotV1,
): PressureSeatPersistenceEnvelopeV1 {
  return {
    schemaVersion: PRESSURE_SEAT_PERSISTENCE_ENVELOPE_V1,
    snapshot: structuredClone(snapshot),
    commandReceipts: {},
    proofs: {},
    presenceReceipts: {},
    latestPresence: {},
    directives: {},
    privateProjections: {},
  };
}

export function decodeSeatEnvelope(
  row: PressureSeatSnapshotRowV1,
): PressureSeatPersistenceEnvelopeV1 {
  const value = structuredClone(row.snapshotJson) as Partial<PressureSeatPersistenceEnvelopeV1>;
  // A legacy row contained the authority snapshot directly. Accepting it makes
  // the consolidation deployable without inventing a second migration phase.
  if (value?.schemaVersion !== PRESSURE_SEAT_PERSISTENCE_ENVELOPE_V1) {
    const snapshot = value as unknown as SeatControlSnapshotV1;
    assertSnapshotBinding(row, snapshot);
    return emptySeatEnvelope(snapshot);
  }
  if (!value.snapshot || typeof value.snapshot !== "object") invalid(row.runId);
  assertSnapshotBinding(row, value.snapshot as SeatControlSnapshotV1);
  return {
    schemaVersion: PRESSURE_SEAT_PERSISTENCE_ENVELOPE_V1,
    snapshot: structuredClone(value.snapshot as SeatControlSnapshotV1),
    commandReceipts: cloneRecord(value.commandReceipts),
    proofs: cloneRecord(value.proofs),
    presenceReceipts: cloneRecord(value.presenceReceipts),
    latestPresence: cloneRecord(value.latestPresence),
    directives: cloneRecord(value.directives),
    privateProjections: cloneRecord(value.privateProjections),
  };
}

export function seatEnvelopeJson(
  envelope: PressureSeatPersistenceEnvelopeV1,
): Prisma.InputJsonValue {
  return structuredClone(envelope) as unknown as Prisma.InputJsonValue;
}

export function proofKey(
  kind: PressureSeatDecisionProofKindV1,
  proofHash: string,
): string {
  return `${kind}:${proofHash}`;
}

export function presenceKey(
  runId: string,
  seatId: string,
  humanControllerId: string,
): string {
  return `${runId}:${seatId}:${humanControllerId}`;
}

export function privateProjectionKey(
  runId: string,
  seatId: string,
  sourceAuthorityHash: string,
): string {
  return `${runId}:${seatId}:${sourceAuthorityHash}`;
}

function assertSnapshotBinding(
  row: PressureSeatSnapshotRowV1,
  snapshot: SeatControlSnapshotV1,
): void {
  if (
    snapshot?.runId !== row.runId
    || snapshot.stateRevision !== row.stateRevision
    || snapshot.stateHash !== row.stateHash
  ) invalid(row.runId);
}

function cloneRecord<T>(value: unknown): Record<string, T> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? structuredClone(value as Record<string, T>)
    : {};
}

function invalid(runId: string): never {
  throw new PressurePersistenceError(
    ERROR.RECORD_INVALID,
    "PressureSeatControlSnapshot envelope is invalid",
    { runId },
  );
}
