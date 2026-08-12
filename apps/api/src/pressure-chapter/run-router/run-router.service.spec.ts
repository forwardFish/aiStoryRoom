import assert from "node:assert/strict";
import test from "node:test";
import {
  PRESSURE_CHAPTER_SEAT_IDS_V1,
  hashWithoutField,
  sha256Canonical,
  type ParticipantModeV1,
} from "@ai-story/shared";
import {
  PRESSURE_CHAPTER_ROUTE_REGISTRY_SCHEMA_V1,
  PRESSURE_CHAPTER_ROUTE_TUPLE_V1,
  PressureChapterRouteRegistry,
  PressureChapterRouteRegistryError,
  computePressureChapterRouteRegistryHash,
  type PressureChapterRouteRegistryV1,
} from "@ai-story/templates";
import {
  RUN_ROUTER_ERROR_CODES,
  RunRouterError,
} from "./errors";
import { PressureChapterRunRouterService } from "./run-router.service";
import type {
  CreatePressureRunRouteCommandV1,
  PressureChapterRouteRegistryPort,
  RunRouteRepositoryPort,
  StoredRunRouteRecordV1,
} from "./types";

const digest = (label: string): string => sha256Canonical({ label });

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

  get size(): number {
    return this.records.size;
  }

  tamper(
    runId: string,
    mutate: (record: StoredRunRouteRecordV1) => StoredRunRouteRecordV1,
  ): void {
    const existing = this.records.get(runId);
    assert.ok(existing);
    this.records.set(runId, structuredClone(mutate(structuredClone(existing))));
  }
}

function registry(suffix = "v1"): PressureChapterRouteRegistry {
  const base: Omit<PressureChapterRouteRegistryV1, "registryHash"> = {
    schemaVersion: PRESSURE_CHAPTER_ROUTE_REGISTRY_SCHEMA_V1,
    registryVersion: `pressure-route-registry-${suffix}`,
    defaultRouteKey: "sangtian-pressure",
    routes: [
      {
        routeKey: "sangtian-pressure",
        worldId: "sangtian",
        status: "PUBLISHED",
        createEnabled: true,
        participantModes: ["SOLO", "MULTIPLAYER"],
        route: { ...PRESSURE_CHAPTER_ROUTE_TUPLE_V1 },
        contentPackageVersion: `sangtian-content-${suffix}`,
        contentPackageSha256: digest(`content-${suffix}`),
        orchestrationPackageVersion: `sangtian-orchestration-${suffix}`,
        orchestrationPackageSha256: digest(`orchestration-${suffix}`),
        runtimeContractVersion: `pressure-runtime-contract-${suffix}`,
        runtimeContractSha256: digest(`runtime-contract-${suffix}`),
        testMatrixVersion: `pressure-test-matrix-${suffix}`,
        testMatrixSha256: digest(`test-matrix-${suffix}`),
        narrativeProfileVersion: `openovel-pressure-${suffix}`,
        featureSetVersion: `pressure-feature-set-${suffix}`,
        resultContractRegistryVersion: `result-registry-${suffix}`,
        controlTopologyVersion: `six-seat-control-${suffix}`,
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

function command(
  runId: string,
  participantMode: ParticipantModeV1,
  humanCount: number,
): CreatePressureRunRouteCommandV1 {
  return {
    runId,
    routeKey: null,
    participantMode,
    humanSeatIdsAtStart: PRESSURE_CHAPTER_SEAT_IDS_V1.slice(0, humanCount),
    runSeed: `seed-${runId}`,
  };
}

test("RR freezes one-human Solo and two-to-six-human Multiplayer topologies", async () => {
  for (const [runId, mode, humanCount] of [
    ["run-solo", "SOLO", 1],
    ["run-mp-two", "MULTIPLAYER", 2],
    ["run-mp-six", "MULTIPLAYER", 6],
  ] as const) {
    const repository = new InMemoryRunRouteRepository();
    const service = new PressureChapterRunRouterService(repository, registry());
    const created = await service.create(command(runId, mode, humanCount));

    assert.equal(created.status, "CREATED");
    assert.deepEqual(created.route.snapshot.route, PRESSURE_CHAPTER_ROUTE_TUPLE_V1);
    assert.equal(created.route.snapshot.participantMode, mode);
    assert.equal(created.route.snapshot.humanSeatIdsAtStart.length, humanCount);
    assert.equal(created.route.controlTopology.seatControls.length, 6);
    assert.equal(
      created.route.controlTopology.seatControls.filter(
        (control) => control.mode === "HUMAN_ACTIVE",
      ).length,
      humanCount,
    );
    assert.equal(
      created.route.controlTopology.seatControls.filter(
        (control) => control.mode === "AI_ACTIVE",
      ).length,
      6 - humanCount,
    );
    assert.equal(
      created.route.snapshot.initialRoleControlSnapshotHash,
      created.route.controlTopology.topologyHash,
    );
    assert.equal(repository.size, 1);
  }
});

test("RR rejects one-human Multiplayer and two-human Solo with zero writes", async () => {
  for (const invalid of [
    command("run-invalid-mp", "MULTIPLAYER", 1),
    command("run-invalid-solo", "SOLO", 2),
  ]) {
    const repository = new InMemoryRunRouteRepository();
    const service = new PressureChapterRunRouterService(repository, registry());
    await assert.rejects(
      service.create(invalid),
      (error: unknown) =>
        error instanceof RunRouterError &&
        error.code === RUN_ROUTER_ERROR_CODES.HUMAN_SEAT_SELECTION_INVALID,
    );
    assert.equal(repository.size, 0);
  }
});

test("RR rejects unknown route and leaves no stored snapshot", async () => {
  const repository = new InMemoryRunRouteRepository();
  const service = new PressureChapterRunRouterService(repository, registry());
  await assert.rejects(
    service.create({
      ...command("run-unknown", "SOLO", 1),
      routeKey: "not-registered",
    }),
    (error: unknown) =>
      error instanceof PressureChapterRouteRegistryError &&
      error.code === "RUN_ROUTE_UNREGISTERED",
  );
  assert.equal(repository.size, 0);
});

test("RR create, game, result and replay use the immutable stored route", async () => {
  const repository = new InMemoryRunRouteRepository();
  const first = new PressureChapterRunRouterService(repository, registry("v1"));
  const createCommand = command("run-stable", "SOLO", 1);
  const created = await first.create(createCommand);

  const explodingRegistry: PressureChapterRouteRegistryPort = {
    registryVersion: "changed-live-registry",
    registryHash: digest("changed-live-registry"),
    defaultRouteKey: "changed-default",
    resolveCreate: () => assert.fail("existing create must not consult live registry"),
    resolveStored: () => assert.fail("stored dispatch must not consult live registry"),
  };
  const restarted = new PressureChapterRunRouterService(
    repository,
    explodingRegistry,
  );
  const replayedCreate = await restarted.create(createCommand);
  const game = await restarted.resolveGame("run-stable");
  const result = await restarted.resolveResult("run-stable");
  const replay = await restarted.resolveReplay("run-stable");

  assert.equal(replayedCreate.status, "EXISTING");
  assert.equal(replayedCreate.route.recordHash, created.route.recordHash);
  assert.equal(game.routeHash, created.route.snapshot.routeHash);
  assert.equal(result.routeHash, created.route.snapshot.routeHash);
  assert.equal(replay.routeHash, created.route.snapshot.routeHash);
  assert.deepEqual(result.route, PRESSURE_CHAPTER_ROUTE_TUPLE_V1);
});

test("RR rejects a reused run id with a different create fingerprint", async () => {
  const repository = new InMemoryRunRouteRepository();
  const service = new PressureChapterRunRouterService(repository, registry());
  await service.create(command("run-fingerprint", "MULTIPLAYER", 2));

  await assert.rejects(
    service.create(command("run-fingerprint", "MULTIPLAYER", 3)),
    (error: unknown) =>
      error instanceof RunRouterError &&
      error.code === RUN_ROUTER_ERROR_CODES.RUN_CREATE_FINGERPRINT_MISMATCH,
  );
  assert.equal(repository.size, 1);
});

test("RR fails closed when a stored contract hash no longer matches routeHash", async () => {
  const repository = new InMemoryRunRouteRepository();
  const service = new PressureChapterRunRouterService(repository, registry());
  await service.create(command("run-corrupt", "SOLO", 1));
  repository.tamper("run-corrupt", (record) => {
    const corrupted = {
      ...record,
      snapshot: {
        ...record.snapshot,
        contentPackageSha256: digest("tampered-content"),
      },
    };
    return {
      ...corrupted,
      recordHash: hashWithoutField(
        corrupted as unknown as Record<string, unknown>,
        "recordHash",
      ),
    };
  });

  await assert.rejects(
    service.resolveResult("run-corrupt"),
    (error: unknown) =>
      error instanceof Error && error.message.includes("RUN_ROUTE_HASH_MISMATCH"),
  );
});
