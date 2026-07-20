import { storyRunStorageKey } from "./api-story-storage.js";
import { renderRoomSelectionPage, roomRoleArtwork } from "./room-role-selection-view.js?v=20260719-role-cards-v4";
import { renderTransitionScreen } from "./transition-screen.js";

export function createRoleSelectApp({ root, window: browserWindow = globalThis.window, fetchImpl = browserWindow?.fetch?.bind(browserWindow) } = {}) {
  if (!root) throw new TypeError("createRoleSelectApp requires a root element");
  if (typeof fetchImpl !== "function") throw new TypeError("createRoleSelectApp requires fetch");

  const params = new URLSearchParams(browserWindow?.location?.search || "");
  const storyId = params.get("story")?.trim() || "";
  const startFresh = params.get("start") === "new";
  const state = { loading: true, busy: false, error: "", story: null, selectedRoleKey: "" };

  async function boot() {
    state.loading = true;
    state.error = "";
    render();
    try {
      if (!storyId) throw new Error("No world was selected, so the role roster cannot be loaded.");
      const response = await fetchImpl(`${apiBase(browserWindow?.location)}/v4/worlds/${encodeURIComponent(storyId)}`, { headers: { accept: "application/json" } });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.id || !Array.isArray(payload.roles)) {
        throw new Error(payload?.message || `The role roster could not be loaded (HTTP ${response.status}).`);
      }
      state.story = payload;
      state.selectedRoleKey = payload.roles.find((role) => role.playableSolo !== false)?.key || payload.roles[0]?.key || "";
    } catch (error) {
      state.error = error instanceof Error ? error.message : String(error);
    } finally {
      state.loading = false;
      render();
    }
  }

  function selectRole(roleKey) {
    state.selectedRoleKey = roleKey;
    render();
  }

  async function createRun() {
    const role = selectedRole(state);
    if (!role || role.playableSolo === false || state.busy) return;
    const pendingKey = `many-worlds:solo-create:${state.story.id}:${role.key}`;
    const storage = browserWindow?.localStorage;
    const idempotencyKey = storage?.getItem?.(pendingKey) || newIdempotencyKey(browserWindow);
    storage?.setItem?.(pendingKey, idempotencyKey);
    state.busy = true;
    state.error = "";
    render();
    try {
      const response = await fetchImpl(`${apiBase(browserWindow?.location)}/v4/rooms/solo`, {
        method: "POST",
        credentials: "include",
        headers: { accept: "application/json", "content-type": "application/json" },
        body: JSON.stringify({ worldId: state.story.id, roleKey: role.key, idempotencyKey, resumeExisting: !startFresh })
      });
      const payload = await response.json().catch(() => null);
      const runId = payload?.id || payload?.runId || payload?.roomId;
      if (!response.ok || !runId) throw new Error(payload?.message || `The story could not be started (HTTP ${response.status}).`);
      storage?.removeItem?.(pendingKey);
      browserWindow.localStorage?.setItem(storyRunStorageKey, runId);
      const override = apiOverride(browserWindow?.location);
      browserWindow.location.href = `/game?runId=${encodeURIComponent(runId)}${override ? `&apiBase=${encodeURIComponent(override)}` : ""}`;
    } catch (error) {
      state.error = error instanceof Error ? error.message : String(error);
      state.busy = false;
      render();
    }
  }

  function render() {
    if (state.loading) {
      root.innerHTML = renderTransitionScreen({
        eyebrow: "CHOOSE YOUR ROLE",
        title: "Opening the Role Roster",
        description: "Preparing the available roles, private perspectives, and the world you are about to enter.",
        status: "Preparing available roles..."
      });
      return;
    }
    if (!state.story) {
      root.innerHTML = `<section class="role-loading role-error"><div class="seal-mark">MW</div><h1>The role roster is unavailable</h1><p>${escapeHtml(state.error || "Please make sure the story service is available.")}</p><button id="retryRole">Reconnect</button><a href="/">Back to home</a></section>`;
      root.querySelector("#retryRole")?.addEventListener("click", boot);
      return;
    }

    const story = state.story;
    const roomRoles = story.roles.map((item, index) => ({
      key: item.key,
      name: item.name,
      tagline: item.publicInfo || item.tagline || item.identity || "A voice that can change this world.",
      artwork: item.portrait || roomRoleArtwork(story.id, item.key || item.name, index),
      selected: item.key === state.selectedRoleKey,
      disabled: item.playableSolo === false,
      statusLabel: item.key === state.selectedRoleKey ? "Selected by You" : item.playableSolo !== false ? "Available" : "AI controlled",
      traits: item.traits?.length ? [...item.traits, "Risk · Medium"].slice(0, 3) : ["Loyalty · Republic", "Influence · High", "Risk · Medium"]
    }));
    root.innerHTML = renderRoomSelectionPage({
      mode: "solo",
      worldId: story.id,
      title: story.title,
      bannerArtwork: story.presentation?.sceneBackground || story.roleSelectionBanner || story.heroCover || "",
      sessionLabel: "Play Solo",
      roles: roomRoles,
      selectedRole: state.selectedRoleKey,
      statusLabel: `1 player  ·  AI controls ${Math.max(0, roomRoles.length - 1)} other roles  ·  ${story.durationLabel || "40–60 minutes"}`,
      infoText: "Choose your role first. The AI will control the rest of the cast.",
      footerMessage: "You will begin alone. The AI will play every remaining role.",
      backHref: "/",
      busy: state.busy
    });
    if (state.error) root.querySelector(".mw-room-footer")?.insertAdjacentHTML("beforebegin", `<div class="role-alert" role="alert">${escapeHtml(state.error)}</div>`);
    root.querySelectorAll("[data-room-role-key]").forEach((button) => button.addEventListener("click", () => selectRole(button.dataset.roomRoleKey)));
    root.querySelector("#enterRole")?.addEventListener("click", createRun);
  }

  return { boot, render, createRun, selectRole, getState: () => state };
}

function selectedRole(state) {
  return state.story?.roles?.find((role) => role.key === state.selectedRoleKey) || null;
}

function newIdempotencyKey(browserWindow) {
  const generated = browserWindow?.crypto?.randomUUID?.() || globalThis.crypto?.randomUUID?.();
  if (generated) return `solo-create:${generated}`;
  return `solo-create:${Date.now().toString(36)}:${Math.random().toString(36).slice(2)}`;
}

function apiBase(location = globalThis.location) {
  if (!location) return "/api";
  try {
    const override = new URL(location.href).searchParams.get("apiBase");
    if (override) return override.replace(/\/+$/, "");
  } catch {
    // Use the normal local default below.
  }
  // The local web server proxies `/api` to the API started for this workspace.
  // Keeping this relative avoids accidentally talking to a stale port 3001
  // process when the platform pages run on 5178.
  return "/api";
}

function apiOverride(location = globalThis.location) {
  try { return new URL(location.href).searchParams.get("apiBase") || ""; } catch { return ""; }
}

function escapeHtml(value) { return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\"/g, "&quot;").replace(/'/g, "&#039;"); }

if (typeof window !== "undefined" && typeof document !== "undefined" && !window.__AI_STORY_DISABLE_AUTO_BOOT__) {
  const root = document.getElementById("roleApp");
  if (root) createRoleSelectApp({ root, window }).boot();
}
