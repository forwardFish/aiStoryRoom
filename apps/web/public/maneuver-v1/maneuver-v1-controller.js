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

export function createManeuverV1Controller({ root, window: win, runId, fetchImpl, onCommitted = async () => undefined } = {}) {
  if (!root || !win || !runId || typeof fetchImpl !== "function") {
    throw new TypeError("maneuver v1 controller requires root, window, runId and fetchImpl");
  }
  const client = new ManeuverV1Client({ runId, fetchImpl });
  const state = createManeuverV1State();
  const locale = localeForManeuverV1(win.document);
  let observer = null;
  let destroyed = false;
  let renderQueued = false;
  let projectionAbort = null;
  let legacyPanelSnapshot = null;

  async function boot() {
    ensureStyles(win.document);
    root.addEventListener("click", onClick);
    root.addEventListener("input", onInput);
    root.addEventListener("change", onChange);
    observer = new win.MutationObserver(() => queueRender());
    observer.observe(root, { childList: true, subtree: true });
    await refresh({ suppressError: true });
    render();
    return api;
  }

  async function refresh({ suppressError = false } = {}) {
    projectionAbort?.abort?.();
    projectionAbort = typeof win.AbortController === "function" ? new win.AbortController() : null;
    try {
      const projection = await client.projection({ signal: projectionAbort?.signal });
      applyManeuverProjectionV1(state, projection);
      state.error = "";
      render();
      return projection;
    } catch (error) {
      if (error?.name === "AbortError") return null;
      if (isCapabilityUnavailable(error)) {
        state.active = false;
        restoreLegacyView();
        return null;
      }
      if (!suppressError) state.error = playerError(error);
      render();
      return null;
    }
  }

  async function requestPreview() {
    if (state.busy || !state.active) return;
    state.error = "";
    state.notice = "";
    let draft;
    try { draft = buildManeuverDraftV1(state); }
    catch (error) { state.error = playerError(error); render(); return; }
    state.busy = true;
    render();
    try {
      const response = await client.preview({ draft, expectedStateRevision: state.projection.stateRevision });
      applyManeuverPreviewV1(state, response);
    } catch (error) {
      state.error = playerError(error);
      if (isRecoverableConflict(error)) await refresh({ suppressError: true });
    } finally {
      state.busy = false;
      render();
    }
  }

  async function confirmPreview() {
    const preview = state.preview;
    if (state.busy || preview?.decision !== "READY" || !state.previewCommitKey) return;
    state.busy = true;
    state.error = "";
    render();
    try {
      await client.commit({
        previewToken: preview.previewToken,
        idempotencyKey: state.previewCommitKey,
        expectedStateRevision: state.projection.stateRevision,
      });
      clearManeuverPreviewV1(state);
      state.notice = locale === "en" ? "Your maneuver is now part of the story." : "这项谋划已经进入当前局势。";
      await refresh({ suppressError: false });
      await onCommitted();
    } catch (error) {
      state.error = playerError(error);
      if (isRecoverableConflict(error)) {
        state.preview = { decision: "STALE", clarificationPrompt: state.error };
        state.previewCommitKey = "";
        await refresh({ suppressError: true });
      }
    } finally {
      state.busy = false;
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
        const nextHtml = renderManeuverPanelV1(state, locale);
        legacyPanel.dataset.maneuverV1 = "true";
        if (legacyPanel.innerHTML !== nextHtml) legacyPanel.innerHTML = nextHtml;
      }
      renderEvidence();
      renderPreview();
    } finally {
      if (activeObserver && !destroyed) activeObserver.observe(root, { childList: true, subtree: true });
    }
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

  function onClick(event) {
    const target = event.target?.closest?.("[data-mv1-kind], [data-mv1-trace], [data-mv1-route], [data-mv1-leverage], [data-mv1-preview], [data-mv1-confirm], [data-mv1-edit], [data-mv1-cancel]");
    if (!target || !root.contains(target)) return;
    if (target.dataset.mv1Kind) { selectManeuverKindV1(state, target.dataset.mv1Kind); render(); return; }
    if (target.dataset.mv1Trace) { updateManeuverDraftV1(state, "INVESTIGATE", { traceId: target.dataset.mv1Trace }); render(); return; }
    if (target.dataset.mv1Route) { updateManeuverDraftV1(state, "INVESTIGATE", { routeId: target.dataset.mv1Route }); render(); return; }
    if (target.dataset.mv1Leverage) { updateManeuverDraftV1(state, "LEVERAGE", { leverageAssetId: target.dataset.mv1Leverage }); render(); return; }
    if (target.hasAttribute("data-mv1-preview")) void requestPreview();
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

  const api = {
    boot,
    refresh,
    destroy,
    getState: () => safeControllerStateV1(state),
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
  if (documentLike.getElementById(STYLE_ID)) return;
  const link = documentLike.createElement("link");
  link.id = STYLE_ID;
  link.rel = "stylesheet";
  link.href = "/maneuver-v1/maneuver-v1.css?v=20260805-mvp-v1";
  documentLike.head?.append(link);
}
function isCapabilityUnavailable(error) { return error instanceof ManeuverV1HttpError && [404, 405].includes(error.status); }
function isRecoverableConflict(error) { return error instanceof ManeuverV1HttpError && error.recoverable === true; }
function playerError(error) { return error instanceof ManeuverV1HttpError ? (error.message || "当前局势已经变化，请重新读取。") : (error?.message || String(error || "当前操作没有完成。")); }
