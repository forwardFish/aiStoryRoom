import assert from "node:assert/strict";
import {
  compileStoryContextV2,
  validateStoryContextFreshnessV2,
  type CompileStoryContextInputV2,
  type StoryContextSourceV2
} from "./story-context";

const identity = {
  runId: "run-ctx-1",
  templateKey: "sangtian_v1_2",
  engineVersion: "continuous_story_v2",
  roleId: "role-governor",
  actorTurnId: "turn-governor-2",
  macroStageKey: "s1",
  worldSequence: 7,
  turnRevision: 2,
  controlEpoch: 1
};

const audience = {
  roleName: "浙江总督",
  publicIdentity: "统筹浙江军政的封疆大吏",
  authority: ["调度总督衙门", "通过密奏渠道向朝廷陈情"],
  cannotDo: ["直接替巡抚作出回应", "使用自己不知情的密报"],
  privateGoal: "稳住浙江，同时保住复核权",
  knowledgeBoundary: ["知道清流县田册存在两套数字", "不知道巡抚幕府昨夜密谈的原话"]
};

function source(
  itemId: string,
  sourceType: StoryContextSourceV2["sourceType"],
  content: string,
  overrides: Partial<StoryContextSourceV2> = {}
): StoryContextSourceV2 {
  return {
    itemId,
    sourceType,
    sourceId: itemId,
    title: itemId,
    content,
    visibility: "PRIVATE",
    knownByRoleIds: ["role-governor"],
    basedOnWorldSequence: 7,
    inclusionReason: `测试 ${sourceType}`,
    priority: "P0",
    mustPreserve: true,
    ...overrides
  };
}

const recentCanonOne = "雨打在总督府东廊的青瓦上。浙江总督把两份数字相反的田册并排压在案头，吩咐书吏先记下送册时辰，不许惊动巡抚幕府。";
const recentCanonTwo = "半个时辰后，清流县的老书吏被带进签押房。他没有喊冤，只把袖中沾着新墨的经手簿放在灯下，说昨夜有人借走过县印。";

const baseSources: StoryContextSourceV2[] = [
  source("identity", "ROLE_IDENTITY", "你是浙江总督，眼下必须亲自决定总督府如何回应。"),
  source("authority", "ROLE_AUTHORITY", "你可以调取县册、传讯书吏、秘密上奏；不能替其他角色表态。"),
  source("knowledge", "KNOWLEDGE_BOUNDARY", "你只知道自己收到的两份田册和经手簿，不知道巡抚的私人计划。"),
  source("scene", "CURRENT_SCENE", "嘉靖三十五年五月初八午后，杭州总督府签押房；浙江总督与两名书吏在场。"),
  source("pressure", "ACTIVE_PRESSURE", "巡抚要求日落前给出是否执行改桑急令的具名回文。"),
  source("intent", "PLAYER_INTENT", "调取清流县原始田册，封存底稿，并让两名经手书吏当面对印。"),
  source("resolution", "RULE_RESOLUTION", "原始田册已成功封存；县印借用记录仍待核实；行动没有替巡抚作出回应。"),
  source("commitment", "COMMITMENT", "你已答应老书吏：在日落前不把他的名字写进公开回文。"),
  source("condition", "ACTIVE_CONDITION", "若有人在日落前强取县册，就把经手簿转交按察司副使。"),
  source("interaction", "UNANSWERED_INTERACTION", "巡抚送来具名短札，要求你确认是否接受联合复核。"),
  source("canon-1", "RECENT_CANON", recentCanonOne, { priority: "P1", mustPreserve: false, chronologicalOrder: 1 }),
  source("canon-2", "RECENT_CANON", recentCanonTwo, { priority: "P1", mustPreserve: false, chronologicalOrder: 2 }),
  source("evidence", "ASSET_OR_EVIDENCE", "你持有清流县原始田册和一册带新墨痕迹的经手簿。", { priority: "P1", mustPreserve: false }),
  source("world", "WORLD_BIBLE", "明代官署依靠公文、关防、驿递和当面对质传递与验证消息。", { priority: "P2", mustPreserve: false, visibility: "PUBLIC", knownByRoleIds: [] }),
  source("private-xunfu", "OPEN_THREAD", "巡抚其实已经答应商会销毁副册。", { priority: "P1", mustPreserve: false, knownByRoleIds: ["role-xunfu"] })
];

const compileInput: CompileStoryContextInputV2 = {
  identity,
  purpose: "RESULT",
  audience,
  sources: baseSources,
  maxTokenEstimate: 2_000
};

const compiled = compileStoryContextV2(compileInput);
assert.equal(compiled.ok, true);
if (!compiled.ok) throw new Error("context unexpectedly rejected");

// CTX-001: the role-specific snapshot never contains another role's private fact.
assert.ok(!compiled.snapshot.renderedWorkingSet.includes("商会销毁副册"));
assert.ok(compiled.report.dropped.some((item) => item.itemId === "private-xunfu" && item.reason === "ACL_DENIED"));
assert.ok(compiled.report.aclDecisionHash.length === 64);

// CTX-002: commitments, conditions and unanswered interactions are authoritative prompt inputs.
for (const sourceType of ["COMMITMENT", "ACTIVE_CONDITION", "UNANSWERED_INTERACTION"] as const) {
  assert.ok(compiled.snapshot.items.some((item) => item.sourceType === sourceType), `${sourceType} missing`);
}
assert.ok(compiled.snapshot.renderedWorkingSet.includes("不把他的名字写进公开回文"));
assert.ok(compiled.snapshot.renderedWorkingSet.includes("把经手簿转交按察司副使"));
assert.ok(compiled.snapshot.renderedWorkingSet.includes("是否接受联合复核"));

// CTX-003: Recent Canon is included as complete, ordered prose rather than a truncated summary.
assert.deepEqual(compiled.snapshot.recentCanon.map((item) => item.content), [recentCanonOne, recentCanonTwo]);
assert.ok(compiled.snapshot.renderedWorkingSet.includes(recentCanonOne));
assert.ok(compiled.snapshot.renderedWorkingSet.includes(recentCanonTwo));
assert.deepEqual(compiled.report.truncated, []);

// A different role compiles a different ACL result from the same source pool.
const xunfuCompiled = compileStoryContextV2({
  ...compileInput,
  identity: { ...identity, roleId: "role-xunfu", actorTurnId: "turn-xunfu-1" },
  audience: { ...audience, roleName: "浙江巡抚", privateGoal: "查明总督拖延的真实意图" },
  requiredSourceTypes: [],
  maxTokenEstimate: 800
});
assert.equal(xunfuCompiled.ok, true);
if (!xunfuCompiled.ok) throw new Error("xunfu context unexpectedly rejected");
assert.ok(xunfuCompiled.snapshot.renderedWorkingSet.includes("商会销毁副册"));
assert.ok(!xunfuCompiled.snapshot.renderedWorkingSet.includes("原始田册已成功封存"));
assert.notEqual(xunfuCompiled.snapshot.identity.snapshotHash, compiled.snapshot.identity.snapshotHash);

// CTX-004: mandatory context never disappears silently when the budget is too small.
const rejected = compileStoryContextV2({ ...compileInput, maxTokenEstimate: 8 });
assert.equal(rejected.ok, false);
assert.ok(rejected.report.issueCodes.includes("P0_CONTEXT_BUDGET_EXCEEDED"));
assert.ok(rejected.report.dropped.some((item) => item.reason === "P0_BUDGET_EXCEEDED"));
assert.equal(rejected.report.snapshotHash, null);

// Non-critical material is dropped as a whole item; it is never cut in the middle.
const p0Only = [
  ...baseSources.filter((item) => item.priority === "P0"),
  { ...baseSources.find((item) => item.itemId === "canon-2")!, priority: "P0" as const, mustPreserve: true }
];
const p0Compiled = compileStoryContextV2({ ...compileInput, sources: p0Only, maxTokenEstimate: 2_000 });
assert.equal(p0Compiled.ok, true);
if (!p0Compiled.ok) throw new Error("P0 context unexpectedly rejected");
const veryLongOptional = source("long-atmosphere", "OPEN_THREAD", "旧案卷的灰尘与雨声。".repeat(300), {
  priority: "P3",
  mustPreserve: false,
  visibility: "PUBLIC",
  knownByRoleIds: []
});
const optionalDropped = compileStoryContextV2({
  ...compileInput,
  sources: [...p0Only, veryLongOptional],
  maxTokenEstimate: p0Compiled.report.budgets.total.used + 10
});
assert.equal(optionalDropped.ok, true);
if (!optionalDropped.ok) throw new Error("optional context should not fail closed");
assert.ok(optionalDropped.report.dropped.some((item) => item.itemId === "long-atmosphere" && item.reason === "BUDGET_EXHAUSTED"));
assert.ok(!optionalDropped.snapshot.renderedWorkingSet.includes("旧案卷的灰尘"));
assert.deepEqual(optionalDropped.report.truncated, []);

// CTX-005/006: stable inputs yield a stable hash; a material fact or authority change supersedes it.
const reordered = compileStoryContextV2({ ...compileInput, sources: [...baseSources].reverse() });
assert.equal(reordered.ok, true);
if (!reordered.ok) throw new Error("reordered context unexpectedly rejected");
assert.equal(reordered.snapshot.identity.snapshotHash, compiled.snapshot.identity.snapshotHash);
const changed = compileStoryContextV2({
  ...compileInput,
  sources: baseSources.map((item) => item.itemId === "resolution" ? { ...item, content: `${item.content} 经手簿已被证实为真。` } : item)
});
assert.equal(changed.ok, true);
if (!changed.ok) throw new Error("changed context unexpectedly rejected");
assert.notEqual(changed.snapshot.identity.snapshotHash, compiled.snapshot.identity.snapshotHash);
assert.deepEqual(validateStoryContextFreshnessV2(compiled.snapshot, identity), { status: "CURRENT", reasons: [] });
assert.deepEqual(validateStoryContextFreshnessV2(compiled.snapshot, { ...identity, worldSequence: 8 }), {
  status: "SUPERSEDED",
  reasons: ["WORLD_SEQUENCE_CHANGED"]
});

console.log("continuous story v2 context compiler: PASS");
