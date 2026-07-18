import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SOURCE_VERSION = "sangtian_v1_1";
const CONTENT_VERSION = "sangtian_v1_2";
const WORLD_ACTOR_KEY = "court_market_pressure";
const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const worldRoot = join(packageRoot, "config", "sangtian");
const sourceRoot = join(worldRoot, "continuous-strategy-v1.1");
const outputRoot = join(worldRoot, "continuous-strategy-v1.2");

const json = (value) => `${JSON.stringify(value, null, 2)}\n`;
const sha256 = (value) => createHash("sha256").update(value.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n")).digest("hex");
const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));
const withVersion = (value) => JSON.parse(JSON.stringify(value).replaceAll(SOURCE_VERSION, CONTENT_VERSION));

const EXISTING_ROLE_KEYS = ["zhejiang_governor", "xunfu", "county_magistrate"];
const NEW_ROLES = [
  {
    id: "clerk",
    roleKey: "clerk",
    roleName: "改桑书吏",
    riskProfile: "CAUTIOUS",
    assetSlug: "document_index",
    assetLabel: "原始名册索引",
    concern: "名册、印记与文书流转时序",
    actions: [
      [["preserve_register_chain", "保全原始名册链"], ["compare_order_seals", "比对催办印记"], ["report_altered_entry", "报告被改田亩条目"]],
      [["verify_letter_register", "核验密信登记"], ["protect_courier_record", "保护递信记录"], ["expose_copied_seal", "揭示伪造印记"]],
      [["reconcile_grain_books", "核对粮仓账册"], ["trace_warehouse_receipts", "追查仓单流向"], ["publish_inventory_variance", "公布库存差额"]],
      [["index_shadow_ledger", "编列暗账索引"], ["secure_witness_notes", "封存证人笔录"], ["certify_transfer_chain", "确认原件转移链"]],
      [["map_orders_to_signatures", "对应命令与签押"], ["submit_clerk_chronology", "提交书吏时序"], ["disclose_document_coercion", "揭露强迫改册"]],
      [["seal_source_index", "封存来源索引"], ["cross_check_memorial_annex", "核对奏报附件"], ["preserve_verified_duplicate", "留存核验副本"]],
      [["testify_document_chain", "陈述文书证据链"], ["present_alteration_timeline", "呈交改册时间线"], ["request_witness_protection", "请求保护经手人"]]
    ]
  },
  {
    id: "merchant",
    roleKey: "merchant",
    roleName: "江南商会会首",
    riskProfile: "BALANCED",
    assetSlug: "trade_ledger",
    assetLabel: "商会往来账",
    concern: "粮仓、银路与官商契约",
    actions: [
      [["offer_auditable_credit", "提出可审计垫银"], ["cap_contract_prices", "限定契约粮价"], ["refuse_secret_kickback", "拒绝暗中回扣"]],
      [["escrow_deed_copies", "托管田契副本"], ["reveal_official_ious", "披露官员借据"], ["protect_letter_courier", "保护密信经手人"]],
      [["release_grain_openly", "公开限量放粮"], ["disclose_true_inventory", "披露真实库存"], ["negotiate_price_ceiling", "协商粮价上限"]],
      [["surrender_duplicate_ledger", "交出暗账副本"], ["protect_accountants", "保护商会账房"], ["suspend_suspect_credit", "冻结可疑垫银"]],
      [["publish_transaction_chronology", "公布交易时序"], ["answer_official_accusations", "回应官府指控"], ["separate_public_private_accounts", "拆分公私账目"]],
      [["submit_silver_route_report", "提交银路报告"], ["reject_immunity_trade", "拒绝免责交易"], ["guarantee_emergency_supply", "担保应急粮路"]],
      [["open_complete_ledgers", "公开完整商账"], ["accept_commercial_liability", "承担商事责任"], ["preserve_grain_supply", "维持裁决期粮路"]]
    ]
  },
  {
    id: "sili",
    roleKey: "sili_jian",
    roleName: "司礼监织造使",
    riskProfile: "ASSERTIVE",
    assetSlug: "imperial_channel",
    assetLabel: "内廷密报渠道",
    concern: "内廷密令、银路与奏报真伪",
    actions: [
      [["audit_edict_copies", "核查诏令副本"], ["monitor_rush_orders", "监看加急催办"], ["request_sealed_report", "索取封缄报告"]],
      [["trace_unauthorized_memorial", "追查越级奏报"], ["secure_imperial_courier", "保护内廷驿使"], ["compare_official_seals", "比对两衙印信"]],
      [["inspect_silver_grain_flow", "查验银粮流向"], ["question_merchant_records", "质询商会账目"], ["report_market_manipulation", "上报操纵粮价"]],
      [["seize_weaving_correspondence", "封存织造局往来"], ["protect_palace_witness", "保护内廷证人"], ["isolate_corrupt_agents", "隔离涉账内监"]],
      [["compare_impeachment_memorials", "比对弹劾奏疏"], ["expose_report_conflicts", "揭示奏报矛盾"], ["prevent_evidence_suppression", "阻止压下证据"]],
      [["transmit_complete_dossier", "递送完整案卷"], ["flag_memorial_omissions", "标记奏报删节"], ["protect_imperial_channel", "保全御前渠道"]],
      [["present_inner_court_audit", "呈交内廷审计"], ["separate_policy_from_corruption", "区分国策与舞弊"], ["request_evidence_judgment", "请求依证裁决"]]
    ]
  }
];
const ALL_ROLE_KEYS = [...EXISTING_ROLE_KEYS, ...NEW_ROLES.map((role) => role.roleKey)];
const SYSTEM_PRESSURES = [
  "朝廷限期催报，地方执行必须在速度、复核与民生之间留下可审计记录。",
  "京师追问田契副本去向，任何秘密转移都会增加御前疑心。",
  "粮价与银路同时波动，公开市场要求六方给出可核验的库存和责任口径。",
  "暗账线索外泄，证人安全、原件保管和接触记录同时承压。",
  "相互弹劾进入京师视野，所有指控必须绑定命令、账册或证词。",
  "御前要求一份能交叉核验的最终奏报，删节与矛盾都会留下痕迹。",
  "裁决前停止新增缓冲，六方只能以此前六轮真实行动和证据自辩。"
];

const stagesDocument = withVersion(readJson(join(sourceRoot, "stages.json")));
const roleContentDocument = withVersion(readJson(join(sourceRoot, "role-stage-content.json")));
const maneuverDocument = withVersion(readJson(join(sourceRoot, "maneuver-strategies.json")));
const reactionDocument = withVersion(readJson(join(sourceRoot, "reaction-scenarios.json")));
const systemDocument = withVersion(readJson(join(sourceRoot, "system-actions.json")));
const policyDocument = withVersion(readJson(join(sourceRoot, "agent-policies.json")));
const resultDocument = withVersion(readJson(join(sourceRoot, "result-rules.json")));
const endingDocument = withVersion(readJson(join(sourceRoot, "ending-rules.json")));

for (const [stageIndex, stage] of stagesDocument.stages.entries()) {
  const stageNumber = stage.stageNumber;
  const nextStateKey = stage.nextStateKey;
  const commonAssetKey = stage.commonContest.assetKey;
  stage.playableRoleKeys = [...ALL_ROLE_KEYS];
  stage.systemRoleKey = WORLD_ACTOR_KEY;
  stage.minimumDistinctPlayableInfluenceSources = ALL_ROLE_KEYS.length;
  stage.commonContest.description = stage.commonContest.description.replace("三名官员", "六方角色").replace("三方", "六方");

  const systemAsset = stage.assetCatalog.find((asset) => asset.kind === "SYSTEM_RESOURCE");
  const oldSystemAssetKey = systemAsset.assetKey;
  const newSystemAssetKey = oldSystemAssetKey.replace("merchant_system_resource", "court_pressure_system_resource");
  systemAsset.assetKey = newSystemAssetKey;
  systemAsset.initialOwnerRoleKey = WORLD_ACTOR_KEY;

  const systemAction = systemDocument.systemActions.find((action) => action.stageKey === stage.stageKey);
  systemAction.roleKey = WORLD_ACTOR_KEY;
  systemAction.visiblePressure = SYSTEM_PRESSURES[stageIndex];
  for (const mutation of systemAction.assetMutations) {
    if (mutation.assetKey === oldSystemAssetKey) mutation.assetKey = newSystemAssetKey;
    if (mutation.toRoleKey === "merchant") mutation.toRoleKey = WORLD_ACTOR_KEY;
  }

  const publicRule = resultDocument.publicStageRules.find((rule) => rule.stageKey === stage.stageKey);
  for (const [newRoleIndex, role] of NEW_ROLES.entries()) {
    const roleIndex = EXISTING_ROLE_KEYS.length + newRoleIndex;
    const roleAssetKey = `asset_s${stageNumber}_${role.id}_${role.assetSlug}`;
    const fallbackActionKey = `fallback_s${stageNumber}_${role.id}_preserve_position`;
    const fallbackFactKey = `fact_s${stageNumber}_${role.id}_fallback_preserve_position`;
    const targets = [1, 2, 3].map((offset) => ALL_ROLE_KEYS[(roleIndex + offset) % ALL_ROLE_KEYS.length]);
    stage.assetCatalog.push({ assetKey: roleAssetKey, kind: "ROLE_LEVERAGE", initialOwnerRoleKey: role.roleKey });
    stage.factCatalog.push({ factKey: fallbackFactKey, visibility: "PRIVATE" });

    const cards = role.actions[stageIndex].map(([slug, title], actionIndex) => {
      const actionKey = `main_s${stageNumber}_${role.id}_${slug}`;
      const factKey = `fact_s${stageNumber}_${role.id}_${slug}`;
      const traceKey = `trace_s${stageNumber}_${role.id}_${slug}`;
      const targetRoleKey = targets[actionIndex];
      const visibility = ["OBSERVABLE", "LIMITED", "PUBLIC"][actionIndex];
      const risk = ["NORMAL", "HIGH", "NORMAL"][actionIndex];
      stage.factCatalog.push({ factKey, visibility });
      stage.traceCatalog.push({ traceKey, description: `${role.roleName}在“${stage.title}”中执行“${title}”，并留下可核验记录。` });
      publicRule.candidateFactKeys.push(factKey);
      return {
        actionKey,
        title,
        objective: `${role.roleName}围绕“${stage.title}”执行“${title}”，以控制${role.concern}带来的风险。`,
        visibility,
        risk,
        fallbackActionKey,
        targetRoleKey,
        receipt: { receiptKey: `receipt_${actionKey}`, text: `${title}已经登记，相关记录将影响${ALL_ROLE_KEYS.includes(targetRoleKey) ? "另一方角色" : "本阶段"}的后续判断。` },
        effect: {
          effectKey: `effect_${actionKey}`,
          factKeys: [factKey],
          influenceEdges: [{ affectedRoleKey: targetRoleKey, effectKey: `influence_${actionKey}_to_${targetRoleKey}`, visibility }],
          observableTraceKeys: [traceKey],
          interactionRequestKeys: [],
          nextStateKey
        },
        assetMutations: [{
          assetKey: actionIndex === 1 ? commonAssetKey : roleAssetKey,
          mutationType: actionIndex === 1 ? "CLAIM" : actionIndex === 2 ? "SPEND" : "SET_STATE",
          delta: actionIndex === 1 ? 1 : actionIndex === 2 ? -1 : 0,
          toRoleKey: actionIndex === 2 ? null : role.roleKey
        }]
      };
    });

    roleContentDocument.roleStages.push({
      stageKey: stage.stageKey,
      roleKey: role.roleKey,
      privateBrief: `${stage.title}使${role.concern}成为六方争夺的关键；你的记录既能保护自己，也可能改变全局责任。`,
      personalPressure: `必须在本阶段保住${role.assetLabel}的可信度，同时避免证据被任何一方单独控制。`,
      mainCards: cards
    });
    maneuverDocument.maneuverStrategies.push({
      maneuverStrategyKey: `maneuver_s${stageNumber}_${role.id}_verify_${role.assetSlug}`,
      stageKey: stage.stageKey,
      roleKey: role.roleKey,
      title: `核验${stage.title}中的${role.assetLabel}`,
      objective: `使用${role.assetLabel}交叉检查${stage.title}的公开口径，并保留独立复核能力。`,
      allowedTargetRoleKeys: [targets[0]],
      leverageAssetKeys: [roleAssetKey, commonAssetKey],
      allowedTypes: ["INVESTIGATE", "LEVERAGE"],
      fallbackActionKey
    });
    policyDocument.policies.push({
      stageKey: stage.stageKey,
      roleKey: role.roleKey,
      policyVersion: `${CONTENT_VERSION}:s${stageNumber}:${role.id}:v1`,
      goals: cards.slice(0, 2).map((card, index) => ({ goalKey: `goal_${card.actionKey}`, weight: 100 - index * 20 })),
      riskProfile: role.riskProfile,
      assetPriority: [roleAssetKey, commonAssetKey],
      actionWeights: cards.map((card, index) => ({ actionKey: card.actionKey, weight: [100, 80, 65][index] })),
      fallbackBySlot: { MAIN: fallbackActionKey, MANEUVER: "PASS" }
    });
    policyDocument.fallbackActions.push({
      actionKey: fallbackActionKey,
      stageKey: stage.stageKey,
      roleKey: role.roleKey,
      actionSlot: "MAIN",
      objective: `在${stage.title}中保全${role.assetLabel}和角色自主性，不替角色交出、销毁或伪造关键材料。`,
      factKeys: [fallbackFactKey],
      nextStateKey,
      assetMutations: [{ assetKey: roleAssetKey, mutationType: "SET_STATE", delta: 0, toRoleKey: role.roleKey }]
    });
    resultDocument.personalStageRules.push({
      ruleKey: `personal_result_s${stageNumber}_${role.id}`,
      stageKey: stage.stageKey,
      roleKey: role.roleKey,
      candidateFactKeys: cards.map((card) => card.effect.factKeys[0]),
      summary: `${role.roleName}在${stage.title}中的选择决定了${role.assetLabel}最终是证据、筹码还是个人风险。`
    });
  }
}

for (const role of NEW_ROLES) {
  endingDocument.personalEndingRules.push({
    ruleKey: `personal_ending_${role.id}_${CONTENT_VERSION}`,
    roleKey: role.roleKey,
    metric: "SEALED_ACTIONS_PLUS_MANEUVERS_PLUS_AUTHORIZED_INFLUENCES",
    evidenceStageRange: [1, 6],
    classifications: [
      { endingKey: `personal_${role.id}_s`, title: `${role.roleName}的证据与选择改变了御前裁决`, minimumScore: 14 },
      { endingKey: `personal_${role.id}_a`, title: `${role.roleName}守住关键位置并承担代价`, minimumScore: 11 },
      { endingKey: `personal_${role.id}_b`, title: `${role.roleName}保全自身但失去部分主动`, minimumScore: 8 },
      { endingKey: `personal_${role.id}_c`, title: `${role.roleName}在清算中失去可信度`, minimumScore: 0 }
    ]
  });
}

const dataArtifacts = {
  "stages.json": stagesDocument,
  "role-stage-content.json": roleContentDocument,
  "maneuver-strategies.json": maneuverDocument,
  "reaction-scenarios.json": reactionDocument,
  "system-actions.json": systemDocument,
  "agent-policies.json": policyDocument,
  "result-rules.json": resultDocument,
  "ending-rules.json": endingDocument
};
const schemaNames = ["manifest", "stages", "role-stage-content", "maneuver-strategies", "reaction-scenarios", "system-actions", "agent-policies", "result-rules", "ending-rules", "strategy-registry"];
const schemaArtifacts = Object.fromEntries(schemaNames.map((name) => [
  `schemas/${name}.schema.json`,
  withVersion(readJson(join(sourceRoot, "schemas", `${name}.schema.json`)))
]));
const artifacts = { ...dataArtifacts, ...schemaArtifacts };

mkdirSync(join(outputRoot, "schemas"), { recursive: true });
const files = [];
for (const [relativePath, value] of Object.entries(artifacts)) {
  const bytes = json(value);
  writeFileSync(join(outputRoot, relativePath), bytes, "utf8");
  files.push({ path: relativePath, sha256: sha256(bytes) });
}
const manifest = {
  schemaVersion: "continuous_strategy_manifest_v1",
  contentVersion: CONTENT_VERSION,
  templateKey: "sangtian",
  releaseStatus: "published",
  stageCoverage: [1, 2, 3, 4, 5, 6, 7],
  files
};
const manifestBytes = json(manifest);
writeFileSync(join(outputRoot, "manifest.json"), manifestBytes, "utf8");

const registryPath = join(worldRoot, "strategy-registry.json");
const registry = readJson(registryPath);
registry.defaultStrategyVersion = CONTENT_VERSION;
registry.strategies[CONTENT_VERSION] = {
  artifactDirectory: "continuous-strategy-v1.2",
  manifestSha256: sha256(manifestBytes),
  status: "published"
};
writeFileSync(registryPath, json(registry), "utf8");

console.log(JSON.stringify({
  status: "GENERATED",
  contentVersion: CONTENT_VERSION,
  roles: ALL_ROLE_KEYS.length,
  roleStages: roleContentDocument.roleStages.length,
  mainCards: roleContentDocument.roleStages.flatMap((entry) => entry.mainCards).length,
  maneuverStrategies: maneuverDocument.maneuverStrategies.length,
  personalStageRules: resultDocument.personalStageRules.length,
  personalEndings: endingDocument.personalEndingRules.length,
  manifestSha256: registry.strategies[CONTENT_VERSION].manifestSha256
}, null, 2));
