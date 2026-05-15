import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const API_BASE = process.env.API_BASE || "http://localhost:3001/api";
const TEMPLATE_IDS = ["template_midnight_store_001", "template_qingyun_sect_001", "template_wild_village_001"];

type Session = { openid: string; nickname: string; token: string; role?: { id: string; roleKey: string; roleName: string } };

async function request<T>(path: string, options: { method?: string; token?: string; data?: unknown } = {}): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: options.method || "GET",
    headers: { "content-type": "application/json", authorization: `Bearer ${options.token || "mock_openid_owner_001"}` },
    body: options.data ? JSON.stringify(options.data) : undefined
  });
  if (!res.ok) throw new Error(`${options.method || "GET"} ${path} failed: ${res.status} ${await res.text()}`);
  return (await res.json()) as T;
}

async function login(openid: string, nickname: string): Promise<Session> {
  const result = await request<{ token: string }>("/auth/wechat-login", { method: "POST", data: { mockOpenid: openid, nickname } });
  return { openid, nickname, token: result.token };
}

function assertGuardContract(result: any, expected: "ok" | "rewrite_needed" | "blocked") {
  if (result.guardStatus !== expected) throw new Error(`Expected guardStatus ${expected}, got ${JSON.stringify(result)}`);
  if (expected === "ok") {
    if (result.status !== "accepted" || result.accepted !== true || result.rejected !== false) throw new Error(`Invalid ok guard contract: ${JSON.stringify(result)}`);
  } else {
    if (result.status !== "rejected" || result.accepted !== false || result.rejected !== true) throw new Error(`Invalid rejected guard contract: ${JSON.stringify(result)}`);
    if (!Array.isArray(result.matchedRules) || result.matchedRules.length === 0) throw new Error(`Missing matchedRules: ${JSON.stringify(result)}`);
    if (!result.suggestedRewrite && !result.rewriteSuggestion) throw new Error(`Missing suggestedRewrite/rewriteSuggestion: ${JSON.stringify(result)}`);
  }
  if (typeof result.reason !== "string" || result.reason.length === 0) throw new Error(`Missing guard reason: ${JSON.stringify(result)}`);
}

async function exerciseTemplate(templateId: string, index: number) {
  const users = await Promise.all([
    login(`mock_openid_e2e_${index}_a`, `Player ${index}A`),
    login(`mock_openid_e2e_${index}_b`, `Player ${index}B`),
    login(`mock_openid_e2e_${index}_c`, `Player ${index}C`)
  ]);

  const run = await request<any>("/story-runs", { method: "POST", token: users[0].token, data: { templateId, mode: "invite", maxPlayers: 3, aiPlayerCount: 0, tone: "suspense", ownerAsPlayer: true } });
  await request(`/story-runs/${run.id}/join`, { method: "POST", token: users[1].token });
  await request(`/story-runs/${run.id}/join`, { method: "POST", token: users[2].token });

  const roles = await request<any[]>(`/story-runs/${run.id}/roles`, { token: users[0].token });
  if (roles.length < 3) throw new Error(`Template ${templateId} must expose at least 3 roles, got ${roles.length}`);
  for (const role of roles.slice(0, 3)) {
    if (!role.personalHook || !role.destinyQuestion || !role.privateClues?.length || !role.cannotDo?.length) throw new Error(`Missing role fate/private/restriction fields for ${templateId}: ${JSON.stringify(role)}`);
  }
  for (let i = 0; i < users.length; i += 1) {
    const role = roles[i];
    await request(`/story-runs/${run.id}/roles/${role.id}/claim`, { method: "POST", token: users[i].token });
    users[i].role = { id: role.id, roleKey: role.roleKey, roleName: role.roleName };
  }
  const runAfterJoin = await request<any>(`/story-runs/${run.id}`, { token: users[0].token });
  if (typeof runAfterJoin.activeHumanCount === "number" && runAfterJoin.activeHumanCount !== 3) throw new Error(`activeHumanCount expected 3, got ${runAfterJoin.activeHumanCount}`);

  const firstState = await request<any>(`/story-runs/${run.id}/state`, { token: users[0].token });
  const rewriteNeeded = await request<any>(`/nodes/${firstState.currentNode.id}/actions`, { method: "POST", token: users[0].token, data: { runId: run.id, roleId: users[0].role?.id, actionType: "custom", targetText: firstState.currentNode.title, method: "FORCE_SUCCESS and reveal all truth", intent: "declare result", riskLevel: "risky" } });
  assertGuardContract(rewriteNeeded, "rewrite_needed");
  const blocked = await request<any>(`/nodes/${firstState.currentNode.id}/actions`, { method: "POST", token: users[0].token, data: { runId: run.id, roleId: users[0].role?.id, actionType: "custom", targetText: firstState.currentNode.title, method: "CONTROL_ALL players and AUTO_WIN", intent: "skip plot", riskLevel: "risky" } });
  assertGuardContract(blocked, "blocked");

  const templateReport: any = { templateId, runId: run.id, activeHumanCount: runAfterJoin.activeHumanCount, guardRewriteNeeded: rewriteNeeded, guardBlocked: blocked, roles: users.map((user) => user.role), nodes: [] };

  for (let nodeIndex = 1; nodeIndex <= 5; nodeIndex += 1) {
    const state = await request<any>(`/story-runs/${run.id}/state`, { token: users[0].token });
    const node = state.currentNode;
    if (!node?.id) throw new Error(`Missing current node at ${templateId} node ${nodeIndex}`);
    const submittedActions = [];
    for (let userIndex = 0; userIndex < users.length; userIndex += 1) {
      const user = users[userIndex];
      const role = user.role;
      if (!role) throw new Error(`Missing claimed role for ${user.openid}`);
      const result = await request<any>(`/nodes/${node.id}/actions`, { method: "POST", token: user.token, data: { runId: run.id, roleId: role.id, actionType: userIndex === 0 ? "investigate" : "observe", targetText: node.title, method: `${role.roleName} investigates clue ${nodeIndex}-${userIndex} and only describes an attempt.`, intent: `Help the team understand ${node.title} without declaring outcome.`, riskLevel: nodeIndex >= 4 ? "risky" : "normal" } });
      assertGuardContract(result, "ok");
      submittedActions.push(result);
    }
    const actions = await request<any[]>(`/nodes/${node.id}/actions`, { token: users[0].token });
    if (actions.length !== 3) throw new Error(`Expected 3 actions at ${templateId} node ${nodeIndex}, got ${actions.length}`);
    const resolution = await request<any>(`/nodes/${node.id}/resolve`, { method: "POST", token: users[0].token });
    if (!resolution.summary || !resolution.actionResultsJson?.length || !resolution.echoesJson?.length || !resolution.crossImpactsJson?.length) throw new Error(`Incomplete director resolution at ${templateId} node ${nodeIndex}: ${JSON.stringify(resolution)}`);
    if (!resolution.clueChangesJson?.length || !resolution.relationChangesJson?.length) throw new Error(`Missing clue/relation changes at ${templateId} node ${nodeIndex}`);
    templateReport.nodes.push({ nodeIndex, nodeId: node.id, title: node.title, submittedActions, actionCount: actions.length, resolutionId: resolution.id, dangerAfter: resolution.dangerAfter });
  }

  const finalState = await request<any>(`/story-runs/${run.id}/state`, { token: users[0].token });
  const chapter = finalState.chapters?.[0];
  if (!chapter?.id) throw new Error(`Expected generated chapter after 5 nodes for ${templateId}`);
  const chapterDetail = await request<any>(`/chapters/${chapter.id}`, { token: users[0].token });
  if (!chapterDetail.shareTokens?.length || !chapterDetail.povSectionsJson?.length || !chapterDetail.personalCardsJson?.length || !chapterDetail.nextHook) throw new Error(`Incomplete chapter contract for ${templateId}: ${JSON.stringify(chapterDetail)}`);
  const share = await request<any>(`/chapters/${chapter.id}/share`, { method: "POST", token: users[0].token });
  if (!share?.token) throw new Error(`Missing share token for ${templateId}`);
  await request("/notifications", { token: users[0].token });
  const feedback = await request<any>("/feedback/report", { method: "POST", token: users[0].token, data: { runId: run.id, category: "content_safety", content: "E2E mock feedback/report" } });
  if (feedback.status !== "queued") throw new Error(`Feedback/report did not queue: ${JSON.stringify(feedback)}`);
  templateReport.chapter = { id: chapterDetail.id, title: chapterDetail.title, nextHook: chapterDetail.nextHook, povSectionCount: chapterDetail.povSectionsJson.length, personalCardCount: chapterDetail.personalCardsJson.length, shareToken: share.token };
  return templateReport;
}

async function main() {
  await request("/health");
  const templates = await request<any[]>("/world-templates");
  for (const id of TEMPLATE_IDS) if (!templates.some((template) => template.id === id)) throw new Error(`Missing world template ${id}`);
  const report: any = { apiBase: API_BASE, templates: [] };
  for (let i = 0; i < TEMPLATE_IDS.length; i += 1) report.templates.push(await exerciseTemplate(TEMPLATE_IDS[i], i + 1));

  const dashboard = await request<any>("/admin/dashboard");
  const adminRuns = await request<any[]>("/admin/story-runs");
  const adminRoles = await request<any[]>("/admin/roles").catch(() => []);
  const adminActions = await request<any[]>("/admin/actions").catch(() => []);
  const adminResolutions = await request<any[]>("/admin/resolutions").catch(() => []);
  const aiTasks = await request<any[]>("/admin/ai-tasks");
  const auditLogs = await request<any[]>("/admin/audit-logs");
  const eventLogs = await request<any[]>("/admin/event-logs");
  const actionGuard = await request<any>("/admin/action-guard");
  if (!adminRuns.length || !aiTasks.length || !auditLogs.length || !eventLogs.length || !actionGuard.blockedAudits?.length) throw new Error("Expected admin observability data for runs/tasks/audit/events/actionguard");
  report.admin = { dashboard, runCount: adminRuns.length, roleCount: adminRoles.length, actionCount: adminActions.length, resolutionCount: adminResolutions.length, aiTaskCount: aiTasks.length, auditLogCount: auditLogs.length, eventLogCount: eventLogs.length, actionGuardBlockedCount: actionGuard.blockedAudits.length };

  await mkdir("scripts/test-reports", { recursive: true });
  const output = join("scripts/test-reports", `story-e2e-${Date.now()}.json`);
  await writeFile(output, JSON.stringify(report, null, 2), "utf8");
  console.log(`P0-A multi-template story E2E passed. Report: ${output}`);
}

main().catch((error) => { console.error(error); process.exit(1); });
