import assert from "node:assert/strict";
import test from "node:test";
import type { PartOneCommittedEvent } from "@ai-story/templates";
import type { PreparedAuthoredDecision } from "../src/decision-adapter.js";
import { SangtianEndingModule } from "../src/sangtian-ending.js";

function event(
  turnNumber: number,
  changedStatePaths: string[],
  statePatch: Record<string, unknown>,
  overrides: Record<string, unknown> = {},
): PartOneCommittedEvent {
  return {
    schemaVersion: "sangtian-part-one-event-v1",
    eventId: `event-T${String(turnNumber).padStart(2, "0")}`,
    turnNumber,
    sectionIdBefore: "section-before",
    sectionIdAfter: "section-after",
    actionSource: "RECOMMENDED",
    decisionKernelId: `kernel-${turnNumber}`,
    affordanceTemplateId: `affordance-${turnNumber}`,
    actionText: `第 ${turnNumber} 回合的已提交行动`,
    targetRef: "public_frame",
    statePatch,
    durableEffects: [],
    changedStatePaths,
    createdPendingConsequenceIds: [],
    duePendingConsequenceIds: [],
    authoritativeObservableFacts: [],
    authoritativeNpcReactions: [],
    sceneBefore: {} as any,
    sceneAfter: {} as any,
    authoritativeWorldMoves: [],
    nextDecisionPoint: {} as any,
    narrativePlan: {} as any,
    sectionTransitioned: false,
    ...overrides,
  } as PartOneCommittedEvent;
}

function prepared(currentEvent: PartOneCommittedEvent): PreparedAuthoredDecision {
  return {
    payload: {
      settlement: {
        event: currentEvent,
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

function endingWith(
  history: readonly PartOneCommittedEvent[],
  decision: PreparedAuthoredDecision,
) {
  return new SangtianEndingModule(() => history).build({
    runId: "run-ending-evidence",
    turnId: "T20",
    turnNumber: 20,
    finalNarration: "这段文学正文不是证据来源。",
    preparedDecision: decision,
  }) as any;
}

test("T20 Ending atomically carries one merged cause for one committed action", () => {
  const ending = endingWith([], prepared(event(
    20,
    ["report.dispatchStatus", "responsibility.governorExposure"],
    {
      report: { dispatchStatus: "DISPATCHED" },
      responsibility: { governorExposure: 10 },
    },
  )));

  assert.equal(ending.endingKey, "guarded_people_bore_responsibility");
  assert.equal(ending.playerEvidence.schemaVersion, "openovel_player_ending_evidence_v1");
  assert.equal(ending.playerEvidence.endingKey, ending.endingKey);
  assert.equal(ending.playerEvidence.scope, "PART");
  assert.equal(ending.playerEvidence.sourceTurnId, "T20");
  assert.equal(ending.playerEvidence.sourceRevision, 20);
  assert.equal(ending.playerEvidence.causes.length, 1);
  assert.equal(ending.playerEvidence.causes[0].sourceTurnId, "T20");
  assert.equal(ending.playerEvidence.causes[0].direction, "DECISIVE");
  assert.match(ending.playerEvidence.causes[0].factText, /问责范围/);
  assert.match(ending.playerEvidence.causes[0].factText, /离开浙江/);
  assert.equal(ending.playerEvidence.reveal, null);
  assert.equal(ending.genericEndgame.schemaVersion, "generic_endgame_result_artifact_v1");
  assert.equal(ending.genericEndgame.sourceRevision, 20);
  assert.equal(ending.genericEndgame.presentation.schemaVersion, "endgame_presentation_v3");
  assert.equal(ending.genericEndgame.presentation.resultType, "SOLO_PART_END");
  assert.equal(ending.genericEndgame.presentation.world.worldId, "sangtian");
  assert.equal(ending.genericEndgame.presentation.role.roleId, "zhejiang_governor");
  assert.equal(ending.genericEndgame.presentation.narrative, ending.finalSceneNarrative);
  assert.match(ending.genericEndgame.presentation.dynamicSubtitle, /民田|证据|问责/u);
  assert.match(ending.genericEndgame.presentation.endingFingerprint, /^[0-9a-f]{64}$/u);
  assert.doesNotMatch(JSON.stringify(ending.playerEvidence), /文学正文|Prompt|note/);
});

test("T20 unrelated changes do not replace earlier determinant provenance", () => {
  const history = [
    event(4, ["land.safeguardStatus"], {
      land: { safeguardStatus: "ACTIVE" },
    }),
    event(11, ["evidence.chainStatus"], {
      evidence: { chainStatus: "TRACEABLE" },
    }),
    event(17, ["report.dispatchStatus"], {
      report: { dispatchStatus: "DISPATCHED" },
    }),
  ];
  const ending = endingWith(history, prepared(event(
    20,
    ["partCompletionStatus", "scene.locationLabel"],
    {
      partCompletionStatus: "HANDOFF_READY",
      scene: { locationLabel: "签押房" },
    },
  )));

  assert.deepEqual(
    ending.playerEvidence.causes.map((cause: any) => cause.sourceRevision),
    [4, 11, 17],
  );
  assert.deepEqual(
    ending.playerEvidence.causes.map((cause: any) => cause.sourceEventId),
    ["event-T04", "event-T11", "event-T17"],
  );
  assert.match(ending.playerEvidence.causes[0].factText, /民田保护/);
  assert.match(ending.playerEvidence.causes[1].factText, /证据链/);
  assert.match(ending.playerEvidence.causes[2].factText, /奏报/);
});

test("a later event that writes a different value cannot steal final determinant provenance", () => {
  const history = [
    event(4, ["land.safeguardStatus"], {
      land: { safeguardStatus: "ACTIVE" },
    }),
    event(18, ["land.safeguardStatus"], {
      land: { safeguardStatus: "NONE" },
    }),
  ];
  const ending = endingWith(history, prepared(event(
    20,
    ["partCompletionStatus"],
    { partCompletionStatus: "HANDOFF_READY" },
  )));

  assert.equal(ending.playerEvidence.causes[0]?.sourceRevision, 4);
  assert.match(ending.playerEvidence.causes[0]?.factText || "", /民田保护/);
});

test("negative historical predicates produce HURT or DECISIVE rather than universal DECISIVE", () => {
  const decision = prepared(event(
    20,
    ["partCompletionStatus"],
    { partCompletionStatus: "HANDOFF_READY" },
  ));
  const state = (decision.payload as any).settlement.proposedState;
  state.land.safeguardStatus = "NONE";
  state.grain.immediatePressure = "UNRELIEVED";
  state.evidence.chainStatus = "BROKEN";
  state.report.attachmentStrength = "NONE";
  state.report.dispatchStatus = "NOT_DISPATCHED";
  state.responsibility.governorExposure = 2;

  const ending = endingWith([
    event(4, ["land.safeguardStatus"], {
      land: { safeguardStatus: "NONE" },
    }),
    event(11, ["grain.immediatePressure"], {
      grain: { immediatePressure: "UNRELIEVED" },
    }),
    event(17, ["evidence.chainStatus"], {
      evidence: { chainStatus: "BROKEN" },
    }),
  ], decision);

  assert.equal(ending.endingKey, "executed_policy_lost_people");
  assert.equal(ending.genericEndgame.presentation.style.styleId, "restrained_sorrow");
  assert.match(ending.genericEndgame.presentation.dynamicSubtitle, /危局|未竟|代价/u);
  assert.deepEqual(
    ending.playerEvidence.causes.map((cause: any) => cause.direction),
    ["DECISIVE", "DECISIVE", "HURT"],
  );
});

test("temporary narration and explicitly uncommitted event shapes never become causes", () => {
  const uncommitted = event(
    4,
    ["land.safeguardStatus"],
    { land: { safeguardStatus: "ACTIVE" } },
    {
      committed: false,
      narration: "这段临时正文声称民田已经保住。",
    },
  );
  const narrationOnly = {
    schemaVersion: "draft-narrative-v1",
    eventId: "draft-T11",
    turnNumber: 11,
    narration: "县册证据链已经保持为可追索状态。",
  } as unknown as PartOneCommittedEvent;
  const ending = endingWith([uncommitted, narrationOnly], prepared(event(
    20,
    ["partCompletionStatus"],
    { partCompletionStatus: "HANDOFF_READY" },
  )));

  assert.deepEqual(ending.playerEvidence.causes, []);
  assert.equal(ending.playerEvidence.reveal, null);
});
