import path from "node:path";
import templatesPackage from "@ai-story/templates";
import {
  type PartOneActionSettlement,
  type PartOneIncomingAction,
  type PartOneRuntimeAffordance,
  type PartOneRuntimePackage,
  type PartOneState,
} from "@ai-story/templates";
import { appendJsonl, readJson, readText, writeJsonAtomic } from "./io.js";
import type { AtomicTurnProjection } from "./atomic-turn.js";
import type {
  AuthoredDecisionAdapter,
  PreparedAuthoredDecision,
} from "./decision-adapter.js";
import type { FileStoryWorkspace } from "./workspace.js";
import type { OpenNovelOption } from "./types.js";
import { renderDeterministicFallback } from "./deterministic-fallback.js";
import { actionRejected } from "./runtime-errors.js";
import { compileProtectedSceneTransition } from "./protected-state-transition.js";

const {
  buildPartOneRuntimeWorkingSet,
  finalizePartOneSettlement,
  loadPartOneRuntimePackage,
  settlePartOneAction,
} = templatesPackage;

export type PreparedSangtianDecision = {
  package: PartOneRuntimePackage;
  settlement: PartOneActionSettlement;
  selectedOption: OpenNovelOption | null;
};

export async function prepareSangtianDecision(
  workspace: FileStoryWorkspace,
  input: {
    runId: string;
    turnNumber: number;
    action: string;
    selectedOption: OpenNovelOption | null;
  },
): Promise<PreparedSangtianDecision | null> {
  const metadata = await workspace.metadata(input.runId);
  if (metadata.worldId !== "sangtian" || metadata.roleId !== "zhejiang_governor") {
    return null;
  }
  const paths = workspace.paths(input.runId);
  const pkg = partOnePackage(workspace.projectRoot);
  const state = await readJson<PartOneState | null>(paths.partOneState, null);
  if (!state) throw new Error("SANGTIAN_PART_ONE_STATE_MISSING");

  const incoming = bindIncomingAction(
    pkg,
    state,
    input.turnNumber,
    input.action,
    input.selectedOption,
  );
  const settlement = settlePartOneAction(pkg, state, incoming, input.turnNumber);
  if (
    input.selectedOption
    && !input.selectedOption.id.startsWith("opening_")
    && !input.selectedOption.id.startsWith("opt_")
    && !settlement.appliedAffordance
  ) {
    throw actionRejected("AUTHORED_AFFORDANCE_BINDING_FAILED");
  }
  return {
    package: pkg,
    settlement,
    selectedOption: input.selectedOption
      ? withNarrativeContract(input.selectedOption, settlement)
      : null,
  };
}

export async function commitSangtianDecision(
  workspace: FileStoryWorkspace,
  runId: string,
  prepared: PreparedSangtianDecision,
) {
  const paths = workspace.paths(runId);
  // Settlement, not prose matching, owns causal finalization. P04 guarantees
  // required visibility through Protected Beat/Reviewer/Fallback before Head
  // publication; the adapter must never search natural language to decide
  // whether an authoritative world move happened.
  const paidConsequenceIds = prepared.settlement.event.authoritativeWorldMoves
    .filter((move) => (
      move.sourceType === "DUE_CONSEQUENCE"
      && move.consequenceId
    ))
    .map((move) => move.consequenceId!);
  const finalized = finalizePartOneSettlement(
    prepared.settlement,
    paidConsequenceIds,
  );
  prepared.settlement = finalized;
  await writeJsonAtomic(paths.partOneState, finalized.proposedState);
  await appendJsonl(paths.partOneEvents, finalized.event);
}

export async function projectSangtianDecision(
  workspace: FileStoryWorkspace,
  runId: string,
  prepared: PreparedSangtianDecision,
): Promise<AtomicTurnProjection> {
  const paths = workspace.paths(runId);
  const finalized = finalizeSangtianSettlement(prepared);
  const existingEvents = parseJsonLines(await readText(paths.partOneEvents, ""));
  return {
    stateRevision: finalized.proposedState,
    causalEvents: [finalized.event],
    delayedEvents: finalized.proposedState.pendingConsequences,
    projectionSummary: {
      eventId: finalized.event.eventId,
      decisionKernelId: finalized.event.decisionKernelId,
      affordanceTemplateId: finalized.event.affordanceTemplateId,
      changedStatePaths: finalized.event.changedStatePaths,
      nextDecisionPointId: finalized.event.nextDecisionPoint.decisionPointId,
    },
    materializedViews: [
      {
        relativePath: relativeRunPath(paths.root, paths.partOneState),
        format: "json",
        value: finalized.proposedState,
      },
      {
        relativePath: relativeRunPath(paths.root, paths.partOneEvents),
        format: "jsonl",
        value: [...existingEvents, finalized.event],
      },
    ],
  };
}

function finalizeSangtianSettlement(prepared: PreparedSangtianDecision) {
  const paidConsequenceIds = prepared.settlement.event.authoritativeWorldMoves
    .filter((move) => move.sourceType === "DUE_CONSEQUENCE" && move.consequenceId)
    .map((move) => move.consequenceId!);
  const finalized = finalizePartOneSettlement(prepared.settlement, paidConsequenceIds);
  prepared.settlement = finalized;
  return finalized;
}

export function nextSangtianOptions(
  prepared: PreparedSangtianDecision,
): OpenNovelOption[] {
  const state = prepared.settlement.proposedState;
  const nextTurnNumber = prepared.settlement.event.turnNumber + 1;
  const workingSet = buildPartOneRuntimeWorkingSet(
    prepared.package,
    state,
    prepared.settlement.event.turnNumber,
  );
  const options = workingSet.decisionAffordances.map((affordance) =>
    optionForAffordance(
      prepared.package,
      state,
      affordance,
      nextTurnNumber,
    )
  );
  if (options.some((option) => (
    option.effect?.decisionPointId !== prepared.settlement.event.nextDecisionPoint.decisionPointId
  ))) {
    throw new Error("SANGTIAN_NEXT_OPTIONS_DECISION_POINT_MISMATCH");
  }
  return options;
}

export async function currentSangtianOptions(
  workspace: FileStoryWorkspace,
  runId: string,
): Promise<OpenNovelOption[] | null> {
  const metadata = await workspace.metadata(runId);
  if (metadata.worldId !== "sangtian" || metadata.roleId !== "zhejiang_governor") {
    return null;
  }
  const paths = workspace.paths(runId);
  const state = await readJson<PartOneState | null>(paths.partOneState, null);
  if (!state) return null;
  const pkg = partOnePackage(workspace.projectRoot);
  const workingSet = buildPartOneRuntimeWorkingSet(pkg, state, metadata.turnNumber);
  return workingSet.decisionAffordances.map((affordance) =>
    optionForAffordance(pkg, state, affordance, metadata.turnNumber + 1)
  );
}

function bindIncomingAction(
  pkg: PartOneRuntimePackage,
  state: PartOneState,
  turnNumber: number,
  actionText: string,
  selectedOption: OpenNovelOption | null,
): PartOneIncomingAction {
  if (selectedOption?.id.startsWith("opening_")) {
    return {
      source: "RECOMMENDED",
      decisionId: selectedOption.id,
      actionText,
    };
  }
  if (selectedOption?.id.startsWith("opt_")) {
    return {
      source: "FREE_TEXT",
      actionText,
      targetRef: "public_frame",
    };
  }
  if (!selectedOption) {
    return {
      source: "FREE_TEXT",
      actionText,
      targetRef: "public_frame",
    };
  }
  const workingSet = buildPartOneRuntimeWorkingSet(
    pkg,
    state,
    Math.max(0, turnNumber - 1),
  );
  const affordance = workingSet.decisionAffordances.find(
    (candidate) => candidate.affordanceTemplateId === selectedOption.id,
  );
  if (
    !affordance
    || affordance.actionText !== actionText
    || selectedOption.effect?.decisionPointId !== workingSet.decisionPoint.decisionPointId
    || affordance.decisionPointId !== workingSet.decisionPoint.decisionPointId
  ) {
    throw actionRejected("STALE_OR_TAMPERED_AFFORDANCE");
  }
  return incomingForAffordance(affordance);
}

function incomingForAffordance(
  affordance: PartOneRuntimeAffordance,
): PartOneIncomingAction {
  return {
    source: "RECOMMENDED",
    decisionId: affordance.affordanceTemplateId,
    decisionKernelId: affordance.decisionKernelId,
    affordanceTemplateId: affordance.affordanceTemplateId,
    label: affordance.title,
    actionText: affordance.actionText,
    targetRef: affordance.target.id,
  };
}

function optionForAffordance(
  pkg: PartOneRuntimePackage,
  state: PartOneState,
  affordance: PartOneRuntimeAffordance,
  turnNumber: number,
): OpenNovelOption {
  const preview = settlePartOneAction(
    pkg,
    state,
    incomingForAffordance(affordance),
    turnNumber,
  );
  return withNarrativeContract(
    {
      id: affordance.affordanceTemplateId,
      // The page intentionally displays only the action a player can take.
      label: affordance.actionText,
      key: true,
      effect: {
        decisionPointId: affordance.decisionPointId,
        intent: affordance.immediateIntent,
        consequence: affordance.visibleTradeoff,
        reversible: false,
      },
    },
    preview,
  );
}

function withNarrativeContract(
  option: OpenNovelOption,
  settlement: PartOneActionSettlement,
): OpenNovelOption {
  const plan = settlement.event.narrativePlan;
  const requiredBeats = plan.sceneBeats.filter((beat) => beat.mustAppear);
  const hardRequiredGroups = requiredBeats
    .filter((beat) => beat.hardRequired)
    .flatMap((beat) => beat.requiredTermGroups);
  // The evidence profile owns opening_d1's narrower inquiry contract. The
  // authored state machine may still add an immediate NPC countermove that is
  // committed by the same turn. Merge that reaction into the evidence beat so
  // no authoritative event can exist backstage without appearing in Canon.
  if (option.id.startsWith("opening_") && option.effect?.beatContract) {
    const evidenceContract = option.effect.beatContract;
    const appendedBeats = requiredBeats.filter((beat) =>
      beat.sourceType === "NPC_REACTION"
      || beat.sourceType === "WORLD_MOVE"
    );
    return {
      ...option,
      effect: {
        ...option.effect,
        beatContract: {
          ...evidenceContract,
          sourceRef: `part-one-event:${settlement.event.eventId}`,
          moves: [
            ...(evidenceContract.moves || []),
            ...appendedBeats.map(renderNarrativeBeat),
          ],
          requiredAnchorGroups: mergeRequiredAnchorGroups(
            evidenceContract.requiredAnchorGroups || [],
            appendedBeats.flatMap((beat) => beat.requiredTermGroups),
          ),
          requiredDurableAnchorGroups: mergeRequiredAnchorGroups(
            evidenceContract.requiredDurableAnchorGroups || [],
            appendedBeats
              .filter((beat) => beat.hardRequired)
              .flatMap((beat) => beat.requiredTermGroups),
          ),
          constraints: [...new Set([
            ...(evidenceContract.constraints || []),
            ...plan.narrativeCeiling,
            ...plan.sceneBlocking,
            ...(plan.sceneEnd.documentStates || [])
              .map((item) => String(item.continuityNote || "").trim())
              .filter(Boolean),
          ])],
          settledNarrative:
            String(evidenceContract.settledNarrative || "").trim()
            || plan.settledActionNarrative,
          fallbackContinuation:
            String(plan.nextStoryBeat.fallbackContinuation || "").trim()
            || evidenceContract.fallbackContinuation,
          narrativeSeed: {
            playerOutcome: plan.nextStoryBeat.playerOutcome,
            continuationMoves: plan.nextStoryBeat.presentMoves,
            sourceEventIds: plan.nextStoryBeat.sourceEventIds,
            deferredEventIds: plan.nextStoryBeat.deferredEventIds,
            npcOrWorldPressure: plan.nextStoryBeat.npcOrWorldPressure,
            stopCondition: plan.nextStoryBeat.stopCondition,
          },
          sceneEvidence: plan.nextStoryBeat.evidencePacket,
          stopCondition: plan.nextStoryBeat.stopCondition,
        },
      },
    };
  }
  const constraints = [...new Set([
    ...requiredBeats
      .filter((beat) => beat.sourceType === "PLAYER_ACTION")
      .map((beat) => String(beat.resultCeiling || "").trim())
      .filter((ceiling) => ceiling && !isGenericResultCeiling(ceiling)),
    ...plan.narrativeCeiling
      .map((item) => String(item || "").trim())
      .filter(Boolean),
    ...plan.sceneBlocking
      .map((item) => String(item || "").trim())
      .filter(Boolean),
    ...(plan.sceneEnd.documentStates || [])
      .map((item) => String(item.continuityNote || "").trim())
      .filter(Boolean),
  ])];
  return {
    ...option,
    effect: {
      ...option.effect,
      // The action remains player-facing. The Beat Contract owns the
      // implementation details and result ceiling, so the Narrator can stage
      // the action without inventing a second policy, document, or outcome.
      intent: settlement.event.actionText,
      beatContract: {
        sourceRef: `part-one-event:${settlement.event.eventId}`,
        objective: plan.dramaticTask,
        // Kept for audit/reviewer compatibility. The Narrator receives the
        // server-owned narrativeSeed below, not this backstage beat list.
        moves: requiredBeats.map(renderNarrativeBeat),
        requiredAnchorGroups: requiredBeats.flatMap(
          (beat) => beat.requiredTermGroups,
        ),
        requiredDurableAnchorGroups: hardRequiredGroups,
        settledNarrative: plan.settledActionNarrative,
        fallbackContinuation:
          String(plan.nextStoryBeat.fallbackContinuation || "").trim()
          || option.effect?.beatContract?.fallbackContinuation,
        narrativeSeed: {
          playerOutcome: plan.nextStoryBeat.playerOutcome,
          continuationMoves: plan.nextStoryBeat.presentMoves,
          sourceEventIds: plan.nextStoryBeat.sourceEventIds,
          deferredEventIds: plan.nextStoryBeat.deferredEventIds,
          npcOrWorldPressure: plan.nextStoryBeat.npcOrWorldPressure,
          stopCondition: plan.nextStoryBeat.stopCondition,
        },
        sceneEvidence: plan.nextStoryBeat.evidencePacket,
        authorizedPlayerActions: requiredBeats
          .filter((beat) => beat.sourceType === "PLAYER_ACTION")
          .flatMap((beat) => [
            beat.action,
            String(beat.resultCeiling || "").trim(),
          ])
          .filter(Boolean),
        constraints,
        stopCondition: plan.nextStoryBeat.stopCondition,
      },
    },
  };
}

function renderNarrativeBeat(
  beat: PartOneActionSettlement["event"]["narrativePlan"]["sceneBeats"][number],
) {
  const ceiling = String(beat.resultCeiling || "").trim();
  return ceiling && !isGenericResultCeiling(ceiling)
    ? `${beat.action}。具体兑现：${ceiling}`
    : beat.action;
}

function mergeRequiredAnchorGroups(
  existing: string[][],
  additions: string[][],
) {
  const merged = existing.map((group) => [...group]);
  const axes = new Set(merged.map(anchorGroupAxis).filter(Boolean));
  for (const group of additions) {
    const axis = anchorGroupAxis(group);
    if (axis && axes.has(axis)) continue;
    merged.push([...group]);
    if (axis) axes.add(axis);
  }
  return merged;
}

function anchorGroupAxis(group: string[]) {
  const text = group.join("\n");
  if (
    /(?:没有去拿印|朱印未动|公文暂压|公文往案|暂缓签发|暂不签发|扣下不签|未即刻签发|没有即刻签发|没有落印|没有碰印盒)/u
      .test(text)
  ) {
    return "SIGNATURE_WITHHELD";
  }
  return "";
}

function isGenericResultCeiling(ceiling: string) {
  return (
    /^只把这项已经结算的行动写清/u.test(ceiling)
    || /^只写这项已经结算的 NPC 反应/u.test(ceiling)
  );
}

function partOnePackage(projectRoot: string) {
  return loadPartOneRuntimePackage(
    "sangtian",
    path.join(projectRoot, "packages", "templates", "config"),
  ).package;
}

export const sangtianDecisionAdapter: AuthoredDecisionAdapter = {
  currentOptions: currentSangtianOptions,

  async prepare(workspace, input) {
    const prepared = await prepareSangtianDecision(workspace, input);
    if (!prepared) return null;
    const event = prepared.settlement.event;
    const authoredProtectedText = String(
      prepared.selectedOption?.effect?.beatContract?.settledNarrative
        || event.narrativePlan.settledActionNarrative
        || "",
    ).trim();
    const protectedTransition = compilePartOneProtectedTransition(event);
    const protectedText = [authoredProtectedText, protectedTransition.text]
      .filter(Boolean)
      .join("\n\n");
    const beatContract = prepared.selectedOption?.effect?.beatContract;
    if (beatContract) {
      beatContract.settledNarrative = protectedText;
      if (beatContract.narrativeSeed) {
        beatContract.narrativeSeed.playerOutcome = protectedText;
      }
    }
    event.narrativePlan.settledActionNarrative = protectedText;
    event.narrativePlan.nextStoryBeat.playerOutcome = protectedText;
    return {
      selectedOption: prepared.selectedOption,
      settledNarrative: protectedText,
      sourceRef: `part-one-event:${event.eventId}`,
      storyComplete:
        prepared.settlement.proposedState.partCompletionStatus === "HANDOFF_READY",
      protectedBlocks: protectedText
        ? [{
            blockId: `${event.eventId}.protected.player-outcome`,
            sourceRefs: [
              event.eventId,
              ...event.changedStatePaths,
              ...protectedTransition.sourceRefs,
            ],
            text: protectedText,
            immutable: true as const,
          }]
        : [],
      fallbackText: buildSangtianFallback(prepared),
      truthContext: buildSangtianTruthContext(prepared),
      audit: {
        eventId: event.eventId,
        decisionKernelId: event.decisionKernelId,
        affordanceTemplateId: event.affordanceTemplateId,
        nextDecisionPointId: event.nextDecisionPoint.decisionPointId,
        changedStatePaths: event.changedStatePaths,
      },
      payload: prepared,
    } satisfies PreparedAuthoredDecision;
  },

  async commit(workspace, runId, prepared) {
    await commitSangtianDecision(
      workspace,
      runId,
      requireSangtianPayload(prepared),
    );
  },

  async projectCommit(workspace, runId, prepared) {
    return projectSangtianDecision(
      workspace,
      runId,
      requireSangtianPayload(prepared),
    );
  },

  nextOptions(prepared) {
    return nextSangtianOptions(requireSangtianPayload(prepared));
  },
};

function compilePartOneProtectedTransition(
  event: PartOneActionSettlement["event"],
) {
  const plan = event.narrativePlan;
  const actorLabels = new Map<string, string>([
    ...plan.sceneStart.presentActorRefs.map((actorRef, index) => [
      actorRef,
      plan.sceneStartActorLabels[index] || actorRef,
    ] as const),
    ...plan.sceneEnd.presentActorRefs.map((actorRef, index) => [
      actorRef,
      plan.sceneEndActorLabels[index] || actorRef,
    ] as const),
  ]);
  const sceneState = (scene: typeof plan.sceneStart) => ({
    sceneRef: scene.sceneId,
    timeLabel: scene.timeLabel,
    locationLabel: scene.locationLabel,
    presentActorRefs: [...scene.presentActorRefs],
    documents: (scene.documentStates || []).map((document) => ({
      entityRef: document.documentRef,
      label: document.label,
      status: document.accessState,
      holderRef: document.holderRef || null,
    })),
    objects: (scene.objectStates || []).map((object) => ({
      entityRef: object.objectRef,
      label: object.label,
      contentsState: object.contentsState || null,
      closureState: object.closureState || null,
      holderRef: object.holderRef || null,
    })),
  });
  return compileProtectedSceneTransition({
    before: sceneState(plan.sceneStart),
    after: sceneState(plan.sceneEnd),
    actorLabel: (actorRef) => actorLabels.get(actorRef) || actorRef,
    locale: "zh-CN",
  });
}

function parseJsonLines(text: string): unknown[] {
  return text.split(/\r?\n/u).filter(Boolean).map((line) => JSON.parse(line));
}

function relativeRunPath(root: string, target: string) {
  const relative = path.relative(root, target).split(path.sep).join("/");
  if (!relative || relative.startsWith("../") || path.posix.isAbsolute(relative)) {
    throw new Error("ATOMIC_ARTIFACT_PATH_INVALID");
  }
  return relative;
}

function requireSangtianPayload(prepared: PreparedAuthoredDecision) {
  const payload = prepared.payload as PreparedSangtianDecision | null;
  if (!payload?.settlement?.event || !payload.package) {
    throw new Error("AUTHORED_DECISION_PAYLOAD_INVALID");
  }
  return payload;
}

function buildSangtianTruthContext(prepared: PreparedSangtianDecision) {
  const event = prepared.settlement.event;
  // Publication happens after the authoritative settlement. A transition turn
  // must therefore review the destination scene; using sceneBefore makes valid
  // arrivals look invented and hides the real destination boundaries.
  const scene = event.sceneAfter;
  const plan = event.narrativePlan;
  const currentSourceEventIds = new Set(
    prepared.selectedOption?.effect?.beatContract?.narrativeSeed?.sourceEventIds
      || plan.nextStoryBeat.sourceEventIds,
  );
  const selectedSceneBeats = plan.sceneBeats.filter((beat) =>
    currentSourceEventIds.has(beat.beatId)
  );
  const actorRefsInCurrentBeat = new Set([
    ...plan.sceneStart.presentActorRefs,
    ...plan.sceneEnd.presentActorRefs,
    ...selectedSceneBeats.flatMap((beat) => beat.actorRefs || []),
  ]);
  const presentActorLabels = new Map(
    [
      ...plan.sceneStart.presentActorRefs.map((id, index) => [
        id,
        plan.sceneStartActorLabels[index] || id,
      ] as const),
      ...plan.sceneEnd.presentActorRefs.map((id, index) => [
        id,
        plan.sceneEndActorLabels[index] || id,
      ] as const),
    ],
  );
  const actors = [...new Set([
    ...actorRefsInCurrentBeat,
  ])];
  const originActorId = scene.presentActorRefs.find((id) => (
    id === prepared.package.perspectiveRoleKey
    || id.endsWith(`.${prepared.package.perspectiveRoleKey}`)
  )) || prepared.package.perspectiveRoleKey;
  const catalog = [
    ...actors.map((id) => ({
      id,
      kind: "ACTOR",
      displayName: presentActorLabels.get(id) || id,
    })),
    {
      id: `location:${scene.sceneId}`,
      kind: "LOCATION",
      displayName: scene.locationLabel,
    },
    ...(scene.documentStates || []).map((document) => ({
      id: document.documentRef,
      kind: "DOCUMENT",
      displayName: document.label,
    })),
    ...(scene.objectStates || []).map((object) => ({
      id: object.objectRef,
      kind: "OBJECT",
      displayName: object.label,
    })),
    ...selectedSceneBeats.map((beat) => ({
      id: beat.beatId,
      kind: "CAPABILITY",
      displayName: beat.action,
    })),
  ];
  const capabilityIds = [
    "runtime.capability.unspecified_order",
    ...selectedSceneBeats.map((beat) => beat.beatId),
  ];
  const pressureSupportId = `${plan.nextStoryBeat.beatId}:PRESSURE`;
  const requiredActorBeatIds = new Set([
    ...event.authoritativeNpcReactions.map((reaction) => reaction.reactionEventId),
    ...event.authoritativeWorldMoves
      .filter((move) => (
        move.sourceType === "DUE_CONSEQUENCE"
        || move.sourceType === "SETTLED_RESPONSE"
      ))
      .map((move) => move.beatId),
  ]);
  const visibleRequirements = selectedSceneBeats
    .filter((beat) => requiredActorBeatIds.has(beat.beatId))
    .flatMap((beat) =>
    (beat.actorRefs || [])
      .filter((actorId) => actorRefsInCurrentBeat.has(actorId))
      .map((actorId) => ({
          pattern: {
            type: "ACTOR.ORDERED" as const,
            constraints: {
              actorId,
              capabilityId: beat.beatId,
            },
          },
          requiredMeaning: beat.action,
          supportIds: [pressureSupportId],
      })),
    );
  const storyEvidence = plan.nextStoryBeat.evidencePacket;
  const knowledgeBoundary = prepared.selectedOption?.effect?.knowledgeBoundary;
  const knowledgeBoundaryRef = String(
    knowledgeBoundary?.sourceRef || prepared.selectedOption?.effect?.beatContract?.sourceRef || event.eventId,
  ).trim();
  const continuationMoves = prepared.selectedOption?.effect?.beatContract?.narrativeSeed?.continuationMoves
    || prepared.selectedOption?.effect?.beatContract?.continuationMoves
    || [];
  const supportedStoryFacts = [
    ...storyEvidence.evidenceItems
      .filter((item) => item.useAs === "OBJECTIVE_FACT")
      .map((item) => ({
        supportId: item.evidenceId,
        statement: item.statement,
        // The already-protected player action proves settlement provenance but
        // must never become a broad permit for new facts in the continuation.
        claimSupport: item.evidenceClass !== "CURRENT_CANON",
      })),
    ...(knowledgeBoundary?.allowed || []).map((statement, index) => ({
      supportId: `KNOWLEDGE:${knowledgeBoundaryRef}:ALLOW:${index + 1}`,
      statement,
      claimSupport: true,
    })),
    ...continuationMoves.map((statement, index) => ({
      supportId: `CONTINUATION:${knowledgeBoundaryRef}:${index + 1}`,
      statement,
      claimSupport: true,
    })),
    {
      supportId: pressureSupportId,
      statement: plan.nextStoryBeat.npcOrWorldPressure,
      claimSupport: false,
    },
    {
      supportId: `${plan.nextStoryBeat.beatId}:STOP`,
      statement: plan.nextStoryBeat.stopCondition,
      claimSupport: false,
    },
  ];
  return {
    originActorId,
    projectionActorId: originActorId,
    catalog: deduplicateCatalog(catalog),
    capabilityIds: [...new Set(capabilityIds)],
    secretIds: [],
    allowedPredicates: visibleRequirements.map((item) => item.pattern),
    requiredVisiblePredicates: visibleRequirements.map((item, index) => ({
      id: `${event.nextDecisionPoint.decisionPointId}:VISIBLE:${index + 1}`,
      pattern: item.pattern,
      requiredMeaning: item.requiredMeaning,
      supportIds: item.supportIds,
    })),
    forbiddenPredicates: [],
    supportedStoryFacts,
    forbiddenStoryClaims: (knowledgeBoundary?.forbidden || []).map((statement, index) => ({
      boundaryId: `KNOWLEDGE:${knowledgeBoundaryRef}:FORBID:${index + 1}`,
      statement,
    })),
    mechanismOnlyEvidence: storyEvidence.evidenceItems
      .filter((item) => item.useAs === "DRAMATIC_MECHANISM")
      .map((item) => ({
        evidenceId: item.evidenceId,
        statement: item.statement,
      })),
    specificityBoundary: storyEvidence.specificityBoundary,
    stopCondition: plan.nextStoryBeat.stopCondition,
    // The settled protagonist action is already rendered by an immutable
    // Protected Beat. Any new protagonist command in the continuation is an
    // additional action, regardless of its natural-language wording.
    originActionsInDraft: "FORBIDDEN" as const,
  };
}

function buildSangtianFallback(prepared: PreparedSangtianDecision) {
  const plan = prepared.settlement.event.narrativePlan;
  // A fallback is a safety path, not an alternate authored scene. Free-form
  // continuation prose can silently contain a stale handoff, disclosure, or
  // arrival that no longer matches the settled state. Render the fallback only
  // from the server-selected outcome, world pressure, and stop condition. This
  // keeps the rule world-agnostic and makes custody/knowledge changes possible
  // only when the settlement layer actually selected them.
  return renderDeterministicFallback({
    seed: plan.nextStoryBeat,
    protectedPlayerOutcomePresent: Boolean(
      String(
        prepared.selectedOption?.effect?.beatContract?.settledNarrative
          || plan.settledActionNarrative
          || "",
      ).trim(),
    ),
  });
}

function deduplicateCatalog<T extends { id: string }>(items: T[]) {
  return [...new Map(items.map((item) => [item.id, item])).values()];
}
