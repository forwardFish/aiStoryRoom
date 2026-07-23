import assert from "node:assert/strict";
import test from "node:test";
import { inspectPlayerFacingNarrative } from "../player-facing-narrative-guard";

test("rejects an internal rule summary disguised as opening prose", () => {
  const issues = inspectPlayerFacingNarrative({
    text: "朝廷只给浙江三日，必须交出一套能被复核的执行边界。密信只能证明事情不对，不能拿来定罪；总督令牌可以启动查验，也不能预先写出结果。浙江总督必须先决定：是先稳住急令的名分，还是先保住查清县册的机会。"
  });
  assert.ok(issues.some((issue) => issue.code === "NARRATIVE_EMBEDS_DECISION_MENU"));
  assert.ok(issues.some((issue) => issue.code === "NARRATIVE_READS_LIKE_RULE_SUMMARY"));
});

test("accepts a scene that delivers the same pressure through people and objects", () => {
  const issues = inspectPlayerFacingNarrative({
    text: "总督把巡抚公文翻到末页，催办日期下写着三日具报。巡抚书吏隔着屏风又躬身问道：‘中丞还等着回文，卑职不敢空手回去。’县令亲随把手中的封套举得更高，只说县尊报的是疑处，不敢告人有罪。两边来人都没有退。"
  });
  assert.deepEqual(issues, []);
});

test("accepts an NPC's conditional explanation as dialogue rather than a decision menu", () => {
  const issues = inspectPlayerFacingNarrative({
    text: "巡抚书吏捧着回文匣道：“中丞有交代，若总督准了放行，卑职即刻领文回去；若暂缓，须得问明缘由。”他仍站在屏风外，没有退。"
  });
  assert.ok(!issues.some((issue) => issue.code === "NARRATIVE_EMBEDS_DECISION_MENU"));
});

test("rejects a narrated pair of conditional branches presented as choices", () => {
  const issues = inspectPlayerFacingNarrative({
    text: "总督望着两封文书。若先签发，县册便可能成为既成事实；若先封档，巡抚就会追问延误之责。厅里的人都等着他开口。"
  });
  assert.ok(issues.some((issue) => issue.code === "NARRATIVE_EMBEDS_DECISION_MENU"));
});

test("rejects narrated conditional branches even when the second branch repeats its subject", () => {
  const issues = inspectPlayerFacingNarrative({
    text: "书吏仍捧匣等候。总督若拒，日后清流县出任何差池便无人分责；总督若允，抚院经手记录便成定局。厅中无人接话。"
  });
  assert.ok(issues.some((issue) => issue.code === "NARRATIVE_EMBEDS_DECISION_MENU"));
});

test("story packages can add their own forbidden flattening phrases", () => {
  const issues = inspectPlayerFacingNarrative({
    text: "总督府的复核权争夺仍未结束，书吏站在门外等候。",
    forbiddenFlattening: ["复核权争夺"]
  });
  assert.ok(issues.some((issue) => issue.code === "NARRATIVE_LEAKS_INTERNAL_LANGUAGE"));
});

test("rejects an unchanged object-state ledger disguised as a dramatic ending", () => {
  const issues = inspectPlayerFacingNarrative({
    text: "巡抚幕僚问完具名之责，站在案前等候。回文匣仍空着，仍合着，仍在书吏手中。"
  });
  assert.ok(issues.some((issue) => issue.code === "NARRATIVE_READS_LIKE_RULE_SUMMARY"));
});

test("rejects an unchanged object-state ledger even when the model varies the repeated markers", () => {
  const issues = inspectPlayerFacingNarrative({
    text: "巡抚书吏仍捧着回文匣，匣子空着，合着，他双手未动。总督案上的两封文书也摊在原处。"
  });
  assert.ok(issues.some((issue) => issue.code === "NARRATIVE_READS_LIKE_RULE_SUMMARY"));
});

test("allows an established object to appear when a character actually changes its state", () => {
  const issues = inspectPlayerFacingNarrative({
    text: "巡抚书吏仍捧着回文匣，听见总督应允，便打开匣盖，将新写的回文收入其中。"
  });
  assert.ok(!issues.some((issue) => issue.code === "NARRATIVE_READS_LIKE_RULE_SUMMARY"));
});
