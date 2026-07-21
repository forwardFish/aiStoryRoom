import { ContinuousStoryV2LegacyStorage } from "./continuous-story-v2-legacy-storage.js?v=20260721-solo-actions-v2";

export function createContinuousStoryV2App({ root, window: win, runId, initialProjection, fetchImpl }) {
  if (!root || !runId || typeof fetchImpl !== "function") throw new TypeError("continuous story v2 requires root, runId and fetch");
  const storage = new ContinuousStoryV2LegacyStorage({ runId, initialProjection, fetchImpl });
  let storyApp = null;
  let pollTimer = null;
  let heartbeatTimer = null;
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
      return await import("./app.js?v=20260721-solo-actions-v2");
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
      void refreshHostRequests();
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
    const node = win.document.createElement("section");
    node.dataset.v2CreditChrome = runId;
    node.className = "credit-control-banner v2-credit-control-banner";
    const human = Boolean(p.control?.canHumanAct);
    node.innerHTML = human
      ? `<div><b>${credit.available} World Credits available</b><span>Suggested action ${credit.standardActionCost} · Custom action ${credit.customActionCost} · AI control costs you 0</span></div>`
      : `<div><b>AI is currently guiding your character.</b><span>You can keep reading and return to control when you have Credits.</span></div><button type="button" data-v2-add-credits>Add Credits</button>${credit.canRequestSponsor ? `<button type="button" data-v2-request-support>Request support</button>` : ""}<button type="button" data-v2-reclaim-credit>Reclaim character</button>`;
    const mountWhenReady = () => {
      const mountedStoryColumn = root.querySelector(".causal-center");
      if (mountedStoryColumn) {
        const actionZone = mountedStoryColumn.querySelector('.opening-start, [data-testid="decision-zone"]');
        const flowTarget = actionZone || mountedStoryColumn;
        if (node.parentElement !== flowTarget) flowTarget.prepend(node);
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
    if (!p || p.room?.ownerUserId !== p.player?.userId) return;
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
      void refreshHostRequests();
      pollTimer = win.setInterval(() => {
        const state = storyApp?.getState();
        const openingNeedsRecoveryPoll = Boolean(!storage.projection?.completed && !storage.projection?.currentTurn);
        const hasDraft = Boolean(
          root.querySelector("#customDecision")?.value?.trim()
          || root.querySelector("#maneuverCustomText")?.value?.trim()
          || root.querySelector(".maneuver-panel :focus")
        );
        if (!state?.busy
          && (openingNeedsRecoveryPoll || (!state?.showOpening && !state?.openingStream && !state?.resultStream))
          && !hasDraft) void refresh(true);
      }, 1_500);
      heartbeatTimer = win.setInterval(() => void heartbeat(), 10_000);
      return this;
    },
    destroy() {
      if (pollTimer) win.clearInterval(pollTimer);
      if (heartbeatTimer) win.clearInterval(heartbeatTimer);
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
      customAction: root.querySelector("#customDecision")?.value || ""
    })
  };
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
