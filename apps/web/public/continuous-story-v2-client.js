import { ContinuousStoryV2LegacyStorage } from "./continuous-story-v2-legacy-storage.js?v=20260720-solo-maneuver-v1";

export function createContinuousStoryV2App({ root, window: win, runId, initialProjection, fetchImpl }) {
  if (!root || !runId || typeof fetchImpl !== "function") throw new TypeError("continuous story v2 requires root, runId and fetch");
  const storage = new ContinuousStoryV2LegacyStorage({ runId, initialProjection, fetchImpl });
  let storyApp = null;
  let pollTimer = null;
  let heartbeatTimer = null;
  let refreshInFlight = false;
  let heartbeatInFlight = false;
  let heartbeatSequence = 0;
  const sessionInstanceId = sessionId(win, runId);

  async function loadOldMainGame() {
    const previous = win.__AI_STORY_DISABLE_AUTO_BOOT__;
    win.__AI_STORY_DISABLE_AUTO_BOOT__ = true;
    try {
      return await import("./app.js?v=20260720-solo-maneuver-v1");
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

  return {
    async boot() {
      const { createStoryApp } = await loadOldMainGame();
      storyApp = createStoryApp({ root, window: win, storage });
      await storyApp.boot();
      pollTimer = win.setInterval(() => {
        const state = storyApp?.getState();
        const hasDraft = Boolean(root.querySelector("#customDecision")?.value?.trim());
        if (!state?.busy && !state?.showOpening && !state?.openingStream && !state?.resultStream && !hasDraft) void refresh(true);
      }, 1_500);
      heartbeatTimer = win.setInterval(() => void heartbeat(), 10_000);
      return this;
    },
    destroy() {
      if (pollTimer) win.clearInterval(pollTimer);
      if (heartbeatTimer) win.clearInterval(heartbeatTimer);
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
