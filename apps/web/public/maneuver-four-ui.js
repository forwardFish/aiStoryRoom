const TYPES = ["contact", "investigate", "leverage", "custom"];
const TYPE_LABELS = {
  contact: "人物交谈",
  investigate: "派遣调查",
  leverage: "使用筹码",
  custom: "自拟谋划"
};
const TYPE_DESCRIPTIONS = {
  contact: "与当前相关人物交谈",
  investigate: "调查当前剧情提供的异常",
  leverage: "打出一张秘密筹码，用后消失",
  custom: "自己决定要推进的一件事"
};
const TYPE_EMPTY_REASONS = {
  contact: "当前无可交谈人物",
  investigate: "当前无调查事项",
  leverage: "当前无合适出牌时机",
  custom: "当前不能自拟"
};
const DISABLED_REASON_ALIASES = new Map([
  ["今日谋划机会已用完", "今日机会已用完"],
  ["今日机会已用完", "今日机会已用完"],
  ["当前没有可交谈人物", "当前无可交谈人物"],
  ["当前无可交谈人物", "当前无可交谈人物"],
  ["当前没有可调查事项", "当前无调查事项"],
  ["当前无调查事项", "当前无调查事项"],
  ["当前剧情没有合适的出牌时机", "当前无合适出牌时机"],
  ["当前无合适出牌时机", "当前无合适出牌时机"],
  ["当前阶段不能自拟谋划", "当前不能自拟"],
  ["当前不能自拟", "当前不能自拟"],
  ["故事已经结束", "今日剧情已结束"],
  ["今日剧情已经结束", "今日剧情已结束"],
  ["今日剧情已结束", "今日剧情已结束"],
  ["当前主线决策尚未开放", "今日剧情已结束"],
  ["当前场景未开放主动谋划", "今日剧情已结束"]
]);

export function emptyManeuverDrafts() {
  return {
    contact: { targetRoleKey: "", messageText: "" },
    investigate: { intentKey: "" },
    leverage: { leverageKey: "", targetRoleKey: "" },
    custom: { customText: "" }
  };
}

export function synchronizeManeuverDrafts(state, view) {
  state.maneuverDrafts ||= emptyManeuverDrafts();
  const panel = view?.maneuverPanel;
  if (!panel) {
    state.activeManeuverType = null;
    return state.maneuverDrafts;
  }

  const contactOptions = options(panel.contact);
  if (
    state.maneuverDrafts.contact.targetRoleKey
    && !contactOptions.some((item) => item.roleKey === state.maneuverDrafts.contact.targetRoleKey)
  ) {
    state.maneuverDrafts.contact.targetRoleKey = "";
  }

  const investigationOptions = options(panel.investigate);
  if (
    state.maneuverDrafts.investigate.intentKey
    && !investigationOptions.some((item) => item.intentKey === state.maneuverDrafts.investigate.intentKey)
  ) {
    state.maneuverDrafts.investigate.intentKey = "";
  }

  const leverageOptions = options(panel.leverage);
  const selectedLeverage = leverageOptions.find(
    (item) => item.leverageKey === state.maneuverDrafts.leverage.leverageKey
  );
  if (state.maneuverDrafts.leverage.leverageKey && !selectedLeverage) {
    state.maneuverDrafts.leverage.leverageKey = "";
    state.maneuverDrafts.leverage.targetRoleKey = "";
  } else if (selectedLeverage) {
    const validTargets = items(selectedLeverage.targets);
    if (!selectedLeverage.requiresTarget) {
      state.maneuverDrafts.leverage.targetRoleKey = "";
    } else if (
      state.maneuverDrafts.leverage.targetRoleKey
      && !validTargets.some((target) => target.roleKey === state.maneuverDrafts.leverage.targetRoleKey)
    ) {
      state.maneuverDrafts.leverage.targetRoleKey = "";
    }
  }

  if (
    state.activeManeuverType
    && (!TYPES.includes(state.activeManeuverType)
      || panel.enabled !== true
      || panel[state.activeManeuverType]?.enabled !== true)
  ) {
    state.activeManeuverType = null;
  }

  return state.maneuverDrafts;
}

export function prepareManeuverDraft(state, view, maneuverType) {
  synchronizeManeuverDrafts(state, view);
  const panel = view?.maneuverPanel || {};
  if (
    maneuverType === "investigate"
    && !state.maneuverDrafts.investigate.intentKey
    && options(panel.investigate).length === 1
  ) {
    state.maneuverDrafts.investigate.intentKey = options(panel.investigate)[0].intentKey;
  }
  if (
    maneuverType === "leverage"
    && !state.maneuverDrafts.leverage.leverageKey
    && options(panel.leverage).length === 1
  ) {
    const option = options(panel.leverage)[0];
    state.maneuverDrafts.leverage.leverageKey = option.leverageKey;
    if (items(option.targets).length === 1) {
      state.maneuverDrafts.leverage.targetRoleKey = option.targets[0].roleKey;
    }
  }
}

export function clearManeuverDraft(state, maneuverType) {
  state.maneuverDrafts ||= emptyManeuverDrafts();
  state.maneuverDrafts[maneuverType] = emptyManeuverDrafts()[maneuverType];
  state.activeManeuverType = null;
  state.maneuverPreview = null;
}

export function buildManeuverCommand(state) {
  const type = state.activeManeuverType;
  const drafts = state.maneuverDrafts || emptyManeuverDrafts();
  if (type === "contact") return { maneuverType: type, ...drafts.contact };
  if (type === "investigate") return { maneuverType: type, ...drafts.investigate };
  if (type === "leverage") return { maneuverType: type, ...drafts.leverage };
  if (type === "custom") return { maneuverType: type, ...drafts.custom };
  return null;
}

export function validateManeuverCommand(command, view) {
  if (!command) return { reason: "请先选择一种主动谋划。" };
  const panel = view?.maneuverPanel;
  const section = panel?.[command.maneuverType];
  if (panel?.enabled !== true || section?.enabled !== true) {
    return {
      reason: canonicalDisabledReason(section?.disabledReason)
        || canonicalDisabledReason(panel?.disabledReason)
        || "当前不能执行这项主动谋划。"
    };
  }
  if (command.maneuverType === "contact") {
    const messageText = String(command.messageText || "").trim();
    if (!command.targetRoleKey) return { reason: "请先选择要交谈的人物。" };
    if (!messageText) return { reason: "请写下要对这个人物说的话。" };
    if (messageText.length > 200) return { reason: "人物交谈最多 200 字，请缩短后再提交。" };
  }
  if (command.maneuverType === "investigate" && !command.intentKey) {
    return { reason: "请选择一项调查。" };
  }
  if (command.maneuverType === "leverage") {
    if (!command.leverageKey) return { reason: "请选择一张筹码。" };
    const option = options(section).find((item) => item.leverageKey === command.leverageKey);
    if (option?.requiresTarget && !command.targetRoleKey) return { reason: "请选择筹码使用对象。" };
  }
  if (command.maneuverType === "custom") {
    const customText = String(command.customText || "").trim();
    const maxLength = Math.max(1, Number(section.maxLength) || 200);
    if (!customText) return { reason: "请写下要主动推进的一件事。" };
    if (customText.length > maxLength) return { reason: `自拟谋划最多 ${maxLength} 字，请缩短后再提交。` };
  }
  return null;
}

export function bindManeuverInputs({ root, state, render, chooseManeuver }) {
  root.querySelectorAll("[data-maneuver-type]").forEach((button) => button.addEventListener("click", () => {
    if (button.disabled || state.busy || state.resolving || state.maneuverPreview) return;
    chooseManeuver(button.dataset.maneuverType);
  }));
  root.querySelectorAll("[data-contact-role]").forEach((button) => button.addEventListener("click", () => {
    if (button.disabled || state.busy || state.resolving) return;
    state.maneuverDrafts.contact.targetRoleKey = button.dataset.contactRole || "";
    render();
  }));
  root.querySelector("#contactMessageText")?.addEventListener("input", (event) => {
    state.maneuverDrafts.contact.messageText = event.target.value;
  });
  root.querySelectorAll("[data-investigation-key]").forEach((button) => button.addEventListener("click", () => {
    if (button.disabled || state.busy || state.resolving) return;
    state.maneuverDrafts.investigate.intentKey = button.dataset.investigationKey || "";
    render();
  }));
  root.querySelectorAll("[data-leverage-key]").forEach((button) => button.addEventListener("click", () => {
    if (button.disabled || state.busy || state.resolving) return;
    const leverageKey = button.dataset.leverageKey || "";
    state.maneuverDrafts.leverage.leverageKey = leverageKey;
    const option = options(state.view?.maneuverPanel?.leverage).find((item) => item.leverageKey === leverageKey);
    state.maneuverDrafts.leverage.targetRoleKey = option?.targets?.length === 1 ? option.targets[0].roleKey : "";
    render();
  }));
  root.querySelectorAll("[data-leverage-target]").forEach((button) => button.addEventListener("click", () => {
    if (button.disabled || state.busy || state.resolving) return;
    state.maneuverDrafts.leverage.targetRoleKey = button.dataset.leverageTarget || "";
    render();
  }));
  root.querySelector("#customManeuverText")?.addEventListener("input", (event) => {
    state.maneuverDrafts.custom.customText = event.target.value;
  });
}

export function resolveManeuverEntry(view, state, type) {
  const panel = view?.maneuverPanel || fallbackPanel(view);
  const section = panel[type] || {};
  const busy = Boolean(state?.busy || state?.resolving);
  const previewOpen = Boolean(state?.maneuverPreview);
  const enabled = !busy
    && !previewOpen
    && panel.enabled === true
    && section.enabled === true;
  return {
    type,
    enabled,
    count: type === "custom" ? null : options(section).length,
    disabledReason: enabled
      ? null
      : resolveDisabledReason({ panel, section, type, busy, previewOpen })
  };
}

export function renderFourManeuverPanel(view, state) {
  synchronizeManeuverDrafts(state, view);
  const panel = view?.maneuverPanel || fallbackPanel(view);
  const active = state.activeManeuverType;
  const preview = state.maneuverPreview;
  const busy = Boolean(state.busy || state.resolving);
  const definitions = TYPES.map((type) => ({
    type,
    label: TYPE_LABELS[type],
    description: TYPE_DESCRIPTIONS[type],
    entry: resolveManeuverEntry({ ...view, maneuverPanel: panel }, state, type)
  }));
  return `<section class="maneuver-panel maneuver-panel--mvp" data-testid="maneuver-panel" aria-busy="${busy}">
    <div class="maneuver-heading"><h2>主动谋划</h2></div>
    <section class="maneuver-usage"><span>今日谋划</span><b>${number(panel.quota?.remaining)} / ${number(panel.quota?.perDay || 2)}</b><small>${busy ? "AI正在推演局势……" : "未使用机会将在今日结束时失效"}</small></section>
    <div class="maneuver-action-list">${definitions.map(({ type, label, description, entry }) => {
      const count = entry.count === null ? "" : `${entry.count} ${type === "contact" ? "人" : type === "investigate" ? "项" : "张"}`;
      const subtitle = entry.enabled ? description : entry.disabledReason || description;
      return `<button type="button" class="maneuver-action-card ${active === type ? "active" : ""} ${entry.enabled ? "" : "disabled"}" data-maneuver-type="${type}" ${entry.enabled ? "" : "disabled"} aria-pressed="${active === type}"><span><b>${label}</b><small>${escapeHtml(subtitle)}</small></span>${count ? `<em>${escapeHtml(count)}</em>` : ""}</button>`;
    }).join("")}</div>
    ${preview ? renderManeuverPreview(preview, busy) : active ? renderWorkbench(view, state, active, busy) : `<p class="maneuver-idle-hint">选择一种方式，为当前主线决策获得更多信息或创造新的条件。</p>`}
    ${state.maneuverGuard ? `<div class="maneuver-guard" data-testid="maneuver-guard"><b>这项谋划暂时不能执行</b><p>${escapeHtml(state.maneuverGuard.reason)}</p>${state.maneuverGuard.suggestedRewrite ? `<small>建议：${escapeHtml(state.maneuverGuard.suggestedRewrite)}</small>` : ""}</div>` : ""}
  </section>`;
}

function renderManeuverPreview(preview, busy) {
  const disabled = busy ? " disabled" : "";
  return `<section class="maneuver-workbench maneuver-preview-card" data-testid="maneuver-preview-card" data-preview-id="${escapeHtml(preview.previewId || "")}">
    <div class="maneuver-workbench-head"><b>${escapeHtml(preview.title || "确认主动谋划")}</b><small>${busy ? "正在确认，请勿重复操作" : "这是服务端对本次行动的理解，不包含结果预测"}</small></div>
    <p class="maneuver-preview-summary">${escapeHtml(preview.summary || "")}</p>
    ${preview.targetLabel ? `<p><b>对象：</b>${escapeHtml(preview.targetLabel)}</p>` : ""}
    <p class="maneuver-preview-cost">${escapeHtml(preview.costLabel || "确认后才会写入世界。")}</p>
    <div class="maneuver-preview-actions">
      <button id="maneuverPreviewCancel" type="button"${disabled}>返回修改</button>
      <button id="maneuverConfirm" type="button"${disabled}>${escapeHtml(preview.confirmLabel || "确认执行")}</button>
    </div>
  </section>`;
}

function renderWorkbench(view, state, type, busy) {
  const panel = view.maneuverPanel || {};
  const drafts = state.maneuverDrafts || emptyManeuverDrafts();
  const disabled = busy ? " disabled" : "";
  if (type === "contact") {
    const section = panel.contact || {};
    const draft = drafts.contact;
    const target = options(section).find((item) => item.roleKey === draft.targetRoleKey);
    const editor = target
      ? `<textarea id="contactMessageText" maxlength="200" placeholder="你想对他说什么？"${disabled}>${escapeHtml(draft.messageText || "")}</textarea>`
      : "";
    const submitLabel = target ? `发送给${target.displayName}` : "选择人物后发送";
    return `<section class="maneuver-workbench" data-testid="maneuver-contact-workbench"><div class="maneuver-workbench-head"><b>选择人物</b><small>列表里的人现在都可以交谈</small></div><div class="maneuver-option-list">${options(section).map((item) => `<button type="button" class="maneuver-option-card ${draft.targetRoleKey === item.roleKey ? "selected" : ""}" data-contact-role="${escapeHtml(item.roleKey)}"${disabled}><span class="contact-avatar ${escapeHtml(item.portrait || "")}" aria-hidden="true"></span><span><b>${escapeHtml(item.displayName)}</b><small>${escapeHtml(item.publicIdentity)} · ${escapeHtml(item.relevance)}</small></span></button>`).join("")}</div>${editor}<button id="maneuverSubmit" type="button"${disabled}>${escapeHtml(submitLabel)}</button></section>`;
  }
  if (type === "investigate") {
    const section = panel.investigate || {};
    const draft = drafts.investigate;
    return `<section class="maneuver-workbench" data-testid="maneuver-investigate-workbench"><div class="maneuver-workbench-head"><b>选择调查</b><small>调查内容由当前剧情决定</small></div><div class="maneuver-option-list">${options(section).map((item) => `<button type="button" class="maneuver-option-card ${draft.intentKey === item.intentKey ? "selected" : ""}" data-investigation-key="${escapeHtml(item.intentKey)}"${disabled}><span><b>${escapeHtml(item.title)}</b><small>${escapeHtml(item.summary)}</small></span></button>`).join("")}</div><button id="maneuverSubmit" type="button"${disabled}>开始调查</button></section>`;
  }
  if (type === "leverage") {
    const section = panel.leverage || {};
    const draft = drafts.leverage;
    const option = options(section).find((item) => item.leverageKey === draft.leverageKey);
    const submitLabel = option ? `使用并消耗“${option.label}”` : "选择筹码后使用";
    return `<section class="maneuver-workbench" data-testid="maneuver-leverage-workbench"><div class="maneuver-workbench-head"><b>选择筹码</b><small>筹码整局有限，确认后永久消失</small></div><div class="maneuver-option-list">${options(section).map((item) => `<button type="button" class="maneuver-option-card ${draft.leverageKey === item.leverageKey ? "selected" : ""}" data-leverage-key="${escapeHtml(item.leverageKey)}"${disabled}><span><b>${escapeHtml(item.label)}</b><small>${escapeHtml(item.description)}</small></span><em>${escapeHtml(item.consumptionLabel || "使用后消失")}</em></button>`).join("")}</div>${option?.requiresTarget ? `<div class="maneuver-target-list"><b>使用对象</b>${items(option.targets).map((target) => `<button type="button" class="${draft.targetRoleKey === target.roleKey ? "selected" : ""}" data-leverage-target="${escapeHtml(target.roleKey)}"${disabled}>${escapeHtml(target.displayName)}</button>`).join("")}</div>` : ""}<button id="maneuverSubmit" type="button"${disabled}>${escapeHtml(submitLabel)}</button></section>`;
  }
  const value = drafts.custom.customText || "";
  const maxLength = Math.max(1, Number(panel.custom?.maxLength) || 200);
  return `<section class="maneuver-workbench" data-testid="maneuver-custom-workbench"><div class="maneuver-workbench-head"><b>自拟谋划</b><small>写下一项当前身份和资源允许的行动</small></div><textarea id="customManeuverText" maxlength="${maxLength}" placeholder="输入你的谋划……"${disabled}>${escapeHtml(value)}</textarea><span class="maneuver-counter">${value.length} / ${maxLength}</span><button id="maneuverSubmit" type="button"${disabled}>执行谋划</button></section>`;
}

export function renderLeverageHand(view) {
  if (!view?.leverageHand) {
    return `<section class="causal-panel leverage-panel"><h2 class="panel-heading"><span>我的筹码</span></h2><p>筹码信息暂不可用，请刷新页面后重试。</p></section>`;
  }
  const items = view.leverageHand.items || [];
  return `<section class="causal-panel leverage-panel"><h2 class="panel-heading"><span>我的筹码</span></h2>${items.length ? `<ul>${items.map((item) => `<li><b>${escapeHtml(item.label)}</b><small>${escapeHtml(item.description)}</small></li>`).join("")}</ul>` : `<p>你的筹码已经全部使用。</p>`}</section>`;
}

function resolveDisabledReason({ panel, section, type, busy, previewOpen }) {
  if (busy) return "AI正在推演局势……";
  if (previewOpen) return "请先确认或返回修改";
  if (Number.isFinite(Number(panel.quota?.remaining)) && Number(panel.quota.remaining) <= 0) {
    return "今日机会已用完";
  }
  if (section.usedToday === true || items(panel.quota?.usedTypesToday).includes(type)) {
    return `今日已使用${TYPE_LABELS[type]}`;
  }
  const sectionReason = canonicalDisabledReason(section.disabledReason);
  if (sectionReason) return sectionReason;
  const panelReason = canonicalDisabledReason(panel.disabledReason);
  if (panelReason) return panelReason;
  return TYPE_EMPTY_REASONS[type] || "今日剧情已结束";
}

function canonicalDisabledReason(value) {
  const reason = String(value || "").trim();
  if (!reason) return "";
  return DISABLED_REASON_ALIASES.get(reason) || reason;
}

function fallbackPanel(view) {
  const rawRemaining = view?.maneuverState?.maneuverOpportunitiesRemaining;
  const hasAuthoritativeQuota = rawRemaining !== null
    && rawRemaining !== undefined
    && Number.isFinite(Number(rawRemaining));
  const remaining = hasAuthoritativeQuota ? number(rawRemaining) : 0;
  const reason = hasAuthoritativeQuota && remaining <= 0
    ? "今日机会已用完"
    : "主动谋划暂不可用，请刷新页面后重试";
  const section = { enabled: false, usedToday: false, count: 0, disabledReason: reason, options: [] };
  return {
    enabled: false,
    disabledReason: reason,
    quota: {
      perDay: 2,
      remaining,
      usedToday: Math.max(0, 2 - remaining),
      usedTypesToday: []
    },
    contact: section,
    investigate: section,
    leverage: section,
    custom: { enabled: false, usedToday: false, disabledReason: reason, maxLength: 200 }
  };
}

function options(section) {
  return items(section?.options);
}

function items(value) {
  return Array.isArray(value) ? value : [];
}

function number(value) { return Math.max(0, Number(value) || 0); }
function escapeHtml(value) { return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char])); }
