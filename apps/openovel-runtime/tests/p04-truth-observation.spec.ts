import assert from "node:assert/strict";
import test from "node:test";
import {
  TRUTH_OBSERVATION_SCHEMA,
  buildObservationReviewUnits,
  buildTruthObservationMessages,
  buildTruthObservationOutputSchema,
  compareTruthObservations,
  materializeShadowClaims,
  parseTruthObservationReview,
  projectShadowFreeText,
  truthTextHash,
  type ObservationReviewBinding,
} from "../src/truth-observation.js";
import type { NarrativeTruthContext } from "../src/truth-review.js";

const binding: ObservationReviewBinding = {
  runId: "run.fixture",
  worldRevision: 3,
  draftId: "T03.draft.original",
  reviewId: "T03.review.1",
};

const baseContext: NarrativeTruthContext = {
  originActorId: "actor.player",
  projectionActorId: "actor.player",
  activeSceneEntityIds: [
    "actor.player", "actor.clerk", "document.reply", "object.reply_box",
  ],
  catalog: [
    { id: "actor.player", kind: "ACTOR", displayName: "Governor" },
    { id: "actor.clerk", kind: "ACTOR", displayName: "Clerk" },
    { id: "actor.inspector", kind: "ACTOR", displayName: "Inspector" },
    { id: "document.reply", kind: "DOCUMENT", displayName: "Reply" },
    { id: "object.reply_box", kind: "OBJECT", displayName: "Reply box" },
    { id: "evidence.register", kind: "EVIDENCE", displayName: "Register" },
    { id: "secret.letter", kind: "SECRET", displayName: "Secret letter" },
  ],
  capabilityIds: ["capability.issue_order"],
  secretIds: ["secret.letter"],
  establishedPredicates: [
    {
      type: "ENTITY.STATE",
      entityId: "object.reply_box",
      attribute: "contentsState",
      value: "EMPTY",
    },
    {
      type: "ENTITY.STATE",
      entityId: "object.reply_box",
      attribute: "closureState",
      value: "CLOSED",
    },
  ],
  allowedPredicates: [],
  requiredVisiblePredicates: [],
  forbiddenPredicates: [],
  originActionsInDraft: "FORBIDDEN",
  forbiddenStoryClaims: [{
    boundaryId: "secret.boundary",
    statement: "The clerk does not know the secret letter contents.",
  }],
};

test("Reviewer extracts predicates while the server alone decides conflicts", () => {
  const draft = "The clerk waited for an answer.";
  const messages = buildTruthObservationMessages({ draft, binding, context: baseContext });
  const schema = buildTruthObservationOutputSchema({
    binding,
    textHash: truthTextHash(draft),
    context: baseContext,
  });
  const prompt = messages.map((message) => message.content).join("\n");
  assert.match(prompt, /never decide whether prose passes or conflicts/iu);
  assert.match(prompt, /establishedPredicates/u);
  assert.doesNotMatch(prompt, /authorizedFacts/u);
  assert.match(JSON.stringify(schema), /assertions/u);
});

test("review units cover all Unicode prose without story-specific semantics", () => {
  const draft = Array.from(
    { length: 18 },
    (_, index) => "??" + index + "?",
  ).join("\n");
  const units = buildObservationReviewUnits(draft);
  assert.equal(units.length, 8);
  assert.equal(units[0]?.quoteStart, 0);
  assert.equal(units.at(-1)?.quoteEnd, draft.length);
});

test("ordinary narrative texture creates no durable assertion", () => {
  const draft = "Lamplight crossed the desk while the clerk raised his eyes.";
  const review = parse(draft, output(draft));
  assert.equal(review.parseStatus, "VALID");
  assert.deepEqual(compareTruthObservations({ review, context: baseContext }), {
    conflicts: [],
    shadow: [],
  });
});

test("an established object state may be naturally restated", () => {
  const draft = "The reply box remained empty and closed.";
  const review = parse(draft, output(draft, {
    assertions: [
      assertion(draft, "The reply box remained empty", {
        type: "ENTITY.STATE",
        entityId: "object.reply_box",
        attribute: "contentsState",
        value: "EMPTY",
      }),
      assertion(draft, "closed", {
        type: "ENTITY.STATE",
        entityId: "object.reply_box",
        attribute: "closureState",
        value: "CLOSED",
      }),
    ],
  }));
  assert.deepEqual(compareTruthObservations({ review, context: baseContext }).conflicts, []);
});

test("a conflicting state for the same object is blocked without language rules", () => {
  const draft = "The reply box now stood open.";
  const review = parse(draft, output(draft, {
    assertions: [assertion(draft, draft, {
      type: "ENTITY.STATE",
      entityId: "object.reply_box",
      attribute: "closureState",
      value: "OPEN",
    })],
  }));
  const conflict = compareTruthObservations({ review, context: baseContext }).conflicts[0];
  assert.equal(conflict?.code, "UNAUTHORIZED_KEY_ENTITY_STATE");
  assert.equal(conflict?.exactQuote, draft);
});

test("an unregistered pose or incidental entity state stays in Shadow", () => {
  const draft = "The clerk stepped back and waited.";
  const review = parse(draft, output(draft, {
    assertions: [assertion(draft, draft, {
      type: "ENTITY.STATE",
      entityId: "actor.clerk",
      attribute: "posture",
      value: "WAITING",
    })],
  }));
  const compared = compareTruthObservations({ review, context: baseContext });
  assert.equal(compared.conflicts.length, 0);
  assert.equal(compared.shadow[0]?.reason, "UNAUTHORIZED_NON_P0_ASSERTION");
});

test("an additional player order is blocked by actor and typed capability", () => {
  const draft = "The governor ordered another man to follow the seal.";
  const review = parse(draft, output(draft, {
    assertions: [assertion(draft, draft, {
      type: "ACTOR.ORDERED",
      actorId: "actor.player",
      capabilityId: "capability.issue_order",
    })],
  }));
  assert.equal(
    compareTruthObservations({ review, context: baseContext }).conflicts[0]?.code,
    "UNAUTHORIZED_PLAYER_ACTION",
  );
});

test("an unverified NPC speech act stays in Shadow instead of rewriting prose", () => {
  const draft = "The clerk asks whether the governor will sign.";
  const review = parse(draft, output(draft, {
    assertions: [assertion(draft, draft, {
      type: "ACTOR.ORDERED",
      actorId: "actor.clerk",
      capabilityId: "capability.issue_order",
    })],
  }));
  const compared = compareTruthObservations({ review, context: baseContext });
  assert.equal(compared.conflicts.length, 0);
  assert.equal(compared.shadow[0]?.reason, "UNAUTHORIZED_NON_P0_ASSERTION");
});

test("ambiguous or low-confidence protected claims go to Shadow, not P0", () => {
  const draft = "It seemed the register might already be elsewhere.";
  const raw = output(draft, {
    assertions: [assertion(draft, draft, {
      type: "ENTITY.LOCATED_AT",
      entityId: "evidence.register",
      locationId: "object.reply_box",
    }, {
      claimMode: "UNCERTAIN",
      explicitness: "AMBIGUOUS",
      confidence: 0.55,
    })],
  });
  const compared = compareTruthObservations({
    review: parse(draft, raw),
    context: baseContext,
  });
  assert.equal(compared.conflicts.length, 0);
  assert.equal(compared.shadow[0]?.reason, "ASSERTION_NOT_EXPLICIT_HIGH_CONFIDENCE");
});

test("unknown surfaces remain Shadow until a typed causal predicate can be verified", () => {
  const draft = "A newly appointed censor entered carrying a formal warrant.";
  const review = parse(draft, output(draft, {
    unknownEntityMentions: [{
      unitId: unitFor(draft, draft),
      exactQuote: draft,
      surfaceName: "newly appointed censor",
      entityKind: "ACTOR",
      durableImpact: true,
      explicitness: "EXPLICIT",
      confidence: 0.97,
    }],
  }));
  const unknownCompared = compareTruthObservations({ review, context: baseContext });
  assert.equal(unknownCompared.conflicts.length, 0);
  assert.equal(
    unknownCompared.shadow[0]?.reason,
    "UNKNOWN_MENTION_HAS_NO_VERIFIABLE_PREDICATE",
  );

  const texture = "Someone beyond the screen shifted a chair.";
  const textureReview = parse(texture, output(texture, {
    unknownEntityMentions: [{
      unitId: unitFor(texture, texture),
      exactQuote: "Someone beyond the screen",
      surfaceName: "Someone",
      entityKind: "ACTOR",
      durableImpact: false,
      explicitness: "AMBIGUOUS",
      confidence: 0.4,
    }],
  }));
  const textureCompared = compareTruthObservations({
    review: textureReview,
    context: baseContext,
  });
  assert.equal(textureCompared.conflicts.length, 0);
  assert.equal(textureCompared.shadow.length, 1);
});

test("one malformed extraction item does not invalidate independent findings", () => {
  const draft = "The clerk waited. The governor ordered the arrest.";
  const raw = output(draft, {
    assertions: [
      {
        ...assertion(draft, "The clerk waited.", {
          type: "ENTITY.STATE",
          entityId: "actor.clerk",
          attribute: "posture",
          value: "WAITING",
        }),
        predicate: { type: "NOT.A.PREDICATE" },
      },
      assertion(draft, "The governor ordered the arrest.", {
        type: "ACTOR.ORDERED",
        actorId: "actor.player",
        capabilityId: "capability.issue_order",
      }),
    ],
  });
  const review = parse(draft, raw);
  assert.equal(review.parseStatus, "REPAIRED");
  assert.equal(review.parseIssues.length, 1);
  assert.equal(
    compareTruthObservations({ review, context: baseContext }).conflicts[0]?.code,
    "UNAUTHORIZED_PLAYER_ACTION",
  );
});

test("the same comparator blocks an unauthorized order in a second world", () => {
  const context: NarrativeTruthContext = {
    ...baseContext,
    originActorId: "actor.captain",
    projectionActorId: "actor.captain",
    catalog: [
      { id: "actor.captain", kind: "ACTOR", displayName: "Captain" },
      { id: "actor.navigator", kind: "ACTOR", displayName: "Navigator" },
    ],
    activeSceneEntityIds: ["actor.captain", "actor.navigator"],
    capabilityIds: ["capability.change_course"],
    secretIds: [],
    establishedPredicates: [],
    forbiddenStoryClaims: [],
  };
  const draft = "The captain ordered the ship through the sealed gate.";
  const review = parse(draft, output(draft, {
    assertions: [assertion(draft, draft, {
      type: "ACTOR.ORDERED",
      actorId: "actor.captain",
      capabilityId: "capability.change_course",
    })],
  }, context), context);
  assert.equal(
    compareTruthObservations({ review, context }).conflicts[0]?.code,
    "UNAUTHORIZED_PLAYER_ACTION",
  );
});

test("binding errors fail the whole review and Shadow cannot become state", () => {
  const draft = "The clerk waited.";
  const wrongHash = output(draft);
  wrongHash.textHash = truthTextHash("different");
  assert.equal(parse(draft, wrongHash).parseStatus, "INVALID");

  const claims = materializeShadowClaims({
    artifactId: "T03.draft.original",
    runId: "run.fixture",
    worldRevision: 3,
    shadow: [{
      reason: "UNKNOWN_MENTION_NOT_EXPLICIT_DURABLE",
      exactQuote: "clerk",
      quoteStart: draft.indexOf("clerk"),
      quoteEnd: draft.indexOf("clerk") + "clerk".length,
      unitId: "U001",
      kind: "causalIntroduction",
    }],
  });
  assert.equal(claims[0]?.stateWriteAllowed, false);
  assert.equal(claims[0]?.durableMemoryWriteAllowed, false);
  assert.equal(claims[0]?.optionsPremiseAllowed, false);
  assert.equal(claims[0]?.storykeeperFactWriteAllowed, false);
  assert.doesNotMatch(projectShadowFreeText(draft, claims), /clerk/u);
});

function parse(
  draft: string,
  raw: Record<string, unknown>,
  context = baseContext,
) {
  return parseTruthObservationReview({
    raw: JSON.stringify(raw),
    draft,
    binding,
    reviewerModel: "fixture-reviewer",
    context,
  });
}

function output(
  draft: string,
  overrides: {
    assertions?: unknown[];
    unknownEntityMentions?: unknown[];
  } = {},
  context = baseContext,
) {
  const messages = buildTruthObservationMessages({ draft, binding, context });
  const contract = JSON.parse(
    messages[1]?.content.split("# Truth Extraction Contract\n")[1] || "{}",
  ) as Record<string, unknown>;
  return {
    schemaVersion: TRUTH_OBSERVATION_SCHEMA,
    reviewId: binding.reviewId,
    draftId: binding.draftId,
    runId: binding.runId,
    worldRevision: binding.worldRevision,
    textHash: truthTextHash(draft),
    catalogHash: contract.catalogHash,
    assertions: overrides.assertions || [],
    unknownEntityMentions: overrides.unknownEntityMentions || [],
  };
}

function assertion(
  draft: string,
  quote: string,
  predicate: Record<string, unknown>,
  overrides: Record<string, unknown> = {},
) {
  return {
    unitId: unitFor(draft, quote),
    exactQuote: quote,
    predicate,
    claimMode: "ASSERTED",
    explicitness: "EXPLICIT",
    confidence: 0.99,
    ...overrides,
  };
}

function unitFor(draft: string, quote: string) {
  const unit = buildObservationReviewUnits(draft).find((item) => item.text.includes(quote));
  assert.ok(unit, "review unit not found for quote");
  return unit.unitId;
}
