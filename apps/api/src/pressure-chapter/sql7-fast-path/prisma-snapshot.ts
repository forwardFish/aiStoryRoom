import { Prisma } from "@prisma/client";
import {
  isSha256,
  sha256Canonical,
  validateDecisionActionV1,
  validateRunRouteSnapshotV1,
  validateSeatIdV1,
  validateWorldStateV1,
  type ChapterIdV1,
} from "@ai-story/shared";
import { validateOrchestratorStateV1 } from "../orchestrator/validation";
import { assertStoredRunRouteRecord } from "../run-router";
import { compileSangtianSeatPrivateProjectionFromCapturedAuthoritiesV1 } from "../product-adapters/seat-private-content.adapters";
import {
  decodeSeatEnvelope,
  presenceKey,
  privateProjectionKey,
} from "../seat-control-persistence/envelope";
import {
  decodeWorkingLedgerProjectionCacheV1,
  workingLedgerProjectionCacheHashV1,
} from "../working-ledger/projection-cache";
import { workingStateHash } from "../working-ledger/working-ledger";
import type {
  DecisionToNextProjectionProjectionSeedV1,
  DecisionToNextProjectionPriorActionSnapshotV1,
  DecisionToNextProjectionRuntimeAuthorityV1,
  DecisionToNextProjectionSnapshotReaderPortV1,
  DecisionToNextProjectionSnapshotRequestV1,
  DecisionToNextProjectionSnapshotV1,
  DecisionToNextProjectionViewerAuthorityV1,
  DecisionToNextProjectionWorldAuthorityV1,
} from "./snapshot-contract";

interface Sql7SnapshotRawRowV1 {
  routeRecord: unknown;
  worldRecord: unknown;
  orchestratorStats: unknown;
  runtimeRecord: unknown;
  seatRecord: unknown;
  viewerRows: unknown;
  existingDecisionActionRows: unknown;
  narrativeProjectionRows: unknown;
  aEmotionAggregateRows: unknown;
  viewerDeliveryRows: unknown;
  aEmotionDeliveryMarkRows: unknown;
  existingSettlementRecord: unknown;
}

export interface Sql7SnapshotPrismaClientV1 {
  $queryRaw<TResult = unknown>(query: Prisma.Sql): Promise<TResult>;
}

type CaptureInputV1 = DecisionToNextProjectionSnapshotRequestV1 & { capturedAtMs: number };

/**
 * Normal first-submit snapshot. The CTEs and JSON aggregates are deliberately
 * one PostgreSQL statement and this adapter never opens a Prisma transaction.
 */
export class PrismaDecisionToNextProjectionSnapshotReaderV1
implements DecisionToNextProjectionSnapshotReaderPortV1 {
  constructor(private readonly prisma: Sql7SnapshotPrismaClientV1) {}

  async capture(input: Readonly<CaptureInputV1>): Promise<
    DecisionToNextProjectionSnapshotV1 | DecisionToNextProjectionPriorActionSnapshotV1 | null
  > {
    validateCaptureInput(input);
    const rows = await this.prisma.$queryRaw<Sql7SnapshotRawRowV1[]>(Prisma.sql`
      WITH request_input AS (
        SELECT
          ${input.runId}::text AS run_id,
          ${input.subjectId}::text AS subject_id,
          ${input.chapterRuntimeId}::text AS chapter_runtime_id,
          ${input.decisionPointId}::text AS decision_point_id
      ),
      orchestrator_rows AS (
        SELECT
          event."id" AS event_id,
          (event."payloadJson" ->> 'revision')::integer AS revision,
          event."payloadJson" AS state_json,
          event."dedupeKey" AS dedupe_key,
          request.run_id
        FROM "StoryEvent" event
        CROSS JOIN request_input request
        WHERE event."runId" = request.run_id
          AND event."type" = 'PRESSURE_CHAPTER_ORCHESTRATOR_STATE'
      )
      SELECT
        (
          SELECT to_jsonb(route_record)
          FROM (
            SELECT route."runId", route."routeHash", route."routeJson"
            FROM "PressureRunRouteSnapshot" route
            WHERE route."runId" = request.run_id
          ) route_record
        ) AS "routeRecord",
        (
          SELECT to_jsonb(world_record)
          FROM (
            SELECT run."id" AS "runId", run."version", run."currentNodeId",
              run."worldSequence", run."reservedWorldSequence", run."stateJson"
            FROM "StoryRun" run
            WHERE run."id" = request.run_id
          ) world_record
        ) AS "worldRecord",
        jsonb_build_object(
          'count', (SELECT count(*) FROM orchestrator_rows),
          'distinctCount', (SELECT count(DISTINCT revision) FROM orchestrator_rows),
          'bindingCount', (
            SELECT count(*) FROM orchestrator_rows
            WHERE dedupe_key = 'pressure-orchestrator:' || run_id || ':' || revision::text
          ),
          'minRevision', (SELECT min(revision) FROM orchestrator_rows),
          'maxRevision', (SELECT max(revision) FROM orchestrator_rows),
          'latestState', (
            SELECT state_json FROM orchestrator_rows ORDER BY revision DESC LIMIT 1
          ),
          'latestEventId', (
            SELECT event_id FROM orchestrator_rows ORDER BY revision DESC LIMIT 1
          ),
          'latestDedupeKey', (
            SELECT dedupe_key FROM orchestrator_rows ORDER BY revision DESC LIMIT 1
          )
        ) AS "orchestratorStats",
        (
          SELECT to_jsonb(runtime_record)
          FROM (
            SELECT runtime."id", runtime."runId", runtime."chapterId",
              runtime."chapterSequence", runtime."state", runtime."baseWorldSequence",
              runtime."baseWorldStateHash", runtime."previousFrozenHash", runtime."routeHash",
              runtime."contentPackageVersion", runtime."contentHash",
              runtime."orchestrationPackageVersion", runtime."orchestrationHash",
              runtime."runtimeContractVersion", runtime."runtimeContractHash",
              runtime."workingRevision", runtime."workingStateJson", runtime."workingStateHash",
              runtime."decisionStateJson", runtime."ledgerProjectionJson",
              runtime."closeInputHash", runtime."lockVersion"
            FROM "PressureChapterRuntime" runtime
            WHERE runtime."id" = request.chapter_runtime_id
          ) runtime_record
        ) AS "runtimeRecord",
        (
          SELECT to_jsonb(seat_record)
          FROM (
            SELECT seat."runId", seat."stateRevision", seat."snapshotJson",
              seat."stateHash", seat."version"
            FROM "PressureSeatControlSnapshot" seat
            WHERE seat."runId" = request.run_id
          ) seat_record
        ) AS "seatRecord",
        (
          SELECT COALESCE(jsonb_agg(to_jsonb(viewer_record)), '[]'::jsonb)
          FROM (
            SELECT player."id" AS "playerId", player."runId", player."userId",
              player."playerType", player."status", player."roleId", role."runId" AS "roleRunId",
              role."roleKey", role."roleName"
            FROM "StoryPlayer" player
            LEFT JOIN "StoryRole" role ON role."id" = player."roleId"
            WHERE player."runId" = request.run_id
              AND player."userId" = request.subject_id
          ) viewer_record
        ) AS "viewerRows",
        (
          SELECT COALESCE(jsonb_agg(to_jsonb(action_record) ORDER BY action_record."actionOrdinal"), '[]'::jsonb)
          FROM (
            SELECT action.*
            FROM "PressureDecisionAction" action
            WHERE action."runId" = request.run_id
          ) action_record
        ) AS "existingDecisionActionRows",
        (
          SELECT COALESCE(jsonb_agg(to_jsonb(projection_record) ORDER BY projection_record."createdAt", projection_record."id"), '[]'::jsonb)
          FROM (
            SELECT projection.*
            FROM "PressureNarrativeProjection" projection
            WHERE projection."runId" = request.run_id
          ) projection_record
        ) AS "narrativeProjectionRows",
        (
          SELECT COALESCE(jsonb_agg(to_jsonb(aggregate_record) ORDER BY aggregate_record."sequence", aggregate_record."id"), '[]'::jsonb)
          FROM (
            SELECT event.*
            FROM "StoryEvent" event
            WHERE event."runId" = request.run_id
              AND event."type" = 'PRESSURE_A_EMOTION_AGGREGATE_V1'
          ) aggregate_record
        ) AS "aEmotionAggregateRows",
        (
          SELECT COALESCE(jsonb_agg(to_jsonb(delivery_record) ORDER BY delivery_record."deliverySequence", delivery_record."id"), '[]'::jsonb)
          FROM (
            SELECT delivery.*
            FROM "EventDelivery" delivery
            INNER JOIN "StoryEvent" aggregate_event
              ON aggregate_event.id = delivery."eventId"
              AND aggregate_event."runId" = request.run_id
              AND aggregate_event."type" = 'PRESSURE_A_EMOTION_AGGREGATE_V1'
            WHERE delivery."roomId" = request.run_id
              AND delivery."userId" = request.subject_id
          ) delivery_record
        ) AS "viewerDeliveryRows",
        (
          SELECT COALESCE(jsonb_agg(to_jsonb(feed_record) ORDER BY feed_record."createdAt", feed_record."id"), '[]'::jsonb)
          FROM (
            SELECT event.*
            FROM "StoryEvent" event
            WHERE event."runId" = request.run_id
              AND event."type" = 'PRESSURE_A_EMOTION_DELIVERY_MARK_V1'
          ) feed_record
        ) AS "aEmotionDeliveryMarkRows",
        (
          SELECT to_jsonb(settlement_record)
          FROM (
            SELECT settlement."id", settlement."runId", settlement."chapterRuntimeId",
              settlement."chapterId"
            FROM "PressureChapterSettlement" settlement
            WHERE settlement."runId" = request.run_id
              AND settlement."chapterId" = 'N1'
          ) settlement_record
        ) AS "existingSettlementRecord"
      FROM request_input request
    `);
    if (rows.length === 0) return null;
    if (rows.length !== 1) invalid("query", "AMBIGUOUS_RESULT", input.runId);
    const priorAction = decodePriorActionSnapshot(rows[0]!, input);
    if (priorAction) return priorAction;
    if (hasAnyPriorOutcome(rows[0]!, input.runId)) return null;
    if (!hasRequiredSnapshotAuthorities(rows[0]!)) return null;
    return decodeDecisionToNextProjectionSnapshotV1(rows[0]!, input);
  }
}

function decodePriorActionSnapshot(
  raw: Sql7SnapshotRawRowV1,
  input: Readonly<CaptureInputV1>,
): DecisionToNextProjectionPriorActionSnapshotV1 | null {
  const actionRows = boundRows(
    raw.existingDecisionActionRows,
    "existingDecisionActionRows",
    input,
    ["id"],
  );
  const matches = actionRows.filter((row) => row.idempotencyKey === input.idempotencyKey);
  if (matches.length === 0) return null;
  if (matches.length !== 1) {
    invalid("existingDecisionActionRows", "IDEMPOTENCY_KEY_AMBIGUOUS", input.runId);
  }
  const action = validateDecisionActionV1(actionFromPersistenceRow(matches[0]!, input.runId));
  assertPriorActionViewer(raw.viewerRows, action.seatId, input);
  const settlement = raw.existingSettlementRecord === null
    || raw.existingSettlementRecord === undefined
    ? null
    : record(raw.existingSettlementRecord, "existingSettlementRecord", input.runId);
  if (settlement && (
    text(settlement.id, "existingSettlementRecord.id", input.runId).length === 0
    || settlement.runId !== input.runId
    || settlement.chapterId !== "N1"
    || settlement.chapterRuntimeId !== action.chapterRuntimeId
  )) {
    invalid("existingSettlementRecord", "ACTION_SETTLEMENT_BINDING_MISMATCH", input.runId);
  }
  return {
    schemaVersion: "pressure_decision_to_next_projection_prior_action_snapshot_v1",
    request: requestFromInput(input),
    action,
    settlementCompleted: settlement !== null,
    capturedAtMs: input.capturedAtMs,
  };
}

function assertPriorActionViewer(
  value: unknown,
  actionSeatId: string,
  input: Readonly<CaptureInputV1>,
): void {
  const viewerRows = records(value, "viewerRows", input.runId);
  if (viewerRows.length !== 1) {
    invalid("viewerRows", "MEMBERSHIP_AMBIGUOUS_OR_MISSING", input.runId);
  }
  const viewer = viewerRows[0]!;
  const roleKey = validateSeatIdV1(viewer.roleKey, "viewerRows[0].roleKey");
  if (
    viewer.runId !== input.runId
    || viewer.userId !== input.subjectId
    || viewer.playerType !== "human"
    || viewer.status !== "active"
    || viewer.roleRunId !== input.runId
    || roleKey !== actionSeatId
  ) invalid("viewerRows[0]", "VIEWER_NOT_AUTHORIZED", input.runId);
}

function actionFromPersistenceRow(
  row: Readonly<Record<string, unknown>>,
  runId: string,
): unknown {
  return {
    schemaVersion: "sangtian_decision_action_v1",
    actionId: text(row.id, "existingDecisionActionRows.action.id", runId),
    runId: row.runId,
    chapterRuntimeId: row.chapterRuntimeId,
    chapterId: "N1",
    decisionPointId: row.decisionPointId,
    seatId: row.seatId,
    actionOrdinal: row.actionOrdinal,
    actionRevision: row.currentRevision,
    controlEpoch: row.controlEpoch,
    expectedWorkingRevision: row.expectedWorkingRevision,
    status: row.status,
    actionType: row.actionType,
    payload: structuredClone(row.payloadJson),
    payloadHash: row.payloadHash,
    idempotencyKey: row.idempotencyKey,
    requestFingerprint: row.requestFingerprint,
    sealedHash: row.sealedHash,
  };
}

function hasAnyPriorOutcome(row: Sql7SnapshotRawRowV1, runId: string): boolean {
  return records(row.existingDecisionActionRows, "existingDecisionActionRows", runId).length > 0
    || row.existingSettlementRecord !== null && row.existingSettlementRecord !== undefined;
}

function requestFromInput(
  input: Readonly<CaptureInputV1>,
): DecisionToNextProjectionSnapshotV1["request"] {
  return {
    roomId: input.roomId,
    runId: input.runId,
    subjectId: input.subjectId,
    seatId: input.seatId,
    chapterRuntimeId: input.chapterRuntimeId,
    decisionPointId: input.decisionPointId,
    expectedRouteHash: input.expectedRouteHash,
    expectedWorkingRevision: input.expectedWorkingRevision,
    expectedControlEpoch: input.expectedControlEpoch,
    expectedSubmissionFenceToken: input.expectedSubmissionFenceToken,
    idempotencyKey: input.idempotencyKey,
  };
}

function hasRequiredSnapshotAuthorities(row: Sql7SnapshotRawRowV1): boolean {
  return row.routeRecord !== null
    && row.routeRecord !== undefined
    && row.worldRecord !== null
    && row.worldRecord !== undefined
    && row.orchestratorStats !== null
    && row.orchestratorStats !== undefined
    && row.runtimeRecord !== null
    && row.runtimeRecord !== undefined
    && row.seatRecord !== null
    && row.seatRecord !== undefined
    && Array.isArray(row.viewerRows)
    && row.viewerRows.length > 0;
}

export function decodeDecisionToNextProjectionSnapshotV1(
  raw: Sql7SnapshotRawRowV1,
  input: Readonly<CaptureInputV1>,
): DecisionToNextProjectionSnapshotV1 {
  const routeRow = record(raw.routeRecord, "routeRecord", input.runId);
  const stored = assertStoredRunRouteRecord(
    structuredClone(routeRow.routeJson) as Parameters<typeof assertStoredRunRouteRecord>[0],
  );
  const routeSnapshot = validateRunRouteSnapshotV1(stored.snapshot);
  if (
    routeRow.runId !== input.runId
    || routeRow.routeHash !== input.expectedRouteHash
    || stored.runId !== input.runId
    || routeSnapshot.runId !== input.runId
    || routeSnapshot.routeHash !== input.expectedRouteHash
  ) invalid("routeRecord", "ROUTE_BINDING_MISMATCH", input.runId);

  const worldRow = record(raw.worldRecord, "worldRecord", input.runId);
  const worldState = validateWorldStateV1(worldRow.stateJson, "worldRecord.stateJson");
  const world = decodeWorld(worldRow, worldState, input);

  const orchestratorStats = record(raw.orchestratorStats, "orchestratorStats", input.runId);
  const chapter = decodeChapter(orchestratorStats, input);
  const runtimeRow = record(raw.runtimeRecord, "runtimeRecord", input.runId);
  const runtime = decodeRuntime(runtimeRow, input, chapter.currentChapterId);
  if (
    chapter.chapterRuntimeId !== runtime.id
    || chapter.currentChapterId !== runtime.chapterId
    || chapter.routeHash !== runtime.routeHash
    || chapter.authorityBase.baseWorldSequence !== runtime.baseWorldSequence
    || chapter.authorityBase.baseWorldStateHash !== runtime.baseWorldStateHash
    || world.worldSequence !== runtime.baseWorldSequence
    || world.state.stateHash !== runtime.baseWorldStateHash
  ) invalid("runtimeRecord", "W3_W4_W5_BINDING_MISMATCH", input.runId);

  const workingProjection = decodeWorkingLedgerProjectionCacheV1(
    runtimeRow.ledgerProjectionJson,
    {
      runId: runtime.runId,
      chapterRuntimeId: runtime.id,
      chapterId: runtime.chapterId,
      routeHash: runtime.routeHash,
      workingRevision: runtime.workingRevision,
      workingState: runtimeRow.workingStateJson,
      workingStateHash: runtime.workingStateHash,
    },
  );
  if (
    workingProjection.state.revision !== input.expectedWorkingRevision
    || workingProjection.stateHash !== runtime.workingStateHash
    || workingProjection.stateHash !== workingStateHash(workingProjection.state)
    || !isSha256(workingProjection.headHash)
  ) invalid("workingProjection", "WORKING_FENCE_MISMATCH", input.runId);

  const seatRow = record(raw.seatRecord, "seatRecord", input.runId);
  const seatEnvelope = decodeSeatEnvelope({
    runId: text(seatRow.runId, "seatRecord.runId", input.runId),
    stateRevision: integer(seatRow.stateRevision, "seatRecord.stateRevision", input.runId),
    snapshotJson: seatRow.snapshotJson,
    stateHash: hash(seatRow.stateHash, "seatRecord.stateHash", input.runId),
    version: integer(seatRow.version, "seatRecord.version", input.runId),
  });
  const seatAuthority = seatEnvelope.snapshot;
  const submitSeat = seatAuthority.seatControls.find((seat) => seat.seatId === input.seatId);
  if (
    seatAuthority.runId !== input.runId
    || seatAuthority.routeHash !== input.expectedRouteHash
    || !submitSeat
    || submitSeat.mode !== "HUMAN_ACTIVE"
    || submitSeat.activeControllerId !== input.subjectId
    || submitSeat.controlEpoch !== input.expectedControlEpoch
    || submitSeat.submissionFenceToken !== input.expectedSubmissionFenceToken
  ) invalid("seatRecord", "SEAT_FENCE_MISMATCH", input.runId);
  const storedViewerPrivateProjection = seatEnvelope.privateProjections[
    privateProjectionKey(input.runId, input.seatId, seatAuthority.stateHash)
  ];
  const viewerPrivateProjection = storedViewerPrivateProjection
    ?? compileSangtianSeatPrivateProjectionFromCapturedAuthoritiesV1({
      runId: input.runId,
      seatId: input.seatId,
      routeSnapshot,
      seatAuthority,
      world: world.state,
    });
  if (
    !viewerPrivateProjection
    || viewerPrivateProjection.schemaVersion !== "pressure_seat_private_projection_record_v1"
    || viewerPrivateProjection.runId !== input.runId
    || viewerPrivateProjection.seatId !== input.seatId
    || viewerPrivateProjection.sourceAuthorityHash !== seatAuthority.stateHash
    || !viewerPrivateProjection.projectionVersion?.trim()
    || !isSha256(viewerPrivateProjection.payloadHash)
    || sha256Canonical(viewerPrivateProjection.payload) !== viewerPrivateProjection.payloadHash
  ) invalid("seatRecord.privateProjections", "PRIVATE_PROJECTION_INVALID", input.runId);
  const viewerPresence = seatEnvelope.latestPresence[
    presenceKey(input.runId, input.seatId, input.subjectId)
  ] ?? null;
  if (viewerPresence && (
    viewerPresence.schemaVersion !== "pressure_seat_presence_record_v1"
    || viewerPresence.runId !== input.runId
    || viewerPresence.seatId !== input.seatId
    || viewerPresence.humanControllerId !== input.subjectId
    || !isSha256(viewerPresence.requestFingerprint)
    || !isSha256(viewerPresence.recordHash)
    || sha256Canonical((({ recordHash: _recordHash, ...body }) => body)(viewerPresence))
      !== viewerPresence.recordHash
  )) invalid("seatRecord.latestPresence", "PRESENCE_BINDING_MISMATCH", input.runId);

  const viewerRows = records(raw.viewerRows, "viewerRows", input.runId);
  if (viewerRows.length !== 1) invalid("viewerRows", "MEMBERSHIP_AMBIGUOUS_OR_MISSING", input.runId);
  const viewer = decodeViewer(viewerRows[0]!, input);
  const activeSeat = chapter.activeDecision?.seats.find((seat) => seat.seatId === input.seatId);
  if (
    chapter.phase !== "ACTIVE"
    || chapter.activeDecision?.decisionPointId !== input.decisionPointId
    || activeSeat?.requirement !== "REQUIRED"
    || activeSeat.completion !== "PENDING"
  ) invalid("orchestratorStats.latestState", "DECISION_NOT_OPEN", input.runId);

  if (raw.existingSettlementRecord !== null && raw.existingSettlementRecord !== undefined) {
    invalid("existingSettlementRecord", "NORMAL_PATH_ALREADY_SETTLED", input.runId);
  }
  const existingDecisionActionRows = boundRows(
    raw.existingDecisionActionRows,
    "existingDecisionActionRows",
    input,
    ["id"],
  );
  if (existingDecisionActionRows.length !== 0) {
    invalid("existingDecisionActionRows", "NORMAL_PATH_ALREADY_HAS_ACTIONS", input.runId);
  }
  const projectionSeed: DecisionToNextProjectionProjectionSeedV1 = {
    narrativeProjectionRows: boundRows(
      raw.narrativeProjectionRows,
      "narrativeProjectionRows",
      input,
      ["id"],
    ),
    aEmotionAggregateRows: boundRows(
      raw.aEmotionAggregateRows,
      "aEmotionAggregateRows",
      input,
      ["id"],
    ),
    viewerDeliveryRows: boundRows(
      raw.viewerDeliveryRows,
      "viewerDeliveryRows",
      input,
      ["id"],
      "roomId",
    ),
    aEmotionDeliveryMarkRows: boundRows(
      raw.aEmotionDeliveryMarkRows,
      "aEmotionDeliveryMarkRows",
      input,
      ["id"],
    ),
  };

  const { capturedAtMs: _capturedAtMs, ...requestInput } = input;
  const request = structuredClone(requestInput) as DecisionToNextProjectionSnapshotRequestV1;
  const snapshotBody = {
    schemaVersion: "pressure_decision_to_next_projection_snapshot_v1" as const,
    request,
    storedRoute: structuredClone(stored),
    routeSnapshot,
    world,
    chapter,
    runtime,
    workingProjection,
    seatAuthority,
    submitSeat: structuredClone(submitSeat),
    viewer,
    viewerPrivateProjection: structuredClone(viewerPrivateProjection),
    viewerPresence: viewerPresence ? structuredClone(viewerPresence) : null,
    persistenceFence: {
      orchestratorEventId: text(
        orchestratorStats.latestEventId,
        "orchestratorStats.latestEventId",
        input.runId,
      ),
      orchestratorDedupeKey: text(
        orchestratorStats.latestDedupeKey,
        "orchestratorStats.latestDedupeKey",
        input.runId,
      ),
      orchestratorPayload: structuredClone(orchestratorStats.latestState),
      seatStateRevision: integer(
        seatRow.stateRevision,
        "seatRecord.stateRevision",
        input.runId,
      ),
      seatVersion: integer(seatRow.version, "seatRecord.version", input.runId),
      seatStateHash: hash(seatRow.stateHash, "seatRecord.stateHash", input.runId),
      seatSnapshotJson: structuredClone(seatRow.snapshotJson),
    },
    existingDecisionActionRows,
    projectionSeed,
    capturedAtMs: input.capturedAtMs,
  };
  return {
    ...snapshotBody,
    snapshotHash: sha256Canonical({
      schemaVersion: snapshotBody.schemaVersion,
      request: snapshotBody.request,
      storedRouteHash: stored.recordHash,
      routeHash: routeSnapshot.routeHash,
      world: {
        version: world.version,
        worldSequence: world.worldSequence,
        reservedWorldSequence: world.reservedWorldSequence,
        stateHash: world.state.stateHash,
      },
      chapter: { revision: chapter.revision, orchestratorHash: chapter.orchestratorHash },
      runtime,
      workingProjectionHash: workingLedgerProjectionCacheHashV1(workingProjection),
      seat: {
        stateRevision: seatAuthority.stateRevision,
        stateHash: seatAuthority.stateHash,
        seatId: submitSeat.seatId,
        controllerId: submitSeat.activeControllerId,
        controlEpoch: submitSeat.controlEpoch,
        submissionFenceToken: submitSeat.submissionFenceToken,
      },
      viewer,
      viewerPrivateProjection,
      viewerPresence,
      persistenceFence: snapshotBody.persistenceFence,
      existingDecisionActionRowsHash: sha256Canonical(existingDecisionActionRows),
      projectionSeedHash: sha256Canonical(projectionSeed),
      capturedAtMs: input.capturedAtMs,
    }),
  };
}

function validateCaptureInput(input: Readonly<CaptureInputV1>): void {
  if (
    !input.runId?.trim()
    || input.roomId !== input.runId
    || !input.subjectId?.trim()
    || !input.chapterRuntimeId?.trim()
    || !input.decisionPointId?.trim()
    || !input.idempotencyKey?.trim()
    || !isSha256(input.expectedRouteHash)
    || !Number.isSafeInteger(input.expectedWorkingRevision)
    || input.expectedWorkingRevision < 0
    || !Number.isSafeInteger(input.expectedControlEpoch)
    || input.expectedControlEpoch < 1
    || !isSha256(input.expectedSubmissionFenceToken)
    || !Number.isSafeInteger(input.capturedAtMs)
    || input.capturedAtMs < 0
  ) invalid("captureInput", "INVALID_INPUT", input.runId);
  validateSeatIdV1(input.seatId, "captureInput.seatId");
}

function decodeWorld(
  row: Record<string, unknown>,
  state: ReturnType<typeof validateWorldStateV1>,
  input: Readonly<CaptureInputV1>,
): DecisionToNextProjectionWorldAuthorityV1 {
  const runId = text(row.runId, "worldRecord.runId", input.runId);
  const worldSequence = integer(row.worldSequence, "worldRecord.worldSequence", input.runId);
  const reservedWorldSequence = integer(
    row.reservedWorldSequence,
    "worldRecord.reservedWorldSequence",
    input.runId,
  );
  if (
    runId !== input.runId
    || worldSequence !== state.worldSequence
    || reservedWorldSequence !== worldSequence
  ) invalid("worldRecord", "WORLD_BINDING_MISMATCH", input.runId);
  return {
    runId,
    version: integer(row.version, "worldRecord.version", input.runId),
    currentNodeId: nullableText(row.currentNodeId, "worldRecord.currentNodeId", input.runId),
    worldSequence,
    reservedWorldSequence,
    state,
  };
}

function decodeChapter(
  stats: Record<string, unknown>,
  input: Readonly<CaptureInputV1>,
) {
  const count = integer(stats.count, "orchestratorStats.count", input.runId);
  const distinctCount = integer(
    stats.distinctCount,
    "orchestratorStats.distinctCount",
    input.runId,
  );
  const bindingCount = integer(
    stats.bindingCount,
    "orchestratorStats.bindingCount",
    input.runId,
  );
  const minRevision = integer(stats.minRevision, "orchestratorStats.minRevision", input.runId);
  const maxRevision = integer(stats.maxRevision, "orchestratorStats.maxRevision", input.runId);
  if (
    count === 0
    || distinctCount !== count
    || bindingCount !== count
    || minRevision !== 0
    || maxRevision !== count - 1
  ) {
    invalid("orchestratorStats", "REVISION_HISTORY_NOT_CONTIGUOUS", input.runId);
  }
  const chapter = validateOrchestratorStateV1(
    stats.latestState as Parameters<typeof validateOrchestratorStateV1>[0],
  );
  if (
    chapter.runId !== input.runId
    || chapter.routeHash !== input.expectedRouteHash
    || chapter.revision !== maxRevision
    || chapter.currentChapterId !== "N1"
    || chapter.chapterRuntimeId !== input.chapterRuntimeId
  ) invalid("orchestratorStats.latestState", "ORCHESTRATOR_BINDING_MISMATCH", input.runId);
  return chapter;
}

function decodeRuntime(
  row: Record<string, unknown>,
  input: Readonly<CaptureInputV1>,
  expectedChapterId: ChapterIdV1,
): DecisionToNextProjectionRuntimeAuthorityV1 {
  const state = text(row.state, "runtimeRecord.state", input.runId);
  if (state !== "DECISION_POINT_OPEN" && state !== "ACTION_DRAFTING") {
    invalid("runtimeRecord.state", "NORMAL_PATH_RUNTIME_NOT_OPEN", input.runId);
  }
  const runtime: DecisionToNextProjectionRuntimeAuthorityV1 = {
    id: text(row.id, "runtimeRecord.id", input.runId),
    runId: text(row.runId, "runtimeRecord.runId", input.runId),
    chapterId: text(row.chapterId, "runtimeRecord.chapterId", input.runId) as ChapterIdV1,
    chapterSequence: integer(row.chapterSequence, "runtimeRecord.chapterSequence", input.runId),
    state,
    baseWorldSequence: integer(row.baseWorldSequence, "runtimeRecord.baseWorldSequence", input.runId),
    baseWorldStateHash: hash(row.baseWorldStateHash, "runtimeRecord.baseWorldStateHash", input.runId),
    previousFrozenHash: hash(row.previousFrozenHash, "runtimeRecord.previousFrozenHash", input.runId),
    routeHash: hash(row.routeHash, "runtimeRecord.routeHash", input.runId),
    contentPackageVersion: text(row.contentPackageVersion, "runtimeRecord.contentPackageVersion", input.runId),
    contentHash: hash(row.contentHash, "runtimeRecord.contentHash", input.runId),
    orchestrationPackageVersion: text(row.orchestrationPackageVersion, "runtimeRecord.orchestrationPackageVersion", input.runId),
    orchestrationHash: hash(row.orchestrationHash, "runtimeRecord.orchestrationHash", input.runId),
    runtimeContractVersion: text(row.runtimeContractVersion, "runtimeRecord.runtimeContractVersion", input.runId),
    runtimeContractHash: hash(row.runtimeContractHash, "runtimeRecord.runtimeContractHash", input.runId),
    workingRevision: integer(row.workingRevision, "runtimeRecord.workingRevision", input.runId),
    workingStateHash: hash(row.workingStateHash, "runtimeRecord.workingStateHash", input.runId),
    workingState: structuredClone(row.workingStateJson),
    decisionState: structuredClone(row.decisionStateJson),
    ledgerProjectionCache: structuredClone(row.ledgerProjectionJson),
    closeInputHash: nullableHash(row.closeInputHash, "runtimeRecord.closeInputHash", input.runId),
    lockVersion: integer(row.lockVersion, "runtimeRecord.lockVersion", input.runId),
  };
  if (
    runtime.id !== input.chapterRuntimeId
    || runtime.runId !== input.runId
    || runtime.chapterId !== expectedChapterId
    || runtime.chapterSequence !== 1
    || runtime.baseWorldSequence !== 0
    || runtime.routeHash !== input.expectedRouteHash
    || runtime.workingRevision !== input.expectedWorkingRevision
  ) invalid("runtimeRecord", "RUNTIME_BINDING_MISMATCH", input.runId);
  return runtime;
}

function decodeViewer(
  row: Record<string, unknown>,
  input: Readonly<CaptureInputV1>,
): DecisionToNextProjectionViewerAuthorityV1 {
  const roleKey = validateSeatIdV1(row.roleKey, "viewerRows[0].roleKey");
  const viewer = {
    playerId: text(row.playerId, "viewerRows[0].playerId", input.runId),
    runId: text(row.runId, "viewerRows[0].runId", input.runId),
    subjectId: text(row.userId, "viewerRows[0].userId", input.runId),
    playerType: row.playerType,
    status: row.status,
    roleId: text(row.roleId, "viewerRows[0].roleId", input.runId),
    roleKey,
    roleName: text(row.roleName, "viewerRows[0].roleName", input.runId),
  };
  if (
    viewer.runId !== input.runId
    || viewer.subjectId !== input.subjectId
    || viewer.playerType !== "human"
    || viewer.status !== "active"
    || row.roleRunId !== input.runId
    || viewer.roleKey !== input.seatId
  ) invalid("viewerRows[0]", "VIEWER_NOT_AUTHORIZED", input.runId);
  return viewer as DecisionToNextProjectionViewerAuthorityV1;
}

function boundRows(
  value: unknown,
  path: string,
  input: Readonly<CaptureInputV1>,
  uniqueFields: readonly string[],
  runBindingField = "runId",
): ReadonlyArray<Readonly<Record<string, unknown>>> {
  const rows = records(value, path, input.runId);
  const observed = new Set<string>();
  return rows.map((row, index) => {
    if (row[runBindingField] !== input.runId) {
      invalid(`${path}[${index}]`, "CROSS_RUN_ROW", input.runId);
    }
    const key = uniqueFields.map((field) => text(row[field], `${path}[${index}].${field}`, input.runId)).join(":" );
    if (observed.has(key)) invalid(path, "DUPLICATE_ROW", input.runId);
    observed.add(key);
    return structuredClone(row);
  });
}

function record(value: unknown, path: string, runId: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    invalid(path, "OBJECT_REQUIRED", runId);
  }
  return value as Record<string, unknown>;
}

function records(value: unknown, path: string, runId: string): Record<string, unknown>[] {
  if (!Array.isArray(value)) invalid(path, "ARRAY_REQUIRED", runId);
  return value.map((item, index) => record(item, `${path}[${index}]`, runId));
}

function text(value: unknown, path: string, runId: string): string {
  if (typeof value !== "string" || !value.trim()) invalid(path, "TEXT_REQUIRED", runId);
  return value;
}

function nullableText(value: unknown, path: string, runId: string): string | null {
  if (value === null) return null;
  return text(value, path, runId);
}

function integer(value: unknown, path: string, runId: string): number {
  const numeric = typeof value === "bigint" ? Number(value) : value;
  if (!Number.isSafeInteger(numeric) || Number(numeric) < 0) invalid(path, "NON_NEGATIVE_INTEGER_REQUIRED", runId);
  return Number(numeric);
}

function hash(value: unknown, path: string, runId: string): string {
  if (typeof value !== "string" || !isSha256(value)) invalid(path, "SHA256_REQUIRED", runId);
  return value;
}

function nullableHash(value: unknown, path: string, runId: string): string | null {
  if (value === null) return null;
  return hash(value, path, runId);
}

function invalid(path: string, detail: string, runId: string): never {
  throw new Error(`SQL7_SNAPSHOT_INVALID:${path}:${detail}:${runId}`);
}

export function createPrismaDecisionToNextProjectionSnapshotReaderV1(
  prisma: unknown,
): PrismaDecisionToNextProjectionSnapshotReaderV1 {
  return new PrismaDecisionToNextProjectionSnapshotReaderV1(
    prisma as Sql7SnapshotPrismaClientV1,
  );
}
