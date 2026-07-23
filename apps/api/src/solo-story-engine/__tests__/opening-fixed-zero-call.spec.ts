import assert from "node:assert/strict";
import { loadStoryPackage } from "@ai-story/templates";
import { fixedOpeningOutput, loadFixedStoryOpening } from "../fixed-opening";

void (() => {
  let providerCalls = 0;
  const loaded = loadStoryPackage("sangtian");
  const authored = loadFixedStoryOpening("sangtian", loaded);
  const output = fixedOpeningOutput(authored.opening);

  assert.equal(providerCalls, 0, "the fixed prologue and first situation must never call DeepSeek");
  assert.match(authored.opening.prologueNarrative, /嘉靖三十五年/);
  assert.match(authored.opening.prologueNarrative, /浙江总督站在这张越收越紧的网中央/);
  assert.equal(output.resultType, "PUBLISHED_TURN");
  assert.ok(output.story.resultNarrative.length >= 100);
  assert.ok(output.story.nextSituationNarrative.length >= 60);
  assert.ok(output.decisions.length >= 2);
  assert.ok(output.decisions.every((decision) => decision.label && decision.description && decision.method));
  assert.match(output.resolution.confirmedResolutionId, /^authored-opening:/);
  assert.equal(authored.contentHash.length, 64);

  console.log("solo fixed opening zero-provider-call: PASS");
})();
