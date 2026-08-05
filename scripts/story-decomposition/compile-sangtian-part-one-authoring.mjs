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
const sourceSceneEvidenceSet = await readJson(resolve(
  authoringRoot,
  "source-evidence/section-one-scenes.approved.json",
));
const evidenceProfileSet = await readJson(resolve(
  authoringRoot,
  "evidence/approved/part-01-v3.evidence-profiles.json",
));
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
if (
  sourceSceneEvidenceSet.schemaVersion !== "sangtian-scene-evidence-packet-source-v1"
  || sourceSceneEvidenceSet.worldId !== "sangtian"
  || sourceSceneEvidenceSet.reviewStatus !== "APPROVED"
  || sourceSceneEvidenceSet.verbatimPolicy !== "MECHANISM_ONLY_NO_VERBATIM_REUSE"
  || !Array.isArray(sourceSceneEvidenceSet.scenes)
  || sourceSceneEvidenceSet.scenes.length !== 10
) {
  throw new Error("T3 compilation blocked: the approved source scene evidence set is missing or invalid");
}
for (const scene of sourceSceneEvidenceSet.scenes) {
  if (
    !scene.sceneId
    || !scene.title
    || !scene.sourceRange?.chapterId
    || !scene.sourceRange?.paragraphStartId
    || !scene.sourceRange?.paragraphEndId
    || !scene.sourceRange?.textSpanSha256
    || !Array.isArray(scene.mechanisms)
    || !scene.mechanisms.length
    || scene.mechanisms.some((item) => !item.evidenceId || !item.statement || !item.claimIds?.length)
  ) {
    throw new Error(`T3 compilation blocked: invalid source scene evidence ${scene.sceneId || "UNKNOWN"}`);
  }
}
if (
  evidenceProfileSet.schemaVersion !== "evidence-profile-set-v1"
  || !Array.isArray(evidenceProfileSet.profiles)
  || evidenceProfileSet.profiles.length !== 1
) {
  throw new Error("T3 compilation blocked: the approved evidence profile set is incomplete");
}
for (const profile of evidenceProfileSet.profiles) {
  if (
    profile.schemaVersion !== "evidence-profile-v1"
    || !profile.evidenceProfileId
    || !profile.assetId
    || !profile.targetRef
    || !profile.openingReport?.statement
    || !profile.openingReport?.allowedAssertions?.length
    || !profile.openingReport?.forbiddenAssertions?.length
    || !profile.openingBeatContract?.objective
    || !profile.openingBeatContract?.moves?.length
    || !profile.openingBeatContract?.requiredAnchorGroups?.length
    || profile.openingBeatContract.requiredAnchorGroups.some((group) => !Array.isArray(group) || !group.length)
    || !profile.openingBeatContract?.stopCondition
    || !profile.revealPolicy?.tiers?.length
  ) {
    throw new Error(`T3 compilation blocked: incomplete evidence profile ${profile.evidenceProfileId || "<unknown>"}`);
  }
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
    ["要求联署", "将当前改桑执行边界与督抚各自责任写入正式回文，说明县册复核主持权另议，请巡抚共同具名。", "actor.zhejiang_xunfu", "共同具名", "共同承担能换来合作，也会模糊日后分歧", ["responsibility.firstRecordStatus", "responsibility.governorExposure", "responsibility.xunfuExposure"]],
    ["总督单署", "由总督单独具名写明当前改桑执行边界，并把巡抚催办原文作为附件留档。", "actor.zhejiang_xunfu", "单独具名并附原文", "责任集中，但保留了催办来源", ["responsibility.firstRecordStatus", "responsibility.governorExposure"]],
    ["记明异议", "另具正式回文暂准放行，并逐项写明督抚分歧和各自承担的事项。", "actor.zhejiang_xunfu", "分项责任记录", "关系转冷，但后续不易互相改口", ["responsibility.firstRecordStatus", "relations.governorXunfu", "reform.executionMode", "reform.progress"]],
  ],
  "DK-P1-EVIDENCE-CUSTODY": [
    ["命令原件留档", "命清流县将原册留在档房，待总督、县令、巡抚三方见证到场后换封并各留封样。", "document.qingliu_register_original", "下令三方见证换封", "原件不移动，但执行前仍存在保管风险", ["evidence.chainStatus", "evidence.archiveSealStatus", "evidence.primaryCustodianRef", "durableState"]],
    ["命令制作副本", "命清流县在两名见证人到场后抄出样册，逐页记下抄录人与时辰。", "document.qingliu_register_original", "下令见证抄录", "可建立第二条链，但执行时会暴露经手书吏", ["evidence.copyStatus", "witness.accessStatus", "knowledgeTransfers", "durableState"]],
    ["命令移交总督府", "命清流县在见证下将可疑册页整封移交总督府，县衙留存交接清单。", "document.qingliu_register_original", "下令见证移交", "总督将取得原件，但在实际交接前仍由县衙保管", ["evidence.primaryCustodianRef", "evidence.chainStatus", "responsibility.governorExposure", "durableState"]],
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

// A decision kernel owns the question that brings its options on stage. The
// runtime carries this stable decision point from the canonical scene ending
// into every published option, so prose and choices cannot drift onto two
// different questions. These are story assets, not keyword-matching rules.
const kernelDecisionPrompts = {
  "DK-P1-EXECUTION-SCOPE": {
    actorRefs: ["actor.xunfu_clerk"],
    prompt: "巡抚书吏仍候在厅中，要总督当面定下这道改桑急令究竟按什么边界执行。",
  },
  "DK-P1-REVIEW-INITIATION": {
    actorRefs: ["actor.qingliu_messenger", "actor.xunfu_clerk"],
    prompt: "清流县令亲随与巡抚书吏都在等一句明话：县册疑点由谁先启动查验，第一道命令如何传下去。",
  },
  "DK-P1-RESPONSIBILITY-RECORD": {
    actorRefs: ["actor.xunfu_clerk"],
    prompt: "巡抚书吏听完，没有去碰那只空回文匣，只躬身问道：\"大人既肯担这三日之责，卑职只问一句——这番话准备怎样写进正式回文，是由总督独自具名，还是请巡抚共同具名？\"",
    variants: [
      {
        variantId: "existing-execution-reply",
        when: [
          {
            entityKind: "DOCUMENT",
            entityRef: "document.reform_execution_record",
            field: "accessState",
            operator: "EQ",
            expectedValue: "WRITTEN",
          },
        ],
        actorRefs: ["actor.xunfu_clerk"],
        prompt: "巡抚书吏捧着已经合拢的回文匣，没有退下。他问：清流试办的边界已经由总督写定，三日内复核若有延误，是请巡抚在这份回文上共同具名，还是另具责任说明，由督抚各担其责？",
      },
    ],
  },
  "DK-P1-EVIDENCE-CUSTODY": {
    actorRefs: ["actor.qingliu_magistrate", "actor.xunfu_aide"],
    prompt: "清流县令与巡抚幕僚把争执落到县册证据链上：原件由谁保管，是否先制作一份由双方见证的抄件，开册时又由谁在场。",
    variants: [
      {
        variantId: "existing-register-copy",
        when: [
          {
            selectorKind: "STATE_PATH",
            statePath: "evidence.copyStatus",
            operator: "NEQ",
            expectedValue: "NONE",
          },
        ],
        actorRefs: ["actor.qingliu_magistrate", "actor.xunfu_aide"],
        prompt: "清流县令与巡抚幕僚把争执落到县册证据链上：已经制作的见证抄件与原件分别由谁保管，下一次开册时又由谁在场。",
      },
    ],
  },
  "DK-P1-WITNESS-ACCESS": {
    actorRefs: ["actor.reform_clerk", "actor.xunfu_aide"],
    prompt: "改桑书吏已经成为各方都想接触的经手人；眼下必须定下谁能问他、在哪里问、谁在场见证。",
  },
  "DK-P1-REVIEW-AUTHORITY": {
    actorRefs: ["actor.xunfu_aide", "actor.qingliu_magistrate"],
    prompt: "巡抚幕僚要求先说清复核由谁主持；县令也等着知道自己是经办、见证，还是只能交出材料。",
  },
  "DK-P1-DISCLOSURE-SCOPE": {
    actorRefs: ["actor.xunfu_aide"],
    prompt: "巡抚幕僚索要县册异常和书吏说法的范围；总督必须决定哪些可以共享，哪些仍要封住。",
  },
  "DK-P1-GRAIN-SOURCE": {
    actorRefs: ["actor.qingliu_magistrate", "actor.jiangnan_merchant_head"],
    prompt: "县令报官仓难支，商会会首却说粮船可以立刻开来；厅上等总督决定第一批救粮从哪里来。",
  },
  "DK-P1-RELIEF-PRIORITY": {
    actorRefs: ["actor.qingliu_magistrate"],
    prompt: "粮数有限，县令请总督定下第一批粮先给谁；不同次序会让另一处饥情或春种继续承压。",
  },
  "DK-P1-MERCHANT-CONDITIONS": {
    actorRefs: ["actor.jiangnan_merchant_head"],
    prompt: "商会会首把粮路与条件一并摆上案头；总督必须决定官府接受什么，又明确拒绝什么。",
  },
  "DK-P1-LAND-SAFEGUARD": {
    actorRefs: ["actor.qingliu_magistrate", "actor.jiangnan_merchant_head"],
    prompt: "粮价已经逼近田契，县令与商会都等着总督划出灾期买田和改桑指标的边界。",
  },
  "DK-P1-REPORT-AUTHORSHIP": {
    actorRefs: ["actor.xunfu_aide"],
    prompt: "第一份入京叙述即将成文，巡抚幕僚要求先定由谁起草、由谁具名，分歧如何写进去。",
  },
  "DK-P1-RESPONSIBILITY-SCOPE": {
    actorRefs: ["actor.xunfu_aide", "actor.qingliu_magistrate"],
    prompt: "奏报不能只写事成与不成；厅上必须定下总督、巡抚、县令和经手人各自承担哪一段责任。",
  },
  "DK-P1-EVIDENCE-ATTACHMENT": {
    actorRefs: ["actor.qingliu_magistrate", "actor.reform_clerk"],
    prompt: "奏报正文之外还能附什么，已经牵动县册保管人与书吏安危；总督必须确定附件边界。",
  },
  "DK-P1-CAPITAL-CHANNEL": {
    actorRefs: ["actor.xunfu_aide"],
    prompt: "奏报和附件已经逼近出府时刻，巡抚幕僚追问它走哪条入京渠道，沿途责任怎样留下记录。",
  },
};

const kernelProtectedNarratives = {
  "DK-P1-EXECUTION-SCOPE": [
    "总督把放行边界当厅写定：只准清流县先办一批，并在给巡抚的回文中明载，不得趁百姓急难压价买田。",
    "总督准巡抚先行放开改桑，但把三日复核和县令逐日具报同时写进了执行条件。",
    "总督的手没有伸向印盒。他看着屏风外的巡抚书吏，说道：\"今日仍不签。清流县封存的回报未到，此事不再往前走。\"\n\n书吏刚要开口，总督又道：\"朝廷三日之限若因此有误，责在本督，不累旁人。\"",
  ],
  "DK-P1-REVIEW-INITIATION": [
    "总督把封缄令牌交给县令亲随，命清流县先封档房、记清在场人；原册暂由县令看守，不许擅自启封。",
    "总督定下督抚共同查验：双方各派一名经手人到清流县，当场核对原册和改桑名册。",
    "总督准县令先在县内自查两日，只将异常页封样送来，原册暂不离县衙。",
  ],
  "DK-P1-RESPONSIBILITY-RECORD": [
    "总督把暂缓签发的缘由和督抚各自应负的责任逐项写入回文，并注明县册复核主持权尚待议定。写毕，他将文书封好，交给巡抚书吏，请巡抚在同一份回文上具名。",
    "总督将当前改桑边界和自己承担的责任写入回文，独自具名，又把巡抚催办的原文列作附件，一并留档。",
    "总督另具回文，把督抚在改桑执行与复核上的分歧逐项写明，并分别列出各自承担的事项。",
  ],
  "DK-P1-EVIDENCE-CUSTODY": [
    "总督命清流县将原册留在档房，等三方见证到场后再换封并各留封样；眼下只是命令已经发出，换封尚未完成。",
    "总督命清流县等两名见证人到场后抄出样册，并逐页记明抄录人和抄录时辰；眼下尚未开始抄录。",
    "总督命清流县在见证下将可疑册页整封移交总督府，县衙留下交接清单；眼下原册仍在清流县档房，尚未起运。",
  ],
  "DK-P1-WITNESS-ACCESS": [
    "总督以核对公文为名，把改桑书吏秘密带到总督府，不公开他的证人身份。",
    "总督准督抚双方各派一人在场，当面对照书吏说法和样册。",
    "总督命县令先收一份封缄书面供述，待初始说法留存后再决定是否传人。",
  ],
  "DK-P1-REVIEW-AUTHORITY": [
    "总督定下由总督府主持复核、开列清单，巡抚和县令只能派见证人参加。",
    "总督准设督抚共同复核案，往后每次开册和抄录都须双方经手人同时具名。",
    "总督命县令先按总督府列出的项目初核，督抚随后只审结果和原件。",
  ],
  "DK-P1-DISCLOSURE-SCOPE": [
    "总督只向巡抚说明册页存在差异，没有透露书吏和密供所在。",
    "总督准将带见证记录的样册交巡抚查验，原件仍由现保管人封存。",
    "总督以保管链未稳为由暂不披露细节，只答应限时提交复核结果。",
  ],
  "DK-P1-GRAIN-SOURCE": [
    "总督决定先动官仓并向邻省借粮，所有借据由总督府承担。",
    "总督准商会限量开仓，官府为粮路作保，但明令不得借粮价换购灾民田地。",
    "总督定下官仓先稳城内、商会负责外县运输，两路账目分开核销。",
  ],
  "DK-P1-RELIEF-PRIORITY": [
    "总督命第一批现粮先发给无存粮、也无田可抵的百姓。",
    "总督命人先留下种粮和插秧所需，再按户发放余粮。",
    "总督决定先稳杭州和清流县米市，再向外围灾村分批送粮。",
  ],
  "DK-P1-MERCHANT-CONDITIONS": [
    "总督接受商会的粮食和运力，同时明令灾期不得收购或代持民田。",
    "总督只向商会购买船队运输，按程付银，不给收丝或购田优先权。",
    "总督拒绝商会提出的担保和优先权，改走官府借调粮路。",
  ],
  "DK-P1-LAND-SAFEGUARD": [
    "总督定下灾期田契的公开底价，并命县衙逐契登记买受人。",
    "总督命赈期内暂禁商会和大户购入灾民田，先以借粮维持。",
    "总督把改桑指标分到更多非灾县，清流县只承担有限份额。",
  ],
  "DK-P1-REPORT-AUTHORSHIP": [
    "总督决定与巡抚共同具奏，执行、复核和粮食分歧逐项写明，双方确认后共同具名入京。",
    "总督决定独自具奏，并把巡抚催办和拒签文书一并列作附件。",
    "总督准巡抚另报，自己同时送出复核结果和异议，两份奏报各自具名。",
  ],
  "DK-P1-RESPONSIBILITY-SCOPE": [
    "总督命奏报写明，执行与复核均由自己裁定，不把责任推给县令。",
    "总督把责任分项写定：改桑进度由巡抚具名，复核和赈济由总督具名。",
    "总督命奏报如实列清县令、书吏和各级经手事项，只陈事实，不先定罪。",
  ],
  "DK-P1-EVIDENCE-ATTACHMENT": [
    "总督决定随奏附上见证抄出的样册、封条记录和原件保管人名单。",
    "总督决定附件只列田亩数字和日期差异，并声明原册仍在复核，不附人名推断。",
    "总督决定暂不附书吏供述，只附保管链，并说明人证需要保护。",
  ],
  "DK-P1-CAPITAL-CHANNEL": [
    "总督命首报走正式通政渠道，沿途逐站记录交接和到达时辰。",
    "总督用自己的封印加封急递，指定送达上级，并在府中留下副本和交接记录。",
    "总督命正本走正式渠道、摘要另走密奏，两份互列封号，以便相互核验。",
  ],
};

const kernelFallbackContinuations = {
  "DK-P1-EXECUTION-SCOPE": [
    "巡抚书吏把回文收入匣中，却没有退下。他隔着屏风问道：清流县既只准先办一批，复核若误了三日之限，这份责任是由总督独自写明，还是请巡抚在同一份正式回文上共同具名。问完，他仍捧着回文匣候在原处。",
    "巡抚书吏听明先行放开的条件，随即追问：三日后复核册若仍不齐，催办、放行与补正的责任准备怎样写进正式回文，是由总督独自具名，还是请巡抚共同具名。",
    "巡抚书吏听完，没有去碰那只空回文匣，只躬身问道：\"大人既肯担这三日之责，卑职只问一句——这番话准备怎样写进正式回文，是由总督独自具名，还是请巡抚共同具名？\"",
  ],
  "DK-P1-RESPONSIBILITY-RECORD": [
    "巡抚幕僚没有绕弯，只说巡抚不肯在总督昨日写成的正式回文上共同具名。清流县令听完没有争辩，改桑书吏也停了笔。幕僚随后问，即将开始的县册复核究竟由总督府主持，还是督抚共同主持；县令也等着知道自己是经办、见证，还是只能交出材料。",
    "巡抚幕僚对总督昨日单独具名的责任写法不置可否，只把目光转向清流县令。幕僚先问的不是改桑进度，而是清流县册的复核究竟由谁主持；县令也等总督说清县衙在这场复核中是经办、见证，还是只交材料。",
    "巡抚幕僚当面说明，巡抚仍坚持原先的催办立场；清流县令听完没有接话，改桑书吏也停了笔。幕僚随即要求先说清复核由谁主持，县令也问县衙究竟是经办、见证，还是只交材料。",
  ],
};

const kernelPlayerVisibleFallbacks = {
  "DK-P1-EXECUTION-SCOPE": [
    {
      PLAYER_RESULT: "总督把放行边界当厅写定：只准清流县先办一批，并在给巡抚的回文中明载，不得趁百姓急难压价买田。",
      WORLD_PRESSURE: "纸上的墨迹还没有干透，巡抚书吏便上前接过回文，当着总督的面收入匣中。匣盖合上，他却没有告退，只把匣子横托在胸前。清流一县可以先办，压价买田也有了禁令；可三日复核若赶不上，今日这道边界是谁催成、又由谁担责，回文里仍没有写明。",
      DECISION_STOP: "书吏隔着屏风躬身道：\"清流试办，卑职可以照此回禀。只是三日之限一到，复核若误，朝廷问的便不只是田亩。敢问大人，这份责任是由总督独自写明，还是请巡抚在同一份回文上共同具名？\"说完，他仍捧着回文匣候在原处。"
    },
    {
      PLAYER_RESULT: "总督准巡抚先行放开改桑，但把三日复核和县令逐日具报同时写进了执行条件。",
      WORLD_PRESSURE: "巡抚书吏听见“先行放开”，神色终于松了一线；待听到三日复核和逐日具报，他按在回文匣上的手又停住了。急令可以先走，补正却从这一刻起有了期限。若三日后材料仍不齐，先行放开的好处归谁，留下的缺口又算在谁头上，督抚之间还没有一句明话。",
      DECISION_STOP: "书吏把话问得很慢：\"大人，催办出自巡抚衙门，放行却要从总督府出去。三日后若仍补不齐，这份责任是由总督独自具名，还是请巡抚在同一份回文上共同具名？\""
    },
    {
      PLAYER_RESULT: "总督的手没有伸向印盒。他看着屏风外的巡抚书吏，说道：\"今日仍不签。清流县封存的回报未到，此事不再往前走。\"\n\n书吏刚要开口，总督又道：\"朝廷三日之限若因此有误，责在本督，不累旁人。\"",
      WORLD_PRESSURE: "巡抚书吏听完，没有去碰那只空回文匣。总督肯担延误之责，便等于把巡抚催办的压力暂时挡在了自己名下；可口头一句“责在本督”，出了这间内厅便可能各有说法。书吏仍躬身候着，显然是在等一份可以带回巡抚衙门的文字。",
      DECISION_STOP: "片刻后，他才道：\"大人既肯担这三日之责，卑职不敢再催落印。只是这番话准备怎样写进正式回文——由总督独自具名，还是请巡抚共同具名？\""
    }
  ],
  "DK-P1-RESPONSIBILITY-RECORD": [
    {
      PLAYER_RESULT: "总督把暂缓签发的缘由和督抚各自应负的责任逐项写入回文，并注明县册复核主持权尚待议定。写毕，他将文书封好，交给巡抚书吏，请巡抚在同一份回文上具名。",
      SCENE_TRANSITION: "次日巳时，杭州总督府签押房内，清流县令、改桑书吏与巡抚幕僚已经候在案前。",
      WORLD_PRESSURE: "总督入内时，巡抚幕僚没有说一句寒暄，只把昨日的答复说得明白：巡抚不肯在那份回文上共同具名。清流县令原本站在案前，听见这句话便把身子又低了些；改桑书吏刚提起笔，也停在纸面上方。督抚没能共担昨日的责任，今日这场复核由谁掌手，便再也不是一句程序上的安排。",
      DECISION_STOP: "巡抚幕僚拱手道：\"联署既未成，下官便替中丞先问清下一件事。县册复核，是由总督府主持，还是督抚共同主持？清流县衙在其中，是经办、是见证，还是只交出材料便退在一旁？\"县令与书吏都没有接话，只等总督定下这第一道规矩。"
    },
    {
      PLAYER_RESULT: "总督将当前改桑边界和自己承担的责任写入回文，独自具名，又把巡抚催办的原文列作附件，一并留档。",
      SCENE_TRANSITION: "次日巳时，杭州总督府签押房内，清流县令、改桑书吏与巡抚幕僚已经候在案前。",
      WORLD_PRESSURE: "巡抚幕僚对总督昨日单独具名的回文不置可否，既不说巡抚认可，也不替巡抚反驳。他只把目光转向清流县令。县令被这一眼看得不敢先开口：总督已经独自担下行文之责，若复核仍由县衙自办，日后册页出了差错，责任便会顺着这道目光落到他身上。",
      DECISION_STOP: "幕僚终于道：\"昨日的回文既由制台独署，今日便只问复核。究竟由总督府主持，还是督抚共同主持？清流县衙是经办、见证，还是只交材料？\"签押房里无人出声，三方都在等总督把权责划开。"
    },
    {
      PLAYER_RESULT: "总督另具回文，把督抚在改桑执行与复核上的分歧逐项写明，并分别列出各自承担的事项。",
      SCENE_TRANSITION: "次日巳时，杭州总督府签押房内，清流县令、改桑书吏与巡抚幕僚已经候在案前。",
      WORLD_PRESSURE: "巡抚幕僚当面说明，巡抚仍坚持原先的催办立场，对总督写明的分歧也没有收回。清流县令听完没有接话，改桑书吏也停了笔。昨日尚能留在两封文书里的争执，如今已经摆到了同一间签押房里；谁主持复核，便是谁先有资格解释县册。",
      DECISION_STOP: "幕僚把手一拱：\"分歧既已写明，下官便请大人再写明一件——复核由谁主持？清流县衙在其中，是经办、见证，还是只交材料？\"县令抬眼看向总督，等着自己的位置被当厅定下。"
    }
  ],
  "DK-P1-REVIEW-AUTHORITY": [
    {
      PLAYER_RESULT: "总督定下由总督府主持复核、开列清单，巡抚和县令只能派见证人参加。",
      WORLD_PRESSURE: "巡抚幕僚听完，慢慢收回了拱着的手，没有再争主持之名。他只提醒在场诸人：总督府既掌清单，往后谁先接触原册、谁留下封样、谁能证明册页未被调换，都要一笔一笔说得清。清流县令听到这里，神色反而更紧——主持权已经定了，原册仍在县里，第一段保管责任还压在他身上。",
      DECISION_STOP: "县令上前半步：\"下官领命。只是原册眼下仍在清流县档房，敢问制台：是仍留档房，等三方到场换封；还是当场抄出见证副本；抑或整封移交总督府？\"三条路的风险都摆在案前，巡抚幕僚也转过头来等候。"
    },
    {
      PLAYER_RESULT: "总督准设督抚共同复核案，往后每次开册和抄录都须双方经手人同时具名。",
      WORLD_PRESSURE: "巡抚幕僚当即应下“双方同时具名”，清流县令却没有立刻称是。共同复核锁住了任何一方私自动册的机会，也意味着往后每一次启封、抄录和核对，都要等另一方的人到场。眼下原册尚在清流县，第一步若定得不清，互相制约便会先变成互相等候。",
      DECISION_STOP: "县令躬身问道：\"既要双方经手人同时具名，原册该放在哪里才算两边都信得过？是仍留档房换封，当场抄出见证副本，还是整封移交总督府？\"幕僚没有替巡抚回答，只看向总督。"
    },
    {
      PLAYER_RESULT: "总督命县令先按总督府列出的项目初核，督抚随后只审结果和原件。",
      WORLD_PRESSURE: "清流县令接下初核之责，脸上却没有半分轻松。他当厅说明：县衙先查，固然省去督抚两边逐页相持；可原册若仍由县衙独守，初核期间任何缺页、换页或数字争议，最后都可能算在他头上。巡抚幕僚没有反驳，只等县令把这份风险说完。",
      DECISION_STOP: "县令道：\"请制台再定原册的处置。是仍留档房，由三方见证换封；是当场抄出见证副本；还是整封移交总督府？原册放在哪里，初核之责才有凭据。\""
    }
  ],
  "DK-P1-EVIDENCE-CUSTODY": [
    {
      PLAYER_RESULT: "总督命清流县将原册留在档房，待三方见证到场后再换封并各留封样。",
      WORLD_PRESSURE: "县令领命，却把“尚未换封”四个字说得格外清楚。原册仍在清流县档房，三方见证赶到以前，保管责任仍在县衙；命令只是定下下一步，并没有把换封提前变成已经完成的事实。站在一旁的改桑书吏听见众人谈到册页经手，脸色渐渐发白。他知道哪些页曾从自己手中过，也因此成了这条证据链上最容易先被人找到的一环。",
      DECISION_STOP: "县令看了书吏一眼，低声问道：\"原册既先留县中，这个人该如何处置？是由总督府秘密保护后问话，交督抚双方共同询问，还是先只收一份封缄书面供述？\"书吏垂着头，签押房里没有人替他回答。"
    },
    {
      PLAYER_RESULT: "总督命清流县等两名见证人到场后再抄出样册，并逐页记明抄录人和时辰。",
      WORLD_PRESSURE: "县令把“见证到场后再抄”复述了一遍，确认眼下还没有任何副本。第二条证据链要从见证人到场、第一笔抄录开始，不能凭一句命令倒推出已经存在的样册。改桑书吏站在案边，听见往后每页都要记下抄录人与时辰，便明白自己过去经手册页的次序很快会被督抚双方同时追问。",
      DECISION_STOP: "县令问道：\"抄录一开始，这名书吏便再藏不住。是先由总督府秘密保护问话，还是请督抚双方共同询问；若都不妥，便先收一份封缄书面供述？\"巡抚幕僚看着书吏，总督必须先决定谁能接触他。"
    },
    {
      PLAYER_RESULT: "总督命清流县在见证下将可疑册页整封移交总督府，县衙留下交接清单。",
      WORLD_PRESSURE: "清流县令领命后先把界限说清：原册眼下仍在县档房，只有见证人在场、交接清单写成、整封真正起运以后，途中和入府后的保管责任才转到总督府。巡抚幕僚听见“交接清单”，没有再争原册去向，只把目光落在改桑书吏身上。册可以等见证移交，人却可能在册到以前先改口或失去踪影。",
      DECISION_STOP: "县令顺着他的目光看去：\"制台，原册移交已有章程，这名经手书吏却不能无人过问。是先秘密保护问话，交督抚双方共同询问，还是只收一份封缄书面供述？\""
    }
  ],
  "DK-P1-WITNESS-ACCESS": [
    {
      PLAYER_RESULT: "总督以核对公文为名，把改桑书吏秘密带到总督府，不公开他的证人身份。",
      WORLD_PRESSURE: "书吏被带出签押房时，巡抚幕僚没有出声阻拦，只把案上的复核清单慢慢合上。人既由总督府暗中保护，巡抚一方便看不到他的原始说法；可若总督迟迟不给出可核对的材料，这番保护也会被说成私藏证人。清流县令站在门边，知道自己回县以后仍要独自守着原册。",
      DECISION_STOP: "巡抚幕僚等脚步声远了才道：\"人可以暂不露面，事情却不能只在总督府里说。县册究竟哪里可疑，抚院今日能知道多少？\"他把问题留在案上，等总督划定披露的边界。"
    },
    {
      PLAYER_RESULT: "总督准督抚双方各派一人在场，当面对照书吏说法和样册。",
      WORLD_PRESSURE: "改桑书吏抬头看了看巡抚幕僚，又看向清流县令，脸上的惧色并没有因为多了见证人而减轻。督抚同时在场，任何一方都难以单独改写他的说法；同样，他说出的每一句话也会立刻成为两边争夺责任的凭据。县令先把手按在案沿，提醒众人原册仍未开封。",
      DECISION_STOP: "巡抚幕僚道：\"既然双方都能听，人证的去处便不必再争。只请制台明示：抚院可以先看异常范围，还是连样册和见证记录也一并查验？\""
    },
    {
      PLAYER_RESULT: "总督命县令先收一份封缄书面供述，待初始说法留存后再决定是否传人。",
      WORLD_PRESSURE: "县令领命，将这件事记在自己的责任名下。封缄供述能留下书吏最初的说法，却也把第一段保管链重新压回县衙；在供述真正送到以前，总督府和巡抚衙门谁都看不到内容。巡抚幕僚听罢没有反对，只问这份等待要有多大的边界。",
      DECISION_STOP: "他朝总督拱手：\"人证暂不传，抚院可以等。但县册异常是否存在、复核何时回报，总该有一句能带回去的话。大人准备公开到哪一步？\""
    }
  ],
  "DK-P1-DISCLOSURE-SCOPE": [
    {
      PLAYER_RESULT: "总督只向巡抚说明册页存在差异，没有透露书吏和密供所在。",
      SCENE_TRANSITION: "申时将近，议事移到杭州总督府仪门内厅。清流县令与江南商会会首已经在堂下候着，案边摆的却不再只是县册，还有城中催粮的呈报。",
      WORLD_PRESSURE: "巡抚幕僚得到的只有一条尚待复核的异常，既不能据此定罪，也无法接触人证。他将不满压在袖中，转而把粮价和三日限期一并摆到总督面前。清流县令说官仓难以久支；商会会首却立即接话，说粮船和脚力都能筹措，只等官府开口。",
      DECISION_STOP: "县令与会首隔着半间厅彼此看了一眼。一个问官府先拿什么救急，一个等着说出自己的条件。第一批粮从官仓、商会还是两路并行，必须由总督当场定下。"
    },
    {
      PLAYER_RESULT: "总督准将带见证记录的样册交巡抚查验，原件仍由现保管人封存。",
      SCENE_TRANSITION: "申时将近，议事移到杭州总督府仪门内厅。巡抚幕僚收下获准查验的范围，清流县令与江南商会会首也已在堂下候着。",
      WORLD_PRESSURE: "巡抚一方终于取得一条可以自行核对的材料入口，督抚间的戒心略松了一线，原件的保管责任却没有改变。话还未说完，清流县令便把城中缺粮的压力接了上来；商会会首随即表示，只要官府肯作保，商粮与运力都能入局。县册之争尚未停，粮食已经逼着众人换一张桌子谈价。",
      DECISION_STOP: "总督面前摆出了两条路：先动官仓和邻省借粮，还是让商会立即开仓运粮。县令与会首都在等他先定第一批救粮的来源。"
    },
    {
      PLAYER_RESULT: "总督以保管链未稳为由暂不披露细节，只答应限时提交复核结果。",
      SCENE_TRANSITION: "申时将近，议事移到杭州总督府仪门内厅。巡抚幕僚仍空着手，清流县令与江南商会会首已经在堂下候着。",
      WORLD_PRESSURE: "巡抚幕僚没有再追问人证，只说限时回报也要有人担责。清流县令趁这句话未落，便报官仓已难承受继续拖延；商会会首则把能调来的粮路说得十分从容。复核材料仍被封在总督手里，救粮却不能同样封着等候。谁先拿出粮，谁便会先取得说话的分量。",
      DECISION_STOP: "会首躬身道：\"官粮若来得及，商会不敢争先；若来不及，请制台给一句准话。\"县令也看向总督，第一批粮的来源已经不能再拖。"
    }
  ],
  "DK-P1-GRAIN-SOURCE": [
    {
      PLAYER_RESULT: "总督决定先动官仓并向邻省借粮，所有借据由总督府承担。",
      WORLD_PRESSURE: "清流县令先松了一口气，随即又把头低下去：官仓能救眼前，邻省的粮何时到、借据将来由什么偿还，都要落在总督府名下。商会会首没有因自己被挡在第一步之外而退席，只说官府若缺船、缺脚力，商会仍可出手。那句话说得像帮忙，也像重新开的价。",
      DECISION_STOP: "会首道：\"粮可以不由商会垫，路总要有人走。若借我等的船和人，官府肯给什么，又明确不肯给什么？\"总督必须决定是否让商会进入救粮链。"
    },
    {
      PLAYER_RESULT: "总督准商会限量开仓，官府为粮路作保，但明令不得借粮价换购灾民田地。",
      WORLD_PRESSURE: "会首应下开仓，却在听见不得以粮换田时停了片刻。他没有当厅争辩，只问官府的担保是否包括船运、损耗与途中查验。清流县令看着他，明白商会既把粮送进灾县，日后便会拿这份功劳换取别的入口。禁止买田守住了一道门，粮路和丝路仍在门外等价。",
      DECISION_STOP: "会首把话说得客气：\"田契既不许碰，商会便只问运输和日后的交易资格。制台是只买粮与运力，还是还肯给别的优先？\""
    },
    {
      PLAYER_RESULT: "总督定下官仓先稳城内、商会负责外县运输，两路账目分开核销。",
      WORLD_PRESSURE: "县令与会首各自领下半条粮路，厅上看似少了一场争执，实际却多了两本必须互相核对的账。城内若先稳，外县会问为何迟到；商粮若走得更快，又会有人说官府把灾县交给了商人。会首只关心一件事：他出了船和人以后，能从官府得到什么明确回报。",
      DECISION_STOP: "他向前一步：\"两路账可以分开，商会的条件也请分开写明。只给运费，还是允许以后优先收丝；哪些权利，制台今日便该划清。\""
    }
  ],
  "DK-P1-MERCHANT-CONDITIONS": [
    {
      PLAYER_RESULT: "总督接受商会的粮食和运力，同时明令灾期不得收购或代持民田。",
      WORLD_PRESSURE: "会首当厅应命，答得没有半分迟疑。清流县令却盯着“代持”二字又问了一遍，显然担心田契即使不落在商会名下，也会绕到别人的名下。商粮可以启程，土地的边界却还只是一道原则；灾民一旦拿田契换粮，县衙凭什么认定价钱公平、买受人真实，仍没有章程。",
      DECISION_STOP: "县令道：\"禁令要落到每一张田契上，才不至于只禁了商会的名字。请制台再定，是设公开底价逐契登记，还是灾期索性暂禁购田？\""
    },
    {
      PLAYER_RESULT: "总督只向商会购买船队运输，按程付银，不给收丝或购田优先权。",
      WORLD_PRESSURE: "会首听明白自己只是承运人，笑意淡了些，却仍然接下差事。他既拿不到收丝与购田入口，便会把每一程运费、每一次耽搁都算得更清。县令担心的则是另一层：商会不能买田，不等于别的大户不会趁灾压价，灾民手里的田契仍可能在粮到以前被拿走。",
      DECISION_STOP: "县令请总督把禁令从商会扩到所有买受人：是设灾期底价并逐契登记，还是暂禁大户购入民田？"
    },
    {
      PLAYER_RESULT: "总督拒绝商会提出的担保和优先权，改走官府借调粮路。",
      WORLD_PRESSURE: "会首没有失礼，只收回了方才摆在案前的条件。商会退出，官府也失去了眼前最便利的一段粮路；借调的粮要走多久尚无定数，灾县里的田契却不会等官文。清流县令直言，越是缺粮，越有人愿意用一纸低价契换一家人的口粮。",
      DECISION_STOP: "县令问道：\"商会可以挡在门外，暗中的买主却挡不住。灾期田契究竟设底价、暂禁交易，还是把改桑压力移出清流？请制台先定一条。\""
    }
  ],
  "DK-P1-LAND-SAFEGUARD": [
    {
      PLAYER_RESULT: "总督定下灾期田契的公开底价，并命县衙逐契登记买受人。",
      WORLD_PRESSURE: "清流县令领命时没有说这道办法能救下所有人的田，只说从此每一份低价成交都要有人在册上留下名字。商会会首也没有反对，公开底价并未封死交易，只让暗中代持和层层转手多了一道可追查的痕迹。粮仍有限，田契暂时有了门槛，最先领粮的人却还没有定。",
      DECISION_STOP: "县令把赈册推到案前：\"现粮不够同时顾全城里米市、外围灾村和来年的种粮。第一批先给谁，请制台定次序。\""
    },
    {
      PLAYER_RESULT: "总督命赈期内暂禁商会和大户购入灾民田，先以借粮维持。",
      WORLD_PRESSURE: "会首听见禁购，脸上终于露出一丝冷意，却仍拱手称是。县令知道这道禁令保住了田契，也会让愿意垫粮的人少掉许多；官府必须拿自己的粮和信用填上空缺。厅外催赈的呈报一封接一封送来，谁先得到有限的现粮，已经不能再用一条笼统的“先救百姓”带过。",
      DECISION_STOP: "县令请示：\"是先救已经断粮的人，先保种粮，还是先稳住城中米市？三处都急，只能先定一处。\""
    },
    {
      PLAYER_RESULT: "总督把改桑指标分到更多非灾县，清流县只承担有限份额。",
      WORLD_PRESSURE: "清流县令当厅谢命，巡抚幕僚的神色却沉了下来。灾县的压力被减轻，未受灾各县却会问为什么替清流分担，巡抚也会追究总督是否借赈灾改动了既定进度。指标可以挪，眼前的粮不能跟着纸面一起挪走。清流仍要决定有限粮食先保哪一头。",
      DECISION_STOP: "县令道：\"清流少担桑田，百姓总算能缓一口气。可现粮仍只够先救一处：断粮户、种粮，还是城中米市？\""
    }
  ],
  "DK-P1-RELIEF-PRIORITY": [
    {
      PLAYER_RESULT: "总督命第一批现粮先发给无存粮、也无田可抵的百姓。",
      WORLD_PRESSURE: "县令应下以后，先把最穷的一批人圈进赈册。这个次序保住的是今晚就可能断炊的人，却不能立刻压住城中米价，也顾不上所有春种。巡抚幕僚看着那本赈册，只问日后入京时，谁来解释为何先救人而没有先稳住改桑和市面。粮食的次序，已经变成第一份奏报里的责任次序。",
      DECISION_STOP: "首批救粮已经抵县；平码、验收和发放若同时办理，今日只能开一半仓门，若先发后验，经手账目就会留下不能即时互证的空档。"
    },
    {
      PLAYER_RESULT: "总督命人先留下种粮和插秧所需，再按户发放余粮。",
      WORLD_PRESSURE: "县令把一部分粮从赈册中划出，堂下立刻有人低声吸了口气。保住春种，是替数月后的生计留路；可今日断粮的人不会因为数月后的收成少饿一顿。巡抚幕僚没有评价这个轻重，只提醒总督：朝廷最先看到的不会是全部后果，而是谁在第一份文书里怎样解释这项取舍。",
      DECISION_STOP: "首批救粮已经抵县；平码、验收和发放若同时办理，今日只能开一半仓门，若先发后验，经手账目就会留下不能即时互证的空档。"
    },
    {
      PLAYER_RESULT: "总督决定先稳杭州和清流县米市，再向外围灾村分批送粮。",
      WORLD_PRESSURE: "会首听见先稳米市，立即开始盘算船路；县令却提醒，外围灾村会更晚见到粮。城里价格若能压下，官府可以争得时间；若外围先有人撑不住，这份时间便会变成追责的证据。巡抚幕僚把两边的利害都听完，随后把话题落到即将入京的第一份叙述上。",
      DECISION_STOP: "首批救粮已经抵县；平码、验收和发放若同时办理，今日只能开一半仓门，若先发后验，经手账目就会留下不能即时互证的空档。"
    }
  ],
  "DK-P1-REPORT-AUTHORSHIP": [
    {
      PLAYER_RESULT: "总督决定与巡抚共同具奏，执行、复核和粮食分歧逐项写明，双方确认后共同具名入京。",
      WORLD_PRESSURE: "巡抚幕僚没有立即答应，只说共同具名也要共同看见支撑奏报的材料。清流县令站在一旁，明白附件越能追到原件与经手人，首报越有分量，县衙和书吏也越难退回幕后。共同具奏先统一了谁来写，接下来必须划定什么可以随奏入京。",
      DECISION_STOP: "幕僚把奏稿递到案边：\"正文既要同奏，附件也请一并说清。是附见证样册和保管记录，还是只列异常范围；书吏供述，要不要随报入京？\""
    },
    {
      PLAYER_RESULT: "总督决定独自具奏，并把巡抚催办和拒签文书一并列作附件。",
      WORLD_PRESSURE: "巡抚幕僚听完便退开半步，不再替巡抚参与起草。总督抢得了第一份完整叙述的控制权，也把材料取舍先压在自己名下；巡抚若另报，督抚之争便会从附件多少开始。县令最关心的，是原件保管人与书吏供述会不会随独奏一起进入京师。",
      DECISION_STOP: "县令躬身问道：\"制台独奏，下官不敢置喙。只请先定附件：附见证样册与保管记录，还是只列异常；书吏的说法，要不要随报？\""
    },
    {
      PLAYER_RESULT: "总督准巡抚另报，自己同时送出复核结果和异议，两份奏报各自具名。",
      WORLD_PRESSURE: "巡抚幕僚当即应下，督抚两边从这一刻起不再共享一支笔。谁的文书先到、谁的附件更完整，便可能先替浙江定性。清流县令和改桑书吏夹在两份奏报之间，更急着知道总督这一份会把哪些材料和人名送入京师。",
      DECISION_STOP: "县令低声道：\"既然两边各报，总督这一份附什么更要先定。是附样册与保管记录，还是只列异常；书吏供述是否随报？\""
    }
  ],
  "DK-P1-RESPONSIBILITY-SCOPE": [
    {
      PLAYER_RESULT: "总督命奏报写明，执行与复核均由自己裁定，不把责任推给县令。",
      WORLD_PRESSURE: "清流县令听完，肩背终于松了一分；巡抚幕僚却提醒，总督既把裁定之责都揽在自己名下，递送途中每一处失误也会沿着这份署名追回来。正文、附件与责任都已经定下，只剩谁经手送出、沿途如何留下不能抵赖的记录。",
      DECISION_STOP: "幕僚问道：\"首报是走正式通政渠道逐站交接，还是加封急递；若两边都不放心，是否让正本与摘要分路互证？\""
    },
    {
      PLAYER_RESULT: "总督把责任分项写定：改桑进度由巡抚具名，复核和赈济由总督具名。",
      WORLD_PRESSURE: "巡抚幕僚没有替巡抚当场认下，只把这项分责原样记住。若巡抚拒绝具名，分责本身便会成为督抚争执的新证据；若巡抚接受，两边都要对首报的送达负责。正文、附件和责任边界已经备齐，现在谁先把它送入京师，将决定这份分责能否先占住名分。",
      DECISION_STOP: "幕僚道：\"请制台再定最后一道：走正式通政、加封急递，还是正本与摘要分路互证？\""
    },
    {
      PLAYER_RESULT: "总督命奏报如实列清县令、书吏和各级经手事项，只陈事实，不先定罪。",
      WORLD_PRESSURE: "县令没有因“不先定罪”而安心。他与书吏的名字一旦进入首报，即使只是经手，也会先成为京师追问的入口。巡抚幕僚则提醒，既然经手链已经写入正文，递送链也必须同样清楚；否则文书途中一旦迟延或被换，所有人的名字都会失去凭据。",
      DECISION_STOP: "总督面前只剩递送渠道：正式通政逐站交接、加封急递，还是正本与摘要分路互证？"
    }
  ],
  "DK-P1-EVIDENCE-ATTACHMENT": [
    {
      PLAYER_RESULT: "总督决定随奏附上见证抄出的样册、封条记录和原件保管人名单。",
      WORLD_PRESSURE: "县令逐项核对附件名目，确认原件仍按既定保管链留在浙江。附件越完整，首报越容易被京师采信，也越容易让保管人和经手人失去回旋余地。材料边界已经定下，正文里谁对执行、复核与赈济负责，便不能再留作一句含混的“地方自处”。",
      DECISION_STOP: "巡抚幕僚问道：\"附件已经列清，责任也请列清。执行、复核、赈济和各级经手，分别由谁承担；是制台自承，还是逐项写明？\""
    },
    {
      PLAYER_RESULT: "总督决定附件只列田亩数字和日期差异，并声明原册仍在复核，不附人名推断。",
      WORLD_PRESSURE: "县令接受了这道边界，书吏也暂时不必以人证身份出现在京师文书里。可附件越克制，正文里的责任越要明确；否则巡抚另报时，只需指责总督既不交材料、也不认责任，便能先占住名分。",
      DECISION_STOP: "巡抚幕僚道：\"附件既不附人名，正文便请直说谁担执行、谁担复核与赈济。是制台自承，还是把各级经手事项逐项列出？\""
    },
    {
      PLAYER_RESULT: "总督决定暂不附书吏供述，只附保管链，并说明人证需要保护。",
      WORLD_PRESSURE: "书吏的说法被留在浙江，奏报只证明材料如何被看守、谁能接触。这个选择保住了人证，也给巡抚留下质疑：没有供述，保管链究竟保护的是证据，还是保护总督自己的说法。要回答这份质疑，奏报必须先写明谁对每一段处置负责。",
      DECISION_STOP: "县令问：\"人证既留在浙江，正文中的责任便不能再留白。执行、复核、赈济和经手事项，制台准备怎样分担？\""
    }
  ],
  "DK-P1-CAPITAL-CHANNEL": [
    {
      PLAYER_RESULT: "总督命首报走正式通政渠道，沿途逐站记录交接和到达时辰。",
      WORLD_PRESSURE: "文书离开总督府时，交接簿上的第一行已经写下。正式渠道最慢，却让每一站都有人承担接手与转出的责任；巡抚若另有奏报，也只能在同一套朝廷程序里争先。厅中众人望着文书出门，知道浙江危局第一次有了一份不可随意收回的官方叙述。",
      DECISION_STOP: "送文的人刚出府门，巡抚幕僚便取出正式手本：\"首报既已上路，抚院请核对送入京师的是哪一版事实。制台是交一份封号摘要，请巡抚收讫具名；还是不交底稿，只把拒交范围与理由正式留案？\""
    },
    {
      PLAYER_RESULT: "总督用自己的封印加封急递，指定送达上级，并在府中留下副本和交接记录。",
      WORLD_PRESSURE: "急递出府以后，速度与责任同时落在总督名下。副本留在案上，既能证明送出的内容，也会在京师回音到来以前成为巡抚追问的对象。县令和书吏暂时退下，巡抚幕僚却没有告辞；他已经看出，总督是在用更快的送达抢先固定浙江的第一版事实。",
      DECISION_STOP: "急递的脚步尚未远去，巡抚幕僚已经持手本索取底稿。他问总督，是交一份不含人证位置的封号摘要，请巡抚收讫具名；还是拒交底稿，把范围、理由与期限正式留案。"
    },
    {
      PLAYER_RESULT: "总督命正本走正式渠道、摘要另走密奏，两份互列封号，以便相互核验。",
      WORLD_PRESSURE: "两路文书从不同的门离开总督府，一路留下公开交接，一路只让少数人知道去向。互列封号可以防止内容被悄然替换，也把泄露面扩大了一倍。巡抚幕僚看着两名差役先后离府，明白总督没有把浙江的第一版事实押在一条路上。",
      DECISION_STOP: "两路文书离府以后，巡抚幕僚当即要求核对总督送出的那一版事实。他把选择摆明：交一份列明结论、附件与封号的摘要并请巡抚具名收讫，或正式拒交底稿并留下可复核期限。"
    }
  ]
};

const decisionPromptResultCeiling = "只把这一项尚未回答的争点交给玩家；不得替玩家选择，也不得提前写出任何选项的结果。";

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
    { "evidence.chainStatus": "TRACEABLE", "evidence.archiveSealStatus": "RESEAL_ORDERED", "evidence.primaryCustodianRef": "actor.qingliu_magistrate" },
    { "evidence.copyStatus": "WITNESSED_COPY_ORDERED", "witness.accessStatus": "COPY_EXECUTION_PENDING" },
    { "evidence.primaryCustodianRef": "actor.qingliu_magistrate", "evidence.chainStatus": "FRAGILE", "responsibility.governorExposure": { $delta: 1 } },
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

const kernelDurableEffects = {
  "DK-P1-EXECUTION-SCOPE": [
    [
      { type: "DOCUMENT.CREATED", documentId: "document.reform_execution_record" },
      { type: "DOCUMENT.AUTHENTICATED", documentId: "document.reform_execution_record", actorId: "actor.zhejiang_governor" },
      { type: "DOCUMENT.TRANSFERRED", documentId: "document.reform_execution_record", fromActorId: "actor.zhejiang_governor", toActorId: "actor.xunfu_clerk" },
      { type: "ENTITY.HELD_BY", entityId: "document.reform_execution_record", actorId: "actor.xunfu_clerk" },
      { type: "ENTITY.STATE", entityId: "document.reform_execution_record", attribute: "accessState", value: "WRITTEN" },
      { type: "ENTITY.STATE", entityId: "object.xunfu_reply_box", attribute: "contentsState", value: "CONTAINS_DOCUMENT" },
      { type: "ENTITY.STATE", entityId: "object.xunfu_reply_box", attribute: "closureState", value: "CLOSED" },
    ],
    [
      { type: "DOCUMENT.CREATED", documentId: "document.reform_execution_record" },
      { type: "DOCUMENT.AUTHENTICATED", documentId: "document.reform_execution_record", actorId: "actor.zhejiang_governor" },
      { type: "DOCUMENT.TRANSFERRED", documentId: "document.reform_execution_record", fromActorId: "actor.zhejiang_governor", toActorId: "actor.xunfu_clerk" },
      { type: "ENTITY.HELD_BY", entityId: "document.reform_execution_record", actorId: "actor.xunfu_clerk" },
      { type: "ENTITY.STATE", entityId: "document.reform_execution_record", attribute: "accessState", value: "WRITTEN" },
      { type: "ENTITY.STATE", entityId: "object.xunfu_reply_box", attribute: "contentsState", value: "CONTAINS_DOCUMENT" },
      { type: "ENTITY.STATE", entityId: "object.xunfu_reply_box", attribute: "closureState", value: "CLOSED" },
    ],
    [],
  ],
  "DK-P1-RESPONSIBILITY-RECORD": [
    [
      { type: "DOCUMENT.CREATED", documentId: "document.reform_execution_record" },
      { type: "DOCUMENT.AUTHENTICATED", documentId: "document.reform_execution_record", actorId: "actor.zhejiang_governor" },
      { type: "DOCUMENT.TRANSFERRED", documentId: "document.reform_execution_record", fromActorId: "actor.zhejiang_governor", toActorId: "actor.xunfu_clerk" },
      { type: "ENTITY.HELD_BY", entityId: "document.reform_execution_record", actorId: "actor.xunfu_clerk" },
      { type: "ENTITY.STATE", entityId: "document.reform_execution_record", attribute: "accessState", value: "WRITTEN" },
      { type: "ENTITY.STATE", entityId: "object.xunfu_reply_box", attribute: "contentsState", value: "CONTAINS_DOCUMENT" },
      { type: "ENTITY.STATE", entityId: "object.xunfu_reply_box", attribute: "closureState", value: "CLOSED" },
    ],
    [
      { type: "DOCUMENT.CREATED", documentId: "document.responsibility_record" },
      { type: "DOCUMENT.AUTHENTICATED", documentId: "document.responsibility_record", actorId: "actor.zhejiang_governor" },
      { type: "ENTITY.HELD_BY", entityId: "document.responsibility_record", actorId: "actor.zhejiang_governor" },
      { type: "ENTITY.LOCATED_AT", entityId: "document.responsibility_record", locationId: "location.zhejiang_governor_yamen" },
      { type: "ENTITY.STATE", entityId: "document.responsibility_record", attribute: "accessState", value: "WRITTEN" },
    ],
    [
      { type: "DOCUMENT.CREATED", documentId: "document.responsibility_record" },
      { type: "DOCUMENT.AUTHENTICATED", documentId: "document.responsibility_record", actorId: "actor.zhejiang_governor" },
      { type: "ENTITY.HELD_BY", entityId: "document.responsibility_record", actorId: "actor.zhejiang_governor" },
      { type: "ENTITY.LOCATED_AT", entityId: "document.responsibility_record", locationId: "location.zhejiang_governor_yamen" },
      { type: "ENTITY.STATE", entityId: "document.responsibility_record", attribute: "accessState", value: "WRITTEN" },
    ],
  ],
  "DK-P1-EVIDENCE-CUSTODY": [
    [
      { type: "ENTITY.LOCATED_AT", entityId: "document.qingliu_register_original", locationId: "location.qingliu_archive" },
      { type: "ENTITY.STATE", entityId: "document.qingliu_register_original", attribute: "custodianRef", value: "actor.qingliu_magistrate" },
      { type: "ENTITY.STATE", entityId: "document.qingliu_register_original", attribute: "sealState", value: "RESEAL_ORDERED" },
      { type: "ENTITY.STATE", entityId: "document.qingliu_register_original", attribute: "pendingAction", value: "RESEAL_WITH_THREE_PARTY_WITNESS" },
    ],
    [
      { type: "ENTITY.LOCATED_AT", entityId: "document.qingliu_register_original", locationId: "location.qingliu_archive" },
      { type: "ENTITY.STATE", entityId: "document.qingliu_register_original", attribute: "custodianRef", value: "actor.qingliu_magistrate" },
      { type: "ENTITY.STATE", entityId: "document.qingliu_register_original", attribute: "pendingAction", value: "CREATE_WITNESSED_COPY" },
    ],
    [
      { type: "ENTITY.LOCATED_AT", entityId: "document.qingliu_register_original", locationId: "location.qingliu_archive" },
      { type: "ENTITY.STATE", entityId: "document.qingliu_register_original", attribute: "custodianRef", value: "actor.qingliu_magistrate" },
      { type: "ENTITY.STATE", entityId: "document.qingliu_register_original", attribute: "pendingAction", value: "TRANSFER_TO_GOVERNOR_YAMEN" },
    ],
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
      beatId: "PAYOFF-P1-EXECUTION-REVIEW-LIABILITY",
      actorRefs: ["actor.xunfu_aide"],
      action: "若改桑已经先行放开而复核材料仍待补齐，巡抚幕僚便要求当厅说清谁负责催齐、谁核验、逾期由谁具名；先放行后补正由此落到可以追问的承办责任上。",
      requiredTermGroups: [
        ["巡抚幕僚", "幕僚"],
        ["先行放开", "先放行", "已经放开"],
        ["补齐", "补正", "复核"],
        ["承办", "催齐", "核验", "逾期", "具名"]
      ],
      resultCeiling: "只能追问已经结算的先行放开与补正责任；不得凭空指定新的具名承办人，不得写成复核材料已经补齐或朝廷已经问责。",
    },
    {
      beatId: "PAYOFF-P1-EXECUTION-PAUSE-LIABILITY",
      actorRefs: ["actor.xunfu_aide"],
      action: "若总督选择暂缓并先保全档房，巡抚幕僚便把三日限期与仍在上升的粮价压力同时摆到案前，要求总督确认延误责任仍由自己承担。",
      requiredTermGroups: [
        ["巡抚幕僚", "幕僚"],
        ["暂缓", "封档", "保全档房"],
        ["三日", "限期"],
        ["粮价", "粮食压力"],
        ["总督承担", "延误责任", "担责"]
      ],
      resultCeiling: "只能形成三日限期、粮价压力和总督担责的当面追问；不得新增精确粮价、民乱、朝廷定罪或已经解除的暂缓状态。",
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
          playerVisibleFallback: {
            PLAYER_RESULT: "总督命县令会同乡老逐船过秤，实收数当场张榜；验完一仓，才准开一仓。",
            SCENE_TRANSITION: "次日卯后，杭州总督府签押房。首批救粮的回执尚在路上，第一份入京奏报已经铺开在案。",
            WORLD_PRESSURE: "县令领命时先说清，这样做会慢，却能让每一石粮都留下来路。巡抚幕僚立即接过“慢”字，提醒总督三日之限不会因为一仓一验而停下。粮食刚有了可核对的去向，督抚双方便开始争夺谁有资格把这番取舍写进首报。",
            DECISION_STOP: "幕僚把奏稿推到案中：\"救粮、复核、改桑，三件事已经缠在一起。首报究竟由督抚共同具名，还是各写各的？\""
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
          playerVisibleFallback: {
            PLAYER_RESULT: "总督命米船一到便照既定名册放粮，所有经手人须在日落以前补齐平码、领粮户与余粮去向。",
            SCENE_TRANSITION: "次日卯后，杭州总督府签押房。先发后验的回执尚在路上，第一份入京奏报已经铺开在案。",
            WORLD_PRESSURE: "县令领命以后没有辩解，只说日落以前若补不齐，责任先落在县衙。巡抚幕僚却指出，半日的账目空档已经足以让商会、县衙和督抚各说各话。粮先到了百姓手中，谁来解释这段空档，便成了首报不能回避的一笔。",
            DECISION_STOP: "幕僚问道：\"首报是督抚共同写明这项风险，还是各自具奏，让京师自己判断？\""
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
          playerVisibleFallback: {
            PLAYER_RESULT: "总督只交给巡抚一份列明结论、附件名称与封号的摘要，不交证人位置和未核实细节，并请巡抚在收讫处具名。",
            WORLD_PRESSURE: "巡抚幕僚接过摘要，先逐项看了封号，随后才在收讫处落笔。他得到了首报的边界，却没有得到足以自行追问人证的路径；这份克制暂时保住了证据，也把督抚间尚未消失的戒心写进了收讫记录。门外传来商会求见的通报，会首显然不愿在首报离府以后仍逐船议价。",
            DECISION_STOP: "会首进厅便问：\"后续粮船若还要走，请官府给一句长久的准话。是每日公开条件、逐船具结，还是仍照原约，不再另加官保？\""
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
          playerVisibleFallback: {
            PLAYER_RESULT: "总督不交首报底稿，只以正式回文写明拒交范围、证据保管理由与可复核期限，并将巡抚幕僚的手本一并入档。",
            WORLD_PRESSURE: "幕僚收下回文，没有再争，却把“拒交”二字看了很久。总督守住了首报，也独自承担了拒绝协作的名分；巡抚另具奏报已不再只是威胁。正在这时，江南商会会首求见，要求把后续粮船与担保写成长期凭据。官场的笔尚未停，商人的账已经追到门前。",
            DECISION_STOP: "会首问道：\"是把每日粮船和运价张榜具结，还是仍按原条件逐船核销，不再给商会新的官保？\""
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
          playerVisibleFallback: {
            PLAYER_RESULT: "总督命商会每日具结可供粮船、运价和所求权利，张榜以后才准新增一船；购田与收丝优先权不得混入粮约。",
            WORLD_PRESSURE: "会首答应得很快，目光却在“每日具结”四字上停了一瞬。公开短约让商会不能把一次救急变成长久凭据，也让官府每天都要为张榜的条件负责。清流县令随后上前，说奏报附件的消息已经传到经手书吏耳中；那名书吏最担心的，不是粮价，而是谁还能够传他问话。",
            DECISION_STOP: "县令代书吏问道：\"是另发保护令，限定传唤人与问讯地点；还是让他留在原处，只准持书面传票、由督抚双方见证问讯？\""
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
          playerVisibleFallback: {
            PLAYER_RESULT: "总督维持原有商粮边界，新增运粮仍按原条件逐船核销，不给商会另具长期担保。",
            WORLD_PRESSURE: "会首躬身领命，退回原位时已没有先前的从容。他没有得到新的政策凭据，随时可以缩减船期；断粮责任也因此更直接地压回总督府。县令没有追问商粮，反而把改桑书吏的请求递了上来：附件范围既已外传，人证若没有明确规矩，任何一方都可能借复核之名先接触他。",
            DECISION_STOP: "县令请示：\"另发封缄保护令，还是让书吏留在原处，只准督抚双方持书面传票共同问讯？\""
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
          playerVisibleFallback: {
            PLAYER_RESULT: "总督另发封缄保护令，限定传唤人、问讯地点和在场见证；任何抄送都须留下收件人与时辰。",
            WORLD_PRESSURE: "县令接过保护令，先替书吏谢了一声。巡抚幕僚却当面指出，这道命令既能防止私下问供，也让总督府掌握了人证入口。首报已经离开浙江，京师回文尚未到来，各县却不能一直借“候旨”自行扩张或停摆。保护一名书吏之后，总督还必须保护等待期间的政策边界。",
            DECISION_STOP: "幕僚问道：\"候旨期间，是先冻结急售田契和改桑扩张，还是先保证既有粮路不断、逐日公开条件？\""
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
          playerVisibleFallback: {
            PLAYER_RESULT: "总督不把书吏移出原保管地，只规定任何问讯必须持书面传票，并由督抚双方见证人在场。",
            WORLD_PRESSURE: "巡抚幕僚与县令都认下了这道门槛，谁也不能再单独把书吏带走。程序看似平衡，却也意味着任一方不到场，问讯便会停住。京师回文仍在路上，各县已经开始等候下一道解释；若没有临时规矩，等待本身便会成为扩张改桑或停办差事的借口。",
            DECISION_STOP: "幕僚请总督定下候旨期间的边界：先守住民田与既定改桑范围，还是先保粮路不断、把每日条件全部公开？"
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
          playerVisibleFallback: {
            PLAYER_RESULT: "总督定下：京师回文到来以前维持既定改桑范围，新的急售田契一律先登记、后复核，不得借候旨扩大购田。",
            WORLD_PRESSURE: "巡抚幕僚听完没有再争，只说明日便把这道临时规矩送回抚院。清流县令收起赈册，江南商会会首也合上了自己的粮账；他们都明白，民田的门暂时收紧，粮路与债务却仍会继续累积。首报已经在去京师的路上，浙江留下的每一天都会成为它下一次被追问的注脚。",
            DECISION_STOP: "厅门打开时，天色已经发白。第一部分在此收束：原册仍有待复核，粮路仍有代价，急售田契暂时进入可追踪的边界；下一部分将从粮荒与卖田真正压到百姓身上时继续。"
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
          playerVisibleFallback: {
            PLAYER_RESULT: "总督准既有救粮与运输约继续履行，但每日公开到粮、运价与担保，不得趁候旨增加购田或收丝权利。",
            WORLD_PRESSURE: "商会会首当厅应下公开条件，巡抚幕僚也承认粮路不能在等候京师回文时断掉。清流县令却提醒众人：粮可以继续来，百姓欠下的债和手里的田契也会继续变化。首报已经在路上，浙江眼前的秩序只是被暂时托住，并没有真正脱离危局。",
            DECISION_STOP: "众人退到厅门外时，晨钟刚响。第一部分在此收束：粮路仍通，商会仍在局中，购田与收丝权利暂未扩大；下一部分将从粮荒、债务与卖田的现实代价继续。"
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

for (const profile of evidenceProfileSet.profiles) {
  const {
    schemaVersion,
    evidenceProfileId,
    assetId,
    partIds,
    sectionIds,
    requirementIds,
    decisionKernelIds,
    actorRefs,
    sourceClaimIds,
    adaptationDecisionIds,
    ...payload
  } = profile;
  assets.push(assetBase({
    assetId,
    assetType: "EVIDENCE_PROFILE",
    sectionIds,
    requirementIds,
    decisionKernelIds,
    causalArcIds: [...new Set(sectionIds.flatMap((sectionId) => (
      sections.find((item) => item.sectionId === sectionId)?.activeCausalArcIds || []
    )))],
    actorRefs,
    stateDependencies: [
      "evidence.chainStatus",
      "evidence.primaryCustodianRef",
      "evidence.copyStatus",
      "evidence.archiveSealStatus",
      "knowledgeTransfers",
    ],
    sourceClaimIds,
    adaptationDecisionIds,
    retrievalTags: [
      ...sectionIds,
      evidenceProfileId,
      profile.targetRef,
      "EVIDENCE_PROFILE",
      "KNOWLEDGE_BOUNDARY",
    ],
    payload: {
      evidenceProfileId,
      ...payload,
    },
  }));
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

const sourceSceneAssetIdsByRequirement = new Map();
for (const sourceScene of sourceSceneEvidenceSet.scenes) {
  const sourceClaimIds = [...new Set(
    sourceScene.mechanisms.flatMap((mechanism) => mechanism.claimIds),
  )];
  const matchingRequirements = requirementSet.requirements.filter((requirement) =>
    requirement.sourceClaimIds.some((claimId) => sourceClaimIds.includes(claimId))
  );
  if (!matchingRequirements.length) {
    throw new Error(`${sourceScene.sceneId} is not bound to a StoryCapabilityRequirement`);
  }
  const requirementIds = matchingRequirements.map((item) => item.requirementId);
  const sectionIds = [...new Set(matchingRequirements.flatMap((item) => item.sectionIds))];
  const decisionKernelIds = [...new Set(matchingRequirements.flatMap((item) => item.decisionKernelIds))];
  const assetId = `SOURCE-SCENE-${sourceScene.sceneId}`;
  for (const requirementId of requirementIds) {
    const ids = sourceSceneAssetIdsByRequirement.get(requirementId) || [];
    ids.push(assetId);
    sourceSceneAssetIdsByRequirement.set(requirementId, ids);
  }
  assets.push(assetBase({
    assetId,
    assetType: "SOURCE_SCENE_EVIDENCE",
    sectionIds,
    requirementIds,
    decisionKernelIds,
    causalArcIds: [...new Set(sectionIds.flatMap((sectionId) =>
      sections.find((item) => item.sectionId === sectionId)?.activeCausalArcIds || []
    ))],
    actorRefs: [],
    stateDependencies: [...new Set(matchingRequirements.flatMap((item) => item.stateEffects))],
    sourceClaimIds,
    adaptationDecisionIds: [...new Set(matchingRequirements.flatMap((item) => item.adaptationGapIds))],
    retrievalTags: [
      sourceScene.sourceRange.chapterId,
      sourceScene.sceneId,
      "SOURCE_SCENE_EVIDENCE",
      "DRAMATIC_MECHANISM_ONLY",
    ],
    payload: {
      sourceId: sourceSceneEvidenceSet.sourceId,
      sourceSha256: sourceSceneEvidenceSet.sourceSha256,
      sourceSceneId: sourceScene.sceneId,
      title: sourceScene.title,
      sourceRange: sourceScene.sourceRange,
      verbatimPolicy: sourceSceneEvidenceSet.verbatimPolicy,
      mechanisms: sourceScene.mechanisms,
      applicabilityRule: "The mechanism may guide a server-selected beat; it never becomes a current-world fact by itself.",
    },
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
  const decisionPrompt = kernelDecisionPrompts[kernelId];
  const statePatches = kernelStatePatches[kernelId];
  if (!options || options.length < 3) throw new Error(`${kernelId} must define at least three concrete affordance templates`);
  if (!decisionPrompt?.prompt || !decisionPrompt.actorRefs?.length) throw new Error(`${kernelId} must define one authored decision prompt`);
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
      decisionPrompt: {
        decisionPointId: kernelId,
        actorRefs: decisionPrompt.actorRefs,
        prompt: decisionPrompt.prompt,
        resultCeiling: decisionPromptResultCeiling,
      },
      ...(decisionPrompt.variants?.length
        ? {
            decisionPromptVariants: decisionPrompt.variants.map((variant) => ({
              ...variant,
              resultCeiling: decisionPromptResultCeiling,
            })),
          }
        : {}),
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
        ...(kernelDurableEffects[kernelId]?.[index]
          ? { durableEffects: kernelDurableEffects[kernelId][index] }
          : {}),
        protectedEffectRefs: [
          ...stateEffects.map((path) => ({ kind: "STATE_PATH", path })),
          ...(kernelDurableEffects[kernelId]?.[index] || [])
            .map((_, effectIndex) => ({ kind: "DURABLE_EFFECT", effectIndex })),
        ],
        ...(kernelProtectedNarratives[kernelId]?.[index]
          ? { protectedNarrative: kernelProtectedNarratives[kernelId][index] }
          : {}),
        ...(kernelFallbackContinuations[kernelId]?.[index]
          ? { fallbackContinuation: kernelFallbackContinuations[kernelId][index] }
          : {}),
        ...(kernelPlayerVisibleFallbacks[kernelId]?.[index]
          ? { playerVisibleFallback: kernelPlayerVisibleFallbacks[kernelId][index] }
          : {}),
        createsPendingConsequence: true,
      })),
      contrastRules: ["每项必须在目标、方法、即时成本或反制中至少两项不同", "不得把必然后果写成剧透", "玩家应能不用内部 ID 复述行动"],
    },
  }));
}

for (const asset of assets.filter((asset) => (
  asset.assetType === "DECISION_KERNEL"
  && asset.assetId.startsWith("DK-P1-")
))) {
  const options = Array.isArray(asset.payload?.options) ? asset.payload.options : [];
  if (options.some((option) => !String(option?.protectedNarrative || "").trim())) {
    throw new Error(`DECISION_KERNEL_PROTECTED_OUTCOME_MISSING:${asset.assetId}`);
  }
  for (const option of options) {
    const refs = Array.isArray(option.protectedEffectRefs) ? option.protectedEffectRefs : [];
    if (!refs.length) {
      throw new Error(`DECISION_KERNEL_PROTECTED_EFFECT_BINDING_MISSING:${option.affordanceTemplateId}`);
    }
    const stateEffects = new Set(Array.isArray(option.stateEffects) ? option.stateEffects : []);
    const durableEffects = Array.isArray(option.durableEffects) ? option.durableEffects : [];
    const boundDurableIndexes = new Set();
    for (const ref of refs) {
      if (ref?.kind === "STATE_PATH") {
        if (!stateEffects.has(ref.path)) {
          throw new Error(`DECISION_KERNEL_PROTECTED_STATE_BINDING_INVALID:${option.affordanceTemplateId}:${ref.path}`);
        }
        continue;
      }
      if (ref?.kind === "DURABLE_EFFECT") {
        if (!Number.isInteger(ref.effectIndex) || ref.effectIndex < 0 || ref.effectIndex >= durableEffects.length) {
          throw new Error(`DECISION_KERNEL_PROTECTED_DURABLE_BINDING_INVALID:${option.affordanceTemplateId}:${ref.effectIndex}`);
        }
        boundDurableIndexes.add(ref.effectIndex);
        continue;
      }
      throw new Error(`DECISION_KERNEL_PROTECTED_EFFECT_BINDING_INVALID:${option.affordanceTemplateId}`);
    }
    if (durableEffects.some((_, index) => !boundDurableIndexes.has(index))) {
      throw new Error(`DECISION_KERNEL_PROTECTED_DURABLE_EFFECT_UNBOUND:${option.affordanceTemplateId}`);
    }
  }
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

// A Claim ID is only a traceability pointer; it is not enough context for a
// Narrator. Every playable kernel must be backed by at least one approved,
// runtime-readable source-scene mechanism, or by an explicitly approved
// adaptation gap. Failing here keeps an uncovered kernel out of the package
// instead of discovering the gap mid-run and asking the model to improvise.
const sourceSceneAssets = assets.filter((asset) => asset.assetType === "SOURCE_SCENE_EVIDENCE");
for (const kernel of assets.filter((asset) => asset.assetType === "DECISION_KERNEL")) {
  const kernelClaimIds = new Set(kernel.sourceClaimIds);
  const hasReadableSourceMechanism = sourceSceneAssets.some((sceneAsset) =>
    sceneAsset.sourceClaimIds.some((claimId) => kernelClaimIds.has(claimId))
    && Array.isArray(sceneAsset.payload?.mechanisms)
    && sceneAsset.payload.mechanisms.some((mechanism) =>
      Array.isArray(mechanism?.claimIds)
      && mechanism.claimIds.some((claimId) => kernelClaimIds.has(claimId))
      && String(mechanism?.statement || "").trim().length > 0
    )
  );
  const hasApprovedAdaptationGap = kernel.adaptationDecisionIds.some((adaptationId) =>
    approvedAdaptationIds.has(adaptationId)
  );
  if (!hasReadableSourceMechanism && !hasApprovedAdaptationGap) {
    throw new Error(`DECISION_KERNEL_STORY_EVIDENCE_MISSING:${kernel.assetId}`);
  }
}

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
  const evidenceProfileAssetIds = evidenceProfileSet.profiles
    .filter((profile) => profile.requirementIds.includes(requirement.requirementId))
    .map((profile) => profile.assetId);
  requirement.adaptationDecisionIds = requirement.adaptationGapIds;
  requirement.coverageStatus = requirement.adaptationGapIds.length ? "SATISFIED_BY_ADAPTATION" : "SATISFIED_BY_SOURCE";
  requirement.runtimeAssetIds = [
    coreAssetId,
    ...evidenceProfileAssetIds,
    ...requirement.decisionKernelIds,
    ...section.activeCausalArcIds,
    ...requirement.delayedConsequenceRuleIds,
    ...narrativePatternIds,
    ...(sourceSceneAssetIdsByRequirement.get(requirement.requirementId) || []),
  ];
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
  evidenceProfileCount: evidenceProfileSet.profiles.length,
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
    evidenceProfiles: evidenceProfileSet.profiles.length,
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
