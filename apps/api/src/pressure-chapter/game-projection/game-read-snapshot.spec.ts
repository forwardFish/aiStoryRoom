import assert from "node:assert/strict";
import test from "node:test";
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
  decodePressureMvpDecisionStateV1,
} from "../persistence/mvp-decision-state";
import type { StoredRunRouteRecordV1 } from "../run-router";
import type {
  SeatAuthorityRecordV1,
  SeatControlSnapshotV1,
} from "../seat-control/types";
import {
  withWorkingLedgerProjectionCacheHashV1,
} from "../working-ledger/projection-cache";
import type { WorkingLedgerProjectionV1 } from "../working-ledger/contracts";
import { workingStateHash } from "../working-ledger/working-ledger";
import type {
  ProjectPressureChapterGameProjectionFromSourcesV1,
} from "./contracts";
import {
  decodeGameReadSnapshotV1,
  GAME_READ_SNAPSHOT_ERROR_CODES,
  GameReadSnapshotErrorV1,
  PRESSURE_GAME_READ_SNAPSHOT_RAW_ROW_SCHEMA_V1,
  PRESSURE_GAME_READ_SNAPSHOT_REQUEST_SCHEMA_V1,
  type GameReadP0ResolvedSourcesV1,
  type GameReadSnapshotRawRowV1,
  type GameReadSnapshotRequestV1,
} from "./game-read-snapshot";

const VIEWER: SeatIdV1 = "cabinet_finance";
const NOW = "2026-08-14T07:00:00.000Z";

test("decodes one complete row without reference leakage and delegates Feed page projection byte-for-byte", () => {
  const fixture = makeFixture();
  const snapshot = decodeGameReadSnapshotV1([fixture.row], fixture.request);
  const expectedFeed = projectAEmotionFeedPageV1(
    feedRequest(fixture),
    fixture.feedRows,
  );

  assert.equal(snapshot.schemaVersion, "pressure_game_read_snapshot_v1");
  assert.equal(snapshot.sources.runId, fixture.request.runId);
  assert.equal(snapshot.sources.viewerSeatId, VIEWER);
  assert.deepEqual(snapshot.sources.feedPage, expectedFeed);
  assert.equal(JSON.stringify(snapshot.sources.feedPage), JSON.stringify(expectedFeed));
  assert.equal(Object.isFrozen(snapshot), true);
  assert.equal(Object.isFrozen(snapshot.sources), true);
  assert.equal(Object.isFrozen(snapshot.sources.viewerSource), true);
  assert.equal(Object.isFrozen(snapshot.authority), true);

  const originalGoal = snapshot.sources.viewerSource.situation.goal;
  record(fixture.row.viewerSource).situation = {
    goal: "mutated",
    risk: "mutated",
    judgment: "mutated",
  };
  assert.equal(snapshot.sources.viewerSource.situation.goal, originalGoal);

  assert.equal("chapterSource" in snapshot.sources, false);
  if (!("chapterSource" in snapshot.sources)) {
    const acceptedActions = snapshot.sources.workingProjection.acceptedActions;
    assert.throws(
      () => acceptedActions.set("x", {} as never),
      /READ_ONLY_GAME_READ_SNAPSHOT/u,
    );
    const accepted = acceptedActions.values().next().value;
    if (accepted) assert.equal(Object.isFrozen(accepted), true);
  }
});

test("CHAPTER sources are the exact existing projector input and P0 exposes the one narrow M3 branch", () => {
  const dynamicFixture = makeFixture({ chapterId: "N2" });
  const dynamic = decodeGameReadSnapshotV1([dynamicFixture.row], dynamicFixture.request);
  assert.equal("chapterSource" in dynamic.sources, false);
  if (!("chapterSource" in dynamic.sources)) {
    const existingProjectorInput: ProjectPressureChapterGameProjectionFromSourcesV1 =
      dynamic.sources;
    assert.equal(existingProjectorInput.chapter.currentChapterId, "N2");
  }

  const p0Fixture = makeFixture({ chapterId: "P0" });
  const p0 = decodeGameReadSnapshotV1([p0Fixture.row], p0Fixture.request);
  assert.equal("chapterSource" in p0.sources, true);
  if ("chapterSource" in p0.sources) {
    const futureP0Input: GameReadP0ResolvedSourcesV1 = p0.sources;
    assert.equal(futureP0Input.chapterSource.chapter.chapterId, "P0");
    assert.equal(futureP0Input.chapterSource.decision, null);
  }
});

test("supports P0 and N1-N7 without an N1-only decoder branch", () => {
  for (const chapterId of ["P0", "N1", "N2", "N3", "N4", "N5", "N6", "N7"] as const) {
    const fixture = makeFixture({ chapterId });
    const snapshot = decodeGameReadSnapshotV1([fixture.row], fixture.request);
    if (chapterId === "P0") {
      assert.equal("chapterSource" in snapshot.sources, true);
      assert.equal(snapshot.authority.chapter.kind, "P0");
    } else {
      assert.equal("chapterSource" in snapshot.sources, false);
      assert.equal(snapshot.authority.chapter.kind, "CHAPTER");
      if (!("chapterSource" in snapshot.sources)) {
        assert.equal(snapshot.sources.chapter.currentChapterId, chapterId);
      }
    }
  }
});

test("supports all six seats and SOLO/TARGETED/SYNC descriptor inputs", () => {
  const modes = ["SOLO_BEAT", "TARGETED_INTERACTION", "SYNC_CONTEST"] as const;
  for (const [index, viewerSeatId] of PRESSURE_CHAPTER_SEAT_IDS_V1.entries()) {
    const fixture = makeFixture({
      viewerSeatId,
      decisionMode: modes[index % modes.length],
    });
    const snapshot = decodeGameReadSnapshotV1([fixture.row], fixture.request);
    assert.equal(snapshot.sources.viewerSeatId, viewerSeatId);
    assert.equal(snapshot.authority.viewer.seatId, viewerSeatId);
    assert.equal(snapshot.authority.capabilityInputs.viewerControl.controlEpoch, 2);
  }
});

test("missing or duplicate aggregate and membership rows fail closed", () => {
  const fixture = makeFixture();
  expectError(
    () => decodeGameReadSnapshotV1([], fixture.request),
    GAME_READ_SNAPSHOT_ERROR_CODES.ROW_COUNT_INVALID,
    "rows",
  );
  expectError(
    () => decodeGameReadSnapshotV1([fixture.row, fixture.row], fixture.request),
    GAME_READ_SNAPSHOT_ERROR_CODES.ROW_COUNT_INVALID,
    "rows",
  );

  const missingMembership = makeFixture();
  missingMembership.row.membershipRows = [];
  expectError(
    () => decodeGameReadSnapshotV1([missingMembership.row], missingMembership.request),
    GAME_READ_SNAPSHOT_ERROR_CODES.ROW_COUNT_INVALID,
    "row.membershipRows",
  );

  const duplicateMembership = makeFixture();
  const membership = duplicateMembership.row.membershipRows as unknown[];
  duplicateMembership.row.membershipRows = [membership[0], structuredClone(membership[0])];
  expectError(
    () => decodeGameReadSnapshotV1([duplicateMembership.row], duplicateMembership.request),
    GAME_READ_SNAPSHOT_ERROR_CODES.ROW_COUNT_INVALID,
    "row.membershipRows",
  );
});

test("run, room, subject, seat, route, chapterRuntimeId and chapterId scope mismatches fail closed", () => {
  const cases: Array<[string, (fixture: FixtureV1) => void]> = [
    ["room", (fixture) => { fixture.request.roomId = "other-room"; }],
    ["run", (fixture) => { membershipRow(fixture).runId = "other-run"; }],
    ["subject", (fixture) => { membershipRow(fixture).userId = "other-user"; }],
    ["seat", (fixture) => { membershipRow(fixture).roleKey = "zhejiang_governor"; }],
    ["route", (fixture) => { record(fixture.row.viewerSource).routeHash = digest("other-route"); }],
    ["chapterRuntimeId", (fixture) => { dynamicRuntime(fixture).id = "other-runtime"; }],
    ["chapterId", (fixture) => { dynamicRuntime(fixture).chapterId = "N3"; }],
  ];
  for (const [name, mutate] of cases) {
    const fixture = makeFixture();
    mutate(fixture);
    assert.throws(
      () => decodeGameReadSnapshotV1([fixture.row], fixture.request),
      (error: unknown) => error instanceof GameReadSnapshotErrorV1,
      name,
    );
  }
});

test("route snapshot hash, content pins and control topology stay bound to existing validators", () => {
  const routeHash = makeFixture();
  const stored = routeHash.row.routeRecord as StoredRunRouteRecordV1;
  stored.snapshot.routeHash = digest("tampered-route-hash");
  expectAnySnapshotError(() => decodeGameReadSnapshotV1([routeHash.row], routeHash.request));

  const content = makeFixture();
  dynamicRuntime(content).contentHash = digest("wrong-content");
  expectAnySnapshotError(() => decodeGameReadSnapshotV1([content.row], content.request));

  const topology = makeFixture();
  const seatSnapshot = seatSnapshotJson(topology);
  seatSnapshot.initialTopologyHash = digest("wrong-topology");
  resealSeatAuthority(topology);
  expectAnySnapshotError(() => decodeGameReadSnapshotV1([topology.row], topology.request));
});

test("orchestrator revision and Working revision/head/state/cache bindings fail closed", () => {
  const cases: Array<[string, (fixture: FixtureV1) => void]> = [
    ["orchestrator-history", (fixture) => { dynamicOrchestrator(fixture).distinctRevisionCount = 5; }],
    ["working-revision", (fixture) => { dynamicRuntime(fixture).workingRevision = 4; }],
    ["ledger-head-sequence", (fixture) => { dynamicRuntime(fixture).ledgerHeadSequence = 5; }],
    ["ledger-head-hash", (fixture) => { dynamicRuntime(fixture).ledgerHeadHash = digest("other-head"); }],
    ["working-state-hash", (fixture) => { dynamicRuntime(fixture).workingStateHash = digest("other-state"); }],
    ["cache-hash", (fixture) => {
      const cache = workingCache(fixture);
      cache.projectionCacheHash = digest("wrong-cache-hash");
    }],
    ["descriptor-cache-binding", (fixture) => {
      mutateWorkingCache(fixture, (cache) => {
        cache.chapterDefinitionHash = digest("wrong-definition");
      });
    }],
  ];
  for (const [name, mutate] of cases) {
    const fixture = makeFixture();
    mutate(fixture);
    assert.throws(
      () => decodeGameReadSnapshotV1([fixture.row], fixture.request),
      (error: unknown) => error instanceof GameReadSnapshotErrorV1,
      name,
    );
  }
});

test("decision state is decoded only by decodePressureMvpDecisionStateV1 then cross-bound", () => {
  const fixture = makeFixture();
  const runtime = dynamicRuntime(fixture);
  const direct = decodePressureMvpDecisionStateV1(runtime.decisionStateJson);
  const snapshot = decodeGameReadSnapshotV1([fixture.row], fixture.request);
  assert.equal(snapshot.authority.chapter.kind, "CHAPTER");
  if (snapshot.authority.chapter.kind === "CHAPTER") {
    assert.deepEqual(snapshot.authority.chapter.decisionState, direct);
  }

  const corruptHash = makeFixture();
  record(dynamicRuntime(corruptHash).decisionStateJson).decisionStateHash = digest("corrupt");
  expectError(
    () => decodeGameReadSnapshotV1([corruptHash.row], corruptHash.request),
    GAME_READ_SNAPSHOT_ERROR_CODES.DECISION_STATE_INVALID,
    "row.chapterAuthority.runtime.decisionStateJson",
  );

  const validButCrossScoped = makeFixture();
  const current = decodePressureMvpDecisionStateV1(
    dynamicRuntime(validButCrossScoped).decisionStateJson,
  );
  dynamicRuntime(validButCrossScoped).decisionStateJson =
    buildPressureMvpDecisionStateV1({
      workingRevision: current.workingRevision + 1,
      pin: current.pin,
      requiredSeatIds: current.requiredSeatIds,
      policyHash: current.policyHash,
      orchestratorHash: current.orchestratorHash,
    });
  expectAnySnapshotError(() =>
    decodeGameReadSnapshotV1([validButCrossScoped.row], validButCrossScoped.request));
});

test("decisionState pin is canonical-deep-equal to the Working nextDecisionPin", () => {
  const exact = makeFixture();
  assert.doesNotThrow(() => decodeGameReadSnapshotV1([exact.row], exact.request));

  const fingerprintDrift = makeFixture();
  const fingerprintState = decodePressureMvpDecisionStateV1(
    dynamicRuntime(fingerprintDrift).decisionStateJson,
  );
  assert.ok(fingerprintState.pin);
  const fingerprintPin = structuredClone(fingerprintState.pin);
  fingerprintPin.stateFingerprint = digest("decision-pin-state-fingerprint-drift");
  dynamicRuntime(fingerprintDrift).decisionStateJson =
    buildPressureMvpDecisionStateV1({
      workingRevision: fingerprintState.workingRevision,
      pin: fingerprintPin,
      requiredSeatIds: fingerprintState.requiredSeatIds,
      policyHash: fingerprintState.policyHash,
      orchestratorHash: fingerprintState.orchestratorHash,
    });
  expectError(
    () => decodeGameReadSnapshotV1([fingerprintDrift.row], fingerprintDrift.request),
    GAME_READ_SNAPSHOT_ERROR_CODES.DECISION_STATE_INVALID,
    "row.chapterAuthority.runtime.decisionStateJson",
  );

  const optionDrift = makeFixture();
  const optionState = decodePressureMvpDecisionStateV1(
    dynamicRuntime(optionDrift).decisionStateJson,
  );
  assert.ok(optionState.pin);
  const optionPin = structuredClone(optionState.pin);
  optionPin.optionIds = [...optionPin.optionIds, "ALTERNATE"];
  dynamicRuntime(optionDrift).decisionStateJson =
    buildPressureMvpDecisionStateV1({
      workingRevision: optionState.workingRevision,
      pin: optionPin,
      requiredSeatIds: optionState.requiredSeatIds,
      policyHash: optionState.policyHash,
      orchestratorHash: optionState.orchestratorHash,
    });
  expectError(
    () => decodeGameReadSnapshotV1([optionDrift.row], optionDrift.request),
    GAME_READ_SNAPSHOT_ERROR_CODES.DECISION_STATE_INVALID,
    "row.chapterAuthority.runtime.decisionStateJson",
  );
});

test("seat epoch/fences and private projection audience/hash fail closed", () => {
  const epoch = makeFixture();
  viewerControl(epoch).controlEpoch = 3;
  expectAnySnapshotError(() => decodeGameReadSnapshotV1([epoch.row], epoch.request));

  const submitFence = makeFixture();
  viewerControl(submitFence).submissionFenceToken = digest("wrong-submit-fence");
  expectAnySnapshotError(() => decodeGameReadSnapshotV1([submitFence.row], submitFence.request));

  const missingSubmitFence = makeFixture();
  viewerControl(missingSubmitFence).submissionFenceToken = null;
  expectAnySnapshotError(() =>
    decodeGameReadSnapshotV1([missingSubmitFence.row], missingSubmitFence.request));

  const privateAudience = makeFixture();
  record(privateAudience.row.viewerPrivateProjection).seatId = "zhejiang_governor";
  expectAnySnapshotError(() =>
    decodeGameReadSnapshotV1([privateAudience.row], privateAudience.request));

  const privateHash = makeFixture();
  record(privateHash.row.viewerPrivateProjection).payloadHash = digest("wrong-private-hash");
  expectAnySnapshotError(() =>
    decodeGameReadSnapshotV1([privateHash.row], privateHash.request));
});

test("narrative scope and existing artifact validator bindings fail closed without copied authority-pair rules", () => {
  const viewer = makeFixture();
  narrativeSource(viewer).viewerSeatId = "zhejiang_governor";
  expectAnySnapshotError(() => decodeGameReadSnapshotV1([viewer.row], viewer.request));

  const chapter = makeFixture();
  narrativeSource(chapter).chapterRuntimeId = "other-runtime";
  expectAnySnapshotError(() => decodeGameReadSnapshotV1([chapter.row], chapter.request));

  const authority = makeFixture();
  narrativeSource(authority).sourceAuthority = "UNSUPPORTED";
  expectAnySnapshotError(() => decodeGameReadSnapshotV1([authority.row], authority.request));

  const artifactHash = makeFixture();
  narrativeArtifact(artifactHash).contentHash = digest("wrong-artifact-content");
  expectError(
    () => decodeGameReadSnapshotV1([artifactHash.row], artifactHash.request),
    GAME_READ_SNAPSHOT_ERROR_CODES.NARRATIVE_INVALID,
    "row.narrativeAuthority.artifactJson",
  );

  const status = makeFixture();
  narrativeSource(status).status = "FALLBACK_PUBLISHED";
  expectAnySnapshotError(() => decodeGameReadSnapshotV1([status.row], status.request));
});

test("world metric track ids are the exact TRACK_IDS_V1 set", () => {
  const exact = makeFixture();
  assert.doesNotThrow(() => decodeGameReadSnapshotV1([exact.row], exact.request));

  const unknown = makeFixture();
  worldMetrics(unknown)[0]!.trackId = "track.unknown";
  expectError(
    () => decodeGameReadSnapshotV1([unknown.row], unknown.request),
    GAME_READ_SNAPSHOT_ERROR_CODES.FIELD_INVALID,
    "row.worldAuthority.source.metrics[0].trackId",
  );

  const duplicate = makeFixture();
  const duplicateMetrics = worldMetrics(duplicate);
  duplicateMetrics[1]!.trackId = duplicateMetrics[0]!.trackId;
  expectError(
    () => decodeGameReadSnapshotV1([duplicate.row], duplicate.request),
    GAME_READ_SNAPSHOT_ERROR_CODES.FIELD_INVALID,
    "row.worldAuthority.source.metrics.trackId",
  );

  const missing = makeFixture();
  worldMetrics(missing).pop();
  expectError(
    () => decodeGameReadSnapshotV1([missing.row], missing.request),
    GAME_READ_SNAPSHOT_ERROR_CODES.FIELD_INVALID,
    "row.worldAuthority.source.metrics",
  );
});

test("resources, tokens and situation reject invalid values, duplicates and cross-viewer drift", () => {
  const duplicateResource = makeFixture();
  const resources = record(duplicateResource.row.viewerSource).resources as unknown[];
  record(duplicateResource.row.viewerSource).resources = [
    ...resources,
    structuredClone(resources[0]),
  ];
  expectAnySnapshotError(() =>
    decodeGameReadSnapshotV1([duplicateResource.row], duplicateResource.request));

  const invalidToken = makeFixture();
  const tokens = record(invalidToken.row.viewerSource).tokens as Array<Record<string, unknown>>;
  tokens[0]!.quantity = -1;
  expectAnySnapshotError(() => decodeGameReadSnapshotV1([invalidToken.row], invalidToken.request));

  const situation = makeFixture();
  record(record(situation.row.viewerSource).situation).goal = "other-viewer-goal";
  expectAnySnapshotError(() => decodeGameReadSnapshotV1([situation.row], situation.request));
});

test("Feed request/page/cursor/order/flags are exactly the existing projectAEmotionFeedPageV1 result", () => {
  const fixture = makeFixture({ feedLimit: 2 });
  const first = decodeGameReadSnapshotV1([fixture.row], fixture.request);
  const directFirst = projectAEmotionFeedPageV1(feedRequest(fixture), fixture.feedRows);
  assert.deepEqual(first.sources.feedPage, directFirst);
  assert.equal(first.sources.feedPage.items.length, 2);
  assert.equal(first.sources.feedPage.unreadCount, 2);
  assert.equal(first.sources.feedPage.serverSequence, 30);
  assert.ok(first.sources.feedPage.nextCursor);
  assert.equal(first.sources.feedPage.items[0]!.eventId, "feed-event-10");
  assert.equal(first.sources.feedPage.items[1]!.eventId, "feed-event-30");
  assert.equal(first.sources.feedPage.items[0]!.isUnread, false);
  assert.equal(first.sources.feedPage.items[0]!.isAcknowledged, true);
  assert.equal(first.sources.feedPage.items[1]!.isUnread, true);

  const cursorFixture = makeFixture({ feedLimit: 2 });
  cursorFixture.request.feedCursor = first.sources.feedPage.nextCursor;
  const next = decodeGameReadSnapshotV1([cursorFixture.row], cursorFixture.request);
  const directNext = projectAEmotionFeedPageV1(
    feedRequest(cursorFixture),
    cursorFixture.feedRows,
  );
  assert.deepEqual(next.sources.feedPage, directNext);
  assert.equal(JSON.stringify(next.sources.feedPage), JSON.stringify(directNext));

  const malformed = makeFixture();
  malformed.request.feedCursor = "not-a-feed-cursor";
  expectError(
    () => decodeGameReadSnapshotV1([malformed.row], malformed.request),
    GAME_READ_SNAPSHOT_ERROR_CODES.FEED_INVALID,
    "row.feedAuthority",
  );
});

test("Feed authority requires exact viewer aggregate+delivery identities and valid projection hashes", () => {
  const aggregateScope = makeFixture();
  feedAggregate(aggregateScope, 0).runId = "other-run";
  expectAnySnapshotError(() =>
    decodeGameReadSnapshotV1([aggregateScope.row], aggregateScope.request));

  const delivery = makeFixture();
  feedDelivery(delivery, 0).projectionVersion = 2;
  expectAnySnapshotError(() => decodeGameReadSnapshotV1([delivery.row], delivery.request));

  const projectionHash = makeFixture();
  feedProjection(projectionHash, 0).projectionHash = digest("wrong-projection-hash");
  expectAnySnapshotError(() =>
    decodeGameReadSnapshotV1([projectionHash.row], projectionHash.request));

  const duplicate = makeFixture();
  const rows = feedAuthorityRows(duplicate);
  record(duplicate.row.feedAuthority).rows = [rows[0], structuredClone(rows[0])];
  expectAnySnapshotError(() => decodeGameReadSnapshotV1([duplicate.row], duplicate.request));
});

test("A-Emotion aggregate root follows existing v1 root and v2+ disclosure semantics", () => {
  const v1RootDrift = makeFixture();
  feedAggregate(v1RootDrift, 0).aggregationKey = aEmotionAggregationKey({
    roomId: v1RootDrift.request.roomId,
    runId: v1RootDrift.request.runId,
    viewerSeatId: viewerSeatId(v1RootDrift),
    eventId: "different-v1-root",
  });
  expectError(
    () => decodeGameReadSnapshotV1([v1RootDrift.row], v1RootDrift.request),
    GAME_READ_SNAPSHOT_ERROR_CODES.FEED_INVALID,
    "row.feedAuthority.rows[0].aggregate",
  );

  const evolved = makeFixture({ feedLimit: 3 });
  const original = evolved.feedRows[0]!;
  const rootAggregationKey = original.aggregate.aggregationKey;
  const latestEventId = `${original.aggregate.projection.eventId}:suspected`;
  const { projectionHash: _priorHash, ...priorBody } = original.aggregate.projection;
  const evolvedProjectionBody = {
    ...priorBody,
    eventId: latestEventId,
    projectionVersion: 2,
    disclosure: "SUSPECTED" as const,
    visibleSuspectedSeatIds: ["zhejiang_governor" as SeatIdV1],
  };
  const evolvedProjection = {
    ...evolvedProjectionBody,
    projectionHash: sha256Canonical(evolvedProjectionBody),
  };
  const evolvedRow = {
    aggregate: {
      ...original.aggregate,
      aggregationKey: rootAggregationKey,
      latestEventId,
      projectionVersion: 2,
      projection: evolvedProjection,
      updatedAt: NOW,
    },
    delivery: {
      ...original.delivery,
      eventId: latestEventId,
      projectionVersion: 2,
    },
  };
  evolved.feedRows[0] = structuredClone(evolvedRow);
  feedAuthorityRows(evolved)[0] = structuredClone(evolvedRow);

  const snapshot = decodeGameReadSnapshotV1([evolved.row], evolved.request);
  const direct = projectAEmotionFeedPageV1(feedRequest(evolved), evolved.feedRows);
  assert.equal(evolvedRow.aggregate.aggregationKey, rootAggregationKey);
  assert.notEqual(latestEventId, JSON.parse(rootAggregationKey)[3]);
  assert.deepEqual(snapshot.sources.feedPage, direct);
  assert.equal(JSON.stringify(snapshot.sources.feedPage), JSON.stringify(direct));
  assert.ok(snapshot.sources.feedPage.items.some((item) => (
    item.eventId === latestEventId
    && item.projectionVersion === 2
    && item.disclosure === "SUSPECTED"
  )));
});

test("capability authority output contains existing inputs only and never recomputes final capability booleans", () => {
  const fixture = makeFixture();
  const snapshot = decodeGameReadSnapshotV1([fixture.row], fixture.request);
  const capabilityInputs = snapshot.authority.capabilityInputs;
  assert.deepEqual(Object.keys(capabilityInputs).sort(), [
    "chapterPhase",
    "decisionState",
    "viewerControl",
  ]);
  assert.equal("canSubmitDecision" in capabilityInputs, false);
  assert.equal("allowedActionTypes" in capabilityInputs, false);
  assert.equal(capabilityInputs.viewerControl.controlEpoch, 2);
  assert.equal(capabilityInputs.chapterPhase, "ACTIVE");
  assert.equal(capabilityInputs.decisionState?.state, "OPEN");
});

test("decoded output excludes Provider raw data, SQL text, credentials and all non-viewer seat private authority", () => {
  const fixture = makeFixture();
  const row = record(fixture.row);
  row.providerRaw = { prompt: "private" };
  expectError(
    () => decodeGameReadSnapshotV1([fixture.row], fixture.request),
    GAME_READ_SNAPSHOT_ERROR_CODES.FIELD_INVALID,
    "row.providerRaw",
  );

  const clean = makeFixture();
  const snapshot = decodeGameReadSnapshotV1([clean.row], clean.request);
  const serialized = JSON.stringify(snapshot);
  for (const forbidden of [
    "providerRaw",
    "SELECT ",
    "DATABASE_URL",
    "password",
    "cookie",
    "Bearer ",
    "privatePayload",
    "pressure-ai:zhejiang_governor",
  ]) {
    assert.equal(serialized.includes(forbidden), false, forbidden);
  }
  assert.equal(snapshot.authority.viewer.seatId, VIEWER);
});

test("existing Orchestrator, descriptor and Working cache validators own nested authority shape", () => {
  const orchestrator = makeFixture();
  record(dynamicOrchestrator(orchestrator).latestState).unexpected = true;
  expectError(
    () => decodeGameReadSnapshotV1([orchestrator.row], orchestrator.request),
    GAME_READ_SNAPSHOT_ERROR_CODES.CHAPTER_AUTHORITY_INVALID,
    "row.chapterAuthority.orchestrator.latestState",
  );

  const descriptor = makeFixture();
  record(dynamicRoot(descriptor).descriptor).unexpected = true;
  expectError(
    () => decodeGameReadSnapshotV1([descriptor.row], descriptor.request),
    GAME_READ_SNAPSHOT_ERROR_CODES.CHAPTER_AUTHORITY_INVALID,
    "row.chapterAuthority.descriptor",
  );

  const cache = makeFixture();
  mutateWorkingCache(cache, (value) => {
    value.headSequence = -1;
  });
  expectError(
    () => decodeGameReadSnapshotV1([cache.row], cache.request),
    GAME_READ_SNAPSHOT_ERROR_CODES.CHAPTER_AUTHORITY_INVALID,
    "row.chapterAuthority.runtime.ledgerProjectionJson",
  );
});

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
