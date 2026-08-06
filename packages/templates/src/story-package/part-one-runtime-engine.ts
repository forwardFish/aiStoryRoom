import { createHash } from "node:crypto";
import type {
  PartOneActionSettlement,
  PartOneAuthoritativeWorldMove,
  PartOneCommittedEvent,
  PartOneConsequencePayoffBeat,
  PartOneContinuationDecisionTemplate,
  PartOneDecisionPoint,
  PartOneNarrativePlan,
  PartOnePlayerVisibleFallback,
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
import { evaluateStructuredStateSelector } from "../runtime-contract/selection";
import type { DurablePredicate, DurableState } from "../runtime-contract/types";
import { mergeDurablePredicates } from "../runtime-contract/validation";
import { selectNarrativeScenePatterns } from "./narrative-scene-pattern";
import { compileDramaticBeatPlan } from "./dramatic-beat-plan";

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
  "document.qingliu_register_original": { type: "DOCUMENT", id: "document.qingliu_register_original", label: "清流县册原件" },
  "location.qingliu_archive": { type: "LOCATION", id: "location.qingliu_archive", label: "清流县档房" },
  "location.zhejiang_governor_yamen": { type: "LOCATION", id: "location.zhejiang_governor_yamen", label: "浙江总督府" },
  "location.zhejiang_xunfu_yamen": { type: "LOCATION", id: "location.zhejiang_xunfu_yamen", label: "浙江巡抚衙门" },
  "location.qingliu_route": { type: "LOCATION", id: "location.qingliu_route", label: "赴清流县途中" },
  "document.reform_execution_record": { type: "DOCUMENT", id: "document.reform_execution_record", label: "改桑放行回文" },
  "document.responsibility_record": { type: "DOCUMENT", id: "document.responsibility_record", label: "督抚责任说明" },
  "resource.official_grain": { type: "RESOURCE", id: "resource.official_grain", label: "官仓与借调粮" },
  "resource.official_document_channel": { type: "RESOURCE", id: "resource.official_document_channel", label: "总督行文与递奏渠道" },
};

const SECTION_SCENES: Record<string, PartOneSceneState> = {
  "SEC-P1-01": {
    sceneId: "SCENE-P1-S1-INNER-HALL",
    timeLabel: "嘉靖三十五年五月初八辰时",
    locationLabel: "杭州总督府内厅",
    locationRef: "location.zhejiang_governor_yamen",
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
    locationRef: "location.zhejiang_governor_yamen",
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
    locationRef: "location.zhejiang_governor_yamen",
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
    locationRef: "location.zhejiang_governor_yamen",
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

const OPENING_PATCHES: Record<string, {
  kernelId: string;
  patch: Record<string, unknown>;
  durableEffects?: DurablePredicate[];
  targetRef: string;
  canonicalActionText: string;
}> = {
  opening_d1: {
    kernelId: "DK-P1-REVIEW-INITIATION",
    targetRef: "evidence.qingliu_register_anomaly",
    canonicalActionText: "暂不签发放行文书，留下巡抚书吏，同时只向清流县令亲随核对密信中已经写明的县册报疑。",
    patch: {
      "review.initiationStatus": "GOVERNOR_PRELIMINARY_INQUIRY",
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
    canonicalActionText: "将总督封缄令牌交给清流县令亲随，命他向清流县传达封存档房之令；同时当面答复巡抚书吏：暂缓签发，三日内复核。",
    durableEffects: [
      { type: "ENTITY.LOCATED_AT", entityId: "document.qingliu_register_original", locationId: "location.qingliu_archive" },
      { type: "ENTITY.STATE", entityId: "document.qingliu_register_original", attribute: "custodianRef", value: "actor.qingliu_magistrate" },
      { type: "ENTITY.STATE", entityId: "document.qingliu_register_original", attribute: "sealState", value: "SEAL_ORDERED" },
      { type: "ENTITY.STATE", entityId: "document.qingliu_register_original", attribute: "pendingAction", value: "SEAL_ARCHIVE" },
      { type: "ENTITY.HELD_BY", entityId: "object.governor_seal_token", actorId: "actor.qingliu_messenger" },
      { type: "ENTITY.LOCATED_AT", entityId: "actor.qingliu_messenger", locationId: "location.qingliu_route" }
    ],
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
  state.durableState = normalizePartOneDurableState(state.durableState, pkg.worldId);
  state.scene = normalizeSceneState(state.scene, state.sectionId);
  projectDurableStateIntoScene(state.scene, state.durableState);
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
  beforeState.durableState = normalizePartOneDurableState(beforeState.durableState, pkg.worldId);
  beforeState.scene = normalizeSceneState(beforeState.scene, beforeState.sectionId);
  projectDurableStateIntoScene(beforeState.scene, beforeState.durableState);
  const proposedState = clone(beforeState);
  proposedState.turnNumber = turnNumber;
  proposedState.pendingConsequences = Array.isArray(proposedState.pendingConsequences) ? proposedState.pendingConsequences : [];
  const dueConsequences = proposedState.pendingConsequences
    .filter((item) => ["PENDING", "DUE"].includes(item.status) && item.dueTurn <= turnNumber)
    .map((item) => ({ ...item, status: "DUE" as const }));
  const dueIds = new Set(dueConsequences.map((item) => item.consequenceId));
  proposedState.pendingConsequences = proposedState.pendingConsequences.map((item) => dueIds.has(item.consequenceId) ? { ...item, status: "DUE" } : item);

  const opening = action.decisionId ? OPENING_PATCHES[action.decisionId] : null;
  const settledAction = opening
    ? { ...action, actionText: opening.canonicalActionText }
    : action;
  const currentWorkingSet = buildPartOneRuntimeWorkingSet(pkg, currentState, Math.max(0, turnNumber - 1));
  const appliedAffordance = opening ? null : findAffordance(currentWorkingSet, action);
  const decisionKernelId = opening?.kernelId || appliedAffordance?.decisionKernelId || null;
  const affordanceTemplateId = appliedAffordance?.affordanceTemplateId || null;
  const statePatch = clone(opening?.patch || appliedAffordance?.statePatch || {});
  const durableEffects = clone(opening?.durableEffects || appliedAffordance?.durableEffects || []);
  const targetRef = opening?.targetRef || appliedAffordance?.targetRef || action.targetRef || "public_frame";
  const eventId = eventIdFor({ turnNumber, beforeState, action: settledAction, decisionKernelId, affordanceTemplateId, statePatch, durableEffects });
  const changedStatePaths = applyStatePatch(proposedState, statePatch, eventId);
  proposedState.durableState = advancePartOneDurableState(proposedState.durableState, durableEffects);
  changedStatePaths.push("durableState");

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
    const consequenceIndex = consequenceIndexFor(settledAction, appliedAffordance, consequences.length);
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
  projectDurableStateIntoScene(sceneAfter, proposedState.durableState);
  proposedState.scene = sceneAfter;
  if (sectionBefore !== sectionAfter) changedStatePaths.push("sectionId");
  if (!deepEqual(sceneBefore, sceneAfter)) changedStatePaths.push("scene");
  proposedState.sectionTurnNumber = sectionTransitioned ? 0 : Number(proposedState.sectionTurnNumber || 0) + 1;
  proposedState.lastCommittedEventId = eventId;
  if (sectionAfter === "SEC-P1-04" && turnNumber >= 20 && sectionExitPassed(pkg, proposedState, sectionAfter)) {
    proposedState.partCompletionStatus = "HANDOFF_READY";
    // A completed part must not hand the next part a backlog of already-due
    // scene pressures. Those pressures remain auditable in the ledger, but
    // the completed part's durable state has already absorbed them. Preserve
    // genuinely future consequences so the next part can still pay them off.
    proposedState.pendingConsequences = proposedState.pendingConsequences.map((item) => (
      item.status === "DUE" && item.dueTurn <= turnNumber
        ? { ...item, status: "TRANSFORMED" as const }
        : item
    ));
  }
  updateArcStages(pkg, proposedState, sectionBefore, sectionAfter, sectionTransitioned);

  const nextWorkingSet = buildPartOneRuntimeWorkingSet(pkg, proposedState, turnNumber);
  const authoritativeObservableFacts = buildAuthoritativeObservableFacts(settledAction, statePatch, proposedState);
  const authoritativeNpcReactions = buildAuthoritativeNpcReactions({
    eventId,
    sceneAfter,
    nextWorkingSet
  });
  const authoritativeWorldMoves = buildAuthoritativeWorldMoves({
    dueConsequences,
    nextWorkingSet,
    sectionTransitioned,
    sectionBefore,
    sectionAfter,
    sceneBefore,
    sceneAfter,
    statePatch
  });
  const payableDueIds = new Set(
    authoritativeWorldMoves
      .filter((move) => move.sourceType === "DUE_CONSEQUENCE" && move.consequenceId)
      .map((move) => move.consequenceId!)
  );
  const payableDueConsequences = dueConsequences.filter((item) =>
    payableDueIds.has(item.consequenceId)
  );
  sceneAfter.situation = reconcileSceneSituationAfterSettlement({
    action: settledAction,
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
    pkg,
    action: settledAction,
    decisionKernelId,
    protectedNarrative: appliedAffordance?.protectedNarrative,
    fallbackContinuation: appliedAffordance?.fallbackContinuation,
    playerVisibleFallback: appliedAffordance?.playerVisibleFallback,
    // A transition turn still has to finish the section the player acted in.
    // The next section's broad purpose belongs to subsequent turns; exposing
    // it as this turn's objective invites the Narrator to reveal evidence that
    // the transition scene only establishes as a future contest.
    section: requireSection(pkg, sectionTransitioned ? sectionBefore : sectionAfter),
    sceneBefore,
    sceneAfter,
    sectionTransitioned,
    authoritativeObservableFacts,
    authoritativeNpcReactions,
    authoritativeWorldMoves,
    nextDecisionPoint: nextWorkingSet.decisionPoint
  });

  const event: PartOneCommittedEvent = {
    schemaVersion: "sangtian-part-one-event-v1",
    eventId,
    turnNumber,
    sectionIdBefore: sectionBefore,
    sectionIdAfter: sectionAfter,
    actionSource: settledAction.source,
    decisionKernelId,
    affordanceTemplateId,
    actionText: settledAction.actionText,
    targetRef,
    statePatch,
    durableEffects,
    changedStatePaths: unique(changedStatePaths),
    createdPendingConsequenceIds: createdPendingConsequences.map((item) => item.consequenceId),
    duePendingConsequenceIds: payableDueConsequences.map((item) => item.consequenceId),
    authoritativeObservableFacts,
    authoritativeNpcReactions,
    sceneBefore,
    sceneAfter,
    authoritativeWorldMoves,
    nextDecisionPoint: clone(nextWorkingSet.decisionPoint),
    narrativePlan,
    sectionTransitioned
  };
  return {
    beforeState,
    proposedState,
    event,
    appliedAffordance,
    dueConsequences: payableDueConsequences
  };
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
  const surfacedContinuationPressureCount = event.authoritativeWorldMoves.filter(
    (move) => move.sourceType === "NEXT_DECISION_PRESSURE"
  ).length;
  const objectiveEvidenceCount = advancedDecisionKernelIds.length
    + sectionExitGateDelta.length
    + causalArcTransitions.length
    + input.paidPendingConsequenceIds.length
    + surfacedContinuationPressureCount;
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
  const decisionPoint = decisionPointForSelection({
    kernelId,
    openDecisionKernel,
    continuationDecisionId,
    nextDecisionPressure,
    state
  });
  const options = Array.isArray(openDecisionKernel.payload.options) ? openDecisionKernel.payload.options : [];
  const requiredOptionCount = unresolved ? 3 : 2;
  if (options.length < requiredOptionCount) throw new Error(`PART_ONE_RUNTIME_KERNEL_OPTIONS_MISSING:${kernelId}`);
  const authoredAffordances = options.map((option) => adaptAffordanceForCurrentState({
    ...option,
    decisionKernelId: kernelId,
    decisionPointId: decisionPoint.decisionPointId,
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
    asset.assetType === "SOURCE_SCENE_EVIDENCE" ||
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
    decisionPoint,
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

function decisionPointForSelection(input: {
  kernelId: string;
  openDecisionKernel: PartOneRuntimeAsset;
  continuationDecisionId: string | null;
  nextDecisionPressure: PartOneContinuationDecisionTemplate["worldPressure"] | null;
  state: PartOneState;
}): PartOneDecisionPoint {
  if (input.kernelId === "PART-02-HANDOFF-PREVIEW") {
    return {
      decisionPointId: input.kernelId,
      decisionKernelId: input.kernelId,
      sourceAssetId: input.kernelId,
      actorRefs: [],
      prompt: "第一部分至此结束。京师回文到来之前，粮路与卖田两条线仍待查明。",
      resultCeiling: "只完成第一部分收束，不得提前结算第二部分剧情。"
    };
  }
  if (input.continuationDecisionId && input.nextDecisionPressure) {
    return {
      decisionPointId: input.continuationDecisionId,
      decisionKernelId: input.kernelId,
      sourceAssetId: input.nextDecisionPressure.sourceFloorAssetId,
      actorRefs: [...(PRESSURE_WORLD_MOVE_ACTORS[input.nextDecisionPressure.pressureId] || [])],
      prompt: input.nextDecisionPressure.summary,
      resultCeiling: "只把这项新压力带到玩家面前；不得替玩家答复，也不得提前写出两条可选行动的结果。"
    };
  }
  const selectedVariant = (input.openDecisionKernel.payload.decisionPromptVariants || [])
    .find((variant) => variant.when.every((selector) => (
      evaluateDecisionPromptSelector(input.state, selector)
    )));
  const raw = selectedVariant || input.openDecisionKernel.payload.decisionPrompt;
  if (!isRecord(raw)) {
    throw new Error(`PART_ONE_RUNTIME_DECISION_PROMPT_MISSING:${input.kernelId}`);
  }
  const decisionPointId = selectedVariant
    ? input.kernelId
    : String(raw.decisionPointId || "");
  const actorRefs = asStringArray(raw.actorRefs);
  const prompt = String(raw.prompt || "").trim();
  const resultCeiling = String(raw.resultCeiling || "").trim();
  if (decisionPointId !== input.kernelId || !actorRefs.length || !prompt || !resultCeiling) {
    throw new Error(`PART_ONE_RUNTIME_DECISION_PROMPT_INVALID:${input.kernelId}`);
  }
  return {
    decisionPointId,
    decisionKernelId: input.kernelId,
    sourceAssetId: input.openDecisionKernel.assetId,
    actorRefs,
    prompt,
    resultCeiling
  };
}

function evaluateDecisionPromptSelector(
  state: PartOneState,
  selector: import("./part-one-runtime-types").PartOneDecisionPromptSelector
) {
  if (selector.selectorKind === "STATE_PATH") {
    return evaluateStructuredStateSelector(state, selector);
  }
  const collection = selector.entityKind === "DOCUMENT"
    ? state.scene.documentStates || []
    : state.scene.objectStates || [];
  const refField = selector.entityKind === "DOCUMENT" ? "documentRef" : "objectRef";
  const entity = collection.find((candidate) => (
    String((candidate as unknown as Record<string, unknown>)[refField] || "") === selector.entityRef
  )) as unknown as Record<string, unknown> | undefined;
  const actual = entity?.[selector.field];
  return selector.operator === "EQ"
    ? deepEqual(actual, selector.expectedValue)
    : !deepEqual(actual, selector.expectedValue);
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
  // Global document existence is a durable fact. Scene projection may mark a
  // real document NOT_PRESENT when its holder has left, but that must never
  // make later decision logic recreate or forget the document.
  const existingExecutionReply = state.durableState.predicates.some(
    (predicate) =>
      predicate.type === "DOCUMENT.CREATED"
      && predicate.documentId === "document.reform_execution_record"
  ) && currentEntityState(
    state.durableState,
    "document.reform_execution_record",
    "accessState"
  ) === "WRITTEN";
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
      },
      protectedEffectRefs: protectedEffectRefsFor(
        ["reform.executionMode", "responsibility.governorExposure"],
        []
      ),
      protectedNarrative: "总督的手没有伸向印盒。他看着屏风外的巡抚书吏，说道：\"今日仍不签。清流县封存的回报未到，此事不再往前走。\"\n\n书吏刚要开口，总督又道：\"朝廷三日之限若因此有误，责在本督，不累旁人。\"",
      fallbackContinuation: "巡抚书吏听完，没有去碰那只空回文匣，只躬身问道：\"大人既肯担这三日之责，卑职只问一句——这番话准备怎样写进正式回文，是由总督独自具名，还是请巡抚共同具名？\""
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
      : `把${executionBoundaryLabel(state)}与督抚各自责任写进正式回文，说明县册复核主持权另议，请巡抚共同具名。`;
    const protectedNarrative = existingExecutionReply
      ? "总督当面明告巡抚书吏：刚刚写成的改桑放行回文不再改动，请巡抚在同一份回文上共同具名，与总督共同承担清流试办和复核责任。"
      : "总督把暂缓签发的缘由和督抚各自应负的责任逐项写入回文，并注明县册复核主持权尚待议定。写毕，他将文书封好，交给巡抚书吏，请巡抚在同一份回文上具名。";
    const durableEffects = existingExecutionReply ? [] : [...(affordance.durableEffects || [])];
    return {
      ...affordance,
      actionText,
      immediateIntent: actionText,
      durableEffects,
      protectedEffectRefs: protectedEffectRefsFor(affordance.stateEffects, durableEffects),
      protectedNarrative
    };
  }

  if (affordance.affordanceTemplateId === "DK-P1-RESPONSIBILITY-RECORD-OPT-02") {
    const actionText = existingExecutionReply
      ? "维持刚刚写成的放行回文不改；由总督另具责任说明，单独具名，并把巡抚催办原文作为附件留档。"
      : `由总督单独具名写明${executionBoundaryLabel(state)}，并把巡抚催办原文作为附件留档。`;
    return {
      ...affordance,
      actionText,
      immediateIntent: actionText,
      protectedEffectRefs: protectedEffectRefsFor(
        affordance.stateEffects,
        affordance.durableEffects || []
      )
    };
  }

  if (affordance.affordanceTemplateId === "DK-P1-RESPONSIBILITY-RECORD-OPT-03") {
    const actionText = existingExecutionReply
      ? "维持放行回文不改，另具督抚责任说明：巡抚要求派员参与复核而总督尚未同意，巡抚若有异议须另行成文，督抚各担其责。"
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
    const durableEffects: DurablePredicate[] = existingExecutionReply
      ? [...(affordance.durableEffects || [])]
      : [
          { type: "DOCUMENT.CREATED", documentId: "document.reform_execution_record" },
          {
            type: "DOCUMENT.AUTHENTICATED",
            documentId: "document.reform_execution_record",
            actorId: "actor.zhejiang_governor"
          },
          {
            type: "ENTITY.HELD_BY",
            entityId: "document.reform_execution_record",
            actorId: "actor.zhejiang_governor"
          },
          {
            type: "ENTITY.STATE",
            entityId: "document.reform_execution_record",
            attribute: "accessState",
            value: "WRITTEN"
          }
        ];
    return {
      ...affordance,
      actionText,
      immediateIntent: actionText,
      stateEffects,
      statePatch,
      durableEffects,
      protectedEffectRefs: protectedEffectRefsFor(stateEffects, durableEffects)
    };
  }
  return affordance;
}

function protectedEffectRefsFor(
  stateEffects: string[],
  durableEffects: DurablePredicate[]
): NonNullable<PartOneRuntimeAffordance["protectedEffectRefs"]> {
  return [
    ...unique(stateEffects).map((path) => ({ kind: "STATE_PATH" as const, path })),
    ...durableEffects.map((_, effectIndex) => ({
      kind: "DURABLE_EFFECT" as const,
      effectIndex
    }))
  ];
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
  statePatch: Record<string, unknown>;
}): PartOneAuthoritativeWorldMove[] {
  const presentActors = new Set(input.sceneAfter.presentActorRefs);
  const dueMoves: PartOneAuthoritativeWorldMove[] = input.dueConsequences.flatMap(
    (consequence) => {
      const payoff = consequence.payoffBeat
        || fallbackPayoffBeat(consequence.ruleAssetId, consequence.summary, []);
      // A due consequence remains DUE until its acting party can enter through
      // the current scene contract. Never teleport an absent actor merely to
      // satisfy a payoff schedule.
      if (
        payoff.actorRefs.length
        && !payoff.actorRefs.some((actorRef) => presentActors.has(actorRef))
      ) {
        return [];
      }
      return [{
        beatId: payoff.beatId,
        sourceType: "DUE_CONSEQUENCE" as const,
        sourceId: consequence.ruleAssetId,
        actorRefs: [...payoff.actorRefs],
        action: payoff.action,
        requiredTermGroups: clone(payoff.requiredTermGroups),
        resultCeiling: payoff.resultCeiling,
        consequenceId: consequence.consequenceId
      }];
    }
  );
  const moves: PartOneAuthoritativeWorldMove[] = [];
  let settledResponse: PartOneAuthoritativeWorldMove | null = null;
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
    if (
      input.statePatch["responsibility.firstRecordStatus"] === "JOINT_SIGNATURE_REQUESTED"
      && presentActors.has("actor.xunfu_aide")
    ) {
      settledResponse = {
        beatId: "SETTLED-RESPONSE-P1-JOINT-SIGNATURE",
        sourceType: "SETTLED_RESPONSE",
        sourceId: "DK-P1-RESPONSIBILITY-RECORD-OPT-01",
        actorRefs: ["actor.xunfu_aide"],
        action: "次日签押房里，巡抚幕僚正式答复：巡抚拒绝在总督昨日送来的正式回文上共同具名；共同具名的请求至此有了明确回应。",
        requiredTermGroups: [
          ["巡抚幕僚", "幕僚"],
          ["拒绝共同具名", "不肯共同具名", "拒绝联署", "不肯联署", "不愿具名", "不具名"],
          ["正式回文", "回文"]
        ],
        resultCeiling: "只答复巡抚拒绝在总督送来的正式回文上共同具名；不得改写回文、另造拒签文书，或让巡抚本人到场。"
      };
    }
  }
  const pressure = input.nextWorkingSet.nextDecisionPressure;
  const pressureActors = pressure
    ? [...(PRESSURE_WORLD_MOVE_ACTORS[pressure.pressureId] || [])]
    : [];
  let nextDecisionMove: PartOneAuthoritativeWorldMove | null = null;
  if (
    pressure
    // A section transition already establishes the next playable question in
    // the destination scene. Emitting the next section's pressure in the same
    // turn overloads one beat and can make the spoken ending disagree with the
    // authored choices that follow. Let that pressure enter on the first turn
    // inside the new section instead.
    && !input.sectionTransitioned
    && (
      pressureActors.length === 0
      || pressureActors.some((actorRef) => presentActors.has(actorRef))
    )
  ) {
    nextDecisionMove = {
      beatId: pressure.pressureId,
      sourceType: "NEXT_DECISION_PRESSURE",
      sourceId: pressure.sourceFloorAssetId,
      actorRefs: pressureActors,
      action: pressure.summary,
      requiredTermGroups: requiredTermGroupsFor(pressure.summary),
      resultCeiling: "只把这项新压力带到玩家面前；不得替玩家答复，也不得提前写出两条可选行动的结果。"
    };
  }
  // A turn may surface exactly one NPC/world pressure. A transition is only
  // staging; after it, prefer the directly settled response, otherwise one due
  // consequence. In a stable scene, pay one due consequence before introducing
  // a fresh pressure. Everything else remains DUE for a later turn.
  // A continuation decision's own pressure must be visible in the same beat as
  // its options; otherwise the Narrator would have to invent a bridge from an
  // unrelated due consequence to the actual stop condition. Older due
  // consequences remain auditable and can surface on a later compatible turn.
  const presentPressure = settledResponse || nextDecisionMove || dueMoves[0];
  if (presentPressure) moves.push(presentPressure);
  return moves;
}

function buildNarrativePlan(input: {
  pkg: PartOneRuntimePackage;
  action: PartOneIncomingAction;
  decisionKernelId: string | null;
  protectedNarrative?: string;
  fallbackContinuation?: string;
  playerVisibleFallback?: PartOnePlayerVisibleFallback;
  section: PartOneSectionContract;
  sceneBefore: PartOneSceneState;
  sceneAfter: PartOneSceneState;
  sectionTransitioned: boolean;
  authoritativeObservableFacts: string[];
  authoritativeNpcReactions: PartOneCommittedEvent["authoritativeNpcReactions"];
  authoritativeWorldMoves: PartOneAuthoritativeWorldMove[];
  nextDecisionPoint: PartOneDecisionPoint;
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
  const authorizedActorDepartureRefs = input.sectionTransitioned
    ? []
    : input.sceneBefore.presentActorRefs
      .filter((ref) => !actorRefsAtSceneEnd.has(ref));
  const authorizedActorDepartures = authorizedActorDepartureRefs
    .map((ref) => runtimeTargetFor(ref).label);
  const departureBeats: PartOneNarrativePlan["sceneBeats"] = authorizedActorDepartures.map(
    (label, index) => ({
      beatId: `SCENE-DEPARTURE-${index + 1}`,
      sourceType: "WORLD_MOVE" as const,
      actorRefs: [authorizedActorDepartureRefs[index]!],
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
      mustAppear: true,
      hardRequired: true
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
      mustAppear: /^清流县令亲随当场只确认/.test(fact),
      hardRequired: /^清流县令亲随当场只确认/.test(fact)
    })),
    ...input.authoritativeNpcReactions.map((reaction) => ({
      beatId: reaction.reactionEventId,
      sourceType: "NPC_REACTION" as const,
      actorRefs: [...reaction.actorRefs],
      action: reaction.action,
      requiredTermGroups: requiredTermGroupsFor(reaction.action),
      resultCeiling: resultCeilingForNpcReaction(reaction.action),
      mustAppear: true,
      hardRequired: true
    })),
    ...buildWorldMoveNarrativeBeats(input.authoritativeWorldMoves)
  ];
  const lastMove = input.authoritativeWorldMoves.at(-1)?.action
    || input.authoritativeNpcReactions.at(-1)?.action
    || input.authoritativeObservableFacts.at(-1)
    || input.action.actionText;
  const incidentalTextureAllowances = buildIncidentalTextureAllowances(
    input.sceneBefore,
    input.sceneAfter
  );
  const settledActionNarrative =
    String(input.protectedNarrative || "").trim();
  const nextStoryBeat = buildNextStoryBeat({
    pkg: input.pkg,
    decisionKernelId: input.decisionKernelId,
    actionText: input.action.actionText,
    settledActionNarrative,
    fallbackContinuation: input.fallbackContinuation,
    playerVisibleFallback: input.playerVisibleFallback,
    foregroundPreludeBeats: departureBeats,
    sceneAfter: input.sceneAfter,
    sectionTransitioned: input.sectionTransitioned,
    authoritativeObservableFacts: input.authoritativeObservableFacts,
    authoritativeNpcReactions: input.authoritativeNpcReactions,
    authoritativeWorldMoves: input.authoritativeWorldMoves,
    nextDecisionPoint: input.nextDecisionPoint,
    unresolvedFacts: [
      "密信和异常只能证明需要复核，不能直接证明巡抚、商会或任何个人有罪。",
      ...input.section.forbiddenEarlyReveals
    ]
  });
  const foregroundSceneBeats = sceneBeats.map((beat) => {
    if (beat.sourceType !== "NPC_REACTION" && beat.sourceType !== "WORLD_MOVE") {
      return beat;
    }
    const selectedForForeground = nextStoryBeat.sourceEventIds.includes(beat.beatId);
    return {
      ...beat,
      mustAppear: selectedForForeground,
      hardRequired: selectedForForeground && beat.hardRequired === true
    };
  });
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
    settledActionNarrative,
    nextStoryBeat,
    confirmedEffects: [...input.authoritativeObservableFacts],
    unresolvedFacts: [
      "密信和异常只能证明需要复核，不能直接证明巡抚、商会或任何个人有罪。",
      ...input.section.forbiddenEarlyReveals
    ],
    npcAgenda: input.authoritativeNpcReactions.map((reaction) => reaction.action),
    sceneBlocking: input.sectionTransitioned
      ? [
          `先在${input.sceneBefore.locationLabel}完成玩家行动及其即时回应。`,
          `完成旧场的玩家行动和在场 NPC 即时回应后，直接转到${input.sceneAfter.timeLabel}的${input.sceneAfter.locationLabel}；只在新场呈现新到期的世界行动。`,
          `转场后的现场只允许${input.sceneAfter.presentActorRefs.map((ref) => runtimeTargetFor(ref).label).join("、")}在场；其他人物、随员和未呈到的文书不得随转场出现。`,
          sceneDocumentBoundary(input.sceneAfter),
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
    sceneBeats: foregroundSceneBeats,
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

function buildNextStoryBeat(input: {
  pkg: PartOneRuntimePackage;
  decisionKernelId: string | null;
  actionText: string;
  settledActionNarrative?: string;
  fallbackContinuation?: string;
  playerVisibleFallback?: PartOnePlayerVisibleFallback;
  foregroundPreludeBeats: Array<{ beatId: string; action: string }>;
  sceneAfter: PartOneSceneState;
  sectionTransitioned: boolean;
  authoritativeObservableFacts: string[];
  authoritativeNpcReactions: PartOneCommittedEvent["authoritativeNpcReactions"];
  authoritativeWorldMoves: PartOneAuthoritativeWorldMove[];
  nextDecisionPoint: PartOneDecisionPoint;
  unresolvedFacts: string[];
}): PartOneNarrativePlan["nextStoryBeat"] {
  if (!input.decisionKernelId) {
    throw new Error("PART_ONE_NEXT_STORY_BEAT_KERNEL_MISSING");
  }
  const kernel = requireAsset(input.pkg, input.decisionKernelId);
  const kernelClaimIds = new Set(kernel.sourceClaimIds);
  const selectedScenePatterns = selectNarrativeScenePatterns(input.pkg.assets, {
    sectionId: kernel.sectionIds[0] || "",
    decisionKernelId: input.decisionKernelId,
    requirementIds: kernel.requirementIds
  }, 2).map((asset) => {
    const pattern = asset.payload as unknown as import("./narrative-scene-pattern").NarrativeScenePattern;
    return {
      patternId: pattern.patternId,
      dramaticFunction: pattern.dramaticFunction,
      openingPressure: pattern.openingPressure,
      orderedBeats: pattern.orderedBeats,
      dialogueTactics: pattern.dialogueTactics,
      blockingPrinciples: pattern.blockingPrinciples,
      objectPowerMoves: pattern.objectPowerMoves,
      transferableTechniques: pattern.transferableTechniques,
      forbiddenFlattening: pattern.forbiddenFlattening
    };
  });
  const sourceScenes = input.pkg.assets.filter((asset) =>
    asset.assetType === "SOURCE_SCENE_EVIDENCE"
    && asset.sourceClaimIds.some((claimId) => kernelClaimIds.has(claimId))
  );
  const sourceEvidenceItems = sourceScenes.flatMap((asset) => {
    const mechanisms = Array.isArray(asset.payload.mechanisms)
      ? asset.payload.mechanisms
      : [];
    return mechanisms.flatMap((raw) => {
      if (!isRecord(raw)) return [];
      const claimIds = asStringArray(raw.claimIds)
        .filter((claimId) => kernelClaimIds.has(claimId));
      if (!claimIds.length) return [];
      const statement = String(raw.statement || "").trim();
      const evidenceId = String(raw.evidenceId || "").trim();
      if (!statement || !evidenceId) return [];
      return [{
        evidenceId,
        evidenceClass: "ORIGINAL_MECHANISM" as const,
        statement,
        sourceClaimIds: claimIds,
        adaptationDecisionIds: [],
        useAs: "DRAMATIC_MECHANISM" as const
      }];
    });
  });
  const adaptationEvidenceItems = kernel.adaptationDecisionIds.flatMap((adaptationDecisionId) => {
    const adaptation = input.pkg.approvedAdaptations.find((item) =>
      item.adaptationDecisionId === adaptationDecisionId
    );
    if (!adaptation) return [];
    const statement = [
      ...asStringArray(adaptation.invariantsToPreserve),
      ...asStringArray(adaptation.intentionalDifferences)
    ].join("；");
    if (!statement) return [];
    return [{
      evidenceId: adaptationDecisionId,
      evidenceClass: "APPROVED_ADAPTATION" as const,
      statement,
      sourceClaimIds: [],
      adaptationDecisionIds: [adaptationDecisionId],
      useAs: "DRAMATIC_MECHANISM" as const
    }];
  });
  if (!sourceEvidenceItems.length && !adaptationEvidenceItems.length) {
    throw new Error(`PART_ONE_NEXT_STORY_BEAT_EVIDENCE_MISSING:${input.decisionKernelId}`);
  }

  const presentPressure = input.authoritativeWorldMoves.find((move) =>
    move.sourceType !== "SECTION_TRANSITION"
  );
  const fallbackPressure = input.authoritativeNpcReactions[0]?.action
    || input.nextDecisionPoint.prompt;
  const selectedReaction = presentPressure
    ? null
    : input.authoritativeNpcReactions[0] || null;
  const transitionMove = input.sectionTransitioned
    ? input.authoritativeWorldMoves.find((move) => move.sourceType === 'SECTION_TRANSITION') || null
    : null;
  const pressureAction = presentPressure?.action || fallbackPressure;
  // Scene identity is already rendered by the protected transition owned by
  // Settlement. The next story beat owns only the NPC/world pressure that
  // follows inside that settled scene. Keeping these surfaces separate avoids
  // both duplicate scene cuts and backend state prose leaking into Canon.
  const npcOrWorldPressure = pressureAction;
  const sourceEventIds = unique([
    ...input.foregroundPreludeBeats.map((beat) => beat.beatId),
    transitionMove?.beatId || '',
    presentPressure?.beatId || '',
    selectedReaction?.reactionEventId || ''
  ]).filter(Boolean);
  const deferredEventIds = unique([
    ...input.authoritativeWorldMoves.map((move) => move.beatId),
    ...input.authoritativeNpcReactions.map((reaction) => reaction.reactionEventId)
  ]).filter((eventId) => !sourceEventIds.includes(eventId));
  const presentMoves = unique([
    ...input.foregroundPreludeBeats.map((beat) => beat.action),
    npcOrWorldPressure
  ]);
  const currentFacts = unique([
    `玩家已经执行：${input.actionText}`,
    ...input.authoritativeObservableFacts,
    ...(input.sceneAfter.observableFacts || []),
    ...(input.sceneAfter.documentStates || []).map(renderSceneDocumentFact),
    ...(input.sceneAfter.objectStates || []).map(renderSceneObjectFact)
  ]);
  const evidenceItems = [
    ...currentFacts.map((statement, index) => ({
      evidenceId: `CURRENT-${input.decisionKernelId}-${index + 1}`,
      evidenceClass: (index === 0 ? "CURRENT_CANON" : "CURRENT_STATE") as "CURRENT_CANON" | "CURRENT_STATE",
      statement,
      sourceClaimIds: [],
      adaptationDecisionIds: [],
      useAs: "OBJECTIVE_FACT" as const
    })),
    ...sourceEvidenceItems,
    ...adaptationEvidenceItems
  ];
  const playerOutcome = String(input.settledActionNarrative || input.actionText).trim();
  const decisionStop = input.nextDecisionPoint.prompt.trim();
  const worldPressure = [
    npcOrWorldPressure,
    renderPlayerVisibleSceneContext(input.sceneAfter),
    input.sceneAfter.situation,
    input.authoritativeWorldMoves.find((move) => move.sourceType !== "SECTION_TRANSITION")?.action,
    input.authoritativeNpcReactions[0]?.action
  ]
    .map((value) => String(value || "").trim())
    .find((value) => value && value !== playerOutcome && value !== decisionStop);
  if (!worldPressure) {
    throw new Error(`PART_ONE_VISIBLE_PRESSURE_MISSING:${input.decisionKernelId}`);
  }
  // The deterministic planner owns the actual next decision. Author-written
  // fallback prose may supply the literary result and pressure, but it must
  // never carry an older stop point across a newly inserted continuation
  // decision. Bind the final slot to the selected decision point instead of
  // inferring compatibility from natural-language wording.
  const playerVisibleFallback = {
    ...(input.playerVisibleFallback || {
      PLAYER_RESULT: playerOutcome,
      ...(transitionMove?.action
        ? { SCENE_TRANSITION: transitionMove.action }
        : {}),
      WORLD_PRESSURE: worldPressure
    }),
    DECISION_STOP: decisionStop
  };
  const actorLabelsByRef = Object.fromEntries(
    input.sceneAfter.presentActorRefs.map((actorRef) => [actorRef, runtimeTargetFor(actorRef).label])
  );
  const actorPolicies = input.pkg.assets
    .filter((asset) => asset.assetType === "ACTOR_POLICY")
    .flatMap((asset) => asset.actorRefs.map((actorRef) => ({
      actorRef,
      goal: String(asset.payload.goal || asset.payload.dramaticFunction || "").trim()
    })));
  const dramaticBeatPlan = compileDramaticBeatPlan({
    sceneRef: input.sceneAfter.sceneId,
    // The objective belongs to the scene after Settlement. Reusing the
    // decision prompt that led into this turn can reintroduce actors or key
    // object states from the scene that just ended.
    sceneObjective: input.nextDecisionPoint.prompt,
    presentActorRefs: input.sceneAfter.presentActorRefs,
    actorLabelsByRef,
    pressureActorRefs: input.nextDecisionPoint.actorRefs,
    actorPolicies,
    pressureMeaning: playerVisibleFallback.WORLD_PRESSURE,
    decisionStopMeaning: playerVisibleFallback.DECISION_STOP
  });
  return {
    beatId: `BEAT-${digest([
      input.decisionKernelId,
      input.actionText,
      npcOrWorldPressure,
      input.nextDecisionPoint.decisionPointId
    ].join("|" )).slice(0, 18)}`,
    playerOutcome,
    npcOrWorldPressure,
    sourceEventIds,
    deferredEventIds,
    presentMoves,
    stopCondition: input.nextDecisionPoint.prompt,
    evidencePacket: {
      packetId: `SEP-${digest(evidenceItems.map((item) => item.evidenceId).join("|" )).slice(0, 18)}`,
      evidenceItems,
      unresolvedFacts: unique(input.unresolvedFacts),
      specificityBoundary: "原著材料只授权所列冲突机制；当前事实只能来自已提交 Canon 与服务器状态。不得自行增加人数、涨幅、地点、期限、文书、证据、命令、承诺或幕后关系。"
    },
    dramaticGuidance: {
      dramaticTask: String(
        isRecord(kernel.payload.decisionPrompt)
          ? kernel.payload.decisionPrompt.prompt || ""
          : ""
      ).trim() || input.nextDecisionPoint.prompt,
      sourceMechanisms: unique(sourceEvidenceItems.map((item) => item.statement)).slice(0, 3),
      scenePatterns: selectedScenePatterns
    },
    dramaticBeatPlan,
    fallbackContinuation: String(input.fallbackContinuation || "").trim(),
    playerVisibleFallback
  };
}

function renderPlayerVisibleSceneContext(scene: PartOneSceneState) {
  const actors = scene.presentActorRefs
    .map((ref) => runtimeTargetFor(ref).label)
    .filter(Boolean);
  if (actors.length) {
    return `${scene.timeLabel}，${actors.join("、")}仍在${scene.locationLabel}。`;
  }
  return `${scene.timeLabel}，议事仍在${scene.locationLabel}继续。`;
}

function renderSceneDocumentFact(
  document: NonNullable<PartOneSceneState["documentStates"]>[number]
) {
  const stateLabels: Record<typeof document.accessState, string> = {
    NOT_PRESENT: "不在当前场景",
    SEALED: "仍处于封存状态",
    OPENED: "已经打开",
    READ: "已经被在场人物读过",
    WRITTEN: "已经写成"
  };
  if (document.accessState === "NOT_PRESENT") {
    return document.label + stateLabels[document.accessState] + "。";
  }
  const holder = document.holderRef
    ? "，目前由" + runtimeTargetFor(document.holderRef).label + "持有"
    : "，当前没有明确持有人";
  return document.label + stateLabels[document.accessState] + holder + "。";
}

function renderSceneObjectFact(
  object: NonNullable<PartOneSceneState["objectStates"]>[number]
) {
  const facts = [
    object.holderRef
      ? object.label + "目前由" + runtimeTargetFor(object.holderRef).label + "持有"
      : object.label + "当前没有明确持有人"
  ];
  if (object.contentsState === "EMPTY") facts.push("其中为空");
  if (object.contentsState === "UNKNOWN") facts.push("其中内容尚不明确");
  if (object.contentsState === "CONTAINS_DOCUMENT") facts.push("其中已有文书");
  if (object.closureState === "CLOSED") facts.push("目前合拢");
  if (object.closureState === "OPEN") facts.push("目前打开");
  return facts.join("，") + "。";
}

function sceneDocumentBoundary(scene: PartOneSceneState) {
  const presentDocuments = (scene.documentStates || [])
    .filter((document) => document.accessState !== "NOT_PRESENT")
    .map((document) => document.label);
  const documentObjects = (scene.objectStates || [])
    .filter((object) => object.contentsState === "CONTAINS_DOCUMENT")
    .map((object) => object.label);
  const allowed = unique([...presentDocuments, ...documentObjects]);
  return allowed.length
    ? `新场获批在场的正式文书或证据容器仅有：${allowed.join("、")}；不得另添核验单、手帖、册匣或其他记录。`
    : "新场没有获批的正式文书或证据容器在案；普通无字纸张与笔砚只可作叙事纹理，不得命名成核验单、手帖、在办公文、册匣或其他记录。";
}

function buildWorldMoveNarrativeBeats(
  moves: PartOneAuthoritativeWorldMove[]
): PartOneNarrativePlan["sceneBeats"] {
  return moves.map((move) => ({
    beatId: move.beatId,
    sourceType: "WORLD_MOVE" as const,
    actorRefs: [...move.actorRefs],
    action: move.action,
    requiredTermGroups: clone(move.requiredTermGroups),
    resultCeiling: move.resultCeiling,
    mustAppear: true,
    hardRequired:
      move.sourceType === "DUE_CONSEQUENCE"
      || move.sourceType === "SECTION_TRANSITION"
      || move.sourceType === "SETTLED_RESPONSE"
  }));
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
    mustAppear: true,
    hardRequired: true
  }));
}

function resultCeilingForPlayerAction(action: string) {
  if (
    /督抚责任说明|责任说明/.test(action)
    && /巡抚要求派员参与复核/.test(action)
    && /总督尚未同意/.test(action)
    && /各自担责|各担其责/.test(action)
  ) {
    return [
      "浙江总督当场写成一份名为“督抚责任说明”的新文书；它与巡抚书吏回文匣中的改桑放行回文不是同一份。",
      "督抚责任说明中只写三项：巡抚要求派员参与复核、总督对此尚未同意、巡抚若有异议须另行成文并由督抚各自担责。正文必须让玩家直接知道这三项已经写入，不得只说写成了责任说明。",
      "不得补写原册所在地、保管人、移交办法、材料披露范围、复核主持权或其他程序结论。",
      "本回合不落印、不签押；责任说明留在总督案前，不交给巡抚书吏。书吏只能记下总督另具了责任说明，无权看见或认可其中主张。"
    ].join("");
  }

  if (
    /(?:改桑)?放行回文/.test(action)
    && /写明|写进|写入/.test(action)
  ) {
    return "浙江总督当场写成一份名为“改桑放行回文”的新文书；正文只载两项：清流县先办一批；不得趁急难压价买田。不得增加复核依据、执行条件、处罚、期限或其他条款。本回合不落印、不签押；写成后交给巡抚书吏收进既有回文匣。原先压在案上的巡抚催办公文仍留在总督案前。";
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
      /三日(?:限期|期限|之限|之内|之期)/,
      ["三日限期", "三日期限", "三日之限", "三日之内", "三日之期", "三日具报"]
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
    [
      /暂缓签发|暂不签发/,
      [
        "暂缓签发",
        "暂不签发",
        "扣下不签",
        "未即刻签发",
        "没有即刻签发",
        "没有落印",
        "没有碰印盒",
        "朱印未动"
      ]
    ],
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
      ["只准清流县先办一批", "清流县先办一批", "清流县先办第一批", "清流县试办", "清流试办", "限定试办"]
    ],
    [/清流县试办|清流试办|执行范围/, ["清流县试办", "清流试办", "执行范围"]],
    [/(?:改桑)?放行回文/, ["改桑放行回文", "放行回文", "回文"]],
    [
      /(?:写进|写入|写明)[^。；！？]{0,12}(?:改桑)?放行回文|(?:改桑)?放行回文[^。；！？]{0,12}(?:写明|写有)/,
      ["写明", "书明", "写进", "写入", "写下", "写的是", "写了", "落笔", "落字", "提笔", "批明", "另起一行", "补入", "添入", "补写"]
    ],
    [/压价买田|买田|购田/, ["压价买田", "压价买民田", "低价买田", "低价买民田", "趁急难买田", "趁急难压价买民田", "购田"]],
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
    [/复核/, ["复核", "核看", "核验", "查验"]],
    [/奏报|首报|入京/, ["奏报", "首报", "入京"]],
    [/粮|米行|开仓/, ["粮", "米", "仓"]],
    [/民田|卖田|购田|买田|田契/, ["民田", "卖田", "购田", "买田", "田契"]],
    [/具名|署名|联署/, ["具名", "署名", "联署"]],
    [/责任说明/, ["责任说明", "责任文书", "责任记录"]],
    [
      /各自成文|各自担责|各担其责/,
      ["各自成文", "分别成文", "各自担责", "分别担责", "各担其责", "各写各的", "各担各的"]
    ],
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
    ...((scene.locationRef || fallback.locationRef)
      ? { locationRef: String(scene.locationRef || fallback.locationRef) }
      : {}),
    presentActorRefs: unique(Array.isArray(scene.presentActorRefs) ? scene.presentActorRefs.map(String) : fallback.presentActorRefs),
    situation: String(scene.situation || fallback.situation),
    observableFacts: unique(
      Array.isArray(scene.observableFacts)
        ? scene.observableFacts.map(String)
        : fallback.observableFacts || []
    ),
    documentStates: Array.isArray(scene.documentStates)
      ? clone(scene.documentStates)
      : clone(fallback.documentStates || []),
    objectStates: Array.isArray(scene.objectStates)
      ? clone(scene.objectStates)
      : clone(fallback.objectStates || [])
  };
}

function normalizePartOneDurableState(
  value: DurableState | undefined,
  worldId: string
): DurableState {
  return {
    worldId: String(value?.worldId || worldId),
    revision: Number.isInteger(value?.revision) && Number(value?.revision) >= 0
      ? Number(value?.revision)
      : 0,
    predicates: Array.isArray(value?.predicates) ? clone(value.predicates) : [],
    pendingRuleIds: Array.isArray(value?.pendingRuleIds)
      ? unique(value.pendingRuleIds.map(String))
      : []
  };
}

function advancePartOneDurableState(
  state: DurableState,
  effects: DurablePredicate[]
): DurableState {
  return {
    ...state,
    revision: state.revision + 1,
    predicates: mergeDurablePredicates(state.predicates, effects)
  };
}

function currentEntityLocation(state: DurableState, entityId: string): string | null {
  const predicate = state.predicates.find(
    (item): item is Extract<DurablePredicate, { type: "ENTITY.LOCATED_AT" }> =>
      item.type === "ENTITY.LOCATED_AT" && item.entityId === entityId
  );
  return predicate?.locationId || null;
}

function currentEntityState(
  state: DurableState,
  entityId: string,
  attribute: string
): string | number | boolean | null | undefined {
  const predicate = state.predicates.find(
    (item): item is Extract<DurablePredicate, { type: "ENTITY.STATE" }> =>
      item.type === "ENTITY.STATE"
      && item.entityId === entityId
      && item.attribute === attribute
  );
  return predicate?.value;
}

/**
 * Projects only settled durable facts into the current scene. Narrative prose
 * never calls this function and therefore cannot move, seal, create, or hand
 * over a key entity merely by mentioning it.
 *
 * This projector is intentionally language- and world-independent: it reads
 * typed predicates only. Story packages provide entity IDs and display names;
 * no action text, option ID, synonym, or regular expression participates.
 */
function projectDurableStateIntoScene(
  scene: PartOneSceneState,
  durableState: DurableState
) {
  if (!scene.locationRef) return;

  const actorLocation = (actorId: string) => currentEntityLocation(durableState, actorId);
  scene.presentActorRefs = unique(scene.presentActorRefs).filter((actorId) => {
    const locationId = actorLocation(actorId);
    return !locationId || locationId === scene.locationRef;
  });
  const presentActors = new Set(scene.presentActorRefs);

  const configuredDocumentIds = (scene.documentStates || [])
    .map((document) => document.documentRef);
  const durableDocumentIds = unique(durableState.predicates.flatMap((predicate) => {
    if (predicate.type === "DOCUMENT.CREATED") return [predicate.documentId];
    if (
      (predicate.type === "ENTITY.LOCATED_AT"
        || predicate.type === "ENTITY.HELD_BY"
        || predicate.type === "ENTITY.STATE")
      && predicate.entityId.startsWith("document.")
    ) return [predicate.entityId];
    return [];
  }));
  const visibleDurableDocumentIds = durableDocumentIds.filter((documentRef) => {
    const locationRef = currentEntityLocation(durableState, documentRef);
    const holderRef = currentEntityHolder(durableState, documentRef)
      || asActorRef(currentEntityState(durableState, documentRef, "custodianRef"));
    return locationRef === scene.locationRef
      || Boolean(holderRef && presentActors.has(holderRef));
  });
  const documentIds = unique([
    ...configuredDocumentIds,
    ...visibleDurableDocumentIds
  ]);
  const existingDocuments = new Map(
    (scene.documentStates || []).map((document) => [document.documentRef, clone(document)])
  );
  scene.documentStates = documentIds.map((documentRef) => {
    const existing = existingDocuments.get(documentRef);
    const label = existing?.label || runtimeTargetFor(documentRef).label;
    const locationRef = currentEntityLocation(durableState, documentRef);
    const holderRef = currentEntityHolder(durableState, documentRef)
      || asActorRef(currentEntityState(durableState, documentRef, "custodianRef"))
      || existing?.holderRef
      || null;
    const durableAccessState = currentEntityState(durableState, documentRef, "accessState");
    const created = durableState.predicates.some(
      (predicate) => predicate.type === "DOCUMENT.CREATED" && predicate.documentId === documentRef
    );
    const accessState = isSceneDocumentAccessState(durableAccessState)
      ? durableAccessState
      : created
        ? "WRITTEN"
        : existing?.accessState || "NOT_PRESENT";
    const locatedElsewhere = Boolean(locationRef && locationRef !== scene.locationRef);
    const heldByAbsentActor = Boolean(holderRef && !presentActors.has(holderRef));
    if (locatedElsewhere || heldByAbsentActor) {
      const knownPlace = locationRef
        ? runtimeTargetFor(locationRef).label
        : holderRef
          ? `${runtimeTargetFor(holderRef).label}处`
          : "场外";
      return {
        documentRef,
        label,
        accessState: "NOT_PRESENT" as const,
        holderRef: null,
        continuityNote: `${label}的权威状态显示其仍在${knownPlace}，不在当前场景。`
      };
    }
    return {
      documentRef,
      label,
      accessState,
      holderRef,
      continuityNote: `${label}的场景状态完全来自已结算的 Durable Effect。`
    };
  });

  scene.objectStates = (scene.objectStates || []).flatMap((entry) => {
    const object = clone(entry);
    const locationRef = currentEntityLocation(durableState, object.objectRef);
    const holderRef = currentEntityHolder(durableState, object.objectRef) || object.holderRef;
    if (locationRef && locationRef !== scene.locationRef) return [];
    if (holderRef && !presentActors.has(holderRef)) return [];
    object.holderRef = holderRef || null;
    const contentsState = currentEntityState(durableState, object.objectRef, "contentsState");
    const closureState = currentEntityState(durableState, object.objectRef, "closureState");
    if (isSceneObjectContentsState(contentsState)) object.contentsState = contentsState;
    if (isSceneObjectClosureState(closureState)) object.closureState = closureState;
    object.continuityNote = `${object.label}的场景状态完全来自已结算的 Durable Effect。`;
    return [object];
  });
}

function currentEntityHolder(state: DurableState, entityId: string): string | null {
  const predicate = state.predicates.find(
    (item): item is Extract<DurablePredicate, { type: "ENTITY.HELD_BY" }> =>
      item.type === "ENTITY.HELD_BY" && item.entityId === entityId
  );
  return predicate?.actorId || null;
}

function asActorRef(value: unknown): string | null {
  return typeof value === "string" && value.startsWith("actor.") ? value : null;
}

function isSceneDocumentAccessState(
  value: unknown
): value is NonNullable<PartOneSceneState["documentStates"]>[number]["accessState"] {
  return ["NOT_PRESENT", "SEALED", "OPENED", "READ", "WRITTEN"].includes(String(value));
}

function isSceneObjectContentsState(
  value: unknown
): value is NonNullable<PartOneSceneState["objectStates"]>[number]["contentsState"] {
  return ["EMPTY", "UNKNOWN", "CONTAINS_DOCUMENT"].includes(String(value));
}

function isSceneObjectClosureState(
  value: unknown
): value is NonNullable<PartOneSceneState["objectStates"]>[number]["closureState"] {
  return ["CLOSED", "OPEN", "UNKNOWN"].includes(String(value));
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
    GOVERNOR_PRELIMINARY_INQUIRY: "总督已从密信报疑启动初步查问，尚未确定正式复核程序",
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

function buildAuthoritativeNpcReactions(input: {
  eventId: string;
  sceneAfter: PartOneSceneState;
  nextWorkingSet: PartOneRuntimeWorkingSet;
}): PartOneCommittedEvent["authoritativeNpcReactions"] {
  // Continuation pressures are already emitted as authoritative world moves.
  // Emitting the same pressure as an NPC reaction would duplicate the scene
  // stop. A terminal handoff is player navigation, not an NPC action.
  if (
    input.nextWorkingSet.nextDecisionPressure
    || input.nextWorkingSet.decisionPoint.decisionPointId === "PART-02-HANDOFF-PREVIEW"
  ) {
    return [];
  }
  const point = input.nextWorkingSet.decisionPoint;
  const presentActors = new Set(input.sceneAfter.presentActorRefs);
  const actorRefs = point.actorRefs.filter((actorRef) => presentActors.has(actorRef));
  if (!actorRefs.length) {
    throw new Error(`PART_ONE_RUNTIME_DECISION_PROMPT_ACTOR_NOT_PRESENT:${point.decisionPointId}`);
  }
  return [{
    reactionEventId: `NEXT-${digest(`${input.eventId}:${point.decisionPointId}`).slice(0, 18)}`,
    actorRefs,
    action: point.prompt,
    policyAssetId: point.sourceAssetId
  }];
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
  if (ref.startsWith("location.")) return { type: "LOCATION", id: ref, label: ref.replace(/^location\./, "") };
  if (ref.startsWith("document.")) return { type: "DOCUMENT", id: ref, label: ref.replace(/^document\./, "") };
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
