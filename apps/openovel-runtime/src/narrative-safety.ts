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

export type ReviewerFailurePolicy =
  | "SHADOW"
  | "HOLD_FOR_REVIEW"
  | "FAIL_OPEN_WITH_AUDIT"
  | "FAIL_CLOSED";

export type NarrativeSafetyOptions = {
  reviewerFailurePolicy?: ReviewerFailurePolicy;
};

export class NarrativeSafetyPipeline {
  private readonly reviewerFailurePolicy: ReviewerFailurePolicy;

  constructor(
    private readonly provider: OpenNovelProvider,
    options: NarrativeSafetyOptions = {},
  ) {
    this.reviewerFailurePolicy = options.reviewerFailurePolicy || "SHADOW";
  }

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
      const originalComparison = originalReviewCall.review
        ? compareTruthReview({
            review: originalReviewCall.review,
            context: input.truthContext,
          })
        : reviewerUnavailableComparison(originalReviewCall.call.error);
      if (
        this.reviewerFailurePolicy === "SHADOW"
        || this.reviewerFailurePolicy === "FAIL_OPEN_WITH_AUDIT"
      ) {
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
      if (this.reviewerFailurePolicy === "HOLD_FOR_REVIEW") {
        throw new Error("TRUTH_REVIEW_HOLD_FOR_REVIEW");
      }
      return fallback(input, calls, "TRUTH_REVIEW_UNAVAILABLE", {
        originalReview: originalReviewCall.review,
        originalComparison,
      });
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

    let repairedText: string;
    try {
      repairedText = applyRepairPatch({
        raw: repairResult.text,
        draft: input.draft,
        conflicts: originalComparison.conflicts,
      });
    } catch (error) {
      return fallback(input, calls, "REPAIR_PATCH_INVALID", {
        originalReview: originalReviewCall.review,
        originalComparison,
        repairText: String((error as Error).message || error),
      });
    }
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
      if (this.reviewerFailurePolicy === "HOLD_FOR_REVIEW") {
        throw new Error("FINAL_TRUTH_REVIEW_HOLD_FOR_REVIEW");
      }
      return fallback(input, calls, "FINAL_TRUTH_REVIEW_UNAVAILABLE", {
        originalReview: originalReviewCall.review,
        originalComparison,
        finalReview: finalReviewCall.review,
        finalComparison: finalReviewCall.review
          ? compareTruthReview({
              review: finalReviewCall.review,
              context: input.truthContext,
            })
          : reviewerUnavailableComparison(finalReviewCall.call.error),
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
      maxTokens: 4_000,
      json: true,
      stream: false,
    };
    let result: ProviderResult | undefined;
    try {
      result = await this.provider.generate(request);
      if (result.finishReason === "length") {
        throw new Error("TRUTH_REVIEW_TRUNCATED");
      }
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

function reviewerUnavailableComparison(error?: string): TruthComparison {
  return {
    conflicts: [],
    shadow: [{
      reason: `REVIEW_UNAVAILABLE:${String(error || "UNKNOWN").slice(0, 300)}`,
      exactQuote: "",
    }],
  };
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
          "Return a surgical edit patch, never a rewritten continuation.",
          "Each edit may replace only one exact conflicting span supplied by the server. All text outside those spans is immutable.",
          "Use an empty replacement to delete a conflict cleanly. Otherwise write the smallest natural replacement that preserves the surrounding sentence.",
          "appendText must be empty unless the conflicts include a missing required predicate; in that case append only the missing scene action and unresolved stop, never a summary.",
          "Every Required Narrative Effect is server-owned and must remain explicitly dramatized. Express its requiredMeaning naturally; do not copy internal IDs into prose.",
          "End with the Required Stop Condition still unresolved. Do not answer it, settle it or advance beyond it.",
          "Do not add a new player action, order, commitment, durable entity, evidence, secret or formal document.",
          "Use Supported Current Story Facts only as authorization for current-world facts. Mechanism-only evidence is not permission to invent current quantities, places, documents or outcomes.",
          "Obey the Specificity Boundary.",
          "Do not restate or modify any protected player outcome; it is outside this draft.",
          "Return strict JSON only: {\"edits\":[{\"exactQuote\":\"...\",\"replacement\":\"...\"}],\"appendText\":\"\"}.",
        ].join("\n"),
      },
      {
        role: "user",
        content: [
          "# Conflicts",
          JSON.stringify(input.conflicts),
          "# Required Narrative Effects",
          JSON.stringify(input.truthContext.requiredVisiblePredicates),
          "# Required Stop Condition",
          input.truthContext.stopCondition || "",
          "# Supported Current Story Facts",
          JSON.stringify(input.truthContext.supportedStoryFacts || []),
          "# Mechanism-only Evidence",
          JSON.stringify(input.truthContext.mechanismOnlyEvidence || []),
          "# Specificity Boundary",
          input.truthContext.specificityBoundary || "",
          "# Allowed Predicates",
          JSON.stringify(input.truthContext.allowedPredicates),
          "# Draft",
          input.draft,
        ].join("\n\n"),
      },
    ],
    temperature: 0.2,
    maxTokens: 2_000,
    json: true,
    stream: false,
  };
}

function applyRepairPatch(input: {
  raw: string;
  draft: string;
  conflicts: TruthComparison["conflicts"];
}) {
  const candidate = String(input.raw || "").trim().replace(
    /^```(?:json)?\s*([\s\S]*?)\s*```$/iu,
    "$1",
  );
  const parsed = JSON.parse(candidate) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("REPAIR_PATCH_NOT_OBJECT");
  }
  const record = parsed as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  if (keys.join("|") !== "appendText|edits") {
    throw new Error("REPAIR_PATCH_KEYS_INVALID");
  }
  if (!Array.isArray(record.edits) || typeof record.appendText !== "string") {
    throw new Error("REPAIR_PATCH_SHAPE_INVALID");
  }
  const allowedQuotes = new Set(
    input.conflicts.map((item) => item.exactQuote).filter(Boolean),
  );
  const missingRequired = input.conflicts.some((item) => (
    item.code === "MISSING_REQUIRED_PREDICATE"
  ));
  const appendText = normalizeNarrativeSurface(record.appendText);
  if (appendText && !missingRequired) {
    throw new Error("REPAIR_PATCH_APPEND_NOT_AUTHORIZED");
  }
  const seen = new Set<string>();
  const edits = record.edits.map((raw, index) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      throw new Error(`REPAIR_PATCH_EDIT_INVALID:${index}`);
    }
    const edit = raw as Record<string, unknown>;
    if (Object.keys(edit).sort().join("|") !== "exactQuote|replacement") {
      throw new Error(`REPAIR_PATCH_EDIT_KEYS_INVALID:${index}`);
    }
    if (typeof edit.exactQuote !== "string" || typeof edit.replacement !== "string") {
      throw new Error(`REPAIR_PATCH_EDIT_SHAPE_INVALID:${index}`);
    }
    const exactQuote = edit.exactQuote;
    if (!exactQuote || !allowedQuotes.has(exactQuote) || seen.has(exactQuote)) {
      throw new Error(`REPAIR_PATCH_TARGET_NOT_AUTHORIZED:${index}`);
    }
    const quoteStart = input.draft.indexOf(exactQuote);
    if (
      quoteStart < 0
      || input.draft.indexOf(exactQuote, quoteStart + exactQuote.length) >= 0
    ) {
      throw new Error(`REPAIR_PATCH_TARGET_NOT_UNIQUE:${index}`);
    }
    const replacement = normalizeNarrativeSurface(edit.replacement);
    if (replacement.length > 600) {
      throw new Error(`REPAIR_PATCH_REPLACEMENT_TOO_LONG:${index}`);
    }
    seen.add(exactQuote);
    return { exactQuote, replacement, quoteStart };
  });
  let repaired = input.draft;
  for (const edit of edits.sort((left, right) => right.quoteStart - left.quoteStart)) {
    repaired = [
      repaired.slice(0, edit.quoteStart),
      edit.replacement,
      repaired.slice(edit.quoteStart + edit.exactQuote.length),
    ].join("");
  }
  const result = normalizeNarrativeSurface([repaired, appendText].filter(Boolean).join("\n\n"));
  if (!result) throw new Error("REPAIR_PATCH_EMPTY_RESULT");
  return result;
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
