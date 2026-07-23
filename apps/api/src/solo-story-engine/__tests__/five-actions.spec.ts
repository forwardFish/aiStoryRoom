import assert from "node:assert/strict";
import test from "node:test";
import { executeSoloStoryTurn } from "../two-stage-executor";
import { buildExecuteInput, transportWith } from "./helpers";

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
  test(`${action.source} 独立行动依次调用 Narrator 和 Decision`, async () => {
    const calls = { count: 0, stages: [] as string[] };
    const result = await executeSoloStoryTurn(buildExecuteInput(
      action,
      transportWith({}, calls)
    ));
    assert.equal(result.ok, true, `${action.source} should close the same chain`);
    if (!result.ok) return;
    assert.equal(result.attempt.providerCallCount, 2);
    assert.equal(result.attempt.narrationProviderCallCount, 1);
    assert.equal(result.attempt.decisionProviderCallCount, 1);
    assert.equal(calls.count, 2);
    assert.deepEqual(calls.stages, ["NARRATOR", "DECISION"]);
    assert.ok(result.context.renderedWorkingSet.endsWith(`【玩家行动】${result.playerIntent.userFacingText}`));
    assert.equal(result.actionResolution.actionType, action.source);
    assert.equal(result.output.resultType, "PUBLISHED_TURN");
    if (result.output.resultType !== "PUBLISHED_TURN") return;
    assert.ok(result.output.story.resultNarrative.length >= 80, "must return a readable action result story");
    assert.ok(result.output.story.nextSituationNarrative.length >= 30, "must return a concrete next situation scene");
    assert.equal(result.output.decisions.length, 2, "must return exactly two next decisions");
    assert.equal(new Set(result.output.decisions.map((decision) => decision.description)).size, 2, "next decisions must not repeat");
    for (const decision of result.output.decisions) {
      assert.ok(decision.description.length >= 8, "the only player-facing copy must be readable");
      assert.ok(decision.method.length >= 8, "next decision must describe a concrete method");
      assert.ok(decision.concreteCost.length >= 6, "next decision must carry a concrete cost");
    }
    assert.equal(
      `${result.output.story.resultNarrative}\n\n${result.output.story.nextSituationNarrative}`,
      result.narratorProvider.rawText,
      "the server must publish the narrator prose without rewriting it"
    );
  });
}
