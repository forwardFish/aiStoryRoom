import assert from "node:assert/strict";
import test from "node:test";
import {
  DefaultSceneRenderPlanner,
  DeterministicProtectedSceneRenderer,
  assertSingleSceneOwner,
} from "../src/scene-render-plan.js";
import {
  SCENE_DRAFT_SCHEMA,
  type BeatManifest,
  type PlayerVisibleFallbackDraft,
} from "../src/scene-expression.js";
import type { PreparedAuthoredDecision } from "../src/decision-adapter.js";

test("planner selects slot-composed narration from structured causal ownership, not prose", () => {
  const prepared = fixturePreparedDecision();
  const plan = new DefaultSceneRenderPlanner().plan({ turnId: "T01", preparedDecision: prepared });
  assert.equal(plan.mode, "COMPOSED_SCENE");
  assert.equal(plan.owner, "NARRATOR");
  assert.deepEqual(plan.criticalReasons, ["PROTECTED_CAUSAL_RESULT"]);
});

test("planner selects Open Scene when no critical durable result exists", () => {
  const prepared = fixturePreparedDecision();
  prepared.beatManifest.tickets = prepared.beatManifest.tickets.map((ticket) => ({
    ...ticket,
    expressionOwner: "NARRATOR",
    protectedText: undefined,
  }));
  const plan = new DefaultSceneRenderPlanner().plan({ turnId: "T01", preparedDecision: prepared });
  assert.equal(plan.mode, "OPEN_SCENE");
  assert.equal(plan.owner, "NARRATOR");
  assert.deepEqual(plan.criticalReasons, []);
});

test("deterministic protected renderer is a complete emergency fallback", () => {
  const prepared = fixturePreparedDecision();
  const plan = new DefaultSceneRenderPlanner().plan({ turnId: "T01", preparedDecision: prepared });
  const rendered = new DeterministicProtectedSceneRenderer().render({ plan, preparedDecision: prepared });
  assert.equal(rendered.owner, "FALLBACK");
  assert.equal(rendered.text, "总督暂缓签发。\n\n巡抚书吏仍在屏风外等候正式答复。");
  assert.equal(rendered.providerResult.usage.inputTokens, 0);
  assertSingleSceneOwner({ plan, actualOwner: "COMPOSED" });
  assertSingleSceneOwner({ plan, actualOwner: rendered.owner });
});

function fixturePreparedDecision(): PreparedAuthoredDecision {
  const manifest: BeatManifest = {
    beatId: "beat-1",
    sourceRef: "event-1",
    transition: {
      beforeScene: scene(),
      narrationScene: scene(),
      afterScene: scene(),
      transitionRequired: false,
      arrivingActorIds: [],
      departingActorIds: [],
    },
    tickets: [
      {
        ticketId: "ticket-result",
        slot: "PLAYER_RESULT",
        scenePhase: "ACTION_PHASE",
        required: true,
        sourceRefs: ["event-1"],
        requiredMeaning: "总督暂缓签发。",
        expressionOwner: "PROTECTED",
        protectedText: "总督暂缓签发。",
      },
      {
        ticketId: "ticket-stop",
        slot: "DECISION_STOP",
        scenePhase: "AFTER_PHASE",
        required: true,
        sourceRefs: ["event-1"],
        requiredMeaning: "巡抚书吏仍在屏风外等候正式答复。",
      },
    ],
  };
  const fallbackDraft: PlayerVisibleFallbackDraft = {
    schemaVersion: SCENE_DRAFT_SCHEMA,
    draftId: "asset.scene-1",
    owner: "FALLBACK",
    slots: {
      PLAYER_RESULT: "总督暂缓签发。",
      DECISION_STOP: "巡抚书吏仍在屏风外等候正式答复。",
    },
    surfaceProvenance: {
      PLAYER_RESULT: {
        surfaceSource: "STORY_PACKAGE",
        sourceRef: "asset-1",
        coveredTicketIds: ["ticket-result"],
      },
      DECISION_STOP: {
        surfaceSource: "STORY_PACKAGE",
        sourceRef: "asset-1",
        coveredTicketIds: ["ticket-stop"],
      },
    },
  };
  return {
    selectedOption: null,
    settledNarrative: "总督暂缓签发。",
    sourceRef: "event-1",
    beatManifest: manifest,
    storyComplete: false,
    fallbackDraft,
    truthContexts: {
      actionPhase: {} as never,
      afterPhase: { stopCondition: "巡抚书吏仍在屏风外等候正式答复。" } as never,
    },
    audit: {},
    payload: {},
  };
}

function scene() {
  return {
    sceneId: "scene-1",
    timeLabel: "当日",
    locationLabel: "签押房",
    presentActorIds: ["actor-1"],
  };
}
