import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { parse } from "node:url";
import { buildCrossImpacts, buildEchoes, buildPersonalCards, buildPovSections, enrichFateLine } from "../packages/shared/src/index.ts";
import { midnightStoreTemplate, templates } from "../packages/templates/src/index.ts";

type User = { id: string; openid: string; nickname: string };
type Role = (typeof midnightStoreTemplate.roles)[number] & { id: string; status: string; playerOpenid?: string };
type Action = {
  id: string;
  nodeId: string;
  roleId: string;
  roleName: string;
  status: string;
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
  dangerLevel: number;
  currentNodeIndex: number;
  roles: Role[];
  actions: Action[];
  resolutions: any[];
  chapters: any[];
  players: Record<string, string | undefined>;
};

const users = new Map<string, User>();
const runs = new Map<string, Run>();
const auditLogs: any[] = [];
const eventLogs: any[] = [];
const aiTasks: any[] = [];

function id(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

function getOpenid(req: IncomingMessage) {
  const auth = req.headers.authorization || "";
  return String(auth).replace(/^Bearer\s+/i, "") || "mock_openid_owner_001";
}

function ensureUser(openid: string, nickname?: string) {
  const existing = users.get(openid);
  if (existing) return existing;
  const user = { id: id("user"), openid, nickname: nickname || openid.replace("mock_openid_", "玩家 ") };
  users.set(openid, user);
  return user;
}

function publicTemplate(template: any) {
  return {
    id: template.id,
    name: template.name,
    genre: template.genre,
    hook: template.hook,
    worldBase: template.worldBase,
    status: "online",
    configJson: template
  };
}

function createRun(openid: string, body: any) {
  const template = templates.find((item) => item.id === body.templateId) || midnightStoreTemplate;
  const run: Run = {
    id: id("run"),
    inviteCode: Math.random().toString(36).slice(2, 8).toUpperCase(),
    templateId: template.id,
    title: `${template.name}：没有影子的客人`,
    hook: template.hook,
    mode: body.mode || "single",
    status: "playing",
    dangerLevel: 1,
    currentNodeIndex: 1,
    roles: midnightStoreTemplate.roles.map((role) => ({ ...enrichFateLine(role as any), id: id("role"), status: "available" })),
    actions: [],
    resolutions: [],
    chapters: [],
    players: {}
  };
  runs.set(run.id, run);
  ensureUser(openid);
  logEvent("story_run_created", { runId: run.id, openid });
  return run;
}

function currentNode(run: Run) {
  const source = midnightStoreTemplate.nodes[run.currentNodeIndex - 1];
  return {
    id: `${run.id}:node:${run.currentNodeIndex}`,
    runId: run.id,
    chapterIndex: 1,
    nodeIndex: run.currentNodeIndex,
    title: source.title,
    publicNarration: source.publicNarration,
    nodeGoal: source.nodeGoal,
    actionOptionsJson: source.actionOptions,
    status: run.resolutions.some((item) => item.nodeIndex === run.currentNodeIndex) ? "resolved" : "open_for_actions",
    actions: run.actions.filter((action) => action.nodeId === `${run.id}:node:${run.currentNodeIndex}`),
    resolution: run.resolutions.find((item) => item.nodeIndex === run.currentNodeIndex)
  };
}

async function body(req: IncomingMessage) {
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

function send(res: ServerResponse, status: number, data: unknown) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "content-type, authorization, x-mock-openid",
    "access-control-allow-methods": "GET,POST,OPTIONS"
  });
  res.end(JSON.stringify(data));
}

function state(run: Run) {
  return {
    run,
    currentNode: currentNode(run),
    clues: [
      { id: "clue_missing_minute", title: "缺失的一分钟", description: "监控在 2:16 到 2:17 之间空白。" },
      ...run.resolutions.map((item) => ({ id: `clue_${item.nodeIndex}`, title: `节点 ${item.nodeIndex} 线索`, description: item.summary }))
    ],
    relations: run.resolutions.map((item) => ({ id: `rel_${item.nodeIndex}`, publicNote: "共同经历异常后产生信任。" })),
    roles: run.roles.map((role) => enrichFateLine(role as any)),
    chapters: run.chapters.map((chapter) => enrichChapter(run, chapter))
  };
}

function generateChapter(run: Run) {
  if (run.chapters[0]) return run.chapters[0];
  const chapter = {
    id: id("chapter"),
    runId: run.id,
    chapterIndex: 1,
    title: "没有影子的客人",
    content: [
      "《没有影子的客人》",
      ...run.resolutions.map((item) => `【${item.title}】${item.summary} ${item.nextNodeHook}`),
      "雨停之前，第五个人没有现身，却把北巷 24 号留给了下一章。"
    ].join("\n\n"),
    highlightsJson: run.roles.map((role) => ({ roleName: role.roleName, highlight: `${role.roleName}留下了关键行动。` })),
    keyChoicesJson: run.resolutions.map((item) => ({ node: item.nodeIndex, choice: item.summary })),
    povSectionsJson: buildPovSections(run.roles, run.resolutions.map((item) => item.summary).join("\n")),
    personalCardsJson: buildPersonalCards(run.roles, "本章的选择改变了便利店里的每条命运线。"),
    nextHook: "第 2 章《第五个人》：北巷 24 号的门牌在雨后亮了起来。",
    shareTokens: [{ token: `share_${run.id.slice(-4)}` }]
  };
  run.chapters.push(chapter);
  aiTasks.unshift({ id: id("task"), runId: run.id, chapterId: chapter.id, taskType: "generate_chapter", modelType: "mock-director-v1", status: "completed", createdAt: new Date().toISOString(), resultJson: { title: chapter.title } });
  run.status = "chapter_generated";
  logEvent("chapter_generated", { runId: run.id, chapterId: chapter.id });
  return chapter;
}

function enrichChapter(run: Run, chapter: any) {
  return {
    ...chapter,
    povSectionsJson: chapter.povSectionsJson || buildPovSections(run.roles, chapter.content || ""),
    personalCardsJson: chapter.personalCardsJson || buildPersonalCards(run.roles, chapter.title || "")
  };
}

export const server = createServer(async (req, res) => {
  if (req.method === "OPTIONS") return send(res, 200, { ok: true });
  const parsed = parse(req.url || "", true);
  const path = parsed.pathname?.replace(/^\/api/, "") || "/";
  const method = req.method || "GET";
  const openid = getOpenid(req);

  try {
    if (method === "GET" && (path === "" || path === "/")) {
      return send(res, 200, {
        ok: true,
        name: "AI Story Room Preview API",
        mode: "preview-memory",
        message: "API 正在运行。小程序请用微信开发者工具打开 apps/miniprogram。",
        endpoints: [
          "GET /api/health",
          "GET /api/world-templates",
          "POST /api/auth/wechat-login",
          "GET /api/my/story-runs",
          "GET /api/admin/dashboard"
        ]
      });
    }
    if (method === "GET" && path === "/health") return send(res, 200, { ok: true, mode: "preview-memory" });
    if (method === "POST" && path === "/auth/wechat-login") {
      const input = await body(req);
      const user = ensureUser(input.mockOpenid || openid, input.nickname);
      return send(res, 200, { token: user.openid, user });
    }
    if (method === "GET" && path === "/user/me") return send(res, 200, ensureUser(openid));
    if (method === "GET" && path === "/world-templates") return send(res, 200, templates.map(publicTemplate));
    if (method === "GET" && path.startsWith("/world-templates/")) {
      const templateId = path.split("/").pop();
      return send(res, 200, publicTemplate(templates.find((item) => item.id === templateId) || midnightStoreTemplate));
    }
    if (method === "POST" && path === "/story-runs") return send(res, 200, createRun(openid, await body(req)));
    if (method === "GET" && path === "/my/story-runs") return send(res, 200, Array.from(runs.values()));
    if (method === "GET" && path === "/notifications") {
      return send(res, 200, Array.from(runs.values()).slice(0, 5).flatMap((run) => [
        { id: `notice_action_${run.id}`, type: "action_reminder", title: "???????", content: `${run.title} ?????`, runId: run.id, isRead: false },
        { id: `notice_ai_${run.id}`, type: "ai_resolution", title: "AI ????", content: run.status === "chapter_generated" ? "???????" : "mock AI ???????", runId: run.id, isRead: false }
      ]));
    }
    if (method === "POST" && path === "/feedback/report") {
      const input = await body(req);
      const log = { id: id("audit"), targetType: "FeedbackReport", targetId: input.runId, content: input.content || "????/??", result: "queued", riskType: input.category || "content_safety", provider: "mock", createdAt: new Date().toISOString() };
      auditLogs.unshift(log);
      logEvent("feedback_reported", { auditLogId: log.id, runId: input.runId });
      return send(res, 200, { status: "queued", auditLogId: log.id, provider: "mock" });
    }
    if (method === "GET" && path === "/admin/dashboard") {
      return send(res, 200, { activeRuns: Array.from(runs.values()).filter((run) => ["playing", "chapter_generated"].includes(run.status)).length, pendingAiTasks: aiTasks.filter((task) => ["pending", "running", "failed"].includes(task.status)).length, auditIssues: auditLogs.filter((log) => log.result !== "ok").length, eventCount: eventLogs.length, latestRuns: Array.from(runs.values()).slice(-5).reverse() });
    }
    if (method === "GET" && path === "/admin/story-runs") return send(res, 200, Array.from(runs.values()).reverse());
    if (method === "GET" && path === "/admin/ai-tasks") return send(res, 200, aiTasks);
    if (method === "GET" && path === "/admin/audit-logs") return send(res, 200, auditLogs);
    if (method === "GET" && path === "/admin/event-logs") return send(res, 200, eventLogs);
    if (method === "GET" && path === "/admin/action-guard") return send(res, 200, { blockedAudits: auditLogs.filter((log) => log.targetType === "PlayerActionDraft" || log.riskType === "action_overreach"), guardEvents: eventLogs.filter((event) => event.eventName === "action_guard_blocked"), rejectedActions: [] });

    const adminRunMatch = path.match(/^\/admin\/story-runs\/([^/]+)$/);
    if (method === "GET" && adminRunMatch) {
      const run = runs.get(adminRunMatch[1]);
      if (!run) return send(res, 404, { message: "run not found" });
      return send(res, 200, { ...run, events: eventLogs.filter((event) => event.payload?.runId === run.id), aiTasks: aiTasks.filter((task) => task.runId === run.id), auditLogs: auditLogs.filter((log) => log.targetId === run.id) });
    }

    const runMatch = path.match(/^\/story-runs\/([^/]+)(.*)$/);
    if (runMatch) {
      const run = runs.get(runMatch[1]);
      if (!run) return send(res, 404, { message: "run not found" });
      const tail = runMatch[2];
      if (method === "GET" && tail === "") return send(res, 200, run);
      if (method === "GET" && tail === "/state") return send(res, 200, state(run));
      if (method === "GET" && tail === "/insights") {
        const snapshot = state(run);
        const latestResolution = run.resolutions[run.resolutions.length - 1] || null;
        return send(res, 200, { ...snapshot, myRole: (() => { const role = run.roles.find((item) => item.id === run.players[openid]); return role ? { role: enrichFateLine(role as any) } : null; })(), nodes: midnightStoreTemplate.nodes.slice(0, run.currentNodeIndex).map((_, index) => ({ ...currentNode({ ...run, currentNodeIndex: index + 1 }), nodeIndex: index + 1 })), actions: run.actions, resolutions: run.resolutions, latestResolution, worldSnapshots: [{ stateJson: { dangerLevel: run.dangerLevel } }], suspicious: snapshot.clues.map((clue) => ({ ...clue, risk: run.dangerLevel })) });
      }
      if (method === "POST" && tail === "/join") {
        ensureUser(openid);
        logEvent("story_run_joined", { runId: run.id, openid });
        return send(res, 200, { runId: run.id, player: { openid } });
      }
      if (method === "GET" && tail === "/roles") return send(res, 200, run.roles.map((role) => enrichFateLine(role as any)));
      const claim = tail.match(/^\/roles\/([^/]+)\/claim$/);
      if (method === "POST" && claim) {
        const role = run.roles.find((item) => item.id === claim[1]);
        if (!role) return send(res, 404, { message: "role not found" });
        role.status = "claimed";
        role.playerOpenid = openid;
        run.players[openid] = role.id;
        logEvent("role_claimed", { runId: run.id, openid, roleId: role.id });
        return send(res, 200, { roleId: role.id, roleName: role.roleName, playerId: id("player") });
      }
      if (method === "GET" && tail === "/my-role") {
        const roleId = run.players[openid];
        const role = run.roles.find((item) => item.id === roleId);
        return send(res, 200, role ? { role: enrichFateLine(role as any) } : null);
      }
      if (method === "GET" && tail === "/current-node") return send(res, 200, currentNode(run));
      if (method === "GET" && tail === "/nodes") {
        return send(res, 200, midnightStoreTemplate.nodes.slice(0, run.currentNodeIndex).map((_, index) => ({ ...currentNode({ ...run, currentNodeIndex: index + 1 }), nodeIndex: index + 1 })));
      }
      if (method === "GET" && tail === "/narrative-segments") {
        return send(res, 200, run.resolutions.map((item) => ({ id: `segment_${item.nodeIndex}`, content: item.summary })));
      }
      if (method === "POST" && tail === "/generate-chapter") return send(res, 200, enrichChapter(run, generateChapter(run)));
    }

    const nodeMatch = path.match(/^\/nodes\/([^/]+)(.*)$/);
    if (nodeMatch) {
      const [runId, , nodeIndexText] = nodeMatch[1].split(":");
      const run = runs.get(runId);
      if (!run) return send(res, 404, { message: "run not found" });
      const nodeIndex = Number(nodeIndexText);
      const nodeId = nodeMatch[1];
      const tail = nodeMatch[2];
      if (method === "GET" && tail === "") return send(res, 200, currentNode({ ...run, currentNodeIndex: nodeIndex }));
      if (method === "GET" && tail === "/actions") return send(res, 200, run.actions.filter((item) => item.nodeId === nodeId).map((item) => ({ ...item, role: run.roles.find((role) => role.id === item.roleId) })));
      if (method === "POST" && tail === "/actions") {
        const input = await body(req);
        const text = `${input.method || ""} ${input.intent || ""}`;
        if (/(杀死|我成功|操控|揭开全部真相|立刻通关|CONTROL_ALL|FORCE_SUCCESS|AUTO_WIN)/.test(text)) {
          const audit = {
            id: id("audit"),
            targetType: "PlayerActionDraft",
            targetId: nodeId,
            content: text,
            result: "blocked",
            riskType: "action_overreach",
            provider: "mock",
            createdAt: new Date().toISOString()
          };
          auditLogs.unshift(audit);
          logEvent("action_guard_blocked", { runId: run.id, nodeId, auditLogId: audit.id });
          return send(res, 200, {
            status: "rejected",
            guardStatus: "blocked",
            message: "行动越界：不能宣布结果或操控其他角色。",
            rewriteSuggestion: { method: "我尝试观察并推进，不宣布结果。", intent: "把结果交给 AI 导演结算。" }
          });
        }
        const role = run.roles.find((item) => item.id === input.roleId);
        if (!role) return send(res, 404, { message: "role not found" });
        const action = { id: id("action"), nodeId, roleId: role.id, roleName: role.roleName, status: "accepted", method: input.method, intent: input.intent };
        run.actions.push(action);
        auditLogs.unshift({
          id: id("audit"),
          targetType: "PlayerAction",
          targetId: action.id,
          content: `${input.method}\n${input.intent}`,
          result: "ok",
          provider: "mock",
          createdAt: new Date().toISOString()
        });
        logEvent("action_submitted", { runId: run.id, nodeId, actionId: action.id, roleId: role.id });
        return send(res, 200, { actionId: action.id, status: "accepted", guardStatus: "ok", message: "行动已提交，等待本节点结算。" });
      }
      if (method === "POST" && tail === "/resolve") {
        const existing = run.resolutions.find((item) => item.nodeIndex === nodeIndex);
        if (existing) return send(res, 200, existing);
        const source = midnightStoreTemplate.nodes[nodeIndex - 1];
        const actionViews = run.actions
          .filter((item) => item.nodeId === nodeId)
          .map((item) => ({ roleId: item.roleId, roleName: item.roleName }));
        const resolution = {
          id: id("resolution"),
          nodeId,
          nodeIndex,
          title: source.title,
          summary: source.resolutionSummary,
          publicNarration: `${source.resolutionSummary} ${source.nextHook}`,
          nextNodeHook: source.nextHook,
          dangerBefore: run.dangerLevel,
          dangerAfter: Math.min(5, run.dangerLevel + (nodeIndex >= 4 ? 1 : 0)),
          actionResultsJson: run.actions.filter((item) => item.nodeId === nodeId),
          privateResultsJson: run.actions.filter((item) => item.nodeId === nodeId),
          echoesJson: buildEchoes(actionViews, source.resolutionSummary),
          crossImpactsJson: buildCrossImpacts(actionViews, source.resolutionSummary),
          clueChangesJson: [{ title: `节点 ${nodeIndex} 线索`, description: source.resolutionSummary }],
          relationChangesJson: [{ relationType: "trust", publicNote: "共同经历异常后产生信任。" }]
        };
        aiTasks.unshift({ id: id("task"), runId: run.id, nodeId, taskType: "resolve_node", modelType: "mock-director-v1", status: "completed", createdAt: new Date().toISOString(), resultJson: { summary: resolution.summary } });
        run.resolutions.push(resolution);
        logEvent("node_resolved", { runId: run.id, nodeId, resolutionId: resolution.id });
        run.dangerLevel = resolution.dangerAfter;
        if (nodeIndex < 5) run.currentNodeIndex = nodeIndex + 1;
        else generateChapter(run);
        return send(res, 200, resolution);
      }
      if (method === "GET" && tail === "/resolution") {
        return send(res, 200, run.resolutions.find((item) => item.nodeIndex === nodeIndex) || null);
      }
    }

    const chapterMatch = path.match(/^\/chapters\/([^/]+)(\/share)?$/);
    if (chapterMatch) {
      const run = Array.from(runs.values()).find((item) => item.chapters.some((chapter) => chapter.id === chapterMatch[1]));
      const chapter = run?.chapters.find((item) => item.id === chapterMatch[1]);
      if (!chapter || !run) return send(res, 404, { message: "chapter not found" });
      if (method === "POST" && chapterMatch[2]) return send(res, 200, chapter.shareTokens[0]);
      return send(res, 200, enrichChapter(run, chapter));
    }

    return send(res, 404, { message: `No route ${method} ${path}` });
  } catch (error) {
    return send(res, 500, { message: error instanceof Error ? error.message : String(error) });
  }
});

server.listen(3001, "0.0.0.0", () => {
  console.log("Preview API listening on http://localhost:3001/api");
});
