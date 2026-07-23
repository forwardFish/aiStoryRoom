import { createHash } from "node:crypto";
import type {
  PartOneActionSettlement,
  PartOneCommittedEvent,
  PartOnePendingConsequenceState,
  PartOneRuntimeAffordance,
  PartOneRuntimeAsset,
  PartOneRuntimePackage,
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
        status: "DELIVERED"
      },
      "relations.governorXunfu": { $delta: -1 }
    }
  }
};

export function createInitialPartOneState(pkg: PartOneRuntimePackage): PartOneState {
  const state = clone(pkg.worldStart.state);
  state.completedKernelIds = [];
  state.sectionTurnNumber = 0;
  state.causalArcStages = Object.fromEntries(
    pkg.assets.filter((asset) => asset.assetId.startsWith("ARC-P1-")).map((asset) => [asset.assetId, "OPEN"])
  );
  state.lastCommittedEventId = null;
  state.partCompletionStatus = "IN_PROGRESS";
  return state;
}

export function settlePartOneAction(
  pkg: PartOneRuntimePackage,
  currentState: PartOneState,
  action: PartOneIncomingAction,
  turnNumber: number
): PartOneActionSettlement {
  const beforeState = clone(currentState);
  const proposedState = clone(currentState);
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
    const consequence: PartOnePendingConsequenceState = {
      consequenceId: `PC-P1-${String(turnNumber).padStart(2, "0")}-${digest(`${eventId}:${pendingRule.assetId}`).slice(0, 12)}`,
      causedByEventId: eventId,
      ruleAssetId: pendingRule.assetId,
      summary: consequences[turnNumber % Math.max(1, consequences.length)] || appliedAffordance?.visibleTradeoff || "这道命令引起的反制必须在下一回合兑现。",
      dueTurn: turnNumber + 1,
      priority: "P0",
      status: "PENDING"
    };
    proposedState.pendingConsequences.push(consequence);
    createdPendingConsequences.push(consequence);
  }

  const sectionBefore = proposedState.sectionId;
  const sectionTransitioned = advanceSectionWhenGatesPass(pkg, proposedState, turnNumber);
  const sectionAfter = proposedState.sectionId;
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
    changedStatePaths,
    createdPendingConsequenceIds: createdPendingConsequences.map((item) => item.consequenceId),
    duePendingConsequenceIds: dueConsequences.map((item) => item.consequenceId),
    authoritativeObservableFacts,
    authoritativeNpcReactions,
    sectionTransitioned
  };
  return { beforeState, proposedState, event, appliedAffordance, dueConsequences };
}

export function finalizePartOneSettlement(
  settlement: PartOneActionSettlement,
  paidPendingConsequenceIds: string[]
): PartOneActionSettlement {
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
  // G00 can already issue the seal order. If the player chose it, asking them
  // to "seal the archive first" again on the very next screen is a false
  // choice. Preserve the same strategic endpoint (continue the pause and own
  // its cost), but advance the order to a bounded wait for a reviewable list.
  if (
    affordance.affordanceTemplateId === "DK-P1-EXECUTION-SCOPE-OPT-03"
    && state.evidence?.archiveSealStatus === "SEAL_ORDERED"
  ) {
    return {
      ...affordance,
      title: "维持暂缓",
      actionText: "维持暂不签发，限清流县在三日期限内交出可复核清单，并把延误责任暂记自己名下。",
      immediateIntent: "不重复下达封档命令，在等待封存回报期间固定复核期限和责任。",
      method: "限期候报",
      visibleTradeoff: "保留查证窗口，但朝廷与粮价压力继续上升",
      statePatch: {
        "reform.executionMode": "TEMPORARILY_PAUSED",
        "review.procedureStatus": "AWAITING_SEAL_REPORT_WITH_DEADLINE",
        "responsibility.governorExposure": { $delta: 1 }
      }
    };
  }
  return affordance;
}

export function partOneRuntimeTargets(workingSet: PartOneRuntimeWorkingSet) {
  return uniqueTargets([
    ...workingSet.decisionAffordances.map((item) => item.target),
    ...workingSet.section.foregroundActorRefs.map(runtimeTargetFor),
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

function buildAuthoritativeObservableFacts(
  action: PartOneIncomingAction,
  statePatch: Record<string, unknown>,
  stateAfter: PartOneState
) {
  const facts = [`浙江总督已经发出并开始执行这道命令：${action.actionText}`];
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
    facts.push(status === "DELIVERED" ? `本轮口信或文书已经送达${recipient}` : `本轮口信或文书已经开始递往${recipient}`);
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
    const selector = input.decisionKernelId === "DK-P1-REVIEW-INITIATION"
      ? 0
      : Number.parseInt(digest(`${input.eventId}:${policy.assetId}`).slice(0, 8), 16) % moves.length;
    const selectedMove = moves[selector]
      .replace("依据改编后的巡抚权限", "通过巡抚衙门正式催办");
    const renderedMove = selectedMove.includes("催办") && selectedMove.includes("书面回复")
      ? "正式催办总督，催问为何暂缓签发，并要求在三日期限内书面回复，写明复核的范围与方式"
      : selectedMove;
    const xunfuReaction = policy.actorRefs.includes("actor.zhejiang_xunfu")
      ? `浙江巡抚通过巡抚书吏传话：${renderedMove}`
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
