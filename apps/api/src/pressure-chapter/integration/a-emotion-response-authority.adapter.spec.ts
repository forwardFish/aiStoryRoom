import assert from "node:assert/strict";
import test from "node:test";
import { sha256Canonical, type SeatIdV1 } from "@ai-story/shared";
import type {
  AEmotionAggregateRecordV1,
  AEmotionDeliveryRecordV1,
  AEmotionFeedRepositoryPortV1,
} from "../a-emotion/ports";
import {
  AEmotionResponseEventAcknowledgerAdapterV1,
  AEmotionResponseEventAuthorityAdapterV1,
} from "./a-emotion-response-authority.adapter";

const ROOM = "room-response-authority";
const RUN = "run-response-authority";
const VIEWER: SeatIdV1 = "cabinet_finance";

test("response authority returns only one committed latest viewer aggregate", async () => {
  const current = aggregate("event-current", 4);
  const repository = repositoryOf([current], delivery(current));
  const authority = await new AEmotionResponseEventAuthorityAdapterV1(repository).readCurrent({
    roomId: ROOM,
    runId: RUN,
    viewerSeatId: VIEWER,
    sourceEventId: "event-current",
  });
  assert.deepEqual(authority, {
    roomId: ROOM,
    runId: RUN,
    viewerSeatId: VIEWER,
    sourceEventId: "event-current",
    projectionVersion: 4,
    projectionHash: current.projection.projectionHash,
    disclosure: "CONFIRMED",
    responseOptions: [{
      code: "RESPOND_WITH_PLAN",
      preferredEntry: "PLAN",
      consumesManeuverOnSubmit: true,
    }],
    acknowledged: true,
    resolved: false,
  });
});

test("stale, foreign, cross-seat, missing delivery and ambiguous aggregates fail closed", async () => {
  const current = aggregate("event-current", 4);
  const cases: Array<{
    aggregates: AEmotionAggregateRecordV1[];
    delivery: AEmotionDeliveryRecordV1 | null;
    sourceEventId: string;
  }> = [
    { aggregates: [current], delivery: delivery(current), sourceEventId: "event-stale" },
    { aggregates: [{ ...current, roomId: "foreign-room" }], delivery: delivery(current), sourceEventId: "event-current" },
    { aggregates: [{ ...current, runId: "foreign-run" }], delivery: delivery(current), sourceEventId: "event-current" },
    { aggregates: [{ ...current, viewerSeatId: "jiangnan_merchant" }], delivery: delivery(current), sourceEventId: "event-current" },
    { aggregates: [current], delivery: null, sourceEventId: "event-current" },
    { aggregates: [current, structuredClone(current)], delivery: delivery(current), sourceEventId: "event-current" },
  ];
  for (const item of cases) {
    const authority = await new AEmotionResponseEventAuthorityAdapterV1(
      repositoryOf(item.aggregates, item.delivery),
    ).readCurrent({
      roomId: ROOM,
      runId: RUN,
      viewerSeatId: VIEWER,
      sourceEventId: item.sourceEventId,
    });
    assert.equal(authority, null);
  }
});

test("response authority port exposes no A-Emotion or modal write capability", () => {
  const adapter = new AEmotionResponseEventAuthorityAdapterV1(repositoryOf([], null));
  assert.deepEqual(Object.getOwnPropertyNames(Object.getPrototypeOf(adapter)).sort(), [
    "constructor",
    "readCurrent",
  ]);
});

test("response acknowledgement marks only an exact current unresolved allowed source", async () => {
  const current = aggregate("event-current", 4);
  const authority = new AEmotionResponseEventAuthorityAdapterV1(
    repositoryOf([current], { ...delivery(current), acknowledgedAt: null }),
  );
  const marks: unknown[] = [];
  const acknowledger = new AEmotionResponseEventAcknowledgerAdapterV1(authority, {
    async mark(input) {
      marks.push(structuredClone(input));
      return {};
    },
  });
  assert.equal(await acknowledger.acknowledgeCurrent({
    roomId: ROOM,
    runId: RUN,
    viewerSeatId: VIEWER,
    sourceEventId: "event-current",
    responseActionCode: "RESPOND_WITH_PLAN",
    occurredAt: "2026-08-13T00:03:00.000Z",
  }), true);
  assert.deepEqual(marks, [{
    eventId: "event-current",
    projectionVersion: 4,
    roomId: ROOM,
    runId: RUN,
    viewerSeatId: VIEWER,
    operation: "ACKNOWLEDGED",
    occurredAt: "2026-08-13T00:03:00.000Z",
  }]);
});

test("response acknowledgement is idempotent and fails closed before delivery mutation", async () => {
  const current = aggregate("event-current", 4);
  const marks: unknown[] = [];
  const feed = { async mark(input: unknown) { marks.push(input); return {}; } };
  const acknowledged = new AEmotionResponseEventAcknowledgerAdapterV1(
    new AEmotionResponseEventAuthorityAdapterV1(repositoryOf([current], delivery(current))),
    feed,
  );
  const base = {
    roomId: ROOM,
    runId: RUN,
    viewerSeatId: VIEWER,
    sourceEventId: "event-current",
    responseActionCode: "RESPOND_WITH_PLAN",
    occurredAt: "2026-08-13T00:03:00.000Z",
  } as const;
  assert.equal(await acknowledged.acknowledgeCurrent(base), true);

  const unacknowledged = new AEmotionResponseEventAcknowledgerAdapterV1(
    new AEmotionResponseEventAuthorityAdapterV1(
      repositoryOf([current], { ...delivery(current), acknowledgedAt: null }),
    ),
    feed,
  );
  assert.equal(await unacknowledged.acknowledgeCurrent({
    ...base,
    sourceEventId: "event-stale",
  }), false);
  assert.equal(await unacknowledged.acknowledgeCurrent({
    ...base,
    responseActionCode: "UNAUTHORIZED_RESPONSE",
  }), false);
  const resolved = new AEmotionResponseEventAcknowledgerAdapterV1(
    new AEmotionResponseEventAuthorityAdapterV1(repositoryOf(
      [current],
      { ...delivery(current), acknowledgedAt: null, resolvedAt: "2026-08-13T00:02:30.000Z" },
    )),
    feed,
  );
  assert.equal(await resolved.acknowledgeCurrent(base), false);
  assert.deepEqual(marks, []);
});

function aggregate(eventId: string, projectionVersion: number): AEmotionAggregateRecordV1 {
  return {
    aggregationKey: "aggregate-response-1",
    roomId: ROOM,
    runId: RUN,
    viewerSeatId: VIEWER,
    stageId: "N1",
    sharedObjectId: null,
    eventFamily: "CROSS_IMPACT",
    latestEventId: eventId,
    projectionVersion,
    projection: {
      schemaVersion: "a_emotion_viewer_projection_v1",
      eventId,
      projectionVersion,
      roomId: ROOM,
      runId: RUN,
      viewerSeatId: VIEWER,
      category: "RELATED",
      disclosure: "CONFIRMED",
      severity: "MAJOR",
      title: "安全事件",
      safeSummary: "仅含当前 viewer 可见信息。",
      statusLabel: "已确认",
      visibleImpacts: [],
      knownFactRefs: [],
      responseOptions: [{
        code: "RESPOND_WITH_PLAN",
        label: "回应",
        preferredEntry: "PLAN",
        consumesManeuverOnSubmit: true,
      }],
      recommendedPresentation: "CENTER_CARD",
      centerCard: null,
      keyModal: null,
      eventSequence: 9,
      occurredAt: "2026-08-13T00:00:00.000Z",
      projectionHash: sha256Canonical({ eventId, projectionVersion }),
    },
    createdAt: "2026-08-13T00:00:00.000Z",
    updatedAt: "2026-08-13T00:00:00.000Z",
  };
}

function delivery(aggregate: AEmotionAggregateRecordV1): AEmotionDeliveryRecordV1 {
  return {
    eventId: aggregate.latestEventId,
    projectionVersion: aggregate.projectionVersion,
    roomId: aggregate.roomId,
    runId: aggregate.runId,
    viewerSeatId: aggregate.viewerSeatId,
    deliveredAt: "2026-08-13T00:00:00.000Z",
    seenAt: "2026-08-13T00:01:00.000Z",
    acknowledgedAt: "2026-08-13T00:02:00.000Z",
    resolvedAt: null,
    keyModalShownAt: null,
  };
}

function repositoryOf(
  aggregates: AEmotionAggregateRecordV1[],
  currentDelivery: AEmotionDeliveryRecordV1 | null,
): AEmotionFeedRepositoryPortV1 {
  return {
    readProjectionReceipt: async () => null,
    readAggregate: async () => null,
    commitProjection: async () => ({ status: "CONFLICT" }),
    listAggregates: async () => structuredClone(aggregates),
    listAggregatesAfterSequence: async () => ({
      aggregates: [],
      hasMore: false,
      currentServerSequence: 0,
    }),
    readDelivery: async () => currentDelivery ? structuredClone(currentDelivery) : null,
    updateDelivery: async () => null,
  };
}
