const CONTINUOUS_SCHEMA = "continuous_game_projection_v1";

export async function bootGamePage({
  root = document.getElementById("app"),
  window: win = globalThis.window,
  fetchImpl = win?.fetch?.bind(win),
  loadContinuous = () => import("./continuous-game-client.js?v=20260717-draft-persistence-v3"),
  loadRoomStorage = () => import("./room-story-storage.js?v=20260715-1"),
  loadSolo = () => import("./app.js?v=20260718-room-stage-v1"),
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
    renderClosedError(root, runId, "当前浏览器无法连接故事服务，请刷新后重试。", true);
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
    renderClosedError(root, runId, "暂时无法连接共同故事局，请稍后重试。", true);
    return null;
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
    renderClosedError(root, runId, "登录状态已失效，正在返回登录页面。", false, authUrl);
    navigate(authUrl);
    return null;
  }

  if (response.status === 403) {
    renderClosedError(root, runId, "当前账号不能进入这个共同故事局。", false);
    return null;
  }

  if (response.status === 404 || payload?.code === "ROOM_NOT_FOUND") {
    renderClosedError(root, runId, "当前账号不能进入这个共同故事局。", false);
    return null;
  }

  const message = response.status === 429
    ? "连接请求过于频繁，请稍后重试。"
    : "暂时无法读取共同故事局，请稍后重试。";
  renderClosedError(root, runId, message, true);
  return null;
}

function loadingView() {
  return `<section class="boot-screen" data-testid="loading"><div class="seal">桑田诏</div><p>正在进入共同故事局……</p></section>`;
}

function renderClosedError(root, runId, message, retry, authUrl = "") {
  root.innerHTML = `<section class="boot-screen boot-error" data-testid="fatal-error"><div class="seal">桑田诏</div><h1>无法进入共同故事局</h1><p>${escapeHtml(message)}</p><div class="boot-actions">${retry ? '<button type="button" data-boot-retry>重新连接</button>' : ""}<a class="room-back-button" href="/rooms">返回故事房间</a>${authUrl ? `<a class="room-back-button" href="${escapeHtml(authUrl)}">重新登录</a>` : ""}</div></section>`;
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
    if (root) root.innerHTML = `<section class="boot-screen boot-error" data-testid="fatal-error"><div class="seal">桑田诏</div><h1>主游戏页面暂不可用</h1><p>${escapeHtml(error?.message || error)}</p><a class="room-back-button" href="/rooms">返回故事房间</a></section>`;
  });
}
