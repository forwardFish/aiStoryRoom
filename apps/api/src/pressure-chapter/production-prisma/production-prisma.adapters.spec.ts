import assert from "node:assert/strict";
import test from "node:test";
import {
  PRESSURE_CHAPTER_SEAT_IDS_V1,
  sha256Canonical,
} from "@ai-story/shared";
import type { PrismaService } from "../../prisma.service";
import {
  PressureRunShellService,
  type PressureCanonicalRoleCatalogPort,
  type PressureCanonicalRoleDefinitionV1,
} from "../production/run-shell";
import { buildPressureStartBoundaryRequest } from "../production/start-lifecycle";
import { PRESSURE_TRANSACTION_OPTIONS } from "../persistence/transaction";
import {
  projectGenesisN1HandoffPrismaV1,
  projectPressureProductionPrismaV1,
} from "./factory";
import { PrismaPressureLobbyPersistenceAdapter } from "./lobby.prisma-adapter";
import { PressureProductionPrismaFake } from "./production-prisma.test-harness";
import { PrismaPressureRunShellWriterAdapter } from "./run-shell.prisma-adapter";
import { PrismaPressureStartBoundaryAdapter } from "./start-boundary.prisma-adapter";

const RUN_ID = "pressure-production-prisma-run";
const OWNER = "owner-1";

test("Nest Prisma capability projections expose only their allowed delegates", async () => {
  const fullTransaction = {
    storyRun: Object.freeze({}),
    storyRole: Object.freeze({}),
    storyPlayer: Object.freeze({}),
    pressureRunLifecycle: Object.freeze({}),
    pressureOutboxTask: Object.freeze({}),
    chapterSandbox: Object.freeze({ forbidden: true }),
    sceneNode: Object.freeze({ forbidden: true }),
  };
  const prisma = {
    $transaction: async (operation: (tx: typeof fullTransaction) => unknown) =>
      operation(fullTransaction),
  } as unknown as PrismaService;

  const production = projectPressureProductionPrismaV1(prisma);
  const productionSurface = await production.$transaction(
    async (tx) => ({
      frozen: Object.isFrozen(tx),
      keys: Object.keys(tx).sort(),
      hasLegacyAuthority: "chapterSandbox" in tx || "sceneNode" in tx,
      hasOutbox: "pressureOutboxTask" in tx,
    }),
    PRESSURE_TRANSACTION_OPTIONS,
  );
  assert.deepEqual(productionSurface, {
    frozen: true,
    keys: [
      "pressureRunLifecycle",
      "storyPlayer",
      "storyRole",
      "storyRun",
    ],
    hasLegacyAuthority: false,
    hasOutbox: false,
  });

  const handoff = projectGenesisN1HandoffPrismaV1(prisma);
  const handoffSurface = await handoff.$transaction(
    async (tx) => ({
      frozen: Object.isFrozen(tx),
      keys: Object.keys(tx),
      hasRunShell: "storyRun" in tx || "pressureRunLifecycle" in tx,
      hasLegacyAuthority: "chapterSandbox" in tx || "sceneNode" in tx,
    }),
    PRESSURE_TRANSACTION_OPTIONS,
  );
  assert.deepEqual(handoffSurface, {
    frozen: true,
    keys: ["pressureOutboxTask"],
    hasRunShell: false,
    hasLegacyAuthority: false,
  });
});

test("concurrent createOnce stores one lifecycle receipt, six slots, and no lifecycle metadata in StoryRun.stateJson", async () => {
  const env = createEnvironment();
  const command = lobbyCommand();
  const results = await Promise.all([
    env.shell.createLobbyDraft(command),
    env.shell.createLobbyDraft(command),
  ]);
  assert.deepEqual(
    results.map((result) => result.status).sort(),
    ["CREATED", "EXISTING"],
  );
  assert.equal(env.db.runs.length, 1);
  assert.equal(env.db.roles.length, 6);
  assert.equal(env.db.players.length, 6);
  assert.equal(env.db.lifecycles.length, 1);
  assert.deepEqual(env.db.runs[0]!.stateJson, {});
  assert.equal(env.db.lifecycles[0]!.shellHash, results[0]!.shell.shellHash);
  assert.equal(
    env.db.lifecycles[0]!.schemaVersion,
    "pressure_run_lifecycle_state_v1",
  );
  assert.equal(
    env.db.lifecycles[0]!.stateHash,
    results[0]!.shell.lifecycle.stateHash,
  );

  await assert.rejects(
    env.shell.createLobbyDraft({ ...command, title: "different title" }),
    (error: any) => error?.code === "PRESSURE_PERSISTENCE_FINGERPRINT_MISMATCH",
  );
});

test("concurrent join/select/ready preserves all lifecycle writes and one winner per canonical slot", async () => {
  const env = createEnvironment();
  await env.shell.createLobbyDraft(lobbyCommand());
  const lobby = new PrismaPressureLobbyPersistenceAdapter(env.db.client);
  await Promise.all([
    lobby.join({ runId: RUN_ID, userId: "user-2", idempotencyKey: "join-2" }),
    lobby.join({ runId: RUN_ID, userId: "user-3", idempotencyKey: "join-3" }),
    lobby.join({ runId: RUN_ID, userId: "user-4", idempotencyKey: "join-4" }),
  ]);
  const [ownerSeat, user2Seat] = await Promise.all([
    lobby.claimCanonicalSeatReplacingAi({
      runId: RUN_ID,
      userId: OWNER,
      seatId: PRESSURE_CHAPTER_SEAT_IDS_V1[0],
      humanControllerId: "controller-owner",
      idempotencyKey: "seat-owner",
    }),
    lobby.claimCanonicalSeatReplacingAi({
      runId: RUN_ID,
      userId: "user-2",
      seatId: PRESSURE_CHAPTER_SEAT_IDS_V1[1],
      humanControllerId: "controller-2",
      idempotencyKey: "seat-2",
    }),
  ]);
  assert.equal(ownerSeat.status, "UPDATED");
  assert.equal(user2Seat.status, "UPDATED");

  const contested = await Promise.allSettled([
    lobby.claimCanonicalSeatReplacingAi({
      runId: RUN_ID,
      userId: "user-3",
      seatId: PRESSURE_CHAPTER_SEAT_IDS_V1[2],
      humanControllerId: "controller-3",
      idempotencyKey: "seat-3",
    }),
    lobby.claimCanonicalSeatReplacingAi({
      runId: RUN_ID,
      userId: "user-4",
      seatId: PRESSURE_CHAPTER_SEAT_IDS_V1[2],
      humanControllerId: "controller-4",
      idempotencyKey: "seat-4",
    }),
  ]);
  assert.equal(contested.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(contested.filter((result) => result.status === "rejected").length, 1);

  const current = await lobby.getLobbyStatus({ runId: RUN_ID });
  assert(current);
  const seatedUsers = current.seats.flatMap((seat) =>
    seat.userId ? [seat.userId] : [],
  );
  assert.equal(new Set(seatedUsers).size, 3);
  await Promise.all(
    seatedUsers.map((userId, index) =>
      lobby.setReady({
        runId: RUN_ID,
        userId,
        ready: true,
        idempotencyKey: `ready-${index}`,
      }),
    ),
  );
  const ready = await lobby.getLobbyStatus({ runId: RUN_ID });
  assert(ready);
  assert.equal(ready.members.filter((member) => member.ready).length, 3);
  assert.equal(env.db.players.length, 6, "membership never creates a seventh StoryPlayer");
  for (const seat of ready.seats) {
    assert.equal(seat.roleStatus, "claimed");
    assert.equal(seat.roleIsAiControlled, seat.controllerType === "ai");
  }
  assert.deepEqual(env.db.runs[0]!.stateJson, {});
});

test("room projection statuses batch multiple rooms into one transaction snapshot", async () => {
  const env = createEnvironment();
  await env.shell.createLobbyDraft(lobbyCommand());
  const secondRunId = `${RUN_ID}-second`;
  await env.shell.createLobbyDraft({
    ...lobbyCommand(),
    runId: secondRunId,
    inviteCode: "PRESSURE-PRISMA-2",
    idempotencyKey: "create-pressure-prisma-2",
  });
  let transactions = 0;
  const lobby = new PrismaPressureLobbyPersistenceAdapter({
    $transaction: async (operation, options) => {
      transactions += 1;
      return env.db.client.$transaction(operation, options);
    },
  });

  const statuses = await lobby.getRoomProjectionStatuses([RUN_ID, secondRunId]);

  assert.deepEqual(statuses.map((status) => status.lobby.runId), [RUN_ID, secondRunId]);
  assert.deepEqual(statuses.map((status) => status.start.runId), [RUN_ID, secondRunId]);
  assert.equal(transactions, 1);
});

test("lobby receipts replay exact responses, bind keys to fingerprints, and commit with lifecycle CAS", async () => {
  const env = createEnvironment();
  await env.shell.createLobbyDraft(lobbyCommand());
  const lobby = new PrismaPressureLobbyPersistenceAdapter(env.db.client);
  const command = {
    runId: RUN_ID,
    userId: "user-receipt",
    idempotencyKey: "lobby-receipt-once",
  };
  const beforeVersion = env.db.lifecycles[0]!.version;
  const [first, concurrentReplay] = await Promise.all([
    lobby.join(command),
    lobby.join(command),
  ]);
  assert.deepEqual(concurrentReplay, first);
  assert.equal(first.status, "UPDATED");
  assert.equal(env.db.lifecycles[0]!.version, beforeVersion + 2);
  assert.equal(env.db.lobbyReceipts.length, 1);
  assert.equal(env.db.lobbyReceipts[0]!.operation, "JOIN");
  assert.equal(
    env.db.lobbyReceipts[0]!.resultStateHash,
    env.db.lifecycles[0]!.stateHash,
  );

  await lobby.join({
    runId: RUN_ID,
    userId: "later-user",
    idempotencyKey: "later-join",
  });
  const exactReplay = await lobby.join(command);
  assert.deepEqual(exactReplay, first, "replay returns the committed responseJson");
  assert.equal(
    exactReplay.lobby.members.some((member) => member.userId === "later-user"),
    false,
  );

  const versionBeforeMismatch = env.db.lifecycles[0]!.version;
  await assert.rejects(
    lobby.join({ ...command, userId: "different-user" }),
    (error: any) => error?.code === "PRESSURE_PERSISTENCE_FINGERPRINT_MISMATCH",
  );
  await assert.rejects(
    lobby.setReady({ ...command, ready: true }),
    (error: any) => error?.code === "PRESSURE_PERSISTENCE_FINGERPRINT_MISMATCH",
  );
  assert.equal(env.db.lifecycles[0]!.version, versionBeforeMismatch);
  assert.equal(env.db.lobbyReceipts.length, 2);
});

test("select, ready, and leave each persist one durable lobby receipt", async () => {
  const env = createEnvironment();
  await env.shell.createLobbyDraft(lobbyCommand());
  const lobby = new PrismaPressureLobbyPersistenceAdapter(env.db.client);
  await lobby.claimCanonicalSeatReplacingAi({
    runId: RUN_ID,
    userId: OWNER,
    seatId: PRESSURE_CHAPTER_SEAT_IDS_V1[0],
    humanControllerId: "receipt-controller-owner",
    idempotencyKey: "receipt-select-owner",
  });
  await lobby.setReady({
    runId: RUN_ID,
    userId: OWNER,
    ready: true,
    idempotencyKey: "receipt-ready-owner",
  });
  await lobby.leaveAndRestoreAi({
    runId: RUN_ID,
    userId: OWNER,
    idempotencyKey: "receipt-leave-owner",
  });
  assert.deepEqual(
    env.db.lobbyReceipts.map((receipt) => receipt.operation),
    ["SELECT_ROLE", "SET_READY", "LEAVE"],
  );
  assert.equal(new Set(env.db.lobbyReceipts.map((receipt) => receipt.idempotencyKey)).size, 3);
});

test("concurrent start freezes the owner-requested ready roster once; failure and completion replay idempotently", async () => {
  const env = createEnvironment();
  const assignments = [
    {
      seatId: PRESSURE_CHAPTER_SEAT_IDS_V1[0],
      userId: OWNER,
      humanControllerId: "controller-owner",
    },
    {
      seatId: PRESSURE_CHAPTER_SEAT_IDS_V1[1],
      userId: "user-2",
      humanControllerId: "controller-2",
    },
  ];
  await env.shell.createLobbyDraft({
    ...lobbyCommand(),
    humanAssignments: assignments,
  });
  const lobby = new PrismaPressureLobbyPersistenceAdapter(env.db.client);
  let materialGenerations = 0;
  const boundary = new PrismaPressureStartBoundaryAdapter(env.db.client, () => {
    materialGenerations += 1;
    return {
      idempotencyKey: "server-start-key",
      runSeed: "server-start-seed",
    };
  });
  await Promise.all(assignments.map((assignment, index) =>
    lobby.setReady({
      runId: RUN_ID,
      userId: assignment.userId,
      ready: true,
      idempotencyKey: `ready-start-${index}`,
    })));
  const request = buildPressureStartBoundaryRequest({
    runId: RUN_ID,
    requestedByUserId: OWNER,
    participantMode: "MULTIPLAYER",
    humanAssignments: assignments,
    routeKey: null,
    nowMs: 1_000,
  });
  const freezes = await Promise.all([
    boundary.finalizeHumanSeatSet(request),
    boundary.finalizeHumanSeatSet(request),
  ]);
  assert.deepEqual(
    freezes.map((result) => result.status).sort(),
    ["EXISTING", "FROZEN"],
  );
  const frozen = freezes[0]!.frozen;
  assert.equal(frozen.effectiveStart.idempotencyKey, "server-start-key");
  assert.equal(frozen.effectiveStart.runSeed, "server-start-seed");
  assert.equal(env.db.lifecycles[0]!.startIdempotencyKey, "server-start-key");
  assert.equal(env.db.lifecycles[0]!.startRunSeed, "server-start-seed");
  const laterRequest = buildPressureStartBoundaryRequest({
    runId: RUN_ID,
    requestedByUserId: OWNER,
    participantMode: "MULTIPLAYER",
    humanAssignments: assignments,
    routeKey: null,
    nowMs: 9_000,
  });
  assert.equal(laterRequest.requestFingerprint, request.requestFingerprint);
  const laterFreezeReplay = await boundary.finalizeHumanSeatSet(laterRequest);
  assert.equal(laterFreezeReplay.status, "EXISTING");
  assert.equal(laterFreezeReplay.frozen.freezeHash, frozen.freezeHash);
  assert.equal(materialGenerations, 1);
  await assert.rejects(
    boundary.finalizeHumanSeatSet(
      buildPressureStartBoundaryRequest({
        runId: RUN_ID,
        requestedByUserId: OWNER,
        participantMode: "MULTIPLAYER",
        humanAssignments: assignments,
        routeKey: "different-route",
        nowMs: 10_000,
      }),
    ),
    (error: any) => error?.code === "PRESSURE_PERSISTENCE_FINGERPRINT_MISMATCH",
  );
  assert.equal(materialGenerations, 1);
  await assert.rejects(
    lobby.join({ runId: RUN_ID, userId: "late-user", idempotencyKey: "late" }),
    (error: any) => error?.code === "PRESSURE_AUTHORITY_FENCE_MISMATCH",
  );

  const failureBase = {
    schemaVersion: "pressure_start_failure_v1" as const,
    runId: RUN_ID,
    requestFingerprint: frozen.requestFingerprint,
    failedStage: "FREEZE_ROUTE" as const,
    completedStages: ["HUMAN_SEATS_FROZEN" as const],
    errorCode: "ROUTE_TEMPORARY",
  };
  const failure = { ...failureBase, failureHash: sha256Canonical(failureBase) };
  await boundary.recordFailure(failure);
  await boundary.recordFailure(failure);
  assert.equal((await lobby.getStartStatus(RUN_ID))?.phase, "FAILED");
  assert.equal((await boundary.finalizeHumanSeatSet(laterRequest)).status, "EXISTING");
  assert.equal((await lobby.getStartStatus(RUN_ID))?.phase, "STARTING");

  const completionBase = {
    schemaVersion: "pressure_start_completion_v1" as const,
    runId: RUN_ID,
    requestFingerprint: frozen.requestFingerprint,
    routeHash: digest("route"),
    genesisHash: digest("genesis"),
    seatControlStateHash: digest("seat-control"),
    chapterOrchestratorHash: digest("n1"),
    completedAtMs: 2_000,
  };
  const completion = {
    ...completionBase,
    completionHash: sha256Canonical(completionBase),
  };
  const marked = await Promise.all([
    boundary.markStarted(completion),
    boundary.markStarted(completion),
  ]);
  assert.deepEqual(
    marked.map((result) => result.status).sort(),
    ["EXISTING", "STARTED"],
  );
  const laterCompletionBase = { ...completionBase, completedAtMs: 8_000 };
  const laterCompletion = {
    ...laterCompletionBase,
    completionHash: sha256Canonical(laterCompletionBase),
  };
  assert.notEqual(laterCompletion.completionHash, completion.completionHash);
  const laterCompletionReplay = await boundary.markStarted(laterCompletion);
  assert.equal(laterCompletionReplay.status, "EXISTING");
  assert.equal(
    laterCompletionReplay.completion.completionHash,
    completion.completionHash,
  );
  const status = await lobby.getStartStatus(RUN_ID);
  assert.equal(status?.phase, "STARTED");
  assert.deepEqual(status?.completedStages, [
    "HUMAN_SEATS_FROZEN",
    "ROUTE_FROZEN",
    "GENESIS_COMMITTED",
    "SEAT_CONTROL_INITIALIZED",
    "N1_OPENED",
  ]);
  assert.deepEqual(env.db.runs[0]!.stateJson, {});
});

function createEnvironment() {
  const db = new PressureProductionPrismaFake();
  const writer = new PrismaPressureRunShellWriterAdapter(db.client);
  const shell = new PressureRunShellService(new StaticCatalog(), writer);
  return { db, shell };
}

function lobbyCommand() {
  return {
    runId: RUN_ID,
    templateId: "template-pressure",
    ownerUserId: OWNER,
    title: "Pressure production Prisma",
    inviteCode: "PRESSURE-PRISMA",
    visibility: "link" as const,
    participantMode: "MULTIPLAYER" as const,
    humanAssignments: [],
    idempotencyKey: "create-pressure-prisma",
  };
}

class StaticCatalog implements PressureCanonicalRoleCatalogPort {
  async loadCanonicalRoles(): Promise<readonly PressureCanonicalRoleDefinitionV1[]> {
    return PRESSURE_CHAPTER_SEAT_IDS_V1.map((seatId, index) => ({
      roleKey: seatId,
      roleName: `Role ${index + 1}`,
      identity: `Identity ${seatId}`,
      publicInfo: `Public ${seatId}`,
      personalGoal: `Goal ${seatId}`,
      currentState: `State ${seatId}`,
      abilityText: null,
      arcText: null,
      knownInfo: [`known-${seatId}`],
      cannotDo: [],
      sourceSeatId: `source-${seatId}`,
      initialActorId: `actor-${seatId}`,
      persistentObjectRefs: [],
    }));
  }
}

function digest(label: string): string {
  return sha256Canonical({ label });
}
