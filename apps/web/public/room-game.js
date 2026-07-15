const root = document.querySelector("#room-game-app");
const params = new URLSearchParams(location.search);
const roomId = params.get("runId") || "";
let model = null;
let refreshTimer = null;
// A periodic refresh can be in flight while the player submits an action.
// Keep an older response from repainting the action form as editable after
// the newer submit response has already marked it submitted.
let modelVersion = 0;
let submittingAction = false;

function hasSession() { return document.cookie.split(";").some((item) => item.trim() === "many_worlds_session_hint=1"); }
function esc(value) { return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#039;" })[char]); }
async function request(path, options = {}) {
  const response = await fetch(path, { ...options, credentials: "include", headers: { "content-type":"application/json", ...(options.headers || {}) } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.message || data.code || `Request failed: ${response.status}`);
    error.code = data.code || data.message?.code;
    error.details = data.details || data.message?.details;
    error.status = response.status;
    throw error;
  }
  return data;
}
function ownPlayer() { return model?.room?.players?.find((player) => model.room.roles.some((role) => role.id === player.roleId && role.claimedByCurrentUser)); }
function refreshSubmittedRoom() {
  clearInterval(refreshTimer);
  const player = ownPlayer();
  const submitted = new Set(model?.submittedRoleIds || []);
  if (!model || model.completed || !player?.roleId || !submitted.has(player.roleId)) return;
  refreshTimer = setInterval(() => {
    // Keep a submitted player's view current without interrupting an in-progress action form.
    if (document.querySelector("[data-action-form] button:not([disabled])")) return;
    load().catch(() => {});
  }, 1_500);
}
function render(status = "") {
  if (!model) return;
  const room = model.room;
  const player = ownPlayer();
  const completed = model.completed;
  const node = model.currentNode;
  const access = model.access || {};
  const requiresUnlock = !completed && Boolean(access.requiresUnlock);
  const submitted = new Set(model.submittedRoleIds || []);
  const ownSubmitted = Boolean(player?.roleId && submitted.has(player.roleId));
  const ownSubmitting = submittingAction && !ownSubmitted;
  root.innerHTML = `<section class="room-game-shell"><div class="room-game-top"><div><a class="back-link" href="/rooms/${esc(room.id)}">Back to room</a><h1>${esc(room.title)}</h1><p>${completed ? "The seven-round session is complete." : `Round ${node.nodeIndex} of 7 · ${esc(node.title)}`}</p></div><span class="badge ${completed ? "" : "wait"}">${completed ? "Session complete" : `${submitted.size} actions submitted`}</span></div>${status ? `<p class="room-game-status ${status.startsWith("Error:") ? "error" : "success"}">${esc(status.replace(/^Error:\s*/, ""))}</p>` : ""}<div class="room-game-grid"><section class="room-game-panel">${completed ? `<h2>Chapter ready</h2><p>All seven rounds have been resolved. You can review the result page now.</p><div class="room-game-actions"><a class="btn primary" href="/game/result?runId=${encodeURIComponent(room.id)}">View result</a></div>` : `<h2>${esc(node.title)}</h2><p>${esc(node.publicNarration)}</p><p><strong>Shared goal:</strong> ${esc(node.nodeGoal)}</p><form class="room-game-form" data-action-form><label>Action type<select name="actionType"><option value="observe">Observe and verify</option><option value="investigate">Investigate</option><option value="negotiate">Negotiate</option></select></label><label>Your method<textarea name="method" ${ownSubmitted ? "disabled" : ""} required placeholder="State what your role will do, with concrete evidence or trade-offs."></textarea></label><label>Intent<textarea name="intent" ${ownSubmitted ? "disabled" : ""} required placeholder="Explain the shared consequence you intend to influence."></textarea></label><button class="btn primary" ${ownSubmitted ? "disabled" : ""}>${ownSubmitted ? "Action submitted" : "Submit action"}</button></form>${room.isHost ? `<div class="room-game-actions"><button class="btn" data-resolve ${submitted.size < room.players.filter((item) => item.roleId).length ? "disabled" : ""}>Resolve this round</button></div>` : ""}`}</section><aside class="room-game-panel"><h2>Players</h2><div class="room-game-roster">${room.players.map((item) => `<div class="room-game-player"><strong>${esc(item.nickname)}</strong><span>${esc(item.roleName || "No role")}${item.roleId && submitted.has(item.roleId) ? " · Action ready" : " · Waiting"}</span></div>`).join("")}</div></aside></div></section>`;
  if (ownSubmitting) {
    const form = root.querySelector("[data-action-form]");
    if (form) {
      form.dataset.submitPending = "true";
      form.querySelectorAll("select, textarea, button").forEach((control) => { control.disabled = true; });
      const button = form.querySelector("button");
      if (button) button.textContent = "Submitting action…";
    }
  }
  if (requiresUnlock) {
    const needed = Number(access.requiredCredits || 100); const balance = Number(access.balance || 0); const canUnlock = balance >= needed; const returnTo = `/room-game?runId=${encodeURIComponent(room.id)}`;
    const primary = canUnlock ? `<button class="btn primary" data-unlock-room>Unlock shared room</button>` : `<a class="btn primary" href="/credits?intent=WORLD_UNLOCK&runId=${encodeURIComponent(room.id)}&returnTo=${encodeURIComponent(returnTo)}">Buy Credits</a>`;
    const gate = `<p class="eyebrow">SHARED STORY UNLOCK</p><h2>Free opening complete</h2><p>Rounds 1–${esc(access.freeRounds || 3)} are free. One participant unlocks the shared room for everyone; there is no per-round charge after unlock.</p><p><strong>${needed} World Credits</strong> · Your available balance: <strong>${balance}</strong>${balance < needed ? ` · Shortfall: <strong>${needed - balance}</strong>` : ""}</p>${primary}<p class="muted">The room unlocks for every participant once payment and credit use are confirmed.</p>`;
    const panel = root.querySelector(".room-game-grid > .room-game-panel");
    if (panel) panel.innerHTML = `<section class="room-unlock-gate" data-unlock-gate>${gate}</section>`;
    const modal = document.createElement("dialog"); modal.className = "room-unlock-modal"; modal.innerHTML = `<button class="dialog-close" data-close-unlock aria-label="Back to room">×</button><section class="room-unlock-modal-card">${gate}</section>`; root.append(modal); modal.showModal();
    modal.querySelector("[data-close-unlock]")?.addEventListener("click", () => modal.close());
  }
  root.querySelector("[data-action-form]")?.addEventListener("submit", submitAction);
  root.querySelector("[data-resolve]")?.addEventListener("click", resolveRound);
  refreshSubmittedRoom();
  root.querySelectorAll("[data-unlock-room]").forEach((button) => button.addEventListener("click", unlockRoom));
}
async function load(status = "") {
  const requestedVersion = modelVersion;
  const next = await request(`/api/v4/rooms/${encodeURIComponent(roomId)}/game`);
  if (requestedVersion !== modelVersion) return;
  model = next;
  modelVersion += 1;
  render(status);
}
async function submitAction(event) {
  event.preventDefault();
  if (submittingAction) return;
  const values = Object.fromEntries(new FormData(event.currentTarget));
  submittingAction = true;
  modelVersion += 1;
  render("Submitting your action…");
  try {
    const result = await request(`/api/v4/rooms/${encodeURIComponent(roomId)}/game/action`, { method:"POST", body:JSON.stringify(values) });
    submittingAction = false;
    model = result;
    modelVersion += 1;
    render("Action submitted. Waiting for the other players.");
  } catch (error) {
    submittingAction = false;
    render(`Error: ${error.message}`);
  }
}
async function unlockRoom() { try { const result = await request(`/api/v4/story-runs/${encodeURIComponent(roomId)}/unlock`, { method:"POST", body:"{}" }); await load(result.alreadyUnlocked ? "This shared room is already unlocked." : `Shared room unlocked for everyone. ${result.creditsCharged} World Credits were charged once.`); } catch (error) { render(`Error: ${error.message}`); } }
async function resolveRound() {
  try {
    const task = await request(`/api/v4/rooms/${encodeURIComponent(roomId)}/game/resolve-async`, { method:"POST", body:"{}" });
    render("AI is resolving the shared round…");
    await pollResolutionTask(task.taskId);
  } catch (error) { render(`Error: ${error.message}`); }
}
async function pollResolutionTask(taskId) {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 350));
    const task = await request(`/api/v4/rooms/${encodeURIComponent(roomId)}/game/tasks/${encodeURIComponent(taskId)}`);
    if (task.status === "completed") { await load("Round resolved. The next shared decision is ready."); return; }
    if (task.status === "failed") { render(`Error: ${task.lastError || "The AI resolution task failed."}`); return; }
  }
  render("The resolution is still running. Refreshing this page will safely resume task status.");
}
if (!roomId || !hasSession()) location.assign(`/auth?returnTo=${encodeURIComponent(`/room-game?runId=${roomId}`)}`); else load().catch((error) => { root.innerHTML = `<p class="room-game-status error">${esc(error.message)}</p>`; });
window.addEventListener("pagehide", () => clearInterval(refreshTimer), { once:true });
