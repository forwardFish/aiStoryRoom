export type MvpManeuverType = "contact" | "investigate" | "leverage" | "custom";
export type LeverageResolutionMode = "FIXED" | "AI_REACTION";

export interface MvpManeuverActorDefinition {
  roleKey: string;
  displayName: string;
  publicIdentity: string;
  portrait?: string;
  publicGoal: string;
  informationStyle: string;
}
export interface MvpContactDefinition extends MvpManeuverActorDefinition {
  relevance: string;
  statePatch: Record<string, number>;
  allowedFactKeys: string[];
  fallbackTitle: string;
  fallbackReply: string;
}
export interface MvpInvestigationDefinition {
  intentKey: string;
  title: string;
  summary: string;
  resultTitle: string;
  resultText: string;
  factKeys: string[];
  statePatch: Record<string, number>;
  traces: string[];
}
export interface MvpLeverageDefinition {
  leverageKey: string;
  label: string;
  description: string;
  resolutionMode: LeverageResolutionMode;
  requiresTarget: boolean;
  targetRoleKeys: string[];
  availableSceneKeys: string[];
  statePatch: Record<string, number>;
  factKeys: string[];
  resultTitle: string;
  fixedResultText?: string;
  fallbackReply?: string;
}
export interface MvpManeuverSceneConfig {
  sceneKey: string;
  contacts: MvpContactDefinition[];
  investigations: MvpInvestigationDefinition[];
  playableLeverageKeys: string[];
  customEnabled: boolean;
}

const ACTORS: Record<string, MvpManeuverActorDefinition> = {
  xunfu: { roleKey: "xunfu", displayName: "浙江巡抚", publicIdentity: "巡抚", portrait: "art-avatar-xunfu", publicGoal: "推进改桑，尽快见银", informationStyle: "只公开对自己有利的信息" },
  county_magistrate: { roleKey: "county_magistrate", displayName: "卢象升", publicIdentity: "清流县令", portrait: "art-avatar-county", publicGoal: "护民并依法执行", informationStyle: "只向可信对象递交部分事实" },
  merchant: { roleKey: "merchant", displayName: "江南商会会首", publicIdentity: "商会代表", portrait: "art-avatar-merchant", publicGoal: "出银稳商路", informationStyle: "公开称为国分忧，私下保存交易痕迹" },
  sili_jian: { roleKey: "sili_jian", displayName: "司礼监织造使", publicIdentity: "内廷使者", portrait: "art-avatar-sili", publicGoal: "确保丝源与银路入内廷", informationStyle: "少公开表态，只向御前密报" },
  cabinet: { roleKey: "cabinet", displayName: "内阁财政派", publicIdentity: "京师阁臣", publicGoal: "尽快补足国库", informationStyle: "用正式文书制造责任边界" }
};
const CONTACT_PATCH: Record<string, Record<string, number>> = {
  xunfu: { "总督权威": 2, "巡抚敌意": 2 },
  county_magistrate: { "县令信任": 5, "暗账完整度": 2 },
  merchant: { "商会依赖": 4, "官商交易风险": 2 },
  sili_jian: { "司礼监警惕": 3, "皇帝疑心": 1 },
  cabinet: { "内阁疑心": 2, "总督权威": 1 }
};
const REPLIES: Record<string, string> = {
  county_magistrate: "原册大体还在，只是几册昨日才从库房送回。若总督大人一定要查验，我可以先交清单，但原件是否齐全，我现在不敢作保。",
  merchant: "商会愿意配合，但任何承诺都要有可以兑现的条件。总督大人想知道什么，不妨把话说明白。",
  xunfu: "巡抚府按诏办事。若总督有所疑问，可以拿出正式依据，而不是凭传闻压下进度。",
  sili_jian: "织造使只问银路和丝源。其余争执，御前自会判断。",
  cabinet: "内阁关心的是何时见银、谁能担责。地方若有不同说法，必须拿出可核验的文书。"
};
function contact(roleKey: string, relevance: string): MvpContactDefinition {
  const actor = ACTORS[roleKey];
  if (!actor) throw new Error(`UNKNOWN_MANEUVER_ACTOR:${roleKey}`);
  return { ...actor, relevance, statePatch: CONTACT_PATCH[roleKey] || {}, allowedFactKeys: [], fallbackTitle: `${actor.displayName}作出回应`, fallbackReply: REPLIES[roleKey] };
}
function inv(intentKey: string, title: string, summary: string, resultText: string, factKey: string, statePatch: Record<string, number>, traces: string[]): MvpInvestigationDefinition {
  return { intentKey, title, summary, resultTitle: `调查结果 · ${title}`, resultText, factKeys: [factKey], statePatch, traces };
}
const INVESTIGATIONS = Object.fromEntries([
  inv("inspect_first_register_timing", "核对首批名册形成时间", "首批名册提交得过于迅速。", "两份名册初稿的落款时间早于诏令正式送达浙江。", "first_registers_prepared_early", { "暗账完整度": 4, "巡抚敌意": 1 }, ["首批名册落款", "诏令送达记录"]),
  inv("inspect_merchant_grain_source", "查商会垫粮来源", "商会承诺的银粮来路并不透明。", "三家出粮仓号中，两家与改桑地号存在交叉。", "merchant_grain_linked_to_land_deals", { "暗账完整度": 4, "商会清算风险": 2 }, ["商会仓号清单", "改桑地号交叉记录"]),
  inv("inspect_letter_parcels", "核对密信所列地号", "县令密信列出了三处可疑田亩。", "其中两处在正式报册前已经被改换田类。", "letter_parcels_reclassified_early", { "暗账完整度": 7 }, ["密信地号", "田类变更记录"]),
  inv("inspect_county_orders", "比对三县催报文书", "三县收到的催报格式极为相似。", "三份文书的关键批注出自巡抚府同一名书吏。", "county_orders_share_xunfu_clerk", { "暗账完整度": 6, "巡抚敌意": 2 }, ["三县催报文书", "同一书吏批注"]),
  inv("inspect_courier_registry", "查验驿站登记", "巡抚急奏离杭的时间和经手人仍不清楚。", "急奏子时离杭，登记经手人不是正常驿丞，而是巡抚亲随。", "memorial_handled_by_xunfu_aide", { "暗账完整度": 6, "总督权威": 1 }, ["驿站登记", "巡抚亲随签押"]),
  inv("inspect_merchant_grain_store", "清点商会可放粮库存", "商会公开的可放粮数量可能被刻意压低。", "商会能够立即放出的粮食明显高于其公开承诺。", "merchant_withheld_available_grain", { "粮价": -2, "商会清算风险": 4 }, ["商会仓储清单", "公开承诺差额"]),
  inv("inspect_land_register_binding", "核对田亩底册装订", "复核清单与县衙旧册存在差异。", "三页纸张明显较新，装订孔也与整册其他页面不一致。原始底册曾被拆开并重新装订。", "land_register_was_rebound", { "暗账完整度": 9 }, ["重新装订的底册", "新旧纸张差异"]),
  inv("inspect_removed_clerk", "寻找被撤换书吏", "巡抚突然撤换了参与名册的书吏。", "其中一名书吏离开前保存了带编号的抄页。", "removed_clerk_kept_numbered_copy", { "暗账完整度": 8, "县令信任": 2 }, ["带编号的抄页", "书吏撤换记录"]),
  inv("inspect_reported_silver", "复核浙江见银进度", "内阁催问的见银数字可能混入尚未兑现的承诺。", "上报金额中包含尚未兑付的商会票据。", "reported_silver_includes_unpaid_notes", { "暗账完整度": 3, "内阁疑心": 2 }, ["见银进度表", "未兑付商会票据"]),
  inv("inspect_sili_contacts", "查织造使入府前接触记录", "织造使抵达杭州前已经有人先行接触。", "织造使入府前曾与商会管事短暂会面。", "sili_met_merchant_before_governor", { "司礼监警惕": 3, "商会清算风险": 3 }, ["织造使入府记录", "商会管事会面"]),
  inv("inspect_final_memorial_evidence", "复核最终奏报证据目录", "最后奏报中的每一项说法都必须经得起御前追问。", "清弊方向的两项关键指控目前只有抄件，稳局与粮价数据可以核验。", "final_memorial_evidence_gap_known", { "暗账完整度": 5, "清算风险": -2 }, ["最终奏报证据目录", "可核验粮价数据"]),
  inv("inspect_last_petitions", "比对三方最后来函", "巡抚、县令和商会同时求见，各自都在回避某些内容。", "三封来函都没有解释同一批田契编号。", "three_petitions_avoid_same_parcels", { "暗账完整度": 5 }, ["三方最后来函", "共同回避的田契编号"])
].map((item) => [item.intentKey, item])) as Record<string, MvpInvestigationDefinition>;

type SceneRow = { contacts: Array<[string, string]>; investigationKey: string; leverageKeys: string[] };
const SCENES: Record<string, SceneRow> = {
  d1_1: { contacts: [["xunfu", "正在请示立即推进首批名册"], ["county_magistrate", "掌管三县原始田亩资料"]], investigationKey: "inspect_first_register_timing", leverageKeys: [] },
  d1_2: { contacts: [["merchant", "正在提出垫粮与政策交换"], ["county_magistrate", "可能知道商会粮源与田亩关系"]], investigationKey: "inspect_merchant_grain_source", leverageKeys: ["xunfu_merchant_old_pact_rumor"] },
  d2_1: { contacts: [["county_magistrate", "密信由他发出并掌握可疑地号"], ["xunfu", "其催报安排与密信内容直接冲突"]], investigationKey: "inspect_letter_parcels", leverageKeys: ["county_letter", "land_contract_fragment"] },
  d2_2: { contacts: [["xunfu", "正在要求三县限期上报名册"], ["county_magistrate", "直接承受催报压力"], ["merchant", "可能从催办中获得田亩机会"]], investigationKey: "inspect_county_orders", leverageKeys: ["county_letter", "xunfu_merchant_old_pact_rumor", "land_contract_fragment"] },
  d3_1: { contacts: [["xunfu", "急奏已经离杭，需要解释奏报口径"], ["county_magistrate", "可能知道急奏相关经手人"]], investigationKey: "inspect_courier_registry", leverageKeys: ["county_letter", "land_contract_fragment"] },
  d3_2: { contacts: [["merchant", "正在以放粮换取保护"], ["county_magistrate", "掌握地方粮价与仓储情况"], ["xunfu", "与商会可能存在利益交换"]], investigationKey: "inspect_merchant_grain_store", leverageKeys: ["xunfu_merchant_old_pact_rumor", "land_contract_fragment"] },
  d4_1: { contacts: [["county_magistrate", "提供了暗账并希望继续补证"], ["merchant", "暗账直接涉及商会地号"]], investigationKey: "inspect_land_register_binding", leverageKeys: ["land_contract_fragment", "xunfu_merchant_old_pact_rumor"] },
  d4_2: { contacts: [["xunfu", "突然撤换参与名册的书吏"], ["county_magistrate", "可能帮助找到被撤换书吏"]], investigationKey: "inspect_removed_clerk", leverageKeys: ["county_letter", "land_contract_fragment"] },
  d5_1: { contacts: [["cabinet", "正在追问浙江迟迟不见银的责任"], ["xunfu", "其奏报已经进入内阁"], ["county_magistrate", "能够说明地方真实执行情况"]], investigationKey: "inspect_reported_silver", leverageKeys: ["county_letter", "land_contract_fragment"] },
  d5_2: { contacts: [["sili_jian", "代表御前探查银路与奏报差异"], ["merchant", "可能已与织造使接触"], ["xunfu", "可能借内廷改变责任口径"]], investigationKey: "inspect_sili_contacts", leverageKeys: ["xunfu_merchant_old_pact_rumor", "county_letter"] },
  d6_1: { contacts: [["cabinet", "最终奏报将进入内阁与御前审阅"], ["sili_jian", "掌握御前对银路和欺瞒的关注"], ["county_magistrate", "能够补足清弊方向的证据"]], investigationKey: "inspect_final_memorial_evidence", leverageKeys: ["land_contract_fragment", "county_letter", "xunfu_merchant_old_pact_rumor"] },
  d6_2: { contacts: [["xunfu", "请求最后一次统一督抚口径"], ["county_magistrate", "请求补全证据并护住地方"], ["merchant", "请求以银粮换取最终保护"]], investigationKey: "inspect_last_petitions", leverageKeys: ["land_contract_fragment", "county_letter", "xunfu_merchant_old_pact_rumor"] }
};
const sceneKeysFor = (key: string) => Object.keys(SCENES).filter((sceneKey) => SCENES[sceneKey].leverageKeys.includes(key));
const LEVERAGES: Record<string, MvpLeverageDefinition> = {
  land_contract_fragment: { leverageKey: "land_contract_fragment", label: "田契暗账（半页）", description: "向相关人物出示暗账，触发一次围绕具体地号的特殊回应。", resolutionMode: "AI_REACTION", requiresTarget: true, targetRoleKeys: ["county_magistrate", "merchant", "xunfu"], availableSceneKeys: sceneKeysFor("land_contract_fragment"), statePatch: { "暗账完整度": 5, "总督权威": 2, "清算风险": 2 }, factKeys: [], resultTitle: "筹码已打出 · 田契暗账（半页）", fallbackReply: "这些地号确实值得解释，但半页账目还不足以说明完整责任链。" },
  county_letter: { leverageKey: "county_letter", label: "清流县令密信", description: "出示县令密信，触发一次围绕经手人与日期的特殊回应。", resolutionMode: "AI_REACTION", requiresTarget: true, targetRoleKeys: ["xunfu", "merchant", "cabinet", "sili_jian"], availableSceneKeys: sceneKeysFor("county_letter"), statePatch: { "暗账完整度": 4, "清算风险": 2 }, factKeys: [], resultTitle: "筹码已打出 · 清流县令密信", fallbackReply: "密信写明了经手人与日期，但内容仍需正式文书或原件才能定案。" },
  xunfu_merchant_old_pact_rumor: { leverageKey: "xunfu_merchant_old_pact_rumor", label: "巡抚与商会旧约传闻", description: "以旧约传闻试探巡抚或商会，观察一次特殊反应。", resolutionMode: "AI_REACTION", requiresTarget: true, targetRoleKeys: ["xunfu", "merchant"], availableSceneKeys: sceneKeysFor("xunfu_merchant_old_pact_rumor"), statePatch: { "暗账完整度": 2, "巡抚敌意": 2, "商会清算风险": 2 }, factKeys: [], resultTitle: "筹码已打出 · 巡抚与商会旧约传闻", fallbackReply: "传闻不足以定案，但对方对旧约二字的反应已经留下新的判断依据。" }
};

export function getManeuverActor(roleKey: string) { return ACTORS[roleKey] || null; }
export function getInvestigationDefinition(intentKey: string) { return INVESTIGATIONS[intentKey] || null; }
export function getLeverageDefinition(leverageKey: string) { return LEVERAGES[leverageKey] || null; }
export function getManeuverSceneConfig(sceneKey: string): MvpManeuverSceneConfig | null {
  const row = SCENES[sceneKey];
  if (!row) return null;
  return { sceneKey, contacts: row.contacts.map(([roleKey, relevance]) => contact(roleKey, relevance)), investigations: row.investigationKey ? [INVESTIGATIONS[row.investigationKey]] : [], playableLeverageKeys: [...row.leverageKeys], customEnabled: true };
}
export const INITIAL_MVP_LEVERAGE_KEYS = ["land_contract_fragment", "county_letter", "xunfu_merchant_old_pact_rumor"] as const;
export const LEGACY_LEVERAGE_NAME_TO_KEY: Record<string, string> = {
  "田契暗账（半页）": "land_contract_fragment", "田契暗账半页": "land_contract_fragment",
  "清流县令密信": "county_letter", "巡抚与商会旧约": "xunfu_merchant_old_pact_rumor",
  "巡抚与商会旧约传闻": "xunfu_merchant_old_pact_rumor", "海防军报": "coastal_report"
};
