import { ContinuousStoryV2LegacyStorage } from "./continuous-story-v2-legacy-storage.js?v=20260722-solo-db-fastpath-v1";

export function createContinuousStoryV2App({ root, window: win, runId, initialProjection, fetchImpl }) {
  if (!root || !runId || typeof fetchImpl !== "function") throw new TypeError("continuous story v2 requires root, runId and fetch");
  const storage = new ContinuousStoryV2LegacyStorage({ runId, initialProjection, fetchImpl });
  let storyApp = null;
  let pollTimer = null;
  let heartbeatTimer = null;
  let streamAbort = null;
  let streamConnected = false;
  let streamConnecting = false;
  let streamTerminal = false;
  let destroyed = false;
  let appliedDeliverySequence = loadDeliveryCursor(win, runId, initialProjection?.player?.userId);
  let receivedDeliverySequence = appliedDeliverySequence;
  let pendingDeliverySequence = appliedDeliverySequence;
  let eventFlushInFlight = false;
  let refreshInFlight = false;
  let heartbeatInFlight = false;
  let heartbeatSequence = 0;
  let openingRetryStatus = "";
  let creditMountObserver = null;
  const sessionInstanceId = sessionId(win, runId);
  const onCreditsRequired = (event) => { void showCreditsRequired(event.detail || {}); };

  async function loadOldMainGame() {
    const previous = win.__AI_STORY_DISABLE_AUTO_BOOT__;
    win.__AI_STORY_DISABLE_AUTO_BOOT__ = true;
    try {
      return await import("./app.js?v=20260723-player-header-v3");
    } finally {
      if (previous === undefined) delete win.__AI_STORY_DISABLE_AUTO_BOOT__;
      else win.__AI_STORY_DISABLE_AUTO_BOOT__ = previous;
    }
  }

  async function refresh(silent = false) {
    if (!storyApp || refreshInFlight || destroyed) return false;
    refreshInFlight = true;
    const draft = root.querySelector("#customDecision")?.value || "";
    try {
      await storyApp.refresh({ silent });
      if (draft) restoreCustomDraft(root, win, draft);
      renderCreditChrome();
      renderOpeningRecovery();
      if (!isSoloProjection(storage.projection)) void refreshHostRequests();
      return true;
    } finally {
      refreshInFlight = false;
    }
  }

  async function heartbeat() {
    if (heartbeatInFlight || storyApp?.getState()?.busy) return;
    heartbeatInFlight = true;
    try { await storage.heartbeat(sessionInstanceId, ++heartbeatSequence, appliedDeliverySequence); } catch {}
    finally { heartbeatInFlight = false; }
  }

  function transportRefreshAllowed() {
    const state = storyApp?.getState();
    if (!storyApp || state?.busy || destroyed) return false;
    return !(
      root.querySelector("#customDecision")?.value?.trim()
      || root.querySelector("#maneuverCustomText")?.value?.trim()
      || root.querySelector(".maneuver-panel :focus")
    );
  }

  async function flushPendingEvents() {
    if (eventFlushInFlight || pendingDeliverySequence <= appliedDeliverySequence || !transportRefreshAllowed()) return false;
    eventFlushInFlight = true;
    const target = pendingDeliverySequence;
    try {
      const refreshed = await refresh(true);
      if (!refreshed) return false;
      appliedDeliverySequence = Math.max(appliedDeliverySequence, target);
      saveDeliveryCursor(win, runId, storage.projection?.player?.userId, appliedDeliverySequence);
      return true;
    } finally {
      eventFlushInFlight = false;
    }
  }

  async function applyEventPage(page) {
    const validated = requireEventPage(page, receivedDeliverySequence);
    receivedDeliverySequence = validated.nextAfterDeliverySequence;
    if (validated.deliveries.length > 0) {
      pendingDeliverySequence = Math.max(pendingDeliverySequence, validated.nextAfterDeliverySequence);
      await flushPendingEvents();
    }
    return validated;
  }

  async function pullMissingEvents() {
    receivedDeliverySequence = appliedDeliverySequence;
    for (let pageIndex = 0; pageIndex < 100; pageIndex += 1) {
      const page = await api(`/api/v4/rooms/${encodeURIComponent(runId)}/events?afterDeliverySequence=${receivedDeliverySequence}`);
      const validated = await applyEventPage(page);
      if (!validated.hasMore) return;
    }
    throw new Error("EVENT_BACKFILL_LIMIT_EXCEEDED");
  }

  async function consumeEventStream(body) {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (!destroyed && !streamTerminal) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");
      let boundary;
      while ((boundary = buffer.indexOf("\n\n")) >= 0) {
        const block = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const data = block
          .split("\n")
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trimStart())
          .join("\n");
        if (!data) continue;
        await applyEventPage(JSON.parse(data));
      }
    }
  }

  async function connectEvents() {
    if (destroyed || streamTerminal || streamConnecting || streamConnected || isSoloProjection(storage.projection)) return;
    streamConnecting = true;
    try {
      await pullMissingEvents();
      if (destroyed || streamTerminal) return;
      const AbortControllerImpl = win.AbortController || globalThis.AbortController;
      streamAbort = new AbortControllerImpl();
      const response = await fetchImpl(`/api/v4/rooms/${encodeURIComponent(runId)}/events/stream?afterDeliverySequence=${receivedDeliverySequence}`, {
        method: "GET",
        credentials: "include",
        headers: { accept: "text/event-stream" },
        signal: streamAbort.signal
      });
      if (!response.ok) throw await responseError(response, "EVENT_STREAM_FAILED");
      if (!response.body?.getReader) throw new Error("EVENT_STREAM_UNAVAILABLE");
      streamConnected = true;
      await consumeEventStream(response.body);
    } catch (error) {
      if (destroyed || error?.name === "AbortError") return;
      if ([401, 403, 404].includes(error?.status)) streamTerminal = true;
      // The existing projection poll remains the bounded fallback. The next
      // poll tick reconnects from the last successfully applied cursor.
    } finally {
      streamConnected = false;
      streamConnecting = false;
      streamAbort = null;
    }
  }

  async function changeControl(kind) {
    await storage.changeControl(kind);
    await refresh(false);
  }

  async function api(path, init = {}) {
    const response = await fetchImpl(path, { credentials: "include", headers: { accept: "application/json", ...(init.body ? { "content-type": "application/json" } : {}) }, ...init });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw Object.assign(new Error(payload.message || payload.code || "Request failed"), payload, { status: response.status });
    return payload;
  }

  function renderCreditChrome() {
    creditMountObserver?.disconnect();
    creditMountObserver = null;
    win.document.querySelectorAll(`[data-v2-credit-chrome="${cssEscape(runId)}"]`).forEach((node) => node.remove());
    const p = storage.projection;
    const credit = p?.creditControl;
    if (!credit || credit.policyVersion !== "active_action_v1") return;
    // A human-controlled role gets a compact cost disclosure next to the
    // decision submit button. Do not turn an ordinary balance into story
    // chrome or insert it into the opening panel.
    if (p.control?.canHumanAct) return;
    const node = win.document.createElement("section");
    node.dataset.v2CreditChrome = runId;
    node.className = "credit-control-banner v2-credit-control-banner";
    node.innerHTML = `<div><b>AI is currently guiding your character.</b><span>You can keep reading and return to control when you have Credits.</span></div><button type="button" data-v2-add-credits>Add Credits</button>${credit.canRequestSponsor ? `<button type="button" data-v2-request-support>Request support</button>` : ""}<button type="button" data-v2-reclaim-credit>Reclaim character</button>`;
    const mountWhenReady = () => {
      const mountedStoryColumn = root.querySelector(".causal-center");
      if (mountedStoryColumn) {
        if (node.parentElement !== mountedStoryColumn) mountedStoryColumn.prepend(node);
      } else if (!node.isConnected) {
        win.document.body.append(node);
      }
    };
    mountWhenReady();
    creditMountObserver = new win.MutationObserver(mountWhenReady);
    creditMountObserver.observe(root, { childList: true, subtree: true });
    Promise.resolve().then(mountWhenReady);
    node.querySelector("[data-v2-add-credits]")?.addEventListener("click", addCredits);
    node.querySelector("[data-v2-request-support]")?.addEventListener("click", requestSupport);
    node.querySelector("[data-v2-reclaim-credit]")?.addEventListener("click", () => void changeControl("reclaim"));
  }

  function renderOpeningRecovery() {
    win.document.querySelectorAll(`[data-v2-opening-recovery="${cssEscape(runId)}"]`).forEach((node) => node.remove());
    const p = storage.projection;
    if (!p || p.completed || p.currentTurn) return;
    const node = win.document.createElement("section");
    node.dataset.v2OpeningRecovery = runId;
    node.className = "v2-opening-recovery";
    node.setAttribute("role", "status");
    node.innerHTML = `<div><b>Your opening story has not been published yet.</b><span>Your room and World Credits are safe. The story may still be generating; if it stopped, you can explicitly try the opening again.</span>${openingRetryStatus ? `<small>${openingRetryStatus}</small>` : ""}</div><button type="button" data-v2-retry-opening>Try opening again</button>`;
    win.document.body.append(node);
    node.querySelector("[data-v2-retry-opening]")?.addEventListener("click", async (event) => {
      const button = event.currentTarget;
      button.disabled = true;
      button.textContent = "Checking opening…";
      try {
        const result = await api(`/api/v4/rooms/${encodeURIComponent(runId)}/game/generation/retry`, { method: "POST", body: "{}" });
        openingRetryStatus = result.status === "REQUEUED" ? "Opening retry queued. This page will update automatically." : "Opening generation is already in progress. This page will update automatically.";
      } catch (error) {
        openingRetryStatus = error?.message || "The opening could not be retried yet. Please try again.";
      }
      renderOpeningRecovery();
      await refresh(true).catch(() => undefined);
    });
  }

  function addCredits() {
    const returnTo = `${win.location.pathname}${win.location.search || `?runId=${encodeURIComponent(runId)}`}`;
    win.location.assign(`/credits?intent=PLAYER_RECLAIM&runId=${encodeURIComponent(runId)}&returnTo=${encodeURIComponent(returnTo)}`);
  }

  async function requestSupport() {
    const keyName = `many-worlds:sponsor-request:${runId}`;
    let idempotencyKey = win.localStorage?.getItem(keyName);
    if (!idempotencyKey) { idempotencyKey = `sponsor-${runId}-${sessionId(win, `${runId}:sponsor`)}`; win.localStorage?.setItem(keyName, idempotencyKey); }
    await api(`/api/v4/story-runs/${encodeURIComponent(runId)}/sponsorship-requests`, { method: "POST", body: JSON.stringify({ idempotencyKey, origin: "FIRST_INSUFFICIENT" }) });
    win.document.querySelector(`[data-credit-required-for="${cssEscape(runId)}"]`)?.remove();
    await refresh(true);
  }

  async function showCreditsRequired() {
    await refresh(true).catch(() => undefined);
    if (win.document.querySelector(`[data-credit-required-for="${cssEscape(runId)}"]`)) return;
    const p = storage.projection;
    const modal = win.document.createElement("div");
    modal.className = "credit-modal-backdrop";
    modal.dataset.creditRequiredFor = runId;
    modal.innerHTML = `<section class="credit-required-modal" role="dialog" aria-modal="true"><h2>Continue controlling your character</h2><p>You don’t currently have enough World Credits to submit another action.</p><p>Your character is still in this world and will continue under AI control. You can return at any time.</p><div><button type="button" class="continuous-primary" data-v2-modal-add>Add Credits</button>${p?.creditControl?.canRequestSponsor ? `<button type="button" data-v2-modal-support>Ask the host</button>` : ""}<button type="button" data-v2-modal-continue>Continue with AI control</button></div></section>`;
    win.document.body.append(modal);
    modal.querySelector("[data-v2-modal-add]")?.addEventListener("click", addCredits);
    modal.querySelector("[data-v2-modal-support]")?.addEventListener("click", () => void requestSupport());
    modal.querySelector("[data-v2-modal-continue]")?.addEventListener("click", () => modal.remove());
  }

  async function refreshHostRequests() {
    const p = storage.projection;
    if (!p || p.room?.mode === "solo" || p.room?.ownerUserId !== p.player?.userId) return;
    try {
      const requests = await api(`/api/v4/story-runs/${encodeURIComponent(runId)}/sponsorship-requests`);
      const pending = Array.isArray(requests) ? requests.find((item) => item.status === "PENDING") : null;
      if (!pending || win.document.querySelector(`[data-sponsor-request-for="${cssEscape(pending.id)}"]`)) return;
      const modal = win.document.createElement("div");
      modal.className = "credit-modal-backdrop";
      modal.dataset.sponsorRequestFor = pending.id;
      modal.innerHTML = `<section class="credit-required-modal" role="dialog" aria-modal="true"><h2>A player needs support to keep controlling their character</h2><p>Without support, their character will continue under AI control.</p><p>Sponsor 10 World Credits for this player in this Story Run only.</p><div><button type="button" class="continuous-primary" data-v2-sponsor-approve>Sponsor 10 Credits</button><button type="button" data-v2-sponsor-decline>Continue with AI control</button></div></section>`;
      win.document.body.append(modal);
      const decide = async (decision) => { await api(`/api/v4/story-runs/${encodeURIComponent(runId)}/sponsorship-requests/${encodeURIComponent(pending.id)}/${decision}`, { method: "POST", body: "{}" }); modal.remove(); await refresh(true); };
      modal.querySelector("[data-v2-sponsor-approve]")?.addEventListener("click", () => void decide("approve"));
      modal.querySelector("[data-v2-sponsor-decline]")?.addEventListener("click", () => void decide("decline"));
    } catch {}
  }

  return {
    async boot() {
      const { createStoryApp } = await loadOldMainGame();
      storyApp = createStoryApp({ root, window: win, storage });
      await storyApp.boot();
      win.addEventListener("worldcreditsrequired", onCreditsRequired);
      renderCreditChrome();
      renderOpeningRecovery();
      // A Solo action is resolved by its own request and returns the updated
      // projection. Reading, scrolling, typing, or simply leaving the page
      // open must not poll Supabase. Recovery remains explicit through the
      // existing refresh/retry controls. Multiplayer keeps its presence and
      // convergence timers until its transport is migrated separately.
      if (!isSoloProjection(storage.projection)) {
        void refreshHostRequests();
        void connectEvents();
        pollTimer = win.setInterval(() => {
          const state = storyApp?.getState();
          const openingNeedsRecoveryPoll = Boolean(!storage.projection?.completed && !storage.projection?.currentTurn);
          const hasDraft = Boolean(
            root.querySelector("#customDecision")?.value?.trim()
            || root.querySelector("#maneuverCustomText")?.value?.trim()
            || root.querySelector(".maneuver-panel :focus")
          );
          if (!streamConnected && !streamConnecting && !streamTerminal) void connectEvents();
          void flushPendingEvents();
          if (!streamConnected && !state?.busy
            && (openingNeedsRecoveryPoll || (!state?.showOpening && !state?.openingStream && !state?.resultStream))
            && !hasDraft) void refresh(true);
        }, 1_500);
        heartbeatTimer = win.setInterval(() => void heartbeat(), 10_000);
      }
      return this;
    },
    destroy() {
      destroyed = true;
      if (pollTimer) win.clearInterval(pollTimer);
      if (heartbeatTimer) win.clearInterval(heartbeatTimer);
      streamAbort?.abort?.();
      creditMountObserver?.disconnect();
      creditMountObserver = null;
      win.removeEventListener("worldcreditsrequired", onCreditsRequired);
      win.document.querySelectorAll(`[data-v2-credit-chrome="${cssEscape(runId)}"], [data-v2-opening-recovery="${cssEscape(runId)}"], [data-credit-required-for="${cssEscape(runId)}"]`).forEach((node) => node.remove());
    },
    refresh,
    submitDecision: () => storyApp?.submitDecision(),
    submitManeuver: () => storyApp?.submitManeuver(),
    handoff: () => changeControl("handoff"),
    reclaim: () => changeControl("reclaim"),
    loadResult: () => storage.loadResult(),
    getState: () => ({
      ...(storyApp?.getState() || {}),
      projection: storage.projection,
      customAction: root.querySelector("#customDecision")?.value || "",
      eventTransport: {
        connected: streamConnected,
        terminal: streamTerminal,
        appliedDeliverySequence,
        pendingDeliverySequence
      }
    })
  };
}

function isSoloProjection(projection) {
  return projection?.room?.mode === "solo";
}

function cssEscape(value) { return globalThis.CSS?.escape ? globalThis.CSS.escape(String(value)) : String(value).replace(/[^a-zA-Z0-9_-]/g, "_"); }

function restoreCustomDraft(root, win, draft) {
  const textarea = root.querySelector("#customDecision");
  if (!textarea) return;
  textarea.value = draft;
  textarea.dispatchEvent(new win.Event("input", { bubbles: true }));
}

function sessionId(win, runId) {
  const key = `many-worlds:v2-presence:${runId}`;
  try {
    const existing = win.sessionStorage.getItem(key);
    if (existing) return existing;
    const value = `v2-${Math.random().toString(36).slice(2, 14)}`;
    win.sessionStorage.setItem(key, value);
    return value;
  } catch { return `v2-${Math.random().toString(36).slice(2, 14)}`; }
}

const EVENT_PAGE_SCHEMA = "continuous_event_delivery_page_v1";

function requireEventPage(value, afterDeliverySequence) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("EVENT_PAGE_INVALID");
  if (value.schemaVersion !== EVENT_PAGE_SCHEMA || !Array.isArray(value.deliveries) || typeof value.hasMore !== "boolean") throw new Error("EVENT_PAGE_INVALID");
  let expected = afterDeliverySequence + 1;
  for (const delivery of value.deliveries) {
    if (!delivery || typeof delivery !== "object" || Array.isArray(delivery)
      || delivery.deliverySequence !== expected
      || typeof delivery.eventId !== "string" || !delivery.eventId
      || typeof delivery.eventType !== "string" || !delivery.eventType
      || !delivery.payload || typeof delivery.payload !== "object" || Array.isArray(delivery.payload)
      || typeof delivery.createdAt !== "string" || !delivery.createdAt) {
      throw new Error("EVENT_PAGE_INVALID");
    }
    expected += 1;
  }
  if (!Number.isSafeInteger(value.nextAfterDeliverySequence)
    || value.nextAfterDeliverySequence !== expected - 1
    || value.nextAfterDeliverySequence < afterDeliverySequence) {
    throw new Error("EVENT_PAGE_INVALID");
  }
  return value;
}

async function responseError(response, fallbackCode) {
  const payload = await response.json().catch(() => ({}));
  const error = new Error(payload.message || payload.code || fallbackCode);
  error.code = payload.code || fallbackCode;
  error.status = response.status;
  return error;
}

function deliveryCursorKey(runId, userId) {
  return `many-worlds:v2-delivery:${runId}:${userId || "member"}`;
}

function loadDeliveryCursor(win, runId, userId) {
  try {
    const value = Number(win.sessionStorage.getItem(deliveryCursorKey(runId, userId)) || 0);
    return Number.isSafeInteger(value) && value >= 0 ? value : 0;
  } catch { return 0; }
}

function saveDeliveryCursor(win, runId, userId, value) {
  try { win.sessionStorage.setItem(deliveryCursorKey(runId, userId), String(value)); } catch {}
}
