import { readdir } from "node:fs/promises";
import { resolve } from "node:path";
import {
  computeImmutableHash,
  readJson,
  repoRoot,
  validateWithSchema,
  writeJson,
} from "./lib/contract-utils.mjs";

const RELEASE_VERSION = "sangtian-part-one-authoring-v1.3.0";
const EVIDENCE_RELEASE_ID = "sangtian-part-one-evidence-v1.0.0";
const authoringRoot = resolve(repoRoot, "packages/templates/authoring/sangtian");
const approvedMechanismRoot = resolve(authoringRoot, "mechanisms/approved/part-01-v3");
const outputRoot = resolve(process.env.SANGTIAN_AUTHORING_OUTPUT_ROOT || resolve(authoringRoot, "runtime-assets", RELEASE_VERSION));
const runtimePackagePath = resolve(process.env.SANGTIAN_RUNTIME_PACKAGE_PATH || resolve(repoRoot, "packages/templates/config/sangtian/story-package/part-one-runtime.json"));
const skipSourceWrites = process.env.SANGTIAN_SKIP_SOURCE_WRITES === "1";
const reviewSet = await readJson(resolve(authoringRoot, "reviews/track-b-and-adaptation-v3/review-set.json"));
const adaptationSet = await readJson(resolve(authoringRoot, "adaptation/approved/part-01-v3.adaptation-decisions.json"));
const styleProfile = await readJson(resolve(authoringRoot, "narrative/style-profile.approved.json"));
const narrativeScenePatternSet = await readJson(resolve(authoringRoot, "narrative/scene-patterns.section-01.approved.json"));
const requirementSet = await readJson(resolve(authoringRoot, "requirements/part-01.requirements.json"));
const worldStart = await readJson(resolve(authoringRoot, "world-start.json"));
const coreStateSchema = await readJson(resolve(authoringRoot, "core-state.schema.json"));

if (reviewSet.verdict !== "PASS" || reviewSet.reviewCount !== 19 || reviewSet.providerCallCount !== 19) {
  throw new Error("T3 compilation blocked: Track B/Adaptation review set is not a complete PASS");
}
if (adaptationSet.adaptations.length !== 7 || adaptationSet.adaptations.some((item) => item.reviewStatus !== "APPROVED")) {
  throw new Error("T3 compilation blocked: all seven Adaptation Decisions must be approved");
}
const styleValidation = await validateWithSchema("narrative-style-profile-v1", styleProfile);
if (!styleValidation.valid || String(styleProfile.version).includes("draft") || String(styleProfile.reviewerId).startsWith("PENDING")) {
  throw new Error("T3 compilation blocked: NarrativeStyleProfile is not approved");
}
const narrativePatternValidation = await validateWithSchema("narrative-scene-pattern-set-v1", narrativeScenePatternSet);
if (!narrativePatternValidation.valid) {
  throw new Error(`T3 compilation blocked: NarrativeScenePatternSet is invalid: ${JSON.stringify(narrativePatternValidation.errors)}`);
}
if (narrativeScenePatternSet.worldId !== "sangtian" || narrativeScenePatternSet.scopeId !== "PART-01/SEC-P1-01") {
  throw new Error("T3 compilation blocked: NarrativeScenePatternSet has the wrong story scope");
}
if (narrativeScenePatternSet.patterns.length !== 3 || narrativeScenePatternSet.patterns.some((item) => item.reviewStatus !== "APPROVED")) {
  throw new Error("T3 compilation blocked: the three Section One NarrativeScenePatterns must be approved");
}

const approvedMechanisms = [];
for (const name of (await readdir(approvedMechanismRoot)).filter((entry) => entry.endsWith(".json") && entry !== "manifest.json").sort()) {
  const mechanism = await readJson(resolve(approvedMechanismRoot, name));
  const validation = await validateWithSchema("gameplay-mechanism-candidate-v1", mechanism);
  if (!validation.valid || mechanism.status !== "APPROVED_FOR_T3") throw new Error(`${mechanism.mechanismCandidateId} is not approved for T3`);
  approvedMechanisms.push(mechanism);
}
if (approvedMechanisms.length !== 12) throw new Error(`Expected 12 approved mechanisms, found ${approvedMechanisms.length}`);
const mechanismByRequirement = new Map(approvedMechanisms.flatMap((item) => item.requirementIds.map((id) => [id, item])));
const approvedAdaptationIds = new Set(adaptationSet.adaptations.map((item) => item.adaptationDecisionId));

const kernelOptions = {
  "DK-P1-EXECUTION-SCOPE": [
    ["限定试办", "只准清流县先办一批，并在给巡抚的改桑放行回文里写明：不得趁急难压价买田。", "actor.zhejiang_xunfu", "附条件签发", "用较慢的进度换取民田保护与可复核边界", ["reform.executionMode", "reform.scopeStatus", "land.safeguardStatus"]],
    ["先行放开", "按巡抚所请先放行改桑，同时限三日补齐复核册和经手名册。", "actor.zhejiang_xunfu", "限期补正", "先保进度，但错误可能先成为既成事实", ["reform.executionMode", "reform.progress", "responsibility.xunfuExposure"]],
    ["暂缓封册", "暂不签放行文书，先封存清流县档房；若误了三日期限，由总督自行担责。", "actor.qingliu_magistrate", "先保全证据", "证据更安全，朝廷与粮价压力立即上升", ["reform.executionMode", "evidence.archiveSealStatus", "responsibility.governorExposure"]],
  ],
  "DK-P1-REVIEW-INITIATION": [
    ["总督先封", "派总督亲随持令封存原册，县令和巡抚各出一名见证。", "actor.qingliu_magistrate", "异地见证封存", "保管链较强，但会立刻惊动巡抚一方", ["review.initiationStatus", "evidence.chainStatus", "evidence.primaryCustodianRef"]],
    ["督抚同查", "请巡抚共同下文启动复核，任何抄件都由双方经手人具名。", "actor.zhejiang_xunfu", "共同复核", "程序更稳，但巡抚同时取得材料入口", ["review.initiationStatus", "review.authority", "relations.governorXunfu"]],
    ["县令自查", "令清流县令连夜自查并送样册，总督府暂不派人接管档房。", "actor.qingliu_magistrate", "限期自查", "动作隐蔽，却把首轮保管风险留在县衙", ["review.initiationStatus", "witness.accessStatus", "evidence.chainStatus"]],
  ],
  "DK-P1-RESPONSIBILITY-RECORD": [
    ["要求联署", "将当前改桑执行边界、复核办法与督抚各自责任写入正式回文，请巡抚共同具名。", "actor.zhejiang_xunfu", "共同具名", "共同承担能换来合作，也会模糊日后分歧", ["responsibility.firstRecordStatus", "responsibility.governorExposure", "responsibility.xunfuExposure"]],
    ["总督单署", "由总督单独具名写明当前改桑执行边界，并把巡抚催办原文作为附件留档。", "actor.zhejiang_xunfu", "单独具名并附原文", "责任集中，但保留了催办来源", ["responsibility.firstRecordStatus", "responsibility.governorExposure"]],
    ["记明异议", "另具正式回文暂准放行，并逐项写明督抚分歧和各自承担的事项。", "actor.zhejiang_xunfu", "分项责任记录", "关系转冷，但后续不易互相改口", ["responsibility.firstRecordStatus", "relations.governorXunfu", "reform.executionMode", "reform.progress"]],
  ],
  "DK-P1-EVIDENCE-CUSTODY": [
    ["原件封存", "原册留在档房，换新封条；总督、县令、巡抚三方各留封样。", "evidence.qingliu_register_anomaly", "多方封样", "原件少移动，但三方都知道调查已开始", ["evidence.chainStatus", "evidence.archiveSealStatus", "evidence.primaryCustodianRef"]],
    ["制作副本", "在两名见证人在场时抄出样册，逐页记下抄录人与时辰。", "actor.reform_clerk", "见证抄录", "可保留第二条链，但书吏暴露为关键证人", ["evidence.copyStatus", "witness.accessStatus", "knowledgeTransfers"]],
    ["移交总督府", "把可疑册页整封送往总督府，县衙只留交接清单。", "evidence.qingliu_register_anomaly", "整封移交", "总督控制原件，也承担途中和保管责任", ["evidence.primaryCustodianRef", "evidence.chainStatus", "responsibility.governorExposure"]],
  ],
  "DK-P1-WITNESS-ACCESS": [
    ["秘密保护", "以核对公文为名把书吏带到总督府，不公开其证人身份。", "actor.reform_clerk", "秘密转移保护", "证人较安全，但巡抚可能指责总督私扣经手人", ["witness.accessStatus", "relations.governorXunfu"]],
    ["共同问话", "让督抚双方各派一人在场，当面对照书吏说法和样册。", "actor.reform_clerk", "共同询问", "证词程序更强，却会把线索同时暴露给对方", ["witness.accessStatus", "knowledgeTransfers", "evidence.chainStatus"]],
    ["先取密供", "让县令先收一份封缄书面供述，再决定是否传人。", "actor.qingliu_magistrate", "书面密供", "保留初始说法，但真实性和自愿性仍需复核", ["witness.accessStatus", "evidence.copyStatus"]],
  ],
  "DK-P1-REVIEW-AUTHORITY": [
    ["总督主持", "由总督府定复核清单，巡抚和县令只能派见证人参加。", "institution.zhejiang_governor_yamen", "总督主持复核", "解释权集中，越权与拖延指责随之上升", ["review.authority", "review.procedureStatus", "relations.governorXunfu"]],
    ["督抚共审", "设共同复核案，每次开册和抄录都须双方经手人同时具名。", "actor.zhejiang_xunfu", "共同主持", "程序互相制约，但任何一步都可能被对方拖住", ["review.authority", "review.procedureStatus"]],
    ["县级初核", "先由县令按总督列出的项目初核，督抚只审其结果和原件。", "actor.qingliu_magistrate", "分层复核", "节省时间，却给县衙留下整理材料的空间", ["review.authority", "review.procedureStatus", "evidence.chainStatus"]],
  ],
  "DK-P1-DISCLOSURE-SCOPE": [
    ["只报异常", "只向巡抚说明册页存在差异，不透露书吏和密供位置。", "actor.zhejiang_xunfu", "有限披露", "保住证人与入口，却降低共同复核的信任", ["knowledgeTransfers", "relations.governorXunfu"]],
    ["共享样册", "把带见证记录的样册交巡抚查验，原件仍由现保管人封存。", "actor.zhejiang_xunfu", "共享副本", "提高程序合作，也扩大线索泄露面", ["knowledgeTransfers", "evidence.copyStatus"]],
    ["暂不外泄", "以保管链未稳为由拒绝披露细节，只承诺限时提交复核结果。", "actor.zhejiang_xunfu", "保密并承诺期限", "减少毁证机会，却会被当作独占调查", ["relations.governorXunfu", "responsibility.governorExposure"]],
  ],
  "DK-P1-GRAIN-SOURCE": [
    ["官府借调", "先动官仓并向邻省借粮，所有借据由总督府承担。", "resource.official_grain", "官府借调", "不让商会取得政策入口，但财政与偿还责任加重", ["grain.officialStockStatus", "grain.reliefChannel", "responsibility.governorExposure"]],
    ["商会开仓", "准商会限量开仓，换取官府担保，但不得以粮价换购灾民田地。", "actor.jiangnan_merchant_head", "附条件商粮", "粮食来得快，商会同时获得官府信用", ["grain.reliefChannel", "merchant.entryStatus", "land.safeguardStatus"]],
    ["官商并用", "官仓先稳城内，商会负责外县运输，两路账目分开核销。", "actor.jiangnan_merchant_head", "双渠道救急", "风险分散，但核销和监管更复杂", ["grain.reliefChannel", "merchant.entryStatus", "evidence.chainStatus"]],
  ],
  "DK-P1-RELIEF-PRIORITY": [
    ["先保无粮户", "把现粮优先发给无存粮和无地可抵的百姓。", "resource.official_grain", "按生计风险赈济", "能减轻卖田压力，却可能耽误春种和城内供应", ["grain.immediatePressure", "land.riskLevel"]],
    ["先保种粮", "先留下种粮和插秧所需，再按户发放余粮。", "actor.qingliu_magistrate", "保生产再赈济", "明年风险较低，眼前挨饿者会更多", ["grain.immediatePressure", "land.riskLevel"]],
    ["先稳要地", "先稳杭州和清流县米市，再向外围灾村分批送粮。", "resource.official_grain", "分区压价", "能压住政治中心，外围百姓承担更长等待", ["grain.immediatePressure", "responsibility.governorExposure"]],
  ],
  "DK-P1-MERCHANT-CONDITIONS": [
    ["粮可入、田不可买", "接受商会粮食和运力，但灾期不得收购或代持民田。", "actor.jiangnan_merchant_head", "限定交易边界", "商会可能缩减粮量，土地风险较低", ["merchant.entryStatus", "merchant.grantedRights", "land.safeguardStatus"]],
    ["只买运输", "官府按程付银，只用商会船队，不给收丝或购田优先权。", "actor.jiangnan_merchant_head", "购买单项服务", "权利边界清楚，但官府要立即筹银", ["merchant.entryStatus", "merchant.grantedRights", "responsibility.governorExposure"]],
    ["拒绝商会条件", "拒绝商会担保和优先权，改走官府借调粮路。", "actor.jiangnan_merchant_head", "拒绝交易", "避免官商绑定，粮价压力短期继续上升", ["merchant.entryStatus", "grain.reliefChannel", "grain.immediatePressure"]],
  ],
  "DK-P1-LAND-SAFEGUARD": [
    ["设田价底线", "灾期成交不得低于公开底价，县衙逐契登记买受人。", "actor.qingliu_magistrate", "价格与买受人监管", "压低兼并风险，却可能让急需粮钱的百姓更难成交", ["land.safeguardStatus", "land.riskLevel", "evidence.chainStatus"]],
    ["暂禁购田", "赈期内禁止商会和大户购入灾民田，先用借粮维持。", "actor.jiangnan_merchant_head", "灾期禁购", "土地最安全，但商粮和改桑资金可能撤回", ["land.safeguardStatus", "merchant.grantedRights", "grain.immediatePressure"]],
    ["分散指标", "把改桑指标分到更多非灾县，清流只承担有限份额。", "actor.zhejiang_xunfu", "跨县分摊", "减轻一县卖田压力，却扩大执行协调和政治阻力", ["reform.scopeStatus", "land.riskLevel", "relations.governorXunfu"]],
  ],
  "DK-P1-REPORT-AUTHORSHIP": [
    ["督抚联署", "逐项写明执行、复核和粮食分歧，双方确认后共同具名入京。", "actor.zhejiang_xunfu", "共同奏报", "分量较重，但为达成文本可能弱化争议", ["report.authorshipMode", "responsibility.governorExposure", "responsibility.xunfuExposure"]],
    ["总督单奏", "由总督独自具名，把巡抚催办和拒签文书一并列为附件。", "institution.zhejiang_governor_yamen", "单方奏报", "叙述完整可控，也把主要责任集中到总督", ["report.authorshipMode", "report.firstNarrativeController", "responsibility.governorExposure"]],
    ["各自上报", "允许巡抚另报，总督同时送出自己的复核结果和异议。", "actor.zhejiang_xunfu", "分裂奏报", "京师会更早看见公开冲突，双方都难再退回私下妥协", ["report.authorshipMode", "report.firstNarrativeController", "relations.governorXunfu"]],
  ],
  "DK-P1-RESPONSIBILITY-SCOPE": [
    ["总督担全责", "奏报写明执行与复核均由总督裁定，不把责任推给县令。", "institution.zhejiang_governor_yamen", "集中责任", "保护下属和程序，自己成为主要问责对象", ["responsibility.governorExposure", "responsibility.xunfuExposure"]],
    ["督抚分项负责", "改桑进度由巡抚具名，复核和赈济由总督具名。", "actor.zhejiang_xunfu", "按事项分责", "责任清楚，但对立被正式写入奏报", ["responsibility.governorExposure", "responsibility.xunfuExposure", "relations.governorXunfu"]],
    ["如实列出经手人", "把县令、书吏和各级经手事项列清，只陈事实不先定罪。", "actor.qingliu_magistrate", "经手链责任", "保留事实边界，却把更多人暴露在问责与报复之下", ["responsibility.firstRecordStatus", "witness.accessStatus", "evidence.chainStatus"]],
  ],
  "DK-P1-EVIDENCE-ATTACHMENT": [
    ["附样册与封存记录", "附带见证抄出的样册、封条记录和原件保管人名单。", "evidence.qingliu_register_anomaly", "中强度附件", "可复核性较高，相关人员和位置也随之暴露", ["report.attachmentStrength", "evidence.chainStatus", "witness.accessStatus"]],
    ["只报异常范围", "只列田亩数字和日期差异，声明原册仍在复核，不附人名推断。", "evidence.qingliu_register_anomaly", "边界化报告", "避免过早定罪，但京师可能认为证据太弱", ["report.attachmentStrength", "responsibility.governorExposure"]],
    ["先保人证", "暂不附书吏供述，只附保管链并说明人证需要保护。", "actor.reform_clerk", "保护性附件", "证人较安全，奏报说服力和速度下降", ["report.attachmentStrength", "witness.accessStatus"]],
  ],
  "DK-P1-CAPITAL-CHANNEL": [
    ["走正式通政渠道", "按正式渠道递送奏报，逐站记录交接和到达时辰。", "resource.official_document_channel", "正式递送", "程序最稳，但中介和时间更难控制", ["report.dispatchStatus", "knowledgeTransfers"]],
    ["加封急递", "用总督封印加急送达指定上级，保留副本和交接回执。", "resource.official_document_channel", "封缄急递", "速度更快，也会被解释为绕过常规渠道", ["report.dispatchStatus", "responsibility.governorExposure", "knowledgeTransfers"]],
    ["双路互证", "正本走正式渠道，摘要另走密奏；两份互列封号，不让内容悄然替换。", "resource.official_document_channel", "双路校验", "较难截断，却会放大政治敏感和泄露面", ["report.dispatchStatus", "report.firstNarrativeController", "evidence.chainStatus"]],
  ],
};

// A Writer may describe consequences, but it may not decide canonical state.
// Each authored affordance therefore carries an explicit deterministic patch
// that the server applies before the one DeepSeek call for the resulting turn.
const kernelStatePatches = {
  "DK-P1-EXECUTION-SCOPE": [
    { "reform.executionMode": "LIMITED_TRIAL", "reform.scopeStatus": "QINGLIU_ONLY", "land.safeguardStatus": "WRITTEN_NO_DISTRESS_PURCHASE" },
    { "reform.executionMode": "PROVISIONAL_RELEASE", "reform.progress": "STARTED", "responsibility.xunfuExposure": { $delta: 1 } },
    { "reform.executionMode": "TEMPORARILY_PAUSED", "evidence.archiveSealStatus": "SEAL_ORDERED", "responsibility.governorExposure": { $delta: 1 } },
  ],
  "DK-P1-REVIEW-INITIATION": [
    { "review.initiationStatus": "GOVERNOR_SEAL_ORDERED", "evidence.chainStatus": "TRACEABLE", "evidence.primaryCustodianRef": "actor.qingliu_magistrate" },
    { "review.initiationStatus": "JOINT_REVIEW_ORDERED", "review.authority": "JOINT", "relations.governorXunfu": { $delta: 1 } },
    { "review.initiationStatus": "COUNTY_SELF_REVIEW_ORDERED", "witness.accessStatus": "COUNTY_CONTROLLED", "evidence.chainStatus": "FRAGILE" },
  ],
  "DK-P1-RESPONSIBILITY-RECORD": [
    { "responsibility.firstRecordStatus": "JOINT_SIGNATURE_REQUESTED", "responsibility.governorExposure": { $delta: 1 }, "responsibility.xunfuExposure": { $delta: 1 } },
    { "responsibility.firstRecordStatus": "GOVERNOR_SIGNED_WITH_ATTACHMENT", "responsibility.governorExposure": { $delta: 2 } },
    { "responsibility.firstRecordStatus": "DISAGREEMENT_RECORDED", "relations.governorXunfu": { $delta: -1 }, "reform.executionMode": "PROVISIONAL_RELEASE", "reform.progress": "STARTED" },
  ],
  "DK-P1-EVIDENCE-CUSTODY": [
    { "evidence.chainStatus": "TRACEABLE", "evidence.archiveSealStatus": "SEALED_WITH_THREE_SAMPLES", "evidence.primaryCustodianRef": "actor.qingliu_magistrate" },
    { "evidence.copyStatus": "WITNESSED_COPY_CREATED", "witness.accessStatus": "EXPOSED_AS_KEY_WITNESS", knowledgeTransfer: { topic: "witnessed_register_copy", senderRef: "actor.qingliu_magistrate", recipientRef: "actor.zhejiang_governor", status: "DELIVERED" } },
    { "evidence.primaryCustodianRef": "institution.zhejiang_governor_yamen", "evidence.chainStatus": "FRAGILE", "responsibility.governorExposure": { $delta: 1 } },
  ],
  "DK-P1-WITNESS-ACCESS": [
    { "witness.accessStatus": "PROTECTED_SECRETLY", "relations.governorXunfu": { $delta: -1 } },
    { "witness.accessStatus": "JOINTLY_QUESTIONED", "evidence.chainStatus": "TRACEABLE", knowledgeTransfer: { topic: "clerk_testimony_scope", senderRef: "actor.reform_clerk", recipientRef: "actor.zhejiang_xunfu", status: "DELIVERED" } },
    { "witness.accessStatus": "SEALED_STATEMENT_HELD", "evidence.copyStatus": "SEALED_STATEMENT_ONLY" },
  ],
  "DK-P1-REVIEW-AUTHORITY": [
    { "review.authority": "GOVERNOR", "review.procedureStatus": "GOVERNOR_LED_WITH_WITNESSES", "relations.governorXunfu": { $delta: -1 } },
    { "review.authority": "JOINT", "review.procedureStatus": "DUAL_SIGNATURE_REQUIRED" },
    { "review.authority": "COUNTY_FIRST", "review.procedureStatus": "LAYERED_REVIEW", "evidence.chainStatus": "FRAGILE" },
  ],
  "DK-P1-DISCLOSURE-SCOPE": [
    { "relations.governorXunfu": { $delta: -1 }, knowledgeTransfer: { topic: "register_anomaly_only", senderRef: "actor.zhejiang_governor", recipientRef: "actor.zhejiang_xunfu", status: "DELIVERED" } },
    { "evidence.copyStatus": "SHARED_WITNESSED_COPY", knowledgeTransfer: { topic: "witnessed_register_copy", senderRef: "actor.zhejiang_governor", recipientRef: "actor.zhejiang_xunfu", status: "DELIVERED" } },
    { "relations.governorXunfu": { $delta: -2 }, "responsibility.governorExposure": { $delta: 1 } },
  ],
  "DK-P1-GRAIN-SOURCE": [
    { "grain.officialStockStatus": "MOBILIZED_AND_BORROWING", "grain.reliefChannel": "OFFICIAL", "responsibility.governorExposure": { $delta: 1 } },
    { "grain.reliefChannel": "MERCHANT_CONDITIONAL", "merchant.entryStatus": "CONDITIONAL", "land.safeguardStatus": "NO_GRAIN_FOR_LAND" },
    { "grain.reliefChannel": "DUAL_CHANNEL", "merchant.entryStatus": "CONDITIONAL", "evidence.chainStatus": "TRACEABLE" },
  ],
  "DK-P1-RELIEF-PRIORITY": [
    { "grain.immediatePressure": "RELIEVED_FOR_HUNGRIEST", "land.riskLevel": "CONTAINED_BUT_PRESENT" },
    { "grain.immediatePressure": "ACUTE_FOR_LANDLESS", "land.riskLevel": "MEDIUM" },
    { "grain.immediatePressure": "SHIFTED_TO_OUTLYING_VILLAGES", "responsibility.governorExposure": { $delta: 1 } },
  ],
  "DK-P1-MERCHANT-CONDITIONS": [
    { "merchant.entryStatus": "CONDITIONAL", "merchant.grantedRights": ["GRAIN_AND_TRANSPORT_ONLY"], "land.safeguardStatus": "DISTRESS_PURCHASE_BANNED" },
    { "merchant.entryStatus": "CONDITIONAL", "merchant.grantedRights": ["TRANSPORT_SERVICE_ONLY"], "responsibility.governorExposure": { $delta: 1 } },
    { "merchant.entryStatus": "REJECTED", "grain.reliefChannel": "OFFICIAL_ONLY", "grain.immediatePressure": "RISING_FAST" },
  ],
  "DK-P1-LAND-SAFEGUARD": [
    { "land.safeguardStatus": "PUBLIC_PRICE_FLOOR", "land.riskLevel": "MEDIUM", "evidence.chainStatus": "TRACEABLE" },
    { "land.safeguardStatus": "TEMPORARY_PURCHASE_BAN", "merchant.grantedRights": [], "grain.immediatePressure": "RISING" },
    { "reform.scopeStatus": "DISTRIBUTED_ACROSS_COUNTIES", "land.riskLevel": "DISTRIBUTED_MEDIUM", "relations.governorXunfu": { $delta: -1 } },
  ],
  "DK-P1-REPORT-AUTHORSHIP": [
    { "report.authorshipMode": "JOINT", "report.firstNarrativeController": "GOVERNOR_AND_XUNFU", "responsibility.governorExposure": { $delta: 1 }, "responsibility.xunfuExposure": { $delta: 1 } },
    { "report.authorshipMode": "GOVERNOR_SOLE", "report.firstNarrativeController": "GOVERNOR", "responsibility.governorExposure": { $delta: 2 } },
    { "report.authorshipMode": "SPLIT", "report.firstNarrativeController": "CONTESTED", "relations.governorXunfu": { $delta: -2 } },
  ],
  "DK-P1-EVIDENCE-ATTACHMENT": [
    { "report.attachmentStrength": "WITNESSED_COPY_AND_CUSTODY_RECORD", "evidence.chainStatus": "TRACEABLE", "witness.accessStatus": "DISCLOSED_IN_ATTACHMENT" },
    { "report.attachmentStrength": "ANOMALY_SCOPE_ONLY", "responsibility.governorExposure": { $delta: 1 } },
    { "report.attachmentStrength": "CUSTODY_RECORD_WITHHELD_TESTIMONY", "witness.accessStatus": "PROTECTED_FROM_REPORT" },
  ],
  "DK-P1-RESPONSIBILITY-SCOPE": [
    { "responsibility.governorExposure": { $delta: 3 }, "responsibility.xunfuExposure": 0 },
    { "responsibility.governorExposure": { $delta: 1 }, "responsibility.xunfuExposure": { $delta: 2 }, "relations.governorXunfu": { $delta: -1 } },
    { "responsibility.firstRecordStatus": "HANDLER_CHAIN_LISTED_WITHOUT_CONVICTION", "witness.accessStatus": "NAMED_AS_HANDLER", "evidence.chainStatus": "TRACEABLE" },
  ],
  "DK-P1-CAPITAL-CHANNEL": [
    { "report.dispatchStatus": "DISPATCHED", knowledgeTransfer: { topic: "first_report_formal_channel", senderRef: "actor.zhejiang_governor", recipientRef: "institution.capital_official_channel", status: "SENT" } },
    { "report.dispatchStatus": "DISPATCHED", "responsibility.governorExposure": { $delta: 1 }, knowledgeTransfer: { topic: "first_report_sealed_expedited", senderRef: "actor.zhejiang_governor", recipientRef: "institution.capital_named_superior", status: "SENT" } },
    { "report.dispatchStatus": "SPLIT", "report.firstNarrativeController": "DUAL_CHANNEL_CONTESTED", "evidence.chainStatus": "TRACEABLE" },
  ],
};

const allowedEvidenceChainStatuses = new Set(coreStateSchema.properties.evidence.properties.chainStatus.enum);
for (const [kernelId, patches] of Object.entries(kernelStatePatches)) {
  for (const [optionIndex, patch] of patches.entries()) {
    const chainStatus = patch["evidence.chainStatus"];
    if (chainStatus !== undefined && !allowedEvidenceChainStatuses.has(chainStatus)) {
      throw new Error(`Invalid evidence.chainStatus in ${kernelId} option ${optionIndex + 1}: ${chainStatus}`);
    }
  }
}

const consequencePayoffBeatsByRequirement = {
  "REQ-P1-EXECUTION-BOUNDARY": [
    {
      beatId: "PAYOFF-P1-EXECUTION-PRESSURE",
      actorRefs: ["actor.xunfu_aide"],
      action: "巡抚幕僚把三日限期和眼前粮价一并压到案前，追问为何只准清流县试办、又不许趁急难压价买田，并要总督说明这两条是否仍照办；速度之争由此变成一项可追责的当面催问。",
      requiredTermGroups: [["巡抚幕僚", "幕僚"], ["三日限期", "三日"], ["清流县试办", "压价买田", "两条", "照办"]],
      resultCeiling: "只能形成催问与责任压力；眼前粮价只能定性写成正在上涨或压力在眼前，不得换算为一日一变、每日、每时等频率；不得写成朝廷已经定罪或巡抚已经取得执行权。",
    },
    {
      beatId: "PAYOFF-P1-EXECUTION-RECORD",
      actorRefs: ["actor.xunfu_aide"],
      action: "巡抚幕僚盯住已经写进放行文书的两条边界，要求总督说明由谁具名担责；日后谁想切割责任，都必须先解释这份已经写明的边界。",
      requiredTermGroups: [
        ["巡抚幕僚", "幕僚"],
        ["改桑范围", "执行范围", "清流县试办", "清流试办", "何县试办", "划定的范围"],
        ["责任", "具名", "切割首尾", "切割干系", "切割干净", "交代"]
      ],
      resultCeiling: "巡抚幕僚只以巡抚代表身份独自加入现场；不得让巡抚本人或其他随员到场。只能把“清流县试办”和“不得趁急难压价买田”这两项已结算边界带入责任争夺；不得新增乡、里、保、亩数、田地分类、第二份文书或已经完成的签署内容。",
    },
  ],
  "REQ-P1-RESPONSIBILITY-RECORD": [
    {
      beatId: "PAYOFF-P1-RESPONSIBILITY-SIGNATURE",
      actorRefs: ["actor.xunfu_aide"],
      action: "巡抚一方当面追问谁肯在首份责任记录上具名，并把没有具名的人仍可推卸责任这一点公开摆到桌面。",
      requiredTermGroups: [["巡抚", "巡抚一方"], ["责任记录", "责任"], ["具名", "署名"]],
      resultCeiling: "只能争夺既有责任记录的署名，不得替任何一方完成签署。",
    },
    {
      beatId: "PAYOFF-P1-RESPONSIBILITY-FIRST-FRAME",
      actorRefs: ["actor.xunfu_aide"],
      action: "巡抚幕僚明言，最先送到京师且附件齐全的那份文字会先定下责任名分，督抚双方都不能再把首份记录当作内厅私议。",
      requiredTermGroups: [["巡抚幕僚", "幕僚"], ["京师", "入京"], ["首份记录", "责任名分"]],
      resultCeiling: "只能提出政治后果，不得写成京师已经收到或已经作出判断。",
    },
  ],
  "REQ-P1-XUNFU-COUNTERMOVE": [
    {
      beatId: "PAYOFF-P1-XUNFU-COUNTERMOVE",
      actorRefs: ["actor.xunfu_aide"],
      action: "巡抚幕僚依照巡抚的立场要求参加下一轮复核，并把总督此前的迟疑记作可能耽误国策的理由。",
      requiredTermGroups: [["巡抚幕僚", "幕僚"], ["参加复核", "复核"], ["耽误国策", "迟疑"]],
      resultCeiling: "只能提出参加与记责要求，不得让巡抚自动取得复核主持权。",
    },
    {
      beatId: "PAYOFF-P1-XUNFU-VISIBILITY",
      actorRefs: ["actor.xunfu_aide"],
      action: "巡抚一方要求先看已经允许披露的材料范围；若仍被排除在外，便要以拒绝协作为由另立自己的叙述。",
      requiredTermGroups: [
        ["巡抚", "巡抚一方", "抚院"],
        ["材料", "披露", "能看的", "允准披露"],
        [
          "另立",
          "叙述",
          "另具一稿",
          "另写一稿",
          "另具一份",
          "另写一份",
          "自具一稿",
          "另叙",
          "另作说法",
          "另作一说",
          "自行具文",
          "具文回话",
          "把今日情形写进去"
        ]
      ],
      resultCeiling: "只能形成公开威胁，不得写成另一份奏报已经发出。",
    },
  ],
  "REQ-P1-REGISTER-CUSTODY": [
    {
      beatId: "PAYOFF-P1-CUSTODY-CHAIN",
      actorRefs: ["actor.qingliu_magistrate", "actor.reform_clerk"],
      action: "清流县令与改桑书吏只能按现有保管记录逐项对答；原件由谁看守、副本由谁经手，开始成为任何人都绕不过去的证据链。",
      requiredTermGroups: [["清流县令", "县令"], ["改桑书吏", "书吏"], ["原件", "副本", "证据链"]],
      resultCeiling: "只能确认保管责任进入核对，不得新增县册差异或暗账内容。",
    },
    {
      beatId: "PAYOFF-P1-CUSTODY-REDUNDANCY",
      actorRefs: ["actor.qingliu_magistrate", "actor.reform_clerk"],
      action: "县令指出，原件、见证记录与已经存在的抄件若分由不同经手人保管，任何一处出问题都不能悄然抹去其余线索。",
      requiredTermGroups: [["县令", "清流县令"], ["原件", "抄件"], ["经手人", "见证"]],
      resultCeiling: "只能说明多点保管的效果，不得写成某处已经毁损或失窃。",
    },
  ],
  "REQ-P1-REVIEW-AUTHORITY": [
    {
      beatId: "PAYOFF-P1-REVIEW-ACCESS",
      actorRefs: ["actor.xunfu_aide", "actor.qingliu_magistrate"],
      action: "巡抚幕僚与清流县令围绕谁先开册、谁能在场、谁写第一轮结论当面对质，复核主持权立即变成材料入口之争。",
      requiredTermGroups: [["巡抚幕僚", "幕僚"], ["清流县令", "县令"], ["复核主持权", "先开册"]],
      resultCeiling: "只能争夺程序入口，不得写出开册后发现了什么。",
    },
    {
      beatId: "PAYOFF-P1-REVIEW-CREDIBILITY",
      actorRefs: ["actor.xunfu_aide", "actor.qingliu_magistrate"],
      action: "双方都要求把在场见证与经手方式先说清，因为这套程序日后会直接决定首份奏报能否被京师复核。",
      requiredTermGroups: [["见证", "经手"], ["首份奏报", "奏报"], ["京师复核", "复核"]],
      resultCeiling: "只能让程序可信度成为压力，不得写成奏报已经被京师采信。",
    },
  ],
  "REQ-P1-KNOWLEDGE-CHAIN": [
    {
      beatId: "PAYOFF-P1-KNOWLEDGE-ASYMMETRY",
      actorRefs: ["actor.reform_clerk", "actor.xunfu_aide"],
      action: "改桑书吏只肯说自己亲手经办的部分，巡抚幕僚却追问总督还掌握了什么；同一件县册疑问在两边形成了不对称的知识。",
      requiredTermGroups: [["改桑书吏", "书吏"], ["巡抚幕僚", "幕僚"], ["亲手经办", "掌握"]],
      resultCeiling: "只能表现知情范围不同，不得让书吏补出未经批准的新证词。",
    },
    {
      beatId: "PAYOFF-P1-KNOWLEDGE-DISCLOSURE",
      actorRefs: ["actor.xunfu_aide", "actor.reform_clerk"],
      action: "已经公开给双方的材料再也收不回私下范围；巡抚幕僚据此要求继续旁听，书吏则更谨慎地区分亲历与听闻。",
      requiredTermGroups: [["公开", "双方"], ["巡抚幕僚", "幕僚"], ["亲历", "听闻"]],
      resultCeiling: "只能使用此前已经披露的范围，不得新增材料、名单或证据。",
    },
  ],
  "REQ-P1-GRAIN-RELIEF": [
    {
      beatId: "PAYOFF-P1-GRAIN-DEBT",
      actorRefs: ["actor.qingliu_magistrate", "actor.jiangnan_merchant_head"],
      action: "县令与商会会首把救粮由谁垫付、由谁担保、由谁日后偿还摆到案前；粮一旦入局，债务和责任也随之有了经手人。",
      requiredTermGroups: [["县令", "清流县令"], ["商会会首", "会首"], ["垫付", "担保", "偿还"]],
      resultCeiling: "只能确定救粮会产生债务责任，不得新增具体粮数、银数或价格。",
    },
    {
      beatId: "PAYOFF-P1-GRAIN-LAND-PRESSURE",
      actorRefs: ["actor.qingliu_magistrate", "actor.jiangnan_merchant_head"],
      action: "清流县令警告，粮若仍不能及时接上，百姓以田换粮的询价就会增加；商会会首没有否认，只追问官府肯给什么边界。",
      requiredTermGroups: [["清流县令", "县令"], ["以田换粮", "田", "粮"], ["商会会首", "会首"]],
      resultCeiling: "只能表现卖田风险正在逼近，不得写成大规模卖田已经发生。",
    },
  ],
  "REQ-P1-MERCHANT-CONDITIONS": [
    {
      beatId: "PAYOFF-P1-MERCHANT-RIGHTS",
      actorRefs: ["actor.jiangnan_merchant_head"],
      action: "商会会首把粮船、担保与所求权利捆在一起重新问价，试图把一次救急变成继续进入粮路和政策的凭据。",
      requiredTermGroups: [["商会会首", "会首"], ["粮船", "粮路"], ["担保", "权利"]],
      resultCeiling: "只能提出交易条件，不得让官府自动授予购田、收丝或其他权利。",
    },
    {
      beatId: "PAYOFF-P1-MERCHANT-WITHDRAWAL",
      actorRefs: ["actor.jiangnan_merchant_head"],
      action: "商会会首拒绝无条件承诺后续粮船，明言官府若守住原有边界，就必须自己承担断粮与调运压力。",
      requiredTermGroups: [["商会会首", "会首"], ["粮船", "断粮"], ["边界", "调运"]],
      resultCeiling: "只能缩紧合作意愿，不得写成粮船已经全部撤走或米市已经断粮。",
    },
  ],
  "REQ-P1-LAND-RISK": [
    {
      beatId: "PAYOFF-P1-LAND-INQUIRY",
      actorRefs: ["actor.qingliu_magistrate", "actor.jiangnan_merchant_head"],
      action: "清流县令把灾民询问抵押、卖田的风险当面摆出，商会会首则要求官府明确哪些交易仍可进行；粮食决定开始挤压土地边界。",
      requiredTermGroups: [["清流县令", "县令"], ["抵押", "卖田"], ["商会会首", "会首"]],
      resultCeiling: "只能显示风险和交易争执，不得宣告土地兼并已经完成。",
    },
    {
      beatId: "PAYOFF-P1-LAND-COST",
      actorRefs: ["actor.xunfu_aide", "actor.qingliu_magistrate"],
      action: "巡抚幕僚追问土地保护会拖慢多少改桑进度，县令则把可能增加的赈济责任推回总督府；保田的代价由此公开化。",
      requiredTermGroups: [["巡抚幕僚", "幕僚"], ["土地保护", "保田"], ["赈济责任", "改桑进度"]],
      resultCeiling: "只能公开政策代价，不得新增未经授权的进度数字或财政金额。",
    },
  ],
  "REQ-P1-REPORT-AUTHORSHIP": [
    {
      beatId: "PAYOFF-P1-REPORT-COMPETING-VERSIONS",
      actorRefs: ["actor.xunfu_aide"],
      action: "巡抚幕僚要求核对总督将要送出的那版事实，并暗示若署名和内容不能相容，巡抚会保留自己的入京文字。",
      requiredTermGroups: [["巡抚幕僚", "幕僚"], ["那版事实", "内容"], ["入京文字", "署名"]],
      resultCeiling: "只能形成分奏威胁，不得写成巡抚奏报已经发出。",
    },
    {
      beatId: "PAYOFF-P1-REPORT-HANDLERS",
      actorRefs: ["actor.xunfu_aide", "actor.qingliu_magistrate"],
      action: "奏报的署名、附件和经手人被逐项追问，谁碰过哪一版文字开始成为后续问责可以回查的材料。",
      requiredTermGroups: [["奏报", "署名"], ["附件", "经手人"], ["问责", "回查"]],
      resultCeiling: "只能固定经手责任，不得新增附件内容或宣告任何人有罪。",
    },
  ],
  "REQ-P1-EVIDENCE-ATTACHMENT": [
    {
      beatId: "PAYOFF-P1-ATTACHMENT-WEIGHT",
      actorRefs: ["actor.qingliu_magistrate", "actor.reform_clerk"],
      action: "县令指出，附件越能追到原件、见证与经手人，入京后越难被一句空话推翻；改桑书吏也因此更清楚自己会被谁问到。",
      requiredTermGroups: [["县令", "清流县令"], ["附件", "原件"], ["改桑书吏", "书吏"]],
      resultCeiling: "只能说明附件分量与人证压力，不得写成京师已经采信。",
    },
    {
      beatId: "PAYOFF-P1-ATTACHMENT-RISK",
      actorRefs: ["actor.reform_clerk", "actor.xunfu_aide"],
      action: "附件范围一旦被更多衙门知道，改桑书吏立即追问谁能接触他的说法；巡抚幕僚则要求同样取得可见材料。",
      requiredTermGroups: [["附件范围", "附件"], ["改桑书吏", "书吏"], ["巡抚幕僚", "幕僚"]],
      resultCeiling: "只能提高证人与保管链风险，不得写成证人已经失踪、改口或受害。",
    },
  ],
  "REQ-P1-CAPITAL-FRAMING": [
    {
      beatId: "PAYOFF-P1-CAPITAL-FIRST-FRAME",
      actorRefs: ["actor.xunfu_aide"],
      action: "首报一经按既定渠道离开总督府，巡抚幕僚便要求确认京师首先会看到哪一版事实；地方争执已经不能再只靠口头收回。",
      requiredTermGroups: [["首报", "京师"], ["巡抚幕僚", "幕僚"], ["哪一版事实", "口头收回"]],
      resultCeiling: "只能确认文书已经按玩家选定的渠道离府，不得写成京师已经收到或裁决。",
    },
    {
      beatId: "PAYOFF-P1-CAPITAL-CHANNEL-RECORD",
      actorRefs: ["actor.xunfu_aide"],
      action: "巡抚幕僚要求把递送渠道、封号与经手责任列入共同案卷，因为这些记录日后本身就会成为问责的一部分。",
      requiredTermGroups: [["递送渠道", "渠道"], ["封号", "经手责任"], ["问责", "案卷"]],
      resultCeiling: "只能要求记录渠道责任，不得凭空生成回执、到达时辰或京师回应。",
    },
  ],
};

// Once a section's primary decision kernels have all been resolved, the story
// must keep moving without asking the player to repeat an earlier order. These
// continuation decisions are responses to a reviewed Floor Obligation: the
// floor moves an NPC or a world pressure, while the player still chooses the
// answer. They reuse an approved kernel for authority and source traceability,
// but every visible action and deterministic patch is new.
const floorContinuationDecisions = {
  "FLOOR-P1-S3-GRAIN-PRICE-MOVE": [
    {
      continuationDecisionId: "CD-P1-S3-RELIEF-RECEIPTS",
      basedOnDecisionKernelId: "DK-P1-RELIEF-PRIORITY",
      worldPressure: {
        pressureId: "PRESSURE-P1-S3-FIRST-RELIEF-DELIVERY",
        summary: "首批救粮已经抵县；平码、验收和发放若同时办理，今日只能开一半仓门，若先发后验，经手账目就会留下不能即时互证的空档。",
      },
      options: [
        {
          affordanceTemplateId: "CD-P1-S3-RELIEF-RECEIPTS-OPT-01",
          title: "验一仓、开一仓",
          actionText: "令县令会同乡老逐船过秤，实收数当场张榜；验完一仓便开一仓，不准用口报代替回执。",
          targetRef: "actor.qingliu_magistrate",
          method: "见证验收后分仓发放",
          immediateIntent: "让每一批放粮都能对应到当日实收与领粮回执。",
          visibleTradeoff: "发粮会慢半日，饥民与催办改桑的巡抚都可能把延误算到总督头上",
          stateEffects: ["knowledgeTransfers", "responsibility.governorExposure", "relations.governorXunfu"],
          statePatch: {
            knowledgeTransfer: { topic: "relief_receipt_before_release", senderRef: "actor.zhejiang_governor", recipientRef: "actor.qingliu_magistrate", status: "DELIVERED" },
            "responsibility.governorExposure": { $delta: 1 },
            "relations.governorXunfu": { $delta: -1 },
          },
          createsPendingConsequence: true,
        },
        {
          affordanceTemplateId: "CD-P1-S3-RELIEF-RECEIPTS-OPT-02",
          title: "先放粮、日落补册",
          actionText: "令米船一到便按既定名册放粮，日落前再由每名经手人补齐平码数、领粮户和余粮去向。",
          targetRef: "resource.official_grain",
          method: "先救急后限时补齐回执",
          immediateIntent: "先缩短百姓等粮时间，再以当天死限追回账目。",
          visibleTradeoff: "饥情缓得更快，但半日账目空档会成为巡抚、商会和县衙互相争执的口实",
          stateEffects: ["knowledgeTransfers", "responsibility.governorExposure", "relations.governorXunfu"],
          statePatch: {
            knowledgeTransfer: { topic: "relief_release_before_receipt", senderRef: "actor.zhejiang_governor", recipientRef: "actor.qingliu_magistrate", status: "DELIVERED" },
            "responsibility.governorExposure": { $delta: 2 },
            "relations.governorXunfu": { $delta: 1 },
          },
          createsPendingConsequence: true,
        },
      ],
    },
  ],
  "FLOOR-P1-S4-CAPITAL-DEADLINE": [
    {
      continuationDecisionId: "CD-P1-S4-XUNFU-COPY-REQUEST",
      basedOnDecisionKernelId: "DK-P1-REPORT-AUTHORSHIP",
      worldPressure: {
        pressureId: "PRESSURE-P1-S4-XUNFU-ASKS-FOR-COPY",
        summary: "首报文字刚定，巡抚幕僚便持正式手本来索取底稿，声称无论联署还是分奏，都必须先核对总督写入京师的那一版事实。",
      },
      options: [
        {
          affordanceTemplateId: "CD-P1-S4-XUNFU-COPY-REQUEST-OPT-01",
          title: "交封号摘要",
          actionText: "只交一份列明结论、附件名称和封号的摘要，不交证人位置与未核实细节；请巡抚在收讫处具名。",
          targetRef: "actor.zhejiang_xunfu",
          method: "有限披露并固定收讫",
          immediateIntent: "让巡抚知道首报边界，同时保住人证与未核实材料。",
          visibleTradeoff: "能减少公开冲突，但巡抚仍可能指责摘要不足并另起奏报",
          stateEffects: ["knowledgeTransfers", "relations.governorXunfu"],
          statePatch: {
            knowledgeTransfer: { topic: "first_report_seal_index_summary", senderRef: "actor.zhejiang_governor", recipientRef: "actor.zhejiang_xunfu", status: "DELIVERED" },
            "relations.governorXunfu": { $delta: 1 },
          },
          createsPendingConsequence: true,
        },
        {
          affordanceTemplateId: "CD-P1-S4-XUNFU-COPY-REQUEST-OPT-02",
          title: "拒交全文并留案",
          actionText: "不交底稿，只以正式回文写明拒交范围、证据保管理由和可复核期限，把幕僚手本一并入档。",
          targetRef: "actor.xunfu_aide",
          method: "书面拒绝并保存来往文书",
          immediateIntent: "防止首报在离开总督府前被改写，同时留下拒交理由。",
          visibleTradeoff: "叙述权更集中，但督抚分裂会更早公开，总督也要独担拒绝协作的责任",
          stateEffects: ["knowledgeTransfers", "responsibility.governorExposure", "relations.governorXunfu"],
          statePatch: {
            knowledgeTransfer: { topic: "first_report_copy_refusal_record", senderRef: "actor.zhejiang_governor", recipientRef: "actor.zhejiang_xunfu", status: "DELIVERED" },
            "responsibility.governorExposure": { $delta: 1 },
            "relations.governorXunfu": { $delta: -1 },
          },
          createsPendingConsequence: true,
        },
      ],
    },
    {
      continuationDecisionId: "CD-P1-S4-MERCHANT-DAILY-TERMS",
      basedOnDecisionKernelId: "DK-P1-RESPONSIBILITY-SCOPE",
      worldPressure: {
        pressureId: "PRESSURE-P1-S4-MERCHANT-ASKS-FOR-GUARANTEE",
        summary: "商会会首得知首报将发，随即要求官府把后续粮船、运价和担保写成一纸长期凭据；若仍逐船议价，他便不肯保证下一批船期。",
      },
      options: [
        {
          affordanceTemplateId: "CD-P1-S4-MERCHANT-DAILY-TERMS-OPT-01",
          title: "逐日张榜、逐船具结",
          actionText: "令商会每日具结可供粮船、运价和所求权利，在总督府门外张榜后才准新增一船；不得把购田或收丝优先权混入粮约。",
          targetRef: "actor.jiangnan_merchant_head",
          method: "公开短约替代长期官保",
          immediateIntent: "保留商粮弹性，同时让每一日交易条件都能被复核。",
          visibleTradeoff: "商会可能少报粮量或抬高运价，官府还要承担每日核验的人力与信用成本",
          stateEffects: ["knowledgeTransfers", "responsibility.governorExposure", "responsibility.xunfuExposure"],
          statePatch: {
            knowledgeTransfer: { topic: "merchant_daily_public_terms", senderRef: "actor.zhejiang_governor", recipientRef: "actor.jiangnan_merchant_head", status: "DELIVERED" },
            "responsibility.governorExposure": { $delta: 1 },
            "responsibility.xunfuExposure": { $delta: 1 },
          },
          createsPendingConsequence: true,
        },
        {
          affordanceTemplateId: "CD-P1-S4-MERCHANT-DAILY-TERMS-OPT-02",
          title: "不再加签官保",
          actionText: "维持上一节已经定下的商粮边界，新增运粮仍按原条件逐船核销，不给商会另具长期担保。",
          targetRef: "actor.jiangnan_merchant_head",
          method: "守住既有交易边界",
          immediateIntent: "避免首报发出后，商会借粮路再取得一层政策凭据。",
          visibleTradeoff: "边界清楚，但商会可能缩减船期，断粮责任将更直接压回总督府",
          stateEffects: ["knowledgeTransfers", "responsibility.governorExposure", "relations.governorXunfu"],
          statePatch: {
            knowledgeTransfer: { topic: "merchant_no_additional_guarantee", senderRef: "actor.zhejiang_governor", recipientRef: "actor.jiangnan_merchant_head", status: "DELIVERED" },
            "responsibility.governorExposure": { $delta: 2 },
            "relations.governorXunfu": { $delta: -1 },
          },
          createsPendingConsequence: true,
        },
      ],
    },
    {
      continuationDecisionId: "CD-P1-S4-WITNESS-PROTECTION-ORDER",
      basedOnDecisionKernelId: "DK-P1-EVIDENCE-ATTACHMENT",
      worldPressure: {
        pressureId: "PRESSURE-P1-S4-WITNESS-ASKS-FOR-RULES",
        summary: "奏报附件的范围已在衙门间传开，改桑书吏托县令问明：下一次复核由谁传他、谁能在场、他的初始说法是否会被任意抄送。",
      },
      options: [
        {
          affordanceTemplateId: "CD-P1-S4-WITNESS-PROTECTION-ORDER-OPT-01",
          title: "另封保护令",
          actionText: "另发封缄保护令，限定传唤人、问讯地点和在场见证；任何抄送都须留下收件人与时辰。",
          targetRef: "actor.reform_clerk",
          method: "以书面权限保护人证",
          immediateIntent: "让书吏知道谁有权接触他，并让每次接触都留下记录。",
          visibleTradeoff: "保护更强，却会让巡抚认定总督把关键人证收归自己控制",
          stateEffects: ["witness.accessStatus", "knowledgeTransfers", "responsibility.governorExposure", "relations.governorXunfu"],
          statePatch: {
            "witness.accessStatus": "PROTECTED",
            knowledgeTransfer: { topic: "witness_written_protection_order", senderRef: "actor.zhejiang_governor", recipientRef: "actor.reform_clerk", status: "DELIVERED" },
            "responsibility.governorExposure": { $delta: 1 },
            "relations.governorXunfu": { $delta: -1 },
          },
          createsPendingConsequence: true,
        },
        {
          affordanceTemplateId: "CD-P1-S4-WITNESS-PROTECTION-ORDER-OPT-02",
          title: "原地留人、双证问讯",
          actionText: "不把书吏移出原保管地，只规定任何问讯必须持书面传票，并由督抚双方见证人在场。",
          targetRef: "actor.qingliu_magistrate",
          method: "维持原保管地并设置双重门槛",
          immediateIntent: "避免私扣人证之名，同时限制任何一方单独改变初始说法。",
          visibleTradeoff: "程序更均衡，但消息面扩大，问讯也可能被任一方拖延",
          stateEffects: ["knowledgeTransfers", "responsibility.governorExposure", "responsibility.xunfuExposure"],
          statePatch: {
            knowledgeTransfer: { topic: "witness_dual_warrant_threshold", senderRef: "actor.zhejiang_governor", recipientRef: "actor.qingliu_magistrate", status: "DELIVERED" },
            "responsibility.governorExposure": { $delta: 1 },
            "responsibility.xunfuExposure": { $delta: 1 },
          },
          createsPendingConsequence: true,
        },
      ],
    },
    {
      continuationDecisionId: "CD-P1-S4-WAITING-FOR-CAPITAL",
      basedOnDecisionKernelId: "DK-P1-CAPITAL-CHANNEL",
      worldPressure: {
        pressureId: "PRESSURE-P1-S4-XUNFU-WANTS-INTERIM-ORDER",
        summary: "首报已经离开浙江，京师回文尚未可知；巡抚却要求总督在等待期间先定一条临时规矩，免得各县借‘候旨’自行扩张或停摆。",
      },
      options: [
        {
          affordanceTemplateId: "CD-P1-S4-WAITING-FOR-CAPITAL-OPT-01",
          title: "先守住民田边界",
          actionText: "在京师回文前维持既定改桑范围，新的急售田契一律先登记、后复核，不得借候旨扩大购田。",
          targetRef: "actor.zhejiang_xunfu",
          method: "候旨期间冻结扩张边界",
          immediateIntent: "把第二部分首先要查清的卖田风险留在可追踪范围内。",
          visibleTradeoff: "民田入口较窄，但粮路、改桑进度和巡抚催办压力都会继续上升",
          stateEffects: ["land.safeguardStatus", "knowledgeTransfers", "relations.governorXunfu"],
          statePatch: {
            "land.safeguardStatus": "ACTIVE",
            knowledgeTransfer: { topic: "interim_land_boundary_pending_capital", senderRef: "actor.zhejiang_governor", recipientRef: "actor.zhejiang_xunfu", status: "DELIVERED" },
            "relations.governorXunfu": { $delta: -1 },
          },
          createsPendingConsequence: true,
        },
        {
          affordanceTemplateId: "CD-P1-S4-WAITING-FOR-CAPITAL-OPT-02",
          title: "先保粮路不断",
          actionText: "准既有救粮与运输约继续履行，但每日公开到粮、运价和担保，不得趁候旨增加购田或收丝权利。",
          targetRef: "actor.zhejiang_xunfu",
          method: "维持救粮并逐日公开条件",
          immediateIntent: "把第二部分首先要查清的粮路留在不断供、可核对的状态。",
          visibleTradeoff: "能减轻断粮风险，但商会仍保有谈判位置，总督要为每日条件变化负责",
          stateEffects: ["knowledgeTransfers", "responsibility.governorExposure", "relations.governorXunfu"],
          statePatch: {
            knowledgeTransfer: { topic: "interim_grain_route_pending_capital", senderRef: "actor.zhejiang_governor", recipientRef: "actor.zhejiang_xunfu", status: "DELIVERED" },
            "responsibility.governorExposure": { $delta: 1 },
            "relations.governorXunfu": { $delta: 1 },
          },
          createsPendingConsequence: true,
        },
      ],
    },
  ],
};

const sections = [];
for (const name of (await readdir(resolve(authoringRoot, "sections/part-01"))).filter((entry) => entry.endsWith(".json")).sort()) {
  sections.push(await readJson(resolve(authoringRoot, "sections/part-01", name)));
}
const continuationIds = new Set();
const continuationAffordanceIds = new Set();
let continuationCount = 0;
for (const section of sections) {
  for (const floorId of section.floorObligationIds) {
    for (const decision of floorContinuationDecisions[floorId] || []) {
      continuationCount += 1;
      if (continuationIds.has(decision.continuationDecisionId)) throw new Error(`Duplicate continuation decision ID ${decision.continuationDecisionId}`);
      continuationIds.add(decision.continuationDecisionId);
      if (!section.activeDecisionKernelIds.includes(decision.basedOnDecisionKernelId)) {
        throw new Error(`${decision.continuationDecisionId} references a kernel outside ${section.sectionId}`);
      }
      if (!decision.worldPressure?.pressureId || !decision.worldPressure?.summary) {
        throw new Error(`${decision.continuationDecisionId} lacks an authored world pressure`);
      }
      if (!Array.isArray(decision.options) || decision.options.length !== 2) {
        throw new Error(`${decision.continuationDecisionId} must expose exactly two player responses`);
      }
      for (const option of decision.options) {
        if (continuationAffordanceIds.has(option.affordanceTemplateId)) throw new Error(`Duplicate continuation affordance ID ${option.affordanceTemplateId}`);
        continuationAffordanceIds.add(option.affordanceTemplateId);
        if (!option.title || !option.actionText || !option.targetRef || !option.method || !option.visibleTradeoff) {
          throw new Error(`${option.affordanceTemplateId} is not a complete player-visible decision`);
        }
        if (!option.statePatch || !Object.keys(option.statePatch).length || !option.stateEffects?.length) {
          throw new Error(`${option.affordanceTemplateId} lacks a deterministic material consequence`);
        }
      }
    }
  }
}
if (continuationCount !== 5) throw new Error(`Expected five non-repeating continuation decisions, found ${continuationCount}`);
const sectionByRequirement = new Map(sections.flatMap((section) => section.requiredRequirementIds.map((id) => [id, section])));
const assets = [];

function assetBase({ assetId, assetType, sectionIds = null, requirementIds, decisionKernelIds = [], causalArcIds = [], actorRefs = [], stateDependencies = [], sourceClaimIds = [], adaptationDecisionIds = [], retrievalTags = [], payload }) {
  return {
    schemaVersion: "runtime-story-asset-v1",
    assetId,
    assetType,
    partIds: ["PART-01"],
    sectionIds: sectionIds || [...new Set(requirementIds.flatMap((id) => sectionByRequirement.get(id)?.sectionId ?? []))],
    requirementIds,
    decisionKernelIds,
    causalArcIds,
    actorRefs,
    stateDependencies,
    visibilityRules: [{ visibilityClass: "SERVER_AUTHORITATIVE", rule: "Only player-projected fields may enter the visible prompt or UI." }],
    sourceClaimIds,
    adaptationDecisionIds,
    retrievalTags: [...new Set(["PART-01", ...retrievalTags, ...requirementIds, ...decisionKernelIds, ...causalArcIds, ...actorRefs, ...stateDependencies])],
    payload,
  };
}

for (const pattern of narrativeScenePatternSet.patterns) {
  const {
    sourceRefs,
    sectionIds,
    requirementIds,
    decisionKernelIds,
    actorRefs,
    sourceClaimIds,
    ...promptSafePattern
  } = pattern;
  assets.push(assetBase({
    assetId: pattern.patternId,
    assetType: "NARRATIVE_SCENE_PATTERN",
    sectionIds,
    requirementIds,
    decisionKernelIds,
    causalArcIds: [...new Set(sectionIds.flatMap((sectionId) => sections.find((item) => item.sectionId === sectionId)?.activeCausalArcIds || []))],
    actorRefs,
    stateDependencies: [],
    sourceClaimIds,
    adaptationDecisionIds: [],
    retrievalTags: [...sectionIds, pattern.sourceSceneId, "NARRATIVE_SCENE_PATTERN", "PLAYER_VISIBLE_PROSE_GRAMMAR"],
    payload: promptSafePattern,
  }));
}

for (const requirement of requirementSet.requirements) {
  const mechanism = mechanismByRequirement.get(requirement.requirementId);
  if (!mechanism) throw new Error(`No approved mechanism for ${requirement.requirementId}`);
  const section = sectionByRequirement.get(requirement.requirementId);
  const adaptationDecisionIds = requirement.adaptationGapIds;
  for (const adaptationId of adaptationDecisionIds) if (!approvedAdaptationIds.has(adaptationId)) throw new Error(`${requirement.requirementId} lacks approved ${adaptationId}`);
  const coreAssetId = `RTA-${requirement.requirementId.replace(/^REQ-/, "")}`;
  assets.push(assetBase({
    assetId: coreAssetId,
    assetType: mechanism.candidateType,
    requirementIds: [requirement.requirementId],
    decisionKernelIds: requirement.decisionKernelIds,
    causalArcIds: section.activeCausalArcIds,
    actorRefs: mechanism.actorRefs,
    stateDependencies: requirement.stateEffects,
    sourceClaimIds: requirement.sourceClaimIds,
    adaptationDecisionIds,
    retrievalTags: requirement.retrievalTags,
    payload: {
      dramaticFunction: mechanism.dramaticFunction,
      preconditions: mechanism.preconditions,
      allowedMoves: mechanism.allowedMoves,
      likelyCountermoves: mechanism.likelyCountermoves,
      immediateStateEffects: mechanism.immediateStateEffects,
      delayedConsequences: mechanism.delayedConsequences,
      invariantsToPreserve: mechanism.invariantsToPreserve,
      limitations: mechanism.limitations,
      evidenceStrength: mechanism.evidenceStrength,
    },
  }));
  const consequenceAssetId = requirement.delayedConsequenceRuleIds[0];
  const payoffBeats = consequencePayoffBeatsByRequirement[requirement.requirementId];
  if (!payoffBeats || payoffBeats.length !== mechanism.delayedConsequences.length) {
    throw new Error(`${requirement.requirementId} must define one concrete payoff beat per delayed consequence`);
  }
  for (const payoff of payoffBeats) {
    if (!payoff.beatId || !payoff.action || !payoff.actorRefs?.length || !payoff.requiredTermGroups?.length || !payoff.resultCeiling) {
      throw new Error(`${requirement.requirementId} contains an incomplete consequence payoff beat`);
    }
  }
  assets.push(assetBase({
    assetId: consequenceAssetId,
    assetType: "PENDING_CONSEQUENCE_RULE",
    requirementIds: [requirement.requirementId],
    decisionKernelIds: requirement.requirementId === "REQ-P1-EXECUTION-BOUNDARY"
      ? requirement.decisionKernelIds.filter((kernelId) => kernelId === "DK-P1-EXECUTION-SCOPE")
      : requirement.decisionKernelIds,
    causalArcIds: section.activeCausalArcIds,
    actorRefs: mechanism.actorRefs,
    stateDependencies: requirement.stateEffects,
    sourceClaimIds: requirement.sourceClaimIds,
    adaptationDecisionIds,
    retrievalTags: [...requirement.retrievalTags, "PENDING_CONSEQUENCE"],
    payload: {
      createOnlyFromCommittedEvent: true,
      consequences: mechanism.delayedConsequences,
      payoffBeats,
      mustRecord: ["consequenceId", "causedByEventId", "dueWindow", "priority", "status", "payoffBeat"],
      allowedTransitions: ["PENDING", "DUE", "PAID", "DEFERRED_WITH_REASON", "TRANSFORMED"],
      mayNotDisappearSilently: true,
    },
  }));
}

const uniqueKernelIds = [...new Set(requirementSet.requirements.flatMap((item) => item.decisionKernelIds))].sort();
for (const kernelId of uniqueKernelIds) {
  const requirements = requirementSet.requirements.filter((item) => item.decisionKernelIds.includes(kernelId));
  const section = sectionByRequirement.get(requirements[0].requirementId);
  const options = kernelOptions[kernelId];
  const statePatches = kernelStatePatches[kernelId];
  if (!options || options.length < 3) throw new Error(`${kernelId} must define at least three concrete affordance templates`);
  if (!statePatches || statePatches.length !== options.length) throw new Error(`${kernelId} must define one deterministic state patch per affordance`);
  assets.push(assetBase({
    assetId: kernelId,
    assetType: "DECISION_KERNEL",
    requirementIds: requirements.map((item) => item.requirementId),
    decisionKernelIds: [kernelId],
    causalArcIds: section.activeCausalArcIds,
    actorRefs: [...new Set(requirements.flatMap((id) => mechanismByRequirement.get(id.requirementId).actorRefs))],
    stateDependencies: [...new Set(requirements.flatMap((item) => item.stateEffects))],
    sourceClaimIds: [...new Set(requirements.flatMap((item) => item.sourceClaimIds))],
    adaptationDecisionIds: [...new Set(requirements.flatMap((item) => item.adaptationGapIds))],
    retrievalTags: [section.sectionId, kernelId, "OPEN_DECISION_KERNEL"],
    payload: {
      availableWhen: requirements.flatMap((item) => mechanismByRequirement.get(item.requirementId).preconditions),
      minimumVisibleOptions: 2,
      maximumVisibleOptions: 2,
      allowFreeAction: true,
      options: options.map(([title, actionText, targetRef, method, tradeoff, stateEffects], index) => ({
        affordanceTemplateId: `${kernelId}-OPT-${String(index + 1).padStart(2, "0")}`,
        title,
        actionText,
        targetRef,
        method,
        immediateIntent: actionText,
        visibleTradeoff: tradeoff,
        stateEffects,
        statePatch: statePatches[index],
        createsPendingConsequence: true,
      })),
      contrastRules: ["每项必须在目标、方法、即时成本或反制中至少两项不同", "不得把必然后果写成剧透", "玩家应能不用内部 ID 复述行动"],
    },
  }));
}

for (const section of sections) {
  for (const arcId of section.activeCausalArcIds) {
    const requirements = requirementSet.requirements.filter((item) => section.requiredRequirementIds.includes(item.requirementId));
    assets.push(assetBase({
      assetId: arcId,
      assetType: "CAUSAL_ARC",
      requirementIds: requirements.map((item) => item.requirementId),
      decisionKernelIds: section.activeDecisionKernelIds,
      causalArcIds: [arcId],
      actorRefs: section.foregroundActorRefs,
      stateDependencies: section.handoffStatePaths,
      sourceClaimIds: [...new Set(requirements.flatMap((item) => item.sourceClaimIds))],
      adaptationDecisionIds: [...new Set(requirements.flatMap((item) => item.adaptationGapIds))],
      retrievalTags: [section.sectionId, arcId, "ACTIVE_CAUSAL_ARC"],
      payload: {
        initialStage: "OPEN",
        allowedStages: ["OPEN", "PRESSURED", "ESCALATED", "RESOLVED", "FAILED", "TRANSFORMED"],
        transitionsMustReferenceCommittedEvents: true,
        exitGateRules: section.exitGates,
        mayNotAdvanceByTurnNumberAlone: true,
      },
    }));
  }
  for (const floorId of section.floorObligationIds) {
    assets.push(assetBase({
      assetId: floorId,
      assetType: "SECTION_FLOOR_OBLIGATION",
      requirementIds: section.requiredRequirementIds,
      decisionKernelIds: section.activeDecisionKernelIds,
      causalArcIds: section.activeCausalArcIds,
      actorRefs: section.foregroundActorRefs,
      stateDependencies: section.handoffStatePaths,
      sourceClaimIds: [...new Set(section.requiredRequirementIds.flatMap((id) => requirementSet.requirements.find((item) => item.requirementId === id).sourceClaimIds))],
      adaptationDecisionIds: [...new Set(section.requiredRequirementIds.flatMap((id) => requirementSet.requirements.find((item) => item.requirementId === id).adaptationGapIds))],
      retrievalTags: [section.sectionId, floorId, "FLOOR_OBLIGATION"],
      payload: {
        targetTurnWindow: section.targetTurnWindow,
        dramaticPurpose: section.dramaticPurpose,
        mayOnlyMoveNpcOrWorld: true,
        mayNotDecideForPlayer: true,
        mayNotInventEvidence: true,
        exitGates: section.exitGates,
        continuationDecisions: (floorContinuationDecisions[floorId] || []).map((decision) => ({
          ...decision,
          worldPressure: { ...decision.worldPressure, sourceFloorAssetId: floorId },
        })),
      },
    }));
  }
}

const supportingActorPolicies = [
  ["AP-P1-QINGLIU-MAGISTRATE", "actor.qingliu_magistrate", ["REQ-P1-REGISTER-CUSTODY", "REQ-P1-REVIEW-AUTHORITY", "REQ-P1-KNOWLEDGE-CHAIN"], "保住县册可追溯性，同时避免在证据未稳时独自承担毁册或抗命罪名。", ["密报异常并请求上级明确程序", "在获得保护时交出样册或经手名册", "证据不足时承认不知道"], ["被要求独自背责时保留文书", "保管链受威胁时请求异地见证"]],
  ["AP-P1-REFORM-CLERK", "actor.reform_clerk", ["REQ-P1-REGISTER-CUSTODY", "REQ-P1-KNOWLEDGE-CHAIN"], "在不成为替罪羊的前提下保存自己知道的经手事实。", ["只陈述亲手经办内容", "要求保护或见证后再指认", "说明原件、副本和听闻的区别"], ["遭到公开点名时改口或逃避接触", "获得可信保护时补充经手细节"]],
  ["AP-P1-XUNFU-AIDE", "actor.xunfu_aide", ["REQ-P1-XUNFU-COUNTERMOVE", "REQ-P1-KNOWLEDGE-CHAIN"], "替巡抚争取速度和信息入口，但不能拥有巡抚尚未获得的知识。", ["递送催办公文", "申请参加复核", "记录对方拒绝或拖延"], ["只能在收到明确指令或可见公文后行动", "不得自行证明官商暗账"]],
];
for (const [assetId, actorRef, requirementIds, goal, moves, reactions] of supportingActorPolicies) {
  const requirements = requirementIds.map((id) => requirementSet.requirements.find((item) => item.requirementId === id));
  assets.push(assetBase({
    assetId,
    assetType: "ACTOR_POLICY",
    requirementIds,
    decisionKernelIds: [...new Set(requirements.flatMap((item) => item.decisionKernelIds))],
    causalArcIds: [...new Set(requirements.flatMap((item) => sectionByRequirement.get(item.requirementId).activeCausalArcIds))],
    actorRefs: [actorRef],
    stateDependencies: [...new Set(requirements.flatMap((item) => item.stateEffects))],
    sourceClaimIds: [...new Set(requirements.flatMap((item) => item.sourceClaimIds))],
    adaptationDecisionIds: [...new Set(requirements.flatMap((item) => item.adaptationGapIds))],
    retrievalTags: [actorRef, "ACTOR_POLICY"],
    payload: { goal, allowedMoves: moves, conditionalReactions: reactions, knowledgeBounded: true, mayNotWaitPassively: true },
  }));
}

assets.push(assetBase({
  assetId: "STYLE-SANGTIAN-HISTORICAL-NOVEL",
  assetType: "NARRATIVE_STYLE_PROFILE",
  requirementIds: requirementSet.requirements.map((item) => item.requirementId),
  decisionKernelIds: uniqueKernelIds,
  causalArcIds: sections.flatMap((item) => item.activeCausalArcIds),
  actorRefs: Object.keys(styleProfile.characterVoiceAnchors),
  stateDependencies: ["partId", "sectionId", "pendingConsequences", "knowledgeTransfers"],
  sourceClaimIds: [...new Set(requirementSet.requirements.flatMap((item) => item.sourceClaimIds))],
  adaptationDecisionIds: adaptationSet.adaptations.map((item) => item.adaptationDecisionId),
  retrievalTags: ["P0", "NARRATIVE_STYLE", "PLAYER_VISIBLE_TEXT"],
  payload: styleProfile,
}));

const assetIds = new Set();
for (const asset of assets) {
  if (assetIds.has(asset.assetId)) throw new Error(`Duplicate runtime asset ID ${asset.assetId}`);
  assetIds.add(asset.assetId);
  if (!asset.requirementIds.length || !asset.decisionKernelIds.length) throw new Error(`${asset.assetId} lacks requirement/kernel traceability`);
  if (!asset.sourceClaimIds.length && !asset.adaptationDecisionIds.length) throw new Error(`${asset.assetId} lacks source/adaptation traceability`);
  await writeJson(resolve(outputRoot, "assets", `${asset.assetId}.json`), asset);
}

for (const requirement of requirementSet.requirements) {
  const coreAssetId = `RTA-${requirement.requirementId.replace(/^REQ-/, "")}`;
  const section = sectionByRequirement.get(requirement.requirementId);
  const narrativePatternIds = narrativeScenePatternSet.patterns
    .filter((pattern) => pattern.requirementIds.includes(requirement.requirementId))
    .map((pattern) => pattern.patternId);
  requirement.adaptationDecisionIds = requirement.adaptationGapIds;
  requirement.coverageStatus = requirement.adaptationGapIds.length ? "SATISFIED_BY_ADAPTATION" : "SATISFIED_BY_SOURCE";
  requirement.runtimeAssetIds = [coreAssetId, ...requirement.decisionKernelIds, ...section.activeCausalArcIds, ...requirement.delayedConsequenceRuleIds, ...narrativePatternIds];
}
if (!skipSourceWrites) {
  await writeJson(resolve(authoringRoot, "requirements/part-01.requirements.json"), requirementSet);
}

function buildIndex(items) {
  const index = {
    byPart: {}, bySection: {}, byRequirement: {}, byDecisionKernel: {}, byCausalArc: {},
    byActor: {}, byLocation: {}, byStateDependency: {}, byRetrievalTag: {}, byVisibilityClass: {},
  };
  const add = (bucket, key, id) => { if (!key) return; (bucket[key] ??= []).push(id); };
  for (const item of items) {
    item.partIds.forEach((key) => add(index.byPart, key, item.assetId));
    item.sectionIds.forEach((key) => add(index.bySection, key, item.assetId));
    item.requirementIds.forEach((key) => add(index.byRequirement, key, item.assetId));
    item.decisionKernelIds.forEach((key) => add(index.byDecisionKernel, key, item.assetId));
    item.causalArcIds.forEach((key) => add(index.byCausalArc, key, item.assetId));
    item.actorRefs.forEach((key) => add(index.byActor, key, item.assetId));
    item.stateDependencies.forEach((key) => add(index.byStateDependency, key, item.assetId));
    item.retrievalTags.forEach((key) => add(index.byRetrievalTag, key, item.assetId));
    item.visibilityRules.forEach((rule) => add(index.byVisibilityClass, rule.visibilityClass, item.assetId));
    const locations = Array.isArray(item.payload?.locationRefs) ? item.payload.locationRefs : [];
    locations.forEach((key) => add(index.byLocation, key, item.assetId));
  }
  for (const bucket of Object.values(index)) for (const key of Object.keys(bucket)) bucket[key] = [...new Set(bucket[key])].sort();
  return index;
}
const index = buildIndex(assets);
const runtimeIndex = { schemaVersion: "runtime-story-index-v1", ...index };
await writeJson(resolve(outputRoot, "runtime-index.json"), runtimeIndex);
const assetHashes = Object.fromEntries(assets.map((asset) => [asset.assetId, computeImmutableHash(asset)]).sort(([left], [right]) => left.localeCompare(right)));
const manifestBase = {
  schemaVersion: "sangtian-part-one-authoring-release-v1",
  releaseVersion: RELEASE_VERSION,
  evidenceReleaseId: EVIDENCE_RELEASE_ID,
  reviewSetHash: reviewSet.immutableHash,
  adaptationReviewSetHash: adaptationSet.reviewSetHash,
  styleProfileHash: computeImmutableHash(styleProfile),
  narrativeScenePatternSetHash: computeImmutableHash(narrativeScenePatternSet),
  narrativeScenePatternCount: narrativeScenePatternSet.patterns.length,
  assetCount: assets.length,
  decisionKernelCount: uniqueKernelIds.length,
  causalArcCount: sections.flatMap((item) => item.activeCausalArcIds).length,
  floorObligationCount: sections.flatMap((item) => item.floorObligationIds).length,
  requirementCount: requirementSet.requirements.length,
  assetIds: [...assetIds].sort(),
  assetHashes,
  runtimeIndexHash: computeImmutableHash(runtimeIndex),
  requirementSetHash: computeImmutableHash(requirementSet),
};
const manifest = { ...manifestBase, immutableHash: computeImmutableHash(manifestBase) };
await writeJson(resolve(outputRoot, "manifest.json"), manifest);

// The authoring tree remains the reviewable source of truth. This single
// immutable sidecar is the production input consumed by the Solo runtime, so
// deployment never has to discover or partially read an authoring directory.
const runtimePackageBase = {
  schemaVersion: "sangtian-part-one-runtime-package-v1",
  worldId: "sangtian",
  partId: "PART-01",
  perspectiveRoleKey: worldStart.perspectiveRoleKey,
  authoringReleaseVersion: RELEASE_VERSION,
  authoringManifestHash: manifest.immutableHash,
  authoringManifest: manifest,
  evidenceReleaseId: EVIDENCE_RELEASE_ID,
  contentCounts: {
    assets: assets.length,
    requirements: requirementSet.requirements.length,
    sections: sections.length,
    decisionKernels: uniqueKernelIds.length,
    causalArcs: sections.flatMap((item) => item.activeCausalArcIds).length,
    floorObligations: sections.flatMap((item) => item.floorObligationIds).length,
    approvedAdaptations: adaptationSet.adaptations.length,
    narrativeScenePatterns: narrativeScenePatternSet.patterns.length,
  },
  worldStart,
  sections,
  requirements: requirementSet.requirements,
  approvedAdaptations: adaptationSet.adaptations,
  styleProfile,
  assets,
  runtimeIndex,
};
const runtimePackage = {
  ...runtimePackageBase,
  immutableHash: computeImmutableHash(runtimePackageBase),
};
await writeJson(runtimePackagePath, runtimePackage);
console.log(JSON.stringify({ outputRoot, runtimePackagePath, runtimePackageHash: runtimePackage.immutableHash, ...manifest }, null, 2));
