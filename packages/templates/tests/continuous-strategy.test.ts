import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  D01_STAGE_ONE_FIXTURE,
  defaultSangtianStrategyRoot,
  evaluateSevenStages,
  evaluateStageOne,
  loadContinuousStrategyPackage,
  validateStages
} from "../src/continuous-strategy";
import { lintContinuousStrategy } from "../src/continuous-strategy/lint";

test("published sangtian_v1_1 content has all exact D08 counts and distinct authored text", () => {
  const result = lintContinuousStrategy();
  assert.equal(result.releaseStatus, "published");
  assert.equal(result.stages, 7);
  assert.equal(result.roleStageBriefs, 21);
  assert.equal(result.mainCards, 63);
  assert.equal(result.receipts, 63);
  assert.equal(result.effects, 63);
  assert.equal(result.maneuverStrategies, 21);
  assert.equal(result.mandatoryReactions, 3);
  assert.equal(result.systemActions, 7);
  assert.equal(result.agentPolicies, 21);
  assert.equal(result.publicResultRules, 7);
  assert.equal(result.personalResultRules, 21);
  assert.equal(result.globalEndingRules, 1);
  assert.equal(result.personalEndingRules, 3);
  assert.deepEqual(result.distinctness, {
    privateBriefs: 21,
    personalPressures: 21,
    mainTitles: 63,
    mainObjectives: 63,
    receiptTexts: 63,
    maneuverTitles: 21,
    maneuverObjectives: 21
  });
});

test("seven-stage deterministic evaluation resolves all required results without an LLM", () => {
  const content = loadContinuousStrategyPackage();
  const first = evaluateSevenStages(content);
  const second = evaluateSevenStages(content);
  assert.deepEqual(first, second);
  assert.equal(first.stages.length, 7);
  assert.equal(first.receipts.length, 21);
  assert.equal(first.maneuvers.length, 21);
  assert.equal(first.reactions.length, 3);
  assert.equal(first.systemActions.length, 7);
  assert.equal(first.publicResults.length, 7);
  assert.equal(first.personalResults.length, 21);
  assert.ok(first.ending.global.endingKey);
  assert.equal(first.ending.personal.length, 3);
  assert.deepEqual(first.reactions.map((reaction) => reaction.targetRoleKey), ["county_magistrate", "zhejiang_governor", "xunfu"]);
});

test("round seven seals three maneuvers before it publishes results", () => {
  const roundSeven = evaluateSevenStages(loadContinuousStrategyPackage()).stages.find((stage) => stage.stageNumber === 7)!;
  assert.equal(roundSeven.maneuvers.length, 3);
  const publishedIndex = roundSeven.resolutionOrder.indexOf("PUBLISHED");
  assert.ok(publishedIndex > 0);
  for (const maneuver of roundSeven.maneuvers) assert.ok(roundSeven.resolutionOrder.indexOf(maneuver.maneuverStrategyKey) < publishedIndex);
  assert.equal(roundSeven.published, true);
});

test("merchant is an unclaimable SYSTEM controller in every stage", () => {
  const content = loadContinuousStrategyPackage();
  assert.equal(content.systemActions.systemActions.length, 7);
  for (const action of content.systemActions.systemActions) {
    assert.equal(action.roleKey, "merchant");
    assert.equal(action.claimable, false);
    assert.equal(action.controllerMode, "SYSTEM");
  }
});

test("stage-one compatibility evaluation remains deterministic", () => {
  const content = loadContinuousStrategyPackage();
  const first = evaluateStageOne(content, D01_STAGE_ONE_FIXTURE);
  const second = evaluateStageOne(content, D01_STAGE_ONE_FIXTURE);
  assert.deepEqual(first, second);
  assert.equal(first.receipts.length, 3);
  assert.equal(new Set(first.influenceEdges.map((edge) => edge.sourceRoleKey)).size, 3);
  assert.deepEqual(first.interactionRequestKeys, ["request_s1_protect_evidence"]);
  assert.equal(first.systemAction.systemActionKey, "system_s1_tighten_merchant_credit");
});

test("strict content validation rejects unknown properties", () => {
  const content = loadContinuousStrategyPackage();
  const changed = structuredClone(content.stages) as typeof content.stages & { unexpected?: boolean };
  changed.unexpected = true;
  assert.throws(() => validateStages(changed), /unknown property unexpected/);
});

test("loader fails fast when a registered artifact changes bytes", () => {
  const temporaryRoot = mkdtempSync(join(tmpdir(), "sangtian-v1-1-"));
  try {
    cpSync(defaultSangtianStrategyRoot, temporaryRoot, { recursive: true });
    const stagesPath = join(temporaryRoot, "continuous-strategy-v1.1", "stages.json");
    writeFileSync(stagesPath, `${readFileSync(stagesPath, "utf8")}\n`, "utf8");
    assert.throws(() => loadContinuousStrategyPackage("sangtian_v1_1", temporaryRoot), /CONTENT_HASH_MISMATCH:stages\.json/);
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
});

test("loader fails fast when the registered manifest changes bytes", () => {
  const temporaryRoot = mkdtempSync(join(tmpdir(), "sangtian-v1-1-manifest-"));
  try {
    cpSync(defaultSangtianStrategyRoot, temporaryRoot, { recursive: true });
    const manifestPath = join(temporaryRoot, "continuous-strategy-v1.1", "manifest.json");
    writeFileSync(manifestPath, `${readFileSync(manifestPath, "utf8")}\n`, "utf8");
    assert.throws(() => loadContinuousStrategyPackage("sangtian_v1_1", temporaryRoot), /CONTENT_HASH_MISMATCH:manifest\.json/);
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
});

test("legacy sangtian config bytes remain unchanged", () => {
  const expected: Record<string, string> = {
    "days.json": "01c4162c7f148c94ae3aa47822ba69c12b5e3797b980ce77d34f687e8af95f1d",
    "decisions.json": "928d6d60298a51a8e0774610a8f025343a3c943ba4ca9f3d09e2ab7a50832281",
    "endings.json": "80da899676b87067ec295f70590611024343f77c3c3a10bfda742eeb3e4c9b57",
    "leverage.json": "3eb56c18905c768eac7a1202d0ab26efc5d43afa146ebbfe339bf02c0a8603a5",
    "maneuvers.json": "b58cb8ac15cb6338f7f7dc5fc1f5411f1278c778044ad02afada604d41d18882"
  };
  for (const [fileName, expectedHash] of Object.entries(expected)) {
    const actualHash = createHash("sha256").update(readFileSync(join(defaultSangtianStrategyRoot, fileName))).digest("hex");
    assert.equal(actualHash, expectedHash, fileName);
  }
});
