import assert from "node:assert/strict";
import test from "node:test";
import {
  composeAuthoredDecisionModules,
  type FactSettlementModule,
  type NextBeatPlannerModule,
  type PreparedFactSettlement,
} from "../src/decision-adapter.js";
import { SCENE_DRAFT_SCHEMA, type BeatManifest } from "../src/scene-expression.js";
import type { OpenNovelOption } from "../src/types.js";
import type { FileStoryWorkspace } from "../src/workspace.js";
import type { NarrativeTruthContext } from "../src/truth-review.js";

const scene = {
  sceneId: "archive.hall",
  timeLabel: "now",
  locationLabel: "archive hall",
  presentActorIds: ["actor.reader", "actor.witness"],
};

const manifest: BeatManifest = {
  beatId: "archive.beat.capability",
  sourceRef: "archive.source.capability",
  transition: {
    beforeScene: scene,
    narrationScene: scene,
    afterScene: scene,
    transitionRequired: false,
    arrivingActorIds: [],
    departingActorIds: [],
  },
  tickets: [
    {
      ticketId: "archive.ticket.result",
      slot: "PLAYER_RESULT",
      scenePhase: "ACTION_PHASE",
      required: true,
      sourceRefs: ["archive.source.capability"],
      requiredMeaning: "The witness question is asked without changing custody.",
    },
    {
      ticketId: "archive.ticket.stop",
      slot: "DECISION_STOP",
      scenePhase: "AFTER_PHASE",
      required: true,
      sourceRefs: ["archive.source.capability"],
      requiredMeaning: "The custody decision remains open.",
    },
  ],
};

const truthContext: NarrativeTruthContext = {
  originActorId: "actor.reader",
  projectionActorId: "actor.reader",
  activeSceneEntityIds: ["actor.reader", "actor.witness"],
  catalog: [
    { id: "actor.reader", kind: "ACTOR", displayName: "reader" },
    { id: "actor.witness", kind: "ACTOR", displayName: "witness" },
  ],
  capabilityIds: ["decision-point:archive.review"],
  secretIds: [],
  allowedPredicates: [],
  requiredVisiblePredicates: [],
  forbiddenPredicates: [],
  originActionsInDraft: "FORBIDDEN",
  stopCondition: "The custody decision remains open.",
};

function prepared(settlement: PreparedFactSettlement) {
  return {
    selectedOption: settlement.selectedOption,
    settledNarrative: "The witness question is asked without changing custody.",
    sourceRef: "archive.source.capability",
    beatManifest: manifest,
    storyComplete: false,
    fallbackDraft: {
      schemaVersion: SCENE_DRAFT_SCHEMA,
      draftId: "archive.fallback.capability",
      owner: "FALLBACK" as const,
      slots: {
        PLAYER_RESULT: "The witness question is asked without changing custody.",
        DECISION_STOP: "The custody decision remains open.",
      },
      surfaceProvenance: {
        PLAYER_RESULT: {
          surfaceSource: "STORY_PACKAGE" as const,
          sourceRef: "archive.source.capability",
          coveredTicketIds: ["archive.ticket.result"],
        },
        DECISION_STOP: {
          surfaceSource: "STORY_PACKAGE" as const,
          sourceRef: "archive.source.capability",
          coveredTicketIds: ["archive.ticket.stop"],
        },
      },
    },
    truthContexts: {
      actionPhase: truthContext,
      afterPhase: truthContext,
    },
    audit: settlement.audit,
    payload: settlement.payload,
  };
}

test("a neutral capability variant reaches Settlement through an authenticated envelope", async () => {
  const options: OpenNovelOption[] = [
    {
      id: "archive.seal",
      label: "Ask one archive witness to hold the register before review.",
      effect: { decisionPointId: "archive.review" },
    },
    {
      id: "archive.copy",
      label: "Ask two archive witnesses to copy the register before review.",
      effect: { decisionPointId: "archive.review" },
    },
  ];
  const settledInputs: Array<{
    action: string;
    selectedOption: OpenNovelOption | null;
  }> = [];
  const sceneEvents: Array<Record<string, unknown>> = [];

  const settlement: FactSettlementModule = {
    moduleId: "neutral.archive-settlement.v1",
    async currentOptions() {
      throw new Error("displayed options must be authoritative");
    },
    async settle(_workspace, input) {
      settledInputs.push({ action: input.action, selectedOption: input.selectedOption });
      return {
        selectedOption: input.selectedOption,
        storyComplete: false,
        audit: { source: "neutral-fixture" },
        payload: { source: "neutral-fixture" },
      };
    },
    async commit() {},
    async projectCommit() {
      throw new Error("not exercised");
    },
  };
  const nextBeat: NextBeatPlannerModule = {
    moduleId: "neutral.archive-next-beat.v1",
    async plan(value) {
      return prepared(value);
    },
    nextOptions() {
      return [];
    },
  };
  const workspace = {
    async snapshot() {
      return { previousOptions: options };
    },
    async recordSceneEvent(_runId: string, event: Record<string, unknown>) {
      sceneEvents.push(event);
    },
  } as unknown as FileStoryWorkspace;
  const adapter = composeAuthoredDecisionModules({ settlement, nextBeat });
  const action = "Ask the archive witness who may handle the register before review.";

  const result = await adapter.prepare(workspace, {
    runId: "run.neutral-capability",
    turnNumber: 1,
    action,
    selectedOption: null,
  });

  assert.ok(result);
  assert.equal(settledInputs.length, 1);
  assert.notEqual(settledInputs[0]!.action, action);
  assert.match(settledInputs[0]!.action, /OMW_CAPABILITY_V1/u);
  assert.equal(settledInputs[0]!.selectedOption?.id, "opt_capability_t01");
  assert.equal(settledInputs[0]!.selectedOption?.label, action);
  assert.equal(
    settledInputs[0]!.selectedOption?.effect?.decisionPointId,
    "archive.review",
  );
  assert.equal(result.audit.intentResolution.moduleStatus, "BOUND_CAPABILITY");
  assert.equal(result.audit.intentResolution.intentType, "CAPABILITY_VARIANT");
  assert.equal(result.audit.intentResolution.matchedAffordanceId, null);
  assert.equal(result.audit.intentResolution.capabilityRef, "decision-point:archive.review");
  assert.equal(sceneEvents[0]?.status, "BOUND_CAPABILITY");
});
