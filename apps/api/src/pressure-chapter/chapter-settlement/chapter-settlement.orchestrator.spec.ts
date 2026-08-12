import assert from "node:assert/strict";
import test from "node:test";
import {
  PRESSURE_CHAPTER_SEAT_IDS_V1,
  TRACK_IDS_V1,
  chapterSequence,
  nextChapterId,
  sha256Canonical,
  type B0ChapterPolicyEvaluationDraftV1,
  type B0ChapterSeatArcDeltaV1,
  type ChapterIdV1,
  type KnowledgeStateV1,
  type SeatArcStateV1,
  type SeatIdV1,
  type TrackIdV1,
  type TrackStateV1,
  type WorldStateV1,
} from "@ai-story/shared";
import {
  computeChapterSettlementRequestFingerprintV1,
  sealChapterCloseFenceV1,
  sealChapterSettlementSourceV1,
} from "./chapter-commit-record";
import { ChapterSettlementOrchestrator } from "./chapter-settlement.orchestrator";
import {
  CHAPTER_SETTLEMENT_ERROR_CODES,
  ChapterSettlementError,
} from "./errors";
import type {
  AtomicChapterCommitRecordV1,
  AtomicChapterCommitterPort,
  ChapterCloseFenceV1,
  ChapterSettlementKeyV1,
  ChapterSettlementSourcePort,
  ChapterSettlementSourceV1,
  ContentOwnedChapterPolicyPort,
  SettleChapterCommandV1,
} from "./types";

const digest = (label: string): string => sha256Canonical({ label });

class MemorySourcePort implements ChapterSettlementSourcePort {
  reads = 0;

  constructor(
    private readonly source: ChapterSettlementSourceV1,
    private readonly trace: string[],
  ) {}

  async readSealedSource(
    _key: Readonly<ChapterSettlementKeyV1>,
  ): Promise<ChapterSettlementSourceV1> {
    this.reads += 1;
    this.trace.push("source.read");
    return structuredClone(this.source);
  }
}

class DeterministicContentPolicy implements ContentOwnedChapterPolicyPort {
  calls = 0;

  constructor(
    private readonly trace: string[],
    private readonly reverseAuthorityArrays = false,
  ) {}

  async evaluateChapter(
    input: Parameters<ContentOwnedChapterPolicyPort["evaluateChapter"]>[0],
  ): Promise<B0ChapterPolicyEvaluationDraftV1> {
    this.calls += 1;
    this.trace.push("policy.evaluate");
    const chapterId = input.b0Input.wireInput.chapterId;
    const actionId = input.b0Input.wireInput.sealedDecisionActionIds[0]!;
    const factRef = `fact.chapter.${chapterId}.complete`;
    const seatArcDeltas = PRESSURE_CHAPTER_SEAT_IDS_V1.map((seatId) => ({
      seatId,
      delta: {
        seatId,
        beforeStateHash: input.baseWorldState.seatArcs[seatId].stateHash,
        afterState: seatArcState(seatId, `${chapterId}_FROZEN`, 1),
        sourceRefs: [actionId],
      } as unknown as B0ChapterSeatArcDeltaV1["delta"],
    }));
    const carryBase = {
      nextChapterId: nextChapterId(chapterId),
      unlockedContentRefs:
        chapterId === "N7" ? [] : [`content.${nextChapterId(chapterId)}`],
      unresolvedCommitmentRefs: [],
      pendingConsequenceRefs: [`consequence.${chapterId}`],
    };
    const draft: B0ChapterPolicyEvaluationDraftV1 = {
      schemaVersion: "b0_chapter_policy_evaluation_v1",
      b0InputHash: input.b0Input.b0InputHash,
      contentPolicyVersion: input.b0Input.wireInput.contentPolicyVersion,
      contentPolicyHash: input.b0Input.wireInput.contentPolicyHash,
      resourceDispositions: [
        { commitmentId: `commitment-${chapterId}`, disposition: "CONSUMED" },
      ],
      mutations: [
        {
          mutationId: `mutation-${chapterId}-complete`,
          entityType: "WORLD",
          entityId: factRef,
          attribute: "canonical.fact",
          operation: "SET",
          value: { before: false, after: true },
          originActionIds: [actionId],
        },
      ],
      seatArcDeltas,
      trackDelta: { civilian_land: 1 },
      carryForward: {
        ...carryBase,
        carryForwardHash: sha256Canonical(carryBase),
      },
      causalEdges: [
        {
          edgeId: `edge-${chapterId}-complete`,
          fromActionIds: [actionId],
          toMutationIds: [`mutation-${chapterId}-complete`],
          relation: "ENABLES",
          evidenceRefs: ["evidence.edict"],
        },
      ],
    };
    if (!this.reverseAuthorityArrays) return draft;
    return {
      ...draft,
      resourceDispositions: [...draft.resourceDispositions].reverse(),
      mutations: [...draft.mutations].reverse(),
      seatArcDeltas: [...draft.seatArcDeltas].reverse(),
      causalEdges: [...draft.causalEdges].reverse(),
    };
  }
}

class MemoryAtomicCommitter implements AtomicChapterCommitterPort {
  private readonly records = new Map<string, AtomicChapterCommitRecordV1>();
  readCalls = 0;
  commitCalls = 0;
  physicalWrites = 0;
  failBeforeCommitOnce = false;
  crashAfterCommitOnce = false;

  constructor(private readonly trace: string[]) {}

  async readCommitted(key: Readonly<ChapterSettlementKeyV1>) {
    this.readCalls += 1;
    this.trace.push("commit.read");
    const record = this.records.get(keyString(key));
    return record ? structuredClone(record) : null;
  }

  async commitOnce(record: Readonly<AtomicChapterCommitRecordV1>) {
    this.commitCalls += 1;
    this.trace.push("commit.once");
    const key = keyString(record);
    const existing = this.records.get(key);
    if (existing) {
      if (
        existing.idempotencyKey !== record.idempotencyKey ||
        existing.requestFingerprint !== record.requestFingerprint ||
        existing.atomicRecordHash !== record.atomicRecordHash
      ) {
        throw new Error("SIMULATED_ATOMIC_FINGERPRINT_CONFLICT");
      }
      return {
        status: "ALREADY_COMMITTED" as const,
        record: structuredClone(existing),
      };
    }
    if (this.failBeforeCommitOnce) {
      this.failBeforeCommitOnce = false;
      throw new Error("SIMULATED_SERIALIZABLE_ROLLBACK");
    }
    this.records.set(key, structuredClone(record));
    this.physicalWrites += 1;
    if (this.crashAfterCommitOnce) {
      this.crashAfterCommitOnce = false;
      throw new Error("SIMULATED_CRASH_AFTER_COMMIT_BEFORE_ACK");
    }
    return { status: "COMMITTED" as const, record: structuredClone(record) };
  }

  get size(): number {
    return this.records.size;
  }

  stored(key: ChapterSettlementKeyV1): AtomicChapterCommitRecordV1 | null {
    const record = this.records.get(keyString(key));
    return record ? structuredClone(record) : null;
  }
}

function fixture(
  chapterId: ChapterIdV1 = "N1",
  drift: Partial<{
    lifecycleState: ChapterCloseFenceV1["lifecycleState"];
    observedWorkingRevision: number;
    observedWorkingStateHash: string;
    observedDecisionLedgerHash: string;
    observedActionCount: number;
    observedWorldSequence: number;
    observedWorldStateHash: string;
  }> = {},
): ChapterSettlementSourceV1 {
  const runId = `run-${chapterId.toLowerCase()}`;
  const chapterRuntimeId = `chapter-runtime-${chapterId.toLowerCase()}`;
  const sequence = chapterSequence(chapterId);
  const baseWorldState = worldState(chapterId);
  const actionId = `action-${chapterId}`;
  const material = {
    seats: PRESSURE_CHAPTER_SEAT_IDS_V1.map((seatId, index) =>
      index === 0
        ? {
            seatId,
            requirement: "REQUIRED" as const,
            completion: "SEALED_ACTIONS" as const,
            defaultCodes: [],
          }
        : {
            seatId,
            requirement: "NOT_REQUIRED" as const,
            completion: "NOT_REQUIRED" as const,
            defaultCodes: [],
          },
    ),
    resources: [{ resourceId: "grain", quantity: 10, version: 0 }],
    actions: [
      {
        actionId,
        decisionPointId: `decision-${chapterId}`,
        seatId: PRESSURE_CHAPTER_SEAT_IDS_V1[0],
        source: "HUMAN" as const,
        actionType: "SUPPORT_EDICT",
        payload: { choice: "support" },
        resourceCommitments: [
          {
            commitmentId: `commitment-${chapterId}`,
            reservationKey: `reservation-${chapterId}`,
            resourceId: "grain",
            amount: 2,
            expectedResourceVersion: 0,
          },
        ],
        evidenceRefs: ["evidence.edict"],
      },
    ],
  };
  const inputBase = {
    schemaVersion: "sangtian_chapter_settlement_input_v1" as const,
    runId,
    chapterRuntimeId,
    chapterId,
    baseWorldSequence: sequence - 1,
    baseWorldStateHash: baseWorldState.stateHash,
    runRouteHash: digest(`route-${runId}`),
    previousFrozenHash: digest(`previous-frozen-${chapterId}`),
    decisionLedgerHash: digest(`decision-ledger-${chapterId}`),
    finalWorkingStateHash: digest(`working-state-${chapterId}`),
    sealedDecisionActionIds: [actionId],
    reservationLedgerHash: digest(`reservation-ledger-${chapterId}`),
    contentPolicyVersion: "sangtian-chapter-policy-v1",
    contentPolicyHash: digest("sangtian-chapter-policy-v1"),
    settlementContractVersion: "pressure-settlement-contract-v1",
    settlementContractHash: digest("pressure-settlement-contract-v1"),
  };
  const sealedInput = {
    ...inputBase,
    inputHash: sha256Canonical(inputBase),
  };
  const closeFence = sealChapterCloseFenceV1({
    schemaVersion: "pressure_chapter_close_fence_v1",
    runId,
    chapterRuntimeId,
    chapterId,
    lifecycleState: drift.lifecycleState ?? "CHAPTER_SETTLING",
    closedWorkingRevision: 4,
    observedWorkingRevision: drift.observedWorkingRevision ?? 4,
    closedWorkingStateHash: inputBase.finalWorkingStateHash,
    observedWorkingStateHash:
      drift.observedWorkingStateHash ?? inputBase.finalWorkingStateHash,
    closedDecisionLedgerHash: inputBase.decisionLedgerHash,
    observedDecisionLedgerHash:
      drift.observedDecisionLedgerHash ?? inputBase.decisionLedgerHash,
    closedActionCount: 1,
    observedActionCount: drift.observedActionCount ?? 1,
    baseWorldSequenceAtClose: sequence - 1,
    observedWorldSequence: drift.observedWorldSequence ?? sequence - 1,
    baseWorldStateHashAtClose: baseWorldState.stateHash,
    observedWorldStateHash:
      drift.observedWorldStateHash ?? baseWorldState.stateHash,
    runRouteHashAtClose: inputBase.runRouteHash,
    previousFrozenHashAtClose: inputBase.previousFrozenHash,
    reservationLedgerHashAtClose: inputBase.reservationLedgerHash,
    contentPolicyVersionAtClose: inputBase.contentPolicyVersion,
    contentPolicyHashAtClose: inputBase.contentPolicyHash,
    settlementContractVersionAtClose: inputBase.settlementContractVersion,
    settlementContractHashAtClose: inputBase.settlementContractHash,
  });
  return sealChapterSettlementSourceV1({
    schemaVersion: "pressure_chapter_settlement_source_v1",
    closeFence,
    sealedInput,
    settlementMaterial: material,
    baseWorldState,
  });
}

function commandFor(
  source: ChapterSettlementSourceV1,
  idempotencyKey = `settle:${source.sealedInput.runId}:${source.sealedInput.chapterId}`,
): SettleChapterCommandV1 {
  return {
    authorityTrigger: "CHAPTER_CLOSE",
    runId: source.sealedInput.runId,
    chapterRuntimeId: source.sealedInput.chapterRuntimeId,
    idempotencyKey,
    requestFingerprint: computeChapterSettlementRequestFingerprintV1({
      runId: source.sealedInput.runId,
      chapterRuntimeId: source.sealedInput.chapterRuntimeId,
      idempotencyKey,
      sealedInputHash: source.sealedInput.inputHash,
    }),
  };
}

function harness(
  source: ChapterSettlementSourceV1,
  reversePolicyArrays = false,
) {
  const trace: string[] = [];
  const sourcePort = new MemorySourcePort(source, trace);
  const policy = new DeterministicContentPolicy(trace, reversePolicyArrays);
  const committer = new MemoryAtomicCommitter(trace);
  const orchestrator = new ChapterSettlementOrchestrator(
    sourcePort,
    policy,
    committer,
  );
  return { trace, sourcePort, policy, committer, orchestrator };
}

test("PC-W6 commits canonical settlement authority once and N1 schedules only N2", async () => {
  const source = fixture("N1");
  const state = harness(source);
  const result = await state.orchestrator.settle(commandFor(source));
  const record = result.record;

  assert.equal(result.status, "COMMITTED");
  assert.deepEqual(state.trace, [
    "commit.read",
    "source.read",
    "policy.evaluate",
    "commit.once",
  ]);
  assert.equal(state.policy.calls, 1);
  assert.equal(state.committer.commitCalls, 1);
  assert.equal(state.committer.physicalWrites, 1);
  assert.equal(record.commitFence.expectedWorldSequence, 0);
  assert.equal(record.frozenChapterBundle.committedWorldSequence, 1);
  assert.equal(record.frozenChapterBundle.frozenWorldState.worldSequence, 1);
  assert.equal(record.worldDelta.resourceMutations[0]?.before, 10);
  assert.equal(record.worldDelta.resourceMutations[0]?.after, 8);
  assert.equal(record.settlement.seatArcDeltas.length, 6);
  assert.equal(Object.keys(record.frozenChapterBundle.frozenWorldState.tracks.values).length, 5);
  assert.equal(record.rootEvent.eventType, "CHAPTER_FROZEN");
  assert.equal(record.outbox.taskType, "OPEN_CHAPTER");
  assert.deepEqual(record.outbox.target, { kind: "NEXT_CHAPTER", chapterId: "N2" });
  assert.equal(record.receipt.outboxDedupeKeys.length, 1);
});

test("PC-W6 N7 advances 6 to 7 and schedules only Finale", async () => {
  const source = fixture("N7");
  const state = harness(source);
  const result = await state.orchestrator.settle(commandFor(source));

  assert.equal(result.record.receipt.baseWorldSequence, 6);
  assert.equal(result.record.receipt.committedWorldSequence, 7);
  assert.equal(result.record.frozenChapterBundle.frozenWorldState.worldSequence, 7);
  assert.equal(result.record.outbox.taskType, "COMPUTE_FINALE");
  assert.deepEqual(result.record.outbox.target, { kind: "FINALE", chapterId: null });
});

test("PC-W6 same key/fingerprint replays durable commit without source or policy", async () => {
  const source = fixture("N2");
  const state = harness(source);
  const command = commandFor(source);
  const first = await state.orchestrator.settle(command);
  state.trace.length = 0;
  const replay = await state.orchestrator.settle(command);

  assert.equal(first.status, "COMMITTED");
  assert.equal(replay.status, "REPLAYED");
  assert.equal(replay.record.atomicRecordHash, first.record.atomicRecordHash);
  assert.deepEqual(state.trace, ["commit.read"]);
  assert.equal(state.sourcePort.reads, 1);
  assert.equal(state.policy.calls, 1);
  assert.equal(state.committer.commitCalls, 1);
});

test("PC-W6 committed chapter rejects key/fingerprint mismatch before policy", async () => {
  const source = fixture("N3");
  const state = harness(source);
  await state.orchestrator.settle(commandFor(source));
  const differentFingerprint = {
    ...commandFor(source),
    requestFingerprint: digest("different-settlement-fingerprint"),
  };

  await assert.rejects(
    state.orchestrator.settle(differentFingerprint),
    hasCode(CHAPTER_SETTLEMENT_ERROR_CODES.CHAPTER_SETTLEMENT_FINGERPRINT_MISMATCH),
  );
  await assert.rejects(
    state.orchestrator.settle(commandFor(source, "settle:different-key")),
    hasCode(CHAPTER_SETTLEMENT_ERROR_CODES.CHAPTER_SETTLEMENT_FINGERPRINT_MISMATCH),
  );
  assert.equal(state.sourcePort.reads, 1);
  assert.equal(state.policy.calls, 1);
  assert.equal(state.committer.physicalWrites, 1);
});

test("PC-W6 guards reject open chapter, revision drift, post-close action and world drift with zero writes", async () => {
  const cases: Array<{
    name: string;
    source: ChapterSettlementSourceV1;
    code: string;
  }> = [
    {
      name: "open",
      source: fixture("N1", { lifecycleState: "CHAPTER_ACTIVE" }),
      code: CHAPTER_SETTLEMENT_ERROR_CODES.CHAPTER_NOT_CLOSED,
    },
    {
      name: "working revision",
      source: fixture("N1", { observedWorkingRevision: 5 }),
      code: CHAPTER_SETTLEMENT_ERROR_CODES.WORKING_REVISION_MISMATCH,
    },
    {
      name: "new action count",
      source: fixture("N1", { observedActionCount: 2 }),
      code: CHAPTER_SETTLEMENT_ERROR_CODES.POST_CLOSE_ACTION_DETECTED,
    },
    {
      name: "new ledger head",
      source: fixture("N1", {
        observedDecisionLedgerHash: digest("post-close-action"),
      }),
      code: CHAPTER_SETTLEMENT_ERROR_CODES.POST_CLOSE_ACTION_DETECTED,
    },
    {
      name: "world sequence",
      source: fixture("N1", { observedWorldSequence: 1 }),
      code: CHAPTER_SETTLEMENT_ERROR_CODES.WORLD_SEQUENCE_MISMATCH,
    },
    {
      name: "world hash",
      source: fixture("N1", { observedWorldStateHash: digest("stale-world") }),
      code: CHAPTER_SETTLEMENT_ERROR_CODES.WORLD_STATE_HASH_MISMATCH,
    },
  ];

  for (const entry of cases) {
    const state = harness(entry.source);
    await assert.rejects(
      state.orchestrator.settle(commandFor(entry.source)),
      hasCode(entry.code),
      entry.name,
    );
    assert.equal(state.policy.calls, 0, entry.name);
    assert.equal(state.committer.commitCalls, 0, entry.name);
    assert.equal(state.committer.size, 0, entry.name);
  }
});

test("PC-W6 rejects a Beat trigger before any authority port is touched", async () => {
  const source = fixture("N1");
  const state = harness(source);
  const beatCommand = {
    ...commandFor(source),
    authorityTrigger: "BEAT",
  } as unknown as SettleChapterCommandV1;

  await assert.rejects(
    state.orchestrator.settle(beatCommand),
    hasCode(CHAPTER_SETTLEMENT_ERROR_CODES.INVALID_COMMAND),
  );
  assert.deepEqual(state.trace, []);
  assert.equal(state.committer.physicalWrites, 0);
});

test("PC-W6 serializable failure leaves zero half-write and deterministic retry commits", async () => {
  const source = fixture("N4");
  const state = harness(source);
  const command = commandFor(source);
  state.committer.failBeforeCommitOnce = true;

  await assert.rejects(
    state.orchestrator.settle(command),
    /SIMULATED_SERIALIZABLE_ROLLBACK/,
  );
  assert.equal(state.committer.size, 0);
  assert.equal(state.committer.physicalWrites, 0);

  const retry = await state.orchestrator.settle(command);
  assert.equal(retry.status, "COMMITTED");
  assert.equal(state.committer.size, 1);
  assert.equal(state.committer.physicalWrites, 1);
  assert.equal(retry.record.receipt.committedWorldSequence, 4);
});

test("PC-W6 crash after commit recovers receipt without rerunning policy or sequence", async () => {
  const source = fixture("N5");
  const state = harness(source);
  const command = commandFor(source);
  state.committer.crashAfterCommitOnce = true;

  await assert.rejects(
    state.orchestrator.settle(command),
    /SIMULATED_CRASH_AFTER_COMMIT_BEFORE_ACK/,
  );
  assert.equal(state.committer.size, 1);
  assert.equal(state.committer.physicalWrites, 1);
  assert.equal(state.policy.calls, 1);

  const recovered = await state.orchestrator.settle(command);
  assert.equal(recovered.status, "REPLAYED");
  assert.equal(recovered.record.receipt.committedWorldSequence, 5);
  assert.equal(state.policy.calls, 1);
  assert.equal(state.committer.commitCalls, 1);
  assert.equal(state.committer.physicalWrites, 1);
});

test("PC-W6 concurrent identical workers yield one physical settlement/bundle/outbox", async () => {
  const source = fixture("N6");
  const state = harness(source);
  const command = commandFor(source);
  const results = await Promise.all([
    state.orchestrator.settle(command),
    state.orchestrator.settle(command),
  ]);

  assert.deepEqual(
    results.map((result) => result.status).sort(),
    ["COMMITTED", "REPLAYED"],
  );
  assert.equal(results[0]!.record.atomicRecordHash, results[1]!.record.atomicRecordHash);
  assert.equal(state.committer.size, 1);
  assert.equal(state.committer.physicalWrites, 1);
  assert.equal(state.committer.stored(source.sealedInput)?.receipt.committedWorldSequence, 6);
});

test("PC-W6 authority hashes are invariant to source and policy array permutations", async () => {
  const canonicalSource = fixture("N2");
  const permutedSource = sealChapterSettlementSourceV1({
    schemaVersion: canonicalSource.schemaVersion,
    closeFence: structuredClone(canonicalSource.closeFence),
    sealedInput: structuredClone(canonicalSource.sealedInput),
    settlementMaterial: {
      seats: [...canonicalSource.settlementMaterial.seats].reverse(),
      resources: [...canonicalSource.settlementMaterial.resources].reverse(),
      actions: [...canonicalSource.settlementMaterial.actions].reverse(),
    },
    baseWorldState: structuredClone(canonicalSource.baseWorldState),
  });
  const canonical = harness(canonicalSource);
  const permuted = harness(permutedSource, true);
  const left = await canonical.orchestrator.settle(commandFor(canonicalSource));
  const right = await permuted.orchestrator.settle(commandFor(permutedSource));

  assert.equal(permutedSource.sourceHash, canonicalSource.sourceHash);
  assert.equal(right.record.sealedInput.inputHash, left.record.sealedInput.inputHash);
  assert.equal(right.record.settlement.evaluationHash, left.record.settlement.evaluationHash);
  assert.equal(
    right.record.frozenChapterBundle.bundleHash,
    left.record.frozenChapterBundle.bundleHash,
  );
  assert.equal(right.record.receipt.commitHash, left.record.receipt.commitHash);
  assert.equal(right.record.atomicRecordHash, left.record.atomicRecordHash);
});

function worldState(chapterId: ChapterIdV1): WorldStateV1 {
  const trackBase = {
    schemaVersion: "sangtian_track_state_v1" as const,
    values: Object.fromEntries(
      TRACK_IDS_V1.map((trackId) => [trackId, 0]),
    ) as Record<TrackIdV1, number>,
  };
  const tracks: TrackStateV1 = {
    ...trackBase,
    stateHash: sha256Canonical(trackBase),
  };
  const knowledgeBySeat = Object.fromEntries(
    PRESSURE_CHAPTER_SEAT_IDS_V1.map((seatId) => {
      const base = {
        seatId,
        knownFactRefs: ["fact.public.sangtian_edict"],
        secretRefs: [`secret.${seatId}.initial`],
        disclosedToSeatIds: [] as SeatIdV1[],
      };
      return [seatId, { ...base, stateHash: sha256Canonical(base) }];
    }),
  ) as unknown as Record<SeatIdV1, KnowledgeStateV1>;
  const seatArcs = Object.fromEntries(
    PRESSURE_CHAPTER_SEAT_IDS_V1.map((seatId) => [
      seatId,
      seatArcState(seatId, `${chapterId}_OPEN`, 0),
    ]),
  ) as unknown as Record<SeatIdV1, SeatArcStateV1>;
  const worldBase = {
    schemaVersion: "sangtian_world_state_v1" as const,
    worldSequence: chapterSequence(chapterId) - 1,
    factValues: {
      "fact.public.sangtian_edict": true,
      [`fact.chapter.${chapterId}.complete`]: false,
    },
    resources: { grain: 10 },
    tracks,
    objects: [],
    knowledgeBySeat,
    evidence: [],
    responsibilities: [],
    seatArcs,
  };
  return { ...worldBase, stateHash: sha256Canonical(worldBase) } as WorldStateV1;
}

function seatArcState(
  seatId: SeatIdV1,
  arcStage: string,
  progress: number,
): SeatArcStateV1 {
  const base = {
    seatId,
    arcStage,
    publicGoalProgress: progress,
    privateGoalProgress: progress,
    gainRefs: progress ? [`gain.${seatId}`] : [],
    lossRefs: [],
    costRefs: [],
  };
  return { ...base, stateHash: sha256Canonical(base) };
}

function keyString(key: ChapterSettlementKeyV1): string {
  return `${key.runId}\0${key.chapterRuntimeId}`;
}

function hasCode(code: string): (error: unknown) => boolean {
  return (error: unknown) =>
    error instanceof ChapterSettlementError && error.code === code;
}
