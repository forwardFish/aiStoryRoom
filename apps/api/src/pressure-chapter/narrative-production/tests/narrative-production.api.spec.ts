import assert from "node:assert/strict";
import test from "node:test";
import {
  PRESSURE_CHAPTER_SEAT_IDS_V1,
  computeFinaleExecutionFingerprint,
  computeFinaleSemanticOutcomeHash,
  sha256Canonical,
  validateOpenNovelNarrativeArtifactV1,
  type AuthoritativePressureResultSnapshotV1,
  type OpenNovelNarrativeArtifactV1,
  type OpenNovelNarrativeProjectionJobV1,
  type SangtianPressureFinaleDecisionV1,
} from "@ai-story/shared";
import type { PrismaService } from "../../../prisma.service";
import type {
  AuthoritativeNarrativeSourceReaderPortV1,
  NarrativeOutboxClaimV1,
  NarrativeOutboxPortV1,
} from "../../narrative";
import { PressureNarrativeAudienceProjectorV1 } from "../../narrative";
import {
  SangtianAuthoritativeNarrativeSnapshotCompilerV1,
} from "../../narrative-authority/compiler";
import { pressureResultSourceFixture } from "../../result/result-test-fixtures";
import {
  computeAuthorityCommitHashV1,
  validateAuthorityFirstTerminalRecordV1,
  type AuthorityFirstTerminalRecordV1,
} from "../../terminal-commit";
import type {
  NarrativeArtifactV1,
} from "../../../../../openovel-runtime/src/pressure-narrative/contracts";
import type {
  NarrativeArtifactPublisherPortV1,
  NarrativeProjectionClaimRequestV1,
  NarrativeProjectionClaimV1,
  NarrativeProjectionStatePortV1,
  NarrativeProjectionTransitionV1,
} from "../../../../../openovel-runtime/src/pressure-narrative/ports";
import {
  PRESSURE_NARRATIVE_PRODUCTION_CAPABILITY_MANIFEST_V1,
  createPressureNarrativeProductionExecutionV1,
  createPrismaPressureNarrativeProductBundleV1,
  createPrismaPressureNarrativeProductionExecutionV1,
} from "../composition";
import {
  PRESSURE_NARRATIVE_PRODUCTION_ERROR_CODES,
  PressureNarrativeProductionError,
} from "../errors";
import {
  FinaleAuthoritativeNarrativeSnapshotCompilerV1,
} from "../finale-authority-compiler";
import {
  InProcessPressureNarrativeOutboxSignalV1,
  PressureNarrativeInProcessWorkerV1,
} from "../outbox-signal";
import {
  PublishedPressureNarrativeProfileResolverV1,
} from "../published-profile-resolver";
import {
  PressureNarrativeProviderBoundaryV1,
  validateProviderContextV1,
} from "../provider-boundary";
import {
  deployedOpenNovelPressureNarrativeRuntimeLoaderV1,
  staticOpenNovelPressureNarrativeRuntimeLoaderV1,
  validateOpenNovelPressureNarrativeRuntimeModuleV1,
} from "../runtime-module";

const HASH = (value: string) => sha256Canonical({ value });
const RUN_ID = "run-pressure-narrative-production";
const VIEWER_SEAT = "cabinet_finance" as const;
const OTHER_SEAT = "jiangnan_merchant" as const;

test("published resolver verifies the release and selects explicit fallback mode", async () => {
  const fallback = new PublishedPressureNarrativeProfileResolverV1({
    providerConfigured: false,
  });
  const fallbackProfile = await fallback.resolve(fallback.profileVersion);
  assert.ok(fallbackProfile);
  assert.equal(fallbackProfile.providerEnabled, false);
  assert.equal(fallbackProfile.maxProviderAttempts, 1);
  assert.deepEqual(fallbackProfile.retryBackoffMs, []);
  assert.equal(await fallback.resolve("unknown-profile"), null);

  const provider = new PublishedPressureNarrativeProfileResolverV1({
    providerConfigured: true,
  });
  const providerProfile = await provider.resolve(provider.profileVersion);
  assert.ok(providerProfile);
  assert.equal(providerProfile.providerEnabled, true);
  assert.equal(providerProfile.maxProviderAttempts, 3);
  assert.deepEqual(providerProfile.retryBackoffMs, [1_000, 5_000]);
  assert.equal(provider.projectorVersion, fallback.projectorVersion);
});

test("provider boundary rejects raw authority and a tampered context hash", async () => {
  let calls = 0;
  const boundary = new PressureNarrativeProviderBoundaryV1({
    async render() {
      calls += 1;
      return {};
    },
  });
  const context = providerContextFixture();
  assert.deepEqual(await boundary.render(context), {});
  assert.equal(calls, 1);

  assert.throws(
    () => validateProviderContextV1({ ...context, rawAuthority: {} }),
    (error: unknown) => error instanceof PressureNarrativeProductionError
      && error.code === PRESSURE_NARRATIVE_PRODUCTION_ERROR_CODES.PROVIDER_BOUNDARY_VIOLATION,
  );
  assert.throws(
    () => validateProviderContextV1({ ...context, contextHash: HASH("tampered") }),
    (error: unknown) => error instanceof PressureNarrativeProductionError
      && error.path === "providerContext.contextHash",
  );
});

test("API consumer filters audience before deterministic OpenNovel fallback and acknowledges", async () => {
  const runtime = await runtimeModule();
  const job = jobFixture();
  const outbox = new SingleJobOutbox(job);
  const persistence = new DurableNarrativeProjectionDouble();
  const authority: AuthoritativeNarrativeSourceReaderPortV1 = {
    async readCommitted() { return rawAuthorityFixture(job); },
  };
  const clock = new MutableClock(10_000);
  const execution = await createPressureNarrativeProductionExecutionV1({
    outbox,
    authority,
    projectionPersistence: persistence,
    runtimeLoader: staticOpenNovelPressureNarrativeRuntimeLoaderV1(runtime),
    clock,
  });

  const result = await execution.consumer.consumeNext("worker-fallback");
  assert.deepEqual(result, {
    kind: "ACKNOWLEDGED",
    outboxId: "outbox-1",
    status: "FALLBACK_PUBLISHED",
  });
  assert.equal(execution.providerMode, "DETERMINISTIC_FALLBACK_ONLY");
  assert.deepEqual(outbox.acknowledged, { outboxId: "outbox-1", fence: 1 });
  assert.equal(persistence.artifact?.renderMode, "AUTHORED_FALLBACK");
  assert.equal(persistence.artifact?.status, "FALLBACK_PUBLISHED");
  assert.match(persistence.artifact?.text ?? "", /Public fact/);
  assert.match(persistence.artifact?.text ?? "", /Viewer fact/);
  assert.doesNotMatch(persistence.artifact?.text ?? "", /Other-seat secret/);
});

test("production consumer publishes Genesis, Beat, Chapter, and Finale sources through one runtime", async () => {
  const runtime = await runtimeModule();
  const kinds = [
    "GENESIS_NARRATIVE",
    "BEAT_NARRATIVE",
    "CHAPTER_NARRATIVE",
    "FINALE_NARRATIVE",
  ] as const;

  for (const kind of kinds) {
    const job = jobForProjectionKind(kind);
    const outbox = new SingleJobOutbox(job);
    const persistence = new DurableNarrativeProjectionDouble();
    const execution = await createPressureNarrativeProductionExecutionV1({
      outbox,
      authority: {
        async readCommitted(claimedJob) {
          assert.equal(claimedJob.projectionKind, kind);
          return rawAuthorityForProjectionKind(claimedJob);
        },
      },
      projectionPersistence: persistence,
      runtimeLoader: staticOpenNovelPressureNarrativeRuntimeLoaderV1(runtime),
      clock: new MutableClock(15_000),
    });

    const result = await execution.consumer.consumeNext(`worker-${kind.toLowerCase()}`);
    assert.deepEqual(result, {
      kind: "ACKNOWLEDGED",
      outboxId: "outbox-1",
      status: "FALLBACK_PUBLISHED",
    });
    assert.equal(persistence.artifact?.projectionKind, kind);
    assert.equal(persistence.artifact?.sourceCommitHash, job.sourceCommitHash);
    assert.equal(persistence.artifact?.status, "FALLBACK_PUBLISHED");
    assert.equal(persistence.artifact?.renderMode, "AUTHORED_FALLBACK");
  }
});

test("configured Provider receives only compiled audience-safe context", async () => {
  const runtime = await runtimeModule();
  const job = jobForProjectionKind("BEAT_NARRATIVE");
  const outbox = new SingleJobOutbox(job);
  const persistence = new DurableNarrativeProjectionDouble();
  let captured: unknown = null;
  const provider = {
    async render(context: ReturnType<typeof providerContextFixture>) {
      captured = structuredClone(context);
      const claims = context.allowedClaims.map(({ kind, refId, statement }) => ({
        kind,
        refId,
        statement,
      }));
      return {
        text: claims.map((claim) => claim.statement).join(" "),
        usedFactRefs: claims
          .filter((claim) => claim.kind === "FACT")
          .map((claim) => claim.refId)
          .sort(),
        claims,
      };
    },
  };
  const execution = await createPressureNarrativeProductionExecutionV1({
    outbox,
    authority: { async readCommitted() { return rawAuthorityForProjectionKind(job); } },
    projectionPersistence: persistence,
    runtimeLoader: staticOpenNovelPressureNarrativeRuntimeLoaderV1(runtime),
    provider,
    clock: new MutableClock(20_000),
  });

  const result = await execution.consumer.consumeNext("worker-provider");
  assert.equal(result.kind, "ACKNOWLEDGED");
  assert.equal(execution.providerMode, "EXTERNAL_PROVIDER");
  assert.equal(persistence.artifact?.status, "PUBLISHED");
  const serialized = JSON.stringify(captured);
  assert.match(serialized, /fact\.viewer/);
  assert.doesNotMatch(serialized, /fact\.zz_other/);
  assert.doesNotMatch(serialized, /Other-seat secret/);
  assert.doesNotMatch(serialized, /authorizedSeatIds|seatVariants|visibility/);
});

test("publisher crash resumes pending artifact without a second Provider call", async () => {
  const runtime = await runtimeModule();
  const job = jobForProjectionKind("BEAT_NARRATIVE");
  const persistence = new DurableNarrativeProjectionDouble();
  persistence.failAfterFirstArtifactStage = true;
  const clock = new MutableClock(30_000);
  let providerCalls = 0;
  const execution = await createPressureNarrativeProductionExecutionV1({
    outbox: new SingleJobOutbox(job),
    authority: { async readCommitted() { return rawAuthorityFixture(job); } },
    projectionPersistence: persistence,
    runtimeLoader: staticOpenNovelPressureNarrativeRuntimeLoaderV1(runtime),
    provider: {
      async render(context) {
        providerCalls += 1;
        const claims = context.allowedClaims.map(({ kind, refId, statement }) => ({
          kind, refId, statement,
        }));
        return {
          text: claims.map((claim) => claim.statement).join(" "),
          usedFactRefs: claims.filter((claim) => claim.kind === "FACT")
            .map((claim) => claim.refId).sort(),
          claims,
        };
      },
    },
    clock,
  });
  const safe = audienceSafeSourceFixture(job);

  const first = await execution.projector.project({
    job,
    audienceSafeSource: safe,
    workerId: "worker-crash-1",
  }) as { status: string; retryAtMs: number | null; artifact: unknown };
  assert.equal(first.status, "FAILED_RETRYABLE");
  assert.equal(first.artifact, null);
  assert.equal(providerCalls, 1);
  assert.ok(first.retryAtMs);

  clock.value = first.retryAtMs!;
  const second = await execution.projector.project({
    job,
    audienceSafeSource: safe,
    workerId: "worker-crash-2",
  }) as { status: string; artifact: OpenNovelNarrativeArtifactV1 };
  assert.equal(second.status, "PUBLISHED");
  assert.equal(providerCalls, 1, "pending artifact must be delivered, not regenerated");

  const third = await execution.projector.project({
    job,
    audienceSafeSource: safe,
    workerId: "worker-replay",
  }) as { status: string; artifact: OpenNovelNarrativeArtifactV1 };
  assert.equal(third.status, "PUBLISHED");
  assert.equal(providerCalls, 1);
  assert.equal(third.artifact.contentHash, second.artifact.contentHash);
  assert.equal(persistence.logicalKeyClaims.size, 1);
});

test("Prisma production factory uses one narrative state/artifact capability and no authority writer", async () => {
  const runtime = await runtimeModule();
  const execution = await createPrismaPressureNarrativeProductionExecutionV1({
    prisma: {} as PrismaService,
    authoritativeSnapshotCompiler: { compile() { return {}; } },
    runtimeLoader: staticOpenNovelPressureNarrativeRuntimeLoaderV1(runtime),
  });
  assert.equal(execution.projectionState, execution.artifactPublisher);
  assert.equal(execution.providerMode, "DETERMINISTIC_FALLBACK_ONLY");
  assert.deepEqual(PRESSURE_NARRATIVE_PRODUCTION_CAPABILITY_MANIFEST_V1.compiledAuthorities, [
    "GENESIS_FROZEN",
    "CHAPTER_WORKING",
    "CHAPTER_FROZEN",
    "FINALE_FROZEN",
  ]);
  assert.deepEqual(PRESSURE_NARRATIVE_PRODUCTION_CAPABILITY_MANIFEST_V1.failClosedAuthorities, [
    "LEGACY_TERMINAL_COMMITTED",
  ]);
  assert.deepEqual(PRESSURE_NARRATIVE_PRODUCTION_CAPABILITY_MANIFEST_V1.forbidden, [
    "GenesisWriter",
    "WorkingLedgerWriter",
    "ChapterSettlementWriter",
    "FinaleCommitter",
    "ResultAuthorityWriter",
    "RunCompletionWriter",
  ]);
});

test("runtime module binding fails closed when the deployed ESM module is absent", () => {
  assert.throws(
    () => validateOpenNovelPressureNarrativeRuntimeModuleV1({}),
    (error: unknown) => error instanceof PressureNarrativeProductionError
      && error.code === PRESSURE_NARRATIVE_PRODUCTION_ERROR_CODES.RUNTIME_MODULE_UNAVAILABLE,
  );
});

test("finale compiler binds the committed terminal record and filters every other seat", () => {
  const fixture = finaleAuthorityFixture();
  const viewerJob = fixture.record.narrativeOutbox.jobs.find((job) => (
    job.audience.kind === "SEAT" && job.audience.seatId === VIEWER_SEAT
  ))!;
  const compiler = new FinaleAuthoritativeNarrativeSnapshotCompilerV1();
  const source = compiler.compile(viewerJob, fixture.row);
  const safe = new PressureNarrativeAudienceProjectorV1().project(
    viewerJob,
    source,
  ) as {
    facts: Array<{ factId: string }>;
    knowledge: Array<{ knowledgeId: string }>;
    allowedClaims: Array<{ kind: string; refId: string }>;
    variant: { viewerVerdictRef: string | null };
  };

  assert.deepEqual(safe.facts.map((fact) => fact.factId), [
    "fact.public",
    `fact.${VIEWER_SEAT}`,
  ].sort());
  assert.deepEqual(safe.knowledge.map((entry) => entry.knowledgeId), [
    `secret.${VIEWER_SEAT}`,
  ]);
  assert.equal(
    safe.allowedClaims.filter((claim) => claim.kind === "VERDICT").length,
    1,
  );
  assert.equal(
    safe.allowedClaims.some((claim) => claim.refId.includes(OTHER_SEAT)),
    false,
  );
  assert.ok(safe.variant.viewerVerdictRef?.includes(VIEWER_SEAT));
  assert.doesNotMatch(JSON.stringify(safe), new RegExp(`secret\\.${OTHER_SEAT}`));

  assert.throws(
    () => compiler.compile(viewerJob, { ...fixture.row, commitHash: HASH("tampered") }),
    (error: unknown) => error instanceof PressureNarrativeProductionError
      && error.code === PRESSURE_NARRATIVE_PRODUCTION_ERROR_CODES.AUTHORITY_COMPILATION_INVALID,
  );
  assert.throws(
    () => compiler.compile(jobFixture(), {}),
    (error: unknown) => error instanceof PressureNarrativeProductionError
      && error.code === PRESSURE_NARRATIVE_PRODUCTION_ERROR_CODES.AUTHORITY_COMPILATION_UNSUPPORTED,
  );
});

test("ProductRoot bundle internalizes all four narrative capabilities", async () => {
  const runtime = await runtimeModule();
  const prisma = {
    async $transaction() { throw new Error("not called during composition"); },
  } as unknown as PrismaService;
  const bundle = await createPrismaPressureNarrativeProductBundleV1({
    prisma,
    runtimeLoader: staticOpenNovelPressureNarrativeRuntimeLoaderV1(runtime),
    startWorker: false,
  });
  assert.equal(bundle.narrativeProjectorVersion, bundle.execution.projectorVersion);
  assert.equal(bundle.openNovelNarrativeProjector, bundle.execution.projector);
  assert.ok(bundle.narrativeSnapshotCompiler instanceof SangtianAuthoritativeNarrativeSnapshotCompilerV1);
  assert.ok(bundle.narrativeOutboxSignal instanceof InProcessPressureNarrativeOutboxSignalV1);
  assert.equal(bundle.providerMode, "DETERMINISTIC_FALLBACK_ONLY");
  bundle.worker.stop();
});

test("post-commit signal is best-effort and startup replays the durable outbox", async () => {
  const runtime = await runtimeModule();
  const job = jobFixture();
  const outbox = new SingleJobOutbox(job);
  const clock = new MutableClock(50_000);
  const execution = await createPressureNarrativeProductionExecutionV1({
    outbox,
    authority: { async readCommitted() { return rawAuthorityFixture(job); } },
    projectionPersistence: new DurableNarrativeProjectionDouble(),
    runtimeLoader: staticOpenNovelPressureNarrativeRuntimeLoaderV1(runtime),
    clock,
  });
  const worker = new PressureNarrativeInProcessWorkerV1(
    execution.consumer,
    clock,
    { workerId: "worker-startup-replay" },
  );
  const signal = new InProcessPressureNarrativeOutboxSignalV1(worker);
  const authorityCommitHash = HASH("signal-authority");

  await signal.notifyCommitted({
    runId: RUN_ID,
    authorityCommitHash,
    outboxDedupeKey: `finale_narrative:${RUN_ID}:${authorityCommitHash}`,
    outboxHash: HASH("signal-outbox"),
  });
  assert.equal(outbox.acknowledged, null, "a stopped process cannot consume the wake-up");

  worker.start();
  await eventually(() => outbox.acknowledged !== null);
  assert.deepEqual(outbox.acknowledged, { outboxId: "outbox-1", fence: 1 });
  worker.stop();

  await assert.rejects(
    signal.notifyCommitted({
      runId: RUN_ID,
      authorityCommitHash,
      outboxDedupeKey: "wrong-dedupe-key",
      outboxHash: HASH("signal-outbox"),
    }),
    (error: unknown) => error instanceof PressureNarrativeProductionError
      && error.code === PRESSURE_NARRATIVE_PRODUCTION_ERROR_CODES.OUTBOX_SIGNAL_INVALID,
  );
});

test("repository dev loader crosses the CommonJS-to-ESM seam without require", async () => {
  const loader = deployedOpenNovelPressureNarrativeRuntimeLoaderV1({
    allowTypeScriptSource: true,
  });
  const runtime = validateOpenNovelPressureNarrativeRuntimeModuleV1(
    await loader.load(),
  );
  assert.equal(typeof runtime.OpenNovelNarrativeProjectorV1, "function");
});

class MutableClock {
  constructor(public value: number) {}
  nowMs() { return this.value; }
}

class SingleJobOutbox implements NarrativeOutboxPortV1 {
  private claimed = false;
  acknowledged: { outboxId: string; fence: number } | null = null;

  constructor(private readonly job: OpenNovelNarrativeProjectionJobV1) {}

  async claimNext(): Promise<NarrativeOutboxClaimV1> {
    if (this.claimed) return { kind: "EMPTY" };
    this.claimed = true;
    return {
      kind: "CLAIMED",
      outboxId: "outbox-1",
      fence: 1,
      attemptCount: 0,
      maxAttempts: 5,
      job: structuredClone(this.job),
    };
  }

  async acknowledge(request: { outboxId: string; fence: number }) {
    this.acknowledged = { ...request };
  }
  async retry() { throw new Error("unexpected retry"); }
  async deadLetter() { throw new Error("unexpected dead letter"); }
}

class DurableNarrativeProjectionDouble
implements NarrativeProjectionStatePortV1, NarrativeArtifactPublisherPortV1 {
  readonly logicalKeyClaims = new Set<string>();
  artifact: NarrativeArtifactV1 | null = null;
  failAfterFirstArtifactStage = false;
  private requestFingerprint: string | null = null;
  private logicalProjectionKey: string | null = null;
  private jobId: string | null = null;
  private fence = 0;
  private providerAttemptCount = 0;
  private deliveryFailureCount = 0;
  private pendingArtifact: NarrativeArtifactV1 | null = null;
  private nextAttemptAtMs: number | null = null;
  private published = false;

  async claim(request: NarrativeProjectionClaimRequestV1):
  Promise<NarrativeProjectionClaimV1> {
    this.logicalKeyClaims.add(request.logicalProjectionKey);
    if (this.requestFingerprint !== null
      && this.requestFingerprint !== request.requestFingerprint) {
      return { kind: "DEAD_LETTERED", reasonCode: "SOURCE_BINDING_MISMATCH" };
    }
    this.requestFingerprint = request.requestFingerprint;
    this.logicalProjectionKey = request.logicalProjectionKey;
    this.jobId = request.jobId;
    if (this.published && this.artifact) {
      return {
        kind: "ALREADY_PUBLISHED",
        projectionId: "projection-1",
        requestFingerprint: request.requestFingerprint,
        artifact: structuredClone(this.artifact),
      };
    }
    if (this.nextAttemptAtMs !== null && request.nowMs < this.nextAttemptAtMs) {
      return { kind: "BUSY", retryAtMs: this.nextAttemptAtMs };
    }
    this.fence += 1;
    return {
      kind: "CLAIMED",
      projectionId: "projection-1",
      fence: this.fence,
      requestFingerprint: request.requestFingerprint,
      providerAttemptCount: this.providerAttemptCount,
      deliveryFailureCount: this.deliveryFailureCount,
      pendingArtifact: structuredClone(this.pendingArtifact),
    };
  }

  async transition(request: NarrativeProjectionTransitionV1): Promise<void> {
    this.assertFence(request.projectionId, request.fence);
    this.providerAttemptCount = request.providerAttemptCount;
    this.deliveryFailureCount = request.deliveryFailureCount;
    this.pendingArtifact = structuredClone(request.pendingArtifact);
    this.nextAttemptAtMs = request.nextAttemptAtMs;
  }

  async publish(request: {
    logicalProjectionKey: string;
    requestFingerprint: string;
    projectionId: string;
    fence: number;
    artifact: NarrativeArtifactV1;
  }): Promise<NarrativeArtifactV1> {
    this.assertFence(request.projectionId, request.fence);
    assert.equal(request.logicalProjectionKey, this.logicalProjectionKey);
    assert.equal(request.requestFingerprint, this.requestFingerprint);
    assert.equal(request.artifact.jobId, this.jobId);
    const candidate = structuredClone(request.artifact);
    if (this.artifact) {
      assert.equal(sha256Canonical(this.artifact), sha256Canonical(candidate));
    } else {
      this.artifact = candidate;
    }
    if (this.failAfterFirstArtifactStage) {
      this.failAfterFirstArtifactStage = false;
      throw new Error("SIMULATED_CRASH_AFTER_ARTIFACT_STAGE");
    }
    return structuredClone(this.artifact);
  }

  async markPublished(request: {
    projectionId: string;
    fence: number;
    status: "PUBLISHED" | "FALLBACK_PUBLISHED";
    artifact: NarrativeArtifactV1;
  }): Promise<void> {
    this.assertFence(request.projectionId, request.fence);
    assert.equal(request.status, request.artifact.status);
    assert.equal(sha256Canonical(request.artifact), sha256Canonical(this.artifact));
    this.pendingArtifact = null;
    this.nextAttemptAtMs = null;
    this.published = true;
  }

  async deadLetter(request: {
    projectionId: string;
    fence: number;
  }): Promise<void> {
    this.assertFence(request.projectionId, request.fence);
    throw new Error("unexpected projection dead letter");
  }

  private assertFence(projectionId: string, fence: number): void {
    assert.equal(projectionId, "projection-1");
    assert.equal(fence, this.fence, "stale projection fence");
  }
}

function jobFixture(): OpenNovelNarrativeProjectionJobV1 {
  return {
    schemaVersion: "openovel_narrative_projection_job_v1",
    jobId: "job-narrative-production-1",
    runId: RUN_ID,
    audience: { kind: "SEAT", seatId: VIEWER_SEAT },
    sourceRuntimeProfile: "SANGTIAN_CONTINUOUS_CHAPTER_V1",
    projectionKind: "CHAPTER_NARRATIVE",
    sourceAuthority: "CHAPTER_FROZEN",
    sourceId: "bundle-N1",
    sourceCommitHash: HASH("commit"),
    sourceContentHash: HASH("content"),
    allowedFactIds: ["fact.public", "fact.viewer"],
    allowedObjectVersionIds: [],
    allowedKnowledgeIds: [],
    narrativeProfileVersion: "openovel-pressure-1.0.0",
    idempotencyKey: "narrative-production:N1:cabinet_finance",
  };
}

function jobForProjectionKind(
  projectionKind: OpenNovelNarrativeProjectionJobV1["projectionKind"],
): OpenNovelNarrativeProjectionJobV1 {
  const binding = {
    GENESIS_NARRATIVE: {
      sourceAuthority: "GENESIS_FROZEN" as const,
      sourceId: HASH("genesis-source"),
    },
    BEAT_NARRATIVE: {
      sourceAuthority: "CHAPTER_WORKING" as const,
      sourceId: HASH("beat-source"),
    },
    CHAPTER_NARRATIVE: {
      sourceAuthority: "CHAPTER_FROZEN" as const,
      sourceId: HASH("chapter-source"),
    },
    FINALE_NARRATIVE: {
      sourceAuthority: "FINALE_FROZEN" as const,
      sourceId: HASH("finale-source"),
    },
  }[projectionKind];
  return {
    schemaVersion: "openovel_narrative_projection_job_v1",
    jobId: `job-production-${projectionKind.toLowerCase()}`,
    runId: RUN_ID,
    audience: { kind: "SEAT", seatId: VIEWER_SEAT },
    sourceRuntimeProfile: "SANGTIAN_CONTINUOUS_CHAPTER_V1",
    projectionKind,
    sourceAuthority: binding.sourceAuthority,
    sourceId: binding.sourceId,
    sourceCommitHash: HASH(`${projectionKind}:commit`),
    sourceContentHash: HASH(`${projectionKind}:content`),
    allowedFactIds: ["fact.public", "fact.viewer"],
    allowedObjectVersionIds: [],
    allowedKnowledgeIds: [],
    narrativeProfileVersion: "openovel-pressure-1.0.0",
    idempotencyKey: `production:${projectionKind}:${VIEWER_SEAT}`,
  };
}

function rawAuthorityForProjectionKind(job: OpenNovelNarrativeProjectionJobV1) {
  const variant = job.projectionKind === "GENESIS_NARRATIVE"
    ? { kind: "GENESIS" as const, stageId: "P0" as const, openingHook: "The opening authority is committed." }
    : job.projectionKind === "BEAT_NARRATIVE"
      ? {
        kind: "BEAT" as const,
        chapterId: "N1" as const,
        workingRevision: 1,
        temporalBoundary: "WORKING_NOT_FROZEN" as const,
      }
      : job.projectionKind === "CHAPTER_NARRATIVE"
        ? {
          kind: "CHAPTER" as const,
          chapterId: "N1" as const,
          committedWorldSequence: 1,
          nextChapterId: "N2" as const,
        }
        : {
          kind: "FINALE" as const,
          terminalKind: "PRESSURE_FINALE" as const,
          worldOutcomeRef: "outcome.world",
          viewerVerdictRef: "verdict.viewer",
        };
  const claims = [
    visibleClaim("fact.public", "Public fact", "PUBLIC", []),
    visibleClaim("fact.viewer", "Viewer fact", "AUTHORIZED", [VIEWER_SEAT]),
    ...(job.projectionKind === "FINALE_NARRATIVE" ? [{
      kind: "OUTCOME",
      refId: "outcome.world",
      statement: "The committed world outcome.",
      required: true,
      visibility: "PUBLIC",
      authorizedSeatIds: [],
    }, {
      kind: "VERDICT",
      refId: "verdict.viewer",
      statement: "The viewer's committed verdict.",
      required: true,
      visibility: "AUTHORIZED",
      authorizedSeatIds: [VIEWER_SEAT],
    }] : []),
  ];
  return {
    schemaVersion: "authoritative_narrative_source_snapshot_v1",
    runId: job.runId,
    projectionKind: job.projectionKind,
    sourceAuthority: job.sourceAuthority,
    sourceId: job.sourceId,
    sourceCommitHash: job.sourceCommitHash,
    sourceContentHash: job.sourceContentHash,
    facts: [
      visibleFact("fact.public", "Public fact", "PUBLIC", []),
      visibleFact("fact.viewer", "Viewer fact", "AUTHORIZED", [VIEWER_SEAT]),
      visibleFact("fact.zz_other", "Other-seat secret", "AUTHORIZED", [OTHER_SEAT]),
    ],
    objects: [],
    knowledge: [],
    claims,
    publicVariant: variant,
    seatVariants: [
      { seatId: VIEWER_SEAT, variant },
      { seatId: OTHER_SEAT, variant },
    ],
  };
}

function rawAuthorityFixture(job: OpenNovelNarrativeProjectionJobV1) {
  const variant = {
    kind: "CHAPTER" as const,
    chapterId: "N1" as const,
    committedWorldSequence: 1,
    nextChapterId: "N2" as const,
  };
  return {
    schemaVersion: "authoritative_narrative_source_snapshot_v1",
    runId: job.runId,
    projectionKind: job.projectionKind,
    sourceAuthority: job.sourceAuthority,
    sourceId: job.sourceId,
    sourceCommitHash: job.sourceCommitHash,
    sourceContentHash: job.sourceContentHash,
    facts: [
      visibleFact("fact.public", "Public fact", "PUBLIC", []),
      visibleFact("fact.viewer", "Viewer fact", "AUTHORIZED", [VIEWER_SEAT]),
      visibleFact("fact.zz_other", "Other-seat secret", "AUTHORIZED", [OTHER_SEAT]),
    ],
    objects: [],
    knowledge: [],
    claims: [
      visibleClaim("fact.public", "Public fact", "PUBLIC", []),
      visibleClaim("fact.viewer", "Viewer fact", "AUTHORIZED", [VIEWER_SEAT]),
      visibleClaim("fact.zz_other", "Other-seat secret", "AUTHORIZED", [OTHER_SEAT]),
    ],
    publicVariant: variant,
    seatVariants: [
      { seatId: VIEWER_SEAT, variant },
      { seatId: OTHER_SEAT, variant },
    ],
  };
}

function audienceSafeSourceFixture(job: OpenNovelNarrativeProjectionJobV1) {
  const variant = job.projectionKind === "BEAT_NARRATIVE"
    ? {
      kind: "BEAT" as const,
      chapterId: "N1" as const,
      workingRevision: 1,
      temporalBoundary: "WORKING_NOT_FROZEN" as const,
    }
    : {
      kind: "CHAPTER" as const,
      chapterId: "N1" as const,
      committedWorldSequence: 1,
      nextChapterId: "N2" as const,
    };
  return {
    schemaVersion: "audience_safe_narrative_source_v1",
    projectionKind: job.projectionKind,
    sourceAuthority: job.sourceAuthority,
    sourceId: job.sourceId,
    sourceCommitHash: job.sourceCommitHash,
    sourceContentHash: job.sourceContentHash,
    audience: structuredClone(job.audience),
    facts: [
      { factId: "fact.public", text: "Public fact", temporalStatus: "FROZEN" },
      { factId: "fact.viewer", text: "Viewer fact", temporalStatus: "FROZEN" },
    ],
    objects: [],
    knowledge: [],
    allowedClaims: [
      { kind: "FACT", refId: "fact.public", statement: "Public fact", required: true },
      { kind: "FACT", refId: "fact.viewer", statement: "Viewer fact", required: true },
    ],
    variant,
  };
}

function providerContextFixture() {
  const content = {
    schemaVersion: "pressure_narrative_context_v1" as const,
    contextCompilerVersion: "openovel-pressure-context-compiler-1.0.0",
    projectionKind: "CHAPTER_NARRATIVE" as const,
    audience: { kind: "SEAT" as const, seatId: VIEWER_SEAT },
    sourceId: "bundle-N1",
    sourceCommitHash: HASH("commit"),
    sourceContentHash: HASH("content"),
    temporalInstruction: "Describe frozen facts only.",
    facts: [
      { factId: "fact.public", text: "Public fact", temporalStatus: "FROZEN" as const },
    ],
    objects: [],
    knowledge: [],
    allowedClaims: [
      { kind: "FACT" as const, refId: "fact.public", statement: "Public fact", required: true },
    ],
    variant: {
      kind: "CHAPTER" as const,
      chapterId: "N1" as const,
      committedWorldSequence: 1,
      nextChapterId: "N2" as const,
    },
  };
  return { ...content, contextHash: sha256Canonical(content) };
}

function visibleFact(
  factId: string,
  text: string,
  visibility: "PUBLIC" | "AUTHORIZED",
  authorizedSeatIds: Array<typeof VIEWER_SEAT | typeof OTHER_SEAT>,
) {
  return {
    factId,
    text,
    temporalStatus: "FROZEN",
    visibility,
    authorizedSeatIds,
  };
}

function visibleClaim(
  refId: string,
  statement: string,
  visibility: "PUBLIC" | "AUTHORIZED",
  authorizedSeatIds: Array<typeof VIEWER_SEAT | typeof OTHER_SEAT>,
) {
  return {
    kind: "FACT",
    refId,
    statement,
    required: true,
    visibility,
    authorizedSeatIds,
  };
}

function finaleAuthorityFixture(): {
  record: AuthorityFirstTerminalRecordV1;
  row: Record<string, unknown>;
} {
  const baseResult = pressureResultSourceFixture();
  const decisionBase = {
    schemaVersion: "sangtian_pressure_finale_decision_v1" as const,
    runId: baseResult.runId,
    runtimeProfile: "SANGTIAN_CONTINUOUS_CHAPTER_V1" as const,
    policyVersion: "sangtian_content_finale_v1",
    packageSha256: baseResult.contentPackageSha256,
    routeHash: baseResult.frozenRouteHash,
    genesisHash: HASH("finale-genesis"),
    frozenChapterBundleHashes: Array.from(
      { length: 7 },
      (_, index) => HASH(`finale-bundle-${index + 1}`),
    ),
    worldOutcome: {
      outcomeId: baseResult.worldOutcome.outcomeId,
      titleKey: "world.title",
      verdictLineKey: "world.verdict",
    },
    tracks: baseResult.tracks.map((track) => ({
      trackId: track.trackId,
      level: track.level,
      evidenceRefs: [...track.evidenceRefs],
    })),
    seats: baseResult.seatOutcomes.map((seat) => ({
      seatId: seat.seatId,
      verdict: seat.verdict,
      gainRefs: [`fact.${seat.seatId}`],
      lossRefs: [] as string[],
      causeRefs: [`fact.${seat.seatId}`],
    })),
    objectOutcomeRefs: [] as string[],
    evidenceAndResponsibilityRefs: ["fact.public"],
  };
  const semanticOutcomeHash = computeFinaleSemanticOutcomeHash(decisionBase);
  const decisionWithSemantic = { ...decisionBase, semanticOutcomeHash };
  const decision: SangtianPressureFinaleDecisionV1 = {
    ...decisionWithSemantic,
    executionFingerprint: computeFinaleExecutionFingerprint(decisionWithSemantic),
    decidedAt: baseResult.completedAt,
  };
  const inputHash = HASH("finale-input");
  const policyHash = HASH("finale-policy");
  const requestFingerprint = HASH("finale-request");
  const authorityCommitHash = computeAuthorityCommitHashV1({
    runId: decision.runId,
    inputHash,
    policyHash,
    decisionHash: decision.semanticOutcomeHash,
    executionFingerprint: decision.executionFingerprint,
  });
  const resultArtifact = rebindResultArtifact(
    baseResult,
    authorityCommitHash,
    decision.semanticOutcomeHash,
  );
  const jobs = [
    finaleJob(decision, authorityCommitHash, null),
    ...PRESSURE_CHAPTER_SEAT_IDS_V1.map((seatId) => (
      finaleJob(decision, authorityCommitHash, seatId)
    )),
  ];
  const outboxWithoutHash = {
    schemaVersion: "sangtian_finale_narrative_outbox_v1" as const,
    runId: decision.runId,
    dedupeKey: `finale_narrative:${decision.runId}:${authorityCommitHash}`,
    sourceCommitHash: authorityCommitHash,
    sourceDecisionHash: decision.semanticOutcomeHash,
    status: "PENDING" as const,
    jobs,
  };
  const recordWithoutHash = {
    schemaVersion: "authority_first_terminal_record_v1" as const,
    runId: decision.runId,
    idempotencyKey: `terminal:${decision.runId}`,
    requestFingerprint,
    inputHash,
    policyHash,
    decision,
    seatOutcomes: structuredClone(decision.seats),
    resultArtifact,
    narrativeOutbox: {
      ...outboxWithoutHash,
      outboxHash: sha256Canonical(outboxWithoutHash),
    },
    authorityCommitHash,
  };
  const record = validateAuthorityFirstTerminalRecordV1({
    ...recordWithoutHash,
    atomicRecordHash: sha256Canonical(recordWithoutHash),
  });
  return {
    record,
    row: {
      runId: record.runId,
      commitHash: record.authorityCommitHash,
      commitManifestHash: record.atomicRecordHash,
      executionFingerprint: record.decision.executionFingerprint,
      semanticOutcomeHash: record.decision.semanticOutcomeHash,
      commitManifestJson: structuredClone(record),
    },
  };
}

function finaleJob(
  decision: SangtianPressureFinaleDecisionV1,
  authorityCommitHash: string,
  seatId: (typeof PRESSURE_CHAPTER_SEAT_IDS_V1)[number] | null,
): OpenNovelNarrativeProjectionJobV1 {
  const audienceKey = seatId ?? "public";
  return {
    schemaVersion: "openovel_narrative_projection_job_v1",
    jobId: `finale_narrative_${decision.runId}_${audienceKey}`,
    runId: decision.runId,
    audience: seatId === null
      ? { kind: "PUBLIC", seatId: null }
      : { kind: "SEAT", seatId },
    sourceRuntimeProfile: "SANGTIAN_CONTINUOUS_CHAPTER_V1",
    projectionKind: "FINALE_NARRATIVE",
    sourceAuthority: "FINALE_FROZEN",
    sourceId: decision.executionFingerprint,
    sourceCommitHash: authorityCommitHash,
    sourceContentHash: decision.semanticOutcomeHash,
    allowedFactIds: seatId === null
      ? ["fact.public"]
      : ["fact.public", `fact.${seatId}`].sort(),
    allowedObjectVersionIds: ["object.archive.v1"],
    allowedKnowledgeIds: seatId === null ? [] : [`secret.${seatId}`],
    narrativeProfileVersion: "openovel-pressure-1.0.0",
    idempotencyKey: `finale_narrative:${decision.runId}:${audienceKey}:${authorityCommitHash}`,
  };
}

function rebindResultArtifact(
  source: AuthoritativePressureResultSnapshotV1,
  sourceCommitHash: string,
  decisionHash: string,
): AuthoritativePressureResultSnapshotV1 {
  const clone = structuredClone(source) as AuthoritativePressureResultSnapshotV1;
  const { snapshotHash: _snapshotHash, ...withoutHash } = clone;
  const rebound = {
    ...withoutHash,
    sourceCommitHash,
    decisionHash,
  };
  return {
    ...rebound,
    snapshotHash: sha256Canonical(rebound),
  };
}

async function eventually(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (predicate()) return;
    await new Promise<void>((resolve) => setTimeout(resolve, 2));
  }
  assert.fail("condition did not become true");
}

async function runtimeModule() {
  const module = await import(
    "../../../../../openovel-runtime/src/pressure-narrative/index.js"
  );
  return validateOpenNovelPressureNarrativeRuntimeModuleV1(module);
}
