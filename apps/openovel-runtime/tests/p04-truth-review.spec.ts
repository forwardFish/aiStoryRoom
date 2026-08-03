import assert from "node:assert/strict";
import test from "node:test";
import templatesPackage from "@ai-story/templates";
import {
  buildNarrativeTruthContextFromEnvelope,
  buildStoryFactReviewUnits,
  buildTruthReviewUnits,
  compareTruthReview,
  parseTruthReview,
  type NarrativeTruthContext,
} from "../src/truth-review.js";

const {
  caesarRuntimeFixture,
  caesarSettlementFixture,
  compilePlayerTurnProjection,
  DeterministicSettlementEngine,
} = templatesPackage;

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

test("P04 the shared envelope compiles the Reviewer contract without a world adapter", () => {
  const runId = "caesar.run.truth-context";
  const actionId = "caesar.action.truth-context";
  const outcome = new DeterministicSettlementEngine().settle(
    caesarRuntimeFixture,
    caesarSettlementFixture,
    {
      runId,
      state: structuredClone(caesarRuntimeFixture.openingState),
      events: [],
      pending: [],
    },
    {
      actionId,
      runId,
      actorId: caesarRuntimeFixture.roles[0]!.actorId,
      rawText: "Use the available civic capability.",
      submittedAt: "2026-08-03T00:00:00.000Z",
      expectedStateRevision: 0,
      intentType: "USE_CAPABILITY",
      referencedEntityIds: [caesarRuntimeFixture.entities[2]!.id],
      proposedCapabilityId: caesarRuntimeFixture.capabilities[0]!.id,
      explicitCommitment: false,
      explicitOrder: false,
      confidence: 1,
    },
  );
  assert.equal(outcome.kind, "ACCEPTED");
  if (outcome.kind !== "ACCEPTED") throw new Error("fixture settlement was not accepted");
  const projection = compilePlayerTurnProjection({
    contract: caesarRuntimeFixture,
    snapshot: outcome.result.snapshot,
    envelope: outcome.result.envelope,
    actorId: outcome.result.envelope.projectionActorId,
  });
  const truthContext = buildNarrativeTruthContextFromEnvelope({
    contract: caesarRuntimeFixture,
    envelope: outcome.result.envelope,
    events: outcome.result.events,
    projection,
    originActionsInDraft: "ALLOWED_BY_ENVELOPE",
  });

  assert.deepEqual(
    truthContext.requiredVisiblePredicates.map((required) => required.supportIds),
    outcome.result.envelope.requiredVisiblePredicates.map((required) => required.supportEventIds),
  );
  assert.deepEqual(
    truthContext.allowedPredicates,
    outcome.result.envelope.allowedPredicates,
  );
  assert.equal(truthContext.stopCondition, outcome.result.envelope.narrativeSeed.stopCondition);
  assert.ok(truthContext.supportedStoryFacts?.every((fact) => (
    outcome.result.events.some((event) => event.eventId === fact.supportId)
  )));
});

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

test("P04 does not hard-block a fact claim already contained in one authorized assertion", () => {
  const draft = "The authorized order now exists.";
  const review = parsed(draft, {
    assertions: [{
      predicate: {
        type: "DOCUMENT.CREATED",
        documentId: "fixture.document.order",
      },
      ...span(draft, draft),
      explicitness: "EXPLICIT",
      confidence: 0.99,
    }],
    missingRequiredPredicateIds: [],
    unknownEntityMentions: [],
    factClaims: [{
      exactQuote: "authorized order now exists",
      supportId: null,
      durability: "DURABLE",
      confidence: 0.99,
    }],
  });
  const result = compareTruthReview({ review, context });
  assert.deepEqual(result.conflicts, []);
  assert.equal(result.shadow[0]?.reason, "UNSUPPORTED_DURABLE_SHADOW");
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
      storyFactAssessments: buildStoryFactReviewUnits(draft).map((unit) => ({
        unitId: unit.unitId,
        classification: "TEXTURE_OR_TRANSIENT",
        supportIds: [],
        confidence: 1,
      })),
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
      storyFactAssessments: textureStoryFactAssessments(draft),
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
      storyFactAssessments: textureStoryFactAssessments(draft),
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

test("P04 fact-unit coverage keeps a comma-heavy attributed sentence bounded", () => {
  const draft = "亲随说：\"原册没有随信送来，县尊说须候大人示下。\"";
  const factContext: NarrativeTruthContext = {
    ...context,
    supportedStoryFacts: [{
      supportId: "current.register.not-delivered",
      statement: "原册没有随密信送到总督府。",
      claimSupport: true,
    }],
  };
  const factUnits = buildStoryFactReviewUnits(draft);
  assert.deepEqual(
    factUnits.filter((unit) => /原册|县尊/u.test(unit.text)).map((unit) => unit.text),
    ["亲随说：\"原册没有随信送来，县尊说须候大人示下。"],
  );
  const review = parseTruthReview({
    raw: JSON.stringify({
      assertions: [],
      originActionAssessments: buildTruthReviewUnits(draft).map((unit) => ({
        unitId: unit.unitId,
        classification: "NO_DURABLE_ACTION",
        exactQuotes: [],
        confidence: 0.99,
      })),
      storyFactAssessments: factUnits.map((unit) => ({
        unitId: unit.unitId,
        classification: "UNSUPPORTED_DURABLE_SHADOW",
        supportIds: [],
        confidence: 0.95,
      })),
      missingRequiredPredicateIds: [],
      unknownEntityMentions: [],
    }),
    draft,
    draftId: "regression.fact-unit-attributed-shadow",
    reviewId: "regression.fact-unit-attributed-shadow.review",
    reviewerModel: "fixture-reviewer",
    context: factContext,
  });
  assert.equal(review.parseStatus, "VALID");
  const comparison = compareTruthReview({ review, context: factContext });
  assert.deepEqual(comparison.conflicts, []);
  assert.equal(comparison.shadow[0]?.reason, "UNSUPPORTED_DURABLE_SHADOW");
  assert.equal(
    comparison.shadow[0]?.exactQuote,
    "亲随说：\"原册没有随信送来，县尊说须候大人示下。",
  );
});

test("P04 fact-unit coverage stays bounded for literary Chinese commas", () => {
  const draft = `${Array.from({ length: 40 }, (_, index) => `第${index + 1}层叙事纹理`).join("，")}。`;
  const units = buildStoryFactReviewUnits(draft);
  assert.equal(units.length, 1);
  assert.equal(units[0]?.text, draft);
});

test("P04 fact-unit coverage cannot omit a second claim hidden in one sentence", () => {
  const draft = "The register was not delivered, and three districts already stopped work.";
  const factUnits = buildStoryFactReviewUnits(draft);
  const incomplete = parseTruthReview({
    raw: JSON.stringify({
      assertions: [],
      originActionAssessments: buildTruthReviewUnits(draft).map((unit) => ({
        unitId: unit.unitId,
        classification: "NO_DURABLE_ACTION",
        exactQuotes: [],
        confidence: 0.99,
      })),
      storyFactAssessments: factUnits.slice(0, -1).map((unit) => ({
        unitId: unit.unitId,
        classification: "TEXTURE_OR_TRANSIENT",
        supportIds: [],
        confidence: 0.99,
      })),
      missingRequiredPredicateIds: [],
      unknownEntityMentions: [],
    }),
    draft,
    draftId: "regression.fact-unit-complete-coverage",
    reviewId: "regression.fact-unit-complete-coverage.review",
    reviewerModel: "fixture-reviewer",
    context,
  });
  assert.equal(incomplete.parseStatus, "INVALID");
  assert.match(incomplete.invalidReason || "", /STORY_FACT_UNIT_MISSING/u);
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
      storyFactAssessments: textureStoryFactAssessments(draft),
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
      unitId: buildStoryFactReviewUnits(draft)[1]!.unitId,
      exactQuote: "an unnamed attendant",
      surfaceName: "an unnamed attendant",
      entityKind: "ACTOR",
      introductionMode: "AMBIGUOUS",
      durableImpact: false,
      confidence: 0.99,
    }],
  });
  const result = compareTruthReview({ review, context });
  assert.deepEqual(result.conflicts, []);
  assert.equal(result.shadow[0]?.reason, "UNKNOWN_MENTION_TEXTURE");
});

test("P04 source mechanisms cannot promote invented current quantities into world truth", () => {
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
  assert.deepEqual(result.conflicts, []);
  assert.equal(result.shadow.length, 1);
  assert.equal(result.shadow.every((item) => (
    item.reason === "UNSUPPORTED_DURABLE_SHADOW"
  )), true);
  assert.equal(result.shadow[0]?.exactQuote, draft);
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

test("P04 a required beat support cannot be reused as broad fact authorization", () => {
  const draft = "The clerk asks for a reply; three districts have already closed their granaries.";
  const invented = "three districts have already closed their granaries";
  const factContext: NarrativeTruthContext = {
    ...context,
    supportedStoryFacts: [{
      supportId: "beat.clerk.pressure",
      statement: "The clerk remains and asks which execution boundary the governor will choose.",
      claimSupport: false,
    }],
    forbiddenStoryClaims: [{
      boundaryId: "boundary.no-exact-place-count",
      statement: "No exact number of districts or completed granary closures is established.",
    }],
  };
  const review = parseTruthReview({
    raw: JSON.stringify(reviewPayload(draft, {
      assertions: [],
      missingRequiredPredicateIds: [],
      unknownEntityMentions: [],
      factClaims: [{
        exactQuote: invented,
        supportId: "beat.clerk.pressure",
        durability: "DURABLE",
        confidence: 0.99,
      }],
    })),
    draft,
    draftId: "fixture.non-claim-support",
    reviewId: "fixture.non-claim-support.review",
    reviewerModel: "fixture-reviewer",
    context: factContext,
  });
  assert.equal(review.factClaims[0]?.supportId, null);
  const comparison = compareTruthReview({ review, context: factContext });
  assert.deepEqual(comparison.conflicts, []);
  assert.equal(comparison.shadow[0]?.reason, "UNSUPPORTED_DURABLE_SHADOW");
});

test("P04 regression: a protected player action cannot support invented register specifics", () => {
  const draft = [
    "桑田一项数额比去岁实丈多了三百余亩。",
    "各乡呈报的户名、地段，与存底所录对不上处不止一处。",
    "末尾几个字确实只写到‘似有改痕，不敢断言’。",
  ].join("");
  const actionSupportId = "CURRENT-DK-P1-REVIEW-INITIATION-1";
  const factContext: NarrativeTruthContext = {
    ...context,
    supportedStoryFacts: [
      {
        supportId: actionSupportId,
        statement: "玩家已经执行：暂不签发，并只向亲随核对密信报疑。",
        claimSupport: false,
      },
      {
        supportId: "KNOWLEDGE:REGISTER:ALLOW:1",
        statement: "分户田数逐项相加的合计与册尾所列总数不符。",
        claimSupport: true,
      },
    ],
    forbiddenStoryClaims: [{
      boundaryId: "KNOWLEDGE:REGISTER:FORBID:1",
      statement: "具体田亩数、户数、差额、册页文字或精确数量均未建立。",
    }],
  };
  const quotes = [
    "桑田一项数额比去岁实丈多了三百余亩",
    "各乡呈报的户名、地段，与存底所录对不上处不止一处",
    "末尾几个字确实只写到‘似有改痕，不敢断言’",
  ];
  const review = parseTruthReview({
    raw: JSON.stringify(reviewPayload(draft, {
      assertions: [],
      missingRequiredPredicateIds: [],
      unknownEntityMentions: [],
      factClaims: quotes.map((exactQuote) => ({
        exactQuote,
        supportId: actionSupportId,
        durability: "DURABLE",
        confidence: 0.99,
      })),
    })),
    draft,
    draftId: "regression.action-support-overreach",
    reviewId: "regression.action-support-overreach.review",
    reviewerModel: "fixture-reviewer",
    context: factContext,
  });
  assert.deepEqual(review.factClaims.map((claim) => claim.supportId), [null, null, null]);
  const comparison = compareTruthReview({ review, context: factContext });
  assert.deepEqual(comparison.conflicts, []);
  assert.equal(comparison.shadow.length, 3);
});

test("P04 unsupported durable facts remain Shadow regardless of model confidence", () => {
  const draft = "A second colony has already lost three reactors.";
  const review = parseTruthReview({
    raw: JSON.stringify(reviewPayload(draft, {
      assertions: [],
      missingRequiredPredicateIds: [],
      unknownEntityMentions: [],
      factClaims: [{
        exactQuote: draft,
        supportId: null,
        durability: "DURABLE",
        confidence: 0.51,
      }],
    })),
    draft,
    draftId: "second-world.unsupported-durable",
    reviewId: "second-world.unsupported-durable.review",
    reviewerModel: "fixture-reviewer",
    context,
  });
  const comparison = compareTruthReview({ review, context });
  assert.deepEqual(comparison.conflicts, []);
  assert.equal(comparison.shadow[0]?.reason, "UNSUPPORTED_DURABLE_SHADOW");
  assert.equal(comparison.shadow[0]?.exactQuote, draft);
});

test("P04 model confidence never downgrades an explicit P0 verdict", () => {
  const draft = "The captain ordered an unapproved launch while Commander Nyx took custody.";
  const actionQuote = "The captain ordered an unapproved launch";
  const review = parseTruthReview({
    raw: JSON.stringify({
      assertions: [{
        predicate: {
          type: "ACTOR.ORDERED",
          actorId: "fixture.actor.player",
          capabilityId: "runtime.capability.unspecified_order",
        },
        ...span(draft, actionQuote),
        explicitness: "EXPLICIT",
        confidence: 0.51,
      }],
      originActionAssessments: buildTruthReviewUnits(draft).map((unit) => ({
        unitId: unit.unitId,
        classification: "UNAUTHORIZED",
        exactQuotes: [actionQuote],
        confidence: 0.51,
      })),
      missingRequiredPredicateIds: [],
      unknownEntityMentions: [{
        unitId: buildStoryFactReviewUnits(draft)[0]!.unitId,
        exactQuote: "Commander Nyx",
        surfaceName: "Commander Nyx",
        entityKind: "ACTOR",
        introductionMode: "EXPLICIT_UNKNOWN_EXISTING",
        durableImpact: true,
        confidence: 0.51,
      }],
      storyFactAssessments: textureStoryFactAssessments(draft),
    }),
    draft,
    draftId: "second-world.low-confidence-p0",
    reviewId: "second-world.low-confidence-p0.review",
    reviewerModel: "fixture-reviewer",
    context,
  });
  const comparison = compareTruthReview({ review, context });
  assert.deepEqual(
    comparison.conflicts.map((item) => item.code),
    [
      "UNAUTHORIZED_PLAYER_ACTION",
      "UNKNOWN_DURABLE_ENTITY",
    ],
  );
  assert.equal(comparison.shadow.length, 0);
});

test("P04 catalog aliases cannot be promoted into unknown durable entities", () => {
  const draft = "The aide took the known order to the hall.";
  const aliasContext: NarrativeTruthContext = {
    ...context,
    catalog: context.catalog.map((item) => item.id === "fixture.actor.aide"
      ? { ...item, aliases: ["the aide"] }
      : item),
  };
  const review = parseTruthReview({
    raw: JSON.stringify({
      assertions: [],
      originActionAssessments: buildTruthReviewUnits(draft).map((unit) => ({
        unitId: unit.unitId,
        classification: "NO_DURABLE_ACTION",
        exactQuotes: [],
        confidence: 0.99,
      })),
      storyFactAssessments: textureStoryFactAssessments(draft),
      missingRequiredPredicateIds: [],
      unknownEntityMentions: [{
        unitId: buildStoryFactReviewUnits(draft)[0]!.unitId,
        exactQuote: "The aide",
        surfaceName: "The aide",
        entityKind: "ACTOR",
        introductionMode: "EXPLICIT_UNKNOWN_EXISTING",
        durableImpact: true,
        confidence: 0.99,
      }],
    }),
    draft,
    draftId: "catalog-alias.draft",
    reviewId: "catalog-alias.review",
    reviewerModel: "fixture-reviewer",
    context: aliasContext,
  });
  const comparison = compareTruthReview({ review, context: aliasContext });
  assert.deepEqual(comparison.conflicts, []);
  assert.equal(comparison.shadow[0]?.reason, "ENTITY_CANDIDATE_ALREADY_CATALOGED");
});

test("P04 real T01 unsupported quantities and reported titles remain Shadow", () => {
  const draft = [
    "中丞的意思是先放行、后补细。",
    "米行今早已关了三家。",
  ].join("\n\n");
  const units = buildStoryFactReviewUnits(draft);
  const review = parseTruthReview({
    raw: JSON.stringify({
      assertions: [],
      originActionAssessments: buildTruthReviewUnits(draft).map((unit) => ({
        unitId: unit.unitId,
        classification: "NO_DURABLE_ACTION",
        exactQuotes: [],
        confidence: 0.99,
      })),
      storyFactAssessments: units.map((unit) => ({
        unitId: unit.unitId,
        classification: "UNSUPPORTED_DURABLE_SHADOW",
        supportIds: [],
        confidence: 0.9,
      })),
      missingRequiredPredicateIds: [],
      unknownEntityMentions: [
        {
          unitId: units[0]!.unitId,
          exactQuote: "中丞的意思",
          surfaceName: "中丞",
          entityKind: "ACTOR",
          introductionMode: "AMBIGUOUS",
          durableImpact: false,
          confidence: 0.9,
        },
        {
          unitId: units[1]!.unitId,
          exactQuote: "米行今早已关了三家",
          surfaceName: "米行",
          entityKind: "EVIDENCE",
          introductionMode: "AMBIGUOUS",
          durableImpact: false,
          confidence: 0.9,
        },
      ],
    }),
    draft,
    draftId: "regression.real-t01-shadow",
    reviewId: "regression.real-t01-shadow.review",
    reviewerModel: "fixture-reviewer",
    context,
  });
  const comparison = compareTruthReview({ review, context });
  assert.deepEqual(comparison.conflicts, []);
  assert.equal(
    comparison.shadow.filter((item) => item.reason === "UNSUPPORTED_DURABLE_SHADOW").length,
    2,
  );
});

test("P04 a new named aide carrying a new private letter is an exact P0", () => {
  const draft = "周幕僚走进签押房，从袖中取出一封私札交给总督。";
  const unit = buildStoryFactReviewUnits(draft)[0]!;
  const review = parseTruthReview({
    raw: JSON.stringify({
      assertions: [],
      originActionAssessments: buildTruthReviewUnits(draft).map((item) => ({
        unitId: item.unitId,
        classification: "NO_DURABLE_ACTION",
        exactQuotes: [],
        confidence: 0.99,
      })),
      storyFactAssessments: textureStoryFactAssessments(draft),
      missingRequiredPredicateIds: [],
      unknownEntityMentions: [
        {
          unitId: unit.unitId,
          exactQuote: "周幕僚走进签押房",
          surfaceName: "周幕僚",
          entityKind: "ACTOR",
          introductionMode: "EXPLICIT_NEW",
          durableImpact: true,
          confidence: 0.99,
        },
        {
          unitId: unit.unitId,
          exactQuote: "一封私札交给总督",
          surfaceName: "私札",
          entityKind: "DOCUMENT",
          introductionMode: "EXPLICIT_NEW",
          durableImpact: true,
          confidence: 0.99,
        },
      ],
    }),
    draft,
    draftId: "regression.real-t03-new-entities",
    reviewId: "regression.real-t03-new-entities.review",
    reviewerModel: "fixture-reviewer",
    context,
  });
  assert.deepEqual(
    compareTruthReview({ review, context }).conflicts.map((item) => item.code),
    ["UNKNOWN_DURABLE_ENTITY", "UNKNOWN_DURABLE_ENTITY"],
  );
});

test("P04 malformed entity candidates are audited instead of becoming P0", () => {
  const draft = "The lamp burned beside ordinary paper.";
  const unit = buildStoryFactReviewUnits(draft)[0]!;
  const review = parseTruthReview({
    raw: JSON.stringify({
      assertions: [],
      originActionAssessments: buildTruthReviewUnits(draft).map((item) => ({
        unitId: item.unitId,
        classification: "NO_DURABLE_ACTION",
        exactQuotes: [],
        confidence: 0.99,
      })),
      storyFactAssessments: textureStoryFactAssessments(draft),
      missingRequiredPredicateIds: [],
      unknownEntityMentions: [{
        unitId: unit.unitId,
        exactQuote: "ordinary paper",
        surfaceName: "a private treaty",
        entityKind: "DOCUMENT",
        introductionMode: "EXPLICIT_NEW",
        durableImpact: true,
        confidence: 0.99,
      }],
    }),
    draft,
    draftId: "malformed-entity-candidate.draft",
    reviewId: "malformed-entity-candidate.review",
    reviewerModel: "fixture-reviewer",
    context,
  });
  assert.equal(review.parseStatus, "REPAIRED");
  const comparison = compareTruthReview({ review, context });
  assert.deepEqual(comparison.conflicts, []);
  assert.match(comparison.shadow[0]?.reason || "", /ENTITY_CANDIDATE_INVALID/u);
});

test("P04 the same unknown-entity protocol blocks a new ship document", () => {
  const draft = "Engineer Vela entered the bridge carrying the sealed Helios protocol.";
  const unit = buildStoryFactReviewUnits(draft)[0]!;
  const review = parseTruthReview({
    raw: JSON.stringify({
      assertions: [],
      originActionAssessments: buildTruthReviewUnits(draft).map((item) => ({
        unitId: item.unitId,
        classification: "NO_DURABLE_ACTION",
        exactQuotes: [],
        confidence: 0.99,
      })),
      storyFactAssessments: textureStoryFactAssessments(draft),
      missingRequiredPredicateIds: [],
      unknownEntityMentions: [{
        unitId: unit.unitId,
        exactQuote: "Engineer Vela entered the bridge",
        surfaceName: "Engineer Vela",
        entityKind: "ACTOR",
        introductionMode: "EXPLICIT_NEW",
        durableImpact: true,
        confidence: 0.99,
      }],
    }),
    draft,
    draftId: "second-world.new-actor",
    reviewId: "second-world.new-actor.review",
    reviewerModel: "fixture-reviewer",
    context,
  });
  assert.equal(
    compareTruthReview({ review, context }).conflicts[0]?.code,
    "UNKNOWN_DURABLE_ENTITY",
  );
});

test("P04 an explicit required meaning is present regardless of model confidence", () => {
  const draft = "The aide seals the damaged airlock.";
  const exactQuote = "seals the damaged airlock";
  const capabilityId = "fixture.capability.seal_airlock";
  const requiredContext: NarrativeTruthContext = {
    ...context,
    catalog: [
      ...context.catalog,
      { id: capabilityId, kind: "CAPABILITY", displayName: "Seal the airlock" },
    ],
    capabilityIds: [...context.capabilityIds, capabilityId],
    allowedPredicates: [{
      type: "ACTOR.ORDERED",
      constraints: { actorId: "fixture.actor.aide", capabilityId },
    }],
    requiredVisiblePredicates: [{
      id: "fixture.required.airlock",
      pattern: {
        type: "ACTOR.ORDERED",
        constraints: { actorId: "fixture.actor.aide", capabilityId },
      },
      requiredMeaning: "The aide seals the damaged airlock.",
      supportIds: ["fixture.fact.airlock"],
    }],
    supportedStoryFacts: [{
      supportId: "fixture.fact.airlock",
      statement: "The aide must seal the damaged airlock.",
    }],
  };
  const review = parseTruthReview({
    raw: JSON.stringify(reviewPayload(draft, {
      assertions: [{
        predicate: {
          type: "ACTOR.ORDERED",
          actorId: "fixture.actor.aide",
          capabilityId,
        },
        ...span(draft, exactQuote),
        explicitness: "EXPLICIT",
        confidence: 0.51,
      }],
      missingRequiredPredicateIds: [],
      unknownEntityMentions: [],
    })),
    draft,
    draftId: "second-world.required-low-confidence",
    reviewId: "second-world.required-low-confidence.review",
    reviewerModel: "fixture-reviewer",
    context: requiredContext,
  });
  assert.deepEqual(compareTruthReview({ review, context: requiredContext }).conflicts, []);
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

test("P04 repairs a unique quote whose paragraph whitespace was omitted without changing its words", () => {
  const draft = "The navigator closed the manifest.\n\nThe captain waited beside the sealed locker.";
  const reportedQuote = "The navigator closed the manifest.The captain waited beside the sealed locker.";
  const review = parseTruthReview({
    raw: JSON.stringify(reviewPayload(draft, {
      assertions: [{
        predicate: {
          type: "DOCUMENT.CREATED",
          documentId: "fixture.document.order",
        },
        exactQuote: reportedQuote,
        quoteStart: 0,
        quoteEnd: reportedQuote.length,
        explicitness: "EXPLICIT",
        confidence: 0.98,
      }],
      missingRequiredPredicateIds: [],
      unknownEntityMentions: [],
    })),
    draft,
    draftId: "second-world.whitespace-quote",
    reviewId: "second-world.whitespace-quote.review",
    reviewerModel: "fixture-reviewer",
    context,
  });
  assert.equal(review.parseStatus, "REPAIRED");
  assert.equal(review.assertions[0]?.exactQuote, draft);
  assert.equal(review.assertions[0]?.quoteStart, 0);
  assert.equal(review.assertions[0]?.quoteEnd, draft.length);
});

test("P04 whitespace repair stays strict when non-whitespace wording changes", () => {
  const draft = "The navigator closed the manifest.\n\nThe captain waited.";
  const changedQuote = "The navigator opened the manifest.The captain waited.";
  const review = parseTruthReview({
    raw: JSON.stringify(reviewPayload(draft, {
      assertions: [{
        predicate: {
          type: "DOCUMENT.CREATED",
          documentId: "fixture.document.order",
        },
        exactQuote: changedQuote,
        quoteStart: 0,
        quoteEnd: changedQuote.length,
        explicitness: "EXPLICIT",
        confidence: 0.98,
      }],
      missingRequiredPredicateIds: [],
      unknownEntityMentions: [],
    })),
    draft,
    draftId: "second-world.changed-quote",
    reviewId: "second-world.changed-quote.review",
    reviewerModel: "fixture-reviewer",
    context,
  });
  assert.equal(review.parseStatus, "INVALID");
  assert.match(review.invalidReason || "", /QUOTE_SPAN_INVALID/u);
});

test("P04 a valid required-predicate omission is an exact P0", () => {
  const requiredContext: NarrativeTruthContext = {
    ...context,
    requiredVisiblePredicates: [{
      id: "fixture.required.created",
      requiredMeaning: "The authorized order is visibly created.",
      supportIds: ["fixture.support.created"],
      pattern: {
        type: "DOCUMENT.CREATED",
        constraints: { documentId: "fixture.document.order" },
      },
    }],
    supportedStoryFacts: [{
      supportId: "fixture.support.created",
      statement: "The authorized order is visibly created.",
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
      requiredMeaning: "The authorized order is visibly created.",
      supportIds: ["fixture.support.created"],
      pattern: {
        type: "DOCUMENT.CREATED",
        constraints: { documentId: "fixture.document.order" },
      },
    }],
    supportedStoryFacts: [{
      supportId: "fixture.support.created",
      statement: "The authorized order is visibly created.",
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
  const legacyFactClaims = Array.isArray(record.factClaims)
    ? record.factClaims as Array<Record<string, unknown>>
    : [];
  const storyFactAssessments = buildStoryFactReviewUnits(draft).map((unit) => {
    const matches = legacyFactClaims.filter((claim) => {
      const exactQuote = String(claim.exactQuote || "");
      return exactQuote && (
        unit.text.includes(exactQuote)
        || exactQuote.includes(unit.text)
      );
    });
    const unsupported = matches.find((claim) => (
      String(claim.durability || "").toUpperCase() === "DURABLE"
      && !claim.supportId
    ));
    const supported = matches.find((claim) => (
      String(claim.durability || "").toUpperCase() === "DURABLE"
      && claim.supportId
    ));
    return unsupported
      ? {
          unitId: unit.unitId,
          classification: "UNSUPPORTED_DURABLE_SHADOW",
          supportIds: [],
          confidence: Number(unsupported.confidence ?? 1),
        }
      : supported
        ? {
            unitId: unit.unitId,
            classification: "SUPPORTED_DURABLE",
            supportIds: [String(supported.supportId)],
            confidence: Number(supported.confidence ?? 1),
          }
        : {
            unitId: unit.unitId,
            classification: "TEXTURE_OR_TRANSIENT",
            supportIds: [],
            confidence: 1,
          };
  });
  const { factClaims: _legacyFactClaims, ...review } = record;
  return {
    ...review,
    originActionAssessments,
    storyFactAssessments,
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

function textureStoryFactAssessments(draft: string) {
  return buildStoryFactReviewUnits(draft).map((unit) => ({
    unitId: unit.unitId,
    classification: "TEXTURE_OR_TRANSIENT",
    supportIds: [],
    confidence: 0.99,
  }));
}
