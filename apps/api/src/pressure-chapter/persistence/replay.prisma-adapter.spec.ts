import assert from "node:assert/strict";
import test from "node:test";
import {
  computePressureReplayRequestFingerprint,
  sha256Canonical,
  type PressureReplayCommandV1,
} from "@ai-story/shared";
import { loadPublishedSangtianActionReleaseV1 } from "@ai-story/templates";
import { replayActionsFixture } from "../result/result-test-fixtures";
import { createPublishedSangtianRouteRegistryPortV1 } from "../integration";
import {
  validateReplayResolvedTargetV1,
  type ReplayCreationRequestV1,
} from "../replay/ports";
import { buildPressurePinnedRouteRegistrationV1 } from "../run-router";
import {
  PrismaReplayCreationTransaction,
  PrismaReplayExecutionReader,
  type ReplayNewTargetFactoryPortV1,
  type ReplayReceiptTransactionV1,
} from "./replay.prisma-adapter";

test("Replay CREATE_RUN and receipt are atomic/idempotent without source Run writes", async () => {
  const action = replayActionsFixture("SOLO")[0]!;
  const request = requestFixture(action);
  const fake = new ReplayFake();
  const creator = new PrismaReplayCreationTransaction(fake.client, fake.factory);
  const first = await creator.createOnce(request);
  const second = await creator.createOnce(request);
  assert.equal(first.createdRunId, "new-run-1");
  assert.deepEqual(second, first);
  assert.equal(fake.targetCreates, 1);
  assert.equal(fake.receipts.length, 1);
  assert.equal(fake.sourceRunWrites, 0);

  const read = await new PrismaReplayExecutionReader(fake.client).readExecution(
    request.sourceRunId,
    request.idempotencyKey,
  );
  assert.equal(read?.requestFingerprint, request.requestFingerprint);
  assert.deepEqual(read?.receipt, first);
});

test("Replay NAVIGATE persists only server href receipt and creates no target", async () => {
  const action = replayActionsFixture("SOLO").find((item) => item.launchKind === "NAVIGATE")!;
  const request = requestFixture(action);
  const fake = new ReplayFake();
  const creator = new PrismaReplayCreationTransaction(fake.client, fake.factory);
  const receipt = await creator.createOnce(request);
  assert.equal(receipt.navigationTarget, "/worlds");
  assert.equal(receipt.createdRunId, null);
  assert.equal(fake.targetCreates, 0);
  assert.equal(fake.sourceRunWrites, 0);
});

class ReplayFake {
  readonly receipts: Array<Record<string, any>> = [];
  targetCreates = 0;
  sourceRunWrites = 0;
  readonly tx: ReplayReceiptTransactionV1 = {
    pressureReplayCommandReceipt: {
      findUnique: async (_input: any): Promise<any> => null,
      create: async (_input: any): Promise<any> => ({}),
    },
  };
  readonly client = {
    $transaction: async <T>(operation: (tx: ReplayReceiptTransactionV1) => Promise<T>): Promise<T> => {
      this.tx.pressureReplayCommandReceipt.findUnique = async ({ where }: any): Promise<any> => {
        const key = where.sourceRunId_idempotencyKey;
        const row = this.receipts.find((candidate) => (
          candidate.sourceRunId === key.sourceRunId
          && candidate.idempotencyKey === key.idempotencyKey
        ));
        return row ? structuredClone(row) : null;
      };
      this.tx.pressureReplayCommandReceipt.create = async ({ data }: any) => {
        const row = structuredClone(data);
        this.receipts.push(row);
        return structuredClone(row);
      };
      return operation(this.tx);
    },
  };
  readonly factory: ReplayNewTargetFactoryPortV1<ReplayReceiptTransactionV1> = {
    createRun: async () => {
      this.targetCreates += 1;
      return { createdRunId: `new-run-${this.targetCreates}` };
    },
    createLobby: async () => {
      this.targetCreates += 1;
      return { createdLobbyId: `new-lobby-${this.targetCreates}` };
    },
  };
}

function requestFixture(
  action: ReturnType<typeof replayActionsFixture>[number],
): ReplayCreationRequestV1 {
  const sourceRunId = "run-pressure-1";
  const withoutFingerprint: Omit<PressureReplayCommandV1, "requestFingerprint"> = {
    schemaVersion: "pressure_replay_command_v1",
    sourceRunId,
    actionId: action.actionId,
    actionFingerprint: action.actionFingerprint,
    requestedRoleId: null,
    idempotencyKey: `replay-${action.actionId}`,
  };
  const requestFingerprint = computePressureReplayRequestFingerprint(withoutFingerprint);
  return {
    sourceRunId,
    viewerId: "viewer-1",
    idempotencyKey: withoutFingerprint.idempotencyKey,
    requestFingerprint,
    action,
    requestedRoleId: null,
    participantMode: "SOLO",
    target: action.launchKind === "NAVIGATE"
      ? null
      : replayTargetFixture(sourceRunId, action.targetExperience!),
  };
}

function replayTargetFixture(
  sourceRunId: string,
  targetExperience: "SAME_FROZEN_ROUTE" | "LATEST_REGISTERED_ROUTE",
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
    participantMode: "SOLO" as const,
    pinnedRegistration,
    sourceRouteHash: targetExperience === "SAME_FROZEN_ROUTE"
      ? sha256Canonical("source-route")
      : null,
  };
  return validateReplayResolvedTargetV1({
    ...base,
    targetDescriptorHash: sha256Canonical(base),
  });
}
