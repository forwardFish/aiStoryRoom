import {
  ACCESS_STATES,
  ACTION_WINDOW_STATUSES,
  GAME_PROJECTION_SCHEMA_VERSION,
  RESULT_PROJECTION_SCHEMA_VERSION,
  ROLE_CONTROL_MODES,
  type AccessState,
  type ActionWindowStatus,
  type RoleControlMode,
  isOneOf
} from "./constants";
import { fail, integerAtLeast, isRecord, nonEmptyString, onlyKeys, pass, type ValidationResult } from "./schema-utils";
import type { CreditControlProjection } from "./credit-control.schemas";

export type ProjectedActionCardV1 = {
  actionKey: string;
  title: string;
  description: string;
  targetRoleIds: string[];
  leverageKeys: string[];
};

export type RoleControlProjectionV1 = {
  roleId: string;
  mode: RoleControlMode;
  presence: "ONLINE" | "ABSENT" | "AI_CONTROLLED" | "SYSTEM";
  epoch: number;
  reclaimPolicy?: "IMMEDIATE" | "NEXT_WINDOW" | "NOT_AVAILABLE";
  effectiveFromSlot?: string | null;
};

export type PublicRoleControllerStateV1 = {
  roleId: string;
  controllerKind: "HUMAN" | "AI" | "SYSTEM";
  presence: "ONLINE" | "ABSENT" | "AI_CONTROLLED" | "SYSTEM";
};

export type PendingReactionProjectionV1 = {
  eventId: string;
  sourceRoleName: string;
  triggerActionTitle: string;
  expiresAt: string;
  options: Array<{ actionKey: string; title: string }>;
};

export type GameProjectionV1 = {
  schemaVersion: typeof GAME_PROJECTION_SCHEMA_VERSION;
  projectionRevision: number;
  appliedThroughDeliverySequence: number;
  generatedAt: string;
  roomSummary: Record<string, unknown>;
  run: { runId: string; engineVersion: string; strategyVersion: string; status: string; stageIndex: number };
  currentNode: Record<string, unknown> | null;
  actionWindow: ({ id: string; status: ActionWindowStatus; openingSnapshotVersion: number | null } & Record<string, unknown>) | null;
  serverNow: string;
  player: Record<string, unknown>;
  myControl: RoleControlProjectionV1;
  roleControllerStates: PublicRoleControllerStateV1[];
  privateBrief: Record<string, unknown> | null;
  availableMainActions: ProjectedActionCardV1[];
  myActions: Record<string, unknown>[];
  availableManeuvers: ProjectedActionCardV1[];
  pendingReaction: PendingReactionProjectionV1 | null;
  observableTraces: Record<string, unknown>[];
  observablePlayerStates: Record<string, unknown>[];
  latestPersonalResult: Record<string, unknown> | null;
  latestPublicResult: Record<string, unknown> | null;
  access: {
    state: AccessState;
    requiresUnlock: boolean;
    requiredCredits: number;
    canCurrentUserUnlock: boolean;
    payerUserId?: string;
    unlockEndpoint: string | null;
  };
  creditControl: CreditControlProjection;
  resultReady: boolean;
  resultUrl: string | null;
};

export type ResultProjectionV1 = {
  schemaVersion: typeof RESULT_PROJECTION_SCHEMA_VERSION;
  roomSummary: Record<string, unknown>;
  run: { runId: string; engineVersion: string; strategyVersion: string; completedAt: string };
  publicEnding: Record<string, unknown>;
  personalEnding: Record<string, unknown>;
  myKeyDecisions: Record<string, unknown>[];
  authorizedCrossImpacts: Record<string, unknown>[];
  myControlTimeline: Record<string, unknown>[];
  creditsSummary: Record<string, unknown>;
};

const gameProjectionKeys = [
  "schemaVersion", "projectionRevision", "appliedThroughDeliverySequence", "generatedAt", "roomSummary", "run", "currentNode", "actionWindow",
  "serverNow", "player", "myControl", "roleControllerStates", "privateBrief", "availableMainActions", "myActions", "availableManeuvers",
  "pendingReaction", "observableTraces", "observablePlayerStates", "latestPersonalResult", "latestPublicResult", "access", "creditControl", "resultReady", "resultUrl"
] as const;

export function validateGameProjectionV1(value: unknown): ValidationResult<GameProjectionV1> {
  if (!isRecord(value)) return fail(["game projection must be an object"]);
  const errors = onlyKeys(value, gameProjectionKeys);
  if (value.schemaVersion !== GAME_PROJECTION_SCHEMA_VERSION) errors.push("invalid schemaVersion");
  if (!integerAtLeast(value.projectionRevision, 1)) errors.push("projectionRevision must be >= 1");
  if (!integerAtLeast(value.appliedThroughDeliverySequence, 0)) errors.push("appliedThroughDeliverySequence must be >= 0");
  for (const key of ["generatedAt", "serverNow"] as const) if (!nonEmptyString(value[key])) errors.push(`${key} is required`);
  for (const key of ["roomSummary", "run", "player", "myControl", "access", "creditControl"] as const) if (!isRecord(value[key])) errors.push(`${key} must be an object`);
  for (const key of ["roleControllerStates", "availableMainActions", "myActions", "availableManeuvers", "observableTraces", "observablePlayerStates"] as const) if (!Array.isArray(value[key])) errors.push(`${key} must be an array`);
  if (typeof value.resultReady !== "boolean") errors.push("resultReady must be boolean");
  if (value.resultUrl !== null && typeof value.resultUrl !== "string") errors.push("resultUrl must be string or null");
  if (isRecord(value.access) && !isOneOf(ACCESS_STATES, value.access.state)) errors.push("invalid access.state");
  if (isRecord(value.myControl) && !isOneOf(ROLE_CONTROL_MODES, value.myControl.mode)) errors.push("invalid myControl.mode");
  if (isRecord(value.actionWindow) && !isOneOf(ACTION_WINDOW_STATUSES, value.actionWindow.status)) errors.push("invalid actionWindow.status");
  return errors.length ? fail(errors) : pass(value as GameProjectionV1);
}

export function canApplyGameProjection(
  current: Pick<GameProjectionV1, "projectionRevision" | "appliedThroughDeliverySequence"> | null,
  incoming: Pick<GameProjectionV1, "projectionRevision" | "appliedThroughDeliverySequence">
): boolean {
  if (!current) return true;
  if (incoming.projectionRevision <= current.projectionRevision) return false;
  return incoming.appliedThroughDeliverySequence >= current.appliedThroughDeliverySequence;
}

export const gameProjectionJsonSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: GAME_PROJECTION_SCHEMA_VERSION,
  type: "object",
  additionalProperties: false,
  required: gameProjectionKeys,
  properties: Object.fromEntries(gameProjectionKeys.map((key) => [key, {}]))
} as const;

export const resultProjectionJsonSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: RESULT_PROJECTION_SCHEMA_VERSION,
  type: "object",
  additionalProperties: false,
  required: ["schemaVersion", "roomSummary", "run", "publicEnding", "personalEnding", "myKeyDecisions", "authorizedCrossImpacts", "myControlTimeline", "creditsSummary"],
  properties: {
    schemaVersion: { const: RESULT_PROJECTION_SCHEMA_VERSION }, roomSummary: { type: "object" }, run: { type: "object" }, publicEnding: { type: "object" },
    personalEnding: { type: "object" }, myKeyDecisions: { type: "array" }, authorizedCrossImpacts: { type: "array" }, myControlTimeline: { type: "array" }, creditsSummary: { type: "object" }
  }
} as const;
