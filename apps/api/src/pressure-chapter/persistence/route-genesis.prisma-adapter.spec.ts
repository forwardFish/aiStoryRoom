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
import { PressureChapterGenesisService } from "../genesis/genesis.service";
import type { GenesisContentPort } from "../genesis/types";
import type {
  ExtendedAuthoritativeNarrativeSnapshotCompilerPortV1,
} from "../narrative-authority/contracts";
import { PressureChapterRunRouterService } from "../run-router/run-router.service";
import {
  PrismaGenesisAtomicCommitRepository,
  type GenesisPrismaClient,
} from "./genesis.prisma-adapter";
import {
  PrismaRunRouteRepository,
  type RunRoutePrismaClient,
} from "./run-route.prisma-adapter";

const digest = (label: string): string => sha256Canonical({ label });

test("Run five-tuple freezes once; P0 Genesis commits atomically without settlement/world advance", async () => {
  const routeDb = new RouteFake();
  const routeRepository = new PrismaRunRouteRepository(routeDb.client);
  const router = new PressureChapterRunRouterService(routeRepository, registry());
  const created = await router.create({
    runId: "run-route-genesis",
    participantMode: "SOLO",
    humanSeatIdsAtStart: [PRESSURE_CHAPTER_SEAT_IDS_V1[0]],
    runSeed: "seed-route-genesis",
  });
  assert.equal(created.status, "CREATED");
  assert.deepEqual(created.route.snapshot.route, PRESSURE_CHAPTER_ROUTE_TUPLE_V1);
  assert.equal(routeDb.rows.length, 1);
  assert.deepEqual(routeDb.rows[0]?.routeJson, created.route, "routeJson is lossless full record");

  const genesisDb = new GenesisFake(
    created.route.snapshot.routeHash,
    created.route.runId,
  );
  const genesisRepository = new PrismaGenesisAtomicCommitRepository(
    genesisDb.client,
    narrativeCompilerStub(),
  );
  const service = new PressureChapterGenesisService(
    router,
    new StaticContent(worldState()),
    genesisRepository,
  );
  const requestFingerprint = digest("genesis-request");
  const first = await service.initialize({
    runId: created.route.runId,
    idempotencyKey: "genesis:run-route-genesis",
    requestFingerprint,
  });
  assert.equal(first.status, "COMMITTED");
  assert.equal(genesisDb.snapshots.length, 0, "Genesis is embedded in the commit manifest");
  assert.equal(genesisDb.commits.length, 1);
  assert.equal(genesisDb.rootEvents.length, 1);
  assert.equal(
    genesisDb.rootEvents[0]?.sequence,
    null,
    "P0 keeps sequence 0 in its authority payload; StoryEvent's legacy positive sequence stays null",
  );
  assert.equal(genesisDb.outbox.length, 8);
  assert.equal(genesisDb.projections.length, 7);
  assert.equal(
    genesisDb.outbox.filter((row) => row.taskType === "PROJECT_GENESIS_NARRATIVE").length,
    7,
  );
  assert.equal(genesisDb.run.worldSequence, 0, "P0 does not perform ChapterSettlement");
  assert(genesisDb.calls.indexOf("genesis.commit") < genesisDb.calls.indexOf("run.cas"));
  assert(genesisDb.calls.indexOf("run.cas") < genesisDb.calls.lastIndexOf("tx.commit"));

  const second = await service.initialize({
    runId: created.route.runId,
    idempotencyKey: "genesis:run-route-genesis",
    requestFingerprint,
  });
  assert.equal(second.status, "REPLAYED");
  assert.equal(genesisDb.commits.length, 1);
  assert.equal(genesisDb.projections.length, 7, "replay must not duplicate projections");
  assert.equal(genesisDb.outbox.length, 8, "replay must not duplicate outbox tasks");

  genesisDb.commits[0]!.outboxDedupeKeysJson = [];
  await assert.rejects(
    () => genesisRepository.readCommitted(created.route.runId),
    /Stored Genesis commit manifest is invalid/i,
  );
});

class RouteFake {
  readonly rows: Array<Record<string, any>> = [];
  readonly tx = {
    pressureRunRouteSnapshot: {
      findUnique: async (_input: any): Promise<any> => null,
      create: async (_input: any): Promise<any> => ({}),
    },
  };
  readonly client: RunRoutePrismaClient = {
    $transaction: async <T>(operation: (tx: any) => Promise<T>): Promise<T> => {
      this.tx.pressureRunRouteSnapshot.findUnique = async ({ where }: any) => {
        const row = this.rows.find((candidate) => candidate.runId === where.runId);
        return row ? structuredClone(row) : null;
      };
      this.tx.pressureRunRouteSnapshot.create = async ({ data }: any) => {
        const row = structuredClone(data);
        this.rows.push(row);
        return structuredClone(row);
      };
      return operation(this.tx);
    },
  };
}

class GenesisFake {
  readonly calls: string[] = [];
  readonly snapshots: Array<Record<string, any>> = [];
  readonly commits: Array<Record<string, any>> = [];
  readonly rootEvents: Array<Record<string, any>> = [];
  readonly outbox: Array<Record<string, any>> = [];
  readonly projections: Array<Record<string, any>> = [];
  readonly run: Record<string, any>;

  constructor(
    private readonly routeHash: string,
    runId: string,
  ) {
    this.run = {
      id: runId,
      worldSequence: 0,
      reservedWorldSequence: 0,
      stateJson: {},
      currentNodeId: null,
    };
  }

  readonly tx = {
    pressureGenesisCommit: {
      findUnique: async (_input: any): Promise<any> => null,
      create: async (_input: any): Promise<any> => ({}),
    },
    pressureGenesisSnapshot: {
      create: async (_input: any): Promise<any> => ({ id: "" }),
    },
    pressureRunRouteSnapshot: {
      findUnique: async (_input: any): Promise<any> => null,
    },
    pressureOutboxTask: { create: async (_input: any): Promise<any> => ({}) },
    pressureNarrativeProjection: { create: async (_input: any): Promise<any> => ({ id: "" }) },
    storyEvent: { create: async (_input: any): Promise<any> => ({}) },
    storyRun: { updateMany: async (_input: any): Promise<any> => ({ count: 0 }) },
  };

  readonly client: GenesisPrismaClient = {
    $transaction: async <T>(operation: (tx: any) => Promise<T>): Promise<T> => {
      this.installDelegates();
      this.calls.push("tx.begin");
      const result = await operation(this.tx);
      this.calls.push("tx.commit");
      return result;
    },
  };

  private installDelegates(): void {
    this.tx.pressureGenesisCommit.findUnique = async ({ where }: any) => {
      const row = this.commits.find((candidate) => candidate.runId === where.runId);
      return row
        ? {
            runId: row.runId,
            commitManifestJson: structuredClone(row.commitManifestJson),
            outboxDedupeKeysJson: structuredClone(row.outboxDedupeKeysJson),
          }
        : null;
    };
    this.tx.pressureGenesisCommit.create = async ({ data }: any) => {
      this.calls.push("genesis.commit");
      this.commits.push(structuredClone(data));
      return data;
    };
    this.tx.pressureGenesisSnapshot.create = async ({ data }: any) => {
      this.calls.push("genesis.snapshot");
      const row = { id: "genesis-snapshot-1", ...structuredClone(data) };
      this.snapshots.push(row);
      return { id: row.id };
    };
    this.tx.pressureRunRouteSnapshot.findUnique = async () => ({ routeHash: this.routeHash });
    this.tx.pressureOutboxTask.create = async ({ data }: any) => {
      this.calls.push("outbox.create");
      this.outbox.push(structuredClone(data));
      return data;
    };
    this.tx.pressureNarrativeProjection.create = async ({ data }: any) => {
      this.calls.push("projection.create");
      const row = { id: `projection-${this.projections.length + 1}`, ...structuredClone(data) };
      this.projections.push(row);
      return { id: row.id };
    };
    this.tx.storyEvent.create = async ({ data }: any) => {
      this.calls.push("root-event.create");
      this.rootEvents.push(structuredClone(data));
      return data;
    };
    this.tx.storyRun.updateMany = async ({ where, data }: any) => {
      this.calls.push("run.cas");
      if (
        where.id !== this.run.id
        || where.worldSequence !== this.run.worldSequence
        || where.reservedWorldSequence !== this.run.reservedWorldSequence
      ) return { count: 0 };
      Object.assign(this.run, structuredClone(data));
      return { count: 1 };
    };
  }
}

function narrativeCompilerStub(): ExtendedAuthoritativeNarrativeSnapshotCompilerPortV1 {
  return {
    compile: () => ({}),
    deriveAudienceAllowlist: (job) => ({
      audience: structuredClone(job.audience),
      allowedFactIds: [],
      allowedObjectVersionIds: [],
      allowedKnowledgeIds: [],
    }),
  };
}

class StaticContent implements GenesisContentPort {
  constructor(private readonly world: WorldStateV1) {}
  async loadP0(): Promise<WorldStateV1> {
    return structuredClone(this.world);
  }
}

function registry(): PressureChapterRouteRegistry {
  const base: Omit<PressureChapterRouteRegistryV1, "registryHash"> = {
    schemaVersion: PRESSURE_CHAPTER_ROUTE_REGISTRY_SCHEMA_V1,
    registryVersion: "pressure-route-registry-v1",
    defaultRouteKey: "sangtian-pressure",
    routes: [{
      routeKey: "sangtian-pressure",
      worldId: "sangtian",
      status: "PUBLISHED",
      createEnabled: true,
      participantModes: ["SOLO", "MULTIPLAYER"],
      route: { ...PRESSURE_CHAPTER_ROUTE_TUPLE_V1 },
      contentPackageVersion: "sangtian-content-v1",
      contentPackageSha256: digest("content"),
      orchestrationPackageVersion: "sangtian-orchestration-v1",
      orchestrationPackageSha256: digest("orchestration"),
      runtimeContractVersion: "pressure-runtime-v1",
      runtimeContractSha256: digest("runtime"),
      testMatrixVersion: "pressure-tests-v1",
      testMatrixSha256: digest("tests"),
      narrativeProfileVersion: "openovel-pressure-v1",
      featureSetVersion: "pressure-feature-v1",
      resultContractRegistryVersion: "pressure-result-registry-v1",
      controlTopologyVersion: "six-seat-control-v1",
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
    values: Object.fromEntries(
      TRACK_IDS_V1.map((trackId, index) => [trackId, index]),
    ) as Record<TrackIdV1, number>,
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
