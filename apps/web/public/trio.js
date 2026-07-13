const DEFAULT_PLAYERS = [
  { key: "a", nickname: "玩家甲 · 证据派", roleIndex: 0 },
  { key: "b", nickname: "玩家乙 · 协商派", roleIndex: 1 },
  { key: "c", nickname: "玩家丙 · 风险派", roleIndex: 2 }
];
const DECISION_ORDER = [0, 1, 2, 0, 1, 2, 0];

export function createTrioApp({ root, window: browserWindow = globalThis.window, fetchImpl = browserWindow?.fetch?.bind(browserWindow) } = {}) {
  if (!root) throw new TypeError("createTrioApp requires root");
  if (typeof fetchImpl !== "function") throw new TypeError("createTrioApp requires fetch");
  const apiBase = resolveApiBase(browserWindow?.location);
  const query = new URLSearchParams(browserWindow?.location?.search || "");
  const storage = browserWindow?.localStorage;
  const players = DEFAULT_PLAYERS.map((player) => ({
    ...player,
    openid: storage?.getItem(`ai-story-room:trio:${player.key}`) || `web_trio_${player.key}_${Date.now()}`
  }));
  const state = { loading: false, busy: false, error: "", status: "", activePlayer: 0, run: null, roles: [], node: null, actions: [], notifications: [], resolution: null, round: 0, submitted: new Set() };

  async function request(path, playerIndex = 0, options = {}) {
    const player = players[playerIndex] || players[0];
    const response = await fetchImpl(`${apiBase}${path}`, {
      method: options.method || "GET",
      headers: { accept: "application/json", "content-type": "application/json", "x-mock-openid": player.openid, authorization: `Bearer ${player.openid}` },
      body: options.data === undefined ? undefined : JSON.stringify(options.data)
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload?.message || `HTTP ${response.status}`);
    return payload;
  }

  async function setupRun() {
    if (state.busy) return;
    state.busy = true; state.error = ""; state.status = "正在创建三人 AI 故事局……"; render();
    try {
      const templates = await request("/world-templates");
      const templateId = templates?.[0]?.id;
      if (!templateId) throw new Error("没有可用的故事模板，请先执行 db:seed");
      await Promise.all(players.map((player, index) => request("/auth/wechat-login", index, { method: "POST", data: { openid: player.openid, nickname: player.nickname } })));
      const run = await request("/story-runs", 0, { method: "POST", data: { templateId, mode: "ai-trio", maxPlayers: 3, aiPlayerCount: 0, tone: "悬疑协作", ownerAsPlayer: true } });
      for (const index of [1, 2]) await request(`/story-runs/${encodeURIComponent(run.id)}/join`, index, { method: "POST" });
      const roles = await request(`/story-runs/${encodeURIComponent(run.id)}/roles`);
      if (roles.length < 3) throw new Error("故事局没有返回三个可用角色");
      for (let index = 0; index < 3; index += 1) await request(`/story-runs/${encodeURIComponent(run.id)}/roles/${encodeURIComponent(roles[index].id)}/claim`, index, { method: "POST" });
      storage?.setItem("ai-story-room:trio:run-id", run.id);
      state.run = run; state.roles = roles; state.round = 0; state.status = "三位玩家已就位，可以逐人提交行动。";
      await refresh();
    } catch (error) { state.error = error instanceof Error ? error.message : String(error); }
    finally { state.busy = false; render(); }
  }

  async function resumeRun() {
    const runId = storage?.getItem("ai-story-room:trio:run-id");
    if (!runId) return setupRun();
    state.busy = true; state.error = ""; state.status = "正在恢复三人故事局……"; render();
    try {
      state.run = await request(`/story-runs/${encodeURIComponent(runId)}`);
      state.roles = await request(`/story-runs/${encodeURIComponent(runId)}/roles`);
      await refresh();
    } catch (error) { state.error = error instanceof Error ? error.message : String(error); }
    finally { state.busy = false; render(); }
  }

  async function refresh() {
    if (!state.run?.id) return;
    const view = await request(`/story-runs/${encodeURIComponent(state.run.id)}/state`, state.activePlayer);
    state.run = view.run; state.node = view.currentNode; state.resolution = view.currentNode?.resolution || null;
    state.round = Number(view.currentNode?.nodeIndex || state.run.completedNodeCount || 0);
    state.actions = state.node?.id ? await request(`/nodes/${encodeURIComponent(state.node.id)}/actions`, state.activePlayer) : [];
    state.submitted = new Set(state.actions.filter((item) => item.status === "accepted").map((item) => item.roleId));
    state.notifications = await request("/notifications", state.activePlayer);
    render();
  }

  async function submitAction(playerIndex = state.activePlayer, actionType = "observe", internal = false, freeText = "") {
    if (!state.node?.id || (state.busy && !internal)) return;
    const role = state.roles[playerIndex];
    if (!role) return;
    if (!internal) state.busy = true;
    state.error = ""; state.status = `${players[playerIndex].nickname} 正在提交第 ${state.round} 轮行动……`; render();
    try {
      await request(`/nodes/${encodeURIComponent(state.node.id)}/actions`, playerIndex, { method: "POST", data: { runId: state.run.id, roleId: role.id, actionType, targetText: state.node.title, method: freeText.trim() || (actionType === "investigate" ? `${role.roleName} 核对本轮关键线索，并把证据公开给其他玩家。` : `${role.roleName} 观察本轮局势，补充可验证事实。`), intent: actionType === "investigate" ? `第 ${state.round} 轮由${role.roleName}承担主决策。` : "不替其他玩家决定结果，只共享公开观察。", freeText: freeText.trim() || undefined, riskLevel: actionType === "investigate" ? "risky" : "safe" } });
      state.status = `${players[playerIndex].nickname} 的公开决策已写入，其他玩家可见。`;
      await refresh();
    } catch (error) { state.error = error instanceof Error ? error.message : String(error); }
    finally { if (!internal) state.busy = false; render(); }
  }

  async function resolveRound(internal = false) {
    if (!state.node?.id || state.submitted.size < 3 || (state.busy && !internal)) return;
    if (!internal) state.busy = true;
    state.error = ""; state.status = `第 ${state.round} 轮三方行动已齐，DeepSeek 正在推演……`; render();
    try { state.resolution = await request(`/nodes/${encodeURIComponent(state.node.id)}/resolve`, 0, { method: "POST" }); state.status = `第 ${state.round} 轮已完成，已生成三方回响和跨玩家影响。`; await refresh(); }
    catch (error) { state.error = error instanceof Error ? error.message : String(error); }
    finally { if (!internal) state.busy = false; render(); }
  }

  async function autoRound() {
    if (!state.node?.id || state.busy) return;
    state.busy = true; state.error = ""; render();
    try {
      const actor = DECISION_ORDER[Math.max(0, state.round - 1)] ?? 0;
      for (let index = 0; index < 3; index += 1) if (!state.submitted.has(state.roles[index]?.id)) await submitAction(index, index === actor ? "investigate" : "observe", true);
      await resolveRound(true);
    } catch (error) { state.error = error instanceof Error ? error.message : String(error); state.busy = false; render(); }
  }

  async function autoSevenRounds() {
    if (state.busy) return;
    state.busy = true; state.error = ""; state.status = "开始七轮三玩家自动推演……"; render();
    try {
      for (let round = 1; round <= 7; round += 1) {
        await refresh();
        const actor = DECISION_ORDER[round - 1];
        for (let index = 0; index < 3; index += 1) if (!state.submitted.has(state.roles[index]?.id)) await submitAction(index, index === actor ? "investigate" : "observe", true);
        await resolveRound(true);
      }
      state.status = "七轮推演完成，章节已生成。";
    } catch (error) { state.error = error instanceof Error ? error.message : String(error); }
    finally { state.busy = false; await refresh().catch(() => undefined); render(); }
  }

  function selectPlayer(index) { state.activePlayer = index; refresh().catch((error) => { state.error = String(error); render(); }); }
  function render() { root.innerHTML = state.run ? renderRun() : renderBoot(); bind(); }
  function renderBoot() { return `<section class="boot"><h1>三人 AI 剧情推演</h1><p>使用真实 API、PostgreSQL 和 DeepSeek，让三位玩家逐轮共享决策并共同改变剧情。</p>${state.error ? `<div class="status error">${esc(state.error)}</div>` : ""}<button class="button" data-action="setup" ${state.busy ? "disabled" : ""}>${state.busy ? "正在准备……" : "创建三人故事局"}</button><a class="button secondary" href="/">返回故事大厅</a></section>`; }
  function renderRun() {
    const role = state.roles[state.activePlayer];
    const accepted = state.submitted.size;
    return `<div class="trio-shell" data-testid="trio-shell"><header class="trio-topbar"><div><h1>三人 AI 剧情推演</h1><p>${esc(state.run.title || "ai-trio")} · ${esc(state.run.status)} · 第 ${state.round || 1} 轮</p></div><div class="top-actions"><button class="button secondary" data-action="refresh" ${state.busy ? "disabled" : ""}>刷新局势</button><button class="button" data-action="auto-seven" ${state.busy ? "disabled" : ""}>自动推演七轮</button></div></header><div class="trio-grid"><aside class="panel"><h2>三位玩家</h2><div class="player-list">${players.map((player, index) => `<button class="player-tab ${index === state.activePlayer ? "active" : ""}" data-player="${index}"><strong>${esc(player.nickname)}</strong><small>${esc(state.roles[index]?.roleName || "待认领")}${state.submitted.has(state.roles[index]?.id) ? " · 已提交" : " · 待行动"}</small></button>`).join("")}</div><div class="role-summary"><b>当前身份</b><p>${esc(role?.identity || role?.roleName || "尚未认领")}</p><b>公开目标</b><p>${esc(role?.publicGoal || "共享线索并承担本轮决策")}</p></div></aside><main class="center"><section class="paper"><span class="round-badge" data-testid="trio-round">第 ${state.round || 1} 轮 · 已提交 ${accepted}/3</span><h2>${esc(state.node?.title || "等待当前节点")}</h2><div class="node-card"><h3>${esc(state.node?.nodeGoal || "三位玩家共同观察局势")}</h3><p>${esc(state.node?.publicNarration || state.node?.description || "请先让三位玩家分别提交行动。")}</p></div>${renderActionForm(role, accepted)}${state.resolution ? `<div class="resolution-card" data-testid="trio-resolution"><h3>本轮 AI 回响</h3><p>${esc(state.resolution.summary || state.resolution.publicNarration || "三方行动已进入剧情账本。")}</p><p>跨玩家影响：${esc(JSON.stringify(state.resolution.crossImpactsJson || state.resolution.statePatchJson?.crossImpactsJson || []))}</p></div>` : ""}</section></main><aside class="panel right-panel"><h2>其他玩家通知</h2><div class="notification-list" data-testid="trio-notifications">${renderNotifications()}</div><h2>局面</h2><div class="metric"><span>已完成节点</span><strong>${Number(state.run.completedNodeCount || 0)}/7</strong></div><div class="metric"><span>当前玩家</span><strong>${esc(players[state.activePlayer].nickname)}</strong></div><div class="metric"><span>本轮行动</span><strong>${accepted}/3</strong></div>${state.error ? `<div class="status error">${esc(state.error)}</div>` : state.status ? `<div class="status">${esc(state.status)}</div>` : ""}</aside></div></div>`;
  }
  function renderActionForm(role, accepted) { const already = state.submitted.has(role?.id); return `<section class="action-form"><label for="trioActionType">${esc(players[state.activePlayer].nickname)} 的行动类型</label><select id="trioActionType" ${already || state.busy ? "disabled" : ""}><option value="observe">观察并共享事实</option><option value="investigate">主决策：调查关键线索</option></select><label for="trioActionText">公开决策说明</label><textarea id="trioActionText" maxlength="500" ${already || state.busy ? "disabled" : ""}>${already ? "本轮已经提交，其他玩家已收到通知。" : ""}</textarea><div class="action-actions"><span class="hint">提交后会写入数据库，并通知另外两名玩家。</span><button class="button" data-action="submit" ${already || state.busy ? "disabled" : ""}>${already ? "已提交" : "提交行动"}</button></div><div class="action-actions"><span class="hint">三位玩家都提交后才能调用 AI 结算。</span><button class="button secondary" data-action="resolve" ${accepted !== 3 || state.busy ? "disabled" : ""}>结算本轮</button><button class="button secondary" data-action="auto-round" ${state.busy ? "disabled" : ""}>自动完成本轮</button></div></section>`; }
  function renderNotifications() { const items = state.notifications.filter((item) => item.type === "player_decision_shared").slice(-12).reverse(); return items.length ? items.map((item) => `<article class="notification"><b>${esc(item.title || "其他玩家决策")}</b><span>${esc(item.body || item.message || JSON.stringify(item.payload || item.content || ""))}</span></article>`).join("") : `<p class="empty">还没有收到其他玩家的公开决策。</p>`; }
  function bind() { root.querySelectorAll("[data-player]").forEach((button) => button.addEventListener("click", () => selectPlayer(Number(button.dataset.player)))); root.querySelector('[data-action="setup"]')?.addEventListener("click", setupRun); root.querySelector('[data-action="refresh"]')?.addEventListener("click", () => refresh().catch((error) => { state.error = String(error); render(); })); root.querySelector('[data-action="submit"]')?.addEventListener("click", () => submitAction(state.activePlayer, root.querySelector("#trioActionType")?.value || "observe", false, root.querySelector("#trioActionText")?.value || "")); root.querySelector('[data-action="resolve"]')?.addEventListener("click", resolveRound); root.querySelector('[data-action="auto-round"]')?.addEventListener("click", autoRound); root.querySelector('[data-action="auto-seven"]')?.addEventListener("click", autoSevenRounds); }
  return { resumeRun, setupRun, refresh, submitAction, resolveRound, autoRound, autoSevenRounds, selectPlayer, getState: () => state, render };
}

function resolveApiBase(location) { try { const value = new URL(location?.href || "http://localhost/").searchParams.get("apiBase"); if (value) return value.replace(/\/+$/, ""); } catch {} return location?.port === "5177" ? `${location.protocol}//${location.hostname}:3001/api` : "/api"; }
function esc(value) { return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;"); }

if (typeof window !== "undefined" && typeof document !== "undefined" && !window.__AI_STORY_DISABLE_AUTO_BOOT__) { const root = document.getElementById("trioApp"); if (root) createTrioApp({ root, window }).resumeRun(); }
