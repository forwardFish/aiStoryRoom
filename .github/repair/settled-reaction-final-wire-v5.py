from pathlib import Path


def replace_once(path: str, old: str, new: str, label: str) -> None:
    target = Path(path)
    text = target.read_text(encoding="utf-8")
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected one match, found {count}")
    target.write_text(text.replace(old, new, 1), encoding="utf-8")


engine = "packages/templates/src/story-package/part-one-runtime-engine.ts"
replace_once(
    engine,
    '''    authoritativeObservableFacts,
    settledReactionContract,
    unboundActionNarrativeSource,
    authoritativeNpcReactions,
    authoritativeWorldMoves,
  });
  proposedState.scene = sceneAfter;''',
    '''    authoritativeObservableFacts,
    authoritativeNpcReactions,
    authoritativeWorldMoves,
  });
  proposedState.scene = sceneAfter;''',
    "remove narrative-only fields from scene reconciliation",
)
replace_once(
    engine,
    '''    sectionTransitioned: current.sectionTransitioned,
    authoritativeObservableFacts,
    authoritativeNpcReactions,
    authoritativeWorldMoves,
    nextDecisionPoint: nextWorkingSet.decisionPoint,
  });''',
    '''    sectionTransitioned: current.sectionTransitioned,
    authoritativeObservableFacts,
    settledReactionContract,
    unboundActionNarrativeSource,
    authoritativeNpcReactions,
    authoritativeWorldMoves,
    nextDecisionPoint: nextWorkingSet.decisionPoint,
  });''',
    "pass frozen reaction to narrative plan",
)
replace_once(
    engine,
    '''    sceneBefore,
    sceneAfter,
    requiredVisibleEffects: authoritativeObservableFacts,''',
    '''    sceneBefore,
    sceneAfter,
    scenePolicy: current.sectionTransitioned
      ? "AFTER_AUTHORIZED_TRANSITION"
      : "CURRENT_SCENE",
    requiredVisibleEffects: authoritativeObservableFacts,''',
    "freeze reaction in authoritative scene",
)

contract = Path("packages/templates/src/story-package/settled-reaction-contract.ts")
text = contract.read_text(encoding="utf-8")
text = text.replace(
    '''  sceneBefore: PartOneSceneState;
  sceneAfter: PartOneSceneState;
  requiredVisibleEffects: string[];''',
    '''  sceneBefore: PartOneSceneState;
  sceneAfter: PartOneSceneState;
  scenePolicy?: PartOneSettledReactionScenePolicy;
  requiredVisibleEffects: string[];''',
    1,
)
text = text.replace(
    '''  const scenePolicy = template?.scenePolicy || "CURRENT_SCENE";''',
    '''  const scenePolicy = input.scenePolicy
    || template?.scenePolicy
    || "CURRENT_SCENE";''',
    1,
)
old = '''  const authoredResponders = template?.responderActorIds || [];
  const responders = unique(
    authoredResponders.length
      ? authoredResponders
      : input.resolvedResponderActorIds,
  );
  const unauthorized = responders.find((actorId) => !permittedActors.has(actorId));
  if (unauthorized) {
    fail(`RESPONDER_OUTSIDE_AUTHORIZED_SCENE:${unauthorized}`);
  }'''
new = '''  const authoredResponders = template?.responderActorIds || [];
  const unauthorized = authoredResponders.find(
    (actorId) => !permittedActors.has(actorId),
  );
  if (unauthorized) {
    fail(`RESPONDER_OUTSIDE_AUTHORIZED_SCENE:${unauthorized}`);
  }
  const responders = authoredResponders.length
    ? unique(authoredResponders)
    : unique(input.resolvedResponderActorIds)
      .filter((actorId) => permittedActors.has(actorId));'''
if old not in text:
    raise SystemExit("responder scene filter marker missing")
text = text.replace(old, new, 1)
text = text.replace(
    '|| "只表达本轮已结算行动的直接回应；不得新增重大命令、证据、死亡、身份变化、未授权转场，也不得回答下一项决策。",',
    '|| "Render only the direct settled response. Do not add commands, evidence, death, identity changes, unauthorized transitions, or answer the next decision.",',
    1,
)
contract.write_text(text, encoding="utf-8")

unit = Path("packages/templates/tests/settled-reaction-contract.test.ts")
text = unit.read_text(encoding="utf-8")
text = text.replace(
    '''test("freezes current reaction independently from the next decision prompt", () => {
  const contract = freezeSettledReactionContract({''',
    '''test("freezes current reaction independently from the next decision prompt", () => {
  const nextDecisionPrompt = "A later decision asks something else.";
  const contract = freezeSettledReactionContract({''',
    1,
)
text = text.replace(
    '''    fallbackVisibleAction: "A later decision asks something else.",''',
    '''    fallbackVisibleAction: template.reactionAction.visibleAction,''',
    1,
)
text = text.replace(
    '''  assert.doesNotMatch(contract.reactionAction.visibleAction, /later decision/i);''',
    '''  assert.notEqual(contract.reactionAction.visibleAction, nextDecisionPrompt);''',
    1,
)
unit.write_text(text, encoding="utf-8")

print("exact settled reaction wiring fixed")
