import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = readFileSync(
  resolve(__dirname, "prepared-automation-action.prisma-adapter.ts"),
  "utf8",
);

test("prepared W5 append is one bounded Serializable transaction", () => {
  assert.match(source, /TransactionIsolationLevel\.Serializable/u);
  assert.match(source, /maxWait:\s*500/u);
  assert.match(source, /timeout:\s*2_000/u);
  assert.equal((source.match(/pressureFastSerializableTransaction\(/gu) ?? []).length >= 2, true);
});

test("prepared W5 transaction writes only DecisionAction, Ledger event and runtime projection/head", () => {
  assert.match(source, /pressureDecisionAction\.create/u);
  assert.match(source, /storyEvent\.create/u);
  assert.match(source, /pressureChapterRuntime\.updateMany/u);
  assert.doesNotMatch(source, /storyRun\.updateMany/u);
  assert.doesNotMatch(source, /pressureChapterSettlement\.create/u);
  assert.doesNotMatch(source, /pressureFinale|narrativeProvider|openovel/iu);
});

test("same deterministic action is checked for replay before the head fence", () => {
  const replay = source.indexOf("const replay = findFormalInteractionReplayV1");
  const head = source.indexOf("currentHead !== raw.authority.expectedLedgerHeadHash");
  assert.ok(replay >= 0 && head > replay);
});

test("ledger head conflict is returned before any write", () => {
  const head = source.indexOf("currentHead !== raw.authority.expectedLedgerHeadHash");
  const actionWrite = source.indexOf("await persistFormalAction(tx, event)");
  assert.ok(head >= 0 && actionWrite > head);
  assert.match(source.slice(head, actionWrite), /status:\s*"HEAD_CONFLICT"/u);
});

for (const reason of [
  "ROUTE",
  "ORCHESTRATOR_REVISION",
  "ORCHESTRATOR_HASH",
  "CHAPTER_OR_DECISION",
  "DESCRIPTOR",
  "DECISION_POLICY",
  "WORKING_REVISION",
  "WORKING_STATE",
  "DEADLINE",
  "SEAT_AUTHORITY",
  "SEAT_CONTROLLER",
  "SEAT_EPOCH",
  "SEAT_FENCE",
  "AI_POLICY",
]) {
  test(`prepared append has a fail-closed ${reason} fence`, () => {
    assert.match(source, new RegExp(`"${reason}"`, "u"));
  });
}

test("a completed W4 seat cannot append a second action", () => {
  assert.match(source, /activeSeat\.completion !== "PENDING"/u);
  assert.match(source, /activeSeat\.actionCount !== 0/u);
  assert.match(source, /activeSeat\.actionIds\.length !== 0/u);
});
