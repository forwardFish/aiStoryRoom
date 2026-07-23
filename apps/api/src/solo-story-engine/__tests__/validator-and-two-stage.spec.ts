import assert from "node:assert/strict";
import { executeSoloStoryTurn } from "../two-stage-executor";
import {
  buildExecuteInput,
  transportWith,
  validDecisionOutput,
  validNarratorProse
} from "./helpers";

void (async () => {
  const action = {
    source: "CUSTOM",
    text: "暂不签发放行文书，留下巡抚书吏，同时核对密信中指出的县册疑点。"
  } as const;

  const successCalls = { count: 0, stages: [] as string[] };
  const success = await executeSoloStoryTurn(buildExecuteInput(
    action,
    transportWith({
      narrator: validNarratorProse(),
      decision: validDecisionOutput()
    }, successCalls)
  ));
  assert.equal(success.ok, true);
  if (!success.ok) throw new Error("successful two-stage output expected");
  assert.equal(success.attempt.providerCallCount, 2);
  assert.deepEqual(successCalls.stages, ["NARRATOR", "DECISION"]);

  const illegalCalls = { count: 0, stages: [] as string[] };
  const illegal = await executeSoloStoryTurn(buildExecuteInput({
    source: "CUSTOM",
    text: "用卫星盯住巡抚，再直接宣布他已经认罪。"
  }, transportWith({}, illegalCalls)));
  assert.equal(illegal.ok, false);
  assert.equal(illegal.attempt.providerCallCount, 0);
  assert.equal(illegalCalls.count, 0);

  const narratorFailureCalls = { count: 0, stages: [] as string[] };
  const narratorFailure = await executeSoloStoryTurn(buildExecuteInput(
    action,
    transportWith({ narrator: "这不是三至八段的合格正文。" }, narratorFailureCalls)
  ));
  assert.equal(narratorFailure.ok, false);
  assert.equal(narratorFailure.attempt.providerCallCount, 1);
  assert.deepEqual(narratorFailureCalls.stages, ["NARRATOR"]);
  if (narratorFailure.ok) throw new Error("narrator failure expected");
  assert.equal(narratorFailure.failedStage, "NARRATOR");

  const decisionFailureCalls = { count: 0, stages: [] as string[] };
  const decisionFailure = await executeSoloStoryTurn(buildExecuteInput(
    action,
    transportWith({
      narrator: validNarratorProse(),
      decision: JSON.stringify({
        decisions: [{
          routeKey: "invented-route",
          description: "随便处理当前事情就可以了。"
        }]
      })
    }, decisionFailureCalls)
  ));
  assert.equal(decisionFailure.ok, false);
  assert.equal(decisionFailure.attempt.providerCallCount, 2);
  assert.deepEqual(decisionFailureCalls.stages, ["NARRATOR", "DECISION"]);
  if (decisionFailure.ok) throw new Error("decision failure expected");
  assert.equal(decisionFailure.failedStage, "DECISION");
  assert.equal(decisionFailure.decisionProvider?.rawText.includes("invented-route"), true);

  console.log("solo story engine two-stage validation: PASS");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
