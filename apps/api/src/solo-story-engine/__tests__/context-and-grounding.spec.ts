import assert from "node:assert/strict";
import { compileSoloStoryContext } from "../context-compiler";
import { buildSoloDecisionPrompt } from "../decision-prompt-builder";
import { validatePlayerIntent } from "../local-validator";
import { buildSoloNarratorPrompt } from "../narrator-prompt-builder";
import { parseDecisionCopyOutput, parseNarratorDraft } from "../output-parser";
import { normalizePlayerIntent } from "../player-intent";
import { arbitratePlayerIntent } from "../rules-arbiter";
import {
  baseCanon,
  baseCards,
  baseFacts,
  basePending,
  basePressures,
  baseRole,
  baseScene,
  baseTargets,
  validDecisionOutput,
  validNarratorProse
} from "./helpers";

const normalized = normalizePlayerIntent({
  source: "CUSTOM",
  text: "派亲随去清流县档房封存现场并查勘潜入痕迹。"
});
assert.equal(normalized.ok, true);
if (!normalized.ok) throw new Error("normalization failed");
const localValidation = validatePlayerIntent(normalized.intent, baseRole());
assert.equal(localValidation.ok, true);
if (!localValidation.ok) throw new Error("validation failed");
const resolution = arbitratePlayerIntent({
  role: baseRole(),
  intent: normalized.intent,
  validation: localValidation
});
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
assert.equal(
  compiled.context.sections.recentCanon.items.at(-1)?.entryId,
  "canon_1",
  "the latest formally published canon must never be silently dropped"
);

for (const target of baseTargets()) {
  assert.ok(compiled.context.allowedReferences.groundingIds.includes(target.id));
}
assert.ok(compiled.context.renderedWorkingSet.includes("档房潜入一事"));
assert.ok(!compiled.context.renderedWorkingSet.includes("提前转移副本"));

const narratorPrompt = buildSoloNarratorPrompt(compiled.context);
assert.equal(narratorPrompt.responseMode, "TEXT");
assert.equal("decisions" in narratorPrompt.outputSchema, false);
assert.doesNotMatch(narratorPrompt.systemPrompt, /LEGAL_NEXT_DECISION_SEEDS|routeKey|affordanceTemplateId/);
assert.doesNotMatch(narratorPrompt.userPrompt, /LEGAL_NEXT_DECISION_SEEDS|routeKey|affordanceTemplateId/);
assert.ok(!narratorPrompt.userPrompt.includes(resolution.resolutionId));
assert.ok(!narratorPrompt.userPrompt.includes("fact_archive_breakin"));
assert.match(narratorPrompt.systemPrompt, /只输出正文纯文本/);
assert.match(narratorPrompt.systemPrompt, /不得新增事实、证据、人物、承诺或下一步决定/);

const draft = parseNarratorDraft(validNarratorProse());
const decisionPrompt = buildSoloDecisionPrompt(compiled.context, draft);
assert.equal(decisionPrompt.responseMode, "JSON");
assert.match(decisionPrompt.userPrompt, new RegExp(escapeRegExp(draft.rawProse)));
assert.match(decisionPrompt.userPrompt, /target:ROLE:xunfu:1/);
assert.match(decisionPrompt.userPrompt, /target:LOCATION:archive_room:2/);
assert.doesNotMatch(decisionPrompt.userPrompt, /stateEffects|statePatch|expectedCountermove/);
assert.deepEqual(
  parseDecisionCopyOutput(validDecisionOutput()).decisions.map((decision) => decision.routeKey),
  ["target:ROLE:xunfu:1", "target:LOCATION:archive_room:2"]
);

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
if (budgetFail.ok) throw new Error("budget failure expected");
assert.equal(budgetFail.code, "P0_CONTEXT_BUDGET_EXCEEDED");

const narrativePlanMarker = "NARRATIVE_PLAN_VISIBLE_TO_WRITER";
const serverOnlyAuditMarker = `SERVER_ONLY_AUDIT_${"x".repeat(30_000)}`;
const projectedSettlement = {
  event: {
    eventId: "event_projection_budget",
    narrativePlan: { dramaticTask: narrativePlanMarker },
    statePatch: { auditPayload: serverOnlyAuditMarker }
  }
} as unknown as import("@ai-story/templates").PartOneActionSettlement;
const projectedSettlementContext = compileSoloStoryContext({
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
  partOneSettlement: projectedSettlement,
  maxTokenEstimate: 6_000
});
assert.equal(
  projectedSettlementContext.ok,
  true,
  "server-only settlement metadata must not consume the Narrator projection budget"
);
if (!projectedSettlementContext.ok) throw new Error("projected settlement compile failed");
assert.match(projectedSettlementContext.context.renderedWorkingSet, new RegExp(narrativePlanMarker));
assert.doesNotMatch(projectedSettlementContext.context.renderedWorkingSet, /SERVER_ONLY_AUDIT_/);
assert.ok(
  projectedSettlementContext.context.included.find((item) => item.itemId === "part-one-event:event_projection_budget")!.tokenEstimate < 100,
  "the context report must budget the same compact projection used by the Writer"
);

console.log("solo two-stage context isolation and grounding: PASS");

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
