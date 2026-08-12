import { Prisma } from "@prisma/client";
import { isSha256, sha256Canonical } from "@ai-story/shared";
import type {
  PersistPressureSeatDecisionProofCommandV1,
  PressureSeatDecisionProofWriterPortV1,
} from "./contracts";
import {
  decodeSeatEnvelope,
  proofKey,
  seatEnvelopeJson,
  type PressureSeatSnapshotPrismaV1,
} from "../seat-control-persistence/envelope";
import {
  DEADLINE_DEFAULT_PRODUCTION_ERROR_CODES_V1 as ERROR,
  failDeadlineDefaultProductionV1,
} from "./errors";

interface ProofWriterTxV1 extends PressureSeatSnapshotPrismaV1 {}

export interface PressureSeatDecisionProofWriterPrismaV1
extends ProofWriterTxV1 {
  $transaction<T>(
    operation: (tx: ProofWriterTxV1) => Promise<T>,
    options?: { isolationLevel?: Prisma.TransactionIsolationLevel },
  ): Promise<T>;
}

/** Stores durable decision proofs inside the one-row MVP seat authority. */
export class PrismaPressureSeatDecisionProofWriterV1
implements PressureSeatDecisionProofWriterPortV1 {
  constructor(private readonly prisma: PressureSeatDecisionProofWriterPrismaV1) {}

  async persistOnce(
    command: Readonly<PersistPressureSeatDecisionProofCommandV1>,
  ): Promise<{ status: "COMMITTED" | "REPLAYED" }> {
    validateCommand(command);
    return this.prisma.$transaction(async (tx) => {
      const row = await tx.pressureSeatControlSnapshot.findUnique({
        where: { runId: command.proof.runId },
      });
      if (!row) invalid("command.proof.runId", "SEAT_AUTHORITY_MISSING");
      const envelope = decodeSeatEnvelope(row!);
      const key = proofKey(command.proofKind, command.proof.proofHash);
      const existing = envelope.proofs[key];
      if (existing) {
        assertStored(existing, command);
        return { status: "REPLAYED" as const };
      }
      if (
        envelope.snapshot.stateHash !== command.authorityStateHash
        || envelope.snapshot.frozenPolicy.policyHash !== command.frozenPolicyHash
      ) invalid("command.authorityStateHash", "STALE_AUTHORITY");

      envelope.proofs[key] = structuredClone(command);
      const updated = await tx.pressureSeatControlSnapshot.updateMany({
        where: { runId: row!.runId, version: row!.version },
        data: {
          snapshotJson: seatEnvelopeJson(envelope),
          version: { increment: 1 },
        },
      });
      if (updated.count !== 1) invalid("command.proofHash", "CONCURRENT_WRITE");
      return { status: "COMMITTED" as const };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }
}

export function createPrismaPressureSeatDecisionProofWriterV1(
  prisma: unknown,
): PrismaPressureSeatDecisionProofWriterV1 {
  return new PrismaPressureSeatDecisionProofWriterV1(
    prisma as PressureSeatDecisionProofWriterPrismaV1,
  );
}

function validateCommand(command: PersistPressureSeatDecisionProofCommandV1): void {
  const proof = command?.proof;
  if (
    (command.proofKind !== "DEADLINE_TAKEOVER" && command.proofKind !== "DEFAULT_SOURCE")
    || !proof
    || !proof.runId?.trim()
    || !proof.decisionPointId?.trim()
    || !Number.isSafeInteger(proof.expectedControlEpoch)
    || proof.expectedControlEpoch < 1
    || !isSha256(proof.proofHash)
    || !isSha256(command.authorityStateHash)
    || !isSha256(command.frozenPolicyHash)
  ) invalid("command", "INVALID_SHAPE");
  const { proofHash, ...body } = proof;
  if (proofHash !== sha256Canonical(body)) invalid("command.proofHash", "SELF_HASH_MISMATCH");
  if (
    (command.proofKind === "DEADLINE_TAKEOVER"
      && proof.schemaVersion !== "pressure_frozen_deadline_takeover_proof_v1")
    || (command.proofKind === "DEFAULT_SOURCE"
      && proof.schemaVersion !== "pressure_frozen_default_source_proof_v1")
  ) invalid("command.proofKind", "SCHEMA_KIND_MISMATCH");
}

function assertStored(
  stored: PersistPressureSeatDecisionProofCommandV1,
  command: PersistPressureSeatDecisionProofCommandV1,
): void {
  if (sha256Canonical(stored) !== sha256Canonical(command)) {
    invalid("storedProof", "REPLAY_MISMATCH");
  }
}

function invalid(path: string, detail: string): never {
  return failDeadlineDefaultProductionV1(ERROR.PROOF_PERSISTENCE_INVALID, path, detail);
}
