import assert from "node:assert/strict";
import { compileSoloStoryContext } from "../context-compiler";
import { validateStoryTurnOutput } from "../output-validator";
import { normalizePlayerIntent } from "../player-intent";
import { arbitratePlayerIntent } from "../rules-arbiter";
import { validatePlayerIntent } from "../local-validator";
import { baseCanon, baseCards, baseFacts, basePending, basePressures, baseRole, baseScene, baseTargets, validModelOutput } from "./helpers";
import { buildSoloStoryTurnPrompt } from "../prompt-builder";
import { parseStoryTurnOutput } from "../output-parser";

const normalized = normalizePlayerIntent({
  source: "CUSTOM",
  text: "派亲随去清流县档房封存现场并查勘潜入痕迹。"
});
assert.equal(normalized.ok, true);
if (!normalized.ok) throw new Error("normalization failed");
const validation = validatePlayerIntent(normalized.intent, baseRole());
assert.equal(validation.ok, true);
if (!validation.ok) throw new Error("validation failed");
const resolution = arbitratePlayerIntent({ role: baseRole(), intent: normalized.intent, validation });
const compiled = compileSoloStoryContext({
  role: baseRole(),
  scene: baseScene(),
  facts: baseFacts(),
  recentCanon: baseCanon(),
  pendingConsequences: basePending(),
  activePressures: basePressures(),
  relevantScriptCards: baseCards(),
  actionResolution: resolution,
  playerIntent: normalized.intent,
  availableTargets: baseTargets(),
  maxTokenEstimate: 6_000
});
assert.equal(compiled.ok, true);
if (!compiled.ok) throw new Error("compile failed");
for (const target of baseTargets()) {
  assert.ok(compiled.context.allowedReferences.groundingIds.includes(target.id), `scene target ${target.id} must be valid grounding`);
}

assert.ok(compiled.context.renderedWorkingSet.includes("档房潜入一事必须在下一段剧情里出现实际回响"));
const compactPrompt = buildSoloStoryTurnPrompt(compiled.context);
assert.match(compactPrompt.systemPrompt, /2400 tokens 以内/);
assert.match(compactPrompt.systemPrompt, /只生成 2 个决策/);
assert.match(compactPrompt.systemPrompt, /绝不能.*截断 JSON/);
assert.ok(compiled.context.renderedWorkingSet.includes("总督刚收起便条"));
assert.ok(!compiled.context.renderedWorkingSet.includes("提前转移副本"));
assert.ok(compiled.context.renderedWorkingSet.endsWith(`【玩家行动】${normalized.intent.userFacingText}`));

const paidConsequences = ["pending_1", ...resolution.pendingConsequences.map((item) => item.consequenceId)];
const parsed = parseStoryTurnOutput(validModelOutput(resolution.resolutionId, paidConsequences));
const withoutSchemaVersion = JSON.parse(validModelOutput(resolution.resolutionId, paidConsequences));
delete withoutSchemaVersion.schemaVersion;
const missingSchemaValidated = validateStoryTurnOutput(parseStoryTurnOutput(JSON.stringify(withoutSchemaVersion)), compiled.context);
assert.equal(missingSchemaValidated.ok, false, "缺少协议版本不得被本地补写");

const wrongSchemaVersion = JSON.parse(validModelOutput(resolution.resolutionId, paidConsequences));
wrongSchemaVersion.schemaVersion = "wrong_story_contract";
const wrongSchemaValidated = validateStoryTurnOutput(parseStoryTurnOutput(JSON.stringify(wrongSchemaVersion)), compiled.context);
assert.equal(wrongSchemaValidated.ok, false);
if (wrongSchemaValidated.ok) throw new Error("wrong schema failure expected");
assert.ok(wrongSchemaValidated.issues.some((issue) => issue.code === "OUTPUT_SCHEMA_VERSION_INVALID"));

if (parsed.resultType !== "PUBLISHED_TURN") throw new Error("published output expected");
const badGrounding = {
  ...parsed,
  grounding: {
    ...parsed.grounding,
    usedCanonFactIds: ["fact_archive_breakin", "unknown:id"]
  }
};
const validated = validateStoryTurnOutput(badGrounding, compiled.context);
assert.equal(validated.ok, false);

const conciseIntentOutput = parseStoryTurnOutput(validModelOutput(resolution.resolutionId, paidConsequences));
if (conciseIntentOutput.resultType !== "PUBLISHED_TURN") throw new Error("published output expected");
conciseIntentOutput.decisions[0]!.intent = "先问县令";
const conciseIntentValidated = validateStoryTurnOutput(conciseIntentOutput, compiled.context);
assert.equal(conciseIntentValidated.ok, true, "简短但明确的真实意图不应被字数门禁误杀");

const missingIntentOutput = parseStoryTurnOutput(validModelOutput(resolution.resolutionId, paidConsequences));
if (missingIntentOutput.resultType !== "PUBLISHED_TURN") throw new Error("published output expected");
missingIntentOutput.decisions[0]!.intent = "";
const missingIntentValidated = validateStoryTurnOutput(missingIntentOutput, compiled.context);
assert.equal(missingIntentValidated.ok, false);
if (missingIntentValidated.ok) throw new Error("missing intent failure expected");
assert.ok(missingIntentValidated.issues.some((issue) => issue.code === "DECISION_INTENT_REQUIRED"));

const budgetFail = compileSoloStoryContext({
  role: baseRole(),
  scene: baseScene(),
  facts: baseFacts(),
  recentCanon: baseCanon(),
  pendingConsequences: basePending(),
  activePressures: basePressures(),
  relevantScriptCards: baseCards(),
  actionResolution: resolution,
  playerIntent: normalized.intent,
  availableTargets: baseTargets(),
  maxTokenEstimate: 20
});
assert.equal(budgetFail.ok, false);
if (budgetFail.ok) throw new Error("budget fail expected");
assert.equal(budgetFail.code, "P0_CONTEXT_BUDGET_EXCEEDED");

console.log("solo story engine context and grounding: PASS");
