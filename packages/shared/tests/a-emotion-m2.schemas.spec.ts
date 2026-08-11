import assert from "node:assert/strict";
import test from "node:test";
import {
  A_EMOTION_M1_PROJECTION_SCHEMA_VERSION,
  A_EMOTION_M2_EVENT_FAMILY,
  A_EMOTION_M2_FEED_SCHEMA_VERSION,
  A_EMOTION_M2_PROJECTION_SCHEMA_VERSION,
  A_EMOTION_M2_SHARED_OBJECT_ID,
  aEmotionM2ForbiddenPaths,
  aEmotionM2SemanticLeaks,
  isOpaqueAEmotionM2AggregateId,
  isOpaqueAEmotionM2Cursor,
  isOpaqueAEmotionM2EventId,
  upgradeAEmotionM1ProjectionToM2,
  validateAEmotionM2FeedV1,
  validateAEmotionM2ProjectionV1,
  type AEmotionM2ProjectionV1
} from "../src/continuous-strategy/index";

const EVENT_ID = "evt_0123456789abcdef0123456789abcdef";
const AGGREGATE_ID = "agg_0123456789abcdef0123456789abcdef";

function hidden(): AEmotionM2ProjectionV1 {
  return upgradeAEmotionM1ProjectionToM2({
    aggregateId: AGGREGATE_ID,
    stageId: "stage-2",
    projection: {
      schemaVersion: A_EMOTION_M1_PROJECTION_SCHEMA_VERSION,
      projectionVersion: 1,
      stateVersion: 4,
      eventSequence: 9,
      category: "RELATED",
      disclosure: "HIDDEN",
      severity: "MAJOR",
      centerCardType: "CROSS_IMPACT",
      title: "他人的行动改变了你的处境",
      summary: "送达总督府的账册出现异常，原始材料尚未按登记到位。",
      sourceStatus: "来源未知",
      knownFacts: ["递送编号存在断档", "多个经手环节都接触过材料"],
      visibleImpacts: [{ key: "imperial_trust", label: "皇帝信任", before: 52, after: 48, delta: -4, suffix: "", safeReason: "粮册异常引发朝廷质疑" }],
      responseOptions: [
        { code: "INVESTIGATE_LEDGER_ANOMALY", label: "派遣调查", preferredEntry: "INVESTIGATE", intentKey: "inspect_ledger_delivery", prefillText: "核对递送、封签和经手记录。" },
        { code: "QUESTION_DELIVERY_PUBLICLY", label: "公开质问", preferredEntry: "TALK", intentKey: "question_ledger_delivery", prefillText: "请相关经手方说明递送记录为何不一致。" },
        { code: "DEFER_RESPONSE", label: "暂不回应", preferredEntry: "DEFER", intentKey: null, prefillText: null }
      ],
      occurredAt: "2026-08-10T05:00:00.000Z"
    }
  });
}

function suspected(): AEmotionM2ProjectionV1 {
  return {
    ...hidden(),
    projectionVersion: 2,
    stateVersion: 5,
    eventSequence: 11,
    category: "SUSPICIOUS",
    disclosure: "SUSPECTED",
    centerCardType: "SUSPICIOUS_TRACE",
    title: "粮册流转留下了可疑迹象",
    summary: "递送记录与复核时序存在冲突，但现有证据仍不足以确认由哪一名经手角色授意。",
    sourceStatus: "两名经手角色均有嫌疑",
    knownFacts: ["递送时间晚于原定登记", "异常发生在一次临时复核之后"],
    responseOptions: [
      { code: "CONTINUE_LEDGER_EVIDENCE_SEARCH", label: "继续追查", preferredEntry: "INVESTIGATE", targetRoleKey: null, intentKey: "inspect_ledger_authority_chain", prefillText: "继续核对复核手令、递送登记、装订编号和实际经手记录。" },
      { code: "QUESTION_LEDGER_HANDLERS", label: "公开质问", preferredEntry: "TALK", targetRoleKey: null, intentKey: "question_ledger_handlers", prefillText: "请相关经手方说明复核与递送记录为何不一致。" },
      { code: "DEFER_RESPONSE", label: "保留证据", preferredEntry: "DEFER", targetRoleKey: null, intentKey: null, prefillText: null }
    ],
    visibleSuspectRoleIds: ["role-a", "role-b"],
    occurredAt: "2026-08-10T05:10:00.000Z"
  };
}

function confirmed(): AEmotionM2ProjectionV1 {
  const { visibleSuspectRoleIds: _suspects, ...base } = suspected();
  return {
    ...base,
    projectionVersion: 3,
    stateVersion: 6,
    eventSequence: 13,
    category: "RELATED",
    disclosure: "CONFIRMED",
    severity: "CRITICAL",
    centerCardType: "REVEAL",
    title: "账册异常的来源已经确认",
    summary: "两份权威记录相互印证，异常递送已经能够归责到一名明确经手角色。",
    sourceStatus: "来源已确认",
    knownFacts: ["权威手令记录与递送登记相互印证", "装订编号与原始登记存在可核验差异"],
    responseOptions: [
      { code: "EXPOSE_CONFIRMED_LEDGER_ORDER", label: "公开揭露", preferredEntry: "PLAN", targetRoleKey: "xunfu", intentKey: "publish_confirmed_ledger_evidence", prefillText: "公开已核验的手令与递送登记，要求责任方解释异常递送。" },
      { code: "PRESSURE_CONFIRMED_SOURCE", label: "私下施压", preferredEntry: "TALK", targetRoleKey: "xunfu", intentKey: "pressure_confirmed_ledger_source", prefillText: "出示已核验证据，要求责任方配合原始材料核验。" },
      { code: "DEFER_RESPONSE", label: "暂时隐瞒", preferredEntry: "DEFER", targetRoleKey: null, intentKey: null, prefillText: null }
    ],
    visibleSourceRoleId: "role-source",
    visibleSourceRoleKey: "xunfu",
    evidenceRefs: ["canon-fact:fact-1"],
    occurredAt: "2026-08-10T05:20:00.000Z"
  };
}

test("M2 identifiers are opaque and exclude internal causality", () => {
  assert.equal(isOpaqueAEmotionM2EventId(EVENT_ID), true);
  assert.equal(isOpaqueAEmotionM2AggregateId(AGGREGATE_ID), true);
  assert.equal(isOpaqueAEmotionM2Cursor("m2c_0123456789abcdef0123456789abcdef"), true);
  assert.equal(isOpaqueAEmotionM2EventId("evt_playerAction-1-role-a"), false);
  assert.equal(isOpaqueAEmotionM2AggregateId("agg_run-1:role-a"), false);
});

test("HIDDEN and SUSPECTED projections remain source-safe and never preselect a role", () => {
  for (const projection of [hidden(), suspected()]) {
    const result = validateAEmotionM2ProjectionV1(projection);
    assert.equal(result.ok, true, result.ok ? "" : result.errors.join("\n"));
    assert.deepEqual(aEmotionM2ForbiddenPaths(projection), []);
    assert.deepEqual(aEmotionM2SemanticLeaks(projection), []);
    assert.equal(projection.responseOptions.some((option) => option.targetRoleKey), false);
  }

  const hiddenLeak = { ...hidden(), summary: "浙江巡抚要求县令只交副本" };
  assert.equal(validateAEmotionM2ProjectionV1(hiddenLeak).ok, false);
  const suspectedLeak = { ...suspected(), responseOptions: suspected().responseOptions.map((option, index) => index === 0 ? { ...option, targetRoleKey: "xunfu" } : option) };
  assert.equal(validateAEmotionM2ProjectionV1(suspectedLeak).ok, false);
});

test("CONFIRMED requires evidence and exposes only the validated source", () => {
  const value = confirmed();
  const result = validateAEmotionM2ProjectionV1(value);
  assert.equal(result.ok, true, result.ok ? "" : result.errors.join("\n"));
  assert.deepEqual(aEmotionM2ForbiddenPaths(value), []);

  const noEvidence = { ...value, evidenceRefs: [] };
  assert.equal(validateAEmotionM2ProjectionV1(noEvidence).ok, false);
  const wrongTarget = { ...value, responseOptions: value.responseOptions.map((option, index) => index === 0 ? { ...option, targetRoleKey: "county_magistrate" } : option) };
  assert.equal(validateAEmotionM2ProjectionV1(wrongTarget).ok, false);
});

test("M2 feed enforces one latest aggregate row and durable receipt invariants", () => {
  const feed = {
    schemaVersion: A_EMOTION_M2_FEED_SCHEMA_VERSION,
    items: [
      { ...confirmed(), eventId: EVENT_ID, deliverySequence: 14, isUnread: false, isAcknowledged: true, isResolved: false },
      { ...suspected(), aggregateId: "agg_fedcba9876543210fedcba9876543210", eventId: "evt_fedcba9876543210fedcba9876543210", deliverySequence: 12, isUnread: true, isAcknowledged: false, isResolved: false }
    ],
    unreadCount: 1,
    nextCursor: "m2c_0123456789abcdef0123456789abcdef",
    hasMore: true
  };
  const result = validateAEmotionM2FeedV1(feed);
  assert.equal(result.ok, true, result.ok ? "" : result.errors.join("\n"));

  assert.equal(validateAEmotionM2FeedV1({ ...feed, unreadCount: 2 }).ok, false);
  assert.equal(validateAEmotionM2FeedV1({ ...feed, items: [{ ...feed.items[0], isUnread: true, isAcknowledged: true }] }).ok, false);
  assert.equal(validateAEmotionM2FeedV1({ ...feed, items: [feed.items[0], { ...feed.items[1], aggregateId: feed.items[0].aggregateId }] }).ok, false);
  assert.equal(validateAEmotionM2FeedV1({ ...feed, items: [{ ...feed.items[0], unexpectedFeedField: true }, feed.items[1]] }).ok, false);
});
