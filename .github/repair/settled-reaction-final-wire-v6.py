from pathlib import Path


contract = Path("packages/templates/src/story-package/settled-reaction-contract.ts")
text = contract.read_text(encoding="utf-8")
if "  PartOneSettledReactionScenePolicy,\n" not in text:
    marker = "  PartOneSettledReactionContract,\n"
    if marker not in text:
        raise SystemExit("scene policy import marker missing")
    text = text.replace(
        marker,
        marker + "  PartOneSettledReactionScenePolicy,\n",
        1,
    )
contract.write_text(text, encoding="utf-8")

engine = Path("packages/templates/src/story-package/part-one-runtime-engine.ts")
text = engine.read_text(encoding="utf-8")
old = "  const unboundActionNarrativeSource = null;\n"
new = '''  const unboundActionNarrativeSource = current.decisionKernelId
    ? null
    : buildUnboundActionNarrativeSource({
      sourceEventId: current.eventId,
      sourceActionId: current.settledAction.decisionId || current.eventId,
      actionSource: current.settledAction.source,
      actionText: current.settledAction.actionText,
      playerActorId: `actor.${pkg.perspectiveRoleKey}`,
      targetEntityIds: [current.targetRef].filter(Boolean),
      validatedCapabilities: current.currentWorkingSet.institutionCapabilities,
      scene: sceneAfter,
      actorPolicies: current.currentWorkingSet.actorPolicies,
      narrativeMechanisms: current.currentWorkingSet.narrativeScenePatterns,
      requiredVisibleEffects: authoritativeObservableFacts,
      resultCeiling: current.currentWorkingSet.decisionPoint.resultCeiling,
    });
'''
if old not in text:
    raise SystemExit("unbound narrative source marker missing")
engine.write_text(text.replace(old, new, 1), encoding="utf-8")

print("legal unbound action narrative provenance restored")
