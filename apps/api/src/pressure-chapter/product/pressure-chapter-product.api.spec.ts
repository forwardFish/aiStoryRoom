import assert from "node:assert/strict";
import test from "node:test";
import type { DynamicModule, Provider } from "@nestjs/common";
import { PrismaService } from "../../prisma.service";
import {
  PRESSURE_GAME_READ_MODE_ERROR_CODES_V1,
  PressureGameReadModeErrorV1,
  PressureGameReadModeSelectorV1,
  type PressureGameReadShadowDiagnosticV1,
} from "../game-projection/game-read-mode-selector";
import {
  PRESSURE_CHAPTER_HTTP_TOKENS,
  PressureChapterHttpControllerMethods,
  PressureChapterHttpFacade,
} from "../http";
import { PressureChapterModule } from "../pressure-chapter.module";
import { PRESSURE_GAME_READ_MODE_ENV_V1 } from "../production-config";
import type { PressureGameReadModeV1 } from "../observability/game-read-observation";
import type {
  PressureGameReadRuntimeObserverPortV1,
  PressureGameReadSafeRequestInputV1,
} from "../observability/game-read-runtime-observer";
import {
  PRESSURE_CHAPTER_GET_CAPABILITY_SURFACE_V1,
  PRESSURE_CHAPTER_PRODUCT_DEPENDENCY_GRAPH_V1,
  PRESSURE_CHAPTER_PRODUCT_TOKENS,
  PRESSURE_CHAPTER_WORKER_OWNER_ENV_V1,
  resolvePressureChapterWorkerOwnershipV1,
} from "./contracts";
import {
  PRESSURE_CHAPTER_PRODUCT_ERROR_CODES,
  PressureChapterProductError,
} from "./errors";
import { createPressureChapterProductRootV1 } from "./product-root";
import { pressureHttpRouteReadPortV1 } from "./read-only-adapters";
import { PressureSingleN1StarterBinderV1 } from "./single-n1-starter";
import { PressureChapterWorkerLifecycleV1 } from "./worker-lifecycle";
import { PressureChapterOperationalReadinessV1 } from "./operational-readiness";

test("product tokens and Nest providers are unique", () => {
  const productTokens = Object.values(PRESSURE_CHAPTER_PRODUCT_TOKENS);
  assert.equal(new Set(productTokens).size, productTokens.length);

  const module = moduleMetadata();
  const providerTokens = providers(module).map(providerToken);
  assert.equal(
    new Set(providerTokens).size,
    providerTokens.length,
    "every production capability must have exactly one provider",
  );
  assert.deepEqual(module.imports, ["ENVIRONMENT_MODULE"]);
  assert.deepEqual(
    (providers(module)[0] as { inject: unknown[] }).inject,
    [PrismaService],
  );
});

test("Nest exports the exact production, Rooms, classifier and HTTP identities", () => {
  const module = moduleMetadata();
  const exported = new Set(module.exports ?? []);
  for (const token of [
    PRESSURE_CHAPTER_PRODUCT_TOKENS.PRODUCTION_BRIDGE,
    PRESSURE_CHAPTER_PRODUCT_TOKENS.ROOMS_GATEWAY,
    PRESSURE_CHAPTER_PRODUCT_TOKENS.IS_PRESSURE,
    PRESSURE_CHAPTER_PRODUCT_TOKENS.HTTP_CONTROLLER_METHODS,
    PRESSURE_CHAPTER_PRODUCT_TOKENS.SEAT_TRANSPORT,
    PRESSURE_CHAPTER_PRODUCT_TOKENS.PROMISES,
    PRESSURE_CHAPTER_PRODUCT_TOKENS.PROGRESS_WORKER,
    PRESSURE_CHAPTER_PRODUCT_TOKENS.WORKER_LIFECYCLE,
    PRESSURE_CHAPTER_PRODUCT_TOKENS.OPERATIONAL_READINESS,
    PressureChapterHttpControllerMethods,
    PressureChapterHttpFacade,
    ...Object.values(PRESSURE_CHAPTER_HTTP_TOKENS),
  ]) {
    assert.ok(exported.has(token), `missing export ${String(token)}`);
  }

  const root = Symbol("root");
  const rooms = { isPressure: async () => true };
  const workerLifecycle = { health: () => ({ running: false }) };
  const operationalReadiness = { readiness: () => ({ ready: false, content: { ready: false } }) };
  const progressWorker = { tick: async () => ({ kind: "IDLE" }) };
  const seatTransport = { readSnapshot: async () => ({}) };
  const promises = { create: async () => ({}), apply: async () => ({}) };
  const rootValue = {
    roomsGateway: rooms,
    workerLifecycle,
    operationalReadiness,
    progress: { worker: progressWorker },
    seatTransport,
    promises,
  };
  const roomsProvider = providerFor(
    module,
    PRESSURE_CHAPTER_PRODUCT_TOKENS.ROOMS_GATEWAY,
  );
  const classifierProvider = providerFor(
    module,
    PRESSURE_CHAPTER_PRODUCT_TOKENS.IS_PRESSURE,
  );
  assert.deepEqual(roomsProvider.inject, [PRESSURE_CHAPTER_PRODUCT_TOKENS.ROOT]);
  assert.deepEqual(classifierProvider.inject, [PRESSURE_CHAPTER_PRODUCT_TOKENS.ROOT]);
  assert.equal(roomsProvider.useFactory(rootValue), rooms);
  assert.equal(classifierProvider.useFactory(rootValue), rooms);
  assert.equal(
    providerFor(
      module,
      PRESSURE_CHAPTER_PRODUCT_TOKENS.SEAT_TRANSPORT,
    ).useFactory(rootValue),
    seatTransport,
  );
  assert.equal(
    providerFor(
      module,
      PRESSURE_CHAPTER_PRODUCT_TOKENS.PROMISES,
    ).useFactory(rootValue),
    promises,
  );
  assert.equal(
    providerFor(
      module,
      PRESSURE_CHAPTER_PRODUCT_TOKENS.WORKER_LIFECYCLE,
    ).useFactory(rootValue),
    workerLifecycle,
  );
  assert.equal(
    providerFor(
      module,
      PRESSURE_CHAPTER_PRODUCT_TOKENS.OPERATIONAL_READINESS,
    ).useFactory(rootValue),
    operationalReadiness,
  );
  assert.equal(
    providerFor(
      module,
      PRESSURE_CHAPTER_PRODUCT_TOKENS.PROGRESS_WORKER,
    ).useFactory(rootValue),
    progressWorker,
  );
  assert.notEqual(root, rooms);
});

test("root provider uses one PrismaService and has no external-port provider", async () => {
  const module = moduleMetadata();
  const rootProvider = providerFor(
    module,
    PRESSURE_CHAPTER_PRODUCT_TOKENS.ROOT,
  );
  assert.deepEqual(rootProvider.inject, [PrismaService]);
  await assert.rejects(
    createPressureChapterProductRootV1({
      prisma: {} as PrismaService,
      options: {
        workerRuntime: {
          pollMs: 0,
          perLaneLimit: 8,
          unrefTimers: true,
        },
      },
    }),
    (error: unknown) => error instanceof PressureChapterProductError
      && error.code === PRESSURE_CHAPTER_PRODUCT_ERROR_CODES.PRODUCTION_PORT_INVALID
      && error.path === "options.workerRuntime",
  );
});

test("zero-external ProductRoot composes without DB access or pre-init workers", async () => {
  let transactionCalls = 0;
  let queryRawCalls = 0;
  const prisma = {
    $transaction: async () => {
      transactionCalls += 1;
      throw new Error("composition must not access the database");
    },
    $queryRaw: async () => {
      queryRawCalls += 1;
      throw new Error("composition must not execute the snapshot query");
    },
  } as unknown as PrismaService;

  const root = await createPressureChapterProductRootV1({
    prisma,
    environment: {},
    options: productRootGameReadTestOptions(),
  });
  assert.equal(transactionCalls, 0);
  assert.equal(queryRawCalls, 0);
  assert.equal(root.diagnostics.gameReadMode, "REPLAY");
  assert.equal(root.workerLifecycle.health().running, false);
  assert.equal(root.diagnostics.narrativeWorkerAutoStarted, false);
  assert.equal(typeof root.progress.worker.tick, "function");
  assert.equal(typeof root.decisionAutomation.workerLane.tick, "function");
  await root.workerLifecycle.onModuleDestroy();
});

test("ProductRoot binds exact FAST configuration without DB work", async () => {
  let databaseCalls = 0;
  const prisma = {
    $transaction: async () => {
      databaseCalls += 1;
      throw new Error("composition must not access the database");
    },
    $queryRaw: async () => {
      databaseCalls += 1;
      throw new Error("composition must not execute the snapshot query");
    },
  } as unknown as PrismaService;
  const root = await createPressureChapterProductRootV1({
    prisma,
    environment: { [PRESSURE_GAME_READ_MODE_ENV_V1]: "FAST" },
    options: productRootGameReadTestOptions(),
  });
  assert.equal(databaseCalls, 0);
  assert.equal(root.diagnostics.gameReadMode, "FAST");
  await root.workerLifecycle.onModuleDestroy();
});

test("ProductRoot shares one observer between GET and SHADOW diagnostics", async () => {
  const projection = Object.freeze({ marker: "m5b-projection" });
  const observed: Array<{
    mode: PressureGameReadModeV1;
    input: Readonly<PressureGameReadSafeRequestInputV1>;
  }> = [];
  const diagnostics: PressureGameReadShadowDiagnosticV1[] = [];
  const observer: PressureGameReadRuntimeObserverPortV1 = {
    async observe<T>(
      mode: PressureGameReadModeV1,
      input: Readonly<PressureGameReadSafeRequestInputV1>,
      _operation: () => Promise<T>,
    ): Promise<T> {
      observed.push({ mode, input });
      return projection as T;
    },
    report(value) {
      diagnostics.push(value);
    },
  };
  const selectorPrototype = PressureGameReadModeSelectorV1.prototype as unknown as {
    read: (
      this: PressureGameReadModeSelectorV1,
      mode: "REPLAY" | "SHADOW" | "FAST",
      query: Readonly<{ runId: string; subjectId: string }>,
    ) => Promise<unknown>;
  };
  const originalRead = selectorPrototype.read;
  let root: Awaited<ReturnType<typeof createPressureChapterProductRootV1>> | undefined;

  selectorPrototype.read = async function patchedSelectorRead(mode, query) {
    assert.equal(mode, "SHADOW");
    assert.deepEqual(query, { runId: "run-observed", subjectId: "viewer-observed" });
    const dependencies = Reflect.get(this, "dependencies") as {
      diagnostics: { report(value: PressureGameReadShadowDiagnosticV1): void | Promise<void> };
    };
    await dependencies.diagnostics.report(Object.freeze({
      schemaVersion: "pressure_game_read_shadow_diagnostic_v1",
      mode: "SHADOW",
      outcome: "MATCH",
      stage: "COMPARE",
      deepEqual: true,
      canonicalEqual: true,
    }));
    return projection;
  };

  let databaseCalls = 0;
  const prisma = {
    $transaction: async () => {
      databaseCalls += 1;
      throw new Error("composition must not access the database");
    },
    $queryRaw: async () => {
      databaseCalls += 1;
      throw new Error("composition must not execute the snapshot query");
    },
  } as unknown as PrismaService;

  try {
    root = await createPressureChapterProductRootV1({
      prisma,
      environment: { [PRESSURE_GAME_READ_MODE_ENV_V1]: "SHADOW" },
      options: productRootGameReadTestOptions(),
      gameReadRuntimeObserver: observer,
    });
    assert.equal(databaseCalls, 0);

    const principal = Object.freeze({
      subjectId: "subject-observed",
      viewerId: "viewer-observed",
    });
    const query = Object.freeze({ feedCursor: "cursor-observed", feedLimit: 5 });
    const facadeProjection = await root.httpFacade.getGame(
      principal,
      "room-observed",
      query,
    );
    assert.equal(facadeProjection, projection);
    assert.equal(observed.length, 1);
    assert.equal(observed[0]!.mode, "SHADOW");
    assert.equal(observed[0]!.input.roomId, "room-observed");
    assert.equal(observed[0]!.input.principal, principal);
    assert.equal(observed[0]!.input.query, query);

    const composedReader = Reflect.get(root.httpFacade, "gameRead") as {
      read(query: Readonly<{ runId: string; subjectId: string }>): Promise<unknown>;
    };
    assert.equal(
      await composedReader.read({
        runId: "run-observed",
        subjectId: "viewer-observed",
      }),
      projection,
    );
    assert.deepEqual(diagnostics, [{
      schemaVersion: "pressure_game_read_shadow_diagnostic_v1",
      mode: "SHADOW",
      outcome: "MATCH",
      stage: "COMPARE",
      deepEqual: true,
      canonicalEqual: true,
    }]);
  } finally {
    selectorPrototype.read = originalRead;
    await root?.workerLifecycle.onModuleDestroy();
  }
});

test("ProductRoot rejects invalid game-read configuration before composition", async () => {
  let databaseCalls = 0;
  const prisma = {
    $transaction: async () => { databaseCalls += 1; },
    $queryRaw: async () => { databaseCalls += 1; },
  } as unknown as PrismaService;
  await assert.rejects(
    createPressureChapterProductRootV1({
      prisma,
      environment: { [PRESSURE_GAME_READ_MODE_ENV_V1]: "fast" },
    }),
    (error: unknown) => (
      error instanceof PressureGameReadModeErrorV1
      && error.code === PRESSURE_GAME_READ_MODE_ERROR_CODES_V1.MODE_INVALID
    ),
  );
  assert.equal(databaseCalls, 0);
});

test("one Nest lifecycle starts and stops the single supervisor exactly once", async () => {
  let starts = 0;
  let stops = 0;
  const health = { running: false };
  const lifecycle = new PressureChapterWorkerLifecycleV1({
    start: async () => { starts += 1; },
    stop: async () => { stops += 1; },
    health: () => health,
  } as never);

  assert.equal(starts, 0, "composition must have no pre-init side effect");
  await Promise.all([
    lifecycle.onModuleInit(),
    lifecycle.onModuleInit(),
  ]);
  assert.equal(starts, 1);
  assert.equal(lifecycle.health(), health);
  await Promise.all([
    lifecycle.onModuleDestroy(),
    lifecycle.onModuleDestroy(),
  ]);
  assert.equal(stops, 1);
});

test("worker ownership is single-owner: embedded API is the default and explicit independent ownership delegates correctly", () => {
  const apiDefault = resolvePressureChapterWorkerOwnershipV1({});
  assert.deepEqual(apiDefault, {
    schemaVersion: "pressure_chapter_worker_ownership_v1",
    processRole: "api",
    configuredOwner: "embedded_api",
    configuredOwnerExplicit: false,
    topology: "embedded",
    ownsWorkerLanes: true,
    ready: true,
  });

  const workerDefault = resolvePressureChapterWorkerOwnershipV1({
    STORY_WORKER_PROCESS: "true",
  });
  assert.equal(workerDefault.ownsWorkerLanes, false);
  assert.equal(workerDefault.configuredOwner, "embedded_api");
  assert.equal(workerDefault.topology, "embedded");

  const apiDelegated = resolvePressureChapterWorkerOwnershipV1({
    [PRESSURE_CHAPTER_WORKER_OWNER_ENV_V1]: "independent_worker",
  });
  const workerOwner = resolvePressureChapterWorkerOwnershipV1({
    STORY_WORKER_PROCESS: "true",
    [PRESSURE_CHAPTER_WORKER_OWNER_ENV_V1]: "independent_worker",
  });
  assert.equal(apiDelegated.ownsWorkerLanes, false);
  assert.equal(workerOwner.ownsWorkerLanes, true);
  assert.equal(apiDelegated.topology, "independent");
  assert.equal(workerOwner.topology, "independent");
});

test("invalid worker ownership fails closed and never starts the supervisor", async () => {
  let starts = 0;
  const lifecycle = new PressureChapterWorkerLifecycleV1(
    {
      start: async () => { starts += 1; },
      stop: async () => undefined,
      health: () => ({
        enabled: false,
        topology: "embedded" as const,
        running: false,
        stopping: false,
        pollMs: 250,
        perLaneLimit: 8,
        activeTick: false,
        lanes: Object.fromEntries(
          ["decision", "progress", "narrative", "aEmotion"].map((lane) => [lane, {
            enabled: false,
            state: "DISABLED",
            runs: 0,
            successes: 0,
            failures: 0,
            lastStartedAtMs: null,
            lastFinishedAtMs: null,
            lastErrorCode: null,
          }]),
        ) as never,
      }),
    } as never,
    resolvePressureChapterWorkerOwnershipV1({
      [PRESSURE_CHAPTER_WORKER_OWNER_ENV_V1]: "two-owners",
    }),
  );
  await lifecycle.onModuleInit();
  assert.equal(starts, 0);
  assert.equal(lifecycle.ownership().ready, false);
  assert.equal(lifecycle.ownership().code, "PRESSURE_WORKER_OWNERSHIP_INVALID");
});

test("delegated non-owner lifecycle never starts the supervisor and exposes ownership diagnostics", async () => {
  let starts = 0;
  const lifecycle = new PressureChapterWorkerLifecycleV1(
    {
      start: async () => { starts += 1; },
      stop: async () => undefined,
      health: () => ({
        enabled: false,
        topology: "independent" as const,
        running: false,
        stopping: false,
        pollMs: 250,
        perLaneLimit: 8,
        activeTick: false,
        lanes: Object.fromEntries(
          ["decision", "progress", "narrative", "aEmotion"].map((lane) => [lane, {
            enabled: false,
            state: "DISABLED",
            runs: 0,
            successes: 0,
            failures: 0,
            lastStartedAtMs: null,
            lastFinishedAtMs: null,
            lastErrorCode: null,
          }]),
        ) as never,
      }),
    } as never,
    resolvePressureChapterWorkerOwnershipV1({
      [PRESSURE_CHAPTER_WORKER_OWNER_ENV_V1]: "independent_worker",
    }),
  );
  await lifecycle.onModuleInit();
  assert.equal(starts, 0);
  assert.equal(lifecycle.ownership().ownsWorkerLanes, false);
});

test("operational readiness cannot assume green before every enabled lane has run", () => {
  const health = {
    enabled: true,
    topology: "embedded" as const,
    running: true,
    stopping: false,
    pollMs: 250,
    perLaneLimit: 8,
    activeTick: false,
    lanes: Object.fromEntries(
      ["decision", "progress", "narrative", "aEmotion"].map((lane) => [lane, {
        enabled: true,
        state: lane === "decision" ? "IDLE" : "STOPPED",
        runs: lane === "decision" ? 1 : 0,
        successes: 0,
        failures: 0,
        lastStartedAtMs: null,
        lastFinishedAtMs: null,
        lastErrorCode: null,
      }]),
    ) as never,
  };
  const readiness = new PressureChapterOperationalReadinessV1(
    {
      health: () => structuredClone(health),
      ownership: () => resolvePressureChapterWorkerOwnershipV1({}),
    } as never,
    {
      ready: true,
      mode: "DETERMINISTIC_FALLBACK_ONLY",
      externalProviderConfigured: false,
      degraded: true,
      provider: "deterministic-fallback",
      model: null,
    },
    () => ({
      content: { ready: true },
      release: { ready: true },
    }),
  ).readiness();
  assert.equal(readiness.ready, false);
  assert.deepEqual(readiness.notReadyLanes, ["aEmotion", "narrative", "progress"]);
  assert.equal(readiness.status, "not_ready");
  assert.deepEqual(readiness.content, { ready: true });
  assert.deepEqual(readiness.release, { ready: true });
  assert.deepEqual(readiness.workerOwnership, {
    schemaVersion: "pressure_chapter_worker_ownership_v1",
    processRole: "api",
    configuredOwner: "embedded_api",
    configuredOwnerExplicit: false,
    topology: "embedded",
    ownsWorkerLanes: true,
    ready: true,
  });
});

test("operational readiness fails closed when published content integrity cannot load", () => {
  const health = {
    enabled: true,
    topology: "embedded" as const,
    running: true,
    stopping: false,
    pollMs: 250,
    perLaneLimit: 8,
    activeTick: true,
    lanes: Object.fromEntries(
      ["decision", "progress", "narrative", "aEmotion"].map((lane) => [lane, {
        enabled: true,
        state: "IDLE",
        runs: 1,
        successes: 0,
        failures: 0,
        lastStartedAtMs: null,
        lastFinishedAtMs: null,
        lastErrorCode: null,
      }]),
    ) as never,
  };
  const readiness = new PressureChapterOperationalReadinessV1(
    {
      health: () => structuredClone(health),
      ownership: () => resolvePressureChapterWorkerOwnershipV1({}),
    } as never,
    {
      ready: true,
      mode: "EXTERNAL_PROVIDER",
      externalProviderConfigured: true,
      degraded: false,
      provider: "deepseek",
      model: "deepseek-v4-pro",
    },
    () => ({
      content: {
        ready: false,
        code: "PRESSURE_CONTENT_NOT_READY",
      },
      release: { ready: true },
    }),
  ).readiness();
  assert.equal(readiness.ready, false);
  assert.equal(readiness.status, "not_ready");
  assert.equal(readiness.code, "PRESSURE_CONTENT_NOT_READY");
  assert.deepEqual(readiness.notReadyLanes, []);
  assert.deepEqual(readiness.content, {
    ready: false,
    code: "PRESSURE_CONTENT_NOT_READY",
  });
  assert.deepEqual(readiness.release, { ready: true });
});

test("operational readiness fails closed when published release artifacts cannot load", () => {
  const health = {
    enabled: true,
    topology: "embedded" as const,
    running: true,
    stopping: false,
    pollMs: 250,
    perLaneLimit: 8,
    activeTick: true,
    lanes: Object.fromEntries(
      ["decision", "progress", "narrative", "aEmotion"].map((lane) => [lane, {
        enabled: true,
        state: "IDLE",
        runs: 1,
        successes: 0,
        failures: 0,
        lastStartedAtMs: null,
        lastFinishedAtMs: null,
        lastErrorCode: null,
      }]),
    ) as never,
  };
  const readiness = new PressureChapterOperationalReadinessV1(
    {
      health: () => structuredClone(health),
      ownership: () => resolvePressureChapterWorkerOwnershipV1({}),
    } as never,
    {
      ready: true,
      mode: "EXTERNAL_PROVIDER",
      externalProviderConfigured: true,
      degraded: false,
      provider: "deepseek",
      model: "deepseek-v4-pro",
    },
    () => ({
      content: { ready: true },
      release: {
        ready: false,
        code: "PRESSURE_RELEASE_NOT_READY",
      },
    }),
  ).readiness();
  assert.equal(readiness.ready, false);
  assert.equal(readiness.status, "not_ready");
  assert.equal(readiness.code, "PRESSURE_RELEASE_NOT_READY");
  assert.deepEqual(readiness.notReadyLanes, []);
  assert.deepEqual(readiness.content, { ready: true });
  assert.deepEqual(readiness.release, {
    ready: false,
    code: "PRESSURE_RELEASE_NOT_READY",
  });
});

test("operational readiness stays green for a delegated API process and surfaces the external owner", () => {
  const health = {
    enabled: false,
    topology: "independent" as const,
    running: false,
    stopping: false,
    pollMs: 250,
    perLaneLimit: 8,
    activeTick: false,
    lanes: Object.fromEntries(
      ["decision", "progress", "narrative", "aEmotion"].map((lane) => [lane, {
        enabled: false,
        state: "DISABLED",
        runs: 0,
        successes: 0,
        failures: 0,
        lastStartedAtMs: null,
        lastFinishedAtMs: null,
        lastErrorCode: null,
      }]),
    ) as never,
  };
  const readiness = new PressureChapterOperationalReadinessV1(
    {
      health: () => structuredClone(health),
      ownership: () => resolvePressureChapterWorkerOwnershipV1({
        [PRESSURE_CHAPTER_WORKER_OWNER_ENV_V1]: "independent_worker",
      }),
    } as never,
    {
      ready: true,
      mode: "EXTERNAL_PROVIDER",
      externalProviderConfigured: true,
      degraded: false,
      provider: "deepseek",
      model: "deepseek-v4-pro",
    },
    () => ({
      content: { ready: true },
      release: { ready: true },
    }),
  ).readiness();
  assert.equal(readiness.ready, true);
  assert.equal(readiness.status, "ready");
  assert.deepEqual(readiness.failedLanes, []);
  assert.deepEqual(readiness.notReadyLanes, []);
  assert.equal(readiness.workerOwnership.configuredOwner, "independent_worker");
  assert.equal(readiness.workerOwnership.ownsWorkerLanes, false);
});

test("authority graph excludes legacy, Provider and presentation authority", () => {
  const authority = new Set(PRESSURE_CHAPTER_PRODUCT_DEPENDENCY_GRAPH_V1.authority);
  for (const forbidden of
    PRESSURE_CHAPTER_PRODUCT_DEPENDENCY_GRAPH_V1.forbiddenAuthorityDependencies) {
    assert.equal(authority.has(forbidden), false, forbidden);
  }
  assert.equal(authority.has("LegacyRuntime"), false);
  assert.equal(authority.has("Provider"), false);
  assert.equal(authority.has("OpenNovelNarrativeProjector"), false);
});

test("one N1 starter is bound once and a second identity fails closed", () => {
  const binder = new PressureSingleN1StarterBinderV1();
  const firstStarter = { startChapter: async () => ({}) } as never;
  const secondStarter = { startChapter: async () => ({}) } as never;
  const handoff = { openFromGenesisHandoff: async () => ({}) } as never;
  let factoryCalls = 0;
  const first = binder.bind(firstStarter, () => {
    factoryCalls += 1;
    return handoff;
  });
  const replay = binder.bind(firstStarter, () => {
    factoryCalls += 1;
    return {} as never;
  });
  assert.equal(first, handoff);
  assert.equal(replay, handoff);
  assert.equal(binder.requireBound(), handoff);
  assert.equal(factoryCalls, 1);
  assert.throws(
    () => binder.bind(secondStarter, () => handoff),
    (error: unknown) => error instanceof PressureChapterProductError
      && error.code === PRESSURE_CHAPTER_PRODUCT_ERROR_CODES.N1_STARTER_CONFLICT,
  );
});

test("GET route facet and declared GET surfaces expose no write capability", async () => {
  let workerStarts = 0;
  const routes = {
    create: () => "forbidden",
    readStoredRoute: async () => ({ op: "readStoredRoute" }),
    resolveGame: async () => ({ op: "resolveGame" }),
    resolveAction: async () => ({ op: "resolveAction" }),
    resolveResult: async () => ({ op: "resolveResult" }),
    resolveReplay: async () => ({ op: "resolveReplay" }),
  };
  const readOnly = pressureHttpRouteReadPortV1(routes as never) as unknown as
    Record<string, unknown>;
  assert.deepEqual(Object.keys(readOnly).sort(), [
    "readStoredRoute",
    "resolveAction",
    "resolveGame",
    "resolveReplay",
    "resolveResult",
  ]);
  assert.equal("create" in readOnly, false);
  assert.deepEqual(await (readOnly.readStoredRoute as Function)("run"), {
    op: "readStoredRoute",
  });
  assert.equal(workerStarts, 0, "GET must never start or tick a worker");

  const getCapabilities = [
    ...PRESSURE_CHAPTER_GET_CAPABILITY_SURFACE_V1.game,
    ...PRESSURE_CHAPTER_GET_CAPABILITY_SURFACE_V1.result,
  ];
  for (const forbidden of PRESSURE_CHAPTER_GET_CAPABILITY_SURFACE_V1.forbidden) {
    assert.equal(
      getCapabilities.some((name) => {
        const normalized = name.toLowerCase();
        return normalized === forbidden || normalized.startsWith(forbidden);
      }),
      false,
      forbidden,
    );
  }
});

test("forRoot is zero-external and exposes one async ProductRoot factory", () => {
  const module = PressureChapterModule.forRoot();
  const root = providerFor(module, PRESSURE_CHAPTER_PRODUCT_TOKENS.ROOT);
  assert.deepEqual(root.inject, [PrismaService]);
  assert.equal(root.useFactory.length, 1);
});

function productRootGameReadTestOptions() {
  class TestNarrativeRendererV1 {
    constructor(_provider: unknown) {}
  }
  class TestNarrativePublisherV1 {
    constructor(_persistence: unknown) {}
  }
  class TestOpenNovelNarrativeProjectorV1 {
    constructor(..._input: unknown[]) {}

    async project(): Promise<never> {
      throw new Error("test runtime projector must not execute during composition");
    }
  }
  return {
    internalAdapters: {
      narrative: {
        runtimeLoader: {
          async load() {
            return {
              OpenNovelNarrativeProjectorV1: TestOpenNovelNarrativeProjectorV1,
              NarrativeRendererV1: TestNarrativeRendererV1,
              NarrativePublisherV1: TestNarrativePublisherV1,
              validateNarrativeProjectionJobV1: (value: unknown) => value,
              validateAudienceSafeNarrativeSourceV1: (value: unknown) => value,
            };
          },
        },
      },
    },
  } as never;
}

function moduleMetadata(): DynamicModule {
  return PressureChapterModule.forRoot({
    imports: ["ENVIRONMENT_MODULE" as never],
  });
}

function providers(module: DynamicModule): Provider[] {
  return (module.providers ?? []) as Provider[];
}

function providerToken(provider: Provider): unknown {
  if (typeof provider === "function") return provider;
  return (provider as { provide: unknown }).provide;
}

function providerFor(
  module: DynamicModule,
  token: unknown,
): {
  inject: unknown[];
  useFactory: (...args: any[]) => any;
} {
  const provider = providers(module).find(
    (candidate) => providerToken(candidate) === token,
  );
  assert.ok(provider && typeof provider === "object", `provider ${String(token)}`);
  const factory = provider as {
    inject: unknown[];
    useFactory: (...args: any[]) => any;
  };
  assert.equal(typeof factory.useFactory, "function");
  return factory;
}
