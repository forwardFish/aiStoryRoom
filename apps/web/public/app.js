const root = document.getElementById("app");

const STORAGE_KEY = "ai-story-bureau-sangtian-demo-v2";

const stories = [
  {
    slug: "sangtian",
    title: "桑田诏：嘉靖财政危局",
    shortTitle: "嘉靖财政危局",
    subtitle: "7 天动态权谋故事局",
    category: "权谋历史",
    coverClass: "cover-sangtian",
    tags: ["历史权谋", "剧情消息", "单人可玩", "7天"],
    players: "1-6人",
    duration: "30-45分钟",
    difficulty: "中等",
    intro:
      "嘉靖朝财政危局，国库缺银，江南奉旨改稻为桑。你是浙江总督，必须在七天内稳住民心、压住官商、回应朝廷，并决定谁来替大明付这笔账。",
    hook: "你不是在读故事，而是在一个每天都逼近裁决的局里做选择。",
  },
  {
    slug: "promotion",
    title: "晋升名单公布前",
    shortTitle: "晋升名单公布前",
    subtitle: "职场权力博弈故事局",
    category: "都市职场",
    coverClass: "cover-office",
    tags: ["职场", "现代", "传播向"],
    players: "1-5人",
    duration: "15-25分钟",
    difficulty: "低",
    intro: "组织调整前七天，你的竞争者开始抢功，老板态度摇摆。",
    hook: "每一次表态，都可能决定你是晋升还是背锅。",
  },
  {
    slug: "heirnight",
    title: "豪门继承夜",
    shortTitle: "豪门继承夜",
    subtitle: "家族利益与遗嘱之夜",
    category: "悬疑推理",
    coverClass: "cover-heir",
    tags: ["家族", "悬疑", "多人"],
    players: "3-6人",
    duration: "30分钟",
    difficulty: "中",
    intro: "一份遗嘱引发的家族暗战。",
    hook: "你以为你在争遗产，其实你在争活路。",
  },
  {
    slug: "xianxia",
    title: "凡人修仙局",
    shortTitle: "凡人修仙局",
    subtitle: "宗门命运抉择",
    category: "奇幻冒险",
    coverClass: "cover-xianxia",
    tags: ["修仙", "宗门", "成长"],
    players: "2-6人",
    duration: "25分钟",
    difficulty: "中",
    intro: "从凡人到仙途的逆袭之旅。",
    hook: "师门的秘密，也许就是你破局的代价。",
  },
];

const roleList = [
  {
    key: "governor",
    name: "浙江总督",
    person: "郑帅彬",
    avatar: "督",
    trait: "统筹全局",
    title: "从四品 · 兵部侍郎衔",
    mission: "稳住浙江，压住巡抚，避免皇帝生疑。",
    goal: "在国库、民心、官商、海防之间保住自己，并尽可能借局升迁。",
    playable: true,
  },
  {
    key: "xunfu",
    name: "浙江巡抚",
    person: "刘瑾",
    avatar: "巡",
    trait: "争功冒进",
    title: "地方巡抚",
    mission: "快速推进改桑，抢先向朝廷报功。",
    goal: "以新政功臣身份进入京师。",
    playable: false,
  },
  {
    key: "county",
    name: "清流县令",
    person: "卢象升",
    avatar: "令",
    trait: "清流查账",
    title: "江南县令",
    mission: "查清田契暗账，保护百姓。",
    goal: "在朝廷国策与地方民生之间求一条正路。",
    playable: false,
  },
  {
    key: "merchant",
    name: "江南商会",
    person: "掌柜",
    avatar: "商",
    trait: "逐利观望",
    title: "丝粮商会",
    mission: "垫银换保护，低价控制桑田。",
    goal: "避免成为替罪羊，同时扩大商路。",
    playable: false,
  },
  {
    key: "sili",
    name: "司礼监织造使",
    person: "魏忠贤",
    avatar: "监",
    trait: "暗中监视",
    title: "内廷耳目",
    mission: "确保丝源与银路进入内廷视野。",
    goal: "绕过内阁，控制江南银路。",
    playable: false,
  },
];

const initialWorld = {
  currentDay: 1,
  totalDays: 7,
  location: "杭州总督府 · 内厅",
  selectedRole: "governor",
  decisionLocked: false,
  gameComplete: false,
  worldState: {
    国库银: 30,
    民心: 60,
    粮价: 45,
    改桑进度: 20,
    海防军心: 50,
    皇帝信任: 45,
    皇帝疑心: 55,
  },
  roleState: {
    总督权威: 60,
    升迁机会: 40,
    清算风险: 45,
    内阁疑心: 35,
    巡抚敌意: 30,
    县令信任: 50,
    商会依赖: 35,
    司礼监警惕: 30,
  },
  relationships: [
    { name: "浙江巡抚", person: "刘瑾", stance: "敌意", score: 30, avatar: "巡" },
    { name: "清流县令", person: "卢象升", stance: "观望", score: 50, avatar: "令" },
    { name: "江南商会", person: "掌柜", stance: "观望", score: 35, avatar: "商" },
    { name: "司礼监织造使", person: "魏忠贤", stance: "警惕", score: 30, avatar: "监" },
    { name: "内阁财政派", person: "张居正", stance: "审视", score: 35, avatar: "阁" },
  ],
  clues: ["海防军饷压力", "巡抚越级倾向"],
  latestChanges: ["改桑令抵达浙江", "海防军饷拖欠两月"],
  risks: [
    { name: "粮价失控", level: "低" },
    { name: "巡抚越级", level: "中" },
    { name: "商会坐大", level: "中" },
    { name: "皇帝生疑", level: "中" },
  ],
  hiddenThreads: [],
  decisions: [],
  messages: [],
};

const dayScripts = {
  1: {
    theme: "改桑令下",
    pressure: "朝廷催银，巡抚请命",
    opening: [
      systemMsg(1, "清晨", "京师急诏抵达浙江", "京师急诏抵达浙江。诏书写得简洁：江南择地改稻为桑，以桑养蚕，以丝换银，以银补国用。案上还有另一封海防军报：沿海军饷已拖两月，若再不补给，军心难稳。幕僚低声道：“大人，朝廷要银，地方要粮，军中要饷。浙江这一局，不能只看桑田。”"),
      roleMsg(1, "午前", "浙江巡抚", "巡抚入府请命", "浙江巡抚呈上一份初拟名册，称嘉兴、绍兴、湖州三地最宜先行改桑，并请你准许他立即督办。他说：“朝廷催银甚急，若浙江迟疑，京师必疑我等不奉诏。臣愿先担执行之责。”"),
    ],
    prompt: decisionMsg(1, "午前", "是否准许巡抚立即推进", "你看着那份名册，发现三地正是粮田集中之处。若操切推进，粮价可能先动；若压住巡抚，京师又可能疑你拖延。巡抚站在案前，等你表态。", [
      option("A", "准许巡抚先行推进", "表面支持朝廷，让巡抚负责第一批名册。", { 改桑进度: 10, 内阁疑心: -5, 巡抚敌意: 4, 粮价: 5, 民心: -4 }, "改桑进度上升", "巡抚声望变高，粮价先动"),
      option("B", "要求先核田清册", "以核实田亩、避免误伤民田为由，要求巡抚三日后再报细册。", { 改桑进度: -5, 内阁疑心: 5, 巡抚敌意: 5, 县令信任: 5 }, "民心风险暂缓", "内阁与巡抚都可能疑你拖延"),
      option("C", "表面同意，私下查田契", "不阻止巡抚，但让幕僚暗中查名册来源。", { 改桑进度: 5, 总督权威: 2, 巡抚敌意: 2 }, "短期不激怒巡抚，并得到暗线", "若被发现，巡抚敌意会升高"),
    ]),
  },
  2: {
    theme: "地方催政",
    pressure: "三县名册，县令密信",
    opening: [
      systemMsg(2, "清晨", "三县名册开始流动", "巡抚府昨夜发出三道公文，要求嘉兴、绍兴、湖州三地限期上报名册。公文措辞极重：“有迟误者，以误国论。”与此同时，杭州米价小涨，粮铺掌柜都说只是雨水误船。"),
      privateMsg(2, "午后", "清流县令", "未署名密信入府", "一封未署名密信被送入总督府。信中写道：“本县尚未丈量，已有商号执契来问桑田价。百姓未卖田，田名似已在册。若此事属实，改桑恐变夺田。”幕僚认出笔迹，是嘉兴一名清流县令。"),
    ],
    prompt: decisionMsg(2, "午后", "如何处理县令密信", "你手里有了第一条真正的线索。清流县令可以成为一把刀，但这把刀如果失控，也可能割伤你。", [
      option("A", "保护县令继续查账", "给县令保护，让他继续追查田契和商会关系。", { 县令信任: 10, 巡抚敌意: 8, 清算风险: 3 }, "可能获得巡抚与商会把柄", "巡抚敌意上升，县令可能失控"),
      option("B", "要求县令停止私查", "只准县令上报民情，不许私查官商账册。", { 县令信任: -10, 巡抚敌意: -2, 清算风险: -2 }, "减少民情爆发风险", "暗账线索可能断裂"),
      option("C", "密令查账，证据先送总督府", "允许县令继续查，但所有证据必须先交给你。", { 县令信任: 5, 巡抚敌意: 3, 总督权威: 3 }, "你掌握证据流向", "县令可能保留副本"),
    ]),
  },
  3: {
    theme: "粮价上涨",
    pressure: "巡抚急奏，商会控粮",
    opening: [
      systemMsg(3, "午前", "粮价三日连涨", "杭州米价三日内上涨两成。粮铺外开始有人排队，百姓口中已经把“改桑”二字和“没粮”连在了一起。巡抚府却在此时传出消息：第一批改桑名册已整理完成，准备急奏京师。"),
      roleMsg(3, "午后", "江南商会", "商会要求护身符", "商会会首派人求见。他说商会愿意放出一批平价粮，但要总督府给一个明确态度：“商会先替朝廷垫粮，日后若有人说我等囤粮逐利，总督府可不能坐视。”"),
    ],
    prompt: decisionMsg(3, "午后", "巡抚急奏北上", "驿站快马离开杭州府。有人看见浙江巡抚的幕僚亲自护送一封急奏北上。奏中没有提粮价上涨，也没有提三县拒签田契，只写：“地方官民皆知朝廷苦心，桑田之政已有成效。”你的幕僚提醒：“若这封奏疏先到内阁，巡抚便是功臣；若之后民怨爆发，您这个总督就是压不住局的人。”", [
      option("A", "截留奏疏", "派人追上驿站，暂扣巡抚奏疏。", { 总督权威: 8, 巡抚敌意: 12, 内阁疑心: 10, 清算风险: 5 }, "阻止巡抚抢功", "巡抚可反咬你压制国策"),
      option("B", "追加密奏", "不阻止巡抚，但另写密奏给皇帝，说明浙江局势未稳。", { 皇帝信任: 4, 内阁疑心: 2, 巡抚敌意: 3, 司礼监警惕: 5 }, "保留解释权", "司礼监会注意两份奏报差异"),
      option("C", "放任巡抚", "让他继续抢功，等待他与商会绑定更深。", { 总督权威: -8, 巡抚敌意: -2, 清算风险: 4, 改桑进度: 8 }, "未来可一并清算", "巡抚短期声望上升"),
    ]),
  },
  4: {
    theme: "暗账浮出",
    pressure: "田契副本，巡抚灭证",
    opening: [
      systemMsg(4, "清晨", "暗账入府", "一夜雨后，嘉兴县衙递来密匣。匣中有两页田契副本，其中一页显示，部分田亩尚未正式改桑，就已经被商会提前标注为“可收桑地”。另一页露出几个模糊名字，其中一个像是巡抚府师爷。"),
      roleMsg(4, "午后", "浙江巡抚", "巡抚府撤换书吏", "巡抚府突然撤换了三县名册中的几名书吏。表面理由是“办事不力”。幕僚却说：“大人，他可能知道有人在查账了。”"),
    ],
    prompt: decisionMsg(4, "午后", "如何使用暗账", "这份暗账不完整，却足以威慑商会，足以逼巡抚收手。用得早，可能被反咬；用得晚，证据可能消失。", [
      option("A", "密奏皇帝", "将暗账作为地方执行过激证据，直接入密奏。", { 皇帝信任: 8, 司礼监警惕: 8, 巡抚敌意: 10, 内阁疑心: 8 }, "皇帝看到真实风险", "内阁和司礼监都会盯上你"),
      option("B", "威胁商会放粮出银", "不公开暗账，只用它逼商会配合。", { 商会依赖: 12, 粮价: -6, 国库银: 5, 县令信任: -8 }, "粮价与银两压力下降", "县令怀疑你与商会交易"),
      option("C", "交给县令继续补证", "暂不动用，命县令查完整证据链。", { 县令信任: 8, 巡抚敌意: 5, 民心: 3 }, "证据链更完整", "短期无法压局"),
    ]),
  },
  5: {
    theme: "互相弹劾",
    pressure: "内阁催问，司礼监入浙",
    opening: [
      systemMsg(5, "早朝后", "京师开始问责", "京师传来消息：内阁已收到巡抚急奏。奏中称浙江改桑进度可喜，但地方推进受制于“上司持重，文移往返过多”。这句话没有点你的名，却句句指向总督府。"),
      roleMsg(5, "午后", "司礼监", "织造使入浙试探", "织造使派人送来口信：“宫中只问一事：丝源何时稳，银路何时通？”对方没有问巡抚，也没有问县令，而是直接问你。"),
    ],
    prompt: decisionMsg(5, "午后", "如何回应内阁催问", "内阁文书问得平和，却极重：浙江改桑既已有成效，为何迟迟不见银数？是地方不力，商民不从，还是督抚意见不一？幕僚说：“大人，内阁不是问进度，是问谁负责。”", [
      option("A", "推给巡抚操切", "说明地方执行过急，导致粮价和民心压力。", { 巡抚敌意: 10, 清算风险: -8, 内阁疑心: 4 }, "切割巡抚", "巡抚反咬你督办无力"),
      option("B", "承认不足，请求分阶段推进", "以稳局为由争取时间。", { 民心: 5, 皇帝信任: 4, 内阁疑心: 10 }, "民心风险下降", "内阁疑心上升"),
      option("C", "报告商会可先垫银", "用商会银子缓解内阁压力。", { 国库银: 10, 内阁疑心: -5, 商会依赖: 12, 县令信任: -8 }, "国库压力缓解", "商会坐大，县令不满"),
    ]),
  },
  6: {
    theme: "京师回批",
    pressure: "最终奏报，三方求见",
    opening: [
      systemMsg(6, "清晨", "皇帝批语抵浙", "京师回批到了。皇帝没有直接裁决，只批了一句：“银从何来，乱由谁止，欺朕者谁？”这不是问话，是最后通牒。"),
      privateMsg(6, "入夜前", "三方求见", "巡抚派人说愿与总督府同署奏报；县令递信说若大人不言，民田将尽入商手；商会会首则在府外等候，称明日之前可先出一笔银。你不能同时满足所有人。"),
    ],
    prompt: decisionMsg(6, "夜", "最终奏报方向", "你必须在今晚前拟定最终奏报。奏报将决定第 7 天御前裁决的方向。幕僚摊开四份草案，问你：大人，明日之前，您要让皇上看到哪个浙江？", [
      option("A", "稳局奏报", "承认改桑可行，但请求缓行，并说明你已控制粮价和民心。", { 皇帝信任: 8, 清算风险: -8, 民心: 5 }, "适合稳局小胜", "若银数不足，仍会被疑拖延"),
      option("B", "清弊奏报", "公开巡抚与商会暗账，把危机定义为地方执行腐败。", { 巡抚敌意: 15, 皇帝信任: 5, 内阁疑心: 4, 清算风险: -4 }, "巡抚可能倒台", "证据不足会牵连自己"),
      option("C", "财政奏报", "让商会先垫银，换政策保护，优先解决国库压力。", { 国库银: 15, 商会依赖: 15, 司礼监警惕: 8, 县令信任: -10 }, "国库压力明显下降", "商会与内廷坐大"),
    ]),
  },
  7: {
    theme: "御前裁决",
    pressure: "结算全局与个人命运",
    opening: [
      systemMsg(7, "京师", "各路奏报抵达御前", "内阁说浙江可见银，但地方意见不一。司礼监说江南银路可通，但需绕开掣肘。巡抚说新政已有成效，只是总督过于持重。县令的暗账残页，也以某种方式进入了京师视野。皇帝看完所有奏报，只问了一句：“浙江到底是谁在办事，谁在误事？”"),
    ],
    prompt: null,
  },
};

function systemMsg(day, time, title, narrative) {
  return { id: uid("msg"), day, time, type: "system", label: "系统", title, narrative, decisionRequired: false };
}

function roleMsg(day, time, speaker, title, narrative) {
  return { id: uid("msg"), day, time, type: "role_action", label: "角色行动", speaker, title, narrative, decisionRequired: false };
}

function privateMsg(day, time, speaker, title, narrative) {
  return { id: uid("msg"), day, time, type: "private_intel", label: "私密", speaker, title, narrative, decisionRequired: false };
}

function decisionMsg(day, time, title, narrative, options) {
  return { id: uid("msg"), day, time, type: "decision_prompt", label: "待决策", title, narrative, decisionRequired: true, options };
}

function option(key, title, description, patch, gain, risk) {
  return { key, title, description, patch, gain, risk };
}

function uid(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(16).slice(2, 8)}`;
}

let runtime = loadRuntime();
let selectedOption = "A";

function loadRuntime() {
  try {
    const cached = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    if (cached && cached.worldState && Array.isArray(cached.messages)) return cached;
  } catch {}
  const fresh = structuredClone(initialWorld);
  seedDay(fresh, 1);
  return fresh;
}

function saveRuntime() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(runtime));
}

function resetRuntime() {
  localStorage.removeItem(STORAGE_KEY);
  runtime = structuredClone(initialWorld);
  selectedOption = "A";
  seedDay(runtime, 1);
  saveRuntime();
}

function seedDay(target, day) {
  const script = dayScripts[day];
  if (!script) return;
  target.currentDay = day;
  target.decisionLocked = false;
  target.messages.push({ id: uid("divider"), type: "day_divider", day, title: `第 ${day} 天：${script.theme}`, narrative: script.pressure });
  script.opening.forEach((msg) => target.messages.push({ ...msg, id: uid("msg") }));
  if (script.prompt) target.messages.push({ ...script.prompt, id: uid("msg") });
  if (day === 7) {
    target.gameComplete = true;
    const ending = storyEngine.generateEnding(target);
    target.messages.push({ id: uid("final"), day: 7, time: "御前", type: "final", label: "最终裁决", title: ending.title, narrative: ending.narrative });
  }
}

const storyEngine = {
  getActiveDecision() {
    return [...runtime.messages].reverse().find((m) => m.decisionRequired && !m.resolved);
  },
  validateCustomDecision(text) {
    const raw = String(text || "").trim();
    if (!raw) return { allowed: false, severity: "rewrite_needed", normalizedDecision: "", reason: "请写出你的具体行动意图。" };
    const blockedWords = ["杀掉", "处死", "让皇帝", "直接判", "我命令皇帝", "所有人立刻", "凭空得到"];
    const hit = blockedWords.find((word) => raw.includes(word));
    if (hit) {
      return {
        allowed: false,
        severity: "blocked",
        normalizedDecision: raw,
        reason: "该决策超出浙江总督的权力边界。你只能声明自己的行动意图，不能直接宣布他人结果。",
      };
    }
    return { allowed: true, severity: "ok", normalizedDecision: raw, reason: "" };
  },
  resolveDecision(message, optionKey, customText) {
    const selected = optionKey === "CUSTOM"
      ? { key: "CUSTOM", title: "自定义决策", description: customText, patch: inferCustomPatch(customText), gain: "可能形成奇谋", risk: "若越权会被驳回" }
      : message.options.find((item) => item.key === optionKey) || message.options[0];

    applyPatch(selected.patch);
    updateRelationships(selected.patch);
    updateRisks();

    const result = buildResultMessage(runtime.currentDay, message, selected, customText);
    runtime.messages.push(result);
    runtime.latestChanges = buildLatestChanges(selected.patch, selected.title);
    runtime.decisions.push({ messageId: message.id, day: runtime.currentDay, optionKey: selected.key, decisionText: customText || selected.title, patch: selected.patch });
    message.resolved = true;
    runtime.decisionLocked = true;

    const hidden = buildHiddenThread(selected);
    if (hidden) runtime.hiddenThreads.push(hidden);
    if (hidden) runtime.messages.push(hiddenMessage(runtime.currentDay, hidden));
    return result;
  },
  dayEnd() {
    const day = runtime.currentDay;
    const text = dayEndText(day);
    runtime.messages.push({ id: uid("dayend"), day, time: "日终", type: "day_end", label: "日终回响", title: `第 ${day} 天 · 日终回响`, narrative: text });
    runtime.decisionLocked = true;
    saveRuntime();
  },
  advanceDay() {
    if (runtime.currentDay >= runtime.totalDays) {
      location.hash = "#/ending/sangtian";
      return;
    }
    const hasDayEnd = runtime.messages.some((m) => m.day === runtime.currentDay && m.type === "day_end");
    if (!hasDayEnd) this.dayEnd();
    seedDay(runtime, runtime.currentDay + 1);
    selectedOption = "A";
    saveRuntime();
  },
  generateEnding(target) {
    const w = target.worldState;
    const r = target.roleState;
    if (r.清算风险 >= 80 || w.民心 <= 35 || w.皇帝疑心 >= 82) {
      return { title: "你的最终下场：大败 · 问罪清算", narrative: "浙江没有按期见银，粮价也未平复。内阁、司礼监、巡抚、商会互相推责，奏报越多，皇帝越怒。最后必须有人承担全部责任。这不是因为真相清楚，而是因为朝廷需要一个结论，而那个人成了你。" };
    }
    if (w.皇帝信任 >= 68 && r.清算风险 <= 45 && w.民心 >= 48) {
      return { title: "你的最终下场：大胜 · 东南重臣", narrative: "你没有让浙江乱，也没有让朝廷失去银路。你压住了巡抚，稳住了县令，用商会但没有完全被商会绑住。皇帝批道：“此人可用，不可纵。”你升任东南军务重臣，成为朝中不得不用的人。" };
    }
    if (w.国库银 >= 55 && r.商会依赖 >= 65) {
      return { title: "全局结局：商人救国，商人控局", narrative: "江南商会先垫银粮，浙江暂时稳住。皇帝看到了银子，司礼监看到了银路，内阁保住了体面。但从此以后，江南桑丝不再只是朝廷财政之事，也成了商会和内廷共同控制的生意。" };
    }
    return { title: "你的最终下场：小胜 · 明升暗防", narrative: "浙江局势没有崩，改桑也没有彻底失败。你保住了官位，并得到了名义上的升迁。但内阁和司礼监都开始盯着你。你赢了这一局，却也让自己进入更大的局。" };
  },
};

function inferCustomPatch(text) {
  const raw = String(text || "");
  const patch = { 总督权威: 2, 清算风险: 2 };
  if (raw.includes("密奏") || raw.includes("皇帝")) Object.assign(patch, { 皇帝信任: 4, 司礼监警惕: 4, 内阁疑心: 2 });
  if (raw.includes("粮") || raw.includes("商会")) Object.assign(patch, { 粮价: -4, 商会依赖: 5, 县令信任: -3 });
  if (raw.includes("县令") || raw.includes("暗账")) Object.assign(patch, { 县令信任: 5, 巡抚敌意: 4 });
  if (raw.includes("巡抚")) Object.assign(patch, { 巡抚敌意: 5, 总督权威: 3 });
  return patch;
}

function applyPatch(patch = {}) {
  Object.entries(patch).forEach(([key, value]) => {
    const bag = key in runtime.worldState ? runtime.worldState : runtime.roleState;
    if (key in bag) bag[key] = clamp(Number(bag[key]) + Number(value));
  });
}

function updateRelationships(patch = {}) {
  const map = {
    巡抚敌意: "浙江巡抚",
    县令信任: "清流县令",
    商会依赖: "江南商会",
    司礼监警惕: "司礼监织造使",
    内阁疑心: "内阁财政派",
  };
  Object.entries(patch).forEach(([key, value]) => {
    const name = map[key];
    if (!name) return;
    const item = runtime.relationships.find((r) => r.name === name);
    if (!item) return;
    item.score = clamp(item.score + Number(value));
    if (key.includes("敌意")) item.stance = item.score >= 70 ? "敌对" : "敌意";
    if (key.includes("信任")) item.stance = item.score >= 60 ? "信任" : "观望";
    if (key.includes("依赖")) item.stance = item.score >= 65 ? "依赖" : "观望";
    if (key.includes("警惕") || key.includes("疑心")) item.stance = item.score >= 65 ? "警惕" : "审视";
  });
}

function buildLatestChanges(patch = {}, title = "决策") {
  const lines = [`你选择了「${title}」`];
  Object.entries(patch).slice(0, 4).forEach(([key, value]) => lines.push(`${key} ${value > 0 ? "↑" : "↓"} ${Math.abs(value)}`));
  return lines;
}

function updateRisks() {
  runtime.risks = [
    { name: "粮价失控", level: riskLevel(runtime.worldState.粮价, 70, 82) },
    { name: "巡抚越级", level: riskLevel(runtime.roleState.巡抚敌意, 65, 80) },
    { name: "商会坐大", level: riskLevel(runtime.roleState.商会依赖, 65, 80) },
    { name: "皇帝生疑", level: riskLevel(runtime.worldState.皇帝疑心, 70, 84) },
  ];
}

function riskLevel(value, mid, high) {
  if (value >= high) return "高";
  if (value >= mid) return "中";
  return "低";
}

function clamp(value) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function buildResultMessage(day, source, selected, customText) {
  const decision = customText || selected.title;
  const narrative = selected.key === "B" && source.title.includes("巡抚")
    ? "你没有截留巡抚奏疏，而是让幕僚连夜起草密奏。奏中写道：“浙江可改，然不可躁进。臣非不愿速成，实恐桑田未成而民心先裂。”密奏封入火漆，交由亲信快马送往京师。皇帝或许会因此看到浙江真实局势，但内阁也会嗅到你越级自保的味道。"
    : `你决定执行「${decision}」。总督府开始按此计策行事。此举带来的收益是：${selected.gain}；同时埋下风险：${selected.risk}。局势已经被你推向新的方向。`;
  return { id: uid("result"), day, time: "决策后", type: "decision_result", label: "你的决策", title: decision, narrative, decisionRequired: false };
}

function buildHiddenThread(selected) {
  if (!selected) return null;
  if (selected.title.includes("密奏")) return { title: "司礼监注意奏报差异", triggerDay: 5, risk: "中", note: "两份浙江奏报口径不一，内廷可能介入查问。" };
  if (selected.title.includes("商会") || selected.title.includes("放粮")) return { title: "商会索要保护", triggerDay: 5, risk: "中", note: "商会会把今日合作视为未来谈判筹码。" };
  if (selected.title.includes("县令") || selected.title.includes("查")) return { title: "县令保留副本", triggerDay: 4, risk: "中", note: "县令未必完全相信总督府，会保留一份证据。" };
  if (selected.title.includes("巡抚") || selected.title.includes("截留")) return { title: "巡抚准备反咬", triggerDay: 5, risk: "高", note: "巡抚可能向内阁暗示总督拖延国策。" };
  return null;
}

function hiddenMessage(day, hidden) {
  return { id: uid("hidden"), day, time: "后台推演", type: "private_intel", label: "隐藏暗线", title: hidden.title, narrative: `${hidden.note} 预计可能在第 ${hidden.triggerDay} 天触发。` };
}

function dayEndText(day) {
  const texts = {
    1: "改桑令在浙江官场传开。巡抚府灯火未熄，三县名册正在誊写。商会账房彻夜未关，银票和田契被分成数匣。第一天没有人真正出手，但所有人都已经站到了局中。",
    2: "三县名册开始流动。巡抚府往各县下达期限，县衙往乡里催田契，商会账房派人出入粮仓。局势像一张正在收紧的网。",
    3: "今日之后，局势开始分叉。巡抚的奏疏已经在路上，商会的粮仓仍未完全打开，县令送来的暗账只露出一角。你的每一步都开始留下痕迹。",
    4: "暗账已经浮出水面，但真相仍不完整。你第一次真正拥有了能改变别人命运的把柄。但把柄不是答案，它也是风险。",
    5: "今天之后，浙江不再只是浙江的事。内阁要责任，司礼监要银路，巡抚要功劳，商会要保护，县令要真相。所有人都在准备把失败的责任推给别人。",
    6: "最后一夜，杭州总督府灯火未灭。奏报写了三遍，又焚了两遍。明日，京师只需要一个可以继续运转的局面，以及一个必须承担后果的人。",
  };
  return texts[day] || "今日局势暂告一段落。";
}

function currentRoute() {
  const hash = location.hash.replace(/^#\/?/, "") || "";
  const parts = hash.split("/").filter(Boolean);
  return { name: parts[0] || "home", slug: parts[1] || "sangtian" };
}

function navigate(path) {
  location.hash = path;
}

function render() {
  const route = currentRoute();
  if (route.name === "story") return renderStoryDetail();
  if (route.name === "roles") return renderRoleSelect();
  if (route.name === "game") return renderGame();
  if (route.name === "ending") return renderEnding();
  return renderLobby();
}

function renderLobby() {
  root.className = "simulator-shell lobby-mode";
  root.innerHTML = `
    <div class="site-shell">
      ${renderSiteHeader("首页")}
      <section class="hero-carousel">
        <div class="hero-card side muted"><h2>晋升名单<br/>公布前</h2><p>职场权力博弈故事局</p></div>
        <div class="hero-card main cover-sangtian">
          <div class="hero-copy">
            <span class="badge">官方推荐</span>
            <h1>桑田诏：<br/>嘉靖财政危局</h1>
            <p>7天动态权谋故事局</p>
            <div class="tag-row"><span>权谋历史</span><span>单人可玩</span><span>剧情消息</span></div>
            <div class="hero-actions"><button onclick="navigate('/story/sangtian')">立即进入</button><button class="light" onclick="navigate('/story/sangtian')">查看详情</button></div>
          </div>
        </div>
        <div class="hero-card side cool"><h2>末日救援小队</h2><p>生存协作故事局</p></div>
      </section>
      <div class="notice"><strong>公告</strong><span>Web MVP 已上线：支持《桑田诏》单人 7 天故事局体验。</span></div>
      <nav class="category-pills">
        ${["全部", "权谋历史", "都市职场", "悬疑推理", "科幻未来", "奇幻冒险", "成长励志"].map((item, i) => `<button class="${i === 0 ? "active" : ""}">${item}</button>`).join("")}
      </nav>
      <section class="story-section"><div class="section-head"><h2>官方精选</h2><a>查看全部 ›</a></div><div class="story-grid">${stories.map(renderStoryCard).join("")}</div></section>
      <section class="story-section"><div class="section-head"><h2>热门故事局</h2><a>查看全部 ›</a></div><div class="story-grid compact">${stories.slice().reverse().map(renderStoryCard).join("")}</div></section>
    </div>`;
}

function renderSiteHeader(active) {
  return `<header class="site-header"><div class="site-brand"><div class="logo-mark">∞</div><div><strong>故事局</strong><small>AI 多人局</small></div></div><nav><a class="${active === "首页" ? "active" : ""}" onclick="navigate('/')">首页</a><a>分类</a><a onclick="navigate('/story/sangtian')">故事局</a><a>剧本库</a></nav><div class="site-search">搜索故事局 / 剧本 / 角色</div><div class="user-dot">长安客</div></header>`;
}

function renderStoryCard(story) {
  return `<article class="story-card ${story.coverClass}" onclick="navigate('/story/${story.slug}')"><div class="story-tags">${story.tags.slice(0, 2).map((tag) => `<span>${esc(tag)}</span>`).join("")}</div><div class="story-card-copy"><h3>${esc(story.shortTitle)}</h3><p>${esc(story.subtitle)}</p><div class="story-meta"><span>${esc(story.players)}</span><span>🔥 ${story.slug === "sangtian" ? "28,941" : "8,754"}</span></div></div></article>`;
}

function renderStoryDetail() {
  const story = stories[0];
  root.className = "simulator-shell detail-mode";
  root.innerHTML = `
    <div class="detail-shell">
      ${renderSiteHeader("故事局")}
      <section class="detail-hero cover-sangtian"><div><span class="badge">7 天动态权谋故事局</span><h1>${story.title}</h1><p>${story.intro}</p><div class="tag-row"><span>${story.players}</span><span>${story.duration}</span><span>${story.difficulty}</span></div><div class="hero-actions"><button onclick="navigate('/roles/sangtian')">开始选择角色</button><button class="light" onclick="navigate('/game/sangtian')">直接试玩</button></div></div></section>
      <section class="detail-content">
        <div class="intro-panel"><h2>你将经历什么</h2><p>${story.hook}</p><div class="feature-row"><span>剧情消息流</span><span>三选一 + 自定义</span><span>世界状态变化</span><span>第 7 天最终裁决</span></div></div>
        <div class="timeline-panel"><h2>七天主线</h2><div class="day-line">${Object.entries(dayScripts).map(([day, item]) => `<div><strong>第${day}天</strong><span>${esc(item.theme)}</span></div>`).join("")}</div></div>
      </section>
    </div>`;
}

function renderRoleSelect() {
  root.className = "simulator-shell role-mode";
  const selected = roleList.find((r) => r.key === runtime.selectedRole) || roleList[0];
  root.innerHTML = `
    <div class="role-shell">
      <header class="simple-top"><div class="site-brand"><div class="logo-mark gold">局</div><div><strong>AI故事局</strong></div></div><button onclick="navigate('/story/sangtian')">返回</button></header>
      <div class="stepper"><span>1 剧本简介</span><b>2 选择角色</b><span>3 开始游戏</span></div>
      <section class="role-brief"><h1>嘉靖财政危局</h1><p>请选择你的角色。MVP 首版开放浙江总督，其余角色由 AI 扮演。</p><div><span>7天</span><span>单人/多人</span><span>30-45分钟</span></div></section>
      <main class="role-main"><div class="role-grid">${roleList.map(renderRoleCard).join("")}</div><aside class="selected-role"><h2>当前选择</h2><div class="role-avatar big">${selected.avatar}</div><h3>${selected.name}</h3><p>${selected.mission}</p><div class="trait-row"><span>${selected.trait}</span><span>${selected.playable ? "可选" : "AI"}</span></div><button onclick="startGame()">确认角色并进入</button></aside></main>
    </div>`;
  document.querySelectorAll("[data-role]").forEach((node) => node.addEventListener("click", () => {
    const role = roleList.find((r) => r.key === node.dataset.role);
    if (!role?.playable) return;
    runtime.selectedRole = role.key;
    saveRuntime();
    renderRoleSelect();
  }));
}

function renderRoleCard(role) {
  const active = runtime.selectedRole === role.key;
  return `<button class="role-card ${active ? "active" : ""} ${!role.playable ? "locked" : ""}" data-role="${role.key}"><div class="role-avatar">${role.avatar}</div><h3>${role.name}</h3><p>${role.trait}</p><small>${role.playable ? "已开放" : "AI 扮演"}</small></button>`;
}

function startGame() {
  resetRuntime();
  navigate('/game/sangtian');
}

function renderGame() {
  root.className = "simulator-shell game-mode";
  const activeDecision = storyEngine.getActiveDecision();
  if (activeDecision && !selectedOption) selectedOption = activeDecision.options?.[0]?.key || "A";
  root.innerHTML = `
    <div class="game-shell">
      ${renderTopbar()}
      <aside class="left-rail">${renderPlayerCard()}${renderGoals()}${renderResources()}${renderLeverage()}</aside>
      <main class="center-stage">${renderMessageStream()}${renderDecisionPanel(activeDecision)}</main>
      <aside class="right-rail">${renderWorldState()}${renderRelationships()}${renderLatestChanges()}${renderRisks()}</aside>
    </div>`;
  bindGameEvents();
}

function renderTopbar() {
  const day = dayScripts[runtime.currentDay];
  return `<header class="topbar"><div class="top-chip location">${esc(runtime.location)}</div><div class="top-chip day">第 ${runtime.currentDay} 天　${esc(day?.theme || "裁决")}</div><div class="top-title">距离御前裁决：<strong>${Math.max(0, runtime.totalDays - runtime.currentDay)} 天</strong></div><div class="top-actions"><button class="top-btn" onclick="navigate('/')">大厅</button><button class="top-btn" onclick="resetRuntime(); navigate('/game/sangtian')">重开</button></div></header>`;
}

function renderPlayerCard() {
  const role = roleList[0];
  return `<section class="side-card player-card"><h2>我的信息</h2><div class="profile-row"><div class="portrait portrait-governor">督</div><div><div class="role-name">${role.name}</div><div class="role-person">${role.person}</div><div class="role-tags"><span>${role.title}</span></div></div></div></section>`;
}

function renderGoals() {
  return `<section class="side-card"><h2>当前目标</h2><ul class="compact-list"><li>稳住浙江局势</li><li>控制巡抚势力</li><li>避免皇帝生疑</li><li>尽量提高最终下场</li></ul></section>`;
}

function renderResources() {
  const items = [["银两", "42 万两"], ["粮草", "23 万石"], ["兵丁", "4/5"], ["幕僚", "4 人"], ["密报", `${runtime.hiddenThreads.length + 2} 条`]];
  return `<section class="side-card"><h2>我的资源</h2><div class="resource-list">${items.map(([k, v]) => `<div class="resource-row"><span>${k}</span><strong>${v}</strong></div>`).join("")}</div></section>`;
}

function renderLeverage() {
  const clues = [...new Set([...runtime.clues, ...runtime.hiddenThreads.map((t) => t.title)])].slice(0, 6);
  return `<section class="side-card leverage-card"><h2>我的筹码</h2><ul class="chip-list">${clues.map((item) => `<li>${esc(item)}</li>`).join("")}</ul><div class="seal-watermark">浙</div></section>`;
}

function renderMessageStream() {
  return `<section class="scroll-panel message-panel"><div class="panel-head"><h1>剧情消息流</h1><select><option>全部</option><option>私密</option><option>决策</option></select></div><div class="message-list" id="messageList">${runtime.messages.map(renderMessage).join("")}</div></section>`;
}

function renderMessage(message) {
  if (message.type === "day_divider") return `<div class="day-divider"><span>${esc(message.title)}</span><small>${esc(message.narrative)}</small></div>`;
  const label = message.label || message.type;
  return `<article class="message-card ${message.type}"><div class="msg-avatar ${message.type}">${esc((message.speaker || label || "系").slice(0, 1))}</div><div class="msg-body"><div class="msg-meta"><span class="msg-badge">${esc(label)}</span>${message.speaker ? `<span class="msg-actor">${esc(message.speaker)}</span>` : ""}<span class="msg-time">第 ${message.day} 天 · ${esc(message.time || "")}</span></div><h3>${esc(message.title)}</h3><p>${esc(message.narrative)}</p></div></article>`;
}

function renderDecisionPanel(activeDecision) {
  if (runtime.gameComplete) return `<section class="decision-panel complete"><h2>御前裁决已定</h2><p>本局已经完成。你可以查看结局，也可以重开一局。</p><div class="decision-actions"><button onclick="navigate('/ending/sangtian')" class="submit-btn">查看结局</button><button onclick="resetRuntime(); render()" class="ghost-btn">重开一局</button></div></section>`;
  if (!activeDecision) return `<section class="decision-panel"><h2>今日暂无待决策消息</h2><p>你已处理今日关键事件，可以进入日终回响并推进到下一天。</p><div class="decision-actions"><span class="hint">每天最多处理 1-3 次关键决策，MVP 当前使用每日 1 次核心决策。</span><button onclick="storyEngine.advanceDay(); render()" class="submit-btn">进入明日</button></div></section>`;
  if (activeDecision.resolved || runtime.decisionLocked) return `<section class="decision-panel"><h2>今日关键决策已提交</h2><p>你的选择已经进入局势推演。可以进入日终回响，继续推进到下一天。</p><div class="decision-actions"><button onclick="storyEngine.advanceDay(); render()" class="submit-btn">进入明日</button></div></section>`;
  const selected = activeDecision.options.find((opt) => opt.key === selectedOption) || activeDecision.options[0];
  return `<section class="decision-panel"><div class="decision-title"><h2>你要如何应对？</h2><span>当前事件：${esc(activeDecision.title)}</span></div><div class="option-list">${activeDecision.options.map((item) => `<button class="decision-option ${selectedOption === item.key ? "active" : ""}" data-option="${item.key}"><div class="option-main"><strong>${item.key}. ${esc(item.title)}</strong><span>${esc(item.description)}</span></div><div class="option-effects"><span class="gain">可能收益：${esc(item.gain)}</span><span class="risk">可能风险：${esc(item.risk)}</span></div></button>`).join("")}<button class="decision-option ${selectedOption === "CUSTOM" ? "active" : ""}" data-option="CUSTOM"><div class="option-main"><strong>D. 自定义决策</strong><span>自行拟定策略与应对方式。</span></div><div class="option-effects"><span class="gain">可能收益：形成非标准计策</span><span class="risk">可能风险：越权会被拦截</span></div></button></div><textarea id="customDecision" placeholder="如果选择自定义，请输入你的决策内容（可详细说明你的计划）"></textarea><div class="decision-preview"><b>当前选择：</b>${esc(selectedOption === "CUSTOM" ? "自定义决策" : selected?.title || "")}</div><div class="decision-actions"><span class="hint">提交后，AI 将生成结果消息，并更新右侧局势。</span><button id="submitDecision" class="submit-btn">确认此策</button></div></section>`;
}

function renderWorldState() {
  const stats = Object.entries(runtime.worldState).slice(0, 6);
  return `<section class="side-card"><h2>当前局势</h2><div class="stats-list">${stats.map(([k, v]) => `<div class="stat-row"><div class="stat-label"><span>${esc(k)}</span><strong>${v}/100</strong></div><div class="bar"><i class="${barColor(k, v)}" style="width:${v}%"></i></div></div>`).join("")}</div><div class="overall-risk">局势总体风险：<strong>${overallRisk()}</strong></div></section>`;
}

function barColor(key, value) {
  if (["粮价", "皇帝疑心"].includes(key)) return value >= 70 ? "red" : "gold";
  return value >= 60 ? "green" : "gold";
}

function overallRisk() {
  const bad = runtime.worldState.粮价 + runtime.worldState.皇帝疑心 + runtime.roleState.清算风险;
  if (bad >= 230) return "高";
  if (bad >= 175) return "中";
  return "低";
}

function renderRelationships() {
  return `<section class="side-card relation-card"><h2>人物关系</h2>${runtime.relationships.map((person) => `<div class="relation-row"><div class="mini-portrait">${esc(person.avatar)}</div><div class="relation-info"><strong>${esc(person.name)}</strong><span>${esc(person.person)}</span></div><div class="stance ${esc(person.stance)}">${esc(person.stance)} ${person.score}</div></div>`).join("")}</section>`;
}

function renderLatestChanges() {
  return `<section class="side-card"><h2>最新变化</h2><ul class="change-list">${runtime.latestChanges.slice(0, 5).map((line) => `<li>${esc(line)}</li>`).join("")}</ul></section>`;
}

function renderRisks() {
  return `<section class="side-card"><h2>潜在风险</h2><ul class="risk-list">${runtime.risks.map((risk) => `<li>${esc(risk.name)} <b>${esc(risk.level)}</b></li>`).join("")}</ul></section>`;
}

function bindGameEvents() {
  document.querySelectorAll("[data-option]").forEach((node) => node.addEventListener("click", () => {
    selectedOption = node.dataset.option;
    renderGame();
  }));
  const submit = document.getElementById("submitDecision");
  if (submit) submit.addEventListener("click", () => {
    const active = storyEngine.getActiveDecision();
    if (!active) return;
    const custom = document.getElementById("customDecision")?.value.trim() || "";
    if (selectedOption === "CUSTOM") {
      const guard = storyEngine.validateCustomDecision(custom);
      if (!guard.allowed) {
        alert(`${guard.reason}\n\n请改写为你自己的可执行行动。`);
        return;
      }
    }
    storyEngine.resolveDecision(active, selectedOption, custom);
    saveRuntime();
    renderGame();
  });
  const list = document.getElementById("messageList");
  if (list) list.scrollTop = list.scrollHeight;
}

function renderEnding() {
  if (!runtime.gameComplete) {
    while (runtime.currentDay < 7) storyEngine.advanceDay();
    saveRuntime();
  }
  const ending = storyEngine.generateEnding(runtime);
  root.className = "simulator-shell ending-mode";
  root.innerHTML = `<div class="ending-shell"><div class="ending-card"><span class="badge">第 7 天 · 御前裁决</span><h1>${esc(ending.title)}</h1><p>${esc(ending.narrative)}</p><div class="ending-grid"><div><h3>关键三手</h3><ol>${runtime.decisions.slice(-3).map((d) => `<li>第${d.day}天：${esc(d.decisionText)}</li>`).join("") || "<li>暂无关键决策</li>"}</ol></div><div><h3>命运债</h3><p>${runtime.hiddenThreads.length ? esc(runtime.hiddenThreads.map((t) => t.title).join("、")) : "你没有留下明显命运债。"}</p></div></div><div class="hero-actions"><button onclick="resetRuntime(); navigate('/game/sangtian')">重开一局</button><button class="light" onclick="navigate('/')">返回大厅</button></div></div></div>`;
}

function esc(value) {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

window.addEventListener("hashchange", render);
window.navigate = navigate;
window.startGame = startGame;
window.resetRuntime = resetRuntime;
window.storyEngine = storyEngine;
render();
