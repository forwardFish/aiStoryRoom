import type { DecisionCandidateV2, PlayerIntentV2 } from "@ai-story/shared";
import type { MainCard, RoleStageContent, StageDefinition, Visibility } from "@ai-story/templates";
import { sha256Canonical } from "../continuous-strategy/canonical";
import { assetDisplayName, containsRawEngineToken } from "./asset-language";
import { candidateIntentDraft } from "./player-intent";

export type StoryRoleContext = {
  id: string;
  roleKey: string;
  roleName: string;
  identity: string;
  publicInfo: string;
  hiddenSecret: string | null;
  personalGoal: string;
  currentState: string;
  abilityText: string | null;
  cannotDo: string[];
};

export type VisibleFact = { factKey: string; content: string };

export type StorySituationInput = {
  role: StoryRoleContext;
  stage: StageDefinition;
  roleStage: RoleStageContent;
  worldSequence: number;
  turnIndex: number;
  locationLabel: string;
  visibleFacts: VisibleFact[];
  incomingImpacts: Array<{ sourceRoleName: string; content: string }>;
  previousResult?: string;
  previousAction?: ResolvedStoryAction;
};

export type ResolvedStoryAction = {
  actionKey: string;
  source: "SUGGESTED" | "EDITED_SUGGESTED" | "CUSTOM";
  visibility: Visibility;
  label: string;
  description: string;
  intent: string;
  risk: "LOW" | "NORMAL" | "HIGH";
  targetRoleId: string | null;
  targetRoleName: string | null;
  basisFactKeys: string[];
  requiredAssetKeys: string[];
  receiptText: string;
  effectFactKeys: string[];
  influenceEdges: Array<{ affectedRoleKey: string; effectKey: string; visibility: string }>;
  nextStateKey: string;
};

export type StageProgressDecision = {
  stageAdvanced: boolean;
  nextStageIndex: number | null;
  reason: "PUBLIC_STAGE_EVIDENCE" | "ACCUMULATED_STAGE_EVIDENCE" | "STAGE_EVIDENCE_PENDING" | "FINAL_STAGE_COMPLETED";
  evidenceFactKeys: string[];
};

export type StoryDraft = {
  situationTitle: string;
  situationNarrative: string;
  framing: string;
  decisions: DecisionCandidateV2[];
  provider: string;
  modelName: string;
};

export type ResolutionDraft = {
  resultNarrative: string;
  nextHook: string;
  nextSituation: StoryDraft | null;
  provider: string;
  modelName: string;
};

export type ContentReview = {
  status: "PASS" | "FAIL";
  scores: Record<string, number>;
  issues: string[];
};

export type CrossImpactInput = {
  sourceRoleName: string;
  targetRoleName: string;
  stageTitle: string;
  locationLabel: string;
  action: ResolvedStoryAction;
  mode?: "FULL" | "TRACE";
};

const BANNED_GENERIC_DECISIONS = [
  "保留证据并交叉核验",
  "推进本职方案并说明代价",
  "协调另一位角色的资源"
];

const DATE_BY_STAGE = [
  "嘉靖三十五年五月初八",
  "嘉靖三十五年五月初九",
  "嘉靖三十五年五月十一",
  "嘉靖三十五年五月十三",
  "嘉靖三十五年五月十五",
  "嘉靖三十五年五月十七",
  "嘉靖三十五年五月二十"
];

const AUTHORED_SUPPORTING_ROLE_CONTEXT: Record<string, { privateBrief: string; personalPressure: string }> = {
  "s1_change_mulberry_order:clerk": {
    privateBrief: "两衙送来的改桑名册数字不同，撤换前的底稿还在你手里，而与你一同誊册的书吏昨夜没有回家。",
    personalPressure: "在不暴露原始索引藏处的情况下，先让每一次改册和补签都能追到具体经手人。"
  },
  "s2_county_secret_letter:clerk": {
    privateBrief: "县令密信没有出现在正常驿簿里，封口印却与一份已撤换底稿上的印记相合；交信人一旦被点名，可能立即失踪。",
    personalPressure: "核实密信从何处进入公文链，同时保住递信人和至少一份未经改动的登记。"
  },
  "s3_grain_price_crisis:clerk": {
    privateBrief: "官仓入库册、放粮票和城门运粮单对不上数，其中一处涂改笔迹与你失踪同僚惯用的笔锋相同。",
    personalPressure: "在仓吏销毁旧票前固定库存差额，并避免自己被当成做账的替罪羊。"
  },
  "s4_hidden_ledger:clerk": {
    privateBrief: "暗账页码引用了你私留的名册编号，也记着失踪书吏的签押；它可能补全证据链，也可能是诱你交出原件的饵。",
    personalPressure: "先验证暗账与原始名册能否互证，再决定由谁保管原件和证人口供。"
  },
  "s5_mutual_impeachment:clerk": {
    privateBrief: "总督与巡抚都要求你交出书证并写下对方强迫改册的口供，但任何单独交付都会让另一边指控你伪造时序。",
    personalPressure: "把命令、签押和改册时点对应清楚，同时避免证据被一方截走后只剩片面说法。"
  },
  "s6_capital_reply:clerk": {
    privateBrief: "送往京师的奏报附件缺了两页原始索引，封缄编号也与发出时不一致；驿使天亮就要启程。",
    personalPressure: "在最后装封前补齐可核验的来源目录，并在杭州留下能证明附件未被替换的副本。"
  },
  "s7_imperial_judgment:clerk": {
    privateBrief: "御前问讯将逐项核对改册时间、命令来源和经手人；你握有能证明篡改的原始索引，也知道作证者会承担什么后果。",
    personalPressure: "只陈述文书能够证明的事实，并争取让交出原件和出面作证的人获得明确保护。"
  },
  "s1_change_mulberry_order:merchant": {
    privateBrief: "改桑急令一到，各县同时向商会借粮借银，巡抚幕僚却要求把一笔没有收据的回扣混进垫款；仓中现粮只够维持数日。",
    personalPressure: "决定商会愿意承担哪些有凭据的垫付，同时守住粮价和契约不被官府口头命令掏空。"
  },
  "s2_county_secret_letter:merchant": {
    privateBrief: "递送密信的人带着一份田契副本躲进商会仓院，账簿里又恰好有涉事官员未偿的借据；把人交给任何一衙都可能毁掉另一份证据。",
    personalPressure: "让密信、田契和借据形成可核验的保管关系，并避免商会被定性为替地方官传递私信。"
  },
  "s3_grain_price_crisis:merchant": {
    privateBrief: "商会掌握的真实库存只够全城五日，而官府要求立即低价尽放；几家米行正在关门囤货，百姓已堵在粮铺外。",
    personalPressure: "在不制造挤兑的前提下释放足够粮食，并留下能说明库存、成本和受益人的公开账目。"
  },
  "s4_hidden_ledger:merchant": {
    privateBrief: "浮出的暗账来自商会旧账房，既记有官员和织造局的隐秘往来，也混入几笔无法确认的银票；全盘承认可能坐实行贿，否认又会失去自证机会。",
    personalPressure: "确认哪些账项有票号和经手人可验，并在交出材料时保护账房与正常商路。"
  },
  "s5_mutual_impeachment:merchant": {
    privateBrief: "两份弹劾都把商会写成哄抬粮价和输送贿银的源头，却隐去了官府要求垫付和指定收款人的命令。",
    personalPressure: "公开足以还原交易时序的账目，同时把商事获利、官府摊派和秘密回扣分开承担。"
  },
  "s6_capital_reply:merchant": {
    privateBrief: "京师追问应急粮从何而来、垫银流向何处，几名官员却在装封前提出以免责批文换商会删账；城中粮路仍不能停。",
    personalPressure: "提交经得住票号复核的银粮报告，拒绝替他人销账，并维持裁决前的基本供应。"
  },
  "s7_imperial_judgment:merchant": {
    privateBrief: "皇帝将当面追问商会究竟是在救市、牟利还是行贿；完整商账能够说明三者边界，也会暴露曾与商会合作的官员。",
    personalPressure: "承认商会确实取得的利益和应负责任，同时确保裁决期间粮路不断、正常契约不被一并清算。"
  },
  "s1_change_mulberry_order:sili_jian": {
    privateBrief: "你带来的诏令副本与地方加急催办稿在日期和措辞上有一处差异，织造局又收到要求暗中拨银的口信；若公开质疑，所有人都会说内廷阻挠国策。",
    personalPressure: "查清哪一道催办真正得到御前授权，同时不替任何地方官预先背书。"
  },
  "s2_county_secret_letter:sili_jian": {
    privateBrief: "县令密信声称要直达御前，却先后经过两衙和织造局驿线；封缄上的两枚印信不在同一日加盖。",
    personalPressure: "还原密信被谁截留、转交和补封，并确保真件能沿可信渠道送到御前。"
  },
  "s3_grain_price_crisis:sili_jian": {
    privateBrief: "织造局拨出的银子出现在商会购粮账上，但官仓奏报没有记入相应粮数；地方官都想让你把差额写成商人囤积。",
    personalPressure: "核对银票、仓单和放粮记录，区分真实短缺、账目挪用与人为操纵。"
  },
  "s4_hidden_ledger:sili_jian": {
    privateBrief: "暗账列有织造局内监的收银编号，既可能证明有人借内廷名义截留，也可能是地方官伪造编号嫁祸。",
    personalPressure: "隔离涉账人员并验证编号来源，在证据完整前不让内廷渠道被用来灭证或翻案。"
  },
  "s5_mutual_impeachment:sili_jian": {
    privateBrief: "总督、巡抚和商会递来的材料都引用了你的密报，却删去了对自己不利的段落；京师已经催问为何奏报互相矛盾。",
    personalPressure: "把各份奏疏与原始密报逐项比对，让御前看到删节发生在何处而非只听你的判断。"
  },
  "s6_capital_reply:sili_jian": {
    privateBrief: "三路奏报即将装封进京，其中两份附件被重新誊抄，一份织造局审计页则被要求以涉密为由撤下。",
    personalPressure: "形成一套有原件编号、删节标记和递送回执的案卷，保证任何一衙都无法在途中单独改动。"
  },
  "s7_imperial_judgment:sili_jian": {
    privateBrief: "御前要你回答哪些损失来自改桑国策、哪些来自越权催办和侵吞；内廷自身也有人出现在暗账上。",
    personalPressure: "依据能够复核的银粮与奏报证据陈述，不替皇帝宣布结论，也不以维护内廷为由掩盖涉案人员。"
  }
};

export function groundRoleStageContent(stage: StageDefinition, role: StoryRoleContext, roleStage: RoleStageContent): RoleStageContent {
  const override = AUTHORED_SUPPORTING_ROLE_CONTEXT[`${stage.stageKey}:${role.roleKey}`];
  const roleMethod = role.roleKey === "clerk"
    ? "把涉及的原件编号、经手人和文书时辰逐项登记，留下可供复查的书证"
    : role.roleKey === "merchant"
      ? "写明涉及的粮银、契约对象、期限和担责人，让处置能够由账簿复核"
      : role.roleKey === "sili_jian"
        ? "核对密令、驿递和银票依据，并把查验经过封入可直达御前的回执"
        : "写明执行对象、经手人、时辰和可复核的凭据";
  return {
    ...roleStage,
    privateBrief: override?.privateBrief || roleStage.privateBrief,
    personalPressure: override?.personalPressure || roleStage.personalPressure,
    mainCards: roleStage.mainCards.map((card) => {
      const genericObjective = /围绕“[^”]+”执行“[^”]+”|以控制.+带来的风险/.test(card.objective);
      const genericReceipt = /已经登记，相关记录将影响另一方角色的后续判断/.test(card.receipt.text);
      return {
        ...card,
        objective: genericObjective ? `当场${asClause(card.title)}，并${roleMethod}` : card.objective,
        receipt: {
          ...card.receipt,
          text: genericReceipt
            ? `“${asClause(card.title)}”已经写入具名公文；执行对象、经手时辰和复核凭据都留在回执上`
            : card.receipt.text
        }
      };
    })
  };
}

export function buildDeterministicSituation(input: StorySituationInput): StoryDraft {
  const roleStage = groundRoleStageContent(input.stage, input.role, input.roleStage);
  const groundedInput = { ...input, roleStage };
  const date = DATE_BY_STAGE[input.stage.stageNumber - 1] || `嘉靖三十五年五月第${input.stage.stageNumber}日`;
  const fact = input.visibleFacts.at(-1)?.content;
  const impact = input.incomingImpacts.at(-1);
  const continuation = input.previousResult
    ? `上一项决定留下的余波已经抵达案前。${firstCompleteSentence(input.previousResult)}`
    : `${input.role.roleName}刚在案前坐定，门外的驿铃便催了第二遍。`;
  const knownFact = fact ? `案上还有一条已经核实的事实：${asSentence(fact)}` : "";
  const external = impact
    ? `就在你准备落笔时，${impact.sourceRoleName}送来的封口公文也到了。${firstCompleteSentence(impact.content)}${knownFact}`
    : knownFact || `你手里只有自己的职权、旧账与眼前这份公文，不能假定旁人会替你承担后果。`;
  const narrative = [
    `${date}，${input.locationLabel}。${continuation}`,
    `围绕“${input.stage.commonContest.title}”，${asSentence(input.stage.commonContest.description)}${external}`,
    `只有${input.role.roleName}自己清楚：${asSentence(roleStage.privateBrief)}与此同时，你还面临一项不能回避的要求：${asSentence(roleStage.personalPressure)}门外的人仍在等回话，因此你现在就得决定先动哪一处。`
  ].join("\n\n");
  const decisions = buildDecisionCandidates(groundedInput, input.previousAction?.actionKey);
  return {
    situationTitle: `${input.stage.title}：${input.role.roleName}眼前的难题`,
    situationNarrative: narrative,
    framing: `在${input.stage.commonContest.title}尚未落定之前，${input.role.roleName}先从哪里下手？`,
    decisions,
    provider: "rules",
    modelName: "state-grounded-story-v2"
  };
}

export function buildDeterministicResolution(
  current: StorySituationInput,
  action: ResolvedStoryAction,
  next: StorySituationInput | null
): ResolutionDraft {
  const roleStage = groundRoleStageContent(current.stage, current.role, current.roleStage);
  const receipt = action.receiptText || `回执上记下了“${action.label}”，经手人与时辰都无法再抹去`;
  const target = action.targetRoleName ? `这份命令也把${action.targetRoleName}卷入了后续处置。` : "";
  const resultNarrative = [
    `“${action.label}”不是一句口头表态。${current.role.roleName}当场下令：${asSentence(action.description)}${target}`,
    `${asSentence(receipt)}从这一刻起，“${current.stage.commonContest.title}”第一次有了可以追查的落点。与此同时，你仍面临原来的难题：${asSentence(roleStage.personalPressure)}它没有消失，反而因为你的选择变成了旁人必须回应的现实。`,
    `回执送出后，衙门里的脚步声和说话方式都变了。有人开始依照新留下的凭据办事，仍坚持旧说法的人则必须解释为何拒绝核对。因此，你的行动确实推动了局势，却没有替任何人预先决定胜负。`
  ].join("\n\n");
  return {
    resultNarrative,
    nextHook: next
      ? next.stage.stageNumber === current.stage.stageNumber
        ? `${current.stage.title}尚未结束；这份新凭据已经改变了同一场冲突中的下一步。`
        : `${next.stage.title}已经来到门前；上一决定留下的凭据会进入下一场冲突。`
      : `${current.role.roleName}已经走完七个宏观阶段；实际发生的每次行动共同写成了这条个人结局线。`,
    nextSituation: next ? buildDeterministicSituation(next) : null,
    provider: "rules",
    modelName: "state-grounded-story-v2"
  };
}

export function buildCrossImpactNarrative(input: CrossImpactInput) {
  if (input.mode === "TRACE") {
    const trace = (input.action as ResolvedStoryAction & { observableTraceText?: string | null }).observableTraceText
      || `${input.stageTitle}期间，${input.locationLabel}出现了一批无法解释的新公文、查验印记和人员调动。`;
    return [
      `${trace}递送人没有携带能确认幕后行动者的具名公文，沿途经手者也只知道自己负责的一小段。`,
      `这些痕迹已经改变了现场：有人提前封存材料，有人追问命令来源，也有人开始转移原先放在明处的筹码。因此，局势确实被推动，却不能仅凭眼前迹象断定是谁行动、用了什么完整方法或怀着什么秘密目的。`,
      `${input.targetRoleName}现在能做的是核验痕迹、保护自己的证人与材料，或利用这次变化重新布局。任何进一步判断都必须来自后续调查和他人回应，不能把旁观所得当成全知情报。`
    ].join("\n\n");
  }
  const target = input.action.targetRoleName ? `，后续处置也将牵涉${input.action.targetRoleName}` : "";
  return [
    `${input.stageTitle}的争执还没有平息，一名差役带着封口公文赶到${input.locationLabel}。公文写明，${input.sourceRoleName}已经执行“${input.action.label}”${target}；经手人的姓名、时辰和传递路径都留在回执上。`,
    `${asSentence(input.action.receiptText)}这份回执让旧说法第一次有了可以当面对照的纸面落点，也迫使继续拖延的人解释为何不照新留下的凭据办事。`,
    `消息送到${input.targetRoleName}眼前时，门外等候的人已经开始互相打听下一步口径。因此，${input.targetRoleName}尚未作出的决定并没有被别人代替，但原先可以使用的时机、证据和说法已经改变；下一次行动必须回应这件刚刚发生的事。`
  ].join("\n\n");
}

export function buildDecisionCandidates(
  input: StorySituationInput,
  previousActionKey?: string
): DecisionCandidateV2[] {
  const { role, roleStage, visibleFacts } = input;
  const visibleKeys = visibleFacts.map((fact) => fact.factKey);
  const availableCards = roleStage.mainCards.filter((card) => card.actionKey !== previousActionKey);
  const liveContext = decisionContextLead(input);
  return availableCards.map((card, index) => {
    const fallbackCard = card.fallbackActionKey ? roleStage.mainCards.find((candidate) => candidate.actionKey === card.fallbackActionKey) || null : null;
    const intentDraft = candidateIntentDraft({
      card,
      fallbackCard,
      publicFrameId: input.stage.commonContest.contestKey,
      publicFrameLabel: input.stage.commonContest.title
    });
    return {
      id: `decision_${sha256Canonical({ roleKey: role.roleKey, stageKey: roleStage.stageKey, actionKey: card.actionKey }).slice(0, 16)}`,
      actionKey: card.actionKey,
      label: contextualLabel(card, role),
      description: `${liveContext}${asSentence(card.objective)}`,
      intent: card.objective,
      targetRoleId: null,
      targetRoleName: null,
      risk: card.risk,
      basisFactKeys: unique([...visibleKeys.slice(-2), ...card.effect.factKeys]).slice(0, 4),
      requiredAssetKeys: unique(card.assetMutations.filter((mutation) => mutation.mutationType !== "CLAIM").map((mutation) => mutation.assetKey)),
      authorityBasis: role.abilityText || role.identity || `第${index + 1}项角色职权`,
      intendedOutcome: card.objective,
      concreteCost: concreteCost(card, role),
      expectedCountermove: expectedCountermove(card),
      visibility: card.visibility,
      effectHooks: [
        ...card.effect.factKeys.map((key) => `WORLD_FACT:${key}`),
        ...card.effect.influenceEdges.map((edge) => `INFLUENCE:${edge.affectedRoleKey}:${edge.effectKey}`),
        ...card.assetMutations.map((mutation) => `ASSET:${mutation.assetKey}:${mutation.mutationType}`)
      ],
      intentDraft
    };
  });
}

export function actionFromCandidate(
  candidate: DecisionCandidateV2,
  card: MainCard,
  targetRoleId: string | null,
  targetRoleName: string | null
): ResolvedStoryAction {
  return {
    actionKey: card.actionKey,
    source: "SUGGESTED",
    visibility: card.visibility,
    label: candidate.label,
    description: candidate.description,
    intent: candidate.intent,
    risk: candidate.risk,
    targetRoleId,
    targetRoleName,
    basisFactKeys: candidate.basisFactKeys,
    requiredAssetKeys: candidate.requiredAssetKeys,
    receiptText: card.receipt.text,
    effectFactKeys: card.effect.factKeys,
    influenceEdges: card.effect.influenceEdges,
    nextStateKey: card.effect.nextStateKey
  };
}

export function evaluateStageProgress(
  action: ResolvedStoryAction,
  stage: StageDefinition,
  stageTurnOrdinal: number,
  totalStages: number
): StageProgressDecision {
  const effectHooks = Array.isArray((action as ResolvedStoryAction & { effectHooks?: string[] }).effectHooks)
    ? (action as ResolvedStoryAction & { effectHooks: string[] }).effectHooks
    : action.effectFactKeys.map((factKey) => `WORLD_FACT:${factKey}`);
  const evidenceFactKeys = action.effectFactKeys.filter((factKey) => effectHooks.includes(`WORLD_FACT:${factKey}`));
  const createsPublicEvidence = evidenceFactKeys.length > 0 && (action.visibility === "PUBLIC" || action.visibility === "OBSERVABLE");
  const accumulatedEvidence = evidenceFactKeys.length > 0 && stageTurnOrdinal >= 2;
  const stageAdvanced = createsPublicEvidence || accumulatedEvidence;
  if (!stageAdvanced) {
    return { stageAdvanced: false, nextStageIndex: stage.stageNumber, reason: "STAGE_EVIDENCE_PENDING", evidenceFactKeys };
  }
  const completed = stage.stageNumber >= totalStages;
  return {
    stageAdvanced: true,
    nextStageIndex: completed ? null : stage.stageNumber + 1,
    reason: completed ? "FINAL_STAGE_COMPLETED" : createsPublicEvidence ? "PUBLIC_STAGE_EVIDENCE" : "ACCUMULATED_STAGE_EVIDENCE",
    evidenceFactKeys
  };
}

export function reviewStory(
  content: string,
  context: Pick<StorySituationInput, "role" | "stage" | "roleStage" | "visibleFacts" | "previousAction" | "previousResult">,
  kind: "SITUATION" | "RESULT",
  action?: ResolvedStoryAction,
  continuationContent = ""
): ContentReview {
  const issues: string[] = [];
  // The result scene shows what the player did; the immediately following
  // situation is allowed to state the strategic objective that remains at
  // stake. Review the pair as one causal beat instead of forcing the Writer to
  // repeat the button text mechanically in both halves.
  const intentEvidence = continuationContent.trim()
    ? `${content}\n\n${continuationContent}`
    : content;
  if (content.replace(/\s/g, "").length < 140) issues.push("STORY_TOO_SHORT");
  // Natural prose commonly uses the office title ("总督") after the role is
  // established instead of repeating the full registry label ("浙江总督").
  // Likewise, a scene should embody its concrete subject ("改桑") rather than
  // be forced to quote an internal chapter heading ("改桑急令") verbatim.
  if (!containsRoleReference(content, context.role.roleName)) issues.push("ROLE_NOT_GROUNDED");
  if (!containsSceneReference(
    content,
    context.stage.title,
    context.stage.commonContest.title,
    context.stage.commonContest.description,
    context.roleStage.privateBrief,
    context.roleStage.personalPressure
  )) issues.push("SCENE_NOT_GROUNDED");
  if (!/[。！？]/.test(content) || content.split(/\n\n+/).length < 2) issues.push("NOT_HUMAN_READABLE_PROSE");
  if (!/(因此|于是|却|反而|迫使|让|使得|与此同时|由于|因而|故而|以致|从而|若|一旦|否则|但|既然|便)/.test(content)) issues.push("CAUSAL_LINK_MISSING");
  if (/状态变化[:：]|规则结算[:：]|事实键|effectKey|nextStateKey/.test(content)) issues.push("RULE_SUMMARY_LEAKED");
  issues.push(...reviewProseIntegrity(content));
  if (kind === "SITUATION" && context.visibleFacts.length && !context.visibleFacts.some((fact) => containsNarrativeAnchor(content, fact.content))) {
    issues.push("VISIBLE_FACT_CONTINUITY_MISSING");
  }
  if (kind === "SITUATION" && context.previousAction
    && !containsNarratedMeaning(content, context.previousAction.label)
    && !containsNarratedMeaning(content, context.previousAction.description)
    && !/上一项决定|上一行动|刚刚/.test(content)) issues.push("PREVIOUS_ACTION_CONTINUITY_MISSING");
  if (kind === "RESULT" && action && !containsNarratedMeaning(content, action.label) && !containsNarratedMeaning(content, action.description)) {
    issues.push("PLAYER_ACTION_NOT_REFLECTED");
  }
  if (kind === "RESULT" && action && !containsNarratedMeaning(intentEvidence, action.intent)) issues.push("PLAYER_OBJECTIVE_NOT_PRESERVED");
  if (kind === "RESULT" && action?.targetRoleName && !containsRoleReference(content, action.targetRoleName)) issues.push("ACTION_TARGET_NOT_PRESERVED");
  const planned = action as ResolvedStoryAction & { normalizedIntent?: PlayerIntentV2 };
  if (kind === "RESULT" && planned?.normalizedIntent) {
    if (!containsNarratedMeaning(intentEvidence, planned.normalizedIntent.objective) || !containsNarratedMeaning(content, planned.normalizedIntent.method)) issues.push("IMMUTABLE_INTENT_NOT_NARRATED");
    const targetIsNarrated = planned.normalizedIntent.target.type === "ROLE"
      ? containsRoleReference(content, planned.normalizedIntent.target.label)
      : containsNarratedMeaning(content, planned.normalizedIntent.target.label);
    if (!targetIsNarrated) issues.push("INTENT_TARGET_NOT_NARRATED");
    for (const key of planned.normalizedIntent.leverageKeys) if (!containsNarratedMeaning(content, assetDisplayName(key))) issues.push(`SELECTED_LEVERAGE_NOT_NARRATED:${key}`);
    if (planned.normalizedIntent.fallback && !containsNarratedMeaning(content, planned.normalizedIntent.fallback.method)) issues.push("FALLBACK_NOT_NARRATED");
    if (planned.normalizedIntent.condition && !content.includes(planned.normalizedIntent.condition.eventType)) issues.push("CONDITION_NOT_NARRATED");
  }
  const score = Math.max(0, 5 - issues.length);
  return { status: issues.length ? "FAIL" : "PASS", scores: { specificity: score, causality: score, readability: score, continuity: score }, issues };
}

export function reviewCrossImpact(content: string, context: CrossImpactInput): ContentReview {
  const issues: string[] = [];
  if (content.replace(/\s/g, "").length < 140) issues.push("CROSS_IMPACT_TOO_SHORT");
  if (context.mode === "TRACE") {
    if (!content.includes(context.targetRoleName)) issues.push("TRACE_TARGET_MISSING");
    if (content.includes(context.sourceRoleName)
      || content.includes(context.action.label.slice(0, Math.min(8, context.action.label.length)))
      || content.includes(context.action.description.slice(0, Math.min(8, context.action.description.length)))) issues.push("OBSERVABLE_TRACE_LEAKED_PRIVATE_ACTION");
  } else if (!content.includes(context.sourceRoleName) || !content.includes(context.targetRoleName)) issues.push("CROSS_IMPACT_ROLES_MISSING");
  if (!content.includes(context.stageTitle)) issues.push("CROSS_IMPACT_SCENE_MISSING");
  if (context.mode !== "TRACE" && !content.includes(context.action.label.slice(0, Math.min(8, context.action.label.length)))) issues.push("CROSS_IMPACT_ACTION_MISSING");
  if (content.split(/\n\n+/).length < 2 || !/(因此|于是|迫使|使得|与此同时)/.test(content)) issues.push("CROSS_IMPACT_CAUSAL_PROSE_MISSING");
  if (/状态变化[:：]|规则结算[:：]|事实键|effectKey|nextStateKey/.test(content)) issues.push("RULE_SUMMARY_LEAKED");
  issues.push(...reviewProseIntegrity(content));
  const score = Math.max(0, 5 - issues.length);
  return { status: issues.length ? "FAIL" : "PASS", scores: { specificity: score, causality: score, readability: score, continuity: score }, issues };
}

export function reviewDecisionSet(
  candidates: DecisionCandidateV2[],
  context: StorySituationInput,
  options: { allowFixedActionKeys?: boolean } = {}
): ContentReview {
  const issues: string[] = [];
  if (candidates.length < 2 || candidates.length > 4) issues.push("DECISION_COUNT_INVALID");
  const labels = candidates.map((candidate) => normalize(candidate.label));
  if (new Set(labels).size !== labels.length) issues.push("DECISIONS_NOT_DISTINCT");
  for (const candidate of candidates) {
    if (candidate.actionKey && !options.allowFixedActionKeys) issues.push(`FIXED_RULE_CARD_PUBLISHED:${candidate.id}`);
    if (candidate.label.length < 4 || candidate.description.length < 8) issues.push(`DECISION_NOT_UNDERSTANDABLE:${candidate.id}`);
    if (BANNED_GENERIC_DECISIONS.some((text) => candidate.label.includes(text))) issues.push(`GENERIC_FIXED_DECISION:${candidate.id}`);
    if (/围绕“[^”]+”执行“[^”]+”|以控制.+带来的风险|相关记录将影响另一方角色/.test(candidate.description)) issues.push(`GENERIC_TEMPLATE_DECISION:${candidate.id}`);
    if (candidate.actionKey && !candidate.basisFactKeys.length) issues.push(`DECISION_WITHOUT_STORY_BASIS:${candidate.id}`);
    if (!candidate.authorityBasis) issues.push(`DECISION_WITHOUT_AUTHORITY:${candidate.id}`);
    if (!candidate.intendedOutcome || !candidate.concreteCost || !candidate.expectedCountermove) issues.push(`DECISION_WITHOUT_TRADEOFF:${candidate.id}`);
    if (!candidate.effectHooks.length) issues.push(`DECISION_WITHOUT_EFFECT_HOOKS:${candidate.id}`);
    if (!candidate.intentDraft?.objective || !candidate.intentDraft?.method || !candidate.intentDraft?.target?.id) issues.push(`DECISION_WITHOUT_INTENT_DRAFT:${candidate.id}`);
    if (normalize(candidate.intentDraft.objective) !== normalize(candidate.intendedOutcome)) issues.push(`DECISION_INTENT_OUTCOME_MISMATCH:${candidate.id}`);
    if (candidate.targetRoleId && candidate.intentDraft.target.type === "ROLE" && candidate.intentDraft.target.id !== candidate.targetRoleId) issues.push(`DECISION_TARGET_MISMATCH:${candidate.id}`);
    if (candidate.requiredAssetKeys.some((key) => !candidate.intentDraft.leverageKeys.includes(key))) issues.push(`DECISION_LEVERAGE_MISMATCH:${candidate.id}`);
    if (candidate.actionKey && !context.roleStage.mainCards.some((card) => card.actionKey === candidate.actionKey)) issues.push(`DECISION_NOT_ALLOWED:${candidate.id}`);
  }
  if (new Set(candidates.map((candidate) => normalize(`${candidate.intendedOutcome}|${candidate.concreteCost}|${candidate.expectedCountermove}`))).size !== candidates.length) issues.push("DECISION_TRADEOFFS_NOT_DISTINCT");
  const score = Math.max(0, 5 - issues.length);
  return { status: issues.length ? "FAIL" : "PASS", scores: { relevance: score, feasibility: score, distinctness: score, authority: score }, issues: unique(issues) };
}

function contextualLabel(card: MainCard, role: StoryRoleContext) {
  const title = card.title.trim().replace(/[。；]+$/g, "");
  const objectiveLead = card.objective.split(/[，。；]/)[0]?.trim();
  return objectiveLead && !title.includes(objectiveLead) && title.length < 18
    ? `${title}，${objectiveLead}`.slice(0, 38)
    : `${role.roleName}：${title}`.slice(0, 38);
}

function decisionContextLead(input: StorySituationInput) {
  const impact = input.incomingImpacts.at(-1);
  const impactAction = impact?.content.match(/“([^”]{2,42})”/)?.[1];
  if (impact && impactAction) return `回应${impact.sourceRoleName}刚刚执行的“${impactAction}”：`;
  const fact = input.visibleFacts.at(-1)?.content;
  if (fact) return `针对已经核实的“${asClause(fact)}”：`;
  if (input.previousResult) return `沿着上一项决定留下的凭据：`;
  return `面对${asClause(input.roleStage.privateBrief)}：`;
}

function sentence(value: string, _max: number) {
  const compact = String(value || "").trim().replace(/\s+/g, " ");
  if (!compact) return "眼前的具体情势仍在变化";
  return asClause(compact);
}

function asClause(value: string) {
  return String(value || "").trim().replace(/\s+/g, " ").replace(/[。！？；…\s]+$/g, "");
}

function asSentence(value: string) {
  const clause = asClause(value) || "眼前的具体情势仍在变化";
  return `${clause}。`;
}

function firstCompleteSentence(value: string) {
  const compact = String(value || "").trim().replace(/\s+/g, " ");
  if (!compact) return asSentence("");
  const ending = compact.search(/[。！？]/);
  return ending >= 0 ? compact.slice(0, ending + 1) : asSentence(compact);
}

function reviewProseIntegrity(content: string) {
  const issues: string[] = [];
  if (/(?:……+|\.\.\.+)[”’"']?\s*$/.test(content.trim())) issues.push("TRUNCATED_STORY_FRAGMENT");
  if (/[。！？]{2,}/.test(content)) issues.push("DUPLICATE_SENTENCE_PUNCTUATION");
  if ((content.match(/“/g) || []).length !== (content.match(/”/g) || []).length) issues.push("UNBALANCED_CHINESE_QUOTES");
  if (/真正逼近的不是一句抽象|眼前的具体情势仍在变化/.test(content)) issues.push("GENERIC_OR_BROKEN_PROSE");
  if (containsRawEngineToken(content)) issues.push("INTERNAL_ENGINE_TOKEN_LEAKED");
  return issues;
}

function containsNarrativeAnchor(content: string, value: string) {
  const normalizedContent = normalize(content);
  const anchors = String(value || "").split(/[，。；、：:\s]/).map((item) => normalize(item)).filter((item) => item.length >= 5);
  return anchors.length === 0 || anchors.some((anchor) => normalizedContent.includes(anchor));
}

/**
 * Natural story prose must preserve the player's meaning without mechanically
 * repeating an internal command-card title. The independent model verifier
 * performs the full semantic audit; this deterministic companion gate looks
 * for concrete lexical traces of the same act. Canon-fact continuity keeps
 * using the stricter containsNarrativeAnchor check above.
 */
function containsNarratedMeaning(content: string, value: string) {
  if (containsNarrativeAnchor(content, value)) return true;
  const normalizedContent = normalize(content);
  const normalizedValue = normalize(value);
  if (!normalizedValue) return true;
  const ignored = new Set([
    "当前", "已经", "进行", "通过", "相关", "一个", "行动", "执行", "处理", "需要", "可以", "同时", "自己", "本次", "明确"
  ]);
  const pairs = new Set<string>();
  for (let index = 0; index < normalizedValue.length - 1; index += 1) {
    const pair = normalizedValue.slice(index, index + 2);
    if (!ignored.has(pair)) pairs.add(pair);
  }
  const matched = [...pairs].filter((pair) => normalizedContent.includes(pair));
  if (normalizedValue.length <= 12) return matched.length >= 1;
  return matched.length >= 2;
}

function normalize(value: string) {
  return value.toLowerCase().replace(/[\s，。；、：:,.!?！？]/g, "");
}

function containsRoleReference(content: string, roleName: string) {
  const compact = String(roleName || "").replace(/\s+/g, "");
  if (!compact) return false;
  const aliases = [compact, compact.slice(-3), compact.slice(-2)].filter((value) => value.length >= 2);
  return aliases.some((alias) => content.includes(alias));
}

function containsSceneReference(content: string, ...labels: string[]) {
  for (const label of labels) {
    const compact = String(label || "").replace(/[^\u3400-\u9fffA-Za-z0-9]/g, "");
    if (!compact) continue;
    if (content.includes(compact)) return true;
    const anchors = new Set<string>();
    for (let index = 0; index < compact.length - 1; index += 1) anchors.add(compact.slice(index, index + 2));
    if ([...anchors].some((anchor) => content.includes(anchor))) return true;
  }
  return false;
}

function concreteCost(card: MainCard, role: StoryRoleContext) {
  const risk = card.risk === "HIGH" ? "一旦证据不足，你要承担越权、失信或失去关键筹码的责任" : card.risk === "LOW" ? "代价是推进较慢，对手会获得补救和转移材料的时间" : "你要留下具名回执，并承担行动失败后的直接责任";
  const inputs = card.assetMutations.filter((mutation) => mutation.mutationType !== "CLAIM").map((mutation) => assetDisplayName(mutation.assetKey));
  const claims = card.assetMutations.filter((mutation) => mutation.mutationType === "CLAIM").map((mutation) => assetDisplayName(mutation.assetKey));
  const leverage = inputs.length ? `；投入${inputs.join("、")}后，${role.roleName}不能假装从未动用这些资源` : "";
  const gain = claims.length ? `；若行动落实，${role.roleName}将取得${claims.join("、")}，也要承担由此而来的责任` : "";
  return `${risk}${leverage}${gain}`;
}

function expectedCountermove(card: MainCard) {
  if (card.targetRoleKey) return `目标角色可能拖延、拒绝、要求交换条件，或用自己的证据反制；系统不得替其作出选择`;
  if (card.visibility === "PUBLIC") return "被公开点名的一方可能立即上奏、改换口径或争夺同一批证据";
  if (card.visibility === "OBSERVABLE") return "旁人会从公文和人员调动中察觉异常，并尝试追查行动来源";
  return "若行动暴露，相关角色会根据留下的痕迹调整下一步，而不是静止等待";
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}
