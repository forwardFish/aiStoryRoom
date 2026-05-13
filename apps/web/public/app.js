const players = [
  { openid: "mock_openid_owner_001", nickname: "房主 / 林鹿玩家", roleKey: "lin_lu" },
  { openid: "mock_openid_chen_zhou", nickname: "陈舟玩家", roleKey: "chen_zhou" },
  { openid: "mock_openid_gu_yan", nickname: "顾言玩家", roleKey: "gu_yan" }
];

const state = {
  apiBase: localStorage.getItem("ai-story-api-base") || "http://localhost:3001/api",
  activePlayer: players[0],
  tokens: JSON.parse(localStorage.getItem("ai-story-tokens") || "{}"),
  run: null,
  runState: null,
  roles: [],
  myRole: null,
  actions: [],
  resolution: null,
  chapter: null,
  lastResponse: null,
  lastError: null
};

const $ = (id) => document.getElementById(id);

function save() {
  localStorage.setItem("ai-story-api-base", state.apiBase);
  localStorage.setItem("ai-story-tokens", JSON.stringify(state.tokens));
}

function token() {
  return state.tokens[state.activePlayer.openid] || state.activePlayer.openid;
}

async function api(path, options = {}) {
  const response = await fetch(`${state.apiBase}${path}`, {
    method: options.method || "GET",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${options.token || token()}`
    },
    body: options.data ? JSON.stringify(options.data) : undefined
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  state.lastResponse = { path, status: response.status, data };
  state.lastError = response.ok ? null : data;
  if (!response.ok) throw new Error(data?.message || `${response.status} ${path}`);
  return data;
}

function init() {
  $("apiBase").value = state.apiBase;
  $("playerSelect").innerHTML = players.map((player) => `<option value="${player.openid}">${player.nickname}</option>`).join("");
  $("playerSelect").addEventListener("change", async (event) => {
    state.activePlayer = players.find((player) => player.openid === event.target.value) || players[0];
    await refreshMyRole();
    render();
  });
  $("saveApi").addEventListener("click", () => {
    state.apiBase = $("apiBase").value.trim() || state.apiBase;
    save();
    render();
  });
  $("loginBtn").addEventListener("click", loginActive);
  $("resetBtn").addEventListener("click", () => {
    localStorage.removeItem("ai-story-tokens");
    Object.assign(state, { tokens: {}, run: null, runState: null, roles: [], myRole: null, actions: [], resolution: null, chapter: null, lastResponse: null, lastError: null });
    render();
  });
  render();
  loadTemplates().catch(showError);
}

async function loginActive() {
  const result = await api("/auth/wechat-login", {
    method: "POST",
    data: { mockOpenid: state.activePlayer.openid, nickname: state.activePlayer.nickname }
  });
  state.tokens[state.activePlayer.openid] = result.token;
  save();
  render();
}

async function loadTemplates() {
  const templates = await api("/world-templates");
  $("templatesPanel").innerHTML = `
    <h2>1. 选择世界模板</h2>
    <p class="muted">Web 验证舱默认使用 preview-api；也可切到真实 API。</p>
    <div class="cards">
      ${templates.map((template) => `
        <article class="card">
          <h3>${template.name}</h3>
          <p>${template.hook}</p>
          <div class="chips">${chip(template.genre)}${chip(template.recommendedPlayers || template.configJson?.recommendedPlayers || "推荐 1-3 人")}</div>
          <button data-create="${template.id}">创建故事局</button>
        </article>
      `).join("")}
    </div>
  `;
  $("templatesPanel").querySelectorAll("[data-create]").forEach((button) => {
    button.addEventListener("click", () => createRun(button.dataset.create));
  });
}

async function createRun(templateId) {
  await ensureLogins();
  state.run = await api("/story-runs", {
    method: "POST",
    token: state.tokens[players[0].openid],
    data: { templateId, mode: "invite", maxPlayers: 3, aiPlayerCount: 0, tone: "悬疑", ownerAsPlayer: true }
  });
  await loadRunBundle();
}

async function ensureLogins() {
  for (const player of players) {
    if (!state.tokens[player.openid]) {
      const result = await api("/auth/wechat-login", { method: "POST", token: player.openid, data: { mockOpenid: player.openid, nickname: player.nickname } });
      state.tokens[player.openid] = result.token;
    }
  }
  save();
}

async function loadRunBundle() {
  if (!state.run?.id) return;
  state.run = await api(`/story-runs/${state.run.id}`);
  state.roles = await api(`/story-runs/${state.run.id}/roles`);
  state.runState = await api(`/story-runs/${state.run.id}/state`);
  await refreshMyRole();
  await refreshNodeExtras();
  render();
}

async function refreshMyRole() {
  if (!state.run?.id) return;
  state.myRole = await api(`/story-runs/${state.run.id}/my-role`).catch(() => null);
}

async function refreshNodeExtras() {
  const nodeId = state.runState?.currentNode?.id;
  if (!nodeId) return;
  state.actions = await api(`/nodes/${nodeId}/actions`).catch(() => []);
  state.resolution = await api(`/nodes/${nodeId}/resolution`).catch(() => null);
}

async function simulatePlayers() {
  await ensureLogins();
  for (const player of players.slice(1)) {
    await api(`/story-runs/${state.run.id}/join`, { method: "POST", token: state.tokens[player.openid] }).catch(() => undefined);
  }
  const roles = await api(`/story-runs/${state.run.id}/roles`, { token: state.tokens[players[0].openid] });
  for (const player of players) {
    const role = roles.find((item) => item.roleKey === player.roleKey);
    if (role) {
      await api(`/story-runs/${state.run.id}/roles/${role.id}/claim`, { method: "POST", token: state.tokens[player.openid] }).catch(() => undefined);
    }
  }
  await loadRunBundle();
}

async function submitAction(overreach = false) {
  const node = state.runState?.currentNode;
  const role = state.myRole?.role;
  if (!node || !role) return showError(new Error("请先选择命运线/角色。"));
  const method = overreach ? "我操控所有人都承认真相并立刻通关" : ($("method")?.value || `${role.roleName}查看监控回放，只描述尝试过程。`);
  const intent = overreach ? "我成功揭开全部真相" : ($("intent")?.value || `帮助团队理解「${node.title}」背后的异常，不直接宣布结果。`);
  const result = await api(`/nodes/${node.id}/actions`, {
    method: "POST",
    data: { runId: state.run.id, roleId: role.id, actionType: "investigate", targetText: node.title, method, intent, riskLevel: "normal", freeText: "" }
  });
  if (result.status === "rejected") {
    state.lastError = result;
  }
  await loadRunBundle();
}

async function submitAllRoleActions() {
  const node = state.runState?.currentNode;
  if (!node) return;
  await ensureLogins();
  for (const player of players) {
    const roles = await api(`/story-runs/${state.run.id}/roles`, { token: state.tokens[player.openid] });
    const role = roles.find((item) => item.roleKey === player.roleKey);
    if (!role) continue;
    await api(`/nodes/${node.id}/actions`, {
      method: "POST",
      token: state.tokens[player.openid],
      data: {
        runId: state.run.id,
        roleId: role.id,
        actionType: player.roleKey === "lin_lu" ? "investigate" : "observe",
        targetText: node.title,
        method: `${role.roleName}围绕「${node.title}」采取行动，只描述尝试过程。`,
        intent: `推进本节点目标，但不直接宣布结果。`,
        riskLevel: node.nodeIndex >= 4 ? "risky" : "normal",
        freeText: ""
      }
    }).catch(() => undefined);
  }
  await loadRunBundle();
}

async function resolveNode() {
  const node = state.runState?.currentNode;
  if (!node) return;
  $("resolutionPanel").classList.add("loading");
  state.resolution = await api(`/nodes/${node.id}/resolve`, { method: "POST" });
  await loadRunBundle();
}

async function resolveFullChapter() {
  for (let i = 0; i < 5; i += 1) {
    await loadRunBundle();
    if (state.runState?.chapters?.[0]) break;
    await submitAllRoleActions();
    await resolveNode();
  }
  await loadChapter();
}

async function loadChapter() {
  await loadRunBundle();
  const chapterId = state.runState?.chapters?.[0]?.id;
  if (!chapterId) {
    state.chapter = await api(`/story-runs/${state.run.id}/generate-chapter`, { method: "POST" }).catch((error) => {
      state.lastError = { message: error.message, type: "chapter_generation_failed" };
      return null;
    });
  } else {
    state.chapter = await api(`/chapters/${chapterId}`);
  }
  render();
}

function render() {
  renderSession();
  renderRun();
  renderRoles();
  renderRoom();
  renderAction();
  renderResolution();
  renderChapter();
  renderDebug();
  renderChecklist();
}

function renderSession() {
  $("sessionInfo").innerHTML = `
    <p>当前玩家：<strong>${state.activePlayer.nickname}</strong></p>
    <p>Token：<code>${token()}</code></p>
    <p>当前故事局：${state.run ? `${state.run.title} / ${state.run.inviteCode || ""}` : "未创建"}</p>
  `;
}

function renderRun() {
  $("runPanel").innerHTML = `
    <h2>2. 故事局 / 大厅</h2>
    ${state.run ? `
      <div class="card">
        <h3>${state.run.title}</h3>
        <p>${state.run.hook}</p>
        <div class="chips">${chip(`邀请码 ${state.run.inviteCode || "-"}`)}${chip(state.run.status)}${chip(`危险 ${state.run.dangerLevel || state.runState?.run?.dangerLevel || 1}/5`)}</div>
      </div>
      <button id="simulateBtn">一键模拟 3 玩家加入并选择命运线</button>
    ` : `<p class="muted">请先在模板区创建故事局。</p>`}
  `;
  $("simulateBtn")?.addEventListener("click", simulatePlayers);
}

function renderRoles() {
  $("rolesPanel").innerHTML = `
    <h2>3. 选择你的命运线 / 角色卡</h2>
    <div class="cards">
      ${(state.roles || []).map((role) => `
        <article class="card">
          <h3>${role.roleName}｜${role.identity}</h3>
          <p><strong>命运钩子：</strong>${role.personalHook || role.publicInfo}</p>
          <p><strong>命运问题：</strong>${role.destinyQuestion || "你的选择会把故事带向哪里？"}</p>
          <p><strong>个人目标：</strong>${role.personalGoal}</p>
          <p><strong>私密线索：</strong>${(role.privateClues || role.knownInfoJson || []).join("；")}</p>
          <div class="chips">${chip(role.status)}${chip(role.roleKey)}</div>
          <button data-claim="${role.id}">用当前玩家认领</button>
        </article>
      `).join("") || `<p class="muted">创建故事局后加载角色。</p>`}
    </div>
  `;
  $("rolesPanel").querySelectorAll("[data-claim]").forEach((button) => {
    button.addEventListener("click", async () => {
      await api(`/story-runs/${state.run.id}/roles/${button.dataset.claim}/claim`, { method: "POST" });
      await loadRunBundle();
    });
  });
}

function renderRoom() {
  const node = state.runState?.currentNode;
  const role = state.myRole?.role;
  $("roomPanel").innerHTML = `
    <h2>4. 房间当前节点</h2>
    ${node ? `
      <div class="card">
        <h3>${node.title}</h3>
        <p>${node.publicNarration}</p>
        <p><strong>当前目标：</strong>${node.nodeGoal}</p>
        <div class="chips">${chip(`节点 ${node.nodeIndex || "?"}`)}${chip(node.status)}${chip(`行动 ${state.actions.length}/3`)}</div>
      </div>
      <div class="card">
        <h3>我的命运线：${role?.roleName || "未选择"}</h3>
        <p><strong>命运问题：</strong>${role?.destinyQuestion || "请先选择角色"}</p>
        <p><strong>私密线索：</strong>${(role?.privateClues || []).join("；") || "暂无"}</p>
        <p><strong>我的影响：</strong>${impactSummary()}</p>
      </div>
      <div class="card">
        <h3>公开线索 / 关系</h3>
        ${(state.runState?.clues || []).map((clue) => `<span class="chip">${clue.title}</span>`).join("")}
        ${(state.runState?.relations || []).map((rel) => `<p class="muted">${rel.publicNote || rel.note}</p>`).join("")}
      </div>
    ` : `<p class="muted">创建故事局后显示当前节点。</p>`}
  `;
}

function renderAction() {
  const role = state.myRole?.role;
  $("actionPanel").innerHTML = `
    <h2>5. 提交行动</h2>
    <p class="muted">你不用写小说，只要说明你的角色想做什么。</p>
    ${state.lastError?.guardStatus === "blocked" ? `<div class="card"><h3 class="danger-text">ActionGuard 已拦截</h3><p>${state.lastError.message}</p></div>` : ""}
    <div class="row">
      <textarea id="method" placeholder="行动方式">${role ? `${role.roleName}查看监控回放，只描述尝试过程。` : ""}</textarea>
      <textarea id="intent" placeholder="行动目的">帮助团队理解异常，不直接宣布结果。</textarea>
    </div>
    <div class="row">
      <button id="submitActionBtn">提交当前玩家行动</button>
      <button id="invalidActionBtn" class="danger">触发 ActionGuard</button>
      <button id="submitAllBtn" class="ghost">一键补齐 3 人行动</button>
    </div>
  `;
  $("submitActionBtn")?.addEventListener("click", () => submitAction(false).catch(showError));
  $("invalidActionBtn")?.addEventListener("click", () => submitAction(true).catch(showError));
  $("submitAllBtn")?.addEventListener("click", () => submitAllRoleActions().catch(showError));
}

function renderResolution() {
  const resolution = state.resolution || state.runState?.currentNode?.resolution;
  $("resolutionPanel").innerHTML = `
    <h2>6. AI 结算 / 节点结果</h2>
    <div class="row">
      <button id="resolveBtn">触发 AI 结算</button>
      <button id="fullChapterBtn" class="ghost">一键跑完 5 节点并生成章节</button>
    </div>
    ${state.lastError?.type === "ai_failed" ? `<div class="card"><h3 class="danger-text">AI 结算失败</h3><p>${state.lastError.message}</p></div>` : ""}
    ${resolution ? `
      <div class="card">
        <h3>本节点发生了什么</h3>
        <p>${resolution.summary}</p>
        <p><strong>下一节点钩子：</strong>${resolution.nextNodeHook || "本章已收束"}</p>
        <div class="chips">${chip(`危险 ${resolution.dangerBefore || "?"} → ${resolution.dangerAfter || "?"}`)}</div>
      </div>
      ${renderEchoes(resolution.echoesJson)}
      ${renderImpacts(resolution.crossImpactsJson)}
      ${renderChanges(resolution)}
    ` : `<p class="muted">提交行动后可触发结算。结算中/失败重试在本面板内展示。</p>`}
  `;
  $("resolveBtn")?.addEventListener("click", () => resolveNode().catch((error) => {
    state.lastError = { type: "ai_failed", message: error.message };
    render();
  }));
  $("fullChapterBtn")?.addEventListener("click", () => resolveFullChapter().catch(showError));
}

function renderChapter() {
  const chapter = state.chapter || state.runState?.chapters?.[0];
  $("chapterPanel").innerHTML = `
    <h2>7. 多 POV 章节 / 分享</h2>
    <button id="loadChapterBtn">生成 / 读取章节</button>
    ${state.lastError?.type === "chapter_generation_failed" ? `<div class="card"><h3 class="danger-text">章节生成失败</h3><p>${state.lastError.message}</p></div>` : ""}
    ${chapter ? `
      <div class="card"><h3>${chapter.title}</h3><p>${(chapter.content || "").slice(0, 420)}</p><p><strong>下一章预告：</strong>${chapter.nextHook || ""}</p></div>
      <h3>多 POV 正文</h3>
      <div class="cards">${(chapter.povSectionsJson || []).map((pov) => `<article class="card"><h4>${pov.title}</h4><p>${pov.content}</p></article>`).join("")}</div>
      <h3>个人故事卡</h3>
      <div class="cards">${(chapter.personalCardsJson || []).map((card) => `<article class="card"><h4>${card.title}</h4><p>${card.hook}</p><p>${card.highlight}</p><p class="muted">${card.unresolvedQuestion}</p></article>`).join("")}</div>
    ` : `<p class="muted">跑完 5 个节点后可生成章节。</p>`}
  `;
  $("loadChapterBtn")?.addEventListener("click", () => loadChapter().catch(showError));
}

function renderDebug() {
  $("debugPanel").innerHTML = `
    <h2>8. Debug Contract</h2>
    <p class="muted">用于对比 preview-api 与真实 API，防止 Web 与小程序分叉。</p>
    <pre>${escapeHtml(JSON.stringify({
      activePlayer: state.activePlayer,
      run: state.run,
      myRole: state.myRole,
      currentNode: state.runState?.currentNode,
      actions: state.actions,
      resolution: state.resolution,
      chapter: state.chapter,
      lastResponse: state.lastResponse,
      lastError: state.lastError
    }, null, 2))}</pre>
  `;
}

function renderEchoes(echoes = []) {
  if (!echoes.length) return `<div class="card"><h3>三个回响</h3><p class="danger-text">当前 API 未返回 echoesJson。</p></div>`;
  return `<div class="cards">${echoes.map((echo) => `
    <article class="card">
      <h3>三个回响｜${echo.roleName || "角色"}</h3>
      <p><strong>个人回响：</strong>${echo.personalEcho}</p>
      <p><strong>他人回响：</strong>${echo.otherEcho}</p>
      <p><strong>世界回响：</strong>${echo.worldEcho}</p>
    </article>
  `).join("")}</div>`;
}

function renderImpacts(impacts = []) {
  if (!impacts.length) return `<div class="card"><h3>跨角色影响</h3><p class="danger-text">当前 API 未返回 crossImpactsJson。</p></div>`;
  return `<div class="cards">${impacts.map((impact) => `
    <article class="card">
      <h3>${impact.title}</h3>
      <p>${impact.description}</p>
      <div class="chips">${chip(impact.impactType)}${chip(impact.visibility)}</div>
    </article>
  `).join("")}</div>`;
}

function renderChanges(resolution) {
  return `
    <div class="card">
      <h3>线索 / 关系变化</h3>
      ${(resolution.clueChangesJson || []).map((clue) => `<p><strong>${clue.title}</strong>：${clue.description}</p>`).join("")}
      ${(resolution.relationChangesJson || []).map((rel) => `<p>${rel.publicNote || rel.note || rel.relationType}</p>`).join("")}
    </div>
  `;
}

function renderChecklist() {
  const checks = [
    ["模板已加载", Boolean($("templatesPanel").textContent.includes("创建故事局"))],
    ["故事局已创建", Boolean(state.run?.id)],
    ["命运线字段可见", Boolean((state.roles || []).some((role) => role.personalHook && role.destinyQuestion))],
    ["当前房间可见", Boolean(state.runState?.currentNode)],
    ["行动已提交或可提交", Boolean(state.actions.length || state.myRole?.role)],
    ["ActionGuard 可触发", true],
    ["AI 结算结果可见", Boolean(state.resolution?.summary || state.runState?.currentNode?.resolution)],
    ["章节/个人故事卡可见", Boolean((state.chapter || state.runState?.chapters?.[0])?.personalCardsJson)]
  ];
  $("checklist").innerHTML = checks.map(([label, ok]) => `<li class="${ok ? "done" : ""}">${ok ? "✓" : "○"} ${label}</li>`).join("");
}

function impactSummary() {
  const impacts = state.resolution?.crossImpactsJson || state.runState?.currentNode?.resolution?.crossImpactsJson || [];
  return impacts[0]?.title || "本节点结算后会展示你影响了谁、谁影响了你。";
}

function showError(error) {
  state.lastError = { message: error.message || String(error) };
  render();
}

function chip(value) {
  return `<span class="chip">${escapeHtml(String(value || ""))}</span>`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

init();
