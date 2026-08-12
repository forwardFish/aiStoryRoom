import assert from "node:assert/strict";
import test from "node:test";
import {
  PRESSURE_CHAPTER_SEAT_IDS_V1,
  computeNarrativeArtifactContentHash,
  sha256Canonical,
  type AuthoritativePressureResultSnapshotV1,
  type NarrativeStatusV1,
  type OpenNovelNarrativeArtifactV1,
  type SeatIdV1,
} from "@ai-story/shared";
import { PressureResultReadModelComposerV1 } from "../result/read-model-composer";
import { pressureResultSourceFixture } from "../result/result-test-fixtures";
import {
  PrismaPressureResultReadModelInputReader,
  PrismaPressureResultViewerAuthorizer,
  type ResultReadModelPrismaClient,
  type ResultViewerPrismaClient,
} from "./result.prisma-adapter";

const PROJECTOR_VERSION = "openovel-projector-1.0.0";
const NARRATIVE_PROFILE = "openovel-pressure-v1";
const digest = (value: string): string => sha256Canonical({ value });

test("Result authority plus six PENDING identities are joined in one zero-write transaction", async () => {
  const authority = pressureResultSourceFixture();
  const fake = new ResultFake(authority, "PENDING");
  fake.projections.reverse();
  const inputReader = new PrismaPressureResultReadModelInputReader(
    fake.readClient,
    PROJECTOR_VERSION,
  );
  const composer = new PressureResultReadModelComposerV1(inputReader);

  const first = await composer.readFinalized(authority.runId);
  assert(first);
  assert.equal(fake.transactions, 1);
  assert.deepEqual(first.narratives.map((item) => item.seatId), PRESSURE_CHAPTER_SEAT_IDS_V1);
  assert(first.narratives.every((item) => item.status === "PENDING" && item.text === null));
  assert.equal(first.authority.snapshotHash, authority.snapshotHash);
  assert.equal(fake.mutationCalls, 0);

  const second = await composer.readFinalized(authority.runId);
  assert(second);
  assert.equal(second.authority.snapshotHash, authority.snapshotHash);
  assert.deepEqual(second, first);
  assert.equal(fake.mutationCalls, 0);
});

test("Result reader never synthesizes PENDING when a persisted seat projection identity is missing", async () => {
  const authority = pressureResultSourceFixture();
  const fake = new ResultFake(authority, "PENDING");
  fake.projections.pop();
  const inputReader = new PrismaPressureResultReadModelInputReader(
    fake.readClient,
    PROJECTOR_VERSION,
  );
  const raw = await inputReader.readConsistentSource(authority.runId) as any;
  assert(raw);
  assert.equal(raw.authority.snapshotHash, authority.snapshotHash);
  assert.equal(raw.narrativeReadSet, null);
  assert.equal(fake.mutationCalls, 0);

  await assert.rejects(
    new PressureResultReadModelComposerV1(inputReader).readFinalized(authority.runId),
    /FINALIZED_AUTHORITY_REQUIRES_SIX_PROJECTIONS/,
  );
});

test("published narrative artifacts join without changing the authority snapshot hash", async () => {
  const authority = pressureResultSourceFixture();
  const fake = new ResultFake(authority, "PUBLISHED");
  const composer = new PressureResultReadModelComposerV1(
    new PrismaPressureResultReadModelInputReader(fake.readClient, PROJECTOR_VERSION),
  );
  const result = await composer.readFinalized(authority.runId);
  assert(result);
  assert(result.narratives.every((item) => item.status === "PUBLISHED" && item.text));
  assert.equal(result.authority.snapshotHash, authority.snapshotHash);
  assert.equal(fake.mutationCalls, 0);
});

test("viewer authorization derives only the member seat ACL from immutable authority", async () => {
  const authority = pressureResultSourceFixture();
  const fake = new ResultFake(authority, "PENDING");
  const seatId: SeatIdV1 = "cabinet_finance";
  fake.membership = {
    id: "player-cabinet",
    runId: authority.runId,
    userId: "viewer-cabinet",
    playerType: "human",
    status: "active",
    role: { roleKey: seatId },
  };
  const authorizer = new PrismaPressureResultViewerAuthorizer(fake.viewerClient);
  const viewer = await authorizer.readViewerContext(authority.runId, "viewer-cabinet");
  assert(viewer);
  assert.equal(viewer.seatId, seatId);
  assert.deepEqual(viewer.authorizedImpactIds, [`impact-private-${seatId}`]);
  assert.deepEqual(viewer.authorizedRevealIds, [`reveal-${seatId}`]);
  assert.equal(viewer.allowedReplayRoleIds.includes(seatId), false);
  assert.equal(await authorizer.readViewerContext(authority.runId, "stranger"), null);
  assert.equal(fake.mutationCalls, 0);
});

class ResultFake {
  transactions = 0;
  mutationCalls = 0;
  membership: Record<string, any> | null = null;
  readonly projections: Array<Record<string, any>>;
  readonly route: Record<string, any>;
  readonly finaleRow: Record<string, any>;

  constructor(
    private readonly authority: AuthoritativePressureResultSnapshotV1,
    status: NarrativeStatusV1,
  ) {
    this.route = {
      runId: authority.runId,
      routeHash: authority.frozenRouteHash,
      resultSchemaVersion: authority.payloadSchemaVersion,
      narrativeProfileVersion: NARRATIVE_PROFILE,
    };
    const manifestWithoutHash = {
      runId: authority.runId,
      authorityCommitHash: authority.sourceCommitHash,
      resultArtifact: structuredClone(authority),
    };
    const commitManifestJson = {
      ...manifestWithoutHash,
      atomicRecordHash: sha256Canonical(manifestWithoutHash),
    };
    this.finaleRow = {
      runId: authority.runId,
      commitManifestJson,
      commitManifestHash: commitManifestJson.atomicRecordHash,
      commitHash: authority.sourceCommitHash,
      semanticOutcomeHash: authority.decisionHash,
    };
    this.projections = PRESSURE_CHAPTER_SEAT_IDS_V1.map((seatId) =>
      projectionRow(authority, seatId, status));
  }

  readonly readClient: ResultReadModelPrismaClient = {
    $transaction: async <T>(operation: (tx: any) => Promise<T>): Promise<T> => {
      this.transactions += 1;
      return operation(this.readTx());
    },
  };

  readonly viewerClient: ResultViewerPrismaClient = {
    $transaction: async <T>(operation: (tx: any) => Promise<T>): Promise<T> => {
      this.transactions += 1;
      return operation({
        pressureRunRouteSnapshot: this.readTx().pressureRunRouteSnapshot,
        pressureFinaleDecision: this.readTx().pressureFinaleDecision,
        storyPlayer: {
          findUnique: async ({ where }: any) => (
            this.membership
            && this.membership.runId === where.runId_userId.runId
            && this.membership.userId === where.runId_userId.userId
              ? structuredClone(this.membership)
              : null
          ),
        },
      });
    },
  };

  private readTx(): any {
    return {
      pressureRunRouteSnapshot: {
        findUnique: async ({ where }: any) => where.runId === this.authority.runId
          ? structuredClone(this.route)
          : null,
      },
      pressureFinaleDecision: {
        findUnique: async ({ where }: any) => (
          where.runId === this.authority.runId
            ? structuredClone(this.finaleRow)
            : null
        ),
      },
      pressureNarrativeProjection: {
        findMany: async () => structuredClone(this.projections),
      },
    };
  }
}

function projectionRow(
  authority: AuthoritativePressureResultSnapshotV1,
  seatId: SeatIdV1,
  status: NarrativeStatusV1,
): Record<string, unknown> {
  const published = status === "PUBLISHED" || status === "FALLBACK_PUBLISHED";
  const artifact = published ? narrativeArtifact(authority, seatId, status) : null;
  return {
    id: `projection-${seatId}`,
    runId: authority.runId,
    projectionKind: "FINALE_NARRATIVE",
    sourceAuthority: "FINALE_FROZEN",
    sourceCommitHash: authority.sourceCommitHash,
    sourceContentHash: authority.decisionHash,
    narrativeProfileVersion: NARRATIVE_PROFILE,
    projectorVersion: PROJECTOR_VERSION,
    audienceKind: "SEAT",
    audienceSeatId: seatId,
    audienceKey: seatId,
    status,
    artifactJson: artifact ? structuredClone(artifact) : null,
    artifactContentHash: artifact?.contentHash ?? null,
  };
}

function narrativeArtifact(
  authority: AuthoritativePressureResultSnapshotV1,
  seatId: SeatIdV1,
  status: "PUBLISHED" | "FALLBACK_PUBLISHED",
): OpenNovelNarrativeArtifactV1 {
  const text = `Narrative for ${seatId}`;
  const usedFactRefs: string[] = [];
  return {
    schemaVersion: "openovel_narrative_artifact_v1",
    jobId: `finale_narrative_${authority.runId}_${seatId}`,
    runId: authority.runId,
    projectionKind: "FINALE_NARRATIVE",
    sourceId: digest("finale-execution"),
    sourceCommitHash: authority.sourceCommitHash,
    sourceContentHash: authority.decisionHash,
    audience: { kind: "SEAT", seatId },
    narrativeProfileVersion: NARRATIVE_PROFILE,
    projectorVersion: PROJECTOR_VERSION,
    text,
    usedFactRefs,
    validationReportHash: digest(`validation-${seatId}`),
    contentHash: computeNarrativeArtifactContentHash({ text, usedFactRefs }),
    renderMode: status === "PUBLISHED" ? "PROVIDER" : "AUTHORED_FALLBACK",
    status,
  };
}
