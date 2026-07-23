import { readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { loadAjv2020, readJson, schemaRoot, validateWithSchema } from "./lib/contract-utils.mjs";

const schemaFiles = (await readdir(schemaRoot))
  .filter((name) => name.endsWith(".schema.json"))
  .sort();

const ajv = loadAjv2020();
const errors = [];

for (const file of schemaFiles) {
  try {
    ajv.compile(await readJson(resolve(schemaRoot, file)));
  } catch (error) {
    errors.push({ file, error: error instanceof Error ? error.message : String(error) });
  }
}

// This fixture intentionally contains no Sangtian, Ming dynasty, or PART-01
// identifiers. It proves that the shared narrative contract accepts a second
// world with only one approved source-derived scene pattern.
const reusableNarrativeFixture = {
  schemaVersion: "narrative-scene-pattern-set-v1",
  worldId: "orbital-harbor",
  scopeId: "ACT-02/SCENE-DOCK",
  version: "1.0.0",
  patterns: [{
    schemaVersion: "narrative-scene-pattern-v1",
    patternId: "PATTERN-DOCK-ULTIMATUM",
    sourceSceneId: "SOURCE-SCENE-17",
    sourceRefs: [{
      sourceId: "orbital-harbor-screenplay",
      sourceSha256: "A".repeat(64),
      chapterId: "ACT-02",
      paragraphStartId: "P-120",
      paragraphEndId: "P-127",
      lineStart: 120,
      lineEnd: 127,
      textSpanSha256: "B".repeat(64),
    }],
    sectionIds: ["SCENE-DOCK"],
    requirementIds: ["REQ-AIRLOCK-CONTROL"],
    decisionKernelIds: ["DK-DOCK-ACCESS"],
    actorRefs: ["actor.harbor_master", "actor.ship_captain"],
    sourceClaimIds: ["CLAIM-17-A"],
    dramaticFunction: "把抽象的通行权争议变成舱门前正在发生的对峙。",
    openingPressure: "氧气倒计时与货船泊位冲突同时逼近。",
    orderedBeats: [
      { ordinal: 1, actorRole: "gatekeeper", observableMove: "锁住内舱门并要求出示许可", sceneFunction: "把制度变成可见阻碍", reactionCue: "等待船长交出凭据" },
      { ordinal: 2, actorRole: "petitioner", observableMove: "递上受损的货单", sceneFunction: "提出不完整但可核验的主张", reactionCue: "旁人查看货单破损处" },
      { ordinal: 3, actorRole: "authority", observableMove: "在开门与扣船之间暂不表态", sceneFunction: "把冲突留给玩家处理", reactionCue: "两方都没有离开" },
    ],
    dialogueTactics: [{ actorRole: "gatekeeper", surfaceMove: "只问许可编号", hiddenRisk: "不愿承担擅自开门的责任", cadenceRule: "短问后停住，不解释背景" }],
    blockingPrinciples: ["让舱门隔开两方，使控制权可以被看见"],
    objectPowerMoves: [{ objectLabel: "破损货单", observableUse: "递到灯下供人核看", powerMeaning: "主张可以查验，却还不足以直接放行" }],
    transferableTechniques: ["用门、凭据和等待代替制度说明"],
    forbiddenFlattening: ["不得把场景写成权限矩阵摘要"],
    verbatimPolicy: "MECHANISM_ONLY_NO_VERBATIM_REUSE",
    reviewStatus: "APPROVED",
    reviewerId: "generic-contract-regression",
    approvedAt: "2026-07-23T00:00:00.000Z",
  }],
};
const reusableNarrativeValidation = await validateWithSchema(
  "narrative-scene-pattern-set-v1",
  reusableNarrativeFixture,
);
if (!reusableNarrativeValidation.valid) {
  errors.push({ file: "GENERIC_NARRATIVE_FIXTURE", error: JSON.stringify(reusableNarrativeValidation.errors) });
}

const report = {
  expectedSchemaCount: 35,
  actualSchemaCount: schemaFiles.length,
  compiledSchemaCount: schemaFiles.length - errors.length,
  reusableNarrativeFixture: reusableNarrativeValidation.valid ? "PASS" : "FAIL",
  errors,
  verdict: schemaFiles.length === 35 && errors.length === 0 ? "PASS" : "FAIL",
};

console.log(JSON.stringify(report, null, 2));
if (report.verdict !== "PASS") {
  process.exitCode = 1;
}
