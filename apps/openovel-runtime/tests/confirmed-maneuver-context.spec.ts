import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import { DefaultActionGateway } from "../src/action-gateway.js";
import {
  takeConfirmedManeuverRuntimeContext,
} from "../src/confirmed-maneuver-context.js";
import {
  mergeConfirmedManeuverContext,
} from "../src/context-compiler-module.js";
import type { CompiledForegroundContext } from "../src/types.js";

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
    consumedLeverageKeys: ["access_pass"],
  };
  const payload = JSON.stringify(context);
  const signature = createHmac("sha256", SECRET).update(payload).digest("base64url");
  return `${playerAction}\n\n<${TAG} signature="${signature}">\n${payload}\n</${TAG}>`;
}

function compiled(): CompiledForegroundContext {
  return {
    foregroundGuidance: "foreground",
    durableMemory: "existing durable memory",
    storyMemory: "story memory",
    recentCanonExcerpt: "recent canon",
    report: {
      usedChars: 55,
      budgets: { durableMemory: 8_000 },
      truncated: [],
      removedPlayerDirectiveClauses: 0,
      deduplicatedContextCardSections: 0,
    },
  };
}

test("gateway strips signed server context from player action and stages it for one compiler pass", () => {
  const gateway = new DefaultActionGateway();
  const rawAction = decoratedAction("Keep the current review procedure");
  const validated = gateway.validate({
    runId: "neutral-run",
    rawAction,
    expectedStateRevision: 0,
    currentStateRevision: 0,
  });
  assert.equal(validated.action, "Keep the current review procedure");
  assert.deepEqual(gateway.resolveBoundOption(
    { id: "option-a", label: "Keep the current review procedure" },
    [{ id: "option-a", label: "Keep the current review procedure" }],
    validated.action,
  ), { id: "option-a", label: "Keep the current review procedure" });
  const staged = takeConfirmedManeuverRuntimeContext("neutral-run", 0);
  assert.ok(staged);
  assert.deepEqual(staged.sourceResultIds, ["maneuver-result-1"]);
  assert.equal(takeConfirmedManeuverRuntimeContext("neutral-run", 0), null);
});

test("confirmed context uses a bounded durable-memory slot and never exposes the transport envelope", () => {
  const gateway = new DefaultActionGateway();
  gateway.validate({
    runId: "neutral-run-merge",
    rawAction: decoratedAction("Proceed cautiously"),
    currentStateRevision: 0,
  });
  const merged = mergeConfirmedManeuverContext(
    compiled(),
    takeConfirmedManeuverRuntimeContext("neutral-run-merge", 0),
  );
  assert.match(merged.durableMemory, /已确认的主动谋划上下文/);
  assert.match(merged.durableMemory, /registry date precedes/);
  assert.match(merged.durableMemory, /access_pass/);
  assert.equal(merged.durableMemory.includes(TAG), false);
  assert.ok(merged.durableMemory.length <= merged.report.budgets.durableMemory);
});

test("tampered, stale, and revision-conflicting contexts fail without leaving staged state", () => {
  const gateway = new DefaultActionGateway();
  const valid = decoratedAction("Proceed cautiously");
  const tampered = valid.replace("registry date", "forged date");
  assert.throws(() => gateway.validate({
    runId: "neutral-run-tampered",
    rawAction: tampered,
    expectedStateRevision: 0,
    currentStateRevision: 0,
  }), (error: any) => error?.code === "SERVER_CONTEXT_INVALID" && error?.status === 400);
  assert.equal(takeConfirmedManeuverRuntimeContext("neutral-run-tampered", 0), null);

  assert.throws(() => gateway.validate({
    runId: "neutral-run-stale",
    rawAction: decoratedAction("Proceed cautiously", 0),
    expectedStateRevision: 1,
    currentStateRevision: 1,
  }), (error: any) => error?.code === "SERVER_CONTEXT_STALE" && error?.status === 409);
  assert.equal(takeConfirmedManeuverRuntimeContext("neutral-run-stale", 1), null);

  assert.throws(() => gateway.validate({
    runId: "neutral-run-revision",
    rawAction: decoratedAction("Proceed cautiously", 2),
    expectedStateRevision: 1,
    currentStateRevision: 2,
  }), (error: any) => error?.code === "STATE_REVISION_CONFLICT" && error?.status === 409);
  assert.equal(takeConfirmedManeuverRuntimeContext("neutral-run-revision", 2), null);
});

test("ordinary player actions clear any residual context for the same run and revision", () => {
  const gateway = new DefaultActionGateway();
  gateway.validate({
    runId: "neutral-run-plain",
    rawAction: decoratedAction("First action"),
    currentStateRevision: 3,
  });
  gateway.validate({
    runId: "neutral-run-plain",
    rawAction: "Second action",
    currentStateRevision: 3,
  });
  assert.equal(takeConfirmedManeuverRuntimeContext("neutral-run-plain", 3), null);
});
