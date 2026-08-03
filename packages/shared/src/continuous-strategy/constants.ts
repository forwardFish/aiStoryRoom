export const CONTINUOUS_ENGINE_VERSION = "continuous_strategy_v1_1" as const;
export const CONTINUOUS_STORY_ENGINE_VERSION = "continuous_story_v2" as const;
export const CONTINUOUS_OPENOVEL_ENGINE_VERSION = "continuous_openovel_v1" as const;
export const OPENOVEL_ROLE_RUNTIME_MODE = "OPENOVEL_ROLE_V1" as const;
export const CONTINUOUS_ACTOR_THREAD_ENGINE_VERSIONS = [CONTINUOUS_STORY_ENGINE_VERSION, CONTINUOUS_OPENOVEL_ENGINE_VERSION] as const;

export function isContinuousActorThreadEngine(engineVersion: unknown): engineVersion is typeof CONTINUOUS_ACTOR_THREAD_ENGINE_VERSIONS[number] {
  return CONTINUOUS_ACTOR_THREAD_ENGINE_VERSIONS.includes(engineVersion as typeof CONTINUOUS_ACTOR_THREAD_ENGINE_VERSIONS[number]);
}
export const ROLE_NARRATIVE_INPUT_SCHEMA_VERSION = "role_narrative_input_v1" as const;
export const ROLE_NARRATIVE_OUTPUT_SCHEMA_VERSION = "role_narrative_output_v1" as const;
export const ROLE_RUNTIME_STATUS_SCHEMA_VERSION = "role_runtime_status_v1" as const;
export const ROLE_IMPACT_SYNC_SCHEMA_VERSION = "role_impact_sync_v1" as const;
export const MODEL_CALL_BUDGET_SCHEMA_VERSION = "model_call_budget_v1" as const;
export const CONTINUOUS_STRATEGY_VERSION = "sangtian_v1_1" as const;
export const LEGACY_ENGINE_VERSION = "legacy_v1" as const;
export const LEGACY_STRATEGY_VERSION = "legacy_v1" as const;

export const CONTINUOUS_PLAYABLE_ROLE_KEYS = [
  "zhejiang_governor",
  "xunfu",
  "county_magistrate"
] as const;
export const CONTINUOUS_SYSTEM_ROLE_KEY = "merchant" as const;

export const ACTION_SLOTS = ["MAIN", "MANEUVER", "REACTION", "SYSTEM_ACTION"] as const;
export const PLAYER_ACTION_SLOTS = ["MAIN", "MANEUVER", "REACTION"] as const;
export const ACTOR_KINDS = ["HUMAN", "AI_TAKEOVER", "SYSTEM", "TIMEOUT_FALLBACK", "LEGACY_AI"] as const;
export const ACTION_VISIBILITIES = ["PUBLIC", "OBSERVABLE", "LIMITED", "PRIVATE"] as const;
export const ROLE_CONTROL_MODES = [
  "HUMAN_ACTIVE",
  "HUMAN_OFFLINE_GRACE",
  "AI_ACTIVE",
  "HUMAN_RECLAIM_PENDING",
  "SYSTEM"
] as const;
export const ACTION_WINDOW_STATUSES = [
  "PREPARING",
  "MAIN_OPEN",
  "INTERACTION_GRACE",
  "CLOSING",
  "RESOLVING",
  "PROJECTING",
  "RESOLVED"
] as const;
export const MAIN_STATUSES = ["PENDING", "SUBMITTED", "TIMED_OUT"] as const;
export const MANEUVER_STATUSES = ["LOCKED", "AVAILABLE", "SUBMITTED", "PASSED", "EXPIRED"] as const;
export const REACTION_STATUSES = ["NOT_OPEN", "PENDING", "RESPONDED", "FALLBACK", "EXPIRED"] as const;
export const ACCESS_STATES = ["FREE", "REQUIRES_UNLOCK", "UNLOCKED"] as const;

export const GAME_PROJECTION_SCHEMA_VERSION = "continuous_game_projection_v1" as const;
export const GAME_PROJECTION_V2_SCHEMA_VERSION = "continuous_game_projection_v2" as const;
export const RESULT_PROJECTION_SCHEMA_VERSION = "continuous_result_projection_v1" as const;
export const EVENT_DELIVERY_PAGE_SCHEMA_VERSION = "continuous_event_delivery_page_v1" as const;
export const ROLE_AGENT_POLICY_SCHEMA_VERSION = "role_agent_policy_v1" as const;
export const ROLE_AGENT_DECISION_SCHEMA_VERSION = "role_agent_decision_v1" as const;

export type ActionSlot = (typeof ACTION_SLOTS)[number];
export type PlayerActionSlot = (typeof PLAYER_ACTION_SLOTS)[number];
export type ActorKind = (typeof ACTOR_KINDS)[number];
export type ActionVisibility = (typeof ACTION_VISIBILITIES)[number];
export type RoleControlMode = (typeof ROLE_CONTROL_MODES)[number];
export type ActionWindowStatus = (typeof ACTION_WINDOW_STATUSES)[number];
export type MainStatus = (typeof MAIN_STATUSES)[number];
export type ManeuverStatus = (typeof MANEUVER_STATUSES)[number];
export type ReactionStatus = (typeof REACTION_STATUSES)[number];
export type AccessState = (typeof ACCESS_STATES)[number];

export function isOneOf<T extends readonly string[]>(values: T, value: unknown): value is T[number] {
  return typeof value === "string" && (values as readonly string[]).includes(value);
}
