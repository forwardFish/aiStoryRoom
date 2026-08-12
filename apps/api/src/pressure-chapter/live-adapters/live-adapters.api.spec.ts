import assert from "node:assert/strict";
import test from "node:test";
import {
  PRESSURE_CHAPTER_SEAT_IDS_V1,
  sha256Canonical,
  type OpenNovelNarrativeArtifactV1,
  type ParticipantModeV1,
  type SeatIdV1,
} from "@ai-story/shared";
import {
  PRESSURE_CHAPTER_ROUTE_REGISTRY_SCHEMA_V1,
  PRESSURE_CHAPTER_ROUTE_TUPLE_V1,
  PressureChapterRouteRegistry,
  compileInitialWorldState,
  computePressureChapterRouteRegistryHash,
  loadSangtianPressureChapterPackageV1,
  type PressureChapterRouteRegistryV1,
} from "@ai-story/templates";
import { PressureChapterRunRouterService } from "../run-router/run-router.service";
import type {
  CreatePressureRunRouteCommandV1,
  RunRouteRepositoryPort,
  StoredRunRouteRecordV1,
} from "../run-router/types";
import {
  AEmotionPressureGameFeedReaderAdapterV1,
  CommittedGenesisSeatControlAuthorityReaderV1,
  FailClosedPressureGameViewerReaderV1,
  FailClosedSeatControlAuthorityPortV1,
  FailClosedSeatPrivateProjectionPortV1,
  PRESSURE_LIVE_ADAPTER_ERROR_CODES,
  PressureLiveAdapterError,
  PrismaAuthoritativePressureGameWorldSourceV1,
  PrismaCanonicalSeatViewerAuthorityReaderV1,
  PrismaPressureGameCapabilityReaderV1,
  PrismaPressureGameNarrativeReaderV1,
  PrismaStoredRunRouteReaderAdapterV1,
  createPrismaPressureGameWorldReaderV1,
  type CanonicalViewerReadPrismaLikeV1,
  type PressureCapabilityReadPrismaLikeV1,
  type PressureNarrativeReadPrismaLikeV1,
  type PressureNarrativeReadTransactionV1,
} from "./index";

const RUN_ID = "pressure-live-run";
const ROUTE_HASH = digest("route");
const FIXED_NOW = new Date("2030-01-01T00:00:00.000Z");
type NarrativeTestRow = Awaited<ReturnType<
  PressureNarrativeReadTransactionV1["pressureNarrativeProjection"]["findMany"]
>>[number];

test("six canonical viewers are authorized by one exact membership query without peer-private reads", async () => {
  const rows = new Map<string, unknown>();
  for (const [index, seatId] of PRESSURE_CHAPTER_SEAT_IDS_V1.entries()) {
    rows.set(`user-${index}`, viewerRow({
      seatId,
      subjectId: `user-${index}`,
      playerId: `player-${index}`,
      roleId: `role-${index}`,
      roleName: `Role ${index}`,
      hiddenSecret: `NEVER_SERIALIZE_PEER_SECRET_${index}`,
      mode: "HUMAN_ACTIVE",
      epoch: 1,
    }));
  }
  const calls: unknown[] = [];
  const prisma = viewerPrisma(rows, calls);
  const reader = new PrismaCanonicalSeatViewerAuthorityReaderV1(
    prisma,
    { now: () => FIXED_NOW },
  );

  for (const [index, seatId] of PRESSURE_CHAPTER_SEAT_IDS_V1.entries()) {
    const first = await reader.read({ runId: RUN_ID, subjectId: `user-${index}` });
    const second = await reader.read({ runId: RUN_ID, subjectId: `user-${index}` });
    assert.deepEqual(second, first, "same durable read must be stable");
    assert.equal(first?.seatId, seatId);
    assert.equal(first?.subjectId, `user-${index}`);
    assert.equal(first?.control.projectedMode, "HUMAN_ACTIVE");
    assert.equal(first?.control.canSubmit, true);
    const serialized = JSON.stringify(first);
    for (let peer = 0; peer < PRESSURE_CHAPTER_SEAT_IDS_V1.length; peer += 1) {
      assert.equal(serialized.includes(`NEVER_SERIALIZE_PEER_SECRET_${peer}`), false);
    }
  }

  assert.equal(calls.length, 12);
  for (const [index, call] of calls.entries()) {
    const query = call as Record<string, any>;
    assert.deepEqual(query.where, {
      runId_userId: {
        runId: RUN_ID,
        userId: `user-${Math.floor(index / 2)}`,
      },
    });
    const queryText = JSON.stringify(query);
    assert.equal(queryText.includes("hiddenSecret"), false);
    assert.equal(queryText.includes('"roles"'), false);
    assert.equal(queryText.includes("roleControls"), false);
    assert.equal(queryText.includes("presenceSessions"), false);
  }
});

test("canonical control mapping preserves offline advisory, AI reclaim, pending reclaim, and rejects stale epochs", async () => {
  const rows = new Map<string, unknown>();
  const seatId = PRESSURE_CHAPTER_SEAT_IDS_V1[0];
  const calls: unknown[] = [];
  const prisma = viewerPrisma(rows, calls);
  const reader = new PrismaCanonicalSeatViewerAuthorityReaderV1(
    prisma,
    { now: () => FIXED_NOW },
  );

  rows.set("offline", viewerRow({
    seatId,
    subjectId: "offline",
    playerId: "player-offline",
    roleId: "role-offline",
    roleName: "Offline role",
    mode: "HUMAN_OFFLINE_GRACE",
    epoch: 1,
    transition: transition("HUMAN_ACTIVE", "HUMAN_OFFLINE_GRACE", 1, 1),
  }));
  const offline = await reader.read({ runId: RUN_ID, subjectId: "offline" });
  assert.equal(offline?.presence, "DISCONNECTED");
  assert.equal(offline?.control.projectedMode, "HUMAN_ACTIVE");
  assert.equal(offline?.control.canSubmit, true);

  rows.set("ai", viewerRow({
    seatId,
    subjectId: "ai",
    playerId: "player-ai",
    roleId: "role-ai",
    roleName: "AI role",
    mode: "AI_ACTIVE",
    epoch: 2,
    transition: transition("HUMAN_OFFLINE_GRACE", "AI_ACTIVE", 1, 2),
  }));
  const ai = await reader.read({ runId: RUN_ID, subjectId: "ai" });
  assert.equal(ai?.control.projectedMode, "AI_ACTIVE");
  assert.equal(ai?.control.canSubmit, false);
  assert.equal(ai?.control.canReclaim, true);

  rows.set("pending", viewerRow({
    seatId,
    subjectId: "pending",
    playerId: "player-pending",
    roleId: "role-pending",
    roleName: "Pending role",
    mode: "HUMAN_RECLAIM_PENDING",
    epoch: 2,
    transition: transition("AI_ACTIVE", "HUMAN_RECLAIM_PENDING", 2, 2),
  }));
  const pending = await reader.read({ runId: RUN_ID, subjectId: "pending" });
  assert.equal(pending?.control.projectedMode, "AI_ACTIVE");
  assert.equal(pending?.control.canReclaim, true);

  await assert.rejects(
    reader.authorize({
      runId: RUN_ID,
      subjectId: "ai",
      expectedSeatId: seatId,
      expectedControlEpoch: 1,
    }),
    (error: unknown) => liveError(error, PRESSURE_LIVE_ADAPTER_ERROR_CODES.STALE_CONTROL_EPOCH),
  );
  const current = await reader.authorize({
    runId: RUN_ID,
    subjectId: "ai",
    expectedSeatId: seatId,
    expectedControlEpoch: 2,
  });
  assert.equal(current.control.controlEpoch, 2);
});

test("legacy role aliases are never guessed into a pressure seat", async () => {
  const rows = new Map<string, unknown>();
  rows.set("legacy", viewerRow({
    seatId: "clerk" as SeatIdV1,
    subjectId: "legacy",
    playerId: "player-legacy",
    roleId: "role-legacy",
    roleName: "Legacy clerk",
    mode: "HUMAN_ACTIVE",
    epoch: 1,
  }));
  const reader = new PrismaCanonicalSeatViewerAuthorityReaderV1(
    viewerPrisma(rows, []),
    { now: () => FIXED_NOW },
  );
  await assert.rejects(
    reader.read({ runId: RUN_ID, subjectId: "legacy" }),
    (error: unknown) => liveError(error, PRESSURE_LIVE_ADAPTER_ERROR_CODES.SUBJECT_FORBIDDEN),
  );
});

test("capabilities intersect exact viewer, runtime, required seats, and action vocabulary without workbench guessing", async () => {
  const seatId = PRESSURE_CHAPTER_SEAT_IDS_V1[0];
  const rows = new Map<string, unknown>([["cap-user", viewerRow({
    seatId,
    subjectId: "cap-user",
    playerId: "cap-player",
    roleId: "cap-role",
    roleName: "Capability role",
    mode: "HUMAN_ACTIVE",
    epoch: 1,
  })]]);
  const viewer = new PrismaCanonicalSeatViewerAuthorityReaderV1(
    viewerPrisma(rows, []),
    { now: () => FIXED_NOW },
  );
  const reads: string[] = [];
  let embeddedRequiredSeatIds: unknown = [seatId];
  const prisma: PressureCapabilityReadPrismaLikeV1 = {
    pressureChapterRuntime: {
      findUnique: async () => {
        reads.push("pressureChapterRuntime.findUnique");
        return {
          id: "chapter-runtime",
          runId: RUN_ID,
          chapterId: "N2",
          routeHash: ROUTE_HASH,
          state: "DECISION_POINT_OPEN",
          workingRevision: 4,
          decisionStateJson: {
            schemaVersion: "pressure_mvp_decision_state_v1",
            workingRevision: 4,
            state: "OPEN",
            activeDecisionPointId: "N1.exact-decision",
            requiredSeatIds: embeddedRequiredSeatIds,
            allowedActionTypes: ["VERIFY_RECORD", "ALLOCATE_FUNDS"],
            pin: null,
          },
        };
      },
    },
  };
  const reader = new PrismaPressureGameCapabilityReaderV1(prisma, viewer);
  const value = await reader.readCapabilities({
    runId: RUN_ID,
    routeHash: ROUTE_HASH,
    subjectId: "cap-user",
    viewerSeatId: seatId,
    chapterRuntimeId: "chapter-runtime",
    decisionPointId: "N1.exact-decision",
  });
  assert.deepEqual(value, {
    canSubmitDecision: true,
    canTalk: false,
    canInvestigate: false,
    canUseToken: false,
    canPlan: false,
    canReclaimControl: false,
    allowedActionTypes: ["ALLOCATE_FUNDS", "VERIFY_RECORD"],
  });
  assert.deepEqual(reads, [
    "pressureChapterRuntime.findUnique",
  ]);

  embeddedRequiredSeatIds = undefined;
  await assert.rejects(
    () => reader.readCapabilities({
      runId: RUN_ID,
      routeHash: ROUTE_HASH,
      subjectId: "cap-user",
      viewerSeatId: seatId,
      chapterRuntimeId: "chapter-runtime",
      decisionPointId: "N1.exact-decision",
    }),
    (error: unknown) => liveError(error, "PRESSURE_LIVE_ADAPTER_RECORD_INVALID"),
  );
});

test("RunRoute and committed StoryRun world adapters are stable read-only projections", async () => {
  const stored = await storedRouteFixture(RUN_ID);
  const world = compileInitialWorldState(loadSangtianPressureChapterPackageV1());
  const reads: string[] = [];
  const routeReader = new PrismaStoredRunRouteReaderAdapterV1({
    pressureRunRouteSnapshot: {
      findUnique: async () => {
        reads.push("pressureRunRouteSnapshot.findUnique");
        return {
          runId: RUN_ID,
          routeHash: stored.snapshot.routeHash,
          routeJson: structuredClone(stored),
        };
      },
    },
  });
  const worldPrisma = {
    storyRun: {
      findUnique: async () => {
        reads.push("storyRun.findUnique");
        return {
          id: RUN_ID,
          worldSequence: world.worldSequence,
          stateJson: structuredClone(world),
          pressureRouteSnapshot: { routeHash: stored.snapshot.routeHash },
        };
      },
    },
  };
  const source = new PrismaAuthoritativePressureGameWorldSourceV1(worldPrisma);
  const gameWorld = createPrismaPressureGameWorldReaderV1(worldPrisma);
  assert.deepEqual(await routeReader.readStoredRoute(RUN_ID), stored);
  assert.deepEqual(await routeReader.readStoredRoute(RUN_ID), stored);
  assert.deepEqual(await source.readCurrentWorld(RUN_ID), await source.readCurrentWorld(RUN_ID));
  const projection = await gameWorld.readWorld(RUN_ID);
  assert.equal(projection?.metrics.length, 5);
  assert.equal(projection?.worldStateHash, world.stateHash);
  assert.equal(reads.every((name) => name.endsWith("findUnique")), true);
});

test("first N1 read selects the committed Genesis seat artifact without exposing peer or raw authority data", async () => {
  const seatId = PRESSURE_CHAPTER_SEAT_IDS_V1[0];
  const genesisHash = digest("genesis-head");
  const sourceCommitHash = digest("genesis-commit");
  const sourceContentHash = digest("genesis-source-content");
  const projectorVersion = "projector-v1";
  const published = publishedArtifactFixture({
    jobId: "job-genesis-own",
    projectionKind: "GENESIS_NARRATIVE",
    sourceId: genesisHash,
    sourceCommitHash,
    sourceContentHash,
    projectorVersion,
    text: "The committed opening visible only to this seat.",
    status: "FALLBACK_PUBLISHED",
    renderMode: "AUTHORED_FALLBACK",
    seatId,
  });
  const calls: Array<{ method: string; query?: Record<string, any> }> = [];
  const tx: PressureNarrativeReadTransactionV1 = {
    pressureChapterRuntime: {
      findUnique: async (query) => {
        calls.push({ method: "pressureChapterRuntime.findUnique", query });
        return {
          id: "chapter-runtime-N1",
          runId: RUN_ID,
          chapterId: "N1",
          routeHash: ROUTE_HASH,
          state: "CHAPTER_ACTIVE",
          frozenBundle: null,
          beatResolutions: [],
        };
      },
    },
    pressureRunRouteSnapshot: {
      findUnique: async (query) => {
        calls.push({ method: "pressureRunRouteSnapshot.findUnique", query });
        return {
          runId: RUN_ID,
          routeHash: ROUTE_HASH,
          narrativeProfileVersion: "narrative-v1",
        };
      },
    },
    pressureGenesisCommit: {
      findUnique: async (query) => {
        calls.push({ method: "pressureGenesisCommit.findUnique", query });
        return {
          runId: RUN_ID,
          genesisHash,
          commitHash: sourceCommitHash,
          snapshot: { runId: RUN_ID, routeHash: ROUTE_HASH, genesisHash },
        };
      },
    },
    pressureNarrativeProjection: {
      findMany: async (query) => {
        calls.push({ method: "pressureNarrativeProjection.findMany", query });
        return [{
          id: "projection-genesis-own",
          runId: RUN_ID,
          projectionKind: "GENESIS_NARRATIVE",
          sourceAuthority: "GENESIS_FROZEN",
          sourceId: genesisHash,
          sourceCommitHash,
          sourceContentHash,
          narrativeProfileVersion: "narrative-v1",
          projectorVersion,
          audienceKind: "SEAT",
          audienceSeatId: seatId,
          audienceKey: seatId,
          status: "FALLBACK_PUBLISHED",
          artifactJson: structuredClone(published),
          artifactContentHash: published.contentHash,
        }];
      },
    },
  };
  const reader = new PrismaPressureGameNarrativeReaderV1({
    $transaction: async <T>(operation: (transaction: PressureNarrativeReadTransactionV1) => Promise<T>) => (
      operation(tx)
    ),
  });

  const result = await reader.readCurrent({
    runId: RUN_ID,
    routeHash: ROUTE_HASH,
    viewerSeatId: seatId,
    chapterRuntimeId: "chapter-runtime-N1",
  });

  assert.equal(result?.projectionKind, "GENESIS_NARRATIVE");
  assert.equal(result?.sourceAuthority, "GENESIS_FROZEN");
  assert.equal(result?.sourceId, genesisHash);
  assert.equal(result?.sourceCommitHash, sourceCommitHash);
  assert.equal(result?.text, "The committed opening visible only to this seat.");
  const projectionQuery = calls.find((call) => call.method === "pressureNarrativeProjection.findMany")?.query;
  assert.deepEqual(projectionQuery?.where, {
    runId: RUN_ID,
    projectionKind: "GENESIS_NARRATIVE",
    sourceAuthority: "GENESIS_FROZEN",
    sourceId: genesisHash,
    narrativeProfileVersion: "narrative-v1",
    audienceKind: "SEAT",
    audienceSeatId: seatId,
    audienceKey: seatId,
  });
  const serializedQueries = JSON.stringify(calls);
  assert.doesNotMatch(serializedQueries, /commitManifestJson|payloadJson|lastError|provider/i);
  assert.doesNotMatch(JSON.stringify(result), /peer|rawAuthority|providerResponse/i);
});

test("Genesis narrative fallback is N1-only and fails closed on route or commit binding mismatches", async () => {
  const seatId = PRESSURE_CHAPTER_SEAT_IDS_V1[0];
  const genesisHash = digest("genesis-fail-closed");
  const commitHash = digest("genesis-fail-closed-commit");
  const runtime = {
    id: "chapter-runtime-N1",
    runId: RUN_ID,
    chapterId: "N1",
    routeHash: ROUTE_HASH,
    state: "CHAPTER_ACTIVE",
    frozenBundle: null,
    beatResolutions: [],
  };
  const route = { runId: RUN_ID, routeHash: ROUTE_HASH, narrativeProfileVersion: "narrative-v1" };
  const genesis = {
    runId: RUN_ID,
    genesisHash,
    commitHash,
    snapshot: { runId: RUN_ID, routeHash: ROUTE_HASH, genesisHash },
  };
  const makeReader = (input: {
    runtime?: typeof runtime;
    genesis?: typeof genesis;
    projectionCommitHash?: string;
  }) => new PrismaPressureGameNarrativeReaderV1({
    $transaction: async <T>(operation: (transaction: PressureNarrativeReadTransactionV1) => Promise<T>) => operation({
      pressureChapterRuntime: { findUnique: async () => input.runtime ?? runtime },
      pressureRunRouteSnapshot: { findUnique: async () => route },
      pressureGenesisCommit: { findUnique: async () => input.genesis ?? genesis },
      pressureNarrativeProjection: {
        findMany: async () => [{
          id: "projection-genesis",
          runId: RUN_ID,
          projectionKind: "GENESIS_NARRATIVE",
          sourceAuthority: "GENESIS_FROZEN",
          sourceId: genesisHash,
          sourceCommitHash: input.projectionCommitHash ?? commitHash,
          sourceContentHash: digest("pending-genesis-content"),
          narrativeProfileVersion: "narrative-v1",
          projectorVersion: "projector-v1",
          audienceKind: "SEAT",
          audienceSeatId: seatId,
          audienceKey: seatId,
          status: "PENDING",
          artifactJson: null,
          artifactContentHash: null,
        }],
      },
    }),
  });
  const scope = {
    runId: RUN_ID,
    routeHash: ROUTE_HASH,
    viewerSeatId: seatId,
    chapterRuntimeId: runtime.id,
  };

  const n2 = await makeReader({ runtime: { ...runtime, chapterId: "N2" } }).readCurrent(scope);
  assert.equal(n2, null);
  await assert.rejects(
    makeReader({
      genesis: { ...genesis, snapshot: { ...genesis.snapshot, routeHash: digest("foreign-route") } },
    }).readCurrent(scope),
    (error: unknown) => liveError(error, PRESSURE_LIVE_ADAPTER_ERROR_CODES.AUTHORITY_MISMATCH),
  );
  await assert.rejects(
    makeReader({ projectionCommitHash: digest("foreign-genesis-commit") }).readCurrent(scope),
    (error: unknown) => liveError(error, PRESSURE_LIVE_ADAPTER_ERROR_CODES.AUTHORITY_MISMATCH),
  );
});

test("narrative reader selects one exact seat-bound W9 artifact and performs zero business writes", async () => {
  const seatId = PRESSURE_CHAPTER_SEAT_IDS_V1[2];
  const resolutionHash = digest("beat-resolution");
  const sourceCommitHash = resolutionHash;
  const sourceContentHash = digest("beat-source-content");
  const projectorVersion = "projector-v1";
  const published = publishedArtifactFixture({
    jobId: "job-beat-own",
    projectionKind: "BEAT_NARRATIVE",
    sourceId: resolutionHash,
    sourceCommitHash,
    sourceContentHash,
    projectorVersion,
    text: "Only this seat may read this narrative.",
    status: "PUBLISHED",
    renderMode: "PROVIDER",
    seatId,
  });
  const calls: Array<{ method: string; query?: Record<string, any> }> = [];
  const row = {
    id: "projection-own",
    runId: RUN_ID,
    projectionKind: "BEAT_NARRATIVE",
    sourceAuthority: "CHAPTER_WORKING",
    sourceId: resolutionHash,
    sourceCommitHash,
    sourceContentHash,
    narrativeProfileVersion: "narrative-v1",
    projectorVersion,
    audienceKind: "SEAT",
    audienceSeatId: seatId,
    audienceKey: seatId,
    status: "PUBLISHED",
    artifactJson: structuredClone(published),
    artifactContentHash: published.contentHash,
  };
  const tx: PressureNarrativeReadTransactionV1 = {
    pressureChapterRuntime: {
      findUnique: async (query) => {
        calls.push({ method: "pressureChapterRuntime.findUnique", query });
        return {
          id: "chapter-runtime",
          runId: RUN_ID,
          chapterId: "N2",
          routeHash: ROUTE_HASH,
          state: "CHAPTER_ACTIVE",
          frozenBundle: null,
          beatResolutions: [{
            runId: RUN_ID,
            chapterRuntimeId: "chapter-runtime",
            committedWorkingRevision: 3,
            resolutionHash,
          }],
        };
      },
    },
    pressureRunRouteSnapshot: {
      findUnique: async (query) => {
        calls.push({ method: "pressureRunRouteSnapshot.findUnique", query });
        return { runId: RUN_ID, routeHash: ROUTE_HASH, narrativeProfileVersion: "narrative-v1" };
      },
    },
    pressureGenesisCommit: {
      findUnique: async () => {
        throw new Error("Genesis must not be read after a committed Beat");
      },
    },
    pressureNarrativeProjection: {
      findMany: async (query) => {
        calls.push({ method: "pressureNarrativeProjection.findMany", query });
        const where = query.where as Record<string, unknown>;
        return where.audienceSeatId === seatId ? [structuredClone(row)] : [];
      },
    },
  };
  const prisma: PressureNarrativeReadPrismaLikeV1 = {
    $transaction: async <T>(operation: (transaction: PressureNarrativeReadTransactionV1) => Promise<T>) => {
      calls.push({ method: "$transaction" });
      return operation(tx);
    },
  };
  const reader = new PrismaPressureGameNarrativeReaderV1(prisma);
  const input = {
    runId: RUN_ID,
    routeHash: ROUTE_HASH,
    viewerSeatId: seatId,
    chapterRuntimeId: "chapter-runtime",
  };
  const first = await reader.readCurrent(input);
  const second = await reader.readCurrent(input);
  assert.deepEqual(second, first);
  assert.equal(first?.text, "Only this seat may read this narrative.");
  const projectionCalls = calls.filter((call) => call.method === "pressureNarrativeProjection.findMany");
  assert.equal(projectionCalls.length, 2);
  for (const call of projectionCalls) {
    assert.deepEqual(call.query?.where.audienceKind, "SEAT");
    assert.deepEqual(call.query?.where.audienceSeatId, seatId);
    assert.deepEqual(call.query?.where.audienceKey, seatId);
  }
  assert.equal(
    calls.some((call) => /create|update|upsert|delete|write|commit/i.test(call.method)),
    false,
  );
});

test("narrative reader rejects foreign Beat and Chapter commits plus every persisted artifact drift", async () => {
  const seatId = PRESSURE_CHAPTER_SEAT_IDS_V1[1];
  const resolutionHash = digest("bound-beat-resolution");
  const bundleHash = digest("bound-chapter-bundle");
  const sourceContentHash = digest("bound-source-content");
  const projectorVersion = "projector-v1";
  const published = publishedArtifactFixture({
    jobId: "job-bound-beat",
    projectionKind: "BEAT_NARRATIVE",
    sourceId: resolutionHash,
    sourceCommitHash: resolutionHash,
    sourceContentHash,
    projectorVersion,
    text: "A canonically bound narrative.",
    status: "PUBLISHED",
    renderMode: "PROVIDER",
    seatId,
  });
  const baseRow: NarrativeTestRow = {
    id: "projection-bound-beat",
    runId: RUN_ID,
    projectionKind: "BEAT_NARRATIVE",
    sourceAuthority: "CHAPTER_WORKING",
    sourceId: resolutionHash,
    sourceCommitHash: resolutionHash,
    sourceContentHash,
    narrativeProfileVersion: "narrative-v1",
    projectorVersion,
    audienceKind: "SEAT",
    audienceSeatId: seatId,
    audienceKey: seatId,
    status: "PUBLISHED",
    artifactJson: structuredClone(published),
    artifactContentHash: published.contentHash,
  };
  const beatRuntime = {
    id: "chapter-runtime-bound",
    runId: RUN_ID,
    chapterId: "N2",
    routeHash: ROUTE_HASH,
    state: "CHAPTER_ACTIVE",
    frozenBundle: null,
    beatResolutions: [{
      runId: RUN_ID,
      chapterRuntimeId: "chapter-runtime-bound",
      committedWorkingRevision: 7,
      resolutionHash,
    }],
  };
  const scope = {
    runId: RUN_ID,
    routeHash: ROUTE_HASH,
    viewerSeatId: seatId,
    chapterRuntimeId: beatRuntime.id,
  };
  const makeReader = (runtime: typeof beatRuntime | {
    id: string;
    runId: string;
    chapterId: string;
    routeHash: string;
    state: string;
    frozenBundle: {
      runId: string;
      chapterRuntimeId: string;
      bundleHash: string;
    };
    beatResolutions: typeof beatRuntime.beatResolutions;
  }, row: NarrativeTestRow) => new PrismaPressureGameNarrativeReaderV1({
    $transaction: async <T>(operation: (transaction: PressureNarrativeReadTransactionV1) => Promise<T>) => (
      operation({
        pressureChapterRuntime: { findUnique: async () => structuredClone(runtime) },
        pressureRunRouteSnapshot: {
          findUnique: async () => ({
            runId: RUN_ID,
            routeHash: ROUTE_HASH,
            narrativeProfileVersion: "narrative-v1",
          }),
        },
        pressureGenesisCommit: {
          findUnique: async () => {
            throw new Error("Genesis must not be read for committed Beat or Chapter authority");
          },
        },
        pressureNarrativeProjection: { findMany: async () => [structuredClone(row)] },
      })
    ),
  });

  await assert.rejects(
    makeReader(beatRuntime, {
      ...baseRow,
      sourceCommitHash: digest("foreign-beat-commit"),
    }).readCurrent(scope),
    (error: unknown) => liveError(error, PRESSURE_LIVE_ADAPTER_ERROR_CODES.AUTHORITY_MISMATCH),
  );

  const chapterRuntime = {
    ...beatRuntime,
    state: "CHAPTER_FROZEN",
    frozenBundle: {
      runId: RUN_ID,
      chapterRuntimeId: beatRuntime.id,
      bundleHash,
    },
  };
  await assert.rejects(
    makeReader(chapterRuntime, {
      ...baseRow,
      id: "projection-bound-chapter",
      projectionKind: "CHAPTER_NARRATIVE",
      sourceAuthority: "CHAPTER_FROZEN",
      sourceId: bundleHash,
      sourceCommitHash: digest("foreign-chapter-commit"),
      status: "PENDING",
      artifactJson: null,
      artifactContentHash: null,
    }).readCurrent(scope),
    (error: unknown) => liveError(error, PRESSURE_LIVE_ADAPTER_ERROR_CODES.AUTHORITY_MISMATCH),
  );

  const driftedText = structuredClone(baseRow);
  (driftedText.artifactJson as OpenNovelNarrativeArtifactV1).text = "Database text drift.";
  const driftedFacts = structuredClone(baseRow);
  (driftedFacts.artifactJson as OpenNovelNarrativeArtifactV1).usedFactRefs = ["foreign-fact"];
  const driftedContentHash = structuredClone(baseRow);
  driftedContentHash.artifactContentHash = digest("foreign-content");
  for (const row of [driftedText, driftedFacts, driftedContentHash]) {
    await assert.rejects(
      makeReader(beatRuntime, row).readCurrent(scope),
      (error: unknown) => liveError(error, PRESSURE_LIVE_ADAPTER_ERROR_CODES.AUTHORITY_MISMATCH),
    );
  }
});

test("feed adapter delegates only viewer-scoped list and fail-closed ports expose configuration errors", async () => {
  const seatId = PRESSURE_CHAPTER_SEAT_IDS_V1[4];
  const feedCalls: unknown[] = [];
  const feed = new AEmotionPressureGameFeedReaderAdapterV1({
    list: async (input) => {
      feedCalls.push(input);
      return {
        schemaVersion: "a_emotion_feed_page_v1",
        roomId: input.roomId,
        runId: input.runId,
        viewerSeatId: input.viewerSeatId,
        items: [],
        unreadCount: 0,
        nextCursor: null,
        serverSequence: 0,
      };
    },
  });
  await feed.list({
    roomId: RUN_ID,
    runId: RUN_ID,
    viewerSeatId: seatId,
    cursor: null,
    limit: 10,
  });
  assert.deepEqual(feedCalls, [{
    roomId: RUN_ID,
    runId: RUN_ID,
    viewerSeatId: seatId,
    cursor: null,
    limit: 10,
  }]);
  assert.equal("mark" in feed, false);
  assert.equal("ingest" in feed, false);

  const authority = new FailClosedSeatControlAuthorityPortV1();
  const privateProjection = new FailClosedSeatPrivateProjectionPortV1();
  const gameViewer = new FailClosedPressureGameViewerReaderV1();
  await assert.rejects(
    authority.readSnapshot(RUN_ID),
    (error: unknown) => liveError(error, PRESSURE_LIVE_ADAPTER_ERROR_CODES.CONFIGURATION_REQUIRED),
  );
  await assert.rejects(
    privateProjection.readForSeat({ runId: RUN_ID, seatId, sourceAuthorityHash: digest("authority") }),
    (error: unknown) => liveError(error, PRESSURE_LIVE_ADAPTER_ERROR_CODES.PRIVATE_PROJECTION_UNAVAILABLE),
  );
  await assert.rejects(
    gameViewer.readViewer({ runId: RUN_ID, subjectId: "subject" }),
    (error: unknown) => liveError(error, PRESSURE_LIVE_ADAPTER_ERROR_CODES.PRIVATE_PROJECTION_UNAVAILABLE),
  );

  const genesis = new CommittedGenesisSeatControlAuthorityReaderV1({
    readCommitted: async () => null,
  });
  assert.equal(await genesis.readGenesisAuthority(RUN_ID), null);
});

function viewerPrisma(
  rows: Map<string, unknown>,
  calls: unknown[],
): CanonicalViewerReadPrismaLikeV1 {
  let selectedSubjectId: string | null = null;
  return {
    pressureSeatControlSnapshot: {
      findUnique: async ({ where }) => {
        const selected = selectedSubjectId
          ? rows.get(selectedSubjectId) as any
          : null;
        if (!selected || where.runId !== RUN_ID) return null;
        const selectedSeatId = selected.role.roleKey as SeatIdV1;
        const legacy = selected.roleControls[0];
        const selectedMode = legacy.mode === "HUMAN_ACTIVE"
          || legacy.mode === "HUMAN_OFFLINE_GRACE"
          ? "HUMAN_ACTIVE"
          : "AI_ACTIVE";
        const seatControls = PRESSURE_CHAPTER_SEAT_IDS_V1.map((seatId, index) => {
          const isSelected = seatId === selectedSeatId;
          const originalHumanControllerId = isSelected ? selected.userId : null;
          const mode = isSelected ? selectedMode : "AI_ACTIVE";
          return {
            seatId,
            mode,
            originalHumanControllerId,
            designatedAiControllerId: `ai:${seatId}`,
            activeControllerId: mode === "HUMAN_ACTIVE"
              ? originalHumanControllerId
              : `ai:${seatId}`,
            controlEpoch: isSelected ? legacy.epoch : 1,
            submissionFenceToken: digest(`submission:${seatId}:${isSelected ? legacy.epoch : 1}`),
            reclaimFenceToken: originalHumanControllerId && mode === "AI_ACTIVE"
              ? digest(`reclaim:${seatId}:${legacy.epoch}`)
              : null,
            lastAuthorityEventHash: digest(`authority:${seatId}:${index}:${isSelected ? legacy.epoch : 1}`),
          };
        });
        const base = {
          schemaVersion: "pressure_seat_control_snapshot_v1" as const,
          runId: RUN_ID,
          participantMode: "SOLO" as const,
          routeHash: ROUTE_HASH,
          genesisHash: digest("genesis"),
          genesisAtomicRecordHash: digest("genesis-atomic"),
          initialTopologyHash: digest("topology"),
          controlTopologyVersion: "seat-control-v1",
          frozenPolicy: {
            schemaVersion: "pressure_frozen_seat_control_policy_v1" as const,
            policyVersion: "seat-policy-v1",
            disconnectPolicy: "PRESENCE_ADVISORY_ONLY" as const,
            takeoverDeadlinePolicyRef: "deadline-policy-v1",
            takeoverDeadlinePolicyHash: digest("deadline-policy"),
            deterministicDefaultPolicyRef: "default-policy-v1",
            deterministicDefaultPolicyHash: digest("default-policy"),
            humanReclaimAllowed: true,
            policyHash: digest("seat-policy"),
          },
          stateRevision: legacy.epoch,
          timelineLength: legacy.epoch,
          timelineHeadHash: digest(`timeline:${legacy.epoch}`),
          seatControls,
          initializationInputHash: digest("seat-initialization"),
        };
        const snapshot = { ...base, stateHash: sha256Canonical(base) };
        const presenceBase = {
          schemaVersion: "pressure_seat_presence_record_v1" as const,
          runId: RUN_ID,
          seatId: selectedSeatId,
          humanControllerId: selected.userId,
          sessionId: `session-${selected.id}`,
          signalSequence: 9,
          status: legacy.mode === "HUMAN_OFFLINE_GRACE"
            ? "DISCONNECTED" as const
            : "ONLINE" as const,
          idempotencyKey: `presence-${selected.id}`,
          requestFingerprint: digest(`presence-request:${selected.id}`),
        };
        const presence = { ...presenceBase, recordHash: sha256Canonical(presenceBase) };
        const key = `${RUN_ID}:${selectedSeatId}:${selected.userId}`;
        return {
          runId: RUN_ID,
          stateRevision: snapshot.stateRevision,
          stateHash: snapshot.stateHash,
          version: 1,
          snapshotJson: {
            schemaVersion: "pressure_seat_control_persistence_envelope_v1",
            snapshot,
            commandReceipts: {},
            proofs: {},
            presenceReceipts: { [presence.idempotencyKey]: presence },
            latestPresence: { [key]: presence },
            directives: {},
            privateProjections: {},
          },
        };
      },
      create: async () => { throw new Error("READ_ONLY_TEST"); },
      updateMany: async () => { throw new Error("READ_ONLY_TEST"); },
    },
    storyPlayer: {
      findUnique: async (query) => {
        calls.push(structuredClone(query));
        selectedSubjectId = query.where.runId_userId.userId;
        return structuredClone(rows.get(query.where.runId_userId.userId) ?? null) as any;
      },
    },
  };
}

function viewerRow(input: {
  seatId: SeatIdV1;
  subjectId: string;
  playerId: string;
  roleId: string;
  roleName: string;
  mode: "HUMAN_ACTIVE" | "HUMAN_OFFLINE_GRACE" | "AI_ACTIVE" | "HUMAN_RECLAIM_PENDING";
  epoch: number;
  transition?: ReturnType<typeof transition>;
  hiddenSecret?: string;
}) {
  return {
    id: input.playerId,
    runId: RUN_ID,
    userId: input.subjectId,
    roleId: input.roleId,
    playerType: "human",
    status: "active",
    run: { id: RUN_ID, pressureRouteSnapshot: { routeHash: ROUTE_HASH } },
    role: {
      id: input.roleId,
      runId: RUN_ID,
      roleKey: input.seatId,
      roleName: input.roleName,
      hiddenSecret: input.hiddenSecret ?? "NEVER_SERIALIZE",
    },
    roleControls: [{
      id: `control-${input.playerId}`,
      runId: RUN_ID,
      roleId: input.roleId,
      humanPlayerId: input.playerId,
      mode: input.mode,
      epoch: input.epoch,
      reclaimAfterWindowId: input.mode === "HUMAN_RECLAIM_PENDING" ? "window-2" : null,
      policyVersion: "legacy-control-v1",
      transitions: input.transition ? [{
        ...input.transition,
        roleControlId: `control-${input.playerId}`,
      }] : [],
    }],
    presenceSessions: [{
      runId: RUN_ID,
      userId: input.subjectId,
      playerId: input.playerId,
      roleId: input.roleId,
      sessionInstanceId: `session-${input.playerId}`,
      lastHeartbeatSequence: 9,
      expiresAt: new Date("2030-01-01T00:10:00.000Z"),
    }],
    peerSecrets: PRESSURE_CHAPTER_SEAT_IDS_V1.map((_, index) => `NEVER_SERIALIZE_PEER_SECRET_${index}`),
  };
}

function transition(fromMode: string, toMode: string, fromEpoch: number, toEpoch: number) {
  return {
    id: `transition-${fromMode}-${toMode}-${toEpoch}`,
    roleControlId: "rebound-by-fixture",
    fromMode,
    toMode,
    fromEpoch,
    toEpoch,
    reason: "TEST_AUTHORITY_TRANSITION",
    idempotencyKey: `transition-key-${fromMode}-${toMode}-${toEpoch}`,
  };
}

function liveError(error: unknown, code: string): boolean {
  assert.ok(error instanceof PressureLiveAdapterError);
  assert.equal(error.code, code);
  return true;
}

function publishedArtifactFixture(input: {
  jobId: string;
  projectionKind: "GENESIS_NARRATIVE" | "BEAT_NARRATIVE" | "CHAPTER_NARRATIVE";
  sourceId: string;
  sourceCommitHash: string;
  sourceContentHash: string;
  projectorVersion: string;
  text: string;
  status: "PUBLISHED" | "FALLBACK_PUBLISHED";
  renderMode: "PROVIDER" | "AUTHORED_FALLBACK";
  seatId: SeatIdV1;
}) {
  const artifact = {
    schemaVersion: "openovel_narrative_artifact_v1" as const,
    jobId: input.jobId,
    runId: RUN_ID,
    projectionKind: input.projectionKind,
    sourceId: input.sourceId,
    sourceCommitHash: input.sourceCommitHash,
    sourceContentHash: input.sourceContentHash,
    audience: { kind: "SEAT" as const, seatId: input.seatId },
    narrativeProfileVersion: "narrative-v1",
    projectorVersion: input.projectorVersion,
    text: input.text,
    usedFactRefs: [] as string[],
    validationReportHash: digest(`${input.jobId}:validation`),
    contentHash: "",
    renderMode: input.renderMode,
    status: input.status,
  };
  return {
    ...artifact,
    contentHash: sha256Canonical({
      text: artifact.text,
      usedFactRefs: artifact.usedFactRefs,
    }),
  };
}

class RouteFixtureRepository implements RunRouteRepositoryPort {
  private record: StoredRunRouteRecordV1 | null = null;

  async findByRunId(): Promise<StoredRunRouteRecordV1 | null> {
    return this.record ? structuredClone(this.record) : null;
  }

  async insertIfAbsent(record: StoredRunRouteRecordV1) {
    if (this.record) return { status: "EXISTING" as const, record: structuredClone(this.record) };
    this.record = structuredClone(record);
    return { status: "INSERTED" as const, record: structuredClone(record) };
  }
}

async function storedRouteFixture(runId: string): Promise<StoredRunRouteRecordV1> {
  const repository = new RouteFixtureRepository();
  const service = new PressureChapterRunRouterService(repository, routeRegistry());
  const command: CreatePressureRunRouteCommandV1 = {
    runId,
    routeKey: null,
    participantMode: "SOLO" satisfies ParticipantModeV1,
    humanSeatIdsAtStart: [PRESSURE_CHAPTER_SEAT_IDS_V1[0]],
    runSeed: `seed-${runId}`,
  };
  return (await service.create(command)).route;
}

function routeRegistry(): PressureChapterRouteRegistry {
  const base: Omit<PressureChapterRouteRegistryV1, "registryHash"> = {
    schemaVersion: PRESSURE_CHAPTER_ROUTE_REGISTRY_SCHEMA_V1,
    registryVersion: "pressure-live-test-registry-v1",
    defaultRouteKey: "sangtian-pressure",
    routes: [{
      routeKey: "sangtian-pressure",
      worldId: "sangtian",
      status: "PUBLISHED",
      createEnabled: true,
      participantModes: ["SOLO", "MULTIPLAYER"],
      route: { ...PRESSURE_CHAPTER_ROUTE_TUPLE_V1 },
      contentPackageVersion: "sangtian-content-v1",
      contentPackageSha256: digest("content"),
      orchestrationPackageVersion: "sangtian-orchestration-v1",
      orchestrationPackageSha256: digest("orchestration"),
      runtimeContractVersion: "pressure-runtime-v1",
      runtimeContractSha256: digest("runtime"),
      testMatrixVersion: "pressure-test-v1",
      testMatrixSha256: digest("tests"),
      narrativeProfileVersion: "narrative-v1",
      featureSetVersion: "features-v1",
      resultContractRegistryVersion: "result-v1",
      controlTopologyVersion: "control-v1",
      handlerKey: "pressure_chapter_v1",
      resultAdapterKey: "SangtianPressureResultV1Adapter",
      presentationSchemaVersion: "sangtian_pressure_result_v1",
      rendererKey: "sangtian_pressure_endgame_v1",
    }],
  };
  return new PressureChapterRouteRegistry({
    ...base,
    registryHash: computePressureChapterRouteRegistryHash(base),
  });
}

function digest(label: string): string {
  return sha256Canonical({ label });
}
