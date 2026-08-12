import assert from "node:assert/strict";
import test from "node:test";
import {
  PRESSURE_CHAPTER_SEAT_IDS_V1,
  TRACK_IDS_V1,
  sha256Canonical,
  type KnowledgeStateV1,
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
  PressureChapterGenesisService,
  buildGenesisCommitReceipt,
  type CommittedGenesisV1,
  type GenesisAtomicCommitPort,
  type GenesisAtomicRecordV1,
  type GenesisContentPort,
} from "../genesis";
import type {
  ChapterOrchestratorStateV1,
  StartChapterRunCommandV1,
} from "../orchestrator/contracts";
import { PressureChapterRunRouterService } from "../run-router";
import type {
  RunRouteRepositoryPort,
  StoredRunRouteRecordV1,
} from "../run-router";
import {
  buildGenesisOpenN1OutboxDedupeKeyV1,
  type OpenPressureN1FromGenesisHandoffCommandV1,
  type RuntimeChapterHandoffStartPortV1,
} from "../runtime/contracts";
import { PrismaGenesisOpenN1HandoffConsumerAdapter } from "./genesis-open-n1-handoff.prisma-adapter";
import type {
  GenesisOpenN1HandoffPrismaClient,
  GenesisOpenN1OutboxRow,
} from "./prisma-ports";

test("exact Genesis OPEN_CHAPTER claim/start/ack recovers start-before-ack crash without a second N1", async () => {
  const fixture = await handoffFixture();
  const db = new HandoffPrismaFake(fixture.command);
  const starter = new IdempotentStarter(fixture.command);
  const adapter = new PrismaGenesisOpenN1HandoffConsumerAdapter(
    db.client,
    starter,
    { workerId: "n1-test", leaseMs: 50 },
  );

  db.failNextAck = true;
  await assert.rejects(
    adapter.openFromGenesisHandoff(fixture.command),
    /simulated crash after start before ack/,
  );
  assert.equal(starter.openCount, 1);
  assert.equal(db.row.status, "LEASED");
  assert.equal(db.row.checkpoint, "HANDLER_STARTED");

  const recovered = await adapter.openFromGenesisHandoff({
    ...fixture.command,
    nowMs: fixture.command.nowMs + 100,
  });
  assert.equal(recovered.status, "REPLAYED");
  assert.equal(recovered.outboxStatus, "ACKNOWLEDGED");
  assert.equal(recovered.sourceDedupeKey, fixture.command.handoff.outboxDedupeKey);
  assert.equal(db.row.status, "COMPLETED");
  assert.equal(db.row.checkpoint, "ACKNOWLEDGED");
  assert.equal(starter.openCount, 1, "recovery reuses the same durable N1");

  const replay = await adapter.openFromGenesisHandoff({
    ...fixture.command,
    nowMs: fixture.command.nowMs + 200,
  });
  assert.equal(replay.status, "REPLAYED");
  assert.equal(replay.chapter.orchestratorHash, recovered.chapter.orchestratorHash);
  assert.equal(starter.openCount, 1);
  assert.equal(db.row.attempt, 2, "completed replay does not claim another attempt");
});

test("wrong OPEN_CHAPTER dedupe key fails closed before starter invocation", async () => {
  const fixture = await handoffFixture();
  const db = new HandoffPrismaFake(fixture.command);
  const starter = new IdempotentStarter(fixture.command);
  const adapter = new PrismaGenesisOpenN1HandoffConsumerAdapter(db.client, starter);
  await assert.rejects(
    adapter.openFromGenesisHandoff({
      ...fixture.command,
      handoff: { ...fixture.command.handoff, outboxDedupeKey: "wrong-key" },
    }),
    (error: any) => error?.code === "PRESSURE_AUTHORITY_FENCE_MISMATCH",
  );
  assert.equal(starter.callCount, 0);
  assert.equal(db.row.status, "PENDING");
});

test("fresh PENDING Genesis handoff is claimable even when database availableAt is after request time", async () => {
  const fixture = await handoffFixture();
  const db = new HandoffPrismaFake(fixture.command);
  const starter = new IdempotentStarter(fixture.command);
  db.row.availableAt = new Date(fixture.command.nowMs + 25);
  const adapter = new PrismaGenesisOpenN1HandoffConsumerAdapter(
    db.client,
    starter,
    { workerId: "n1-fresh-pending", leaseMs: 50 },
  );
  const result = await adapter.openFromGenesisHandoff(fixture.command);
  assert.equal(result.status, "OPENED");
  assert.equal(db.row.status, "COMPLETED");
  assert.equal(db.row.checkpoint, "ACKNOWLEDGED");
});

class HandoffPrismaFake {
  row: GenesisOpenN1OutboxRow;
  failNextAck = false;
  private tail: Promise<void> = Promise.resolve();

  constructor(command: OpenPressureN1FromGenesisHandoffCommandV1) {
    const payload = {
      schemaVersion: "pressure_open_chapter_task_v1",
      runId: command.handoff.runId,
      chapterId: "N1",
      genesisHash: command.handoff.genesisHash,
      sourceCommitHash: command.handoff.sourceCommitHash,
    };
    this.row = {
      id: "open-n1-row",
      runId: command.handoff.runId,
      taskType: "OPEN_CHAPTER",
      status: "PENDING",
      checkpoint: "PERSISTED",
      dedupeKey: command.handoff.outboxDedupeKey,
      sourceAuthority: "GENESIS_FROZEN",
      sourceId: command.handoff.genesisHash,
      sourceCommitHash: command.handoff.sourceCommitHash,
      payloadJson: payload,
      payloadHash: sha256Canonical(payload),
      attempt: 0,
      maxAttempts: 5,
      availableAt: new Date(0),
      leaseOwner: null,
      leaseExpiresAt: null,
      leaseVersion: 0,
      lastError: null,
      completedAt: null,
    };
  }

  readonly client: GenesisOpenN1HandoffPrismaClient = {
    $transaction: async <T>(operation: (tx: any) => Promise<T>): Promise<T> => {
      let release!: () => void;
      const previous = this.tail;
      this.tail = new Promise<void>((resolve) => { release = resolve; });
      await previous;
      const before = structuredClone(this.row);
      try {
        return await operation(this.tx);
      } catch (error) {
        this.row = before;
        throw error;
      } finally {
        release();
      }
    },
  };

  private readonly tx = {
    pressureOutboxTask: {
      findUnique: async ({ where }: any) => {
        if (
          (where.id !== undefined && where.id !== this.row.id) ||
          (where.dedupeKey !== undefined && where.dedupeKey !== this.row.dedupeKey)
        ) return null;
        return structuredClone(this.row);
      },
      updateMany: async ({ where, data }: any) => {
        if (data.status === "COMPLETED" && this.failNextAck) {
          this.failNextAck = false;
          throw new Error("simulated crash after start before ack");
        }
        if (!matches(this.row, where)) return { count: 0 };
        const next = structuredClone(this.row) as any;
        for (const [field, update] of Object.entries(data)) {
          if (update && typeof update === "object" && "increment" in update) {
            next[field] += Number((update as any).increment);
          } else next[field] = structuredClone(update);
        }
        this.row = next;
        return { count: 1 };
      },
    },
  };
}

class IdempotentStarter implements RuntimeChapterHandoffStartPortV1 {
  callCount = 0;
  openCount = 0;
  private chapter: ChapterOrchestratorStateV1 | null = null;

  constructor(private readonly fixture: OpenPressureN1FromGenesisHandoffCommandV1) {}

  async start(command: StartChapterRunCommandV1): Promise<ChapterOrchestratorStateV1> {
    this.callCount += 1;
    assert.equal(command.routeSnapshot.routeHash, this.fixture.routeSnapshot.routeHash);
    assert.equal(command.genesisHash, this.fixture.handoff.genesisHash);
    if (!this.chapter) {
      this.openCount += 1;
      const base = {
        schemaVersion: "pressure_chapter_orchestrator_state_v1" as const,
        runId: this.fixture.handoff.runId,
        routeHash: this.fixture.routeSnapshot.routeHash,
        revision: 0,
        phase: "ACTIVE" as const,
        currentChapterId: "N1" as const,
        chapterRuntimeId: "runtime-n1",
        descriptorHash: digest("descriptor"),
        authorityBase: {
          baseWorldSequence: 0,
          baseWorldStateHash: command.genesisWorldStateHash,
          previousFrozenHash: command.genesisHash,
        },
        activeDecision: null,
        chapterSeatSummaries: [],
        settlementInputHash: null,
        frozenBundleHash: null,
      };
      this.chapter = { ...base, orchestratorHash: sha256Canonical(base) };
    }
    return structuredClone(this.chapter);
  }
}

async function handoffFixture(): Promise<{
  command: OpenPressureN1FromGenesisHandoffCommandV1;
}> {
  const routes = new MemoryRouteRepository();
  const router = new PressureChapterRunRouterService(routes, routeRegistry());
  const created = await router.create({
    runId: "handoff-run",
    participantMode: "SOLO",
    humanSeatIdsAtStart: [PRESSURE_CHAPTER_SEAT_IDS_V1[0]],
    runSeed: "handoff-seed",
  });
  const atomic = new MemoryGenesisAtomic();
  const genesis = new PressureChapterGenesisService(
    router,
    new StaticGenesisContent(worldState()),
    atomic,
  );
  const initialized = await genesis.initialize({
    runId: created.route.runId,
    idempotencyKey: "genesis-handoff",
    requestFingerprint: digest("genesis-request"),
  });
  const sourceCommitHash = initialized.committed.record.commit.commitHash;
  return {
    command: {
      routeSnapshot: created.route.snapshot,
      genesis: initialized.committed,
      handoff: {
        schemaVersion: "pressure_genesis_n1_handoff_v1",
        taskType: "OPEN_CHAPTER",
        checkpoint: "PERSISTED",
        sourceAuthority: "GENESIS_FROZEN",
        runId: created.route.runId,
        chapterId: "N1",
        genesisHash: initialized.committed.record.snapshot.genesisHash,
        sourceCommitHash,
        outboxDedupeKey: buildGenesisOpenN1OutboxDedupeKeyV1(
          created.route.runId,
          sourceCommitHash,
        ),
      },
      idempotencyKey: "open-n1-handoff",
      requestFingerprint: digest("open-n1-request"),
      nowMs: 1_000,
    },
  };
}

class MemoryRouteRepository implements RunRouteRepositoryPort {
  private readonly rows = new Map<string, StoredRunRouteRecordV1>();
  async findByRunId(runId: string) {
    const row = this.rows.get(runId);
    return row ? structuredClone(row) : null;
  }
  async insertIfAbsent(record: StoredRunRouteRecordV1) {
    const existing = this.rows.get(record.runId);
    if (existing) return { status: "EXISTING" as const, record: structuredClone(existing) };
    this.rows.set(record.runId, structuredClone(record));
    return { status: "INSERTED" as const, record: structuredClone(record) };
  }
}

class MemoryGenesisAtomic implements GenesisAtomicCommitPort {
  private committed: CommittedGenesisV1 | null = null;
  async readCommitted() { return this.committed ? structuredClone(this.committed) : null; }
  async commitOnce(candidate: GenesisAtomicRecordV1) {
    if (this.committed) {
      return { status: "ALREADY_COMMITTED" as const, committed: structuredClone(this.committed) };
    }
    this.committed = {
      record: structuredClone(candidate),
      receipt: buildGenesisCommitReceipt(candidate),
    };
    return { status: "COMMITTED" as const, committed: structuredClone(this.committed) };
  }
}

class StaticGenesisContent implements GenesisContentPort {
  constructor(private readonly world: WorldStateV1) {}
  async loadP0() { return structuredClone(this.world); }
}

function routeRegistry(): PressureChapterRouteRegistry {
  const base: Omit<PressureChapterRouteRegistryV1, "registryHash"> = {
    schemaVersion: PRESSURE_CHAPTER_ROUTE_REGISTRY_SCHEMA_V1,
    registryVersion: "production-prisma-handoff-v1",
    defaultRouteKey: "sangtian-pressure",
    routes: [{
      routeKey: "sangtian-pressure",
      worldId: "sangtian",
      status: "PUBLISHED",
      createEnabled: true,
      participantModes: ["SOLO", "MULTIPLAYER"],
      route: { ...PRESSURE_CHAPTER_ROUTE_TUPLE_V1 },
      contentPackageVersion: "content-v1",
      contentPackageSha256: digest("content"),
      orchestrationPackageVersion: "orchestration-v1",
      orchestrationPackageSha256: digest("orchestration"),
      runtimeContractVersion: "runtime-v1",
      runtimeContractSha256: digest("runtime"),
      testMatrixVersion: "tests-v1",
      testMatrixSha256: digest("tests"),
      narrativeProfileVersion: "narrative-v1",
      featureSetVersion: "features-v1",
      resultContractRegistryVersion: "result-v1",
      controlTopologyVersion: "six-seat-v1",
      handlerKey: "pressure_chapter_v1",
      resultAdapterKey: "SangtianPressureResultV1Adapter",
      presentationSchemaVersion: "sangtian_pressure_result_v1",
      rendererKey: "sangtian_pressure_endgame_v1",
    }],
  };
  return new PressureChapterRouteRegistry({
    ...base,
    registryHash: computePressureChapterRouteRegistryHash(base),
  });
}

function worldState(): WorldStateV1 {
  const trackBase = {
    schemaVersion: "sangtian_track_state_v1" as const,
    values: Object.fromEntries(TRACK_IDS_V1.map((trackId, index) => [trackId, index])) as Record<TrackIdV1, number>,
  };
  const tracks: TrackStateV1 = { ...trackBase, stateHash: sha256Canonical(trackBase) };
  const knowledgeBySeat = Object.fromEntries(PRESSURE_CHAPTER_SEAT_IDS_V1.map((seatId) => {
    const base = {
      seatId,
      knownFactRefs: ["fact.public.sangtian_edict"],
      secretRefs: [`secret.${seatId}.initial`],
      disclosedToSeatIds: [] as SeatIdV1[],
    };
    return [seatId, { ...base, stateHash: sha256Canonical(base) }];
  })) as unknown as Record<SeatIdV1, KnowledgeStateV1>;
  const seatArcs = Object.fromEntries(PRESSURE_CHAPTER_SEAT_IDS_V1.map((seatId) => {
    const base = {
      seatId,
      arcStage: "P0_FROZEN",
      publicGoalProgress: 0,
      privateGoalProgress: 0,
      gainRefs: [],
      lossRefs: [],
      costRefs: [],
    };
    return [seatId, { ...base, stateHash: sha256Canonical(base) }];
  })) as unknown as Record<SeatIdV1, SeatArcStateV1>;
  const base = {
    schemaVersion: "sangtian_world_state_v1" as const,
    worldSequence: 0,
    factValues: { "fact.public.sangtian_edict": true, "frozen.P0.LOCKED": true },
    resources: { grain: 6, silver: 6 },
    tracks,
    objects: [],
    knowledgeBySeat,
    evidence: [],
    responsibilities: [],
    seatArcs,
  };
  return { ...base, stateHash: sha256Canonical(base) };
}

function matches(row: Record<string, any>, where: Record<string, any>): boolean {
  for (const [field, expected] of Object.entries(where)) {
    const actual = row[field];
    if (expected && typeof expected === "object" && !Array.isArray(expected)) {
      if ("lte" in expected && time(actual) > time(expected.lte)) return false;
      if ("gt" in expected && time(actual) <= time(expected.gt)) return false;
    } else if (actual !== expected) return false;
  }
  return true;
}

function time(value: unknown): number {
  return value instanceof Date ? value.getTime() : Number(value);
}

function digest(label: string): string {
  return sha256Canonical({ label });
}
