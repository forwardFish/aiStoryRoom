import type {
  CompiledStoryContext,
  StoryActionTarget,
  StoryDecision,
  StoryTurnModelOutput,
  StoryTurnPublishedOutput
} from "./types";

/**
 * Deterministic metadata binder.
 *
 * Player-facing story prose is immutable here. This function may attach only
 * server-owned identifiers, target references, grounding and ending metadata.
 * It must never add, remove, reorder or rewrite a character in story.title,
 * story.resultNarrative or story.nextSituationNarrative.
 */
export function bindStoryTurnReferences(
  output: StoryTurnModelOutput,
  context: CompiledStoryContext
): StoryTurnModelOutput {
  if (output.resultType !== "PUBLISHED_TURN") return output;
  const story = output.story;
  const event = context.sections.partOneSettlement.items[0] || null;
  const runtime = context.sections.partOneRuntime.items[0] || null;
  const scene = context.sections.currentScene.items[0] || null;
  const visibleChanges = event
    ? [
        ...event.authoritativeObservableFacts,
        ...event.authoritativeNpcReactions.map((reaction) => reaction.action)
      ]
    : context.actionResolution.immediateObservableResult;
  const paidConsequenceIds = context.sections.pendingConsequences.items
    .filter((consequence) => consequence.priority === "P0")
    .map((consequence) => consequence.consequenceId);
  const decisions = Array.isArray(output.decisions)
    ? output.decisions.map((decision, index) => bindDecision(decision, index, context))
    : [];

  const bound: StoryTurnPublishedOutput = {
    ...output,
    // Intentional exact reference: no spread/canonicalisation/composition.
    story,
    resolution: {
      confirmedResolutionId: context.actionResolution.resolutionId,
      outcome: context.actionResolution.accepted ? "APPLIED" : "BLOCKED",
      observableOutcome: visibleChanges.join("；") || context.actionResolution.summary
    },
    endingState: {
      timeLabel: scene?.timeLabel || output.endingState?.timeLabel || "",
      locationLabel: scene?.locationLabel || output.endingState?.locationLabel || "",
      tension: runtime?.nextDecisionPressure?.summary
        || scene?.situation
        || output.endingState?.tension
        || "",
      presentEntityRefs: allowedValues(
        output.endingState?.presentEntityRefs,
        context.allowedReferences.entityRefs
      ),
      visibleChanges,
      surfacedConsequenceIds: paidConsequenceIds
    },
    decisions,
    grounding: deterministicGrounding(context, paidConsequenceIds)
  };
  return bound;
}

function bindDecision(
  decision: StoryDecision,
  index: number,
  context: CompiledStoryContext
): StoryDecision {
  const runtime = context.sections.partOneRuntime.items[0] || null;
  const basis = runtime?.decisionAffordances.find((route) =>
    route.affordanceTemplateId === decision.affordanceTemplateId
    || route.title === decision.label
  ) || null;
  const target = basis
    ? canonicalTarget(basis.target, context.availableTargets)
    : canonicalTarget(decision.targetRef, context.availableTargets);
  const groundingIds = decisionGrounding(context, target);

  return {
    ...decision,
    decisionId: `d${index + 1}`,
    label: basis?.title || decision.label,
    // description is the player-visible Decision model text and is immutable.
    description: decision.description,
    intent: basis?.immediateIntent || decision.intent,
    targetRef: target,
    method: basis?.method || decision.method,
    leverageKeys: allowedValues(decision.leverageKeys, context.allowedReferences.assetKeys),
    distinctAxis: basis?.method || decision.distinctAxis,
    concreteCost: basis?.visibleTradeoff || decision.concreteCost,
    expectedCountermove: decision.expectedCountermove,
    groundingIds,
    decisionKernelId: basis?.decisionKernelId || decision.decisionKernelId,
    affordanceTemplateId: basis?.affordanceTemplateId || decision.affordanceTemplateId
  };
}

function deterministicGrounding(
  context: CompiledStoryContext,
  paidConsequenceIds: string[]
): StoryTurnPublishedOutput["grounding"] {
  return {
    usedScriptSourceIds: [...context.allowedReferences.scriptSourceIds],
    usedStoryCardIds: [...context.allowedReferences.storyCardIds],
    usedCanonFactIds: [...context.allowedReferences.canonFactIds],
    advancedMainlineQuestionIds: [...context.allowedReferences.mainlineQuestionIds],
    paidPendingConsequenceIds: paidConsequenceIds,
    stagedDirectedBeatId: context.allowedReferences.directedBeatIds[0] || null,
    deferredConsequences: []
  };
}

function decisionGrounding(
  context: CompiledStoryContext,
  target: StoryActionTarget
) {
  const values = [
    target.id,
    context.sections.currentScene.items[0]?.sceneId
      ? `scene:${context.sections.currentScene.items[0].sceneId}`
      : null,
    context.sections.partOneRuntime.items[0]
      ? `part-one-runtime:${context.sections.partOneRuntime.items[0].retrievalTrace.decisionKernelId}`
      : null
  ].filter((value): value is string => Boolean(value));
  const allowed = new Set(context.allowedReferences.groundingIds);
  return [...new Set(values.filter((value) => allowed.has(value)))];
}

function canonicalTarget(
  target: StoryActionTarget | undefined,
  available: StoryActionTarget[]
): StoryActionTarget {
  const exact = target
    ? available.find((candidate) =>
        candidate.id === target.id
        && candidate.type === target.type
        && candidate.label === target.label
      )
    : null;
  return exact
    || available.find((candidate) => candidate.type === "PUBLIC_FRAME")
    || available[0]
    || { type: "PUBLIC_FRAME", id: "public_frame", label: "当前局势" };
}

function allowedValues(value: unknown, allowed: string[]) {
  if (!Array.isArray(value)) return [];
  const allowedSet = new Set(allowed);
  return [...new Set(
    value.filter((item): item is string =>
      typeof item === "string" && allowedSet.has(item)
    )
  )];
}
