import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCausalDelta,
  renderNarratorCausalDelta,
} from "../src/causal-context.js";

test("the Narrator receives source mechanisms without treating them as current facts", () => {
  const delta = buildCausalDelta({
    turnId: "T01",
    action: "暂缓签发，先保全档房。",
    selectedOption: {
      id: "fixture.option",
      label: "暂缓签发，先保全档房。",
      effect: {
        intent: "保全现场",
        beatContract: {
          sourceRef: "fixture.kernel",
          objective: "巡抚争夺复核解释权",
          moves: [],
          requiredAnchorGroups: [],
          narrativeSeed: {
            playerOutcome: "总督暂缓签发。",
            continuationMoves: ["巡抚书吏要求总督把暂缓理由写成正式回复。"],
            sourceEventIds: ["event.pressure"],
            deferredEventIds: [],
            npcOrWorldPressure: "巡抚要求书面回复。",
            stopCondition: "书吏等候总督答复。",
          },
          sceneEvidence: {
            packetId: "fixture.evidence",
            evidenceItems: [
              {
                evidenceId: "source.move.1",
                evidenceClass: "ORIGINAL_MECHANISM",
                statement: "原著中的上级会把政策期限和责任同时压给地方主官。",
                sourceClaimIds: ["claim.1"],
                adaptationDecisionIds: [],
                useAs: "DRAMATIC_MECHANISM",
              },
              {
                evidenceId: "current.fact.1",
                evidenceClass: "DERIVED_CURRENT_FACT",
                statement: "巡抚书吏仍在堂上等候。",
                sourceClaimIds: [],
                adaptationDecisionIds: ["adapt.1"],
                useAs: "OBJECTIVE_FACT",
              },
            ],
            unresolvedFacts: ["县册是否被改动仍未确认。"],
            specificityBoundary: "不得新增受灾人数、粮价涨幅或已经完成的查验。",
          },
          stopCondition: "书吏等候总督答复。",
        },
      },
    },
  });
  assert.deepEqual(delta.scenePacket?.dramaticMechanisms, [
    "原著中的上级会把政策期限和责任同时压给地方主官。",
  ]);
  assert.deepEqual(delta.scenePacket?.visibleFacts, ["巡抚书吏仍在堂上等候。"]);
  const rendered = renderNarratorCausalDelta(delta);
  assert.match(rendered, /原著可借鉴的冲突机制/u);
  assert.match(rendered, /不自动成为当前事实/u);
  assert.match(rendered, /巡抚书吏仍在堂上等候/u);
  assert.match(rendered, /不得新增受灾人数/u);
});

test("the same scene evidence contract works in a second world", () => {
  const delta = buildCausalDelta({
    turnId: "T01",
    action: "Hold the airlock.",
    selectedOption: {
      id: "space.option",
      label: "Hold the airlock.",
      effect: {
        beatContract: {
          objective: "The crew contests operational authority.",
          moves: [],
          requiredAnchorGroups: [],
          narrativeSeed: {
            playerOutcome: "The captain holds the airlock.",
            continuationMoves: ["The engineer asks who will accept the delay."],
            npcOrWorldPressure: "The engineer asks who accepts the delay.",
            stopCondition: "The engineer waits for an answer.",
          },
          sceneEvidence: {
            packetId: "space.evidence",
            evidenceItems: [{
              evidenceId: "space.mechanism",
              evidenceClass: "ORIGINAL_MECHANISM",
              statement: "A subordinate can force command responsibility into the open by requesting a written order.",
              sourceClaimIds: ["space.claim"],
              adaptationDecisionIds: [],
              useAs: "DRAMATIC_MECHANISM",
            }],
            unresolvedFacts: [],
            specificityBoundary: "Do not invent casualties or a second ship.",
          },
          stopCondition: "The engineer waits for an answer.",
        },
      },
    },
  });
  assert.match(renderNarratorCausalDelta(delta), /written order/u);
});
