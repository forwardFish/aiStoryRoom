import assert from "node:assert/strict";
import test from "node:test";
import { renderConfigDrivenEndingFallbackV1 } from "../src/endgame/config-driven-ending-narrator-v1.mjs";
import {
  ENDGAME_PRESENTATION_SCHEMA_VERSION,
  composeEndgamePresentationV3
} from "../src/endgame/config-driven-endgame-presentation-v1.mjs";
import { compileRoute, neutral, sangtian } from "./generic-endgame-s4-details-fixture.mjs";

function result(packageDocument, runId) {
  const route = compileRoute(packageDocument, { runId });
  const narratedEnding = renderConfigDrivenEndingFallbackV1({
    runPackageBinding: route.binding,
    adjudication: route.adjudication,
    blueprint: route.blueprint
  });
  return composeEndgamePresentationV3({
    runPackageBinding: route.binding,
    adjudication: route.adjudication,
    blueprint: route.blueprint,
    narratedEnding,
    world: { worldId: packageDocument.worldId, worldTitle: `World ${packageDocument.worldId}` },
    role: { roleId: packageDocument.profileId, roleTitle: `Role ${packageDocument.profileId}` },
    state: route.state,
    facts: route.facts,
    replayActions: [
      { type: "RESTART_SAME_STORY", label: "Restart", href: `/role-select?story=${packageDocument.worldId}&start=new`, enabled: true, disabledReason: null },
      { type: "BACK_TO_WORLDS", label: "Worlds", href: "/worlds", enabled: true, disabledReason: null }
    ]
  });
}

test("S6 composes the closed generic presentation contract", () => {
  const presentation = result(neutral, "run-neutral-s6");
  assert.equal(presentation.schemaVersion, ENDGAME_PRESENTATION_SCHEMA_VERSION);
  assert.equal(presentation.resultType, "SOLO_PART_END");
  assert.deepEqual(presentation.axes.map((axis) => axis.axisId), neutral.presentation.axisOrder);
  assert.deepEqual(presentation.metrics.map((metric) => metric.metricId), neutral.presentation.metricOrder);
  assert.deepEqual(presentation.sections.map((section) => section.sectionId), neutral.presentation.sections.map((section) => section.sectionId));
  assert.match(presentation.narrative, /route left a visible scene anchor/);
  assert.equal(Object.isFrozen(presentation), true);
});

test("S6 changes visible result content from JSON without world branches", () => {
  const neutralResult = result(neutral, "run-neutral-s6-json");
  const sangtianResult = result(sangtian, "run-sangtian-s6-json");
  assert.equal(neutralResult.title, neutral.presentation.title);
  assert.equal(sangtianResult.title, sangtian.presentation.title);
  assert.notDeepEqual(neutralResult.metrics.map((item) => item.label), sangtianResult.metrics.map((item) => item.label));
  assert.notDeepEqual(neutralResult.axes.map((item) => item.label), sangtianResult.axes.map((item) => item.label));
});

test("S6 exposes no world-specific result fields", () => {
  const presentation = result(sangtian, "run-sangtian-s6-fields");
  assert.equal("zhejiangOutcome" in presentation, false);
  assert.equal("governorFate" in presentation, false);
  assert.equal(JSON.stringify(presentation).includes("packageHash"), false);
});

test("S6 rejects unsafe replay links", () => {
  const route = compileRoute(neutral, { runId: "run-neutral-s6-link" });
  const narratedEnding = renderConfigDrivenEndingFallbackV1({ runPackageBinding: route.binding, adjudication: route.adjudication, blueprint: route.blueprint });
  assert.throws(() => composeEndgamePresentationV3({
    runPackageBinding: route.binding,
    adjudication: route.adjudication,
    blueprint: route.blueprint,
    narratedEnding,
    world: { worldId: neutral.worldId, worldTitle: "Neutral" },
    role: { roleId: neutral.profileId, roleTitle: "Operator" },
    state: route.state,
    facts: route.facts,
    replayActions: [{ type: "BACK_TO_WORLDS", label: "Bad", href: "https://evil.invalid", enabled: true, disabledReason: null }]
  }), /ENDGAME_PRESENTATION_REPLAY_HREF_REQUIRED/);
});
