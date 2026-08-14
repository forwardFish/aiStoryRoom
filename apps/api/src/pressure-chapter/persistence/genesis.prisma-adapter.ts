import { Prisma } from "@prisma/client";
import {
  sha256Canonical,
} from "@ai-story/shared";
import {
  buildGenesisCommitReceipt,
  validateCommittedGenesis,
  validateGenesisAtomicRecord,
  type CommittedGenesisV1,
  type GenesisAtomicCommitPort,
  type GenesisAtomicRecordV1,
} from "../genesis";
import type {
  ExtendedAuthoritativeNarrativeSnapshotCompilerPortV1,
} from "../narrative-authority/contracts";
import {
  buildAuthorityDownstreamManifestV1,
  downstreamDedupeKeysV1,
  insertNarrativeProjectionPlanV1,
  planInteractiveNarrativeAudiencesV1,
  planNarrativeProjectionJobsV1,
  validateAuthorityDownstreamManifestV1,
} from "../projection-plan";
import {
  PRESSURE_PERSISTENCE_ERROR_CODES as ERROR,
  PressurePersistenceError,
} from "./errors";
import {
  isUniqueConflict,
  pressureSerializableTransaction,
  type PressureSerializableClient,
} from "./transaction";

interface GenesisCommitRow {
  runId: string;
  commitManifestJson: unknown;
  outboxDedupeKeysJson: unknown;
}

interface GenesisTransaction {
  pressureGenesisCommit: {
    findUnique(input: {
      where: { runId: string };
      select: {
        runId: true;
        commitManifestJson: true;
        outboxDedupeKeysJson: true;
      };
    }): Promise<GenesisCommitRow | null>;
    create(input: { data: Record<string, unknown> }): Promise<unknown>;
  };
  pressureRunRouteSnapshot: {
    findUnique(input: {
      where: { runId: string };
      select: { routeHash: true; humanSeatIdsAtStartJson: true };
    }): Promise<{ routeHash: string; humanSeatIdsAtStartJson: unknown } | null>;
  };
  pressureOutboxTask: {
    create(input: { data: Record<string, unknown> }): Promise<unknown>;
  };
  pressureNarrativeProjection: {
    create(input: { data: Record<string, unknown> }): Promise<{ id: string }>;
  };
  storyEvent: {
    create(input: { data: Record<string, unknown> }): Promise<unknown>;
  };
  storyRun: {
    updateMany(input: {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    }): Promise<{ count: number }>;
  };
}

export type GenesisPrismaClient = PressureSerializableClient<GenesisTransaction>;

/** P0 Snapshot, receipt, root event and N1 handoff are one transaction. */
export class PrismaGenesisAtomicCommitRepository implements GenesisAtomicCommitPort {
  constructor(
    private readonly prisma: GenesisPrismaClient,
    private readonly narrativeCompiler?: ExtendedAuthoritativeNarrativeSnapshotCompilerPortV1,
  ) {}

  async readCommitted(runId: string): Promise<CommittedGenesisV1 | null> {
    return pressureSerializableTransaction(this.prisma, async (tx) => {
      const [row, route] = await Promise.all([
        tx.pressureGenesisCommit.findUnique({
          where: { runId },
          select: {
            runId: true,
            commitManifestJson: true,
            outboxDedupeKeysJson: true,
          },
        }),
        tx.pressureRunRouteSnapshot.findUnique({
          where: { runId },
          select: { routeHash: true, humanSeatIdsAtStartJson: true },
        }),
      ]);
      if (!row) return null;
      if (!route) {
        throw new PressurePersistenceError(
          ERROR.RECORD_INVALID,
          "Stored Genesis commit is missing its route snapshot",
          { runId },
        );
      }
      return decodeCommittedGenesis(row, readHumanSeatIds(route.humanSeatIdsAtStartJson));
    });
  }

  async commitOnce(candidateValue: GenesisAtomicRecordV1): Promise<{
    status: "COMMITTED" | "ALREADY_COMMITTED";
    committed: CommittedGenesisV1;
  }> {
    const candidate = structuredClone(validateGenesisAtomicRecord(candidateValue));
    const committed = validateCommittedGenesis({
      record: candidate,
      receipt: buildGenesisCommitReceipt(candidate),
    });
    try {
      return await pressureSerializableTransaction(this.prisma, async (tx) => {
        const [existing, route] = await Promise.all([
          tx.pressureGenesisCommit.findUnique({
            where: { runId: candidate.runId },
            select: {
              runId: true,
              commitManifestJson: true,
              outboxDedupeKeysJson: true,
            },
          }),
          tx.pressureRunRouteSnapshot.findUnique({
            where: { runId: candidate.runId },
            select: { routeHash: true, humanSeatIdsAtStartJson: true },
          }),
        ]);
        if (!route || route.routeHash !== candidate.commit.routeHash) {
          throw new PressurePersistenceError(
            ERROR.AUTHORITY_FENCE_MISMATCH,
            "Genesis route fence is missing or changed",
            { runId: candidate.runId, expectedRouteHash: candidate.commit.routeHash },
          );
        }
        const humanSeatIds = readHumanSeatIds(route.humanSeatIdsAtStartJson);
        if (existing) {
          return {
            status: "ALREADY_COMMITTED" as const,
            committed: assertSameGenesis(decodeCommittedGenesis(existing, humanSeatIds), candidate),
          };
        }

        const snapshot = candidate.snapshot;
        const rootEventId = `genesis_frozen_${candidate.commit.commitHash.slice(0, 24)}`;
        const handoffDedupeKey = `open_chapter:${candidate.runId}:N1:${candidate.commit.commitHash}`;
        const narrativeJobs = planNarrativeProjectionJobsV1({
          runId: candidate.runId,
          projectionKind: "GENESIS_NARRATIVE",
          sourceAuthority: "GENESIS_FROZEN",
          sourceId: snapshot.genesisHash,
          sourceCommitHash: candidate.commit.commitHash,
          sourceContentHash: snapshot.initialWorldState.stateHash,
          audiences: planInteractiveNarrativeAudiencesV1({ humanSeatIds }),
        }, {
          runId: candidate.runId,
          commitManifestJson: committed,
          commitHash: candidate.commit.commitHash,
        }, this.narrativeCompiler);
        const downstreamManifest = buildAuthorityDownstreamManifestV1({
          authorityKind: "GENESIS",
          sourceId: snapshot.genesisHash,
          sourceCommitHash: candidate.commit.commitHash,
          dedupeKeys: downstreamDedupeKeysV1({
            existing: [handoffDedupeKey],
            narrativeJobs,
            aEmotionEmissions: [],
          }),
        });
        await tx.pressureGenesisCommit.create({
          data: {
            runId: candidate.runId,
            schemaVersion: candidate.commit.schemaVersion,
            sequence: candidate.commit.sequence,
            idempotencyKey: candidate.commit.idempotencyKey,
            requestFingerprint: candidate.commit.requestFingerprint,
            inputHash: candidate.commit.inputHash,
            genesisHash: candidate.commit.genesisHash,
            commitManifestJson: json(committed),
            commitManifestHash: candidate.atomicRecordHash,
            rootEventId,
            outboxDedupeKeysJson: json(downstreamManifest),
            commitHash: candidate.commit.commitHash,
          },
        });
        await tx.storyEvent.create({
          data: {
            id: rootEventId,
            runId: candidate.runId,
            day: 0,
            type: "GENESIS_FROZEN",
            messageType: "system",
            visibility: "system",
            payloadJson: json({
              schemaVersion: "pressure_genesis_frozen_event_v1",
              runId: candidate.runId,
              genesisHash: snapshot.genesisHash,
              commitHash: candidate.commit.commitHash,
            }),
            // P0 has domain sequence 0, but StoryEvent.sequence is the legacy
            // positive delivery sequence (or null for Pressure authority
            // records). Keep the canonical P0 sequence in payloadJson and do
            // not violate StoryEvent_sequence_check (sequence >= 1).
            sequence: null,
            dedupeKey: rootEventId,
          },
        });
        const handoffPayload = {
          schemaVersion: "pressure_open_chapter_task_v1",
          runId: candidate.runId,
          chapterId: "N1",
          genesisHash: snapshot.genesisHash,
          sourceCommitHash: candidate.commit.commitHash,
        };
        await tx.pressureOutboxTask.create({
          data: {
            runId: candidate.runId,
            taskType: "OPEN_CHAPTER",
            status: "PENDING",
            checkpoint: "PERSISTED",
            dedupeKey: handoffDedupeKey,
            sourceAuthority: "GENESIS_FROZEN",
            sourceId: snapshot.genesisHash,
            sourceCommitHash: candidate.commit.commitHash,
            payloadJson: json(handoffPayload),
            payloadHash: sha256Canonical(handoffPayload),
          },
        });
        await insertNarrativeProjectionPlanV1(
          tx,
          "PROJECT_GENESIS_NARRATIVE",
          narrativeJobs,
        );
        const advanced = await tx.storyRun.updateMany({
          where: {
            id: candidate.runId,
            worldSequence: 0,
            reservedWorldSequence: 0,
            pressureRouteSnapshot: { isNot: null },
          },
          data: {
            stateJson: json(snapshot.initialWorldState),
            currentNodeId: "P0",
          },
        });
        if (advanced.count !== 1) {
          throw new PressurePersistenceError(
            ERROR.AUTHORITY_FENCE_MISMATCH,
            "Genesis StoryRun fence did not match exactly one routed sequence-0 run",
            { runId: candidate.runId },
          );
        }
        return { status: "COMMITTED" as const, committed };
      });
    } catch (error) {
      if (!isUniqueConflict(error)) throw error;
      const concurrent = await this.readCommitted(candidate.runId);
      if (!concurrent) throw error;
      return {
        status: "ALREADY_COMMITTED",
        committed: assertSameGenesis(concurrent, candidate),
      };
    }
  }
}

function assertSameGenesis(
  committed: CommittedGenesisV1,
  candidate: GenesisAtomicRecordV1,
): CommittedGenesisV1 {
  const stored = validateCommittedGenesis(committed);
  if (
    stored.record.commit.idempotencyKey !== candidate.commit.idempotencyKey ||
    stored.record.commit.requestFingerprint !== candidate.commit.requestFingerprint ||
    stored.record.atomicRecordHash !== candidate.atomicRecordHash
  ) {
    throw new PressurePersistenceError(
      ERROR.FINGERPRINT_MISMATCH,
      "Genesis already exists with a different command fingerprint or record hash",
      { runId: candidate.runId },
    );
  }
  return structuredClone(stored);
}

function decodeCommittedGenesis(
  row: GenesisCommitRow,
  humanSeatIds: readonly string[],
): CommittedGenesisV1 {
  try {
    const committed = validateCommittedGenesis(row.commitManifestJson as CommittedGenesisV1);
    if (committed.record.runId !== row.runId) throw new Error("RUN_BINDING_MISMATCH");
    const manifest = validateAuthorityDownstreamManifestV1(row.outboxDedupeKeysJson, {
      authorityKind: "GENESIS",
      sourceId: committed.record.snapshot.genesisHash,
      sourceCommitHash: committed.record.commit.commitHash,
    });
    const expectedDedupeKeys = genesisDownstreamDedupeKeys(committed, humanSeatIds);
    if (sha256Canonical(manifest.dedupeKeys) !== sha256Canonical(expectedDedupeKeys)) {
      throw new Error("DOWNSTREAM_MANIFEST_DEDUPE_MISMATCH");
    }
    return structuredClone(committed);
  } catch (cause) {
    throw new PressurePersistenceError(
      ERROR.RECORD_INVALID,
      "Stored Genesis commit manifest is invalid",
      { runId: row.runId, cause: cause instanceof Error ? cause.message : String(cause) },
    );
  }
}

function genesisDownstreamDedupeKeys(
  committed: CommittedGenesisV1,
  humanSeatIds: readonly string[],
): string[] {
  const record = committed.record;
  return [
    `open_chapter:${record.runId}:N1:${record.commit.commitHash}`,
    ...humanSeatIds.map((audience) => [
      "GENESIS_NARRATIVE",
      record.runId,
      audience,
      record.commit.commitHash,
    ].join(":")),
  ].sort();
}

function readHumanSeatIds(value: unknown): string[] {
  if (!Array.isArray(value) || value.some((seatId) => typeof seatId !== "string")) {
    throw new PressurePersistenceError(
      ERROR.RECORD_INVALID,
      "Genesis route does not contain valid human narrative audiences",
    );
  }
  return [...value];
}

function json(value: unknown): Prisma.InputJsonValue {
  return structuredClone(value) as Prisma.InputJsonValue;
}
