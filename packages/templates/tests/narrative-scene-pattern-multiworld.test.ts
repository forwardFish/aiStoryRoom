import assert from "node:assert/strict";
import test from "node:test";
import { selectNarrativeScenePatterns } from "../src";

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
