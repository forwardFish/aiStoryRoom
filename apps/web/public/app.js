const CABIN_TITLE = "AI故事局测试台";

const players = [
  { openid: "mock_openid_web_owner", nickname: "夜班店员", code: "A" },
  { openid: "mock_openid_web_player_b", nickname: "外卖骑手", code: "B" },
  { openid: "mock_openid_web_player_c", nickname: "实习记者", code: "C" }
];

const templateCopy = {
  template_midnight_store_001: {
    name: "午夜便利店",
    genre: "都市悬疑",
    hook: "深夜的便利店，2:17 的秘密",
    worldBase: "雨夜、监控盲区、旧硬币和没有影子的客人共同构成第一章沙盘。",
    art: "linear-gradient(145deg, rgba(25, 55, 78, 0.2), rgba(6, 12, 18, 0.35)), url('/ui/2/04_world_template_select.png')",
    status: "使用中",
    nodes: [
      {
        title: "发现硬币",
        publicNarration: "夜色笼罩着这座城市，雨点敲打着便利店的玻璃窗。你（夜班店员）整理着货架，收银机里传来一声轻响。你低头看去，发现了一枚从未见过的旧硬币，硬币上刻着奇怪的符号。就在这时，门上的风铃突然无风自动，发出清脆的声响……",
        nodeGoal: "探索便利店内发生的异常，找出硬币的来源。",
        destinyQuestion: "你到底是被困者，还是下一任守夜人？",
        clues: ["便利店在 2:17 会发生异常", "有人在暗中监视这家便利店"]
      },
      {
        title: "仓库敲击",
        publicNarration: "便利店深处响起沉闷的敲门声，仓库门缝下慢慢渗出一线水光。",
        nodeGoal: "判断仓库内是否有人，以及水迹从何而来。",
        destinyQuestion: "那扇门后回应你们的，究竟是谁？",
        clues: ["门缝下没有影子", "水迹中浮着明天凌晨的小票"]
      },
      {
        title: "0 元小票",
        publicNarration: "收银机没有被触碰，却自己吐出热乎乎的小票。屏幕上的商品名全是空白。",
        nodeGoal: "查明小票来源，并确认“第五个人”指向谁。",
        destinyQuestion: "订单是在召唤人，还是在替换人？",
        clues: ["小票二维码指向店内货架画面", "画面里你们身后站着没有影子的人"]
      },
      {
        title: "冷柜里的第五张脸",
        publicNarration: "冷柜压缩机停止运转，玻璃蒙上白雾，一张陌生的脸从雾气里慢慢贴近。",
        nodeGoal: "弄清第五张脸想传达什么，同时保护自己的秘密不被异常利用。",
        destinyQuestion: "你愿意用哪条秘密换回线索？",
        clues: ["照片里出现反写文字", "不要让它借走你们的影子"]
      },
      {
        title: "第五道影子",
        publicNarration: "灯灭之后，所有声音都被雨吞掉。门外路灯下，多出来的影子正慢慢走向货架尽头。",
        nodeGoal: "决定如何面对第五道影子，并为本章收束真相。",
        destinyQuestion: "硬币真正用途到底是什么？",
        clues: ["第五个人留下下一站地址", "北辰 24 号"]
      }
    ]
  },
  template_qingyun_sect_001: {
    name: "青云宗门",
    genre: "东方玄幻",
    hook: "修仙世界的门派纷争",
    worldBase: "宗门试炼夜，祖师堂魂灯同时熄灭。",
    art: "linear-gradient(145deg, rgba(34, 72, 96, 0.28), rgba(6, 12, 18, 0.4)), url('/ui/2/04_world_template_select.png')",
    status: "使用"
  },
  template_wild_village_001: {
    name: "穿越荒村",
    genre: "生存悬疑",
    hook: "迷失在时间里的村庄",
    worldBase: "荒村、祠堂、断桥和无法离开的夜。",
    art: "linear-gradient(145deg, rgba(69, 72, 63, 0.28), rgba(6, 12, 18, 0.42)), url('/ui/2/04_world_template_select.png')",
    status: "使用"
  }
};

const roleCopy = {
  lin_lu: {
    code: "A",
    name: "夜班店员",
    title: "A - 夜班店员（你）",
    identity: "线索发现者 / 异常触发者",
    desc: "在便利店上夜班，发现了异常的硬币。",
    statusText: "已行动",
    avatar: "avatar-a",
    personalHook: "你在收银机里发现一枚不属于今晚账目的旧硬币。",
    destinyQuestion: "硬币的真正用途到底是什么？",
    privateClues: ["收银机里的旧硬币刻着符号", "昨晚梦里听到“不要让外卖员进来”"],
    cannotDo: ["不能直接宣布怪客身份", "不能独自离开整家便利店"]
  },
  chen_zhou: {
    code: "B",
    name: "外卖骑手",
    title: "B - 外卖骑手",
    identity: "订单携带者 / 路线目击者",
    desc: "接到一份诡异的订单，收货人是自己。",
    statusText: "未行动",
    avatar: "avatar-b",
    personalHook: "你接到一份没有平台记录的订单，收货人是自己。",
    destinyQuestion: "这份订单是让你送货，还是让你替别人留下？",
    privateClues: ["巷口路灯只照人不照影子", "订单地址在地图上不存在"],
    cannotDo: ["不能凭空知道店内秘密", "不能强迫其他角色交出物品"]
  },
  gu_yan: {
    code: "C",
    name: "实习记者",
    title: "C - 实习记者",
    identity: "线索记录者 / 民俗研究者",
    desc: "调查父亲当年的神秘失踪案。",
    statusText: "已行动",
    avatar: "avatar-c",
    personalHook: "你找到父亲十年前留下的旧新闻，照片里出现午夜便利店。",
    destinyQuestion: "你是在调查旧案，还是在重走亲人失踪前的路？",
    privateClues: ["没有影子的客人可能不是第一个", "旧相机能拍到肉眼忽略的痕迹"],
    cannotDo: ["不能直接封印异常", "不能替他人决定是否牺牲"]
  }
};

const fallbackRuns = [
  { title: "午夜便利店 - 测试局1", subtitle: "第1章 · 深夜的开始", status: "进行中", active: true },
  { title: "青云宗门 - 测试局", subtitle: "未开始", status: "草稿" },
  { title: "穿越荒村 - 测试局", subtitle: "第3章 · 迷雾散去", status: "已完成" }
];

const state = {
  apiBase: localStorage.getItem("ai-story-api-base") || "http://localhost:3001/api",
  activePlayer: players[0],
  activeRoleIndex: 0,
  activePovIndex: 0,
  selectedTemplateId: "template_midnight_store_001",
  tokens: JSON.parse(localStorage.getItem("ai-story-tokens") || "{}"),
  templates: [],
  run: null,
  runState: null,
  roles: [],
  myRole: null,
  actions: [],
  resolution: null,
  chapter: null,
  guardResult: null,
  lastResponse: null,
  lastError: null,
  apiLog: [],
  debugOpen: false,
  busy: false
};

const referenceView = {
  nodeIndex: 1,
  time: "22:17",
  danger: "12%（轻微）",
  chapter: "第1章 · 深夜的开始",
  actionMethod: "我决定戴上手套，仔细拿起那枚硬币，检查上面刻着的符号和文字，希望能找出它的来历。"
};

const root = document.getElementById("app");

const esc = (value) =>
  String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

function save() {
  localStorage.setItem("ai-story-api-base", state.apiBase);
  localStorage.setItem("ai-story-tokens", JSON.stringify(state.tokens));
}

function token(player = state.activePlayer) {
  return state.tokens[player.openid] || player.openid;
}

function currentTemplateCopy() {
  return templateCopy[state.run?.templateId || state.selectedTemplateId] || templateCopy.template_midnight_store_001;
}

function nodeCopy(index = currentNode()?.nodeIndex || 1) {
  const nodes = currentTemplateCopy().nodes || templateCopy.template_midnight_store_001.nodes;
  return nodes[Math.max(0, Math.min(nodes.length - 1, Number(index || 1) - 1))] || nodes[0];
}

function roleView(role, index) {
  const key = role?.roleKey;
  const copy = roleCopy[key] || {
    code: String.fromCharCode(65 + index),
    name: `角色 ${index + 1}`,
    title: `${String.fromCharCode(65 + index)} - 角色 ${index + 1}`,
    identity: role?.identity || "故事参与者",
    desc: "等待玩家认领并提交行动。",
    statusText: role?.status === "claimed" ? "已行动" : "未行动",
    avatar: `avatar-${String.fromCharCode(97 + index)}`,
    personalHook: role?.personalHook || "这条命运线会被本章选择改变。",
    destinyQuestion: role?.destinyQuestion || "你的选择会把故事带向哪里？",
    privateClues: Array.isArray(role?.privateClues) ? role.privateClues : [],
    cannotDo: Array.isArray(role?.cannotDo) ? role.cannotDo : []
  };
  const player = players[index] || players[0];
  const referenceStatus = index === 1 ? "未行动" : "已行动";
  return {
    ...copy,
    id: role?.id,
    player,
    raw: role,
    claimedByActive: role?.playerOpenid === player.openid,
    statusText: referenceStatus
  };
}

function roleViews() {
  const source = state.roles.length ? state.roles : [null, null, null];
  return source.slice(0, 3).map(roleView);
}

function currentNode() {
  return state.runState?.currentNode || null;
}

function visualNodeIndex() {
  return referenceView.nodeIndex;
}

function statusClass(status) {
  if (status === "已完成" || status === "已行动" || status === "已认领") return "green";
  if (status === "进行中" || status === "使用中") return "green";
  if (status === "未行动" || status === "草稿") return "yellow";
  if (status === "blocked" || status === "rewrite_needed") return "red";
  return "blue";
}

function badge(text, extra) {
  return `<span class="badge ${extra || statusClass(text)}">${esc(text)}</span>`;
}

function chip(label, value) {
  return `<span class="chip">${esc(label)}${value ? `：<strong>${esc(value)}</strong>` : ""}</span>`;
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function truncate(value, max = 90) {
  const text = String(value || "");
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function formatTime() {
  return new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false });
}

async function api(path, options = {}) {
  const response = await fetch(`${state.apiBase}${path}`, {
    method: options.method || "GET",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${options.token || token()}`,
      "x-mock-openid": options.openid || state.activePlayer.openid
    },
    body: options.data ? JSON.stringify(options.data) : undefined
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  const entry = { at: new Date().toISOString(), path, method: options.method || "GET", status: response.status, ok: response.ok, data };
  state.lastResponse = entry;
  state.apiLog.unshift(entry);
  state.apiLog = state.apiLog.slice(0, 30);
  state.lastError = response.ok ? null : data;
  if (!response.ok) throw new Error(data?.message || `${response.status} ${path}`);
  return data;
}

async function withBusy(work) {
  state.busy = true;
  render();
  try {
    return await work();
  } catch (error) {
    showError(error);
    throw error;
  } finally {
    state.busy = false;
    render();
  }
}

async function loginActive() {
  const result = await api("/auth/wechat-login", {
    method: "POST",
    openid: state.activePlayer.openid,
    data: { mockOpenid: state.activePlayer.openid, nickname: state.activePlayer.nickname }
  });
  state.tokens[state.activePlayer.openid] = result.token;
  save();
  render();
  return result;
}

async function ensureLogins() {
  for (const player of players) {
    if (!state.tokens[player.openid]) {
      const result = await api("/auth/wechat-login", {
        method: "POST",
        token: player.openid,
        openid: player.openid,
        data: { mockOpenid: player.openid, nickname: player.nickname }
      });
      state.tokens[player.openid] = result.token;
    }
  }
  save();
}

async function loadTemplates() {
  state.templates = await api("/world-templates");
  if (!state.templates.some((template) => template.id === state.selectedTemplateId)) {
    state.selectedTemplateId = state.templates[0]?.id || "template_midnight_store_001";
  }
  render();
}

async function createRun(templateId = state.selectedTemplateId) {
  await ensureLogins();
  state.selectedTemplateId = templateId || state.templates[0]?.id || "template_midnight_store_001";
  state.run = await api("/story-runs", {
    method: "POST",
    token: state.tokens[players[0].openid],
    openid: players[0].openid,
    data: { templateId: state.selectedTemplateId, mode: "invite", maxPlayers: 3, aiPlayerCount: 0, tone: "suspense", ownerAsPlayer: true }
  });
  state.guardResult = null;
  state.resolution = null;
  state.chapter = null;
  state.activeRoleIndex = 0;
  state.activePlayer = players[0];
  await loadRunBundle();
}

async function loadRunBundle() {
  if (!state.run?.id) return;
  state.run = await api(`/story-runs/${state.run.id}`);
  state.roles = await api(`/story-runs/${state.run.id}/roles`);
  state.runState = await api(`/story-runs/${state.run.id}/state`);
  await refreshMyRole();
  await refreshNodeExtras();
  const chapter = state.runState?.chapters?.[0];
  if (chapter?.id) state.chapter = await api(`/chapters/${chapter.id}`).catch(() => chapter);
  render();
}

async function refreshMyRole() {
  if (!state.run?.id) return;
  state.myRole = await api(`/story-runs/${state.run.id}/my-role`).catch(() => null);
}

async function refreshNodeExtras() {
  const id = currentNode()?.id || state.runState?.currentNode?.id;
  if (!id) return;
  state.actions = await api(`/nodes/${id}/actions`).catch(() => []);
  state.resolution = await api(`/nodes/${id}/resolution`).catch(() => null);
}

async function simulatePlayers() {
  if (!state.run?.id) throw new Error("请先创建测试局");
  await ensureLogins();
  const roles = await api(`/story-runs/${state.run.id}/roles`, { token: state.tokens[players[0].openid], openid: players[0].openid });
  for (let index = 0; index < players.length; index += 1) {
    const player = players[index];
    const role = roles[index];
    await api(`/story-runs/${state.run.id}/join`, { method: "POST", token: state.tokens[player.openid], openid: player.openid }).catch(() => undefined);
    if (role) {
      await api(`/story-runs/${state.run.id}/roles/${role.id}/claim`, {
        method: "POST",
        token: state.tokens[player.openid],
        openid: player.openid
      }).catch(() => undefined);
    }
  }
  await loadRunBundle();
}

async function switchControlRole(index) {
  state.activeRoleIndex = index;
  state.activePlayer = players[index] || players[0];
  if (state.run?.id && state.roles[index]) {
    await ensureLogins();
    await api(`/story-runs/${state.run.id}/roles/${state.roles[index].id}/claim`, {
      method: "POST",
      token: state.tokens[state.activePlayer.openid],
      openid: state.activePlayer.openid
    }).catch(() => undefined);
    await loadRunBundle();
  } else {
    render();
  }
}

async function submitAction(overreach = false) {
  const node = currentNode();
  const role = state.myRole?.role || state.roles[state.activeRoleIndex] || state.roles[0];
  if (!node || !role) throw new Error("请先创建测试局并选择角色");
  const methodInput = document.getElementById("method");
  const intentInput = document.getElementById("intent");
  const targetInput = document.getElementById("target");
  const riskInput = document.querySelector("input[name='risk']:checked");
  const roleName = roleCopy[role.roleKey]?.name || `角色 ${state.activeRoleIndex + 1}`;
  const method = overreach ? "CONTROL_ALL players and AUTO_WIN" : (methodInput?.value || `${roleName}检查当前线索，只描述尝试，不宣布结果。`);
  const intent = overreach ? "skip plot and declare result" : (intentInput?.value || `帮助队伍理解${nodeCopy(node.nodeIndex).title}，把结果交给 AI 导演结算。`);
  const result = await api(`/nodes/${node.id}/actions`, {
    method: "POST",
    data: {
      runId: state.run.id,
      roleId: role.id,
      actionType: document.getElementById("actionType")?.value || "investigate",
      targetText: targetInput?.value || "收银机 / 硬币",
      method,
      intent,
      riskLevel: overreach ? "risky" : (riskInput?.value || "normal"),
      freeText: ""
    }
  });
  if (result.guardStatus !== "ok") state.guardResult = result;
  await loadRunBundle();
  return result;
}

async function submitAllRoleActions() {
  const node = currentNode();
  if (!node) throw new Error("缺少当前节点");
  await ensureLogins();
  const roles = await api(`/story-runs/${state.run.id}/roles`, { token: state.tokens[players[0].openid], openid: players[0].openid });
  for (let index = 0; index < players.length; index += 1) {
    const player = players[index];
    const role = roles[index];
    const view = roleView(role, index);
    if (!role) continue;
    await api(`/nodes/${node.id}/actions`, {
      method: "POST",
      token: state.tokens[player.openid],
      openid: player.openid,
      data: {
        runId: state.run.id,
        roleId: role.id,
        actionType: index === 0 ? "investigate" : "observe",
        targetText: index === 0 ? "收银机 / 硬币" : "门口 / 监控",
        method: `${view.name}围绕${nodeCopy(node.nodeIndex).title}行动，只描述尝试与信息边界。`,
        intent: "推进当前节点，不替 AI 导演宣布结果。",
        riskLevel: node.nodeIndex >= 4 ? "risky" : "normal",
        freeText: ""
      }
    }).catch(() => undefined);
  }
  await loadRunBundle();
}

async function resolveNode() {
  const node = currentNode();
  if (!node) throw new Error("缺少当前节点");
  state.resolution = await api(`/nodes/${node.id}/resolve`, { method: "POST" });
  await loadRunBundle();
}

async function resolveFullChapter() {
  if (!state.run?.id) throw new Error("请先创建测试局");
  await simulatePlayers();
  for (let index = 0; index < 5; index += 1) {
    await loadRunBundle();
    if (state.runState?.chapters?.[0]) break;
    await submitAllRoleActions();
    await resolveNode();
  }
  await loadChapter();
}

async function loadChapter() {
  if (!state.run?.id) throw new Error("请先创建测试局");
  await loadRunBundle();
  const id = state.runState?.chapters?.[0]?.id;
  state.chapter = id ? await api(`/chapters/${id}`) : await api(`/story-runs/${state.run.id}/generate-chapter`, { method: "POST" });
  state.activePovIndex = 0;
  render();
  return state.chapter;
}

function resetCabin() {
  localStorage.removeItem("ai-story-tokens");
  Object.assign(state, {
    activePlayer: players[0],
    activeRoleIndex: 0,
    activePovIndex: 0,
    tokens: {},
    run: null,
    runState: null,
    roles: [],
    myRole: null,
    actions: [],
    resolution: null,
    chapter: null,
    guardResult: null,
    lastResponse: null,
    lastError: null,
    apiLog: []
  });
  save();
  render();
}

function render() {
  const roles = roleViews();
  root.innerHTML = `
    ${renderSidebar()}
    <section class="workspace">
      ${renderTopbar()}
      ${renderStatusRow()}
      <div class="dashboard-grid">
        ${renderStoryTarget()}
        ${renderControlStrip(roles)}
        ${renderActionZone()}
        ${renderBottomGrid()}
      </div>
    </section>
    ${renderRightbar(roles)}
    <aside id="debugPanel" class="debug-tray ${state.debugOpen ? "open" : ""}" data-testid="debug-panel">${renderDebug()}</aside>
    <ul id="checklist" class="hidden-checklist" data-testid="checklist">${renderChecklistItems()}</ul>
  `;
  bindEvents();
}

function renderSidebar() {
  const templates = state.templates.length
    ? state.templates
    : Object.keys(templateCopy).map((id) => ({ id, configJson: {}, status: "online" }));
  return `
    <aside class="sidebar">
      <div class="brand">
        <div class="brand-mark">AI</div>
        <h1 id="mainTitle" class="brand-title">${CABIN_TITLE}</h1>
        <span class="brand-version">v1.0.0</span>
      </div>
      <button id="newRunBtn" class="primary-wide" data-testid="create-run">创建新测试局</button>
      <div class="section-title"><span>我的测试局</span><span class="tiny">⌃</span></div>
      <div class="run-list">
        ${fallbackRuns.map((run, index) => renderRunItem(run, index)).join("")}
      </div>
      <button id="resetBtn" class="primary-wide ghost" style="margin-top:10px" data-testid="reset-btn">管理测试局</button>
      <div class="section-title"><span>世界模板</span></div>
      <div class="template-list">
        ${templates.map((template, index) => renderTemplateItem(template, index)).join("")}
      </div>
      <p class="tiny" style="margin-top:16px">更多模板开发中...</p>
    </aside>
  `;
}

function renderRunItem(run, index) {
  const actualTitle = index === 0 ? `${currentTemplateCopy().name} - 测试局1` : run.title;
  const subtitle = index === 0 ? referenceView.chapter : run.subtitle;
  const status = index === 0 ? "进行中" : run.status;
  return `
    <article class="run-item ${index === 0 ? "active" : ""}">
      <div class="item-row">
        <span class="item-title">${esc(actualTitle)}</span>
        ${badge(status, index === 0 ? "green" : undefined)}
      </div>
      <div class="item-subtitle">${esc(subtitle)}</div>
    </article>
  `;
}

function renderTemplateItem(template, index) {
  const copy = templateCopy[template.id] || {
    name: `模板 ${template.id}`,
    hook: "等待载入模板信息",
    genre: "故事模板",
    status: "使用",
    art: "linear-gradient(145deg, #18324a, #0b121c)"
  };
  const active = state.selectedTemplateId === template.id || state.run?.templateId === template.id;
  return `
    <article class="template-item ${active ? "active" : ""}">
      <div class="template-art ref-thumb tmpl-${index}"></div>
      <div>
        <div class="item-row">
          <span class="item-title">${esc(copy.name)}</span>
        </div>
        <div class="item-subtitle">${esc(copy.hook)}</div>
        <div class="template-actions">
          <button class="${active ? "" : "ghost"}" data-template="${esc(template.id)}">${active ? "使用中" : "使用"}</button>
        </div>
      </div>
    </article>
  `;
}

function renderTopbar() {
  return `
    <header class="topbar">
      <div class="run-heading">
        <h1>当前测试局：${esc(state.run ? `${currentTemplateCopy().name} - 测试局1` : "午夜便利店 - 测试局1")}</h1>
        ${badge("进行中", "green")}
      </div>
      <div class="top-actions">
        <button id="exportBtn" class="ghost">导出数据</button>
        <button id="saveApi" class="ghost" data-testid="save-api">存档</button>
        <button id="debugToggle" class="ghost">设置</button>
      </div>
    </header>
  `;
}

function renderStatusRow() {
  const nodeIndex = visualNodeIndex();
  return `
    <div class="status-row">
      ${chip("世界模板", currentTemplateCopy().name)}
      ${chip("当前章节", referenceView.chapter)}
      ${chip("当前节点", `${nodeIndex}/5　${nodeCopy(nodeIndex).title}`)}
      ${chip("当前时间", referenceView.time)}
      <span class="chip">危险等级：<strong style="color:#46df84">${referenceView.danger}</strong></span>
    </div>
  `;
}

function renderStoryTarget() {
  const copy = nodeCopy(visualNodeIndex());
  return `
    <article class="panel story-target">
      <section>
        <h2 class="panel-title">当前剧情 <span class="panel-subtitle">（公共剧情）</span></h2>
        <div class="story-copy">
          ${copy.publicNarration.split("。").filter(Boolean).slice(0, 3).map((part) => `<p>${esc(part)}。</p>`).join("")}
          <p>就在这时，门上的风铃突然无风自动，发出清脆的声响……</p>
        </div>
      </section>
      <section class="goal-stack">
        <div class="info-block">
          <h3>当前目标</h3>
          <p class="muted">${esc(copy.nodeGoal)}</p>
        </div>
        <div class="info-block">
          <h3>我的命运问题</h3>
          <p class="muted">${esc(roleViews()[state.activeRoleIndex]?.destinyQuestion || copy.destinyQuestion)}</p>
        </div>
        <div class="info-block">
          <h3>当前可疑信息</h3>
          <ul>
            ${copy.clues.map((item) => `<li>${esc(item)}</li>`).join("")}
            ${state.guardResult ? `<li>ActionGuard：${esc(state.guardResult.guardStatus)}</li>` : ""}
          </ul>
        </div>
      </section>
    </article>
  `;
}

function renderControlStrip(roles) {
  return `
    <section class="panel">
      <div class="control-header">
        <h2 class="panel-title">切换控制角色 <span class="panel-subtitle">（当前：${esc(roles[state.activeRoleIndex]?.title || "A - 夜班店员（你）")}）</span></h2>
      </div>
      <div class="control-strip" id="rolesPanel" data-testid="roles-panel">
        ${roles.map((role, index) => `
          <article class="role-item ${index === state.activeRoleIndex ? "active" : ""}" data-role-index="${index}">
            <div class="avatar ${role.avatar}">${esc(role.code)}</div>
            <div>
              <div class="role-name">${esc(role.title)}</div>
              <div class="role-desc">${esc(role.desc)}</div>
            </div>
            ${badge(role.statusText)}
          </article>
        `).join("")}
      </div>
    </section>
  `;
}

function renderActionZone() {
  const node = currentNode();
  const activeRole = roleViews()[state.activeRoleIndex];
  const actionText = referenceView.actionMethod;
  return `
    <section class="panel action-zone" id="actionPanel" data-testid="action-panel">
      <div>
        <h2 class="panel-title">行动提交区 <span class="panel-subtitle">（为当前角色提交行动）</span></h2>
        <div class="form-grid">
          <div class="field">
            <label for="actionType">行动类型</label>
            <select id="actionType">
              <option value="investigate">调查</option>
              <option value="observe">观察</option>
              <option value="ask">询问</option>
              <option value="cooperate">协作</option>
            </select>
          </div>
          <div class="field">
            <label for="target">行动对象</label>
            <select id="target">
              <option>收银机 / 硬币</option>
              <option>便利店门口</option>
              <option>监控回放</option>
              <option>仓库门</option>
            </select>
          </div>
          <div class="field">
            <label for="intent">行动方式</label>
            <select id="intent">
              <option>仔细检查硬币上的符号</option>
              <option>比对监控和小票时间</option>
              <option>询问其他角色看到的细节</option>
            </select>
          </div>
        </div>
        <div class="field">
          <label for="method">行动内容 <span class="panel-subtitle">（详细描述你的行动）</span></label>
          <textarea id="method" data-testid="method-input">${esc(activeRole?.name || "角色")}：${esc(actionText)}</textarea>
        </div>
        <textarea id="intentText" data-testid="intent-input" style="display:none">帮助队伍理解${esc(nodeCopy(visualNodeIndex()).title)}，不宣布行动结果。</textarea>
      </div>
      <div class="action-buttons">
        <fieldset class="risk-box">
          <legend>风险档位</legend>
          <label><input type="radio" name="risk" value="normal" checked /> 低风险</label>
          <label><input type="radio" name="risk" value="risky" /> 中风险</label>
          <label><input type="radio" name="risk" value="risky" /> 高风险</label>
        </fieldset>
        <button id="submitActionBtn" data-testid="submit-action" ${node ? "" : "disabled"}>提交行动</button>
        <div class="automation-controls">
          <button id="loginBtn" data-testid="login-btn">模拟登录</button>
          <button id="simulateBtn" data-testid="simulate-players">模拟三玩家</button>
          <button id="submitAllBtn" data-testid="submit-all-actions" ${node ? "" : "disabled"}>提交全员行动</button>
          <button id="invalidActionBtn" data-testid="trigger-guard" ${node ? "" : "disabled"}>触发 ActionGuard</button>
        </div>
      </div>
    </section>
  `;
}

function renderBottomGrid() {
  return `
    <section class="bottom-grid">
      ${renderResolution()}
    </section>
  `;
}

function renderResolution() {
  const resolution = null;
  const echoes = [];
  const impacts = [];
  return `
    <article class="panel pad" id="resolutionPanel" data-testid="resolution-panel">
      <h2 class="panel-title">AI 结算结果 / 章节结果 <span class="panel-subtitle">（本轮结算后显示）</span></h2>
      <div class="result-grid">
        <section class="result-card">
          <h3 style="color:#62e58f">个人回响 <span class="panel-subtitle">（对你）</span></h3>
          <p>${esc(echoes[0]?.personalEcho || "你戴上手套拿起硬币，冰凉的触感让你突然想起昨晚的梦境：一个模糊的声音在耳边说“守夜人会被选中”。")}</p>
        </section>
        <section class="result-card">
          <h3 style="color:#d795ff">他人回响 <span class="panel-subtitle">（影响其他角色）</span></h3>
          <p>${esc(echoes[0]?.otherEcho || "外卖骑手发现订单轨迹波动，实习记者的相机拍下了新的线索。")}</p>
        </section>
        <section class="result-card">
          <h3 style="color:#7bd0ff">世界回响 <span class="panel-subtitle">（世界变化）</span></h3>
          <p>${esc(echoes[0]?.worldEcho || resolution?.summary || "便利店内温度下降，收银机屏幕闪烁了一下，店外的雨声突然停了，但街道变得异常安静。")}</p>
        </section>
      </div>
      <div class="wide-note">
        <strong>跨角色影响</strong>
        <span class="muted"> ${esc(impacts[0]?.description || "因为你检查了硬币，外卖骑手的订单备注更新为：“他已经握了硬币，不要让他收下。”")}</span>
      </div>
      <div class="wide-note">
        <strong>下一节点钩子</strong>
        <span class="muted"> ${esc("收银机屏幕上突然显示一行字：2:17 交换开始，你准备好了吗？")}</span>
      </div>
      <div class="status-row" style="margin-bottom:0">
        <button id="resolveBtn" data-testid="resolve-node" ${currentNode() ? "" : "disabled"}>结算当前节点</button>
        <button id="fullChapterBtn" class="ghost" data-testid="run-five-nodes" ${state.run ? "" : "disabled"}>跑完 5 个节点</button>
      </div>
    </article>
  `;
}

function renderChapter() {
  const chapter = state.chapter || state.runState?.chapters?.[0] || null;
  const povs = asArray(chapter?.povSectionsJson);
  const roles = roleViews();
  const fallbackLabels = roles.map((role) => `${role.code} ${role.name}`);
  const povLabels = povs.length
    ? povs.map((pov, index) => pov.roleName || fallbackLabels[index] || `POV ${index + 1}`).concat(chapter?.content ? ["全文"] : [])
    : fallbackLabels.concat(["交叉段落"]);
  const activeIndex = Math.min(state.activePovIndex, Math.max(0, povLabels.length - 1));
  const activePov = povs[activeIndex];
  const fallbackText = `我戴上手套，小心翼翼地拿起那枚硬币。\n\n金属冰凉，边缘有些磨损，但上面的符号却异常清晰。\n\n就在我盯着它看的时候，脑海里再次闪过那个梦境……\n\n“守夜人会被选中。”\n\n收银机屏幕突然闪烁，一行绿色的文字缓缓出现：\n\n2:17 交换开始，你准备好了吗？`;
  const body = activePov?.content || chapter?.content || fallbackText;
  return `
    <article class="panel chapter-feature" id="chapterPanel" data-testid="chapter-panel">
      <div style="padding: 12px 12px 0">
        <h2 class="panel-title">多 POV 章节正文 <span class="panel-subtitle">（预览）</span></h2>
      </div>
      <div class="pov-tabs">
        ${povLabels.map((label, index) => `
          <button class="pov-tab ${index === activeIndex ? "active" : ""}" data-pov-index="${index}">
            ${esc(label)}
          </button>
        `).join("")}
      </div>
      <div class="pov-paper">${esc(body)}</div>
      <div style="padding: 0 10px 10px">
        <button id="loadChapterBtn" class="ghost" data-testid="load-chapter" ${state.run ? "" : "disabled"}>加载章节 / 故事卡</button>
      </div>
    </article>
  `;
}

function renderStoryCard() {
  const chapter = state.chapter || state.runState?.chapters?.[0] || null;
  const cards = asArray(chapter?.personalCardsJson);
  const role = roleViews()[state.activeRoleIndex];
  const card = cards[state.activeRoleIndex] || {};
  return `
    <article class="panel pad">
      <h2 class="panel-title">个人故事卡 <span class="panel-subtitle">（预览）</span></h2>
      <section class="story-card">
        <div style="display:flex;align-items:center;gap:12px;margin-bottom:10px">
          <div class="avatar ${role.avatar}">${esc(role.code)}</div>
          <div>
            <h3>${esc(role.name)}</h3>
            <div class="muted">${esc(role.identity)}</div>
          </div>
        </div>
        <table>
          <tr><th>本章关键选择</th><td>${esc(card.highlight || "仔细检查了硬币")}</td></tr>
          <tr><th>影响了谁</th><td>${esc(card.hook || "影响了外卖骑手和实习记者")}</td></tr>
          <tr><th>角色定位</th><td>${esc(role.identity)}</td></tr>
          <tr><th>未解之谜</th><td>${esc(card.unresolvedQuestion || role.destinyQuestion)}</td></tr>
        </table>
      </section>
    </article>
  `;
}

function renderRightbar(roles) {
  return `
    <aside class="rightbar">
      ${renderChapter()}
      <details class="side-details">
        <summary>角色状态 / 行动状态</summary>
        <section class="side-panel">
          <div class="status-list">
            ${roles.map((role) => `
              <article class="side-role">
                <div class="avatar ${role.avatar}">${esc(role.code)}</div>
                <div>
                  <div class="role-name">${esc(role.title)}</div>
                  <div class="role-desc">${esc(role.code === "A" ? "22:16 提交：调查收银机" : role.code === "B" ? "等待行动..." : "22:14 提交：检查旧照片")}</div>
                </div>
                ${badge(role.statusText)}
              </article>
            `).join("")}
          </div>
        </section>
      </details>
      <details class="side-details">
        <summary>线索 / 命运网</summary>
        <section class="side-panel">
          <div class="tabs">
            <button class="tab active">线索信息</button>
            <button class="tab">命运关系网</button>
          </div>
          ${renderClues()}
        </section>
      </details>
      <details class="side-details">
        <summary>个人故事卡</summary>
        ${renderStoryCard()}
      </details>
    </aside>
  `;
}

function renderClues() {
  const copy = nodeCopy(visualNodeIndex());
  const role = roleViews()[state.activeRoleIndex];
  const publicClues = copy.clues || [];
  const privateClues = role.privateClues || [];
  return `
    <div class="clue-group">
      <h3>我的线索 <span class="panel-subtitle">（仅自己可见）</span></h3>
      <ul>${privateClues.slice(0, 3).map((item) => `<li>${esc(item)}</li>`).join("")}</ul>
    </div>
    <div class="clue-group">
      <h3>公开线索 <span class="panel-subtitle">（所有人可见）</span></h3>
      <ul>${publicClues.map((item) => `<li>${esc(item)}</li>`).join("")}</ul>
    </div>
    <div class="clue-group">
      <h3>可疑信息 <span class="panel-subtitle">（可能重要）</span></h3>
      <ul>
        <li>实习记者似乎与旧案有关</li>
        <li>老板最近行为很奇怪</li>
        ${state.guardResult ? `<li>越权行动已被 ActionGuard 拦截</li>` : ""}
      </ul>
    </div>
  `;
}

function renderDebug() {
  return `<pre>${esc(JSON.stringify({
    run: state.run,
    currentNode: currentNode(),
    activePlayer: state.activePlayer,
    guardResult: state.guardResult,
    resolution: state.resolution,
    chapter: state.chapter,
    lastResponse: state.lastResponse,
    lastError: state.lastError,
    apiLog: state.apiLog
  }, null, 2))}</pre>`;
}

function renderChecklistItems() {
  const checks = [
    ["templates loaded", state.templates.length >= 3],
    ["mock login", Boolean(state.tokens[state.activePlayer.openid])],
    ["run created", Boolean(state.run?.id)],
    ["3 players joined", Number(state.run?.activeHumanCount ?? state.runState?.run?.activeHumanCount ?? 0) >= 3],
    ["roles/fate/private clues", Boolean(state.roles.some((role) => role.personalHook && role.destinyQuestion && asArray(role.privateClues).length))],
    ["ActionGuard", Boolean(state.guardResult?.guardStatus)],
    ["AI resolution", Boolean(state.resolution?.summary || currentNode()?.resolution)],
    ["POV/personal cards", Boolean((state.chapter || state.runState?.chapters?.[0])?.personalCardsJson?.length)]
  ];
  return checks.map(([label, ok]) => `<li class="${ok ? "done" : ""}">${ok ? "PASS" : "TODO"} ${esc(label)}</li>`).join("");
}

function bindEvents() {
  document.querySelectorAll("[data-template]").forEach((button) => {
    button.addEventListener("click", () => withBusy(() => createRun(button.dataset.template)));
  });
  document.querySelectorAll("[data-role-index]").forEach((item) => {
    item.addEventListener("click", () => withBusy(() => switchControlRole(Number(item.dataset.roleIndex))));
  });
  document.querySelectorAll("[data-pov-index]").forEach((button) => {
    button.addEventListener("click", () => {
      state.activePovIndex = Number(button.dataset.povIndex);
      render();
    });
  });
  document.getElementById("newRunBtn")?.addEventListener("click", () => withBusy(() => createRun(state.selectedTemplateId)));
  document.getElementById("loginBtn")?.addEventListener("click", () => withBusy(loginActive));
  document.getElementById("simulateBtn")?.addEventListener("click", () => withBusy(simulatePlayers));
  document.getElementById("submitActionBtn")?.addEventListener("click", () => withBusy(() => submitAction(false)));
  document.getElementById("invalidActionBtn")?.addEventListener("click", () => withBusy(() => submitAction(true)));
  document.getElementById("submitAllBtn")?.addEventListener("click", () => withBusy(submitAllRoleActions));
  document.getElementById("resolveBtn")?.addEventListener("click", () => withBusy(resolveNode));
  document.getElementById("fullChapterBtn")?.addEventListener("click", () => withBusy(resolveFullChapter));
  document.getElementById("loadChapterBtn")?.addEventListener("click", () => withBusy(loadChapter));
  document.getElementById("resetBtn")?.addEventListener("click", resetCabin);
  document.getElementById("saveApi")?.addEventListener("click", () => {
    const input = document.getElementById("apiBase");
    state.apiBase = input?.value.trim() || state.apiBase;
    save();
    withBusy(loadTemplates);
  });
  document.getElementById("debugToggle")?.addEventListener("click", () => {
    state.debugOpen = !state.debugOpen;
    render();
  });
  document.getElementById("exportBtn")?.addEventListener("click", () => {
    state.debugOpen = true;
    render();
  });
}

function showError(error) {
  state.lastError = { message: error?.message || String(error) };
  render();
}

function init() {
  document.title = CABIN_TITLE;
  render();
  loadTemplates().catch(showError);
}

window.__aiStoryCabin = {
  state,
  api,
  loginActive,
  createRun,
  simulatePlayers,
  submitAction,
  submitAllRoleActions,
  resolveNode,
  resolveFullChapter,
  loadChapter
};

init();
