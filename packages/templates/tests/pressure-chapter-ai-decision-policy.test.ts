import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  compareCanonicalText,
  hashWithoutField,
  sha256Canonical,
} from "@ai-story/shared";
import { loadSangtianPressureChapterPackageV1 } from "../src/pressure-chapter/content/loader";
import {
  SangtianAiDecisionPolicyError,
  loadPublishedSangtianAiDecisionPolicyV1,
  validateSangtianAiDecisionPolicyV1,
} from "../src/pressure-chapter/release/ai-decision-policy";
import type { SangtianAiDecisionPolicyInputV1 } from "../src/pressure-chapter/release/types";

const PACKAGE_ROOT = path.resolve(
  __dirname,
  "../config/sangtian/pressure-chapter-v1",
);
const RELEASE_ROOT = path.resolve(PACKAGE_ROOT, "release");

test("published AI policy exactly covers 33 accepted decisions and 145 applicable seats", () => {
  const published = loadPublishedSangtianAiDecisionPolicyV1();
  const loaded = loadSangtianPressureChapterPackageV1(PACKAGE_ROOT);
  assert.equal(
    published.policy.policySha256,
    hashWithoutField(published.policy, "policySha256"),
  );
  assert.equal(published.policy.decisions.length, 33);
  assert.equal(
    published.policy.decisions.reduce(
      (count, decision) => count + decision.seatPolicies.length,
      0,
    ),
    145,
  );
  assert.deepEqual(published.policy.authorityBoundary.selectionEntropyFields, [
    "runSeed",
    "chapterId",
    "decisionPointId",
    "seatId",
  ]);
  assert.deepEqual(published.policy.authorityBoundary.forbiddenInputClasses, [
    "FREE_TEXT",
    "MUTABLE_WORKING_STATE",
    "NARRATIVE_ARTIFACT",
    "PROVIDER_OUTPUT",
    "UI_PROJECTION",
  ]);
  assert.equal(published.policy.authorityBoundary.mayCreateActionTypes, false);
  assert.equal(published.policy.authorityBoundary.mayCompileWorkingIntent, false);
  assert.equal(published.policy.authorityBoundary.maySupplySettlementFacts, false);
  assert.deepEqual(
    published.policy.authorityBoundary.contextualHumanOnlyActionTypes,
    ["CONFIRM_LEDGER_SOURCE_WITH_EVIDENCE", "INVESTIGATE_LEDGER_SOURCE"],
  );
  assert.equal(
    published.policy.authorityBoundary.noNonDefaultCandidatePolicy,
    "DEFAULT_PASS_ONLY",
  );

  const accepted = loaded.content.chapters.flatMap((chapter) =>
    chapter.decisionPoints.map((decision) => ({ chapter, decision })),
  );
  accepted.forEach(({ chapter, decision }, decisionIndex) => {
    const configured = published.policy.decisions[decisionIndex]!;
    assert.equal(configured.chapterId, chapter.chapterId);
    assert.equal(configured.decisionPointId, decision.decisionPointKey);
    assert.deepEqual(
      configured.publishedAllowedActionTypes,
      decision.allowedActionTypes,
    );
    assert.deepEqual(
      configured.seatPolicies.map((seat) => seat.seatId),
      decision.requiredSeatIds,
    );
    const ranked = decision.allowedActionTypes.filter(
      (actionType) => actionType !== "DEFAULT_PASS"
        && !published.policy.authorityBoundary.contextualHumanOnlyActionTypes.includes(
          actionType as "CONFIRM_LEDGER_SOURCE_WITH_EVIDENCE" | "INVESTIGATE_LEDGER_SOURCE",
        ),
    );
    configured.seatPolicies.forEach((seat) => {
      assert.deepEqual(seat.rankedNonDefaultActionTypes, ranked);
      assert.equal(seat.rankedNonDefaultActionTypes.includes("DEFAULT_PASS"), false);
    });
  });
});

test("selection is deterministic, eligible, non-default when possible and structurally port-compatible", () => {
  const published = loadPublishedSangtianAiDecisionPolicyV1();
  let selectionCount = 0;
  for (const decision of published.policy.decisions) {
    for (const seat of decision.seatPolicies) {
      selectionCount += 1;
      const input = buildInput({
        runSeed: "seed-fixed",
        chapterId: decision.chapterId,
        decisionPointId: decision.decisionPointId,
        seatId: seat.seatId,
        eligibleActionTypes: decision.publishedAllowedActionTypes,
      });
      const first = published.select(input);
      const replay = published.select(structuredClone(input));
      assert.deepEqual(replay, first);
      assert.deepEqual(Object.keys(first), [
        "schemaVersion",
        "policyRef",
        "policyVersion",
        "policyHash",
        "resolvedContentPackageVersion",
        "resolvedContentPackageSha256",
        "inputHash",
        "actionType",
        "selectionHash",
      ]);
      assert.equal(first.policyHash, published.artifactSha256);
      assert.equal(first.inputHash, input.inputHash);
      assert.equal(input.eligibleActionTypes.includes(first.actionType), true);
      assert.notEqual(first.actionType, "DEFAULT_PASS");
      const { selectionHash, ...body } = first;
      assert.equal(selectionHash, sha256Canonical(body));
    }
  }
  assert.equal(selectionCount, 145);

  const variableDecision = published.policy.decisions.find(
    (decision) => decision.publishedAllowedActionTypes.length > 2,
  )!;
  const variableSeat = variableDecision.seatPolicies[0]!;
  const choices = new Set(
    Array.from({ length: 64 }, (_, index) => published.select(buildInput({
      runSeed: `seed-${index}`,
      chapterId: variableDecision.chapterId,
      decisionPointId: variableDecision.decisionPointId,
      seatId: variableSeat.seatId,
      eligibleActionTypes: variableDecision.publishedAllowedActionTypes,
    })).actionType),
  );
  assert.equal(choices.size > 1, true);
});

test("input drift, inapplicable seats, unknown fields and artifact tampering fail closed", (t) => {
  const published = loadPublishedSangtianAiDecisionPolicyV1();
  const decision = published.policy.decisions.find(
    (candidate) => candidate.decisionPointId === "N2.memorial_draft",
  )!;
  const base = buildInput({
    runSeed: "seed-fail-closed",
    chapterId: decision.chapterId,
    decisionPointId: decision.decisionPointId,
    seatId: decision.seatPolicies[0]!.seatId,
    eligibleActionTypes: decision.publishedAllowedActionTypes,
  });
  assertPolicyCode(
    () => published.select({
      ...base,
      eligibleActionTypes: base.eligibleActionTypes.slice(1),
      inputHash: rehashInput({ ...base, eligibleActionTypes: base.eligibleActionTypes.slice(1) }),
    }),
    "SANGTIAN_AI_DECISION_ELIGIBLE_SET_MISMATCH",
  );
  assertPolicyCode(
    () => published.select({
      ...base,
      seatId: "jiangnan_merchant",
      inputHash: rehashInput({ ...base, seatId: "jiangnan_merchant" }),
    }),
    "SANGTIAN_AI_DECISION_BINDING_NOT_FOUND",
  );
  assertPolicyCode(
    () => published.select({ ...base, freeText: "invent an action" } as never),
    "SANGTIAN_AI_DECISION_POLICY_INVALID",
  );
  assertPolicyCode(
    () => published.select({ ...base, inputHash: sha256Canonical("wrong") }),
    "SANGTIAN_AI_DECISION_INPUT_HASH_MISMATCH",
  );

  const invalidPolicy = structuredClone(published.policy) as Record<string, unknown>;
  invalidPolicy.providerPrompt = "forbidden";
  assertPolicyCode(
    () => validateSangtianAiDecisionPolicyV1(invalidPolicy),
    "SANGTIAN_AI_DECISION_POLICY_INVALID",
  );

  const temporaryRoot = mkdtempSync(path.join(tmpdir(), "sangtian-ai-policy-"));
  const copiedReleaseRoot = path.join(temporaryRoot, "release");
  t.after(() => rmSync(temporaryRoot, { recursive: true, force: true }));
  cpSync(RELEASE_ROOT, copiedReleaseRoot, { recursive: true });
  const policyPath = path.join(copiedReleaseRoot, "ai-decision-policy.json");
  const tampered = JSON.parse(readFileSync(policyPath, "utf8"));
  tampered.decisions[0].seatPolicies[0].rankedNonDefaultActionTypes.reverse();
  writeFileSync(policyPath, JSON.stringify(tampered, null, 2));
  assertPolicyCode(
    () => loadPublishedSangtianAiDecisionPolicyV1({ releaseRoot: copiedReleaseRoot }),
    "SANGTIAN_AI_DECISION_ARTIFACT_HASH_MISMATCH",
  );
});

function buildInput(input: Readonly<{
  runSeed: string;
  chapterId: SangtianAiDecisionPolicyInputV1["chapterId"];
  decisionPointId: string;
  seatId: SangtianAiDecisionPolicyInputV1["seatId"];
  eligibleActionTypes: readonly string[];
}>): SangtianAiDecisionPolicyInputV1 {
  const body = {
    schemaVersion: "sangtian_ai_decision_policy_input_v1" as const,
    runId: "run-ai-policy",
    routeHash: sha256Canonical("route-ai-policy"),
    runSeed: input.runSeed,
    contentPackageVersion: "1.0.2",
    contentPackageSha256:
    "9e195a3443853c928b44c0f9d58568427c23946cb601c65adf866fa8e9e738d4",
    chapterRuntimeId: `runtime-${input.chapterId}`,
    chapterId: input.chapterId,
    decisionPointId: input.decisionPointId,
    seatId: input.seatId,
    eligibleActionTypes: [...input.eligibleActionTypes].sort(compareCanonicalText),
  };
  return { ...body, inputHash: sha256Canonical(body) };
}

function rehashInput(
  value: SangtianAiDecisionPolicyInputV1,
): string {
  const { inputHash: _inputHash, ...body } = value;
  return sha256Canonical(body);
}

function assertPolicyCode(action: () => unknown, code: string): void {
  assert.throws(action, (error: unknown) => (
    error instanceof SangtianAiDecisionPolicyError && error.code === code
  ));
}
