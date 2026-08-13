import type { SeatIdV1 } from "../contracts/domain";

export const A_EMOTION_EVENT_KINDS_V1 = Object.freeze([
  "PUBLIC_ACTION",
  "DIRECT_IMPACT",
  "OBSERVABLE_TRACE",
  "REVEAL",
] as const);

export const A_EMOTION_DISCLOSURE_LEVELS_V1 = Object.freeze([
  "HIDDEN",
  "SUSPECTED",
  "CONFIRMED",
] as const);

export const A_EMOTION_FEED_CATEGORIES_V1 = Object.freeze([
  "RELATED",
  "PUBLIC",
  "SUSPICIOUS",
] as const);

export const A_EMOTION_SEVERITIES_V1 = Object.freeze([
  "MINOR",
  "MAJOR",
  "CRITICAL",
] as const);

export const A_EMOTION_CENTER_CARD_TYPES_V1 = Object.freeze([
  "DECISION",
  "CROSS_IMPACT",
  "PROMISE_BROKEN",
  "CRISIS",
  "STAGE_VICTORY",
] as const);

export const A_EMOTION_WORKBENCH_TYPES_V1 = Object.freeze([
  "TALK",
  "INVESTIGATE",
  "TOKEN",
  "PLAN",
  "DEFER",
] as const);

export const A_EMOTION_PRESENTATIONS_V1 = Object.freeze([
  "FEED_ONLY",
  "CENTER_CARD",
  "KEY_MODAL",
] as const);

export type AEmotionEventKindV1 = (typeof A_EMOTION_EVENT_KINDS_V1)[number];
export type AEmotionDisclosureLevelV1 = (typeof A_EMOTION_DISCLOSURE_LEVELS_V1)[number];
export type AEmotionFeedCategoryV1 = (typeof A_EMOTION_FEED_CATEGORIES_V1)[number];
export type AEmotionSeverityV1 = (typeof A_EMOTION_SEVERITIES_V1)[number];
export type AEmotionCenterCardTypeV1 = (typeof A_EMOTION_CENTER_CARD_TYPES_V1)[number];
export type AEmotionWorkbenchTypeV1 = (typeof A_EMOTION_WORKBENCH_TYPES_V1)[number];
export type AEmotionRecommendedPresentationV1 = (typeof A_EMOTION_PRESENTATIONS_V1)[number];
export type AEmotionKeyModalTypeV1 = "PROMISE_BROKEN" | "CRISIS" | "STAGE_VICTORY";

export type AEmotionAudienceSpecV1 =
  | { type: "PUBLIC_RELEVANT_SEATS"; seatIds: SeatIdV1[] }
  | { type: "AFFECTED_SEATS"; seatIds: SeatIdV1[] }
  | { type: "OBSERVERS"; resolverCode: string; contextRefs: string[] }
  | { type: "EXPLICIT"; seatIds: SeatIdV1[] };

export interface AEmotionInteractionImpactV1 {
  targetSeatId: SeatIdV1;
  visibility: "TARGET_ONLY" | "PUBLIC";
  type: "STAT" | "RESOURCE" | "GOAL_PROGRESS" | "ACTION_OPTION" | "RISK" | "SHARED_OBJECT";
  key: string;
  before: string | number | null;
  after: string | number | null;
  delta: number | null;
  effectCode: string;
}

export interface AEmotionResponseOptionV1 {
  code: string;
  preferredEntry: AEmotionWorkbenchTypeV1;
  consumesManeuverOnSubmit: boolean;
}

export interface AEmotionPresentationDirectiveV1 {
  recommendedPresentation: AEmotionRecommendedPresentationV1;
  centerCardType: Exclude<AEmotionCenterCardTypeV1, "DECISION"> | null;
  responseOptions: AEmotionResponseOptionV1[];
  modalTrigger: {
    type: AEmotionKeyModalTypeV1;
    triggerId: string;
    stateVersion: number;
  } | null;
}

/**
 * Canonical input produced only after an authoritative action/settlement commit.
 * It deliberately contains no narrative text and no mutable world-state field.
 */
export interface AEmotionInteractionEventV1 {
  schemaVersion: "a_emotion_interaction_event_v1";
  eventId: string;
  roomId: string;
  runId: string;
  stageId: string;
  sourceCommitHash: string;
  sourceActionId: string;
  sourceSeatId: SeatIdV1;
  kind: AEmotionEventKindV1;
  eventCode: string;
  eventFamily: string;
  severity: AEmotionSeverityV1;
  sharedObjectId: string | null;
  factRefs: string[];
  publicFactRefs: string[];
  impacts: AEmotionInteractionImpactV1[];
  audienceSpec: AEmotionAudienceSpecV1;
  disclosure: AEmotionDisclosureLevelV1;
  suspectedSeatIds: SeatIdV1[];
  suspicionBasisRefs: string[];
  evidenceRefs: string[];
  revealOfEventId: string | null;
  promiseId: string | null;
  milestoneId: string | null;
  metricTransitionId: string | null;
  presentation: AEmotionPresentationDirectiveV1;
  occurredAt: string;
  eventSequence: number;
  stateVersion: number;
  idempotencyKey: string;
  eventHash: string;
}

export interface AEmotionVisibleImpactV1 {
  effectCode: string;
  label: string;
  value: string;
}

export interface AEmotionStateCardBlockV1 {
  title: string;
  lines: string[];
}

export interface AEmotionStateCardActionV1 {
  code: string;
  label: string;
  preferredEntry: AEmotionWorkbenchTypeV1;
  consumesManeuverOnSubmit: boolean;
}

export interface AEmotionCenterCardV1 {
  id: string;
  type: Exclude<AEmotionCenterCardTypeV1, "DECISION">;
  accent: "PURPLE" | "ORANGE_RED" | "GREEN";
  title: string;
  summary: string;
  blockA: AEmotionStateCardBlockV1;
  blockB: AEmotionStateCardBlockV1;
  primaryAction: AEmotionStateCardActionV1;
  secondaryAction: AEmotionStateCardActionV1;
  tertiaryAction: AEmotionStateCardActionV1;
  sourceEventId: string;
}

export interface AEmotionKeyModalV1 {
  id: string;
  type: AEmotionKeyModalTypeV1;
  priority: 100 | 200 | 300;
  serverSequence: number;
  sourceEventId: string;
  triggerId: string;
  stateVersion: number;
  dedupeKey: string;
  card: AEmotionCenterCardV1;
}

/** The only event shape allowed to cross the API-to-browser boundary. */
export interface AEmotionViewerProjectionV1 {
  schemaVersion: "a_emotion_viewer_projection_v1";
  eventId: string;
  projectionVersion: number;
  roomId: string;
  runId: string;
  viewerSeatId: SeatIdV1;
  category: AEmotionFeedCategoryV1;
  disclosure: AEmotionDisclosureLevelV1;
  severity: AEmotionSeverityV1;
  title: string;
  safeSummary: string;
  statusLabel: string;
  visibleImpacts: AEmotionVisibleImpactV1[];
  knownFactRefs: string[];
  visibleSourceSeatId?: SeatIdV1;
  visibleSuspectedSeatIds?: SeatIdV1[];
  responseOptions: AEmotionStateCardActionV1[];
  recommendedPresentation: AEmotionRecommendedPresentationV1;
  centerCard: AEmotionCenterCardV1 | null;
  keyModal: AEmotionKeyModalV1 | null;
  eventSequence: number;
  occurredAt: string;
  projectionHash: string;
}

export interface AEmotionFeedItemV1 extends AEmotionViewerProjectionV1 {
  isUnread: boolean;
  isAcknowledged: boolean;
  isResolved: boolean;
}

export interface AEmotionFeedPageV1 {
  schemaVersion: "a_emotion_feed_page_v1";
  roomId: string;
  runId: string;
  viewerSeatId: SeatIdV1;
  items: AEmotionFeedItemV1[];
  unreadCount: number;
  nextCursor: string | null;
  serverSequence: number;
}
