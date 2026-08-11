import { b0CanEdit } from "../b0-window/b0-window-state.js";
import { renderB0WindowStatusV1 } from "../b0-window/b0-window-view.js";

const LABELS = Object.freeze({
  zh: {
    board: "谋划中枢", usage: "本场景谋划", expires: "主线决策锁定后失效",
    CONTACT: "人物交谈", INVESTIGATE: "派遣调查", LEVERAGE: "使用筹码", CUSTOM: "自拟谋划",
    preview: "预演这一步", inProgress: "正在推进", evidence: "情报与证据",
    supports: "能够支持", cannotProve: "不能证明", private: "仅你可见", edit: "返回修改", cancel: "取消",
    chooseContact: "选择交谈人物", message: "你准备对他说什么？", chooseTrace: "选择当前可见的痕迹",
    chooseRoute: "选择一条具体调查路线", chooseLeverage: "选择当前角色持有的筹码", chooseTarget: "选择作用对象",
    leverageIntent: "你准备借此推动什么？", custom: "写下你准备真正做的一件事", optionalChip: "可选附加一项筹码",
    none: "暂不附加", unavailable: "当前没有合法选项", noProgress: "当前没有正在推进的谋划",
    noEvidence: "你还没有获得私人证据", loading: "正在读取当前局势……",
  },
  en: {
    board: "Maneuver Board", usage: "Maneuvers This Scene", expires: "Unused opportunities close with the main decision",
    CONTACT: "Contact", INVESTIGATE: "Investigate", LEVERAGE: "Use Leverage", CUSTOM: "Custom Plan",
    preview: "Preview this move", inProgress: "In Progress", evidence: "Intelligence & Evidence",
    supports: "Supports", cannotProve: "Does not prove", private: "Only you can see this", edit: "Edit", cancel: "Cancel",
    chooseContact: "Choose a contact", message: "What will you say?", chooseTrace: "Choose a visible trace",
    chooseRoute: "Choose a concrete route", chooseLeverage: "Choose leverage owned by this role", chooseTarget: "Choose a target",
    leverageIntent: "What boundary should this leverage change?", custom: "Describe one action you will actually take",
    optionalChip: "Optional attached leverage", none: "No attachment", unavailable: "No legal options are available",
    noProgress: "No maneuver is currently in progress", noEvidence: "You have not acquired private evidence yet",
    loading: "Reading the current situation…",
  },
});

export function localeForManeuverV1(documentLike) {
  return String(documentLike?.documentElement?.lang || "").toLowerCase().startsWith("en") ? "en" : "zh";
}

export function renderManeuverPanelV1(state, locale = "zh", b0State = null) {
  const label = LABELS[locale] || LABELS.zh;
  const projection = state.projection;
  if (!projection) return `<div class="maneuver-v1-shell" data-maneuver-v1-root><div class="maneuver-v1-loading">${esc(label.loading)}</div></div>`;
  const b0Locked = Boolean(b0State?.active && !b0CanEdit(b0State));
  const disabled = state.busy || b0State?.busy || projection.windowState !== "OPEN" || projection.remaining <= 0 || b0Locked;
  const kindButtons = ["CONTACT", "INVESTIGATE", "LEVERAGE", "CUSTOM"].map((kind) => `
    <button type="button" data-mv1-kind="${kind}" data-testid="maneuver-kind-${kind.toLowerCase()}" class="maneuver-v1-kind ${state.selectedKind === kind ? "active" : ""}" aria-pressed="${state.selectedKind === kind}" ${disabled ? "disabled" : ""}>${esc(label[kind])}</button>`).join("");
  const progress = projection.inProgress.length
    ? projection.inProgress.map((entry) => `<article class="maneuver-v1-progress-row"><span>${esc(entry.label)}</span><b>${esc(statusLabel(entry.status, locale))}</b></article>`).join("")
    : `<p class="maneuver-v1-empty">${esc(label.noProgress)}</p>`;
  return `<div class="maneuver-v1-shell" data-maneuver-v1-root data-testid="maneuver-panel-v1">
    <div class="maneuver-v1-heading"><h2>${esc(label.board)}</h2><span class="maneuver-v1-live" aria-hidden="true"></span></div>
    ${b0State?.active ? renderB0WindowStatusV1(b0State, locale) : ""}
    <section class="maneuver-v1-usage" data-testid="maneuver-opportunities"><span>${esc(label.usage)}</span><b>${projection.remaining} / ${projection.maxPerTurn}</b><small>${esc(label.expires)}</small></section>
    <div class="maneuver-v1-kind-grid" aria-label="${esc(label.board)}">${kindButtons}</div>
    ${renderWorkbenchV1(state, label, disabled)}
    ${state.error ? `<p class="maneuver-v1-message error" role="alert">${esc(state.error)}</p>` : ""}
    ${state.notice ? `<p class="maneuver-v1-message notice" role="status">${esc(state.notice)}</p>` : ""}
    <button type="button" class="maneuver-v1-preview-button" data-mv1-preview ${disabled ? "disabled" : ""}>${state.busy ? "…" : esc(label.preview)}</button>
    <details class="maneuver-v1-progress" open><summary>${esc(label.inProgress)} <span>${projection.inProgress.length}</span></summary>${progress}</details>
  </div>`;
}

export function renderManeuverPreviewV1(state, locale = "zh") {
  const label = LABELS[locale] || LABELS.zh;
  const preview = state.preview;
  if (!preview) return "";
  if (preview.decision !== "READY") {
    return `<section class="maneuver-v1-preview-card maneuver-v1-preview-warning" data-maneuver-v1-preview data-testid="action-preview-card" role="dialog" aria-modal="false">
      <p>${esc(preview.clarificationPrompt || state.error || "")}</p>
      <div class="maneuver-v1-preview-actions"><button type="button" data-mv1-edit>${esc(label.edit)}</button></div>
    </section>`;
  }
  const presentation = preview.presentation || {};
  return `<section class="maneuver-v1-preview-card" data-maneuver-v1-preview data-testid="action-preview-card" role="dialog" aria-modal="false" aria-labelledby="maneuver-v1-preview-title">
    <div class="maneuver-v1-preview-kicker">${esc(label.private)}</div>
    <h2 id="maneuver-v1-preview-title">${esc(presentation.title)}</h2>
    <p class="maneuver-v1-preview-description">${esc(presentation.description)}</p>
    <section><h3>${locale === "en" ? "What starts when you confirm" : "确认后立即开始"}</h3><p>${esc(presentation.visibleEffect)}</p></section>
    ${presentation.visibleRisk ? `<section><h3>${locale === "en" ? "What remains uncertain" : "仍然不能保证"}</h3><p>${esc(presentation.visibleRisk)}</p></section>` : ""}
    <div class="maneuver-v1-preview-actions">
      <button type="button" data-mv1-edit>${esc(label.edit)}</button>
      <button type="button" data-mv1-cancel>${esc(label.cancel)}</button>
      <button type="button" class="maneuver-v1-confirm" data-mv1-confirm ${state.busy ? "disabled" : ""}>${state.busy ? "…" : esc(presentation.confirmLabel || (locale === "en" ? "Confirm" : "确认这一步"))}</button>
    </div>
  </section>`;
}

export function renderEvidenceHandV1(state, locale = "zh") {
  const label = LABELS[locale] || LABELS.zh;
  const evidence = state.projection?.privateEvidence || [];
  return `<section class="causal-panel maneuver-v1-evidence-hand" data-maneuver-v1-evidence data-testid="evidence-hand">
    <h2 class="panel-heading"><span>${esc(label.evidence)}</span><b>${evidence.length}</b></h2>
    ${evidence.length ? evidence.map((card) => `<article class="maneuver-v1-evidence-card" data-testid="evidence-card-${escAttr(card.evidenceId)}">
      <div><b>${esc(card.title)}</b><span>${esc(card.sourceKind)}</span></div><p>${esc(card.summary)}</p>
      <dl><dt>${esc(label.supports)}</dt><dd>${esc(card.supports)}</dd><dt>${esc(label.cannotProve)}</dt><dd>${esc(card.cannotProve)}</dd></dl><small>${esc(label.private)}</small>
    </article>`).join("") : `<p class="maneuver-v1-empty">${esc(label.noEvidence)}</p>`}
  </section>`;
}

function renderWorkbenchV1(state, label, disabled) {
  const projection = state.projection;
  const kind = state.selectedKind;
  if (kind === "CONTACT") {
    const draft = state.drafts.CONTACT;
    const contacts = projection.contacts.length
      ? projection.contacts.map((contact) => `<option value="${escAttr(contact.id)}" ${draft.targetId === contact.id ? "selected" : ""}>${esc(contact.label)}</option>`).join("")
      : `<option value="">${esc(label.unavailable)}</option>`;
    return `<section class="maneuver-v1-workbench" data-testid="maneuver-contact-workbench"><label>${esc(label.chooseContact)}<select data-mv1-field="targetId" data-mv1-for="CONTACT" ${disabled ? "disabled" : ""}>${contacts}</select></label><label>${esc(label.message)}<textarea data-mv1-field="rawText" data-mv1-for="CONTACT" maxlength="500" ${disabled ? "disabled" : ""}>${esc(draft.rawText)}</textarea></label>${renderChipSelect(projection, draft.leverageAssetId, label, "CONTACT", disabled)}</section>`;
  }
  if (kind === "INVESTIGATE") {
    const draft = state.drafts.INVESTIGATE;
    const traces = projection.traces.length
      ? projection.traces.map((trace) => `<button type="button" class="maneuver-v1-option ${draft.traceId === trace.traceId ? "selected" : ""}" data-mv1-trace="${escAttr(trace.traceId)}" ${disabled ? "disabled" : ""}><b>${esc(trace.label)}</b><small>${esc(trace.description)}</small></button>`).join("")
      : `<p class="maneuver-v1-empty">${esc(label.unavailable)}</p>`;
    const trace = projection.traces.find((entry) => entry.traceId === draft.traceId);
    const routes = trace?.routeOptions?.length
      ? trace.routeOptions.map((route) => `<button type="button" class="maneuver-v1-route ${draft.routeId === route.routeId ? "selected" : ""}" data-mv1-route="${escAttr(route.routeId)}" ${disabled ? "disabled" : ""}><b>${esc(route.label)}</b><small>${esc(route.method)}</small></button>`).join("")
      : `<p class="maneuver-v1-empty">${esc(label.chooseTrace)}</p>`;
    return `<section class="maneuver-v1-workbench" data-testid="maneuver-investigate-workbench"><h3>${esc(label.chooseTrace)}</h3><div class="maneuver-v1-option-list">${traces}</div><h3>${esc(label.chooseRoute)}</h3><div class="maneuver-v1-route-list">${routes}</div>${renderChipSelect(projection, draft.leverageAssetId, label, "INVESTIGATE", disabled)}</section>`;
  }
  if (kind === "LEVERAGE") {
    const draft = state.drafts.LEVERAGE;
    const assets = projection.leverageAssets.length
      ? projection.leverageAssets.map((asset) => `<button type="button" class="maneuver-v1-option ${draft.leverageAssetId === asset.id ? "selected" : ""}" data-mv1-leverage="${escAttr(asset.id)}" ${disabled ? "disabled" : ""}><b>${esc(asset.label)}</b><small>${esc(asset.effectSummary)}</small></button>`).join("")
      : `<p class="maneuver-v1-empty">${esc(label.unavailable)}</p>`;
    const targets = [...projection.contacts.map((entry) => ({ id: entry.id, label: entry.label })), ...projection.traces.map((entry) => ({ id: entry.traceId, label: entry.label }))];
    const options = targets.length ? targets.map((entry) => `<option value="${escAttr(entry.id)}" ${draft.targetId === entry.id ? "selected" : ""}>${esc(entry.label)}</option>`).join("") : `<option value="">${esc(label.unavailable)}</option>`;
    return `<section class="maneuver-v1-workbench" data-testid="maneuver-leverage-workbench"><h3>${esc(label.chooseLeverage)}</h3><div class="maneuver-v1-option-list">${assets}</div><label>${esc(label.chooseTarget)}<select data-mv1-field="targetId" data-mv1-for="LEVERAGE" ${disabled ? "disabled" : ""}>${options}</select></label><label>${esc(label.leverageIntent)}<textarea data-mv1-field="rawText" data-mv1-for="LEVERAGE" maxlength="500" ${disabled ? "disabled" : ""}>${esc(draft.rawText)}</textarea></label></section>`;
  }
  const draft = state.drafts.CUSTOM;
  return `<section class="maneuver-v1-workbench" data-testid="maneuver-custom-workbench"><label>${esc(label.custom)}<textarea data-mv1-field="rawText" data-mv1-for="CUSTOM" maxlength="500" ${disabled ? "disabled" : ""}>${esc(draft.rawText)}</textarea></label>${renderChipSelect(projection, draft.leverageAssetId, label, "CUSTOM", disabled)}</section>`;
}

function renderChipSelect(projection, selected, label, kind, disabled) {
  const options = [`<option value="">${esc(label.none)}</option>`, ...projection.leverageAssets.map((asset) => `<option value="${escAttr(asset.id)}" ${selected === asset.id ? "selected" : ""}>${esc(asset.label)}</option>`)].join("");
  return `<label>${esc(label.optionalChip)}<select data-mv1-field="leverageAssetId" data-mv1-for="${kind}" ${disabled ? "disabled" : ""}>${options}</select></label>`;
}
function statusLabel(status, locale) { const resolved = String(status || "").toUpperCase() === "RESOLVED"; return locale === "en" ? (resolved ? "Resolved" : "In progress") : (resolved ? "已获得结果" : "正在推进"); }
function escAttr(value) { return esc(value).replace(/`/g, "&#096;"); }
export function esc(value) { return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\"/g, "&quot;").replace(/'/g, "&#039;"); }
