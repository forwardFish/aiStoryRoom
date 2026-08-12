import { Prisma } from "@prisma/client";
import {
  compareCanonicalText,
  sha256Canonical,
  validateAuthoritativePressureResultSnapshotV1,
  validateFrozenChapterBundleV1,
  validateWorldStateV1,
  type FrozenChapterBundleV1,
  type FrozenFinalePolicyV1,
  type TerminalResultContextV1,
  type WorldStateV1,
} from "@ai-story/shared";
import type { FinaleShadowComparisonV1 } from "@ai-story/templates";
import {
  validateCommittedGenesis,
} from "../genesis";
import {
  assertStoredRunRouteRecord,
  type StoredRunRouteRecordV1,
} from "../run-router";
import {
  validateAuthorityFirstTerminalRecordV1,
  type AuthorityFirstTerminalCommitResultV1,
  type AuthorityFirstTerminalCommitterPort,
  type AuthorityFirstTerminalRecordV1,
} from "../terminal-commit";
import {
  validateN7FrozenFinaleSourceV1,
  withN7FrozenFinaleSourceFingerprintV1,
} from "../finale/assembler";
import type {
  N7FrozenFinaleSourceReaderPort,
  N7FrozenFinaleSourceV1,
} from "../finale/ports";
import {
  createSangtianAEmotionContentSourceCompilerV1,
  type SangtianAEmotionContentSourceCompilerV1,
} from "../a-emotion-production/content-source";
import type { WorkingLedgerEventV1 } from "../working-ledger/contracts";
import {
  buildAuthorityDownstreamManifestV1,
  downstreamDedupeKeysV1,
  insertAEmotionAuthorityEmissionsV1,
  insertNarrativeProjectionPlanV1,
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

interface RouteAuthorityRow {
  runId: string;
  routeHash: string;
  routeJson: unknown;
}

interface GenesisAuthorityRow {
  runId: string;
  genesisHash: string;
  commitManifestJson: unknown;
}

interface ChapterAuthorityRow {
  runId: string;
  chapterRuntimeId: string;
  chapterId: string;
  chapterSequence: number;
  commitManifestJson: unknown;
  commitManifestHash: string;
  commitHash: string;
  committedAt: Date;
}

interface N7RuntimeAuthorityRow {
  id: string;
  runId: string;
  chapterId: string;
  chapterSequence: number;
  state: string;
  routeHash: string;
}

interface RunAuthorityRow {
  id: string;
  worldSequence: number;
  stateJson: unknown;
  status: string;
  currentNodeId: string | null;
}

interface TerminalCommittedRow {
  runId: string;
  requestFingerprint: string;
  commitManifestJson: unknown;
  outboxDedupeKeysJson: unknown;
  commitHash: string;
}

interface N7FrozenReadTransaction {
  pressureRunRouteSnapshot: {
    findUnique(input: Record<string, unknown>): Promise<RouteAuthorityRow | null>;
  };
  pressureGenesisCommit: {
    findUnique(input: Record<string, unknown>): Promise<GenesisAuthorityRow | null>;
  };
  pressureChapterSettlement: {
    findMany(input: Record<string, unknown>): Promise<ChapterAuthorityRow[]>;
  };
  pressureChapterRuntime: {
    findUnique(input: Record<string, unknown>): Promise<N7RuntimeAuthorityRow | null>;
  };
  storyRun: {
    findUnique(input: Record<string, unknown>): Promise<RunAuthorityRow | null>;
  };
}

interface TerminalCommitTransaction extends N7FrozenReadTransaction {
  pressureFinaleDecision: {
    findUnique(input: Record<string, unknown>): Promise<TerminalCommittedRow | null>;
    create(input: { data: Record<string, unknown> }): Promise<{ id: string }>;
  };
  pressureNarrativeProjection: {
    create(input: { data: Record<string, unknown> }): Promise<{ id: string }>;
  };
  pressureOutboxTask: {
    create(input: { data: Record<string, unknown> }): Promise<unknown>;
  };
  storyEvent: {
    findMany(input: Record<string, unknown>): Promise<Array<{
      runId: string;
      payloadJson: unknown;
    }>>;
    create(input: { data: Record<string, unknown> }): Promise<unknown>;
  };
  storyRun: N7FrozenReadTransaction["storyRun"] & {
    updateMany(input: {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    }): Promise<{ count: number }>;
  };
}

export interface FrozenFinaleConfigurationResolverPortV1 {
  /** Resolve only immutable, hash-addressed content for the frozen route. */
  resolve(input: Readonly<{
    route: StoredRunRouteRecordV1;
    genesisHash: string;
    frozenChapterBundles: readonly FrozenChapterBundleV1[];
    finalWorldState: WorldStateV1;
    /** Database-owned N7 settlement commit time from this Serializable snapshot. */
    terminalCommittedAt: string;
  }>): Promise<Readonly<{
    policy: FrozenFinalePolicyV1;
    terminalResultContext: TerminalResultContextV1;
  }>>;
}

export type N7FrozenFinaleSourcePrismaClient =
  PressureSerializableClient<N7FrozenReadTransaction>;

/** Reads route, Genesis, N1-N7 and the final world in one Serializable snapshot. */
export class PrismaN7FrozenFinaleSourceReader
implements N7FrozenFinaleSourceReaderPort {
  constructor(
    private readonly prisma: N7FrozenFinaleSourcePrismaClient,
    private readonly configuration: FrozenFinaleConfigurationResolverPortV1,
  ) {}

  async readN7FrozenSource(runId: string): Promise<N7FrozenFinaleSourceV1 | null> {
    nonEmpty(runId, "runId");
    return pressureSerializableTransaction(this.prisma, (tx) =>
      readN7FrozenSource(tx, runId, this.configuration));
  }
}

export type AuthorityFirstTerminalPrismaClient =
  PressureSerializableClient<TerminalCommitTransaction>;

/**
 * Sole finale authority writer. Decision, six seat outcomes, immutable Result,
 * seven narrative identities/tasks, root event and terminal Run state commit
 * together; narrative generation is deliberately absent from this capability.
 *
 * The complete terminal record is stored once in FinaleDecision.commitManifestJson.
 * Seat outcomes and Result remain validated fields of that immutable record;
 * the MVP deliberately avoids duplicate child-table copies of the same authority.
 */
export class PrismaAuthorityFirstTerminalCommitter
implements AuthorityFirstTerminalCommitterPort {
  constructor(
    private readonly prisma: AuthorityFirstTerminalPrismaClient,
    private readonly configuration: FrozenFinaleConfigurationResolverPortV1,
    private readonly projectorVersion: string,
    private readonly aEmotionCompiler?: Pick<
      SangtianAEmotionContentSourceCompilerV1,
      "compileFinale"
    >,
  ) {
    nonEmpty(projectorVersion, "projectorVersion");
  }

  async readCommitted(runId: string): Promise<AuthorityFirstTerminalRecordV1 | null> {
    nonEmpty(runId, "runId");
    return pressureSerializableTransaction(this.prisma, async (tx) => {
      const row = await tx.pressureFinaleDecision.findUnique({
        where: { runId },
        select: {
          runId: true,
          requestFingerprint: true,
          commitManifestJson: true,
          outboxDedupeKeysJson: true,
          commitHash: true,
        },
      });
      return row ? decodeTerminalRecord(row, runId) : null;
    });
  }

  async commitOnce(
    recordValue: Readonly<AuthorityFirstTerminalRecordV1>,
  ): Promise<AuthorityFirstTerminalCommitResultV1> {
    const record = structuredClone(validateAuthorityFirstTerminalRecordV1(recordValue));
    try {
      return await pressureSerializableTransaction(this.prisma, async (tx) => {
        const existing = await tx.pressureFinaleDecision.findUnique({
          where: { runId: record.runId },
          select: {
            runId: true,
            requestFingerprint: true,
            commitManifestJson: true,
            outboxDedupeKeysJson: true,
            commitHash: true,
          },
        });
        if (existing) {
          return {
            status: "REPLAYED" as const,
            record: assertSameTerminal(decodeTerminalRecord(existing, record.runId), record),
          };
        }

        const source = await readN7FrozenSource(tx, record.runId, this.configuration);
        if (!source) throw notFound("N7 frozen authority source is absent", record.runId);
        assertTerminalFence(record, source);

        const rootEventId = `finale_frozen_${record.authorityCommitHash.slice(0, 24)}`;
        const finaleChapters = await readFinaleAEmotionChapters(
          tx,
          record.runId,
          source.frozenChapterBundles,
        );
        const emissions = (this.aEmotionCompiler
          ?? createSangtianAEmotionContentSourceCompilerV1()).compileFinale({
          sourceKind: "FINALE_COMMITTED",
          roomId: record.runId,
          record,
          chapters: finaleChapters,
        });
        const downstreamManifest = buildAuthorityDownstreamManifestV1({
          authorityKind: "FINALE",
          sourceId: record.authorityCommitHash,
          sourceCommitHash: record.authorityCommitHash,
          dedupeKeys: downstreamDedupeKeysV1({
            narrativeJobs: record.narrativeOutbox.jobs,
            aEmotionEmissions: emissions,
          }),
        });
        const decision = record.decision;
        await tx.pressureFinaleDecision.create({
          data: {
            runId: record.runId,
            schemaVersion: decision.schemaVersion,
            runtimeProfile: decision.runtimeProfile,
            policyVersion: decision.policyVersion,
            policyHash: record.policyHash,
            packageSha256: decision.packageSha256,
            routeHash: decision.routeHash,
            genesisHash: decision.genesisHash,
            frozenChapterBundleHashesJson: json(decision.frozenChapterBundleHashes),
            inputHash: record.inputHash,
            evaluationHash: decision.semanticOutcomeHash,
            semanticOutcomeHash: decision.semanticOutcomeHash,
            executionFingerprint: decision.executionFingerprint,
            idempotencyKey: record.idempotencyKey,
            requestFingerprint: record.requestFingerprint,
            worldOutcomeJson: json(decision.worldOutcome),
            trackOutcomesJson: json(decision.tracks),
            objectOutcomeRefsJson: json(decision.objectOutcomeRefs),
            evidenceResponsibilityRefsJson: json(decision.evidenceAndResponsibilityRefs),
            decisionJson: json(decision),
            decisionHash: sha256Canonical(decision),
            commitManifestJson: json(record),
            commitManifestHash: record.atomicRecordHash,
            rootEventId,
            outboxDedupeKeysJson: json(downstreamManifest),
            commitHash: record.authorityCommitHash,
            decidedAt: new Date(decision.decidedAt),
          },
        });

        const result = validateAuthoritativePressureResultSnapshotV1(
          record.resultArtifact,
          record.runId,
        );

        await insertNarrativeProjectionPlanV1(
          tx,
          "PROJECT_FINALE_NARRATIVE",
          record.narrativeOutbox.jobs,
          this.projectorVersion,
        );
        await insertAEmotionAuthorityEmissionsV1(tx, "FINALE_FROZEN", emissions);

        await tx.storyEvent.create({
          data: {
            id: rootEventId,
            runId: record.runId,
            day: 7,
            type: "FINALE_FROZEN",
            messageType: "system",
            visibility: "system",
            payloadJson: json({
              schemaVersion: "pressure_finale_frozen_event_v1",
              runId: record.runId,
              sourceCommitHash: record.authorityCommitHash,
              decisionHash: decision.semanticOutcomeHash,
              resultSnapshotHash: result.snapshotHash,
            }),
            sequence: 8,
            dedupeKey: rootEventId,
          },
        });

        const terminalized = await tx.storyRun.updateMany({
          where: {
            id: record.runId,
            worldSequence: 7,
            currentNodeId: "N7",
          },
          data: {
            status: "completed",
            currentNodeId: "FINALE",
          },
        });
        if (terminalized.count !== 1) {
          throw fence("StoryRun terminal CAS lost", record.runId);
        }
        return { status: "COMMITTED" as const, record };
      });
    } catch (error) {
      if (!isUniqueConflict(error)) throw error;
      const concurrent = await this.readCommitted(record.runId);
      if (!concurrent) throw error;
      return { status: "REPLAYED", record: assertSameTerminal(concurrent, record) };
    }
  }
}

export interface AppendFinaleShadowComparisonV1 {
  runId: string;
  candidatePolicyVersion: string;
  officialSemanticHash: string;
  report: FinaleShadowComparisonV1;
  evidence: unknown;
}

/** Compatibility alias while ProductRoot sheds the no-longer-needed Prisma argument. */
export type FinaleShadowAppendPrismaClient = unknown;

/**
 * Bounded process-local Generic shadow diagnostics. Shadow evaluation is
 * optional MVP observability, never authority, and must not require a table.
 */
export class PrismaGenericFinaleShadowComparisonRepository {
  private readonly entries = new Map<string, AppendFinaleShadowComparisonV1>();

  constructor(
    _unusedPrisma?: FinaleShadowAppendPrismaClient,
    private readonly maxEntries = 128,
  ) {
    if (!Number.isSafeInteger(maxEntries) || maxEntries < 1) {
      throw invalid("Generic Finale shadow diagnostic capacity is invalid");
    }
  }

  async appendOnce(inputValue: Readonly<AppendFinaleShadowComparisonV1>): Promise<{
    status: "APPENDED" | "EXISTING";
  }> {
    const input = validateShadowInput(inputValue);
    const key = `${input.runId}\u0000${input.candidatePolicyVersion}`;
    const existing = this.entries.get(key);
    if (existing) {
      assertSameShadow(existing, input);
      return { status: "EXISTING" };
    }
    this.entries.set(key, structuredClone(input));
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
    return { status: "APPENDED" };
  }
}

async function readFinaleAEmotionChapters(
  tx: Pick<TerminalCommitTransaction, "storyEvent">,
  runId: string,
  bundles: readonly FrozenChapterBundleV1[],
): Promise<Array<{
  bundle: FrozenChapterBundleV1;
  ledgerEvents: WorkingLedgerEventV1[];
}>> {
  const rows = await tx.storyEvent.findMany({
    where: { runId, type: "PRESSURE_WORKING_LEDGER_EVENT" },
    select: { runId: true, payloadJson: true },
  });
  const events = rows.map((row, index) => {
    const event = structuredClone(row.payloadJson) as WorkingLedgerEventV1;
    if (
      row.runId !== runId
      || event.schemaVersion !== "pressure_working_ledger_event_v1"
      || event.runId !== runId
    ) throw invalid("Finale WorkingLedger row binding is invalid", { runId, index });
    return event;
  });
  return bundles.map((bundle) => ({
    bundle: structuredClone(bundle),
    ledgerEvents: events
      .filter((event) => event.chapterId === bundle.chapterId)
      .sort((left, right) => left.sequence - right.sequence),
  }));
}

async function readN7FrozenSource(
  tx: N7FrozenReadTransaction,
  runId: string,
  configuration: FrozenFinaleConfigurationResolverPortV1,
): Promise<N7FrozenFinaleSourceV1 | null> {
  const [routeRow, genesisRow, chapterRows, n7Runtime, run] = await Promise.all([
    tx.pressureRunRouteSnapshot.findUnique({
      where: { runId },
      select: { runId: true, routeHash: true, routeJson: true },
    }),
    tx.pressureGenesisCommit.findUnique({
      where: { runId },
      select: { runId: true, genesisHash: true, commitManifestJson: true },
    }),
    tx.pressureChapterSettlement.findMany({
      where: { runId },
      orderBy: { chapterSequence: "asc" },
      select: {
        runId: true,
        chapterRuntimeId: true,
        chapterId: true,
        chapterSequence: true,
        commitManifestJson: true,
        commitManifestHash: true,
        commitHash: true,
        committedAt: true,
      },
    }),
    tx.pressureChapterRuntime.findUnique({
      where: { runId_chapterId: { runId, chapterId: "N7" } },
      select: {
        id: true,
        runId: true,
        chapterId: true,
        chapterSequence: true,
        state: true,
        routeHash: true,
      },
    }),
    tx.storyRun.findUnique({
      where: { id: runId },
      select: {
        id: true,
        worldSequence: true,
        stateJson: true,
        status: true,
        currentNodeId: true,
      },
    }),
  ]);
  if (!routeRow && !genesisRow && chapterRows.length === 0 && !n7Runtime && !run) return null;
  if (!routeRow || !genesisRow || !n7Runtime || !run) {
    throw invalid("N7 frozen authority source is incomplete", { runId });
  }
  const route = decodeStoredRoute(routeRow);
  const genesis = validateCommittedGenesis(
    genesisRow.commitManifestJson as Parameters<typeof validateCommittedGenesis>[0],
  );
  if (
    genesis.record.runId !== runId
    || genesis.record.snapshot.genesisHash !== genesisRow.genesisHash
  ) throw invalid("Genesis manifest row binding is invalid", { runId });
  if (
    n7Runtime.runId !== runId
    || n7Runtime.chapterId !== "N7"
    || n7Runtime.chapterSequence !== 7
    || n7Runtime.state !== "CHAPTER_FROZEN"
    || n7Runtime.routeHash !== route.snapshot.routeHash
    || run.worldSequence !== 7
    || run.currentNodeId !== "N7"
  ) throw fence("Run is not at the unique N7 frozen fence", runId);
  if (chapterRows.length !== 7) {
    throw fence("N1-N7 must each have exactly one settlement", runId);
  }
  let previousBundleHash = genesisRow.genesisHash;
  const bundles = chapterRows.map((row, index) => {
    const expectedSequence = index + 1;
    const record = decodeChapterSettlementManifest(row.commitManifestJson);
    if (
      row.runId !== runId
      || row.chapterSequence !== expectedSequence
      || record.runId !== row.runId
      || record.chapterRuntimeId !== row.chapterRuntimeId
      || record.chapterId !== row.chapterId
      || record.rootEvent.chapterSequence !== row.chapterSequence
      || record.receipt.commitManifestHash !== row.commitManifestHash
      || record.receipt.commitHash !== row.commitHash
      || !(row.committedAt instanceof Date)
      || !Number.isFinite(row.committedAt.getTime())
    ) throw invalid("Chapter settlement manifest row binding is invalid", {
      runId,
      chapterSequence: row.chapterSequence,
    });
    const bundle = validateFrozenChapterBundleV1(
      record.frozenChapterBundle,
      previousBundleHash,
    );
    previousBundleHash = bundle.bundleHash;
    return bundle;
  });
  const finalWorldState = validateWorldStateV1(run.stateJson);
  if (
    finalWorldState.worldSequence !== 7
    || finalWorldState.stateHash !== bundles[6]!.committedWorldStateHash
  ) throw fence("StoryRun world state does not match the N7 bundle", runId);
  const terminalCommittedAt = chapterRows[6]!.committedAt.toISOString();
  const resolved = await configuration.resolve({
    route: structuredClone(route),
    genesisHash: genesisRow.genesisHash,
    frozenChapterBundles: structuredClone(bundles),
    finalWorldState: structuredClone(finalWorldState),
    terminalCommittedAt,
  });
  if (resolved.terminalResultContext.completedAt !== terminalCommittedAt) {
    throw fence("Finale configuration changed the N7 authority commit time", runId);
  }
  return withN7FrozenFinaleSourceFingerprintV1({
    schemaVersion: "n7_frozen_finale_source_v1",
    runId,
    triggerKind: "N7_FROZEN",
    terminalChapterId: "N7",
    terminalWorldSequence: 7,
    routeHash: route.snapshot.routeHash,
    runSeed: route.snapshot.runSeed,
    genesisHash: genesisRow.genesisHash,
    frozenChapterBundles: bundles,
    finalWorldState,
    causalEdges: bundles
      .flatMap((bundle) => bundle.causalEdges)
      .sort((left, right) => compareCanonicalText(
        `${left.causeRef}\u0000${left.effectRef}\u0000${left.relation}`,
        `${right.causeRef}\u0000${right.effectRef}\u0000${right.relation}`,
      )),
    policy: structuredClone(resolved.policy),
    terminalResultContext: structuredClone(resolved.terminalResultContext),
  });
}

function decodeChapterSettlementManifest(value: unknown): {
  runId: string;
  chapterRuntimeId: string;
  chapterId: string;
  rootEvent: { chapterSequence: number };
  frozenChapterBundle: FrozenChapterBundleV1;
  receipt: { commitManifestHash: string; commitHash: string };
} {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw invalid("Chapter settlement commit manifest is invalid");
  }
  const record = value as Record<string, unknown>;
  const { atomicRecordHash, ...withoutHash } = record;
  const rootEvent = record.rootEvent as Record<string, unknown> | undefined;
  const receipt = record.receipt as Record<string, unknown> | undefined;
  if (
    record.schemaVersion !== "pressure_atomic_chapter_commit_v1"
    || typeof record.runId !== "string"
    || typeof record.chapterRuntimeId !== "string"
    || typeof record.chapterId !== "string"
    || !rootEvent
    || !Number.isSafeInteger(rootEvent.chapterSequence)
    || !receipt
    || typeof receipt.commitManifestHash !== "string"
    || typeof receipt.commitHash !== "string"
    || typeof atomicRecordHash !== "string"
    || sha256Canonical(withoutHash) !== atomicRecordHash
  ) throw invalid("Chapter settlement commit manifest binding is invalid");
  return {
    runId: record.runId,
    chapterRuntimeId: record.chapterRuntimeId,
    chapterId: record.chapterId,
    rootEvent: { chapterSequence: rootEvent.chapterSequence as number },
    frozenChapterBundle: structuredClone(record.frozenChapterBundle) as FrozenChapterBundleV1,
    receipt: {
      commitManifestHash: receipt.commitManifestHash,
      commitHash: receipt.commitHash,
    },
  };
}

function assertTerminalFence(
  record: AuthorityFirstTerminalRecordV1,
  sourceValue: N7FrozenFinaleSourceV1,
): void {
  const source = validateN7FrozenFinaleSourceV1(sourceValue, record.runId);
  const decision = record.decision;
  const expectedInputHash = sha256Canonical({
    schemaVersion: "sangtian_finale_input_v1",
    runId: source.runId,
    routeHash: source.routeHash,
    runSeed: source.runSeed,
    genesisHash: source.genesisHash,
    frozenChapterBundles: source.frozenChapterBundles,
    finalWorldState: source.finalWorldState,
    causalEdges: source.causalEdges,
    policyVersion: source.policy.policyVersion,
    policyHash: source.policy.policyHash,
  });
  const context = source.terminalResultContext;
  const result = record.resultArtifact;
  if (
    record.requestFingerprint !== source.sourceFingerprint
    || record.inputHash !== expectedInputHash
    || decision.routeHash !== source.routeHash
    || decision.genesisHash !== source.genesisHash
    || decision.policyVersion !== source.policy.policyVersion
    || record.policyHash !== source.policy.policyHash
    || decision.packageSha256 !== source.policy.contentPackageSha256
    || sha256Canonical(decision.frozenChapterBundleHashes)
      !== sha256Canonical(source.frozenChapterBundles.map((bundle) => bundle.bundleHash))
    || decision.decidedAt !== context.completedAt
    || result.terminalContextHash !== context.contextHash
    || result.roomId !== context.roomId
    || result.participantMode !== context.participantMode
    || result.completedAt !== context.completedAt
    || sha256Canonical(result.frozenRoute) !== sha256Canonical(context.frozenRoute)
    || result.frozenRouteHash !== context.frozenRouteHash
    || result.resultContractRegistryVersion !== context.resultContractRegistryVersion
    || result.payloadSchemaVersion !== context.payloadSchemaVersion
    || result.presentationSchemaVersion !== context.presentationSchemaVersion
    || result.rendererKey !== context.rendererKey
    || result.contentPackageVersion !== context.contentPackageVersion
    || result.contentPackageSha256 !== context.contentPackageSha256
  ) throw fence("Terminal record no longer matches the N7 frozen source", record.runId);
}

function decodeStoredRoute(row: RouteAuthorityRow): StoredRunRouteRecordV1 {
  try {
    const record = assertStoredRunRouteRecord(row.routeJson as StoredRunRouteRecordV1);
    if (record.runId !== row.runId || record.snapshot.routeHash !== row.routeHash) {
      throw new Error("ROW_BINDING_MISMATCH");
    }
    return structuredClone(record);
  } catch (cause) {
    throw invalid("Stored route manifest is invalid", {
      runId: row.runId,
      cause: cause instanceof Error ? cause.message : String(cause),
    });
  }
}

function decodeTerminalRecord(
  row: TerminalCommittedRow,
  expectedRunId: string,
): AuthorityFirstTerminalRecordV1 {
  try {
    const record = validateAuthorityFirstTerminalRecordV1(row.commitManifestJson);
    if (
      record.runId !== row.runId
      || record.runId !== expectedRunId
      || record.requestFingerprint !== row.requestFingerprint
      || record.authorityCommitHash !== row.commitHash
    ) throw new Error("ROW_BINDING_MISMATCH");
    const manifest = validateAuthorityDownstreamManifestV1(row.outboxDedupeKeysJson, {
      authorityKind: "FINALE",
      sourceId: record.authorityCommitHash,
      sourceCommitHash: record.authorityCommitHash,
    });
    if (record.narrativeOutbox.jobs.some(
      (job) => !manifest.dedupeKeys.includes(job.idempotencyKey),
    )) throw new Error("DOWNSTREAM_MANIFEST_DEDUPE_MISMATCH");
    return structuredClone(record);
  } catch (cause) {
    throw invalid("Stored terminal manifest is invalid", {
      runId: expectedRunId,
      cause: cause instanceof Error ? cause.message : String(cause),
    });
  }
}

function assertSameTerminal(
  stored: AuthorityFirstTerminalRecordV1,
  candidate: AuthorityFirstTerminalRecordV1,
): AuthorityFirstTerminalRecordV1 {
  if (
    stored.idempotencyKey !== candidate.idempotencyKey
    || stored.requestFingerprint !== candidate.requestFingerprint
    || stored.atomicRecordHash !== candidate.atomicRecordHash
  ) {
    throw new PressurePersistenceError(
      ERROR.FINGERPRINT_MISMATCH,
      "Finale is already committed with a different command or record",
      { runId: candidate.runId },
    );
  }
  return structuredClone(stored);
}

function validateShadowInput(
  input: Readonly<AppendFinaleShadowComparisonV1>,
): AppendFinaleShadowComparisonV1 {
  nonEmpty(input.runId, "shadow.runId");
  nonEmpty(input.candidatePolicyVersion, "shadow.candidatePolicyVersion");
  hash(input.officialSemanticHash, "shadow.officialSemanticHash");
  const report = structuredClone(input.report);
  if (
    report.schemaVersion !== "sangtian_finale_shadow_comparison_v1"
    || typeof report.matches !== "boolean"
    || !Array.isArray(report.mismatches)
  ) throw invalid("Generic Finale shadow report is invalid");
  for (const field of [
    "authoritativeExecutionFingerprint",
    "shadowDecisionHash",
    "reportHash",
  ] as const) hash(report[field], `shadow.report.${field}`);
  nonEmpty(report.shadowEngineVersion, "shadow.report.shadowEngineVersion");
  const { reportHash: _reportHash, ...withoutHash } = report;
  if (sha256Canonical(withoutHash) !== report.reportHash) {
    throw invalid("Generic Finale shadow report hash is invalid");
  }
  return {
    ...structuredClone(input),
    report,
    evidence: structuredClone(input.evidence),
  };
}

function assertSameShadow(
  row: AppendFinaleShadowComparisonV1,
  input: AppendFinaleShadowComparisonV1,
): void {
  if (sha256Canonical(row) !== sha256Canonical(input)) {
    throw new PressurePersistenceError(
      ERROR.FINGERPRINT_MISMATCH,
      "Generic Finale shadow key was reused for different evidence",
      { runId: input.runId, candidatePolicyVersion: input.candidatePolicyVersion },
    );
  }
}

function nonEmpty(value: unknown, path: string): asserts value is string {
  if (typeof value !== "string" || !value.trim()) {
    throw invalid(`${path} must be a non-empty string`);
  }
}

function hash(value: unknown, path: string): asserts value is string {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) {
    throw invalid(`${path} must be a lowercase SHA-256`);
  }
}

function notFound(message: string, runId: string): PressurePersistenceError {
  return new PressurePersistenceError(ERROR.RECORD_NOT_FOUND, message, { runId });
}

function fence(message: string, runId: string): PressurePersistenceError {
  return new PressurePersistenceError(
    ERROR.AUTHORITY_FENCE_MISMATCH,
    message,
    { runId },
  );
}

function invalid(
  message: string,
  details: Record<string, unknown> = {},
): PressurePersistenceError {
  return new PressurePersistenceError(ERROR.RECORD_INVALID, message, details);
}

function json(value: unknown): Prisma.InputJsonValue {
  return structuredClone(value) as Prisma.InputJsonValue;
}
