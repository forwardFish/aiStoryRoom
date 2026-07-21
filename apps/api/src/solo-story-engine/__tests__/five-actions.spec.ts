import assert from "node:assert/strict";
import test from "node:test";
import { executeSoloStoryTurn } from "../single-call-executor";
import { buildExecuteInput, consequenceIdFor, resolutionIdFor, transportWith, validModelOutput } from "./helpers";

const actions = [
  {
    source: "RECOMMENDED" as const,
    decisionId: "rec_1",
    label: "先封存档房，再盯住巡抚来往副本",
    targetId: "archive_room",
    targetLabel: "清流县田契档房",
    actionText: "派亲随携总督令牌赶赴清流县田契档房，封存现场并查勘潜入痕迹。"
  },
  {
    source: "TALK" as const,
    personId: "xunfu",
    personName: "浙江巡抚",
    prompt: "请巡抚留在内厅，当面对照两份催办公文的递送时间和经手人。"
  },
  {
    source: "INVESTIGATE" as const,
    locationId: "archive_room",
    locationName: "清流县田契档房",
    task: "派两名亲随先去档房查门栓、脚印和更换过的封条，再回报。"
  },
  {
    source: "USE_LEVERAGE" as const,
    leverageKey: "asset:governor_seal",
    leverageLabel: "总督印信",
    targetId: "xunfu",
    targetLabel: "浙江巡抚",
    task: "用总督印信发出急令，要求巡抚衙门立刻交出今日往来副本备查。"
  },
  {
    source: "CUSTOM" as const,
    text: "派亲随先去清流县档房盯住封条，再把昨夜值守书吏悄悄带来问话。"
  }
];

for (const action of actions) {
  test(`${action.source} 独立行动只调用一次模型并返回下一剧情和下一组决策`, async () => {
    const calls = { count: 0 };
    const result = await executeSoloStoryTurn(buildExecuteInput(action, transportWith(validModelOutput(resolutionIdFor(action), ["pending_1", consequenceIdFor(action)]), calls)));
    assert.equal(result.ok, true, `${action.source} should close the same chain`);
    if (!result.ok) return;
    assert.equal(result.attempt.providerCallCount, 1);
    assert.equal(calls.count, 1);
    assert.ok(result.context.renderedWorkingSet.endsWith(`【玩家行动】${result.playerIntent.userFacingText}`));
    assert.equal(result.actionResolution.actionType, action.source);
    assert.equal(result.output.resultType, "PUBLISHED_TURN");
    if (result.output.resultType !== "PUBLISHED_TURN") return;
    assert.ok(result.output.story.resultNarrative.length >= 80, "must return a readable action result story");
    assert.ok(result.output.story.nextSituationNarrative.length >= 80, "must return the next situation story");
    assert.ok(result.output.decisions.length >= 2 && result.output.decisions.length <= 4, "must return 2-4 next decisions");
    assert.equal(new Set(result.output.decisions.map((decision) => decision.label)).size, result.output.decisions.length, "next decisions must not repeat");
    for (const decision of result.output.decisions) {
      assert.ok(decision.label.length >= 8, "next decision must be readable rather than a generic token");
      assert.ok(decision.method.length >= 8, "next decision must describe a concrete method");
      assert.ok(decision.concreteCost.length >= 6, "next decision must carry a concrete cost");
    }
  });
}
