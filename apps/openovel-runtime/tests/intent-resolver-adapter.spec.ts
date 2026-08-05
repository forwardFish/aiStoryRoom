import assert from "node:assert/strict";
import test from "node:test";
import {
  composeAuthoredDecisionModules,
  type FactSettlementModule,
  type NextBeatPlannerModule,
  type PreparedFactSettlement,
} from "../src/decision-adapter.js";
import { RuntimeActionError } from "../src/runtime-errors.js";
import { SCENE_DRAFT_SCHEMA, type BeatManifest } from "../src/scene-expression.js";
import type { OpenNovelOption } from "../src/types.js";
import type { FileStoryWorkspace } from "../src/workspace.js";
import type { NarrativeTruthContext } from "../src/truth-review.js";

const scene = {
  sceneId: "neutral.hall",
  timeLabel: "now",
  locationLabel: "hall",
  presentActorIds: ["actor.reader", "actor.envoy"],
};

const manifest: BeatManifest = {
  beatId: "neutral.beat.one",
  sourceRef: "neutral.source.one",
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
      ticketId: "neutral.ticket.result",
      slot: "PLAYER_RESULT",
      scenePhase: "ACTION_PHASE",
      required: true,
      sourceRefs: ["neutral.source.one"],
      requiredMeaning: "The release remains on hold.",
    },
    {
      ticketId: "neutral.ticket.stop",
      slot: "DECISION_STOP",
      scenePhase: "AFTER_PHASE",
      required: true,
      sourceRefs: ["neutral.source.one"],
      requiredMeaning: "The envoys wait for the next instruction.",
    },
  ],
};

const truthContext: NarrativeTruthContext = {
  originActorId: "actor.reader",
  projectionActorId: "actor.reader",
  activeSceneEntityIds: ["actor.reader", "actor.envoy"],
  catalog: [
    { id: "actor.reader", kind: "ACTOR", displayName: "reader" },
    { id: "actor.envoy", kind: "ACTOR", displayName: "envoy" },
  ],
  capabilityIds: ["capability.defer"],
  secretIds: [],
  allowedPredicates: [],
  requiredVisiblePredicates: [],
  forbiddenPredicates: [],
  originActionsInDraft: "FORBIDDEN",
  stopCondition: "The envoys wait for the next instruction.",
};

function prepared(settlement: PreparedFactSettlement) {
  return {
    selectedOption: settlement.selectedOption,
    settledNarrative: "The release remains on hold.",
    sourceRef: "neutral.source.one",
    beatManifest: manifest,
    storyComplete: false,
    fallbackDraft: {
      schemaVersion: SCENE_DRAFT_SCHEMA,
      draftId: "neutral.fallback.one",
      owner: "FALLBACK" as const,
      slots: {
        PLAYER_RESULT: "The release remains on hold.",
        DECISION_STOP: "The envoys wait for the next instruction.",
      },
      surfaceProvenance: {
        PLAYER_RESULT: {
          surfaceSource: "STORY_PACKAGE" as const,
          sourceRef: "neutral.source.one",
          coveredTicketIds: ["neutral.ticket.result"],
        },
        DECISION_STOP: {
          surfaceSource: "STORY_PACKAGE" as const,
          sourceRef: "neutral.source.one",
          coveredTicketIds: ["neutral.ticket.stop"],
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

function modules(options: OpenNovelOption[], capture: {
  settledInputs: Array<{ action: string; selectedOption: OpenNovelOption | null }>;
  sceneEvents: Array<Record<string, unknown>>;
}) {
  const settlement: FactSettlementModule = {
    moduleId: "neutral.fact-settlement.v1",
    async currentOptions() {
      return options;
    },
    async settle(_workspace, input) {
      capture.settledInputs.push({
        action: input.action,
        selectedOption: input.selectedOption,
      });
      return {
        selectedOption: input.selectedOption,
        storyComplete: false,
        audit: { source: "fixture" },
        payload: { source: "fixture" },
      };
    },
    async commit() {},
    async projectCommit() {
      throw new Error("not exercised");
    },
  };
  const nextBeat: NextBeatPlannerModule = {
    moduleId: "neutral.next-beat.v1",
    async plan(value) {
      return prepared(value);
    },
    nextOptions() {
      return [];
    },
  };
  const workspace = {
    async recordSceneEvent(_runId: string, event: Record<string, unknown>) {
      capture.sceneEvents.push(event);
    },
  } as unknown as FileStoryWorkspace;
  return { adapter: composeAuthoredDecisionModules({ settlement, nextBeat }), workspace };
}

test("free text is canonicalized before the same Settlement and Kernel path", async () => {
  const options: OpenNovelOption[] = [
    {
      id: "release.hold",
      label: "Hold the release while both delegates state what they know.",
      effect: {
        decisionPointId: "release.boundary",
        intent: "Delay the launch and question both envoys before release.",
      },
    },
    {
      id: "release.now",
      label: "Authorize immediate release under a sealed manifest.",
      effect: {
        decisionPointId: "release.boundary",
        intent: "Release immediately and record the cargo.",
      },
    },
  ];
  const capture = { settledInputs: [], sceneEvents: [] } as {
    settledInputs: Array<{ action: string; selectedOption: OpenNovelOption | null }>;
    sceneEvents: Array<Record<string, unknown>>;
  };
  const { adapter, workspace } = modules(options, capture);

  const result = await adapter.prepare(workspace, {
    runId: "run.neutral",
    turnNumber: 1,
    action: "Delay the launch until both delegates explain what they know.",
    selectedOption: null,
  });

  assert.ok(result);
  assert.equal(capture.settledInputs.length, 1);
  assert.equal(capture.settledInputs[0]!.action, options[0]!.label);
  assert.equal(capture.settledInputs[0]!.selectedOption?.id, "release.hold");
  assert.equal(result.selectedOption?.id, "release.hold");
  assert.deepEqual(result.audit.intentResolution, {
    schemaVersion: "omw.intent-resolution.v1",
    moduleStatus: "BOUND_AFFORDANCE",
    intentType: "AFFORDANCE_EQUIVALENT",
    capabilityRef: "decision-point:release.boundary",
    targetRefs: ["release.boundary"],
    constraints: [],
    matchedAffordanceId: "release.hold",
    confidence: assertNumber(result.audit.intentResolution, "confidence"),
    reason: "DISTINCTIVE_AFFORDANCE_PHRASE",
    originalAction: "Delay the launch until both delegates explain what they know.",
  });
  assert.equal(capture.sceneEvents[0]?.type, "intent_resolution");
});

test("ambiguous free text is recoverable and never reaches Settlement", async () => {
  const options: OpenNovelOption[] = [
    { id: "ask.first", label: "Ask the first envoy for the records." },
    { id: "ask.second", label: "Ask the second envoy for the records." },
  ];
  const capture = { settledInputs: [], sceneEvents: [] } as {
    settledInputs: Array<{ action: string; selectedOption: OpenNovelOption | null }>;
    sceneEvents: Array<Record<string, unknown>>;
  };
  const { adapter, workspace } = modules(options, capture);

  await assert.rejects(
    adapter.prepare(workspace, {
      runId: "run.ambiguous",
      turnNumber: 1,
      action: "Ask the envoy for the records.",
      selectedOption: null,
    }),
    (error: unknown) => (
      error instanceof RuntimeActionError
      && error.status === 400
      && error.code === "INTENT_CLARIFICATION_REQUIRED"
    ),
  );
  assert.equal(capture.settledInputs.length, 0);
  assert.equal(capture.sceneEvents[0]?.status, "CLARIFICATION_REQUIRED");
});

test("an explicit bound option bypasses resolver ambiguity", async () => {
  const option: OpenNovelOption = {
    id: "ask.first",
    label: "Ask the first envoy for the records.",
  };
  const capture = { settledInputs: [], sceneEvents: [] } as {
    settledInputs: Array<{ action: string; selectedOption: OpenNovelOption | null }>;
    sceneEvents: Array<Record<string, unknown>>;
  };
  const { adapter, workspace } = modules([option], capture);

  const result = await adapter.prepare(workspace, {
    runId: "run.bound",
    turnNumber: 1,
    action: option.label,
    selectedOption: option,
  });

  assert.equal(result?.selectedOption?.id, option.id);
  assert.equal(capture.settledInputs.length, 1);
  assert.equal(
    capture.sceneEvents.some((event) => event.type === "intent_resolution"),
    false,
  );
});

function assertNumber(value: unknown, key: string) {
  assert.ok(value && typeof value === "object" && !Array.isArray(value));
  const number = (value as Record<string, unknown>)[key];
  assert.equal(typeof number, "number");
  return number;
}
