import type { NarrativeDisposition } from "@ai-story/templates";
import {
  buildTruthReviewerMessages,
  compareTruthReview,
  parseTruthReview,
  type NarrativeTruthContext,
  type TruthComparison,
  type TruthReview,
} from "./truth-review.js";
import {
  normalizeNarrativeSurface,
  validateSurfaceIntegrity,
} from "./surface-integrity.js";
import type {
  OpenNovelProvider,
  ProviderRequest,
  ProviderResult,
} from "./types.js";

export type NarrativeModelCall = {
  stage: "reviewer" | "repair";
  attempt: 1 | 2;
  request: ProviderRequest;
  result?: ProviderResult;
  error?: string;
};

export type NarrativeSafetyResult = {
  finalText: string;
  continuationText: string;
  disposition: NarrativeDisposition;
  originalReview?: TruthReview;
  finalReview?: TruthReview;
  originalComparison?: TruthComparison;
  finalComparison?: TruthComparison;
  repairText?: string;
  calls: NarrativeModelCall[];
  fallbackReason?: string;
};

export class NarrativeSafetyPipeline {
  constructor(private readonly provider: OpenNovelProvider) {}

  async resolve(input: {
    turnId: string;
    draft: string;
    previousOpening?: string;
    protectedBlocks: Array<{ text: string }>;
    fallbackText: string;
    truthContext: NarrativeTruthContext;
  }): Promise<NarrativeSafetyResult> {
    const calls: NarrativeModelCall[] = [];
    const draftId = `${input.turnId}.draft.original`;
    const originalSurface = validateSurfaceIntegrity(
      input.draft,
      input.previousOpening || "",
    );
    if (!originalSurface.ok) {
      return fallback(input, calls, originalSurface.reason || "SURFACE_INVALID");
    }

    const originalReviewCall = await this.review({
      turnId: input.turnId,
      draftId,
      draft: input.draft,
      context: input.truthContext,
      attempt: 1,
    });
    calls.push(originalReviewCall.call);
    if (!originalReviewCall.review || originalReviewCall.review.parseStatus === "INVALID") {
      return fallback(input, calls, "TRUTH_REVIEW_UNAVAILABLE");
    }
    const originalComparison = compareTruthReview({
      review: originalReviewCall.review,
      context: input.truthContext,
    });
    if (!originalComparison.conflicts.length) {
      const continuationText = normalizeNarrativeSurface(input.draft);
      return {
        finalText: joinProtected(input.protectedBlocks, continuationText),
        continuationText,
        disposition: { kind: "USE_ORIGINAL", draftId },
        originalReview: originalReviewCall.review,
        originalComparison,
        calls,
      };
    }

    const repairRequest = buildRepairRequest({
      draft: input.draft,
      conflicts: originalComparison.conflicts,
      truthContext: input.truthContext,
    });
    let repairResult: ProviderResult | undefined;
    try {
      repairResult = await this.provider.generate(repairRequest);
      calls.push({
        stage: "repair",
        attempt: 1,
        request: repairRequest,
        result: repairResult,
      });
    } catch (error) {
      calls.push({
        stage: "repair",
        attempt: 1,
        request: repairRequest,
        error: String((error as Error).message || error),
      });
      return fallback(input, calls, "REPAIR_UNAVAILABLE", {
        originalReview: originalReviewCall.review,
        originalComparison,
      });
    }

    const repairedText = normalizeNarrativeSurface(repairResult.text);
    const repairedSurface = validateSurfaceIntegrity(
      repairedText,
      input.previousOpening || "",
    );
    if (!repairedSurface.ok) {
      return fallback(input, calls, repairedSurface.reason || "REPAIR_SURFACE_INVALID", {
        originalReview: originalReviewCall.review,
        originalComparison,
        repairText: repairedText,
      });
    }

    const repairId = `${input.turnId}.repair.one`;
    const finalReviewCall = await this.review({
      turnId: input.turnId,
      draftId: repairId,
      draft: repairedText,
      context: input.truthContext,
      attempt: 2,
    });
    calls.push(finalReviewCall.call);
    if (!finalReviewCall.review || finalReviewCall.review.parseStatus === "INVALID") {
      return fallback(input, calls, "FINAL_TRUTH_REVIEW_UNAVAILABLE", {
        originalReview: originalReviewCall.review,
        originalComparison,
        repairText: repairedText,
      });
    }
    const finalComparison = compareTruthReview({
      review: finalReviewCall.review,
      context: input.truthContext,
    });
    if (finalComparison.conflicts.length) {
      return fallback(input, calls, "REPAIR_STILL_CONFLICTS", {
        originalReview: originalReviewCall.review,
        originalComparison,
        finalReview: finalReviewCall.review,
        finalComparison,
        repairText: repairedText,
      });
    }

    return {
      finalText: joinProtected(input.protectedBlocks, repairedText),
      continuationText: repairedText,
      disposition: { kind: "USE_REPAIRED", draftId, repairId },
      originalReview: originalReviewCall.review,
      finalReview: finalReviewCall.review,
      originalComparison,
      finalComparison,
      repairText: repairedText,
      calls,
    };
  }

  private async review(input: {
    turnId: string;
    draftId: string;
    draft: string;
    context: NarrativeTruthContext;
    attempt: 1 | 2;
  }) {
    const reviewId = `${input.turnId}.review.${input.attempt}`;
    const request: ProviderRequest = {
      profile: "reviewer",
      messages: buildTruthReviewerMessages({
        draft: input.draft,
        draftId: input.draftId,
        reviewId,
        context: input.context,
      }),
      temperature: 0,
      maxTokens: 2_000,
      json: true,
      stream: true,
    };
    let result: ProviderResult | undefined;
    try {
      result = await this.provider.generate(request);
      return {
        review: parseTruthReview({
          raw: result.text,
          draft: input.draft,
          draftId: input.draftId,
          reviewId,
          reviewerModel: result.model,
          context: input.context,
        }),
        call: {
          stage: "reviewer" as const,
          attempt: input.attempt,
          request,
          result,
        } satisfies NarrativeModelCall,
      };
    } catch (error) {
      return {
        review: undefined,
        call: {
          stage: "reviewer" as const,
          attempt: input.attempt,
          request,
          ...(result ? { result } : {}),
          error: String((error as Error).message || error),
        } satisfies NarrativeModelCall,
      };
    }
  }
}

function buildRepairRequest(input: {
  draft: string;
  conflicts: TruthComparison["conflicts"];
  truthContext: NarrativeTruthContext;
}): ProviderRequest {
  return {
    profile: "repair",
    messages: [
      {
        role: "system",
        content: [
          "You repair one already-written interactive-fiction continuation.",
          "Remove or minimally rewrite only the exact conflicting spans supplied by the server.",
          "Preserve all non-conflicting prose, scene position, existing characters, NPC pressure and stopping point.",
          "Do not add a new player action, order, commitment, durable entity, evidence, secret or formal document.",
          "Do not restate or modify any protected player outcome; it is outside this draft.",
          "Return story prose only.",
        ].join("\n"),
      },
      {
        role: "user",
        content: [
          "# Conflicts",
          JSON.stringify(input.conflicts),
          "# Allowed Predicates",
          JSON.stringify(input.truthContext.allowedPredicates),
          "# Draft",
          input.draft,
        ].join("\n\n"),
      },
    ],
    temperature: 0.2,
    maxTokens: 2_000,
    json: false,
    stream: false,
  };
}

function fallback(
  input: {
    turnId: string;
    fallbackText: string;
    protectedBlocks: Array<{ text: string }>;
  },
  calls: NarrativeModelCall[],
  reason: string,
  evidence: Partial<NarrativeSafetyResult> = {},
): NarrativeSafetyResult {
  const deterministicText = normalizeNarrativeSurface(input.fallbackText);
  if (!deterministicText) throw new Error("NARRATIVE_FALLBACK_MISSING");
  return {
    finalText: joinProtected(input.protectedBlocks, deterministicText),
    continuationText: deterministicText,
    disposition: {
      kind: "USE_FALLBACK",
      fallbackId: `${input.turnId}.fallback`,
      reason,
    },
    calls,
    fallbackReason: reason,
    ...evidence,
  };
}

function joinProtected(
  protectedBlocks: Array<{ text: string }>,
  continuation: string,
) {
  return normalizeNarrativeSurface([
    ...protectedBlocks.map((block) => block.text),
    continuation,
  ].filter(Boolean).join("\n\n"));
}
