import assert from "node:assert/strict";
import test from "node:test";
import {
  compileDramaticBeatPlan,
  selectNarrativeScenePatterns,
} from "../src";

type FixtureAsset = {
  assetType: string;
  sectionIds: string[];
  requirementIds: string[];
  decisionKernelIds: string[];
  payload: Record<string, unknown>;
};

test("the scene-pattern selector is reusable across worlds and genres", () => {
  const assets: FixtureAsset[] = [
    {
      assetType: "NARRATIVE_SCENE_PATTERN",
      sectionIds: ["SCENE-DOCK"],
      requirementIds: ["REQ-AIRLOCK-CONTROL"],
      decisionKernelIds: ["DK-DOCK-ACCESS"],
      payload: { patternId: "PATTERN-ORBITAL-DOCK" },
    },
    {
      assetType: "NARRATIVE_SCENE_PATTERN",
      sectionIds: ["SCENE-DOCK"],
      requirementIds: ["REQ-CARGO-OWNERSHIP"],
      decisionKernelIds: ["DK-CARGO-CLAIM"],
      payload: { patternId: "PATTERN-ORBITAL-CARGO" },
    },
    {
      assetType: "NARRATIVE_SCENE_PATTERN",
      sectionIds: ["ACT-COURTROOM"],
      requirementIds: ["REQ-WITNESS-CREDIBILITY"],
      decisionKernelIds: ["DK-CROSS-EXAMINATION"],
      payload: { patternId: "PATTERN-LEGAL-OBJECTION" },
    },
    {
      assetType: "STYLE_PROFILE",
      sectionIds: ["SCENE-DOCK"],
      requirementIds: ["REQ-AIRLOCK-CONTROL"],
      decisionKernelIds: ["DK-DOCK-ACCESS"],
      payload: { profileId: "STYLE-SPACE-THRILLER" },
    },
  ];

  const selected = selectNarrativeScenePatterns(assets, {
    sectionId: "SCENE-DOCK",
    decisionKernelId: "DK-DOCK-ACCESS",
    requirementIds: ["REQ-AIRLOCK-CONTROL", "REQ-CARGO-OWNERSHIP"],
  }, 2);

  assert.deepEqual(
    selected.map((asset) => asset.payload.patternId),
    ["PATTERN-ORBITAL-DOCK", "PATTERN-ORBITAL-CARGO"],
  );
  assert.equal(selected.some((asset) => asset.sectionIds.includes("PART-01")), false);
});

test("the dramatic-beat planner binds a second world without story vocabulary", () => {
  const plan = compileDramaticBeatPlan({
    sceneRef: "orbital-dock.control-room",
    sceneObjective: "The inspector must force the cargo dispute into an actionable choice.",
    presentActorRefs: ["actor.captain", "actor.inspector", "actor.engineer"],
    actorLabelsByRef: {
      "actor.captain": "Captain",
      "actor.inspector": "Port Inspector",
      "actor.engineer": "Chief Engineer",
    },
    pressureActorRefs: ["actor.inspector"],
    actorPolicies: [
      { actorRef: "actor.inspector", goal: "Keep the quarantine legally enforceable." },
      { actorRef: "actor.engineer", goal: "Prevent the reactor from losing coolant." },
    ],
    pressureMeaning: "The inspector seals the cargo lift and asks for the manifest.",
    decisionStopMeaning: "The captain must decide whether to surrender the manifest or open the lift for emergency repairs.",
  });

  assert.equal(plan.sceneRef, "orbital-dock.control-room");
  assert.deepEqual(plan.steps.map((step) => step.kind), [
    "COUNTERMOVE",
    "REACTION_WINDOW",
    "DECISION_PRESSURE",
  ]);
  assert.deepEqual(plan.steps[0]?.actorLabels, ["Port Inspector"]);
  assert.match(plan.steps[0]?.requiredMeaning || "", /seals the cargo lift/u);
  assert.equal(plan.steps.every((step) => step.durableMutationAllowed === false), true);
  assert.doesNotMatch(JSON.stringify(plan), /县册|巡抚|回文|桑田/u);
});
