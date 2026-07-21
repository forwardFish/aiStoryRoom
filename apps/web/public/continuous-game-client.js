import { renderContinuousGame } from "./continuous-game-view.js?v=20260717-reaction-context";

const SCHEMA = "continuous_game_projection_v1";

export function createContinuousGameApp({ root, window: win = globalThis.window, runId, initialProjection, fetchImpl = win?.fetch?.bind(win), navigate = (url) => win?.location?.assign?.(url) } = {}) {
  if (!root || !runId || typeof fetchImpl !== "function") throw new TypeError("continuous game app requires root, runId and fetch");
  const presence = loadPresence(win, runId, initialProjection?.player?.userId);
  const state = { projection: null, result: null, busy: false, error: "", notice: "", connected: false, selectedMain: "", selectedManeuver: "", mainDraftContext: null, maneuverDraftContext: null, afterDeliverySequence: Number(presence.lastAppliedDeliverySequence || 0), events: [], destroyed: false, accessFailure: "", creditRequired: null, sponsorshipRequests: [] };
  let streamAbort, streamRetryTimer, heartbeatTimer, refreshTimer, noticeTimer;

  async function request(path, options = {}) {
    const response = await fetchImpl(path, { ...options, credentials: "include", headers: { accept: "application/json", ...(options.body ? { "content-type": "application/json" } : {}), ...(options.headers || {}) } });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(payload.message || payload.code || `请求失败（HTTP ${response.status}）`);
      Object.assign(error, payload, { code: payload.code, status: response.status, retryAfterMs: payload.retryAfterMs });
      throw error;
    }
    return payload;
  }

  function applyProjection(incoming, initial = false) {
    if (incoming?.schemaVersion !== SCHEMA) throw new Error("游戏投影版本不受支持，请返回房间重新进入");
    const revision = Number(incoming.projectionRevision || 0);
    const delivery = Number(incoming.appliedThroughDeliverySequence || 0);
    if (!Number.isSafeInteger(revision) || revision < 1 || !Number.isSafeInteger(delivery) || delivery < 0) {
      throw new Error("房间同步版本无效，请刷新后重试");
    }
    if (initial && !state.projection && delivery < state.afterDeliverySequence) {
      // The server projection is authoritative. A stale local cursor must not
      // keep a returning player on cached private state from an older session.
      state.afterDeliverySequence = 0;
      presence.lastAppliedDeliverySequence = 0;
    }
    const current = state.projection;
    if (delivery < state.afterDeliverySequence) return false;
    if (current) {
      const currentRevision = Number(current.projectionRevision);
      const currentDelivery = Number(current.appliedThroughDeliverySequence);
      if (revision < currentRevision || delivery < currentDelivery) return false;
      if (revision === currentRevision && delivery === currentDelivery) {
        return false;
      }
    }
    const mainDraft = activeDraft("MAIN");
    const maneuverDraft = activeDraft("MANEUVER");

    state.projection = incoming;
    state.afterDeliverySequence = delivery;
    presence.lastAppliedDeliverySequence = delivery;
    applyDraft("MAIN", mainDraft, incoming);
    applyDraft("MANEUVER", maneuverDraft, incoming);
    savePresence(win, runId, incoming.player.userId, presence);
    return true;
  }

  function activeDraft(slot) {
    const selected = slot === "MAIN" ? state.selectedMain : state.selectedManeuver;
    const context = slot === "MAIN" ? state.mainDraftContext : state.maneuverDraftContext;
    if (selected && context) return { ...context, actionKey: selected };
    return loadDraft(win, runId, slot);
  }

  function applyDraft(slot, draft, incoming) {
    const isMain = slot === "MAIN";
    const actions = isMain ? incoming.availableMainActions : incoming.availableManeuvers;
    const participant = incoming.actionWindow?.myParticipant;
    // A peer delivery can momentarily expose an intermediate window status
    // while this participant's own slot is still open.  The local draft is
    // owned by the participant slot, not by that transient shared status.
    // Keep it fenced by window/role/control epoch and only discard it after
    // the participant slot itself is sealed (or the context really changes).
    const participantSlotOpen = isMain
      ? participant?.mainStatus === "PENDING"
      : participant?.maneuverStatus === "AVAILABLE";
    const sameContext = draft
      && draft.runId === runId
      && draft.windowId === incoming.actionWindow?.id
      && draft.roleId === incoming.player?.roleId
      && draft.controlEpoch === incoming.myControl?.epoch;
    const humanCanStillSubmit = ["HUMAN_ACTIVE", "HUMAN_OFFLINE_GRACE"].includes(incoming.myControl?.mode);
    const keyStillAllowed = draft && (actions.length === 0 || actions.some((item) => item.actionKey === draft.actionKey));
    if (sameContext && participantSlotOpen && humanCanStillSubmit && keyStillAllowed) {
      if (isMain) {
        state.selectedMain = draft.actionKey;
        state.mainDraftContext = draft;
      } else {
        state.selectedManeuver = draft.actionKey;
        state.maneuverDraftContext = draft;
      }
      saveDraft(win, runId, slot, draft);
      return;
    }
    clearDraft(slot);
  }

  function selectDraft(slot, actionKey) {
    const p = state.projection;
    const draft = {
      runId,
      windowId: p.actionWindow?.id,
      roleId: p.player?.roleId,
      controlEpoch: p.myControl?.epoch,
      actionKey
    };
    if (slot === "MAIN") {
      state.selectedMain = actionKey;
      state.mainDraftContext = draft;
    } else {
      state.selectedManeuver = actionKey;
      state.maneuverDraftContext = draft;
    }
    saveDraft(win, runId, slot, draft);
    render();
  }

  function clearDraft(slot) {
    if (slot === "MAIN") {
      state.selectedMain = "";
      state.mainDraftContext = null;
    } else {
      state.selectedManeuver = "";
      state.maneuverDraftContext = null;
    }
    removeDraft(win, runId, slot);
  }

  async function boot() {
    if (!applyProjection(initialProjection || await request(`/api/v4/rooms/${encodeURIComponent(runId)}/game`), true)) throw new Error("无法应用初始房间投影");
    render(); startHeartbeat(); startEvents(); void refreshSponsorshipRequests();
    refreshTimer = win.setInterval(() => void refresh(true), 8_000);
    win.addEventListener("pagehide", destroy, { once: true });
    if (win.location.pathname === "/game/result" || state.projection.resultReady) await loadResult();
    return api;
  }

  function destroy() {
    state.destroyed = true;
    if (heartbeatTimer) win.clearTimeout(heartbeatTimer);
    if (refreshTimer) win.clearInterval(refreshTimer);
    if (noticeTimer) win.clearTimeout(noticeTimer);
    streamAbort?.abort?.();
    if (streamRetryTimer) win.clearTimeout(streamRetryTimer);
  }

  async function refresh(silent = false) {
    if (state.destroyed) return;
    try {
      const projection = await request(`/api/v4/rooms/${encodeURIComponent(runId)}/game`);
      if (applyProjection(projection) || !silent) render();
      void refreshSponsorshipRequests();
      if (projection.resultReady) await loadResult();
    } catch (error) { if (!handleAccessFailure(error) && !silent) showError(error); }
  }

  async function command(path, body, success) {
    if (state.busy) return;
    state.busy = true; state.error = ""; render();
    try {
      const response = await request(path, { method: "POST", body: JSON.stringify(body) });
      if (response.gameProjection && !applyProjection(response.gameProjection)) await refresh(true);
      state.notice = success; clearNoticeLater();
    } catch (error) {
      if (handleAccessFailure(error)) return;
      if (isCreditRequired(error)) {
        clearDraft("MAIN"); clearDraft("MANEUVER");
        state.creditRequired = error;
        await refresh(true);
        return;
      }
      if (["WINDOW_MOVED", "WINDOW_CLOSED", "SLOT_SEALED", "ROLE_CONTROL_CHANGED"].includes(error.code)) { await refresh(true); state.notice = "局势刚刚变化，已刷新到最新状态"; }
      else state.error = friendlyError(error);
    } finally { state.busy = false; render(); }
  }

  function key(prefix) { const p = state.projection; return `${prefix}:${p.actionWindow?.id || p.run.runId}:${p.player.roleId}:${p.myControl.epoch}:${uuid()}`; }
  function slotBody(actionKey, prefix) { const p = state.projection; return { idempotencyKey: key(prefix), windowId: p.actionWindow.id, controlEpoch: p.myControl.epoch, actionKey }; }
  function layoutBody(prefix) { const p = state.projection; return { idempotencyKey: key(prefix), windowId: p.actionWindow.id, controlEpoch: p.myControl.epoch }; }

  function submitMain() {
    const action = state.projection.availableMainActions.find((item) => item.actionKey === state.selectedMain);
    if (action) return command(`/api/v4/rooms/${encodeURIComponent(runId)}/game/actions/main`, slotBody(action.actionKey, "main"), "主线决策已密封；你仍可在交互阶段继续谋划");
  }
  function submitManeuver() {
    const action = state.projection.availableManeuvers.find((item) => item.actionKey === state.selectedManeuver);
    if (action) return command(`/api/v4/rooms/${encodeURIComponent(runId)}/game/actions/maneuver`, slotBody(action.actionKey, "maneuver"), "谋划已密封并写入共同局势");
  }
  function submitReaction(actionKey) {
    const reaction = state.projection.pendingReaction;
    if (reaction) return command(`/api/v4/rooms/${encodeURIComponent(runId)}/game/events/${encodeURIComponent(reaction.eventId)}/reaction`, slotBody(actionKey, "reaction"), "回应已送达，其他角色只会看到获准公开的结果");
  }
  function finishLayout(leave = false) { return command(`/api/v4/rooms/${encodeURIComponent(runId)}/game/layout/${leave ? "leave-stage" : "done"}`, layoutBody(leave ? "leave" : "done"), leave ? "你已完成并离开本阶段；角色仍由你控制" : "本阶段布局已完成"); }
  function handoff() {
    if (!win.confirm?.("确定退出本局并把角色交给 AI 吗？故事会继续，AI 的已密封行动不会被覆盖。")) return;
    return command(`/api/v4/rooms/${encodeURIComponent(runId)}/game/control/handoff-to-ai`, { idempotencyKey: key("handoff"), expectedControlEpoch: state.projection.myControl.epoch }, "角色已交给 AI 托管；你随时可以回来申请接管");
  }
  function reclaim() { return command(`/api/v4/rooms/${encodeURIComponent(runId)}/game/control/reclaim`, { idempotencyKey: key("reclaim"), expectedControlEpoch: state.projection.myControl.epoch }, "接管申请已确认；页面会显示实际生效的安全槽位"); }
  function unlock() { return command(state.projection.access.unlockEndpoint, { idempotencyKey: key("unlock") }, "共享世界已解锁，三名玩家继续同一个房间"); }

  async function requestHostSupport() {
    if (state.busy) return;
    state.busy = true; render();
    try {
      const storageKey = `many-worlds:sponsor-request:${runId}`;
      let idempotencyKey = win.localStorage?.getItem(storageKey);
      if (!idempotencyKey) { idempotencyKey = `sponsor-${runId}-${uuid()}`; win.localStorage?.setItem(storageKey, idempotencyKey); }
      await request(`/api/v4/story-runs/${encodeURIComponent(runId)}/sponsorship-requests`, { method: "POST", body: JSON.stringify({ idempotencyKey, origin: "FIRST_INSUFFICIENT" }) });
      state.creditRequired = null;
      state.notice = "The host has received one support request. Your character continues under AI control.";
      clearNoticeLater();
    } catch (error) { state.error = friendlyError(error); }
    finally { state.busy = false; render(); }
  }

  function addCredits() {
    const returnTo = `${win.location.pathname}${win.location.search || `?runId=${encodeURIComponent(runId)}`}`;
    navigate(`/credits?intent=PLAYER_RECLAIM&runId=${encodeURIComponent(runId)}&returnTo=${encodeURIComponent(returnTo)}`);
  }

  async function refreshSponsorshipRequests() {
    const p = state.projection;
    if (!p || String(p.roomSummary?.ownerUserId || "") !== String(p.player?.userId || "")) return;
    try {
      const requests = await request(`/api/v4/story-runs/${encodeURIComponent(runId)}/sponsorship-requests`);
      state.sponsorshipRequests = Array.isArray(requests) ? requests.filter((item) => item.status === "PENDING") : [];
      render();
    } catch {}
  }

  async function decideSponsorship(requestId, approve) {
    if (state.busy) return;
    state.busy = true; render();
    try {
      await request(`/api/v4/story-runs/${encodeURIComponent(runId)}/sponsorship-requests/${encodeURIComponent(requestId)}/${approve ? "approve" : "decline"}`, { method: "POST", body: "{}" });
      state.sponsorshipRequests = state.sponsorshipRequests.filter((item) => item.id !== requestId);
      state.notice = approve ? "10 World Credits are now available to this player in this Story Run." : "The support request was declined; AI control continues.";
      clearNoticeLater();
    } catch (error) { state.error = friendlyError(error); }
    finally { state.busy = false; render(); }
  }

  async function loadResult() {
    if (!state.projection?.resultReady || state.result || state.destroyed) return;
    try { state.result = await request(`/api/v4/rooms/${encodeURIComponent(runId)}/result`); render(); }
    catch (error) { if (!handleAccessFailure(error) && win.location.pathname === "/game/result") showError(error); }
  }

  function startHeartbeat() {
    const beat = async () => {
      if (state.destroyed) return;
      presence.sequence += 1; savePresence(win, runId, state.projection.player.userId, presence);
      let delay = 2_000;
      try {
        const response = await request(`/api/v4/rooms/${encodeURIComponent(runId)}/presence/heartbeat`, { method: "POST", body: JSON.stringify({ sessionInstanceId: presence.id, heartbeatSequence: presence.sequence, lastAppliedDeliverySequence: state.afterDeliverySequence }) });
        const target = Date.parse(response.nextHeartbeatAt || "");
        if (Number.isFinite(target)) delay = Math.max(1_000, Math.min(5_000, target - Date.now()));
      } catch (error) {
        if (error.status === 429) delay = Math.max(1_000, Number(error.retryAfterMs || 1_000));
        else if (error.status === 401 || error.status === 403) { handleAccessFailure(error); return; }
        else delay = 3_000;
      }
      if (!state.destroyed) heartbeatTimer = win.setTimeout(beat, delay);
    };
    void beat();
  }

  function startEvents() { void connectEvents(); }

  async function connectEvents() {
    if (state.destroyed || state.accessFailure) return;
    try {
      await pullMissingEvents();
      if (state.destroyed || state.accessFailure) return;
      streamAbort = new AbortController();
      const response = await fetchImpl(`/api/v4/rooms/${encodeURIComponent(runId)}/events/stream?afterDeliverySequence=${state.afterDeliverySequence}`, {
        method: "GET",
        credentials: "include",
        headers: { accept: "text/event-stream" },
        signal: streamAbort.signal
      });
      if (!response.ok) throw await streamResponseError(response);
      if (!response.body?.getReader) throw new Error("EVENT_STREAM_UNAVAILABLE");
      state.connected = true;
      render();
      await consumeEventStream(response.body);
    } catch (error) {
      if (state.destroyed || error?.name === "AbortError") return;
      if (handleAccessFailure(error)) return;
      state.error = "实时同步暂时中断，正在自动补拉并重连";
      render();
    } finally {
      state.connected = false;
      if (!state.destroyed && !state.accessFailure) {
        streamRetryTimer = win.setTimeout(() => void connectEvents(), 1_200);
      }
    }
  }

  async function pullMissingEvents() {
    for (let pageIndex = 0; pageIndex < 100; pageIndex += 1) {
      const page = await request(`/api/v4/rooms/${encodeURIComponent(runId)}/events?afterDeliverySequence=${state.afterDeliverySequence}`);
      await applyEventPage(page);
      if (!page.hasMore) return;
    }
    throw new Error("EVENT_BACKFILL_LIMIT_EXCEEDED");
  }

  async function applyEventPage(page) {
    const deliveries = Array.isArray(page?.deliveries) ? page.deliveries : [];
    const fresh = deliveries.filter((item) => Number(item.deliverySequence) > state.afterDeliverySequence);
    if (!fresh.length) return;
    const target = Math.max(...fresh.map((item) => Number(item.deliverySequence)));
    state.events = [...state.events, ...fresh].slice(-50);
    for (let attempt = 0; attempt < 4 && state.afterDeliverySequence < target; attempt += 1) {
      await refresh(true);
      if (state.afterDeliverySequence < target) await delay(win, 120 * (attempt + 1));
    }
    if (state.afterDeliverySequence < target) throw new Error("EVENT_CURSOR_NOT_APPLIED");
    render();
  }

  async function consumeEventStream(body) {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (!state.destroyed && !state.accessFailure) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");
      let boundary;
      while ((boundary = buffer.indexOf("\n\n")) >= 0) {
        const block = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const data = block.split("\n").filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trimStart()).join("\n");
        if (!data) continue;
        let page;
        try { page = JSON.parse(data); } catch { continue; }
        await applyEventPage(page);
      }
    }
  }

  async function streamResponseError(response) {
    const payload = await response.json().catch(() => ({}));
    const error = new Error(payload.message || payload.code || `实时同步失败（HTTP ${response.status}）`);
    Object.assign(error, { code: payload.code, status: response.status });
    return error;
  }

  function handleAccessFailure(error) {
    const terminal = error?.status === 401 || error?.status === 403 || error?.status === 404 || error?.code === "ROOM_NOT_FOUND";
    if (!terminal) return false;
    state.accessFailure = error.status === 401 ? "登录状态已失效，正在返回登录页面。" : "当前账号已无法进入这个共同故事局。";
    state.projection = null;
    state.result = null;
    state.events = [];
    clearDraft("MAIN");
    clearDraft("MANEUVER");
    state.destroyed = true;
    if (heartbeatTimer) win.clearTimeout(heartbeatTimer);
    if (refreshTimer) win.clearInterval(refreshTimer);
    streamAbort?.abort?.();
    if (streamRetryTimer) win.clearTimeout(streamRetryTimer);
    clearPresence(win, runId);
    render();
    if (error.status === 401) {
      const returnTo = `${win?.location?.pathname || "/game"}${win?.location?.search || ""}${win?.location?.hash || ""}`;
      navigate(`/auth?returnTo=${encodeURIComponent(returnTo)}`);
    }
    return true;
  }

  function showError(error) { state.error = friendlyError(error); render(); }
  function clearNoticeLater() { if (noticeTimer) win.clearTimeout(noticeTimer); noticeTimer = win.setTimeout(() => { state.notice = ""; render(); }, 4_000); }
  const handlers = {
    refresh: () => refresh(false), submitMain, submitManeuver, submitReaction, finishLayout, handoff, reclaim, unlock, addCredits, requestHostSupport,
    continueWithAi: () => { state.creditRequired = null; render(); }, approveSponsorship: (id) => decideSponsorship(id, true), declineSponsorship: (id) => decideSponsorship(id, false),
    selectMain: (value) => selectDraft("MAIN", value), selectManeuver: (value) => selectDraft("MANEUVER", value),
    dismissError: () => { state.error = ""; render(); }, showResult: () => { win.location.href = state.projection.resultUrl; }
  };
  function render() {
    if (state.accessFailure) {
      root.innerHTML = `<section class="boot-screen boot-error" data-testid="continuous-access-error"><div class="seal">桑田诏</div><h1>无法继续共同故事局</h1><p>${escapeHtml(state.accessFailure)}</p><a class="room-back-button" href="/rooms">返回故事房间</a></section>`;
      return;
    }
    if (state.projection) renderContinuousGame(root, state, handlers);
  }
  const api = { boot, destroy, refresh, render, getState: () => state, submitMain, submitManeuver, submitReaction, finishLayout, handoff, reclaim, unlock };
  return api;
}

function friendlyError(error) {
  const labels = { ACCESS_REQUIRES_UNLOCK: "需要先由真人成员解锁共享世界", INSUFFICIENT_CREDITS: "世界点数不足", INSUFFICIENT_WORLD_CREDITS: "World Credits 不足，角色已由 AI 继续推进", PLAYER_CREDITS_REQUIRED: "World Credits 不足，角色已由 AI 继续推进", REACTION_REQUIRED: "请先完成定向回应", HEARTBEAT_RATE_LIMITED: "连接正常，心跳已自动降频", ROLE_FORBIDDEN: "当前账号无权操作这个角色" };
  return labels[error.code] || error.message || "操作失败，请刷新后重试";
}
function isCreditRequired(error) { return error?.status === 402 && ["PLAYER_CREDITS_REQUIRED", "INSUFFICIENT_WORLD_CREDITS"].includes(error?.code); }
function uuid() { return globalThis.crypto?.randomUUID?.().replace(/-/g, "") || `${Date.now()}${Math.random().toString(16).slice(2)}`; }
function storageKey(runId, userId) { return `many-worlds:presence:${runId}:${userId || "member"}`; }
function draftStorageKey(runId, slot) { return `many-worlds:draft:${runId}:${slot}`; }
function loadPresence(win, runId, userId) { try { const value = JSON.parse(win.sessionStorage.getItem(storageKey(runId, userId))); if (value?.id && Number.isInteger(value.sequence)) return { ...value, lastAppliedDeliverySequence: Number(value.lastAppliedDeliverySequence || 0) }; } catch {} return { id: `web-${uuid()}`, sequence: 0, lastAppliedDeliverySequence: 0 }; }
function savePresence(win, runId, userId, value) { try { win.sessionStorage.setItem(storageKey(runId, userId), JSON.stringify(value)); } catch {} }
function loadDraft(win, runId, slot) { try { const value = JSON.parse(win.localStorage.getItem(draftStorageKey(runId, slot))); return value?.actionKey ? value : null; } catch { return null; } }
function saveDraft(win, runId, slot, value) { try { win.localStorage.setItem(draftStorageKey(runId, slot), JSON.stringify(value)); } catch {} }
function removeDraft(win, runId, slot) { try { win.localStorage.removeItem(draftStorageKey(runId, slot)); } catch {} }

function fingerprint(value) { return JSON.stringify(value); }
function delay(win, ms) { return new Promise((resolve) => win.setTimeout(resolve, ms)); }
function clearPresence(win, runId) { try { for (let index = win.sessionStorage.length - 1; index >= 0; index -= 1) { const key = win.sessionStorage.key(index); if (key?.startsWith(`many-worlds:presence:${runId}:`)) win.sessionStorage.removeItem(key); } } catch {} }
function escapeHtml(value) { return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\"/g, "&quot;").replace(/'/g, "&#039;"); }
