import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import {
  buildStoryPackageRoleView,
  clearPartOneRuntimePackageCache,
  clearStoryPackageCache,
  buildPartOneRuntimeWorkingSet,
  buildPartOneTurnProgressReport,
  createInitialPartOneState,
  evaluateStoryPackageDirector,
  finalizePartOneSettlement,
  getPartOneRuntimePackagePath,
  loadPartOneRuntimePackage,
  loadStoryPackage,
  settlePartOneAction,
  validateStoryPackageSourceMap
} from "../src";

const configRoot = resolve(__dirname, "../config");

test("a shadow Part One runtime path is opt-in and never overrides an explicit config root", () => {
  const previous = process.env.SANGTIAN_RUNTIME_PACKAGE_PATH;
  const shadowPath = resolve(configRoot, "../shadow/part-one-runtime.json");
  process.env.SANGTIAN_RUNTIME_PACKAGE_PATH = shadowPath;
  try {
    assert.equal(getPartOneRuntimePackagePath("sangtian"), shadowPath);
    assert.equal(
      getPartOneRuntimePackagePath("sangtian", configRoot),
      resolve(configRoot, "sangtian", "story-package", "part-one-runtime.json")
    );
    assert.equal(
      getPartOneRuntimePackagePath("caesar"),
      resolve(configRoot, "caesar", "story-package", "part-one-runtime.json")
    );
  } finally {
    if (previous === undefined) delete process.env.SANGTIAN_RUNTIME_PACKAGE_PATH;
    else process.env.SANGTIAN_RUNTIME_PACKAGE_PATH = previous;
  }
});

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

test("loads the immutable Sangtian Part One authoring runtime package", () => {
  const loaded = process.env.SANGTIAN_RUNTIME_PACKAGE_PATH
    ? loadPartOneRuntimePackage("sangtian")
    : loadPartOneRuntimePackage("sangtian", configRoot);
  assert.equal(loaded.package.partId, "PART-01");
  assert.equal(loaded.package.sections.length, 4);
  assert.equal(loaded.package.requirements.length, 12);
  assert.equal(loaded.package.assets.length, 54);
  assert.equal(loaded.package.contentCounts.narrativeScenePatterns, 3);
  assert.equal(loaded.package.assets.filter((asset) => asset.assetId.startsWith("DK-P1-")).length, 15);
  assert.equal(loaded.package.styleProfile.narrativeBudget.minCharacters, 300);
  assert.equal(loaded.contentHash, loaded.package.immutableHash);
  assert.equal(loaded.package.authoringManifestHash, loaded.package.authoringManifest.immutableHash);
});

test("rejects a tampered Sangtian Part One authoring runtime package", () => {
  const tempRoot = mkdtempSync(join(tmpdir(), "part-one-runtime-tamper-"));
  cpSync(resolve(configRoot, "sangtian"), resolve(tempRoot, "sangtian"), { recursive: true });
  const packagePath = resolve(tempRoot, "sangtian/story-package/part-one-runtime.json");
  const packageJson = JSON.parse(readFileSync(packagePath, "utf8")) as Record<string, unknown>;
  const style = packageJson.styleProfile as Record<string, unknown>;
  style.pointOfView = "tampered";
  writeFileSync(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`);
  clearPartOneRuntimePackageCache();
  assert.throws(() => loadPartOneRuntimePackage("sangtian", tempRoot), /PART_ONE_RUNTIME_HASH_MISMATCH/);
  rmSync(tempRoot, { recursive: true, force: true });
});

test("drives a deterministic twenty-turn Part One state path without advancing by turn number alone", () => {
  const pkg = loadPartOneRuntimePackage("sangtian").package;
  let state = createInitialPartOneState(pkg);
  assert.match(state.scene.situation, /密信都已由总督拆阅并收持/);
  assert.doesNotMatch(state.scene.situation, /亲随持密信/);
  let nextAction = {
    source: "RECOMMENDED",
    decisionId: "opening_d2",
    actionText: "将总督封缄令牌交给清流县令亲随，命他向清流县传达封存档房之令；同时当面答复巡抚书吏：暂缓签发，三日内复核。"
  };
  const visited = new Set<string>([state.sectionId]);
  const progressReports = [];
  const offeredAffordanceIds = new Set<string>();
  const offeredActionTexts = new Set<string>();
  const continuationDecisionIds: string[] = [];
  const firstSectionNpcReactions: string[] = [];
  const visitedSceneIds = new Set<string>([state.scene.sceneId]);
  const visitedTimeLabels = new Set<string>([state.scene.timeLabel]);
  let sectionTransitionMoveCount = 0;
  let duePayoffMoveCount = 0;
  let nextPressureMoveCount = 0;
  for (let turn = 1; turn <= 20; turn += 1) {
    const settlement = settlePartOneAction(pkg, state, nextAction, turn);
    visitedSceneIds.add(settlement.event.sceneAfter.sceneId);
    visitedTimeLabels.add(settlement.event.sceneAfter.timeLabel);
    const duePayoffMoves = settlement.event.authoritativeWorldMoves.filter(
      (move) => move.sourceType === "DUE_CONSEQUENCE"
    );
    assert.deepEqual(
      duePayoffMoves.map((move) => move.consequenceId),
      settlement.dueConsequences.map((item) => item.consequenceId),
      `T${turn} may only pay consequences that have an authored visible beat`
    );
    assert.equal(
      duePayoffMoves.every((move) =>
        move.action.length > 0
        && move.requiredTermGroups.length > 0
        && move.resultCeiling.length > 0
      ),
      true
    );
    duePayoffMoveCount += duePayoffMoves.length;
    sectionTransitionMoveCount += settlement.event.authoritativeWorldMoves.filter(
      (move) => move.sourceType === "SECTION_TRANSITION"
    ).length;
    nextPressureMoveCount += settlement.event.authoritativeWorldMoves.filter(
      (move) => move.sourceType === "NEXT_DECISION_PRESSURE"
    ).length;
    if (turn <= 3) {
      firstSectionNpcReactions.push(
        settlement.event.authoritativeNpcReactions[0]?.action || ""
      );
    }
    if (turn === 1) {
      assert.equal(settlement.event.authoritativeNpcReactions.length, 1);
      assert.equal(settlement.event.authoritativeNpcReactions[0].actorRefs.includes("actor.zhejiang_xunfu"), true);
      assert.match(settlement.event.authoritativeNpcReactions[0].action, /^巡抚书吏按来府前所受交代当场追问/);
      assert.equal(settlement.event.authoritativeObservableFacts.some((fact) => fact.includes("actor.qingliu_magistrate")), false);
      assert.equal(settlement.event.authoritativeObservableFacts.some((fact) => fact.includes("清流县令")), true);
      assert.equal(settlement.event.authoritativeObservableFacts.some((fact) => fact.includes("已经送达浙江巡抚")), false);
      assert.equal(
        settlement.event.authoritativeObservableFacts.some((fact) =>
          fact.includes("巡抚书吏已代表浙江巡抚当场听明这项答复，无须离场送达")
        ),
        true
      );
      assert.equal(
        settlement.event.sceneAfter.objectStates?.find(
          (item) => item.objectRef === "object.xunfu_reply_box"
        )?.holderRef,
        "actor.xunfu_clerk"
      );
      assert.equal(
        settlement.event.sceneAfter.objectStates?.find(
          (item) => item.objectRef === "object.xunfu_reply_box"
        )?.contentsState,
        "EMPTY"
      );
      assert.equal(
        settlement.event.sceneAfter.objectStates?.find(
          (item) => item.objectRef === "object.xunfu_reply_box"
        )?.closureState,
        "CLOSED"
      );
      assert.equal(
        settlement.event.sceneAfter.objectStates?.find(
          (item) => item.objectRef === "object.governor_seal_token"
        )?.holderRef,
        "actor.qingliu_messenger"
      );
    }
    if (turn === 3) {
      assert.equal(settlement.event.sectionTransitioned, true);
      assert.match(
        settlement.event.actionText,
        /在已经写明的改桑边界之后，补写复核办法与督抚各自责任/
      );
      const executionPressure = settlement.event.authoritativeWorldMoves.find(
        (move) => move.sourceType === "DUE_CONSEQUENCE"
      );
      assert.match(executionPressure?.resultCeiling || "", /不得换算为一日一变、每日、每时等频率/);
      assert.equal(
        settlement.event.sceneAfter.documentStates?.find(
          (item) => item.documentRef === "document.qingliu_register_original"
        )?.accessState,
        "NOT_PRESENT"
      );
      assert.equal(
        settlement.event.sceneAfter.documentStates?.find(
          (item) => item.documentRef === "document.reform_execution_record"
        )?.accessState,
        "WRITTEN"
      );
      const transition = settlement.event.authoritativeWorldMoves.find(
        (move) => move.sourceType === "SECTION_TRANSITION"
      );
      assert.deepEqual(
        transition?.requiredTermGroups[0],
        ["嘉靖三十五年五月初九巳时", "五月初九巳时", "次日巳时"]
      );
      assert.deepEqual(
        transition?.requiredTermGroups[1],
        ["杭州总督府签押房", "签押房"]
      );
      assert.match(transition?.resultCeiling || "", /不得声称已经知道这些文书的笔迹、户头、具体内容或真伪/);
      assert.equal(
        settlement.event.narrativePlan.narrativeCeiling.some((line) =>
          line.includes("不复述 Recent Canon 已写过的文书状态")
        ),
        true
      );
    }
    if (turn === 4) {
      assert.deepEqual(
        settlement.event.narrativePlan.authorizedPlayerSpeech,
        ["由总督府定复核清单，巡抚和县令只能派见证人参加"]
      );
    }
    if (turn === 5) {
      assert.equal(
        settlement.event.narrativePlan.authorizedPlayerSpeech.includes(
          "原册留在档房，换新封条；总督、县令、巡抚三方各留封样"
        ),
        true
      );
    }
    const paidPendingConsequenceIds = settlement.dueConsequences.map((item) => item.consequenceId);
    const finalized = finalizePartOneSettlement(
      settlement,
      paidPendingConsequenceIds
    );
    progressReports.push(buildPartOneTurnProgressReport(pkg, finalized, {
      runId: "runtime-simulation",
      playerActionId: `player-action-${turn}`,
      paidPendingConsequenceIds
    }));
    state = finalized.proposedState;
    visited.add(state.sectionId);
    const workingSet = buildPartOneRuntimeWorkingSet(pkg, state, turn);
    if (turn === 20) {
      assert.equal(workingSet.openDecisionKernel.assetId, "PART-02-HANDOFF-PREVIEW");
      assert.equal(workingSet.openDecisionKernel.payload.terminalReadOnlyPreview, true);
      assert.equal(workingSet.decisionAffordances.every((item) => item.createsPendingConsequence === false), true);
      continue;
    }
    if (workingSet.retrievalTrace.continuationDecisionId) {
      continuationDecisionIds.push(workingSet.retrievalTrace.continuationDecisionId);
      assert.ok(workingSet.nextDecisionPressure?.summary);
      assert.ok(workingSet.retrievalTrace.floorObligationId);
    }
    for (const offered of workingSet.decisionAffordances) {
      assert.equal(offeredAffordanceIds.has(offered.affordanceTemplateId), false, `repeated affordance ${offered.affordanceTemplateId}`);
      assert.equal(offeredActionTexts.has(offered.actionText), false, `repeated action ${offered.actionText}`);
      offeredAffordanceIds.add(offered.affordanceTemplateId);
      offeredActionTexts.add(offered.actionText);
    }
    const option = workingSet.decisionAffordances[0];
    nextAction = {
      source: "RECOMMENDED",
      decisionId: option.affordanceTemplateId,
      label: option.title,
      decisionKernelId: option.decisionKernelId,
      affordanceTemplateId: option.affordanceTemplateId,
      actionText: option.actionText
    };
  }
  assert.deepEqual([...visited], ["SEC-P1-01", "SEC-P1-02", "SEC-P1-03", "SEC-P1-04"]);
  assert.equal(state.partCompletionStatus, "HANDOFF_READY");
  assert.equal(state.report.dispatchStatus === "DISPATCHED" || state.report.dispatchStatus === "SPLIT", true);
  assert.equal((state.completedKernelIds || []).length, 15);
  assert.deepEqual(continuationDecisionIds, [
    "CD-P1-S3-RELIEF-RECEIPTS",
    "CD-P1-S4-XUNFU-COPY-REQUEST",
    "CD-P1-S4-MERCHANT-DAILY-TERMS",
    "CD-P1-S4-WITNESS-PROTECTION-ORDER",
    "CD-P1-S4-WAITING-FOR-CAPITAL"
  ]);
  assert.equal(state.pendingConsequences.some((item) => item.status === "PAID"), true);
  assert.equal(progressReports.length, 20);
  assert.equal(progressReports.every((report) => report.hardValidationStatus === "PASS"), true);
  assert.equal(progressReports.every((report) => report.materialChanges.length > 0), true);
  assert.equal(progressReports.every((report) => report.mainlineContributions.length > 0), true);
  assert.equal(firstSectionNpcReactions[0].includes("书面回复"), true);
  assert.equal(firstSectionNpcReactions[1].includes("参与复核"), true);
  assert.equal(firstSectionNpcReactions[2].includes("联署"), true);
  assert.equal(new Set(firstSectionNpcReactions).size, 3);
  assert.equal(visitedSceneIds.size, 4);
  assert.equal(visitedTimeLabels.size, 4);
  assert.equal(sectionTransitionMoveCount, 3);
  assert.equal(duePayoffMoveCount, 19);
  assert.equal(nextPressureMoveCount, 5);
});

test("cannot mark a due Part One consequence paid when its visible payoff beat is absent", () => {
  const pkg = loadPartOneRuntimePackage("sangtian").package;
  const initial = createInitialPartOneState(pkg);
  const first = settlePartOneAction(pkg, initial, {
    source: "RECOMMENDED",
    decisionId: "opening_d2",
    actionText: "先封档房，再复巡抚"
  }, 1);
  const firstState = finalizePartOneSettlement(first, []).proposedState;
  const workingSet = buildPartOneRuntimeWorkingSet(pkg, firstState, 1);
  const option = workingSet.decisionAffordances[0];
  const second = settlePartOneAction(pkg, firstState, {
    source: "RECOMMENDED",
    decisionKernelId: option.decisionKernelId,
    affordanceTemplateId: option.affordanceTemplateId,
    label: option.title,
    actionText: option.actionText,
    targetRef: option.targetRef
  }, 2);
  assert.equal(second.dueConsequences.length, 1);
  const withoutPayoff = structuredClone(second);
  withoutPayoff.event.authoritativeWorldMoves = withoutPayoff.event.authoritativeWorldMoves
    .filter((move) => move.sourceType !== "DUE_CONSEQUENCE");
  assert.throws(
    () => finalizePartOneSettlement(
      withoutPayoff,
      second.dueConsequences.map((item) => item.consequenceId)
    ),
    /PART_ONE_CONSEQUENCE_PAYOFF_NOT_AUTHORIZED/
  );
});

test("Part One working-set retrieval returns one legal kernel and approved style as P0 context", () => {
  const pkg = (process.env.SANGTIAN_RUNTIME_PACKAGE_PATH
    ? loadPartOneRuntimePackage("sangtian")
    : loadPartOneRuntimePackage("sangtian", configRoot)).package;
  const state = createInitialPartOneState(pkg);
  const workingSet = buildPartOneRuntimeWorkingSet(pkg, state, 1);
  assert.equal(workingSet.section.sectionId, "SEC-P1-01");
  assert.equal(workingSet.openDecisionKernel.assetId, "DK-P1-EXECUTION-SCOPE");
  assert.equal(workingSet.decisionAffordances.length, 2);
  assert.equal(workingSet.decisionAffordances.every((item) => Boolean(item.statePatch) && item.target.label.length > 0), true);
  assert.equal(workingSet.styleProfile.profileId, "STYLE-SANGTIAN-HISTORICAL-NOVEL");
  assert.equal(workingSet.retrievalTrace.selectedAssetIds.includes("STYLE-SANGTIAN-HISTORICAL-NOVEL"), true);
});

test("rejects runtime content whose evidence id is absent from the source map", () => {
  const tempRoot = mkdtempSync(join(tmpdir(), "story-package-source-binding-"));
  cpSync(resolve(configRoot, "sangtian"), resolve(tempRoot, "sangtian"), { recursive: true });
  const packageRoot = resolve(tempRoot, "sangtian/story-package");
  const storyPackagePath = resolve(packageRoot, "story-package.json");
  const manifestPath = resolve(packageRoot, "manifest.json");
  const storyPackage = JSON.parse(readFileSync(storyPackagePath, "utf8")) as Record<string, unknown>;
  const cards = storyPackage.cards as Array<Record<string, unknown>>;
  cards[0].sourceIds = ["missing_source_id"];
  const serialized = `${JSON.stringify(storyPackage, null, 2)}\n`;
  writeFileSync(storyPackagePath, serialized);
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Record<string, unknown>;
  manifest.storyPackageSha256 = createHash("sha256").update(serialized).digest("hex");
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  clearStoryPackageCache();
  assert.throws(() => loadStoryPackage("sangtian", tempRoot), /references unknown sourceId missing_source_id/);
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
