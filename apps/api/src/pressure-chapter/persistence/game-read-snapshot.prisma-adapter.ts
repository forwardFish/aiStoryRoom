import { Prisma } from "@prisma/client";
import {
  isSha256,
  validateRunRouteSnapshotV1,
  validateSeatIdV1,
  validateWorldStateV1,
  type ChapterIdV1,
  type RunRouteSnapshotV1,
  type SeatIdV1,
  type WorldStateV1,
} from "@ai-story/shared";
import {
  decodeGameReadSnapshotV1,
  PRESSURE_GAME_READ_SNAPSHOT_RAW_ROW_SCHEMA_V1,
  PRESSURE_GAME_READ_SNAPSHOT_REQUEST_SCHEMA_V1,
  type GameReadSnapshotRawRowV1,
  type GameReadSnapshotRequestV1,
  type GameReadSnapshotV1,
} from "../game-projection/game-read-snapshot";
import type {
  PressureGameMetricProjectionV1,
  PressureGameViewerSourceV1,
} from "../game-projection/contracts";
import type {
  AuthoredChapterContentPort,
  ChapterOrchestratorStateV1,
} from "../orchestrator/contracts";
import { validateOrchestratorStateV1 } from "../orchestrator/validation";
import type {
  PressureSeatViewerPresentationCatalogV1,
  PressureSeatViewerPresentationCatalogPortV1,
} from "../seat-control-persistence/viewer.prisma-adapter";
import {
  PrismaPressureGameViewerReaderV1,
} from "../seat-control-persistence/viewer.prisma-adapter";
import type {
  PressureSeatViewerMembershipReaderPortV1,
  PressureSeatViewerMembershipV1,
} from "../seat-control-persistence/membership.prisma-adapter";
import {
  decodeSeatEnvelope,
  type PressureSeatSnapshotRowV1,
} from "../seat-control-persistence/envelope";
import type {
  SeatControlAuthorityPort,
  SeatControlInitializePortResultV1,
  SeatControlSnapshotV1,
  SeatControlTransitionCommitV1,
  SeatControlTransitionPortResultV1,
  SeatPresencePort,
  SeatPrivateProjectionPort,
  SeatPrivateProjectionRecordV1,
} from "../seat-control/types";
import {
  assertStoredRunRouteRecord,
  type StoredRunRouteRecordV1,
} from "../run-router";

export const GAME_READ_SNAPSHOT_PRISMA_ERROR_CODES_V1 = Object.freeze({
  INPUT_INVALID: "GAME_READ_SNAPSHOT_PRISMA_INPUT_INVALID",
  QUERY_FAILED: "GAME_READ_SNAPSHOT_PRISMA_QUERY_FAILED",
  QUERY_RESULT_INVALID: "GAME_READ_SNAPSHOT_PRISMA_QUERY_RESULT_INVALID",
  AUTHORITY_MISSING: "GAME_READ_SNAPSHOT_PRISMA_AUTHORITY_MISSING",
  AUTHORITY_AMBIGUOUS: "GAME_READ_SNAPSHOT_PRISMA_AUTHORITY_AMBIGUOUS",
  AUTHORITY_SCOPE_MISMATCH: "GAME_READ_SNAPSHOT_PRISMA_AUTHORITY_SCOPE_MISMATCH",
  MATERIALIZATION_FAILED: "GAME_READ_SNAPSHOT_PRISMA_MATERIALIZATION_FAILED",
  READ_ONLY_VIOLATION: "GAME_READ_SNAPSHOT_PRISMA_READ_ONLY_VIOLATION",
} as const);

export type GameReadSnapshotPrismaErrorCodeV1 =
  (typeof GAME_READ_SNAPSHOT_PRISMA_ERROR_CODES_V1)[keyof typeof GAME_READ_SNAPSHOT_PRISMA_ERROR_CODES_V1];

export class GameReadSnapshotPrismaErrorV1 extends Error {
  readonly code: GameReadSnapshotPrismaErrorCodeV1;
  readonly path: string;
  readonly detail: string;

  constructor(code: GameReadSnapshotPrismaErrorCodeV1, path: string, detail: string) {
    super(`${code}:${path}:${detail}`);
    this.name = "GameReadSnapshotPrismaErrorV1";
    this.code = code;
    this.path = path;
    this.detail = detail;
  }
}

export interface CaptureGameReadSnapshotV1 {
  roomId: string;
  runId: string;
  subjectId: string;
  feedCursor: string | null;
  feedLimit: number;
  capturedAtMs: number;
}

export interface GameReadSnapshotPrismaClientV1 {
  $queryRaw<TResult = unknown>(query: Prisma.Sql): Promise<TResult>;
}

/** Existing package-owned readers supplied later by M4 composition. */
export interface GameReadSnapshotLocalAuthoritiesV1 {
  chapters: Pick<AuthoredChapterContentPort, "load">;
  presentation: Readonly<{
    chapterTitle(chapterId: "P0" | ChapterIdV1): string;
    metrics(world: ReturnType<typeof validateWorldStateV1>): PressureGameMetricProjectionV1[];
  }>;
  seatCatalog: Readonly<{
    readCatalogFromRoute(input: {
      routeSnapshot: Readonly<{
        contentPackageVersion: string;
        contentPackageSha256: string;
      }>;
      seatId: SeatIdV1;
    }): PressureSeatViewerPresentationCatalogV1;
  }>;
  /** Must be the existing package-owned captured-authority compiler. */
  privateProjection: Readonly<{
    compile(input: Readonly<{
      runId: string;
      seatId: SeatIdV1;
      routeSnapshot: RunRouteSnapshotV1;
      seatAuthority: SeatControlSnapshotV1;
      world: WorldStateV1;
    }>): SeatPrivateProjectionRecordV1;
  }>;
}

interface GameReadSnapshotSqlRowV1 {
  requestEcho: unknown;
  routeRecord: unknown;
  membershipRows: unknown;
  seatRecord: unknown;
  privateProjectionRecord: unknown;
  worldRecord: unknown;
  genesisRecord: unknown;
  orchestratorStats: unknown;
  runtimeRecord: unknown;
  narrativeSource: unknown;
  narrativeRows: unknown;
  feedRows: unknown;
  feedAggregateCount: unknown;
  feedExactDeliveryCount: unknown;
  feedAmbiguousDeliveryCount: unknown;
  feedInvalidAggregateCount: unknown;
  feedDuplicateAggregateVersionCount: unknown;
  feedInvalidMarkCount: unknown;
}

interface DecodedMaterializationAuthoritiesV1 {
  storedRoute: StoredRunRouteRecordV1;
  route: RunRouteSnapshotV1;
  membership: PressureSeatViewerMembershipV1 & {
    playerId: string;
    roleId: string;
    roleName: string;
  };
  seatRow: PressureSeatSnapshotRowV1;
  seatSnapshot: SeatControlSnapshotV1;
  privateProjection: SeatPrivateProjectionRecordV1;
  viewerSource: PressureGameViewerSourceV1;
  worldRecord: Readonly<Record<string, unknown>>;
  worldState: ReturnType<typeof validateWorldStateV1>;
}

/**
 * One PostgreSQL application statement, no Prisma transaction and no writes.
 * Every database relation is constrained by the same request_input row before
 * the JSON aggregate is returned. M1 remains the sole raw-row decoder.
 */
export class PrismaGameReadSnapshotReaderV1 {
  constructor(
    private readonly prisma: GameReadSnapshotPrismaClientV1,
    private readonly local: GameReadSnapshotLocalAuthoritiesV1,
  ) {}

  async capture(inputValue: Readonly<CaptureGameReadSnapshotV1>): Promise<GameReadSnapshotV1> {
    const input = validateCaptureInput(inputValue);
    const request = toSnapshotRequest(input);
    let rows: GameReadSnapshotSqlRowV1[];
    try {
      rows = await this.prisma.$queryRaw<GameReadSnapshotSqlRowV1[]>(Prisma.sql`
      WITH request_input AS (
        SELECT
          ${input.roomId}::text AS room_id,
          ${input.runId}::text AS run_id,
          ${input.subjectId}::text AS subject_id,
          ${input.feedCursor}::text AS feed_cursor,
          ${input.feedLimit}::integer AS feed_limit,
          ${input.capturedAtMs}::bigint AS captured_at_ms
      ),
      route_scope AS (
        SELECT route."runId" AS run_id,
          route."routeHash" AS route_hash,
          route."narrativeProfileVersion" AS narrative_profile_version,
          route."routeJson" AS route_record
        FROM "PressureRunRouteSnapshot" route
        CROSS JOIN request_input request
        WHERE request.room_id = request.run_id
          AND route."runId" = request.run_id
          AND route."routeJson" ->> 'runId' = request.run_id
          AND route."routeJson" #>> '{snapshot,routeHash}' = route."routeHash"
      ),
      viewer_rows AS (
        SELECT player."id" AS player_id,
          player."runId" AS run_id,
          player."userId" AS user_id,
          player."playerType" AS player_type,
          player."status" AS player_status,
          player."roleId" AS role_id,
          role."runId" AS role_run_id,
          role."roleKey" AS role_key,
          role."roleName" AS role_name
        FROM "StoryPlayer" player
        CROSS JOIN request_input request
        INNER JOIN "StoryRole" role
          ON role."id" = player."roleId"
          AND role."runId" = request.run_id
        WHERE player."runId" = request.run_id
          AND player."userId" = request.subject_id
      ),
      viewer_single AS (
        SELECT viewer.*
        FROM viewer_rows viewer
        WHERE (SELECT count(*) FROM viewer_rows) = 1
          AND viewer.player_type = 'human'
          AND viewer.player_status = 'active'
      ),
      seat_scope AS (
        SELECT seat."runId" AS run_id,
          seat."stateRevision" AS state_revision,
          seat."stateHash" AS state_hash,
          seat."snapshotJson" AS envelope_json,
          seat."version" AS version,
          CASE
            WHEN seat."snapshotJson" ->> 'schemaVersion'
              = 'pressure_seat_control_persistence_envelope_v1'
            THEN seat."snapshotJson" -> 'snapshot'
            ELSE seat."snapshotJson"
          END AS authority_json
        FROM "PressureSeatControlSnapshot" seat
        CROSS JOIN request_input request
        INNER JOIN route_scope route ON route.run_id = request.run_id
        WHERE seat."runId" = request.run_id
          AND (
            CASE
              WHEN seat."snapshotJson" ->> 'schemaVersion'
                = 'pressure_seat_control_persistence_envelope_v1'
              THEN seat."snapshotJson" #>> '{snapshot,runId}'
              ELSE seat."snapshotJson" ->> 'runId'
            END
          ) = request.run_id
          AND (
            CASE
              WHEN seat."snapshotJson" ->> 'schemaVersion'
                = 'pressure_seat_control_persistence_envelope_v1'
              THEN seat."snapshotJson" #>> '{snapshot,routeHash}'
              ELSE seat."snapshotJson" ->> 'routeHash'
            END
          ) = route.route_hash
          AND (
            CASE
              WHEN seat."snapshotJson" ->> 'schemaVersion'
                = 'pressure_seat_control_persistence_envelope_v1'
              THEN seat."snapshotJson" #>> '{snapshot,stateHash}'
              ELSE seat."snapshotJson" ->> 'stateHash'
            END
          ) = seat."stateHash"
      ),
      viewer_private AS (
        SELECT seat.envelope_json #> ARRAY[
          'privateProjections',
          request.run_id || ':' || viewer.role_key || ':' || seat.state_hash
        ]::text[] AS private_projection
        FROM request_input request
        CROSS JOIN viewer_single viewer
        CROSS JOIN seat_scope seat
      ),
      world_scope AS (
        SELECT run."id" AS run_id,
          run."version" AS version,
          run."currentNodeId" AS current_node_id,
          run."worldSequence" AS world_sequence,
          run."reservedWorldSequence" AS reserved_world_sequence,
          run."stateJson" AS state_json
        FROM "StoryRun" run
        CROSS JOIN request_input request
        WHERE run."id" = request.run_id
          AND run."stateJson" ->> 'stateHash' IS NOT NULL
          AND CASE
            WHEN (run."stateJson" ->> 'worldSequence') ~ '^[0-9]+$'
            THEN (run."stateJson" ->> 'worldSequence')::integer
            ELSE NULL
          END = run."worldSequence"
      ),
      orchestrator_all AS (
        SELECT event."id" AS event_id,
          event."dedupeKey" AS dedupe_key,
          event."payloadJson" AS state_json,
          CASE
            WHEN (event."payloadJson" ->> 'revision') ~ '^[0-9]+$'
            THEN (event."payloadJson" ->> 'revision')::integer
            ELSE NULL
          END AS revision,
          event."createdAt" AS created_at
        FROM "StoryEvent" event
        CROSS JOIN request_input request
        WHERE event."runId" = request.run_id
          AND event."type" = 'PRESSURE_CHAPTER_ORCHESTRATOR_STATE'
      ),
      orchestrator_bound AS (
        SELECT event.*
        FROM orchestrator_all event
        CROSS JOIN request_input request
        INNER JOIN route_scope route ON route.run_id = request.run_id
        WHERE event.revision IS NOT NULL
          AND event.dedupe_key =
            'pressure-orchestrator:' || request.run_id || ':' || event.revision::text
          AND event.state_json ->> 'runId' = request.run_id
          AND event.state_json ->> 'routeHash' = route.route_hash
      ),
      orchestrator_latest AS (
        SELECT event.*
        FROM orchestrator_bound event
        ORDER BY event.revision DESC, event.created_at DESC, event.event_id DESC
        LIMIT 1
      ),
      runtime_scope AS (
        SELECT runtime."id" AS id,
          runtime."runId" AS run_id,
          runtime."chapterId" AS chapter_id,
          runtime."chapterSequence" AS chapter_sequence,
          runtime."state"::text AS runtime_state,
          runtime."routeHash" AS route_hash,
          runtime."baseWorldSequence" AS base_world_sequence,
          runtime."baseWorldStateHash" AS base_world_state_hash,
          runtime."previousFrozenHash" AS previous_frozen_hash,
          runtime."contentPackageVersion" AS content_package_version,
          runtime."contentHash" AS content_hash,
          runtime."orchestrationPackageVersion" AS orchestration_package_version,
          runtime."orchestrationHash" AS orchestration_hash,
          runtime."runtimeContractVersion" AS runtime_contract_version,
          runtime."runtimeContractHash" AS runtime_contract_hash,
          runtime."workingRevision" AS working_revision,
          runtime."workingStateJson" AS working_state_json,
          runtime."workingStateHash" AS working_state_hash,
          CASE
            WHEN (runtime."ledgerProjectionJson" ->> 'headSequence') ~ '^[0-9]+$'
            THEN (runtime."ledgerProjectionJson" ->> 'headSequence')::integer
            ELSE NULL
          END AS ledger_head_sequence,
          runtime."ledgerProjectionJson" ->> 'headHash' AS ledger_head_hash,
          runtime."decisionStateJson" AS decision_state_json,
          runtime."ledgerProjectionJson" AS ledger_projection_json,
          runtime."lockVersion" AS lock_version
        FROM "PressureChapterRuntime" runtime
        CROSS JOIN request_input request
        INNER JOIN route_scope route ON route.run_id = request.run_id
        INNER JOIN orchestrator_latest orchestrator
          ON orchestrator.state_json ->> 'chapterRuntimeId' = runtime."id"
          AND orchestrator.state_json ->> 'currentChapterId' = runtime."chapterId"
        WHERE runtime."runId" = request.run_id
          AND runtime."routeHash" = route.route_hash
      ),
      genesis_scope AS (
        SELECT genesis."runId" AS run_id,
          genesis."sequence" AS sequence,
          genesis."genesisHash" AS genesis_hash,
          genesis."commitHash" AS commit_hash,
          genesis."rootEventId" AS root_event_id,
          genesis."commitManifestJson" AS commit_manifest_json
        FROM "PressureGenesisCommit" genesis
        CROSS JOIN request_input request
        WHERE genesis."runId" = request.run_id
      ),
      settlement_scope AS (
        SELECT settlement."runId" AS run_id,
          settlement."chapterRuntimeId" AS chapter_runtime_id,
          settlement."frozenBundleHash" AS frozen_bundle_hash,
          settlement."commitHash" AS commit_hash,
          settlement."commitManifestJson" AS commit_manifest_json
        FROM "PressureChapterSettlement" settlement
        CROSS JOIN request_input request
        INNER JOIN runtime_scope runtime
          ON runtime.id = settlement."chapterRuntimeId"
        WHERE settlement."runId" = request.run_id
      ),
      beat_candidates AS (
        SELECT event."id" AS event_id,
          event."payloadJson" AS event_json,
          event."payloadJson" #>> '{payload,beatResolution,resolutionHash}' AS resolution_hash,
          CASE
            WHEN (event."payloadJson" ->> 'sequence') ~ '^[0-9]+$'
            THEN (event."payloadJson" ->> 'sequence')::integer
            ELSE NULL
          END AS ledger_sequence,
          event."createdAt" AS created_at
        FROM "StoryEvent" event
        CROSS JOIN request_input request
        INNER JOIN runtime_scope runtime
          ON event."payloadJson" ->> 'chapterRuntimeId' = runtime.id
        WHERE event."runId" = request.run_id
          AND event."type" = 'PRESSURE_WORKING_LEDGER_EVENT'
          AND event."payloadJson" ->> 'schemaVersion' = 'pressure_working_ledger_event_v1'
          AND event."payloadJson" ->> 'runId' = request.run_id
          AND event."payloadJson" #>> '{payload,eventType}' = 'BEAT_APPLIED'
          AND event."dedupeKey" =
            'pressure-ledger:' || request.run_id || ':' || runtime.id || ':'
              || (event."payloadJson" ->> 'eventHash')
      ),
      beat_latest AS (
        SELECT beat.*
        FROM beat_candidates beat
        WHERE beat.ledger_sequence IS NOT NULL
          AND beat.resolution_hash ~ '^[a-f0-9]{64}$'
        ORDER BY beat.ledger_sequence DESC, beat.created_at DESC, beat.event_id DESC
        LIMIT 1
      ),
      narrative_source_candidates AS (
        SELECT 1 AS priority,
          runtime.id AS chapter_runtime_id,
          'CHAPTER_NARRATIVE'::text AS projection_kind,
          'CHAPTER_FROZEN'::text AS source_authority,
          settlement.frozen_bundle_hash AS source_id,
          settlement.frozen_bundle_hash AS source_commit_hash
        FROM runtime_scope runtime
        INNER JOIN settlement_scope settlement
          ON settlement.chapter_runtime_id = runtime.id
        WHERE runtime.runtime_state = 'CHAPTER_FROZEN'
        UNION ALL
        SELECT 2 AS priority,
          runtime.id AS chapter_runtime_id,
          'BEAT_NARRATIVE'::text AS projection_kind,
          'CHAPTER_WORKING'::text AS source_authority,
          beat.resolution_hash AS source_id,
          beat.resolution_hash AS source_commit_hash
        FROM runtime_scope runtime
        INNER JOIN beat_latest beat ON true
        WHERE runtime.runtime_state <> 'CHAPTER_FROZEN'
        UNION ALL
        SELECT 3 AS priority,
          runtime.id AS chapter_runtime_id,
          'CHAPTER_NARRATIVE'::text AS projection_kind,
          'CHAPTER_FROZEN'::text AS source_authority,
          runtime.previous_frozen_hash AS source_id,
          runtime.previous_frozen_hash AS source_commit_hash
        FROM runtime_scope runtime
        WHERE runtime.chapter_id <> 'N1'
          AND runtime.runtime_state <> 'CHAPTER_FROZEN'
          AND NOT EXISTS (SELECT 1 FROM beat_latest)
        UNION ALL
        SELECT 4 AS priority,
          COALESCE(runtime.id, genesis.root_event_id) AS chapter_runtime_id,
          'GENESIS_NARRATIVE'::text AS projection_kind,
          'GENESIS_FROZEN'::text AS source_authority,
          genesis.genesis_hash AS source_id,
          genesis.commit_hash AS source_commit_hash
        FROM genesis_scope genesis
        CROSS JOIN world_scope world
        LEFT JOIN runtime_scope runtime ON true
        WHERE (
            world.current_node_id = 'P0'
            OR runtime.chapter_id = 'N1'
          )
          AND NOT EXISTS (SELECT 1 FROM beat_latest)
          AND COALESCE(runtime.runtime_state, '') <> 'CHAPTER_FROZEN'
      ),
      narrative_source AS (
        SELECT source.*
        FROM narrative_source_candidates source
        WHERE source.chapter_runtime_id IS NOT NULL
          AND source.source_id ~ '^[a-f0-9]{64}$'
          AND source.source_commit_hash ~ '^[a-f0-9]{64}$'
        ORDER BY source.priority
        LIMIT 1
      ),
      narrative_rows AS (
        SELECT projection."id" AS id,
          projection."runId" AS run_id,
          projection."projectionKind"::text AS projection_kind,
          projection."sourceAuthority"::text AS source_authority,
          projection."sourceId" AS source_id,
          projection."sourceCommitHash" AS source_commit_hash,
          projection."sourceContentHash" AS source_content_hash,
          projection."narrativeProfileVersion" AS narrative_profile_version,
          projection."projectorVersion" AS projector_version,
          projection."audienceKind"::text AS audience_kind,
          projection."audienceSeatId" AS audience_seat_id,
          projection."audienceKey" AS audience_key,
          projection."status"::text AS status,
          projection."artifactJson" AS artifact_json,
          projection."artifactContentHash" AS artifact_content_hash
        FROM "PressureNarrativeProjection" projection
        CROSS JOIN request_input request
        CROSS JOIN viewer_single viewer
        INNER JOIN route_scope route ON route.run_id = request.run_id
        INNER JOIN narrative_source source ON true
        WHERE projection."runId" = request.run_id
          AND projection."projectionKind"::text = source.projection_kind
          AND projection."sourceAuthority"::text = source.source_authority
          AND projection."sourceId" = source.source_id
          AND projection."sourceCommitHash" = source.source_commit_hash
          AND projection."narrativeProfileVersion" = route.narrative_profile_version
          AND projection."audienceKind"::text = 'SEAT'
          AND projection."audienceSeatId" = viewer.role_key
          AND projection."audienceKey" = viewer.role_key
      ),
      aggregate_candidates AS (
        SELECT event."id" AS event_id,
          event."payloadJson" -> 'aggregate' AS aggregate_json,
          event."payloadJson" ->> 'idempotencyKey' AS idempotency_key,
          event."payloadJson" ->> 'inputFingerprint' AS input_fingerprint,
          CASE
            WHEN (event."payloadJson" #>> '{aggregate,projectionVersion}') ~ '^[0-9]+$'
            THEN (event."payloadJson" #>> '{aggregate,projectionVersion}')::integer
            ELSE NULL
          END AS projection_version,
          event."createdAt" AS created_at
        FROM "StoryEvent" event
        CROSS JOIN request_input request
        CROSS JOIN viewer_single viewer
        WHERE event."runId" = request.run_id
          AND event."type" = 'PRESSURE_A_EMOTION_AGGREGATE_V1'
          AND event."payloadJson" ->> 'schemaVersion'
            = 'pressure_a_emotion_story_event_v1'
          AND event."payloadJson" ->> 'kind' = 'AGGREGATE'
          AND event."payloadJson" #>> '{aggregate,roomId}' = request.room_id
          AND event."payloadJson" #>> '{aggregate,runId}' = request.run_id
          AND event."payloadJson" #>> '{aggregate,viewerSeatId}' = viewer.role_key
          AND event."payloadJson" #>> '{delivery,viewerSeatId}' = viewer.role_key
          AND event."payloadJson" #>> '{delivery,aggregationKey}'
            = event."payloadJson" #>> '{aggregate,aggregationKey}'
          AND event."payloadJson" #>> '{delivery,eventId}'
            = event."payloadJson" #>> '{aggregate,projection,eventId}'
          AND event."payloadJson" #>> '{delivery,projectionVersion}'
            = event."payloadJson" #>> '{aggregate,projectionVersion}'
      ),
      latest_aggregates AS (
        SELECT DISTINCT ON (candidate.aggregate_json ->> 'aggregationKey')
          candidate.*
        FROM aggregate_candidates candidate
        WHERE candidate.projection_version IS NOT NULL
          AND candidate.aggregate_json ->> 'aggregationKey' IS NOT NULL
        ORDER BY candidate.aggregate_json ->> 'aggregationKey',
          candidate.projection_version DESC,
          candidate.created_at DESC,
          candidate.event_id DESC
      ),
      delivery_matches AS (
        SELECT aggregate.aggregate_json,
          aggregate.projection_version,
          count(delivery."id")::integer AS match_count,
          min(delivery."deliveredAt") AS delivered_at
        FROM latest_aggregates aggregate
        CROSS JOIN request_input request
        CROSS JOIN viewer_single viewer
        LEFT JOIN "EventDelivery" delivery
          ON delivery."roomId" = request.room_id
          AND delivery."userId" = request.subject_id
          AND delivery."roleId" = viewer.role_id
          AND delivery."eventId" = aggregate.aggregate_json #>> '{projection,eventId}'
          AND delivery."payloadJson" ->> 'schemaVersion'
            = 'pressure_a_emotion_delivery_seed_v1'
          AND delivery."payloadJson" ->> 'kind' = 'A_EMOTION_DELIVERY'
          AND delivery."payloadJson" ->> 'eventId'
            = aggregate.aggregate_json #>> '{projection,eventId}'
          AND delivery."payloadJson" ->> 'viewerSeatId' = viewer.role_key
          AND delivery."payloadJson" ->> 'aggregationKey'
            = aggregate.aggregate_json ->> 'aggregationKey'
          AND delivery."payloadJson" ->> 'projectionVersion'
            = aggregate.aggregate_json ->> 'projectionVersion'
        GROUP BY aggregate.aggregate_json, aggregate.projection_version
      ),
      delivery_mark_candidates AS (
        SELECT mark."payloadJson" ->> 'eventId' AS event_id,
          CASE
            WHEN (mark."payloadJson" ->> 'projectionVersion') ~ '^[0-9]+$'
            THEN (mark."payloadJson" ->> 'projectionVersion')::integer
            ELSE NULL
          END AS projection_version,
          mark."payloadJson" ->> 'operation' AS operation,
          mark."payloadJson" ->> 'occurredAt' AS occurred_at
        FROM "StoryEvent" mark
        CROSS JOIN request_input request
        CROSS JOIN viewer_single viewer
        WHERE mark."runId" = request.run_id
          AND mark."type" = 'PRESSURE_A_EMOTION_DELIVERY_MARK_V1'
          AND mark."payloadJson" ->> 'schemaVersion'
            = 'pressure_a_emotion_story_event_v1'
          AND mark."payloadJson" ->> 'kind' = 'DELIVERY_MARK'
          AND mark."payloadJson" ->> 'roomId' = request.room_id
          AND mark."payloadJson" ->> 'runId' = request.run_id
          AND mark."payloadJson" ->> 'viewerSeatId' = viewer.role_key
      ),
      delivery_marks AS (
        SELECT mark.event_id,
          mark.projection_version,
          min(mark.occurred_at)
            FILTER (WHERE mark.operation = 'SEEN') AS seen_at,
          min(mark.occurred_at)
            FILTER (WHERE mark.operation = 'ACKNOWLEDGED') AS acknowledged_at,
          min(mark.occurred_at)
            FILTER (WHERE mark.operation = 'RESOLVED') AS resolved_at,
          min(mark.occurred_at)
            FILTER (WHERE mark.operation = 'MODAL_SHOWN') AS modal_shown_at
        FROM delivery_mark_candidates mark
        WHERE mark.projection_version IS NOT NULL
          AND mark.event_id IS NOT NULL
          AND mark.occurred_at IS NOT NULL
        GROUP BY mark.event_id, mark.projection_version
      ),
      feed_materialized AS (
        SELECT delivery.aggregate_json,
          delivery.match_count,
          jsonb_build_object(
            'aggregate', delivery.aggregate_json,
            'delivery', CASE
              WHEN delivery.match_count = 1 THEN jsonb_build_object(
                'eventId', delivery.aggregate_json #>> '{projection,eventId}',
                'projectionVersion', delivery.projection_version,
                'roomId', request.room_id,
                'runId', request.run_id,
                'viewerSeatId', viewer.role_key,
                'deliveredAt', delivery.delivered_at,
                'seenAt', marks.seen_at,
                'acknowledgedAt', marks.acknowledged_at,
                'resolvedAt', marks.resolved_at,
                'keyModalShownAt', marks.modal_shown_at
              )
              ELSE NULL
            END
          ) AS feed_row
        FROM delivery_matches delivery
        CROSS JOIN request_input request
        CROSS JOIN viewer_single viewer
        LEFT JOIN delivery_marks marks
          ON marks.event_id = delivery.aggregate_json #>> '{projection,eventId}'
          AND marks.projection_version = delivery.projection_version
      )
      SELECT
        jsonb_build_object(
          'roomId', request.room_id,
          'runId', request.run_id,
          'subjectId', request.subject_id,
          'feedCursor', request.feed_cursor,
          'feedLimit', request.feed_limit,
          'capturedAtMs', request.captured_at_ms
        ) AS "requestEcho",
        (SELECT route.route_record FROM route_scope route) AS "routeRecord",
        (
          SELECT COALESCE(jsonb_agg(jsonb_build_object(
            'playerId', viewer.player_id,
            'runId', viewer.run_id,
            'userId', viewer.user_id,
            'playerType', viewer.player_type,
            'status', viewer.player_status,
            'roleId', viewer.role_id,
            'roleRunId', viewer.role_run_id,
            'roleKey', viewer.role_key,
            'roleName', viewer.role_name
          ) ORDER BY viewer.player_id), '[]'::jsonb)
          FROM viewer_rows viewer
        ) AS "membershipRows",
        (
          SELECT jsonb_build_object(
            'runId', seat.run_id,
            'stateRevision', seat.state_revision,
            'stateHash', seat.state_hash,
            'snapshotJson', seat.authority_json,
            'version', seat.version
          )
          FROM seat_scope seat
        ) AS "seatRecord",
        (SELECT viewer.private_projection FROM viewer_private viewer)
          AS "privateProjectionRecord",
        (
          SELECT jsonb_build_object(
            'runId', world.run_id,
            'version', world.version,
            'currentNodeId', world.current_node_id,
            'worldSequence', world.world_sequence,
            'reservedWorldSequence', world.reserved_world_sequence,
            'stateJson', world.state_json
          )
          FROM world_scope world
        ) AS "worldRecord",
        (
          SELECT jsonb_build_object(
            'runId', genesis.run_id,
            'sequence', genesis.sequence,
            'genesisHash', genesis.genesis_hash,
            'commitHash', genesis.commit_hash,
            'rootEventId', genesis.root_event_id,
            'commitManifestJson', genesis.commit_manifest_json
          )
          FROM genesis_scope genesis
        ) AS "genesisRecord",
        jsonb_build_object(
          'totalRowCount', (SELECT count(*) FROM orchestrator_all),
          'boundRowCount', (SELECT count(*) FROM orchestrator_bound),
          'count', (SELECT count(*) FROM orchestrator_bound),
          'minRevision', (SELECT min(revision) FROM orchestrator_bound),
          'maxRevision', (SELECT max(revision) FROM orchestrator_bound),
          'distinctRevisionCount',
            (SELECT count(DISTINCT revision) FROM orchestrator_bound),
          'latestState', (SELECT state_json FROM orchestrator_latest)
        ) AS "orchestratorStats",
        (
          SELECT jsonb_build_object(
            'id', runtime.id,
            'runId', runtime.run_id,
            'chapterId', runtime.chapter_id,
            'chapterSequence', runtime.chapter_sequence,
            'state', runtime.runtime_state,
            'routeHash', runtime.route_hash,
            'baseWorldSequence', runtime.base_world_sequence,
            'baseWorldStateHash', runtime.base_world_state_hash,
            'previousFrozenHash', runtime.previous_frozen_hash,
            'contentPackageVersion', runtime.content_package_version,
            'contentHash', runtime.content_hash,
            'orchestrationPackageVersion', runtime.orchestration_package_version,
            'orchestrationHash', runtime.orchestration_hash,
            'runtimeContractVersion', runtime.runtime_contract_version,
            'runtimeContractHash', runtime.runtime_contract_hash,
            'workingRevision', runtime.working_revision,
            'workingStateJson', runtime.working_state_json,
            'workingStateHash', runtime.working_state_hash,
            'ledgerHeadSequence', runtime.ledger_head_sequence,
            'ledgerHeadHash', runtime.ledger_head_hash,
            'decisionStateJson', runtime.decision_state_json,
            'ledgerProjectionJson', runtime.ledger_projection_json,
            'lockVersion', runtime.lock_version
          )
          FROM runtime_scope runtime
        ) AS "runtimeRecord",
        (
          SELECT jsonb_build_object(
            'chapterRuntimeId', source.chapter_runtime_id,
            'projectionKind', source.projection_kind,
            'sourceAuthority', source.source_authority,
            'sourceId', source.source_id,
            'sourceCommitHash', source.source_commit_hash
          )
          FROM narrative_source source
        ) AS "narrativeSource",
        (
          SELECT COALESCE(jsonb_agg(jsonb_build_object(
            'id', narrative.id,
            'runId', narrative.run_id,
            'projectionKind', narrative.projection_kind,
            'sourceAuthority', narrative.source_authority,
            'sourceId', narrative.source_id,
            'sourceCommitHash', narrative.source_commit_hash,
            'sourceContentHash', narrative.source_content_hash,
            'narrativeProfileVersion', narrative.narrative_profile_version,
            'projectorVersion', narrative.projector_version,
            'audienceKind', narrative.audience_kind,
            'audienceSeatId', narrative.audience_seat_id,
            'audienceKey', narrative.audience_key,
            'status', narrative.status,
            'artifactJson', narrative.artifact_json,
            'artifactContentHash', narrative.artifact_content_hash
          ) ORDER BY narrative.projector_version, narrative.id), '[]'::jsonb)
          FROM narrative_rows narrative
        ) AS "narrativeRows",
        (
          SELECT COALESCE(jsonb_agg(feed.feed_row
            ORDER BY feed.aggregate_json ->> 'aggregationKey'), '[]'::jsonb)
          FROM feed_materialized feed
        ) AS "feedRows",
        (SELECT count(*) FROM latest_aggregates) AS "feedAggregateCount",
        (SELECT count(*) FROM feed_materialized WHERE match_count = 1)
          AS "feedExactDeliveryCount",
        (SELECT count(*) FROM feed_materialized WHERE match_count > 1)
          AS "feedAmbiguousDeliveryCount",
        (
          SELECT count(*) FROM aggregate_candidates aggregate
          WHERE aggregate.projection_version IS NULL
            OR aggregate.projection_version < 1
            OR COALESCE(aggregate.aggregate_json ->> 'aggregationKey', '') = ''
        ) AS "feedInvalidAggregateCount",
        (
          SELECT count(*) FROM (
            SELECT aggregate.aggregate_json ->> 'aggregationKey' AS aggregation_key,
              aggregate.projection_version
            FROM aggregate_candidates aggregate
            WHERE aggregate.projection_version IS NOT NULL
              AND COALESCE(aggregate.aggregate_json ->> 'aggregationKey', '') <> ''
            GROUP BY aggregate.aggregate_json ->> 'aggregationKey',
              aggregate.projection_version
            HAVING count(*) > 1
          ) duplicate_version
        ) AS "feedDuplicateAggregateVersionCount",
        (
          SELECT count(*) FROM delivery_mark_candidates mark
          WHERE mark.projection_version IS NULL
            OR mark.projection_version < 1
            OR COALESCE(mark.event_id, '') = ''
            OR mark.operation NOT IN ('SEEN', 'ACKNOWLEDGED', 'RESOLVED', 'MODAL_SHOWN')
            OR COALESCE(mark.occurred_at, '') = ''
        ) AS "feedInvalidMarkCount"
      FROM request_input request
      `);
    } catch {
      throw error("QUERY_FAILED", "query", "READ_ONLY_AGGREGATE_QUERY_FAILED");
    }
    if (!Array.isArray(rows) || rows.length !== 1) {
      throw rows.length === 0
        ? error("QUERY_RESULT_INVALID", "query.rows", "MISSING_AGGREGATE_ROW")
        : error("QUERY_RESULT_INVALID", "query.rows", "DUPLICATE_AGGREGATE_ROW");
    }
    const rawRow = await materializeRawRow(rows[0]!, input, request, this.local);
    return decodeGameReadSnapshotV1([rawRow], request);
  }
}

function validateCaptureInput(
  value: Readonly<CaptureGameReadSnapshotV1>,
): CaptureGameReadSnapshotV1 {
  if (!value || typeof value !== "object") {
    throw error("INPUT_INVALID", "input", "OBJECT_REQUIRED");
  }
  if (
    !nonEmpty(value.roomId)
    || !nonEmpty(value.runId)
    || !nonEmpty(value.subjectId)
    || value.roomId !== value.runId
    || (value.feedCursor !== null && !nonEmpty(value.feedCursor))
    || !Number.isSafeInteger(value.feedLimit)
    || value.feedLimit < 1
    || value.feedLimit > 10
    || !Number.isSafeInteger(value.capturedAtMs)
    || value.capturedAtMs < 0
  ) {
    throw error("INPUT_INVALID", "input", "INVALID_SCOPE_OR_PAGINATION");
  }
  return {
    roomId: value.roomId,
    runId: value.runId,
    subjectId: value.subjectId,
    feedCursor: value.feedCursor,
    feedLimit: value.feedLimit,
    capturedAtMs: value.capturedAtMs,
  };
}

function toSnapshotRequest(input: CaptureGameReadSnapshotV1): GameReadSnapshotRequestV1 {
  return {
    schemaVersion: PRESSURE_GAME_READ_SNAPSHOT_REQUEST_SCHEMA_V1,
    roomId: input.roomId,
    runId: input.runId,
    subjectId: input.subjectId,
    feedCursor: input.feedCursor,
    feedLimit: input.feedLimit,
  };
}

async function materializeRawRow(
  row: GameReadSnapshotSqlRowV1,
  input: CaptureGameReadSnapshotV1,
  request: GameReadSnapshotRequestV1,
  local: GameReadSnapshotLocalAuthoritiesV1,
): Promise<GameReadSnapshotRawRowV1> {
  assertRequestEcho(row.requestEcho, input);
  const storedRoute = decodeStoredRoute(row.routeRecord, input.runId);
  const route = validateRunRouteSnapshotV1(storedRoute.snapshot);
  if (route.runId !== input.runId) {
    throw error("AUTHORITY_SCOPE_MISMATCH", "routeRecord", "RUN_MISMATCH");
  }
  const membership = decodeMembership(row.membershipRows, input);
  const seatRow = decodeSeatRow(row.seatRecord, input.runId);
  const seatSnapshot = decodeSeatEnvelope(seatRow).snapshot;
  const worldRecord = requiredRecord(row.worldRecord, "worldRecord");
  if (worldRecord.runId !== input.runId) {
    throw error("AUTHORITY_SCOPE_MISMATCH", "worldRecord.runId", "RUN_MISMATCH");
  }
  const worldState = validateWorldStateV1(worldRecord.stateJson);
  const privateProjection = await resolvePrivateProjection({
    raw: row.privateProjectionRecord,
    route,
    seatSnapshot,
    worldState,
    membership,
    input,
    compiler: local.privateProjection,
  });
  const catalog = materialize(
    "seatCatalog",
    () => local.seatCatalog.readCatalogFromRoute({
      routeSnapshot: route,
      seatId: membership.seatId,
    }),
  );
  const viewerSource = await materializeViewerSource({
    membership,
    seatSnapshot,
    privateProjection,
    catalog,
    input,
  });
  const authorities: DecodedMaterializationAuthoritiesV1 = {
    storedRoute,
    route,
    membership,
    seatRow,
    seatSnapshot,
    privateProjection,
    viewerSource,
    worldRecord,
    worldState,
  };
  const chapterAuthority = await materializeChapterAuthority(
    row,
    authorities,
    local,
  );
  const metrics = materialize("world.metrics", () => local.presentation.metrics(worldState));
  const worldAuthority = {
    runId: input.runId,
    version: worldRecord.version,
    currentNodeId: worldRecord.currentNodeId,
    worldSequence: worldRecord.worldSequence,
    reservedWorldSequence: worldRecord.reservedWorldSequence,
    stateJson: structuredClone(worldState),
    source: {
      runId: input.runId,
      routeHash: route.routeHash,
      worldSequence: worldRecord.worldSequence,
      worldStateHash: worldState.stateHash,
      metrics: structuredClone(metrics),
    },
  };
  const narrativeAuthority = materializeNarrativeAuthority(
    row.narrativeSource,
    row.narrativeRows,
    authorities,
    chapterAuthority,
  );
  const feedRows = decodeFeedRows(row, input);
  return {
    schemaVersion: PRESSURE_GAME_READ_SNAPSHOT_RAW_ROW_SCHEMA_V1,
    routeRecord: structuredClone(storedRoute),
    membershipRows: structuredClone(row.membershipRows),
    seatAuthority: {
      runId: seatRow.runId,
      stateRevision: seatRow.stateRevision,
      stateHash: seatRow.stateHash,
      snapshotJson: structuredClone(seatSnapshot),
      version: seatRow.version,
    },
    viewerPrivateProjection: structuredClone(privateProjection),
    viewerSource: structuredClone(viewerSource),
    chapterAuthority,
    worldAuthority,
    narrativeAuthority,
    feedAuthority: {
      schemaVersion: "pressure_game_read_feed_authority_v1",
      roomId: input.roomId,
      runId: input.runId,
      viewerSeatId: membership.seatId,
      rows: feedRows,
    },
    capturedAtMs: input.capturedAtMs,
  };
}

function assertRequestEcho(value: unknown, input: CaptureGameReadSnapshotV1): void {
  const echo = requiredRecord(value, "requestEcho");
  if (
    echo.roomId !== input.roomId
    || echo.runId !== input.runId
    || echo.subjectId !== input.subjectId
    || echo.feedCursor !== input.feedCursor
    || echo.feedLimit !== input.feedLimit
    || number(echo.capturedAtMs, "requestEcho.capturedAtMs") !== input.capturedAtMs
  ) {
    throw error("AUTHORITY_SCOPE_MISMATCH", "requestEcho", "REQUEST_BINDING_MISMATCH");
  }
}

function decodeStoredRoute(value: unknown, runId: string): StoredRunRouteRecordV1 {
  try {
    requiredRecord(value, "routeRecord");
    const stored = assertStoredRunRouteRecord(
      structuredClone(value) as StoredRunRouteRecordV1,
    );
    if (stored.runId !== runId) {
      throw error("AUTHORITY_SCOPE_MISMATCH", "routeRecord.runId", "RUN_MISMATCH");
    }
    return stored;
  } catch (cause) {
    if (cause instanceof GameReadSnapshotPrismaErrorV1) throw cause;
    throw error("MATERIALIZATION_FAILED", "routeRecord", "ROUTE_REJECTED");
  }
}

function decodeMembership(
  value: unknown,
  input: CaptureGameReadSnapshotV1,
): DecodedMaterializationAuthoritiesV1["membership"] {
  const rows = requiredArray(value, "membershipRows");
  if (rows.length !== 1) {
    throw rows.length === 0
      ? error("AUTHORITY_MISSING", "membershipRows", "VIEWER_MEMBERSHIP_MISSING")
      : error("AUTHORITY_AMBIGUOUS", "membershipRows", "VIEWER_MEMBERSHIP_DUPLICATE");
  }
  const row = requiredRecord(rows[0], "membershipRows[0]");
  const seatId = validateSeatIdV1(row.roleKey, "membershipRows[0].roleKey");
  if (
    row.runId !== input.runId
    || row.userId !== input.subjectId
    || row.playerType !== "human"
    || row.status !== "active"
    || row.roleRunId !== input.runId
  ) {
    throw error("AUTHORITY_SCOPE_MISMATCH", "membershipRows[0]", "VIEWER_SCOPE_MISMATCH");
  }
  return {
    roomId: input.roomId,
    runId: input.runId,
    subjectId: input.subjectId,
    seatId,
    humanControllerId: input.subjectId,
    playerId: text(row.playerId, "membershipRows[0].playerId"),
    roleId: text(row.roleId, "membershipRows[0].roleId"),
    roleName: text(row.roleName, "membershipRows[0].roleName"),
  };
}

function decodeSeatRow(value: unknown, runId: string): PressureSeatSnapshotRowV1 {
  const row = requiredRecord(value, "seatRecord");
  if (row.runId !== runId) {
    throw error("AUTHORITY_SCOPE_MISMATCH", "seatRecord.runId", "RUN_MISMATCH");
  }
  return {
    runId,
    stateRevision: integer(row.stateRevision, "seatRecord.stateRevision", 0),
    stateHash: hash(row.stateHash, "seatRecord.stateHash"),
    snapshotJson: structuredClone(row.snapshotJson),
    version: integer(row.version, "seatRecord.version", 1),
  };
}

async function resolvePrivateProjection(input: Readonly<{
  raw: unknown;
  route: RunRouteSnapshotV1;
  seatSnapshot: SeatControlSnapshotV1;
  worldState: ReturnType<typeof validateWorldStateV1>;
  membership: DecodedMaterializationAuthoritiesV1["membership"];
  input: CaptureGameReadSnapshotV1;
  compiler: GameReadSnapshotLocalAuthoritiesV1["privateProjection"];
}>): Promise<SeatPrivateProjectionRecordV1> {
  const captured = input.raw === null || input.raw === undefined
    ? null
    : structuredClone(input.raw) as SeatPrivateProjectionRecordV1;
  if (captured) return structuredClone(captured);
  return materialize(
    "viewerPrivateProjection",
    () => input.compiler.compile({
      runId: input.input.runId,
      seatId: input.membership.seatId,
      routeSnapshot: input.route,
      seatAuthority: input.seatSnapshot,
      world: input.worldState,
    }),
  );
}

async function materializeViewerSource(input: Readonly<{
  membership: DecodedMaterializationAuthoritiesV1["membership"];
  seatSnapshot: SeatControlSnapshotV1;
  privateProjection: SeatPrivateProjectionRecordV1;
  catalog: PressureSeatViewerPresentationCatalogV1;
  input: CaptureGameReadSnapshotV1;
}>): Promise<PressureGameViewerSourceV1> {
  const reader = new PrismaPressureGameViewerReaderV1(
    new CapturedMembershipReaderV1(input.membership),
    new CapturedSeatAuthorityV1(input.seatSnapshot),
    new CapturedPresenceV1(),
    new CapturedPrivateProjectionV1(input.privateProjection),
    new CapturedCatalogV1(input.membership, input.catalog),
  );
  const source = await materializeAsync(
    "viewerSource",
    () => reader.readViewer({
      runId: input.input.runId,
      subjectId: input.input.subjectId,
    }),
  );
  if (!source) {
    throw error("AUTHORITY_MISSING", "viewerSource", "VIEWER_SOURCE_MISSING");
  }
  return source;
}

async function materializeChapterAuthority(
  row: GameReadSnapshotSqlRowV1,
  authority: DecodedMaterializationAuthoritiesV1,
  local: GameReadSnapshotLocalAuthoritiesV1,
): Promise<Readonly<Record<string, unknown>>> {
  const worldNode = authority.worldRecord.currentNodeId;
  const stats = requiredRecord(row.orchestratorStats, "orchestratorStats");
  const totalCount = integer(stats.totalRowCount, "orchestratorStats.totalRowCount", 0);
  const boundCount = integer(stats.boundRowCount, "orchestratorStats.boundRowCount", 0);
  if (totalCount !== boundCount) {
    throw error("AUTHORITY_SCOPE_MISMATCH", "orchestratorStats", "UNBOUND_ORCHESTRATOR_EVENT");
  }
  if (worldNode === "P0" && totalCount === 0) {
    const genesis = requiredRecord(row.genesisRecord, "genesisRecord");
    if (genesis.runId !== authority.membership.runId) {
      throw error("AUTHORITY_SCOPE_MISMATCH", "genesisRecord", "RUN_MISMATCH");
    }
    const title = materialize("chapter.p0.title", () => local.presentation.chapterTitle("P0"));
    return {
      kind: "P0",
      chapterSource: {
        runId: authority.membership.runId,
        routeHash: authority.route.routeHash,
        viewerSeatId: authority.membership.seatId,
        projectionVersion: integer(genesis.sequence, "genesisRecord.sequence", 0) + 1,
        chapter: {
          chapterRuntimeId: text(genesis.rootEventId, "genesisRecord.rootEventId"),
          chapterId: "P0",
          chapterNumber: 0,
          title,
          phase: "ACTIVE",
          workingRevision: 0,
        },
        decision: null,
      },
    };
  }
  if (totalCount === 0) {
    throw error("AUTHORITY_MISSING", "orchestratorStats", "ORCHESTRATOR_MISSING");
  }
  requiredRecord(stats.latestState, "orchestratorStats.latestState");
  const latestState = materialize(
    "orchestratorStats.latestState",
    () => validateOrchestratorStateV1(
      structuredClone(stats.latestState) as ChapterOrchestratorStateV1,
    ),
  );
  const runtime = requiredRecord(row.runtimeRecord, "runtimeRecord");
  if (
    latestState.runId !== authority.membership.runId
    || latestState.routeHash !== authority.route.routeHash
    || latestState.chapterRuntimeId !== runtime.id
    || latestState.currentChapterId !== runtime.chapterId
  ) {
    throw error("AUTHORITY_SCOPE_MISMATCH", "runtimeRecord", "ORCHESTRATOR_RUNTIME_MISMATCH");
  }
  const descriptor = await materializeAsync(
    "chapterDescriptor",
    () => local.chapters.load({
      routeSnapshot: authority.route,
      chapterId: latestState.currentChapterId,
    }),
  );
  return {
    kind: "CHAPTER",
    orchestrator: {
      count: stats.count,
      minRevision: stats.minRevision,
      maxRevision: stats.maxRevision,
      distinctRevisionCount: stats.distinctRevisionCount,
      latestState,
    },
    runtime: structuredClone(runtime),
    descriptor,
  };
}

function materializeNarrativeAuthority(
  sourceValue: unknown,
  rowsValue: unknown,
  authority: DecodedMaterializationAuthoritiesV1,
  chapterAuthority: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  const source = requiredRecord(sourceValue, "narrativeSource");
  const rows = requiredArray(rowsValue, "narrativeRows");
  if (rows.length !== 1) {
    throw rows.length === 0
      ? error("AUTHORITY_MISSING", "narrativeRows", "VIEWER_NARRATIVE_MISSING")
      : error("AUTHORITY_AMBIGUOUS", "narrativeRows", "VIEWER_NARRATIVE_DUPLICATE");
  }
  const row = requiredRecord(rows[0], "narrativeRows[0]");
  const chapterRuntimeId = chapterAuthority.kind === "P0"
    ? text(
        requiredRecord(
          requiredRecord(chapterAuthority.chapterSource, "chapterAuthority.chapterSource").chapter,
          "chapterAuthority.chapterSource.chapter",
        ).chapterRuntimeId,
        "chapterAuthority.chapterSource.chapter.chapterRuntimeId",
      )
    : text(requiredRecord(chapterAuthority.runtime, "chapterAuthority.runtime").id, "chapterAuthority.runtime.id");
  if (
    source.chapterRuntimeId !== chapterRuntimeId
    || row.runId !== authority.membership.runId
    || row.projectionKind !== source.projectionKind
    || row.sourceAuthority !== source.sourceAuthority
    || row.sourceId !== source.sourceId
    || row.sourceCommitHash !== source.sourceCommitHash
    || row.narrativeProfileVersion !== authority.route.narrativeProfileVersion
    || row.audienceKind !== "SEAT"
    || row.audienceSeatId !== authority.membership.seatId
    || row.audienceKey !== authority.membership.seatId
  ) {
    throw error("AUTHORITY_SCOPE_MISMATCH", "narrativeRows[0]", "NARRATIVE_BINDING_MISMATCH");
  }
  const status = text(row.status, "narrativeRows[0].status");
  const artifact = row.artifactJson === null || row.artifactJson === undefined
    ? null
    : requiredRecord(row.artifactJson, "narrativeRows[0].artifactJson");
  if (artifact === null) {
    if (row.artifactContentHash !== null && row.artifactContentHash !== undefined) {
      throw error(
        "AUTHORITY_SCOPE_MISMATCH",
        "narrativeRows[0].artifactContentHash",
        "UNPUBLISHED_ARTIFACT_HASH_PRESENT",
      );
    }
  } else {
    const storedArtifactHash = hash(
      row.artifactContentHash,
      "narrativeRows[0].artifactContentHash",
    );
    if (artifact.contentHash !== storedArtifactHash) {
      throw error(
        "AUTHORITY_SCOPE_MISMATCH",
        "narrativeRows[0].artifactContentHash",
        "ARTIFACT_STORAGE_HASH_MISMATCH",
      );
    }
  }
  return {
    source: {
      runId: authority.membership.runId,
      routeHash: authority.route.routeHash,
      viewerSeatId: authority.membership.seatId,
      chapterRuntimeId,
      status,
      projectionKind: source.projectionKind,
      sourceAuthority: source.sourceAuthority,
      sourceId: source.sourceId,
      sourceCommitHash: source.sourceCommitHash,
      text: artifact?.text ?? null,
      contentHash: artifact?.contentHash ?? null,
      renderMode: artifact?.renderMode ?? null,
    },
    sourceContentHash: row.sourceContentHash,
    narrativeProfileVersion: row.narrativeProfileVersion,
    projectorVersion: row.projectorVersion,
    artifactJson: artifact === null ? null : structuredClone(artifact),
  };
}

function decodeFeedRows(
  row: GameReadSnapshotSqlRowV1,
  input: CaptureGameReadSnapshotV1,
): unknown[] {
  const feedRows = requiredArray(row.feedRows, "feedRows");
  const aggregateCount = integer(row.feedAggregateCount, "feedAggregateCount", 0);
  const exactDeliveryCount = integer(row.feedExactDeliveryCount, "feedExactDeliveryCount", 0);
  const ambiguousDeliveryCount = integer(
    row.feedAmbiguousDeliveryCount,
    "feedAmbiguousDeliveryCount",
    0,
  );
  const invalidAggregateCount = integer(
    row.feedInvalidAggregateCount,
    "feedInvalidAggregateCount",
    0,
  );
  const duplicateAggregateVersionCount = integer(
    row.feedDuplicateAggregateVersionCount,
    "feedDuplicateAggregateVersionCount",
    0,
  );
  const invalidMarkCount = integer(
    row.feedInvalidMarkCount,
    "feedInvalidMarkCount",
    0,
  );
  if (
    feedRows.length !== aggregateCount
    || exactDeliveryCount !== aggregateCount
    || ambiguousDeliveryCount !== 0
    || invalidAggregateCount !== 0
    || duplicateAggregateVersionCount !== 0
    || invalidMarkCount !== 0
  ) {
    throw error("QUERY_RESULT_INVALID", "feedRows", "AGGREGATE_DELIVERY_CARDINALITY_MISMATCH");
  }
  for (const [index, value] of feedRows.entries()) {
    const item = requiredRecord(value, `feedRows[${index}]`);
    const aggregate = requiredRecord(item.aggregate, `feedRows[${index}].aggregate`);
    const projection = requiredRecord(
      aggregate.projection,
      `feedRows[${index}].aggregate.projection`,
    );
    const delivery = requiredRecord(item.delivery, `feedRows[${index}].delivery`);
    if (
      aggregate.roomId !== input.roomId
      || aggregate.runId !== input.runId
      || projection.roomId !== input.roomId
      || projection.runId !== input.runId
      || delivery.roomId !== input.roomId
      || delivery.runId !== input.runId
    ) {
      throw error("AUTHORITY_SCOPE_MISMATCH", `feedRows[${index}]`, "FEED_SCOPE_MISMATCH");
    }
  }
  return structuredClone(feedRows);
}

class CapturedMembershipReaderV1
implements PressureSeatViewerMembershipReaderPortV1 {
  constructor(private readonly membership: DecodedMaterializationAuthoritiesV1["membership"]) {}

  async readSubjectMembership(input: {
    runId: string;
    subjectId: string;
  }): Promise<PressureSeatViewerMembershipV1 | null> {
    if (
      input.runId !== this.membership.runId
      || input.subjectId !== this.membership.subjectId
    ) return null;
    return structuredClone(this.membership);
  }
}

class CapturedSeatAuthorityV1 implements SeatControlAuthorityPort {
  constructor(private readonly snapshot: SeatControlSnapshotV1) {}

  async readSnapshot(runId: string): Promise<SeatControlSnapshotV1 | null> {
    return runId === this.snapshot.runId ? structuredClone(this.snapshot) : null;
  }

  async readCommittedCommand(): Promise<null> {
    return null;
  }

  async initializeOnce(): Promise<SeatControlInitializePortResultV1> {
    throw error("READ_ONLY_VIOLATION", "capturedSeatAuthority.initializeOnce", "WRITE_FORBIDDEN");
  }

  async commitTransition(
    _command: SeatControlTransitionCommitV1,
  ): Promise<SeatControlTransitionPortResultV1> {
    throw error("READ_ONLY_VIOLATION", "capturedSeatAuthority.commitTransition", "WRITE_FORBIDDEN");
  }
}

class CapturedPresenceV1 implements SeatPresencePort {
  async readForSeat(
    _runId: string,
    _seatId: SeatIdV1,
    _humanControllerId: string,
  ): Promise<null> {
    return null;
  }

  async record(): Promise<never> {
    throw error("READ_ONLY_VIOLATION", "capturedPresence.record", "WRITE_FORBIDDEN");
  }
}

class CapturedPrivateProjectionV1 implements SeatPrivateProjectionPort {
  constructor(private readonly projection: SeatPrivateProjectionRecordV1) {}

  async readForSeat(input: {
    runId: string;
    seatId: SeatIdV1;
    sourceAuthorityHash: string;
  }): Promise<SeatPrivateProjectionRecordV1> {
    if (
      input.runId !== this.projection.runId
      || input.seatId !== this.projection.seatId
      || input.sourceAuthorityHash !== this.projection.sourceAuthorityHash
    ) {
      throw error("AUTHORITY_SCOPE_MISMATCH", "viewerPrivateProjection", "PRIVATE_SCOPE_MISMATCH");
    }
    return structuredClone(this.projection);
  }
}

class CapturedCatalogV1 implements PressureSeatViewerPresentationCatalogPortV1 {
  constructor(
    private readonly membership: DecodedMaterializationAuthoritiesV1["membership"],
    private readonly catalog: PressureSeatViewerPresentationCatalogV1,
  ) {}

  async readCatalog(input: {
    runId: string;
    seatId: SeatIdV1;
  }): Promise<PressureSeatViewerPresentationCatalogV1 | null> {
    if (
      input.runId !== this.membership.runId
      || input.seatId !== this.membership.seatId
    ) return null;
    return structuredClone(this.catalog);
  }
}

function requiredRecord(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw error("AUTHORITY_MISSING", path, "OBJECT_REQUIRED");
  }
  return value as Record<string, unknown>;
}

function requiredArray(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) {
    throw error("QUERY_RESULT_INVALID", path, "ARRAY_REQUIRED");
  }
  return value;
}

function text(value: unknown, path: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw error("QUERY_RESULT_INVALID", path, "NON_EMPTY_STRING_REQUIRED");
  }
  return value;
}

function hash(value: unknown, path: string): string {
  const result = text(value, path);
  if (!isSha256(result)) {
    throw error("QUERY_RESULT_INVALID", path, "SHA256_REQUIRED");
  }
  return result;
}

function number(value: unknown, path: string): number {
  if (typeof value === "bigint") {
    const converted = Number(value);
    if (Number.isSafeInteger(converted)) return converted;
  }
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw error("QUERY_RESULT_INVALID", path, "FINITE_NUMBER_REQUIRED");
  }
  return value;
}

function integer(value: unknown, path: string, minimum: number): number {
  const result = number(value, path);
  if (!Number.isSafeInteger(result) || result < minimum) {
    throw error("QUERY_RESULT_INVALID", path, `INTEGER_MIN_${minimum}`);
  }
  return result;
}

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function materialize<T>(path: string, operation: () => T): T {
  try {
    return operation();
  } catch (cause) {
    if (cause instanceof GameReadSnapshotPrismaErrorV1) throw cause;
    throw error("MATERIALIZATION_FAILED", path, "EXISTING_AUTHORITY_REJECTED");
  }
}

async function materializeAsync<T>(path: string, operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (cause) {
    if (cause instanceof GameReadSnapshotPrismaErrorV1) throw cause;
    throw error("MATERIALIZATION_FAILED", path, "EXISTING_AUTHORITY_REJECTED");
  }
}

function error(
  code: keyof typeof GAME_READ_SNAPSHOT_PRISMA_ERROR_CODES_V1,
  path: string,
  detail: string,
): GameReadSnapshotPrismaErrorV1 {
  return new GameReadSnapshotPrismaErrorV1(
    GAME_READ_SNAPSHOT_PRISMA_ERROR_CODES_V1[code],
    path,
    detail,
  );
}
