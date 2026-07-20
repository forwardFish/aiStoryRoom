const SCHEMA = "continuous_game_projection_v2";

export class ContinuousStoryV2LegacyStorage {
  constructor({ runId, initialProjection, fetchImpl }) {
    if (!runId || typeof fetchImpl !== "function") throw new TypeError("V2 legacy storage requires runId and fetch");
    this.savedRunId = runId;
    this.runId = runId;
    this.fetchImpl = fetchImpl;
    this.projection = requireProjection(initialProjection);
  }

  async restoreOrCreate() {
    return adaptProjection(this.projection);
  }

  async getRun() {
    this.projection = requireProjection(await this.request(`/api/v4/rooms/${encodeURIComponent(this.runId)}/game?projectionTs=${Date.now()}`));
    if (this.projection.currentTurn?.status === "RESOLVING") {
      await this.request(`/api/v4/rooms/${encodeURIComponent(this.runId)}/game/generation/retry`, { method: "POST" });
    }
    return adaptProjection(this.projection);
  }

  async submitDecision(_view, command = {}) {
    const projection = this.projection;
    const turn = projection.currentTurn;
    if (!turn || !projection.control?.canHumanAct) throw new Error("当前角色暂时不能作出决策。");
    if (projection.access?.state === "REQUIRES_UNLOCK") throw new Error("这条故事线需要先解锁，才能继续作出决策。");

    const customText = String(command.customText || "").trim();
    const choices = visibleChoices(projection);
    const choiceIndex = Math.max(0, String(command.optionKey || "A").charCodeAt(0) - 65);
    const selected = choices[choiceIndex] || choices[0] || null;
    if (!customText && !selected) throw new Error("当前剧情还没有可提交的真实决策。");

    const interaction = activeInteraction(projection);
    const intent = customText ? customIntent(turn, customText) : clone(selected.intentDraft);
    const body = {
      idempotencyKey: uniqueKey(interaction ? "interaction" : "turn", turn.id),
      turnRevision: turn.revision,
      controlEpoch: projection.control.epoch,
      intent,
      decisionForm: "STORY_CHOICE",
      ...(interaction ? { interactionId: interaction.id, customAction: customText || intent.method } : customText ? { customAction: customText } : { candidateId: selected.id })
    };
    const endpoint = interaction
      ? `/api/v4/rooms/${encodeURIComponent(this.runId)}/interactions/${encodeURIComponent(interaction.id)}/reply`
      : `/api/v4/rooms/${encodeURIComponent(this.runId)}/game/turns/${encodeURIComponent(turn.id)}/decision`;
    let response;
    try {
      response = await this.request(endpoint, { method: "POST", body: JSON.stringify(body) });
    } catch (error) {
      // A double click, another tab, or a poll can observe the authoritative
      // turn after the submission has already moved it forward.  Refresh the
      // database projection instead of showing a stale English conflict toast
      // or letting the old choice be submitted again.
      if (["TURN_MOVED", "STORY_GENERATION_IN_PROGRESS"].includes(error?.code)) {
        return this.getRun();
      }
      throw error;
    }
    this.projection = requireProjection(response.gameProjection);
    return adaptProjection(this.projection, { resolution: response.resolution || null });
  }

  async submitManeuver(_view, draft = {}) {
    const projection = this.projection;
    const turn = projection.currentTurn;
    if (!turn || !projection.control?.canHumanAct) throw new Error("当前角色暂时不能作出决策。");
    if (projection.access?.state === "REQUIRES_UNLOCK") throw new Error("这条故事线需要先解锁，才能继续作出决策。");

    const maneuver = maneuverCommand(projection, draft);
    const body = {
      idempotencyKey: uniqueKey(`maneuver-${maneuver.decisionForm.toLowerCase()}`, turn.id),
      turnRevision: turn.revision,
      controlEpoch: projection.control.epoch,
      decisionForm: maneuver.decisionForm,
      customAction: maneuver.actionText,
      intent: maneuver.intent
    };
    let response;
    try {
      response = await this.request(`/api/v4/rooms/${encodeURIComponent(this.runId)}/game/turns/${encodeURIComponent(turn.id)}/decision`, {
        method: "POST",
        body: JSON.stringify(body)
      });
    } catch (error) {
      if (["TURN_MOVED", "STORY_GENERATION_IN_PROGRESS"].includes(error?.code)) return this.getRun();
      throw error;
    }
    this.projection = requireProjection(response.gameProjection);
    return adaptProjection(this.projection, { resolution: response.resolution || null, decisionForm: maneuver.decisionForm });
  }

  async startCriticalResponse() { return this.getRun(); }
  async deferCriticalEvent() { return this.getRun(); }
  async advanceDay() { return this.getRun(); }
  async finalize() { return this.getRun(); }
  async createRun() { throw new Error("请返回角色选择页开始新的故事局。"); }

  async heartbeat(sessionInstanceId, heartbeatSequence) {
    return this.request(`/api/v4/rooms/${encodeURIComponent(this.runId)}/presence/heartbeat`, {
      method: "POST",
      body: JSON.stringify({ sessionInstanceId, heartbeatSequence, lastAppliedDeliverySequence: this.projection.worldSequence })
    });
  }

  async changeControl(kind) {
    const path = kind === "handoff" ? "handoff-to-ai" : "reclaim";
    const response = await this.request(`/api/v4/rooms/${encodeURIComponent(this.runId)}/game/control/${path}`, {
      method: "POST",
      body: JSON.stringify({ idempotencyKey: uniqueKey(kind, this.runId), expectedControlEpoch: this.projection.control.epoch })
    });
    this.projection = requireProjection(response.gameProjection);
    return adaptProjection(this.projection);
  }

  async loadResult() {
    return this.request(`/api/v4/rooms/${encodeURIComponent(this.runId)}/result`);
  }

  async request(path, init = {}) {
    const response = await this.fetchImpl(path, {
      credentials: "include",
      cache: "no-store",
      headers: { accept: "application/json", ...(init.body ? { "content-type": "application/json" } : {}) },
      ...init
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(payload?.message || payload?.code || "故事服务暂时无法完成这次操作。");
      error.code = payload?.code || "STORY_REQUEST_FAILED";
      error.details = payload;
      throw error;
    }
    return payload;
  }
}

export function adaptProjection(projection, { resolution = null, decisionForm = null } = {}) {
  const p = requireProjection(projection);
  const turn = p.currentTurn;
  const results = p.timeline.filter((entry) => entry.kind === "RESULT");
  const choices = visibleChoices(p);
  const options = choices.map((choice, index) => ({
    optionKey: String.fromCharCode(65 + index),
    key: String.fromCharCode(65 + index),
    title: choice.label,
    body: choice.description,
    candidateId: choice.id
  }));
  const messages = p.timeline.map((entry, index) => {
    const latestResult = entry.kind === "RESULT" && entry.id === results.at(-1)?.id;
    const entryDecisionForm = normalizeDecisionForm(entry.decisionForm || (latestResult ? decisionForm : null));
    const maneuverResult = entry.kind === "RESULT" && isManeuverDecisionForm(entryDecisionForm);
    const nextStory = latestResult && turn?.narrative && !containsStory(entry.content, turn.narrative)
      ? `\n\n${turn.narrative}`
      : "";
    return {
      id: entry.id,
      type: entry.kind === "RESULT" ? (maneuverResult ? "maneuver_result" : "decision_result") : entry.kind === "IMPACT" ? "causal_visible" : "system",
      label: entry.kind === "RESULT" ? (maneuverResult ? maneuverLabel(entryDecisionForm) : "你的行动结果") : "剧情",
      title: entry.title,
      body: `${entry.content}${nextStory}`,
      day: turn?.stageIndex || 7,
      time: `世界事件 ${entry.worldSequence}`,
      visibility: "player_visible",
      sequence: index + 1,
      decisionForm: entryDecisionForm
    };
  });
  // A published timeline RESULT is the player-facing canonical story.  The
  // compact resolution payload is only a recovery fallback; appending it as a
  // second result would make the old renderer select the shorter rules summary
  // and hide the full narrative that already passed the story quality gate.
  if (resolution?.resultNarrative && results.length === 0) {
    messages.push({
      id: resolution.id || `resolution-${p.worldSequence}`,
      type: isManeuverDecisionForm(normalizeDecisionForm(decisionForm)) ? "maneuver_result" : "decision_result",
      label: isManeuverDecisionForm(normalizeDecisionForm(decisionForm)) ? maneuverLabel(normalizeDecisionForm(decisionForm)) : "你的行动结果",
      title: "行动之后",
      body: [resolution.resultNarrative, turn?.narrative].filter(Boolean).join("\n\n"),
      day: turn?.stageIndex || 7,
      time: `世界事件 ${p.worldSequence}`,
      visibility: "player_visible"
    });
  }
  const completed = Boolean(p.completed || !turn);
  const currentStage = turn?.stageIndex || Math.max(1, ...p.otherActors.map((actor) => Number(actor.stageIndex || 1)));
  const currentTurnIndex = turn?.turnIndex || results.length;
  const visibleAssets = p.visibleAssets || [];
  const latestStory = turn?.narrative || results.at(-1)?.content || "你的故事正在整理最后的回响。";
  const legacyProfile = approvedLegacyProfile(p);
  const canDecide = !completed
    && turn?.status === "OPEN"
    && p.control.canHumanAct
    && p.access.state !== "REQUIRES_UNLOCK";

  return {
    continuousV2: true,
    storyRevisionToken: turn ? `${turn.id}:${turn.revision}:${turn.baseWorldSequence}` : `completed:${p.worldSequence}`,
    openingNarrative: latestStory,
    v2Projection: p,
    v2CurrentTurn: turn,
    run: {
      id: p.room.id,
      title: p.room.title,
      status: completed ? "finished" : "playing",
      currentDay: currentStage,
      totalDays: 7,
      currentTime: turn?.title || "故事推进中",
      totalDecisionsCompleted: results.length,
      decisionsCompletedToday: 0,
      decisionsRequiredToday: 1,
      version: turn?.revision || 1
    },
    player: {
      roleName: p.player.roleName,
      name: legacyProfile.name || p.player.identity,
      rank: legacyProfile.rank,
      office: legacyProfile.office,
      fateQuestion: p.player.personalGoal,
      goals: legacyProfile.goals.length ? legacyProfile.goals : [p.player.personalGoal].filter(Boolean),
      resources: legacyProfile.resources,
      leverage: [
        ...legacyProfile.leverage,
        ...visibleAssets.filter((asset) => asset.status === "ACTIVE" && asset.quantity > 0).map((asset) => asset.label)
      ].filter((label, index, labels) => label && labels.indexOf(label) === index)
    },
    dashboard: { worldState: [], risks: [], relationships: [], traces: [] },
    dayProgress: { completed: 0, required: 1 },
    maneuverState: { maneuverOpportunitiesPerDay: 2, maneuverOpportunitiesRemaining: 2 },
    activePrompt: canDecide ? {
      eventId: turn.id,
      promptKind: activeInteraction(p) ? "critical_response" : "main_decision",
      prompt: activeInteraction(p)?.pressure || turn.framing || "在这个情境里，你准备怎么做？",
      options,
      maxLength: 200,
      submitLabel: "提交决策"
    } : null,
    activeDecision: canDecide && options.length ? {
      messageId: turn.id,
      title: activeInteraction(p)?.pressure || turn.title || turn.framing,
      options
    } : null,
    decisionHistory: results.map((entry, index) => {
      const entryDecisionForm = normalizeDecisionForm(entry.decisionForm || (entry.id === results.at(-1)?.id ? decisionForm : null));
      return {
        id: entry.id,
        kind: isManeuverDecisionForm(entryDecisionForm) ? "maneuver" : "decision",
        decisionForm: entryDecisionForm,
        day: Math.min(7, index + 1),
        decisionIndex: index + 1,
        title: entry.title,
        summary: entry.content,
        result: entry.content
      };
    }),
    messages,
    pendingCriticalEvents: [],
    criticalEvent: null,
    finalJudgement: completed ? finalJudgement(p, latestStory) : null
  };
}

function normalizeDecisionForm(value) {
  return ["STORY_CHOICE", "CONVERSATION", "INVESTIGATION", "LEVERAGE", "CUSTOM_PLAN"].includes(value)
    ? value
    : "STORY_CHOICE";
}

function isManeuverDecisionForm(value) {
  return ["CONVERSATION", "INVESTIGATION", "LEVERAGE", "CUSTOM_PLAN"].includes(value);
}

function maneuverLabel(value) {
  return ({ CONVERSATION: "人物交谈", INVESTIGATION: "派遣调查", LEVERAGE: "使用筹码", CUSTOM_PLAN: "自拟谋划" })[value] || "你的行动结果";
}

function maneuverCommand(projection, draft) {
  const turn = projection.currentTurn;
  const type = String(draft.maneuverType || "custom");
  if (type === "contact") return conversationCommand(projection, draft);
  if (type === "investigate") return investigationCommand(projection, draft);
  if (type === "leverage") return leverageCommand(projection, draft);
  const actionText = String(draft.customText || "").trim();
  if (!actionText) throw new Error("请先写下在当前剧情中真正要做的事情。");
  return { decisionForm: "CUSTOM_PLAN", actionText, intent: customIntent(turn, actionText) };
}

function conversationCommand(projection, draft) {
  const target = resolveRoleTarget(projection, draft.targetRoleKey);
  if (!target) throw new Error("当前剧情中没有可以交谈的人物。");
  const shortName = roleShortName(target.label);
  const actionText = `单独召见${shortName}，当面问清他亲眼所见、经手过的文书，以及他为何在此刻这样判断。`;
  return {
    decisionForm: "CONVERSATION",
    actionText,
    intent: {
      objective: `从${shortName}口中核实当前局势的关键事实和他的真实立场`,
      target: clone(target),
      method: `${actionText}先让他自行陈述，再拿当前剧情中已经掌握的事实逐项核对；不替他作答，也不预设他会配合。`,
      leverageKeys: [],
      visibility: "LIMITED",
      riskTolerance: "MEDIUM",
      fallback: { method: `若${shortName}拒绝回答，就记下拒绝的问题和在场见证，转而核查相关原始文书。`, triggerOn: "TARGET_REFUSED" },
      condition: null
    }
  };
}

function investigationCommand(projection, draft) {
  const definitions = {
    inspect_land_register: { pattern: /田|契|册|账|粮|数字/, objective: "核清田册、粮册或账册中彼此矛盾的原始记录" },
    inspect_courier_registry: { pattern: /驿|递|文|令|催|公文|奏/, objective: "查清公文和消息的递送时间、经手人与去向" },
    inspect_grain_store: { pattern: /粮|仓|米|存|封条/, objective: "核清粮仓实存、封条与仓单能否互相印证" }
  };
  const selected = definitions[draft.intentKey] || definitions.inspect_land_register;
  const target = resolveInvestigationTarget(projection, selected.pattern);
  const targetLabel = target.label;
  const actionText = `派一名可信幕僚去查验${targetLabel}，只查原件、经手人和时间记录，并把互相矛盾之处分别抄回总督府。`;
  return {
    decisionForm: "INVESTIGATION",
    actionText,
    intent: {
      objective: selected.objective,
      target: clone(target),
      method: `${actionText}调查时不先宣布结论，也不允许幕僚替任何一方补写或销毁记录。`,
      leverageKeys: [],
      visibility: "PRIVATE",
      riskTolerance: "LOW",
      fallback: { method: "若原件已被转移，就封存现场，记录最后接触原件的人与时辰后立即回报。", triggerOn: "PRIMARY_BLOCKED" },
      condition: null
    }
  };
}

function leverageCommand(projection, draft) {
  const asset = resolveActiveAsset(projection, draft.leverageKey);
  if (!asset) throw new Error("这项筹码当前并不在你手中，不能作为本次决策使用。");
  const target = resolveRoleTarget(projection, draft.targetRoleKey || "merchant") || publicFrameTarget(projection.currentTurn);
  const targetLabel = roleShortName(target.label);
  const actionText = `暂不公开${asset.label}，只向${targetLabel}出示其中一处可核验的细节，要求对方在明确期限前交出相应原始凭据。`;
  return {
    decisionForm: "LEVERAGE",
    actionText,
    intent: {
      objective: `用${asset.label}换取${targetLabel}对当前疑点作出可核验的回应`,
      target: clone(target),
      method: `${actionText}若对方拒绝，就收回筹码并让在场见证记下拒绝的内容，不替对方宣布结果。`,
      leverageKeys: [asset.assetKey],
      visibility: "LIMITED",
      riskTolerance: "HIGH",
      fallback: { method: `若${targetLabel}拒绝交换，就封存${asset.label}并转查与之对应的经手记录。`, triggerOn: "TARGET_REFUSED" },
      condition: null
    }
  };
}

function resolveRoleTarget(projection, requestedKey) {
  const targets = projection.currentTurn?.availableTargets?.filter((item) => item.type === "ROLE") || [];
  const hints = {
    county_magistrate: ["清流县令", "县令"],
    merchant: ["江南商会会首", "商会会首", "商会"],
    xunfu: ["浙江巡抚", "巡抚"],
    sili_jian: ["司礼监织造使", "织造使", "司礼监"]
  }[requestedKey] || [String(requestedKey || "")];
  return targets.find((target) => target.id === requestedKey)
    || targets.find((target) => hints.some((hint) => hint && target.label.includes(hint)))
    || targets.find((target) => !target.label.includes(projection.player?.roleName || "__never__"))
    || null;
}

function resolveInvestigationTarget(projection, pattern) {
  const targets = projection.currentTurn?.availableTargets || [];
  return targets.find((target) => ["EVIDENCE", "LOCATION", "RESOURCE"].includes(target.type) && pattern.test(target.label))
    || targets.find((target) => target.type === "EVIDENCE")
    || targets.find((target) => target.type === "LOCATION")
    || publicFrameTarget(projection.currentTurn);
}

function resolveActiveAsset(projection, requestedKey) {
  const assets = (projection.visibleAssets || []).filter((asset) => asset.status === "ACTIVE" && Number(asset.quantity) > 0);
  const aliases = {
    land_contract_fragment: /田|契|账|册/,
    county_letter: /县令|密信|信札/,
    coastal_report: /海防|军报|塘报/
  };
  return assets.find((asset) => asset.assetKey === requestedKey)
    || assets.find((asset) => aliases[requestedKey]?.test(asset.label))
    || null;
}

function publicFrameTarget(turn) {
  return turn.availableTargets?.find((item) => item.type === "PUBLIC_FRAME") || turn.availableTargets?.[0] || {
    type: "PUBLIC_FRAME",
    id: `stage:${turn.stageIndex}`,
    label: "当前局势"
  };
}

function roleShortName(label) {
  return String(label || "对方").replace(/（.*$/, "").trim();
}

function approvedLegacyProfile(projection) {
  if (projection.room?.worldId === "sangtian" && projection.player?.roleKey === "zhejiang_governor") {
    return {
      name: "郑帅彬",
      rank: "从四品",
      office: "兵部侍郎衔",
      goals: ["稳定浙江局势", "控制巡抚势力", "避免皇帝生疑"],
      resources: [["银两", "42 万两"], ["粮草", "23 万石"], ["兵丁", "4/5"], ["幕僚", "4 人"], ["密报", "2 条"]],
      leverage: ["田契暗账（半页）", "清流县令密信", "巡抚与商会旧约传闻"]
    };
  }
  return { name: "", rank: "", office: "", goals: [], resources: [], leverage: [] };
}

function visibleChoices(projection) {
  const interaction = activeInteraction(projection);
  return interaction?.responseOptions?.length ? interaction.responseOptions : projection.currentTurn?.decisions || [];
}

function activeInteraction(projection) {
  return projection.pendingInteractions?.[0] || null;
}

function customIntent(turn, text) {
  const target = turn.availableTargets?.find((item) => item.type === "PUBLIC_FRAME") || turn.availableTargets?.[0] || {
    type: "PUBLIC_FRAME",
    id: `stage:${turn.stageIndex}`,
    label: "当前局势"
  };
  return {
    objective: text,
    target: clone(target),
    method: text,
    leverageKeys: [],
    visibility: "PRIVATE",
    riskTolerance: "MEDIUM",
    fallback: null,
    condition: null
  };
}

function finalJudgement(projection, latestStory) {
  const wholeStory = projection.timeline.map((entry) => entry.content).filter(Boolean).join("\n\n");
  return {
    globalEnding: { title: projection.room.title, narrative: latestStory },
    personalEnding: {
      rank: "故事完成",
      title: projection.player.roleName,
      narrative: wholeStory || latestStory,
      futureAftermath: "这名角色已经完成自己的故事线；同一世界中的其他角色仍可独立继续。"
    },
    causalExplanation: { keyMovesThatSavedYou: [], keyMovesThatHurtYou: [], fateDebts: [] }
  };
}

function requireProjection(value) {
  if (!value || value.schemaVersion !== SCHEMA) throw new Error("当前故事投影版本不受支持。");
  return value;
}

function containsStory(existing, next) {
  const anchor = String(next || "").replace(/\s+/g, " ").slice(0, 80);
  return anchor.length >= 20 && String(existing || "").replace(/\s+/g, " ").includes(anchor);
}

function uniqueKey(prefix, subject) {
  return `${prefix}:${subject}:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 10)}`;
}

function clone(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }
