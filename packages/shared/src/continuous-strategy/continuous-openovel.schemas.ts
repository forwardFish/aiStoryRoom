import {
  MODEL_CALL_BUDGET_SCHEMA_VERSION,
  OPENOVEL_ROLE_RUNTIME_MODE,
  ROLE_IMPACT_SYNC_SCHEMA_VERSION,
  ROLE_NARRATIVE_INPUT_SCHEMA_VERSION,
  ROLE_NARRATIVE_OUTPUT_SCHEMA_VERSION,
  ROLE_RUNTIME_STATUS_SCHEMA_VERSION
} from "./constants";
import { fail, integerAtLeast, isRecord, nonEmptyString, onlyKeys, pass, type ValidationResult } from "./schema-utils";

export type ContinuousOpenNovelEngineVersion = "continuous_openovel_v1";

export type RoleVisibleEventV1 = {
  schemaVersion: "role_visible_event_v1";
  id: string;
  worldSequence: number;
  type: string;
  content: string;
  sourceRoleId?: string;
};

export type RoleVisibleInteractionV1 = {
  schemaVersion: "role_visible_interaction_v1";
  id: string;
  sourceRoleId: string;
  requestKind: string;
  pressure: {
    objective: string;
    method: string;
    sourceRoleName: string;
    targetRoleName: string;
  };
  expiresAt?: string;
};

export type RoleControllerV1 = {
  schemaVersion: "role_controller_v1";
  roleId: string;
  controllerKind: "HUMAN" | "AI_AGENT" | "STANDING_POLICY" | "SYSTEM";
  controlMode: "HUMAN_ACTIVE" | "HUMAN_OFFLINE_GRACE" | "AI_ACTIVE" | "HUMAN_RECLAIM_PENDING" | "SYSTEM";
  controlEpoch: number;
};

export type RoleNarrativeInputV1 = {
  schemaVersion: typeof ROLE_NARRATIVE_INPUT_SCHEMA_VERSION;
  runtimeMode: typeof OPENOVEL_ROLE_RUNTIME_MODE;
  turnKind: "OPENING" | "RESULT";
  roomId: string;
  roleId: string;
  actorTurnId: string;
  turnIndex: number;
  baseWorldSequence: number;
  appliedWorldSequence: number | null;
  contextSnapshotHash: string;
  renderedWorkingSet: string;
  readerAction?: string;
  confirmedResolution?: string;
  visibleWorldEvents: RoleVisibleEventV1[];
  pendingInteractions: RoleVisibleInteractionV1[];
  previousCanonHash?: string;
  modelCallBudget: ModelCallBudgetV1;
  idempotencyKey: string;
};

export type RoleNarrativeOptionV1 = {
  id: string;
  label: string;
  intentProposal?: {
    objective: string;
    target: { type: "ROLE" | "PERSON" | "EVIDENCE" | "RESOURCE" | "LOCATION" | "INSTITUTION" | "PUBLIC_FRAME"; id: string; label: string };
    method: string;
    leverageKeys: string[];
    visibility: "PRIVATE" | "LIMITED" | "OBSERVABLE" | "PUBLIC";
    riskTolerance: "LOW" | "MEDIUM" | "HIGH";
    effectClaim?: "REQUEST" | "CONTEST" | "TRANSFER" | "INJURY" | "PERMANENT_REMOVAL" | "OTHER";
  };
};

export type RoleRuntimeUsageV1 = {
  narratorCalls: number;
  optionsCalls: number;
  storykeeperCalls: number;
  inputTokens: number;
  outputTokens: number;
};

export type RoleNarrativeWarningV1 = {
  code: string;
  severity: "LOW" | "MEDIUM" | "HIGH";
  blocksPlayer: false;
};

export type RoleNarrativeOutputV1 = {
  schemaVersion: typeof ROLE_NARRATIVE_OUTPUT_SCHEMA_VERSION;
  roomId: string;
  roleId: string;
  actorTurnId: string;
  narration: string;
  options: RoleNarrativeOptionV1[];
  canonHash: string;
  workspaceRevision: number;
  appliedWorldSequence: number;
  warnings: RoleNarrativeWarningV1[];
  usage: RoleRuntimeUsageV1;
};

export type RoleRuntimeStatusV1 = {
  schemaVersion: typeof ROLE_RUNTIME_STATUS_SCHEMA_VERSION;
  runtimeMode: typeof OPENOVEL_ROLE_RUNTIME_MODE;
  roomId: string;
  roleId: string;
  worldId: string;
  storyPackageVersion: string;
  workspaceRevision: number;
  appliedWorldSequence: number;
  canonHash: string | null;
};

export type RoleImpactSyncV1 = {
  schemaVersion: typeof ROLE_IMPACT_SYNC_SCHEMA_VERSION;
  runtimeMode: typeof OPENOVEL_ROLE_RUNTIME_MODE;
  roomId: string;
  roleId: string;
  actorTurnId: string;
  baseWorldSequence: number;
  appliedWorldSequence: number;
  contextSnapshotHash: string;
  renderedWorkingSet: string;
  visibleWorldEvents: RoleVisibleEventV1[];
  pendingInteractions: RoleVisibleInteractionV1[];
  previousCanonHash?: string;
  idempotencyKey: string;
};

export type ModelCallBudgetKindV1 = "NORMAL" | "AI_TARGET" | "CONVERGENCE" | "UNAFFECTED";
export type ModelCallBudgetV1 = {
  schemaVersion: typeof MODEL_CALL_BUDGET_SCHEMA_VERSION;
  kind: ModelCallBudgetKindV1;
  hardLimit: number;
  consumed: number;
};

const INPUT_KEYS = ["schemaVersion", "runtimeMode", "turnKind", "roomId", "roleId", "actorTurnId", "turnIndex", "baseWorldSequence", "appliedWorldSequence", "contextSnapshotHash", "renderedWorkingSet", "readerAction", "confirmedResolution", "visibleWorldEvents", "pendingInteractions", "previousCanonHash", "modelCallBudget", "idempotencyKey"] as const;

export function validateRoleNarrativeInputV1(value: unknown): ValidationResult<RoleNarrativeInputV1> {
  if (!isRecord(value)) return fail(["role narrative input must be an object"]);
  const errors = onlyKeys(value, INPUT_KEYS);
  if (value.schemaVersion !== ROLE_NARRATIVE_INPUT_SCHEMA_VERSION) errors.push("invalid schemaVersion");
  if (value.runtimeMode !== OPENOVEL_ROLE_RUNTIME_MODE) errors.push("invalid runtimeMode");
  if (value.turnKind !== "OPENING" && value.turnKind !== "RESULT") errors.push("turnKind must be OPENING or RESULT");
  for (const key of ["roomId", "roleId", "actorTurnId", "contextSnapshotHash", "renderedWorkingSet", "idempotencyKey"] as const) {
    if (!nonEmptyString(value[key])) errors.push(`${key} is required`);
  }
  if (!integerAtLeast(value.turnIndex, 0)) errors.push("turnIndex must be >= 0");
  if (!integerAtLeast(value.baseWorldSequence, 0)) errors.push("baseWorldSequence must be >= 0");
  if (value.appliedWorldSequence !== null && !integerAtLeast(value.appliedWorldSequence, 0)) errors.push("appliedWorldSequence must be >= 0 or null");
  if (value.turnKind === "OPENING" && value.appliedWorldSequence !== null) errors.push("OPENING appliedWorldSequence must be null");
  if (value.turnKind === "RESULT" && !integerAtLeast(value.appliedWorldSequence, 1)) errors.push("RESULT appliedWorldSequence must be >= 1");
  if (value.readerAction !== undefined && !nonEmptyString(value.readerAction)) errors.push("readerAction must be a non-empty string");
  if (value.confirmedResolution !== undefined && !nonEmptyString(value.confirmedResolution)) errors.push("confirmedResolution must be a non-empty string");
  if (value.previousCanonHash !== undefined && !nonEmptyString(value.previousCanonHash)) errors.push("previousCanonHash must be a non-empty string");
  validateVisibleEvents(value.visibleWorldEvents, errors);
  validateVisibleInteractions(value.pendingInteractions, errors);
  const budget = validateModelCallBudgetV1(value.modelCallBudget);
  if (!budget.ok) errors.push(...budget.errors.map((error) => `modelCallBudget ${error}`));
  return errors.length ? fail(errors) : pass(value as RoleNarrativeInputV1);
}

export function validateRoleNarrativeOutputV1(value: unknown): ValidationResult<RoleNarrativeOutputV1> {
  if (!isRecord(value)) return fail(["role narrative output must be an object"]);
  const errors = onlyKeys(value, ["schemaVersion", "roomId", "roleId", "actorTurnId", "narration", "options", "canonHash", "workspaceRevision", "appliedWorldSequence", "warnings", "usage"]);
  if (value.schemaVersion !== ROLE_NARRATIVE_OUTPUT_SCHEMA_VERSION) errors.push("invalid schemaVersion");
  for (const key of ["roomId", "roleId", "actorTurnId", "narration", "canonHash"] as const) if (!nonEmptyString(value[key])) errors.push(`${key} is required`);
  if (!integerAtLeast(value.workspaceRevision, 0)) errors.push("workspaceRevision must be >= 0");
  if (!integerAtLeast(value.appliedWorldSequence, 0)) errors.push("appliedWorldSequence must be >= 0");
  if (!Array.isArray(value.options) || value.options.length > 4) errors.push("options must be an array of at most 4 items");
  else value.options.forEach((option, index) => validateOption(option, index, errors));
  if (!Array.isArray(value.warnings)) errors.push("warnings must be an array");
  else value.warnings.forEach((warning, index) => validateWarning(warning, index, errors));
  validateUsage(value.usage, errors);
  return errors.length ? fail(errors) : pass(value as RoleNarrativeOutputV1);
}

export function validateRoleRuntimeStatusV1(value: unknown): ValidationResult<RoleRuntimeStatusV1> {
  if (!isRecord(value)) return fail(["role runtime status must be an object"]);
  const errors = onlyKeys(value, ["schemaVersion", "runtimeMode", "roomId", "roleId", "worldId", "storyPackageVersion", "workspaceRevision", "appliedWorldSequence", "canonHash"]);
  if (value.schemaVersion !== ROLE_RUNTIME_STATUS_SCHEMA_VERSION) errors.push("invalid schemaVersion");
  if (value.runtimeMode !== OPENOVEL_ROLE_RUNTIME_MODE) errors.push("invalid runtimeMode");
  for (const key of ["roomId", "roleId", "worldId", "storyPackageVersion"] as const) if (!nonEmptyString(value[key])) errors.push(`${key} is required`);
  if (!integerAtLeast(value.workspaceRevision, 0)) errors.push("workspaceRevision must be >= 0");
  if (!integerAtLeast(value.appliedWorldSequence, 0)) errors.push("appliedWorldSequence must be >= 0");
  if (value.canonHash !== null && !nonEmptyString(value.canonHash)) errors.push("canonHash must be a non-empty string or null");
  return errors.length ? fail(errors) : pass(value as RoleRuntimeStatusV1);
}

export function validateRoleControllerV1(value: unknown): ValidationResult<RoleControllerV1> {
  if (!isRecord(value)) return fail(["role controller must be an object"]);
  const errors = onlyKeys(value, ["schemaVersion", "roleId", "controllerKind", "controlMode", "controlEpoch"]);
  if (value.schemaVersion !== "role_controller_v1") errors.push("invalid schemaVersion");
  if (!nonEmptyString(value.roleId)) errors.push("roleId is required");
  if (!["HUMAN", "AI_AGENT", "STANDING_POLICY", "SYSTEM"].includes(String(value.controllerKind))) errors.push("controllerKind is invalid");
  if (!["HUMAN_ACTIVE", "HUMAN_OFFLINE_GRACE", "AI_ACTIVE", "HUMAN_RECLAIM_PENDING", "SYSTEM"].includes(String(value.controlMode))) errors.push("controlMode is invalid");
  if (!integerAtLeast(value.controlEpoch, 0)) errors.push("controlEpoch must be >= 0");
  return errors.length ? fail(errors) : pass(value as RoleControllerV1);
}

export function validateModelCallBudgetV1(value: unknown): ValidationResult<ModelCallBudgetV1> {
  if (!isRecord(value)) return fail(["model call budget must be an object"]);
  const errors = onlyKeys(value, ["schemaVersion", "kind", "hardLimit", "consumed"]);
  if (value.schemaVersion !== MODEL_CALL_BUDGET_SCHEMA_VERSION) errors.push("invalid schemaVersion");
  if (!["NORMAL", "AI_TARGET", "CONVERGENCE", "UNAFFECTED"].includes(String(value.kind))) errors.push("kind is invalid");
  if (!integerAtLeast(value.hardLimit, 0)) errors.push("hardLimit must be >= 0");
  if (!integerAtLeast(value.consumed, 0)) errors.push("consumed must be >= 0");
  if (integerAtLeast(value.hardLimit, 0) && integerAtLeast(value.consumed, 0) && value.consumed > value.hardLimit) errors.push("consumed exceeds hardLimit");
  return errors.length ? fail(errors) : pass(value as ModelCallBudgetV1);
}

export function validateRoleImpactSyncV1(value: unknown): ValidationResult<RoleImpactSyncV1> {
  if (!isRecord(value)) return fail(["role impact sync must be an object"]);
  const errors = onlyKeys(value, ["schemaVersion", "runtimeMode", "roomId", "roleId", "actorTurnId", "baseWorldSequence", "appliedWorldSequence", "contextSnapshotHash", "renderedWorkingSet", "visibleWorldEvents", "pendingInteractions", "previousCanonHash", "idempotencyKey"]);
  if (value.schemaVersion !== ROLE_IMPACT_SYNC_SCHEMA_VERSION) errors.push("invalid schemaVersion");
  if (value.runtimeMode !== OPENOVEL_ROLE_RUNTIME_MODE) errors.push("invalid runtimeMode");
  for (const key of ["roomId", "roleId", "actorTurnId", "contextSnapshotHash", "renderedWorkingSet", "idempotencyKey"] as const) if (!nonEmptyString(value[key])) errors.push(`${key} is required`);
  if (!integerAtLeast(value.baseWorldSequence, 0)) errors.push("baseWorldSequence must be >= 0");
  if (!integerAtLeast(value.appliedWorldSequence, 0)) errors.push("appliedWorldSequence must be >= 0");
  if (value.previousCanonHash !== undefined && !nonEmptyString(value.previousCanonHash)) errors.push("previousCanonHash must be a non-empty string");
  validateVisibleEvents(value.visibleWorldEvents, errors);
  validateVisibleInteractions(value.pendingInteractions, errors);
  return errors.length ? fail(errors) : pass(value as RoleImpactSyncV1);
}

function validateVisibleEvents(value: unknown, errors: string[]) {
  if (!Array.isArray(value)) return errors.push("visibleWorldEvents must be an array");
  value.forEach((event, index) => {
    if (!isRecord(event)) return errors.push(`visibleWorldEvents[${index}] must be an object`);
    errors.push(...onlyKeys(event, ["schemaVersion", "id", "worldSequence", "type", "content", "sourceRoleId"]).map((error) => `visibleWorldEvents[${index}] ${error}`));
    if (event.schemaVersion !== "role_visible_event_v1") errors.push(`visibleWorldEvents[${index}] invalid schemaVersion`);
    for (const key of ["id", "type", "content"] as const) if (!nonEmptyString(event[key])) errors.push(`visibleWorldEvents[${index}].${key} is required`);
    if (!integerAtLeast(event.worldSequence, 0)) errors.push(`visibleWorldEvents[${index}].worldSequence must be >= 0`);
    if (event.sourceRoleId !== undefined && !nonEmptyString(event.sourceRoleId)) errors.push(`visibleWorldEvents[${index}].sourceRoleId must be non-empty`);
  });
}

function validateVisibleInteractions(value: unknown, errors: string[]) {
  if (!Array.isArray(value)) return errors.push("pendingInteractions must be an array");
  value.forEach((interaction, index) => {
    if (!isRecord(interaction)) return errors.push(`pendingInteractions[${index}] must be an object`);
    errors.push(...onlyKeys(interaction, ["schemaVersion", "id", "sourceRoleId", "requestKind", "pressure", "expiresAt"]).map((error) => `pendingInteractions[${index}] ${error}`));
    if (interaction.schemaVersion !== "role_visible_interaction_v1") errors.push(`pendingInteractions[${index}] invalid schemaVersion`);
    for (const key of ["id", "sourceRoleId", "requestKind"] as const) if (!nonEmptyString(interaction[key])) errors.push(`pendingInteractions[${index}].${key} is required`);
    if (!isRecord(interaction.pressure)) errors.push(`pendingInteractions[${index}].pressure must be an object`);
    else {
      errors.push(...onlyKeys(interaction.pressure, ["objective", "method", "sourceRoleName", "targetRoleName"]).map((error) => `pendingInteractions[${index}].pressure ${error}`));
      for (const key of ["objective", "method", "sourceRoleName", "targetRoleName"] as const) if (!nonEmptyString(interaction.pressure[key])) errors.push(`pendingInteractions[${index}].pressure.${key} is required`);
    }
    if (interaction.expiresAt !== undefined && !nonEmptyString(interaction.expiresAt)) errors.push(`pendingInteractions[${index}].expiresAt must be non-empty`);
  });
}

function validateOption(value: unknown, index: number, errors: string[]) {
  if (!isRecord(value)) return errors.push(`options[${index}] must be an object`);
  errors.push(...onlyKeys(value, ["id", "label", "intentProposal"]).map((error) => `options[${index}] ${error}`));
  if (!nonEmptyString(value.id)) errors.push(`options[${index}].id is required`);
  if (!nonEmptyString(value.label)) errors.push(`options[${index}].label is required`);
  if (value.intentProposal !== undefined) {
    if (!isRecord(value.intentProposal)) errors.push(`options[${index}].intentProposal must be an object`);
    else validateIntentProposal(value.intentProposal, index, errors);
  }
}

function validateIntentProposal(value: Record<string, unknown>, index: number, errors: string[]) {
  errors.push(...onlyKeys(value, ["objective", "target", "method", "leverageKeys", "visibility", "riskTolerance", "effectClaim"]).map((error) => `options[${index}].intentProposal ${error}`));
  for (const key of ["objective", "method"] as const) if (!nonEmptyString(value[key])) errors.push(`options[${index}].intentProposal.${key} is required`);
  if (!Array.isArray(value.leverageKeys) || !value.leverageKeys.every(nonEmptyString)) errors.push(`options[${index}].intentProposal.leverageKeys must be a string array`);
  if (!["PRIVATE", "LIMITED", "OBSERVABLE", "PUBLIC"].includes(String(value.visibility))) errors.push(`options[${index}].intentProposal.visibility is invalid`);
  if (!["LOW", "MEDIUM", "HIGH"].includes(String(value.riskTolerance))) errors.push(`options[${index}].intentProposal.riskTolerance is invalid`);
  if (value.effectClaim !== undefined && !["REQUEST", "CONTEST", "TRANSFER", "INJURY", "PERMANENT_REMOVAL", "OTHER"].includes(String(value.effectClaim))) errors.push(`options[${index}].intentProposal.effectClaim is invalid`);
  if (!isRecord(value.target)) errors.push(`options[${index}].intentProposal.target must be an object`);
  else {
    errors.push(...onlyKeys(value.target, ["type", "id", "label"]).map((error) => `options[${index}].intentProposal.target ${error}`));
    if (!["ROLE", "PERSON", "EVIDENCE", "RESOURCE", "LOCATION", "INSTITUTION", "PUBLIC_FRAME"].includes(String(value.target.type))) errors.push(`options[${index}].intentProposal.target.type is invalid`);
    for (const key of ["id", "label"] as const) if (!nonEmptyString(value.target[key])) errors.push(`options[${index}].intentProposal.target.${key} is required`);
  }
}

function validateWarning(value: unknown, index: number, errors: string[]) {
  if (!isRecord(value)) return errors.push(`warnings[${index}] must be an object`);
  errors.push(...onlyKeys(value, ["code", "severity", "blocksPlayer"]).map((error) => `warnings[${index}] ${error}`));
  if (!nonEmptyString(value.code)) errors.push(`warnings[${index}].code is required`);
  if (!["LOW", "MEDIUM", "HIGH"].includes(String(value.severity))) errors.push(`warnings[${index}].severity is invalid`);
  if (value.blocksPlayer !== false) errors.push(`warnings[${index}].blocksPlayer must be false`);
}

function validateUsage(value: unknown, errors: string[]) {
  if (!isRecord(value)) return errors.push("usage must be an object");
  errors.push(...onlyKeys(value, ["narratorCalls", "optionsCalls", "storykeeperCalls", "inputTokens", "outputTokens"]).map((error) => `usage ${error}`));
  for (const key of ["narratorCalls", "optionsCalls", "storykeeperCalls", "inputTokens", "outputTokens"] as const) {
    if (!integerAtLeast(value[key], 0)) errors.push(`usage.${key} must be >= 0`);
  }
}
