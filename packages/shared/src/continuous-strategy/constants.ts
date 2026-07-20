export const CONTINUOUS_ENGINE_VERSION = "continuous_strategy_v1_1" as const;
export const CONTINUOUS_STORY_ENGINE_VERSION = "continuous_story_v2" as const;
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
