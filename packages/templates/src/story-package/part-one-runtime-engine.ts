import { createHash } from "node:crypto";
import type {
  PartOneActionSettlement,
  PartOneAuthoritativeWorldMove,
  PartOneCommittedEvent,
  PartOneConsequencePayoffBeat,
  PartOneNarrativePlan,
  PartOnePendingConsequenceState,
  PartOneRuntimeAffordance,
  PartOneRuntimeAsset,
  PartOneRuntimePackage,
  PartOneSceneState,
  PartOneRuntimeTarget,
  PartOneRuntimeWorkingSet,
  PartOneSectionContract,
  PartOneState,
  PartOneStateRule,
  PartOneTurnProgressReport
} from "./part-one-runtime-types";
import { selectNarrativeScenePatterns } from "./narrative-scene-pattern";

export type PartOneIncomingAction = {
  source: string;
  decisionId?: string | null;
  decisionKernelId?: string | null;
  affordanceTemplateId?: string | null;
  label?: string | null;
  actionText: string;
  targetRef?: string | null;
};

const TARGETS: Record<string, PartOneRuntimeTarget> = {
  "actor.zhejiang_governor": { type: "ROLE", id: "actor.zhejiang_governor", label: "浙江总督" },
  "actor.zhejiang_xunfu": { type: "ROLE", id: "actor.zhejiang_xunfu", label: "浙江巡抚" },
  "actor.qingliu_magistrate": { type: "PERSON", id: "actor.qingliu_magistrate", label: "清流县令" },
  "actor.reform_clerk": { type: "PERSON", id: "actor.reform_clerk", label: "改桑书吏" },
  "actor.jiangnan_merchant_head": { type: "PERSON", id: "actor.jiangnan_merchant_head", label: "江南商会会首" },
  "actor.xunfu_aide": { type: "PERSON", id: "actor.xunfu_aide", label: "巡抚幕僚" },
  "actor.xunfu_clerk": { type: "PERSON", id: "actor.xunfu_clerk", label: "巡抚书吏" },
  "actor.qingliu_messenger": { type: "PERSON", id: "actor.qingliu_messenger", label: "清流县令亲随" },
  "institution.grand_secretariat": { type: "INSTITUTION", id: "institution.grand_secretariat", label: "内阁" },
  "institution.sili": { type: "INSTITUTION", id: "institution.sili", label: "司礼监" },
  "institution.zhejiang_governor_yamen": { type: "INSTITUTION", id: "institution.zhejiang_governor_yamen", label: "浙江总督府" },
  "institution.capital_official_channel": { type: "INSTITUTION", id: "institution.capital_official_channel", label: "通政司正式递奏渠道" },
  "institution.capital_named_superior": { type: "INSTITUTION", id: "institution.capital_named_superior", label: "京师指定上级" },
  "evidence.qingliu_register_anomaly": { type: "EVIDENCE", id: "evidence.qingliu_register_anomaly", label: "清流县可疑县册" },
  "resource.official_grain": { type: "RESOURCE", id: "resource.official_grain", label: "官仓与借调粮" },
  "resource.official_document_channel": { type: "RESOURCE", id: "resource.official_document_channel", label: "总督行文与递奏渠道" },
};

const SECTION_SCENES: Record<string, PartOneSceneState> = {
  "SEC-P1-01": {
    sceneId: "SCENE-P1-S1-INNER-HALL",
    timeLabel: "嘉靖三十五年五月初八辰时",
    locationLabel: "杭州总督府内厅",
    presentActorRefs: [
      "actor.zhejiang_governor",
      "actor.xunfu_clerk",
      "actor.qingliu_messenger"
    ],
    situation: "巡抚书吏候取回文，清流县令亲随留在厅中等候；催办公文与密信都已由总督拆阅并收持，执行方式、复核起点和首份责任记录尚未定下。",
    documentStates: [
      {
        documentRef: "document.xunfu_urging_order",
        label: "巡抚催办公文",
        accessState: "READ",
        holderRef: "actor.zhejiang_governor",
        continuityNote: "总督已经读到三日具报的期限，公文留在总督案前。"
      },
      {
        documentRef: "document.qingliu_secret_letter",
        label: "清流县令密信",
        accessState: "READ",
        holderRef: "actor.zhejiang_governor",
        continuityNote: "总督已经读过密信中关于县册数字疑有改痕的内容；密信只报疑，不能定罪。"
      }
    ],
    objectStates: [
      {
        objectRef: "object.xunfu_reply_box",
        label: "巡抚回文匣",
        holderRef: "actor.xunfu_clerk",
        contentsState: "EMPTY",
        closureState: "CLOSED",
        continuityNote: "回文匣来时就是空的且匣盖合着，一直捧在巡抚书吏手中；未明确装入回文或开匣前，不得改变分量、内容或开合状态。"
      },
      {
        objectRef: "object.governor_seal_token",
        label: "总督封缄令牌",
        holderRef: "actor.zhejiang_governor",
        continuityNote: "封缄令牌起初由总督持有；交给清流县令亲随后，持有人必须随结算更新。"
      }
    ]
  },
  "SEC-P1-02": {
    sceneId: "SCENE-P1-S2-SIGNING-ROOM",
    timeLabel: "嘉靖三十五年五月初九巳时",
    locationLabel: "杭州总督府签押房",
    presentActorRefs: [
      "actor.zhejiang_governor",
      "actor.qingliu_magistrate",
      "actor.reform_clerk",
      "actor.xunfu_aide"
    ],
    situation: "清流县册的保管、书吏的接触方式和复核主持权进入同一场核验；县册原件和副本尚未呈到签押房，各方先要决定谁能接触、谁来见证。",
    documentStates: [
      {
        documentRef: "document.qingliu_register_original",
        label: "清流县册原件",
        accessState: "NOT_PRESENT",
        holderRef: null,
        continuityNote: "原件尚未呈到签押房，不得写成已经摆在案上、封条完好、已经翻阅或已经鉴定真伪。"
      },
      {
        documentRef: "document.qingliu_register_copy",
        label: "清流县册副本",
        accessState: "NOT_PRESENT",
        holderRef: null,
        continuityNote: "副本尚未制作或呈到，不得为了方便核验而临时补出样册、抄件或底簿。"
      }
    ]
  },
  "SEC-P1-03": {
    sceneId: "SCENE-P1-S3-GRAIN-HEARING",
    timeLabel: "嘉靖三十五年五月初九申时",
    locationLabel: "杭州总督府仪门内厅",
    presentActorRefs: [
      "actor.zhejiang_governor",
      "actor.qingliu_magistrate",
      "actor.jiangnan_merchant_head",
      "actor.xunfu_aide"
    ],
    situation: "粮食救急已经不能再停留在纸面；官粮、商粮、救济先后和民田边界必须在同一场议事中落到可执行条件。"
  },
  "SEC-P1-04": {
    sceneId: "SCENE-P1-S4-REPORT-ROOM",
    timeLabel: "嘉靖三十五年五月初十卯后",
    locationLabel: "杭州总督府签押房",
    presentActorRefs: [
      "actor.zhejiang_governor",
      "actor.xunfu_aide",
      "actor.qingliu_magistrate",
      "actor.reform_clerk",
      "actor.jiangnan_merchant_head"
    ],
    situation: "第一份入京叙述即将定稿；谁署名、附什么、由谁担责、走哪条渠道，会把地方分歧变成京师首先看到的事实。"
  }
};

const PRESSURE_WORLD_MOVE_ACTORS: Record<string, string[]> = {
  "PRESSURE-P1-S3-FIRST-RELIEF-DELIVERY": ["actor.qingliu_magistrate"],
  "PRESSURE-P1-S4-XUNFU-ASKS-FOR-COPY": ["actor.xunfu_aide"],
  "PRESSURE-P1-S4-MERCHANT-ASKS-FOR-GUARANTEE": ["actor.jiangnan_merchant_head"],
  "PRESSURE-P1-S4-WITNESS-ASKS-FOR-RULES": ["actor.qingliu_magistrate", "actor.reform_clerk"],
  "PRESSURE-P1-S4-XUNFU-WANTS-INTERIM-ORDER": ["actor.xunfu_aide"]
};

const OPENING_PATCHES: Record<string, { kernelId: string; patch: Record<string, unknown>; targetRef: string }> = {
  opening_d1: {
    kernelId: "DK-P1-REVIEW-INITIATION",
    targetRef: "evidence.qingliu_register_anomaly",
    patch: {
      "review.initiationStatus": "GOVERNOR_REVIEW_ORDERED",
      "evidence.chainStatus": "FRAGILE",
      "knowledgeTransfer": {
        topic: "governor_holds_document_for_review",
        senderRef: "actor.zhejiang_governor",
        recipientRef: "actor.zhejiang_xunfu",
        representativeRef: "actor.xunfu_clerk",
        deliveryMode: "IN_PERSON_REPRESENTATIVE",
        status: "DELIVERED"
      },
      "responsibility.governorExposure": { $delta: 1 }
    }
  },
  opening_d2: {
    kernelId: "DK-P1-REVIEW-INITIATION",
    targetRef: "actor.qingliu_magistrate",
    patch: {
      "review.initiationStatus": "GOVERNOR_SEAL_ORDERED",
      "evidence.chainStatus": "FRAGILE",
      "evidence.archiveSealStatus": "SEAL_ORDERED",
      "evidence.primaryCustodianRef": "actor.qingliu_magistrate",
      "knowledgeTransfer": {
        topic: "governor_seal_order_and_review_delay",
        senderRef: "actor.zhejiang_governor",
        recipientRef: "actor.zhejiang_xunfu",
        representativeRef: "actor.xunfu_clerk",
        deliveryMode: "IN_PERSON_REPRESENTATIVE",
        status: "DELIVERED"
      },
      "relations.governorXunfu": { $delta: -1 }
    }
  }
};

export function createInitialPartOneState(pkg: PartOneRuntimePackage): PartOneState {
  const state = clone(pkg.worldStart.state);
  state.scene = normalizeSceneState(state.scene, state.sectionId);
  state.completedKernelIds = [];
  state.sectionTurnNumber = 0;
  state.causalArcStages = Object.fromEntries(
    pkg.assets.filter((asset) => asset.assetId.startsWith("ARC-P1-")).map((asset) => [asset.assetId, "OPEN"])
  );
  state.lastCommittedEventId = null;
  state.partCompletionStatus = "IN_PROGRESS";
  return state;
}

export function partOneSceneForSection(sectionId: string): PartOneSceneState {
  return sceneForSection(sectionId);
}

export function settlePartOneAction(
  pkg: PartOneRuntimePackage,
  currentState: PartOneState,
  action: PartOneIncomingAction,
  turnNumber: number
): PartOneActionSettlement {
  const beforeState = clone(currentState);
  beforeState.scene = normalizeSceneState(beforeState.scene, beforeState.sectionId);
  const proposedState = clone(currentState);
  proposedState.scene = normalizeSceneState(proposedState.scene, proposedState.sectionId);
  proposedState.turnNumber = turnNumber;
  proposedState.pendingConsequences = Array.isArray(proposedState.pendingConsequences) ? proposedState.pendingConsequences : [];
  const dueConsequences = proposedState.pendingConsequences
    .filter((item) => ["PENDING", "DUE"].includes(item.status) && item.dueTurn <= turnNumber)
    .map((item) => ({ ...item, status: "DUE" as const }));
  const dueIds = new Set(dueConsequences.map((item) => item.consequenceId));
  proposedState.pendingConsequences = proposedState.pendingConsequences.map((item) => dueIds.has(item.consequenceId) ? { ...item, status: "DUE" } : item);

  const opening = action.decisionId ? OPENING_PATCHES[action.decisionId] : null;
  const currentWorkingSet = buildPartOneRuntimeWorkingSet(pkg, currentState, Math.max(0, turnNumber - 1));
  const appliedAffordance = opening ? null : findAffordance(currentWorkingSet, action);
  const decisionKernelId = opening?.kernelId || appliedAffordance?.decisionKernelId || null;
  const affordanceTemplateId = appliedAffordance?.affordanceTemplateId || null;
  const statePatch = clone(opening?.patch || appliedAffordance?.statePatch || {});
  const targetRef = opening?.targetRef || appliedAffordance?.targetRef || action.targetRef || "public_frame";
  const eventId = eventIdFor({ turnNumber, beforeState, action, decisionKernelId, affordanceTemplateId, statePatch });
  const changedStatePaths = applyStatePatch(proposedState, statePatch, eventId);

  if (decisionKernelId) {
    proposedState.completedKernelIds = unique([...(proposedState.completedKernelIds || []), decisionKernelId]);
  }
  const pendingRule = decisionKernelId ? findPendingRule(pkg, decisionKernelId, proposedState.sectionId) : null;
  const createdPendingConsequences: PartOnePendingConsequenceState[] = [];
  if (pendingRule) {
    const consequences = asStringArray(pendingRule.payload.consequences);
    const payoffBeats = Array.isArray(pendingRule.payload.payoffBeats)
      ? pendingRule.payload.payoffBeats
      : [];
    const consequenceIndex = consequenceIndexFor(action, appliedAffordance, consequences.length);
    const summary = consequences[consequenceIndex]
      || appliedAffordance?.visibleTradeoff
      || "这道命令引起的反制必须在下一回合兑现。";
    const payoffTemplate = payoffBeats[consequenceIndex]
      || fallbackPayoffBeat(pendingRule.assetId, summary, pendingRule.actorRefs);
    const consequenceId = `PC-P1-${String(turnNumber).padStart(2, "0")}-${digest(`${eventId}:${pendingRule.assetId}`).slice(0, 12)}`;
    const consequence: PartOnePendingConsequenceState = {
      consequenceId,
      causedByEventId: eventId,
      ruleAssetId: pendingRule.assetId,
      summary,
      payoffBeat: {
        ...clone(payoffTemplate),
        beatId: `${payoffTemplate.beatId}-${digest(consequenceId).slice(0, 8)}`,
        consequenceId
      },
      dueTurn: turnNumber + 1,
      priority: "P0",
      status: "PENDING"
    };
    proposedState.pendingConsequences.push(consequence);
    createdPendingConsequences.push(consequence);
  }

  const sectionBefore = beforeState.sectionId;
  const sceneBefore = clone(beforeState.scene);
  const sectionTransitioned = advanceSectionWhenGatesPass(pkg, proposedState, turnNumber);
  const sectionAfter = proposedState.sectionId;
  const sceneAfter = sectionTransitioned
    ? sceneForSection(sectionAfter)
    : clone(sceneBefore);
  applySceneCustodyEffects(sceneAfter, action);
  proposedState.scene = sceneAfter;
  if (sectionBefore !== sectionAfter) changedStatePaths.push("sectionId");
  if (!deepEqual(sceneBefore, sceneAfter)) changedStatePaths.push("scene");
  proposedState.sectionTurnNumber = sectionTransitioned ? 0 : Number(proposedState.sectionTurnNumber || 0) + 1;
  proposedState.lastCommittedEventId = eventId;
  if (sectionAfter === "SEC-P1-04" && turnNumber >= 20 && sectionExitPassed(pkg, proposedState, sectionAfter)) {
    proposedState.partCompletionStatus = "HANDOFF_READY";
  }
  updateArcStages(pkg, proposedState, sectionBefore, sectionAfter, sectionTransitioned);

  const authoritativeObservableFacts = buildAuthoritativeObservableFacts(action, statePatch, proposedState);
  const authoritativeNpcReactions = buildAuthoritativeNpcReactions(pkg, {
    eventId,
    sectionId: sectionBefore,
    decisionKernelId,
    targetRef,
    statePatch
  });
  const nextWorkingSet = buildPartOneRuntimeWorkingSet(pkg, proposedState, turnNumber);
  const authoritativeWorldMoves = buildAuthoritativeWorldMoves({
    dueConsequences,
    nextWorkingSet,
    sectionTransitioned,
    sectionBefore,
    sectionAfter,
    sceneBefore,
    sceneAfter
  });
  sceneAfter.presentActorRefs = unique([
    ...sceneAfter.presentActorRefs,
    ...authoritativeWorldMoves.flatMap((move) => move.actorRefs)
  ]);
  sceneAfter.situation = reconcileSceneSituationAfterSettlement({
    action,
    sceneBefore,
    sceneAfter,
    sectionTransitioned,
    authoritativeObservableFacts,
    authoritativeNpcReactions,
    authoritativeWorldMoves
  });
  proposedState.scene = sceneAfter;
  if (!deepEqual(sceneBefore, sceneAfter)) changedStatePaths.push("scene");
  const narrativePlan = buildNarrativePlan({
    action,
    section: requireSection(pkg, sectionAfter),
    sceneBefore,
    sceneAfter,
    sectionTransitioned,
    authoritativeObservableFacts,
    authoritativeNpcReactions,
    authoritativeWorldMoves
  });

  const event: PartOneCommittedEvent = {
    schemaVersion: "sangtian-part-one-event-v1",
    eventId,
    turnNumber,
    sectionIdBefore: sectionBefore,
    sectionIdAfter: sectionAfter,
    actionSource: action.source,
    decisionKernelId,
    affordanceTemplateId,
    actionText: action.actionText,
    targetRef,
    statePatch,
    changedStatePaths: unique(changedStatePaths),
    createdPendingConsequenceIds: createdPendingConsequences.map((item) => item.consequenceId),
    duePendingConsequenceIds: dueConsequences.map((item) => item.consequenceId),
    authoritativeObservableFacts,
    authoritativeNpcReactions,
    sceneBefore,
    sceneAfter,
    authoritativeWorldMoves,
    narrativePlan,
    sectionTransitioned
  };
  return { beforeState, proposedState, event, appliedAffordance, dueConsequences };
}

export function finalizePartOneSettlement(
  settlement: PartOneActionSettlement,
  paidPendingConsequenceIds: string[]
): PartOneActionSettlement {
  const authorizedPaid = new Set(
    settlement.event.authoritativeWorldMoves
      .filter((move) => move.sourceType === "DUE_CONSEQUENCE" && move.consequenceId)
      .map((move) => move.consequenceId!)
  );
  const unauthorized = paidPendingConsequenceIds.find((id) => !authorizedPaid.has(id));
  if (unauthorized) {
    throw new Error(`PART_ONE_CONSEQUENCE_PAYOFF_NOT_AUTHORIZED:${unauthorized}`);
  }
  const paid = new Set(paidPendingConsequenceIds);
  const proposedState = clone(settlement.proposedState);
  proposedState.pendingConsequences = proposedState.pendingConsequences.map((item) =>
    paid.has(item.consequenceId) ? { ...item, status: "PAID" as const } : item
  );
  return { ...settlement, proposedState };
}

export function buildPartOneTurnProgressReport(
  pkg: PartOneRuntimePackage,
  settlement: PartOneActionSettlement,
  input: { runId: string; playerActionId: string; paidPendingConsequenceIds: string[] }
): PartOneTurnProgressReport {
  const event = settlement.event;
  const kernel = event.decisionKernelId ? pkg.assets.find((asset) => asset.assetId === event.decisionKernelId) : null;
  const materialPaths = unique([
    ...event.changedStatePaths,
    ...(input.paidPendingConsequenceIds.length ? ["pendingConsequences"] : [])
  ]);
  const materialChanges = materialPaths
    .map((statePath) => ({
      statePath,
      before: getPath(settlement.beforeState, statePath),
      after: getPath(settlement.proposedState, statePath),
      sourceEventId: event.eventId
    }))
    .filter((change) => !deepEqual(change.before, change.after));
  const advancedDecisionKernelIds = event.decisionKernelId && !settlement.beforeState.completedKernelIds?.includes(event.decisionKernelId)
    ? [event.decisionKernelId]
    : [];
  const advancedRequirementIds = advancedDecisionKernelIds.length ? unique(kernel?.requirementIds || []) : [];
  const arcIds = unique([
    ...Object.keys(settlement.beforeState.causalArcStages || {}),
    ...Object.keys(settlement.proposedState.causalArcStages || {})
  ]);
  const causalArcTransitions = arcIds.flatMap((arcId) => {
    const fromStage = String(settlement.beforeState.causalArcStages?.[arcId] || "UNSET");
    const toStage = String(settlement.proposedState.causalArcStages?.[arcId] || "UNSET");
    return fromStage === toStage ? [] : [{ arcId, fromStage, toStage }];
  });
  const sectionBefore = requireSection(pkg, event.sectionIdBefore);
  const sectionExitGateDelta = sectionBefore.exitGates
    .filter((rule) => !evaluatePartOneRule(settlement.beforeState, rule) && evaluatePartOneRule(settlement.proposedState, rule))
    .map((rule) => rule.ruleId);
  const changedPaths = new Set(materialChanges.map((change) => change.statePath));
  const mainlineContributions: PartOneTurnProgressReport["mainlineContributions"] = [];
  if (advancedDecisionKernelIds.length || sectionExitGateDelta.length) mainlineContributions.push("ADVANCE_GATE");
  if ([...changedPaths].some((path) => /^(grain|responsibility|relations|land|merchant)\./.test(path))) mainlineContributions.push("ESCALATE_PRESSURE");
  if ([...changedPaths].some((path) => /^evidence\./.test(path))) mainlineContributions.push("REVEAL_EVIDENCE");
  if ([...changedPaths].some((path) => /^(review\.authority|evidence\.primaryCustodianRef|witness\.accessStatus)/.test(path))) mainlineContributions.push("CONTEST_EVIDENCE");
  if (input.paidPendingConsequenceIds.length) mainlineContributions.push("PAY_CONSEQUENCE");
  if (causalArcTransitions.length) mainlineContributions.push("TRANSFORM_ARC");
  const objectiveEvidenceCount = advancedDecisionKernelIds.length + sectionExitGateDelta.length + causalArcTransitions.length + input.paidPendingConsequenceIds.length;
  const hardValidationStatus = event.decisionKernelId && materialChanges.length && objectiveEvidenceCount ? "PASS" : "FAIL";
  const strength = hardValidationStatus === "FAIL"
    ? "FAIL"
    : materialChanges.length >= 2 && mainlineContributions.length >= 2 ? "STRONG" : "BRIDGE";
  return {
    schemaVersion: "turn-progress-report-v1",
    runId: input.runId,
    turnNumber: event.turnNumber,
    partId: "PART-01",
    sectionBefore: event.sectionIdBefore,
    sectionAfter: event.sectionIdAfter,
    playerActionId: input.playerActionId,
    consumedAffordanceId: event.affordanceTemplateId,
    materialChanges,
    npcReactionEventIds: event.authoritativeNpcReactions.map((reaction) => reaction.reactionEventId),
    advancedRequirementIds,
    advancedDecisionKernelIds,
    causalArcTransitions,
    paidPendingConsequenceIds: unique(input.paidPendingConsequenceIds),
    mainlineContributions: unique(mainlineContributions),
    sectionExitGateDelta,
    hardValidationStatus,
    strength
  };
}

export function buildPartOneRuntimeWorkingSet(
  pkg: PartOneRuntimePackage,
  state: PartOneState,
  turnNumber: number
): PartOneRuntimeWorkingSet {
  const section = requireSection(pkg, state.sectionId);
  const completed = new Set(state.completedKernelIds || []);
  const unresolved = section.activeDecisionKernelIds.find((id) => !completed.has(id));
  const selection = state.partCompletionStatus === "HANDOFF_READY"
    ? terminalHandoffPreviewKernel(pkg, section)
    : unresolved
      ? { kernelId: unresolved, openDecisionKernel: requireAsset(pkg, unresolved), continuationDecisionId: null, floorObligationId: null, nextDecisionPressure: null }
      : continuationDecisionForState(pkg, section, state);
  const { kernelId, openDecisionKernel, continuationDecisionId, floorObligationId, nextDecisionPressure } = selection;
  const options = Array.isArray(openDecisionKernel.payload.options) ? openDecisionKernel.payload.options : [];
  const requiredOptionCount = unresolved ? 3 : 2;
  if (options.length < requiredOptionCount) throw new Error(`PART_ONE_RUNTIME_KERNEL_OPTIONS_MISSING:${kernelId}`);
  const authoredAffordances = options.map((option) => adaptAffordanceForCurrentState({
    ...option,
    decisionKernelId: kernelId,
    target: runtimeTargetFor(option.targetRef)
  }, state));
  // The authoring asset keeps three independently reviewable affordances so
  // branches remain available. A live turn exposes exactly two: the clearest
  // opposing endpoints. This makes the player's decision readable and keeps
  // the Writer from narrating an unselected third action into the scene.
  const decisionAffordances = authoredAffordances.length === 2
    ? authoredAffordances
    : [authoredAffordances[0], authoredAffordances.at(-1)!];
  const sectionAssetIds = new Set(pkg.runtimeIndex.bySection[section.sectionId] || []);
  const related = pkg.assets.filter((asset) => sectionAssetIds.has(asset.assetId));
  const requirementIds = new Set(openDecisionKernel.requirementIds);
  const relatesToKernel = (asset: PartOneRuntimeAsset) =>
    asset.decisionKernelIds.includes(kernelId) || asset.requirementIds.some((id) => requirementIds.has(id));
  const selected = related.filter((asset) =>
    asset.assetId === kernelId ||
    asset.assetType === "NARRATIVE_STYLE_PROFILE" ||
    asset.assetType === "CAUSAL_ARC" ||
    asset.assetType === "SECTION_FLOOR_OBLIGATION" ||
    asset.assetType === "NARRATIVE_SCENE_PATTERN" ||
    (relatesToKernel(asset) && ["ACTOR_POLICY", "INSTITUTION_CAPABILITY", "CAUSAL_RULE", "CUSTODY_RULE", "KNOWLEDGE_RULE", "RESOURCE_CONSTRAINT", "PENDING_CONSEQUENCE_RULE"].includes(asset.assetType))
  );
  const narrativeScenePatterns = selectNarrativeScenePatterns(pkg.assets, {
    sectionId: section.sectionId,
    decisionKernelId: kernelId,
    requirementIds: [...requirementIds]
  });
  for (const pattern of narrativeScenePatterns) {
    if (!selected.some((asset) => asset.assetId === pattern.assetId)) selected.push(pattern);
  }
  const statePaths = unique([
    ...section.handoffStatePaths,
    ...openDecisionKernel.stateDependencies,
    ...decisionAffordances.flatMap((option) => option.stateEffects)
  ]);
  return {
    packageHash: pkg.immutableHash,
    authoringManifestHash: pkg.authoringManifestHash,
    partId: "PART-01",
    section,
    turnNumber,
    stateProjection: Object.fromEntries(statePaths.map((path) => [path, getPath(state, path)])),
    openDecisionKernel,
    decisionAffordances,
    activeCausalArcs: selected.filter((asset) => asset.assetType === "CAUSAL_ARC"),
    actorPolicies: selected.filter((asset) => asset.assetType === "ACTOR_POLICY"),
    institutionCapabilities: selected.filter((asset) => asset.assetType === "INSTITUTION_CAPABILITY"),
    pendingConsequenceRules: selected.filter((asset) => asset.assetType === "PENDING_CONSEQUENCE_RULE"),
    floorObligations: selected.filter((asset) => asset.assetType === "SECTION_FLOOR_OBLIGATION"),
    narrativeScenePatterns,
    nextDecisionPressure,
    styleProfile: pkg.styleProfile,
    forbiddenEarlyReveals: [...section.forbiddenEarlyReveals],
    retrievalTrace: {
      selectedAssetIds: unique(selected.map((asset) => asset.assetId)).sort(),
      sectionId: section.sectionId,
      decisionKernelId: kernelId,
      continuationDecisionId,
      floorObligationId,
      stateDependencyPaths: statePaths.sort()
    }
  };
}

function continuationDecisionForState(
  pkg: PartOneRuntimePackage,
  section: PartOneSectionContract,
  state: PartOneState
) {
  const continuationIndex = Math.max(0, Number(state.sectionTurnNumber || 0) - section.activeDecisionKernelIds.length);
  const candidates = section.floorObligationIds.flatMap((floorObligationId) => {
    const floor = requireAsset(pkg, floorObligationId);
    const decisions = Array.isArray(floor.payload.continuationDecisions) ? floor.payload.continuationDecisions : [];
    return decisions.map((decision) => ({ decision, floor, floorObligationId }));
  });
  const selected = candidates[continuationIndex];
  if (!selected) {
    throw new Error(`PART_ONE_RUNTIME_CONTINUATION_EXHAUSTED:${section.sectionId}:${continuationIndex}`);
  }
  const { decision, floor, floorObligationId } = selected;
  if (!section.activeDecisionKernelIds.includes(decision.basedOnDecisionKernelId)) {
    throw new Error(`PART_ONE_RUNTIME_CONTINUATION_KERNEL_OUTSIDE_SECTION:${decision.continuationDecisionId}`);
  }
  if (decision.worldPressure.sourceFloorAssetId !== floor.assetId) {
    throw new Error(`PART_ONE_RUNTIME_CONTINUATION_FLOOR_MISMATCH:${decision.continuationDecisionId}`);
  }
  const baseKernel = requireAsset(pkg, decision.basedOnDecisionKernelId);
  const stateDependencies = unique([
    ...baseKernel.stateDependencies,
    ...decision.options.flatMap((option) => option.stateEffects)
  ]);
  return {
    kernelId: baseKernel.assetId,
    openDecisionKernel: {
      ...baseKernel,
      stateDependencies,
      payload: {
        ...baseKernel.payload,
        continuationDecisionId: decision.continuationDecisionId,
        nextDecisionPressure: decision.worldPressure,
        options: clone(decision.options)
      }
    },
    continuationDecisionId: decision.continuationDecisionId,
    floorObligationId,
    nextDecisionPressure: clone(decision.worldPressure)
  };
}

function terminalHandoffPreviewKernel(pkg: PartOneRuntimePackage, section: PartOneSectionContract) {
  const baseKernel = requireAsset(pkg, "DK-P1-CAPITAL-CHANNEL");
  const kernelId = "PART-02-HANDOFF-PREVIEW";
  const options = [
    {
      affordanceTemplateId: "PART-02-HANDOFF-PREVIEW-GRAIN",
      title: "先查粮路",
      actionText: "进入第二部分后，先核清官粮、借调粮与商会粮源各能维持多久，再决定由谁承担开仓和运输。",
      targetRef: "resource.official_grain",
      method: "只读入口预告",
      immediateIntent: "把粮荒与供粮责任作为第二部分的第一条调查线。",
      visibleTradeoff: "先压住断粮风险，但急售田契的处置会晚一步",
      stateEffects: [],
      statePatch: {},
      createsPendingConsequence: false
    },
    {
      affordanceTemplateId: "PART-02-HANDOFF-PREVIEW-LAND",
      title: "先查卖田",
      actionText: "进入第二部分后，先核查急售田契、购田人和粮债关系，阻止救急粮变成兼并民田的入口。",
      targetRef: "evidence.qingliu_register_anomaly",
      method: "只读入口预告",
      immediateIntent: "把卖田与粮债关系作为第二部分的第一条调查线。",
      visibleTradeoff: "先守住民田边界，但粮食调度与米市安抚会承受更大压力",
      stateEffects: [],
      statePatch: {},
      createsPendingConsequence: false
    }
  ];
  return {
    kernelId,
    openDecisionKernel: {
      ...baseKernel,
      assetId: kernelId,
      decisionKernelIds: [kernelId],
      stateDependencies: [...section.handoffStatePaths],
      payload: {
        ...baseKernel.payload,
        minimumVisibleOptions: 2,
        maximumVisibleOptions: 2,
        allowFreeAction: false,
        terminalReadOnlyPreview: true,
        options
      }
    },
    continuationDecisionId: kernelId,
    floorObligationId: null,
    nextDecisionPressure: null
  };
}

function adaptAffordanceForCurrentState(
  affordance: PartOneRuntimeAffordance,
  state: PartOneState
): PartOneRuntimeAffordance {
  const existingExecutionReply = state.scene.documentStates?.some(
    (item) =>
      item.documentRef === "document.reform_execution_record"
      && item.accessState === "WRITTEN"
  ) === true;
  // G00 can already issue the seal order. If the player chose it, asking them
  // to "seal the archive first" again on the very next screen is a false
  // choice. Preserve the same strategic endpoint (continue the pause and own
  // its cost), but do not invent a new list or repeat an order already issued.
  if (
    affordance.affordanceTemplateId === "DK-P1-EXECUTION-SCOPE-OPT-03"
    && state.evidence?.archiveSealStatus === "SEAL_ORDERED"
  ) {
    return {
      ...affordance,
      title: "维持暂缓",
      actionText: "继续暂缓签发，待清流县回报封存结果后再议；三日限期内的延误责任由本督承担。",
      targetRef: "actor.zhejiang_xunfu",
      target: runtimeTargetFor("actor.zhejiang_xunfu"),
      immediateIntent: "不重复下达封档命令，等待既有命令的回报，并由总督承担眼前延误责任。",
      method: "候报担责",
      visibleTradeoff: "保留查证窗口，但朝廷与粮价压力继续上升",
      stateEffects: [
        "reform.executionMode",
        "responsibility.governorExposure"
      ],
      statePatch: {
        "reform.executionMode": "TEMPORARILY_PAUSED",
        "responsibility.governorExposure": { $delta: 1 }
      }
    };
  }

  // The responsibility kernel can be reached from several execution branches.
  // A paused branch has no written reform reply yet, while a limited-trial or
  // provisional-release branch may already have one. Player copy must describe
  // the action being chosen now; it may never presuppose a document or boundary
  // that the authoritative scene state does not contain.
  if (affordance.affordanceTemplateId === "DK-P1-RESPONSIBILITY-RECORD-OPT-01") {
    const actionText = existingExecutionReply
      ? "请巡抚在刚刚写成的改桑放行回文上共同具名，与总督共同承担清流试办和复核责任。"
      : `把${executionBoundaryLabel(state)}、复核办法与督抚各自责任写进正式回文，请巡抚共同具名。`;
    return {
      ...affordance,
      actionText,
      immediateIntent: actionText
    };
  }

  if (affordance.affordanceTemplateId === "DK-P1-RESPONSIBILITY-RECORD-OPT-02") {
    const actionText = existingExecutionReply
      ? "维持刚刚写成的放行回文不改；由总督另具责任说明，单独具名，并把巡抚催办原文作为附件留档。"
      : `由总督单独具名写明${executionBoundaryLabel(state)}，并把巡抚催办原文作为附件留档。`;
    return {
      ...affordance,
      actionText,
      immediateIntent: actionText
    };
  }

  if (affordance.affordanceTemplateId === "DK-P1-RESPONSIBILITY-RECORD-OPT-03") {
    const actionText = existingExecutionReply
      ? "维持刚刚写成的放行回文不改；由总督另具责任说明，逐项写明督抚对复核与材料披露的分歧，各自成文、各自担责。"
      : "另具正式回文暂准放行，并逐项写明督抚分歧和各自承担的事项。";
    const stateEffects = existingExecutionReply
      ? affordance.stateEffects.filter((path) => path !== "reform.executionMode")
      : unique([
          ...affordance.stateEffects,
          "reform.executionMode",
          "reform.progress"
        ]);
    const statePatch = existingExecutionReply
      ? {
          ...(affordance.statePatch || {}),
          "reform.executionMode": undefined,
          "reform.progress": "STARTED"
        }
      : {
          ...(affordance.statePatch || {}),
          "reform.executionMode": "PROVISIONAL_RELEASE",
          "reform.progress": "STARTED"
        };
    if (existingExecutionReply) delete statePatch["reform.executionMode"];
    return {
      ...affordance,
      actionText,
      immediateIntent: actionText,
      stateEffects,
      statePatch
    };
  }
  return affordance;
}

function executionBoundaryLabel(state: PartOneState) {
  switch (state.reform.executionMode) {
    case "TEMPORARILY_PAUSED":
      return "暂缓签发的缘由";
    case "LIMITED_TRIAL":
      return "清流县先行试办的边界";
    case "PROVISIONAL_RELEASE":
      return "暂准放行的条件";
    default:
      return "当前改桑执行边界";
  }
}

export function partOneRuntimeTargets(
  workingSet: PartOneRuntimeWorkingSet,
  extraActorRefs: string[] = []
) {
  return uniqueTargets([
    ...workingSet.decisionAffordances.map((item) => item.target),
    ...workingSet.section.foregroundActorRefs.map(runtimeTargetFor),
    ...extraActorRefs.map(runtimeTargetFor),
    { type: "PUBLIC_FRAME", id: "public_frame", label: "当前局势" }
  ]);
}

export function evaluatePartOneRule(state: PartOneState, rule: PartOneStateRule) {
  const value = getPath(state, rule.statePath);
  switch (rule.operator) {
    case "EQ": return deepEqual(value, rule.expectedValue);
    case "NEQ": return !deepEqual(value, rule.expectedValue);
    case "IN": return Array.isArray(rule.expectedValue) && rule.expectedValue.some((candidate) => deepEqual(value, candidate));
    case "NOT_NULL": return value !== null && value !== undefined;
    case "ANY_PENDING": return Array.isArray(value) && value.some((item) => item && typeof item === "object" && ["PENDING", "DUE", "DEFERRED_WITH_REASON", "TRANSFORMED"].includes(String((item as Record<string, unknown>).status || "PENDING")));
  }
}

export function sectionExitPassed(pkg: PartOneRuntimePackage, state: PartOneState, sectionId = state.sectionId) {
  const section = requireSection(pkg, sectionId);
  return section.exitGates.every((rule) => evaluatePartOneRule(state, rule));
}

function consequenceIndexFor(
  action: PartOneIncomingAction,
  appliedAffordance: PartOneRuntimeAffordance | null,
  consequenceCount: number
) {
  if (consequenceCount <= 1) return 0;
  const routeId = appliedAffordance?.affordanceTemplateId
    || action.affordanceTemplateId
    || action.decisionId
    || "";
  const optionNumber = Number(routeId.match(/(?:OPT-|opening_d)(\d+)$/i)?.[1] || 1);
  return Math.max(0, optionNumber - 1) % consequenceCount;
}

function fallbackPayoffBeat(
  ruleAssetId: string,
  summary: string,
  actorRefs: string[]
): Omit<PartOneConsequencePayoffBeat, "consequenceId"> {
  return {
    beatId: `PAYOFF-${ruleAssetId}`,
    actorRefs: actorRefs.slice(0, 2),
    action: summary,
    requiredTermGroups: requiredTermGroupsFor(summary),
    resultCeiling: "只让这项后果进入眼前局势，不得借此确认幕后主使、补造证据或替玩家作出下一步决定。"
  };
}

function buildAuthoritativeWorldMoves(input: {
  dueConsequences: PartOnePendingConsequenceState[];
  nextWorkingSet: PartOneRuntimeWorkingSet;
  sectionTransitioned: boolean;
  sectionBefore: string;
  sectionAfter: string;
  sceneBefore: PartOneSceneState;
  sceneAfter: PartOneSceneState;
}): PartOneAuthoritativeWorldMove[] {
  const moves: PartOneAuthoritativeWorldMove[] = input.dueConsequences.map((consequence) => {
    const payoff = consequence.payoffBeat
      || fallbackPayoffBeat(consequence.ruleAssetId, consequence.summary, []);
    return {
      beatId: payoff.beatId,
      sourceType: "DUE_CONSEQUENCE",
      sourceId: consequence.ruleAssetId,
      actorRefs: [...payoff.actorRefs],
      action: payoff.action,
      requiredTermGroups: clone(payoff.requiredTermGroups),
      resultCeiling: payoff.resultCeiling,
      consequenceId: consequence.consequenceId
    };
  });
  if (input.sectionTransitioned) {
    const presentActorLabels = input.sceneAfter.presentActorRefs
      .map((ref) => runtimeTargetFor(ref).label);
    const absentDocuments = (input.sceneAfter.documentStates || [])
      .filter((document) => document.accessState === "NOT_PRESENT")
      .map((document) => document.label);
    moves.push({
      beatId: `TRANSITION-${input.sectionBefore}-${input.sectionAfter}`,
      sourceType: "SECTION_TRANSITION",
      sourceId: input.sectionAfter,
      actorRefs: [...input.sceneAfter.presentActorRefs],
      action: `议事转到${input.sceneAfter.timeLabel}的${input.sceneAfter.locationLabel}；${input.sceneAfter.situation}`,
      requiredTermGroups: [
        timeLabelVariants(input.sceneAfter.timeLabel, input.sceneBefore.timeLabel),
        locationLabelVariants(input.sceneAfter.locationLabel)
      ],
      resultCeiling: [
        `只能从${input.sceneBefore.locationLabel}推进到${input.sceneAfter.locationLabel}这一处已批准场景，不得另加途中事件。`,
        `新场只允许${presentActorLabels.join("、")}到场，其他人物及随员不得出现。`,
        absentDocuments.length
          ? `${absentDocuments.join("、")}都尚未呈到，不得写成已经在案、已经启封或已经鉴定；新场人物只能争接触、见证和主持程序，不得声称已经知道这些文书的笔迹、户头、具体内容或真伪。`
          : ""
      ].filter(Boolean).join("")
    });
  }
  const pressure = input.nextWorkingSet.nextDecisionPressure;
  if (pressure) {
    moves.push({
      beatId: pressure.pressureId,
      sourceType: "NEXT_DECISION_PRESSURE",
      sourceId: pressure.sourceFloorAssetId,
      actorRefs: [...(PRESSURE_WORLD_MOVE_ACTORS[pressure.pressureId] || [])],
      action: pressure.summary,
      requiredTermGroups: requiredTermGroupsFor(pressure.summary),
      resultCeiling: "只把这项新压力带到玩家面前；不得替玩家答复，也不得提前写出两条可选行动的结果。"
    });
  }
  return moves;
}

function buildNarrativePlan(input: {
  action: PartOneIncomingAction;
  section: PartOneSectionContract;
  sceneBefore: PartOneSceneState;
  sceneAfter: PartOneSceneState;
  sectionTransitioned: boolean;
  authoritativeObservableFacts: string[];
  authoritativeNpcReactions: PartOneCommittedEvent["authoritativeNpcReactions"];
  authoritativeWorldMoves: PartOneAuthoritativeWorldMove[];
}): PartOneNarrativePlan {
  const actorRefsAtSceneStart = new Set(input.sceneBefore.presentActorRefs);
  const actorRefsAtSceneEnd = new Set(input.sceneAfter.presentActorRefs);
  const sceneStartActorLabels = input.sceneBefore.presentActorRefs
    .map((ref) => runtimeTargetFor(ref).label);
  const sceneEndActorLabels = input.sceneAfter.presentActorRefs
    .map((ref) => runtimeTargetFor(ref).label);
  const authorizedActorArrivals = input.sceneAfter.presentActorRefs
    .filter((ref) => !actorRefsAtSceneStart.has(ref))
    .map((ref) => runtimeTargetFor(ref).label);
  const authorizedActorDepartures = input.sectionTransitioned
    ? []
    : input.sceneBefore.presentActorRefs
      .filter((ref) => !actorRefsAtSceneEnd.has(ref))
      .map((ref) => runtimeTargetFor(ref).label);
  const departureBeats: PartOneNarrativePlan["sceneBeats"] = authorizedActorDepartures.map(
    (label, index) => ({
      beatId: `SCENE-DEPARTURE-${index + 1}`,
      sourceType: "WORLD_MOVE" as const,
      action: `${label}完成本轮获批的现场动作后领命退出${input.sceneBefore.locationLabel}；只写离场，不得写已经抵达目的地、完成封存或带回结果。`,
      requiredTermGroups: [
        [label],
        [
          "领命退出",
          "领命退下",
          "退出内厅",
          "离开内厅",
          "退了出去",
          "转身出门",
          "推门出去",
          "便出去了",
          "走了出去",
          "躬身出去",
          "出了厅门",
          "步出内厅",
          "侧身而出",
          "走向厅门",
          "跨过门槛",
          "脚步声往甬道",
          "脚步声很快远了",
          "脚步声渐远",
          "领命而去"
        ]
      ],
      resultCeiling: "只允许把已在场人物写出当前房间，不得补写赶路、抵达、封存完成或场外回报。",
      mustAppear: true
    })
  );
  const sceneBeats: PartOneNarrativePlan["sceneBeats"] = [
    ...buildPlayerActionSceneBeats(input.action.actionText),
    ...departureBeats,
    ...input.authoritativeObservableFacts.map((fact, index) => ({
      beatId: `CONFIRMED-EFFECT-${index + 1}`,
      sourceType: "CONFIRMED_EFFECT" as const,
      action: fact,
      requiredTermGroups: requiredTermGroupsFor(fact),
      mustAppear: /^清流县令亲随当场只确认/.test(fact)
    })),
    ...input.authoritativeNpcReactions.map((reaction) => ({
      beatId: reaction.reactionEventId,
      sourceType: "NPC_REACTION" as const,
      action: reaction.action,
      requiredTermGroups: requiredTermGroupsFor(reaction.action),
      resultCeiling: resultCeilingForNpcReaction(reaction.action),
      mustAppear: true
    })),
    ...input.authoritativeWorldMoves.map((move) => ({
      beatId: move.beatId,
      sourceType: "WORLD_MOVE" as const,
      action: move.action,
      requiredTermGroups: clone(move.requiredTermGroups),
      resultCeiling: move.resultCeiling,
      mustAppear: true
    }))
  ];
  const lastMove = input.authoritativeWorldMoves.at(-1)?.action
    || input.authoritativeNpcReactions.at(-1)?.action
    || input.authoritativeObservableFacts.at(-1)
    || input.action.actionText;
  const incidentalTextureAllowances = buildIncidentalTextureAllowances(
    input.sceneBefore,
    input.sceneAfter
  );
  return {
    sceneStart: clone(input.sceneBefore),
    sceneEnd: clone(input.sceneAfter),
    presentActorLabels: unique([...sceneStartActorLabels, ...sceneEndActorLabels]),
    sceneStartActorLabels,
    sceneEndActorLabels,
    transitionAllowed: input.sectionTransitioned,
    authorizedActorArrivals,
    authorizedActorDepartures,
    dramaticTask: input.section.dramaticPurpose,
    actionAlreadyOccurred: input.action.actionText,
    playerSpeechMode: resolvePlayerSpeechMode(input.action.actionText),
    authorizedPlayerSpeech: extractExplicitPlayerQuotes(input.action.actionText),
    confirmedEffects: [...input.authoritativeObservableFacts],
    unresolvedFacts: [
      "密信和异常只能证明需要复核，不能直接证明巡抚、商会或任何个人有罪。",
      ...input.section.forbiddenEarlyReveals
    ],
    npcAgenda: input.authoritativeNpcReactions.map((reaction) => reaction.action),
    sceneBlocking: input.sectionTransitioned
      ? [
          `先在${input.sceneBefore.locationLabel}完成玩家行动及其即时回应。`,
          `只有写完已授权的世界行动后，才转到${input.sceneAfter.timeLabel}的${input.sceneAfter.locationLabel}。`,
          `转场后的现场只允许${input.sceneAfter.presentActorRefs.map((ref) => runtimeTargetFor(ref).label).join("、")}在场；其他人物、随员和未呈到的文书不得随转场出现。`,
          ...(input.sceneAfter.documentStates || [])
            .filter((document) => document.accessState === "NOT_PRESENT")
            .map((document) => document.continuityNote)
        ]
      : [
          `本轮始于并结束于${input.sceneBefore.timeLabel}的${input.sceneBefore.locationLabel}。`,
          authorizedActorArrivals.length
            ? `只允许${authorizedActorArrivals.join("、")}按已列世界行动加入现场；其上级、随员和其他人物不得随同到场。`
            : "本轮没有获批的新人物入场。",
          authorizedActorDepartures.length
            ? `${authorizedActorDepartures.join("、")}完成本轮现场动作后必须领命离场；只能写出门，不得写抵达或场外办理结果。`
            : "本轮没有必须离场的人物。",
          "只让已点名的在场人物行动，不补写赶路、回报或场外完成结果。",
          "未列人物不得由在场人物陪同带入，也不得借“本人”“落座”或随后用“他”承接的方式间接到场；代表发言不等于其上级本人在场。"
        ],
    incidentalTextureAllowances,
    sceneBeats,
    requiredEndChange: lastMove,
    narrativeCeiling: [
      "只呈现本计划列出的玩家行动、确认结果、NPC 回应与世界行动。",
      "不得新增人物、文书、证据、数量、期限、发现、承诺或办理完成结果。",
      "不得替玩家追加第二个行动或提前回答下一组决策。",
      ...(input.sectionTransitioned
        ? [
            "转场前只写本轮玩家新增的动作、明确列出的 NPC 回应和到期后果，不复述 Recent Canon 已写过的文书状态、比喻或压力句。",
            "转场后只建立新场人物与程序争点；未呈到的文书不能成为任何人物陈述笔迹、户头、具体内容、真伪或经手事实的依据。"
          ]
        : []),
      "未知保持未知，禁止提前确认幕后主使或暗账全貌。"
    ]
  };
}

function buildIncidentalTextureAllowances(
  sceneStart: PartOneSceneState,
  sceneEnd: PartOneSceneState
): PartOneNarrativePlan["incidentalTextureAllowances"] {
  const startDocumentRefs = new Set(
    (sceneStart.documentStates || [])
      .map((document) => document.documentRef)
      .filter(Boolean)
  );

  return (sceneEnd.documentStates || [])
    .filter((document) =>
      document.accessState === "WRITTEN"
      && Boolean(document.documentRef)
      && !startDocumentRefs.has(document.documentRef)
    )
    .map((document) => ({
      allowanceId: `TEXTURE-CREATE-${document.documentRef}`,
      textureClass: "CREATION_SUBSTRATE" as const,
      lifecycle: "CONSUMED_INTO_TARGET" as const,
      targetEntityKind: "DOCUMENT" as const,
      targetEntityRef: document.documentRef,
      targetEntityLabel: document.label
    }));
}

function hasExplicitPlayerQuote(actionText: string) {
  return /[“"]([^”"]{2,160})[”"]/.test(actionText);
}

function resolvePlayerSpeechMode(
  actionText: string
): PartOneNarrativePlan["playerSpeechMode"] {
  if (hasExplicitPlayerQuote(actionText)) return "EXACT_QUOTE_ALLOWED";
  if (
    /(?:命|令|吩咐|嘱咐|责成|要求|告知|答复|回告|回应|追问|只问|询问|宣告|通知)/.test(
      actionText
    )
  ) {
    return "INDIRECT_SPEECH_REQUIRED";
  }
  return "INDIRECT_ONLY";
}

function extractExplicitPlayerQuotes(actionText: string) {
  const candidates = [...actionText.matchAll(/[“"]([^”"]{2,160})[”"]/g)]
    .map((match) => match[1]);
  return unique(
    candidates
      .map((candidate) => candidate.trim())
      .filter(Boolean)
  );
}

function buildPlayerActionSceneBeats(
  actionText: string
): PartOneNarrativePlan["sceneBeats"] {
  return splitPlayerActionClauses(actionText).map((action, index) => ({
    beatId: `PLAYER-ACTION-${index + 1}`,
    sourceType: "PLAYER_ACTION" as const,
    action,
    requiredTermGroups: requiredTermGroupsFor(action),
    resultCeiling: resultCeilingForPlayerAction(action),
    mustAppear: true
  }));
}

function resultCeilingForPlayerAction(action: string) {
  if (
    /(?:改桑)?放行回文/.test(action)
    && /写明|写进|写入/.test(action)
  ) {
    return "浙江总督当场提笔写成名为“改桑放行回文”的文书，文中只写清流县先办一批和不得趁急难压价买田；写成后交给巡抚书吏。普通纸张与笔墨只能作为写成这份回文的一次性过程，落字后就是同一份改桑放行回文，不得另成第二份文书、底稿、证据或后续物件。";
  }

  if (/封缄令牌|总督令牌/.test(action) && /交给|交予|递给/.test(action)) {
    return "只写令牌从总督交到亲随手中；不得补写令牌原先藏在何处、函套、材质、纹样、重量或其他未列属性。";
  }
  if (/封存档房/.test(action) && /命|令|吩咐|传达/.test(action)) {
    return "只传达封存档房这项命令；可用“候上命再启”写出封存的最低限度含义，但不得扩写钥匙归属、册籍清单、出入禁令、具体启封人员、差员到场或其他封存程序。";
  }
  if (/暂缓签发|暂不签发/.test(action) && /三日内复核/.test(action)) {
    return "只写暂缓签发并在三日内复核；不得承诺复核后一定落印、再定行止或另给新期限。";
  }
  return "只把这项已经结算的行动写清，不增加第二项命令、承诺、程序或办理结果。";
}

function resultCeilingForNpcReaction(action: string) {
  if (
    /巡抚书吏/.test(action)
    && /三日期限内书面回复/.test(action)
    && /复核的范围与方式/.test(action)
  ) {
    return "只让巡抚书吏追问暂缓缘由，并要求三日内书面说明复核范围与方式；不得给催办公文补写日期、落款、原话或其他内容，也不得另造期限、程序或事实。";
  }
  return "只写这项已经结算的 NPC 反应，不增加其尚未知晓的事实、文书内容、期限、命令、承诺或场外结果。";
}

function splitPlayerActionClauses(actionText: string) {
  const clauses: string[] = [];
  let current = "";
  let closingQuote: string | null = null;
  const closingQuoteFor: Record<string, string> = {
    "“": "”",
    "\"": "\"",
    "‘": "’",
    "'": "'"
  };
  const characters = [...actionText.trim()];
  for (let index = 0; index < characters.length; index += 1) {
    const char = characters[index]!;
    if (!closingQuote && closingQuoteFor[char]) {
      closingQuote = closingQuoteFor[char];
      current += char;
      continue;
    }
    if (closingQuote && char === closingQuote) {
      closingQuote = null;
      current += char;
      continue;
    }
    if (!closingQuote && /[；;。]/.test(char)) {
      const clause = current.trim();
      if (clause) clauses.push(clause);
      current = "";
      continue;
    }
    if (
      !closingQuote
      && /[，,]/.test(char)
      && /^(?:命|令|吩咐|嘱咐|责成|要求|告知|答复|回告|示意)/.test(
        characters.slice(index + 1).join("").trimStart()
      )
    ) {
      const clause = current.trim();
      if (clause) clauses.push(clause);
      current = "";
      continue;
    }
    current += char;
  }
  const tail = current.trim();
  if (tail) clauses.push(tail);
  return clauses.length ? clauses : [actionText.trim()];
}

function requiredTermGroupsFor(text: string): string[][] {
  const groups: string[][] = [];
  const candidates: Array<[RegExp, string[]]> = [
    [/封缄令牌|总督令牌/, ["封缄令牌", "总督令牌", "令牌"]],
    [
      /交给|交予|递给/,
      ["交给", "交到", "交予", "递给", "递到", "搁到", "放到", "接过", "接下"]
    ],
    [
      /命他|命其|传达[^。；！？]{0,12}之令|下令/,
      [
        "EXACT:命他",
        "EXACT:命其",
        "EXACT:命亲随",
        "EXACT:命清流县令亲随",
        "EXACT:吩咐他",
        "EXACT:吩咐亲随",
        "EXACT:吩咐清流县令亲随",
        "EXACT:责令",
        "EXACT:下令",
        "EXACT:交代他",
        "EXACT:交代亲随"
      ]
    ],
    [/封存档房/, ["封存档房", "档房封存", "封住档房"]],
    [
      /回报[^。；！？]{0,8}封存结果|封存结果/,
      ["封存结果", "封存回报", "封存情形", "回报封存", "封存是否完成"]
    ],
    [/三日内复核/, ["三日内复核", "三日期限内复核"]],
    [
      /三日(?:限期|期限|之限|之内)/,
      ["三日限期", "三日期限", "三日之限", "三日之内"]
    ],
    [
      /延误责任[^。；！？]{0,12}(?:由本督承担|本督承担)|责在本督|由本督承担|本督一人承担/,
      [
        "延误责任由本督承担",
        "责任由本督承担",
        "由本督承担",
        "责在本督",
        "本督一人承担"
      ]
    ],
    [/暂缓签发|暂不签发/, ["暂缓签发", "暂不签发", "扣下不签"]],
    [
      /答复[^。；！？]{0,8}(?:巡抚)?书吏/,
      [
        "EXACT:答复巡抚书吏",
        "EXACT:答复书吏",
        "EXACT:告知巡抚书吏",
        "EXACT:告知书吏",
        "EXACT:告诉巡抚书吏",
        "EXACT:告诉书吏",
        "EXACT:回告巡抚书吏",
        "EXACT:回告书吏",
        "EXACT:面告巡抚书吏",
        "EXACT:面告书吏",
        "EXACT:对巡抚书吏说明",
        "EXACT:对书吏说明",
        "EXACT:向巡抚书吏说明",
        "EXACT:向书吏说明",
        "EXACT:命书吏转告",
        "EXACT:总督转向他，当面答复",
        "EXACT:总督转面答复",
        "EXACT:总督当面答复"
      ]
    ],
    [
      /只准清流县先办一批|清流县先办一批|限定试办/,
      ["只准清流县先办一批", "清流县先办一批", "清流县试办", "清流试办", "限定试办"]
    ],
    [/清流县试办|清流试办|执行范围/, ["清流县试办", "清流试办", "执行范围"]],
    [/(?:改桑)?放行回文/, ["改桑放行回文", "放行回文", "回文"]],
    [
      /(?:写进|写入|写明)[^。；！？]{0,12}(?:改桑)?放行回文|(?:改桑)?放行回文[^。；！？]{0,12}(?:写明|写有)/,
      ["写明", "书明", "写进", "写入", "落笔", "批明", "另起一行", "补入", "添入", "补写"]
    ],
    [/压价买田|买田|购田/, ["压价买田", "低价买田", "趁急难买田", "购田"]],
    [/巡抚幕僚|幕僚/, ["巡抚幕僚", "幕僚"]],
    [/巡抚书吏|书吏/, ["巡抚书吏", "书吏"]],
    [
      /清流县令亲随|县令亲随|清流亲随/,
      ["清流县令亲随", "县令亲随", "清流亲随", "亲随"]
    ],
    [/清流县令(?!亲随)|县令(?!亲随)/, ["清流县令", "县令"]],
    [/(?:仅为报疑|只报疑|只敢报疑)/, ["仅为报疑", "只报疑", "只敢报疑"]],
    [
      /原册[^。；！？]{0,18}(?:并未|未|没有)随信送来/,
      ["原册并未随信送来", "原册未随信送来", "原册没有随信送来"]
    ],
    [/改桑书吏/, ["改桑书吏", "书吏"]],
    [/商会会首|会首/, ["商会会首", "会首"]],
    [/首批救粮|救粮/, ["首批救粮", "救粮"]],
    [/县册|册页|原册/, ["县册", "册页", "原册"]],
    [/封存|封条/, ["封存", "封条", "封缄"]],
    [/复核/, ["复核"]],
    [/奏报|首报|入京/, ["奏报", "首报", "入京"]],
    [/粮|米行|开仓/, ["粮", "米", "仓"]],
    [/民田|卖田|购田|买田|田契/, ["民田", "卖田", "购田", "买田", "田契"]],
    [/具名|署名|联署/, ["具名", "署名", "联署"]],
    [/责任说明/, ["责任说明", "责任文书", "责任记录"]],
    [/各自成文|各自担责/, ["各自成文", "分别成文", "各自担责", "分别担责"]],
    [/底稿|摘要/, ["底稿", "摘要"]],
    [/担保|官保/, ["担保", "官保"]],
    [/保护令|传唤|问讯/, ["保护", "传唤", "问讯"]]
  ];
  for (const [pattern, terms] of candidates) {
    if (pattern.test(text)) groups.push(terms);
  }
  if (!groups.length) {
    const key = text.replace(/[，。；：、“”‘’！？\s]/g, "").slice(0, 4);
    if (key) groups.push([key]);
  }
  return groups;
}

function normalizeSceneState(
  scene: PartOneSceneState | undefined,
  sectionId: string
): PartOneSceneState {
  const fallback = sceneForSection(sectionId);
  if (!scene || !scene.sceneId || !scene.timeLabel || !scene.locationLabel) return fallback;
  return {
    sceneId: String(scene.sceneId),
    timeLabel: String(scene.timeLabel),
    locationLabel: String(scene.locationLabel),
    presentActorRefs: unique(Array.isArray(scene.presentActorRefs) ? scene.presentActorRefs.map(String) : fallback.presentActorRefs),
    situation: String(scene.situation || fallback.situation),
    documentStates: Array.isArray(scene.documentStates)
      ? clone(scene.documentStates)
      : clone(fallback.documentStates || []),
    objectStates: Array.isArray(scene.objectStates)
      ? clone(scene.objectStates)
      : clone(fallback.objectStates || [])
  };
}

function applySceneCustodyEffects(
  scene: PartOneSceneState,
  action: PartOneIncomingAction
) {
  scene.objectStates = clone(scene.objectStates || []);
  if (
    action.actionText.includes("总督封缄令牌")
    && action.actionText.includes("交给清流县令亲随")
  ) {
    const token = scene.objectStates.find(
      (item) => item.objectRef === "object.governor_seal_token"
    );
    if (token) {
      token.holderRef = "actor.qingliu_messenger";
      token.continuityNote = "总督已经把封缄令牌交给清流县令亲随；除非后续明确结算交还，不得再写回总督手中。";
    }
    if (/(?:传达|回县|封存档房)/.test(action.actionText)) {
      scene.presentActorRefs = scene.presentActorRefs.filter(
        (actorRef) => actorRef !== "actor.qingliu_messenger"
      );
    }
  }

  const writesExecutionRecord =
    action.affordanceTemplateId === "DK-P1-EXECUTION-SCOPE-OPT-01"
    || action.affordanceTemplateId === "DK-P1-EXECUTION-SCOPE-OPT-02"
    || /(?:写进放行文书|写进(?:给巡抚的)?(?:改桑)?放行回文|(?:改桑)?放行回文[^。；]{0,8}写明|写进正式回文|写入正式回文|另具正式回文|单独具名写明|签发附条件命令|补写复核办法|补写[^。；]{0,12}责任)/.test(
      action.actionText
    );
  if (writesExecutionRecord) {
    scene.documentStates = clone(scene.documentStates || []);
    const deliversExecutionReplyToXunfu =
      action.affordanceTemplateId === "DK-P1-EXECUTION-SCOPE-OPT-01"
      || action.affordanceTemplateId === "DK-P1-EXECUTION-SCOPE-OPT-02"
      || /给巡抚的[^。；]{0,12}(?:改桑)?放行回文/.test(action.actionText);
    const existing = scene.documentStates.find(
      (item) => item.documentRef === "document.reform_execution_record"
    );
    const writtenRecord = {
      documentRef: "document.reform_execution_record",
      label: "改桑放行回文",
      accessState: "WRITTEN" as const,
      holderRef: deliversExecutionReplyToXunfu
        ? "actor.xunfu_clerk"
        : "actor.zhejiang_governor",
      continuityNote: deliversExecutionReplyToXunfu
        ? "总督已经写成给巡抚的放行回文，并当场交给巡抚书吏收进回文匣；不得另造第二份文书或增加未经结算的条款。"
        : "本轮只延续已经写入的改桑范围、复核办法与督抚责任；不得另造第二份文书或增加未经结算的条款。"
    };
    if (existing) Object.assign(existing, writtenRecord);
    else scene.documentStates.push(writtenRecord);
    if (deliversExecutionReplyToXunfu) {
      const replyBox = scene.objectStates.find(
        (item) => item.objectRef === "object.xunfu_reply_box"
      );
      if (replyBox) {
        replyBox.holderRef = "actor.xunfu_clerk";
        replyBox.contentsState = "CONTAINS_DOCUMENT";
        replyBox.closureState = "CLOSED";
        replyBox.continuityNote = "巡抚书吏已经把总督写成的改桑放行回文收进匣中并合拢匣盖；回文匣仍由书吏持有。";
      }
    }
  }

  const writesSeparateResponsibilityRecord =
    action.affordanceTemplateId === "DK-P1-RESPONSIBILITY-RECORD-OPT-02"
    || action.affordanceTemplateId === "DK-P1-RESPONSIBILITY-RECORD-OPT-03";
  if (writesSeparateResponsibilityRecord && /责任说明/.test(action.actionText)) {
    scene.documentStates = clone(scene.documentStates || []);
    const existing = scene.documentStates.find(
      (item) => item.documentRef === "document.responsibility_record"
    );
    const writtenRecord = {
      documentRef: "document.responsibility_record",
      label: "督抚责任说明",
      accessState: "WRITTEN" as const,
      holderRef: "actor.zhejiang_governor",
      continuityNote: "总督已经另具督抚责任说明；它与巡抚书吏带走的改桑放行回文不是同一份文书。"
    };
    if (existing) Object.assign(existing, writtenRecord);
    else scene.documentStates.push(writtenRecord);
  }
}

function reconcileSceneSituationAfterSettlement(input: {
  action: PartOneIncomingAction;
  sceneBefore: PartOneSceneState;
  sceneAfter: PartOneSceneState;
  sectionTransitioned: boolean;
  authoritativeObservableFacts: string[];
  authoritativeNpcReactions: PartOneCommittedEvent["authoritativeNpcReactions"];
  authoritativeWorldMoves: PartOneAuthoritativeWorldMove[];
}) {
  if (input.sectionTransitioned) return input.sceneAfter.situation;

  const remainingActorLabels = input.sceneAfter.presentActorRefs
    .map((actorRef) => runtimeTargetFor(actorRef).label);
  const remaining = remainingActorLabels.length
    ? `${remainingActorLabels.join("、")}仍在${input.sceneAfter.locationLabel}`
    : `${input.sceneAfter.locationLabel}暂时无人留守`;
  const endActorRefs = new Set(input.sceneAfter.presentActorRefs);
  const departedActorLabels = input.sceneBefore.presentActorRefs
    .filter((actorRef) => !endActorRefs.has(actorRef))
    .map((actorRef) => runtimeTargetFor(actorRef).label);
  const departure = departedActorLabels.length
    ? `${departedActorLabels.join("、")}已领命离开当前现场，场外办理结果尚未回报`
    : "";
  const latestChange = input.authoritativeWorldMoves.at(-1)?.action
    || input.authoritativeNpcReactions.at(-1)?.action
    || input.authoritativeObservableFacts.at(-1)
    || `浙江总督已经${input.action.actionText}`;

  return [
    remaining,
    departure,
    renderSceneSituationChange(latestChange)
  ].filter(Boolean).join("；") + "。";
}

function renderSceneSituationChange(change: string) {
  return change
    .replace(
      /^巡抚书吏按来府前所受交代当场追问：正式催办总督，催问/,
      "巡抚书吏已经当场追问总督"
    )
    .replace(/[。；]+$/u, "");
}

function timeLabelVariants(timeLabel: string, previousTimeLabel = "") {
  const withoutReignYear = timeLabel.replace(/^嘉靖三十五年/, "");
  const relativeNextDay = previousTimeLabel.includes("五月初八")
    && timeLabel.includes("五月初九")
    ? `次日${timeLabel.slice(timeLabel.indexOf("巳时"))}`
    : "";
  return unique([timeLabel, withoutReignYear, relativeNextDay].filter(Boolean));
}

function locationLabelVariants(locationLabel: string) {
  const shortLabel = locationLabel.replace(/^杭州总督府/, "");
  return unique([locationLabel, shortLabel]);
}

function sceneForSection(sectionId: string): PartOneSceneState {
  return clone(SECTION_SCENES[sectionId] || SECTION_SCENES["SEC-P1-01"]);
}

function buildAuthoritativeObservableFacts(
  action: PartOneIncomingAction,
  statePatch: Record<string, unknown>,
  stateAfter: PartOneState
) {
  const facts: string[] = [];
  if (
    /(?:只问|核实)[^。；！？]{0,36}(?:仅为报疑|只报疑|只敢报疑)/.test(action.actionText)
    && /原册[^。；！？]{0,18}(?:并未|未|没有)随信送来/.test(action.actionText)
  ) {
    facts.push("清流县令亲随当场只确认：密信仅为报疑，原册并未随信送来；除此不能再作断言");
  }
  const labels: Record<string, string> = {
    "reform.executionMode": "改桑执行方式",
    "reform.scopeStatus": "改桑范围",
    "reform.progress": "改桑进度",
    "review.initiationStatus": "复核启动方式",
    "review.authority": "复核主持权",
    "review.procedureStatus": "复核程序",
    "evidence.archiveSealStatus": "档房封存命令",
    "evidence.primaryCustodianRef": "原件保管责任",
    "evidence.copyStatus": "证据副本状态",
    "witness.accessStatus": "书吏接触方式",
    "grain.reliefChannel": "救粮渠道",
    "grain.officialStockStatus": "官粮调度状态",
    "grain.immediatePressure": "眼前粮食压力",
    "merchant.entryStatus": "商会参与状态",
    "land.safeguardStatus": "民田保护边界",
    "land.riskLevel": "失田风险",
    "report.authorshipMode": "奏报署名方式",
    "report.firstNarrativeController": "首份奏报叙述权",
    "report.attachmentStrength": "奏报附件强度",
    "report.dispatchStatus": "奏报递送状态",
    "responsibility.firstRecordStatus": "首份责任记录"
  };
  const values: Record<string, string> = {
    FRAGILE: "尚未形成稳固保管链",
    SEAL_ORDERED: "封存令已经发出，是否完成仍待回报",
    GOVERNOR_REVIEW_ORDERED: "总督已下令启动复核",
    GOVERNOR_SEAL_ORDERED: "总督已下令先行封存并复核",
    LIMITED_TRIAL: "限定试办",
    PROVISIONAL_RELEASE: "附条件先行放开",
    TEMPORARILY_PAUSED: "暂缓执行",
    STARTED: "已经启动",
    QINGLIU_ONLY: "仅限清流县",
    WRITTEN_NO_DISTRESS_PURCHASE: "文书明定不得趁急难压价买田",
    TRACEABLE: "已经形成可追溯保管链",
    JOINT: "督抚共同主持",
    GOVERNOR: "总督主持",
    COUNTY_FIRST: "县级先行初核",
    DISPATCHED: "已经发出",
    SPLIT: "分两路发出"
  };
  for (const path of Object.keys(statePatch)) {
    if (!labels[path]) continue;
    const value = getPath(stateAfter, path);
    const renderedValue = typeof value === "string" && /^(actor|institution|evidence|resource)\./.test(value)
      ? runtimeTargetFor(value).label
      : values[String(value)] || String(value);
    facts.push(`${labels[path]}已经确定为：${renderedValue}`);
  }
  const transfer = statePatch.knowledgeTransfer;
  if (isRecord(transfer)) {
    const status = String(transfer.status || "SENT");
    const recipient = runtimeTargetFor(String(transfer.recipientRef || "public_frame")).label;
    const representativeRef = String(transfer.representativeRef || "");
    const deliveryMode = String(transfer.deliveryMode || "COURIER");
    if (status === "DELIVERED" && deliveryMode === "IN_PERSON_REPRESENTATIVE" && representativeRef) {
      const representative = runtimeTargetFor(representativeRef).label;
      facts.push(`${representative}已代表${recipient}当场听明这项答复，无须离场送达`);
    } else {
      facts.push(status === "DELIVERED" ? `本轮口信或文书已经送达${recipient}` : `本轮口信或文书已经开始递往${recipient}`);
    }
  }
  return unique(facts);
}

function buildAuthoritativeNpcReactions(
  pkg: PartOneRuntimePackage,
  input: {
    eventId: string;
    sectionId: string;
    decisionKernelId: string | null;
    targetRef: string;
    statePatch: Record<string, unknown>;
  }
) {
  if (!input.decisionKernelId) return [];
  const transfer = isRecord(input.statePatch.knowledgeTransfer) ? input.statePatch.knowledgeTransfer : null;
  const informedRefs = new Set([input.targetRef, String(transfer?.recipientRef || "")]);
  const policies = pkg.assets.filter((asset) =>
    asset.assetType === "ACTOR_POLICY" &&
    asset.sectionIds.includes(input.sectionId) &&
    asset.decisionKernelIds.includes(input.decisionKernelId!) &&
    (asset.actorRefs.some((ref) => informedRefs.has(ref)) ||
      (asset.assetId.includes("XUNFU") && informedRefs.has("actor.zhejiang_xunfu")))
  );
  return policies.slice(0, 1).flatMap((policy) => {
    const likelyCountermoves = asStringArray(policy.payload.likelyCountermoves);
    const conditionalReactions = asStringArray(policy.payload.conditionalReactions);
    const allowedMoves = asStringArray(policy.payload.allowedMoves);
    const moves = input.decisionKernelId === "DK-P1-REVIEW-INITIATION"
      ? [
          ...allowedMoves.filter((move) => move.includes("参与复核") || move.includes("书面回复")),
          ...allowedMoves,
          ...likelyCountermoves,
          ...conditionalReactions
        ]
      : [...likelyCountermoves, ...conditionalReactions, ...allowedMoves];
    if (!moves.length) return [];
    // These three kernels can occur in immediate succession while the same
    // clerk is still in the room. Bind each one to the policy move that
    // answers the newly settled player action; a hash selector can otherwise
    // repeat the same demand on consecutive turns and make the scene appear
    // to have forgotten what was just said.
    const preferredMove = input.decisionKernelId === "DK-P1-REVIEW-INITIATION"
      ? allowedMoves.find((move) => move.includes("书面回复"))
      : input.decisionKernelId === "DK-P1-EXECUTION-SCOPE"
        ? allowedMoves.find((move) => move.includes("参与复核"))
        : input.decisionKernelId === "DK-P1-RESPONSIBILITY-RECORD"
          ? allowedMoves.find((move) => move.includes("联署"))
          : null;
    const selector = Number.parseInt(
      digest(`${input.eventId}:${policy.assetId}`).slice(0, 8),
      16
    ) % moves.length;
    const selectedMove = (preferredMove || moves[selector])
      .replace("依据改编后的巡抚权限", "通过巡抚衙门正式催办");
    const renderedMove = selectedMove.includes("催办") && selectedMove.includes("书面回复")
      ? "正式催办总督，催问为何暂缓签发，并要求在三日期限内书面回复，写明复核的范围与方式"
      : input.decisionKernelId === "DK-P1-EXECUTION-SCOPE"
        && selectedMove.includes("参与复核")
        ? "要求派员到场参与复核，并在复核发生后把到场查验经过据实记入复核记录"
        : selectedMove;
    const representativeRef = String(transfer?.representativeRef || "");
    const deliveryMode = String(transfer?.deliveryMode || "");
    const xunfuReaction = policy.actorRefs.includes("actor.zhejiang_xunfu")
      ? representativeRef === "actor.xunfu_clerk" && deliveryMode === "IN_PERSON_REPRESENTATIVE"
        ? `巡抚书吏按来府前所受交代当场追问：${renderedMove}`
        : `浙江巡抚通过巡抚书吏传话：${renderedMove}`
      : renderedMove;
    return [{
      reactionEventId: `NPC-${digest(`${input.eventId}:${policy.assetId}:${xunfuReaction}`).slice(0, 18)}`,
      actorRefs: unique([
        ...policy.actorRefs,
        ...(policy.actorRefs.includes("actor.zhejiang_xunfu") ? ["actor.xunfu_clerk"] : [])
      ]),
      action: xunfuReaction,
      policyAssetId: policy.assetId
    }];
  });
}

function findAffordance(workingSet: PartOneRuntimeWorkingSet, action: PartOneIncomingAction): PartOneRuntimeAffordance | null {
  if (action.decisionKernelId !== workingSet.retrievalTrace.decisionKernelId) return null;
  return workingSet.decisionAffordances.find((candidate) =>
    candidate.affordanceTemplateId === action.affordanceTemplateId
    && candidate.title === action.label
    && candidate.actionText === action.actionText
  ) || null;
}

function findPendingRule(pkg: PartOneRuntimePackage, kernelId: string, sectionId: string) {
  return pkg.assets.find((asset) => asset.assetType === "PENDING_CONSEQUENCE_RULE" && asset.sectionIds.includes(sectionId) && asset.decisionKernelIds.includes(kernelId)) || null;
}

function applyStatePatch(state: PartOneState, patch: Record<string, unknown>, eventId: string) {
  const changed: string[] = [];
  for (const [path, value] of Object.entries(patch)) {
    if (path === "knowledgeTransfer") {
      const row = value as Record<string, unknown>;
      state.knowledgeTransfers.push({
        transferId: `KT-${digest(`${eventId}:${JSON.stringify(row)}`).slice(0, 16)}`,
        topic: String(row.topic || "unspecified"),
        senderRef: String(row.senderRef || "unknown"),
        recipientRef: String(row.recipientRef || "unknown"),
        representativeRef: row.representativeRef ? String(row.representativeRef) : undefined,
        deliveryMode: row.deliveryMode
          ? String(row.deliveryMode) as "DIRECT" | "IN_PERSON_REPRESENTATIVE" | "COURIER"
          : undefined,
        causedByEventId: eventId,
        status: String(row.status || "SENT") as "SENT" | "DELIVERED" | "BLOCKED"
      });
      changed.push("knowledgeTransfers");
      continue;
    }
    const current = getPath(state, path);
    if (isRecord(value) && typeof value.$delta === "number") setPath(state, path, Number(current || 0) + value.$delta);
    else setPath(state, path, clone(value));
    changed.push(path);
  }
  return unique(changed);
}

function advanceSectionWhenGatesPass(pkg: PartOneRuntimePackage, state: PartOneState, turnNumber: number) {
  const current = requireSection(pkg, state.sectionId);
  if (!current.exitGates.every((rule) => evaluatePartOneRule(state, rule))) return false;
  const nextId = current.allowedNextSectionIds[0];
  if (!nextId || nextId === "PART-02-HANDOFF") return false;
  const next = requireSection(pkg, nextId);
  if (turnNumber + 1 < next.targetTurnWindow.earliest) return false;
  if (!next.entryRequirements.every((rule) => evaluatePartOneRule(state, rule))) return false;
  state.sectionId = nextId;
  return true;
}

function updateArcStages(pkg: PartOneRuntimePackage, state: PartOneState, before: string, after: string, transitioned: boolean) {
  state.causalArcStages ||= {};
  for (const arcId of requireSection(pkg, before).activeCausalArcIds) state.causalArcStages[arcId] = transitioned ? "RESOLVED" : "PRESSURED";
  if (transitioned) for (const arcId of requireSection(pkg, after).activeCausalArcIds) state.causalArcStages[arcId] = "OPEN";
}

function runtimeTargetFor(ref: string): PartOneRuntimeTarget {
  if (TARGETS[ref]) return TARGETS[ref];
  if (ref.startsWith("actor.")) return { type: "PERSON", id: ref, label: ref.replace(/^actor\./, "") };
  if (ref.startsWith("institution.")) return { type: "INSTITUTION", id: ref, label: ref.replace(/^institution\./, "") };
  if (ref.startsWith("evidence.")) return { type: "EVIDENCE", id: ref, label: ref.replace(/^evidence\./, "") };
  if (ref.startsWith("resource.")) return { type: "RESOURCE", id: ref, label: ref.replace(/^resource\./, "") };
  return { type: "PUBLIC_FRAME", id: "public_frame", label: "当前局势" };
}

function requireSection(pkg: PartOneRuntimePackage, sectionId: string): PartOneSectionContract {
  const section = pkg.sections.find((item) => item.sectionId === sectionId);
  if (!section) throw new Error(`PART_ONE_RUNTIME_SECTION_UNKNOWN:${sectionId}`);
  return section;
}

function requireAsset(pkg: PartOneRuntimePackage, assetId: string): PartOneRuntimeAsset {
  const asset = pkg.assets.find((item) => item.assetId === assetId);
  if (!asset) throw new Error(`PART_ONE_RUNTIME_ASSET_UNKNOWN:${assetId}`);
  return asset;
}

function getPath(root: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((value, key) => isRecord(value) ? value[key] : undefined, root);
}

function setPath(root: Record<string, unknown>, path: string, value: unknown) {
  const keys = path.split(".");
  let target = root;
  for (const key of keys.slice(0, -1)) {
    if (!isRecord(target[key])) target[key] = {};
    target = target[key] as Record<string, unknown>;
  }
  target[keys.at(-1)!] = value;
}

function eventIdFor(value: unknown) {
  const row = value as { turnNumber: number };
  return `EVT-P1-${String(row.turnNumber).padStart(2, "0")}-${digest(canonical(value)).slice(0, 16)}`;
}

function digest(value: string) {
  return createHash("sha256").update(value).digest("hex").toUpperCase();
}

function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value as Record<string, unknown>).sort().map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(",")}}`;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function isRecord(value: unknown): value is Record<string, any> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asStringArray(value: unknown) {
  return Array.isArray(value) ? value.map(String) : [];
}

function unique<T>(values: T[]) {
  return [...new Set(values)];
}

function uniqueTargets(values: PartOneRuntimeTarget[]) {
  const seen = new Set<string>();
  return values.filter((item) => {
    const key = `${item.type}:${item.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function deepEqual(left: unknown, right: unknown) {
  return canonical(left) === canonical(right);
}
