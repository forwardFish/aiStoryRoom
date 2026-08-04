import assert from "node:assert/strict";
import test from "node:test";
import {
  TurnModuleRegistry,
  executeTurnModule,
  turnModuleKinds,
  type TurnModuleDescriptor,
  type TurnModuleExecutionRecord,
} from "../src/turn-modules.js";

const requiredDescriptors = (): TurnModuleDescriptor[] => turnModuleKinds
  .filter((kind) => kind !== "TRUTH_OBSERVER" && kind !== "REVIEW_POLICY")
  .map((kind) => ({ kind, moduleId: `test.${kind.toLowerCase()}.v1`, mode: "REQUIRED" }));

test("module registry rejects a missing or disabled required stage", () => {
  assert.throws(
    () => new TurnModuleRegistry(requiredDescriptors().filter((item) => item.kind !== "FACT_SETTLEMENT")),
    /TURN_MODULE_REQUIRED_MISSING:FACT_SETTLEMENT/,
  );
  assert.throws(
    () => new TurnModuleRegistry(requiredDescriptors().map((item) =>
      item.kind === "NEXT_BEAT_PLANNER" ? { ...item, mode: "DISABLED" as const } : item
    )),
    /TURN_MODULE_REQUIRED_DISABLED:NEXT_BEAT_PLANNER/,
  );
});

test("optional observer and policy can be disabled without disabling fact settlement", () => {
  const registry = new TurnModuleRegistry([
    ...requiredDescriptors(),
    { kind: "TRUTH_OBSERVER", moduleId: "observer.off.v1", mode: "DISABLED" },
    { kind: "REVIEW_POLICY", moduleId: "policy.observe.v1", mode: "OPTIONAL" },
  ]);
  assert.equal(registry.enabled("TRUTH_OBSERVER"), false);
  assert.equal(registry.enabled("FACT_SETTLEMENT"), true);
  assert.equal(registry.descriptor("REVIEW_POLICY")?.moduleId, "policy.observe.v1");
});

test("every module execution emits an independently auditable record", async () => {
  const records: TurnModuleExecutionRecord[] = [];
  const result = await executeTurnModule({
    runId: "run.module-test",
    turnId: "T01",
    descriptor: {
      kind: "NEXT_BEAT_PLANNER",
      moduleId: "planner.fixture.v1",
      mode: "REQUIRED",
    },
    value: { stateRevision: 1 },
    execute: () => ({ beatId: "beat.fixture" }),
    onRecord: (record) => { records.push(record); },
  });
  assert.deepEqual(result, { beatId: "beat.fixture" });
  assert.equal(records.length, 1);
  assert.equal(records[0]?.status, "PASS");
  assert.equal(records[0]?.kind, "NEXT_BEAT_PLANNER");
  assert.match(records[0]?.inputHash || "", /^[a-f0-9]{64}$/u);
  assert.match(records[0]?.outputHash || "", /^[a-f0-9]{64}$/u);
});