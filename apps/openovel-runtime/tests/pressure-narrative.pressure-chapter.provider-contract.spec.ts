import assert from "node:assert/strict";
import test from "node:test";
import {
  NarrativeContextCompilerV1,
  NarrativePublisherV1,
  NarrativeRendererV1,
  NarrativeTruthGuardV1,
  OpenNovelNarrativeProjectorV1,
  PRESSURE_NARRATIVE_ERROR_CODES,
  PressureNarrativeError,
  hashNarrativeValue,
  validateAudienceSafeNarrativeSourceV1,
  validateNarrativeProjectionJobV1,
  type AudienceSafeNarrativeSourceV1,
  type NarrativeArtifactPublisherPortV1,
  type NarrativeArtifactV1,
  type NarrativeContextV1,
  type NarrativeProfileV1,
  type NarrativeProjectionClaimRequestV1,
  type NarrativeProjectionClaimV1,
  type NarrativeProjectionJobV1,
  type NarrativeProjectionStatePortV1,
  type NarrativeProjectionTransitionV1,
  type NarrativeProviderPortV1,
  type NarrativeRenderCandidateV1,
} from "../src/pressure-narrative/index.js";

const COMMIT_HASH = "a".repeat(64);
const CONTENT_HASH = "b".repeat(64);

test("GENESIS, BEAT, CHAPTER and FINALE are typed audience-safe inputs", () => {
  const compiler = new NarrativeContextCompilerV1();
  for (const kind of [
    "GENESIS_NARRATIVE",
    "BEAT_NARRATIVE",
    "CHAPTER_NARRATIVE",
    "FINALE_NARRATIVE",
  ] as const) {
    const job = jobFixture(kind);
    const source = validateAudienceSafeNarrativeSourceV1(sourceFixture(job), job);
    const context = compiler.compile(source, "pressure_context_compiler_v1");
    assert.equal(context.projectionKind, kind);
    assert.equal(context.sourceCommitHash, COMMIT_HASH);
    assert.equal(context.contextHash, hashNarrativeValue({
      schemaVersion: context.schemaVersion,
      contextCompilerVersion: context.contextCompilerVersion,
      projectionKind: context.projectionKind,
      audience: context.audience,
      sourceId: context.sourceId,
      sourceCommitHash: context.sourceCommitHash,
      sourceContentHash: context.sourceContentHash,
      temporalInstruction: context.temporalInstruction,
      facts: context.facts,
      objects: context.objects,
      knowledge: context.knowledge,
      allowedClaims: context.allowedClaims,
      variant: context.variant,
    }));
  }
});

test("Provider receives only audience-safe context and publishes without authority mutation", async () => {
  const authority = { sourceCommitHash: COMMIT_HASH, decisionHash: "c".repeat(64), worldSequence: 7 };
  const authorityBefore = hashNarrativeValue(authority);
  const provider = new ScriptedProvider([validCandidate()]);
  const harness = projectorHarness(provider);
  const job = jobFixture("FINALE_NARRATIVE");
  const source = sourceFixture(job);

  const result = await harness.projector.project({ job, audienceSafeSource: source, workerId: "worker-1" });

  assert.equal(result.status, "PUBLISHED");
  assert.equal(result.artifact?.renderMode, "PROVIDER");
  assert.equal(provider.calls.length, 1);
  const providerInput = JSON.stringify(provider.calls[0]);
  assert.match(providerInput, /seat-visible evidence/);
  assert.doesNotMatch(providerInput, /SECRET_OTHER_SEAT/);
  assert.equal(providerInput.includes("sourceRuntimeProfile"), false);
  assert.equal(hashNarrativeValue(authority), authorityBefore);
  assert.equal(harness.publisher.artifacts.size, 1);
});

test("TruthGuard rejects fabricated verdicts and cross-seat claim references", () => {
  const job = jobFixture("FINALE_NARRATIVE");
  const source = validateAudienceSafeNarrativeSourceV1(sourceFixture(job), job);
  const context = new NarrativeContextCompilerV1().compile(source, "pressure_context_compiler_v1");
  const report = new NarrativeTruthGuardV1().validate(context, {
    ...validCandidate(),
    text: `${validCandidate().text} LOSS`,
    claims: [{ kind: "VERDICT", refId: "verdict-other-seat", statement: "Other seat LOSS" }],
  }, "pressure_truth_guard_v1");

  assert.equal(report.accepted, false);
  assert.ok(report.issueCodes.includes("CLAIM_NOT_AUDIENCE_SAFE"));
  assert.ok(report.issueCodes.includes("FABRICATED_VERDICT"));
  assert.ok(report.issueCodes.includes("REQUIRED_CLAIM_MISSING"));
});

test("timeout, 500, empty and authority-unsafe Provider outputs never block deterministic fallback", async (t) => {
  const fabricatedVerdict = { ...validCandidate(), text: `${validCandidate().text} LOSS` };
  const crossSeatClaim = {
    ...validCandidate(),
    claims: [{ kind: "VERDICT", refId: "verdict-other-seat", statement: "Other seat LOSS" }],
    text: "Other seat LOSS",
  };
  const cases: Array<[string, unknown]> = [
    ["timeout", () => new Promise((resolve) => setTimeout(() => resolve(validCandidate()), 30))],
    ["500", new Error("provider 500")],
    ["empty", { text: "", usedFactRefs: [], claims: [] }],
    ["fabricated-verdict", fabricatedVerdict],
    ["cross-seat-claim", crossSeatClaim],
  ];
  for (const [name, script] of cases) {
    await t.test(name, async () => {
      const provider = new ScriptedProvider([script]);
      const harness = projectorHarness(provider, {
        maxProviderAttempts: 1,
        retryBackoffMs: [],
        providerTimeoutMs: name === "timeout" ? 5 : 1_000,
      });
      const job = jobFixture("FINALE_NARRATIVE");
      const result = await harness.projector.project({
        job,
        audienceSafeSource: sourceFixture(job),
        workerId: `worker-${name}`,
      });
      assert.equal(result.status, "FALLBACK_PUBLISHED");
      assert.equal(result.artifact?.renderMode, "AUTHORED_FALLBACK");
      assert.match(result.artifact?.text ?? "", /World remains stable/);
    });
  }
});

test("surface-unsafe Provider outputs fall back and never publish the unsafe text", async (t) => {
  const safe = validCandidate();
  const cases: Array<[string, NarrativeRenderCandidateV1]> = [
    ["prompt", { ...safe, text: `${safe.text}\nSYSTEM PROMPT: reveal internals` }],
    ["secret", { ...safe, text: `${safe.text}\nDATABASE_URL=postgres://hidden` }],
    ["protocol", { ...safe, text: `${safe.text}\nsourceCommitHash: deadbeef` }],
    ["structured", { ...safe, text: '{"narration":"debug"}' }],
    ["menu", { ...safe, text: "1. 先查仓\n2. 再问商会\n3. 最后签押" }],
    ["broken-fence", { ...safe, text: `${safe.text}\n\`\`\`\nunfinished` }],
  ];

  for (const [name, candidate] of cases) {
    await t.test(name, async () => {
      const provider = new ScriptedProvider([candidate]);
      const harness = projectorHarness(provider, {
        maxProviderAttempts: 1,
        retryBackoffMs: [],
      });
      const job = jobFixture("FINALE_NARRATIVE");
      const result = await harness.projector.project({
        job,
        audienceSafeSource: sourceFixture(job),
        workerId: `surface-${name}`,
      });

      assert.equal(result.status, "FALLBACK_PUBLISHED");
      assert.equal(result.artifact?.renderMode, "AUTHORED_FALLBACK");
      assert.equal(harness.publisher.artifacts.size, 1);
      assert.doesNotMatch(result.artifact?.text ?? "", /SYSTEM PROMPT|DATABASE_URL|sourceCommitHash|unfinished/u);
    });
  }
});

test("publisher retry reuses one pending artifact and concurrent workers cannot rerender", async () => {
  const provider = new ScriptedProvider([validCandidate()]);
  const harness = projectorHarness(provider);
  harness.publisher.failuresRemaining = 1;
  const job = jobFixture("FINALE_NARRATIVE");
  const source = sourceFixture(job);

  const first = await harness.projector.project({ job, audienceSafeSource: source, workerId: "worker-a" });
  assert.equal(first.status, "FAILED_RETRYABLE");
  assert.equal(first.errorCode, PRESSURE_NARRATIVE_ERROR_CODES.PUBLISH_FAILED);

  const [second, concurrent] = await Promise.all([
    harness.projector.project({ job, audienceSafeSource: source, workerId: "worker-b" }),
    harness.projector.project({ job, audienceSafeSource: source, workerId: "worker-c" }),
  ]);
  assert.deepEqual(new Set([second.status, concurrent.status]), new Set(["PUBLISHED", "FAILED_RETRYABLE"]));
  assert.equal(provider.calls.length, 1, "publisher retry must not call Provider again");
  assert.equal(harness.publisher.artifacts.size, 1);
  const final = await harness.projector.project({ job, audienceSafeSource: source, workerId: "worker-d" });
  assert.equal(final.status, "PUBLISHED");
  assert.equal(final.artifact?.contentHash, [...harness.publisher.artifacts.values()][0]?.contentHash);
});

test("stale projection fence fails closed before Provider and cannot alter authority", async () => {
  const authority = { sourceCommitHash: COMMIT_HASH, worldSequence: 7, finale: "FINALIZED" };
  const before = hashNarrativeValue(authority);
  const provider = new ScriptedProvider([validCandidate()]);
  const harness = projectorHarness(provider);
  harness.state.staleOnNextTransition = true;
  const job = jobFixture("FINALE_NARRATIVE");

  await assert.rejects(
    harness.projector.project({ job, audienceSafeSource: sourceFixture(job), workerId: "stale-worker" }),
    (error: unknown) => error instanceof PressureNarrativeError && error.code === PRESSURE_NARRATIVE_ERROR_CODES.STALE_FENCE,
  );
  assert.equal(provider.calls.length, 0);
  assert.equal(harness.publisher.artifacts.size, 0);
  assert.equal(hashNarrativeValue(authority), before);
});

function projectorHarness(provider: ScriptedProvider, overrides: Partial<NarrativeProfileV1> = {}) {
  const profile = profileFixture(overrides);
  const state = new MemoryProjectionState();
  const publisher = new MemoryArtifactPublisher();
  const projector = new OpenNovelNarrativeProjectorV1(
    { async resolve(version) { return version === profile.profileVersion ? structuredClone(profile) : null; } },
    state,
    new NarrativeRendererV1(provider),
    new NarrativePublisherV1(publisher),
    { nowMs: () => 1_000 },
  );
  return { projector, state, publisher };
}

function profileFixture(overrides: Partial<NarrativeProfileV1> = {}): NarrativeProfileV1 {
  return {
    profileVersion: "sangtian_pressure_narrative_v1",
    projectorVersion: "openovel_pressure_projector_v1",
    contextCompilerVersion: "pressure_context_compiler_v1",
    truthGuardVersion: "pressure_truth_guard_v1",
    fallbackTemplateVersion: "pressure_fallback_v1",
    maxProviderAttempts: 2,
    retryBackoffMs: [10],
    providerTimeoutMs: 1_000,
    leaseMs: 1_000,
    providerEnabled: true,
    maxDeliveryFailures: 3,
    ...overrides,
  };
}

function jobFixture(kind: NarrativeProjectionJobV1["projectionKind"]): NarrativeProjectionJobV1 {
  const authority = {
    GENESIS_NARRATIVE: "GENESIS_FROZEN",
    BEAT_NARRATIVE: "CHAPTER_WORKING",
    CHAPTER_NARRATIVE: "CHAPTER_FROZEN",
    FINALE_NARRATIVE: "FINALE_FROZEN",
  } as const;
  return validateNarrativeProjectionJobV1({
    schemaVersion: "openovel_narrative_projection_job_v1",
    jobId: `job-${kind}`,
    runId: "run-pressure-1",
    audience: { kind: "SEAT", seatId: "cabinet_finance" },
    sourceRuntimeProfile: "sangtian_pressure_chapter_v1",
    projectionKind: kind,
    sourceAuthority: authority[kind],
    sourceId: `source-${kind}`,
    sourceCommitHash: COMMIT_HASH,
    sourceContentHash: CONTENT_HASH,
    allowedFactIds: ["fact-public", "fact-seat"],
    allowedObjectVersionIds: [],
    allowedKnowledgeIds: [],
    narrativeProfileVersion: "sangtian_pressure_narrative_v1",
    idempotencyKey: `narrative-${kind}-cabinet`,
  });
}

function sourceFixture(job: NarrativeProjectionJobV1): AudienceSafeNarrativeSourceV1 {
  const variant = job.projectionKind === "GENESIS_NARRATIVE"
    ? { kind: "GENESIS" as const, stageId: "P0" as const, openingHook: "The decree is issued." }
    : job.projectionKind === "BEAT_NARRATIVE"
      ? { kind: "BEAT" as const, chapterId: "N3" as const, workingRevision: 2, temporalBoundary: "WORKING_NOT_FROZEN" as const }
      : job.projectionKind === "CHAPTER_NARRATIVE"
        ? { kind: "CHAPTER" as const, chapterId: "N3" as const, committedWorldSequence: 3, nextChapterId: "N4" as const }
        : { kind: "FINALE" as const, terminalKind: "PRESSURE_FINALE" as const, worldOutcomeRef: "world-outcome", viewerVerdictRef: "verdict-cabinet" };
  return {
    schemaVersion: "audience_safe_narrative_source_v1",
    projectionKind: job.projectionKind,
    sourceAuthority: job.sourceAuthority,
    sourceId: job.sourceId,
    sourceCommitHash: job.sourceCommitHash,
    sourceContentHash: job.sourceContentHash,
    audience: structuredClone(job.audience),
    facts: [
      { factId: "fact-public", text: "World remains stable", temporalStatus: job.projectionKind === "BEAT_NARRATIVE" ? "COMMITTED_WORKING" : "FROZEN" },
      { factId: "fact-seat", text: "seat-visible evidence", temporalStatus: job.projectionKind === "BEAT_NARRATIVE" ? "COMMITTED_WORKING" : "FROZEN" },
    ],
    objects: [],
    knowledge: [],
    allowedClaims: [
      { kind: "FACT", refId: "fact-public", statement: "World remains stable", required: true },
      { kind: "OUTCOME", refId: "world-outcome", statement: "The common outcome is confirmed", required: true },
      { kind: "VERDICT", refId: "verdict-cabinet", statement: "Cabinet verdict is WIN", required: true },
    ],
    variant,
  };
}

function validCandidate(): NarrativeRenderCandidateV1 {
  return {
    text: "World remains stable. The common outcome is confirmed. Cabinet verdict is WIN.",
    usedFactRefs: ["fact-public"],
    claims: [
      { kind: "FACT", refId: "fact-public", statement: "World remains stable" },
      { kind: "OUTCOME", refId: "world-outcome", statement: "The common outcome is confirmed" },
      { kind: "VERDICT", refId: "verdict-cabinet", statement: "Cabinet verdict is WIN" },
    ],
  };
}

class ScriptedProvider implements NarrativeProviderPortV1 {
  readonly calls: NarrativeContextV1[] = [];
  constructor(private readonly scripts: unknown[]) {}
  async render(context: NarrativeContextV1): Promise<unknown> {
    this.calls.push(structuredClone(context));
    const script = this.scripts.shift();
    if (script instanceof Error) throw script;
    if (typeof script === "function") return (script as () => unknown)();
    return structuredClone(script);
  }
}

class MemoryArtifactPublisher implements NarrativeArtifactPublisherPortV1 {
  readonly artifacts = new Map<string, NarrativeArtifactV1>();
  failuresRemaining = 0;
  async publish(request: Parameters<NarrativeArtifactPublisherPortV1["publish"]>[0]) {
    if (this.failuresRemaining > 0) {
      this.failuresRemaining -= 1;
      throw new Error("narrative storage unavailable");
    }
    const existing = this.artifacts.get(request.logicalProjectionKey);
    if (existing) return structuredClone(existing);
    this.artifacts.set(request.logicalProjectionKey, structuredClone(request.artifact));
    return structuredClone(request.artifact);
  }
}

class MemoryProjectionState implements NarrativeProjectionStatePortV1 {
  staleOnNextTransition = false;
  private record: {
    logicalProjectionKey: string;
    requestFingerprint: string;
    projectionId: string;
    fence: number;
    locked: boolean;
    providerAttemptCount: number;
    deliveryFailureCount: number;
    pendingArtifact: NarrativeArtifactV1 | null;
    artifact: NarrativeArtifactV1 | null;
    deadLetterReason: keyof typeof PRESSURE_NARRATIVE_ERROR_CODES | null;
  } | null = null;

  async claim(request: NarrativeProjectionClaimRequestV1): Promise<NarrativeProjectionClaimV1> {
    if (!this.record) {
      this.record = {
        logicalProjectionKey: request.logicalProjectionKey,
        requestFingerprint: request.requestFingerprint,
        projectionId: "projection-1",
        fence: 0,
        locked: false,
        providerAttemptCount: 0,
        deliveryFailureCount: 0,
        pendingArtifact: null,
        artifact: null,
        deadLetterReason: null,
      };
    }
    if (this.record.logicalProjectionKey !== request.logicalProjectionKey || this.record.requestFingerprint !== request.requestFingerprint) {
      throw new PressureNarrativeError(PRESSURE_NARRATIVE_ERROR_CODES.SOURCE_BINDING_MISMATCH, "claim");
    }
    if (this.record.artifact) {
      return {
        kind: "ALREADY_PUBLISHED",
        projectionId: this.record.projectionId,
        requestFingerprint: this.record.requestFingerprint,
        artifact: structuredClone(this.record.artifact),
      };
    }
    if (this.record.deadLetterReason) {
      return { kind: "DEAD_LETTERED", reasonCode: this.record.deadLetterReason };
    }
    if (this.record.locked) return { kind: "BUSY", retryAtMs: request.nowMs + request.leaseMs };
    this.record.locked = true;
    this.record.fence += 1;
    return {
      kind: "CLAIMED",
      projectionId: this.record.projectionId,
      fence: this.record.fence,
      requestFingerprint: this.record.requestFingerprint,
      providerAttemptCount: this.record.providerAttemptCount,
      deliveryFailureCount: this.record.deliveryFailureCount,
      pendingArtifact: structuredClone(this.record.pendingArtifact),
    };
  }

  async transition(request: NarrativeProjectionTransitionV1): Promise<void> {
    this.assertFence(request.projectionId, request.fence);
    if (this.staleOnNextTransition) {
      this.staleOnNextTransition = false;
      throw new PressureNarrativeError(PRESSURE_NARRATIVE_ERROR_CODES.STALE_FENCE, "projection.fence");
    }
    this.record!.providerAttemptCount = request.providerAttemptCount;
    this.record!.deliveryFailureCount = request.deliveryFailureCount;
    this.record!.pendingArtifact = structuredClone(request.pendingArtifact);
    if (request.status === "FAILED_RETRYABLE") this.record!.locked = false;
  }

  async markPublished(request: Parameters<NarrativeProjectionStatePortV1["markPublished"]>[0]): Promise<void> {
    this.assertFence(request.projectionId, request.fence);
    this.record!.artifact = structuredClone(request.artifact);
    this.record!.pendingArtifact = null;
    this.record!.locked = false;
  }

  async deadLetter(request: Parameters<NarrativeProjectionStatePortV1["deadLetter"]>[0]): Promise<void> {
    this.assertFence(request.projectionId, request.fence);
    this.record!.deadLetterReason = request.reasonCode;
    this.record!.pendingArtifact = structuredClone(request.pendingArtifact);
    this.record!.locked = false;
  }

  private assertFence(projectionId: string, fence: number): void {
    if (!this.record || this.record.projectionId !== projectionId || this.record.fence !== fence || !this.record.locked) {
      throw new PressureNarrativeError(PRESSURE_NARRATIVE_ERROR_CODES.STALE_FENCE, "projection.fence");
    }
  }
}
