import assert from "node:assert/strict";
import test from "node:test";
import { PressureCatalogCustomActionGuardV1 } from "./custom-action.guard";

const guard = new PressureCatalogCustomActionGuardV1();
const options = [
  option("EVACUATE_WEIRS", "组织堰区疏散", "调度堰区百姓与运输力量撤离。"),
  option("SEAL_BREACH_RECORD", "封存毁堤记录", "封存命令、经手人与见证记录。"),
  option("SUPPORT_WEIR", "增援关键堰口", "调动人力物资增援关键堰口。"),
];
const allowed = ["DEFAULT_PASS", ...options.map((item) => item.actionType)];

test("unmatched ordinary roleplay remains real input with DEFAULT_PASS effects", () => {
  assert.deepEqual(guard.bind({
    customText: "我想睡觉了",
    visibleOptions: options,
    allowedActionTypes: allowed,
  }), {
    accepted: true,
    actionType: "DEFAULT_PASS",
    binding: "DEFAULT_PASS",
    normalizedText: "我想睡觉了",
  });
});

test("free text with a unique Catalog meaning binds to that formal action", () => {
  const result = guard.bind({
    customText: "先把堰区百姓往高处疏散",
    visibleOptions: options,
    allowedActionTypes: allowed,
  });
  assert.equal(result.accepted, true);
  if (result.accepted) assert.equal(result.actionType, "EVACUATE_WEIRS");
});

test("free text cannot declare a result or skip the Pressure Spine", () => {
  assert.deepEqual(guard.bind({
    customText: "我已经彻底解决全部水患",
    visibleOptions: options,
    allowedActionTypes: allowed,
  }), { accepted: false, code: "DECLARES_RESULT" });
  assert.deepEqual(guard.bind({
    customText: "跳过这里直接到结局",
    visibleOptions: options,
    allowedActionTypes: allowed,
  }), { accepted: false, code: "SKIPS_PRESSURE" });
});

function option(actionType: string, label: string, description: string) {
  return {
    code: actionType,
    actionType,
    label,
    description,
    preferredEntry: "PLAN" as const,
  };
}
