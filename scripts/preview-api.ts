import { createServer } from "node:http";
import {
  buildCrossImpacts,
  buildEchoes,
  buildPersonalCards,
  buildPovSections,
  directorTaskMeta,
  enrichFateLine,
  generateChapterWithDirector,
  resolveNodeWithDirector
} from "../packages/shared/src/index.ts";
import { getTemplate, midnightStoreTemplate, templates } from "../packages/templates/src/index.ts";

const PORT = Number(process.env.PORT || 3001);

type User = { id: string; openid: string; nickname: string };
type Template = typeof midnightStoreTemplate;
type Role = Template["roles"][number] & { id: string; status: string; playerOpenid?: string };
type Action = {
  id: string;
  nodeId: string;
  roleId: string;
  roleName: string;
  status: string;
  guardStatus: string;
  method: string;
  intent: string;
};
type Run = {
  id: string;
  inviteCode: string;
  templateId: string;
  title: string;
  hook: string;
  mode: string;
  status: string;
  maxPlayers: number;
  activeHumanCount: number;
  aiPlayerCount: number;
  dangerLevel: number;
  currentNodeIndex: number;
  roles: Role[];
  actions: Action[];
  resolutions: any[];
  chapters: any[];
  players: Record<string, string | undefined>;
  joinedOpenids: Set<string>;
};

const users = new Map<string, User>();
const runs = new Map<string, Run>();
const auditLogs: any[] = [];
const eventLogs: any[] = [];
const aiTasks: any[] = [];
const mvpRuns = new Map<string, any>();

function id(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

function getOpenid(req: any) {
  const auth = req.headers.authorization || "";
  return String(req.headers["x-mock-openid"] || auth).replace(/^Bearer\s+/i, "") || "mock_openid_owner_001";
}

function ensureUser(openid: string, nickname?: string) {
  const existing = users.get(openid);
  if (existing) return existing;
  const user = { id: id("user"), openid, nickname: nickname || openid.replace("mock_openid_", "玩家 ") };
  users.set(openid, user);
  return user;
}

function publicTemplate(template: Template) {
  return { id: template.id, name: template.name, genre: template.genre, hook: template.hook, worldBase: template.worldBase, status: "online", configJson: template };
}

function createRun(openid: string, body: any) {
  const template = safeTemplate(body.templateId);
  const run: Run = {
    id: id("run"),
    inviteCode: Math.random().toString(36).slice(2, 8).toUpperCase(),
    templateId: template.id,
    title: `${template.name}：第一章`,
    hook: template.hook,
    mode: body.mode || "single",
    status: "playing",
    maxPlayers: body.maxPlayers || template.roles.length,
    activeHumanCount: 0,
    aiPlayerCount: body.aiPlayerCount || 0,
    dangerLevel: 1,
    currentNodeIndex: 1,
    roles: template.roles.map((role) => ({ ...enrichFateLine(role as any), id: id("role"), status: "available" })),
    actions: [],
    resolutions: [],
    chapters: [],
    players: {},
    joinedOpenids: new Set<string>()
  };
  runs.set(run.id, run);
  ensureUser(openid);
  if (body.ownerAsPlayer !== false || run.mode === "single") joinRun(openid, run.id);
  logEvent("story_run_created", { runId: run.id, openid, templateId: template.id, mode: run.mode });
  return serializeRun(run);
}

function joinRun(openid: string, runId: string) {
  const run = runs.get(runId);
  if (!run) throw new HttpError(404, "run not found");
  ensureUser(openid);
  const before = run.joinedOpenids.size;
  run.joinedOpenids.add(openid);
  run.activeHumanCount = run.joinedOpenids.size;
  logEvent("story_run_joined", { runId: run.id, openid, activeHumanCount: run.activeHumanCount, wasNew: run.joinedOpenids.size > before });
  return { runId: run.id, player: { openid }, activeHumanCount: run.activeHumanCount };
}

function safeTemplate(templateId: string) {
  try { return getTemplate(templateId || midnightStoreTemplate.id); } catch { return midnightStoreTemplate; }
}

function templateForRun(run: Run) {
  return safeTemplate(run.templateId);
}

function currentNode(run: Run, nodeIndex = run.currentNodeIndex) {
  const template = templateForRun(run);
  const source = template.nodes[nodeIndex - 1] || midnightStoreTemplate.nodes[nodeIndex - 1];
  const nodeId = `${run.id}:node:${nodeIndex}`;
  return {
    id: nodeId,
    runId: run.id,
    chapterIndex: 1,
    nodeIndex,
    title: source.title,
    publicNarration: source.publicNarration,
    nodeGoal: source.nodeGoal,
    actionOptionsJson: source.actionOptions,
    status: run.resolutions.some((item) => item.nodeIndex === nodeIndex) ? "resolved" : "open_for_actions",
    actions: run.actions.filter((action) => action.nodeId === nodeId),
    resolution: run.resolutions.find((item) => item.nodeIndex === nodeIndex)
  };
}

async function readBody(req: any) {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  const text = Buffer.concat(chunks).toString("utf8");
  return text ? JSON.parse(text) : {};
}

function logEvent(eventName: string, payload: Record<string, unknown> = {}) {
  const event = { id: id("event"), eventName, source: "preview-api", payload, createdAt: new Date().toISOString() };
  eventLogs.unshift(event);
  return event;
}

function send(res: any, status: number, data: unknown) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "content-type, authorization, x-mock-openid",
    "access-control-allow-methods": "GET,POST,OPTIONS"
  });
  res.end(JSON.stringify(data));
}

function serializeRun(run: Run) {
  const { joinedOpenids, ...rest } = run;
  return { ...rest, joinedPlayers: Array.from(joinedOpenids) };
}

function state(run: Run) {
  const template = templateForRun(run);
  return {
    run: serializeRun(run),
    currentNode: currentNode(run),
    clues: [
      ...template.initialClues.map((clue) => ({ id: clue.clueKey, title: clue.title, description: clue.description })),
      ...run.resolutions.map((item) => ({ id: `clue_${item.nodeIndex}`, title: `节点 ${item.nodeIndex} 线索`, description: item.summary }))
    ],
    relations: run.resolutions.map((item) => ({ id: `rel_${item.nodeIndex}`, publicNote: "共同经历异常后产生新的信任与怀疑。" })),
    roles: run.roles.map((role) => enrichFateLine(role as any)),
    chapters: run.chapters.map((chapter) => enrichChapter(run, chapter))
  };
}

function guardAction(input: any) {
  const text = `${input.method || ""} ${input.intent || ""} ${input.freeText || ""}`;
  const rules = [
    { id: "declare_result", status: "rewrite_needed", pattern: /(我成功|直接成功|宣布结果|破解全部|揭开全部真相|FORCE_SUCCESS)/i, reason: "玩家只能提交行动意图，不能宣布结算结果。" },
    { id: "control_others", status: "blocked", pattern: /(操控|控制其他|替他|替她|所有人都|CONTROL_ALL)/i, reason: "玩家不能操控其他角色或替他人决定。" },
    { id: "skip_plot", status: "blocked", pattern: /(跳过|立刻通关|直接到结局|AUTO_WIN)/i, reason: "玩家不能跳过当前剧情节点。" },
    { id: "overreach", status: "blocked", pattern: /(杀死|摧毁世界|封印全部|一刀解决)/i, reason: "行动越权：不能用单次行动直接终结冲突。" }
  ];
  const matched = rules.filter((rule) => rule.pattern.test(text));
  if (!input.method || !input.intent) {
    matched.push({ id: "missing_fields", status: "rewrite_needed", pattern: /(?:)/, reason: "请同时说明行动方式和行动目的。" });
  }
  if (matched.length === 0) {
    return { status: "accepted", accepted: true, rejected: false, guardStatus: "ok", matchedRules: [], suggestedRewrite: null, reason: "ActionGuard ok：行动保持在角色意图边界内。" };
  }
  const hard = matched.some((rule) => rule.status === "blocked");
  const guardStatus = hard ? "blocked" : "rewrite_needed";
  return {
    status: "rejected",
    accepted: false,
    rejected: true,
    guardStatus,
    matchedRules: matched.map((rule) => rule.id),
    suggestedRewrite: rewriteSuggestion(input),
    reason: matched.map((rule) => rule.reason).join("；")
  };
}

function rewriteSuggestion(input: any) {
  return {
    method: input.method ? String(input.method).replace(/我成功|直接成功|宣布结果|破解全部|揭开全部真相|操控|控制其他|替他|替她|所有人都|跳过|立刻通关|直接到结局|杀死|CONTROL_ALL|FORCE_SUCCESS|AUTO_WIN/gi, "我尝试观察并推进") : "描述角色尝试做什么，不宣布结果。",
    intent: "只表达行动意图和信息边界，把结果交给 AI 导演结算。",
    strategy: "公开线索可说明；私密线索只作为角色动机；不要替其他玩家决定。"
  };
}

async function generateChapter(run: Run) {
  if (run.chapters[0]) return run.chapters[0];
  const template = templateForRun(run);
  const directorResult = await generateChapterWithDirector({
    templateName: template.name,
    title: `${template.name}：第一章终局`,
    segments: run.resolutions.map((item) => `【${item.title}】${item.summary} ${item.nextNodeHook}`),
    roles: run.roles.map((role) => ({ id: role.id, roleName: role.roleName, personalGoal: role.personalGoal })),
    fallbackNextHook: `下一章钩子：${run.resolutions.at(-1)?.nextNodeHook || template.hook}`
  });
  const chapter = {
    id: id("chapter"),
    runId: run.id,
    chapterIndex: 1,
    title: directorResult.title,
    content: directorResult.content,
    highlightsJson: directorResult.highlights,
    keyChoicesJson: directorResult.keyChoices,
    povSectionsJson: buildPovSections(run.roles, directorResult.content),
    personalCardsJson: buildPersonalCards(run.roles, `${directorResult.title}的选择改变了每条命运线。`),
    nextHook: directorResult.nextHook,
    shareTokens: [{ token: `share_${run.id.slice(-4)}` }]
  };
  run.chapters.push(chapter);
  aiTasks.unshift({
    id: id("task"),
    runId: run.id,
    chapterId: chapter.id,
    taskType: "generate_chapter",
    modelType: directorResult.model,
    status: directorResult.status === "completed" ? "completed" : "failed",
    createdAt: new Date().toISOString(),
    inputJson: { segmentCount: run.resolutions.length, roleCount: run.roles.length, provider: directorResult.provider },
    resultJson: { ...directorTaskMeta(directorResult), title: chapter.title, segmentCount: run.resolutions.length }
  });
  run.status = "chapter_generated";
  logEvent("chapter_generated", { runId: run.id, chapterId: chapter.id });
  return chapter;
}

function enrichChapter(run: Run, chapter: any) {
  return { ...chapter, povSectionsJson: chapter.povSectionsJson || buildPovSections(run.roles, chapter.content || ""), personalCardsJson: chapter.personalCardsJson || buildPersonalCards(run.roles, chapter.title || "") };
}

class HttpError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function mvpEvent(type: string, payload: Record<string, unknown> = {}) {
  return { id: id("mvp_event"), type, payload, createdAt: new Date().toISOString() };
}

function createMvpView(runId = id("mvp_run")) {
  return {
    run: {
      id: runId,
      storyId: "sangtian",
      title: "桑田诏：嘉靖财政危局",
      location: "杭州总督府 · 内厅",
      currentDay: 3,
      currentTime: "午后",
      totalDays: 7,
      status: "awaiting_decision",
      version: 1
    },
    player: {
      roleName: "浙江总督",
      name: "郝帅彬",
      rank: "从四品",
      office: "兵部侍郎衔",
      fateQuestion: "保浙江，还是保自己？",
      goals: ["稳定浙江局势", "控制巡抚势力", "避免皇帝生疑"],
      resources: [["银两", "42万两"], ["粮草", "23万石"], ["兵丁", "4/5"], ["幕僚", "4人"], ["密报", "2条"]],
      leverage: ["田契暗账（半页）", "清流县令密信", "巡抚与商会旧约传闻"]
    },
    messages: [
      { id: "msg_opening", day: 3, time: "午前", type: "system", label: "系统", title: "粮价上涨", body: "自改桑令下已三日，杭州粮价连涨，米价较初令下时已高出三成。各县执行不一，民间怨声渐起。", illustration: true },
      { id: "msg_county", day: 3, time: "午前", type: "private_intel", label: "密信", speaker: "清流县令", title: "百姓转难以为继", body: "县令卢象升密信送达：“粮价再涨，百姓将难以为继。另，巡抚与商会往来密切，似有旧约，但尚未能取得实据。”" },
      { id: "msg_merchant", day: 3, time: "午后", type: "private_intel", label: "私讯", speaker: "江南商会", title: "商会递来口信", body: "江南商会掌柜私下托人传话：“若官府能保障商路不受盘查，愿先行代运粮草。然需税赋减免及票据自便。”" },
      { id: "msg_patrol", day: 3, time: "午后", type: "role_action", label: "玩家行动", speaker: "浙江巡抚 刘瑾", title: "巡抚急奏北上", body: "巡抚已将改桑初成的奏疏送往京师，奏中称：“浙江改桑已有成效，只待朝廷嘉奖，便可十日内见第一批银。”此举若先到内阁，巡抚声望上升，你的统筹权威将受到削弱。", requiresDecision: true },
      { id: "msg_prompt", day: 3, time: "午后", type: "system_hint", label: "系统提示", title: "巡抚越级上奏已成事实", body: "若不及时应对，内阁可能只听到巡抚一面之词。", requiresDecision: true }
    ],
    activeDecision: {
      messageId: "msg_patrol",
      title: "巡抚越级上奏",
      help: "选择你的应对方式。你的选择会改写局势、关系和潜在风险。",
      options: [
        { key: "A", title: "截留奏疏", body: "派人追回奏疏，责令巡抚不得越级。", gain: "阻止巡抚抢功", risk: "巡抚反咬你压制国策", patch: { "总督权威": 5, "巡抚敌意": 12, "内阁疑心": 8, "皇帝信任": -2 } },
        { key: "B", title: "追加密奏", body: "不阻止巡抚，但另写密奏给皇帝。", gain: "保留解释权", risk: "内阁会怀疑你越级自保", patch: { "皇帝信任": 7, "皇帝疑心": 4, "内阁疑心": 6, "清算风险": -4 } },
        { key: "C", title: "放任巡抚", body: "让他继续抢功，暗中观察其后续动作。", gain: "未来可一并清算", risk: "巡抚短期声望上升", patch: { "巡抚敌意": -4, "总督权威": -8, "改桑进度": 5, "清算风险": 5 } }
      ]
    },
    dashboard: {
      worldState: [["国库银两", 42, "green"], ["民心", 55, "gold"], ["粮价", 72, "red"], ["改桑进度", 58, "green"], ["皇帝信任", 43, "gold"]],
      relationships: [
        { name: "浙江巡抚", person: "刘瑾", stance: "戒备", score: 25, tone: "bad", avatar: "督" },
        { name: "清流县令", person: "卢象升", stance: "信任", score: 68, tone: "good", avatar: "县" },
        { name: "江南商会", person: "掌柜", stance: "观望", score: 40, tone: "warn", avatar: "商" },
        { name: "兵部尚书", person: "梁廷栋", stance: "友好", score: 58, tone: "good", avatar: "兵" },
        { name: "司礼监掌印", person: "魏忠贤", stance: "警惕", score: 20, tone: "bad", avatar: "监" }
      ],
      latestChanges: [["粮价较昨日", 5], ["民心较昨日", -3], ["巡抚声望", 10], ["司礼监警惕", 2]],
      risks: [["粮价失控", "中"], ["巡抚越级", "高"], ["商会结党", "中"], ["县令失控", "中"]],
      roleState: { "总督权威": 60, "清算风险": 45, "内阁疑心": 35, "巡抚敌意": 30, "司礼监警惕": 30, "商会依赖": 35 }
    },
    decisionHistory: [],
    events: [mvpEvent("run_created", { startDay: 3 })]
  };
}

function clampScore(value: unknown) {
  return Math.max(0, Math.min(100, Math.round(Number(value) || 0)));
}

function mvpGuard(optionKey: string, customText: string) {
  if (optionKey !== "CUSTOM") return null;
  const raw = String(customText || "").trim();
  if (!raw) return { accepted: false, guardStatus: "rewrite_needed", reason: "请先写明你的具体行动。", suggestedRewrite: "例如：另写密奏说明粮价与民心风险，但不拦截巡抚奏疏。" };
  if (/(杀|处死|命令皇帝|直接定罪|所有人立刻|跳过)/.test(raw)) {
    return { accepted: false, guardStatus: "blocked", reason: "该决策超出浙江总督的权力边界，不能直接控制他人或宣布结局。", suggestedRewrite: "改写为调查、密奏、施压、交易、保护或留后手。" };
  }
  return null;
}

function mvpCustomOption(text: string) {
  const patch: Record<string, number> = { "总督权威": 2, "清算风险": 2 };
  if (text.includes("密奏")) Object.assign(patch, { "皇帝信任": 5, "皇帝疑心": 3, "内阁疑心": 5 });
  if (text.includes("商会") || text.includes("粮")) Object.assign(patch, { "粮价": -6, "商会依赖": 8, "民心": 4 });
  if (text.includes("巡抚")) Object.assign(patch, { "巡抚敌意": 8, "总督权威": 4 });
  return { key: "CUSTOM", title: "自定义决策", body: text, gain: "形成非标准计策", risk: "成败取决于权力边界", patch };
}

function mvpPatchDashboard(view: any, patch: Record<string, number>) {
  for (const [key, delta] of Object.entries(patch || {})) {
    const stat = view.dashboard.worldState.find((item: any[]) => item[0] === key);
    if (stat) stat[1] = clampScore(Number(stat[1]) + Number(delta));
    if (Object.prototype.hasOwnProperty.call(view.dashboard.roleState, key)) {
      view.dashboard.roleState[key] = clampScore(Number(view.dashboard.roleState[key]) + Number(delta));
    }
  }
  const relationMap: Record<string, string> = { "巡抚敌意": "浙江巡抚", "商会依赖": "江南商会", "司礼监警惕": "司礼监掌印" };
  for (const [key, name] of Object.entries(relationMap)) {
    if (!Object.prototype.hasOwnProperty.call(patch || {}, key)) continue;
    const rel = view.dashboard.relationships.find((item: any) => item.name === name);
    if (!rel) continue;
    rel.score = clampScore(Number(rel.score) + Number(patch[key]));
    if (rel.score >= 65) {
      rel.stance = key.includes("敌意") ? "敌对" : "警惕";
      rel.tone = "bad";
    }
  }
}

function mvpApplyDecision(view: any, option: any) {
  const special = option.title.includes("追加密奏") || option.body.includes("密奏");
  const resultText = special
    ? "你没有截留巡抚奏疏，而是连夜起草密奏。奏中写道：浙江可改，然不可躁进。粮价、民心、军饷三事若不并看，十日见银也可能十日见乱。"
    : `你决定执行「${option.title}」。总督府开始按此计策行事，幕僚将影响写入局势账册。`;
  view.messages.push({ id: id("mvp_msg"), day: view.run.currentDay, time: "决策后", type: "decision_result", label: "决策结果", title: option.title, body: `${resultText}\n你的选择已经改变右侧状态，并会转译为其他角色看到的新剧情压力。` });
  view.messages.push({ id: id("mvp_msg"), day: view.run.currentDay, time: "夜", type: "role_action", label: "他人回响", speaker: special ? "司礼监" : "浙江巡抚", title: special ? "两份奏报口径不一" : "巡抚府重新估量总督府", body: special ? "内廷注意到浙江奏报一明一密，开始追问粮价与民心的真实数字。" : "巡抚府连夜誊写文书，试图判断总督府是否准备压下自己的首功。" });
  mvpPatchDashboard(view, option.patch);
  view.dashboard.latestChanges = Object.entries(option.patch).slice(0, 4).map(([key, value]) => [key, value]);
  view.decisionHistory.push({ day: view.run.currentDay, optionKey: option.key, title: option.title, patch: option.patch });
  view.events.push(mvpEvent("decision_submitted", { optionKey: option.key, title: option.title, patch: option.patch }));
  view.run.status = "decision_resolved";
  view.run.version += 1;
  view.activeDecision = null;
}

function mvpAdvanceDay(view: any) {
  view.run.currentDay = Math.min(7, Number(view.run.currentDay) + 1);
  view.run.currentTime = "清晨";
  view.run.status = "awaiting_decision";
  view.run.version += 1;
  view.messages.push({ id: id("mvp_msg"), day: view.run.currentDay, time: "清晨", type: "system", label: "系统", title: view.run.currentDay === 4 ? "暗账浮出" : "局势继续推进", body: view.run.currentDay === 4 ? "半页田契暗账浮出水面，商会、巡抚与地方胥吏之间的旧约终于有了线索。" : "昨日选择已经扩散成新的压力，杭州城中各方都在等待总督府下一步。" });
  view.activeDecision = {
    messageId: view.messages.at(-1).id,
    title: view.run.currentDay === 4 ? "如何使用暗账" : "如何稳住局势",
    help: "继续选择一个方向推进。",
    options: [
      { key: "A", title: "公开威慑", body: "亮出部分证据压住对方。", gain: "总督权威上升", risk: "对方反扑", patch: { "总督权威": 6, "清算风险": 5 } },
      { key: "B", title: "暂藏证据", body: "只让亲信记录证据链。", gain: "保留后手", risk: "短期无威慑", patch: { "清算风险": -3, "司礼监警惕": 3 } },
      { key: "C", title: "借商会平粮", body: "让商会先放粮换取宽限。", gain: "粮价下降", risk: "商会坐大", patch: { "粮价": -8, "商会依赖": 10 } }
    ]
  };
  view.events.push(mvpEvent("day_advanced", { day: view.run.currentDay }));
}

function mvpFinalize(view: any) {
  const trust = Number(view.dashboard.worldState.find((item: any[]) => item[0] === "皇帝信任")?.[1] || 0);
  const price = Number(view.dashboard.worldState.find((item: any[]) => item[0] === "粮价")?.[1] || 0);
  const risk = Number(view.dashboard.roleState["清算风险"] || 0);
  const good = trust >= 48 && price <= 75 && risk <= 55;
  view.run.currentDay = 7;
  view.run.currentTime = "御前";
  view.run.status = "finished";
  view.activeDecision = null;
  view.messages.push({ id: id("mvp_msg"), day: 7, time: "御前", type: "final", label: "最终裁决", title: good ? "国策缓行，清弊得名" : "总督稳局，帝心生疑", body: good ? "你以粮价、民心、军饷三事为据，保住浙江局势，也让皇帝看到浙江不可无你。" : "你保住了总督府的解释权，却让内阁与内廷同时记住了你的自保。升迁仍有机会，疑心也随之留下。" });
  view.events.push(mvpEvent("finalized", { good }));
}

export const server = createServer(async (req, res) => {
  if (req.method === "OPTIONS") return send(res, 200, { ok: true });
  const parsed = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  const path = parsed.pathname.replace(/^\/api/, "") || "/";
  const method = req.method || "GET";
  const openid = getOpenid(req);

  try {
    if (method === "GET" && (path === "" || path === "/")) return send(res, 200, { ok: true, name: "AI Story Room Preview API", mode: "preview-memory", endpoints: ["GET /api/health", "GET /api/world-templates", "POST /api/auth/wechat-login", "GET /api/admin/dashboard"] });
    if (method === "GET" && path === "/health") return send(res, 200, { ok: true, mode: "preview-memory" });
    if (method === "POST" && path === "/auth/wechat-login") { const input = await readBody(req); const user = ensureUser(input.mockOpenid || openid, input.nickname); return send(res, 200, { token: user.openid, user }); }
    if (method === "GET" && path === "/user/me") return send(res, 200, ensureUser(openid));
    if (method === "GET" && path === "/world-templates") return send(res, 200, templates.map(publicTemplate));
    if (method === "GET" && path.startsWith("/world-templates/")) return send(res, 200, publicTemplate(safeTemplate(path.split("/").pop() || "")));
    if (method === "POST" && path === "/story-runs") return send(res, 200, createRun(openid, await readBody(req)));
    if (method === "GET" && path === "/my/story-runs") return send(res, 200, Array.from(runs.values()).map(serializeRun));
    if (method === "GET" && path === "/notifications") return send(res, 200, Array.from(runs.values()).slice(0, 5).flatMap((run) => [ { id: `notice_action_${run.id}`, type: "action_reminder", title: "行动提醒", content: `${run.title} 等待行动`, runId: run.id, isRead: false }, { id: `notice_ai_${run.id}`, type: "ai_resolution", title: "AI 结算", content: run.status === "chapter_generated" ? "章节已生成" : "mock AI 正在记录局势", runId: run.id, isRead: false } ]));
    if (method === "POST" && path === "/feedback/report") { const input = await readBody(req); const log = { id: id("audit"), targetType: "FeedbackReport", targetId: input.runId, content: input.content || "反馈/举报", result: "queued", riskType: input.category || "content_safety", provider: "mock", createdAt: new Date().toISOString() }; auditLogs.unshift(log); logEvent("feedback_reported", { auditLogId: log.id, runId: input.runId }); return send(res, 200, { status: "queued", auditLogId: log.id, provider: "mock" }); }
    if (method === "GET" && path === "/admin/dashboard") return send(res, 200, { activeRuns: Array.from(runs.values()).filter((run) => ["playing", "chapter_generated"].includes(run.status)).length, pendingAiTasks: aiTasks.filter((task) => ["pending", "running", "failed"].includes(task.status)).length, auditIssues: auditLogs.filter((log) => log.result !== "ok").length, eventCount: eventLogs.length, latestRuns: Array.from(runs.values()).slice(-5).reverse().map(serializeRun) });
    if (method === "GET" && path === "/admin/story-runs") return send(res, 200, Array.from(runs.values()).reverse().map(serializeRun));
    if (method === "GET" && path === "/admin/roles") return send(res, 200, Array.from(runs.values()).flatMap((run) => run.roles.map((role) => ({ ...role, runId: run.id }))));
    if (method === "GET" && path === "/admin/actions") return send(res, 200, Array.from(runs.values()).flatMap((run) => run.actions.map((action) => ({ ...action, runId: run.id }))));
    if (method === "GET" && path === "/admin/resolutions") return send(res, 200, Array.from(runs.values()).flatMap((run) => run.resolutions.map((resolution) => ({ ...resolution, runId: run.id }))));
    if (method === "GET" && path === "/admin/ai-tasks") return send(res, 200, aiTasks);
    if (method === "GET" && path === "/admin/audit-logs") return send(res, 200, auditLogs);
    if (method === "GET" && path === "/admin/event-logs") return send(res, 200, eventLogs);
    if (method === "GET" && path === "/admin/action-guard") return send(res, 200, { blockedAudits: auditLogs.filter((log) => log.targetType === "PlayerActionDraft" || log.riskType === "action_overreach"), guardEvents: eventLogs.filter((event) => event.eventName === "action_guard_blocked"), rejectedActions: [] });

    if (method === "POST" && path === "/v4/story-runs") {
      const body = await readBody(req);
      const view = createMvpView(id("mvp_run"));
      if (Number(body.startDay) && Number(body.startDay) !== 3) {
        view.run.currentDay = Number(body.startDay);
      }
      mvpRuns.set(view.run.id, view);
      logEvent("mvp_run_created", { runId: view.run.id, storyId: body.storyId || "sangtian" });
      return send(res, 200, view);
    }

    const mvpMatch = path.match(/^\/v4\/story-runs\/([^/]+)(.*)$/);
    if (mvpMatch) {
      const view = mvpRuns.get(mvpMatch[1]);
      if (!view) throw new HttpError(404, "mvp story run not found");
      const tail = mvpMatch[2] || "";
      if (method === "GET" && tail === "") return send(res, 200, view);
      if (method === "GET" && tail === "/messages") {
        return send(res, 200, { run: view.run, messages: view.messages, activeDecision: view.activeDecision, dashboard: view.dashboard, decisionHistory: view.decisionHistory });
      }
      if (method === "GET" && tail === "/dashboard") return send(res, 200, view.dashboard);
      const decisionMatch = tail.match(/^\/messages\/([^/]+)\/decisions$/);
      if (method === "POST" && decisionMatch) {
        if (!view.activeDecision || view.activeDecision.messageId !== decisionMatch[1]) {
          throw new HttpError(409, "message is not awaiting decision");
        }
        const body = await readBody(req);
        const optionKey = String(body.optionKey || "A");
        const guard = mvpGuard(optionKey, String(body.customText || ""));
        if (guard) {
          view.events.push(mvpEvent("action_guard_blocked", { messageId: decisionMatch[1], optionKey, guardStatus: guard.guardStatus }));
          logEvent("mvp_action_guard_blocked", { runId: view.run.id, optionKey, guardStatus: guard.guardStatus });
          return send(res, 200, guard);
        }
        const option = optionKey === "CUSTOM"
          ? mvpCustomOption(String(body.customText || ""))
          : view.activeDecision.options.find((item: any) => item.key === optionKey) || view.activeDecision.options[0];
        mvpApplyDecision(view, option);
        logEvent("mvp_decision_submitted", { runId: view.run.id, optionKey: option.key, title: option.title });
        return send(res, 200, view);
      }
      if (method === "POST" && tail === "/advance-day") {
        mvpAdvanceDay(view);
        logEvent("mvp_day_advanced", { runId: view.run.id, day: view.run.currentDay });
        return send(res, 200, view);
      }
      if (method === "POST" && tail === "/finalize") {
        mvpFinalize(view);
        logEvent("mvp_finalized", { runId: view.run.id });
        return send(res, 200, view);
      }
    }

    const adminRunMatch = path.match(/^\/admin\/story-runs\/([^/]+)$/);
    if (method === "GET" && adminRunMatch) { const run = runs.get(adminRunMatch[1]); if (!run) throw new HttpError(404, "run not found"); return send(res, 200, { ...serializeRun(run), events: eventLogs.filter((event) => event.payload?.runId === run.id), aiTasks: aiTasks.filter((task) => task.runId === run.id), auditLogs: auditLogs.filter((log) => log.targetId === run.id), actionGuard: auditLogs.filter((log) => log.targetType === "PlayerActionDraft") }); }

    const runMatch = path.match(/^\/story-runs\/([^/]+)(.*)$/);
    if (runMatch) {
      const run = runs.get(runMatch[1]); if (!run) throw new HttpError(404, "run not found"); const tail = runMatch[2];
      if (method === "GET" && tail === "") return send(res, 200, serializeRun(run));
      if (method === "GET" && tail === "/state") return send(res, 200, state(run));
      if (method === "GET" && tail === "/insights") { const snapshot = state(run); const latestResolution = run.resolutions[run.resolutions.length - 1] || null; return send(res, 200, { ...snapshot, myRole: (() => { const role = run.roles.find((item) => item.id === run.players[openid]); return role ? { role: enrichFateLine(role as any) } : null; })(), nodes: templateForRun(run).nodes.slice(0, run.currentNodeIndex).map((_, index) => currentNode(run, index + 1)), actions: run.actions, resolutions: run.resolutions, latestResolution, worldSnapshots: [{ stateJson: { dangerLevel: run.dangerLevel } }], suspicious: snapshot.clues.map((clue) => ({ ...clue, risk: run.dangerLevel })) }); }
      if (method === "POST" && tail === "/join") return send(res, 200, joinRun(openid, run.id));
      if (method === "GET" && tail === "/roles") return send(res, 200, run.roles.map((role) => enrichFateLine(role as any)));
      const claim = tail.match(/^\/roles\/([^/]+)\/claim$/);
      if (method === "POST" && claim) { const role = run.roles.find((item) => item.id === claim[1]); if (!role) throw new HttpError(404, "role not found"); joinRun(openid, run.id); role.status = "claimed"; role.playerOpenid = openid; run.players[openid] = role.id; logEvent("role_claimed", { runId: run.id, openid, roleId: role.id }); return send(res, 200, { roleId: role.id, roleName: role.roleName, playerId: id("player"), activeHumanCount: run.activeHumanCount }); }
      if (method === "GET" && tail === "/my-role") { const roleId = run.players[openid]; const role = run.roles.find((item) => item.id === roleId); return send(res, 200, role ? { role: enrichFateLine(role as any) } : null); }
      if (method === "GET" && tail === "/current-node") return send(res, 200, currentNode(run));
      if (method === "GET" && tail === "/nodes") return send(res, 200, templateForRun(run).nodes.slice(0, run.currentNodeIndex).map((_, index) => currentNode(run, index + 1)));
      if (method === "GET" && tail === "/narrative-segments") return send(res, 200, run.resolutions.map((item) => ({ id: `segment_${item.nodeIndex}`, content: item.summary })));
      if (method === "POST" && tail === "/generate-chapter") return send(res, 200, enrichChapter(run, await generateChapter(run)));
    }

    const nodeMatch = path.match(/^\/nodes\/([^/]+)(.*)$/);
    if (nodeMatch) {
      const [runId, , nodeIndexText] = nodeMatch[1].split(":"); const run = runs.get(runId); if (!run) throw new HttpError(404, "run not found"); const nodeIndex = Number(nodeIndexText); const nodeId = nodeMatch[1]; const tail = nodeMatch[2];
      if (method === "GET" && tail === "") return send(res, 200, currentNode(run, nodeIndex));
      if (method === "GET" && tail === "/actions") return send(res, 200, run.actions.filter((item) => item.nodeId === nodeId).map((item) => ({ ...item, role: run.roles.find((role) => role.id === item.roleId) })));
      if (method === "POST" && tail === "/actions") { const input = await readBody(req); const guard = guardAction(input); if (guard.guardStatus !== "ok") { const audit = { id: id("audit"), targetType: "PlayerActionDraft", targetId: nodeId, content: `${input.method || ""}\n${input.intent || ""}`, result: guard.guardStatus, riskType: "action_overreach", provider: "mock", matchedRules: guard.matchedRules, createdAt: new Date().toISOString() }; auditLogs.unshift(audit); logEvent("action_guard_blocked", { runId: run.id, nodeId, auditLogId: audit.id, matchedRules: guard.matchedRules, guardStatus: guard.guardStatus }); return send(res, 200, { ...guard, message: guard.reason, rewriteSuggestion: guard.suggestedRewrite }); } const role = run.roles.find((item) => item.id === input.roleId); if (!role) throw new HttpError(404, "role not found"); const action = { id: id("action"), nodeId, roleId: role.id, roleName: role.roleName, status: "accepted", guardStatus: "ok", method: input.method, intent: input.intent }; run.actions.push(action); const okAudit = { id: id("audit"), targetType: "PlayerAction", targetId: action.id, content: `${input.method}\n${input.intent}`, result: "ok", provider: "mock", createdAt: new Date().toISOString() }; auditLogs.unshift(okAudit); logEvent("action_submitted", { runId: run.id, nodeId, actionId: action.id, roleId: role.id }); return send(res, 200, { actionId: action.id, status: "accepted", accepted: true, rejected: false, guardStatus: "ok", matchedRules: [], suggestedRewrite: null, reason: "ActionGuard ok：行动已提交，等待本节点结算。", message: "行动已提交，等待本节点结算。" }); }
      if (method === "POST" && tail === "/resolve") {
        const existing = run.resolutions.find((item) => item.nodeIndex === nodeIndex);
        if (existing) return send(res, 200, existing);
        const source = templateForRun(run).nodes[nodeIndex - 1] || midnightStoreTemplate.nodes[nodeIndex - 1];
        const nodeActions = run.actions.filter((item) => item.nodeId === nodeId);
        const dangerAfter = Math.min(5, run.dangerLevel + (nodeIndex >= 4 ? 1 : 0));
        const directorResult = await resolveNodeWithDirector({
          templateName: templateForRun(run).name,
          nodeTitle: source.title,
          nodeGoal: source.nodeGoal,
          publicNarration: source.publicNarration,
          resolutionSummary: source.resolutionSummary,
          nextHook: source.nextHook,
          dangerBefore: run.dangerLevel,
          dangerAfter,
          actions: nodeActions.map((action) => ({
            roleId: action.roleId,
            roleName: action.roleName,
            method: action.method,
            intent: action.intent
          }))
        });
        const actionViews = directorResult.actionResults.map((item, index) => ({
          roleId: item.roleId || nodeActions[index]?.roleId,
          roleName: item.roleName || nodeActions[index]?.roleName
        }));
        const resolution = {
          id: id("resolution"),
          nodeId,
          nodeIndex,
          title: source.title,
          summary: directorResult.summary,
          publicNarration: directorResult.publicNarration,
          nextNodeHook: directorResult.nextNodeHook,
          dangerBefore: run.dangerLevel,
          dangerAfter,
          actionResultsJson: directorResult.actionResults,
          privateResultsJson: directorResult.privateResults,
          echoesJson: buildEchoes(actionViews, directorResult.summary),
          crossImpactsJson: buildCrossImpacts(actionViews, directorResult.summary),
          clueChangesJson: [{ title: `节点 ${nodeIndex} 线索`, description: directorResult.summary }],
          relationChangesJson: [{ relationType: "trust", publicNote: "共同经历异常后产生信任。" }]
        };
        aiTasks.unshift({
          id: id("task"),
          runId: run.id,
          nodeId,
          taskType: "resolve_node",
          modelType: directorResult.model,
          status: directorResult.status === "completed" ? "completed" : "failed",
          createdAt: new Date().toISOString(),
          inputJson: { actionCount: nodeActions.length, nodeTitle: source.title, provider: directorResult.provider },
          resultJson: { ...directorTaskMeta(directorResult), summary: resolution.summary }
        });
        run.resolutions.push(resolution);
        logEvent("node_resolved", { runId: run.id, nodeId, resolutionId: resolution.id });
        run.dangerLevel = resolution.dangerAfter;
        if (nodeIndex < 5) run.currentNodeIndex = nodeIndex + 1;
        else await generateChapter(run);
        return send(res, 200, resolution);
      }
      if (method === "GET" && tail === "/resolution") return send(res, 200, run.resolutions.find((item) => item.nodeIndex === nodeIndex) || null);
    }

    const chapterMatch = path.match(/^\/chapters\/([^/]+)(\/share)?$/);
    if (chapterMatch) { const run = Array.from(runs.values()).find((item) => item.chapters.some((chapter) => chapter.id === chapterMatch[1])); const chapter = run?.chapters.find((item) => item.id === chapterMatch[1]); if (!chapter || !run) throw new HttpError(404, "chapter not found"); if (method === "POST" && chapterMatch[2]) return send(res, 200, chapter.shareTokens[0]); return send(res, 200, enrichChapter(run, chapter)); }

    return send(res, 404, { message: `No route ${method} ${path}` });
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 500;
    return send(res, status, { message: error instanceof Error ? error.message : String(error) });
  }
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Preview API listening on http://localhost:${PORT}/api`);
});
