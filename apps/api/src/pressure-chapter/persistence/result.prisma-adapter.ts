import {
  PRESSURE_CHAPTER_SEAT_IDS_V1,
  compareCanonicalText,
  computeNarrativeArtifactContentHash,
  sha256Canonical,
  validateAuthoritativePressureResultSnapshotV1,
  validateOpenNovelNarrativeArtifactV1,
  validateSeatIdV1,
  type AuthoritativePressureResultSnapshotV1,
  type NarrativeStatusV1,
  type SeatIdV1,
} from "@ai-story/shared";
import type {
  PressureResultReadModelInputReaderPort,
  PressureResultReadModelInputV1,
  PressureResultNarrativeReadSetV1,
  ResultViewerAuthorizerPort,
  ResultViewerContextV1,
  StoredPressureNarrativeV1,
} from "../result/ports";
import {
  PRESSURE_PERSISTENCE_ERROR_CODES as ERROR,
  PressurePersistenceError,
} from "./errors";
import {
  pressureSerializableTransaction,
  type PressureSerializableClient,
} from "./transaction";

interface ResultRouteRow {
  runId: string;
  routeHash: string;
  resultSchemaVersion: string;
  narrativeProfileVersion: string;
}

interface ResultAuthorityRow {
  runId: string;
  commitManifestJson: unknown;
  commitManifestHash: string;
  commitHash: string;
  semanticOutcomeHash: string;
}

interface ResultNarrativeProjectionRow {
  id: string;
  runId: string;
  projectionKind: string;
  sourceAuthority: string;
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

interface ResultReadTransaction {
  pressureRunRouteSnapshot: {
    findUnique(input: Record<string, unknown>): Promise<ResultRouteRow | null>;
  };
  pressureFinaleDecision: {
    findUnique(input: Record<string, unknown>): Promise<ResultAuthorityRow | null>;
  };
  pressureNarrativeProjection: {
    findMany(input: Record<string, unknown>): Promise<ResultNarrativeProjectionRow[]>;
  };
}

export type ResultReadModelPrismaClient =
  PressureSerializableClient<ResultReadTransaction>;

/**
 * Production Result seam: immutable authority and six mutable seat narrative
 * projections are read in one Serializable, zero-write snapshot.
 */
export class PrismaPressureResultReadModelInputReader
implements PressureResultReadModelInputReaderPort {
  constructor(
    private readonly prisma: ResultReadModelPrismaClient,
    private readonly projectorVersion: string,
  ) {
    nonEmpty(projectorVersion, "projectorVersion");
  }

  async readConsistentSource(runId: string): Promise<PressureResultReadModelInputV1 | null> {
    nonEmpty(runId, "runId");
    return pressureSerializableTransaction(this.prisma, async (tx) => {
      const stored = await readStoredAuthority(tx, runId);
      if (!stored) return null;
      const { route, authority } = stored;
      const rows = await tx.pressureNarrativeProjection.findMany({
        where: {
          runId,
          projectionKind: "FINALE_NARRATIVE",
          sourceAuthority: "FINALE_FROZEN",
          sourceCommitHash: authority.sourceCommitHash,
          sourceContentHash: authority.decisionHash,
          narrativeProfileVersion: route.narrativeProfileVersion,
          projectorVersion: this.projectorVersion,
          audienceKind: "SEAT",
        },
        select: {
          id: true,
          runId: true,
          projectionKind: true,
          sourceAuthority: true,
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
      const narrativeReadSet = composeNarrativeReadSet(
        rows,
        authority,
        route,
        this.projectorVersion,
      );
      return {
        authority: structuredClone(authority),
        narrativeReadSet,
      };
    });
  }
}

interface ViewerMembershipRow {
  id: string;
  runId: string;
  userId: string | null;
  playerType: string;
  status: string;
  role: { roleKey: string } | null;
}

interface ResultViewerTransaction {
  pressureRunRouteSnapshot: ResultReadTransaction["pressureRunRouteSnapshot"];
  pressureFinaleDecision: ResultReadTransaction["pressureFinaleDecision"];
  storyPlayer: {
    findUnique(input: Record<string, unknown>): Promise<ViewerMembershipRow | null>;
  };
}

export type ResultViewerPrismaClient =
  PressureSerializableClient<ResultViewerTransaction>;

/** Membership plus immutable result ACL projection; no current control-mode dependency. */
export class PrismaPressureResultViewerAuthorizer
implements ResultViewerAuthorizerPort {
  constructor(private readonly prisma: ResultViewerPrismaClient) {}

  async readViewerContext(
    runId: string,
    viewerId: string,
  ): Promise<ResultViewerContextV1 | null> {
    nonEmpty(runId, "runId");
    nonEmpty(viewerId, "viewerId");
    return pressureSerializableTransaction(this.prisma, async (tx) => {
      const [membership, stored] = await Promise.all([
        tx.storyPlayer.findUnique({
          where: { runId_userId: { runId, userId: viewerId } },
          select: {
            id: true,
            runId: true,
            userId: true,
            playerType: true,
            status: true,
            role: { select: { roleKey: true } },
          },
        }),
        readStoredAuthority(tx, runId),
      ]);
      const seatId = membershipSeat(membership, runId, viewerId);
      if (!seatId) return null;
      const authority = stored?.authority ?? null;
      const authorizedImpactIds = authority
        ? authority.impacts
            .filter((impact) => (
              impact.visibility === "AUTHORIZED"
              && impact.authorizedSeatIds.includes(seatId)
            ))
            .map((impact) => impact.outcomeId)
            .sort(compareCanonicalText)
        : [];
      const authorizedRevealIds = authority
        ? authority.reveals
            .filter((reveal) => reveal.authorizedSeatIds.includes(seatId))
            .map((reveal) => reveal.revealId)
            .sort(compareCanonicalText)
        : [];
      return {
        runId,
        viewerId,
        seatId,
        authorizedImpactIds,
        authorizedRevealIds,
        allowedReplayRoleIds: PRESSURE_CHAPTER_SEAT_IDS_V1.filter(
          (candidate) => candidate !== seatId,
        ),
      };
    });
  }
}

async function readStoredAuthority(
  tx: Pick<ResultReadTransaction, "pressureRunRouteSnapshot" | "pressureFinaleDecision">,
  runId: string,
): Promise<{
  route: ResultRouteRow;
  authority: AuthoritativePressureResultSnapshotV1;
} | null> {
  const route = await tx.pressureRunRouteSnapshot.findUnique({
    where: { runId },
    select: {
      runId: true,
      routeHash: true,
      resultSchemaVersion: true,
      narrativeProfileVersion: true,
    },
  });
  if (!route) return null;
  const row = await tx.pressureFinaleDecision.findUnique({
    where: { runId },
    select: {
      runId: true,
      commitManifestJson: true,
      commitManifestHash: true,
      commitHash: true,
      semanticOutcomeHash: true,
    },
  });
  if (!row) return null;
  try {
    const manifest = finaleManifest(row.commitManifestJson);
    const authority = validateAuthoritativePressureResultSnapshotV1(manifest.resultArtifact, runId);
    if (
      row.runId !== runId
      || route.runId !== runId
      || manifest.runId !== runId
      || authority.authoritativeResultStatus !== "FINALIZED"
      || row.commitManifestHash !== manifest.atomicRecordHash
      || row.commitHash !== manifest.authorityCommitHash
      || authority.sourceCommitHash !== manifest.authorityCommitHash
      || row.semanticOutcomeHash !== authority.decisionHash
      || route.routeHash !== authority.frozenRouteHash
      || route.resultSchemaVersion !== authority.payloadSchemaVersion
    ) throw new Error("ROW_BINDING_MISMATCH");
    return { route: structuredClone(route), authority: structuredClone(authority) };
  } catch (cause) {
    throw invalid("Stored authoritative Result snapshot is invalid", {
      runId,
      cause: cause instanceof Error ? cause.message : String(cause),
    });
  }
}

function finaleManifest(value: unknown): {
  runId: string;
  authorityCommitHash: string;
  atomicRecordHash: string;
  resultArtifact: unknown;
} {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("COMMIT_MANIFEST_INVALID");
  }
  const record = value as Record<string, unknown>;
  const { atomicRecordHash, ...withoutHash } = record;
  if (
    typeof record.runId !== "string"
    || typeof record.authorityCommitHash !== "string"
    || typeof atomicRecordHash !== "string"
    || sha256Canonical(withoutHash) !== atomicRecordHash
    || !("resultArtifact" in record)
  ) throw new Error("COMMIT_MANIFEST_BINDING_MISMATCH");
  return {
    runId: record.runId,
    authorityCommitHash: record.authorityCommitHash,
    atomicRecordHash,
    resultArtifact: record.resultArtifact,
  };
}

function composeNarrativeReadSet(
  rows: ResultNarrativeProjectionRow[],
  authority: AuthoritativePressureResultSnapshotV1,
  route: ResultRouteRow,
  projectorVersion: string,
): PressureResultNarrativeReadSetV1 | null {
  if (rows.length !== PRESSURE_CHAPTER_SEAT_IDS_V1.length) return null;
  const bySeat = new Map<string, ResultNarrativeProjectionRow>();
  for (const row of rows) {
    if (!row.audienceSeatId || bySeat.has(row.audienceSeatId)) return null;
    bySeat.set(row.audienceSeatId, row);
  }
  const narratives: StoredPressureNarrativeV1[] = [];
  for (const seatId of PRESSURE_CHAPTER_SEAT_IDS_V1) {
    const row = bySeat.get(seatId);
    if (!row) return null;
    narratives.push(decodeNarrative(row, seatId, authority, route, projectorVersion));
  }
  return {
    schemaVersion: "pressure_result_narrative_read_set_v1",
    runId: authority.runId,
    sourceCommitHash: authority.sourceCommitHash,
    sourceDecisionHash: authority.decisionHash,
    narratives,
  };
}

function decodeNarrative(
  row: ResultNarrativeProjectionRow,
  seatId: SeatIdV1,
  authority: AuthoritativePressureResultSnapshotV1,
  route: ResultRouteRow,
  projectorVersion: string,
): StoredPressureNarrativeV1 {
  const statuses = new Set<NarrativeStatusV1>([
    "PENDING",
    "GENERATING",
    "VALIDATING",
    "PUBLISHED",
    "FALLBACK_PUBLISHED",
    "FAILED_RETRYABLE",
  ]);
  if (
    row.runId !== authority.runId
    || row.projectionKind !== "FINALE_NARRATIVE"
    || row.sourceAuthority !== "FINALE_FROZEN"
    || row.sourceCommitHash !== authority.sourceCommitHash
    || row.sourceContentHash !== authority.decisionHash
    || row.narrativeProfileVersion !== route.narrativeProfileVersion
    || row.projectorVersion !== projectorVersion
    || row.audienceKind !== "SEAT"
    || row.audienceSeatId !== seatId
    || row.audienceKey !== seatId
    || !statuses.has(row.status as NarrativeStatusV1)
  ) throw invalid("Stored finale narrative projection is invalid", {
    projectionId: row.id,
    seatId,
  });
  const status = row.status as NarrativeStatusV1;
  const published = status === "PUBLISHED" || status === "FALLBACK_PUBLISHED";
  if (!published) {
    if (row.artifactJson !== null || row.artifactContentHash !== null) {
      throw invalid("Unpublished narrative projection references an artifact", {
        projectionId: row.id,
      });
    }
    return {
      seatId,
      status,
      text: null,
      contentHash: null,
      sourceCommitHash: authority.sourceCommitHash,
      sourceDecisionHash: authority.decisionHash,
    };
  }
  if (row.artifactJson === null || row.artifactContentHash === null) {
    throw invalid("Published narrative projection artifact is missing", {
      projectionId: row.id,
    });
  }
  try {
    const artifact = validateOpenNovelNarrativeArtifactV1(row.artifactJson);
    if (
      artifact.status !== status
      || artifact.runId !== authority.runId
      || artifact.projectionKind !== "FINALE_NARRATIVE"
      || artifact.sourceCommitHash !== authority.sourceCommitHash
      || artifact.sourceContentHash !== authority.decisionHash
      || artifact.audience.kind !== "SEAT"
      || artifact.audience.seatId !== seatId
      || artifact.narrativeProfileVersion !== route.narrativeProfileVersion
      || artifact.projectorVersion !== projectorVersion
      || row.artifactContentHash !== artifact.contentHash
      || artifact.contentHash !== computeNarrativeArtifactContentHash({
        text: artifact.text,
        usedFactRefs: artifact.usedFactRefs,
      })
    ) throw new Error("ARTIFACT_ROW_BINDING_MISMATCH");
    return {
      seatId,
      status,
      text: artifact.text,
      contentHash: artifact.contentHash,
      sourceCommitHash: authority.sourceCommitHash,
      sourceDecisionHash: authority.decisionHash,
    };
  } catch (cause) {
    throw invalid("Stored finale NarrativeArtifact is invalid", {
      projectionId: row.id,
      cause: cause instanceof Error ? cause.message : String(cause),
    });
  }
}

function membershipSeat(
  row: ViewerMembershipRow | null,
  runId: string,
  viewerId: string,
): SeatIdV1 | null {
  if (
    !row
    || row.runId !== runId
    || row.userId !== viewerId
    || row.playerType.toLowerCase() !== "human"
    || !row.role
  ) return null;
  try {
    return validateSeatIdV1(row.role.roleKey, "viewer.role.roleKey");
  } catch {
    return null;
  }
}

function nonEmpty(value: unknown, path: string): asserts value is string {
  if (typeof value !== "string" || !value.trim()) {
    throw invalid(`${path} must be a non-empty string`);
  }
}

function invalid(
  message: string,
  details: Record<string, unknown> = {},
): PressurePersistenceError {
  return new PressurePersistenceError(ERROR.RECORD_INVALID, message, details);
}
