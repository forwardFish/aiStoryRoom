import {
  loadPublishedSangtianAEmotionLifecycleBindingsV1,
  loadPublishedSangtianAEmotionPolicyV1,
  loadPublishedSangtianActionReleaseV1,
  loadPublishedSangtianAiDecisionPolicyV1,
  loadSangtianPressureChapterPackageV1,
} from "@ai-story/templates";
import type { PressureNarrativeProviderReadinessV1 } from "../production-config";
import { loadSangtianNarrativeAuthorityCatalogV1 } from "../narrative-authority/catalog";
import type { PressureChapterWorkerOwnershipSnapshotV1 } from "./contracts";
import type { PressureChapterWorkerLifecycleV1 } from "./worker-lifecycle";

export interface PressureChapterContentReadinessSnapshotV1 {
  ready: boolean;
  code?: "PRESSURE_CONTENT_NOT_READY";
}

export interface PressureChapterReleaseReadinessSnapshotV1 {
  ready: boolean;
  code?: "PRESSURE_RELEASE_NOT_READY";
}

export interface PressureChapterPublishedArtifactReadinessSnapshotV1 {
  content: PressureChapterContentReadinessSnapshotV1;
  release: PressureChapterReleaseReadinessSnapshotV1;
}

export interface PressureChapterOperationalReadinessSnapshotV1 {
  ready: boolean;
  status: "ready" | "degraded" | "not_ready";
  code?:
    | "PRESSURE_CONTENT_NOT_READY"
    | "PRESSURE_RELEASE_NOT_READY"
    | "PRESSURE_WORKER_OWNERSHIP_INVALID";
  narrative: PressureNarrativeProviderReadinessV1;
  workers: ReturnType<PressureChapterWorkerLifecycleV1["health"]>;
  workerOwnership: PressureChapterWorkerOwnershipSnapshotV1;
  failedLanes: string[];
  notReadyLanes: string[];
  content: PressureChapterContentReadinessSnapshotV1;
  release: PressureChapterReleaseReadinessSnapshotV1;
}

function verifyPublishedArtifactReadiness(): PressureChapterPublishedArtifactReadinessSnapshotV1 {
  try {
    loadSangtianPressureChapterPackageV1();
  } catch {
    return {
      content: {
        ready: false,
        code: "PRESSURE_CONTENT_NOT_READY",
      },
      release: { ready: true },
    };
  }
  try {
    loadPublishedSangtianActionReleaseV1();
    loadPublishedSangtianAiDecisionPolicyV1();
    loadPublishedSangtianAEmotionLifecycleBindingsV1();
    loadPublishedSangtianAEmotionPolicyV1();
    loadSangtianNarrativeAuthorityCatalogV1();
    return {
      content: { ready: true },
      release: { ready: true },
    };
  } catch {
    return {
      content: { ready: true },
      release: {
        ready: false,
        code: "PRESSURE_RELEASE_NOT_READY",
      },
    };
  }
}

export class PressureChapterOperationalReadinessV1 {
  constructor(
    private readonly lifecycle: PressureChapterWorkerLifecycleV1,
    private readonly narrative: PressureNarrativeProviderReadinessV1,
    private readonly publishedArtifactReadinessProbe:
      () => PressureChapterPublishedArtifactReadinessSnapshotV1 = verifyPublishedArtifactReadiness,
  ) {}

  readiness(): PressureChapterOperationalReadinessSnapshotV1 {
    const workers = this.lifecycle.health();
    const workerOwnership = this.lifecycle.ownership();
    const publishedArtifacts = this.publishedArtifactReadinessProbe();
    const { content, release } = publishedArtifacts;
    const failedLanes = workerOwnership.ownsWorkerLanes
      ? Object.entries(workers.lanes)
        .filter(([, lane]) => lane.enabled && lane.state === "FAILED")
        .map(([lane]) => lane)
        .sort()
      : [];
    const notReadyLanes = workerOwnership.ownsWorkerLanes
      ? Object.entries(workers.lanes)
        .filter(([, lane]) => lane.enabled && ["FAILED", "STOPPED", "DISABLED"].includes(lane.state))
        .map(([lane]) => lane)
        .sort()
      : [];
    const ready = workerOwnership.ready
      && content.ready
      && release.ready
      && (
        !workerOwnership.ownsWorkerLanes
        || (
          workers.enabled
          && workers.running
          && !workers.stopping
          && notReadyLanes.length === 0
        )
      );
    return {
      ready,
      status: ready ? (this.narrative.degraded ? "degraded" : "ready") : "not_ready",
      code: workerOwnership.ready
        ? (!content.ready ? content.code : (!release.ready ? release.code : undefined))
        : workerOwnership.code,
      narrative: { ...this.narrative },
      workers,
      workerOwnership,
      failedLanes,
      notReadyLanes,
      content,
      release,
    };
  }
}
