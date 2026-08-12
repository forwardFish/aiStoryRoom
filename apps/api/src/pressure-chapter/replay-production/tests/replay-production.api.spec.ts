import assert from "node:assert/strict";
import test from "node:test";
import {
  computePressureReplayRequestFingerprint,
  sha256Canonical,
  type ParticipantModeV1,
  type PressureReplayActionV1,
  type PressureReplayCommandV1,
  type SeatIdV1,
} from "@ai-story/shared";
import { loadPublishedSangtianActionReleaseV1 } from "@ai-story/templates";
import { createPublishedSangtianRouteRegistryPortV1 } from "../../integration";
import {
  PrismaReplayCreationTransaction,
  PRESSURE_TRANSACTION_OPTIONS,
  pressureSerializableTransaction,
  type ReplayReceiptTransactionV1,
} from "../../persistence";
import {
  PressureRunShellService,
  SangtianPressureCanonicalRoleCatalogAdapter,
} from "../../production/run-shell";
import { buildPressureStartBoundaryRequest } from "../../production/start-lifecycle";
import { PressureProductionPrismaFake } from "../../production-prisma/production-prisma.test-harness";
import { PrismaPressureRunShellWriterAdapter } from "../../production-prisma/run-shell.prisma-adapter";
import { PrismaPressureStartBoundaryAdapter } from "../../production-prisma/start-boundary.prisma-adapter";
import { readPressureProductionSnapshot } from "../../production-prisma/production-store";
import {
  PressureChapterRunRouterService,
  type RunRouteRepositoryPort,
  type StoredRunRouteRecordV1,
} from "../../run-router";
import type { ReplayCreationRequestV1 } from "../../replay";
import { PrismaPressureReplayNewTargetFactoryV1 } from "../new-target.factory";
import { SangtianPressureReplayPolicyV1 } from "../replay-policy";
import { AuthoritativePressureReplayTargetRouteResolverV1 } from "../route-target.resolver";

const VIEWER_ID = "viewer-cabinet";
const SOURCE_SEAT: SeatIdV1 = "cabinet_finance";

test("Pressure replay policy issues stable SAME/LATEST/CHANGE_ROLE/BACK actions for Solo and Multiplayer", async () => {
  const policy = new SangtianPressureReplayPolicyV1();
  for (const mode of ["SOLO", "MULTIPLAYER"] as const) {
    const source = policySource(mode);
    const first = await policy.listActions(source, viewerContext(source.runId));
    const second = await policy.listActions(source, viewerContext(source.runId));
    assert.deepEqual(second, first);
    assert.deepEqual(first.map((action) => action.type), [
      "RESTART_SAME_EXPERIENCE",
      "START_LATEST_EXPERIENCE",
      "CHANGE_ROLE",
      "BACK_TO_WORLDS",
    ]);
    assert.deepEqual(first.map((action) => action.launchKind), [
      mode === "SOLO" ? "CREATE_RUN" : "CREATE_LOBBY",
      mode === "SOLO" ? "CREATE_RUN" : "CREATE_LOBBY",
      mode === "SOLO" ? "CREATE_RUN" : "CREATE_LOBBY",
      "NAVIGATE",
    ]);
    assert.equal(new Set(first.map((action) => action.actionFingerprint)).size, 4);
  }

  const noRoleSource = policySource("SOLO");
  const noRole = await policy.listActions(noRoleSource, {
    ...viewerContext(noRoleSource.runId),
    allowedReplayRoleIds: [],
  });
  assert.equal(noRole[2]?.enabled, false);
  assert.equal(noRole[2]?.disabledReason, "NO_AVAILABLE_ROLE");
});

test("Solo replay atomically creates one human plus five AI, persists intent, and never writes source", async () => {
  const env = await targetEnvironment("SOLO");
  const sourceBefore = await snapshot(env.db, env.sourceRunId);
  const action = (await actions("SOLO"))[0]!;
  const request = requestFixture(env.sourceRunId, action, env.sameTarget);
  const factory = new PrismaPressureReplayNewTargetFactoryV1({
    identities: deterministicIdentities(),
  });
  const creator = new PrismaReplayCreationTransaction(env.client, factory);

  const first = await creator.createOnce(request);
  const second = await creator.createOnce(request);
  assert.deepEqual(second, first);
  assert.equal(first.createdRunId, "server-run-1");
  assert.equal(first.frozenTargetRouteHash, env.sameTarget.targetDescriptorHash);
  assert.equal(env.receipts.length, 1);

  const created = await snapshot(env.db, first.createdRunId!);
  assert.equal(created.run.activeHumanCount, 1);
  assert.equal(created.run.aiPlayerCount, 5);
  assert.equal(created.lifecycle.state.lobby.readyUserIds.length, 1);
  assert.equal(
    created.lifecycle.state.lobby.replayTargetIntent?.targetDescriptorHash,
    env.sameTarget.targetDescriptorHash,
  );
  assert.deepEqual(await snapshot(env.db, env.sourceRunId), sourceBefore);

  const selected = created.lifecycle.state.lobby.selectedSeats[0]!;
  const boundary = new PrismaPressureStartBoundaryAdapter(
    env.db.client,
    () => ({ idempotencyKey: "server-start-key", runSeed: "server-run-seed" }),
  );
  await assert.rejects(boundary.finalizeHumanSeatSet(
    buildPressureStartBoundaryRequest({
      runId: created.run.id,
      requestedByUserId: VIEWER_ID,
      participantMode: "SOLO",
      humanAssignments: [selected],
      routeKey: "client-tampered-route",
      nowMs: 100,
    }),
  ));
  assert.equal(
    (await snapshot(env.db, created.run.id)).lifecycle.state.start.phase,
    "NOT_STARTED",
  );
  const frozen = await boundary.finalizeHumanSeatSet(
    buildPressureStartBoundaryRequest({
      runId: created.run.id,
      requestedByUserId: VIEWER_ID,
      participantMode: "SOLO",
      humanAssignments: [selected],
      routeKey: null,
      nowMs: 101,
    }),
  );
  assert.equal(
    frozen.frozen.replayTargetIntent?.targetDescriptorHash,
    env.sameTarget.targetDescriptorHash,
  );

  await assert.rejects(
    creator.createOnce({
      ...request,
      requestFingerprint: sha256Canonical("different-request"),
    }),
    (error: unknown) => (
      error instanceof Error &&
      "code" in error &&
      error.code === "PRESSURE_PERSISTENCE_FINGERPRINT_MISMATCH"
    ),
  );
  assert.equal(env.db.runs.length, 2);
});

test("Multiplayer replay creates only a fresh reconfirmation Lobby; CHANGE_ROLE preselects only requester", async () => {
  const ordinary = await targetEnvironment("MULTIPLAYER");
  const same = (await actions("MULTIPLAYER"))[0]!;
  const ordinaryCreator = new PrismaReplayCreationTransaction(
    ordinary.client,
    new PrismaPressureReplayNewTargetFactoryV1({
      identities: deterministicIdentities(),
    }),
  );
  const receipt = await ordinaryCreator.createOnce(
    requestFixture(ordinary.sourceRunId, same, ordinary.sameTarget),
  );
  const lobby = await snapshot(ordinary.db, receipt.createdLobbyId!);
  assert.deepEqual(lobby.lifecycle.state.lobby.joinedUserIds, [VIEWER_ID]);
  assert.deepEqual(lobby.lifecycle.state.lobby.selectedSeats, []);
  assert.deepEqual(lobby.lifecycle.state.lobby.readyUserIds, []);
  assert.equal(lobby.lifecycle.state.start.phase, "NOT_STARTED");
  assert.equal(lobby.lifecycle.state.routeFreeze, "UNFROZEN");
  assert.equal(lobby.run.activeHumanCount, 0);
  assert.equal(lobby.run.aiPlayerCount, 6);

  const changed = await targetEnvironment("MULTIPLAYER");
  const changeAction = (await actions("MULTIPLAYER"))[2]!;
  const changeCreator = new PrismaReplayCreationTransaction(
    changed.client,
    new PrismaPressureReplayNewTargetFactoryV1({
      identities: deterministicIdentities(),
    }),
  );
  const changeReceipt = await changeCreator.createOnce(requestFixture(
    changed.sourceRunId,
    changeAction,
    changed.sameTarget,
    "jiangnan_merchant",
  ));
  const changedLobby = await snapshot(changed.db, changeReceipt.createdLobbyId!);
  assert.deepEqual(changedLobby.lifecycle.state.lobby.selectedSeats.map((seat) => ({
    userId: seat.userId,
    seatId: seat.seatId,
  })), [{ userId: VIEWER_ID, seatId: "jiangnan_merchant" }]);
  assert.deepEqual(changedLobby.lifecycle.state.lobby.readyUserIds, []);
  assert.equal(changedLobby.run.activeHumanCount, 1);
  assert.equal(changedLobby.run.aiPlayerCount, 5);
  assert.equal(
    changedLobby.lifecycle.state.lobby.joinedUserIds.includes("viewer-merchant"),
    false,
  );
});

test("receipt failure rolls back the target shell, and a retry creates exactly one target", async () => {
  const env = await targetEnvironment("SOLO", true);
  const request = requestFixture(
    env.sourceRunId,
    (await actions("SOLO"))[0]!,
    env.sameTarget,
  );
  const creator = new PrismaReplayCreationTransaction(
    env.client,
    new PrismaPressureReplayNewTargetFactoryV1({
      identities: deterministicIdentities(),
    }),
  );
  await assert.rejects(creator.createOnce(request), /injected receipt failure/);
  assert.equal(env.db.runs.length, 1, "failed receipt must roll back target shell");
  assert.equal(env.receipts.length, 0);

  const retried = await creator.createOnce(request);
  assert.equal(retried.createdRunId, "server-run-2");
  assert.equal(env.db.runs.length, 2);
  assert.equal(env.receipts.length, 1);
});

test("SAME/LATEST descriptors are server-resolved and Router rejects registry or pin drift", async () => {
  const release = loadPublishedSangtianActionReleaseV1();
  const registry = createPublishedSangtianRouteRegistryPortV1(
    release.routeConfiguration,
  );
  const repository = new MemoryRouteRepository();
  const router = new PressureChapterRunRouterService(repository, registry);
  const source = (await router.create({
    runId: "source-route-run",
    participantMode: "SOLO",
    humanSeatIdsAtStart: [SOURCE_SEAT],
    runSeed: "source-seed",
  })).route;
  const resolver = new AuthoritativePressureReplayTargetRouteResolverV1(
    repository,
    registry,
  );
  const same = await resolver.resolveSamePressureRoute(
    source.runId,
    "SOLO",
    source.snapshot.routeHash,
  );
  const latest = await resolver.resolveLatestPressureRoute(source.runId, "SOLO");
  assert.ok(same);
  assert.ok(latest);
  assert.equal(same.targetExperience, "SAME_FROZEN_ROUTE");
  assert.equal(latest.targetExperience, "LATEST_REGISTERED_ROUTE");

  const created = await router.create({
    runId: "replay-route-run",
    participantMode: "SOLO",
    humanSeatIdsAtStart: [SOURCE_SEAT],
    runSeed: "new-server-seed",
    routeKey: same.pinnedRegistration.registration.routeKey,
    pinnedRegistration: same.pinnedRegistration,
  });
  assert.notEqual(created.route.snapshot.routeHash, same.targetDescriptorHash);

  await assert.rejects(router.create({
    runId: "tampered-route-run",
    participantMode: "SOLO",
    humanSeatIdsAtStart: [SOURCE_SEAT],
    runSeed: "new-server-seed-2",
    pinnedRegistration: {
      ...same.pinnedRegistration,
      registryHash: sha256Canonical("tampered-registry"),
    },
  }));
});

async function targetEnvironment(
  mode: ParticipantModeV1,
  failFirstReceipt = false,
) {
  const db = new PressureProductionPrismaFake();
  const shell = new PressureRunShellService(
    new SangtianPressureCanonicalRoleCatalogAdapter(),
    new PrismaPressureRunShellWriterAdapter(db.client),
  );
  const sourceRunId = `source-${mode.toLowerCase()}`;
  await shell.create({
    runId: sourceRunId,
    templateId: "sangtian-template",
    ownerUserId: VIEWER_ID,
    title: "桑田诏",
    inviteCode: `source-${mode.toLowerCase()}-invite`,
    visibility: "link",
    participantMode: mode,
    humanAssignments: mode === "SOLO"
      ? [assignment(SOURCE_SEAT, VIEWER_ID)]
      : [
          assignment(SOURCE_SEAT, VIEWER_ID),
          assignment("jiangnan_merchant", "viewer-merchant"),
        ],
    idempotencyKey: `source-${mode.toLowerCase()}-create`,
  });

  const release = loadPublishedSangtianActionReleaseV1();
  const registry = createPublishedSangtianRouteRegistryPortV1(
    release.routeConfiguration,
  );
  const repository = new MemoryRouteRepository();
  const router = new PressureChapterRunRouterService(repository, registry);
  const route = (await router.create({
    runId: sourceRunId,
    participantMode: mode,
    humanSeatIdsAtStart: mode === "SOLO"
      ? [SOURCE_SEAT]
      : [SOURCE_SEAT, "jiangnan_merchant"],
    runSeed: `seed-${sourceRunId}`,
  })).route;
  const resolver = new AuthoritativePressureReplayTargetRouteResolverV1(
    repository,
    registry,
  );
  const sameTarget = await resolver.resolveSamePressureRoute(
    sourceRunId,
    mode,
    route.snapshot.routeHash,
  );
  assert.ok(sameTarget);
  const combined = replayClient(db, failFirstReceipt);
  return { db, sourceRunId, sameTarget, ...combined };
}

function replayClient(db: PressureProductionPrismaFake, failFirstReceipt: boolean) {
  const receipts: Array<Record<string, unknown>> = [];
  let fail = failFirstReceipt;
  const client = {
    $transaction: async <T>(
      operation: (tx: ReplayReceiptTransactionV1) => Promise<T>,
      _options: typeof PRESSURE_TRANSACTION_OPTIONS,
    ): Promise<T> => db.client.$transaction(async (productionTx) => {
        const before = structuredClone(receipts);
        const receiptDelegate = {
          findUnique: async ({ where }: any) => {
            const key = where.sourceRunId_idempotencyKey;
            return structuredClone(receipts.find((row) => (
              row.sourceRunId === key.sourceRunId &&
              row.idempotencyKey === key.idempotencyKey
            )) ?? null);
          },
          create: async ({ data }: any) => {
            if (fail) {
              fail = false;
              throw new Error("injected receipt failure");
            }
            if (receipts.some((row) => (
              row.sourceRunId === data.sourceRunId &&
              row.idempotencyKey === data.idempotencyKey
            ))) throw Object.assign(new Error("unique"), { code: "P2002" });
            receipts.push(structuredClone(data));
            return structuredClone(data);
          },
        };
        try {
          return await operation(Object.assign(productionTx, {
            pressureReplayCommandReceipt: receiptDelegate,
          }) as ReplayReceiptTransactionV1);
        } catch (error) {
          receipts.splice(0, receipts.length, ...before);
          throw error;
        }
      }, PRESSURE_TRANSACTION_OPTIONS),
  };
  return { client, receipts };
}

async function snapshot(db: PressureProductionPrismaFake, runId: string) {
  return pressureSerializableTransaction(db.client, async (tx) => {
    const value = await readPressureProductionSnapshot(tx, runId);
    assert.ok(value);
    return value;
  });
}

async function actions(mode: ParticipantModeV1) {
  return new SangtianPressureReplayPolicyV1().listActions(
    policySource(mode),
    viewerContext(`source-${mode.toLowerCase()}`),
  );
}

function policySource(mode: ParticipantModeV1) {
  const release = loadPublishedSangtianActionReleaseV1();
  return {
    runId: `source-${mode.toLowerCase()}`,
    worldId: "sangtian" as const,
    participantMode: mode,
    frozenRoute: structuredClone(release.routeRegistration.route),
    frozenRouteHash: sha256Canonical(`source-${mode}-route`),
    resultContractRegistryVersion:
      release.routeRegistration.resultContractRegistryVersion,
  };
}

function viewerContext(runId = "source-solo") {
  return {
    runId,
    viewerId: VIEWER_ID,
    seatId: SOURCE_SEAT,
    authorizedImpactIds: [] as string[],
    authorizedRevealIds: [] as string[],
    allowedReplayRoleIds: ["jiangnan_merchant"] as SeatIdV1[],
  };
}

function requestFixture(
  sourceRunId: string,
  action: PressureReplayActionV1,
  target: NonNullable<Awaited<ReturnType<
    AuthoritativePressureReplayTargetRouteResolverV1["resolveSamePressureRoute"]
  >>>,
  requestedRoleId: SeatIdV1 | null = null,
): ReplayCreationRequestV1 {
  const withoutFingerprint: Omit<PressureReplayCommandV1, "requestFingerprint"> = {
    schemaVersion: "pressure_replay_command_v1",
    sourceRunId,
    actionId: action.actionId,
    actionFingerprint: action.actionFingerprint,
    requestedRoleId,
    idempotencyKey: `replay-${action.actionId}`,
  };
  return {
    sourceRunId,
    viewerId: VIEWER_ID,
    idempotencyKey: withoutFingerprint.idempotencyKey,
    requestFingerprint: computePressureReplayRequestFingerprint(withoutFingerprint),
    action,
    requestedRoleId,
    participantMode: action.targetParticipantMode!,
    target,
  };
}

function assignment(seatId: SeatIdV1, userId: string) {
  return {
    seatId,
    userId,
    humanControllerId: `controller-${userId}`,
  };
}

function deterministicIdentities() {
  let target = 0;
  let invite = 0;
  return {
    nextTargetRunId(kind: "RUN" | "LOBBY") {
      target += 1;
      return `server-${kind.toLowerCase()}-${target}`;
    },
    nextInviteCode() {
      invite += 1;
      return `server-invite-${invite}`;
    },
    nextHumanControllerId(runId: string, userId: string) {
      return `server-controller-${sha256Canonical({ runId, userId }).slice(0, 16)}`;
    },
  };
}

class MemoryRouteRepository implements RunRouteRepositoryPort {
  private readonly records = new Map<string, StoredRunRouteRecordV1>();

  async findByRunId(runId: string) {
    return structuredClone(this.records.get(runId) ?? null);
  }

  async insertIfAbsent(record: StoredRunRouteRecordV1) {
    const existing = this.records.get(record.runId);
    if (existing) return { status: "EXISTING" as const, record: structuredClone(existing) };
    this.records.set(record.runId, structuredClone(record));
    return { status: "INSERTED" as const, record: structuredClone(record) };
  }
}
