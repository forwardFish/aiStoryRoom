import assert from "node:assert/strict";
import {
  cpSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  PRESSURE_CHAPTER_SEAT_IDS_V1,
  compareCanonicalText,
  hashWithoutField,
  sha256Canonical,
  type SeatIdV1,
} from "@ai-story/shared";
import { loadSangtianPressureChapterPackageV1 } from "../src/pressure-chapter/content/loader";
import {
  SangtianAiDecisionPolicyError,
  compileSangtianAiDecisionSelectionV1,
  loadPublishedSangtianAiDecisionPolicyV1,
  validateSangtianAiDecisionPolicyV1,
  validateSangtianNpcIdentityDecisionPolicyV1,
} from "../src/pressure-chapter/release/ai-decision-policy";
import type {
  PublishedSangtianAiDecisionPolicyV1,
  SangtianAiDecisionPolicyInputV1,
  SangtianAiDecisionPolicySelectionV1,
  SangtianAiDecisionPolicyV1,
  SangtianNpcActionRuleV1,
  SangtianNpcDecisionPolicyInputV1,
  SangtianNpcDecisionResolutionV1,
  SangtianNpcIdentitySeatProfileV1,
} from "../src/pressure-chapter/release/types";

const PACKAGE_ROOT = path.resolve(
  __dirname,
  "../config/sangtian/pressure-chapter-v1",
);
const RELEASE_ROOT = path.resolve(PACKAGE_ROOT, "release");
const POLICY_SOURCE = path.resolve(
  __dirname,
  "../src/pressure-chapter/release/ai-decision-policy.ts",
);
const TYPES_SOURCE = path.resolve(
  __dirname,
  "../src/pressure-chapter/release/types.ts",
);
const CONTENT_SHA =
  "9627adc458a88384dd3c80b22e66ca952e51393ea12197666be82f0bd0ea30d9";
const IDENTITY_ARTIFACT_SHA =
  "5f399a4496d76c3728be74e74c146f7edeab7ac29e4bb7c8a14de687512ff00e";
const SEATS = [...PRESSURE_CHAPTER_SEAT_IDS_V1];

type Decision = SangtianAiDecisionPolicyV1["decisions"][number];
type BuildNpcOptions = Readonly<{
  decision: Decision;
  seatId: SeatIdV1;
  targetActionType: string;
  runSeed?: string;
  controllerMode?: "HUMAN_ACTIVE" | "AI_ACTIVE";
  requiresResolution?: boolean;
  activatePressure?: boolean;
  pressureTag?: string;
  useWorkingDelta?: boolean;
  includeAuthority?: boolean;
  includeCapability?: boolean;
  includeResources?: boolean;
  includeActiveCommitment?: boolean;
}>;

test("published identity policy is hash-bound, generic, complete, and Provider-free", () => {
  const published = loadPublishedSangtianAiDecisionPolicyV1();
  const loaded = loadSangtianPressureChapterPackageV1(PACKAGE_ROOT);
  assert.equal(
    published.policy.policySha256,
    hashWithoutField(published.policy, "policySha256"),
  );
  assert.equal(
    published.identityPolicy.policySha256,
    hashWithoutField(published.identityPolicy, "policySha256"),
  );
  assert.equal(published.identityPolicyArtifactSha256, IDENTITY_ARTIFACT_SHA);
  assert.equal(published.policy.decisions.length, 33);
  assert.equal(
    published.policy.decisions.reduce(
      (count, decision) => count + decision.seatPolicies.length,
      0,
    ),
    142,
  );
  assert.equal(published.identityPolicy.seatProfiles.length, 6);
  assert.equal(published.identityPolicy.actionRules.length, 58);
  assert.deepEqual(
    Object.keys(published.identityPolicy.authorityBoundary),
    [
      "providerCallCount",
      "mayCreateActionTypes",
      "mayCompileWorkingIntent",
      "maySupplySettlementFacts",
    ],
  );
  assert.equal(published.identityPolicy.authorityBoundary.providerCallCount, 0);
  assert.equal(
    published.identityPolicy.legacyBindingPolicy.retainedRole,
    "ELIGIBLE_ACTION_AND_REQUIRED_SEAT_BINDING_ONLY",
  );
  assert.equal(
    published.identityPolicy.coverage.decisionReachabilityCoverage,
    "EVERY_PUBLISHED_DECISION_HAS_REQUIRED_SEAT_WITH_REACHABLE_NON_DEFAULT_ACTION",
  );

  const rawIdentity = JSON.parse(readFileSync(
    path.resolve(RELEASE_ROOT, "npc-identity-decision-policy.json"),
    "utf8",
  )) as unknown;
  assert.equal(sha256Canonical(rawIdentity), IDENTITY_ARTIFACT_SHA);

  const expectedActions = [...new Set(
    published.policy.decisions.flatMap((decision) =>
      decision.seatPolicies.flatMap((seat) => seat.rankedNonDefaultActionTypes),
    ),
  )].sort(compareCanonicalText);
  assert.deepEqual(
    published.identityPolicy.actionRules.map((rule) => rule.actionType),
    expectedActions,
  );
  assert.deepEqual(
    published.identityPolicy.seatProfiles.map((profile) => profile.seatId),
    SEATS,
  );
  for (const rule of published.identityPolicy.actionRules) {
    assert.equal(Object.hasOwn(rule, "chapterId"), false);
    assert.equal(Object.hasOwn(rule, "decisionPointId"), false);
  }

  const accepted = loaded.content.chapters.flatMap((chapter) =>
    chapter.decisionPoints.map((decision) => ({ chapter, decision })),
  );
  assert.equal(accepted.length, 33);
  accepted.forEach(({ chapter, decision }, index) => {
    const binding = published.policy.decisions[index]!;
    assert.equal(binding.chapterId, chapter.chapterId);
    assert.equal(binding.decisionPointId, decision.decisionPointKey);
    assert.deepEqual(binding.publishedAllowedActionTypes, decision.allowedActionTypes);
    assert.deepEqual(
      binding.seatPolicies.map((seat) => seat.seatId),
      decision.requiredSeatIds,
    );
  });
});

test("legacy authority-incomplete input returns only the legacy fail-closed selection contract", () => {
  const published = loadPublishedSangtianAiDecisionPolicyV1();
  const decision = published.policy.decisions[0]!;
  const seat = decision.seatPolicies[0]!;
  const input = buildLegacyInput(decision, seat.seatId, "legacy-seed");
  const first = published.select(input);
  const replay = published.select(structuredClone(input));
  assert.deepEqual(replay, first);
  assert.equal(first.schemaVersion, "sangtian_ai_decision_policy_selection_v1");
  assert.equal(first.actionType, "DEFAULT_PASS");
  assert.equal(Object.hasOwn(first, "resolutionReason"), false);
  assert.equal(Object.hasOwn(first, "identityPolicyRef"), false);
  assert.equal(Object.hasOwn(first, "resolutionHash"), false);
  assertLegacySelectionHash(first);

  const changedSeed = published.select(
    buildLegacyInput(decision, seat.seatId, "another-seed"),
  );
  assert.equal(changedSeed.schemaVersion, "sangtian_ai_decision_policy_selection_v1");
  assert.equal(changedSeed.actionType, "DEFAULT_PASS");
});

test("legacy selection and NPC-aware resolution have distinct contract identities", () => {
  const published = loadPublishedSangtianAiDecisionPolicyV1();
  const decision = published.policy.decisions[0]!;
  const compatible = findCompatibleResolution(published, decision)!;
  const legacy = published.select(
    buildLegacyInput(decision, compatible.seatId, "schema-legacy"),
  );
  const npc = published.select(buildNpcInput(published, {
    decision,
    seatId: compatible.seatId,
    targetActionType: compatible.rule.actionType,
    runSeed: "schema-npc",
  }));

  assert.equal(legacy.schemaVersion, "sangtian_ai_decision_policy_selection_v1");
  assert.equal(npc.schemaVersion, "sangtian_npc_decision_resolution_v1");
  assert.notEqual(legacy.schemaVersion, npc.schemaVersion);
  assert.equal(Object.hasOwn(legacy, "selectionHash"), true);
  assert.equal(Object.hasOwn(legacy, "resolutionHash"), false);
  assert.equal(Object.hasOwn(npc, "selectionHash"), false);
  assert.equal(Object.hasOwn(npc, "resolutionHash"), true);
  assert.equal(Object.hasOwn(legacy, "resolutionReason"), false);
  assert.equal(npc.resolutionReason, "SCORED_ACTION");
  assertLegacySelectionHash(legacy);
  assertResolutionHash(npc);
});

test("N1.B01-B08, all N2-N7 decisions, and all six identities resolve from authoritative context with zero Provider calls", () => {
  const published = loadPublishedSangtianAiDecisionPolicyV1();
  const seenChapters = new Set<string>();
  const seenSeats = new Set<SeatIdV1>();
  let n1DecisionCount = 0;

  for (const decision of published.policy.decisions) {
    const compatible = findCompatibleResolution(published, decision);
    assert.ok(compatible, `${decision.chapterId}:${decision.decisionPointId}`);
    const resolution = published.select(buildNpcInput(published, {
      decision,
      seatId: compatible.seatId,
      targetActionType: compatible.rule.actionType,
      runSeed: `fixture-${decision.decisionPointId}`,
    }));
    assert.equal(resolution.schemaVersion, "sangtian_npc_decision_resolution_v1");
    assert.notEqual(resolution.actionType, "DEFAULT_PASS");
    assert.equal(decision.publishedAllowedActionTypes.includes(resolution.actionType), true);
    assert.equal(resolution.providerCallCount, 0);
    assert.equal(resolution.resolutionReason, "SCORED_ACTION");
    assertResolutionHash(resolution);
    seenChapters.add(decision.chapterId);
    seenSeats.add(compatible.seatId);
    if (decision.chapterId === "N1") n1DecisionCount += 1;
  }

  assert.equal(n1DecisionCount, 8);
  assert.deepEqual([...seenChapters].sort(compareCanonicalText), [
    "N1", "N2", "N3", "N4", "N5", "N6", "N7",
  ]);

  for (const seatId of SEATS) {
    const compatible = findCompatibleResolutionForSeat(published, seatId);
    assert.ok(compatible, seatId);
    const resolution = published.select(buildNpcInput(published, {
      decision: compatible.decision,
      seatId,
      targetActionType: compatible.rule.actionType,
      runSeed: `six-seat-${seatId}`,
    }));
    assert.notEqual(resolution.actionType, "DEFAULT_PASS");
    assert.equal(resolution.providerCallCount, 0);
    seenSeats.add(seatId);
  }
  assert.deepEqual([...seenSeats].sort(compareCanonicalText), [...SEATS].sort(compareCanonicalText));
});

test("identity, facts, WorkingDelta, commitments, resources, capabilities, authority, and control all affect the result", () => {
  const published = loadPublishedSangtianAiDecisionPolicyV1();
  const weir = decisionById(published, "N1.weir_crisis");

  const law = published.select(buildNpcInput(published, {
    decision: weir,
    seatId: "qingliu_law",
    targetActionType: "SEAL_BREACH_RECORD",
    pressureTag: "EVIDENCE_GAP",
  }));
  assert.equal(law.actionType, "SEAL_BREACH_RECORD");
  assert.equal(law.tieBreakerUsed, false);

  const merchant = published.select(buildNpcInput(published, {
    decision: weir,
    seatId: "jiangnan_merchant",
    targetActionType: "EVACUATE_WEIRS",
    pressureTag: "FLOOD_RISK",
  }));
  assert.equal(merchant.actionType, "EVACUATE_WEIRS");
  assert.equal(merchant.tieBreakerUsed, false);

  const noTrigger = published.select(buildNpcInput(published, {
    decision: weir,
    seatId: "qingliu_law",
    targetActionType: "SEAL_BREACH_RECORD",
    activatePressure: false,
    includeActiveCommitment: false,
  }));
  assert.equal(noTrigger.actionType, "DEFAULT_PASS");
  assert.equal(noTrigger.resolutionReason, "NO_RESPONSIBILITY_TRIGGER");

  const workingDeltaTrigger = published.select(buildNpcInput(published, {
    decision: weir,
    seatId: "qingliu_law",
    targetActionType: "SEAL_BREACH_RECORD",
    pressureTag: "EVIDENCE_GAP",
    useWorkingDelta: true,
  }));
  assert.equal(workingDeltaTrigger.actionType, "SEAL_BREACH_RECORD");

  const commitmentTrigger = published.select(buildNpcInput(published, {
    decision: weir,
    seatId: "qingliu_law",
    targetActionType: "SEAL_BREACH_RECORD",
    activatePressure: false,
    includeActiveCommitment: true,
  }));
  assert.equal(commitmentTrigger.actionType, "SEAL_BREACH_RECORD");

  const humanControlled = published.select(buildNpcInput(published, {
    decision: weir,
    seatId: "qingliu_law",
    targetActionType: "SEAL_BREACH_RECORD",
    controllerMode: "HUMAN_ACTIVE",
  }));
  assert.equal(humanControlled.actionType, "DEFAULT_PASS");
  assert.equal(humanControlled.resolutionReason, "HUMAN_CONTROLLED");

  const alreadyResolved = published.select(buildNpcInput(published, {
    decision: weir,
    seatId: "qingliu_law",
    targetActionType: "SEAL_BREACH_RECORD",
    requiresResolution: false,
  }));
  assert.equal(alreadyResolved.actionType, "DEFAULT_PASS");
  assert.equal(alreadyResolved.resolutionReason, "RESOLUTION_NOT_REQUIRED");

  const relief = decisionById(published, "N3.relief_offer");
  const noAuthorityCapabilityOrResource = published.select(buildNpcInput(published, {
    decision: relief,
    seatId: "jiangnan_merchant",
    targetActionType: "ALLOCATE_GRAIN",
    pressureTag: "GRAIN_SHORTAGE",
    includeAuthority: false,
    includeCapability: false,
    includeResources: false,
  }));
  assert.equal(noAuthorityCapabilityOrResource.actionType, "DEFAULT_PASS");
  assert.equal(
    noAuthorityCapabilityOrResource.resolutionReason,
    "BELOW_ABSTAIN_THRESHOLD",
  );
  assert.equal(
    noAuthorityCapabilityOrResource.scoreBreakdown.some(
      (score) => score.resourceConflictPenalty < 0 && score.overreachPenalty < 0,
    ),
    true,
  );
});

test("SHA-256 is used only to break an exact highest-score tie", () => {
  const published = loadPublishedSangtianAiDecisionPolicyV1();
  const reconciliation = decisionById(published, "N1.order_reconciliation");
  const choices = new Set<string>();
  for (let index = 0; index < 64; index += 1) {
    const input = buildNpcInput(published, {
      decision: reconciliation,
      seatId: "qingliu_law",
      targetActionType: "PRESERVE_PARALLEL_ORDER_EVIDENCE",
      pressureTag: "ORDER_CONFLICT",
      runSeed: `tie-seed-${index}`,
    });
    const first = published.select(input);
    const replay = published.select(structuredClone(input));
    assert.deepEqual(replay, first);
    assert.equal(first.tieBreakerUsed, true);
    assert.equal(first.tiedActionTypes.length, 2);
    assert.ok(first.tieBreakerHash);
    assert.equal(first.tiedActionTypes.includes(first.actionType), true);
    assert.equal(
      first.scoreBreakdown
        .filter((score) => first.tiedActionTypes.includes(score.actionType))
        .every((score) => score.totalScore === first.topScore),
      true,
    );
    choices.add(first.actionType);
  }
  assert.deepEqual(
    [...choices].sort(compareCanonicalText),
    ["PRESERVE_PARALLEL_ORDER_EVIDENCE", "REVOKE_CONFLICTING_ORDER"],
  );

  const unique = published.select(buildNpcInput(published, {
    decision: decisionById(published, "N1.weir_crisis"),
    seatId: "qingliu_law",
    targetActionType: "SEAL_BREACH_RECORD",
    pressureTag: "EVIDENCE_GAP",
  }));
  assert.equal(unique.actionType, "SEAL_BREACH_RECORD");
  assert.equal(unique.tieBreakerUsed, false);
  assert.equal(unique.tieBreakerHash, null);
  assert.deepEqual(unique.tiedActionTypes, ["SEAL_BREACH_RECORD"]);
});

test("release JSON owns mutable NPC rules while fallback and tie behavior are code-only invariants", () => {
  const published = loadPublishedSangtianAiDecisionPolicyV1();
  const rawIdentity = JSON.parse(readFileSync(
    path.resolve(RELEASE_ROOT, "npc-identity-decision-policy.json"),
    "utf8",
  )) as { authorityBoundary: Record<string, unknown> };
  const removedBehaviorFields = [
    "humanControlledSeatPolicy",
    "missingAuthorityContextPolicy",
    "noResponsibilityTriggerPolicy",
    "belowThresholdPolicy",
    "tieBreakPolicy",
  ];
  assert.deepEqual(Object.keys(rawIdentity.authorityBoundary), [
    "providerCallCount",
    "mayCreateActionTypes",
    "mayCompileWorkingIntent",
    "maySupplySettlementFacts",
  ]);
  for (const field of removedBehaviorFields) {
    assert.equal(Object.hasOwn(rawIdentity.authorityBoundary, field), false, field);
  }

  const policySource = readFileSync(POLICY_SOURCE, "utf8");
  const typesSource = readFileSync(TYPES_SOURCE, "utf8");
  for (const field of removedBehaviorFields) {
    assert.doesNotMatch(policySource, new RegExp(`authorityBoundary\\.${field}`, "u"));
    assert.doesNotMatch(typesSource, new RegExp(`${field}:`, "u"));
  }

  const injectedBehaviorField = structuredClone(published.identityPolicy) as unknown as Record<
    string,
    unknown
  >;
  const injectedBoundary = injectedBehaviorField.authorityBoundary as Record<
    string,
    unknown
  >;
  injectedBoundary.humanControlledSeatPolicy = "NON_DEFAULT_ACTION";
  injectedBehaviorField.policySha256 = hashWithoutField(
    injectedBehaviorField,
    "policySha256",
  );
  assertPolicyCode(
    () => validateSangtianNpcIdentityDecisionPolicyV1(
      injectedBehaviorField,
      published.policy,
    ),
    "SANGTIAN_AI_DECISION_POLICY_INVALID",
  );

  assert.doesNotMatch(
    typesSource,
    /SangtianNpcDecisionResolutionV1\s*\n?extends\s+SangtianAiDecisionPolicySelectionV1/u,
  );

  const decision = decisionById(published, "N1.weir_crisis");
  const input = buildNpcInput(published, {
    decision,
    seatId: "qingliu_law",
    targetActionType: "SEAL_BREACH_RECORD",
    pressureTag: "EVIDENCE_GAP",
  });
  const baseline = published.select(input);
  const modifiedIdentity = structuredClone(published.identityPolicy);
  modifiedIdentity.scoring.activePressureWeight += 7;
  modifiedIdentity.policySha256 = hashWithoutField(
    modifiedIdentity,
    "policySha256",
  );
  const validatedIdentity = validateSangtianNpcIdentityDecisionPolicyV1(
    modifiedIdentity,
    published.policy,
  );
  const modified = compileSangtianAiDecisionSelectionV1(
    published.policy,
    published.artifactSha256,
    validatedIdentity,
    sha256Canonical(validatedIdentity),
    input,
  );
  assert.equal(modified.schemaVersion, "sangtian_npc_decision_resolution_v1");
  assert.equal(modified.topScore, (baseline.topScore ?? 0) + 7);
});

test("identity/input drift, inapplicable seats, unknown fields, and artifact tampering fail closed", (t) => {
  const published = loadPublishedSangtianAiDecisionPolicyV1();
  const decision = decisionById(published, "N2.memorial_draft");
  const compatible = findCompatibleResolution(published, decision)!;
  const base = buildNpcInput(published, {
    decision,
    seatId: compatible.seatId,
    targetActionType: compatible.rule.actionType,
  });

  const eligibleDrift = {
    ...base,
    eligibleActionTypes: base.eligibleActionTypes.slice(1),
  };
  assertPolicyCode(
    () => published.select({ ...eligibleDrift, inputHash: rehashInput(eligibleDrift) }),
    "SANGTIAN_AI_DECISION_ELIGIBLE_SET_MISMATCH",
  );
  assertPolicyCode(
    () => published.select({ ...base, freeText: "invent an action" } as never),
    "SANGTIAN_AI_DECISION_POLICY_INVALID",
  );
  assertPolicyCode(
    () => published.select({ ...base, inputHash: sha256Canonical("wrong") }),
    "SANGTIAN_AI_DECISION_INPUT_HASH_MISMATCH",
  );

  const identityDrift = {
    ...base,
    seatIdentity: {
      ...base.seatIdentity,
      identityProfileRef: "sangtian.identity.wrong.v1",
    },
  };
  assertPolicyCode(
    () => published.select({ ...identityDrift, inputHash: rehashInput(identityDrift) }),
    "SANGTIAN_AI_DECISION_IDENTITY_MISMATCH",
  );

  const invalidPolicy = structuredClone(published.policy) as unknown as Record<string, unknown>;
  invalidPolicy.providerPrompt = "forbidden";
  assertPolicyCode(
    () => validateSangtianAiDecisionPolicyV1(invalidPolicy),
    "SANGTIAN_AI_DECISION_POLICY_INVALID",
  );

  const unreachableIdentity = structuredClone(published.identityPolicy);
  const dispatchRule = unreachableIdentity.actionRules.find(
    (rule) => rule.actionType === "DISPATCH_MEMORIAL",
  );
  assert.ok(dispatchRule);
  const requiredResourceTags = new Set(
    dispatchRule.resourceRequirements.flatMap((requirement) =>
      requirement.resourceTags,
    ),
  );
  for (const profile of unreachableIdentity.seatProfiles) {
    profile.resourceStewardshipTags = profile.resourceStewardshipTags.filter(
      (tag) => !requiredResourceTags.has(tag),
    );
  }
  unreachableIdentity.policySha256 = hashWithoutField(
    unreachableIdentity,
    "policySha256",
  );
  assertPolicyCode(
    () => validateSangtianNpcIdentityDecisionPolicyV1(
      unreachableIdentity,
      published.policy,
    ),
    "SANGTIAN_AI_DECISION_IDENTITY_POLICY_INVALID",
  );

  const temporaryRoot = mkdtempSync(path.join(tmpdir(), "sangtian-npc-policy-"));
  const copiedReleaseRoot = path.join(temporaryRoot, "release");
  t.after(() => rmSync(temporaryRoot, { recursive: true, force: true }));
  cpSync(RELEASE_ROOT, copiedReleaseRoot, { recursive: true });
  const identityPath = path.join(copiedReleaseRoot, "npc-identity-decision-policy.json");
  const tampered = JSON.parse(readFileSync(identityPath, "utf8"));
  tampered.actionRules[0].baseScore += 1;
  writeFileSync(identityPath, JSON.stringify(tampered, null, 2));
  assertPolicyCode(
    () => loadPublishedSangtianAiDecisionPolicyV1({ releaseRoot: copiedReleaseRoot }),
    "SANGTIAN_AI_DECISION_ARTIFACT_HASH_MISMATCH",
  );

  const source = readFileSync(POLICY_SOURCE, "utf8");
  assert.doesNotMatch(source, /ranked\[Number\.parseInt/u);
  assert.doesNotMatch(source, /\b(?:Math\.random|Date\.now)\b/u);
  assert.doesNotMatch(source, /\bN[1-7]\.[A-Za-z0-9_]+\b/u);
  assert.doesNotMatch(source, /from\s+["'][^"']*(?:provider|deepseek)[^"']*["']/iu);
  assert.doesNotMatch(source, /\b(?:providerClient|deepseekClient)\b/iu);
});

function decisionById(
  published: PublishedSangtianAiDecisionPolicyV1,
  decisionPointId: string,
): Decision {
  const decision = published.policy.decisions.find(
    (candidate) => candidate.decisionPointId === decisionPointId,
  );
  assert.ok(decision, decisionPointId);
  return decision;
}

function findCompatibleResolution(
  published: PublishedSangtianAiDecisionPolicyV1,
  decision: Decision,
): { seatId: SeatIdV1; rule: SangtianNpcActionRuleV1 } | null {
  for (const seat of decision.seatPolicies) {
    const profile = profileBySeat(published, seat.seatId);
    for (const actionType of seat.rankedNonDefaultActionTypes) {
      const rule = ruleByAction(published, actionType);
      if (isCompatible(profile, rule)) return { seatId: seat.seatId, rule };
    }
  }
  return null;
}

function findCompatibleResolutionForSeat(
  published: PublishedSangtianAiDecisionPolicyV1,
  seatId: SeatIdV1,
): { decision: Decision; rule: SangtianNpcActionRuleV1 } | null {
  for (const decision of published.policy.decisions) {
    const binding = decision.seatPolicies.find((seat) => seat.seatId === seatId);
    if (!binding) continue;
    const profile = profileBySeat(published, seatId);
    for (const actionType of binding.rankedNonDefaultActionTypes) {
      const rule = ruleByAction(published, actionType);
      if (isCompatible(profile, rule)) return { decision, rule };
    }
  }
  return null;
}

function isCompatible(
  profile: SangtianNpcIdentitySeatProfileV1,
  rule: SangtianNpcActionRuleV1,
): boolean {
  return intersects(rule.responsibilityTags, profile.responsibilityTags)
    && (
      rule.requiredAuthorityAnyOf.length === 0
      || intersects(rule.requiredAuthorityAnyOf, profile.authorityTags)
    )
    && (
      rule.requiredCapabilityAnyOf.length === 0
      || intersects(rule.requiredCapabilityAnyOf, profile.capabilityAffinityTags)
    )
    && rule.resourceRequirements.every((requirement) =>
      intersects(requirement.resourceTags, profile.resourceStewardshipTags),
    );
}

function buildLegacyInput(
  decision: Decision,
  seatId: SeatIdV1,
  runSeed: string,
): SangtianAiDecisionPolicyInputV1 {
  const body = {
    schemaVersion: "sangtian_ai_decision_policy_input_v1" as const,
    runId: "run-ai-policy",
    routeHash: sha256Canonical("route-ai-policy"),
    runSeed,
    contentPackageVersion: "1.0.2",
    contentPackageSha256: CONTENT_SHA,
    chapterRuntimeId: `runtime-${decision.chapterId}`,
    chapterId: decision.chapterId,
    decisionPointId: decision.decisionPointId,
    seatId,
    eligibleActionTypes: [...decision.publishedAllowedActionTypes].sort(compareCanonicalText),
  };
  return { ...body, inputHash: sha256Canonical(body) };
}

function buildNpcInput(
  published: PublishedSangtianAiDecisionPolicyV1,
  options: BuildNpcOptions,
): SangtianNpcDecisionPolicyInputV1 {
  const profile = profileBySeat(published, options.seatId);
  const rule = ruleByAction(published, options.targetActionType);
  assert.equal(
    options.decision.publishedAllowedActionTypes.includes(rule.actionType),
    true,
  );
  const authorityTag = sharedTag(rule.requiredAuthorityAnyOf, profile.authorityTags);
  const capabilityTag = sharedTag(
    rule.requiredCapabilityAnyOf,
    profile.capabilityAffinityTags,
  );
  const commitmentTag = sharedTag(rule.commitmentTags, profile.commitmentAffinityTags);
  const pressureTag = options.pressureTag ?? rule.pressureTags[0]!;
  const activatePressure = options.activatePressure ?? true;
  const useWorkingDelta = options.useWorkingDelta ?? false;
  const includeAuthority = options.includeAuthority ?? true;
  const includeCapability = options.includeCapability ?? true;
  const includeResources = options.includeResources ?? true;
  const includeActiveCommitment = options.includeActiveCommitment ?? false;
  const controllerMode = options.controllerMode ?? "AI_ACTIVE";
  const requiresResolution = options.requiresResolution ?? true;

  const authoritativeFacts = activatePressure && !useWorkingDelta
    ? [{
        factRef: "fact.authoritative.trigger",
        state: "ACTIVE" as const,
        value: true,
        tags: [pressureTag],
      }]
    : [];
  const chapterWorkingDeltas = activatePressure && useWorkingDelta
    ? [{
        deltaRef: "delta.chapter.trigger",
        state: "ACTIVE" as const,
        value: true,
        tags: [pressureTag],
      }]
    : [];
  const commitments = includeActiveCommitment && commitmentTag
    ? [{
        commitmentId: "commitment.active",
        status: "ACTIVE" as const,
        tags: [commitmentTag],
      }]
    : [];
  const authorityGrants = includeAuthority && authorityTag
    ? [{ authorityId: "authority.active", enabled: true, tags: [authorityTag] }]
    : [];
  const capabilities = includeCapability && capabilityTag
    ? [{ capabilityId: "capability.active", enabled: true, tags: [capabilityTag] }]
    : [];
  const resources = includeResources
    ? rule.resourceRequirements.map((requirement, index) => {
        const tag = sharedTag(requirement.resourceTags, profile.resourceStewardshipTags)
          ?? requirement.resourceTags[0]!;
        return {
          resourceId: `resource.${String(index).padStart(2, "0")}`,
          available: requirement.amount,
          reserved: 0,
          tags: [tag],
        };
      })
    : [];

  const controllerAuthority = {
    mode: controllerMode,
    activeControllerId: `${controllerMode === "AI_ACTIVE" ? "ai" : "human"}-${options.seatId}`,
    controlEpoch: 1,
    authorityStateHash: sha256Canonical({
      seatId: options.seatId,
      controllerMode,
      requiresResolution,
      authorityGrants,
      capabilities,
    }),
    requiresResolution,
  };
  const seatIdentity = {
    identityProfileRef: profile.identityProfileRef,
    identityStateHash: sha256Canonical({
      seatId: options.seatId,
      identityProfileRef: profile.identityProfileRef,
    }),
  };
  const body = {
    schemaVersion: "sangtian_npc_decision_policy_input_v1" as const,
    runId: "run-npc-policy",
    routeHash: sha256Canonical("route-npc-policy"),
    runSeed: options.runSeed ?? "npc-seed",
    contentPackageVersion: "1.0.2",
    contentPackageSha256: CONTENT_SHA,
    chapterRuntimeId: `runtime-${options.decision.chapterId}`,
    chapterId: options.decision.chapterId,
    decisionPointId: options.decision.decisionPointId,
    seatId: options.seatId,
    eligibleActionTypes: [...options.decision.publishedAllowedActionTypes]
      .sort(compareCanonicalText),
    controllerAuthority,
    seatIdentity,
    authoritativeFacts: canonicalObjects(authoritativeFacts, "factRef"),
    chapterWorkingDeltas: canonicalObjects(chapterWorkingDeltas, "deltaRef"),
    commitments: canonicalObjects(commitments, "commitmentId"),
    resources: canonicalObjects(resources, "resourceId"),
    authorityGrants: canonicalObjects(authorityGrants, "authorityId"),
    capabilities: canonicalObjects(capabilities, "capabilityId"),
  };
  return { ...body, inputHash: sha256Canonical(body) };
}

function profileBySeat(
  published: PublishedSangtianAiDecisionPolicyV1,
  seatId: SeatIdV1,
): SangtianNpcIdentitySeatProfileV1 {
  const profile = published.identityPolicy.seatProfiles.find(
    (candidate) => candidate.seatId === seatId,
  );
  assert.ok(profile, seatId);
  return profile;
}

function ruleByAction(
  published: PublishedSangtianAiDecisionPolicyV1,
  actionType: string,
): SangtianNpcActionRuleV1 {
  const rule = published.identityPolicy.actionRules.find(
    (candidate) => candidate.actionType === actionType,
  );
  assert.ok(rule, actionType);
  return rule;
}

function canonicalObjects<T extends Record<string, unknown>>(
  values: readonly T[],
  key: keyof T,
): T[] {
  return values
    .map((value) => ({
      ...value,
      tags: Array.isArray(value.tags)
        ? [...new Set(value.tags as string[])].sort(compareCanonicalText)
        : value.tags,
    }))
    .sort((left, right) => compareCanonicalText(String(left[key]), String(right[key])));
}

function intersects(left: readonly string[], right: readonly string[]): boolean {
  const set = new Set(right);
  return left.some((value) => set.has(value));
}

function sharedTag(left: readonly string[], right: readonly string[]): string | null {
  const set = new Set(right);
  return left.find((value) => set.has(value)) ?? null;
}

function rehashInput(
  value: Omit<SangtianNpcDecisionPolicyInputV1, "inputHash">
    | SangtianNpcDecisionPolicyInputV1,
): string {
  const { inputHash: _inputHash, ...body } = value as SangtianNpcDecisionPolicyInputV1;
  return sha256Canonical(body);
}

function assertLegacySelectionHash(
  selection: SangtianAiDecisionPolicySelectionV1,
): void {
  const { selectionHash, ...body } = selection;
  assert.equal(selectionHash, sha256Canonical(body));
}

function assertResolutionHash(resolution: SangtianNpcDecisionResolutionV1): void {
  const { resolutionHash, ...body } = resolution;
  assert.equal(resolutionHash, sha256Canonical(body));
}

function assertPolicyCode(action: () => unknown, code: string): void {
  assert.throws(action, (error: unknown) => (
    error instanceof SangtianAiDecisionPolicyError && error.code === code
  ));
}
