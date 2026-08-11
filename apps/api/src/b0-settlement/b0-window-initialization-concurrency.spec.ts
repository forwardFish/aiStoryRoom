import assert from "node:assert/strict";
import test from "node:test";
import { createB0RoomRulesetV1 } from "@ai-story/templates";
import { ManeuverV1Controller } from "../maneuver-v1/maneuver-v1.controller";
import { B0WindowPlayerController } from "./b0-window-player.controller";
import { createB0WindowConfigV1 } from "./b0-window-coordinator.core";
import { B0SettlementPipelineService } from "./b0-settlement-pipeline.service";

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function pipeline() {
  return new B0SettlementPipelineService({} as never, {} as never, {} as never);
}

function authoritativeWindow() {
  return {
    schemaVersion: "b0-settlement-window-v1",
    id: "window.shared",
    roomId: "run.shared",
    runId: "run.shared",
    mode: "WINDOWED",
    ordinal: 1,
    situationId: "situation.shared",
    baseWorldSequence: 0,
    expectedActorIds: ["role.a", "role.b", "role.c"],
    readyActorIds: [],
    openedAt: "2026-08-11T00:00:00.000Z",
    locksAt: "2026-08-11T00:05:00.000Z",
    lockedAt: null,
    committedAt: null,
    completedAt: null,
    status: "OPEN",
    lockReason: null,
    rulesetVersion: "b0-rules-v1",
    schemaRevision: 1,
  } as const;
}

test("three isolated sessions and maneuver reads wait for one run initialization owner", async () => {
  const service = pipeline();
  const started = deferred();
  const release = deferred();
  const window = authoritativeWindow();
  let ownerCalls = 0;
  let b0ProjectionCalls = 0;
  let maneuverProjectionCalls = 0;

  (service as any).ensureRunWindowOwned = async (runId: string) => {
    assert.equal(runId, "run.shared");
    ownerCalls += 1;
    started.resolve();
    await release.promise;
    return window;
  };

  const b0Controller = new B0WindowPlayerController({
    projection: async () => {
      b0ProjectionCalls += 1;
      return { source: "b0" };
    },
  } as never, service);
  const maneuverController = new ManeuverV1Controller({
    projection: async () => {
      maneuverProjectionCalls += 1;
      return { source: "maneuver" };
    },
  } as never, service);
  const users = [{ id: "user.a" }, { id: "user.b" }, { id: "user.c" }] as any[];

  const requests = [
    ...users.map((user) => b0Controller.projection(user, "run.shared")),
    ...users.map((user) => maneuverController.projection(user, "run.shared")),
  ];

  await started.promise;
  await Promise.resolve();
  assert.equal(ownerCalls, 1, "one API process must execute one lazy initialization write path per run");
  assert.equal(b0ProjectionCalls, 0, "B0 reads must not compete with the initialization owner for pool connections");
  assert.equal(maneuverProjectionCalls, 0, "maneuver reads must not bypass B0 initialization ownership");

  release.resolve();
  const responses = await Promise.all(requests);
  assert.equal(responses.length, 6);
  assert.equal(ownerCalls, 1);
  assert.equal(b0ProjectionCalls, 3);
  assert.equal(maneuverProjectionCalls, 3);
});

test("a failed initialization owner is evicted so the next request can recover", async () => {
  const service = pipeline();
  const window = authoritativeWindow();
  let ownerCalls = 0;

  (service as any).ensureRunWindowOwned = async () => {
    ownerCalls += 1;
    if (ownerCalls === 1) throw new Error("simulated process interruption after a recoverable boundary");
    return window;
  };

  await assert.rejects(() => service.ensureRunWindow("run.shared"), /simulated process interruption/);
  assert.equal(await service.ensureRunWindow("run.shared"), window);
  assert.equal(ownerCalls, 2, "a rejected owner promise must never poison future recovery");
});

test("an existing OPEN window resumes AI preparation once before concurrent waiters are released", async () => {
  const now = new Date("2026-08-11T00:00:00.000Z");
  const ruleset = createB0RoomRulesetV1({
    rulesetVersion: "b0-rules-v1",
    settlementMode: "WINDOWED",
    totalWindows: 6,
    windowDurationSeconds: 300,
    maxHumanPlayers: 3,
  });
  const config = createB0WindowConfigV1({
    situationId: "situation.shared",
    ruleset,
    expectedActorIds: ["role.a", "role.b", "role.c"],
    roleBindings: ["role.a", "role.b", "role.c"].map((actorId) => ({
      actorId,
      roleId: actorId,
      controlEpoch: 1,
      controlMode: "HUMAN_ACTIVE" as const,
    })),
    createdAt: now.toISOString(),
  });
  const dbWindow = {
    id: "window.shared",
    runId: "run.shared",
    nodeId: "node.shared",
    status: "OPEN",
    openingSnapshotVersion: 0,
    projectionVersion: 1,
    version: 1,
    configJson: config,
    mainOpenedAt: now,
    mainClosesAt: new Date(now.getTime() + 300_000),
    graceOpenedAt: null,
    closingReason: null,
    resolvedAt: null,
    createdAt: now,
    node: { nodeIndex: 1 },
    participants: ["role.a", "role.b", "role.c"].map((roleId) => ({ roleId, mainStatus: "B0_PENDING" })),
  };
  const prisma = {
    storyRun: {
      findUnique: async () => ({
        id: "run.shared",
        status: "playing",
        strategyVersion: "b0_windowed_v1",
        stateJson: { b0: { enabled: true } },
        roles: [],
        players: [],
        nodes: [],
      }),
    },
    actionWindow: {
      findMany: async () => [dbWindow],
    },
  };
  const service = new B0SettlementPipelineService(prisma as never, {} as never, {} as never);
  const preparationStarted = deferred();
  const releasePreparation = deferred();
  let preparationOwners = 0;
  (service as any).prepareAiPlansOwned = async () => {
    preparationOwners += 1;
    preparationStarted.resolve();
    await releasePreparation.promise;
  };

  const requests = [1, 2, 3].map(() => service.ensureRunWindow("run.shared"));
  await preparationStarted.promise;
  assert.equal(preparationOwners, 1, "active-window crash recovery must also have one AI preparation owner");
  releasePreparation.resolve();
  const windows = await Promise.all(requests);
  assert.deepEqual(windows.map((entry) => entry?.id), ["window.shared", "window.shared", "window.shared"]);
  assert.equal(preparationOwners, 1);
});

test("three sessions can repeatedly dual-poll against a three-connection pool without fan-out", async () => {
  const service = pipeline();
  const window = authoritativeWindow();
  (service as any).ensureRunWindow = async () => window;

  let activeQueries = 0;
  let maxActiveQueries = 0;
  let completedQueries = 0;
  const query = async (source: string) => {
    activeQueries += 1;
    maxActiveQueries = Math.max(maxActiveQueries, activeQueries);
    assert.ok(activeQueries <= 3, `${source} exceeded the bounded pool capacity`);
    await new Promise((resolve) => setTimeout(resolve, 1));
    completedQueries += 1;
    activeQueries -= 1;
    return { source };
  };

  const b0Controller = new B0WindowPlayerController({
    projection: async () => {
      await query("b0-context");
      await query("b0-window");
      await query("b0-result");
      return { source: "b0" };
    },
  } as never, service);
  const maneuverController = new ManeuverV1Controller({
    projection: async () => {
      await query("maneuver-context");
      await query("maneuver-assets");
      await query("maneuver-result");
      return { source: "maneuver" };
    },
  } as never, service);
  const users = [{ id: "user.a" }, { id: "user.b" }, { id: "user.c" }] as any[];

  for (let round = 0; round < 12; round += 1) {
    const responses = await Promise.all([
      ...users.map((user) => b0Controller.projection(user, "run.shared")),
      ...users.map((user) => maneuverController.projection(user, "run.shared")),
    ]);
    assert.equal(responses.length, 6);
  }

  assert.equal(completedQueries, 12 * 6 * 3);
  assert.ok(maxActiveQueries <= 2, "the request-graph limiter must leave one pool connection free for writes and workers");
  assert.equal(activeQueries, 0, "the limiter must not leak an acquired slot");
});

test("a failed bounded player read releases its slot for later polling", async () => {
  const service = pipeline();
  await assert.rejects(
    () => service.withBoundedPlayerRead("failed-read", async () => {
      throw new Error("simulated read failure");
    }),
    /simulated read failure/,
  );
  assert.equal(await service.withBoundedPlayerRead("recovered-read", async () => "recovered"), "recovered");
});

test("overlapping poll requests for the same player and endpoint share one read flight", async () => {
  const service = pipeline();
  const started = deferred();
  const release = deferred();
  let calls = 0;

  const requests = Array.from({ length: 8 }, () => service.withBoundedPlayerRead("b0-window:run.shared:user.a", async () => {
    calls += 1;
    started.resolve();
    await release.promise;
    return { status: "ok" };
  }));

  await started.promise;
  await Promise.resolve();
  assert.equal(calls, 1, "overlapping poll retries must not multiply the database read graph");
  release.resolve();
  const responses = await Promise.all(requests);
  assert.equal(responses.length, 8);
  assert.ok(responses.every((response) => response.status === "ok"));
});
