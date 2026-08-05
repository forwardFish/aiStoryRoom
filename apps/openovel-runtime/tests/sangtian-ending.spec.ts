import assert from "node:assert/strict";
import test from "node:test";
import type { PreparedAuthoredDecision } from "../src/decision-adapter.js";
import { sangtianEndingModule } from "../src/sangtian-ending.js";

test("Sangtian ending turns settled T20 state into protagonist fate and direct aftermath", () => {
  const preparedDecision = {
    payload: {
      settlement: {
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

  const ending = sangtianEndingModule.build({
    runId: "run-ending",
    turnId: "T20",
    turnNumber: 20,
    finalNarration: "驿骑带着首报离开杭州，总督仍站在签押房中。",
    preparedDecision,
  });

  assert.equal(ending.scope, "PART");
  assert.equal(ending.endingKey, "guarded_people_bore_responsibility");
  assert.equal(ending.title, "守土担责");
  assert.match(ending.protagonistFate, /问责/);
  assert.equal(ending.aftermath.length, 4);
  assert.equal(ending.sourceTurnId, "T20");
  assert.equal(ending.sourceRevision, 20);
  assert.match(ending.aftermath.join("\n"), /商会/u);
  assert.match(ending.aftermath.join("\n"), /首报/u);
});

test("Sangtian ending refuses to invent a fate before authoritative completion", () => {
  const preparedDecision = {
    payload: {
      settlement: {
        proposedState: { partCompletionStatus: "IN_PROGRESS" },
      },
    },
  } as PreparedAuthoredDecision;

  assert.throws(() => sangtianEndingModule.build({
    runId: "run-not-finished",
    turnId: "T05",
    turnNumber: 5,
    finalNarration: "故事仍在继续。",
    preparedDecision,
  }), /SANGTIAN_ENDING_STATE_NOT_READY/);
});

test("Sangtian ending refuses a handoff state that is not the authoritative T20", () => {
  const preparedDecision = {
    payload: {
      settlement: {
        proposedState: {
          turnNumber: 19,
          partCompletionStatus: "HANDOFF_READY",
        },
      },
    },
  } as PreparedAuthoredDecision;

  assert.throws(() => sangtianEndingModule.build({
    runId: "run-false-ending",
    turnId: "T19",
    turnNumber: 19,
    finalNarration: "这不是第一部分真正的终局。",
    preparedDecision,
  }), /SANGTIAN_ENDING_FINAL_TURN_MISMATCH/);
});

test("Sangtian ending treats split dispatch as already departed", () => {
  const preparedDecision = {
    payload: {
      settlement: {
        proposedState: {
          turnNumber: 20,
          partCompletionStatus: "HANDOFF_READY",
          land: { safeguardStatus: "ACTIVE" },
          grain: { immediatePressure: "RELIEVED_FOR_HUNGRIEST" },
          merchant: { entryStatus: "CONDITIONAL", grantedRights: ["GRAIN_AND_TRANSPORT_ONLY"] },
          evidence: { chainStatus: "TRACEABLE" },
          report: {
            attachmentStrength: "WITNESSED_COPY_AND_CUSTODY_RECORD",
            dispatchStatus: "SPLIT",
          },
          responsibility: { governorExposure: 8 },
        },
      },
    },
  } as PreparedAuthoredDecision;

  const ending = sangtianEndingModule.build({
    runId: "run-split-dispatch",
    turnId: "T20",
    turnNumber: 20,
    finalNarration: "正本与摘要已经分路离开浙江。",
    preparedDecision,
  });

  assert.match(ending.protagonistFate, /首份奏报已经离开浙江/u);
  assert.doesNotMatch(ending.protagonistFate, /仍未离开浙江/u);
});

test("Sangtian ending exposes a materially different fate when people are not protected", () => {
  const preparedDecision = {
    payload: {
      settlement: {
        proposedState: {
          turnNumber: 20,
          partCompletionStatus: "HANDOFF_READY",
          land: { safeguardStatus: "NONE" },
          grain: { immediatePressure: "UNRELIEVED" },
          merchant: { entryStatus: "OPEN", grantedRights: ["LAND_PURCHASE"] },
          evidence: { chainStatus: "BROKEN" },
          report: {
            attachmentStrength: "NONE",
            dispatchStatus: "NOT_DISPATCHED",
          },
          responsibility: { governorExposure: 2 },
        },
      },
    },
  } as PreparedAuthoredDecision;

  const ending = sangtianEndingModule.build({
    runId: "run-lost-people",
    turnId: "T20",
    turnNumber: 20,
    finalNarration: "粮价压到田契上，首报仍留在浙江。",
    preparedDecision,
  });

  assert.equal(ending.endingKey, "executed_policy_lost_people");
  assert.equal(ending.title, "奉旨失民");
  assert.match(ending.protagonistFate, /没能保住百姓/u);
  assert.match(ending.aftermath.join("\n"), /失田风险/u);
  assert.match(ending.aftermath.join("\n"), /仍未解除/u);
  assert.match(ending.aftermath.join("\n"), /尚未离开浙江/u);
});

test("Sangtian ending classification covers every documented Part One outcome", () => {
  const scenarios = [
    {
      expectedKey: "guarded_people_bore_responsibility",
      expectedTitle: "守土担责",
      land: "ACTIVE",
      grain: "RELIEVED_FOR_HUNGRIEST",
      evidence: "TRACEABLE",
      attachment: "WITNESSED_COPY_AND_CUSTODY_RECORD",
      dispatch: "DISPATCHED",
      exposure: 8,
    },
    {
      expectedKey: "guarded_people_preserved_evidence",
      expectedTitle: "持证守土",
      land: "ACTIVE",
      grain: "RELIEVED_FOR_HUNGRIEST",
      evidence: "TRACEABLE",
      attachment: "WITNESSED_COPY_AND_CUSTODY_RECORD",
      dispatch: "NOT_DISPATCHED",
      exposure: 3,
    },
    {
      expectedKey: "evidence_entered_capital",
      expectedTitle: "孤证入京",
      land: "NONE",
      grain: "UNRELIEVED",
      evidence: "TRACEABLE",
      attachment: "WITNESSED_COPY_AND_CUSTODY_RECORD",
      dispatch: "DISPATCHED",
      exposure: 3,
    },
    {
      expectedKey: "executed_policy_lost_people",
      expectedTitle: "奉旨失民",
      land: "NONE",
      grain: "UNRELIEVED",
      evidence: "BROKEN",
      attachment: "NONE",
      dispatch: "NOT_DISPATCHED",
      exposure: 3,
    },
    {
      expectedKey: "crisis_unresolved",
      expectedTitle: "危局未决",
      land: "ACTIVE",
      grain: "RELIEVED_FOR_HUNGRIEST",
      evidence: "BROKEN",
      attachment: "NONE",
      dispatch: "NOT_DISPATCHED",
      exposure: 3,
    },
  ] as const;

  for (const scenario of scenarios) {
    const preparedDecision = {
      payload: {
        settlement: {
          proposedState: {
            turnNumber: 20,
            partCompletionStatus: "HANDOFF_READY",
            land: { safeguardStatus: scenario.land },
            grain: { immediatePressure: scenario.grain },
            merchant: { entryStatus: "CONDITIONAL", grantedRights: [] },
            evidence: { chainStatus: scenario.evidence },
            report: {
              attachmentStrength: scenario.attachment,
              dispatchStatus: scenario.dispatch,
            },
            responsibility: { governorExposure: scenario.exposure },
          },
        },
      },
    } as PreparedAuthoredDecision;

    const ending = sangtianEndingModule.build({
      runId: `run-${scenario.expectedKey}`,
      turnId: "T20",
      turnNumber: 20,
      finalNarration: "第一部分的最后一道命令已经发出。",
      preparedDecision,
    });

    assert.equal(ending.endingKey, scenario.expectedKey);
    assert.equal(ending.title, scenario.expectedTitle);
    assert.equal(ending.sourceRevision, 20);
  }
});
