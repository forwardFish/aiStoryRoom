import assert from "node:assert/strict";
import test from "node:test";
import {
  computePressureReplayActionFingerprint,
  computePressureReplayRequestFingerprint,
  sha256Canonical,
  validateReplayCreationReceiptV1,
  type ParticipantModeV1,
  type PressureReplayCommandV1,
  type ReplayCreationReceiptV1,
} from "@ai-story/shared";
import { loadPublishedSangtianActionReleaseV1 } from "@ai-story/templates";
import { createPublishedSangtianRouteRegistryPortV1 } from "../integration";
import { PressureResultReadError } from "../result/errors";
import type {
  AuthoritativeResultReaderPort,
  PressureReplayPolicyPort,
  ResultViewerAuthorizerPort,
} from "../result/ports";
import {
  pressureResultSourceFixture,
  replayActionsFixture,
  replayCommandFixture,
  viewerFixture,
} from "../result/result-test-fixtures";
import { PressureReplayCommandHandlerV1 } from "./replay-command.handler";
import type {
  ReplayCreationRequestV1,
  ReplayCreationTransactionPort,
  ReplayExecutionReaderPort,
  StoredReplayExecutionV1,
} from "./ports";
import { validateReplayResolvedTargetV1 } from "./ports";
import { PressureReplayPolicyEvaluatorV1 } from "./replay-policy";
import { buildPressurePinnedRouteRegistrationV1 } from "../run-router";

function harness(participantMode: ParticipantModeV1 = "SOLO") {
  const source = pressureResultSourceFixture(participantMode);
  const initialSource = structuredClone(source);
  const actions = replayActionsFixture(participantMode);
  const executions = new Map<string, StoredReplayExecutionV1>();
  const counters = {
    resultReads: 0,
    authorizeReads: 0,
    policyReads: 0,
    executionReads: 0,
    sameRouteReads: 0,
    latestRouteReads: 0,
    creationPortCalls: 0,
    actualRunCreates: 0,
    actualLobbyCreates: 0,
    sourceRunWrites: 0,
    sourceResultWrites: 0,
    finaleWrites: 0,
    bundleWrites: 0,
  };
  const resultReader: AuthoritativeResultReaderPort & Record<string, unknown> = {
    async readFinalized() {
      counters.resultReads += 1;
      return structuredClone(source);
    },
    async updateSourceRun() { counters.sourceRunWrites += 1; },
    async updateSourceResult() { counters.sourceResultWrites += 1; },
    async updateFinale() { counters.finaleWrites += 1; },
    async updateBundle() { counters.bundleWrites += 1; },
  };
  const authorizer: ResultViewerAuthorizerPort = {
    async readViewerContext(runId, viewerId) {
      counters.authorizeReads += 1;
      return runId === source.runId && viewerId === "viewer-cabinet_finance"
        ? viewerFixture("cabinet_finance", viewerId)
        : null;
    },
  };
  const policyPort: PressureReplayPolicyPort = {
    async listActions() {
      counters.policyReads += 1;
      return structuredClone(actions);
    },
  };
  const executionReader: ReplayExecutionReaderPort = {
    async readExecution(sourceRunId, idempotencyKey) {
      counters.executionReads += 1;
      return structuredClone(executions.get(`${sourceRunId}\u0000${idempotencyKey}`) ?? null);
    },
  };
  const sameTarget = replayTargetFixture(
    source.runId,
    participantMode,
    "SAME_FROZEN_ROUTE",
    source.frozenRouteHash,
  );
  const latestTarget = replayTargetFixture(
    source.runId,
    participantMode,
    "LATEST_REGISTERED_ROUTE",
    null,
  );
  const routeResolver = {
    async resolveSamePressureRoute() {
      counters.sameRouteReads += 1;
      return structuredClone(sameTarget);
    },
    async resolveLatestPressureRoute() {
      counters.latestRouteReads += 1;
      return structuredClone(latestTarget);
    },
  };
  const creator: ReplayCreationTransactionPort = {
    async createOnce(request: Readonly<ReplayCreationRequestV1>) {
      counters.creationPortCalls += 1;
      // Yield once so concurrent callers exercise the port's atomic recheck.
      await Promise.resolve();
      const key = `${request.sourceRunId}\u0000${request.idempotencyKey}`;
      const existing = executions.get(key);
      if (existing) {
        if (existing.requestFingerprint !== request.requestFingerprint) {
          throw new PressureResultReadError(
            "IDEMPOTENCY_KEY_REUSED",
            "replayCommand.idempotencyKey",
          );
        }
        return structuredClone(existing.receipt);
      }

      const ordinal = executions.size + 1;
      const base: Omit<ReplayCreationReceiptV1, "receiptHash"> =
        request.action.launchKind === "CREATE_RUN"
          ? {
              schemaVersion: "replay_creation_receipt_v1",
              sourceRunId: request.sourceRunId,
              actionId: request.action.actionId,
              launchKind: "CREATE_RUN",
              createdRunId: `new-run-${ordinal}`,
              createdLobbyId: null,
              navigationTarget: null,
              frozenTargetRouteHash: request.target!.targetDescriptorHash,
            }
          : request.action.launchKind === "CREATE_LOBBY"
            ? {
                schemaVersion: "replay_creation_receipt_v1",
                sourceRunId: request.sourceRunId,
                actionId: request.action.actionId,
                launchKind: "CREATE_LOBBY",
                createdRunId: null,
                createdLobbyId: `new-lobby-${ordinal}`,
                navigationTarget: null,
                frozenTargetRouteHash: request.target!.targetDescriptorHash,
              }
            : {
                schemaVersion: "replay_creation_receipt_v1",
                sourceRunId: request.sourceRunId,
                actionId: request.action.actionId,
                launchKind: "NAVIGATE",
                createdRunId: null,
                createdLobbyId: null,
                navigationTarget: request.action.href,
                frozenTargetRouteHash: null,
              };
      const receipt: ReplayCreationReceiptV1 = {
        ...base,
        receiptHash: sha256Canonical(base),
      };
      executions.set(key, {
        sourceRunId: request.sourceRunId,
        idempotencyKey: request.idempotencyKey,
        requestFingerprint: request.requestFingerprint,
        receipt,
      });
      if (receipt.launchKind === "CREATE_RUN") counters.actualRunCreates += 1;
      if (receipt.launchKind === "CREATE_LOBBY") counters.actualLobbyCreates += 1;
      return structuredClone(receipt);
    },
  };
  const handler = new PressureReplayCommandHandlerV1(
    resultReader,
    authorizer,
    new PressureReplayPolicyEvaluatorV1(policyPort),
    executionReader,
    routeResolver,
    creator,
  );
  return {
    source,
    initialSource,
    actions,
    counters,
    executions,
    handler,
    sameTarget,
    latestTarget,
  };
}

test("server-issued Solo replay creates one new Run receipt and never writes the source Run", async () => {
  const testHarness = harness("SOLO");
  const command = replayCommandFixture(testHarness.actions[0]!);
  const receipt = await testHarness.handler.execute("viewer-cabinet_finance", command);

  assert.deepEqual(validateReplayCreationReceiptV1(receipt), receipt);
  assert.equal(receipt.launchKind, "CREATE_RUN");
  assert.equal(receipt.createdRunId, "new-run-1");
  assert.equal(
    receipt.frozenTargetRouteHash,
    testHarness.sameTarget.targetDescriptorHash,
  );
  assert.deepEqual(testHarness.source, testHarness.initialSource);
  assert.equal(testHarness.counters.actualRunCreates, 1);
  assert.equal(testHarness.counters.actualLobbyCreates, 0);
  assert.equal(testHarness.counters.sourceRunWrites, 0);
  assert.equal(testHarness.counters.sourceResultWrites, 0);
  assert.equal(testHarness.counters.finaleWrites, 0);
  assert.equal(testHarness.counters.bundleWrites, 0);
});

test("forged or client-extended replay commands fail closed before target creation", async () => {
  const forged = harness("SOLO");
  const valid = replayCommandFixture(forged.actions[0]!);
  const { requestFingerprint: _ignoredFingerprint, ...validWithoutFingerprint } = valid;
  const withoutFingerprint: Omit<PressureReplayCommandV1, "requestFingerprint"> = {
    ...validWithoutFingerprint,
    actionFingerprint: sha256Canonical("forged-server-action"),
  };
  const forgedCommand: PressureReplayCommandV1 = {
    ...withoutFingerprint,
    requestFingerprint: computePressureReplayRequestFingerprint(withoutFingerprint),
  };
  await assert.rejects(
    forged.handler.execute("viewer-cabinet_finance", forgedCommand),
    (error: unknown) =>
      error instanceof PressureResultReadError &&
      error.code === "REPLAY_ACTION_NOT_ISSUED",
  );
  assert.equal(forged.counters.creationPortCalls, 0);

  const extended = harness("SOLO");
  await assert.rejects(
    extended.handler.execute("viewer-cabinet_finance", {
      ...replayCommandFixture(extended.actions[0]!),
      runtimeProfile: "SANGTIAN_CONTINUOUS_CHAPTER_V1",
    }),
  );
  assert.equal(extended.counters.creationPortCalls, 0);
});

test("a correctly signed but currently disabled server action cannot be forced", async () => {
  const testHarness = harness("SOLO");
  const current = testHarness.actions[0]!;
  const { actionFingerprint: _oldFingerprint, ...disabledBody } = current;
  const disabled = {
    ...disabledBody,
    enabled: false,
    disabledReason: "ROUTE_CREATION_DISABLED",
  };
  testHarness.actions[0] = {
    ...disabled,
    actionFingerprint: computePressureReplayActionFingerprint(disabled),
  };
  await assert.rejects(
    testHarness.handler.execute(
      "viewer-cabinet_finance",
      replayCommandFixture(testHarness.actions[0]!),
    ),
    (error: unknown) =>
      error instanceof PressureResultReadError &&
      error.code === "REPLAY_ACTION_DISABLED",
  );
  assert.equal(testHarness.counters.creationPortCalls, 0);
});

test("same replay key/fingerprint is stable under refresh and concurrency", async () => {
  const testHarness = harness("SOLO");
  const command = replayCommandFixture(testHarness.actions[0]!, {
    idempotencyKey: "concurrent-replay-key",
  });
  const receipts = await Promise.all(
    Array.from({ length: 6 }, () =>
      testHarness.handler.execute("viewer-cabinet_finance", command),
    ),
  );
  receipts.forEach((receipt) => assert.deepEqual(receipt, receipts[0]));
  assert.equal(testHarness.counters.actualRunCreates, 1);
  assert.equal(new Set(receipts.map((receipt) => receipt.createdRunId)).size, 1);

  const retry = await testHarness.handler.execute("viewer-cabinet_finance", command);
  assert.deepEqual(retry, receipts[0]);
  assert.equal(testHarness.counters.actualRunCreates, 1);
});

test("same key with another fingerprint is zero-write IDEMPOTENCY_KEY_REUSED", async () => {
  const testHarness = harness("SOLO");
  const same = replayCommandFixture(testHarness.actions[0]!, {
    idempotencyKey: "reused-key",
  });
  await testHarness.handler.execute("viewer-cabinet_finance", same);
  const latest = replayCommandFixture(testHarness.actions[1]!, {
    idempotencyKey: "reused-key",
  });
  await assert.rejects(
    testHarness.handler.execute("viewer-cabinet_finance", latest),
    (error: unknown) =>
      error instanceof PressureResultReadError &&
      error.code === "IDEMPOTENCY_KEY_REUSED",
  );
  assert.equal(testHarness.counters.actualRunCreates, 1);
  assert.equal(testHarness.counters.latestRouteReads, 0);
});

test("Multiplayer replay creates only a Lobby and CHANGE_ROLE obeys server role capability", async () => {
  const multiplayer = harness("MULTIPLAYER");
  const receipt = await multiplayer.handler.execute(
    "viewer-cabinet_finance",
    replayCommandFixture(multiplayer.actions[0]!),
  );
  assert.equal(receipt.launchKind, "CREATE_LOBBY");
  assert.equal(receipt.createdRunId, null);
  assert.equal(receipt.createdLobbyId, "new-lobby-1");
  assert.equal(multiplayer.counters.actualRunCreates, 0);
  assert.equal(multiplayer.counters.actualLobbyCreates, 1);

  const roleHarness = harness("SOLO");
  const allowed = await roleHarness.handler.execute(
    "viewer-cabinet_finance",
    replayCommandFixture(roleHarness.actions[2]!, {
      requestedRoleId: "jiangnan_merchant",
    }),
  );
  assert.equal(allowed.launchKind, "CREATE_RUN");

  const denied = harness("SOLO");
  await assert.rejects(
    denied.handler.execute(
      "viewer-cabinet_finance",
      replayCommandFixture(denied.actions[2]!, {
        requestedRoleId: "cabinet_finance",
      }),
    ),
    (error: unknown) =>
      error instanceof PressureResultReadError &&
      error.code === "REPLAY_ROLE_NOT_ALLOWED",
  );
  assert.equal(denied.counters.creationPortCalls, 0);
});

test("LATEST is resolved server-side and navigation returns an allowlisted zero-create receipt", async () => {
  const latest = harness("SOLO");
  const latestReceipt = await latest.handler.execute(
    "viewer-cabinet_finance",
    replayCommandFixture(latest.actions[1]!),
  );
  assert.equal(latest.counters.latestRouteReads, 1);
  assert.equal(
    latestReceipt.frozenTargetRouteHash,
    latest.latestTarget.targetDescriptorHash,
  );

  const navigation = harness("SOLO");
  const navigationReceipt = await navigation.handler.execute(
    "viewer-cabinet_finance",
    replayCommandFixture(navigation.actions[3]!),
  );
  assert.equal(navigationReceipt.launchKind, "NAVIGATE");
  assert.equal(navigationReceipt.navigationTarget, "/worlds");
  assert.equal(navigation.counters.actualRunCreates, 0);
  assert.equal(navigation.counters.actualLobbyCreates, 0);
  assert.equal(navigation.counters.latestRouteReads, 0);
});

function replayTargetFixture(
  sourceRunId: string,
  participantMode: ParticipantModeV1,
  targetExperience: "SAME_FROZEN_ROUTE" | "LATEST_REGISTERED_ROUTE",
  sourceRouteHash: string | null,
) {
  const release = loadPublishedSangtianActionReleaseV1();
  const registry = createPublishedSangtianRouteRegistryPortV1(
    release.routeConfiguration,
  );
  const pinnedRegistration = buildPressurePinnedRouteRegistrationV1({
    registryVersion: registry.registryVersion,
    registryHash: registry.registryHash,
    registration: release.routeRegistration,
  });
  const base = {
    schemaVersion: "pressure_replay_route_target_v1" as const,
    sourceRunId,
    targetExperience,
    participantMode,
    pinnedRegistration,
    sourceRouteHash,
  };
  return validateReplayResolvedTargetV1({
    ...base,
    targetDescriptorHash: sha256Canonical(base),
  });
}
