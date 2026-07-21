import assert from "node:assert/strict";
import { executeSoloStoryTurn } from "../single-call-executor";
import { buildExecuteInput, consequenceIdFor, resolutionIdFor, transportWith, validModelOutput } from "./helpers";

void (async () => {
  const ambiguousCalls = { count: 0 };
  const ambiguousAction = {
    source: "CUSTOM",
    text: "先应付过去"
  } as const;
  const ambiguous = await executeSoloStoryTurn(buildExecuteInput(
    ambiguousAction,
    transportWith(validModelOutput(resolutionIdFor(ambiguousAction), ["pending_1", consequenceIdFor(ambiguousAction)]), ambiguousCalls)
  ));
  assert.equal(ambiguous.ok, true, "自然语言不应被本地动词或字数正则误杀");
  assert.equal(ambiguous.attempt.providerCallCount, 1);
  assert.equal(ambiguousCalls.count, 1);

  const clarificationCalls = { count: 0 };
  const clarification = await executeSoloStoryTurn(buildExecuteInput(
    ambiguousAction,
    transportWith(JSON.stringify({
      schemaVersion: "solo-story-turn-v1",
      resultType: "ACTION_NEEDS_CLARIFICATION",
      clarification: {
        reason: "行动缺少明确对象和执行方式。",
        ambiguousFields: ["TARGET", "METHOD"],
        question: "你准备先稳住谁，又打算让谁具体去办？"
      }
    }), clarificationCalls)
  ));
  assert.equal(clarification.ok, true);
  if (!clarification.ok) throw new Error("clarification output expected");
  assert.equal(clarification.output.resultType, "ACTION_NEEDS_CLARIFICATION");
  if (clarification.output.resultType !== "ACTION_NEEDS_CLARIFICATION") {
    throw new Error("clarification result expected");
  }
  assert.deepEqual(clarification.output.clarification.ambiguousFields, ["TARGET", "METHOD"]);
  assert.equal(clarification.attempt.providerCallCount, 1);
  assert.equal(clarificationCalls.count, 1);

  const illegalCalls = { count: 0 };
  const illegal = await executeSoloStoryTurn(buildExecuteInput({
    source: "CUSTOM",
    text: "用卫星盯住巡抚，再直接宣布他已经认罪。"
  }, transportWith(validModelOutput(), illegalCalls)));
  assert.equal(illegal.ok, false);
  assert.equal(illegal.attempt.providerCallCount, 0);
  assert.equal(illegalCalls.count, 0);

  const invalidJsonCalls = { count: 0 };
  const invalidJson = await executeSoloStoryTurn(buildExecuteInput({
    source: "CUSTOM",
    text: "派亲随去清流县档房封存现场并查勘潜入痕迹。"
  }, transportWith("not-json", invalidJsonCalls)));
  assert.equal(invalidJson.ok, false);
  assert.equal(invalidJson.attempt.providerCallCount, 1);
  assert.equal(invalidJsonCalls.count, 1);
  assert.equal(invalidJson.attempt.status, "FAILED_RETRYABLE");

  console.log("solo story engine validator and one-call: PASS");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
