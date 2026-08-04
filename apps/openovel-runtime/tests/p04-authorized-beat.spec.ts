import assert from "node:assert/strict";
import test from "node:test";
import {
  validatePreparedAuthoredDecision,
  type PreparedAuthoredDecision,
} from "../src/decision-adapter.js";
import {
  SCENE_DRAFT_SCHEMA,
  bindProtectedFallbackDraft,
} from "../src/scene-expression.js";

test("prepared decision accepts a world-neutral manifest and full fallback", () => {
  const prepared = fixture();
  assert.equal(validatePreparedAuthoredDecision(prepared), prepared);
});

test("fallback must own the whole expression", () => {
  const prepared = fixture();
  (prepared.fallbackDraft as { owner: string }).owner = "NARRATOR";
  assert.throws(
    () => validatePreparedAuthoredDecision(prepared),
    /FALLBACK_EXPRESSION_OWNER_INVALID/,
  );
});

test("protected fallback slots have one server-owned semantic source", () => {
  const prepared = fixture();
  const resultTicket = prepared.beatManifest.tickets.find((ticket) => (
    ticket.slot === "PLAYER_RESULT"
  ))!;
  resultTicket.expressionOwner = "PROTECTED";
  resultTicket.protectedText = prepared.settledNarrative;
  prepared.fallbackDraft.slots.PLAYER_RESULT = "A contradictory player result.";
  assert.throws(
    () => validatePreparedAuthoredDecision(prepared),
    /FALLBACK_PROTECTED_SLOT_MISMATCH:PLAYER_RESULT/,
  );
  prepared.fallbackDraft = bindProtectedFallbackDraft(
    prepared.fallbackDraft,
    prepared.beatManifest,
  );
  assert.equal(prepared.fallbackDraft.slots.PLAYER_RESULT, prepared.settledNarrative);
  assert.equal(validatePreparedAuthoredDecision(prepared), prepared);
});

test("manifest result and stop meanings bind to settlement", () => {
  const resultMismatch = fixture();
  resultMismatch.beatManifest.tickets[0]!.requiredMeaning = "Another result.";
  assert.throws(
    () => validatePreparedAuthoredDecision(resultMismatch),
    /BEAT_MANIFEST_PLAYER_RESULT_MISMATCH/,
  );
  const stopMismatch = fixture();
  stopMismatch.truthContexts.afterPhase.stopCondition = "Another stop.";
  assert.throws(
    () => validatePreparedAuthoredDecision(stopMismatch),
    /BEAT_MANIFEST_STOP_POINT_MISMATCH/,
  );
});

function fixture(): PreparedAuthoredDecision {
  const playerText = "The player sealed the inner airlock.";
  const pressureText = "The bridge officer warns that the outer lock is cycling.";
  const stopText = "Will the player wait or vent the chamber?";
  const scene = {
    sceneId: "bridge",
    timeLabel: "now",
    locationLabel: "bridge",
    presentActorIds: ["actor.player", "actor.officer"],
  };
  const truthContext = {
    originActorId: "actor.player",
    projectionActorId: "actor.player",
    catalog: [],
    capabilityIds: [],
    secretIds: [],
    allowedPredicates: [],
    requiredVisiblePredicates: [],
    forbiddenPredicates: [],
    originActionsInDraft: "FORBIDDEN" as const,
    stopCondition: stopText,
  };
  return {
    selectedOption: null,
    settledNarrative: playerText,
    sourceRef: "event.turn.01",
    storyComplete: false,
    beatManifest: {
      beatId: "beat.airlock.01",
      sourceRef: "event.turn.01",
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
          ticketId: "ticket.player-result",
          slot: "PLAYER_RESULT",
          scenePhase: "ACTION_PHASE",
          required: true,
          sourceRefs: ["event.player-result"],
          requiredMeaning: playerText,
        },
        {
          ticketId: "ticket.pressure",
          slot: "WORLD_PRESSURE",
          scenePhase: "AFTER_PHASE",
          required: true,
          sourceRefs: ["event.bridge-pressure"],
          requiredMeaning: pressureText,
        },
        {
          ticketId: "ticket.stop",
          slot: "DECISION_STOP",
          scenePhase: "AFTER_PHASE",
          required: true,
          sourceRefs: ["decision.airlock.next"],
          requiredMeaning: stopText,
        },
      ],
    },
    fallbackDraft: {
      schemaVersion: SCENE_DRAFT_SCHEMA,
      draftId: "T01.fallback",
      owner: "FALLBACK",
      slots: {
        PLAYER_RESULT: playerText,
        WORLD_PRESSURE: pressureText,
        DECISION_STOP: stopText,
      },
      surfaceProvenance: {
        PLAYER_RESULT: provenance("event.player-result", "ticket.player-result"),
        WORLD_PRESSURE: provenance("event.bridge-pressure", "ticket.pressure"),
        DECISION_STOP: provenance("decision.airlock.next", "ticket.stop"),
      },
    },
    truthContexts: {
      actionPhase: truthContext,
      afterPhase: truthContext,
    },
    audit: {},
    payload: {},
  };
}

function provenance(sourceRef: string, ticketId: string) {
  return { surfaceSource: "STORY_PACKAGE" as const, sourceRef, coveredTicketIds: [ticketId] };
}
