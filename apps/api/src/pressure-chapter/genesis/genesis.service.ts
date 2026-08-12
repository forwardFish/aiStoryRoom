import {
  PRESSURE_CHAPTER_SEAT_IDS_V1,
  TRACK_IDS_V1,
  hashWithoutField,
  isSha256,
  sha256Canonical,
  validateGenesisSnapshotV1,
  validateWorldStateV1,
  type GenesisSnapshotV1,
  type WorldStateV1,
} from "@ai-story/shared";
import {
  assertInitialRoleControlTopology,
  assertStoredRunRouteRecord,
  type StoredRunRouteRecordV1,
} from "../run-router";
import {
  GENESIS_ERROR_CODES as ERROR,
  failGenesis,
} from "./errors";
import type {
  CommittedGenesisV1,
  GenesisAtomicCommitPort,
  GenesisAtomicRecordV1,
  GenesisCommitReceiptV1,
  GenesisCommitV1,
  GenesisContentPort,
  GenesisRunRouteReaderPort,
  InitializeGenesisCommandV1,
  InitializeGenesisResultV1,
} from "./types";

const GENESIS_ATOMIC_RECORD_KEYS = [
  "schemaVersion",
  "runId",
  "routeRecordHash",
  "controlTopology",
  "snapshot",
  "commit",
  "atomicRecordHash",
] as const;
const GENESIS_COMMIT_KEYS = [
  "schemaVersion",
  "runId",
  "sequence",
  "idempotencyKey",
  "requestFingerprint",
  "inputHash",
  "routeHash",
  "genesisHash",
  "initialWorldStateHash",
  "initialTrackStateHash",
  "initialKnowledgeBoundaryHash",
  "initialControlTopologyHash",
  "commitHash",
] as const;
const COMMITTED_GENESIS_KEYS = ["record", "receipt"] as const;
const GENESIS_RECEIPT_KEYS = [
  "schemaVersion",
  "runId",
  "sequence",
  "idempotencyKey",
  "requestFingerprint",
  "inputHash",
  "routeHash",
  "genesisHash",
  "commitHash",
  "atomicRecordHash",
  "receiptHash",
] as const;

export class PressureChapterGenesisService {
  constructor(
    private readonly routeReader: GenesisRunRouteReaderPort,
    private readonly content: GenesisContentPort,
    private readonly atomicPort: GenesisAtomicCommitPort,
  ) {}

  async initialize(
    command: InitializeGenesisCommandV1,
  ): Promise<InitializeGenesisResultV1> {
    validateCommand(command);

    // A committed receipt is the recovery checkpoint. It is read before route
    // or content lookup so a retry cannot reinterpret live configuration.
    const existing = await this.atomicPort.readCommitted(command.runId);
    if (existing) {
      return {
        status: "REPLAYED",
        committed: this.assertMatchingCommitted(existing, command),
      };
    }

    const route = assertStoredRunRouteRecord(
      await this.routeReader.readStoredRoute(command.runId),
    );
    const initialWorldState = validateP0WorldState(
      await this.content.loadP0({
        route: structuredClone(route.snapshot),
        controlTopology: structuredClone(route.controlTopology),
      }),
    );
    const candidate = buildGenesisAtomicRecord(
      route,
      initialWorldState,
      command,
    );

    const persisted = await this.atomicPort.commitOnce(candidate);
    const committed = this.assertMatchingCommitted(
      persisted.committed,
      command,
      candidate,
    );
    return {
      status:
        persisted.status === "COMMITTED" ? "COMMITTED" : "REPLAYED",
      committed,
    };
  }

  private assertMatchingCommitted(
    value: CommittedGenesisV1,
    command: InitializeGenesisCommandV1,
    candidate?: GenesisAtomicRecordV1,
  ): CommittedGenesisV1 {
    const committed = validateCommittedGenesis(value);
    const storedCommit = committed.record.commit;
    if (storedCommit.idempotencyKey !== command.idempotencyKey) {
      failGenesis(
        ERROR.GENESIS_ALREADY_COMMITTED,
        "command.idempotencyKey",
        `COMMITTED_WITH_${storedCommit.idempotencyKey}`,
      );
    }
    if (storedCommit.requestFingerprint !== command.requestFingerprint) {
      failGenesis(
        ERROR.GENESIS_IDEMPOTENCY_FINGERPRINT_MISMATCH,
        "command.requestFingerprint",
        `EXPECTED_${storedCommit.requestFingerprint}`,
      );
    }
    if (
      candidate &&
      (committed.record.atomicRecordHash !== candidate.atomicRecordHash ||
        storedCommit.inputHash !== candidate.commit.inputHash ||
        storedCommit.genesisHash !== candidate.snapshot.genesisHash)
    ) {
      failGenesis(
        ERROR.GENESIS_RECEIPT_MISMATCH,
        "atomicPort.commitOnce",
        "PERSISTED_CANDIDATE_MISMATCH",
      );
    }
    return structuredClone(committed);
  }
}

export function buildGenesisAtomicRecord(
  routeValue: StoredRunRouteRecordV1,
  initialWorldStateValue: WorldStateV1,
  command: InitializeGenesisCommandV1,
): GenesisAtomicRecordV1 {
  validateCommand(command);
  const route = assertStoredRunRouteRecord(routeValue);
  if (route.runId !== command.runId) {
    failGenesis(
      ERROR.GENESIS_ROUTE_MISMATCH,
      "route.runId",
      `EXPECTED_${command.runId}`,
    );
  }
  const initialWorldState = validateP0WorldState(initialWorldStateValue);
  const snapshotBase = {
    schemaVersion: "sangtian_genesis_snapshot_v1" as const,
    runId: route.runId,
    nodeId: "P0" as const,
    sequence: 0 as const,
    routeHash: route.snapshot.routeHash,
    contentPackageSha256: route.snapshot.contentPackageSha256,
    orchestrationPackageSha256: route.snapshot.orchestrationPackageSha256,
    initialWorldState: structuredClone(initialWorldState),
  };
  const snapshot: GenesisSnapshotV1 = {
    ...snapshotBase,
    genesisHash: sha256Canonical(snapshotBase),
  };
  validateGenesisSnapshotV1(snapshot, route.snapshot);

  const inputHash = sha256Canonical({
    schemaVersion: "sangtian_genesis_input_v1",
    runId: route.runId,
    routeHash: route.snapshot.routeHash,
    routeRecordHash: route.recordHash,
    contentPackageSha256: route.snapshot.contentPackageSha256,
    orchestrationPackageSha256: route.snapshot.orchestrationPackageSha256,
    runtimeContractSha256: route.snapshot.runtimeContractSha256,
    testMatrixSha256: route.snapshot.testMatrixSha256,
    runSeed: route.snapshot.runSeed,
    requestFingerprint: command.requestFingerprint,
    initialWorldStateHash: initialWorldState.stateHash,
    initialControlTopologyHash: route.controlTopology.topologyHash,
  });
  const commitBase = {
    schemaVersion: "sangtian_genesis_commit_v1" as const,
    runId: route.runId,
    sequence: 0 as const,
    idempotencyKey: command.idempotencyKey,
    requestFingerprint: command.requestFingerprint,
    inputHash,
    routeHash: route.snapshot.routeHash,
    genesisHash: snapshot.genesisHash,
    initialWorldStateHash: initialWorldState.stateHash,
    initialTrackStateHash: initialWorldState.tracks.stateHash,
    initialKnowledgeBoundaryHash: sha256Canonical(
      initialWorldState.knowledgeBySeat,
    ),
    initialControlTopologyHash: route.controlTopology.topologyHash,
  };
  const commit: GenesisCommitV1 = {
    ...commitBase,
    commitHash: sha256Canonical(commitBase),
  };
  const atomicBase = {
    schemaVersion: "sangtian_genesis_atomic_record_v1" as const,
    runId: route.runId,
    routeRecordHash: route.recordHash,
    controlTopology: structuredClone(route.controlTopology),
    snapshot,
    commit,
  };
  return validateGenesisAtomicRecord({
    ...atomicBase,
    atomicRecordHash: sha256Canonical(atomicBase),
  });
}

export function buildGenesisCommitReceipt(
  recordValue: GenesisAtomicRecordV1,
): GenesisCommitReceiptV1 {
  const record = validateGenesisAtomicRecord(recordValue);
  const receiptBase = {
    schemaVersion: "sangtian_genesis_commit_receipt_v1" as const,
    runId: record.runId,
    sequence: 0 as const,
    idempotencyKey: record.commit.idempotencyKey,
    requestFingerprint: record.commit.requestFingerprint,
    inputHash: record.commit.inputHash,
    routeHash: record.commit.routeHash,
    genesisHash: record.snapshot.genesisHash,
    commitHash: record.commit.commitHash,
    atomicRecordHash: record.atomicRecordHash,
  };
  return {
    ...receiptBase,
    receiptHash: sha256Canonical(receiptBase),
  };
}

export function validateGenesisAtomicRecord(
  value: GenesisAtomicRecordV1,
): GenesisAtomicRecordV1 {
  if (!value || typeof value !== "object") {
    failGenesis(ERROR.GENESIS_ATOMIC_RECORD_INVALID, "genesisRecord", "OBJECT");
  }
  assertExactKeys(value, GENESIS_ATOMIC_RECORD_KEYS, "genesisRecord");
  assertExactKeys(value.commit, GENESIS_COMMIT_KEYS, "genesisRecord.commit");
  if (
    value.schemaVersion !== "sangtian_genesis_atomic_record_v1" ||
    value.snapshot.schemaVersion !== "sangtian_genesis_snapshot_v1" ||
    value.commit.schemaVersion !== "sangtian_genesis_commit_v1"
  ) {
    failGenesis(
      ERROR.GENESIS_ATOMIC_RECORD_INVALID,
      "genesisRecord.schemaVersion",
    );
  }
  validateGenesisSnapshotV1(value.snapshot);
  validateP0WorldState(value.snapshot.initialWorldState);
  assertInitialRoleControlTopology(value.controlTopology);
  if (
    value.runId !== value.snapshot.runId ||
    value.runId !== value.commit.runId ||
    value.snapshot.sequence !== 0 ||
    value.commit.sequence !== 0
  ) {
    failGenesis(ERROR.GENESIS_SEQUENCE_INVALID, "genesisRecord.sequence");
  }
  if (
    value.commit.routeHash !== value.snapshot.routeHash ||
    value.commit.genesisHash !== value.snapshot.genesisHash ||
    value.commit.initialWorldStateHash !== value.snapshot.initialWorldState.stateHash ||
    value.commit.initialTrackStateHash !== value.snapshot.initialWorldState.tracks.stateHash ||
    value.commit.initialKnowledgeBoundaryHash !==
      sha256Canonical(value.snapshot.initialWorldState.knowledgeBySeat) ||
    value.commit.initialControlTopologyHash !== value.controlTopology.topologyHash
  ) {
    failGenesis(
      ERROR.GENESIS_ATOMIC_RECORD_INVALID,
      "genesisRecord.commit",
      "BOUNDARY_HASH_MISMATCH",
    );
  }
  assertHash(value.routeRecordHash, "genesisRecord.routeRecordHash");
  for (const [field, path] of [
    [value.commit.requestFingerprint, "genesisRecord.commit.requestFingerprint"],
    [value.commit.inputHash, "genesisRecord.commit.inputHash"],
    [value.commit.commitHash, "genesisRecord.commit.commitHash"],
    [value.atomicRecordHash, "genesisRecord.atomicRecordHash"],
  ] as const) {
    assertHash(field, path);
  }
  assertNonEmptyString(
    value.commit.idempotencyKey,
    "genesisRecord.commit.idempotencyKey",
  );
  const expectedCommitHash = hashWithoutField(
    value.commit as unknown as Record<string, unknown>,
    "commitHash",
  );
  if (value.commit.commitHash !== expectedCommitHash) {
    failGenesis(
      ERROR.GENESIS_ATOMIC_RECORD_HASH_MISMATCH,
      "genesisRecord.commit.commitHash",
      `EXPECTED_${expectedCommitHash}`,
    );
  }
  const expectedRecordHash = hashWithoutField(
    value as unknown as Record<string, unknown>,
    "atomicRecordHash",
  );
  if (value.atomicRecordHash !== expectedRecordHash) {
    failGenesis(
      ERROR.GENESIS_ATOMIC_RECORD_HASH_MISMATCH,
      "genesisRecord.atomicRecordHash",
      `EXPECTED_${expectedRecordHash}`,
    );
  }
  return value;
}

export function validateCommittedGenesis(
  value: CommittedGenesisV1,
): CommittedGenesisV1 {
  if (!value || typeof value !== "object") {
    failGenesis(ERROR.GENESIS_RECEIPT_MISMATCH, "committedGenesis", "OBJECT");
  }
  assertExactKeys(value, COMMITTED_GENESIS_KEYS, "committedGenesis");
  const record = validateGenesisAtomicRecord(value.record);
  const receipt = value.receipt;
  if (
    !receipt ||
    receipt.schemaVersion !== "sangtian_genesis_commit_receipt_v1" ||
    receipt.sequence !== 0
  ) {
    failGenesis(ERROR.GENESIS_RECEIPT_MISMATCH, "committedGenesis.receipt");
  }
  assertExactKeys(receipt, GENESIS_RECEIPT_KEYS, "committedGenesis.receipt");
  const expectedReceipt = buildGenesisCommitReceipt(record);
  if (
    receipt.receiptHash !== expectedReceipt.receiptHash ||
    receipt.runId !== expectedReceipt.runId ||
    receipt.idempotencyKey !== expectedReceipt.idempotencyKey ||
    receipt.requestFingerprint !== expectedReceipt.requestFingerprint ||
    receipt.inputHash !== expectedReceipt.inputHash ||
    receipt.routeHash !== expectedReceipt.routeHash ||
    receipt.genesisHash !== expectedReceipt.genesisHash ||
    receipt.commitHash !== expectedReceipt.commitHash ||
    receipt.atomicRecordHash !== expectedReceipt.atomicRecordHash
  ) {
    failGenesis(
      ERROR.GENESIS_RECEIPT_MISMATCH,
      "committedGenesis.receipt",
      `EXPECTED_${expectedReceipt.receiptHash}`,
    );
  }
  return value;
}

function validateP0WorldState(value: WorldStateV1): WorldStateV1 {
  const world = validateWorldStateV1(value);
  if (world.worldSequence !== 0) {
    failGenesis(
      ERROR.GENESIS_SEQUENCE_INVALID,
      "initialWorldState.worldSequence",
      "EXPECTED_0",
    );
  }
  if (world.factValues["frozen.P0.LOCKED"] !== true) {
    failGenesis(
      ERROR.GENESIS_P0_INVALID,
      "initialWorldState.factValues.frozen.P0.LOCKED",
      "EXPECTED_true",
    );
  }
  if (
    Object.keys(world.tracks.values).length !== TRACK_IDS_V1.length ||
    Object.keys(world.knowledgeBySeat).length !==
      PRESSURE_CHAPTER_SEAT_IDS_V1.length ||
    Object.keys(world.seatArcs).length !== PRESSURE_CHAPTER_SEAT_IDS_V1.length
  ) {
    failGenesis(
      ERROR.GENESIS_P0_INVALID,
      "initialWorldState",
      "EXACT_FIVE_TRACKS_AND_SIX_SEATS",
    );
  }
  return world;
}

function validateCommand(command: InitializeGenesisCommandV1): void {
  if (!command || typeof command !== "object") {
    failGenesis(ERROR.GENESIS_ATOMIC_RECORD_INVALID, "command", "OBJECT");
  }
  assertNonEmptyString(command.runId, "command.runId");
  assertNonEmptyString(command.idempotencyKey, "command.idempotencyKey");
  assertHash(command.requestFingerprint, "command.requestFingerprint");
}

function assertNonEmptyString(value: unknown, path: string): asserts value is string {
  if (typeof value !== "string" || !value.trim()) {
    failGenesis(ERROR.GENESIS_ATOMIC_RECORD_INVALID, path, "NON_EMPTY_STRING");
  }
}

function assertHash(value: unknown, path: string): asserts value is string {
  if (!isSha256(value)) {
    failGenesis(
      ERROR.GENESIS_ATOMIC_RECORD_INVALID,
      path,
      "SHA256_LOWER_HEX",
    );
  }
}

function assertExactKeys(
  value: unknown,
  expectedKeys: readonly string[],
  path: string,
): void {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    failGenesis(ERROR.GENESIS_ATOMIC_RECORD_INVALID, path, "OBJECT");
  }
  const actual = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])
  ) {
    failGenesis(
      ERROR.GENESIS_ATOMIC_RECORD_INVALID,
      path,
      `EXACT_KEYS_${expected.join(",")}`,
    );
  }
}
