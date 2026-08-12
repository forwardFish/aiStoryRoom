import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import {
  CHAPTER_IDS_V1,
  PRESSURE_CHAPTER_SEAT_IDS_V1,
  TRACK_IDS_V1,
  computeFinaleExecutionFingerprint,
  computeFinaleSemanticOutcomeHash,
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
  compileSangtianContentFinalePolicyV1,
  evaluateSangtianPressureFinaleV1,
} from "@ai-story/templates";
import {
  PRESSURE_GENERIC_SHADOW_ERROR_CODES_V1,
  PressureGenericFinaleShadowReadOnlyAdapterV1,
  PressureGenericShadowEvaluationErrorV1,
  evaluatePressureGenericShadowCandidateV1,
  evaluatePressureGenericShadowComparisonV1,
  observePressureGenericShadowV1,
} from "./index";

const DECIDED_AT = "2026-08-12T00:00:00.000Z";
const FINAL_TRACKS: Record<TrackIdV1, number> = {
  civilian_land: 3,
  mulberry_silk: 0,
  fiscal_military: -3,
  evidence_responsibility: 0,
  court_imperial_face: 3,
};
const FINAL_CAUSAL_EDGE: CausalEdgeV1 = {
  causeRef: "fact.grain-delivered",
  effectRef: "track.civilian_land",
  relation: "SUPPORTS",
  evidenceRefs: ["evidence.grain-ledger"],
};

test("Pressure Generic shadow independently produces a matching candidate and comparison", async () => {
  const { input, policy } = fixture();
  const authoritative = evaluateSangtianPressureFinaleV1({
    input,
    policy,
    decidedAt: DECIDED_AT,
    idempotencyKey: buildSangtianFinaleIdempotencyKeyV1({
      inputHash: input.inputHash,
      policyHash: policy.policyHash,
      decidedAt: DECIDED_AT,
    }),
  });
  const inputBefore = structuredClone(input);
  const authorityBefore = structuredClone(authoritative);
  const evaluated = evaluatePressureGenericShadowComparisonV1({
    finaleInput: input,
    sourceInputHash: input.inputHash,
    authoritativeDecision: authoritative,
  });

  assert.equal(evaluated.comparison.matches, true);
  assert.equal(evaluated.candidate.sourceInputHash, input.inputHash);
  assert.equal(evaluated.candidate.worldOutcomeId, "CIVIL_RELIEF_AT_WAR_COST");
  assert.deepEqual(
    evaluated.candidate.seatVerdicts,
    authoritative.seats.map(({ seatId, verdict }) => ({ seatId, verdict })),
  );
  assert.equal(evaluated.candidate.semanticOutcomeHash, authoritative.semanticOutcomeHash);
  assert.equal(Object.isFrozen(evaluated.candidate), true);
  assert.deepEqual(input, inputBefore);
  assert.deepEqual(authoritative, authorityBefore);

  const adapter = new PressureGenericFinaleShadowReadOnlyAdapterV1();
  assert.deepEqual(
    await adapter.evaluateShadow({ finaleInput: input, authoritativeDecision: authoritative }),
    evaluated.candidate,
  );
  assert.deepEqual(
    Object.getOwnPropertyNames(PressureGenericFinaleShadowReadOnlyAdapterV1.prototype),
    ["constructor", "evaluateShadow"],
  );
});

test("candidate evaluator is independent from the authoritative evaluator and rule catalog", () => {
  const source = readFileSync(
    join(__dirname, "evaluator.ts"),
    "utf8",
  );
  assert.doesNotMatch(source, /evaluateSangtianPressureFinaleV1/u);
  assert.doesNotMatch(source, /SANGTIAN_WORLD_OUTCOME_RULES_V1/u);
  assert.doesNotMatch(source, /SANGTIAN_SEAT_VERDICT_RULES_V1/u);
  const candidateBody = source.slice(
    source.indexOf("export function evaluatePressureGenericShadowCandidateV1"),
    source.indexOf("export function evaluatePressureGenericShadowComparisonV1"),
  );
  assert.doesNotMatch(candidateBody, /authoritativeDecision/u);
  assert.doesNotMatch(candidateBody, /compareGenericFinaleShadowV1/u);
});

test("same frozen input is deterministic and sourceInputHash is an exact fence", () => {
  const { input } = fixture();
  const first = evaluatePressureGenericShadowCandidateV1({
    finaleInput: input,
    sourceInputHash: input.inputHash,
  });
  for (let index = 0; index < 50; index += 1) {
    assert.deepEqual(evaluatePressureGenericShadowCandidateV1({
      finaleInput: structuredClone(input),
      sourceInputHash: input.inputHash,
    }), first);
  }
  assert.throws(
    () => evaluatePressureGenericShadowCandidateV1({
      finaleInput: input,
      sourceInputHash: digest("foreign-input"),
    }),
    (error: unknown) => {
      assert.ok(error instanceof PressureGenericShadowEvaluationErrorV1);
      assert.equal(
        error.code,
        PRESSURE_GENERIC_SHADOW_ERROR_CODES_V1.SOURCE_INPUT_HASH_MISMATCH,
      );
      return true;
    },
  );
});

test("candidate mismatch is observational and every evaluation failure stays isolated", () => {
  const { input, policy } = fixture();
  const authoritative = evaluateSangtianPressureFinaleV1({
    input,
    policy,
    decidedAt: DECIDED_AT,
    idempotencyKey: buildSangtianFinaleIdempotencyKeyV1({
      inputHash: input.inputHash,
      policyHash: policy.policyHash,
      decidedAt: DECIDED_AT,
    }),
  });
  const divergentAuthority = structuredClone(authoritative);
  divergentAuthority.worldOutcome = {
    outcomeId: "GENERIC_COMPARISON_PROBE",
    titleKey: "finale.world.GENERIC_COMPARISON_PROBE.title",
    verdictLineKey: "finale.world.GENERIC_COMPARISON_PROBE.verdict_line",
  };
  divergentAuthority.semanticOutcomeHash = computeFinaleSemanticOutcomeHash(divergentAuthority);
  divergentAuthority.executionFingerprint = computeFinaleExecutionFingerprint(divergentAuthority);
  const mismatch = evaluatePressureGenericShadowComparisonV1({
    finaleInput: input,
    sourceInputHash: input.inputHash,
    authoritativeDecision: divergentAuthority,
  });
  assert.equal(mismatch.comparison.matches, false);
  assert.match(
    mismatch.comparison.mismatches.map((item) => item.code).join("|"),
    /WORLD_OUTCOME_MISMATCH|SEMANTIC_OUTCOME_HASH_MISMATCH/u,
  );

  const authoritativeBefore = structuredClone(authoritative);
  const isolated = observePressureGenericShadowV1({
    finaleInput: input,
    sourceInputHash: "not-a-hash",
    authoritativeDecision: authoritative,
  });
  assert.deepEqual(isolated, {
    status: "FAILED_ISOLATED",
    candidate: null,
    comparison: null,
    errorCode: PRESSURE_GENERIC_SHADOW_ERROR_CODES_V1.SOURCE_INPUT_HASH_INVALID,
  });
  assert.deepEqual(authoritative, authoritativeBefore);
});

function fixture() {
  const policy = compileSangtianContentFinalePolicyV1({
    contentPackageVersion: "sangtian-content-1.0.0",
    contentPackageSha256: digest("sangtian-content"),
  });
  const genesisHash = digest("genesis");
  const bundles = frozenBundles(genesisHash);
  const withoutHash = {
    schemaVersion: "sangtian_finale_input_v1" as const,
    runId: "run-generic-shadow-1",
    routeHash: digest("route"),
    runSeed: "seed-generic-shadow-1",
    genesisHash,
    frozenChapterBundles: bundles,
    finalWorldState: bundles[6]!.frozenWorldState,
    causalEdges: [FINAL_CAUSAL_EDGE],
    policyVersion: policy.policyVersion,
    policyHash: policy.policyHash,
  };
  return {
    input: {
      ...withoutHash,
      inputHash: sha256Canonical(withoutHash),
    } as SangtianFinaleInputV1,
    policy,
  };
}

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
      runId: "run-generic-shadow-1",
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

function worldState(sequence: number): WorldStateV1 {
  const values = Object.fromEntries(TRACK_IDS_V1.map((trackId) => [
    trackId,
    sequence === 7 ? FINAL_TRACKS[trackId] : 0,
  ])) as Record<TrackIdV1, number>;
  const tracks = withHash({
    schemaVersion: "sangtian_track_state_v1" as const,
    values,
  }, "stateHash");
  const knowledgeBySeat = Object.fromEntries(PRESSURE_CHAPTER_SEAT_IDS_V1.map((seatId) => [
    seatId,
    withHash({
      seatId,
      knownFactRefs: ["fact.grain-delivered"],
      secretRefs: [`secret.${seatId}`],
      disclosedToSeatIds: [],
    }, "stateHash"),
  ]));
  const seatArcs = Object.fromEntries(PRESSURE_CHAPTER_SEAT_IDS_V1.map((seatId) => [
    seatId,
    withHash({
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
    }, "stateHash"),
  ])) as WorldStateV1["seatArcs"];
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
  }, "stateHash") as unknown as WorldStateV1;
}

function withHash<T extends Record<string, unknown>, K extends string>(
  value: T,
  field: K,
): T & Record<K, string> {
  return { ...value, [field]: sha256Canonical(value) } as T & Record<K, string>;
}

function digest(label: string): string {
  return sha256Canonical({ label });
}
