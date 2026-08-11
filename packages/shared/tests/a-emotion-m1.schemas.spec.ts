import assert from "node:assert/strict";
import test from "node:test";
import {
  A_EMOTION_M1_PROJECTION_SCHEMA_VERSION,
  aEmotionM1ForbiddenPaths,
  aEmotionM1SemanticLeaks,
  isOpaqueAEmotionM1EventId,
  validateAEmotionM1ProjectionV1
} from "../src/continuous-strategy/a-emotion-m1.schemas";

function projection() {
  return {
    schemaVersion: A_EMOTION_M1_PROJECTION_SCHEMA_VERSION,
    projectionVersion: 1,
    stateVersion: 2,
    eventSequence: 9,
    category: "RELATED",
    disclosure: "HIDDEN",
    severity: "MAJOR",
    centerCardType: "CROSS_IMPACT",
    title: "他人的行动改变了你的处境",
    summary: "原始粮册的递送出现异常，部分底稿已经离开常规核验链。",
    sourceStatus: "来源未知",
    knownFacts: ["送达材料的编号与此前登记不一致", "多个经手渠道都曾接触相关材料"],
    visibleImpacts: [{ key: "imperial_trust", label: "皇帝信任", before: 43, after: 37, delta: -6, suffix: "", safeReason: "账册可信度受到质疑" }],
    responseOptions: [
      { code: "INVESTIGATE_LEDGER_ANOMALY", label: "派遣调查", preferredEntry: "INVESTIGATE", intentKey: "inspect_ledger_delivery", prefillText: "核对原始粮册的递送、编号和经手记录。" },
      { code: "QUESTION_DELIVERY_PUBLICLY", label: "公开质问", preferredEntry: "TALK", intentKey: "question_ledger_delivery", prefillText: "请相关经手方公开说明原始粮册为何未按登记送达。" },
      { code: "DEFER_RESPONSE", label: "暂不回应", preferredEntry: "DEFER", intentKey: null, prefillText: null }
    ],
    occurredAt: "2026-08-09T16:00:00.000Z"
  };
}

test("valid M1 hidden projection is strict and viewer safe", () => {
  const value = projection();
  const result = validateAEmotionM1ProjectionV1(value);
  assert.equal(result.ok, true, result.ok ? "" : result.errors.join("\n"));
  assert.deepEqual(aEmotionM1ForbiddenPaths(value), []);
  assert.deepEqual(aEmotionM1SemanticLeaks(value), []);
});

test("hidden projection rejects nested aliases, source prose and raw ids", () => {
  for (const mutated of [
    { ...projection(), nested: { sourceRoleId: "role-x" } },
    { ...projection(), summary: "巡抚衙门已经控制了原册" },
    { ...projection(), responseOptions: projection().responseOptions.map((item, index) => index === 1 ? { ...item, prefillText: "请巡抚解释" } : item) }
  ]) {
    const result = validateAEmotionM1ProjectionV1(mutated);
    assert.equal(result.ok, false);
  }
});

test("event ids are opaque and reject reversible identifiers", () => {
  assert.equal(isOpaqueAEmotionM1EventId("evt_H4hJmUeXQ3aK7pT9vB2cD5fG"), true);
  assert.equal(isOpaqueAEmotionM1EventId("evt_ACTOR_IMPACT:action-1:role-governor"), false);
  assert.equal(isOpaqueAEmotionM1EventId("evt_playerAction_12345678901234567890"), false);
});
