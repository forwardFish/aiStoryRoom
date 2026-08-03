import assert from "node:assert/strict";
import test from "node:test";
import { NarrativeSafetyPipeline } from "../src/narrative-safety.js";
import {
  buildStoryFactReviewUnits,
  buildTruthReviewUnits,
  type NarrativeTruthContext,
} from "../src/truth-review.js";
import type {
  OpenNovelProvider,
  ProviderRequest,
  ProviderResult,
} from "../src/types.js";

const context: NarrativeTruthContext = {
  originActorId: "fixture.actor.player",
  projectionActorId: "fixture.actor.player",
  catalog: [
    { id: "fixture.actor.player", kind: "ACTOR", displayName: "Player" },
    { id: "fixture.actor.aide", kind: "ACTOR", displayName: "Aide" },
  ],
  capabilityIds: ["runtime.capability.unspecified_order"],
  secretIds: [],
  allowedPredicates: [],
  requiredVisiblePredicates: [],
  forbiddenPredicates: [],
  originActionsInDraft: "FORBIDDEN",
};

test("P04 uses the original continuation after one clean review", async () => {
  const draft = "The aide paused at the threshold and waited for an answer.";
  const provider = new QueueProvider([
    result(reviewJson(draft, []), "reviewer-model"),
  ]);
  const resolved = await new NarrativeSafetyPipeline(provider).resolve({
    turnId: "T01",
    draft,
    protectedBlocks: [{ text: "The settled player outcome is already visible." }],
    fallbackText: "Fallback remains playable.",
    truthContext: context,
  });
  assert.equal(resolved.disposition.kind, "USE_ORIGINAL");
  assert.match(resolved.finalText, /settled player outcome/);
  assert.match(resolved.finalText, /aide paused/);
  assert.deepEqual(provider.profiles, ["reviewer"]);
});

test("P04 performs exactly one targeted repair and one final review", async () => {
  const draft = "The player ordered another escort to leave. The aide waited at the door.";
  const conflictQuote = "The player ordered another escort to leave. ";
  const repaired = "The aide waited at the door.";
  const provider = new QueueProvider([
    result(reviewJson(draft, [assertion(draft, conflictQuote)]), "reviewer-model"),
    result(repairPatch([{ exactQuote: conflictQuote, replacement: "" }]), "repair-model"),
    result(reviewJson(repaired, []), "reviewer-model"),
  ]);
  const resolved = await new NarrativeSafetyPipeline(provider).resolve({
    turnId: "T01",
    draft,
    protectedBlocks: [{ text: "The settled player outcome is already visible." }],
    fallbackText: "Fallback remains playable.",
    truthContext: context,
  });
  assert.equal(resolved.disposition.kind, "USE_REPAIRED");
  assert.doesNotMatch(resolved.finalText, /ordered another escort/);
  assert.match(resolved.finalText, /aide waited/);
  assert.deepEqual(provider.profiles, ["reviewer", "repair", "reviewer"]);
});

test("P04 repair receives the server meaning and stop condition in a second world", async () => {
  const capabilityId = "fixture.capability.seal_airlock";
  const requiredPattern = {
    type: "ACTOR.ORDERED" as const,
    constraints: {
      actorId: "fixture.actor.aide",
      capabilityId,
    },
  };
  const requiredContext: NarrativeTruthContext = {
    ...context,
    catalog: [
      ...context.catalog,
      { id: capabilityId, kind: "CAPABILITY", displayName: "Seal the airlock" },
    ],
    capabilityIds: [...context.capabilityIds, capabilityId],
    allowedPredicates: [requiredPattern],
    requiredVisiblePredicates: [{
      id: "fixture.required.airlock",
      pattern: requiredPattern,
      requiredMeaning: "The aide seals the damaged airlock before asking which route to take.",
      supportIds: ["fixture.fact.airlock-pressure"],
    }],
    supportedStoryFacts: [{
      supportId: "fixture.fact.airlock-pressure",
      statement: "The damaged airlock must be sealed before the route decision.",
    }],
    specificityBoundary: "Do not invent casualties, coordinates, ships or repair completion.",
    stopCondition: "The aide asks which route the captain will take.",
  };
  const draft = "The aide waits beside the damaged airlock.";
  const repaired = "The aide seals the damaged airlock, then asks which route the captain will take.";
  const repairedDraft = `${draft}\n\n${repaired}`;
  const pressureQuote = "The aide seals the damaged airlock";
  const provider = new QueueProvider([
    result(reviewJson(draft, [], requiredContext), "reviewer-model"),
    result(repairPatch([], repaired), "repair-model"),
    result(reviewJson(repairedDraft, [{
      predicate: {
        type: "ACTOR.ORDERED",
        actorId: "fixture.actor.aide",
        capabilityId,
      },
      ...quoteSpan(repairedDraft, pressureQuote),
      explicitness: "EXPLICIT",
      confidence: 0.99,
    }], requiredContext), "reviewer-model"),
  ]);
  const resolved = await new NarrativeSafetyPipeline(provider).resolve({
    turnId: "T01",
    draft,
    protectedBlocks: [{ text: "The captain's previous order has already taken effect." }],
    fallbackText: "The aide seals the damaged airlock and asks which route to take.",
    truthContext: requiredContext,
  });
  assert.equal(resolved.disposition.kind, "USE_REPAIRED");
  assert.match(resolved.finalText, /seals the damaged airlock/);
  assert.match(resolved.finalText, /which route/);
  const repairPrompt = provider.requests[1]?.messages.map((message) => message.content).join("\n") || "";
  assert.match(repairPrompt, /Required Narrative Effects/);
  assert.match(repairPrompt, /The aide seals the damaged airlock/);
  assert.match(repairPrompt, /The aide asks which route the captain will take/);
  assert.match(repairPrompt, /Do not invent casualties/);
});

test("P04 uses deterministic fallback when the single repair still conflicts", async () => {
  const draft = "The player ordered another escort to leave.";
  const quote = "The player ordered another escort to leave";
  const provider = new QueueProvider([
    result(reviewJson(draft, [assertion(draft, quote)]), "reviewer-model"),
    result(repairPatch([{ exactQuote: quote, replacement: quote }]), "repair-model"),
    result(reviewJson(draft, [assertion(draft, quote)]), "reviewer-model"),
  ]);
  const resolved = await new NarrativeSafetyPipeline(provider).resolve({
    turnId: "T01",
    draft,
    protectedBlocks: [{ text: "The settled player outcome is already visible." }],
    fallbackText: "The aide asks what should happen next.",
    truthContext: context,
  });
  assert.equal(resolved.disposition.kind, "USE_FALLBACK");
  assert.equal(
    resolved.finalText,
    "The settled player outcome is already visible.\n\nThe aide asks what should happen next.",
  );
  assert.deepEqual(provider.profiles, ["reviewer", "repair", "reviewer"]);
});

test("P04 repair cannot rewrite any non-conflicting prose", async () => {
  const draft = "The player ordered another escort to leave. The aide waited at the door.";
  const quote = "The player ordered another escort to leave";
  const provider = new QueueProvider([
    result(reviewJson(draft, [assertion(draft, quote)]), "reviewer-model"),
    result(repairPatch([{
      exactQuote: "The aide waited at the door.",
      replacement: "The aide summarized the whole situation.",
    }]), "repair-model"),
  ]);
  const resolved = await new NarrativeSafetyPipeline(provider).resolve({
    turnId: "T01",
    draft,
    protectedBlocks: [],
    fallbackText: "The aide asks what should happen next.",
    truthContext: context,
  });
  assert.equal(resolved.disposition.kind, "USE_FALLBACK");
  assert.equal(resolved.fallbackReason, "REPAIR_PATCH_INVALID");
  assert.deepEqual(provider.profiles, ["reviewer", "repair"]);
});

test("P04 Reviewer failure preserves readable prose as audited Shadow", async () => {
  const provider = new QueueProvider([new Error("reviewer unavailable")]);
  const resolved = await new NarrativeSafetyPipeline(provider).resolve({
    turnId: "T01",
    draft: "The aide waited for an answer.",
    protectedBlocks: [],
    fallbackText: "The authorized outcome is visible, and the scene remains playable.",
    truthContext: context,
  });
  assert.equal(resolved.disposition.kind, "USE_ORIGINAL");
  assert.equal(resolved.continuationText, "The aide waited for an answer.");
  assert.match(
    resolved.originalComparison?.shadow[0]?.reason || "",
    /REVIEW_UNAVAILABLE/u,
  );
  assert.deepEqual(provider.profiles, ["reviewer"]);
});

test("P04 FAIL_CLOSED remains available as an explicit production policy", async () => {
  const provider = new QueueProvider([new Error("reviewer unavailable")]);
  const resolved = await new NarrativeSafetyPipeline(provider, {
    reviewerFailurePolicy: "FAIL_CLOSED",
  }).resolve({
    turnId: "T01",
    draft: "The aide waited for an answer.",
    protectedBlocks: [],
    fallbackText: "The authorized outcome is visible, and the scene remains playable.",
    truthContext: context,
  });
  assert.equal(resolved.disposition.kind, "USE_FALLBACK");
  assert.equal(resolved.fallbackReason, "TRUTH_REVIEW_UNAVAILABLE");
});

test("P04 an unverified repair never fails open after a verified P0", async () => {
  const draft = "The player ordered another escort to leave.";
  const quote = "The player ordered another escort to leave";
  const provider = new QueueProvider([
    result(reviewJson(draft, [assertion(draft, quote)]), "reviewer-model"),
    result(repairPatch([{ exactQuote: quote, replacement: "" }]), "repair-model"),
    result('{"assertions":', "reviewer-model"),
  ]);
  const resolved = await new NarrativeSafetyPipeline(provider).resolve({
    turnId: "T01",
    draft,
    protectedBlocks: [],
    fallbackText: "The aide asks what should happen next.",
    truthContext: context,
  });
  assert.equal(resolved.disposition.kind, "USE_FALLBACK");
  assert.equal(resolved.fallbackReason, "FINAL_TRUTH_REVIEW_UNAVAILABLE");
  assert.deepEqual(provider.profiles, ["reviewer", "repair", "reviewer"]);
});

test("P04 broken Narrator surface falls back without any model retry", async () => {
  const provider = new QueueProvider([]);
  const resolved = await new NarrativeSafetyPipeline(provider).resolve({
    turnId: "T01",
    draft: "",
    protectedBlocks: [],
    fallbackText: "The authorized outcome is visible, and the scene remains playable.",
    truthContext: context,
  });
  assert.equal(resolved.disposition.kind, "USE_FALLBACK");
  assert.equal(resolved.fallbackReason, "NARRATION_EMPTY");
  assert.deepEqual(provider.profiles, []);
});

class QueueProvider implements OpenNovelProvider {
  readonly profiles: ProviderRequest["profile"][] = [];
  readonly requests: ProviderRequest[] = [];
  constructor(private readonly queue: Array<ProviderResult | Error>) {}
  describe() {
    return { provider: "fixture", model: "fixture", configured: true };
  }
  async generate(request: ProviderRequest) {
    this.profiles.push(request.profile);
    this.requests.push(request);
    const next = this.queue.shift();
    if (!next) throw new Error("fixture queue exhausted");
    if (next instanceof Error) throw next;
    return next;
  }
}

function result(text: string, model: string): ProviderResult {
  return {
    text,
    model,
    usage: { inputTokens: 1, outputTokens: 1 },
    latencyMs: 1,
  };
}

function repairPatch(
  edits: Array<{ exactQuote: string; replacement: string }>,
  appendText = "",
) {
  return JSON.stringify({ edits, appendText });
}

function reviewJson(
  draft: string,
  assertions: unknown[],
  reviewContext: NarrativeTruthContext = context,
) {
  const actionQuotes = assertions.flatMap((value) => {
    const item = value as Record<string, unknown>;
    const predicate = item.predicate as Record<string, unknown> | undefined;
    return (
      (predicate?.type === "ACTOR.ORDERED" || predicate?.type === "ACTOR.COMMITTED")
      && predicate.actorId === reviewContext.originActorId
    ) ? [String(item.exactQuote)] : [];
  });
  return JSON.stringify({
    assertions,
    originActionAssessments: buildTruthReviewUnits(draft).map((unit) => {
      const quotes = actionQuotes.filter((quote) => unit.text.includes(quote));
      return quotes.length
        ? {
            unitId: unit.unitId,
            classification: "UNAUTHORIZED",
            exactQuotes: quotes,
            confidence: 0.99,
          }
        : {
            unitId: unit.unitId,
            classification: "NO_DURABLE_ACTION",
            exactQuotes: [],
            confidence: 0.99,
          };
    }),
    missingRequiredPredicateIds: [],
    unknownEntityMentions: [],
    storyFactAssessments: buildStoryFactReviewUnits(draft).map((unit) => ({
      unitId: unit.unitId,
      classification: "TEXTURE_OR_TRANSIENT",
      supportIds: [],
      confidence: 0.99,
    })),
  });
}

function quoteSpan(draft: string, exactQuote: string) {
  const quoteStart = draft.indexOf(exactQuote);
  assert.notEqual(quoteStart, -1);
  return {
    exactQuote,
    quoteStart,
    quoteEnd: quoteStart + exactQuote.length,
  };
}

function assertion(draft: string, exactQuote: string) {
  const quoteStart = draft.indexOf(exactQuote);
  assert.notEqual(quoteStart, -1);
  return {
    predicate: {
      type: "ACTOR.ORDERED",
      actorId: "fixture.actor.player",
      capabilityId: "runtime.capability.unspecified_order",
    },
    exactQuote,
    quoteStart,
    quoteEnd: quoteStart + exactQuote.length,
    explicitness: "EXPLICIT",
    confidence: 0.99,
  };
}
