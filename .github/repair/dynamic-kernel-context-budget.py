from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected exactly one match, found {count}")
    return text.replace(old, new, 1)


path = Path("apps/api/src/solo-story-engine/context-compiler.ts")
text = path.read_text(encoding="utf-8")
text = replace_once(
    text,
    '''    ...allSections.partOneSettlement.items.map((item) => createItem(`part-one-event:${item.eventId}`, "P0", "PART_ONE_SETTLEMENT", item, true)),
''',
    '''    ...allSections.partOneSettlement.items.map((item) => ({
      ...createItem(
        `part-one-event:${item.eventId}`,
        "P0",
        "PART_ONE_SETTLEMENT",
        item,
        true,
      ),
      // Context retains the authoritative event projection for validators and
      // reference binding. Budgeting follows only fields that can enter the
      // foreground prompt, exactly as PART_ONE_RUNTIME already does above.
      tokenEstimate: estimateJsonTokens(
        partOneSettlementBudgetProjection(item),
      ),
    })),
''',
    "settlement item prompt budget",
)
marker = '''function partOneSettlementPromptProjection(
'''
budget = '''function partOneSettlementBudgetProjection(
  item: PartOneSettlementPromptProjection,
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
    actionText: item.actionText,
    authoritativeObservableFacts: item.authoritativeObservableFacts,
    authoritativeNpcReactions: item.authoritativeNpcReactions.map(
      (reaction) => ({
        actorRefs: reaction.actorRefs,
        action: reaction.action,
      }),
    ),
    sceneBefore: scene(item.sceneBefore),
    sceneAfter: scene(item.sceneAfter),
    authoritativeWorldMoves: item.authoritativeWorldMoves.map((move) => ({
      sourceType: move.sourceType,
      actorRefs: move.actorRefs,
      action: move.action,
      resultCeiling: move.resultCeiling,
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
text = text.replace(marker, budget + marker, 1)
path.write_text(text, encoding="utf-8")
