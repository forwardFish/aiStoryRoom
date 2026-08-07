import { b0CanReady, b0WindowRemainingMs } from "./b0-window-state.js";

const COPY = Object.freeze({
  zh: {
    situation: "当前局势",
    window: "决策窗口",
    ready: "我已准备",
    unready: "取消准备",
    readyCount: "名角色已准备",
    remaining: "剩余时间",
    plan: "计划状态",
    noPlan: "尚未确认计划",
    DRAFT: "草稿待确认",
    CONFIRMED: "计划已确认",
    LOCKED: "计划已锁定",
    OPEN: "可以继续谋划",
    LOCKED_WINDOW: "所有计划已经锁定",
    SETTLING: "世界正在统一推演",
    COMMITTED: "权威结果已经确认",
    PUBLISHING: "结果正在送达",
    COMPLETED: "本次局势已经完成",
    FAILED_RETRYABLE: "该局势正在恢复",
    FAILED_HARD: "该局势已暂停处理",
    ABORTED: "该局势已终止",
    results: "局势结果",
    own: "你的行动结果",
    cross: "他人对你的影响",
    world: "世界变化",
    trace: "你观察到的迹象",
    knowledge: "你获得的新信息",
    reasons: "主要原因",
    changes: "状态变化",
    narrativePending: "故事化内容正在补充，权威结果已经生效。",
    narrativeFailed: "故事化内容暂时不可用，权威结果和下一局势不受影响。",
    narrative: "故事回响",
  },
  en: {
    situation: "Current Situation",
    window: "Decision Window",
    ready: "I am ready",
    unready: "Cancel ready",
    readyCount: "roles ready",
    remaining: "Time remaining",
    plan: "Plan status",
    noPlan: "No confirmed plan",
    DRAFT: "Draft awaiting confirmation",
    CONFIRMED: "Plan confirmed",
    LOCKED: "Plan locked",
    OPEN: "Planning remains open",
    LOCKED_WINDOW: "All plans are locked",
    SETTLING: "The world is resolving every plan",
    COMMITTED: "Authoritative results are confirmed",
    PUBLISHING: "Results are being delivered",
    COMPLETED: "This situation is complete",
    FAILED_RETRYABLE: "This situation is recovering",
    FAILED_HARD: "This situation is paused",
    ABORTED: "This situation was aborted",
    results: "Situation Results",
    own: "Your outcome",
    cross: "Another plan changed your position",
    world: "World change",
    trace: "Observable trace",
    knowledge: "New information",
    reasons: "Why this happened",
    changes: "State changes",
    narrativePending: "Narrative is being added. The authoritative result is already in effect.",
    narrativeFailed: "Narrative is temporarily unavailable. The authoritative result and next window are unaffected.",
    narrative: "Story Echo",
  },
});

export function renderB0WindowStatusV1(state, locale = "zh", now = Date.now()) {
  if (!state?.active || !state.projection) return "";
  const copy = COPY[locale] || COPY.zh;
  const projection = state.projection;
  const remaining = b0WindowRemainingMs(state, now);
  const status = statusText(projection.window.status, copy);
  const plan = projection.plan ? copy[projection.plan.status] : copy.noPlan;
  const readyButton = projection.actor.ready
    ? `<button type="button" class="b0-window-ready secondary" data-b0-unready>${esc(copy.unready)}</button>`
    : `<button type="button" class="b0-window-ready" data-b0-ready ${b0CanReady(state) || state.busy ? (state.busy ? "disabled" : "") : "disabled"}>${state.busy ? "…" : esc(copy.ready)}</button>`;
  return `<section class="b0-window-status" data-b0-window-status data-testid="b0-window-status">
    <div class="b0-window-status-heading"><span>${esc(copy.window)}</span><b>${esc(status)}</b></div>
    <p class="b0-window-situation"><strong>${esc(copy.situation)}</strong><span>${esc(projection.window.situationId)}</span></p>
    <dl>
      <div><dt>${esc(copy.plan)}</dt><dd>${esc(plan)}</dd></div>
      <div><dt>${esc(copy.readyCount)}</dt><dd data-testid="b0-ready-count">${projection.readyCount} / ${projection.expectedCount}</dd></div>
      <div><dt>${esc(copy.remaining)}</dt><dd data-b0-countdown>${projection.window.status === "OPEN" && projection.window.locksAt ? formatDuration(remaining) : "—"}</dd></div>
    </dl>
    ${state.error ? `<p class="b0-window-error" role="alert">${esc(state.error)}</p>` : ""}
    ${projection.window.status === "OPEN" ? readyButton : ""}
  </section>`;
}

export function renderB0WindowResultsV1(state, locale = "zh") {
  if (!state?.active || !state.projection) return "";
  const copy = COPY[locale] || COPY.zh;
  const { structuredResults, narrative } = state.projection;
  if (!structuredResults.length && narrative.status === "NOT_REQUESTED") return "";
  const results = structuredResults.map((result) => `<article class="b0-result-card b0-result-${escAttr(result.resultKind.toLowerCase())}" data-testid="b0-result-${escAttr(result.resultId)}">
    <div class="b0-result-heading"><span>${esc(resultLabel(result.resultKind, copy))}</span>${result.outcomeStatus ? `<b>${esc(outcomeLabel(result.outcomeStatus, locale))}</b>` : ""}</div>
    <p>${esc(result.summary)}</p>
    ${result.reasons.length ? `<details open><summary>${esc(copy.reasons)}</summary><ul>${result.reasons.map((reason) => `<li>${esc(reason.summary)}</li>`).join("")}</ul></details>` : ""}
    ${result.changes.length ? `<details><summary>${esc(copy.changes)}</summary><ul>${result.changes.map((change) => `<li>${esc(changeLabel(change, locale))}</li>`).join("")}</ul></details>` : ""}
  </article>`).join("");
  const narrativeHtml = narrative.status === "AVAILABLE" && narrative.content
    ? `<article class="b0-narrative-card" data-testid="b0-narrative"><h3>${esc(copy.narrative)}</h3><p>${esc(narrative.content)}</p></article>`
    : narrative.status === "PENDING"
      ? `<p class="b0-narrative-status" role="status">${esc(copy.narrativePending)}</p>`
      : narrative.status === "FAILED_RETRYABLE"
        ? `<p class="b0-narrative-status warning" role="status">${esc(copy.narrativeFailed)}</p>`
        : "";
  return `<section class="b0-window-results" data-b0-window-results data-testid="b0-window-results"><h2>${esc(copy.results)}</h2>${results}${narrativeHtml}</section>`;
}

function statusText(status, copy) {
  if (status === "OPEN") return copy.OPEN;
  if (status === "LOCKED") return copy.LOCKED_WINDOW;
  return copy[status] || status;
}
function resultLabel(kind, copy) {
  if (kind === "PERSONAL_OUTCOME") return copy.own;
  if (kind === "CROSS_PLAYER_IMPACT") return copy.cross;
  if (kind === "WORLD_EVENT") return copy.world;
  if (kind === "OBSERVABLE_TRACE") return copy.trace;
  if (kind === "KNOWLEDGE_GRANT") return copy.knowledge;
  return kind;
}
function outcomeLabel(status, locale) {
  const labels = locale === "en"
    ? { SUCCESS: "Success", PARTIAL_SUCCESS: "Partial success", CONTESTED: "Contested", BLOCKED: "Blocked", FAILED: "Failed" }
    : { SUCCESS: "成功", PARTIAL_SUCCESS: "部分成功", CONTESTED: "仍有争议", BLOCKED: "被阻断", FAILED: "未能完成" };
  return labels[status] || status;
}
function changeLabel(change, locale) {
  const delta = Number.isFinite(change.numericDelta) && change.numericDelta !== 0
    ? ` ${change.numericDelta > 0 ? "+" : ""}${change.numericDelta}`
    : "";
  return locale === "en"
    ? `${change.kind} · ${change.operation}${delta}`
    : `${change.kind} · ${change.operation}${delta}`;
}
function formatDuration(milliseconds) {
  const total = Math.max(0, Math.ceil(Number(milliseconds || 0) / 1_000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}
function escAttr(value) { return esc(value).replace(/`/g, "&#096;"); }
function esc(value) { return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\"/g, "&quot;").replace(/'/g, "&#039;"); }
