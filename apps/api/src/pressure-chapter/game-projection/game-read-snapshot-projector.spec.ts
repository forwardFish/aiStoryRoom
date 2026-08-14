import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import {
  PRESSURE_CHAPTER_SEAT_IDS_V1,
  TRACK_IDS_V1,
  sha256Canonical,
  type ChapterIdV1,
  type ParticipantModeV1,
  type SeatIdV1,
  type TrackIdV1,
} from "@ai-story/shared";
import {
  PRESSURE_CHAPTER_ROUTE_REGISTRY_SCHEMA_V1,
  PRESSURE_CHAPTER_ROUTE_TUPLE_V1,
  PressureChapterRouteRegistry,
  computePressureChapterRouteRegistryHash,
  type PressureChapterRouteRegistryV1,
} from "@ai-story/templates";
import {
  PressureChapterRunRouterService,
  type RunRouteRepositoryPort,
  type StoredRunRouteRecordV1,
} from "../run-router";
import type {
  AuthoredChapterRuntimeV1,
  ChapterOrchestratorStateV1,
} from "../orchestrator/contracts";
import type { WorkingLedgerProjectionV1 } from "../working-ledger/contracts";
import {
  type AEmotionFeedPagePortV1,
  type PressureChapterGameProjectionV1,
  type PressureGameCapabilitiesV1,
  type PressureGameChapterReaderPort,
  type PressureGameChapterSourceV1,
  type PressureGameDecisionProjectionV1,
  type PressureGameMetricProjectionV1,
  type PressureGameNarrativeSourceV1,
  type PressureGameViewerSourceV1,
  type PressureGameWorldSourceV1,
  type ProjectPressureChapterGameProjectionFromSourcesV1,
} from "./contracts";
import {
  PRESSURE_GAME_PROJECTION_ERROR_CODES,
  PressureGameProjectionError,
} from "./errors";
import {
  PressureTurnPresentationServiceV1,
  type PressureTurnPresentationContextV1,
  type PressureTurnPresentationProviderPortV1,
} from "./decision-presentation";
import type {
  GameReadP0ResolvedSourcesV1,
  GameReadSnapshotV1,
} from "./game-read-snapshot";
import { PressureChapterGameProjectionService } from "./game-projection.service";

const digest = (label: string): string => sha256Canonical({ label });

type DynamicChapterIdV1 = Extract<
  ChapterIdV1,
  "N1" | "N2" | "N3" | "N4" | "N5" | "N6" | "N7"
>;
type DecisionModeV1 = NonNullable<PressureGameDecisionProjectionV1>["mode"];
type NarrativeVariantV1 =
  | "GENESIS_PUBLISHED"
  | "BEAT_PUBLISHED"
  | "BEAT_PENDING"
  | "CHAPTER_FALLBACK"
  | "CHAPTER_PENDING";

type MatrixRowV1 = Readonly<{
  name: string;
  viewerSeatId: SeatIdV1;
  participantMode: ParticipantModeV1;
  chapterId: "P0" | DynamicChapterIdV1;
  decisionMode: DecisionModeV1;
  narrativeVariant: NarrativeVariantV1;
}>;

const MATRIX: readonly MatrixRowV1[] = [
  {
    name: "P0 / first seat / SOLO / Genesis fallback",
    viewerSeatId: PRESSURE_CHAPTER_SEAT_IDS_V1[0],
    participantMode: "SOLO",
    chapterId: "P0",
    decisionMode: "SOLO_BEAT",
    narrativeVariant: "CHAPTER_FALLBACK",
  },
  {
    name: "N1 / second seat / TARGETED / Genesis published",
    viewerSeatId: PRESSURE_CHAPTER_SEAT_IDS_V1[1],
    participantMode: "MULTIPLAYER",
    chapterId: "N1",
    decisionMode: "TARGETED_INTERACTION",
    narrativeVariant: "GENESIS_PUBLISHED",
  },
  {
    name: "N2 / third seat / SYNC / Beat pending",
    viewerSeatId: PRESSURE_CHAPTER_SEAT_IDS_V1[2],
    participantMode: "MULTIPLAYER",
    chapterId: "N2",
    decisionMode: "SYNC_CONTEST",
    narrativeVariant: "BEAT_PENDING",
  },
  {
    name: "N3 / first seat / SOLO decision / Beat published",
    viewerSeatId: PRESSURE_CHAPTER_SEAT_IDS_V1[0],
    participantMode: "MULTIPLAYER",
    chapterId: "N3",
    decisionMode: "SOLO_BEAT",
    narrativeVariant: "BEAT_PUBLISHED",
  },
  {
    name: "N4 / second seat / TARGETED / Chapter fallback",
    viewerSeatId: PRESSURE_CHAPTER_SEAT_IDS_V1[1],
    participantMode: "MULTIPLAYER",
    chapterId: "N4",
    decisionMode: "TARGETED_INTERACTION",
    narrativeVariant: "CHAPTER_FALLBACK",
  },
  {
    name: "N5 / third seat / SYNC / Chapter pending",
    viewerSeatId: PRESSURE_CHAPTER_SEAT_IDS_V1[2],
    participantMode: "MULTIPLAYER",
    chapterId: "N5",
    decisionMode: "SYNC_CONTEST",
    narrativeVariant: "CHAPTER_PENDING",
  },
  {
    name: "N6 / fourth seat / SOLO decision / Beat pending",
    viewerSeatId: PRESSURE_CHAPTER_SEAT_IDS_V1[3],
    participantMode: "MULTIPLAYER",
    chapterId: "N6",
    decisionMode: "SOLO_BEAT",
    narrativeVariant: "BEAT_PENDING",
  },
  {
    name: "N7 / fourth seat / SOLO decision / Chapter fallback",
    viewerSeatId: PRESSURE_CHAPTER_SEAT_IDS_V1[3],
    participantMode: "MULTIPLAYER",
    chapterId: "N7",
    decisionMode: "SOLO_BEAT",
    narrativeVariant: "CHAPTER_FALLBACK",
  },
  {
    name: "N2 / fifth seat / TARGETED / Beat published",
    viewerSeatId: PRESSURE_CHAPTER_SEAT_IDS_V1[4],
    participantMode: "MULTIPLAYER",
    chapterId: "N2",
    decisionMode: "TARGETED_INTERACTION",
    narrativeVariant: "BEAT_PUBLISHED",
  },
  {
    name: "N7 / sixth seat / SYNC / Chapter pending",
    viewerSeatId: PRESSURE_CHAPTER_SEAT_IDS_V1[5],
    participantMode: "MULTIPLAYER",
    chapterId: "N7",
    decisionMode: "SYNC_CONTEST",
    narrativeVariant: "CHAPTER_PENDING",
  },
];

test("M1 snapshot sources and the legacy resolved-source path converge byte-for-byte through the sole projector", async (context) => {
  for (const row of MATRIX) {
    await context.test(row.name, async () => {
      const harness = await createHarness(row);
      const snapshotRuntime = createServiceRuntime(harness);
      const replayRuntime = createServiceRuntime(harness);

      const snapshotProjection = await projectSnapshotSources(
        snapshotRuntime.service,
        harness.sources,
      );

      let replayProjection: PressureChapterGameProjectionV1;
      if ("chapterSource" in harness.sources) {
        replayProjection = await replayRuntime.service.read({
          runId: harness.runId,
          subjectId: harness.subjectId,
          feedCursor: harness.sources.feedCursor ?? null,
          feedLimit: harness.sources.feedLimit ?? 10,
        });
        assert.equal(snapshotRuntime.calls.projectCurrent, 0);
        assert.equal(replayRuntime.calls.projectCurrent, 0);
        assert.equal(replayRuntime.calls.readCurrent, 1);
        assert.deepEqual(snapshotRuntime.calls.feedList, []);
        assert.deepEqual(
          replayRuntime.calls.feedList,
          [expectedFeedListInput(harness)],
        );
      } else {
        const legacySql7Sources: ProjectPressureChapterGameProjectionFromSourcesV1 =
          harness.sources;
        const legacyRuntime = createServiceRuntime(harness);
        const ordinaryReplayRuntime = createServiceRuntime(harness);
        const legacySql7Projection = await legacyRuntime.service.projectFromResolvedSources(
          legacySql7Sources,
        );
        const ordinaryReplayProjection = await ordinaryReplayRuntime.service.read({
          runId: harness.runId,
          subjectId: harness.subjectId,
          feedCursor: harness.sources.feedCursor ?? null,
          feedLimit: harness.sources.feedLimit ?? 10,
        });
        replayProjection = await replayRuntime.service.readFromCommittedAuthority({
          runId: harness.sources.runId,
          subjectId: harness.sources.subjectId,
          roomId: harness.sources.roomId,
          routeSnapshot: harness.sources.routeSnapshot,
          viewerSeatId: harness.sources.viewerSeatId,
          chapter: harness.sources.chapter,
          workingProjection: harness.sources.workingProjection,
          chapterDescriptor: harness.sources.chapterDescriptor,
          ...(harness.sources.feedCursor === undefined
            ? {}
            : { feedCursor: harness.sources.feedCursor }),
          ...(harness.sources.feedLimit === undefined
            ? {}
            : { feedLimit: harness.sources.feedLimit }),
        });
        assertProjectionBytesEqual(legacySql7Projection, snapshotProjection);
        assertProjectionBytesEqual(ordinaryReplayProjection, snapshotProjection);
        assert.equal(snapshotRuntime.calls.projectCurrent, 1);
        assert.equal(legacyRuntime.calls.projectCurrent, 1);
        assert.equal(replayRuntime.calls.projectCurrent, 1);
        assert.equal(ordinaryReplayRuntime.calls.projectCurrent, 0);
        assert.equal(snapshotRuntime.calls.readCurrent, 0);
        assert.equal(legacyRuntime.calls.readCurrent, 0);
        assert.equal(replayRuntime.calls.readCurrent, 0);
        assert.equal(ordinaryReplayRuntime.calls.readCurrent, 1);
        assert.deepEqual(snapshotRuntime.calls.feedList, []);
        assert.deepEqual(legacyRuntime.calls.feedList, []);
        assert.deepEqual(
          replayRuntime.calls.feedList,
          [expectedFeedListInput(harness)],
        );
        assert.deepEqual(
          ordinaryReplayRuntime.calls.feedList,
          [expectedFeedListInput(harness)],
        );
      }

      assertProjectionBytesEqual(replayProjection, snapshotProjection);
      assert.equal(snapshotProjection.chapter.chapterId, row.chapterId);
      assert.equal(snapshotProjection.viewer.seatId, row.viewerSeatId);
      assert.equal(snapshotProjection.route.participantMode, row.participantMode);
      assert.equal(snapshotProjection.feedPage.nextCursor, harness.feedPage.nextCursor);
      assert.equal(snapshotProjection.feedPage.unreadCount, 13);
      assert.equal(snapshotProjection.feedPage.items.length, 1);
      assert.deepEqual(snapshotProjection.resources, harness.viewerSource.resources);
      assert.deepEqual(snapshotProjection.tokens, harness.viewerSource.tokens);
      assert.equal(snapshotProjection.narrative.status, harness.narrativeSource.status);
      assert.equal(
        snapshotProjection.decision?.mode ?? null,
        harness.chapterSource.decision?.mode ?? null,
      );
      assert.equal(
        snapshotProjection.capabilities.canSubmitDecision,
        row.chapterId === "P0" ? false : true,
      );
      assert.deepEqual(
        snapshotProjection.capabilities.allowedActionTypes,
        row.chapterId === "P0"
          ? []
          : [
              ...harness.chapterSource.decision!.options.map(
                (option) => option.actionType,
              ),
              "DEFAULT_PASS",
            ].sort(),
      );
      assert.equal(
        snapshotProjection.decision?.options.some(
          (option) => option.actionType === "DEFAULT_PASS",
        ) ?? false,
        false,
      );
      assert.equal(
        snapshotProjection.projectionHash,
        sha256Canonical(stripProjectionHash(snapshotProjection)),
      );
    });
  }
});

test("resolved-source projection preserves a production-style class receiver", async () => {
  const row = MATRIX.find((candidate) => candidate.chapterId === "N1");
  if (!row) throw new Error("I1 matrix is missing the required N1 row");
  const harness = await createHarness(row);
  const runtime = createServiceRuntime(harness);

  const projection = await projectSnapshotSources(runtime.service, harness.sources);

  assert.equal(projection.chapter.chapterId, "N1");
  assert.equal(runtime.calls.projectCurrent, 1);
});

test("latest turn presentation and turn-authority draft stay on the sole projector for all canonical seats", async (context) => {
  for (const viewerSeatId of PRESSURE_CHAPTER_SEAT_IDS_V1) {
    const row = MATRIX.find((candidate) =>
      candidate.viewerSeatId === viewerSeatId
      && candidate.chapterId !== "P0"
      && candidate.narrativeVariant !== "GENESIS_PUBLISHED"
    );
    if (!row) throw new Error(`I1 turn matrix is missing ${viewerSeatId}`);

    await context.test(viewerSeatId, async () => {
      const harness = await createHarness(row);
      if ("chapterSource" in harness.sources) {
        throw new Error("Turn fixture unexpectedly produced a P0 source");
      }

      const snapshotContexts: PressureTurnPresentationContextV1[] = [];
      const replayContexts: PressureTurnPresentationContextV1[] = [];
      const snapshotRuntime = createServiceRuntime(harness, {
        turnPresentations: makeTurnPresentationService(snapshotContexts),
      });
      const replayRuntime = createServiceRuntime(harness, {
        turnPresentations: makeTurnPresentationService(replayContexts),
      });

      const snapshotProjection = await snapshotRuntime.service.projectFromResolvedSources(
        harness.sources,
      );
      const replayProjection = await replayRuntime.service.projectFromResolvedSources(
        harness.sources,
      );

      assertProjectionBytesEqual(replayProjection, snapshotProjection);
      assert.equal(snapshotRuntime.calls.projectCurrent, 1);
      assert.equal(replayRuntime.calls.projectCurrent, 1);
      assert.equal(snapshotContexts.length, 1);
      assert.equal(replayContexts.length, 1);
      assert.deepEqual(snapshotContexts, replayContexts);

      const turn = snapshotContexts[0]!;
      assert.equal(turn.viewer.seatId, viewerSeatId);
      assert.equal(turn.authorityDraft.viewer.seatId, viewerSeatId);
      assert.equal(turn.authorityDraft.chapter.chapterRuntimeId, harness.chapterSource.chapter.chapterRuntimeId);
      assert.equal(turn.authorityDraft.narrativeSource.sourceId, harness.narrativeSource.sourceId);
      assert.deepEqual(
        turn.legalActionContracts.map((option) => option.actionType),
        harness.chapterSource.decision!.options.map((option) => option.actionType),
      );
      assert.ok(
        turn.authorityDraft.currentAuthorityState.some(
          (fact) => fact.factId === `resource.${harness.viewerSource.resources[0]!.resourceId}`,
        ),
      );
      for (const trackId of TRACK_IDS_V1) {
        assert.ok(
          turn.authorityDraft.currentAuthorityState.some(
            (fact) => fact.factId === `metric.${trackId}`,
          ),
        );
      }
      assert.equal(snapshotProjection.decision?.title, `当前抉择：${viewerSeatId}`);
      assert.match(snapshotProjection.decision?.summary ?? "", new RegExp(viewerSeatId, "u"));
      assert.deepEqual(
        snapshotProjection.decision?.options.map((option) => option.actionType),
        harness.chapterSource.decision!.options.map((option) => option.actionType),
      );
    });
  }
});

test("cross-viewer snapshot sources fail before the latest turn presentation can observe them", async () => {
  const row = MATRIX.find((candidate) => candidate.chapterId === "N4");
  if (!row) throw new Error("I1 matrix is missing the required N4 row");
  const harness = await createHarness(row);
  if ("chapterSource" in harness.sources) {
    throw new Error("Viewer-isolation fixture unexpectedly produced a P0 source");
  }
  const mismatched: ProjectPressureChapterGameProjectionFromSourcesV1 =
    structuredClone(harness.sources);
  mismatched.viewerSource.viewer.seatId = PRESSURE_CHAPTER_SEAT_IDS_V1.find(
    (seatId) => seatId !== row.viewerSeatId,
  )!;
  const observed: PressureTurnPresentationContextV1[] = [];
  const runtime = createServiceRuntime(harness, {
    turnPresentations: makeTurnPresentationService(observed),
  });

  await assert.rejects(
    () => runtime.service.projectFromResolvedSources(mismatched),
    (error: unknown) =>
      error instanceof PressureGameProjectionError
      && error.code === PRESSURE_GAME_PROJECTION_ERROR_CODES.SCOPE_MISMATCH
      && error.path === "chapter.viewerSeatId",
  );
  assert.equal(runtime.calls.projectCurrent, 1);
  assert.equal(observed.length, 0);
});

test("P0 uses chapterSource directly and source mismatches remain fail-closed", async () => {
  const row = MATRIX[0];
  if (!row) throw new Error("I1 matrix is missing the required P0 row");
  const harness = await createHarness(row);
  assert.equal("chapterSource" in harness.sources, true);
  if (!("chapterSource" in harness.sources)) {
    throw new Error("P0 fixture did not produce a P0 snapshot source");
  }
  const mismatched: GameReadP0ResolvedSourcesV1 = structuredClone(harness.sources);
  mismatched.chapterSource.viewerSeatId = PRESSURE_CHAPTER_SEAT_IDS_V1[1];
  const runtime = createServiceRuntime(harness);

  await assert.rejects(
    () => runtime.service.projectFromResolvedSources(mismatched),
    (error: unknown) =>
      error instanceof PressureGameProjectionError
      && error.code === PRESSURE_GAME_PROJECTION_ERROR_CODES.SCOPE_MISMATCH,
  );
  assert.equal(runtime.calls.projectCurrent, 0);
});

test("non-P0 chapterSource input is rejected before it can bypass projectCurrent", async () => {
  const dynamicRow = MATRIX.find((row) => row.chapterId === "N3");
  if (!dynamicRow) throw new Error("I1 matrix is missing the required N3 row");
  const harness = await createHarness(dynamicRow);
  if ("chapterSource" in harness.sources) {
    throw new Error("Dynamic fixture unexpectedly produced a P0 source");
  }
  const invalidSources = {
    ...structuredClone(harness.sources),
    chapterSource: structuredClone(harness.chapterSource),
  };
  const runtime = createServiceRuntime(harness);

  await assert.rejects(
    () => runtime.service.projectFromResolvedSources(invalidSources),
    (error: unknown) =>
      error instanceof PressureGameProjectionError
      && error.code === PRESSURE_GAME_PROJECTION_ERROR_CODES.INVALID_SOURCE
      && error.path === "chapterSource.chapter.chapterId"
      && error.detail === "P0_REQUIRED",
  );
  assert.equal(runtime.calls.projectCurrent, 0);
  assert.deepEqual(runtime.calls.feedList, []);
});

test("P0 needs no projectCurrent capability while the dynamic SQL7 contract keeps its legacy guard", async () => {
  const p0Row = MATRIX[0];
  const dynamicRow = MATRIX[1];
  if (!p0Row || !dynamicRow) throw new Error("I1 matrix is incomplete");

  const p0Harness = await createHarness(p0Row);
  const p0Runtime = createServiceRuntime(p0Harness, { includeProjectCurrent: false });
  const p0Projection = await projectSnapshotSources(p0Runtime.service, p0Harness.sources);
  assert.equal(p0Projection.chapter.chapterId, "P0");
  assert.equal(p0Runtime.calls.projectCurrent, 0);

  const dynamicHarness = await createHarness(dynamicRow);
  if ("chapterSource" in dynamicHarness.sources) {
    throw new Error("Dynamic fixture unexpectedly produced a P0 source");
  }
  const dynamicRuntime = createServiceRuntime(dynamicHarness, {
    includeProjectCurrent: false,
  });
  await assert.rejects(
    () => dynamicRuntime.service.projectFromResolvedSources(dynamicHarness.sources),
    (error: unknown) =>
      error instanceof PressureGameProjectionError
      && error.code === PRESSURE_GAME_PROJECTION_ERROR_CODES.INVALID_SOURCE
      && error.path === "chapterReader.projectCurrent"
      && error.detail === "CAPABILITY_REQUIRED",
  );
});

test("source inspection proves one I1 branch and no second sanitize/capability/hash/feed authority", () => {
  const source = readFileSync(
    join(
      process.cwd(),
      "apps/api/src/pressure-chapter/game-projection/game-projection.service.ts",
    ),
    "utf8",
  );
  const methodStart = source.indexOf("  async projectFromResolvedSources(");
  const methodEnd = source.indexOf("  private async readResolved(", methodStart);
  assert.notEqual(methodStart, -1);
  assert.notEqual(methodEnd, -1);
  const method = source.slice(methodStart, methodEnd);

  assert.equal(occurrences(method, 'if ("chapterSource" in query)'), 1);
  assert.equal(
    occurrences(method, 'query.chapterSource.chapter.chapterId !== "P0"'),
    1,
  );
  assert.equal(occurrences(method, '"P0_REQUIRED"'), 1);
  assert.ok(
    method.indexOf('query.chapterSource.chapter.chapterId !== "P0"')
      < method.indexOf("chapter = query.chapterSource;"),
  );
  assert.equal(occurrences(method, "chapter = this.chapters.projectCurrent({"), 1);
  assert.equal(occurrences(method, "const projectCurrent ="), 0);
  assert.equal(occurrences(method, "return this.projectResolvedSources({"), 1);
  assert.equal(occurrences(source, "  private async projectResolvedSources("), 1);
  assert.equal(occurrences(source, "function sanitizeNarrative("), 1);
  assert.equal(occurrences(source, "function sanitizeCapabilities("), 1);
  assert.equal(occurrences(source, "function sanitizeFeedPage("), 1);
  assert.equal(occurrences(source, "projectionHash: sha256Canonical(base)"), 1);
  assert.match(
    source,
    /import type \{ GameReadP0ResolvedSourcesV1 \} from "\.\/game-read-snapshot";/u,
  );
  assert.match(
    source,
    /import type \{ PressureTurnPresentationServiceV1 \} from "\.\/decision-presentation";/u,
  );
  assert.equal(occurrences(source, "private readonly turnPresentations:"), 1);
  assert.equal(occurrences(source, "fallbackDecision && this.turnPresentations"), 1);
  assert.equal(occurrences(source, "await this.turnPresentations.present({"), 1);
  assert.equal(occurrences(source, "decisionPresentations"), 0);
  const indexSource = readFileSync(
    join(process.cwd(), "apps/api/src/pressure-chapter/game-projection/index.ts"),
    "utf8",
  );
  assert.match(indexSource, /export \* from "\.\/turn-authority-draft";/u);
  assert.match(indexSource, /export \* from "\.\/game-read-snapshot";/u);
  assert.doesNotMatch(method, /readCurrent|readWorld|readViewer|readCapabilities|\.list\(/u);
  assert.doesNotMatch(
    source,
    /@prisma|PrismaClient|process\.env|@nestjs\/common|Controller|HttpException/u,
  );
});

async function projectSnapshotSources(
  service: PressureChapterGameProjectionService,
  sources: GameReadSnapshotV1["sources"],
): Promise<PressureChapterGameProjectionV1> {
  return service.projectFromResolvedSources(sources);
}

function assertProjectionBytesEqual(
  expected: PressureChapterGameProjectionV1,
  actual: PressureChapterGameProjectionV1,
): void {
  assert.deepEqual(actual, expected);
  assert.equal(actual.projectionHash, expected.projectionHash);
  assert.equal(JSON.stringify(actual), JSON.stringify(expected));
}

function stripProjectionHash(
  projection: PressureChapterGameProjectionV1,
): Omit<PressureChapterGameProjectionV1, "projectionHash"> {
  const { projectionHash, ...base } = projection;
  assert.equal(typeof projectionHash, "string");
  return base;
}

function occurrences(source: string, needle: string): number {
  return source.split(needle).length - 1;
}

interface HarnessV1 {
  runId: string;
  subjectId: string;
  route: StoredRunRouteRecordV1;
  sources: GameReadSnapshotV1["sources"];
  chapterSource: PressureGameChapterSourceV1;
  viewerSource: PressureGameViewerSourceV1;
  worldSource: PressureGameWorldSourceV1;
  narrativeSource: PressureGameNarrativeSourceV1;
  feedPage: AEmotionFeedPagePortV1;
  capabilities: PressureGameCapabilitiesV1;
}

async function createHarness(row: MatrixRowV1): Promise<HarnessV1> {
  const runId = `i1-projector-${row.viewerSeatId}-${row.chapterId}-${row.decisionMode}`;
  const subjectId = `subject:${row.viewerSeatId}`;
  const routeRepository = new InMemoryRouteRepository();
  const routeService = new PressureChapterRunRouterService(routeRepository, registry());
  const route = (
    await routeService.create({
      runId,
      routeKey: null,
      participantMode: row.participantMode,
      humanSeatIdsAtStart: row.participantMode === "SOLO"
        ? [row.viewerSeatId]
        : [...PRESSURE_CHAPTER_SEAT_IDS_V1],
      runSeed: `seed:${runId}`,
    })
  ).route;
  const chapterSource = makeChapterSource(row, runId, route.snapshot.routeHash);
  const viewerSource = makeViewerSource(row, runId, subjectId, route.snapshot.routeHash);
  const worldSource = makeWorldSource(runId, route.snapshot.routeHash);
  const narrativeSource = makeNarrativeSource(
    row,
    runId,
    route.snapshot.routeHash,
    chapterSource,
  );
  const feedPage = makeFeedPage(runId, row.viewerSeatId);
  const capabilities = makeCapabilities(chapterSource);
  const common = {
    runId,
    subjectId,
    roomId: runId,
    routeSnapshot: structuredClone(route.snapshot),
    viewerSeatId: row.viewerSeatId,
    viewerSource: structuredClone(viewerSource),
    worldSource: structuredClone(worldSource),
    narrativeSource: structuredClone(narrativeSource),
    feedPage: structuredClone(feedPage),
    feedCursor: "opaque:i1:cursor:request",
    feedLimit: 7,
  };

  let sources: GameReadSnapshotV1["sources"];
  if (row.chapterId === "P0") {
    sources = {
      ...common,
      chapterSource: structuredClone(chapterSource),
    } satisfies GameReadP0ResolvedSourcesV1;
  } else {
    const dynamic = makeDynamicAuthority(
      row.chapterId,
      runId,
      route.snapshot.routeHash,
      chapterSource.chapter.workingRevision,
      chapterSource.decision!,
    );
    sources = {
      ...common,
      chapter: dynamic.chapter,
      workingProjection: dynamic.workingProjection,
      chapterDescriptor: dynamic.chapterDescriptor,
    } satisfies ProjectPressureChapterGameProjectionFromSourcesV1;
  }

  return {
    runId,
    subjectId,
    route,
    sources,
    chapterSource,
    viewerSource,
    worldSource,
    narrativeSource,
    feedPage,
    capabilities,
  };
}

function createServiceRuntime(
  harness: HarnessV1,
  options: Readonly<{
    includeProjectCurrent?: boolean;
    turnPresentations?: PressureTurnPresentationServiceV1 | null;
  }> = {},
): {
  service: PressureChapterGameProjectionService;
  calls: {
    projectCurrent: number;
    readCurrent: number;
    feedList: Array<{
      roomId: string;
      runId: string;
      viewerSeatId: SeatIdV1;
      cursor: string | null;
      limit: number;
    }>;
  };
} {
  const calls = {
    projectCurrent: 0,
    readCurrent: 0,
    feedList: [] as Array<{
      roomId: string;
      runId: string;
      viewerSeatId: SeatIdV1;
      cursor: string | null;
      limit: number;
    }>,
  };
  class ReceiverBoundChapterReader implements PressureGameChapterReaderPort {
    private readonly mapper = {
      project: () => structuredClone(harness.chapterSource),
    };

    async readCurrent(): Promise<PressureGameChapterSourceV1> {
      calls.readCurrent += 1;
      return structuredClone(harness.chapterSource);
    }

    projectCurrent(
      input: Parameters<NonNullable<PressureGameChapterReaderPort["projectCurrent"]>>[0],
    ): PressureGameChapterSourceV1 {
      calls.projectCurrent += 1;
      if (!("chapterSource" in harness.sources)) {
        assert.equal(input.runId, harness.sources.runId);
        assert.equal(input.routeHash, harness.sources.routeSnapshot.routeHash);
        assert.equal(input.viewerSeatId, harness.sources.viewerSeatId);
        assert.equal(input.state.currentChapterId, harness.sources.chapter.currentChapterId);
        assert.equal(input.projection.key.runId, harness.sources.workingProjection.key.runId);
        assert.equal(
          input.chapter.descriptorHash,
          harness.sources.chapterDescriptor.descriptorHash,
        );
      }
      return this.mapper.project();
    }
  }
  const chapterReader: PressureGameChapterReaderPort = options.includeProjectCurrent === false
    ? {
        readCurrent: async () => {
          calls.readCurrent += 1;
          return structuredClone(harness.chapterSource);
        },
      }
    : new ReceiverBoundChapterReader();
  const service = new PressureChapterGameProjectionService(
    { readStoredRoute: async () => structuredClone(harness.route) },
    chapterReader,
    { readViewer: async () => structuredClone(harness.viewerSource) },
    { readWorld: async () => structuredClone(harness.worldSource) },
    { readCurrent: async () => structuredClone(harness.narrativeSource) },
    {
      list: async (input) => {
        calls.feedList.push(structuredClone(input));
        return structuredClone(harness.feedPage);
      },
    },
    { readCapabilities: async () => structuredClone(harness.capabilities) },
    options.turnPresentations ?? null,
  );
  return { service, calls };
}

function makeTurnPresentationService(
  contexts: PressureTurnPresentationContextV1[],
): PressureTurnPresentationServiceV1 {
  const provider: PressureTurnPresentationProviderPortV1 = {
    renderTurnPresentation: async (context) => {
      contexts.push(structuredClone(context));
      const sceneText = [
        `夜色压在厅门之外，${context.viewer.seatId}仍站在案前，没有让任何一句话替自己作出决定。`,
        "灯芯忽明忽暗，纸页上的旧痕与眼前的局势彼此牵连，却没有替谁证明最后的答案。",
        "在场的人都等着一个动作，既想看清立场，又不肯先承担由此而来的风险。",
        "他把已经确认的线索重新排开，只沿着当前可见的事实判断，不把传闻当成已经发生的结果。",
        "远处传来脚步声，时间没有停下，下一步必须由玩家自己选择。",
      ].join("").repeat(2);
      return {
        sceneText,
        question: `当前抉择：${context.viewer.seatId}`,
        options: context.legalActionContracts.map((option, index) => ({
          actionType: option.actionType,
          label: `选择${index + 1}`,
          description: `沿着当前线索采取第${index + 1}种行动，并保留对后续局势的判断空间。`,
        })),
        usedFactRefs: context.authorityDraft.currentAuthorityState
          .slice(0, 2)
          .map((fact) => fact.factId),
        claims: [],
      };
    },
  };
  return new PressureTurnPresentationServiceV1(provider);
}

function expectedFeedListInput(harness: HarnessV1): {
  roomId: string;
  runId: string;
  viewerSeatId: SeatIdV1;
  cursor: string | null;
  limit: number;
} {
  return {
    roomId: harness.sources.roomId,
    runId: harness.sources.runId,
    viewerSeatId: harness.sources.viewerSeatId,
    cursor: harness.sources.feedCursor ?? null,
    limit: harness.sources.feedLimit ?? 10,
  };
}

function makeChapterSource(
  row: MatrixRowV1,
  runId: string,
  routeHash: string,
): PressureGameChapterSourceV1 {
  const chapterNumber = row.chapterId === "P0" ? 0 : Number(row.chapterId.slice(1));
  const workingRevision = row.chapterId === "P0" || row.chapterId === "N1"
    ? 0
    : chapterNumber + 2;
  const decision: PressureGameDecisionProjectionV1 | null = row.chapterId === "P0"
    ? null
    : {
        decisionPointId: `decision:${runId}:${row.chapterId}`,
        mode: row.decisionMode,
        requirement: "REQUIRED",
        title: `Decision ${row.chapterId}`,
        summary: `Summary ${row.chapterId}`,
        expectedWorkingRevision: workingRevision,
        options: [
          {
            code: `OPTION_${row.chapterId}`,
            label: `Option ${row.chapterId}`,
            description: `Description ${row.chapterId}`,
            actionType: `ACTION_${row.chapterId}`,
            preferredEntry: row.decisionMode === "TARGETED_INTERACTION"
              ? "TALK"
              : row.decisionMode === "SYNC_CONTEST"
                ? "PLAN"
                : "INVESTIGATE",
          },
        ],
        submitLabel: "Submit",
        customActionAllowed: true,
      };
  return {
    runId,
    routeHash,
    viewerSeatId: row.viewerSeatId,
    projectionVersion: chapterNumber + 10,
    chapter: {
      chapterRuntimeId: `chapter-runtime:${runId}:${row.chapterId}`,
      chapterId: row.chapterId,
      chapterNumber,
      title: `Chapter ${row.chapterId}`,
      phase: row.chapterId === "P0" ? "FROZEN" : "ACTIVE",
      workingRevision,
    },
    decision,
  };
}

function makeViewerSource(
  row: MatrixRowV1,
  runId: string,
  subjectId: string,
  routeHash: string,
): PressureGameViewerSourceV1 {
  return {
    roomId: runId,
    runId,
    routeHash,
    subjectId,
    viewer: {
      seatId: row.viewerSeatId,
      roleName: `Role ${row.viewerSeatId}`,
      control: {
        mode: "HUMAN_ACTIVE",
        controlEpoch: 3,
        canSubmit: row.chapterId !== "P0",
        canReclaim: false,
        submissionFenceToken: row.chapterId === "P0"
          ? null
          : digest(`${runId}:submission-fence`),
        reclaimFenceToken: null,
      },
    },
    situation: {
      goal: `Goal ${row.viewerSeatId}`,
      risk: `Risk ${row.chapterId}`,
      judgment: `Judgment ${row.decisionMode}`,
    },
    resources: [
      {
        resourceId: `resource.${row.viewerSeatId}`,
        label: `Resource ${row.viewerSeatId}`,
        value: 17,
        displayValue: "17",
      },
    ],
    tokens: [
      {
        tokenId: `token.${row.viewerSeatId}`,
        label: `Token ${row.viewerSeatId}`,
        description: `Token description ${row.viewerSeatId}`,
        quantity: 2,
        available: true,
      },
    ],
  };
}

function makeWorldSource(runId: string, routeHash: string): PressureGameWorldSourceV1 {
  return {
    runId,
    routeHash,
    worldSequence: 7,
    worldStateHash: digest(`${runId}:world`),
    metrics: TRACK_IDS_V1.map((trackId, index) => metric(trackId, 40 + index)),
  };
}

function makeNarrativeSource(
  row: MatrixRowV1,
  runId: string,
  routeHash: string,
  chapterSource: PressureGameChapterSourceV1,
): PressureGameNarrativeSourceV1 {
  const common = {
    runId,
    routeHash,
    viewerSeatId: row.viewerSeatId,
    chapterRuntimeId: chapterSource.chapter.chapterRuntimeId,
    sourceId: `narrative:${runId}:${row.chapterId}`,
    sourceCommitHash: digest(`${runId}:narrative-commit`),
  };
  if (row.chapterId === "P0") {
    return {
      ...common,
      status: "FALLBACK_PUBLISHED",
      projectionKind: "GENESIS_NARRATIVE",
      sourceAuthority: "GENESIS_FROZEN",
      text: `Genesis fallback ${runId}`,
      contentHash: digest(`${runId}:genesis-content`),
      renderMode: "AUTHORED_FALLBACK",
    };
  }
  if (row.narrativeVariant === "GENESIS_PUBLISHED") {
    return {
      ...common,
      status: "PUBLISHED",
      projectionKind: "GENESIS_NARRATIVE",
      sourceAuthority: "GENESIS_FROZEN",
      text: `Genesis published ${runId}`,
      contentHash: digest(`${runId}:genesis-content`),
      renderMode: "PROVIDER",
    };
  }
  const chapterNarrative = row.narrativeVariant === "CHAPTER_FALLBACK"
    || row.narrativeVariant === "CHAPTER_PENDING";
  const pending = row.narrativeVariant === "BEAT_PENDING"
    || row.narrativeVariant === "CHAPTER_PENDING";
  return {
    ...common,
    status: pending
      ? "PENDING"
      : row.narrativeVariant === "CHAPTER_FALLBACK"
        ? "FALLBACK_PUBLISHED"
        : "PUBLISHED",
    projectionKind: chapterNarrative ? "CHAPTER_NARRATIVE" : "BEAT_NARRATIVE",
    sourceAuthority: chapterNarrative ? "CHAPTER_FROZEN" : "CHAPTER_WORKING",
    text: pending ? null : `Narrative ${runId}`,
    contentHash: pending ? null : digest(`${runId}:narrative-content`),
    renderMode: pending
      ? null
      : row.narrativeVariant === "CHAPTER_FALLBACK"
        ? "AUTHORED_FALLBACK"
        : "PROVIDER",
  };
}

function makeFeedPage(runId: string, viewerSeatId: SeatIdV1): AEmotionFeedPagePortV1 {
  const projection = {
    schemaVersion: "a_emotion_viewer_projection_v1" as const,
    eventId: `event:${runId}`,
    projectionVersion: 3,
    roomId: runId,
    runId,
    viewerSeatId,
    category: "RELATED" as const,
    disclosure: "HIDDEN" as const,
    severity: "MINOR" as const,
    title: `Feed ${runId}`,
    safeSummary: `Safe summary ${runId}`,
    statusLabel: "New",
    visibleImpacts: [
      { effectCode: "RESOURCE", label: "Resource", value: "+1" },
    ],
    knownFactRefs: [`fact:${runId}:visible`],
    responseOptions: [
      {
        code: "OPEN",
        label: "Open",
        preferredEntry: "INVESTIGATE" as const,
        consumesManeuverOnSubmit: false,
      },
    ],
    recommendedPresentation: "FEED_ONLY" as const,
    centerCard: null,
    keyModal: null,
    eventSequence: 23,
    occurredAt: "2026-08-14T07:00:00.000Z",
  };
  return {
    schemaVersion: "a_emotion_feed_page_v1",
    roomId: runId,
    runId,
    viewerSeatId,
    items: [
      {
        ...projection,
        projectionHash: sha256Canonical(projection),
        isUnread: true,
        isAcknowledged: false,
        isResolved: false,
      },
    ],
    unreadCount: 13,
    nextCursor: `opaque:${digest(`${runId}:cursor`)}`,
    serverSequence: 29,
  };
}

function makeCapabilities(
  chapterSource: PressureGameChapterSourceV1,
): PressureGameCapabilitiesV1 {
  return {
    canSubmitDecision: chapterSource.decision !== null,
    canTalk: false,
    canInvestigate: false,
    canUseToken: false,
    canPlan: false,
    canReclaimControl: false,
    allowedActionTypes: chapterSource.decision
      ? [
          ...chapterSource.decision.options.map((option) => option.actionType),
          "DEFAULT_PASS",
        ].sort()
      : [],
  };
}

function makeDynamicAuthority(
  chapterId: DynamicChapterIdV1,
  runId: string,
  routeHash: string,
  workingRevision: number,
  projectedDecision: PressureGameDecisionProjectionV1,
): {
  chapter: ChapterOrchestratorStateV1;
  workingProjection: WorkingLedgerProjectionV1;
  chapterDescriptor: AuthoredChapterRuntimeV1;
} {
  const chapterRuntimeId = `chapter-runtime:${runId}:${chapterId}`;
  const definitionHash = digest(`${runId}:${chapterId}:definition`);
  const workingState = {
    schemaVersion: "pressure_chapter_working_state_v1" as const,
    runId,
    chapterId,
    revision: workingRevision,
    facts: {},
    counters: {},
    satisfiedRequirementIds: [],
    completedDecisionPointIds: [],
    settledReactions: [],
    lastBeatId: null,
  };
  const actionTypes = [
    ...projectedDecision.options.map((option) => option.actionType),
    "DEFAULT_PASS",
  ];
  const defaultPolicyBody = {
    policyRef: `${projectedDecision.decisionPointId}:default`,
    actionType: "DEFAULT_PASS",
    payload: { reason: "ABSENT" },
  };
  const defaultPolicy = {
    ...defaultPolicyBody,
    policyHash: sha256Canonical(defaultPolicyBody),
  };
  const descriptorBody: Omit<AuthoredChapterRuntimeV1, "descriptorHash"> = {
    schemaVersion: "pressure_authored_chapter_runtime_v1",
    chapterId,
    definition: {
      schemaVersion: "pressure_chapter_definition_v1",
      chapterId,
      sequence: Number(chapterId.slice(1)),
      decisionPoints: [{
        decisionPointId: projectedDecision.decisionPointId,
        kernelId: `kernel:${projectedDecision.decisionPointId}`,
        chapterId,
        sourceOrder: 1,
        prompt: projectedDecision.summary,
        requirementIds: [],
        options: projectedDecision.options.map((option, index) => ({
          optionId: option.actionType,
          sourceOrder: index + 1,
          label: option.label,
          workingDelta: {},
        })),
      }],
      requirementDependencies: [],
    },
    decisions: [{
      decisionPointId: projectedDecision.decisionPointId,
      execution: {
        decisionPointKey: projectedDecision.decisionPointId,
        chapterId,
        ordinal: 1,
        mode: projectedDecision.mode,
        purpose: projectedDecision.summary,
        requiredSeatIds: [...PRESSURE_CHAPTER_SEAT_IDS_V1],
        allowedActionTypes: actionTypes,
        perSeatActionBudget: Object.fromEntries(
          PRESSURE_CHAPTER_SEAT_IDS_V1.map((seatId) => [seatId, 1]),
        ),
        closeCondition: { op: "ALL", clauses: [] },
        deadlinePolicy: null,
        absenceDefaultPolicy: defaultPolicy,
        aiFailureDefaultPolicy: defaultPolicy,
        beatResolutionPolicy: `beat:${projectedDecision.decisionPointId}`,
        allowedWorkingDeltaTypes: [],
        feedbackVisibilityPolicy: "PRIVATE_ONLY",
        reactionPolicy: {
          enabled: false,
          eligibleSeatIds: [],
          trigger: null,
          maxDepth: 0,
        },
      },
      seatRequirements: Object.fromEntries(
        PRESSURE_CHAPTER_SEAT_IDS_V1.map((seatId) => [seatId, "REQUIRED"]),
      ) as AuthoredChapterRuntimeV1["decisions"][number]["seatRequirements"],
    }],
    chapterClosePolicy: {
      kind: "ALL_AUTHORED_DECISION_POINTS_COMPLETED",
      decisionPointIds: [projectedDecision.decisionPointId],
    },
    contentPolicyVersion: "i1-content-policy-v1",
    contentPolicyHash: digest(`${runId}:content-policy`),
    settlementContractVersion: "i1-settlement-v1",
    settlementContractHash: digest(`${runId}:settlement`),
  };
  const chapterDescriptor: AuthoredChapterRuntimeV1 = {
    ...descriptorBody,
    descriptorHash: sha256Canonical(descriptorBody),
  };
  const descriptorHash = chapterDescriptor.descriptorHash;
  const workingProjection: WorkingLedgerProjectionV1 = {
    key: { runId, chapterRuntimeId },
    chapterId,
    routeHash,
    chapterDefinitionHash: definitionHash,
    headHash: digest(`${runId}:ledger-head`),
    headSequence: workingRevision + 1,
    state: workingState,
    stateHash: digest(`${runId}:working-state`),
    nextDecisionPin: null,
    acceptedActions: new Map(),
    actionsByIdempotencyKey: new Map(),
    appliedBeats: new Map(),
    pendingReservations: new Map(),
    commitments: new Map(),
    evidenceRefsByAction: new Map(),
    knowledgeBySeat: new Map(),
    seatArcProgressBySeat: new Map(),
  };
  const chapter: ChapterOrchestratorStateV1 = {
    schemaVersion: "pressure_chapter_orchestrator_state_v1",
    runId,
    routeHash,
    revision: workingRevision + 1,
    phase: "ACTIVE",
    currentChapterId: chapterId,
    chapterRuntimeId,
    descriptorHash,
    authorityBase: {
      baseWorldSequence: Number(chapterId.slice(1)) - 1,
      baseWorldStateHash: digest(`${runId}:base-world`),
      previousFrozenHash: digest(`${runId}:previous-frozen`),
    },
    activeDecision: null,
    chapterSeatSummaries: PRESSURE_CHAPTER_SEAT_IDS_V1.map((seatId) => ({
      seatId,
      requirement: "NOT_REQUIRED",
      sealedActionIds: [],
      defaultActionIds: [],
      defaultCodes: [],
    })),
    settlementInputHash: null,
    frozenBundleHash: null,
    orchestratorHash: digest(`${runId}:orchestrator`),
  };
  return { chapter, workingProjection, chapterDescriptor };
}

function metric(trackId: TrackIdV1, value: number): PressureGameMetricProjectionV1 {
  return {
    trackId,
    label: `Metric ${trackId}`,
    value,
    displayValue: String(value),
    tone: value > 60 ? "GOOD" : value < 20 ? "WARN" : "DEFAULT",
  };
}

class InMemoryRouteRepository implements RunRouteRepositoryPort {
  private readonly records = new Map<string, StoredRunRouteRecordV1>();

  async findByRunId(runId: string): Promise<StoredRunRouteRecordV1 | null> {
    const record = this.records.get(runId);
    return record ? structuredClone(record) : null;
  }

  async insertIfAbsent(record: StoredRunRouteRecordV1) {
    const existing = this.records.get(record.runId);
    if (existing) {
      return { status: "EXISTING" as const, record: structuredClone(existing) };
    }
    this.records.set(record.runId, structuredClone(record));
    return { status: "INSERTED" as const, record: structuredClone(record) };
  }
}

function registry(): PressureChapterRouteRegistry {
  const base: Omit<PressureChapterRouteRegistryV1, "registryHash"> = {
    schemaVersion: PRESSURE_CHAPTER_ROUTE_REGISTRY_SCHEMA_V1,
    registryVersion: "pressure-route-registry-i1-v1",
    defaultRouteKey: "sangtian-pressure",
    routes: [
      {
        routeKey: "sangtian-pressure",
        worldId: "sangtian",
        status: "PUBLISHED",
        createEnabled: true,
        participantModes: ["SOLO", "MULTIPLAYER"],
        route: { ...PRESSURE_CHAPTER_ROUTE_TUPLE_V1 },
        contentPackageVersion: "sangtian-content-i1-v1",
        contentPackageSha256: digest("i1-content"),
        orchestrationPackageVersion: "sangtian-orchestration-i1-v1",
        orchestrationPackageSha256: digest("i1-orchestration"),
        runtimeContractVersion: "pressure-runtime-i1-v1",
        runtimeContractSha256: digest("i1-runtime"),
        testMatrixVersion: "pressure-i1-matrix-v1",
        testMatrixSha256: digest("i1-matrix"),
        narrativeProfileVersion: "openovel-pressure-i1-v1",
        featureSetVersion: "pressure-i1-feature-v1",
        resultContractRegistryVersion: "result-registry-i1-v1",
        controlTopologyVersion: "six-seat-control-i1-v1",
        handlerKey: "pressure_chapter_v1",
        resultAdapterKey: "SangtianPressureResultV1Adapter",
        presentationSchemaVersion: "sangtian_pressure_result_v1",
        rendererKey: "sangtian_pressure_endgame_v1",
      },
    ],
  };
  return new PressureChapterRouteRegistry({
    ...base,
    registryHash: computePressureChapterRouteRegistryHash(base),
  });
}
