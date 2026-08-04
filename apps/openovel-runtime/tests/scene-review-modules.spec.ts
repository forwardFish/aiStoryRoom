import assert from "node:assert/strict";
import test from "node:test";
import {
  CriticalOnlySceneReviewPolicy,
  ObserveOnlySceneReviewPolicy,
  type SceneTruthObservation,
} from "../src/scene-review-modules.js";

const observation = (input: Partial<SceneTruthObservation> & {
  criticalFindings?: string[];
  nonCriticalFindings?: string[];
}): SceneTruthObservation => ({
  status: "SKIPPED",
  observerModuleId: "observer.fixture.v1",
  calls: [],
  criticalFindings: input.criticalFindings || [],
  nonCriticalFindings: input.nonCriticalFindings || [],
});

test("MVP observe-only policy records but never blocks critical or texture findings", () => {
  const result = new ObserveOnlySceneReviewPolicy().decide(observation({
    criticalFindings: ["UNAUTHORIZED_PLAYER_ACTION"],
    nonCriticalFindings: ["incidental lamp color changed"],
  }));
  assert.equal(result.kind, "ACCEPT");
  assert.deepEqual(result.observation.criticalFindings, ["UNAUTHORIZED_PLAYER_ACTION"]);
  assert.deepEqual(result.observation.nonCriticalFindings, ["incidental lamp color changed"]);
});

test("critical-only policy ignores non-key texture but can replace the renderer output on a durable conflict", () => {
  const policy = new CriticalOnlySceneReviewPolicy();
  assert.equal(policy.decide(observation({
    nonCriticalFindings: ["incidental sleeve description drift"],
  })).kind, "ACCEPT");
  const critical = policy.decide(observation({
    criticalFindings: ["UNKNOWN_DURABLE_ENTITY"],
  }));
  assert.equal(critical.kind, "FALLBACK");
  assert.equal(critical.kind === "FALLBACK" ? critical.reason : "", "UNKNOWN_DURABLE_ENTITY");
});

test("reviewer unavailability is a non-blocking observation, not a fabricated P0", () => {
  const unavailable: SceneTruthObservation = {
    status: "UNAVAILABLE",
    observerModuleId: "observer.fixture.v1",
    calls: [],
    reason: "SCENE_REVIEW_UNAVAILABLE",
    criticalFindings: [],
    nonCriticalFindings: ["SCENE_REVIEW_UNAVAILABLE"],
  };
  assert.equal(new CriticalOnlySceneReviewPolicy().decide(unavailable).kind, "ACCEPT");
});