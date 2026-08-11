from __future__ import annotations

import re
from pathlib import Path

ROOT = Path.cwd()


def read(rel: str) -> str:
    return (ROOT / rel).read_text(encoding="utf-8")


def write(rel: str, text: str) -> None:
    (ROOT / rel).write_text(text.rstrip() + "\n", encoding="utf-8")


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected one match, found {count}")
    return text.replace(old, new, 1)


def insert_before(text: str, marker: str, value: str, label: str) -> str:
    if value.strip() in text:
        return text
    index = text.find(marker)
    if index < 0:
        raise SystemExit(f"{label}: marker missing")
    return text[:index] + value.rstrip() + "\n\n" + text[index:]


def insert_after(text: str, marker: str, value: str, label: str) -> str:
    if value.strip() in text:
        return text
    index = text.find(marker)
    if index < 0:
        raise SystemExit(f"{label}: marker missing")
    index += len(marker)
    return text[:index] + "\n" + value.rstrip() + text[index:]


def bounds(text: str, fn: str, next_fn: str) -> tuple[int, int]:
    start = text.find(f"function {fn}(")
    end = text.find(f"function {next_fn}(", start + 1)
    if start < 0 or end < 0:
        raise SystemExit(f"function boundary missing: {fn}->{next_fn}")
    return start, end


def replace_in_function(
    text: str,
    fn: str,
    next_fn: str,
    old: str,
    new: str,
    label: str,
) -> str:
    start, end = bounds(text, fn, next_fn)
    segment = text[start:end]
    count = segment.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected one match, found {count}")
    return text[:start] + segment.replace(old, new, 1) + text[end:]


# ---------------------------------------------------------------------------
# Authoring compiler stores a template; Settlement creates the full contract.
# ---------------------------------------------------------------------------
compiler_path = "scripts/story-decomposition/compile-sangtian-part-one-authoring.mjs"
text = read(compiler_path)
pattern = r'''settledReaction:\s*\{\s*schemaVersion:\s*"settled-reaction-v1",\s*sourceAffordanceTemplateId:\s*`\$\{kernelId\}-OPT-0\$\{index \+ 1\}`,\s*action:\s*String\(\s*kernelPlayerVisibleFallbacks\[kernelId\]\[index\]\.IMMEDIATE_REACTION\s*\|\|\s*kernelPlayerVisibleFallbacks\[kernelId\]\[index\]\.WORLD_PRESSURE\s*\|\|\s*""\s*\)\.trim\(\),\s*\}'''
replacement = '''settledReaction: {
              schemaVersion: "settled-reaction-template-v1",
              sourceEventKind: "AFFORDANCE_SETTLEMENT",
              sourceActionId: `${kernelId}-OPT-0${index + 1}`,
              sourceAffordanceTemplateId: `${kernelId}-OPT-0${index + 1}`,
              responderActorIds: [],
              scenePolicy: "CURRENT_SCENE",
              reactionAction: {
                actionKind: "NPC_RESPONSE",
                targetEntityIds: [targetRef],
                parameterBindings: {},
                visibleAction: String(
                  kernelPlayerVisibleFallbacks[kernelId][index].IMMEDIATE_REACTION
                  || kernelPlayerVisibleFallbacks[kernelId][index].WORLD_PRESSURE
                  || ""
                ).trim(),
              },
              resultCeiling: "Render only the direct settled response. Do not create evidence, commands, death, identity changes, unauthorized transitions, or answer the next decision.",
              requiredVisibleEffects: [
                String(
                  kernelPlayerVisibleFallbacks[kernelId][index].IMMEDIATE_REACTION
                  || kernelPlayerVisibleFallbacks[kernelId][index].WORLD_PRESSURE
                  || ""
                ).trim(),
              ].filter(Boolean),
              forbiddenEscalations: [
                "NEW_MAJOR_COMMAND",
                "NEW_EVIDENCE",
                "DEATH_OR_IDENTITY_CHANGE",
                "UNAUTHORIZED_SCENE_TRANSITION",
                "ANSWER_NEXT_DECISION",
              ],
            }'''
text, count = re.subn(pattern, replacement, text, count=1, flags=re.S)
if count != 1:
    raise SystemExit(f"compiler simple reaction template: {count}")
validator_pattern = r'''if\s*\(\s*!option\.settledReaction\s*\|\|\s*option\.settledReaction\.schemaVersion\s*!==\s*"settled-reaction-v1"\s*\|\|\s*option\.settledReaction\.sourceAffordanceTemplateId\s*!==\s*option\.affordanceTemplateId\s*\|\|\s*!String\(option\.settledReaction\.action\s*\|\|\s*""\)\.trim\(\)\s*\)'''
validator_replacement = '''if (
      !option.settledReaction
      || option.settledReaction.schemaVersion !== "settled-reaction-template-v1"
      || option.settledReaction.sourceEventKind !== "AFFORDANCE_SETTLEMENT"
      || option.settledReaction.sourceActionId !== option.affordanceTemplateId
      || option.settledReaction.sourceAffordanceTemplateId !== option.affordanceTemplateId
      || !String(option.settledReaction.reactionAction?.visibleAction || "").trim()
      || !String(option.settledReaction.resultCeiling || "").trim()
      || !Array.isArray(option.settledReaction.requiredVisibleEffects)
      || !Array.isArray(option.settledReaction.forbiddenEscalations)
    )'''
text, count = re.subn(
    validator_pattern,
    validator_replacement,
    text,
    count=1,
    flags=re.S,
)
if count != 1:
    raise SystemExit(f"compiler simple reaction validator: {count}")
write(compiler_path, text)


# ---------------------------------------------------------------------------
# Settlement freezes current reaction before nextWorkingSet is consumed.
# ---------------------------------------------------------------------------
engine_path = "packages/templates/src/story-package/part-one-runtime-engine.ts"
text = read(engine_path)
if 'from "./settled-reaction-contract";' not in text:
    text = insert_after(
        text,
        'import { compileDramaticBeatPlan } from "./dramatic-beat-plan";',
        '''import {
  buildPartOneUnboundActionNarrativeSource,
  freezePartOneSettledReactionContract,
  projectPartOneSettledReaction,
} from "./settled-reaction-contract";''',
        "engine settled reaction import",
    )

# Normalize the type import in a formatting-independent way.
match = re.search(
    r'import type \{(?P<body>.*?)\} from "\.\/part-one-runtime-types";',
    text,
    flags=re.S,
)
if not match:
    raise SystemExit("engine type import block missing")
body = match.group("body")
for name in [
    "PartOneSettledReactionContract",
    "PartOneUnboundActionNarrativeSource",
    "PartOneUnboundNarrativeContext",
]:
    if name not in body:
        body = body.rstrip().rstrip(",") + f",\n  {name}\n"
text = text[:match.start("body")] + body + text[match.end("body"):]

text = replace_once(
    text,
    "  targetRef?: string | null;\n};",
    '''  targetRef?: string | null;
  /** Required for a legal action without a bound Affordance/Kernel. */
  unboundNarrativeContext?: PartOneUnboundNarrativeContext | null;
};''',
    "incoming unbound context",
)

binder_pattern = r'''  const authoritativeNpcReactions = bindSettledReactionContract\(\s*pkg,\s*current,\s*buildAuthoritativeNpcReactions\(\{\s*eventId: current\.eventId,\s*sceneAfter,\s*reactionWorkingSet,\s*\}\),\s*\);'''
binder_replacement = '''  const policyResolvedReactions = buildAuthoritativeNpcReactions({
    eventId: current.eventId,
    sceneAfter,
    reactionWorkingSet,
  });
  const settledReactionContract = freezePartOneSettledReactionContract({
    template: current.appliedAffordance?.settledReaction || null,
    sourceEventId: current.eventId,
    sourceEventKind: current.appliedAffordance
      ? "AFFORDANCE_SETTLEMENT"
      : "UNBOUND_ACTION_SETTLEMENT",
    sourceActionId: current.affordanceTemplateId
      || current.settledAction.decisionId
      || current.eventId,
    sourceAffordanceTemplateId: current.affordanceTemplateId,
    resolvedResponderActorIds: policyResolvedReactions.flatMap(
      (reaction) => reaction.actorRefs,
    ),
    state: proposedState,
    sceneBefore,
    sceneAfter,
    sectionTransitioned: current.sectionTransitioned,
    fallbackVisibleAction: policyResolvedReactions[0]?.action
      || current.appliedAffordance?.playerVisibleFallback?.IMMEDIATE_REACTION
      || current.appliedAffordance?.playerVisibleFallback?.WORLD_PRESSURE
      || "",
    requiredVisibleEffects: authoritativeObservableFacts,
  });
  const authoritativeNpcReactions = projectPartOneSettledReaction(
    settledReactionContract,
    policyResolvedReactions,
  );'''
text, count = re.subn(
    binder_pattern,
    binder_replacement,
    text,
    count=1,
    flags=re.S,
)
if count != 1:
    raise SystemExit(f"simple binder call missing: {count}")

# Rename the existing world-move output, then append a frozen world reaction.
world_pattern = r'''  const authoritativeWorldMoves = buildAuthoritativeWorldMoves\(\{(?P<body>.*?)  \}\);'''
match = re.search(world_pattern, text, flags=re.S)
if not match:
    raise SystemExit("world move construction missing")
world_replacement = '''  const plannedWorldMoves = buildAuthoritativeWorldMoves({'''
world_replacement += match.group("body")
world_replacement += '''  });
  const authoritativeWorldMoves = [
    ...plannedWorldMoves,
    ...(settledReactionContract?.reactionAction.actionKind === "WORLD_RESPONSE"
      ? [{
        beatId: `SETTLED-REACTION-${settledReactionContract.sourceEventId}`,
        sourceType: "SETTLED_RESPONSE" as const,
        sourceId: settledReactionContract.sourceActionId,
        actorRefs: [...settledReactionContract.responderActorIds],
        action: settledReactionContract.reactionAction.visibleAction,
        requiredTermGroups: [],
        resultCeiling: settledReactionContract.resultCeiling,
      }]
      : []),
  ];'''
text = text[:match.start()] + world_replacement + text[match.end():]

unbound_block = '''  const unboundActionNarrativeSource = current.appliedAffordance
    ? null
    : current.settledAction.unboundNarrativeContext
      ? buildPartOneUnboundActionNarrativeSource({
        sourceEventId: current.eventId,
        sourceActionId: current.settledAction.decisionId || current.eventId,
        actionText: current.settledAction.actionText,
        parsingResult:
          current.settledAction.unboundNarrativeContext.parsingResult,
        capabilityValidation:
          current.settledAction.unboundNarrativeContext.capabilityValidation,
        settlementResult: {
          schemaVersion: "unbound-settlement-result-v1",
          settlementEventId: current.eventId,
          status: "SETTLED",
          changedStatePaths: unique(current.changedStatePaths),
          durableEffectTypes: unique(
            current.durableEffects.map((effect) => effect.type),
          ),
          requiredVisibleEffects: [...authoritativeObservableFacts],
        },
        currentScene: sceneAfter,
        actorPolicies: reactionWorkingSet.actorPolicies,
        materialEffectPolicy:
          current.settledAction.unboundNarrativeContext.materialEffectPolicy,
        settledReactionContract,
        policyResolvedReactions,
        resultCeiling:
          current.settledAction.unboundNarrativeContext.resultCeiling,
        forbiddenEscalations:
          current.settledAction.unboundNarrativeContext.forbiddenEscalations,
      })
      : null;'''
text = insert_before(
    text,
    "  const payableDueIds = new Set(",
    unbound_block,
    "unbound source construction",
)

# Delete the old string-only binder.
helper_start = text.find(
    "/**\n * Bind an author-reviewed reaction to the current committed Affordance."
)
if helper_start < 0:
    helper_start = text.find("/**\n * Bind an author-reviewed reaction")
helper_end = text.find("function buildAuthoritativeNpcReactions(", helper_start)
if helper_start < 0 or helper_end < 0:
    raise SystemExit("old reaction binder helper missing")
text = text[:helper_start] + text[helper_end:]

text = replace_once(
    text,
    '''    sectionTransitioned: current.sectionTransitioned,
    authoritativeObservableFacts,
    authoritativeNpcReactions,
    authoritativeWorldMoves,''',
    '''    sectionTransitioned: current.sectionTransitioned,
    authoritativeObservableFacts,
    settledReactionContract,
    unboundActionNarrativeSource,
    authoritativeNpcReactions,
    authoritativeWorldMoves,''',
    "narrative plan call",
)
text = replace_once(
    text,
    '''    authoritativeObservableFacts,
    authoritativeNpcReactions,
    sceneBefore,''',
    '''    authoritativeObservableFacts,
    settledReactionContract,
    unboundActionNarrativeSource,
    authoritativeNpcReactions,
    sceneBefore,''',
    "event persistence",
)

text = replace_in_function(
    text,
    "buildNarrativePlan",
    "buildNextStoryBeat",
    '''  authoritativeObservableFacts: string[];
  authoritativeNpcReactions: PartOneCommittedEvent["authoritativeNpcReactions"];''',
    '''  authoritativeObservableFacts: string[];
  settledReactionContract: PartOneSettledReactionContract | null;
  unboundActionNarrativeSource: PartOneUnboundActionNarrativeSource | null;
  authoritativeNpcReactions: PartOneCommittedEvent["authoritativeNpcReactions"];''',
    "narrative plan input",
)
text = replace_in_function(
    text,
    "buildNarrativePlan",
    "buildNextStoryBeat",
    '''    authoritativeObservableFacts: input.authoritativeObservableFacts,
    authoritativeNpcReactions: input.authoritativeNpcReactions,''',
    '''    authoritativeObservableFacts: input.authoritativeObservableFacts,
    settledReactionContract: input.settledReactionContract,
    unboundActionNarrativeSource: input.unboundActionNarrativeSource,
    authoritativeNpcReactions: input.authoritativeNpcReactions,''',
    "next beat call",
)
text = replace_in_function(
    text,
    "buildNarrativePlan",
    "buildNextStoryBeat",
    '''    settledActionNarrative,
    nextStoryBeat,''',
    '''    settledActionNarrative,
    settledReactionContract: input.settledReactionContract,
    unboundActionNarrativeSource: input.unboundActionNarrativeSource,
    nextStoryBeat,''',
    "narrative plan persisted sources",
)
text = replace_in_function(
    text,
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
    "next beat input",
)
text = replace_in_function(
    text,
    "buildNextStoryBeat",
    "renderPlayerVisibleSceneContext",
    '''  if (!input.decisionKernelId) {
    throw new Error("PART_ONE_NEXT_STORY_BEAT_KERNEL_MISSING");
  }
  const kernel = requireAsset(input.pkg, input.decisionKernelId);''',
    '''  const narrativeKernelId = input.decisionKernelId
    || input.nextDecisionPoint.decisionKernelId;
  if (!narrativeKernelId) {
    throw new Error("PART_ONE_NEXT_STORY_BEAT_KERNEL_MISSING");
  }
  const kernel = requireAsset(input.pkg, narrativeKernelId);''',
    "unbound narrative kernel",
)

start, end = bounds(text, "buildNextStoryBeat", "renderPlayerVisibleSceneContext")
segment = text[start:end]
segment = segment.replace(
    "decisionKernelId: input.decisionKernelId,",
    "decisionKernelId: narrativeKernelId,",
)
segment = segment.replace("${input.decisionKernelId}", "${narrativeKernelId}")
segment = segment.replace(
    "`CURRENT-${input.decisionKernelId}-${index + 1}`",
    "`CURRENT-${narrativeKernelId}-${index + 1}`",
)
segment = segment.replace(
    "      input.decisionKernelId,\n      input.actionText,",
    "      narrativeKernelId,\n      input.actionText,",
)
segment = replace_once(
    segment,
    '''  const fallbackPressure = input.authoritativeNpcReactions[0]?.action
    || input.nextDecisionPoint.prompt;''',
    '''  const fallbackPressure = input.settledReactionContract
    ?.reactionAction.visibleAction
    || input.authoritativeNpcReactions[0]?.action
    || input.nextDecisionPoint.prompt;''',
    "frozen reaction pressure precedence",
)
segment = replace_once(
    segment,
    '''  const evidenceItems = [
    ...currentFacts.map((statement, index) => ({''',
    '''  const unboundEvidenceItems = input.unboundActionNarrativeSource
    ? [{
      evidenceId: `UNBOUND-${input.unboundActionNarrativeSource.sourceEventId}`,
      evidenceClass: "CURRENT_CANON" as const,
      statement: input.unboundActionNarrativeSource.actionText,
      sourceClaimIds: [],
      adaptationDecisionIds: [],
      useAs: "OBJECTIVE_FACT" as const,
    }]
    : [];
  const evidenceItems = [
    ...currentFacts.map((statement, index) => ({''',
    "unbound evidence",
)
segment = replace_once(
    segment,
    '''    ...sourceEvidenceItems,
    ...adaptationEvidenceItems
  ];''',
    '''    ...sourceEvidenceItems,
    ...adaptationEvidenceItems,
    ...unboundEvidenceItems,
  ];''',
    "append unbound evidence",
)
segment = replace_once(
    segment,
    "      unresolvedFacts: unique(input.unresolvedFacts),",
    '''      unresolvedFacts: unique([
        ...input.unresolvedFacts,
        ...(input.settledReactionContract?.forbiddenEscalations || []),
        ...(input.unboundActionNarrativeSource?.forbiddenEscalations || []),
      ]),''',
    "narrative forbidden escalations",
)
text = text[:start] + segment + text[end:]
write(engine_path, text)


# ---------------------------------------------------------------------------
# Legal capability path creates an explicit UnboundActionNarrativeSource.
# ---------------------------------------------------------------------------
facade_path = "packages/templates/src/runtime-facade.ts"
text = read(facade_path)
if "buildPartOneUnboundActionNarrativeSource" not in text:
    text = insert_after(
        text,
        'import { compileDramaticBeatPlan } from "./story-package/dramatic-beat-plan.js";',
        'import { buildPartOneUnboundActionNarrativeSource } from "./story-package/settled-reaction-contract.js";',
        "facade unbound import",
    )
if "const unboundActionNarrativeSource = buildPartOneUnboundActionNarrativeSource({" not in text:
    match = re.search(r'(\n\s*const capabilityFact\s*=.*?;\n)', text, flags=re.S)
    if not match:
        raise SystemExit("capability fact declaration missing")
    indent = re.match(r'\n(\s*)', match.group(1)).group(1)
    block = f'''\n{indent}const unboundActionNarrativeSource = buildPartOneUnboundActionNarrativeSource({{
{indent}  sourceEventId: eventId,
{indent}  sourceActionId: actionBeatId,
{indent}  actionText: input.actionText,
{indent}  parsingResult: {{
{indent}    schemaVersion: "unbound-action-parsing-result-v1",
{indent}    parserId: "OMW_CAPABILITY_V1",
{indent}    intentKind: "CAPABILITY_ACTION",
{indent}    actorId: `actor.${{input.pkg.perspectiveRoleKey}}`,
{indent}    targetEntityIds: [input.incoming.targetRef || "public_frame"],
{indent}    requestedStatePaths: [],
{indent}    requestedDurableEffectTypes: [],
{indent}    parameters: {{
{indent}      decisionPointId: input.workingSet.decisionPoint.decisionPointId,
{indent}    }},
{indent}  }},
{indent}  capabilityValidation: {{
{indent}    schemaVersion: "unbound-capability-validation-v1",
{indent}    status: "AUTHORIZED",
{indent}    capabilityIds: input.workingSet.institutionCapabilities.map(
{indent}      (asset) => asset.assetId,
{indent}    ),
{indent}    validatedConstraintIds: [
{indent}      input.workingSet.decisionPoint.decisionPointId,
{indent}    ],
{indent}    allowedStatePaths: [],
{indent}    allowedDurableEffectTypes: [],
{indent}    rejectionCodes: [],
{indent}  }},
{indent}  settlementResult: {{
{indent}    schemaVersion: "unbound-settlement-result-v1",
{indent}    settlementEventId: eventId,
{indent}    status: "SETTLED",
{indent}    changedStatePaths: [],
{indent}    durableEffectTypes: [],
{indent}    requiredVisibleEffects: [capabilityFact],
{indent}  }},
{indent}  currentScene: scene,
{indent}  actorPolicies: input.workingSet.actorPolicies,
{indent}  materialEffectPolicy: {{
{indent}    allowedStatePaths: [],
{indent}    allowedDurableEffectTypes: [],
{indent}    forbiddenStatePaths: [],
{indent}    forbiddenDurableEffectTypes: [],
{indent}  }},
{indent}  settledReactionContract: null,
{indent}  policyResolvedReactions: [],
{indent}  resultCeiling: "Narrate only the authorized observation, inquiry, preparation, or verification. Do not create commands, evidence, commitments, secrets, or material state changes.",
{indent}  forbiddenEscalations: [
{indent}    "NEW_MAJOR_COMMAND",
{indent}    "NEW_EVIDENCE",
{indent}    "DEATH_OR_IDENTITY_CHANGE",
{indent}    "UNAUTHORIZED_SCENE_TRANSITION",
{indent}    "ANSWER_NEXT_DECISION",
{indent}  ],
{indent}}});\n'''
    text = text[:match.end()] + block + text[match.end():]
text = replace_once(
    text,
    '''      authoritativeObservableFacts: [capabilityFact],
      authoritativeNpcReactions: [],''',
    '''      authoritativeObservableFacts: [capabilityFact],
      settledReactionContract: null,
      unboundActionNarrativeSource,
      authoritativeNpcReactions: [],''',
    "capability event provenance",
)
if '''        settledActionNarrative: "",
        nextStoryBeat:''' in text:
    text = text.replace(
        '''        settledActionNarrative: "",
        nextStoryBeat:''',
        '''        settledActionNarrative: "",
        settledReactionContract: null,
        unboundActionNarrativeSource,
        nextStoryBeat:''',
        1,
    )
write(facade_path, text)


# Narrator context projection contains the full structured sources.
context_path = "apps/api/src/solo-story-engine/context-compiler.ts"
text = read(context_path)
needle = '''    authoritativeObservableFacts: item.authoritativeObservableFacts,
    authoritativeNpcReactions: item.authoritativeNpcReactions.map('''
if needle not in text:
    raise SystemExit("API settlement projection marker missing")
text = text.replace(
    needle,
    '''    authoritativeObservableFacts: item.authoritativeObservableFacts,
    settledReactionContract: item.settledReactionContract || null,
    unboundActionNarrativeSource: item.unboundActionNarrativeSource || null,
    authoritativeNpcReactions: item.authoritativeNpcReactions.map(''',
    1,
)
write(context_path, text)
print("settled reaction runtime and narrator wiring staged")
