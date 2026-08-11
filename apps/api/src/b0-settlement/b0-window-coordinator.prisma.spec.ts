import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@prisma/client";
import { createB0RoomRulesetV1 } from "@ai-story/templates";
import { createB0WindowConfigV1 } from "./b0-window-coordinator.core";
import { B0WindowCoordinatorService } from "./b0-window-coordinator.prisma";

type TransactionOptions = {
  isolationLevel?: Prisma.TransactionIsolationLevel;
  maxWait?: number;
  timeout?: number;
};

type CoordinatorInternals = {
  serializable<T>(operation: (tx: any) => Promise<T>): Promise<T>;
};

function internals(service: B0WindowCoordinatorService): CoordinatorInternals {
  return service as unknown as CoordinatorInternals;
}

function admissionTimeout(): Error & { code: string } {
  return Object.assign(
    new Error("Transaction API error: Unable to start a transaction in the given time."),
    { code: "P2028" },
  );
}

function windowRow(version = 1, projectionVersion = 1) {
  const openedAt = new Date("2026-08-11T00:00:00.000Z");
  return {
    id: "window.remote.pool",
    runId: "run.remote.pool",
    nodeId: "node.remote.pool",
    status: "OPEN",
    mainOpenedAt: openedAt,
    mainClosesAt: new Date(openedAt.getTime() + 300_000),
    graceOpenedAt: null,
    resolvedAt: null,
    closingReason: null,
    openingSnapshotVersion: 0,
    projectionVersion,
    version,
    createdAt: openedAt,
    configJson: createB0WindowConfigV1({
      situationId: "situation.remote.pool",
      ruleset: createB0RoomRulesetV1({
        rulesetVersion: "b0-rules-v1",
        settlementMode: "WINDOWED",
        totalWindows: 6,
        windowDurationSeconds: 300,
        maxHumanPlayers: 3,
      }),
      expectedActorIds: ["actor.a"],
      roleBindings: [{ actorId: "actor.a", roleId: "actor.a", controlEpoch: 1, controlMode: "HUMAN_ACTIVE" }],
      createdAt: openedAt.toISOString(),
    }),
    participants: [{ roleId: "actor.a", mainStatus: "B0_PENDING", version: 1 }],
    node: { nodeIndex: 1 },
    resolutionWorkflow: null,
  };
}

test("projection uses optimistic ordinary reads and never opens an interactive transaction", async () => {
  const row = windowRow();
  let windowReads = 0;
  let playerReads = 0;
  let transactions = 0;
  const service = new B0WindowCoordinatorService({
    actionWindow: {
      findUnique: async (args: any) => {
        windowReads += 1;
        return args.select ? { version: row.version, projectionVersion: row.projectionVersion } : row;
      },
    },
    playerAction: {
      findUnique: async () => {
        playerReads += 1;
        return null;
      },
    },
    $transaction: async () => {
      transactions += 1;
      throw new Error("read projection must not reserve an interactive transaction connection");
    },
  } as never);

  const projection = await service.projection(row.id, "actor.a");
  assert.equal(projection.window.id, row.id);
  assert.equal(windowReads, 2);
  assert.equal(playerReads, 1);
  assert.equal(transactions, 0);
});

test("projection retries a changed optimistic snapshot without duplicating writes", async () => {
  const first = windowRow(1, 1);
  const second = windowRow(2, 2);
  let fullReads = 0;
  let versionReads = 0;
  let playerReads = 0;
  const service = new B0WindowCoordinatorService({
    actionWindow: {
      findUnique: async (args: any) => {
        if (args.select) {
          versionReads += 1;
          return versionReads === 1
            ? { version: second.version, projectionVersion: second.projectionVersion }
            : { version: second.version, projectionVersion: second.projectionVersion };
        }
        fullReads += 1;
        return fullReads === 1 ? first : second;
      },
    },
    playerAction: {
      findUnique: async () => {
        playerReads += 1;
        return null;
      },
    },
  } as never);

  const projection = await service.projection(first.id, "actor.a");
  assert.equal(projection.window.id, first.id);
  assert.equal(fullReads, 2, "a changed projection version should retry the ordinary read snapshot");
  assert.equal(versionReads, 2);
  assert.equal(playerReads, 2);
});

test("write transactions do not retry P2028 after their callback may have run", async () => {
  let transactionAttempts = 0;
  let callbackCalls = 0;
  let observedOptions: TransactionOptions | undefined;
  const service = new B0WindowCoordinatorService({
    $transaction: async (operation: (tx: any) => Promise<unknown>, options: TransactionOptions) => {
      transactionAttempts += 1;
      observedOptions = options;
      await operation({});
      throw admissionTimeout();
    },
  } as never);

  await assert.rejects(
    () => internals(service).serializable(async () => {
      callbackCalls += 1;
      return "write-result";
    }),
    /Unable to start a transaction/,
  );
  assert.equal(transactionAttempts, 1, "ambiguous write-transaction failures must not be retried");
  assert.equal(callbackCalls, 1, "the write callback must not be invoked twice");
  assert.deepEqual(observedOptions, {
    isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    maxWait: 10_000,
    timeout: 30_000,
  });
});



test("deadline recovery reports the exact window when a background sweep already completed it", async () => {
  const now = new Date("2026-08-11T12:00:00.000Z");
  const row = windowRow();
  let freezeCalls = 0;
  let observedQuery: any;
  const service = new B0WindowCoordinatorService({
    actionWindow: {
      findMany: async (args: any) => {
        observedQuery = args;
        return [
{
  id: row.id,
  status: "COMPLETED",
  closingReason: "DEADLINE",
  mainClosesAt: new Date(now.getTime() - 1_000),
  configJson: row.configJson,
},
{
  id: "window.legacy",
  status: "COMPLETED",
  closingReason: "DEADLINE",
  mainClosesAt: new Date(now.getTime() - 1_000),
  configJson: { schemaVersion: "legacy-window-v1" },
},
        ];
      },
    },
  } as never);
  (service as any).freezeDeadline = async () => {
    freezeCalls += 1;
    throw new Error("completed deadline rows must not be frozen twice");
  };

  const recovered = await service.recoverExpired(now);

  assert.deepEqual(recovered, [{ windowId: row.id, status: "ALREADY_FROZEN" }]);
  assert.equal(freezeCalls, 0);
  assert.equal(observedQuery.where.mainClosesAt.lte, now);
  assert.equal(observedQuery.where.OR.length, 3);
});

test("deadline recovery reconciles an OPEN scan lost to a concurrent recovery owner", async () => {
  const now = new Date("2026-08-11T12:00:00.000Z");
  const row = windowRow();
  const service = new B0WindowCoordinatorService({
    actionWindow: {
      findMany: async () => [{
        id: row.id,
        status: "OPEN",
        closingReason: null,
        mainClosesAt: new Date(now.getTime() - 1_000),
        configJson: row.configJson,
      }],
      findUnique: async () => ({
        status: "SETTLING",
        closingReason: "DEADLINE",
        mainClosesAt: new Date(now.getTime() - 1_000),
        configJson: row.configJson,
      }),
    },
  } as never);
  (service as any).freezeDeadline = async () => {
    throw new Error("WINDOW_ALREADY_LOCKED");
  };

  const recovered = await service.recoverExpired(now);

  assert.deepEqual(recovered, [{ windowId: row.id, status: "ALREADY_FROZEN" }]);
});

test("deadline recovery still freezes an expired OPEN B0 window exactly once", async () => {
  const now = new Date("2026-08-11T12:00:00.000Z");
  const row = windowRow();
  const calls: Array<{ windowId: string; now: Date }> = [];
  const service = new B0WindowCoordinatorService({
    actionWindow: {
      findMany: async () => [{
        id: row.id,
        status: "OPEN",
        closingReason: null,
        mainClosesAt: new Date(now.getTime() - 1_000),
        configJson: row.configJson,
      }],
    },
  } as never);
  (service as any).freezeDeadline = async (windowId: string, observedNow: Date) => {
    calls.push({ windowId, now: observedNow });
    return { status: "FROZEN", envelope: null };
  };

  const recovered = await service.recoverExpired(now);

  assert.deepEqual(recovered, [{ windowId: row.id, status: "FROZEN" }]);
  assert.deepEqual(calls, [{ windowId: row.id, now }]);
});
