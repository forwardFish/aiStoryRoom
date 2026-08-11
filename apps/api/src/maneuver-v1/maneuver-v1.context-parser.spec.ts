import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { parseManeuverContextV1 } from "./maneuver-v1.context-parser";

function contextJson() {
  return {
    maneuverV1: {
      compilerContext: {
        contacts: [{
          id: "role.records_officer",
          label: "Records Officer",
          method: "Send a bounded request.",
          guaranteedStart: "The request is delivered.",
          contestedOutcome: "The officer may answer or decline.",
          notGuaranteed: "The officer is not forced to disclose restricted material.",
          visibility: "TARGETED",
        }],
        traces: [{
          traceId: "trace.storage_log",
          label: "Storage log mismatch",
          description: "Two timestamps disagree.",
          sourceKind: "DOCUMENT",
          routeOptions: [
            {
              routeId: "route.bound",
              label: "Compare signed copies",
              method: "Compare the signed copies.",
              guaranteedStart: "The comparison begins.",
              contestedOutcome: "The time window may be narrowed.",
              notGuaranteed: "Intent cannot be inferred from this route alone.",
            },
            {
              routeId: "route.unbound",
              label: "Ask an unbound source",
              method: "Ask a source with no fact binding.",
              guaranteedStart: "A request begins.",
              contestedOutcome: "A reply may arrive.",
              notGuaranteed: "The reply is not authoritative.",
            },
          ],
        }],
        legalTargetIds: ["entity.archive"],
      },
      investigationOutcomes: [{
        routeId: "route.bound",
        factKey: "fact.storage_log_changed",
        title: "Signed copy comparison",
        summary: "The timestamps differ.",
        supports: "A change happened after the first signature.",
        cannotProve: "Who intended the change.",
        sourceKind: "RECORD",
        provenanceKey: "source.storage_log.primary",
      }],
    },
  };
}

test("only routes with an authoritative outcome binding are projected", () => {
  const parsed = parseManeuverContextV1(contextJson(), [], {
    roleId: "role.reviewer",
    stateRevision: 2,
    turnRevision: 3,
  });
  assert.equal(parsed.compilerContext.traces.length, 1);
  assert.deepEqual(parsed.compilerContext.traces[0].routeOptions.map((route) => route.routeId), ["route.bound"]);
  assert.equal(parsed.investigationOutcomes[0].factKey, "fact.storage_log_changed");
});

test("leverage projection only uses assets supplied for the current role", () => {
  const parsed = parseManeuverContextV1(contextJson(), [{
    id: "asset.current_role",
    assetKey: "asset.authorization",
    stateJson: {
      maneuverV1: {
        label: "Authorization",
        effectSummary: "Changes the access boundary.",
        primaryEffect: "APPLY_ACCESS_BOUNDARY",
        method: "Present the signed authorization.",
        legalTargetIds: ["entity.archive"],
        guaranteedStart: "The authorization is presented.",
        contestedOutcome: "The custodian may challenge its scope.",
        notGuaranteed: "The authorization does not prove the records' contents.",
        visibility: "TARGETED",
      },
    },
  }], {
    roleId: "role.reviewer",
    stateRevision: 2,
    turnRevision: 3,
  });
  assert.deepEqual(parsed.compilerContext.leverageAssets.map((asset) => asset.assetId), ["asset.current_role"]);
});

test("generic context parser contains no first-world vocabulary", () => {
  const source = readFileSync(path.resolve(process.cwd(), "src/maneuver-v1/maneuver-v1.context-parser.ts"), "utf8");
  for (const forbidden of ["巡抚", "田契", "粮册", "桑田", "凯撒", "元老院"]) {
    assert.equal(source.includes(forbidden), false, `generic source contains ${forbidden}`);
  }
});
