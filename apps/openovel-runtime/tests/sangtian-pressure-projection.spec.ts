import assert from "node:assert/strict";
import test from "node:test";
import {
  buildViewerSafeSuggestedInputs,
  projectLatestActionFeedback,
} from "../src/sangtian-pressure-projection.js";

test("projects explicit action feedback without asking the client to infer prose", () => {
  const feedback = projectLatestActionFeedback({
    actionEcho: "你先休息了半日，没有发出新的命令。",
    visibleReactions: ["幕僚在门外接下急报。", "其他五席已经先行调动。"],
    changes: {
      consequence: ["本时段的准备机会已经消耗。"],
      resource: [],
      time: ["时间推进半日。"],
      pressure: ["堰口压力上升一级。"],
      object: [],
    },
    nextPressure: "急报送到：九堰水势继续上涨，你必须在下一时段决定。",
    sourceActionIds: ["action-rest-delay"],
    settledEventIds: ["event-time-advanced", "event-pressure-increased"],
    snapshotHash: "snapshot-after-rest",
    allowedActionIds: ["action-rest-delay"],
    allowedSettledEventIds: ["event-time-advanced", "event-pressure-increased"],
    forbiddenStableIds: ["fact-hidden-order"],
  });

  assert.deepEqual(feedback.changes.resource, []);
  assert.deepEqual(feedback.changes.object, []);
  assert.match(feedback.projectionHash, /^[a-f0-9]{64}$/u);
  assert.equal(feedback.sourceActionIds[0], "action-rest-delay");
  assert.ok(Object.isFrozen(feedback));
  assert.ok(Object.isFrozen(feedback.changes));
});

test("feedback projection is deterministic and rejects viewer-unauthorized references", () => {
  const input = {
    actionEcho: "The engineer sealed the valve.",
    visibleReactions: ["The crew moved to the reserve module."],
    changes: {
      consequence: ["The leak stopped."],
      resource: ["Reserve oxygen decreased by one unit."],
      time: ["Twenty minutes elapsed."],
      pressure: ["The radiation window is closer."],
      object: ["Valve V-2 is now sealed."],
    },
    nextPressure: "The habitat enters the radiation window next.",
    sourceActionIds: ["action-seal-valve"],
    settledEventIds: ["event-valve-sealed"],
    snapshotHash: "snapshot-orbit-2",
    allowedActionIds: ["action-seal-valve"],
    allowedSettledEventIds: ["event-valve-sealed"],
    forbiddenStableIds: ["fact-hidden-saboteur"],
  } as const;

  const first = projectLatestActionFeedback(input);
  const second = projectLatestActionFeedback(input);
  assert.equal(first.projectionHash, second.projectionHash);

  assert.throws(() => projectLatestActionFeedback({
    ...input,
    sourceActionIds: ["action-command-only"],
  }), /FEEDBACK_ACTION_REFERENCE_OUTSIDE_ALLOWLIST/);
  assert.throws(() => projectLatestActionFeedback({
    ...input,
    nextPressure: "Reveal fact-hidden-saboteur now.",
  }), /FEEDBACK_REVEALS_FORBIDDEN_ID/);
});

test("open action surface exposes exactly two or three viewer-safe Preview suggestions", () => {
  const suggestions = buildViewerSafeSuggestedInputs({
    actionPhaseOpen: true,
    candidates: [
      {
        id: "suggest-evacuate",
        displayText: "先调兵疏散堰下百姓",
        sourceRefs: ["leverage-evacuation"],
        sourceKind: "KEY_LEVERAGE",
      },
      {
        id: "suggest-record",
        displayText: "命幕僚留下经手记录",
        sourceRefs: ["default-prepare-record"],
        sourceKind: "DEFAULT_PREPARE",
      },
      {
        id: "suggest-inspect",
        displayText: "亲自查看堰口水势",
        sourceRefs: ["dialogue-seed-inspect"],
        sourceKind: "DIALOGUE_SEED",
      },
    ],
    allowedSourceRefs: [
      "leverage-evacuation",
      "default-prepare-record",
      "dialogue-seed-inspect",
    ],
    forbiddenStableIds: ["fact-hidden-command"],
  });

  assert.equal(suggestions.length, 3);
  assert.ok(suggestions.every((item) => item.requiresPreview === true));
  assert.ok(Object.isFrozen(suggestions));
});

test("sealed phases expose no suggestions and malformed open surfaces fail closed", () => {
  assert.deepEqual(buildViewerSafeSuggestedInputs({
    actionPhaseOpen: false,
    candidates: [],
    allowedSourceRefs: [],
    forbiddenStableIds: [],
  }), []);

  assert.throws(() => buildViewerSafeSuggestedInputs({
    actionPhaseOpen: true,
    candidates: [{
      id: "only-one",
      displayText: "Only one option",
      sourceRefs: ["source-one"],
      sourceKind: "DETERMINISTIC_DERIVATION",
    }],
    allowedSourceRefs: ["source-one"],
    forbiddenStableIds: [],
  }), /SUGGESTED_INPUT_COUNT_INVALID/);

  assert.throws(() => buildViewerSafeSuggestedInputs({
    actionPhaseOpen: true,
    candidates: ["one", "two", "three", "four"].map((id) => ({
      id,
      displayText: id,
      sourceRefs: [`source-${id}`],
      sourceKind: "DETERMINISTIC_DERIVATION" as const,
    })),
    allowedSourceRefs: ["source-one", "source-two", "source-three", "source-four"],
    forbiddenStableIds: [],
  }), /SUGGESTED_INPUT_COUNT_INVALID/);

  assert.throws(() => buildViewerSafeSuggestedInputs({
    actionPhaseOpen: true,
    candidates: [
      {
        id: "first",
        displayText: "First",
        sourceRefs: ["allowed"],
        sourceKind: "DEFAULT_PREPARE",
      },
      {
        id: "second",
        displayText: "Second",
        sourceRefs: ["hidden-source"],
        sourceKind: "DEFAULT_COMMIT",
      },
    ],
    allowedSourceRefs: ["allowed"],
    forbiddenStableIds: ["hidden-source"],
  }), /SUGGESTED_INPUT_SOURCE_OUTSIDE_ALLOWLIST/);
});
