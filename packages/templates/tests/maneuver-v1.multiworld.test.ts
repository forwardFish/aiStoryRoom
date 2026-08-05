import assert from "node:assert/strict";
import test from "node:test";
import {
  InvestigationRouteV1,
  WorldTraceV1,
  resolveInvestigationV1,
} from "../src/maneuver-v1";

function runWorld(input: {
  runId: string;
  roleId: string;
  traceTitle: string;
  claimKey: string;
  statement: string;
}) {
  const trace: WorldTraceV1 = {
    traceId: `${input.runId}:trace`,
    runId: input.runId,
    title: input.traceTitle,
    narrativeHook: "A physical or documentary change remains observable.",
    traceType: "RECORD",
    subjectEntityIds: [`${input.runId}:entity`],
    sourceEventIds: [`${input.runId}:event`],
    supportedClaimKeys: [input.claimKey],
    sourceGroupKey: `${input.runId}:source`,
    accessRoleIds: [input.roleId],
    routeIds: [`${input.runId}:route`],
    visibility: { scope: "LIMITED", roleIds: [input.roleId] },
    status: "ACTIVE",
    createdAtRevision: 1,
  };
  const route: InvestigationRouteV1 = {
    routeId: `${input.runId}:route`,
    traceId: trace.traceId,
    label: "Inspect the record",
    narrativeMethod: "Compare the durable record with the observable scene",
    requiredCapabilityIds: ["inspect"],
    requiredResourceCosts: [],
    optionalCardTags: [],
    revealRules: [{ claimKey: input.claimKey, statement: input.statement, strength: 2, when: "ALWAYS" }],
    evidenceCeiling: "CORROBORATION",
    mayLearn: [input.statement],
    cannotProve: ["Private intention"],
    settlementMoment: { kind: "BEFORE_MAIN_LOCK" },
    observableTrail: null,
    counterTags: [],
    expiresWithTrace: true,
  };
  return resolveInvestigationV1({
    trace,
    route,
    actorRoleId: input.roleId,
    actorCapabilityIds: ["inspect"],
    availableResources: {},
    evidenceId: `${input.runId}:evidence`,
    evidenceTitle: input.traceTitle,
    acquiredAtRevision: 2,
  });
}

test("the same investigation engine works for unrelated worlds", () => {
  const lab = runWorld({
    runId: "research-station",
    roleId: "sample-auditor",
    traceTitle: "Missing sample checkout record",
    claimKey: "claim.sample_left_cold_room",
    statement: "A sample container left the cold room after midnight.",
  });
  const board = runWorld({
    runId: "boardroom",
    roleId: "compliance-officer",
    traceTitle: "Deleted document access log",
    claimKey: "claim.board_packet_downloaded",
    statement: "The board packet was downloaded before the meeting.",
  });

  assert.equal(lab.evidence?.level, "CORROBORATION");
  assert.equal(board.evidence?.level, "CORROBORATION");
  assert.notEqual(lab.evidence?.source.sourceGroupKey, board.evidence?.source.sourceGroupKey);
  assert.deepEqual(lab.evidence?.cannotProve, ["Private intention"]);
  assert.deepEqual(board.evidence?.cannotProve, ["Private intention"]);
});
