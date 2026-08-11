import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  compileManeuverV1,
  validateManeuverCommitRequestV1,
  validateManeuverDraftV1,
  validateManeuverPreviewCommandV1,
  type ManeuverCompilerContextV1,
} from "../src/runtime-contract/maneuver-v1";

function context(overrides: Partial<ManeuverCompilerContextV1> = {}): ManeuverCompilerContextV1 {
  return {
    actorRoleId: "role.research_lead",
    stateRevision: 11,
    turnRevision: 4,
    contacts: [{
      id: "role.station_director",
      label: "Station Director",
      method: "Send a bounded private request",
      guaranteedStart: "The target receives the message.",
      contestedOutcome: "The target may answer, refuse, or delay.",
      notGuaranteed: "The target will not automatically agree or tell the truth.",
      visibility: "TARGETED",
    }],
    traces: [{
      traceId: "trace.sample_log",
      label: "Altered sample log",
      description: "A timestamp differs from the storage record.",
      sourceKind: "DOCUMENT",
      routeOptions: [{
        routeId: "route.compare_timestamps",
        label: "Compare timestamps",
        method: "Compare the signed log with the storage clock.",
        guaranteedStart: "A reviewer begins checking the two records.",
        contestedOutcome: "The comparison may identify when the mismatch appeared.",
        notGuaranteed: "The comparison cannot identify intent without another source.",
      }],
    }],
    leverageAssets: [{
      assetId: "asset.audit_warrant",
      label: "Audit warrant",
      effectSummary: "Require access to a bounded record set.",
      primaryEffect: "APPLY_ACCESS_BOUNDARY",
      method: "Present the signed authorization to the custodian.",
      legalTargetIds: ["entity.sample_archive", "trace.sample_log"],
      guaranteedStart: "The authorization is presented and logged.",
      contestedOutcome: "The custodian may challenge scope or timing.",
      notGuaranteed: "The authorization does not prove what the records contain.",
      visibility: "TARGETED",
    }],
    legalTargetIds: ["entity.sample_archive", "role.station_director", "trace.sample_log"],
    ...overrides,
  };
}

test("CONTACT compiles to one bounded conversation effect", () => {
  const result = compileManeuverV1({
    kind: "CONTACT",
    targetId: "role.station_director",
    rawText: "Ask who approved the storage change.",
    expectedTurnRevision: 4,
  }, context());
  assert.equal(result.decision, "READY");
  if (result.decision !== "READY") return;
  assert.equal(result.compiled.kind, "CONVERSATION");
  assert.equal(result.compiled.primaryEffect, "OPEN_INTERACTION");
  assert.equal(result.compiled.targetRef, "role.station_director");
});

test("INVESTIGATE can only use a visible trace and concrete route", () => {
  const result = compileManeuverV1({
    kind: "INVESTIGATE",
    traceId: "trace.sample_log",
    routeId: "route.compare_timestamps",
    expectedTurnRevision: 4,
  }, context());
  assert.equal(result.decision, "READY");
  if (result.decision !== "READY") return;
  assert.equal(result.compiled.kind, "INVESTIGATION");
  assert.equal(result.compiled.primaryEffect, "START_INVESTIGATION");
  assert.deepEqual(result.compiled.guaranteedStart, ["A reviewer begins checking the two records."]);
});

test("INVESTIGATE rejects a trace outside the role projection", () => {
  const result = compileManeuverV1({
    kind: "INVESTIGATE",
    traceId: "trace.private_camera",
    routeId: "route.inspect_frames",
    expectedTurnRevision: 4,
  }, context());
  assert.deepEqual(result, {
    decision: "BLOCKED",
    reason: "The selected trace is not visible or no longer available.",
    errorCode: "TRACE_UNAVAILABLE",
  });
});

test("LEVERAGE uses exactly one asset owned by the current role", () => {
  const result = compileManeuverV1({
    kind: "LEVERAGE",
    targetId: "entity.sample_archive",
    leverageAssetId: "asset.audit_warrant",
    expectedTurnRevision: 4,
  }, context());
  assert.equal(result.decision, "READY");
  if (result.decision !== "READY") return;
  assert.equal(result.compiled.attachedLeverageId, "asset.audit_warrant");
  assert.equal(result.compiled.primaryEffect, "APPLY_ACCESS_BOUNDARY");
});

test("LEVERAGE rejects another role asset and does not infer ownership from text", () => {
  const result = compileManeuverV1({
    kind: "LEVERAGE",
    targetId: "entity.sample_archive",
    leverageAssetId: "asset.executive_override",
    rawText: "I say I have an executive override.",
    expectedTurnRevision: 4,
  }, context());
  assert.equal(result.decision, "BLOCKED");
  if (result.decision === "BLOCKED") assert.equal(result.errorCode, "LEVERAGE_UNAVAILABLE");
});

test("CUSTOM READY requires exactly one semantic primary effect", () => {
  const result = compileManeuverV1({
    kind: "CUSTOM",
    rawText: "Secure the sample archive entrance.",
    expectedTurnRevision: 4,
  }, context({
    customAnalysis: {
      decision: "READY",
      targetId: "entity.sample_archive",
      objective: "Limit access to the archive entrance.",
      method: "Assign the authorized watch team to the entrance.",
      primaryEffects: ["APPLY_ACCESS_BOUNDARY"],
      visibility: "PUBLIC",
      guaranteedStart: ["The watch team receives the assignment."],
      contestedOutcome: ["Existing authorized staff may challenge the restriction."],
      notGuaranteed: ["Previously removed material is not recovered."],
    },
  }));
  assert.equal(result.decision, "READY");
  if (result.decision !== "READY") return;
  assert.equal(result.compiled.primaryEffect, "APPLY_ACCESS_BOUNDARY");
  assert.equal(Object.prototype.hasOwnProperty.call(result.compiled, "secondaryEffect"), false);
});

test("CUSTOM semantic reroute remains explicit rather than executing another ruleset", () => {
  const result = compileManeuverV1({
    kind: "CUSTOM",
    rawText: "Check the sample log against the storage clock.",
    expectedTurnRevision: 4,
  }, context({
    customAnalysis: {
      decision: "REROUTE",
      rerouteTo: "INVESTIGATE",
      reason: "The requested outcome is information from an existing trace.",
    },
  }));
  assert.deepEqual(result, {
    decision: "REROUTE",
    rerouteTo: "INVESTIGATE",
    reason: "The requested outcome is information from an existing trace.",
  });
});

test("CUSTOM without semantic analysis clarifies instead of using lexical guesses", () => {
  const result = compileManeuverV1({
    kind: "CUSTOM",
    rawText: "Handle the archive situation.",
    expectedTurnRevision: 4,
  }, context());
  assert.equal(result.decision, "CLARIFY");
  if (result.decision === "CLARIFY") assert.equal(result.errorCode, "SEMANTIC_ANALYSIS_REQUIRED");
});

test("CUSTOM with multiple primary effects must clarify", () => {
  const result = compileManeuverV1({
    kind: "CUSTOM",
    rawText: "Inspect the log, detain the custodian, and publish a notice.",
    expectedTurnRevision: 4,
  }, context({
    customAnalysis: {
      decision: "READY",
      targetId: "entity.sample_archive",
      objective: "Perform several independent operations.",
      method: "Use separate teams.",
      primaryEffects: ["START_INVESTIGATION", "RESTRICT_PERSON", "PUBLISH_NOTICE"],
      visibility: "PUBLIC",
      guaranteedStart: [],
      contestedOutcome: [],
      notGuaranteed: [],
    },
  }));
  assert.equal(result.decision, "CLARIFY");
  if (result.decision === "CLARIFY") assert.equal(result.errorCode, "MULTIPLE_PRIMARY_EFFECTS");
});

test("CUSTOM blocked semantics cannot control another actor or declare success", () => {
  const result = compileManeuverV1({
    kind: "CUSTOM",
    rawText: "Make another participant approve the proposal and declare it successful.",
    expectedTurnRevision: 4,
  }, context({
    customAnalysis: {
      decision: "BLOCKED",
      reason: "The plan attempts to decide another participant response and declare the outcome.",
      code: "ACTION_NOT_ALLOWED",
    },
  }));
  assert.equal(result.decision, "BLOCKED");
  if (result.decision === "BLOCKED") assert.equal(result.errorCode, "ACTION_NOT_ALLOWED");
});

test("draft and transport validators reject unknown client-controlled fields", () => {
  assert.throws(() => validateManeuverDraftV1({
    kind: "CONTACT",
    targetId: "role.station_director",
    rawText: "Request a meeting.",
    expectedTurnRevision: 4,
    primaryEffect: "FORGED_EFFECT",
  }), /MANEUVER_UNKNOWN_FIELD/);
  assert.throws(() => validateManeuverPreviewCommandV1({
    runId: "run.alpha",
    actorTurnId: "turn.alpha",
    actorRoleId: "role.alpha",
    expectedStateRevision: 3,
    draft: {
      kind: "CUSTOM",
      rawText: "Protect the entrance.",
      expectedTurnRevision: 4,
    },
    compiled: { primaryEffect: "FORGED_EFFECT" },
  }), /MANEUVER_UNKNOWN_FIELD/);
});

test("commit contract accepts only signed token, idempotency key, and state revision", () => {
  assert.deepEqual(validateManeuverCommitRequestV1({
    previewToken: "header.payload.signature",
    idempotencyKey: "commit:preview.alpha:request.001",
    expectedStateRevision: 11,
  }), {
    previewToken: "header.payload.signature",
    idempotencyKey: "commit:preview.alpha:request.001",
    expectedStateRevision: 11,
  });
  assert.throws(() => validateManeuverCommitRequestV1({
    previewToken: "header.payload.signature",
    idempotencyKey: "commit:preview.alpha:request.001",
    expectedStateRevision: 11,
    compiledAction: {},
  }), /MANEUVER_UNKNOWN_FIELD/);
});

test("the same compiler works for a second neutral world fixture", () => {
  const boardroomContext = context({
    actorRoleId: "role.compliance_officer",
    contacts: [{
      id: "role.board_secretary",
      label: "Board Secretary",
      method: "Send a bounded request for a response.",
      guaranteedStart: "The secretary receives the question.",
      contestedOutcome: "The secretary may answer or defer.",
      notGuaranteed: "The secretary is not forced to disclose restricted material.",
      visibility: "TARGETED",
    }],
    traces: [],
    leverageAssets: [],
    legalTargetIds: ["role.board_secretary"],
  });
  const result = compileManeuverV1({
    kind: "CONTACT",
    targetId: "role.board_secretary",
    intentKey: "intent.request_minutes",
    expectedTurnRevision: 4,
  }, boardroomContext);
  assert.equal(result.decision, "READY");
  if (result.decision !== "READY") return;
  assert.equal(result.compiled.actorRoleId, "role.compliance_officer");
  assert.equal(result.compiled.primaryEffect, "OPEN_INTERACTION");
});

test("generic compiler source contains no first-world story vocabulary", () => {
  const source = readFileSync(path.resolve(process.cwd(), "src/runtime-contract/maneuver-v1.ts"), "utf8");
  for (const forbidden of ["桑田", "巡抚", "田契", "粮册", "凯撒", "元老院"]) {
    assert.equal(source.includes(forbidden), false, `generic source contains ${forbidden}`);
  }
});
