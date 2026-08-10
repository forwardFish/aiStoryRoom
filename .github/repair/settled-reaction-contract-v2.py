from __future__ import annotations

import json
import re
from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected exactly one match, found {count}")
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


def write_text(path: str, content: str) -> None:
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(content.rstrip() + "\n", encoding="utf-8")


# ---------------------------------------------------------------------------
# Product contracts
# ---------------------------------------------------------------------------
path = Path("packages/templates/src/story-package/part-one-runtime-types.ts")
text = path.read_text(encoding="utf-8")
contracts = '''export type PartOneReactionSourceEventKind =
  | "AFFORDANCE_SETTLEMENT"
  | "CAPABILITY_SETTLEMENT"
  | "UNBOUND_ACTION_SETTLEMENT"
  | "PENDING_CONSEQUENCE_SETTLEMENT";

export type PartOneSettledReactionScenePolicy =
  | "CURRENT_SCENE"
  | "AFTER_AUTHORIZED_TRANSITION";

export type PartOneReactionScalar = string | number | boolean | null;

export type PartOneSettledReactionAction = {
  actionKind:
    | "RESPOND"
    | "ACKNOWLEDGE"
    | "OBJECT"
    | "REFUSE"
    | "ESCALATE"
    | "OBSERVE";
  targetEntityIds: string[];
  parameterBindings: Record<string, PartOneReactionScalar>;
  /** Author-reviewed visible action. Runtime never parses this to choose state. */
  visibleAction: string;
};

export type PartOneSettledReactionTemplate = {
  schemaVersion: "settled-reaction-template-v1";
  sourceEventKind: PartOneReactionSourceEventKind;
  sourceActionId: string;
  /** Optional author restriction. Empty means Actor Policy resolves responders. */
  responderActorIds: string[];
  activationCondition?: { allOf: PartOneStateRule[] };
  scenePolicy: PartOneSettledReactionScenePolicy;
  reactionAction: PartOneSettledReactionAction;
  resultCeiling: string;
  requiredVisibleEffects: string[];
  forbiddenEscalations: Array<
    | "NEW_MAJOR_COMMAND"
    | "NEW_EVIDENCE"
    | "DEATH_OR_IDENTITY_CHANGE"
    | "UNAUTHORIZED_SCENE_TRANSITION"
    | "ANSWER_NEXT_DECISION"
  >;
};

/** Frozen after current Settlement and before next-decision selection. */
export type PartOneSettledReactionContract = Omit<
  PartOneSettledReactionTemplate,
  "schemaVersion"
> & {
  schemaVersion: "settled-reaction-contract-v1";
  sourceEventId: string;
};

/**
 * Structured narrative provenance for a legal action without an authored
 * Decision-Kernel binding. It is derived from parsing, capability validation,
 * Settlement, current scene and actor-policy assets; prose matching is never
 * used to choose it.
 */
export type PartOneUnboundActionNarrativeSource = {
  schemaVersion: "unbound-action-narrative-source-v1";
  sourceEventId: string;
  sourceEventKind: "UNBOUND_ACTION_SETTLEMENT";
  sourceActionId: string;
  actionSource: string;
  actionText: string;
  playerActorId: string;
  targetEntityIds: string[];
  validatedCapabilityIds: string[];
  currentSceneId: string;
  activeActorIds: string[];
  actorGoalSourceIds: string[];
  sourceMechanismIds: string[];
  requiredVisibleEffects: string[];
  forbiddenEscalations: PartOneSettledReactionTemplate["forbiddenEscalations"];
  resultCeiling: string;
};'''
text = insert_before(
    text,
    "export type PartOneAffordanceTemplate = {",
    contracts,
    "settled reaction and unbound narrative contracts",
)
text = replace_once(
    text,
    '''  playerVisibleFallback?: PartOnePlayerVisibleFallback;
  createsPendingConsequence: boolean;''',
    '''  playerVisibleFallback?: PartOnePlayerVisibleFallback;
  settledReaction?: PartOneSettledReactionTemplate;
  createsPendingConsequence: boolean;''',
    "affordance settled reaction field",
)
text = replace_once(
    text,
    '''  authoritativeObservableFacts: string[];
  authoritativeNpcReactions: Array<{''',
    '''  authoritativeObservableFacts: string[];
  settledReactionContract: PartOneSettledReactionContract | null;
  unboundActionNarrativeSource: PartOneUnboundActionNarrativeSource | null;
  authoritativeNpcReactions: Array<{''',
    "event reaction contract fields",
)
path.write_text(text, encoding="utf-8")


# ---------------------------------------------------------------------------
# Generic world-agnostic contract module
# ---------------------------------------------------------------------------
write_text(
    "packages/templates/src/story-package/settled-reaction-contract.ts",
    r'''import type {
  PartOneReactionSourceEventKind,
  PartOneRuntimeAsset,
  PartOneSceneState,
  PartOneSettledReactionContract,
  PartOneSettledReactionTemplate,
  PartOneState,
  PartOneStateRule,
  PartOneUnboundActionNarrativeSource,
} from "./part-one-runtime-types.js";

const ACTION_KINDS = new Set([
  "RESPOND",
  "ACKNOWLEDGE",
  "OBJECT",
  "REFUSE",
  "ESCALATE",
  "OBSERVE",
]);
const SCENE_POLICIES = new Set([
  "CURRENT_SCENE",
  "AFTER_AUTHORIZED_TRANSITION",
]);
const FORBIDDEN_ESCALATIONS = new Set([
  "NEW_MAJOR_COMMAND",
  "NEW_EVIDENCE",
  "DEATH_OR_IDENTITY_CHANGE",
  "UNAUTHORIZED_SCENE_TRANSITION",
  "ANSWER_NEXT_DECISION",
]);

export type FreezeSettledReactionInput = {
  template: PartOneSettledReactionTemplate | null;
  sourceEventId: string;
  sourceEventKind: PartOneReactionSourceEventKind;
  sourceActionId: string;
  resolvedResponderActorIds: string[];
  state: PartOneState;
  sceneBefore: PartOneSceneState;
  sceneAfter: PartOneSceneState;
  requiredVisibleEffects: string[];
  fallbackVisibleAction: string;
};

export type BuildUnboundNarrativeSourceInput = {
  sourceEventId: string;
  sourceActionId: string;
  actionSource: string;
  actionText: string;
  playerActorId: string;
  targetEntityIds: string[];
  validatedCapabilities: PartOneRuntimeAsset[];
  scene: PartOneSceneState;
  actorPolicies: PartOneRuntimeAsset[];
  narrativeMechanisms: PartOneRuntimeAsset[];
  requiredVisibleEffects: string[];
  forbiddenEscalations?: PartOneUnboundActionNarrativeSource["forbiddenEscalations"];
  resultCeiling: string;
};

export function validateSettledReactionTemplate(
  value: PartOneSettledReactionTemplate,
  expectedSourceActionId?: string,
): PartOneSettledReactionTemplate {
  if (value.schemaVersion !== "settled-reaction-template-v1") {
    fail("SCHEMA_VERSION_INVALID");
  }
  required(value.sourceEventKind, "SOURCE_EVENT_KIND_MISSING");
  required(value.sourceActionId, "SOURCE_ACTION_ID_MISSING");
  if (expectedSourceActionId && value.sourceActionId !== expectedSourceActionId) {
    fail("SOURCE_ACTION_ID_MISMATCH");
  }
  uniqueStrings(value.responderActorIds, "RESPONDER_ACTORS_INVALID");
  if (!SCENE_POLICIES.has(value.scenePolicy)) {
    fail("SCENE_POLICY_INVALID");
  }
  if (!ACTION_KINDS.has(value.reactionAction.actionKind)) {
    fail("REACTION_ACTION_KIND_INVALID");
  }
  uniqueStrings(value.reactionAction.targetEntityIds, "REACTION_TARGETS_INVALID");
  required(value.reactionAction.visibleAction, "REACTION_VISIBLE_ACTION_MISSING");
  required(value.resultCeiling, "RESULT_CEILING_MISSING");
  uniqueStrings(value.requiredVisibleEffects, "VISIBLE_EFFECTS_INVALID");
  uniqueStrings(value.forbiddenEscalations, "FORBIDDEN_ESCALATIONS_INVALID");
  for (const item of value.forbiddenEscalations) {
    if (!FORBIDDEN_ESCALATIONS.has(item)) {
      fail(`FORBIDDEN_ESCALATION_UNKNOWN:${item}`);
    }
  }
  if (value.activationCondition) {
    if (!Array.isArray(value.activationCondition.allOf)
      || value.activationCondition.allOf.length === 0) {
      fail("ACTIVATION_CONDITION_INVALID");
    }
    value.activationCondition.allOf.forEach(validateStateRule);
  }
  return structuredClone(value);
}

export function freezeSettledReactionContract(
  input: FreezeSettledReactionInput,
): PartOneSettledReactionContract | null {
  if (!input.template) return null;
  const template = validateSettledReactionTemplate(
    input.template,
    input.sourceActionId,
  );
  if (
    template.activationCondition
    && !template.activationCondition.allOf.every((rule) => (
      evaluateRule(input.state, rule)
    ))
  ) {
    return null;
  }
  const permittedScene = template.scenePolicy === "CURRENT_SCENE"
    ? input.sceneBefore
    : input.sceneAfter;
  const permittedActors = new Set(permittedScene.presentActorRefs);
  const authoredResponders = template.responderActorIds;
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
    template.reactionAction.visibleAction || input.fallbackVisibleAction,
  ).trim();
  required(visibleAction, "FROZEN_REACTION_ACTION_MISSING");
  return {
    schemaVersion: "settled-reaction-contract-v1",
    sourceEventId: required(input.sourceEventId, "SOURCE_EVENT_ID_MISSING"),
    sourceEventKind: input.sourceEventKind,
    sourceActionId: input.sourceActionId,
    responderActorIds: responders,
    ...(template.activationCondition
      ? { activationCondition: structuredClone(template.activationCondition) }
      : {}),
    scenePolicy: template.scenePolicy,
    reactionAction: {
      ...structuredClone(template.reactionAction),
      visibleAction,
    },
    resultCeiling: template.resultCeiling,
    requiredVisibleEffects: unique([
      ...template.requiredVisibleEffects,
      ...input.requiredVisibleEffects,
    ]),
    forbiddenEscalations: [...template.forbiddenEscalations],
  };
}

export function buildUnboundActionNarrativeSource(
  input: BuildUnboundNarrativeSourceInput,
): PartOneUnboundActionNarrativeSource {
  const sourceMechanismIds = unique([
    ...input.actorPolicies.map((asset) => asset.assetId),
    ...input.validatedCapabilities.map((asset) => asset.assetId),
    ...input.narrativeMechanisms.map((asset) => asset.assetId),
  ]);
  return {
    schemaVersion: "unbound-action-narrative-source-v1",
    sourceEventId: required(input.sourceEventId, "UNBOUND_SOURCE_EVENT_ID_MISSING"),
    sourceEventKind: "UNBOUND_ACTION_SETTLEMENT",
    sourceActionId: required(input.sourceActionId, "UNBOUND_SOURCE_ACTION_ID_MISSING"),
    actionSource: required(input.actionSource, "UNBOUND_ACTION_SOURCE_MISSING"),
    actionText: required(input.actionText, "UNBOUND_ACTION_TEXT_MISSING"),
    playerActorId: required(input.playerActorId, "UNBOUND_PLAYER_ACTOR_MISSING"),
    targetEntityIds: unique(input.targetEntityIds.filter(Boolean)),
    validatedCapabilityIds: unique(
      input.validatedCapabilities.map((asset) => asset.assetId),
    ),
    currentSceneId: required(input.scene.sceneId, "UNBOUND_SCENE_ID_MISSING"),
    activeActorIds: unique(input.scene.presentActorRefs),
    actorGoalSourceIds: unique(input.actorPolicies.map((asset) => asset.assetId)),
    sourceMechanismIds,
    requiredVisibleEffects: unique(input.requiredVisibleEffects),
    forbiddenEscalations: input.forbiddenEscalations || [
      "NEW_MAJOR_COMMAND",
      "NEW_EVIDENCE",
      "DEATH_OR_IDENTITY_CHANGE",
      "UNAUTHORIZED_SCENE_TRANSITION",
      "ANSWER_NEXT_DECISION",
    ],
    resultCeiling: required(input.resultCeiling, "UNBOUND_RESULT_CEILING_MISSING"),
  };
}

function validateStateRule(rule: PartOneStateRule) {
  required(rule.ruleId, "REACTION_RULE_ID_MISSING");
  required(rule.statePath, "REACTION_RULE_PATH_MISSING");
  if (!["EQ", "NEQ", "IN", "NOT_NULL", "ANY_PENDING"].includes(rule.operator)) {
    fail(`REACTION_RULE_OPERATOR_INVALID:${rule.operator}`);
  }
}

function evaluateRule(state: PartOneState, rule: PartOneStateRule) {
  const actual = getPath(state, rule.statePath);
  switch (rule.operator) {
    case "EQ": return deepEqual(actual, rule.expectedValue);
    case "NEQ": return !deepEqual(actual, rule.expectedValue);
    case "IN": return Array.isArray(rule.expectedValue)
      && rule.expectedValue.some((value) => deepEqual(actual, value));
    case "NOT_NULL": return actual !== null && actual !== undefined;
    case "ANY_PENDING": return Array.isArray(actual)
      && actual.some((item) => (
        item && typeof item === "object"
        && ["PENDING", "DUE", "DEFERRED_WITH_REASON", "TRANSFORMED"]
          .includes(String((item as Record<string, unknown>).status || ""))
      ));
  }
}

function getPath(root: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((value, key) => (
    value && typeof value === "object"
      ? (value as Record<string, unknown>)[key]
      : undefined
  ), root);
}

function deepEqual(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function required(value: string, code: string) {
  const normalized = String(value || "").trim();
  if (!normalized) fail(code);
  return normalized;
}

function uniqueStrings(values: string[], code: string) {
  if (!Array.isArray(values) || values.some((value) => !String(value).trim())) {
    fail(code);
  }
  if (new Set(values).size !== values.length) fail(`${code}:DUPLICATE`);
}

function unique(values: string[]) {
  return [...new Set(values.map((value) => String(value).trim()).filter(Boolean))];
}

function fail(code: string): never {
  throw new Error(`PART_ONE_SETTLED_REACTION_${code}`);
}
''',
)

path = Path("packages/templates/src/story-package/index.ts")
text = path.read_text(encoding="utf-8")
text = insert_before(
    text,
    'export * from "./part-one-runtime-loader";',
    'export * from "./settled-reaction-contract";',
    "story package settled reaction export",
)
path.write_text(text, encoding="utf-8")


# ---------------------------------------------------------------------------
# Authoring compiler: materialize typed current-turn reaction templates
# ---------------------------------------------------------------------------
path = Path("scripts/story-decomposition/compile-sangtian-part-one-authoring.mjs")
text = path.read_text(encoding="utf-8")
text = replace_once(
    text,
    '''        ...(kernelPlayerVisibleFallbacks[kernelId]?.[index]
          ? { playerVisibleFallback: kernelPlayerVisibleFallbacks[kernelId][index] }
          : {}),
        createsPendingConsequence: true,''',
    '''        ...(kernelPlayerVisibleFallbacks[kernelId]?.[index]
          ? {
            playerVisibleFallback: kernelPlayerVisibleFallbacks[kernelId][index],
            settledReaction: {
              schemaVersion: "settled-reaction-template-v1",
              sourceEventKind: "AFFORDANCE_SETTLEMENT",
              sourceActionId: `${kernelId}-OPT-0${index + 1}`,
              responderActorIds: [],
              scenePolicy: "CURRENT_SCENE",
              reactionAction: {
                actionKind: "RESPOND",
                targetEntityIds: [targetRef],
                parameterBindings: {},
                visibleAction: String(
                  kernelPlayerVisibleFallbacks[kernelId][index].IMMEDIATE_REACTION
                  || kernelPlayerVisibleFallbacks[kernelId][index].WORLD_PRESSURE
                  || ""
                ).trim(),
              },
              resultCeiling: "只表达本轮已结算行动的直接回应；不得新增重大命令、证据、死亡、身份变化、未授权转场，也不得回答下一项决策。",
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
            },
          }
          : {}),
        createsPendingConsequence: true,''',
    "compile settled reaction template",
)
validation_marker = '''  for (const option of options) {
    const refs = Array.isArray(option.protectedEffectRefs) ? option.protectedEffectRefs : [];'''
validation_replacement = '''  for (const option of options) {
    if (
      !option.settledReaction
      || option.settledReaction.schemaVersion !== "settled-reaction-template-v1"
      || option.settledReaction.sourceActionId !== option.affordanceTemplateId
      || !String(option.settledReaction.reactionAction?.visibleAction || "").trim()
      || !String(option.settledReaction.resultCeiling || "").trim()
      || !Array.isArray(option.settledReaction.requiredVisibleEffects)
      || !Array.isArray(option.settledReaction.forbiddenEscalations)
    ) {
      throw new Error(`DECISION_KERNEL_SETTLED_REACTION_INVALID:${option.affordanceTemplateId}`);
    }
    const refs = Array.isArray(option.protectedEffectRefs) ? option.protectedEffectRefs : [];'''
text = replace_once(
    text,
    validation_marker,
    validation_replacement,
    "validate settled reaction template",
)
path.write_text(text, encoding="utf-8")


# ---------------------------------------------------------------------------
# Dynamic selection purpose: RequirementDependency gates next decision only
# ---------------------------------------------------------------------------
path = Path("packages/templates/src/story-package/dynamic-kernel-lite-runtime.ts")
text = path.read_text(encoding="utf-8")
if 'purpose?: "NEXT_DECISION" | "REACTION_PROJECTION";' not in text:
    text = replace_once(
        text,
        '''export type PartOneWorkingSetSelectionOptions = {
  mode?: PartOneKernelSelectionMode;
  pin?: PartOneDecisionPin | null;
};''',
        '''export type PartOneWorkingSetSelectionOptions = {
  mode?: PartOneKernelSelectionMode;
  pin?: PartOneDecisionPin | null;
  purpose?: "NEXT_DECISION" | "REACTION_PROJECTION";
};''',
        "working set purpose",
    )
    text = replace_once(
        text,
        '''  const evaluated = unresolved.map((kernelId) => evaluateKernelSafely(
    pkg,
    state,
    section,
    kernelId,
    turnNumber,
  ));''',
        '''  const enforceRequirementDependencies =
    options.purpose !== "REACTION_PROJECTION";
  const evaluated = unresolved.map((kernelId) => evaluateKernelSafely(
    pkg,
    state,
    section,
    kernelId,
    turnNumber,
    enforceRequirementDependencies,
  ));''',
        "purpose-aware candidate evaluation",
    )
    text = replace_once(
        text,
        '''  selection: KernelSelectorLiteResult<Preview> | null = null,
): DynamicPartOneRuntimeWorkingSet {''',
        '''  selection: KernelSelectorLiteResult<Preview> | null = null,
  enforceRequirementDependencies = true,
): DynamicPartOneRuntimeWorkingSet {''',
        "fallback purpose signature",
    )
    text = text.replace(
        'if (mode === "LEGACY_FALLBACK") {',
        'if (mode === "LEGACY_FALLBACK" && enforceRequirementDependencies) {',
        1,
    )
    text = replace_once(
        text,
        '''  kernelId: string,
  turnNumber: number,
): Evaluation {
  try {
    return evaluateKernel(pkg, state, section, kernelId, turnNumber);''',
        '''  kernelId: string,
  turnNumber: number,
  enforceRequirementDependencies = true,
): Evaluation {
  try {
    return evaluateKernel(
      pkg,
      state,
      section,
      kernelId,
      turnNumber,
      enforceRequirementDependencies,
    );''',
        "safe evaluation purpose",
    )
    text = replace_once(
        text,
        '''  kernelId: string,
  turnNumber: number,
): Evaluation {
  const kernel = requireKernel(pkg, kernelId);''',
        '''  kernelId: string,
  turnNumber: number,
  enforceRequirementDependencies = true,
): Evaluation {
  const kernel = requireKernel(pkg, kernelId);''',
        "evaluation purpose",
    )
    text = replace_once(
        text,
        '''  const blockedByRequirementDependencyIds = dependencyBlocksForKernel(
    pkg,
    state,
    section,
    kernel,
  );''',
        '''  const blockedByRequirementDependencyIds = enforceRequirementDependencies
    ? dependencyBlocksForKernel(pkg, state, section, kernel)
    : [];''',
        "purpose-aware dependency gate",
    )
    # Pass purpose into Legacy fallback construction.
    text = re.sub(
        r'(return fallbackWorkingSet\(\n\s*pkg,\n\s*state,\n\s*turnNumber,\n\s*evaluated,\n\s*"LEGACY_FALLBACK",\n\s*selection,\n)(\s*\);)',
        r'\1    enforceRequirementDependencies,\n\2',
        text,
        count=1,
    )
path.write_text(text, encoding="utf-8")


# ---------------------------------------------------------------------------
# Current reaction planner and next decision planner remain independent
# ---------------------------------------------------------------------------
path = Path("packages/templates/src/story-package/dynamic-kernel-lite-settlement.ts")
text = path.read_text(encoding="utf-8")
if "function planReactionTurn(" not in text:
    text = replace_once(
        text,
        '''  const reactionPlan = planNextTurn(
    pkg,
    causal.proposedState,
    turnNumber,
    recoverySurface,
  );
  let plan = reactionPlan;''',
        '''  const reactionPlan = planReactionTurn(
    pkg,
    causal.proposedState,
    turnNumber,
    recoverySurface,
  );
  let plan = planNextTurn(
    pkg,
    causal.proposedState,
    turnNumber,
    recoverySurface,
  );''',
        "split reaction and next plan",
    )
    helper = '''function planReactionTurn(
  pkg: PartOneRuntimePackage,
  state: PartOneState,
  turnNumber: number,
  recoverySurface: DynamicPartOneRuntimeWorkingSet,
): NextTurnPlan {
  try {
    return {
      workingSet: buildDynamicPartOneRuntimeWorkingSet(
        pkg,
        state,
        turnNumber,
        { purpose: "REACTION_PROJECTION" },
      ),
      status: "PLANNED",
    };
  } catch (error) {
    return {
      workingSet: buildRecoveredNextTurnWorkingSet(
        pkg,
        state,
        turnNumber,
        recoverySurface,
        error,
      ),
      status: "RECOVERED",
      failureCode: normalizeErrorCode(error),
    };
  }
}'''
    text = insert_before(
        text,
        "function planNextTurn(",
        helper,
        "reaction planning function",
    )
path.write_text(text, encoding="utf-8")


# ---------------------------------------------------------------------------
# Settlement freezes reaction contract and unbound narrative provenance
# ---------------------------------------------------------------------------
path = Path("packages/templates/src/story-package/part-one-runtime-engine.ts")
text = path.read_text(encoding="utf-8")
text = insert_after(
    text,
    'import { compileDramaticBeatPlan } from "./dramatic-beat-plan";',
    '''import {
  buildUnboundActionNarrativeSource,
  freezeSettledReactionContract,
} from "./settled-reaction-contract";''',
    "reaction contract imports",
)
text = text.replace(
    '''  PartOneStateRule,
  PartOneTurnProgressReport''',
    '''  PartOneStateRule,
  PartOneTurnProgressReport,
  PartOneSettledReactionContract,
  PartOneUnboundActionNarrativeSource''',
    1,
)
old = '''  const authoritativeObservableFacts = buildAuthoritativeObservableFacts(
    current.settledAction,
    current.statePatch,
    proposedState,
  );
  const authoritativeNpcReactions = buildAuthoritativeNpcReactions({
    eventId: current.eventId,
    sceneAfter,
    reactionWorkingSet,
  });'''
new = '''  const authoritativeObservableFacts = buildAuthoritativeObservableFacts(
    current.settledAction,
    current.statePatch,
    proposedState,
  );
  const policyResolvedReactions = buildAuthoritativeNpcReactions({
    eventId: current.eventId,
    sceneAfter,
    reactionWorkingSet,
  });
  const unboundActionNarrativeSource = current.decisionKernelId
    ? null
    : buildUnboundActionNarrativeSource({
      sourceEventId: current.eventId,
      sourceActionId: current.settledAction.decisionId || current.eventId,
      actionSource: current.settledAction.source,
      actionText: current.settledAction.actionText,
      playerActorId: `actor.${pkg.perspectiveRoleKey}`,
      targetEntityIds: [current.targetRef].filter(Boolean),
      validatedCapabilities: reactionWorkingSet.institutionCapabilities,
      scene: sceneAfter,
      actorPolicies: reactionWorkingSet.actorPolicies,
      narrativeMechanisms: reactionWorkingSet.narrativeScenePatterns,
      requiredVisibleEffects: authoritativeObservableFacts,
      resultCeiling: reactionWorkingSet.decisionPoint.resultCeiling,
    });
  const settledReactionContract = freezeSettledReactionContract({
    template: current.appliedAffordance?.settledReaction || null,
    sourceEventId: current.eventId,
    sourceEventKind: current.appliedAffordance
      ? "AFFORDANCE_SETTLEMENT"
      : current.settledAction.source === "FREE_TEXT_CAPABILITY"
        ? "CAPABILITY_SETTLEMENT"
        : "UNBOUND_ACTION_SETTLEMENT",
    sourceActionId: current.affordanceTemplateId
      || current.settledAction.decisionId
      || current.eventId,
    resolvedResponderActorIds: policyResolvedReactions.flatMap(
      (reaction) => reaction.actorRefs,
    ),
    state: proposedState,
    sceneBefore,
    sceneAfter,
    requiredVisibleEffects: authoritativeObservableFacts,
    fallbackVisibleAction: policyResolvedReactions[0]?.action || "",
  });
  const authoritativeNpcReactions = projectSettledReaction(
    settledReactionContract,
    policyResolvedReactions,
  );'''
text = replace_once(text, old, new, "freeze current reaction")
text = replace_once(
    text,
    '''    authoritativeObservableFacts,
    authoritativeNpcReactions,
    authoritativeWorldMoves,''',
    '''    authoritativeObservableFacts,
    settledReactionContract,
    unboundActionNarrativeSource,
    authoritativeNpcReactions,
    authoritativeWorldMoves,''',
    "narrative plan contract inputs",
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
    "event reaction contract fields",
)
helper = '''/** Convert one frozen current-turn contract into the authoritative event reaction. */
function projectSettledReaction(
  contract: PartOneSettledReactionContract | null,
  policyResolved: PartOneCommittedEvent["authoritativeNpcReactions"],
): PartOneCommittedEvent["authoritativeNpcReactions"] {
  if (!contract) return policyResolved;
  const policyAssetId = policyResolved[0]?.policyAssetId
    || `SETTLED-REACTION:${contract.sourceActionId}`;
  return [{
    reactionEventId: `REACTION-${contract.sourceEventId}`,
    actorRefs: [...contract.responderActorIds],
    action: contract.reactionAction.visibleAction,
    policyAssetId,
  }];
}'''
text = insert_before(
    text,
    "function buildAuthoritativeNpcReactions(",
    helper,
    "settled reaction projector",
)
# Narrative-plan contract fields.
text = replace_once(
    text,
    '''  authoritativeObservableFacts: string[];
  authoritativeNpcReactions: PartOneCommittedEvent["authoritativeNpcReactions"];''',
    '''  authoritativeObservableFacts: string[];
  settledReactionContract: PartOneSettledReactionContract | null;
  unboundActionNarrativeSource: PartOneUnboundActionNarrativeSource | null;
  authoritativeNpcReactions: PartOneCommittedEvent["authoritativeNpcReactions"];''',
    "narrative plan type fields",
)
text = replace_once(
    text,
    '''    authoritativeObservableFacts: input.authoritativeObservableFacts,
    authoritativeNpcReactions: input.authoritativeNpcReactions,''',
    '''    authoritativeObservableFacts: input.authoritativeObservableFacts,
    settledReactionContract: input.settledReactionContract,
    unboundActionNarrativeSource: input.unboundActionNarrativeSource,
    authoritativeNpcReactions: input.authoritativeNpcReactions,''',
    "next beat contract inputs",
)
# Next beat input type.
text = replace_once(
    text,
    '''  authoritativeObservableFacts: string[];
  authoritativeNpcReactions: PartOneCommittedEvent["authoritativeNpcReactions"];
  authoritativeWorldMoves: PartOneAuthoritativeWorldMove[];''',
    '''  authoritativeObservableFacts: string[];
  settledReactionContract: PartOneSettledReactionContract | null;
  unboundActionNarrativeSource: PartOneUnboundActionNarrativeSource | null;
  authoritativeNpcReactions: PartOneCommittedEvent["authoritativeNpcReactions"];
  authoritativeWorldMoves: PartOneAuthoritativeWorldMove[];''',
    "next beat type fields",
)
# Replace hard Kernel-only provenance with Kernel or structured unbound source.
text = replace_once(
    text,
    '''  if (!input.decisionKernelId) {
    throw new Error("PART_ONE_NEXT_STORY_BEAT_KERNEL_MISSING");
  }
  const kernel = requireAsset(input.pkg, input.decisionKernelId);
  const kernelClaimIds = new Set(kernel.sourceClaimIds);
  const selectedScenePatterns = selectNarrativeScenePatterns(input.pkg.assets, {
    sectionId: kernel.sectionIds[0] || "",
    decisionKernelId: input.decisionKernelId,
    requirementIds: kernel.requirementIds
  }, 2).map((asset) => {''',
    '''  const kernel = input.decisionKernelId
    ? requireAsset(input.pkg, input.decisionKernelId)
    : null;
  const unboundSource = input.unboundActionNarrativeSource;
  if (!kernel && !unboundSource) {
    throw new Error("PART_ONE_NEXT_STORY_BEAT_SOURCE_MISSING");
  }
  const narrativeSourceId = kernel?.assetId || unboundSource!.sourceActionId;
  const mechanismAssets = kernel
    ? []
    : input.pkg.assets.filter((asset) => (
      unboundSource!.sourceMechanismIds.includes(asset.assetId)
    ));
  const kernelClaimIds = new Set(
    kernel?.sourceClaimIds
    || mechanismAssets.flatMap((asset) => asset.sourceClaimIds),
  );
  const selectedScenePatternAssets = kernel
    ? selectNarrativeScenePatterns(input.pkg.assets, {
      sectionId: kernel.sectionIds[0] || "",
      decisionKernelId: kernel.assetId,
      requirementIds: kernel.requirementIds,
    }, 2)
    : mechanismAssets
      .filter((asset) => asset.assetType === "NARRATIVE_SCENE_PATTERN")
      .slice(0, 2);
  const selectedScenePatterns = selectedScenePatternAssets.map((asset) => {''',
    "unbound next beat source",
)
text = replace_once(
    text,
    '''  const adaptationEvidenceItems = kernel.adaptationDecisionIds.flatMap((adaptationDecisionId) => {''',
    '''  const adaptationEvidenceItems = (kernel?.adaptationDecisionIds || []).flatMap((adaptationDecisionId) => {''',
    "optional kernel adaptations",
)
text = replace_once(
    text,
    '''  if (!sourceEvidenceItems.length && !adaptationEvidenceItems.length) {
    throw new Error(`PART_ONE_NEXT_STORY_BEAT_EVIDENCE_MISSING:${input.decisionKernelId}`);
  }''',
    '''  const unboundEvidenceItems = unboundSource
    ? [{
      evidenceId: `UNBOUND-${unboundSource.sourceEventId}`,
      evidenceClass: "CURRENT_CANON" as const,
      statement: `本轮合法行动已经通过能力、场景和结算校验：${unboundSource.actionText}`,
      sourceClaimIds: [],
      adaptationDecisionIds: [],
      useAs: "OBJECTIVE_FACT" as const,
    }]
    : [];
  if (
    !sourceEvidenceItems.length
    && !adaptationEvidenceItems.length
    && !unboundEvidenceItems.length
  ) {
    throw new Error(`PART_ONE_NEXT_STORY_BEAT_EVIDENCE_MISSING:${narrativeSourceId}`);
  }''',
    "unbound evidence fallback",
)
text = text.replace(
    '`CURRENT-${input.decisionKernelId}-${index + 1}`',
    '`CURRENT-${narrativeSourceId}-${index + 1}`',
    1,
)
text = replace_once(
    text,
    '''    ...sourceEvidenceItems,
    ...adaptationEvidenceItems
  ];''',
    '''    ...sourceEvidenceItems,
    ...adaptationEvidenceItems,
    ...unboundEvidenceItems,
  ];''',
    "append unbound evidence",
)
text = text.replace(
    '`PART_ONE_VISIBLE_PRESSURE_MISSING:${input.decisionKernelId}`',
    '`PART_ONE_VISIBLE_PRESSURE_MISSING:${narrativeSourceId}`',
    1,
)
text = text.replace(
    '''      input.decisionKernelId,
      input.actionText,''',
    '''      narrativeSourceId,
      input.actionText,''',
    1,
)
text = replace_once(
    text,
    '''      evidenceItems,
      unresolvedFacts: unique(input.unresolvedFacts),''',
    '''      evidenceItems,
      unresolvedFacts: unique([
        ...input.unresolvedFacts,
        ...(unboundSource?.forbiddenEscalations || []),
      ]),''',
    "unbound forbidden escalations",
)
text = replace_once(
    text,
    '''      dramaticTask: String(
        isRecord(kernel.payload.decisionPrompt)
          ? kernel.payload.decisionPrompt.prompt || ""
          : ""
      ).trim() || input.nextDecisionPoint.prompt,''',
    '''      dramaticTask: kernel
        ? String(
          isRecord(kernel.payload.decisionPrompt)
            ? kernel.payload.decisionPrompt.prompt || ""
            : ""
        ).trim() || input.nextDecisionPoint.prompt
        : unboundSource!.resultCeiling,''',
    "unbound dramatic task",
)
path.write_text(text, encoding="utf-8")


# ---------------------------------------------------------------------------
# Narrator context exposes frozen reaction and unbound provenance, not routing
# ---------------------------------------------------------------------------
path = Path("apps/api/src/solo-story-engine/context-compiler.ts")
text = path.read_text(encoding="utf-8")
needle = '''    authoritativeObservableFacts: item.authoritativeObservableFacts,
    authoritativeNpcReactions: item.authoritativeNpcReactions.map('''
replacement = '''    authoritativeObservableFacts: item.authoritativeObservableFacts,
    settledReactionContract: item.settledReactionContract,
    unboundActionNarrativeSource: item.unboundActionNarrativeSource,
    authoritativeNpcReactions: item.authoritativeNpcReactions.map('''
if needle in text:
    text = text.replace(needle, replacement, 1)
path.write_text(text, encoding="utf-8")


# ---------------------------------------------------------------------------
# Permanent tests
# ---------------------------------------------------------------------------
write_text(
    "packages/templates/tests/settled-reaction-contract.test.ts",
    r'''import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import {
  buildUnboundActionNarrativeSource,
  freezeSettledReactionContract,
  validateSettledReactionTemplate,
} from "../src/story-package/settled-reaction-contract.js";
import type {
  PartOneRuntimeAsset,
  PartOneSettledReactionTemplate,
  PartOneState,
} from "../src/story-package/part-one-runtime-types.js";

const template: PartOneSettledReactionTemplate = {
  schemaVersion: "settled-reaction-template-v1",
  sourceEventKind: "AFFORDANCE_SETTLEMENT",
  sourceActionId: "action.inspect",
  responderActorIds: [],
  activationCondition: {
    allOf: [{
      ruleId: "rule.active",
      statePath: "review.authority",
      operator: "EQ",
      expectedValue: "OPEN",
      description: "active",
    }],
  },
  scenePolicy: "CURRENT_SCENE",
  reactionAction: {
    actionKind: "RESPOND",
    targetEntityIds: ["document.register"],
    parameterBindings: { mode: "formal" },
    visibleAction: "The clerk records the settled inspection request.",
  },
  resultCeiling: "Render only the direct response.",
  requiredVisibleEffects: ["inspection requested"],
  forbiddenEscalations: ["NEW_EVIDENCE", "ANSWER_NEXT_DECISION"],
};

function state(authority = "OPEN"): PartOneState {
  return {
    partId: "PART-01",
    sectionId: "section.neutral",
    turnNumber: 2,
    durableState: { predicates: [] },
    scene: {
      sceneId: "scene.neutral",
      timeLabel: "now",
      locationLabel: "harbor office",
      presentActorRefs: ["actor.player", "actor.clerk"],
      situation: "inspection pending",
    },
    reform: { executionMode: "", scopeStatus: "", progress: "" },
    review: { initiationStatus: "", authority, procedureStatus: "" },
    evidence: { chainStatus: "", primaryCustodianRef: null, copyStatus: "", archiveSealStatus: "" },
    witness: { accessStatus: "" },
    grain: { immediatePressure: "", officialStockStatus: "", reliefChannel: "" },
    merchant: { entryStatus: "", grantedRights: [] },
    land: { riskLevel: "", safeguardStatus: "" },
    report: { authorshipMode: "", firstNarrativeController: "", attachmentStrength: "", dispatchStatus: "" },
    responsibility: { firstRecordStatus: "", governorExposure: 0, xunfuExposure: 0 },
    relations: { governorXunfu: 0 },
    knowledgeTransfers: [],
    pendingConsequences: [],
  };
}

const scene = state().scene;

test("freezes current reaction independently from the next decision prompt", () => {
  const contract = freezeSettledReactionContract({
    template,
    sourceEventId: "event.2",
    sourceEventKind: "AFFORDANCE_SETTLEMENT",
    sourceActionId: "action.inspect",
    resolvedResponderActorIds: ["actor.clerk"],
    state: state(),
    sceneBefore: scene,
    sceneAfter: scene,
    requiredVisibleEffects: ["register remains sealed"],
    fallbackVisibleAction: "A later decision asks something else.",
  });
  assert.ok(contract);
  assert.equal(contract.sourceEventId, "event.2");
  assert.deepEqual(contract.responderActorIds, ["actor.clerk"]);
  assert.equal(
    contract.reactionAction.visibleAction,
    "The clerk records the settled inspection request.",
  );
  assert.doesNotMatch(contract.reactionAction.visibleAction, /later decision/i);
});

test("typed activation condition enables and disables the reaction", () => {
  assert.ok(freezeSettledReactionContract({
    template,
    sourceEventId: "event.active",
    sourceEventKind: "AFFORDANCE_SETTLEMENT",
    sourceActionId: "action.inspect",
    resolvedResponderActorIds: ["actor.clerk"],
    state: state("OPEN"),
    sceneBefore: scene,
    sceneAfter: scene,
    requiredVisibleEffects: [],
    fallbackVisibleAction: "fallback",
  }));
  assert.equal(freezeSettledReactionContract({
    template,
    sourceEventId: "event.inactive",
    sourceEventKind: "AFFORDANCE_SETTLEMENT",
    sourceActionId: "action.inspect",
    resolvedResponderActorIds: ["actor.clerk"],
    state: state("CLOSED"),
    sceneBefore: scene,
    sceneAfter: scene,
    requiredVisibleEffects: [],
    fallbackVisibleAction: "fallback",
  }), null);
});

test("rejects invalid action references and unauthorized responders", () => {
  assert.throws(
    () => validateSettledReactionTemplate(template, "action.other"),
    /SOURCE_ACTION_ID_MISMATCH/,
  );
  assert.throws(() => freezeSettledReactionContract({
    template: { ...template, responderActorIds: ["actor.absent"] },
    sourceEventId: "event.invalid",
    sourceEventKind: "AFFORDANCE_SETTLEMENT",
    sourceActionId: "action.inspect",
    resolvedResponderActorIds: [],
    state: state(),
    sceneBefore: scene,
    sceneAfter: scene,
    requiredVisibleEffects: [],
    fallbackVisibleAction: "fallback",
  }), /RESPONDER_OUTSIDE_AUTHORIZED_SCENE/);
});

test("builds world-neutral narrative provenance for a legal unbound action", () => {
  const asset = (assetId: string, assetType: string): PartOneRuntimeAsset => ({
    schemaVersion: "runtime-story-asset-v1",
    assetId,
    assetType,
    partIds: ["PART-01"],
    sectionIds: ["section.neutral"],
    requirementIds: [],
    decisionKernelIds: [],
    causalArcIds: [],
    actorRefs: [],
    stateDependencies: [],
    visibilityRules: [],
    sourceClaimIds: [],
    adaptationDecisionIds: [],
    retrievalTags: [],
    payload: {},
  });
  const source = buildUnboundActionNarrativeSource({
    sourceEventId: "event.unbound",
    sourceActionId: "action.unbound",
    actionSource: "CUSTOM",
    actionText: "Inspect the public manifest without issuing an order.",
    playerActorId: "actor.player",
    targetEntityIds: ["document.manifest"],
    validatedCapabilities: [asset("capability.inspect", "INSTITUTION_CAPABILITY")],
    scene,
    actorPolicies: [asset("policy.clerk", "ACTOR_POLICY")],
    narrativeMechanisms: [asset("pattern.harbor", "NARRATIVE_SCENE_PATTERN")],
    requiredVisibleEffects: ["manifest inspected"],
    resultCeiling: "Do not invent a new order or document.",
  });
  assert.equal(source.sourceEventKind, "UNBOUND_ACTION_SETTLEMENT");
  assert.deepEqual(source.validatedCapabilityIds, ["capability.inspect"]);
  assert.deepEqual(source.actorGoalSourceIds, ["policy.clerk"]);
  assert.deepEqual(source.sourceMechanismIds.sort(), [
    "capability.inspect",
    "pattern.harbor",
    "policy.clerk",
  ]);
});

test("generic contract source contains no story-specific routing vocabulary", () => {
  const source = readFileSync(
    resolve(__dirname, "../src/story-package/settled-reaction-contract.ts"),
    "utf8",
  );
  assert.doesNotMatch(source, /[\u3400-\u9fff]/u);
  assert.doesNotMatch(source, /sangtian|zhejiang|qingliu|xunfu|review\.authority|actionText.*match/iu);
});
''',
)

path = Path("packages/templates/tests/part-one-dynamic-kernel-lite.test.ts")
text = path.read_text(encoding="utf-8")
name = "every playable Affordance carries a full current-turn reaction template"
if name not in text:
    test_case = r'''test("every playable Affordance carries a full current-turn reaction template", () => {
  const pkg = packageUnderTest();
  const options = pkg.assets
    .filter((asset) => asset.assetType === "DECISION_KERNEL")
    .flatMap((asset) => asset.payload.options || []);
  assert.ok(options.length > 0);
  for (const option of options) {
    const reaction = option.settledReaction;
    assert.equal(reaction?.schemaVersion, "settled-reaction-template-v1");
    assert.equal(reaction?.sourceActionId, option.affordanceTemplateId);
    assert.ok(String(reaction?.reactionAction.visibleAction || "").trim());
    assert.ok(String(reaction?.resultCeiling || "").trim());
    assert.equal(reaction?.forbiddenEscalations.includes("ANSWER_NEXT_DECISION"), true);
  }
});'''
    text = text.rstrip() + "\n\n" + test_case + "\n"
path.write_text(text, encoding="utf-8")

write_text(
    "apps/openovel-runtime/tests/settled-reaction-contract-production.spec.ts",
    r'''import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import templatesPackage from "@ai-story/templates";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const configRoot = path.resolve(currentDir, "../../../packages/templates/config");

test("current settled reaction remains independent from the next Decision Point", () => {
  const pkg = templatesPackage.loadPartOneRuntimePackage(
    "sangtian",
    configRoot,
  ).package;
  const state = templatesPackage.createInitialPartOneState(pkg);
  const opening = templatesPackage.settlePartOneAction(
    pkg,
    state,
    {
      source: "RECOMMENDED",
      decisionId: "opening_d1",
      actionText: "opening_d1",
    },
    1,
  );
  const next = templatesPackage.buildPartOneRuntimeWorkingSet(
    pkg,
    opening.proposedState,
    1,
  );
  const chosen = next.decisionAffordances[0];
  assert.ok(chosen);
  const settlement = templatesPackage.settlePartOneAction(
    pkg,
    opening.proposedState,
    {
      source: "RECOMMENDED",
      decisionId: chosen.affordanceTemplateId,
      decisionKernelId: chosen.decisionKernelId,
      affordanceTemplateId: chosen.affordanceTemplateId,
      label: chosen.title,
      actionText: chosen.actionText,
      targetRef: chosen.target.id,
    },
    2,
  );
  const contract = settlement.event.settledReactionContract;
  assert.ok(contract);
  assert.equal(contract.sourceEventId, settlement.event.eventId);
  assert.equal(contract.sourceActionId, chosen.affordanceTemplateId);
  assert.equal(
    settlement.event.authoritativeNpcReactions[0]?.action,
    contract.reactionAction.visibleAction,
  );
  assert.notEqual(
    contract.reactionAction.visibleAction,
    settlement.event.nextDecisionPoint.prompt,
  );
});

test("legal unbound actions carry structured narrative provenance", () => {
  const pkg = templatesPackage.loadPartOneRuntimePackage(
    "sangtian",
    configRoot,
  ).package;
  const state = templatesPackage.createInitialPartOneState(pkg);
  const settlement = templatesPackage.settlePartOneAction(
    pkg,
    state,
    {
      source: "CUSTOM",
      decisionId: "custom.observe",
      actionText: "只查看已经公开的文书状态，不下达新的命令。",
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
''',
)

path = Path("packages/templates/package.json")
data = json.loads(path.read_text(encoding="utf-8"))
command = data["scripts"]["test:story-package"]
for test_path in [
    "tests/requirement-dependency.test.ts",
    "tests/settled-reaction-contract.test.ts",
]:
    if test_path not in command:
        command += f" {test_path}"
data["scripts"]["test:story-package"] = command
path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

print("settled reaction and unbound narrative product changes staged")
