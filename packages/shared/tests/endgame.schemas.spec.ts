import assert from "node:assert/strict";
import test from "node:test";
import {
  ENDGAME_PRESENTATION_V1_SCHEMA,
  validateEndgamePresentationV1,
  type EndgamePresentationV1,
} from "../src/continuous-strategy/endgame.schemas";

function validPresentation(): EndgamePresentationV1 {
  return {
    schemaVersion: ENDGAME_PRESENTATION_V1_SCHEMA,
    resultType: "SOLO_PART_END",
    verdict: "COSTLY_WIN",
    verdictLabel: "你守住了底线，但承担了代价",
    title: "守土担责",
    verdictLine: "首份奏报已经离开浙江，问责也落到了自己名下。",
    narrative: "驿骑离开杭州时，签押房里只剩尚未干透的印泥。",
    gain: ["民田边界仍然有效。"],
    loss: ["你失去了继续含混退让的余地。"],
    causes: [
      {
        stageIndex: 20,
        sourceActionId: "action-t20",
        sourceRoleName: "浙江总督",
        actionTitle: "签发分路奏报",
        factText: "首份奏报已经离开浙江。",
        direction: "DECISIVE",
      },
    ],
    reveal: null,
    replayHint: "另一条路线可以更早保全证据链。",
    replayActions: [
      {
        type: "RESTART_SAME_STORY",
        label: "重新开始",
        href: "/role-select?story=sangtian&start=new",
        enabled: true,
        disabledReason: null,
      },
      {
        type: "CONTINUE_NEXT_PART",
        label: "进入第二部分",
        href: null,
        enabled: false,
        disabledReason: "第二部分尚未开放。",
      },
    ],
  };
}

test("endgame_presentation_v1 accepts the shared player-visible contract", () => {
  const result = validateEndgamePresentationV1(validPresentation());
  assert.equal(result.ok, true, result.ok ? "" : result.errors.join(" | "));
});

test("endgame_presentation_v1 rejects internal adjudication fields", () => {
  const value = {
    ...validPresentation(),
    endingKey: "guarded_people_bore_responsibility",
    score: 99,
    factKey: "internal_fact",
  };
  const result = validateEndgamePresentationV1(value);
  assert.equal(result.ok, false);
  assert.match(result.ok ? "" : result.errors.join("\n"), /unexpected property: endingKey/);
  assert.match(result.ok ? "" : result.errors.join("\n"), /unexpected property: score/);
  assert.match(result.ok ? "" : result.errors.join("\n"), /unexpected property: factKey/);
});

test("endgame_presentation_v1 caps real causes at three without permitting filler", () => {
  const cause = validPresentation().causes[0];
  const result = validateEndgamePresentationV1({
    ...validPresentation(),
    causes: [cause, cause, cause, cause],
  });
  assert.equal(result.ok, false);
  assert.match(result.ok ? "" : result.errors.join("\n"), /at most three/);
});

test("LEGACY_ENDING fails closed with an unavailable verdict", () => {
  const invalid = validateEndgamePresentationV1({
    ...validPresentation(),
    resultType: "LEGACY_ENDING",
    verdict: "WIN",
  });
  assert.equal(invalid.ok, false);
  assert.match(invalid.ok ? "" : invalid.errors.join("\n"), /requires UNAVAILABLE/);

  const valid = validateEndgamePresentationV1({
    ...validPresentation(),
    resultType: "LEGACY_ENDING",
    verdict: "UNAVAILABLE",
    verdictLabel: "历史结局数据不完整",
  });
  assert.equal(valid.ok, true, valid.ok ? "" : valid.errors.join(" | "));
});

test("replay actions require safe explicit enabled and disabled states", () => {
  const missingHref = validateEndgamePresentationV1({
    ...validPresentation(),
    replayActions: [{
      type: "RESTART_SAME_STORY",
      label: "重新开始",
      href: null,
      enabled: true,
      disabledReason: null,
    }],
  });
  assert.equal(missingHref.ok, false);
  assert.match(missingHref.ok ? "" : missingHref.errors.join("\n"), /enabled actions require href/);

  const duplicate = validateEndgamePresentationV1({
    ...validPresentation(),
    replayActions: [
      validPresentation().replayActions[0],
      validPresentation().replayActions[0],
    ],
  });
  assert.equal(duplicate.ok, false);
  assert.match(duplicate.ok ? "" : duplicate.errors.join("\n"), /duplicate type/);
});
