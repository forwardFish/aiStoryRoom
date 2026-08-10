from pathlib import Path

path = Path("apps/api/src/solo-story-engine/context-compiler.ts")
text = path.read_text(encoding="utf-8")
old = '''    ...allSections.partOneSettlement.items.map((item) => createItem(`part-one-event:${item.eventId}`, "P0", "PART_ONE_SETTLEMENT", item, true)),
'''
new = '''    ...allSections.partOneSettlement.items.map((item) => ({
      ...createItem(
        `part-one-event:${item.eventId}`,
        "P0",
        "PART_ONE_SETTLEMENT",
        item,
        true,
      ),
      // Keep the full authoritative event in Context sections for validators,
      // while budgeting only fields that can contribute to foreground prose.
      tokenEstimate: estimateJsonTokens(
        partOneSettlementBudgetProjection(item),
      ),
    })),
'''
if old not in text:
    raise SystemExit("settlement context item marker missing")
text = text.replace(old, new, 1)
marker = '''function partOnePromptProjection(item: import("@ai-story/templates").PartOneRuntimeWorkingSet) {
'''
projection = '''function partOneSettlementBudgetProjection(
  item: import("@ai-story/templates").PartOneCommittedEvent,
) {
  const scene = (value: typeof item.sceneBefore) => ({
    sceneId: value.sceneId,
    timeLabel: value.timeLabel,
    locationLabel: value.locationLabel,
    presentActorRefs: value.presentActorRefs,
    documentStates: value.documentStates,
    objectStates: value.objectStates,
  });
  const plan = item.narrativePlan;
  return {
    eventId: item.eventId,
    turnNumber: item.turnNumber,
    sectionIdBefore: item.sectionIdBefore,
    sectionIdAfter: item.sectionIdAfter,
    actionSource: item.actionSource,
    actionText: item.actionText,
    authoritativeObservableFacts: item.authoritativeObservableFacts,
    settledReactionContract: item.settledReactionContract || null,
    unboundActionNarrativeSource: item.unboundActionNarrativeSource || null,
    authoritativeNpcReactions: item.authoritativeNpcReactions.map(
      (reaction) => ({
        reactionEventId: reaction.reactionEventId,
        actorRefs: reaction.actorRefs,
        action: reaction.action,
        policyAssetId: reaction.policyAssetId,
      }),
    ),
    sceneBefore: scene(item.sceneBefore),
    sceneAfter: scene(item.sceneAfter),
    authoritativeWorldMoves: item.authoritativeWorldMoves.map((move) => ({
      beatId: move.beatId,
      sourceType: move.sourceType,
      sourceId: move.sourceId,
      actorRefs: move.actorRefs,
      action: move.action,
      resultCeiling: move.resultCeiling,
      consequenceId: move.consequenceId,
    })),
    sectionTransitioned: item.sectionTransitioned,
    narrativePlan: {
      sceneStart: scene(plan.sceneStart),
      sceneEnd: scene(plan.sceneEnd),
      sceneStartActorLabels: plan.sceneStartActorLabels,
      sceneEndActorLabels: plan.sceneEndActorLabels,
      transitionAllowed: plan.transitionAllowed,
      authorizedActorArrivals: plan.authorizedActorArrivals,
      authorizedActorDepartures: plan.authorizedActorDepartures,
      dramaticTask: plan.dramaticTask,
      actionAlreadyOccurred: plan.actionAlreadyOccurred,
      playerSpeechMode: plan.playerSpeechMode,
      authorizedPlayerSpeech: plan.authorizedPlayerSpeech,
      settledActionNarrative: plan.settledActionNarrative,
      confirmedEffects: plan.confirmedEffects,
      unresolvedFacts: plan.unresolvedFacts,
      sceneBlocking: plan.sceneBlocking,
      incidentalTextureAllowances: plan.incidentalTextureAllowances,
      sceneBeats: plan.sceneBeats,
      requiredEndChange: plan.requiredEndChange,
      narrativeCeiling: plan.narrativeCeiling,
      nextStoryBeat: {
        presentMoves: plan.nextStoryBeat.presentMoves,
        playerOutcome: plan.nextStoryBeat.playerOutcome,
        npcOrWorldPressure: plan.nextStoryBeat.npcOrWorldPressure,
        visibleConsequence: plan.nextStoryBeat.visibleConsequence,
        stopCondition: plan.nextStoryBeat.stopCondition,
        playerVisibleFallback: plan.nextStoryBeat.playerVisibleFallback,
      },
    },
  };
}

'''
if marker not in text:
    raise SystemExit("settlement budget projection insertion point missing")
text = text.replace(marker, projection + marker, 1)
path.write_text(text, encoding="utf-8")
print("current settlement context budget projection staged")
