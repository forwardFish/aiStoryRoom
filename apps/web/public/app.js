import { ApiStoryStorage, StoryApiError, defaultApiBase } from "./api-story-storage.js";

const DAY_DECISIONS = 2;
const FINAL_DAY = 7;

export function createStoryApp({
  root,
  window: browserWindow = globalThis.window,
  storage = new ApiStoryStorage({
    baseUrl: defaultApiBase(browserWindow?.location),
    fetchImpl: browserWindow?.fetch?.bind(browserWindow),
    localStorage: browserWindow?.localStorage
  }),
  debugBuild = globalThis.__AI_STORY_DEBUG_BUILD__ === true
} = {}) {
  if (!root) throw new TypeError("createStoryApp requires a root element");

  const state = {
    loading: true,
    busy: false,
    error: "",
    notice: "",
    guard: null,
    view: null,
    selectedOption: "A",
    customText: "",
    historyOpen: false,
    debugBuild: debugBuild === true
  };

  async function boot() {
    state.loading = true;
    state.error = "";
    render();
    try {
      acceptView(await storage.restoreOrCreate());
    } catch (error) {
      state.error = errorMessage(error);
    } finally {
      state.loading = false;
      render();
    }
  }

  async function retry() {
    await boot();
  }

  async function refresh({ conflict = false } = {}) {
    if (!state.view?.run?.id && !storage.savedRunId) return boot();
    state.busy = true;
    state.error = "";
    render();
    try {
      acceptView(await storage.getRun(state.view?.run?.id || storage.savedRunId));
      state.notice = conflict ? "局势已被其他请求更新，已为你刷新到最新版本。请重新确认这一步。" : "局势已刷新。";
    } catch (error) {
      state.error = errorMessage(error);
    } finally {
      state.busy = false;
      render();
    }
  }

  async function submitDecision() {
    const decision = state.view?.activeDecision;
    if (!decision || state.busy) return;
    const selected = root.querySelector('input[name="decision"]:checked')?.value || state.selectedOption || "A";
    const customText = root.querySelector("#customDecision")?.value.trim() || state.customText.trim();
    state.selectedOption = selected;
    state.customText = customText;
    state.guard = null;
    state.error = "";
    state.notice = "";
    state.busy = true;
    render();

    try {
      const result = await storage.submitDecision(state.view, {
        messageId: decision.messageId,
        optionKey: selected,
        customText
      });
      if (result.accepted === false) {
        state.guard = {
          reason: result.reason || "这一步暂时无法执行，请调整行动方式。",
          suggestedRewrite: result.suggestedRewrite || ""
        };
      } else {
        acceptView(result);
        state.notice = "决策已落账。它会改变其他角色接下来看到的局势。";
      }
    } catch (error) {
      if (isVersionConflict(error)) {
        state.busy = false;
        await refresh({ conflict: true });
        return;
      }
      state.error = errorMessage(error);
    } finally {
      state.busy = false;
      render();
    }
  }

  async function advanceDay() {
    if (!canAdvance(state.view) || state.busy) return;
    await mutate((view) => storage.advanceDay(view), "新一天的局势已经展开。");
  }

  async function finalize() {
    if (!canFinalize(state.view) || state.busy) return;
    await mutate((view) => storage.finalize(view), "御前裁决已经落定。");
  }

  async function resetRun() {
    if (state.busy) return;
    if (browserWindow?.confirm && !browserWindow.confirm("确定重开《桑田诏》吗？当前故事局仍会保留在服务端。")) return;
    state.busy = true;
    state.error = "";
    state.notice = "";
    state.guard = null;
    render();
    try {
      acceptView(await storage.createRun());
      state.notice = "新故事局已创建。";
    } catch (error) {
      state.error = errorMessage(error);
    } finally {
      state.busy = false;
      render();
    }
  }

  async function mutate(operation, successNotice) {
    state.busy = true;
    state.error = "";
    state.notice = "";
    render();
    try {
      acceptView(await operation(state.view));
      state.notice = successNotice;
    } catch (error) {
      if (isVersionConflict(error)) {
        state.busy = false;
        await refresh({ conflict: true });
        return;
      }
      state.error = errorMessage(error);
    } finally {
      state.busy = false;
      render();
    }
  }

  function acceptView(view) {
    state.view = view;
    state.guard = null;
    state.selectedOption = view.activeDecision?.options?.[0]?.key || "A";
    state.customText = "";
  }

  function render() {
    root.className = "causal-player-root";
    if (state.loading) {
      root.innerHTML = renderLoading("正在读取总督府局势……");
      return;
    }
    if (!state.view) {
      root.innerHTML = renderFatalError(state.error || "暂时无法读取故事局。", state.busy);
      bindEvents();
      return;
    }

    const view = state.view;
    root.innerHTML = `
      <div class="causal-shell" data-testid="story-shell">
        ${renderTopbar(view, state)}
        <aside class="causal-left" aria-label="玩家信息">
          ${renderPlayer(view.player)}
          ${renderDayMission(view)}
          ${renderResources(view.player)}
          ${renderLeverage(view.player)}
        </aside>
        <main class="causal-center">
          ${renderMessageStream(view.messages)}
          ${renderDecisionZone(view, state)}
        </main>
        <aside class="causal-right" aria-label="局势与因果">
          ${renderWorldState(view.dashboard)}
          ${renderVisibleCausal(view)}
          ${renderCausalRecalls(view)}
          ${renderTraces(view.dashboard)}
          ${renderRelationships(view.dashboard)}
          ${renderRisks(view.dashboard)}
          ${renderPublicRoleInferences(view)}
          ${state.debugBuild ? renderBuildDiagnostics(view) : ""}
        </aside>
        ${state.historyOpen ? renderHistory(view.decisionHistory) : ""}
        ${state.error ? renderBanner("error", state.error) : ""}
        ${!state.error && state.notice ? renderBanner("notice", state.notice) : ""}
      </div>`;
    bindEvents();
    const stream = root.querySelector("#messageStream");
    if (stream && !state.historyOpen) stream.scrollTop = stream.scrollHeight;
  }

  function bindEvents() {
    root.querySelector("#retryBtn")?.addEventListener("click", retry);
    root.querySelector("#refreshBtn")?.addEventListener("click", () => refresh());
    root.querySelector("#submitDecision")?.addEventListener("click", submitDecision);
    root.querySelector("#advanceBtn")?.addEventListener("click", advanceDay);
    root.querySelector("#finalizeBtn")?.addEventListener("click", finalize);
    root.querySelector("#resetBtn")?.addEventListener("click", resetRun);
    root.querySelector("#resetDecisionBtn")?.addEventListener("click", resetRun);
    root.querySelector("#historyBtn")?.addEventListener("click", () => {
      state.historyOpen = true;
      render();
    });
    root.querySelector("#closeHistoryBtn")?.addEventListener("click", () => {
      state.historyOpen = false;
      render();
    });
    root.querySelectorAll('input[name="decision"]').forEach((input) => {
      input.addEventListener("change", () => {
        state.selectedOption = input.value;
        root.querySelector("#customDecision")?.toggleAttribute("disabled", input.value !== "CUSTOM");
      });
    });
    root.querySelector("#customDecision")?.addEventListener("input", (event) => {
      state.customText = event.target.value;
    });
  }

  return {
    boot,
    refresh,
    submitDecision,
    advanceDay,
    finalize,
    resetRun,
    render,
    getState: () => state
  };
}

function renderLoading(text) {
  return `<section class="boot-screen" data-testid="loading"><div class="seal">桑田诏</div><p>${esc(text)}</p></section>`;
}

function renderFatalError(message, busy) {
  return `<section class="boot-screen boot-error" data-testid="fatal-error"><div class="seal">桑田诏</div><h1>剧情服务暂不可用</h1><p>${esc(message)}</p><div class="boot-actions"><button id="retryBtn" ${busy ? "disabled" : ""}>重新连接</button><button id="resetBtn" ${busy ? "disabled" : ""}>明确重开新局</button></div><small>本页面不会用本地预制剧情冒充服务端推演，也不会在恢复失败时静默替换故事局。</small></section>`;
}

function renderTopbar(view, state) {
  const run = view.run;
  const remaining = Math.max(0, Number(run.totalDays || FINAL_DAY) - Number(run.currentDay));
  return `<header class="causal-topbar">
    <div><b>${esc(run.title || "桑田诏：嘉靖财政危局")}</b><span>${esc(run.location || "杭州总督府")}</span></div>
    <div>第 ${number(run.currentDay)} 天 · ${esc(run.currentTime || "局势推演中")}</div>
    <div>${Number(run.currentDay) >= FINAL_DAY ? "御前裁决之日" : `距离御前裁决 <b>${remaining}</b> 天`}</div>
    <div class="top-actions"><button id="historyBtn" type="button">回顾</button><button id="resetBtn" type="button" ${state.busy ? "disabled" : ""}>重开</button></div>
  </header>`;
}

function renderPlayer(player = {}) {
  const goals = array(player.goals);
  return `<section class="causal-panel player">
    <h2>我的身份</h2>
    <div class="portrait" aria-hidden="true">督</div>
    <h3>${esc(player.roleName || "浙江总督")}</h3>
    <p>${esc([player.name, player.rank, player.office].filter(Boolean).join(" · "))}</p>
    ${player.fateQuestion ? `<em>${esc(player.fateQuestion)}</em>` : ""}
    ${goals.length ? `<h4>本局目标</h4><ul>${goals.map((goal) => `<li>${esc(goal)}</li>`).join("")}</ul>` : ""}
  </section>`;
}

function renderDayMission(view) {
  const progress = dayProgress(view);
  if (Number(view.run.currentDay) >= FINAL_DAY) {
    return `<section class="causal-panel day-mission"><h2>第七日</h2><p>今日不再新增决策。此前十二次选择，将在御前被重新串成一条因果链。</p></section>`;
  }
  return `<section class="causal-panel day-mission">
    <h2>今日关键决策</h2>
    <div class="decision-progress" data-testid="day-progress"><b>${progress.completed}</b><span>/ ${progress.required}</span></div>
    <p>每天严格两次关键决策。两次都落账后，才能进入下一天。</p>
  </section>`;
}

function renderResources(player = {}) {
  const resources = array(player.resources);
  return `<section class="causal-panel"><h2>我的资源</h2>${resources.length
    ? resources.map((item) => {
        const [key, value] = Array.isArray(item) ? item : [item?.name || item?.key, item?.value];
        return `<div class="kv"><span>${esc(key)}</span><b>${esc(value)}</b></div>`;
      }).join("")
    : `<p>暂无可公开资源。</p>`}</section>`;
}

function renderLeverage(player = {}) {
  const leverage = array(player.leverage);
  return `<section class="causal-panel"><h2>我的筹码</h2>${leverage.length ? `<ul>${leverage.map((item) => `<li>${esc(typeof item === "string" ? item : item?.title)}</li>`).join("")}</ul>` : `<p>尚未获得可用筹码。</p>`}</section>`;
}

function renderMessageStream(messages = []) {
  const visibleMessages = array(messages).filter(isPublicMessage);
  return `<section class="stream-panel">
    <div class="stream-head"><div><h1>局势消息流</h1><p>每个角色的行动，都会变成你必须应对的新压力。</p></div><span>${visibleMessages.length} 条局势</span></div>
    <div class="causal-stream" id="messageStream" aria-live="polite">${visibleMessages.map(renderMessage).join("")}</div>
  </section>`;
}

function renderMessage(message) {
  const causal = message.causalCard ? renderMiniCausal(message.causalCard) : "";
  return `<article class="story-card ${className(message.type)}" data-message-id="${esc(message.id)}">
    <div class="meta"><b>${esc(message.label || labelForType(message.type))}</b>${message.speaker ? `<span>${esc(message.speaker)}</span>` : ""}<span>第${number(message.day)}天 ${esc(message.time)}</span></div>
    <h3>${esc(message.title)}</h3>
    ${causal || `<p>${lineBreaks(message.body)}</p>`}
  </article>`;
}

function renderMiniCausal(card = {}) {
  return `<div class="mini-causal">
    ${card.decisionSummary ? `<p>${esc(card.decisionSummary)}</p>` : ""}
    <dl>
      ${definition("个人回响", card.personalEcho)}
      ${definition("他人回响", publicEchoes(card.othersEcho).join("；"))}
      ${definition("世界回响", card.worldEcho)}
      ${definition("留下痕迹", array(card.tracesLeft).join("、"))}
    </dl>
  </div>`;
}

function renderDecisionZone(view, state) {
  const run = view.run;
  if (run.status === "finished") return renderFinalJudgement(view);

  const progress = dayProgress(view);
  if (view.activeDecision) {
    const decision = view.activeDecision;
    const options = array(decision.options).filter((option) => /^[A-Z]$/.test(option?.key || ""));
    const selected = state.selectedOption === "CUSTOM" || options.some((option) => option.key === state.selectedOption) ? state.selectedOption : options[0]?.key;
    const customLabel = nextOptionLabel(options);
    return `<section class="decision-zone" data-testid="decision-zone">
      <div class="decision-zone-head"><div><h2>第 ${progress.completed + 1} 个关键决策</h2><p>${esc(decision.title)}</p></div><span>${progress.completed + 1} / ${progress.required}</span></div>
      ${decision.help ? `<p class="decision-help">${esc(decision.help)}</p>` : ""}
      <div class="options">${options.map((option) => renderOption(option, option.key === selected)).join("")}
        <label class="option-card custom"><input type="radio" name="decision" value="CUSTOM" ${selected === "CUSTOM" ? "checked" : ""}/><b>${esc(customLabel)}. 自定义决策</b><span>你可以拟定自己的策略，系统会先校验身份、资源、时代与当前阶段。</span></label>
      </div>
      <textarea id="customDecision" ${selected === "CUSTOM" ? "" : "disabled"} maxlength="500" placeholder="例如：不拦巡抚急奏，但另写密奏，并请县令整理粮价证据。">${esc(state.customText)}</textarea>
      ${state.guard ? `<div class="guard-result" data-testid="guard-error"><b>这一步暂时无法执行</b><p>${esc(state.guard.reason)}</p>${state.guard.suggestedRewrite ? `<p>可改为：${esc(state.guard.suggestedRewrite)}</p>` : ""}</div>` : ""}
      <div class="actions"><span>确认后会写入因果账本，无法撤回。</span><button id="submitDecision" type="button" ${state.busy || options.length === 0 ? "disabled" : ""}>${state.busy ? "正在推演……" : "确认此策"}</button></div>
    </section>`;
  }

  if (canAdvance(view)) {
    return `<section class="decision-zone complete" data-testid="day-complete">
      ${renderDaySummary(latestDaySummary(view))}
      <div class="day-next"><div><h2>今日两次决策均已落账</h2><p>日终回响已经生成。进入下一天后，旧选择可能在新条件下带来帮助或反噬。</p></div><button id="advanceBtn" type="button" ${state.busy ? "disabled" : ""}>${state.busy ? "正在推演……" : "进入下一天"}</button></div>
    </section>`;
  }

  if (canFinalize(view)) {
    return `<section class="decision-zone final-ready" data-testid="final-ready"><div><h2>十二次选择，等待御前裁决</h2><p>第七日不再新增决策。皇帝会依据证据、责任、角色定性与世界局势作出最终判断。</p></div><button id="finalizeBtn" type="button" ${state.busy ? "disabled" : ""}>${state.busy ? "正在裁决……" : "进入御前裁决"}</button></section>`;
  }

  return `<section class="decision-zone complete"><div class="day-next"><div><h2>正在等待下一段局势</h2><p>当前服务端没有返回可执行决策。刷新可重新读取最新 StoryRun。</p></div><button id="refreshBtn" type="button" ${state.busy ? "disabled" : ""}>刷新局势</button></div></section>`;
}

function renderOption(option, checked) {
  return `<label class="option-card"><input type="radio" name="decision" value="${esc(option.key)}" ${checked ? "checked" : ""}/><b>${esc(option.key)}. ${esc(option.title)}</b><span>${esc(option.body)}</span><small>收益：${esc(option.gain || "局势变化")}${option.risk ? ` ｜ 风险：${esc(option.risk)}` : ""}</small></label>`;
}

function renderDaySummary(summary) {
  if (!summary) return `<div class="day-summary"><h3>日终回响</h3><p>今日选择已经汇入局势，新的压力正在形成。</p></div>`;
  const decisions = array(summary.playerKeyDecisions || summary.keyDecisions).map((item) => typeof item === "string" ? item : item?.summary || item?.title).filter(Boolean);
  const risks = textItems(summary.riskForTomorrow ?? summary.tomorrowRisks ?? summary.tomorrowPressure);
  return `<div class="day-summary" data-testid="day-summary"><h3>第 ${number(summary.day)} 天 · 日终回响</h3><p>${esc(summary.publicSummary || summary.summary || "今日局势已经收束。")}</p>${decisions.length ? `<p><b>你的关键选择：</b>${decisions.map(esc).join("、")}</p>` : ""}${risks.length ? `<p><b>明日压力：</b>${risks.map(esc).join("、")}</p>` : ""}</div>`;
}

function renderFinalJudgement(view) {
  const final = normalizeFinal(view);
  if (!final.valid) {
    return `<section class="decision-zone final-data-error" data-testid="final-data-error"><h2>最终裁决数据不完整</h2><p>${esc(final.error)}</p><button id="refreshBtn" type="button">重新读取裁决</button></section>`;
  }
  return `<section class="decision-zone final-judgement" data-testid="final-judgement">
    <div class="final-seal">裁</div><p class="final-kicker">御前裁决 · 第七日</p><h2>${esc(final.title)}</h2>
    ${final.globalOutcome ? `<p class="final-global">${esc(final.globalOutcome)}</p>` : ""}
    <div class="final-grid">
      <article><h3>个人结局 · ${esc(final.tier)}</h3>${final.personalTitle ? `<b class="personal-ending-title">${esc(final.personalTitle)}</b>` : ""}${final.archetype ? `<small class="ending-archetype">命运原型：${esc(final.archetype)}</small>` : ""}<p>${esc(final.personalStory)}</p></article>
      ${final.emperorComment ? `<article><h3>皇帝评语</h3><p>${esc(final.emperorComment)}</p></article>` : ""}
      ${final.futureRipple ? `<article><h3>未来余波</h3><p>${esc(final.futureRipple)}</p></article>` : ""}
    </div>
    ${final.saved.length ? `<div class="judgement-list good"><b>救你的几步</b><ul>${final.saved.map((item) => `<li>${esc(item)}</li>`).join("")}</ul></div>` : ""}
    ${final.hurt.length ? `<div class="judgement-list bad"><b>害你的几步</b><ul>${final.hurt.map((item) => `<li>${esc(item)}</li>`).join("")}</ul></div>` : ""}
    ${final.debt ? `<p class="fate-debt"><b>命运债：</b>${esc(final.debt)}</p>` : ""}
    <button id="resetDecisionBtn" type="button">重开一局</button>
  </section>`;
}

function renderWorldState(dashboard = {}) {
  const entries = worldEntries(dashboard.worldState);
  return `<section class="causal-panel"><h2>世界状态</h2>${entries.length ? entries.map(([key, value]) => {
    const score = clamp(value);
    return `<div class="bar-row"><div><span>${esc(key)}</span><b>${score}/100</b></div><em><i style="width:${score}%"></i></em></div>`;
  }).join("") : `<p>局势数据正在汇总。</p>`}</section>`;
}

function renderVisibleCausal(view) {
  const card = view.dashboard?.visibleCausalCard || view.visibleCausalCard;
  if (!card) return `<section class="causal-panel emphasis"><h2>因果回响</h2><p>完成关键决策后，这里只展示玩家可见的个人、他人和世界回响。后台触发条件与角色私密判断不会在此出现。</p></section>`;
  return `<section class="causal-panel emphasis" data-testid="causal-card"><h2>因果回响</h2><h3>${esc(card.decisionTitle)}</h3>
    <p>${esc(card.decisionSummary || card.playerFacingHint)}</p><dl>
      ${definition("个人回响", card.personalEcho)}
      ${definition("他人回响", publicEchoes(card.othersEcho).join("；"))}
      ${definition("世界回响", card.worldEcho)}
      ${definition("状态变化", array(card.stateChangesText).join("；"))}
      ${definition("留下痕迹", array(card.tracesLeft).join("、"))}
      ${definition("潜在风险", array(card.potentialRisks).join("；"))}
    </dl></section>`;
}

function renderCausalRecalls(view) {
  const recalls = array(view.dashboard?.causalRecallMessages || view.causalRecallMessages)
    .filter((recall) => isPublicVisibility(recall?.visibility))
    .slice(-3);
  if (!recalls.length) return "";
  return `<section class="causal-panel recall" data-testid="causal-recall"><h2>因果回溯</h2>${recalls.map((recall) => `<article><b>${esc(recall.title)}</b>${recall.activation ? `<span class="activation ${className(recall.activation)}">${recall.activation === "help" ? "正在帮助你" : recall.activation === "backfire" ? "正在反噬你" : esc(recall.activation)}</span>` : ""}<p>${esc(recall.recallText)}</p>${recall.reframedBy ? `<p>被 ${esc(recall.reframedBy)} 重新解释</p>` : ""}${recall.newFrame ? `<p>新的定性：${esc(recall.newFrame)}</p>` : ""}${recall.currentPressure ? `<p>当前压力：${esc(recall.currentPressure)}</p>` : ""}</article>`).join("")}</section>`;
}

function renderTraces(dashboard = {}) {
  const traces = array(dashboard.traces);
  return `<section class="causal-panel"><h2>留下的痕迹</h2>${traces.length ? `<ul>${traces.map((trace) => `<li>${esc(typeof trace === "string" ? trace : trace?.title)}</li>`).join("")}</ul>` : `<p>还没有形成玩家可见的因果痕迹。</p>`}</section>`;
}

function renderRelationships(dashboard = {}) {
  const relationships = array(dashboard.relationships);
  return `<section class="causal-panel"><h2>人物关系</h2>${relationships.length ? relationships.map((item) => `<div class="rel"><div><b>${esc(item.name)}</b>${item.person ? `<small>${esc(item.person)}</small>` : ""}</div><span>${esc(item.stance)} ${number(item.score)}</span></div>`).join("") : `<p>人物关系尚未公开。</p>`}</section>`;
}

function renderRisks(dashboard = {}) {
  const risks = array(dashboard.risks);
  if (!risks.length) return "";
  return `<section class="causal-panel"><h2>当前风险</h2>${risks.map((item) => {
    const [name, level] = Array.isArray(item) ? item : [item?.name || item?.title, item?.level];
    return `<div class="kv"><span>${esc(name)}</span><b class="risk-${className(level)}">${esc(level)}</b></div>`;
  }).join("")}</section>`;
}

function renderPublicRoleInferences(view) {
  const roles = array(view.publicRoleInferences || view.dashboard?.publicRoleInferences);
  if (!roles.length) return "";
  return `<section class="causal-panel"><h2>可见角色判断</h2>${roles.map((role) => `<details><summary>${esc(role.publicIdentity || role.name)}</summary>${role.publicGoal ? `<p>公开目标：${esc(role.publicGoal)}</p>` : ""}${array(role.observableSignals || role.observable).length ? `<p>你能观察到：${array(role.observableSignals || role.observable).map(esc).join("、")}</p>` : ""}</details>`).join("")}</section>`;
}

function renderBuildDiagnostics(view) {
  // This switch can only be injected by the build; URL query parameters are
  // intentionally ignored. Diagnostics remain metadata-only and never dump
  // private causal ledgers or model reasoning.
  return `<section class="causal-panel build-debug"><h2>构建诊断</h2><div class="kv"><span>Run</span><b>${esc(view.run.id)}</b></div><div class="kv"><span>Version</span><b>${number(view.run.version)}</b></div></section>`;
}

function renderHistory(history = []) {
  const items = array(history);
  return `<div class="history-backdrop" role="dialog" aria-modal="true" aria-label="决策回顾"><section class="history-panel"><div class="history-head"><h2>十二步决策回顾</h2><button id="closeHistoryBtn" type="button">关闭</button></div>${items.length ? `<ol>${items.map((item, index) => `<li><span>第 ${number(item.day)} 天 · 第 ${number(item.decisionIndex || ((index % DAY_DECISIONS) + 1))} 策</span><b>${esc(item.title || item.decisionTitle || item.optionKey)}</b></li>`).join("")}</ol>` : `<p>尚未作出关键决策。</p>`}</section></div>`;
}

function renderBanner(kind, message) {
  return `<div class="api-banner ${kind}" role="status" data-testid="${kind}-banner">${esc(message)}</div>`;
}

export function dayProgress(view) {
  if (!view?.run) return { completed: 0, required: DAY_DECISIONS };
  const day = Number(view.run.currentDay || 1);
  if (day >= FINAL_DAY) return { completed: 0, required: 0 };
  const serverProgress = view.dayProgress || view.run.dayProgress;
  const completed = serverProgress?.completed ?? view.run.decisionsCompletedToday ?? array(view.decisionHistory).filter((item) => Number(item.day) === day).length;
  const required = serverProgress?.required ?? view.run.decisionsRequiredToday ?? DAY_DECISIONS;
  return { completed: Math.max(0, number(completed)), required: Math.max(DAY_DECISIONS, number(required)) };
}

export function canAdvance(view) {
  if (!view?.run || view.activeDecision) return false;
  const day = Number(view.run.currentDay);
  const progress = dayProgress(view);
  return day >= 1
    && day < FINAL_DAY
    && view.run.status === "awaiting_day_advance"
    && Boolean(view.daySummary)
    && progress.completed === DAY_DECISIONS
    && progress.required === DAY_DECISIONS;
}

export function canFinalize(view) {
  if (!view?.run || view.activeDecision) return false;
  return Number(view.run.currentDay) === FINAL_DAY
    && view.run.status === "awaiting_finalization"
    && Number(view.run.totalDecisionsCompleted) === 12;
}

function latestDaySummary(view) {
  if (view.daySummary) return view.daySummary;
  const summaries = view.daySummaries;
  if (Array.isArray(summaries)) return summaries[summaries.length - 1] || null;
  if (summaries && typeof summaries === "object") return summaries[view.run.currentDay] || Object.values(summaries).at(-1) || null;
  return null;
}

function normalizeFinal(view) {
  const final = record(view.finalJudgement);
  if (!final) return { valid: false, error: "服务端没有返回 finalJudgement，无法可靠展示本局结局。" };
  const globalEnding = record(final.globalEnding);
  const personal = record(final.personalEnding) || record(final.personalOutcome) || record(final.playerOutcome) || record(final.personalStoryCard);
  if (!globalEnding?.title || !personal) {
    return { valid: false, error: "finalJudgement 缺少 globalEnding 或 personalEnding。" };
  }
  const imperial = record(final.emperorJudgement) || record(final.imperialJudgement);
  const causal = record(final.causalExplanation);
  const personalFuture = personal.futureAftermath ?? personal.futureRipple;
  const finalFuture = final.futureAftermath ?? final.futureRipple ?? final.aftershock;
  const futureRipple = textItems(personalFuture ?? finalFuture).join("；");
  const personalStory = personal.narrative || personal.story || personal.summary || derivedPersonalStory(personal, futureRipple);
  if (!personalStory) {
    return { valid: false, error: "personalEnding 缺少 narrative、title、archetype 与 futureAftermath，无法形成个人故事卡。" };
  }
  return {
    valid: true,
    title: globalEnding.title,
    globalOutcome: globalEnding.narrative || globalEnding.summary || "",
    tier: personal.rank || personal.grade || personal.tier || personal.level || "未评级",
    personalTitle: personal.title || "",
    archetype: personal.archetype || "",
    personalStory,
    emperorComment: personal.emperorComment || imperial?.comment || imperial?.narrative || imperial?.summary || final.emperorComment || final.imperialComment || "",
    futureRipple,
    saved: textItems(final.keyMovesThatSavedYou ?? causal?.keyMovesThatSavedYou ?? final.savedBy),
    hurt: textItems(final.keyMovesThatHurtYou ?? causal?.keyMovesThatHurtYou ?? final.hurtBy),
    debt: textItems(final.fateDebts ?? final.fateDebt ?? causal?.fateDebts ?? causal?.fateDebt ?? final.destinyDebt).join("；")
  };
}

function derivedPersonalStory(personal, futureRipple) {
  const identity = [personal.title ? `个人定性为「${personal.title}」` : "", personal.archetype ? `命运原型为「${personal.archetype}」` : ""].filter(Boolean).join("，");
  return [identity, futureRipple ? `其后续余波是：${futureRipple}` : ""].filter(Boolean).join("；");
}

function textItems(value) {
  if (value === undefined || value === null || value === "") return [];
  const items = Array.isArray(value) ? value : [value];
  return items.map((item) => {
    if (typeof item === "string" || typeof item === "number") return String(item);
    return item?.text || item?.narrative || item?.summary || item?.title || item?.description || "";
  }).filter(Boolean);
}

function record(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function worldEntries(worldState) {
  if (Array.isArray(worldState)) return worldState.map((item) => [item?.[0], item?.[1]]).filter(([key]) => key);
  if (worldState && typeof worldState === "object") return Object.entries(worldState);
  return [];
}

function publicEchoes(echoes) {
  return array(echoes).filter((echo) => typeof echo === "string" || isPublicVisibility(echo?.visibility)).map((echo) => typeof echo === "string" ? echo : echo?.text).filter(Boolean);
}

function nextOptionLabel(options) {
  const highest = options.reduce((result, option) => Math.max(result, String(option.key || "A").charCodeAt(0)), "A".charCodeAt(0) - 1);
  return highest < "Z".charCodeAt(0) ? String.fromCharCode(highest + 1) : "自";
}

function isPublicMessage(message) {
  const allowedTypes = new Set(["system", "decision", "decision_prompt", "system_hint", "private_intel", "role_action", "decision_result", "causal_visible", "causal_recall", "day_end", "day_summary", "final"]);
  return allowedTypes.has(message?.type) && isPublicVisibility(message?.visibility);
}

function isPublicVisibility(visibility) {
  return visibility === undefined || visibility === null || visibility === "public" || visibility === "player_visible";
}

function definition(term, value) {
  if (value === undefined || value === null || value === "" || (Array.isArray(value) && !value.length)) return "";
  return `<dt>${esc(term)}</dt><dd>${esc(Array.isArray(value) ? value.join("；") : value)}</dd>`;
}

function labelForType(type) {
  return ({ system: "系统", private_intel: "密报", role_action: "角色行动", decision_result: "你的决定", causal_visible: "因果回响", causal_recall: "因果回溯", day_summary: "日终回响", final: "最终裁决" })[type] || "局势";
}

function errorMessage(error) {
  if (error instanceof StoryApiError) return error.message;
  return error instanceof Error ? error.message : String(error || "发生未知错误。");
}

function isVersionConflict(error) {
  return error instanceof StoryApiError && error.code === "VERSION_CONFLICT";
}

function array(value) {
  return Array.isArray(value) ? value : [];
}

function number(value) {
  const result = Number(value);
  return Number.isFinite(result) ? Math.round(result) : 0;
}

function clamp(value) {
  return Math.max(0, Math.min(100, number(value)));
}

function className(value) {
  return String(value || "normal").replace(/[^a-zA-Z0-9_-]/g, "");
}

function lineBreaks(value) {
  return esc(value).replace(/\n/g, "<br/>");
}

function esc(value) {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

if (typeof window !== "undefined" && typeof document !== "undefined" && !window.__AI_STORY_DISABLE_AUTO_BOOT__) {
  const root = document.getElementById("app");
  if (root) createStoryApp({ root, window }).boot();
}
