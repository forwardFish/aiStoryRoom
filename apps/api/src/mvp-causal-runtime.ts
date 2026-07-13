import { BadRequestException, ConflictException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { checkMvpAiBudget, createMvpAiBudget, exhaustMvpAiBudget, recordMvpAiBudgetUse } from "./mvp-ai-budget";
import type { MvpStoryStorage } from "./mvp-storage";
import type {
  MvpActiveDecision,
  MvpDecisionOption,
  MvpMutationInput,
  MvpNarrativeProvider,
  MvpStoryEvent,
  MvpView
} from "./mvp-types";

type Operator = ">=" | "<=" | ">" | "<" | "==";
type StatPredicate = { stat: string; op: Operator; value: number };
export type TriggerCondition = { minDay: number; all?: StatPredicate[]; any?: StatPredicate[] };
type DecisionInformation = {
  publicVisibility: "public" | "limited" | "private";
  knownByRoles: string[];
  observableFact: string;
};
export type FateSeedFamily = "secret_memorial" | "merchant" | "protect_county" | "evidence" | "governance";

interface StoryDecision {
  key: string;
  reactionRoleKey: string;
  title: string;
  sceneTitle: string;
  sceneBody: string;
  options: MvpDecisionOption[];
}

interface StoryDay {
  day: number;
  title: string;
  opening: string;
  pressure: string;
  decisions: [StoryDecision, StoryDecision];
}

const option = (
  key: string,
  title: string,
  body: string,
  gain: string,
  risk: string,
  patch: Record<string, number>,
  tags: string[] = [],
  reactionRoleKey?: string
): MvpDecisionOption => ({ key, title, body, gain, risk, patch, tags, ...(reactionRoleKey ? { reactionRoleKey } : {}) });

export const SANGTIAN_DAYS: StoryDay[] = [
  {
    day: 1,
    title: "改桑令下",
    opening: "改桑诏令到浙。巡抚请命立即推进三县名册，商会也递来愿垫粮银的帖子。第一步既决定进度，也决定谁先拿到局势的解释权。",
    pressure: "地方催政",
    decisions: [
      {
        key: "d1_1",
        reactionRoleKey: "xunfu",
        title: "准许巡抚推进",
        sceneTitle: "是否准许巡抚立即推进",
        sceneBody: "巡抚请命先办三县改桑名册。若立刻放权，朝廷会看到进度；若按下，民田与粮价暂时安全。",
        options: [
          option("A", "准许先行推进", "让巡抚负责第一批名册。", "改桑见速", "粮价与民心承压", { "改桑进度": 10, "内阁疑心": -5, "巡抚声望": 8, "粮价": 5, "民心": -4 }, ["progress", "empower_xunfu"]),
          option("B", "先核田亩", "要求三日后再报细册。", "保护民田", "被视为拖延", { "改桑进度": -5, "内阁疑心": 5, "巡抚敌意": 5, "县令信任": 5 }, ["delay", "protect_county"]),
          option("C", "明准暗查", "表面准许筹办，暗查名册来源。", "留下证据后手", "暗查暴露会激怒巡抚", { "改桑进度": 5, "暗账完整度": 8, "清算风险": -2 }, ["evidence", "covert"])
        ]
      },
      {
        key: "d1_2",
        reactionRoleKey: "merchant",
        title: "回应商会",
        sceneTitle: "如何回应商会",
        sceneBody: "商会愿先垫粮银，却希望未来获得税赋与商路照顾。你必须决定是否让商会进入这盘局。",
        options: [
          option("A", "公开召商议粮", "公开要求商会为朝廷分忧。", "形成粮银预期", "县令怀疑官商靠近", { "商会依赖": 8, "国库银两": 5, "县令信任": -3, "官商交易风险": 4 }, ["merchant", "public"]),
          option("B", "私下见商，只听不许", "听取条件但不留书面承诺。", "了解商会底牌", "入府痕迹会成为后患", { "商会依赖": 5, "清算风险": 2, "暗账完整度": 3 }, ["merchant", "covert"]),
          option("C", "暂不相见", "先观察巡抚与商会的关系。", "避免立即绑定", "商会可能倒向巡抚", { "商会依赖": -5, "巡抚声望": 4, "清算风险": -2 }, ["distance_merchant"])
        ]
      }
    ]
  },
  {
    day: 2,
    title: "地方催政",
    opening: "三县开始催报田亩，清流县令却递来密信：粮价已有波动，巡抚与商会之间可能存在旧约。",
    pressure: "粮价上涨",
    decisions: [
      {
        key: "d2_1",
        reactionRoleKey: "county_magistrate",
        title: "处理县令密信",
        sceneTitle: "如何处理县令密信",
        sceneBody: "县令愿继续查田契，但担心自己会被巡抚和地方胥吏牺牲。",
        options: [
          option("A", "保护县令继续查账", "给县令保护，允许追查田契。", "加快获得实证", "巡抚敌意上升", { "县令信任": 10, "暗账完整度": 10, "巡抚敌意": 8 }, ["protect_county", "evidence"]),
          option("B", "停止私查，只报民情", "让县令避开官商暗账。", "暂缓公开冲突", "证据线中断", { "县令信任": -10, "暗账完整度": -5, "巡抚敌意": -3 }, ["suppress_evidence"]),
          option("C", "密查但证据先送总督府", "让县令继续查，证据流向由你掌握。", "控制证据", "县令可能保留副本", { "县令信任": 5, "暗账完整度": 8, "巡抚敌意": 3 }, ["protect_county", "evidence", "control_evidence"])
        ]
      },
      {
        key: "d2_2",
        reactionRoleKey: "xunfu",
        title: "是否公开压巡抚",
        sceneTitle: "是否公开压巡抚",
        sceneBody: "巡抚要求三县限期上报名册。公开压下会保护民田，也会让京师看到督抚不合。",
        options: [
          option("A", "公开要求放缓", "明令巡抚放缓三县名册。", "降低民心风险", "督抚公开对立", { "民心": 7, "粮价": -3, "内阁疑心": 8, "巡抚敌意": 10 }, ["delay", "confront_xunfu"]),
          option("B", "保留复核权", "不公开冲突，但所有名册须经总督府复核。", "保住节制权", "巡抚可能急奏", { "总督权威": 6, "巡抚敌意": 6, "内阁疑心": 3 }, ["control", "xunfu_memorial"]),
          option("C", "放任催办并留痕", "记录巡抚执行过程，等待未来定责。", "形成责任证据", "短期粮价继续升", { "暗账完整度": 6, "粮价": 6, "民心": -5, "巡抚声望": 8 }, ["evidence", "wait"])
        ]
      }
    ]
  },
  {
    day: 3,
    title: "粮价三日连涨",
    opening: "粮价上涨，巡抚的急奏已离开杭州，商会则以放粮为条件索要保护。你第一次必须同时争夺奏报口径和粮路。",
    pressure: "暗账浮出",
    decisions: [
      {
        key: "d3_1",
        reactionRoleKey: "xunfu",
        title: "巡抚急奏北上",
        sceneTitle: "如何处理巡抚急奏",
        sceneBody: "巡抚奏中只报改桑进度，不提粮价与民怨。若他先定义浙江，你将承担失控责任。",
        options: [
          option("A", "截留奏疏", "追回奏疏，责令不得越级。", "阻止抢功", "被反咬压制国策", { "总督权威": 5, "巡抚敌意": 12, "内阁疑心": 10, "皇帝信任": -2 }, ["confront_xunfu"]),
          option("B", "追加密奏", "不拦巡抚，另写密奏说明粮价与民心风险。", "保留解释权", "内阁怀疑越级自保", { "皇帝信任": 7, "皇帝疑心": 4, "内阁疑心": 6, "清算风险": -4, "司礼监警惕": 8 }, ["secret_memorial"], "sili_jian"),
          option("C", "放任巡抚", "等待巡抚与商会绑定更深。", "未来可合并清算", "巡抚短期声望大增", { "巡抚声望": 12, "总督权威": -8, "改桑进度": 5, "清算风险": 5 }, ["wait", "empower_xunfu"])
        ]
      },
      {
        key: "d3_2",
        reactionRoleKey: "merchant",
        title: "商会控粮",
        sceneTitle: "如何处理商会控粮",
        sceneBody: "商会愿放出平价粮，却要总督府承诺未来不把囤粮与田契旧账全算在商会头上。",
        options: [
          option("A", "威慑商会放粮", "以查仓相逼，要求立即放粮。", "粮价快速回落", "商会可能投靠司礼监", { "粮价": -10, "民心": 6, "商会清算风险": 10, "司礼监警惕": 5 }, ["merchant", "coerce_merchant"]),
          option("B", "保护换放粮", "暂不追旧账，换商会放出三成粮。", "稳住粮价", "官商交易痕迹加深", { "粮价": -8, "商会依赖": 10, "县令信任": -8, "官商交易风险": 8 }, ["merchant", "deal"]),
          option("C", "动用官仓平价", "调官仓粮稳定民心。", "不欠商会人情", "海防军心承压", { "粮价": -8, "民心": 10, "县令信任": 5, "海防军心": -8 }, ["public_grain"])
        ]
      }
    ]
  },
  {
    day: 4,
    title: "暗账浮出",
    opening: "县令送来两页田契副本：部分粮田尚未改桑，已被商会标作可收桑地；一个名字又隐约指向巡抚府。",
    pressure: "互相弹劾",
    decisions: [
      {
        key: "d4_1",
        reactionRoleKey: "county_magistrate",
        title: "使用暗账",
        sceneTitle: "如何使用暗账",
        sceneBody: "暗账足以威慑，却不足以定案。现在亮刀能压人，继续补证则可能错过时机。",
        options: [
          option("A", "暗账密奏皇帝", "把暗账作为执行过激证据入密奏。", "皇帝看到预警", "内阁与司礼监疑心", { "皇帝信任": 8, "巡抚敌意": 10, "内阁疑心": 8, "司礼监警惕": 8 }, ["secret_memorial", "evidence"], "sili_jian"),
          option("B", "逼商会放粮出银", "以暗账威慑商会配合。", "粮银同时见效", "县令怀疑控制清弊", { "商会依赖": 12, "粮价": -6, "国库银两": 5, "县令信任": -8, "官商交易风险": 10 }, ["merchant", "evidence", "deal"], "merchant"),
          option("C", "交县令继续补证", "暂不动用，补完整证据链。", "暗账更完整", "巡抚可能察觉", { "暗账完整度": 15, "县令信任": 8, "巡抚敌意": 4 }, ["protect_county", "evidence"])
        ]
      },
      {
        key: "d4_2",
        reactionRoleKey: "xunfu",
        title: "是否制止灭证",
        sceneTitle: "是否制止巡抚灭证",
        sceneBody: "巡抚突然撤换名册书吏，疑似已经察觉暗账调查。",
        options: [
          option("A", "传巡抚问话", "公开施压，阻止继续更换书吏。", "降低灭证风险", "巡抚公开反扑", { "总督权威": 6, "巡抚敌意": 15, "内阁疑心": 5, "暗账完整度": 5 }, ["confront_xunfu", "evidence"]),
          option("B", "暗中保护书吏", "先扣下并保护可能的人证。", "获得人证机会", "暴露后被指私设审问", { "暗账完整度": 12, "清算风险": 4, "巡抚敌意": 6 }, ["evidence", "covert"]),
          option("C", "放任并记录灭证", "让巡抚继续动作，记录完整过程。", "未来责任更重", "现有证据可能丢失", { "暗账完整度": -5, "县令信任": -5, "巡抚敌意": -2, "清算风险": 6 }, ["wait", "evidence_risk"])
        ]
      }
    ]
  },
  {
    day: 5,
    title: "互相弹劾",
    opening: "内阁已收到巡抚急奏，并追问浙江迟迟不见银究竟由谁负责。司礼监织造使也抵达杭州，开始探查银路。",
    pressure: "京师回批",
    decisions: [
      {
        key: "d5_1",
        reactionRoleKey: "cabinet",
        title: "回应内阁",
        sceneTitle: "如何回应内阁催问",
        sceneBody: "内阁问的不是进度，而是谁来承担财政危局的责任。",
        options: [
          option("A", "指明巡抚操切", "把粮价与民心风险归因于地方推进过急。", "切割巡抚", "被认为督办无力", { "清算风险": -8, "巡抚敌意": 12, "内阁疑心": 4 }, ["blame_xunfu", "narrative"]),
          option("B", "请求分阶段推进", "承认不足，以稳局争取时间。", "降低民心风险", "内阁疑心上升", { "民心": 6, "粮价": -3, "皇帝信任": 4, "内阁疑心": 10 }, ["delay", "narrative"]),
          option("C", "报告商会可垫银", "用商会银子缓解朝廷压力。", "国库先见银", "商会坐大", { "国库银两": 10, "内阁疑心": -5, "商会依赖": 10, "县令信任": -8 }, ["merchant", "fiscal"])
        ]
      },
      {
        key: "d5_2",
        reactionRoleKey: "sili_jian",
        title: "对待司礼监",
        sceneTitle: "如何对待司礼监",
        sceneBody: "织造使只问丝源何时稳、银路何时通。他代表的不是援手，而是皇帝对不同奏报的疑心。",
        options: [
          option("A", "交出部分真实风险", "说明浙江可改但不可躁进。", "皇帝了解真实局势", "内廷掌握你的判断", { "皇帝信任": 6, "内阁疑心": 5, "司礼监警惕": 3 }, ["truth", "sili"]),
          option("B", "引导查巡抚与商会", "把探查焦点转向官商暗线。", "对手风险上升", "司礼监可能控制银路", { "巡抚敌意": 8, "商会清算风险": 8, "司礼监警惕": 10, "暗账完整度": 5 }, ["evidence", "sili"]),
          option("C", "保持距离", "只给官方进度，不谈暗账。", "避免内廷过深介入", "皇帝疑心上升", { "司礼监警惕": 8, "皇帝疑心": 5, "清算风险": 3 }, ["distance_sili"])
        ]
      }
    ]
  },
  {
    day: 6,
    title: "京师回批",
    opening: "皇帝回批只问三件事：银从何来，乱由谁止，谁在欺瞒。你必须在最后一天确定奏报叙事和最终盟友。",
    pressure: "御前裁决",
    decisions: [
      {
        key: "d6_1",
        reactionRoleKey: "emperor",
        title: "最终奏报",
        sceneTitle: "最终奏报方向",
        sceneBody: "最后一份奏报将决定京师看到的是稳局、清弊、财政，还是各方共同担责。",
        options: [
          option("A", "稳局奏报", "请求缓行，强调粮价和民心已受控制。", "争取稳局评价", "银路仍不够清楚", { "皇帝信任": 6, "民心": 5, "清算风险": -5, "改桑进度": -3, "升迁机会": 8 }, ["final_stability", "narrative"]),
          option("B", "清弊奏报", "公开巡抚与商会暗账。", "争取清弊定性", "证据不足会反噬", { "皇帝信任": 8, "暗账完整度": 8, "巡抚敌意": 10, "商会清算风险": 12, "升迁机会": 10 }, ["final_evidence", "evidence", "narrative"]),
          option("C", "财政奏报", "让商会垫银，优先补朝廷缺口。", "国库立即见银", "商会与内廷坐大", { "国库银两": 15, "商会依赖": 12, "司礼监警惕": 10, "官商交易风险": 8, "升迁机会": 6 }, ["final_fiscal", "merchant", "narrative"]),
          option("D", "自保奏报", "分散说明各方责任，避免独担主责。", "提高保命概率", "失去大胜机会", { "清算风险": -12, "皇帝疑心": 6, "总督权威": -5, "升迁机会": -8 }, ["final_self", "narrative"])
        ]
      },
      {
        key: "d6_2",
        reactionRoleKey: "emperor",
        title: "最后见谁",
        sceneTitle: "最后见谁",
        sceneBody: "巡抚、县令与商会同时求见。你只能把最后的政治信用押在一个方向上，或谁都不见。",
        options: [
          option("A", "见巡抚", "争取督抚同署奏报。", "减少公开内斗", "巡抚可能借你自保", { "巡抚敌意": -10, "内阁疑心": -4, "清算风险": 4 }, ["ally_xunfu"], "xunfu"),
          option("B", "见县令", "补全暗账，走清弊路线。", "加强证据与民心", "证据公开可能失控", { "县令信任": 10, "暗账完整度": 12, "民心": 5, "清算风险": 4 }, ["protect_county", "evidence"], "county_magistrate"),
          option("C", "见商会", "拿银稳局，明确财政路线。", "获得最后银粮", "商会索要保护", { "国库银两": 10, "商会依赖": 12, "官商交易风险": 10 }, ["merchant", "deal"], "merchant"),
          option("D", "谁都不见", "由幕僚独立拟奏。", "避免新增绑定", "失去最后筹码", { "清算风险": -3, "总督权威": -3 }, ["isolation"])
        ]
      }
    ]
  }
];

export const ROLE_DECISION_MODELS: Record<string, Record<string, any>> = {
  xunfu: roleModel("xunfu", "浙江巡抚", "推进改桑，尽快见银", "抢先报功，借新政入京", ["暗账浮出", "商会反咬", "总督抢先定性"], ["成为新政功臣", "把责任留给总督府"], ["高估内阁对速度的偏好", "低估县令留副本的可能"], ["越级报功", "受压后反咬总督", "证据风险高时切割商会"], "只公开对自己有利的信息", { hostilityToGovernor: 70, evidenceRisk: 60 }),
  county_magistrate: roleModel("county_magistrate", "清流县令", "护民并依法执行", "查清夺田暗账且不被牺牲", ["证据被压", "民情失控", "总督与商会交易"], ["保存完整证据", "让真实责任入京"], ["容易把总督控证理解为压案"], ["先留副本", "信任下降时寻找京师渠道"], "只向可信对象递交部分事实", { trustTowardGovernor: 45, evidenceCompleteness: 40 }),
  merchant: roleModel("merchant", "江南商会会首", "出银稳商路", "以垫银换保护且避免成为替罪羊", ["旧账被清算", "官府用后切割", "粮仓被查"], ["获得政策保护", "保住账册和银路"], ["高估银粮对官府的约束力"], ["以放粮换承诺", "风险高时投向司礼监"], "公开称为国分忧，私下保存交易痕迹", { liquidationRisk: 60, dependency: 70 }),
  sili_jian: roleModel("sili_jian", "司礼监织造使", "确保丝源与银路入内廷", "绕开内阁建立直达内廷的财路", ["地方坐大", "奏报口径不一", "内阁垄断财政叙事"], ["控制江南银路", "向皇帝提供独家判断"], ["把地方谨慎视为争夺解释权"], ["利用督抚冲突", "扶持可控商会"], "少公开表态，只向御前密报", { emperorSuspicion: 65, merchantDependency: 50 }),
  cabinet: roleModel("cabinet", "内阁财政派", "尽快补足国库", "证明财政危机不是内阁无能", ["新政不见银", "皇帝追责", "司礼监夺财政权"], ["找到银源", "找到可承担责任的人"], ["容易偏信可量化的进度"], ["支持先报功者", "压力下把责任推给地方"], "用正式文书制造责任边界", { treasury: 55, suspicion: 70 }),
  emperor: roleModel("emperor", "皇帝 / 最终裁决系统", "见银、止乱、查欺瞒", "维持不同权力集团彼此制衡", ["国库无银", "地方失控", "臣下形成一致口径欺瞒"], ["得到可执行的局面", "保留最终解释权"], ["会把奏报不一同时视为信息与欺瞒"], ["第七天统一裁决", "奖可用者但保留疑心"], "只通过御批显露部分判断", { trust: 55, suspicion: 75 })
};

function roleModel(roleKey: string, publicIdentity: string, publicGoal: string, realGoal: string, fear: string[], desire: string[], misjudgementBias: string[], decisionBias: string[], informationStyle: string, triggerThresholds: Record<string, number>) {
  return { roleKey, publicIdentity, publicGoal, realGoal, fear, desire, misjudgementBias, decisionBias, informationStyle, defaultActions: decisionBias.slice(0, 3), triggerThresholds };
}

export class MvpStoryEngine {
  private readonly storage: MvpStoryStorage;
  private readonly narrativeProvider?: MvpNarrativeProvider;

  constructor(storage: MvpStoryStorage, narrativeProvider?: MvpNarrativeProvider) {
    this.storage = storage;
    this.narrativeProvider = narrativeProvider;
  }

  async create(input: Record<string, unknown> = {}) {
    const storyId = String(input.storyId || input.templateKey || "sangtian");
    if (storyId !== "sangtian") throw new BadRequestException("v4 MVP currently supports storyId=sangtian only");
    const selectedRoleKey = String(input.selectedRoleKey || input.roleKey || "zhejiang_governor");
    if (selectedRoleKey !== "zhejiang_governor") throw new BadRequestException("v4 MVP currently supports selectedRoleKey=zhejiang_governor only");
    const view = createInitialView({ mode: String(input.mode || "single"), selectedRoleKey });
    await this.storage.create(view);
    return projectPublicMvpView(view);
  }

  async get(runId: string) {
    return projectPublicMvpView(ensureMvpCausalView(await this.storage.load(runId)));
  }

  async submitDecision(runId: string, messageId: string, input: MvpMutationInput) {
    const stored = await this.storage.load(runId);
    const requestedOptionKey = String(input.optionKey || "").toUpperCase();
    const previous = stored.events.find((item) => item.type === "decision_submitted" && item.payload?.messageId === messageId && item.payload?.optionKey === requestedOptionKey);
    if (previous) return projectPublicMvpView(stored);
    assertVersion(stored, input.version);
    if (stored.run.status !== "awaiting_decision" || !stored.activeDecision || stored.activeDecision.messageId !== messageId) {
      throw new ConflictException("message is not awaiting decision");
    }
    const optionKey = String(input.optionKey || "").toUpperCase();
    const customText = String(input.customText || "").trim();
    const guardResult = guardDecision(stored, stored.activeDecision, optionKey, customText);
    if (guardResult.accepted === false) return guardResult;

    const selected = optionKey === "CUSTOM"
      ? customOption(customText)
      : stored.activeDecision.options.find((item) => item.key === optionKey);
    if (!selected) throw new BadRequestException("unknown decision option");

    const expectedVersion = stored.run.version;
    const view = structuredClone(stored);
    if (stored.activeDecision.promptKind === "critical_response") {
      applyCriticalResponse(view, selected);
    } else {
      await applyDecision(view, selected, this.narrativeProvider, { ...guardResult, idempotencyKey: String(input.idempotencyKey || "") }, async (task) => this.storage.recordAiTask?.(task));
    }
    bumpVersion(view, expectedVersion);
    await this.storage.save(view, expectedVersion);
    return projectPublicMvpView(view);
  }

  async startCriticalResponse(runId: string, eventId: string, input: MvpMutationInput) {
    const stored = await this.storage.load(runId);
    assertVersion(stored, input.version);
    const current = stored.criticalEvent || (stored.pendingCriticalEvents || []).find((item: any) => String(item.eventId) === eventId);
    if (!current || String(current.eventId) !== eventId || !["pending", "deferred"].includes(String(current.status))) {
      throw new ConflictException({ code: "CRITICAL_EVENT_UNAVAILABLE", message: "关键事件已处理或不存在" });
    }
    const expectedVersion = stored.run.version;
    const view = structuredClone(stored);
    const critical = structuredClone(current);
    critical.status = "responding";
    view.criticalEvent = critical;
    view.activeDecision = buildCriticalResponseDecision(view, critical);
    view.messages.push(message(view, "role_action", "关键事件回应", `${critical.summary} 现在请决定你要如何回应。`, "他人影响", { speaker: critical.sourceRole }));
    view.events.push(event("critical_event_immediate", { eventId, day: view.run.currentDay, sourceRole: critical.sourceRole }));
    bumpVersion(view, expectedVersion);
    await this.storage.save(view, expectedVersion);
    return projectPublicMvpView(view);
  }

  async deferCriticalEvent(runId: string, eventId: string, input: MvpMutationInput) {
    const stored = await this.storage.load(runId);
    const previous = stored.events.find((item) => item.type === "critical_event_deferred" && item.payload?.eventId === eventId);
    if (previous) return projectPublicMvpView(stored);
    assertVersion(stored, input.version);
    const current = stored.criticalEvent;
    if (!current || String(current.eventId) !== eventId || String(current.status) !== "pending") {
      throw new ConflictException({ code: "CRITICAL_EVENT_UNAVAILABLE", message: "关键事件已处理或不存在" });
    }
    const expectedVersion = stored.run.version;
    const view = structuredClone(stored);
    const deferred = structuredClone(current);
    deferred.status = "deferred";
    view.criticalEvent = null;
    view.pendingCriticalEvents = (view.pendingCriticalEvents || []).map((item: any) => item.eventId === eventId ? deferred : item);
    view.messages.push(message(view, "system_hint", "关键事件已暂缓", "这件事没有消失。你可以在局势记录中重新打开待处理事件。", "事件队列"));
    view.events.push(event("critical_event_deferred", { eventId, day: view.run.currentDay, status: "deferred" }));
    bumpVersion(view, expectedVersion);
    await this.storage.save(view, expectedVersion);
    return projectPublicMvpView(view);
  }

  async submitManeuver(runId: string, input: MvpMutationInput) {
    const stored = await this.storage.load(runId);
    const idempotencyKey = String(input.idempotencyKey || "").trim();
    if (idempotencyKey) {
      const previous = stored.events.find((item) => item.type === "maneuver_submitted" && item.payload?.idempotencyKey === idempotencyKey);
      if (previous) return projectPublicMvpView(stored);
    }
    assertVersion(stored, input.version);
    if (stored.run.currentDay < 1 || stored.run.currentDay > 6 || !["awaiting_decision", "awaiting_day_advance"].includes(stored.run.status)) {
      throw new ConflictException({ code: "INVALID_RUN_STATE", message: "当前阶段不能执行主动谋划" });
    }
    if (stored.maneuverState.maneuverOpportunitiesRemaining <= 0) {
      throw new ConflictException({ code: "MANEUVER_LIMIT_REACHED", message: "今日谋划机会已用尽" });
    }
    const maneuverType = String(input.maneuverType || "");
    if (!["contact", "investigate", "leverage", "custom"].includes(maneuverType)) {
      throw new BadRequestException({ code: "MANEUVER_TYPE_INVALID", message: "不支持的谋划类型" });
    }
    const customText = String(input.customText || "").trim();
    if (maneuverType === "custom" && !customText) {
      throw new BadRequestException({ code: "MANEUVER_CUSTOM_TEXT_REQUIRED", message: "自拟谋划需要填写内容" });
    }
    const blocked = guardManeuver(maneuverType, customText);
    if (blocked) return blocked;

    const expectedVersion = stored.run.version;
    const view = structuredClone(stored);
    const targetRoleKey = String(input.targetRoleKey || "").trim();
    const intentKey = String(input.intentKey || "").trim();
    const leverageKey = String(input.leverageKey || "").trim();
    if (maneuverType === "leverage") {
      const available = Array.isArray(view.player.leverage) ? view.player.leverage.map(String) : [];
      const knownKeys = new Set(["land_contract_fragment", "county_letter", "coastal_report", ...available]);
      if (!leverageKey || !knownKeys.has(leverageKey) || view.maneuverState.usedLeverageKeys.includes(leverageKey)) {
        throw new ConflictException({ code: "LEVERAGE_NOT_AVAILABLE", message: "筹码不存在、已使用或当前不可用" });
      }
    }
    const result = buildManeuverResult(view, { maneuverType, targetRoleKey, intentKey, leverageKey, customText });
    const maneuverSeed = buildManeuverFateSeed(result.originEventId, view.run.currentDay, maneuverType, targetRoleKey);
    patchDashboard(view, result.patch as unknown as Record<string, number>);
    view.dashboard.latestChanges = result.changes;
    view.dashboard.traces = Array.from(new Set([...(view.dashboard.traces || []), ...result.traces]));
    view.causalLedger.fateSeeds.push(maneuverSeed);
    view.dashboard.activeFateSeeds = view.causalLedger.fateSeeds.filter((seed: any) => seed.status === "dormant").map((seed: any) => ({ id: seed.id, title: seed.title, visibleHint: seed.visibleHint }));
    view.messages.push(message(view, "maneuver_result", result.title, result.narrative, "主动谋划", { maneuverType, originEventId: result.originEventId }));
    view.events.push(event("maneuver", { day: view.run.currentDay, maneuverType, targetRoleKey, intentKey, leverageKey, originEventId: result.originEventId }));
    view.events.push(event("maneuver_submitted", { idempotencyKey, maneuverType, targetRoleKey, intentKey, leverageKey, originEventId: result.originEventId }));
    view.events.push(event("maneuver_result", { originEventId: result.originEventId, patch: result.patch, changes: result.changes }));
    view.events.push(event("state_patch", { originEventId: result.originEventId, patch: result.patch }));
    view.events.push(event("pursuit_updated", { originEventId: result.originEventId, changes: result.changes, traces: result.traces }));
    view.events.push(event("fate_seed_created", { originEventId: result.originEventId, fateSeedId: maneuverSeed.id, day: view.run.currentDay }));
    if (maneuverType === "leverage") {
      view.maneuverState.usedLeverageKeys.push(leverageKey);
      view.events.push(event("leverage_used", { originEventId: result.originEventId, leverageKey, targetRoleKey }));
    }
    view.maneuverState.maneuversUsedToday += 1;
    view.maneuverState.maneuverOpportunitiesRemaining -= 1;
    view.maneuverState.totalManeuversUsed += 1;
    if (maneuverType === "investigate" && !(view.pendingCriticalEvents || []).length) {
      enqueueCriticalEvent(view, result.originEventId);
    }
    bumpVersion(view, expectedVersion);
    await this.storage.save(view, expectedVersion);
    return projectPublicMvpView(view);
  }

  async advanceDay(runId: string, input: MvpMutationInput) {
    const stored = await this.storage.load(runId);
    assertVersion(stored, input.version);
    if (stored.run.currentDay >= 7) throw new ConflictException("already at finalization day");
    if (stored.run.decisionsCompletedToday !== 2 || stored.activeDecision || stored.run.status !== "awaiting_day_advance") {
      throw new ConflictException("all two decisions for the current day must be completed before advance");
    }
    const expectedVersion = stored.run.version;
    const view = structuredClone(stored);
    view.run.currentDay += 1;
    view.run.currentTime = view.run.currentDay === 3 ? "午后" : "清晨";
    view.run.decisionsCompletedToday = 0;
    view.run.decisionsRequiredToday = view.run.currentDay === 7 ? 0 : 2;
    view.maneuverState.maneuversUsedToday = 0;
    view.maneuverState.maneuverOpportunitiesRemaining = view.run.currentDay === 7 ? 0 : view.maneuverState.maneuverOpportunitiesPerDay;
    view.daySummary = null;
    if (view.run.currentDay === 7) {
      view.run.status = "awaiting_finalization";
      view.activeDecision = null;
      view.messages.push(message(view, "system", "御前裁决", "各路奏报已经抵达御前。内阁要银，司礼监要银路，地方各自争夺责任解释。皇帝等待浙江总督给出最后答案。", "京师"));
    } else {
      openDay(view, view.run.currentDay);
      if (view.run.currentDay === 3) view.run.currentTime = "午后";
    }
    triggerConditionalSeeds(view);
    view.events.push(event("day_advanced", { day: view.run.currentDay }));
    bumpVersion(view, expectedVersion);
    await this.storage.save(view, expectedVersion);
    return projectPublicMvpView(view);
  }

  async finalize(runId: string, input: MvpMutationInput) {
    const stored = await this.storage.load(runId);
    assertVersion(stored, input.version);
    if (stored.run.currentDay !== 7 || stored.run.status !== "awaiting_finalization" || stored.run.totalDecisionsCompleted !== 12) {
      throw new ConflictException("finalization is only allowed on day 7 after all 12 decisions");
    }
    const expectedVersion = stored.run.version;
    const view = structuredClone(stored);
    const judgement = buildFinalJudgement(view);
    view.finalJudgement = judgement;
    view.outcome = { globalEnding: judgement.globalEnding, personalEnding: judgement.personalEnding };
    view.causalLedger.finalJudgementInputs = judgement.causalExplanation;
    view.messages.push(message(view, "final", `全局结局：${judgement.globalEnding.title}`, `${judgement.globalEnding.summary}\n\n你的最终下场：${judgement.personalEnding.grade} · ${judgement.personalEnding.title}\n皇帝评语：${judgement.personalEnding.emperorComment}\n未来余波：${judgement.personalEnding.futureAftermath}`, "御前"));
    view.run.status = "finished";
    view.run.currentTime = "御前";
    view.events.push(event("finalized", { globalEnding: judgement.globalEnding.key, personalGrade: judgement.personalEnding.grade }));
    bumpVersion(view, expectedVersion);
    await this.storage.save(view, expectedVersion);
    return projectPublicMvpView(view);
  }
}

/** Public projection is the only shape controllers should return to a browser. */
export function projectPublicMvpView(view: MvpView) {
  const result: any = structuredClone(view);
  const ledger = view.causalLedger;
  result.meta = {
    eventCount: view.events.length,
    schemaVersion: view.runtime.schemaVersion
  };
  result.ledgerSummary = {
    fateSeedCount: ledger.fateSeeds.length,
    dormantFateSeedCount: ledger.fateSeeds.filter((item: any) => item.status === "dormant").length,
    activatedHelpCount: ledger.fateSeeds.filter((item: any) => item.status === "activated_help").length,
    activatedBackfireCount: ledger.fateSeeds.filter((item: any) => item.status === "activated_backfire").length,
    evidenceCount: ledger.evidenceLedger.length,
    responsibilityEntryCount: ledger.responsibilityLedger.length,
    narrativeFrameCount: ledger.narrativeFrames.length,
    visibleActiveSeeds: ledger.fateSeeds
      .filter((item: any) => item.status === "dormant")
      .map((item: any) => ({ id: item.id, originDay: item.originDay, title: item.title, visibleHint: item.visibleHint, status: item.status }))
  };
  delete result.events;
  delete result.causalLedger;
  delete result.dashboard.roleDecisionModels;
  // v1.2 public names. Keep the legacy fields for the migration, while the
  // web client consumes title-only prompts and narrative entries.
  result.narrativeEntries = result.messages.map((entry: any) => ({
    eventId: String(entry.id),
    entryType: entry.type,
    day: entry.day,
    time: entry.time,
    label: entry.label,
    title: entry.title,
    body: entry.body,
    speaker: entry.speaker,
    visibility: entry.visibility
  }));
  result.activePrompt = result.activeDecision
    ? {
        eventId: String(result.activeDecision.messageId),
        promptKind: result.activeDecision.promptKind || "main_decision",
        prompt: result.activeDecision.title,
        options: result.activeDecision.options.map((option: any) => ({ optionKey: option.key, title: option.title })),
        maxLength: 200,
        submitLabel: "提交决策"
      }
    : null;
  result.criticalEvent = result.criticalEvent || null;
  if (result.criticalEvent) {
    const critical = result.criticalEvent;
    result.criticalEvent = {
      eventId: String(critical.eventId),
      title: critical.title,
      summary: critical.summary,
      sourceRole: critical.sourceRole,
      severity: critical.severity,
      status: critical.status
    };
  }
  result.pendingCriticalEvents = (result.pendingCriticalEvents || []).map((item: any) => ({
    eventId: String(item.eventId),
    title: item.title,
    summary: item.summary,
    sourceRole: item.sourceRole,
    severity: item.severity,
    status: item.status
  }));
  result.maneuverPanel = result.maneuverState;
  result.situationRecord = { label: "局势记录", open: false, entries: result.narrativeEntries };
  result.situationRecordOpen = false;
  result.changeSummary = result.messages.find((entry: any) => entry.type === "causal_visible") || null;
  result.decisionHistory = result.decisionHistory.map((item: any) => {
    const { knownByRoles: _knownByRoles, informationVisibility: _informationVisibility, ...publicItem } = item;
    if (publicItem.optionKey === "CUSTOM") publicItem.body = "自定义决策（内容已通过身份、资源、时代与阶段校验）";
    return publicItem;
  });
  return result;
}

export function ensureMvpCausalView(payload: any, _phase?: string) {
  if (!payload?.run) return payload;
  payload.messages ||= [];
  payload.events ||= [];
  payload.decisionHistory ||= [];
  payload.daySummaries ||= payload.causalLedger?.daySummaries || {};
  payload.daySummary ||= null;
  payload.criticalEvent ||= null;
  payload.pendingCriticalEvents ||= [];
  payload.finalJudgement ||= null;
  payload.outcome ||= null;
  payload.dashboard ||= {};
  payload.dashboard.visibleCausalCard ||= null;
  payload.dashboard.causalRecallMessages ||= [];
  payload.dashboard.traces ||= [];
  payload.maneuverState ||= {
    maneuverOpportunitiesPerDay: 2,
    maneuversUsedToday: 0,
    maneuverOpportunitiesRemaining: payload.run.currentDay <= 6 ? 2 : 0,
    totalManeuversUsed: 0,
    usedLeverageKeys: []
  };
  payload.maneuverState.usedLeverageKeys ||= [];
  return payload;
}

function createInitialView(options: { mode: string; selectedRoleKey: string }): MvpView {
  const now = new Date().toISOString();
  const runId = `mvp_${Date.now().toString(36)}_${randomUUID().slice(0, 8)}`;
  const view: MvpView = {
    run: {
      id: runId,
      storyId: "sangtian",
      templateKey: "sangtian",
      mode: options.mode,
      selectedRoleKey: options.selectedRoleKey,
      title: "桑田诏：嘉靖财政危局",
      location: "杭州总督府",
      currentDay: 1,
      currentTime: "清晨",
      totalDays: 7,
      status: "awaiting_decision",
      version: 1,
      decisionsCompletedToday: 0,
      decisionsRequiredToday: 2,
      totalDecisionsCompleted: 0,
      totalDecisionsRequired: 12,
      createdAt: now,
      updatedAt: now
    },
    player: {
      roleName: "浙江总督",
      name: "郝帅彬",
      rank: "从四品",
      office: "兵部侍郎衔",
      fateQuestion: "保浙江，还是保自己？",
      goals: ["稳定浙江局势", "控制巡抚势力", "避免皇帝生疑"],
      resources: [["银两", "42万两"], ["粮草", "23万石"], ["兵丁", "4/5"], ["幕僚", "4人"], ["密报", "2条"]],
      leverage: ["田契暗账（半页）", "清流县令密信", "巡抚与商会旧约"]
    },
    messages: [],
    activeDecision: null,
    criticalEvent: null,
    pendingCriticalEvents: [],
    dashboard: {
      worldState: [["国库银两", 42, "gold"], ["民心", 55, "green"], ["粮价", 45, "gold"], ["改桑进度", 20, "gold"], ["皇帝信任", 45, "gold"], ["皇帝疑心", 55, "gold"], ["暗账完整度", 10, "gold"], ["海防军心", 60, "green"]],
      relationships: [
        { name: "浙江巡抚", person: "巡抚", stance: "戒备", score: 30, tone: "warn", avatar: "巡" },
        { name: "清流县令", person: "县令", stance: "试探", score: 50, tone: "warn", avatar: "县" },
        { name: "江南商会", person: "会首", stance: "观望", score: 35, tone: "warn", avatar: "商" },
        { name: "司礼监", person: "织造使", stance: "未入局", score: 30, tone: "warn", avatar: "监" },
        { name: "内阁财政派", person: "阁臣", stance: "催银", score: 35, tone: "warn", avatar: "阁" }
      ],
      latestChanges: [],
      risks: [["粮价失控", "中"], ["巡抚抢功", "中"], ["商会坐大", "中"], ["皇帝疑心", "中"]],
      roleState: { "总督权威": 60, "清算风险": 45, "升迁机会": 35, "内阁疑心": 35, "巡抚敌意": 30, "县令信任": 50, "商会依赖": 35, "司礼监警惕": 30, "商会清算风险": 35, "官商交易风险": 20, "巡抚声望": 30 },
      visibleCausalCard: null,
      causalRecallMessages: [],
      traces: [],
      roleDecisionModels: ROLE_DECISION_MODELS
    },
    decisionHistory: [],
    events: [],
    causalLedger: { fateSeeds: [], evidenceLedger: [], responsibilityLedger: [], narrativeFrames: [], roleDecisionModels: ROLE_DECISION_MODELS, roleDecisionTraces: [], causalRecallMessages: [], daySummaries: {}, finalJudgementInputs: {} },
    daySummary: null,
    daySummaries: {},
    finalJudgement: null,
    outcome: null,
    runtime: { schemaVersion: "mvp-causal-v4.1", narrativeProvider: "deterministic-rules", fallbackUsed: true, aiBudget: createMvpAiBudget() }
    ,maneuverState: {
      maneuverOpportunitiesPerDay: 2,
      maneuversUsedToday: 0,
      maneuverOpportunitiesRemaining: 2,
      totalManeuversUsed: 0,
      usedLeverageKeys: []
    }
  };
  view.events.push(event("run_created", { storyId: "sangtian" }));
  openDay(view, 1);
  return view;
}

function openDay(view: MvpView, dayNumber: number) {
  const day = getDay(dayNumber);
  view.run.status = "awaiting_decision";
  view.run.currentTime = "清晨";
  view.messages.push(message(view, "system", `第 ${day.day} 天 · ${day.title}`, day.opening, "清晨"));
  if (dayNumber === 3) {
    view.messages.push(message(view, "private_intel", "县令密信送达", "巡抚与商会往来愈密，近日顾有密谈。其中国所闻其旧约，但证据不足，尚难定罪。", "午前"));
    view.messages.push(message(view, "role_action", "商会提出平粮条件", "商会表愿出平粮条件，平抑粮价，但希望在商路减免与税赋照顾上获得优待。", "午时", { speaker: "江南商会会首" }));
    view.messages.push(message(view, "role_action", "巡抚急奏北上", "巡抚已将改桑进度先行报入京师，奏中未提粮价与民怨。你必须先决定是否补上自己的解释。", "午后", { speaker: "浙江巡抚" }));
    view.messages.push(message(view, "system_hint", "若不及时应对，内阁可能只听到巡抚一面之词。", "奏报、粮价与暗账继续互相牵连。", "申时"));
  }
  setActiveDecision(view, day.decisions[0], 0);
}

function setActiveDecision(view: MvpView, decision: StoryDecision, index: number) {
  const prompt = message(view, "decision", decision.sceneTitle, decision.sceneBody, index === 0 ? "午前" : "午后", { requiresDecision: true, decisionKey: decision.key });
  view.messages.push(prompt);
  view.activeDecision = { messageId: String(prompt.id), decisionKey: decision.key, day: view.run.currentDay, index, title: decision.title, help: "选择 A/B/C（部分决策含 D），也可以提交 CUSTOM 自定义决策。", reactionRoleKey: decision.reactionRoleKey, options: structuredClone(decision.options), promptKind: "main_decision" };
}

function buildCriticalResponseDecision(view: MvpView, critical: Record<string, any>): MvpActiveDecision {
  const responseOptions = [
    option("A", "公开回应并稳住局面", "给出可被各方观察的回应。", "降低误解", "暴露你的判断边界", { "皇帝信任": 3, "民心": 2 }, ["critical_response"]),
    option("B", "保留证据，先行核查", "不立即承诺，先把关键证据链留在手中。", "保留后手", "局势可能继续升温", { "暗账完整度": 4, "清算风险": -2 }, ["critical_response"])
  ];
  const prompt = message(view, "decision", critical.title, critical.summary, "关键回应", { requiresDecision: true, decisionKey: critical.eventId });
  view.messages.push(prompt);
  return {
    messageId: String(critical.eventId),
    decisionKey: String(critical.eventId),
    day: view.run.currentDay,
    index: view.run.decisionsCompletedToday,
    title: critical.title,
    help: "关键回应会占用当前主线决策槽位。",
    reactionRoleKey: String(critical.sourceRole || "xunfu"),
    options: [...responseOptions, option("C", "制造另一条假线索", "将矛盾引向另一条可核验的线索。", "争取缓冲时间", "新的证词可能反噬", { "清算风险": -1, "皇帝信任": -1 }, ["critical_response"])],
    promptKind: "critical_response"
  };
}

function enqueueCriticalEvent(view: MvpView, originEventId: string) {
  const critical = {
    eventId: id("critical"),
    title: "巡抚对你的怀疑正在加深",
    summary: "一封密报已经被送入巡抚府，\n其中提到了你曾私下扣留商会账本。",
    sourceRole: "xunfu",
    severity: "high",
    status: "pending",
    originEventId
  };
  view.pendingCriticalEvents = [...(view.pendingCriticalEvents || []), critical];
  view.criticalEvent = critical;
  view.messages.push(message(view, "system_hint", critical.title, critical.summary, "关键事件"));
  view.events.push(event("critical_event_created", { eventId: critical.eventId, day: view.run.currentDay, originEventId, sourceRole: critical.sourceRole }));
}

function applyCriticalResponse(view: MvpView, selected: MvpDecisionOption) {
  const active = view.activeDecision!;
  const critical = view.criticalEvent!;
  const originEventId = id("evt_critical_response");
  patchDashboard(view, selected.patch);
  view.dashboard.latestChanges = Object.entries(selected.patch).map(([key, value]) => [key, value]);
  view.messages.push(message(view, "decision_result", selected.title, `你对「${critical.title}」作出回应。${selected.body} 这项回应已经进入局势记录，并会改变各方接下来看到的风险。`, "关键回应", { visibleEcho: { personal: selected.gain, world: selected.risk } }));
  view.messages.push(message(view, "causal_visible", "关键事件留下了因果痕迹", `回应「${selected.title}」已写入责任与证据链。`, "因果落账", { causalCard: { decisionTitle: selected.title, decisionSummary: critical.summary, playerFacingHint: selected.gain, tracesLeft: ["巡抚急奏", "粮道核查记录"] } }));
  view.decisionHistory.push({ id: id("decision"), day: view.run.currentDay, decisionKey: active.decisionKey, decisionTitle: active.title, optionKey: selected.key, title: selected.title, body: "关键事件回应已落账。", patch: selected.patch, tags: selected.tags || [], originEventId });
  view.events.push(event("critical_response_submitted", { eventId: critical.eventId, originEventId, day: view.run.currentDay, optionKey: selected.key }));
  view.events.push(event("state_patch", { originEventId, patch: selected.patch }));
  view.pendingCriticalEvents = (view.pendingCriticalEvents || []).map((item: any) => item.eventId === critical.eventId ? { ...item, status: "resolved" } : item);
  view.criticalEvent = null;
  view.activeDecision = null;
  view.run.totalDecisionsCompleted += 1;
  view.run.decisionsCompletedToday += 1;
  if (view.run.decisionsCompletedToday >= 2) closeDay(view);
  else {
    const day = getDay(view.run.currentDay);
    setActiveDecision(view, day.decisions[view.run.decisionsCompletedToday], view.run.decisionsCompletedToday);
  }
}

async function applyDecision(
  view: MvpView,
  selected: MvpDecisionOption,
  provider?: MvpNarrativeProvider,
  guardResult?: Record<string, any>,
  recordAiTask?: (task: { runId: string; eventId: string; taskType: string; status: string; provider: string; inputJson: Record<string, unknown>; resultJson: Record<string, unknown>; errorMessage?: string }) => Promise<void> | undefined
) {
  const active = view.activeDecision!;
  const originEventId = id("evt_decision");
  const fallback = buildRuleDecisionOutput(view, active, selected, originEventId, guardResult);
  let output = fallback;
  let fallbackReason = provider ? "provider_failed_or_invalid" : "provider_not_configured";
  let providerError = "";
  const aiContext = { run: view.run, activeDecision: active, selectedOption: selected, dashboard: view.dashboard };
  const budget = view.runtime.aiBudget || (view.runtime.aiBudget = createMvpAiBudget());
  const budgetCheck = checkMvpAiBudget(budget, provider?.lastCall?.maxAttempts || 1);
  let tokenUsage = { attempts: 0, inputTokens: 0, outputTokens: 0, costMinor: 0 };
  if (provider && budgetCheck.allowed) {
    try {
      const candidate = await provider.generateDecisionCandidate({ ...aiContext, causalLedger: view.causalLedger });
      tokenUsage = recordMvpAiBudgetUse(budget, budgetCheck, provider.lastCall);
      validateNarrativeCandidate(candidate, fallback.roleReactions.map((item: any) => item.roleKey));
      output = normalizeDecisionOutput(candidate, fallback);
      validateDecisionOutput(output);
      view.runtime.narrativeProvider = provider.name;
      view.runtime.fallbackUsed = false;
      fallbackReason = "";
    } catch (error) {
      if (tokenUsage.attempts === 0) tokenUsage = recordMvpAiBudgetUse(budget, budgetCheck, provider.lastCall);
      providerError = error instanceof Error ? error.message.slice(0, 500) : "provider_failed";
      output = fallback;
      view.runtime.narrativeProvider = "deterministic-rules";
      view.runtime.fallbackUsed = true;
    }
  } else if (provider && budgetCheck.reason) {
    fallbackReason = budgetCheck.reason;
    exhaustMvpAiBudget(budget, fallbackReason);
    view.runtime.narrativeProvider = "deterministic-rules";
    view.runtime.fallbackUsed = true;
  }
  const providerCall = provider?.lastCall || { attempts: provider ? 1 : 0, elapsedMs: 0, maxAttempts: provider ? 2 : 0 };
  await recordAiTask?.({
    runId: view.run.id,
    eventId: originEventId,
    taskType: "resolve_decision_narrative",
    status: fallbackReason ? "fallback" : "completed",
    provider: provider?.name || "deterministic-rules",
    inputJson: aiContext,
    resultJson: {
      fallbackUsed: Boolean(fallbackReason),
      fallbackReason,
      narrativeProvider: view.runtime.narrativeProvider,
      attempts: providerCall.attempts,
      elapsedMs: providerCall.elapsedMs,
      maxAttempts: providerCall.maxAttempts,
      tokenUsage,
      budget: structuredClone(budget)
    },
    errorMessage: providerError || undefined
  });
  validateDecisionOutput(output);
  patchDashboard(view, output.immediateResult.statePatch);
  view.dashboard.latestChanges = Object.entries(output.immediateResult.statePatch).map(([key, value]) => [key, value]);
  view.dashboard.visibleCausalCard = output.visibleCausalCard;
  view.dashboard.traces = Array.from(new Set([...(view.dashboard.traces || []), ...output.visibleCausalCard.tracesLeft]));
  view.causalLedger.fateSeeds.push(...output.fateSeeds.created);
  view.causalLedger.evidenceLedger.push(...output.evidenceLedgerUpdates);
  view.causalLedger.responsibilityLedger.push(...output.responsibilityLedgerUpdates);
  view.causalLedger.narrativeFrames.push(...output.narrativeFrames);
  view.causalLedger.roleDecisionTraces.push(...output.roleReactions);

  view.messages.push(message(view, "decision_result", output.immediateResult.resultMessage.title, output.immediateResult.resultMessage.narrative, "决策后", { visibleEcho: output.immediateResult.resultMessage.visibleEcho }));
  view.messages.push(message(view, "causal_visible", `你的选择留下了痕迹：${output.visibleCausalCard.decisionTitle}`, output.visibleCausalCard.playerFacingHint, "因果落账", { causalCard: output.visibleCausalCard }));
  for (const reaction of output.roleReactions) {
    view.messages.push(message(view, "role_action", reaction.messageToPlayer.title, reaction.messageToPlayer.narrative, "他人回响", { speaker: ROLE_DECISION_MODELS[reaction.roleKey]?.publicIdentity || reaction.roleKey }));
  }
  view.decisionHistory.push({
    id: id("decision"),
    day: view.run.currentDay,
    decisionKey: active.decisionKey,
    decisionTitle: active.title,
    optionKey: selected.key,
    title: selected.title,
    body: selected.body,
    patch: output.immediateResult.statePatch,
    tags: selected.tags || [],
    knownByRoles: output.decisionInterpretation.knownByRoles,
    informationVisibility: output.decisionInterpretation.publicVisibility,
    originEventId
  });
  view.events.push(event("decision_submitted", { originEventId, day: view.run.currentDay, messageId: active.messageId, idempotencyKey: String((guardResult as any)?.idempotencyKey || ""), decisionKey: active.decisionKey, optionKey: selected.key, normalizedDecision: output.decisionInterpretation }));
  if (selected.key === "CUSTOM") view.events.push(event("action_guard_accepted", { originEventId, decisionKey: active.decisionKey, checks: output.guard.checks }));
  view.events.push(event("causal_bundle_applied", { originEventId, fateSeedIds: output.fateSeeds.created.map((item: any) => item.id), roleKeys: output.roleReactions.map((item: any) => item.roleKey) }));
  if (fallbackReason) view.events.push(event("ai_fallback", { originEventId, reason: fallbackReason }));

  view.run.totalDecisionsCompleted += 1;
  view.run.decisionsCompletedToday += 1;
  view.activeDecision = null;
  triggerConditionalSeeds(view);

  if (view.run.decisionsCompletedToday === 1) {
    view.run.currentTime = "午后";
    const day = getDay(view.run.currentDay);
    setActiveDecision(view, day.decisions[1], 1);
  } else {
    closeDay(view);
  }
}

function buildRuleDecisionOutput(view: MvpView, active: MvpActiveDecision, selected: MvpDecisionOption, originEventId: string, guardResult?: Record<string, any>) {
  const tags = selected.tags || [];
  const visibleAction = selected.key === "CUSTOM" ? "自定义决策（内容已按规则校验）" : selected.body;
  const targetRole = selected.reactionRoleKey || active.reactionRoleKey;
  const information = decisionInformation(active, selected, targetRole);
  const stateChangesText = Object.entries(selected.patch).map(([key, value]) => `${key} ${value >= 0 ? "+" : ""}${value}`);
  const traces = tags.includes("secret_memorial") ? ["御前密奏底稿", "驿站递送记录", "两份奏报口径"]
    : tags.includes("merchant") ? ["商会入府记录", "粮银往来传话", "仓价变化账册"]
      : tags.includes("evidence") ? ["田契副本", "县衙递信记录", "总督府阅账批注"]
        : ["总督府文移", "幕僚决策记录"];
  const personal = tags.includes("secret_memorial") ? "你保留了御前解释权，同时承担越级自保的嫌疑。"
    : tags.includes("merchant") ? "你获得粮银筹码，也让商会拥有证明双方接触的痕迹。"
      : tags.includes("evidence") ? "你增加了未来定责的证据，也让被调查者更警觉。"
        : "你改变了自己承担责任和争夺解释权的方式。";
  const roleReaction = buildRoleReaction(view, targetRole, active, selected, originEventId, information);
  const card = {
    decisionTitle: selected.title,
    decisionSummary: `你在「${active.title}」中选择了「${selected.title}」。`,
    personalEcho: personal,
    othersEcho: [{ roleKey: targetRole, text: roleReaction.messageToPlayer.narrative }],
    worldEcho: "这一步已进入奏报、粮价、证据和责任相互牵连的因果账本。",
    stateChangesText,
    tracesLeft: traces,
    potentialRisks: [selected.risk, tags.includes("merchant") ? "这次接触可能在商会受查时被重新定性。" : "对手可能争夺这一步的叙事解释。"],
    playerFacingHint: `${selected.gain}；但${selected.risk}。这项选择将在满足真实局势条件时帮助或反噬你。`,
    originEventId
  };
  const evidence = traces.map((title, index) => ({ id: `${originEventId}_e${index + 1}`, title, truthLevel: "true", completeness: tags.includes("evidence") ? 65 : 50, holderRoles: tags.includes("merchant") ? ["merchant", "zhejiang_governor"] : ["zhejiang_governor"], knownByRoles: tags.includes("secret_memorial") ? ["zhejiang_governor", "emperor", "sili_jian"] : ["zhejiang_governor"], suspectedByRoles: [targetRole], canBackfireOn: ["zhejiang_governor"], originEventId }));
  const seed = buildFateSeed(view, selected, originEventId);
  const responsibility = { id: `${originEventId}_responsibility`, issue: active.title, possibleResponsibleRoles: [{ roleKey: "zhejiang_governor", liability: 45, reason: "总督做出本次最终决策。" }, { roleKey: targetRole, liability: tags.includes("confront_xunfu") ? 65 : 40, reason: "该角色的行动与反应推动了当前压力。" }], currentDominantFrame: "责任仍在争夺", originEventId };
  const narrativeFrame = { eventId: originEventId, eventTitle: selected.title, frames: [{ roleKey: "zhejiang_governor", frame: selected.gain, visibility: "private" }, { roleKey: targetRole, frame: selected.risk, visibility: "private" }, { roleKey: "emperor", frame: "能否见银、止乱并说明责任", visibility: "hidden" }], dominantFrame: "尚未形成统一定性" };
  return {
    guard: guardResult || { accepted: true, allowed: true, severity: "ok", reason: "", normalizedDecision: selected.body, rewriteSuggestion: null, checks: [] },
    decisionInterpretation: { actionType: tags[0] || "governance", surfaceAction: visibleAction, strategicIntent: selected.gain, usedResources: inferResources(tags), targetRoles: [targetRole], publicVisibility: information.publicVisibility, knownByRoles: information.knownByRoles, evidenceCreated: traces, riskTags: [selected.risk], benefitTags: [selected.gain], originEventId, originDecisionId: active.decisionKey },
    immediateResult: { resultMessage: { title: selected.title, narrative: `总督府开始执行「${selected.title}」。${visibleAction} 局势数值由系统规则落账，后续叙事只能解释这些变化。`, visibleEcho: { personal, others: roleReaction.messageToPlayer.narrative, world: "相关角色会依其已知信息与利益作出反应。" } }, statePatch: selected.patch, relationshipPatch: [], visibleHints: [selected.gain, selected.risk] },
    visibleCausalCard: card,
    fateSeeds: { created: [seed], updated: [], triggered: [] },
    evidenceLedgerUpdates: evidence,
    responsibilityLedgerUpdates: [responsibility],
    narrativeFrames: [narrativeFrame],
    roleReactions: [roleReaction],
    causalRecallMessages: [],
    newStoryEvents: [],
    dashboardPatch: { latestChanges: stateChangesText, visibleCausalCard: card, causalRecallMessages: [], risks: [], clues: [], traces, relationshipChanges: [] }
  };
}

export function normalizeDecisionOutput(candidate: unknown, fallback: any) {
  if (!candidate || typeof candidate !== "object") return fallback;
  const source: any = candidate;
  const normalized = structuredClone(fallback);
  // AI may only polish player-facing narrative fields. Rules remain authoritative
  // for state patches, ledgers, triggers, responsibility and final outcomes.
  const candidateResult = source.immediateResult?.resultMessage;
  if (typeof candidateResult?.title === "string" && candidateResult.title.trim()) normalized.immediateResult.resultMessage.title = candidateResult.title.slice(0, 100);
  if (typeof candidateResult?.narrative === "string" && candidateResult.narrative.trim()) normalized.immediateResult.resultMessage.narrative = candidateResult.narrative.slice(0, 1200);
  const candidateCard = source.visibleCausalCard;
  for (const key of ["decisionSummary", "personalEcho", "worldEcho", "playerFacingHint"]) {
    if (typeof candidateCard?.[key] === "string" && candidateCard[key].trim()) normalized.visibleCausalCard[key] = candidateCard[key].slice(0, 500);
  }
  if (Array.isArray(source.roleReactions)) {
    source.roleReactions.forEach((candidateReaction: any, index: number) => {
      const target = normalized.roleReactions[index];
      if (!target || candidateReaction?.roleKey !== target.roleKey) return;
      // A narration model cannot promote a suspicion into exact role knowledge.
      // Observable-only reactions always keep the deterministic, sanitized copy.
      if (target.knowledgeMode === "observable_only") return;
      if (typeof candidateReaction.messageToPlayer?.title === "string") target.messageToPlayer.title = candidateReaction.messageToPlayer.title.slice(0, 100);
      if (typeof candidateReaction.messageToPlayer?.narrative === "string") target.messageToPlayer.narrative = candidateReaction.messageToPlayer.narrative.slice(0, 800);
    });
  }
  return normalized;
}

export function validateNarrativeCandidate(candidate: unknown, expectedRoleKeys: string[]) {
  const source: any = candidate;
  const failures: string[] = [];
  if (typeof source?.immediateResult?.resultMessage?.title !== "string") failures.push("result title");
  if (typeof source?.immediateResult?.resultMessage?.narrative !== "string") failures.push("result narrative");
  for (const key of ["decisionSummary", "personalEcho", "worldEcho", "playerFacingHint"]) {
    if (typeof source?.visibleCausalCard?.[key] !== "string") failures.push(`visibleCausalCard.${key}`);
  }
  if (!Array.isArray(source?.roleReactions)) failures.push("roleReactions");
  for (const roleKey of expectedRoleKeys) {
    const reaction = source?.roleReactions?.find((item: any) => item?.roleKey === roleKey);
    if (typeof reaction?.messageToPlayer?.title !== "string" || typeof reaction?.messageToPlayer?.narrative !== "string") failures.push(`roleReactions.${roleKey}.messageToPlayer`);
  }
  if (failures.length) throw new Error(`invalid narrative candidate: ${failures.join(", ")}`);
  return true;
}

export function validateDecisionOutput(output: any) {
  const failures: string[] = [];
  if (!output?.visibleCausalCard?.decisionTitle || !output.visibleCausalCard.playerFacingHint) failures.push("visibleCausalCard is required");
  const changes = new Set(output?.visibleCausalCard?.stateChangesText || []);
  for (const [key, value] of Object.entries(output?.immediateResult?.statePatch || {})) {
    const token = `${key} ${Number(value) >= 0 ? "+" : ""}${value}`;
    if (!changes.has(token)) failures.push(`state patch ${key} has no visible explanation`);
  }
  for (const seed of output?.fateSeeds?.created || []) if (!seed.originEventId) failures.push("fateSeed.originEventId is required");
  for (const item of output?.evidenceLedgerUpdates || []) if (!item.holderRoles?.length || !item.knownByRoles?.length) failures.push("evidence holderRoles/knownByRoles are required");
  for (const item of output?.responsibilityLedgerUpdates || []) if (!item.issue || !item.possibleResponsibleRoles?.length) failures.push("responsibility issue/roles are required");
  for (const frame of output?.narrativeFrames || []) if (!frame.eventId || !frame.frames?.length) failures.push("narrative frames are required");
  const requiredReactionFields = ["knownFacts", "unknownFacts", "currentFear", "currentDesire", "privateReasoningSummary", "chosenAction", "surfaceReason", "hiddenIntent", "messageToPlayer", "statePatch", "newFateSeeds", "sourceEventIds"];
  for (const reaction of output?.roleReactions || []) for (const field of requiredReactionFields) if (reaction[field] === undefined || reaction[field] === null) failures.push(`roleReaction.${field} is required`);
  for (const recall of output?.causalRecallMessages || []) if (!recall.originEventIds?.length) failures.push("causal recall originEventIds are required");
  if (failures.length) throw new Error(`invalid structured narrative output: ${failures.join("; ")}`);
  return true;
}

function buildRoleReaction(view: MvpView, roleKey: string, active: MvpActiveDecision, selected: MvpDecisionOption, originEventId: string, information: DecisionInformation) {
  const model = ROLE_DECISION_MODELS[roleKey];
  const roleKnowsCurrent = information.knownByRoles.includes(roleKey);
  const knownHistory = view.decisionHistory
    .filter((item: any) => item.knownByRoles?.includes(roleKey))
    .slice(-2)
    .map((item: any) => `此前已知总督选择了${item.title}`);
  const knownFacts = [
    roleKnowsCurrent
      ? `总督在「${active.title}」中选择了「${selected.title}」`
      : information.observableFact,
    ...knownHistory
  ];
  const unknownFacts = [
    ...(roleKnowsCurrent ? [] : [`总督在「${active.title}」中的具体做法`]),
    "总督是否还有未公开证据",
    "御前最终会接受哪一套责任叙事"
  ];
  const currentFear = model.fear.slice(0, 2);
  const currentDesire = model.desire.slice(0, 2);
  const chosenAction = model.defaultActions[0];
  return {
    roleKey,
    knowledgeMode: roleKnowsCurrent ? "exact" : "observable_only",
    knownFacts,
    unknownFacts,
    currentFear,
    currentDesire,
    privateReasoningSummary: roleKnowsCurrent
      ? `${model.publicIdentity}只依据已知事实判断：${selected.title}改变了自身利益与风险，因此选择「${chosenAction}」，但仍不知道总督掌握多少后手。`
      : `${model.publicIdentity}没有得知总督的具体做法，只能从可见局势变化推断风险，因此先选择「${chosenAction}」。`,
    chosenAction,
    surfaceReason: model.publicGoal,
    hiddenIntent: model.realGoal,
    messageToPlayer: {
      title: `${model.publicIdentity}重新判断局势`,
      narrative: roleKnowsCurrent
        ? `${model.publicIdentity}得知你选择「${selected.title}」后，开始${chosenAction}。这不是无条件反应，而是因为本次选择已经触及其目标或恐惧。`
        : `${model.publicIdentity}尚未得知你的具体做法，只注意到${information.observableFact}，因此开始${chosenAction}。`
    },
    statePatch: {},
    newFateSeeds: [],
    sourceEventIds: [originEventId]
  };
}

function buildFateSeed(view: MvpView, selected: MvpDecisionOption, originEventId: string) {
  return createFateSeedDefinition(selected, originEventId, view.run.currentDay);
}

export function createFateSeedDefinition(selected: MvpDecisionOption, originEventId: string, originDay: number) {
  const tags = selected.tags || [];
  const family = fateSeedFamily(tags);
  let title = `${selected.title}的后续定性`;
  let hiddenMeaning = "该行动在新的责任叙事中可能成为后手，也可能被对手重新定性。";
  let helpCondition: TriggerCondition = { minDay: originDay + 1, all: [{ stat: "皇帝信任", op: ">=", value: 55 }] };
  let backfireCondition: TriggerCondition = { minDay: originDay + 1, any: [{ stat: "清算风险", op: ">=", value: 60 }, { stat: "皇帝疑心", op: ">=", value: 63 }] };
  if (family === "secret_memorial") {
    title = "御前密奏口径";
    hiddenMeaning = "密奏既保留解释权，也可能被内阁定性为绕开正式程序自保。";
    helpCondition = { minDay: originDay + 1, all: [{ stat: "皇帝信任", op: ">=", value: 55 }, { stat: "皇帝疑心", op: "<=", value: 72 }] };
    backfireCondition = { minDay: originDay + 1, any: [{ stat: "内阁疑心", op: ">=", value: 55 }, { stat: "皇帝疑心", op: ">=", value: 75 }] };
  } else if (family === "merchant") {
    title = "商会入局痕迹";
    hiddenMeaning = "商会会把接触视为潜在保护，县令和司礼监也可能据此重估总督。";
    helpCondition = { minDay: originDay + 1, all: [{ stat: "粮价", op: "<=", value: 45 }, { stat: "商会依赖", op: ">=", value: 45 }] };
    backfireCondition = { minDay: originDay + 1, any: [{ stat: "商会清算风险", op: ">=", value: 60 }, { stat: "官商交易风险", op: ">=", value: 55 }, { stat: "县令信任", op: "<=", value: 45 }] };
  } else if (family === "protect_county") {
    title = "县令的信任与副本";
    hiddenMeaning = "县令若相信总督会护民，会继续递证；若信任下降，会保留副本另寻渠道。";
    helpCondition = { minDay: originDay + 1, all: [{ stat: "县令信任", op: ">=", value: 60 }, { stat: "暗账完整度", op: ">=", value: 40 }] };
    backfireCondition = { minDay: originDay + 1, all: [{ stat: "县令信任", op: "<=", value: 40 }] };
  } else if (family === "evidence") {
    title = "暗账证据链";
    hiddenMeaning = "证据越完整越能改变责任归属，但调查暴露会促使巡抚反扑。";
    helpCondition = { minDay: originDay + 1, all: [{ stat: "暗账完整度", op: ">=", value: 60 }] };
    backfireCondition = { minDay: originDay + 1, all: [{ stat: "巡抚敌意", op: ">=", value: 70 }, { stat: "暗账完整度", op: "<", value: 60 }] };
  }
  return {
    id: `seed_${originEventId}`,
    family,
    originEventId,
    originDay,
    title,
    visibleHint: `你选择了「${selected.title}」，它留下了可追溯的痕迹。`,
    hiddenMeaning,
    helpTriggers: [{ condition: helpCondition, effect: "该选择成为玩家预警、稳局或举证的因果依据。" }],
    backfireTriggers: [{ condition: backfireCondition, effect: "该选择被重新定性为拖延、自保或利益交易。" }],
    status: "dormant",
    relatedRoles: inferRelatedRoles(tags),
    triggeredAtDay: null
  };
}

export function fateSeedFamily(tags: string[] = []): FateSeedFamily {
  if (tags.includes("secret_memorial")) return "secret_memorial";
  if (tags.includes("merchant")) return "merchant";
  if (tags.includes("protect_county")) return "protect_county";
  if (tags.includes("evidence")) return "evidence";
  return "governance";
}

function triggerConditionalSeeds(view: MvpView) {
  const stats = endingStats(view);
  for (const seed of view.causalLedger.fateSeeds || []) {
    if (seed.status !== "dormant") continue;
    const activation = evaluateFateSeedActivation(seed, view.run.currentDay, stats);
    if (!activation) continue;
    const { kind, trigger } = activation;
    seed.status = kind === "help" ? "activated_help" : "activated_backfire";
    seed.triggeredAtDay = view.run.currentDay;
    const recall = {
      title: `因果回响：${seed.title}`,
      originEventIds: [seed.originEventId],
      recallText: `第 ${seed.originDay} 天留下的「${seed.title}」今天满足了真实局势条件。`,
      reframedBy: kind === "help" ? "总督府与御前记录" : ROLE_DECISION_MODELS[seed.relatedRoles?.[0]]?.publicIdentity || "对手",
      newFrame: seed.hiddenMeaning,
      currentPressure: trigger.effect,
      visibility: "player_visible",
      activation: kind,
      triggeredAtDay: view.run.currentDay
    };
    view.causalLedger.causalRecallMessages.push(recall);
    view.dashboard.causalRecallMessages = view.causalLedger.causalRecallMessages;
    view.messages.push(message(view, "causal_recall", recall.title, `${recall.recallText}${kind === "help" ? "这一步正在帮助你：" : "这一步正在反噬你："}${recall.currentPressure}`, "因果回响"));
    view.events.push(event("fate_seed_triggered", { fateSeedId: seed.id, originEventId: seed.originEventId, activation: kind, day: view.run.currentDay }));
  }
}

export function evaluateFateSeedActivation(seed: any, currentDay: number, stats: Record<string, number>) {
  const backfire = seed.backfireTriggers?.find((trigger: any) => fateConditionMatches(stats, currentDay, trigger.condition));
  if (backfire) return { kind: "backfire" as const, trigger: backfire };
  const help = seed.helpTriggers?.find((trigger: any) => fateConditionMatches(stats, currentDay, trigger.condition));
  if (help) return { kind: "help" as const, trigger: help };
  return null;
}

export function fateConditionMatches(stats: Record<string, number>, currentDay: number, condition: TriggerCondition) {
  if (currentDay < condition.minDay) return false;
  const test = (predicate: StatPredicate) => compare(Number(stats[predicate.stat]) || 0, predicate.op, predicate.value);
  if (condition.all?.length && !condition.all.every(test)) return false;
  if (condition.any?.length && !condition.any.some(test)) return false;
  return Boolean(condition.all?.length || condition.any?.length);
}

function closeDay(view: MvpView) {
  const day = getDay(view.run.currentDay);
  const today = view.decisionHistory.filter((item: any) => item.day === view.run.currentDay);
  const summary = {
    day: view.run.currentDay,
    title: `第 ${view.run.currentDay} 天 · 日终回响`,
    publicSummary: `今日你完成了「${today.map((item: any) => item.title).join("」与「")}」。这些选择已经改变局势，并在证据、责任和角色判断中留下痕迹。`,
    keyDecisions: today.map((item: any) => ({ decisionKey: item.decisionKey, title: item.title, originEventId: item.originEventId })),
    stateChanges: today.flatMap((item: any) => Object.entries(item.patch).map(([key, value]) => `${key} ${Number(value) >= 0 ? "+" : ""}${value}`)),
    activeFateSeeds: view.causalLedger.fateSeeds.filter((seed: any) => seed.status === "dormant").map((seed: any) => ({ id: seed.id, title: seed.title, visibleHint: seed.visibleHint })),
    triggeredEchoes: view.causalLedger.causalRecallMessages.filter((item: any) => item.triggeredAtDay === view.run.currentDay),
    tomorrowPressure: day.pressure
  };
  Object.assign(summary, {
    playerKeyDecisions: summary.keyDecisions,
    stateChangeSummary: summary.stateChanges,
    riskForTomorrow: summary.tomorrowPressure
  });
  view.daySummary = summary;
  view.daySummaries[String(view.run.currentDay)] = summary;
  view.causalLedger.daySummaries[String(view.run.currentDay)] = summary;
  view.messages.push(message(view, "day_end", summary.title, `${summary.publicSummary}\n明日压力：${summary.tomorrowPressure}。`, "日终"));
  view.events.push(event("day_summary_created", { day: view.run.currentDay, decisionKeys: today.map((item: any) => item.decisionKey) }));
  view.run.status = "awaiting_day_advance";
  view.run.currentTime = "日终";
}

const GLOBAL_ENDINGS: Record<string, Record<string, any>> = {
  scapegoat: {
    key: "scapegoat",
    title: "无人胜利，替罪羊诞生",
    summary: "浙江既未按期见银，也未能平复民生压力。各方争夺责任解释，朝廷最终必须选择一名主要责任人。"
  },
  reform_and_audit: {
    key: "reform_and_audit",
    title: "国策缓行，清弊得名",
    summary: "朝廷没有废止改桑，却暂缓急推并重核田亩。暗账改变了责任归属，百姓得到喘息，国库缺口仍待解决。"
  },
  merchant_control: {
    key: "merchant_control",
    title: "商人救国，商人控局",
    summary: "商会先垫银粮稳住浙江，内阁保住体面，司礼监掌握银路；局势没有崩，但未来财政被商人与内廷共同绑定。"
  },
  progress_without_people: {
    key: "progress_without_people",
    title: "桑田成，民心裂",
    summary: "改桑名册与银子如期入京，但民生压力只被暂时压下。这是财政进度的胜利，也是民心的亏损。"
  },
  stable_but_watched: {
    key: "stable_but_watched",
    title: "总督稳局，帝心生疑",
    summary: "浙江没有彻底失控，改桑也没有完全停下。皇帝承认总督能稳局，却因多套奏报和暗线往来保留疑心。"
  }
};

const PERSONAL_ENDINGS: Record<string, Record<string, any>> = {
  S: { rank: "S", grade: "大胜", title: "东南重臣", emperorComment: "此人可用，但不可纵。", archetype: "稳局型操盘者", narrative: "你稳住民生与财政，并让自己的责任叙事进入御前判断。", futureAftermath: "你进入更大的东南军政局，也受到内阁与内廷更严密的制衡。" },
  A: { rank: "A", grade: "小胜", title: "明升暗防", emperorComment: "能办事，仍须有人看着。", archetype: "带着命运债的胜者", narrative: "你赢下这一局，却也让更多权力开始注意你。", futureAftermath: "你保住官位并名义升迁，但司礼监与内阁都把你的因果账本留了副本。" },
  B: { rank: "B", grade: "平局", title: "保命失势", emperorComment: "无大功，亦非首罪。", archetype: "守住底线的地方官", narrative: "你没有成为首要责任人，也没有掌握最后的胜利叙事。", futureAftermath: "你被调离浙江，保住家族与名位，却失去主导新政的机会。" },
  C: { rank: "C", grade: "小败", title: "调离要职", emperorComment: "能守一时，未能解局。", archetype: "失去主动权的守成者", narrative: "你守住了部分底线，却没能让自己的方案成为朝廷最终采用的答案。", futureAftermath: "你离开浙江权力中心，仍保留再次起用的可能，但这局留下的疑点会继续跟随你。" },
  D: { rank: "D", grade: "大败", title: "问责失势", emperorComment: "持重失机，责无可避。", archetype: "失去解释权的主政者", narrative: "你没有成为唯一责任人，却也无法再主导浙江局势与责任定性。", futureAftermath: "你被解除总督职务，朝廷继续复核浙江财政、田契与奏报责任。" },
  E: { rank: "E", grade: "重败", title: "重责待审", emperorComment: "浙江失序，总督不能辞其责。", archetype: "被责任叙事锁定的人", narrative: "你没能稳住关键局势，也失去了对责任的解释权。", futureAftermath: "你离开主政位置，后续去向将由朝廷对证据与责任的复核决定。" }
};

export function classifyMvpEnding(stats: Record<string, number>) {
  const stat = (key: string) => Number(stats[key]) || 0;
  let globalKey = "stable_but_watched";
  if (stat("民心") <= 52 && stat("粮价") >= 43 && stat("国库银两") <= 52 && stat("皇帝信任") <= 52 && (stat("皇帝疑心") >= 63 || stat("内阁疑心") >= 65 || stat("清算风险") >= 55)) {
    globalKey = "scapegoat";
  } else if (stat("暗账完整度") >= 55 && stat("县令信任") >= 55 && stat("民心") >= 50 && stat("皇帝信任") >= 52) {
    globalKey = "reform_and_audit";
  } else if (stat("商会依赖") >= 65 && stat("国库银两") >= 55 && stat("司礼监警惕") >= 45) {
    globalKey = "merchant_control";
  } else if (stat("改桑进度") >= 28 && stat("国库银两") >= 52 && stat("民心") <= 58) {
    globalKey = "progress_without_people";
  }

  const score = stat("皇帝信任") + stat("民心") + stat("国库银两") + stat("总督权威") + stat("升迁机会") / 2 - stat("清算风险") - Math.max(0, stat("皇帝疑心") - 55);
  let personalRank = "E";
  if (globalKey === "scapegoat" && (stat("皇帝信任") <= 52 || stat("清算风险") >= 55 || stat("皇帝疑心") >= 63)) personalRank = "E";
  else if (score >= 235 && stat("皇帝信任") >= 65 && stat("清算风险") <= 45) personalRank = "S";
  else if (score >= 220) personalRank = "A";
  else if (score >= 205) personalRank = "B";
  else if (score >= 190) personalRank = "C";
  else if (score >= 175) personalRank = "D";

  return { globalKey, personalRank, score };
}

function endingStats(view: MvpView) {
  const stats: Record<string, number> = { ...view.dashboard.roleState };
  for (const [key, value] of view.dashboard.worldState || []) stats[String(key)] = Number(value) || 0;
  return stats;
}

function buildFinalJudgement(view: MvpView) {
  const stat = (key: string) => readStat(view, key);
  const classification = classifyMvpEnding(endingStats(view));
  const globalEnding = structuredClone(GLOBAL_ENDINGS[classification.globalKey]);
  const personalEnding = structuredClone(PERSONAL_ENDINGS[classification.personalRank]);
  const helps = view.causalLedger.fateSeeds.filter((seed: any) => seed.status === "activated_help");
  const hurts = view.causalLedger.fateSeeds.filter((seed: any) => seed.status === "activated_backfire");
  const positiveMoves = [...view.decisionHistory].sort((a: any, b: any) => patchScore(b.patch) - patchScore(a.patch)).slice(0, 3);
  const riskyMoves = [...view.decisionHistory].sort((a: any, b: any) => riskScore(b.patch) - riskScore(a.patch)).slice(0, 3);
  const savedMoves = fillCausalMoves(
    helps.map((item: any) => ({ originEventId: item.originEventId, text: item.visibleHint })),
    positiveMoves.map((item: any) => ({ originEventId: item.originEventId, text: `第 ${item.day} 天「${item.title}」改善了关键局势。` }))
  );
  const hurtMoves = fillCausalMoves(
    hurts.map((item: any) => ({ originEventId: item.originEventId, text: item.hiddenMeaning })),
    riskyMoves.map((item: any) => ({ originEventId: item.originEventId, text: `第 ${item.day} 天「${item.title}」增加了后续责任风险。` }))
  );
  const fateDebts = [stat("官商交易风险") >= 45 ? "你借用了商会的粮银，也留下了交易痕迹。" : "你没有完全被商会绑定，但银路问题仍未消失。", stat("县令信任") < 50 ? "你利用县令的证据，却没有完全赢得他的信任。" : "县令的信任帮助你保留了一条清弊证据链。"];
  return {
    globalEnding,
    personalEnding,
    emperorJudgement: personalEnding.emperorComment,
    futureAftermath: personalEnding.futureAftermath,
    fateDebt: fateDebts,
    responsibility: buildResponsibilityScores(view),
    dominantNarrative: globalEnding.summary,
    causalExplanation: {
      keyMovesThatSavedYou: savedMoves,
      keyMovesThatHurtYou: hurtMoves,
      fateDebt: fateDebts,
      fateDebts,
      futureAftermath: personalEnding.futureAftermath
    }
  };
}

function fillCausalMoves(primary: Array<{ originEventId: string; text: string }>, fallback: Array<{ originEventId: string; text: string }>) {
  const result: Array<{ originEventId: string; text: string }> = [];
  const seen = new Set<string>();
  for (const item of [...primary, ...fallback]) {
    if (!item?.originEventId || !item?.text || seen.has(item.originEventId)) continue;
    seen.add(item.originEventId);
    result.push(item);
    if (result.length === 3) break;
  }
  return result;
}

function buildResponsibilityScores(view: MvpView) {
  const stat = (key: string) => readStat(view, key);
  return {
    zhejiang_governor: { merit: clamp((stat("民心") + stat("皇帝信任") + stat("总督权威")) / 3), liability: clamp((stat("清算风险") + stat("官商交易风险")) / 2), keyReasons: ["最终统筹浙江局势", "决定证据和粮银的使用方式"] },
    xunfu: { merit: clamp((stat("改桑进度") + stat("巡抚声望")) / 2), liability: clamp((stat("巡抚敌意") + (100 - stat("民心"))) / 2), keyReasons: ["推动改桑进度", "争夺奏报解释权"] },
    merchant: { merit: clamp((stat("国库银两") + (100 - stat("粮价"))) / 2), liability: clamp((stat("商会清算风险") + stat("官商交易风险")) / 2), keyReasons: ["提供粮银渠道", "参与田契与保护交易"] }
  };
}

type ActionGuardCategory = "format" | "identity" | "era" | "resource" | "phase" | "agency";
type ActionGuardCheck = { category: ActionGuardCategory; allowed: boolean; status: "passed" | "blocked" | "not_evaluated"; reason: string; suggestedRewrite?: string };

function guardDecision(view: MvpView, active: MvpActiveDecision, optionKey: string, customText: string) {
  if (optionKey !== "CUSTOM") {
    return { accepted: true, allowed: true, rejected: false, status: "accepted", guardStatus: "ok", severity: "ok", reason: "", checks: [] };
  }
  const day = Number(view.run.currentDay);
  const context = {
    day,
    decisionKey: active.decisionKey,
    roleName: String(view.player.roleName || "浙江总督"),
    availableResources: Object.fromEntries((view.player.resources as any[] || []).map((item: any) => Array.isArray(item) ? [String(item[0]), String(item[1])] : [String(item?.name || item?.key), String(item?.value || "")]))
  };
  const categories: ActionGuardCategory[] = ["identity", "era", "resource", "phase", "agency"];
  if (!customText || customText.length > 200) {
    const reason = !customText ? "请先写明具体行动。" : "自定义决策过长，请压缩到 200 字以内。";
    const checks: ActionGuardCheck[] = [
      { category: "format", allowed: false, status: "blocked", reason, suggestedRewrite: "保留一个主要行动、一个对象和一个目的。" },
      ...categories.map((category) => ({ category, allowed: false, status: "not_evaluated" as const, reason: "格式通过后再判断此项。" }))
    ];
    return guardRejection("rewrite_needed", checks, context);
  }

  const availableSilver = availableResource(view, "银两");
  const availableGrain = availableResource(view, "粮草");
  const requestedSilver = largestRequestedAmount(customText, /([0-9]+(?:\.[0-9]+)?)\s*万两/g);
  const requestedGrain = largestRequestedAmount(customText, /([0-9]+(?:\.[0-9]+)?)\s*万石/g);
  const requestedSilverChinese = largestRequestedChineseAmount(customText, /([一二三四五六七八九十百千]+)万两/g);
  const requestedGrainChinese = largestRequestedChineseAmount(customText, /([一二三四五六七八九十百千]+)万石/g);
  const identityBlocked = /(罢免|任命|撤换).{0,5}(皇帝|内阁|巡抚|司礼监)|接管(?:内阁|司礼监)|号令天下/.test(customText);
  const eraBlocked = /(手机|互联网|无人机|人工智能|摄像头|卫星|电话|电报|无线电)/i.test(customText);
  const resourceBlocked = (requestedSilver !== null && requestedSilver > availableSilver)
    || (requestedGrain !== null && requestedGrain > availableGrain)
    || (requestedSilverChinese !== null && requestedSilverChinese > availableSilver)
    || (requestedGrainChinese !== null && requestedGrainChinese > availableGrain)
    || /([0-9]+(?:\.[0-9]+)?\s*万(?:兵|军)|[一二三四五六七八九十百千]+万(?:兵|军)|十万大军|百万大军|无限银|凭空变出|全国军队)/.test(customText)
    || (readStat(view, "暗账完整度") < 40 && /(完整暗账|现成暗账|已经掌握.{0,3}暗账)/.test(customText));
  const alwaysForbiddenPhase = /跳到第七天|跳过.*天|宣布结局|直接获胜|进入御前裁决|离开浙江.*(?:游历|远游)|长期游历/.test(customText);
  const finalReportAction = /(?:提交|递交|拟好|拟定|公布).{0,8}(?:最终奏报|御前奏报|终局奏报)/.test(customText);
  const phaseBlocked = active.day !== day || alwaysForbiddenPhase || (active.decisionKey !== "d6_1" && finalReportAction);
  const agencyBlocked = /(命令皇帝|让皇帝必须|控制皇帝|所有人立刻|强迫所有|(?:必须|无条件)(?:认错|认罪|服从)|替(?:巡抚|县令|商会|皇帝)决定|直接获胜|宣布成功|直接定罪)/.test(customText);

  const checks: ActionGuardCheck[] = [
    guardCheck("identity", identityBlocked, "该行动超出浙江总督对同级与朝廷机构的任免权限。", "改为上奏、质询、限制其当前权限或提交证据。"),
    guardCheck("era", eraBlocked, "该行动使用了不属于当前时代的工具。", "改用驿站、文书、账册、人证、官仓或奏报。"),
    guardCheck("resource", resourceBlocked, "该行动调用了当前未持有或数量不足的资源。", `把资源限制在现有 ${availableSilver} 万两银与 ${availableGrain} 万石粮草以内，未取得的证据先调查。`),
    guardCheck("phase", phaseBlocked, `当前是第 ${day} 天的「${active.title}」，不能提前执行后续阶段。`, "只处理当前待决压力，把终局选择留到第六、七天。"),
    guardCheck("agency", agencyBlocked, "行动只能表达你的尝试，不能替其他角色决定或预先宣布结果。", "改为施压、交易、调查、保护、上奏或留下后手。")
  ];
  if (checks.some((item) => item.status === "blocked")) return guardRejection("blocked", checks, context);
  return {
    accepted: true, allowed: true, rejected: false, status: "accepted", guardStatus: "ok", severity: "ok",
    reason: "ActionGuard ok：身份、时代、资源、阶段与角色自主权均在边界内。",
    message: "行动已通过上下文检查。", normalizedDecision: customText, rewriteSuggestion: null, suggestedRewrite: null, checks, context
  };
}

function guardCheck(category: Exclude<ActionGuardCategory, "format">, blocked: boolean, reason: string, suggestedRewrite: string): ActionGuardCheck {
  return blocked
    ? { category, allowed: false, status: "blocked", reason, suggestedRewrite }
    : { category, allowed: true, status: "passed", reason: `${category} check passed` };
}

function guardRejection(guardStatus: string, checks: ActionGuardCheck[], context: Record<string, unknown>) {
  const blocked = checks.filter((item) => item.status === "blocked");
  const reason = blocked.map((item) => item.reason).join("；");
  const suggestedRewrite = blocked[0]?.suggestedRewrite || "请调整行动后重试。";
  return { accepted: false, allowed: false, rejected: true, status: "rejected", guardStatus, severity: guardStatus, category: blocked[0]?.category, reason, message: reason, suggestedRewrite, rewriteSuggestion: suggestedRewrite, checks, context };
}

function availableResource(view: MvpView, label: string) {
  const entry = (view.player.resources as any[] || []).find((item: any) => Array.isArray(item) ? item[0] === label : item?.name === label || item?.key === label);
  const raw = Array.isArray(entry) ? entry[1] : entry?.value;
  const amount = Number.parseFloat(String(raw || "0"));
  return Number.isFinite(amount) ? amount : 0;
}

function largestRequestedAmount(text: string, pattern: RegExp) {
  const values = Array.from(text.matchAll(pattern), (match) => Number(match[1])).filter(Number.isFinite);
  return values.length ? Math.max(...values) : null;
}

function largestRequestedChineseAmount(text: string, pattern: RegExp) {
  const values = Array.from(text.matchAll(pattern), (match) => parseChineseInteger(match[1])).filter(Number.isFinite);
  return values.length ? Math.max(...values) : null;
}

function parseChineseInteger(value: string) {
  const digits: Record<string, number> = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
  const units: Record<string, number> = { 十: 10, 百: 100, 千: 1000 };
  let total = 0;
  let current = 0;
  for (const character of value) {
    if (digits[character]) current = digits[character];
    else if (units[character]) {
      total += (current || 1) * units[character];
      current = 0;
    }
  }
  return total + current;
}

function customOption(text: string): MvpDecisionOption {
  const patch: Record<string, number> = { "总督权威": 2, "清算风险": 2 };
  const tags = ["custom"];
  if (/暗中|秘密|密查|私下|不公开/.test(text)) tags.push("covert");
  if (/公开发布|公开下令|张榜公示/.test(text)) tags.push("public");
  if (/密奏|奏报/.test(text)) Object.assign(patch, { "皇帝信任": 5, "皇帝疑心": 3, "内阁疑心": 4 }), tags.push("secret_memorial");
  if (/商会|放粮|粮仓/.test(text)) Object.assign(patch, { "粮价": -5, "商会依赖": 7, "官商交易风险": 4 }), tags.push("merchant");
  if (/县令|田契|账册|证据/.test(text)) Object.assign(patch, { "暗账完整度": 7, "县令信任": 5 }), tags.push("evidence");
  if (/巡抚/.test(text)) Object.assign(patch, { "巡抚敌意": 6, "总督权威": 4 });
  if (/官仓|开仓/.test(text)) Object.assign(patch, { "粮价": -6, "民心": 6, "海防军心": -5 });
  return { key: "CUSTOM", title: "自定义决策", body: text, gain: "形成符合身份边界的非标准计策", risk: "效果由公开痕迹、资源与角色反应共同决定", patch, tags };
}

function patchDashboard(view: MvpView, patch: Record<string, number>) {
  for (const [rawKey, delta] of Object.entries(patch)) {
    const key = rawKey === "国库银" ? "国库银两" : rawKey;
    const world = view.dashboard.worldState.find((item: any[]) => item[0] === key);
    if (world) world[1] = clamp(Number(world[1]) + delta);
    if (Object.prototype.hasOwnProperty.call(view.dashboard.roleState, key)) view.dashboard.roleState[key] = clamp(Number(view.dashboard.roleState[key]) + delta);
  }
  const relationMap: Record<string, string> = { "巡抚敌意": "浙江巡抚", "县令信任": "清流县令", "商会依赖": "江南商会", "司礼监警惕": "司礼监", "内阁疑心": "内阁财政派" };
  for (const [key, name] of Object.entries(relationMap)) {
    if (patch[key] === undefined) continue;
    const rel = view.dashboard.relationships.find((item: any) => item.name === name);
    if (!rel) continue;
    rel.score = clamp(Number(rel.score) + patch[key]);
    rel.stance = rel.score >= 70 ? "高度介入" : rel.score <= 35 ? "疏离" : "观望";
    rel.tone = rel.score >= 70 ? "bad" : rel.score <= 35 ? "good" : "warn";
  }
  view.dashboard.risks = [
    ["粮价失控", readStat(view, "粮价") >= 70 ? "高" : readStat(view, "粮价") >= 55 ? "中" : "低"],
    ["巡抚反咬", readStat(view, "巡抚敌意") >= 70 ? "高" : readStat(view, "巡抚敌意") >= 50 ? "中" : "低"],
    ["官商交易", readStat(view, "官商交易风险") >= 60 ? "高" : readStat(view, "官商交易风险") >= 40 ? "中" : "低"],
    ["御前清算", readStat(view, "清算风险") >= 70 ? "高" : readStat(view, "清算风险") >= 50 ? "中" : "低"]
  ];
}

function readStat(view: MvpView, rawKey: string) {
  const key = rawKey === "国库银" ? "国库银两" : rawKey;
  const world = view.dashboard.worldState.find((item: any[]) => item[0] === key);
  if (world) return Number(world[1]) || 0;
  return Number(view.dashboard.roleState[key]) || 0;
}

function decisionInformation(active: MvpActiveDecision, selected: MvpDecisionOption, targetRole: string): DecisionInformation {
  const tags = selected.tags || [];
  const knownByRoles = new Set<string>();
  const publicToAll = tags.includes("public") || tags.includes("public_grain");

  if (publicToAll) {
    Object.keys(ROLE_DECISION_MODELS).forEach((roleKey) => knownByRoles.add(roleKey));
  } else {
    if (tags.includes("merchant") || tags.includes("deal") || tags.includes("coerce_merchant")) knownByRoles.add("merchant");
    if (tags.includes("protect_county") || tags.includes("control_evidence")) knownByRoles.add("county_magistrate");
    if (tags.includes("sili")) knownByRoles.add("sili_jian");
    if (tags.includes("secret_memorial")) {
      knownByRoles.add("emperor");
      knownByRoles.add("sili_jian");
    }
    if (tags.some((tag) => ["confront_xunfu", "empower_xunfu", "ally_xunfu", "blame_xunfu", "xunfu_memorial"].includes(tag))) {
      knownByRoles.add("xunfu");
    }
    if (tags.includes("narrative") || tags.includes("fiscal") || active.decisionKey === "d6_1") {
      knownByRoles.add("cabinet");
      knownByRoles.add("emperor");
    }
    // Non-covert actions are observable to the role directly affected by them.
    // Covert actions require an explicit communication/channel tag above.
    if (!tags.includes("covert")) knownByRoles.add(targetRole);
  }

  const observableFact = tags.includes("merchant")
    ? "粮路、银路与商会立场出现了可观察的变化"
    : tags.includes("secret_memorial")
      ? "奏报口径与内廷关注出现了可观察的变化"
      : tags.includes("evidence")
        ? "账册、证据流向与有关官员的警觉出现了变化"
        : "官署命令、民情与各方关系出现了可观察的变化";

  return {
    publicVisibility: publicToAll ? "public" : tags.includes("covert") || tags.includes("secret_memorial") ? "private" : "limited",
    knownByRoles: Array.from(knownByRoles),
    observableFact
  };
}

function inferResources(tags: string[]) {
  const resources = ["总督职权", "幕僚与文移"];
  if (tags.includes("secret_memorial")) resources.push("密奏渠道");
  if (tags.includes("merchant")) resources.push("商会粮银渠道");
  if (tags.includes("evidence")) resources.push("田契与证据链");
  return resources;
}

function inferRelatedRoles(tags: string[]) {
  if (tags.includes("merchant")) return ["merchant", "county_magistrate", "sili_jian"];
  if (tags.includes("secret_memorial")) return ["sili_jian", "cabinet", "emperor", "xunfu"];
  if (tags.includes("evidence")) return ["county_magistrate", "xunfu", "merchant"];
  return ["xunfu", "cabinet"];
}

function getDay(day: number) {
  const result = SANGTIAN_DAYS.find((item) => item.day === day);
  if (!result) throw new ConflictException("day has no decisions");
  return result;
}

function guardManeuver(maneuverType: string, customText: string) {
  const text = customText.trim();
  if (/一百万兵|跳到第\s*7\s*天|直接裁决|命令巡抚立即认罪/.test(text)) {
    return {
      accepted: false,
      code: "ACTION_BLOCKED",
      reason: "这项谋划超出当前身份、资源或阶段边界，不能直接改写主线责任。",
      rewriteSuggestion: "可改为：派幕僚暗查驿站登记，确认巡抚急奏的经手人员。"
    };
  }
  if (maneuverType === "custom" && text.length > 200) {
    return {
      accepted: false,
      code: "ACTION_BLOCKED",
      reason: "自拟谋划最多 200 字，请把意图收束成一项可执行的布局。",
      rewriteSuggestion: text.slice(0, 200)
    };
  }
  return null;
}

function buildManeuverResult(view: MvpView, input: { maneuverType: string; targetRoleKey: string; intentKey: string; leverageKey: string; customText: string }) {
  const originEventId = id("evt_maneuver");
  const targetNames: Record<string, string> = {
    county_magistrate: "清流县令",
    merchant: "江南商会会首",
    xunfu: "浙江巡抚",
    sili_jian: "司礼监织造使",
    cabinet: "内阁财政派"
  };
  const target = targetNames[input.targetRoleKey] || "相关人物";
  if (input.maneuverType === "contact") {
    return {
      originEventId,
      title: `你私下接触了${target}`,
      narrative: `${target}没有立即表态，只把一条可核验的线索留在你手中。你选择先听、先问，而不是把这次接触写成公开命令。关系与后续证据线已经改变。`,
      patch: input.targetRoleKey === "county_magistrate" ? { "县令信任": 8, "暗账完整度": 5 } : input.targetRoleKey === "merchant" ? { "商会依赖": 6, "官商交易风险": 3 } : { "总督权威": 3, "巡抚敌意": 2 },
      changes: [`${target}关系发生变化`, "新的私下线索进入账本"],
      traces: [`${target}接触记录`, "幕僚问询笔录"]
    };
  }
  if (input.maneuverType === "investigate") {
    return {
      originEventId,
      title: "幕僚开始调查驿站与粮路",
      narrative: "你没有直接替主线定罪，而是派幕僚核对驿站登记、粮价和经手文书。调查尚未完成，但第一条可以回溯的证据链已经建立。",
      patch: { "暗账完整度": 9, "清算风险": 2, "粮价": -2 },
      changes: ["暗账完整度 +9", "粮价压力暂缓", "调查任务 1/3"],
      traces: ["驿站登记核验", "粮路调查任务"]
    };
  }
  if (input.maneuverType === "leverage") {
    return {
      originEventId,
      title: "你动用了手中的筹码",
      narrative: `你以「${input.leverageKey || "半页田契暗账"}」为筹码试探${target}。对方暂时退了一步，但这份筹码的来源和使用痕迹也被写进了后续定责。`,
      patch: { "总督权威": 4, "清算风险": 4, "暗账完整度": 5 },
      changes: ["总督权威 +4", "暗账完整度 +5", "使用筹码留下痕迹"],
      traces: ["筹码使用记录", `${target}的回应口径`]
    };
  }
  return {
    originEventId,
    title: "自拟谋划已执行",
    narrative: `你拟定的布局「${input.customText}」被拆成可执行的幕僚任务。它没有替代当前主线决策，却让后续消息多了一条来自你主动布局的因果线。`,
    patch: { "总督权威": 2, "暗账完整度": 6, "清算风险": 2 },
    changes: ["主动布局已记入消息流", "暗账完整度 +6", "后续事件将引用此谋划"],
    traces: ["自拟谋划原文", "幕僚执行回执"]
  };
}

function buildManeuverFateSeed(originEventId: string, originDay: number, maneuverType: string, targetRoleKey: string) {
  return {
    id: `seed_${originEventId}`,
    family: maneuverType === "investigate" ? "evidence" : maneuverType === "leverage" ? "merchant" : "governance",
    originEventId,
    originDay,
    title: "主动谋划留下的后续回声",
    visibleHint: `这次${maneuverType}会在${targetRoleKey || "相关人物"}的后续反应中留下可追溯痕迹。`,
    hiddenMeaning: "主动布局既可能补足证据，也可能让对手看见你的意图。",
    helpTriggers: [{ condition: { minDay: originDay + 1, all: [{ stat: "暗账完整度", op: ">=", value: 55 }] }, effect: "主动调查成为后续定责依据" }],
    backfireTriggers: [{ condition: { minDay: originDay + 1, any: [{ stat: "清算风险", op: ">=", value: 65 }, { stat: "商会清算风险", op: ">=", value: 60 }] }, effect: "主动布局被重新解释为越权施压" }],
    status: "dormant",
    relatedRoles: targetRoleKey ? [targetRoleKey] : [],
    triggeredAtDay: null
  };
}

function assertVersion(view: MvpView, version: number) {
  if (!Number.isInteger(version)) {
    throw new ConflictException({
      code: "VERSION_REQUIRED",
      message: "body.version is required",
      currentVersion: view.run.version
    });
  }
  if (version !== view.run.version) {
    throw new ConflictException({
      code: "VERSION_CONFLICT",
      message: "story run version conflict",
      expectedVersion: version,
      currentVersion: view.run.version
    });
  }
}

function bumpVersion(view: MvpView, expectedVersion: number) {
  view.run.version = expectedVersion + 1;
  view.run.updatedAt = new Date().toISOString();
}

function message(view: MvpView, type: string, title: string, body: string, time: string, extra: Record<string, unknown> = {}) {
  return { id: id("msg"), day: view.run.currentDay, time, type, label: type === "day_end" ? "日终回响" : type === "final" ? "最终裁决" : type === "decision" ? "待决策" : type === "maneuver_result" ? "主动谋划" : "剧情", title, body, ...extra };
}

function event(type: string, payload: Record<string, unknown> = {}): MvpStoryEvent {
  return { id: id("event"), type, payload, createdAt: new Date().toISOString() };
}

function id(prefix: string) {
  return `${prefix}_${Date.now().toString(36)}_${randomUUID().slice(0, 8)}`;
}

function compare(actual: number, op: Operator, expected: number) {
  if (op === ">=") return actual >= expected;
  if (op === "<=") return actual <= expected;
  if (op === ">") return actual > expected;
  if (op === "<") return actual < expected;
  return actual === expected;
}

function clamp(value: number) {
  return Math.max(0, Math.min(100, Math.round(Number(value) || 0)));
}

function patchScore(patch: Record<string, number> = {}) {
  const positive = ["皇帝信任", "民心", "国库银两", "总督权威", "暗账完整度", "县令信任"];
  return Object.entries(patch).reduce((score, [key, value]) => score + (positive.includes(key) ? value : 0), 0);
}

function riskScore(patch: Record<string, number> = {}) {
  const risks = ["清算风险", "皇帝疑心", "内阁疑心", "巡抚敌意", "官商交易风险", "商会清算风险"];
  return Object.entries(patch).reduce((score, [key, value]) => score + (risks.includes(key) ? Math.max(0, value) : 0), 0);
}
