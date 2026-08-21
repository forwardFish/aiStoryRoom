const PRESSURE_SCHEMA = "pressure_chapter_game_projection_v1";
const PRESSURE_COMMAND_SCHEMA = "pressure_chapter_game_command_v1";
const PRESSURE_SUBMIT_RESPONSE_SCHEMA = "pressure_chapter_submit_decision_http_response_v1";
const PRESSURE_NARRATIVE_UPDATE_SCHEMA = "pressure_game_narrative_update_v1";
const PRESSURE_TURN_RECEIPT_SCHEMA = "pressure_post_commit_turn_receipt_v1";
const PRESSURE_TURN_UPDATE_SCHEMA = "pressure_post_commit_turn_update_v1";

const METRIC_PRESENTATION = [
  ["fiscal_military", "国库银两"],
  ["civilian_land", "民心"],
  ["evidence_responsibility", "真相进展"],
  ["mulberry_silk", "改桑进度"],
  ["court_imperial_face", "皇帝信任"],
];

const ROLE_PRESENTATION = {
  zhejiang_governor: { name: "胡宗宪", rank: "浙直总督", office: "总督浙江军务兼理粮饷", portrait: "/assets/game/sangtian/generated/role-governor-scene-v1.png" },
  zhejiang_administration: { name: "郑泌昌", rank: "浙江巡抚", office: "统理浙江民政与钱粮", portrait: "/assets/game/sangtian/generated/role-xunfu-scene-v1.png" },
  qingliu_law: { name: "海瑞", rank: "清流法度", office: "督察法纪与账册证据", portrait: "/assets/game/sangtian/generated/governor-scene-v1.png" },
  cabinet_finance: { name: "户部度支", rank: "内阁财政", office: "核算国帑与军饷", portrait: "/assets/game/sangtian/generated/role-clerk-scene-v1.png" },
  jiangnan_merchant: { name: "江南商会", rank: "江南商会", office: "联络粮、银、船运与信用", portrait: "/assets/game/sangtian/generated/role-merchant-scene-v1.png" },
  sili_weaving: { name: "司礼监织造", rank: "内廷织造", office: "承接内廷与江南织造事务", portrait: "/assets/game/sangtian/generated/role-spy-scene-v1.png" },
};

export class PressureMainGameStorageV1 {
  constructor({
    runId,
    initialProjection,
    fetchImpl = globalThis.fetch?.bind(globalThis),
    createIdempotencyKey,
    narrativePollIntervalMs = 300,
    narrativePollAttempts = 20,
    turnPollIntervalMs = 500,
    turnPollAttempts = 80,
    waitImpl = defaultWait,
  } = {}) {
    if (!runId) throw new TypeError("PressureMainGameStorageV1 requires runId");
    if (typeof fetchImpl !== "function") throw new TypeError("PressureMainGameStorageV1 requires fetch");
    this.runId = runId;
    this.savedRunId = runId;
    this.projection = assertProjection(initialProjection, runId);
    this.fetchImpl = fetchImpl;
    this.createIdempotencyKey = createIdempotencyKey || defaultIdempotencyKey;
    this.narrativePollIntervalMs = narrativePollIntervalMs;
    this.narrativePollAttempts = narrativePollAttempts;
    this.turnPollIntervalMs = turnPollIntervalMs;
    this.turnPollAttempts = turnPollAttempts;
    this.waitImpl = waitImpl;
    this.asyncViewHandler = null;
  }

  async restoreOrCreate() {
    return this.toView(this.projection);
  }

  async getRun() {
    this.projection = await this.request(`/api/v4/rooms/${encodeURIComponent(this.runId)}/game`);
    return this.toView(this.projection);
  }

  async createRun() {
    return this.getRun();
  }

  subscribeAsyncUpdates(handler) {
    this.asyncViewHandler = typeof handler === "function" ? handler : null;
    return () => {
      if (this.asyncViewHandler === handler) this.asyncViewHandler = null;
    };
  }

  async submitDecision(_view, { optionKey, customText } = {}) {
    const projection = this.projection;
    const decision = projection.decision;
    if (!decision || projection.capabilities?.canSubmitDecision !== true) {
      throw new Error("当前还不能提交这项决定。");
    }
    const option = decision.options.find((item, index) => optionLabel(index) === optionKey);
    const custom = String(customText || "").trim();
    if (!option && !custom) throw new Error("请选择一项决定，或写下你的处理方式。");
    const idempotencyKey = this.createIdempotencyKey();
    const command = {
      schemaVersion: PRESSURE_COMMAND_SCHEMA,
      commandType: "SUBMIT_DECISION",
      runId: projection.runId,
      routeHash: projection.route.routeHash,
      chapterRuntimeId: projection.chapter.chapterRuntimeId,
      chapterId: projection.chapter.chapterId,
      decisionPointId: decision.decisionPointId,
      seatId: projection.viewer.seatId,
      controlEpoch: projection.viewer.control.controlEpoch,
      expectedWorkingRevision: decision.expectedWorkingRevision,
      submissionFenceToken: projection.viewer.control.submissionFenceToken,
      idempotencyKey,
      optionCode: option?.code ?? null,
      customText: custom || null,
      sourceEventId: null,
    };
    const response = await this.fetchImpl(`/api/v4/rooms/${encodeURIComponent(this.runId)}/game/action`, {
      method: "POST",
      credentials: "include",
      headers: { accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify(command),
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      console.error("Pressure decision request failed", JSON.stringify({
        status: response.status,
        code: typeof payload?.code === "string" ? payload.code : "UNKNOWN",
        path: typeof payload?.path === "string" ? payload.path : "pressureChapter",
      }));
      throw httpError(response, payload, "这项决定暂时无法提交。");
    }
    if (
      payload?.schemaVersion !== PRESSURE_SUBMIT_RESPONSE_SCHEMA
      || payload?.idempotencyKey !== idempotencyKey
    ) {
      throw new Error("决定响应与本次提交不一致。");
    }
    if (payload.projection === null && payload.receipt) {
      const receipt = assertTurnReceipt(payload.receipt, projection);
      void this.waitForTurnUpdate(receipt).then((readyProjection) => {
        if (!readyProjection) return;
        this.projection = assertProjection(readyProjection, this.runId);
        this.asyncViewHandler?.(this.toView(this.projection));
      }).catch(() => {});
      return pendingTurnView(this.toView(this.projection), receipt);
    }
    this.projection = assertProjection(payload.projection, this.runId);
    if (needsNarrativeUpdate(this.projection)) {
      this.projection = await this.waitForNarrativeUpdate(this.projection);
    }
    return this.toView(this.projection);
  }

  async waitForNarrativeUpdate(projection) {
    for (let attempt = 0; attempt < this.narrativePollAttempts; attempt += 1) {
      if (attempt > 0) await this.waitImpl(this.narrativePollIntervalMs);
      const chapterRuntimeId = projection.chapter.chapterRuntimeId;
      const response = await this.fetchImpl(
        `/api/v4/rooms/${encodeURIComponent(this.runId)}/game/narrative-update?chapterRuntimeId=${encodeURIComponent(chapterRuntimeId)}`,
        { credentials: "include", headers: { accept: "application/json" } },
      );
      const update = await response.json().catch(() => null);
      if (!response.ok) throw httpError(response, update, "下一段剧情暂时无法读取。");
      assertNarrativeUpdate(update, projection);
      if (update.narrative) {
        projection = { ...projection, narrative: update.narrative };
      }
      if (!needsNarrativeUpdate(projection)) return projection;
    }
    return projection;
  }

  async waitForTurnUpdate(receipt) {
    for (let attempt = 0; attempt < this.turnPollAttempts; attempt += 1) {
      if (attempt > 0) await this.waitImpl(this.turnPollIntervalMs);
      const query = new URLSearchParams({
        chapterRuntimeId: receipt.chapterRuntimeId,
        updateKey: receipt.updateKey,
      });
      const response = await this.fetchImpl(
        `/api/v4/rooms/${encodeURIComponent(this.runId)}/game/narrative-update?${query}`,
        { credentials: "include", headers: { accept: "application/json" } },
      );
      const update = await response.json().catch(() => null);
      if (!response.ok) throw httpError(response, update, "下一段剧情暂时无法读取。");
      assertTurnUpdate(update, receipt);
      if (update.status === "STREAMING") {
        this.asyncViewHandler?.(streamingTurnView(
          this.toView(this.projection),
          receipt,
          update.sceneText,
        ));
        continue;
      }
      if (update.status === "READY") return assertProjection(update.projection, this.runId);
      if (update.status === "FAILED" || update.status === "EXPIRED") {
        return this.request(`/api/v4/rooms/${encodeURIComponent(this.runId)}/game`);
      }
    }
    return null;
  }

  async confirmChapterSummary(_view) {
    const projection = this.projection;
    const summary = projection.chapterSummary;
    if (!summary || summary.confirmationState === "CONFIRMED") return this.toView(projection);
    const sourceChapterRuntimeId = String(summary.sourceChapterRuntimeId || "");
    if (!sourceChapterRuntimeId) throw new Error("章末总结缺少来源章节，无法安全确认。");
    const idempotencyKey = `chapter-summary:${projection.runId}:${sourceChapterRuntimeId}:${projection.viewer.seatId}`;
    const command = {
      schemaVersion: PRESSURE_COMMAND_SCHEMA,
      commandType: "CONFIRM_CHAPTER_SUMMARY",
      runId: projection.runId,
      routeHash: projection.route.routeHash,
      chapterRuntimeId: sourceChapterRuntimeId,
      chapterId: summary.chapterId,
      seatId: projection.viewer.seatId,
      controlEpoch: projection.viewer.control.controlEpoch,
      expectedWorkingRevision: projection.chapter.workingRevision,
      submissionFenceToken: projection.viewer.control.submissionFenceToken,
      idempotencyKey,
    };
    const response = await this.fetchImpl(`/api/v4/rooms/${encodeURIComponent(this.runId)}/game/action`, {
      method: "POST",
      credentials: "include",
      headers: { accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify(command),
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) throw httpError(response, payload, "暂时无法进入下一章，请重试。");
    if (payload?.schemaVersion !== "pressure_chapter_summary_confirmation_response_v2" || payload?.idempotencyKey !== idempotencyKey) {
      throw new Error("章末确认响应与本次请求不一致。");
    }
    this.projection = await this.request(`/api/v4/rooms/${encodeURIComponent(this.runId)}/game`);
    return this.toView(this.projection);
  }

  async submitManeuver() {
    throw new Error("主动谋划将在基础主游戏页恢复后继续接入。");
  }

  toView(projection) {
    return pressureProjectionToMainGameViewV1(projection);
  }

  async request(path) {
    const response = await this.fetchImpl(path, {
      credentials: "include",
      headers: { accept: "application/json" },
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) throw httpError(response, payload, "暂时无法读取故事局。" );
    return assertProjection(payload, this.runId);
  }

}

export function pressureProjectionToMainGameViewV1(projectionValue) {
  const projection = assertProjection(projectionValue, projectionValue?.runId);
  const role = ROLE_PRESENTATION[projection.viewer.seatId] || {
    name: projection.viewer.roleName,
    rank: projection.viewer.roleName,
    office: projection.viewer.roleName,
  };
  const decision = projection.decision;
  const canSubmit = Boolean(
    decision
    && projection.capabilities?.canSubmitDecision === true
    && projection.viewer.control?.mode === "HUMAN_ACTIVE",
  );
  const decisionNarrative = decisionNarrativeText(projection);
  const narrativePending = Boolean(decision && !decisionNarrative);
  const resources = projection.resources.map((item) => ({
    resourceId: item.resourceId,
    name: item.label,
    value: item.displayValue,
  }));
  const tokens = projection.tokens.filter((item) => item.available && item.quantity > 0);
  return {
    continuousV2: true,
    locale: "zh-CN",
    run: {
      id: projection.runId,
      storyId: "sangtian",
      title: projection.chapter.title,
      location: "浙江",
      currentDay: projection.chapter.chapterNumber,
      currentTime: projection.chapter.title,
      totalDays: 7,
      status: projection.chapter.phase === "ACTIVE" && !narrativePending ? "awaiting_decision" : "resolving",
      version: projection.projectionVersion,
      decisionsCompletedToday: 0,
      decisionsRequiredToday: 1,
      totalDecisionsCompleted: Math.max(0, projection.chapter.chapterNumber - 1),
      totalDecisionsRequired: 7,
    },
    v2CurrentTurn: {
      stageIndex: projection.chapter.chapterNumber,
      turnIndex: Math.max(1, projection.chapter.workingRevision + 1),
      title: projection.chapter.title,
      status: projection.chapter.phase === "ACTIVE" && !narrativePending ? "OPEN" : "RESOLVING",
    },
    player: {
      roleName: projection.viewer.roleName,
      name: role.name,
      rank: role.rank,
      office: role.office,
      fateQuestion: projection.situation.goal,
      goals: [projection.situation.goal, projection.situation.risk].filter(Boolean),
      resources,
      leverage: tokens.map((item) => item.label),
    },
    presentation: {
      locale: "zh-CN",
      title: "嘉靖财政危局",
      locationLabel: "浙江",
      totalStages: 7,
      sceneBackground: "/assets/game/sangtian/background.png",
      playerPortrait: role.portrait,
      accent: "#6545f5",
      accentSoft: "#f3f0ff",
    },
    openingNarrative: projection.narrative.text || projection.decision?.summary || projection.chapter.title,
    decisionNarrative,
    messages: [],
    activeDecision: canSubmit && !narrativePending ? {
      messageId: decision.decisionPointId,
      title: decision.title,
      options: decision.options.map((item, index) => ({
        key: optionLabel(index),
        title: item.label,
        body: item.description,
      })),
    } : null,
    dashboard: {
      statusMetrics: metricPresentation(projection.metrics),
      worldState: metricPresentation(projection.metrics).map((item) => [item.label, item.value]),
      relationships: [],
      risks: [],
      traces: [],
      visibleCausalCard: null,
      causalRecallMessages: [],
    },
    decisionHistory: [],
    dayProgress: { completed: 0, required: 1 },
    leverageHand: {
      items: tokens.map((item) => ({ label: item.label, description: item.description })),
    },
    maneuverPanel: pressureManeuverPanel(projection),
    pressureProjection: projection,
  };
}

function decisionNarrativeText(projection) {
  if (!projection.decision) return "";
  const summary = String(projection.decision.summary || "").trim();
  if (projection.narrative?.projectionKind === "GENESIS_NARRATIVE") return summary;
  const published = projection.narrative?.status === "PUBLISHED"
    || projection.narrative?.status === "FALLBACK_PUBLISHED";
  const narrative = String(projection.narrative?.text || "").trim();
  if (!published) return "";
  return [...summary].length >= 30 ? summary : [...narrative].length >= 30 ? narrative : "";
}

function pressureManeuverPanel(projection) {
  const optionsFor = (entry) => projection.decision?.options.filter((item) => item.preferredEntry === entry) || [];
  const enabled = projection.chapter.phase === "ACTIVE";
  const disabledReason = enabled ? null : "当前章节正在推进，请稍候";
  return {
    enabled,
    disabledReason,
    quota: { perDay: 2, remaining: 2, usedToday: 0, usedTypesToday: [] },
    contact: { enabled: false, disabledReason: "人物交谈暂不可用", options: [] },
    investigate: {
      enabled: enabled && projection.capabilities?.canInvestigate === true && optionsFor("INVESTIGATE").length > 0,
      disabledReason: optionsFor("INVESTIGATE").length ? disabledReason : "当前无调查事项",
      options: optionsFor("INVESTIGATE").map((item) => ({ intentKey: item.code, title: item.label, summary: item.description })),
    },
    leverage: {
      enabled: false,
      disabledReason: "当前无合适出牌时机",
      options: [],
    },
    custom: {
      enabled: false,
      disabledReason: "自拟谋划暂不可用",
      maxLength: 200,
    },
  };
}

function metricPresentation(metrics) {
  return METRIC_PRESENTATION.map(([trackId, fallbackLabel]) => {
    const source = metrics.find((metric) => metric.trackId === trackId);
    return {
      label: String(source?.label || fallbackLabel),
      value: source?.value ?? 0,
      suffix: trackId === "mulberry_silk" ? "%" : "",
      tone: String(source?.tone || "DEFAULT").toLowerCase(),
    };
  });
}

function assertProjection(value, expectedRunId) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("故事投影格式无效。");
  if (value.schemaVersion !== PRESSURE_SCHEMA) throw new Error("故事投影版本不受支持。");
  if (expectedRunId && value.runId !== expectedRunId) throw new Error("故事投影属于另一局游戏。");
  return value;
}

function needsNarrativeUpdate(projection) {
  if (!projection?.decision) return false;
  const status = projection.narrative?.status;
  return status !== "PUBLISHED" && status !== "FALLBACK_PUBLISHED";
}

function assertNarrativeUpdate(value, projection) {
  if (
    !value
    || value.schemaVersion !== PRESSURE_NARRATIVE_UPDATE_SCHEMA
    || value.runId !== projection.runId
    || value.routeHash !== projection.route.routeHash
    || value.chapterRuntimeId !== projection.chapter.chapterRuntimeId
    || value.viewerSeatId !== projection.viewer.seatId
  ) {
    throw new Error("剧情更新与当前游戏不一致。");
  }
  return value;
}

function assertTurnReceipt(value, projection) {
  if (
    !value
    || value.schemaVersion !== PRESSURE_TURN_RECEIPT_SCHEMA
    || value.runId !== projection.runId
    || value.chapterRuntimeId !== projection.chapter.chapterRuntimeId
    || value.chapterId !== projection.chapter.chapterId
    || value.viewerSeatId !== projection.viewer.seatId
    || value.status !== "ACTION_SAVED"
    || !/^[a-f0-9]{64}$/.test(String(value.updateKey || ""))
    || typeof value.savedActionId !== "string"
    || !value.savedActionId
  ) throw new Error("行动保存回执与当前游戏不一致。");
  return value;
}

function assertTurnUpdate(value, receipt) {
  if (
    !value
    || value.schemaVersion !== PRESSURE_TURN_UPDATE_SCHEMA
    || value.runId !== receipt.runId
    || value.updateKey !== receipt.updateKey
    || value.chapterRuntimeId !== receipt.chapterRuntimeId
    || !["PENDING", "STREAMING", "READY", "FAILED", "EXPIRED"].includes(value.status)
    || (value.status === "READY") !== Boolean(value.projection)
    || (value.status === "STREAMING") !== Boolean(String(value.sceneText || "").trim())
  ) throw new Error("剧情与局势更新回执无效。");
  return value;
}

function streamingTurnView(view, receipt, sceneText) {
  const narrative = String(sceneText || "").trim();
  return {
    ...view,
    run: {
      ...view.run,
      status: "awaiting_decision",
    },
    v2CurrentTurn: {
      ...view.v2CurrentTurn,
      title: "下一段剧情正在生成",
      status: "OPEN",
    },
    decisionNarrative: narrative,
    narrativeStreaming: true,
    activeDecision: {
      messageId: receipt.nextDecisionPointId || receipt.nextBeatId || receipt.savedActionId,
      title: "剧情生成中",
      options: [],
    },
    postCommitReceipt: structuredClone(receipt),
  };
}

function pendingTurnView(view, receipt) {
  return {
    ...view,
    run: {
      ...view.run,
      status: "resolving",
    },
    v2CurrentTurn: {
      ...view.v2CurrentTurn,
      title: "行动已保存，下一段剧情正在生成",
      status: "RESOLVING",
    },
    activeDecision: null,
    postCommitReceipt: structuredClone(receipt),
  };
}

function defaultWait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function httpError(response, payload, fallback) {
  const error = new Error(typeof payload?.message === "string" && payload.message.trim() ? payload.message : fallback);
  error.status = response.status;
  error.code = payload?.code;
  error.details = payload?.details;
  return error;
}

function optionLabel(index) {
  return String.fromCharCode("A".charCodeAt(0) + index);
}

function defaultIdempotencyKey() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `decision-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
