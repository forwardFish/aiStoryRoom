import assert from "node:assert/strict";
import test from "node:test";
import { compileGenericOpenNovelResultV3, genericEndgameArtifactFromEnding } from "./generic-ending-result";
import type { RawOpenNovelResult, SoloResultRunRecord } from "./solo-ending-result";

const presentation = {
  schemaVersion:"endgame_presentation_v3", resultType:"SOLO_PART_END",
  world:{ worldId:"neutral-synthetic", worldTitle:"Neutral" }, role:{ roleId:"operator", roleTitle:"Operator" },
  title:"Ending", axes:[{ axisId:"world", label:"World", outcomeId:"stable", title:"Stable", summary:"Stable." }],
  metrics:[{ metricId:"signal", label:"Signal", value:55, formattedValue:"55", direction:"HIGH_GOOD", initialValue:40 }],
  dynamicSubtitle:"A consequence.", style:null, narrative:"A committed ending.",
  sections:[{ sectionId:"gain", label:"Gain", layout:"LIST", items:[{ title:"Saved", text:"It remained.", actorName:null, stageIndex:null }] }],
  replayHint:"Try again.", endingFingerprint:"a".repeat(64),
  replayActions:[{ type:"RESTART_SAME_STORY", label:"Restart", href:"/role-select?story=neutral-synthetic&start=new", enabled:true, disabledReason:null }]
} as const;
const raw: RawOpenNovelResult = { room:{ id:"run-1" }, completedNodes:6, ending:{ schemaVersion:"openovel_ending_v1", scope:"PART", endingKey:"stable", title:"Ending", finalSceneNarrative:"Final.", protagonistFate:"Ready.", aftermath:[], sourceTurnId:"T06", sourceRevision:6 } };
const run: SoloResultRunRecord = { id:"run-1", ownerUserId:"user-1", templateKey:"neutral-synthetic", engineVersion:"openovel_v1", selectedRoleKey:"operator", status:"chapter_generated", updatedAt:new Date(0), players:[{ userId:"user-1", role:{ id:"role-1", roleKey:"operator", roleName:"Operator", personalGoal:"Complete" } }] };

test("formal Result API returns generic Presentation V3", () => {
  const result = compileGenericOpenNovelResultV3({ raw, run, roleKey:"operator", artifact:{ schemaVersion:"generic_endgame_result_artifact_v1", sourceRevision:6, presentation } });
  assert.equal(result.schemaVersion, "openovel_result_v3");
  assert.equal(result.presentation.schemaVersion, "endgame_presentation_v3");
  assert.equal("zhejiangOutcome" in result.presentation, false);
});

test("generic Result fails closed on role, world, revision, and external replay links", () => {
  for (const mutate of [
    (copy:any) => { copy.sourceRevision = 5; },
    (copy:any) => { copy.presentation.world.worldId = "other"; },
    (copy:any) => { copy.presentation.role.roleId = "other"; },
    (copy:any) => { copy.presentation.replayActions[0].href = "https://evil.invalid"; },
  ]) {
    const artifact:any = structuredClone({ schemaVersion:"generic_endgame_result_artifact_v1", sourceRevision:6, presentation });
    mutate(artifact);
    assert.throws(() => compileGenericOpenNovelResultV3({ raw, run, roleKey:"operator", artifact }));
  }
});

test("artifact is read only from the authoritative ending envelope", () => {
  assert.equal(genericEndgameArtifactFromEnding({ genericEndgame:{ schemaVersion:"generic_endgame_result_artifact_v1" } }) !== null, true);
  assert.equal(genericEndgameArtifactFromEnding({}), null);
});
