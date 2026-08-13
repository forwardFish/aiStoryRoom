import {
  buildPressureManeuverPanelV1,
  openPressureResponseInExistingWorkbenchV1,
  pressureWorkbenchToExistingManeuverTypeV1
} from "./pressure-chapter-workbench-v1.js";
import { PressureMainGameStorageV1 as BasePressureMainGameStorageV1 } from "./pressure-main-game-storage-v1.js?v=20260812-main-game-restore-v1";

export const PRESSURE_CHAPTER_PHASE1_SCOPE = "UI_ONLY";
export const PRESSURE_CHAPTER_PHASE1_ARTIFACT_VERSION = "b5-modal-web-v1";
export const PRESSURE_CHAPTER_GAME_SCHEMA_V1 = "pressure_chapter_game_projection_v1";
export const PRESSURE_CHAPTER_GAME_COMMAND_SCHEMA_V1 = "pressure_chapter_game_command_v1";
export const PRESSURE_CHAPTER_SUBMIT_RESPONSE_SCHEMA_V1 = "pressure_chapter_submit_decision_http_response_v1";
export const PRESSURE_CHAPTER_DELIVERY_RESPONSE_SCHEMA_V1 = "pressure_chapter_delivery_mark_http_response_v1";

const CARD_TYPES = Object.freeze(["CROSS_IMPACT", "PROMISE_BROKEN", "CRISIS", "STAGE_VICTORY"]);
const MODAL_TYPES = Object.freeze(["PROMISE_BROKEN", "CRISIS", "STAGE_VICTORY"]);
const WORKBENCH_TYPES = Object.freeze(["TALK", "INVESTIGATE", "TOKEN", "PLAN", "DEFER"]);
const FEED_CATEGORIES = Object.freeze(["RELATED", "PUBLIC", "SUSPICIOUS"]);
const DISCLOSURES = Object.freeze(["HIDDEN", "SUSPECTED", "CONFIRMED"]);
const SEVERITIES = Object.freeze(["MINOR", "MAJOR", "CRITICAL"]);
const PRESENTATIONS = Object.freeze(["FEED_ONLY", "CENTER_CARD", "KEY_MODAL"]);
const METRIC_TONES = Object.freeze(["DEFAULT", "GOOD", "WARN", "DANGER"]);
const CHAPTER_IDS = Object.freeze(["P0", "N1", "N2", "N3", "N4", "N5", "N6", "N7"]);
const MODAL_PRIORITY = Object.freeze({ STAGE_VICTORY: 100, PROMISE_BROKEN: 200, CRISIS: 300 });
const CENTER_PRIORITY = Object.freeze({ CROSS_IMPACT: 0, STAGE_VICTORY: 100, PROMISE_BROKEN: 200, CRISIS: 300 });
const MODAL_TEST_IDS = Object.freeze({
  PROMISE_BROKEN: "pressure-modal-promise-broken",
  CRISIS: "pressure-modal-crisis",
  STAGE_VICTORY: "pressure-modal-stage-victory"
});
const HASH = /^[a-f0-9]{64}$/u;
const NON_EMPTY = /\S/u;
const MODAL_ACTIVE_CLASS = "pressure-modal-active";
const FEED_ITEM_SELECTOR = [
  "[data-pressure-feed-event-id]",
  "[data-pressure-event-id]",
  "[data-aemotion-event-id]",
  "[data-aemotion-open]",
  "[data-event-id]"
].join(",");
const FEED_HOST_SELECTOR = [
  "[data-testid='situation-feed']",
  "[data-testid='aemotion-m1-feed']",
  "[data-aemotion-world-situation]",
  ".situation-feed",
  ".aemotion-world-situation",
  "[aria-label='局势动向']",
  "[aria-label='世界局势']"
].join(",");

/**
 * Extends the exact b5 production storage adapter. The base adapter remains
 * authoritative for the frozen 01/02 app.js view, decision drafts, seat
 * control fields and terminal hand-off; this class adds only viewer-safe Feed,
 * workbench response context, paging and delivery marks.
 */
export class PressureMainGameStorageV1 extends BasePressureMainGameStorageV1 {
  constructor({
    runId,
    initialProjection,
    fetchImpl = globalThis.fetch?.bind(globalThis),
    createIdempotencyKey = defaultIdempotencyKey
  } = {}) {
    super({ runId, initialProjection, fetchImpl, createIdempotencyKey });
    this.projection = validatePressureProjectionV1(initialProjection, runId);
    this.fetchImpl = fetchImpl;
    this.createIdempotencyKey = createIdempotencyKey;
    this.responseContext = null;
    this.listeners = new Set();
    this.inFlight = null;
    this.deliveryMarks = new Map();
  }

  async restoreOrCreate() {
    return this.toView(this.projection);
  }

  async getRun() {
    const next = await this.requestProjection(`/api/v4/rooms/${encodeURIComponent(this.runId)}/game`);
    this.acceptProjection(next, { mode: "refresh" });
    return this.toView(this.projection);
  }

  async createRun() {
    return this.getRun();
  }

  async loadOlderFeed(limit = 10) {
    const cursor = this.projection.feedPage.nextCursor;
    if (cursor === null) return structuredClone(this.projection.feedPage);
    const boundedLimit = Number.isSafeInteger(limit) ? Math.max(1, Math.min(100, limit)) : 10;
    const query = new URLSearchParams({
      feedCursor: cursor,
      feedLimit: String(boundedLimit)
    });
    const next = await this.requestProjection(
      `/api/v4/rooms/${encodeURIComponent(this.runId)}/game?${query.toString()}`
    );
    this.acceptProjection(next, { mode: "older" });
    return structuredClone(this.projection.feedPage);
  }

  async submitDecision(_view, { optionKey, customText } = {}) {
    const decision = this.projection.decision;
    if (!decision || this.projection.capabilities.canSubmitDecision !== true) {
      throw new Error("当前没有可提交的主线决策。");
    }
    const custom = String(customText || "").trim();
    const option = custom
      ? null
      : decision.options.find((_candidate, index) => optionLabel(index) === optionKey) || null;
    if (!option && !custom) throw new Error("请选择一项决定，或写下你的处理方式。");
    return this.submitCompiled({
      optionCode: option?.code ?? null,
      customText: custom || null,
      sourceEventId: null,
      responseActionCode: null
    });
  }

  async submitManeuver(_view, command = {}) {
    const context = this.responseContext;
    if (!context) throw new Error("这项回应已经失效，请重新打开对应的局势卡片。");
    const currentItem = findNewestFeedItem(this.projection.feedPage.items, context.responseToEventId);
    const currentAction = currentItem?.responseOptions?.find((action) => action.code === context.actionCode);
    if (
      !currentItem
      || currentItem.projectionVersion !== context.projectionVersion
      || !currentAction
      || currentAction.preferredEntry !== context.preferredEntry
    ) {
      this.clearResponseContext();
      throw new Error("局势已经变化，请重新打开对应事件后再回应。");
    }
    const maneuverType = pressureWorkbenchToExistingManeuverTypeV1(context.preferredEntry);
    if (!maneuverType || command.maneuverType !== maneuverType) {
      throw new Error("当前工作区与这项回应不匹配。");
    }
    return this.submitCompiled({
      optionCode: context.actionCode,
      customText: textFromExistingManeuverCommandV1(command),
      sourceEventId: context.responseToEventId,
      responseActionCode: context.actionCode
    }, { clearResponseContext: true });
  }

  setResponseContext(itemValue, actionValue) {
    const item = record(itemValue, "responseItem");
    const action = record(actionValue, "responseAction");
    const current = findNewestFeedItem(this.projection.feedPage.items, item.eventId);
    const authorized = current?.responseOptions?.find((candidate) => candidate.code === action.code);
    if (!current || !authorized || authorized.preferredEntry !== action.preferredEntry) {
      throw new Error("这项回应不属于当前可见事件。");
    }
    this.responseContext = {
      responseToEventId: requiredString(current.eventId, "responseContext.responseToEventId", 300),
      projectionVersion: current.projectionVersion,
      actionCode: requiredString(authorized.code, "responseContext.actionCode", 200),
      preferredEntry: enumerationValue(authorized.preferredEntry, WORKBENCH_TYPES, "responseContext.preferredEntry")
    };
  }

  getResponseContext() {
    return this.responseContext ? structuredClone(this.responseContext) : null;
  }

  clearResponseContext() {
    this.responseContext = null;
  }

  subscribe(listener) {
    if (typeof listener !== "function") throw new TypeError("projection listener must be a function");
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  toView(projection = this.projection) {
    const view = super.toView(projection);
    view.maneuverPanel = buildPressureManeuverPanelV1(projection);
    delete view.pressureProjection;
    return view;
  }

  acceptProjection(value, { mode = "refresh" } = {}) {
    const next = validatePressureProjectionV1(value, this.runId);
    const current = this.projection;
    if (
      mode !== "older"
      && current
      && next.feedPage.serverSequence < current.feedPage.serverSequence
    ) {
      return false;
    }
    const existingItems = current?.feedPage?.items || [];
    const mergedItems = mode === "older"
      ? mergePressureFeedItemsV1(existingItems, next.feedPage.items)
      : mergePressureFeedItemsV1(next.feedPage.items, existingItems);
    this.projection = mode === "older"
      ? {
          ...current,
          feedPage: {
            ...current.feedPage,
            items: mergedItems,
            unreadCount: next.feedPage.unreadCount,
            nextCursor: next.feedPage.nextCursor,
            serverSequence: Math.max(current.feedPage.serverSequence, next.feedPage.serverSequence)
          }
        }
      : {
          ...next,
          feedPage: {
            ...next.feedPage,
            items: mergedItems
          }
        };
    for (const listener of this.listeners) listener(structuredClone(this.projection));
    return true;
  }

  async submitCompiled(input, { clearResponseContext = false } = {}) {
    if (this.inFlight) return this.inFlight;
    const idempotencyKey = this.createIdempotencyKey();
    const command = buildPressureDecisionCommandV1({
      projection: this.projection,
      optionCode: input.optionCode,
      customText: input.customText,
      sourceEventId: input.sourceEventId,
      responseActionCode: input.responseActionCode,
      idempotencyKey
    });
    this.inFlight = (async () => {
      try {
        const response = await this.fetchImpl(`/api/v4/rooms/${encodeURIComponent(this.runId)}/game/action`, {
          method: "POST",
          credentials: "include",
          headers: { accept: "application/json", "content-type": "application/json" },
          body: JSON.stringify(command)
        });
        const payload = await response.json().catch(() => null);
        if (!response.ok) throw httpError(response, payload, "这项行动暂时无法提交。");
        if (
          payload?.schemaVersion !== PRESSURE_CHAPTER_SUBMIT_RESPONSE_SCHEMA_V1
          || payload?.idempotencyKey !== idempotencyKey
        ) {
          throw new Error("行动响应与本次提交不一致。");
        }
        this.acceptProjection(payload.projection);
        if (clearResponseContext) this.clearResponseContext();
        return this.toView(this.projection);
      } finally {
        this.inFlight = null;
      }
    })();
    return this.inFlight;
  }

  async markModalShown(modalValue) {
    const modal = record(modalValue, "modal");
    const item = findNewestFeedItem(this.projection.feedPage.items, modal.sourceEventId);
    if (!item?.keyModal || item.keyModal.dedupeKey !== modal.dedupeKey) {
      return this.projection;
    }
    let mark = this.deliveryMarks.get(modal.dedupeKey);
    if (!mark) {
      mark = {
        idempotencyKey: this.createIdempotencyKey(),
        promise: null,
        completed: false
      };
      this.deliveryMarks.set(modal.dedupeKey, mark);
    }
    if (mark.completed) return this.projection;
    if (mark.promise) return mark.promise;
    mark.promise = (async () => {
      try {
        const response = await this.fetchImpl(`/api/v4/rooms/${encodeURIComponent(this.runId)}/game/action`, {
          method: "POST",
          credentials: "include",
          headers: { accept: "application/json", "content-type": "application/json" },
          body: JSON.stringify({
            commandType: "DELIVERY_MARK",
            eventId: item.eventId,
            projectionVersion: item.projectionVersion,
            operation: "MODAL_SHOWN",
            idempotencyKey: mark.idempotencyKey
          })
        });
        const payload = await response.json().catch(() => null);
        if (!response.ok) throw httpError(response, payload, "关键局势状态暂时无法同步。");
        if (
          payload?.schemaVersion !== PRESSURE_CHAPTER_DELIVERY_RESPONSE_SCHEMA_V1
          || payload?.operation !== "MODAL_SHOWN"
          || payload?.idempotencyKey !== mark.idempotencyKey
        ) {
          throw new Error("关键局势状态响应与本次同步不一致。");
        }
        mark.completed = true;
        this.acceptProjection(payload.projection);
        return this.projection;
      } finally {
        mark.promise = null;
      }
    })();
    return mark.promise;
  }

  async requestProjection(path) {
    const response = await this.fetchImpl(path, {
      credentials: "include",
      cache: "no-store",
      headers: { accept: "application/json" }
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) throw httpError(response, payload, "暂时无法读取故事局。");
    return validatePressureProjectionV1(payload, this.runId);
  }
}

export function mergePressureFeedItemsV1(primaryItems, secondaryItems) {
  const byIdentity = new Map();
  for (const item of [...primaryItems, ...secondaryItems]) {
    const key = `${item.eventId}\u0000${item.projectionVersion}`;
    if (!byIdentity.has(key)) byIdentity.set(key, structuredClone(item));
  }
  return [...byIdentity.values()];
}

function findNewestFeedItem(items, eventId) {
  return items
    .filter((item) => item.eventId === eventId)
    .sort((left, right) => right.projectionVersion - left.projectionVersion)[0] || null;
}

/**
 * Mounts only the four approved Phase-1 surfaces into existing DOM seams.
 * It does not own or redraw the approved shell, rails, Feed, metrics, resources,
 * or workbench. Trigger creation remains a Phase-2 server responsibility.
 */
export function attachPressureChapterEnhancementsV1({
  root,
  window: win = globalThis.window,
  storyApp,
  storage
} = {}) {
  if (!root) throw new TypeError("Pressure enhancement requires the existing /game root");
  if (!storyApp || typeof storyApp.getState !== "function") throw new TypeError("Pressure enhancement requires the existing story app");
  if (!(storage instanceof PressureMainGameStorageV1) && typeof storage?.subscribe !== "function") {
    throw new TypeError("Pressure enhancement requires Pressure storage");
  }

  const state = {
    projection: validatePressureProjectionV1(storage.projection, storage.runId),
    activeCenterCard: null,
    activeCenterEventId: "",
    activeModal: null,
    modalQueue: [],
    suppressedModalKeys: new Set(),
    hiddenCenterEventIds: new Set(),
    modalFocus: null,
    feedLoading: false,
    recoveryPromise: null,
    destroyed: false,
    mountQueued: false,
    mounting: false
  };
  let unsubscribe = null;
  let observer = null;

  function boot() {
    ensurePressureStylesheet(win.document);
    consumeProjection(state.projection);
    root.addEventListener("click", onRootClick, true);
    root.addEventListener("pressure:aemotion:open-center-card", onOpenCenterEvent);
    win.addEventListener?.("online", recoverForward);
    win.addEventListener?.("pageshow", onPageShow);
    observer = new win.MutationObserver(() => scheduleMount());
    observer.observe(root, { childList: true, subtree: true });
    unsubscribe = storage.subscribe((projection) => {
      consumeProjection(projection);
      scheduleMount();
    });
    scheduleMount();
    return api;
  }

  function destroy() {
    state.destroyed = true;
    unsubscribe?.();
    observer?.disconnect();
    root.removeEventListener("click", onRootClick, true);
    root.removeEventListener("pressure:aemotion:open-center-card", onOpenCenterEvent);
    win.removeEventListener?.("online", recoverForward);
    win.removeEventListener?.("pageshow", onPageShow);
    root.querySelectorAll("[data-pressure-center-enhancement], [data-pressure-key-modal-layer]").forEach((node) => node.remove());
    root.querySelectorAll(".pressure-center-host").forEach((node) => node.classList.remove("pressure-center-host"));
    root.classList.remove(MODAL_ACTIVE_CLASS);
    delete root.dataset.pressureModalActive;
  }

  function consumeProjection(value) {
    const projection = validatePressureProjectionV1(value, storage.runId);
    state.projection = projection;
    if (state.activeCenterEventId) {
      const updated = findNewestFeedItem(projection.feedPage.items, state.activeCenterEventId);
      if (updated?.centerCard) state.activeCenterCard = structuredClone(updated.centerCard);
      else {
        state.activeCenterEventId = "";
        state.activeCenterCard = null;
      }
    }
    state.modalQueue = orderPressureModalQueueV1(projection.feedPage.items);
    const projectedModalKeys = new Set(state.modalQueue.map((modal) => modal.dedupeKey));
    for (const key of state.suppressedModalKeys) {
      if (!projectedModalKeys.has(key)) state.suppressedModalKeys.delete(key);
    }
    if (state.activeModal) {
      const replacement = projection.feedPage.items
        .map((item) => item.keyModal)
        .find((modal) => modal?.dedupeKey === state.activeModal.dedupeKey);
      if (replacement) {
        state.activeModal = structuredClone(replacement);
      } else {
        const shownCard = state.activeModal.card;
        state.activeModal = null;
        state.activeCenterCard = structuredClone(shownCard);
        state.activeCenterEventId = shownCard.sourceEventId;
      }
    }
    activateNextModal();
    syncModalVisualState();
    if (!state.activeCenterCard) {
      const selected = selectPressureCenterCardV1(projection.feedPage.items, new Set(), state.hiddenCenterEventIds);
      if (selected) {
        state.activeCenterEventId = selected.sourceEventId;
        state.activeCenterCard = selected;
      }
    }
  }

  function activateNextModal() {
    if (state.activeModal || state.destroyed) return;
    const next = state.modalQueue.find((modal) => !state.suppressedModalKeys.has(modal.dedupeKey));
    if (!next) return;
    state.activeModal = structuredClone(next);
    state.activeCenterCard = structuredClone(next.card);
    state.activeCenterEventId = next.card.sourceEventId;
    syncModalVisualState();
  }

  function syncModalVisualState() {
    const modalActive = Boolean(state.activeModal);
    root.classList.toggle(MODAL_ACTIVE_CLASS, modalActive);
    if (modalActive) {
      root.dataset.pressureModalActive = "true";
      // Suppress synchronously, before the queued remount, so a previously
      // mounted center card cannot ghost through the translucent modal layer.
      root.querySelectorAll("[data-pressure-center-enhancement]").forEach((node) => {
        node.setAttribute("aria-hidden", "true");
        node.hidden = true;
        node.remove();
      });
      root.querySelectorAll(".pressure-center-host").forEach((node) => node.classList.remove("pressure-center-host"));
    } else {
      delete root.dataset.pressureModalActive;
    }
  }

  function markActiveModalShown() {
    const modal = state.activeModal;
    if (!modal || typeof storage.markModalShown !== "function") return;
    void storage.markModalShown(modal).catch(() => {
      if (!state.destroyed && state.activeModal?.dedupeKey === modal.dedupeKey) {
        win.setTimeout?.(scheduleMount, 750);
      }
    });
  }

  function scheduleMount() {
    if (state.destroyed || state.mountQueued) return;
    state.mountQueued = true;
    const enqueue = win?.queueMicrotask || globalThis.queueMicrotask || ((callback) => Promise.resolve().then(callback));
    enqueue(() => {
      state.mountQueued = false;
      mount();
    });
  }

  function mount() {
    if (state.destroyed || state.mounting) return;
    state.mounting = true;
    observer?.disconnect();
    try {
      const modalActive = Boolean(state.activeModal);
      syncModalVisualState();
      root.querySelectorAll("[data-pressure-center-enhancement], [data-pressure-key-modal-layer]").forEach((node) => node.remove());
      root.querySelectorAll(".pressure-center-host").forEach((node) => node.classList.remove("pressure-center-host"));
      mountFeed();
      const center = root.querySelector(".causal-center");
      if (center && state.activeCenterCard && !modalActive) {
        center.classList.add("pressure-center-host");
        const layer = win.document.createElement("div");
        layer.className = "pressure-center-enhancement";
        layer.dataset.pressureCenterEnhancement = "true";
        layer.innerHTML = renderPressureStateCardV1(state.activeCenterCard, {
          actionAllowed: (action) => workbenchAllowed(state.projection, action)
        });
        center.append(layer);
      }
      if (state.activeModal) {
        const layer = win.document.createElement("div");
        layer.className = "pressure-key-modal-layer";
        layer.dataset.pressureKeyModalLayer = "true";
        layer.innerHTML = renderPressureKeyModalV1(state.activeModal, {
          actionAllowed: (action) => workbenchAllowed(state.projection, action)
        });
        root.append(layer);
        // The server mark is emitted only after the modal DOM exists. A failed
        // request keeps the same idempotency key and is retried; GET never
        // implies MODAL_SHOWN.
        if (layer.isConnected && layer.querySelector("[data-testid]")) markActiveModalShown();
        if (!state.modalFocus) state.modalFocus = captureFocus(root);
        layer.querySelector("button:not([disabled])")?.focus?.({ preventScroll: true });
      }
    } finally {
      state.mounting = false;
      if (!state.destroyed) observer?.observe(root, { childList: true, subtree: true });
    }
  }

  function onRootClick(event) {
    if (state.destroyed) return;
    const loadOlder = event.target?.closest?.("[data-pressure-feed-load-older]");
    if (loadOlder && root.contains(loadOlder)) {
      event.preventDefault();
      if (state.feedLoading || state.projection.feedPage.nextCursor === null) return;
      state.feedLoading = true;
      scheduleMount();
      void storage.loadOlderFeed(10).catch(() => {}).finally(() => {
        state.feedLoading = false;
        scheduleMount();
      });
      return;
    }
    const modalButton = event.target?.closest?.("[data-pressure-modal-action]");
    if (modalButton && root.contains(modalButton)) {
      event.preventDefault();
      event.stopImmediatePropagation();
      handleCardAction(modalButton.dataset.pressureModalAction, true);
      return;
    }
    const centerButton = event.target?.closest?.("[data-pressure-card-action]");
    if (centerButton && root.contains(centerButton)) {
      event.preventDefault();
      event.stopImmediatePropagation();
      handleCardAction(centerButton.dataset.pressureCardAction, false);
      return;
    }
    const feedItem = event.target?.closest?.(FEED_ITEM_SELECTOR);
    if (!feedItem || !root.contains(feedItem) || !feedItem.closest(FEED_HOST_SELECTOR)) return;
    const index = Number(feedItem.dataset.pressureFeedIndex);
    const legacyEventId = feedItem.dataset.pressureFeedEventId
      || feedItem.dataset.pressureEventId
      || feedItem.dataset.aemotionEventId
      || feedItem.dataset.aemotionOpen
      || feedItem.dataset.eventId;
    const item = Number.isSafeInteger(index)
      ? state.projection.feedPage.items[index]
      : findNewestFeedItem(state.projection.feedPage.items, legacyEventId || "");
    if (!item?.centerCard || item.centerCard.type !== "CROSS_IMPACT") return;
    state.hiddenCenterEventIds.delete(item.eventId);
    state.activeCenterEventId = item.eventId;
    state.activeCenterCard = structuredClone(item.centerCard);
    scheduleMount();
  }

  function onOpenCenterEvent(event) {
    const eventId = String(event?.detail?.eventId || "");
    const item = state.projection.feedPage.items.find((candidate) => candidate.eventId === eventId);
    if (!item?.centerCard) return;
    state.hiddenCenterEventIds.delete(item.eventId);
    state.activeCenterEventId = item.eventId;
    state.activeCenterCard = structuredClone(item.centerCard);
    scheduleMount();
  }

  function mountFeed() {
    const host = root.querySelector(FEED_HOST_SELECTOR);
    if (!host) return;
    let page = host.querySelector("[data-pressure-feed-page]");
    if (!page) {
      page = win.document.createElement("section");
      page.dataset.pressureFeedPage = "true";
      host.append(page);
    }
    page.innerHTML = renderPressureFeedPageV1(state.projection.feedPage, {
      loading: state.feedLoading
    });
  }

  function onPageShow(event) {
    if (event?.persisted === true) recoverForward();
  }

  function recoverForward() {
    if (state.destroyed || state.recoveryPromise) return state.recoveryPromise;
    const refresh = storyApp.refresh?.bind(storyApp);
    if (typeof refresh !== "function") return null;
    state.recoveryPromise = Promise.resolve(refresh({ silent: true }))
      .catch(() => null)
      .finally(() => { state.recoveryPromise = null; });
    return state.recoveryPromise;
  }

  function handleCardAction(slot, fromModal) {
    const card = fromModal ? state.activeModal?.card : state.activeCenterCard;
    if (!card) return;
    const action = slot === "primary"
      ? card.primaryAction
      : slot === "secondary"
        ? card.secondaryAction
        : card.tertiaryAction;
    if (!action) return;

    if (action.preferredEntry === "DEFER") {
      if (fromModal) closeModal({ keepCenterCard: true });
      else {
        state.hiddenCenterEventIds.add(card.sourceEventId);
        state.activeCenterCard = null;
        state.activeCenterEventId = "";
        scheduleMount();
      }
      return;
    }

    const item = state.projection.feedPage.items.find((candidate) => candidate.eventId === card.sourceEventId);
    const opened = openPressureResponseInExistingWorkbenchV1({
      app: storyApp,
      root,
      storage,
      item,
      action,
      window: win
    });
    if (opened && fromModal) {
      closeModal({ keepCenterCard: true, restore: false });
      return;
    }
    scheduleMount();
  }

  function closeModal({ keepCenterCard = true, restore = true } = {}) {
    const closing = state.activeModal;
    state.activeModal = null;
    if (closing?.dedupeKey) state.suppressedModalKeys.add(closing.dedupeKey);
    if (keepCenterCard && closing?.card) {
      state.activeCenterCard = structuredClone(closing.card);
      state.activeCenterEventId = closing.card.sourceEventId;
    }
    const focus = state.modalFocus;
    state.modalFocus = null;
    activateNextModal();
    syncModalVisualState();
    // Close/switch synchronously: when the queue is empty the retained center
    // card reappears immediately and exactly once; when another modal follows,
    // the center enhancement remains suppressed throughout the hand-off.
    mount();
    if (restore && !state.activeModal) restoreFocus(root, focus);
  }

  const api = {
    boot,
    destroy,
    consumeProjection,
    mount,
    getState: () => ({
      phaseScope: PRESSURE_CHAPTER_PHASE1_SCOPE,
      activeCenterCard: state.activeCenterCard ? structuredClone(state.activeCenterCard) : null,
      activeModal: state.activeModal ? structuredClone(state.activeModal) : null,
      modalQueue: structuredClone(state.modalQueue),
      loadedFeedCount: state.projection.feedPage.items.length,
      unreadCount: state.projection.feedPage.unreadCount
    })
  };
  return api;
}

function ensurePressureStylesheet(documentValue) {
  if (!documentValue?.head || documentValue.querySelector("link[data-pressure-chapter-styles]")) return;
  const link = documentValue.createElement("link");
  link.rel = "stylesheet";
  link.href = "/pressure-chapter-game-v1.css?v=20260813-b5-modal-web-v1";
  link.dataset.pressureChapterStyles = "true";
  documentValue.head.append(link);
}

export function renderPressureStateCardV1(cardValue, { actionAllowed = () => true } = {}) {
  validateCenterCard(cardValue, cardValue?.sourceEventId, "card");
  const card = cardValue;
  const typeClass = card.type.toLowerCase().replace(/_/g, "-");
  return `<section class="pressure-state-card pressure-state-card--${typeClass}" data-testid="pressure-center-card" data-card-type="${escapeHtml(card.type)}" aria-labelledby="pressure-state-card-title">
    ${renderPressureTitleHeaderV1({
      prefix: "pressure-state-card",
      type: card.type,
      title: card.title,
      summary: card.summary,
      titleId: "pressure-state-card-title"
    })}
    <div class="pressure-state-card__blocks">
      ${renderCardBlock("A", card.blockA)}
      ${renderCardBlock("B", card.blockB)}
    </div>
    <div class="pressure-state-card__actions">
      ${renderCardAction("primary", card.primaryAction, actionAllowed(card.primaryAction))}
      ${renderCardAction("secondary", card.secondaryAction, actionAllowed(card.secondaryAction))}
      ${renderCardAction("tertiary", card.tertiaryAction, true)}
    </div>
  </section>`;
}

export function renderPressureFeedPageV1(pageValue, { loading = false } = {}) {
  const page = record(pageValue, "feedPage");
  const items = Array.isArray(page.items) ? page.items : [];
  return `<div class="pressure-feed-summary" aria-label="局势动态">
    <span>局势动态</span>
    <span data-pressure-unread-count>${page.unreadCount} 条未读</span>
  </div>
  <div class="pressure-feed-items">
    ${items.map((item, index) => `<button type="button" class="pressure-feed-item pressure-feed-item--${escapeHtml(item.severity.toLowerCase())}" data-pressure-feed-index="${index}">
      <span class="pressure-feed-item__status">${escapeHtml(item.statusLabel)}</span>
      <strong>${escapeHtml(item.title)}</strong>
      <span>${escapeHtml(item.safeSummary)}</span>
    </button>`).join("")}
  </div>
  ${page.nextCursor === null ? "" : `<button type="button" class="pressure-feed-load-older" data-pressure-feed-load-older ${loading ? "disabled" : ""}>${loading ? "正在加载…" : "加载更早动态"}</button>`}`;
}

export function renderPressureKeyModalV1(modalValue, { actionAllowed = () => true } = {}) {
  const modal = record(modalValue, "modal");
  const pseudoItem = {
    viewerSeatId: String(modal.dedupeKey || "").split(":")[0],
    disclosure: "CONFIRMED",
    recommendedPresentation: "KEY_MODAL",
    severity: modal.type === "CRISIS" ? "CRITICAL" : "MAJOR",
    eventId: modal.sourceEventId,
    eventSequence: modal.serverSequence
  };
  validateKeyModal(modal, pseudoItem, "modal");
  const testId = MODAL_TEST_IDS[modal.type];
  const typeClass = modal.type.toLowerCase().replace(/_/g, "-");
  const ariaLive = modal.type === "STAGE_VICTORY" ? "polite" : "assertive";
  return `<section class="pressure-key-modal pressure-key-modal--${typeClass}" role="dialog" aria-modal="true" aria-live="${ariaLive}" aria-labelledby="pressure-key-modal-title" data-testid="${testId}" data-modal-type="${escapeHtml(modal.type)}">
    ${renderPressureTitleHeaderV1({
      prefix: "pressure-key-modal",
      type: modal.type,
      title: modal.card.title,
      summary: modal.card.summary,
      titleId: "pressure-key-modal-title"
    })}
    <div class="pressure-key-modal__blocks">
      ${renderCardBlock("A", modal.card.blockA)}
      ${renderCardBlock("B", modal.card.blockB)}
    </div>
    <div class="pressure-key-modal__actions">
      ${renderModalAction("primary", modal.card.primaryAction, actionAllowed(modal.card.primaryAction))}
      ${renderModalAction("secondary", modal.card.secondaryAction, actionAllowed(modal.card.secondaryAction))}
      ${renderModalAction("tertiary", modal.card.tertiaryAction, true)}
    </div>
  </section>`;
}

function renderPressureTitleHeaderV1({ prefix, type, title, summary, titleId }) {
  const typeClass = String(type || "").toLowerCase().replace(/_/g, "-");
  const icon = type === "CRISIS"
    ? "!"
    : type === "STAGE_VICTORY"
      ? "✓"
      : type === "PROMISE_BROKEN"
        ? "◆"
        : "✦";
  return `<header class="${prefix}__header">
    <div class="pressure-title-stack pressure-title-stack--${escapeHtml(typeClass)}">
      <span class="pressure-title-emblem" data-pressure-title-icon="${escapeHtml(type)}" aria-hidden="true"><span>${escapeHtml(icon)}</span></span>
      <div class="pressure-title-line">
        <span class="pressure-title-decor pressure-title-decor--left" aria-hidden="true"></span>
        <h2 id="${escapeHtml(titleId)}">${escapeHtml(title)}</h2>
        <span class="pressure-title-decor pressure-title-decor--right" aria-hidden="true"></span>
      </div>
    </div>
    <p>${escapeHtml(summary)}</p>
  </header>`;
}

function renderCardBlock(letter, block) {
  return `<section class="pressure-state-card__block"><span aria-hidden="true">${letter}</span><div><h3>${escapeHtml(block.title)}</h3><ul>${block.lines.map((line) => `<li>${escapeHtml(line)}</li>`).join("")}</ul></div></section>`;
}

function renderCardAction(slot, action, enabled) {
  return `<button type="button" class="pressure-state-card__action pressure-state-card__action--${slot} ${slot === "primary" ? "is-primary" : slot === "tertiary" ? "is-tertiary" : ""}" data-pressure-card-action="${slot}" ${enabled ? "" : "disabled"}>${escapeHtml(action.label)}</button>`;
}

function renderModalAction(slot, action, enabled) {
  return `<button type="button" class="pressure-state-card__action pressure-state-card__action--${slot} ${slot === "primary" ? "is-primary" : slot === "tertiary" ? "is-tertiary" : ""}" data-pressure-modal-action="${slot}" ${enabled ? "" : "disabled"}>${escapeHtml(action.label)}</button>`;
}

export function modalDedupeKeyV1(viewerSeatId, modalType, triggerId, stateVersion) {
  return [viewerSeatId, modalType, triggerId, stateVersion].join(":");
}

export function orderPressureModalQueueV1(items) {
  const byKey = new Map();
  const newest = newestFeedItemsByEvent(Array.isArray(items) ? items : []);
  for (const item of newest) {
    const modal = item?.keyModal;
    if (!modal) continue;
    const existing = byKey.get(modal.dedupeKey);
    if (!existing || modal.serverSequence < existing.serverSequence) {
      byKey.set(modal.dedupeKey, structuredClone(modal));
    }
  }
  return [...byKey.values()]
    .sort((left, right) => right.priority - left.priority || left.serverSequence - right.serverSequence || left.dedupeKey.localeCompare(right.dedupeKey));
}

export function selectPressureCenterCardV1(items, presented = new Set(), hidden = new Set()) {
  const candidates = [];
  for (const item of newestFeedItemsByEvent(Array.isArray(items) ? items : [])) {
    if (!item?.centerCard || hidden.has(item.eventId)) continue;
    const crossEligible = item.centerCard.type === "CROSS_IMPACT"
      && item.severity !== "MINOR"
      && item.recommendedPresentation === "CENTER_CARD"
      && item.keyModal === null;
    const serverRetainedCenter = item.centerCard.type !== "CROSS_IMPACT"
      && item.recommendedPresentation === "CENTER_CARD"
      && item.keyModal === null;
    if (crossEligible || serverRetainedCenter) {
      candidates.push({ card: item.centerCard, eventSequence: item.eventSequence });
    }
  }
  candidates.sort((left, right) => (CENTER_PRIORITY[right.card.type] || 0) - (CENTER_PRIORITY[left.card.type] || 0) || right.eventSequence - left.eventSequence);
  return candidates[0]?.card ? structuredClone(candidates[0].card) : null;
}

function newestFeedItemsByEvent(items) {
  const newest = new Map();
  for (const item of items) {
    const previous = newest.get(item.eventId);
    if (!previous || item.projectionVersion > previous.projectionVersion) newest.set(item.eventId, item);
  }
  return [...newest.values()];
}

export function buildPressureDecisionCommandV1({ projection, optionCode, customText, sourceEventId, responseActionCode, idempotencyKey }) {
  const safe = validatePressureProjectionV1(projection, projection?.runId);
  if (!safe.decision) throw new TypeError("active Pressure decision is required");
  if (safe.capabilities.canSubmitDecision !== true || safe.viewer.control.canSubmit !== true || !safe.viewer.control.submissionFenceToken) {
    throw new TypeError("viewer cannot submit this Pressure decision");
  }
  const parsedOption = optionCode === null ? null : requiredString(optionCode, "optionCode", 200);
  const parsedCustom = customText === null ? null : requiredString(customText, "customText", 500);
  if (parsedOption === null && parsedCustom === null) throw new TypeError("optionCode or customText is required");
  const parsedSource = sourceEventId === null ? null : requiredString(sourceEventId, "sourceEventId", 200);
  const parsedResponseAction = responseActionCode === null
    ? null
    : requiredString(responseActionCode, "responseActionCode", 200);
  if ((parsedSource === null) !== (parsedResponseAction === null)) {
    throw new TypeError("sourceEventId and responseActionCode must be paired");
  }
  return {
    schemaVersion: PRESSURE_CHAPTER_GAME_COMMAND_SCHEMA_V1,
    commandType: "SUBMIT_DECISION",
    runId: safe.runId,
    routeHash: safe.route.routeHash,
    chapterRuntimeId: safe.chapter.chapterRuntimeId,
    chapterId: safe.chapter.chapterId,
    decisionPointId: safe.decision.decisionPointId,
    seatId: safe.viewer.seatId,
    controlEpoch: safe.viewer.control.controlEpoch,
    expectedWorkingRevision: safe.decision.expectedWorkingRevision,
    submissionFenceToken: safe.viewer.control.submissionFenceToken,
    idempotencyKey: requiredString(idempotencyKey, "idempotencyKey", 200),
    optionCode: parsedOption,
    customText: parsedCustom,
    sourceEventId: parsedSource,
    responseActionCode: parsedResponseAction
  };
}
export function validatePressureProjectionV1(value, expectedRunId = "") {
  const projection = record(value, "projection");
  exactKeys(projection, ["schemaVersion", "projectionVersion", "roomId", "runId", "route", "chapter", "viewer", "metrics", "situation", "resources", "tokens", "decision", "capabilities", "narrative", "feedPage", "projectionHash"], "projection");
  literal(projection.schemaVersion, PRESSURE_CHAPTER_GAME_SCHEMA_V1, "projection.schemaVersion");
  integer(projection.projectionVersion, "projection.projectionVersion", 1);
  requiredString(projection.roomId, "projection.roomId", 300);
  requiredString(projection.runId, "projection.runId", 300);
  if (expectedRunId && projection.runId !== expectedRunId) throw new TypeError("projection.runId mismatch");
  hash(projection.projectionHash, "projection.projectionHash");
  validateRoute(projection.route);
  validateChapter(projection.chapter);
  validateViewer(projection.viewer);
  validateMetrics(projection.metrics);
  validateSituation(projection.situation);
  validateResources(projection.resources);
  validateTokens(projection.tokens);
  validateDecision(projection.decision, projection.chapter.workingRevision);
  validateCapabilities(projection.capabilities);
  validateNarrative(projection.narrative);
  validateFeedPage(projection.feedPage, projection);
  return structuredClone(value);
}

function validateRoute(value) {
  const route = record(value, "projection.route");
  exactKeys(route, ["routeHash", "participantMode", "runtimeProfile", "contentPackageVersion", "controlTopologyVersion"], "projection.route");
  hash(route.routeHash, "projection.route.routeHash");
  requiredString(route.participantMode, "projection.route.participantMode", 100);
  requiredString(route.runtimeProfile, "projection.route.runtimeProfile", 200);
  requiredString(route.contentPackageVersion, "projection.route.contentPackageVersion", 200);
  requiredString(route.controlTopologyVersion, "projection.route.controlTopologyVersion", 200);
}

function validateChapter(value) {
  const chapter = record(value, "projection.chapter");
  exactKeys(chapter, ["chapterRuntimeId", "chapterId", "chapterNumber", "title", "phase", "workingRevision"], "projection.chapter");
  requiredString(chapter.chapterRuntimeId, "projection.chapter.chapterRuntimeId", 300);
  enumeration(chapter.chapterId, CHAPTER_IDS, "projection.chapter.chapterId");
  integer(chapter.chapterNumber, "projection.chapter.chapterNumber", 0, 7);
  requiredString(chapter.title, "projection.chapter.title", 300);
  enumeration(chapter.phase, ["ACTIVE", "RESOLVING_BEAT", "SETTLING", "FROZEN", "FINALE_REQUESTED"], "projection.chapter.phase");
  integer(chapter.workingRevision, "projection.chapter.workingRevision", 0);
}

function validateViewer(value) {
  const viewer = record(value, "projection.viewer");
  exactKeys(viewer, ["seatId", "roleName", "control"], "projection.viewer");
  requiredString(viewer.seatId, "projection.viewer.seatId", 100);
  requiredString(viewer.roleName, "projection.viewer.roleName", 200);
  const control = record(viewer.control, "projection.viewer.control");
  exactKeys(control, ["mode", "controlEpoch", "canSubmit", "canReclaim", "submissionFenceToken", "reclaimFenceToken"], "projection.viewer.control");
  enumeration(control.mode, ["HUMAN_ACTIVE", "AI_ACTIVE"], "projection.viewer.control.mode");
  integer(control.controlEpoch, "projection.viewer.control.controlEpoch", 1);
  boolean(control.canSubmit, "projection.viewer.control.canSubmit");
  boolean(control.canReclaim, "projection.viewer.control.canReclaim");
  nullableHash(control.submissionFenceToken, "projection.viewer.control.submissionFenceToken");
  nullableHash(control.reclaimFenceToken, "projection.viewer.control.reclaimFenceToken");
}

function validateMetrics(value) {
  if (!Array.isArray(value) || value.length !== 5) throw new TypeError("projection.metrics must contain exactly five metrics");
  const ids = new Set();
  for (const [index, metricValue] of value.entries()) {
    const metric = record(metricValue, `projection.metrics[${index}]`);
    exactKeys(metric, ["trackId", "label", "value", "displayValue", "tone"], `projection.metrics[${index}]`);
    requiredString(metric.trackId, `projection.metrics[${index}].trackId`, 200);
    requiredString(metric.label, `projection.metrics[${index}].label`, 200);
    finite(metric.value, `projection.metrics[${index}].value`);
    requiredString(metric.displayValue, `projection.metrics[${index}].displayValue`, 100);
    enumeration(metric.tone, METRIC_TONES, `projection.metrics[${index}].tone`);
    if (ids.has(metric.trackId)) throw new TypeError("duplicate projection metric");
    ids.add(metric.trackId);
  }
}

function validateSituation(value) {
  const situation = record(value, "projection.situation");
  exactKeys(situation, ["goal", "risk", "judgment"], "projection.situation");
  requiredString(situation.goal, "projection.situation.goal", 500);
  requiredString(situation.risk, "projection.situation.risk", 500);
  requiredString(situation.judgment, "projection.situation.judgment", 500);
}

function validateResources(value) {
  if (!Array.isArray(value) || value.length > 30) throw new TypeError("projection.resources invalid");
  for (const [index, resourceValue] of value.entries()) {
    const resource = record(resourceValue, `projection.resources[${index}]`);
    exactKeys(resource, ["resourceId", "label", "value", "displayValue"], `projection.resources[${index}]`);
    requiredString(resource.resourceId, `projection.resources[${index}].resourceId`, 200);
    requiredString(resource.label, `projection.resources[${index}].label`, 200);
    finite(resource.value, `projection.resources[${index}].value`);
    requiredString(resource.displayValue, `projection.resources[${index}].displayValue`, 100);
  }
}

function validateTokens(value) {
  if (!Array.isArray(value) || value.length > 30) throw new TypeError("projection.tokens invalid");
  for (const [index, tokenValue] of value.entries()) {
    const token = record(tokenValue, `projection.tokens[${index}]`);
    exactKeys(token, ["tokenId", "label", "description", "quantity", "available"], `projection.tokens[${index}]`);
    requiredString(token.tokenId, `projection.tokens[${index}].tokenId`, 200);
    requiredString(token.label, `projection.tokens[${index}].label`, 200);
    requiredString(token.description, `projection.tokens[${index}].description`, 500);
    integer(token.quantity, `projection.tokens[${index}].quantity`, 0);
    boolean(token.available, `projection.tokens[${index}].available`);
  }
}

function validateDecision(value, workingRevision) {
  if (value === null) return;
  const decision = record(value, "projection.decision");
  exactKeys(decision, ["decisionPointId", "mode", "requirement", "title", "summary", "expectedWorkingRevision", "options", "submitLabel", "customActionAllowed"], "projection.decision");
  requiredString(decision.decisionPointId, "projection.decision.decisionPointId", 300);
  enumeration(decision.mode, ["SOLO_BEAT", "TARGETED_INTERACTION", "SYNC_CONTEST"], "projection.decision.mode");
  enumeration(decision.requirement, ["REQUIRED", "NOT_REQUIRED"], "projection.decision.requirement");
  requiredString(decision.title, "projection.decision.title", 500);
  requiredString(decision.summary, "projection.decision.summary", 1000);
  integer(decision.expectedWorkingRevision, "projection.decision.expectedWorkingRevision", 0);
  if (decision.expectedWorkingRevision !== workingRevision) throw new TypeError("decision revision mismatch");
  if (!Array.isArray(decision.options) || decision.options.length < 1 || decision.options.length > 8) throw new TypeError("decision options invalid");
  for (const [index, optionValue] of decision.options.entries()) {
    const option = record(optionValue, `projection.decision.options[${index}]`);
    exactKeys(option, ["code", "label", "description", "actionType", "preferredEntry"], `projection.decision.options[${index}]`);
    requiredString(option.code, `projection.decision.options[${index}].code`, 200);
    requiredString(option.label, `projection.decision.options[${index}].label`, 500);
    requiredString(option.description, `projection.decision.options[${index}].description`, 1000);
    requiredString(option.actionType, `projection.decision.options[${index}].actionType`, 200);
    enumeration(option.preferredEntry, WORKBENCH_TYPES, `projection.decision.options[${index}].preferredEntry`);
  }
  requiredString(decision.submitLabel, "projection.decision.submitLabel", 200);
  boolean(decision.customActionAllowed, "projection.decision.customActionAllowed");
}

function validateCapabilities(value) {
  const capabilities = record(value, "projection.capabilities");
  exactKeys(capabilities, ["canSubmitDecision", "canTalk", "canInvestigate", "canUseToken", "canPlan", "canReclaimControl", "allowedActionTypes"], "projection.capabilities");
  for (const key of ["canSubmitDecision", "canTalk", "canInvestigate", "canUseToken", "canPlan", "canReclaimControl"]) boolean(capabilities[key], `projection.capabilities.${key}`);
  if (!Array.isArray(capabilities.allowedActionTypes) || capabilities.allowedActionTypes.some((item) => typeof item !== "string" || !NON_EMPTY.test(item))) throw new TypeError("allowedActionTypes invalid");
}

function validateNarrative(value) {
  const narrative = record(value, "projection.narrative");
  exactKeys(narrative, ["status", "projectionKind", "sourceAuthority", "sourceId", "sourceCommitHash", "text", "contentHash", "renderMode"], "projection.narrative");
  requiredString(narrative.status, "projection.narrative.status", 100);
  requiredString(narrative.projectionKind, "projection.narrative.projectionKind", 100);
  requiredString(narrative.sourceAuthority, "projection.narrative.sourceAuthority", 100);
  requiredString(narrative.sourceId, "projection.narrative.sourceId", 300);
  hash(narrative.sourceCommitHash, "projection.narrative.sourceCommitHash");
  if (narrative.text !== null) requiredString(narrative.text, "projection.narrative.text", 20_000);
  if (narrative.contentHash !== null) hash(narrative.contentHash, "projection.narrative.contentHash");
  if (narrative.renderMode !== null) enumeration(narrative.renderMode, ["PROVIDER", "AUTHORED_FALLBACK"], "projection.narrative.renderMode");
}

function validateFeedPage(value, projection) {
  const page = record(value, "projection.feedPage");
  exactKeys(page, ["schemaVersion", "roomId", "runId", "viewerSeatId", "items", "unreadCount", "nextCursor", "serverSequence"], "projection.feedPage");
  literal(page.schemaVersion, "a_emotion_feed_page_v1", "projection.feedPage.schemaVersion");
  if (page.roomId !== projection.roomId || page.runId !== projection.runId || page.viewerSeatId !== projection.viewer.seatId) throw new TypeError("feed scope mismatch");
  if (!Array.isArray(page.items) || page.items.length > 100) throw new TypeError("feed items invalid");
  integer(page.unreadCount, "projection.feedPage.unreadCount", 0);
  integer(page.serverSequence, "projection.feedPage.serverSequence", 0);
  if (page.nextCursor !== null) requiredString(page.nextCursor, "projection.feedPage.nextCursor", 500);
  const eventVersions = new Set();
  for (const [index, itemValue] of page.items.entries()) {
    validateFeedItem(itemValue, projection, index);
    const identity = `${itemValue.eventId}\u0000${itemValue.projectionVersion}`;
    if (eventVersions.has(identity)) throw new TypeError("duplicate feed event projection");
    eventVersions.add(identity);
  }
}

function validateFeedItem(value, projection, index) {
  const path = `projection.feedPage.items[${index}]`;
  const item = record(value, path);
  const allowed = ["schemaVersion", "eventId", "projectionVersion", "roomId", "runId", "viewerSeatId", "category", "disclosure", "severity", "title", "safeSummary", "statusLabel", "visibleImpacts", "visibleSourceSeatId", "visibleSuspectedSeatIds", "responseOptions", "recommendedPresentation", "centerCard", "keyModal", "eventSequence", "occurredAt", "projectionHash", "isUnread", "isAcknowledged", "isResolved"];
  const required = allowed.filter((key) => !["visibleSourceSeatId", "visibleSuspectedSeatIds"].includes(key));
  exactKeys(item, allowed, path, required);
  literal(item.schemaVersion, "a_emotion_viewer_projection_v1", `${path}.schemaVersion`);
  requiredString(item.eventId, `${path}.eventId`, 200);
  integer(item.projectionVersion, `${path}.projectionVersion`, 1);
  if (item.roomId !== projection.roomId || item.runId !== projection.runId || item.viewerSeatId !== projection.viewer.seatId) throw new TypeError(`${path} scope mismatch`);
  enumeration(item.category, FEED_CATEGORIES, `${path}.category`);
  enumeration(item.disclosure, DISCLOSURES, `${path}.disclosure`);
  enumeration(item.severity, SEVERITIES, `${path}.severity`);
  requiredString(item.title, `${path}.title`, 500);
  requiredString(item.safeSummary, `${path}.safeSummary`, 1000);
  requiredString(item.statusLabel, `${path}.statusLabel`, 200);
  if (!Array.isArray(item.visibleImpacts) || item.visibleImpacts.length > 12) throw new TypeError(`${path}.visibleImpacts invalid`);
  for (const [impactIndex, impactValue] of item.visibleImpacts.entries()) {
    const impact = record(impactValue, `${path}.visibleImpacts[${impactIndex}]`);
    exactKeys(impact, ["effectCode", "label", "value"], `${path}.visibleImpacts[${impactIndex}]`);
    requiredString(impact.effectCode, `${path}.visibleImpacts[${impactIndex}].effectCode`, 200);
    requiredString(impact.label, `${path}.visibleImpacts[${impactIndex}].label`, 200);
    requiredString(impact.value, `${path}.visibleImpacts[${impactIndex}].value`, 200);
  }
  const hasSource = Object.prototype.hasOwnProperty.call(item, "visibleSourceSeatId");
  const hasSuspected = Object.prototype.hasOwnProperty.call(item, "visibleSuspectedSeatIds");
  if (item.disclosure === "HIDDEN" && (hasSource || hasSuspected)) throw new TypeError(`${path} hidden disclosure leaked identity`);
  if (item.disclosure === "SUSPECTED" && (hasSource || !hasSuspected)) throw new TypeError(`${path} suspected disclosure shape invalid`);
  if (item.disclosure === "CONFIRMED" && (!hasSource || hasSuspected)) throw new TypeError(`${path} confirmed disclosure shape invalid`);
  if (hasSource) requiredString(item.visibleSourceSeatId, `${path}.visibleSourceSeatId`, 100);
  if (hasSuspected) stringArray(item.visibleSuspectedSeatIds, `${path}.visibleSuspectedSeatIds`, 20);
  if (!Array.isArray(item.responseOptions) || item.responseOptions.length > 10) throw new TypeError(`${path}.responseOptions invalid`);
  item.responseOptions.forEach((action, actionIndex) => validateCardAction(action, `${path}.responseOptions[${actionIndex}]`));
  enumeration(item.recommendedPresentation, PRESENTATIONS, `${path}.recommendedPresentation`);
  if (item.centerCard !== null) validateCenterCard(item.centerCard, item.eventId, `${path}.centerCard`);
  if (item.keyModal !== null) validateKeyModal(item.keyModal, item, `${path}.keyModal`);
  if (
    item.recommendedPresentation === "CENTER_CARD" && (!item.centerCard || item.keyModal)
    || item.recommendedPresentation === "KEY_MODAL" && (!item.centerCard || !item.keyModal)
    || item.recommendedPresentation === "FEED_ONLY" && item.keyModal
  ) throw new TypeError(`${path}.recommendedPresentation shape invalid`);
  integer(item.eventSequence, `${path}.eventSequence`, 1);
  if (Number.isNaN(Date.parse(item.occurredAt))) throw new TypeError(`${path}.occurredAt invalid`);
  hash(item.projectionHash, `${path}.projectionHash`);
  boolean(item.isUnread, `${path}.isUnread`);
  boolean(item.isAcknowledged, `${path}.isAcknowledged`);
  boolean(item.isResolved, `${path}.isResolved`);
}

function validateCenterCard(value, eventId, path) {
  const card = record(value, path);
  exactKeys(card, ["id", "type", "accent", "title", "summary", "blockA", "blockB", "primaryAction", "secondaryAction", "tertiaryAction", "sourceEventId"], path);
  requiredString(card.id, `${path}.id`, 500);
  enumeration(card.type, CARD_TYPES, `${path}.type`);
  enumeration(card.accent, ["PURPLE", "ORANGE_RED", "GREEN"], `${path}.accent`);
  requiredString(card.title, `${path}.title`, 500);
  requiredString(card.summary, `${path}.summary`, 1000);
  validateCardBlock(card.blockA, `${path}.blockA`);
  validateCardBlock(card.blockB, `${path}.blockB`);
  validateCardAction(card.primaryAction, `${path}.primaryAction`);
  validateCardAction(card.secondaryAction, `${path}.secondaryAction`);
  validateCardAction(card.tertiaryAction, `${path}.tertiaryAction`);
  if (card.sourceEventId !== eventId) throw new TypeError(`${path}.sourceEventId mismatch`);
}

function validateCardBlock(value, path) {
  const block = record(value, path);
  exactKeys(block, ["title", "lines"], path);
  requiredString(block.title, `${path}.title`, 200);
  stringArray(block.lines, `${path}.lines`, 8, true);
}

function validateCardAction(value, path) {
  const action = record(value, path);
  exactKeys(action, ["code", "label", "preferredEntry", "consumesManeuverOnSubmit"], path);
  requiredString(action.code, `${path}.code`, 200);
  requiredString(action.label, `${path}.label`, 200);
  enumeration(action.preferredEntry, WORKBENCH_TYPES, `${path}.preferredEntry`);
  boolean(action.consumesManeuverOnSubmit, `${path}.consumesManeuverOnSubmit`);
}

function validateKeyModal(value, item, path) {
  const modal = record(value, path);
  exactKeys(modal, ["id", "type", "priority", "serverSequence", "sourceEventId", "triggerId", "stateVersion", "dedupeKey", "card"], path);
  requiredString(modal.id, `${path}.id`, 500);
  enumeration(modal.type, MODAL_TYPES, `${path}.type`);
  integer(modal.priority, `${path}.priority`, 100, 300);
  if (modal.priority !== MODAL_PRIORITY[modal.type]) throw new TypeError(`${path}.priority mismatch`);
  if (item.disclosure !== "CONFIRMED" || item.recommendedPresentation !== "KEY_MODAL") throw new TypeError(`${path} requires a confirmed key-modal projection`);
  if (modal.type === "CRISIS" && item.severity !== "CRITICAL") throw new TypeError(`${path} CRISIS must be critical`);
  integer(modal.serverSequence, `${path}.serverSequence`, 1);
  requiredString(modal.sourceEventId, `${path}.sourceEventId`, 300);
  if (modal.serverSequence !== item.eventSequence || modal.sourceEventId !== item.eventId) throw new TypeError(`${path} source identity mismatch`);
  requiredString(modal.triggerId, `${path}.triggerId`, 300);
  integer(modal.stateVersion, `${path}.stateVersion`, 1);
  const expectedDedupe = modalDedupeKeyV1(item.viewerSeatId, modal.type, modal.triggerId, modal.stateVersion);
  if (modal.dedupeKey !== expectedDedupe) throw new TypeError(`${path}.dedupeKey mismatch`);
  validateCenterCard(modal.card, item.eventId, `${path}.card`);
  if (modal.card.type !== modal.type) throw new TypeError(`${path}.card type mismatch`);
}


function textFromExistingManeuverCommandV1(command) {
  if (!command || typeof command !== "object") return null;
  for (const candidate of [command.customText, command.messageText, command.intentText]) {
    const text = String(candidate || "").trim();
    if (text) return text.slice(0, 500);
  }
  return null;
}

function workbenchAllowed(projection, action) {
  const preferredEntry = action?.preferredEntry;
  if (preferredEntry === "DEFER") return true;
  if (projection.chapter.phase !== "ACTIVE" || projection.viewer.control.mode !== "HUMAN_ACTIVE") return false;
  const allowedActionTypes = projection.capabilities.allowedActionTypes || [];
  if (allowedActionTypes.length > 0 && !allowedActionTypes.includes(action?.code)) return false;
  return preferredEntry === "TALK"
    ? projection.capabilities.canTalk === true
    : preferredEntry === "INVESTIGATE"
      ? projection.capabilities.canInvestigate === true
      : preferredEntry === "TOKEN"
        ? projection.capabilities.canUseToken === true
        : preferredEntry === "PLAN"
          ? projection.capabilities.canPlan === true
          : false;
}

function captureFocus(root) {
  const active = root.ownerDocument?.activeElement;
  if (!active || !root.contains(active)) return null;
  return {
    id: active.id || "",
    testId: active.getAttribute?.("data-testid") || "",
    selectionStart: typeof active.selectionStart === "number" ? active.selectionStart : null,
    selectionEnd: typeof active.selectionEnd === "number" ? active.selectionEnd : null
  };
}

function restoreFocus(root, snapshot) {
  if (!snapshot) return;
  const selector = snapshot.id
    ? `#${cssEscape(snapshot.id)}`
    : snapshot.testId
      ? `[data-testid="${cssEscape(snapshot.testId)}"]`
      : "";
  const element = selector ? root.querySelector(selector) : null;
  element?.focus?.({ preventScroll: true });
  if (snapshot.selectionStart !== null && typeof element?.setSelectionRange === "function") {
    element.setSelectionRange(snapshot.selectionStart, snapshot.selectionEnd);
  }
}

function cssEscape(value) {
  return String(value).replace(/[^a-zA-Z0-9_-]/g, (character) => `\\${character}`);
}

function httpError(response, payload, fallback) {
  const message = typeof payload?.message === "string" && payload.message.trim()
    ? payload.message
    : fallback;
  return Object.assign(new Error(message), {
    status: response.status,
    code: payload?.code,
    details: payload?.details
  });
}

function optionLabel(index) {
  return String.fromCharCode("A".charCodeAt(0) + index);
}

function defaultIdempotencyKey() {
  if (globalThis.crypto?.randomUUID) return `pc-web:${globalThis.crypto.randomUUID()}`;
  return `pc-web:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 12)}`;
}

function record(value, path) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${path} must be an object`);
  return value;
}

function exactKeys(value, allowed, path, required = allowed) {
  const unknown = Object.keys(value).find((key) => !allowed.includes(key));
  if (unknown) throw new TypeError(`${path}.${unknown} is not allowed`);
  const missing = required.find((key) => !Object.prototype.hasOwnProperty.call(value, key));
  if (missing) throw new TypeError(`${path}.${missing} is required`);
}

function literal(value, expected, path) {
  if (value !== expected) throw new TypeError(`${path} must equal ${expected}`);
}

function requiredString(value, path, maximumLength = Number.MAX_SAFE_INTEGER) {
  if (typeof value !== "string" || !NON_EMPTY.test(value) || value.length > maximumLength) throw new TypeError(`${path} must be a non-empty string`);
  return value;
}

function integer(value, path, minimum, maximum = Number.MAX_SAFE_INTEGER) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) throw new TypeError(`${path} must be an integer`);
}

function finite(value, path) {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new TypeError(`${path} must be finite`);
}

function boolean(value, path) {
  if (typeof value !== "boolean") throw new TypeError(`${path} must be boolean`);
}

function enumerationValue(value, values, path) {
  enumeration(value, values, path);
  return value;
}

function enumeration(value, values, path) {
  if (!values.includes(value)) throw new TypeError(`${path} has an unsupported value`);
}

function hash(value, path) {
  if (typeof value !== "string" || !HASH.test(value)) throw new TypeError(`${path} must be sha256`);
}

function nullableHash(value, path) {
  if (value !== null) hash(value, path);
}

function stringArray(value, path, maximum, nonEmpty = false) {
  if (!Array.isArray(value) || value.length > maximum || nonEmpty && value.length === 0 || value.some((item) => typeof item !== "string" || !NON_EMPTY.test(item))) throw new TypeError(`${path} must be a string array`);
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  })[character]);
}
