import assert from "node:assert/strict";
import test from "node:test";
import {
  buildTruthReviewUnits,
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

test("P04 Reviewer normalizes omitted empty fields for NO_DURABLE_ACTION units", () => {
  const draft = "The aide waits.\n\nThe lamp burns low.";
  const units = buildTruthReviewUnits(draft);
  const review = parseTruthReview({
    raw: JSON.stringify({
      assertions: [],
      originActionAssessments: units.map((unit) => ({
        unitId: unit.unitId,
        classification: "NO_DURABLE_ACTION",
      })),
      missingRequiredPredicateIds: [],
      unknownEntityMentions: [],
      factClaims: [],
    }),
    draft,
    draftId: "reviewer.no-action-defaults",
    reviewId: "reviewer.no-action-defaults.review",
    reviewerModel: "fixture-reviewer",
    context,
  });
  assert.equal(review.parseStatus, "REPAIRED");
  assert.equal(review.originActionAssessments.length, units.length);
  assert.equal(
    review.originActionAssessments.every((item) => (
      item.exactQuotes.length === 0 && item.confidence === 1
    )),
    true,
  );
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

test("P04 Reviewer coverage cannot skip the real T02 governor-order paragraph", () => {
  const draft = [
    "总督重申暂缓签发，并愿承担三日限期内的延误责任。",
    "总督又说：本督派员赴县，会同县令当场查验。书面回话，本督会给。",
    "巡抚书吏随后询问抚院是否可以派员到场。",
  ].join("\n\n");
  const incomplete = parseTruthReview({
    raw: JSON.stringify({
      assertions: [],
      missingRequiredPredicateIds: [],
      unknownEntityMentions: [],
      factClaims: [],
    }),
    draft,
    draftId: "regression.t02",
    reviewId: "regression.t02.review",
    reviewerModel: "fixture-reviewer",
    context,
  });
  assert.equal(incomplete.parseStatus, "INVALID");
  assert.match(incomplete.invalidReason || "", /originActionAssessments/i);

  const quote = "本督派员赴县，会同县令当场查验";
  const units = buildTruthReviewUnits(draft);
  const covered = parseTruthReview({
    raw: JSON.stringify({
      assertions: [],
      originActionAssessments: units.map((unit) => unit.text.includes(quote)
        ? {
            unitId: unit.unitId,
            classification: "UNAUTHORIZED",
            exactQuotes: [quote],
            confidence: 0.99,
          }
        : {
            unitId: unit.unitId,
            classification: "NO_DURABLE_ACTION",
            exactQuotes: [],
            confidence: 0.99,
          }),
      missingRequiredPredicateIds: [],
      unknownEntityMentions: [],
      factClaims: [],
    }),
    draft,
    draftId: "regression.t02.covered",
    reviewId: "regression.t02.covered.review",
    reviewerModel: "fixture-reviewer",
    context,
  });
  assert.equal(covered.parseStatus, "VALID");
  const comparison = compareTruthReview({ review: covered, context });
  assert.equal(comparison.conflicts[0]?.code, "UNAUTHORIZED_PLAYER_ACTION");
  assert.equal(comparison.conflicts[0]?.exactQuote, quote);
});

test("P04 origin-action coverage is the same protocol in a second world", () => {
  const draft = "The captain also ordered a second shuttle to launch.";
  const quote = "ordered a second shuttle to launch";
  const unit = buildTruthReviewUnits(draft)[0]!;
  const review = parseTruthReview({
    raw: JSON.stringify({
      assertions: [],
      originActionAssessments: [{
        unitId: unit.unitId,
        classification: "UNAUTHORIZED",
        exactQuotes: [quote],
        confidence: 0.99,
      }],
      missingRequiredPredicateIds: [],
      unknownEntityMentions: [],
      factClaims: [],
    }),
    draft,
    draftId: "second-world.draft",
    reviewId: "second-world.review",
    reviewerModel: "fixture-reviewer",
    context,
  });
  assert.equal(
    compareTruthReview({ review, context }).conflicts[0]?.code,
    "UNAUTHORIZED_PLAYER_ACTION",
  );
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

test("P04 source mechanisms cannot authorize invented current quantities", () => {
  const draft = "海盐数县已经停办，粮价涨了三成，灾民又多出百十人。";
  const factContext: NarrativeTruthContext = {
    ...context,
    supportedStoryFacts: [{
      supportId: "current.grain.pressure",
      statement: "杭州粮价上涨，米行陆续闭门。",
    }],
    mechanismOnlyEvidence: [{
      evidenceId: "source.grain.insufficient",
      statement: "原著只建立粮源不足，不提供本游戏当前涨幅或灾民人数。",
    }],
    specificityBoundary: "不得自行增加人数、涨幅、地点或期限。",
  };
  const review = parseTruthReview({
    raw: JSON.stringify(reviewPayload(draft, {
      assertions: [],
      missingRequiredPredicateIds: [],
      unknownEntityMentions: [],
      factClaims: [
        {
          exactQuote: "海盐数县已经停办",
          supportId: null,
          durability: "DURABLE",
          confidence: 0.99,
        },
        {
          exactQuote: "粮价涨了三成",
          supportId: null,
          durability: "DURABLE",
          confidence: 0.99,
        },
        {
          exactQuote: "灾民又多出百十人",
          supportId: null,
          durability: "DURABLE",
          confidence: 0.99,
        },
      ],
    })),
    draft,
    draftId: "regression.unsupported-quantities",
    reviewId: "regression.unsupported-quantities.review",
    reviewerModel: "fixture-reviewer",
    context: factContext,
  });
  assert.equal(review.parseStatus, "VALID");
  const result = compareTruthReview({ review, context: factContext });
  assert.deepEqual(
    result.conflicts.map((item) => item.code),
    [
      "UNSUPPORTED_DURABLE_FACT",
      "UNSUPPORTED_DURABLE_FACT",
      "UNSUPPORTED_DURABLE_FACT",
    ],
  );
});

test("P04 a current fact is accepted only through its explicit support id", () => {
  const draft = "杭州粮价仍在上涨。";
  const factContext: NarrativeTruthContext = {
    ...context,
    supportedStoryFacts: [{
      supportId: "current.grain.pressure",
      statement: "杭州粮价上涨。",
    }],
  };
  const review = parseTruthReview({
    raw: JSON.stringify(reviewPayload(draft, {
      assertions: [],
      missingRequiredPredicateIds: [],
      unknownEntityMentions: [],
      factClaims: [{
        exactQuote: draft,
        supportId: "current.grain.pressure",
        durability: "DURABLE",
        confidence: 0.99,
      }],
    })),
    draft,
    draftId: "fixture.supported-fact",
    reviewId: "fixture.supported-fact.review",
    reviewerModel: "fixture-reviewer",
    context: factContext,
  });
  assert.deepEqual(compareTruthReview({ review, context: factContext }).conflicts, []);
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
    raw: `\`\`\`json\n${JSON.stringify(reviewPayload(draft, {
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
    }))}\n\`\`\``,
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
    raw: JSON.stringify(reviewPayload(
      "The scene moves on without showing the settled result.",
      {
      assertions: [],
      missingRequiredPredicateIds: ["fixture.required.created"],
      unknownEntityMentions: [],
      },
    )),
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
    raw: JSON.stringify(reviewPayload(
      "The scene moves on without showing the settled result.",
      {
      assertions: [],
      missingRequiredPredicateIds: [],
      unknownEntityMentions: [],
      },
    )),
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
    raw: JSON.stringify(reviewPayload(draft, value)),
    draft,
    draftId: "fixture.draft.one",
    reviewId: "fixture.review.one",
    reviewerModel: "fixture-reviewer",
    context,
  });
}

function reviewPayload(draft: string, value: unknown) {
  const record = value as Record<string, unknown>;
  const assertions = Array.isArray(record.assertions)
    ? record.assertions as Array<Record<string, unknown>>
    : [];
  const originActionAssessments = buildTruthReviewUnits(draft).map((unit) => {
    const matches = assertions.filter((assertion) => {
      const predicate = assertion.predicate as Record<string, unknown> | undefined;
      const quote = String(assertion.exactQuote || "");
      return (
        (predicate?.type === "ACTOR.ORDERED" || predicate?.type === "ACTOR.COMMITTED")
        && predicate.actorId === context.originActorId
        && unit.text.includes(quote)
      );
    });
    return matches.length
      ? {
          unitId: unit.unitId,
          classification: "UNAUTHORIZED",
          exactQuotes: matches.map((item) => String(item.exactQuote)),
          confidence: 0.99,
        }
      : {
          unitId: unit.unitId,
          classification: "NO_DURABLE_ACTION",
          exactQuotes: [],
          confidence: 0.99,
        };
  });
  return {
    factClaims: [],
    ...record,
    originActionAssessments,
  };
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
