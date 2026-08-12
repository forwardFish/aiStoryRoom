import type {
  NarrativeArtifactV1,
  NarrativeContextV1,
  NarrativeProfileV1,
  NarrativeProjectionJobV1,
  NarrativeRenderCandidateV1,
} from "./contracts.js";
import type { PressureNarrativeErrorCode } from "./errors.js";

export type NarrativeProjectionStatusV1 =
  | "PENDING"
  | "GENERATING"
  | "VALIDATING"
  | "PUBLISHED"
  | "FALLBACK_PUBLISHED"
  | "FAILED_RETRYABLE";

export type NarrativeDeliveryStateV1 = "ACTIVE" | "DEAD_LETTERED";

export interface NarrativeProjectionClaimRequestV1 {
  logicalProjectionKey: string;
  requestFingerprint: string;
  jobId: string;
  workerId: string;
  nowMs: number;
  leaseMs: number;
}

export type NarrativeProjectionClaimV1 =
  | {
      kind: "CLAIMED";
      projectionId: string;
      fence: number;
      requestFingerprint: string;
      providerAttemptCount: number;
      deliveryFailureCount: number;
      pendingArtifact: NarrativeArtifactV1 | null;
    }
  | { kind: "BUSY"; retryAtMs: number }
  | {
      kind: "ALREADY_PUBLISHED";
      projectionId: string;
      requestFingerprint: string;
      artifact: NarrativeArtifactV1;
    }
  | { kind: "DEAD_LETTERED"; reasonCode: PressureNarrativeErrorCode };

export interface NarrativeProjectionTransitionV1 {
  projectionId: string;
  fence: number;
  status: NarrativeProjectionStatusV1;
  providerAttemptCount: number;
  deliveryFailureCount: number;
  lastErrorCode: PressureNarrativeErrorCode | null;
  nextAttemptAtMs: number | null;
  pendingArtifact: NarrativeArtifactV1 | null;
}

/**
 * This port owns NarrativeProjection metadata only. It intentionally has no
 * world, chapter, finale, canon, ending, or run-completion mutation method.
 */
export interface NarrativeProjectionStatePortV1 {
  claim(request: NarrativeProjectionClaimRequestV1): Promise<NarrativeProjectionClaimV1>;
  transition(request: NarrativeProjectionTransitionV1): Promise<void>;
  markPublished(request: {
    projectionId: string;
    fence: number;
    status: "PUBLISHED" | "FALLBACK_PUBLISHED";
    artifact: NarrativeArtifactV1;
  }): Promise<void>;
  deadLetter(request: {
    projectionId: string;
    fence: number;
    reasonCode: PressureNarrativeErrorCode;
    pendingArtifact: NarrativeArtifactV1 | null;
  }): Promise<void>;
}

export interface NarrativeProfileResolverPortV1 {
  resolve(profileVersion: string): Promise<unknown | null>;
}

/** Provider input is already audience-safe and contains no raw authority DTO. */
export interface NarrativeProviderPortV1 {
  render(context: NarrativeContextV1): Promise<unknown>;
}

/** Narrative-only persistence. There is deliberately no authoritative writer. */
export interface NarrativeArtifactPublisherPortV1 {
  publish(request: {
    logicalProjectionKey: string;
    requestFingerprint: string;
    projectionId: string;
    fence: number;
    artifact: NarrativeArtifactV1;
  }): Promise<NarrativeArtifactV1>;
}

export interface NarrativeClockPortV1 {
  nowMs(): number;
}

export interface NarrativeRendererPortV1 {
  render(
    context: NarrativeContextV1,
    profile: NarrativeProfileV1,
  ): Promise<NarrativeRenderCandidateV1>;
}

export interface ProjectNarrativeRequestV1 {
  job: NarrativeProjectionJobV1;
  audienceSafeSource: unknown;
  workerId: string;
}

export interface NarrativeProjectionReceiptV1 {
  logicalProjectionKey: string;
  requestFingerprint: string;
  projectionId: string | null;
  status: NarrativeProjectionStatusV1;
  deliveryState: NarrativeDeliveryStateV1;
  artifact: NarrativeArtifactV1 | null;
  retryAtMs: number | null;
  errorCode: PressureNarrativeErrorCode | null;
}
