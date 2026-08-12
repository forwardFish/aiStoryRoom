import {
  computeNarrativeLogicalProjectionKey,
  computeNarrativeProjectionFingerprint,
  validateAudienceSafeNarrativeSourceV1,
  validateNarrativeArtifactV1,
  validateNarrativeProfileV1,
  validateNarrativeProjectionJobV1,
  type NarrativeArtifactV1,
  type NarrativeProfileV1,
  type NarrativeProjectionJobV1,
  type NarrativeRenderCandidateV1,
} from "./contracts.js";
import { NarrativeContextCompilerV1 } from "./context-compiler.js";
import { NarrativeFallbackRendererV1 } from "./deterministic-fallback.js";
import {
  PRESSURE_NARRATIVE_ERROR_CODES as ERROR,
  PressureNarrativeError,
  type PressureNarrativeErrorCode,
  failPressureNarrative,
} from "./errors.js";
import { NarrativePublisherV1 } from "./narrative-publisher.js";
import type {
  NarrativeClockPortV1,
  NarrativeProfileResolverPortV1,
  NarrativeProjectionClaimV1,
  NarrativeProjectionReceiptV1,
  NarrativeProjectionStatePortV1,
  NarrativeRendererPortV1,
  ProjectNarrativeRequestV1,
} from "./ports.js";
import { NarrativeTruthGuardV1 } from "./truth-guard.js";

export class OpenNovelNarrativeProjectorV1 {
  constructor(
    private readonly profiles: NarrativeProfileResolverPortV1,
    private readonly projections: NarrativeProjectionStatePortV1,
    private readonly renderer: NarrativeRendererPortV1,
    private readonly publisher: NarrativePublisherV1,
    private readonly clock: NarrativeClockPortV1,
    private readonly contextCompiler = new NarrativeContextCompilerV1(),
    private readonly truthGuard = new NarrativeTruthGuardV1(),
    private readonly fallback = new NarrativeFallbackRendererV1(),
  ) {}

  async project(request: ProjectNarrativeRequestV1): Promise<NarrativeProjectionReceiptV1> {
    const job = validateNarrativeProjectionJobV1(request.job);
    const rawProfile = await this.profiles.resolve(job.narrativeProfileVersion);
    if (rawProfile === null) failPressureNarrative(ERROR.PROFILE_UNAVAILABLE, "profile");
    const profile = validateNarrativeProfileV1(rawProfile, job.narrativeProfileVersion);
    const source = validateAudienceSafeNarrativeSourceV1(request.audienceSafeSource, job);
    const context = this.contextCompiler.compile(source, profile.contextCompilerVersion);
    const logicalProjectionKey = computeNarrativeLogicalProjectionKey(job);
    const requestFingerprint = computeNarrativeProjectionFingerprint(job, profile.projectorVersion);
    const claim = await this.projections.claim({
      logicalProjectionKey,
      requestFingerprint,
      jobId: job.jobId,
      workerId: requireText(request.workerId, "workerId"),
      nowMs: this.clock.nowMs(),
      leaseMs: profile.leaseMs,
    });

    if (claim.kind === "BUSY") {
      return receipt(logicalProjectionKey, requestFingerprint, null, "FAILED_RETRYABLE", "ACTIVE", null, claim.retryAtMs, ERROR.PROJECTION_BUSY);
    }
    if (claim.kind === "DEAD_LETTERED") {
      return receipt(logicalProjectionKey, requestFingerprint, null, "FAILED_RETRYABLE", "DEAD_LETTERED", null, null, claim.reasonCode);
    }
    assertClaimFingerprint(claim, requestFingerprint);
    if (claim.kind === "ALREADY_PUBLISHED") {
      const artifact = validateNarrativeArtifactV1(claim.artifact, job);
      return receipt(logicalProjectionKey, requestFingerprint, claim.projectionId, artifact.status, "ACTIVE", artifact, null, null);
    }

    if (claim.pendingArtifact) {
      const pending = validateNarrativeArtifactV1(claim.pendingArtifact, job);
      return this.publishOrRetry({
        job, profile, logicalProjectionKey, requestFingerprint, claim,
        artifact: pending,
      });
    }
    if (!profile.providerEnabled) {
      return this.renderFallback({ job, profile, logicalProjectionKey, requestFingerprint, claim, context });
    }

    const providerAttemptCount = claim.providerAttemptCount + 1;
    await this.projections.transition({
      projectionId: claim.projectionId,
      fence: claim.fence,
      status: "GENERATING",
      providerAttemptCount,
      deliveryFailureCount: claim.deliveryFailureCount,
      lastErrorCode: null,
      nextAttemptAtMs: null,
      pendingArtifact: null,
    });
    let candidate: NarrativeRenderCandidateV1;
    try {
      candidate = await this.renderer.render(context, profile);
    } catch (error) {
      return this.handleRenderFailure({
        error, job, profile, logicalProjectionKey, requestFingerprint, claim,
        context, providerAttemptCount,
      });
    }
    await this.projections.transition({
      projectionId: claim.projectionId,
      fence: claim.fence,
      status: "VALIDATING",
      providerAttemptCount,
      deliveryFailureCount: claim.deliveryFailureCount,
      lastErrorCode: null,
      nextAttemptAtMs: null,
      pendingArtifact: null,
    });
    let artifact: NarrativeArtifactV1;
    try {
      const report = this.truthGuard.validate(context, candidate, profile.truthGuardVersion);
      if (!report.accepted) {
        failPressureNarrative(ERROR.TRUTH_GUARD_REJECTED, "candidate", report.issueCodes.join("|"));
      }
      artifact = this.publisher.buildArtifact({
        job, profile, candidate, truthReport: report, renderMode: "PROVIDER",
      });
    } catch (error) {
      return this.handleRenderFailure({
        error, job, profile, logicalProjectionKey, requestFingerprint, claim,
        context, providerAttemptCount,
      });
    }
    return this.publishOrRetry({
      job, profile, logicalProjectionKey, requestFingerprint, claim, artifact,
      providerAttemptCount,
    });
  }

  private async handleRenderFailure(input: FallbackInput & { error: unknown }): Promise<NarrativeProjectionReceiptV1> {
    if (isFenceFailure(input.error)) throw input.error;
    const errorCode = renderFailureCode(input.error);
    const providerAttemptCount = input.providerAttemptCount ?? input.claim.providerAttemptCount;
    if (providerAttemptCount < input.profile.maxProviderAttempts) {
      const retryAtMs = this.clock.nowMs() + input.profile.retryBackoffMs[providerAttemptCount - 1]!;
      await this.projections.transition({
        projectionId: input.claim.projectionId,
        fence: input.claim.fence,
        status: "FAILED_RETRYABLE",
        providerAttemptCount,
        deliveryFailureCount: input.claim.deliveryFailureCount,
        lastErrorCode: errorCode,
        nextAttemptAtMs: retryAtMs,
        pendingArtifact: null,
      });
      return receipt(input.logicalProjectionKey, input.requestFingerprint, input.claim.projectionId, "FAILED_RETRYABLE", "ACTIVE", null, retryAtMs, errorCode);
    }
    return this.renderFallback(input);
  }

  private async renderFallback(input: FallbackInput): Promise<NarrativeProjectionReceiptV1> {
    try {
      const candidate = this.fallback.render(input.context, input.profile.fallbackTemplateVersion);
      const report = this.truthGuard.validate(input.context, candidate, input.profile.truthGuardVersion);
      if (!report.accepted) {
        failPressureNarrative(ERROR.FALLBACK_FAILED, "fallback", report.issueCodes.join("|"));
      }
      const artifact = this.publisher.buildArtifact({
        job: input.job,
        profile: input.profile,
        candidate,
        truthReport: report,
        renderMode: "AUTHORED_FALLBACK",
      });
      return this.publishOrRetry({ ...input, artifact });
    } catch (error) {
      if (isFenceFailure(error)) throw error;
      const code = error instanceof PressureNarrativeError ? error.code : ERROR.FALLBACK_FAILED;
      await this.projections.deadLetter({
        projectionId: input.claim.projectionId,
        fence: input.claim.fence,
        reasonCode: code,
        pendingArtifact: null,
      });
      return receipt(input.logicalProjectionKey, input.requestFingerprint, input.claim.projectionId, "FAILED_RETRYABLE", "DEAD_LETTERED", null, null, code);
    }
  }

  private async publishOrRetry(input: PublishInput): Promise<NarrativeProjectionReceiptV1> {
    try {
      const artifact = await this.publisher.publish({
        logicalProjectionKey: input.logicalProjectionKey,
        requestFingerprint: input.requestFingerprint,
        projectionId: input.claim.projectionId,
        fence: input.claim.fence,
        artifact: input.artifact,
        job: input.job,
      });
      await this.projections.markPublished({
        projectionId: input.claim.projectionId,
        fence: input.claim.fence,
        status: artifact.status,
        artifact,
      });
      return receipt(input.logicalProjectionKey, input.requestFingerprint, input.claim.projectionId, artifact.status, "ACTIVE", artifact, null, null);
    } catch (error) {
      if (isFenceFailure(error)) throw error;
      const failures = input.claim.deliveryFailureCount + 1;
      const code = ERROR.PUBLISH_FAILED;
      if (failures >= input.profile.maxDeliveryFailures) {
        await this.projections.deadLetter({
          projectionId: input.claim.projectionId,
          fence: input.claim.fence,
          reasonCode: code,
          pendingArtifact: input.artifact,
        });
        return receipt(input.logicalProjectionKey, input.requestFingerprint, input.claim.projectionId, "FAILED_RETRYABLE", "DEAD_LETTERED", null, null, code);
      }
      const retryAtMs = this.clock.nowMs() + deliveryBackoff(input.profile, failures);
      await this.projections.transition({
        projectionId: input.claim.projectionId,
        fence: input.claim.fence,
        status: "FAILED_RETRYABLE",
        providerAttemptCount: input.providerAttemptCount ?? input.claim.providerAttemptCount,
        deliveryFailureCount: failures,
        lastErrorCode: code,
        nextAttemptAtMs: retryAtMs,
        pendingArtifact: input.artifact,
      });
      return receipt(input.logicalProjectionKey, input.requestFingerprint, input.claim.projectionId, "FAILED_RETRYABLE", "ACTIVE", null, retryAtMs, code);
    }
  }
}

interface BaseProjectionInput {
  job: NarrativeProjectionJobV1;
  profile: NarrativeProfileV1;
  logicalProjectionKey: string;
  requestFingerprint: string;
  claim: Extract<NarrativeProjectionClaimV1, { kind: "CLAIMED" }>;
  providerAttemptCount?: number;
}

interface FallbackInput extends BaseProjectionInput {
  context: ReturnType<NarrativeContextCompilerV1["compile"]>;
}

interface PublishInput extends BaseProjectionInput {
  artifact: NarrativeArtifactV1;
}

function receipt(
  logicalProjectionKey: string,
  requestFingerprint: string,
  projectionId: string | null,
  status: NarrativeProjectionReceiptV1["status"],
  deliveryState: NarrativeProjectionReceiptV1["deliveryState"],
  artifact: NarrativeArtifactV1 | null,
  retryAtMs: number | null,
  errorCode: PressureNarrativeErrorCode | null,
): NarrativeProjectionReceiptV1 {
  return { logicalProjectionKey, requestFingerprint, projectionId, status, deliveryState, artifact, retryAtMs, errorCode };
}

function assertClaimFingerprint(
  claim: Extract<NarrativeProjectionClaimV1, { kind: "CLAIMED" | "ALREADY_PUBLISHED" }>,
  expected: string,
): void {
  if (claim.requestFingerprint !== expected) {
    failPressureNarrative(ERROR.SOURCE_BINDING_MISMATCH, "claim.requestFingerprint", "LOGICAL_PROJECTION_REVISION_MISMATCH");
  }
}

function requireText(value: unknown, path: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    failPressureNarrative(ERROR.JOB_INVALID, path, "NON_EMPTY_STRING");
  }
  return value;
}

function renderFailureCode(error: unknown): PressureNarrativeErrorCode {
  if (error instanceof PressureNarrativeError) return error.code;
  return ERROR.PROVIDER_FAILURE;
}

function isFenceFailure(error: unknown): boolean {
  return error instanceof PressureNarrativeError && error.code === ERROR.STALE_FENCE;
}

function deliveryBackoff(profile: NarrativeProfileV1, failures: number): number {
  const index = Math.min(Math.max(failures - 1, 0), profile.retryBackoffMs.length - 1);
  return profile.retryBackoffMs[index] ?? 0;
}
