import assert from "node:assert/strict";
import test from "node:test";
import { actionHistoryLabel, playerFacingCopy, resultCausalitySummary, resultDecisionHighlights } from "../public/continuous-game-view.js";

test("known strategy states are rendered as story language", () => {
  const copy = playerFacingCopy("三方行动互相制约，局势进入「state_s2_county_secret_letter_open」。");
  assert.equal(copy, "三方行动互相制约，局势进入「县令密信」。");
});

test("unknown state, asset, and internal keys never leak into player-facing copy", () => {
  const copy = playerFacingCopy("state_future_branch asset_hidden_ledger internal_resolution_trace global_future personal_future");
  assert.doesNotMatch(copy, /\b(?:state|asset|internal|global|personal)_[a-z0-9_]+\b/i);
  assert.equal(copy, "后续局势 关键线索 待核验信息 本局结局 本局结局");
});

test("ending keys are removed from narrative sentences and known causality is explained", () => {
  const publicEnding = "以替罪者封住危局（global_scapegoat）。";
  const personalEnding = "以失察获罪（personal_governor_c）。";
  assert.equal(playerFacingCopy(publicEnding), "以替罪者封住危局。" );
  assert.equal(playerFacingCopy(personalEnding), "以失察获罪。" );
  const explanation = resultCausalitySummary({ publicEnding: { content: publicEnding }, personalEnding: { content: personalEnding } });
  assert.match(explanation, /证据链/);
  assert.match(explanation, /失察责任/);
  assert.doesNotMatch(explanation, /\b(?:global|personal)_[a-z0-9_]+\b/i);
});

test("action history uses player-facing status instead of internal action keys", () => {
  const cases = [
    ["MAIN", "main_s1_governor_joint_review", "主线选择已保存"],
    ["MANEUVER", "maneuver_s1_governor_cross_check", "角色谋划已记录"],
    ["REACTION", "reaction_s2_magistrate_protect_source", "定向回应已提交"],
    ["SYSTEM_ACTION", "system_s3_market_pressure", "局势变化已记录"]
  ];
  for (const [actionSlot, actionKey, expected] of cases) {
    const label = actionHistoryLabel({ actionSlot, actionKey });
    assert.equal(label, expected);
    assert.doesNotMatch(label, /\b(?:main|maneuver|reaction|system)_s\d+_[a-z0-9_]+\b/i);
  }
});

test("terminal causality highlights sample real player-facing decisions without action keys", () => {
  const highlights = resultDecisionHighlights([
    { stageIndex: 1, slot: "MAIN", title: "先封存账册再议催办", actorKind: "HUMAN" },
    { stageIndex: 1, slot: "MANEUVER", title: "交叉核验两份县册", actorKind: "HUMAN" },
    { stageIndex: 2, slot: "MAIN", title: "公开灾损并缓征", actorKind: "HUMAN" },
    { stageIndex: 3, slot: "MAIN", title: "派员保护证人", actorKind: "AI_TAKEOVER" },
    { stageIndex: 4, slot: "MAIN", title: "建立双衙复核程序", actorKind: "HUMAN" },
    { stageIndex: 5, slot: "MAIN", title: "main_s5_internal_key", actorKind: "HUMAN" },
    { stageIndex: 7, slot: "MAIN", title: "将暗账与民情一并上奏", actorKind: "HUMAN" }
  ]);
  assert.deepEqual(highlights, [
    "第 1 轮「先封存账册再议催办」· 本人",
    "第 3 轮「派员保护证人」· AI",
    "第 7 轮「将暗账与民情一并上奏」· 本人"
  ]);
  assert.doesNotMatch(highlights.join(" "), /actionKey|main_s\d+_/i);
});
