import assert from "node:assert/strict";
import test from "node:test";
import type { PreparedAuthoredDecision } from "../src/decision-adapter.js";
import { sangtianEndingModule } from "../src/sangtian-ending.js";

test("Sangtian ending turns settled T20 state into protagonist fate and direct aftermath", () => {
  const preparedDecision = {
    payload: {
      settlement: {
        proposedState: {
          partCompletionStatus: "HANDOFF_READY",
          land: { safeguardStatus: "ACTIVE" },
          grain: { immediatePressure: "RELIEVED_FOR_HUNGRIEST" },
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
  assert.equal(ending.aftermath.length, 2);
  assert.equal(ending.sourceTurnId, "T20");
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
