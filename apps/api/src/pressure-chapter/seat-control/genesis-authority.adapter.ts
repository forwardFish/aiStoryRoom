import { isSha256 } from "@ai-story/shared";
import type { CommittedGenesisV1 } from "../genesis";
import { SEAT_CONTROL_ERROR_CODES as ERROR, failSeatControl } from "./errors";
import type { SeatControlGenesisAuthorityV1 } from "./types";

/**
 * One-way application projection from the canonical Genesis aggregate.
 * It does not define another wire/hash and cannot reinterpret the stored route.
 */
export function mapCommittedGenesisToSeatControlAuthority(
  committed: CommittedGenesisV1,
): SeatControlGenesisAuthorityV1 {
  const { record, receipt } = committed;
  if (
    !record ||
    !receipt ||
    record.runId !== receipt.runId ||
    record.runId !== record.commit.runId ||
    record.commit.sequence !== 0 ||
    receipt.sequence !== 0 ||
    record.commit.routeHash !== receipt.routeHash ||
    record.commit.genesisHash !== receipt.genesisHash ||
    record.commit.commitHash !== receipt.commitHash ||
    record.atomicRecordHash !== receipt.atomicRecordHash ||
    record.controlTopology.topologyHash !==
      record.commit.initialControlTopologyHash ||
    !isSha256(record.commit.routeHash) ||
    !isSha256(record.commit.genesisHash) ||
    !isSha256(record.atomicRecordHash)
  ) {
    failSeatControl(ERROR.GENESIS_MISMATCH, "COMMITTED_GENESIS_AUTHORITY");
  }

  return {
    schemaVersion: "pressure_seat_control_genesis_authority_v1" as const,
    runId: record.runId,
    routeHash: record.commit.routeHash,
    genesisHash: record.commit.genesisHash,
    genesisAtomicRecordHash: record.atomicRecordHash,
    controlTopology: structuredClone(record.controlTopology),
  };
}
