export function renderContinuousGame(root, state, handlers) {
  const p = state.projection;
  const players = p.roomSummary.players || [];
  const controls = new Map(p.roleControllerStates.map((item) => [item.roleId, item]));
  const terminal = Boolean(state.result || p.resultReady);
  root.innerHTML = `<div class="causal-shell continuous-game-shell" data-testid="continuous-story-shell">
    ${topbar(p, state)}
    <div class="status-strip continuous-status-strip" aria-label="房间状态">
      <span>共同回合 <b>${p.run.stageIndex} / 7</b></span>
      <span class="metric-green">在线角色 <b>${p.roleControllerStates.filter((item) => item.presence === "ONLINE").length}</b></span>
      <span class="metric-gold">本轮主决策 <b>${p.observablePlayerStates.filter((item) => item.decisionState === "DECIDED").length} / 3</b></span>
      <span class="metric-green">房间同步 <b>${state.connected ? "实时" : "重连中"}</b></span>
      <span class="metric-crown">剩余裁决 <b>${Math.max(0, 7 - p.run.stageIndex)}</b></span>
    </div>
    <aside class="causal-left" aria-label="我的角色">${identity(p)}${brief(p)}${history(p)}</aside>
    <main class="causal-center continuous-center">${center(p, state)}</main>
    <aside class="causal-right continuous-right" aria-label="${terminal ? "终局摘要" : "共同故事局"}">${terminal ? terminalRail(p, state.result) : `${party(players, controls, p)}${maneuver(p, state)}${control(p, state)}`}</aside>
    ${reaction(p, state)}
    ${state.error ? `<div class="banner error-banner" data-testid="continuous-error"><span>${esc(state.error)}</span><button type="button" data-dismiss-error>×</button></div>` : ""}
    ${state.notice ? `<div class="banner notice-banner" data-testid="continuous-notice"><span>${esc(state.notice)}</span></div>` : ""}
  </div>`;
  bind(root, handlers);
}

function bind(root, h) {
  root.querySelectorAll("[data-main-key]").forEach((el) => el.addEventListener("click", () => h.selectMain(el.dataset.mainKey)));
  root.querySelector("[data-submit-main]")?.addEventListener("click", h.submitMain);
  root.querySelectorAll("[data-maneuver-key]").forEach((el) => el.addEventListener("click", () => h.selectManeuver(el.dataset.maneuverKey)));
  root.querySelector("[data-submit-maneuver]")?.addEventListener("click", h.submitManeuver);
  root.querySelectorAll("[data-reaction-key]").forEach((el) => el.addEventListener("click", () => h.submitReaction(el.dataset.reactionKey)));
  root.querySelector("[data-layout-done]")?.addEventListener("click", () => h.finishLayout(false));
  root.querySelector("[data-leave-stage]")?.addEventListener("click", () => h.finishLayout(true));
  root.querySelector("[data-handoff]")?.addEventListener("click", h.handoff);
  root.querySelector("[data-reclaim]")?.addEventListener("click", h.reclaim);
  root.querySelector("[data-unlock]")?.addEventListener("click", h.unlock);
  root.querySelector("[data-refresh]")?.addEventListener("click", h.refresh);
  root.querySelector("[data-result]")?.addEventListener("click", h.showResult);
  root.querySelector("[data-dismiss-error]")?.addEventListener("click", h.dismissError);
}

function topbar(p, state) {
  const w = p.actionWindow || {};
  const terminal = Boolean(state.result || p.resultReady);
  const deadline = terminal ? null : w.status === "MAIN_OPEN" ? w.mainClosesAt : w.graceClosesAt;
  return `<header class="causal-topbar">
    <a class="mw-brand" href="/worlds/sangtian"><span class="mw-brand-mark">Our Many Worlds</span></a>
    <div class="location-title" title="杭州总督府 · 内厅"><span class="seal-mark">⌂</span><b>杭州总督府 · 内厅</b></div>
    <div class="top-day">${terminal ? "终局 · 御前裁决" : `第 ${p.run.stageIndex} 轮 · 共同决策`}</div>
    <div class="top-countdown">${terminal ? "七轮推演：<b>已完成</b>" : `距离御前裁决：<b>${Math.max(0, 7 - p.run.stageIndex)}</b> 轮`}</div>
    <span class="status-chip">${terminal ? "结局已落定" : windowLabel(w.status)}</span>
    <span class="status-chip maneuver-chip">${terminal ? "终局回顾" : controlLabel(p.myControl)} <i></i></span>
    <div class="top-actions"><button type="button" data-refresh ${state.busy ? "disabled" : ""}>刷新局势</button><a href="/rooms/${encodeURIComponent(p.run.runId)}">返回房间</a></div>
    ${deadline ? `<time class="continuous-deadline" datetime="${esc(deadline)}">截止 ${formatTime(deadline)}</time>` : ""}
  </header>`;
}

function identity(p) {
  const player = p.player;
  const nickname = p.roomSummary.players.find((item) => item.userId === player.userId)?.nickname || "玩家";
  return `<section class="causal-panel player continuous-identity" data-testid="my-identity"><h2>我的身份</h2><div class="portrait ${portraitClass(player.roleKey)}" role="img" aria-label="${esc(player.roleName)}"></div><h3>${esc(player.roleName)}</h3><p class="player-meta"><strong>${esc(nickname)}</strong><span>${esc(player.identity || player.publicInfo || "共同故事局成员")}</span></p><em>${esc(controlDescription(p.myControl))}</em></section>`;
}

function brief(p) {
  const value = p.privateBrief || {};
  return `<section class="causal-panel day-mission" data-testid="private-brief"><h2>本轮私密目标</h2><p>${esc(value.text || p.player.personalGoal || "在共同局势中守住你的角色立场。")}</p>${value.personalPressure ? `<ul><li>${esc(value.personalPressure)}</li><li>${esc(p.player.personalGoal)}</li></ul>` : ""}<small>此信息只投影给你的账号</small></section>`;
}

function history(p) {
  const actions = p.myActions.slice(0, 8);
  return `<section class="causal-panel continuous-history"><h2>我的行动时间线</h2>${actions.length ? actions.map((a) => `<article><b>${slotLabel(a.actionSlot)}</b><span>${esc(actionHistoryLabel(a))}</span><em>${actorLabel(a.actorKind)}</em></article>`).join("") : `<p>尚未提交行动。</p>`}</section>`;
}

export function actionHistoryLabel(action) {
  const bySlot = {
    MAIN: "主线选择已保存",
    MANEUVER: "角色谋划已记录",
    REACTION: "定向回应已提交",
    SYSTEM_ACTION: "局势变化已记录"
  };
  return bySlot[action?.actionSlot] || "行动已记录";
}

function center(p, state) {
  if (state.result) return resultView(state.result);
  if (p.resultReady) return `<section class="result-narrative continuous-result-ready"><div class="result-copy"><span class="room-formal-kicker">七轮共同推演完成</span><h1>御前裁决已经落定</h1><p>${esc(playerFacingCopy(p.latestPublicResult?.content || "共同结局与个人命运已经生成。"))}</p><button type="button" class="continuous-primary" data-result>查看我的完整结局</button></div></section>`;
  if (p.access.state === "REQUIRES_UNLOCK") return unlockView(p, state);
  const w = p.actionWindow || {};
  if (["CLOSING", "RESOLVING", "PROJECTING"].includes(w.status) || p.run.status === "resolving") return resolving(p);
  if (w.status === "MAIN_OPEN" && p.availableMainActions.length) return decision(p, state);
  if (w.status === "INTERACTION_GRACE") return grace(p, state);
  return waiting(p);
}

function decision(p, state) {
  const node = p.currentNode || {};
  return `<section class="opening-narrative continuous-decision" data-testid="main-decision"><div class="continuous-scene-copy"><span>第 ${p.run.stageIndex} 轮 · 共同故事局</span><h1>${esc(node.title || "嘉靖财政危局")}</h1><p>${esc(node.publicNarration || node.commonContest || "三方角色必须分别作出判断。")}</p></div><div class="continuous-card-stack"><h2>你要如何应对？</h2>${p.availableMainActions.map((a, i) => `<button type="button" class="continuous-action-card ${state.selectedMain === a.actionKey ? "selected" : ""}" data-main-key="${esc(a.actionKey)}"><b>${String.fromCharCode(65 + i)}</b><span><strong>${esc(a.title)}</strong><small>${esc(a.description)}</small></span></button>`).join("")}<button type="button" class="continuous-primary" data-submit-main ${!state.selectedMain || state.busy ? "disabled" : ""}>${state.busy ? "正在密封决策…" : "提交主线决策"}</button></div></section>`;
}

function grace(p, state) {
  const participant = p.actionWindow.myParticipant;
  const done = Boolean(participant.doneAt);
  return `<section class="result-narrative continuous-grace" data-testid="interaction-grace"><div class="result-copy"><span class="room-formal-kicker">主线决策已经汇合 · 现在可以继续布局</span><h1>${done ? "你的本轮布局已完成" : "主决策之后，你仍有行动空间"}</h1><p>${esc(playerFacingCopy(p.latestPublicResult?.content || "你可以追加一次角色谋划、处理定向回应，或者确认完成本阶段。"))}</p>${p.latestPersonalResult ? `<blockquote>${esc(playerFacingCopy(p.latestPersonalResult.content))}</blockquote>` : ""}${done ? `<div class="room-waiting-progress"><b>${p.observablePlayerStates.filter((item) => item.layoutDone).length} / 3</b><span>名角色已完成布局；房间会自动结算</span></div>` : `<div class="continuous-layout-actions"><button type="button" data-layout-done ${state.busy || p.pendingReaction ? "disabled" : ""}>完成本阶段布局</button><button type="button" data-leave-stage ${state.busy || p.pendingReaction ? "disabled" : ""}>完成并离开本阶段</button></div><small>“离开本阶段”不会把角色交给 AI；托管是右侧单独操作。</small>`}</div></section>`;
}

function waiting(p) {
  const participant = p.actionWindow?.myParticipant || {};
  const ai = ["AI_ACTIVE", "HUMAN_RECLAIM_PENDING"].includes(p.myControl.mode);
  return `<section class="result-narrative room-waiting-narrative" data-testid="room-waiting"><div class="result-copy"><span class="room-formal-kicker">第 ${p.run.stageIndex} 轮 · ${windowLabel(p.actionWindow?.status)}</span><h1>${ai ? "角色 Agent 正在继续你的行动" : participant.mainStatus === "SUBMITTED" ? "你的主线决策已经送达" : "共同局势正在准备"}</h1><p>${ai ? "AI 只使用你角色获准看到的目标、资源和事实，不会替你支付或解锁。" : "你不必停留在空白等待页；可以查看其他角色进度、行动历史和可见事件。"}</p><div class="room-waiting-progress"><b>${p.observablePlayerStates.filter((item) => item.decisionState === "DECIDED").length} / 3</b><span>名角色已完成主线决策</span></div></div></section>`;
}

function resolving(p) {
  return `<section class="simulation-stage" data-testid="room-resolving"><div class="simulation-copy"><span>第 ${p.run.stageIndex} 轮 · 权威裁决器</span><div class="simulation-seal">推演<br>中</div><h1>三方行动正在形成共同后果</h1><p>规则、资产账本与角色 Agent 的行动正在同一条因果链中结算，无需房主手动推进。</p><small>完成后，三个页面会通过房间事件自动进入下一轮。</small></div></section>`;
}

function unlockView(p, state) {
  return `<section class="result-narrative continuous-unlock" data-testid="unlock-gate"><div class="result-copy"><span class="room-formal-kicker">第 4 轮 · 共享世界解锁</span><h1>暗账浮出，故事需要真人授权继续</h1><p>本次解锁属于整个房间，只需一名真人成员支付一次 ${p.access.requiredCredits} 点。角色 Agent 没有支付权限。</p><button type="button" class="continuous-primary" data-unlock ${!p.access.canCurrentUserUnlock || state.busy ? "disabled" : ""}>${p.access.canCurrentUserUnlock ? `使用 ${p.access.requiredCredits} 点解锁本局` : "点数不足，等待其他真人成员解锁"}</button><small>解锁后仍使用同一个 RunId，三页会实时同步。</small></div></section>`;
}

function party(players, controls, p) {
  const states = new Map(p.observablePlayerStates.map((item) => [item.roleId, item]));
  return `<section class="maneuver-panel continuous-party" data-testid="room-party-panel"><div class="maneuver-heading"><h2>共同故事局</h2><span class="room-formal-live"><i></i>实时同步</span></div><div class="room-formal-party-list">${players.map((player) => { const c = controls.get(player.roleId) || {}; const s = states.get(player.roleId) || {}; const mine = player.roleId === p.player.roleId; const label = c.controllerKind === "AI" ? "AI 代理" : s.decisionState === "DECIDED" ? "已决策" : "思考中"; return `<article class="${s.decisionState === "DECIDED" ? "submitted" : ""} ${mine ? "mine" : ""}"><div><b>${esc(player.nickname)}${mine ? " · 你" : ""}</b><small>${esc(player.roleName)}</small></div><em>${label}</em></article>`; }).join("")}</div><p class="room-party-help">每位玩家只提交自己角色的行动；房间由服务端自动结算。</p></section>`;
}

function maneuver(p, state) {
  const actions = p.availableManeuvers || [];
  return `<section class="maneuver-panel continuous-maneuver" data-testid="maneuver-panel"><div class="maneuver-heading"><h2>谋划中枢</h2><span>${p.actionWindow?.status === "INTERACTION_GRACE" ? "本轮可用" : "等待主决策"}</span></div>${actions.length ? `<div class="continuous-maneuver-list">${actions.map((a) => `<button type="button" class="${state.selectedManeuver === a.actionKey ? "selected" : ""}" data-maneuver-key="${esc(a.actionKey)}"><b>${esc(a.title)}</b><small>${esc(a.description)}</small></button>`).join("")}</div><button type="button" class="room-party-resolve" data-submit-maneuver ${!state.selectedManeuver || state.busy ? "disabled" : ""}>执行谋划</button>` : `<p class="room-party-help">提交主决策后，本轮谋划会在这里出现。谋划不会阻塞其他玩家。</p>`}</section>`;
}

function control(p, state) {
  const c = p.myControl;
  const human = ["HUMAN_ACTIVE", "HUMAN_OFFLINE_GRACE"].includes(c.mode);
  return `<section class="maneuver-panel continuous-control" data-testid="control-panel"><div class="maneuver-heading"><h2>角色控制</h2><span>${controlLabel(c)}</span></div><p>${esc(controlDescription(c))}</p>${human ? `<button type="button" class="continuous-danger" data-handoff ${state.busy ? "disabled" : ""}>退出本局并交给 AI</button>` : c.controllerKind === "AI" ? `<button type="button" class="continuous-primary compact" data-reclaim ${state.busy ? "disabled" : ""}>接管我的角色</button>` : `<button type="button" disabled>将在下一安全窗口恢复</button>`}</section>`;
}

function terminalRail(p, value) {
  const decisions = value?.myKeyDecisions?.length || 0;
  const impacts = value?.authorizedCrossImpacts?.length || 0;
  return `<section class="maneuver-panel continuous-terminal-rail" data-testid="terminal-summary-panel"><div class="maneuver-heading"><h2>本局已结束</h2><span>终局已落定</span></div><div class="continuous-terminal-seal" aria-hidden="true">终</div><h3>七轮共同推演完成</h3><p>现在可以安心阅读共同结局、个人命运与关键行动回顾；谋划和角色控制已经关闭。</p>${value ? `<dl><div><dt>关键行动</dt><dd>${decisions}</dd></div><div><dt>跨角色影响</dt><dd>${impacts}</dd></div><div><dt>完成轮次</dt><dd>${p.run.stageIndex} / 7</dd></div></dl>` : `<div class="continuous-terminal-progress"><b>${p.run.stageIndex} / 7</b><span>共同裁决已经完成</span></div>`}<a href="/rooms">返回我的故事局</a></section>`;
}

function reaction(p, state) {
  const value = p.pendingReaction;
  if (!value) return "";
  const sourceRoleName = playerFacingCopy(value.sourceRoleName || "另一名角色");
  const triggerActionTitle = playerFacingCopy(value.triggerActionTitle || "一项需要你回应的行动");
  return `<div class="critical-overlay" data-testid="reaction-modal"><section class="critical-modal continuous-reaction" role="dialog" aria-modal="true" aria-labelledby="continuous-reaction-title"><span class="room-formal-kicker">定向回应 · 只有你能处理</span><h2 id="continuous-reaction-title">${esc(sourceRoleName)}要求你作出回应</h2><div class="continuous-reaction-context"><small>触发行动</small><strong>“${esc(triggerActionTitle)}”</strong><p>请根据你当前角色掌握的信息作出选择；回应完成后，才能继续本轮主决策或布局。</p></div><div class="continuous-reaction-options">${value.options.map((a) => `<button type="button" data-reaction-key="${esc(a.actionKey)}" ${state.busy ? "disabled" : ""}>${esc(a.title)}</button>`).join("")}</div><small class="continuous-reaction-deadline">截止 ${formatTime(value.expiresAt)}；超时将采用角色边界内的默认回应。</small></section></div>`;
}

function resultView(value) {
  const decisions = value.myKeyDecisions?.length || 0;
  const impacts = value.authorizedCrossImpacts?.length || 0;
  const controlChanges = value.myControlTimeline?.length || 0;
  const highlights = resultDecisionHighlights(value.myKeyDecisions);
  return `<section class="result-narrative continuous-final" data-testid="continuous-result"><div class="result-copy"><span class="room-formal-kicker">共同结局</span><h1>${esc(playerFacingCopy(value.publicEnding?.content || "御前裁决已经落定"))}</h1><h2>我的角色结局</h2><p>${esc(playerFacingCopy(value.personalEnding?.content || ""))}</p><section class="continuous-ending-basis"><h2>为什么会得到这个结局</h2><p>${esc(resultCausalitySummary(value))}</p>${highlights.length ? `<ol class="continuous-decision-highlights">${highlights.map((item) => `<li>${esc(item)}</li>`).join("")}</ol>` : `<p class="continuous-decision-pending">本局关键行动已经计入裁决，具体行动题名暂未同步。</p>`}<p class="continuous-control-summary">${controlChanges ? `本局发生 ${controlChanges} 次控制权变化，这些变化也计入角色时间线。` : "七轮行动均由你本人完成，没有发生 AI 接管或控制权切换。"}</p></section><div class="continuous-result-stats"><span>关键行动 <b>${decisions}</b></span><span>可见跨角色影响 <b>${impacts}</b></span><span>控制权变化 <b>${controlChanges}</b></span></div><a class="continuous-primary" href="/rooms">返回我的故事局</a></div></section>`;
}

export function resultDecisionHighlights(value) {
  const normalized = (Array.isArray(value) ? value : [])
    .map((item) => ({
      stageIndex: Number(item?.stageIndex),
      slot: String(item?.slot || ""),
      title: playerFacingCopy(item?.title || "").trim(),
      actorKind: String(item?.actorKind || "")
    }))
    .filter((item) => Number.isInteger(item.stageIndex) && item.stageIndex > 0 && item.title && !/\b(?:main|maneuver|reaction|system)_s?\d+_[a-z0-9_]+\b/i.test(item.title))
    .sort((left, right) => left.stageIndex - right.stageIndex || slotOrder(left.slot) - slotOrder(right.slot));
  const unique = normalized.filter((item, index, items) => index === items.findIndex((candidate) => candidate.stageIndex === item.stageIndex && candidate.title === item.title));
  const main = unique.filter((item) => item.slot === "MAIN");
  const pool = main.length >= 2 ? main : unique;
  const picks = pool.length <= 3 ? pool : [pool[0], pool[Math.floor((pool.length - 1) / 2)], pool[pool.length - 1]];
  return picks.map((item) => `第 ${item.stageIndex} 轮「${item.title}」· ${resultActorLabel(item.actorKind)}`);
}

function slotOrder(value) { return value === "MAIN" ? 0 : value === "MANEUVER" ? 1 : value === "REACTION" ? 2 : 3; }
function resultActorLabel(value) { return value === "HUMAN" ? "本人" : value === "SYSTEM" ? "系统" : "AI"; }

const labels = {
  window: { PREPARING: "准备中", MAIN_OPEN: "主线决策", INTERACTION_GRACE: "谋划与回应", CLOSING: "正在收束", RESOLVING: "共同推演", PROJECTING: "发布结果", RESOLVED: "本轮完成" },
  control: { HUMAN_ACTIVE: "你在操控", HUMAN_OFFLINE_GRACE: "断线恢复期", AI_ACTIVE: "AI 托管中", HUMAN_RECLAIM_PENDING: "接管待生效", SYSTEM: "系统角色" },
  slot: { MAIN: "主决策", MANEUVER: "谋划", REACTION: "回应", SYSTEM_ACTION: "系统压力" }
};
function windowLabel(v) { return labels.window[v] || "同步中"; }
function controlLabel(v) { return labels.control[v?.mode] || "状态同步中"; }
function slotLabel(v) { return labels.slot[v] || v; }
function actorLabel(v) { return v === "AI_TAKEOVER" ? "AI 代理" : v === "HUMAN" ? "本人" : v === "TIMEOUT_FALLBACK" ? "超时保底" : "系统"; }
function controlDescription(c) { return c?.mode === "AI_ACTIVE" ? "Role Agent 正在角色知识与资产边界内行动。" : c?.mode === "HUMAN_RECLAIM_PENDING" ? "AI 已密封当前行动；你会从下一安全窗口恢复。" : c?.mode === "HUMAN_OFFLINE_GRACE" ? "页面正在恢复连接，暂时不会启动 AI。" : "当前行动由你本人决定。"; }
function portraitClass(v) { return v === "xunfu" ? "art-game-xunfu" : v === "county_magistrate" ? "art-game-magistrate" : "art-game-governor"; }
function formatTime(v) { const d = new Date(v); return Number.isNaN(d.getTime()) ? "--:--" : d.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit" }); }
const playerFacingStateLabels = Object.freeze({
  state_s1_change_mulberry_order_open: "改桑急令",
  state_s2_county_secret_letter_open: "县令密信",
  state_s3_grain_price_crisis_open: "粮价危机",
  state_s4_hidden_ledger_open: "暗账浮出",
  state_s5_mutual_impeachment_open: "互相弹劾",
  state_s6_capital_reply_open: "京师回牒",
  state_s7_imperial_judgment_open: "御前裁决"
});
const playerFacingEndingLabels = Object.freeze({
  global_reform_and_audit: "新政复核与责任重建",
  global_stable_but_watched: "危局暂稳但京师持续监视",
  global_progress_without_people: "数字完成而民生受损",
  global_scapegoat: "以问责个人封住危局",
  personal_governor_s: "统筹与纠偏被采信",
  personal_governor_a: "稳局有功但担责",
  personal_governor_b: "失察留任观察",
  personal_governor_c: "以失察获罪",
  personal_xunfu_s: "执行与诚信兼得",
  personal_xunfu_a: "政绩获认可但受审计",
  personal_xunfu_b: "执行有功责任未清",
  personal_xunfu_c: "越权催办获罪",
  personal_magistrate_s: "保民与证据链被采信",
  personal_magistrate_a: "证据有功但来源受限",
  personal_magistrate_b: "地方自保获宽宥",
  personal_magistrate_c: "抗令与隐证获罪"
});
const playerFacingEndingReasons = Object.freeze({
  global_reform_and_audit: "三方把进度、损失与证据链纳入同一套复核程序，局势因此转向制度纠偏与责任重建。",
  global_stable_but_watched: "危机暂时被压住，但证据与责任仍有冲突，京师因此保留持续监督。",
  global_progress_without_people: "执行数字得到保全，但粮田和民生代价未被充分纠正，公共结局因此偏向数字完成。",
  global_scapegoat: "证据链阻止真相被完全抹去，但制度矛盾没有解决，御前最终以问责个人封住危局。",
  personal_governor_s: "你把冲突事实纳入主奏并完成纠偏，统筹能力与证据保护因此同时被采信。",
  personal_governor_a: "你稳住了局势并保全证据，但仍为制度失察承担了明确责任。",
  personal_governor_b: "复核来得太晚，御前保留了你的职位，也把后续纠偏置于持续观察之下。",
  personal_governor_c: "你保住了复核与证据链，却在终局承担制度责任，失察责任最终落在总督身上。",
  personal_xunfu_s: "你证明了授权与进度，也正面回应真实代价，执行成果与个人诚信同时成立。",
  personal_xunfu_a: "政绩数字得到认可，但催办时序和损失仍需继续接受审计。",
  personal_xunfu_b: "执行成果被保留，暗账、幕僚往来和追加催办的责任却没有完全厘清。",
  personal_xunfu_c: "密奏、公开进度与追加催办记录之间存在无法消除的差异，越权责任最终落在巡抚身上。",
  personal_magistrate_s: "县册、暗账、民情与来源保护形成完整证据链，保民路线因此被采信。",
  personal_magistrate_a: "证据发挥了作用，但来源保护限制了部分材料的公开使用。",
  personal_magistrate_b: "地方保粮与保全原件的动机得到理解，程序上的自保行为因此获宽宥。",
  personal_magistrate_c: "原件与来源虽被保住，封仓、暂缓和隐去姓名仍被解释为连续抗令，县令承担了程序代价。"
});
export function playerFacingCopy(value) {
  return String(value ?? "")
    .replace(/\s*[（(]\s*(?:global|personal)_[a-z0-9_]+\s*[）)]/gi, "")
    .replace(/\b(?:state|asset|internal|global|personal)_[a-z0-9_]+\b/gi, (token) => {
    const normalized = token.toLowerCase();
    if (normalized.startsWith("state_")) return playerFacingStateLabels[normalized] || "后续局势";
    if (normalized.startsWith("asset_")) return "关键线索";
    if (normalized.startsWith("global_") || normalized.startsWith("personal_")) return playerFacingEndingLabels[normalized] || "本局结局";
    return "待核验信息";
    })
    .replace(/\s{2,}/g, " ")
    .trim();
}
export function resultCausalitySummary(value) {
  const publicKey = endingKey(value?.publicEnding?.content, "global");
  const personalKey = endingKey(value?.personalEnding?.content, "personal");
  const reasons = [playerFacingEndingReasons[publicKey], playerFacingEndingReasons[personalKey]].filter(Boolean);
  return reasons.join(" ") || "这个结局由七轮主决策、角色谋划、定向回应和跨角色影响共同形成，并非随机生成。";
}
function endingKey(value, prefix) { return String(value ?? "").match(new RegExp(`\\b${prefix}_[a-z0-9_]+\\b`, "i"))?.[0].toLowerCase() || ""; }
function esc(v) { return String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;"); }
