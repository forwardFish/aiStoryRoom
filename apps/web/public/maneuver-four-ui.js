const TYPES = ["contact", "investigate", "leverage", "custom"];

export function emptyManeuverDrafts() {
  return {
    contact: { targetRoleKey: "", messageText: "" },
    investigate: { intentKey: "" },
    leverage: { leverageKey: "", targetRoleKey: "" },
    custom: { customText: "" }
  };
}

export function prepareManeuverDraft(state, view, maneuverType) {
  state.maneuverDrafts ||= emptyManeuverDrafts();
  const panel = view?.maneuverPanel || {};
  if (maneuverType === "investigate" && !state.maneuverDrafts.investigate.intentKey && panel.investigate?.options?.length === 1) {
    state.maneuverDrafts.investigate.intentKey = panel.investigate.options[0].intentKey;
  }
  if (maneuverType === "contact" && !state.maneuverDrafts.contact.targetRoleKey && panel.contact?.options?.length === 1) {
    state.maneuverDrafts.contact.targetRoleKey = panel.contact.options[0].roleKey;
  }
  if (maneuverType === "leverage" && !state.maneuverDrafts.leverage.leverageKey && panel.leverage?.options?.length === 1) {
    const option = panel.leverage.options[0];
    state.maneuverDrafts.leverage.leverageKey = option.leverageKey;
    if (option.targets?.length === 1) state.maneuverDrafts.leverage.targetRoleKey = option.targets[0].roleKey;
  }
}

export function clearManeuverDraft(state, maneuverType) {
  state.maneuverDrafts ||= emptyManeuverDrafts();
  state.maneuverDrafts[maneuverType] = emptyManeuverDrafts()[maneuverType];
  state.activeManeuverType = null;
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
  const section = view?.maneuverPanel?.[command.maneuverType];
  if (!section?.enabled) return { reason: section?.disabledReason || view?.maneuverPanel?.disabledReason || "当前不能执行这项主动谋划。" };
  if (command.maneuverType === "contact") {
    if (!command.targetRoleKey) return { reason: "请先选择要交谈的人物。" };
    if (!String(command.messageText || "").trim()) return { reason: "请写下要对这个人物说的话。" };
  }
  if (command.maneuverType === "investigate" && !command.intentKey) return { reason: "请选择一项调查。" };
  if (command.maneuverType === "leverage") {
    if (!command.leverageKey) return { reason: "请选择一张筹码。" };
    const option = section.options?.find((item) => item.leverageKey === command.leverageKey);
    if (option?.requiresTarget && !command.targetRoleKey) return { reason: "请选择筹码使用对象。" };
  }
  if (command.maneuverType === "custom" && !String(command.customText || "").trim()) return { reason: "请写下要主动推进的一件事。" };
  return null;
}

export function bindManeuverInputs({ root, state, render, chooseManeuver }) {
  root.querySelectorAll("[data-maneuver-type]").forEach((button) => button.addEventListener("click", () => chooseManeuver(button.dataset.maneuverType)));
  root.querySelectorAll("[data-contact-role]").forEach((button) => button.addEventListener("click", () => {
    state.maneuverDrafts.contact.targetRoleKey = button.dataset.contactRole || "";
    render();
  }));
  root.querySelector("#contactMessageText")?.addEventListener("input", (event) => { state.maneuverDrafts.contact.messageText = event.target.value; });
  root.querySelectorAll("[data-investigation-key]").forEach((button) => button.addEventListener("click", () => {
    state.maneuverDrafts.investigate.intentKey = button.dataset.investigationKey || "";
    render();
  }));
  root.querySelectorAll("[data-leverage-key]").forEach((button) => button.addEventListener("click", () => {
    const leverageKey = button.dataset.leverageKey || "";
    state.maneuverDrafts.leverage.leverageKey = leverageKey;
    const option = state.view?.maneuverPanel?.leverage?.options?.find((item) => item.leverageKey === leverageKey);
    state.maneuverDrafts.leverage.targetRoleKey = option?.targets?.length === 1 ? option.targets[0].roleKey : "";
    render();
  }));
  root.querySelectorAll("[data-leverage-target]").forEach((button) => button.addEventListener("click", () => {
    state.maneuverDrafts.leverage.targetRoleKey = button.dataset.leverageTarget || "";
    render();
  }));
  root.querySelector("#customManeuverText")?.addEventListener("input", (event) => { state.maneuverDrafts.custom.customText = event.target.value; });
}

export function renderFourManeuverPanel(view, state) {
  const panel = view?.maneuverPanel || fallbackPanel(view);
  const active = state.activeManeuverType;
  const definitions = [
    ["contact", "人物交谈", `${panel.contact?.count || 0} 人`, "与当前相关人物交谈"],
    ["investigate", "派遣调查", `${panel.investigate?.count || 0} 项`, "调查当前剧情提供的异常"],
    ["leverage", "使用筹码", `${panel.leverage?.count || 0} 张`, "打出一张秘密筹码，用后消失"],
    ["custom", "自拟谋划", "", "自己决定要推进的一件事"]
  ];
  return `<section class="maneuver-panel maneuver-panel--mvp" data-testid="maneuver-panel">
    <div class="maneuver-heading"><h2>主动谋划</h2></div>
    <section class="maneuver-usage"><span>今日谋划</span><b>${number(panel.quota?.remaining)} / ${number(panel.quota?.perDay || 2)}</b><small>未使用机会将在今日结束时失效</small></section>
    <div class="maneuver-action-list">${definitions.map(([type, label, count, description]) => {
      const section = panel[type] || {};
      const disabled = !section.enabled;
      const subtitle = disabled ? section.disabledReason || panel.disabledReason || description : description;
      return `<button type="button" class="maneuver-action-card ${active === type ? "active" : ""} ${disabled ? "disabled" : ""}" data-maneuver-type="${type}" ${disabled ? "disabled" : ""} aria-pressed="${active === type}"><span><b>${label}</b><small>${escapeHtml(subtitle)}</small></span>${count ? `<em>${escapeHtml(count)}</em>` : ""}</button>`;
    }).join("")}</div>
    ${active ? renderWorkbench(view, state, active) : `<p class="maneuver-idle-hint">选择一种方式，为当前主线决策获得更多信息或创造新的条件。</p>`}
    ${state.maneuverGuard ? `<div class="maneuver-guard" data-testid="maneuver-guard"><b>这项谋划暂时不能执行</b><p>${escapeHtml(state.maneuverGuard.reason)}</p>${state.maneuverGuard.suggestedRewrite ? `<small>建议：${escapeHtml(state.maneuverGuard.suggestedRewrite)}</small>` : ""}</div>` : ""}
  </section>`;
}

function renderWorkbench(view, state, type) {
  const panel = view.maneuverPanel || {};
  const drafts = state.maneuverDrafts || emptyManeuverDrafts();
  if (type === "contact") {
    const draft = drafts.contact;
    const target = panel.contact.options?.find((item) => item.roleKey === draft.targetRoleKey);
    return `<section class="maneuver-workbench" data-testid="maneuver-contact-workbench"><div class="maneuver-workbench-head"><b>选择人物</b><small>列表里的人现在都可以交谈</small></div><div class="maneuver-option-list">${(panel.contact.options || []).map((item) => `<button type="button" class="maneuver-option-card ${draft.targetRoleKey === item.roleKey ? "selected" : ""}" data-contact-role="${escapeHtml(item.roleKey)}"><span class="contact-avatar ${escapeHtml(item.portrait || "")}" aria-hidden="true"></span><span><b>${escapeHtml(item.displayName)}</b><small>${escapeHtml(item.publicIdentity)} · ${escapeHtml(item.relevance)}</small></span></button>`).join("")}</div><textarea id="contactMessageText" maxlength="200" placeholder="你想对他说什么？">${escapeHtml(draft.messageText || "")}</textarea><button id="maneuverSubmit" type="button">${target ? `发送给${escapeHtml(target.displayName)}` : "开始交谈"}</button></section>`;
  }
  if (type === "investigate") {
    const draft = drafts.investigate;
    return `<section class="maneuver-workbench" data-testid="maneuver-investigate-workbench"><div class="maneuver-workbench-head"><b>选择调查</b><small>调查内容由当前剧情决定</small></div><div class="maneuver-option-list">${(panel.investigate.options || []).map((item) => `<button type="button" class="maneuver-option-card ${draft.intentKey === item.intentKey ? "selected" : ""}" data-investigation-key="${escapeHtml(item.intentKey)}"><span><b>${escapeHtml(item.title)}</b><small>${escapeHtml(item.summary)}</small></span></button>`).join("")}</div><button id="maneuverSubmit" type="button">开始调查</button></section>`;
  }
  if (type === "leverage") {
    const draft = drafts.leverage;
    const option = panel.leverage.options?.find((item) => item.leverageKey === draft.leverageKey);
    return `<section class="maneuver-workbench" data-testid="maneuver-leverage-workbench"><div class="maneuver-workbench-head"><b>选择筹码</b><small>筹码整局有限，使用后永久消失</small></div><div class="maneuver-option-list">${(panel.leverage.options || []).map((item) => `<button type="button" class="maneuver-option-card ${draft.leverageKey === item.leverageKey ? "selected" : ""}" data-leverage-key="${escapeHtml(item.leverageKey)}"><span><b>${escapeHtml(item.label)}</b><small>${escapeHtml(item.description)}</small></span><em>${escapeHtml(item.consumptionLabel || "使用后消失")}</em></button>`).join("")}</div>${option?.requiresTarget ? `<div class="maneuver-target-list"><b>使用对象</b>${(option.targets || []).map((target) => `<button type="button" class="${draft.targetRoleKey === target.roleKey ? "selected" : ""}" data-leverage-target="${escapeHtml(target.roleKey)}">${escapeHtml(target.displayName)}</button>`).join("")}</div>` : ""}<button id="maneuverSubmit" type="button">${option ? `使用并消耗“${escapeHtml(option.label)}”` : "使用筹码"}</button></section>`;
  }
  const value = drafts.custom.customText || "";
  return `<section class="maneuver-workbench" data-testid="maneuver-custom-workbench"><div class="maneuver-workbench-head"><b>自拟谋划</b><small>写下一项当前身份和资源允许的行动</small></div><textarea id="customManeuverText" maxlength="200" placeholder="输入你的谋划……">${escapeHtml(value)}</textarea><span class="maneuver-counter">${value.length} / 200</span><button id="maneuverSubmit" type="button">执行谋划</button></section>`;
}

export function renderLeverageHand(view) {
  const items = view?.leverageHand?.items || [];
  return `<section class="causal-panel leverage-panel"><h2 class="panel-heading"><span>我的筹码</span></h2>${items.length ? `<ul>${items.map((item) => `<li><b>${escapeHtml(item.label)}</b><small>${escapeHtml(item.description)}</small></li>`).join("")}</ul>` : `<p>你的筹码已经全部使用。</p>`}</section>`;
}

function fallbackPanel(view) {
  const remaining = Number(view?.maneuverState?.maneuverOpportunitiesRemaining || 0);
  const reason = remaining > 0 ? "主动谋划配置正在加载" : "今日谋划机会已用完";
  const section = { enabled: false, usedToday: false, count: 0, disabledReason: reason, options: [] };
  return { enabled: false, disabledReason: reason, quota: { perDay: 2, remaining, usedToday: 2 - remaining, usedTypesToday: [] }, contact: section, investigate: section, leverage: section, custom: { enabled: false, usedToday: false, disabledReason: reason, maxLength: 200 } };
}

function number(value) { return Math.max(0, Number(value) || 0); }
function escapeHtml(value) { return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char])); }
