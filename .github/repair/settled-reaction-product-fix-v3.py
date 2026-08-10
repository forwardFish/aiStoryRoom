from pathlib import Path


def replace_once(path: str, old: str, new: str, label: str) -> None:
    target = Path(path)
    text = target.read_text(encoding="utf-8")
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected one match, found {count}")
    target.write_text(text.replace(old, new, 1), encoding="utf-8")


def replace_between(
    path: str,
    start_marker: str,
    end_marker: str,
    replacement: str,
    label: str,
) -> None:
    target = Path(path)
    text = target.read_text(encoding="utf-8")
    start = text.find(start_marker)
    end = text.find(end_marker, start + 1)
    if start < 0 or end < 0:
        raise SystemExit(f"{label}: function boundary missing")
    target.write_text(
        text[:start] + replacement.rstrip() + "\n\n" + text[end:],
        encoding="utf-8",
    )


def replace_in_function(
    path: str,
    function_name: str,
    next_function_name: str,
    old: str,
    new: str,
    label: str,
) -> None:
    target = Path(path)
    text = target.read_text(encoding="utf-8")
    start = text.find(f"function {function_name}(")
    end = text.find(f"function {next_function_name}(", start + 1)
    if start < 0 or end < 0:
        raise SystemExit(f"{label}: function boundary missing")
    segment = text[start:end]
    count = segment.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected one match, found {count}")
    target.write_text(
        text[:start] + segment.replace(old, new, 1) + text[end:],
        encoding="utf-8",
    )


# Old committed events remain readable and capability events can opt in.
types = Path("packages/templates/src/story-package/part-one-runtime-types.ts")
text = types.read_text(encoding="utf-8")
text = text.replace(
    "  settledReactionContract: PartOneSettledReactionContract | null;\n",
    "  settledReactionContract?: PartOneSettledReactionContract | null;\n",
    1,
)
text = text.replace(
    "  unboundActionNarrativeSource: PartOneUnboundActionNarrativeSource | null;\n",
    "  unboundActionNarrativeSource?: PartOneUnboundActionNarrativeSource | null;\n",
    1,
)
types.write_text(text, encoding="utf-8")


# Authoring templates reuse the action-owned WORLD_PRESSURE asset. Runtime
# still prefers the independent reaction WorkingSet when freezing visible text.
compiler = Path("scripts/story-decomposition/compile-sangtian-part-one-authoring.mjs")
text = compiler.read_text(encoding="utf-8")
text = text.replace(".IMMEDIATE_REACTION", ".WORLD_PRESSURE")
compiler.write_text(text, encoding="utf-8")


# A template constrains the reaction; it does not have to exist. The visible
# action is frozen from the current reaction WorkingSet before the next decision
# is selected. An authored visible action is a fallback only.
replace_between(
    "packages/templates/src/story-package/settled-reaction-contract.ts",
    "export function freezeSettledReactionContract(",
    "export function buildUnboundActionNarrativeSource(",
    '''export function freezeSettledReactionContract(
  input: FreezeSettledReactionInput,
): PartOneSettledReactionContract | null {
  const template = input.template
    ? validateSettledReactionTemplate(input.template, input.sourceActionId)
    : null;
  if (
    template?.activationCondition
    && !template.activationCondition.allOf.every((rule) => (
      evaluateRule(input.state, rule)
    ))
  ) {
    return null;
  }
  const scenePolicy = template?.scenePolicy || "CURRENT_SCENE";
  const permittedScene = scenePolicy === "CURRENT_SCENE"
    ? input.sceneBefore
    : input.sceneAfter;
  const permittedActors = new Set(permittedScene.presentActorRefs);
  const authoredResponders = template?.responderActorIds || [];
  const responders = unique(
    authoredResponders.length
      ? authoredResponders
      : input.resolvedResponderActorIds,
  );
  const unauthorized = responders.find((actorId) => !permittedActors.has(actorId));
  if (unauthorized) {
    fail(`RESPONDER_OUTSIDE_AUTHORIZED_SCENE:${unauthorized}`);
  }
  const visibleAction = String(
    input.fallbackVisibleAction
    || template?.reactionAction.visibleAction
    || "",
  ).trim();
  if (!visibleAction) return null;
  const forbiddenEscalations = template?.forbiddenEscalations || [
    "NEW_MAJOR_COMMAND",
    "NEW_EVIDENCE",
    "DEATH_OR_IDENTITY_CHANGE",
    "UNAUTHORIZED_SCENE_TRANSITION",
    "ANSWER_NEXT_DECISION",
  ];
  return {
    schemaVersion: "settled-reaction-contract-v1",
    sourceEventId: required(input.sourceEventId, "SOURCE_EVENT_ID_MISSING"),
    sourceEventKind: input.sourceEventKind,
    sourceActionId: required(input.sourceActionId, "SOURCE_ACTION_ID_MISSING"),
    responderActorIds: responders,
    ...(template?.activationCondition
      ? { activationCondition: structuredClone(template.activationCondition) }
      : {}),
    scenePolicy,
    reactionAction: template
      ? { ...structuredClone(template.reactionAction), visibleAction }
      : {
        actionKind: "RESPOND",
        targetEntityIds: [],
        parameterBindings: {},
        visibleAction,
      },
    resultCeiling: template?.resultCeiling
      || "只表达本轮已结算行动的直接回应；不得新增重大命令、证据、死亡、身份变化、未授权转场，也不得回答下一项决策。",
    requiredVisibleEffects: unique([
      ...(template?.requiredVisibleEffects || []),
      ...input.requiredVisibleEffects,
    ]),
    forbiddenEscalations: [...forbiddenEscalations],
  };
}''',
    "freeze settled reaction",
)


engine = "packages/templates/src/story-package/part-one-runtime-engine.ts"
# Arbitrary CUSTOM input stays fail closed. Legal capability input is handled
# by runtime-facade after capability validation.
text = Path(engine).read_text(encoding="utf-8")
start = text.find("  const unboundActionNarrativeSource = current.decisionKernelId")
end = text.find("  const settledReactionContract = freezeSettledReactionContract", start)
if start < 0 or end < 0:
    raise SystemExit("base-engine unbound source block missing")
text = text[:start] + "  const unboundActionNarrativeSource = null;\n" + text[end:]
text = text.replace("  if (!contract) return [];", "  if (!contract) return policyResolved;", 1)
text = text.replace(
    'throw new Error("PART_ONE_NEXT_STORY_BEAT_SOURCE_MISSING");',
    'throw new Error("PART_ONE_NEXT_STORY_BEAT_KERNEL_MISSING");',
    1,
)
Path(engine).write_text(text, encoding="utf-8")

# Wire both new values through buildNarrativePlan and buildNextStoryBeat.
replace_in_function(
    engine,
    "buildNarrativePlan",
    "buildNextStoryBeat",
    '''  authoritativeObservableFacts: string[];
  authoritativeNpcReactions: PartOneCommittedEvent["authoritativeNpcReactions"];''',
    '''  authoritativeObservableFacts: string[];
  settledReactionContract: PartOneSettledReactionContract | null;
  unboundActionNarrativeSource: PartOneUnboundActionNarrativeSource | null;
  authoritativeNpcReactions: PartOneCommittedEvent["authoritativeNpcReactions"];''',
    "buildNarrativePlan input",
)
replace_in_function(
    engine,
    "buildNarrativePlan",
    "buildNextStoryBeat",
    '''    authoritativeObservableFacts: input.authoritativeObservableFacts,
    authoritativeNpcReactions: input.authoritativeNpcReactions,''',
    '''    authoritativeObservableFacts: input.authoritativeObservableFacts,
    settledReactionContract: input.settledReactionContract,
    unboundActionNarrativeSource: input.unboundActionNarrativeSource,
    authoritativeNpcReactions: input.authoritativeNpcReactions,''',
    "buildNextStoryBeat invocation",
)
replace_in_function(
    engine,
    "buildNextStoryBeat",
    "renderPlayerVisibleSceneContext",
    '''  authoritativeObservableFacts: string[];
  authoritativeNpcReactions: PartOneCommittedEvent["authoritativeNpcReactions"];
  authoritativeWorldMoves: PartOneAuthoritativeWorldMove[];''',
    '''  authoritativeObservableFacts: string[];
  settledReactionContract: PartOneSettledReactionContract | null;
  unboundActionNarrativeSource: PartOneUnboundActionNarrativeSource | null;
  authoritativeNpcReactions: PartOneCommittedEvent["authoritativeNpcReactions"];
  authoritativeWorldMoves: PartOneAuthoritativeWorldMove[];''',
    "buildNextStoryBeat input",
)


# Legal capability input gets an auditable, world-neutral narrative source.
facade = Path("packages/templates/src/runtime-facade.ts")
text = facade.read_text(encoding="utf-8")
if 'from "./story-package/settled-reaction-contract.js"' not in text:
    text = text.replace(
        'import { compileDramaticBeatPlan } from "./story-package/dramatic-beat-plan.js";\n',
        'import { compileDramaticBeatPlan } from "./story-package/dramatic-beat-plan.js";\nimport { buildUnboundActionNarrativeSource } from "./story-package/settled-reaction-contract.js";\n',
        1,
    )
needle = '''      authoritativeObservableFacts: [capabilityFact],
      authoritativeNpcReactions: [],'''
replacement = '''      authoritativeObservableFacts: [capabilityFact],
      settledReactionContract: null,
      unboundActionNarrativeSource: buildUnboundActionNarrativeSource({
        sourceEventId: eventId,
        sourceActionId: actionBeatId,
        actionSource: "FREE_TEXT_CAPABILITY",
        actionText: input.actionText,
        playerActorId: `actor.${input.pkg.perspectiveRoleKey}`,
        targetEntityIds: [input.incoming.targetRef || "public_frame"],
        validatedCapabilities: input.workingSet.institutionCapabilities,
        scene,
        actorPolicies: input.workingSet.actorPolicies,
        narrativeMechanisms: input.workingSet.narrativeScenePatterns,
        requiredVisibleEffects: [capabilityFact],
        resultCeiling: "只叙述已经通过能力校验的准备、观察、询问或查证过程；不得新增正式命令、证据、文书、承诺、秘密揭示或完成当前决策。",
      }),
      authoritativeNpcReactions: [],'''
if needle not in text:
    raise SystemExit("capability event insertion point missing")
facade.write_text(text.replace(needle, replacement, 1), encoding="utf-8")


# Production test uses the authenticated capability envelope rather than an
# arbitrary CUSTOM action.
test_path = Path(
    "apps/openovel-runtime/tests/settled-reaction-contract-production.spec.ts"
)
text = test_path.read_text(encoding="utf-8")
start = text.find('test("legal unbound actions carry structured narrative provenance"')
if start < 0:
    raise SystemExit("production unbound test missing")
replacement = r'''test("legal capability actions carry structured unbound narrative provenance", () => {
  const pkg = templatesPackage.loadPartOneRuntimePackage(
    "sangtian",
    configRoot,
  ).package;
  const state = templatesPackage.createInitialPartOneState(pkg);
  const current = templatesPackage.buildPartOneRuntimeWorkingSet(pkg, state, 0);
  const envelope = Buffer.from(JSON.stringify({
    schemaVersion: "omw-capability-action-v1",
    decisionPointId: current.decisionPoint.decisionPointId,
    action: "只查看已经公开的文书状态，不下达新的命令。",
  }), "utf8").toString("base64url");
  const settlement = templatesPackage.settlePartOneAction(
    pkg,
    state,
    {
      source: "FREE_TEXT",
      actionText: `\u2063OMW_CAPABILITY_V1:${envelope}\u2063`,
      targetRef: "public_frame",
    },
    1,
  );
  const source = settlement.event.unboundActionNarrativeSource;
  assert.ok(source);
  assert.equal(source.sourceEventId, settlement.event.eventId);
  assert.equal(source.sourceEventKind, "UNBOUND_ACTION_SETTLEMENT");
  assert.ok(source.currentSceneId);
  assert.ok(source.activeActorIds.length > 0);
  assert.equal(source.forbiddenEscalations.includes("NEW_EVIDENCE"), true);
});
'''
test_path.write_text(text[:start] + replacement, encoding="utf-8")

print("settled reaction product wiring hardened")
