import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";

const API_BASE = (process.env.API_BASE || "http://127.0.0.1:3102/api").replace(/\/$/, "");
const players = ["round4-a", "round4-b", "round4-c"].map((suffix, index) => ({ openid: `three-player-${suffix}-${Date.now()}`, nickname: `测试玩家 ${index + 1}` }));

async function request<T>(path: string, playerIndex = 0, options: { method?: string; data?: unknown } = {}): Promise<T> {
  const player = players[playerIndex];
  const response = await fetch(`${API_BASE}${path}`, {
    method: options.method || "GET",
    headers: { "content-type": "application/json", authorization: `Bearer ${player.openid}`, "x-mock-openid": player.openid },
    body: options.data === undefined ? undefined : JSON.stringify(options.data)
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${options.method || "GET"} ${path} -> ${response.status}: ${JSON.stringify(payload)}`);
  return payload as T;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`THREE_PLAYER_FOUR_ROUND_FAIL: ${message}`);
}

async function main() {
  await request("/health");
  const templates = await request<any[]>("/world-templates");
  const templateId = templates.find((template) => template.id === "template_midnight_store_001")?.id || templates[0]?.id;
  assert(templateId, "no seeded template");
  for (let index = 0; index < players.length; index += 1) await request("/auth/wechat-login", index, { method: "POST", data: players[index] });
  const run = await request<any>("/story-runs", 0, { method: "POST", data: { templateId, mode: "ai-trio", maxPlayers: 3, aiPlayerCount: 0, ownerAsPlayer: true, tone: "suspense" } });
  for (const index of [1, 2]) await request(`/story-runs/${run.id}/join`, index, { method: "POST" });
  const roles = await request<any[]>(`/story-runs/${run.id}/roles`);
  assert(roles.length >= 3, "three playable roles are required");
  for (let index = 0; index < 3; index += 1) await request(`/story-runs/${run.id}/roles/${roles[index].id}/claim`, index, { method: "POST" });

  const rounds: any[] = [];
  for (let round = 1; round <= 4; round += 1) {
    const state = await request<any>(`/story-runs/${run.id}/state`);
    const node = state.currentNode;
    assert(node?.id && node.nodeIndex === round, `round ${round} node mismatch`);
    const actionIds: string[] = [];
    for (let index = 0; index < 3; index += 1) {
      const result = await request<any>(`/nodes/${node.id}/actions`, index, {
        method: "POST",
        data: {
          runId: run.id,
          roleId: roles[index].id,
          actionType: index === (round - 1) % 3 ? "investigate" : "observe",
          targetText: node.title,
          method: `${roles[index].roleName} reviews the clue, compares evidence, and reports only an attempt.`,
          intent: `Round ${round}: help the group reason about ${node.title} without declaring the outcome.`,
          riskLevel: round >= 3 ? "risky" : "normal"
        }
      });
      assert(result.status === "accepted" && result.guardStatus === "ok", `player ${index + 1} action rejected in round ${round}`);
      actionIds.push(result.actionId);
    }
    const resolution = await request<any>(`/nodes/${node.id}/resolve`, 0, { method: "POST" });
    assert(resolution.actionResultsJson?.length === 3, `round ${round} missing three action results`);
    assert(resolution.echoesJson?.length === 3 && resolution.crossImpactsJson?.length >= 3, `round ${round} missing cross-player effects`);
    const notifications = [];
    for (let index = 0; index < 3; index += 1) {
      const items = await request<any[]>("/notifications", index);
      const shared = items.filter((item) => item.runId === run.id && item.type === "player_decision_shared");
      assert(shared.length >= round * 2, `player ${index + 1} did not receive shared decisions`);
      assert(!shared.some((item) => /privateReasoningSummary|hiddenIntent|hiddenMeaning/i.test(JSON.stringify(item))), `private fields leaked to player ${index + 1}`);
      notifications.push(shared.length);
    }
    rounds.push({ round, nodeId: node.id, actionIds, resolutionId: resolution.id, notificationCounts: notifications, provider: resolution.statePatchJson?.aiTaskId ? "recorded" : "unknown" });
  }

  const prisma = new PrismaClient();
  try {
    const [storedRun, actions, resolutions, tasks, events] = await Promise.all([
      prisma.storyRun.findUnique({ where: { id: run.id } }),
      prisma.playerAction.count({ where: { runId: run.id } }),
      prisma.directorResolution.count({ where: { runId: run.id } }),
      prisma.aiTask.findMany({ where: { runId: run.id }, orderBy: { createdAt: "asc" } }),
      prisma.eventLog.findMany({ where: { runId: run.id }, orderBy: { createdAt: "asc" } })
    ]);
    assert(storedRun && storedRun.completedNodeCount === 4, "legacy StoryRun was not advanced four rounds");
    assert(actions === 12 && resolutions === 4, `expected 12 actions/4 resolutions, got ${actions}/${resolutions}`);
    assert(tasks.length >= 4 && tasks.every((task) => ["completed", "mock_fallback"].includes(String((task.resultJson as any)?.status || task.status))), "AI task records are incomplete");
    assert(events.some((event) => event.eventName === "node_resolved"), "node_resolved event missing");
    const report = { status: "PASS", apiBase: API_BASE, runId: run.id, players, rounds, db: { actions, resolutions, aiTasks: tasks.length, aiProviders: [...new Set(tasks.map((task) => (task.resultJson as any)?.provider))], eventLogs: events.length } };
    await mkdir("scripts/test-reports", { recursive: true });
    const output = join("scripts/test-reports", `three-player-four-round-${Date.now()}.json`);
    await writeFile(output, JSON.stringify(report, null, 2), "utf8");
    console.log(`THREE_PLAYER_FOUR_ROUND_PASS ${output}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
