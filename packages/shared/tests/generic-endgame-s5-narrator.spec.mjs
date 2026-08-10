import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  NARRATED_ENDING_SCHEMA_VERSION,
  buildConfigDrivenEndingNarratorPromptV1,
  narrateConfigDrivenEndingV1,
  renderConfigDrivenEndingFallbackV1,
  validateNarratedEndingV1
} from "../src/endgame/config-driven-ending-narrator-v1.mjs";
import {
  clone,
  compileRoute,
  neutral
} from "./generic-endgame-s4-details-fixture.mjs";

const route = compileRoute(neutral, { runId: "run-neutral-s5" });
const input = {
  runPackageBinding: route.binding,
  adjudication: route.adjudication,
  blueprint: route.blueprint
};

function validNarrative() {
  const worldAxis = route.blueprint.resolvedAxes.find((axis) => axis.axisId === "world_outcome");
  const fateAxis = route.blueprint.resolvedAxes.find((axis) => axis.axisId === "protagonist_fate");
  const scene = route.blueprint.slots.scene_anchor[0];
  const cost = route.blueprint.slots.dominant_cost[0];
  const hook = route.blueprint.slots.unresolved_hooks[0];
  const padding = "眼前形成的结果仍要经受新的压力，所有已经付出的代价都留在现场，接下来的选择不能脱离这些真实痕迹。";
  return {
    schemaVersion: NARRATED_ENDING_SCHEMA_VERSION,
    paragraphs: [
      {
        paragraphId: "world",
        purpose: "WORLD_RESULT",
        text: `${scene.text}。${worldAxis.summary}。${padding}`,
        factRefs: [...scene.evidenceRefs]
      },
      {
        paragraphId: "fate",
        purpose: "PROTAGONIST_RESULT",
        text: `${cost.text}。${fateAxis.summary}。${padding}`,
        factRefs: [...cost.evidenceRefs]
      },
      {
        paragraphId: "open",
        purpose: "UNRESOLVED_HOOK",
        text: `${hook.text}。${padding}`,
        factRefs: [...hook.evidenceRefs]
      }
    ]
  };
}

function validate(narratedEnding) {
  return validateNarratedEndingV1({ ...input, narratedEnding });
}

function expectCode(fn, code) {
  assert.throws(fn, (error) => {
    assert.equal(error?.code, code, error?.stack ?? String(error));
    return true;
  });
}

test("S5 builds a closed configuration-driven prompt", () => {
  const prompt = buildConfigDrivenEndingNarratorPromptV1(input);
  assert.equal(prompt.payload.scope, "PART");
  assert.deepEqual(prompt.payload.allowedFactRefs, route.blueprint.allowedFactRefs);
  assert.deepEqual(prompt.payload.resolvedAxes, route.blueprint.resolvedAxes);
  assert.deepEqual(prompt.payload.finalMetrics, route.adjudication.finalMetrics);
  assert.equal(prompt.payload.contract.paragraphPlan.length, 3);
  assert.match(prompt.system, /Do not create facts/);
});

test("S5 prompt is deeply frozen", () => {
  const prompt = buildConfigDrivenEndingNarratorPromptV1(input);
  assert.equal(Object.isFrozen(prompt), true);
  assert.equal(Object.isFrozen(prompt.payload), true);
  assert.equal(Object.isFrozen(prompt.payload.paragraphPlan), true);
});

test("S5 validates an authoritative structured ending", () => {
  const output = validate(validNarrative());
  assert.deepEqual(output, validNarrative());
  assert.equal(Object.isFrozen(output), true);
  assert.equal(Object.isFrozen(output.paragraphs[0]), true);
});

const closedContractCases = [
  ["unknown schema", "ENDGAME_NARRATIVE_SCHEMA_VERSION", (value) => { value.schemaVersion = "unknown"; }],
  ["unknown top-level field", "ENDGAME_NARRATIVE_CLOSED_OBJECT_VIOLATION", (value) => { value.extra = true; }],
  ["missing paragraphs", "ENDGAME_NARRATIVE_CLOSED_OBJECT_VIOLATION", (value) => { delete value.paragraphs; }],
  ["too few paragraphs", "ENDGAME_NARRATIVE_PARAGRAPH_COUNT", (value) => { value.paragraphs.pop(); }],
  ["unknown paragraph field", "ENDGAME_NARRATIVE_CLOSED_OBJECT_VIOLATION", (value) => { value.paragraphs[0].extra = true; }],
  ["wrong paragraph id", "ENDGAME_NARRATIVE_PARAGRAPH_PLAN_MISMATCH", (value) => { value.paragraphs[0].paragraphId = "other"; }],
  ["wrong paragraph purpose", "ENDGAME_NARRATIVE_PARAGRAPH_PLAN_MISMATCH", (value) => { value.paragraphs[0].purpose = "CUSTOM"; }],
  ["blank text", "ENDGAME_NARRATIVE_TEXT_INVALID", (value) => { value.paragraphs[0].text = ""; }],
  ["untrimmed text", "ENDGAME_NARRATIVE_TEXT_INVALID", (value) => { value.paragraphs[0].text += " "; }],
  ["non-array fact refs", "ENDGAME_NARRATIVE_FACT_REFS_INVALID", (value) => { value.paragraphs[0].factRefs = "bad"; }],
  ["duplicate fact refs", "ENDGAME_NARRATIVE_FACT_REF_DUPLICATE", (value) => { value.paragraphs[0].factRefs.push(value.paragraphs[0].factRefs[0]); }],
  ["unknown fact ref", "ENDGAME_NARRATIVE_FACT_REF_NOT_ALLOWED", (value) => { value.paragraphs[0].factRefs = ["unknown-fact"]; }]
];

for (const [name, code, mutate] of closedContractCases) {
  test(`S5 fails closed for ${name}`, () => {
    const value = validNarrative();
    mutate(value);
    expectCode(() => validate(value), code);
  });
}

test("S5 requires factRefs for non-atmosphere paragraphs", () => {
  const value = validNarrative();
  value.paragraphs[0].factRefs = [];
  expectCode(() => validate(value), "ENDGAME_NARRATIVE_FACT_REF_REQUIRED");
});

test("S5 requires a visible anchor for each required slot", () => {
  const value = validNarrative();
  value.paragraphs[0].text = value.paragraphs[0].text.replace(route.blueprint.slots.scene_anchor[0].text, "现场仍在");
  expectCode(() => validate(value), "ENDGAME_NARRATIVE_REQUIRED_SLOT_UNMENTIONED");
});

test("S5 requires each configured resolved axis", () => {
  const value = validNarrative();
  const summary = route.blueprint.resolvedAxes.find((axis) => axis.axisId === "world_outcome").summary;
  value.paragraphs[0].text = value.paragraphs[0].text.replace(summary, "局面暂时如此");
  expectCode(() => validate(value), "ENDGAME_NARRATIVE_REQUIRED_AXIS_UNMENTIONED");
});

test("S5 rejects package-forbidden phrases", () => {
  const value = validNarrative();
  value.paragraphs[0].text += neutral.narrative.forbiddenPhrases[0];
  expectCode(() => validate(value), "ENDGAME_NARRATIVE_FORBIDDEN_PHRASE");
});

for (const leaked of ["packageHash", "endingFingerprint", "metricId", "factId", "outcomeId", "Prompt", "Reviewer"]) {
  test(`S5 rejects internal field leak ${leaked}`, () => {
    const value = validNarrative();
    value.paragraphs[0].text += leaked;
    expectCode(() => validate(value), "ENDGAME_NARRATIVE_INTERNAL_FIELD_LEAK");
  });
}

const identifierLeaks = [
  () => route.binding.packageRef.policyId,
  () => route.binding.packageRef.packageHash,
  () => route.blueprint.endingFingerprint,
  () => Object.keys(route.adjudication.finalMetrics)[0],
  () => route.blueprint.allowedFactRefs[0]
];

identifierLeaks.forEach((getIdentifier, index) => {
  test(`S5 rejects internal identifier leak ${index + 1}`, () => {
    const value = validNarrative();
    value.paragraphs[0].text += getIdentifier();
    expectCode(() => validate(value), "ENDGAME_NARRATIVE_INTERNAL_IDENTIFIER_LEAK");
  });
});

test("S5 rejects an unknown number", () => {
  const value = validNarrative();
  value.paragraphs[0].text += "突然出现99项承诺";
  expectCode(() => validate(value), "ENDGAME_NARRATIVE_UNKNOWN_NUMBER");
});

test("S5 permits a number already present in authoritative visible text", () => {
  const value = validNarrative();
  const sceneItem = route.blueprint.slots.scene_anchor[0];
  const numberedBlueprint = clone(route.blueprint);
  numberedBlueprint.slots.scene_anchor[0].text = `${sceneItem.text} 42`;
  numberedBlueprint.slots.scene_anchor[0].title = `${sceneItem.title} 42`;
  value.paragraphs[0].text = value.paragraphs[0].text.replace(sceneItem.text, numberedBlueprint.slots.scene_anchor[0].text);
  const output = validateNarratedEndingV1({ ...input, blueprint: numberedBlueprint, narratedEnding: value });
  assert.match(output.paragraphs[0].text, /42/);
});

test("S5 enforces configured minimum length", () => {
  const value = validNarrative();
  for (const paragraph of value.paragraphs) {
    const plan = neutral.narrative.paragraphPlan.find((candidate) => candidate.paragraphId === paragraph.paragraphId);
    const slotText = plan.requiredSlots.map((slotId) => route.blueprint.slots[slotId][0].text).join("。");
    const axisText = plan.requiredAxes.map((axisId) => route.blueprint.resolvedAxes.find((axis) => axis.axisId === axisId).summary).join("。");
    paragraph.text = [slotText, axisText].filter(Boolean).join("。");
  }
  expectCode(() => validate(value), "ENDGAME_NARRATIVE_LENGTH");
});

test("S5 enforces configured maximum length", () => {
  const value = validNarrative();
  value.paragraphs[0].text += "很长的安全叙述".repeat(200);
  expectCode(() => validate(value), "ENDGAME_NARRATIVE_LENGTH");
});

test("S5 rejects a future or stale blueprint revision", () => {
  const blueprint = clone(route.blueprint);
  blueprint.sourceRevision += 1;
  expectCode(() => buildConfigDrivenEndingNarratorPromptV1({ ...input, blueprint }), "ENDGAME_NARRATIVE_REVISION_MISMATCH");
});

test("S5 rejects a blueprint with different resolved axes", () => {
  const blueprint = clone(route.blueprint);
  blueprint.resolvedAxes.reverse();
  expectCode(() => buildConfigDrivenEndingNarratorPromptV1({ ...input, blueprint }), "ENDGAME_NARRATIVE_AXES_MISMATCH");
});

test("S5 rejects an unknown blueprint schema", () => {
  const blueprint = clone(route.blueprint);
  blueprint.schemaVersion = "unknown";
  expectCode(() => buildConfigDrivenEndingNarratorPromptV1({ ...input, blueprint }), "ENDGAME_NARRATIVE_BLUEPRINT_INVALID");
});

test("S5 fallback is deterministic and fact-bound", () => {
  const first = renderConfigDrivenEndingFallbackV1(input);
  for (let index = 0; index < 100; index += 1) {
    assert.deepEqual(renderConfigDrivenEndingFallbackV1(input), first);
  }
  assert.equal(first.paragraphs.length, 3);
  assert.ok(first.paragraphs.every((paragraph) => paragraph.factRefs.length > 0));
});

test("S5 uses model output on the first valid attempt", async () => {
  let calls = 0;
  const result = await narrateConfigDrivenEndingV1({
    ...input,
    provider: async () => {
      calls += 1;
      return validNarrative();
    }
  });
  assert.equal(result.generationMode, "MODEL");
  assert.equal(result.attempts, 1);
  assert.equal(calls, 1);
});

test("S5 retries exactly once after invalid output", async () => {
  let calls = 0;
  const result = await narrateConfigDrivenEndingV1({
    ...input,
    provider: {
      async generate(request) {
        calls += 1;
        if (calls === 1) return "not json";
        assert.equal(request.attempt, 2);
        assert.equal(request.retryReason.code, "ENDGAME_NARRATIVE_PROVIDER_JSON_INVALID");
        return JSON.stringify(validNarrative());
      }
    }
  });
  assert.equal(result.generationMode, "MODEL");
  assert.equal(result.attempts, 2);
  assert.equal(calls, 2);
});

test("S5 falls back after two provider failures", async () => {
  let calls = 0;
  const result = await narrateConfigDrivenEndingV1({
    ...input,
    provider: async () => {
      calls += 1;
      throw new Error("provider unavailable");
    }
  });
  assert.equal(calls, 2);
  assert.equal(result.generationMode, "TEMPLATE_FALLBACK");
  assert.equal(result.attempts, 2);
  assert.equal(result.failures.length, 2);
});

test("S5 falls back without calling a missing provider", async () => {
  const result = await narrateConfigDrivenEndingV1({ ...input, provider: null });
  assert.equal(result.generationMode, "TEMPLATE_FALLBACK");
  assert.equal(result.attempts, 0);
});

test("S5 rejects an invalid provider contract before fallback", async () => {
  const result = await narrateConfigDrivenEndingV1({ ...input, provider: {} });
  assert.equal(result.generationMode, "TEMPLATE_FALLBACK");
  assert.equal(result.failures[0].code, "ENDGAME_NARRATIVE_PROVIDER_INVALID");
});

test("S5 generic source contains no world-specific branches or unsafe evaluators", () => {
  const source = readFileSync(new URL("../src/endgame/config-driven-ending-narrator-v1.mjs", import.meta.url), "utf8");
  for (const forbidden of ["桑田", "浙江", "皇帝", "改桑", "凯撒", "元老院", "eval(", "new Function", "readFile", "fetch(", "Math.random", "Date.now"]) {
    assert.equal(source.includes(forbidden), false, `generic narrator contains forbidden source token: ${forbidden}`);
  }
});
