import {
  NARRATIVE_STATUSES_V1,
  PRESSURE_CHAPTER_SEAT_IDS_V1,
  TRACK_IDS_V1,
  isSha256,
  sha256Canonical,
  validateAEmotionViewerProjectionV1,
  validateOpenNovelNarrativeArtifactV1,
  validateRunRouteSnapshotV1,
  validateSeatIdV1,
  validateWorldStateV1,
  type ChapterIdV1,
  type RunRouteSnapshotV1,
  type SeatIdV1,
} from "@ai-story/shared";
import {
  projectAEmotionFeedPageV1,
} from "../a-emotion/feed.service";
import {
  A_EMOTION_PROJECTION_VERSION_V1,
  parseAEmotionAggregationKeyV1,
} from "../a-emotion/identity";
import type {
  AEmotionAggregateRecordV1,
  AEmotionDeliveryRecordV1,
} from "../a-emotion/ports";
import type {
  AuthoredChapterRuntimeV1,
  ChapterOrchestratorStateV1,
} from "../orchestrator/contracts";
import {
  validateAuthoredChapterRuntimeV1,
  validateOrchestratorStateV1,
} from "../orchestrator/validation";
import {
  decodePressureMvpDecisionStateV1,
  type PressureMvpDecisionStateV1,
} from "../persistence/mvp-decision-state";
import {
  assertStoredRunRouteRecord,
  type StoredRunRouteRecordV1,
} from "../run-router";
import type {
  SeatAuthorityRecordV1,
  SeatControlSnapshotV1,
  SeatPrivateProjectionRecordV1,
} from "../seat-control/types";
import {
  decodeSeatEnvelope,
  type PressureSeatSnapshotRowV1,
} from "../seat-control-persistence/envelope";
import {
  decodeWorkingLedgerProjectionCacheV1,
} from "../working-ledger/projection-cache";
import type { WorkingLedgerProjectionV1 } from "../working-ledger/contracts";
import type {
  AEmotionFeedPagePortV1,
  PressureGameChapterSourceV1,
  PressureGameNarrativeSourceV1,
  PressureGameViewerSourceV1,
  PressureGameWorldSourceV1,
  PressureGameChapterSummarySourceV1,
  ProjectPressureChapterGameProjectionFromSourcesV1,
} from "./contracts";

export const PRESSURE_GAME_READ_SNAPSHOT_SCHEMA_V1 =
  "pressure_game_read_snapshot_v1" as const;
export const PRESSURE_GAME_READ_SNAPSHOT_REQUEST_SCHEMA_V1 =
  "pressure_game_read_snapshot_request_v1" as const;
export const PRESSURE_GAME_READ_SNAPSHOT_RAW_ROW_SCHEMA_V1 =
  "pressure_game_read_snapshot_raw_row_v1" as const;

export const GAME_READ_SNAPSHOT_ERROR_CODES = Object.freeze({
  INPUT_INVALID: "GAME_READ_SNAPSHOT_INPUT_INVALID",
  ROW_COUNT_INVALID: "GAME_READ_SNAPSHOT_ROW_COUNT_INVALID",
  FIELD_INVALID: "GAME_READ_SNAPSHOT_FIELD_INVALID",
  SCOPE_MISMATCH: "GAME_READ_SNAPSHOT_SCOPE_MISMATCH",
  HASH_MISMATCH: "GAME_READ_SNAPSHOT_HASH_MISMATCH",
  REVISION_MISMATCH: "GAME_READ_SNAPSHOT_REVISION_MISMATCH",
  FENCE_MISMATCH: "GAME_READ_SNAPSHOT_FENCE_MISMATCH",
  PRIVATE_PROJECTION_INVALID: "GAME_READ_SNAPSHOT_PRIVATE_PROJECTION_INVALID",
  CHAPTER_AUTHORITY_INVALID: "GAME_READ_SNAPSHOT_CHAPTER_AUTHORITY_INVALID",
  DECISION_STATE_INVALID: "GAME_READ_SNAPSHOT_DECISION_STATE_INVALID",
  NARRATIVE_INVALID: "GAME_READ_SNAPSHOT_NARRATIVE_INVALID",
  FEED_INVALID: "GAME_READ_SNAPSHOT_FEED_INVALID",
} as const);

export type GameReadSnapshotErrorCodeV1 =
  (typeof GAME_READ_SNAPSHOT_ERROR_CODES)[keyof typeof GAME_READ_SNAPSHOT_ERROR_CODES];

export class GameReadSnapshotErrorV1 extends Error {
  readonly code: GameReadSnapshotErrorCodeV1;
  readonly path: string;
  readonly detail: string;

  constructor(code: GameReadSnapshotErrorCodeV1, path: string, detail: string) {
    super(`${code}:${path}:${detail}`);
    this.name = "GameReadSnapshotErrorV1";
    this.code = code;
    this.path = path;
    this.detail = detail;
  }
}

export interface GameReadSnapshotRequestV1 {
  schemaVersion: typeof PRESSURE_GAME_READ_SNAPSHOT_REQUEST_SCHEMA_V1;
  roomId: string;
  runId: string;
  subjectId: string;
  feedCursor: string | null;
  feedLimit: number;
}

/** One JSON/JSONB aggregate row returned by the future M2 adapter. */
export interface GameReadSnapshotRawRowV1 {
  schemaVersion: typeof PRESSURE_GAME_READ_SNAPSHOT_RAW_ROW_SCHEMA_V1;
  routeRecord: unknown;
  membershipRows: unknown;
  seatAuthority: unknown;
  viewerPrivateProjection: unknown;
  viewerSource: unknown;
  chapterAuthority: unknown;
  worldAuthority: unknown;
  narrativeAuthority: unknown;
  feedAuthority: unknown;
  capturedAtMs: unknown;
}

export interface GameReadViewerSeatAuthorityV1 {
  runId: string;
  routeHash: string;
  participantMode: RunRouteSnapshotV1["participantMode"];
  seatAuthorityStateHash: string;
  seatAuthorityRevision: number;
  seatAuthorityTimelineHeadHash: string;
  seatId: SeatIdV1;
  mode: SeatAuthorityRecordV1["mode"];
  controlEpoch: number;
  submissionFenceToken: string;
  reclaimFenceToken: string | null;
  privateProjectionVersion: string;
  privateProjectionHash: string;
}

export interface GameReadWorldAuthorityV1 {
  runId: string;
  version: number;
  currentNodeId: string | null;
  worldSequence: number;
  reservedWorldSequence: number;
  worldStateHash: string;
}

export interface GameReadOrchestratorHistoryV1 {
  count: number;
  minRevision: number;
  maxRevision: number;
  distinctRevisionCount: number;
}

export interface GameReadDynamicChapterEvidenceV1 {
  kind: "CHAPTER";
  runtime: Readonly<{
    id: string;
    runId: string;
    chapterId: ChapterIdV1;
    chapterSequence: number;
    state: string;
    routeHash: string;
    baseWorldSequence: number;
    baseWorldStateHash: string;
    previousFrozenHash: string;
    workingRevision: number;
    workingStateHash: string;
    ledgerHeadSequence: number;
    ledgerHeadHash: string;
    lockVersion: number;
  }>;
  orchestratorHistory: GameReadOrchestratorHistoryV1;
  decisionState: PressureMvpDecisionStateV1;
  workingProjectionCacheHash: string;
}

export interface GameReadP0ChapterEvidenceV1 {
  kind: "P0";
  chapterRuntimeId: string;
}

export type GameReadChapterEvidenceV1 =
  | GameReadDynamicChapterEvidenceV1
  | GameReadP0ChapterEvidenceV1;

export interface GameReadFeedAuthorityV1 {
  rowCount: number;
  sourceIdentityHash: string;
}

/**
 * Dynamic chapters are already the exact input accepted by the sole existing
 * projectFromResolvedSources() method. No adapter or copied projector is needed.
 */
export type GameReadDynamicResolvedSourcesV1 =
  ProjectPressureChapterGameProjectionFromSourcesV1;

/**
 * The only missing seam in the existing projector is P0: all common resolved
 * sources are identical, while chapterSource replaces the dynamic W4/W5 triple.
 * M3 may widen the one existing method to this union and branch only on the
 * presence of chapterSource before calling its existing projectResolvedSources().
 */
export type GameReadP0ResolvedSourcesV1 = Omit<
  ProjectPressureChapterGameProjectionFromSourcesV1,
  "chapter" | "workingProjection" | "chapterDescriptor"
> & {
  chapterSource: PressureGameChapterSourceV1;
};

export type GameReadSnapshotResolvedSourcesV1 =
  | GameReadDynamicResolvedSourcesV1
  | GameReadP0ResolvedSourcesV1;

export interface GameReadCapabilityAuthorityInputsV1 {
  viewerControl: PressureGameViewerSourceV1["viewer"]["control"];
  chapterPhase: PressureGameChapterSourceV1["chapter"]["phase"];
  decisionState: PressureMvpDecisionStateV1 | null;
}

export interface GameReadSnapshotV1 {
  schemaVersion: typeof PRESSURE_GAME_READ_SNAPSHOT_SCHEMA_V1;
  request: GameReadSnapshotRequestV1;
  sources: GameReadSnapshotResolvedSourcesV1;
  authority: Readonly<{
    storedRouteRecordHash: string;
    viewer: GameReadViewerSeatAuthorityV1;
    chapter: GameReadChapterEvidenceV1;
    world: GameReadWorldAuthorityV1;
    feed: GameReadFeedAuthorityV1;
    capabilityInputs: GameReadCapabilityAuthorityInputsV1;
  }>;
  resolvedChapterSummary: PressureGameChapterSummarySourceV1 | null;
  capturedAtMs: number;
  snapshotHash: string;
}

interface DecodedMembershipV1 {
  playerId: string;
  runId: string;
  subjectId: string;
  roleId: string;
  roleKey: SeatIdV1;
  roleName: string;
}

interface DecodedPrivatePayloadV1 {
  situation: PressureGameViewerSourceV1["situation"];
  resources: Array<{ resourceId: string; value: number; displayValue: string }>;
  tokens: Array<{ tokenId: string; quantity: number; available: boolean }>;
}

interface DecodedDynamicChapterV1 {
  kind: "CHAPTER";
  chapter: ChapterOrchestratorStateV1;
  workingProjection: WorkingLedgerProjectionV1;
  chapterDescriptor: AuthoredChapterRuntimeV1;
  evidence: GameReadDynamicChapterEvidenceV1;
}

interface DecodedP0ChapterV1 {
  kind: "P0";
  chapterSource: PressureGameChapterSourceV1;
  evidence: GameReadP0ChapterEvidenceV1;
}

type DecodedChapterV1 = DecodedDynamicChapterV1 | DecodedP0ChapterV1;

interface DecodedWorldV1 {
  source: PressureGameWorldSourceV1;
  authority: GameReadWorldAuthorityV1;
}

interface DecodedFeedV1 {
  page: AEmotionFeedPagePortV1;
  authority: GameReadFeedAuthorityV1;
}

/**
 * Pure fail-closed decoder. It performs no query, no fallback and no final
 * PressureChapterGameProjectionV1 projection.
 */
export function decodeGameReadSnapshotV1(
  rawRows: readonly unknown[],
  requestValue: unknown,
): GameReadSnapshotV1 {
  const request = decodeRequest(requestValue);
  if (!Array.isArray(rawRows) || rawRows.length !== 1) {
    fail(
      GAME_READ_SNAPSHOT_ERROR_CODES.ROW_COUNT_INVALID,
      "rows",
      rawRows.length === 0 ? "MISSING_AGGREGATE_ROW" : "DUPLICATE_AGGREGATE_ROW",
    );
  }
  const raw = exactRecord(rawRows[0], [
    "schemaVersion",
    "routeRecord",
    "membershipRows",
    "seatAuthority",
    "viewerPrivateProjection",
    "viewerSource",
    "chapterAuthority",
    "worldAuthority",
    "narrativeAuthority",
    "feedAuthority",
    "capturedAtMs",
  ], "row");
  literal(
    raw.schemaVersion,
    PRESSURE_GAME_READ_SNAPSHOT_RAW_ROW_SCHEMA_V1,
    "row.schemaVersion",
  );

  const capturedAtMs = nonNegativeInteger(raw.capturedAtMs, "row.capturedAtMs");
  const storedRoute = decodeStoredRoute(raw.routeRecord, request);
  const routeSnapshot = decodeRouteSnapshot(storedRoute, request);
  const membership = decodeMembership(raw.membershipRows, request);
  const seat = decodeViewerSeatAuthority(
    raw.seatAuthority,
    routeSnapshot,
    membership,
    request,
  );
  const privateProjection = decodePrivateProjection(
    raw.viewerPrivateProjection,
    request,
    seat.snapshot,
    seat.viewerSeat,
  );
  const privatePayload = decodePrivatePayload(privateProjection.payload);
  const viewerSource = decodeViewerSource(
    raw.viewerSource,
    request,
    routeSnapshot,
    membership,
    seat.viewerSeat,
    privatePayload,
  );
  const chapter = decodeChapterAuthority(
    raw.chapterAuthority,
    request,
    routeSnapshot,
    viewerSource.viewer.seatId,
  );
  const world = decodeWorldAuthority(
    raw.worldAuthority,
    request,
    routeSnapshot,
    chapter,
  );
  const narrativeSource = decodeNarrativeAuthority(
    raw.narrativeAuthority,
    request,
    routeSnapshot,
    viewerSource.viewer.seatId,
    chapter,
  );
  const feed = decodeFeedAuthority(
    raw.feedAuthority,
    request,
    viewerSource.viewer.seatId,
  );

  const common = {
    roomId: request.roomId,
    runId: request.runId,
    subjectId: request.subjectId,
    feedCursor: request.feedCursor,
    feedLimit: request.feedLimit,
    routeSnapshot,
    viewerSeatId: viewerSource.viewer.seatId,
    viewerSource,
    worldSource: world.source,
    narrativeSource,
    feedPage: feed.page,
  };
  const sources: GameReadSnapshotResolvedSourcesV1 = chapter.kind === "CHAPTER"
    ? {
        ...common,
        chapter: chapter.chapter,
        workingProjection: chapter.workingProjection,
        chapterDescriptor: chapter.chapterDescriptor,
      }
    : {
        ...common,
        chapterSource: chapter.chapterSource,
      };
  const authority = {
    storedRouteRecordHash: storedRoute.recordHash,
    viewer: {
      runId: request.runId,
      routeHash: routeSnapshot.routeHash,
      participantMode: routeSnapshot.participantMode,
      seatAuthorityStateHash: seat.snapshot.stateHash,
      seatAuthorityRevision: seat.snapshot.stateRevision,
      seatAuthorityTimelineHeadHash: seat.snapshot.timelineHeadHash,
      seatId: seat.viewerSeat.seatId,
      mode: seat.viewerSeat.mode,
      controlEpoch: seat.viewerSeat.controlEpoch,
      submissionFenceToken: seat.viewerSeat.submissionFenceToken,
      reclaimFenceToken: seat.viewerSeat.reclaimFenceToken,
      privateProjectionVersion: privateProjection.projectionVersion,
      privateProjectionHash: privateProjection.payloadHash,
    },
    chapter: chapter.evidence,
    world: world.authority,
    feed: feed.authority,
    capabilityInputs: {
      viewerControl: structuredClone(viewerSource.viewer.control),
      chapterPhase: chapterPhase(chapter),
      decisionState: chapter.kind === "CHAPTER"
        ? structuredClone(chapter.evidence.decisionState)
        : null,
    },
  };
  const body = {
    schemaVersion: PRESSURE_GAME_READ_SNAPSHOT_SCHEMA_V1,
    request,
    sources,
    authority,
    resolvedChapterSummary: null,
    capturedAtMs,
  };
  const snapshot: GameReadSnapshotV1 = {
    ...body,
    snapshotHash: computeSnapshotHash(body),
  };
  makeWorkingProjectionReadOnly(snapshot);
  return deepFreeze(snapshot);
}

function decodeRequest(value: unknown): GameReadSnapshotRequestV1 {
  const record = exactRecord(value, [
    "schemaVersion", "roomId", "runId", "subjectId", "feedCursor", "feedLimit",
  ], "request");
  literal(
    record.schemaVersion,
    PRESSURE_GAME_READ_SNAPSHOT_REQUEST_SCHEMA_V1,
    "request.schemaVersion",
  );
  const roomId = text(record.roomId, "request.roomId");
  const runId = text(record.runId, "request.runId");
  const subjectId = text(record.subjectId, "request.subjectId");
  if (roomId !== runId) {
    fail(GAME_READ_SNAPSHOT_ERROR_CODES.SCOPE_MISMATCH, "request.roomId", "ROOM_RUN_MISMATCH");
  }
  return {
    schemaVersion: PRESSURE_GAME_READ_SNAPSHOT_REQUEST_SCHEMA_V1,
    roomId,
    runId,
    subjectId,
    feedCursor: nullableText(record.feedCursor, "request.feedCursor"),
    feedLimit: integerInRange(record.feedLimit, "request.feedLimit", 1, 10),
  };
}

function decodeStoredRoute(
  value: unknown,
  request: GameReadSnapshotRequestV1,
): StoredRunRouteRecordV1 {
  try {
    const stored = assertStoredRunRouteRecord(
      structuredClone(value) as StoredRunRouteRecordV1,
    );
    if (stored.runId !== request.runId) {
      fail(GAME_READ_SNAPSHOT_ERROR_CODES.SCOPE_MISMATCH, "row.routeRecord.runId", "RUN_MISMATCH");
    }
    return stored;
  } catch (error) {
    if (error instanceof GameReadSnapshotErrorV1) throw error;
    fail(GAME_READ_SNAPSHOT_ERROR_CODES.HASH_MISMATCH, "row.routeRecord", "STORED_ROUTE_REJECTED");
  }
}

function decodeRouteSnapshot(
  stored: StoredRunRouteRecordV1,
  request: GameReadSnapshotRequestV1,
): RunRouteSnapshotV1 {
  try {
    const route = validateRunRouteSnapshotV1(stored.snapshot);
    if (route.runId !== request.runId) {
      fail(GAME_READ_SNAPSHOT_ERROR_CODES.SCOPE_MISMATCH, "row.routeRecord.snapshot.runId", "RUN_MISMATCH");
    }
    return route;
  } catch (error) {
    if (error instanceof GameReadSnapshotErrorV1) throw error;
    fail(GAME_READ_SNAPSHOT_ERROR_CODES.HASH_MISMATCH, "row.routeRecord.snapshot", "ROUTE_SNAPSHOT_REJECTED");
  }
}

function decodeMembership(
  value: unknown,
  request: GameReadSnapshotRequestV1,
): DecodedMembershipV1 {
  if (!Array.isArray(value) || value.length !== 1) {
    fail(
      GAME_READ_SNAPSHOT_ERROR_CODES.ROW_COUNT_INVALID,
      "row.membershipRows",
      Array.isArray(value) && value.length > 1
        ? "DUPLICATE_VIEWER_MEMBERSHIP"
        : "MISSING_VIEWER_MEMBERSHIP",
    );
  }
  const row = exactRecord(value[0], [
    "playerId", "runId", "userId", "playerType", "status", "roleId",
    "roleRunId", "roleKey", "roleName",
  ], "row.membershipRows[0]");
  const roleKey = seatId(row.roleKey, "row.membershipRows[0].roleKey");
  if (
    row.runId !== request.runId
    || row.userId !== request.subjectId
    || row.playerType !== "human"
    || row.status !== "active"
    || row.roleRunId !== request.runId
  ) {
    fail(GAME_READ_SNAPSHOT_ERROR_CODES.SCOPE_MISMATCH, "row.membershipRows[0]", "VIEWER_MEMBERSHIP_MISMATCH");
  }
  return {
    playerId: text(row.playerId, "row.membershipRows[0].playerId"),
    runId: request.runId,
    subjectId: request.subjectId,
    roleId: text(row.roleId, "row.membershipRows[0].roleId"),
    roleKey,
    roleName: text(row.roleName, "row.membershipRows[0].roleName"),
  };
}

function decodeViewerSeatAuthority(
  value: unknown,
  route: RunRouteSnapshotV1,
  membership: DecodedMembershipV1,
  request: GameReadSnapshotRequestV1,
): { snapshot: SeatControlSnapshotV1; viewerSeat: SeatAuthorityRecordV1 } {
  const raw = exactRecord(value, [
    "runId", "stateRevision", "stateHash", "snapshotJson", "version",
  ], "row.seatAuthority");
  const snapshotJson = plainRecord(raw.snapshotJson, "row.seatAuthority.snapshotJson");
  if (snapshotJson.schemaVersion !== "pressure_seat_control_snapshot_v1") {
    fail(
      GAME_READ_SNAPSHOT_ERROR_CODES.FIELD_INVALID,
      "row.seatAuthority.snapshotJson.schemaVersion",
      "VIEWER_SCOPED_SNAPSHOT_REQUIRED",
    );
  }
  const row: PressureSeatSnapshotRowV1 = {
    runId: text(raw.runId, "row.seatAuthority.runId"),
    stateRevision: nonNegativeInteger(raw.stateRevision, "row.seatAuthority.stateRevision"),
    stateHash: hash(raw.stateHash, "row.seatAuthority.stateHash"),
    snapshotJson: structuredClone(snapshotJson),
    version: positiveInteger(raw.version, "row.seatAuthority.version"),
  };
  let snapshot: SeatControlSnapshotV1;
  try {
    snapshot = decodeSeatEnvelope(row).snapshot;
  } catch {
    fail(GAME_READ_SNAPSHOT_ERROR_CODES.HASH_MISMATCH, "row.seatAuthority", "SEAT_ENVELOPE_REJECTED");
  }
  const { stateHash: _stateHash, ...body } = snapshot;
  if (
    snapshot.runId !== request.runId
    || snapshot.routeHash !== route.routeHash
    || snapshot.participantMode !== route.participantMode
    || snapshot.initialTopologyHash !== route.initialRoleControlSnapshotHash
    || snapshot.controlTopologyVersion !== route.controlTopologyVersion
    || snapshot.stateHash !== sha256Canonical(body)
  ) {
    fail(GAME_READ_SNAPSHOT_ERROR_CODES.HASH_MISMATCH, "row.seatAuthority.snapshotJson", "SEAT_SNAPSHOT_BINDING_MISMATCH");
  }
  if (!Array.isArray(snapshot.seatControls)) {
    fail(GAME_READ_SNAPSHOT_ERROR_CODES.FIELD_INVALID, "row.seatAuthority.snapshotJson.seatControls", "ARRAY_REQUIRED");
  }
  const seen = new Set<SeatIdV1>();
  for (const [index, control] of snapshot.seatControls.entries()) {
    const id = seatId(control?.seatId, `row.seatAuthority.snapshotJson.seatControls[${index}].seatId`);
    if (seen.has(id)) {
      fail(GAME_READ_SNAPSHOT_ERROR_CODES.FIELD_INVALID, "row.seatAuthority.snapshotJson.seatControls", "DUPLICATE_SEAT");
    }
    seen.add(id);
  }
  if (seen.size !== PRESSURE_CHAPTER_SEAT_IDS_V1.length) {
    fail(GAME_READ_SNAPSHOT_ERROR_CODES.FIELD_INVALID, "row.seatAuthority.snapshotJson.seatControls", "EXACT_SIX_SEATS_REQUIRED");
  }
  const matches = snapshot.seatControls.filter((control) => (
    control.seatId === membership.roleKey
    && control.originalHumanControllerId === request.subjectId
  ));
  if (matches.length !== 1) {
    fail(GAME_READ_SNAPSHOT_ERROR_CODES.SCOPE_MISMATCH, "row.seatAuthority.snapshotJson.seatControls", "VIEWER_SEAT_NOT_UNIQUE");
  }
  const viewerSeat = matches[0]!;
  if (
    !Number.isSafeInteger(viewerSeat.controlEpoch)
    || viewerSeat.controlEpoch < 1
    || !isSha256(viewerSeat.submissionFenceToken)
    || (viewerSeat.reclaimFenceToken !== null && !isSha256(viewerSeat.reclaimFenceToken))
    || (viewerSeat.mode !== "HUMAN_ACTIVE" && viewerSeat.mode !== "AI_ACTIVE")
  ) {
    fail(GAME_READ_SNAPSHOT_ERROR_CODES.FENCE_MISMATCH, "row.seatAuthority.snapshotJson.seatControls", "VIEWER_CONTROL_INVALID");
  }
  return { snapshot: structuredClone(snapshot), viewerSeat: structuredClone(viewerSeat) };
}

function decodePrivateProjection(
  value: unknown,
  request: GameReadSnapshotRequestV1,
  snapshot: SeatControlSnapshotV1,
  viewerSeat: SeatAuthorityRecordV1,
): SeatPrivateProjectionRecordV1 {
  const row = exactRecord(value, [
    "schemaVersion", "runId", "seatId", "sourceAuthorityHash",
    "projectionVersion", "payload", "payloadHash",
  ], "row.viewerPrivateProjection");
  const payload = plainRecord(row.payload, "row.viewerPrivateProjection.payload");
  const payloadHash = hash(row.payloadHash, "row.viewerPrivateProjection.payloadHash");
  if (
    row.schemaVersion !== "pressure_seat_private_projection_record_v1"
    || row.runId !== request.runId
    || row.seatId !== viewerSeat.seatId
    || row.sourceAuthorityHash !== snapshot.stateHash
    || payloadHash !== sha256Canonical(payload)
  ) {
    fail(
      GAME_READ_SNAPSHOT_ERROR_CODES.PRIVATE_PROJECTION_INVALID,
      "row.viewerPrivateProjection",
      "PRIVATE_SCOPE_OR_HASH_MISMATCH",
    );
  }
  return {
    schemaVersion: "pressure_seat_private_projection_record_v1",
    runId: request.runId,
    seatId: viewerSeat.seatId,
    sourceAuthorityHash: snapshot.stateHash,
    projectionVersion: text(row.projectionVersion, "row.viewerPrivateProjection.projectionVersion"),
    payload: structuredClone(payload),
    payloadHash,
  };
}

function decodePrivatePayload(value: unknown): DecodedPrivatePayloadV1 {
  const row = exactRecord(value, ["schemaVersion", "situation", "resources", "tokens"], "row.viewerPrivateProjection.payload");
  literal(
    row.schemaVersion,
    "pressure_game_viewer_private_payload_v1",
    "row.viewerPrivateProjection.payload.schemaVersion",
  );
  const situation = decodeSituation(
    row.situation,
    "row.viewerPrivateProjection.payload.situation",
  );
  const resources = array(row.resources, "row.viewerPrivateProjection.payload.resources")
    .map((item, index) => {
      const path = `row.viewerPrivateProjection.payload.resources[${index}]`;
      const resource = exactRecord(item, ["resourceId", "value", "displayValue"], path);
      return {
        resourceId: text(resource.resourceId, `${path}.resourceId`),
        value: finiteNumber(resource.value, `${path}.value`),
        displayValue: text(resource.displayValue, `${path}.displayValue`),
      };
    });
  assertUnique(resources.map((item) => item.resourceId), "row.viewerPrivateProjection.payload.resources");
  const tokens = array(row.tokens, "row.viewerPrivateProjection.payload.tokens")
    .map((item, index) => {
      const path = `row.viewerPrivateProjection.payload.tokens[${index}]`;
      const token = exactRecord(item, ["tokenId", "quantity", "available"], path);
      return {
        tokenId: text(token.tokenId, `${path}.tokenId`),
        quantity: nonNegativeInteger(token.quantity, `${path}.quantity`),
        available: bool(token.available, `${path}.available`),
      };
    });
  assertUnique(tokens.map((item) => item.tokenId), "row.viewerPrivateProjection.payload.tokens");
  return { situation, resources, tokens };
}

function decodeViewerSource(
  value: unknown,
  request: GameReadSnapshotRequestV1,
  route: RunRouteSnapshotV1,
  membership: DecodedMembershipV1,
  viewerSeat: SeatAuthorityRecordV1,
  privatePayload: DecodedPrivatePayloadV1,
): PressureGameViewerSourceV1 {
  const row = exactRecord(value, [
    "roomId", "runId", "routeHash", "subjectId", "viewer",
    "situation", "resources", "tokens",
  ], "row.viewerSource");
  const viewer = exactRecord(row.viewer, ["seatId", "roleName", "control"], "row.viewerSource.viewer");
  const control = exactRecord(viewer.control, [
    "mode", "controlEpoch", "canSubmit", "canReclaim",
    "submissionFenceToken", "reclaimFenceToken",
  ], "row.viewerSource.viewer.control");
  const mode = enumeration(control.mode, ["HUMAN_ACTIVE", "AI_ACTIVE"] as const, "row.viewerSource.viewer.control.mode");
  const canSubmit = bool(control.canSubmit, "row.viewerSource.viewer.control.canSubmit");
  const canReclaim = bool(control.canReclaim, "row.viewerSource.viewer.control.canReclaim");
  const submissionFenceToken = nullableHash(control.submissionFenceToken, "row.viewerSource.viewer.control.submissionFenceToken");
  const reclaimFenceToken = nullableHash(control.reclaimFenceToken, "row.viewerSource.viewer.control.reclaimFenceToken");
  if (
    row.roomId !== request.roomId
    || row.runId !== request.runId
    || row.routeHash !== route.routeHash
    || row.subjectId !== request.subjectId
    || viewer.seatId !== membership.roleKey
    || viewer.seatId !== viewerSeat.seatId
    || viewer.roleName !== membership.roleName
    || mode !== viewerSeat.mode
    || control.controlEpoch !== viewerSeat.controlEpoch
    || submissionFenceToken !== (canSubmit ? viewerSeat.submissionFenceToken : null)
    || reclaimFenceToken !== (canReclaim ? viewerSeat.reclaimFenceToken : null)
  ) {
    fail(GAME_READ_SNAPSHOT_ERROR_CODES.FENCE_MISMATCH, "row.viewerSource", "VIEWER_AUTHORITY_MISMATCH");
  }
  const situation = decodeSituation(row.situation, "row.viewerSource.situation");
  const resources = decodeViewerResources(row.resources);
  const tokens = decodeViewerTokens(row.tokens);
  assertPrivateResourceMatch(resources, privatePayload.resources);
  assertPrivateTokenMatch(tokens, privatePayload.tokens);
  if (sha256Canonical(situation) !== sha256Canonical(privatePayload.situation)) {
    fail(GAME_READ_SNAPSHOT_ERROR_CODES.PRIVATE_PROJECTION_INVALID, "row.viewerSource.situation", "PRIVATE_SITUATION_MISMATCH");
  }
  return {
    roomId: request.roomId,
    runId: request.runId,
    routeHash: route.routeHash,
    subjectId: request.subjectId,
    viewer: {
      seatId: viewerSeat.seatId,
      roleName: membership.roleName,
      control: {
        mode,
        controlEpoch: positiveInteger(control.controlEpoch, "row.viewerSource.viewer.control.controlEpoch"),
        canSubmit,
        canReclaim,
        submissionFenceToken,
        reclaimFenceToken,
      },
    },
    situation,
    resources,
    tokens,
  };
}

function decodeChapterAuthority(
  value: unknown,
  request: GameReadSnapshotRequestV1,
  route: RunRouteSnapshotV1,
  viewerSeatId: SeatIdV1,
): DecodedChapterV1 {
  const root = plainRecord(value, "row.chapterAuthority");
  if (root.kind === "P0") {
    exactKeys(root, ["kind", "chapterSource"], "row.chapterAuthority");
    const chapterSource = decodeP0ChapterSource(
      root.chapterSource,
      request,
      route,
      viewerSeatId,
    );
    return {
      kind: "P0",
      chapterSource,
      evidence: {
        kind: "P0",
        chapterRuntimeId: chapterSource.chapter.chapterRuntimeId,
      },
    };
  }
  exactKeys(root, ["kind", "orchestrator", "runtime", "descriptor"], "row.chapterAuthority");
  if (root.kind !== "CHAPTER") {
    fail(GAME_READ_SNAPSHOT_ERROR_CODES.FIELD_INVALID, "row.chapterAuthority.kind", "P0_OR_CHAPTER_REQUIRED");
  }
  const historyRow = exactRecord(root.orchestrator, [
    "count", "minRevision", "maxRevision", "distinctRevisionCount", "latestState",
  ], "row.chapterAuthority.orchestrator");
  let chapter: ChapterOrchestratorStateV1;
  try {
    chapter = validateOrchestratorStateV1(
      structuredClone(historyRow.latestState) as ChapterOrchestratorStateV1,
    );
  } catch {
    fail(GAME_READ_SNAPSHOT_ERROR_CODES.CHAPTER_AUTHORITY_INVALID, "row.chapterAuthority.orchestrator.latestState", "ORCHESTRATOR_REJECTED");
  }
  const history: GameReadOrchestratorHistoryV1 = {
    count: positiveInteger(historyRow.count, "row.chapterAuthority.orchestrator.count"),
    minRevision: nonNegativeInteger(historyRow.minRevision, "row.chapterAuthority.orchestrator.minRevision"),
    maxRevision: nonNegativeInteger(historyRow.maxRevision, "row.chapterAuthority.orchestrator.maxRevision"),
    distinctRevisionCount: positiveInteger(
      historyRow.distinctRevisionCount,
      "row.chapterAuthority.orchestrator.distinctRevisionCount",
    ),
  };
  if (
    history.minRevision !== 0
    || history.maxRevision !== chapter.revision
    || history.distinctRevisionCount !== history.count
    || history.count !== history.maxRevision + 1
  ) {
    fail(GAME_READ_SNAPSHOT_ERROR_CODES.REVISION_MISMATCH, "row.chapterAuthority.orchestrator", "REVISION_HISTORY_NOT_CONTIGUOUS");
  }
  const runtime = decodeRuntime(root.runtime);
  let descriptor: AuthoredChapterRuntimeV1;
  try {
    descriptor = validateAuthoredChapterRuntimeV1(
      structuredClone(root.descriptor) as AuthoredChapterRuntimeV1,
    );
  } catch {
    fail(GAME_READ_SNAPSHOT_ERROR_CODES.CHAPTER_AUTHORITY_INVALID, "row.chapterAuthority.descriptor", "DESCRIPTOR_REJECTED");
  }
  if (
    chapter.runId !== request.runId
    || chapter.routeHash !== route.routeHash
    || chapter.chapterRuntimeId !== runtime.id
    || chapter.currentChapterId !== runtime.chapterId
    || chapter.descriptorHash !== descriptor.descriptorHash
    || descriptor.chapterId !== runtime.chapterId
    || chapter.authorityBase.baseWorldSequence !== runtime.baseWorldSequence
    || chapter.authorityBase.baseWorldStateHash !== runtime.baseWorldStateHash
    || chapter.authorityBase.previousFrozenHash !== runtime.previousFrozenHash
    || runtime.runId !== request.runId
    || runtime.routeHash !== route.routeHash
    || runtime.chapterSequence !== Number(runtime.chapterId.slice(1))
    || runtime.contentPackageVersion !== route.contentPackageVersion
    || runtime.contentHash !== route.contentPackageSha256
    || runtime.orchestrationPackageVersion !== route.orchestrationPackageVersion
    || runtime.orchestrationHash !== route.orchestrationPackageSha256
    || runtime.runtimeContractVersion !== route.runtimeContractVersion
    || runtime.runtimeContractHash !== route.runtimeContractSha256
  ) {
    fail(GAME_READ_SNAPSHOT_ERROR_CODES.SCOPE_MISMATCH, "row.chapterAuthority", "CHAPTER_RUNTIME_ROUTE_BINDING_MISMATCH");
  }
  const cacheRecord = plainRecord(
    runtime.ledgerProjectionJson,
    "row.chapterAuthority.runtime.ledgerProjectionJson",
  );
  const workingProjectionCacheHash = hash(
    cacheRecord.projectionCacheHash,
    "row.chapterAuthority.runtime.ledgerProjectionJson.projectionCacheHash",
  );
  let workingProjection: WorkingLedgerProjectionV1;
  try {
    workingProjection = decodeWorkingLedgerProjectionCacheV1(
      runtime.ledgerProjectionJson,
      {
        runId: request.runId,
        chapterRuntimeId: runtime.id,
        chapterId: runtime.chapterId,
        routeHash: route.routeHash,
        workingRevision: runtime.workingRevision,
        workingState: runtime.workingStateJson,
        workingStateHash: runtime.workingStateHash,
      },
    );
  } catch {
    fail(GAME_READ_SNAPSHOT_ERROR_CODES.CHAPTER_AUTHORITY_INVALID, "row.chapterAuthority.runtime.ledgerProjectionJson", "WORKING_CACHE_REJECTED");
  }
  if (
    workingProjection.chapterDefinitionHash !== sha256Canonical(descriptor.definition)
    || workingProjection.state.revision !== runtime.workingRevision
    || workingProjection.stateHash !== runtime.workingStateHash
    || workingProjection.headSequence !== runtime.ledgerHeadSequence
    || workingProjection.headHash !== runtime.ledgerHeadHash
  ) {
    fail(GAME_READ_SNAPSHOT_ERROR_CODES.HASH_MISMATCH, "row.chapterAuthority.runtime", "WORKING_DESCRIPTOR_BINDING_MISMATCH");
  }
  let decisionState: PressureMvpDecisionStateV1;
  try {
    decisionState = decodePressureMvpDecisionStateV1(runtime.decisionStateJson);
  } catch {
    fail(GAME_READ_SNAPSHOT_ERROR_CODES.DECISION_STATE_INVALID, "row.chapterAuthority.runtime.decisionStateJson", "DECODER_REJECTED");
  }
  assertDecisionStateBindings(decisionState, chapter, workingProjection, runtime);
  return {
    kind: "CHAPTER",
    chapter,
    workingProjection,
    chapterDescriptor: descriptor,
    evidence: {
      kind: "CHAPTER",
      runtime: {
        id: runtime.id,
        runId: runtime.runId,
        chapterId: runtime.chapterId,
        chapterSequence: runtime.chapterSequence,
        state: runtime.state,
        routeHash: runtime.routeHash,
        baseWorldSequence: runtime.baseWorldSequence,
        baseWorldStateHash: runtime.baseWorldStateHash,
        previousFrozenHash: runtime.previousFrozenHash,
        workingRevision: runtime.workingRevision,
        workingStateHash: runtime.workingStateHash,
        ledgerHeadSequence: runtime.ledgerHeadSequence,
        ledgerHeadHash: runtime.ledgerHeadHash,
        lockVersion: runtime.lockVersion,
      },
      orchestratorHistory: history,
      decisionState,
      workingProjectionCacheHash,
    },
  };
}

interface DecodedRuntimeV1 {
  id: string;
  runId: string;
  chapterId: ChapterIdV1;
  chapterSequence: number;
  state: string;
  routeHash: string;
  baseWorldSequence: number;
  baseWorldStateHash: string;
  previousFrozenHash: string;
  contentPackageVersion: string;
  contentHash: string;
  orchestrationPackageVersion: string;
  orchestrationHash: string;
  runtimeContractVersion: string;
  runtimeContractHash: string;
  workingRevision: number;
  workingStateJson: unknown;
  workingStateHash: string;
  ledgerHeadSequence: number;
  ledgerHeadHash: string;
  decisionStateJson: unknown;
  ledgerProjectionJson: unknown;
  lockVersion: number;
}

function decodeRuntime(value: unknown): DecodedRuntimeV1 {
  const row = exactRecord(value, [
    "id", "runId", "chapterId", "chapterSequence", "state", "routeHash",
    "baseWorldSequence", "baseWorldStateHash", "previousFrozenHash",
    "contentPackageVersion", "contentHash", "orchestrationPackageVersion",
    "orchestrationHash", "runtimeContractVersion", "runtimeContractHash",
    "workingRevision", "workingStateJson", "workingStateHash",
    "ledgerHeadSequence", "ledgerHeadHash",
    "decisionStateJson", "ledgerProjectionJson", "lockVersion",
  ], "row.chapterAuthority.runtime");
  const chapterId = chapterIdV1(row.chapterId, "row.chapterAuthority.runtime.chapterId");
  return {
    id: text(row.id, "row.chapterAuthority.runtime.id"),
    runId: text(row.runId, "row.chapterAuthority.runtime.runId"),
    chapterId,
    chapterSequence: positiveInteger(row.chapterSequence, "row.chapterAuthority.runtime.chapterSequence"),
    state: text(row.state, "row.chapterAuthority.runtime.state"),
    routeHash: hash(row.routeHash, "row.chapterAuthority.runtime.routeHash"),
    baseWorldSequence: nonNegativeInteger(row.baseWorldSequence, "row.chapterAuthority.runtime.baseWorldSequence"),
    baseWorldStateHash: hash(row.baseWorldStateHash, "row.chapterAuthority.runtime.baseWorldStateHash"),
    previousFrozenHash: hash(row.previousFrozenHash, "row.chapterAuthority.runtime.previousFrozenHash"),
    contentPackageVersion: text(row.contentPackageVersion, "row.chapterAuthority.runtime.contentPackageVersion"),
    contentHash: hash(row.contentHash, "row.chapterAuthority.runtime.contentHash"),
    orchestrationPackageVersion: text(row.orchestrationPackageVersion, "row.chapterAuthority.runtime.orchestrationPackageVersion"),
    orchestrationHash: hash(row.orchestrationHash, "row.chapterAuthority.runtime.orchestrationHash"),
    runtimeContractVersion: text(row.runtimeContractVersion, "row.chapterAuthority.runtime.runtimeContractVersion"),
    runtimeContractHash: hash(row.runtimeContractHash, "row.chapterAuthority.runtime.runtimeContractHash"),
    workingRevision: nonNegativeInteger(row.workingRevision, "row.chapterAuthority.runtime.workingRevision"),
    workingStateJson: structuredClone(row.workingStateJson),
    workingStateHash: hash(row.workingStateHash, "row.chapterAuthority.runtime.workingStateHash"),
    ledgerHeadSequence: nonNegativeInteger(
      row.ledgerHeadSequence,
      "row.chapterAuthority.runtime.ledgerHeadSequence",
    ),
    ledgerHeadHash: hash(
      row.ledgerHeadHash,
      "row.chapterAuthority.runtime.ledgerHeadHash",
    ),
    decisionStateJson: structuredClone(row.decisionStateJson),
    ledgerProjectionJson: structuredClone(row.ledgerProjectionJson),
    lockVersion: nonNegativeInteger(row.lockVersion, "row.chapterAuthority.runtime.lockVersion"),
  };
}

function assertDecisionStateBindings(
  decisionState: PressureMvpDecisionStateV1,
  chapter: ChapterOrchestratorStateV1,
  projection: WorkingLedgerProjectionV1,
  runtime: DecodedRuntimeV1,
): void {
  if (
    decisionState.workingRevision !== runtime.workingRevision
    || decisionState.workingRevision !== projection.state.revision
  ) {
    fail(GAME_READ_SNAPSHOT_ERROR_CODES.REVISION_MISMATCH, "row.chapterAuthority.runtime.decisionStateJson.workingRevision", "WORKING_REVISION_MISMATCH");
  }
  const active = chapter.activeDecision;
  if (!active) {
    if (decisionState.state !== "NONE" || projection.nextDecisionPin !== null) {
      fail(GAME_READ_SNAPSHOT_ERROR_CODES.DECISION_STATE_INVALID, "row.chapterAuthority.runtime.decisionStateJson", "CLOSED_DECISION_BINDING_MISMATCH");
    }
    return;
  }
  const requiredSeatIds = PRESSURE_CHAPTER_SEAT_IDS_V1.filter((seatIdValue) =>
    active.seats.some((seat) => seat.seatId === seatIdValue && seat.requirement === "REQUIRED"));
  if (
    decisionState.state !== "OPEN"
    || decisionState.activeDecisionPointId !== active.decisionPointId
    || decisionState.pin?.decisionPointId !== active.decisionPointId
    || projection.nextDecisionPin?.decisionPointId !== active.decisionPointId
    || sha256Canonical(decisionState.pin) !== sha256Canonical(projection.nextDecisionPin)
    || decisionState.policyHash !== active.policyHash
    || decisionState.orchestratorHash !== chapter.orchestratorHash
    || sha256Canonical(decisionState.requiredSeatIds) !== sha256Canonical(requiredSeatIds)
  ) {
    fail(GAME_READ_SNAPSHOT_ERROR_CODES.DECISION_STATE_INVALID, "row.chapterAuthority.runtime.decisionStateJson", "ACTIVE_DECISION_BINDING_MISMATCH");
  }
}

function decodeP0ChapterSource(
  value: unknown,
  request: GameReadSnapshotRequestV1,
  route: RunRouteSnapshotV1,
  viewerSeatId: SeatIdV1,
): PressureGameChapterSourceV1 {
  const row = exactRecord(value, [
    "runId", "routeHash", "viewerSeatId", "projectionVersion", "chapter", "decision",
  ], "row.chapterAuthority.chapterSource");
  const chapter = exactRecord(row.chapter, [
    "chapterRuntimeId", "chapterId", "chapterNumber", "title", "phase", "workingRevision",
  ], "row.chapterAuthority.chapterSource.chapter");
  if (
    row.runId !== request.runId
    || row.routeHash !== route.routeHash
    || row.viewerSeatId !== viewerSeatId
    || chapter.chapterId !== "P0"
    || chapter.chapterNumber !== 0
    || chapter.workingRevision !== 0
    || row.decision !== null
  ) {
    fail(GAME_READ_SNAPSHOT_ERROR_CODES.SCOPE_MISMATCH, "row.chapterAuthority.chapterSource", "P0_BINDING_MISMATCH");
  }
  return {
    runId: request.runId,
    routeHash: route.routeHash,
    viewerSeatId,
    projectionVersion: positiveInteger(row.projectionVersion, "row.chapterAuthority.chapterSource.projectionVersion"),
    chapter: {
      chapterRuntimeId: text(chapter.chapterRuntimeId, "row.chapterAuthority.chapterSource.chapter.chapterRuntimeId"),
      chapterId: "P0",
      chapterNumber: 0,
      title: text(chapter.title, "row.chapterAuthority.chapterSource.chapter.title"),
      phase: enumeration(
        chapter.phase,
        ["ACTIVE", "RESOLVING_BEAT", "SETTLING", "FROZEN", "FINALE_REQUESTED"] as const,
        "row.chapterAuthority.chapterSource.chapter.phase",
      ),
      workingRevision: 0,
    },
    decision: null,
  };
}

function decodeWorldAuthority(
  value: unknown,
  request: GameReadSnapshotRequestV1,
  route: RunRouteSnapshotV1,
  chapter: DecodedChapterV1,
): DecodedWorldV1 {
  const row = exactRecord(value, [
    "runId", "version", "currentNodeId", "worldSequence",
    "reservedWorldSequence", "stateJson", "source",
  ], "row.worldAuthority");
  let worldState;
  try {
    worldState = validateWorldStateV1(row.stateJson);
  } catch {
    fail(GAME_READ_SNAPSHOT_ERROR_CODES.HASH_MISMATCH, "row.worldAuthority.stateJson", "WORLD_STATE_REJECTED");
  }
  const source = decodeWorldSource(row.source, request, route);
  const worldSequence = nonNegativeInteger(row.worldSequence, "row.worldAuthority.worldSequence");
  const reservedWorldSequence = nonNegativeInteger(
    row.reservedWorldSequence,
    "row.worldAuthority.reservedWorldSequence",
  );
  if (
    row.runId !== request.runId
    || worldState.worldSequence !== worldSequence
    || source.worldSequence !== worldSequence
    || source.worldStateHash !== worldState.stateHash
    || (chapter.kind === "CHAPTER" && (
      chapter.evidence.runtime.baseWorldSequence !== worldSequence
      || chapter.evidence.runtime.baseWorldStateHash !== worldState.stateHash
    ))
  ) {
    fail(GAME_READ_SNAPSHOT_ERROR_CODES.SCOPE_MISMATCH, "row.worldAuthority", "WORLD_CHAPTER_BINDING_MISMATCH");
  }
  return {
    source,
    authority: {
      runId: request.runId,
      version: positiveInteger(row.version, "row.worldAuthority.version"),
      currentNodeId: nullableText(row.currentNodeId, "row.worldAuthority.currentNodeId"),
      worldSequence,
      reservedWorldSequence,
      worldStateHash: worldState.stateHash,
    },
  };
}

function decodeWorldSource(
  value: unknown,
  request: GameReadSnapshotRequestV1,
  route: RunRouteSnapshotV1,
): PressureGameWorldSourceV1 {
  const row = exactRecord(value, [
    "runId", "routeHash", "worldSequence", "worldStateHash", "metrics",
  ], "row.worldAuthority.source");
  if (row.runId !== request.runId || row.routeHash !== route.routeHash) {
    fail(GAME_READ_SNAPSHOT_ERROR_CODES.SCOPE_MISMATCH, "row.worldAuthority.source", "WORLD_SOURCE_SCOPE_MISMATCH");
  }
  const metrics = array(row.metrics, "row.worldAuthority.source.metrics")
    .map((item, index) => {
      const path = `row.worldAuthority.source.metrics[${index}]`;
      const metric = exactRecord(item, ["trackId", "label", "value", "displayValue", "tone"], path);
      return {
        trackId: enumeration(metric.trackId, TRACK_IDS_V1, `${path}.trackId`),
        label: text(metric.label, `${path}.label`),
        value: finiteNumber(metric.value, `${path}.value`),
        displayValue: text(metric.displayValue, `${path}.displayValue`),
        tone: enumeration(metric.tone, ["DEFAULT", "GOOD", "WARN", "DANGER"] as const, `${path}.tone`),
      };
    });
  assertUnique(
    metrics.map((metric) => metric.trackId),
    "row.worldAuthority.source.metrics.trackId",
  );
  const observedTrackIds = new Set(metrics.map((metric) => metric.trackId));
  if (
    metrics.length !== TRACK_IDS_V1.length
    || TRACK_IDS_V1.some((trackIdValue) => !observedTrackIds.has(trackIdValue))
  ) {
    fail(
      GAME_READ_SNAPSHOT_ERROR_CODES.FIELD_INVALID,
      "row.worldAuthority.source.metrics",
      "EXACT_TRACK_SET_REQUIRED",
    );
  }
  return {
    runId: request.runId,
    routeHash: route.routeHash,
    worldSequence: nonNegativeInteger(row.worldSequence, "row.worldAuthority.source.worldSequence"),
    worldStateHash: hash(row.worldStateHash, "row.worldAuthority.source.worldStateHash"),
    metrics,
  };
}

function decodeNarrativeAuthority(
  value: unknown,
  request: GameReadSnapshotRequestV1,
  route: RunRouteSnapshotV1,
  viewerSeatId: SeatIdV1,
  chapter: DecodedChapterV1,
): PressureGameNarrativeSourceV1 {
  const row = exactRecord(value, [
    "source", "sourceContentHash", "narrativeProfileVersion",
    "projectorVersion", "artifactJson",
  ], "row.narrativeAuthority");
  const sourceRow = exactRecord(row.source, [
    "runId", "routeHash", "viewerSeatId", "chapterRuntimeId", "status",
    "projectionKind", "sourceAuthority", "sourceId", "sourceCommitHash",
    "text", "contentHash", "renderMode",
  ], "row.narrativeAuthority.source");
  const chapterRuntimeId = chapter.kind === "CHAPTER"
    ? chapter.chapter.chapterRuntimeId
    : chapter.chapterSource.chapter.chapterRuntimeId;
  const source: PressureGameNarrativeSourceV1 = {
    runId: text(sourceRow.runId, "row.narrativeAuthority.source.runId"),
    routeHash: hash(sourceRow.routeHash, "row.narrativeAuthority.source.routeHash"),
    viewerSeatId: seatId(
      sourceRow.viewerSeatId,
      "row.narrativeAuthority.source.viewerSeatId",
    ),
    chapterRuntimeId: text(
      sourceRow.chapterRuntimeId,
      "row.narrativeAuthority.source.chapterRuntimeId",
    ),
    status: enumeration(
      sourceRow.status,
      NARRATIVE_STATUSES_V1,
      "row.narrativeAuthority.source.status",
    ),
    projectionKind: enumeration(
      sourceRow.projectionKind,
      ["GENESIS_NARRATIVE", "BEAT_NARRATIVE", "CHAPTER_NARRATIVE"] as const,
      "row.narrativeAuthority.source.projectionKind",
    ),
    sourceAuthority: enumeration(
      sourceRow.sourceAuthority,
      ["GENESIS_FROZEN", "CHAPTER_WORKING", "CHAPTER_FROZEN"] as const,
      "row.narrativeAuthority.source.sourceAuthority",
    ),
    sourceId: text(sourceRow.sourceId, "row.narrativeAuthority.source.sourceId"),
    sourceCommitHash: hash(
      sourceRow.sourceCommitHash,
      "row.narrativeAuthority.source.sourceCommitHash",
    ),
    text: nullableText(sourceRow.text, "row.narrativeAuthority.source.text"),
    contentHash: nullableHash(
      sourceRow.contentHash,
      "row.narrativeAuthority.source.contentHash",
    ),
    renderMode: sourceRow.renderMode === null
      ? null
      : enumeration(
          sourceRow.renderMode,
          ["PROVIDER", "AUTHORED_FALLBACK"] as const,
          "row.narrativeAuthority.source.renderMode",
        ),
  };
  if (
    source.runId !== request.runId
    || source.routeHash !== route.routeHash
    || source.viewerSeatId !== viewerSeatId
    || source.chapterRuntimeId !== chapterRuntimeId
  ) {
    fail(
      GAME_READ_SNAPSHOT_ERROR_CODES.NARRATIVE_INVALID,
      "row.narrativeAuthority.source",
      "NARRATIVE_SCOPE_MISMATCH",
    );
  }

  const narrativeProfileVersion = text(
    row.narrativeProfileVersion,
    "row.narrativeAuthority.narrativeProfileVersion",
  );
  if (narrativeProfileVersion !== route.narrativeProfileVersion) {
    fail(
      GAME_READ_SNAPSHOT_ERROR_CODES.NARRATIVE_INVALID,
      "row.narrativeAuthority.narrativeProfileVersion",
      "ROUTE_PROFILE_MISMATCH",
    );
  }
  const sourceContentHash = hash(
    row.sourceContentHash,
    "row.narrativeAuthority.sourceContentHash",
  );
  const projectorVersion = text(
    row.projectorVersion,
    "row.narrativeAuthority.projectorVersion",
  );

  // The existing artifact validator remains the only authority for artifact
  // shape/content hashing. M1 only binds that result to this viewer snapshot.
  if (row.artifactJson !== null) {
    let artifact;
    try {
      artifact = validateOpenNovelNarrativeArtifactV1(row.artifactJson);
    } catch {
      fail(
        GAME_READ_SNAPSHOT_ERROR_CODES.NARRATIVE_INVALID,
        "row.narrativeAuthority.artifactJson",
        "ARTIFACT_REJECTED",
      );
    }
    if (
      artifact.runId !== request.runId
      || artifact.projectionKind !== source.projectionKind
      || artifact.sourceId !== source.sourceId
      || artifact.sourceCommitHash !== source.sourceCommitHash
      || artifact.sourceContentHash !== sourceContentHash
      || artifact.audience.kind !== "SEAT"
      || artifact.audience.seatId !== viewerSeatId
      || artifact.narrativeProfileVersion !== narrativeProfileVersion
      || artifact.projectorVersion !== projectorVersion
      || artifact.status !== source.status
      || artifact.text !== source.text
      || artifact.contentHash !== source.contentHash
      || artifact.renderMode !== source.renderMode
    ) {
      fail(
        GAME_READ_SNAPSHOT_ERROR_CODES.NARRATIVE_INVALID,
        "row.narrativeAuthority",
        "ARTIFACT_SOURCE_BINDING_MISMATCH",
      );
    }
  }
  return structuredClone(source);
}

function decodeFeedAuthority(
  value: unknown,
  request: GameReadSnapshotRequestV1,
  viewerSeatId: SeatIdV1,
): DecodedFeedV1 {
  const root = exactRecord(value, [
    "schemaVersion", "roomId", "runId", "viewerSeatId", "rows",
  ], "row.feedAuthority");
  literal(
    root.schemaVersion,
    "pressure_game_read_feed_authority_v1",
    "row.feedAuthority.schemaVersion",
  );
  if (
    root.roomId !== request.roomId
    || root.runId !== request.runId
    || root.viewerSeatId !== viewerSeatId
  ) {
    fail(GAME_READ_SNAPSHOT_ERROR_CODES.FEED_INVALID, "row.feedAuthority", "FEED_SCOPE_MISMATCH");
  }
  const rows = array(root.rows, "row.feedAuthority.rows")
    .map((item, index) => decodeFeedRow(item, index, request, viewerSeatId));
  assertUnique(
    rows.map((item) => item.aggregate.aggregationKey),
    "row.feedAuthority.rows.aggregationKey",
  );
  assertUnique(
    rows.map((item) => `${item.aggregate.projection.eventId}:${item.aggregate.projection.projectionVersion}`),
    "row.feedAuthority.rows.eventProjection",
  );
  let page: AEmotionFeedPagePortV1;
  try {
    page = projectAEmotionFeedPageV1(
      {
        roomId: request.roomId,
        runId: request.runId,
        viewerSeatId,
        cursor: request.feedCursor,
        limit: request.feedLimit,
      },
      rows,
    );
  } catch {
    fail(GAME_READ_SNAPSHOT_ERROR_CODES.FEED_INVALID, "row.feedAuthority", "FEED_PROJECTOR_REJECTED");
  }
  const identities = rows.map(({ aggregate, delivery }) => ({
    aggregationKey: aggregate.aggregationKey,
    eventId: aggregate.projection.eventId,
    projectionVersion: aggregate.projection.projectionVersion,
    projectionHash: aggregate.projection.projectionHash,
    deliveredAt: delivery.deliveredAt,
    seenAt: delivery.seenAt,
    acknowledgedAt: delivery.acknowledgedAt,
    resolvedAt: delivery.resolvedAt,
    keyModalShownAt: delivery.keyModalShownAt,
  })).sort((left, right) => compareText(left.aggregationKey, right.aggregationKey));
  return {
    page,
    authority: {
      rowCount: rows.length,
      sourceIdentityHash: sha256Canonical(identities),
    },
  };
}

function decodeFeedRow(
  value: unknown,
  index: number,
  request: GameReadSnapshotRequestV1,
  viewerSeatId: SeatIdV1,
): { aggregate: AEmotionAggregateRecordV1; delivery: AEmotionDeliveryRecordV1 } {
  const path = `row.feedAuthority.rows[${index}]`;
  const row = exactRecord(value, ["aggregate", "delivery"], path);
  const aggregateRow = exactRecord(row.aggregate, [
    "aggregationKey", "roomId", "runId", "viewerSeatId", "stageId",
    "sharedObjectId", "eventFamily", "latestEventId", "projectionVersion",
    "projection", "createdAt", "updatedAt",
  ], `${path}.aggregate`);
  let projection;
  try {
    projection = validateAEmotionViewerProjectionV1(
      aggregateRow.projection,
      `${path}.aggregate.projection`,
    );
  } catch {
    fail(GAME_READ_SNAPSHOT_ERROR_CODES.FEED_INVALID, `${path}.aggregate.projection`, "VIEWER_PROJECTION_REJECTED");
  }
  const aggregationKey = text(
    aggregateRow.aggregationKey,
    `${path}.aggregate.aggregationKey`,
  );
  const parsedKey = parseAEmotionAggregationKeyV1(aggregationKey);
  if (
    aggregateRow.roomId !== request.roomId
    || aggregateRow.runId !== request.runId
    || aggregateRow.viewerSeatId !== viewerSeatId
    || aggregateRow.latestEventId !== projection.eventId
    || aggregateRow.projectionVersion !== projection.projectionVersion
    || projection.roomId !== request.roomId
    || projection.runId !== request.runId
    || projection.viewerSeatId !== viewerSeatId
    || !parsedKey
    || parsedKey.roomId !== request.roomId
    || parsedKey.runId !== request.runId
    || parsedKey.viewerSeatId !== viewerSeatId
    || (
      projection.projectionVersion === A_EMOTION_PROJECTION_VERSION_V1
      && parsedKey.rootEventId !== projection.eventId
    )
  ) {
    fail(GAME_READ_SNAPSHOT_ERROR_CODES.FEED_INVALID, `${path}.aggregate`, "AGGREGATE_SCOPE_MISMATCH");
  }
  const aggregate: AEmotionAggregateRecordV1 = {
    aggregationKey,
    roomId: request.roomId,
    runId: request.runId,
    viewerSeatId,
    stageId: text(aggregateRow.stageId, `${path}.aggregate.stageId`),
    sharedObjectId: nullableText(aggregateRow.sharedObjectId, `${path}.aggregate.sharedObjectId`),
    eventFamily: text(aggregateRow.eventFamily, `${path}.aggregate.eventFamily`),
    latestEventId: projection.eventId,
    projectionVersion: positiveInteger(
      aggregateRow.projectionVersion,
      `${path}.aggregate.projectionVersion`,
    ),
    projection,
    createdAt: timestamp(aggregateRow.createdAt, `${path}.aggregate.createdAt`),
    updatedAt: timestamp(aggregateRow.updatedAt, `${path}.aggregate.updatedAt`),
  };
  const deliveryRow = exactRecord(row.delivery, [
    "eventId", "projectionVersion", "roomId", "runId", "viewerSeatId",
    "deliveredAt", "seenAt", "acknowledgedAt", "resolvedAt", "keyModalShownAt",
  ], `${path}.delivery`);
  if (
    deliveryRow.eventId !== projection.eventId
    || deliveryRow.projectionVersion !== projection.projectionVersion
    || deliveryRow.roomId !== request.roomId
    || deliveryRow.runId !== request.runId
    || deliveryRow.viewerSeatId !== viewerSeatId
  ) {
    fail(GAME_READ_SNAPSHOT_ERROR_CODES.FEED_INVALID, `${path}.delivery`, "DELIVERY_SCOPE_MISMATCH");
  }
  const delivery: AEmotionDeliveryRecordV1 = {
    eventId: projection.eventId,
    projectionVersion: projection.projectionVersion,
    roomId: request.roomId,
    runId: request.runId,
    viewerSeatId,
    deliveredAt: timestamp(deliveryRow.deliveredAt, `${path}.delivery.deliveredAt`),
    seenAt: nullableTimestamp(deliveryRow.seenAt, `${path}.delivery.seenAt`),
    acknowledgedAt: nullableTimestamp(
      deliveryRow.acknowledgedAt,
      `${path}.delivery.acknowledgedAt`,
    ),
    resolvedAt: nullableTimestamp(deliveryRow.resolvedAt, `${path}.delivery.resolvedAt`),
    keyModalShownAt: nullableTimestamp(
      deliveryRow.keyModalShownAt,
      `${path}.delivery.keyModalShownAt`,
    ),
  };
  return { aggregate, delivery };
}

function decodeViewerResources(value: unknown): PressureGameViewerSourceV1["resources"] {
  return array(value, "row.viewerSource.resources").map((item, index) => {
    const path = `row.viewerSource.resources[${index}]`;
    const row = exactRecord(item, ["resourceId", "label", "value", "displayValue"], path);
    return {
      resourceId: text(row.resourceId, `${path}.resourceId`),
      label: text(row.label, `${path}.label`),
      value: finiteNumber(row.value, `${path}.value`),
      displayValue: text(row.displayValue, `${path}.displayValue`),
    };
  });
}

function decodeViewerTokens(value: unknown): PressureGameViewerSourceV1["tokens"] {
  return array(value, "row.viewerSource.tokens").map((item, index) => {
    const path = `row.viewerSource.tokens[${index}]`;
    const row = exactRecord(item, [
      "tokenId", "label", "description", "quantity", "available",
    ], path);
    return {
      tokenId: text(row.tokenId, `${path}.tokenId`),
      label: text(row.label, `${path}.label`),
      description: text(row.description, `${path}.description`),
      quantity: nonNegativeInteger(row.quantity, `${path}.quantity`),
      available: bool(row.available, `${path}.available`),
    };
  });
}

function assertPrivateResourceMatch(
  viewer: PressureGameViewerSourceV1["resources"],
  privateResources: DecodedPrivatePayloadV1["resources"],
): void {
  const byId = new Map(privateResources.map((item) => [item.resourceId, item]));
  if (
    byId.size !== viewer.length
    || viewer.some((item) => {
      const privateItem = byId.get(item.resourceId);
      return !privateItem
        || privateItem.value !== item.value
        || privateItem.displayValue !== item.displayValue;
    })
  ) {
    fail(GAME_READ_SNAPSHOT_ERROR_CODES.PRIVATE_PROJECTION_INVALID, "row.viewerSource.resources", "PRIVATE_RESOURCE_MISMATCH");
  }
}

function assertPrivateTokenMatch(
  viewer: PressureGameViewerSourceV1["tokens"],
  privateTokens: DecodedPrivatePayloadV1["tokens"],
): void {
  const byId = new Map(privateTokens.map((item) => [item.tokenId, item]));
  if (
    byId.size !== viewer.length
    || viewer.some((item) => {
      const privateItem = byId.get(item.tokenId);
      return !privateItem
        || privateItem.quantity !== item.quantity
        || privateItem.available !== item.available;
    })
  ) {
    fail(GAME_READ_SNAPSHOT_ERROR_CODES.PRIVATE_PROJECTION_INVALID, "row.viewerSource.tokens", "PRIVATE_TOKEN_MISMATCH");
  }
}

function decodeSituation(
  value: unknown,
  path: string,
): PressureGameViewerSourceV1["situation"] {
  const row = exactRecord(value, ["goal", "risk", "judgment"], path);
  return {
    goal: text(row.goal, `${path}.goal`),
    risk: text(row.risk, `${path}.risk`),
    judgment: text(row.judgment, `${path}.judgment`),
  };
}

function chapterPhase(chapter: DecodedChapterV1) {
  return chapter.kind === "CHAPTER"
    ? chapter.chapter.phase
    : chapter.chapterSource.chapter.phase;
}

function computeSnapshotHash(
  body: Omit<GameReadSnapshotV1, "snapshotHash">,
): string {
  const chapterMaterial = "chapterSource" in body.sources
    ? {
        kind: "P0" as const,
        chapterSource: body.sources.chapterSource,
      }
    : {
        kind: "CHAPTER" as const,
        orchestratorHash: body.sources.chapter.orchestratorHash,
        descriptorHash: body.sources.chapterDescriptor.descriptorHash,
        workingProjectionCacheHash:
          body.authority.chapter.kind === "CHAPTER"
            ? body.authority.chapter.workingProjectionCacheHash
            : null,
      };
  return sha256Canonical({
    schemaVersion: body.schemaVersion,
    request: body.request,
    commonSources: {
      roomId: body.sources.roomId,
      runId: body.sources.runId,
      subjectId: body.sources.subjectId,
      routeSnapshot: body.sources.routeSnapshot,
      viewerSeatId: body.sources.viewerSeatId,
      viewerSource: body.sources.viewerSource,
      worldSource: body.sources.worldSource,
      narrativeSource: body.sources.narrativeSource,
      feedPage: body.sources.feedPage,
    },
    chapterMaterial,
    authority: body.authority,
    capturedAtMs: body.capturedAtMs,
  });
}

function makeWorkingProjectionReadOnly(snapshot: GameReadSnapshotV1): void {
  if ("chapterSource" in snapshot.sources) return;
  const projection = snapshot.sources.workingProjection;
  const maps: ReadonlyArray<Map<unknown, unknown>> = [
    projection.acceptedActions,
    projection.actionsByIdempotencyKey,
    projection.commitmentActionsByIdempotencyKey ?? new Map(),
    projection.appliedBeats,
    projection.pendingReservations,
    projection.commitments,
    projection.evidenceRefsByAction,
    projection.knowledgeBySeat,
    projection.seatArcProgressBySeat,
  ];
  maps.forEach(lockMap);
}

function lockMap(map: Map<unknown, unknown>): void {
  const reject = () => {
    throw new TypeError("READ_ONLY_GAME_READ_SNAPSHOT");
  };
  Object.defineProperties(map, {
    set: { value: reject, configurable: false, writable: false },
    delete: { value: reject, configurable: false, writable: false },
    clear: { value: reject, configurable: false, writable: false },
  });
}

function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== "object") return value;
  if (value instanceof Map) {
    for (const [key, entry] of value.entries()) {
      deepFreeze(key);
      deepFreeze(entry);
    }
    return Object.freeze(value);
  }
  if (Object.isFrozen(value)) return value;
  for (const item of Object.values(value as Record<string, unknown>)) {
    deepFreeze(item);
  }
  return Object.freeze(value);
}

function exactRecord(value: unknown, keys: readonly string[], path: string) {
  const row = plainRecord(value, path);
  exactKeys(row, keys, path);
  return row;
}

function exactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
  path: string,
): void {
  const expected = [...keys].sort(compareText);
  const actual = Object.keys(value).sort(compareText);
  if (
    actual.length !== expected.length
    || actual.some((key, index) => key !== expected[index])
  ) {
    const missing = expected.find((key) => !actual.includes(key));
    const extra = actual.find((key) => !expected.includes(key));
    fail(
      GAME_READ_SNAPSHOT_ERROR_CODES.FIELD_INVALID,
      missing ? `${path}.${missing}` : extra ? `${path}.${extra}` : path,
      missing ? "MISSING_FIELD" : "UNKNOWN_FIELD",
    );
  }
}

function plainRecord(value: unknown, path: string): Record<string, unknown> {
  if (
    !value
    || typeof value !== "object"
    || Array.isArray(value)
    || Object.getPrototypeOf(value) !== Object.prototype
  ) {
    fail(GAME_READ_SNAPSHOT_ERROR_CODES.FIELD_INVALID, path, "PLAIN_OBJECT_REQUIRED");
  }
  return value as Record<string, unknown>;
}

function array(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) {
    fail(GAME_READ_SNAPSHOT_ERROR_CODES.FIELD_INVALID, path, "ARRAY_REQUIRED");
  }
  return value;
}

function text(value: unknown, path: string): string {
  if (typeof value !== "string" || !value.trim()) {
    fail(GAME_READ_SNAPSHOT_ERROR_CODES.FIELD_INVALID, path, "NON_EMPTY_STRING");
  }
  return value;
}

function nullableText(value: unknown, path: string): string | null {
  if (value === null) return null;
  return text(value, path);
}

function hash(value: unknown, path: string): string {
  if (typeof value !== "string" || !isSha256(value)) {
    fail(GAME_READ_SNAPSHOT_ERROR_CODES.HASH_MISMATCH, path, "SHA256_LOWER_HEX");
  }
  return value;
}

function nullableHash(value: unknown, path: string): string | null {
  if (value === null) return null;
  return hash(value, path);
}

function nonNegativeInteger(value: unknown, path: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    fail(GAME_READ_SNAPSHOT_ERROR_CODES.FIELD_INVALID, path, "NON_NEGATIVE_SAFE_INTEGER");
  }
  return Number(value);
}

function positiveInteger(value: unknown, path: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) {
    fail(GAME_READ_SNAPSHOT_ERROR_CODES.FIELD_INVALID, path, "POSITIVE_SAFE_INTEGER");
  }
  return Number(value);
}

function integerInRange(
  value: unknown,
  path: string,
  min: number,
  max: number,
): number {
  if (!Number.isSafeInteger(value) || Number(value) < min || Number(value) > max) {
    fail(GAME_READ_SNAPSHOT_ERROR_CODES.FIELD_INVALID, path, `INTEGER_${min}_${max}`);
  }
  return Number(value);
}

function finiteNumber(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    fail(GAME_READ_SNAPSHOT_ERROR_CODES.FIELD_INVALID, path, "FINITE_NUMBER");
  }
  return value;
}

function bool(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") {
    fail(GAME_READ_SNAPSHOT_ERROR_CODES.FIELD_INVALID, path, "BOOLEAN");
  }
  return value;
}

function literal<T extends string>(value: unknown, expected: T, path: string): T {
  if (value !== expected) {
    fail(GAME_READ_SNAPSHOT_ERROR_CODES.FIELD_INVALID, path, `EXPECTED_${expected}`);
  }
  return expected;
}

function enumeration<const T extends readonly string[]>(
  value: unknown,
  allowed: T,
  path: string,
): T[number] {
  if (typeof value !== "string" || !(allowed as readonly string[]).includes(value)) {
    fail(GAME_READ_SNAPSHOT_ERROR_CODES.FIELD_INVALID, path, `ALLOWED_${allowed.join("|")}`);
  }
  return value as T[number];
}

function seatId(value: unknown, path: string): SeatIdV1 {
  try {
    return validateSeatIdV1(value, path);
  } catch {
    fail(GAME_READ_SNAPSHOT_ERROR_CODES.FIELD_INVALID, path, "CANONICAL_SEAT_ID");
  }
}

function chapterIdV1(value: unknown, path: string): ChapterIdV1 {
  if (
    typeof value !== "string"
    || !["N1", "N2", "N3", "N4", "N5", "N6", "N7"].includes(value)
  ) {
    fail(GAME_READ_SNAPSHOT_ERROR_CODES.FIELD_INVALID, path, "N1_TO_N7_REQUIRED");
  }
  return value as ChapterIdV1;
}

function timestamp(value: unknown, path: string): string {
  const result = text(value, path);
  if (!Number.isFinite(Date.parse(result))) {
    fail(GAME_READ_SNAPSHOT_ERROR_CODES.FIELD_INVALID, path, "ISO_TIMESTAMP");
  }
  return result;
}

function nullableTimestamp(value: unknown, path: string): string | null {
  return value === null ? null : timestamp(value, path);
}

function assertUnique(values: readonly string[], path: string): void {
  if (new Set(values).size !== values.length) {
    fail(GAME_READ_SNAPSHOT_ERROR_CODES.FIELD_INVALID, path, "DUPLICATE_VALUE");
  }
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function fail(
  code: GameReadSnapshotErrorCodeV1,
  path: string,
  detail: string,
): never {
  throw new GameReadSnapshotErrorV1(code, path, detail);
}
