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

const PORT = Number(process.env.PREVIEW_API_PORT || process.env.PORT || 3001);

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
