import {
  PLAYER_ACTION_SLOTS,
  ROLE_AGENT_DECISION_SCHEMA_VERSION,
  ROLE_AGENT_POLICY_SCHEMA_VERSION,
  type PlayerActionSlot,
  isOneOf
} from "./constants";
import { fail, isRecord, nonEmptyString, nullableString, onlyKeys, pass, stringArray, type ValidationResult } from "./schema-utils";

export type WeightedGoalV1 = { goalKey: string; weight: number };
export type WeightedAssetV1 = { assetKey: string; weight: number };
export type WeightedActionTagV1 = { tag: string; weight: number };

export type RoleAgentPolicyV1 = {
  schemaVersion: typeof ROLE_AGENT_POLICY_SCHEMA_VERSION;
  roleKey: string;
  policyVersion: string;
  promptVersion: string;
  goals: WeightedGoalV1[];
  riskTolerance: number;
  assetPriorities: WeightedAssetV1[];
  actionTagWeights: WeightedActionTagV1[];
  fallbackBySlot: { MAIN: string; MANEUVER: string; REACTION: string };
};

export type RoleAgentDecisionV1 = {
  schemaVersion: typeof ROLE_AGENT_DECISION_SCHEMA_VERSION;
  taskDedupeKey: string;
  decisionKind: "ACT" | "PASS";
  chosenActionKey: string | null;
  targetRoleId: string | null;
  leverageKey: string | null;
  visibleFactIds: string[];
  shortRationale: string;
};

export type RoleAgentDecisionValidationContext = {
  taskDedupeKey: string;
  slot: PlayerActionSlot;
  availableActionKeys: readonly string[];
  authorizedTargetRoleIds: readonly string[];
  ownedLeverageKeys: readonly string[];
  visibleFactIds: readonly string[];
};

export const roleAgentPolicyJsonSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: ROLE_AGENT_POLICY_SCHEMA_VERSION,
  type: "object",
  additionalProperties: false,
  required: ["schemaVersion", "roleKey", "policyVersion", "promptVersion", "goals", "riskTolerance", "assetPriorities", "actionTagWeights", "fallbackBySlot"],
  properties: {
    schemaVersion: { const: ROLE_AGENT_POLICY_SCHEMA_VERSION },
    roleKey: { type: "string", minLength: 1 },
    policyVersion: { type: "string", minLength: 1 },
    promptVersion: { type: "string", minLength: 1 },
    goals: { type: "array", items: { type: "object", additionalProperties: false, required: ["goalKey", "weight"], properties: { goalKey: { type: "string", minLength: 1 }, weight: { type: "number" } } } },
    riskTolerance: { type: "number" },
    assetPriorities: { type: "array", items: { type: "object", additionalProperties: false, required: ["assetKey", "weight"], properties: { assetKey: { type: "string", minLength: 1 }, weight: { type: "number" } } } },
    actionTagWeights: { type: "array", items: { type: "object", additionalProperties: false, required: ["tag", "weight"], properties: { tag: { type: "string", minLength: 1 }, weight: { type: "number" } } } },
    fallbackBySlot: { type: "object", additionalProperties: false, required: ["MAIN", "MANEUVER", "REACTION"], properties: { MAIN: { type: "string", minLength: 1 }, MANEUVER: { type: "string", minLength: 1 }, REACTION: { type: "string", minLength: 1 } } }
  }
} as const;

export const roleAgentDecisionJsonSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: ROLE_AGENT_DECISION_SCHEMA_VERSION,
  type: "object",
  additionalProperties: false,
  required: ["schemaVersion", "taskDedupeKey", "decisionKind", "chosenActionKey", "targetRoleId", "leverageKey", "visibleFactIds", "shortRationale"],
  properties: {
    schemaVersion: { const: ROLE_AGENT_DECISION_SCHEMA_VERSION },
    taskDedupeKey: { type: "string", minLength: 1 },
    decisionKind: { enum: ["ACT", "PASS"] },
    chosenActionKey: { type: ["string", "null"] },
    targetRoleId: { type: ["string", "null"] },
    leverageKey: { type: ["string", "null"] },
    visibleFactIds: { type: "array", uniqueItems: true, items: { type: "string", minLength: 1 } },
    shortRationale: { type: "string", minLength: 1, maxLength: 160 }
  }
} as const;

export function validateRoleAgentDecisionV1(
  value: unknown,
  context: RoleAgentDecisionValidationContext
): ValidationResult<RoleAgentDecisionV1> {
  if (!isRecord(value)) return fail(["decision must be an object"]);
  const errors = onlyKeys(value, ["schemaVersion", "taskDedupeKey", "decisionKind", "chosenActionKey", "targetRoleId", "leverageKey", "visibleFactIds", "shortRationale"]);
  if (value.schemaVersion !== ROLE_AGENT_DECISION_SCHEMA_VERSION) errors.push("invalid schemaVersion");
  if (value.taskDedupeKey !== context.taskDedupeKey) errors.push("taskDedupeKey does not match the current task");
  if (value.decisionKind !== "ACT" && value.decisionKind !== "PASS") errors.push("invalid decisionKind");
  if (!nullableString(value.chosenActionKey)) errors.push("chosenActionKey must be a non-empty string or null");
  if (!nullableString(value.targetRoleId)) errors.push("targetRoleId must be a non-empty string or null");
  if (!nullableString(value.leverageKey)) errors.push("leverageKey must be a non-empty string or null");
  if (!stringArray(value.visibleFactIds)) errors.push("visibleFactIds must be a string array");
  if (!nonEmptyString(value.shortRationale) || value.shortRationale.length > 160) errors.push("shortRationale must be 1..160 characters");

  if (value.decisionKind === "PASS") {
    if (context.slot !== "MANEUVER") errors.push("PASS is allowed only for MANEUVER");
    if (value.chosenActionKey !== null || value.targetRoleId !== null || value.leverageKey !== null) errors.push("PASS cannot include action, target or leverage");
  }
  if (value.decisionKind === "ACT") {
    if (!nonEmptyString(value.chosenActionKey) || !context.availableActionKeys.includes(value.chosenActionKey)) errors.push("chosenActionKey is not available");
    if (value.targetRoleId !== null && (!nonEmptyString(value.targetRoleId) || !context.authorizedTargetRoleIds.includes(value.targetRoleId))) errors.push("targetRoleId is not authorized");
    if (value.leverageKey !== null && (!nonEmptyString(value.leverageKey) || !context.ownedLeverageKeys.includes(value.leverageKey))) errors.push("leverageKey is not owned");
  }
  if (Array.isArray(value.visibleFactIds) && value.visibleFactIds.some((factId) => typeof factId !== "string" || !context.visibleFactIds.includes(factId))) errors.push("visibleFactIds contains an unauthorized fact");
  if (!isOneOf(PLAYER_ACTION_SLOTS, context.slot)) errors.push("invalid slot");
  return errors.length ? fail(errors) : pass(value as RoleAgentDecisionV1);
}
