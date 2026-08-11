const M1_EVENT_TYPE = "A_EMOTION_M1_CROSS_IMPACT";
const M1_SCHEMA = "a_emotion_m1_projection_v1";
const M2_SCHEMA = "a_emotion_m2_projection_v1";
const M2_FEED_SCHEMA = "a_emotion_m2_feed_v1";
const KEY_MODAL_SCHEMA = "a_emotion_key_modal_v1";
const KEY_MODAL_RECEIPT_SCHEMA = "a_emotion_key_modal_receipt_v1";
const OPAQUE_MODAL_ID = /^mdl_[A-Za-z0-9_-]{24,}$/u;
const OPAQUE_EVENT_ID = /^evt_[A-Za-z0-9_-]{24,}$/u;
const OPAQUE_AGGREGATE_ID = /^agg_[A-Za-z0-9_-]{24,}$/u;
const OPAQUE_CURSOR = /^m2c_[A-Za-z0-9_-]{32,}$/u;
const RAW_ID_HINT = /(playerAction|targetRoleId|sourceRoleId|dedupe|canonical|rawAudience|action[:_-]|run[:_-])/iu;
const SOURCE_LEAK = /xunfu|巡抚|命令县令|要求县令|只(?:交|提交)(?:了)?(?:转抄)?副本|隐(?:藏|瞒)(?:了)?原(?:始)?粮册/iu;
const M1_FORBIDDEN_KEYS = new Set([
  "source", "sourceId", "sourceRole", "sourceRoleId", "sourceRoleKey", "sourceRoleName",
  "sourceActorId", "sourceActorName", "sourceActionId", "playerActionId", "targetRoleId",
  "targetRoleKey", "targetRoleName", "dedupeKey", "internalDedupeKey", "audience",
  "audienceRoleIds", "audienceUserIds", "rawAudience", "rawAction", "rawPayload",
  "privatePayload", "suspectedRoleIds", "canonicalPayload"
]);
const M2_FORBIDDEN_KEYS = new Set([
  "source", "sourceId", "sourceRole", "sourceRoleId", "sourceRoleKey", "sourceRoleName",
  "sourceActorId", "sourceActorName", "sourceActionId", "playerActionId", "targetRoleId",
  "targetRoleName", "suspectedRoleIds", "dedupeKey", "internalDedupeKey", "audience",
  "audienceRoleIds", "audienceUserIds", "rawAudience", "rawAction", "rawPayload",
  "privatePayload", "canonicalPayload", "aggregateKey"
]);
const M1_ROOT_KEYS = new Set([
  "schemaVersion", "projectionVersion", "stateVersion", "eventSequence", "category", "disclosure",
  "severity", "centerCardType", "title", "summary", "sourceStatus", "knownFacts",
  "visibleImpacts", "responseOptions", "occurredAt"
]);
const M1_IMPACT_KEYS = new Set(["key", "label", "before", "after", "delta", "suffix", "safeReason"]);
const M1_RESPONSE_KEYS = new Set(["code", "label", "preferredEntry", "intentKey", "prefillText"]);
const KEY_MODAL_KEYS = new Set(["schemaVersion", "modalId", "eventId", "modalType", "triggerCode", "triggerVersion", "projectionVersion", "stateVersion", "priority", "title", "summary", "facts", "responseOptions", "ariaLive", "occurredAt", "isShown", "isAcknowledged"]);
const KEY_MODAL_RESPONSE_KEYS = new Set(["code", "label", "preferredEntry", "intentKey", "prefillText"]);
const KEY_MODAL_RECEIPT_KEYS = new Set(["schemaVersion", "modalId", "eventId", "projectionVersion", "stateVersion", "triggerVersion", "shownAt", "acknowledgedAt"]);

/**
 * M2 extends the accepted M1 UI in-place. It never replaces /game or creates a
 * parallel message centre. The service may still return raw M1 deliveries for
 * old rooms; new M2 rooms additionally return the durable aggregate feed.
 */
export function createAEmotionM1Ui({ root, window: win, runId, fetchImpl, getProjection, prefillWorkbench }) {
  if (!root || !runId || typeof fetchImpl !== "function" || typeof getProjection !== "function" || typeof prefillWorkbench !== "function") {
    throw new TypeError("A-Emotion UI requires root, runId, fetch and projection access");
  }

  let deliveryCursor = 0;
  let feedCursor = null;
  let activeEventId = "";
  let expanded = false;
  let items = [];
  let pendingItems = null;
  let pendingNewCount = 0;
  let destroyed = false;
  let refreshInFlight = false;
  let renderScheduled = false;
  let seenTimers = new Map();
  let keyModals = [];
  let activeKeyModal = null;
  let modalFocusSnapshot = null;
  let feedUnavailable = false;

  const observer = new win.MutationObserver(() => scheduleRender());
  observer.observe(root, { childList: true, subtree: true });

  function scheduleRender() {
    if (destroyed || renderScheduled) return;
    renderScheduled = true;
    Promise.resolve().then(() => {
      renderScheduled = false;
      render();
    });
  }

  async function refresh() {
    if (destroyed || refreshInFlight) return;
    refreshInFlight = true;
    const previousFeed = root.querySelector("[data-aemotion-feed-list]");
    const userAwayFromTop = Number(previousFeed?.scrollTop || 0) > 8;
    try {
      const query = new URLSearchParams({
        afterDeliverySequence: String(deliveryCursor),
        interactionLimit: "10"
      });
      const requestedInteractionCursor = feedCursor && OPAQUE_CURSOR.test(feedCursor) ? feedCursor : null;
      if (feedCursor && !requestedInteractionCursor) return failClosed();
      if (requestedInteractionCursor) query.set("interactionCursor", requestedInteractionCursor);
      const response = await fetchImpl(`/api/v4/rooms/${encodeURIComponent(runId)}/events?${query}`, {
        credentials: "include",
        cache: "no-store",
        headers: { accept: "application/json" }
      });
      const page = await response.json().catch(() => ({}));
      if (!response.ok) {
        if (response.status >= 500) return transportUnavailable();
        return failClosed();
      }
      if (!Number.isInteger(page.nextAfterDeliverySequence) || page.nextAfterDeliverySequence < deliveryCursor || !Array.isArray(page.deliveries)) return failClosed();
      deliveryCursor = page.nextAfterDeliverySequence;

      let nextItems;
      if (page.interactionFeed !== undefined) {
        const feed = validateM2Feed(page.interactionFeed, getProjection());
        if (!feed) return failClosed();
        nextItems = requestedInteractionCursor
          ? mergeM2FeedItems(items, feed.items)
          : feed.items;
        feedCursor = feed.nextCursor;
      } else {
        nextItems = mergeLegacyM1Deliveries(items, page.deliveries, getProjection());
        if (!nextItems) return failClosed();
      }
      const nextModals = validateKeyModalList(page.keyModals === undefined ? [] : page.keyModals);
      if (!nextModals) return failClosed();
      keyModals = mergeKeyModals(keyModals, nextModals);
      feedUnavailable = false;

      const added = nextItems.filter((candidate) => !items.some((current) => current.eventId === candidate.eventId && current.projectionVersion === candidate.projectionVersion)).length;
      if (userAwayFromTop && added > 0) {
        pendingItems = nextItems;
        pendingNewCount += added;
      } else {
        items = nextItems.slice(0, 10);
        pendingItems = null;
        pendingNewCount = 0;
      }
      render();
      await openNextKeyModal();
    } catch {
      transportUnavailable();
    } finally {
      refreshInFlight = false;
    }
  }

  function acceptPending() {
    if (pendingItems) items = pendingItems.slice(0, 10);
    pendingItems = null;
    pendingNewCount = 0;
    render({ scrollToTop: true });
  }

  function transportUnavailable() {
    feedUnavailable = true;
    // A transport outage must not erase the last viewer-safe projection or
    // interrupt the player's decision/workbench drafts. Authoritative state
    // is restored by the next successful refresh.
    render();
  }

  function failClosed(unavailable = false) {
    feedUnavailable = unavailable === true;
    items = [];
    pendingItems = null;
    pendingNewCount = 0;
    activeEventId = "";
    keyModals = [];
    activeKeyModal = null;
    modalFocusSnapshot = null;
    clearSeenTimers();
    render();
  }

  function render(options = {}) {
    if (destroyed) return;
    observer.disconnect();
    root.querySelector("[data-aemotion-key-modal]")?.remove();
    const previousList = root.querySelector("[data-aemotion-feed-list]");
    const previousScrollTop = Number(previousList?.scrollTop || 0);
    const focused = root.ownerDocument.activeElement;
    const focusedId = focused?.id || "";
    const selection = typeof focused?.selectionStart === "number"
      ? { start: focused.selectionStart, end: focused.selectionEnd }
      : null;

    // Owner-approved M2 UI is limited to one right-rail module titled
    // “世界局势”. Remove any legacy central card or metric hint left by an
    // earlier renderer before mounting the approved surface.
    root.querySelectorAll("[data-aemotion-m1-feed], [data-aemotion-m1-card], [data-aemotion-m1-metric-hint], [data-aemotion-key-modal]").forEach((node) => node.remove());
    if (!items.length) {
      if (feedUnavailable) {
        const rightRail = root.querySelector(".causal-right");
        if (rightRail) {
          const fallback = win.document.createElement("section");
          fallback.dataset.aemotionWorldSituation = "true";
          fallback.className = "maneuver-panel aemotion-world-situation aemotion-world-situation--unavailable";
          fallback.setAttribute("aria-label", "世界局势");
          fallback.innerHTML = `<div class="aemotion-m1-feed-head"><div><b>世界局势</b></div></div><p role="status">世界局势暂未更新</p>`;
          const maneuverPanel = rightRail.querySelector('[data-testid="maneuver-panel"]') || rightRail.querySelector(".maneuver-panel");
          if (maneuverPanel?.parentElement === rightRail) rightRail.insertBefore(fallback, maneuverPanel.nextSibling);
          else rightRail.append(fallback);
        }
      }
      if (activeKeyModal) renderKeyModal(activeKeyModal);
      observer.observe(root, { childList: true, subtree: true });
      return;
    }

    const rightRail = root.querySelector(".causal-right");
    if (rightRail) {
      const feed = win.document.createElement("section");
      feed.dataset.aemotionM1Feed = "true";
      feed.dataset.aemotionM2Feed = "true";
      feed.dataset.aemotionWorldSituation = "true";
      feed.dataset.testid = "aemotion-m1-feed";
      feed.className = "maneuver-panel aemotion-world-situation aemotion-m1-feed aemotion-m2-feed";
      feed.setAttribute("aria-label", "世界局势");
      const visibleCount = expanded ? 6 : 3;
      const visible = items.slice(0, visibleCount);
      const active = items.find((item) => item.eventId === activeEventId) || null;
      feed.innerHTML = `
        <div class="aemotion-m1-feed-head">
          <div><b>世界局势</b><span>${items.filter((item) => item.isUnread).length} 条未读</span></div>
          <button type="button" data-aemotion-expand>${expanded ? "收起" : "展开"}</button>
        </div>
        ${feedUnavailable ? `<p class="aemotion-world-situation-transport" role="status">世界局势暂未更新</p>` : ""}
        ${pendingNewCount > 0 ? `<button class="aemotion-new-events" type="button" data-aemotion-new-events>${pendingNewCount} 条新动态</button>` : ""}
        <div class="aemotion-m1-feed-list" data-aemotion-feed-list tabindex="0">
          ${visible.map(feedItemHtml).join("")}
        </div>
        ${active ? worldSituationDetailHtml(active) : ""}`;

      const maneuverPanel = rightRail.querySelector('[data-testid="maneuver-panel"]') || rightRail.querySelector(".maneuver-panel");
      if (maneuverPanel?.parentElement === rightRail) rightRail.insertBefore(feed, maneuverPanel.nextSibling);
      else rightRail.append(feed);

      feed.querySelector("[data-aemotion-expand]")?.addEventListener("click", () => {
        expanded = !expanded;
        render();
      });
      feed.querySelector("[data-aemotion-new-events]")?.addEventListener("click", acceptPending);
      feed.querySelectorAll("[data-aemotion-open]").forEach((button) => button.addEventListener("click", () => void openEvent(button.dataset.aemotionOpen || "")));
      const list = feed.querySelector("[data-aemotion-feed-list]");
      if (list) list.scrollTop = options.scrollToTop ? 0 : previousScrollTop;
      scheduleSeenForVisible(visible);
    }

    if (activeKeyModal) renderKeyModal(activeKeyModal);

    if (focusedId && !activeKeyModal) {
      const replacement = root.querySelector(`#${cssEscape(focusedId)}`);
      replacement?.focus?.({ preventScroll: true });
      if (selection && typeof replacement?.setSelectionRange === "function") replacement.setSelectionRange(selection.start, selection.end);
    }
    observer.observe(root, { childList: true, subtree: true });
  }

  async function openNextKeyModal() {
    if (activeKeyModal || !keyModals.length) return;
    const candidate = keyModals[0];
    modalFocusSnapshot = captureFocus();
    const receiptValue = await modalReceipt(candidate, "shown");
    if (!receiptValue || receiptValue.shownAt === null) {
      modalFocusSnapshot = null;
      return;
    }
    activeKeyModal = candidate;
    keyModals = keyModals.filter((item) => item.modalId !== candidate.modalId);
    render();
  }

  function renderKeyModal(modal) {
    const overlay = win.document.createElement("div");
    overlay.className = "aemotion-key-modal-overlay";
    overlay.dataset.aemotionKeyModal = modal.modalId;
    const modalTestId = modal.modalType === "CRISIS" ? "aemotion-crisis-modal" : modal.modalType === "PROMISE_BROKEN" ? "aemotion-promise-broken-modal" : "aemotion-stage-victory-modal";
    const modalEyebrow = modal.modalType === "CRISIS" ? "危局警告" : modal.modalType === "PROMISE_BROKEN" ? "承诺破裂" : "阶段胜利";
    overlay.innerHTML = `<section class="aemotion-key-modal aemotion-key-modal--${escapeHtml(modal.modalType.toLowerCase())}" role="alertdialog" aria-modal="true" aria-live="${escapeHtml(modal.ariaLive)}" aria-labelledby="aemotion-modal-title-${escapeHtml(modal.modalId)}" data-testid="${modalTestId}">
      <header><span>${modalEyebrow}</span><h2 id="aemotion-modal-title-${escapeHtml(modal.modalId)}">${escapeHtml(modal.title)}</h2><p>${escapeHtml(modal.summary)}</p></header>
      <div class="aemotion-key-modal-facts">${modal.facts.map((fact) => `<p>${escapeHtml(fact)}</p>`).join("")}</div>
      <div class="aemotion-key-modal-actions">${modal.responseOptions.map((option, index) => `<button type="button" class="${index === 0 ? "primary" : ""}" data-aemotion-modal-response="${escapeHtml(option.code)}">${escapeHtml(option.label)}</button>`).join("")}</div>
    </section>`;
    root.append(overlay);
    overlay.querySelectorAll("[data-aemotion-modal-response]").forEach((button) => button.addEventListener("click", () => void respondToKeyModal(modal, button.dataset.aemotionModalResponse || "")));
    overlay.querySelector("button")?.focus?.({ preventScroll: true });
  }

  async function respondToKeyModal(modal, code) {
    if (!activeKeyModal || activeKeyModal.modalId !== modal.modalId) return;
    const option = modal.responseOptions.find((candidate) => candidate.code === code);
    if (!option) return;
    const receiptValue = await modalReceipt(modal, "ack");
    if (!receiptValue || receiptValue.acknowledgedAt === null) return;
    if (option.preferredEntry !== "DEFER") {
      prefillWorkbench({
        maneuverType: option.preferredEntry === "INVESTIGATE" ? "investigate" : option.preferredEntry === "TALK" ? "contact" : "custom",
        targetRoleKey: "",
        intentKey: option.intentKey || "",
        prefillText: option.prefillText || ""
      });
    }
    activeKeyModal = null;
    render();
    restoreFocus(modalFocusSnapshot);
    modalFocusSnapshot = null;
    await openNextKeyModal();
  }

  async function modalReceipt(modal, kind) {
    const endpoint = kind === "shown" ? "shown" : "ack";
    const payload = await requestJson(`/api/v4/rooms/${encodeURIComponent(runId)}/a-emotion/modals/${encodeURIComponent(modal.modalId)}/${endpoint}`, {
      method: "POST",
      body: JSON.stringify({ projectionVersion: modal.projectionVersion, triggerVersion: modal.triggerVersion })
    });
    return validateKeyModalReceipt(payload, modal, kind);
  }

  function captureFocus() {
    const active = root.ownerDocument.activeElement;
    if (!active || !root.contains(active)) return null;
    return {
      id: active.id || "",
      selectionStart: typeof active.selectionStart === "number" ? active.selectionStart : null,
      selectionEnd: typeof active.selectionEnd === "number" ? active.selectionEnd : null
    };
  }

  function restoreFocus(snapshot) {
    if (!snapshot?.id) return;
    const element = root.querySelector(`#${cssEscape(snapshot.id)}`);
    element?.focus?.({ preventScroll: true });
    if (snapshot.selectionStart !== null && typeof element?.setSelectionRange === "function") element.setSelectionRange(snapshot.selectionStart, snapshot.selectionEnd);
  }

  async function openEvent(eventId) {
    const local = items.find((item) => item.eventId === eventId);
    if (!local) return;
    if (local.schemaVersion === M1_SCHEMA) {
      activeEventId = eventId;
      render();
      return;
    }
    if (local.schemaVersion !== M2_SCHEMA) return;
    const detailPayload = await requestJson(`/api/v4/rooms/${encodeURIComponent(runId)}/events/${encodeURIComponent(eventId)}?projectionVersion=${local.projectionVersion}`, { method: "GET" });
    const detail = validateM2FeedItem(detailPayload, getProjection());
    if (!sameM2Detail(local, detail)) return;
    const acknowledged = await receipt(eventId, local.projectionVersion, "ack");
    if (!acknowledged) return;
    items = items.map((item) => item.aggregateId === detail.aggregateId ? applyValidatedReceipt(detail, acknowledged) : item);
    activeEventId = eventId;
    render();
  }

  function worldSituationDetailHtml(item) {
    const testId = item.schemaVersion === M1_SCHEMA && item.centerCardType === "CROSS_IMPACT"
      ? "aemotion-m1-cross-impact"
      : `aemotion-${item.centerCardType.toLowerCase()}`;
    return `<section class="aemotion-world-situation-detail aemotion-card-${item.category.toLowerCase()}" data-aemotion-world-situation-detail="${escapeHtml(item.eventId)}" data-testid="${escapeHtml(testId)}" role="region" aria-labelledby="aemotion-title-${escapeHtml(item.eventId)}">
      <header><span>${feedLabel(item.category)}</span><h3 id="aemotion-title-${escapeHtml(item.eventId)}">${escapeHtml(item.title)}</h3><p>${escapeHtml(item.summary)}</p></header>
      <div class="aemotion-world-situation-status"><b>${escapeHtml(item.sourceStatus)}</b></div>
      <div class="aemotion-world-situation-grid">
        <section><h4>${item.visibleImpacts.length ? "直接影响" : "最新结果"}</h4>${item.visibleImpacts.length ? item.visibleImpacts.map((impact) => `<p><b>${escapeHtml(impact.label)} ${formatDelta(impact.delta)}</b><small>${escapeHtml(impact.safeReason)}</small></p>`).join("") : `<p>${escapeHtml(item.knownFacts[0] || item.statusLabel)}</p>`}</section>
        <section><h4>${item.disclosure === "CONFIRMED" ? "确认依据" : "你知道"}</h4>${item.knownFacts.map((fact) => `<p>${escapeHtml(fact)}</p>`).join("")}</section>
      </div>
    </section>`;
  }

  async function markResolvedIfPending() {
    return false;
  }

  function scheduleSeenForVisible(visible) {
    const visibleIds = new Set(visible.filter((item) => item.isUnread).map((item) => item.eventId));
    for (const [eventId, timer] of seenTimers.entries()) {
      if (!visibleIds.has(eventId)) {
        win.clearTimeout(timer);
        seenTimers.delete(eventId);
      }
    }
    for (const item of visible) {
      if (item.schemaVersion !== M2_SCHEMA || !item.isUnread || seenTimers.has(item.eventId)) continue;
      const timer = win.setTimeout(async () => {
        seenTimers.delete(item.eventId);
        const response = await receipt(item.eventId, item.projectionVersion, "seen");
        if (response) applyReceiptToItems(item.eventId, response);
      }, 1_000);
      timer?.unref?.();
      seenTimers.set(item.eventId, timer);
    }
  }

  function applyReceiptToItems(eventId, receiptValue) {
    items = items.map((item) => item.eventId !== eventId ? item : applyValidatedReceipt(item, receiptValue));
    scheduleRender();
  }

  async function receipt(eventId, projectionVersion, kind) {
    const payload = await requestJson(`/api/v4/rooms/${encodeURIComponent(runId)}/events/${encodeURIComponent(eventId)}/${kind}`, {
      method: "POST",
      body: JSON.stringify({ projectionVersion })
    });
    return validateReceipt(payload, { eventId, projectionVersion, kind });
  }

  async function requestJson(path, init) {
    try {
      const response = await fetchImpl(path, {
        credentials: "include",
        cache: "no-store",
        headers: { accept: "application/json", ...(init?.body ? { "content-type": "application/json" } : {}) },
        ...init
      });
      const payload = await response.json().catch(() => ({}));
      return response.ok ? payload : null;
    } catch {
      return null;
    }
  }

  function clearSeenTimers() {
    for (const timer of seenTimers.values()) win.clearTimeout(timer);
    seenTimers = new Map();
  }

  function destroy() {
    destroyed = true;
    clearSeenTimers();
    observer.disconnect();
    root.querySelectorAll("[data-aemotion-m1-feed], [data-aemotion-m1-card], [data-aemotion-m1-metric-hint]").forEach((node) => node.remove());
  }

  return {
    refresh,
    render,
    destroy,
    markResolvedIfPending,
    getState: () => ({ deliveryCursor, feedCursor, activeEventId, expanded, pendingNewCount, feedUnavailable, items: structuredClone(items), keyModals: structuredClone(keyModals), activeKeyModal: activeKeyModal ? structuredClone(activeKeyModal) : null })
  };
}

function validateKeyModalList(value) {
  if (!Array.isArray(value) || value.length > 8) return null;
  const result = [];
  let previousPriority = Number.POSITIVE_INFINITY;
  for (const item of value) {
    const modal = validateKeyModal(item);
    if (!modal || modal.priority > previousPriority) return null;
    previousPriority = modal.priority;
    result.push(modal);
  }
  return result;
}

function validateKeyModal(value) {
  if (!isRecord(value) || !hasOnlyKeys(value, KEY_MODAL_KEYS)) return null;
  if (value.schemaVersion !== KEY_MODAL_SCHEMA || !OPAQUE_MODAL_ID.test(String(value.modalId || "")) || !opaqueEventId(String(value.eventId || ""))) return null;
  const modalPriority = value.modalType === "CRISIS" ? 300 : value.modalType === "PROMISE_BROKEN" ? 200 : value.modalType === "STAGE_VICTORY" ? 100 : null;
  const requiredAriaLive = value.modalType === "STAGE_VICTORY" ? "polite" : "assertive";
  if (modalPriority === null || value.priority !== modalPriority || value.ariaLive !== requiredAriaLive) return null;
  if (value.isShown !== false || value.isAcknowledged !== false) return null;
  if (!Number.isInteger(value.triggerVersion) || value.triggerVersion < 1 || value.projectionVersion !== value.triggerVersion || !Number.isInteger(value.stateVersion) || value.stateVersion < 1) return null;
  if (typeof value.title !== "string" || !value.title.trim() || typeof value.summary !== "string" || !value.summary.trim()) return null;
  if (!Array.isArray(value.facts) || !value.facts.length || value.facts.length > 6 || value.facts.some((fact) => typeof fact !== "string" || !fact.trim())) return null;
  if (!Array.isArray(value.responseOptions) || !value.responseOptions.length || value.responseOptions.length > 3 || value.responseOptions.some((option) => !validKeyModalResponse(option))) return null;
  if (typeof value.occurredAt !== "string" || Number.isNaN(Date.parse(value.occurredAt))) return null;
  if (typeof value.isShown !== "boolean" || typeof value.isAcknowledged !== "boolean" || (value.isAcknowledged && !value.isShown)) return null;
  if (hasForbiddenKey(value, M2_FORBIDDEN_KEYS) || SOURCE_LEAK.test(JSON.stringify(value))) return null;
  return structuredClone(value);
}

function validKeyModalResponse(value) {
  if (!isRecord(value) || !hasOnlyKeys(value, KEY_MODAL_RESPONSE_KEYS)) return false;
  if (typeof value.code !== "string" || !value.code.trim() || typeof value.label !== "string" || !value.label.trim()) return false;
  if (!["INVESTIGATE", "TALK", "PLAN", "DEFER"].includes(value.preferredEntry)) return false;
  if (!(value.intentKey === null || (typeof value.intentKey === "string" && value.intentKey.trim()))) return false;
  if (!(value.prefillText === null || (typeof value.prefillText === "string" && value.prefillText.trim()))) return false;
  return value.preferredEntry !== "DEFER" || (value.intentKey === null && value.prefillText === null);
}

function validateKeyModalReceipt(value, modal, kind) {
  if (!isRecord(value) || !hasOnlyKeys(value, KEY_MODAL_RECEIPT_KEYS)) return null;
  if (value.schemaVersion !== KEY_MODAL_RECEIPT_SCHEMA || value.modalId !== modal.modalId || value.eventId !== modal.eventId) return null;
  if (value.projectionVersion !== modal.projectionVersion || value.stateVersion !== modal.stateVersion || value.triggerVersion !== modal.triggerVersion) return null;
  if (typeof value.shownAt !== "string" || Number.isNaN(Date.parse(value.shownAt))) return null;
  if (!(value.acknowledgedAt === null || (typeof value.acknowledgedAt === "string" && !Number.isNaN(Date.parse(value.acknowledgedAt))))) return null;
  if (kind === "ack" && value.acknowledgedAt === null) return null;
  if (value.acknowledgedAt !== null && Date.parse(value.acknowledgedAt) < Date.parse(value.shownAt)) return null;
  return structuredClone(value);
}

function mergeKeyModals(previous, current) {
  const byId = new Map(previous.map((item) => [item.modalId, item]));
  for (const item of current) byId.set(item.modalId, item);
  return [...byId.values()].sort((left, right) => right.priority - left.priority || Date.parse(left.occurredAt) - Date.parse(right.occurredAt)).slice(0, 8);
}

function mergeLegacyM1Deliveries(current, deliveries, projection) {
  let next = current.filter((item) => item.schemaVersion === M2_SCHEMA);
  for (const delivery of deliveries) {
    if (delivery?.eventType !== M1_EVENT_TYPE) continue;
    const item = legacyM1Item(delivery, projection);
    if (!item) return null;
    next = [item, ...next.filter((candidate) => candidate.eventId !== item.eventId)];
  }
  return next.sort((a, b) => b.deliverySequence - a.deliverySequence).slice(0, 10);
}

function legacyM1Item(delivery, projection) {
  const payload = delivery?.payload;
  if (!validM1Projection(payload) || hasForbiddenKey(payload, M1_FORBIDDEN_KEYS) || SOURCE_LEAK.test(JSON.stringify(payload))) return null;
  const eventId = String(delivery.eventId || "");
  if (!opaqueEventId(eventId) || !Number.isInteger(delivery.deliverySequence) || delivery.deliverySequence < 1) return null;
  const currentMetric = projection?.world?.presentation?.statusMetrics?.find?.((metric) => metric.key === "imperial_trust");
  const transition = payload.visibleImpacts.find((impact) => impact.key === "imperial_trust");
  if (!transition || Number(currentMetric?.value) !== transition.after) return null;
  return {
    ...payload,
    aggregateId: `agg_${eventId.slice(4)}`,
    stageId: "stage-1",
    sharedObjectId: "original-grain-ledger",
    eventFamily: "LEDGER_DELIVERY",
    eventId,
    deliverySequence: delivery.deliverySequence,
    isUnread: true,
    isAcknowledged: false,
    isResolved: false,
    responseOptions: payload.responseOptions.map((option) => ({ ...option, targetRoleKey: null }))
  };
}

function mergeM2FeedItems(current, incoming) {
  const byEventAndVersion = new Map();
  for (const candidate of [...current, ...incoming]) {
    if (!candidate || candidate.schemaVersion !== M2_SCHEMA) continue;
    const key = `${candidate.eventId}\0${candidate.projectionVersion}`;
    byEventAndVersion.set(key, structuredClone(candidate));
  }
  const latestByAggregate = new Map();
  for (const candidate of byEventAndVersion.values()) {
    const previous = latestByAggregate.get(candidate.aggregateId);
    if (!previous
      || candidate.projectionVersion > previous.projectionVersion
      || (candidate.projectionVersion === previous.projectionVersion && candidate.deliverySequence > previous.deliverySequence)) {
      latestByAggregate.set(candidate.aggregateId, candidate);
    }
  }
  return [...latestByAggregate.values()]
    .sort((left, right) => right.deliverySequence - left.deliverySequence)
    .slice(0, 10);
}

function validateM2Feed(value, projection) {
  if (!isRecord(value) || value.schemaVersion !== M2_FEED_SCHEMA || !Array.isArray(value.items) || value.items.length > 10) return null;
  if (!hasOnlyKeys(value, new Set(["schemaVersion", "items", "unreadCount", "nextCursor", "hasMore"]))) return null;
  const items = [];
  for (const candidate of value.items) {
    const item = validateM2FeedItem(candidate, projection);
    if (!item) return null;
    items.push(item);
  }
  if (!Number.isInteger(value.unreadCount) || value.unreadCount !== items.filter((item) => item.isUnread).length) return null;
  if (typeof value.hasMore !== "boolean") return null;
  if (!(value.nextCursor === null || (typeof value.nextCursor === "string" && OPAQUE_CURSOR.test(value.nextCursor)))) return null;
  if (value.hasMore === true && value.nextCursor === null) return null;
  return { items, unreadCount: value.unreadCount, nextCursor: value.nextCursor, hasMore: value.hasMore };
}

const M2_ITEM_KEYS = new Set([
  "schemaVersion", "projectionVersion", "stateVersion", "eventSequence", "aggregateId", "stageId",
  "sharedObjectId", "eventFamily", "category", "disclosure", "severity", "centerCardType", "title",
  "summary", "sourceStatus", "knownFacts", "visibleImpacts", "responseOptions", "visibleSuspectRoleIds",
  "visibleSourceRoleId", "visibleSourceRoleKey", "evidenceRefs", "keyModal", "occurredAt", "eventId",
  "deliverySequence", "isUnread", "isAcknowledged", "isResolved"
]);
const M2_IMPACT_KEYS = new Set(["key", "label", "before", "after", "delta", "suffix", "safeReason"]);
const M2_RESPONSE_KEYS = new Set(["code", "label", "preferredEntry", "targetRoleKey", "intentKey", "prefillText"]);
const RECEIPT_KEYS = new Set(["eventId", "projectionVersion", "seenAt", "acknowledgedAt", "resolvedAt"]);

function validateM2FeedItem(value, projection) {
  if (!isRecord(value) || value.schemaVersion !== M2_SCHEMA || !hasOnlyKeys(value, M2_ITEM_KEYS) || hasForbiddenKey(value, M2_FORBIDDEN_KEYS)) return null;
  if (!opaqueEventId(value.eventId) || !OPAQUE_AGGREGATE_ID.test(String(value.aggregateId || ""))) return null;
  if (!Number.isInteger(value.projectionVersion) || value.projectionVersion < 1 || !Number.isInteger(value.stateVersion) || value.stateVersion < 1 || !Number.isInteger(value.eventSequence) || value.eventSequence < 1 || !Number.isInteger(value.deliverySequence) || value.deliverySequence < 1) return null;
  if (typeof value.stageId !== "string" || !value.stageId) return null;
  const identityAllowed = (value.sharedObjectId === "original-grain-ledger" && value.eventFamily === "LEDGER_DELIVERY")
    || (value.sharedObjectId === "metric-pressure" && value.eventFamily === "METRIC_THRESHOLD")
    || (value.sharedObjectId === "formal-promise" && value.eventFamily === "PROMISE_LIFECYCLE")
    || (value.sharedObjectId === "stage-milestone" && value.eventFamily === "STAGE_MILESTONE");
  if (!identityAllowed) return null;
  if (!["HIDDEN", "SUSPECTED", "CONFIRMED"].includes(value.disclosure) || !["RELATED", "PUBLIC", "SUSPICIOUS"].includes(value.category)) return null;
  if (!["MINOR", "MAJOR", "CRITICAL"].includes(value.severity) || !["CROSS_IMPACT", "SUSPICIOUS_TRACE", "REVEAL", "PUBLIC_EVENT", "CRISIS", "PROMISE_BROKEN", "STAGE_VICTORY"].includes(value.centerCardType)) return null;
  if (typeof value.title !== "string" || !value.title.trim() || typeof value.summary !== "string" || !value.summary.trim() || typeof value.sourceStatus !== "string" || !value.sourceStatus.trim()) return null;
  if (!Array.isArray(value.knownFacts) || value.knownFacts.length < 1 || value.knownFacts.length > 6 || value.knownFacts.some((fact) => typeof fact !== "string" || !fact.trim())) return null;
  if (!Array.isArray(value.visibleImpacts) || value.visibleImpacts.length > 6 || value.visibleImpacts.some((impact) => !validM2Impact(impact))) return null;
  if (!Array.isArray(value.responseOptions) || value.responseOptions.length < 1 || value.responseOptions.length > 3 || value.responseOptions.some((option) => !validM2Response(option))) return null;
  if (typeof value.occurredAt !== "string" || Number.isNaN(Date.parse(value.occurredAt))) return null;
  if (typeof value.isUnread !== "boolean" || typeof value.isAcknowledged !== "boolean" || typeof value.isResolved !== "boolean") return null;
  if (value.isAcknowledged && value.isUnread) return null;
  if (value.centerCardType === "CRISIS") {
    if (value.category !== "RELATED" || value.disclosure !== "CONFIRMED" || value.severity !== "CRITICAL" || value.sharedObjectId !== "metric-pressure" || value.eventFamily !== "METRIC_THRESHOLD") return null;
    if (value.visibleSourceRoleId !== undefined || value.visibleSourceRoleKey !== undefined || value.visibleSuspectRoleIds !== undefined || !Array.isArray(value.evidenceRefs) || !value.evidenceRefs.length) return null;
    if (!validateKeyModal(value.keyModal) || value.keyModal.modalType !== "CRISIS") return null;
  } else if (value.centerCardType === "PROMISE_BROKEN") {
    if (value.category !== "RELATED" || value.disclosure !== "CONFIRMED" || value.severity !== "CRITICAL" || value.sharedObjectId !== "formal-promise" || value.eventFamily !== "PROMISE_LIFECYCLE") return null;
    if (!value.visibleSourceRoleId || !value.visibleSourceRoleKey || !Array.isArray(value.evidenceRefs) || !value.evidenceRefs.length || value.visibleSuspectRoleIds !== undefined) return null;
    if (!validateKeyModal(value.keyModal) || value.keyModal.modalType !== "PROMISE_BROKEN") return null;
  } else if (value.centerCardType === "STAGE_VICTORY") {
    if (value.category !== "RELATED" || value.disclosure !== "CONFIRMED" || value.severity !== "MAJOR" || value.sharedObjectId !== "stage-milestone" || value.eventFamily !== "STAGE_MILESTONE") return null;
    if (value.visibleSourceRoleId !== undefined || value.visibleSourceRoleKey !== undefined || value.visibleSuspectRoleIds !== undefined || !Array.isArray(value.evidenceRefs) || !value.evidenceRefs.length) return null;
    if (!validateKeyModal(value.keyModal) || value.keyModal.modalType !== "STAGE_VICTORY") return null;
    if (value.responseOptions.some((option) => option.targetRoleKey !== null)) return null;
  } else if (value.disclosure !== "CONFIRMED") {
    if (value.visibleSourceRoleId !== undefined || value.visibleSourceRoleKey !== undefined || value.evidenceRefs !== undefined || value.keyModal !== undefined) return null;
    if (value.responseOptions.some((option) => option.targetRoleKey !== null)) return null;
    if (SOURCE_LEAK.test(JSON.stringify(value))) return null;
    if (value.disclosure === "HIDDEN" && (value.visibleSuspectRoleIds !== undefined || value.category !== "RELATED" || value.centerCardType !== "CROSS_IMPACT")) return null;
    if (value.disclosure === "SUSPECTED" && (!Array.isArray(value.visibleSuspectRoleIds) || value.visibleSuspectRoleIds.length < 2 || value.category !== "SUSPICIOUS" || value.centerCardType !== "SUSPICIOUS_TRACE")) return null;
  } else {
    if (!value.visibleSourceRoleId || !value.visibleSourceRoleKey || !Array.isArray(value.evidenceRefs) || !value.evidenceRefs.length || value.visibleSuspectRoleIds !== undefined || value.keyModal !== undefined) return null;
  }
  const trust = value.visibleImpacts.find((impact) => impact.key === "imperial_trust");
  if (trust) {
    const currentMetric = projection?.world?.presentation?.statusMetrics?.find?.((metric) => metric.key === "imperial_trust");
    if (Number(currentMetric?.value) !== Number(trust.after)) return null;
  }
  return structuredClone(value);
}

function validM1Projection(value) {
  if (!isRecord(value) || !hasOnlyKeys(value, M1_ROOT_KEYS)) return false;
  if (value.schemaVersion !== M1_SCHEMA || value.projectionVersion !== 1 || !Number.isInteger(value.stateVersion) || value.stateVersion < 1) return false;
  if (!Number.isInteger(value.eventSequence) || value.eventSequence < 1) return false;
  if (value.category !== "RELATED" || value.disclosure !== "HIDDEN" || value.severity !== "MAJOR" || value.centerCardType !== "CROSS_IMPACT") return false;
  if (value.title !== "他人的行动改变了你的处境" || typeof value.summary !== "string" || !value.summary.trim()) return false;
  if (value.sourceStatus !== "来源未知" || !Array.isArray(value.knownFacts) || !value.knownFacts.length || value.knownFacts.some((fact) => typeof fact !== "string" || !fact.trim())) return false;
  if (!Array.isArray(value.visibleImpacts) || !value.visibleImpacts.length || value.visibleImpacts.some((impact) => !validM1Impact(impact))) return false;
  if (!Array.isArray(value.responseOptions) || value.responseOptions.length !== 3 || value.responseOptions.some((option) => !validM1Response(option))) return false;
  if (typeof value.occurredAt !== "string" || Number.isNaN(Date.parse(value.occurredAt))) return false;
  const codes = new Set(value.responseOptions.map((option) => option.code));
  if (codes.size !== 3 || !codes.has("INVESTIGATE_LEDGER_ANOMALY") || !codes.has("QUESTION_DELIVERY_PUBLICLY") || !codes.has("DEFER_RESPONSE")) return false;
  const question = value.responseOptions.find((option) => option.code === "QUESTION_DELIVERY_PUBLICLY");
  if (!question || question.preferredEntry !== "TALK" || SOURCE_LEAK.test(String(question.prefillText || ""))) return false;
  return !hasForbiddenKey(value, M1_FORBIDDEN_KEYS) && !SOURCE_LEAK.test(JSON.stringify(value));
}

function validM1Impact(value) {
  if (!isRecord(value) || !hasOnlyKeys(value, M1_IMPACT_KEYS)) return false;
  if (value.key !== "imperial_trust") return false;
  if (typeof value.label !== "string" || !value.label.trim() || typeof value.safeReason !== "string" || !value.safeReason.trim()) return false;
  if (!Number.isInteger(value.before) || !Number.isInteger(value.after) || !Number.isInteger(value.delta)) return false;
  return value.after - value.before === value.delta && typeof value.suffix === "string";
}

function validM1Response(value) {
  if (!isRecord(value) || !hasOnlyKeys(value, M1_RESPONSE_KEYS)) return false;
  const rules = {
    INVESTIGATE_LEDGER_ANOMALY: ["派遣调查", "INVESTIGATE"],
    QUESTION_DELIVERY_PUBLICLY: ["公开质问", "TALK"],
    DEFER_RESPONSE: ["暂不回应", "DEFER"]
  };
  const rule = rules[value.code];
  if (!rule || value.label !== rule[0] || value.preferredEntry !== rule[1]) return false;
  if (!(value.intentKey === null || (typeof value.intentKey === "string" && value.intentKey.trim()))) return false;
  if (!(value.prefillText === null || (typeof value.prefillText === "string" && value.prefillText.trim()))) return false;
  return true;
}

function validM2Impact(value) {
  if (!isRecord(value) || !hasOnlyKeys(value, M2_IMPACT_KEYS)) return false;
  if (typeof value.key !== "string" || !value.key.trim() || typeof value.label !== "string" || !value.label.trim() || typeof value.safeReason !== "string" || !value.safeReason.trim()) return false;
  if (!Number.isInteger(value.before) || !Number.isInteger(value.after) || !Number.isInteger(value.delta)) return false;
  return value.after - value.before === value.delta && typeof value.suffix === "string";
}

function validM2Response(value) {
  if (!isRecord(value) || !hasOnlyKeys(value, M2_RESPONSE_KEYS)) return false;
  if (typeof value.code !== "string" || !value.code.trim() || typeof value.label !== "string" || !value.label.trim()) return false;
  if (!["INVESTIGATE", "TALK", "PLAN", "DEFER"].includes(value.preferredEntry)) return false;
  if (!(value.targetRoleKey === null || (typeof value.targetRoleKey === "string" && value.targetRoleKey.trim()))) return false;
  if (!(value.intentKey === null || (typeof value.intentKey === "string" && value.intentKey.trim()))) return false;
  if (!(value.prefillText === null || (typeof value.prefillText === "string" && value.prefillText.trim()))) return false;
  return true;
}

function sameM2Detail(local, detail) {
  return Boolean(detail
    && detail.eventId === local.eventId
    && detail.aggregateId === local.aggregateId
    && detail.stageId === local.stageId
    && detail.sharedObjectId === local.sharedObjectId
    && detail.eventFamily === local.eventFamily
    && detail.projectionVersion === local.projectionVersion
    && detail.stateVersion === local.stateVersion
    && detail.eventSequence === local.eventSequence
    && detail.disclosure === local.disclosure
    && detail.category === local.category
    && detail.centerCardType === local.centerCardType);
}

function validateReceipt(value, expected) {
  if (!isRecord(value) || !hasOnlyKeys(value, RECEIPT_KEYS)) return null;
  if (value.eventId !== expected.eventId || value.projectionVersion !== expected.projectionVersion) return null;
  if (!nullableIsoDate(value.seenAt) || !nullableIsoDate(value.acknowledgedAt) || !nullableIsoDate(value.resolvedAt)) return null;
  if (expected.kind === "seen" && value.seenAt === null) return null;
  if (expected.kind === "ack" && (value.seenAt === null || value.acknowledgedAt === null)) return null;
  if (expected.kind === "resolved" && (value.seenAt === null || value.acknowledgedAt === null || value.resolvedAt === null)) return null;
  const seenMs = value.seenAt === null ? null : Date.parse(value.seenAt);
  const acknowledgedMs = value.acknowledgedAt === null ? null : Date.parse(value.acknowledgedAt);
  const resolvedMs = value.resolvedAt === null ? null : Date.parse(value.resolvedAt);
  if (seenMs !== null && acknowledgedMs !== null && acknowledgedMs < seenMs) return null;
  if (acknowledgedMs !== null && resolvedMs !== null && resolvedMs < acknowledgedMs) return null;
  return structuredClone(value);
}

function applyValidatedReceipt(item, receipt) {
  return {
    ...item,
    isUnread: receipt.seenAt === null && receipt.acknowledgedAt === null,
    isAcknowledged: receipt.acknowledgedAt !== null,
    isResolved: receipt.resolvedAt !== null
  };
}

function nullableIsoDate(value) {
  return value === null || (typeof value === "string" && !Number.isNaN(Date.parse(value)));
}

function hasForbiddenKey(value, forbiddenKeys) {
  if (Array.isArray(value)) return value.some((item) => hasForbiddenKey(item, forbiddenKeys));
  if (!isRecord(value)) return false;
  return Object.entries(value).some(([key, item]) => forbiddenKeys.has(key) || hasForbiddenKey(item, forbiddenKeys));
}

function hasOnlyKeys(value, allowed) { return Object.keys(value).every((key) => allowed.has(key)); }
function feedItemHtml(item) {
  return `<button type="button" class="${item.isUnread ? "unread" : ""} ${item.isResolved ? "resolved" : ""}" data-aemotion-open="${escapeHtml(item.eventId)}"><strong>${feedLabel(item.category)}${escapeHtml(item.title)}</strong><small>${escapeHtml(item.sourceStatus)}</small></button>`;
}
function feedLabel(category) { return category === "PUBLIC" ? "【公开】" : category === "SUSPICIOUS" ? "【可疑】" : "【与你有关】"; }
function opaqueEventId(value) { return OPAQUE_EVENT_ID.test(value) && !value.includes(":") && !RAW_ID_HINT.test(value); }
function formatDelta(value) { return Number(value) > 0 ? `+${value}` : String(value); }
function isRecord(value) { return Boolean(value && typeof value === "object" && !Array.isArray(value)); }
function escapeHtml(value) { return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]); }
function cssEscape(value) { return globalThis.CSS?.escape ? globalThis.CSS.escape(String(value)) : String(value).replace(/[^a-zA-Z0-9_-]/g, "_"); }
