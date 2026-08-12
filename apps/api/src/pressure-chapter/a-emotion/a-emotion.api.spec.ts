import assert from "node:assert/strict";
import test from "node:test";
import {
  PRESSURE_CHAPTER_SEAT_IDS_V1,
  sha256Canonical,
  type SeatIdV1,
} from "@ai-story/shared";
import {
  validateAEmotionInteractionEventV1,
  validateAEmotionViewerProjectionV1,
  type AEmotionInteractionEventV1,
} from "../../../../../packages/shared/src/pressure-chapter/a-emotion";
import { AEmotionProjectionError } from "./errors";
import { AEmotionFeedServiceV1 } from "./feed.service";
import { InMemoryAEmotionFeedRepositoryV1 } from "./fixtures";
import { FrozenAEmotionPresentationCatalogV1 } from "./presentation";
import {
  AEmotionViewerProjectorV1,
  orderAEmotionModalQueueV1,
  selectAEmotionCenterStateV1,
} from "./projector";
import type {
  AEmotionInteractionEventPortV1,
  AEmotionProjectionRecordV1,
  AEmotionViewerContextPortV1,
  AEmotionViewerProjectionPortV1,
} from "./ports";

const VIEWER: SeatIdV1 = "zhejiang_administration";
const SOURCE: SeatIdV1 = "zhejiang_governor";
const OBSERVER: SeatIdV1 = "qingliu_law";
const NOW = "2026-08-12T01:00:00.000Z";
const digest = (label: string) => sha256Canonical({ label });

const viewerContext = (seatId: SeatIdV1 = VIEWER): AEmotionViewerContextPortV1 => ({
  subjectId: `subject:${seatId}`,
  roomId: "room-ae-1",
  runId: "run-ae-1",
  viewerSeatId: seatId,
  knownFactRefs: [
    "fact.ledger.touched-by-governor-and-magistrate",
    "fact.ledger.suspected-governor",
    "fact.ledger.source-confirmed",
    "fact.ledger.original-controlled",
  ],
  authorizedEvidenceRefs: ["evidence.ledger.source", "evidence.metric.transition", "evidence.ledger.control"],
});

const RESPONSE_OPTIONS = {
  CROSS_IMPACT: [
    ["INVESTIGATE_SOURCE", "INVESTIGATE", true],
    ["PUBLIC_QUESTION", "TALK", true],
    ["DEFER", "DEFER", false],
  ],
  PROMISE_BROKEN: [
    ["RETALIATE_NOW", "TALK", true],
    ["HIDE_FOR_NOW", "PLAN", true],
    ["HANDLE_LATER", "DEFER", false],
  ],
  CRISIS: [
    ["RESPOND_NOW", "TOKEN", true],
    ["HANDLE_LATER", "DEFER", false],
    ["VIEW_DETAILS", "DEFER", false],
  ],
  STAGE_VICTORY: [
    ["CONTINUE_ADVANCE", "PLAN", true],
    ["VIEW_LATER", "DEFER", false],
    ["KEEP_LOW_PROFILE", "DEFER", false],
  ],
} as const;

function event(overrides: Partial<AEmotionInteractionEventV1> = {}): AEmotionInteractionEventV1 {
  const cardType = overrides.presentation && Object.hasOwn(overrides.presentation, "centerCardType")
    ? overrides.presentation.centerCardType
    : "CROSS_IMPACT";
  const options = cardType ? RESPONSE_OPTIONS[cardType] : [];
  const base: Omit<AEmotionInteractionEventV1, "eventHash"> = {
    schemaVersion: "a_emotion_interaction_event_v1",
    eventId: "event-hidden-1",
    roomId: "room-ae-1",
    runId: "run-ae-1",
    stageId: "N3",
    sourceCommitHash: digest("authority-commit"),
    sourceActionId: "action-hide-ledger",
    sourceSeatId: SOURCE,
    kind: "DIRECT_IMPACT",
    eventCode: "LEDGER_DELIVERY_ANOMALY",
    eventFamily: "LEDGER_FLOW",
    severity: "MAJOR",
    sharedObjectId: "original-grain-ledger",
    factRefs: [
      "fact.ledger.touched-by-governor-and-magistrate",
      "secret.ledger.actual-source",
    ],
    publicFactRefs: [],
    impacts: [
      {
        targetSeatId: VIEWER,
        visibility: "TARGET_ONLY",
        type: "GOAL_PROGRESS",
        key: "reformProgress",
        before: 0,
        after: 0,
        delta: null,
        effectCode: "REFORM_PROGRESS_STALLED",
      },
      {
        targetSeatId: VIEWER,
        visibility: "TARGET_ONLY",
        type: "STAT",
        key: "emperorTrust",
        before: 43,
        after: 37,
        delta: -6,
        effectCode: "EMPEROR_TRUST_DELTA",
      },
    ],
    audienceSpec: { type: "AFFECTED_SEATS", seatIds: [VIEWER] },
    disclosure: "HIDDEN",
    suspectedSeatIds: [],
    suspicionBasisRefs: [],
    evidenceRefs: [],
    revealOfEventId: null,
    promiseId: null,
    milestoneId: null,
    metricTransitionId: null,
    presentation: {
      recommendedPresentation: "CENTER_CARD",
      centerCardType: cardType,
      responseOptions: options.map(([code, preferredEntry, consumesManeuverOnSubmit]) => ({
        code,
        preferredEntry,
        consumesManeuverOnSubmit,
      })),
      modalTrigger: null,
    },
    occurredAt: "2026-08-12T00:00:00.000Z",
    eventSequence: 108,
    stateVersion: 1,
    idempotencyKey: "interaction:action-hide-ledger:LEDGER_DELIVERY_ANOMALY:zhejiang_administration",
    ...overrides,
  };
  return validateAEmotionInteractionEventV1({
    ...base,
    eventHash: sha256Canonical(base),
  });
}

function reveal(input: {
  prior: AEmotionInteractionEventV1;
  disclosure: "SUSPECTED" | "CONFIRMED";
  cardType?: "CROSS_IMPACT" | "PROMISE_BROKEN";
}): AEmotionInteractionEventV1 {
  const cardType = input.cardType ?? "CROSS_IMPACT";
  const confirmed = input.disclosure === "CONFIRMED";
  return event({
    eventId: confirmed ? "event-confirmed-3" : "event-suspected-2",
    kind: "REVEAL",
    eventCode: cardType === "PROMISE_BROKEN" ? "PROMISE_DELIVER_LEDGER_BROKEN" : confirmed ? "LEDGER_SOURCE_CONFIRMED" : "LEDGER_SOURCE_SUSPECTED",
    eventFamily: "LEDGER_FLOW",
    disclosure: input.disclosure,
    suspectedSeatIds: confirmed ? [] : [SOURCE],
    suspicionBasisRefs: confirmed ? [] : ["fact.ledger.suspected-governor"],
    evidenceRefs: confirmed ? ["evidence.ledger.source"] : [],
    revealOfEventId: input.prior.eventId,
    promiseId: cardType === "PROMISE_BROKEN" ? "promise-ledger-1" : null,
    factRefs: confirmed
      ? ["fact.ledger.source-confirmed"]
      : ["fact.ledger.suspected-governor"],
    impacts: input.prior.impacts,
    presentation: {
      recommendedPresentation: cardType === "PROMISE_BROKEN" ? "KEY_MODAL" : "CENTER_CARD",
      centerCardType: cardType,
      responseOptions: RESPONSE_OPTIONS[cardType].map(([code, preferredEntry, consumesManeuverOnSubmit]) => ({ code, preferredEntry, consumesManeuverOnSubmit })),
      modalTrigger: cardType === "PROMISE_BROKEN"
        ? { type: "PROMISE_BROKEN", triggerId: "promise-ledger-1", stateVersion: 3 }
        : null,
    },
    eventSequence: confirmed ? 112 : 110,
    stateVersion: confirmed ? 3 : 2,
    idempotencyKey: confirmed ? "reveal-confirmed-3" : "reveal-suspected-2",
  });
}

function modalEvent(type: "CRISIS" | "STAGE_VICTORY", sequence: number): AEmotionInteractionEventV1 {
  const crisis = type === "CRISIS";
  return event({
    eventId: crisis ? "event-crisis" : "event-victory",
    sourceActionId: crisis ? "action-risk" : "action-control-ledger",
    eventCode: crisis ? "EMPEROR_TRUST_DANGER_ENTERED" : "ORIGINAL_LEDGER_CONTROL_GAINED",
    eventFamily: crisis ? "EMPEROR_TRUST" : "STAGE_CONTROL",
    severity: "CRITICAL",
    disclosure: "CONFIRMED",
    evidenceRefs: [crisis ? "evidence.metric.transition" : "evidence.ledger.control"],
    factRefs: [crisis ? "fact.ledger.source-confirmed" : "fact.ledger.original-controlled"],
    impacts: [{
      targetSeatId: VIEWER,
      visibility: "TARGET_ONLY",
      type: crisis ? "RISK" : "GOAL_PROGRESS",
      key: crisis ? "emperorTrust" : "reformProgress",
      before: crisis ? 23 : 0,
      after: crisis ? 18 : 12,
      delta: crisis ? -5 : 12,
      effectCode: crisis ? "EMPEROR_TRUST_DANGER" : "REFORM_PROGRESS_GAIN",
    }],
    metricTransitionId: crisis ? "metric-transition-1" : null,
    milestoneId: crisis ? null : "milestone-control-ledger",
    presentation: {
      recommendedPresentation: "KEY_MODAL",
      centerCardType: type,
      responseOptions: RESPONSE_OPTIONS[type].map(([code, preferredEntry, consumesManeuverOnSubmit]) => ({ code, preferredEntry, consumesManeuverOnSubmit })),
      modalTrigger: {
        type,
        triggerId: crisis ? "metric-transition-1" : "milestone-control-ledger",
        stateVersion: 1,
      },
    },
    eventSequence: sequence,
    stateVersion: 1,
    idempotencyKey: `modal-${type.toLowerCase()}`,
  });
}

function projector() {
  return new AEmotionViewerProjectorV1(
    { async resolve() { return [OBSERVER]; } },
    new FrozenAEmotionPresentationCatalogV1(),
  );
}

async function project(
  source: AEmotionInteractionEventV1,
  priorRecord: AEmotionProjectionRecordV1 | null = null,
): Promise<AEmotionProjectionRecordV1> {
  const record = await projector().project({
    event: source as AEmotionInteractionEventPortV1,
    viewer: viewerContext(),
    priorProjection: priorRecord?.projection ?? null,
    priorAggregationKey: priorRecord?.aggregationKey ?? null,
  });
  assert.ok(record);
  validateAEmotionViewerProjectionV1(record.projection);
  return record;
}

test("HIDDEN projection is viewer-safe and unrelated seats receive nothing", async () => {
  const source = event();
  const projected = await project(source);
  const json = JSON.stringify(projected.projection);
  assert.equal(projected.projection.category, "RELATED");
  assert.equal(projected.projection.disclosure, "HIDDEN");
  assert.equal("visibleSourceSeatId" in projected.projection, false);
  assert.equal("visibleSuspectedSeatIds" in projected.projection, false);
  assert.doesNotMatch(json, /secret\.ledger|sourceActionId|audienceSpec|sourceSeatId/u);
  assert.equal(projected.projection.centerCard?.type, "CROSS_IMPACT");
  assert.equal(projected.projection.centerCard?.title, "他人的行动影响了你的处境");
  assert.equal("worldSequence" in projected.projection, false);

  const unrelated = await projector().project({
    event: source as AEmotionInteractionEventPortV1,
    viewer: viewerContext(OBSERVER),
  });
  assert.equal(unrelated, null);
});

test("reveal events preserve causal disclosure while publishing immutable event-scoped v1 projections", async () => {
  const hiddenEvent = event();
  const hidden = await project(hiddenEvent);
  const suspectedEvent = reveal({ prior: hiddenEvent, disclosure: "SUSPECTED" });
  const suspected = await project(suspectedEvent, hidden);
  assert.deepEqual(suspected.projection.visibleSuspectedSeatIds, [SOURCE]);
  assert.equal("visibleSourceSeatId" in suspected.projection, false);

  const confirmedEvent = reveal({ prior: suspectedEvent, disclosure: "CONFIRMED", cardType: "PROMISE_BROKEN" });
  const confirmed = await project(confirmedEvent, suspected);
  assert.equal(confirmed.projection.visibleSourceSeatId, SOURCE);
  assert.equal(confirmed.projection.keyModal?.priority, 200);
  assert.equal(hidden.projection.projectionVersion, 1);
  assert.equal(suspected.projection.projectionVersion, 2);
  assert.equal(confirmed.projection.projectionVersion, 3);
  assert.equal(suspected.aggregationKey, hidden.aggregationKey);
  assert.equal(confirmed.aggregationKey, suspected.aggregationKey);

  const repository = new InMemoryAEmotionFeedRepositoryV1();
  const feed = new AEmotionFeedServiceV1(repository);
  assert.equal((await feed.ingest(hidden, NOW)).status, "COMMITTED");
  assert.equal((await feed.ingest(suspected, "2026-08-12T01:00:01.000Z")).status, "COMMITTED");
  assert.equal((await feed.ingest(confirmed, "2026-08-12T01:00:02.000Z")).status, "COMMITTED");
  assert.equal(repository.aggregates.size, 1);
  assert.equal(repository.deliveries.size, 3);
  assert.deepEqual([...repository.aggregates.values()].map((aggregate) => aggregate.projection.disclosure), ["CONFIRMED"]);
  [...repository.aggregates.values()].forEach((aggregate) => {
    assert.equal(aggregate.projectionVersion, 3);
    validateAEmotionViewerProjectionV1(aggregate.projection);
  });

  // At-least-once recovery of an older event returns the latest causal
  // aggregate and never downgrades confirmed disclosure.
  const oldReplay = await feed.ingest(hidden, "2026-08-12T01:00:02.500Z");
  assert.equal(oldReplay.status, "REPLAYED");
  assert.equal(oldReplay.aggregate.projection.disclosure, "CONFIRMED");
  assert.equal(oldReplay.aggregate.projection.projectionHash, confirmed.projection.projectionHash);

  await assert.rejects(
    () => projector().project({
      event: confirmedEvent as AEmotionInteractionEventPortV1,
      viewer: viewerContext(),
      priorProjection: { ...suspected.projection, viewerSeatId: OBSERVER },
      priorAggregationKey: suspected.aggregationKey,
    }),
    (error: unknown) => error instanceof AEmotionProjectionError && error.code === "A_EMOTION_CONTEXT_MISMATCH",
  );

  const unsupportedVersion = {
    ...hidden,
    projection: { ...hidden.projection, projectionVersion: 0 },
  };
  await assert.rejects(
    () => feed.ingest(unsupportedVersion, "2026-08-12T01:00:03.000Z"),
    (error: unknown) => error instanceof AEmotionProjectionError
      && error.code === "A_EMOTION_PROJECTION_VERSION_UNSUPPORTED",
  );

  const driftedProjection = {
    ...hidden.projection,
    title: `${hidden.projection.title}:drift`,
    projectionHash: "",
  };
  driftedProjection.projectionHash = sha256Canonical((({ projectionHash: _ignored, ...body }) => body)(driftedProjection));
  await assert.rejects(
    () => feed.ingest({
      ...hidden,
      inputFingerprint: sha256Canonical({ different: "projection-content" }),
      projection: driftedProjection,
    }, "2026-08-12T01:00:04.000Z"),
    (error: unknown) => error instanceof AEmotionProjectionError
      && error.code === "A_EMOTION_IDEMPOTENCY_MISMATCH",
  );
});

test("feed applies priority, cursor scope, unread and idempotent delivery recovery", async () => {
  const repository = new InMemoryAEmotionFeedRepositoryV1();
  const feed = new AEmotionFeedServiceV1(repository);
  const ordinary = await project(event());
  const crisis = await project(modalEvent("CRISIS", 80));
  const victory = await project(modalEvent("STAGE_VICTORY", 120));
  await feed.ingest(ordinary, NOW);
  await feed.ingest(victory, "2026-08-12T01:00:01.000Z");
  await feed.ingest(crisis, "2026-08-12T01:00:02.000Z");

  const first = await feed.list({ roomId: "room-ae-1", runId: "run-ae-1", viewerSeatId: VIEWER, limit: 1 });
  assert.equal(first.items[0]?.centerCard?.type, "CRISIS");
  assert.equal(first.unreadCount, 3);
  assert.ok(first.nextCursor);
  const second = await feed.list({ roomId: "room-ae-1", runId: "run-ae-1", viewerSeatId: VIEWER, cursor: first.nextCursor, limit: 2 });
  assert.deepEqual(second.items.map((item) => item.centerCard?.type), ["STAGE_VICTORY", "CROSS_IMPACT"]);

  const liveFirst = await feed.listAfterSequence({
    roomId: "room-ae-1",
    runId: "run-ae-1",
    viewerSeatId: VIEWER,
    afterSequence: 0,
    limit: 2,
  });
  assert.deepEqual(liveFirst.items.map((item) => item.eventSequence), [80, 108]);
  assert.equal(liveFirst.nextAfterSequence, 108);
  assert.equal(liveFirst.currentServerSequence, 120);
  assert.equal(liveFirst.hasMore, true);
  const liveSecond = await feed.listAfterSequence({
    roomId: "room-ae-1",
    runId: "run-ae-1",
    viewerSeatId: VIEWER,
    afterSequence: liveFirst.nextAfterSequence,
    limit: 2,
  });
  assert.deepEqual(liveSecond.items.map((item) => item.eventSequence), [120]);
  assert.equal(liveSecond.nextAfterSequence, 120);
  assert.equal(liveSecond.hasMore, false);

  await assert.rejects(
    () => feed.list({ roomId: "room-ae-1", runId: "run-ae-1", viewerSeatId: OBSERVER, cursor: first.nextCursor, limit: 2 }),
    (error: unknown) => error instanceof AEmotionProjectionError && error.code === "A_EMOTION_CURSOR_INVALID",
  );

  const crisisItem = first.items[0]!;
  const mark = {
    eventId: crisisItem.eventId,
    projectionVersion: crisisItem.projectionVersion,
    roomId: "room-ae-1",
    runId: "run-ae-1",
    viewerSeatId: VIEWER,
    operation: "SEEN" as const,
    occurredAt: "2026-08-12T01:00:03.000Z",
  };
  assert.equal((await feed.mark(mark)).seenAt, mark.occurredAt);
  assert.equal((await feed.mark({ ...mark, occurredAt: "2026-08-12T01:00:04.000Z" })).seenAt, mark.occurredAt);
  await assert.rejects(
    () => feed.mark({ ...mark, projectionVersion: 2 }),
    (error: unknown) => error instanceof AEmotionProjectionError
      && error.code === "A_EMOTION_PROJECTION_VERSION_UNSUPPORTED",
  );
  assert.equal((await feed.list({ roomId: "room-ae-1", runId: "run-ae-1", viewerSeatId: VIEWER })).unreadCount, 2);

  const writes = repository.aggregateWrites;
  assert.equal((await feed.ingest(ordinary, "2026-08-12T01:01:00.000Z")).status, "REPLAYED");
  assert.equal(repository.aggregateWrites, writes);
  await assert.rejects(
    () => feed.ingest({ ...ordinary, inputFingerprint: digest("different-input") }, NOW),
    (error: unknown) => error instanceof AEmotionProjectionError && error.code === "A_EMOTION_IDEMPOTENCY_MISMATCH",
  );

  const orderingRepository = new InMemoryAEmotionFeedRepositoryV1();
  const orderingFeed = new AEmotionFeedServiceV1(orderingRepository);
  const olderMajorRelated = await project(event({ eventId: "event-related-major", eventSequence: 10, idempotencyKey: "related-major" }));
  const newerPublic = await project(event({
    eventId: "event-public-newer",
    kind: "PUBLIC_ACTION",
    eventCode: "LEDGER_COPY_DELIVERED",
    eventFamily: "PUBLIC_LEDGER_DELIVERY",
    sharedObjectId: "public-ledger-copy",
    eventSequence: 999,
    idempotencyKey: "public-newer",
    presentation: {
      recommendedPresentation: "FEED_ONLY",
      centerCardType: null,
      responseOptions: [],
      modalTrigger: null,
    },
  }));
  await orderingFeed.ingest(newerPublic, NOW);
  await orderingFeed.ingest(olderMajorRelated, "2026-08-12T01:02:00.000Z");
  const priorityOrder = await orderingFeed.list({ roomId: "room-ae-1", runId: "run-ae-1", viewerSeatId: VIEWER });
  assert.deepEqual(priorityOrder.items.map((entry) => entry.eventId), ["event-related-major", "event-public-newer"]);
});

test("central state and modal queues enforce the frozen five-state priority", async () => {
  assert.equal(selectAEmotionCenterStateV1([
    { type: "DECISION" },
    { type: "CROSS_IMPACT" },
    { type: "STAGE_VICTORY" },
    { type: "PROMISE_BROKEN" },
    { type: "CRISIS" },
    { type: "UNKNOWN" },
  ])?.type, "CRISIS");
  assert.deepEqual(orderAEmotionModalQueueV1([
    { id: "victory", priority: 100 },
    { id: "crisis", priority: 300 },
    { id: "promise", priority: 200 },
    { id: "crisis", priority: 300 },
  ]).map((item) => item.id), ["crisis", "promise", "victory"]);

  const unknown = event({ eventId: "unknown", eventCode: "UNKNOWN_EVENT_CODE", idempotencyKey: "unknown" });
  await assert.rejects(
    () => projector().project({ event: unknown as AEmotionInteractionEventPortV1, viewer: viewerContext() }),
    (error: unknown) => error instanceof AEmotionProjectionError && error.code === "A_EMOTION_PRESENTATION_UNSUPPORTED",
  );
});

test("the A-Emotion read side has no authority or Provider mutation surface", () => {
  const sourceFiles = [
    AEmotionViewerProjectorV1.toString(),
    AEmotionFeedServiceV1.toString(),
    FrozenAEmotionPresentationCatalogV1.toString(),
  ].join("\n");
  assert.doesNotMatch(sourceFiles, /worldSequence|ChapterSettlement|Finale|Provider|Narrative/u);
  assert.equal(PRESSURE_CHAPTER_SEAT_IDS_V1.length, 6);
});
