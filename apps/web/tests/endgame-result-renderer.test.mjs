import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  adaptEndgamePresentationV3ForGame,
  normalizeEndgamePresentationV3,
  renderEndgameFixtureShell,
  renderEndgamePresentationV3Html
} from "../public/endgame-result-renderer.js";

function fixture() {
  return {
    schemaVersion: "endgame_presentation_v3",
    resultType: "SOLO_PART_END",
    world: { worldId: "neutral-synthetic", worldTitle: "Neutral World" },
    role: { roleId: "operator", roleTitle: "Operator" },
    title: "A Configured Ending",
    axes: [{ axisId:"world_outcome", label:"System outcome", outcomeId:"stable", title:"Stable", summary:"The system remained stable." }],
    metrics: [{ metricId:"signal", label:"Signal", value:55, formattedValue:"55", direction:"HIGH_GOOD", initialValue:40 }],
    dynamicSubtitle: "You preserved the signal and paid a cost.",
    style: { styleId:"balanced", label:"Balanced" },
    narrative: "The final scene is committed.\n\nThe remaining pressure is visible.",
    sections: [{ sectionId:"gain", label:"You preserved", layout:"LIST", items:[{ title:"Signal", text:"The signal survived.", actorName:null, stageIndex:3 }] }],
    replayHint: "Try another order.",
    endingFingerprint: "a".repeat(64),
    replayActions: [{ type:"RESTART_SAME_STORY", label:"Restart", href:"/role-select?story=neutral-synthetic&start=new", enabled:true, disabledReason:null }]
  };
}

test("normalizes and renders Presentation V3 arrays", () => {
  const value = normalizeEndgamePresentationV3(fixture());
  assert.ok(value);
  const html = renderEndgamePresentationV3Html(value);
  assert.match(html, /System outcome/);
  assert.match(html, /signal survived/iu);
  assert.match(html, /data-replay-action="RESTART_SAME_STORY"/);
  assert.match(html, /class="endgame-story"/);
  assert.match(html, /<details class="endgame-result-details">/);
  assert.doesNotMatch(html, /endgame-v3-metrics/);
  assert.doesNotMatch(html, /packageHash|factId|outcomeId/);
});

test("renders the local preview inside the existing three-column game shell", () => {
  const value = normalizeEndgamePresentationV3(fixture());
  const html = renderEndgameFixtureShell(value);
  assert.match(html, /data-testid="story-shell"/);
  assert.match(html, /class="causal-left"/);
  assert.match(html, /class="causal-center endgame-center"/);
  assert.match(html, /class="causal-right"/);
  assert.match(html, /data-testid="ending-main"/);
  assert.match(html, /A Configured Ending/);
});

test("adapts V3 to the existing final judgement region", () => {
  const adapted = adaptEndgamePresentationV3ForGame(normalizeEndgamePresentationV3(fixture()));
  assert.equal(adapted.schemaVersion, "endgame_presentation_v3");
  assert.equal(adapted.globalEnding.title, "A Configured Ending");
});

test("rejects external replay links and invalid arrays", () => {
  const unsafe = fixture();
  unsafe.replayActions[0].href = "https://evil.invalid";
  assert.equal(normalizeEndgamePresentationV3(unsafe), null);
  const invalid = fixture();
  invalid.metrics[0].value = Number.NaN;
  assert.equal(normalizeEndgamePresentationV3(invalid), null);
});

test("renderer has no world or outcome business branches", () => {
  const source = readFileSync(new URL("../public/endgame-result-renderer.js", import.meta.url), "utf8");
  assert.doesNotMatch(source, /worldId\s*===|outcomeId\s*===|sangtian|caesar|zhejiang|governor/iu);
});
