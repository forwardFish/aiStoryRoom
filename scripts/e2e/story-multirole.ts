import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const API_BASE = process.env.API_BASE || "http://localhost:3001/api";

type Session = {
  openid: string;
  nickname: string;
  token: string;
  role?: { id: string; roleKey: string; roleName: string };
};

async function request<T>(path: string, options: { method?: string; token?: string; data?: unknown } = {}): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: options.method || "GET",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${options.token || "mock_openid_owner_001"}`
    },
    body: options.data ? JSON.stringify(options.data) : undefined
  });
  if (!res.ok) {
    throw new Error(`${options.method || "GET"} ${path} failed: ${res.status} ${await res.text()}`);
  }
  return (await res.json()) as T;
}

async function login(openid: string, nickname: string): Promise<Session> {
  const result = await request<{ token: string }>("/auth/wechat-login", {
    method: "POST",
    data: { mockOpenid: openid, nickname }
  });
  return { openid, nickname, token: result.token };
}

async function main() {
  await request("/health");

  const users = await Promise.all([
    login("mock_openid_e2e_lin_lu", "林鹿玩家"),
    login("mock_openid_e2e_chen_zhou", "陈舟玩家"),
    login("mock_openid_e2e_gu_yan", "顾言玩家")
  ]);

  const run = await request<any>("/story-runs", {
    method: "POST",
    token: users[0].token,
    data: {
      templateId: "template_midnight_store_001",
      mode: "invite",
      maxPlayers: 3,
      aiPlayerCount: 0,
      tone: "悬疑",
      ownerAsPlayer: true
    }
  });

  await request(`/story-runs/${run.id}/join`, { method: "POST", token: users[1].token });
  await request(`/story-runs/${run.id}/join`, { method: "POST", token: users[2].token });

  const roles = await request<any[]>(`/story-runs/${run.id}/roles`, { token: users[0].token });
  for (const role of roles) {
    if (!role.personalHook || !role.destinyQuestion || !role.privateClues?.length) {
      throw new Error(`Missing fate-line fields for role ${role.roleKey}: ${JSON.stringify(role)}`);
    }
  }
  const roleOrder = ["lin_lu", "chen_zhou", "gu_yan"];
  for (let i = 0; i < users.length; i += 1) {
    const role = roles.find((item) => item.roleKey === roleOrder[i]);
    if (!role) throw new Error(`Missing role ${roleOrder[i]}`);
    await request(`/story-runs/${run.id}/roles/${role.id}/claim`, { method: "POST", token: users[i].token });
    users[i].role = { id: role.id, roleKey: role.roleKey, roleName: role.roleName };
  }

  const guardState = await request<any>(`/story-runs/${run.id}/state`, { token: users[0].token });
  const guardResult = await request<any>(`/nodes/${guardState.currentNode.id}/actions`, {
    method: "POST",
    token: users[0].token,
    data: {
      runId: run.id,
      roleId: users[0].role?.id,
      actionType: "custom",
      targetText: guardState.currentNode.title,
      method: "CONTROL_ALL players and FORCE_SUCCESS immediately.",
      intent: "AUTO_WIN by declaring the whole truth instead of attempting an action.",
      riskLevel: "risky",
      freeText: ""
    }
  });
  if (guardResult.status !== "rejected" || guardResult.guardStatus !== "blocked") {
    throw new Error(`Expected ActionGuard blocked result, got ${JSON.stringify(guardResult)}`);
  }

  const report: any = {
    guardBlocked: guardResult,
    runId: run.id,
    inviteCode: run.inviteCode,
    users: users.map((user) => ({ openid: user.openid, nickname: user.nickname, role: user.role })),
    nodes: []
  };

  const actionSeeds = [
    ["查看监控回放", "观察门口水迹", "询问大家看到的细节"],
    ["检查仓库门缝", "寻找备用钥匙", "确认手机订单记录"],
    ["比对收银记录", "拍下 0 元小票", "观察其他人的反应"],
    ["用旧相机拍冷柜", "交换掌握的线索", "保护小票证据"],
    ["合力逼近第五道影子", "守住出口", "记录北巷 24 号线索"]
  ];

  for (let nodeIndex = 1; nodeIndex <= 5; nodeIndex += 1) {
    const state = await request<any>(`/story-runs/${run.id}/state`, { token: users[0].token });
    const node = state.currentNode;
    if (!node) throw new Error(`Missing current node at step ${nodeIndex}`);

    const submittedActions = [];
    for (let userIndex = 0; userIndex < users.length; userIndex += 1) {
      const user = users[userIndex];
      const role = user.role;
      if (!role) throw new Error(`Missing claimed role for ${user.openid}`);
      const actionText = actionSeeds[nodeIndex - 1][userIndex];
      const result = await request<any>(`/nodes/${node.id}/actions`, {
        method: "POST",
        token: user.token,
        data: {
          runId: run.id,
          roleId: role.id,
          actionType: userIndex === 0 ? "investigate" : "observe",
          targetText: node.title,
          method: `${role.roleName}准备${actionText}，只描述尝试过程。`,
          intent: `帮助团队理解「${node.title}」背后的异常，不直接宣布结果。`,
          riskLevel: nodeIndex >= 4 ? "risky" : "normal",
          freeText: ""
        }
      });
      if (result.status !== "accepted") throw new Error(`Action rejected at node ${nodeIndex}: ${JSON.stringify(result)}`);
      submittedActions.push(result);
    }

    const actions = await request<any[]>(`/nodes/${node.id}/actions`, { token: users[0].token });
    if (actions.length !== 3) throw new Error(`Expected 3 actions at node ${nodeIndex}, got ${actions.length}`);

    const resolution = await request<any>(`/nodes/${node.id}/resolve`, { method: "POST", token: users[0].token });
    if (!resolution.id || !resolution.summary) throw new Error(`Missing resolution at node ${nodeIndex}`);
    if (!resolution.echoesJson?.length) throw new Error(`Missing echoesJson at node ${nodeIndex}`);
    if (!resolution.crossImpactsJson?.length) throw new Error(`Missing crossImpactsJson at node ${nodeIndex}`);

    report.nodes.push({
      nodeIndex,
      nodeId: node.id,
      title: node.title,
      submittedActions,
      actionCount: actions.length,
      resolutionId: resolution.id,
      resolutionSummary: resolution.summary,
      dangerAfter: resolution.dangerAfter
    });
  }

  const finalState = await request<any>(`/story-runs/${run.id}/state`, { token: users[0].token });
  const chapter = finalState.chapters?.[0];
  if (!chapter?.id) throw new Error("Expected generated chapter after 5 nodes");
  const chapterDetail = await request<any>(`/chapters/${chapter.id}`, { token: users[0].token });
  if (!chapterDetail.shareTokens?.length) throw new Error("Expected share token for generated chapter");
  if (!chapterDetail.povSectionsJson?.length) throw new Error("Expected povSectionsJson for generated chapter");
  if (!chapterDetail.personalCardsJson?.length) throw new Error("Expected personalCardsJson for generated chapter");

  report.chapter = {
    id: chapterDetail.id,
    title: chapterDetail.title,
    nextHook: chapterDetail.nextHook,
    povSectionCount: chapterDetail.povSectionsJson.length,
    personalCardCount: chapterDetail.personalCardsJson.length,
    shareTokens: chapterDetail.shareTokens.map((item: any) => item.token)
  };

  const insights = await request<any>(`/story-runs/${run.id}/insights`, { token: users[0].token });
  if (!insights.latestResolution?.echoesJson?.length) throw new Error("Expected latest insight echoes");
  const dashboard = await request<any>("/admin/dashboard", { token: users[0].token });
  const adminRuns = await request<any[]>("/admin/story-runs", { token: users[0].token });
  const aiTasks = await request<any[]>("/admin/ai-tasks", { token: users[0].token });
  const auditLogs = await request<any[]>("/admin/audit-logs", { token: users[0].token });
  const eventLogs = await request<any[]>("/admin/event-logs", { token: users[0].token });
  const actionGuard = await request<any>("/admin/action-guard", { token: users[0].token });
  if (!adminRuns.length || !aiTasks.length || !auditLogs.length || !eventLogs.length || !actionGuard.blockedAudits?.length) {
    throw new Error("Expected admin observability data for runs/tasks/audit/events/actionguard");
  }
  report.admin = {
    dashboard,
    runCount: adminRuns.length,
    aiTaskCount: aiTasks.length,
    auditLogCount: auditLogs.length,
    eventLogCount: eventLogs.length,
    actionGuardBlockedCount: actionGuard.blockedAudits.length
  };

  await mkdir("scripts/test-reports", { recursive: true });
  const output = join("scripts/test-reports", `story-e2e-${run.id}.json`);
  await writeFile(output, JSON.stringify(report, null, 2), "utf8");
  console.log(`Multi-role story E2E passed. Report: ${output}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
