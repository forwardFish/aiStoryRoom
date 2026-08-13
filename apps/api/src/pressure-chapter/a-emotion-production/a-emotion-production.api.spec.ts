import assert from "node:assert/strict";
import test from "node:test";
import {
  sha256Canonical,
  type SeatIdV1,
} from "@ai-story/shared";
import {
  validateAEmotionInteractionEventV1,
} from "../../../../../packages/shared/src/pressure-chapter/a-emotion";
import { AEmotionFeedServiceV1 } from "../a-emotion/feed.service";
import { InMemoryAEmotionFeedRepositoryV1 } from "../a-emotion/fixtures";
import type {
  AEmotionInteractionEventPortV1,
  AEmotionViewerContextPortV1,
} from "../a-emotion/ports";
import { FrozenAEmotionPresentationCatalogV1 } from "../a-emotion/presentation";
import { AEmotionViewerProjectorV1 } from "../a-emotion/projector";
import type { AEmotionInteractionJournalPortV1 } from "../a-emotion-persistence/contracts";
import { AEmotionAuthorityFeedPipelineV1 } from "../a-emotion-persistence/pipeline";
import {
  CanonicalAEmotionAuthorityEventCompilerV1,
  sealAEmotionAuthorityOutboxJobV1,
  sealAEmotionCommittedAuthoritySourceV1,
} from "./compiler";
import { createAEmotionPostCommitProductionV1 } from "./factory";
import type {
  AEmotionAuthorityFeedPipelinePortV1,
  AEmotionAuthorityOutboxJobV1,
  AEmotionAuthorityOutboxPortV1,
  AEmotionAuthoritySourceKindV1,
  AEmotionCommittedAuthoritySourceV1,
  AEmotionViewerContextRequestV1,
  AEmotionViewerDeliveryContextV1,
} from "./contracts";

const MERCHANT: SeatIdV1 = "jiangnan_merchant";
const OBSERVER: SeatIdV1 = "qingliu_law";
const SOURCE_SEAT: SeatIdV1 = "zhejiang_governor";
const COMMITTED_AT = "2026-08-12T04:00:00.000Z";

test("factory exposes only the ProductRoot worker capability and keeps configuration explicit", async () => {
  const pair = authorityPair();
  const harness = consumerHarness(pair, [viewerContext(MERCHANT, pair.source.sourceCommitHash)]);

  assert.equal(Object.isFrozen(harness.production), true);
  assert.strictEqual(harness.production.worker, harness.consumer);
  assert.equal((await harness.production.worker.consumeNext("product-root-worker")).kind, "ACKNOWLEDGED");
  assert.deepEqual(await harness.production.worker.consumeNext("product-root-worker"), { kind: "IDLE" });
});

test("compiler deterministically accepts committed Beat, ChapterSettlement and Finale causal signals", () => {
  const compiler = new CanonicalAEmotionAuthorityEventCompilerV1();
  const cases: Array<[AEmotionAuthoritySourceKindV1, string, number]> = [
    ["BEAT_COMMITTED", "N3", 3],
    ["CHAPTER_SETTLEMENT_COMMITTED", "N4", 4],
    ["FINALE_COMMITTED", "FINALE", 8],
  ];
  const eventIds = new Set<string>();
  for (const [sourceKind, stageId, storyDay] of cases) {
    const pair = authorityPair({ sourceKind, stageId, storyDay });
    const first = compiler.compile(pair.job, pair.source);
    const replay = compiler.compile(pair.job, pair.source);
    assert.deepEqual(replay, first);
    assert.deepEqual(validateAEmotionInteractionEventV1(first), first);
    assert.equal(first.sourceCommitHash, pair.source.sourceCommitHash);
    assert.equal(first.sourceActionId, pair.source.sourceActionId);
    assert.equal(first.occurredAt, COMMITTED_AT);
    eventIds.add(first.eventId);
  }
  assert.equal(eventIds.size, 3);
});

test("consumer projects through the existing pipeline only for an authorized viewer and acknowledges the exact fence", async () => {
  const pair = authorityPair();
  const merchant = viewerContext(MERCHANT, pair.source.sourceCommitHash);
  const observer = viewerContext(OBSERVER, pair.source.sourceCommitHash);
  const harness = consumerHarness(pair, [observer, merchant]);

  const result = await harness.consumer.consumeNext("worker-a");

  assert.deepEqual(result, {
    kind: "ACKNOWLEDGED",
    outboxId: "aemotion-outbox-1",
    viewerCount: 2,
    projectedViewerCount: 1,
  });
  assert.equal(harness.outbox.status, "COMPLETED");
  assert.deepEqual(harness.outbox.ackRequests, [{ outboxId: "aemotion-outbox-1", fence: 1 }]);
  assert.equal(harness.journal.writes, 1);
  assert.equal(harness.authority.readCount, 1);
  assert.equal(harness.authority.writeCount, 0);

  const merchantPage = await harness.feed.list({
    roomId: pair.source.roomId,
    runId: pair.source.runId,
    viewerSeatId: MERCHANT,
    limit: 10,
  });
  const observerPage = await harness.feed.list({
    roomId: pair.source.roomId,
    runId: pair.source.runId,
    viewerSeatId: OBSERVER,
    limit: 10,
  });
  assert.equal(merchantPage.items.length, 1);
  assert.equal(merchantPage.items[0]?.visibleImpacts[0]?.effectCode, "REFORM_PROGRESS_STALLED");
  assert.equal(observerPage.items.length, 0);
  assert.deepEqual(Object.keys(harness.viewers.lastRequest!).sort(), [
    "audienceSpec", "eventFamily", "eventId", "revealOfEventId", "roomId", "runId",
    "sharedObjectId", "sourceCommitHash", "sourceId", "sourceKind", "stageId",
  ]);
  assert.equal("factRefs" in harness.viewers.lastRequest!, false);
  assert.equal("impacts" in harness.viewers.lastRequest!, false);
});

test("an AI-only audience is acknowledged as a validated zero-delivery no-op", async () => {
  const pair = authorityPair();
  const harness = consumerHarness(pair, []);

  const result = await harness.consumer.consumeNext("worker-ai-only");

  assert.deepEqual(result, {
    kind: "ACKNOWLEDGED",
    outboxId: "aemotion-outbox-1",
    viewerCount: 0,
    projectedViewerCount: 0,
  });
  assert.equal(harness.authority.readCount, 1);
  assert.equal(harness.viewers.readCount, 1);
  assert.equal(harness.pipelineCalls.count, 0);
  assert.deepEqual(harness.outbox.ackRequests, [{ outboxId: "aemotion-outbox-1", fence: 1 }]);
  assert.equal(harness.outbox.status, "COMPLETED");
});

test("crash after modal ingest but before ack retries without duplicate event, delivery, or modal", async () => {
  const pair = crisisAuthorityPair();
  const context = viewerContext(MERCHANT, pair.source.sourceCommitHash);
  context.viewer.authorizedEvidenceRefs = ["evidence:emperor-trust-danger-entry"];
  context.contextHash = sha256Canonical({
    sourceCommitHash: pair.source.sourceCommitHash,
    viewer: context.viewer,
    priorProjectionHash: null,
    priorAggregationKey: null,
  });
  const harness = consumerHarness(pair, [context]);
  harness.outbox.crashNextAcknowledge = true;

  await assert.rejects(harness.consumer.consumeNext("worker-crash"), /SIMULATED_CRASH_AFTER_INGEST/u);
  assert.equal(harness.journal.writes, 1);
  assert.equal(harness.repository.aggregateWrites, 1);
  assert.equal(harness.repository.deliveryWrites, 1);
  assert.equal(harness.outbox.status, "LEASED");

  harness.outbox.recoverExpiredLease();
  const replay = await harness.consumer.consumeNext("worker-recovery");
  assert.equal(replay.kind, "ACKNOWLEDGED");
  assert.equal(harness.outbox.fence, 2);
  assert.equal(harness.journal.writes, 1);
  assert.equal(harness.repository.aggregateWrites, 1);
  assert.equal(harness.repository.deliveryWrites, 1);
  const page = await harness.feed.list({
    roomId: pair.source.roomId,
    runId: pair.source.runId,
    viewerSeatId: MERCHANT,
  });
  assert.equal(page.items.length, 1);
  assert.equal(page.items[0]?.keyModal?.dedupeKey, [
    MERCHANT,
    "CRISIS",
    "metric:emperor-trust:danger-entry",
    1,
  ].join(":"));
});

test("missing committed authority retries with its fence and dead-letters at the attempt budget", async () => {
  const pair = authorityPair();
  const clock = new MutableClock(1_000);
  const harness = consumerHarness(pair, [viewerContext(MERCHANT, pair.source.sourceCommitHash)], {
    authorityValue: null,
    clock,
    maxAttempts: 2,
  });

  const first = await harness.consumer.consumeNext("worker-retry");
  assert.deepEqual(first, {
    kind: "RETRY_SCHEDULED",
    outboxId: "aemotion-outbox-1",
    retryAtMs: 1_010,
    reasonCode: "A_EMOTION_AUTHORITY_SOURCE_NOT_FOUND",
  });
  assert.equal(harness.outbox.retryRequests[0]?.fence, 1);
  clock.value = 1_010;
  const second = await harness.consumer.consumeNext("worker-retry");
  assert.equal(second.kind, "DEAD_LETTERED");
  assert.match(second.reasonCode, /^A_EMOTION_AUTHORITY_SOURCE_NOT_FOUND/u);
  assert.equal(harness.outbox.deadLetterRequests[0]?.fence, 2);
  assert.equal(harness.authority.writeCount, 0);
});

test("Narrative or Provider-derived fields are rejected before viewer resolution and pipeline ingestion", async (t) => {
  for (const forbidden of ["narrativeText", "providerOutput"] as const) {
    await t.test(forbidden, async () => {
      const pair = authorityPair();
      const invalid = { ...pair.source, [forbidden]: "untrusted literary material" };
      const harness = consumerHarness(pair, [viewerContext(MERCHANT, pair.source.sourceCommitHash)], {
        authorityValue: invalid,
      });
      const result = await harness.consumer.consumeNext(`worker-${forbidden}`);
      assert.equal(result.kind, "DEAD_LETTERED");
      assert.match(result.reasonCode, /^A_EMOTION_AUTHORITY_SOURCE_INVALID/u);
      assert.equal(harness.viewers.readCount, 0);
      assert.equal(harness.pipelineCalls.count, 0);
      assert.equal(harness.authority.writeCount, 0);
    });
  }
});

test("a valid but differently bound committed source is dead-lettered without reinterpretation", async () => {
  const expected = authorityPair();
  const other = authorityPair({
    sourceKind: "CHAPTER_SETTLEMENT_COMMITTED",
    stageId: "N3",
    sourceId: "chapter-settlement-other",
    sourceCommitHash: "b".repeat(64),
  });
  const harness = consumerHarness(expected, [viewerContext(MERCHANT, expected.source.sourceCommitHash)], {
    authorityValue: other.source,
  });
  const result = await harness.consumer.consumeNext("worker-mismatch");
  assert.equal(result.kind, "DEAD_LETTERED");
  assert.match(result.reasonCode, /^A_EMOTION_AUTHORITY_BINDING_MISMATCH/u);
  assert.equal(harness.pipelineCalls.count, 0);
});

test("viewer knowledge must be source-commit-bound and duplicate seats fail closed", async (t) => {
  const pair = authorityPair();
  await t.test("context hash mismatch", async () => {
    const invalid = viewerContext(MERCHANT, pair.source.sourceCommitHash);
    invalid.contextHash = "f".repeat(64);
    const harness = consumerHarness(pair, [invalid]);
    const result = await harness.consumer.consumeNext("worker-context-hash");
    assert.equal(result.kind, "DEAD_LETTERED");
    assert.match(result.reasonCode, /^A_EMOTION_VIEWER_CONTEXT_INVALID/u);
    assert.equal(harness.pipelineCalls.count, 0);
  });
  await t.test("duplicate seat", async () => {
    const context = viewerContext(MERCHANT, pair.source.sourceCommitHash);
    const harness = consumerHarness(pair, [context, structuredClone(context)]);
    const result = await harness.consumer.consumeNext("worker-duplicate-seat");
    assert.equal(result.kind, "DEAD_LETTERED");
    assert.equal(harness.pipelineCalls.count, 0);
  });
});

test("pipeline failure is retryable and can never roll back or write the authority source", async () => {
  const pair = authorityPair();
  const clock = new MutableClock(2_000);
  const failingPipeline: AEmotionAuthorityFeedPipelinePortV1 = {
    ingest: async () => {
      throw new Error("provider-like presentation dependency unavailable");
    },
  };
  const harness = consumerHarness(pair, [viewerContext(MERCHANT, pair.source.sourceCommitHash)], {
    clock,
    pipeline: failingPipeline,
    maxAttempts: 2,
  });
  const first = await harness.consumer.consumeNext("worker-pipeline");
  assert.equal(first.kind, "RETRY_SCHEDULED");
  assert.match(first.reasonCode, /^A_EMOTION_PIPELINE_UNAVAILABLE/u);
  clock.value = 2_010;
  const second = await harness.consumer.consumeNext("worker-pipeline");
  assert.equal(second.kind, "DEAD_LETTERED");
  assert.equal(harness.authority.writeCount, 0);
  assert.equal(harness.outbox.status, "DEAD_LETTER");
});

function authorityPair(overrides: Partial<{
  sourceKind: AEmotionAuthoritySourceKindV1;
  stageId: string;
  storyDay: number;
  sourceId: string;
  sourceCommitHash: string;
}> = {}): { job: AEmotionAuthorityOutboxJobV1; source: AEmotionCommittedAuthoritySourceV1 } {
  const sourceKind = overrides.sourceKind ?? "BEAT_COMMITTED";
  const sourceId = overrides.sourceId ?? `${sourceKind.toLowerCase()}:source-1`;
  const sourceCommitHash = overrides.sourceCommitHash
    ?? sha256Canonical({ sourceKind, sourceId, committed: true });
  const job = sealAEmotionAuthorityOutboxJobV1({
    schemaVersion: "a_emotion_authority_outbox_job_v1",
    sourceKind,
    runId: "run-aemotion-production-1",
    sourceId,
    sourceCommitHash,
    signalId: "ledger-delivery-anomaly",
  });
  const source = sealAEmotionCommittedAuthoritySourceV1({
    schemaVersion: "a_emotion_committed_authority_source_v1",
    sourceKind,
    sourceId,
    sourceCommitHash,
    roomId: "room-aemotion-production-1",
    runId: job.runId,
    stageId: overrides.stageId ?? (sourceKind === "FINALE_COMMITTED" ? "FINALE" : "N3"),
    sourceActionId: "action-ledger-source-1",
    sourceSeatId: SOURCE_SEAT,
    committedAt: COMMITTED_AT,
    eventSequence: sourceKind === "FINALE_COMMITTED" ? 8 : 3,
    stateVersion: 1,
    storyDay: overrides.storyDay ?? (sourceKind === "FINALE_COMMITTED" ? 8 : 3),
    signal: {
      signalId: job.signalId,
      kind: "DIRECT_IMPACT",
      eventCode: "LEDGER_DELIVERY_ANOMALY",
      eventFamily: "ledger-delivery",
      severity: "MAJOR",
      sharedObjectId: "ledger-original",
      factRefs: ["fact.ledger.touched-by-governor-and-magistrate"],
      publicFactRefs: [],
      impacts: [{
        targetSeatId: MERCHANT,
        visibility: "TARGET_ONLY",
        type: "GOAL_PROGRESS",
        key: "reformProgress",
        before: 0,
        after: 0,
        delta: null,
        effectCode: "REFORM_PROGRESS_STALLED",
      }],
      audienceSpec: { type: "EXPLICIT", seatIds: [MERCHANT] },
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
    },
  }, job);
  return { job, source };
}

function crisisAuthorityPair(): {
  job: AEmotionAuthorityOutboxJobV1;
  source: AEmotionCommittedAuthoritySourceV1;
} {
  const pair = authorityPair();
  const { sourceBindingHash: _sourceBindingHash, ...draft } = pair.source;
  return {
    job: pair.job,
    source: sealAEmotionCommittedAuthoritySourceV1({
      ...draft,
      signal: {
        ...draft.signal,
        eventCode: "EMPEROR_TRUST_DANGER_ENTERED",
        eventFamily: "EMPEROR_TRUST",
        severity: "CRITICAL",
        impacts: [{
          targetSeatId: MERCHANT,
          visibility: "TARGET_ONLY",
          type: "RISK",
          key: "emperorTrust",
          before: 23,
          after: 18,
          delta: -5,
          effectCode: "EMPEROR_TRUST_DANGER",
        }],
        metricTransitionId: "metric:emperor-trust:danger-entry",
        disclosure: "CONFIRMED",
        evidenceRefs: ["evidence:emperor-trust-danger-entry"],
        presentation: {
          recommendedPresentation: "KEY_MODAL",
          centerCardType: "CRISIS",
          responseOptions: [
            { code: "RESPOND_NOW", preferredEntry: "TOKEN", consumesManeuverOnSubmit: true },
            { code: "HANDLE_LATER", preferredEntry: "DEFER", consumesManeuverOnSubmit: false },
            { code: "VIEW_DETAILS", preferredEntry: "DEFER", consumesManeuverOnSubmit: false },
          ],
          modalTrigger: {
            type: "CRISIS",
            triggerId: "metric:emperor-trust:danger-entry",
            stateVersion: 1,
          },
        },
      },
    }, pair.job),
  };
}

function viewerContext(
  viewerSeatId: SeatIdV1,
  sourceCommitHash: string,
): AEmotionViewerDeliveryContextV1 {
  const viewer: AEmotionViewerContextPortV1 = {
    subjectId: `subject:${viewerSeatId}`,
    roomId: "room-aemotion-production-1",
    runId: "run-aemotion-production-1",
    viewerSeatId,
    knownFactRefs: viewerSeatId === MERCHANT
      ? ["fact.ledger.touched-by-governor-and-magistrate"]
      : [],
    authorizedEvidenceRefs: [],
  };
  return {
    viewer,
    priorProjection: null,
    priorAggregationKey: null,
    contextHash: sha256Canonical({
      sourceCommitHash,
      viewer,
      priorProjectionHash: null,
      priorAggregationKey: null,
    }),
  };
}

function consumerHarness(
  pair: { job: AEmotionAuthorityOutboxJobV1; source: AEmotionCommittedAuthoritySourceV1 },
  contexts: AEmotionViewerDeliveryContextV1[],
  options: Partial<{
    authorityValue: unknown | null;
    clock: MutableClock;
    maxAttempts: number;
    pipeline: AEmotionAuthorityFeedPipelinePortV1;
  }> = {},
) {
  const clock = options.clock ?? new MutableClock(1_000);
  const outbox = new FakeOutbox(pair.job, options.maxAttempts ?? 3, clock);
  const authority = new FakeAuthority(
    Object.hasOwn(options, "authorityValue") ? options.authorityValue ?? null : pair.source,
  );
  const viewers = new FakeViewerContexts(contexts);
  const journal = new InMemoryJournal();
  const repository = new InMemoryAEmotionFeedRepositoryV1();
  const feed = new AEmotionFeedServiceV1(repository);
  const realPipeline = new AEmotionAuthorityFeedPipelineV1(
    journal,
    new AEmotionViewerProjectorV1(
      { resolve: async () => [] },
      new FrozenAEmotionPresentationCatalogV1(),
    ),
    feed,
  );
  const pipelineCalls = { count: 0 };
  const selectedPipeline = options.pipeline ?? realPipeline;
  const pipeline: AEmotionAuthorityFeedPipelinePortV1 = {
    ingest: async (input) => {
      pipelineCalls.count += 1;
      return selectedPipeline.ingest(input);
    },
  };
  const production = createAEmotionPostCommitProductionV1({
    outbox,
    authority,
    viewers,
    pipeline,
    clock,
    config: { leaseMs: 100, infrastructureRetryMs: 10 },
  });
  const consumer = production.worker;
  return {
    authority,
    clock,
    consumer,
    feed,
    journal,
    outbox,
    pipelineCalls,
    production,
    repository,
    viewers,
  };
}

class MutableClock {
  constructor(public value: number) {}
  nowMs(): number {
    return this.value;
  }
}

class FakeAuthority {
  readCount = 0;
  readonly writeCount = 0;
  constructor(readonly value: unknown | null) {}
  async readCommitted(): Promise<unknown | null> {
    this.readCount += 1;
    return structuredClone(this.value);
  }
}

class FakeViewerContexts {
  readCount = 0;
  lastRequest: AEmotionViewerContextRequestV1 | null = null;
  constructor(readonly contexts: AEmotionViewerDeliveryContextV1[]) {}
  async readForCommittedSource(request: AEmotionViewerContextRequestV1): Promise<unknown> {
    this.readCount += 1;
    this.lastRequest = structuredClone(request);
    return structuredClone(this.contexts);
  }
}

class InMemoryJournal implements AEmotionInteractionJournalPortV1 {
  readonly records = new Map<string, AEmotionInteractionEventPortV1>();
  writes = 0;
  async readCommitted(idempotencyKey: string): Promise<AEmotionInteractionEventPortV1 | null> {
    return structuredClone(this.records.get(idempotencyKey) ?? null);
  }
  async append(input: { event: AEmotionInteractionEventPortV1 }): Promise<{
    status: "COMMITTED" | "REPLAYED";
    event: AEmotionInteractionEventPortV1;
  }> {
    const current = this.records.get(input.event.idempotencyKey);
    if (current) {
      if (current.eventHash !== input.event.eventHash) throw new Error("journal fingerprint mismatch");
      return { status: "REPLAYED", event: structuredClone(current) };
    }
    this.records.set(input.event.idempotencyKey, structuredClone(input.event));
    this.writes += 1;
    return { status: "COMMITTED", event: structuredClone(input.event) };
  }
}

class FakeOutbox implements AEmotionAuthorityOutboxPortV1 {
  status: "PENDING" | "LEASED" | "RETRYABLE" | "COMPLETED" | "DEAD_LETTER" = "PENDING";
  fence = 0;
  attemptCount = 0;
  availableAtMs = 0;
  crashNextAcknowledge = false;
  readonly ackRequests: Array<{ outboxId: string; fence: number }> = [];
  readonly retryRequests: Array<Record<string, unknown>> = [];
  readonly deadLetterRequests: Array<Record<string, unknown>> = [];

  constructor(
    readonly job: AEmotionAuthorityOutboxJobV1,
    readonly maxAttempts: number,
    readonly clock: MutableClock,
  ) {}

  async claimNext() {
    if (this.status === "COMPLETED" || this.status === "DEAD_LETTER") return { kind: "EMPTY" as const };
    if (this.status === "LEASED" || this.clock.nowMs() < this.availableAtMs) {
      return { kind: "BUSY" as const, retryAtMs: Math.max(this.availableAtMs, this.clock.nowMs() + 1) };
    }
    this.status = "LEASED";
    this.fence += 1;
    return {
      kind: "CLAIMED" as const,
      outboxId: "aemotion-outbox-1",
      fence: this.fence,
      attemptCount: this.attemptCount,
      maxAttempts: this.maxAttempts,
      job: structuredClone(this.job),
    };
  }

  async acknowledge(request: { outboxId: string; fence: number }): Promise<void> {
    this.assertFence(request);
    if (this.crashNextAcknowledge) {
      this.crashNextAcknowledge = false;
      throw new Error("SIMULATED_CRASH_AFTER_INGEST");
    }
    this.ackRequests.push(structuredClone(request));
    this.status = "COMPLETED";
  }

  async retry(request: {
    outboxId: string;
    fence: number;
    attemptCount: number;
    nextAttemptAtMs: number;
    reasonCode: string;
  }): Promise<void> {
    this.assertFence(request);
    this.retryRequests.push(structuredClone(request));
    this.attemptCount = request.attemptCount;
    this.availableAtMs = request.nextAttemptAtMs;
    this.status = "RETRYABLE";
  }

  async deadLetter(request: {
    outboxId: string;
    fence: number;
    attemptCount: number;
    reasonCode: string;
  }): Promise<void> {
    this.assertFence(request);
    this.deadLetterRequests.push(structuredClone(request));
    this.attemptCount = request.attemptCount;
    this.status = "DEAD_LETTER";
  }

  recoverExpiredLease(): void {
    assert.equal(this.status, "LEASED");
    this.availableAtMs = 0;
    this.status = "RETRYABLE";
  }

  private assertFence(request: { outboxId: string; fence: number }): void {
    assert.equal(request.outboxId, "aemotion-outbox-1");
    assert.equal(request.fence, this.fence);
    assert.equal(this.status, "LEASED");
  }
}
