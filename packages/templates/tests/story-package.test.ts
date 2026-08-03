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
  assert.equal(loaded.package.assets.length, 65);
  assert.equal(loaded.package.contentCounts.narrativeScenePatterns, 3);
  assert.equal(
    loaded.package.assets.filter((asset) => asset.assetType === "SOURCE_SCENE_EVIDENCE").length,
    10,
  );
  assert.equal(loaded.package.assets.filter((asset) => asset.assetId.startsWith("DK-P1-")).length, 15);
  assert.equal(loaded.package.styleProfile.narrativeBudget.minCharacters, 300);
  assert.equal(loaded.contentHash, loaded.package.immutableHash);
  assert.equal(loaded.package.authoringManifestHash, loaded.package.authoringManifest.immutableHash);
});

test("every playable kernel has runtime-readable story evidence before play begins", () => {
  const pkg = loadPartOneRuntimePackage("sangtian", configRoot).package;
  const sourceScenes = pkg.assets.filter((asset) => asset.assetType === "SOURCE_SCENE_EVIDENCE");
  const approvedAdaptationIds = new Set(
    pkg.approvedAdaptations.map((item) => item.adaptationDecisionId)
  );

  for (const kernel of pkg.assets.filter((asset) => asset.assetType === "DECISION_KERNEL")) {
    const kernelClaimIds = new Set(kernel.sourceClaimIds);
    const matchingScenes = sourceScenes.filter((scene) =>
      scene.sourceClaimIds.some((claimId) => kernelClaimIds.has(claimId))
    );
    const hasApprovedAdaptationGap = kernel.adaptationDecisionIds.some((adaptationId) =>
      approvedAdaptationIds.has(adaptationId)
    );
    assert.equal(
      matchingScenes.length > 0 || hasApprovedAdaptationGap,
      true,
      `${kernel.assetId} would force the Narrator to invent the next plot`,
    );
  }

  const capitalKernel = pkg.assets.find((asset) => asset.assetId === "DK-P1-CAPITAL-CHANNEL");
  const capitalScene = sourceScenes.find((asset) =>
    asset.payload.sourceSceneId === "DM1566-C02-REPORT-ARRIVES-YAN-HOUSE"
  );
  assert.ok(capitalKernel);
  assert.ok(capitalScene);
  assert.equal(capitalScene.payload.sourceRange.paragraphStartId, "DM1566-C02-P0243");
  assert.equal(capitalScene.payload.sourceRange.paragraphEndId, "DM1566-C02-P0251");
  assert.equal(
    capitalScene.sourceClaimIds.some((claimId) => capitalKernel.sourceClaimIds.includes(claimId)),
    true,
  );
});

test("the server fixes a source-grounded Next Story Beat before any Narrator call", () => {
  const pkg = loadPartOneRuntimePackage("sangtian", configRoot).package;
  const opening = settlePartOneAction(
    pkg,
    createInitialPartOneState(pkg),
    {
      source: "RECOMMENDED",
      decisionId: "opening_d2",
      actionText: "动用总督封缄令牌，先保住清流县档房现场，再给巡抚一个暂缓签发的答复。"
    },
    1
  );
  const execution = buildPartOneRuntimeWorkingSet(pkg, opening.proposedState, 1)
    .decisionAffordances
    .find((item) => item.affordanceTemplateId === "DK-P1-EXECUTION-SCOPE-OPT-03");
  assert.ok(execution);
  const paused = settlePartOneAction(
    pkg,
    opening.proposedState,
    {
      source: "RECOMMENDED",
      decisionKernelId: execution.decisionKernelId,
      affordanceTemplateId: execution.affordanceTemplateId,
      label: execution.title,
      actionText: execution.actionText,
      targetRef: execution.targetRef
    },
    2
  );
  const responsibility = buildPartOneRuntimeWorkingSet(pkg, paused.proposedState, 2)
    .decisionAffordances
    .find((item) => item.affordanceTemplateId === "DK-P1-RESPONSIBILITY-RECORD-OPT-01");
  assert.ok(responsibility);
  const settled = settlePartOneAction(
    pkg,
    paused.proposedState,
    {
      source: "RECOMMENDED",
      decisionKernelId: responsibility.decisionKernelId,
      affordanceTemplateId: responsibility.affordanceTemplateId,
      label: responsibility.title,
      actionText: responsibility.actionText,
      targetRef: responsibility.targetRef
    },
    3
  );

  const beat = settled.event.narrativePlan.nextStoryBeat;
  assert.equal(settled.event.sectionTransitioned, true);
  assert.match(beat.playerOutcome, /正式回文|回文/u);
  assert.match(beat.npcOrWorldPressure, /次日.*签押房.*巡抚.*(?:拒绝|不肯).*具名/su);
  assert.match(beat.stopCondition, /复核由谁主持.*经办、见证/u);
  assert.equal(
    beat.evidencePacket.evidenceItems.some((item) =>
      item.evidenceClass === "ORIGINAL_MECHANISM"
      && item.sourceClaimIds.includes("DM1566-C04-CL-WEAVING-REFUSES-SIGNATURE")
    ),
    true,
  );
  assert.equal(
    beat.evidencePacket.evidenceItems.some((item) =>
      item.evidenceClass === "APPROVED_ADAPTATION"
      && item.adaptationDecisionIds.includes("ADAPT-P1-SEPARATE-XUNFU")
    ),
    true,
  );
  assert.match(beat.evidencePacket.specificityBoundary, /不得自行增加人数、涨幅/u);
  assert.doesNotMatch(JSON.stringify(beat), /粮价已涨了三成|灾民比前日多出百十人/u);
  assert.equal(
    settled.event.authoritativeWorldMoves.filter((move) => move.sourceType !== "SECTION_TRANSITION").length,
    1,
  );
  assert.match(beat.fallbackContinuation, /巡抚不肯.*共同具名.*复核.*主持/su);
});

test("temporarily withholding the release order does not create a written reply", () => {
  const pkg = loadPartOneRuntimePackage("sangtian", configRoot).package;
  const review = settlePartOneAction(
    pkg,
    createInitialPartOneState(pkg),
    {
      source: "RECOMMENDED",
      decisionId: "opening_d1",
      actionText: "把巡抚催办公文暂压在案上，示意巡抚书吏留在内厅；只问县令亲随密信是否仅为报疑、原册是否并未随信送来，再从这两项已知事实启动复核。"
    },
    1
  );
  const pauseOption = buildPartOneRuntimeWorkingSet(pkg, review.proposedState, 1)
    .decisionAffordances
    .find((item) => item.affordanceTemplateId === "DK-P1-EXECUTION-SCOPE-OPT-03");
  assert.ok(pauseOption);
  const pause = settlePartOneAction(
    pkg,
    review.proposedState,
    {
      source: "RECOMMENDED",
      decisionKernelId: pauseOption.decisionKernelId,
      affordanceTemplateId: pauseOption.affordanceTemplateId,
      label: pauseOption.title,
      actionText: pauseOption.actionText,
      targetRef: pauseOption.targetRef
    },
    2
  );
  assert.equal(
    pause.event.sceneAfter.documentStates?.some(
      (item) => item.documentRef === "document.reform_execution_record"
    ),
    false
  );
});

test("issuing the limited-trial reply delivers it through the established reply box", () => {
  const pkg = loadPartOneRuntimePackage("sangtian", configRoot).package;
  const opening = settlePartOneAction(
    pkg,
    createInitialPartOneState(pkg),
    {
      source: "RECOMMENDED",
      decisionId: "opening_d2",
      actionText: "动用总督封缄令牌，先保住清流县档房现场，再给巡抚一个暂缓签发的答复。"
    },
    1
  );
  assert.equal(
    opening.event.actionText,
    "将总督封缄令牌交给清流县令亲随，命他向清流县传达封存档房之令；同时当面答复巡抚书吏：暂缓签发，三日内复核。"
  );
  assert.equal(
    opening.event.sceneAfter.presentActorRefs.includes("actor.qingliu_messenger"),
    false
  );
  const issueOption = buildPartOneRuntimeWorkingSet(pkg, opening.proposedState, 1)
    .decisionAffordances
    .find((item) => item.affordanceTemplateId === "DK-P1-EXECUTION-SCOPE-OPT-01");
  assert.ok(issueOption);
  const issued = settlePartOneAction(
    pkg,
    opening.proposedState,
    {
      source: "RECOMMENDED",
      decisionKernelId: issueOption.decisionKernelId,
      affordanceTemplateId: issueOption.affordanceTemplateId,
      label: issueOption.title,
      actionText: issueOption.actionText,
      targetRef: issueOption.targetRef
    },
    2
  );
  const reply = issued.event.sceneAfter.documentStates?.find(
    (item) => item.documentRef === "document.reform_execution_record"
  );
  assert.equal(reply?.label, "改桑放行回文");
  assert.equal(reply?.holderRef, "actor.xunfu_clerk");
  const replyBox = issued.event.sceneAfter.objectStates?.find(
    (item) => item.objectRef === "object.xunfu_reply_box"
  );
  assert.equal(replyBox?.holderRef, "actor.xunfu_clerk");
  assert.equal(replyBox?.contentsState, "CONTAINS_DOCUMENT");
  assert.equal(replyBox?.closureState, "CLOSED");
  const playerBeat = issued.event.narrativePlan.sceneBeats.find(
    (beat) => beat.sourceType === "PLAYER_ACTION"
  );
  assert.ok(playerBeat);
  assert.equal(
    playerBeat.requiredTermGroups.some(
      (group) => group.includes("改桑放行回文") && group.includes("回文")
    ),
    true
  );
  assert.equal(
    playerBeat.requiredTermGroups.some(
      (group) => group.includes("写明") && group.includes("另起一行")
    ),
    true
  );
  assert.equal(
    playerBeat.requiredTermGroups.some(
      (group) => group.includes("压价买田") && group.includes("压价买民田")
    ),
    true
  );
});

test("responsibility action beats preserve both the three-day limit and the governor's liability in natural prose", () => {
  const pkg = loadPartOneRuntimePackage("sangtian", configRoot).package;
  const opening = settlePartOneAction(
    pkg,
    createInitialPartOneState(pkg),
    {
      source: "RECOMMENDED",
      decisionId: "opening_d2",
      actionText: "将总督封缄令牌交给清流县令亲随，命他向清流县传达封存档房之令；同时当面答复巡抚书吏：暂缓签发，三日内复核。"
    },
    1
  );
  const execution = buildPartOneRuntimeWorkingSet(pkg, opening.proposedState, 1)
    .decisionAffordances
    .find((item) => item.affordanceTemplateId === "DK-P1-EXECUTION-SCOPE-OPT-03");
  assert.ok(execution);
  const responsibility = settlePartOneAction(
    pkg,
    opening.proposedState,
    {
      source: "RECOMMENDED",
      decisionId: execution.affordanceTemplateId,
      decisionKernelId: execution.decisionKernelId,
      affordanceTemplateId: execution.affordanceTemplateId,
      label: execution.title,
      actionText: execution.actionText,
      targetRef: execution.targetRef
    },
    2
  );
  const responsibilityBeat = responsibility.event.narrativePlan.sceneBeats.find(
    (beat) =>
      beat.sourceType === "PLAYER_ACTION"
      && beat.action.includes("延误责任")
  );
  assert.ok(responsibilityBeat);
  assert.match(
    responsibility.event.narrativePlan.settledActionNarrative || "",
    /今日仍不签.*责在本督/s
  );
  assert.equal(
    responsibility.event.nextDecisionPoint.decisionPointId,
    "DK-P1-RESPONSIBILITY-RECORD"
  );
  assert.match(
    responsibility.event.nextDecisionPoint.prompt,
    /怎样写进正式回文.*总督独自具名.*巡抚共同具名/
  );
  assert.deepEqual(
    responsibilityBeat.requiredTermGroups,
    [
      ["三日限期", "三日期限", "三日之限", "三日之内", "三日之期", "三日具报"],
      [
        "延误责任由本督承担",
        "责任由本督承担",
        "由本督承担",
        "责在本督",
        "本督一人承担"
      ]
    ]
  );
  const waitingBeat = responsibility.event.narrativePlan.sceneBeats.find(
    (beat) =>
      beat.sourceType === "PLAYER_ACTION"
      && beat.action.includes("待清流县回报封存结果")
  );
  assert.ok(waitingBeat);
  assert.equal(
    waitingBeat.requiredTermGroups.some((group) =>
      group.includes("封存结果")
      && group.includes("封存回报")
      && group.includes("封存是否完成")
    ),
    true
  );
});

test("xunfu countermove distinguishes future participation records from a pre-existing ledger", () => {
  const pkg = loadPartOneRuntimePackage("sangtian", configRoot).package;
  const policy = pkg.assets.find(
    (asset) => asset.assetId === "RTA-P1-XUNFU-COUNTERMOVE"
  );
  assert.ok(policy);
  const allowedMoves = policy.payload.allowedMoves as string[];
  assert.equal(
    allowedMoves.includes("要求参与复核，并要求复核发生时如实注明巡抚一方经手"),
    true
  );
  assert.equal(
    allowedMoves.some((move) => /底册|底簿|副本已经存在/.test(move)),
    false
  );
  const consequence = pkg.assets.find(
    (asset) => asset.assetId === "PCR-P1-XUNFU-COUNTERMOVE"
  );
  assert.ok(consequence);
  const payoffBeats = consequence.payload.payoffBeats as Array<{
    beatId: string;
    requiredTermGroups: string[][];
  }>;
  const visibilityBeat = payoffBeats.find(
    (beat) => beat.beatId === "PAYOFF-P1-XUNFU-VISIBILITY"
  );
  assert.ok(visibilityBeat);
  assert.equal(
    visibilityBeat.requiredTermGroups.some((group) => group.includes("另叙")),
    true
  );
});

test("responsibility choices describe executable actions from a paused branch without inventing a prior written boundary", () => {
  const pkg = loadPartOneRuntimePackage("sangtian", configRoot).package;
  const sealed = settlePartOneAction(
    pkg,
    createInitialPartOneState(pkg),
    {
      source: "RECOMMENDED",
      decisionId: "opening_d2",
      actionText: "将总督封缄令牌交给清流县令亲随，命他向清流县传达封存档房之令；同时当面答复巡抚书吏：暂缓签发，三日内复核。"
    },
    1
  );
  const afterOpening = finalizePartOneSettlement(sealed, []).proposedState;
  const execution = buildPartOneRuntimeWorkingSet(pkg, afterOpening, 1)
    .decisionAffordances
    .find((item) => item.affordanceTemplateId === "DK-P1-EXECUTION-SCOPE-OPT-03");
  assert.ok(execution);
  const paused = settlePartOneAction(pkg, afterOpening, {
    source: "RECOMMENDED",
    decisionKernelId: execution.decisionKernelId,
    affordanceTemplateId: execution.affordanceTemplateId,
    label: execution.title,
    actionText: execution.actionText,
    targetRef: execution.targetRef
  }, 2);
  assert.equal(
    paused.event.nextDecisionPoint.decisionPointId,
    "DK-P1-RESPONSIBILITY-RECORD"
  );
  assert.match(paused.event.narrativePlan.nextStoryBeat.stopCondition, /正式回文.*具名/u);
  assert.doesNotMatch(
    paused.event.narrativePlan.requiredEndChange,
    /派员到场|参与复核/
  );
  const pausedState = finalizePartOneSettlement(
    paused,
    paused.dueConsequences.map((item) => item.consequenceId)
  ).proposedState;
  assert.equal(
    pausedState.scene.documentStates?.some(
      (item) => item.documentRef === "document.reform_execution_record"
    ),
    false
  );

  const responsibility = buildPartOneRuntimeWorkingSet(pkg, pausedState, 2);
  assert.equal(responsibility.openDecisionKernel.assetId, "DK-P1-RESPONSIBILITY-RECORD");
  assert.equal(responsibility.decisionPoint.decisionPointId, "DK-P1-RESPONSIBILITY-RECORD");
  assert.equal(
    responsibility.decisionAffordances.every(
      (item) => item.decisionPointId === responsibility.decisionPoint.decisionPointId
    ),
    true
  );
  assert.deepEqual(
    responsibility.decisionAffordances.map((item) => item.actionText),
    [
      "把暂缓签发的缘由、复核办法与督抚各自责任写进正式回文，请巡抚共同具名。",
      "另具正式回文暂准放行，并逐项写明督抚分歧和各自承担的事项。"
    ]
  );
  for (const option of responsibility.decisionAffordances) {
    assert.doesNotMatch(option.actionText, /已经写明|现有公文|同一份回文/);
  }

  const release = responsibility.decisionAffordances.at(-1);
  assert.ok(release);
  const released = settlePartOneAction(pkg, pausedState, {
    source: "RECOMMENDED",
    decisionKernelId: release.decisionKernelId,
    affordanceTemplateId: release.affordanceTemplateId,
    label: release.title,
    actionText: release.actionText,
    targetRef: release.targetRef
  }, 3);
  assert.equal(released.proposedState.reform.executionMode, "PROVISIONAL_RELEASE");
  assert.equal(released.proposedState.reform.progress, "STARTED");
  assert.equal(
    released.event.sceneAfter.documentStates?.find(
      (item) => item.documentRef === "document.reform_execution_record"
    )?.accessState,
    "WRITTEN"
  );
});

test("responsibility choices preserve an already-issued limited-trial reply instead of writing it twice", () => {
  const pkg = loadPartOneRuntimePackage("sangtian", configRoot).package;
  const opening = settlePartOneAction(
    pkg,
    createInitialPartOneState(pkg),
    {
      source: "RECOMMENDED",
      decisionId: "opening_d2",
      actionText: "将总督封缄令牌交给清流县令亲随，命他向清流县传达封存档房之令；同时当面答复巡抚书吏：暂缓签发，三日内复核。"
    },
    1
  );
  const afterOpening = finalizePartOneSettlement(opening, []).proposedState;
  const execution = buildPartOneRuntimeWorkingSet(pkg, afterOpening, 1)
    .decisionAffordances
    .find((item) => item.affordanceTemplateId === "DK-P1-EXECUTION-SCOPE-OPT-01");
  assert.ok(execution);
  const issued = settlePartOneAction(pkg, afterOpening, {
    source: "RECOMMENDED",
    decisionKernelId: execution.decisionKernelId,
    affordanceTemplateId: execution.affordanceTemplateId,
    label: execution.title,
    actionText: execution.actionText,
    targetRef: execution.targetRef
  }, 2);
  const issuedState = finalizePartOneSettlement(
    issued,
    issued.dueConsequences.map((item) => item.consequenceId)
  ).proposedState;
  assert.equal(issuedState.reform.executionMode, "LIMITED_TRIAL");
  assert.equal(
    issuedState.scene.documentStates?.find(
      (item) => item.documentRef === "document.reform_execution_record"
    )?.holderRef,
    "actor.xunfu_clerk"
  );

  const responsibility = buildPartOneRuntimeWorkingSet(pkg, issuedState, 2);
  assert.equal(responsibility.openDecisionKernel.assetId, "DK-P1-RESPONSIBILITY-RECORD");
  assert.deepEqual(
    responsibility.decisionAffordances.map((item) => item.actionText),
    [
      "请巡抚在刚刚写成的改桑放行回文上共同具名，与总督共同承担清流试办和复核责任。",
      "维持放行回文不改，另具督抚责任说明：巡抚要求派员参与复核而总督尚未同意，巡抚若有异议须另行成文，督抚各担其责。"
    ]
  );
  for (const option of responsibility.decisionAffordances) {
    assert.doesNotMatch(option.actionText, /把清流县先行试办的边界[^。]*写进正式回文|另具正式回文暂准放行/);
  }

  const disagreement = responsibility.decisionAffordances.at(-1);
  assert.ok(disagreement);
  assert.equal(disagreement.stateEffects.includes("reform.executionMode"), false);
  assert.equal(
    Object.prototype.hasOwnProperty.call(disagreement.statePatch, "reform.executionMode"),
    false
  );
  const recorded = settlePartOneAction(pkg, issuedState, {
    source: "RECOMMENDED",
    decisionKernelId: disagreement.decisionKernelId,
    affordanceTemplateId: disagreement.affordanceTemplateId,
    label: disagreement.title,
    actionText: disagreement.actionText,
    targetRef: disagreement.targetRef
  }, 3);
  assert.equal(recorded.proposedState.reform.executionMode, "LIMITED_TRIAL");
  assert.equal(recorded.proposedState.reform.progress, "STARTED");
  assert.equal(
    recorded.event.sceneAfter.documentStates?.find(
      (item) => item.documentRef === "document.responsibility_record"
    )?.holderRef,
    "actor.zhejiang_governor"
  );
  assert.match(
    recorded.event.sceneAfter.documentStates?.find(
      (item) => item.documentRef === "document.responsibility_record"
    )?.continuityNote || "",
    /正文目前只由总督知晓.*未经玩家明确出示、宣读或移交/
  );
  assert.equal(
    recorded.event.authoritativeNpcReactions[0]?.action,
    recorded.event.nextDecisionPoint.prompt
  );
  const responsibilityBeat = recorded.event.narrativePlan.sceneBeats.find(
    (beat) => beat.sourceType === "PLAYER_ACTION" && /督抚责任说明/.test(beat.action)
  );
  assert.match(responsibilityBeat?.resultCeiling || "", /责任说明中只写三项/);
  assert.match(responsibilityBeat?.resultCeiling || "", /责任说明留在总督案前，不交给巡抚书吏/);
  assert.match(responsibilityBeat?.resultCeiling || "", /不得补写原册所在地、保管人、移交办法、材料披露范围/);
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
      assert.equal(settlement.event.authoritativeNpcReactions[0].actorRefs.includes("actor.xunfu_clerk"), true);
      assert.equal(
        settlement.event.authoritativeNpcReactions[0].action,
        settlement.event.nextDecisionPoint.prompt
      );
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
      assert.deepEqual(
        settlement.event.sceneAfter.presentActorRefs,
        ["actor.zhejiang_governor", "actor.xunfu_clerk"]
      );
      assert.match(
        settlement.event.sceneAfter.situation,
        /浙江总督、巡抚书吏仍在杭州总督府内厅/
      );
      assert.match(
        settlement.event.sceneAfter.situation,
        /清流县令亲随已领命离开当前现场，场外办理结果尚未回报/
      );
      assert.match(
        settlement.event.sceneAfter.situation,
        /改桑急令究竟按什么边界执行/
      );
      assert.equal(
        settlement.event.narrativePlan.sceneBeats
          .find((beat) => beat.sourceType === "NPC_REACTION")
          ?.requiredTermGroups
          .some((group) => group.length > 0),
        true
      );
      assert.doesNotMatch(
        settlement.event.sceneAfter.situation,
        /清流县令亲随留在厅中等候/
      );
    }
    if (turn === 3) {
      assert.equal(settlement.event.sectionTransitioned, true);
      assert.equal(
        settlement.event.authoritativeWorldMoves.some(
          (move) => move.sourceType === "NEXT_DECISION_PRESSURE"
        ),
        false,
        "the destination scene already owns the next playable question"
      );
      assert.match(
        settlement.event.actionText,
        /请巡抚在刚刚写成的改桑放行回文上共同具名/
      );
      assert.equal(
        settlement.event.authoritativeWorldMoves.filter(
          (move) => move.sourceType !== "SECTION_TRANSITION"
        ).length,
        1,
        "one turn may surface only one NPC/world pressure"
      );
      assert.equal(
        settlement.event.authoritativeWorldMoves.some(
          (move) => move.sourceType === "SETTLED_RESPONSE"
        ),
        true,
      );
      assert.equal(
        settlement.proposedState.pendingConsequences.some(
          (item) => item.ruleAssetId === "PCR-P1-EXECUTION-BOUNDARY" && item.status === "DUE"
        ),
        true,
        "an unselected due consequence stays due instead of being packed into the same beat"
      );
      assert.equal(
        settlement.event.sceneAfter.documentStates?.find(
          (item) => item.documentRef === "document.qingliu_register_original"
        )?.accessState,
        "NOT_PRESENT"
      );
      assert.equal(
        settlement.event.sceneAfter.documentStates?.some(
          (item) =>
            item.documentRef === "document.reform_execution_record"
            || item.documentRef === "document.responsibility_record"
        ),
        false
      );
      assert.equal(
        settlement.proposedState.responsibility.firstRecordStatus,
        "JOINT_SIGNATURE_REQUESTED"
      );
      const transition = settlement.event.authoritativeWorldMoves.find(
        (move) => move.sourceType === "SECTION_TRANSITION"
      );
      const transitionIndex = settlement.event.authoritativeWorldMoves.findIndex(
        (move) => move.sourceType === "SECTION_TRANSITION"
      );
      assert.ok(transitionIndex >= 0);
      assert.deepEqual(
        transition?.requiredTermGroups[0],
        ["嘉靖三十五年五月初九巳时", "五月初九巳时", "次日巳时"]
      );
      assert.deepEqual(
        transition?.requiredTermGroups[1],
        ["杭州总督府签押房", "签押房"]
      );
      assert.match(transition?.resultCeiling || "", /不得声称已经知道这些文书的笔迹、户头、具体内容或真伪/);
      const narrativeWorldBeats = settlement.event.narrativePlan.sceneBeats
        .filter((beat) => beat.sourceType === "WORLD_MOVE");
      assert.equal(
        narrativeWorldBeats.filter((beat) => beat.beatId.includes("+")).length,
        0,
        "the runtime must not concatenate multiple backstage moves into one prose instruction"
      );
      assert.match(
        settlement.event.narrativePlan.dramaticTask,
        /两封文书.*督抚责任关系/
      );
      assert.doesNotMatch(
        settlement.event.narrativePlan.dramaticTask,
        /原册、副本、封条、田契/
      );
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
        []
      );
      assert.equal(
        settlement.event.narrativePlan.playerSpeechMode,
        "INDIRECT_SPEECH_REQUIRED"
      );
    }
    if (turn === 5) {
      assert.deepEqual(settlement.event.narrativePlan.authorizedPlayerSpeech, []);
      assert.equal(
        settlement.event.narrativePlan.playerSpeechMode,
        "INDIRECT_SPEECH_REQUIRED"
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
  assert.equal(firstSectionNpcReactions[0].includes("边界执行"), true);
  assert.equal(/正式回文|具名/u.test(firstSectionNpcReactions[1]), true);
  assert.equal(firstSectionNpcReactions[2].includes("复核由谁主持"), true);
  assert.equal(new Set(firstSectionNpcReactions).size, 3);
  assert.equal(visitedSceneIds.size, 4);
  assert.equal(visitedTimeLabels.size, 4);
  assert.equal(sectionTransitionMoveCount, 3);
  assert.equal(duePayoffMoveCount, 12);
  assert.equal(
    state.pendingConsequences.filter((item) => item.status === "DUE").length,
    7,
    "pressures displaced by a higher-priority settled response remain auditable for later payoff"
  );
  assert.equal(nextPressureMoveCount, 5);
});

test("defers a due Part One consequence until its actor can legally enter the scene", () => {
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
  assert.equal(second.dueConsequences.length, 0);
  assert.equal(
    second.event.authoritativeWorldMoves.some(
      (move) => move.sourceType === "DUE_CONSEQUENCE"
    ),
    false
  );
  assert.equal(
    second.event.sceneAfter.presentActorRefs.includes("actor.xunfu_aide"),
    false
  );
  assert.equal(
    second.proposedState.pendingConsequences.some(
      (item) =>
        item.consequenceId === first.event.createdPendingConsequenceIds[0]
        && item.status === "DUE"
    ),
    true
  );
  assert.throws(
    () => finalizePartOneSettlement(
      second,
      [first.event.createdPendingConsequenceIds[0]]
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
