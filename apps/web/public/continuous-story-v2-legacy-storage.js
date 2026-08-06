import { gamePresentationFromProjection, gameRoleFromProjection, gameWorldFromProjection } from "./game-world-view.js";

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
      if (error?.code === "TURN_CONTEXT_UPDATED" && error?.details?.gameProjection) {
        this.projection = requireProjection(error.details.gameProjection);
        return adaptProjection(this.projection);
      }
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
      if (["TURN_MOVED", "STORY_GENERATION_IN_PROGRESS", "TURN_CONTEXT_UPDATED"].includes(error?.code)) return this.getRun();
      throw error;
    }
    this.projection = requireProjection(response.gameProjection);
    return adaptProjection(this.projection, { resolution: response.resolution || null, decisionForm: maneuver.decisionForm });
  }

  async previewManeuver(_view, draft, { idempotencyKey } = {}) {
    const projection = this.projection;
    const turn = projection.currentTurn;
    const capability = projection.capabilities?.maneuverRulesV1;
    if (!turn || turn.status !== "OPEN" || !projection.control?.canHumanAct) {
      throw requestError("MANEUVER_WINDOW_CLOSED", "当前角色暂时不能预演谋划。", 409);
    }
    if (!capability?.enabled || capability.window?.status !== "OPEN") {
      throw requestError("MANEUVER_PREVIEW_UNAVAILABLE", "当前故事局尚未启用行动预演。", 409);
    }
    return this.request(`/api/v4/rooms/${encodeURIComponent(this.runId)}/game/turns/${encodeURIComponent(turn.id)}/action-previews`, {
      method: "POST",
      body: JSON.stringify({
        idempotencyKey: idempotencyKey || uniqueKey("maneuver-preview", turn.id),
        turnRevision: turn.revision,
        expectedStateRevision: projection.worldSequence,
        expectedManeuverWindowVersion: capability.window.version,
        controlEpoch: projection.control.epoch,
        draft
      })
    });
  }

  async commitManeuverPreview(_view, preview, { idempotencyKey } = {}) {
    if (!preview?.previewId || !preview?.previewToken) {
      throw requestError("ACTION_PREVIEW_TOKEN_INVALID", "行动预演不完整，请重新预演。", 400);
    }
    const payload = await this.request(`/api/v4/rooms/${encodeURIComponent(this.runId)}/game/action-previews/${encodeURIComponent(preview.previewId)}/commit`, {
      method: "POST",
      body: JSON.stringify({
        idempotencyKey: idempotencyKey || uniqueKey("maneuver-commit", preview.previewId),
        previewToken: preview.previewToken
      })
    });
    this.projection = requireProjection(payload.gameProjection);
    return { ...payload, gameProjection: adaptProjection(this.projection) };
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
      const nested = payload?.message && typeof payload.message === "object" && !Array.isArray(payload.message)
        ? payload.message
        : null;
      const server = nested || payload;
      const message = typeof server?.message === "string"
        ? server.message
        : typeof payload?.message === "string"
          ? payload.message
          : server?.code || "故事服务暂时无法完成这次操作。";
      const error = new Error(message);
      error.code = server?.code || payload?.code || "STORY_REQUEST_FAILED";
      error.status = response.status;
      error.details = server;
      if (response.status === 402 && ["PLAYER_CREDITS_REQUIRED", "INSUFFICIENT_WORLD_CREDITS"].includes(error.code)) {
        globalThis.window?.dispatchEvent?.(new CustomEvent("worldcreditsrequired", { detail: { ...server, runId: this.runId } }));
      }
      throw error;
    }
    return payload;
  }
}

export function adaptProjection(projection, { resolution = null, decisionForm = null } = {}) {
  const p = requireProjection(projection);
  const world = gameWorldFromProjection(p);
  const presentation = gamePresentationFromProjection(world);
  const role = gameRoleFromProjection(world, p.player);
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
    const maneuverTimelineResult = entry.kind === "MANEUVER_RESULT";
    const nextStory = latestResult && turn?.narrative && !containsStory(entry.content, turn.narrative)
      ? `\n\n${turn.narrative}`
      : "";
    const messageType = entry.kind === "RESULT"
      ? (maneuverResult ? "maneuver_result" : "decision_result")
      : maneuverTimelineResult
        ? "maneuver_result"
        : entry.kind === "MANEUVER_ACTION"
          ? "system_hint"
          : entry.kind === "EVIDENCE"
            ? "private_intel"
            : entry.kind === "REACTION"
              ? "role_action"
              : ["CROSS_IMPACT", "OBSERVABLE_TRACE"].includes(entry.kind)
                ? "causal_visible"
                : "system";
    const messageLabel = entry.kind === "RESULT"
      ? (maneuverResult ? maneuverLabel(entryDecisionForm) : "你的行动结果")
      : maneuverTimelineResult
        ? "主动谋划"
        : entry.kind === "MANEUVER_ACTION"
          ? "已提交谋划"
          : entry.kind === "EVIDENCE"
            ? "情报与证据"
            : entry.kind === "REACTION"
              ? "局势应变"
              : "剧情";
    return {
      id: entry.id,
      type: messageType,
      label: messageLabel,
      title: entry.title,
      body: `${entry.content}${nextStory}`,
      day: turn?.stageIndex || 7,
      time: `世界事件 ${entry.worldSequence}`,
      visibility: "player_visible",
      sequence: index + 1,
      sourceActionId: entry.sourceActionId || null,
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
  // A missing turn can mean that the opening is still generating or that its
  // publication gate stopped it. Only the durable thread completion flag may
  // send the player to the final page.
  const completed = Boolean(p.completed);
  const currentStage = turn?.stageIndex || Math.max(1, ...p.otherActors.map((actor) => Number(actor.stageIndex || 1)));
  const currentTurnIndex = turn?.turnIndex || results.length;
  const visibleAssets = p.visibleAssets || [];
  const latestStory = turn?.narrative || results.at(-1)?.content || "你的故事正在整理最后的回响。";
  const legacyProfile = role.gameplayProfile || approvedLegacyProfile(p);
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
      storyId: world?.worldId || p.room.worldId,
      title: presentation.title || p.room.title,
      location: presentation.locationLabel,
      status: completed ? "finished" : "playing",
      currentDay: currentStage,
      totalDays: presentation.totalStages,
      currentTime: turn?.title || "故事推进中",
      totalDecisionsCompleted: results.length,
      decisionsCompletedToday: 0,
      decisionsRequiredToday: 1,
      version: turn?.revision || 1
    },
    player: {
      roleName: p.player.roleName,
      name: legacyProfile.characterName || legacyProfile.name || p.player.identity,
      rank: legacyProfile.rank,
      office: legacyProfile.office,
      fateQuestion: legacyProfile.fateQuestion || p.player.personalGoal,
      goals: legacyProfile.goals?.length ? legacyProfile.goals : [p.player.personalGoal].filter(Boolean),
      resources: (legacyProfile.resources || []).map((item) => Array.isArray(item) ? item : [item.label, item.value]),
      leverage: [
        ...(legacyProfile.leverage || []),
        ...visibleAssets.filter((asset) => asset.status === "ACTIVE" && asset.quantity > 0).map((asset) => asset.label)
      ].filter((label, index, labels) => label && labels.indexOf(label) === index)
    },
    locale: presentation.locale,
    presentation: { ...presentation, playerPortrait: role.portrait },
    dashboard: {
      worldState: presentation.statusMetrics.map((metric) => [metric.key, metric.value]),
      statusMetrics: presentation.statusMetrics,
      risks: [], relationships: [], traces: []
    },
    dayProgress: { completed: 0, required: 1 },
    capabilities: p.capabilities || undefined,
    maneuverState: {
      maneuverOpportunitiesPerDay: Number(p.capabilities?.maneuverRulesV1?.window?.totalOpportunities || 2),
      maneuverOpportunitiesRemaining: Number(p.capabilities?.maneuverRulesV1?.window?.remainingOpportunities ?? 2)
    },
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
  const topic = String(draft.customText || "").trim();
  if (!topic) throw new Error("请写下你准备向此人询问或交涉的具体事情。");
  const shortName = roleShortName(target.label);
  const actionText = `单独召见${shortName}，当面提出：${topic}`;
  return {
    decisionForm: "CONVERSATION",
    actionText,
    intent: {
      objective: `围绕“${topic}”核实${shortName}掌握的事实、立场和依据`,
      target: clone(target),
      method: `${actionText}。先让他自行陈述，再拿当前剧情中已经掌握的事实逐项核对；不替他作答，也不预设他会配合。`,
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
  const selected = definitions[draft.intentKey];
  if (!selected) throw new Error("请先选择一项真实的调查方向。");
  const detail = String(draft.customText || "").trim();
  const target = resolveInvestigationTarget(projection, selected.pattern);
  const targetLabel = target.label;
  const actionText = `派一名可信幕僚去查验${targetLabel}，只查原件、经手人和时间记录，并把互相矛盾之处分别抄回总督府${detail ? `；另须查清：${detail}` : ""}。`;
  return {
    decisionForm: "INVESTIGATION",
    actionText,
    intent: {
      objective: detail ? `${selected.objective}；${detail}` : selected.objective,
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
  const demand = String(draft.customText || "").trim();
  if (!demand) throw new Error("请写下你准备用这项筹码迫使对方做什么。");
  const target = resolveRoleTarget(projection, draft.targetRoleKey || "merchant") || publicFrameTarget(projection.currentTurn);
  const targetLabel = roleShortName(target.label);
  const actionText = `暂不公开${asset.label}，只向${targetLabel}出示一处可核验的细节，并提出要求：${demand}`;
  return {
    decisionForm: "LEVERAGE",
    actionText,
    intent: {
      objective: `用${asset.label}推动${targetLabel}作出可核验的回应：${demand}`,
      target: clone(target),
      method: `${actionText}。若对方拒绝，就收回筹码并让在场见证记下拒绝的内容，不替对方宣布结果。`,
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

function requestError(code, message, status = 400) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

function clone(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }
