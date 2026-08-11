import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { validateB0RoomRulesetV1, validateB0SettlementWindowV1 } from "@ai-story/shared";
import { B0ContractError, assertB0WindowTransitionV1, freezeB0RoomRulesetV1, hashB0RoomRulesetV1 } from "../src/runtime-contract/b0-settlement";
import { immediateRuleset, validWindow, windowedRuleset } from "./b0-settlement.fixtures";

test("WINDOWED and IMMEDIATE share one immutable RoomRuleset contract", () => {
  const multiplayer = windowedRuleset(); const solo = immediateRuleset();
  assert.equal(validateB0RoomRulesetV1(multiplayer).ok, true);
  assert.equal(validateB0RoomRulesetV1(solo).ok, true);
  assert.equal(multiplayer.schemaVersion, solo.schemaVersion);
  assert.equal(multiplayer.maxPrimaryIntentsPerActor, 1);
  assert.equal(solo.maxPrimaryIntentsPerActor, 1);
  assert.equal(Object.isFrozen(multiplayer), true);
  assert.equal(Object.isFrozen(multiplayer.featureFlags), true);
});

test("RoomRuleset rejects unknown fields and B0 boundary violations", () => {
  assert.equal(validateB0RoomRulesetV1({ ...windowedRuleset(), extraRule: true }).ok, false);
  assert.equal(validateB0RoomRulesetV1({ ...windowedRuleset(), featureFlags: { ...windowedRuleset().featureFlags, hiddenToggle: true } }).ok, false);
  for (const patch of [{ reactionDepth: 1 }, { maxPrimaryIntentsPerActor: 2 }, { structuredCommitmentsEnabled: true }]) {
    assert.equal(validateB0RoomRulesetV1({ ...windowedRuleset(), ...patch }).ok, false);
  }
});

test("WINDOWED mode requires structured results, typed audience and window flag", () => {
  for (const flag of ["structuredResultEnabled", "typedAudienceV2Enabled", "windowedSettlementEnabled"] as const) {
    const candidate = { ...windowedRuleset(), featureFlags: { ...windowedRuleset().featureFlags, [flag]: false } };
    assert.equal(validateB0RoomRulesetV1(candidate).ok, false);
  }
});

test("ruleset hash is key-order independent and freeze is detached", () => {
  const first = windowedRuleset();
  assert.equal(hashB0RoomRulesetV1(first), hashB0RoomRulesetV1(Object.fromEntries(Object.entries(first).reverse())));
  const input = JSON.parse(JSON.stringify(first)); const frozen = freezeB0RoomRulesetV1(input);
  input.rulesetVersion = "changed-outside";
  assert.equal(frozen.rulesetVersion, "b0-rules-v1");
  assert.equal(Reflect.set(frozen.featureFlags, "narrativeAsyncEnabled", false), false);
  assert.equal(frozen.featureFlags.narrativeAsyncEnabled, true);
});

test("window validator and state machine are fail-closed", () => {
  assert.equal(validateB0SettlementWindowV1(validWindow()).ok, true);
  assert.equal(validateB0SettlementWindowV1({ ...validWindow(), debug: true }).ok, false);
  assert.equal(validateB0SettlementWindowV1({ ...validWindow(), readyActorIds: ["actor.unknown"] }).ok, false);
  assert.doesNotThrow(() => assertB0WindowTransitionV1("OPEN", "LOCKED"));
  assert.throws(() => assertB0WindowTransitionV1("OPEN", "COMMITTED"), B0ContractError);
});

test("generic B0 sources contain no world-specific vocabulary", async () => {
  const files = [
    "../../shared/src/continuous-strategy/b0-settlement.schemas.ts",
    "../../shared/src/continuous-strategy/b0-settlement.ruleset.validators.ts",
    "../../shared/src/continuous-strategy/b0-settlement.action.validators.ts",
    "../../shared/src/continuous-strategy/b0-settlement.batch.validators.ts",
    "../../shared/src/continuous-strategy/b0-settlement.result.validators.ts",
    "../src/runtime-contract/b0-settlement.ts",
  ];
  const joined = (await Promise.all(files.map((file) => readFile(new URL(file, import.meta.url), "utf8")))).join("\n");
  for (const forbidden of ["Caesar", "Brutus", "Cicero", "Antony", "凯撒", "布鲁图斯", "西塞罗", "安东尼", "巡抚", "田契", "粮册"]) {
    assert.equal(joined.includes(forbidden), false, `forbidden world term: ${forbidden}`);
  }
});
