import { ContinuousStoryV2LegacyStorage } from "./continuous-story-v2-legacy-storage.js?v=20260806-opening-sequence-v1";
import { createAEmotionM1Ui } from "./a-emotion-m1-ui.js?v=20260810-m2-v1";

export function createContinuousStoryV2App({ root, window: win, runId, initialProjection, fetchImpl }) {
  if (!root || !runId || typeof fetchImpl !== "function") throw new TypeError("continuous story v2 requires root, runId and fetch");
  const storage = new ContinuousStoryV2LegacyStorage({ runId, initialProjection, fetchImpl });
  let storyApp = null;
  let pollTimer = null;
  let heartbeatTimer = null;
  let aEmotionTransport = null;
  let refreshInFlight = false;
  let heartbeatInFlight = false;
  let heartbeatSequence = 0;
  let openingRetryStatus = "";
  let creditMountObserver = null;
  let aEmotionM1Ui = null;
  const sessionInstanceId = sessionId(win, runId);
  const onCreditsRequired = (event) => { void showCreditsRequired(event.detail || {}); };
  const onWindowFocus = () => { if (!storyApp?.getState()?.busy) void aEmotionTransport?.refreshNow("focus"); };
  const onNetworkOnline = () => { if (!storyApp?.getState()?.busy) void aEmotionTransport?.refreshNow("online"); };

  async function loadOldMainGame() {
    const previous = win.__AI_STORY_DISABLE_AUTO_BOOT__;
    win.__AI_STORY_DISABLE_AUTO_BOOT__ = true;
    try {
      return await import("./app.js?v=20260806-comfortable-reading-v1");
    } finally {
      if (previous === undefined) delete win.__AI_STORY_DISABLE_AUTO_BOOT__;
      else win.__AI_STORY_DISABLE_AUTO_BOOT__ = previous;
    }
  }

  async function refresh(silent = false) {
    if (!storyApp || refreshInFlight) return;
    refreshInFlight = true;
    const draft = root.querySelector("#customDecision")?.value || "";
    try {
      await storyApp.refresh({ silent });
      if (draft) restoreCustomDraft(root, win, draft);
      renderCreditChrome();
      renderOpeningRecovery();
      if (!isSoloProjection(storage.projection)) {
        await aEmotionM1Ui?.refresh();
        void refreshHostRequests();
      }
    } finally {
      refreshInFlight = false;
    }
  }

  async function heartbeat() {
    if (heartbeatInFlight || storyApp?.getState()?.busy) return;
    heartbeatInFlight = true;
    try { await storage.heartbeat(sessionInstanceId, ++heartbeatSequence); } catch {}
    finally { heartbeatInFlight = false; }
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
        aEmotionM1Ui = createAEmotionM1Ui({
          root,
          window: win,
          runId,
          fetchImpl,
          getProjection: () => storage.projection,
          prefillWorkbench: ({ maneuverType, targetRoleKey, intentKey, prefillText }) => {
            storyApp?.chooseManeuver(maneuverType, targetRoleKey, "", intentKey);
            const textarea = root.querySelector("#maneuverCustomText");
            if (textarea && prefillText) {
              textarea.value = prefillText;
              textarea.dispatchEvent(new win.Event("input", { bubbles: true }));
            }
          }
        });
        await aEmotionM1Ui.refresh();
        void refreshHostRequests();
        win.addEventListener("focus", onWindowFocus);
        win.addEventListener("online", onNetworkOnline);
        const frozenPollIntervalMs = aEmotionPollInterval(storage.projection);
        aEmotionTransport = createAEmotionM6Transport({
          window: win,
          runId,
          pollIntervalMs: frozenPollIntervalMs,
          isBusy: () => Boolean(storyApp?.getState()?.busy),
          onRefresh: () => aEmotionM1Ui?.refresh()
        });
        aEmotionTransport.start();
        // Opening recovery is separate from the interaction transport. It only
        // refreshes the full projection when no player draft or focused
        // workbench would be disturbed.
        pollTimer = win.setInterval(() => {
          const state = storyApp?.getState();
          if (state?.busy) return;
          const openingNeedsRecoveryPoll = Boolean(!storage.projection?.completed && !storage.projection?.currentTurn);
          const hasDraft = Boolean(
            root.querySelector("#customDecision")?.value?.trim()
            || root.querySelector("#maneuverCustomText")?.value?.trim()
            || root.querySelector(".maneuver-panel :focus")
          );
          if (openingNeedsRecoveryPoll && !hasDraft) void refresh(true);
        }, frozenPollIntervalMs);
        heartbeatTimer = win.setInterval(() => void heartbeat(), 10_000);
      }
      return this;
    },
    destroy() {
      if (pollTimer) win.clearInterval(pollTimer);
      if (heartbeatTimer) win.clearInterval(heartbeatTimer);
      creditMountObserver?.disconnect();
      creditMountObserver = null;
      aEmotionTransport?.stop();
      aEmotionTransport = null;
      aEmotionM1Ui?.destroy();
      aEmotionM1Ui = null;
      win.removeEventListener("worldcreditsrequired", onCreditsRequired);
      win.removeEventListener("focus", onWindowFocus);
      win.removeEventListener("online", onNetworkOnline);
      win.document.querySelectorAll(`[data-v2-credit-chrome="${cssEscape(runId)}"], [data-v2-opening-recovery="${cssEscape(runId)}"], [data-credit-required-for="${cssEscape(runId)}"]`).forEach((node) => node.remove());
    },
    refresh,
    submitDecision: () => storyApp?.submitDecision(),
    async submitManeuver() {
      const beforeSequence = Number(storage.projection?.worldSequence || 0);
      await storyApp?.submitManeuver();
      const afterSequence = Number(storage.projection?.worldSequence || 0);
      if (afterSequence > beforeSequence) {
        await aEmotionM1Ui?.refresh();
      }
    },
    handoff: () => changeControl("handoff"),
    reclaim: () => changeControl("reclaim"),
    loadResult: () => storage.loadResult(),
    getState: () => ({
      ...(storyApp?.getState() || {}),
      projection: storage.projection,
      aEmotionM1: aEmotionM1Ui?.getState() || null,
      customAction: root.querySelector("#customDecision")?.value || ""
    })
  };
}

function aEmotionPollInterval(projection) {
  const value = Number(projection?.aEmotionFeatures?.features?.pollIntervalMs);
  return Number.isInteger(value) && value >= 3_000 && value <= 30_000 ? value : 7_000;
}


/**
 * M6 transport prefers the production SSE endpoint and falls back to bounded
 * polling after an unsupported constructor or stream failure. It never touches
 * decision/workbench DOM, so reconnects cannot clear player drafts or focus.
 */
export function createAEmotionM6Transport({ window: win, runId, onRefresh, isBusy = () => false, pollIntervalMs = 7_000 }) {
  if (!win || !runId || typeof onRefresh !== "function") throw new TypeError("M6 transport requires window, runId and onRefresh");
  const interval = Number.isInteger(pollIntervalMs) && pollIntervalMs >= 3_000 && pollIntervalMs <= 30_000 ? pollIntervalMs : 7_000;
  let stream = null;
  let poll = null;
  let stopped = true;
  let inFlight = false;
  let mode = "stopped";

  async function refreshNow(_reason = "manual") {
    if (stopped || inFlight || isBusy()) return false;
    inFlight = true;
    try { await onRefresh(); return true; }
    finally { inFlight = false; }
  }

  function startPolling() {
    if (stopped || poll) return;
    mode = "poll";
    poll = win.setInterval(() => { void refreshNow("poll"); }, interval);
    poll?.unref?.();
  }

  function startStream() {
    if (typeof win.EventSource !== "function") { startPolling(); return; }
    try {
      stream = new win.EventSource(`/api/v4/rooms/${encodeURIComponent(runId)}/events/stream`);
      mode = "sse";
      stream.onmessage = () => { void refreshNow("sse"); };
      stream.onerror = () => {
        try { stream?.close?.(); } catch {}
        stream = null;
        startPolling();
      };
    } catch {
      stream = null;
      startPolling();
    }
  }

  return {
    start() {
      if (!stopped) return;
      stopped = false;
      startStream();
    },
    stop() {
      stopped = true;
      mode = "stopped";
      try { stream?.close?.(); } catch {}
      stream = null;
      if (poll) win.clearInterval(poll);
      poll = null;
    },
    refreshNow,
    getState: () => ({ mode, inFlight, stopped, pollIntervalMs: interval })
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
