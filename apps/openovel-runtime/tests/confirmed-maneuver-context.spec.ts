import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import {
  DefaultActionGateway,
  playerActionFromRuntimeAction,
} from "../src/action-gateway.js";

const TAG = "OPENOVEL_SERVER_CONFIRMED_MANEUVERS_V1";
const SECRET = "openovel-confirmed-maneuver-development-secret-v1";

function decoratedAction(playerAction: string, preparedAtTurnNumber = 0) {
  const context = {
    schemaVersion: "openovel_confirmed_maneuver_context_v1",
    instruction: "Use confirmed player-visible maneuver results without expanding them.",
    preparedAtTurnNumber,
    sourceResultIds: ["maneuver-result-1"],
    summaries: [{
      resultId: "maneuver-result-1",
      decisionForm: "INVESTIGATION",
      title: "Confirmed investigation",
      content: "The registry date precedes the public order.",
      sceneKey: "neutral-scene",
      turnNumber: 0,
    }],
    visibleFacts: [{
      factKey: "registry_prepared_early",
      content: "The registry date precedes the public order.",
      sourceResultId: "maneuver-result-1",
    }],
    consumedLeverageKeys: [],
  };
  const payload = JSON.stringify(context);
  const signature = createHmac("sha256", SECRET).update(payload).digest("base64url");
  return `${playerAction}\n\n<${TAG} signature="${signature}">\n${payload}\n</${TAG}>`;
}

test("signed confirmed maneuver context reaches runtime while bound option matching uses only the player action", () => {
  const gateway = new DefaultActionGateway();
  const rawAction = decoratedAction("Keep the current review procedure");
  const validated = gateway.validate({
    runId: "neutral-run",
    rawAction,
    expectedStateRevision: 0,
    currentStateRevision: 0,
  });
  assert.equal(validated.action, rawAction);
  assert.equal(playerActionFromRuntimeAction(validated.action), "Keep the current review procedure");
  assert.deepEqual(gateway.resolveBoundOption(
    { id: "option-a", label: "Keep the current review procedure" },
    [{ id: "option-a", label: "Keep the current review procedure" }],
    validated.action,
  ), { id: "option-a", label: "Keep the current review procedure" });
});

test("tampered or stale server maneuver context fails closed", () => {
  const gateway = new DefaultActionGateway();
  const valid = decoratedAction("Proceed cautiously");
  const tampered = valid.replace("registry date", "forged date");
  assert.throws(() => gateway.validate({
    runId: "neutral-run",
    rawAction: tampered,
    expectedStateRevision: 0,
    currentStateRevision: 0,
  }), (error: any) => error?.code === "SERVER_CONTEXT_INVALID" && error?.status === 400);
  assert.throws(() => gateway.validate({
    runId: "neutral-run",
    rawAction: decoratedAction("Proceed cautiously", 0),
    expectedStateRevision: 1,
    currentStateRevision: 1,
  }), (error: any) => error?.code === "SERVER_CONTEXT_STALE" && error?.status === 409);
});

test("ordinary player actions remain unchanged when no server context exists", () => {
  const gateway = new DefaultActionGateway();
  const validated = gateway.validate({
    runId: "neutral-run",
    rawAction: "Proceed cautiously",
    currentStateRevision: 3,
  });
  assert.equal(validated.action, "Proceed cautiously");
  assert.equal(playerActionFromRuntimeAction(validated.action), "Proceed cautiously");
});
