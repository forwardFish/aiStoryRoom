import { gamePresentationFromProjection, gameRoleFromProjection, gameWorldFromProjection } from "./game-world-view.js";

export class RoomStoryStorage {
  constructor({ roomId, initialModel = null, fetchImpl = globalThis.fetch?.bind(globalThis), localStorage = globalThis.localStorage } = {}) {
    if (!roomId) throw new TypeError("RoomStoryStorage requires a room id");
    if (typeof fetchImpl !== "function") throw new TypeError("RoomStoryStorage requires fetch");
    this.roomId = roomId;
    this.savedRunId = roomId;
    this.model = initialModel;
    this.fetchImpl = fetchImpl;
    this.localStorage = localStorage;
    this.kind = "room";
  }

  async request(path, options = {}) {
    const response = await this.fetchImpl(path, {
      ...options,
      credentials: "include",
      headers: { accept: "application/json", "content-type": "application/json", ...(options.headers || {}) }
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(data.message || data.code || `请求失败（HTTP ${response.status}）`);
      error.code = data.code;
      error.details = data.details;
      throw error;
    }
    return data;
  }

  async restoreOrCreate() {
    if (!this.model) this.model = await this.request(`/api/v4/rooms/${encodeURIComponent(this.roomId)}/game`);
    return this.toFormalView(this.model);
  }

  async getRun() {
    this.model = await this.request(`/api/v4/rooms/${encodeURIComponent(this.roomId)}/game`);
    return this.toFormalView(this.model);
  }

  async createRun() { return this.getRun(); }

  async submitDecision(_view, { optionKey, customText } = {}) {
    const options = roomActionOptions(this.model?.currentNode);
    const index = Math.max(0, "ABCD".indexOf(String(optionKey || "A")));
    const selected = options[index] || options[0];
    const actionTypes = ["observe", "investigate", "negotiate", "support"];
    this.model = await this.request(`/api/v4/rooms/${encodeURIComponent(this.roomId)}/game/action`, {
      method: "POST",
      body: JSON.stringify({
        actionType: actionTypes[index] || "observe",
        targetText: selected,
        method: String(customText || "").trim() || selected,
        intent: `以${selected}影响本轮共同局势。`,
        riskLevel: index >= 2 ? "risky" : index === 1 ? "normal" : "safe"
      })
    });
    return this.toFormalView(this.model);
  }

  async resolveRoomRound() {
    const task = await this.request(`/api/v4/rooms/${encodeURIComponent(this.roomId)}/game/resolve-async`, { method: "POST", body: "{}" });
    const deadline = Date.now() + 90_000;
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      const status = await this.request(`/api/v4/rooms/${encodeURIComponent(this.roomId)}/game/tasks/${encodeURIComponent(task.taskId)}`);
      if (status.status === "completed") return this.getRun();
      if (status.status === "failed") throw new Error(status.lastError || "AI 推演失败，请重试。");
    }
    return this.getRun();
  }

  toFormalView(model) {
    const room = model.room;
    const world = gameWorldFromProjection(model);
    const presentation = gamePresentationFromProjection(world);
    const role = gameRoleFromProjection(world, room.roles.find((item) => item.claimedByCurrentUser) || {});
    const player = room.players.find((item) => item.roleId === role.id) || {};
    const submitted = new Set(model.submittedRoleIds || []);
    const ownSubmitted = Boolean(role.id && submitted.has(role.id));
    const activePlayers = room.players.filter((item) => item.roleId);
    const allSubmitted = activePlayers.length > 0 && activePlayers.every((item) => submitted.has(item.roleId));
    const round = Number(model.currentNode?.nodeIndex || 7);
    const profile = role.gameplayProfile || roleProfile(role.roleKey, role.roleName);
    const completedRounds = Math.max(0, round - 1);
    const options = roomActionOptions(model.currentNode).map((title, index) => ({ key: "ABCD"[index], title, body: title }));
    const completed = Boolean(model.completed || room.status === "chapter_generated");
    const resolving = room.status === "resolving";

    return {
      run: {
        id: room.id,
        storyId: world?.worldId || room.worldId,
        title: presentation.title || room.title,
        location: presentation.locationLabel,
        currentDay: round,
        currentTime: resolving ? "共同推演中" : "共同决策",
        totalDays: presentation.totalStages,
        status: completed ? "room_complete" : resolving ? "room_resolving" : ownSubmitted ? "room_waiting" : "awaiting_decision",
        version: round,
        decisionsCompletedToday: ownSubmitted ? 1 : 0,
        decisionsRequiredToday: 1,
        totalDecisionsCompleted: completedRounds + (ownSubmitted ? 1 : 0),
        totalDecisionsRequired: 7
      },
      player: {
        roleName: role.roleName || profile.roleName,
        name: profile.characterName || player.nickname || (presentation.locale === "en" ? "Player" : "玩家"),
        rank: profile.rank,
        office: profile.office,
        fateQuestion: profile.fateQuestion || role.personalGoal || role.identity,
        goals: [model.currentNode?.nodeGoal, ...(profile.goals || []), profile.goal].filter(Boolean),
        resources: (profile.resources || []).map((item) => Array.isArray(item) ? item : [item.label, item.value]),
        leverage: profile.leverage
      },
      locale: presentation.locale,
      presentation: { ...presentation, playerPortrait: role.portrait },
      openingNarrative: model.currentNode?.publicNarration || "",
      messages: model.currentNode ? [{
        id: model.currentNode.id,
        day: round,
        time: "共同决策",
        type: "system",
        label: "本轮局势",
        title: model.currentNode.title,
        body: model.currentNode.publicNarration
      }] : [],
      activeDecision: !completed && !resolving && !ownSubmitted ? {
        messageId: model.currentNode.id,
        title: model.currentNode.title,
        options
      } : null,
      dashboard: {
        worldState: presentation.statusMetrics.map((metric) => [metric.key, metric.value]),
        statusMetrics: presentation.statusMetrics,
        relationships: activePlayers.filter((item) => item.roleId !== role.id).map((item) => ({ name: item.roleName, person: item.nickname, stance: submitted.has(item.roleId) ? "已决策" : "思考中", score: submitted.has(item.roleId) ? 60 : 45 })),
        risks: [["改桑期限", "高"], ["三方权责冲突", "中"]],
        traces: [],
        visibleCausalCard: null,
        causalRecallMessages: []
      },
      publicRoleInferences: activePlayers.filter((item) => item.roleId !== role.id).map((item) => ({ publicIdentity: item.roleName, publicGoal: submitted.has(item.roleId) ? "本轮行动已提交" : "正在判断本轮局势", observableSignals: [item.nickname] })),
      decisionHistory: ownSubmitted ? [{ day: round, decisionIndex: 1, optionKey: "A", title: "本轮决策已提交" }] : [],
      dayProgress: { completed: ownSubmitted ? 1 : 0, required: 1 },
      daySummary: null,
      daySummaries: {},
      maneuverState: { maneuverOpportunitiesPerDay: 0, maneuverOpportunitiesRemaining: 0 },
      roomSession: {
        room,
        role,
        player,
        submittedRoleIds: [...submitted],
        ownSubmitted,
        allSubmitted,
        resolving,
        completed,
        round
      }
    };
  }
}

function roomActionOptions(node = {}) {
  const options = Array.isArray(node?.actionOptions) ? node.actionOptions.filter(Boolean).slice(0, 4) : [];
  return options.length ? options : ["保留证据并交叉核验", "推进本职方案并说明代价", "协调另一位角色的资源"];
}

function roleProfile(roleKey, roleName) {
  const profiles = {
    zhejiang_governor: { roleName: "浙江总督", rank: "从一品", office: "总督浙江军务", fateQuestion: "保浙江，还是保自己？", goal: "稳定财政、民心与海防", resources: [["总督府幕僚", "4人"], ["军政文移", "可调阅"]], leverage: ["海防军报", "入京奏报权"] },
    xunfu: { roleName: "浙江巡抚", rank: "正二品", office: "巡抚浙江", fateQuestion: "交出政绩，还是留下退路？", goal: "完成改桑并控制问责边界", resources: [["巡抚衙门", "可调度"], ["改桑奏疏", "1份"]], leverage: ["巡按记录", "地方官考成"] },
    county_magistrate: { roleName: "清流县令", rank: "正七品", office: "清流县衙", fateQuestion: "保住民田，还是服从上命？", goal: "保护民田和地方粮仓", resources: [["田亩底册", "1套"], ["县衙差役", "12人"]], leverage: ["民田实测册", "地方士绅证词"] },
    merchant: { roleName: "江南商会", rank: "商会会首", office: "江南粮路与丝路", fateQuestion: "保住商路，还是成为替罪羊？", goal: "维持商路并避免被吞并", resources: [["粮船", "可调度"], ["商会账本", "1套"]], leverage: ["粮路银票", "商会往来账"] }
  };
  return profiles[roleKey] || { roleName: roleName || "玩家角色", rank: "共同故事局成员", office: "杭州局势参与者", fateQuestion: "你会为自己的选择付出什么？", goal: "完成本轮共同决策", resources: [["角色权限", "可用"]], leverage: ["本职证据"] };
}
