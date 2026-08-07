import assert from "node:assert/strict";
import test from "node:test";
import type { B0ActionContractV1, B0SettlementWindowV1 } from "@ai-story/shared";
import type {
  B0PublicationDeliveryV1,
  ManeuverCompilerContextV1,
} from "@ai-story/templates";
import type { ManeuverPreviewTokenPayloadV1 } from "../maneuver-v1/maneuver-v1.core";
import type { B0WindowProjectionV1 } from "./b0-window-coordinator.core";
import {
  B0PlayerWindowErrorV1,
  mapManeuverPreviewToB0ActionV1,
  normalizeB0PlayerPlanPresentationV1,
  projectB0PlayerWindowV1,
} from "./b0-window-player.core";

function window(status: B0SettlementWindowV1["status"] = "OPEN"): B0SettlementWindowV1 {
  return {
    schemaVersion: "b0-settlement-window-v1",
    id: "window.player.one",
    roomId: "run.player.one",
    runId: "run.player.one",
    mode: "WINDOWED",
    ordinal: 1,
    situationId: "situation.player.one",
    baseWorldSequence: 7,
    expectedActorIds: ["actor.a", "actor.b"],
    readyActorIds: [],
    openedAt: "2026-08-07T00:00:00.000Z",
    locksAt: "2026-08-07T00:05:00.000Z",
    lockedAt: status === "OPEN" ? null : "2026-08-07T00:05:00.000Z",
    committedAt: status === "COMMITTED" || status === "COMPLETED" ? "2026-08-07T00:05:05.000Z" : null,
    completedAt: status === "COMPLETED" ? "2026-08-07T00:05:10.000Z" : null,
    status,
    lockReason: status === "OPEN" ? null : "ALL_READY",
    rulesetVersion: "b0-rules-v1",
    schemaRevision: 1,
  };
}

function compilerContext(): ManeuverCompilerContextV1 {
  return {
    actorRoleId: "actor.a",
    stateRevision: 7,
    turnRevision: 3,
    contacts: [{
      id: "actor.b",
      label: "Counterpart",
      method: "Send a private request.",
      guaranteedStart: "The request is delivered.",
      contestedOutcome: "The counterpart may refuse.",
      notGuaranteed: "Agreement is not guaranteed.",
      visibility: "TARGETED",
    }],
    traces: [{
      traceId: "trace.one",
      label: "A visible discrepancy",
      description: "Two records disagree.",
      sourceKind: "DOCUMENT",
      routeOptions: [{
        routeId: "route.one",
        label: "Compare the copies",
        method: "Compare the signed copies.",
        guaranteedStart: "The comparison starts.",
        contestedOutcome: "The source may remain uncertain.",
        notGuaranteed: "Intent cannot be proven.",
      }],
    }],
    leverageAssets: [{
      assetId: "asset.a",
      label: "Private channel",
      effectSummary: "Changes the access boundary.",
      primaryEffect: "Open access",
      method: "Use the private channel.",
      legalTargetIds: ["actor.b", "trace.one"],
      guaranteedStart: "The channel is used.",
      contestedOutcome: "The target may still refuse.",
      notGuaranteed: "Success is not guaranteed.",
      visibility: "PRIVATE",
    }],
    legalTargetIds: ["actor.a", "actor.b", "trace.one"],
  };
}

function tokenPayload(kind: "CONTACT" | "INVESTIGATE" = "CONTACT"): ManeuverPreviewTokenPayloadV1 {
  const contact = kind === "CONTACT";
  return {
    schemaVersion: "maneuver_preview_token_v1",
    runId: "run.player.one",
    userId: "user.a",
    actorRoleId: "actor.a",
    actorTurnId: "turn.a",
    stateRevision: 7,
    turnRevision: 3,
    controlEpoch: 2,
    slotVersion: 0,
    draft: contact
      ? { kind: "CONTACT", targetId: "actor.b", rawText: "Ask for support.", expectedTurnRevision: 3, leverageAssetId: "asset.a" }
      : { kind: "INVESTIGATE", traceId: "trace.one", routeId: "route.one", expectedTurnRevision: 3 },
    compiled: contact
      ? {
          schemaVersion: "compiled_maneuver_v1",
          kind: "CONVERSATION",
          actorRoleId: "actor.a",
          targetRef: "actor.b",
          objective: "Ask the counterpart for bounded support.",
          method: "Send one private request.",
          primaryEffect: "Open a response opportunity.",
          attachedLeverageId: "asset.a",
          visibility: "TARGETED",
          guaranteedStart: ["The request is delivered."],
          contestedOutcome: ["The counterpart may refuse."],
          notGuaranteed: ["Agreement is not guaranteed."],
          stateRevision: 7,
          turnRevision: 3,
        }
      : {
          schemaVersion: "compiled_maneuver_v1",
          kind: "INVESTIGATION",
          actorRoleId: "actor.a",
          targetRef: "trace.one",
          objective: "Compare the visible records.",
          method: "Compare the two signed copies.",
          primaryEffect: "Verify one bounded discrepancy.",
          visibility: "PRIVATE",
          guaranteedStart: ["The comparison starts."],
          contestedOutcome: ["The source may remain uncertain."],
          notGuaranteed: ["Intent cannot be proven."],
          stateRevision: 7,
          turnRevision: 3,
        },
    issuedAt: "2026-08-07T00:00:00.000Z",
    expiresAt: "2026-08-07T00:05:00.000Z",
  };
}

function intent(status: B0ActionContractV1["status"] = "CONFIRMED"): B0ActionContractV1 {
  return {
    ...mapManeuverPreviewToB0ActionV1({
      payload: tokenPayload(),
      window: window(),
      compilerContext: compilerContext(),
      clientRequestId: "draft:player:0001",
      now: "2026-08-07T00:00:01.000Z",
    }),
    revision: 1,
    status,
    confirmedAt: status === "CONFIRMED" || status === "LOCKED" ? "2026-08-07T00:00:02.000Z" : null,
    lockedAt: status === "LOCKED" ? "2026-08-07T00:05:00.000Z" : null,
  };
}

function coordinatorProjection(overrides: Partial<B0WindowProjectionV1> = {}): B0WindowProjectionV1 {
  return {
    schemaVersion: "b0-window-projection-v1",
    window: window(),
    actorId: "actor.a",
    actorReady: false,
    readyCount: 1,
    expectedCount: 2,
    latestDraft: null,
    lastConfirmed: intent("CONFIRMED"),
    lockedIntent: null,
    batch: null,
    ...overrides,
  };
}

function delivery(recipientActorId: string, resultId: string): B0PublicationDeliveryV1 {
  return {
    schemaVersion: "b0-publication-delivery-v1",
    idempotencyKey: `delivery.${resultId}.${recipientActorId}`,
    batchId: "batch.secret",
    runId: "run.player.one",
    windowId: "window.player.one",
    resultId,
    resultKind: recipientActorId === "actor.a" ? "CROSS_PLAYER_IMPACT" : "PERSONAL_OUTCOME",
    recipientActorId,
    visibility: "TARGETED",
    sourceDisclosure: "HIDDEN",
    originActorIds: [],
    targetActorIds: [recipientActorId],
    summary: recipientActorId === "actor.a" ? "Another committed plan changed your access." : "Private result for the other actor.",
    outcomeStatus: "PARTIAL_SUCCESS",
    changes: [{ kind: "RELATION", operation: "INCREMENT", numericDelta: -1 }],
    explanation: {
      schemaVersion: "b0-causal-explanation-card-v1",
      resultId,
      reasons: [{ kind: "OTHER_PLAN", summary: "Another plan created a durable change." }],
    },
  };
}

test("C7 signed maneuver contact maps to one bounded B0 intent without arrival-order semantics", () => {
  const action = mapManeuverPreviewToB0ActionV1({
    payload: tokenPayload(),
    window: window(),
    compilerContext: compilerContext(),
    clientRequestId: "draft:player:0001",
    now: "2026-08-07T00:00:01.000Z",
  });
  assert.equal(action.kind, "INFLUENCE");
  assert.deepEqual(action.targetRefs, [{ type: "ACTOR", id: "actor.b" }]);
  assert.deepEqual(action.resourceCommitments, [{ resourceId: "asset.a", amount: 1 }]);
  assert.deepEqual(action.visibilityIntent, { type: "PRIVATE", declaredRecipientRefs: ["actor.a", "actor.b"] });
  assert.equal(action.status, "DRAFT");
  assert.equal(action.baseWorldSequence, 7);
  assert.equal(action.createdAt, "2026-08-07T00:00:01.000Z");
  assert.doesNotMatch(JSON.stringify(action), /confirmedAt.*2026-08-07T00:00:00/u);
});

test("C7 investigation maps its trace into a proposition while retaining one executable target", () => {
  const action = mapManeuverPreviewToB0ActionV1({
    payload: tokenPayload("INVESTIGATE"),
    window: window(),
    compilerContext: compilerContext(),
    clientRequestId: "draft:player:0002",
    now: "2026-08-07T00:00:01.000Z",
  });
  assert.equal(action.kind, "OBSERVE");
  assert.deepEqual(action.targetRefs, [{ type: "ACTOR", id: "actor.a" }]);
  assert.deepEqual(action.propositionRefs, ["trace.one"]);
  assert.equal(action.primaryEffect.direction, "VERIFY");
});

test("C7 preview-to-window adapter fails closed on stale world state", () => {
  assert.throws(() => mapManeuverPreviewToB0ActionV1({
    payload: tokenPayload(),
    window: { ...window(), baseWorldSequence: 8 },
    compilerContext: compilerContext(),
    clientRequestId: "draft:player:0003",
    now: "2026-08-07T00:00:01.000Z",
  }), (error: unknown) => error instanceof B0PlayerWindowErrorV1 && error.code === "PREVIEW_STALE");
});

test("C7 player projection contains only recipient-safe results and no hashes, audiences or actor lists", () => {
  const projection = projectB0PlayerWindowV1({
    projection: coordinatorProjection({
      batch: { id: "batch.secret", status: "COMMITTED", inputHash: "f".repeat(64) },
    }),
    participantVersion: 4,
    presentation: {
      title: "Ask for support",
      description: "Send a private request.",
      visibleEffect: "The request enters the shared settlement.",
      visibleRisk: "The counterpart may refuse.",
      confirmLabel: "Confirm this plan",
    },
    structuredResults: [delivery("actor.a", "result.a"), delivery("actor.b", "result.b")],
    narrative: { status: "PENDING", content: null, updatedAt: null },
    serverNow: "2026-08-07T00:03:00.000Z",
  });
  assert.equal(projection.structuredResults.length, 1);
  assert.equal(projection.structuredResults[0].resultId, "result.a");
  assert.equal(projection.readyCount, 1);
  assert.equal(projection.actor.readyRevision, 4);
  const json = JSON.stringify(projection);
  assert.doesNotMatch(json, /inputHash|resolutionHash|audience|originActorIds|targetActorIds|actor\.b|result\.b|Private result for the other actor/u);
});

test("C7 projection reconstructs locked and completed server state after refresh", () => {
  const lockedIntent = intent("LOCKED");
  const projection = projectB0PlayerWindowV1({
    projection: coordinatorProjection({
      window: window("COMPLETED"),
      actorReady: true,
      readyCount: 2,
      latestDraft: lockedIntent,
      lastConfirmed: lockedIntent,
      lockedIntent,
      batch: { id: "batch.one", status: "COMPLETED", inputHash: "0".repeat(64) },
    }),
    participantVersion: 7,
    presentation: null,
    structuredResults: [],
    narrative: { status: "AVAILABLE", content: "The settled scene is now available.", updatedAt: "2026-08-07T00:05:10.000Z" },
    serverNow: "2026-08-07T00:05:11.000Z",
  });
  assert.equal(projection.window.status, "COMPLETED");
  assert.equal(projection.plan?.status, "LOCKED");
  assert.equal(projection.settlement.status, "COMPLETED");
  assert.equal(projection.actor.ready, true);
  assert.equal(projection.narrative.status, "AVAILABLE");
});

test("C7 player plan presentation rejects internal and unknown fields", () => {
  assert.throws(() => normalizeB0PlayerPlanPresentationV1({
    title: "Plan",
    description: "Method",
    visibleEffect: "Effect",
    visibleRisk: "Risk",
    confirmLabel: "Confirm",
    predicate: "internal",
  }), (error: unknown) => error instanceof B0PlayerWindowErrorV1 && error.code === "PLAN_PRESENTATION_INVALID");
});
