import {
  PRESSURE_CHAPTER_SEAT_IDS_V1,
  TRACK_IDS_V1,
  compareCanonicalText,
  isSha256,
  sha256Canonical,
  type SeatIdV1,
} from "@ai-story/shared";
import { assertStoredRunRouteRecord } from "../run-router";
import {
  PRESSURE_CHAPTER_GAME_PROJECTION_SCHEMA_V1,
  type AEmotionFeedItemPortV1,
  type AEmotionFeedPagePortV1,
  type AEmotionFeedSourceItemPortV1,
  type AEmotionFeedSourcePagePortV1,
  type PressureChapterGameProjectionV1,
  type PressureGameAEmotionFeedPort,
  type PressureGameCapabilitiesV1,
  type PressureGameCapabilityReaderPort,
  type PressureGameChapterReaderPort,
  type PressureGameDecisionProjectionV1,
  type PressureGameMetricProjectionV1,
  type PressureGameNarrativeProjectionV1,
  type PressureGameNarrativeReaderPort,
  type PressureGameResourceProjectionV1,
  type PressureGameRouteReaderPort,
  type PressureGameTokenProjectionV1,
  type PressureGameViewerReaderPort,
  type PressureGameWorldReaderPort,
  type ReadPressureChapterGameProjectionQueryV1,
} from "./contracts";
import {
  PRESSURE_GAME_PROJECTION_ERROR_CODES as ERROR,
  failPressureGameProjection,
} from "./errors";

const NON_EMPTY = /\S/u;
const CHAPTER_IDS = Object.freeze(["P0", "N1", "N2", "N3", "N4", "N5", "N6", "N7"] as const);
const PHASES = Object.freeze(["ACTIVE", "RESOLVING_BEAT", "SETTLING", "FROZEN", "FINALE_REQUESTED"] as const);
const DECISION_MODES = Object.freeze(["SOLO_BEAT", "TARGETED_INTERACTION", "SYNC_CONTEST"] as const);
const WORKBENCH_ENTRIES = Object.freeze(["TALK", "INVESTIGATE", "TOKEN", "PLAN", "DEFER"] as const);
const METRIC_TONES = Object.freeze(["DEFAULT", "GOOD", "WARN", "DANGER"] as const);
const WORKBENCH_CAPABILITY_KEYS = Object.freeze([
  "canTalk",
  "canInvestigate",
  "canUseToken",
  "canPlan",
] as const);

export class PressureChapterGameProjectionService {
  constructor(
    private readonly routes: PressureGameRouteReaderPort,
    private readonly chapters: PressureGameChapterReaderPort,
    private readonly viewers: PressureGameViewerReaderPort,
    private readonly worlds: PressureGameWorldReaderPort,
    private readonly narratives: PressureGameNarrativeReaderPort,
    private readonly feed: PressureGameAEmotionFeedPort,
    private readonly capabilities: PressureGameCapabilityReaderPort,
  ) {}

  async read(
    query: ReadPressureChapterGameProjectionQueryV1,
  ): Promise<PressureChapterGameProjectionV1> {
    string(query.runId, "query.runId");
    string(query.subjectId, "query.subjectId");
    const limit = query.feedLimit ?? 10;
    integer(limit, "query.feedLimit", 1, 10);
    if (query.feedCursor !== undefined && query.feedCursor !== null) {
      string(query.feedCursor, "query.feedCursor");
    }

    let route;
    try {
      route = assertStoredRunRouteRecord(
        await this.routes.readStoredRoute(query.runId),
      );
    } catch {
      failPressureGameProjection(ERROR.ROUTE_NOT_FOUND, query.runId);
    }
    same(query.runId, route.runId, "route.runId");
    // Resolve and validate the audience authority before asking for a chapter
    // decision. Decision requirement/options are seat-scoped and must never be
    // materialized from a run-only read.
    const viewer = await this.viewers.readViewer({
      runId: query.runId,
      subjectId: query.subjectId,
    });
    if (!viewer) failPressureGameProjection(ERROR.VIEWER_NOT_FOUND, query.subjectId);
    same(query.runId, viewer.runId, "viewer.runId");
    same(query.subjectId, viewer.subjectId, "viewer.subjectId");
    same(route.snapshot.routeHash, viewer.routeHash, "viewer.routeHash");
    validateViewer(viewer.viewer);
    validateSituation(viewer.situation);

    const routeHash = route.snapshot.routeHash;
    const [chapter, world] = await Promise.all([
      this.chapters.readCurrent({
        runId: query.runId,
        routeHash,
        viewerSeatId: viewer.viewer.seatId,
      }),
      this.worlds.readWorld(query.runId),
    ]);
    if (!chapter) failPressureGameProjection(ERROR.CHAPTER_NOT_FOUND, query.runId);
    if (!world) failPressureGameProjection(ERROR.WORLD_NOT_FOUND, query.runId);

    same(query.runId, chapter.runId, "chapter.runId");
    same(query.runId, world.runId, "world.runId");
    same(routeHash, chapter.routeHash, "chapter.routeHash");
    same(routeHash, world.routeHash, "world.routeHash");
    same(viewer.viewer.seatId, chapter.viewerSeatId, "chapter.viewerSeatId");
    validateChapter(chapter.chapter, chapter.projectionVersion);
    const narrativeSource = await this.narratives.readCurrent({
      runId: query.runId,
      routeHash,
      viewerSeatId: viewer.viewer.seatId,
      chapterRuntimeId: chapter.chapter.chapterRuntimeId,
    });
    if (!narrativeSource) {
      failPressureGameProjection(ERROR.NARRATIVE_NOT_FOUND, chapter.chapter.chapterRuntimeId);
    }
    same(query.runId, narrativeSource.runId, "narrative.runId");
    same(routeHash, narrativeSource.routeHash, "narrative.routeHash");
    same(viewer.viewer.seatId, narrativeSource.viewerSeatId, "narrative.viewerSeatId");
    same(
      chapter.chapter.chapterRuntimeId,
      narrativeSource.chapterRuntimeId,
      "narrative.chapterRuntimeId",
    );
    const narrative = sanitizeNarrative(
      narrativeSource,
      chapter.chapter.chapterId,
      chapter.chapter.workingRevision,
    );
    const metrics = sanitizeMetrics(world.metrics);
    const resources = sanitizeResources(viewer.resources);
    const tokens = sanitizeTokens(viewer.tokens);
    const decision = sanitizeDecision(chapter.decision, chapter.chapter.workingRevision);

    const resolvedCapabilities = sanitizeCapabilities(
      await this.capabilities.readCapabilities({
        runId: query.runId,
        routeHash,
        subjectId: query.subjectId,
        viewerSeatId: viewer.viewer.seatId,
        chapterRuntimeId: chapter.chapter.chapterRuntimeId,
        decisionPointId: decision?.decisionPointId ?? null,
      }),
    );
    assertCapabilitiesMatch(
      resolvedCapabilities,
      viewer.viewer.control,
      chapter.chapter.phase,
      chapter.chapter.chapterId,
      decision,
      tokens,
    );

    const feedPage = sanitizeFeedPage(
      await this.feed.list({
        roomId: viewer.roomId,
        runId: query.runId,
        viewerSeatId: viewer.viewer.seatId,
        cursor: query.feedCursor ?? null,
        limit,
      }),
      {
        roomId: viewer.roomId,
        runId: query.runId,
        viewerSeatId: viewer.viewer.seatId,
      },
    );
    const base = {
      schemaVersion: PRESSURE_CHAPTER_GAME_PROJECTION_SCHEMA_V1,
      projectionVersion: chapter.projectionVersion,
      roomId: viewer.roomId,
      runId: query.runId,
      route: {
        routeHash,
        participantMode: route.snapshot.participantMode,
        runtimeProfile: route.snapshot.route.runtimeProfile,
        contentPackageVersion: route.snapshot.contentPackageVersion,
        controlTopologyVersion: route.snapshot.controlTopologyVersion,
      },
      chapter: structuredClone(chapter.chapter),
      viewer: structuredClone(viewer.viewer),
      metrics,
      situation: structuredClone(viewer.situation),
      resources,
      tokens,
      decision,
      capabilities: resolvedCapabilities,
      narrative,
      feedPage,
    };
    return { ...base, projectionHash: sha256Canonical(base) };
  }
}

function validateChapter(
  chapter: PressureChapterGameProjectionV1["chapter"],
  projectionVersion: number,
): void {
  integer(projectionVersion, "chapterSource.projectionVersion", 1);
  string(chapter.chapterRuntimeId, "chapter.chapterRuntimeId");
  enumeration(chapter.chapterId, CHAPTER_IDS, "chapter.chapterId");
  integer(chapter.chapterNumber, "chapter.chapterNumber", 0, 7);
  const expectedNumber = chapter.chapterId === "P0" ? 0 : Number(chapter.chapterId.slice(1));
  if (chapter.chapterNumber !== expectedNumber) {
    failPressureGameProjection(ERROR.INVALID_SOURCE, "chapter.chapterNumber", "CHAPTER_ID_MISMATCH");
  }
  string(chapter.title, "chapter.title");
  enumeration(chapter.phase, PHASES, "chapter.phase");
  integer(chapter.workingRevision, "chapter.workingRevision", 0);
}

function validateViewer(viewer: PressureChapterGameProjectionV1["viewer"]): void {
  string(viewer.roleName, "viewer.roleName");
  if (!PRESSURE_CHAPTER_SEAT_IDS_V1.includes(viewer.seatId)) {
    failPressureGameProjection(ERROR.INVALID_SOURCE, "viewer.seatId");
  }
  const control = viewer.control;
  enumeration(control.mode, ["HUMAN_ACTIVE", "AI_ACTIVE"] as const, "viewer.control.mode");
  integer(control.controlEpoch, "viewer.control.controlEpoch", 1);
  boolean(control.canSubmit, "viewer.control.canSubmit");
  boolean(control.canReclaim, "viewer.control.canReclaim");
  nullableHash(control.submissionFenceToken, "viewer.control.submissionFenceToken");
  nullableHash(control.reclaimFenceToken, "viewer.control.reclaimFenceToken");
  if (
    (control.canSubmit && control.submissionFenceToken === null) ||
    (!control.canSubmit && control.submissionFenceToken !== null) ||
    (control.canReclaim && control.reclaimFenceToken === null) ||
    (!control.canReclaim && control.reclaimFenceToken !== null) ||
    (control.canSubmit && control.canReclaim)
  ) {
    failPressureGameProjection(ERROR.VIEWER_DATA_UNSAFE, "viewer.control", "FENCE_CAPABILITY_MISMATCH");
  }
}

function validateSituation(situation: PressureChapterGameProjectionV1["situation"]): void {
  string(situation.goal, "situation.goal");
  string(situation.risk, "situation.risk");
  string(situation.judgment, "situation.judgment");
}

function sanitizeMetrics(metrics: PressureGameMetricProjectionV1[]): PressureGameMetricProjectionV1[] {
  if (!Array.isArray(metrics) || metrics.length !== TRACK_IDS_V1.length) {
    failPressureGameProjection(ERROR.INVALID_SOURCE, "metrics", "EXACTLY_FIVE");
  }
  const ordered = metrics
    .map((metric, index) => {
      string(metric.label, `metrics[${index}].label`);
      number(metric.value, `metrics[${index}].value`);
      string(metric.displayValue, `metrics[${index}].displayValue`);
      enumeration(metric.tone, METRIC_TONES, `metrics[${index}].tone`);
      if (!TRACK_IDS_V1.includes(metric.trackId)) {
        failPressureGameProjection(ERROR.INVALID_SOURCE, `metrics[${index}].trackId`);
      }
      return {
        trackId: metric.trackId,
        label: metric.label,
        value: metric.value,
        displayValue: metric.displayValue,
        tone: metric.tone,
      };
    })
    .sort(
      (left, right) =>
        TRACK_IDS_V1.indexOf(left.trackId) - TRACK_IDS_V1.indexOf(right.trackId),
    );
  if (ordered.some((metric, index) => metric.trackId !== TRACK_IDS_V1[index])) {
    failPressureGameProjection(ERROR.INVALID_SOURCE, "metrics", "MISSING_OR_DUPLICATE_TRACK");
  }
  return ordered;
}

function sanitizeResources(
  resources: PressureGameResourceProjectionV1[],
): PressureGameResourceProjectionV1[] {
  if (!Array.isArray(resources) || resources.length > 30) {
    failPressureGameProjection(ERROR.INVALID_SOURCE, "resources");
  }
  const result = resources.map((resource, index) => {
    string(resource.resourceId, `resources[${index}].resourceId`);
    string(resource.label, `resources[${index}].label`);
    number(resource.value, `resources[${index}].value`);
    string(resource.displayValue, `resources[${index}].displayValue`);
    return {
      resourceId: resource.resourceId,
      label: resource.label,
      value: resource.value,
      displayValue: resource.displayValue,
    };
  });
  assertUnique(result.map((resource) => resource.resourceId), "resources");
  return result.sort((left, right) => compareCanonicalText(left.resourceId, right.resourceId));
}

function sanitizeTokens(tokens: PressureGameTokenProjectionV1[]): PressureGameTokenProjectionV1[] {
  if (!Array.isArray(tokens) || tokens.length > 30) {
    failPressureGameProjection(ERROR.INVALID_SOURCE, "tokens");
  }
  const result = tokens.map((token, index) => {
    string(token.tokenId, `tokens[${index}].tokenId`);
    string(token.label, `tokens[${index}].label`);
    string(token.description, `tokens[${index}].description`);
    integer(token.quantity, `tokens[${index}].quantity`, 0);
    boolean(token.available, `tokens[${index}].available`);
    if (token.available !== (token.quantity > 0)) {
      failPressureGameProjection(ERROR.INVALID_SOURCE, `tokens[${index}].available`);
    }
    return {
      tokenId: token.tokenId,
      label: token.label,
      description: token.description,
      quantity: token.quantity,
      available: token.available,
    };
  });
  assertUnique(result.map((token) => token.tokenId), "tokens");
  return result.sort((left, right) => compareCanonicalText(left.tokenId, right.tokenId));
}

function sanitizeDecision(
  decision: PressureGameDecisionProjectionV1 | null,
  workingRevision: number,
): PressureGameDecisionProjectionV1 | null {
  if (decision === null) return null;
  string(decision.decisionPointId, "decision.decisionPointId");
  enumeration(decision.mode, DECISION_MODES, "decision.mode");
  enumeration(decision.requirement, ["REQUIRED", "NOT_REQUIRED"] as const, "decision.requirement");
  string(decision.title, "decision.title");
  string(decision.summary, "decision.summary");
  integer(decision.expectedWorkingRevision, "decision.expectedWorkingRevision", 0);
  if (decision.expectedWorkingRevision !== workingRevision) {
    failPressureGameProjection(ERROR.SCOPE_MISMATCH, "decision.expectedWorkingRevision");
  }
  if (!Array.isArray(decision.options) || decision.options.length < 1 || decision.options.length > 8) {
    failPressureGameProjection(ERROR.INVALID_SOURCE, "decision.options");
  }
  const options = decision.options.map((option, index) => {
    exactKeys(
      option,
      ["code", "label", "description", "actionType", "preferredEntry"],
      `decision.options[${index}]`,
    );
    string(option.code, `decision.options[${index}].code`);
    string(option.label, `decision.options[${index}].label`);
    string(option.description, `decision.options[${index}].description`);
    string(option.actionType, `decision.options[${index}].actionType`);
    const preferredEntry = enumeration(
      option.preferredEntry,
      WORKBENCH_ENTRIES,
      `decision.options[${index}].preferredEntry`,
    );
    return {
      code: option.code,
      label: option.label,
      description: option.description,
      actionType: option.actionType,
      preferredEntry,
    };
  });
  assertUnique(options.map((option) => option.code), "decision.options");
  string(decision.submitLabel, "decision.submitLabel");
  boolean(decision.customActionAllowed, "decision.customActionAllowed");
  return { ...decision, options };
}

function sanitizeCapabilities(value: PressureGameCapabilitiesV1): PressureGameCapabilitiesV1 {
  boolean(value.canSubmitDecision, "capabilities.canSubmitDecision");
  boolean(value.canReclaimControl, "capabilities.canReclaimControl");
  for (const key of WORKBENCH_CAPABILITY_KEYS) boolean(value[key], `capabilities.${key}`);
  if (!Array.isArray(value.allowedActionTypes) || value.allowedActionTypes.length > 30) {
    failPressureGameProjection(ERROR.INVALID_SOURCE, "capabilities.allowedActionTypes");
  }
  const allowedActionTypes = value.allowedActionTypes.map((item, index) =>
    string(item, `capabilities.allowedActionTypes[${index}]`),
  );
  assertUnique(allowedActionTypes, "capabilities.allowedActionTypes");
  allowedActionTypes.sort(compareCanonicalText);
  return { ...value, allowedActionTypes };
}

function assertCapabilitiesMatch(
  capabilities: PressureGameCapabilitiesV1,
  control: PressureChapterGameProjectionV1["viewer"]["control"],
  phase: PressureChapterGameProjectionV1["chapter"]["phase"],
  chapterId: PressureChapterGameProjectionV1["chapter"]["chapterId"],
  decision: PressureGameDecisionProjectionV1 | null,
  tokens: PressureGameTokenProjectionV1[],
): void {
  const canSubmit = Boolean(
    control.canSubmit &&
      phase === "ACTIVE" &&
      decision?.requirement === "REQUIRED",
  );
  if (
    capabilities.canSubmitDecision !== canSubmit ||
    capabilities.canReclaimControl !== control.canReclaim ||
    (capabilities.canUseToken && !tokens.some((token) => token.available)) ||
    (chapterId === "P0" && (
      decision !== null ||
      capabilities.canSubmitDecision ||
      WORKBENCH_CAPABILITY_KEYS.some((key) => capabilities[key])
    )) ||
    (decision &&
      decision.options.some(
        (option) => !capabilities.allowedActionTypes.includes(option.actionType),
      ))
  ) {
    failPressureGameProjection(ERROR.CAPABILITY_MISMATCH, "capabilities");
  }
}

function sanitizeNarrative(
  source: PressureGameNarrativeProjectionV1,
  chapterId: PressureChapterGameProjectionV1["chapter"]["chapterId"],
  workingRevision: number,
): PressureGameNarrativeProjectionV1 {
  const status = enumeration(
    source.status,
    ["PENDING", "GENERATING", "VALIDATING", "PUBLISHED", "FALLBACK_PUBLISHED", "FAILED_RETRYABLE"] as const,
    "narrative.status",
  );
  const projectionKind = enumeration(
    source.projectionKind,
    ["GENESIS_NARRATIVE", "BEAT_NARRATIVE", "CHAPTER_NARRATIVE"] as const,
    "narrative.projectionKind",
  );
  const sourceAuthority = enumeration(
    source.sourceAuthority,
    ["GENESIS_FROZEN", "CHAPTER_WORKING", "CHAPTER_FROZEN"] as const,
    "narrative.sourceAuthority",
  );
  const expectedAuthority = projectionKind === "GENESIS_NARRATIVE"
    ? "GENESIS_FROZEN"
    : projectionKind === "BEAT_NARRATIVE"
      ? "CHAPTER_WORKING"
      : "CHAPTER_FROZEN";
  const genesisNarrativeIsCurrentOpening = projectionKind === "GENESIS_NARRATIVE"
    && (chapterId === "P0" || (chapterId === "N1" && workingRevision === 0));
  const nonGenesisNarrativeIsCurrentChapter = projectionKind !== "GENESIS_NARRATIVE"
    && chapterId !== "P0";
  if (
    sourceAuthority !== expectedAuthority
    || (!genesisNarrativeIsCurrentOpening && !nonGenesisNarrativeIsCurrentChapter)
  ) {
    failPressureGameProjection(ERROR.SCOPE_MISMATCH, "narrative.projectionKind", "AUTHORITY_OR_CHAPTER");
  }
  string(source.sourceId, "narrative.sourceId");
  if (!isSha256(source.sourceCommitHash)) {
    failPressureGameProjection(ERROR.INVALID_SOURCE, "narrative.sourceCommitHash", "SHA256");
  }
  const published = status === "PUBLISHED" || status === "FALLBACK_PUBLISHED";
  if (published) {
    string(source.text, "narrative.text");
    if (!isSha256(source.contentHash)) {
      failPressureGameProjection(ERROR.INVALID_SOURCE, "narrative.contentHash", "SHA256");
    }
    const expectedMode = status === "PUBLISHED" ? "PROVIDER" : "AUTHORED_FALLBACK";
    if (source.renderMode !== expectedMode) {
      failPressureGameProjection(ERROR.INVALID_SOURCE, "narrative.renderMode", "STATUS_MISMATCH");
    }
  } else if (source.text !== null || source.contentHash !== null || source.renderMode !== null) {
    failPressureGameProjection(ERROR.VIEWER_DATA_UNSAFE, "narrative", "UNPUBLISHED_CONTENT_PRESENT");
  }
  return {
    status,
    projectionKind,
    sourceAuthority,
    sourceId: source.sourceId,
    sourceCommitHash: source.sourceCommitHash,
    text: source.text,
    contentHash: source.contentHash,
    renderMode: source.renderMode,
  };
}

function sanitizeFeedPage(
  page: AEmotionFeedSourcePagePortV1,
  scope: { roomId: string; runId: string; viewerSeatId: SeatIdV1 },
): AEmotionFeedPagePortV1 {
  if (
    page.schemaVersion !== "a_emotion_feed_page_v1" ||
    page.roomId !== scope.roomId ||
    page.runId !== scope.runId ||
    page.viewerSeatId !== scope.viewerSeatId ||
    !Array.isArray(page.items) ||
    page.items.length > 10
  ) {
    failPressureGameProjection(ERROR.SCOPE_MISMATCH, "feedPage");
  }
  integer(page.unreadCount, "feedPage.unreadCount", 0);
  integer(page.serverSequence, "feedPage.serverSequence", 0);
  if (page.nextCursor !== null) string(page.nextCursor, "feedPage.nextCursor");
  const items = page.items.map((item, index) => sanitizeFeedItem(item, scope, index));
  assertUnique(
    items.map((item) => `${item.eventId}:${item.projectionVersion}`),
    "feedPage.items",
  );
  return {
    schemaVersion: "a_emotion_feed_page_v1",
    ...scope,
    items,
    unreadCount: page.unreadCount,
    nextCursor: page.nextCursor,
    serverSequence: page.serverSequence,
  };
}

function sanitizeFeedItem(
  item: AEmotionFeedSourceItemPortV1,
  scope: { roomId: string; runId: string; viewerSeatId: SeatIdV1 },
  index: number,
): AEmotionFeedItemPortV1 {
  const path = `feedPage.items[${index}]`;
  if (
    item.schemaVersion !== "a_emotion_viewer_projection_v1" ||
    item.roomId !== scope.roomId ||
    item.runId !== scope.runId ||
    item.viewerSeatId !== scope.viewerSeatId ||
    !isSha256(item.projectionHash)
  ) {
    failPressureGameProjection(ERROR.SCOPE_MISMATCH, path);
  }
  string(item.eventId, `${path}.eventId`);
  integer(item.projectionVersion, `${path}.projectionVersion`, 1);
  string(item.title, `${path}.title`);
  string(item.safeSummary, `${path}.safeSummary`);
  string(item.statusLabel, `${path}.statusLabel`);
  const category = enumeration(item.category, ["RELATED", "PUBLIC", "SUSPICIOUS"] as const, `${path}.category`);
  const disclosure = enumeration(item.disclosure, ["HIDDEN", "SUSPECTED", "CONFIRMED"] as const, `${path}.disclosure`);
  const severity = enumeration(item.severity, ["MINOR", "MAJOR", "CRITICAL"] as const, `${path}.severity`);
  const recommendedPresentation = enumeration(
    item.recommendedPresentation,
    ["FEED_ONLY", "CENTER_CARD", "KEY_MODAL"] as const,
    `${path}.recommendedPresentation`,
  );
  integer(item.eventSequence, `${path}.eventSequence`, 1);
  string(item.occurredAt, `${path}.occurredAt`);
  boolean(item.isUnread, `${path}.isUnread`);
  boolean(item.isAcknowledged, `${path}.isAcknowledged`);
  boolean(item.isResolved, `${path}.isResolved`);
  const hasSource = Object.prototype.hasOwnProperty.call(item, "visibleSourceSeatId");
  const hasSuspected = Object.prototype.hasOwnProperty.call(item, "visibleSuspectedSeatIds");
  if (
    (disclosure === "HIDDEN" && (hasSource || hasSuspected)) ||
    (disclosure === "SUSPECTED" && (hasSource || !hasSuspected)) ||
    (disclosure === "CONFIRMED" && (!hasSource || hasSuspected))
  ) {
    failPressureGameProjection(ERROR.VIEWER_DATA_UNSAFE, path, "DISCLOSURE_FIELDS");
  }
  const visibleImpacts = sanitizeVisibleImpacts(item.visibleImpacts, `${path}.visibleImpacts`);
  const knownFactRefs = sanitizeStringArray(item.knownFactRefs, `${path}.knownFactRefs`, 100);
  const responseOptions = sanitizeCardActions(item.responseOptions, `${path}.responseOptions`);
  const centerCard = item.centerCard === null
    ? null
    : sanitizeCenterCard(item.centerCard, item.eventId, `${path}.centerCard`);
  const keyModal = item.keyModal === null
    ? null
    : sanitizeKeyModal(
      item.keyModal,
      centerCard,
      item.eventId,
      item.viewerSeatId,
      item.eventSequence,
      `${path}.keyModal`,
    );
  if (
    (recommendedPresentation === "FEED_ONLY" && (
      keyModal !== null || (centerCard !== null && centerCard.type !== "CROSS_IMPACT")
    )) ||
    (recommendedPresentation === "CENTER_CARD" && (centerCard === null || keyModal !== null)) ||
    (recommendedPresentation === "KEY_MODAL" && (centerCard === null || keyModal === null))
  ) {
    failPressureGameProjection(ERROR.INVALID_SOURCE, `${path}.recommendedPresentation`, "PRESENTATION_SHAPE");
  }
  // Select only the established viewer projection vocabulary. Extra source
  // fields are deliberately dropped at this API boundary.
  const projectionWithoutHash: Omit<
    AEmotionFeedSourceItemPortV1,
    "projectionHash" | "isUnread" | "isAcknowledged" | "isResolved"
  > = {
    schemaVersion: "a_emotion_viewer_projection_v1",
    eventId: item.eventId,
    projectionVersion: item.projectionVersion,
    roomId: scope.roomId,
    runId: scope.runId,
    viewerSeatId: scope.viewerSeatId,
    category,
    disclosure,
    severity,
    title: item.title,
    safeSummary: item.safeSummary,
    statusLabel: item.statusLabel,
    visibleImpacts,
    knownFactRefs,
    responseOptions,
    recommendedPresentation,
    centerCard,
    keyModal,
    eventSequence: item.eventSequence,
    occurredAt: item.occurredAt,
  };
  if (disclosure === "CONFIRMED") {
    projectionWithoutHash.visibleSourceSeatId = sanitizeSeat(item.visibleSourceSeatId, `${path}.visibleSourceSeatId`);
  }
  if (disclosure === "SUSPECTED") {
    const suspected = sanitizeSeatArray(item.visibleSuspectedSeatIds, `${path}.visibleSuspectedSeatIds`);
    projectionWithoutHash.visibleSuspectedSeatIds = suspected;
  }
  if (sha256Canonical(projectionWithoutHash) !== item.projectionHash) {
    failPressureGameProjection(ERROR.VIEWER_DATA_UNSAFE, `${path}.projectionHash`, "HASH_MISMATCH");
  }
  const {
    knownFactRefs: _internalKnownFactRefs,
    ...viewerSafeProjection
  } = projectionWithoutHash;
  return {
    ...viewerSafeProjection,
    projectionHash: item.projectionHash,
    isUnread: item.isUnread,
    isAcknowledged: item.isAcknowledged,
    isResolved: item.isResolved,
  };
}

function sanitizeVisibleImpacts(
  value: AEmotionFeedSourceItemPortV1["visibleImpacts"],
  path: string,
): AEmotionFeedItemPortV1["visibleImpacts"] {
  if (!Array.isArray(value) || value.length > 30) {
    failPressureGameProjection(ERROR.INVALID_SOURCE, path, "ARRAY");
  }
  return value.map((impact, index) => {
    const itemPath = `${path}[${index}]`;
    string(impact.effectCode, `${itemPath}.effectCode`);
    string(impact.label, `${itemPath}.label`);
    string(impact.value, `${itemPath}.value`);
    return { effectCode: impact.effectCode, label: impact.label, value: impact.value };
  });
}

function sanitizeCardActions(
  value: AEmotionFeedSourceItemPortV1["responseOptions"],
  path: string,
): AEmotionFeedItemPortV1["responseOptions"] {
  if (!Array.isArray(value) || value.length > 10) {
    failPressureGameProjection(ERROR.INVALID_SOURCE, path, "ARRAY");
  }
  return value.map((action, index) => sanitizeCardAction(action, `${path}[${index}]`));
}

function sanitizeCardAction(
  action: AEmotionFeedSourceItemPortV1["responseOptions"][number],
  path: string,
): AEmotionFeedItemPortV1["responseOptions"][number] {
  string(action.code, `${path}.code`);
  string(action.label, `${path}.label`);
  const preferredEntry = enumeration(
    action.preferredEntry,
    ["TALK", "INVESTIGATE", "TOKEN", "PLAN", "DEFER"] as const,
    `${path}.preferredEntry`,
  );
  boolean(action.consumesManeuverOnSubmit, `${path}.consumesManeuverOnSubmit`);
  return {
    code: action.code,
    label: action.label,
    preferredEntry,
    consumesManeuverOnSubmit: action.consumesManeuverOnSubmit,
  };
}

function sanitizeCenterCard(
  card: NonNullable<AEmotionFeedSourceItemPortV1["centerCard"]>,
  eventId: string,
  path: string,
): NonNullable<AEmotionFeedItemPortV1["centerCard"]> {
  string(card.id, `${path}.id`);
  const type = enumeration(
    card.type,
    ["CROSS_IMPACT", "PROMISE_BROKEN", "CRISIS", "STAGE_VICTORY"] as const,
    `${path}.type`,
  );
  const expectedAccent = type === "STAGE_VICTORY" ? "GREEN" : type === "CROSS_IMPACT" ? "PURPLE" : "ORANGE_RED";
  if (card.accent !== expectedAccent || card.sourceEventId !== eventId) {
    failPressureGameProjection(ERROR.INVALID_SOURCE, path, "CARD_SCOPE");
  }
  string(card.title, `${path}.title`);
  string(card.summary, `${path}.summary`);
  return {
    id: card.id,
    type,
    accent: expectedAccent,
    title: card.title,
    summary: card.summary,
    blockA: sanitizeCardBlock(card.blockA, `${path}.blockA`),
    blockB: sanitizeCardBlock(card.blockB, `${path}.blockB`),
    primaryAction: sanitizeCardAction(card.primaryAction, `${path}.primaryAction`),
    secondaryAction: sanitizeCardAction(card.secondaryAction, `${path}.secondaryAction`),
    tertiaryAction: sanitizeCardAction(card.tertiaryAction, `${path}.tertiaryAction`),
    sourceEventId: eventId,
  };
}

function sanitizeCardBlock(
  block: NonNullable<AEmotionFeedItemPortV1["centerCard"]>["blockA"],
  path: string,
): NonNullable<AEmotionFeedItemPortV1["centerCard"]>["blockA"] {
  string(block.title, `${path}.title`);
  const lines = sanitizeStringArray(block.lines, `${path}.lines`, 4);
  if (lines.length === 0) failPressureGameProjection(ERROR.INVALID_SOURCE, `${path}.lines`, "EMPTY");
  return { title: block.title, lines };
}

function sanitizeKeyModal(
  modal: NonNullable<AEmotionFeedSourceItemPortV1["keyModal"]>,
  card: AEmotionFeedItemPortV1["centerCard"],
  eventId: string,
  viewerSeatId: SeatIdV1,
  eventSequence: number,
  path: string,
): NonNullable<AEmotionFeedItemPortV1["keyModal"]> {
  string(modal.id, `${path}.id`);
  const type = enumeration(modal.type, ["PROMISE_BROKEN", "CRISIS", "STAGE_VICTORY"] as const, `${path}.type`);
  const expectedPriority = type === "CRISIS" ? 300 : type === "PROMISE_BROKEN" ? 200 : 100;
  if (!card || card.type !== type || modal.priority !== expectedPriority) {
    failPressureGameProjection(ERROR.INVALID_SOURCE, path, "MODAL_CARD");
  }
  string(modal.triggerId, `${path}.triggerId`);
  integer(modal.stateVersion, `${path}.stateVersion`, 1);
  string(modal.dedupeKey, `${path}.dedupeKey`);
  integer(modal.serverSequence, `${path}.serverSequence`, 1);
  string(modal.sourceEventId, `${path}.sourceEventId`);
  if (
    modal.serverSequence !== eventSequence
    || modal.sourceEventId !== eventId
    || modal.dedupeKey !== [viewerSeatId, type, modal.triggerId, modal.stateVersion].join(":")
  ) {
    failPressureGameProjection(ERROR.INVALID_SOURCE, path, "MODAL_IDENTITY");
  }
  const modalCard = sanitizeCenterCard(modal.card, eventId, `${path}.card`);
  if (modalCard.id !== card.id || sha256Canonical(modalCard) !== sha256Canonical(card)) {
    failPressureGameProjection(ERROR.INVALID_SOURCE, `${path}.card`, "MODAL_CARD_MISMATCH");
  }
  return {
    id: modal.id,
    type,
    priority: expectedPriority,
    serverSequence: eventSequence,
    sourceEventId: eventId,
    triggerId: modal.triggerId,
    stateVersion: modal.stateVersion,
    dedupeKey: modal.dedupeKey,
    card: modalCard,
  };
}

function sanitizeStringArray(value: unknown, path: string, maximum: number): string[] {
  if (!Array.isArray(value) || value.length > maximum) {
    failPressureGameProjection(ERROR.INVALID_SOURCE, path, "ARRAY");
  }
  return value.map((item, index) => string(item, `${path}[${index}]`));
}

function sanitizeSeat(value: unknown, path: string): SeatIdV1 {
  if (!PRESSURE_CHAPTER_SEAT_IDS_V1.includes(value as SeatIdV1)) {
    failPressureGameProjection(ERROR.VIEWER_DATA_UNSAFE, path, "SEAT_ID");
  }
  return value as SeatIdV1;
}

function sanitizeSeatArray(value: unknown, path: string): SeatIdV1[] {
  if (!Array.isArray(value) || value.length > PRESSURE_CHAPTER_SEAT_IDS_V1.length) {
    failPressureGameProjection(ERROR.VIEWER_DATA_UNSAFE, path, "SEAT_ARRAY");
  }
  const seats = value.map((seatId, index) => sanitizeSeat(seatId, `${path}[${index}]`));
  assertUnique(seats, path);
  return seats.sort(compareCanonicalText);
}

function exactKeys(
  value: unknown,
  expected: readonly string[],
  path: string,
): void {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    failPressureGameProjection(ERROR.INVALID_SOURCE, path, "OBJECT");
  }
  const actual = Object.keys(value as Record<string, unknown>).sort(compareCanonicalText);
  const canonicalExpected = [...expected].sort(compareCanonicalText);
  if (
    actual.length !== canonicalExpected.length
    || actual.some((key, index) => key !== canonicalExpected[index])
  ) {
    failPressureGameProjection(ERROR.INVALID_SOURCE, path, "EXACT_KEYS");
  }
}

function same(expected: string, actual: string, path: string): void {
  if (actual !== expected) failPressureGameProjection(ERROR.SCOPE_MISMATCH, path);
}

function assertUnique(values: string[], path: string): void {
  if (new Set(values).size !== values.length) {
    failPressureGameProjection(ERROR.INVALID_SOURCE, path, "DUPLICATE");
  }
}

function string(value: unknown, path: string): string {
  if (typeof value !== "string" || !NON_EMPTY.test(value) || value.length > 2_000) {
    failPressureGameProjection(ERROR.INVALID_SOURCE, path, "NON_EMPTY_STRING");
  }
  return value;
}

function integer(
  value: unknown,
  path: string,
  minimum: number,
  maximum = Number.MAX_SAFE_INTEGER,
): number {
  if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > maximum) {
    failPressureGameProjection(ERROR.INVALID_SOURCE, path, "INTEGER_RANGE");
  }
  return Number(value);
}

function number(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    failPressureGameProjection(ERROR.INVALID_SOURCE, path, "FINITE_NUMBER");
  }
  return value;
}

function boolean(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") {
    failPressureGameProjection(ERROR.INVALID_SOURCE, path, "BOOLEAN");
  }
  return value;
}

function nullableHash(value: unknown, path: string): void {
  if (value !== null && !isSha256(value)) {
    failPressureGameProjection(ERROR.VIEWER_DATA_UNSAFE, path, "SHA256_OR_NULL");
  }
}

function enumeration<T extends string>(
  value: unknown,
  allowed: readonly T[],
  path: string,
): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    failPressureGameProjection(ERROR.INVALID_SOURCE, path, "ENUM");
  }
  return value as T;
}
