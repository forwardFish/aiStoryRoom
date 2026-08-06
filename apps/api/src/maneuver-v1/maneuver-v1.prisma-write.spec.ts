import assert from "node:assert/strict";
import test from "node:test";
import type { CreateCommittedManeuverV1 } from "./maneuver-v1.core";
import { createCommittedManeuverV1 } from "./maneuver-v1.prisma-write";

function input(): CreateCommittedManeuverV1 {
  return {
    userId: "user.viewer",
    slot: "MANEUVER_1",
    idempotencyKey: "commit:fallback-investigation:001",
    requestHash: "request-hash",
    draft: {
      kind: "INVESTIGATE",
      traceId: "trace.canon.abc",
      routeId: "route.verify.abc",
      expectedTurnRevision: 2,
    },
    compiled: {
      schemaVersion: "compiled_maneuver_v1",
      kind: "INVESTIGATION",
      actorRoleId: "role.viewer",
      targetRef: "trace.canon.abc",
      objective: "Verify the recorded source",
      method: "Review the observable source record.",
      primaryEffect: "START_INVESTIGATION",
      visibility: "PRIVATE",
      guaranteedStart: ["A bounded verification begins."],
      contestedOutcome: ["The recorded statement may be confirmed."],
      notGuaranteed: ["Intent cannot be established from this source alone."],
      stateRevision: 4,
      turnRevision: 2,
    },
    immediateReceipt: {
      title: "Verify the recorded source",
      narrative: "A bounded verification begins.",
      visibility: "PRIVATE",
    },
    context: {
      runId: "run.1",
      userId: "user.viewer",
      roleId: "role.viewer",
      actorTurnId: "turn.1",
      nodeId: "node.1",
      stageIndex: 1,
      stateRevision: 4,
      turnRevision: 2,
      controlEpoch: 1,
      windowState: "OPEN",
      mainlineLocked: false,
      usedSlots: [],
      compilerContext: {
        actorRoleId: "role.viewer",
        stateRevision: 4,
        turnRevision: 2,
        contacts: [],
        traces: [{
          traceId: "trace.canon.abc",
          label: "Visible confirmed record",
          description: "A confirmed role-visible record exists.",
          sourceKind: "DOCUMENT",
          routeOptions: [{
            routeId: "route.verify.abc",
            label: "Verify the recorded source",
            method: "Review the observable source record.",
            guaranteedStart: "A bounded verification begins.",
            contestedOutcome: "The recorded statement may be confirmed.",
            notGuaranteed: "Intent cannot be established from this source alone.",
          }],
        }],
        leverageAssets: [],
        legalTargetIds: ["trace.canon.abc"],
      },
      investigationOutcomes: [{
        routeId: "route.verify.abc",
        factKey: "fact.visible.confirmed",
        title: "Visible confirmed record",
        summary: "The confirmed record can be verified.",
        supports: "The recorded event occurred.",
        cannotProve: "Who intended the event.",
        sourceKind: "RECORD",
        provenanceKey: "canon:fact.visible.confirmed",
      }],
    },
  };
}

function actionRow(status = "PENDING", resolvedAt: Date | null = null) {
  return {
    id: "action.1",
    actionSlot: "MANEUVER_1",
    status,
    idempotencyKey: "commit:fallback-investigation:001",
    requestHash: "request-hash",
    immediateJson: {
      schemaVersion: "maneuver_commit_receipt_v1",
      actorTurnId: "turn.1",
      immediateReceipt: {
        title: "Verify the recorded source",
        narrative: "A bounded verification begins.",
        visibility: "PRIVATE",
      },
      remaining: 1,
    },
    resolvedAt,
  };
}

test("fallback CanonFact investigation commits from the transaction-authoritative context", async () => {
  let actorTurnRead = false;
  let playerActionUpdated = false;
  let evidenceState: unknown = null;
  const resolvedAt = new Date("2026-08-06T00:00:00.000Z");
  const db = {
    playerAction: {
      create: async () => actionRow(),
      update: async ({ where, data }: any) => {
        playerActionUpdated = true;
        assert.deepEqual(where, { id: "action.1" });
        assert.equal(data.status, "RESOLVED");
        assert.deepEqual(data.resolvedAt instanceof Date, true);
        assert.equal(data.resolvedJson.schemaVersion, "maneuver_investigation_result_v1");
        assert.equal(data.resolvedJson.privateEvidenceAssetId, "asset.evidence.1");
        assert.equal(data.resolvedJson.provenanceKey, "canon:fact.visible.confirmed");
        return actionRow("RESOLVED", resolvedAt);
      },
    },
    actorTurn: {
      findUnique: async () => {
        actorTurnRead = true;
        throw new Error("ActorTurn.contextJson must not be re-read for a validated fallback route");
      },
    },
    canonFact: {
      findFirst: async ({ where }: any) => {
        assert.equal(where.factKey, "fact.visible.confirmed");
        assert.equal(where.status, "confirmed");
        return { id: "fact-row.1" };
      },
    },
    roleAsset: {
      findFirst: async () => null,
      create: async ({ data }: any) => {
        evidenceState = data.stateJson;
        assert.equal(data.ownerRoleId, "role.viewer");
        assert.equal(data.visibility, "PRIVATE");
        assert.equal(data.kind, "PRIVATE_EVIDENCE_V1");
        return { id: "asset.evidence.1" };
      },
    },
    roleAssetMutation: {
      create: async ({ data }: any) => {
        assert.equal(data.actionId, "action.1");
        assert.equal(data.toRoleId, "role.viewer");
        return { id: "mutation.1" };
      },
    },
  };

  const result = await createCommittedManeuverV1(db as never, input());

  assert.equal(actorTurnRead, false);
  assert.equal(playerActionUpdated, true);
  assert.equal(result.status, "RESOLVED");
  assert.equal(result.remaining, 1);
  assert.deepEqual(evidenceState, {
    evidenceId: (evidenceState as any).evidenceId,
    title: "Visible confirmed record",
    summary: "The confirmed record can be verified.",
    supports: "The recorded event occurred.",
    cannotProve: "Who intended the event.",
    sourceKind: "RECORD",
    provenanceKey: "canon:fact.visible.confirmed",
    obtainedFromActionId: "action.1",
    visibility: "PRIVATE",
  });
});
