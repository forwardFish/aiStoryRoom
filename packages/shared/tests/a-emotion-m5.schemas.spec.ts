import assert from "node:assert/strict";
import test from "node:test";
import {
  A_EMOTION_M5_MILESTONE_SCHEMA_VERSION,
  A_EMOTION_M5_RULE_SCHEMA_VERSION,
  A_EMOTION_M5_SUMMARY_SCHEMA_VERSION,
  validateAEmotionInteractionSummaryV1,
  validateAEmotionStageMilestoneRuleV1,
  validateAEmotionStageMilestoneV1
} from "../src/continuous-strategy/a-emotion-m5.schemas";

const reward = {
  metricKey: "reform_progress",
  metricDelta: 12,
  capabilityCodes: ["QUESTION_AUTHORITY"],
  restrictionCodes: ["OPPONENT_REPORT_CONTROL_RESTRICTED"]
};

const rule = {
  schemaVersion: A_EMOTION_M5_RULE_SCHEMA_VERSION,
  milestoneCode: "CONTROL_ORIGINAL_LEDGER",
  requiredActionCodes: ["CONTROL_ORIGINAL_DOCUMENT"],
  requiredEffectCodes: ["ORIGINAL_DOCUMENT_CONTROL_ESTABLISHED"],
  requiredFactCodes: ["ORIGINAL_DOCUMENT_CONTROL_CONFIRMED"],
  revokeActionCodes: ["SURRENDER_ORIGINAL_DOCUMENT_CONTROL"],
  revokeEffectCodes: ["ORIGINAL_DOCUMENT_CONTROL_LOST"],
  revokeFactCodes: ["ORIGINAL_DOCUMENT_CONTROL_REVOKED"],
  reward
} as const;

const milestone = {
  schemaVersion: A_EMOTION_M5_MILESTONE_SCHEMA_VERSION,
  milestoneId: `ms_${"a".repeat(32)}`,
  roomId: "room-1",
  runId: "room-1",
  stageId: "stage-4",
  milestoneCode: "CONTROL_ORIGINAL_LEDGER",
  beneficiaryRoleId: "role-governor",
  status: "ACHIEVED",
  stateVersion: 1,
  evidenceRefs: ["action-code:CONTROL_ORIGINAL_DOCUMENT", "fact-code:ORIGINAL_DOCUMENT_CONTROL_CONFIRMED"],
  reward,
  achievedAt: "2026-08-10T00:00:00.000Z",
  revokedAt: null
} as const;

test("M5 rule accepts only exact canonical code groups", () => {
  assert.equal(validateAEmotionStageMilestoneRuleV1(rule).ok, true);
  assert.equal(validateAEmotionStageMilestoneRuleV1({ ...rule, requiredActionCodes: [], requiredEffectCodes: [], requiredFactCodes: [] }).ok, false);
  assert.equal(validateAEmotionStageMilestoneRuleV1({ ...rule, regex: "原册|账册" }).ok, false);
});

test("M5 milestone enforces opaque identity, evidence and lifecycle", () => {
  assert.equal(validateAEmotionStageMilestoneV1(milestone).ok, true);
  assert.equal(validateAEmotionStageMilestoneV1({ ...milestone, milestoneId: "ms_action-1" }).ok, false);
  assert.equal(validateAEmotionStageMilestoneV1({ ...milestone, evidenceRefs: [] }).ok, false);
  assert.equal(validateAEmotionStageMilestoneV1({ ...milestone, status: "REVOKED", revokedAt: null }).ok, false);
});

test("M5 viewer summary cannot leak private authority fields", () => {
  const summary = {
    schemaVersion: A_EMOTION_M5_SUMMARY_SCHEMA_VERSION,
    roomId: "room-1",
    runId: "room-1",
    viewerRoleId: "role-governor",
    generatedAt: "2026-08-10T00:01:00.000Z",
    influencedMe: [{
      eventId: `evt_${"b".repeat(32)}`,
      category: "RELATED",
      disclosure: "HIDDEN",
      title: "一项外部行动影响了你的处境",
      safeSummary: "来源尚未确认。",
      statusLabel: "来源未知",
      evidenceRefs: [],
      occurredAt: "2026-08-10T00:00:00.000Z"
    }],
    influencedOthers: [],
    promiseResults: [],
    milestones: [milestone]
  } as const;
  assert.equal(validateAEmotionInteractionSummaryV1(summary).ok, true);
  assert.equal(validateAEmotionInteractionSummaryV1({ ...summary, sourceRoleId: "private-role" }).ok, false);
  assert.equal(validateAEmotionInteractionSummaryV1({ ...summary, milestones: [{ ...milestone, beneficiaryRoleId: "other-role" }] }).ok, false);
});
