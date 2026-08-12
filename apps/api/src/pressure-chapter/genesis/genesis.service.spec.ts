import assert from "node:assert/strict";
import test from "node:test";
import {
  PRESSURE_CHAPTER_SEAT_IDS_V1,
  TRACK_IDS_V1,
  sha256Canonical,
  type KnowledgeStateV1,
  type ParticipantModeV1,
  type SeatArcStateV1,
  type SeatIdV1,
  type TrackIdV1,
  type TrackStateV1,
  type WorldStateV1,
} from "@ai-story/shared";
import {
  PRESSURE_CHAPTER_ROUTE_REGISTRY_SCHEMA_V1,
  PRESSURE_CHAPTER_ROUTE_TUPLE_V1,
  PressureChapterRouteRegistry,
  computePressureChapterRouteRegistryHash,
  type PressureChapterRouteRegistryV1,
} from "@ai-story/templates";
import {
  PressureChapterRunRouterService,
  type CreatePressureRunRouteCommandV1,
  type RunRouteRepositoryPort,
  type StoredRunRouteRecordV1,
} from "../run-router";
import {
  GENESIS_ERROR_CODES,
  GenesisError,
} from "./errors";
import {
  PressureChapterGenesisService,
  buildGenesisCommitReceipt,
} from "./genesis.service";
import type {
  CommittedGenesisV1,
  GenesisAtomicCommitPort,
  GenesisAtomicRecordV1,
  GenesisContentPort,
  InitializeGenesisCommandV1,
} from "./types";

const digest = (label: string): string => sha256Canonical({ label });

function withHash<T extends Record<string, unknown>, K extends string>(
  value: T,
  field: K,
): T & Record<K, string> {
  return { ...value, [field]: sha256Canonical(value) } as T & Record<K, string>;
}

class InMemoryRunRouteRepository implements RunRouteRepositoryPort {
  private readonly records = new Map<string, StoredRunRouteRecordV1>();

  async findByRunId(runId: string): Promise<StoredRunRouteRecordV1 | null> {
    const record = this.records.get(runId);
    return record ? structuredClone(record) : null;
  }

  async insertIfAbsent(record: StoredRunRouteRecordV1) {
    const existing = this.records.get(record.runId);
    if (existing) {
      return { status: "EXISTING" as const, record: structuredClone(existing) };
    }
    this.records.set(record.runId, structuredClone(record));
    return { status: "INSERTED" as const, record: structuredClone(record) };
  }
}

class StaticGenesisContent implements GenesisContentPort {
  loads = 0;

  constructor(private readonly world: WorldStateV1 = worldState(0)) {}

  async loadP0(): Promise<WorldStateV1> {
    this.loads += 1;
    return structuredClone(this.world);
  }
}

class InMemoryGenesisAtomicPort implements GenesisAtomicCommitPort {
  private readonly values = new Map<string, CommittedGenesisV1>();
  commitCalls = 0;
  failBeforeCommitOnce = false;
  crashAfterCommitOnce = false;

  async readCommitted(runId: string): Promise<CommittedGenesisV1 | null> {
    const value = this.values.get(runId);
    return value ? structuredClone(value) : null;
  }

  async commitOnce(candidate: GenesisAtomicRecordV1) {
    this.commitCalls += 1;
    const existing = this.values.get(candidate.runId);
    if (existing) {
      return {
        status: "ALREADY_COMMITTED" as const,
        committed: structuredClone(existing),
      };
    }
    if (this.failBeforeCommitOnce) {
      this.failBeforeCommitOnce = false;
      throw new Error("SIMULATED_GENESIS_TRANSACTION_ROLLBACK");
    }
    const committed = {
      record: structuredClone(candidate),
      receipt: buildGenesisCommitReceipt(candidate),
    };
    // One map write represents the port's all-or-nothing DB transaction.
    this.values.set(candidate.runId, structuredClone(committed));
    if (this.crashAfterCommitOnce) {
      this.crashAfterCommitOnce = false;
      throw new Error("SIMULATED_WORKER_CRASH_AFTER_COMMIT_BEFORE_ACK");
    }
    return { status: "COMMITTED" as const, committed };
  }

  get committedRuns(): number {
    return this.values.size;
  }

  counts(runId: string): { snapshots: number; commits: number } {
    const exists = this.values.has(runId) ? 1 : 0;
    return { snapshots: exists, commits: exists };
  }
}

function registry(): PressureChapterRouteRegistry {
  const base: Omit<PressureChapterRouteRegistryV1, "registryHash"> = {
    schemaVersion: PRESSURE_CHAPTER_ROUTE_REGISTRY_SCHEMA_V1,
    registryVersion: "pressure-route-registry-v1",
    defaultRouteKey: "sangtian-pressure",
    routes: [
      {
        routeKey: "sangtian-pressure",
        worldId: "sangtian",
        status: "PUBLISHED",
        createEnabled: true,
        participantModes: ["SOLO", "MULTIPLAYER"],
        route: { ...PRESSURE_CHAPTER_ROUTE_TUPLE_V1 },
        contentPackageVersion: "sangtian-content-v1",
        contentPackageSha256: digest("content-v1"),
        orchestrationPackageVersion: "sangtian-orchestration-v1",
        orchestrationPackageSha256: digest("orchestration-v1"),
        runtimeContractVersion: "pressure-runtime-contract-v1",
        runtimeContractSha256: digest("runtime-contract-v1"),
        testMatrixVersion: "pressure-test-matrix-v1",
        testMatrixSha256: digest("test-matrix-v1"),
        narrativeProfileVersion: "openovel-pressure-v1",
        featureSetVersion: "pressure-feature-set-v1",
        resultContractRegistryVersion: "result-registry-v1",
        controlTopologyVersion: "six-seat-control-v1",
        handlerKey: "pressure_chapter_v1",
        resultAdapterKey: "SangtianPressureResultV1Adapter",
        presentationSchemaVersion: "sangtian_pressure_result_v1",
        rendererKey: "sangtian_pressure_endgame_v1",
      },
    ],
  };
  return new PressureChapterRouteRegistry({
    ...base,
    registryHash: computePressureChapterRouteRegistryHash(base),
  });
}

function routeCommand(
  runId: string,
  mode: ParticipantModeV1,
  humanCount: number,
): CreatePressureRunRouteCommandV1 {
  return {
    runId,
    participantMode: mode,
    humanSeatIdsAtStart: PRESSURE_CHAPTER_SEAT_IDS_V1.slice(0, humanCount),
    runSeed: `seed-${runId}`,
  };
}

function genesisCommand(
  runId: string,
  fingerprint = digest(`genesis-request-${runId}`),
  idempotencyKey = `genesis:${runId}`,
): InitializeGenesisCommandV1 {
  return { runId, idempotencyKey, requestFingerprint: fingerprint };
}

async function routeFor(
  router: PressureChapterRunRouterService,
  runId: string,
  mode: ParticipantModeV1,
  humanCount: number,
): Promise<void> {
  await router.create(routeCommand(runId, mode, humanCount));
}

function worldState(sequence: number): WorldStateV1 {
  const tracks: TrackStateV1 = withHash(
    {
      schemaVersion: "sangtian_track_state_v1" as const,
      values: Object.fromEntries(
        TRACK_IDS_V1.map((trackId, index) => [trackId, index]),
      ) as Record<TrackIdV1, number>,
    },
    "stateHash",
  );
  const knowledgeBySeat = Object.fromEntries(
    PRESSURE_CHAPTER_SEAT_IDS_V1.map((seatId) => [
      seatId,
      withHash(
        {
          seatId,
          knownFactRefs: ["fact.public.sangtian_edict"],
          secretRefs: [`secret.${seatId}.initial`],
          disclosedToSeatIds: [],
        },
        "stateHash",
      ),
    ]),
  ) as unknown as Record<SeatIdV1, KnowledgeStateV1>;
  const seatArcs = Object.fromEntries(
    PRESSURE_CHAPTER_SEAT_IDS_V1.map((seatId) => [
      seatId,
      withHash(
        {
          seatId,
          arcStage: "P0_FROZEN",
          publicGoalProgress: 0,
          privateGoalProgress: 0,
          gainRefs: [],
          lossRefs: [],
          costRefs: [],
        },
        "stateHash",
      ),
    ]),
  ) as unknown as Record<SeatIdV1, SeatArcStateV1>;
  return withHash(
    {
      schemaVersion: "sangtian_world_state_v1" as const,
      worldSequence: sequence,
      factValues: {
        "fact.public.sangtian_edict": true,
        "frozen.P0.LOCKED": true,
      },
      resources: { grain: 6, silver: 6 },
      tracks,
      objects: [],
      knowledgeBySeat,
      evidence: [],
      responsibilities: [],
      seatArcs,
    },
    "stateHash",
  );
}

test("GEN commits one P0 sequence-0 snapshot and commit for Solo, 2-human and 6-human runs", async () => {
  const routeRepository = new InMemoryRunRouteRepository();
  const router = new PressureChapterRunRouterService(routeRepository, registry());
  const content = new StaticGenesisContent();
  const atomic = new InMemoryGenesisAtomicPort();
  const genesis = new PressureChapterGenesisService(router, content, atomic);

  for (const [runId, mode, humanCount] of [
    ["gen-solo", "SOLO", 1],
    ["gen-mp-two", "MULTIPLAYER", 2],
    ["gen-mp-six", "MULTIPLAYER", 6],
  ] as const) {
    await routeFor(router, runId, mode, humanCount);
    const initialized = await genesis.initialize(genesisCommand(runId));
    const { record, receipt } = initialized.committed;

    assert.equal(initialized.status, "COMMITTED");
    assert.equal(record.snapshot.nodeId, "P0");
    assert.equal(record.snapshot.sequence, 0);
    assert.equal(record.snapshot.initialWorldState.worldSequence, 0);
    assert.equal(record.commit.sequence, 0);
    assert.equal(receipt.sequence, 0);
    assert.equal(Object.keys(record.snapshot.initialWorldState.tracks.values).length, 5);
    assert.equal(Object.keys(record.snapshot.initialWorldState.knowledgeBySeat).length, 6);
    assert.equal(record.controlTopology.seatControls.length, 6);
    assert.equal(
      record.controlTopology.seatControls.filter(
        (control) => control.mode === "HUMAN_ACTIVE",
      ).length,
      humanCount,
    );
    assert.equal(
      JSON.stringify(record).includes("ChapterSettlement"),
      false,
    );
    assert.deepEqual(atomic.counts(runId), { snapshots: 1, commits: 1 });
  }
  assert.equal(atomic.committedRuns, 3);
});

test("GEN replays the same idempotency key and fingerprint without rebuilding P0", async () => {
  const routeRepository = new InMemoryRunRouteRepository();
  const router = new PressureChapterRunRouterService(routeRepository, registry());
  await routeFor(router, "gen-idempotent", "SOLO", 1);
  const content = new StaticGenesisContent();
  const atomic = new InMemoryGenesisAtomicPort();
  const genesis = new PressureChapterGenesisService(router, content, atomic);
  const command = genesisCommand("gen-idempotent");

  const first = await genesis.initialize(command);
  const second = await genesis.initialize(command);

  assert.equal(first.status, "COMMITTED");
  assert.equal(second.status, "REPLAYED");
  assert.equal(first.committed.record.atomicRecordHash, second.committed.record.atomicRecordHash);
  assert.equal(first.committed.receipt.receiptHash, second.committed.receipt.receiptHash);
  assert.equal(content.loads, 1);
  assert.equal(atomic.commitCalls, 1);
  assert.deepEqual(atomic.counts("gen-idempotent"), { snapshots: 1, commits: 1 });
});

test("GEN rejects a reused key with a different fingerprint and preserves the original", async () => {
  const routeRepository = new InMemoryRunRouteRepository();
  const router = new PressureChapterRunRouterService(routeRepository, registry());
  await routeFor(router, "gen-fingerprint", "SOLO", 1);
  const atomic = new InMemoryGenesisAtomicPort();
  const genesis = new PressureChapterGenesisService(
    router,
    new StaticGenesisContent(),
    atomic,
  );
  await genesis.initialize(genesisCommand("gen-fingerprint"));

  await assert.rejects(
    genesis.initialize(
      genesisCommand("gen-fingerprint", digest("different-fingerprint")),
    ),
    (error: unknown) =>
      error instanceof GenesisError &&
      error.code ===
        GENESIS_ERROR_CODES.GENESIS_IDEMPOTENCY_FINGERPRINT_MISMATCH,
  );
  assert.deepEqual(atomic.counts("gen-fingerprint"), { snapshots: 1, commits: 1 });
});

test("GEN recovers from a crash after atomic commit by reading the durable receipt", async () => {
  const routeRepository = new InMemoryRunRouteRepository();
  const router = new PressureChapterRunRouterService(routeRepository, registry());
  await routeFor(router, "gen-crash", "MULTIPLAYER", 2);
  const content = new StaticGenesisContent();
  const atomic = new InMemoryGenesisAtomicPort();
  atomic.crashAfterCommitOnce = true;
  const genesis = new PressureChapterGenesisService(router, content, atomic);
  const command = genesisCommand("gen-crash");

  await assert.rejects(
    genesis.initialize(command),
    /SIMULATED_WORKER_CRASH_AFTER_COMMIT_BEFORE_ACK/,
  );
  assert.deepEqual(atomic.counts("gen-crash"), { snapshots: 1, commits: 1 });

  const recovered = await genesis.initialize(command);
  assert.equal(recovered.status, "REPLAYED");
  assert.equal(content.loads, 1);
  assert.equal(atomic.commitCalls, 1);
  assert.deepEqual(atomic.counts("gen-crash"), { snapshots: 1, commits: 1 });
});

test("GEN transaction failure leaves zero snapshot and zero commit", async () => {
  const routeRepository = new InMemoryRunRouteRepository();
  const router = new PressureChapterRunRouterService(routeRepository, registry());
  await routeFor(router, "gen-rollback", "SOLO", 1);
  const atomic = new InMemoryGenesisAtomicPort();
  atomic.failBeforeCommitOnce = true;
  const genesis = new PressureChapterGenesisService(
    router,
    new StaticGenesisContent(),
    atomic,
  );

  await assert.rejects(
    genesis.initialize(genesisCommand("gen-rollback")),
    /SIMULATED_GENESIS_TRANSACTION_ROLLBACK/,
  );
  assert.deepEqual(atomic.counts("gen-rollback"), { snapshots: 0, commits: 0 });
});

test("GEN rejects non-P0 world state before the atomic port is called", async () => {
  const routeRepository = new InMemoryRunRouteRepository();
  const router = new PressureChapterRunRouterService(routeRepository, registry());
  await routeFor(router, "gen-invalid-world", "SOLO", 1);
  const atomic = new InMemoryGenesisAtomicPort();
  const genesis = new PressureChapterGenesisService(
    router,
    new StaticGenesisContent(worldState(1)),
    atomic,
  );

  await assert.rejects(
    genesis.initialize(genesisCommand("gen-invalid-world")),
    (error: unknown) => error instanceof Error && error.message.includes("worldSequence"),
  );
  assert.equal(atomic.commitCalls, 0);
  assert.deepEqual(atomic.counts("gen-invalid-world"), { snapshots: 0, commits: 0 });
});

test("GEN concurrent identical initialization produces one durable pair", async () => {
  const routeRepository = new InMemoryRunRouteRepository();
  const router = new PressureChapterRunRouterService(routeRepository, registry());
  await routeFor(router, "gen-concurrent", "MULTIPLAYER", 6);
  const atomic = new InMemoryGenesisAtomicPort();
  const genesis = new PressureChapterGenesisService(
    router,
    new StaticGenesisContent(),
    atomic,
  );
  const command = genesisCommand("gen-concurrent");

  const results = await Promise.all([
    genesis.initialize(command),
    genesis.initialize(command),
  ]);
  assert.deepEqual(
    results.map((result) => result.status).sort(),
    ["COMMITTED", "REPLAYED"],
  );
  assert.equal(
    results[0]!.committed.record.atomicRecordHash,
    results[1]!.committed.record.atomicRecordHash,
  );
  assert.deepEqual(atomic.counts("gen-concurrent"), { snapshots: 1, commits: 1 });
});
