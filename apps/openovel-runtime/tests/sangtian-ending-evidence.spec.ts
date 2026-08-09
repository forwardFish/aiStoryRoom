import assert from "node:assert/strict";
import test from "node:test";
import type { PreparedAuthoredDecision } from "../src/decision-adapter.js";
import { sangtianEndingModule } from "../src/sangtian-ending.js";

function prepared(changedStatePaths: string[]): PreparedAuthoredDecision {
  return {
    payload: {
      settlement: {
        event: {
          eventId: "event-T20",
          changedStatePaths,
        },
        proposedState: {
          turnNumber: 20,
          partCompletionStatus: "HANDOFF_READY",
          land: { safeguardStatus: "ACTIVE" },
          grain: { immediatePressure: "RELIEVED_FOR_HUNGRIEST" },
          merchant: { entryStatus: "CONDITIONAL", grantedRights: ["GRAIN_AND_TRANSPORT_ONLY"] },
          evidence: { chainStatus: "TRACEABLE" },
          report: {
            attachmentStrength: "WITNESSED_COPY_AND_CUSTODY_RECORD",
            dispatchStatus: "DISPATCHED",
          },
          responsibility: { governorExposure: 10 },
        },
      },
    },
  } as PreparedAuthoredDecision;
}

test("T20 Ending atomically carries player-safe structured evidence", () => {
  const ending = sangtianEndingModule.build({
    runId: "run-ending-evidence",
    turnId: "T20",
    turnNumber: 20,
    finalNarration: "这段文学正文不是证据来源。",
    preparedDecision: prepared([
      "report.dispatchStatus",
      "responsibility.governorExposure",
    ]),
  }) as any;

  assert.equal(ending.endingKey, "guarded_people_bore_responsibility");
  assert.equal(ending.playerEvidence.schemaVersion, "openovel_player_ending_evidence_v1");
  assert.equal(ending.playerEvidence.endingKey, ending.endingKey);
  assert.equal(ending.playerEvidence.scope, "PART");
  assert.equal(ending.playerEvidence.sourceTurnId, "T20");
  assert.equal(ending.playerEvidence.sourceRevision, 20);
  assert.deepEqual(
    ending.playerEvidence.causes.map((cause: any) => cause.direction),
    ["DECISIVE", "HELPED"],
  );
  assert.deepEqual(
    ending.playerEvidence.causes.map((cause: any) => cause.factText),
    [
      "总督本人已经进入明确问责范围。",
      "首份奏报已经离开浙江。",
    ],
  );
  assert.equal(ending.playerEvidence.reveal, null);
  assert.doesNotMatch(JSON.stringify(ending.playerEvidence), /文学正文|Prompt|note/);
});

test("Ending evidence excludes unrelated state changes instead of inventing causes", () => {
  const ending = sangtianEndingModule.build({
    runId: "run-ending-no-cause",
    turnId: "T20",
    turnNumber: 20,
    finalNarration: "不得从这里猜测原因。",
    preparedDecision: prepared(["partCompletionStatus", "scene.locationLabel"]),
  }) as any;

  assert.deepEqual(ending.playerEvidence.causes, []);
  assert.equal(ending.playerEvidence.reveal, null);
});

test("negative final predicates produce HURT or DECISIVE rather than universal DECISIVE", () => {
  const decision = prepared(["land.safeguardStatus", "grain.immediatePressure", "evidence.chainStatus"]);
  const state = (decision.payload as any).settlement.proposedState;
  state.land.safeguardStatus = "NONE";
  state.grain.immediatePressure = "UNRELIEVED";
  state.evidence.chainStatus = "BROKEN";
  state.report.attachmentStrength = "NONE";
  state.report.dispatchStatus = "NOT_DISPATCHED";
  state.responsibility.governorExposure = 2;

  const ending = sangtianEndingModule.build({
    runId: "run-ending-negative",
    turnId: "T20",
    turnNumber: 20,
    finalNarration: "结局正文。",
    preparedDecision: decision,
  }) as any;

  assert.equal(ending.endingKey, "executed_policy_lost_people");
  assert.deepEqual(
    ending.playerEvidence.causes.map((cause: any) => cause.direction),
    ["DECISIVE", "DECISIVE", "HURT"],
  );
});
