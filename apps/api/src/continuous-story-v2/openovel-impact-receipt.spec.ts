import assert from "node:assert/strict";
import test from "node:test";
import {
  assertOpenNovelImpactReceiptIdentity,
  findEarlierUnfinishedRoleImpact,
  projectPendingImpactTasks,
  publishOpenNovelImpactReceipt,
  roleAssetAudienceWhere,
  roleCommitmentAudienceWhere
} from "./openovel-impact-receipt";

const tasks = [
  { id: "impact-2", roleId: "role-a", status: "FAILED", inputRefId: "action-2", resultJson: { appliedWorldSequence: 2 } },
  { id: "impact-3", roleId: "role-a", status: "RUNNING", inputRefId: "action-3", resultJson: { appliedWorldSequence: 3 } },
  { id: "impact-4", roleId: "role-b", status: "PENDING", inputRefId: "action-4", resultJson: { appliedWorldSequence: 4 } }
];

test("FAILED impact remains the earliest strict per-role blocker", () => {
  assert.deepEqual(findEarlierUnfinishedRoleImpact("result-4", "role-a", 4, tasks), {
    taskId: "impact-2",
    appliedWorldSequence: 2
  });
  assert.equal(findEarlierUnfinishedRoleImpact("impact-2", "role-a", 2, tasks), null);
  assert.equal(findEarlierUnfinishedRoleImpact("result-5", "role-c", 5, tasks), null);
});

test("malformed unfinished impact fails closed instead of being silently skipped", () => {
  assert.deepEqual(findEarlierUnfinishedRoleImpact("result-8", "role-a", 8, [
    { id: "broken", roleId: "role-a", status: "PENDING", resultJson: { appliedWorldSequence: "unknown" } }
  ]), { taskId: "broken", appliedWorldSequence: null });
});

test("pending projection retains orphan tasks and sorts by durable sequence", () => {
  assert.deepEqual(projectPendingImpactTasks([
    { id: "orphan", roleId: "role-a", status: "FAILED", inputRefId: "missing", resultJson: {} },
    { id: "late", roleId: "role-a", status: "RUNNING", inputRefId: "action-9", resultJson: { appliedWorldSequence: 9 } },
    { id: "fallback", roleId: "role-a", status: "PENDING", inputRefId: "action-6", resultJson: {} }
  ], [{ playerActionId: "action-6", appliedWorldSequence: 6 }]), [
    { id: "orphan", status: "RECOVERY_REQUIRED", appliedWorldSequence: null },
    { id: "fallback", status: "PENDING", appliedWorldSequence: 6 },
    { id: "late", status: "SYNCING", appliedWorldSequence: 9 }
  ]);
});

test("audience queries expose only owned or public assets and participant or public commitments", () => {
  assert.deepEqual(roleAssetAudienceWhere("run", "role"), {
    runId: "run",
    OR: [{ ownerRoleId: "role" }, { visibility: "PUBLIC" }]
  });
  assert.deepEqual(roleCommitmentAudienceWhere("run", "role"), {
    runId: "run",
    OR: [{ issuerRoleId: "role" }, { receiverRoleId: "role" }, { visibility: "PUBLIC" }]
  });
});

test("receipt replay must match every immutable identity field", async () => {
  const input = {
    runId: "run",
    nodeId: "node",
    roleId: "role",
    threadId: "thread",
    playerActionId: "action",
    mode: "FULL" as const,
    impactSeed: "A visible consequence",
    appliedWorldSequence: 7
  };
  const receipt = {
    id: "entry",
    runId: "run",
    nodeId: "node",
    roleId: "role",
    entryType: "V2_CROSS_IMPACT",
    visibility: "role_private",
    content: "A visible consequence",
    threadKeysJson: ["thread"],
    sourceEventIdsJson: ["action"],
    worldSequence: 7,
    dedupeKey: "v2-impact:action:role"
  };
  assert.doesNotThrow(() => assertOpenNovelImpactReceiptIdentity(receipt, input));
  assert.throws(() => assertOpenNovelImpactReceiptIdentity({ ...receipt, worldSequence: 8 }, input), /IDENTITY_CONFLICT/);
  let upsertArgs: unknown;
  const result = await publishOpenNovelImpactReceipt({
    narrativeEntry: {
      async upsert(args) {
        upsertArgs = args;
        return receipt;
      }
    }
  }, input);
  assert.deepEqual(result, { entryId: "entry", dedupeKey: "v2-impact:action:role" });
  assert.deepEqual((upsertArgs as any).create.sourceEventIdsJson, ["action"]);
});
