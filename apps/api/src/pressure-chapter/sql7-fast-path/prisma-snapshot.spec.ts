import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  computeDecisionActionRequestFingerprint,
  sha256Canonical,
} from "@ai-story/shared";
import {
  PrismaDecisionToNextProjectionSnapshotReaderV1,
  type Sql7SnapshotPrismaClientV1,
} from "./prisma-snapshot";
import type { DecisionToNextProjectionSnapshotRequestV1 } from "./snapshot-contract";

const HASH = sha256Canonical({ sql7: "snapshot" });
const INPUT: DecisionToNextProjectionSnapshotRequestV1 & { capturedAtMs: number } = {
  roomId: "run-1",
  runId: "run-1",
  subjectId: "user-1",
  seatId: "zhejiang_governor",
  chapterRuntimeId: "runtime-1",
  decisionPointId: "decision-1",
  expectedRouteHash: HASH,
  expectedWorkingRevision: 1,
  expectedControlEpoch: 1,
  expectedSubmissionFenceToken: HASH,
  idempotencyKey: "submit-1",
  capturedAtMs: 1_000,
};

class FakePrisma implements Sql7SnapshotPrismaClientV1 {
  calls: unknown[] = [];

  constructor(private readonly rows: unknown[]) {}

  async $queryRaw<TResult>(query: unknown): Promise<TResult> {
    this.calls.push(query);
    return structuredClone(this.rows) as TResult;
  }
}

test("normal snapshot executes exactly one application SQL and returns null for a missing aggregate row", async () => {
  const prisma = new FakePrisma([]);
  const reader = new PrismaDecisionToNextProjectionSnapshotReaderV1(prisma);

  assert.equal(await reader.capture(INPUT), null);
  assert.equal(prisma.calls.length, 1);
});

test("snapshot returns null for missing required authorities after the single SQL call", async () => {
  const prisma = new FakePrisma([{
    routeRecord: null,
    worldRecord: null,
    orchestratorStats: { count: 0, minRevision: null, maxRevision: null, latestState: null },
    runtimeRecord: null,
    seatRecord: null,
    viewerRows: [],
    existingDecisionActionRows: [],
    narrativeProjectionRows: [],
    aEmotionAggregateRows: [],
    viewerDeliveryRows: [],
    aEmotionDeliveryMarkRows: [],
    existingSettlementRecord: null,
  }]);
  const reader = new PrismaDecisionToNextProjectionSnapshotReaderV1(prisma);

  assert.equal(await reader.capture(INPUT), null);
  assert.equal(prisma.calls.length, 1);
});

test("prior action replay fails closed when the current viewer does not own its seat", async () => {
  const prisma = new FakePrisma([{
    routeRecord: null,
    worldRecord: null,
    orchestratorStats: null,
    runtimeRecord: null,
    seatRecord: null,
    viewerRows: [],
    existingDecisionActionRows: [persistedActionRow()],
    narrativeProjectionRows: [],
    aEmotionAggregateRows: [],
    viewerDeliveryRows: [],
    aEmotionDeliveryMarkRows: [],
    existingSettlementRecord: {
      id: "settlement-n1",
      runId: INPUT.runId,
      chapterRuntimeId: INPUT.chapterRuntimeId,
      chapterId: "N1",
    },
  }]);
  const reader = new PrismaDecisionToNextProjectionSnapshotReaderV1(prisma);

  await assert.rejects(
    reader.capture(INPUT),
    /SQL7_SNAPSHOT_INVALID:viewerRows:MEMBERSHIP_AMBIGUOUS_OR_MISSING/u,
  );
  assert.equal(prisma.calls.length, 1);
});

test("completed same-key action is returned as a replay snapshot before stale N2 authorities decode", async () => {
  const prisma = new FakePrisma([{
    routeRecord: null,
    worldRecord: null,
    orchestratorStats: null,
    runtimeRecord: null,
    seatRecord: null,
    viewerRows: [viewerRow()],
    existingDecisionActionRows: [persistedActionRow()],
    narrativeProjectionRows: [],
    aEmotionAggregateRows: [],
    viewerDeliveryRows: [],
    aEmotionDeliveryMarkRows: [],
    existingSettlementRecord: {
      id: "settlement-n1",
      runId: INPUT.runId,
      chapterRuntimeId: INPUT.chapterRuntimeId,
      chapterId: "N1",
    },
  }]);
  const reader = new PrismaDecisionToNextProjectionSnapshotReaderV1(prisma);

  const result = await reader.capture(INPUT);
  assert.equal(
    result?.schemaVersion,
    "pressure_decision_to_next_projection_prior_action_snapshot_v1",
  );
  if (result?.schemaVersion !== "pressure_decision_to_next_projection_prior_action_snapshot_v1") return;
  assert.equal(result.action.idempotencyKey, INPUT.idempotencyKey);
  assert.equal(result.settlementCompleted, true);
  assert.equal(prisma.calls.length, 1);
});

test("invalid room binding fails before touching Prisma", async () => {
  const prisma = new FakePrisma([]);
  const reader = new PrismaDecisionToNextProjectionSnapshotReaderV1(prisma);

  await assert.rejects(
    reader.capture({ ...INPUT, roomId: "other-room" }),
    /SQL7_SNAPSHOT_INVALID:captureInput:INVALID_INPUT:run-1/u,
  );
  assert.equal(prisma.calls.length, 0);
});

test("source contains one query call and no transaction or write delegate", () => {
  const source = readFileSync(resolve(__dirname, "prisma-snapshot.ts"), "utf8");

  assert.equal((source.match(/\.\$queryRaw</gu) ?? []).length, 1);
  assert.doesNotMatch(source, /\.\$transaction\s*\(/u);
  assert.doesNotMatch(source, /\.(?:create|createMany|update|updateMany|delete|deleteMany)\s*\(/u);
  assert.match(source, /WITH request_input AS/u);
  assert.match(source, /PRESSURE_CHAPTER_ORCHESTRATOR_STATE/u);
  assert.match(source, /MEMBERSHIP_AMBIGUOUS_OR_MISSING/u);
  assert.match(source, /W3_W4_W5_BINDING_MISMATCH/u);
  assert.match(source, /SEAT_FENCE_MISMATCH/u);
  assert.match(
    source,
    /aggregate_event\.id = delivery\."eventId"[\s\S]*aggregate_event\."type" = 'PRESSURE_A_EMOTION_AGGREGATE_V1'/u,
  );
  assert.match(
    source,
    /storedViewerPrivateProjection[\s\S]*compileSangtianSeatPrivateProjectionFromCapturedAuthoritiesV1/u,
  );
});

function persistedActionRow() {
  const payload = { optionCode: "SUPPORT", customText: null };
  const base = {
    schemaVersion: "sangtian_decision_action_v1" as const,
    actionId: "action-prior",
    runId: INPUT.runId,
    chapterRuntimeId: INPUT.chapterRuntimeId,
    chapterId: "N1" as const,
    decisionPointId: INPUT.decisionPointId,
    seatId: INPUT.seatId,
    actionOrdinal: 1,
    actionRevision: 1,
    controlEpoch: INPUT.expectedControlEpoch,
    expectedWorkingRevision: INPUT.expectedWorkingRevision,
    status: "SEALED" as const,
    actionType: "SUPPORT_ACTION",
    payload,
    payloadHash: sha256Canonical(payload),
    idempotencyKey: INPUT.idempotencyKey,
  };
  const withRequest = {
    ...base,
    requestFingerprint: computeDecisionActionRequestFingerprint(base),
  };
  return {
    id: base.actionId,
    runId: base.runId,
    chapterRuntimeId: base.chapterRuntimeId,
    decisionPointId: base.decisionPointId,
    seatId: base.seatId,
    actionOrdinal: base.actionOrdinal,
    actionType: base.actionType,
    status: base.status,
    controlEpoch: base.controlEpoch,
    expectedWorkingRevision: base.expectedWorkingRevision,
    currentRevision: base.actionRevision,
    idempotencyKey: base.idempotencyKey,
    requestFingerprint: withRequest.requestFingerprint,
    payloadJson: payload,
    payloadHash: base.payloadHash,
    sealedHash: sha256Canonical(withRequest),
  };
}

function viewerRow() {
  return {
    playerId: "player-1",
    runId: INPUT.runId,
    userId: INPUT.subjectId,
    playerType: "human",
    status: "active",
    roleId: "role-1",
    roleRunId: INPUT.runId,
    roleKey: INPUT.seatId,
    roleName: "viewer",
  };
}
