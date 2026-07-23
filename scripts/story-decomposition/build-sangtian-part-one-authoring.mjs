import { resolve } from "node:path";
import { repoRoot, validateWithSchema, writeJson } from "./lib/contract-utils.mjs";

const authoringRoot = resolve(repoRoot, "packages/templates/authoring/sangtian");
const sourceSha256 = "04D5E8D4533D86890A79058C25252D33E001668921A2BBD8FFDE401CDD2B6238";

const condition = (ruleId, statePath, operator, expectedValue, description) => ({
  ruleId,
  statePath,
  operator,
  expectedValue,
  description,
});

const parts = [
  {
    schemaVersion: "part-contract-v1",
    partId: "PART-01",
    title: "急令与暗册",
    foregroundPowers: ["改桑执行权", "证据保管与解释权", "首份奏报权"],
    irreversibleDecisions: ["改桑执行模式", "县册复核程序", "首份入京叙述的署名与附件"],
    entryStatePaths: ["reform.executionMode", "review.initiationStatus", "report.dispatchStatus"],
    exitStatePaths: ["reform.executionMode", "review.authority", "evidence.chainStatus", "grain.reliefChannel", "report.firstNarrativeController", "relations.governorXunfu", "merchant.entryStatus", "land.riskLevel"],
    forbiddenEarlyReveals: ["巡抚是幕后主使", "暗账全部内容", "大规模土地兼并已经完成", "御前裁决结论", "原著后续是本房间必然未来", "凭开场密信即可定罪"],
    handoffPartIds: ["PART-02"],
    implementationScope: "FULL_20_TURN_VALIDATION",
  },
  {
    schemaVersion: "part-contract-v1",
    partId: "PART-02",
    title: "粮荒与卖田",
    foregroundPowers: ["粮食分配权", "土地定价权", "债务与契约控制权"],
    irreversibleDecisions: ["谁出粮", "是否允许抵押或出售土地", "救粮与保田优先级"],
    entryStatePaths: ["grain.reliefChannel", "merchant.entryStatus", "land.riskLevel", "report.dispatchStatus"],
    exitStatePaths: ["grain.distributionOutcome", "land.transferOutcome", "debt.controlOutcome"],
    forbiddenEarlyReveals: ["最终土地结局", "完整暗账", "御前裁决结论"],
    handoffPartIds: ["PART-03"],
    implementationScope: "ENTRY_SHAPE_ONLY",
  },
  {
    schemaVersion: "part-contract-v1",
    partId: "PART-03",
    title: "毁证与弹劾",
    foregroundPowers: ["证据控制权", "问责对象选择权", "京师政治定性权"],
    irreversibleDecisions: ["公开什么证据", "保护或牺牲谁", "向谁提出弹劾"],
    entryStatePaths: ["evidence.chainStatus", "witness.accessStatus", "report.firstNarrativeController"],
    exitStatePaths: ["evidence.publicRecordStatus", "accountability.primaryTarget", "capital.framingStatus"],
    forbiddenEarlyReveals: ["皇帝最终裁决", "唯一正史叙述"],
    handoffPartIds: ["PART-04"],
    implementationScope: "FORBIDDEN_REVEALS_ONLY",
  },
  {
    schemaVersion: "part-contract-v1",
    partId: "PART-04",
    title: "御前裁决",
    foregroundPowers: ["官方叙述权", "财政代价分配权", "政治责任分配权"],
    irreversibleDecisions: ["哪一版事实进入正式记录", "谁承担财政与政治代价"],
    entryStatePaths: ["capital.framingStatus", "evidence.publicRecordStatus", "accountability.primaryTarget"],
    exitStatePaths: ["ending.treasury", "ending.people", "ending.land", "ending.officials", "ending.playerCost"],
    forbiddenEarlyReveals: [],
    handoffPartIds: [],
    implementationScope: "FINAL_DIMENSIONS_ONLY",
  },
];

const sharedForbidden = [
  "巡抚被确认是幕后主使",
  "完整暗账被确认",
  "大规模土地兼并已经完成",
  "正式御前裁决已经发生",
];

const sections = [
  {
    schemaVersion: "section-contract-v1",
    sectionId: "SEC-P1-01",
    partId: "PART-01",
    title: "急令压案",
    dramaticPurpose: "把两封文书转成可追踪的执行模式、复核启动方式和督抚责任关系。",
    targetTurnWindow: { earliest: 1, latest: 5 },
    entryRequirements: [condition("ENTRY-P1-S1", "sectionId", "EQ", "SEC-P1-01", "固定开场进入第一节")],
    requiredRequirementIds: ["REQ-P1-EXECUTION-BOUNDARY", "REQ-P1-RESPONSIBILITY-RECORD", "REQ-P1-XUNFU-COUNTERMOVE"],
    activeDecisionKernelIds: ["DK-P1-EXECUTION-SCOPE", "DK-P1-REVIEW-INITIATION", "DK-P1-RESPONSIBILITY-RECORD"],
    activeCausalArcIds: ["ARC-P1-DEADLINE-RESPONSIBILITY"],
    foregroundActorRefs: ["actor.zhejiang_governor", "actor.zhejiang_xunfu", "actor.xunfu_clerk", "actor.qingliu_messenger"],
    mustEstablish: [
      condition("S1-MUST-EXECUTION", "reform.executionMode", "NEQ", "UNKNOWN", "改桑进入具体执行状态"),
      condition("S1-MUST-REVIEW", "review.initiationStatus", "NEQ", "NOT_STARTED", "复核已启动或形成正式阻断"),
      condition("S1-MUST-RESPONSIBILITY", "responsibility.firstRecordStatus", "NEQ", "EMPTY", "第一份责任记录可追踪"),
      condition("S1-MUST-PENDING", "pendingConsequences", "ANY_PENDING", true, "至少一个督抚相关后果待兑现"),
    ],
    requiredMaterialChangeClasses: ["EXECUTION_MODE", "REVIEW_INITIATION", "RESPONSIBILITY_RECORD", "NPC_COUNTERMOVE"],
    forbiddenEarlyReveals: [...sharedForbidden, "暗账实物出现", "完整商会链条被证明"],
    allowedNextSectionIds: ["SEC-P1-02"],
    exitGates: [
      condition("S1-EXIT-EXECUTION", "reform.executionMode", "NEQ", "UNKNOWN", "执行模式已确定"),
      condition("S1-EXIT-REVIEW", "review.initiationStatus", "NEQ", "NOT_STARTED", "复核已启动"),
      condition("S1-EXIT-RECORD", "responsibility.firstRecordStatus", "NEQ", "EMPTY", "责任记录已形成"),
      condition("S1-EXIT-PENDING", "pendingConsequences", "ANY_PENDING", true, "存在督抚相关待兑现后果"),
    ],
    floorObligationIds: ["FLOOR-P1-S1-XUNFU-RESPONSE"],
    handoffStatePaths: ["reform.executionMode", "review.initiationStatus", "responsibility.firstRecordStatus", "relations.governorXunfu"],
  },
  {
    schemaVersion: "section-contract-v1",
    sectionId: "SEC-P1-02",
    partId: "PART-01",
    title: "县册无主",
    dramaticPurpose: "让原册、副本、封条、田契与经手人形成可争夺、可损坏、可追踪的证据链和知识差。",
    targetTurnWindow: { earliest: 3, latest: 10 },
    entryRequirements: [condition("ENTRY-P1-S2", "responsibility.firstRecordStatus", "NEQ", "EMPTY", "第一节责任记录已形成")],
    requiredRequirementIds: ["REQ-P1-REGISTER-CUSTODY", "REQ-P1-REVIEW-AUTHORITY", "REQ-P1-KNOWLEDGE-CHAIN"],
    activeDecisionKernelIds: ["DK-P1-REVIEW-AUTHORITY", "DK-P1-EVIDENCE-CUSTODY", "DK-P1-WITNESS-ACCESS", "DK-P1-DISCLOSURE-SCOPE"],
    activeCausalArcIds: ["ARC-P1-CUSTODY-CONTEST"],
    foregroundActorRefs: ["actor.zhejiang_governor", "actor.zhejiang_xunfu", "actor.qingliu_magistrate", "actor.reform_clerk", "actor.xunfu_aide"],
    mustEstablish: [
      condition("S2-MUST-AUTHORITY", "review.authority", "NEQ", "UNDECIDED", "复核主持权已落在具体主体"),
      condition("S2-MUST-CHAIN", "evidence.chainStatus", "IN", ["TRACEABLE", "FRAGILE", "COMPROMISED"], "证据链状态可追踪"),
      condition("S2-MUST-CUSTODIAN", "evidence.primaryCustodianRef", "NOT_NULL", true, "主保管人明确"),
      condition("S2-MUST-WITNESS", "witness.accessStatus", "NEQ", "UNKNOWN", "关键书吏接触状态明确"),
    ],
    requiredMaterialChangeClasses: ["EVIDENCE_CUSTODY", "KNOWLEDGE_TRANSFER", "REVIEW_AUTHORITY", "WITNESS_ACCESS"],
    forbiddenEarlyReveals: [...sharedForbidden, "全部田契与商会一一对应", "京师完成定性"],
    allowedNextSectionIds: ["SEC-P1-03"],
    exitGates: [
      condition("S2-EXIT-AUTHORITY", "review.authority", "NEQ", "UNDECIDED", "复核主持权已确定"),
      condition("S2-EXIT-CHAIN", "evidence.chainStatus", "IN", ["TRACEABLE", "FRAGILE", "COMPROMISED"], "证据链状态已确定"),
      condition("S2-EXIT-CUSTODIAN", "evidence.primaryCustodianRef", "NOT_NULL", true, "保管人已确定"),
      condition("S2-EXIT-WITNESS", "witness.accessStatus", "NEQ", "UNKNOWN", "证人接触状态已确定"),
    ],
    floorObligationIds: ["FLOOR-P1-S2-CUSTODY-DISRUPTION"],
    handoffStatePaths: ["review.authority", "evidence.chainStatus", "evidence.primaryCustodianRef", "evidence.copyStatus", "witness.accessStatus"],
  },
  {
    schemaVersion: "section-contract-v1",
    sectionId: "SEC-P1-03",
    partId: "PART-01",
    title: "一仓米的价钱",
    dramaticPurpose: "让粮食救急成为短期有效但会改变土地风险、商会筹码和各方责任的真实交易。",
    targetTurnWindow: { earliest: 8, latest: 15 },
    entryRequirements: [condition("ENTRY-P1-S3", "evidence.chainStatus", "IN", ["TRACEABLE", "FRAGILE", "COMPROMISED"], "证据链已有现实状态")],
    requiredRequirementIds: ["REQ-P1-GRAIN-RELIEF", "REQ-P1-MERCHANT-CONDITIONS", "REQ-P1-LAND-RISK"],
    activeDecisionKernelIds: ["DK-P1-GRAIN-SOURCE", "DK-P1-MERCHANT-CONDITIONS", "DK-P1-LAND-SAFEGUARD", "DK-P1-RELIEF-PRIORITY"],
    activeCausalArcIds: ["ARC-P1-GRAIN-LAND-ENTRY"],
    foregroundActorRefs: ["actor.zhejiang_governor", "actor.zhejiang_xunfu", "actor.qingliu_magistrate", "actor.jiangnan_merchant_head", "actor.xunfu_aide"],
    mustEstablish: [
      condition("S3-MUST-CHANNEL", "grain.reliefChannel", "NEQ", "UNDECIDED", "粮食救急渠道已决定"),
      condition("S3-MUST-MERCHANT", "merchant.entryStatus", "IN", ["REJECTED", "CONDITIONAL", "ACTIVE"], "商会入口状态明确"),
      condition("S3-MUST-LAND", "land.riskLevel", "NEQ", "UNKNOWN", "土地风险已被识别"),
      condition("S3-MUST-PENDING", "pendingConsequences", "ANY_PENDING", true, "至少一个粮食或交易后果待兑现"),
    ],
    requiredMaterialChangeClasses: ["GRAIN_PRESSURE", "RELIEF_CHANNEL", "MERCHANT_ENTRY", "LAND_RISK"],
    forbiddenEarlyReveals: [...sharedForbidden, "全县卖田已经完成", "商会控制全部丝粮路线", "最终土地结局"],
    allowedNextSectionIds: ["SEC-P1-04"],
    exitGates: [
      condition("S3-EXIT-CHANNEL", "grain.reliefChannel", "NEQ", "UNDECIDED", "救急渠道确定"),
      condition("S3-EXIT-MERCHANT", "merchant.entryStatus", "IN", ["REJECTED", "CONDITIONAL", "ACTIVE"], "商会入口确定"),
      condition("S3-EXIT-LAND", "land.riskLevel", "NEQ", "UNKNOWN", "土地风险确定"),
      condition("S3-EXIT-PENDING", "pendingConsequences", "ANY_PENDING", true, "粮食或交易后果进入队列"),
    ],
    floorObligationIds: ["FLOOR-P1-S3-GRAIN-PRICE-MOVE"],
    handoffStatePaths: ["grain.immediatePressure", "grain.officialStockStatus", "grain.reliefChannel", "merchant.entryStatus", "land.riskLevel", "land.safeguardStatus"],
  },
  {
    schemaVersion: "section-contract-v1",
    sectionId: "SEC-P1-04",
    partId: "PART-01",
    title: "一纸入京",
    dramaticPurpose: "把执行、证据、粮食代价和督抚关系压缩为首份可入京且不越过证据边界的政治叙述。",
    targetTurnWindow: { earliest: 13, latest: 20 },
    entryRequirements: [condition("ENTRY-P1-S4", "grain.reliefChannel", "NEQ", "UNDECIDED", "粮食方案已有决断")],
    requiredRequirementIds: ["REQ-P1-REPORT-AUTHORSHIP", "REQ-P1-EVIDENCE-ATTACHMENT", "REQ-P1-CAPITAL-FRAMING"],
    activeDecisionKernelIds: ["DK-P1-REPORT-AUTHORSHIP", "DK-P1-EVIDENCE-ATTACHMENT", "DK-P1-RESPONSIBILITY-SCOPE", "DK-P1-CAPITAL-CHANNEL"],
    activeCausalArcIds: ["ARC-P1-FIRST-REPORT-FRAMING"],
    foregroundActorRefs: ["actor.zhejiang_governor", "actor.zhejiang_xunfu", "actor.qingliu_magistrate", "actor.xunfu_aide", "actor.jiangnan_merchant_head"],
    mustEstablish: [
      condition("S4-MUST-CONTROLLER", "report.firstNarrativeController", "NEQ", "UNDECIDED", "首报叙述控制者明确"),
      condition("S4-MUST-AUTHORSHIP", "report.authorshipMode", "NEQ", "UNKNOWN", "署名方式明确"),
      condition("S4-MUST-ATTACHMENT", "report.attachmentStrength", "NEQ", "NONE", "附件强度已按证据计算"),
      condition("S4-MUST-DISPATCH", "report.dispatchStatus", "IN", ["READY", "DISPATCHED", "SPLIT"], "首报已可送出或已经分裂送出"),
    ],
    requiredMaterialChangeClasses: ["REPORT_AUTHORSHIP", "EVIDENCE_ATTACHMENT", "RESPONSIBILITY_SCOPE", "CAPITAL_CHANNEL", "PART_TWO_HANDOFF"],
    forbiddenEarlyReveals: [...sharedForbidden, "京师已经完成最终定性", "皇帝已经裁决浙江危局"],
    allowedNextSectionIds: ["PART-02-HANDOFF"],
    exitGates: [
      condition("S4-EXIT-CONTROLLER", "report.firstNarrativeController", "NEQ", "UNDECIDED", "叙述控制者已确定"),
      condition("S4-EXIT-AUTHORSHIP", "report.authorshipMode", "NEQ", "UNKNOWN", "署名方式已确定"),
      condition("S4-EXIT-ATTACHMENT", "report.attachmentStrength", "NEQ", "NONE", "附件强度已确定"),
      condition("S4-EXIT-DISPATCH", "report.dispatchStatus", "IN", ["READY", "DISPATCHED", "SPLIT"], "首报到达合法末态"),
    ],
    floorObligationIds: ["FLOOR-P1-S4-CAPITAL-DEADLINE"],
    handoffStatePaths: ["reform.executionMode", "review.authority", "evidence.chainStatus", "grain.reliefChannel", "report.firstNarrativeController", "relations.governorXunfu", "merchant.entryStatus", "land.riskLevel"],
  },
];

const requirementSeeds = [
  ["REQ-P1-EXECUTION-BOUNDARY", ["SEC-P1-01"], "玩家能决定改桑范围、速度和附加条件", ["DK-P1-EXECUTION-SCOPE", "DK-P1-REVIEW-INITIATION"], ["国策形成", "地方执行责任", "拖延与抗命边界"], ["改稻为桑", "总督", "奉旨", "缓办", "试行"], ["DM1566-C01", "DM1566-C02", "DM1566-C03"], ["reform.executionMode", "reform.scopeStatus", "reform.progress"]],
  ["REQ-P1-RESPONSIBILITY-RECORD", ["SEC-P1-01"], "玩家能决定谁在正式文书上留下具名责任", ["DK-P1-RESPONSIBILITY-RECORD"], ["奏疏", "票拟", "公文", "催办", "责任切割"], ["具名", "奏报", "公文", "责任", "钧旨"], ["DM1566-C01", "DM1566-C02", "DM1566-C03", "DM1566-C04"], ["responsibility.firstRecordStatus", "responsibility.governorExposure", "responsibility.xunfuExposure"]],
  ["REQ-P1-XUNFU-COUNTERMOVE", ["SEC-P1-01"], "巡抚会主动争夺速度、复核权和解释权", ["DK-P1-EXECUTION-SCOPE", "DK-P1-RESPONSIBILITY-RECORD"], ["地方官僚自保", "执行压力", "责任转移"], ["巡抚", "总督", "催", "责任", "改稻为桑"], ["DM1566-C02", "DM1566-C03", "DM1566-C04"], ["relations.governorXunfu", "pendingConsequences"]],
  ["REQ-P1-REGISTER-CUSTODY", ["SEC-P1-02"], "原件、副本、封条和经手人能被追踪与争夺", ["DK-P1-EVIDENCE-CUSTODY", "DK-P1-WITNESS-ACCESS"], ["账册", "田契", "文书保管", "抄录", "封存"], ["账册", "田册", "田契", "封", "抄", "经手"], ["DM1566-C02", "DM1566-C03", "DM1566-C04", "DM1566-C05"], ["evidence.chainStatus", "evidence.primaryCustodianRef", "evidence.copyStatus", "evidence.archiveSealStatus"]],
  ["REQ-P1-REVIEW-AUTHORITY", ["SEC-P1-02"], "玩家能争夺县册复核的主持权和程序", ["DK-P1-REVIEW-AUTHORITY", "DK-P1-DISCLOSURE-SCOPE"], ["总督巡抚知府知县的制度权限", "核验程序", "文书渠道"], ["总督", "巡抚", "知县", "查验", "会审", "复核"], ["DM1566-C02", "DM1566-C03", "DM1566-C04"], ["review.authority", "review.procedureStatus"]],
  ["REQ-P1-KNOWLEDGE-CHAIN", ["SEC-P1-02"], "秘密只能经由在场、密报、文书或口供传播", ["DK-P1-DISCLOSURE-SCOPE", "DK-P1-WITNESS-ACCESS"], ["密报", "口供", "文书送达", "解释权"], ["密报", "口供", "知道", "听说", "文书", "送到"], ["DM1566-C01", "DM1566-C02", "DM1566-C03", "DM1566-C04"], ["knowledgeTransfers", "witness.accessStatus"]],
  ["REQ-P1-GRAIN-RELIEF", ["SEC-P1-03"], "官粮不足时玩家仍有多种真实救急渠道", ["DK-P1-GRAIN-SOURCE", "DK-P1-RELIEF-PRIORITY"], ["官仓", "借粮", "调粮", "以改兼赈"], ["粮", "仓", "赈", "借粮", "调粮", "米价"], ["DM1566-C02", "DM1566-C03", "DM1566-C04", "DM1566-C05", "DM1566-C06", "DM1566-C07"], ["grain.officialStockStatus", "grain.reliefChannel", "grain.immediatePressure"]],
  ["REQ-P1-MERCHANT-CONDITIONS", ["SEC-P1-03"], "商会能提供短期有效资源并提出可见交换条件", ["DK-P1-MERCHANT-CONDITIONS", "DK-P1-GRAIN-SOURCE"], ["商人粮路", "银子", "丝路", "官商合作"], ["商人", "粮", "银子", "丝绸", "买田", "运粮"], ["DM1566-C03", "DM1566-C04", "DM1566-C05", "DM1566-C06", "DM1566-C07"], ["merchant.entryStatus", "merchant.grantedRights", "grain.reliefChannel"]],
  ["REQ-P1-LAND-RISK", ["SEC-P1-03"], "粮食与改桑选择能改变抵押、卖田和兼并风险", ["DK-P1-LAND-SAFEGUARD", "DK-P1-RELIEF-PRIORITY"], ["买田", "田价", "抵押", "兼并风险"], ["买田", "卖田", "田价", "兼并", "桑田", "口粮"], ["DM1566-C01", "DM1566-C02", "DM1566-C03", "DM1566-C04", "DM1566-C05", "DM1566-C06", "DM1566-C07"], ["land.riskLevel", "land.safeguardStatus"]],
  ["REQ-P1-REPORT-AUTHORSHIP", ["SEC-P1-04"], "玩家能决定共同、单方或分裂奏报", ["DK-P1-REPORT-AUTHORSHIP", "DK-P1-RESPONSIBILITY-SCOPE"], ["奏疏渠道", "署名", "官员责任"], ["奏疏", "奏报", "具名", "联署", "上报"], ["DM1566-C01", "DM1566-C02", "DM1566-C03", "DM1566-C04", "DM1566-C05"], ["report.authorshipMode", "report.firstNarrativeController", "responsibility.governorExposure", "responsibility.xunfuExposure"]],
  ["REQ-P1-EVIDENCE-ATTACHMENT", ["SEC-P1-04"], "玩家能决定首报附什么证据并诚实标注强度", ["DK-P1-EVIDENCE-ATTACHMENT"], ["原册", "副本", "口供", "仓单", "田契的证明边界"], ["附件", "原册", "副本", "口供", "仓单", "田契", "账册", "封存", "实据"], ["DM1566-C01", "DM1566-C02", "DM1566-C03", "DM1566-C04", "DM1566-C05", "DM1566-C06", "DM1566-C07"], ["report.attachmentStrength", "evidence.chainStatus"]],
  ["REQ-P1-CAPITAL-FRAMING", ["SEC-P1-04"], "首报会改变京师收到的第一版事实而不预定最终裁决", ["DK-P1-CAPITAL-CHANNEL", "DK-P1-REPORT-AUTHORSHIP"], ["内阁", "司礼监", "织造体系", "政治定性"], ["内阁", "司礼监", "织造", "奏报", "皇上", "定罪"], ["DM1566-C01", "DM1566-C02", "DM1566-C03", "DM1566-C04", "DM1566-C05", "DM1566-C06", "DM1566-C07"], ["report.dispatchStatus", "report.firstNarrativeController", "pendingConsequences"]],
];

const requirements = requirementSeeds.map(([requirementId, sectionIds, dramaticFunction, decisionKernelIds, mechanisms, queryTerms, chapters, stateEffects]) => ({
  schemaVersion: "story-capability-requirement-v1",
  requirementId,
  partId: "PART-01",
  sectionIds,
  dramaticFunction,
  decisionKernelIds,
  playerAuthorityRefs: ["institution.zhejiang_governor_yamen"],
  opposingActorRefs: requirementId.includes("MERCHANT") || requirementId.includes("LAND") || requirementId.includes("GRAIN") ? ["actor.zhejiang_xunfu", "actor.jiangnan_merchant_head"] : ["actor.zhejiang_xunfu"],
  requiredResourceRefs: requirementId.includes("GRAIN") || requirementId.includes("MERCHANT") ? ["resource.official_grain", "resource.merchant_grain_route"] : ["resource.official_document_channel"],
  requiredEvidenceMechanisms: mechanisms,
  sourceCandidateQueryTerms: queryTerms,
  sourceCandidateChapterIds: chapters,
  sourceSceneIds: [],
  sourceClaimIds: [],
  mechanismCandidateIds: [],
  evidenceStrength: "NONE",
  adaptationGapIds: [],
  adaptationDecisionIds: [],
  runtimeAssetIds: [],
  stateEffects,
  delayedConsequenceRuleIds: [],
  retrievalTags: ["PART-01", ...sectionIds, requirementId],
  mustNotAssume: ["人物说法等于客观事实", "后续原著事件必然在本房间发生", "密信或异常足以定罪", "DeepSeek 可以补造缺失证据"],
  coverageStatus: "BLOCKED_MISSING_EVIDENCE",
}));

const adaptations = [
  ["ADAPT-P1-PLAYABLE-GOVERNOR", "preserve", ["actor.zhejiang_governor"], ["胡宗宪所代表的总督责任边界与治理压力"], ["玩家可以在制度权限内选择执行、复核、赈济与奏报路径"]],
  ["ADAPT-P1-QINGLIU-COUNTY", "invent_for_gameplay", ["place.qingliu_county", "actor.qingliu_magistrate"], ["地方县级执行与百姓承压机制"], ["清流县及县令为合成人物与地点，不冒充原著实体"]],
  ["ADAPT-P1-THREE-DAY-DEADLINE", "invent_for_gameplay", ["pressure.three_day_deadline"], ["朝廷财政与执行压力必须真实约束地方官"], ["三日为玩法倒计时，不是原著逐字事实"]],
  ["ADAPT-P1-REGISTER-ALTERATION", "invent_for_gameplay", ["evidence.qingliu_register_anomaly"], ["账册、田契与责任链只能逐步核验"], ["改痕只是异常入口，不能直接证明幕后主使"]],
  ["ADAPT-P1-SEPARATE-XUNFU", "split", ["actor.zhejiang_xunfu"], ["督抚之间围绕执行速度、复核权和责任的制度冲突"], ["独立巡抚是玩法角色位，不把原著特定行为直接移植为既定罪责"]],
  ["ADAPT-P1-MERCHANT-GUILD", "invent_for_gameplay", ["actor.jiangnan_merchant_head", "institution.jiangnan_merchant_guild"], ["商人以粮、银、运力和丝路进入国策的机制"], ["商会是合成组织，短期方案有效但交换条件必须公开可见"]],
  ["ADAPT-P1-SHADOW-LEDGER-ENTRY", "invent_for_gameplay", ["evidence.shadow_ledger_entry"], ["官商利益只能沿可追溯证据链逼近"], ["第一部分只允许暗账入口，不确认完整内容或幕后主使"]],
].map(([id, operation, targetIds, invariants, differences]) => ({
  schemaVersion: "adaptation-decision-v2",
  adaptationDecisionId: id,
  sourceEntityOrArcIds: operation === "invent_for_gameplay" ? [] : ["source-arc.dm1566-reform-responsibility"],
  operation,
  targetIds,
  rationale: "为可玩浙江总督视角建立连续决策，同时保留原著财政、制度、民生与责任机制。",
  invariantsToPreserve: invariants,
  intentionalDifferences: differences,
  reviewStatus: "DRAFT",
  approvedBy: null,
  approvedAt: null,
}));

const styleProfile = {
  schemaVersion: "narrative-style-profile-v1",
  profileId: "STYLE-SANGTIAN-HISTORICAL-NOVEL",
  version: "1.0.0-draft",
  pointOfView: "以浙江总督可感知范围为主的第三人称限知叙事；不进入玩家未获知人物的内心。",
  registerRules: ["使用明代官署、文书、田粮与上下级称谓", "允许清楚易懂的现代标点，但不使用现代行政或互联网术语", "时代感来自人物处境、礼法和具体动作，不靠堆砌文言"],
  sceneConstructionRules: ["每回合先呈现上一选择造成的可观察变化", "至少一个人物主动行动或世界压力兑现", "场景必须包含地点、物件、动作或声音等可感细节", "用人物的追问、回答、停顿、递交、拒绝和在场反应呈现冲突，不把内部限制说明改写成正文", "结尾以眼前必须处理的矛盾自然导出选择，不写测试式总结，也不在正文替玩家列出选择题"],
  characterVoiceAnchors: {
    "actor.zhejiang_governor": ["先问可执行边界与谁担责任", "不凭一封密信定罪", "在国策、海防与百姓生计之间衡量"],
    "actor.zhejiang_xunfu": ["强调时限、政绩与朝廷追责", "把拖延风险具体落到公文和署名", "可以合作，但会争夺解释权"],
    "actor.qingliu_magistrate": ["从县册、田契与百姓承担后果说话", "证据不足时明确承认不知道", "既怕失职也怕材料落入他人之手"],
    "actor.jiangnan_merchant_head": ["以粮、银、运力和时间谈条件", "不自称反派", "把交换条件包装成官府眼前可用的解决方案"],
    "actor.reform_clerk": ["熟悉经手顺序和细节", "说话谨慎且受保管人影响", "知道自己可能成为证人或替罪羊"],
  },
  dialogueAndSubtextRules: ["对话必须同时表现角色目的和不愿明说的风险", "短问之后允许短答、沉默或旁人的可见反应，不把所有人的话写成同样长度的说明", "避免所有人轮流解释背景", "重要主张由文书、物件、在场动作或既有事件支撑"],
  terminologyRules: ["用改稻为桑或改桑，不用产业升级", "用奏报、公文、具名、封缄、复核，不用流程工单", "用米价、官仓、田契、田册，不用供应链 KPI"],
  forbiddenModernPhrases: ["KPI", "供应链优化", "舆情管理", "数据闭环", "战略抓手", "风险敞口", "资源置换", "项目推进"],
  forbiddenSystemPhrases: ["玩家选择", "系统判定", "任务完成", "解锁选项", "数值变化", "下一回合", "根据设定", "执行边界", "复核权争夺", "证据链状态", "必须先决定"],
  forbiddenAiSummaryPatterns: ["综上所述", "这意味着", "局势变得更加复杂", "接下来你可以", "本回合", "作为AI", "是先", "还是先"],
  narrativeBudget: { minCharacters: 650, maxCharacters: 1500 },
  reviewerId: "PENDING-INDEPENDENT-STYLE-REVIEW",
  approvedAt: "2026-07-23T00:00:00.000Z",
};

const worldStart = {
  schemaVersion: "sangtian-world-start-v1",
  worldId: "sangtian",
  partId: "PART-01",
  sectionId: "SEC-P1-01",
  perspectiveRoleKey: "zhejiang_governor",
  sourceTimelinePolicy: { historicalBaseline: "开场前已经发生并经批准的事实", sourceFuture: "只可作为机制和审核参考", runtimeFuture: "只能由玩家行动、NPC策略和因果事件产生" },
  state: {
    partId: "PART-01",
    sectionId: "SEC-P1-01",
    turnNumber: 0,
    reform: { executionMode: "UNKNOWN", scopeStatus: "UNSET", progress: "NOT_STARTED" },
    review: { initiationStatus: "NOT_STARTED", authority: "UNDECIDED", procedureStatus: "UNSET" },
    evidence: { chainStatus: "UNKNOWN", primaryCustodianRef: null, copyStatus: "NONE", archiveSealStatus: "UNKNOWN" },
    witness: { accessStatus: "UNKNOWN" },
    grain: { immediatePressure: "RISING", officialStockStatus: "UNKNOWN", reliefChannel: "UNDECIDED" },
    merchant: { entryStatus: "ABSENT", grantedRights: [] },
    land: { riskLevel: "UNKNOWN", safeguardStatus: "NONE" },
    report: { authorshipMode: "UNKNOWN", firstNarrativeController: "UNDECIDED", attachmentStrength: "NONE", dispatchStatus: "NOT_STARTED" },
    responsibility: { firstRecordStatus: "EMPTY", governorExposure: 0, xunfuExposure: 0 },
    relations: { governorXunfu: 0 },
    knowledgeTransfers: [],
    pendingConsequences: [],
  },
};

const coreStateSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://our-many-worlds.local/schemas/sangtian-part-one-state.schema.json",
  title: "Sangtian PartOneState",
  type: "object",
  additionalProperties: false,
  required: Object.keys(worldStart.state),
  properties: {
    partId: { const: "PART-01" },
    sectionId: { enum: ["SEC-P1-01", "SEC-P1-02", "SEC-P1-03", "SEC-P1-04"] },
    turnNumber: { type: "integer", minimum: 0, maximum: 20 },
    reform: strictState({ executionMode: ["UNKNOWN", "PAUSED", "LIMITED", "FULL", "CONDITIONAL"], scopeStatus: ["UNSET", "RECORDED", "CONTESTED"], progress: ["NOT_STARTED", "ORDERED", "STARTED"] }),
    review: strictState({ initiationStatus: ["NOT_STARTED", "ORDERED", "ACTIVE", "BLOCKED"], authority: ["UNDECIDED", "GOVERNOR", "XUNFU", "JOINT", "COUNTY"], procedureStatus: ["UNSET", "RECORDED", "CONTESTED"] }),
    evidence: {
      type: "object", additionalProperties: false, required: ["chainStatus", "primaryCustodianRef", "copyStatus", "archiveSealStatus"],
      properties: { chainStatus: { enum: ["UNKNOWN", "TRACEABLE", "FRAGILE", "COMPROMISED"] }, primaryCustodianRef: { type: ["string", "null"] }, copyStatus: { enum: ["NONE", "REQUESTED", "CREATED", "DISPUTED"] }, archiveSealStatus: { enum: ["UNKNOWN", "INTACT", "BROKEN", "RESEALED"] } },
    },
    witness: strictState({ accessStatus: ["UNKNOWN", "AVAILABLE", "PROTECTED", "MISSING", "CONTROLLED_BY_OTHER"] }),
    grain: strictState({ immediatePressure: ["STABLE", "RISING", "ACUTE"], officialStockStatus: ["UNKNOWN", "INSUFFICIENT", "LIMITED", "AVAILABLE"], reliefChannel: ["UNDECIDED", "OFFICIAL", "MERCHANT", "MIXED", "EXTERNAL_TRANSFER"] }),
    merchant: { type: "object", additionalProperties: false, required: ["entryStatus", "grantedRights"], properties: { entryStatus: { enum: ["ABSENT", "OFFERED", "REJECTED", "CONDITIONAL", "ACTIVE"] }, grantedRights: { type: "array", items: { type: "string" }, uniqueItems: true } } },
    land: strictState({ riskLevel: ["UNKNOWN", "LOW", "RISING", "HIGH"], safeguardStatus: ["NONE", "PROPOSED", "ACTIVE", "BYPASSED"] }),
    report: strictState({ authorshipMode: ["UNKNOWN", "JOINT", "GOVERNOR_ONLY", "XUNFU_ONLY", "SPLIT"], firstNarrativeController: ["UNDECIDED", "GOVERNOR", "XUNFU", "SHARED"], attachmentStrength: ["NONE", "LEAD_ONLY", "PARTIAL", "TRACEABLE"], dispatchStatus: ["NOT_STARTED", "DRAFTING", "READY", "DISPATCHED", "SPLIT"] }),
    responsibility: { type: "object", additionalProperties: false, required: ["firstRecordStatus", "governorExposure", "xunfuExposure"], properties: { firstRecordStatus: { enum: ["EMPTY", "RECORDED", "DISPUTED"] }, governorExposure: { type: "number" }, xunfuExposure: { type: "number" } } },
    relations: { type: "object", additionalProperties: false, required: ["governorXunfu"], properties: { governorXunfu: { type: "number", minimum: -100, maximum: 100 } } },
    knowledgeTransfers: { type: "array", items: { type: "object" } },
    pendingConsequences: { type: "array", items: { type: "object" } },
  },
};

function strictState(fields) {
  return {
    type: "object",
    additionalProperties: false,
    required: Object.keys(fields),
    properties: Object.fromEntries(Object.entries(fields).map(([key, values]) => [key, { enum: values }])),
  };
}

const manifest = {
  schemaVersion: "sangtian-part-one-authoring-manifest-v1",
  worldId: "sangtian",
  sourceSha256,
  partContractIds: parts.map((part) => part.partId),
  sectionContractIds: sections.map((section) => section.sectionId),
  requirementIds: requirements.map((requirement) => requirement.requirementId),
  adaptationDecisionIds: adaptations.map((adaptation) => adaptation.adaptationDecisionId),
  narrativeStyleProfileId: styleProfile.profileId,
  lifecycleStatus: "MODEL_CANDIDATE",
};

await writeJson(resolve(authoringRoot, "manifest.json"), manifest);
await writeJson(resolve(authoringRoot, "world-start.json"), worldStart);
await writeJson(resolve(authoringRoot, "core-state.schema.json"), coreStateSchema);
await writeJson(resolve(authoringRoot, "requirements/part-01.requirements.json"), { schemaVersion: "story-capability-requirement-set-v1", requirements });
await writeJson(resolve(authoringRoot, "adaptation/part-01.adaptation-decisions.json"), { schemaVersion: "adaptation-decision-set-v2", adaptations });
await writeJson(resolve(authoringRoot, "narrative/style-profile.json"), styleProfile);

for (const part of parts) {
  await writeJson(resolve(authoringRoot, `parts/${part.partId.toLowerCase()}.contract.json`), part);
}

const sectionFileNames = [
  "sec-p1-01-urgent-order.contract.json",
  "sec-p1-02-ownerless-register.contract.json",
  "sec-p1-03-price-of-grain.contract.json",
  "sec-p1-04-report-to-capital.contract.json",
];
for (const [index, section] of sections.entries()) {
  await writeJson(resolve(authoringRoot, `sections/part-01/${sectionFileNames[index]}`), section);
}

const schemaFailures = [];
for (const section of sections) {
  const result = await validateWithSchema("section-contract-v1", section);
  if (!result.valid) schemaFailures.push({ id: section.sectionId, errors: result.errors });
}
for (const requirement of requirements) {
  const result = await validateWithSchema("story-capability-requirement-v1", requirement);
  if (!result.valid) schemaFailures.push({ id: requirement.requirementId, errors: result.errors });
}
for (const adaptation of adaptations) {
  const result = await validateWithSchema("adaptation-decision-v2", adaptation);
  if (!result.valid) schemaFailures.push({ id: adaptation.adaptationDecisionId, errors: result.errors });
}
const styleResult = await validateWithSchema("narrative-style-profile-v1", styleProfile);
if (!styleResult.valid) schemaFailures.push({ id: styleProfile.profileId, errors: styleResult.errors });

console.log(JSON.stringify({
  authoringRoot,
  partCount: parts.length,
  sectionCount: sections.length,
  requirementCount: requirements.length,
  adaptationCount: adaptations.length,
  schemaFailures,
  verdict: schemaFailures.length === 0 ? "PASS" : "FAIL",
}, null, 2));
if (schemaFailures.length > 0) process.exitCode = 1;
