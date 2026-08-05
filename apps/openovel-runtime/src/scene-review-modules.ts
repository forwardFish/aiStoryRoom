import {
  buildP0ReviewRequest,
  parseAndCompareBoundedReviews,
  type BoundedSceneReview,
  type SurfaceObligation,
} from "./scene-review-contract.js";
import type { BeatManifest, SceneDraft } from "./scene-expression.js";
import type { NarrativeTruthContext } from "./truth-review.js";
import type {
  OpenNovelProvider,
  ProviderRequest,
  ProviderResult,
} from "./types.js";

export type SceneReviewCall = {
  stage: "coverage-reviewer" | "p0-reviewer";
  attempt: 1 | 2;
  request: ProviderRequest;
  result?: ProviderResult;
  error?: string;
};

export type SceneReviewModuleInput = {
  turnId: string;
  runId: string;
  worldRevision: number;
  draft: SceneDraft;
  manifest: BeatManifest;
  obligations: SurfaceObligation[];
  truthContexts: {
    actionPhase: NarrativeTruthContext;
    afterPhase: NarrativeTruthContext;
  };
};

export type SceneTruthObservation =
  | {
      status: "SKIPPED";
      observerModuleId: string;
      calls: SceneReviewCall[];
      criticalFindings: string[];
      nonCriticalFindings: string[];
    }
  | {
      status: "UNAVAILABLE";
      observerModuleId: string;
      calls: SceneReviewCall[];
      reason: string;
      criticalFindings: string[];
      nonCriticalFindings: string[];
    }
  | {
      status: "OBSERVED";
      observerModuleId: string;
      calls: SceneReviewCall[];
      review: BoundedSceneReview;
      criticalFindings: string[];
      nonCriticalFindings: string[];
    };

export interface SceneTruthObserverModule {
  readonly moduleId: string;
  observe(input: SceneReviewModuleInput): Promise<SceneTruthObservation>;
}

export type SceneReviewDecision =
  | {
      kind: "ACCEPT";
      policyModuleId: string;
      observation: SceneTruthObservation;
    }
  | {
      kind: "FALLBACK";
      policyModuleId: string;
      reason: string;
      observation: SceneTruthObservation;
    };

export interface SceneReviewPolicyModule {
  readonly moduleId: string;
  decide(observation: SceneTruthObservation): SceneReviewDecision;
}

/** No model call. Useful for low-cost MVP runs and deterministic tests. */
export class DisabledSceneTruthObserver implements SceneTruthObserverModule {
  readonly moduleId = "truth-observer.disabled.v1";

  async observe(): Promise<SceneTruthObservation> {
    return {
      status: "SKIPPED",
      observerModuleId: this.moduleId,
      calls: [],
      criticalFindings: [],
      nonCriticalFindings: [],
    };
  }
}

/** Detects structured critical conflicts and non-critical texture observations. */
export class BoundedModelSceneTruthObserver implements SceneTruthObserverModule {
  readonly moduleId = "truth-observer.bounded-model.v1";

  constructor(private readonly provider: OpenNovelProvider) {}

  async observe(input: SceneReviewModuleInput): Promise<SceneTruthObservation> {
    const p0Request = buildP0ReviewRequest({
      draft: input.draft,
      truthContexts: input.truthContexts,
    });
    const calls = await invokeReviewerWithOneTransportRetry(
      this.provider,
      "p0-reviewer",
      p0Request,
    );
    const p0Call = [...calls].reverse().find((call) => call.result);
    if (!p0Call?.result) {
      return unavailable(this.moduleId, calls, "SCENE_REVIEW_UNAVAILABLE");
    }
    if (p0Call.result.finishReason === "length") {
      return unavailable(this.moduleId, calls, "SCENE_REVIEW_TRUNCATED");
    }
    try {
      const review = parseAndCompareBoundedReviews({
        coverageRaw: undefined,
        p0Raw: p0Call.result.text,
        reviewerModel: p0Call.result.model,
        runId: input.runId,
        worldRevision: input.worldRevision,
        draft: input.draft,
        manifest: input.manifest,
        obligations: input.obligations,
        truthContexts: input.truthContexts,
      });
      return {
        status: "OBSERVED",
        observerModuleId: this.moduleId,
        calls,
        review,
        // These codes represent durable-world conflicts. They are kept
        // separate from coverage/style/texture observations by construction.
        criticalFindings: [...review.conflictCodes],
        nonCriticalFindings: [
          ...review.coverageWarnings,
          ...review.shadowClaims.map((claim) => claim.reason),
        ],
      };
    } catch (error) {
      return unavailable(
        this.moduleId,
        calls,
        `SCENE_REVIEW_INVALID:${errorMessage(error)}`,
      );
    }
  }
}

/** MVP policy: observation creates evidence but never rewrites or blocks prose. */
export class ObserveOnlySceneReviewPolicy implements SceneReviewPolicyModule {
  readonly moduleId = "review-policy.observe-only.v1";

  decide(observation: SceneTruthObservation): SceneReviewDecision {
    return { kind: "ACCEPT", policyModuleId: this.moduleId, observation };
  }
}

/** Optional production policy: only durable critical findings trigger fallback. */
export class CriticalOnlySceneReviewPolicy implements SceneReviewPolicyModule {
  readonly moduleId = "review-policy.critical-only.v1";

  decide(observation: SceneTruthObservation): SceneReviewDecision {
    if (observation.status === "UNAVAILABLE") {
      // Reviewer transport or schema failure is not evidence of a causal
      // conflict. Preserve the already valid Narrator scene and surface the
      // observation as an auditable warning; only a successfully observed,
      // server-compared P0 may replace player-visible prose.
      return { kind: "ACCEPT", policyModuleId: this.moduleId, observation };
    }
    if (observation.criticalFindings.length) {
      return {
        kind: "FALLBACK",
        policyModuleId: this.moduleId,
        reason: observation.criticalFindings[0]!,
        observation,
      };
    }
    return { kind: "ACCEPT", policyModuleId: this.moduleId, observation };
  }
}

function unavailable(
  observerModuleId: string,
  calls: SceneReviewCall[],
  reason: string,
): SceneTruthObservation {
  return {
    status: "UNAVAILABLE",
    observerModuleId,
    calls,
    reason,
    criticalFindings: [],
    nonCriticalFindings: [reason],
  };
}

async function invokeReviewerWithOneTransportRetry(
  provider: OpenNovelProvider,
  stage: SceneReviewCall["stage"],
  request: ProviderRequest,
): Promise<SceneReviewCall[]> {
  const first = await invokeReviewer(provider, stage, request, 1);
  if (first.result) return [first];
  return [first, await invokeReviewer(provider, stage, request, 2)];
}

async function invokeReviewer(
  provider: OpenNovelProvider,
  stage: SceneReviewCall["stage"],
  request: ProviderRequest,
  attempt: 1 | 2,
): Promise<SceneReviewCall> {
  try {
    const result = await provider.generate(request);
    return { stage, attempt, request, result };
  } catch (error) {
    return { stage, attempt, request, error: errorMessage(error) };
  }
}

function errorMessage(error: unknown) {
  return String((error as Error)?.message || error || "UNKNOWN").slice(0, 500);
}
