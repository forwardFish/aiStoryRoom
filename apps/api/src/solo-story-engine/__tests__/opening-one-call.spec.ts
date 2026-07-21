import assert from "node:assert/strict";
import { executeSoloStoryOpening } from "../single-call-executor";
import { baseCanon, baseCards, baseFacts, basePending, basePressures, baseRole, baseScene, baseTargets, transportWith, validModelOutput } from "./helpers";

void (async () => {
  const validCalls = { count: 0 };
  const validOpeningObject = JSON.parse(validModelOutput("opening:opening:sangtian"));
  validOpeningObject.story = {
    title: "案角的两封急报",
    resultNarrative: "五月初八午后，杭州总督府内厅闷得听得见窗外蝉声。巡抚送来的催办公文压在案角，另一边是清流县档房遇人潜入的急报。门外差役再次低声催问，巡抚衙门来人仍站在廊下等一句答复；案前无人敢先开口。",
    nextSituationNarrative: "巡抚来人仍在廊下候着，清流县急报只说县册可能被人动过，没有指出是谁。浙江总督必须决定先问催办来意，还是先保住档房现场。"
  };
  const validOpening = JSON.stringify(validOpeningObject);
  const opening = await executeSoloStoryOpening({
    attemptId: "opening-attempt",
    role: baseRole(),
    scene: baseScene(),
    facts: baseFacts(),
    recentCanon: baseCanon(),
    pendingConsequences: basePending(),
    activePressures: basePressures(),
    relevantScriptCards: baseCards(),
    availableTargets: baseTargets(),
    openingTrigger: { triggerId: "opening:sangtian", summary: "从总督府内厅开始，外部压力已经送到案前，浙江总督尚未作答。" },
    transport: transportWith(validOpening, validCalls)
  });
  assert.equal(opening.ok, true, JSON.stringify(opening));
  assert.equal(validCalls.count, 1);
  assert.equal(opening.attempt.providerCallCount, 1);
  assert.equal(opening.playerIntent, null);
  assert.match(opening.prompt.userPrompt.trim().split("\n").at(-1) || "", /OPENING_TRIGGER_JSON/);

  const agencyCalls = { count: 0 };
  const stealsAgency = await executeSoloStoryOpening({
    attemptId: "opening-agency-attempt",
    role: baseRole(),
    scene: baseScene(),
    facts: baseFacts(),
    recentCanon: baseCanon(),
    pendingConsequences: basePending(),
    activePressures: basePressures(),
    relevantScriptCards: baseCards(),
    availableTargets: baseTargets(),
    openingTrigger: { triggerId: "opening:sangtian", summary: "浙江总督尚未作答。" },
    transport: transportWith(validModelOutput("opening:opening:sangtian"), agencyCalls)
  });
  assert.equal(stealsAgency.ok, true, "玩家主权的细微语义不能由正则冒充确定性硬门禁");
  assert.equal(agencyCalls.count, 1);

  const inventedPrehistoryCalls = { count: 0 };
  const inventedPrehistoryOutput = JSON.parse(validOpening);
  inventedPrehistoryOutput.story.resultNarrative = inventedPrehistoryOutput.story.resultNarrative.replace(
    "门外差役再次低声催问",
    "你此前派去清流县的亲随已经折返，门外差役再次低声催问"
  );
  const inventedPrehistory = await executeSoloStoryOpening({
    attemptId: "opening-invented-prehistory-attempt",
    role: baseRole(),
    scene: baseScene(),
    facts: baseFacts(),
    recentCanon: baseCanon(),
    pendingConsequences: basePending(),
    activePressures: basePressures(),
    relevantScriptCards: baseCards(),
    availableTargets: baseTargets(),
    openingTrigger: { triggerId: "opening:sangtian", summary: "浙江总督尚未作答。" },
    transport: transportWith(JSON.stringify(inventedPrehistoryOutput), inventedPrehistoryCalls)
  });
  assert.equal(inventedPrehistory.ok, true, "无结构化事实冲突时应进入软质量审查，而不是关键词拒绝");
  assert.equal(inventedPrehistoryCalls.count, 1);

  const capabilityStatementCalls = { count: 0 };
  const capabilityStatementOutput = JSON.parse(validOpening);
  capabilityStatementOutput.story.resultNarrative = capabilityStatementOutput.story.resultNarrative.replace(
    "案前无人敢先开口。",
    "你有权调卷，也能派亲随查验档房，但案前无人敢先开口。"
  );
  const capabilityStatement = await executeSoloStoryOpening({
    attemptId: "opening-capability-statement-attempt",
    role: baseRole(),
    scene: baseScene(),
    facts: baseFacts(),
    recentCanon: baseCanon(),
    pendingConsequences: basePending(),
    activePressures: basePressures(),
    relevantScriptCards: baseCards(),
    availableTargets: baseTargets(),
    openingTrigger: { triggerId: "opening:sangtian", summary: "浙江总督尚未作答。" },
    transport: transportWith(JSON.stringify(capabilityStatementOutput), capabilityStatementCalls)
  });
  assert.equal(capabilityStatement.ok, true, JSON.stringify(capabilityStatement));
  assert.equal(capabilityStatementCalls.count, 1);

  console.log("solo story engine opening one-call: PASS");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
