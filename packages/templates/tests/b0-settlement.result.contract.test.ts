import assert from "node:assert/strict";
import test from "node:test";
import { validateB0CausalEdgeV1, validateB0SettlementResolutionV1 } from "@ai-story/shared";
import { validEdge, validResolution } from "./b0-settlement.fixtures";

test("causal edge and resolution reject unknown fields", () => {
  assert.equal(validateB0CausalEdgeV1(validEdge()).ok, true);
  assert.equal(validateB0CausalEdgeV1({ ...validEdge(), affectedActorIds: ["actor.b"] }).ok, false);
  assert.equal(validateB0SettlementResolutionV1(validResolution()).ok, true);
});

test("cross-player impact requires another actor and a durable mutation", () => {
  const invalidCross = {
    ...validResolution(),
    structuredResults: [{
      resultId: "result.cross", resultKind: "CROSS_PLAYER_IMPACT",
      originIntentIds: ["intent.a"], originActorIds: ["actor.a"],
      targetActorIds: ["actor.a"], summary: "Invalid self-only cross-player result.",
      durableMutationIds: [], audience: { type: "ACTOR_ONLY", actorRef: "actor.a" },
    }],
  };
  assert.equal(validateB0SettlementResolutionV1(invalidCross).ok, false);
});
