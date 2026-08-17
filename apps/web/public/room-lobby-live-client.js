const DEFAULT_SOCKET_PATH = "/api/v4/room-lobby/socket";
const SOCKET_SCHEMA_VERSION = "room_lobby_socket_v1";
const CHANGE_SCHEMA_VERSION = "room_lobby_changed_v1";

export function createRoomLobbyLiveClient({
  roomId,
  refresh,
  socketPath = DEFAULT_SOCKET_PATH,
  WebSocketCtor = globalThis.WebSocket,
  windowTarget = globalThis.window,
  documentTarget = globalThis.document,
  locationTarget = globalThis.location,
  setTimeoutFn = globalThis.setTimeout?.bind(globalThis),
  clearTimeoutFn = globalThis.clearTimeout?.bind(globalThis),
  random = Math.random,
  fallbackMs = 30_000,
  notificationDebounceMs = 50,
  subscribeTimeoutMs = 10_000,
  reconnectBaseMs = 500,
  reconnectMaxMs = 30_000,
} = {}) {
  if (!validRoomId(roomId)) throw new Error("ROOM_LOBBY_LIVE_ROOM_ID_REQUIRED");
  if (typeof refresh !== "function") throw new Error("ROOM_LOBBY_LIVE_REFRESH_REQUIRED");
  if (typeof setTimeoutFn !== "function" || typeof clearTimeoutFn !== "function") {
    throw new Error("ROOM_LOBBY_LIVE_TIMERS_REQUIRED");
  }

  let started = false;
  let destroyed = false;
  let accessRevoked = false;
  let socket = null;
  let subscribed = false;
  let reconnectAttempt = 0;
  let reconnectTimer = null;
  let fallbackTimer = null;
  let notificationTimer = null;
  let subscribeTimer = null;
  let refreshPromise = null;
  let refreshQueued = false;

  const onVisibilityChange = () => {
    if (documentTarget?.visibilityState === "visible") safeRefresh();
  };
  const onOnline = () => {
    safeRefresh();
    if (!socket && !accessRevoked) connect();
  };

  function start() {
    if (started || destroyed) return;
    started = true;
    documentTarget?.addEventListener?.("visibilitychange", onVisibilityChange);
    windowTarget?.addEventListener?.("online", onOnline);
    scheduleFallback();
    safeRefresh();
    connect();
  }

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    documentTarget?.removeEventListener?.("visibilitychange", onVisibilityChange);
    windowTarget?.removeEventListener?.("online", onOnline);
    clearTimer("reconnect");
    clearTimer("fallback");
    clearTimer("notification");
    clearTimer("subscribe");
    closeSocket(1000, "page left");
    refreshQueued = false;
  }

  function requestRefresh() {
    if (destroyed) return Promise.resolve();
    refreshQueued = true;
    if (refreshPromise) return refreshPromise;
    refreshPromise = drainRefreshQueue().finally(() => {
      refreshPromise = null;
      if (refreshQueued && !destroyed) safeRefresh();
    });
    return refreshPromise;
  }

  async function drainRefreshQueue() {
    while (refreshQueued && !destroyed) {
      refreshQueued = false;
      await refresh();
    }
  }

  function safeRefresh() {
    void requestRefresh().catch(() => {
      // A later invalidation, reconnect, visibility change, or fallback retries.
    });
  }

  function connect() {
    if (destroyed || accessRevoked || socket || typeof WebSocketCtor !== "function") return;
    const url = socketUrl(locationTarget, socketPath);
    if (!url) return;

    let nextSocket;
    try {
      nextSocket = new WebSocketCtor(url);
    } catch {
      scheduleReconnect();
      return;
    }
    socket = nextSocket;
    subscribed = false;

    nextSocket.onopen = () => {
      if (destroyed || nextSocket !== socket) return;
      try {
        nextSocket.send(JSON.stringify({
          type: "room.subscribe",
          schemaVersion: SOCKET_SCHEMA_VERSION,
          roomId,
        }));
        subscribeTimer = setTimeoutFn(() => {
          subscribeTimer = null;
          if (!subscribed && nextSocket === socket) failSocket(1008, "subscription timeout");
        }, subscribeTimeoutMs);
      } catch {
        failSocket(1011, "subscription failed");
      }
    };

    nextSocket.onmessage = (event) => {
      if (destroyed || nextSocket !== socket) return;
      const message = parseMessage(event?.data);
      if (!message || message.roomId !== roomId) return;

      if (message.type === "room.subscribed" && message.schemaVersion === SOCKET_SCHEMA_VERSION) {
        subscribed = true;
        reconnectAttempt = 0;
        clearTimer("subscribe");
        safeRefresh();
        return;
      }
      if (message.type === "room.access_revoked" && message.schemaVersion === SOCKET_SCHEMA_VERSION) {
        accessRevoked = true;
        clearTimer("reconnect");
        clearTimer("subscribe");
        safeRefresh();
        closeSocket(1008, "room access revoked");
        return;
      }
      if (message.type === "room.invalidated" && message.schemaVersion === CHANGE_SCHEMA_VERSION) {
        scheduleInvalidationRefresh();
      }
    };

    nextSocket.onerror = () => {
      if (nextSocket === socket) failSocket(1011, "socket failed");
    };
    nextSocket.onclose = () => {
      if (nextSocket !== socket) return;
      socket = null;
      subscribed = false;
      clearTimer("subscribe");
      if (!destroyed && !accessRevoked) scheduleReconnect();
    };
  }

  function closeSocket(code, reason) {
    const current = socket;
    socket = null;
    subscribed = false;
    clearTimer("subscribe");
    if (!current) return;
    current.onopen = null;
    current.onmessage = null;
    current.onerror = null;
    current.onclose = null;
    try { current.close(code, reason); } catch {
      // The transport may already be closed.
    }
  }

  function failSocket(code, reason) {
    closeSocket(code, reason);
    if (!destroyed && !accessRevoked) scheduleReconnect();
  }

  function scheduleInvalidationRefresh() {
    if (notificationTimer || destroyed) return;
    notificationTimer = setTimeoutFn(() => {
      notificationTimer = null;
      safeRefresh();
    }, notificationDebounceMs);
  }

  function scheduleReconnect() {
    if (reconnectTimer || destroyed || accessRevoked) return;
    const exponent = Math.min(reconnectAttempt, 10);
    const baseDelay = Math.min(reconnectMaxMs, reconnectBaseMs * (2 ** exponent));
    const jitter = 0.75 + (Math.max(0, Math.min(1, Number(random()) || 0)) * 0.5);
    const delay = Math.max(1, Math.min(reconnectMaxMs, Math.round(baseDelay * jitter)));
    reconnectAttempt += 1;
    reconnectTimer = setTimeoutFn(() => {
      reconnectTimer = null;
      connect();
    }, delay);
  }

  function scheduleFallback() {
    if (fallbackTimer || destroyed) return;
    fallbackTimer = setTimeoutFn(() => {
      fallbackTimer = null;
      safeRefresh();
      scheduleFallback();
    }, fallbackMs);
  }

  function clearTimer(kind) {
    const value = kind === "reconnect" ? reconnectTimer
      : kind === "fallback" ? fallbackTimer
        : kind === "notification" ? notificationTimer
          : subscribeTimer;
    if (value != null) clearTimeoutFn(value);
    if (kind === "reconnect") reconnectTimer = null;
    else if (kind === "fallback") fallbackTimer = null;
    else if (kind === "notification") notificationTimer = null;
    else subscribeTimer = null;
  }

  return Object.freeze({ start, destroy, requestRefresh });
}

globalThis.MANY_WORLDS_ROOM_LOBBY_LIVE = Object.freeze({
  createRoomLobbyLiveClient,
});

function parseMessage(value) {
  if (typeof value !== "string" || value.length > 2_048) return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function socketUrl(locationTarget, socketPath) {
  const origin = String(locationTarget?.origin || "");
  if (!origin) return null;
  try {
    const url = new URL(socketPath, origin);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

function validRoomId(value) {
  return typeof value === "string"
    && value.length >= 1
    && value.length <= 160
    && /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value);
}
