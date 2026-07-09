const root = document.getElementById("app");

const API_BASE_KEY = "ai-story-room-api-base";
const RUN_ID_KEY = "ai-story-room-sangtian-run-id";
const DEFAULT_API_BASE = "http://localhost:3001/api";

let selectedOption = "A";
let customDecision = "";
let state = {
  apiOnline: false,
  loading: true,
  error: "",
  guard: null,
  view: null
};

const fallbackStore = {
  run: null
};

function apiBase() {
  const fromQuery = new URLSearchParams(window.location.search).get("apiBase");
  if (fromQuery) {
    localStorage.setItem(API_BASE_KEY, fromQuery);
    return fromQuery;
  }
  return localStorage.getItem(API_BASE_KEY) || DEFAULT_API_BASE;
}

function uid(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(16).slice(2, 8)}`;
}

async function request(path, options = {}) {
  const response = await fetch(`${apiBase()}${path}`, {
    method: options.method || "GET",
    headers: { "content-type": "application/json", "x-mock-openid": "mock_openid_sangtian_owner" },
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.message || `HTTP ${response.status}`);
  return payload;
}

async function boot() {
  root.className = "mvp-root";
  renderLoading("正在打开杭州总督府内厅...");
  if (new URLSearchParams(window.location.search).get("reset") === "1") {
    localStorage.removeItem(RUN_ID_KEY);
  }
  const runId = localStorage.getItem(RUN_ID_KEY);
  try {
    const view = runId
      ? await request(`/v4/story-runs/${runId}`)
      : await request("/v4/story-runs", { method: "POST", body: { storyId: "sangtian", startDay: 3 } });
    localStorage.setItem(RUN_ID_KEY, view.run.id);
    state = { apiOnline: true, loading: false, error: "", guard: null, view };
  } catch (error) {
    const view = fallbackStore.run || createFallbackRun();
    fallbackStore.run = view;
    state = {
      apiOnline: false,
      loading: false,
      error: `本地 API 未连接，当前使用离线同构状态：${error instanceof Error ? error.message : String(error)}`,
      guard: null,
      view
    };
  }
  selectedOption = state.view.activeDecision?.options?.[0]?.key || "A";
  render();
}

function createFallbackRun() {
  const view = baseView("local_sangtian_mvp");
  view.events.push(event("run_created", { backend: "offline-fallback" }));
  return view;
}

function baseView(runId) {
  return {
    run: {
      id: runId,
      storyId: "sangtian",
      title: "桑田诏：嘉靖财政危局",
      location: "杭州总督府 · 内厅",
      currentDay: 3,
      currentTime: "午后",
      totalDays: 7,
      status: "awaiting_decision",
      version: 1
    },
    player: {
      roleName: "浙江总督",
      name: "郝帅彬",
      rank: "从四品",
      office: "兵部侍郎衔",
      fateQuestion: "保浙江，还是保自己？",
      goals: ["稳定浙江局势", "控制巡抚势力", "避免皇帝生疑"],
      resources: [
        ["银两", "42万两"],
        ["粮草", "23万石"],
        ["兵丁", "4/5"],
        ["幕僚", "4人"],
        ["密报", "2条"]
      ],
      leverage: ["田契暗账（半页）", "清流县令密信", "巡抚与商会旧约传闻"]
    },
    messages: [
      {
        id: "msg_opening",
        day: 3,
        time: "午前",
        type: "system",
        label: "系统",
        title: "粮价上涨",
        body: "自改桑令下已三日，杭州粮价连涨，米价较初令下时已高出三成。各县执行不一，民间怨声渐起。",
        illustration: true
      },
      {
        id: "msg_county",
        day: 3,
        time: "午前",
        type: "private_intel",
        label: "密信",
        speaker: "清流县令",
        title: "百姓转难以为继",
        body: "县令卢象升密信送达：“粮价再涨，百姓将难以为继。另，巡抚与商会往来密切，似有旧约，但尚未能取得实据。”"
      },
      {
        id: "msg_merchant",
        day: 3,
        time: "午后",
        type: "private_intel",
        label: "私讯",
        speaker: "江南商会",
        title: "商会递来口信",
        body: "江南商会掌柜私下托人传话：“若官府能保障商路不受盘查，愿先行代运粮草。然需税赋减免及票据自便。”"
      },
      {
        id: "msg_patrol",
        day: 3,
        time: "午后",
        type: "role_action",
        label: "玩家行动",
        speaker: "浙江巡抚 刘瑾",
        title: "巡抚急奏北上",
        body: "巡抚已将改桑初成的奏疏送往京师，奏中称：“浙江改桑已有成效，只待朝廷嘉奖，便可十日内见第一批银。”此举若先到内阁，巡抚声望上升，你的统筹权威将受到削弱。",
        requiresDecision: true
      },
      {
        id: "msg_prompt",
        day: 3,
        time: "午后",
        type: "system_hint",
        label: "系统提示",
        title: "巡抚越级上奏已成事实",
        body: "若不及时应对，内阁可能只听到巡抚一面之词。",
        requiresDecision: true
      }
    ],
    activeDecision: {
      messageId: "msg_patrol",
      title: "巡抚越级上奏",
      help: "选择你的应对方式。你的选择会改写局势、关系和潜在风险。",
      options: [
        {
          key: "A",
          title: "截留奏疏",
          body: "派人追回奏疏，责令巡抚不得越级。",
          gain: "阻止巡抚抢功",
          risk: "巡抚反咬你压制国策",
          patch: { "总督权威": 5, "巡抚敌意": 12, "内阁疑心": 8, "皇帝信任": -2 }
        },
        {
          key: "B",
          title: "追加密奏",
          body: "不阻止巡抚，但另写密奏给皇帝。",
          gain: "保留解释权",
          risk: "内阁会怀疑你越级自保",
          patch: { "皇帝信任": 7, "皇帝疑心": 4, "内阁疑心": 6, "清算风险": -4 }
        },
        {
          key: "C",
          title: "放任巡抚",
          body: "让他继续抢功，暗中观察其后续动作。",
          gain: "未来可一并清算",
          risk: "巡抚短期声望上升",
          patch: { "巡抚敌意": -4, "总督权威": -8, "改桑进度": 5, "清算风险": 5 }
        }
      ]
    },
    dashboard: {
      worldState: [
        ["国库银两", 42, "green"],
        ["民心", 55, "gold"],
        ["粮价", 72, "red"],
        ["改桑进度", 58, "green"],
        ["皇帝信任", 43, "gold"]
      ],
      relationships: [
        { name: "浙江巡抚", person: "刘瑾", stance: "戒备", score: 25, tone: "bad", avatar: "督" },
        { name: "清流县令", person: "卢象升", stance: "信任", score: 68, tone: "good", avatar: "县" },
        { name: "江南商会", person: "掌柜", stance: "观望", score: 40, tone: "warn", avatar: "商" },
        { name: "兵部尚书", person: "梁廷栋", stance: "友好", score: 58, tone: "good", avatar: "兵" },
        { name: "司礼监掌印", person: "魏忠贤", stance: "警惕", score: 20, tone: "bad", avatar: "监" }
      ],
      latestChanges: [
        ["粮价较昨日", 5],
        ["民心较昨日", -3],
        ["巡抚声望", 10],
        ["司礼监警惕", 2]
      ],
      risks: [
        ["粮价失控", "中"],
        ["巡抚越级", "高"],
        ["商会结党", "中"],
        ["县令失控", "中"]
      ],
      roleState: {
        "总督权威": 60,
        "清算风险": 45,
        "内阁疑心": 35,
        "巡抚敌意": 30,
        "司礼监警惕": 30,
        "商会依赖": 35
      }
    },
    decisionHistory: [],
    events: []
  };
}

function event(type, payload = {}) {
  return { id: uid("event"), type, payload, createdAt: new Date().toISOString() };
}

function renderLoading(text) {
  root.innerHTML = `<main class="boot-screen"><div class="seal">桑田诏</div><p>${esc(text)}</p></main>`;
}

function render() {
  if (state.loading) return renderLoading("正在读取局势...");
  const view = state.view;
  if (!view) return renderLoading("局势读取失败");
  root.innerHTML = `
    <div class="mvp-shell">
      ${renderTopbar(view)}
      <aside class="left-rail">
        ${renderPlayer(view)}
        ${renderGoals(view)}
        ${renderResources(view)}
        ${renderLeverage(view)}
      </aside>
      <main class="center-board">
        ${renderMessageStream(view)}
        ${renderDecisionPanel(view)}
      </main>
      <aside class="right-rail">
        ${renderWorldState(view)}
        ${renderRelationships(view)}
        ${renderLatestChanges(view)}
        ${renderRisks(view)}
      </aside>
      ${state.error ? `<div class="api-toast">${esc(state.error)}</div>` : ""}
    </div>
  `;
  bindEvents();
  const stream = document.getElementById("messageStream");
  if (stream) stream.scrollTop = stream.scrollHeight;
}

function renderTopbar(view) {
  const remain = Math.max(0, view.run.totalDays - view.run.currentDay);
  return `
    <header class="topbar">
      <div class="top-location">${esc(view.run.location)}</div>
      <div class="top-day">第 ${view.run.currentDay} 天&nbsp;&nbsp;${esc(view.run.currentTime)}</div>
      <div class="top-countdown">距离御前裁决：<b>${remain}</b> 天</div>
      <button class="icon-btn" id="historyBtn" title="历史回顾">▣ <span>历史回顾</span></button>
      <button class="icon-btn" id="resetBtn" title="重开本局">⚙ <span>设置</span></button>
    </header>
  `;
}

function renderPlayer(view) {
  const player = view.player;
  return `
    <section class="side-panel player-panel">
      <h2>我的信息</h2>
      <div class="player-card">
        <div class="official-portrait governor"><span>督</span></div>
        <div>
          <h3>${esc(player.roleName)}<br/>${esc(player.name)}</h3>
          <p>${esc(player.rank)}</p>
          <p>${esc(player.office)}</p>
        </div>
      </div>
    </section>
  `;
}

function renderGoals(view) {
  return `
    <section class="side-panel">
      <h2>当前目标</h2>
      <ul class="bullet-list">${view.player.goals.map((item) => `<li>${esc(item)}</li>`).join("")}</ul>
    </section>
  `;
}

function renderResources(view) {
  return `
    <section class="side-panel">
      <h2>我的资源</h2>
      <div class="resource-list">
        ${view.player.resources.map(([key, value]) => `<div><span>${esc(key)}</span><strong>${esc(value)}</strong></div>`).join("")}
      </div>
    </section>
  `;
}

function renderLeverage(view) {
  return `
    <section class="side-panel leverage-panel">
      <h2>我的筹码</h2>
      <ul class="token-list">${view.player.leverage.map((item) => `<li>${esc(item)}</li>`).join("")}</ul>
      <div class="watermark">总督</div>
    </section>
  `;
}

function renderMessageStream(view) {
  return `
    <section class="message-panel">
      <div class="panel-head">
        <h1>局势消息流</h1>
        <select aria-label="消息筛选"><option>全部</option><option>密信</option><option>决策</option></select>
      </div>
      <div class="message-stream" id="messageStream">
        ${view.messages.map(renderMessageCard).join("")}
      </div>
    </section>
  `;
}

function renderMessageCard(message) {
  const portrait = message.speaker ? `<div class="mini-portrait">${esc((message.speaker || "").slice(0, 1))}</div>` : "";
  const marker = message.type === "private_intel" ? "密信" : message.type === "role_action" ? "玩家行动" : message.type === "system_hint" ? "!" : "";
  return `
    <article class="message-card ${esc(message.type)} ${message.requiresDecision ? "decision-source" : ""}">
      ${portrait}
      <div class="message-content">
        <div class="message-meta">
          <span class="type-badge">${esc(message.label || message.type)}</span>
          ${message.speaker ? `<span>${esc(message.speaker)}</span>` : ""}
          <span>第${message.day}天 ${esc(message.time || "")}</span>
        </div>
        <h3>${esc(message.title)}</h3>
        <p>${esc(message.body).replace(/\n/g, "<br/>")}</p>
      </div>
      ${message.illustration ? `<div class="ink-wash" aria-hidden="true"></div>` : ""}
      ${marker ? `<b class="message-seal">${esc(marker)}</b>` : ""}
    </article>
  `;
}

function renderDecisionPanel(view) {
  if (view.run.status === "finished") {
    const finalMessage = [...view.messages].reverse().find((item) => item.type === "final");
    return `
      <section class="decision-panel complete">
        <h2>御前裁决已定</h2>
        <p>${esc(finalMessage?.body || "你的选择已汇入最终裁决。")}</p>
        <button class="primary-btn" id="resetDecisionBtn">重开一局</button>
      </section>
    `;
  }

  if (!view.activeDecision) {
    return `
      <section class="decision-panel complete">
        <h2>今日关键决策已提交</h2>
        <p>局势已经记录你的选择。你可以继续推进到明日，或直接查看御前裁决示例。</p>
        <div class="decision-actions">
          <button class="secondary-btn" id="advanceBtn">进入明日</button>
          <button class="primary-btn" id="finalizeBtn">进入裁决</button>
        </div>
      </section>
    `;
  }

  const decision = view.activeDecision;
  return `
    <section class="decision-panel">
      <div class="decision-title">
        <h2>你要如何应对？</h2>
        <p>当前事件：${esc(decision.title)} <button class="tiny-help" title="${esc(decision.help)}">?</button></p>
      </div>
      ${state.guard ? `<div class="guard-box"><strong>ActionGuard：</strong>${esc(state.guard.reason)}${state.guard.suggestedRewrite ? `<br/>建议：${esc(state.guard.suggestedRewrite)}` : ""}</div>` : ""}
      <div class="option-list">
        ${decision.options.map((option) => renderOption(option)).join("")}
        <button class="decision-option custom ${selectedOption === "CUSTOM" ? "active" : ""}" data-option="CUSTOM">
          <div><strong>D. 自定义决策</strong><span>自行拟定策略与应对方式</span></div>
          <i>›</i>
        </button>
      </div>
      <textarea id="customDecision" placeholder="请输入你的决策内容（可详细说明你的计划）">${esc(customDecision)}</textarea>
      <div class="decision-actions">
        <span>${state.apiOnline ? "后端 v4 API 已连接" : "离线同构模式"}</span>
        <button class="primary-btn" id="submitDecision">提交决策</button>
      </div>
    </section>
  `;
}

function renderOption(option) {
  return `
    <button class="decision-option ${selectedOption === option.key ? "active" : ""}" data-option="${esc(option.key)}">
      <div class="option-copy">
        <strong>${esc(option.key)}. ${esc(option.title)}</strong>
        <span>${esc(option.body)}</span>
      </div>
      <div class="option-effect">
        <span class="gain">可能收益：${esc(option.gain)}</span>
        <span class="risk">可能风险：${esc(option.risk)}</span>
      </div>
    </button>
  `;
}

function renderWorldState(view) {
  return `
    <section class="side-panel">
      <h2>当前局势</h2>
      <div class="stat-list">
        ${view.dashboard.worldState.map(([name, value, tone]) => `
          <div class="stat-row">
            <div><span>${esc(name)}</span><strong>${value}/100</strong></div>
            <em><i class="${esc(tone)}" style="width:${Number(value)}%"></i></em>
          </div>
        `).join("")}
      </div>
      <p class="risk-summary">局势总体风险：<b>${overallRisk(view)}</b></p>
    </section>
  `;
}

function renderRelationships(view) {
  return `
    <section class="side-panel relation-panel">
      <h2>人物关系</h2>
      ${view.dashboard.relationships.map((item) => `
        <div class="relation-row">
          <div class="official-portrait small ${esc(item.tone)}"><span>${esc(item.avatar || item.name.slice(0, 1))}</span></div>
          <div><strong>${esc(item.name)}</strong><span>${esc(item.person)}</span></div>
          <b class="${esc(item.tone)}">${esc(item.stance)} ${item.score}</b>
        </div>
      `).join("")}
    </section>
  `;
}

function renderLatestChanges(view) {
  return `
    <section class="side-panel">
      <h2>最新变化</h2>
      <ul class="change-list">
        ${view.dashboard.latestChanges.map(([name, delta]) => `<li>${esc(name)} <b class="${delta >= 0 ? "up" : "down"}">${delta >= 0 ? "↑" : "↓"} ${Math.abs(delta)}</b></li>`).join("")}
      </ul>
    </section>
  `;
}

function renderRisks(view) {
  return `
    <section class="side-panel">
      <h2>潜在风险</h2>
      <ul class="risk-list">
        ${view.dashboard.risks.map(([name, level]) => `<li>${esc(name)} <b>（${esc(level)}）</b></li>`).join("")}
      </ul>
    </section>
  `;
}

function bindEvents() {
  document.querySelectorAll("[data-option]").forEach((node) => {
    node.addEventListener("click", () => {
      selectedOption = node.getAttribute("data-option") || "A";
      state.guard = null;
      customDecision = document.getElementById("customDecision")?.value || customDecision;
      render();
    });
  });
  const custom = document.getElementById("customDecision");
  if (custom) custom.addEventListener("input", (event) => { customDecision = event.target.value; });
  document.getElementById("submitDecision")?.addEventListener("click", submitDecision);
  document.getElementById("advanceBtn")?.addEventListener("click", advanceDay);
  document.getElementById("finalizeBtn")?.addEventListener("click", finalizeRun);
  document.getElementById("resetBtn")?.addEventListener("click", resetRun);
  document.getElementById("resetDecisionBtn")?.addEventListener("click", resetRun);
  document.getElementById("historyBtn")?.addEventListener("click", () => {
    state.error = `历史事件：${state.view.events.map((item) => item.type).join("、") || "尚无记录"}`;
    render();
  });
}

async function submitDecision() {
  const decision = state.view.activeDecision;
  if (!decision) return;
  state.guard = null;
  setBusy(true);
  const payload = { optionKey: selectedOption, customText: customDecision };
  try {
    if (state.apiOnline) {
      const result = await request(`/v4/story-runs/${state.view.run.id}/messages/${decision.messageId}/decisions`, { method: "POST", body: payload });
      if (result.accepted === false) {
        state.guard = result;
      } else {
        state.view = result;
        customDecision = "";
      }
    } else {
      const result = localSubmitDecision(state.view, payload);
      if (result.accepted === false) state.guard = result;
      else state.view = result;
    }
  } catch (error) {
    state.error = error instanceof Error ? error.message : String(error);
  }
  setBusy(false);
  render();
}

async function advanceDay() {
  setBusy(true);
  try {
    state.view = state.apiOnline
      ? await request(`/v4/story-runs/${state.view.run.id}/advance-day`, { method: "POST" })
      : localAdvanceDay(state.view);
    selectedOption = state.view.activeDecision?.options?.[0]?.key || "A";
  } catch (error) {
    state.error = error instanceof Error ? error.message : String(error);
  }
  setBusy(false);
  render();
}

async function finalizeRun() {
  setBusy(true);
  try {
    state.view = state.apiOnline
      ? await request(`/v4/story-runs/${state.view.run.id}/finalize`, { method: "POST" })
      : localFinalize(state.view);
  } catch (error) {
    state.error = error instanceof Error ? error.message : String(error);
  }
  setBusy(false);
  render();
}

async function resetRun() {
  localStorage.removeItem(RUN_ID_KEY);
  fallbackStore.run = null;
  selectedOption = "A";
  customDecision = "";
  await boot();
}

function localSubmitDecision(view, payload) {
  const guard = guardDecision(payload.optionKey, payload.customText);
  if (guard) {
    view.events.push(event("action_guard_blocked", guard));
    return { accepted: false, ...guard };
  }
  const option = payload.optionKey === "CUSTOM"
    ? customOption(payload.customText)
    : view.activeDecision.options.find((item) => item.key === payload.optionKey) || view.activeDecision.options[0];
  applyDecision(view, option);
  return view;
}

function guardDecision(optionKey, text) {
  if (optionKey !== "CUSTOM") return null;
  const raw = String(text || "").trim();
  if (!raw) return { guardStatus: "rewrite_needed", reason: "请先写明你的具体行动。", suggestedRewrite: "例如：另写密奏说明粮价与民心风险，但不拦截巡抚奏疏。" };
  const hit = ["杀", "处死", "命令皇帝", "直接定罪", "所有人立刻", "跳过"].find((item) => raw.includes(item));
  if (hit) return { guardStatus: "blocked", reason: "该决策超出浙江总督的权力边界，不能直接控制他人或宣布结局。", suggestedRewrite: "改写为调查、密奏、施压、交易、保护或留后手。" };
  return null;
}

function customOption(text) {
  return {
    key: "CUSTOM",
    title: "自定义决策",
    body: text,
    gain: "形成非标准计策",
    risk: "成败取决于权力边界",
    patch: inferPatch(text)
  };
}

function inferPatch(text) {
  const patch = { "总督权威": 2, "清算风险": 2 };
  if (text.includes("密奏")) Object.assign(patch, { "皇帝信任": 5, "皇帝疑心": 3, "内阁疑心": 5 });
  if (text.includes("商会") || text.includes("粮")) Object.assign(patch, { "粮价": -6, "商会依赖": 8, "民心": 4 });
  if (text.includes("巡抚")) Object.assign(patch, { "巡抚敌意": 8, "总督权威": 4 });
  return patch;
}

function applyDecision(view, option) {
  const resultText = option.title.includes("追加密奏") || option.body.includes("密奏")
    ? "你没有截留巡抚奏疏，而是连夜起草密奏。奏中写道：浙江可改，然不可躁进。粮价、民心、军饷三事若不并看，十日见银也可能十日见乱。"
    : `你决定执行「${option.title}」。总督府开始按此计策行事，幕僚将影响写入局势账册。`;
  view.messages.push({
    id: uid("result"),
    day: view.run.currentDay,
    time: "决策后",
    type: "decision_result",
    label: "决策结果",
    title: option.title,
    body: `${resultText}\n你的选择已经改变右侧状态，并会转译为其他角色看到的新剧情压力。`
  });
  view.messages.push({
    id: uid("reaction"),
    day: view.run.currentDay,
    time: "夜",
    type: "role_action",
    label: "他人回响",
    speaker: option.title.includes("密奏") ? "司礼监" : "浙江巡抚",
    title: option.title.includes("密奏") ? "两份奏报口径不一" : "巡抚府重新估量总督府",
    body: option.title.includes("密奏") ? "内廷注意到浙江奏报一明一密，开始追问粮价与民心的真实数字。" : "巡抚府连夜誊写文书，试图判断总督府是否准备压下自己的首功。"
  });
  patchDashboard(view, option.patch);
  view.dashboard.latestChanges = Object.entries(option.patch).slice(0, 4).map(([key, value]) => [key, value]);
  view.decisionHistory.push({ day: view.run.currentDay, optionKey: option.key, title: option.title, patch: option.patch });
  view.events.push(event("decision_submitted", { optionKey: option.key, title: option.title, patch: option.patch }));
  view.run.status = "decision_resolved";
  view.run.version += 1;
  view.activeDecision = null;
}

function patchDashboard(view, patch) {
  for (const [key, delta] of Object.entries(patch || {})) {
    const world = view.dashboard.worldState.find((item) => item[0] === key);
    if (world) world[1] = clamp(Number(world[1]) + Number(delta));
    if (Object.hasOwn(view.dashboard.roleState, key)) view.dashboard.roleState[key] = clamp(Number(view.dashboard.roleState[key]) + Number(delta));
  }
  const relationMap = { "巡抚敌意": "浙江巡抚", "商会依赖": "江南商会", "司礼监警惕": "司礼监掌印" };
  for (const [key, name] of Object.entries(relationMap)) {
    if (!Object.hasOwn(patch || {}, key)) continue;
    const rel = view.dashboard.relationships.find((item) => item.name === name);
    if (rel) {
      rel.score = clamp(Number(rel.score) + Number(patch[key]));
      rel.stance = rel.score >= 65 ? (key.includes("敌意") ? "敌对" : "警惕") : rel.stance;
      rel.tone = rel.score >= 65 ? "bad" : rel.tone;
    }
  }
}

function localAdvanceDay(view) {
  view.run.currentDay = Math.min(7, view.run.currentDay + 1);
  view.run.currentTime = "清晨";
  view.run.status = "awaiting_decision";
  view.run.version += 1;
  view.messages.push({
    id: uid("day"),
    day: view.run.currentDay,
    time: "清晨",
    type: "system",
    label: "系统",
    title: view.run.currentDay === 4 ? "暗账浮出" : "局势继续推进",
    body: view.run.currentDay === 4 ? "半页田契暗账浮出水面，商会、巡抚与地方胥吏之间的旧约终于有了线索。" : "昨日选择已经扩散成新的压力，杭州城中各方都在等待总督府下一步。"
  });
  view.activeDecision = {
    messageId: view.messages.at(-1).id,
    title: view.run.currentDay === 4 ? "如何使用暗账" : "如何稳住局势",
    help: "继续选择一个方向推进。",
    options: [
      { key: "A", title: "公开威慑", body: "亮出部分证据压住对方。", gain: "总督权威上升", risk: "对方反扑", patch: { "总督权威": 6, "清算风险": 5 } },
      { key: "B", title: "暂藏证据", body: "只让亲信记录证据链。", gain: "保留后手", risk: "短期无威慑", patch: { "清算风险": -3, "司礼监警惕": 3 } },
      { key: "C", title: "借商会平粮", body: "让商会先放粮换取宽限。", gain: "粮价下降", risk: "商会坐大", patch: { "粮价": -8, "商会依赖": 10 } }
    ]
  };
  view.events.push(event("day_advanced", { day: view.run.currentDay }));
  return view;
}

function localFinalize(view) {
  const trust = Number(view.dashboard.worldState.find((item) => item[0] === "皇帝信任")?.[1] || 0);
  const price = Number(view.dashboard.worldState.find((item) => item[0] === "粮价")?.[1] || 0);
  const risk = Number(view.dashboard.roleState["清算风险"] || 0);
  const good = trust >= 48 && price <= 75 && risk <= 55;
  view.run.currentDay = 7;
  view.run.currentTime = "御前";
  view.run.status = "finished";
  view.activeDecision = null;
  view.messages.push({
    id: uid("final"),
    day: 7,
    time: "御前",
    type: "final",
    label: "最终裁决",
    title: good ? "国策缓行，清弊得名" : "总督稳局，帝心生疑",
    body: good
      ? "你以粮价、民心、军饷三事为据，保住浙江局势，也让皇帝看到浙江不可无你。"
      : "你保住了总督府的解释权，却让内阁与内廷同时记住了你的自保。升迁仍有机会，疑心也随之留下。"
  });
  view.events.push(event("finalized", { good }));
  return view;
}

function setBusy(isBusy) {
  state.loading = false;
  const button = document.getElementById("submitDecision");
  if (button) {
    button.disabled = isBusy;
    button.textContent = isBusy ? "推演中..." : "提交决策";
  }
}

function overallRisk(view) {
  const price = Number(view.dashboard.worldState.find((item) => item[0] === "粮价")?.[1] || 0);
  const suspicion = Number(view.dashboard.worldState.find((item) => item[0] === "皇帝信任")?.[1] || 0);
  const patrol = Number(view.dashboard.relationships.find((item) => item.name === "浙江巡抚")?.score || 0);
  if (price >= 70 || suspicion <= 35 || patrol >= 65) return "高";
  if (price >= 58 || suspicion <= 48 || patrol >= 45) return "中";
  return "低";
}

function clamp(value) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function esc(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

boot();
