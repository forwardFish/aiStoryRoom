const PRESSURE_SCHEMA = "pressure_game_projection_v1";
const PRESSURE_RUNTIME_PROFILE = "SANGTIAN_PRESSURE_SPINE_V1";

const ACTIONABLE_PHASES = new Map([
  ["PREPARE_OPEN", "PREPARE"],
  ["COMMIT_OPEN", "COMMIT"],
  ["REACTION_OPEN", "REACTION"]
]);

const LOCKED_PHASES = new Set([
  "P0_PROJECTING",
  "PREPARE_LOCKED",
  "PREPARE_RESOLVING",
  "COMMIT_LOCKED",
  "SETTLING",
  "FROZEN",
  "PROJECTING",
  "FINALE_COMPUTING",
  "COMPLETED",
  "FAILED_RECOVERABLE"
]);

const CONFIRMABLE_PREVIEW_RESULTS = new Set(["ACCEPT", "ACCEPT_WITH_COST"]);
const PREVIEW_VALIDATION_RESULTS = new Set([
  "ACCEPT",
  "ACCEPT_WITH_COST",
  "REWRITE_NEEDED",
  "REJECT_NO_SIDE_EFFECT",
  "REJECT_COMMIT_AS_FAILED_ATTEMPT"
]);

export function isPressureGameProjection(value) {
  return Boolean(value && typeof value === "object" && (
    value.schemaVersion === PRESSURE_SCHEMA
    || value.runtimeProfile === PRESSURE_RUNTIME_PROFILE
  ));
}

export function validatePressureGameProjection(projection) {
  if (!isPressureGameProjection(projection)) return ["不是桑田诏压力运行时投影。"]; 
  const errors = [];
  if (projection.schemaVersion !== PRESSURE_SCHEMA) errors.push("投影 schemaVersion 不受支持。");
  if (projection.runtimeProfile !== PRESSURE_RUNTIME_PROFILE) errors.push("投影 runtimeProfile 不受支持。");
  if (!isRecord(projection.run) || !text(projection.run.runId) || !text(projection.run.nodeId) || !text(projection.run.phase)) errors.push("投影缺少 run 身份、节点或阶段。");
  if (!Number.isInteger(Number(projection.run?.version))) errors.push("投影缺少服务端 run.version，无法安全预览行动。");
  if (!Number.isInteger(Number(projection.projectionRevision))) errors.push("投影缺少 projectionRevision。");
  if (!isRecord(projection.player) || !text(projection.player.seatId) || !text(projection.player.displayName) || !text(projection.player.mission)) errors.push("投影缺少当前席位身份或制度使命。");
  if (!isRecord(projection.publicScene) || !text(projection.publicScene.sceneId) || !text(projection.publicScene.text)) errors.push("投影缺少玩家可见的当前现场。");
  if (!isRecord(projection.privateScene) || !text(projection.privateScene.sceneId) || !text(projection.privateScene.text)) errors.push("投影缺少当前席位的私密开场。");
  if (!isRecord(projection.actionSurface) || !Array.isArray(projection.actionSurface.suggestedInputs)) errors.push("投影缺少结构化 actionSurface。");
  if (!Array.isArray(projection.seats) || projection.seats.length !== 6) errors.push("投影必须提供六个 viewer-safe 席位状态。");

  const expectedActionPhase = ACTIONABLE_PHASES.get(projection.run?.phase);
  const suggestions = array(projection.actionSurface?.suggestedInputs);
  if (expectedActionPhase) {
    if (projection.actionSurface?.phase !== expectedActionPhase) errors.push("actionSurface.phase 与运行时阶段不一致。");
    if (suggestions.length < 2 || suggestions.length > 3) errors.push("可行动阶段必须提供 2—3 条安全建议。");
    if (suggestions.some((item) => item?.requiresPreview !== true || !text(item?.id) || !text(item?.displayText))) errors.push("每条建议都必须包含稳定 ID、展示文本并要求 Preview。");
  } else if (LOCKED_PHASES.has(projection.run?.phase) && suggestions.length !== 0) {
    errors.push("密封、结算或冻结阶段不得提供可点击建议。");
  }

  return errors;
}

export function createPressureActionState() {
  return {
    draft: "",
    preview: null,
    previewInput: "",
    confirmIdempotencyKey: "",
    error: "",
    operation: "IDLE"
  };
}

export function pressureActionAvailability(projection) {
  const errors = validatePressureGameProjection(projection);
  const actionPhase = ACTIONABLE_PHASES.get(projection?.run?.phase) || null;
  if (errors.length) return { actionable: false, actionPhase, reason: errors[0], errors };
  if (!actionPhase) {
    return {
      actionable: false,
      actionPhase: null,
      reason: projection?.run?.phase === "FAILED_RECOVERABLE"
        ? "运行时暂时中断。刷新只会恢复原阶段，不会替你推进剧情。"
        : phaseWaitingCopy(projection?.run?.phase),
      errors: []
    };
  }
  return { actionable: true, actionPhase, reason: "", errors: [] };
}

export function createPressurePreviewCommand(projection, freeText, { idempotencyKey } = {}) {
  const availability = pressureActionAvailability(projection);
  if (!availability.actionable) throw new Error(availability.reason || "当前阶段不能预览行动。");
  const normalizedText = text(freeText);
  if (!normalizedText) throw new Error("请先写下你要做的事。");
  if (!text(idempotencyKey)) throw new Error("预览请求缺少幂等键。");
  return {
    idempotencyKey,
    expectedRunVersion: Number(projection.run.version),
    expectedProjectionRevision: Number(projection.projectionRevision),
    expectedNodeId: projection.run.nodeId,
    expectedPhase: availability.actionPhase,
    expectedSeatId: projection.player.seatId,
    input: {
      freeText: normalizedText,
      actionType: null,
      targetIds: [],
      objectVersionIds: [],
      resourceCommitments: [],
      visibility: "PUBLIC",
      condition: null
    }
  };
}

export function createPressureConfirmCommand(projection, preview, { idempotencyKey } = {}) {
  const availability = pressureActionAvailability(projection);
  if (!availability.actionable) throw new Error(availability.reason || "当前阶段不能确认行动。");
  if (!isRecord(preview) || !text(preview.previewToken) || !text(preview.requestFingerprint) || !isRecord(preview.normalizedIntent)) throw new Error("请先完成一次有效 Preview。");
  if (!CONFIRMABLE_PREVIEW_RESULTS.has(preview.validation)) throw new Error("当前 Preview 尚不能确认，请按校验结果修改行动。");
  if (!text(idempotencyKey)) throw new Error("确认请求缺少幂等键。");
  return {
    idempotencyKey,
    previewToken: preview.previewToken,
    requestFingerprint: preview.requestFingerprint,
    normalizedIntent: structuredClone(preview.normalizedIntent),
    expectedRunVersion: Number(projection.run.version),
    expectedProjectionRevision: Number(projection.projectionRevision),
    expectedNodeId: projection.run.nodeId,
    expectedPhase: availability.actionPhase,
    expectedSeatId: projection.player.seatId
  };
}

export function renderPressureGameShell(projection, actionState, { busy = false, error = "", notice = "" } = {}) {
  const validationErrors = validatePressureGameProjection(projection);
  const availability = pressureActionAvailability(projection);
  const player = record(projection.player);
  const publicScene = record(projection.publicScene);
  const privateScene = record(projection.privateScene);
  const worldClock = record(projection.worldClock);
  const pressure = record(projection.pressure);
  const locked = busy || !availability.actionable;
  const latestFeedback = optionalRecord(projection.latestActionFeedback);
  const finale = optionalRecord(projection.finale);
  const prologue = optionalRecord(projection.prologue);
  const liveGeneration = optionalRecord(projection.liveGeneration);
  const phase = text(projection.run?.phase) || "UNKNOWN";
  const nodeId = text(projection.run?.nodeId) || "?";

  return `<div class="causal-shell pressure-game-shell" data-testid="story-shell" data-runtime-profile="${escapeHtml(projection.runtimeProfile)}">
    <header class="causal-topbar pressure-topbar">
      <div class="top-context-cluster"><div class="mw-brand"><span class="mw-brand-mark">Our Many Worlds</span></div><b>桑田诏 · ${escapeHtml(nodeId)}</b></div>
      <div class="top-phase-cluster"><span class="pressure-node">历史压力节点 ${escapeHtml(nodeId)}</span><span class="status-chip" data-testid="pressure-phase">${escapeHtml(phaseLabel(phase))}</span></div>
      <div class="top-utility-cluster"><button id="pressureRefreshBtn" type="button" ${busy ? "disabled" : ""}>↻ 刷新局势</button></div>
    </header>
    <div class="status-strip pressure-status-strip" aria-label="世界状态">
      <span>◷ 世界时间 <b data-testid="pressure-world-clock">${escapeHtml(worldClock.label || "未提供")}</b></span>
      <span class="metric-gold">⚠ 压力 <b data-testid="pressure-level">${escapeHtml(pressure.level ?? "-")}</b></span>
      <span>倒计时 <b>${escapeHtml(pressure.triggerLabel || "历史不会等待")}</b></span>
    </div>
    <aside class="causal-left pressure-identity-column" aria-label="玩家信息">
      <section class="causal-panel player" data-testid="pressure-identity"><h2>我的席位</h2><h3>${escapeHtml(player.displayName || player.roleKey || "")}</h3><p>${escapeHtml(player.roleKey || "")}</p></section>
      <section class="causal-panel day-mission" data-testid="pressure-mission"><h2>制度使命</h2><p>${escapeHtml(player.mission || "")}</p></section>
      <section class="causal-panel pressure-private-scene" data-testid="pressure-private-opening"><h2>只有你知道</h2><p>${lineBreaks(privateScene.text || "")}</p></section>
    </aside>
    <main class="causal-center pressure-center">
      <section class="pressure-public-scene" data-testid="pressure-public-scene"><span>${escapeHtml(nodeId)} · 当前现场</span><p>${lineBreaks(publicScene.text || "")}</p></section>
      ${renderPressureLiveStatus(liveGeneration, actionState, busy)}
      ${latestFeedback ? renderLatestActionFeedback(latestFeedback) : ""}
      ${finale?.status === "COMPLETED" ? renderPressureFinale(finale, player.seatId) : validationErrors.length ? renderProjectionFailure(validationErrors) : prologue?.status === "AWAITING_ACK" ? renderPressurePrologue(projection, { busy }) : renderPressureActionComposer(projection, actionState, { busy, locked, availability })}
    </main>
    <aside class="causal-right pressure-seats-column" aria-label="六席状态">
      ${renderPressureSeats(projection.seats, player.seatId)}
      ${renderPressureObjects(projection.objects, projection.evidenceChain)}
    </aside>
    ${actionState?.error ? renderBanner("error", actionState.error) : ""}
    ${error ? renderBanner("error", error) : ""}
    ${notice ? renderBanner("notice", notice) : ""}
  </div>`;
}

function renderPressurePrologue(projection, { busy }) {
  const prologue = record(projection.prologue);
  const title = text(prologue.title) || text(projection.publicScene?.title) || "不可操作序章";
  const nextTitle = text(prologue.nextNodeTitle) || text(prologue.nextNodeId) || "下一历史压力";
  return `<section class="decision-zone pressure-prologue" data-testid="pressure-prologue">
    <div class="decision-zone-head"><span class="decision-kicker">不可操作序章</span><h2>${escapeHtml(title)}</h2><span>先读清你的身份、制度使命、私有开场与危机起点。确认后，世界将进入“${escapeHtml(nextTitle)}”。</span></div>
    <div class="pressure-prologue-lock"><b>世界行动尚未开放</b><p>序章期间不能 Preview 或 Confirm，也不会因刷新、断线或重复确认跳过。</p></div>
    <div class="actions pressure-actions"><span>确认只投影服务端已经验收的序章，不会替你作出世界行动。</span><button id="pressureAcknowledgePrologueBtn" type="button" ${busy ? "disabled" : ""}>${busy ? "正在进入局势……" : `我已了解，进入${escapeHtml(nextTitle)}`}</button></div>
  </section>`;
}

function renderPressureLiveStatus(liveGeneration, actionState, busy) {
  const ai = optionalRecord(liveGeneration?.aiSeats);
  const narrative = optionalRecord(liveGeneration?.narrative);
  const operation = text(actionState?.operation) || "IDLE";
  const serverActive = Number(ai.pending || 0) > 0 || Number(ai.running || 0) > 0 || narrative.status === "GENERATING";
  const active = operation !== "IDLE" || serverActive;
  if (!active && !narrative.status) return "";
  const label = operation === "PREVIEW"
    ? "正在校验行动边界"
    : operation === "PROLOGUE"
      ? "正在封存序章并进入局势"
      : operation === "SETTLING" || serverActive
        ? `五席决策 ${Number(ai.completed || 0)}/5 · 结算与新现场生成中`
        : narrative.status === "AUTHORED_FALLBACK"
          ? "叙事服务已降级，正在展示受约束的作者后备场景"
          : narrative.status === "FAILED"
            ? "叙事生成失败，世界结算没有回滚"
            : "本轮现场已生成";
  const status = narrative.status || (active ? operation === "PREVIEW" ? "VALIDATING" : "GENERATING" : "IDLE");
  return `<section class="pressure-live-status ${active ? "active" : ""}" data-testid="pressure-live-status" data-narrative-status="${escapeHtml(status)}"><span>${active ? "●" : "✓"}</span><b>${escapeHtml(label)}</b></section>`;
}

function renderPressureFinale(finale, viewerSeatId) {
  const tracks = array(finale.trackBands);
  const verdicts = array(finale.seatVerdicts);
  const viewerVerdict = verdicts.find((item) => item?.seatId === viewerSeatId);
  return `<section class="pressure-finale" data-testid="pressure-finale">
    <p class="decision-kicker">FINALE</p>
    <h2>${escapeHtml(finale.worldOutcomeId || "UNRESOLVED_COMPROMISE")}</h2>
    <p>世界结果由 N1—N7 的不可变 FrozenResult 确定。叙事只解释，不改写结果。</p>
    ${viewerVerdict ? `<div class="pressure-finale-verdict"><span>你的席位结果</span><b>${escapeHtml(viewerVerdict.verdict)}</b></div>` : ""}
    <div class="pressure-finale-tracks">${tracks.map((track) => `<article><span>${escapeHtml(track.trackId || "")}</span><b>${escapeHtml(track.band || "MID")}</b><small>${escapeHtml(track.value ?? 0)}</small></article>`).join("")}</div>
  </section>`;
}

export function pressureProjectionFromConfirmResponse(response) {
  if (isPressureGameProjection(response)) return response;
  for (const candidate of [response?.projection, response?.gameProjection, response?.game, response?.viewerProjection]) {
    if (isPressureGameProjection(candidate)) return candidate;
  }
  return null;
}

export function pressurePreviewFromResponse(response, { expectedProjectionRevision } = {}) {
  const candidate = optionalRecord(response?.preview) || optionalRecord(response);
  const complete = candidate
    && text(candidate.previewId)
    && text(candidate.previewToken)
    && text(candidate.requestFingerprint)
    && isRecord(candidate.normalizedIntent)
    && isRecord(candidate.compiledAction)
    && PREVIEW_VALIDATION_RESULTS.has(candidate.validation)
    && Object.hasOwn(candidate, "timeCost")
    && Object.hasOwn(candidate, "opportunityCost")
    && text(candidate.expiresAt)
    && Number.isInteger(Number(candidate.currentProjectionRevision));
  if (!complete) {
    throw new Error("服务端没有返回完整 Preview 合同。");
  }
  if (Number.isInteger(Number(expectedProjectionRevision)) && Number(candidate.currentProjectionRevision) !== Number(expectedProjectionRevision)) {
    const error = new Error("Preview 基于过期投影，页面已拒绝确认并要求刷新。");
    error.code = "PREVIEW_STALE";
    throw error;
  }
  return candidate;
}

function renderPressureActionComposer(projection, actionState, { busy, locked, availability }) {
  const suggestions = array(projection.actionSurface?.suggestedInputs);
  const preview = optionalRecord(actionState?.preview);
  const canConfirm = !locked && CONFIRMABLE_PREVIEW_RESULTS.has(preview?.validation);
  const draft = String(actionState?.draft || "");
  return `<section class="decision-zone pressure-action-composer" data-testid="pressure-action-composer">
    <div class="decision-zone-head"><span class="decision-kicker">${escapeHtml(projection.actionSurface?.phase || "")}</span><h2>你要怎么做？</h2><span>自由表达会先变成合法行动，历史压力不会等待。</span></div>
    <div class="pressure-suggestions" data-testid="pressure-suggestions">${suggestions.map((suggestion) => `<button type="button" data-pressure-suggestion-id="${escapeHtml(suggestion.id)}" data-pressure-suggestion-text="${escapeHtml(suggestion.displayText)}" data-requires-preview="${suggestion.requiresPreview === true}" ${locked ? "disabled" : ""}>${escapeHtml(suggestion.displayText)}<small>先预览</small></button>`).join("")}</div>
    <label class="pressure-free-input" for="pressureActionInput">自由输入</label>
    <div class="custom-decision-input"><textarea id="pressureActionInput" maxlength="300" ${locked ? "disabled" : ""} placeholder="描述你此刻要采取的行动……">${escapeHtml(draft)}</textarea><span id="pressureActionCount">${draft.length}/300</span></div>
    ${preview ? renderPressurePreview(preview, actionState.previewInput) : ""}
    <div class="actions pressure-actions">
      <span>${locked ? escapeHtml(availability.reason || "当前行动已锁定。") : "Preview 不写入世界；Confirm 后行动不可撤回。"}</span>
      <button id="pressurePreviewBtn" type="button" ${locked || !draft.trim() ? "disabled" : ""}>${busy ? "正在校验……" : "预览行动"}</button>
      ${preview ? `<button id="pressureConfirmBtn" type="button" ${canConfirm ? "" : "disabled"}>${busy ? "正在结算……" : "确认并推进"}</button>` : ""}
    </div>
  </section>`;
}

function renderPressurePreview(preview, previewInput) {
  const compiled = record(preview.compiledAction);
  const normalized = record(preview.normalizedIntent);
  const actionType = [...new Set([
    compiled?.actionType,
    compiled?.secondaryActionType,
    normalized?.actionType,
    normalized?.intentCategory,
    preview.actionType
  ].filter(Boolean))].join(" · ") || "待服务端编译";
  const intent = normalized?.summary || normalized?.freeText || normalized?.intent || previewInput;
  return `<section class="pressure-preview" data-testid="pressure-preview" data-validation="${escapeHtml(preview.validation)}">
    <div><span>系统理解</span><b>${escapeHtml(intent || "")}</b></div>
    <div><span>合法行动</span><b data-testid="pressure-preview-action">${escapeHtml(actionType)}</b></div>
    <div><span>校验</span><b>${escapeHtml(preview.validation)}</b></div>
    <div><span>时间代价</span><b>${escapeHtml(displayValue(preview.timeCost))}</b></div>
    <div><span>机会代价</span><b>${escapeHtml(displayValue(preview.opportunityCost))}</b></div>
  </section>`;
}

function renderLatestActionFeedback(feedback) {
  const changes = record(feedback.changes);
  const categories = [
    ["后果", changes.consequence],
    ["资源", changes.resource],
    ["时间", changes.time],
    ["压力", changes.pressure],
    ["对象", changes.object]
  ];
  return `<section class="pressure-feedback" data-testid="pressure-latest-feedback" data-projection-hash="${escapeHtml(feedback.projectionHash || "")}">
    <div class="pressure-feedback-head"><span>行为被兑现，但世界没有等待</span><h2>这一步造成的可见后果</h2></div>
    <article><h3>你的行动</h3><p data-testid="pressure-action-echo">${escapeHtml(feedback.actionEcho || "")}</p></article>
    <article><h3>各方可见反应</h3><ul data-testid="pressure-visible-reactions">${array(feedback.visibleReactions).map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul></article>
    <div class="pressure-change-grid">${categories.map(([label, values]) => `<article data-change-kind="${escapeHtml(label)}"><h3>${escapeHtml(label)}</h3>${array(values).length ? `<ul>${array(values).map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>` : "<p>无可见变化</p>"}</article>`).join("")}</div>
    <article class="pressure-next"><h3>下一历史压力</h3><p data-testid="pressure-next-pressure">${escapeHtml(feedback.nextPressure || "")}</p></article>
    <small data-testid="pressure-feedback-source-ids">${array(feedback.sourceActionIds).map(escapeHtml).join(" · ")} ｜ ${array(feedback.settledEventIds).map(escapeHtml).join(" · ")}</small>
  </section>`;
}

function renderPressureSeats(seats, currentSeatId) {
  return `<section class="maneuver-panel pressure-seat-panel" data-testid="pressure-seat-status"><div class="maneuver-heading"><h2>六席状态</h2></div><div class="pressure-seat-list">${array(seats).map((seat) => `<article class="pressure-seat ${seat.seatId === currentSeatId ? "current" : ""}" data-seat-id="${escapeHtml(seat.seatId)}"><div><b>${escapeHtml(seat.displayName || seat.seatId)}</b><small>${escapeHtml(seat.controller || "")}</small></div><span data-seat-status="${escapeHtml(seat.publicStatus)}">${escapeHtml(seatStatusLabel(seat.publicStatus))}</span></article>`).join("")}</div></section>`;
}

function renderPressureObjects(objects, evidenceChain) {
  const visibleObjects = array(objects).slice(0, 4);
  const evidence = array(evidenceChain).slice(0, 4);
  if (!visibleObjects.length && !evidence.length) return "";
  return `<section class="maneuver-panel pressure-object-panel"><div class="maneuver-heading"><h2>对象与证据去向</h2></div>${visibleObjects.map((item) => `<p>${escapeHtml(item?.displayName || item?.label || item?.objectId || "")}</p>`).join("")}${evidence.map((item) => `<p>${escapeHtml(item?.displayName || item?.label || item?.evidenceId || "")}</p>`).join("")}</section>`;
}

function renderProjectionFailure(errors) {
  return `<section class="decision-zone pressure-projection-error" data-testid="pressure-projection-error"><h2>局势投影暂时不可用</h2><p>页面不会自行补造人物、行动或后果。请刷新读取服务端权威状态。</p><ul>${errors.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul><button id="pressureRefreshBtn" type="button">重新读取</button></section>`;
}

function renderBanner(kind, message) {
  return `<div class="api-banner ${escapeHtml(kind)}" role="status" data-testid="pressure-${escapeHtml(kind)}-banner">${escapeHtml(message)}</div>`;
}

function phaseWaitingCopy(phase) {
  const labels = {
    P0_PROJECTING: "序章正在投影，历史压力已经开始。",
    PREPARE_LOCKED: "准备行动已密封，正在等待其他席位。",
    PREPARE_RESOLVING: "准备行动正在结算，不能重复提交。",
    COMMIT_LOCKED: "本节点提交已密封，等待同步结算。",
    SETTLING: "六席行动正在同步结算。",
    FROZEN: "本节点已经冻结，等待下一现场投影。",
    PROJECTING: "新现场正在生成，刷新后可继续。",
    FINALE_COMPUTING: "终局正在结算，不能再追加行动。",
    COMPLETED: "本局已经结束。"
  };
  return labels[phase] || "当前阶段不能输入行动。";
}

function phaseLabel(phase) {
  return ({
    P0_PROJECTING: "序章投影",
    PREPARE_OPEN: "准备阶段",
    PREPARE_LOCKED: "准备已密封",
    PREPARE_RESOLVING: "准备结算",
    COMMIT_OPEN: "不可逆提交",
    COMMIT_LOCKED: "提交已密封",
    REACTION_OPEN: "条件应变",
    SETTLING: "同步结算",
    FROZEN: "节点冻结",
    PROJECTING: "新现场投影",
    FINALE_COMPUTING: "终局结算",
    COMPLETED: "本局结束",
    FAILED_RECOVERABLE: "可恢复中断"
  })[phase] || phase;
}

function seatStatusLabel(status) {
  return ({ THINKING: "思考中", SEALED: "已密封", DEFAULTED: "制度默认", RESOLVED: "已结算" })[status] || status || "未知";
}

function displayValue(value) {
  if (value === undefined || value === null || value === "") return "无";
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (Array.isArray(value)) return value.map(displayValue).join("；");
  return Object.entries(value).map(([key, item]) => `${key}: ${displayValue(item)}`).join("；");
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function record(value) {
  return isRecord(value) ? value : {};
}

function optionalRecord(value) {
  return isRecord(value) ? value : null;
}

function array(value) {
  return Array.isArray(value) ? value : [];
}

function text(value) {
  return String(value ?? "").trim();
}

function lineBreaks(value) {
  return escapeHtml(value).replace(/\n/g, "<br/>");
}

function escapeHtml(value) {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}
