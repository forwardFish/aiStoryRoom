import assert from "node:assert/strict";
import test from "node:test";
import {
  CHAPTER_IDS_V1,
  PRESSURE_CHAPTER_ROUTE_V1,
  PRESSURE_CHAPTER_SEAT_IDS_V1,
  TRACK_IDS_V1,
  compareCanonicalText,
  nextChapterId,
  sha256Canonical,
  validateSangtianFinaleInputV1,
  withRunRouteHash,
  type FrozenChapterBundleV1,
  type FrozenFinalePolicyV1,
  type FrozenResultReferenceV1,
  type ScalarFactValueV1,
  type SeatIdV1,
  type TerminalResultContextV1,
  type TrackIdV1,
  type WorldStateV1,
} from "@ai-story/shared";
import {
  buildSangtianFinaleIdempotencyKeyV1,
  compileSangtianContentFinalePolicyV1,
  evaluateSangtianPressureFinaleV1,
} from "@ai-story/templates";
import {
  buildGenesisAtomicRecord,
  buildGenesisCommitReceipt,
} from "../genesis/genesis.service";
import { sealAEmotionAuthorityOutboxJobV1 } from "../a-emotion-production/compiler";
import type {
  SangtianAEmotionContentSourceCompilerV1,
} from "../a-emotion-production/content-source";
import {
  computeCreateRequestFingerprint,
  type StoredRunRouteRecordV1,
} from "../run-router";
import {
  buildAuthorityFirstTerminalRecordV1,
} from "../terminal-commit";
import {
  PrismaAuthorityFirstTerminalCommitter,
  PrismaGenericFinaleShadowComparisonRepository,
  PrismaN7FrozenFinaleSourceReader,
  type AuthorityFirstTerminalPrismaClient,
  type FrozenFinaleConfigurationResolverPortV1,
} from "./terminal.prisma-adapter";

const RUN_ID = "run-terminal-persistence";
const DECIDED_AT = "2026-08-12T01:00:00.000Z";
const PROJECTOR_VERSION = "openovel-projector-1.0.0";
const digest = (label: string): string => sha256Canonical({ label });

test("N7 reader and authority-first terminal commit are one frozen read/atomic write chain", async () => {
  const fixture = buildFixture();
  const db = new TerminalFake(fixture);
  const reader = new PrismaN7FrozenFinaleSourceReader(db.client, fixture.configuration);

  const source = await reader.readN7FrozenSource(RUN_ID);
  assert(source);
  assert.equal(source.sourceFingerprint, fixture.sourceFingerprint);
  assert.equal(source.terminalResultContext.completedAt, DECIDED_AT);
  assert.equal(fixture.configurationInputs.length, 1);
  assert.equal(fixture.configurationInputs[0]!.terminalCommittedAt, DECIDED_AT);
  assert.equal(db.authorityWrites(), 0, "N7 reader must be zero-write");

  const repository = terminalRepository(db, fixture);
  const first = await repository.commitOnce(fixture.record);
  assert.equal(first.status, "COMMITTED");
  assert.equal(db.finaleWrites, 1);
  assert.equal(db.projections.length, 7);
  assert.equal(db.outbox.length, 8);
  assert.equal(db.outbox.filter((row) => row.taskType === "PROJECT_FINALE_NARRATIVE").length, 7);
  assert.equal(
    db.outbox.filter((row) => row.taskType === "INTERACTION_COMPILE_REQUESTED").length,
    1,
  );
  assert.equal(db.events.length, 1);
  assert.equal(db.run.worldSequence, 7, "Finale must not perform another world settlement");
  assert.equal(db.run.status, "completed");
  assert.equal(db.run.currentNodeId, "FINALE");
  assert.equal(
    (db.finale!.commitManifestJson as any).resultArtifact.snapshotHash,
    fixture.record.resultArtifact.snapshotHash,
  );
  assert.equal((db.finale!.commitManifestJson as any).seatOutcomes.length, 6);
  assert.equal("narratives" in (db.finale!.commitManifestJson as any).resultArtifact, false);
  assert(db.calls.indexOf("finale.create") < db.calls.indexOf("projection.create"));
  assert(db.calls.lastIndexOf("outbox.create") < db.calls.indexOf("run.terminal-cas"));
  assert(db.calls.indexOf("run.terminal-cas") < db.calls.lastIndexOf("tx.commit"));

  const writeCount = db.authorityWrites();
  const second = await repository.commitOnce(fixture.record);
  assert.equal(second.status, "REPLAYED");
  assert.equal(db.authorityWrites(), writeCount, "same fingerprint is a read-only replay");
  assert.equal(db.projections.length, 7, "replay must not duplicate projections");
  assert.equal(db.outbox.length, 8, "replay must not duplicate outbox tasks");

  db.finale!.outboxDedupeKeysJson = [];
  await assert.rejects(
    () => repository.readCommitted(RUN_ID),
    /Stored terminal manifest is invalid/i,
  );
});

test("N7 settlement committedAt is the stable sole Finale time authority", async () => {
  const firstFixture = buildFixture();
  const secondFixture = buildFixture();
  const first = await new PrismaN7FrozenFinaleSourceReader(
    new TerminalFake(firstFixture).client,
    firstFixture.configuration,
  ).readN7FrozenSource(RUN_ID);
  const replayAfterRestart = await new PrismaN7FrozenFinaleSourceReader(
    new TerminalFake(secondFixture).client,
    secondFixture.configuration,
  ).readN7FrozenSource(RUN_ID);

  assert(first && replayAfterRestart);
  assert.equal(first.terminalResultContext.completedAt, DECIDED_AT);
  assert.equal(replayAfterRestart.terminalResultContext.completedAt, DECIDED_AT);
  assert.equal(first.sourceFingerprint, replayAfterRestart.sourceFingerprint);

  const wrongConfiguration: FrozenFinaleConfigurationResolverPortV1 = {
    async resolve(input) {
      assert.equal(input.terminalCommittedAt, DECIDED_AT);
      return {
        policy: structuredClone(firstFixture.policy),
        terminalResultContext: {
          ...structuredClone(firstFixture.terminalResultContext),
          completedAt: "2099-01-01T00:00:00.000Z",
        },
      };
    },
  };
  await assert.rejects(
    () => new PrismaN7FrozenFinaleSourceReader(
      new TerminalFake(firstFixture).client,
      wrongConfiguration,
    ).readN7FrozenSource(RUN_ID),
    /changed the N7 authority commit time/u,
  );
});

test("terminal commit fails closed before any write when the N7 fence moved", async () => {
  const fixture = buildFixture();
  const db = new TerminalFake(fixture);
  db.run.worldSequence = 8;
  const repository = terminalRepository(db, fixture);
  await assert.rejects(repository.commitOnce(fixture.record), /N7 frozen fence/);
  assert.equal(db.authorityWrites(), 0);
});

test("terminal downstream failure rolls back embedded Finale/Result, projections, outbox and Run", async () => {
  const fixture = buildFixture();
  const db = new TerminalFake(fixture);
  db.failTaskType = "INTERACTION_COMPILE_REQUESTED";
  const repository = terminalRepository(db, fixture);

  await assert.rejects(() => repository.commitOnce(fixture.record), /injected outbox failure/i);
  assert.equal(db.authorityWrites(), 0);
  assert.equal(db.finale, null);
  assert.equal(db.run.status, "playing");
  assert.equal(db.run.currentNodeId, "N7");
});

test("Generic shadow comparison is bounded process-local diagnostics with no DB capability", async () => {
  const reportWithoutHash = {
    schemaVersion: "sangtian_finale_shadow_comparison_v1" as const,
    authoritativeExecutionFingerprint: digest("official-execution"),
    shadowEngineVersion: "generic-shadow-3.0.0",
    shadowDecisionHash: digest("shadow-decision"),
    matches: false,
    mismatches: [{
      code: "WORLD_OUTCOME_MISMATCH",
      path: "worldOutcome.outcomeId",
      authoritative: "BALANCED_SURVIVAL",
      shadow: "OTHER",
    }],
  };
  const report = { ...reportWithoutHash, reportHash: sha256Canonical(reportWithoutHash) };
  const repository = new PrismaGenericFinaleShadowComparisonRepository(undefined, 1);
  const input = {
    runId: RUN_ID,
    candidatePolicyVersion: "sangtian-config-candidate-1.0.0",
    officialSemanticHash: digest("official-semantic"),
    report,
    evidence: { candidateInputHash: digest("candidate-input") },
  };
  assert.equal((await repository.appendOnce(input)).status, "APPENDED");
  assert.equal((await repository.appendOnce(input)).status, "EXISTING");
  await repository.appendOnce({ ...input, runId: "run-evicts-first" });
  assert.equal((await repository.appendOnce(input)).status, "APPENDED", "old diagnostic was evicted");
});

interface Fixture {
  route: StoredRunRouteRecordV1;
  committedGenesis: ReturnType<typeof committedGenesis>;
  bundles: FrozenChapterBundleV1[];
  policy: FrozenFinalePolicyV1;
  terminalResultContext: TerminalResultContextV1;
  sourceFingerprint: string;
  record: ReturnType<typeof buildAuthorityFirstTerminalRecordV1>;
  configuration: FrozenFinaleConfigurationResolverPortV1;
  configurationInputs: Array<Parameters<FrozenFinaleConfigurationResolverPortV1["resolve"]>[0]>;
}

function buildFixture(): Fixture {
  const route = routeRecord();
  const initialWorld = worldState(0);
  const genesis = committedGenesis(route, initialWorld);
  const bundles = frozenBundles(genesis.record.snapshot.genesisHash);
  const policy = compileSangtianContentFinalePolicyV1({
    contentPackageVersion: route.snapshot.contentPackageVersion,
    contentPackageSha256: route.snapshot.contentPackageSha256,
  });
  const terminalResultContext = terminalContext(route, policy, bundles);
  const inputWithoutHash = {
    schemaVersion: "sangtian_finale_input_v1" as const,
    runId: RUN_ID,
    routeHash: route.snapshot.routeHash,
    runSeed: route.snapshot.runSeed,
    genesisHash: genesis.record.snapshot.genesisHash,
    frozenChapterBundles: bundles,
    finalWorldState: bundles[6]!.frozenWorldState,
    causalEdges: bundles.flatMap((bundle) => bundle.causalEdges),
    policyVersion: policy.policyVersion,
    policyHash: policy.policyHash,
  };
  const input = validateSangtianFinaleInputV1({
    ...inputWithoutHash,
    inputHash: sha256Canonical(inputWithoutHash),
  });
  const sourceWithoutFingerprint = {
    schemaVersion: "n7_frozen_finale_source_v1" as const,
    runId: RUN_ID,
    triggerKind: "N7_FROZEN" as const,
    terminalChapterId: "N7" as const,
    terminalWorldSequence: 7 as const,
    routeHash: route.snapshot.routeHash,
    runSeed: route.snapshot.runSeed,
    genesisHash: genesis.record.snapshot.genesisHash,
    frozenChapterBundles: bundles,
    finalWorldState: bundles[6]!.frozenWorldState,
    causalEdges: bundles.flatMap((bundle) => bundle.causalEdges),
    policy,
    terminalResultContext,
  };
  const sourceFingerprint = sha256Canonical(sourceWithoutFingerprint);
  const decision = evaluateSangtianPressureFinaleV1({
    input,
    policy,
    decidedAt: DECIDED_AT,
    idempotencyKey: buildSangtianFinaleIdempotencyKeyV1({
      inputHash: input.inputHash,
      policyHash: policy.policyHash,
      decidedAt: DECIDED_AT,
    }),
  });
  const record = buildAuthorityFirstTerminalRecordV1({
    idempotencyKey: `terminal:${RUN_ID}`,
    requestFingerprint: sourceFingerprint,
    input,
    policy,
    decision,
    terminalResultContext,
  });
  const configurationInputs: Fixture["configurationInputs"] = [];
  const configuration: FrozenFinaleConfigurationResolverPortV1 = {
    async resolve(input) {
      configurationInputs.push(structuredClone(input));
      return {
        policy: structuredClone(policy),
        terminalResultContext: structuredClone(terminalResultContext),
      };
    },
  };
  return {
    route,
    committedGenesis: genesis,
    bundles,
    policy,
    terminalResultContext,
    sourceFingerprint,
    record,
    configuration,
    configurationInputs,
  };
}

class TerminalFake {
  readonly calls: string[] = [];
  readonly projections: Array<Record<string, any>> = [];
  readonly outbox: Array<Record<string, any>> = [];
  readonly events: Array<Record<string, any>> = [];
  finale: Record<string, any> | null = null;
  finaleWrites = 0;
  failTaskType: string | null = null;
  readonly run: Record<string, any>;

  constructor(private readonly fixture: Fixture) {
    this.run = {
      id: RUN_ID,
      worldSequence: 7,
      stateJson: structuredClone(fixture.bundles[6]!.frozenWorldState),
      status: "playing",
      currentNodeId: "N7",
    };
  }

  readonly client: AuthorityFirstTerminalPrismaClient = {
    $transaction: async <T>(operation: (tx: any) => Promise<T>): Promise<T> => {
      this.calls.push("tx.begin");
      const before = this.snapshot();
      try {
        const result = await operation(this.tx());
        this.calls.push("tx.commit");
        return result;
      } catch (error) {
        this.restore(before);
        this.calls.push("tx.rollback");
        throw error;
      }
    },
  };

  authorityWrites(): number {
    return this.finaleWrites + this.projections.length + this.outbox.length + this.events.length;
  }

  private tx(): any {
    return {
      pressureRunRouteSnapshot: {
        findUnique: async () => ({
          runId: RUN_ID,
          routeHash: this.fixture.route.snapshot.routeHash,
          routeJson: structuredClone(this.fixture.route),
        }),
      },
      pressureGenesisCommit: {
        findUnique: async () => ({
          runId: RUN_ID,
          genesisHash: this.fixture.committedGenesis.record.snapshot.genesisHash,
          commitManifestJson: structuredClone(this.fixture.committedGenesis),
        }),
      },
      pressureChapterSettlement: {
        findMany: async () => this.fixture.bundles.map((bundle) => {
          const commitManifestJson = settlementManifest(bundle);
          return {
          runId: RUN_ID,
          chapterRuntimeId: `runtime-${bundle.chapterId}`,
          chapterId: bundle.chapterId,
          chapterSequence: bundle.chapterSequence,
          commitManifestJson,
          commitManifestHash: commitManifestJson.receipt.commitManifestHash,
          commitHash: commitManifestJson.receipt.commitHash,
          committedAt: new Date(
            bundle.chapterId === "N7"
              ? DECIDED_AT
              : `2026-08-12T00:0${bundle.chapterSequence}:00.000Z`,
          ),
        };
        }),
      },
      pressureChapterRuntime: {
        findUnique: async () => ({
          id: "runtime-N7",
          runId: RUN_ID,
          chapterId: "N7",
          chapterSequence: 7,
          state: "CHAPTER_FROZEN",
          routeHash: this.fixture.route.snapshot.routeHash,
        }),
      },
      pressureFinaleDecision: {
        findUnique: async () => this.finale
          ? {
              runId: RUN_ID,
              requestFingerprint: this.finale.requestFingerprint,
              commitManifestJson: structuredClone(this.finale.commitManifestJson),
              outboxDedupeKeysJson: structuredClone(this.finale.outboxDedupeKeysJson),
              commitHash: this.finale.commitHash,
            }
          : null,
        create: async ({ data }: any) => {
          this.calls.push("finale.create");
          this.finaleWrites += 1;
          this.finale = { id: "finale-1", ...structuredClone(data) };
          return { id: "finale-1" };
        },
      },
      pressureNarrativeProjection: {
        create: async ({ data }: any) => {
          this.calls.push("projection.create");
          this.projections.push(structuredClone(data));
          return { id: `projection-${this.projections.length}` };
        },
      },
      pressureOutboxTask: {
        create: async ({ data }: any) => {
          this.calls.push("outbox.create");
          if (data.taskType === this.failTaskType) throw new Error("injected outbox failure");
          this.outbox.push(structuredClone(data));
          return data;
        },
      },
      storyEvent: {
        findMany: async () => [],
        create: async ({ data }: any) => {
          this.calls.push("event.create");
          this.events.push(structuredClone(data));
          return data;
        },
      },
      storyRun: {
        findUnique: async () => structuredClone(this.run),
        updateMany: async ({ where, data }: any) => {
          this.calls.push("run.terminal-cas");
          if (
            where.id !== this.run.id
            || where.worldSequence !== this.run.worldSequence
            || where.currentNodeId !== this.run.currentNodeId
          ) return { count: 0 };
          Object.assign(this.run, structuredClone(data));
          return { count: 1 };
        },
      },
    };
  }

  private snapshot(): Record<string, any> {
    return structuredClone({
      projections: this.projections,
      outbox: this.outbox,
      events: this.events,
      finale: this.finale,
      finaleWrites: this.finaleWrites,
      run: this.run,
    });
  }

  private restore(before: Record<string, any>): void {
    this.projections.splice(0, this.projections.length, ...before.projections);
    this.outbox.splice(0, this.outbox.length, ...before.outbox);
    this.events.splice(0, this.events.length, ...before.events);
    this.finale = before.finale;
    this.finaleWrites = before.finaleWrites;
    Object.keys(this.run).forEach((key) => delete this.run[key]);
    Object.assign(this.run, before.run);
  }
}

function terminalRepository(
  db: TerminalFake,
  fixture: Fixture,
): PrismaAuthorityFirstTerminalCommitter {
  return new PrismaAuthorityFirstTerminalCommitter(
    db.client,
    fixture.configuration,
    PROJECTOR_VERSION,
    {
      compileFinale(input: any) {
        const job = sealAEmotionAuthorityOutboxJobV1({
          schemaVersion: "a_emotion_authority_outbox_job_v1",
          sourceKind: "FINALE_COMMITTED",
          runId: input.record.runId,
          sourceId: input.record.authorityCommitHash,
          sourceCommitHash: input.record.authorityCommitHash,
          signalId: `finale:${input.record.authorityCommitHash}`,
        });
        return [{
          dedupeKey: `aemotion:${job.jobHash}`,
          job,
          source: {} as never,
        }];
      },
    } satisfies Pick<SangtianAEmotionContentSourceCompilerV1, "compileFinale">,
  );
}

function routeRecord(): StoredRunRouteRecordV1 {
  const topologyWithoutHash = {
    schemaVersion: "pressure_initial_role_control_topology_v1" as const,
    controlTopologyVersion: "six-seat-control-1.0.0",
    participantMode: "MULTIPLAYER" as const,
    seatControls: PRESSURE_CHAPTER_SEAT_IDS_V1.map((seatId) => ({
      seatId,
      mode: "HUMAN_ACTIVE" as const,
    })),
  };
  const controlTopology = {
    ...topologyWithoutHash,
    topologyHash: sha256Canonical(topologyWithoutHash),
  };
  const snapshot = withRunRouteHash({
    schemaVersion: "pressure_run_route_snapshot_v1",
    runId: RUN_ID,
    route: structuredClone(PRESSURE_CHAPTER_ROUTE_V1),
    contentPackageVersion: "sangtian-content-1.0.0",
    contentPackageSha256: digest("content"),
    orchestrationPackageVersion: "sangtian-orchestration-1.0.0",
    orchestrationPackageSha256: digest("orchestration"),
    runtimeContractVersion: "pressure-runtime-1.0.0",
    runtimeContractSha256: digest("runtime-contract"),
    testMatrixVersion: "pressure-tests-1.0.0",
    testMatrixSha256: digest("tests"),
    runSeed: "seed-terminal-persistence",
    narrativeProfileVersion: "openovel-pressure-1.0.0",
    featureSetVersion: "pressure-feature-1.0.0",
    resultContractRegistryVersion: "pressure-result-registry-1.0.0",
    participantMode: "MULTIPLAYER",
    seatIds: [...PRESSURE_CHAPTER_SEAT_IDS_V1],
    humanSeatIdsAtStart: [...PRESSURE_CHAPTER_SEAT_IDS_V1],
    controlTopologyVersion: controlTopology.controlTopologyVersion,
    initialRoleControlSnapshotHash: controlTopology.topologyHash,
  });
  const createRequestFingerprint = computeCreateRequestFingerprint({
    runId: RUN_ID,
    routeKey: "sangtian-pressure",
    participantMode: "MULTIPLAYER",
    humanSeatIdsAtStart: [...PRESSURE_CHAPTER_SEAT_IDS_V1],
    runSeed: snapshot.runSeed,
  });
  const withoutHash = {
    schemaVersion: "pressure_stored_run_route_v1" as const,
    runId: RUN_ID,
    routeKey: "sangtian-pressure",
    registryVersion: "pressure-route-registry-1.0.0",
    registryHash: digest("registry"),
    handlerKey: "pressure_chapter_v1" as const,
    resultAdapterKey: "SangtianPressureResultV1Adapter" as const,
    presentationSchemaVersion: "sangtian_pressure_result_v1" as const,
    rendererKey: "sangtian_pressure_endgame_v1" as const,
    createRequestFingerprint,
    snapshot,
    controlTopology,
  };
  return { ...withoutHash, recordHash: sha256Canonical(withoutHash) };
}

function committedGenesis(route: StoredRunRouteRecordV1, world: WorldStateV1) {
  const record = buildGenesisAtomicRecord(route, world, {
    runId: RUN_ID,
    idempotencyKey: `genesis:${RUN_ID}`,
    requestFingerprint: digest("genesis-request"),
  });
  return { record, receipt: buildGenesisCommitReceipt(record) };
}

function worldState(sequence: number): WorldStateV1 {
  const tracks = withHash({
    schemaVersion: "sangtian_track_state_v1" as const,
    values: Object.fromEntries(TRACK_IDS_V1.map((trackId) => [
      trackId,
      sequence === 7 ? 3 : 0,
    ])) as Record<TrackIdV1, number>,
  }, "stateHash");
  const knowledgeBySeat = PRESSURE_CHAPTER_SEAT_IDS_V1.reduce<WorldStateV1["knowledgeBySeat"]>(
    (result, seatId) => {
      result[seatId] = withHash({
        seatId,
        knownFactRefs: ["fact.public.relief"],
        secretRefs: [`secret.${seatId}`],
        disclosedToSeatIds: [],
      }, "stateHash");
      return result;
    },
    {} as WorldStateV1["knowledgeBySeat"],
  );
  const seatArcs = PRESSURE_CHAPTER_SEAT_IDS_V1.reduce<WorldStateV1["seatArcs"]>(
    (result, seatId) => {
      result[seatId] = withHash({
        seatId,
        arcStage: sequence === 0 ? "P0_FROZEN" : `stage-${sequence}`,
        publicGoalProgress: sequence,
        privateGoalProgress: sequence,
        gainRefs: sequence === 7 ? [`gain.${seatId}`] : [],
        lossRefs: [],
        costRefs: [],
      }, "stateHash");
      return result;
    },
    {} as WorldStateV1["seatArcs"],
  );
  const factValues: Record<string, ScalarFactValueV1> = sequence === 0
    ? { "fact.public.sangtian_edict": true, "frozen.P0.LOCKED": true }
    : { "fact.public.relief": sequence === 7 };
  return withHash({
    schemaVersion: "sangtian_world_state_v1" as const,
    worldSequence: sequence,
    factValues,
    resources: { grain: Math.max(0, 7 - sequence) },
    tracks,
    objects: sequence === 7 ? [{
      objectId: "relief-ledger",
      version: 7,
      stateCode: "SEALED",
      holderSeatId: "cabinet_finance" as SeatIdV1,
      quantity: null,
      tags: ["public"],
      factRefs: ["fact.public.relief"],
    }] : [],
    knowledgeBySeat,
    evidence: [],
    responsibilities: [],
    seatArcs,
  }, "stateHash") as WorldStateV1;
}

function frozenBundles(genesisHash: string): FrozenChapterBundleV1[] {
  const bundles: FrozenChapterBundleV1[] = [];
  let previousFrozenHash = genesisHash;
  CHAPTER_IDS_V1.forEach((chapterId, index) => {
    const sequence = index + 1;
    const world = worldState(sequence);
    const carryForward = withHash({
      nextChapterId: nextChapterId(chapterId),
      unlockedContentRefs: [],
      unresolvedCommitmentRefs: [],
      pendingConsequenceRefs: [],
    }, "carryForwardHash");
    const bundle = withHash({
      schemaVersion: "sangtian_frozen_chapter_bundle_v1" as const,
      runId: RUN_ID,
      chapterId,
      chapterSequence: sequence as 1 | 2 | 3 | 4 | 5 | 6 | 7,
      baseWorldSequence: sequence - 1,
      committedWorldSequence: sequence,
      previousFrozenHash,
      decisionLedgerHash: digest(`ledger-${sequence}`),
      finalWorkingStateHash: digest(`working-${sequence}`),
      settlementPolicyVersion: "sangtian-chapter-settlement-1.0.0",
      worldDelta: { factMutations: [], resourceMutations: [] },
      committedWorldStateHash: world.stateHash,
      frozenWorldState: world,
      causalEdges: [],
      carryForward,
    }, "bundleHash") as FrozenChapterBundleV1;
    bundles.push(bundle);
    previousFrozenHash = bundle.bundleHash;
  });
  return bundles;
}

function settlementManifest(bundle: FrozenChapterBundleV1) {
  const base = {
    schemaVersion: "pressure_atomic_chapter_commit_v1" as const,
    runId: RUN_ID,
    chapterRuntimeId: `runtime-${bundle.chapterId}`,
    chapterId: bundle.chapterId,
    frozenChapterBundle: structuredClone(bundle),
    rootEvent: { chapterSequence: bundle.chapterSequence },
    receipt: {
      commitManifestHash: digest(`settlement-manifest-${bundle.chapterId}`),
      commitHash: digest(`settlement-commit-${bundle.chapterId}`),
    },
  };
  return { ...base, atomicRecordHash: sha256Canonical(base) };
}

function terminalContext(
  route: StoredRunRouteRecordV1,
  policy: FrozenFinalePolicyV1,
  bundles: FrozenChapterBundleV1[],
): TerminalResultContextV1 {
  const finalBundle = bundles[6]!;
  const referenceIds = [
    "fact.public.relief",
    "object.relief-ledger.v7.SEALED",
    ...PRESSURE_CHAPTER_SEAT_IDS_V1.flatMap((seatId) => [
      `gain.${seatId}`,
      ...policy.compiledRules.seatVerdictRuleRefs[seatId],
    ]),
  ].sort(compareCanonicalText);
  const references: FrozenResultReferenceV1[] = referenceIds.map((referenceId) => ({
    referenceId,
    kind: referenceId.startsWith("object.")
      ? "OBJECT"
      : referenceId.startsWith("seat.") ? "RULE" : "FACT",
    title: `Fixture ${referenceId}`,
    summary: `Frozen summary for ${referenceId}`,
    sourceRefs: ["fixture.source"],
    visibility: "PUBLIC",
    authorizedSeatIds: [],
    privateOriginSeatId: null,
    sourceStageId: "N7",
    sourceKind: "CHAPTER_SETTLEMENT",
    chapterSettlementId: finalBundle.bundleHash,
    frozenSourceHash: finalBundle.bundleHash,
    sourceDecisionActionIds: [],
    revealEligible: false,
    revealText: null,
  }));
  const catalogWithoutHash = {
    schemaVersion: "frozen_sangtian_result_catalog_v1" as const,
    locale: "zh-CN" as const,
    worldOutcomes: [{
      outcomeId: "BALANCED_SURVIVAL",
      sourceRuleRef: "world.03.balanced_survival",
      title: "Balanced survival",
      verdictLine: "All five tracks survived.",
      summary: "One frozen shared-world ending.",
    }],
    tracks: TRACK_IDS_V1.map((trackId) => ({
      trackId,
      label: `Track ${trackId}`,
      summaries: { LOW: `${trackId} low`, MID: `${trackId} mid`, HIGH: `${trackId} high` },
    })),
    seats: PRESSURE_CHAPTER_SEAT_IDS_V1.map((seatId) => ({
      seatId,
      roleKey: `role.${seatId}`,
      roleName: `Role ${seatId}`,
      verdictLabels: { WIN: "Win", COSTLY_WIN: "Costly win", LOSS: "Loss" },
    })),
    references,
    replayHint: "Replay with different formal actions.",
  };
  const catalog = { ...catalogWithoutHash, catalogHash: sha256Canonical(catalogWithoutHash) };
  const withoutHash = {
    schemaVersion: "terminal_result_context_v1" as const,
    roomId: "room-terminal-persistence",
    runId: RUN_ID,
    worldId: "sangtian" as const,
    participantMode: "MULTIPLAYER" as const,
    completedAt: DECIDED_AT,
    frozenRoute: structuredClone(route.snapshot.route),
    frozenRouteHash: route.snapshot.routeHash,
    resultContractRegistryVersion: route.snapshot.resultContractRegistryVersion,
    payloadSchemaVersion: "sangtian_pressure_result_v1" as const,
    presentationSchemaVersion: "sangtian_pressure_result_v1" as const,
    rendererKey: "sangtian_pressure_endgame_v1" as const,
    contentPackageVersion: policy.contentPackageVersion,
    contentPackageSha256: policy.contentPackageSha256,
    narrativeProfileVersion: route.snapshot.narrativeProfileVersion,
    catalog,
  };
  return { ...withoutHash, contextHash: sha256Canonical(withoutHash) };
}

function withHash<T extends Record<string, unknown>, K extends string>(
  value: T,
  field: K,
): T & Record<K, string> {
  return { ...value, [field]: sha256Canonical(value) } as T & Record<K, string>;
}
