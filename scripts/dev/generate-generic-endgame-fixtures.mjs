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
  const presentation = composeEndgamePresentationV3({
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
  await writeFile(path.join(output, `${fixture.key}.json`), `${JSON.stringify({ schemaVersion:"local_endgame_fixture_v1", generatedFrom:"committed-s0-s6-contracts", presentation }, null, 2)}\n`, "utf8");
}

console.log(JSON.stringify({ generated:fixtures.map(({ key }) => `/game?endgameFixture=${key}`), output }, null, 2));
