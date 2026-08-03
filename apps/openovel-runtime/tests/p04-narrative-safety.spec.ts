import assert from "node:assert/strict";
import test from "node:test";
import { NarrativeSafetyPipeline } from "../src/narrative-safety.js";
import type { NarrativeTruthContext } from "../src/truth-review.js";
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
    result(reviewJson([]), "reviewer-model"),
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
  const conflictQuote = "The player ordered another escort to leave";
  const repaired = "The aide waited at the door.";
  const provider = new QueueProvider([
    result(reviewJson([assertion(draft, conflictQuote)]), "reviewer-model"),
    result(repaired, "repair-model"),
    result(reviewJson([]), "reviewer-model"),
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

test("P04 uses deterministic fallback when the single repair still conflicts", async () => {
  const draft = "The player ordered another escort to leave.";
  const quote = "The player ordered another escort to leave";
  const provider = new QueueProvider([
    result(reviewJson([assertion(draft, quote)]), "reviewer-model"),
    result(draft, "repair-model"),
    result(reviewJson([assertion(draft, quote)]), "reviewer-model"),
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

test("P04 Reviewer failure falls back without another Narrator call", async () => {
  const provider = new QueueProvider([new Error("reviewer unavailable")]);
  const resolved = await new NarrativeSafetyPipeline(provider).resolve({
    turnId: "T01",
    draft: "The aide waited for an answer.",
    protectedBlocks: [],
    fallbackText: "The authorized outcome is visible, and the scene remains playable.",
    truthContext: context,
  });
  assert.equal(resolved.disposition.kind, "USE_FALLBACK");
  assert.equal(resolved.fallbackReason, "TRUTH_REVIEW_UNAVAILABLE");
  assert.deepEqual(provider.profiles, ["reviewer"]);
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
  constructor(private readonly queue: Array<ProviderResult | Error>) {}
  describe() {
    return { provider: "fixture", model: "fixture", configured: true };
  }
  async generate(request: ProviderRequest) {
    this.profiles.push(request.profile);
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

function reviewJson(assertions: unknown[]) {
  return JSON.stringify({
    assertions,
    missingRequiredPredicateIds: [],
    unknownEntityMentions: [],
  });
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
