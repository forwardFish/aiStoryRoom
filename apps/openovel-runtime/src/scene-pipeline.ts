import { jsonrepair } from "jsonrepair";
import { normalizeSceneDraftTransport } from "./scene-draft-transport.js";
import {
  assembleSceneDraft,
  composeProtectedSceneDraft,
  narrativeSlotIds,
  validatePlayerVisibleFallbackDraft,
  validateSceneDraft,
  type AssemblyManifest,
  type BeatManifest,
  type PlayerVisibleFallbackDraft,
  type SceneAudit,
  type SceneDraft,
} from "./scene-expression.js";
import { preflightSceneReview } from "./scene-review-contract.js";
import {
  BoundedModelSceneTruthObserver,
  CriticalOnlySceneReviewPolicy,
  DisabledSceneTruthObserver,
  ObserveOnlySceneReviewPolicy,
  type SceneReviewCall,
  type SceneReviewPolicyModule,
  type SceneTruthObservation,
  type SceneTruthObserverModule,
} from "./scene-review-modules.js";
import type { StructuredShadowClaim } from "./truth-observation.js";
import type { NarrativeTruthContext } from "./truth-review.js";
import type { OpenNovelProvider } from "./types.js";
import { executeTurnModule, type TurnModuleExecutionRecord } from "./turn-modules.js";

export type ScenePipelineCall = SceneReviewCall;

export type ScenePipelineResult = {
  finalText: string;
  contextText: string;
  factText: string;
  shadowClaims: StructuredShadowClaim[];
  draft: SceneDraft;
  audit: SceneAudit;
  assemblyManifest: AssemblyManifest;
  disposition:
    | { kind: "USE_ORIGINAL"; draftId: string }
    | { kind: "USE_FALLBACK"; fallbackId: string; reason: string };
  calls: ScenePipelineCall[];
  reviewObservation: {
    observerModuleId: string;
    policyModuleId: string;
    status: SceneTruthObservation["status"];
    criticalFindings: string[];
    nonCriticalFindings: string[];
  };
  fallbackReason?: string;
};

export type SceneReviewMode = "ADVISORY" | "ENFORCING";
export type ScenePipelineModules = {
  observer: SceneTruthObserverModule;
  policy: SceneReviewPolicyModule;
};

export type SceneReviewRuntimeMode = "OFF" | "OBSERVE" | "CRITICAL_ONLY";

/** Selects a replaceable review lane without changing Settlement or Narrator. */
export function scenePipelineModulesFromEnv(
  provider: OpenNovelProvider,
  env: NodeJS.ProcessEnv = process.env,
): ScenePipelineModules {
  const requested = String(env.OPENOVEL_TRUTH_REVIEW_MODE || "CRITICAL_ONLY")
    .trim()
    .toUpperCase();
  const mode: SceneReviewRuntimeMode = requested === "OFF"
    ? "OFF"
    : requested === "OBSERVE"
      ? "OBSERVE"
      : "CRITICAL_ONLY";
  if (mode === "OFF") {
    return {
      observer: new DisabledSceneTruthObserver(),
      policy: new ObserveOnlySceneReviewPolicy(),
    };
  }
  return {
    observer: new BoundedModelSceneTruthObserver(provider),
    policy: mode === "OBSERVE"
      ? new ObserveOnlySceneReviewPolicy()
      : new CriticalOnlySceneReviewPolicy(),
  };
}

export type ScenePipelineInput = {
  turnId: string;
  runId: string;
  worldRevision: number;
  narratorRaw: string;
  manifest: BeatManifest;
  fallbackDraft: PlayerVisibleFallbackDraft;
  onModuleRecord?: (record: TurnModuleExecutionRecord) => Promise<void> | void;
  truthContexts: {
    actionPhase: NarrativeTruthContext;
    afterPhase: NarrativeTruthContext;
  };
};

export class SceneExpressionPipeline {
  private readonly observer: SceneTruthObserverModule;
  private readonly policy: SceneReviewPolicyModule;

  constructor(
    provider: OpenNovelProvider,
    reviewModeOrModules: SceneReviewMode | ScenePipelineModules = "ADVISORY",
  ) {
    if (typeof reviewModeOrModules === "string") {
      this.observer = reviewModeOrModules === "ENFORCING"
        ? new BoundedModelSceneTruthObserver(provider)
        : new DisabledSceneTruthObserver();
      this.policy = reviewModeOrModules === "ENFORCING"
        ? new CriticalOnlySceneReviewPolicy()
        : new ObserveOnlySceneReviewPolicy();
      return;
    }
    this.observer = reviewModeOrModules.observer;
    this.policy = reviewModeOrModules.policy;
  }

  moduleIds() {
    return {
      truthObserver: this.observer.moduleId,
      reviewPolicy: this.policy.moduleId,
    };
  }

  async resolve(input: ScenePipelineInput): Promise<ScenePipelineResult> {
    const calls: ScenePipelineCall[] = [];
    let draft: SceneDraft;
    let obligations;
    try {
      const narratorDraft = parseSceneDraft(input.narratorRaw, `${input.turnId}.draft.original`);
      validateSceneDraft(narratorDraft, input.manifest);
      draft = composeProtectedSceneDraft(narratorDraft, input.manifest);
      obligations = preflightSceneReview({
        draft,
        manifest: input.manifest,
        truthContexts: input.truthContexts,
      });
    } catch (error) {
      return fallback(input, calls, `SCENE_REVIEW_PREFLIGHT_INVALID:${errorMessage(error)}`);
    }

    const observerInput = {
      turnId: input.turnId,
      runId: input.runId,
      worldRevision: input.worldRevision,
      draft,
      manifest: input.manifest,
      obligations,
      truthContexts: input.truthContexts,
    };
    const observation = await executeTurnModule({
      runId: input.runId,
      turnId: input.turnId,
      descriptor: {
        kind: "TRUTH_OBSERVER",
        moduleId: this.observer.moduleId,
        mode: "OPTIONAL",
      },
      value: observerInput,
      execute: () => this.observer.observe(observerInput),
      onRecord: input.onModuleRecord,
    });
    calls.push(...observation.calls);
    const decision = await executeTurnModule({
      runId: input.runId,
      turnId: input.turnId,
      descriptor: {
        kind: "REVIEW_POLICY",
        moduleId: this.policy.moduleId,
        mode: "OPTIONAL",
      },
      value: observation,
      execute: () => this.policy.decide(observation),
      onRecord: input.onModuleRecord,
    });
    if (decision.kind === "FALLBACK") {
      return fallback(input, calls, decision.reason, observation, this.policy.moduleId);
    }
    return acceptStructuredDraft(input, draft, obligations, calls, observation, this.policy.moduleId);
  }
}

function acceptStructuredDraft(
  input: ScenePipelineInput,
  draft: SceneDraft,
  obligations: ReturnType<typeof preflightSceneReview>,
  calls: ScenePipelineCall[],
  observation: SceneTruthObservation,
  policyModuleId: string,
): ScenePipelineResult {
  const audit: SceneAudit = {
    draftId: draft.draftId,
    valid: true,
    slots: narrativeSlotIds
      .filter((slot) => draft.slots[slot])
      .map((slot) => ({
        slot,
        coveredTicketIds: input.manifest.tickets
          .filter((ticket) => ticket.slot === slot)
          .map((ticket) => ticket.ticketId),
        p0ConflictCodes: [],
        scenePhaseValid: true,
      })),
  };
  const assembled = assembleSceneDraft({ manifest: input.manifest, draft, audit });
  const factText = observation.status === "OBSERVED"
    ? observation.review.factText
    : obligations
        .filter((obligation) => obligation.mustAppear)
        .map((obligation) => obligation.reviewerMeaning)
        .join("\n");
  return {
    finalText: assembled.text,
    // Player Canon keeps the complete literary scene. Future model context
    // receives only server-owned beat facts so incidental prose cannot become
    // a durable object, location, order, or piece of evidence on the next turn.
    contextText: factText,
    factText,
    shadowClaims: observation.status === "OBSERVED" ? observation.review.shadowClaims : [],
    draft,
    audit,
    assemblyManifest: assembled.manifest,
    disposition: { kind: "USE_ORIGINAL", draftId: draft.draftId },
    calls,
    reviewObservation: observationSummary(observation, policyModuleId),
  };
}

export function parseSceneDraft(raw: string, expectedDraftId: string): SceneDraft {
  const parsed = JSON.parse(jsonrepair(stripFence(raw))) as unknown;
  const value = normalizeSceneDraftTransport(parsed) as SceneDraft;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("SCENE_DRAFT_NOT_OBJECT");
  }
  if (value.schemaVersion !== "omw.scene-draft.v1"
    || value.draftId !== expectedDraftId
    || value.owner !== "NARRATOR"
    || !value.slots || typeof value.slots !== "object") {
    throw new Error("SCENE_DRAFT_BINDING_INVALID");
  }
  return value;
}

function fallback(
  input: {
    turnId: string;
    manifest: BeatManifest;
    fallbackDraft: PlayerVisibleFallbackDraft;
  },
  calls: ScenePipelineCall[],
  reason: string,
  observation: SceneTruthObservation = skippedObservation(),
  policyModuleId = "review-policy.surface-fallback.v1",
): ScenePipelineResult {
  const draft = validatePlayerVisibleFallbackDraft(input.fallbackDraft, input.manifest);
  const audit: SceneAudit = {
    draftId: draft.draftId,
    valid: true,
    slots: narrativeSlotIds
      .filter((slot) => draft.slots[slot])
      .map((slot) => ({
        slot,
        coveredTicketIds: draft.surfaceProvenance[slot]!.coveredTicketIds,
        p0ConflictCodes: [],
        scenePhaseValid: true,
      })),
  };
  const assembled = assembleSceneDraft({ manifest: input.manifest, draft, audit });
  return {
    finalText: assembled.text,
    // Fallback prose is reader-visible only; durable context remains the
    // server-owned required meanings from the Beat Manifest.
    contextText: input.manifest.tickets
      .filter((ticket) => ticket.required)
      .map((ticket) => ticket.requiredMeaning)
      .join("\n"),
    factText: input.manifest.tickets
      .filter((ticket) => ticket.required)
      .map((ticket) => ticket.requiredMeaning)
      .join("\n"),
    shadowClaims: [],
    draft,
    audit,
    assemblyManifest: assembled.manifest,
    disposition: {
      kind: "USE_FALLBACK",
      fallbackId: draft.draftId,
      reason,
    },
    calls,
    reviewObservation: observationSummary(observation, policyModuleId),
    fallbackReason: reason,
  };
}
function skippedObservation(): SceneTruthObservation {
  return {
    status: "SKIPPED",
    observerModuleId: "truth-observer.not-reached.v1",
    calls: [],
    criticalFindings: [],
    nonCriticalFindings: [],
  };
}

function observationSummary(
  observation: SceneTruthObservation,
  policyModuleId: string,
): ScenePipelineResult["reviewObservation"] {
  return {
    observerModuleId: observation.observerModuleId,
    policyModuleId,
    status: observation.status,
    criticalFindings: [...observation.criticalFindings],
    nonCriticalFindings: [...observation.nonCriticalFindings],
  };
}
function stripFence(value: string) {
  return String(value || "").trim().replace(/^```(?:json)?\s*([\s\S]*?)\s*```$/iu, "$1");
}
function errorMessage(error: unknown) {
  return String((error as Error)?.message || error || "UNKNOWN").slice(0, 500);
}
