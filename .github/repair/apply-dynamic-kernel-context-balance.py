from pathlib import Path


def replace_between(
    text: str,
    start_marker: str,
    end_marker: str,
    replacement: str,
) -> str:
    start = text.find(start_marker)
    if start < 0:
        raise SystemExit(f"start marker missing: {start_marker}")
    end = text.find(end_marker, start)
    if end < 0:
        raise SystemExit(f"end marker missing: {end_marker}")
    return text[:start] + replacement.rstrip() + "\n\n" + text[end:]


compiler = Path("apps/api/src/solo-story-engine/context-compiler.ts")
text = compiler.read_text(encoding="utf-8")
projection = '''function partOneSettlementPromptProjection(
  item: import("@ai-story/templates").PartOneCommittedEvent,
) {
  const plan = item.narrativePlan;
  const nextBeat = plan.nextStoryBeat;
  const scene = (value: typeof item.sceneBefore) => ({
    sceneId: value.sceneId,
    timeLabel: value.timeLabel,
    locationLabel: value.locationLabel,
    presentActorRefs: value.presentActorRefs,
    documentStates: value.documentStates,
    objectStates: value.objectStates,
  });
  return {
    eventId: item.eventId,
    turnNumber: item.turnNumber,
    sectionIdBefore: item.sectionIdBefore,
    sectionIdAfter: item.sectionIdAfter,
    actionSource: item.actionSource,
    actionText: item.actionText,
    authoritativeObservableFacts: item.authoritativeObservableFacts,
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
    authoritativeWorldMoves: item.authoritativeWorldMoves.map(
      (move) => ({
        beatId: move.beatId,
        sourceType: move.sourceType,
        sourceId: move.sourceId,
        actorRefs: move.actorRefs,
        action: move.action,
        requiredTermGroups: move.requiredTermGroups,
        resultCeiling: move.resultCeiling,
        consequenceId: move.consequenceId,
      }),
    ),
    sectionTransitioned: item.sectionTransitioned,
    narrativePlan: {
      sceneStart: scene(plan.sceneStart),
      sceneEnd: scene(plan.sceneEnd),
      presentActorLabels: plan.presentActorLabels,
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
        presentMoves: nextBeat.presentMoves,
        playerOutcome: nextBeat.playerOutcome,
        npcOrWorldPressure: nextBeat.npcOrWorldPressure,
        visibleConsequence: nextBeat.visibleConsequence,
        stopCondition: nextBeat.stopCondition,
        playerVisibleFallback: nextBeat.playerVisibleFallback,
      },
    },
  };
}'''
text = replace_between(
    text,
    "function partOneSettlementPromptProjection(",
    "function partOnePromptProjection(",
    projection,
)
compiler.write_text(text, encoding="utf-8")
