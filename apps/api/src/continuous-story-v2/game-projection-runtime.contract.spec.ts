import assert from "node:assert/strict";
import test from "node:test";
import {
  CONTINUOUS_OPENOVEL_ENGINE_VERSION,
  CONTINUOUS_STORY_ENGINE_VERSION,
  GAME_PROJECTION_V2_SCHEMA_VERSION,
  OPENOVEL_ROLE_RUNTIME_MODE,
  validateGameProjectionV2
} from "@ai-story/shared";

function projection(engineVersion: "continuous_story_v2" | "continuous_openovel_v1" | "solo_story_v2", runtimeMode: "STRUCTURED_STORY_V2" | "OPENOVEL_ROLE_V1" | "SOLO_STORY_V2") {
  return {
    schemaVersion: GAME_PROJECTION_V2_SCHEMA_VERSION,
    engineVersion,
    runtimeMode,
    generatedAt: new Date().toISOString(),
    worldSequence: 0,
    room: {},
    player: {},
    control: {},
    currentTurn: null,
    timeline: [],
    otherActors: [],
    visibleAssets: [],
    evidenceHoldings: [],
    commitments: [],
    armedConditions: [],
    pendingInteractions: [],
    observableTraces: [],
    pendingImpacts: [],
    roleNarrativeState: { canonStatus: "EMPTY", generationStatus: "IDLE", impactStatus: "SYNCED", canRetry: false },
    access: {},
    creditControl: {},
    completed: false,
    resultUrl: null
  };
}

test("engine and runtime discriminator pairs are exact", () => {
  assert.equal(validateGameProjectionV2(projection(CONTINUOUS_STORY_ENGINE_VERSION, "STRUCTURED_STORY_V2")).ok, true);
  assert.equal(validateGameProjectionV2(projection(CONTINUOUS_OPENOVEL_ENGINE_VERSION, OPENOVEL_ROLE_RUNTIME_MODE)).ok, true);
  assert.equal(validateGameProjectionV2(projection("solo_story_v2", "SOLO_STORY_V2")).ok, true);
  assert.equal(validateGameProjectionV2(projection(CONTINUOUS_OPENOVEL_ENGINE_VERSION, "STRUCTURED_STORY_V2")).ok, false);
});

test("projection rejects internal state, prompts, rationale, and unknown top-level payload", () => {
  for (const mutation of [
    { currentTurn: { statePatch: { hidden: true } } },
    { room: { prompt: "secret" } },
    { timeline: [{ rationale: "private chain" }] },
    { internalPayload: { token: "secret" } }
  ]) {
    const value = projection(CONTINUOUS_OPENOVEL_ENGINE_VERSION, OPENOVEL_ROLE_RUNTIME_MODE) as Record<string, unknown>;
    Object.assign(value, mutation);
    assert.equal(validateGameProjectionV2(value).ok, false, JSON.stringify(mutation));
  }
});

test("orphan recovery impact is explicit and retains nullable sequence", () => {
  const value: any = projection(CONTINUOUS_OPENOVEL_ENGINE_VERSION, OPENOVEL_ROLE_RUNTIME_MODE);
  value.pendingImpacts = [{ id: "orphan", status: "RECOVERY_REQUIRED", appliedWorldSequence: null }];
  value.roleNarrativeState = { canonStatus: "READY", generationStatus: "IDLE", impactStatus: "RECOVERY_REQUIRED", canRetry: true };
  assert.equal(validateGameProjectionV2(value).ok, true);
});
