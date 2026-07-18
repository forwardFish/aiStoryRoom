import { ApiStoryStorage, StoryApiError, defaultApiBase } from "./api-story-storage.js?v=20260712-3";

const DAY_DECISIONS = 2;
const FINAL_DAY = 7;

export function createStoryApp({
  root,
  window: browserWindow = globalThis.window,
  storage = new ApiStoryStorage({
    baseUrl: defaultApiBase(browserWindow?.location),
    runId: new URL(browserWindow?.location?.href || globalThis.location?.href || "http://localhost/game").searchParams.get("runId") || "",
    fetchImpl: browserWindow?.fetch?.bind(browserWindow),
    localStorage: browserWindow?.localStorage
  }),
  debugBuild = globalThis.__AI_STORY_DEBUG_BUILD__ === true
} = {}) {
  if (!root) throw new TypeError("createStoryApp requires a root element");
  const showOpeningByDefault = !new URL(browserWindow?.location?.href || "http://localhost/game").searchParams.has("debug");

  const state = {
    loading: true,
    busy: false,
    error: "",
    notice: "",
    guard: null,
    view: null,
    selectedOption: "A",
    customText: "",
    maneuverDraft: { maneuverType: "custom", targetRoleKey: "county_magistrate", intentKey: "", leverageKey: "", customText: "" },
    maneuverGuard: null,
    historyOpen: false,
    historyFilter: "all",
    showOpening: showOpeningByDefault,
    messageFilter: "all",
    debugBuild: debugBuild === true,
    resultStream: null,
    resultScroll: { top: 0, follow: true },
    openingStream: null
  };

  let resultTimer = null;
  let resultAdvanceTimer = null;
  let openingTimer = null;
  let openingAdvanceTimer = null;

  async function boot() {
    state.loading = true;
    state.error = "";
    render();
    try {
      const restoredView = await storage.restoreOrCreate();
      acceptView(restoredView);
      if (state.showOpening && isOpeningDecisionState(restoredView)) startOpeningStream(restoredView);
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

  async function refresh({ conflict = false, silent = false } = {}) {
    if (!state.view?.run?.id && !storage.savedRunId) return boot();
    if (!silent) state.busy = true;
    state.error = "";
    if (!silent) render();
    try {
      acceptView(await storage.getRun(state.view?.run?.id || storage.savedRunId));
      if (!silent) state.notice = conflict ? "局势已被其他请求更新，已为你刷新到最新版本。请重新确认这一步。" : "局势已刷新。";
    } catch (error) {
      if (!silent) state.error = errorMessage(error);
    } finally {
      if (!silent) state.busy = false;
      render();
    }
  }

  async function submitDecision() {
    const decision = state.view?.activeDecision;
    const prompt = activePromptForView(state.view);
    if ((!decision && !prompt) || state.busy) return;
    let selected = root.querySelector('input[name="decision"]:checked')?.value || state.selectedOption || "A";
    const customText = root.querySelector("#customDecision")?.value.trim() || state.customText.trim();
    if (customText) selected = "CUSTOM";
    state.selectedOption = selected;
    state.customText = customText;
    state.guard = null;
    state.error = "";
    state.notice = "";
    state.busy = true;
    render();

    try {
      const result = await storage.submitDecision(state.view, {
        messageId: decision?.messageId || prompt.eventId,
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
        if (result.roomSession) state.notice = "你的角色决策已提交，正在等待其他玩家。";
        else startResultStream(result);
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

  async function submitManeuver() {
    if (!state.view || state.busy || Number(state.view.run.currentDay) >= FINAL_DAY) return;
    const draft = {
      ...state.maneuverDraft,
      customText: root.querySelector("#maneuverCustomText")?.value.trim() || state.maneuverDraft.customText.trim()
    };
    if (draft.maneuverType === "custom" && !draft.customText) {
      state.maneuverGuard = { reason: "请先写下你要主动推进的一件事。", suggestedRewrite: "派幕僚暗查驿站登记，确认巡抚急奏的经手人员。" };
      render();
      return;
    }
    state.maneuverDraft = draft;
    state.maneuverGuard = null;
    state.error = "";
    state.notice = "";
    state.busy = true;
    render();
    try {
      const result = await storage.submitManeuver(state.view, draft);
      if (result.accepted === false) {
        state.maneuverGuard = { reason: result.reason || "这项谋划暂时无法执行。", suggestedRewrite: result.rewriteSuggestion || "" };
      } else {
        acceptView(result);
        state.maneuverDraft = { maneuverType: "custom", targetRoleKey: "county_magistrate", intentKey: "", leverageKey: "", customText: "" };
        startManeuverResultStream(result);
      }
    } catch (error) {
      if (isVersionConflict(error)) {
        state.busy = false;
        await refresh({ conflict: true });
        return;
      }
      if (error?.code === "ACTION_BLOCKED") {
        const blocked = error.details?.message && typeof error.details.message === "object" ? error.details.message : error.details;
        state.maneuverGuard = {
          reason: blocked?.reason || error.message || "这项谋划暂时不能执行。",
          suggestedRewrite: blocked?.rewriteSuggestion || ""
        };
      } else {
        state.error = errorMessage(error);
      }
    } finally {
      state.busy = false;
      render();
    }
  }

  async function startCriticalResponse(eventId) {
    if (!eventId || !state.view || state.busy) return;
    state.busy = true;
    state.error = "";
    state.notice = "";
    render();
    try {
      acceptView(await storage.startCriticalResponse(state.view, eventId));
      state.notice = "关键事件已进入回应阶段。";
    } catch (error) {
      state.error = errorMessage(error);
    } finally {
      state.busy = false;
      render();
    }
  }

  async function deferCriticalEvent(eventId) {
    if (!eventId || !state.view || state.busy) return;
    state.busy = true;
    state.error = "";
    state.notice = "";
    render();
    try {
      acceptView(await storage.deferCriticalEvent(state.view, eventId));
      state.notice = "关键事件已暂缓，可在待处理事件中重新打开。";
    } catch (error) {
      state.error = errorMessage(error);
    } finally {
      state.busy = false;
      render();
    }
  }

  function chooseManeuver(maneuverType, targetRoleKey = "", leverageKey = "") {
    state.maneuverGuard = null;
    state.maneuverDraft = {
      ...state.maneuverDraft,
      maneuverType,
      targetRoleKey,
      leverageKey,
      intentKey: "",
      customText: maneuverType === "custom" ? state.maneuverDraft.customText : ""
    };
    render();
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
    if (state.view?.roomSession) {
      browserWindow.location.assign(`/rooms/${encodeURIComponent(state.view.roomSession.room.id)}`);
      return;
    }
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
    stopResultStream();
    stopOpeningStream();
    state.view = view;
    state.guard = null;
    state.selectedOption = activePromptForView(view)?.options?.[0]?.optionKey || view.activeDecision?.options?.[0]?.key || "A";
    state.customText = "";
  }

  async function resolveRoomRound() {
    if (!state.view?.roomSession?.room?.isHost || !state.view.roomSession.allSubmitted || state.busy || typeof storage.resolveRoomRound !== "function") return;
    state.busy = true;
    state.error = "";
    state.notice = "三方决策已齐，AI 正在推演共同结果……";
    render();
    try {
      acceptView(await storage.resolveRoomRound());
      state.notice = state.view?.roomSession?.completed ? "七轮共同决策已经完成。" : "本轮推演完成，下一轮局势已经展开。";
    } catch (error) {
      state.error = errorMessage(error);
      state.notice = "";
    } finally {
      state.busy = false;
      render();
    }
  }

  function startResultStream(view) {
    stopResultStream();
    const text = resultNarrativeText(view);
    state.resultScroll = { top: 0, follow: true };
    state.resultStream = { kind: "decision", title: "", text, index: 0, visibleText: "", done: text.length === 0 };
    if (state.resultStream.done) {
      return;
    }
    if (shouldRevealStreamImmediately(browserWindow)) {
      revealResultStreamImmediately();
      return;
    }
    resultTimer = (browserWindow?.setTimeout || setTimeout).call(browserWindow || globalThis, advanceResultStream, streamDelay(text, 0, browserWindow));
  }

  function startManeuverResultStream(view) {
    stopResultStream();
    const latest = array(view?.messages).filter((message) => message?.type === "maneuver_result").at(-1) || {};
    const text = maneuverNarrativeText(view, latest);
    state.resultScroll = { top: 0, follow: true };
    state.resultStream = { kind: "maneuver", title: String(latest.title || "谋划已展开"), text, index: 0, visibleText: "", done: text.length === 0 };
    if (state.resultStream.done) return;
    if (shouldRevealStreamImmediately(browserWindow)) {
      revealResultStreamImmediately();
      return;
    }
    resultTimer = (browserWindow?.setTimeout || setTimeout).call(browserWindow || globalThis, advanceResultStream, streamDelay(text, 0, browserWindow));
  }

  function startOpeningStream() {
    stopOpeningStream();
    const text = openingNarrativeText();
    state.openingStream = { text, index: 0, visibleText: "", done: text.length === 0 };
    if (state.openingStream.done) {
      scheduleOpeningAdvance();
      return;
    }
    if (shouldRevealStreamImmediately(browserWindow)) {
      state.openingStream.index = text.length;
      state.openingStream.visibleText = text;
      state.openingStream.done = true;
      scheduleOpeningAdvance();
      return;
    }
    openingTimer = (browserWindow?.setTimeout || setTimeout).call(browserWindow || globalThis, advanceOpeningStream, streamDelay(text, 0, browserWindow));
  }

  function advanceOpeningStream() {
    openingTimer = null;
    if (!state.openingStream) return;
    const stream = state.openingStream;
    stream.index = Math.min(stream.text.length, stream.index + 1);
    stream.visibleText = stream.text.slice(0, stream.index);
    stream.done = stream.index >= stream.text.length;
    render();
    if (stream.done) {
      scheduleOpeningAdvance();
      return;
    }
    openingTimer = (browserWindow?.setTimeout || setTimeout).call(browserWindow || globalThis, advanceOpeningStream, streamDelay(stream.text, stream.index, browserWindow));
  }

  function scheduleOpeningAdvance() {
    if (openingAdvanceTimer !== null) return;
    openingAdvanceTimer = (browserWindow?.setTimeout || setTimeout).call(browserWindow || globalThis, () => {
      openingAdvanceTimer = null;
      state.openingStream = null;
      render();
    }, 650);
  }

  function advanceResultStream() {
    resultTimer = null;
    if (!state.resultStream) return;
    const stream = state.resultStream;
    stream.index = Math.min(stream.text.length, stream.index + 1);
    stream.visibleText = stream.text.slice(0, stream.index);
    stream.done = stream.index >= stream.text.length;
    render();
    if (stream.done) {
      return;
    }
    resultTimer = (browserWindow?.setTimeout || setTimeout).call(browserWindow || globalThis, advanceResultStream, streamDelay(stream.text, stream.index, browserWindow));
  }

  function continueResultStory() {
    if (!state.resultStream?.done) return;
    stopResultStream();
    render();
  }

  function revealResultStreamImmediately() {
    if (!state.resultStream) return;
    state.resultStream.index = state.resultStream.text.length;
    state.resultStream.visibleText = state.resultStream.text;
    state.resultStream.done = true;
  }

  function stopResultStream() {
    if (resultTimer !== null) {
      (browserWindow?.clearTimeout || clearTimeout).call(browserWindow || globalThis, resultTimer);
      resultTimer = null;
    }
    if (resultAdvanceTimer !== null) {
      (browserWindow?.clearTimeout || clearTimeout).call(browserWindow || globalThis, resultAdvanceTimer);
      resultAdvanceTimer = null;
    }
    state.resultStream = null;
  }

  function stopOpeningStream() {
    if (openingTimer !== null) {
      (browserWindow?.clearTimeout || clearTimeout).call(browserWindow || globalThis, openingTimer);
      openingTimer = null;
    }
    if (openingAdvanceTimer !== null) {
      (browserWindow?.clearTimeout || clearTimeout).call(browserWindow || globalThis, openingAdvanceTimer);
      openingAdvanceTimer = null;
    }
    state.openingStream = null;
  }

  function rememberResultScroll() {
    const panel = root.querySelector("[data-testid=\"result-narrative\"]");
    if (!panel) return;
    const maxScroll = Math.max(0, panel.scrollHeight - panel.clientHeight);
    state.resultScroll = {
      top: panel.scrollTop,
      follow: panel.scrollTop >= maxScroll - 8
    };
  }

  function restoreResultScroll() {
    const panel = root.querySelector("[data-testid=\"result-narrative\"]");
    if (!panel) return;
    const maxScroll = Math.max(0, panel.scrollHeight - panel.clientHeight);
    panel.scrollTop = state.resultScroll.follow ? maxScroll : Math.min(state.resultScroll.top, maxScroll);
  }

  function render() {
    rememberResultScroll();
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
    const showOpening = state.showOpening && array(view.decisionHistory).length === 0 && Number(view.run.currentDay) === 1;
    const activePrompt = activePromptForView(view);
    const simulating = state.busy && !showOpening;
    const openingPause = showOpening && !state.historyOpen && Boolean(state.openingStream);
    const resultPause = !showOpening && !state.historyOpen && Boolean(state.resultStream);
    const criticalPending = view.criticalEvent?.status === "pending";
    const mainMode = resolveMainMode({
      view,
      state,
      showOpening,
      activePrompt,
      simulating,
      openingPause,
      resultPause,
      criticalPending
    });
    root.innerHTML = `
      <div class="causal-shell" data-testid="story-shell">
        ${renderTopbar(view, state)}
        ${renderStatusStrip(view)}
        <aside class="causal-left" aria-label="玩家信息">
          ${renderPlayer(view.player)}
          ${renderDayMission(view)}
          ${renderResources(view.player)}
          ${renderLeverage(view.player)}
          ${renderRisks(view.dashboard)}
          ${renderCausalRecalls(view)}
        </aside>
        <main class="causal-center ${mainMode === "history" ? "history-center" : ""} ${mainMode === "critical_pending" ? "critical-pending-center" : ""} ${mainMode === "decision" ? "decision-center" : ""}">
          ${mainMode === "history" ? renderHistory(view.decisionHistory, view.messages, state.historyFilter) : mainMode === "simulating" || mainMode === "room_resolving" ? renderSimulation(view, state) : mainMode === "room_waiting" ? renderRoomWaiting(view, state) : mainMode === "room_complete" ? renderRoomComplete(view) : mainMode === "opening_stream" || mainMode === "opening_ready" ? renderOpeningNarrative(view, state) : mainMode === "result_stream" ? renderResultNarrative(view, state) : mainMode === "day_end" ? renderDayEndNarrative(view, state) : mainMode === "final_ready" ? renderFinalReadyNarrative(view, state) : mainMode === "final_judgement" ? renderFinalJudgement(view) : mainMode === "narrative_idle" ? renderNarrativeIdle() : ""}
          ${mainMode === "opening_ready" ? renderOpeningStart() : mainMode === "decision" ? renderDecisionZone(view, state) : ""}
        </main>
        <aside class="causal-right" aria-label="主动谋划中枢">
          ${renderManeuverPanel(view, state)}
          ${view.roomSession ? renderRoomPartyPanel(view, state) : ""}
          ${state.debugBuild ? renderBuildDiagnostics(view) : ""}
        </aside>
        ${renderCriticalEvent(view, state)}
        ${state.error ? renderBanner("error", state.error) : ""}
        ${state.notice ? renderBanner("notice", state.notice) : ""}
      </div>`;
    bindEvents();
    restoreResultScroll();
    root.querySelector(".result-stream-status")?.remove();
    const stream = root.querySelector("#messageStream");
    if (stream && !state.historyOpen) stream.scrollTop = stream.scrollHeight;
  }

  function bindEvents() {
    root.querySelector("#retryBtn")?.addEventListener("click", retry);
    root.querySelector("#beginStoryBtn")?.addEventListener("click", () => { state.showOpening = false; render(); });
    root.querySelector("#continueStoryBtn")?.addEventListener("click", continueResultStory);
    root.querySelector("[data-testid=\"result-narrative\"]")?.addEventListener("scroll", (event) => {
      const panel = event.currentTarget;
      const maxScroll = Math.max(0, panel.scrollHeight - panel.clientHeight);
      state.resultScroll = {
        top: panel.scrollTop,
        follow: panel.scrollTop >= maxScroll - 8
      };
    });
    root.querySelector("#refreshBtn")?.addEventListener("click", () => refresh());
    root.querySelector("#submitDecision")?.addEventListener("click", submitDecision);
    root.querySelector("#maneuverSubmit")?.addEventListener("click", submitManeuver);
    root.querySelector("[data-room-resolve]")?.addEventListener("click", resolveRoomRound);
    root.querySelector("#criticalRespondBtn")?.addEventListener("click", () => startCriticalResponse(root.querySelector("#criticalRespondBtn")?.dataset.eventId));
    root.querySelector("#criticalDeferBtn")?.addEventListener("click", () => deferCriticalEvent(root.querySelector("#criticalDeferBtn")?.dataset.eventId));
    root.querySelector("#criticalDeferIconBtn")?.addEventListener("click", () => deferCriticalEvent(root.querySelector("#criticalDeferIconBtn")?.dataset.eventId));
    root.querySelector("#criticalDeferredOpenBtn")?.addEventListener("click", () => startCriticalResponse(root.querySelector("#criticalDeferredOpenBtn")?.dataset.eventId));
    root.querySelectorAll("[data-maneuver-type]:not([data-maneuver-direct])").forEach((button) => button.addEventListener("click", () => chooseManeuver(button.dataset.maneuverType, button.dataset.targetRole || "", button.dataset.leverageKey || "")));
    root.querySelectorAll("[data-maneuver-direct]").forEach((button) => button.addEventListener("click", () => {
      state.maneuverDraft = { ...state.maneuverDraft, maneuverType: button.dataset.maneuverType, targetRoleKey: button.dataset.targetRole || "", leverageKey: button.dataset.leverageKey || "", intentKey: button.dataset.intentKey || "", customText: "" };
      void submitManeuver();
    }));
    root.querySelector("#maneuverType")?.addEventListener("change", (event) => { state.maneuverDraft.maneuverType = event.target.value; render(); });
    root.querySelector("#maneuverTarget")?.addEventListener("change", (event) => { state.maneuverDraft.targetRoleKey = event.target.value; });
    root.querySelector("#maneuverLeverage")?.addEventListener("change", (event) => { state.maneuverDraft.leverageKey = event.target.value; });
    root.querySelector("#maneuverCustomText")?.addEventListener("input", (event) => { state.maneuverDraft.customText = event.target.value; });
    root.querySelectorAll("#advanceBtn").forEach((button) => button.addEventListener("click", advanceDay));
    root.querySelector("#finalizeBtn")?.addEventListener("click", finalize);
    root.querySelector("#resetBtn")?.addEventListener("click", resetRun);
    root.querySelector("#resetDecisionBtn")?.addEventListener("click", resetRun);
    root.querySelector("#historyBtn")?.addEventListener("click", () => {
      state.historyOpen = true;
      state.historyFilter = "all";
      render();
    });
    root.querySelector("#closeHistoryBtn")?.addEventListener("click", () => {
      state.historyOpen = false;
      render();
    });
    root.querySelectorAll("[data-history-filter]").forEach((button) => button.addEventListener("click", () => {
      state.historyFilter = button.dataset.historyFilter || "all";
      render();
    }));
    root.querySelectorAll("[data-message-filter]").forEach((button) => button.addEventListener("click", () => { state.messageFilter = button.dataset.messageFilter; render(); }));
    root.querySelectorAll('input[name="decision"]').forEach((input) => {
      input.addEventListener("change", () => {
        state.selectedOption = input.value;
      });
    });
    root.querySelector("#customDecision")?.addEventListener("input", (event) => {
      state.customText = event.target.value;
      const counter = root.querySelector("#customDecisionCount");
      if (counter) counter.textContent = `${event.target.value.length}/200`;
    });
  }

  return {
    boot,
    refresh,
    submitDecision,
    advanceDay,
    finalize,
    resolveRoomRound,
    submitManeuver,
    startCriticalResponse,
    deferCriticalEvent,
    chooseManeuver,
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
  const progress = dayProgress(view);
  const maneuver = view.maneuverState || {};
  const roomSession = view.roomSession;
  return `<header class="causal-topbar">
    <div class="mw-brand"><span class="mw-brand-mark">Our Many Worlds</span></div>
    <div class="location-title"><span class="seal-mark">⌂</span><b>杭州总督府 · 内厅</b><span class="chevron">⌄</span></div>
    <div class="top-day">第 ${number(run.currentDay)} 天 · ${esc(run.currentTime || "局势推演中")}</div>
    <div class="top-countdown">距离御前裁决：<b>${Number(run.currentDay) >= FINAL_DAY ? 0 : remaining}</b> 天</div>
    <span class="status-chip">主线决策&nbsp; <b>${activePromptForView(view) ? progress.completed + 1 : progress.completed} / ${progress.required || 2}</b></span>
    <span class="status-chip maneuver-chip">${roomSession ? `三人局&nbsp; <b>${roomSession.submittedRoleIds.length} / ${roomSession.room.players.filter((player) => player.roleId).length}</b>` : `谋划&nbsp; <b>${Number(maneuver.maneuverOpportunitiesRemaining ?? 2)} / ${Number(maneuver.maneuverOpportunitiesPerDay ?? 2)}</b>`}<i></i><i></i></span>
    <div class="top-actions"><button id="historyBtn" type="button">▣&nbsp; 历史回顾</button><button id="resetBtn" type="button" ${state.busy ? "disabled" : ""}>⚙&nbsp; ${view.roomSession ? "房间" : "设置"}</button></div>
  </header>`;
}

function renderStatusStrip(view) {
  const run = view.run;
  const maneuvers = view.maneuverState || {};
  const progress = dayProgress(view);
  const stats = worldEntries(view.dashboard?.worldState);
  const get = (name, fallback) => stats.find(([key]) => key === name)?.[1] ?? fallback;
  return `<div class="status-strip" aria-label="世界状态">
    <span>▰&nbsp; 国库银&nbsp; <b>${esc(get("国库银两", 42))}</b></span>
    <span class="metric-green">♥&nbsp; 民心&nbsp; <b>${esc(get("民心", 55))}</b></span>
    <span class="metric-gold">✦&nbsp; 粮价&nbsp; <b>${esc(get("粮价", 72))}</b></span>
    <span class="metric-green">♣&nbsp; 改桑进度&nbsp; <b>${esc(get("改桑进度", 58))}%</b></span>
    <span class="metric-crown">♛&nbsp; 皇帝信任&nbsp; <b>${esc(get("皇帝信任", 43))}</b></span>
  </div>`;
}

function renderPlayer(player = {}) {
  const portraitClass = "art-game-governor";
  return `<section class="causal-panel player">
    <h2>我的身份</h2>
    <div class="portrait ${portraitClass}" aria-hidden="true" role="img" aria-label="${esc(player.roleName || "浙江总督")}"></div>
    <h3>${esc(player.roleName || "浙江总督")}</h3>
    <p class="player-meta"><strong>${esc(player.name || "郝帅彬")}</strong><span>${esc(player.rank || "从四品")}</span><span>${esc(player.office || "兵部侍郎衔")}</span></p>
    ${player.fateQuestion ? `<em>${esc(player.fateQuestion)}</em>` : ""}
  </section>`;
}

function renderDayMission(view) {
  const goals = array(view.player?.goals);
  return `<section class="causal-panel day-mission">
    <h2>当前目标</h2>
    ${goals.length ? `<ul>${goals.slice(0, 3).map((goal) => `<li>${esc(goal)}</li>`).join("")}</ul>` : `<p>稳定局势，保留证据，并让真正的责任进入可解释的因果链。</p>`}
    <span class="decision-progress sr-only" data-testid="day-progress">${dayProgress(view).completed} / ${dayProgress(view).required}</span>
  </section>`;
}

function renderResources(player = {}) {
  const resources = array(player.resources);
  return `<section class="causal-panel resources-panel"><h2>我的资源</h2>${resources.length
    ? resources.map((item) => {
        const [key, value] = Array.isArray(item) ? item : [item?.name || item?.key, item?.value];
        return `<div class="kv"><span>${esc(key)}</span><b>${esc(value)}</b></div>`;
      }).join("")
    : `<p>暂无可公开资源。</p>`}</section>`;
}

function renderLeverage(player = {}) {
  const leverage = array(player.leverage);
  return `<section class="causal-panel leverage-panel"><h2>我的筹码</h2>${leverage.length ? `<ul>${leverage.map((item) => `<li>${esc(typeof item === "string" ? item : item?.title)}</li>`).join("")}</ul>` : `<p>尚未获得可用筹码。</p>`}</section>`;
}

function renderManeuverPanel(view, state) {
  const maneuver = view.maneuverState || { maneuverOpportunitiesPerDay: 2, maneuverOpportunitiesRemaining: 2 };
  const disabled = Boolean(view.roomSession) || Number(view.run.currentDay) >= FINAL_DAY || Number(maneuver.maneuverOpportunitiesRemaining) <= 0 || state.busy;
  const draft = state.maneuverDraft;
  const contacts = [["county_magistrate", "卢象升", "县令 · 信任", "art-avatar-county"], ["merchant", "江南商会会首", "商会 · 观望", "art-avatar-merchant"], ["xunfu", "刘瑾", "巡抚 · 敌对", "art-avatar-xunfu"], ["sili_jian", "司礼监织造使", "内廷 · 警惕", "art-avatar-sili"]];
  const types = [["contact", "人物交谈"], ["investigate", "派遣调查"], ["leverage", "使用筹码"], ["custom", "自拟谋划"]];
  const investigationChoices = [["inspect_land_register", "核对田亩底册", "让幕僚复核田亩数目，查清改桑名册的来源。"], ["inspect_courier_registry", "查验驿站登记", "追查巡抚催报的往来文书与经手人。"], ["inspect_grain_store", "清点粮仓库存", "核实城中余粮，判断粮价异动的真实压力。"]];
  const leverage = [["田契暗账半页", "land_contract_fragment"], ["清流县令密信", "county_letter"], ["海防军报", "coastal_report"]];
  const activeType = types.find(([key]) => key === draft.maneuverType)?.[1] || "自拟谋划";
  const workbench = draft.maneuverType === "contact"
    ? `<section class="maneuver-workbench maneuver-contact-workbench" data-testid="maneuver-contact-workbench"><div class="maneuver-workbench-head"><span>可接触人物</span><small>选择一人问询</small></div>${contacts.map(([key, name, action, iconClass]) => `<button class="contact-row ${draft.targetRoleKey === key ? "selected" : ""}" type="button" data-maneuver-type="contact" data-maneuver-direct="true" data-maneuver-contact="${key}" data-target-role="${key}" ${disabled ? "disabled" : ""}><span class="contact-avatar ${iconClass}" aria-hidden="true"></span><span><b>${name}</b><small>${action}</small></span><em>问询</em></button>`).join("")}<button class="see-more" type="button">查看全部人物&nbsp;›</button></section>`
    : draft.maneuverType === "investigate"
      ? `<section class="maneuver-workbench maneuver-investigate-workbench" data-testid="maneuver-investigate-workbench"><div class="maneuver-workbench-head"><span>调查方向</span><small>选择一项派遣幕僚</small></div><div class="maneuver-choice-list">${investigationChoices.map(([intentKey, title, description]) => `<button class="maneuver-choice-card" type="button" data-maneuver-type="investigate" data-maneuver-direct="true" data-maneuver-investigation="${intentKey}" data-intent-key="${intentKey}" ${disabled ? "disabled" : ""}><b>${title}</b><small>${description}</small><em>派遣调查</em></button>`).join("")}</div></section>`
      : draft.maneuverType === "leverage"
        ? `<section class="maneuver-workbench maneuver-leverage-workbench" data-testid="maneuver-leverage-workbench"><div class="maneuver-workbench-head"><span>可用筹码</span><small>使用后会留下痕迹</small></div>${leverage.map(([label, key]) => `<div class="leverage-row"><span class="leverage-icon">▣</span><span>${label}</span><button type="button" data-maneuver-type="leverage" data-maneuver-direct="true" data-maneuver-leverage="${key}" data-target-role="merchant" data-leverage-key="${key}" ${disabled ? "disabled" : ""}>使用</button></div>`).join("")}</section>`
        : `<section class="maneuver-workbench maneuver-custom-workbench" data-testid="maneuver-custom-workbench"><div class="maneuver-workbench-head"><span>自拟谋划</span><small>写下你准备推进的一件事</small></div><div class="custom-wrap"><textarea id="maneuverCustomText" maxlength="200" placeholder="输入你的谋划……">${esc(draft.customText || "")}</textarea><span>${String(draft.customText || "").length} / 200</span></div><div class="maneuver-form-row"><button id="maneuverSubmit" type="button" ${disabled ? "disabled" : ""}>执行谋划</button></div>${state.maneuverGuard ? `<div class="maneuver-guard" data-testid="maneuver-guard"><b>这项谋划暂时不能执行</b><p>${esc(state.maneuverGuard.reason)}</p>${state.maneuverGuard.suggestedRewrite ? `<small>建议：${esc(state.maneuverGuard.suggestedRewrite)}</small>` : ""}</div>` : ""}</section>`;
  return `<section class="maneuver-panel" data-testid="maneuver-panel">
    <div class="maneuver-heading"><h2>谋划中枢</h2><button class="help-dot" type="button" title="主动谋划不能替代主线决策">?</button></div>
    <section class="maneuver-usage"><span>今日谋划</span><b>${Number(maneuver.maneuverOpportunitiesRemaining)} / ${Number(maneuver.maneuverOpportunitiesPerDay)}</b><div class="opportunity-dots" aria-label="剩余机会"><i class="${Number(maneuver.maneuverOpportunitiesRemaining) < 2 ? "spent" : ""}"></i><i class="${Number(maneuver.maneuverOpportunitiesRemaining) < 1 ? "spent" : ""}"></i></div><small>剩余机会不结转</small></section>
    <div class="maneuver-type-grid" aria-label="选择谋划类型">${types.map(([key, label]) => `<button type="button" class="${draft.maneuverType === key ? "active" : ""}" data-maneuver-type="${key}" aria-pressed="${draft.maneuverType === key}" ${disabled ? "disabled" : ""}>${label}</button>`).join("")}</div>
    <div class="maneuver-active-label">当前：${activeType}</div>
    ${workbench}
    <details class="maneuver-progress"><summary>正在推进 <span>2 项</span></summary><div class="progress-row"><span>查清巡抚与商会旧约</span><b>1 / 3</b></div><div class="progress-row"><span>稳住杭州粮价</span><b class="danger-text">状态：恶化</b></div></details>
  </section>`;
}

function renderOpeningNarrative(view, state = {}) {
  const title = view.run?.title || "桑田诏：嘉靖财政危局";
  const stream = state.openingStream;
  const narrative = stream ? stream.visibleText : openingNarrativeText();
  return `<section class="opening-narrative" data-testid="role-opening">
    <div class="opening-copy"><p>嘉靖三十五年五月初八</p><p>杭州 · 总督府</p><i></i><h1>${esc(title)}</h1><i></i><p class="opening-stream-copy" aria-live="polite">${lineBreaks(narrative || "……")}${stream && !stream.done ? `<span class="result-caret" aria-hidden="true">▋</span>` : ""}</p></div>
  </section>`;
}

function renderOpeningStart() {
  return `<section class="opening-start" data-testid="decision-zone"><span>前情介绍完毕 · 点击进入今日主线决策</span><button id="beginStoryBtn" type="button">进入局势</button></section>`;
}

function openingNarrativeText() {
  return "杭州粮价已经连续上涨三日。城中米行陆续闭门，百姓开始聚集在粮铺之外。巡抚的奏疏在午前送到总督府，奏疏中将粮价失控归因于江南商会囤积居奇。但你知道，事情远没有这么简单。昨夜送来的密报里，出现了司礼监的名字。粮价、商会、巡抚、京中势力，所有线索都指向同一个问题：杭州，恐怕已不再只是地方粮局之乱。现在，你必须在这盘棋局落定之前，找到第一步该落子的方向。";
}

function renderDecisionNarrative() {
  return `<section class="decision-narrative"><div class="decision-copy"><p>巡抚的奏疏已经摆在案前。</p><p>奏疏中并未否认杭州粮价失控，却将责任全部指向江南商会。</p><p>若这份奏疏送入京师，皇帝将先看到巡抚的一面之词。</p><p>现在，你必须作出决定。</p></div></section>`;
}

function renderSimulation(view, state) {
  const prompt = activePromptForView(view);
  const selected = array(prompt?.options).find((item) => item.optionKey === state.selectedOption || item.key === state.selectedOption);
  return `<section class="simulation-stage" data-testid="ai-simulating"><div class="simulation-copy"><span>你的决定</span><h1>${esc(selected?.title || "正在写入局势")}</h1><p>你的行动正在被写入角色关系、资源与后续事件的因果链。</p><div class="simulation-seal">推演<br/>中</div><h2>AI 正在推演局势……</h2><small>推演结果将影响后续事件走向</small></div></section>`;
}

function renderResultNarrative(view, state = {}) {
  const card = view.dashboard?.visibleCausalCard || view.visibleCausalCard || {};
  if (activePromptForView(view)?.promptKind === "critical_response") {
    return `<section class="result-narrative critical-response-narrative"><div class="result-copy"><h1>一封没有署名的密报</h1><p>傍晚，巡抚派来的差役抵达府门。他没有进入正厅，只将一封没有署名的密报交给了你的亲信。</p><p>密报中准确写出了商会账本被扣留的时间，甚至提到了只有你和两名幕僚知道的暗格位置。</p><p>有人正在把你推向巡抚的对立面。</p></div></section>`;
  }
  const stream = state.resultStream;
  const narrative = stream ? stream.visibleText : resultNarrativeText(view);
  const continueMarkup = stream?.done ? `<div class="result-continue"><button id="continueStoryBtn" type="button">继续</button></div>` : "";
  return `<section class="result-narrative" data-testid="result-narrative"><div class="result-copy"><h1>${esc(stream?.title || card.decisionTitle || "巡抚素色入府")}</h1><p class="result-stream-copy" aria-live="polite">${lineBreaks(narrative || "……")}${stream && !stream.done ? `<span class="result-caret" aria-hidden="true">▋</span>` : ""}</p></div>${continueMarkup}</section>`;
}

function renderDayEndNarrative(view, state = {}) {
  const summary = latestDaySummary(view) || {};
  const decisions = array(summary.playerKeyDecisions || summary.keyDecisions).map((item) => typeof item === "string" ? item : item?.summary || item?.title).filter(Boolean);
  const pressures = textItems(summary.riskForTomorrow ?? summary.tomorrowRisks ?? summary.tomorrowPressure);
  return `<section class="result-narrative day-end-narrative" data-testid="day-end-narrative"><div class="result-copy"><h1>第 ${number(summary.day || view.run?.currentDay)} 天 · 日终</h1><p>${esc(summary.publicSummary || summary.summary || "今日的选择已经汇入局势。")}</p>${decisions.length ? `<p><b>今日记下：</b>${decisions.map(esc).join("、")}</p>` : ""}${pressures.length ? `<p><b>明日压力：</b>${pressures.map(esc).join("、")}</p>` : ""}</div><div class="result-continue"><button id="advanceBtn" type="button" ${state.busy ? "disabled" : ""}>${state.busy ? "正在推演……" : "进入下一天"}</button></div></section>`;
}

function renderFinalReadyNarrative(view, state = {}) {
  return `<section class="result-narrative final-ready-narrative" data-testid="final-ready-narrative"><div class="result-copy"><h1>御前裁决在即</h1><p>你已经完成本局所有主线决策。证据、责任和各方关系将一并进入最终裁决。</p></div><div class="result-continue"><button id="finalizeBtn" type="button" ${state.busy ? "disabled" : ""}>${state.busy ? "正在裁决……" : "进入御前裁决"}</button></div></section>`;
}

function renderNarrativeIdle() {
  return `<section class="result-narrative narrative-idle"><div class="result-copy"><h1>局势暂歇</h1><p>新的剧情正在整理中。请刷新后继续阅读。</p></div><div class="result-continue"><button id="refreshBtn" type="button">刷新局势</button></div></section>`;
}

function renderRoomWaiting(view, state = {}) {
  const session = view.roomSession || {};
  const submitted = new Set(session.submittedRoleIds || []);
  const total = session.room?.players?.filter((player) => player.roleId).length || 0;
  return `<section class="result-narrative room-waiting-narrative" data-testid="room-waiting"><div class="result-copy"><span class="room-formal-kicker">第 ${number(session.round)} 轮 · 共同故事局</span><h1>你的决策已经送达</h1><p>你的行动已写入本轮共同局势。系统正在等待其他角色分别作出决定；三方行动汇合后，房主才能开始本轮推演。</p><div class="room-waiting-progress"><b>${submitted.size} / ${total}</b><span>名玩家已完成本轮决策</span></div>${session.room?.isHost && session.allSubmitted ? `<button class="room-formal-resolve" type="button" data-room-resolve ${state.busy ? "disabled" : ""}>${state.busy ? "AI 正在推演……" : "推演本轮共同结果"}</button>` : `<small>其他玩家完成后，本页面会自动更新。</small>`}</div></section>`;
}

function renderRoomComplete(view) {
  const roomId = view.roomSession?.room?.id || view.run?.id;
  return `<section class="result-narrative room-waiting-narrative" data-testid="room-complete"><div class="result-copy"><span class="room-formal-kicker">七轮共同决策已经完成</span><h1>御前裁决已经落定</h1><p>三名玩家的选择已经汇入同一条因果链。现在可以查看共同结局，以及你的角色在嘉靖财政危局中留下的影响。</p><a class="room-formal-result" href="/game/result?runId=${encodeURIComponent(roomId)}">查看共同结局</a></div></section>`;
}

function renderRoomPartyPanel(view, state = {}) {
  const session = view.roomSession || {};
  const room = session.room || {};
  const submitted = new Set(session.submittedRoleIds || []);
  const players = array(room.players).filter((player) => player.roleId);
  return `<section class="maneuver-panel room-formal-party" data-testid="room-party-panel"><div class="maneuver-heading"><h2>共同故事局</h2><span class="room-formal-live"><i></i>实时同步</span></div><div class="room-formal-party-list">${players.map((player) => `<article class="${submitted.has(player.roleId) ? "submitted" : ""}"><div><b>${esc(player.nickname)}</b><small>${esc(player.roleName || "玩家角色")}</small></div><em>${submitted.has(player.roleId) ? "已决策" : session.resolving ? "推演中" : "思考中"}</em></article>`).join("")}</div>${room.isHost ? `<button class="room-party-resolve" type="button" data-room-resolve ${!session.allSubmitted || session.resolving || state.busy ? "disabled" : ""}>${session.resolving || state.busy ? "AI 推演中……" : session.allSubmitted ? "推演本轮共同结果" : "等待全部玩家决策"}</button>` : `<p class="room-party-help">房主会在全部玩家提交后推进共同回合。</p>`}</section>`;
}

function resultNarrativeText(view) {
  const card = view?.dashboard?.visibleCausalCard || view?.visibleCausalCard || {};
  const messages = array(view?.messages);
  const resultIndex = messages.map((message) => message?.type).lastIndexOf("decision_result");
  const resultMessage = resultIndex >= 0 ? messages[resultIndex] : null;
  const roleActions = resultIndex >= 0
    ? messages.slice(resultIndex + 1).filter((message) => message?.type === "role_action" && isPublicVisibility(message?.visibility))
    : [];
  const roleActionBodies = new Set(roleActions.map((message) => String(message?.body || "").trim()).filter(Boolean));
  const otherEchoes = publicEchoes(card.othersEcho).filter((echo) => !roleActionBodies.has(String(echo).trim()));
  const seen = new Set();
  const unique = (value) => {
    const text = String(value || "").trim();
    if (!text || seen.has(text)) return "";
    seen.add(text);
    return text;
  };
  const sections = [
    unique(resultMessage?.body),
    unique(card.playerFacingHint),
    unique(card.personalEcho) ? `你的判断\n${String(card.personalEcho).trim()}` : "",
    otherEchoes.length ? `各方动向\n${otherEchoes.map(unique).filter(Boolean).join("\n")}` : "",
    unique(card.worldEcho) ? `局势走向\n${String(card.worldEcho).trim()}` : "",
    array(card.tracesLeft).length ? `留下的线索\n${array(card.tracesLeft).join("、")}` : "",
    ...roleActions.map((message) => {
      const body = unique(message.body);
      if (!body) return "";
      const meta = [message.speaker, message.day ? `第${message.day}天` : ""].filter(Boolean).join(" · ");
      return `人物动向${meta ? `\n${meta}` : ""}${message.title ? `\n${message.title}` : ""}\n${body}`;
    })
  ].filter(Boolean);
  return sections.join("\n\n");
}

function maneuverNarrativeText(view, maneuver = {}) {
  const traces = array(view?.dashboard?.traces).map((item) => typeof item === "string" ? item : item?.title).filter(Boolean).slice(-2);
  return [
    String(maneuver.body || "你的谋划已经开始改变局势。"),
    traces.length ? `留下的线索\n${traces.join("、")}` : ""
  ].filter(Boolean).join("\n\n");
}

function resolveMainMode({ view, state, showOpening, activePrompt, simulating, openingPause, resultPause, criticalPending }) {
  if (state.historyOpen) return "history";
  if (simulating) return "simulating";
  if (view?.roomSession?.completed) return "room_complete";
  if (view?.roomSession?.resolving) return "room_resolving";
  if (view?.roomSession?.ownSubmitted) return "room_waiting";
  if (view?.run?.status === "finished") return "final_judgement";
  if (openingPause) return "opening_stream";
  if (resultPause) return "result_stream";
  if (showOpening) return "opening_ready";
  if (criticalPending) return "critical_pending";
  if (activePrompt) return "decision";
  if (canAdvance(view)) return "day_end";
  if (canFinalize(view)) return "final_ready";
  return "narrative_idle";
}

function isOpeningDecisionState(view) {
  return Boolean(view?.run) && Number(view.run.currentDay) === 1 && array(view.decisionHistory).length === 0;
}

function renderMessageStream(messages = [], state = {}) {
  const visibleMessages = array(messages).filter(isPublicMessage);
  const filter = state.messageFilter || "all";
  const filteredMessages = filter === "all" ? visibleMessages : visibleMessages.filter((message) => message.type === filter || (filter === "private" && message.type === "private_intel"));
  const tabs = [["all", "全部"], ["system", "系统"], ["private", "密信"], ["private_intel", "私讯"], ["role_action", "角色行动"], ["decision_result", "回响"]];
  return `<section class="stream-panel">
    <div class="stream-head"><div><h1>局势消息流</h1><p>每个角色的行动，都会变成你必须应对的新压力。</p></div><span>${visibleMessages.length} 条局势</span></div>
    <div class="stream-tabs" role="tablist">${tabs.map(([key, label]) => `<button type="button" data-message-filter="${key}" class="${filter === key ? "active" : ""}">${label}</button>`).join("")}</div>
    <div class="causal-stream" id="messageStream" aria-live="polite">${filteredMessages.slice(-5).map(renderMessage).join("") || `<p class="empty-stream">当前筛选下暂无消息。</p>`}</div>
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
      ${definition("你的判断", card.personalEcho)}
      ${definition("各方动向", publicEchoes(card.othersEcho).join("；"))}
      ${definition("局势走向", card.worldEcho)}
      ${definition("留下的线索", array(card.tracesLeft).join("、"))}
    </dl>
  </div>`;
}

function renderDecisionZone(view, state) {
  const run = view.run;
  if (run.status === "finished") return renderFinalJudgement(view);

  const progress = dayProgress(view);
  const prompt = activePromptForView(view);
  if (prompt) {
    const decision = view.activeDecision || { messageId: prompt.eventId, title: prompt.prompt, options: prompt.options };
    const options = array(prompt.options || decision.options).map((option) => ({ ...option, key: option.key || option.optionKey, title: option.title || option.label || option.optionKey })).filter((option) => /^[A-Z]$/.test(option?.key || ""));
    const selected = state.selectedOption === "CUSTOM" || options.some((option) => option.key === state.selectedOption) ? state.selectedOption : options[0]?.key;
    const customLabel = nextOptionLabel(options);
    const openingDecision = isOpeningDecisionState(view);
    const storyDecision = openingDecision || array(view.decisionHistory).length > 0 || prompt?.promptKind === "critical_response";
    return renderDecisionComposer({ view, state, prompt, decision, options, selected, customLabel, progress, openingDecision, storyDecision });
  }

  return "";
}

function renderOptionV12(option, checked) {
  return `<label class="option-card key-${esc(option.key)}"><input type="radio" name="decision" value="${esc(option.key)}" ${checked ? "checked" : ""}/><span class="option-key">${esc(option.key)}</span><span class="option-copy"><b>${esc(option.title)}</b></span></label>`;
}

// 共通决策提交组件：主线决策、关键事件响应和后续新增决策都复用这一套结构。
function renderDecisionComposer({ view, state, prompt, decision, options, selected, customLabel, progress, openingDecision, storyDecision }) {
  return `<section class="decision-zone decision-composer ${storyDecision ? "story-decision" : ""} ${openingDecision ? "opening-decision" : ""}" data-testid="decision-zone" aria-label="提交决策">
    <div class="decision-zone-head"><span class="decision-kicker">今日主线决策&nbsp; ${progress.completed + 1} / ${progress.required}</span><h2>你要如何应对？</h2><span>当前事件：${esc(decision.title)}&nbsp; ?</span></div>
    <div class="options" role="radiogroup" aria-label="决策选项">${options.map((option) => renderOptionV12(option, option.key === selected)).join("")}
      <label class="option-card decision-custom-option custom key-D"><input type="radio" name="decision" value="CUSTOM" ${selected === "CUSTOM" ? "checked" : ""}/><span class="option-key">${esc(customLabel)}</span><span class="option-copy"><b>自定义决策</b><span>你可以拟定自己的策略，系统会先校验身份、资源、时代与当前阶段。</span></span><small class="custom-label-text">${esc(customLabel)}. 自定义决策</small></label>
    </div>
    <div class="custom-decision-label">你也可以写下自己的决定：</div>
    <div class="custom-decision-input"><textarea id="customDecision" ${state.busy ? "disabled" : ""} maxlength="200" placeholder="输入你的处理方式……" aria-label="自定义处理方式">${esc(state.customText)}</textarea><span id="customDecisionCount">${String(state.customText || "").length}/200</span></div>
    ${state.guard ? `<div class="guard-result" data-testid="guard-error"><b>这一步暂时无法执行</b><p>${esc(state.guard.reason)}</p>${state.guard.suggestedRewrite ? `<p>可改为：${esc(state.guard.suggestedRewrite)}</p>` : ""}</div>` : ""}
    <div class="actions"><span>确认后会写入因果账本，无法撤回。</span><button id="submitDecision" type="button" ${state.busy || options.length === 0 ? "disabled" : ""}><i aria-hidden="true">✦</i><b>${state.busy ? "正在推演……" : "提交决策"}</b><i aria-hidden="true">✦</i></button></div>
  </section>`;
}

function renderOption(option, checked) {
  return `<label class="option-card key-${esc(option.key)}"><input type="radio" name="decision" value="${esc(option.key)}" ${checked ? "checked" : ""}/><span class="option-key">${esc(option.key)}</span><span class="option-copy"><b>${esc(option.title)}</b><span>${esc(option.body)}</span><small>可能影响：${esc(option.gain || "局势将有所变化")}${option.risk ? ` ｜ 风险：${esc(option.risk)}` : ""}</small></span></label>`;
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
  if (!card) return `<section class="causal-panel emphasis"><h2>局势记录</h2><p>完成关键决策后，这里只展示你能看到的判断、各方动向与局势走向。后台触发条件与角色私密判断不会在此出现。</p></section>`;
  return `<section class="causal-panel emphasis" data-testid="causal-card"><h2>因果回响</h2><h3>${esc(card.decisionTitle)}</h3>
    <p>${esc(card.decisionSummary || card.playerFacingHint)}</p><dl>
      ${definition("你的判断", card.personalEcho)}
      ${definition("各方动向", publicEchoes(card.othersEcho).join("；"))}
      ${definition("局势走向", card.worldEcho)}
      ${definition("留下的线索", array(card.tracesLeft).join("、"))}
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

function renderHistory(history = [], messages = [], activeFilter = "all") {
  const decisionItems = array(history).map((item, index) => ({
    kind: "decision", day: item.day, decisionIndex: item.decisionIndex || ((index % DAY_DECISIONS) + 1),
    title: item.title || item.decisionTitle || item.optionKey, summary: item.summary || item.result || "该决定已写入局势因果链，将在后续推演中持续生效。"
  }));
  const messageKinds = { maneuver_result: "maneuver", role_action: "impact", causal_visible: "world", causal_recall: "impact", day_summary: "world" };
  const messageItems = array(messages).filter((message) => messageKinds[message.type]).map((message) => ({
    kind: messageKinds[message.type], day: message.day, title: message.title, summary: message.body || message.label || "局势出现新的可见变化。"
  }));
  const items = [...decisionItems, ...messageItems].filter((item) => activeFilter === "all" || item.kind === activeFilter).sort((a, b) => Number(b.day || 0) - Number(a.day || 0));
  return `<section class="history-drawer" role="dialog" aria-modal="true" aria-label="局势记录" data-testid="history-drawer">
    <header class="history-head"><div><span>STORY LEDGER</span><h2>局势记录</h2></div><button id="closeHistoryBtn" type="button" aria-label="关闭局势记录">×</button></header>
    <div class="history-filters" role="tablist"><button class="${activeFilter === "all" ? "active" : ""}" type="button" data-history-filter="all">全部</button><button class="${activeFilter === "decision" ? "active" : ""}" type="button" data-history-filter="decision">主线决策</button><button class="${activeFilter === "maneuver" ? "active" : ""}" type="button" data-history-filter="maneuver">主动谋划</button><button class="${activeFilter === "impact" ? "active" : ""}" type="button" data-history-filter="impact">他人影响</button><button class="${activeFilter === "world" ? "active" : ""}" type="button" data-history-filter="world">局势变化</button></div>
    <div class="history-list">${items.length ? items.map((item, index) => `<article><span>第 ${number(item.day)} 天 · 第 ${number(item.decisionIndex || ((index % DAY_DECISIONS) + 1))} 策</span><b>${esc(item.title || item.decisionTitle || item.optionKey)}</b><p>${esc(item.summary || item.result || "该决定已写入局势因果链，将在后续推演中持续生效。")}</p></article>`).join("") : `<p class="history-empty">尚未作出关键决策。完成任一决策后，这里会保留你的选择及其后续影响。</p>`}</div>
  </section>`;
}

function renderBanner(kind, message) {
  return `<div class="api-banner ${kind}" role="status" data-testid="${kind}-banner">${esc(message)}</div>`;
}

export function dayProgress(view) {
  if (!view?.run) return { completed: 0, required: DAY_DECISIONS };
  if (view.roomSession) return { completed: view.roomSession.ownSubmitted ? 1 : 0, required: 1 };
  const day = Number(view.run.currentDay || 1);
  if (day >= FINAL_DAY) return { completed: 0, required: 0 };
  const serverProgress = view.dayProgress || view.run.dayProgress;
  const completed = serverProgress?.completed ?? view.run.decisionsCompletedToday ?? array(view.decisionHistory).filter((item) => Number(item.day) === day).length;
  const required = serverProgress?.required ?? view.run.decisionsRequiredToday ?? DAY_DECISIONS;
  return { completed: Math.max(0, number(completed)), required: Math.max(DAY_DECISIONS, number(required)) };
}

export function canAdvance(view) {
  if (!view?.run || activePromptForView(view)) return false;
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
  if (!view?.run || activePromptForView(view)) return false;
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

function renderCriticalEvent(view, state) {
  const active = record(view.criticalEvent);
  if (active && active.status === "pending") {
    return `<div class="critical-backdrop" role="dialog" aria-modal="true" aria-label="关键事件">
      <section class="critical-modal"><button id="criticalDeferIconBtn" class="critical-close" type="button" aria-label="暂缓处理" data-event-id="${esc(active.eventId)}" ${state.busy ? "disabled" : ""}>×</button><span class="critical-kicker">重要事件发生</span><h2>${esc(active.title)}</h2><p>${esc(active.summary)}</p><div class="critical-actions"><button id="criticalDeferBtn" type="button" data-event-id="${esc(active.eventId)}" ${state.busy ? "disabled" : ""}>稍后处理</button><button id="criticalRespondBtn" type="button" data-event-id="${esc(active.eventId)}" ${state.busy ? "disabled" : ""}>立即处理</button></div></section>
    </div>`;
  }
  if (!active) {
    const deferred = array(view.pendingCriticalEvents).find((item) => item?.status === "deferred");
    if (deferred) return `<div class="critical-deferred" role="status"><span>待处理关键事件：${esc(deferred.title)}</span><button id="criticalDeferredOpenBtn" type="button" data-event-id="${esc(deferred.eventId)}" ${state.busy ? "disabled" : ""}>打开处理</button></div>`;
  }
  return "";
}

function activePromptForView(view) {
  if (!view) return null;
  if (view.activePrompt) return view.activePrompt;
  const decision = view.activeDecision;
  if (!decision) return null;
  return {
    eventId: decision.messageId,
    promptKind: "main_decision",
    prompt: decision.title,
    options: array(decision.options).map((option) => ({ optionKey: option.key, title: option.title })),
    maxLength: 200,
    submitLabel: "提交决策"
  };
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
  // Decision prompts belong to the decision zone, not the situation stream.
  // Keeping them out of the five-card window lets the stream show the full
  // day-three reference sequence: system, private intel, role action, and hint.
  const allowedTypes = new Set(["system", "system_hint", "private_intel", "role_action", "decision_result", "maneuver_result", "causal_visible", "causal_recall", "day_end", "day_summary", "final"]);
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
  return ({ system: "系统", system_hint: "系统提示", private_intel: "密信", role_action: "角色行动", decision_result: "你的决定", maneuver_result: "主动谋划", causal_visible: "因果回响", causal_recall: "因果回溯", day_summary: "日终回响", final: "最终裁决" })[type] || "局势";
}

function errorMessage(error) {
  if (error instanceof StoryApiError) return error.message;
  return error instanceof Error ? error.message : String(error || "发生未知错误。");
}

function isVersionConflict(error) {
  return Boolean(error && error.code === "VERSION_CONFLICT");
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

function shouldRevealStreamImmediately(browserWindow) {
  return Number(browserWindow?.__STORY_STREAM_DELAY_MULTIPLIER__) === 0;
}

function streamDelay(text, index, browserWindow) {
  const previous = String(text || "")[Math.max(0, index - 1)] || "";
  const multiplier = Number(browserWindow?.__STORY_STREAM_DELAY_MULTIPLIER__ ?? 1);
  const safeMultiplier = Number.isFinite(multiplier) && multiplier >= 0 ? multiplier : 1;
  return (/[。！？；：，、,.!?;:]/.test(previous) ? 220 : 88) * safeMultiplier;
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
