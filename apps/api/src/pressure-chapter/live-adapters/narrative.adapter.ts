import {
  computeNarrativeArtifactContentHash,
  isSha256,
  sha256Canonical,
  validateOpenNovelNarrativeArtifactV1,
  type OpenNovelNarrativeArtifactV1,
  type SeatIdV1,
} from "@ai-story/shared";
import type { PrismaService } from "../../prisma.service";
import type {
  PressureGameNarrativeReaderPort,
  PressureGameNarrativeSourceV1,
} from "../game-projection/contracts";
import { validateAtomicChapterCommitRecordV1 } from "../chapter-settlement";
import { validateCommittedGenesis } from "../genesis";
import {
  pressureSerializableTransaction,
  type PressureSerializableClient,
} from "../persistence/transaction";
import {
  PRESSURE_LIVE_ADAPTER_ERROR_CODES as ERROR,
  failLiveAdapter,
} from "./errors";

const NARRATIVE_STATUSES = Object.freeze([
  "PENDING",
  "GENERATING",
  "VALIDATING",
  "PUBLISHED",
  "FALLBACK_PUBLISHED",
  "FAILED_RETRYABLE",
] as const);

type NarrativeStatus = (typeof NARRATIVE_STATUSES)[number];
type ProjectionKind = "GENESIS_NARRATIVE" | "BEAT_NARRATIVE" | "CHAPTER_NARRATIVE";
type SourceAuthority = "GENESIS_FROZEN" | "CHAPTER_WORKING" | "CHAPTER_FROZEN";

interface NarrativeRuntimeRowV1 {
  id: string;
  runId: string;
  chapterId: string;
  routeHash: string;
  state: string;
  // Test/legacy read-model compatibility only. Production selects neither
  // retired relation and resolves authority from Settlement/StoryEvent.
  frozenBundle?: {
    runId: string;
    chapterRuntimeId: string;
    bundleHash: string;
  } | null;
  beatResolutions?: Array<{
    runId: string;
    chapterRuntimeId: string;
    committedWorkingRevision: number;
    resolutionHash: string;
  }>;
}

interface NarrativeGenesisCommitRowV1 {
  runId: string;
  genesisHash: string;
  commitHash: string;
  commitManifestJson?: unknown;
  snapshot?: { runId: string; routeHash: string; genesisHash: string };
}

interface NarrativeSettlementRowV1 {
  runId: string;
  chapterRuntimeId: string;
  frozenBundleHash: string;
  commitManifestJson: unknown;
  commitHash: string;
}

interface NarrativeStoryEventRowV1 {
  runId: string;
  type: string;
  payloadJson: unknown;
  dedupeKey: string | null;
}

interface NarrativeProjectionRowV1 {
  id: string;
  runId: string;
  projectionKind: string;
  sourceAuthority: string;
  sourceId: string;
  sourceCommitHash: string;
  sourceContentHash: string;
  narrativeProfileVersion: string;
  projectorVersion: string;
  audienceKind: string;
  audienceSeatId: string | null;
  audienceKey: string;
  status: string;
  artifactJson: unknown | null;
  artifactContentHash: string | null;
}

export interface PressureNarrativeReadTransactionV1 {
  pressureChapterRuntime: {
    findUnique(input: Record<string, unknown>): Promise<NarrativeRuntimeRowV1 | null>;
  };
  pressureRunRouteSnapshot: {
    findUnique(input: Record<string, unknown>): Promise<{
      runId: string;
      routeHash: string;
      narrativeProfileVersion: string;
    } | null>;
  };
  pressureGenesisCommit: {
    findUnique(input: Record<string, unknown>): Promise<NarrativeGenesisCommitRowV1 | null>;
  };
  pressureChapterSettlement?: {
    findUnique(input: Record<string, unknown>): Promise<NarrativeSettlementRowV1 | null>;
  };
  storyEvent?: {
    findMany(input: Record<string, unknown>): Promise<NarrativeStoryEventRowV1[]>;
  };
  pressureNarrativeProjection: {
    findMany(input: Record<string, unknown>): Promise<NarrativeProjectionRowV1[]>;
  };
}

export type PressureNarrativeReadPrismaLikeV1 =
  PressureSerializableClient<PressureNarrativeReadTransactionV1>;

/**
 * Reads only the seat-bound W9 projection/artifact for the current committed
 * Beat or FrozenChapter authority, or the committed Genesis opening before N1
 * has its first Beat. It never reads Provider response/outbox raw payloads and
 * fails on multiple projector versions instead of picking one.
 */
export class PrismaPressureGameNarrativeReaderV1
implements PressureGameNarrativeReaderPort {
  private readonly prisma: PressureNarrativeReadPrismaLikeV1;

  constructor(prisma: PressureNarrativeReadPrismaLikeV1);
  constructor(prisma: PrismaService);
  constructor(prisma: PressureNarrativeReadPrismaLikeV1 | PrismaService) {
    // Prisma's overloaded transaction API is runtime-compatible with the
    // narrow callback capability; the overload above keeps Nest wiring typed.
    this.prisma = prisma as PressureNarrativeReadPrismaLikeV1;
  }

  readCurrent(input: {
    runId: string;
    routeHash: string;
    viewerSeatId: SeatIdV1;
    chapterRuntimeId: string;
  }): Promise<PressureGameNarrativeSourceV1 | null> {
    return pressureSerializableTransaction(this.prisma, async (tx) => {
      const [runtime, route, settlement, storyEvents] = await Promise.all([
        tx.pressureChapterRuntime.findUnique({
          where: { id: input.chapterRuntimeId },
          select: {
            id: true,
            runId: true,
            chapterId: true,
            routeHash: true,
            state: true,
          },
        }),
        tx.pressureRunRouteSnapshot.findUnique({
          where: { runId: input.runId },
          select: { runId: true, routeHash: true, narrativeProfileVersion: true },
        }),
        tx.pressureChapterSettlement?.findUnique({
          where: { chapterRuntimeId: input.chapterRuntimeId },
          select: {
            runId: true,
            chapterRuntimeId: true,
            frozenBundleHash: true,
            commitManifestJson: true,
            commitHash: true,
          },
        }) ?? Promise.resolve(null),
        tx.storyEvent?.findMany({
          where: { runId: input.runId, type: "PRESSURE_WORKING_LEDGER_EVENT" },
          orderBy: { createdAt: "desc" },
          select: { runId: true, type: true, payloadJson: true, dedupeKey: true },
        }) ?? Promise.resolve([]),
      ]);
      if (!runtime || !route) return null;
      if (
        runtime.id !== input.chapterRuntimeId
        || runtime.runId !== input.runId
        || runtime.routeHash !== input.routeHash
        || route.runId !== input.runId
        || route.routeHash !== input.routeHash
        || !route.narrativeProfileVersion.trim()
      ) {
        return failLiveAdapter(ERROR.AUTHORITY_MISMATCH, "Narrative.runtimeRoute", "SCOPE");
      }
      let source = resolveCurrentNarrativeSource(runtime, settlement, storyEvents);
      if (!source && runtime.chapterId === "N1") {
        const genesis = await tx.pressureGenesisCommit.findUnique({
          where: { runId: input.runId },
          select: {
            runId: true,
            genesisHash: true,
            commitHash: true,
            commitManifestJson: true,
          },
        });
        source = resolveCommittedGenesisNarrativeSource(genesis, {
          runId: input.runId,
          routeHash: input.routeHash,
        });
      }
      if (!source) return null;
      const rows = await tx.pressureNarrativeProjection.findMany({
        where: {
          runId: input.runId,
          projectionKind: source.projectionKind,
          sourceAuthority: source.sourceAuthority,
          sourceId: source.sourceId,
          narrativeProfileVersion: route.narrativeProfileVersion,
          audienceKind: "SEAT",
          audienceSeatId: input.viewerSeatId,
          audienceKey: input.viewerSeatId,
        },
        orderBy: [{ projectorVersion: "asc" }, { id: "asc" }],
        take: 2,
        select: {
          id: true,
          runId: true,
          projectionKind: true,
          sourceAuthority: true,
          sourceId: true,
          sourceCommitHash: true,
          sourceContentHash: true,
          narrativeProfileVersion: true,
          projectorVersion: true,
          audienceKind: true,
          audienceSeatId: true,
          audienceKey: true,
          status: true,
          artifactJson: true,
          artifactContentHash: true,
        },
      });
      if (rows.length === 0) return null;
      if (rows.length !== 1) {
        return failLiveAdapter(
          ERROR.AUTHORITY_AMBIGUOUS,
          "PressureNarrativeProjection",
          "MULTIPLE_PROJECTOR_VERSIONS",
        );
      }
      return decodeNarrativeProjection(rows[0]!, input, route.narrativeProfileVersion, source);
    });
  }
}

function resolveCurrentNarrativeSource(
  runtime: NarrativeRuntimeRowV1,
  settlement: NarrativeSettlementRowV1 | null,
  storyEvents: NarrativeStoryEventRowV1[],
): {
  projectionKind: ProjectionKind;
  sourceAuthority: SourceAuthority;
  sourceId: string;
  expectedSourceCommitHash?: string;
} | null {
  if (runtime.state === "CHAPTER_FROZEN") {
    const committed = settlement
      ? validateAtomicChapterCommitRecordV1(settlement.commitManifestJson)
      : null;
    const bundle = committed?.frozenChapterBundle ?? runtime.frozenBundle ?? null;
    const invalidSettlement = settlement && committed && (
      settlement.runId !== runtime.runId
      || settlement.chapterRuntimeId !== runtime.id
      || settlement.frozenBundleHash !== bundle?.bundleHash
      || settlement.commitHash !== committed.receipt.commitHash
    );
    const invalidLegacy = !settlement && runtime.frozenBundle && (
      runtime.frozenBundle.runId !== runtime.runId
      || runtime.frozenBundle.chapterRuntimeId !== runtime.id
    );
    if (!bundle || invalidSettlement || invalidLegacy || !isSha256(bundle.bundleHash)) {
      return failLiveAdapter(ERROR.AUTHORITY_MISMATCH, "PressureFrozenChapterBundle", "HEAD");
    }
    return {
      projectionKind: "CHAPTER_NARRATIVE",
      sourceAuthority: "CHAPTER_FROZEN",
      sourceId: bundle.bundleHash,
      expectedSourceCommitHash: bundle.bundleHash,
    };
  }
  const beat = storyEvents
    .map((row) => decodeWorkingLedgerBeat(row, runtime))
    .find((candidate) => candidate !== null)
    ?? runtime.beatResolutions?.[0]
    ?? null;
  if (!beat) return null;
  if (!isSha256(beat.resolutionHash)) {
    return failLiveAdapter(ERROR.AUTHORITY_MISMATCH, "StoryEvent", "BEAT_HEAD");
  }
  return {
    projectionKind: "BEAT_NARRATIVE",
    sourceAuthority: "CHAPTER_WORKING",
    sourceId: beat.resolutionHash,
    expectedSourceCommitHash: beat.resolutionHash,
  };
}

function resolveCommittedGenesisNarrativeSource(
  row: NarrativeGenesisCommitRowV1 | null,
  scope: { runId: string; routeHash: string },
): {
  projectionKind: "GENESIS_NARRATIVE";
  sourceAuthority: "GENESIS_FROZEN";
  sourceId: string;
  expectedSourceCommitHash: string;
} | null {
  if (!row) return null;
  const committed = row.commitManifestJson === undefined
    ? null
    : validateCommittedGenesis(row.commitManifestJson as Parameters<typeof validateCommittedGenesis>[0]);
  const snapshot = committed?.record.snapshot ?? row.snapshot;
  if (
    !snapshot
    || row.runId !== scope.runId
    || (committed !== null && committed.record.runId !== scope.runId)
    || snapshot.runId !== scope.runId
    || snapshot.routeHash !== scope.routeHash
    || snapshot.genesisHash !== row.genesisHash
    || (committed !== null && committed.record.commit.commitHash !== row.commitHash)
    || !isSha256(row.genesisHash)
    || !isSha256(row.commitHash)
  ) {
    return failLiveAdapter(ERROR.AUTHORITY_MISMATCH, "PressureGenesisCommit", "N1_HEAD");
  }
  return {
    projectionKind: "GENESIS_NARRATIVE",
    sourceAuthority: "GENESIS_FROZEN",
    sourceId: row.genesisHash,
    expectedSourceCommitHash: row.commitHash,
  };
}

function decodeWorkingLedgerBeat(
  row: NarrativeStoryEventRowV1,
  runtime: NarrativeRuntimeRowV1,
): { resolutionHash: string } | null {
  const event = structuredClone(row.payloadJson) as {
    schemaVersion?: unknown;
    runId?: unknown;
    chapterRuntimeId?: unknown;
    eventHash?: unknown;
    payload?: { eventType?: unknown; beatResolution?: { resolutionHash?: unknown } };
  };
  const { eventHash, ...body } = event;
  if (
    row.runId !== runtime.runId
    || row.type !== "PRESSURE_WORKING_LEDGER_EVENT"
    || event.schemaVersion !== "pressure_working_ledger_event_v1"
    || event.runId !== runtime.runId
    || event.chapterRuntimeId !== runtime.id
    || typeof eventHash !== "string"
    || sha256Canonical(body) !== eventHash
    || row.dedupeKey !== `pressure-ledger:${runtime.runId}:${runtime.id}:${eventHash}`
  ) return null;
  if (event.payload?.eventType !== "BEAT_APPLIED") return null;
  const resolutionHash = event.payload.beatResolution?.resolutionHash;
  if (typeof resolutionHash !== "string" || !isSha256(resolutionHash)) {
    return failLiveAdapter(ERROR.AUTHORITY_MISMATCH, "StoryEvent", "BEAT_HEAD");
  }
  return { resolutionHash };
}

function decodeNarrativeProjection(
  row: NarrativeProjectionRowV1,
  scope: {
    runId: string;
    routeHash: string;
    viewerSeatId: SeatIdV1;
    chapterRuntimeId: string;
  },
  narrativeProfileVersion: string,
  source: {
    projectionKind: ProjectionKind;
    sourceAuthority: SourceAuthority;
    sourceId: string;
    expectedSourceCommitHash?: string;
  },
): PressureGameNarrativeSourceV1 {
  if (
    row.runId !== scope.runId
    || row.projectionKind !== source.projectionKind
    || row.sourceAuthority !== source.sourceAuthority
    || row.sourceId !== source.sourceId
    || row.narrativeProfileVersion !== narrativeProfileVersion
    || row.audienceKind !== "SEAT"
    || row.audienceSeatId !== scope.viewerSeatId
    || row.audienceKey !== scope.viewerSeatId
    || !isSha256(row.sourceCommitHash)
    || (source.expectedSourceCommitHash !== undefined
      && row.sourceCommitHash !== source.expectedSourceCommitHash)
  ) {
    return failLiveAdapter(ERROR.AUTHORITY_MISMATCH, "PressureNarrativeProjection", "ROW");
  }
  if (!NARRATIVE_STATUSES.includes(row.status as NarrativeStatus)) {
    return failLiveAdapter(ERROR.RECORD_INVALID, "PressureNarrativeProjection.status", row.status);
  }
  const status = row.status as NarrativeStatus;
  const published = status === "PUBLISHED" || status === "FALLBACK_PUBLISHED";
  if (!published) {
    if (row.artifactJson !== null || row.artifactContentHash !== null) {
      return failLiveAdapter(
        ERROR.AUTHORITY_MISMATCH,
        "PressureNarrativeProjection",
        "UNPUBLISHED_HAS_ARTIFACT",
      );
    }
    return {
      runId: scope.runId,
      routeHash: scope.routeHash,
      viewerSeatId: scope.viewerSeatId,
      chapterRuntimeId: scope.chapterRuntimeId,
      status,
      projectionKind: source.projectionKind,
      sourceAuthority: source.sourceAuthority,
      sourceId: source.sourceId,
      sourceCommitHash: row.sourceCommitHash,
      text: null,
      contentHash: null,
      renderMode: null,
    };
  }
  const expectedMode = status === "PUBLISHED" ? "PROVIDER" : "AUTHORED_FALLBACK";
  const canonicalArtifact = decodeCanonicalPublishedArtifact(row.artifactJson);
  if (
    !canonicalArtifact
    || !canonicalArtifact.text.trim()
    || !isSha256(row.artifactContentHash)
    || row.artifactContentHash !== canonicalArtifact.contentHash
    || canonicalArtifact.contentHash !== computeNarrativeArtifactContentHash({
      text: canonicalArtifact.text,
      usedFactRefs: canonicalArtifact.usedFactRefs,
    })
    || expectedMode !== canonicalArtifact.renderMode
    || canonicalArtifact.status !== status
    || canonicalArtifact.runId !== scope.runId
    || canonicalArtifact.projectionKind !== source.projectionKind
    || canonicalArtifact.sourceId !== source.sourceId
    || canonicalArtifact.sourceCommitHash !== row.sourceCommitHash
    || canonicalArtifact.sourceContentHash !== row.sourceContentHash
    || canonicalArtifact.narrativeProfileVersion !== narrativeProfileVersion
    || canonicalArtifact.projectorVersion !== row.projectorVersion
    || canonicalArtifact.audience.kind !== "SEAT"
    || canonicalArtifact.audience.seatId !== scope.viewerSeatId
  ) {
    return failLiveAdapter(ERROR.AUTHORITY_MISMATCH, "PressureNarrativeArtifact", "PUBLISHED");
  }
  return {
    runId: scope.runId,
    routeHash: scope.routeHash,
    viewerSeatId: scope.viewerSeatId,
    chapterRuntimeId: scope.chapterRuntimeId,
    status,
    projectionKind: source.projectionKind,
    sourceAuthority: source.sourceAuthority,
    sourceId: source.sourceId,
    sourceCommitHash: row.sourceCommitHash,
    text: canonicalArtifact.text,
    contentHash: canonicalArtifact.contentHash,
    renderMode: expectedMode,
  };
}

function decodeCanonicalPublishedArtifact(value: unknown): OpenNovelNarrativeArtifactV1 | null {
  try {
    return validateOpenNovelNarrativeArtifactV1(value);
  } catch {
    return null;
  }
}
