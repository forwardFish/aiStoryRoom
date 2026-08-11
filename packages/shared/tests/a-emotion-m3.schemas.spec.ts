import assert from "node:assert/strict";
import test from "node:test";
import {
  A_EMOTION_KEY_MODAL_LIST_SCHEMA_VERSION,
  A_EMOTION_KEY_MODAL_RECEIPT_SCHEMA_VERSION,
  A_EMOTION_KEY_MODAL_SCHEMA_VERSION,
  A_EMOTION_M3_THRESHOLD_RULE_SCHEMA_VERSION,
  A_EMOTION_M3_TRANSITION_SCHEMA_VERSION,
  isDangerEntry,
  metricThresholdState,
  validateAEmotionKeyModalListV1,
  validateAEmotionKeyModalV1,
  validateAEmotionKeyModalReceiptV1,
  validateAEmotionMetricThresholdRuleV1,
  validateAEmotionMetricTransitionV1
} from "../src/continuous-strategy/a-emotion-m3.schemas";

const rule = {
  schemaVersion: A_EMOTION_M3_THRESHOLD_RULE_SCHEMA_VERSION,
  metricKey: "imperial_trust",
  metricLabel: "皇帝信任",
  warningAtOrBelow: 25,
  dangerAtOrBelow: 20,
  triggerCode: "LOSE_REFORM_AUTHORITY_RISK",
  modalTitle: "你正在失去主持权",
  modalSummaryTemplate: "当前指标已进入危险区。"
} as const;

const modal = {
  schemaVersion: A_EMOTION_KEY_MODAL_SCHEMA_VERSION,
  modalId: "mdl_0123456789abcdefghijklmn",
  eventId: "evt_0123456789abcdefghijklmn",
  modalType: "CRISIS",
  triggerCode: "LOSE_REFORM_AUTHORITY_RISK",
  triggerVersion: 1,
  projectionVersion: 1,
  stateVersion: 9,
  priority: 300,
  title: "你正在失去主持权",
  summary: "皇帝信任已进入危险区。",
  facts: ["皇帝信任当前为 18", "危险线为 20"],
  responseOptions: [
    { code: "INVESTIGATE_PRESSURE_SOURCE", label: "派遣调查", preferredEntry: "INVESTIGATE", intentKey: "inspect_metric_pressure", prefillText: "核查已确认事件和记录。" },
    { code: "DEFER_RESPONSE", label: "稍后处理", preferredEntry: "DEFER", intentKey: null, prefillText: null }
  ],
  ariaLive: "assertive",
  occurredAt: "2026-08-10T00:00:00.000Z",
  isShown: false,
  isAcknowledged: false
} as const;

test("M3 threshold crossing is deterministic and re-entry sensitive", () => {
  assert.equal(validateAEmotionMetricThresholdRuleV1(rule).ok, true);
  assert.equal(metricThresholdState(rule, 26), "NORMAL");
  assert.equal(metricThresholdState(rule, 25), "WARNING");
  assert.equal(metricThresholdState(rule, 20), "DANGER");
  assert.equal(isDangerEntry("WARNING", "DANGER"), true);
  assert.equal(isDangerEntry("DANGER", "DANGER"), false);
});

test("M3 transition rejects arithmetic and scope drift", () => {
  const transition = {
    schemaVersion: A_EMOTION_M3_TRANSITION_SCHEMA_VERSION,
    transitionId: "mtr_0123456789abcdefghijkl",
    roomId: "room-1", runId: "room-1", viewerRoleId: "role-governor",
    metricKey: "imperial_trust", metricLabel: "皇帝信任",
    previousValue: 23, currentValue: 18, delta: -5,
    thresholdBefore: "WARNING", thresholdAfter: "DANGER",
    triggerCode: "LOSE_REFORM_AUTHORITY_RISK",
    sourceResolutionId: "resolution-1", sourceEventId: null,
    stateVersion: 9, triggerVersion: 1, stageId: "stage-2",
    occurredAt: "2026-08-10T00:00:00.000Z"
  } as const;
  assert.equal(validateAEmotionMetricTransitionV1(transition).ok, true);
  assert.equal(validateAEmotionMetricTransitionV1({ ...transition, delta: -4 }).ok, false);
  assert.equal(validateAEmotionMetricTransitionV1({ ...transition, roomId: "other" }).ok, false);
});

test("M3 modal list and receipt remain viewer-safe and strict", () => {
  assert.equal(validateAEmotionKeyModalV1(modal).ok, true);
  assert.equal(validateAEmotionKeyModalV1({ ...modal, sourceRoleId: "private" }).ok, false);
  assert.equal(validateAEmotionKeyModalListV1({ schemaVersion: A_EMOTION_KEY_MODAL_LIST_SCHEMA_VERSION, items: [modal] }).ok, true);
  assert.equal(validateAEmotionKeyModalReceiptV1({
    schemaVersion: A_EMOTION_KEY_MODAL_RECEIPT_SCHEMA_VERSION,
    modalId: modal.modalId,
    eventId: modal.eventId,
    projectionVersion: 1,
    stateVersion: 9,
    triggerVersion: 1,
    shownAt: "2026-08-10T00:00:01.000Z",
    acknowledgedAt: null
  }).ok, true);
});
