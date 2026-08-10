import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { composeEndgamePresentationV3 } from "../../packages/shared/src/endgame/config-driven-endgame-presentation-v1.mjs";
import { renderConfigDrivenEndingFallbackV1 } from "../../packages/shared/src/endgame/config-driven-ending-narrator-v1.mjs";
import { compileRoute, neutral, sangtian } from "../../packages/shared/tests/generic-endgame-s4-details-fixture.mjs";

if (process.env.NODE_ENV === "production") throw new Error("LOCAL_ENDGAME_FIXTURES_DISABLED_IN_PRODUCTION");

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const output = path.join(root, "apps", "web", "public", "__local-endgame-fixtures");
await mkdir(output, { recursive: true });

const fixtures = [
  { key:"neutral", packageDocument:neutral, worldTitle:"Neutral Synthetic", roleTitle:"Operator" },
  { key:"sangtian", packageDocument:sangtian, worldTitle:"《桑田诏》", roleTitle:"浙江总督" }
];

for (const fixture of fixtures) {
  const route = compileRoute(fixture.packageDocument, { runId:`local-${fixture.key}-completed-run` });
  const narratedEnding = renderConfigDrivenEndingFallbackV1({ runPackageBinding:route.binding, adjudication:route.adjudication, blueprint:route.blueprint });
  const compiledPresentation = composeEndgamePresentationV3({
    runPackageBinding:route.binding, adjudication:route.adjudication, blueprint:route.blueprint, narratedEnding,
    world:{ worldId:fixture.packageDocument.worldId, worldTitle:fixture.worldTitle },
    role:{ roleId:fixture.packageDocument.profileId, roleTitle:fixture.roleTitle },
    state:route.state, facts:route.facts,
    replayActions:[
      { type:"RESTART_SAME_STORY", label:"重新开始", href:`/role-select?story=${encodeURIComponent(fixture.packageDocument.worldId)}&start=new`, enabled:true, disabledReason:null },
      { type:"CHANGE_ROLE", label:"更换角色", href:`/role-select?story=${encodeURIComponent(fixture.packageDocument.worldId)}&start=new`, enabled:true, disabledReason:null },
      { type:"CONTINUE_NEXT_PART", label:"进入下一部分", href:null, enabled:false, disabledReason:"下一部分尚未开放" },
      { type:"BACK_TO_WORLDS", label:"返回世界", href:"/worlds", enabled:true, disabledReason:null }
    ]
  });
  const presentation = applyLocalPreviewCopy(compiledPresentation, fixture.key);
  await writeFile(path.join(output, `${fixture.key}.json`), `${JSON.stringify({ schemaVersion:"local_endgame_fixture_v1", generatedFrom:"committed-s0-s6-contracts-with-local-preview-copy", presentation }, null, 2)}\n`, "utf8");
}

console.log(JSON.stringify({ generated:fixtures.map(({ key }) => `/game?endgameFixture=${key}`), output }, null, 2));

// Local preview copy is deliberately outside the adjudicator and production API.
// It lets a player judge the final-chapter reading experience before S7 connects
// each world's authored outcome copy to the same generic contracts.
function applyLocalPreviewCopy(presentation, key) {
  if (key !== "sangtian") return presentation;
  return {
    ...presentation,
    title: "首报出浙",
    dynamicSubtitle: "你守住了总督应担的责任，也让浙江暂时避开了一场更深的乱局。",
    narrative: [
      "暮色落尽时，第一份奏报终于离开杭州。驿骑穿过城门，蹄声渐远，案上的灯却仍亮着。你没有把灾情和改桑之责推给县令，也没有让商会借救粮之名吞下灾民的田地。至少今夜，粮船还在河上，县册还在官府手中。",
      "代价也已经写进了这封奏报。朝廷会知道浙江没有按最省事的办法行事，巡抚和商会也不会忘记是谁划下了边界。你保住的不是一个圆满结局，而是一点让百姓还能喘息、让后来者还能查明真相的余地。",
      "窗外传来更鼓。京师的回文尚未抵达，新的问责已经在路上。你合上副本，知道这一局并未真正结束；但在天亮以前，浙江仍由你守着。"
    ].join("\n\n"),
    axes: [
      { axisId:"world_outcome", label:"浙江局势", outcomeId:"guarded", title:"暂得喘息", summary:"粮路暂稳，民田与县册没有在灾期被暗中易手。" },
      { axisId:"protagonist_fate", label:"你的处境", outcomeId:"accepted_burden", title:"守土担责", summary:"你承担了首报与执行边界的责任，也因此走入更直接的问责。" }
    ],
    sections: [
      { sectionId:"gain", label:"你保住了", layout:"LIST", items:[
        { title:"救粮与民田的边界", text:"商会可以出粮出船，却不能趁灾收购或代持民田。", actorName:null, stageIndex:2 },
        { title:"县册证据", text:"实际买受人与田契成交仍需逐份登记，证据链没有被抹去。", actorName:null, stageIndex:3 }
      ] },
      { sectionId:"loss", label:"你付出了", layout:"LIST", items:[
        { title:"总督的政治余地", text:"首份奏报由你署责，朝廷追问时已无法把风险推给下属。", actorName:null, stageIndex:4 }
      ] },
      { sectionId:"open", label:"仍未解决", layout:"LIST", items:[
        { title:"京师回文", text:"朝廷是否接受浙江划下的执行边界，仍要等下一封公文。", actorName:null, stageIndex:null }
      ] }
    ],
    replayHint: "换一种责任与利益的排序，可能让浙江走向另一种结局。"
  };
}
