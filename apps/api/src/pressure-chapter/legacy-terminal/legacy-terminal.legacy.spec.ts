import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import {
  LegacyTerminalInputAdapterV1,
  ClosedLegacyT20CreationPolicyGuardV1,
  InMemoryLegacyTerminalStoreV1,
  LegacyT20CreationPolicyServiceV1,
  LegacyTerminalCoordinatorV1,
  LegacyTerminalError,
  RecordingLegacyNarrativeOutboxKickV1,
  canonicalLegacyMaterial,
  computeLegacyCanonHash,
  computeLegacyNarrativeContentHash,
  computeLegacyPresentationHash,
  computeLegacySettledStateHash,
  computeLegacyTerminalInputHash,
  legacyTerminalHash,
  type LegacyHistoricalCompletedSnapshotV1,
  type LegacyNarrativePresentationV1,
  type LegacyTerminalMaterialV1,
  type LegacyUnfinishedTerminalSnapshotV1,
} from "./index";

const RUN_ID = "legacy-run-t20-001";

function material(overrides: Partial<LegacyTerminalMaterialV1> = {}): LegacyTerminalMaterialV1 {
  return {
    canonBefore: [
      { factId: "fact.t19.mandate", factText: "总督仍掌握治桑主持权。", sourceRef: "turn:t19:mandate" },
      { factId: "fact.t19.ledger", factText: "粮册副本已经送达。", sourceRef: "turn:t19:ledger" },
    ],
    terminalFacts: [
      { factId: "fact.t20.trust", factText: "皇帝信任仍高于失权线。", sourceRef: "turn:t20:trust" },
      { factId: "fact.t20.ledger", factText: "原始粮册已由总督保全。", sourceRef: "turn:t20:ledger" },
    ],
    ending: {
      schemaVersion: "legacy_authoritative_ending_v1",
      scope: "STORY",
      endingKey: "sangtian-ledger-preserved",
      title: "原册归案",
      verdict: "COSTLY_WIN",
      gain: ["保住治桑主导权", "取得原始粮册"],
      loss: ["皇帝信任有所下降"],
      causes: [
        { sourceRef: "turn:t20:ledger", factText: "原始粮册已由总督保全。" },
        { sourceRef: "turn:t20:trust", factText: "皇帝信任仍高于失权线。" },
      ],
      sourceTurnId: "T20",
      sourceRevision: 20,
    },
    canonMutations: [
      {
        mutationId: "canon.t20.trust",
        operation: "UPSERT_FACT",
        factId: "fact.t20.trust",
        factText: "皇帝信任仍高于失权线。",
        sourceRef: "turn:t20:trust",
      },
      {
        mutationId: "canon.t20.ledger",
        operation: "UPSERT_FACT",
        factId: "fact.t20.ledger",
        factText: "原始粮册已由总督保全。",
        sourceRef: "turn:t20:ledger",
      },
    ],
    resultType: "SOLO_STORY_END",
    replayPolicyVersion: "legacy_openovel_replay_v2",
    narrativeAudience: { kind: "PUBLIC", seatId: null },
    narrativeProfileVersion: "openovel_finale_narrative_v1",
    allowedFactIds: ["fact.t20.trust", "fact.t20.ledger"],
    allowedObjectVersionIds: [],
    allowedKnowledgeIds: [],
    ...overrides,
  };
}

function unfinished(inputMaterial = material()): LegacyUnfinishedTerminalSnapshotV1 {
  const canonical = canonicalLegacyMaterial(inputMaterial);
  const inputWithoutHash = {
    schemaVersion: "legacy_terminal_input_v1" as const,
    runId: RUN_ID,
    frozenRouteHash: legacyTerminalHash("fixture/legacy-route/v1", { runId: RUN_ID }),
    sourceTurnId: "T20",
    sourceRevision: 20 as const,
    terminalSignal: "HANDOFF_READY" as const,
    settledStateHash: computeLegacySettledStateHash(canonical),
    canonBeforeHash: computeLegacyCanonHash(canonical.canonBefore),
    endingPolicyVersion: "sangtian_openovel_ending_v1",
  };
  return {
    kind: "UNFINISHED_T20",
    runId: RUN_ID,
    runtimeProfile: "OPENNOVEL_T20_V1",
    runtimeTerminalState: "HANDOFF_READY",
    terminalInput: {
      ...inputWithoutHash,
      inputHash: computeLegacyTerminalInputHash(inputWithoutHash),
    },
    material: inputMaterial,
  };
}

function historical(): LegacyHistoricalCompletedSnapshotV1 {
  return {
    kind: "HISTORICAL_COMPLETED",
    runId: "legacy-completed-001",
    runtimeProfile: "OPENNOVEL_T20_V1",
    runtimeTerminalState: "STORY_COMPLETE",
    frozenHeadHash: legacyTerminalHash("fixture/head", { revision: 20 }),
    frozenEndingHash: legacyTerminalHash("fixture/ending", { key: "old-ending" }),
    frozenResultHash: legacyTerminalHash("fixture/result", { schema: "openovel_result_v2" }),
    frozenFinalSceneNarrative: "雨停之后，旧粮册仍压在总督案头。",
    frozenPayload: { schemaVersion: "openovel_result_v2", original: true, nested: { untouched: 7 } },
  };
}

function coordinator(store: InMemoryLegacyTerminalStoreV1, kick = new RecordingLegacyNarrativeOutboxKickV1()) {
  return {
    kick,
    service: new LegacyTerminalCoordinatorV1(
      store,
      new LegacyTerminalInputAdapterV1(),
      store,
      kick,
      store,
    ),
  };
}

function presentation(input: {
  sourceCommitHash: string;
  narrativeOutboxId: string;
  revision: number;
  status: "FALLBACK_PUBLISHED" | "PUBLISHED";
  text: string;
}): LegacyNarrativePresentationV1 {
  const withoutPresentationHash = {
    schemaVersion: "legacy_narrative_presentation_v1" as const,
    runId: RUN_ID,
    sourceCommitHash: input.sourceCommitHash,
    narrativeOutboxId: input.narrativeOutboxId,
    revision: input.revision,
    status: input.status,
    text: input.text,
    contentHash: computeLegacyNarrativeContentHash({ text: input.text }),
  };
  return {
    ...withoutPresentationHash,
    presentationHash: computeLegacyPresentationHash(withoutPresentationHash),
  };
}

test("LegacyTerminalInputAdapter is deterministic and contains no literary terminal text", () => {
  const adapter = new LegacyTerminalInputAdapterV1();
  const first = adapter.compile({ snapshot: unfinished(), idempotencyKey: "terminal-request-1" });
  const reordered = material({
    canonBefore: [...material().canonBefore].reverse(),
    terminalFacts: [...material().terminalFacts].reverse(),
    canonMutations: [...material().canonMutations].reverse(),
    allowedFactIds: [...material().allowedFactIds].reverse(),
    ending: {
      ...material().ending,
      gain: [...material().ending.gain].reverse(),
      causes: [...material().ending.causes].reverse(),
    },
  });
  const second = adapter.compile({ snapshot: unfinished(reordered), idempotencyKey: "terminal-request-2" });

  assert.equal(first.commandFingerprint, second.commandFingerprint, "transport idempotency keys do not change semantic fingerprint");
  assert.equal(first.structuredResultHash, second.structuredResultHash);
  assert.equal(first.canonAfterHash, second.canonAfterHash);
  assert.deepEqual(first.authoritativeEnding, second.authoritativeEnding);
  assert.equal(first.narrativeOutbox.sourceAuthority, "LEGACY_TERMINAL_COMMITTED");
  assert.equal(first.narrativeOutbox.sourceContentHash, first.structuredResultHash);
  assert.doesNotMatch(JSON.stringify(first), /finalSceneNarrative|systemPrompt|modelOutput/u);
});

test("HANDOFF_READY revision 20 still rejects a non-T20 authoritative source turn", () => {
  const wrongMaterial = material({
    ending: { ...material().ending, sourceTurnId: "T19" },
  });
  const adapter = new LegacyTerminalInputAdapterV1();
  assert.throws(
    () => adapter.compile({ snapshot: unfinished(wrongMaterial), idempotencyKey: "reject-ending-non-t20" }),
    (error: unknown) => error instanceof LegacyTerminalError && error.code === "LEGACY_TERMINAL_NOT_READY",
  );
  const snapshot = unfinished(wrongMaterial);
  const { inputHash: _inputHash, ...inputWithoutHash } = snapshot.terminalInput;
  snapshot.terminalInput = {
    ...inputWithoutHash,
    sourceTurnId: "T19",
    inputHash: computeLegacyTerminalInputHash({ ...inputWithoutHash, sourceTurnId: "T19" }),
  };
  assert.throws(
    () => adapter.compile({ snapshot, idempotencyKey: "reject-input-non-t20" }),
    (error: unknown) => error instanceof LegacyTerminalError && error.code === "LEGACY_TERMINAL_NOT_READY",
  );
});

test("last-scene downstream failure leaves Ending, Canon, Result, receipt and outbox committed", async () => {
  const store = new InMemoryLegacyTerminalStoreV1();
  store.setSource(unfinished());
  const kick = new RecordingLegacyNarrativeOutboxKickV1();
  kick.failuresRemaining = 1;
  const { service } = coordinator(store, kick);

  const result = await service.finalize({ runId: RUN_ID, idempotencyKey: "terminal-provider-timeout" });
  if (result.status === "HISTORICAL_READ_ONLY") assert.fail("expected active terminal commit");
  assert.equal(result.status, "COMMITTED");
  assert.equal(result.narrativeStatus, "FAILED_RETRYABLE");
  assert.equal(result.receipt.runtimeTerminalState, "STORY_COMPLETE");
  assert.equal(result.narrativeOutboxJob.sourceCommitHash, result.receipt.sourceCommitHash);
  assert.equal(result.narrativeOutboxJob.sourceAuthority, "LEGACY_TERMINAL_COMMITTED");
  const authorityAfterFailure = await store.readAuthority(RUN_ID);
  const replay = await service.finalize({ runId: RUN_ID, idempotencyKey: "terminal-provider-timeout" });
  assert.notEqual(replay.status, "HISTORICAL_READ_ONLY");
  if (replay.status === "HISTORICAL_READ_ONLY") assert.fail("expected terminal replay");
  assert.equal(replay.status, "REPLAYED");
  assert.equal(replay.narrativeStatus, "PENDING");
  assert.deepEqual(await store.readAuthority(RUN_ID), authorityAfterFailure);
  assert.equal(replay.receipt.endingHash, result.receipt.endingHash);
  assert.equal(replay.receipt.canonHash, result.receipt.canonHash);
  assert.equal(replay.receipt.structuredResultHash, result.receipt.structuredResultHash);
  assert.equal(replay.receipt.sourceCommitHash, result.receipt.sourceCommitHash);
  assert.equal(store.authorityTransactions, 1);
  assert.equal(store.authorityWrites, 5);
  assert.ok(authorityAfterFailure);
});

test("precommit crash is zero-write and postcommit replay returns one stable receipt", async () => {
  const store = new InMemoryLegacyTerminalStoreV1();
  store.setSource(unfinished());
  store.failBeforeCommitOnce = true;
  const { service, kick } = coordinator(store);

  await assert.rejects(() => service.finalize({ runId: RUN_ID, idempotencyKey: "terminal-crash-recovery" }), /INJECTED_PRECOMMIT/u);
  assert.equal(await store.readAuthority(RUN_ID), null);
  assert.equal(store.authorityWrites, 0);

  const committed = await service.finalize({ runId: RUN_ID, idempotencyKey: "terminal-crash-recovery" });
  const replayed = await service.finalize({ runId: RUN_ID, idempotencyKey: "terminal-crash-recovery" });
  assert.notEqual(committed.status, "HISTORICAL_READ_ONLY");
  assert.notEqual(replayed.status, "HISTORICAL_READ_ONLY");
  if (committed.status === "HISTORICAL_READ_ONLY" || replayed.status === "HISTORICAL_READ_ONLY") assert.fail();
  assert.equal(committed.status, "COMMITTED");
  assert.equal(replayed.status, "REPLAYED");
  assert.deepEqual(replayed.receipt, committed.receipt);
  assert.equal(store.authorityTransactions, 1);
  assert.equal(store.authorityWrites, 5);
  assert.equal(kick.kicked.length, 2, "recovery may wake the same committed outbox again");
  assert.equal(new Set(kick.kicked).size, 1, "the logical outbox id remains unique");
});

test("same idempotency key with changed settled source fingerprint is rejected", async () => {
  const store = new InMemoryLegacyTerminalStoreV1();
  store.setSource(unfinished());
  const { service } = coordinator(store);
  const first = await service.finalize({ runId: RUN_ID, idempotencyKey: "terminal-same-key" });
  assert.notEqual(first.status, "HISTORICAL_READ_ONLY");

  const changed = material({
    ending: { ...material().ending, verdict: "LOSS", endingKey: "sangtian-ledger-lost", title: "原册尽失" },
  });
  store.setSource(unfinished(changed));
  await assert.rejects(
    () => service.finalize({ runId: RUN_ID, idempotencyKey: "terminal-same-key" }),
    (error: unknown) => error instanceof LegacyTerminalError && error.code === "LEGACY_TERMINAL_FINGERPRINT_MISMATCH",
  );
  assert.equal(store.authorityTransactions, 1);
});

test("completed historical T20 is returned byte-for-byte read-only with zero terminal writes", async () => {
  const store = new InMemoryLegacyTerminalStoreV1();
  const frozen = historical();
  store.setSource(frozen);
  const { service, kick } = coordinator(store);
  const before = structuredClone(frozen);

  const result = await service.finalize({ runId: frozen.runId, idempotencyKey: "must-not-be-used" });
  assert.equal(result.status, "HISTORICAL_READ_ONLY");
  if (result.status !== "HISTORICAL_READ_ONLY") assert.fail();
  assert.deepEqual(result.snapshot, before);
  assert.deepEqual(await store.load(frozen.runId), before);
  assert.equal(store.authorityWrites, 0);
  assert.equal(store.presentationWrites, 0);
  assert.equal(kick.kicked.length, 0);
});

test("new T20 and SAME replay are closed while LATEST resolves explicitly to Pressure", () => {
  const guard = new ClosedLegacyT20CreationPolicyGuardV1();
  const policy = new LegacyT20CreationPolicyServiceV1(guard);
  assert.throws(
    () => policy.resolve("CREATE_T20"),
    (error: unknown) => error instanceof LegacyTerminalError && error.code === "LEGACY_T20_CREATION_DISABLED",
  );
  assert.throws(
    () => policy.resolve("RESTART_SAME_EXPERIENCE"),
    (error: unknown) => error instanceof LegacyTerminalError && error.code === "LEGACY_T20_SAME_EXPERIENCE_DISABLED",
  );
  assert.deepEqual(policy.resolve("START_LATEST_EXPERIENCE"), {
    intent: "START_LATEST_EXPERIENCE",
    allowed: true,
    targetRuntimeProfile: "SANGTIAN_CONTINUOUS_CHAPTER_V1",
    reason: null,
  });
});

test("narrative supplementation mutates only presentation state", async () => {
  const store = new InMemoryLegacyTerminalStoreV1();
  store.setSource(unfinished());
  const { service } = coordinator(store);
  const terminal = await service.finalize({ runId: RUN_ID, idempotencyKey: "terminal-presentation" });
  assert.notEqual(terminal.status, "HISTORICAL_READ_ONLY");
  if (terminal.status === "HISTORICAL_READ_ONLY") assert.fail();
  const authorityBefore = await store.readAuthority(RUN_ID);
  const authorityWritesBefore = store.authorityWrites;

  const fallback = presentation({
    sourceCommitHash: terminal.receipt.sourceCommitHash,
    narrativeOutboxId: terminal.receipt.narrativeOutboxId,
    revision: 1,
    status: "FALLBACK_PUBLISHED",
    text: "权威结局已确认：原册归案，总督付出了信任代价。",
  });
  await service.publishNarrative(fallback);
  const published = presentation({
    sourceCommitHash: terminal.receipt.sourceCommitHash,
    narrativeOutboxId: terminal.receipt.narrativeOutboxId,
    revision: 2,
    status: "PUBLISHED",
    text: "雨停时，原册仍压在案头；总督保住了主导权，也留下了代价。",
  });
  await service.publishNarrative(published);

  assert.deepEqual(await store.readAuthority(RUN_ID), authorityBefore);
  assert.equal(store.authorityWrites, authorityWritesBefore);
  assert.equal(store.presentationWrites, 2);
  assert.deepEqual(store.readPresentation(RUN_ID), published);
  await assert.rejects(
    () => service.publishNarrative(presentation({
      ...published,
      sourceCommitHash: legacyTerminalHash("wrong-source", {}),
      revision: 3,
      status: "PUBLISHED",
      text: "不应发布。",
    })),
    (error: unknown) => error instanceof LegacyTerminalError && error.code === "LEGACY_NARRATIVE_SOURCE_MISMATCH",
  );
});

test("unfinished terminal contracts reject literary fields and authority code has no model-service dependency", () => {
  const leaked = structuredClone(unfinished()) as unknown as Record<string, unknown>;
  (leaked.material as Record<string, unknown>).finalSceneNarrative = "不应进入命令";
  const adapter = new LegacyTerminalInputAdapterV1();
  assert.throws(
    () => adapter.compile({ snapshot: leaked as never, idempotencyKey: "leaked-field" }),
    (error: unknown) => error instanceof LegacyTerminalError && error.code === "LEGACY_TERMINAL_INVALID_CONTRACT",
  );

  const sources = ["adapter.ts", "coordinator.ts", "creation-policy.ts", "canonical.ts", "validation.ts"]
    .map((file) => readFileSync(resolve(process.cwd(), "apps/api/src/pressure-chapter/legacy-terminal", file), "utf8"))
    .join("\n");
  assert.doesNotMatch(sources, /from\s+["'][^"']*(?:provider|openovel-runtime)|NarrativeRenderer|finalSceneNarrative/u);
});
