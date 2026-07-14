import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const API_BASE = (process.env.API_BASE || "http://127.0.0.1:3101/api").replace(/\/$/, "");
const players = [
  { openid: `triad_a_${Date.now()}`, nickname: "玩家甲 · 证据派" },
  { openid: `triad_b_${Date.now()}`, nickname: "玩家乙 · 协商派" },
  { openid: `triad_c_${Date.now()}`, nickname: "玩家丙 · 风险派" }
];
const decisionOrder = [0, 1, 2, 0, 1, 2, 0];
const expectedDirectorProvider = process.env.EXPECT_DIRECTOR_PROVIDER || "deepseek";
const requestedTemplateId = process.env.STORY_TEMPLATE_ID || "template_sangtian_001";

type ApiResult<T> = { status: number; payload: T };

async function request<T>(path: string, playerIndex = 0, options: { method?: string; data?: unknown } = {}): Promise<T> {
  const player = players[playerIndex];
  const response = await fetch(`${API_BASE}${path}`, {
    method: options.method || "GET",
    headers: {
      "content-type": "application/json",
      "x-mock-openid": player.openid,
      authorization: `Bearer ${player.openid}`
    },
    body: options.data === undefined ? undefined : JSON.stringify(options.data)
  });
  const text = await response.text();
  let payload: any = {};
  try { payload = text ? JSON.parse(text) : {}; } catch { payload = { raw: text }; }
  if (!response.ok) throw new Error(`${options.method || "GET"} ${path} -> ${response.status}: ${JSON.stringify(payload)}`);
  return payload as T;
}

async function login(playerIndex: number) {
  return request<{ token: string; user: { id: string } }>("/auth/wechat-login", playerIndex, {
    method: "POST",
    data: players[playerIndex]
  });
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function main() {
  await request<{ ok: boolean }>("/health");
  const templateList = await request<Array<{ id: string }>>("/world-templates");
  const templateId = templateList.find((template) => template.id === requestedTemplateId)?.id;
  assert(templateId, `Requested world template is not available: ${requestedTemplateId}`);
  await Promise.all(players.map((_, index) => login(index)));

  const run = await request<any>("/story-runs", 0, {
    method: "POST",
    data: { templateId, mode: "ai-trio", maxPlayers: 3, aiPlayerCount: 0, tone: "悬疑协作", ownerAsPlayer: true }
  });
  assert(run.mode === "ai-trio", `Expected ai-trio mode, got ${run.mode}`);
  assert(run.maxPlayers === 3, `Expected maxPlayers=3, got ${run.maxPlayers}`);

  for (const index of [1, 2]) await request(`/story-runs/${run.id}/join`, index, { method: "POST" });
  const joined = await request<any>(`/story-runs/${run.id}`, 0);
  assert(joined.activeHumanCount === 3, `Expected three active players, got ${joined.activeHumanCount}`);

  const roles = await request<any[]>(`/story-runs/${run.id}/roles`, 0);
  assert(roles.length >= 3, `Expected at least three roles, got ${roles.length}`);
  for (let index = 0; index < 3; index += 1) {
    await request(`/story-runs/${run.id}/roles/${roles[index].id}/claim`, index, { method: "POST" });
  }

  const report: any = {
    apiBase: API_BASE,
    runId: run.id,
    templateId,
    mode: run.mode,
    players: players.map((player, index) => ({ index, nickname: player.nickname, roleId: roles[index].id, roleName: roles[index].roleName })),
    rounds: []
  };

  for (let round = 1; round <= 7; round += 1) {
    const state = await request<any>(`/story-runs/${run.id}/state`, 0);
    const node = state.currentNode;
    assert(node?.id, `Round ${round} has no current node`);
    assert(node.nodeIndex === round, `Expected node index ${round}, got ${node.nodeIndex}`);
    const actorIndex = decisionOrder[round - 1];
    const submitted: any[] = [];

    for (let playerIndex = 0; playerIndex < 3; playerIndex += 1) {
      const role = roles[playerIndex];
      const isActor = playerIndex === actorIndex;
      const result = await request<any>(`/nodes/${node.id}/actions`, playerIndex, {
        method: "POST",
        data: {
          runId: run.id,
          roleId: role.id,
          actionType: isActor ? "investigate" : "observe",
          targetText: node.title,
          method: isActor
            ? `${role.roleName} 选择「${node.actionOptionsJson?.[round % (node.actionOptionsJson?.length || 1)] || "核对当前线索"}」，并说明行动理由。`
            : `${role.roleName} 观察 ${node.title} 的公开变化，并把可验证线索发给其他玩家。`,
          intent: isActor ? `第 ${round} 轮由${role.roleName}作出主决策，承担可追溯后果。` : "补充公开事实，不替其他玩家决定结果。",
          riskLevel: isActor ? "risky" : "safe"
        }
      });
      assert(result.guardStatus === "ok" && result.status === "accepted", `Round ${round} player ${playerIndex + 1} action was not accepted`);
      submitted.push({ playerIndex, roleId: role.id, actionId: result.actionId, guardStatus: result.guardStatus });
    }

    const resolution = await request<any>(`/nodes/${node.id}/resolve`, 0, { method: "POST" });
    assert(Array.isArray(resolution.actionResultsJson) && resolution.actionResultsJson.length >= 3, `Round ${round} missing the three required human action results`);
    assert(Array.isArray(resolution.echoesJson) && resolution.echoesJson.length >= 3, `Round ${round} missing the three required human echoes`);
    assert(Array.isArray(resolution.crossImpactsJson) && resolution.crossImpactsJson.length >= 3, `Round ${round} missing cross-player impacts`);

    const notificationCounts: number[] = [];
    for (let playerIndex = 0; playerIndex < 3; playerIndex += 1) {
      const notifications = await request<any[]>("/notifications", playerIndex);
      const shared = notifications.filter((item) => item.type === "player_decision_shared" && item.runId === run.id);
      assert(shared.length >= round * 2, `Player ${playerIndex + 1} did not receive decisions from other players in round ${round}`);
      assert(shared.every((item) => !/privateReasoningSummary|hiddenIntent|hiddenMeaning/i.test(JSON.stringify(item))), `Private fields leaked to player ${playerIndex + 1}`);
      notificationCounts.push(shared.length);
    }

    report.rounds.push({
      round,
      nodeId: node.id,
      nodeIndex: node.nodeIndex,
      nodeTitle: node.title,
      actorIndex,
      actorRole: roles[actorIndex].roleName,
      submitted,
      resolutionId: resolution.id,
      summary: resolution.summary,
      actionResultCount: resolution.actionResultsJson.length,
      echoCount: resolution.echoesJson.length,
      crossImpactCount: resolution.crossImpactsJson.length,
      notificationCounts
    });
  }

  const finalState = await request<any>(`/story-runs/${run.id}/state`, 0);
  assert(finalState.run.completedNodeCount === 7, `Expected seven resolved rounds, got ${finalState.run.completedNodeCount}`);
  assert(finalState.run.status === "chapter_generated", `Expected chapter_generated, got ${finalState.run.status}`);
  assert(finalState.chapters?.[0]?.id, "Seven-round run did not generate a chapter");

  const adminTasks = await request<any[]>("/admin/ai-tasks", 0);
  const tasks = adminTasks.filter((task) => task.runId === run.id);
  assert(tasks.length >= 8, `Expected seven resolve tasks plus chapter task, got ${tasks.length}`);
  assert(tasks.every((task) => task.status === "completed" && task.resultJson?.provider === expectedDirectorProvider), `At least one AI task did not complete with expected ${expectedDirectorProvider} director: ${JSON.stringify(tasks)}`);

  const adminActions = await request<any[]>("/admin/actions", 0);
  const actions = adminActions.filter((action) => action.runId === run.id);
  assert(actions.length >= 21, `Expected at least 21 persisted human actions, got ${actions.length}`);
  const adminResolutions = await request<any[]>("/admin/resolutions", 0);
  assert(adminResolutions.filter((resolution) => resolution.runId === run.id).length === 7, "Expected seven persisted resolutions");
  const eventLogs = await request<any[]>("/admin/event-logs", 0);
  const runEvents = eventLogs.filter((event) => event.runId === run.id);
  assert(runEvents.some((event) => event.eventName === "node_resolved"), "Missing node_resolved event log");

  report.final = {
    status: finalState.run.status,
    completedNodeCount: finalState.run.completedNodeCount,
    chapterId: finalState.chapters[0].id,
    aiTaskCount: tasks.length,
    actionCount: actions.length,
    requiredHumanActionCount: 21,
    resolutionCount: adminResolutions.filter((resolution) => resolution.runId === run.id).length,
    eventCount: runEvents.length,
    directorProviders: [...new Set(tasks.map((task) => task.resultJson?.provider))]
  };

  await mkdir("scripts/test-reports", { recursive: true });
  const output = join("scripts/test-reports", `three-player-seven-round-${Date.now()}.json`);
  await writeFile(output, JSON.stringify(report, null, 2), "utf8");
  console.log(`THREE_PLAYER_SEVEN_ROUND_PASS ${output}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
