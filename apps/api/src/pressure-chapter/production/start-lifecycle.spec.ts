import assert from "node:assert/strict";
import test from "node:test";
import {
  PRESSURE_CHAPTER_SEAT_IDS_V1,
  sha256Canonical,
  type ParticipantModeV1,
} from "@ai-story/shared";
import {
  PRESSURE_CHAPTER_ROUTE_REGISTRY_SCHEMA_V1,
  PRESSURE_CHAPTER_ROUTE_TUPLE_V1,
  PressureChapterRouteRegistry,
  computePressureChapterRouteRegistryHash,
  type PressureChapterRouteRegistryV1,
} from "@ai-story/templates";
import type {
  InitializeGenesisCommandV1,
  InitializeGenesisResultV1,
} from "../genesis";
import type { ChapterOrchestratorStateV1 } from "../orchestrator/contracts";
import { PressureChapterRunRouterService } from "../run-router";
import type {
  CreatePressureRunRouteCommandV1,
  RunRouteRepositoryPort,
  StoredRunRouteRecordV1,
} from "../run-router";
import type {
  InitializeSeatControlCommandV1,
  SeatControlCommandResultV1,
} from "../seat-control";
import type {
  OpenPressureN1FromGenesisHandoffCommandV1,
  OpenPressureN1FromGenesisHandoffResultV1,
} from "../runtime/contracts";
import {
  PRESSURE_PRODUCTION_DEPENDENCY_CONTRACT_V1,
  composePressureProductionCoreV1,
} from "./production-dependencies";
import {
  buildFrozenHumanSeatSet,
  buildPressureEffectiveStartMaterial,
  PressureStartLifecycleCoordinator,
  PressureStartLifecycleError,
  type FrozenPressureHumanSeatSetV1,
  type PressureGenesisInitializerPortV1,
  type PressureGenesisN1HandoffConsumerPortV1,
  type PressureSeatControlInitializerPortV1,
  type PressureStartBoundaryRequestV1,
  type PressureStartBoundaryPortV1,
  type PressureStartCompletionV1,
  type PressureStartFailureV1,
  type StartPressureRunCommandV1,
} from "./start-lifecycle";

const digest = (label: string): string => sha256Canonical({ label });

class InMemoryRunRouteRepository implements RunRouteRepositoryPort {
  readonly records = new Map<string, StoredRunRouteRecordV1>();

  async findByRunId(runId: string): Promise<StoredRunRouteRecordV1 | null> {
    const value = this.records.get(runId);
    return value ? structuredClone(value) : null;
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

function routeRegistry(): PressureChapterRouteRegistry {
  const base: Omit<PressureChapterRouteRegistryV1, "registryHash"> = {
    schemaVersion: PRESSURE_CHAPTER_ROUTE_REGISTRY_SCHEMA_V1,
    registryVersion: "pressure-production-test-registry-v1",
    defaultRouteKey: "sangtian-pressure",
    routes: [
      {
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
        narrativeProfileVersion: "openovel-pressure-v1",
        featureSetVersion: "features-v1",
        resultContractRegistryVersion: "result-v1",
        controlTopologyVersion: "six-seat-v1",
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

class RecordingBoundary implements PressureStartBoundaryPortV1 {
  readonly frozen = new Map<string, FrozenPressureHumanSeatSetV1>();
  readonly completions = new Map<string, PressureStartCompletionV1>();
  readonly failures: PressureStartFailureV1[] = [];

  constructor(private readonly log: string[]) {}

  async finalizeHumanSeatSet(request: Readonly<PressureStartBoundaryRequestV1>) {
    this.log.push("boundary.freeze");
    const existing = this.frozen.get(request.runId);
    if (existing) {
      return { status: "EXISTING" as const, frozen: structuredClone(existing) };
    }
    const effectiveStart = buildPressureEffectiveStartMaterial({
      startRequestFingerprint: request.requestFingerprint,
      idempotencyKey: `server-start:${request.runId}`,
      runSeed: `server-seed:${request.runId}`,
    });
    const frozen = buildFrozenHumanSeatSet(request, effectiveStart);
    this.frozen.set(request.runId, structuredClone(frozen));
    return { status: "FROZEN" as const, frozen: structuredClone(frozen) };
  }

  async markStarted(completion: Readonly<PressureStartCompletionV1>) {
    this.log.push("boundary.started");
    const existing = this.completions.get(completion.runId);
    if (existing) {
      return { status: "EXISTING" as const, completion: structuredClone(existing) };
    }
    this.completions.set(completion.runId, structuredClone(completion));
    return { status: "STARTED" as const, completion: structuredClone(completion) };
  }

  async recordFailure(failure: Readonly<PressureStartFailureV1>): Promise<void> {
    this.log.push("boundary.failure");
    this.failures.push(structuredClone(failure));
  }
}

class RecordingGenesis implements PressureGenesisInitializerPortV1 {
  readonly committed = new Map<string, InitializeGenesisResultV1>();
  calls = 0;
  fail = false;

  constructor(
    private readonly routes: InMemoryRunRouteRepository,
    private readonly log: string[],
  ) {}

  async initialize(
    command: InitializeGenesisCommandV1,
  ): Promise<InitializeGenesisResultV1> {
    this.log.push("genesis.P0");
    this.calls += 1;
    if (this.fail) throw new Error("P0_UNAVAILABLE");
    const existing = this.committed.get(command.runId);
    if (existing) return { ...structuredClone(existing), status: "REPLAYED" };
    const route = this.routes.records.get(command.runId);
    assert.ok(route);
    const genesisHash = digest(`genesis:${command.runId}`);
    const initialWorldStateHash = digest(`world:${command.runId}`);
    const commitHash = digest(`commit:${command.runId}`);
    const result = {
      status: "COMMITTED",
      committed: {
        record: {
          schemaVersion: "sangtian_genesis_atomic_record_v1",
          runId: command.runId,
          routeRecordHash: route.recordHash,
          controlTopology: route.controlTopology,
          snapshot: {
            schemaVersion: "sangtian_genesis_snapshot_v1",
            runId: command.runId,
            routeHash: route.snapshot.routeHash,
            genesisHash,
            initialWorldState: { stateHash: initialWorldStateHash },
          },
          commit: {
            schemaVersion: "sangtian_genesis_commit_v1",
            runId: command.runId,
            sequence: 0,
            idempotencyKey: command.idempotencyKey,
            requestFingerprint: command.requestFingerprint,
            inputHash: digest(`input:${command.runId}`),
            routeHash: route.snapshot.routeHash,
            genesisHash,
            initialWorldStateHash,
            initialTrackStateHash: digest(`track:${command.runId}`),
            initialKnowledgeBoundaryHash: digest(`knowledge:${command.runId}`),
            initialControlTopologyHash: route.controlTopology.topologyHash,
            commitHash,
          },
          atomicRecordHash: digest(`atomic:${command.runId}`),
        },
        receipt: {
          schemaVersion: "sangtian_genesis_commit_receipt_v1",
          runId: command.runId,
          sequence: 0,
          idempotencyKey: command.idempotencyKey,
          requestFingerprint: command.requestFingerprint,
          inputHash: digest(`input:${command.runId}`),
          routeHash: route.snapshot.routeHash,
          genesisHash,
          commitHash,
          atomicRecordHash: digest(`atomic:${command.runId}`),
          receiptHash: digest(`receipt:${command.runId}`),
        },
      },
    } as unknown as InitializeGenesisResultV1;
    this.committed.set(command.runId, structuredClone(result));
    return result;
  }
}

class RecordingSeatControl implements PressureSeatControlInitializerPortV1 {
  readonly committed = new Map<string, SeatControlCommandResultV1>();
  calls = 0;

  constructor(
    private readonly routes: InMemoryRunRouteRepository,
    private readonly genesis: RecordingGenesis,
    private readonly log: string[],
  ) {}

  async initialize(
    command: InitializeSeatControlCommandV1,
  ): Promise<SeatControlCommandResultV1> {
    this.log.push("seat-control.initialize");
    this.calls += 1;
    const existing = this.committed.get(command.runId);
    if (existing) return { ...structuredClone(existing), status: "REPLAYED" };
    const route = this.routes.records.get(command.runId);
    const genesis = this.genesis.committed.get(command.runId);
    assert.ok(route && genesis);
    const genesisHash = genesis.committed.record.snapshot.genesisHash;
    const humans = new Map(
      command.humanAssignments.map((assignment) => [assignment.seatId, assignment]),
    );
    const result = {
      status: "COMMITTED",
      committed: {
        snapshot: {
          schemaVersion: "pressure_seat_control_snapshot_v1",
          runId: command.runId,
          participantMode: route.snapshot.participantMode,
          routeHash: route.snapshot.routeHash,
          genesisHash,
          genesisAtomicRecordHash: genesis.committed.record.atomicRecordHash,
          initialTopologyHash: route.controlTopology.topologyHash,
          controlTopologyVersion: route.snapshot.controlTopologyVersion,
          frozenPolicy: {},
          stateRevision: 0,
          timelineLength: 6,
          timelineHeadHash: digest(`timeline:${command.runId}`),
          seatControls: PRESSURE_CHAPTER_SEAT_IDS_V1.map((seatId) => {
            const human = humans.get(seatId);
            return {
              seatId,
              mode: human ? "HUMAN_ACTIVE" : "AI_ACTIVE",
              originalHumanControllerId: human?.humanControllerId ?? null,
              designatedAiControllerId: `ai:${command.runId}:${seatId}`,
              activeControllerId:
                human?.humanControllerId ?? `ai:${command.runId}:${seatId}`,
              controlEpoch: 0,
              submissionFenceToken: digest(`submit:${command.runId}:${seatId}`),
              reclaimFenceToken: null,
              lastAuthorityEventHash: digest(`event:${command.runId}:${seatId}`),
            };
          }),
          initializationInputHash: digest(`seat-input:${command.runId}`),
          stateHash: digest(`seat-state:${command.runId}`),
        },
        events: [],
        receipt: {},
      },
    } as unknown as SeatControlCommandResultV1;
    this.committed.set(command.runId, structuredClone(result));
    return result;
  }
}

class DurableHandoff implements PressureGenesisN1HandoffConsumerPortV1 {
  readonly chapters = new Map<string, ChapterOrchestratorStateV1>();
  readonly dedupeKeys: string[] = [];
  physicalN1OpenCount = 0;
  acknowledgedCount = 0;
  failAfterFirstOpenBeforeAck = false;

  constructor(private readonly log: string[]) {}

  async openFromGenesisHandoff(
    command: Readonly<OpenPressureN1FromGenesisHandoffCommandV1>,
  ): Promise<OpenPressureN1FromGenesisHandoffResultV1> {
    this.log.push("handoff.claim-open-ack");
    this.dedupeKeys.push(command.handoff.outboxDedupeKey);
    const existing = this.chapters.get(command.handoff.runId);
    let chapter = existing;
    if (!chapter) {
      chapter = {
        schemaVersion: "pressure_chapter_orchestrator_state_v1",
        runId: command.handoff.runId,
        routeHash: command.routeSnapshot.routeHash,
        revision: 0,
        phase: "ACTIVE",
        currentChapterId: "N1",
        chapterRuntimeId: `runtime:${command.handoff.runId}:N1`,
        descriptorHash: digest(`descriptor:${command.handoff.runId}`),
        authorityBase: {
          baseWorldSequence: 0,
          baseWorldStateHash:
            command.genesis.record.snapshot.initialWorldState.stateHash,
          previousFrozenHash: digest(`previous:${command.handoff.runId}`),
        },
        activeDecision: null,
        chapterSeatSummaries: [],
        settlementInputHash: null,
        frozenBundleHash: null,
        orchestratorHash: digest(`chapter:${command.handoff.runId}:N1`),
      };
      this.chapters.set(command.handoff.runId, structuredClone(chapter));
      this.physicalN1OpenCount += 1;
      if (this.failAfterFirstOpenBeforeAck) {
        this.failAfterFirstOpenBeforeAck = false;
        throw new Error("SIMULATED_CRASH_AFTER_N1_BEFORE_ACK");
      }
    }
    this.acknowledgedCount += 1;
    return {
      status: existing ? "REPLAYED" : "OPENED",
      sourceTaskType: "OPEN_CHAPTER",
      sourceAuthority: "GENESIS_FROZEN",
      sourceDedupeKey: command.handoff.outboxDedupeKey,
      sourceCommitHash: command.handoff.sourceCommitHash,
      outboxStatus: "ACKNOWLEDGED",
      chapter: structuredClone(chapter),
    };
  }
}

function command(
  runId: string,
  participantMode: ParticipantModeV1,
  humanCount: number,
): StartPressureRunCommandV1 {
  return {
    runId,
    requestedByUserId: "owner-1",
    participantMode,
    humanAssignments: Array.from({ length: humanCount }, (_, index) => ({
      seatId:
        PRESSURE_CHAPTER_SEAT_IDS_V1[
          index % PRESSURE_CHAPTER_SEAT_IDS_V1.length
        ],
      userId: `user-${index}`,
      humanControllerId: `human-controller-${index}`,
    })),
    routeKey: null,
    nowMs: 1_726_000_000_000,
  };
}

function harness() {
  const log: string[] = [];
  const repository = new InMemoryRunRouteRepository();
  const router = new PressureChapterRunRouterService(repository, routeRegistry());
  const routes = {
    create: async (input: CreatePressureRunRouteCommandV1) => {
      log.push("route.freeze");
      return router.create(input);
    },
  };
  const boundary = new RecordingBoundary(log);
  const genesis = new RecordingGenesis(repository, log);
  const seatControl = new RecordingSeatControl(repository, genesis, log);
  const handoff = new DurableHandoff(log);
  const coordinator = new PressureStartLifecycleCoordinator(
    boundary,
    routes,
    genesis,
    seatControl,
    handoff,
  );
  return { log, repository, boundary, genesis, seatControl, handoff, coordinator };
}

test("start freezes route only at start and orders P0, SeatControl, then the unique Genesis N1 handoff", async () => {
  const h = harness();
  assert.equal(h.repository.records.size, 0);

  const result = await h.coordinator.start(command("ordered-run", "MULTIPLAYER", 2));
  assert.deepEqual(h.log, [
    "boundary.freeze",
    "route.freeze",
    "genesis.P0",
    "seat-control.initialize",
    "handoff.claim-open-ack",
    "boundary.started",
  ]);
  assert.equal(h.repository.records.size, 1);
  assert.equal(
    result.route.route.snapshot.runSeed,
    "server-seed:ordered-run",
  );
  assert.equal(
    result.frozenHumanSeatSet.effectiveStart.idempotencyKey,
    "server-start:ordered-run",
  );
  assert.equal(result.route.route.snapshot.humanSeatIdsAtStart.length, 2);
  assert.equal(
    result.seatControl.committed.snapshot.seatControls.filter(
      (seat) => seat.mode === "HUMAN_ACTIVE",
    ).length,
    2,
  );
  assert.equal(
    result.seatControl.committed.snapshot.seatControls.filter(
      (seat) => seat.mode === "AI_ACTIVE",
    ).length,
    4,
  );
  assert.equal(h.handoff.physicalN1OpenCount, 1);
  assert.equal(result.n1Handoff.sourceDedupeKey, `open_chapter:ordered-run:N1:${result.genesis.committed.record.commit.commitHash}`);
});

test("start materializes the authoritative Solo 1+5 and Multiplayer 6+0 control topologies", async () => {
  for (const [runId, mode, humanCount, aiCount] of [
    ["solo-topology", "SOLO", 1, 5],
    ["mp-six-topology", "MULTIPLAYER", 6, 0],
  ] as const) {
    const h = harness();
    const result = await h.coordinator.start(command(runId, mode, humanCount));
    assert.equal(
      result.route.route.controlTopology.seatControls.filter(
        (seat) => seat.mode === "HUMAN_ACTIVE",
      ).length,
      humanCount,
    );
    assert.equal(
      result.seatControl.committed.snapshot.seatControls.filter(
        (seat) => seat.mode === "AI_ACTIVE",
      ).length,
      aiCount,
    );
  }
});

test("idempotent start replays every durable stage without opening a second N1", async () => {
  const h = harness();
  const start = command("idempotent-run", "SOLO", 1);
  const first = await h.coordinator.start(start);
  h.log.length = 0;
  const second = await h.coordinator.start({ ...start, nowMs: start.nowMs + 60_000 });

  assert.equal(first.status, "STARTED");
  assert.equal(second.status, "EXISTING");
  assert.equal(second.route.status, "EXISTING");
  assert.equal(second.genesis.status, "REPLAYED");
  assert.equal(second.seatControl.status, "REPLAYED");
  assert.equal(second.n1Handoff.status, "REPLAYED");
  assert.equal(h.handoff.physicalN1OpenCount, 1);
  assert.equal(new Set(h.handoff.dedupeKeys).size, 1);
  assert.deepEqual(h.log, [
    "boundary.freeze",
    "route.freeze",
    "genesis.P0",
    "seat-control.initialize",
    "handoff.claim-open-ack",
    "boundary.started",
  ]);
});

test("start rejects browser-controlled seed or idempotency material", async () => {
  const h = harness();
  const base = command("untrusted-start-material", "SOLO", 1);
  await assert.rejects(
    h.coordinator.start({ ...base, runSeed: "browser-seed" } as never),
    /PRESSURE_PRODUCTION_INVALID_COMMAND:start-command:server-owned-material/,
  );
  await assert.rejects(
    h.coordinator.start({ ...base, idempotencyKey: "browser-key" } as never),
    /PRESSURE_PRODUCTION_INVALID_COMMAND:start-command:server-owned-material/,
  );
  assert.deepEqual(h.log, []);
  assert.equal(h.repository.records.size, 0);
});

test("crash after N1 open before ack reclaims the same handoff and observes one N1", async () => {
  const h = harness();
  h.handoff.failAfterFirstOpenBeforeAck = true;
  const start = command("crash-recovery-run", "MULTIPLAYER", 3);

  await assert.rejects(
    h.coordinator.start(start),
    (error: unknown) =>
      error instanceof PressureStartLifecycleError &&
      error.failedStage === "OPEN_N1" &&
      error.completedStages.at(-1) === "SEAT_CONTROL_INITIALIZED",
  );
  assert.equal(h.handoff.physicalN1OpenCount, 1);
  assert.equal(h.handoff.acknowledgedCount, 0);
  assert.equal(h.boundary.failures.length, 1);
  assert.equal(h.boundary.failures[0].failedStage, "OPEN_N1");

  const recovered = await h.coordinator.start({
    ...start,
    nowMs: start.nowMs + 60_000,
  });
  assert.equal(recovered.status, "STARTED");
  assert.equal(recovered.n1Handoff.status, "REPLAYED");
  assert.equal(h.handoff.physicalN1OpenCount, 1);
  assert.equal(h.handoff.acknowledgedCount, 1);
  assert.equal(new Set(h.handoff.dedupeKeys).size, 1);
  assert.equal(h.handoff.dedupeKeys[0], recovered.n1Handoff.sourceDedupeKey);
});

test("invalid Solo/Multiplayer start cardinalities cause no freeze or route write", async () => {
  for (const invalid of [
    command("bad-solo-zero", "SOLO", 0),
    command("bad-solo-two", "SOLO", 2),
    command("bad-mp-one", "MULTIPLAYER", 1),
    command("bad-mp-seven", "MULTIPLAYER", 7),
  ]) {
    const h = harness();
    await assert.rejects(h.coordinator.start(invalid), /PRESSURE_PRODUCTION_INVALID_COMMAND/);
    assert.deepEqual(h.log, []);
    assert.equal(h.repository.records.size, 0);
  }
});

test("a downstream failure records visible partial progress and never advances later stages", async () => {
  const h = harness();
  h.genesis.fail = true;
  await assert.rejects(
    h.coordinator.start(command("p0-failure", "MULTIPLAYER", 2)),
    (error: unknown) =>
      error instanceof PressureStartLifecycleError &&
      error.failedStage === "RUN_P0_GENESIS" &&
      error.completedStages.join(",") === "HUMAN_SEATS_FROZEN,ROUTE_FROZEN",
  );
  assert.deepEqual(h.log, [
    "boundary.freeze",
    "route.freeze",
    "genesis.P0",
    "boundary.failure",
  ]);
  assert.equal(h.repository.records.size, 1);
  assert.equal(h.seatControl.calls, 0);
  assert.equal(h.handoff.physicalN1OpenCount, 0);
  assert.equal(h.boundary.failures[0].errorCode, "Error");
});

test("composition is fail-closed and has no Provider or Narrative start dependency", () => {
  assert.throws(
    () => composePressureProductionCoreV1({} as never),
    /PRESSURE_PRODUCTION_DEPENDENCY_MISSING:runShellWriter\.createOnce/,
  );
  const keys = PRESSURE_PRODUCTION_DEPENDENCY_CONTRACT_V1.map((entry) => entry.key);
  assert.deepEqual(keys, [
    "roleCatalog",
    "runShellWriter",
    "lobbyPersistence",
    "startBoundary",
    "routeRouter",
    "genesis",
    "seatControl",
    "n1Handoff",
    "legacyRoleRegistry",
  ]);
  assert.equal(keys.some((key) => /provider|narrative/i.test(key)), false);
});
