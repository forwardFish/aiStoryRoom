import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  CHAPTER_IDS_V1,
  PRESSURE_CHAPTER_SEAT_IDS_V1,
  compareCanonicalText,
  hashWithoutField,
  isSha256,
  sha256Canonical,
  type ChapterIdV1,
  type ScalarFactValueV1,
  type SeatIdV1,
} from "@ai-story/shared";
import { loadSangtianPressureChapterPackageV1 } from "../content/loader";
import { validatePressureChapterRouteRegistryV1 } from "../../runtime-contract/pressure-chapter-registry";
import type {
  PublishedSangtianAiDecisionPolicyV1,
  SangtianAiDecisionPolicyInputV1,
  SangtianAiDecisionPolicySelectionV1,
  SangtianAiDecisionPolicyV1,
  SangtianNpcActionRuleV1,
  SangtianNpcDecisionPolicyInputV1,
  SangtianNpcDecisionResolutionReasonV1,
  SangtianNpcDecisionResolutionV1,
  SangtianNpcDecisionScoreV1,
  SangtianNpcIdentityDecisionPolicyV1,
  SangtianNpcIdentitySeatProfileV1,
} from "./types";

const DEFAULT_RELEASE_ROOT = resolve(
  __dirname,
  "../../../config/sangtian/pressure-chapter-v1/release",
);
const ARTIFACT_ID = "ai_decision_policy" as const;
const ARTIFACT_PATH = "ai-decision-policy.json" as const;
const EXPECTED_ARTIFACT_SHA256 =
  "2ec7a3d17e418cfde6aa4ecdcbe395d7c271bfa9772cd39fd8c9a534176fe78f";
const IDENTITY_ARTIFACT_ID = "npc_identity_decision_policy" as const;
const IDENTITY_ARTIFACT_PATH = "npc-identity-decision-policy.json" as const;
const IDENTITY_ARTIFACT_VERSION = "sangtian-npc-identity-decision-1.0.0" as const;
const EXPECTED_IDENTITY_ARTIFACT_SHA256 =
  "5f399a4496d76c3728be74e74c146f7edeab7ac29e4bb7c8a14de687512ff00e";
const EXPECTED_ROUTE_KEY = "sangtian_pressure_chapter_v1" as const;
const DEFAULT_ACTION_TYPE = "DEFAULT_PASS" as const;

/**
 * Non-configurable safety behavior. Identity priorities, scoring weights,
 * action rules, seat profiles, and resource requirements remain release-data
 * authority; fail-safe defaults and exact-top-score tie semantics live only
 * here and are intentionally absent from the mutable release artifact.
 */
const NPC_DECISION_SAFETY_INVARIANTS_V1 = Object.freeze({
  defaultActionType: DEFAULT_ACTION_TYPE,
  humanControlledReason: "HUMAN_CONTROLLED" as const,
  resolutionNotRequiredReason: "RESOLUTION_NOT_REQUIRED" as const,
  noResponsibilityTriggerReason: "NO_RESPONSIBILITY_TRIGGER" as const,
  belowThresholdReason: "BELOW_ABSTAIN_THRESHOLD" as const,
  scoredActionReason: "SCORED_ACTION" as const,
  tieBreakSchemaVersion: "sangtian_npc_decision_tie_break_v1" as const,
});

const LEGACY_ACCEPTED_INPUT_FIELDS = Object.freeze([
  "schemaVersion",
  "runId",
  "routeHash",
  "runSeed",
  "contentPackageVersion",
  "contentPackageSha256",
  "chapterRuntimeId",
  "chapterId",
  "decisionPointId",
  "seatId",
  "eligibleActionTypes",
  "inputHash",
] as const);
const NPC_ACCEPTED_INPUT_FIELDS = Object.freeze([
  "schemaVersion",
  "runId",
  "routeHash",
  "runSeed",
  "contentPackageVersion",
  "contentPackageSha256",
  "chapterRuntimeId",
  "chapterId",
  "decisionPointId",
  "seatId",
  "eligibleActionTypes",
  "controllerAuthority",
  "seatIdentity",
  "authoritativeFacts",
  "chapterWorkingDeltas",
  "commitments",
  "resources",
  "authorityGrants",
  "capabilities",
  "inputHash",
] as const);
const SELECTION_ENTROPY_FIELDS = Object.freeze([
  "runSeed",
  "chapterId",
  "decisionPointId",
  "seatId",
] as const);
const FORBIDDEN_INPUT_CLASSES = Object.freeze([
  "FREE_TEXT",
  "MUTABLE_WORKING_STATE",
  "NARRATIVE_ARTIFACT",
  "PROVIDER_OUTPUT",
  "UI_PROJECTION",
] as const);
const CONTEXTUAL_HUMAN_ONLY_ACTION_TYPES = new Set<string>([
  "CONFIRM_LEDGER_SOURCE_WITH_EVIDENCE",
  "INVESTIGATE_LEDGER_SOURCE",
]);

export class SangtianAiDecisionPolicyError extends Error {
  readonly name = "SangtianAiDecisionPolicyError";

  constructor(readonly code: string, readonly path: string, readonly detail?: string) {
    super(`${code}:${path}${detail ? `:${detail}` : ""}`);
  }
}

export function loadPublishedSangtianAiDecisionPolicyV1(
  options: Readonly<{ releaseRoot?: string }> = {},
): PublishedSangtianAiDecisionPolicyV1 {
  const releaseRoot = resolve(options.releaseRoot ?? DEFAULT_RELEASE_ROOT);
  const manifest = record(
    readJson(resolve(releaseRoot, "release-manifest.json")),
    "manifest",
  );
  const registry = validatePressureChapterRouteRegistryV1(manifest.routeRegistry);
  const route = registry.routes.find(
    (candidate) => candidate.routeKey === EXPECTED_ROUTE_KEY,
  );
  if (!route || route.status !== "PUBLISHED" || route.createEnabled !== true) {
    fail("ROUTE_NOT_PUBLISHED", "manifest.routeRegistry.routes");
  }

  const artifacts = array(manifest.artifacts, "manifest.artifacts");
  const matches = artifacts
    .map((item, index) => record(item, `manifest.artifacts[${index}]`))
    .filter((item) => item.artifactId === ARTIFACT_ID);
  const artifact = matches[0];
  if (
    matches.length !== 1
    || !artifact
    || artifact.path !== ARTIFACT_PATH
    || artifact.version !== "sangtian-ai-decision-1.0.2"
    || artifact.hashMode !== "CANONICAL_JSON"
    || artifact.sha256 !== EXPECTED_ARTIFACT_SHA256
  ) {
    fail("MANIFEST_INVALID", `manifest.artifacts.${ARTIFACT_ID}`);
  }

  const immutableInputs = array(
    manifest.immutableInputs,
    "manifest.immutableInputs",
  );
  const identityMatches = immutableInputs
    .map((item, index) => record(item, `manifest.immutableInputs[${index}]`))
    .filter((item) => item.artifactId === IDENTITY_ARTIFACT_ID);
  const identityArtifact = identityMatches[0];
  if (
    identityMatches.length !== 1
    || !identityArtifact
    || identityArtifact.path !== IDENTITY_ARTIFACT_PATH
    || identityArtifact.version !== IDENTITY_ARTIFACT_VERSION
    || identityArtifact.hashMode !== "CANONICAL_JSON"
    || identityArtifact.sha256 !== EXPECTED_IDENTITY_ARTIFACT_SHA256
  ) {
    fail("MANIFEST_INVALID", `manifest.immutableInputs.${IDENTITY_ARTIFACT_ID}`);
  }

  const rawPolicy = readJson(resolve(releaseRoot, ARTIFACT_PATH));
  if (sha256Canonical(rawPolicy) !== EXPECTED_ARTIFACT_SHA256) {
    fail("ARTIFACT_HASH_MISMATCH", ARTIFACT_PATH);
  }
  const rawIdentityPolicy = readJson(resolve(releaseRoot, IDENTITY_ARTIFACT_PATH));
  if (sha256Canonical(rawIdentityPolicy) !== EXPECTED_IDENTITY_ARTIFACT_SHA256) {
    fail("ARTIFACT_HASH_MISMATCH", IDENTITY_ARTIFACT_PATH);
  }
  const policy = validateSangtianAiDecisionPolicyV1(rawPolicy);
  const identityPolicy = validateSangtianNpcIdentityDecisionPolicyV1(
    rawIdentityPolicy,
    policy,
  );
  const loaded = loadSangtianPressureChapterPackageV1(resolve(releaseRoot, ".."));
  if (
    policy.sourceBinding.contentPackageVersion !== route.contentPackageVersion
    || policy.sourceBinding.contentPackageSha256 !== route.contentPackageSha256
    || policy.sourceBinding.contentPackageVersion !== loaded.manifest.packageVersion
    || policy.sourceBinding.contentPackageSha256 !== loaded.manifest.contentSha256
    || policy.runtimeProfile !== route.route.runtimeProfile
    || identityPolicy.sourceBinding.contentPackageVersion !== route.contentPackageVersion
    || identityPolicy.sourceBinding.contentPackageSha256 !== route.contentPackageSha256
    || identityPolicy.runtimeProfile !== route.route.runtimeProfile
  ) {
    fail("CONTENT_BINDING_MISMATCH", "policy.sourceBinding");
  }
  assertPolicyMatchesAcceptedContent(policy, loaded.content.chapters);

  function select(
    input: Readonly<SangtianAiDecisionPolicyInputV1>,
  ): SangtianAiDecisionPolicySelectionV1;
  function select(
    input: Readonly<SangtianNpcDecisionPolicyInputV1>,
  ): SangtianNpcDecisionResolutionV1;
  function select(
    input: Readonly<
      SangtianAiDecisionPolicyInputV1 | SangtianNpcDecisionPolicyInputV1
    >,
  ): SangtianAiDecisionPolicySelectionV1 | SangtianNpcDecisionResolutionV1 {
    if (input.schemaVersion === "sangtian_ai_decision_policy_input_v1") {
      return compileSangtianAiDecisionSelectionV1(
        policy,
        EXPECTED_ARTIFACT_SHA256,
        identityPolicy,
        EXPECTED_IDENTITY_ARTIFACT_SHA256,
        input,
      );
    }
    return compileSangtianAiDecisionSelectionV1(
      policy,
      EXPECTED_ARTIFACT_SHA256,
      identityPolicy,
      EXPECTED_IDENTITY_ARTIFACT_SHA256,
      input,
    );
  }

  return deepFreeze({
    releaseRoot,
    artifactSha256: EXPECTED_ARTIFACT_SHA256,
    policy,
    identityPolicyArtifactSha256: EXPECTED_IDENTITY_ARTIFACT_SHA256,
    identityPolicy,
    select,
  });
}

export function validateSangtianAiDecisionPolicyV1(
  value: unknown,
): SangtianAiDecisionPolicyV1 {
  const policy = record(value, "policy");
  exact(policy, [
    "schemaVersion",
    "policyRef",
    "policyVersion",
    "selectorVersion",
    "runtimeProfile",
    "sourceBinding",
    "authorityBoundary",
    "selectionAlgorithm",
    "decisions",
    "coverage",
    "policySha256",
  ], "policy");
  literal(policy.schemaVersion, "sangtian_ai_decision_policy_v1", "policy.schemaVersion");
  literal(policy.policyRef, "sangtian.ai.decision.v1", "policy.policyRef");
  literal(policy.policyVersion, "sangtian-ai-decision-1.0.2", "policy.policyVersion");
  literal(policy.selectorVersion, "sangtian-ai-decision-selector-1.0.0", "policy.selectorVersion");
  literal(policy.runtimeProfile, "SANGTIAN_CONTINUOUS_CHAPTER_V1", "policy.runtimeProfile");

  const binding = record(policy.sourceBinding, "policy.sourceBinding");
  exact(binding, ["contentPackageVersion", "contentPackageSha256"], "policy.sourceBinding");
  nonEmpty(binding.contentPackageVersion, "policy.sourceBinding.contentPackageVersion");
  sha(binding.contentPackageSha256, "policy.sourceBinding.contentPackageSha256");

  const boundary = record(policy.authorityBoundary, "policy.authorityBoundary");
  exact(boundary, [
    "acceptedInputFields",
    "selectionEntropyFields",
    "forbiddenInputClasses",
    "mayCreateActionTypes",
    "mayCompileWorkingIntent",
    "maySupplySettlementFacts",
    "contextualHumanOnlyActionTypes",
    "unknownBindingPolicy",
    "eligibleSetMismatchPolicy",
    "noNonDefaultCandidatePolicy",
  ], "policy.authorityBoundary");
  exactArray(boundary.acceptedInputFields, LEGACY_ACCEPTED_INPUT_FIELDS, "policy.authorityBoundary.acceptedInputFields");
  exactArray(boundary.selectionEntropyFields, SELECTION_ENTROPY_FIELDS, "policy.authorityBoundary.selectionEntropyFields");
  exactArray(boundary.forbiddenInputClasses, FORBIDDEN_INPUT_CLASSES, "policy.authorityBoundary.forbiddenInputClasses");
  for (const field of [
    "mayCreateActionTypes",
    "mayCompileWorkingIntent",
    "maySupplySettlementFacts",
  ] as const) {
    literal(boundary[field], false, `policy.authorityBoundary.${field}`);
  }
  exactArray(
    boundary.contextualHumanOnlyActionTypes,
    ["CONFIRM_LEDGER_SOURCE_WITH_EVIDENCE", "INVESTIGATE_LEDGER_SOURCE"],
    "policy.authorityBoundary.contextualHumanOnlyActionTypes",
  );
  literal(boundary.unknownBindingPolicy, "FAIL_CLOSED", "policy.authorityBoundary.unknownBindingPolicy");
  literal(boundary.eligibleSetMismatchPolicy, "FAIL_CLOSED", "policy.authorityBoundary.eligibleSetMismatchPolicy");
  literal(boundary.noNonDefaultCandidatePolicy, "DEFAULT_PASS_ONLY", "policy.authorityBoundary.noNonDefaultCandidatePolicy");

  const algorithm = record(policy.selectionAlgorithm, "policy.selectionAlgorithm");
  exact(algorithm, [
    "kind",
    "digestWindow",
    "rankingSource",
    "defaultActionType",
  ], "policy.selectionAlgorithm");
  literal(algorithm.kind, "SHA256_CANONICAL_PREFIX_MODULO_RANKED_NON_DEFAULT_V1", "policy.selectionAlgorithm.kind");
  literal(algorithm.digestWindow, "FIRST_8_HEX_UINT32_BE", "policy.selectionAlgorithm.digestWindow");
  literal(algorithm.rankingSource, "PUBLISHED_POLICY_EXACT_ORDER", "policy.selectionAlgorithm.rankingSource");
  literal(algorithm.defaultActionType, DEFAULT_ACTION_TYPE, "policy.selectionAlgorithm.defaultActionType");

  const decisions = array(policy.decisions, "policy.decisions");
  if (decisions.length !== 33) fail("POLICY_INVALID", "policy.decisions", "EXPECTED_33");
  const decisionKeys = new Set<string>();
  let seatBindingCount = 0;
  decisions.forEach((value, decisionIndex) => {
    const path = `policy.decisions[${decisionIndex}]`;
    const decision = record(value, path);
    exact(decision, [
      "chapterId",
      "decisionPointId",
      "publishedAllowedActionTypes",
      "seatPolicies",
    ], path);
    const chapter = chapterId(decision.chapterId, `${path}.chapterId`);
    const decisionPointId = nonEmpty(decision.decisionPointId, `${path}.decisionPointId`);
    const decisionKey = `${chapter}|${decisionPointId}`;
    if (decisionKeys.has(decisionKey)) fail("POLICY_INVALID", path, "DUPLICATE_DECISION");
    decisionKeys.add(decisionKey);

    const allowed = stringArray(
      decision.publishedAllowedActionTypes,
      `${path}.publishedAllowedActionTypes`,
    );
    unique(allowed, `${path}.publishedAllowedActionTypes`);
    if (!allowed.includes(DEFAULT_ACTION_TYPE)) {
      fail("POLICY_INVALID", `${path}.publishedAllowedActionTypes`, "DEFAULT_PASS_REQUIRED");
    }
    const expectedRanking = allowed.filter(
      (actionType) => actionType !== DEFAULT_ACTION_TYPE
        && !CONTEXTUAL_HUMAN_ONLY_ACTION_TYPES.has(actionType),
    );
    const seatPolicies = array(decision.seatPolicies, `${path}.seatPolicies`);
    if (!seatPolicies.length) fail("POLICY_INVALID", `${path}.seatPolicies`, "NON_EMPTY");
    const seatIds = new Set<string>();
    seatPolicies.forEach((seatValue, seatIndex) => {
      seatBindingCount += 1;
      const seatPath = `${path}.seatPolicies[${seatIndex}]`;
      const seat = record(seatValue, seatPath);
      exact(seat, ["seatId", "rankedNonDefaultActionTypes"], seatPath);
      const id = seatId(seat.seatId, `${seatPath}.seatId`);
      if (seatIds.has(id)) fail("POLICY_INVALID", seatPath, "DUPLICATE_SEAT");
      seatIds.add(id);
      const ranked = stringArray(
        seat.rankedNonDefaultActionTypes,
        `${seatPath}.rankedNonDefaultActionTypes`,
      );
      if (sha256Canonical(ranked) !== sha256Canonical(expectedRanking)) {
        fail("POLICY_INVALID", `${seatPath}.rankedNonDefaultActionTypes`, "RANKING_MISMATCH");
      }
    });
  });

  const coverage = record(policy.coverage, "policy.coverage");
  exact(coverage, [
    "chapterCount",
    "decisionPointCount",
    "applicableSeatBindingCount",
    "coverageRule",
  ], "policy.coverage");
  literal(coverage.chapterCount, 7, "policy.coverage.chapterCount");
  literal(coverage.decisionPointCount, 33, "policy.coverage.decisionPointCount");
  literal(coverage.applicableSeatBindingCount, 142, "policy.coverage.applicableSeatBindingCount");
  literal(
    coverage.coverageRule,
    "EXACT_ACCEPTED_DECISION_REQUIRED_SEAT_BINDINGS",
    "policy.coverage.coverageRule",
  );
  if (seatBindingCount !== 142) {
    fail("POLICY_INVALID", "policy.decisions.seatPolicies", "EXPECTED_142");
  }
  sha(policy.policySha256, "policy.policySha256");
  if (hashWithoutField(policy, "policySha256") !== policy.policySha256) {
    fail("POLICY_HASH_MISMATCH", "policy.policySha256");
  }
  return structuredClone(policy) as unknown as SangtianAiDecisionPolicyV1;
}

export function validateSangtianNpcIdentityDecisionPolicyV1(
  value: unknown,
  legacyPolicy: SangtianAiDecisionPolicyV1,
): SangtianNpcIdentityDecisionPolicyV1 {
  const policy = record(value, "identityPolicy");
  exact(policy, [
    "schemaVersion",
    "policyRef",
    "policyVersion",
    "selectorVersion",
    "runtimeProfile",
    "sourceBinding",
    "legacyBindingPolicy",
    "authorityBoundary",
    "scoring",
    "seatProfiles",
    "actionRules",
    "coverage",
    "policySha256",
  ], "identityPolicy");
  literal(policy.schemaVersion, "sangtian_npc_identity_decision_policy_v1", "identityPolicy.schemaVersion");
  literal(policy.policyRef, "sangtian.npc.identity-decision.v1", "identityPolicy.policyRef");
  literal(policy.policyVersion, IDENTITY_ARTIFACT_VERSION, "identityPolicy.policyVersion");
  literal(policy.selectorVersion, "sangtian-npc-identity-score-selector-1.0.0", "identityPolicy.selectorVersion");
  literal(policy.runtimeProfile, "SANGTIAN_CONTINUOUS_CHAPTER_V1", "identityPolicy.runtimeProfile");

  const binding = record(policy.sourceBinding, "identityPolicy.sourceBinding");
  exact(binding, ["contentPackageVersion", "contentPackageSha256"], "identityPolicy.sourceBinding");
  nonEmpty(binding.contentPackageVersion, "identityPolicy.sourceBinding.contentPackageVersion");
  sha(binding.contentPackageSha256, "identityPolicy.sourceBinding.contentPackageSha256");

  const legacy = record(policy.legacyBindingPolicy, "identityPolicy.legacyBindingPolicy");
  exact(legacy, [
    "policyRef",
    "policyVersion",
    "artifactSha256",
    "retainedRole",
    "supersededPrimaryAlgorithm",
  ], "identityPolicy.legacyBindingPolicy");
  literal(legacy.policyRef, legacyPolicy.policyRef, "identityPolicy.legacyBindingPolicy.policyRef");
  literal(legacy.policyVersion, legacyPolicy.policyVersion, "identityPolicy.legacyBindingPolicy.policyVersion");
  literal(legacy.artifactSha256, EXPECTED_ARTIFACT_SHA256, "identityPolicy.legacyBindingPolicy.artifactSha256");
  literal(legacy.retainedRole, "ELIGIBLE_ACTION_AND_REQUIRED_SEAT_BINDING_ONLY", "identityPolicy.legacyBindingPolicy.retainedRole");
  literal(legacy.supersededPrimaryAlgorithm, "SHA256_CANONICAL_PREFIX_MODULO_RANKED_NON_DEFAULT_V1", "identityPolicy.legacyBindingPolicy.supersededPrimaryAlgorithm");

  const boundary = record(policy.authorityBoundary, "identityPolicy.authorityBoundary");
  exact(boundary, [
    "providerCallCount",
    "mayCreateActionTypes",
    "mayCompileWorkingIntent",
    "maySupplySettlementFacts",
  ], "identityPolicy.authorityBoundary");
  literal(boundary.providerCallCount, 0, "identityPolicy.authorityBoundary.providerCallCount");
  literal(boundary.mayCreateActionTypes, false, "identityPolicy.authorityBoundary.mayCreateActionTypes");
  literal(boundary.mayCompileWorkingIntent, false, "identityPolicy.authorityBoundary.mayCompileWorkingIntent");
  literal(boundary.maySupplySettlementFacts, false, "identityPolicy.authorityBoundary.maySupplySettlementFacts");

  const scoring = record(policy.scoring, "identityPolicy.scoring");
  const scoringFields = [
    "baseScoreWeight",
    "identityResponsibilityWeight",
    "activePressureWeight",
    "authorityMatchWeight",
    "capabilityMatchWeight",
    "activeCommitmentWeight",
    "brokenCommitmentPenalty",
    "availableResourceWeight",
    "resourceConflictPenalty",
    "overreachPenalty",
  ] as const;
  exact(scoring, scoringFields, "identityPolicy.scoring");
  for (const field of scoringFields) {
    positiveNumber(scoring[field], `identityPolicy.scoring.${field}`);
  }

  const profiles = array(policy.seatProfiles, "identityPolicy.seatProfiles");
  if (profiles.length !== PRESSURE_CHAPTER_SEAT_IDS_V1.length) {
    fail("IDENTITY_POLICY_INVALID", "identityPolicy.seatProfiles", "EXPECTED_SIX");
  }
  const profileSeatIds: string[] = [];
  profiles.forEach((value, index) => {
    const path = `identityPolicy.seatProfiles[${index}]`;
    const profile = record(value, path);
    exact(profile, [
      "seatId",
      "identityProfileRef",
      "responsibilityTags",
      "authorityTags",
      "capabilityAffinityTags",
      "commitmentAffinityTags",
      "resourceStewardshipTags",
      "abstainThreshold",
    ], path);
    profileSeatIds.push(seatId(profile.seatId, `${path}.seatId`));
    nonEmpty(profile.identityProfileRef, `${path}.identityProfileRef`);
    for (const field of [
      "responsibilityTags",
      "authorityTags",
      "capabilityAffinityTags",
      "commitmentAffinityTags",
      "resourceStewardshipTags",
    ] as const) {
      policyTags(profile[field], `${path}.${field}`, false);
    }
    positiveNumber(profile.abstainThreshold, `${path}.abstainThreshold`);
  });
  if (sha256Canonical(profileSeatIds) !== sha256Canonical(PRESSURE_CHAPTER_SEAT_IDS_V1)) {
    fail("IDENTITY_POLICY_INVALID", "identityPolicy.seatProfiles", "SEAT_ORDER_OR_COVERAGE");
  }

  const rules = array(policy.actionRules, "identityPolicy.actionRules");
  const ruleActionTypes: string[] = [];
  rules.forEach((value, index) => {
    const path = `identityPolicy.actionRules[${index}]`;
    const rule = record(value, path);
    exact(rule, [
      "actionType",
      "baseScore",
      "responsibilityTags",
      "pressureTags",
      "requiredAuthorityAnyOf",
      "requiredCapabilityAnyOf",
      "commitmentTags",
      "resourceRequirements",
    ], path);
    const actionType = nonEmpty(rule.actionType, `${path}.actionType`);
    if (actionType === DEFAULT_ACTION_TYPE || CONTEXTUAL_HUMAN_ONLY_ACTION_TYPES.has(actionType)) {
      fail("IDENTITY_POLICY_INVALID", `${path}.actionType`, "NPC_RULE_FORBIDDEN");
    }
    ruleActionTypes.push(actionType);
    positiveNumber(rule.baseScore, `${path}.baseScore`);
    policyTags(rule.responsibilityTags, `${path}.responsibilityTags`, false);
    policyTags(rule.pressureTags, `${path}.pressureTags`, false);
    policyTags(rule.requiredAuthorityAnyOf, `${path}.requiredAuthorityAnyOf`, true);
    policyTags(rule.requiredCapabilityAnyOf, `${path}.requiredCapabilityAnyOf`, true);
    policyTags(rule.commitmentTags, `${path}.commitmentTags`, true);
    const requirements = array(rule.resourceRequirements, `${path}.resourceRequirements`);
    requirements.forEach((requirementValue, requirementIndex) => {
      const requirementPath = `${path}.resourceRequirements[${requirementIndex}]`;
      const requirement = record(requirementValue, requirementPath);
      exact(requirement, ["resourceTags", "amount"], requirementPath);
      policyTags(requirement.resourceTags, `${requirementPath}.resourceTags`, false);
      positiveNumber(requirement.amount, `${requirementPath}.amount`);
    });
  });
  unique(ruleActionTypes, "identityPolicy.actionRules.actionType");
  canonicalOrder(ruleActionTypes, "identityPolicy.actionRules.actionType", "IDENTITY_POLICY_INVALID");

  const expectedActionTypes = [...new Set(
    legacyPolicy.decisions.flatMap((decision) =>
      decision.seatPolicies.flatMap((seat) => seat.rankedNonDefaultActionTypes),
    ),
  )].sort(compareCanonicalText);
  if (sha256Canonical(ruleActionTypes) !== sha256Canonical(expectedActionTypes)) {
    fail("IDENTITY_POLICY_INVALID", "identityPolicy.actionRules", "LEGACY_ACTION_COVERAGE");
  }

  const coverage = record(policy.coverage, "identityPolicy.coverage");
  exact(coverage, [
    "chapterCount",
    "seatCount",
    "actionRuleCount",
    "chapterRule",
    "profileRule",
    "actionRuleCoverage",
    "decisionReachabilityCoverage",
  ], "identityPolicy.coverage");
  literal(coverage.chapterCount, 7, "identityPolicy.coverage.chapterCount");
  literal(coverage.seatCount, 6, "identityPolicy.coverage.seatCount");
  literal(coverage.actionRuleCount, expectedActionTypes.length, "identityPolicy.coverage.actionRuleCount");
  literal(coverage.chapterRule, "GENERIC_N1_TO_N7_NO_CHAPTER_BRANCHES", "identityPolicy.coverage.chapterRule");
  literal(coverage.profileRule, "EXACT_PRESSURE_SIX_SEAT_IDENTITIES", "identityPolicy.coverage.profileRule");
  literal(coverage.actionRuleCoverage, "EXACT_LEGACY_NPC_NON_DEFAULT_ACTION_TYPES", "identityPolicy.coverage.actionRuleCoverage");
  literal(
    coverage.decisionReachabilityCoverage,
    "EVERY_PUBLISHED_DECISION_HAS_REQUIRED_SEAT_WITH_REACHABLE_NON_DEFAULT_ACTION",
    "identityPolicy.coverage.decisionReachabilityCoverage",
  );

  sha(policy.policySha256, "identityPolicy.policySha256");
  if (hashWithoutField(policy, "policySha256") !== policy.policySha256) {
    fail("IDENTITY_POLICY_HASH_MISMATCH", "identityPolicy.policySha256");
  }
  const validated = structuredClone(
    policy,
  ) as unknown as SangtianNpcIdentityDecisionPolicyV1;
  assertEveryPublishedDecisionHasReachableNpcAction(legacyPolicy, validated);
  return validated;
}

export function compileSangtianAiDecisionSelectionV1(
  policy: SangtianAiDecisionPolicyV1,
  artifactSha256: string,
  identityPolicy: SangtianNpcIdentityDecisionPolicyV1,
  identityPolicyArtifactSha256: string,
  inputValue: Readonly<SangtianAiDecisionPolicyInputV1>,
): SangtianAiDecisionPolicySelectionV1;
export function compileSangtianAiDecisionSelectionV1(
  policy: SangtianAiDecisionPolicyV1,
  artifactSha256: string,
  identityPolicy: SangtianNpcIdentityDecisionPolicyV1,
  identityPolicyArtifactSha256: string,
  inputValue: Readonly<SangtianNpcDecisionPolicyInputV1>,
): SangtianNpcDecisionResolutionV1;
export function compileSangtianAiDecisionSelectionV1(
  policy: SangtianAiDecisionPolicyV1,
  artifactSha256: string,
  identityPolicy: SangtianNpcIdentityDecisionPolicyV1,
  identityPolicyArtifactSha256: string,
  inputValue: Readonly<
    SangtianAiDecisionPolicyInputV1 | SangtianNpcDecisionPolicyInputV1
  >,
): SangtianAiDecisionPolicySelectionV1 | SangtianNpcDecisionResolutionV1 {
  sha(artifactSha256, "artifactSha256");
  sha(identityPolicyArtifactSha256, "identityPolicyArtifactSha256");
  validateSangtianNpcIdentityDecisionPolicyV1(identityPolicy, policy);
  if (inputValue.schemaVersion === "sangtian_ai_decision_policy_input_v1") {
    const input = validateLegacyInput(inputValue);
    assertBinding(policy, input);
    return buildLegacySelection({
      policy,
      artifactSha256,
      inputHash: input.inputHash,
      actionType: NPC_DECISION_SAFETY_INVARIANTS_V1.defaultActionType,
    });
  }

  const input = validateNpcInput(inputValue);
  const binding = assertBinding(policy, input);
  const profile = identityPolicy.seatProfiles.find(
    (candidate) => candidate.seatId === input.seatId,
  );
  if (!profile || input.seatIdentity.identityProfileRef !== profile.identityProfileRef) {
    fail("IDENTITY_MISMATCH", "input.seatIdentity.identityProfileRef");
  }
  if (input.controllerAuthority.mode === "HUMAN_ACTIVE") {
    return defaultResolution(
      policy,
      artifactSha256,
      identityPolicy,
      identityPolicyArtifactSha256,
      input,
      NPC_DECISION_SAFETY_INVARIANTS_V1.humanControlledReason,
    );
  }
  if (input.controllerAuthority.requiresResolution !== true) {
    return defaultResolution(
      policy,
      artifactSha256,
      identityPolicy,
      identityPolicyArtifactSha256,
      input,
      NPC_DECISION_SAFETY_INVARIANTS_V1.resolutionNotRequiredReason,
    );
  }

  const scores = scoreActions(identityPolicy, profile, input, binding);
  const triggered = scores.filter((score) => score.responsibilityTriggered);
  if (triggered.length === 0) {
    return buildResolution({
      policy,
      artifactSha256,
      identityPolicy,
      identityPolicyArtifactSha256,
      inputHash: input.inputHash,
      actionType: NPC_DECISION_SAFETY_INVARIANTS_V1.defaultActionType,
      resolutionReason: NPC_DECISION_SAFETY_INVARIANTS_V1.noResponsibilityTriggerReason,
      scoreBreakdown: scores,
      topScore: null,
      tiedActionTypes: [],
      tieBreakerHash: null,
    });
  }
  const topScore = Math.max(...triggered.map((score) => score.totalScore));
  const tiedActionTypes = triggered
    .filter((score) => score.totalScore === topScore)
    .map((score) => score.actionType)
    .sort(compareCanonicalText);
  if (topScore < profile.abstainThreshold) {
    return buildResolution({
      policy,
      artifactSha256,
      identityPolicy,
      identityPolicyArtifactSha256,
      inputHash: input.inputHash,
      actionType: NPC_DECISION_SAFETY_INVARIANTS_V1.defaultActionType,
      resolutionReason: NPC_DECISION_SAFETY_INVARIANTS_V1.belowThresholdReason,
      scoreBreakdown: scores,
      topScore,
      tiedActionTypes,
      tieBreakerHash: null,
    });
  }

  let actionType = tiedActionTypes[0]!;
  let tieBreakerHash: string | null = null;
  if (tiedActionTypes.length > 1) {
    tieBreakerHash = sha256Canonical({
      schemaVersion: NPC_DECISION_SAFETY_INVARIANTS_V1.tieBreakSchemaVersion,
      runSeed: input.runSeed,
      chapterId: input.chapterId,
      decisionPointId: input.decisionPointId,
      seatId: input.seatId,
      inputHash: input.inputHash,
      tiedActionTypes,
    });
    actionType = tiedActionTypes[
      Number.parseInt(tieBreakerHash.slice(0, 8), 16) % tiedActionTypes.length
    ]!;
  }
  if (!input.eligibleActionTypes.includes(actionType)) {
    fail("POLICY_INVALID", "policy.selection", "NOT_ELIGIBLE");
  }
  return buildResolution({
    policy,
    artifactSha256,
    identityPolicy,
    identityPolicyArtifactSha256,
    inputHash: input.inputHash,
    actionType,
    resolutionReason: NPC_DECISION_SAFETY_INVARIANTS_V1.scoredActionReason,
    scoreBreakdown: scores,
    topScore,
    tiedActionTypes,
    tieBreakerHash,
  });
}

function buildLegacySelection(input: Readonly<{
  policy: SangtianAiDecisionPolicyV1;
  artifactSha256: string;
  inputHash: string;
  actionType: string;
}>): SangtianAiDecisionPolicySelectionV1 {
  const body = {
    schemaVersion: "sangtian_ai_decision_policy_selection_v1" as const,
    policyRef: input.policy.policyRef,
    policyVersion: input.policy.policyVersion,
    policyHash: input.artifactSha256,
    resolvedContentPackageVersion: input.policy.sourceBinding.contentPackageVersion,
    resolvedContentPackageSha256: input.policy.sourceBinding.contentPackageSha256,
    inputHash: input.inputHash,
    actionType: input.actionType,
  };
  return deepFreeze({ ...body, selectionHash: sha256Canonical(body) });
}

function defaultResolution(
  policy: SangtianAiDecisionPolicyV1,
  artifactSha256: string,
  identityPolicy: SangtianNpcIdentityDecisionPolicyV1,
  identityPolicyArtifactSha256: string,
  input: SangtianNpcDecisionPolicyInputV1,
  resolutionReason: SangtianNpcDecisionResolutionReasonV1,
): SangtianNpcDecisionResolutionV1 {
  return buildResolution({
    policy,
    artifactSha256,
    identityPolicy,
    identityPolicyArtifactSha256,
    inputHash: input.inputHash,
    actionType: NPC_DECISION_SAFETY_INVARIANTS_V1.defaultActionType,
    resolutionReason,
    scoreBreakdown: [],
    topScore: null,
    tiedActionTypes: [],
    tieBreakerHash: null,
  });
}

function buildResolution(input: Readonly<{
  policy: SangtianAiDecisionPolicyV1;
  artifactSha256: string;
  identityPolicy: SangtianNpcIdentityDecisionPolicyV1;
  identityPolicyArtifactSha256: string;
  inputHash: string;
  actionType: string;
  resolutionReason: SangtianNpcDecisionResolutionReasonV1;
  scoreBreakdown: SangtianNpcDecisionScoreV1[];
  topScore: number | null;
  tiedActionTypes: string[];
  tieBreakerHash: string | null;
}>): SangtianNpcDecisionResolutionV1 {
  const body = {
    schemaVersion: "sangtian_npc_decision_resolution_v1" as const,
    policyRef: input.policy.policyRef,
    policyVersion: input.policy.policyVersion,
    policyHash: input.artifactSha256,
    resolvedContentPackageVersion: input.policy.sourceBinding.contentPackageVersion,
    resolvedContentPackageSha256: input.policy.sourceBinding.contentPackageSha256,
    inputHash: input.inputHash,
    actionType: input.actionType,
    identityPolicyRef: input.identityPolicy.policyRef,
    identityPolicyVersion: input.identityPolicy.policyVersion,
    identityPolicyHash: input.identityPolicy.policySha256,
    identityPolicyArtifactSha256: input.identityPolicyArtifactSha256,
    resolutionReason: input.resolutionReason,
    scoreBreakdown: input.scoreBreakdown.map((score) => ({ ...score })),
    topScore: input.topScore,
    tiedActionTypes: [...input.tiedActionTypes],
    tieBreakerUsed: input.tieBreakerHash !== null,
    tieBreakerHash: input.tieBreakerHash,
    providerCallCount: input.identityPolicy.authorityBoundary.providerCallCount,
  };
  return deepFreeze({ ...body, resolutionHash: sha256Canonical(body) });
}

function scoreActions(
  policy: SangtianNpcIdentityDecisionPolicyV1,
  profile: SangtianNpcIdentitySeatProfileV1,
  input: SangtianNpcDecisionPolicyInputV1,
  binding: SangtianAiDecisionPolicyV1["decisions"][number],
): SangtianNpcDecisionScoreV1[] {
  const activeStateTags = new Set([
    ...collectTags(input.authoritativeFacts.filter((fact) => fact.state === "ACTIVE")),
    ...collectTags(input.chapterWorkingDeltas.filter((delta) => delta.state === "ACTIVE")),
  ]);
  const activeCommitmentTags = collectTags(
    input.commitments.filter((commitment) => commitment.status === "ACTIVE"),
  );
  const brokenCommitmentTags = collectTags(
    input.commitments.filter((commitment) => commitment.status === "BROKEN"),
  );
  const enabledAuthorityTags = collectTags(
    input.authorityGrants.filter((grant) => grant.enabled),
  );
  const enabledCapabilityTags = collectTags(
    input.capabilities.filter((capability) => capability.enabled),
  );
  const rules = new Map(policy.actionRules.map((rule) => [rule.actionType, rule]));
  const scores = binding.publishedAllowedActionTypes
    .filter((actionType) =>
      actionType !== DEFAULT_ACTION_TYPE
      && !CONTEXTUAL_HUMAN_ONLY_ACTION_TYPES.has(actionType),
    )
    .map((actionType) => {
      const rule = rules.get(actionType);
      if (!rule) fail("IDENTITY_POLICY_INVALID", `identityPolicy.actionRules.${actionType}`, "MISSING");
      return scoreAction(
        policy,
        profile,
        input,
        rule,
        activeStateTags,
        activeCommitmentTags,
        brokenCommitmentTags,
        enabledAuthorityTags,
        enabledCapabilityTags,
      );
    });
  return scores.sort((left, right) => compareCanonicalText(left.actionType, right.actionType));
}

function scoreAction(
  policy: SangtianNpcIdentityDecisionPolicyV1,
  profile: SangtianNpcIdentitySeatProfileV1,
  input: SangtianNpcDecisionPolicyInputV1,
  rule: SangtianNpcActionRuleV1,
  activeStateTags: ReadonlySet<string>,
  activeCommitmentTags: ReadonlySet<string>,
  brokenCommitmentTags: ReadonlySet<string>,
  enabledAuthorityTags: ReadonlySet<string>,
  enabledCapabilityTags: ReadonlySet<string>,
): SangtianNpcDecisionScoreV1 {
  const responsibilityMatches = intersectionCount(
    rule.responsibilityTags,
    new Set(profile.responsibilityTags),
  );
  const pressureMatches = intersectionCount(rule.pressureTags, activeStateTags);
  const profileCommitmentTags = rule.commitmentTags.filter((tag) =>
    profile.commitmentAffinityTags.includes(tag),
  );
  const activeCommitmentMatches = intersectionCount(
    profileCommitmentTags,
    activeCommitmentTags,
  );
  const brokenCommitmentMatches = intersectionCount(
    profileCommitmentTags,
    brokenCommitmentTags,
  );

  const authorityRequired = rule.requiredAuthorityAnyOf.length > 0;
  const authoritySatisfied = !authorityRequired || hasSharedTag(
    rule.requiredAuthorityAnyOf,
    profile.authorityTags,
    enabledAuthorityTags,
  );
  const capabilityRequired = rule.requiredCapabilityAnyOf.length > 0;
  const capabilitySatisfied = !capabilityRequired || hasSharedTag(
    rule.requiredCapabilityAnyOf,
    profile.capabilityAffinityTags,
    enabledCapabilityTags,
  );

  let satisfiedResources = 0;
  let resourceConflicts = 0;
  let resourceOverreach = 0;
  for (const requirement of rule.resourceRequirements) {
    const ownsResource = intersects(
      requirement.resourceTags,
      profile.resourceStewardshipTags,
    );
    const available = input.resources
      .filter((resource) => intersects(resource.tags, requirement.resourceTags))
      .reduce((total, resource) => total + resource.available - resource.reserved, 0);
    if (available >= requirement.amount) satisfiedResources += 1;
    else resourceConflicts += 1;
    if (!ownsResource) resourceOverreach += 1;
  }

  const baseScore = rule.baseScore * policy.scoring.baseScoreWeight;
  const identityPriority = responsibilityMatches
    * policy.scoring.identityResponsibilityWeight;
  const pressureMatch = pressureMatches * policy.scoring.activePressureWeight;
  const authorityMatch = authorityRequired && authoritySatisfied
    ? policy.scoring.authorityMatchWeight
    : 0;
  const capabilityMatch = capabilityRequired && capabilitySatisfied
    ? policy.scoring.capabilityMatchWeight
    : 0;
  const commitmentConsistency = activeCommitmentMatches
    * policy.scoring.activeCommitmentWeight
    - brokenCommitmentMatches * policy.scoring.brokenCommitmentPenalty;
  const resourceFitness = satisfiedResources
    * policy.scoring.availableResourceWeight;
  const resourceConflictPenalty = -resourceConflicts
    * policy.scoring.resourceConflictPenalty;
  const overreachCount = Number(authorityRequired && !authoritySatisfied)
    + Number(capabilityRequired && !capabilitySatisfied)
    + resourceOverreach;
  const overreachPenalty = -overreachCount * policy.scoring.overreachPenalty;
  const totalScore = baseScore
    + identityPriority
    + pressureMatch
    + authorityMatch
    + capabilityMatch
    + commitmentConsistency
    + resourceFitness
    + resourceConflictPenalty
    + overreachPenalty;
  return {
    actionType: rule.actionType,
    responsibilityTriggered: responsibilityMatches > 0
      && (pressureMatches > 0 || activeCommitmentMatches > 0),
    baseScore,
    identityPriority,
    pressureMatch,
    authorityMatch,
    commitmentConsistency,
    resourceFitness,
    capabilityMatch,
    resourceConflictPenalty,
    overreachPenalty,
    totalScore,
  };
}

function assertBinding(
  policy: SangtianAiDecisionPolicyV1,
  input: Pick<
    SangtianAiDecisionPolicyInputV1,
    | "contentPackageVersion"
    | "contentPackageSha256"
    | "chapterId"
    | "decisionPointId"
    | "seatId"
    | "eligibleActionTypes"
  >,
): SangtianAiDecisionPolicyV1["decisions"][number] {
  if (
    input.contentPackageVersion !== policy.sourceBinding.contentPackageVersion
    || input.contentPackageSha256 !== policy.sourceBinding.contentPackageSha256
  ) {
    fail("CONTENT_BINDING_MISMATCH", "input.contentPackageSha256");
  }
  const decision = policy.decisions.find(
    (candidate) => candidate.chapterId === input.chapterId
      && candidate.decisionPointId === input.decisionPointId,
  );
  const seat = decision?.seatPolicies.find(
    (candidate) => candidate.seatId === input.seatId,
  );
  if (!decision || !seat) fail("BINDING_NOT_FOUND", "input.decisionPointId");
  const eligible = [...input.eligibleActionTypes].sort(compareCanonicalText);
  const published = [...decision.publishedAllowedActionTypes].sort(compareCanonicalText);
  if (sha256Canonical(eligible) !== sha256Canonical(published)) {
    fail("ELIGIBLE_SET_MISMATCH", "input.eligibleActionTypes");
  }
  return decision;
}

function validateLegacyInput(value: unknown): SangtianAiDecisionPolicyInputV1 {
  const input = record(value, "input");
  exact(input, LEGACY_ACCEPTED_INPUT_FIELDS, "input");
  validateCommonInput(input, "sangtian_ai_decision_policy_input_v1");
  sha(input.inputHash, "input.inputHash");
  const { inputHash, ...body } = input;
  if (sha256Canonical(body) !== inputHash) {
    fail("INPUT_HASH_MISMATCH", "input.inputHash");
  }
  return structuredClone(input) as unknown as SangtianAiDecisionPolicyInputV1;
}

function validateNpcInput(value: unknown): SangtianNpcDecisionPolicyInputV1 {
  const input = record(value, "input");
  exact(input, NPC_ACCEPTED_INPUT_FIELDS, "input");
  validateCommonInput(input, "sangtian_npc_decision_policy_input_v1");

  const controller = record(input.controllerAuthority, "input.controllerAuthority");
  exact(controller, [
    "mode",
    "activeControllerId",
    "controlEpoch",
    "authorityStateHash",
    "requiresResolution",
  ], "input.controllerAuthority");
  enumeration(controller.mode, ["HUMAN_ACTIVE", "AI_ACTIVE"], "input.controllerAuthority.mode");
  nonEmpty(controller.activeControllerId, "input.controllerAuthority.activeControllerId");
  positiveInteger(controller.controlEpoch, "input.controllerAuthority.controlEpoch");
  sha(controller.authorityStateHash, "input.controllerAuthority.authorityStateHash");
  booleanValue(controller.requiresResolution, "input.controllerAuthority.requiresResolution");

  const identity = record(input.seatIdentity, "input.seatIdentity");
  exact(identity, ["identityProfileRef", "identityStateHash"], "input.seatIdentity");
  nonEmpty(identity.identityProfileRef, "input.seatIdentity.identityProfileRef");
  sha(identity.identityStateHash, "input.seatIdentity.identityStateHash");

  validateTaggedScalars(input.authoritativeFacts, "factRef", "input.authoritativeFacts");
  validateTaggedScalars(input.chapterWorkingDeltas, "deltaRef", "input.chapterWorkingDeltas");
  validateCommitments(input.commitments);
  validateResources(input.resources);
  validateEnabledTagged(input.authorityGrants, "authorityId", "input.authorityGrants");
  validateEnabledTagged(input.capabilities, "capabilityId", "input.capabilities");

  sha(input.inputHash, "input.inputHash");
  const { inputHash, ...body } = input;
  if (sha256Canonical(body) !== inputHash) {
    fail("INPUT_HASH_MISMATCH", "input.inputHash");
  }
  return structuredClone(input) as unknown as SangtianNpcDecisionPolicyInputV1;
}

function validateCommonInput(input: Record<string, unknown>, schemaVersion: string): void {
  literal(input.schemaVersion, schemaVersion, "input.schemaVersion");
  nonEmpty(input.runId, "input.runId");
  sha(input.routeHash, "input.routeHash");
  nonEmpty(input.runSeed, "input.runSeed");
  nonEmpty(input.contentPackageVersion, "input.contentPackageVersion");
  sha(input.contentPackageSha256, "input.contentPackageSha256");
  nonEmpty(input.chapterRuntimeId, "input.chapterRuntimeId");
  chapterId(input.chapterId, "input.chapterId");
  nonEmpty(input.decisionPointId, "input.decisionPointId");
  seatId(input.seatId, "input.seatId");
  const eligible = stringArray(input.eligibleActionTypes, "input.eligibleActionTypes");
  unique(eligible, "input.eligibleActionTypes");
  canonicalOrder(eligible, "input.eligibleActionTypes", "INPUT_INVALID");
  if (!eligible.includes(DEFAULT_ACTION_TYPE)) {
    fail("INPUT_INVALID", "input.eligibleActionTypes", "DEFAULT_PASS_REQUIRED");
  }
}

function validateTaggedScalars(value: unknown, idField: string, path: string): void {
  const entries = array(value, path);
  canonicalObjectOrder(entries, idField, path);
  entries.forEach((entryValue, index) => {
    const entryPath = `${path}[${index}]`;
    const entry = record(entryValue, entryPath);
    exact(entry, [idField, "state", "value", "tags"], entryPath);
    nonEmpty(entry[idField], `${entryPath}.${idField}`);
    enumeration(entry.state, ["ACTIVE", "INACTIVE"], `${entryPath}.state`);
    scalar(entry.value, `${entryPath}.value`);
    inputTags(entry.tags, `${entryPath}.tags`);
  });
}

function validateCommitments(value: unknown): void {
  const entries = array(value, "input.commitments");
  canonicalObjectOrder(entries, "commitmentId", "input.commitments");
  entries.forEach((entryValue, index) => {
    const path = `input.commitments[${index}]`;
    const entry = record(entryValue, path);
    exact(entry, ["commitmentId", "status", "tags"], path);
    nonEmpty(entry.commitmentId, `${path}.commitmentId`);
    enumeration(entry.status, ["ACTIVE", "FULFILLED", "BROKEN", "CANCELLED"], `${path}.status`);
    inputTags(entry.tags, `${path}.tags`);
  });
}

function validateResources(value: unknown): void {
  const entries = array(value, "input.resources");
  canonicalObjectOrder(entries, "resourceId", "input.resources");
  entries.forEach((entryValue, index) => {
    const path = `input.resources[${index}]`;
    const entry = record(entryValue, path);
    exact(entry, ["resourceId", "available", "reserved", "tags"], path);
    nonEmpty(entry.resourceId, `${path}.resourceId`);
    const available = nonNegativeNumber(entry.available, `${path}.available`);
    const reserved = nonNegativeNumber(entry.reserved, `${path}.reserved`);
    if (reserved > available) fail("INPUT_INVALID", `${path}.reserved`, "EXCEEDS_AVAILABLE");
    inputTags(entry.tags, `${path}.tags`);
  });
}

function validateEnabledTagged(value: unknown, idField: string, path: string): void {
  const entries = array(value, path);
  canonicalObjectOrder(entries, idField, path);
  entries.forEach((entryValue, index) => {
    const entryPath = `${path}[${index}]`;
    const entry = record(entryValue, entryPath);
    exact(entry, [idField, "enabled", "tags"], entryPath);
    nonEmpty(entry[idField], `${entryPath}.${idField}`);
    booleanValue(entry.enabled, `${entryPath}.enabled`);
    inputTags(entry.tags, `${entryPath}.tags`);
  });
}

function assertPolicyMatchesAcceptedContent(
  policy: SangtianAiDecisionPolicyV1,
  chapters: ReturnType<typeof loadSangtianPressureChapterPackageV1>["content"]["chapters"],
): void {
  const accepted = chapters.flatMap((chapter) => chapter.decisionPoints.map(
    (decision) => ({ chapterId: chapter.chapterId, decision }),
  ));
  if (accepted.length !== policy.decisions.length) {
    fail("CONTENT_BINDING_MISMATCH", "policy.decisions", "DECISION_COUNT");
  }
  let seatBindingCount = 0;
  accepted.forEach(({ chapterId: acceptedChapterId, decision }, index) => {
    const configured = policy.decisions[index]!;
    const ranked = decision.allowedActionTypes.filter(
      (actionType) => actionType !== DEFAULT_ACTION_TYPE
        && !CONTEXTUAL_HUMAN_ONLY_ACTION_TYPES.has(actionType),
    );
    if (
      configured.chapterId !== acceptedChapterId
      || configured.decisionPointId !== decision.decisionPointKey
      || sha256Canonical(configured.publishedAllowedActionTypes)
        !== sha256Canonical(decision.allowedActionTypes)
      || sha256Canonical(configured.seatPolicies.map((seat) => seat.seatId))
        !== sha256Canonical(decision.requiredSeatIds)
      || configured.seatPolicies.some(
        (seat) => sha256Canonical(seat.rankedNonDefaultActionTypes)
          !== sha256Canonical(ranked),
      )
    ) {
      fail("CONTENT_BINDING_MISMATCH", `policy.decisions[${index}]`);
    }
    seatBindingCount += configured.seatPolicies.length;
  });
  if (seatBindingCount !== 142) {
    fail("CONTENT_BINDING_MISMATCH", "policy.coverage.applicableSeatBindingCount");
  }
}

function assertEveryPublishedDecisionHasReachableNpcAction(
  legacyPolicy: SangtianAiDecisionPolicyV1,
  identityPolicy: SangtianNpcIdentityDecisionPolicyV1,
): void {
  const profilesBySeat = new Map(
    identityPolicy.seatProfiles.map((profile) => [profile.seatId, profile]),
  );
  const rulesByAction = new Map(
    identityPolicy.actionRules.map((rule) => [rule.actionType, rule]),
  );
  for (const decision of legacyPolicy.decisions) {
    const reachable = decision.seatPolicies.some((seatBinding) => {
      const profile = profilesBySeat.get(seatBinding.seatId);
      if (!profile) return false;
      return seatBinding.rankedNonDefaultActionTypes.some((actionType) => {
        const rule = rulesByAction.get(actionType);
        return rule
          ? isNpcRuleStaticallyReachableForProfile(profile, rule)
          : false;
      });
    });
    if (!reachable) {
      fail(
        "IDENTITY_POLICY_INVALID",
        [
          "identityPolicy.coverage.decisionReachability",
          decision.chapterId,
          decision.decisionPointId,
        ].join("."),
        "NO_REQUIRED_SEAT_CAN_RESOLVE_NON_DEFAULT_ACTION",
      );
    }
  }
}

function isNpcRuleStaticallyReachableForProfile(
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
      || intersects(
        rule.requiredCapabilityAnyOf,
        profile.capabilityAffinityTags,
      )
    )
    && rule.resourceRequirements.every((requirement) =>
      intersects(requirement.resourceTags, profile.resourceStewardshipTags),
    );
}

function collectTags(values: readonly { tags: string[] }[]): Set<string> {
  return new Set(values.flatMap((value) => value.tags));
}

function intersectionCount(values: readonly string[], target: ReadonlySet<string>): number {
  return values.reduce((count, value) => count + Number(target.has(value)), 0);
}

function intersects(values: readonly string[], target: readonly string[] | ReadonlySet<string>): boolean {
  const set = target instanceof Set ? target : new Set(target);
  return values.some((value) => set.has(value));
}

function hasSharedTag(
  ruleTags: readonly string[],
  profileTags: readonly string[],
  activeTags: ReadonlySet<string>,
): boolean {
  const profile = new Set(profileTags);
  return ruleTags.some((tag) => profile.has(tag) && activeTags.has(tag));
}

function readJson(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as unknown;
  } catch (error) {
    return fail("READ_FAILED", path, error instanceof Error ? error.name : "UNKNOWN");
  }
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("POLICY_INVALID", path, "OBJECT");
  }
  return value as Record<string, unknown>;
}

function array(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) fail("POLICY_INVALID", path, "ARRAY");
  return value;
}

function exact(value: Record<string, unknown>, keys: readonly string[], path: string): void {
  const unknown = Object.keys(value).find((key) => !keys.includes(key));
  const missing = keys.find((key) => !(key in value));
  if (unknown) fail("POLICY_INVALID", `${path}.${unknown}`, "UNKNOWN_FIELD");
  if (missing) fail("POLICY_INVALID", `${path}.${missing}`, "MISSING_FIELD");
}

function exactArray(value: unknown, expected: readonly unknown[], path: string): void {
  if (!Array.isArray(value) || sha256Canonical(value) !== sha256Canonical(expected)) {
    fail("POLICY_INVALID", path, "EXACT_ARRAY_MISMATCH");
  }
}

function stringArray(value: unknown, path: string): string[] {
  const values = array(value, path);
  if (!values.length || values.some((item) => typeof item !== "string" || !item.trim())) {
    fail("POLICY_INVALID", path, "NON_EMPTY_STRING_ARRAY");
  }
  return values as string[];
}

function policyTags(value: unknown, path: string, allowEmpty: boolean): string[] {
  const values = array(value, path);
  if ((!allowEmpty && values.length === 0) || values.some((item) => typeof item !== "string" || !item.trim())) {
    fail("IDENTITY_POLICY_INVALID", path, allowEmpty ? "STRING_ARRAY" : "NON_EMPTY_STRING_ARRAY");
  }
  const output = values as string[];
  unique(output, path);
  canonicalOrder(output, path, "IDENTITY_POLICY_INVALID");
  return output;
}

function inputTags(value: unknown, path: string): string[] {
  const values = array(value, path);
  if (values.some((item) => typeof item !== "string" || !item.trim())) {
    fail("INPUT_INVALID", path, "STRING_ARRAY");
  }
  const output = values as string[];
  unique(output, path);
  canonicalOrder(output, path, "INPUT_INVALID");
  return output;
}

function canonicalOrder(values: readonly string[], path: string, code: string): void {
  const sorted = [...values].sort(compareCanonicalText);
  if (sha256Canonical(values) !== sha256Canonical(sorted)) {
    fail(code, path, "CANONICAL_ORDER");
  }
}

function canonicalObjectOrder(values: readonly unknown[], key: string, path: string): void {
  const keys = values.map((value, index) => {
    const item = record(value, `${path}[${index}]`);
    return nonEmpty(item[key], `${path}[${index}].${key}`);
  });
  unique(keys, path);
  canonicalOrder(keys, path, "INPUT_INVALID");
}

function unique(values: readonly string[], path: string): void {
  if (new Set(values).size !== values.length) fail("POLICY_INVALID", path, "DUPLICATE");
}

function nonEmpty(value: unknown, path: string): string {
  if (typeof value !== "string" || !value.trim() || value !== value.trim()) {
    fail("POLICY_INVALID", path, "NON_EMPTY_TRIMMED_STRING");
  }
  return value;
}

function booleanValue(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") fail("INPUT_INVALID", path, "BOOLEAN");
  return value;
}

function positiveInteger(value: unknown, path: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) {
    fail("INPUT_INVALID", path, "POSITIVE_SAFE_INTEGER");
  }
  return Number(value);
}

function positiveNumber(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    fail("POLICY_INVALID", path, "POSITIVE_FINITE_NUMBER");
  }
  return value;
}

function nonNegativeNumber(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    fail("INPUT_INVALID", path, "NON_NEGATIVE_FINITE_NUMBER");
  }
  return value;
}

function scalar(value: unknown, path: string): ScalarFactValueV1 {
  if (
    value !== null
    && typeof value !== "string"
    && typeof value !== "boolean"
    && (typeof value !== "number" || !Number.isFinite(value))
  ) {
    fail("INPUT_INVALID", path, "SCALAR_FACT_VALUE");
  }
  return value as ScalarFactValueV1;
}

function literal<T>(value: unknown, expected: T, path: string): T {
  if (value !== expected) fail("POLICY_INVALID", path, `EXPECTED_${String(expected)}`);
  return expected;
}

function enumeration<T extends string>(value: unknown, expected: readonly T[], path: string): T {
  if (typeof value !== "string" || !expected.includes(value as T)) {
    fail("POLICY_INVALID", path, `ALLOWED_${expected.join("|")}`);
  }
  return value as T;
}

function chapterId(value: unknown, path: string): ChapterIdV1 {
  return enumeration(value, CHAPTER_IDS_V1, path);
}

function seatId(value: unknown, path: string): SeatIdV1 {
  return enumeration(value, PRESSURE_CHAPTER_SEAT_IDS_V1, path);
}

function sha(value: unknown, path: string): string {
  if (!isSha256(value)) fail("POLICY_INVALID", path, "SHA256");
  return value;
}

function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  Object.values(value).forEach(deepFreeze);
  return value;
}

function fail(code: string, path: string, detail?: string): never {
  throw new SangtianAiDecisionPolicyError(
    `SANGTIAN_AI_DECISION_${code}`,
    path,
    detail,
  );
}
