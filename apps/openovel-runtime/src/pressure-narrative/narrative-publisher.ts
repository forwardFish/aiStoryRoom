import { canonicalNarrativeJson } from "./canonical.js";
import {
  computeNarrativeArtifactContentHash,
  validateNarrativeArtifactV1,
  type NarrativeArtifactV1,
  type NarrativeProfileV1,
  type NarrativeProjectionJobV1,
  type NarrativeRenderCandidateV1,
  type NarrativeTruthReportV1,
} from "./contracts.js";
import {
  PRESSURE_NARRATIVE_ERROR_CODES as ERROR,
  failPressureNarrative,
} from "./errors.js";
import type { NarrativeArtifactPublisherPortV1 } from "./ports.js";
import { assertPressureNarrativeOutputSurfaceV1 } from "./output-surface-guard.js";

export class NarrativePublisherV1 {
  constructor(private readonly artifactPort: NarrativeArtifactPublisherPortV1) {}

  buildArtifact(input: {
    job: NarrativeProjectionJobV1;
    profile: NarrativeProfileV1;
    candidate: NarrativeRenderCandidateV1;
    truthReport: NarrativeTruthReportV1;
    renderMode: "PROVIDER" | "AUTHORED_FALLBACK";
  }): NarrativeArtifactV1 {
    if (!input.truthReport.accepted) {
      failPressureNarrative(
        ERROR.TRUTH_GUARD_REJECTED,
        "truthReport",
        input.truthReport.issueCodes.join("|"),
      );
    }
    assertPressureNarrativeOutputSurfaceV1(input.candidate.text, "candidate.text");
    const status = input.renderMode === "PROVIDER" ? "PUBLISHED" : "FALLBACK_PUBLISHED";
    const content = {
      schemaVersion: "openovel_narrative_artifact_v1" as const,
      jobId: input.job.jobId,
      runId: input.job.runId,
      projectionKind: input.job.projectionKind,
      sourceId: input.job.sourceId,
      sourceCommitHash: input.job.sourceCommitHash,
      sourceContentHash: input.job.sourceContentHash,
      audience: structuredClone(input.job.audience),
      narrativeProfileVersion: input.job.narrativeProfileVersion,
      projectorVersion: input.profile.projectorVersion,
      text: input.candidate.text,
      usedFactRefs: [...input.candidate.usedFactRefs],
      validationReportHash: input.truthReport.reportHash,
      renderMode: input.renderMode,
      status,
    };
    return validateNarrativeArtifactV1({
      ...content,
      contentHash: computeNarrativeArtifactContentHash(content),
    }, input.job);
  }

  async publish(input: {
    logicalProjectionKey: string;
    requestFingerprint: string;
    projectionId: string;
    fence: number;
    artifact: NarrativeArtifactV1;
    job: NarrativeProjectionJobV1;
  }): Promise<NarrativeArtifactV1> {
    assertPressureNarrativeOutputSurfaceV1(input.artifact.text, "publisher.artifact.text");
    const published = validateNarrativeArtifactV1(
      await this.artifactPort.publish({
        logicalProjectionKey: input.logicalProjectionKey,
        requestFingerprint: input.requestFingerprint,
        projectionId: input.projectionId,
        fence: input.fence,
        artifact: structuredClone(input.artifact),
      }),
      input.job,
    );
    if (canonicalNarrativeJson(published) !== canonicalNarrativeJson(input.artifact)) {
      failPressureNarrative(ERROR.PUBLISH_FAILED, "publisher.artifact", "IDEMPOTENCY_MISMATCH");
    }
    return published;
  }
}
