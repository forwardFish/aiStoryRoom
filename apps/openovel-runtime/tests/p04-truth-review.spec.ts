import assert from "node:assert/strict";
import test from "node:test";
import {
  compareTruthReview,
  parseTruthReview,
  type NarrativeTruthContext,
} from "../src/truth-review.js";

const context: NarrativeTruthContext = {
  originActorId: "fixture.actor.player",
  projectionActorId: "fixture.actor.player",
  catalog: [
    { id: "fixture.actor.player", kind: "ACTOR", displayName: "Player" },
    { id: "fixture.actor.aide", kind: "ACTOR", displayName: "Aide" },
    { id: "fixture.document.order", kind: "DOCUMENT", displayName: "Order" },
    { id: "fixture.location.hall", kind: "LOCATION", displayName: "Hall" },
  ],
  capabilityIds: [
    "fixture.capability.authorized",
    "runtime.capability.unspecified_order",
  ],
  secretIds: [],
  allowedPredicates: [{
    type: "DOCUMENT.CREATED",
    constraints: { documentId: "fixture.document.order" },
  }],
  requiredVisiblePredicates: [],
  forbiddenPredicates: [],
  originActionsInDraft: "FORBIDDEN",
};

test("P04 Comparator accepts an explicit predicate authorized by the envelope", () => {
  const draft = "The authorized order now exists.";
  const quote = "authorized order now exists";
  const review = parsed(draft, {
    assertions: [{
      predicate: {
        type: "DOCUMENT.CREATED",
        documentId: "fixture.document.order",
      },
      ...span(draft, quote),
      explicitness: "EXPLICIT",
      confidence: 0.98,
    }],
    missingRequiredPredicateIds: [],
    unknownEntityMentions: [],
  });
  assert.equal(review.parseStatus, "VALID");
  assert.deepEqual(compareTruthReview({ review, context }).conflicts, []);
});

test("P04 Comparator rejects an extra player order without reading its wording", () => {
  const draft = "他又吩咐一句：另遣人跟牌同去。";
  const quote = "另遣人跟牌同去";
  const review = parsed(draft, {
    assertions: [{
      predicate: {
        type: "ACTOR.ORDERED",
        actorId: "fixture.actor.player",
        capabilityId: "runtime.capability.unspecified_order",
      },
      ...span(draft, quote),
      explicitness: "EXPLICIT",
      confidence: 0.99,
    }],
    missingRequiredPredicateIds: [],
    unknownEntityMentions: [],
  });
  const result = compareTruthReview({ review, context });
  assert.equal(result.conflicts.length, 1);
  assert.equal(result.conflicts[0].code, "UNAUTHORIZED_PLAYER_ACTION");
  assert.equal(result.conflicts[0].exactQuote, quote);
});

test("P04 wording changes cannot change a structured verdict", () => {
  const drafts = [
    "The player expressly ordered another escort to depart.",
    "Le joueur ordonna expressément le départ d'une autre escorte.",
  ];
  for (const draft of drafts) {
    const review = parsed(draft, {
      assertions: [{
        predicate: {
          type: "ACTOR.ORDERED",
          actorId: "fixture.actor.player",
          capabilityId: "runtime.capability.unspecified_order",
        },
        ...span(draft, draft),
        explicitness: "EXPLICIT",
        confidence: 0.99,
      }],
      missingRequiredPredicateIds: [],
      unknownEntityMentions: [],
    });
    assert.equal(
      compareTruthReview({ review, context }).conflicts[0]?.code,
      "UNAUTHORIZED_PLAYER_ACTION",
    );
  }
});

test("P04 ordinary texture and low-confidence claims stay in Shadow", () => {
  const draft = "A sleeve crossed the lamplight; an unnamed attendant touched ordinary paper.";
  const review = parsed(draft, {
    assertions: [],
    missingRequiredPredicateIds: [],
    unknownEntityMentions: [{
      exactQuote: "an unnamed attendant",
      durableImpact: false,
      confidence: 0.99,
    }],
  });
  const result = compareTruthReview({ review, context });
  assert.deepEqual(result.conflicts, []);
  assert.equal(result.shadow[0]?.reason, "UNKNOWN_MENTION_TEXTURE");
});

test("P04 invalid Reviewer output cannot manufacture a P0", () => {
  const review = parseTruthReview({
    raw: '{"assertions":[{"predicate":{"type":"DOCUMENT.CREATED","documentId":"ghost.document"}}]}',
    draft: "Nothing durable happened.",
    draftId: "fixture.draft.one",
    reviewId: "fixture.review.one",
    reviewerModel: "fixture-reviewer",
    context,
  });
  assert.equal(review.parseStatus, "INVALID");
  const result = compareTruthReview({ review, context });
  assert.deepEqual(result.conflicts, []);
  assert.match(result.shadow[0]?.reason || "", /^REVIEW_INVALID:/);
});

test("P04 repairs one fenced JSON object, enum case and one unique quote span", () => {
  const draft = "The authorized order now exists.";
  const quote = "authorized order now exists";
  const review = parseTruthReview({
    raw: `\`\`\`json\n${JSON.stringify({
      assertions: [{
        predicate: {
          type: "DOCUMENT.CREATED",
          documentId: "fixture.document.order",
        },
        exactQuote: quote,
        quoteStart: 0,
        quoteEnd: 1,
        explicitness: "explicit",
        confidence: 0.98,
      }],
      missingRequiredPredicateIds: [],
      unknownEntityMentions: [],
    })}\n\`\`\``,
    draft,
    draftId: "fixture.draft.repaired",
    reviewId: "fixture.review.repaired",
    reviewerModel: "fixture-reviewer",
    context,
  });
  assert.equal(review.parseStatus, "REPAIRED");
  assert.deepEqual(compareTruthReview({ review, context }).conflicts, []);
  assert.equal(review.assertions[0]?.exactQuote, quote);
});

test("P04 a valid required-predicate omission is an exact P0", () => {
  const requiredContext: NarrativeTruthContext = {
    ...context,
    requiredVisiblePredicates: [{
      id: "fixture.required.created",
      pattern: {
        type: "DOCUMENT.CREATED",
        constraints: { documentId: "fixture.document.order" },
      },
    }],
  };
  const review = parseTruthReview({
    raw: JSON.stringify({
      assertions: [],
      missingRequiredPredicateIds: ["fixture.required.created"],
      unknownEntityMentions: [],
    }),
    draft: "The scene moves on without showing the settled result.",
    draftId: "fixture.draft.one",
    reviewId: "fixture.review.one",
    reviewerModel: "fixture-reviewer",
    context: requiredContext,
  });
  const result = compareTruthReview({ review, context: requiredContext });
  assert.equal(result.conflicts[0]?.code, "MISSING_REQUIRED_PREDICATE");
});

test("P04 Comparator derives required-predicate omission even when Reviewer forgets to list it", () => {
  const requiredContext: NarrativeTruthContext = {
    ...context,
    requiredVisiblePredicates: [{
      id: "fixture.required.created",
      pattern: {
        type: "DOCUMENT.CREATED",
        constraints: { documentId: "fixture.document.order" },
      },
    }],
  };
  const review = parseTruthReview({
    raw: JSON.stringify({
      assertions: [],
      missingRequiredPredicateIds: [],
      unknownEntityMentions: [],
    }),
    draft: "The scene moves on without showing the settled result.",
    draftId: "fixture.draft.two",
    reviewId: "fixture.review.two",
    reviewerModel: "fixture-reviewer",
    context: requiredContext,
  });
  const result = compareTruthReview({ review, context: requiredContext });
  assert.equal(result.conflicts.length, 1);
  assert.equal(result.conflicts[0]?.requiredPredicateId, "fixture.required.created");
});

function parsed(draft: string, value: unknown) {
  return parseTruthReview({
    raw: JSON.stringify(value),
    draft,
    draftId: "fixture.draft.one",
    reviewId: "fixture.review.one",
    reviewerModel: "fixture-reviewer",
    context,
  });
}

function span(draft: string, exactQuote: string) {
  const quoteStart = draft.indexOf(exactQuote);
  assert.notEqual(quoteStart, -1);
  return {
    exactQuote,
    quoteStart,
    quoteEnd: quoteStart + exactQuote.length,
  };
}
