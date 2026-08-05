import { createHash } from "node:crypto";
import * as packageNamespace from "./index.js";
import { compileDramaticBeatPlan } from "./story-package/dramatic-beat-plan.js";
import {
  buildPartOneRuntimeWorkingSet,
  settlePartOneAction as settleBasePartOneAction,
  type PartOneIncomingAction,
} from "./story-package/part-one-runtime-engine.js";
import type {
  PartOneActionSettlement,
  PartOneAuthoritativeWorldMove,
  PartOnePendingConsequenceState,
  PartOneRuntimePackage,
  PartOneRuntimeWorkingSet,
  PartOneState,
} from "./story-package/part-one-runtime-types.js";

export * from "./index.js";

const CAPABILITY_ACTION_PREFIX = "\u2063OMW_CAPABILITY_V1:";
const CAPABILITY_ACTION_SUFFIX = "\u2063";

type CapabilityActionEnvelope = {
  schemaVersion: "omw-capability-action-v1";
  decisionPointId: string;
  action: string;
};

/**
 * Public runtime facade used by the OpenNovel process.
 *
 * The original Part One engine remains the only implementation for authored
 * options and openings. This wrapper handles only a structurally authenticated
 * capability action produced by the Intent Resolver. The action consumes a
 * turn and may surface one already-due consequence, but it cannot complete the
 * open Kernel, apply an authored option patch, create a new consequence, move
 * section, or invent a durable fact.
 */
function settleCapabilityAwarePartOneAction(
  pkg: PartOneRuntimePackage,
  currentState: PartOneState,
  incoming: PartOneIncomingAction,
  turnNumber: number,
): PartOneActionSettlement {
  const envelope = decodeCapabilityAction(incoming.actionText);
  if (!envelope) {
    return settleBasePartOneAction(pkg, currentState, incoming, turnNumber);
  }
  if (incoming.source !== "FREE_TEXT") {
    throw new Error("PART_ONE_CAPABILITY_SOURCE_INVALID");
  }

  const workingSet = buildPartOneRuntimeWorkingSet(
    pkg,
    currentState,
    Math.max(0, turnNumber - 1),
  );
  if (workingSet.decisionPoint.decisionPointId !== envelope.decisionPointId) {
    throw new Error("PART_ONE_CAPABILITY_DECISION_POINT_STALE");
  }
  if (!workingSet.decisionAffordances.length) {
    throw new Error("PART_ONE_CAPABILITY_AFFORDANCE_SURFACE_MISSING");
  }

  const scaffoldAffordance = workingSet.decisionAffordances[0]!;
  const scaffold = settleBasePartOneAction(
    pkg,
    currentState,
    {
      source: "RECOMMENDED",
      decisionKernelId: scaffoldAffordance.decisionKernelId,
      affordanceTemplateId: scaffoldAffordance.affordanceTemplateId,
      label: scaffoldAffordance.title,
      actionText: scaffoldAffordance.actionText,
      targetRef: scaffoldAffordance.target.id,
    },
    turnNumber,
  );

  return buildObserveOnlyCapabilitySettlement({
    pkg,
    currentState,
    incoming,
    actionText: envelope.action,
    workingSet,
    scaffold,
    turnNumber,
  });
}

function buildObserveOnlyCapabilitySettlement(input: {
  pkg: PartOneRuntimePackage;
  currentState: PartOneState;
  incoming: PartOneIncomingAction;
  actionText: string;
  workingSet: PartOneRuntimeWorkingSet;
  scaffold: PartOneActionSettlement;
  turnNumber: number;
}): PartOneActionSettlement {
  const beforeState = clone(input.scaffold.beforeState);
  const proposedState = clone(beforeState);
  const eventId = `CAP-P1-${String(input.turnNumber).padStart(2, "0")}-${digest([
    beforeState.lastCommittedEventId || "ROOT",
    input.workingSet.openDecisionKernel.assetId,
    input.workingSet.decisionPoint.decisionPointId,
    input.actionText,
  ].join("|" )).slice(0, 16)}`;

  proposedState.turnNumber = input.turnNumber;
  proposedState.sectionTurnNumber = Number(beforeState.sectionTurnNumber || 0) + 1;
  proposedState.lastCommittedEventId = eventId;
  proposedState.scene = clone(beforeState.scene);
  proposedState.pendingConsequences = (beforeState.pendingConsequences || []).map((item) => (
    ["PENDING", "DUE"].includes(item.status) && item.dueTurn <= input.turnNumber
      ? { ...clone(item), status: "DUE" as const }
      : clone(item)
  ));

  const dueConsequence = firstPayableDueConsequence(
    proposedState.pendingConsequences,
    proposedState.scene.presentActorRefs,
    input.turnNumber,
  );
  const worldMove = dueConsequence
    ? dueWorldMove(dueConsequence)
    : currentDecisionPressure(input.workingSet, eventId);
  const pendingStatusChanged = !sameJson(
    beforeState.pendingConsequences || [],
    proposedState.pendingConsequences || [],
  );
  const changedStatePaths = [
    "turnNumber",
    "sectionTurnNumber",
    "lastCommittedEventId",
    ...(pendingStatusChanged ? ["pendingConsequences"] : []),
  ];

  const playerOutcome = [
    `你先按现有权限采取了一步准备或查证行动：${input.actionText}。`,
    "这一步没有完成当前正式处置，也没有改变既有命令、证据、文书、秘密、责任或资源状态。",
  ].join("");
  const capabilityFact = [
    `玩家在当前公开决策点内采取了能力级准备行动：${input.actionText}。`,
    "当前 Decision Kernel 仍然开放，尚未结算任何推荐行动的状态效果。",
  ].join("");
  const worldPressure = worldMove.action;
  const decisionStop = input.workingSet.decisionPoint.prompt;
  const scene = clone(beforeState.scene);
  const scaffoldPlan = input.scaffold.event.narrativePlan;
  const actorLabelsByRef = labelsForScene(scaffoldPlan, scene.presentActorRefs);
  const actorPolicies = input.pkg.assets
    .filter((asset) => asset.assetType === "ACTOR_POLICY")
    .flatMap((asset) => asset.actorRefs.map((actorRef) => ({
      actorRef,
      goal: String(asset.payload.goal || asset.payload.dramaticFunction || "").trim(),
    })));
  const dramaticBeatPlan = compileDramaticBeatPlan({
    sceneRef: scene.sceneId,
    sceneObjective: input.workingSet.section.dramaticPurpose,
    presentActorRefs: scene.presentActorRefs,
    actorLabelsByRef,
    pressureActorRefs: worldMove.actorRefs.length
      ? worldMove.actorRefs
      : input.workingSet.decisionPoint.actorRefs,
    actorPolicies,
    pressureMeaning: worldPressure,
    decisionStopMeaning: decisionStop,
  });

  const mechanismEvidence = scaffoldPlan.nextStoryBeat.evidencePacket.evidenceItems
    .filter((item) => item.evidenceClass !== "CURRENT_CANON" && item.evidenceClass !== "CURRENT_STATE")
    .map(clone);
  const evidenceItems = [
    {
      evidenceId: `CURRENT-CAPABILITY-${digest(eventId).slice(0, 12)}`,
      evidenceClass: "CURRENT_CANON" as const,
      statement: capabilityFact,
      sourceClaimIds: [],
      adaptationDecisionIds: [],
      useAs: "OBJECTIVE_FACT" as const,
    },
    ...mechanismEvidence,
  ];
  const actionBeatId = `CAPABILITY-ACTION-${digest(eventId).slice(0, 12)}`;
  const narrativePlan = {
    sceneStart: clone(scene),
    sceneEnd: clone(scene),
    presentActorLabels: unique(scene.presentActorRefs.map((actorRef) => actorLabelsByRef[actorRef] || actorRef)),
    sceneStartActorLabels: scene.presentActorRefs.map((actorRef) => actorLabelsByRef[actorRef] || actorRef),
    sceneEndActorLabels: scene.presentActorRefs.map((actorRef) => actorLabelsByRef[actorRef] || actorRef),
    transitionAllowed: false,
    authorizedActorArrivals: [],
    authorizedActorDepartures: [],
    dramaticTask: input.workingSet.section.dramaticPurpose,
    actionAlreadyOccurred: input.actionText,
    playerSpeechMode: "INDIRECT_ONLY" as const,
    authorizedPlayerSpeech: [],
    settledActionNarrative: playerOutcome,
    nextStoryBeat: {
      beatId: `BEAT-CAPABILITY-${digest([
        input.workingSet.openDecisionKernel.assetId,
        input.actionText,
        decisionStop,
      ].join("|" )).slice(0, 18)}`,
      sourceEventIds: [worldMove.beatId],
      deferredEventIds: [],
      presentMoves: [worldPressure],
      playerOutcome,
      npcOrWorldPressure: worldPressure,
      stopCondition: decisionStop,
      evidencePacket: {
        packetId: `SEP-CAPABILITY-${digest(evidenceItems.map((item) => item.evidenceId).join("|" )).slice(0, 18)}`,
        evidenceItems,
        unresolvedFacts: unique([
          ...scaffoldPlan.nextStoryBeat.evidencePacket.unresolvedFacts,
          "这次能力级行动没有完成当前正式决策，也没有授权任何新的持久事实。",
        ]),
        specificityBoundary: scaffoldPlan.nextStoryBeat.evidencePacket.specificityBoundary,
      },
      dramaticGuidance: clone(scaffoldPlan.nextStoryBeat.dramaticGuidance),
      dramaticBeatPlan,
      fallbackContinuation: "在场人物只能围绕这一步作即时反应；不得形成新的命令、证据、承诺、文书或持久结果。",
      playerVisibleFallback: {
        PLAYER_RESULT: playerOutcome,
        WORLD_PRESSURE: worldPressure,
        DECISION_STOP: decisionStop,
      },
    },
    confirmedEffects: [capabilityFact],
    unresolvedFacts: unique([
      ...scaffoldPlan.unresolvedFacts,
      "当前 Decision Kernel 尚未完成。",
    ]),
    npcAgenda: [],
    sceneBlocking: [
      `本轮始于并结束于${scene.timeLabel}的${scene.locationLabel}。`,
      "本轮没有获批的新人物入场或离场。",
      "能力级行动只允许产生即时观察、询问或准备过程，不得形成新的正式命令、证据、承诺、文书、秘密揭示或办理完成结果。",
    ],
    incidentalTextureAllowances: [],
    sceneBeats: [
      {
        beatId: actionBeatId,
        sourceType: "PLAYER_ACTION" as const,
        actorRefs: [input.pkg.perspectiveRoleKey],
        action: input.actionText,
        requiredTermGroups: [],
        resultCeiling: "只写玩家明确提出的准备、观察、询问或查证过程；不得把它升级成某个推荐行动已经完成。",
        mustAppear: false,
        hardRequired: false,
      },
      {
        beatId: worldMove.beatId,
        sourceType: "WORLD_MOVE" as const,
        actorRefs: [...worldMove.actorRefs],
        action: worldMove.action,
        requiredTermGroups: clone(worldMove.requiredTermGroups),
        resultCeiling: worldMove.resultCeiling,
        mustAppear: true,
        hardRequired: worldMove.sourceType === "DUE_CONSEQUENCE",
      },
    ],
    requiredEndChange: worldPressure,
    narrativeCeiling: [
      "只呈现玩家这次能力级准备行动和一个已授权的现场压力。",
      "不得套用任何推荐选项的状态效果，不得完成当前 Decision Kernel。",
      "不得新增人物、文书、证据、数量、期限、发现、承诺、命令或办理完成结果。",
      "正文必须停在同一个公开决策点，由玩家继续作正式决定。",
    ],
  };

  return {
    beforeState,
    proposedState,
    event: {
      schemaVersion: "sangtian-part-one-event-v1",
      eventId,
      turnNumber: input.turnNumber,
      sectionIdBefore: beforeState.sectionId,
      sectionIdAfter: beforeState.sectionId,
      actionSource: "FREE_TEXT_CAPABILITY",
      decisionKernelId: input.workingSet.openDecisionKernel.assetId,
      affordanceTemplateId: null,
      actionText: input.actionText,
      targetRef: input.incoming.targetRef
        || input.workingSet.decisionPoint.actorRefs[0]
        || "public_frame",
      statePatch: {},
      durableEffects: [],
      changedStatePaths,
      createdPendingConsequenceIds: [],
      duePendingConsequenceIds: dueConsequence ? [dueConsequence.consequenceId] : [],
      authoritativeObservableFacts: [capabilityFact],
      authoritativeNpcReactions: [],
      sceneBefore: clone(scene),
      sceneAfter: clone(scene),
      authoritativeWorldMoves: [worldMove],
      nextDecisionPoint: clone(input.workingSet.decisionPoint),
      narrativePlan,
      sectionTransitioned: false,
    },
    appliedAffordance: null,
    dueConsequences: dueConsequence ? [clone(dueConsequence)] : [],
  };
}

function firstPayableDueConsequence(
  consequences: PartOnePendingConsequenceState[],
  presentActorRefs: string[],
  turnNumber: number,
) {
  const present = new Set(presentActorRefs);
  return consequences.find((item) => {
    if (item.status !== "DUE" || item.dueTurn > turnNumber) return false;
    const actorRefs = item.payoffBeat?.actorRefs || [];
    return !actorRefs.length || actorRefs.some((actorRef) => present.has(actorRef));
  }) || null;
}

function dueWorldMove(
  consequence: PartOnePendingConsequenceState,
): PartOneAuthoritativeWorldMove {
  const payoff = consequence.payoffBeat;
  return {
    beatId: payoff.beatId,
    sourceType: "DUE_CONSEQUENCE",
    sourceId: consequence.ruleAssetId,
    actorRefs: [...payoff.actorRefs],
    action: payoff.action,
    requiredTermGroups: clone(payoff.requiredTermGroups),
    resultCeiling: payoff.resultCeiling,
    consequenceId: consequence.consequenceId,
  };
}

function currentDecisionPressure(
  workingSet: PartOneRuntimeWorkingSet,
  eventId: string,
): PartOneAuthoritativeWorldMove {
  return {
    beatId: `CAPABILITY-PRESSURE-${digest(eventId).slice(0, 12)}`,
    sourceType: "NEXT_DECISION_PRESSURE",
    sourceId: workingSet.openDecisionKernel.assetId,
    actorRefs: [...workingSet.decisionPoint.actorRefs],
    action: `这一步尚未完成当前正式处置；在场各方仍等候你决定：${workingSet.decisionPoint.prompt}`,
    requiredTermGroups: [],
    resultCeiling: "只把同一个未决问题重新压到玩家面前；不得替玩家选择，也不得写出任何推荐行动的结果。",
  };
}

function labelsForScene(
  scaffoldPlan: PartOneActionSettlement["event"]["narrativePlan"],
  actorRefs: string[],
) {
  const labels = new Map<string, string>();
  scaffoldPlan.sceneStart.presentActorRefs.forEach((actorRef, index) => {
    labels.set(actorRef, scaffoldPlan.sceneStartActorLabels[index] || actorRef);
  });
  scaffoldPlan.sceneEnd.presentActorRefs.forEach((actorRef, index) => {
    if (!labels.has(actorRef)) {
      labels.set(actorRef, scaffoldPlan.sceneEndActorLabels[index] || actorRef);
    }
  });
  return Object.fromEntries(actorRefs.map((actorRef) => [
    actorRef,
    labels.get(actorRef) || actorRef,
  ]));
}

function decodeCapabilityAction(value: string): CapabilityActionEnvelope | null {
  const text = String(value || "");
  if (!text.startsWith(CAPABILITY_ACTION_PREFIX) || !text.endsWith(CAPABILITY_ACTION_SUFFIX)) {
    return null;
  }
  const encoded = text.slice(
    CAPABILITY_ACTION_PREFIX.length,
    text.length - CAPABILITY_ACTION_SUFFIX.length,
  );
  try {
    const parsed = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as Partial<CapabilityActionEnvelope>;
    const decisionPointId = String(parsed.decisionPointId || "").trim();
    const action = String(parsed.action || "").trim();
    if (
      parsed.schemaVersion !== "omw-capability-action-v1"
      || !decisionPointId
      || !action
    ) {
      throw new Error("invalid envelope");
    }
    return {
      schemaVersion: "omw-capability-action-v1",
      decisionPointId,
      action,
    };
  } catch {
    throw new Error("PART_ONE_CAPABILITY_ENVELOPE_INVALID");
  }
}

function digest(value: string) {
  return createHash("sha256").update(value).digest("hex").toUpperCase();
}

function sameJson(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function unique<T>(values: T[]) {
  return [...new Set(values)];
}

const runtimeFacade = {
  ...packageNamespace,
  settlePartOneAction: settleCapabilityAwarePartOneAction,
};

export default runtimeFacade;
