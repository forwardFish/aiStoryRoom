import assert from "node:assert/strict";
import test from "node:test";
import { sha256Canonical, type SeatIdV1 } from "@ai-story/shared";
import type {
  AEmotionAggregateRecordV1,
  AEmotionInteractionEventPortV1,
  AEmotionProjectionCommitPortV1,
} from "../a-emotion/ports";
import { validateAEmotionInteractionEventV1 } from "../../../../../packages/shared/src/pressure-chapter/a-emotion";
import { AEmotionFeedServiceV1 } from "../a-emotion/feed.service";
import { FrozenAEmotionPresentationCatalogV1 } from "../a-emotion/presentation";
import {
  aEmotionAggregationKey,
  aEmotionProjectionIdempotencyKey,
} from "../a-emotion/identity";
import { createPrismaAEmotionPersistenceV1 } from "./factory";
import {
  PrismaAEmotionFeedRepositoryV1,
  PrismaAEmotionInteractionJournalV1,
} from "./prisma-adapters";
import { AEmotionPersistenceError } from "./errors";

const VIEWER: SeatIdV1 = "jiangnan_merchant";
const NOW = "2026-08-11T01:00:00.000Z";

test("interaction journal replays exact canonical event and rejects mismatched dedupe reuse", async () => {
  const fake = new FakePrisma();
  const journal = new PrismaAEmotionInteractionJournalV1(fake.client);
  const event = interactionFixture();

  const first = await journal.append({ event, storyDay: 2 });
  const replay = await journal.append({ event, storyDay: 2 });
  assert.equal(first.status, "COMMITTED");
  assert.equal(replay.status, "REPLAYED");

  const row = fake.storyEvents.find((item) => item.type === "PRESSURE_A_EMOTION_INTERACTION_V1");
  assert.equal(row?.day, 2);

  await assert.rejects(
    journal.append({
      event: { ...event, eventCode: "changed" },
      storyDay: 2,
    }),
    (error: unknown) => error instanceof AEmotionPersistenceError
      && error.code === "A_EMOTION_PERSISTENCE_FINGERPRINT_MISMATCH",
  );
});

test("feed repository commits once, replays by idempotency, and rehydrates delivery marks from append-only story events", async () => {
  const fake = new FakePrisma();
  const repository = createRepository(fake);
  const commit = projectionCommitFixture();

  const first = await repository.commitProjection(commit);
  assert.deepEqual(first, { status: "COMMITTED" });

  const replay = await repository.commitProjection(commit);
  assert.equal(replay.status, "REPLAYED");

  const aggregate = await repository.readAggregate(commit.aggregate.aggregationKey);
  assert.equal(aggregate?.projectionVersion, commit.aggregate.projectionVersion);

  await repository.updateDelivery({
    eventId: commit.delivery.eventId,
    projectionVersion: commit.delivery.projectionVersion,
    roomId: commit.delivery.roomId,
    runId: commit.delivery.runId,
    viewerSeatId: commit.delivery.viewerSeatId,
    operation: "SEEN",
    occurredAt: "2026-08-11T01:00:05.000Z",
  });
  await repository.updateDelivery({
    eventId: commit.delivery.eventId,
    projectionVersion: commit.delivery.projectionVersion,
    roomId: commit.delivery.roomId,
    runId: commit.delivery.runId,
    viewerSeatId: commit.delivery.viewerSeatId,
    operation: "RESOLVED",
    occurredAt: "2026-08-11T01:00:06.000Z",
  });
  const idempotentMark = {
    eventId: commit.delivery.eventId,
    projectionVersion: commit.delivery.projectionVersion,
    roomId: commit.delivery.roomId,
    runId: commit.delivery.runId,
    viewerSeatId: commit.delivery.viewerSeatId,
    operation: "MODAL_SHOWN" as const,
    occurredAt: "2026-08-11T01:00:07.000Z",
    idempotencyKey: "http-delivery-1",
  };
  await repository.updateDelivery(idempotentMark);
  await repository.updateDelivery(structuredClone(idempotentMark));
  await assert.rejects(
    repository.updateDelivery({ ...idempotentMark, operation: "SEEN" }),
    (error: unknown) => error instanceof AEmotionPersistenceError
      && error.code === "A_EMOTION_PERSISTENCE_FINGERPRINT_MISMATCH",
  );

  const delivery = await repository.readDelivery({
    eventId: commit.delivery.eventId,
    projectionVersion: commit.delivery.projectionVersion,
    roomId: commit.delivery.roomId,
    runId: commit.delivery.runId,
    viewerSeatId: commit.delivery.viewerSeatId,
  });
  assert.equal(delivery?.seenAt, "2026-08-11T01:00:05.000Z");
  assert.equal(delivery?.resolvedAt, "2026-08-11T01:00:06.000Z");
  assert.equal(fake.eventDeliveries.length, 1);
  assert.equal(
    fake.storyEvents.filter((item) => item.type === "PRESSURE_A_EMOTION_DELIVERY_MARK_V1").length,
    3,
  );
});

test("feed repository upgrades one causal aggregate HIDDEN to SUSPECTED with monotonic CAS", async () => {
  const fake = new FakePrisma();
  const repository = createRepository(fake);
  const first = projectionCommitFixture();
  assert.deepEqual(await repository.commitProjection(first), { status: "COMMITTED" });
  const second = projectionCommitFixture({
    idempotencyKey: aEmotionProjectionIdempotencyKey({
      eventId: "evt-aemotion-suspected",
      viewerSeatId: VIEWER,
    }),
    inputFingerprint: "fingerprint-suspected",
    expectedAggregateVersion: 1,
    aggregate: {
      aggregationKey: first.aggregate.aggregationKey,
      latestEventId: "evt-aemotion-suspected",
      projectionVersion: 2,
      projection: {
        eventId: "evt-aemotion-suspected",
        projectionVersion: 2,
        disclosure: "SUSPECTED",
        visibleSuspectedSeatIds: ["zhejiang_administration"],
        eventSequence: 8,
      },
    },
    delivery: { eventId: "evt-aemotion-suspected", projectionVersion: 2 },
  });
  assert.deepEqual(await repository.commitProjection(second), { status: "COMMITTED" });
  const latest = await repository.readAggregate(first.aggregate.aggregationKey);
  assert.equal(latest?.projectionVersion, 2);
  assert.equal(latest?.latestEventId, "evt-aemotion-suspected");
  assert.equal(latest?.projection.disclosure, "SUSPECTED");
  assert.equal((await repository.listAggregates({
    roomId: "room-ae-1",
    runId: "run-ae-1",
    viewerSeatId: VIEWER,
  })).length, 1);
  assert.equal(fake.eventDeliveries.length, 2);
});

test("feed repository uses exact viewer binding and fails closed when absent", async () => {
  const fake = new FakePrisma();
  fake.binding = null;
  const repository = createRepository(fake);

  await assert.rejects(
    repository.commitProjection(projectionCommitFixture()),
    (error: unknown) => error instanceof AEmotionPersistenceError
      && error.code === "A_EMOTION_DELIVERY_BINDING_MISSING",
  );
});

test("feed repository rejects an unbased projectionVersion upgrade without writing delivery", async () => {
  const fake = new FakePrisma();
  const repository = createRepository(fake);
  const second = projectionCommitFixture({
    inputFingerprint: "fingerprint-2",
    aggregate: {
      projectionVersion: 2,
      projection: {
        projectionVersion: 2,
      },
    },
    delivery: { projectionVersion: 2 },
  });

  await assert.rejects(
    repository.commitProjection(second),
    (error: unknown) => error instanceof AEmotionPersistenceError
      && error.code === "A_EMOTION_PERSISTENCE_RECORD_INVALID",
  );
  assert.equal(fake.storyEvents.length, 0);
  assert.equal(fake.eventDeliveries.length, 0);
});

test("feed repository replays exact content and rejects projection drift even with the same fingerprint", async () => {
  const fake = new FakePrisma();
  const repository = createRepository(fake);
  const first = projectionCommitFixture();
  const drifted = projectionCommitFixture({
    aggregate: { projection: { title: "drifted title" } },
  });

  assert.deepEqual(await repository.commitProjection(first), { status: "COMMITTED" });
  assert.equal((await repository.commitProjection(first)).status, "REPLAYED");
  assert.deepEqual(await repository.commitProjection(drifted), { status: "IDEMPOTENCY_MISMATCH" });
  assert.equal(fake.eventDeliveries.length, 1);
});

test("factory pipeline persists canonical event, projects viewer feed, and pages through AEmotionFeedServiceV1 cursor", async () => {
  const fake = new FakePrisma();
  const bundle = createPrismaAEmotionPersistenceV1({
    prisma: fake.client,
    bindings: { resolve: async () => fake.binding },
    storyDay: { resolve: async () => 2 },
    observerResolver: { resolve: async () => [] },
    presentation: new FrozenAEmotionPresentationCatalogV1(),
  });
  assert.ok(bundle.feed instanceof AEmotionFeedServiceV1);

  const first = supportedInteractionFixture({
    eventId: "evt-feed-1",
    idempotencyKey: "source-feed-1",
    stageId: "stage-feed-1",
    eventSequence: 11,
  });
  const second = supportedInteractionFixture({
    eventId: "evt-feed-2",
    idempotencyKey: "source-feed-2",
    // Same stage/object/family as the first event: event-scoped aggregation
    // must still publish a distinct immutable v1 projection and delivery.
    stageId: "stage-feed-1",
    eventSequence: 12,
  });

  const ingestedFirst = await bundle.pipeline.ingest({
    event: first,
    storyDay: 2,
    viewer: viewerContext(),
    now: NOW,
  });
  const ingestedSecond = await bundle.pipeline.ingest({
    event: second,
    storyDay: 2,
    viewer: viewerContext(),
    now: "2026-08-11T01:00:01.000Z",
  });

  assert.equal(ingestedFirst.eventStatus, "COMMITTED");
  assert.equal(ingestedSecond.projectionStatus, "COMMITTED");
  assert.equal((await bundle.journal.readCommitted("source-feed-1"))?.eventId, "evt-feed-1");
  assert.equal(fake.eventDeliveries.length, 2);
  assert.equal(
    fake.storyEvents.filter((item) => item.type === "PRESSURE_A_EMOTION_AGGREGATE_V1").length,
    2,
  );

  const firstPage = await bundle.feed.list({
    roomId: "room-ae-1",
    runId: "run-ae-1",
    viewerSeatId: VIEWER,
    limit: 1,
  });
  assert.equal(firstPage.items.length, 1);
  assert.equal(firstPage.items[0]?.eventId, "evt-feed-2");
  assert.ok(firstPage.nextCursor);

  const secondPage = await bundle.feed.list({
    roomId: "room-ae-1",
    runId: "run-ae-1",
    viewerSeatId: VIEWER,
    cursor: firstPage.nextCursor,
    limit: 1,
  });
  assert.equal(secondPage.items.length, 1);
  assert.equal(secondPage.items[0]?.eventId, "evt-feed-1");
});

function createRepository(fake: FakePrisma): PrismaAEmotionFeedRepositoryV1 {
  return new PrismaAEmotionFeedRepositoryV1(
    fake.client,
    {
      resolve: async () => fake.binding,
    },
    {
      resolve: async () => 2,
    },
  );
}

function viewerContext() {
  return {
    subjectId: "subject-user-a",
    roomId: "room-ae-1",
    runId: "run-ae-1",
    viewerSeatId: VIEWER,
    knownFactRefs: ["fact.ledger.touched-by-governor-and-magistrate"],
    authorizedEvidenceRefs: [],
  };
}

class FakePrisma {
  storyEvents: any[] = [];
  eventDeliveries: any[] = [];
  storyEventCursor = { runId: "run-ae-1", nextSequence: 1, version: 1 };
  eventDeliveryCursors = new Map<string, { roomId: string; userId: string; nextSequence: number; version: number }>();
  binding: { userId: string; roleId: string } | null = { userId: "user-a", roleId: "role-a" };

  readonly client = {
    $transaction: async <T>(operation: (tx: any) => Promise<T>): Promise<T> => operation(this.tx),
  };

  private readonly tx = {
    storyEvent: {
      findMany: async ({ where }: any) => {
        const type = where?.type;
        const rows = type
          ? this.storyEvents.filter((item) => item.type === type)
          : this.storyEvents;
        return rows.map((item) => structuredClone(item));
      },
      findUnique: async ({ where }: any) => {
        if (where?.dedupeKey) {
          const match = this.storyEvents.find((item) => item.dedupeKey === where.dedupeKey);
          return match ? structuredClone(match) : null;
        }
        return null;
      },
      create: async ({ data }: any) => {
        if (this.storyEvents.some((item) => item.dedupeKey === data.dedupeKey)) {
          const error = new Error("unique") as Error & { code: string };
          error.code = "P2002";
          throw error;
        }
        const row = { ...structuredClone(data), createdAt: new Date() };
        this.storyEvents.push(row);
        return structuredClone(row);
      },
    },
    storyEventCursor: {
      findUnique: async () => structuredClone(this.storyEventCursor),
      create: async ({ data }: any) => {
        this.storyEventCursor = { runId: data.runId, nextSequence: 1, version: 1 };
        return structuredClone(this.storyEventCursor);
      },
      update: async () => {
        this.storyEventCursor = {
          ...this.storyEventCursor,
          nextSequence: this.storyEventCursor.nextSequence + 1,
          version: this.storyEventCursor.version + 1,
        };
        return structuredClone(this.storyEventCursor);
      },
    },
    eventDelivery: {
      findMany: async () => this.eventDeliveries.map((item) => structuredClone(item)),
      findUnique: async ({ where }: any) => {
        const key = where?.eventId_userId;
        const match = this.eventDeliveries.find((item) => item.eventId === key.eventId && item.userId === key.userId);
        return match ? structuredClone(match) : null;
      },
      create: async ({ data }: any) => {
        if (this.eventDeliveries.some((item) => item.eventId === data.eventId && item.userId === data.userId)) {
          const error = new Error("unique") as Error & { code: string };
          error.code = "P2002";
          throw error;
        }
        const row = {
          ...structuredClone(data),
          id: `delivery-${this.eventDeliveries.length + 1}`,
          deliveredAt: new Date(NOW),
        };
        this.eventDeliveries.push(row);
        return structuredClone(row);
      },
    },
    eventDeliveryCursor: {
      findUnique: async ({ where }: any) => structuredClone(this.eventDeliveryCursors.get(key(where.roomId_userId)) ?? null),
      create: async ({ data }: any) => {
        const value = { roomId: data.roomId, userId: data.userId, nextSequence: 1, version: 1 };
        this.eventDeliveryCursors.set(key(value), value);
        return structuredClone(value);
      },
      update: async ({ where }: any) => {
        const current = this.eventDeliveryCursors.get(key(where.roomId_userId))!;
        const next = {
          ...current,
          nextSequence: current.nextSequence + 1,
          version: current.version + 1,
        };
        this.eventDeliveryCursors.set(key(next), next);
        return structuredClone(next);
      },
    },
  };
}

function key(input: { roomId: string; userId: string }) {
  return `${input.roomId}:${input.userId}`;
}

function interactionFixture(
  overrides: Partial<AEmotionInteractionEventPortV1> = {},
): AEmotionInteractionEventPortV1 {
  const base: Omit<AEmotionInteractionEventPortV1, "eventHash"> = {
    schemaVersion: "a_emotion_interaction_event_v1",
    eventId: "evt-aemotion-1",
    roomId: "room-ae-1",
    runId: "run-ae-1",
    stageId: "stage-1",
    sourceCommitHash: "c".repeat(64),
    sourceActionId: "action-1",
    sourceSeatId: VIEWER,
    kind: "DIRECT_IMPACT",
    eventCode: "impact",
    eventFamily: "family-1",
    severity: "MAJOR",
    sharedObjectId: null,
    factRefs: ["fact-1"],
    publicFactRefs: [],
    impacts: [],
    audienceSpec: { type: "EXPLICIT", seatIds: [VIEWER] },
    disclosure: "HIDDEN",
    suspectedSeatIds: [],
    suspicionBasisRefs: [],
    evidenceRefs: [],
    revealOfEventId: null,
    promiseId: null,
    milestoneId: null,
    metricTransitionId: null,
    presentation: {
      recommendedPresentation: "FEED_ONLY",
      centerCardType: null,
      responseOptions: [],
      modalTrigger: null,
    },
    occurredAt: NOW,
    eventSequence: 7,
    stateVersion: 1,
    idempotencyKey: "source-event-key",
  };
  const merged = { ...base, ...overrides };
  return validateAEmotionInteractionEventV1({
    ...merged,
    eventHash: sha256Canonical(merged),
  }) as unknown as AEmotionInteractionEventPortV1;
}

function supportedInteractionFixture(
  overrides: Partial<AEmotionInteractionEventPortV1> = {},
): AEmotionInteractionEventPortV1 {
  const base: Omit<AEmotionInteractionEventPortV1, "eventHash"> = {
    schemaVersion: "a_emotion_interaction_event_v1",
    eventId: "evt-feed-1",
    roomId: "room-ae-1",
    runId: "run-ae-1",
    stageId: "stage-feed-1",
    sourceCommitHash: "d".repeat(64),
    sourceActionId: "action-feed-1",
    sourceSeatId: VIEWER,
    kind: "DIRECT_IMPACT",
    eventCode: "LEDGER_DELIVERY_ANOMALY",
    eventFamily: "feed-family",
    severity: "MAJOR",
    sharedObjectId: "shared-ledger",
    factRefs: ["fact.ledger.touched-by-governor-and-magistrate"],
    publicFactRefs: [],
    impacts: [{
      targetSeatId: VIEWER,
      visibility: "TARGET_ONLY",
      type: "GOAL_PROGRESS",
      key: "reformProgress",
      before: 0,
      after: 0,
      delta: null,
      effectCode: "REFORM_PROGRESS_STALLED",
    }],
    audienceSpec: { type: "EXPLICIT", seatIds: [VIEWER] },
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
      centerCardType: "CROSS_IMPACT",
      responseOptions: [
        { code: "INVESTIGATE_SOURCE", preferredEntry: "INVESTIGATE", consumesManeuverOnSubmit: true },
        { code: "PUBLIC_QUESTION", preferredEntry: "TALK", consumesManeuverOnSubmit: true },
        { code: "DEFER", preferredEntry: "DEFER", consumesManeuverOnSubmit: false },
      ],
      modalTrigger: null,
    },
    occurredAt: NOW,
    eventSequence: 11,
    stateVersion: 1,
    idempotencyKey: "source-feed-1",
  };
  const merged = { ...base, ...overrides };
  return validateAEmotionInteractionEventV1({
    ...merged,
    eventHash: sha256Canonical(merged),
  }) as unknown as AEmotionInteractionEventPortV1;
}

function projectionCommitFixture(
  overrides: Partial<{
    idempotencyKey: string;
    inputFingerprint: string;
    aggregate: Omit<Partial<AEmotionAggregateRecordV1>, "projection"> & {
      projection?: Partial<AEmotionAggregateRecordV1["projection"]>;
    };
    delivery: Partial<AEmotionProjectionCommitPortV1["delivery"]>;
    expectedAggregateVersion: number;
  }> = {},
): AEmotionProjectionCommitPortV1 {
  const projectionBase = {
    schemaVersion: "a_emotion_viewer_projection_v1" as const,
    eventId: "evt-aemotion-1",
    projectionVersion: 1,
    roomId: "room-ae-1",
    runId: "run-ae-1",
    viewerSeatId: VIEWER,
    category: "RELATED" as const,
    disclosure: "HIDDEN" as const,
    severity: "MAJOR" as const,
    title: "title",
    safeSummary: "summary",
    statusLabel: "status",
    visibleImpacts: [],
    knownFactRefs: [],
    responseOptions: [],
    recommendedPresentation: "FEED_ONLY" as const,
    centerCard: null,
    keyModal: null,
    eventSequence: 7,
    occurredAt: NOW,
    projectionHash: "",
  };
  const projection = {
    ...projectionBase,
    ...(overrides.aggregate?.projection ?? {}),
  };
  projection.projectionHash = projectionHash(projection);
  const aggregateBase: AEmotionAggregateRecordV1 = {
    aggregationKey: aEmotionAggregationKey({
      roomId: "room-ae-1",
      runId: "run-ae-1",
      viewerSeatId: VIEWER,
      eventId: projection.eventId,
    }),
    roomId: "room-ae-1",
    runId: "run-ae-1",
    viewerSeatId: VIEWER,
    stageId: "stage-1",
    sharedObjectId: null,
    eventFamily: "family-1",
    latestEventId: "evt-aemotion-1",
    projectionVersion: 1,
    projection,
    createdAt: NOW,
    updatedAt: NOW,
  };
  return {
    idempotencyKey: overrides.idempotencyKey ?? aEmotionProjectionIdempotencyKey({
      eventId: projection.eventId,
      viewerSeatId: VIEWER,
    }),
    inputFingerprint: overrides.inputFingerprint ?? "fingerprint-1",
    expectedAggregateVersion: overrides.expectedAggregateVersion ?? 0,
    aggregate: {
      ...aggregateBase,
      ...(overrides.aggregate ?? {}),
      projection: {
        ...aggregateBase.projection,
        ...(overrides.aggregate?.projection ?? {}),
      },
    },
    delivery: {
      eventId: overrides.delivery?.eventId ?? "evt-aemotion-1",
      projectionVersion: overrides.delivery?.projectionVersion ?? 1,
      roomId: "room-ae-1",
      runId: "run-ae-1",
      viewerSeatId: VIEWER,
      deliveredAt: NOW,
      seenAt: null,
      acknowledgedAt: null,
      resolvedAt: null,
      keyModalShownAt: null,
    },
  };
}

function projectionHash(
  projection: Record<string, unknown>,
) {
  const { projectionHash: _ignored, ...body } = projection;
  return sha256Canonical(body);
}
