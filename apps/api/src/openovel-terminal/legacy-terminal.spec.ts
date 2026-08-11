import assert from "node:assert/strict";
import test from "node:test";
import { AuthoritativeLegacyTerminalCommitter } from "./authoritative-legacy-terminal-committer";
import { LegacyTerminalInputAdapter } from "./legacy-terminal-input-adapter";
import { LegacyT20HeadGuard } from "./legacy-t20-head-guard";

function fixtureInput() {
  return new LegacyTerminalInputAdapter().adapt({
    run: {
      id: "run.legacy",
      title: "Legacy Story",
      templateKey: "sangtian",
      currentNodeId: "node.t19",
      currentChapter: 1,
      worldSequence: 19,
    },
    runtimeRun: {
      runId: "run.legacy",
      worldId: "sangtian",
      roleId: "governor",
      runtimeMode: "OPENOVEL_V1",
      turnNumber: 19,
      status: "ACTIVE",
      canon: "T19 canon",
      recentCanon: "The nineteenth turn is confirmed.",
      ending: null,
      options: [],
      updatedAt: "2026-08-12T00:00:00.000Z",
    },
    role: { id: "role.governor", roleKey: "governor", roleName: "Governor" },
    userId: "user.1",
    action: "Submit the final authoritative memorial.",
    actionIdempotencyKey: "openovel-action:run.legacy:user.1:terminal-001",
    requestHash: "c".repeat(64),
  });
}

test("legacy guard adapts T19 and rejects creation of a new T20 head", () => {
  const guard = new LegacyT20HeadGuard();
  assert.equal(guard.shouldAdaptUnfinished(19), true);
  assert.equal(guard.shouldAdaptUnfinished(18), false);
  assert.throws(() => guard.assertNoNewT20Head(20, "ADVANCE"), /LEGACY_T20_HEAD_DISABLED|legacy T20 heads/i);
  assert.throws(() => guard.assertNoNewT20Head(20, "REPLAY"), /LEGACY_T20_HEAD_DISABLED|legacy T20 heads/i);
  assert.throws(() => guard.assertNoNewT20Head(20, "RESTART"), /LEGACY_T20_HEAD_DISABLED|legacy T20 heads/i);
});

test("unfinished T19 adapter emits an immutable finalized result without prose generation", () => {
  const input = fixtureInput();
  assert.equal(input.schemaVersion, "legacy-terminal-input-v1");
  assert.equal(input.authoritativeResult.schemaVersion, "openovel-result-v2");
  assert.equal(input.authoritativeResult.authoritativeResultStatus, "FINALIZED");
  assert.equal(input.authoritativeResult.structuredResultReady, true);
  assert.equal(input.authoritativeResult.sourceKind, "LEGACY_TERMINAL");
  assert.equal(input.authoritativeResult.narrativeStatus, "PENDING");
  assert.equal(input.authoritativeResult.sourceCommitHash.length, 64);
});

test("legacy committer makes Ending Canon Result completion and outbox visible in one transaction", async () => {
  const calls: string[] = [];
  let stateJson: any = { legacy: true };
  const tx = {
    storyRun: {
      findUnique: async () => ({ status: "playing", stateJson }),
      update: async (input: any) => {
        calls.push("storyRun.update");
        stateJson = input.data.stateJson;
        assert.equal(input.data.status, "completed");
        assert.equal(input.data.stateJson.openNovelResultV2.authoritativeResultStatus, "FINALIZED");
        return input.data;
      },
    },
    canonFact: {
      upsert: async () => { calls.push("canonFact.upsert"); return {}; },
    },
    playerAction: {
      upsert: async (input: any) => {
        calls.push("playerAction.upsert");
        assert.equal(input.create.actionSlot, "LEGACY_TERMINAL");
        return { id: "action.terminal" };
      },
    },
    storyTaskOutbox: {
      upsert: async (input: any) => {
        calls.push("storyTaskOutbox.upsert");
        assert.equal(input.create.status, "pending");
        assert.equal(input.create.checkpointKey, "LEGACY_AUTHORITATIVE_RESULT_FINALIZED");
        assert.equal(input.create.resultJson.narrativeStatus, "PENDING");
        return {};
      },
    },
  };
  const prisma = {
    $transaction: async (operation: any) => {
      calls.push("transaction.begin");
      const result = await operation(tx);
      calls.push("transaction.commit");
      return result;
    },
  };

  const result = await new AuthoritativeLegacyTerminalCommitter(prisma as any).commit(fixtureInput());
  assert.equal(result.authoritativeResultStatus, "FINALIZED");
  assert.deepEqual(calls, [
    "transaction.begin",
    "canonFact.upsert",
    "playerAction.upsert",
    "storyRun.update",
    "storyTaskOutbox.upsert",
    "transaction.commit",
  ]);
});
