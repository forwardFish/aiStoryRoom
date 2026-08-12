import type {
  GenesisSnapshotV1,
  RunRouteSnapshotV1,
  WorldStateV1,
} from "@ai-story/shared";
import type {
  InitialRoleControlTopologyV1,
  StoredRunRouteReaderPort,
} from "../run-router";

export interface InitializeGenesisCommandV1 {
  runId: string;
  idempotencyKey: string;
  requestFingerprint: string;
}

export interface GenesisCommitV1 {
  schemaVersion: "sangtian_genesis_commit_v1";
  runId: string;
  sequence: 0;
  idempotencyKey: string;
  requestFingerprint: string;
  inputHash: string;
  routeHash: string;
  genesisHash: string;
  initialWorldStateHash: string;
  initialTrackStateHash: string;
  initialKnowledgeBoundaryHash: string;
  initialControlTopologyHash: string;
  commitHash: string;
}

export interface GenesisAtomicRecordV1 {
  schemaVersion: "sangtian_genesis_atomic_record_v1";
  runId: string;
  routeRecordHash: string;
  controlTopology: InitialRoleControlTopologyV1;
  snapshot: GenesisSnapshotV1;
  commit: GenesisCommitV1;
  atomicRecordHash: string;
}

export interface GenesisCommitReceiptV1 {
  schemaVersion: "sangtian_genesis_commit_receipt_v1";
  runId: string;
  sequence: 0;
  idempotencyKey: string;
  requestFingerprint: string;
  inputHash: string;
  routeHash: string;
  genesisHash: string;
  commitHash: string;
  atomicRecordHash: string;
  receiptHash: string;
}

export interface CommittedGenesisV1 {
  record: GenesisAtomicRecordV1;
  receipt: GenesisCommitReceiptV1;
}

export interface GenesisAtomicCommitPort {
  readCommitted(runId: string): Promise<CommittedGenesisV1 | null>;
  commitOnce(
    candidate: GenesisAtomicRecordV1,
  ): Promise<{
    status: "COMMITTED" | "ALREADY_COMMITTED";
    committed: CommittedGenesisV1;
  }>;
}

export interface GenesisContentPort {
  loadP0(input: {
    route: RunRouteSnapshotV1;
    controlTopology: InitialRoleControlTopologyV1;
  }): Promise<WorldStateV1>;
}

export interface InitializeGenesisResultV1 {
  status: "COMMITTED" | "REPLAYED";
  committed: CommittedGenesisV1;
}

export type GenesisRunRouteReaderPort = StoredRunRouteReaderPort;
