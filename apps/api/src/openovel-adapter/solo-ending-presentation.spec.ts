import assert from "node:assert/strict";
import test from "node:test";
import {
  legacySoloEndgamePresentation,
  projectAuthorizedCauses,
  projectAuthorizedReveal,
  toSoloEndgamePresentation,
  type SoloEndingEvidenceCandidate,
  type SoloEndingSource,
  type SoloReplayCapabilities,
} from "./solo-ending-presentation";

function ending(endingKey: string, scope: "PART" | "STORY" = "PART"): SoloEndingSource {
  return {
    schemaVersion: "openovel_ending_v1",
    scope,
    endingKey,
    title: "测试结局",
    finalSceneNarrative: "即使最后一幕写着你赢了，也不能替代规则裁定。",
    protagonistFate: "这是由现有 EndingModule 给出的主角命运。",
    aftermath: [],
    sourceTurnId: "T20",
    sourceRevision: 20,
  };
}

const replay: SoloReplayCapabilities = {
  worldId: "sangtian",
  currentRoleKey: "zhejiang_governor",
  supportedRoleKeys: ["zhejiang_governor"],
  nextPart: null,
};

const expectedVerdicts = {
  guarded_people_bore_responsibility: "COSTLY_WIN",
  guarded_people_preserved_evidence: "WIN",
  evidence_entered_capital: "COSTLY_WIN",
  executed_policy_lost_people: "LOSS",
  crisis_unresolved: "UNRESOLVED",
} as const;

for (const [endingKey, expectedVerdict] of Object.entries(expectedVerdicts)) {
  test(`maps authoritative ${endingKey} without re-adjudicating it`, () => {
    const presentation = toSoloEndgamePresentation({
      ending: ending(endingKey),
      evidence: [],
      revealCandidates: [],
      replay,
    });
    assert.equal(presentation.resultType, "SOLO_PART_END");
    assert.equal(presentation.verdict, expectedVerdict);
    assert.equal(presentation.title, "测试结局");
    assert.equal(presentation.verdictLine, "这是由现有 EndingModule 给出的主角命运。");
    assert.equal(presentation.narrative, "即使最后一幕写着你赢了，也不能替代规则裁定。");
  });
}

test("Narrator prose cannot override the authoritative loss verdict", () => {
  const presentation = toSoloEndgamePresentation({
    ending: ending("executed_policy_lost_people"),
    evidence: [],
    revealCandidates: [],
    replay,
  });
  assert.equal(presentation.verdict, "LOSS");
});

test("causes require committed authorized structured evidence and stop at three", () => {
  const base: SoloEndingEvidenceCandidate = {
    authority: "PLAYER_ACTION",
    committed: true,
    authorized: true,
    stageIndex: 1,
    sourceActionId: "action-1",
    sourceRoleName: "浙江总督",
    actionTitle: "设立复核程序",
    factText: "复核程序已进入已提交世界状态。",
    direction: "HELPED",
  };
  const causes = projectAuthorizedCauses([
    { ...base, committed: false, sourceActionId: "draft" },
    { ...base, authorized: false, sourceActionId: "private-other-role" },
    base,
    base,
    { ...base, sourceActionId: "action-2", stageIndex: 6 },
    { ...base, sourceActionId: "action-3", stageIndex: 12 },
    { ...base, sourceActionId: "action-4", stageIndex: 20 },
  ]);
  assert.deepEqual(causes.map((cause) => cause.sourceActionId), [
    "action-1",
    "action-2",
    "action-3",
  ]);
});

test("reveal returns only explicitly authorized player-visible material", () => {
  assert.equal(projectAuthorizedReveal([
    {
      committed: true,
      authorized: false,
      visibility: "PLAYER",
      title: "未授权",
      text: "不能显示",
    },
    {
      committed: true,
      authorized: true,
      visibility: "INTERNAL",
      title: "内部信息",
      text: "不能显示",
    },
  ]), null);

  assert.deepEqual(projectAuthorizedReveal([
    {
      committed: true,
      authorized: true,
      visibility: "PLAYER",
      title: "尚未解决",
      text: "奏报与责任边界仍会进入后续部分。",
    },
  ]), {
    title: "尚未解决",
    text: "奏报与责任边界仍会进入后续部分。",
  });
});

test("unsupported alternate roles and missing Part Two remain disabled", () => {
  const presentation = toSoloEndgamePresentation({
    ending: ending("guarded_people_preserved_evidence"),
    evidence: [],
    revealCandidates: [],
    replay,
  });
  assert.equal(presentation.replayActions.find((item) => item.type === "RESTART_SAME_STORY")?.enabled, true);
  assert.equal(presentation.replayActions.find((item) => item.type === "CHANGE_ROLE")?.enabled, false);
  assert.equal(presentation.replayActions.find((item) => item.type === "CONTINUE_NEXT_PART")?.enabled, false);
});

test("unknown endingKey fails closed as LEGACY_ENDING", () => {
  const presentation = toSoloEndgamePresentation({
    ending: ending("future_unknown_key"),
    evidence: [{
      authority: "PLAYER_CANON",
      committed: true,
      authorized: true,
      stageIndex: 20,
      sourceActionId: null,
      sourceRoleName: null,
      actionTitle: "未知历史行为",
      factText: "未知历史事实",
      direction: "DECISIVE",
    }],
    revealCandidates: [],
    replay,
  });
  assert.equal(presentation.resultType, "LEGACY_ENDING");
  assert.equal(presentation.verdict, "UNAVAILABLE");
  assert.deepEqual(presentation.causes, []);
});

test("missing historical ending also fails closed without reading prose", () => {
  const presentation = legacySoloEndgamePresentation({ ending: null, replay });
  assert.equal(presentation.resultType, "LEGACY_ENDING");
  assert.equal(presentation.verdict, "UNAVAILABLE");
  assert.equal(presentation.narrative, "");
});

test("STORY scope is not mislabeled as a Part ending", () => {
  const presentation = toSoloEndgamePresentation({
    ending: ending("guarded_people_preserved_evidence", "STORY"),
    evidence: [],
    revealCandidates: [],
    replay,
  });
  assert.equal(presentation.resultType, "SOLO_STORY_END");
  assert.match(
    presentation.replayActions.find((item) => item.type === "CONTINUE_NEXT_PART")?.disabledReason || "",
    /整部故事/,
  );
});
