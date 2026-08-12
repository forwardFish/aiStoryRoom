import assert from "node:assert/strict";
import test from "node:test";
import {
  computeDecisionActionRequestFingerprint,
  sha256Canonical,
  validateDecisionActionV1,
  type CanonicalJsonObject,
} from "@ai-story/shared";
import {
  aEmotionAggregationKey,
  aEmotionProjectionIdempotencyKey,
} from "../a-emotion/identity";
import {
  encodeAggregateEnvelope,
  encodeDeliveryMark,
  encodeInteractionEnvelope,
} from "../a-emotion-persistence/codec";
import { pressureSimplePromiseIdV1 } from "../a-emotion-promise/policy";
import {
  CanonicalAEmotionAuthorityEventCompilerV1,
  sealAEmotionAuthorityOutboxJobV1,
  sealAEmotionCommittedAuthoritySourceV1,
} from "./compiler";
import {
  compileCommittedInvestigationLifecycleEmissionsV1,
  type PressureInvestigationLifecycleReadTransactionV1,
} from "./investigation-lifecycle.prisma-bridge";

const RUN_ID = "run-investigation-bridge";
const NOW = "2026-08-12T08:00:00.000Z";

test("acknowledged actor-visible committed investigation produces one monotonic outbox emission", async () => {
  const current = lifecycleEvent("HIDDEN", "hidden-root", 65_000_001);
  const tx = authorityTx(current, true);
  const action = investigationAction(
    "INVESTIGATE_LEDGER_SOURCE",
    current.eventId,
  );
  const emissions = await compileCommittedInvestigationLifecycleEmissionsV1({
    tx,
    beatEvent: beatEvent(action.actionId),
    projection: projection(action, []),
    committedAt: NOW,
  });

  assert.equal(emissions.length, 1);
  const upgraded = new CanonicalAEmotionAuthorityEventCompilerV1()
    .compile(emissions[0]!.job, emissions[0]!.source);
  assert.equal(upgraded.disclosure, "SUSPECTED");
  assert.equal(upgraded.revealOfEventId, current.eventId);
  assert.equal(upgraded.sourceSeatId, "qingliu_law");
  assert.equal(upgraded.eventSequence > current.eventSequence, true);
  assert.deepEqual(upgraded.evidenceRefs, []);
});

test("unacknowledged response and evidence-free confirmation both produce zero emission", async () => {
  const hidden = lifecycleEvent("HIDDEN", "hidden-unacked", 65_000_001);
  const suspectAction = investigationAction("INVESTIGATE_LEDGER_SOURCE", hidden.eventId);
  assert.deepEqual(await compileCommittedInvestigationLifecycleEmissionsV1({
    tx: authorityTx(hidden, false),
    beatEvent: beatEvent(suspectAction.actionId),
    projection: projection(suspectAction, []),
    committedAt: NOW,
  }), []);

  const suspected = lifecycleEvent("SUSPECTED", "suspected-no-evidence", 65_000_002);
  const confirmAction = investigationAction(
    "CONFIRM_LEDGER_SOURCE_WITH_EVIDENCE",
    suspected.eventId,
  );
  assert.deepEqual(await compileCommittedInvestigationLifecycleEmissionsV1({
    tx: authorityTx(suspected, true),
    beatEvent: beatEvent(confirmAction.actionId),
    projection: projection(confirmAction, []),
    committedAt: NOW,
  }), []);
});

test("confirmed evidence may reveal an already broken Promise but BROKEN alone never does", async () => {
  const current = lifecycleEvent("SUSPECTED", "suspected-root", 65_000_002);
  const action = investigationAction(
    "CONFIRM_LEDGER_SOURCE_WITH_EVIDENCE",
    current.eventId,
  );
  const promiseId = pressureSimplePromiseIdV1({
    runId: RUN_ID,
    issuerSeatId: "zhejiang_administration",
  });
  const emissions = await compileCommittedInvestigationLifecycleEmissionsV1({
    tx: authorityTx(current, true),
    beatEvent: beatEvent(action.actionId),
    projection: projection(action, ["evidence.ledger.custody"], {
      commitmentId: promiseId,
      operation: "BREAK",
      seatIds: ["zhejiang_administration", "zhejiang_governor"],
      sourceActionId: "action-break-copy",
    }),
    committedAt: NOW,
  });
  assert.equal(emissions.length, 1);
  const upgraded = new CanonicalAEmotionAuthorityEventCompilerV1()
    .compile(emissions[0]!.job, emissions[0]!.source);
  assert.equal(upgraded.disclosure, "CONFIRMED");
  assert.equal(upgraded.eventCode, "PROMISE_DELIVER_LEDGER_BROKEN");
  assert.equal(upgraded.promiseId, promiseId);
  assert.equal(upgraded.presentation.modalTrigger?.type, "PROMISE_BROKEN");
  assert.deepEqual(upgraded.evidenceRefs, ["evidence.ledger.custody"]);
});

function investigationAction(actionType: string, responseToEventId: string) {
  const payload: CanonicalJsonObject = {
    interactionKind: "A_EMOTION_INVESTIGATION",
    investigationCode: actionType,
    responseToEventId,
    sharedObjectId: "original-grain-ledger",
  };
  const base = {
    schemaVersion: "sangtian_decision_action_v1" as const,
    actionId: `action-${actionType}`,
    runId: RUN_ID,
    chapterRuntimeId: "runtime-N6",
    chapterId: "N6" as const,
    decisionPointId: "N6.ledger_exchange",
    seatId: "qingliu_law" as const,
    actionOrdinal: 1,
    actionRevision: 1,
    controlEpoch: 1,
    expectedWorkingRevision: 1,
    status: "SEALED" as const,
    actionType,
    payload,
    payloadHash: sha256Canonical(payload),
    idempotencyKey: `idem-${actionType}`,
  };
  const requestFingerprint = computeDecisionActionRequestFingerprint(base);
  const sealed = { ...base, requestFingerprint };
  return validateDecisionActionV1({ ...sealed, sealedHash: sha256Canonical(sealed) });
}

function beatEvent(actionId: string) {
  return {
    schemaVersion: "pressure_working_ledger_event_v1" as const,
    runId: RUN_ID,
    chapterRuntimeId: "runtime-N6",
    chapterId: "N6" as const,
    sequence: 3,
    previousEventHash: sha256Canonical("previous"),
    payload: {
      eventType: "BEAT_APPLIED" as const,
      beatResolution: {
        sealedActionIds: [actionId],
        committedWorkingRevision: 2,
      },
    },
    eventHash: sha256Canonical({ beat: actionId }),
  } as never;
}

function projection(
  action: ReturnType<typeof investigationAction>,
  evidenceRefs: string[],
  commitment?: {
    commitmentId: string;
    operation: "BREAK";
    seatIds: ["zhejiang_administration", "zhejiang_governor"];
    sourceActionId: string;
  },
) {
  return {
    acceptedActions: new Map([[action.actionId, {
      action,
      routeHash: sha256Canonical("route"),
      inputFingerprint: sha256Canonical("input"),
      intent: { evidenceRefs },
      audienceSeatIds: ["qingliu_law", "zhejiang_governor"],
      eventHash: sha256Canonical("accepted"),
    }]]),
    commitments: new Map(commitment ? [[commitment.commitmentId, commitment]] : []),
  } as never;
}

function lifecycleEvent(
  disclosure: "HIDDEN" | "SUSPECTED",
  label: string,
  eventSequence: number,
) {
  const sourceHash = sha256Canonical({ label });
  const job = sealAEmotionAuthorityOutboxJobV1({
    schemaVersion: "a_emotion_authority_outbox_job_v1",
    sourceKind: "FORMAL_COMMITMENT_COMMITTED",
    runId: RUN_ID,
    sourceId: sourceHash,
    sourceCommitHash: sourceHash,
    signalId: label,
  });
  const source = sealAEmotionCommittedAuthoritySourceV1({
    schemaVersion: "a_emotion_committed_authority_source_v1",
    sourceKind: job.sourceKind,
    sourceId: sourceHash,
    sourceCommitHash: sourceHash,
    roomId: RUN_ID,
    runId: RUN_ID,
    stageId: "N6",
    sourceActionId: `action-${label}`,
    sourceSeatId: "zhejiang_administration",
    committedAt: NOW,
    eventSequence,
    stateVersion: disclosure === "HIDDEN" ? 1 : 2,
    storyDay: 6,
    signal: {
      signalId: label,
      kind: disclosure === "HIDDEN" ? "DIRECT_IMPACT" : "REVEAL",
      eventCode: disclosure === "HIDDEN" ? "LEDGER_DELIVERY_ANOMALY" : "LEDGER_SOURCE_SUSPECTED",
      eventFamily: "LEDGER_FLOW",
      severity: "MAJOR",
      sharedObjectId: "original-grain-ledger",
      factRefs: [], publicFactRefs: [], impacts: [],
      audienceSpec: { type: "EXPLICIT", seatIds: ["qingliu_law", "zhejiang_governor"] },
      disclosure,
      suspectedSeatIds: disclosure === "SUSPECTED" ? ["zhejiang_administration"] : [],
      suspicionBasisRefs: disclosure === "SUSPECTED"
        ? ["fact.formal-promise.ledger-source-suspected"] : [],
      evidenceRefs: [],
      revealOfEventId: disclosure === "SUSPECTED" ? "prior-hidden" : null,
      promiseId: "promise-root",
      milestoneId: null,
      metricTransitionId: null,
      presentation: {
        recommendedPresentation: "CENTER_CARD",
        centerCardType: "CROSS_IMPACT",
        responseOptions: [],
        modalTrigger: null,
      },
    },
  }, job);
  return new CanonicalAEmotionAuthorityEventCompilerV1().compile(job, source);
}

function authorityTx(current: ReturnType<typeof lifecycleEvent>, acknowledged: boolean) {
  const projectionBody = {
    schemaVersion: "a_emotion_viewer_projection_v1" as const,
    eventId: current.eventId,
    projectionVersion: 1,
    roomId: RUN_ID,
    runId: RUN_ID,
    viewerSeatId: "qingliu_law" as const,
    category: "RELATED" as const,
    disclosure: current.disclosure,
    severity: current.severity,
    title: "账册来源",
    safeSummary: "来源正在核验",
    statusLabel: "待核验",
    visibleImpacts: [], knownFactRefs: [], responseOptions: [],
    recommendedPresentation: "FEED_ONLY" as const,
    centerCard: null, keyModal: null,
    eventSequence: current.eventSequence,
    occurredAt: current.occurredAt,
    ...(current.disclosure === "SUSPECTED"
      ? { visibleSuspectedSeatIds: ["zhejiang_administration" as const] }
      : {}),
  };
  const viewerProjection = {
    ...projectionBody,
    projectionHash: sha256Canonical(projectionBody),
  };
  const aggregationKey = aEmotionAggregationKey({
    roomId: RUN_ID,
    runId: RUN_ID,
    viewerSeatId: "qingliu_law",
    eventId: current.eventId,
  });
  const aggregate = {
    aggregationKey, roomId: RUN_ID, runId: RUN_ID,
    viewerSeatId: "qingliu_law" as const, stageId: "N6",
    sharedObjectId: "original-grain-ledger", eventFamily: "LEDGER_FLOW",
    latestEventId: current.eventId, projectionVersion: 1,
    projection: viewerProjection, createdAt: NOW, updatedAt: NOW,
  };
  const idempotencyKey = aEmotionProjectionIdempotencyKey({
    eventId: current.eventId,
    viewerSeatId: "qingliu_law",
  });
  const commit = {
    idempotencyKey,
    inputFingerprint: sha256Canonical({ current: current.eventId }),
    expectedAggregateVersion: 0,
    aggregate,
    delivery: {
      eventId: current.eventId, projectionVersion: 1,
      roomId: RUN_ID, runId: RUN_ID, viewerSeatId: "qingliu_law" as const,
      deliveredAt: NOW, seenAt: NOW, acknowledgedAt: acknowledged ? NOW : null,
      resolvedAt: null, keyModalShownAt: null,
    },
  };
  const rows = {
    PRESSURE_A_EMOTION_INTERACTION_V1: [{
      id: "interaction", runId: RUN_ID, type: "PRESSURE_A_EMOTION_INTERACTION_V1",
      payloadJson: encodeInteractionEnvelope({ event: current, storyDay: 6 }),
    }],
    PRESSURE_A_EMOTION_AGGREGATE_V1: [{
      id: "aggregate", runId: RUN_ID, type: "PRESSURE_A_EMOTION_AGGREGATE_V1",
      payloadJson: encodeAggregateEnvelope({
        idempotencyKey, inputFingerprint: commit.inputFingerprint,
        expectedAggregateVersion: 0, commit, storyDay: 6,
      }),
    }],
    PRESSURE_A_EMOTION_DELIVERY_MARK_V1: acknowledged ? [{
      id: "mark", runId: RUN_ID, type: "PRESSURE_A_EMOTION_DELIVERY_MARK_V1",
      payloadJson: encodeDeliveryMark({
        storyDay: 6, roomId: RUN_ID, runId: RUN_ID,
        viewerSeatId: "qingliu_law", eventId: current.eventId,
        projectionVersion: 1, operation: "ACKNOWLEDGED", occurredAt: NOW,
      }),
    }] : [],
  } as Record<string, Array<{ id: string; runId: string; type: string; payloadJson: unknown }>>;
  return {
    storyEvent: {
      findMany: async (query: Record<string, unknown>) => {
        const type = (query.where as { type: string }).type;
        return structuredClone(rows[type] ?? []);
      },
    },
  } satisfies PressureInvestigationLifecycleReadTransactionV1;
}
