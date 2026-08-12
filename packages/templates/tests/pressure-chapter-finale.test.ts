import assert from "node:assert/strict";
import test from "node:test";
import {
  CHAPTER_IDS_V1,
  PRESSURE_CHAPTER_SEAT_IDS_V1,
  TRACK_IDS_V1,
  hashWithoutField,
  nextChapterId,
  sha256Canonical,
  type CausalEdgeV1,
  type FrozenChapterBundleV1,
  type SangtianFinaleInputV1,
  type SeatIdV1,
  type TrackIdV1,
  type WorldStateV1,
} from "@ai-story/shared";
import {
  buildSangtianFinaleIdempotencyKeyV1,
  compareGenericFinaleShadowV1,
  compileSangtianContentFinalePolicyV1,
  evaluateSangtianPressureFinaleV1,
  rehashSangtianFinalePolicyV1,
  validateSangtianOwnedFinalePolicyV1,
  type GenericFinaleShadowCandidateV1,
  type SangtianFinaleEvaluationRequestV1,
} from "../src/pressure-chapter/finale";

const DECIDED_AT = "2026-08-12T00:00:00.000Z";
const digest = (label: string): string => sha256Canonical({ label });

function withHash<T extends Record<string, unknown>, K extends string>(
  value: T,
  field: K,
): T & Record<K, string> {
  return { ...value, [field]: sha256Canonical(value) } as T & Record<K, string>;
}

const FINAL_TRACKS: Record<TrackIdV1, number> = {
  civilian_land: 3,
  mulberry_silk: 0,
  fiscal_military: -3,
  evidence_responsibility: 0,
  court_imperial_face: 3,
};

function worldState(sequence: number): WorldStateV1 {
  const values = Object.fromEntries(TRACK_IDS_V1.map((trackId) => [
    trackId,
    sequence === 7 ? FINAL_TRACKS[trackId] : 0,
  ])) as Record<TrackIdV1, number>;
  const tracks = withHash({
    schemaVersion: "sangtian_track_state_v1" as const,
    values,
  }, "stateHash");
  const knowledgeBySeat = Object.fromEntries(
    PRESSURE_CHAPTER_SEAT_IDS_V1.map((seatId) => [seatId, withHash({
      seatId,
      knownFactRefs: ["fact.grain-delivered"],
      secretRefs: [`secret.${seatId}`],
      disclosedToSeatIds: [],
    }, "stateHash")]),
  );
  const seatArcs = Object.fromEntries(
    PRESSURE_CHAPTER_SEAT_IDS_V1.map((seatId) => [seatId, withHash({
      seatId,
      arcStage: `stage-${sequence}`,
      publicGoalProgress: sequence,
      privateGoalProgress: sequence,
      gainRefs: sequence === 7 ? [`gain.${seatId}`] : [],
      lossRefs: sequence === 7 && seatId === "cabinet_finance"
        ? ["loss.cabinet_finance"]
        : [],
      costRefs: sequence === 7 && seatId === "qingliu_law"
        ? ["cost.qingliu_law"]
        : [],
    }, "stateHash")]),
  ) as WorldStateV1["seatArcs"];
  return withHash({
    schemaVersion: "sangtian_world_state_v1" as const,
    worldSequence: sequence,
    factValues: {
      "fact.grain-delivered": true,
      "fact.public-order": sequence === 7 ? "STABLE" : "UNRESOLVED",
    },
    resources: { grain: Math.max(0, 7 - sequence), silver: 12 },
    tracks,
    objects: sequence === 7 ? [{
      objectId: "grain-ledger",
      version: 7,
      stateCode: "SEALED",
      holderSeatId: "cabinet_finance" as SeatIdV1,
      quantity: null,
      tags: ["ledger"],
      factRefs: ["fact.grain-delivered"],
    }] : [],
    knowledgeBySeat,
    evidence: sequence === 7 ? [{
      evidenceId: "evidence.grain-ledger",
      version: 1,
      status: "ACTIVE" as const,
      holderSeatIds: ["cabinet_finance", "qingliu_law"] as SeatIdV1[],
      supportsFactRefs: ["fact.grain-delivered"],
      visibilityPolicyRef: "visibility.related-seats",
    }] : [],
    responsibilities: sequence === 7 ? [{
      responsibilityId: "responsibility.cabinet-finance",
      subjectSeatId: "cabinet_finance" as SeatIdV1,
      sourceFactRefs: ["fact.fiscal-shortfall"],
      level: 2,
      status: "ACKNOWLEDGED" as const,
    }] : [],
    seatArcs,
  }, "stateHash") as WorldStateV1;
}

const FINAL_CAUSAL_EDGE: CausalEdgeV1 = {
  causeRef: "fact.grain-delivered",
  effectRef: "track.civilian_land",
  relation: "SUPPORTS",
  evidenceRefs: ["evidence.grain-ledger"],
};

function frozenBundles(genesisHash: string): FrozenChapterBundleV1[] {
  const bundles: FrozenChapterBundleV1[] = [];
  let previousFrozenHash = genesisHash;
  for (const [index, chapterId] of CHAPTER_IDS_V1.entries()) {
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
      runId: "run-finale-1",
      chapterId,
      chapterSequence: sequence as 1 | 2 | 3 | 4 | 5 | 6 | 7,
      baseWorldSequence: sequence - 1,
      committedWorldSequence: sequence,
      previousFrozenHash,
      decisionLedgerHash: digest(`decision-ledger-${sequence}`),
      finalWorkingStateHash: digest(`working-state-${sequence}`),
      settlementPolicyVersion: "sangtian-chapter-settlement-1.0.0",
      worldDelta: { factMutations: [], resourceMutations: [] },
      committedWorldStateHash: world.stateHash,
      frozenWorldState: world,
      causalEdges: sequence === 7 ? [FINAL_CAUSAL_EDGE] : [],
      carryForward,
    }, "bundleHash") as FrozenChapterBundleV1;
    bundles.push(bundle);
    previousFrozenHash = bundle.bundleHash;
  }
  return bundles;
}

function fixture() {
  const policy = compileSangtianContentFinalePolicyV1({
    contentPackageVersion: "sangtian-content-1.0.0",
    contentPackageSha256: digest("sangtian-content"),
  });
  const genesisHash = digest("genesis");
  const bundles = frozenBundles(genesisHash);
  const inputWithoutHash = {
    schemaVersion: "sangtian_finale_input_v1" as const,
    runId: "run-finale-1",
    routeHash: digest("route"),
    runSeed: "seed-finale-1",
    genesisHash,
    frozenChapterBundles: bundles,
    finalWorldState: bundles[6]!.frozenWorldState,
    causalEdges: [FINAL_CAUSAL_EDGE],
    policyVersion: policy.policyVersion,
    policyHash: policy.policyHash,
  };
  const input = {
    ...inputWithoutHash,
    inputHash: sha256Canonical(inputWithoutHash),
  } as SangtianFinaleInputV1;
  return { input, policy };
}

function evaluationRequest(
  input: SangtianFinaleInputV1,
  policy = fixture().policy,
  decidedAt = DECIDED_AT,
): SangtianFinaleEvaluationRequestV1 {
  return {
    input,
    policy,
    decidedAt,
    idempotencyKey: buildSangtianFinaleIdempotencyKeyV1({
      inputHash: input.inputHash,
      policyHash: policy.policyHash,
      decidedAt,
    }),
  };
}

function rehashInput(input: SangtianFinaleInputV1): void {
  input.inputHash = hashWithoutField(
    input as unknown as Record<string, unknown>,
    "inputHash",
  );
}

test("content-owned policy compiles one deterministic world outcome and six seat verdicts", () => {
  const { input, policy } = fixture();
  const decision = evaluateSangtianPressureFinaleV1(evaluationRequest(input, policy));

  assert.equal(decision.worldOutcome.outcomeId, "CIVIL_RELIEF_AT_WAR_COST");
  assert.deepEqual(
    decision.tracks.map((track) => [track.trackId, track.level]),
    [
      ["civilian_land", "HIGH"],
      ["mulberry_silk", "MID"],
      ["fiscal_military", "LOW"],
      ["evidence_responsibility", "MID"],
      ["court_imperial_face", "HIGH"],
    ],
  );
  assert.deepEqual(
    Object.fromEntries(decision.seats.map((seat) => [seat.seatId, seat.verdict])),
    {
      cabinet_finance: "LOSS",
      jiangnan_merchant: "LOSS",
      qingliu_law: "COSTLY_WIN",
      sili_weaving: "COSTLY_WIN",
      zhejiang_administration: "WIN",
      zhejiang_governor: "LOSS",
    },
  );
  assert.deepEqual(decision.seats.map((seat) => seat.seatId), PRESSURE_CHAPTER_SEAT_IDS_V1);
  assert.equal(decision.seats.every((seat) => seat.causeRefs.length > 0), true);
  assert.equal(decision.tracks.every((track) => track.evidenceRefs.length > 0), true);
  assert.match(decision.semanticOutcomeHash, /^[a-f0-9]{64}$/u);
  assert.match(decision.executionFingerprint, /^[a-f0-9]{64}$/u);
});

test("Finale rejects an incomplete, reordered, or broken Frozen chain", () => {
  const { input, policy } = fixture();
  const missing = structuredClone(input);
  missing.frozenChapterBundles.splice(3, 1);
  rehashInput(missing);
  assert.throws(
    () => evaluateSangtianPressureFinaleV1(evaluationRequest(missing, policy)),
    /CONTRACT_SEQUENCE_MISMATCH/u,
  );

  const reordered = structuredClone(input);
  [reordered.frozenChapterBundles[1], reordered.frozenChapterBundles[2]] = [
    reordered.frozenChapterBundles[2]!,
    reordered.frozenChapterBundles[1]!,
  ];
  rehashInput(reordered);
  assert.throws(
    () => evaluateSangtianPressureFinaleV1(evaluationRequest(reordered, policy)),
    /CONTRACT_(?:REFERENCE|SEQUENCE)_MISMATCH/u,
  );
});

test("N8 and chapterSequence 8 are forbidden before Finale evaluation", () => {
  const { input, policy } = fixture();
  const n8 = structuredClone(input) as unknown as Record<string, any>;
  n8.frozenChapterBundles[6].chapterId = "N8";
  rehashInput(n8 as unknown as SangtianFinaleInputV1);
  assert.throws(
    () => evaluateSangtianPressureFinaleV1(
      evaluationRequest(n8 as unknown as SangtianFinaleInputV1, policy),
    ),
    /CONTRACT_FIELD_INVALID/u,
  );

  const sequence8 = structuredClone(input) as unknown as Record<string, any>;
  sequence8.frozenChapterBundles[6].chapterSequence = 8;
  rehashInput(sequence8 as unknown as SangtianFinaleInputV1);
  assert.throws(
    () => evaluateSangtianPressureFinaleV1(
      evaluationRequest(sequence8 as unknown as SangtianFinaleInputV1, policy),
    ),
    /CONTRACT_FIELD_INVALID/u,
  );
});

test("an illegal seventh seat fails closed in the Frozen world", () => {
  const { input, policy } = fixture();
  const broken = structuredClone(input) as unknown as Record<string, any>;
  const illegalArc = {
    seatId: "imperial_provider",
    arcStage: "stage-7",
    publicGoalProgress: 7,
    privateGoalProgress: 7,
    gainRefs: [],
    lossRefs: [],
    costRefs: [],
    stateHash: digest("illegal-seat"),
  };
  broken.frozenChapterBundles[6].frozenWorldState.seatArcs.imperial_provider = illegalArc;
  broken.finalWorldState.seatArcs.imperial_provider = illegalArc;
  rehashInput(broken as unknown as SangtianFinaleInputV1);
  assert.throws(
    () => evaluateSangtianPressureFinaleV1(
      evaluationRequest(broken as unknown as SangtianFinaleInputV1, policy),
    ),
    /CONTRACT_UNKNOWN_FIELD/u,
  );
});

test("canonical record insertion order cannot change the authoritative decision", () => {
  const { input, policy } = fixture();
  const permuted = structuredClone(input);
  const n7World = permuted.frozenChapterBundles[6]!.frozenWorldState;
  n7World.factValues = Object.fromEntries(Object.entries(n7World.factValues).reverse());
  n7World.resources = Object.fromEntries(Object.entries(n7World.resources).reverse());
  n7World.knowledgeBySeat = Object.fromEntries(
    Object.entries(n7World.knowledgeBySeat).reverse(),
  ) as WorldStateV1["knowledgeBySeat"];
  n7World.seatArcs = Object.fromEntries(
    Object.entries(n7World.seatArcs).reverse(),
  ) as WorldStateV1["seatArcs"];
  permuted.finalWorldState = structuredClone(n7World);

  assert.equal(permuted.inputHash, input.inputHash);
  const originalDecision = evaluateSangtianPressureFinaleV1(evaluationRequest(input, policy));
  const permutedDecision = evaluateSangtianPressureFinaleV1(
    evaluationRequest(permuted, policy),
  );
  assert.deepEqual(permutedDecision, originalDecision);
});

test("the same idempotency key is deterministic and cannot be reused for another timestamp", () => {
  const { input, policy } = fixture();
  const request = evaluationRequest(input, policy);
  const first = evaluateSangtianPressureFinaleV1(request);
  const replay = evaluateSangtianPressureFinaleV1(structuredClone(request));
  assert.deepEqual(replay, first);

  assert.throws(
    () => evaluateSangtianPressureFinaleV1({
      ...request,
      decidedAt: "2026-08-12T00:00:01.000Z",
    }),
    /SANGTIAN_FINALE_IDEMPOTENCY_KEY_MISMATCH/u,
  );
});

test("unknown content rules and Provider decision fields cannot enter authority", () => {
  const { input, policy } = fixture();
  const foreignPolicy = structuredClone(policy);
  foreignPolicy.compiledRules.worldOutcomeRuleRefs[0] = "world.00.provider_override";
  foreignPolicy.compiledRules.worldOutcomeRuleRefs.sort();
  const rehashed = rehashSangtianFinalePolicyV1(foreignPolicy);
  assert.throws(
    () => validateSangtianOwnedFinalePolicyV1(rehashed),
    /SANGTIAN_FINALE_RULE_CATALOG_MISMATCH/u,
  );

  const request = evaluationRequest(input, policy) as unknown as Record<string, unknown>;
  request.providerDecision = { worldOutcomeId: "AUTO_WIN" };
  assert.throws(
    () => evaluateSangtianPressureFinaleV1(
      request as unknown as SangtianFinaleEvaluationRequestV1,
    ),
    /CONTRACT_UNKNOWN_FIELD/u,
  );
});

test("Generic shadow mismatch is reported without changing the authoritative decision", () => {
  const { input, policy } = fixture();
  const decision = evaluateSangtianPressureFinaleV1(evaluationRequest(input, policy));
  const before = structuredClone(decision);
  const matching: GenericFinaleShadowCandidateV1 = {
    schemaVersion: "generic_finale_shadow_candidate_v1",
    shadowEngineVersion: "generic-shadow-v3",
    sourceInputHash: input.inputHash,
    worldOutcomeId: decision.worldOutcome.outcomeId,
    seatVerdicts: decision.seats.map((seat) => ({
      seatId: seat.seatId,
      verdict: seat.verdict,
    })),
    semanticOutcomeHash: decision.semanticOutcomeHash,
  };
  assert.equal(compareGenericFinaleShadowV1(decision, input, matching).matches, true);

  const mismatchCandidate: GenericFinaleShadowCandidateV1 = {
    ...matching,
    sourceInputHash: digest("other-input"),
    worldOutcomeId: "GENERIC_OVERRIDE",
    semanticOutcomeHash: digest("generic-outcome"),
    seatVerdicts: [
      ...matching.seatVerdicts.map((seat, index) => ({
        ...seat,
        verdict: index === 0 ? "WIN" : seat.verdict,
      })),
      { seatId: "generic_seventh_seat", verdict: "WIN" },
    ],
  };
  const report = compareGenericFinaleShadowV1(decision, input, mismatchCandidate);
  assert.equal(report.matches, false);
  assert.match(report.mismatches.map((item) => item.code).join("|"), /WORLD_OUTCOME_MISMATCH/u);
  assert.match(report.mismatches.map((item) => item.code).join("|"), /SHADOW_UNKNOWN_SEAT/u);
  assert.match(report.mismatches.map((item) => item.code).join("|"), /SEMANTIC_OUTCOME_HASH_MISMATCH/u);
  assert.deepEqual(decision, before);
  assert.equal("decision" in report, false);
});
