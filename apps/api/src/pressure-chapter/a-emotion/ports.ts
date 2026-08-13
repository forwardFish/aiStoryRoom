import type { SeatIdV1 } from "@ai-story/shared";

export type AEmotionDisclosurePortV1 = "HIDDEN" | "SUSPECTED" | "CONFIRMED";
export type AEmotionCategoryPortV1 = "RELATED" | "PUBLIC" | "SUSPICIOUS";
export type AEmotionSeverityPortV1 = "MINOR" | "MAJOR" | "CRITICAL";
export type AEmotionCardTypePortV1 = "CROSS_IMPACT" | "PROMISE_BROKEN" | "CRISIS" | "STAGE_VICTORY";
export type AEmotionWorkbenchPortV1 = "TALK" | "INVESTIGATE" | "TOKEN" | "PLAN" | "DEFER";

/**
 * Minimal structural port implemented by the validated shared
 * AEmotionInteractionEventV1 contract. Keeping this port local avoids making
 * the API own or mutate the canonical contract.
 */
export interface AEmotionInteractionEventPortV1 {
  schemaVersion: "a_emotion_interaction_event_v1";
  eventId: string;
  roomId: string;
  runId: string;
  stageId: string;
  sourceCommitHash: string;
  sourceActionId: string;
  sourceSeatId: SeatIdV1;
  kind: "PUBLIC_ACTION" | "DIRECT_IMPACT" | "OBSERVABLE_TRACE" | "REVEAL";
  eventCode: string;
  eventFamily: string;
  severity: AEmotionSeverityPortV1;
  sharedObjectId: string | null;
  factRefs: string[];
  publicFactRefs: string[];
  impacts: Array<{
    targetSeatId: SeatIdV1;
    visibility: "TARGET_ONLY" | "PUBLIC";
    type: "STAT" | "RESOURCE" | "GOAL_PROGRESS" | "ACTION_OPTION" | "RISK" | "SHARED_OBJECT";
    key: string;
    before: string | number | null;
    after: string | number | null;
    delta: number | null;
    effectCode: string;
  }>;
  audienceSpec:
    | { type: "PUBLIC_RELEVANT_SEATS" | "AFFECTED_SEATS" | "EXPLICIT"; seatIds: SeatIdV1[] }
    | { type: "OBSERVERS"; resolverCode: string; contextRefs: string[] };
  disclosure: AEmotionDisclosurePortV1;
  suspectedSeatIds: SeatIdV1[];
  suspicionBasisRefs: string[];
  evidenceRefs: string[];
  revealOfEventId: string | null;
  promiseId: string | null;
  milestoneId: string | null;
  metricTransitionId: string | null;
  presentation: {
    recommendedPresentation: "FEED_ONLY" | "CENTER_CARD" | "KEY_MODAL";
    centerCardType: AEmotionCardTypePortV1 | null;
    responseOptions: Array<{
      code: string;
      preferredEntry: AEmotionWorkbenchPortV1;
      consumesManeuverOnSubmit: boolean;
    }>;
    modalTrigger: {
      type: "PROMISE_BROKEN" | "CRISIS" | "STAGE_VICTORY";
      triggerId: string;
      stateVersion: number;
    } | null;
  };
  occurredAt: string;
  eventSequence: number;
  stateVersion: number;
  idempotencyKey: string;
  eventHash: string;
}

export interface AEmotionViewerContextPortV1 {
  subjectId: string;
  roomId: string;
  runId: string;
  viewerSeatId: SeatIdV1;
  knownFactRefs: string[];
  authorizedEvidenceRefs: string[];
}

export interface AEmotionObserverResolverPortV1 {
  resolve(input: {
    roomId: string;
    runId: string;
    resolverCode: string;
    contextRefs: string[];
  }): Promise<SeatIdV1[]>;
}

export interface AEmotionVisibleImpactPortV1 {
  effectCode: string;
  label: string;
  value: string;
}

export interface AEmotionCardActionPortV1 {
  code: string;
  label: string;
  preferredEntry: AEmotionWorkbenchPortV1;
  consumesManeuverOnSubmit: boolean;
}

export interface AEmotionCenterCardPortV1 {
  id: string;
  type: AEmotionCardTypePortV1;
  accent: "PURPLE" | "ORANGE_RED" | "GREEN";
  title: string;
  summary: string;
  blockA: { title: string; lines: string[] };
  blockB: { title: string; lines: string[] };
  primaryAction: AEmotionCardActionPortV1;
  secondaryAction: AEmotionCardActionPortV1;
  tertiaryAction: AEmotionCardActionPortV1;
  sourceEventId: string;
}

export interface AEmotionKeyModalPortV1 {
  id: string;
  type: "PROMISE_BROKEN" | "CRISIS" | "STAGE_VICTORY";
  priority: 100 | 200 | 300;
  serverSequence: number;
  sourceEventId: string;
  triggerId: string;
  stateVersion: number;
  dedupeKey: string;
  card: AEmotionCenterCardPortV1;
}

export interface AEmotionViewerProjectionPortV1 {
  schemaVersion: "a_emotion_viewer_projection_v1";
  eventId: string;
  projectionVersion: number;
  roomId: string;
  runId: string;
  viewerSeatId: SeatIdV1;
  category: AEmotionCategoryPortV1;
  disclosure: AEmotionDisclosurePortV1;
  severity: AEmotionSeverityPortV1;
  title: string;
  safeSummary: string;
  statusLabel: string;
  visibleImpacts: AEmotionVisibleImpactPortV1[];
  knownFactRefs: string[];
  visibleSourceSeatId?: SeatIdV1;
  visibleSuspectedSeatIds?: SeatIdV1[];
  responseOptions: AEmotionCardActionPortV1[];
  recommendedPresentation: "FEED_ONLY" | "CENTER_CARD" | "KEY_MODAL";
  centerCard: AEmotionCenterCardPortV1 | null;
  keyModal: AEmotionKeyModalPortV1 | null;
  eventSequence: number;
  occurredAt: string;
  projectionHash: string;
}

export interface AEmotionProjectionRecordV1 {
  aggregationKey: string;
  /** Latest canonical event applied to this causal aggregate. */
  latestEventId: string;
  idempotencyKey: string;
  inputFingerprint: string;
  stageId: string;
  sharedObjectId: string | null;
  eventFamily: string;
  projection: AEmotionViewerProjectionPortV1;
}

export interface AEmotionPresentationInputPortV1 {
  eventCode: string;
  disclosure: AEmotionDisclosurePortV1;
  category: AEmotionCategoryPortV1;
  cardType: AEmotionCardTypePortV1 | null;
  visibleImpacts: AEmotionVisibleImpactPortV1[];
  knownFactRefs: string[];
  responseOptions: Array<{
    code: string;
    preferredEntry: AEmotionWorkbenchPortV1;
    consumesManeuverOnSubmit: boolean;
  }>;
  eventId: string;
}

export interface AEmotionPresentationPortV1 {
  render(input: AEmotionPresentationInputPortV1): {
    title: string;
    safeSummary: string;
    actions: AEmotionCardActionPortV1[];
    card: AEmotionCenterCardPortV1 | null;
  } | null;
}

export interface AEmotionAggregateRecordV1 {
  aggregationKey: string;
  roomId: string;
  runId: string;
  viewerSeatId: SeatIdV1;
  stageId: string;
  sharedObjectId: string | null;
  eventFamily: string;
  latestEventId: string;
  projectionVersion: number;
  projection: AEmotionViewerProjectionPortV1;
  createdAt: string;
  updatedAt: string;
}

export interface AEmotionDeliveryRecordV1 {
  eventId: string;
  projectionVersion: number;
  roomId: string;
  runId: string;
  viewerSeatId: SeatIdV1;
  deliveredAt: string;
  seenAt: string | null;
  acknowledgedAt: string | null;
  resolvedAt: string | null;
  keyModalShownAt: string | null;
}

export interface AEmotionProjectionCommitPortV1 {
  idempotencyKey: string;
  inputFingerprint: string;
  expectedAggregateVersion: number;
  aggregate: AEmotionAggregateRecordV1;
  delivery: AEmotionDeliveryRecordV1;
}

export interface AEmotionMonotonicAggregatePageV1 {
  aggregates: AEmotionAggregateRecordV1[];
  hasMore: boolean;
  currentServerSequence: number;
}

export interface AEmotionFeedRepositoryPortV1 {
  readProjectionReceipt(idempotencyKey: string): Promise<{
    fingerprint: string;
    aggregationKey: string;
  } | null>;
  readAggregate(aggregationKey: string): Promise<AEmotionAggregateRecordV1 | null>;
  commitProjection(input: AEmotionProjectionCommitPortV1): Promise<
    | { status: "COMMITTED" }
    | { status: "REPLAYED"; aggregate: AEmotionAggregateRecordV1 }
    | { status: "CONFLICT" }
    | { status: "IDEMPOTENCY_MISMATCH" }
  >;
  listAggregates(input: {
    roomId: string;
    runId: string;
    viewerSeatId: SeatIdV1;
  }): Promise<AEmotionAggregateRecordV1[]>;
  listAggregatesAfterSequence(input: {
    roomId: string;
    runId: string;
    viewerSeatId: SeatIdV1;
    afterSequence: number;
    limit: number;
  }): Promise<AEmotionMonotonicAggregatePageV1>;
  readDelivery(input: {
    eventId: string;
    projectionVersion: number;
    roomId: string;
    runId: string;
    viewerSeatId: SeatIdV1;
  }): Promise<AEmotionDeliveryRecordV1 | null>;
  updateDelivery(input: {
    eventId: string;
    projectionVersion: number;
    roomId: string;
    runId: string;
    viewerSeatId: SeatIdV1;
    operation: "SEEN" | "ACKNOWLEDGED" | "RESOLVED" | "MODAL_SHOWN";
    occurredAt: string;
  }): Promise<AEmotionDeliveryRecordV1 | null>;
}
