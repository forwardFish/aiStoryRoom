import {
  isSha256,
  sha256Canonical,
  type OpenNovelNarrativeProjectionJobV1,
  type SeatIdV1,
} from "@ai-story/shared";
import { createSangtianAEmotionContentSourceCompilerV1 } from "../a-emotion-production/content-source";
import {
  decodeAggregateEnvelope,
  decodeDeliveryMark,
  decodeDeliverySeed,
  deliverySeedToRecord,
} from "../a-emotion-persistence/codec";
import { projectAEmotionFeedPageV1 } from "../a-emotion/feed.service";
import type { AEmotionDeliveryRecordV1 } from "../a-emotion/ports";
import type { ContentOwnedChapterPolicyPort } from "../chapter-settlement/types";
import type {
  ProjectPressureChapterGameProjectionFromSourcesV1,
  PressureGameViewerSourceV1,
} from "../game-projection/contracts";
import type { SangtianPressureGameContentMapperV1 } from "../integration/content.adapters";
import { createNarrativeProjectionMetaV1 } from "../persistence/narrative.prisma-adapter";
import { PRESSURE_NARRATIVE_PRODUCTION_RELEASE_V1 } from "../narrative-production/published-profile-resolver";
import {
  buildNarrativeProjectionIdentityV1,
  buildAuthorityDownstreamManifestV1,
  downstreamDedupeKeysV1,
  planNarrativeProjectionJobsV1,
} from "../projection-plan/authority-downstream";
import { planInteractiveNarrativeAudiencesV1 } from "../projection-plan/interactive-audience";
import type { PressureSeatViewerPresentationCatalogV1 } from "../seat-control-persistence";
import { planN1DecisionToN2SettlementV1, type N2AuthoredChapterContentAuthorityPortV1, type N2ChapterWorkingSeedAuthorityPortV1 } from "./settlement-planner";
import {
  PressureSql7CommitErrorV1,
  type PressureSql7NarrativeProjectionRowV1,
  type PressureSql7OutboxTaskRowV1,
} from "./commit-contract";
import type {
  PressureSql7SettlementN2PreparedInputsPortV1,
  PressureSql7SettlementN2PreparedInputsV1,
} from "./plan-builder";

interface CapturedSeatCatalogV1 {
  readCatalogFromRoute(input: Readonly<{
    routeSnapshot: { contentPackageVersion: string; contentPackageSha256: string };
    seatId: SeatIdV1;
  }>): PressureSeatViewerPresentationCatalogV1;
}

/**
 * Production preparation seam for the SQL7 path. All database-backed facts
 * come from the captured snapshot; the injected ports below are package-only
 * deterministic planners and therefore cannot introduce another SQL read.
 */
export class PressureSql7PreparedInputsAdapterV1
implements PressureSql7SettlementN2PreparedInputsPortV1 {
  constructor(
    private readonly settlementPolicy: ContentOwnedChapterPolicyPort,
    private readonly nextContent: N2AuthoredChapterContentAuthorityPortV1,
    private readonly nextSeed: N2ChapterWorkingSeedAuthorityPortV1,
    private readonly gameContent: Pick<
      SangtianPressureGameContentMapperV1,
      "chapterTitle" | "decisionForSeat" | "metrics"
    >,
    private readonly seatCatalog: CapturedSeatCatalogV1,
  ) {}

  async prepare(
    input: Parameters<PressureSql7SettlementN2PreparedInputsPortV1["prepare"]>[0],
  ): Promise<PressureSql7SettlementN2PreparedInputsV1> {
    const settlement = await planN1DecisionToN2SettlementV1({
      snapshot: input.snapshot,
      batch: input.batch,
      settlementPolicy: this.settlementPolicy,
      nextContent: this.nextContent,
      nextSeed: this.nextSeed,
    });
    const record = settlement.atomicRecord;
    const now = new Date(input.nowMs);
    const downstream = prepareDownstreamRows(
      record,
      settlement.postBeatProjection,
      now,
      input.snapshot.routeSnapshot.humanSeatIdsAtStart,
    );
    const resolvedProjectionSources = prepareProjectionSources({
      snapshot: input.snapshot,
      settlement,
      downstream,
      gameContent: this.gameContent,
      seatCatalog: this.seatCatalog,
    });
    return {
      settlementSource: settlement.settlementSource,
      domain: {
        actionLedger: settlement.actionLedger,
        beat: {
          status: "PLANNED",
          event: settlement.beatPlan.event,
          resolution: settlement.beatPlan.resolution,
        },
        beatInput: {
          resolverVersion: settlement.beatPlan.resolution.resolverVersion,
        },
        postBeatProjection: settlement.postBeatProjection,
        settlementInput: settlement.settlementInput,
        seatParticipation: settlement.seatParticipation,
        settlementMaterial: settlement.settlementMaterial,
        settlementCommand: settlement.settlementCommand,
        settlementPolicyEvaluation: settlement.settlementPolicyEvaluation,
        settlementRecord: record,
        frozenOrchestratorState: settlement.frozenOrchestratorState,
        nextChapter: settlement.nextChapterDescriptor,
        nextWorkingSeed: settlement.nextWorkingSeed,
        nextOpeningNowMs: settlement.nextOpeningNowMs,
        nextOpening: settlement.nextChapterOpening,
      },
      downstream: {
        narrativeProjections: downstream.narrativeProjections,
        aEmotionStoryEvents: [],
        outboxTasks: downstream.outboxTasks,
        settlementDownstreamManifest: downstream.settlementDownstreamManifest,
      },
      resolvedProjectionSources,
    };
  }
}

function prepareDownstreamRows(
  record: Awaited<ReturnType<typeof planN1DecisionToN2SettlementV1>>["atomicRecord"],
  projection: Awaited<ReturnType<typeof planN1DecisionToN2SettlementV1>>["postBeatProjection"],
  committedAt: Date,
  humanSeatIds: readonly string[],
) {
  const bundle = record.frozenChapterBundle;
  const narrativeJobs = planNarrativeProjectionJobsV1({
    runId: record.runId,
    projectionKind: "CHAPTER_NARRATIVE",
    sourceAuthority: "CHAPTER_FROZEN",
    sourceId: bundle.bundleHash,
    sourceCommitHash: bundle.bundleHash,
    sourceContentHash: bundle.frozenWorldState.stateHash,
    audiences: planInteractiveNarrativeAudiencesV1({ humanSeatIds }),
  }, {
    runId: record.runId,
    bundleHash: bundle.bundleHash,
    frozenWorldStateJson: bundle.frozenWorldState,
    causalEdgesJson: bundle.causalEdges,
    carryForwardJson: bundle.carryForward,
  });
  const emissions = createSangtianAEmotionContentSourceCompilerV1()
    .compileChapterProjection({
      sourceKind: "CHAPTER_SETTLEMENT_COMMITTED",
      roomId: record.runId,
      committedAt: committedAt.toISOString(),
      record,
      projection,
    });
  const settlementDownstreamManifest = buildAuthorityDownstreamManifestV1({
    authorityKind: "CHAPTER",
    sourceId: record.receipt.settlementId,
    sourceCommitHash: record.receipt.commitHash,
    dedupeKeys: downstreamDedupeKeysV1({
      existing: [record.outbox.dedupeKey],
      narrativeJobs,
      aEmotionEmissions: emissions,
    }),
  });
  const narrativeProjections = narrativeJobs.map((job) =>
    narrativeProjectionRow(job, committedAt));
  const outboxTasks: PressureSql7OutboxTaskRowV1[] = [
    outboxRow({
      runId: record.runId,
      taskType: record.outbox.taskType,
      dedupeKey: record.outbox.dedupeKey,
      sourceAuthority: "CHAPTER_FROZEN",
      sourceId: bundle.bundleHash,
      sourceCommitHash: record.receipt.commitHash,
      payloadJson: record.outbox,
      payloadHash: record.outbox.outboxHash,
      now: committedAt,
    }),
    ...narrativeJobs.map((job) => outboxRow({
      runId: job.runId,
      taskType: "PROJECT_CHAPTER_NARRATIVE",
      dedupeKey: job.idempotencyKey,
      sourceAuthority: job.sourceAuthority,
      sourceId: job.sourceId,
      sourceCommitHash: job.sourceCommitHash,
      payloadJson: job,
      payloadHash: sha256Canonical(job),
      now: committedAt,
    })),
    ...emissions.map((emission) => outboxRow({
      runId: emission.job.runId,
      taskType: "INTERACTION_COMPILE_REQUESTED",
      dedupeKey: emission.dedupeKey,
      sourceAuthority: "CHAPTER_FROZEN",
      sourceId: emission.job.sourceId,
      sourceCommitHash: emission.job.sourceCommitHash,
      payloadJson: emission.job,
      payloadHash: sha256Canonical(emission.job),
      now: committedAt,
    })),
  ];
  return { narrativeJobs, narrativeProjections, outboxTasks, settlementDownstreamManifest };
}

function narrativeProjectionRow(
  job: OpenNovelNarrativeProjectionJobV1,
  now: Date,
): PressureSql7NarrativeProjectionRowV1 {
  const projectorVersion = PRESSURE_NARRATIVE_PRODUCTION_RELEASE_V1.projectorVersion;
  const identity = buildNarrativeProjectionIdentityV1(job, projectorVersion);
  return {
    id: `sql7_np_${sha256Canonical({ jobId: job.jobId, projectorVersion }).slice(0, 40)}`,
    runId: job.runId,
    projectionKind: job.projectionKind,
    sourceAuthority: job.sourceAuthority,
    sourceId: job.sourceId,
    sourceCommitHash: job.sourceCommitHash,
    sourceContentHash: job.sourceContentHash,
    narrativeProfileVersion: job.narrativeProfileVersion,
    projectorVersion,
    audienceKind: job.audience.kind,
    audienceSeatId: job.audience.seatId,
    audienceKey: job.audience.kind === "PUBLIC" ? "public" : job.audience.seatId!,
    status: "PENDING",
    requestFingerprint: identity.requestFingerprint,
    attempt: 0,
    maxAttempts: 3,
    checkpoint: "PERSISTED",
    artifactJson: null,
    artifactContentHash: null,
    leaseOwner: null,
    leaseExpiresAt: null,
    leaseVersion: 0,
    lastError: createNarrativeProjectionMetaV1({
      logicalProjectionKey: identity.logicalProjectionKey,
      jobId: job.jobId,
    }),
    createdAt: new Date(now),
    updatedAt: new Date(now),
    publishedAt: null,
  };
}

function outboxRow(input: Omit<PressureSql7OutboxTaskRowV1,
  "id" | "status" | "checkpoint" | "attempt" | "maxAttempts" | "availableAt"
  | "leaseOwner" | "leaseExpiresAt" | "leaseVersion" | "lastError" | "createdAt"
  | "updatedAt" | "completedAt"> & { now: Date }): PressureSql7OutboxTaskRowV1 {
  return {
    id: `sql7_ob_${sha256Canonical({ dedupeKey: input.dedupeKey }).slice(0, 40)}`,
    runId: input.runId,
    taskType: input.taskType,
    status: "PENDING",
    checkpoint: "PERSISTED",
    dedupeKey: input.dedupeKey,
    sourceAuthority: input.sourceAuthority,
    sourceId: input.sourceId,
    sourceCommitHash: input.sourceCommitHash,
    payloadJson: structuredClone(input.payloadJson),
    payloadHash: input.payloadHash,
    attempt: 0,
    maxAttempts: 5,
    availableAt: new Date(input.now),
    leaseOwner: null,
    leaseExpiresAt: null,
    leaseVersion: 0,
    lastError: null,
    createdAt: new Date(input.now),
    updatedAt: new Date(input.now),
    completedAt: null,
  };
}

function prepareProjectionSources(input: {
  snapshot: Parameters<PressureSql7SettlementN2PreparedInputsPortV1["prepare"]>[0]["snapshot"];
  settlement: Awaited<ReturnType<typeof planN1DecisionToN2SettlementV1>>;
  downstream: ReturnType<typeof prepareDownstreamRows>;
  gameContent: Pick<SangtianPressureGameContentMapperV1, "chapterTitle" | "decisionForSeat" | "metrics">;
  seatCatalog: CapturedSeatCatalogV1;
}): ProjectPressureChapterGameProjectionFromSourcesV1 {
  const { snapshot, settlement } = input;
  const next = settlement.nextChapterOpening;
  const viewerSeatId = snapshot.viewer.roleKey;
  const viewerSource = prepareViewerSource(snapshot, input.seatCatalog);
  const seatNarrative = input.downstream.narrativeJobs.find(
    (job) => job.audience.kind === "SEAT" && job.audience.seatId === viewerSeatId,
  );
  if (!seatNarrative) invalid("N2 seat narrative projection is missing");
  return {
    roomId: snapshot.request.roomId,
    runId: snapshot.world.runId,
    subjectId: snapshot.request.subjectId,
    routeSnapshot: structuredClone(snapshot.routeSnapshot),
    viewerSeatId,
    chapter: structuredClone(next.state),
    workingProjection: structuredClone(next.projection),
    chapterDescriptor: structuredClone(settlement.nextChapterDescriptor),
    viewerSource,
    worldSource: {
      runId: snapshot.world.runId,
      routeHash: snapshot.routeSnapshot.routeHash,
      worldSequence: settlement.atomicRecord.receipt.committedWorldSequence,
      worldStateHash: settlement.atomicRecord.receipt.committedWorldStateHash,
      metrics: input.gameContent.metrics(settlement.atomicRecord.frozenChapterBundle.frozenWorldState),
    },
    narrativeSource: {
      runId: snapshot.world.runId,
      routeHash: snapshot.routeSnapshot.routeHash,
      viewerSeatId,
      chapterRuntimeId: next.chapterRuntimeId,
      status: "PENDING",
      projectionKind: "CHAPTER_NARRATIVE",
      sourceAuthority: "CHAPTER_FROZEN",
      sourceId: seatNarrative.sourceId,
      sourceCommitHash: seatNarrative.sourceCommitHash,
      text: null,
      contentHash: null,
      renderMode: null,
    },
    feedPage: prepareFeedPage(snapshot),
  };
}

function prepareViewerSource(
  snapshot: Parameters<PressureSql7SettlementN2PreparedInputsPortV1["prepare"]>[0]["snapshot"],
  catalogPort: CapturedSeatCatalogV1,
): PressureGameViewerSourceV1 {
  const privateRecord = snapshot.viewerPrivateProjection;
  if (
    privateRecord.runId !== snapshot.world.runId
    || privateRecord.seatId !== snapshot.viewer.roleKey
    || privateRecord.sourceAuthorityHash !== snapshot.seatAuthority.stateHash
    || !isSha256(privateRecord.payloadHash)
    || sha256Canonical(privateRecord.payload) !== privateRecord.payloadHash
  ) invalid("captured viewer private projection is invalid");
  const payload = privateRecord.payload as {
    schemaVersion?: unknown;
    situation?: { goal?: unknown; risk?: unknown; judgment?: unknown };
    resources?: Array<{ resourceId?: unknown; value?: unknown; displayValue?: unknown }>;
    tokens?: Array<{ tokenId?: unknown; quantity?: unknown; available?: unknown }>;
  };
  if (
    payload.schemaVersion !== "pressure_game_viewer_private_payload_v1"
    || typeof payload.situation?.goal !== "string"
    || typeof payload.situation.risk !== "string"
    || typeof payload.situation.judgment !== "string"
    || !Array.isArray(payload.resources)
    || !Array.isArray(payload.tokens)
  ) invalid("captured viewer private payload is invalid");
  const catalog = catalogPort.readCatalogFromRoute({
    routeSnapshot: snapshot.routeSnapshot,
    seatId: snapshot.viewer.roleKey,
  });
  const roleName = catalog.roleNames[snapshot.viewer.roleKey];
  if (!roleName?.trim() || roleName !== snapshot.viewer.roleName) {
    invalid("captured viewer role is not package-bound");
  }
  const control = snapshot.submitSeat;
  const viewerIsActive = control.mode === "HUMAN_ACTIVE"
    && control.activeControllerId === snapshot.request.subjectId;
  return {
    roomId: snapshot.request.roomId,
    runId: snapshot.world.runId,
    routeHash: snapshot.routeSnapshot.routeHash,
    subjectId: snapshot.request.subjectId,
    viewer: {
      seatId: snapshot.viewer.roleKey,
      roleName,
      control: {
        mode: control.mode,
        controlEpoch: control.controlEpoch,
        canSubmit: viewerIsActive,
        canReclaim: control.mode === "AI_ACTIVE" && snapshot.seatAuthority.frozenPolicy.humanReclaimAllowed,
        submissionFenceToken: viewerIsActive ? control.submissionFenceToken : null,
        reclaimFenceToken: control.mode === "AI_ACTIVE" ? control.reclaimFenceToken : null,
      },
    },
    situation: {
      goal: payload.situation.goal,
      risk: payload.situation.risk,
      judgment: payload.situation.judgment,
    },
    resources: payload.resources.map((item) => {
      if (typeof item.resourceId !== "string" || typeof item.value !== "number" || typeof item.displayValue !== "string") {
        return invalid("captured viewer resource is invalid");
      }
      const label = catalog.resources[item.resourceId]?.label;
      if (!label?.trim()) invalid("captured viewer resource is not published");
      return { resourceId: item.resourceId, label, value: item.value, displayValue: item.displayValue };
    }),
    tokens: payload.tokens.map((item) => {
      if (typeof item.tokenId !== "string" || typeof item.quantity !== "number" || typeof item.available !== "boolean") {
        return invalid("captured viewer token is invalid");
      }
      const meta = catalog.tokens[item.tokenId];
      if (!meta?.label.trim() || !meta.description.trim()) invalid("captured viewer token is not published");
      return { tokenId: item.tokenId, label: meta.label, description: meta.description, quantity: item.quantity, available: item.available };
    }),
  };
}

function prepareFeedPage(
  snapshot: Parameters<PressureSql7SettlementN2PreparedInputsPortV1["prepare"]>[0]["snapshot"],
) {
  const aggregates = snapshot.projectionSeed.aEmotionAggregateRows.map(
    (row) => decodeAggregateEnvelope(row.payloadJson).commit.aggregate,
  );
  const marks = snapshot.projectionSeed.aEmotionDeliveryMarkRows
    .map((row) => decodeDeliveryMark(row.payloadJson))
    .filter((mark) => mark.runId === snapshot.world.runId && mark.viewerSeatId === snapshot.viewer.roleKey)
    .sort((left, right) => left.occurredAt.localeCompare(right.occurredAt));
  const deliveries = snapshot.projectionSeed.viewerDeliveryRows.map((row) => ({
    row,
    seed: decodeDeliverySeed(row.payloadJson),
  }));
  const rows = aggregates
    .filter((aggregate) => aggregate.viewerSeatId === snapshot.viewer.roleKey)
    .map((aggregate) => {
      const match = deliveries.find(({ row, seed }) =>
        row.eventId === aggregate.projection.eventId
        && seed.viewerSeatId === snapshot.viewer.roleKey
        && seed.projectionVersion === aggregate.projection.projectionVersion);
      if (!match) invalid("captured A-Emotion delivery is missing");
      const delivery = deliverySeedToRecord(aggregate, {
        ...match.seed,
        eventId: aggregate.projection.eventId,
      });
      delivery.deliveredAt = isoDate(match.row.deliveredAt, "EventDelivery.deliveredAt");
      applyDeliveryMarks(delivery, marks);
      return { aggregate, delivery };
    });
  return projectAEmotionFeedPageV1({
    roomId: snapshot.request.roomId,
    runId: snapshot.world.runId,
    viewerSeatId: snapshot.viewer.roleKey,
    cursor: null,
    limit: 10,
  }, rows);
}

function applyDeliveryMarks(
  delivery: AEmotionDeliveryRecordV1,
  marks: ReturnType<typeof decodeDeliveryMark>[],
): void {
  for (const mark of marks) {
    if (mark.eventId !== delivery.eventId || mark.projectionVersion !== delivery.projectionVersion) continue;
    if (mark.operation === "SEEN") delivery.seenAt ??= mark.occurredAt;
    if (mark.operation === "ACKNOWLEDGED") delivery.acknowledgedAt ??= mark.occurredAt;
    if (mark.operation === "RESOLVED") delivery.resolvedAt ??= mark.occurredAt;
    if (mark.operation === "MODAL_SHOWN") delivery.keyModalShownAt ??= mark.occurredAt;
  }
}

function isoDate(value: unknown, path: string): string {
  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.getTime())) invalid(`${path} is invalid`);
  return date.toISOString();
}

function invalid(message: string): never {
  throw new PressureSql7CommitErrorV1("INVALID_PLAN", message);
}
