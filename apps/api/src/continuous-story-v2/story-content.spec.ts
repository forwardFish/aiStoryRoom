import assert from "node:assert/strict";
import { getGameDefinition } from "@ai-story/templates";
import { ContinuousStrategyContentService } from "../continuous-strategy/content.service";
import { containsRawEngineToken } from "./asset-language";
import { actionFromCandidate, buildCrossImpactNarrative, buildDeterministicResolution, buildDeterministicSituation, evaluateStageProgress, reviewCrossImpact, reviewDecisionSet, reviewStory, type StorySituationInput } from "./story-content";
import { candidateIntentDraft, guardPlayerIntentV2, intentInvariantDiff, planIntentAction } from "./player-intent";

const input: StorySituationInput = {
  role: {
    id: "role-governor", roleKey: "zhejiang_governor", roleName: "浙江总督", identity: "封疆大吏",
    publicInfo: "统筹浙江军政", hiddenSecret: "留有田契暗账线索", personalGoal: "稳住浙江",
    currentState: "粮价不稳", abilityText: "可调度总督衙门与密奏渠道", cannotDo: ["越过朝廷直接改写国策"]
  },
  stage: {
    stageKey: "s1", stageNumber: 1, title: "改桑急令", playableRoleKeys: ["zhejiang_governor"], systemRoleKey: "court",
    commonContest: { contestKey: "review", title: "执行边界与复核权", assetKey: "review", description: "县册与催办数字互相冲突，急令的边界尚无人敢写死。" },
    stateCatalog: [], factCatalog: [{ factKey: "fact_joint_review", visibility: "PUBLIC" }, { factKey: "fact_pause", visibility: "OBSERVABLE" }], assetCatalog: [], traceCatalog: [], interactionRequestCatalog: [], carriedFactKeys: [], systemActionKey: "system", nextStateKey: "s2", minimumDistinctPlayableInfluenceSources: 1
  },
  roleStage: {
    stageKey: "s1", roleKey: "zhejiang_governor", privateBrief: "巡抚催得太急，县令却握有原始底册。", personalPressure: "在不激怒京师的前提下保住复核权",
    mainCards: [
      { actionKey: "joint_review", title: "设立联合复核程序", objective: "让巡抚的催办令附上经手编号和县册复核期限", visibility: "PUBLIC", risk: "NORMAL", fallbackActionKey: "fallback", targetRoleKey: "xunfu", receipt: { receiptKey: "receipt", text: "复核印记已下发，催办必须留下底稿" }, effect: { effectKey: "effect", factKeys: ["fact_joint_review"], influenceEdges: [{ affectedRoleKey: "xunfu", effectKey: "impact", visibility: "PUBLIC" }], observableTraceKeys: [], interactionRequestKeys: [], nextStateKey: "s2" }, assetMutations: [{ assetKey: "asset_s1_review_authority", mutationType: "CLAIM", delta: 1, toRoleKey: "zhejiang_governor" }] },
      { actionKey: "pause_county", title: "暂缓清流县催征", objective: "封存原始县册，给清流县两日复核田契", visibility: "OBSERVABLE", risk: "HIGH", fallbackActionKey: "fallback", targetRoleKey: "county_magistrate", receipt: { receiptKey: "receipt2", text: "清流县原始底稿进入封存清单" }, effect: { effectKey: "effect2", factKeys: ["fact_pause"], influenceEdges: [], observableTraceKeys: [], interactionRequestKeys: [], nextStateKey: "s2" }, assetMutations: [{ assetKey: "asset_s1_magistrate_register_original", mutationType: "CLAIM", delta: 1, toRoleKey: "zhejiang_governor" }] }
    ]
  },
  worldSequence: 0, turnIndex: 1, locationLabel: "杭州·总督府", visibleFacts: [{ factKey: "world_hook", content: "杭州粮价已经连续上涨三日" }], incomingImpacts: []
};

const situation = buildDeterministicSituation(input);
assert.equal(reviewStory(situation.situationNarrative, input, "SITUATION").status, "PASS");
assert.equal(reviewDecisionSet(situation.decisions, input, { allowFixedActionKeys: true }).status, "PASS");
assert.ok(reviewDecisionSet(situation.decisions, input).issues.some((issue) => issue.startsWith("FIXED_RULE_CARD_PUBLISHED:")), "fixed rule cards must never pass the player-facing publication gate");
assert.ok(situation.situationNarrative.includes("杭州粮价"));
assert.ok(situation.decisions.every((decision) => !["保留证据并交叉核验", "推进本职方案并说明代价", "协调另一位角色的资源"].includes(decision.label)));
assert.ok(situation.decisions.every((decision) => decision.description.includes("杭州粮价已经连续上涨三日")));
assert.ok(situation.decisions.every((decision) => !containsRawEngineToken(`${decision.label} ${decision.description} ${decision.concreteCost} ${decision.expectedCountermove}`)));
assert.deepEqual(situation.decisions[0].requiredAssetKeys, [], "CLAIM is an outcome, not leverage the actor must already hold");
assert.deepEqual(situation.decisions[0].intentDraft.leverageKeys, [], "CLAIM must not leak into player leverage inputs");
assert.ok(situation.decisions[0].concreteCost.includes("复核权"));

const naturalOpening = `浙江巡抚把两份征数不同的县册送进内厅时，总督没有照着公文念章程，只问他为何杭州粮价已经连续上涨三日，催办数字却仍在一夜之间多出两成。巡抚端着茶盏解释州县统计仓促，眼神却始终避开案上的田契抄本。\n\n总督等他离开后才打开暗屉。若立刻上奏，证据尚不足以服人；但若继续等待，巡抚便可能先改掉经手记录。更鼓已经响过，明早复查文书就会送来，他必须在有限时间里决定先查底册、试探巡抚，还是动用密奏渠道。`;
assert.equal(reviewStory(naturalOpening, input, "SITUATION").status, "PASS", "natural prose must not be forced to repeat the full role registry label or internal chapter heading");
const naturalDialoguePause = naturalOpening.replace("解释州县统计仓促", "低声解释：“这……这只是州县统计仓促。”");
assert.equal(reviewStory(naturalDialoguePause, input, "SITUATION").status, "PASS", "an interior dialogue pause is natural prose, not a truncated story");
assert.ok(reviewStory(`${naturalOpening.slice(0, -1)}，总督提笔……`, input, "SITUATION").issues.includes("TRUNCATED_STORY_FRAGMENT"), "a story that actually ends on an ellipsis must still be rejected");

const impactedInput = {
  ...input,
  worldSequence: 1,
  incomingImpacts: [{ sourceRoleName: "浙江巡抚", content: "浙江巡抚送来一份限期复核的具名公文，要求总督府在日落前回复。" }]
};
const impactedSituation = buildDeterministicSituation(impactedInput);
assert.ok(impactedSituation.situationNarrative.includes("浙江巡抚"));
assert.ok(impactedSituation.situationNarrative.includes("杭州粮价已经连续上涨三日"));
assert.equal(reviewStory(impactedSituation.situationNarrative, impactedInput, "SITUATION").status, "PASS");

const action = actionFromCandidate(situation.decisions[0], input.roleStage.mainCards[0], "role-xunfu", "浙江巡抚");
const nextResultInput = { ...input, stage: { ...input.stage, stageNumber: 2, title: "县令密信" }, turnIndex: 2, worldSequence: 1, previousAction: action, previousResult: "联合复核程序已经启动" };
const result = buildDeterministicResolution(input, action, nextResultInput);
assert.equal(reviewStory(result.resultNarrative, input, "RESULT", action).status, "PASS");
const naturalOfficeAliasResult = result.resultNarrative.replaceAll("浙江巡抚", "巡抚");
const roleTargetAction = {
  ...action,
  normalizedIntent: {
    objective: action.intent,
    target: { type: "ROLE" as const, id: "role-xunfu", label: "浙江巡抚" },
    method: action.description,
    leverageKeys: [], visibility: "PUBLIC" as const, riskTolerance: "MEDIUM" as const,
    fallback: null, condition: null
  }
};
assert.equal(
  reviewStory(naturalOfficeAliasResult, input, "RESULT", roleTargetAction).status,
  "PASS",
  "natural prose may call 浙江巡抚 simply 巡抚 after the role has been established"
);
const splitObjectiveAction = {
  ...roleTargetAction,
  intent: "阻断巡抚提前转移其他县田亩底账的可能",
  normalizedIntent: {
    ...roleTargetAction.normalizedIntent,
    objective: "阻断巡抚提前转移其他县田亩底账的可能"
  }
};
const splitObjectiveResult = naturalOfficeAliasResult.replaceAll("稳住复核权", "扣住经手书吏");
const splitObjectiveNext = `${naturalOpening}\n\n巡抚仍可能趁三日期限未到，提前转移其他县的田亩底账，因此总督必须继续追查。`;
assert.ok(
  reviewStory(splitObjectiveResult, input, "RESULT", splitObjectiveAction).issues.includes("PLAYER_OBJECTIVE_NOT_PRESERVED"),
  "a result alone must not silently lose the player's strategic objective"
);
assert.equal(
  reviewStory(splitObjectiveResult, input, "RESULT", splitObjectiveAction, splitObjectiveNext).status,
  "PASS",
  "the result and its immediate next situation may preserve different halves of one causal intent"
);
const semanticContinuation = result.nextSituation!.situationNarrative.replaceAll("上一项决定", "联合复核");
assert.equal(
  reviewStory(semanticContinuation, nextResultInput, "SITUATION").status,
  "PASS",
  "the next story must preserve the previous action's meaning without mechanically repeating its button label"
);
assert.ok(result.nextSituation?.situationNarrative.includes("上一项决定"));
assert.ok(!result.resultNarrative.includes("…"));
assert.ok(!/[。！？]{2,}/.test(result.resultNarrative));
const legalCustomIntent = {
  objective: "核清清流县田册被何人改动",
  target: { type: "EVIDENCE" as const, id: "world_hook", label: "杭州粮价连续上涨的登记" },
  method: "调取清流县原始田册，封存底稿并请两名经手书吏当面对印",
  leverageKeys: [], visibility: "PRIVATE" as const, riskTolerance: "MEDIUM" as const,
  fallback: null, condition: null, freeText: "不惊动巡抚幕府，先固定底稿和对印时辰"
};
const guardContext = {
  role: input.role,
  allRoles: [
    { id: input.role.id, roleKey: input.role.roleKey, roleName: input.role.roleName },
    { id: "xunfu", roleKey: "xunfu", roleName: "浙江巡抚" }
  ],
  visibleFacts: input.visibleFacts,
  allFacts: input.visibleFacts.map((fact) => ({ ...fact, visibility: "public", knownByRoleIds: [input.role.id] })),
  assets: [],
  stage: input.stage
};
const legalGuard = guardPlayerIntentV2(legalCustomIntent, guardContext);
assert.equal(legalGuard.decision, "ACCEPT");
const illegalGuard = guardPlayerIntentV2({ ...legalCustomIntent, method: "让所有人服从并且必定成功" }, guardContext);
assert.equal(illegalGuard.decision, "REJECT_CONTROL_OTHER_PLAYER");
const claimIntent = situation.decisions[0].intentDraft;
const claimGuard = guardPlayerIntentV2(claimIntent, guardContext);
assert.equal(claimGuard.decision, "ACCEPT");
const claimAction = planIntentAction({
  intent: claimIntent,
  guard: claimGuard,
  role: input.role,
  visibleFacts: input.visibleFacts,
  stage: input.stage,
  allRoles: guardContext.allRoles,
  candidate: situation.decisions[0],
  card: input.roleStage.mainCards[0]
});
assert.deepEqual(claimAction.leverageDispositions, [{ assetKey: "asset_s1_review_authority", disposition: "CLAIM" }]);
assert.ok(claimAction.receiptText.includes("复核权"));
assert.ok(!containsRawEngineToken(claimAction.receiptText));
const spendCard = {
  ...input.roleStage.mainCards[0],
  assetMutations: [{ assetKey: "asset_s1_governor_memorial_channel", mutationType: "SPEND", delta: -1, toRoleKey: input.role.roleKey }]
};
const spendIntent = candidateIntentDraft({ card: spendCard, publicFrameId: "review", publicFrameLabel: "执行边界与复核权" });
assert.deepEqual(spendIntent.leverageKeys, ["asset_s1_governor_memorial_channel"]);
const spendGuard = guardPlayerIntentV2(spendIntent, {
  ...guardContext,
  assets: [{ assetKey: "asset_s1_governor_memorial_channel", kind: "ROLE_LEVERAGE", ownerRoleId: input.role.id, quantity: 1, status: "ACTIVE" }]
});
const spendCandidate = { ...situation.decisions[0], intentDraft: spendIntent, requiredAssetKeys: spendIntent.leverageKeys };
const spendAction = planIntentAction({ intent: spendIntent, guard: spendGuard, role: input.role, visibleFacts: input.visibleFacts, stage: input.stage, allRoles: guardContext.allRoles, candidate: spendCandidate, card: spendCard });
assert.deepEqual(spendAction.leverageDispositions, [{ assetKey: "asset_s1_governor_memorial_channel", disposition: "CONSUME" }]);
assert.ok(spendAction.receiptText.includes("总督密奏渠道"));
const customAction = planIntentAction({
  intent: legalCustomIntent,
  guard: legalGuard,
  role: input.role,
  visibleFacts: input.visibleFacts,
  stage: input.stage,
  allRoles: guardContext.allRoles
});
assert.equal(customAction.source, "CUSTOM");
assert.match(customAction.actionKey, /^custom:/);
assert.notDeepEqual(customAction.effectFactKeys, input.roleStage.mainCards[0].effect.factKeys);
assert.deepEqual(intentInvariantDiff(legalGuard.normalizedIntent, customAction.normalizedIntent), []);
const visibleCustomIntent = { ...legalCustomIntent, objective: situation.decisions[0].intentDraft.objective, method: `${situation.decisions[0].label}；${situation.decisions[0].description}`, visibility: "PUBLIC" as const };
const visibleCustomGuard = guardPlayerIntentV2(visibleCustomIntent, guardContext);
const visibleCustomAction = planIntentAction({ intent: visibleCustomIntent, guard: visibleCustomGuard, role: input.role, visibleFacts: input.visibleFacts, stage: input.stage, allRoles: guardContext.allRoles });
const visibleCustomResult = buildDeterministicResolution(input, visibleCustomAction, { ...input, turnIndex: 2, worldSequence: 1, previousAction: visibleCustomAction, previousResult: "联合复核程序已经启动" });
assert.equal(reviewStory(visibleCustomResult.resultNarrative, input, "RESULT", visibleCustomAction).status, "PASS");
assert.ok(reviewStory(`${visibleCustomResult.resultNarrative}\n\nasset_s3_grain_route`, input, "RESULT", visibleCustomAction).issues.includes("INTERNAL_ENGINE_TOKEN_LEAKED"));
assert.equal((visibleCustomResult.resultNarrative.match(/“/g) || []).length, (visibleCustomResult.resultNarrative.match(/”/g) || []).length);
assert.equal(evaluateStageProgress(action, input.stage, 1, 7).nextStageIndex, 2);
const privateFirstAction = { ...action, visibility: "PRIVATE" as const };
assert.deepEqual(evaluateStageProgress(privateFirstAction, input.stage, 1, 7), {
  stageAdvanced: false, nextStageIndex: 1, reason: "STAGE_EVIDENCE_PENDING", evidenceFactKeys: ["fact_joint_review"]
});
assert.equal(evaluateStageProgress(privateFirstAction, input.stage, 2, 7).reason, "ACCUMULATED_STAGE_EVIDENCE");

const game = getGameDefinition("sangtian");
const packageContent = new ContinuousStrategyContentService().forGame("sangtian", "sangtian_v1_2");
for (let stageIndex = 1; stageIndex <= 7; stageIndex += 1) {
  for (const roleKey of packageContent.package().contract.playableRoleKeys) {
    const definition = game.roles.find((role) => role.roleKey === roleKey)!;
    const exhaustiveInput: StorySituationInput = {
      role: {
        id: `role-${roleKey}`, roleKey, roleName: definition.roleName, identity: definition.identity,
        publicInfo: definition.publicInfo, hiddenSecret: definition.hiddenSecret, personalGoal: definition.personalGoal,
        currentState: definition.currentState, abilityText: definition.abilityText, cannotDo: definition.cannotDo
      },
      stage: packageContent.stage(stageIndex),
      roleStage: packageContent.roleStage(stageIndex, roleKey),
      worldSequence: stageIndex - 1, turnIndex: stageIndex, locationLabel: game.presentation.locationLabel,
      visibleFacts: [], incomingImpacts: []
    };
    const exhaustiveDraft = buildDeterministicSituation(exhaustiveInput);
    assert.equal(reviewStory(exhaustiveDraft.situationNarrative, exhaustiveInput, "SITUATION").status, "PASS", `story quality failed for ${roleKey} stage ${stageIndex}`);
    assert.equal(reviewDecisionSet(exhaustiveDraft.decisions, exhaustiveInput, { allowFixedActionKeys: true }).status, "PASS", `internal rule-card quality failed for ${roleKey} stage ${stageIndex}`);
    const firstCard = exhaustiveInput.roleStage.mainCards[0];
    const targetRole = game.roles.find((role) => role.roleKey === firstCard.targetRoleKey);
    const crossAction = actionFromCandidate(exhaustiveDraft.decisions[0], firstCard, targetRole ? `role-${targetRole.roleKey}` : null, targetRole?.roleName || null);
    const crossContext = {
      sourceRoleName: definition.roleName,
      targetRoleName: targetRole?.roleName || "另一位角色",
      stageTitle: exhaustiveInput.stage.title,
      locationLabel: game.presentation.locationLabel,
      action: crossAction
    };
    const crossImpact = buildCrossImpactNarrative(crossContext);
    assert.equal(reviewCrossImpact(crossImpact, crossContext).status, "PASS", `cross-impact story quality failed for ${roleKey} stage ${stageIndex}`);
    assert.ok(!crossImpact.includes("…"), `cross-impact was truncated for ${roleKey} stage ${stageIndex}`);
    assert.ok(!/[。！？]{2,}/.test(crossImpact), `cross-impact has duplicate punctuation for ${roleKey} stage ${stageIndex}`);
    const traceContext = { ...crossContext, mode: "TRACE" as const };
    const observableTrace = buildCrossImpactNarrative(traceContext);
    assert.equal(reviewCrossImpact(observableTrace, traceContext).status, "PASS", `observable trace quality failed for ${roleKey} stage ${stageIndex}`);
    assert.ok(!observableTrace.includes(definition.roleName), `observable trace leaked source role for ${roleKey} stage ${stageIndex}`);
    assert.ok(!observableTrace.includes(crossAction.label.slice(0, Math.min(8, crossAction.label.length))), `observable trace leaked action for ${roleKey} stage ${stageIndex}`);

    const resultDraft = buildDeterministicResolution(exhaustiveInput, crossAction, {
      ...exhaustiveInput,
      turnIndex: stageIndex + 1,
      worldSequence: stageIndex,
      previousAction: crossAction,
      previousResult: `${crossImpact}\n\n这份公文已经改变下一步能够使用的证据。`,
      incomingImpacts: [{ sourceRoleName: definition.roleName, content: crossImpact }]
    });
    assert.equal(reviewStory(resultDraft.resultNarrative, exhaustiveInput, "RESULT", crossAction).status, "PASS", `result story quality failed for ${roleKey} stage ${stageIndex}`);
    assert.ok(resultDraft.nextSituation, `next situation missing for ${roleKey} stage ${stageIndex}`);
    assert.equal(reviewStory(resultDraft.nextSituation!.situationNarrative, exhaustiveInput, "SITUATION").status, "PASS", `continued situation quality failed for ${roleKey} stage ${stageIndex}`);
    assert.ok(!resultDraft.nextSituation!.situationNarrative.includes("…"), `continued situation was truncated for ${roleKey} stage ${stageIndex}`);
    assert.ok(!/[。！？]{2,}/.test(resultDraft.nextSituation!.situationNarrative), `continued situation has duplicate punctuation for ${roleKey} stage ${stageIndex}`);
  }
}

console.log("continuous story v2 content quality: PASS");
