import { createHash } from "node:crypto";
import {
  validateB0RoomRulesetV1,
  type B0BatchStatusV1,
  type B0FeatureFlagsV1,
  type B0RoomRulesetV1,
  type B0SettlementModeV1,
  type B0WindowStatusV1,
} from "@ai-story/shared";

const WINDOW_TRANSITIONS: Readonly<Record<B0WindowStatusV1, readonly B0WindowStatusV1[]>> = Object.freeze({
  OPEN: ["LOCKED", "ABORTED"],
  LOCKED: ["SETTLING", "ABORTED"],
  SETTLING: ["COMMITTED", "FAILED_RETRYABLE", "FAILED_HARD"],
  COMMITTED: ["PUBLISHING"],
  PUBLISHING: ["COMPLETED", "COMMITTED"],
  COMPLETED: [],
  FAILED_RETRYABLE: ["SETTLING", "FAILED_HARD"],
  FAILED_HARD: [],
  ABORTED: [],
});

const BATCH_TRANSITIONS: Readonly<Record<B0BatchStatusV1, readonly B0BatchStatusV1[]>> = Object.freeze({
  PREPARED: ["RESOLVING", "FAILED_HARD"],
  RESOLVING: ["RESOLVED", "FAILED_RETRYABLE", "FAILED_HARD"],
  RESOLVED: ["COMMITTING", "FAILED_HARD"],
  COMMITTING: ["COMMITTED", "FAILED_RETRYABLE", "FAILED_HARD"],
  COMMITTED: ["PUBLISHED"],
  PUBLISHED: ["COMPLETED"],
  COMPLETED: [],
  FAILED_RETRYABLE: ["RESOLVING", "COMMITTING", "FAILED_HARD"],
  FAILED_HARD: [],
});

export type CreateB0RoomRulesetInputV1 = {
  rulesetVersion: string;
  settlementMode: B0SettlementModeV1;
  totalWindows: number;
  windowDurationSeconds: number;
  maxHumanPlayers: number;
  playerAuthoredDelayedEffects?: "DISABLED" | "NEXT_WINDOW_ONLY";
  featureFlags?: Partial<B0FeatureFlagsV1>;
};

export function createB0RoomRulesetV1(input: CreateB0RoomRulesetInputV1): Readonly<B0RoomRulesetV1> {
  const windowed = input.settlementMode === "WINDOWED";
  const flags: B0FeatureFlagsV1 = {
    windowedSettlementEnabled: windowed,
    structuredActionPreviewEnabled: true,
    typedAudienceV2Enabled: true,
    structuredResultEnabled: true,
    narrativeAsyncEnabled: true,
    reactionWindowEnabled: false,
    structuredCommitmentEnabled: false,
    ...input.featureFlags,
  };
  const candidate: B0RoomRulesetV1 = {
    schemaVersion: "b0-room-ruleset-v1",
    rulesetVersion: input.rulesetVersion,
    settlementMode: input.settlementMode,
    totalWindows: input.totalWindows,
    windowDurationSeconds: input.windowDurationSeconds,
    maxHumanPlayers: input.maxHumanPlayers,
    maxPrimaryIntentsPerActor: 1,
    readyPolicy: "ALL_READY_OR_DEADLINE",
    missingIntentPolicy: "LAST_CONFIRMED_OR_HOLD",
    supportedRelations: ["SUPPORTS", "CONFLICTS", "INDEPENDENT"],
    reactionDepth: 0,
    playerAuthoredDelayedEffects: input.playerAuthoredDelayedEffects ?? "DISABLED",
    structuredCommitmentsEnabled: false,
    allowMidGameJoin: false,
    allowRoleTransfer: false,
    allowHumanToAiTransfer: false,
    aiFillEnabled: true,
    structuredResultRequired: true,
    narrativeFailurePolicy: "CONTINUE_WITH_STRUCTURED_RESULT",
    featureFlags: flags,
  };
  return freezeB0RoomRulesetV1(candidate);
}

export function freezeB0RoomRulesetV1(value: unknown): Readonly<B0RoomRulesetV1> {
  const validation = validateB0RoomRulesetV1(value);
  if (!validation.ok) throw new B0ContractError("ROOM_RULESET_MISMATCH", validation.errors);
  return deepFreeze(cloneValue(validation.value));
}

export function hashB0RoomRulesetV1(value: unknown): string {
  const validation = validateB0RoomRulesetV1(value);
  if (!validation.ok) throw new B0ContractError("ROOM_RULESET_MISMATCH", validation.errors);
  return hashCanonicalB0Value(validation.value);
}

export function hashCanonicalB0Value(value: unknown): string {
  const canonical = canonicalizeB0Value(value);
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

export function canonicalizeB0Value(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalizeB0Value);
  if (!isPlainRecord(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort((left, right) => left.localeCompare(right))
      .map((key) => [key, canonicalizeB0Value(value[key])]),
  );
}

export function assertB0WindowTransitionV1(from: B0WindowStatusV1, to: B0WindowStatusV1): void {
  if (!WINDOW_TRANSITIONS[from]?.includes(to)) {
    throw new B0ContractError("WINDOW_ALREADY_LOCKED", [`invalid B0 window transition: ${from} -> ${to}`]);
  }
}

export function assertB0BatchTransitionV1(from: B0BatchStatusV1, to: B0BatchStatusV1): void {
  if (!BATCH_TRANSITIONS[from]?.includes(to)) {
    throw new B0ContractError("RESOLUTION_VALIDATION_FAILED", [`invalid B0 batch transition: ${from} -> ${to}`]);
  }
}

export function isB0RulesetHashMatchV1(ruleset: unknown, expectedHash: string): boolean {
  return typeof expectedHash === "string" && expectedHash.length === 64 && hashB0RoomRulesetV1(ruleset) === expectedHash;
}

export class B0ContractError extends Error {
  constructor(
    public readonly code: "ROOM_RULESET_MISMATCH" | "WINDOW_ALREADY_LOCKED" | "RESOLUTION_VALIDATION_FAILED",
    public readonly details: readonly string[],
  ) {
    super(details.join("; "));
    this.name = "B0ContractError";
  }
}

function cloneValue<T>(value: T): T {
  if (Array.isArray(value)) return value.map((entry) => cloneValue(entry)) as T;
  if (!isPlainRecord(value)) return value;
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, cloneValue(entry)])) as T;
}

function deepFreeze<T>(value: T): T {
  if (Array.isArray(value)) {
    value.forEach((entry) => deepFreeze(entry));
    return Object.freeze(value);
  }
  if (isPlainRecord(value)) {
    Object.values(value).forEach((entry) => deepFreeze(entry));
    return Object.freeze(value);
  }
  return value;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
