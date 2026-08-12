import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { sha256Canonical } from "@ai-story/shared";
import { loadPublishedSangtianActionReleaseV1 } from "@ai-story/templates";
import type {
  NarrativeProfileResolverPortV1,
} from "@apps/openovel-runtime/pressure-narrative/ports";
import type {
  NarrativeProfileV1,
} from "@apps/openovel-runtime/pressure-narrative/contracts";
import {
  PRESSURE_NARRATIVE_PRODUCTION_ERROR_CODES as ERROR,
  failPressureNarrativeProduction,
} from "./errors";

export const PRESSURE_NARRATIVE_PRODUCTION_RELEASE_V1 = Object.freeze({
  projectorVersion: "openovel-pressure-projector-1.0.0",
  contextCompilerVersion: "openovel-pressure-context-compiler-1.0.0",
  truthGuardVersion: "openovel-pressure-truth-guard-1.0.0",
  fallbackTemplateVersion: "openovel-pressure-fallback-template-1.0.0",
} as const);

export interface PressureNarrativeOperationalProfileOptionsV1 {
  providerTimeoutMs: number;
  projectionLeaseMs: number;
  providerMaxAttempts: number;
  providerRetryBackoffMs: number[];
  maxDeliveryFailures: number;
}

export const DEFAULT_PRESSURE_NARRATIVE_OPERATIONAL_PROFILE_V1 = Object.freeze({
  providerTimeoutMs: 30_000,
  projectionLeaseMs: 60_000,
  providerMaxAttempts: 3,
  providerRetryBackoffMs: Object.freeze([1_000, 5_000]),
  maxDeliveryFailures: 5,
});

/** Hash-verifies the published narrative artifact and resolves only its route pin. */
export class PublishedPressureNarrativeProfileResolverV1
implements NarrativeProfileResolverPortV1 {
  readonly profileVersion: string;
  readonly projectorVersion =
    PRESSURE_NARRATIVE_PRODUCTION_RELEASE_V1.projectorVersion;
  private readonly profile: NarrativeProfileV1;

  constructor(input: Readonly<{
    providerConfigured: boolean;
    options?: Partial<PressureNarrativeOperationalProfileOptionsV1>;
  }>) {
    const published = loadAndValidatePublishedNarrativeProfileV1();
    this.profileVersion = published.profileVersion;
    const operational = normalizeOperationalOptions(input.options);
    const providerEnabled = input.providerConfigured === true;
    this.profile = Object.freeze({
      profileVersion: published.profileVersion,
      projectorVersion: this.projectorVersion,
      contextCompilerVersion:
        PRESSURE_NARRATIVE_PRODUCTION_RELEASE_V1.contextCompilerVersion,
      truthGuardVersion:
        PRESSURE_NARRATIVE_PRODUCTION_RELEASE_V1.truthGuardVersion,
      fallbackTemplateVersion:
        PRESSURE_NARRATIVE_PRODUCTION_RELEASE_V1.fallbackTemplateVersion,
      maxProviderAttempts: providerEnabled
        ? operational.providerMaxAttempts
        : 1,
      retryBackoffMs: providerEnabled
        ? [...operational.providerRetryBackoffMs]
        : [],
      providerTimeoutMs: operational.providerTimeoutMs,
      leaseMs: operational.projectionLeaseMs,
      providerEnabled,
      maxDeliveryFailures: operational.maxDeliveryFailures,
    });
  }

  async resolve(profileVersion: string): Promise<NarrativeProfileV1 | null> {
    return profileVersion === this.profileVersion
      ? structuredClone(this.profile)
      : null;
  }
}

interface PublishedNarrativeProfileArtifactV1 {
  profileVersion: string;
}

function loadAndValidatePublishedNarrativeProfileV1():
PublishedNarrativeProfileArtifactV1 {
  const release = loadPublishedSangtianActionReleaseV1();
  const manifest = jsonRecord(
    readFileSync(resolve(release.releaseRoot, "release-manifest.json"), "utf8"),
    "releaseManifest",
  );
  if (!Array.isArray(manifest.artifacts)) invalid("releaseManifest.artifacts");
  const artifacts = manifest.artifacts.filter((value) => {
    return value && typeof value === "object"
      && (value as Record<string, unknown>).artifactId === "narrative_profile";
  });
  if (artifacts.length !== 1) invalid("releaseManifest.artifacts.narrative_profile");
  const artifact = record(artifacts[0], "narrativeProfileArtifact");
  if (
    artifact.path !== "narrative-profile.json"
    || artifact.hashMode !== "CANONICAL_JSON"
    || artifact.version !== release.routeRegistration.narrativeProfileVersion
    || typeof artifact.sha256 !== "string"
    || !/^[a-f0-9]{64}$/.test(artifact.sha256)
  ) invalid("releaseManifest.artifacts.narrative_profile", "BINDING");

  const rawProfile = readFileSync(
    resolve(release.releaseRoot, String(artifact.path)),
    "utf8",
  );
  const profile = jsonRecord(rawProfile, "narrativeProfile");
  if (sha256Canonical(profile) !== artifact.sha256) {
    invalid("narrativeProfile", "HASH_MISMATCH");
  }
  validatePublishedContract(profile, release.routeRegistration.narrativeProfileVersion);
  return { profileVersion: String(profile.profileVersion) };
}

function validatePublishedContract(
  profile: Record<string, unknown>,
  routeProfileVersion: string,
): void {
  exact(profile, [
    "schemaVersion",
    "profileId",
    "profileVersion",
    "runtimeRole",
    "audienceProjectionRequiredBeforeRender",
    "projectionBindings",
    "pipeline",
    "statuses",
    "sourceBinding",
    "failurePolicy",
    "authorityCapabilities",
  ], "narrativeProfile");
  if (
    profile.schemaVersion !== "openovel_pressure_narrative_profile_v1"
    || profile.profileId !== "openovel_pressure_narrative_v1"
    || profile.profileVersion !== routeProfileVersion
    || profile.runtimeRole !== "NON_AUTHORITATIVE_NARRATIVE_PROJECTOR"
    || profile.audienceProjectionRequiredBeforeRender !== true
  ) invalid("narrativeProfile", "ROUTE_OR_TRUST_BINDING");
  exactArray(profile.pipeline, [
    "AUDIENCE_PROJECTOR",
    "NARRATIVE_CONTEXT_COMPILER",
    "NARRATIVE_RENDERER",
    "NARRATIVE_TRUTH_GUARD",
    "NARRATIVE_FALLBACK_RENDERER",
    "NARRATIVE_PUBLISHER",
  ], "narrativeProfile.pipeline");
  exactArray(profile.statuses, [
    "PENDING",
    "GENERATING",
    "VALIDATING",
    "PUBLISHED",
    "FALLBACK_PUBLISHED",
    "FAILED_RETRYABLE",
  ], "narrativeProfile.statuses");
  if (!Array.isArray(profile.authorityCapabilities)
    || profile.authorityCapabilities.length !== 0) {
    invalid("narrativeProfile.authorityCapabilities", "MUST_BE_EMPTY");
  }
  const sourceBinding = record(profile.sourceBinding, "narrativeProfile.sourceBinding");
  if (
    sourceBinding.requiresSourceCommitHash !== true
    || sourceBinding.requiresSourceContentHash !== true
    || sourceBinding.requiresAudience !== true
  ) invalid("narrativeProfile.sourceBinding", "REQUIRED_FENCES");
  exactArray(sourceBinding.idempotencyScope, [
    "projectionKind",
    "sourceCommitHash",
    "sourceContentHash",
    "narrativeProfileVersion",
    "projectorVersion",
    "audience",
  ], "narrativeProfile.sourceBinding.idempotencyScope");
  const failure = record(profile.failurePolicy, "narrativeProfile.failurePolicy");
  if (
    failure.providerFailureMode !== "RETRY_OR_DETERMINISTIC_FALLBACK"
    || failure.truthGuardFailureMode !== "REJECT_ARTIFACT_THEN_RETRY_OR_FALLBACK"
    || failure.publisherFailureMode !== "RESUME_FROM_DURABLE_CHECKPOINT"
    || failure.mayBlockAuthorityCommit !== false
    || failure.mayRollbackAuthorityCommit !== false
    || failure.mayReopenTerminalState !== false
  ) invalid("narrativeProfile.failurePolicy", "AUTHORITY_ISOLATION");
}

function normalizeOperationalOptions(
  value: Partial<PressureNarrativeOperationalProfileOptionsV1> | undefined,
): PressureNarrativeOperationalProfileOptionsV1 {
  const options = {
    ...DEFAULT_PRESSURE_NARRATIVE_OPERATIONAL_PROFILE_V1,
    ...(value ?? {}),
    providerRetryBackoffMs: [
      ...(value?.providerRetryBackoffMs
        ?? DEFAULT_PRESSURE_NARRATIVE_OPERATIONAL_PROFILE_V1.providerRetryBackoffMs),
    ],
  };
  positive(options.providerTimeoutMs, "options.providerTimeoutMs", 300_000);
  positive(options.projectionLeaseMs, "options.projectionLeaseMs", 3_600_000);
  positive(options.providerMaxAttempts, "options.providerMaxAttempts", 10);
  positive(options.maxDeliveryFailures, "options.maxDeliveryFailures", 100);
  if (options.providerRetryBackoffMs.length !== options.providerMaxAttempts - 1) {
    invalid("options.providerRetryBackoffMs", "ATTEMPT_COUNT_MISMATCH");
  }
  for (const [index, delay] of options.providerRetryBackoffMs.entries()) {
    if (!Number.isSafeInteger(delay) || delay < 0 || delay > 86_400_000) {
      invalid(`options.providerRetryBackoffMs[${index}]`, "DELAY");
    }
  }
  return options;
}

function jsonRecord(value: string, path: string): Record<string, unknown> {
  try {
    return record(JSON.parse(value), path);
  } catch (error) {
    return invalid(
      path,
      error instanceof Error ? error.name : "JSON_PARSE",
    );
  }
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return invalid(path, "OBJECT");
  }
  return value as Record<string, unknown>;
}

function exact(
  value: Record<string, unknown>,
  fields: readonly string[],
  path: string,
): void {
  const unknown = Object.keys(value).find((field) => !fields.includes(field));
  if (unknown) invalid(`${path}.${unknown}`, "UNKNOWN_FIELD");
  const missing = fields.find((field) => !(field in value));
  if (missing) invalid(`${path}.${missing}`, "MISSING_FIELD");
}

function exactArray(value: unknown, expected: readonly string[], path: string): void {
  if (
    !Array.isArray(value)
    || value.length !== expected.length
    || value.some((entry, index) => entry !== expected[index])
  ) invalid(path, "ORDERED_EXACT_ARRAY");
}

function positive(value: number, path: string, max: number): void {
  if (!Number.isSafeInteger(value) || value <= 0 || value > max) {
    invalid(path, `INTEGER_1_${max}`);
  }
}

function invalid(path: string, detail?: string): never {
  return failPressureNarrativeProduction(
    ERROR.RELEASE_PROFILE_INVALID,
    path,
    detail,
  );
}
