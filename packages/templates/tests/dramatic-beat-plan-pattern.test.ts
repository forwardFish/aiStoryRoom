import assert from "node:assert/strict";
import test from "node:test";
import {
  applyNarrativeScenePatternToDramaticBeatPlan,
  compileDramaticBeatPlan,
} from "../src/story-package/dramatic-beat-plan";

test("approved scene grammar becomes transient ordered steps in a neutral world", () => {
  const base = compileDramaticBeatPlan({
    sceneRef: "neutral.archive-hall",
    sceneObjective: "Decide who may review the sealed record.",
    presentActorRefs: ["actor.reader", "actor.witness", "actor.custodian"],
    actorLabelsByRef: {
      "actor.reader": "Reader",
      "actor.witness": "Witness",
      "actor.custodian": "Custodian",
    },
    playerActorRef: "actor.reader",
    pressureActorRefs: ["actor.custodian"],
    actorPolicies: [
      { actorRef: "actor.custodian", goal: "Keep custody traceable." },
      { actorRef: "actor.witness", goal: "Limit what the signature proves." },
    ],
    playerResultMeaning: "The reader keeps the record sealed while requesting a witnessed review.",
    pressureMeaning: "The custodian asks for a custody ruling.",
    visibleConsequenceMeaning: "The unopened record remains under visible custody.",
    decisionStopMeaning: "Who may open the record, and under whose witness?",
  });
  const original = structuredClone(base);

  const result = applyNarrativeScenePatternToDramaticBeatPlan(base, {
    openingPressure: "A holder presents only one authorized layer while keeping the rest closed.",
    orderedBeats: [
      {
        actorRole: "material_holder",
        observableMove: "Keep the unopened material under the holder's control.",
        sceneFunction: "Make the information boundary visible.",
        reactionCue: "No one may infer what the closed material contains.",
      },
      {
        actorRole: "witness_controller",
        observableMove: "Ask the witness to define exactly what the signature would attest.",
        sceneFunction: "Separate contact, custody and truth claims.",
        reactionCue: "A refusal may weaken traceability but proves no wrongdoing.",
      },
    ],
    objectPowerMoves: [
      {
        objectLabel: "sealed record",
        observableUse: "Leave the seal visible while moving the record no farther.",
        powerMeaning: "Custody and access remain separate powers.",
      },
    ],
  });

  assert.deepEqual(base, original, "the authoritative base plan must not be mutated");
  assert.deepEqual(
    result.steps.map((step) => step.kind),
    [
      "PLAYER_RESULT",
      "PATTERN_OPENING",
      "PATTERN_MOVE",
      "PATTERN_MOVE",
      "OBJECT_POWER_MOVE",
      "COUNTERMOVE",
      "REACTION_WINDOW",
      "VISIBLE_CONSEQUENCE",
      "DECISION_PRESSURE",
    ],
  );
  assert.equal(
    result.steps.find((step) => step.kind === "PLAYER_RESULT")?.requiredMeaning,
    "The reader keeps the record sealed while requesting a witnessed review.",
  );
  assert.equal(
    result.steps.find((step) => step.kind === "VISIBLE_CONSEQUENCE")?.requiredMeaning,
    "The unopened record remains under visible custody.",
  );
  assert.equal(result.steps.at(-1)?.requiredMeaning, "Who may open the record, and under whose witness?");
  assert.deepEqual(result.expressionContract, {
    settlementOwnsFacts: true,
    narratorOwnsRegularScene: true,
    fallbackUsesSamePlan: true,
    decisionPressureIsTerminal: true,
  });
  assert.ok(result.steps.every((step) => step.durableMutationAllowed === false));
  assert.ok(
    result.steps
      .filter((step) => step.expressionPolicy === "ADAPT_PATTERN_TO_CURRENT_SCENE")
      .every((step) => /不得照搬来源场景/u.test(step.requiredMeaning)),
  );
  assert.ok(
    result.steps
      .filter((step) => step.kind.startsWith("PATTERN") || step.kind === "OBJECT_POWER_MOVE")
      .every((step) => step.actorRefs.every((actorRef) => (
        result.activeActors.some((actor) => actor.actorRef === actorRef)
      ))),
  );
});

test("pattern application is idempotent and cannot replace the authoritative pressure", () => {
  const base = compileDramaticBeatPlan({
    sceneRef: "neutral.council",
    sceneObjective: "Choose a release condition.",
    presentActorRefs: ["actor.reader", "actor.envoy"],
    actorLabelsByRef: {
      "actor.reader": "Reader",
      "actor.envoy": "Envoy",
    },
    playerActorRef: "actor.reader",
    pressureActorRefs: ["actor.envoy"],
    actorPolicies: [],
    playerResultMeaning: "The reader withholds immediate release.",
    pressureMeaning: "The envoy demands a release condition.",
    visibleConsequenceMeaning: "The release remains paused in front of both parties.",
    decisionStopMeaning: "Will the reader release, defer, or add a condition?",
  });
  const pattern = {
    openingPressure: "One party controls the document while another controls the deadline.",
    orderedBeats: [{
      actorRole: "deadline_holder",
      observableMove: "Point to the unresolved deadline.",
      sceneFunction: "Keep time pressure visible.",
      reactionCue: "Do not invent a new date.",
    }],
    objectPowerMoves: [],
  };

  const once = applyNarrativeScenePatternToDramaticBeatPlan(base, pattern);
  const twice = applyNarrativeScenePatternToDramaticBeatPlan(once, pattern);

  assert.deepEqual(twice, once);
  assert.equal(
    once.steps.find((step) => step.kind === "COUNTERMOVE")?.requiredMeaning,
    "The envoy demands a release condition.",
  );
  assert.equal(
    once.steps.find((step) => step.kind === "DECISION_PRESSURE")?.requiredMeaning,
    "Will the reader release, defer, or add a condition?",
  );
});
