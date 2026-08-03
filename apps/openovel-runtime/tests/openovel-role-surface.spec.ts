import assert from "node:assert/strict";
import test from "node:test";
import { reviewRoleNarrativeSurface } from "../src/role-narrative-surface.js";

test("role narrative surface accepts natural paraphrase without lexical story gates", () => {
  const prose = [
    "雨脚斜过檐角，案上的旧纸被风掀起一页。来人没有催问，只把新抄的名单压在茶盏旁。",
    "他读完后仍未表态，先让书吏核清递送次序，又留下一个可供次日追查的名字。屋里的人各自盘算，事情因此有了新的去向。",
  ].join("\n\n");
  assert.deepEqual(reviewRoleNarrativeSurface(prose), { ok: true, text: prose });
});

test("role narrative surface rejects protocol, structured output, and broken prose containers", () => {
  for (const [draft, reason] of [
    ['{"stateRevision":2,"result":"done"}', "NARRATION_STRUCTURED_OUTPUT"],
    ["ROLE WORKING SET:\nsecret", "NARRATION_INTERNAL_LEAK"],
    ["正文先开始。\n```\nunfinished", "NARRATION_TRUNCATED"],
    ["1. 先做甲\n2. 再做乙\n3. 最后做丙", "NARRATION_NOT_STORY_PROSE"],
  ] as const) {
    const review = reviewRoleNarrativeSurface(draft);
    assert.equal(review.ok, false);
    if (!review.ok) assert.equal(review.reason, reason);
  }
});
