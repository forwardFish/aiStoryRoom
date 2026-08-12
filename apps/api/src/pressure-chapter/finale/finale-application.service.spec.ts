import assert from "node:assert/strict";
import test from "node:test";
import {
  CHAPTER_IDS_V1,
  PRESSURE_CHAPTER_ROUTE_V1,
  PRESSURE_CHAPTER_SEAT_IDS_V1,
  TRACK_IDS_V1,
  compareCanonicalText,
  hashWithoutField,
  nextChapterId,
  sha256Canonical,
  validateAuthoritativePressureResultSnapshotV1,
  type FrozenFinalePolicyV1,
  type FrozenChapterBundleV1,
  type FrozenResultReferenceV1,
  type SeatIdV1,
  type TerminalResultContextV1,
  type TrackIdV1,
  type WorldStateV1,
} from "@ai-story/shared";
import {
  compileSangtianContentFinalePolicyV1,
  type GenericFinaleShadowCandidateV1,
} from "@ai-story/templates";
import {
  validateAuthorityFirstTerminalRecordV1,
  type AuthorityFirstTerminalCommitResultV1,
  type AuthorityFirstTerminalCommitterPort,
  type AuthorityFirstTerminalRecordV1,
  type GenericFinaleShadowReadOnlyPort,
  type NarrativeOutboxSignalPort,
} from "../terminal-commit";
import {
  N7FrozenFinaleInputAssemblerV1,
  PressureFinaleApplicationServiceV1,
  withN7FrozenFinaleSourceFingerprintV1,
  type FinalizeN7PressureRunCommandV1,
  type N7FrozenFinaleSourceReaderPort,
  type N7FrozenFinaleSourceV1,
} from ".";

const DECIDED_AT = "2026-08-12T01:00:00.000Z";
const digest = (label: string): string => sha256Canonical({ label });

function withHash<T extends Record<string, unknown>, K extends string>(
  value: T,
  field: K,
): T & Record<K, string> {
  return { ...value, [field]: sha256Canonical(value) } as T & Record<K, string>;
}

function worldState(sequence: number): WorldStateV1 {
  const finalTracks: Record<TrackIdV1, number> = {
    civilian_land: 3,
    mulberry_silk: 3,
    fiscal_military: 3,
    evidence_responsibility: 3,
    court_imperial_face: 3,
  };
  const tracks = withHash({
    schemaVersion: "sangtian_track_state_v1" as const,
    values: Object.fromEntries(TRACK_IDS_V1.map((trackId) => [
      trackId,
      sequence === 7 ? finalTracks[trackId] : 0,
    ])) as Record<TrackIdV1, number>,
  }, "stateHash");
  const knowledgeBySeat = PRESSURE_CHAPTER_SEAT_IDS_V1.reduce<WorldStateV1["knowledgeBySeat"]>((bySeat, seatId) => {
    bySeat[seatId] = withHash({
      seatId,
      knownFactRefs: ["fact.public.relief"],
      secretRefs: [`secret.${seatId}`],
      disclosedToSeatIds: [],
    }, "stateHash");
    return bySeat;
  }, {} as WorldStateV1["knowledgeBySeat"]);
  const seatArcs = PRESSURE_CHAPTER_SEAT_IDS_V1.reduce<WorldStateV1["seatArcs"]>((bySeat, seatId) => {
    bySeat[seatId] = withHash({
      seatId,
      arcStage: `stage-${sequence}`,
      publicGoalProgress: sequence,
      privateGoalProgress: sequence,
      gainRefs: sequence === 7 ? [`gain.${seatId}`] : [],
      lossRefs: [],
      costRefs: [],
    }, "stateHash");
    return bySeat;
  }, {} as WorldStateV1["seatArcs"]);
  return withHash({
    schemaVersion: "sangtian_world_state_v1" as const,
    worldSequence: sequence,
    factValues: { "fact.public.relief": sequence === 7 },
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
      runId: "run-terminal-1",
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

function sourceFixture(): N7FrozenFinaleSourceV1 {
  const policy = compileSangtianContentFinalePolicyV1({
    contentPackageVersion: "sangtian-content-1.0.0",
    contentPackageSha256: digest("content"),
  });
  const genesisHash = digest("genesis");
  const bundles = frozenBundles(genesisHash);
  return withN7FrozenFinaleSourceFingerprintV1({
    schemaVersion: "n7_frozen_finale_source_v1",
    runId: "run-terminal-1",
    triggerKind: "N7_FROZEN",
    terminalChapterId: "N7",
    terminalWorldSequence: 7,
    routeHash: digest("route"),
    runSeed: "seed-terminal-1",
    genesisHash,
    frozenChapterBundles: bundles,
    finalWorldState: bundles[6]!.frozenWorldState,
    causalEdges: [],
    policy,
    terminalResultContext: terminalResultContextFixture(policy, bundles),
  });
}

function terminalResultContextFixture(
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
      : referenceId.startsWith("seat.")
        ? "RULE"
        : "FACT",
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
      summaries: {
        LOW: `${trackId} low`,
        MID: `${trackId} mid`,
        HIGH: `${trackId} high`,
      },
    })),
    seats: PRESSURE_CHAPTER_SEAT_IDS_V1.map((seatId) => ({
      seatId,
      roleKey: `role.${seatId}`,
      roleName: `Role ${seatId}`,
      verdictLabels: {
        WIN: "Win",
        COSTLY_WIN: "Costly win",
        LOSS: "Loss",
      },
    })),
    references,
    replayHint: "Replay from the same frozen route with different formal actions.",
  };
  const catalog = {
    ...catalogWithoutHash,
    catalogHash: sha256Canonical(catalogWithoutHash),
  };
  const contextWithoutHash = {
    schemaVersion: "terminal_result_context_v1" as const,
    roomId: "room-terminal-1",
    runId: "run-terminal-1",
    worldId: "sangtian" as const,
    participantMode: "MULTIPLAYER" as const,
    completedAt: DECIDED_AT,
    frozenRoute: PRESSURE_CHAPTER_ROUTE_V1,
    frozenRouteHash: digest("route"),
    resultContractRegistryVersion: "result-registry-1.0.0",
    payloadSchemaVersion: "sangtian_pressure_result_v1" as const,
    presentationSchemaVersion: "sangtian_pressure_result_v1" as const,
    rendererKey: "sangtian_pressure_endgame_v1" as const,
    contentPackageVersion: policy.contentPackageVersion,
    contentPackageSha256: policy.contentPackageSha256,
    narrativeProfileVersion: "openovel-pressure-1.0.0",
    catalog,
  };
  return {
    ...contextWithoutHash,
    contextHash: sha256Canonical(contextWithoutHash),
  };
}

class MemorySourceReader implements N7FrozenFinaleSourceReaderPort {
  reads = 0;
  constructor(public source: unknown) {}

  async readN7FrozenSource(): Promise<unknown | null> {
    this.reads += 1;
    return this.source === null ? null : structuredClone(this.source);
  }
}

class MemoryAuthorityCommitter implements AuthorityFirstTerminalCommitterPort {
  readonly records = new Map<string, AuthorityFirstTerminalRecordV1>();
  readonly candidates: AuthorityFirstTerminalRecordV1[] = [];
  attempts = 0;
  writes = 0;
  failCommit = false;

  constructor(private readonly events: string[]) {}

  async readCommitted(runId: string): Promise<unknown | null> {
    const value = this.records.get(runId);
    return value ? structuredClone(value) : null;
  }

  async commitOnce(
    record: Readonly<AuthorityFirstTerminalRecordV1>,
  ): Promise<AuthorityFirstTerminalCommitResultV1> {
    this.attempts += 1;
    this.candidates.push(structuredClone(record));
    this.events.push("commit:start");
    await Promise.resolve();
    if (this.failCommit) {
      this.events.push("commit:failed");
      throw new Error("DB_UNAVAILABLE");
    }
    const existing = this.records.get(record.runId);
    if (existing) {
      this.events.push("commit:replayed");
      return { status: "REPLAYED", record: structuredClone(existing) };
    }
    this.records.set(record.runId, structuredClone(record));
    this.writes += 1;
    this.events.push("commit:success");
    return { status: "COMMITTED", record: structuredClone(record) };
  }
}

class MemoryOutboxSignal implements NarrativeOutboxSignalPort {
  calls = 0;
  fail = false;

  constructor(private readonly events: string[]) {}

  async notifyCommitted(): Promise<void> {
    this.calls += 1;
    this.events.push("outbox:notify");
    assert.equal(this.events.includes("commit:success"), true, "outbox ran before authority");
    if (this.fail) throw new Error("NARRATIVE_WORKER_UNAVAILABLE");
  }
}

class MemoryShadow implements GenericFinaleShadowReadOnlyPort {
  calls = 0;
  mode: "MATCH" | "MISMATCH" | "FAIL" | "NONE" = "MATCH";

  constructor(private readonly events: string[]) {}

  async evaluateShadow(input: Parameters<GenericFinaleShadowReadOnlyPort["evaluateShadow"]>[0]) {
    this.calls += 1;
    this.events.push("shadow:evaluate");
    assert.equal(this.events.includes("commit:success"), true, "shadow ran before authority");
    if (this.mode === "FAIL") throw new Error("GENERIC_SHADOW_FAILED");
    if (this.mode === "NONE") return null;
    const decision = input.authoritativeDecision;
    return {
      schemaVersion: "generic_finale_shadow_candidate_v1" as const,
      shadowEngineVersion: "generic-shadow-v3",
      sourceInputHash: input.finaleInput.inputHash,
      worldOutcomeId: this.mode === "MATCH"
        ? decision.worldOutcome.outcomeId
        : "GENERIC_DIFFERENT_OUTCOME",
      seatVerdicts: decision.seats.map((seat) => ({
        seatId: seat.seatId,
        verdict: seat.verdict,
      })),
      semanticOutcomeHash: this.mode === "MATCH"
        ? decision.semanticOutcomeHash
        : digest("generic-mismatch"),
    } satisfies GenericFinaleShadowCandidateV1;
  }
}

function harness(source = sourceFixture()) {
  const events: string[] = [];
  const sourceReader = new MemorySourceReader(source);
  const committer = new MemoryAuthorityCommitter(events);
  const outbox = new MemoryOutboxSignal(events);
  const shadow = new MemoryShadow(events);
  const service = new PressureFinaleApplicationServiceV1(
    new N7FrozenFinaleInputAssemblerV1(sourceReader),
    committer,
    outbox,
    shadow,
  );
  const command: FinalizeN7PressureRunCommandV1 = {
    runId: source.runId,
    idempotencyKey: `terminal:${source.runId}`,
    requestFingerprint: source.sourceFingerprint,
    decidedAt: DECIDED_AT,
  };
  return { events, sourceReader, committer, outbox, shadow, service, command };
}

function rehashSource(source: Record<string, unknown>): void {
  source.sourceFingerprint = hashWithoutField(source, "sourceFingerprint");
}

test("N7 Frozen is evaluated and one authority-first atomic terminal record is committed", async () => {
  const state = harness();
  const result = await state.service.finalize(state.command);

  assert.equal(result.status, "COMMITTED");
  assert.equal(result.record.decision.decidedAt, DECIDED_AT);
  assert.equal(
    result.record.decision.decidedAt,
    result.record.resultArtifact.completedAt,
  );
  assert.equal(state.committer.writes, 1);
  assert.equal(result.record.decision.worldOutcome.outcomeId, "BALANCED_SURVIVAL");
  assert.equal(result.record.seatOutcomes.length, 6);
  assert.equal(result.record.resultArtifact.authoritativeResultStatus, "FINALIZED");
  assert.equal(
    validateAuthoritativePressureResultSnapshotV1(result.record.resultArtifact).snapshotHash,
    result.record.resultArtifact.snapshotHash,
  );
  assert.equal(
    result.record.resultArtifact.snapshotHash,
    hashWithoutField(
      result.record.resultArtifact as unknown as Record<string, unknown>,
      "snapshotHash",
    ),
  );
  assert.equal("narratives" in result.record.resultArtifact, false);
  assert.equal("narrativeStatus" in result.record.resultArtifact, false);
  assert.equal("narrativeText" in result.record.resultArtifact, false);
  assert.equal(result.record.resultArtifact.seatOutcomes.every(
    (seat) => seat.causes.every((cause) => (
      cause.sourceKind === "CHAPTER_SETTLEMENT"
      && cause.sourceStageId === "N7"
      && cause.chapterSettlementId === sourceFixture().frozenChapterBundles[6]!.bundleHash
    )),
  ), true);
  assert.equal(result.record.narrativeOutbox.status, "PENDING");
  assert.equal(result.record.narrativeOutbox.jobs.length, 7);
  assert.deepEqual(state.events, ["commit:start", "commit:success", "outbox:notify", "shadow:evaluate"]);
  assert.equal(result.postCommit.narrativeOutboxSignal, "NOTIFIED");
  assert.equal(result.postCommit.genericShadow, "MATCH");
});

test("Finale decision time comes from the N7 authority source, never the caller clock", async () => {
  const withoutCallerTime = harness();
  const { decidedAt: _ignored, ...command } = withoutCallerTime.command;
  const committed = await withoutCallerTime.service.finalize(command);
  assert.equal(committed.record.decision.decidedAt, DECIDED_AT);
  assert.equal(committed.record.resultArtifact.completedAt, DECIDED_AT);

  const staleCaller = harness();
  await assert.rejects(
    staleCaller.service.finalize({
      ...staleCaller.command,
      decidedAt: "2099-01-01T00:00:00.000Z",
    }),
    /EXPECTED_AUTHORITY_TIME_2026-08-12T01:00:00.000Z/u,
  );
  assert.equal(staleCaller.committer.attempts, 0);
});

test("snapshot ACL and frozen cause bindings fail closed even after hashes are recomputed", async () => {
  const state = harness();
  const result = await state.service.finalize(state.command);

  for (const mutate of [
    (snapshot: Record<string, any>) => {
      snapshot.impacts[0].visibility = "AUTHORIZED";
      snapshot.impacts[0].authorizedSeatIds = [];
    },
    (snapshot: Record<string, any>) => {
      snapshot.seatOutcomes[0].causes[0].chapterSettlementId = null;
    },
  ]) {
    const tampered = structuredClone(result.record) as unknown as Record<string, any>;
    mutate(tampered.resultArtifact);
    tampered.resultArtifact.snapshotHash = hashWithoutField(
      tampered.resultArtifact,
      "snapshotHash",
    );
    tampered.atomicRecordHash = hashWithoutField(tampered, "atomicRecordHash");
    assert.throws(
      () => validateAuthorityFirstTerminalRecordV1(tampered),
      /(?:CONTRACT_FIELD_INVALID|PRESSURE_TERMINAL_ATOMIC_RECORD_INVALID)/u,
    );
  }
});

test("atomic record validation binds every Narrative Outbox job to the authority commit", async () => {
  const state = harness();
  const result = await state.service.finalize(state.command);
  const tampered = structuredClone(result.record) as unknown as Record<string, any>;
  tampered.narrativeOutbox.jobs[0].sourceCommitHash = digest("foreign-commit");
  tampered.narrativeOutbox.outboxHash = hashWithoutField(
    tampered.narrativeOutbox,
    "outboxHash",
  );
  tampered.atomicRecordHash = hashWithoutField(tampered, "atomicRecordHash");

  assert.throws(
    () => validateAuthorityFirstTerminalRecordV1(tampered),
    /PRESSURE_TERMINAL_ATOMIC_RECORD_INVALID/u,
  );
});

test("invalid trigger and a non-N7 terminal sequence fail before evaluation or commit", async () => {
  for (const mutate of [
    (source: Record<string, any>) => { source.triggerKind = "N6_FROZEN"; },
    (source: Record<string, any>) => {
      source.terminalChapterId = "N6";
      source.terminalWorldSequence = 6;
    },
  ]) {
    const broken = structuredClone(sourceFixture()) as unknown as Record<string, any>;
    mutate(broken);
    rehashSource(broken);
    const state = harness(broken as unknown as N7FrozenFinaleSourceV1);
    await assert.rejects(
      state.service.finalize(state.command),
      /PRESSURE_TERMINAL_(?:INVALID_TRIGGER|N7_REQUIRED)/u,
    );
    assert.equal(state.committer.attempts, 0);
    assert.equal(state.outbox.calls, 0);
    assert.equal(state.shadow.calls, 0);
  }
});

test("a self-hashed catalog still fails when a reference is not bound to its Frozen chapter", async () => {
  const broken = structuredClone(sourceFixture()) as unknown as Record<string, any>;
  const context = broken.terminalResultContext;
  context.catalog.references[0].frozenSourceHash = digest("foreign-frozen-source");
  context.catalog.catalogHash = hashWithoutField(context.catalog, "catalogHash");
  context.contextHash = hashWithoutField(context, "contextHash");
  rehashSource(broken);
  const state = harness(broken as unknown as N7FrozenFinaleSourceV1);

  await assert.rejects(
    state.service.finalize(state.command),
    /PRESSURE_TERMINAL_ATOMIC_RECORD_INVALID/u,
  );
  assert.equal(state.committer.attempts, 0);
  assert.equal(state.outbox.calls, 0);
  assert.equal(state.shadow.calls, 0);
});

test("same fingerprint replays while a different fingerprint or key cannot reinterpret a Run", async () => {
  const state = harness();
  const first = await state.service.finalize(state.command);
  const replay = await state.service.finalize(structuredClone(state.command));
  assert.equal(first.status, "COMMITTED");
  assert.equal(replay.status, "REPLAYED");
  assert.equal(replay.record.atomicRecordHash, first.record.atomicRecordHash);
  assert.equal(state.committer.writes, 1);
  assert.equal(state.outbox.calls, 1);
  assert.equal(state.shadow.calls, 1);

  await assert.rejects(
    state.service.finalize({ ...state.command, requestFingerprint: digest("different-source") }),
    /PRESSURE_TERMINAL_IDEMPOTENCY_FINGERPRINT_MISMATCH/u,
  );
  await assert.rejects(
    state.service.finalize({ ...state.command, idempotencyKey: "terminal:other-key" }),
    /PRESSURE_TERMINAL_ALREADY_COMMITTED/u,
  );
});

test("concurrent finalize calls for one Run produce exactly one authority commit", async () => {
  const state = harness();
  const results = await Promise.all([
    state.service.finalize(structuredClone(state.command)),
    state.service.finalize(structuredClone(state.command)),
  ]);
  assert.deepEqual(results.map((item) => item.status).sort(), ["COMMITTED", "REPLAYED"]);
  assert.equal(state.committer.attempts, 2);
  assert.equal(state.committer.writes, 1);
  assert.equal(new Set(results.map((item) => item.record.atomicRecordHash)).size, 1);
  assert.equal(state.outbox.calls, 1);
  assert.equal(state.shadow.calls, 1);
});

test("commit failure persists neither Result nor Narrative Outbox and starts no downstream work", async () => {
  const state = harness();
  state.committer.failCommit = true;
  await assert.rejects(state.service.finalize(state.command), /DB_UNAVAILABLE/u);

  assert.equal(state.committer.records.size, 0);
  assert.equal(state.committer.candidates.length, 1);
  assert.equal(state.committer.candidates[0]?.narrativeOutbox.jobs.length, 7);
  assert.equal(state.outbox.calls, 0);
  assert.equal(state.shadow.calls, 0);
  assert.deepEqual(state.events, ["commit:start", "commit:failed"]);
});

test("Narrative wake-up and Generic shadow failures never roll back authority", async () => {
  const state = harness();
  state.outbox.fail = true;
  state.shadow.mode = "FAIL";
  const result = await state.service.finalize(state.command);

  assert.equal(result.status, "COMMITTED");
  assert.equal(result.postCommit.narrativeOutboxSignal, "FAILED_RETRYABLE");
  assert.equal(result.postCommit.genericShadow, "FAILED_ISOLATED");
  assert.equal(state.committer.records.size, 1);
  assert.equal(state.committer.records.get(state.command.runId)?.atomicRecordHash, result.record.atomicRecordHash);
});

test("Generic mismatch is diagnostic only and cannot overwrite the authoritative decision", async () => {
  const state = harness();
  state.shadow.mode = "MISMATCH";
  const result = await state.service.finalize(state.command);
  const stored = state.committer.records.get(state.command.runId)!;

  assert.equal(result.postCommit.genericShadow, "MISMATCH");
  assert.equal(result.postCommit.shadowReport?.matches, false);
  assert.equal(stored.decision.worldOutcome.outcomeId, "BALANCED_SURVIVAL");
  assert.equal(stored.decision.semanticOutcomeHash, result.record.decision.semanticOutcomeHash);
  assert.notEqual(
    result.postCommit.shadowReport?.shadowDecisionHash,
    stored.decision.semanticOutcomeHash,
  );
});

test("Provider or ResultQuery data cannot be smuggled into the terminal source or service", async () => {
  const source = structuredClone(sourceFixture()) as unknown as Record<string, unknown>;
  source.providerDecision = { outcomeId: "AUTO_WIN" };
  rehashSource(source);
  const state = harness(source as unknown as N7FrozenFinaleSourceV1);
  await assert.rejects(state.service.finalize(state.command), /PRESSURE_TERMINAL_INVALID_TRIGGER/u);
  assert.equal((state.service as unknown as Record<string, unknown>).provider, undefined);
  assert.equal((state.service as unknown as Record<string, unknown>).resultQuery, undefined);
  assert.equal(PressureFinaleApplicationServiceV1.length, 4);
  assert.equal(state.committer.attempts, 0);
});
