import assert from "node:assert/strict";
import test from "node:test";
import { validateTechnicalEvidence } from "./solo-endgame-stage-c.mjs";

function evidence(overrides = {}) {
  return {
    schemaVersion: "solo_endgame_mvp_evidence_v1",
    testOnly: true,
    database: { host: "project.supabase.co", migrationExecuted: false },
    services: { restartedRuntime: true, restartedApi: true },
    routes: [route("protective", "ending-a", "a"), route("grain-first", "ending-b", "b")],
    deterministic: {
      initialPresentationHash: "hash-a",
      afterRuntimeRestartHash: "hash-a",
      afterApiRestartHash: "hash-a",
    },
    permissions: { outsiderResultRejected: true },
    historical: { resultType: "LEGACY_ENDING", proseGuessed: false },
    replay: {
      oldRunPreserved: true,
      oldRunId: `solo_ovl_${"a".repeat(32)}`,
      newRunId: `solo_ovl_${"c".repeat(32)}`,
      changeRoleEnabled: false,
      nextPartEnabled: false,
    },
    browser: {
      layout: { left: true, center: true, right: true },
      causeCount: 2,
      runtimeExceptions: [],
    },
    ...overrides,
  };
}

function route(profile, endingKey, token) {
  return {
    profile,
    runId: `solo_ovl_${token.repeat(32)}`,
    endingKey,
    scope: "PART",
    sourceTurnId: "T20",
    sourceRevision: 20,
    actionCount: 20,
    sceneCount: 20,
    route: Array.from({ length: 20 }, (_, index) => ({ turnNumber: index + 1 })),
    causeCount: 1,
  };
}

test("valid Supabase, two-route, restart, permission and real-game evidence passes", () => {
  const result = validateTechnicalEvidence(evidence());
  assert.equal(result.status, "STAGE_C_TECHNICAL_PASSED");
  assert.equal(result.distinctEndingCount, 2);
  assert.equal(result.humanAcceptanceStatus, "REQUIRED_SEPARATELY");
});

test("two routes with the same ending fail the Stage C gate", () => {
  const value = evidence();
  value.routes[1].endingKey = value.routes[0].endingKey;
  assert.throws(() => validateTechnicalEvidence(value), /different authoritative endings/);
});

test("an incomplete route cannot be reported as T01-T20", () => {
  const value = evidence();
  value.routes[0].actionCount = 19;
  assert.throws(() => validateTechnicalEvidence(value), /twenty actions/);
});

test("migration, missing outsider denial or browser runtime exception fails closed", () => {
  for (const mutate of [
    (value) => { value.database.migrationExecuted = true; },
    (value) => { value.permissions.outsiderResultRejected = false; },
    (value) => { value.browser.runtimeExceptions = ["ReferenceError"]; },
  ]) {
    const value = evidence();
    mutate(value);
    assert.throws(() => validateTechnicalEvidence(value));
  }
});
