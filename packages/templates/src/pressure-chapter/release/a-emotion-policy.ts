import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  CHAPTER_IDS_V1,
  hashWithoutField,
  isSha256,
  sha256Canonical,
  type ChapterIdV1,
} from "@ai-story/shared";
import { validatePressureChapterRouteRegistryV1 } from "../../runtime-contract/pressure-chapter-registry";

const DEFAULT_RELEASE_ROOT = resolve(
  __dirname,
  "../../../config/sangtian/pressure-chapter-v1/release",
);
const ARTIFACT_ID = "a_emotion_policy" as const;
const ARTIFACT_PATH = "a-emotion-policy.json" as const;
const EXPECTED_ARTIFACT_SHA256 =
  "c05a3d3e2b925cd81ad96435376dbbea02e352b0d4b6d6c3bb134be42f443f88";
const EXPECTED_ROUTE_KEY = "sangtian_pressure_chapter_v1" as const;

const SOURCE_KINDS = [
  "BEAT_COMMITTED",
  "FORMAL_COMMITMENT_COMMITTED",
  "CHAPTER_SETTLEMENT_COMMITTED",
  "FINALE_COMMITTED",
] as const;
const OUTCOME_BANDS = ["HIGH", "LOW", "MID"] as const;
const FINALE_VERDICTS = ["COSTLY_WIN", "LOSS", "WIN"] as const;
const PRESENTATIONS = ["FEED_ONLY", "CENTER_CARD", "KEY_MODAL"] as const;
const CARD_TYPES = ["CROSS_IMPACT", "CRISIS", "STAGE_VICTORY"] as const;
const WORKBENCH_TYPES = ["TALK", "INVESTIGATE", "TOKEN", "PLAN", "DEFER"] as const;

export type SangtianAEmotionOutcomeBandV1 = (typeof OUTCOME_BANDS)[number];
export type SangtianAEmotionFinaleVerdictV1 = (typeof FINALE_VERDICTS)[number];

export interface SangtianAEmotionPresentationPolicyV1 {
  recommendedPresentation: (typeof PRESENTATIONS)[number];
  centerCardType: (typeof CARD_TYPES)[number] | null;
  modalType: "CRISIS" | "STAGE_VICTORY" | null;
  responseOptions: Array<{
    code: string;
    preferredEntry: (typeof WORKBENCH_TYPES)[number];
    consumesManeuverOnSubmit: false;
  }>;
}

export interface SangtianAEmotionEventTemplateV1 {
  eventCode: string;
  eventFamily: string;
  kind: "PUBLIC_ACTION" | "DIRECT_IMPACT";
  severity: "MINOR" | "MAJOR" | "CRITICAL";
  audienceMode: "ACTION_BINDING_TARGETS" | "SOURCE_SEAT_ONLY";
  disclosureMode: "CONFIRMED_WITH_AUTHORITY_EVIDENCE_ELSE_HIDDEN";
  impactMode:
    | "SOURCE_ACTION_BOUND_WORKING_MUTATIONS"
    | "SOURCE_SEAT_CHAPTER_ARC"
    | "SOURCE_SEAT_FINALE_VERDICT";
  sharedObjectMode:
    | "FIRST_BOUND_COMMITMENT_OR_NULL"
    | "CHAPTER_OUTCOME"
    | "FINALE_VERDICT";
  factMode: "NONE" | "CHAPTER_OUTCOME_PUBLIC";
  milestoneMode: "NONE" | "CHAPTER_OUTCOME" | "FINALE_VERDICT";
  presentation: SangtianAEmotionPresentationPolicyV1;
}

export interface SangtianAEmotionPolicyV1 {
  schemaVersion: "sangtian_a_emotion_policy_v1";
  policyVersion: "sangtian-a-emotion-1.0.2";
  compilerVersion: "sangtian-a-emotion-compiler-1.0.0";
  runtimeProfile: "SANGTIAN_CONTINUOUS_CHAPTER_V1";
  sourceBinding: {
    contentPackageVersion: string;
    contentPackageSha256: string;
  };
  authorityBoundary: {
    allowedAuthoritySources: typeof SOURCE_KINDS;
    forbiddenInputClasses: readonly [
      "MUTABLE_UI_STATE",
      "NARRATIVE_ARTIFACT",
      "PROVIDER_OUTPUT",
    ];
    mayInferSecrets: false;
    mayInventEvidence: false;
    mayInventPromise: false;
    missingActionBindingPolicy: "EMIT_ZERO_EVENTS";
  };
  coverage: {
    chapterIds: typeof CHAPTER_IDS_V1;
    chapterOutcomeBands: typeof OUTCOME_BANDS;
    finaleVerdicts: typeof FINALE_VERDICTS;
  };
  beat: {
    skipActionTypes: readonly ["DEFAULT_PASS"];
    template: SangtianAEmotionEventTemplateV1;
  };
  chapter: {
    sourceActionSelection: "FIRST_CANONICAL_SEALED_ACTION_PER_AFFECTED_SEAT";
    templates: Array<{
      outcomeBand: SangtianAEmotionOutcomeBandV1;
      template: SangtianAEmotionEventTemplateV1;
    }>;
  };
  finale: {
    sourceActionSelection: "LAST_CANONICAL_COMMITTED_ACTION_PER_OUTCOME_SEAT";
    templates: Array<{
      verdict: SangtianAEmotionFinaleVerdictV1;
      template: SangtianAEmotionEventTemplateV1;
    }>;
  };
  policySha256: string;
}

export type CompileSangtianAEmotionTemplateInputV1 =
  | {
      sourceKind: "BEAT_COMMITTED";
      chapterId: ChapterIdV1;
      actionType: string;
    }
  | {
      sourceKind: "CHAPTER_SETTLEMENT_COMMITTED";
      chapterId: ChapterIdV1;
      outcomeBand: SangtianAEmotionOutcomeBandV1;
    }
  | {
      sourceKind: "FINALE_COMMITTED";
      verdict: SangtianAEmotionFinaleVerdictV1;
    };

export interface PublishedSangtianAEmotionPolicyV1 {
  releaseRoot: string;
  artifactSha256: string;
  policy: SangtianAEmotionPolicyV1;
  compileTemplate(
    input: Readonly<CompileSangtianAEmotionTemplateInputV1>,
  ): SangtianAEmotionEventTemplateV1 | null;
}

export class SangtianAEmotionPolicyError extends Error {
  readonly name = "SangtianAEmotionPolicyError";
  constructor(readonly code: string, readonly path: string, readonly detail?: string) {
    super(`${code}:${path}${detail ? `:${detail}` : ""}`);
  }
}

export function loadPublishedSangtianAEmotionPolicyV1(
  options: Readonly<{ releaseRoot?: string }> = {},
): PublishedSangtianAEmotionPolicyV1 {
  const releaseRoot = resolve(options.releaseRoot ?? DEFAULT_RELEASE_ROOT);
  const manifest = record(readJson(resolve(releaseRoot, "release-manifest.json")), "manifest");
  const registry = validatePressureChapterRouteRegistryV1(manifest.routeRegistry);
  const route = registry.routes.find((candidate) => candidate.routeKey === EXPECTED_ROUTE_KEY);
  if (!route || route.status !== "PUBLISHED" || route.createEnabled !== true) {
    fail("ROUTE_NOT_PUBLISHED", "manifest.routeRegistry.routes");
  }
  const artifacts = array(manifest.artifacts, "manifest.artifacts");
  const matches = artifacts.map((item, index) => record(item, `manifest.artifacts[${index}]`))
    .filter((item) => item.artifactId === ARTIFACT_ID);
  const artifact = matches[0];
  if (
    matches.length !== 1
    || !artifact
    || artifact.path !== ARTIFACT_PATH
    || artifact.version !== "sangtian-a-emotion-1.0.2"
    || artifact.hashMode !== "CANONICAL_JSON"
    || artifact.sha256 !== EXPECTED_ARTIFACT_SHA256
  ) fail("MANIFEST_INVALID", `manifest.artifacts.${ARTIFACT_ID}`);
  const rawPolicy = readJson(resolve(releaseRoot, ARTIFACT_PATH));
  if (sha256Canonical(rawPolicy) !== EXPECTED_ARTIFACT_SHA256) {
    fail("ARTIFACT_HASH_MISMATCH", ARTIFACT_PATH);
  }
  const policy = validateSangtianAEmotionPolicyV1(rawPolicy);
  if (
    policy.sourceBinding.contentPackageVersion !== route.contentPackageVersion
    || policy.sourceBinding.contentPackageSha256 !== route.contentPackageSha256
    || policy.runtimeProfile !== route.route.runtimeProfile
  ) fail("CONTENT_BINDING_MISMATCH", "policy.sourceBinding");
  return deepFreeze({
    releaseRoot,
    artifactSha256: EXPECTED_ARTIFACT_SHA256,
    policy,
    compileTemplate: (input: Readonly<CompileSangtianAEmotionTemplateInputV1>) =>
      compileSangtianAEmotionTemplateV1(policy, input),
  });
}

export function compileSangtianAEmotionTemplateV1(
  rawPolicy: unknown,
  input: Readonly<CompileSangtianAEmotionTemplateInputV1>,
): SangtianAEmotionEventTemplateV1 | null {
  const policy = validateSangtianAEmotionPolicyV1(rawPolicy);
  const candidate = record(input, "input");
  if (candidate.sourceKind === "BEAT_COMMITTED") {
    exact(candidate, ["sourceKind", "chapterId", "actionType"], "input");
    chapterId(candidate.chapterId, "input.chapterId");
    nonEmpty(candidate.actionType, "input.actionType");
    if (policy.beat.skipActionTypes.includes(candidate.actionType as "DEFAULT_PASS")) return null;
    return structuredClone(policy.beat.template);
  }
  if (candidate.sourceKind === "CHAPTER_SETTLEMENT_COMMITTED") {
    exact(candidate, ["sourceKind", "chapterId", "outcomeBand"], "input");
    chapterId(candidate.chapterId, "input.chapterId");
    enumeration(candidate.outcomeBand, OUTCOME_BANDS, "input.outcomeBand");
    return structuredClone(policy.chapter.templates.find(
      (entry) => entry.outcomeBand === candidate.outcomeBand,
    )!.template);
  }
  if (candidate.sourceKind === "FINALE_COMMITTED") {
    exact(candidate, ["sourceKind", "verdict"], "input");
    enumeration(candidate.verdict, FINALE_VERDICTS, "input.verdict");
    return structuredClone(policy.finale.templates.find(
      (entry) => entry.verdict === candidate.verdict,
    )!.template);
  }
  return fail("INPUT_INVALID", "input.sourceKind");
}

export function validateSangtianAEmotionPolicyV1(value: unknown): SangtianAEmotionPolicyV1 {
  const policy = record(value, "policy");
  exact(policy, [
    "schemaVersion", "policyVersion", "compilerVersion", "runtimeProfile",
    "sourceBinding", "authorityBoundary", "coverage", "beat", "chapter",
    "finale", "policySha256",
  ], "policy");
  literal(policy.schemaVersion, "sangtian_a_emotion_policy_v1", "policy.schemaVersion");
  literal(policy.policyVersion, "sangtian-a-emotion-1.0.2", "policy.policyVersion");
  literal(policy.compilerVersion, "sangtian-a-emotion-compiler-1.0.0", "policy.compilerVersion");
  literal(policy.runtimeProfile, "SANGTIAN_CONTINUOUS_CHAPTER_V1", "policy.runtimeProfile");
  const binding = record(policy.sourceBinding, "policy.sourceBinding");
  exact(binding, ["contentPackageVersion", "contentPackageSha256"], "policy.sourceBinding");
  nonEmpty(binding.contentPackageVersion, "policy.sourceBinding.contentPackageVersion");
  sha(binding.contentPackageSha256, "policy.sourceBinding.contentPackageSha256");

  const boundary = record(policy.authorityBoundary, "policy.authorityBoundary");
  exact(boundary, [
    "allowedAuthoritySources", "forbiddenInputClasses", "mayInferSecrets",
    "mayInventEvidence", "mayInventPromise", "missingActionBindingPolicy",
  ], "policy.authorityBoundary");
  exactArray(boundary.allowedAuthoritySources, SOURCE_KINDS, "policy.authorityBoundary.allowedAuthoritySources");
  exactArray(boundary.forbiddenInputClasses, [
    "MUTABLE_UI_STATE", "NARRATIVE_ARTIFACT", "PROVIDER_OUTPUT",
  ], "policy.authorityBoundary.forbiddenInputClasses");
  for (const key of ["mayInferSecrets", "mayInventEvidence", "mayInventPromise"] as const) {
    literal(boundary[key], false, `policy.authorityBoundary.${key}`);
  }
  literal(boundary.missingActionBindingPolicy, "EMIT_ZERO_EVENTS", "policy.authorityBoundary.missingActionBindingPolicy");

  const coverage = record(policy.coverage, "policy.coverage");
  exact(coverage, ["chapterIds", "chapterOutcomeBands", "finaleVerdicts"], "policy.coverage");
  exactArray(coverage.chapterIds, CHAPTER_IDS_V1, "policy.coverage.chapterIds");
  exactArray(coverage.chapterOutcomeBands, OUTCOME_BANDS, "policy.coverage.chapterOutcomeBands");
  exactArray(coverage.finaleVerdicts, FINALE_VERDICTS, "policy.coverage.finaleVerdicts");

  const beat = record(policy.beat, "policy.beat");
  exact(beat, ["skipActionTypes", "template"], "policy.beat");
  exactArray(beat.skipActionTypes, ["DEFAULT_PASS"], "policy.beat.skipActionTypes");
  validateTemplate(beat.template, "policy.beat.template", {
    kind: "PUBLIC_ACTION",
    audienceMode: "ACTION_BINDING_TARGETS",
    impactMode: "SOURCE_ACTION_BOUND_WORKING_MUTATIONS",
  });

  const chapter = record(policy.chapter, "policy.chapter");
  exact(chapter, ["sourceActionSelection", "templates"], "policy.chapter");
  literal(chapter.sourceActionSelection, "FIRST_CANONICAL_SEALED_ACTION_PER_AFFECTED_SEAT", "policy.chapter.sourceActionSelection");
  const chapterTemplates = array(chapter.templates, "policy.chapter.templates");
  exactArray(chapterTemplates.map((entry, index) => {
    const item = record(entry, `policy.chapter.templates[${index}]`);
    exact(item, ["outcomeBand", "template"], `policy.chapter.templates[${index}]`);
    validateTemplate(item.template, `policy.chapter.templates[${index}].template`, {
      kind: "DIRECT_IMPACT",
      audienceMode: "SOURCE_SEAT_ONLY",
      impactMode: "SOURCE_SEAT_CHAPTER_ARC",
    });
    return item.outcomeBand;
  }), OUTCOME_BANDS, "policy.chapter.templates.outcomeBands");

  const finale = record(policy.finale, "policy.finale");
  exact(finale, ["sourceActionSelection", "templates"], "policy.finale");
  literal(finale.sourceActionSelection, "LAST_CANONICAL_COMMITTED_ACTION_PER_OUTCOME_SEAT", "policy.finale.sourceActionSelection");
  const finaleTemplates = array(finale.templates, "policy.finale.templates");
  exactArray(finaleTemplates.map((entry, index) => {
    const item = record(entry, `policy.finale.templates[${index}]`);
    exact(item, ["verdict", "template"], `policy.finale.templates[${index}]`);
    validateTemplate(item.template, `policy.finale.templates[${index}].template`, {
      kind: "DIRECT_IMPACT",
      audienceMode: "SOURCE_SEAT_ONLY",
      impactMode: "SOURCE_SEAT_FINALE_VERDICT",
    });
    return item.verdict;
  }), FINALE_VERDICTS, "policy.finale.templates.verdicts");

  sha(policy.policySha256, "policy.policySha256");
  if (hashWithoutField(policy, "policySha256") !== policy.policySha256) {
    fail("POLICY_HASH_MISMATCH", "policy.policySha256");
  }
  return structuredClone(policy) as unknown as SangtianAEmotionPolicyV1;
}

function validateTemplate(
  value: unknown,
  path: string,
  expected: Pick<SangtianAEmotionEventTemplateV1, "kind" | "audienceMode" | "impactMode">,
): void {
  const template = record(value, path);
  exact(template, [
    "eventCode", "eventFamily", "kind", "severity", "audienceMode",
    "disclosureMode", "impactMode", "sharedObjectMode", "factMode",
    "milestoneMode", "presentation",
  ], path);
  nonEmpty(template.eventCode, `${path}.eventCode`);
  nonEmpty(template.eventFamily, `${path}.eventFamily`);
  literal(template.kind, expected.kind, `${path}.kind`);
  enumeration(template.severity, ["MINOR", "MAJOR", "CRITICAL"] as const, `${path}.severity`);
  literal(template.audienceMode, expected.audienceMode, `${path}.audienceMode`);
  literal(template.disclosureMode, "CONFIRMED_WITH_AUTHORITY_EVIDENCE_ELSE_HIDDEN", `${path}.disclosureMode`);
  literal(template.impactMode, expected.impactMode, `${path}.impactMode`);
  enumeration(template.sharedObjectMode, [
    "FIRST_BOUND_COMMITMENT_OR_NULL", "CHAPTER_OUTCOME", "FINALE_VERDICT",
  ] as const, `${path}.sharedObjectMode`);
  enumeration(template.factMode, ["NONE", "CHAPTER_OUTCOME_PUBLIC"] as const, `${path}.factMode`);
  enumeration(template.milestoneMode, ["NONE", "CHAPTER_OUTCOME", "FINALE_VERDICT"] as const, `${path}.milestoneMode`);
  const presentation = record(template.presentation, `${path}.presentation`);
  exact(presentation, [
    "recommendedPresentation", "centerCardType", "modalType", "responseOptions",
  ], `${path}.presentation`);
  const mode = enumeration(presentation.recommendedPresentation, PRESENTATIONS, `${path}.presentation.recommendedPresentation`);
  const cardType = presentation.centerCardType === null
    ? null
    : enumeration(presentation.centerCardType, CARD_TYPES, `${path}.presentation.centerCardType`);
  const modalType = presentation.modalType === null
    ? null
    : enumeration(presentation.modalType, ["CRISIS", "STAGE_VICTORY"] as const, `${path}.presentation.modalType`);
  if (mode === "FEED_ONLY" ? cardType !== null || modalType !== null : cardType === null) {
    fail("POLICY_INVALID", `${path}.presentation`, "CARD_MODE_MISMATCH");
  }
  if ((mode === "KEY_MODAL") !== (modalType !== null) || (modalType !== null && modalType !== cardType)) {
    fail("POLICY_INVALID", `${path}.presentation.modalType`, "MODAL_MODE_MISMATCH");
  }
  const options = array(presentation.responseOptions, `${path}.presentation.responseOptions`);
  if ((cardType === null && options.length !== 0) || (cardType !== null && options.length !== 3)) {
    fail("POLICY_INVALID", `${path}.presentation.responseOptions`, "CARD_ACTION_COUNT");
  }
  const codes = new Set<string>();
  options.forEach((entry, index) => {
    const option = record(entry, `${path}.presentation.responseOptions[${index}]`);
    exact(option, ["code", "preferredEntry", "consumesManeuverOnSubmit"], `${path}.presentation.responseOptions[${index}]`);
    const code = nonEmpty(option.code, `${path}.presentation.responseOptions[${index}].code`);
    if (codes.has(code)) fail("POLICY_INVALID", `${path}.presentation.responseOptions`, "DUPLICATE_CODE");
    codes.add(code);
    enumeration(option.preferredEntry, WORKBENCH_TYPES, `${path}.presentation.responseOptions[${index}].preferredEntry`);
    literal(option.consumesManeuverOnSubmit, false, `${path}.presentation.responseOptions[${index}].consumesManeuverOnSubmit`);
  });
}

function readJson(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as unknown;
  } catch (error) {
    return fail("READ_FAILED", path, error instanceof Error ? error.name : "UNKNOWN");
  }
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("POLICY_INVALID", path, "OBJECT");
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

function nonEmpty(value: unknown, path: string): string {
  if (typeof value !== "string" || value.trim().length === 0) fail("POLICY_INVALID", path, "NON_EMPTY_STRING");
  return value;
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
  throw new SangtianAEmotionPolicyError(`SANGTIAN_A_EMOTION_${code}`, path, detail);
}
