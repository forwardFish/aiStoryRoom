import assert from "node:assert/strict";
import test from "node:test";
import {
  buildPressureNarrativeReviewUnitsV1,
  buildPressureNarrativeTruthReviewInstructionV1,
  validatePressureNarrativeTruthReviewV1,
} from "./pressure-narrative-truth-review";

test("every narrative unit must receive one ordered assessment", () => {
  const units = buildPressureNarrativeReviewUnitsV1("灯影晃了一下。行动结果已经出现。等候仍在继续。");
  assert.deepEqual(units.map((unit) => unit.unitId), ["unit-001", "unit-002", "unit-003"]);
  assert.deepEqual(validatePressureNarrativeTruthReviewV1({
    assessments: [
      { unitId: "unit-001", classification: "TEXTURE_OR_TRANSIENT", supportRefs: [] },
      { unitId: "unit-002", classification: "SUPPORTED_DURABLE", supportRefs: ["result-ref"] },
      { unitId: "unit-003", classification: "UNSUPPORTED_DURABLE", supportRefs: [] },
    ],
    missingRequiredRefs: [],
  }, units, ["result-ref"], ["result-ref"]), {
    assessments: [
      { unitId: "unit-001", classification: "TEXTURE_OR_TRANSIENT", supportRefs: [] },
      { unitId: "unit-002", classification: "SUPPORTED_DURABLE", supportRefs: ["result-ref"] },
      { unitId: "unit-003", classification: "UNSUPPORTED_DURABLE", supportRefs: [] },
    ],
    missingRequiredRefs: [],
  });
});

test("review cannot skip a narrative unit", () => {
  const units = buildPressureNarrativeReviewUnitsV1("第一句。第二句。");
  assert.throws(() => validatePressureNarrativeTruthReviewV1({
    assessments: [{ unitId: "unit-001", classification: "TEXTURE_OR_TRANSIENT", supportRefs: [] }],
    missingRequiredRefs: [],
  }, units, [], []), /PRESSURE_NARRATIVE_TRUTH_REVIEW_UNIT_COUNT/u);
});

test("supported durable classification requires an allowed support reference", () => {
  const units = buildPressureNarrativeReviewUnitsV1("某项状态已经改变。");
  assert.throws(() => validatePressureNarrativeTruthReviewV1({
    assessments: [{ unitId: "unit-001", classification: "SUPPORTED_DURABLE", supportRefs: ["unknown"] }],
    missingRequiredRefs: [],
  }, units, ["known"], []), /PRESSURE_NARRATIVE_TRUTH_REVIEW_SUPPORT_REF_UNKNOWN/u);
});

test("review instruction is chapter-neutral and forces full unit coverage", () => {
  const prompt = buildPressureNarrativeTruthReviewInstructionV1();
  assert.match(prompt, /不能跳过任何叙事单元/u);
  assert.match(prompt, /删除该细节后/u);
  assert.match(prompt, /普通工具、物资、无名执行者和现场过程/u);
  assert.match(prompt, /本身不自动成为持久事实/u);
  assert.match(prompt, /不要因为.*就要求authority逐项支持这些纹理/u);
  assert.match(prompt, /CONTINUITY_ONLY内容只能帮助衔接/u);
  assert.match(prompt, /行动尚未开始/u);
  assert.doesNotMatch(prompt, /N1|九堰|胡宗宪|SUPPORT_WEIR/u);
});
