import assert from "node:assert/strict";
import test from "node:test";
import type {
  AEmotionAggregateRecordV1,
  AEmotionFeedRepositoryPortV1,
} from "../a-emotion/ports";
import { AEmotionHttpDeliveryAdapterV1 } from "./a-emotion-delivery.adapter";

const ROOM_ID = "room-delivery";
const RUN_ID = "run-delivery";
const SEAT_ID = "cabinet_finance" as const;
const EVENT_ID = "event-modal";

test("delivery adapter marks the authenticated viewer modal and replay is delegated idempotently", async () => {
  const marks: unknown[] = [];
  const adapter = adapterFor([aggregate()], marks);
  const input = markInput();
  await adapter.mark(input);
  await adapter.mark(structuredClone(input));
  assert.equal(marks.length, 2);
  assert.deepEqual(marks[0], {
    eventId: EVENT_ID,
    projectionVersion: 4,
    roomId: ROOM_ID,
    runId: RUN_ID,
    viewerSeatId: SEAT_ID,
    operation: "MODAL_SHOWN",
    occurredAt: "2026-08-13T00:00:00.000Z",
    idempotencyKey: "delivery-mark-1",
  });
});

test("delivery adapter rejects cross-scope, stale, superseded and ineligible modal marks before write", async () => {
  for (const aggregates of [
    [],
    [aggregate({ roomId: "other-room" })],
    [aggregate({ runId: "other-run" })],
    [aggregate({ viewerSeatId: "qingliu_law" })],
    [aggregate({ projectionVersion: 5 })],
    [aggregate({ latestEventId: "newer-event" })],
    [aggregate({ keyModal: null })],
  ]) {
    const marks: unknown[] = [];
    const adapter = adapterFor(aggregates, marks);
    await assert.rejects(() => adapter.mark(markInput()), (error: unknown) => (
      !!error
      && typeof error === "object"
      && "code" in error
      && error.code === "PRESSURE_DELIVERY_COMMAND_REJECTED"
    ));
    assert.equal(marks.length, 0);
  }
});

function adapterFor(aggregates: AEmotionAggregateRecordV1[], marks: unknown[]) {
  const repository = {
    async listAggregates() { return structuredClone(aggregates); },
  } as Pick<AEmotionFeedRepositoryPortV1, "listAggregates">;
  return new AEmotionHttpDeliveryAdapterV1(repository, {
    async mark(input) { marks.push(structuredClone(input)); return {} as never; },
  });
}

function markInput() {
  return {
    roomId: ROOM_ID,
    runId: RUN_ID,
    viewerSeatId: SEAT_ID,
    command: {
      schemaVersion: "pressure_chapter_game_command_v1" as const,
      commandType: "DELIVERY_MARK" as const,
      eventId: EVENT_ID,
      projectionVersion: 4,
      operation: "MODAL_SHOWN" as const,
      idempotencyKey: "delivery-mark-1",
    },
    occurredAt: "2026-08-13T00:00:00.000Z",
  };
}

function aggregate(overrides: Partial<{
  roomId: string;
  runId: string;
  viewerSeatId: "cabinet_finance" | "qingliu_law";
  projectionVersion: number;
  latestEventId: string;
  keyModal: object | null;
}> = {}): AEmotionAggregateRecordV1 {
  const projectionVersion = overrides.projectionVersion ?? 4;
  return {
    aggregationKey: "aggregate-modal",
    roomId: overrides.roomId ?? ROOM_ID,
    runId: overrides.runId ?? RUN_ID,
    viewerSeatId: overrides.viewerSeatId ?? SEAT_ID,
    stageId: "N3",
    sharedObjectId: null,
    eventFamily: "CRISIS",
    latestEventId: overrides.latestEventId ?? EVENT_ID,
    projectionVersion,
    projection: {
      schemaVersion: "a_emotion_viewer_projection_v1",
      eventId: EVENT_ID,
      projectionVersion,
      roomId: overrides.roomId ?? ROOM_ID,
      runId: overrides.runId ?? RUN_ID,
      viewerSeatId: overrides.viewerSeatId ?? SEAT_ID,
      category: "PUBLIC",
      disclosure: "CONFIRMED",
      severity: "CRITICAL",
      title: "危机",
      safeSummary: "危机已确认",
      statusLabel: "危机",
      visibleImpacts: [],
      knownFactRefs: [],
      centerCard: null,
      keyModal: overrides.keyModal === null ? null : {
        id: "modal-1",
        type: "CRISIS",
        priority: 300,
        serverSequence: 4,
        sourceEventId: EVENT_ID,
        triggerId: "trigger-1",
        stateVersion: 4,
        dedupeKey: "dedupe-1",
        card: {} as never,
      },
      recommendedPresentation: "KEY_MODAL",
      responseOptions: [],
      eventSequence: 4,
      occurredAt: "2026-08-13T00:00:00.000Z",
      projectionHash: "hash",
    },
    createdAt: "2026-08-13T00:00:00.000Z",
    updatedAt: "2026-08-13T00:00:00.000Z",
  };
}
