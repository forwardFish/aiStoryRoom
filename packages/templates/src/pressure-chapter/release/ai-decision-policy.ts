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
  type SeatIdV1,
} from "@ai-story/shared";
import { loadSangtianPressureChapterPackageV1 } from "../content/loader";
import { validatePressureChapterRouteRegistryV1 } from "../../runtime-contract/pressure-chapter-registry";
import type {
  PublishedSangtianAiDecisionPolicyV1,
  SangtianAiDecisionPolicyInputV1,
  SangtianAiDecisionPolicySelectionV1,
  SangtianAiDecisionPolicyV1,
} from "./types";

const DEFAULT_RELEASE_ROOT = resolve(
  __dirname,
  "../../../config/sangtian/pressure-chapter-v1/release",
);
const ARTIFACT_ID = "ai_decision_policy" as const;
const ARTIFACT_PATH = "ai-decision-policy.json" as const;
const EXPECTED_ARTIFACT_SHA256 =
  "2ec7a3d17e418cfde6aa4ecdcbe395d7c271bfa9772cd39fd8c9a534176fe78f";
const EXPECTED_ROUTE_KEY = "sangtian_pressure_chapter_v1" as const;

const ACCEPTED_INPUT_FIELDS = Object.freeze([
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

  const rawPolicy = readJson(resolve(releaseRoot, ARTIFACT_PATH));
  if (sha256Canonical(rawPolicy) !== EXPECTED_ARTIFACT_SHA256) {
    fail("ARTIFACT_HASH_MISMATCH", ARTIFACT_PATH);
  }
  const policy = validateSangtianAiDecisionPolicyV1(rawPolicy);
  const loaded = loadSangtianPressureChapterPackageV1(resolve(releaseRoot, ".."));
  if (
    policy.sourceBinding.contentPackageVersion !== route.contentPackageVersion
    || policy.sourceBinding.contentPackageSha256 !== route.contentPackageSha256
    || policy.sourceBinding.contentPackageVersion !== loaded.manifest.packageVersion
    || policy.sourceBinding.contentPackageSha256 !== loaded.manifest.contentSha256
    || policy.runtimeProfile !== route.route.runtimeProfile
  ) {
    fail("CONTENT_BINDING_MISMATCH", "policy.sourceBinding");
  }
  assertPolicyMatchesAcceptedContent(policy, loaded.content.chapters);

  return deepFreeze({
    releaseRoot,
    artifactSha256: EXPECTED_ARTIFACT_SHA256,
    policy,
    select: (input: Readonly<SangtianAiDecisionPolicyInputV1>) =>
      compileSangtianAiDecisionSelectionV1(
        policy,
        EXPECTED_ARTIFACT_SHA256,
        input,
      ),
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
  exactArray(boundary.acceptedInputFields, ACCEPTED_INPUT_FIELDS, "policy.authorityBoundary.acceptedInputFields");
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
  literal(algorithm.defaultActionType, "DEFAULT_PASS", "policy.selectionAlgorithm.defaultActionType");

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
    if (!allowed.includes("DEFAULT_PASS")) {
      fail("POLICY_INVALID", `${path}.publishedAllowedActionTypes`, "DEFAULT_PASS_REQUIRED");
    }
    const contextualHumanOnly = new Set(
      boundary.contextualHumanOnlyActionTypes as string[],
    );
    const expectedRanking = allowed.filter(
      (actionType) => actionType !== "DEFAULT_PASS" && !contextualHumanOnly.has(actionType),
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

function compileSangtianAiDecisionSelectionV1(
  policy: SangtianAiDecisionPolicyV1,
  artifactSha256: string,
  inputValue: Readonly<SangtianAiDecisionPolicyInputV1>,
): SangtianAiDecisionPolicySelectionV1 {
  const input = validateInput(inputValue);
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
  const basisHash = sha256Canonical({
    runSeed: input.runSeed,
    chapterId: input.chapterId,
    decisionPointId: input.decisionPointId,
    seatId: input.seatId,
  });
  const ranked = seat.rankedNonDefaultActionTypes;
  const actionType = ranked.length > 0
    ? ranked[Number.parseInt(basisHash.slice(0, 8), 16) % ranked.length]!
    : policy.selectionAlgorithm.defaultActionType;
  if (!eligible.includes(actionType)) {
    fail("POLICY_INVALID", "policy.selection", "NOT_ELIGIBLE");
  }
  const body = {
    schemaVersion: "sangtian_ai_decision_policy_selection_v1" as const,
    policyRef: policy.policyRef,
    policyVersion: policy.policyVersion,
    policyHash: artifactSha256,
    resolvedContentPackageVersion: policy.sourceBinding.contentPackageVersion,
    resolvedContentPackageSha256: policy.sourceBinding.contentPackageSha256,
    inputHash: input.inputHash,
    actionType,
  };
  return deepFreeze({ ...body, selectionHash: sha256Canonical(body) });
}

function validateInput(value: unknown): SangtianAiDecisionPolicyInputV1 {
  const input = record(value, "input");
  exact(input, ACCEPTED_INPUT_FIELDS, "input");
  literal(input.schemaVersion, "sangtian_ai_decision_policy_input_v1", "input.schemaVersion");
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
  const sorted = [...eligible].sort(compareCanonicalText);
  if (sha256Canonical(eligible) !== sha256Canonical(sorted)) {
    fail("INPUT_INVALID", "input.eligibleActionTypes", "CANONICAL_ORDER");
  }
  sha(input.inputHash, "input.inputHash");
  const { inputHash, ...body } = input;
  if (sha256Canonical(body) !== inputHash) {
    fail("INPUT_HASH_MISMATCH", "input.inputHash");
  }
  return structuredClone(input) as unknown as SangtianAiDecisionPolicyInputV1;
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
      (actionType) => actionType !== "DEFAULT_PASS"
        && actionType !== "INVESTIGATE_LEDGER_SOURCE"
        && actionType !== "CONFIRM_LEDGER_SOURCE_WITH_EVIDENCE",
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

function unique(values: readonly string[], path: string): void {
  if (new Set(values).size !== values.length) fail("POLICY_INVALID", path, "DUPLICATE");
}

function nonEmpty(value: unknown, path: string): string {
  if (typeof value !== "string" || !value.trim()) {
    fail("POLICY_INVALID", path, "NON_EMPTY_STRING");
  }
  return value;
}

function literal<T>(value: unknown, expected: T, path: string): T {
  if (value !== expected) fail("POLICY_INVALID", path, `EXPECTED_${String(expected)}`);
  return expected;
}

function enumeration<T extends string>(
  value: unknown,
  expected: readonly T[],
  path: string,
): T {
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
