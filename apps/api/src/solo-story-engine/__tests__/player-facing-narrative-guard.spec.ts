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

test("story packages can add their own forbidden flattening phrases", () => {
  const issues = inspectPlayerFacingNarrative({
    text: "总督府的复核权争夺仍未结束，书吏站在门外等候。",
    forbiddenFlattening: ["复核权争夺"]
  });
  assert.ok(issues.some((issue) => issue.code === "NARRATIVE_LEAKS_INTERNAL_LANGUAGE"));
});
