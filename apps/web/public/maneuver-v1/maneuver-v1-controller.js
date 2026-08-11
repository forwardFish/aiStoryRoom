import { B0WindowClient, B0WindowHttpError } from "../b0-window/b0-window-client.js";
import {
  applyB0WindowProjection,
  b0CanConfirm,
  b0CanEdit,
  b0PlanRevision,
  b0WindowRemainingMs,
  createB0WindowState,
  safeB0WindowState,
} from "../b0-window/b0-window-state.js";
import { renderB0WindowResultsV1, renderB0WindowStatusV1 } from "../b0-window/b0-window-view.js";
import { ManeuverV1Client, ManeuverV1HttpError } from "./maneuver-v1-client.js";
import {
  applyManeuverPreviewV1,
  applyManeuverProjectionV1,
  buildManeuverDraftV1,
  clearManeuverPreviewV1,
  createManeuverV1State,
  safeControllerStateV1,
  selectManeuverKindV1,
  updateManeuverDraftV1,
} from "./maneuver-v1-state.js";
import { localeForManeuverV1, renderEvidenceHandV1, renderManeuverPanelV1, renderManeuverPreviewV1 } from "./maneuver-v1-view.js";

const STYLE_ID = "maneuver-v1-styles";
const B0_STYLE_ID = "b0-window-styles";
const B0_POLL_INTERVAL_MS = 2_500;

export function createManeuverV1Controller({ root, window: win, runId, fetchImpl, onCommitted = async () => undefined } = {}) {
  if (!root || !win || !runId || typeof fetchImpl !== "function") {
    throw new TypeError("maneuver v1 controller requires root, window, runId and fetchImpl");
  }
  const client = new ManeuverV1Client({ runId, fetchImpl });
  const b0Client = new B0WindowClient({ runId, fetchImpl });
  const state = createManeuverV1State();
  const b0State = createB0WindowState();
  const locale = localeForManeuverV1(win.document);
  let observer = null;
  let destroyed = false;
  let renderQueued = false;
  let projectionAbort = null;
  let b0ProjectionAbort = null;
  let legacyPanelSnapshot = null;
  let countdownTimer = null;
  let pollTimer = null;
  let b0PollFlight = null;

  async function boot() {
    ensureStyles(win.document);
    root.addEventListener("click", onClick);
    root.addEventListener("input", onInput);
    root.addEventListener("change", onChange);
    observer = new win.MutationObserver(() => queueRender());
    observer.observe(root, { childList: true, subtree: true });
    await refresh({ suppressError: true });
    render();
    countdownTimer = timer("setInterval", updateCountdown, 1_000);
    pollTimer = timer("setInterval", pollB0, B0_POLL_INTERVAL_MS);
    return api;
  }

  async function refresh({ suppressError = false } = {}) {
    await refreshB0({ suppressError, renderAfter: false });
    const projection = await refreshManeuver({ suppressError });
    render();
    return projection;
  }

  async function refreshManeuver({ suppressError = false } = {}) {
    projectionAbort?.abort?.();
    projectionAbort = typeof win.AbortController === "function" ? new win.AbortController() : null;
    try {
      const projection = await client.projection({ signal: projectionAbort?.signal });
      applyManeuverProjectionV1(state, projection);
      state.error = "";
      return projection;
    } catch (error) {
      if (error?.name === "AbortError") return null;
      if (isCapabilityUnavailable(error)) {
        state.active = false;
        restoreLegacyView();
        return null;
      }
      if (!suppressError) state.error = playerError(error);
      return null;
    }
  }

  async function refreshB0({ suppressError = false, renderAfter = true } = {}) {
    const beforeActive = b0State.active;
    const beforeEditable = b0CanEdit(b0State);
    b0ProjectionAbort?.abort?.();
    b0ProjectionAbort = typeof win.AbortController === "function" ? new win.AbortController() : null;
    try {
      const projection = await b0Client.projection({ signal: b0ProjectionAbort?.signal });
      applyB0WindowProjection(b0State, projection, Date.now());
      b0State.error = "";
    } catch (error) {
      if (error?.name === "AbortError") return null;
      if (isB0Unavailable(error)) {
        b0State.active = false;
        b0State.projection = null;
        b0State.error = "";
      } else if (!suppressError) {
        b0State.error = playerError(error);
      }
    }
    if (renderAfter) {
      const editabilityChanged = beforeActive !== b0State.active || beforeEditable !== b0CanEdit(b0State);
      if (editabilityChanged) render();
      else renderB0Surfaces();
    }
    return b0State.projection;
  }

  function pollB0() {
    if (destroyed || b0State.busy || !state.active) return Promise.resolve(null);
    if (b0PollFlight) return b0PollFlight;

    const flight = pollB0Owned().finally(() => {
      if (b0PollFlight === flight) b0PollFlight = null;
    });
    b0PollFlight = flight;
    return flight;
  }

  async function pollB0Owned() {
    const beforeWindow = b0WindowIdentity(b0State.projection);
    const beforeEditable = b0CanEdit(b0State);
    await refreshB0({ suppressError: true, renderAfter: false });
    if (destroyed || !state.active) return null;

    const afterWindow = b0WindowIdentity(b0State.projection);
    const successorChanged = Boolean(afterWindow && afterWindow !== beforeWindow);
    const editingReopened = !beforeEditable && b0CanEdit(b0State);
    if (successorChanged || editingReopened) {
      await refreshManeuver({ suppressError: true });
      render();
    } else {
      renderB0Surfaces();
    }
    return b0State.projection;
  }

  async function requestPreview() {
    if (state.busy || b0State.busy || !state.active) return;
    state.error = "";
    state.notice = "";
    let draft;
    try { draft = buildManeuverDraftV1(state); }
    catch (error) { state.error = playerError(error); render(); return; }
    state.busy = true;
    if (b0State.active) b0State.busy = true;
    render();
    try {
      const response = b0State.active
        ? await b0Client.preview({
            draft,
            expectedStateRevision: state.projection.stateRevision,
            expectedRevision: b0PlanRevision(b0State),
            clientRequestId: b0DraftRequestId(),
          })
        : await client.preview({ draft, expectedStateRevision: state.projection.stateRevision });
      applyManeuverPreviewV1(state, response);
      if (b0State.active && response?.window) applyB0WindowProjection(b0State, response.window, Date.now());
    } catch (error) {
      state.error = playerError(error);
      if (isRecoverableConflict(error)) await refresh({ suppressError: true });
    } finally {
      state.busy = false;
      b0State.busy = false;
      render();
    }
  }

  async function confirmPreview() {
    const preview = state.preview;
    if (state.busy || b0State.busy || preview?.decision !== "READY" || !state.previewCommitKey) return;
    state.busy = true;
    if (b0State.active) b0State.busy = true;
    state.error = "";
    render();
    try {
      if (b0State.active) {
        if (!b0CanConfirm(b0State)) throw new B0WindowHttpError({
          status: 409,
          code: "B0_PLAN_NOT_CONFIRMABLE",
          message: locale === "en" ? "The plan is no longer awaiting confirmation." : "这项计划已经不能按当前版本确认，请重新预演。",
          recoverable: true,
        });
        const projection = await b0Client.confirm({ expectedRevision: b0PlanRevision(b0State) });
        applyB0WindowProjection(b0State, projection, Date.now());
        clearManeuverPreviewV1(state);
        state.notice = locale === "en"
          ? "Your plan is confirmed. Mark yourself ready when you are finished negotiating."
          : "计划已经确认。完成交涉后，可以点击“我已准备”。";
      } else {
        await client.commit({
          previewToken: preview.previewToken,
          idempotencyKey: state.previewCommitKey,
          expectedStateRevision: state.projection.stateRevision,
        });
        clearManeuverPreviewV1(state);
        state.notice = locale === "en" ? "Your maneuver is now part of the story." : "这项谋划已经进入当前局势。";
        await refresh({ suppressError: false });
        await onCommitted();
      }
    } catch (error) {
      state.error = playerError(error);
      if (isRecoverableConflict(error)) {
        state.preview = { decision: "STALE", clarificationPrompt: state.error };
        state.previewCommitKey = "";
        await refresh({ suppressError: true });
      }
    } finally {
      state.busy = false;
      b0State.busy = false;
      render();
    }
  }

  async function readyPlan() {
    if (!b0State.active || b0State.busy || state.busy || b0State.projection?.actor?.ready) return;
    b0State.busy = true;
    b0State.error = "";
    render();
    try {
      const projection = await b0Client.ready({
        expectedReadyRevision: b0State.projection.actor.readyRevision,
      });
      applyB0WindowProjection(b0State, projection, Date.now());
      state.notice = locale === "en" ? "Ready. Your confirmed plan remains private until settlement." : "已准备。你的确认计划会在统一结算前保持私密。";
    } catch (error) {
      b0State.error = playerError(error);
      if (isRecoverableConflict(error)) await refreshB0({ suppressError: true, renderAfter: false });
    } finally {
      b0State.busy = false;
      render();
    }
  }

  async function unreadyPlan() {
    if (!b0State.active || b0State.busy || state.busy || !b0State.projection?.actor?.ready) return;
    b0State.busy = true;
    b0State.error = "";
    render();
    try {
      const projection = await b0Client.unready({
        expectedReadyRevision: b0State.projection.actor.readyRevision,
      });
      applyB0WindowProjection(b0State, projection, Date.now());
      state.notice = locale === "en" ? "Ready was cancelled. You may edit the plan while the window remains open." : "已取消准备。窗口仍开放时可以继续修改计划。";
    } catch (error) {
      b0State.error = playerError(error);
      if (isRecoverableConflict(error)) await refreshB0({ suppressError: true, renderAfter: false });
    } finally {
      b0State.busy = false;
      render();
    }
  }

  function render() {
    if (destroyed || !state.active) return;
    const activeObserver = observer;
    activeObserver?.disconnect();
    try {
      const legacyPanel = findLegacyPanel();
      if (legacyPanel) {
        if (!legacyPanelSnapshot || legacyPanelSnapshot.node !== legacyPanel || legacyPanelSnapshot.node.isConnected === false) {
          legacyPanelSnapshot = { node: legacyPanel, html: legacyPanel.innerHTML, marker: legacyPanel.dataset.maneuverV1 || "" };
        }
        const nextHtml = renderManeuverPanelV1(state, locale, b0State);
        legacyPanel.dataset.maneuverV1 = "true";
        if (legacyPanel.innerHTML !== nextHtml) legacyPanel.innerHTML = nextHtml;
      }
      renderEvidence();
      renderPreview();
      renderB0Results();
      updateCountdown();
    } finally {
      if (activeObserver && !destroyed) activeObserver.observe(root, { childList: true, subtree: true });
    }
  }

  function renderB0Surfaces() {
    if (destroyed || !state.active) return;
    const panel = findLegacyPanel();
    const existing = panel?.querySelector?.("[data-b0-window-status]");
    if (!b0State.active) existing?.remove?.();
    else {
      const html = renderB0WindowStatusV1(b0State, locale);
      if (existing) existing.outerHTML = html;
      else panel?.querySelector?.(".maneuver-v1-heading")?.insertAdjacentHTML?.("afterend", html);
    }
    renderB0Results();
    updateCountdown();
  }

  function renderEvidence() {
    const left = root.querySelector(".causal-left");
    if (!left) return;
    left.querySelector("[data-maneuver-v1-evidence]")?.remove();
    left.insertAdjacentHTML("beforeend", renderEvidenceHandV1(state, locale));
  }

  function renderPreview() {
    const center = root.querySelector(".causal-center");
    if (!center) return;
    center.querySelector("[data-maneuver-v1-preview]")?.remove();
    const decisions = [...center.querySelectorAll('[data-testid="decision-zone"], .decision-zone')];
    if (!state.preview) {
      decisions.forEach((node) => {
        if (node.dataset.maneuverV1Hidden === "true") {
          node.hidden = false;
          delete node.dataset.maneuverV1Hidden;
        }
      });
      return;
    }
    decisions.forEach((node) => { node.hidden = true; node.dataset.maneuverV1Hidden = "true"; });
    center.insertAdjacentHTML("beforeend", renderManeuverPreviewV1(state, locale));
  }

  function renderB0Results() {
    const center = root.querySelector(".causal-center");
    if (!center) return;
    center.querySelector("[data-b0-window-results]")?.remove();
    if (!b0State.active) return;
    const html = renderB0WindowResultsV1(b0State, locale);
    if (html) center.insertAdjacentHTML("beforeend", html);
  }

  function updateCountdown() {
    const node = root.querySelector?.("[data-b0-countdown]");
    if (!node || !b0State.active) return;
    const projection = b0State.projection;
    node.textContent = projection?.window?.status === "OPEN" && projection.window.locksAt
      ? formatDuration(b0WindowRemainingMs(b0State, Date.now()))
      : "—";
  }

  function onClick(event) {
    const target = event.target?.closest?.("[data-mv1-kind], [data-mv1-trace], [data-mv1-route], [data-mv1-leverage], [data-mv1-preview], [data-mv1-confirm], [data-mv1-edit], [data-mv1-cancel], [data-b0-ready], [data-b0-unready]");
    if (!target || !root.contains(target)) return;
    if (target.dataset.mv1Kind) { selectManeuverKindV1(state, target.dataset.mv1Kind); render(); return; }
    if (target.dataset.mv1Trace) { updateManeuverDraftV1(state, "INVESTIGATE", { traceId: target.dataset.mv1Trace }); render(); return; }
    if (target.dataset.mv1Route) { updateManeuverDraftV1(state, "INVESTIGATE", { routeId: target.dataset.mv1Route }); render(); return; }
    if (target.dataset.mv1Leverage) { updateManeuverDraftV1(state, "LEVERAGE", { leverageAssetId: target.dataset.mv1Leverage }); render(); return; }
    if (target.hasAttribute("data-b0-ready")) void readyPlan();
    else if (target.hasAttribute("data-b0-unready")) void unreadyPlan();
    else if (target.hasAttribute("data-mv1-preview")) void requestPreview();
    else if (target.hasAttribute("data-mv1-confirm")) void confirmPreview();
    else if (target.hasAttribute("data-mv1-edit") || target.hasAttribute("data-mv1-cancel")) { clearManeuverPreviewV1(state); render(); }
  }

  function onInput(event) {
    const element = event.target;
    const kind = element?.dataset?.mv1For;
    const field = element?.dataset?.mv1Field;
    if (!kind || !field || element.tagName !== "TEXTAREA") return;
    updateManeuverDraftV1(state, kind, { [field]: element.value });
  }

  function onChange(event) {
    const element = event.target;
    const kind = element?.dataset?.mv1For;
    const field = element?.dataset?.mv1Field;
    if (!kind || !field || element.tagName !== "SELECT") return;
    updateManeuverDraftV1(state, kind, { [field]: element.value });
    render();
  }

  function queueRender() {
    if (renderQueued || destroyed || !state.active) return;
    renderQueued = true;
    Promise.resolve().then(() => { renderQueued = false; render(); });
  }

  function destroy() {
    destroyed = true;
    projectionAbort?.abort?.();
    b0ProjectionAbort?.abort?.();
    clearTimer("clearInterval", countdownTimer);
    clearTimer("clearInterval", pollTimer);
    observer?.disconnect();
    observer = null;
    root.removeEventListener("click", onClick);
    root.removeEventListener("input", onInput);
    root.removeEventListener("change", onChange);
    restoreLegacyView();
  }

  function findLegacyPanel() {
    return root.querySelector?.('.causal-right [data-testid="maneuver-panel"]')
      || root.querySelector?.('[data-testid="maneuver-panel"]')
      || null;
  }

  function restoreLegacyView() {
    root.querySelector?.("[data-maneuver-v1-evidence]")?.remove();
    root.querySelector?.("[data-maneuver-v1-preview]")?.remove();
    root.querySelector?.("[data-b0-window-results]")?.remove();
    root.querySelectorAll?.('[data-maneuver-v1-hidden="true"]').forEach((node) => {
      node.hidden = false;
      delete node.dataset.maneuverV1Hidden;
    });
    if (legacyPanelSnapshot?.node?.isConnected !== false) {
      legacyPanelSnapshot.node.innerHTML = legacyPanelSnapshot.html;
      if (legacyPanelSnapshot.marker) legacyPanelSnapshot.node.dataset.maneuverV1 = legacyPanelSnapshot.marker;
      else delete legacyPanelSnapshot.node.dataset.maneuverV1;
    }
    legacyPanelSnapshot = null;
  }

  function timer(method, callback, delay) {
    const fn = typeof win?.[method] === "function" ? win[method].bind(win) : globalThis[method]?.bind(globalThis);
    return fn ? fn(callback, delay) : null;
  }

  function clearTimer(method, id) {
    if (id === null || id === undefined) return;
    const fn = typeof win?.[method] === "function" ? win[method].bind(win) : globalThis[method]?.bind(globalThis);
    fn?.(id);
  }

  const api = {
    boot,
    refresh,
    destroy,
    getState: () => ({ ...safeControllerStateV1(state), b0Window: safeB0WindowState(b0State) }),
    hasDraft: () => Object.values(state.drafts).some((draft) => Object.values(draft).some((value) => typeof value === "string" && value.trim())),
  };
  return api;
}

export async function attachManeuverV1Controller({ app, root, window: win, runId, fetchImpl, createController = createManeuverV1Controller } = {}) {
  if (!app || typeof app.boot !== "function") throw new TypeError("maneuver attachment requires a booted game app");
  const originalRefresh = typeof app.refresh === "function" ? app.refresh.bind(app) : async () => undefined;
  const originalDestroy = typeof app.destroy === "function" ? app.destroy.bind(app) : () => undefined;
  const originalGetState = typeof app.getState === "function" ? app.getState.bind(app) : () => ({});
  const controller = createController({ root, window: win, runId, fetchImpl, onCommitted: async () => { await originalRefresh(true); } });
  await controller.boot();
  app.refresh = async (...args) => { const result = await originalRefresh(...args); await controller.refresh({ suppressError: true }); return result; };
  app.destroy = () => { controller.destroy(); return originalDestroy(); };
  app.getState = () => ({ ...originalGetState(), maneuverV1: controller.getState() });
  app.maneuverV1 = controller;
  return controller;
}

function ensureStyles(documentLike) {
  ensureStyle(documentLike, STYLE_ID, "/maneuver-v1/maneuver-v1.css?v=20260805-mvp-v1");
  ensureStyle(documentLike, B0_STYLE_ID, "/b0-window/b0-window.css?v=20260807-b0-v1");
}
function ensureStyle(documentLike, id, href) {
  if (documentLike.getElementById(id)) return;
  const link = documentLike.createElement("link");
  link.id = id;
  link.rel = "stylesheet";
  link.href = href;
  documentLike.head?.append(link);
}
function b0WindowIdentity(projection) {
  const id = String(projection?.window?.id || "").trim();
  if (!id) return "";
  return `${id}:${Number(projection?.window?.ordinal || 0)}`;
}
function b0DraftRequestId() {
  const id = globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 14)}`;
  return `draft:b0:${id}`;
}
function formatDuration(milliseconds) {
  const total = Math.max(0, Math.ceil(Number(milliseconds || 0) / 1_000));
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}
function isCapabilityUnavailable(error) { return error instanceof ManeuverV1HttpError && [404, 405].includes(error.status); }
function isB0Unavailable(error) { return error instanceof B0WindowHttpError && error.code === "B0_WINDOW_NOT_AVAILABLE"; }
function isRecoverableConflict(error) { return (error instanceof ManeuverV1HttpError || error instanceof B0WindowHttpError) && error.recoverable === true; }
function playerError(error) {
  if (error instanceof ManeuverV1HttpError || error instanceof B0WindowHttpError) return error.message || "当前局势已经变化，请重新读取。";
  return error?.message || String(error || "当前操作没有完成。");
}
