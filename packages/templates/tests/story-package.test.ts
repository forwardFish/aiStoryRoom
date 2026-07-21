import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import {
  buildStoryPackageRoleView,
  clearStoryPackageCache,
  evaluateStoryPackageDirector,
  loadStoryPackage,
  validateStoryPackageSourceMap
} from "../src";

const configRoot = resolve(__dirname, "../config");

test("loads the Sangtian runtime story package and validates hashes", () => {
  const loaded = loadStoryPackage("sangtian", configRoot);
  assert.equal(loaded.manifest.worldId, "sangtian");
  assert.equal(loaded.storyPackage.openingNodeId, "node_governor_opening");
  assert.equal(loaded.storyPackage.roles.some((role) => role.roleKey === "zhejiang_governor"), true);
  assert.equal(loaded.sourceMap.entries.length >= 10, true);
  const originalSources = loaded.sourceMap.entries.filter((entry) => entry.kind === "t0");
  assert.equal(originalSources.length >= 6, true);
  assert.equal(originalSources.every((entry) => entry.origin === "original_fact"), true);
  assert.equal(originalSources.every((entry) => entry.sourceRefs.every((ref) => ref.sourcePath.endsWith("大明王朝1566 (刘和平).txt"))), true);
  assert.equal(originalSources.every((entry) => entry.sourceRefs.every((ref) => ref.sourceSha256 === "04d5e8d4533d86890a79058c25252d33e001668921a2bbd8ffde401cdd2b6238")), true);
  const invented = loaded.sourceMap.entries.filter((entry) => entry.origin === "invented_for_game");
  assert.equal(invented.length > 0, true);
  assert.equal(invented.every((entry) => Boolean(entry.adaptationDecisionId)), true);
});

test("rejects invented game material that is not backed by an adaptation decision", () => {
  const valid = loadStoryPackage("sangtian", configRoot).sourceMap;
  const broken = structuredClone(valid) as unknown as Record<string, unknown>;
  const entries = broken.entries as Array<Record<string, unknown>>;
  const invented = entries.find((entry) => entry.origin === "invented_for_game");
  assert.ok(invented);
  invented.adaptationDecisionId = null;
  assert.throws(() => validateStoryPackageSourceMap(broken), /adapted or invented entries require an adaptationDecisionId/);
});

test("rejects a tampered story-package hash", () => {
  const tempRoot = mkdtempSync(join(tmpdir(), "story-package-tamper-"));
  cpSync(resolve(configRoot, "sangtian"), resolve(tempRoot, "sangtian"), { recursive: true });
  const storyPackagePath = resolve(tempRoot, "sangtian/story-package/story-package.json");
  const storyPackage = JSON.parse(readFileSync(storyPackagePath, "utf8")) as Record<string, unknown>;
  storyPackage.packageVersion = "2026-07-20.tampered";
  writeFileSync(storyPackagePath, JSON.stringify(storyPackage, null, 2));
  clearStoryPackageCache();
  assert.throws(() => loadStoryPackage("sangtian", tempRoot), /STORY_PACKAGE_HASH_MISMATCH/);
  rmSync(tempRoot, { recursive: true, force: true });
});

test("retriever only exposes role-visible cards and hidden truths stay filtered", () => {
  const roleView = buildStoryPackageRoleView("sangtian", {
    roleKey: "zhejiang_governor",
    currentNodeId: "node_governor_opening",
    currentTurn: 1
  });
  assert.equal(roleView.cards.some((card) => card.cardId === "card_material_county_secret_letter"), true);
  assert.equal(roleView.cards.some((card) => card.cardId === "card_truth_xunfu_shadow_ledger"), false);
  assert.equal(roleView.visibleLatentTruths.some((truth) => truth.truthId === "truth_xunfu_shadow_ledger"), false);
  assert.equal(roleView.droppedCardIds.includes("card_truth_xunfu_shadow_ledger"), true);
});

test("recent canon remains the highest authority for the current visible situation", () => {
  const roleView = buildStoryPackageRoleView("sangtian", {
    roleKey: "zhejiang_governor",
    currentNodeId: "node_governor_opening",
    currentTurn: 1,
    recentCanon: {
      sceneLabel: "嘉靖三十五年五月初八 · 杭州总督府外廊",
      situationText: "巡抚已经把第二封催办文书摊开在外廊案几上，亲随刚从清流县门路传回第一句回报。",
      sourceCanonIds: ["canon_recent_001"]
    }
  });
  assert.equal(roleView.currentSceneLabel, "嘉靖三十五年五月初八 · 杭州总督府外廊");
  assert.match(roleView.currentSituationText, /第二封催办文书/);
  assert.deepEqual(roleView.recentCanonIds, ["canon_recent_001"]);
});

test("floor closes when an equivalent fact already satisfied the dramatic obligation", () => {
  const evaluation = evaluateStoryPackageDirector("sangtian", {
    currentNodeId: "node_governor_opening",
    currentTurn: 2,
    canonFactKeys: ["prefact_county_registers_exist", "prefact_governor_can_dispatch", "fact_joint_review_order_established"]
  });
  assert.deepEqual(evaluation.evaluatedObligations, [
    { obligationId: "floor_county_register_visibility", status: "SATISFIED" }
  ]);
  assert.equal(evaluation.directedBeat, null);
});

test("director may emit at most one local external beat and never decides for the player", () => {
  const evaluation = evaluateStoryPackageDirector("sangtian", {
    currentNodeId: "node_governor_opening",
    currentTurn: 2,
    canonFactKeys: ["prefact_county_registers_exist", "prefact_governor_can_dispatch"]
  });
  assert.deepEqual(evaluation.allowedAdjacentNodeIds, ["node_county_registers"]);
  assert.equal(evaluation.directedBeat?.beatId, "beat_county_archive_urgent_report_arrives");
  assert.match(evaluation.directedBeat?.externalWorldMove ?? "", /清流县驿递送来一封加急公文/);
  assert.equal(/此前派|亲随.*折返|县册.*已经到手/.test(evaluation.directedBeat?.externalWorldMove ?? ""), false);
  assert.equal(/你决定|总督决定|你同意|你拒绝/.test(evaluation.directedBeat?.externalWorldMove ?? ""), false);
});
