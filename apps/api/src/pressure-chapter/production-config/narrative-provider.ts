import type { NarrativeContextV1 } from "@apps/openovel-runtime/pressure-narrative/contracts";
import type { NarrativeProviderPortV1 } from "@apps/openovel-runtime/pressure-narrative/ports";
import type {
  PressureDecisionPresentationContextV1,
  PressureDecisionPresentationProviderPortV1,
} from "../game-projection/decision-presentation";
import {
  compilePressureDecisionStoryPackV1,
  parsePressureStoryPackLogModeV1,
  pressureStoryPackDiagnosticLogV1,
} from "./decision-story-pack";
import {
  buildPressureDecisionSystemInstructionV1,
  buildPressureStorySystemInstructionV1,
} from "./pressure-prompt-layers";
import {
  buildPressureNarrativeReviewUnitsV1,
  buildPressureNarrativeTruthReviewInstructionV1,
  pressureNarrativeTruthReviewPayloadV1,
  validatePressureNarrativeTruthReviewV1,
} from "./pressure-narrative-truth-review";
import { validateNarrativeRenderCandidateV1 } from "@apps/openovel-runtime/pressure-narrative/contracts";

export type PressureNarrativeProviderModeV1 =
  | "EXTERNAL_PROVIDER"
  | "DETERMINISTIC_FALLBACK_ONLY";

export interface PressureNarrativeProviderReadinessV1 {
  ready: true;
  mode: PressureNarrativeProviderModeV1;
  externalProviderConfigured: boolean;
  degraded: boolean;
  provider: "deepseek" | "deterministic-fallback";
  model: string | null;
}

export interface PressureNarrativeProviderConfigurationV1 {
  provider: NarrativeProviderPortV1 | null;
  decisionPresentationProvider: PressureDecisionPresentationProviderPortV1 | null;
  readiness: PressureNarrativeProviderReadinessV1;
}

/** Narrative-only Provider construction. Decision automation never receives it. */
export function createPressureNarrativeProviderFromEnvV1(
  environment: NodeJS.ProcessEnv,
  fetchImpl: typeof fetch = fetch,
): PressureNarrativeProviderConfigurationV1 {
  const apiKey = clean(environment.DEEPSEEK_API_KEY);
  const requested = clean(environment.PRESSURE_NARRATIVE_PROVIDER).toLowerCase();
  if (requested && requested !== "deepseek" && requested !== "deterministic") {
    throw new Error("PRESSURE_NARRATIVE_PROVIDER_INVALID");
  }
  if (requested === "deterministic" || !apiKey) {
    return {
      provider: null,
      decisionPresentationProvider: null,
      readiness: {
        ready: true,
        mode: "DETERMINISTIC_FALLBACK_ONLY",
        externalProviderConfigured: false,
        degraded: true,
        provider: "deterministic-fallback",
        model: null,
      },
    };
  }
  const model = clean(environment.PRESSURE_NARRATIVE_MODEL)
    || clean(environment.DEEPSEEK_MODEL)
    || "deepseek-chat";
  const endpoint = deepSeekNarrativeEndpoint(
    environment.PRESSURE_NARRATIVE_BASE_URL || environment.DEEPSEEK_BASE_URL,
  );
  const provider = new DeepSeekPressureNarrativeProviderV1({
      apiKey,
      endpoint,
      model,
      fetchImpl,
    });
  return {
    provider,
    decisionPresentationProvider: provider,
    readiness: {
      ready: true,
      mode: "EXTERNAL_PROVIDER",
      externalProviderConfigured: true,
      degraded: false,
      provider: "deepseek",
      model,
    },
  };
}

export class DeepSeekPressureNarrativeProviderV1
implements NarrativeProviderPortV1, PressureDecisionPresentationProviderPortV1 {
  constructor(private readonly options: Readonly<{
    apiKey: string;
    endpoint: string;
    model: string;
    fetchImpl: typeof fetch;
  }>) {}

  async render(context: NarrativeContextV1): Promise<unknown> {
    const storyPack = compilePressureDecisionStoryPackV1(context);
    const storyPackLogMode = parsePressureStoryPackLogModeV1(
      process.env.PRESSURE_DECISION_STORY_PACK_LOG
        ?? process.env.PRESSURE_N1_STORY_PACK_LOG,
    );
    if (storyPack && storyPackLogMode !== "off") {
      console.info(pressureStoryPackDiagnosticLogV1(storyPack, context, storyPackLogMode));
    }
    const response = await this.options.fetchImpl(this.options.endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.options.apiKey}`,
      },
      body: JSON.stringify({
        model: this.options.model,
        thinking: { type: "disabled" },
        response_format: { type: "json_object" },
        max_tokens: 2_048,
        temperature: 0.4,
        messages: [
          {
            role: "system",
            content: buildPressureStorySystemInstructionV1(storyPack !== null),
          },
          {
            role: "user",
            content: JSON.stringify(storyPack
              ? { storyPack, authority: providerAuthorityEnvelope(context) }
              : context),
          },
        ],
      }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!response.ok) throw new Error(`NARRATIVE_PROVIDER_HTTP_${response.status}`);
    const payload = await response.json() as {
      choices?: Array<{ message?: { content?: unknown } }>;
    };
    const content = payload.choices?.[0]?.message?.content;
    if (typeof content !== "string" || !content.trim()) {
      throw new Error("NARRATIVE_PROVIDER_EMPTY_RESPONSE");
    }
    let candidate: ReturnType<typeof validateNarrativeRenderCandidateV1>;
    try {
      candidate = validateNarrativeRenderCandidateV1(
        normalizeNarrativeCandidateOrderV1(JSON.parse(content)),
      );
    } catch (error) {
      const logMode = clean(process.env.PRESSURE_NARRATIVE_TRUTH_REVIEW_LOG
        ?? process.env.PRESSURE_NARRATIVE_GROUNDING_LOG).toLowerCase();
      if (logMode === "full" || logMode === "1") {
        console.info(JSON.stringify({
          event: "PRESSURE_NARRATIVE_CANDIDATE_INVALID",
          contextHash: context.contextHash,
          reason: error instanceof Error ? error.message : "UNKNOWN",
          providerContent: content,
        }));
      }
      throw new Error("NARRATIVE_PROVIDER_INVALID_OUTPUT");
    }
    if (context.projectionKind === "BEAT_NARRATIVE") {
      await this.assertDurableTruth(context, storyPack, candidate);
    }
    return candidate;
  }

  private async assertDurableTruth(
    context: NarrativeContextV1,
    storyPack: ReturnType<typeof compilePressureDecisionStoryPackV1>,
    candidate: ReturnType<typeof validateNarrativeRenderCandidateV1>,
  ): Promise<void> {
    const response = await this.options.fetchImpl(this.options.endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.options.apiKey}`,
      },
      body: JSON.stringify({
        model: this.options.model,
        thinking: { type: "disabled" },
        response_format: { type: "json_object" },
        max_tokens: 1_024,
        temperature: 0,
        messages: [
          { role: "system", content: buildPressureNarrativeTruthReviewInstructionV1() },
          {
            role: "user",
            content: JSON.stringify(pressureNarrativeTruthReviewPayloadV1({
              storyPack,
              authority: context,
              candidate,
            })),
          },
        ],
      }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!response.ok) throw new Error(`NARRATIVE_TRUTH_REVIEW_PROVIDER_HTTP_${response.status}`);
    const payload = await response.json() as {
      choices?: Array<{ message?: { content?: unknown } }>;
    };
    const content = payload.choices?.[0]?.message?.content;
    if (typeof content !== "string" || !content.trim()) {
      throw new Error("NARRATIVE_TRUTH_REVIEW_PROVIDER_EMPTY_RESPONSE");
    }
    const reviewUnits = buildPressureNarrativeReviewUnitsV1(candidate.text);
    const review = validatePressureNarrativeTruthReviewV1(
      JSON.parse(content),
      reviewUnits,
      [
        ...context.facts.map((fact) => fact.factId),
        ...context.objects.map((object) => object.objectVersionId),
        ...context.knowledge.map((item) => item.knowledgeId),
        ...context.allowedClaims.map((claim) => claim.refId),
      ],
      context.allowedClaims.filter((claim) => claim.required).map((claim) => claim.refId),
    );
    const unsupportedAssessments = review.assessments.filter(
      (assessment) => assessment.classification === "UNSUPPORTED_DURABLE",
    );
    const logMode = clean(process.env.PRESSURE_NARRATIVE_TRUTH_REVIEW_LOG
      ?? process.env.PRESSURE_NARRATIVE_GROUNDING_LOG).toLowerCase();
    if (logMode && logMode !== "off" && logMode !== "0") {
      console.info(JSON.stringify({
        event: "PRESSURE_NARRATIVE_TRUTH_REVIEW",
        contextHash: context.contextHash,
        assessments: review.assessments,
        missingRequiredRefs: review.missingRequiredRefs,
        ...(logMode === "full" || logMode === "1" ? {
          candidateText: candidate.text,
          reviewUnits,
        } : {}),
      }));
    }
    if (unsupportedAssessments.length > 0 || review.missingRequiredRefs.length > 0) {
      const reasons: string[] = [];
      if (unsupportedAssessments.length > 0) reasons.push("UNSUPPORTED_DURABLE_ASSERTION");
      if (review.missingRequiredRefs.length > 0) reasons.push("MISSING_REQUIRED_MEANING");
      throw new Error(`NARRATIVE_PROVIDER_DURABLE_TRUTH_REJECTED:${reasons.join("|")}`);
    }
  }

  async renderDecisionPresentation(
    context: Readonly<PressureDecisionPresentationContextV1>,
  ): Promise<unknown> {
    const logMode = clean(process.env.PRESSURE_DECISION_PRESENTATION_LOG).toLowerCase();
    if (logMode && logMode !== "off" && logMode !== "0") {
      console.info(JSON.stringify({
        event: "PRESSURE_DECISION_PRESENTATION_CONTEXT",
        mode: logMode === "full" || logMode === "1" ? "full" : "summary",
        contextHash: context.contextHash,
        chapterId: context.chapter.chapterId,
        decisionPointId: context.decisionPointId,
        viewerSeatId: context.viewer.seatId,
        legalActionTypes: context.legalActionContracts.map((action) => action.actionType),
        sources: {
          previousNarrative: `${context.previousNarrative.projectionKind}:${context.previousNarrative.sourceId}`,
          currentPressure: "PRESSURE_SCENE_FLOW",
          currentState: "VIEWER_SAFE_GAME_PROJECTION",
          legalActions: "ACTION_PRESENTATION_CATALOG",
        },
        ...(logMode === "full" || logMode === "1" ? { context } : {}),
      }));
    }
    const response = await this.options.fetchImpl(this.options.endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.options.apiKey}`,
      },
      body: JSON.stringify({
        model: this.options.model,
        thinking: { type: "disabled" },
        response_format: { type: "json_object" },
        max_tokens: 2_048,
        temperature: 0.55,
        messages: [
          {
            role: "system",
            content: buildPressureDecisionSystemInstructionV1(),
          },
          {
            role: "user",
            content: JSON.stringify(context),
          },
        ],
      }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!response.ok) {
      throw new Error(`DECISION_PRESENTATION_PROVIDER_HTTP_${response.status}`);
    }
    const payload = await response.json() as {
      choices?: Array<{ message?: { content?: unknown } }>;
    };
    const content = payload.choices?.[0]?.message?.content;
    if (typeof content !== "string" || !content.trim()) {
      throw new Error("DECISION_PRESENTATION_PROVIDER_EMPTY_RESPONSE");
    }
    try {
      const parsed = JSON.parse(content);
      if (logMode && logMode !== "off" && logMode !== "0") {
        console.info(JSON.stringify({
          event: "PRESSURE_DECISION_PRESENTATION_RESULT",
          contextHash: context.contextHash,
          result: parsed,
        }));
      }
      return parsed;
    } catch {
      throw new Error("DECISION_PRESENTATION_PROVIDER_INVALID_JSON");
    }
  }
}

export function deepSeekNarrativeEndpoint(value?: string): string {
  const raw = clean(value) || "https://api.deepseek.com";
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("PRESSURE_NARRATIVE_BASE_URL_INVALID");
  }
  if (url.protocol !== "https:" || url.username || url.password || url.hash) {
    throw new Error("PRESSURE_NARRATIVE_BASE_URL_UNSAFE");
  }
  const path = url.pathname.replace(/\/+$/, "");
  if (!path || path === "/v1") url.pathname = `${path}/chat/completions`;
  else if (!path.endsWith("/chat/completions")) url.pathname = `${path}/chat/completions`;
  return url.toString();
}

function providerAuthorityEnvelope(context: NarrativeContextV1) {
  return Object.freeze({
    projectionKind: context.projectionKind,
    sourceId: context.sourceId,
    sourceCommitHash: context.sourceCommitHash,
    sourceContentHash: context.sourceContentHash,
    contextHash: context.contextHash,
    audience: context.audience,
    temporalInstruction: context.temporalInstruction,
    facts: context.facts,
    objects: context.objects,
    knowledge: context.knowledge,
    allowedClaims: context.allowedClaims,
    variant: context.variant,
  });
}

function clean(value: string | undefined): string {
  return String(value ?? "").trim();
}

/** Canonicalizes order-only Provider variance; schema and semantic validation remain strict. */
function normalizeNarrativeCandidateOrderV1(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const candidate = value as Record<string, unknown>;
  return {
    ...candidate,
    ...(Array.isArray(candidate.usedFactRefs)
      ? { usedFactRefs: [...candidate.usedFactRefs].sort((left, right) => String(left).localeCompare(String(right))) }
      : {}),
    ...(Array.isArray(candidate.claims)
      ? {
          claims: [...candidate.claims].sort((left, right) => {
            const leftClaim = left && typeof left === "object" ? left as Record<string, unknown> : {};
            const rightClaim = right && typeof right === "object" ? right as Record<string, unknown> : {};
            return `${String(leftClaim.kind)}\u0000${String(leftClaim.refId)}`
              .localeCompare(`${String(rightClaim.kind)}\u0000${String(rightClaim.refId)}`);
          }),
        }
      : {}),
  };
}
