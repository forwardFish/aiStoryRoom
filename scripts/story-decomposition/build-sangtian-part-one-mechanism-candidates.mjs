import { readdir } from "node:fs/promises";
import { resolve } from "node:path";
import {
  computeImmutableHash,
  readJson,
  repoRoot,
  validateWithSchema,
  writeJson,
} from "./lib/contract-utils.mjs";

const EVIDENCE_RELEASE_ID = "sangtian-part-one-evidence-v1.0.0";
const authoringRoot = resolve(repoRoot, "packages/templates/authoring/sangtian");
const evidenceRoot = resolve(repoRoot, "docs/剧本/嘉靖财政危局/derived/evidence-v2/published", EVIDENCE_RELEASE_ID);
const mechanismRoot = resolve(authoringRoot, "mechanisms/candidates/part-01-v3");
const continuityRoot = resolve(authoringRoot, "continuity/source-reference");

const definitions = {
  "REQ-P1-EXECUTION-BOUNDARY": {
    candidateType: "INSTITUTION_CAPABILITY",
    preconditions: ["朝廷改桑要求已经到达浙江", "玩家仍拥有总督执行与行文权限"],
    actors: ["actor.zhejiang_governor", "actor.zhejiang_xunfu"],
    moves: ["限定首批改桑范围", "附加复核和民生条件", "先试办后扩围", "要求共同留名承担责任"],
    countermoves: ["巡抚以期限和抗命风险催办", "执行方抢先造成既成事实"],
    delayed: ["执行速度改变后续粮食与土地压力", "书面边界决定问责时谁能切割责任"],
    invariants: ["玩家不能废除国策", "任何执行模式都必须承担速度、民生或政治代价"],
    limits: ["具体三日期限来自 Adaptation", "原著后续执行结果不是房间必然未来"],
  },
  "REQ-P1-RESPONSIBILITY-RECORD": {
    candidateType: "CAUSAL_RULE",
    preconditions: ["存在待签或待修改的正式文书", "至少两方对文书内容或署名有不同利益"],
    actors: ["actor.zhejiang_governor", "actor.zhejiang_xunfu"],
    moves: ["单独具名", "要求联署", "记录异议后附条件签发", "拒签并另行成文"],
    countermoves: ["对方拒绝署名", "对方先发另一版本奏报", "把延误责任写入公文"],
    delayed: ["京师按最先到达且证据最完整的文书形成初步定性", "未具名者获得切割责任的空间"],
    invariants: ["口头同意不能自动等于已形成正式责任记录", "谁主张、谁署名、谁经手必须分别记录"],
    limits: ["不能仅凭立场推定最终问责", "具体巡抚角色位来自 Adaptation"],
  },
  "REQ-P1-XUNFU-COUNTERMOVE": {
    candidateType: "ACTOR_POLICY",
    preconditions: ["玩家行动触及执行速度、复核权或责任归属", "knowledgeTransfers 中存在接收者为 actor.zhejiang_xunfu 且主题匹配的送达事件，或该行动已通过巡抚依法可见的正式公文公开；否则本策略不得触发"],
    actors: ["actor.zhejiang_xunfu", "actor.xunfu_aide"],
    moves: ["依据改编后的巡抚权限催办并要求书面回复", "要求参与复核并留下本方经手记录", "拒绝在包含延缓主张的文书上联署", "另行递交写明异议的地方文书"],
    countermoves: ["接受共同承担责任以换取执行速度", "用已有催办公文质疑拖延", "通过合法文书渠道把分歧送往上级"],
    delayed: ["督抚关系与京师叙事同步变化", "复核权被一方掌握后改变证据可见性"],
    invariants: ["巡抚必须有自己的目标和行动能力", "不能因为是对手就预设其已犯罪"],
    limits: ["原著只提供催办、拒签、另行成文与责任自保机制；具体巡抚动作属于弱推断", "独立巡抚及其权限必须由 ADAPT-P1-SEPARATE-XUNFU 批准后才能发布"],
    strength: "WEAK_INFERENCE",
  },
  "REQ-P1-REGISTER-CUSTODY": {
    candidateType: "CUSTODY_RULE",
    preconditions: ["县册、田契、抄件或封条已经以事件进入房间", "行动者具有接触、封存或抄录的合法路径"],
    actors: ["actor.zhejiang_governor", "actor.qingliu_magistrate", "actor.reform_clerk"],
    moves: ["封存原件并记录见证人", "制作带经手记录的副本", "限制接触范围", "把材料移交另一保管人"],
    countermoves: ["拒绝交出原件", "抢先抄录或替换", "破坏封条", "毁灭某一份实物"],
    delayed: ["保管链强弱决定证据能否随奏报进入问责", "多份材料可能使单点销毁不能抹除全部线索"],
    invariants: ["原件、副本、听闻内容和推断必须区分", "后续原著焚账只提供机制参考，不能提前发生"],
    limits: ["清流县册异常是 Adaptation", "不能从同样四箱推定原副本关系"],
  },
  "REQ-P1-REVIEW-AUTHORITY": {
    candidateType: "INSTITUTION_CAPABILITY",
    preconditions: ["复核对象和程序争议已经进入正式议程", "参与者只能在自身官职权限和文书渠道内行动"],
    actors: ["actor.zhejiang_governor", "actor.zhejiang_xunfu", "actor.qingliu_magistrate"],
    moves: ["由总督主持并邀请见证", "由巡抚衙门汇总复核", "成立督抚共同复核", "让县令先行自查并限期提交"],
    countermoves: ["质疑复核越权", "拒绝共享原件", "要求先执行后复核", "把复核改写为地方抗命"],
    delayed: ["主持权改变谁先接触材料和谁写结论", "程序可信度影响第一份奏报的分量"],
    invariants: ["程序权不自动证明实体真相", "参与复核不等于共享全部知识"],
    limits: ["具体督抚分工须由 Adaptation 明确", "不得发明超越官职的搜捕或定罪权"],
  },
  "REQ-P1-KNOWLEDGE-CHAIN": {
    candidateType: "KNOWLEDGE_RULE",
    preconditions: ["信息通过在场、有限口述或可追踪文书中的一种路径出现", "接收者、发送者和渠道可由事件记录"],
    actors: ["actor.zhejiang_governor", "actor.zhejiang_xunfu", "actor.qingliu_magistrate", "actor.reform_clerk"],
    moves: ["创建包含发送者、接收者和渠道的知识转移事件", "有限口述并标明未取得实物", "移交文书并记录实际接触者", "只让已经获得信息的人据此行动"],
    countermoves: ["绕过通常文书渠道", "只透露部分账目", "把文书转交另一接触者", "以未见原件为由质疑传闻"],
    delayed: ["不同人物形成不对称知识", "秘密一旦公开便不可恢复为私密状态"],
    invariants: ["人物只能使用 knowledgeTransfers 中已有获得路径的信息", "character_statement 只能作为某人说过或相信的内容，不能写入 objectiveFacts"],
    limits: ["暗账入口由 Adaptation 提供", "DeepSeek 不得补造未发生的信息传递"],
  },
  "REQ-P1-GRAIN-RELIEF": {
    candidateType: "RESOURCE_CONSTRAINT",
    preconditions: ["官仓或可调用粮源不足以同时满足全部需要", "粮价或灾民压力已经可见"],
    actors: ["actor.zhejiang_governor", "actor.qingliu_magistrate", "actor.jiangnan_merchant_head"],
    moves: ["调官仓", "向邻省借粮", "让商人垫粮", "按人群和地区确定赈济优先级"],
    countermoves: ["以粮源不足反对土地保护", "商人要求担保或优先权", "地方截留或延迟运输"],
    delayed: ["救急渠道形成债务和责任", "粮食不足会压迫百姓出售土地"],
    invariants: ["救粮方案必须有来源、数量约束和代价", "不能用一句开仓就消除粮荒"],
    limits: ["原著支持多渠道求粮但不提供本房间精确库存", "数值必须来自运行时状态而非模型猜测"],
  },
  "REQ-P1-MERCHANT-CONDITIONS": {
    candidateType: "ACTOR_POLICY",
    preconditions: ["官府需要粮、银或运输能力", "商会拥有可验证但非无限的资源"],
    actors: ["actor.jiangnan_merchant_head", "actor.zhejiang_governor", "actor.zhejiang_xunfu"],
    moves: ["提出开仓或垫付", "索取优先收丝权", "要求低价购田或官府担保", "以账目内情换取合作"],
    countermoves: ["接受限制条款后缩减资源", "绕过总督接触巡抚", "把短期救急和个人前程绑定"],
    delayed: ["商会权利扩大后进入粮路、丝路或土地", "拒绝合作会保住边界但放大即时粮食压力"],
    invariants: ["商会方案短期必须真实有效", "商人不是纯反派，也不能无条件救济"],
    limits: ["江南商会为合成组织", "不能把沈一石的具体罪责直接移植给商会会首"],
  },
  "REQ-P1-LAND-RISK": {
    candidateType: "CAUSAL_RULE",
    preconditions: ["改桑范围、粮食缺口或购田方案至少一项已经确定", "百姓生计和田价仍受地方政策影响"],
    actors: ["actor.zhejiang_governor", "actor.jiangnan_merchant_head", "actor.qingliu_magistrate"],
    moves: ["设置田价底线", "限制灾期购田", "把指标分散到多县", "允许以田换粮但记录债务"],
    countermoves: ["以粮食期限压低保护标准", "通过代持或多家商号规避限制", "把失田包装成未来雇佣"],
    delayed: ["粮食与执行选择改变抵押、卖田和兼并风险", "土地保护会增加财政或改桑进度压力"],
    invariants: ["第一部分只能建立风险和入口，不能直接完成大规模兼并", "田价主张必须保留说话人和适用边界"],
    limits: ["具体商会和清流县交易来自 Adaptation", "不能把张居正预判写成已发生事实"],
  },
  "REQ-P1-REPORT-AUTHORSHIP": {
    candidateType: "DECISION_KERNEL",
    preconditions: ["存在一份需要形成、修改或决定是否联署的地方奏报", "玩家掌握至少一项可写入的执行、民生或证据事实"],
    actors: ["actor.zhejiang_governor", "actor.zhejiang_xunfu"],
    moves: ["提议督抚共同奏报并逐项确认内容", "依据可玩总督 Adaptation 单独具名奏报", "允许巡抚拒绝联署并附送有具名的异议文书", "保留两份内容不同且各自可追踪的地方文书"],
    countermoves: ["拒绝联署", "另递具名信件", "要求删去延缓或民生内容", "通过另一合法渠道送达"],
    delayed: ["内容不同的奏报与具名信件到达京师后可能触发不同政治反应", "署名与经手记录为后续问责提供可追踪材料"],
    invariants: ["奏报内容只能使用当前已知事实", "共同署名不能消除真实分歧"],
    limits: ["总督玩家的自由行动来自 ADAPT-P1-PLAYABLE-GOVERNOR，独立巡抚与分立署名来自 ADAPT-P1-SEPARATE-XUNFU", "具体选项必须经运行时 Institution Capability 检查，不能预写皇帝最终裁决"],
    strength: "STRONG_INFERENCE",
  },
  "REQ-P1-EVIDENCE-ATTACHMENT": {
    candidateType: "CUSTODY_RULE",
    preconditions: ["至少有一种原件、副本、口供、仓单或田契进入证据状态", "附件强度和保管链可被服务端读取"],
    actors: ["actor.zhejiang_governor", "actor.qingliu_magistrate", "actor.reform_clerk"],
    moves: ["附原件并保留副本", "附副本并声明原件保管人", "只报异常不下定论", "暂不附证据以保护证人"],
    countermoves: ["质疑副本来源", "抢夺或毁坏原件", "要求公开证人", "利用附件不足压低奏报可信度"],
    delayed: ["附件强度改变京师采信和地方毁证动机", "过早公开会提高证人和保管链风险"],
    invariants: ["证据类型和证明边界必须明确", "后续原著封缄机制不能当作本房间已发生事实"],
    limits: ["县册异常和暗账入口依赖 Adaptation", "密信本身不能替代原册或暗账"],
  },
  "REQ-P1-CAPITAL-FRAMING": {
    candidateType: "CAUSAL_RULE",
    preconditions: ["正式或非正式文书已经进入递送渠道", "渠道中介、署名和附件状态可追踪"],
    actors: ["actor.zhejiang_governor", "actor.zhejiang_xunfu", "institution.grand_secretariat", "institution.sili"],
    moves: ["走通政司正式渠道", "使用密奏或专递", "让多份文书相互印证", "在奏报中标明事实与推断边界"],
    countermoves: ["中介截留或延迟", "以另一套语言重述地方问题", "先见某一方奏报", "要求补证后再定性"],
    delayed: ["京师先收到的版本形成第一版事实框架", "渠道记录成为后续追责的一部分"],
    invariants: ["京师角色不得提前知道未送达信息", "第一版定性不是最终御前裁决"],
    limits: ["只定义渠道和政治解释机制", "不得提前引入第四部分裁决"],
  },
};

function refsFor(requirement) {
  return requirement.adaptationGapIds.length
    ? requirement.requiredResourceRefs
    : [...requirement.requiredResourceRefs, ...requirement.playerAuthorityRefs];
}

const requirementSet = await readJson(resolve(authoringRoot, "requirements/part-01.requirements.json"));
const candidates = [];
for (const requirement of requirementSet.requirements) {
  const definition = definitions[requirement.requirementId];
  if (!definition) throw new Error(`Missing Track B definition for ${requirement.requirementId}`);
  const candidate = {
    schemaVersion: "gameplay-mechanism-candidate-v1",
    mechanismCandidateId: requirement.mechanismCandidateIds[0],
    requirementIds: [requirement.requirementId],
    sourceSceneIds: requirement.sourceSceneIds,
    sourceClaimIds: requirement.sourceClaimIds,
    candidateType: definition.candidateType,
    dramaticFunction: requirement.dramaticFunction,
    preconditions: definition.preconditions,
    actorRefs: definition.actors,
    authorityOrResourceRefs: refsFor(requirement),
    allowedMoves: definition.moves,
    likelyCountermoves: definition.countermoves,
    immediateStateEffects: requirement.stateEffects,
    delayedConsequences: definition.delayed,
    invariantsToPreserve: definition.invariants,
    evidenceStrength: definition.strength ?? requirement.evidenceStrength,
    limitations: definition.limits,
    proposedAdaptationGapId: requirement.adaptationGapIds[0] ?? null,
    status: "CANDIDATE_ONLY",
  };
  const validation = await validateWithSchema("gameplay-mechanism-candidate-v1", candidate);
  if (!validation.valid) throw new Error(`${candidate.mechanismCandidateId} schema invalid: ${JSON.stringify(validation.errors)}`);
  await writeJson(resolve(mechanismRoot, `${candidate.mechanismCandidateId}.json`), candidate);
  candidates.push(candidate);
}

const sceneFiles = (await readdir(resolve(evidenceRoot, "scenes"))).filter((name) => name.endsWith(".scene.json")).sort();
const batons = [];
for (const sceneFile of sceneFiles) {
  const scene = await readJson(resolve(evidenceRoot, "scenes", sceneFile));
  const claimIds = scene.claimIds;
  const states = (kind, subjectRef, statement, status = "SOURCE_REFERENCE_ONLY") => ({
    stateId: `${scene.sceneId}-${kind}`,
    subjectRef,
    statement,
    status,
    sourceClaimIds: claimIds,
  });
  const baton = {
    schemaVersion: "dm1566_continuity_baton_v2",
    basedOnSceneId: scene.sceneId,
    currentDateAndTime: scene.temporalState.value,
    characterPositions: scene.presentCharacterRefs.map((ref, index) => states(`POSITION-${index + 1}`, ref, `${ref} 在 ${scene.locationRefs.join("、") || "原著场景所示地点"} 出现。`)),
    characterKnowledge: scene.knowledgeDeltas.map((item, index) => states(`KNOWLEDGE-${index + 1}`, item.actorRefs[0] ?? "source.scene_participants", item.statement)),
    activeGoals: scene.commitments.map((item, index) => states(`GOAL-${index + 1}`, item.actorRefs[0] ?? "source.scene_participants", item.statement)),
    relationships: scene.relationshipDeltas.map((item, index) => states(`RELATION-${index + 1}`, item.actorRefs[0] ?? "source.scene_participants", item.statement)),
    resources: scene.immediateResults.map((item, index) => states(`RESOURCE-${index + 1}`, item.actorRefs[0] ?? "source.scene", item.statement)),
    objectCustody: scene.custodyDeltas.map((item, index) => states(`CUSTODY-${index + 1}`, item.actorRefs[0] ?? "source.document_or_object", item.statement)),
    institutionalDecisions: scene.decisions.map((item, index) => states(`DECISION-${index + 1}`, item.actorRefs[0] ?? "source.institution", item.statement)),
    unresolvedPromises: scene.commitments.map((item, index) => states(`PROMISE-${index + 1}`, item.actorRefs[0] ?? "source.scene_participants", item.statement, "UNRESOLVED_IN_SOURCE_SPAN")),
    openThreats: scene.threats.map((item, index) => states(`THREAT-${index + 1}`, item.actorRefs[0] ?? "source.scene_participants", item.statement, "OPEN_IN_SOURCE_SPAN")),
    secretsNotYetKnown: scene.unresolvedQuestions.map((item, index) => states(`SECRET-${index + 1}`, "source.future_runtime", item.statement, "MUST_NOT_ENTER_OPENING_KNOWLEDGE")),
    openCausalChains: scene.actorMoves.map((item, index) => states(`ARC-${index + 1}`, item.actorRefs[0] ?? "source.scene", item.statement, "SOURCE_MECHANISM_REFERENCE")),
    causesWaitingForConsequences: scene.immediateResults.map((item, index) => states(`PENDING-${index + 1}`, item.actorRefs[0] ?? "source.scene", item.statement, "DO_NOT_AUTO_IMPORT")),
    unresolvedAliases: [],
    sourceArtifactIds: [scene.artifactId, ...claimIds],
  };
  const validation = await validateWithSchema("continuity-baton-v2", baton);
  if (!validation.valid) throw new Error(`${scene.sceneId} continuity schema invalid: ${JSON.stringify(validation.errors)}`);
  await writeJson(resolve(continuityRoot, `${scene.sceneId}.baton.json`), baton);
  batons.push(baton);
}

const manifestBase = {
  schemaVersion: "sangtian-part-one-track-b-candidate-manifest-v1",
  evidenceReleaseId: EVIDENCE_RELEASE_ID,
  candidateCount: candidates.length,
  continuityBatonCount: batons.length,
  candidateIds: candidates.map((item) => item.mechanismCandidateId),
  status: "AWAITING_INDEPENDENT_REVIEW",
};
await writeJson(resolve(mechanismRoot, "manifest.json"), { ...manifestBase, immutableHash: computeImmutableHash(manifestBase) });
console.log(JSON.stringify({ mechanismRoot, continuityRoot, ...manifestBase }, null, 2));
