import assert from "node:assert/strict";
import test from "node:test";
import {
  PRESSURE_CHAPTER_SEAT_IDS_V1,
  TRACK_IDS_V1,
  sha256Canonical,
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
import {
  type AEmotionFeedPagePortV1,
  type PressureGameCapabilitiesV1,
  type PressureGameChapterSourceV1,
  type PressureGameMetricProjectionV1,
  type PressureGameNarrativeSourceV1,
  type PressureGameViewerSourceV1,
  type PressureGameWorldSourceV1,
} from "./contracts";
import {
  PRESSURE_GAME_PROJECTION_ERROR_CODES,
  PressureGameProjectionError,
} from "./errors";
import { PressureChapterGameProjectionService } from "./game-projection.service";

const digest = (label: string): string => sha256Canonical({ label });
const VIEWER_SEAT = PRESSURE_CHAPTER_SEAT_IDS_V1[0];
const SECOND_VIEWER_SEAT = PRESSURE_CHAPTER_SEAT_IDS_V1[1];

test("chapter decisions are read with the trusted viewer seat and isolate REQUIRED from NOT_REQUIRED", async () => {
  const harness = await createHarness({
    runId: "game-projection-two-viewers",
    metricSeed: 17,
    goal: "Resolve the current chapter without crossing seat boundaries.",
    resourceValue: 6,
    tokenLabel: "Viewer-scoped token",
  });

  const required = await harness.service.read({
    runId: harness.runId,
    subjectId: "user-viewer",
  });
  assert.equal(required.viewer.seatId, VIEWER_SEAT);
  assert.equal(required.decision?.requirement, "REQUIRED");

  harness.viewerSource.subjectId = "user-second-viewer";
  harness.viewerSource.viewer.seatId = SECOND_VIEWER_SEAT;
  harness.viewerSource.viewer.roleName = "Second viewer";
  harness.chapterSource.viewerSeatId = SECOND_VIEWER_SEAT;
  harness.chapterSource.decision = {
    ...harness.chapterSource.decision!,
    requirement: "NOT_REQUIRED",
    summary: "Only the second viewer's non-blocking projection is visible.",
  };
  harness.narrativeSource.viewerSeatId = SECOND_VIEWER_SEAT;
  harness.feedPage.viewerSeatId = SECOND_VIEWER_SEAT;
  harness.capabilities.canSubmitDecision = false;

  const notRequired = await harness.service.read({
    runId: harness.runId,
    subjectId: "user-second-viewer",
  });
  assert.equal(notRequired.viewer.seatId, SECOND_VIEWER_SEAT);
  assert.equal(notRequired.decision?.requirement, "NOT_REQUIRED");
  assert.equal(
    notRequired.decision?.summary,
    "Only the second viewer's non-blocking projection is visible.",
  );
  assert.notEqual(notRequired.decision?.summary, required.decision?.summary);
  assert.deepEqual(harness.chapterReadScopes, [
    {
      runId: harness.runId,
      routeHash: harness.chapterSource.routeHash,
      viewerSeatId: VIEWER_SEAT,
    },
    {
      runId: harness.runId,
      routeHash: harness.chapterSource.routeHash,
      viewerSeatId: SECOND_VIEWER_SEAT,
    },
  ]);
});

test("authority-seeded read is byte-equivalent and skips route/state/Working chapter reads", async () => {
  const harness = await createHarness({
    runId: "game-projection-seeded",
    metricSeed: 31,
    goal: "Keep the committed projection authoritative.",
    resourceValue: 8,
    tokenLabel: "Seeded token",
  });
  const ordinary = await harness.service.read({
    runId: harness.runId,
    subjectId: "user-viewer",
  });
  const chapterReadsBefore = harness.chapterReadScopes.length;
  const capabilityReadsBefore = harness.readCounts.capabilities;
  const seeded = await harness.service.readFromCommittedAuthority({
    runId: harness.runId,
    subjectId: "user-viewer",
    roomId: harness.runId,
    routeSnapshot: structuredClone(harness.route.snapshot),
    viewerSeatId: VIEWER_SEAT,
    chapter: {} as any,
    workingProjection: {} as any,
    chapterDescriptor: {} as any,
  });
  assert.deepEqual(seeded, ordinary);
  assert.equal(harness.chapterReadScopes.length, chapterReadsBefore);
  assert.equal(harness.readCounts.capabilities, capabilityReadsBefore);
});

test("authority-seeded next chapter remains playable while frozen narrative is PENDING", async () => {
  const harness = await createHarness({
    runId: "game-projection-pending-narrative",
    metricSeed: 37,
    goal: "Open the next decision without waiting for narrative enrichment.",
    resourceValue: 9,
    tokenLabel: "Pending narrative token",
  });
  Object.assign(harness.narrativeSource, {
    status: "PENDING",
    projectionKind: "CHAPTER_NARRATIVE",
    sourceAuthority: "CHAPTER_FROZEN",
    sourceId: digest("prior-frozen-chapter"),
    sourceCommitHash: digest("prior-frozen-chapter"),
    text: null,
    contentHash: null,
    renderMode: null,
  });

  const projection = await harness.service.readFromCommittedAuthority({
    runId: harness.runId,
    subjectId: "user-viewer",
    roomId: harness.runId,
    routeSnapshot: structuredClone(harness.route.snapshot),
    viewerSeatId: VIEWER_SEAT,
    chapter: {} as any,
    workingProjection: {} as any,
    chapterDescriptor: {} as any,
  });

  assert.equal(projection.narrative.status, "PENDING");
  assert.equal(projection.narrative.text, null);
  assert.equal(projection.narrative.contentHash, null);
  assert.equal(projection.narrative.renderMode, null);
  assert.equal(projection.decision?.requirement, "REQUIRED");
  assert.equal(projection.capabilities.canSubmitDecision, true);
});

test("two authoritative read models produce different real metrics, situation, resources, and tokens", async () => {
  const first = await createHarness({
    runId: "game-projection-a",
    metricSeed: 11,
    goal: "查明粮册流转链并保全本席承诺。",
    resourceValue: 7,
    tokenLabel: "巡按封签",
  });
  const second = await createHarness({
    runId: "game-projection-b",
    metricSeed: 61,
    goal: "公开质询织造局并推动本章收束。",
    resourceValue: 23,
    tokenLabel: "织造回票",
  });

  const a = await first.service.read({ runId: first.runId, subjectId: "user-viewer" });
  const b = await second.service.read({ runId: second.runId, subjectId: "user-viewer" });
  assert.equal(a.schemaVersion, "pressure_chapter_game_projection_v1");
  assert.equal(a.metrics.length, 5);
  assert.deepEqual(a.metrics.map((metric) => metric.trackId), TRACK_IDS_V1);
  assert.notDeepEqual(a.metrics.map((metric) => metric.value), b.metrics.map((metric) => metric.value));
  assert.notEqual(a.situation.goal, b.situation.goal);
  assert.notEqual(a.resources[0]?.value, b.resources[0]?.value);
  assert.notEqual(a.tokens[0]?.label, b.tokens[0]?.label);
  assert.notEqual(a.projectionHash, b.projectionHash);
});

test("API selects the viewer-safe vocabulary and drops raw secrets from every source", async () => {
  const harness = await createHarness({
    runId: "game-projection-safe",
    metricSeed: 20,
    goal: "完成当前目标。",
    resourceValue: 4,
    tokenLabel: "安全筹码",
  });
  Object.assign(harness.viewerSource, {
    otherSeatSecret: "NEVER_SERIALIZE_OTHER_SEAT",
  });
  Object.assign(harness.viewerSource.resources[0]!, {
    rawFactRefs: ["fact.private.peer"],
  });
  Object.assign(harness.feedPage, {
    repositoryCursorSecret: "NEVER_SERIALIZE_CURSOR_SECRET",
  });
  Object.assign(harness.narrativeSource, {
    providerRawSecret: "NEVER_SERIALIZE_PROVIDER_RAW",
  });
  const feedProjection = {
    schemaVersion: "a_emotion_viewer_projection_v1" as const,
    eventId: "viewer-safe-event-1",
    projectionVersion: 1,
    roomId: harness.runId,
    runId: harness.runId,
    viewerSeatId: VIEWER_SEAT,
    category: "RELATED" as const,
    disclosure: "HIDDEN" as const,
    severity: "MINOR" as const,
    title: "与你有关的公开变化",
    safeSummary: "只包含当前席位获准知道的影响。",
    statusLabel: "待处理",
    visibleImpacts: [{ effectCode: "SAFE_DELTA", label: "可见变化", value: "+1" }],
    knownFactRefs: ["fact.viewer.allowed"],
    responseOptions: [{ code: "OPEN", label: "查看", preferredEntry: "INVESTIGATE" as const, consumesManeuverOnSubmit: false }],
    recommendedPresentation: "FEED_ONLY" as const,
    centerCard: null,
    keyModal: null,
    eventSequence: 1,
    occurredAt: "2026-08-12T00:00:00.000Z",
  };
  harness.feedPage.items.push({
    ...feedProjection,
    projectionHash: sha256Canonical(feedProjection),
    isUnread: true,
    isAcknowledged: false,
    isResolved: false,
  });
  Object.assign(harness.feedPage.items[0]!.visibleImpacts[0]!, {
    rawOtherSeatSecret: "NEVER_SERIALIZE_NESTED_SECRET",
  });
  Object.assign(harness.feedPage.items[0]!.responseOptions[0]!, {
    rawProviderInstruction: "NEVER_SERIALIZE_RAW_INSTRUCTION",
  });
  harness.feedPage.unreadCount = 1;
  const projection = await harness.service.read({
    runId: harness.runId,
    subjectId: "user-viewer",
  });
  const serialized = JSON.stringify(projection);
  assert.doesNotMatch(serialized, /NEVER_SERIALIZE|fact\.private\.peer|repositoryCursorSecret|rawFactRefs|rawOtherSeatSecret|rawProviderInstruction|providerRawSecret/u);
  assert.deepEqual(Object.keys(projection.resources[0]!).sort(), [
    "displayValue",
    "label",
    "resourceId",
    "value",
  ]);
});

test("P0 projects frozen Genesis narrative and forbids every world action capability", async () => {
  const harness = await createHarness({
    runId: "game-projection-p0",
    metricSeed: 5,
    goal: "了解国策前提。",
    resourceValue: 1,
    tokenLabel: "序章凭据",
  });
  harness.chapterSource.chapter = {
    chapterRuntimeId: `${harness.runId}:P0`,
    chapterId: "P0",
    chapterNumber: 0,
    title: "桑田诏下",
    phase: "FROZEN",
    workingRevision: 0,
  };
  harness.chapterSource.decision = null;
  harness.narrativeSource.chapterRuntimeId = harness.chapterSource.chapter.chapterRuntimeId;
  harness.narrativeSource.projectionKind = "GENESIS_NARRATIVE";
  harness.narrativeSource.sourceAuthority = "GENESIS_FROZEN";
  harness.narrativeSource.status = "FALLBACK_PUBLISHED";
  harness.narrativeSource.text = "国策已经落下，序章仅展示冻结的 Genesis 事实。";
  harness.narrativeSource.contentHash = digest("p0-narrative");
  harness.narrativeSource.renderMode = "AUTHORED_FALLBACK";
  Object.assign(harness.capabilities, {
    canSubmitDecision: false,
    canTalk: false,
    canInvestigate: false,
    canUseToken: false,
    canPlan: false,
    allowedActionTypes: [],
  });

  const result = await harness.service.read({ runId: harness.runId, subjectId: "user-viewer" });
  assert.equal(result.chapter.chapterId, "P0");
  assert.equal(result.narrative.projectionKind, "GENESIS_NARRATIVE");
  assert.equal(result.narrative.sourceAuthority, "GENESIS_FROZEN");
  assert.equal(result.capabilities.canSubmitDecision, false);
  assert.equal(result.capabilities.canTalk, false);
  assert.equal(result.decision, null);

  harness.capabilities.canPlan = true;
  await assert.rejects(
    () => harness.service.read({ runId: harness.runId, subjectId: "user-viewer" }),
    (error: unknown) => error instanceof PressureGameProjectionError && error.code === PRESSURE_GAME_PROJECTION_ERROR_CODES.CAPABILITY_MISMATCH,
  );
});

test("initial N1 may present committed Genesis narrative, while every later chapter remains fail-closed", async () => {
  const harness = await createHarness({
    runId: "game-projection-n1-genesis-opening",
    metricSeed: 7,
    goal: "Read the committed opening before the first Beat resolves.",
    resourceValue: 1,
    tokenLabel: "Opening token",
  });
  harness.chapterSource.chapter = {
    chapterRuntimeId: `${harness.runId}:N1`,
    chapterId: "N1",
    chapterNumber: 1,
    title: "The opening pressure",
    phase: "ACTIVE",
    workingRevision: 0,
  };
  harness.chapterSource.decision!.expectedWorkingRevision = 0;
  harness.narrativeSource.chapterRuntimeId = harness.chapterSource.chapter.chapterRuntimeId;
  harness.narrativeSource.projectionKind = "GENESIS_NARRATIVE";
  harness.narrativeSource.sourceAuthority = "GENESIS_FROZEN";
  harness.narrativeSource.sourceId = digest("n1-genesis-source");
  harness.narrativeSource.sourceCommitHash = digest("n1-genesis-commit");
  harness.narrativeSource.status = "PUBLISHED";
  harness.narrativeSource.text = "A short generated Genesis summary for this seat.";
  harness.narrativeSource.contentHash = digest("n1-generated-genesis");
  harness.narrativeSource.renderMode = "PROVIDER";

  const opening = await harness.service.read({ runId: harness.runId, subjectId: "user-viewer" });
  assert.equal(opening.chapter.chapterId, "N1");
  assert.equal(opening.narrative.projectionKind, "GENESIS_NARRATIVE");
  assert.equal(opening.narrative.sourceAuthority, "GENESIS_FROZEN");
  assert.equal(opening.narrative.status, "FALLBACK_PUBLISHED");
  assert.equal(opening.narrative.renderMode, "AUTHORED_FALLBACK");
  assert.match(opening.narrative.text ?? "", /嘉靖三十五年，天下仍披着太平的外衣/u);
  assert.match(opening.narrative.text ?? "", /一场谁也无法独善其身的危局，正无声逼近/u);
  assert.doesNotMatch(opening.narrative.text ?? "", /short generated Genesis summary/iu);

  harness.chapterSource.chapter.workingRevision = 1;
  harness.chapterSource.decision!.expectedWorkingRevision = 1;
  await assert.rejects(
    () => harness.service.read({ runId: harness.runId, subjectId: "user-viewer" }),
    (error: unknown) => error instanceof PressureGameProjectionError
      && error.code === PRESSURE_GAME_PROJECTION_ERROR_CODES.SCOPE_MISMATCH,
  );

  harness.chapterSource.chapter = {
    ...harness.chapterSource.chapter,
    chapterRuntimeId: `${harness.runId}:N2`,
    chapterId: "N2",
    chapterNumber: 2,
  };
  harness.narrativeSource.chapterRuntimeId = harness.chapterSource.chapter.chapterRuntimeId;
  await assert.rejects(
    () => harness.service.read({ runId: harness.runId, subjectId: "user-viewer" }),
    (error: unknown) => error instanceof PressureGameProjectionError
      && error.code === PRESSURE_GAME_PROJECTION_ERROR_CODES.SCOPE_MISMATCH,
  );

  harness.chapterSource.chapter = {
    ...harness.chapterSource.chapter,
    chapterRuntimeId: `${harness.runId}:P0`,
    chapterId: "P0",
    chapterNumber: 0,
    phase: "FROZEN",
  };
  harness.chapterSource.decision = null;
  harness.narrativeSource.chapterRuntimeId = harness.chapterSource.chapter.chapterRuntimeId;
  harness.narrativeSource.projectionKind = "BEAT_NARRATIVE";
  harness.narrativeSource.sourceAuthority = "CHAPTER_WORKING";
  Object.assign(harness.capabilities, {
    canSubmitDecision: false,
    canTalk: false,
    canInvestigate: false,
    canUseToken: false,
    canPlan: false,
    allowedActionTypes: [],
  });
  await assert.rejects(
    () => harness.service.read({ runId: harness.runId, subjectId: "user-viewer" }),
    (error: unknown) => error instanceof PressureGameProjectionError
      && error.code === PRESSURE_GAME_PROJECTION_ERROR_CODES.SCOPE_MISMATCH,
  );
});

test("narrative chapter, authority, status, and audience bindings fail closed", async () => {
  const harness = await createHarness({
    runId: "game-projection-narrative-scope",
    metricSeed: 9,
    goal: "读取本席叙事。",
    resourceValue: 2,
    tokenLabel: "叙事凭据",
  });
  harness.narrativeSource.viewerSeatId = PRESSURE_CHAPTER_SEAT_IDS_V1[1];
  await assert.rejects(
    () => harness.service.read({ runId: harness.runId, subjectId: "user-viewer" }),
    (error: unknown) => error instanceof PressureGameProjectionError && error.code === PRESSURE_GAME_PROJECTION_ERROR_CODES.SCOPE_MISMATCH,
  );
  harness.narrativeSource.viewerSeatId = VIEWER_SEAT;
  harness.narrativeSource.status = "GENERATING";
  await assert.rejects(
    () => harness.service.read({ runId: harness.runId, subjectId: "user-viewer" }),
    (error: unknown) => error instanceof PressureGameProjectionError && error.code === PRESSURE_GAME_PROJECTION_ERROR_CODES.VIEWER_DATA_UNSAFE,
  );
});

test("route, viewer, chapter, world, and feed scope mismatches fail closed", async () => {
  for (const mutate of [
    (h: Awaited<ReturnType<typeof createHarness>>) => { h.chapterSource.routeHash = digest("wrong-chapter-route"); },
    (h: Awaited<ReturnType<typeof createHarness>>) => { h.chapterSource.viewerSeatId = SECOND_VIEWER_SEAT; },
    (h: Awaited<ReturnType<typeof createHarness>>) => { h.viewerSource.subjectId = "different-user"; },
    (h: Awaited<ReturnType<typeof createHarness>>) => { h.worldSource.runId = "different-run"; },
    (h: Awaited<ReturnType<typeof createHarness>>) => { h.feedPage.viewerSeatId = PRESSURE_CHAPTER_SEAT_IDS_V1[1]; },
  ]) {
    const harness = await createHarness({
      runId: `scope-${digest(String(mutate)).slice(0, 8)}`,
      metricSeed: 10,
      goal: "安全目标。",
      resourceValue: 1,
      tokenLabel: "安全筹码",
    });
    mutate(harness);
    await assert.rejects(
      () => harness.service.read({ runId: harness.runId, subjectId: "user-viewer" }),
      (error: unknown) =>
        error instanceof PressureGameProjectionError &&
        error.code === PRESSURE_GAME_PROJECTION_ERROR_CODES.SCOPE_MISMATCH,
    );
  }
});

test("capabilities cannot claim authority the viewer, chapter, or inventory does not have", async () => {
  const harness = await createHarness({
    runId: "game-projection-capabilities",
    metricSeed: 10,
    goal: "安全目标。",
    resourceValue: 1,
    tokenLabel: "安全筹码",
  });
  harness.capabilities.canSubmitDecision = false;
  await assert.rejects(
    () => harness.service.read({ runId: harness.runId, subjectId: "user-viewer" }),
    (error: unknown) =>
      error instanceof PressureGameProjectionError &&
      error.code === PRESSURE_GAME_PROJECTION_ERROR_CODES.CAPABILITY_MISMATCH,
  );
});

test("missing or duplicated central metrics fail closed instead of filling browser defaults", async () => {
  const harness = await createHarness({
    runId: "game-projection-metrics",
    metricSeed: 10,
    goal: "安全目标。",
    resourceValue: 1,
    tokenLabel: "安全筹码",
  });
  harness.worldSource.metrics[4] = { ...harness.worldSource.metrics[0]! };
  await assert.rejects(
    () => harness.service.read({ runId: harness.runId, subjectId: "user-viewer" }),
    (error: unknown) =>
      error instanceof PressureGameProjectionError &&
      error.code === PRESSURE_GAME_PROJECTION_ERROR_CODES.INVALID_SOURCE,
  );
});

test("decision workbench entry is content-owned and unknown option fields fail closed", async () => {
  const invalidEntry = await createHarness({
    runId: "game-projection-preferred-entry",
    metricSeed: 14,
    goal: "Use only the workbench selected by frozen content.",
    resourceValue: 2,
    tokenLabel: "Frozen entry token",
  });
  const firstOption = invalidEntry.chapterSource.decision!.options[0]!;
  (firstOption as unknown as Record<string, unknown>).preferredEntry = "CLIENT_GUESSED";
  await assert.rejects(
    () => invalidEntry.service.read({
      runId: invalidEntry.runId,
      subjectId: "user-viewer",
    }),
    (error: unknown) =>
      error instanceof PressureGameProjectionError
      && error.code === PRESSURE_GAME_PROJECTION_ERROR_CODES.INVALID_SOURCE,
  );

  const extraField = await createHarness({
    runId: "game-projection-option-extra",
    metricSeed: 15,
    goal: "Reject browser-visible fields not owned by the contract.",
    resourceValue: 3,
    tokenLabel: "Exact option token",
  });
  Object.assign(extraField.chapterSource.decision!.options[0]!, {
    inferredWorkbench: "INVESTIGATE",
  });
  await assert.rejects(
    () => extraField.service.read({
      runId: extraField.runId,
      subjectId: "user-viewer",
    }),
    (error: unknown) =>
      error instanceof PressureGameProjectionError
      && error.code === PRESSURE_GAME_PROJECTION_ERROR_CODES.INVALID_SOURCE,
  );
});

async function createHarness(input: {
  runId: string;
  metricSeed: number;
  goal: string;
  resourceValue: number;
  tokenLabel: string;
}) {
  const routeRepository = new InMemoryRouteRepository();
  const routeService = new PressureChapterRunRouterService(routeRepository, registry());
  const route = (
    await routeService.create({
      runId: input.runId,
      routeKey: null,
      participantMode: "SOLO",
      humanSeatIdsAtStart: [VIEWER_SEAT],
      runSeed: `seed:${input.runId}`,
    })
  ).route;
  const chapterSource: PressureGameChapterSourceV1 = {
    runId: input.runId,
    routeHash: route.snapshot.routeHash,
    viewerSeatId: VIEWER_SEAT,
    projectionVersion: 4,
    chapter: {
      chapterRuntimeId: `chapter-runtime:${input.runId}:N2`,
      chapterId: "N2",
      chapterNumber: 2,
      title: "粮册疑云",
      phase: "ACTIVE",
      workingRevision: 3,
    },
    decision: {
      decisionPointId: `decision:${input.runId}:1`,
      mode: "SOLO_BEAT",
      requirement: "REQUIRED",
      title: "如何处置这份粮册？",
      summary: "粮册来源与交接记录并不一致。",
      expectedWorkingRevision: 3,
      options: [
        { code: "A", label: "封存复核", description: "先封存原件，再交叉核验。", actionType: "SEAL_AND_REVIEW", preferredEntry: "INVESTIGATE" },
        { code: "B", label: "公开质询", description: "要求经手各方公开说明。", actionType: "PUBLIC_QUESTION", preferredEntry: "TALK" },
      ],
      submitLabel: "提交决定",
      customActionAllowed: true,
    },
  };
  const viewerSource: PressureGameViewerSourceV1 = {
    roomId: input.runId,
    runId: input.runId,
    routeHash: route.snapshot.routeHash,
    subjectId: "user-viewer",
    viewer: {
      seatId: VIEWER_SEAT,
      roleName: "户部度支",
      control: {
        mode: "HUMAN_ACTIVE",
        controlEpoch: 2,
        canSubmit: true,
        canReclaim: false,
        submissionFenceToken: digest(`${input.runId}:submission-fence`),
        reclaimFenceToken: null,
      },
    },
    situation: {
      goal: input.goal,
      risk: `风险值 ${input.metricSeed + 3}`,
      judgment: `当前判断 ${input.metricSeed + 5}`,
    },
    resources: [
      {
        resourceId: "resource.silver",
        label: "可调银两",
        value: input.resourceValue,
        displayValue: String(input.resourceValue),
      },
    ],
    tokens: [
      {
        tokenId: "token.viewer.primary",
        label: input.tokenLabel,
        description: `仅本席可见的筹码 ${input.metricSeed}`,
        quantity: 1,
        available: true,
      },
    ],
  };
  const worldSource: PressureGameWorldSourceV1 = {
    runId: input.runId,
    routeHash: route.snapshot.routeHash,
    worldSequence: 1,
    worldStateHash: digest(`${input.runId}:world`),
    metrics: TRACK_IDS_V1.map((trackId, index) => metric(trackId, input.metricSeed + index)),
  };
  const capabilities: PressureGameCapabilitiesV1 = {
    canSubmitDecision: true,
    canTalk: false,
    canInvestigate: false,
    canUseToken: false,
    canPlan: false,
    canReclaimControl: false,
    allowedActionTypes: ["PUBLIC_QUESTION", "SEAL_AND_REVIEW"],
  };
  const narrativeSource: PressureGameNarrativeSourceV1 = {
    runId: input.runId,
    routeHash: route.snapshot.routeHash,
    viewerSeatId: VIEWER_SEAT,
    chapterRuntimeId: chapterSource.chapter.chapterRuntimeId,
    status: "PUBLISHED",
    projectionKind: "BEAT_NARRATIVE",
    sourceAuthority: "CHAPTER_WORKING",
    sourceId: `narrative:${input.runId}:N2:3`,
    sourceCommitHash: digest(`${input.runId}:narrative-source`),
    text: `当前席位可见的章内叙事 ${input.metricSeed}`,
    contentHash: digest(`${input.runId}:narrative-content`),
    renderMode: "PROVIDER",
  };
  const feedPage: AEmotionFeedPagePortV1 = {
    schemaVersion: "a_emotion_feed_page_v1",
    roomId: input.runId,
    runId: input.runId,
    viewerSeatId: VIEWER_SEAT,
    items: [],
    unreadCount: 0,
    nextCursor: null,
    serverSequence: 0,
  };
  const chapterReadScopes: Array<{
    runId: string;
    routeHash: string;
    viewerSeatId: SeatIdV1;
  }> = [];
  const readCounts = { capabilities: 0 };
  const service = new PressureChapterGameProjectionService(
    { readStoredRoute: async () => structuredClone(route) },
    {
      readCurrent: async (scope) => {
        chapterReadScopes.push(structuredClone(scope));
        return structuredClone(chapterSource);
      },
      projectCurrent: () => structuredClone(chapterSource),
    },
    { readViewer: async () => structuredClone(viewerSource) },
    { readWorld: async () => structuredClone(worldSource) },
    { readCurrent: async () => structuredClone(narrativeSource) },
    { list: async () => structuredClone(feedPage) },
    { readCapabilities: async () => {
      readCounts.capabilities += 1;
      return structuredClone(capabilities);
    } },
  );
  return {
    runId: input.runId,
    route,
    service,
    chapterSource,
    viewerSource,
    worldSource,
    narrativeSource,
    capabilities,
    feedPage,
    chapterReadScopes,
    readCounts,
  };
}

function metric(trackId: TrackIdV1, value: number): PressureGameMetricProjectionV1 {
  return {
    trackId,
    label: `指标 ${trackId}`,
    value,
    displayValue: String(value),
    tone: value > 60 ? "GOOD" : value < 20 ? "WARN" : "DEFAULT",
  };
}

class InMemoryRouteRepository implements RunRouteRepositoryPort {
  private readonly records = new Map<string, StoredRunRouteRecordV1>();

  async findByRunId(runId: string) {
    const record = this.records.get(runId);
    return record ? structuredClone(record) : null;
  }

  async insertIfAbsent(record: StoredRunRouteRecordV1) {
    const existing = this.records.get(record.runId);
    if (existing) return { status: "EXISTING" as const, record: structuredClone(existing) };
    this.records.set(record.runId, structuredClone(record));
    return { status: "INSERTED" as const, record: structuredClone(record) };
  }
}

function registry(): PressureChapterRouteRegistry {
  const base: Omit<PressureChapterRouteRegistryV1, "registryHash"> = {
    schemaVersion: PRESSURE_CHAPTER_ROUTE_REGISTRY_SCHEMA_V1,
    registryVersion: "pressure-route-registry-game-v1",
    defaultRouteKey: "sangtian-pressure",
    routes: [
      {
        routeKey: "sangtian-pressure",
        worldId: "sangtian",
        status: "PUBLISHED",
        createEnabled: true,
        participantModes: ["SOLO", "MULTIPLAYER"],
        route: { ...PRESSURE_CHAPTER_ROUTE_TUPLE_V1 },
        contentPackageVersion: "sangtian-content-game-v1",
        contentPackageSha256: digest("content"),
        orchestrationPackageVersion: "sangtian-orchestration-game-v1",
        orchestrationPackageSha256: digest("orchestration"),
        runtimeContractVersion: "pressure-runtime-game-v1",
        runtimeContractSha256: digest("runtime"),
        testMatrixVersion: "pressure-game-matrix-v1",
        testMatrixSha256: digest("matrix"),
        narrativeProfileVersion: "openovel-pressure-game-v1",
        featureSetVersion: "pressure-game-feature-v1",
        resultContractRegistryVersion: "result-registry-game-v1",
        controlTopologyVersion: "six-seat-control-game-v1",
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
