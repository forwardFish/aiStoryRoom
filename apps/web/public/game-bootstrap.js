import { renderTransitionScreen } from "./transition-screen.js";

const CONTINUOUS_SCHEMA = "continuous_game_projection_v1";
const CONTINUOUS_STORY_V2_SCHEMA = "continuous_game_projection_v2";

export async function bootGamePage({
  root = document.getElementById("app"),
  window: win = globalThis.window,
  fetchImpl = win?.fetch?.bind(win),
  loadContinuousStoryV2 = () => import("./continuous-story-v2-client.js?v=20260721-solo-actions-v2"),
  loadContinuous = () => import("./continuous-game-client.js?v=20260717-draft-persistence-v3"),
  loadRoomStorage = () => import("./room-story-storage.js?v=20260715-1"),
  loadSolo = () => import("./app.js?v=20260721-solo-actions-v2"),
  navigate = (url) => win?.location?.assign?.(url)
} = {}) {
  if (!root) throw new TypeError("game root is required");
  const runId = new URLSearchParams(win?.location?.search || "").get("runId") || "";
  root.innerHTML = loadingView();

  if (!runId) {
    win.__AI_STORY_DISABLE_AUTO_BOOT__ = true;
    const { createStoryApp } = await loadSolo();
    const app = createStoryApp({ root, window: win });
    await app.boot();
    return app;
  }

  if (typeof fetchImpl !== "function") {
    renderClosedError(root, runId, "We can't load this shared story room right now. Please try again in a moment.", true);
    return null;
  }

  let response;
  let payload = {};
  try {
    response = await fetchImpl(`/api/v4/rooms/${encodeURIComponent(runId)}/game`, {
      credentials: "include",
      headers: { accept: "application/json" }
    });
    payload = await response.json().catch(() => ({}));
  } catch {
    renderClosedError(root, runId, "We can't load this shared story room right now. Please try again in a moment.", true);
    return null;
  }

  if (response.ok && payload?.schemaVersion === CONTINUOUS_STORY_V2_SCHEMA) {
    const { createContinuousStoryV2App } = await loadContinuousStoryV2();
    const app = createContinuousStoryV2App({ root, window: win, runId, initialProjection: payload, fetchImpl, navigate });
    await app.boot();
    return app;
  }

  if (response.ok && payload?.schemaVersion === CONTINUOUS_SCHEMA) {
    const { createContinuousGameApp } = await loadContinuous();
    const app = createContinuousGameApp({ root, window: win, runId, initialProjection: payload, fetchImpl, navigate });
    await app.boot();
    return app;
  }

  // Historical room runs retain their existing member-scoped renderer. This
  // branch is only reachable after an authenticated 2xx room projection.
  if (response.ok && payload?.room?.id) {
    win.__AI_STORY_DISABLE_AUTO_BOOT__ = true;
    const [{ RoomStoryStorage }, { createStoryApp }] = await Promise.all([loadRoomStorage(), loadSolo()]);
    const storage = new RoomStoryStorage({ roomId: runId, initialModel: payload, fetchImpl, localStorage: win.localStorage });
    const app = createStoryApp({ root, window: win, storage });
    await app.boot();
    return app;
  }

  if (response.status === 401) {
    clearMultiplayerClientState(win, runId);
    const returnTo = `${win?.location?.pathname || "/game"}${win?.location?.search || ""}${win?.location?.hash || ""}`;
    const authUrl = `/auth?returnTo=${encodeURIComponent(returnTo)}`;
    renderClosedError(root, runId, "Your session has expired. Please sign in again.", false, authUrl);
    navigate(authUrl);
    return null;
  }

  if (response.status === 403) {
    renderClosedError(root, runId, "This account can't enter this shared story room.", false);
    return null;
  }

  if (response.status === 404 || payload?.code === "ROOM_NOT_FOUND") {
    renderClosedError(root, runId, "This shared story room could not be found.", false);
    return null;
  }

  const message = response.status === 429
    ? "There have been too many reconnect attempts. Please try again in a moment."
    : "We can't load this shared story room right now. Please try again in a moment.";
  renderClosedError(root, runId, message, true);
  return null;
}

function loadingView() {
  return renderTransitionScreen({
    eyebrow: "YOUR STORY IS READY",
    title: "Opening Your World",
    description: "Preparing your role, private information, and the latest state of the shared story.",
    status: "Entering the story..."
  });
}

function renderClosedError(root, runId, message, retry, authUrl = "") {
  root.innerHTML = `<section class="boot-screen boot-error shared-room-error" data-testid="fatal-error" aria-labelledby="shared-room-error-title"><h1 id="shared-room-error-title">Unable to enter the<br>shared story room</h1><p>${escapeHtml(message)}</p><div class="boot-actions">${retry ? '<button class="shared-room-reconnect" type="button" data-boot-retry><span aria-hidden="true">↻</span>Reconnect</button>' : ""}<a class="room-back-button" href="/rooms"><span aria-hidden="true">←</span><span class="room-back-label">Back to story room</span></a>${authUrl ? `<a class="room-back-button" href="${escapeHtml(authUrl)}"><span class="room-back-label">Sign in again</span></a>` : ""}</div></section>`;
  root.querySelector("[data-boot-retry]")?.addEventListener("click", () => globalThis.location?.reload?.());
}

function clearMultiplayerClientState(win, runId) {
  try {
    for (let index = win.sessionStorage.length - 1; index >= 0; index -= 1) {
      const key = win.sessionStorage.key(index);
      if (key?.startsWith(`many-worlds:presence:${runId}:`)) win.sessionStorage.removeItem(key);
    }
  } catch {}
  try { win.document.cookie = "many_worlds_session_hint=; Max-Age=0; Path=/; SameSite=Lax"; } catch {}
}

function escapeHtml(value) {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\"/g, "&quot;").replace(/'/g, "&#039;");
}

if (typeof window !== "undefined" && typeof document !== "undefined" && !window.__AI_STORY_DISABLE_AUTO_BOOT__) {
  void bootGamePage().catch((error) => {
    const root = document.getElementById("app");
    if (root) root.innerHTML = `<section class="boot-screen boot-error shared-room-error" data-testid="fatal-error"><h1>Unable to open your story</h1><p>${escapeHtml(error?.message || error)}</p><a class="room-back-button" href="/rooms"><span aria-hidden="true">←</span><span class="room-back-label">Back to story rooms</span></a></section>`;
  });
}
