import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { Prisma } from "@prisma/client";
import {
  PRESSURE_CHAPTER_ROUTE_V1,
  PRESSURE_CHAPTER_SEAT_IDS_V1,
  TRACK_IDS_V1,
  computeNarrativeArtifactContentHash,
  sha256Canonical,
  withRunRouteHash,
  type ChapterIdV1,
  type SeatIdV1,
  type TrackIdV1,
  type WorldStateV1,
} from "@ai-story/shared";
import {
  projectAEmotionFeedPageV1,
} from "../a-emotion/feed.service";
import {
  aEmotionAggregationKey,
} from "../a-emotion/identity";
import type {
  AEmotionAggregateRecordV1,
  AEmotionDeliveryRecordV1,
} from "../a-emotion/ports";
import type {
  AuthoredChapterRuntimeV1,
} from "../orchestrator/contracts";
import {
  withOrchestratorHashV1,
} from "../orchestrator/validation";
import {
  buildPressureMvpDecisionStateV1,
} from "./mvp-decision-state";
import type { StoredRunRouteRecordV1 } from "../run-router";
import type {
  SeatAuthorityRecordV1,
  SeatControlSnapshotV1,
  SeatPrivateProjectionRecordV1,
} from "../seat-control/types";
import {
  withWorkingLedgerProjectionCacheHashV1,
} from "../working-ledger/projection-cache";
import type { WorkingLedgerProjectionV1 } from "../working-ledger/contracts";
import { workingStateHash } from "../working-ledger/working-ledger";
import {
  GameReadSnapshotErrorV1,
  PRESSURE_GAME_READ_SNAPSHOT_RAW_ROW_SCHEMA_V1,
  PRESSURE_GAME_READ_SNAPSHOT_REQUEST_SCHEMA_V1,
  type GameReadSnapshotRawRowV1,
  type GameReadSnapshotRequestV1,
} from "../game-projection/game-read-snapshot";
import {
  GameReadSnapshotPrismaErrorV1,
  PrismaGameReadSnapshotReaderV1,
  type CaptureGameReadSnapshotV1,
  type GameReadSnapshotLocalAuthoritiesV1,
  type GameReadSnapshotPrismaClientV1,
} from "./game-read-snapshot.prisma-adapter";

const VIEWER: SeatIdV1 = "cabinet_finance";
const NOW = "2026-08-14T07:00:00.000Z";

class FakePrismaV1 implements GameReadSnapshotPrismaClientV1 {
  readonly queries: Prisma.Sql[] = [];

  constructor(private rows: unknown[]) {}

  setRows(rows: unknown[]): void {
    this.rows = rows;
  }

  async $queryRaw<TResult = unknown>(query: Prisma.Sql): Promise<TResult> {
    this.queries.push(query);
    return structuredClone(this.rows) as TResult;
  }
}

class FailingPrismaV1 implements GameReadSnapshotPrismaClientV1 {
  queryCount = 0;

  async $queryRaw<TResult = unknown>(_query: Prisma.Sql): Promise<TResult> {
    this.queryCount += 1;
    throw new Error("SENSITIVE_QUERY_DETAIL_MUST_NOT_LEAK");
  }
}

test("invalid input performs zero queries", async () => {
  const fixture = makeFixture();
  const database = new FakePrismaV1([queryRowFromFixture(fixture)]);
  const reader = new PrismaGameReadSnapshotReaderV1(database, localAuthorities(fixture));
  const invalid: CaptureGameReadSnapshotV1[] = [
    { ...captureInput(fixture), roomId: "other-room" },
    { ...captureInput(fixture), subjectId: "" },
    { ...captureInput(fixture), feedCursor: "" },
    { ...captureInput(fixture), feedLimit: 0 },
    { ...captureInput(fixture), feedLimit: 11 },
    { ...captureInput(fixture), capturedAtMs: -1 },
  ];
  for (const input of invalid) {
    await assert.rejects(
      reader.capture(input),
      (error: unknown) => error instanceof GameReadSnapshotPrismaErrorV1
        && error.code === "GAME_READ_SNAPSHOT_PRISMA_INPUT_INVALID",
    );
  }
  assert.equal(database.queries.length, 0);
});

test("normal viewer fixture uses one parameterized query, zero transaction/write, then delegates to M1 and Feed projector", async () => {
  const fixture = makeFixture();
  const raw = queryRowFromFixture(fixture);
  const database = new FakePrismaV1([raw]);
  const reader = new PrismaGameReadSnapshotReaderV1(database, localAuthorities(fixture));
  const input = captureInput(fixture);
  const snapshot = await reader.capture(input);

  assert.equal(database.queries.length, 1);
  const query = database.queries[0]!;
  assert.deepEqual(query.values, [
    input.roomId,
    input.runId,
    input.subjectId,
    input.feedCursor,
    input.feedLimit,
    input.capturedAtMs,
  ]);
  const statementText = query.strings.join("?");
  assert.equal(statementText.includes(input.runId), false);
  assert.equal(statementText.includes(input.subjectId), false);
  assert.match(statementText, /WITH request_input AS/u);
  assert.match(statementText, /"PressureRunRouteSnapshot"/u);
  assert.match(statementText, /"EventDelivery"/u);
  assert.match(statementText, /delivery\."userId" = request\.subject_id/u);
  assert.match(statementText, /delivery\."roleId" = viewer\.role_id/u);
  assert.match(statementText, /projection\."audienceSeatId" = viewer\.role_key/u);
  assert.match(statementText, /'snapshotJson', seat\.authority_json/u);
  assert.match(
    statementText,
    /runtime\.previous_frozen_hash AS source_id[\s\S]*runtime\.chapter_id <> 'N1'[\s\S]*NOT EXISTS \(SELECT 1 FROM beat_latest\)/u,
  );
  assert.equal(statementText.includes("'snapshotJson', seat.envelope_json"), false);

  const expectedFeed = projectAEmotionFeedPageV1(
    feedRequest(fixture),
    fixture.feedRows,
  );
  assert.deepEqual(snapshot.sources.feedPage, expectedFeed);
  assert.equal(JSON.stringify(snapshot.sources.feedPage), JSON.stringify(expectedFeed));
  assert.equal(snapshot.request.runId, input.runId);
  assert.equal(snapshot.sources.subjectId, input.subjectId);
  assert.equal(snapshot.capturedAtMs, input.capturedAtMs);
});

test("P0 uses the same one-query adapter and emits the accepted narrow P0 snapshot seam", async () => {
  const fixture = makeFixture({ chapterId: "P0" });
  const database = new FakePrismaV1([queryRowFromFixture(fixture)]);
  const snapshot = await new PrismaGameReadSnapshotReaderV1(
    database,
    localAuthorities(fixture),
  ).capture(captureInput(fixture));
  assert.equal(database.queries.length, 1);
  assert.equal("chapterSource" in snapshot.sources, true);
  if ("chapterSource" in snapshot.sources) {
    assert.equal(snapshot.sources.chapterSource.chapter.chapterId, "P0");
  }
});

test("zero or multiple aggregate SQL rows fail closed", async () => {
  const fixture = makeFixture();
  const database = new FakePrismaV1([]);
  const reader = new PrismaGameReadSnapshotReaderV1(database, localAuthorities(fixture));
  await assert.rejects(
    reader.capture(captureInput(fixture)),
    (error: unknown) => error instanceof GameReadSnapshotPrismaErrorV1
      && error.detail === "MISSING_AGGREGATE_ROW",
  );
  database.setRows([queryRowFromFixture(fixture), queryRowFromFixture(fixture)]);
  await assert.rejects(
    reader.capture(captureInput(fixture)),
    (error: unknown) => error instanceof GameReadSnapshotPrismaErrorV1
      && error.detail === "DUPLICATE_AGGREGATE_ROW",
  );
});

test("query failures are fail-closed behind the stable M2 error without SQL or credentials", async () => {
  const fixture = makeFixture();
  const database = new FailingPrismaV1();
  await assert.rejects(
    new PrismaGameReadSnapshotReaderV1(database, localAuthorities(fixture))
      .capture(captureInput(fixture)),
    (error: unknown) => error instanceof GameReadSnapshotPrismaErrorV1
      && error.code === "GAME_READ_SNAPSHOT_PRISMA_QUERY_FAILED"
      && error.path === "query"
      && error.detail === "READ_ONLY_AGGREGATE_QUERY_FAILED"
      && !error.message.includes("SENSITIVE_QUERY_DETAIL_MUST_NOT_LEAK"),
  );
  assert.equal(database.queryCount, 1);
});

test("duplicate viewer membership fails closed", async () => {
  const fixture = makeFixture();
  const row = queryRowFromFixture(fixture);
  const memberships = structuredClone(row.membershipRows as unknown[]);
  row.membershipRows = [memberships[0], structuredClone(memberships[0])];
  const database = new FakePrismaV1([row]);
  await assert.rejects(
    new PrismaGameReadSnapshotReaderV1(database, localAuthorities(fixture))
      .capture(captureInput(fixture)),
    (error: unknown) => error instanceof GameReadSnapshotPrismaErrorV1
      && error.code === "GAME_READ_SNAPSHOT_PRISMA_AUTHORITY_AMBIGUOUS",
  );
});

test("request echo and run/viewer scoped authorities cannot cross the query boundary", async () => {
  const cases: Array<(row: Record<string, unknown>) => void> = [
    (row) => { record(row.requestEcho).subjectId = "other-subject"; },
    (row) => { record((row.membershipRows as unknown[])[0]).runId = "other-run"; },
    (row) => { record(row.seatRecord).runId = "other-run"; },
    (row) => { record(row.worldRecord).runId = "other-run"; },
    (row) => { record((row.narrativeRows as unknown[])[0]).audienceSeatId = "zhejiang_governor"; },
    (row) => {
      const feed = record((row.feedRows as unknown[])[0]);
      record(feed.aggregate).runId = "other-run";
    },
    (row) => {
      const feed = record((row.feedRows as unknown[])[0]);
      record(feed.delivery).viewerSeatId = "zhejiang_governor";
    },
  ];
  for (const mutate of cases) {
    const fixture = makeFixture();
    const row = queryRowFromFixture(fixture);
    mutate(row);
    const database = new FakePrismaV1([row]);
    await assert.rejects(
      new PrismaGameReadSnapshotReaderV1(database, localAuthorities(fixture))
        .capture(captureInput(fixture)),
    );
    assert.equal(database.queries.length, 1);
  }
});

test("private projection and narrative rows remain exact-viewer scoped", async () => {
  const privateFixture = makeFixture();
  const privateRow = queryRowFromFixture(privateFixture);
  record(privateRow.privateProjectionRecord).seatId = "zhejiang_governor";
  await assert.rejects(
    new PrismaGameReadSnapshotReaderV1(
      new FakePrismaV1([privateRow]),
      localAuthorities(privateFixture),
    ).capture(captureInput(privateFixture)),
  );

  const narrativeFixture = makeFixture();
  const narrativeRow = queryRowFromFixture(narrativeFixture);
  record((narrativeRow.narrativeRows as unknown[])[0]).sourceId = digest("other-source");
  await assert.rejects(
    new PrismaGameReadSnapshotReaderV1(
      new FakePrismaV1([narrativeRow]),
      localAuthorities(narrativeFixture),
    ).capture(captureInput(narrativeFixture)),
    (error: unknown) => error instanceof GameReadSnapshotPrismaErrorV1
      && error.path === "narrativeRows[0]",
  );

  const hashFixture = makeFixture();
  const hashRow = queryRowFromFixture(hashFixture);
  record((hashRow.narrativeRows as unknown[])[0]).artifactContentHash = digest("wrong-artifact");
  await assert.rejects(
    new PrismaGameReadSnapshotReaderV1(
      new FakePrismaV1([hashRow]),
      localAuthorities(hashFixture),
    ).capture(captureInput(hashFixture)),
    (error: unknown) => error instanceof GameReadSnapshotPrismaErrorV1
      && error.detail === "ARTIFACT_STORAGE_HASH_MISMATCH",
  );
});

test("missing stored viewer-private projection uses only the injected existing captured-authority compiler", async () => {
  const fixture = makeFixture();
  const row = queryRowFromFixture(fixture);
  row.privateProjectionRecord = null;
  const baseLocal = localAuthorities(fixture);
  let compileCount = 0;
  const local: GameReadSnapshotLocalAuthoritiesV1 = {
    ...baseLocal,
    privateProjection: {
      compile(input) {
        compileCount += 1;
        assert.equal(input.runId, fixture.request.runId);
        assert.equal(input.seatId, VIEWER);
        return baseLocal.privateProjection.compile(input);
      },
    },
  };
  const snapshot = await new PrismaGameReadSnapshotReaderV1(
    new FakePrismaV1([row]),
    local,
  ).capture(captureInput(fixture));
  assert.equal(compileCount, 1);
  assert.equal(snapshot.authority.viewer.seatId, VIEWER);
});

test("missing or ambiguous exact delivery authority fails before Feed projection", async () => {
  for (const mutate of [
    (row: Record<string, unknown>) => { row.feedExactDeliveryCount = 2; },
    (row: Record<string, unknown>) => { row.feedAmbiguousDeliveryCount = 1; },
    (row: Record<string, unknown>) => { row.feedAggregateCount = 4; },
    (row: Record<string, unknown>) => { row.feedInvalidAggregateCount = 1; },
    (row: Record<string, unknown>) => { row.feedDuplicateAggregateVersionCount = 1; },
    (row: Record<string, unknown>) => { row.feedInvalidMarkCount = 1; },
  ]) {
    const fixture = makeFixture();
    const row = queryRowFromFixture(fixture);
    mutate(row);
    await assert.rejects(
      new PrismaGameReadSnapshotReaderV1(
        new FakePrismaV1([row]),
        localAuthorities(fixture),
      ).capture(captureInput(fixture)),
      (error: unknown) => error instanceof GameReadSnapshotPrismaErrorV1
        && error.path === "feedRows",
    );
  }
});

test("orchestrator SQL binding count rejects unbound history instead of TypeScript filtering", async () => {
  const fixture = makeFixture();
  const row = queryRowFromFixture(fixture);
  record(row.orchestratorStats).totalRowCount = 5;
  record(row.orchestratorStats).boundRowCount = 4;
  await assert.rejects(
    new PrismaGameReadSnapshotReaderV1(
      new FakePrismaV1([row]),
      localAuthorities(fixture),
    ).capture(captureInput(fixture)),
    (error: unknown) => error instanceof GameReadSnapshotPrismaErrorV1
      && error.detail === "UNBOUND_ORCHESTRATOR_EVENT",
  );
});

test("adapter source contains one query invocation and no unsafe/raw interpolation, transaction or write primitive", async () => {
  const source = await readFile(
    "apps/api/src/pressure-chapter/persistence/game-read-snapshot.prisma-adapter.ts",
    "utf8",
  );
  assert.equal((source.match(/this\.prisma\.\$queryRaw</gu) ?? []).length, 1);
  for (const forbidden of [
    "$queryRawUnsafe", "Prisma.raw(", "$transaction", "$executeRaw",
    "INSERT INTO", "UPDATE ", "DELETE FROM", " as unknown as ", "@ts-ignore",
    "@ts-expect-error",
  ]) {
    assert.equal(source.includes(forbidden), false, forbidden);
  }
});

interface QueryRowFixtureV1 extends Record<string, unknown> {
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

function captureInput(fixture: FixtureV1): CaptureGameReadSnapshotV1 {
  return {
    roomId: fixture.request.roomId,
    runId: fixture.request.runId,
    subjectId: fixture.request.subjectId,
    feedCursor: fixture.request.feedCursor,
    feedLimit: fixture.request.feedLimit,
    capturedAtMs: Number(fixture.row.capturedAtMs),
  };
}

function queryRowFromFixture(fixture: FixtureV1): QueryRowFixtureV1 {
  const input = captureInput(fixture);
  const route = fixture.row.routeRecord as StoredRunRouteRecordV1;
  const authority = record(fixture.row.seatAuthority);
  const snapshot = structuredClone(authority.snapshotJson) as SeatControlSnapshotV1;
  const privateProjection = structuredClone(
    fixture.row.viewerPrivateProjection,
  ) as SeatPrivateProjectionRecordV1;
  const world = record(fixture.row.worldAuthority);
  const chapter = record(fixture.row.chapterAuthority);
  const narrative = record(fixture.row.narrativeAuthority);
  const narrativeProjection = record(narrative.source);
  const chapterRuntimeId = narrativeProjection.chapterRuntimeId;
  const dynamic = chapter.kind === "CHAPTER";
  const orchestrator = dynamic
    ? record(chapter.orchestrator)
    : {
        count: 0,
        minRevision: null,
        maxRevision: null,
        distinctRevisionCount: 0,
        latestState: null,
      };
  const count = Number(orchestrator.count ?? 0);
  return {
    requestEcho: {
      roomId: input.roomId,
      runId: input.runId,
      subjectId: input.subjectId,
      feedCursor: input.feedCursor,
      feedLimit: input.feedLimit,
      capturedAtMs: input.capturedAtMs,
    },
    routeRecord: structuredClone(route),
    membershipRows: structuredClone(fixture.row.membershipRows),
    seatRecord: {
      runId: input.runId,
      stateRevision: authority.stateRevision,
      stateHash: authority.stateHash,
      snapshotJson: snapshot,
      version: authority.version,
    },
    privateProjectionRecord: structuredClone(privateProjection),
    worldRecord: {
      runId: input.runId,
      version: world.version,
      currentNodeId: world.currentNodeId,
      worldSequence: world.worldSequence,
      reservedWorldSequence: world.reservedWorldSequence,
      stateJson: structuredClone(world.stateJson),
    },
    genesisRecord: {
      runId: input.runId,
      sequence: 0,
      genesisHash: narrativeProjection.sourceAuthority === "GENESIS_FROZEN"
        ? narrativeProjection.sourceId
        : digest("genesis"),
      commitHash: narrativeProjection.sourceAuthority === "GENESIS_FROZEN"
        ? narrativeProjection.sourceCommitHash
        : digest("genesis-commit"),
      rootEventId: chapterRuntimeId,
      commitManifestJson: {},
    },
    orchestratorStats: {
      totalRowCount: count,
      boundRowCount: count,
      count: orchestrator.count,
      minRevision: orchestrator.minRevision,
      maxRevision: orchestrator.maxRevision,
      distinctRevisionCount: orchestrator.distinctRevisionCount,
      latestState: structuredClone(orchestrator.latestState),
    },
    runtimeRecord: dynamic ? structuredClone(chapter.runtime) : null,
    narrativeSource: {
      chapterRuntimeId,
      projectionKind: narrativeProjection.projectionKind,
      sourceAuthority: narrativeProjection.sourceAuthority,
      sourceId: narrativeProjection.sourceId,
      sourceCommitHash: narrativeProjection.sourceCommitHash,
    },
    narrativeRows: [{
      id: `narrative:${input.runId}`,
      runId: input.runId,
      projectionKind: narrativeProjection.projectionKind,
      sourceAuthority: narrativeProjection.sourceAuthority,
      sourceId: narrativeProjection.sourceId,
      sourceCommitHash: narrativeProjection.sourceCommitHash,
      sourceContentHash: narrative.sourceContentHash,
      narrativeProfileVersion: route.snapshot.narrativeProfileVersion,
      projectorVersion: narrative.projectorVersion,
      audienceKind: "SEAT",
      audienceSeatId: viewerSeatId(fixture),
      audienceKey: viewerSeatId(fixture),
      status: narrativeProjection.status,
      artifactJson: structuredClone(narrative.artifactJson),
      artifactContentHash: narrativeProjection.contentHash,
    }],
    feedRows: structuredClone(fixture.feedRows),
    feedAggregateCount: fixture.feedRows.length,
    feedExactDeliveryCount: fixture.feedRows.length,
    feedAmbiguousDeliveryCount: 0,
    feedInvalidAggregateCount: 0,
    feedDuplicateAggregateVersionCount: 0,
    feedInvalidMarkCount: 0,
  };
}

function localAuthorities(fixture: FixtureV1): GameReadSnapshotLocalAuthoritiesV1 {
  const viewer = record(fixture.row.viewerSource);
  const viewerProjection = record(viewer.viewer);
  const resources = (viewer.resources as Array<Record<string, unknown>>);
  const tokens = (viewer.tokens as Array<Record<string, unknown>>);
  const worldSource = record(record(fixture.row.worldAuthority).source);
  const chapter = record(fixture.row.chapterAuthority);
  const descriptor = chapter.kind === "CHAPTER"
    ? structuredClone(chapter.descriptor) as AuthoredChapterRuntimeV1
    : null;
  return {
    chapters: {
      async load() {
        if (!descriptor) throw new Error("DYNAMIC_DESCRIPTOR_REQUIRED");
        return structuredClone(descriptor);
      },
    },
    presentation: {
      chapterTitle(chapterId) {
        if (chapterId === "P0") {
          return String(record(record(chapter.chapterSource).chapter).title);
        }
        return `chapter:${chapterId}`;
      },
      metrics() {
        return structuredClone(worldSource.metrics as Array<{
          trackId: TrackIdV1;
          label: string;
          value: number;
          displayValue: string;
          tone: "DEFAULT" | "GOOD" | "WARN" | "DANGER";
        }>);
      },
    },
    seatCatalog: {
      readCatalogFromRoute() {
        const roleNames = {
          [String(viewerProjection.seatId)]: String(viewerProjection.roleName),
        };
        return {
          roleNames,
          resources: Object.fromEntries(resources.map((item) => [
            String(item.resourceId),
            { label: String(item.label) },
          ])),
          tokens: Object.fromEntries(tokens.map((item) => [
            String(item.tokenId),
            {
              label: String(item.label),
              description: String(item.description),
            },
          ])),
        };
      },
    },
    privateProjection: {
      compile() {
        return structuredClone(
          fixture.row.viewerPrivateProjection as SeatPrivateProjectionRecordV1,
        );
      },
    },
  };
}

interface FixtureOptionsV1 {
  chapterId?: "P0" | ChapterIdV1;
  viewerSeatId?: SeatIdV1;
  decisionMode?: "SOLO_BEAT" | "TARGETED_INTERACTION" | "SYNC_CONTEST";
  feedLimit?: number;
}

interface FixtureV1 {
  request: GameReadSnapshotRequestV1;
  row: GameReadSnapshotRawRowV1;
  feedRows: Array<{
    aggregate: AEmotionAggregateRecordV1;
    delivery: AEmotionDeliveryRecordV1;
  }>;
}

function makeFixture(options: FixtureOptionsV1 = {}): FixtureV1 {
  const chapterId = options.chapterId ?? "N2";
  const viewerSeatId = options.viewerSeatId ?? VIEWER;
  const decisionMode = options.decisionMode ?? "SOLO_BEAT";
  const feedLimit = options.feedLimit ?? 2;
  const subjectId = `human:${viewerSeatId}`;
  const runId = `game-read-${chapterId.toLowerCase()}-${viewerSeatId}-${decisionMode.toLowerCase()}`;
  const routeRecord = makeStoredRoute(runId, viewerSeatId);
  const route = routeRecord.snapshot;
  const seatSnapshot = makeSeatSnapshot(route, viewerSeatId, subjectId);
  const viewerSeat = seatSnapshot.seatControls.find((seat) => seat.seatId === viewerSeatId)!;
  const seatAuthority = {
    runId,
    stateRevision: seatSnapshot.stateRevision,
    stateHash: seatSnapshot.stateHash,
    snapshotJson: seatSnapshot,
    version: 1,
  };
  const privatePayload = {
    schemaVersion: "pressure_game_viewer_private_payload_v1" as const,
    situation: {
      goal: `goal:${viewerSeatId}`,
      risk: `risk:${chapterId}`,
      judgment: `judgment:${decisionMode}`,
    },
    resources: [{ resourceId: "resource.credit", value: 7, displayValue: "7" }],
    tokens: [{ tokenId: "token.primary", quantity: 1, available: true }],
  };
  const viewerPrivateProjection = {
    schemaVersion: "pressure_seat_private_projection_record_v1" as const,
    runId,
    seatId: viewerSeatId,
    sourceAuthorityHash: seatSnapshot.stateHash,
    projectionVersion: `private:${digest({ runId, viewerSeatId })}`,
    payload: privatePayload,
    payloadHash: sha256Canonical(privatePayload),
  };
  const viewerSource = {
    roomId: runId,
    runId,
    routeHash: route.routeHash,
    subjectId,
    viewer: {
      seatId: viewerSeatId,
      roleName: `role:${viewerSeatId}`,
      control: {
        mode: "HUMAN_ACTIVE" as const,
        controlEpoch: viewerSeat.controlEpoch,
        canSubmit: true,
        canReclaim: false,
        submissionFenceToken: viewerSeat.submissionFenceToken,
        reclaimFenceToken: null,
      },
    },
    situation: structuredClone(privatePayload.situation),
    resources: [{
      resourceId: "resource.credit",
      label: "信用",
      value: 7,
      displayValue: "7",
    }],
    tokens: [{
      tokenId: "token.primary",
      label: "主筹码",
      description: "viewer-only token",
      quantity: 1,
      available: true,
    }],
  };
  const worldSequence = chapterId === "P0" ? 0 : Number(chapterId.slice(1)) - 1;
  const worldState = makeWorldState(runId, worldSequence);
  const chapterAuthority = chapterId === "P0"
    ? makeP0ChapterAuthority(runId, route.routeHash, viewerSeatId)
    : makeDynamicChapterAuthority(
        runId,
        route,
        chapterId,
        viewerSeatId,
        decisionMode,
        worldState,
      );
  const chapterRuntimeId = chapterId === "P0"
    ? record(record(record(chapterAuthority).chapterSource).chapter).chapterRuntimeId as string
    : (record(record(record(chapterAuthority).orchestrator).latestState)
        .chapterRuntimeId as string);
  const workingRevision = chapterId === "P0" ? 0 : 3;
  const worldSource = {
    runId,
    routeHash: route.routeHash,
    worldSequence,
    worldStateHash: worldState.stateHash,
    metrics: TRACK_IDS_V1.map((trackId, index) => ({
      trackId,
      label: `metric:${trackId}`,
      value: worldState.tracks.values[trackId],
      displayValue: String(worldState.tracks.values[trackId]),
      tone: index === 0 ? "WARN" as const : "DEFAULT" as const,
    })),
  };
  const narrativeAuthority = makeNarrative(
    runId,
    route,
    viewerSeatId,
    chapterId,
    chapterRuntimeId,
    workingRevision,
  );
  const feedRows = makeFeedRows(runId, viewerSeatId);
  const request: GameReadSnapshotRequestV1 = {
    schemaVersion: PRESSURE_GAME_READ_SNAPSHOT_REQUEST_SCHEMA_V1,
    roomId: runId,
    runId,
    subjectId,
    feedCursor: null,
    feedLimit,
  };
  const row: GameReadSnapshotRawRowV1 = {
    schemaVersion: PRESSURE_GAME_READ_SNAPSHOT_RAW_ROW_SCHEMA_V1,
    routeRecord,
    membershipRows: [{
      playerId: `player:${subjectId}`,
      runId,
      userId: subjectId,
      playerType: "human",
      status: "active",
      roleId: `role-id:${viewerSeatId}`,
      roleRunId: runId,
      roleKey: viewerSeatId,
      roleName: `role:${viewerSeatId}`,
    }],
    seatAuthority,
    viewerPrivateProjection,
    viewerSource,
    chapterAuthority,
    worldAuthority: {
      runId,
      version: 4,
      currentNodeId: chapterId,
      worldSequence,
      reservedWorldSequence: worldSequence,
      stateJson: worldState,
      source: worldSource,
    },
    narrativeAuthority,
    feedAuthority: {
      schemaVersion: "pressure_game_read_feed_authority_v1",
      roomId: runId,
      runId,
      viewerSeatId,
      rows: structuredClone(feedRows),
    },
    capturedAtMs: 1_765_777_200_000,
  };
  return { request, row, feedRows };
}

function makeStoredRoute(runId: string, humanSeatId: SeatIdV1): StoredRunRouteRecordV1 {
  const topologyBody = {
    schemaVersion: "pressure_initial_role_control_topology_v1" as const,
    controlTopologyVersion: "pressure-control-topology-v1",
    participantMode: "SOLO" as const,
    seatControls: PRESSURE_CHAPTER_SEAT_IDS_V1.map((seatId) => ({
      seatId,
      mode: seatId === humanSeatId ? "HUMAN_ACTIVE" as const : "AI_ACTIVE" as const,
    })),
  };
  const controlTopology = {
    ...topologyBody,
    topologyHash: sha256Canonical(topologyBody),
  };
  const snapshot = withRunRouteHash({
    schemaVersion: "pressure_run_route_snapshot_v1",
    runId,
    route: { ...PRESSURE_CHAPTER_ROUTE_V1 },
    contentPackageVersion: "sangtian-content-game-read-v1",
    contentPackageSha256: digest("content"),
    orchestrationPackageVersion: "sangtian-orchestration-game-read-v1",
    orchestrationPackageSha256: digest("orchestration"),
    runtimeContractVersion: "pressure-runtime-game-read-v1",
    runtimeContractSha256: digest("runtime"),
    testMatrixVersion: "pressure-test-game-read-v1",
    testMatrixSha256: digest("test"),
    runSeed: `seed:${runId}`,
    narrativeProfileVersion: "openovel-pressure-game-read-v1",
    featureSetVersion: "pressure-game-read-feature-v1",
    resultContractRegistryVersion: "pressure-result-game-read-v1",
    participantMode: "SOLO",
    seatIds: [...PRESSURE_CHAPTER_SEAT_IDS_V1],
    humanSeatIdsAtStart: [humanSeatId],
    controlTopologyVersion: topologyBody.controlTopologyVersion,
    initialRoleControlSnapshotHash: controlTopology.topologyHash,
  });
  const body = {
    schemaVersion: "pressure_stored_run_route_v1" as const,
    runId,
    routeKey: "sangtian-pressure",
    registryVersion: "registry-game-read-v1",
    registryHash: digest("registry"),
    handlerKey: "pressure_chapter_v1" as const,
    resultAdapterKey: "SangtianPressureResultV1Adapter" as const,
    presentationSchemaVersion: "sangtian_pressure_result_v1" as const,
    rendererKey: "sangtian_pressure_endgame_v1" as const,
    createRequestFingerprint: digest({ runId, humanSeatId }),
    snapshot,
    controlTopology,
  };
  return { ...body, recordHash: sha256Canonical(body) };
}

function makeSeatSnapshot(
  route: StoredRunRouteRecordV1["snapshot"],
  viewerSeatId: SeatIdV1,
  subjectId: string,
): SeatControlSnapshotV1 {
  const policyBody = {
    schemaVersion: "pressure_frozen_seat_control_policy_v1" as const,
    policyVersion: "seat-policy-v1",
    disconnectPolicy: "PRESENCE_ADVISORY_ONLY" as const,
    takeoverDeadlinePolicyRef: "takeover-v1",
    takeoverDeadlinePolicyHash: digest("takeover"),
    deterministicDefaultPolicyRef: "default-v1",
    deterministicDefaultPolicyHash: digest("default"),
    humanReclaimAllowed: true,
  };
  const frozenPolicy = {
    ...policyBody,
    policyHash: sha256Canonical(policyBody),
  };
  const seatControls: SeatAuthorityRecordV1[] =
    PRESSURE_CHAPTER_SEAT_IDS_V1.map((seatId) => {
      const human = seatId === viewerSeatId;
      const ai = `pressure-ai:${seatId}`;
      return {
        seatId,
        mode: human ? "HUMAN_ACTIVE" : "AI_ACTIVE",
        originalHumanControllerId: human ? subjectId : null,
        designatedAiControllerId: ai,
        activeControllerId: human ? subjectId : ai,
        controlEpoch: 2,
        submissionFenceToken: digest(`submit:${seatId}`),
        reclaimFenceToken: null,
        lastAuthorityEventHash: digest(`event:${seatId}`),
      };
    });
  const body = {
    schemaVersion: "pressure_seat_control_snapshot_v1" as const,
    runId: route.runId,
    participantMode: route.participantMode,
    routeHash: route.routeHash,
    genesisHash: digest("genesis"),
    genesisAtomicRecordHash: digest("genesis-atomic"),
    initialTopologyHash: route.initialRoleControlSnapshotHash,
    controlTopologyVersion: route.controlTopologyVersion,
    frozenPolicy,
    stateRevision: 7,
    timelineLength: 6,
    timelineHeadHash: digest("timeline"),
    seatControls,
    initializationInputHash: digest("initialization"),
  };
  return { ...body, stateHash: sha256Canonical(body) };
}

function makeP0ChapterAuthority(
  runId: string,
  routeHash: string,
  viewerSeatId: SeatIdV1,
) {
  return {
    kind: "P0",
    chapterSource: {
      runId,
      routeHash,
      viewerSeatId,
      projectionVersion: 1,
      chapter: {
        chapterRuntimeId: `p0:${runId}`,
        chapterId: "P0",
        chapterNumber: 0,
        title: "序章",
        phase: "ACTIVE",
        workingRevision: 0,
      },
      decision: null,
    },
  };
}

function makeDynamicChapterAuthority(
  runId: string,
  route: StoredRunRouteRecordV1["snapshot"],
  chapterId: ChapterIdV1,
  viewerSeatId: SeatIdV1,
  mode: "SOLO_BEAT" | "TARGETED_INTERACTION" | "SYNC_CONTEST",
  worldState: WorldStateV1,
) {
  const descriptor = makeDescriptor(chapterId, viewerSeatId, mode);
  const runtimeId = `runtime:${runId}:${chapterId}`;
  const state = {
    schemaVersion: "pressure_chapter_working_state_v1" as const,
    runId,
    chapterId,
    revision: 3,
    facts: {},
    counters: {},
    satisfiedRequirementIds: [],
    completedDecisionPointIds: [],
    settledReactions: [],
    lastBeatId: null,
  };
  const stateHash = workingStateHash(state);
  const decisionPointId = `${chapterId}.decision`;
  const pin = {
    schemaVersion: "pressure_decision_pin_v1" as const,
    chapterId,
    stateRevision: 3,
    stateFingerprint: stateHash,
    decisionPointId,
    kernelId: `${chapterId}.kernel`,
    optionIds: ["DECIDE"],
  };
  const projection: WorkingLedgerProjectionV1 = {
    key: { runId, chapterRuntimeId: runtimeId },
    chapterId,
    routeHash: route.routeHash,
    chapterDefinitionHash: sha256Canonical(descriptor.definition),
    headHash: digest(`head:${runId}:${chapterId}`),
    headSequence: 4,
    state,
    stateHash,
    nextDecisionPin: pin,
    acceptedActions: new Map(),
    actionsByIdempotencyKey: new Map(),
    commitmentActionsByIdempotencyKey: new Map(),
    appliedBeats: new Map(),
    pendingReservations: new Map(),
    commitments: new Map(),
    evidenceRefsByAction: new Map(),
    knowledgeBySeat: new Map(),
    seatArcProgressBySeat: new Map(),
  };
  const previousFrozenHash = digest(`previous:${chapterId}`);
  const chapter = withOrchestratorHashV1({
    schemaVersion: "pressure_chapter_orchestrator_state_v1",
    runId,
    routeHash: route.routeHash,
    revision: 5,
    phase: "ACTIVE",
    currentChapterId: chapterId,
    chapterRuntimeId: runtimeId,
    descriptorHash: descriptor.descriptorHash,
    authorityBase: {
      baseWorldSequence: worldState.worldSequence,
      baseWorldStateHash: worldState.stateHash,
      previousFrozenHash,
    },
    activeDecision: {
      decisionPointId,
      policyHash: digest(`policy:${decisionPointId}`),
      openedAtMs: 1_000,
      deadlineAtMs: 10_000,
      seats: PRESSURE_CHAPTER_SEAT_IDS_V1.map((seatId) => ({
        seatId,
        requirement: seatId === viewerSeatId ? "REQUIRED" as const : "NOT_REQUIRED" as const,
        completion: seatId === viewerSeatId ? "PENDING" as const : "NOT_REQUIRED" as const,
        actionIds: [],
        actionCount: 0,
        defaultCode: null,
      })),
    },
    chapterSeatSummaries: PRESSURE_CHAPTER_SEAT_IDS_V1.map((seatId) => ({
      seatId,
      requirement: seatId === viewerSeatId ? "REQUIRED" as const : "NOT_REQUIRED" as const,
      sealedActionIds: [],
      defaultActionIds: [],
      defaultCodes: [],
    })),
    settlementInputHash: null,
    frozenBundleHash: null,
  });
  const decisionState = buildPressureMvpDecisionStateV1({
    workingRevision: state.revision,
    pin,
    requiredSeatIds: [viewerSeatId],
    policyHash: chapter.activeDecision!.policyHash,
    orchestratorHash: chapter.orchestratorHash,
  });
  return {
    kind: "CHAPTER",
    orchestrator: {
      count: 6,
      minRevision: 0,
      maxRevision: 5,
      distinctRevisionCount: 6,
      latestState: chapter,
    },
    runtime: {
      id: runtimeId,
      runId,
      chapterId,
      chapterSequence: Number(chapterId.slice(1)),
      state: "DECISION_POINT_OPEN",
      routeHash: route.routeHash,
      baseWorldSequence: worldState.worldSequence,
      baseWorldStateHash: worldState.stateHash,
      previousFrozenHash,
      contentPackageVersion: route.contentPackageVersion,
      contentHash: route.contentPackageSha256,
      orchestrationPackageVersion: route.orchestrationPackageVersion,
      orchestrationHash: route.orchestrationPackageSha256,
      runtimeContractVersion: route.runtimeContractVersion,
      runtimeContractHash: route.runtimeContractSha256,
      workingRevision: state.revision,
      workingStateJson: state,
      workingStateHash: stateHash,
      ledgerHeadSequence: projection.headSequence,
      ledgerHeadHash: projection.headHash,
      decisionStateJson: decisionState,
      ledgerProjectionJson: cacheOf(projection),
      lockVersion: 9,
    },
    descriptor,
  };
}

function makeDescriptor(
  chapterId: ChapterIdV1,
  viewerSeatId: SeatIdV1,
  mode: "SOLO_BEAT" | "TARGETED_INTERACTION" | "SYNC_CONTEST",
): AuthoredChapterRuntimeV1 {
  const decisionPointId = `${chapterId}.decision`;
  const defaultPolicy = (ref: string) => {
    const body = {
      policyRef: ref,
      actionType: "DECIDE",
      payload: { optionId: "DECIDE" },
    };
    return { ...body, policyHash: sha256Canonical(body) };
  };
  const definition = {
    schemaVersion: "pressure_chapter_definition_v1" as const,
    chapterId,
    sequence: Number(chapterId.slice(1)),
    decisionPoints: [{
      decisionPointId,
      kernelId: `${chapterId}.kernel`,
      chapterId,
      sourceOrder: 1,
      prompt: `Resolve ${decisionPointId}`,
      requirementIds: [],
      priority: { duePressureCount: 1 },
      options: [{
        optionId: "DECIDE",
        sourceOrder: 1,
        label: "Decide",
        workingDelta: { setFacts: { [`fact.${decisionPointId}`]: true } },
      }],
    }],
    requirementDependencies: [],
  };
  const decisions = [{
    decisionPointId,
    execution: {
      decisionPointKey: decisionPointId,
      chapterId,
      ordinal: 1,
      mode,
      purpose: `Resolve ${decisionPointId}`,
      requiredSeatIds: [viewerSeatId],
      allowedActionTypes: ["DECIDE"],
      perSeatActionBudget: { [viewerSeatId]: 1 },
      closeCondition: {
        op: "COMPARE" as const,
        factRef: "seat.ready",
        comparator: "EQ" as const,
        value: true,
      },
      deadlinePolicy: null,
      absenceDefaultPolicy: defaultPolicy(`${decisionPointId}.absence`),
      aiFailureDefaultPolicy: defaultPolicy(`${decisionPointId}.ai-failure`),
      beatResolutionPolicy: `${chapterId}.kernel`,
      allowedWorkingDeltaTypes: ["FACT" as const],
      feedbackVisibilityPolicy: "AUDIENCE_PROJECTED" as const,
      reactionPolicy: {
        enabled: false,
        eligibleSeatIds: [],
        trigger: null,
        maxDepth: 0 as const,
      },
    },
    seatRequirements: Object.fromEntries(
      PRESSURE_CHAPTER_SEAT_IDS_V1.map((seatId) => [
        seatId,
        seatId === viewerSeatId ? "REQUIRED" : "NOT_REQUIRED",
      ]),
    ) as AuthoredChapterRuntimeV1["decisions"][number]["seatRequirements"],
  }];
  const body = {
    schemaVersion: "pressure_authored_chapter_runtime_v1" as const,
    chapterId,
    definition,
    decisions,
    chapterClosePolicy: {
      kind: "ALL_AUTHORED_DECISION_POINTS_COMPLETED" as const,
      decisionPointIds: [decisionPointId],
    },
    contentPolicyVersion: `content-policy-${chapterId}`,
    contentPolicyHash: digest(`content-policy-${chapterId}`),
    settlementContractVersion: "settlement-v1",
    settlementContractHash: digest("settlement"),
  };
  return { ...body, descriptorHash: sha256Canonical(body) };
}

function cacheOf(projection: WorkingLedgerProjectionV1): Record<string, unknown> {
  const entries = <T>(value: ReadonlyMap<string, T>) => [...value.entries()];
  return withWorkingLedgerProjectionCacheHashV1({
    schemaVersion: "pressure_mvp_ledger_projection_v1",
    key: projection.key,
    chapterId: projection.chapterId,
    routeHash: projection.routeHash,
    chapterDefinitionHash: projection.chapterDefinitionHash,
    headHash: projection.headHash,
    headSequence: projection.headSequence,
    stateHash: projection.stateHash,
    nextDecisionPin: projection.nextDecisionPin,
    acceptedActions: entries(projection.acceptedActions),
    actionsByIdempotencyKey: entries(projection.actionsByIdempotencyKey),
    commitmentActionsByIdempotencyKey: entries(
      projection.commitmentActionsByIdempotencyKey ?? new Map(),
    ),
    appliedBeats: entries(projection.appliedBeats),
    pendingReservations: entries(projection.pendingReservations),
    commitments: entries(projection.commitments),
    evidenceRefsByAction: entries(projection.evidenceRefsByAction),
    knowledgeBySeat: entries(projection.knowledgeBySeat),
    seatArcProgressBySeat: entries(projection.seatArcProgressBySeat),
    beatDownstreamManifest: null,
  });
}

function makeWorldState(runId: string, sequence: number): WorldStateV1 {
  const tracksBody = {
    schemaVersion: "sangtian_track_state_v1" as const,
    values: Object.fromEntries(
      TRACK_IDS_V1.map((trackId, index) => [trackId, sequence + index]),
    ) as Record<TrackIdV1, number>,
  };
  const tracks = { ...tracksBody, stateHash: sha256Canonical(tracksBody) };
  const knowledgeBySeat = PRESSURE_CHAPTER_SEAT_IDS_V1.reduce<
    WorldStateV1["knowledgeBySeat"]
  >((all, seatId) => {
    const body = {
      seatId,
      knownFactRefs: [],
      secretRefs: [],
      disclosedToSeatIds: [] as SeatIdV1[],
    };
    all[seatId] = { ...body, stateHash: sha256Canonical(body) };
    return all;
  }, {} as WorldStateV1["knowledgeBySeat"]);
  const seatArcs = PRESSURE_CHAPTER_SEAT_IDS_V1.reduce<WorldStateV1["seatArcs"]>(
    (all, seatId) => {
      const body = {
        seatId,
        arcStage: `stage-${sequence}`,
        publicGoalProgress: sequence,
        privateGoalProgress: sequence,
        gainRefs: [],
        lossRefs: [],
        costRefs: [],
      };
      all[seatId] = { ...body, stateHash: sha256Canonical(body) };
      return all;
    },
    {} as WorldStateV1["seatArcs"],
  );
  const body = {
    schemaVersion: "sangtian_world_state_v1" as const,
    worldSequence: sequence,
    factValues: { [`run.${runId}.sequence`]: sequence },
    resources: { "resource.credit": 7 },
    tracks,
    objects: [],
    knowledgeBySeat,
    evidence: [],
    responsibilities: [],
    seatArcs,
  };
  return { ...body, stateHash: sha256Canonical(body) };
}

function makeNarrative(
  runId: string,
  route: StoredRunRouteRecordV1["snapshot"],
  viewerSeatId: SeatIdV1,
  chapterId: "P0" | ChapterIdV1,
  chapterRuntimeId: string,
  workingRevision: number,
) {
  const projectionKind = chapterId === "P0"
    ? "GENESIS_NARRATIVE" as const
    : "BEAT_NARRATIVE" as const;
  const sourceAuthority = chapterId === "P0"
    ? "GENESIS_FROZEN" as const
    : "CHAPTER_WORKING" as const;
  const sourceId = digest(`narrative-source:${runId}:${chapterId}:${workingRevision}`);
  const sourceCommitHash = digest(`narrative-commit:${runId}:${chapterId}`);
  const sourceContentHash = digest(`narrative-content:${runId}:${chapterId}`);
  const projectorVersion = "projector-game-read-v1";
  const text = `viewer narrative ${chapterId} ${viewerSeatId}`;
  const usedFactRefs: string[] = [];
  const artifactBody = {
    schemaVersion: "openovel_narrative_artifact_v1" as const,
    jobId: `job:${runId}:${viewerSeatId}`,
    runId,
    projectionKind,
    sourceId,
    sourceCommitHash,
    sourceContentHash,
    audience: { kind: "SEAT" as const, seatId: viewerSeatId },
    narrativeProfileVersion: route.narrativeProfileVersion,
    projectorVersion,
    text,
    usedFactRefs,
    validationReportHash: digest("validation-report"),
    renderMode: "PROVIDER" as const,
    status: "PUBLISHED" as const,
  };
  const artifact = {
    ...artifactBody,
    contentHash: computeNarrativeArtifactContentHash(artifactBody),
  };
  return {
    source: {
      runId,
      routeHash: route.routeHash,
      viewerSeatId,
      chapterRuntimeId,
      status: artifact.status,
      projectionKind,
      sourceAuthority,
      sourceId,
      sourceCommitHash,
      text,
      contentHash: artifact.contentHash,
      renderMode: artifact.renderMode,
    },
    sourceContentHash,
    narrativeProfileVersion: route.narrativeProfileVersion,
    projectorVersion,
    artifactJson: artifact,
  };
}

function makeFeedRows(
  runId: string,
  viewerSeatId: SeatIdV1,
): FixtureV1["feedRows"] {
  return [30, 20, 10].map((eventSequence, index) => {
    const eventId = `feed-event-${eventSequence}`;
    const projectionBody = {
      schemaVersion: "a_emotion_viewer_projection_v1" as const,
      eventId,
      projectionVersion: 1,
      roomId: runId,
      runId,
      viewerSeatId,
      category: "RELATED" as const,
      disclosure: "HIDDEN" as const,
      severity: eventSequence === 10 ? "CRITICAL" as const : "MINOR" as const,
      title: `Feed ${eventSequence}`,
      safeSummary: `Summary ${eventSequence}`,
      statusLabel: "New",
      visibleImpacts: [],
      knownFactRefs: [],
      responseOptions: [],
      recommendedPresentation: "FEED_ONLY" as const,
      centerCard: null,
      keyModal: null,
      eventSequence,
      occurredAt: NOW,
    };
    const projection = {
      ...projectionBody,
      projectionHash: sha256Canonical(projectionBody),
    };
    const aggregate: AEmotionAggregateRecordV1 = {
      aggregationKey: aEmotionAggregationKey({
        roomId: runId,
        runId,
        viewerSeatId,
        eventId,
      }),
      roomId: runId,
      runId,
      viewerSeatId,
      stageId: "N2",
      sharedObjectId: null,
      eventFamily: "TEST",
      latestEventId: eventId,
      projectionVersion: projection.projectionVersion,
      projection,
      createdAt: NOW,
      updatedAt: NOW,
    };
    const delivery: AEmotionDeliveryRecordV1 = {
      eventId,
      projectionVersion: projection.projectionVersion,
      roomId: runId,
      runId,
      viewerSeatId,
      deliveredAt: NOW,
      seenAt: index === 2 ? NOW : null,
      acknowledgedAt: index >= 1 ? NOW : null,
      resolvedAt: null,
      keyModalShownAt: null,
    };
    return { aggregate, delivery };
  });
}

function feedRequest(fixture: FixtureV1) {
  return {
    roomId: fixture.request.roomId,
    runId: fixture.request.runId,
    viewerSeatId: viewerSeatId(fixture),
    cursor: fixture.request.feedCursor,
    limit: fixture.request.feedLimit,
  };
}

function viewerSeatId(fixture: FixtureV1): SeatIdV1 {
  return membershipRow(fixture).roleKey as SeatIdV1;
}

function membershipRow(fixture: FixtureV1): Record<string, unknown> {
  return (fixture.row.membershipRows as Array<Record<string, unknown>>)[0]!;
}

function dynamicRoot(fixture: FixtureV1): Record<string, unknown> {
  return record(fixture.row.chapterAuthority);
}

function dynamicRuntime(fixture: FixtureV1): Record<string, unknown> {
  return record(dynamicRoot(fixture).runtime);
}

function dynamicOrchestrator(fixture: FixtureV1): Record<string, unknown> {
  return record(dynamicRoot(fixture).orchestrator);
}

function workingCache(fixture: FixtureV1): Record<string, unknown> {
  return record(dynamicRuntime(fixture).ledgerProjectionJson);
}

function viewerControl(fixture: FixtureV1): Record<string, unknown> {
  return record(record(record(fixture.row.viewerSource).viewer).control);
}

function seatSnapshotJson(fixture: FixtureV1): Record<string, unknown> {
  return record(record(fixture.row.seatAuthority).snapshotJson);
}

function worldMetrics(fixture: FixtureV1): Array<Record<string, unknown>> {
  return record(record(fixture.row.worldAuthority).source).metrics as Array<Record<string, unknown>>;
}

function narrativeSource(fixture: FixtureV1): Record<string, unknown> {
  return record(record(fixture.row.narrativeAuthority).source);
}

function narrativeArtifact(fixture: FixtureV1): Record<string, unknown> {
  return record(record(fixture.row.narrativeAuthority).artifactJson);
}

function feedAuthorityRows(fixture: FixtureV1): Array<Record<string, unknown>> {
  return record(fixture.row.feedAuthority).rows as Array<Record<string, unknown>>;
}

function feedAggregate(fixture: FixtureV1, index: number): Record<string, unknown> {
  return record(feedAuthorityRows(fixture)[index]!.aggregate);
}

function feedDelivery(fixture: FixtureV1, index: number): Record<string, unknown> {
  return record(feedAuthorityRows(fixture)[index]!.delivery);
}

function feedProjection(fixture: FixtureV1, index: number): Record<string, unknown> {
  return record(feedAggregate(fixture, index).projection);
}

function resealWorkingCache(cache: Record<string, unknown>): void {
  const body = { ...cache };
  delete body.projectionCacheHash;
  cache.projectionCacheHash = sha256Canonical(body);
}

function mutateWorkingCache(
  fixture: FixtureV1,
  mutate: (cache: Record<string, unknown>) => void,
): void {
  const cache = workingCache(fixture);
  mutate(cache);
  resealWorkingCache(cache);
}

function resealSeatAuthority(fixture: FixtureV1): void {
  const authority = record(fixture.row.seatAuthority);
  const snapshot = record(authority.snapshotJson);
  const body = { ...snapshot };
  delete body.stateHash;
  const stateHash = sha256Canonical(body);
  snapshot.stateHash = stateHash;
  authority.stateHash = stateHash;
}

function record(value: unknown): Record<string, unknown> {
  assert.ok(value && typeof value === "object" && !Array.isArray(value));
  return value as Record<string, unknown>;
}

function expectError(
  operation: () => unknown,
  code: string,
  path: string,
): void {
  assert.throws(operation, (error: unknown) => (
    error instanceof GameReadSnapshotErrorV1
    && error.code === code
    && error.path === path
  ));
}

function expectAnySnapshotError(operation: () => unknown): void {
  assert.throws(
    operation,
    (error: unknown) => error instanceof GameReadSnapshotErrorV1,
  );
}

function digest(value: unknown): string {
  return sha256Canonical({ value });
}
