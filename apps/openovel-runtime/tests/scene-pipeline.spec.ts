import assert from "node:assert/strict";
import test from "node:test";
import {
  SceneExpressionPipeline,
  parseSceneDraft,
  scenePipelineModulesFromEnv,
} from "../src/scene-pipeline.js";
import {
  MAX_COVERAGE_RESPONSE_BYTES,
  MAX_P0_RESPONSE_BYTES,
} from "../src/scene-review-contract.js";
import {
  SCENE_DRAFT_SCHEMA,
  type BeatManifest,
  type PlayerVisibleFallbackDraft,
  type SceneDraft,
} from "../src/scene-expression.js";
import type { NarrativeTruthContext } from "../src/truth-review.js";
import type {
  OpenNovelProvider,
  ProviderRequest,
  ProviderResult,
} from "../src/types.js";

test("real entrypoints default to critical-only review while preserving pluggable modes", () => {
  const provider = new ReviewProvider("PASS");
  assert.deepEqual(
    new SceneExpressionPipeline(provider, scenePipelineModulesFromEnv(provider, {})).moduleIds(),
    {
      truthObserver: "truth-observer.bounded-model.v1",
      reviewPolicy: "review-policy.critical-only.v1",
    },
  );
  assert.deepEqual(
    new SceneExpressionPipeline(provider, scenePipelineModulesFromEnv(provider, {
      OPENOVEL_TRUTH_REVIEW_MODE: "OFF",
    })).moduleIds(),
    {
      truthObserver: "truth-observer.disabled.v1",
      reviewPolicy: "review-policy.observe-only.v1",
    },
  );
});

test("model slot-list transport is normalized without changing prose", () => {
  const raw = JSON.stringify({
    schemaVersion: SCENE_DRAFT_SCHEMA,
    draftId: "T03.draft.original",
    owner: "NARRATOR",
    slots: [
      { slot: "WORLD_PRESSURE", value: "The envoy refuses the signature." },
      { slot: "DECISION_STOP", value: "The council waits for a decision." },
    ],
  });
  assert.deepEqual(parseSceneDraft(raw, "T03.draft.original").slots, {
    WORLD_PRESSURE: "The envoy refuses the signature.",
    DECISION_STOP: "The council waits for a decision.",
  });
});

test("model slot-list transport rejects duplicates and unknown fields", () => {
  const base = {
    schemaVersion: SCENE_DRAFT_SCHEMA,
    draftId: "T03.draft.original",
    owner: "NARRATOR",
  };
  assert.throws(() => parseSceneDraft(JSON.stringify({
    ...base,
    slots: [
      { slot: "WORLD_PRESSURE", value: "one" },
      { slot: "WORLD_PRESSURE", value: "two" },
    ],
  }), "T03.draft.original"), /SCENE_DRAFT_SLOT_DUPLICATE/u);
  assert.throws(() => parseSceneDraft(JSON.stringify({
    ...base,
    slots: [{ slot: "WORLD_PRESSURE", value: "one", command: "hidden" }],
  }), "T03.draft.original"), /SCENE_DRAFT_SLOT_LIST_ENTRY_INVALID/u);
});

test("bounded P0 review accepts a complete Narrator scene without a model coverage call", async () => {
  const provider = new ReviewProvider("PASS");
  const input = fixture();
  const result = await new SceneExpressionPipeline(provider, "ENFORCING").resolve(input);
  assert.equal(result.disposition.kind, "USE_ORIGINAL");
  assert.equal(result.assemblyManifest.owner, "NARRATOR");
  assert.deepEqual(result.calls.map((call) => call.stage), ["p0-reviewer"]);
  assert.deepEqual(provider.profiles, ["reviewer"]);
  assert.equal(result.finalText, Object.values(input.narratorDraft.slots).join("\n\n"));
  assert.match(result.factText, /chosen seal order/i);
});

test("coverage stays advisory without consuming another model call", async () => {
  const provider = new ReviewProvider("WRONG_SLOT");
  const input = fixture();
  const result = await new SceneExpressionPipeline(provider, "ENFORCING").resolve(input);
  assert.equal(result.disposition.kind, "USE_ORIGINAL");
  assert.equal(result.assemblyManifest.owner, "NARRATOR");
  assert.deepEqual(provider.profiles, ["reviewer"]);
});

test("P0 review retries one transport failure without regenerating the scene", async () => {
  const provider = new ReviewProvider("PASS", 1);
  const input = fixture();
  const result = await new SceneExpressionPipeline(provider, "ENFORCING").resolve(input);
  assert.equal(result.disposition.kind, "USE_ORIGINAL");
  assert.deepEqual(result.calls.map((call) => call.attempt), [1, 2]);
  assert.deepEqual(provider.profiles, ["reviewer", "reviewer"]);
});

test("invalid Reviewer structure safely selects the Story Package fallback", async () => {
  const provider = new ReviewProvider("INVALID_P0_SHAPE");
  const input = fixture();
  const result = await new SceneExpressionPipeline(provider, "ENFORCING").resolve(input);
  assert.equal(result.disposition.kind, "USE_FALLBACK");
  assert.match(result.fallbackReason || "", /^REVIEW_UNAVAILABLE_SAFE_DEGRADE:SCENE_REVIEW_INVALID:/u);
  assert.equal(result.finalText, Object.values(input.fallbackDraft.slots).join("\n\n"));
  assert.deepEqual(result.reviewObservation.criticalFindings, []);
});

test("an extra player order becomes a server-decided P0 and selects fallback", async () => {
  const provider = new ReviewProvider("EXTRA_PLAYER_ORDER");
  const input = fixture(true);
  const result = await new SceneExpressionPipeline(provider, "ENFORCING").resolve(input);
  assert.equal(result.disposition.kind, "USE_FALLBACK");
  assert.equal(result.fallbackReason, "UNAUTHORIZED_PLAYER_ACTION");
});

test("advisory mode publishes a structurally valid scene without waiting for Reviewer", async () => {
  const provider = new ReviewProvider("EXTRA_PLAYER_ORDER");
  const input = fixture(true);
  const result = await new SceneExpressionPipeline(provider).resolve(input);
  assert.equal(result.disposition.kind, "USE_ORIGINAL");
  assert.equal(result.assemblyManifest.owner, "NARRATOR");
  assert.deepEqual(provider.profiles, []);
  assert.equal(result.contextText, result.factText);
  assert.notEqual(result.contextText, result.finalText);
  assert.doesNotMatch(result.contextText, /ordered an arrest/i);
});

test("review response budgets are derived from fixed-size contracts", () => {
  assert.ok(MAX_COVERAGE_RESPONSE_BYTES > 0 && MAX_COVERAGE_RESPONSE_BYTES < 8_000);
  assert.ok(MAX_P0_RESPONSE_BYTES > 0 && MAX_P0_RESPONSE_BYTES < 12_000);
});

function fixture(extraOrder = false) {
  const resultText = extraOrder
    ? "The governor issued the chosen seal order. He also ordered an arrest."
    : "The governor issued the chosen seal order.";
  const pressureText = "The clerk asks how the order should be recorded.";
  const stopText = "The room waits for the governor's answer.";
  const scene = {
    sceneId: "hall",
    timeLabel: "now",
    locationLabel: "hall",
    presentActorIds: ["actor.governor", "actor.clerk"],
  };
  const manifest: BeatManifest = {
    beatId: "beat.one",
    sourceRef: "event.one",
    transition: {
      beforeScene: scene,
      narrationScene: scene,
      afterScene: scene,
      transitionRequired: false,
      arrivingActorIds: [],
      departingActorIds: [],
    },
    tickets: [
      ticket("result", "PLAYER_RESULT", "ACTION_PHASE", "The chosen seal order is issued."),
      ticket("pressure", "WORLD_PRESSURE", "AFTER_PHASE", "The clerk asks about the record."),
      ticket("stop", "DECISION_STOP", "AFTER_PHASE", "The governor must answer."),
    ],
  };
  const narratorDraft: SceneDraft = {
    schemaVersion: SCENE_DRAFT_SCHEMA,
    draftId: "T01.draft.original",
    owner: "NARRATOR",
    slots: {
      PLAYER_RESULT: resultText,
      WORLD_PRESSURE: pressureText,
      DECISION_STOP: stopText,
    },
  };
  const fallbackDraft: PlayerVisibleFallbackDraft = {
    schemaVersion: SCENE_DRAFT_SCHEMA,
    draftId: "T01.fallback",
    owner: "FALLBACK",
    slots: {
      PLAYER_RESULT: "The chosen order is entered in the log.",
      WORLD_PRESSURE: "The clerk keeps the open register on the desk.",
      DECISION_STOP: "The clerk asks what instruction should follow.",
    },
    surfaceProvenance: {
      PLAYER_RESULT: provenance("ticket.result"),
      WORLD_PRESSURE: provenance("ticket.pressure"),
      DECISION_STOP: provenance("ticket.stop"),
    },
  };
  const truth = truthContext(stopText);
  return {
    turnId: "T01",
    runId: "run.one",
    worldRevision: 1,
    narratorRaw: JSON.stringify(narratorDraft),
    narratorDraft,
    manifest,
    fallbackDraft,
    truthContexts: { actionPhase: truth, afterPhase: truth },
  };
}

function provenance(ticketId: string) {
  return {
    surfaceSource: "STORY_PACKAGE" as const,
    sourceRef: "fixture.story-package",
    coveredTicketIds: [ticketId],
  };
}

function ticket(
  suffix: string,
  slot: BeatManifest["tickets"][number]["slot"],
  scenePhase: BeatManifest["tickets"][number]["scenePhase"],
  requiredMeaning: string,
) {
  return {
    ticketId: "ticket." + suffix,
    slot,
    scenePhase,
    required: true,
    sourceRefs: ["event.one"],
    requiredMeaning,
  };
}

function truthContext(stopCondition: string): NarrativeTruthContext {
  return {
    originActorId: "actor.governor",
    projectionActorId: "actor.governor",
    activeSceneEntityIds: ["actor.governor", "actor.clerk"],
    catalog: [
      { id: "actor.governor", kind: "ACTOR", displayName: "governor" },
      { id: "actor.clerk", kind: "ACTOR", displayName: "clerk" },
    ],
    capabilityIds: ["capability.seal", "capability.arrest"],
    secretIds: [],
    allowedPredicates: [{
      type: "ACTOR.ORDERED",
      constraints: { actorId: "actor.governor", capabilityId: "capability.seal" },
    }],
    requiredVisiblePredicates: [],
    forbiddenPredicates: [],
    originActionsInDraft: "FORBIDDEN",
    stopCondition,
  };
}

class ReviewProvider implements OpenNovelProvider {
  readonly profiles: ProviderRequest["profile"][] = [];
  constructor(
    private readonly mode: "PASS" | "WRONG_SLOT" | "EXTRA_PLAYER_ORDER" | "INVALID_P0_SHAPE",
    private remainingFailures = 0,
  ) {}
  describe() {
    return { provider: "fixture", model: "fixture", configured: true };
  }
  async generate(request: ProviderRequest): Promise<ProviderResult> {
    this.profiles.push(request.profile);
    if (this.remainingFailures > 0) {
      this.remainingFailures -= 1;
      throw new Error("fixture transport failure");
    }
    const contract = JSON.parse(request.messages[1]!.content) as Record<string, any>;
    const text = contract.schemaVersion === "omw.scene-coverage-review.v1"
      ? JSON.stringify(coverageResponse(contract, this.mode))
      : JSON.stringify(p0Response(contract, this.mode));
    return {
      text,
      model: "fixture-reviewer",
      usage: { inputTokens: 1, outputTokens: 1 },
      latencyMs: 1,
    };
  }
}

function coverageResponse(contract: Record<string, any>, mode: string) {
  const findings = Object.fromEntries(Object.entries(contract.slots).map(([slot, text]) => {
    const obligation = contract.obligations[slot];
    const required = Boolean(obligation.mustAppear);
    const status = mode === "WRONG_SLOT" && slot === "DECISION_STOP"
      ? "WRONG_SLOT"
      : required ? "COVERED_ONCE" : "NOT_REQUIRED";
    return [slot, {
      obligationId: obligation.obligationId,
      status,
      primarySpan: status === "COVERED_ONCE"
        ? { slot, start: 0, end: String(text).length }
        : null,
      duplicateSpan: null,
    }];
  }));
  return {
    schemaVersion: contract.schemaVersion,
    draftHash: contract.draftHash,
    manifestHash: contract.manifestHash,
    findings,
  };
}

function p0Response(contract: Record<string, any>, mode: string) {
  const none = () => ({
    presence: "NONE", slot: null, start: null, end: null, claimMode: null,
    explicitness: null, predicate: null, unknownEntity: null, confidence: null,
  });
  const candidates = {
    causalIntroduction: none(),
    keyEntityState: none(),
    secretLeak: none(),
    playerAction: none(),
  };
  if (mode === "INVALID_P0_SHAPE") {
    candidates.causalIntroduction = "NONE" as any;
  }
  if (mode === "EXTRA_PLAYER_ORDER") {
    const quote = "He also ordered an arrest.";
    const slotText = String(contract.slots.PLAYER_RESULT.text);
    const start = slotText.indexOf(quote);
    candidates.playerAction = {
      presence: "FOUND",
      slot: "PLAYER_RESULT",
      start,
      end: start + quote.length,
      claimMode: "ASSERTED",
      explicitness: "EXPLICIT",
      predicate: {
        type: "ACTOR.ORDERED",
        actorId: "actor.governor",
        capabilityId: "capability.arrest",
      },
      unknownEntity: null,
      confidence: 0.99,
    } as any;
  }
  return {
    schemaVersion: contract.schemaVersion,
    draftHash: contract.draftHash,
    catalogHash: contract.catalogHash,
    candidates,
  };
}
