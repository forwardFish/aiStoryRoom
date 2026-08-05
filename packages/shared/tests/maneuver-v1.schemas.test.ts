import assert from "node:assert/strict";
import test from "node:test";
import { validateManeuverProjectionV1 } from "../src/continuous-strategy/maneuver-v1.schemas";

function projection() {
  return {
    schemaVersion: "maneuver_projection_v1",
    maxPerTurn: 2,
    remaining: 2,
    windowState: "OPEN",
    stateRevision: 1,
    turnRevision: 1,
    contacts: [{ id: "role.target", label: "Target" }],
    traces: [{
      traceId: "trace.record",
      label: "Record mismatch",
      description: "Two records disagree.",
      sourceKind: "DOCUMENT",
      routeOptions: [{ routeId: "route.compare", label: "Compare", method: "Compare the records." }],
    }],
    leverageAssets: [{ id: "asset.authorization", label: "Authorization", effectSummary: "Changes access boundaries." }],
    inProgress: [],
    privateEvidence: [],
  } as const;
}

test("maneuver projection accepts the bounded player-safe shape", () => {
  const result = validateManeuverProjectionV1(projection());
  assert.equal(result.ok, true);
});

test("projection validator rejects nested internal fields", () => {
  const value: any = projection();
  value.traces[0].internalFactKey = "fact.hidden";
  value.contacts[0].acl = "role.secret";
  const result = validateManeuverProjectionV1(value);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.match(result.errors.join("\n"), /internalFactKey/);
    assert.match(result.errors.join("\n"), /acl/);
  }
});

test("private evidence collection rejects public or internally extended cards", () => {
  const value: any = projection();
  value.privateEvidence = [{
    evidenceId: "evidence.1",
    title: "Record comparison",
    summary: "The timestamps differ.",
    supports: "A record changed.",
    cannotProve: "Who intended the change.",
    sourceKind: "RECORD",
    provenanceKey: "source.record.primary",
    obtainedFromActionId: "action.1",
    visibility: "PUBLIC",
    internalFactKey: "fact.hidden",
  }];
  const result = validateManeuverProjectionV1(value);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.match(result.errors.join("\n"), /internalFactKey/);
    assert.match(result.errors.join("\n"), /must remain PRIVATE/);
  }
});
