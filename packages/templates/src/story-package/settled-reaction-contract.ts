import type {
  PartOneCommittedEvent,
  PartOneRuntimeAsset,
  PartOneSceneState,
  PartOneSettledReactionContract,
  PartOneSettledReactionSourceEventKind,
  PartOneSettledReactionTemplate,
  PartOneState,
  PartOneStateRule,
  PartOneUnboundActionNarrativeSource,
  PartOneUnboundCapabilityValidation,
  PartOneUnboundMaterialEffectPolicy,
  PartOneUnboundActionParsingResult,
  PartOneUnboundSettlementResult,
} from "./part-one-runtime-types.js";

const DEFAULT_FORBIDDEN_ESCALATIONS = [
  "NEW_MAJOR_COMMAND",
  "NEW_EVIDENCE",
  "DEATH_OR_IDENTITY_CHANGE",
  "UNAUTHORIZED_SCENE_TRANSITION",
  "ANSWER_NEXT_DECISION",
];

export type FreezePartOneSettledReactionInput = {
  template: PartOneSettledReactionTemplate | null;
  sourceEventId: string;
  sourceEventKind: PartOneSettledReactionSourceEventKind;
  sourceActionId: string;
  sourceAffordanceTemplateId?: string | null;
  resolvedResponderActorIds: string[];
  state: PartOneState;
  sceneBefore: PartOneSceneState;
  sceneAfter: PartOneSceneState;
  sectionTransitioned: boolean;
  fallbackVisibleAction: string;
  requiredVisibleEffects: string[];
};

export type BuildPartOneUnboundNarrativeSourceInput = {
  sourceEventId: string;
  sourceActionId: string;
  actionText: string;
  parsingResult: PartOneUnboundActionParsingResult;
  capabilityValidation: PartOneUnboundCapabilityValidation;
  settlementResult: PartOneUnboundSettlementResult;
  currentScene: PartOneSceneState;
  actorPolicies: PartOneRuntimeAsset[];
  materialEffectPolicy: PartOneUnboundMaterialEffectPolicy;
  settledReactionContract: PartOneSettledReactionContract | null;
  policyResolvedReactions: PartOneCommittedEvent["authoritativeNpcReactions"];
  resultCeiling: string;
  forbiddenEscalations: string[];
};

export function validatePartOneSettledReactionTemplate(
  value: PartOneSettledReactionTemplate,
): PartOneSettledReactionTemplate {
  if (value.schemaVersion !== "settled-reaction-template-v1") {
    fail("TEMPLATE_SCHEMA_VERSION_INVALID");
  }
  required(value.sourceActionId, "TEMPLATE_SOURCE_ACTION_ID_MISSING");
  if (![
    "AFFORDANCE_SETTLEMENT",
    "CAPABILITY_SETTLEMENT",
    "UNBOUND_ACTION_SETTLEMENT",
    "WORLD_SETTLEMENT",
  ].includes(value.sourceEventKind)) {
    fail("TEMPLATE_SOURCE_EVENT_KIND_INVALID");
  }
  if (![
    "CURRENT_SCENE",
    "AFTER_AUTHORIZED_TRANSITION",
  ].includes(value.scenePolicy)) {
    fail("TEMPLATE_SCENE_POLICY_INVALID");
  }
  validateReactionAction(value.reactionAction);
  required(value.resultCeiling, "TEMPLATE_RESULT_CEILING_MISSING");
  uniqueStrings(value.responderActorIds, "TEMPLATE_RESPONDER_IDS_INVALID");
  uniqueStrings(value.requiredVisibleEffects, "TEMPLATE_VISIBLE_EFFECTS_INVALID");
  uniqueStrings(value.forbiddenEscalations, "TEMPLATE_FORBIDDEN_ESCALATIONS_INVALID");
  for (const rule of value.activationCondition?.allOf || []) {
    validateStateRule(rule);
  }
  return structuredClone(value);
}

export function freezePartOneSettledReactionContract(
  input: FreezePartOneSettledReactionInput,
): PartOneSettledReactionContract | null {
  const template = input.template
    ? validatePartOneSettledReactionTemplate(input.template)
    : null;
  if (template && template.sourceEventKind !== input.sourceEventKind) {
    fail("SOURCE_EVENT_KIND_MISMATCH");
  }
  if (template && template.sourceActionId !== input.sourceActionId) {
    fail("SOURCE_ACTION_ID_MISMATCH");
  }
  if (
    template?.sourceAffordanceTemplateId
    && template.sourceAffordanceTemplateId
      !== String(input.sourceAffordanceTemplateId || "").trim()
  ) {
    fail("SOURCE_AFFORDANCE_TEMPLATE_ID_MISMATCH");
  }
  if (
    template?.activationCondition
    && !template.activationCondition.allOf.every((rule) => evaluateRule(input.state, rule))
  ) {
    return null;
  }
  const scenePolicy = input.sectionTransitioned
    ? "AFTER_AUTHORIZED_TRANSITION" as const
    : template?.scenePolicy || "CURRENT_SCENE" as const;
  const authorizedScene = scenePolicy === "CURRENT_SCENE"
    ? input.sceneBefore
    : input.sceneAfter;
  const present = new Set(authorizedScene.presentActorRefs);
  const authoredResponders = template?.responderActorIds || [];
  const unauthorized = authoredResponders.find((actorId) => !present.has(actorId));
  if (unauthorized) fail(`RESPONDER_OUTSIDE_AUTHORIZED_SCENE:${unauthorized}`);
  const responderActorIds = authoredResponders.length
    ? unique(authoredResponders)
    : unique(input.resolvedResponderActorIds).filter((actorId) => present.has(actorId));
  const templateVisibleActionSource =
    template?.reactionAction.visibleActionSource || "AUTHORED";
  const visibleAction = required(
    templateVisibleActionSource === "REACTION_WORKING_SET"
      ? input.fallbackVisibleAction
      : template?.reactionAction.visibleAction || input.fallbackVisibleAction,
    "VISIBLE_ACTION_MISSING",
  );
  const sourceAffordanceTemplateId = String(
    input.sourceAffordanceTemplateId
    || template?.sourceAffordanceTemplateId
    || "",
  ).trim();
  return {
    schemaVersion: "settled-reaction-contract-v1",
    sourceEventId: required(input.sourceEventId, "SOURCE_EVENT_ID_MISSING"),
    sourceEventKind: input.sourceEventKind,
    sourceActionId: required(input.sourceActionId, "SOURCE_ACTION_ID_MISSING"),
    ...(sourceAffordanceTemplateId ? { sourceAffordanceTemplateId } : {}),
    responderActorIds,
    ...(template?.activationCondition
      ? { activationCondition: structuredClone(template.activationCondition) }
      : {}),
    scenePolicy,
    reactionAction: template
      ? {
        actionKind: responderActorIds.length
          ? "NPC_RESPONSE"
          : template.reactionAction.actionKind,
        targetEntityIds: [...template.reactionAction.targetEntityIds],
        parameterBindings: structuredClone(
          template.reactionAction.parameterBindings,
        ),
        visibleAction,
      }
      : {
        actionKind: responderActorIds.length ? "NPC_RESPONSE" : "WORLD_RESPONSE",
        targetEntityIds: [],
        parameterBindings: {},
        visibleAction,
      },
    resultCeiling: template?.resultCeiling
      || "Render only the direct settled response; do not add major state changes or answer the next decision.",
    requiredVisibleEffects: unique([
      ...(template?.requiredVisibleEffects || []),
      ...input.requiredVisibleEffects,
    ]),
    forbiddenEscalations: unique([
      ...(template?.forbiddenEscalations || []),
      ...DEFAULT_FORBIDDEN_ESCALATIONS,
    ]),
  };
}

export function projectPartOneSettledReaction(
  contract: PartOneSettledReactionContract | null,
  policyResolved: PartOneCommittedEvent["authoritativeNpcReactions"],
): PartOneCommittedEvent["authoritativeNpcReactions"] {
  if (!contract || contract.reactionAction.actionKind !== "NPC_RESPONSE") {
    return policyResolved;
  }
  const policyAssetId = policyResolved[0]?.policyAssetId
    || `SETTLED-REACTION:${contract.sourceActionId}`;
  return [{
    reactionEventId: `REACTION-${contract.sourceEventId}`,
    actorRefs: [...contract.responderActorIds],
    action: contract.reactionAction.visibleAction,
    policyAssetId,
  }];
}

export function buildPartOneUnboundActionNarrativeSource(
  input: BuildPartOneUnboundNarrativeSourceInput,
): PartOneUnboundActionNarrativeSource {
  validateParsingResult(input.parsingResult);
  validateCapabilityValidation(input.capabilityValidation);
  validateSettlementResult(input.settlementResult, input.sourceEventId);
  validateMaterialPolicy(input.materialEffectPolicy);
  if (input.capabilityValidation.status !== "AUTHORIZED") {
    fail("UNBOUND_CAPABILITY_NOT_AUTHORIZED");
  }
  if (
    !input.capabilityValidation.capabilityIds.length
    && !input.capabilityValidation.validatedConstraintIds.length
  ) {
    fail("UNBOUND_VALIDATION_SOURCE_MISSING");
  }
  assertSubset(
    input.parsingResult.requestedStatePaths,
    input.capabilityValidation.allowedStatePaths,
    "UNBOUND_REQUESTED_STATE_PATH_NOT_AUTHORIZED",
  );
  assertSubset(
    input.parsingResult.requestedDurableEffectTypes,
    input.capabilityValidation.allowedDurableEffectTypes,
    "UNBOUND_REQUESTED_DURABLE_EFFECT_NOT_AUTHORIZED",
  );
  assertSubset(
    input.parsingResult.requestedStatePaths,
    input.materialEffectPolicy.allowedStatePaths,
    "UNBOUND_REQUESTED_STATE_PATH_OUTSIDE_MATERIAL_POLICY",
  );
  assertSubset(
    input.parsingResult.requestedDurableEffectTypes,
    input.materialEffectPolicy.allowedDurableEffectTypes,
    "UNBOUND_REQUESTED_DURABLE_EFFECT_OUTSIDE_MATERIAL_POLICY",
  );
  assertDisjoint(
    input.parsingResult.requestedStatePaths,
    input.materialEffectPolicy.forbiddenStatePaths,
    "UNBOUND_REQUESTED_FORBIDDEN_STATE_PATH",
  );
  assertDisjoint(
    input.parsingResult.requestedDurableEffectTypes,
    input.materialEffectPolicy.forbiddenDurableEffectTypes,
    "UNBOUND_REQUESTED_FORBIDDEN_DURABLE_EFFECT",
  );
  assertSubset(
    input.settlementResult.changedStatePaths,
    input.capabilityValidation.allowedStatePaths,
    "UNBOUND_SETTLEMENT_STATE_PATH_NOT_AUTHORIZED",
  );
  assertSubset(
    input.settlementResult.durableEffectTypes,
    input.capabilityValidation.allowedDurableEffectTypes,
    "UNBOUND_SETTLEMENT_DURABLE_EFFECT_NOT_AUTHORIZED",
  );
  assertSubset(
    input.settlementResult.changedStatePaths,
    input.materialEffectPolicy.allowedStatePaths,
    "UNBOUND_STATE_PATH_OUTSIDE_MATERIAL_POLICY",
  );
  assertSubset(
    input.settlementResult.durableEffectTypes,
    input.materialEffectPolicy.allowedDurableEffectTypes,
    "UNBOUND_DURABLE_EFFECT_OUTSIDE_MATERIAL_POLICY",
  );
  assertDisjoint(
    input.settlementResult.changedStatePaths,
    input.materialEffectPolicy.forbiddenStatePaths,
    "UNBOUND_FORBIDDEN_STATE_PATH",
  );
  assertDisjoint(
    input.settlementResult.durableEffectTypes,
    input.materialEffectPolicy.forbiddenDurableEffectTypes,
    "UNBOUND_FORBIDDEN_DURABLE_EFFECT",
  );
  const activeActorIds = new Set(input.currentScene.presentActorRefs);
  const actorGoals = input.actorPolicies.flatMap((asset) => {
    const goals = unique([
      String(asset.payload.goal || ""),
      String(asset.payload.dramaticFunction || ""),
    ]);
    return asset.actorRefs
      .filter((actorId) => activeActorIds.has(actorId))
      .flatMap((actorId) => (
        goals.length ? [{ actorId, sourceAssetIds: [asset.assetId], goals }] : []
      ));
  });
  const settled = input.settledReactionContract;
  const policyReaction = input.policyResolvedReactions[0];
  const visibleReactionSource = settled
    ? {
      sourceKind: "SETTLED_REACTION_CONTRACT" as const,
      sourceId: settled.sourceEventId,
      responderActorIds: [...settled.responderActorIds],
      visibleAction: settled.reactionAction.visibleAction,
    }
    : policyReaction
      ? {
        sourceKind: "POLICY_REACTION" as const,
        sourceId: policyReaction.reactionEventId,
        responderActorIds: [...policyReaction.actorRefs],
        visibleAction: policyReaction.action,
      }
      : {
        sourceKind: "NONE" as const,
        sourceId: null,
        responderActorIds: [] as [],
        visibleAction: null,
      };
  return {
    schemaVersion: "unbound-action-narrative-source-v1",
    sourceEventId: required(input.sourceEventId, "UNBOUND_SOURCE_EVENT_ID_MISSING"),
    sourceActionId: required(input.sourceActionId, "UNBOUND_SOURCE_ACTION_ID_MISSING"),
    actionText: required(input.actionText, "UNBOUND_ACTION_TEXT_MISSING"),
    parsingResult: structuredClone(input.parsingResult),
    capabilityValidation: structuredClone(input.capabilityValidation),
    settlementResult: structuredClone(input.settlementResult),
    currentScene: structuredClone(input.currentScene),
    actorGoals,
    materialEffectPolicy: structuredClone(input.materialEffectPolicy),
    visibleReactionSource,
    resultCeiling: required(input.resultCeiling, "UNBOUND_RESULT_CEILING_MISSING"),
    forbiddenEscalations: unique([
      ...input.forbiddenEscalations,
      ...DEFAULT_FORBIDDEN_ESCALATIONS,
    ]),
  };
}

function validateReactionAction(action: PartOneSettledReactionTemplate["reactionAction"]) {
  if (!["NPC_RESPONSE", "WORLD_RESPONSE"].includes(action.actionKind)) {
    fail("REACTION_ACTION_KIND_INVALID");
  }
  uniqueStrings(action.targetEntityIds, "REACTION_TARGET_IDS_INVALID");
  const visibleActionSource = action.visibleActionSource || "AUTHORED";
  if (!["AUTHORED", "REACTION_WORKING_SET"].includes(visibleActionSource)) {
    fail("REACTION_VISIBLE_ACTION_SOURCE_INVALID");
  }
  if (visibleActionSource === "AUTHORED") {
    required(String(action.visibleAction || ""), "REACTION_VISIBLE_ACTION_MISSING");
  }
  if (!action.parameterBindings || typeof action.parameterBindings !== "object") {
    fail("REACTION_PARAMETER_BINDINGS_INVALID");
  }
}

function validateParsingResult(value: PartOneUnboundActionParsingResult) {
  if (value.schemaVersion !== "unbound-action-parsing-result-v1") {
    fail("UNBOUND_PARSING_SCHEMA_INVALID");
  }
  required(value.parserId, "UNBOUND_PARSER_ID_MISSING");
  required(value.intentKind, "UNBOUND_INTENT_KIND_MISSING");
  required(value.actorId, "UNBOUND_ACTOR_ID_MISSING");
  uniqueStrings(value.targetEntityIds, "UNBOUND_TARGET_IDS_INVALID");
  uniqueStrings(value.requestedStatePaths, "UNBOUND_REQUESTED_PATHS_INVALID");
  uniqueStrings(value.requestedDurableEffectTypes, "UNBOUND_REQUESTED_DURABLE_EFFECTS_INVALID");
}

function validateCapabilityValidation(value: PartOneUnboundCapabilityValidation) {
  if (value.schemaVersion !== "unbound-capability-validation-v1") {
    fail("UNBOUND_CAPABILITY_SCHEMA_INVALID");
  }
  if (!["AUTHORIZED", "REJECTED"].includes(value.status)) {
    fail("UNBOUND_CAPABILITY_STATUS_INVALID");
  }
  uniqueStrings(value.capabilityIds, "UNBOUND_CAPABILITY_IDS_INVALID");
  uniqueStrings(value.validatedConstraintIds, "UNBOUND_CONSTRAINT_IDS_INVALID");
  uniqueStrings(value.allowedStatePaths, "UNBOUND_ALLOWED_PATHS_INVALID");
  uniqueStrings(value.allowedDurableEffectTypes, "UNBOUND_ALLOWED_DURABLE_EFFECTS_INVALID");
}

function validateSettlementResult(
  value: PartOneUnboundSettlementResult,
  sourceEventId: string,
) {
  if (value.schemaVersion !== "unbound-settlement-result-v1") {
    fail("UNBOUND_SETTLEMENT_SCHEMA_INVALID");
  }
  if (value.status !== "SETTLED") fail("UNBOUND_SETTLEMENT_NOT_SETTLED");
  if (value.settlementEventId !== sourceEventId) {
    fail("UNBOUND_SETTLEMENT_EVENT_MISMATCH");
  }
  uniqueStrings(value.changedStatePaths, "UNBOUND_CHANGED_PATHS_INVALID");
  uniqueStrings(value.durableEffectTypes, "UNBOUND_DURABLE_EFFECT_TYPES_INVALID");
  uniqueStrings(value.requiredVisibleEffects, "UNBOUND_VISIBLE_EFFECTS_INVALID");
}

function validateMaterialPolicy(value: PartOneUnboundMaterialEffectPolicy) {
  uniqueStrings(value.allowedStatePaths, "MATERIAL_ALLOWED_PATHS_INVALID");
  uniqueStrings(value.allowedDurableEffectTypes, "MATERIAL_ALLOWED_DURABLE_EFFECTS_INVALID");
  uniqueStrings(value.forbiddenStatePaths, "MATERIAL_FORBIDDEN_PATHS_INVALID");
  uniqueStrings(value.forbiddenDurableEffectTypes, "MATERIAL_FORBIDDEN_DURABLE_EFFECTS_INVALID");
}

function validateStateRule(rule: PartOneStateRule) {
  required(rule.ruleId, "REACTION_RULE_ID_MISSING");
  required(rule.statePath, "REACTION_RULE_PATH_MISSING");
  if (!["EQ", "NEQ", "IN", "NOT_NULL", "ANY_PENDING"].includes(rule.operator)) {
    fail("REACTION_RULE_OPERATOR_INVALID");
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

function assertSubset<T extends string>(actual: T[], allowed: T[], code: string) {
  const allowedSet = new Set(allowed);
  const unauthorized = actual.find((value) => !allowedSet.has(value));
  if (unauthorized) fail(`${code}:${unauthorized}`);
}

function assertDisjoint<T extends string>(actual: T[], forbidden: T[], code: string) {
  const forbiddenSet = new Set(forbidden);
  const blocked = actual.find((value) => forbiddenSet.has(value));
  if (blocked) fail(`${code}:${blocked}`);
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

function uniqueStrings(values: readonly string[], code: string) {
  if (!Array.isArray(values) || values.some((value) => !String(value).trim())) {
    fail(code);
  }
  if (new Set(values).size !== values.length) fail(`${code}:DUPLICATE`);
}

function unique<T extends string>(values: readonly T[]) {
  return [...new Set(values.map((value) => String(value).trim()).filter(Boolean))] as T[];
}

function fail(code: string): never {
  throw new Error(`PART_ONE_SETTLED_REACTION_INVALID:${code}`);
}
