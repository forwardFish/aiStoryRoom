import assert from "node:assert/strict";
import test from "node:test";
import { reserveMultiplayerCommand, type MultiplayerCommandReservationInput } from "./world-sequence-reservation";

function input(): MultiplayerCommandReservationInput {
  return {
    ids: { playerActionId: "action-a", submissionId: "submission-a", entryId: "entry-a", taskId: "task-a" },
    run: { id: "run-a", nodeId: "node-a", observedWorldSequence: 4 },
    turn: { id: "turn-a", threadId: "thread-a", roleId: "role-a", stageIndex: 1, turnIndex: 2, revision: 3 },
    control: { epoch: 4, allowedModes: ["HUMAN_ACTIVE", "HUMAN_OFFLINE_GRACE"] },
    playerAction: {
      userId: "user-a",
      playerType: "human",
      actionType: "choice",
      targetType: "WORLD",
      targetId: null,
      targetText: "gate",
      method: "act",
      intent: "advance",
      riskLevel: "medium",
      freeText: null,
      normalizedJson: { action: "advance" },
      guardReason: "allowed",
      actorKind: "HUMAN",
      actionKey: "advance",
      idempotencyKey: "v2-action:key-a",
      requestHash: "hash-a",
      visibility: "PUBLIC",
      targetRoleId: null,
      leverageKey: null,
      immediateJson: { receipt: "accepted" }
    },
    submission: {
      candidateId: "candidate-a",
      customAction: null,
      normalizedActionJson: { action: "advance" },
      rawIntentJson: { target: "WORLD" },
      normalizedIntentJson: { target: "WORLD" },
      immutableIntentHash: "intent-hash-a",
      guardDecisionJson: { decision: "ACCEPT" },
      selectedLeverageKeysJson: [],
      idempotencyKey: "key-a",
      requestHash: "hash-a"
    },
    entry: {
      outcomeJson: { receipt: "accepted" },
      mutationJson: { schemaVersion: "pending_world_mutation_v1" }
    },
    task: { resultJson: { actorKind: "HUMAN" } },
    creditChargeId: null
  };
}

test("multiplayer command reservation returns the one row sealed without a world sequence", async () => {
  const calls: unknown[] = [];
  const expected = {
    entryId: "entry-a",
    taskId: "task-a",
    submissionId: "submission-a",
    observedWorldSequence: 4
  };
  const reservation = await reserveMultiplayerCommand({
    $queryRaw: async (query: unknown) => { calls.push(query); return [expected]; }
  } as any, input());
  assert.deepEqual(reservation, expected);
  assert.equal(calls.length, 1);
  const sql = calls[0] as { strings?: readonly string[] };
  const text = sql.strings?.join("?") || "";
  assert.match(text, /WITH claimed_turn AS/);
  assert.match(text, /inserted_action AS/);
  assert.match(text, /inserted_entry AS/);
  assert.match(text, /inserted_task AS/);
  assert.doesNotMatch(text, /reservedWorldSequence/);
  assert.doesNotMatch(text, /inserted_resolution AS/);
});

test("multiplayer command reservation fails closed when the CTE rejects the turn", async () => {
  await assert.rejects(
    () => reserveMultiplayerCommand({ $queryRaw: async () => [] } as any, input()),
    /MULTIPLAYER_COMMAND_RESERVATION_REJECTED/
  );
});

test("multiplayer command reservation rejects an invalid observed sequence", async () => {
  await assert.rejects(
    () => reserveMultiplayerCommand({
      $queryRaw: async () => [{
        entryId: "entry-a",
        taskId: "task-a",
        submissionId: "submission-a",
        observedWorldSequence: -1
      }]
    } as any, input()),
    /OBSERVED_WORLD_SEQUENCE_INVALID/
  );
});
