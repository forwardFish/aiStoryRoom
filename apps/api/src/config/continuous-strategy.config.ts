import {
  CONTINUOUS_ENGINE_VERSION,
  LEGACY_ENGINE_VERSION,
  LEGACY_STRATEGY_VERSION
} from "@ai-story/shared";
import { findGameDefinition } from "@ai-story/templates";

export type ContinuousStrategyConfig = {
  enabledForNewRooms: boolean;
  workerEmbedded: boolean;
  roleAgentProvider: "deepseek" | "rules";
  roleAgentModel: string;
  faultInjectionAllowed: boolean;
  roleAgentFaultAt: RoleAgentFaultBoundary | null;
};

export const RESOLUTION_PHASE_TRANSACTION_TIMEOUT_MS = 30_000;
export const RESOLUTION_PHASE_LEASE_MARGIN_MS = 15_000;
export const ROLE_AGENT_PROVIDER_ATTEMPTS = 2;
export const ROLE_AGENT_PROVIDER_TOTAL_BUDGET_MS = 4_500;

export function normalizeStoryTaskLeaseMs(raw: unknown) {
  const configured = Number(raw || 30_000);
  if (!Number.isFinite(configured)) return 30_000;
  return Math.max(5_000, Math.min(300_000, Math.trunc(configured)));
}

export function normalizeResolutionTaskLeaseMs(raw: unknown) {
  return Math.max(
    normalizeStoryTaskLeaseMs(raw),
    RESOLUTION_PHASE_TRANSACTION_TIMEOUT_MS + RESOLUTION_PHASE_LEASE_MARGIN_MS
  );
}

export function normalizeRoleAgentAttemptTimeoutMs(raw: unknown) {
  const configured = Number(raw || ROLE_AGENT_PROVIDER_TOTAL_BUDGET_MS);
  if (!Number.isFinite(configured)) return ROLE_AGENT_PROVIDER_TOTAL_BUDGET_MS;
  return Math.max(250, Math.min(ROLE_AGENT_PROVIDER_TOTAL_BUDGET_MS, Math.trunc(configured)));
}

export const ROLE_AGENT_FAULT_BOUNDARIES = ["TASK_LEASED", "PROVIDER_RETURNED", "ACTION_SEALED"] as const;
export type RoleAgentFaultBoundary = typeof ROLE_AGENT_FAULT_BOUNDARIES[number];

export class InjectedCheckpointExitError extends Error {
  readonly code = "INJECTED_CHECKPOINT_EXIT";
  readonly exitCode = 86;
  readonly checkpoint: string;
  readonly taskId?: string;

  constructor(checkpoint: string, taskId?: string) {
    super(`Injected checkpoint exit at ${checkpoint}${taskId ? ` for task ${taskId}` : ""}`);
    this.name = "INJECTED_CHECKPOINT_EXIT";
    this.checkpoint = checkpoint;
    this.taskId = taskId;
  }
}

export function isInjectedCheckpointExit(error: unknown): error is Error & { code: "INJECTED_CHECKPOINT_EXIT"; exitCode?: number } {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { code?: unknown; name?: unknown };
  return candidate.code === "INJECTED_CHECKPOINT_EXIT" || candidate.name === "INJECTED_CHECKPOINT_EXIT";
}

export function maybeInjectRoleAgentFault(
  boundary: RoleAgentFaultBoundary,
  taskId?: string,
  env: NodeJS.ProcessEnv = process.env
) {
  const config = readContinuousStrategyConfig(env);
  const targetTaskId = String(env.FAIL_ROLE_AGENT_TASK_ID || "").trim();
  if (targetTaskId && targetTaskId !== taskId) return;
  if (config.roleAgentFaultAt === boundary) throw new InjectedCheckpointExitError(boundary, taskId);
}

export function readContinuousStrategyConfig(env: NodeJS.ProcessEnv = process.env): ContinuousStrategyConfig {
  const nodeEnv = String(env.NODE_ENV || "development").trim().toLowerCase();
  const enabledForNewRooms = strictBoolean(env.MULTIPLAYER_CONTINUOUS_STRATEGY_ENABLED, false, "MULTIPLAYER_CONTINUOUS_STRATEGY_ENABLED");
  const workerEmbedded = strictBoolean(
    env.STORY_WORKER_EMBEDDED ?? env.STORY_WORKER_ENABLED,
    false,
    env.STORY_WORKER_EMBEDDED === undefined && env.STORY_WORKER_ENABLED !== undefined ? "STORY_WORKER_ENABLED (deprecated)" : "STORY_WORKER_EMBEDDED"
  );
  const faultInjectionAllowed = nodeEnv === "test" || strictBoolean(env.ALLOW_FAULT_INJECTION, false, "ALLOW_FAULT_INJECTION");
  const activeFaultVariables = ["FAIL_AFTER_CHECKPOINT", "FAIL_AFTER_CHECKPOINT_RUN_ID", "FAIL_AFTER_CHECKPOINT_WINDOW_ID", "FAIL_AFTER_CHECKPOINT_STAGE", "FAIL_ROLE_AGENT_AT", "FAIL_ROLE_AGENT_TASK_ID", "STORY_TASK_TEST_DELAY_MS"].filter((key) => String(env[key] || "").trim().length > 0);
  if (nodeEnv === "production" && activeFaultVariables.length > 0) {
    throw new Error(`Fault injection variables are forbidden in production: ${activeFaultVariables.join(",")}`);
  }
  if (!faultInjectionAllowed && activeFaultVariables.length > 0) {
    throw new Error(`Fault injection is disabled: ${activeFaultVariables.join(",")}`);
  }
  const roleAgentFaultRaw = String(env.FAIL_ROLE_AGENT_AT || "").trim();
  if (roleAgentFaultRaw && !ROLE_AGENT_FAULT_BOUNDARIES.includes(roleAgentFaultRaw as RoleAgentFaultBoundary)) {
    throw new Error(`FAIL_ROLE_AGENT_AT must be one of ${ROLE_AGENT_FAULT_BOUNDARIES.join("|")}`);
  }
  if (roleAgentFaultRaw && !String(env.FAIL_ROLE_AGENT_TASK_ID || "").trim()) {
    throw new Error("FAIL_ROLE_AGENT_TASK_ID is required when FAIL_ROLE_AGENT_AT is configured");
  }

  const providerRaw = String(env.ROLE_AGENT_PROVIDER || (env.DEEPSEEK_API_KEY ? "deepseek" : "rules")).trim().toLowerCase();
  if (providerRaw !== "deepseek" && providerRaw !== "rules") throw new Error(`Unsupported ROLE_AGENT_PROVIDER: ${providerRaw}`);
  return {
    enabledForNewRooms,
    workerEmbedded,
    roleAgentProvider: providerRaw,
    roleAgentModel: String(env.ROLE_AGENT_MODEL || env.DEEPSEEK_MODEL || "deepseek-chat").trim(),
    faultInjectionAllowed,
    roleAgentFaultAt: roleAgentFaultRaw ? roleAgentFaultRaw as RoleAgentFaultBoundary : null
  };
}

export function selectRunVersions(input: {
  templateKey: string;
  mode: string;
  maxPlayers: number;
  enabledForNewRooms: boolean;
}) {
  const game = findGameDefinition(input.templateKey);
  const continuous = input.enabledForNewRooms
    && game?.status === "playable"
    && game.engine.engineVersion === CONTINUOUS_ENGINE_VERSION
    && input.mode === "room"
    && input.maxPlayers >= game.modes.minHumanPlayers
    && input.maxPlayers <= Math.min(game.modes.maxHumanPlayers, game.roles.length);
  return continuous
    ? { engineVersion: game.engine.engineVersion, strategyVersion: game.engine.strategyVersion }
    : { engineVersion: LEGACY_ENGINE_VERSION, strategyVersion: LEGACY_STRATEGY_VERSION };
}

function strictBoolean(raw: string | undefined, fallback: boolean, name: string): boolean {
  if (raw === undefined || raw.trim() === "") return fallback;
  if (raw === "true") return true;
  if (raw === "false") return false;
  throw new Error(`${name} must be exactly true or false`);
}
