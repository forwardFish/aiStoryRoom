const worldCatalog = globalThis.MANY_WORLDS_CATALOG || [];
const roomSelection = globalThis.MANY_WORLDS_ROOM_SELECTION || {};
const renderRoomSelectionPage = (...args) => roomSelection.renderRoomSelectionPage?.(...args) || "";
const roomRoleArtwork = (...args) => roomSelection.roomRoleArtwork?.(...args) || "/assets/portrait/1.png";
const root = document.querySelector("#platform-app");
const path = location.pathname.replace(/\/$/, "") || "/";
const params = new URLSearchParams(location.search);
const isLocalRuntime = location.hostname === "localhost" || location.hostname === "127.0.0.1";
const deployedApiBase = "/api";
const platformApiBase = (params.get("apiBase") || (isLocalRuntime ? "/api" : deployedApiBase)).replace(/\/$/, "");
const purple = "#6434d7";
const BRAND_NAME = "Our Many Worlds";
const BRAND_TAGLINE = "Real players. Living worlds.";
let activeRoom = null;
let roomRefreshTimer = null;
let roomsView = { activeTab: "open", openRooms: [], myRooms: [] };
let currentAccount = null;
let accountPurchaseCache = new Map();
let roomDialogRecoveryTimer = null;
let roomsRefreshPending = false;
const pendingMutations = new Set();
const roomDialogDraftKey = "many-worlds:rooms-dialog-draft";
async function runMutationOnce(key, element, pendingLabel, operation) {
  if (pendingMutations.has(key) || element?.disabled) return;
  pendingMutations.add(key);
  const priorDisabled = Boolean(element?.disabled);
  const priorText = element?.textContent;
  if (element) {
    element.disabled = true;
    element.setAttribute("aria-busy", "true");
    if (pendingLabel) element.textContent = pendingLabel;
  }
  try { return await operation(); }
  finally {
    pendingMutations.delete(key);
    if (element?.isConnected) {
      element.disabled = priorDisabled;
      element.removeAttribute("aria-busy");
      if (pendingLabel && priorText != null) element.textContent = priorText;
    }
  }
}
function pendingMutationKey(storageKey) {
  const existing = localStorage.getItem(storageKey);
  if (existing) return existing;
  const generated = `room-create:${globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}:${Math.random().toString(36).slice(2)}`}`;
  localStorage.setItem(storageKey, generated);
  return generated;
}
function esc(value) { return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[char]); }
function backLink(href, className = "back-link") {
  return `<a class="${esc(`${className} mw-back`)}" href="${esc(href)}" aria-label="Back"><span class="mw-back__icon" aria-hidden="true">←</span><span>Back</span></a>`;
}
function emailInitial(value) { return String(value || "M").trim().charAt(0).toUpperCase() || "M"; }
function roomFilterLabel(worldId) { return worldId === "caesar" ? "Rome, 44 BC" : worldId === "sangtian" ? "Ming, 1565" : ""; }
function roomFilterChip(worldId) { const label = roomFilterLabel(worldId); return label ? `<span class="filter-chip" data-world-chip>${esc(label)}<button type="button" data-action="clear-world-filter" aria-label="Clear world filter">×</button></span>` : ""; }
function syncRoomFilterChip(worldId) {
  const filters = root.querySelector(".rooms-page .filters");
  root.querySelector("[data-world-chip]")?.remove();
  if (!filters) return;
  filters.insertAdjacentHTML("beforeend", roomFilterChip(worldId));
  const clearButton = filters.querySelector('[data-action="clear-world-filter"]');
  if (clearButton) clearButton.onclick = (event) => actions["clear-world-filter"]?.(event, clearButton);
}
function safeReturnTo(value) {
  if (typeof value !== "string" || value.includes("\\") || value.startsWith("//")) return "/";
  try {
    const url = new URL(value, "https://manyworlds.invalid");
    const allowed = new Set(["/", "/account", "/admin/refunds", "/join", "/rooms", "/game", "/game/result", "/credits", "/credits/status", "/credits/cancel", "/credits/failed", "/role-select", "/trio"]);
    if (url.origin !== "https://manyworlds.invalid" || !(allowed.has(url.pathname) || /^\/rooms\/[A-Za-z0-9_-]+$/.test(url.pathname) || /^\/worlds\/[A-Za-z0-9_-]+$/.test(url.pathname))) return "/";
    return `${url.pathname}${url.search}`;
  } catch { return "/"; }
}
function apiUrl(url) { return url.startsWith("/api/") ? `${platformApiBase}${url.slice(4)}` : url; }
function hasSessionCookie() { return document.cookie.split(";").some((item) => item.trim() === "many_worlds_session_hint=1"); }
function clearSessionHint() {
  try { document.cookie = "many_worlds_session_hint=; Path=/; Max-Age=0; SameSite=Lax"; } catch {
    // Cookie access can be blocked by browser privacy settings.
  }
  try { localStorage.removeItem("many-worlds-token"); } catch {
    // A stale local token must never prevent the login form from rendering.
  }
}
async function migrateLegacySession() {
  if (hasSessionCookie()) { localStorage.removeItem("many-worlds-token"); return; }
  const legacyToken = localStorage.getItem("many-worlds-token");
  if (!legacyToken) return;
  try {
    const response = await fetch(apiUrl("/api/v4/auth/session/upgrade"), {
      method: "POST",
      credentials: "include",
      headers: { authorization: `Bearer ${legacyToken}` }
    });
    if (response.ok) localStorage.removeItem("many-worlds-token");
  } catch {
    // Keep the old token until a later visit can safely migrate it.
  }
}
function header(active = "") {
  const profile = `<a class="profile-icon" aria-label="Account" href="/auth?returnTo=${encodeURIComponent(path + location.search)}"></a>`;
  const utility = `<div class="header-right"><a href="/#faq">Help</a><span class="divider"></span><span class="language-label" aria-label="Language">English⌄</span>${profile}</div>`;
  if (active === "auth") return `<header class="mw-header"><a class="brand" href="/"><span class="brand-mark">◉</span><span>${BRAND_NAME}</span></a>${utility}</header>`;
  return `<header class="mw-header"><a class="brand" href="/"><span class="brand-mark">◉</span><span>${BRAND_NAME}</span></a><nav class="mw-nav"><a class="${active === "worlds" ? "active" : ""}" href="/worlds">Explore Worlds</a><a class="${active === "rooms" ? "active" : ""}" href="/rooms">Rooms</a><a href="/credits">World Credits</a></nav>${utility}</header>`;
}
function appShell(content, active = "") {
  if (roomRefreshTimer) { clearInterval(roomRefreshTimer); roomRefreshTimer = null; }
  if (roomDialogRecoveryTimer) { clearInterval(roomDialogRecoveryTimer); roomDialogRecoveryTimer = null; }
  // Room waiting references retain the product navigation behind modal layers.
  // Other platform surfaces keep their current page-specific shell unchanged.
  const roomWaitingHeader = path.startsWith("/rooms/") ? header("rooms") : "";
  root.innerHTML = `${roomWaitingHeader}${content}`;
  if (path !== "/auth" && path !== "/rooms") root.querySelector(".page-frame")?.classList.add("visual-tight");
  bind();
  if (path === "/rooms") {
    if (sessionToken()) {
      void refreshRoomsList();
      roomRefreshTimer = setInterval(() => { void refreshRoomsList(); }, 5000);
      roomDialogRecoveryTimer = setInterval(() => { restoreRoomDialogDraft(); }, 250);
    }
    else renderRoomsView();
  }
  const roomMatch = path.match(/^\/rooms\/([^/]+)$/);
  if (roomMatch && !roomMatch[1].startsWith("fixture-") && sessionToken()) {
    void hydrateSharedRoom(roomMatch[1]);
    roomRefreshTimer = setInterval(() => { if (location.pathname === path) void hydrateSharedRoom(roomMatch[1]); }, 5000);
  }
}
function currentRoomPlayer(room) {
  const selectedRole = room?.roles?.find((role) => role.claimedByCurrentUser);
  return selectedRole ? room.players?.find((player) => player.roleId === selectedRole.id) : null;
}

function renderLobbyControls(room) {
  if (!room || room.status !== "waiting_players") return;
  const footer = root.querySelector(".room-footer, .mw-room-footer");
  if (footer?.classList.contains("mw-room-footer")) return;
  if (!footer) return;

  const player = currentRoomPlayer(room);
  const hasRole = Boolean(player?.roleId);
  const isReady = Boolean(player?.ready);
  const allPlayersReady = Boolean(
    room.hostRoleLocked &&
    room.players.length >= room.minPlayers &&
    room.players.every((item) => item.roleId && item.ready)
  );

  let message = "Choose a role before marking yourself ready.";
  if (hasRole && !isReady) message = "Confirm that your role is selected and you are ready to begin.";
  if (isReady && !room.isHost) message = "You are ready. Waiting for the host to start the game.";
  if (isReady && room.isHost && !allPlayersReady) message = "You are ready. Waiting for every player to be ready.";
  if (room.isHost && allPlayersReady) message = "All players are ready. You can start the game.";

  const readyButton = `<button class="btn" data-action="ready" ${!hasRole || isReady ? "disabled" : ""}>${isReady ? "Ready ✓" : "Ready"}</button>`;
  const startButton = room.isHost
    ? `<button class="btn primary" data-action="start-game" ${allPlayersReady ? "" : "disabled"}>Start Game</button>`
    : "";
  footer.innerHTML = `<p>${esc(message)}</p>${readyButton}${startButton}`;
}

function bind() {
  renderLobbyControls(activeRoom);
  if (activeRoom) {
    const roomStatus = root.querySelector(".room-stat.purple");
    if (roomStatus) roomStatus.textContent = activeRoom.status === "waiting_players"
      ? "◷ Waiting for players"
      : activeRoom.status === "chapter_generated" ? "✓ Session complete" : "● In progress";
    const shareButton = root.querySelector('[data-action="share-invite"]');
    if (shareButton) shareButton.disabled = false;
    const roomInfo = root.querySelector(".info-bar");
    if (roomInfo) roomInfo.textContent = activeRoom.isHost
      ? "ⓘ As the room creator, you choose roles first."
      : "ⓘ Choose one available role. Each player controls only their own role.";
    const roleHeading = root.querySelector(".roles-panel .panel-title");
    if (roleHeading) roleHeading.innerHTML = activeRoom.isHost
      ? 'Choose Your Role <span class="eyebrow">☆ Creator Advantage</span>'
      : "Choose Your Role";
  }
  root.querySelectorAll("[data-action]").forEach((element) => { element.onclick = (event) => actions[element.dataset.action]?.(event, element); });
  const worldFilter = root.querySelector("[data-world-filter]");
  if (worldFilter) {
    worldFilter.onchange = () => {
      const worldId = String(worldFilter.value || "").trim();
      if (worldId) params.set("worldId", worldId);
      else params.delete("worldId");
      history.replaceState(null, "", worldId ? `/rooms?worldId=${encodeURIComponent(worldId)}` : "/rooms");
      worldFilter.value = "";
      syncRoomFilterChip(worldId);
      void hydrateRooms();
    };
  }
}
function notice(message) { let target = root.querySelector("[data-notice]"); if (!target) { target = document.createElement("p"); target.dataset.notice = ""; target.className = "notice"; root.querySelector(".page-frame")?.prepend(target); } if (target) { target.textContent = message; target.hidden = false; } }
function clearNotice() { const target = root.querySelector("[data-notice]"); if (target) { target.textContent = ""; target.hidden = true; } }

let googleIdentityLibraryPromise = null;
function googleWebClientId() { return String(globalThis.__MANY_WORLDS_RUNTIME__?.googleWebClientId || "").trim(); }
function loadGoogleIdentityLibrary() {
  if (globalThis.google?.accounts?.id) return Promise.resolve(globalThis.google);
  if (googleIdentityLibraryPromise) return googleIdentityLibraryPromise;
  googleIdentityLibraryPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.defer = true;
    script.onload = () => globalThis.google?.accounts?.id ? resolve(globalThis.google) : reject(new Error("Google sign-in did not load."));
    script.onerror = () => reject(new Error("Google sign-in could not be loaded."));
    document.head.append(script);
  });
  return googleIdentityLibraryPromise;
}
async function mountGoogleSignIn(returnTo) {
  const target = root.querySelector("[data-google-signin]");
  const unavailable = root.querySelector("[data-google-unavailable]");
  const clientId = googleWebClientId();
  if (!target || !clientId) {
    if (unavailable) unavailable.hidden = false;
    return;
  }
  try {
    const challenge = await request("/api/v4/auth/google/challenge", { method: "POST", headers: { "x-requested-with": "many-worlds-web" }, body: "{}" });
    const google = await loadGoogleIdentityLibrary();
    google.accounts.id.initialize({
      client_id: clientId,
      nonce: challenge.nonce,
      auto_select: false,
      ux_mode: "popup",
      callback: async (credentialResponse) => {
        try {
          const session = await request("/api/v4/auth/google", {
            method: "POST",
            headers: { "x-requested-with": "many-worlds-web" },
            body: JSON.stringify({ credential: credentialResponse.credential, challengeId: challenge.challengeId, returnTo })
          });
          location.assign(safeReturnTo(session.returnTo || returnTo));
        } catch (error) {
          notice(error.code === "ACCOUNT_LINK_REQUIRED"
            ? "This email is already registered with Our Many Worlds. Log in with your password, then open My Account to link Google."
            : error.message || "Google sign-in could not be completed.");
        }
      }
    });
    target.hidden = false;
    google.accounts.id.renderButton(target, { theme: "outline", size: "large", text: "continue_with", shape: "rectangular", width: 360 });
  } catch (error) {
    if (unavailable) unavailable.hidden = false;
    notice(error.message || "Google sign-in is temporarily unavailable. You can still use email.");
  }
}

async function mountGoogleLink() {
  const target = root.querySelector("[data-google-link]");
  const unavailable = root.querySelector("[data-google-link-unavailable]");
  const clientId = googleWebClientId();
  if (!target || !clientId) {
    if (unavailable) unavailable.hidden = false;
    return;
  }
  try {
    const challenge = await request("/api/v4/auth/google/challenge", { method: "POST", headers: { "x-requested-with": "many-worlds-web" }, body: "{}" });
    const google = await loadGoogleIdentityLibrary();
    google.accounts.id.initialize({
      client_id: clientId,
      nonce: challenge.nonce,
      auto_select: false,
      ux_mode: "popup",
      callback: async (credentialResponse) => {
        try {
          await request("/api/v4/auth/google/link", {
            method: "POST",
            headers: { "x-requested-with": "many-worlds-web" },
            body: JSON.stringify({ credential: credentialResponse.credential, challengeId: challenge.challengeId })
          });
          notice("Google account linked successfully.");
          await hydrateAccount();
        } catch (error) {
          notice(error.message || "Google account could not be linked.");
        }
      }
    });
    target.hidden = false;
    google.accounts.id.renderButton(target, { theme: "outline", size: "large", text: "continue_with", shape: "rectangular", width: 320 });
  } catch (error) {
    if (unavailable) unavailable.hidden = false;
    notice(error.message || "Google account linking is temporarily unavailable.");
  }
}

function restoreBrowserSession(returnTo) {
  appShell(`<section class="page-frame auth-frame"><p class="muted">Restoring your signed-in session...</p></section>`);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  void request("/api/v4/auth/me", { signal: controller.signal })
    .then(() => { clearTimeout(timeout); location.replace(returnTo); })
    .catch(() => {
      clearTimeout(timeout);
      clearSessionHint();
      authSkipRestore = true;
      authRestoreError = "Your session expired. Please sign in again.";
      renderAuth();
    });
}

let authSkipRestore = false;
let authRestoreError = "";
function renderAuth() {
  const skipRestore = authSkipRestore;
  const restoreError = authRestoreError;
  authSkipRestore = false;
  authRestoreError = "";
  const returnTo = safeReturnTo(params.get("returnTo"));
  const legacyResetToken = String(params.get("token") || "").trim();
  const isVerificationLink = params.get("mode") === "verify" && Boolean(legacyResetToken);
  if (params.get("mode") === "reset" && legacyResetToken) {
    location.replace(`/reset-password?token=${encodeURIComponent(legacyResetToken)}`);
    return;
  }
  // An existing branded session wins over a stale or bookmarked login URL,
  // but verification links must consume their token before session restore.
  // Account switching is handled by an explicit logout.
  if (!isVerificationLink && !skipRestore && hasSessionCookie()) {
    restoreBrowserSession(returnTo);
    return;
  }
  appShell(`<section class="page-frame auth-frame"><form class="auth-card" data-auth-form novalidate><h1 class="auth-title">Welcome to ${BRAND_NAME}</h1><p class="auth-subtitle">${BRAND_TAGLINE}</p><div class="auth-tabs"><button type="button" class="active" data-auth-tab="login">Log in</button><button type="button" data-auth-tab="signup">Sign up</button></div><div data-notice class="notice" hidden></div><div class="google-signin" data-google-signin hidden></div><p class="google-unavailable" data-google-unavailable hidden>Google sign-in is unavailable here. You can still use email.</p><div class="auth-divider google-divider"><span>or continue with email</span></div><label class="field"><span>Email address</span><input required name="email" type="email" autocomplete="email" placeholder="you@example.com"></label><label class="field"><span>Password</span><span class="password-field"><input required name="password" type="password" autocomplete="current-password" minlength="8" placeholder="Enter your password"><button type="button" class="password-reveal" data-action="toggle-password" aria-label="Show password">Show</button></span></label><label class="field signup-only" hidden><span>Display name</span><input name="nickname" maxlength="80" autocomplete="nickname" placeholder="Enter your display name"></label><div class="auth-options login-only"><label><input type="checkbox" name="remember"> Remember me</label><span><button type="button" class="text-link" data-action="forgot">Forgot password?</button> <button type="button" class="text-link" data-action="resend-verification">Resend verification</button></span></div><button class="btn primary" type="submit">Log in</button><p class="auth-legal">By continuing, you agree to our <a href="/terms">Terms of Service</a> and <a href="/privacy">Privacy Policy</a>.</p></form></section>`);
  root.querySelector(".auth-title").textContent = `Welcome to ${BRAND_NAME}`;
  root.querySelector(".auth-subtitle").textContent = BRAND_TAGLINE;
  if (restoreError) notice(restoreError);
  let mode = "login";
  const form = root.querySelector("[data-auth-form]");
  const applyMode = (next) => { mode = next; root.querySelectorAll("[data-auth-tab]").forEach((tab) => tab.classList.toggle("active", tab.dataset.authTab === next)); root.querySelectorAll(".signup-only").forEach((node) => node.hidden = next !== "signup"); root.querySelectorAll(".login-only").forEach((node) => node.hidden = next !== "login"); form.querySelector("button[type=submit]").textContent = next === "login" ? "Log in" : "Create account"; form.querySelector("input[name=password]").autocomplete = next === "login" ? "current-password" : "new-password"; };
  root.querySelectorAll("[data-auth-tab]").forEach((tab) => tab.addEventListener("click", () => applyMode(tab.dataset.authTab)));
  form.addEventListener("submit", async (event) => { event.preventDefault(); const data = Object.fromEntries(new FormData(form)); const email = String(data.email || "").trim(); const password = String(data.password || ""); if (!email || password.length < 8) return notice("Enter a valid email and a password of at least 8 characters."); try { const endpoint = mode === "login" ? "/api/v4/auth/login" : "/api/v4/auth/register"; await request(endpoint, { method:"POST", body: JSON.stringify(mode === "signup" ? { email, password, nickname: data.nickname, returnTo } : { email, password }) }); if (mode === "signup") { applyMode("login"); form.elements.email.value = email; form.elements.password.value = ""; notice("Account created. Check your email to verify it, then log in."); return; } location.assign(returnTo); } catch (error) { notice(error.message || "Unable to authenticate. Please try again."); } });
  if (isVerificationLink) {
    notice("Verifying your email…");
    void request("/api/v4/auth/verify", { method: "POST", body: JSON.stringify({ token: legacyResetToken }) }).then((session) => {
      location.assign(returnTo);
    }).catch((error) => notice(error.message || "This verification link is invalid or expired."));
  }
  void mountGoogleSignIn(returnTo);
}

function renderAccount() {
  if (!sessionToken()) {
    location.assign("/auth?returnTo=%2Faccount");
    return;
  }
  appShell(`<section class="page-frame account-page">${backLink("/", "back-link account-back")}<header class="account-heading"><h1>My Account</h1><p>View your profile and purchase history.</p></header><div data-notice class="notice account-notice" hidden></div><section class="account-profile-card" data-account-summary aria-label="Account profile"><div class="account-profile-loading">Loading your profile…</div></section><section class="account-purchases-card"><header class="account-purchases-header"><h2>Purchases &amp; refunds</h2><a class="account-add-credits" href="/credits">Add Credits</a></header><div class="account-table-wrap"><table class="account-purchase-table"><thead><tr><th>Order number</th><th>Purchase date</th><th>World Credits</th><th>Amount</th><th>Payment status</th><th>Refund status</th><th>Action</th></tr></thead><tbody data-purchase-records><tr><td colspan="7" class="account-table-message">Loading purchase records…</td></tr></tbody></table></div></section><button class="account-logout" type="button" data-action="account-logout"><span aria-hidden="true">↪</span>Log out</button></section>`);
  void hydrateAccount();
}

async function hydrateAccount() {
  try {
    const account = await request("/api/v4/auth/me");
    currentAccount = account;
    renderAccountProfile(account);
    bind();
    await hydratePurchases();
  } catch (error) {
    if (error.status === 401) location.assign("/auth?returnTo=%2Faccount");
    else notice(error.message || "Unable to load your account.");
  }
}

function renderAccountProfile(account) {
  const summary = root.querySelector("[data-account-summary]");
  if (!summary) return;
  const name = account.nickname || `${BRAND_NAME} player`;
  summary.innerHTML = `<div class="account-avatar" aria-hidden="true"><span>${esc(emailInitial(account.email))}</span></div><div class="account-profile-copy"><h2>${esc(name)}</h2><p>${esc(account.email || "Email not available")}</p></div><button class="account-edit-profile" type="button" data-action="edit-profile"><span aria-hidden="true">✎</span>Edit profile</button>`;
}

async function hydratePurchases() {
  const target = root.querySelector("[data-purchase-records]");
  if (!target) return;
  try {
    const data = await request("/api/v4/billing/purchases");
    const purchases = Array.isArray(data.purchases) ? data.purchases : [];
    accountPurchaseCache = new Map(purchases.map((purchase) => [purchase.id, purchase]));
    target.innerHTML = purchases.length ? purchases.map(renderPurchaseRow).join("") : '<tr><td colspan="7" class="account-table-message">No purchase records yet.</td></tr>';
    bind();
  } catch (error) { target.innerHTML = `<tr><td colspan="7" class="account-table-message account-table-error">${esc(error.message || "Unable to load purchases.")} <button type="button" data-action="retry-purchases">Retry</button></td></tr>`; bind(); }
}

function renderPurchaseRow(purchase) {
  const amount = new Intl.NumberFormat("en-US", { style:"currency", currency:purchase.currency || "USD" }).format(Number(purchase.amountCents || 0) / 100);
  const payment = purchasePaymentState(purchase.status);
  const refund = purchaseRefundState(purchase);
  return `<tr><td data-label="Order number"><strong>${esc(purchase.orderDisplayCode)}</strong></td><td data-label="Purchase date">${esc(accountDate(purchase.paidAt || purchase.createdAt))}</td><td data-label="World Credits">${esc(new Intl.NumberFormat("en-US").format(Number(purchase.credits || 0)))} Credits</td><td data-label="Amount">${esc(amount)}</td><td data-label="Payment status"><span class="account-status ${payment.className}"><span aria-hidden="true">${payment.icon}</span>${esc(payment.label)}</span></td><td data-label="Refund status">${refund.statusHtml}</td><td data-label="Action">${refund.actionHtml}</td></tr>`;
}

function purchasePaymentState(status) {
  if (status === "PENDING") return { label:"Payment pending", className:"pending", icon:"◷" };
  if (status === "FAILED") return { label:"Payment failed", className:"failed", icon:"!" };
  return { label:"Paid", className:"paid", icon:"✓" };
}

function purchaseRefundState(purchase) {
  const refund = purchase.refund;
  if (purchase.status === "DISPUTED") return { statusHtml:'<span class="account-status disputed">Disputed</span>', actionHtml:`<button class="account-row-action" type="button" data-action="view-dispute" data-purchase-id="${esc(purchase.id)}">View case</button>` };
  if (purchase.status === "REFUNDED" || refund?.status === "COMPLETED") {
    const completed = refund?.completedAt ? `<small>Refunded on ${esc(accountDate(refund.completedAt))}</small>` : "";
    return { statusHtml:`<span class="account-status refunded"><span aria-hidden="true">✓</span>Refunded</span>${completed}`, actionHtml:'<span class="account-empty-action">—</span>' };
  }
  if (purchase.status === "PARTIALLY_REFUNDED") return { statusHtml:'<span class="account-status refunded">Partially refunded</span>', actionHtml:'<span class="account-empty-action">—</span>' };
  if (refund) {
    const status = String(refund.status || "");
    if (status === "FAILED") return { statusHtml:'<span class="account-status refund-failed"><span aria-hidden="true">△</span>Refund failed</span><small>Please try again.</small>', actionHtml:`<button class="account-row-action" type="button" data-action="view-refund" data-purchase-id="${esc(purchase.id)}">View request</button>` };
    if (status === "REJECTED") return { statusHtml:'<span class="account-status refund-failed">Not approved</span>', actionHtml:`<button class="account-row-action" type="button" data-action="view-refund" data-purchase-id="${esc(purchase.id)}">View request</button>` };
    return { statusHtml:'<span class="account-status reviewing">Under review</span>', actionHtml:`<button class="account-row-action" type="button" data-action="view-refund" data-purchase-id="${esc(purchase.id)}">View request</button>` };
  }
  if (purchase.status === "PAID") return { statusHtml:'<span class="account-status eligible">Eligible</span>', actionHtml:`<button class="account-row-action" type="button" data-action="request-refund" data-purchase-id="${esc(purchase.id)}">Request refund</button>` };
  return { statusHtml:'<span class="account-empty-action">—</span>', actionHtml:'<span class="account-empty-action">—</span>' };
}

function accountDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : new Intl.DateTimeFormat("en-US", { month:"short", day:"numeric", year:"numeric" }).format(date);
}

function openProfileEditor() {
  if (!currentAccount) return;
  const dialog = document.createElement("dialog");
  dialog.className = "account-dialog profile-dialog";
  dialog.innerHTML = `<button class="dialog-close" type="button" aria-label="Close">×</button><h2>Edit profile</h2><p>Update the name shown to other players.</p><form><label>Display name<input name="nickname" maxlength="80" required value="${esc(currentAccount.nickname || "")}"></label><button class="btn primary" type="submit">Save changes</button></form>`;
  document.body.append(dialog); dialog.showModal();
  dialog.querySelector(".dialog-close").addEventListener("click", () => dialog.close());
  dialog.addEventListener("close", () => dialog.remove(), { once:true });
  dialog.querySelector("form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = event.currentTarget.querySelector("button[type=submit]");
    const nickname = event.currentTarget.elements.nickname.value.trim();
    button.disabled = true;
    try {
      currentAccount = await request("/api/v4/auth/me", { method:"PATCH", body:JSON.stringify({ nickname }) });
      renderAccountProfile(currentAccount); bind(); dialog.close(); notice("Profile updated.");
    } catch (error) { button.disabled = false; notice(error.message || "Unable to update your profile."); }
  });
}

function openPurchaseStatus(purchaseId, dispute = false) {
  const purchase = accountPurchaseCache.get(purchaseId);
  if (!purchase) return;
  const dialog = document.createElement("dialog");
  dialog.className = "account-dialog purchase-status-dialog";
  const refund = purchase.refund;
  const title = dispute ? "Payment dispute" : "Refund request";
  const status = dispute ? "Under review by the payment provider" : String(refund?.status || "Pending").replaceAll("_", " ").toLowerCase();
  dialog.innerHTML = `<button class="dialog-close" type="button" aria-label="Close">×</button><h2>${title}</h2><dl><div><dt>Order</dt><dd>${esc(purchase.orderDisplayCode)}</dd></div><div><dt>Status</dt><dd>${esc(status)}</dd></div>${refund?.requestedAt ? `<div><dt>Requested</dt><dd>${esc(accountDate(refund.requestedAt))}</dd></div>` : ""}${refund?.adminNote ? `<div><dt>Update</dt><dd>${esc(refund.adminNote)}</dd></div>` : ""}</dl><button class="btn" type="button" data-dialog-done>Done</button>`;
  document.body.append(dialog); dialog.showModal();
  dialog.querySelector(".dialog-close").addEventListener("click", () => dialog.close());
  dialog.querySelector("[data-dialog-done]").addEventListener("click", () => dialog.close());
  dialog.addEventListener("close", () => dialog.remove(), { once:true });
}

function openRefundRequest(purchaseId) {
  const dialog = document.createElement("dialog");
  dialog.className = "refund-dialog";
  dialog.innerHTML = `<button class="dialog-close" type="button" aria-label="Close">×</button><p class="eyebrow">REFUND REQUEST</p><h2>Tell us what happened</h2><p class="muted">Your request will be reviewed by an administrator. Credits are changed only after Creem confirms a successful refund.</p><form><label>Reason<select name="reason" required><option value="">Select a reason</option><option value="ACCIDENTAL_PURCHASE">Accidental purchase</option><option value="DUPLICATE">Duplicate payment</option><option value="TECHNICAL_ISSUE">Technical issue</option><option value="REQUESTED_BY_CUSTOMER">No longer needed</option><option value="OTHER">Other</option></select></label><label>Details (optional)<textarea name="message" maxlength="1000" placeholder="Add anything that will help us review the request."></textarea></label><button class="btn primary" type="submit">Submit request</button></form>`;
  document.body.append(dialog); dialog.showModal();
  dialog.querySelector(".dialog-close").addEventListener("click", () => dialog.close());
  dialog.addEventListener("close", () => dialog.remove(), { once:true });
  dialog.querySelector("form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = event.currentTarget.querySelector("button[type=submit]");
    const data = Object.fromEntries(new FormData(event.currentTarget));
    button.disabled = true;
    try {
      await request("/api/v4/billing/refund-requests", { method:"POST", body:JSON.stringify({ purchaseId, reason:data.reason, message:data.message }) });
      dialog.close(); notice("Refund request submitted for review."); await hydratePurchases();
    } catch (error) { button.disabled = false; notice(error.message || "Unable to submit the refund request."); }
  });
}

function renderAdminRefunds() {
  if (!sessionToken()) { location.assign("/auth?returnTo=%2Fadmin%2Frefunds"); return; }
  appShell(`<section class="page-frame admin-refund-frame">${backLink("/account")}<p class="eyebrow">PAYMENT OPERATIONS</p><h1>Refund requests</h1><p class="muted">Approval submits the refund through the configured Creem provider adapter. Credit reversal waits for the signed refund webhook.</p><div data-notice class="notice" hidden></div><div class="refund-filter"><button class="btn small" data-refund-filter="PENDING">Pending</button><button class="btn small" data-refund-filter="">All</button></div><section data-admin-refund-list><p>Loading requests…</p></section></section>`);
  root.querySelectorAll("[data-refund-filter]").forEach((button) => button.addEventListener("click", () => hydrateAdminRefunds(button.dataset.refundFilter)));
  void hydrateAdminRefunds("PENDING");
}

async function hydrateAdminRefunds(status = "PENDING") {
  const target = root.querySelector("[data-admin-refund-list]");
  try {
    const data = await request(`/api/v4/admin/refunds${status ? `?status=${encodeURIComponent(status)}` : ""}`);
    target.innerHTML = data.requests?.length ? data.requests.map((item) => `<article class="admin-refund-card"><div><span>${esc(item.status.replaceAll("_", " "))}</span><h2>${esc(item.purchase.orderDisplayCode)}</h2><p>${esc(item.requester.email || "No email")} · ${esc(String(item.purchase.credits))} Credits</p><small>${esc(item.reason.replaceAll("_", " "))} · ${esc(new Date(item.requestedAt).toLocaleString())}</small>${item.message ? `<blockquote>${esc(item.message)}</blockquote>` : ""}${item.failureMessage ? `<p class="refund-failure">${esc(item.failureMessage)}</p>` : ""}</div>${item.status === "PENDING" || item.status === "FAILED" || item.status === "PROVIDER_ACTION_REQUIRED" ? `<div class="admin-refund-actions"><button class="btn primary" data-admin-approve="${esc(item.id)}">Approve & submit</button><button class="btn" data-admin-reject="${esc(item.id)}">Reject</button></div>` : ""}</article>`).join("") : '<p class="muted">No refund requests in this view.</p>';
    target.querySelectorAll("[data-admin-approve]").forEach((button) => button.addEventListener("click", async () => { const note = prompt("Optional internal note") || ""; button.disabled = true; try { const result = await request(`/api/v4/admin/refunds/${encodeURIComponent(button.dataset.adminApprove)}/approve`, { method:"POST", body:JSON.stringify({ note }) }); notice(result.submitted ? "Refund submitted to Creem. Waiting for webhook confirmation." : result.providerActionRequired ? "Approved. Creem refund API access is still required." : "Request updated."); await hydrateAdminRefunds(status); } catch (error) { button.disabled = false; notice(error.message || "Unable to approve this request."); } }));
    target.querySelectorAll("[data-admin-reject]").forEach((button) => button.addEventListener("click", async () => { const note = prompt("Reason shown to the customer"); if (!note) return; button.disabled = true; try { await request(`/api/v4/admin/refunds/${encodeURIComponent(button.dataset.adminReject)}/reject`, { method:"POST", body:JSON.stringify({ note }) }); notice("Refund request rejected."); await hydrateAdminRefunds(status); } catch (error) { button.disabled = false; notice(error.message || "Unable to reject this request."); } }));
  } catch (error) { target.innerHTML = `<p class="notice">${esc(error.message || "Unable to load refund requests.")}</p>`; }
}

function renderJoin() {
  const roomCode = String(params.get("room") || "").trim().toUpperCase();
  const ref = String(params.get("ref") || "").trim().toUpperCase();
  const channel = String(params.get("channel") || "LINK").trim().toUpperCase();
  if (!roomCode) { location.assign("/rooms"); return; }
  if (!sessionToken()) { location.assign(`/auth?returnTo=${encodeURIComponent(path + location.search)}`); return; }
  appShell(`<section class="page-frame join-frame"><p class="eyebrow">ROOM INVITATION</p><h1>Joining your shared world…</h1><p class="muted">We are verifying the invitation and taking you to the room.</p><p data-notice class="notice" hidden></p></section>`, "rooms");
  void (async () => {
    try {
      if (ref) await request("/api/v4/referrals/bind", { method:"POST", body:JSON.stringify({ referralCode:ref, channel }) });
      const room = await request("/api/v4/rooms/join-by-code", { method:"POST", body:JSON.stringify({ code:roomCode }) });
      location.assign(`/rooms/${encodeURIComponent(room.id)}`);
    } catch (error) { notice(error.message || "This invitation is no longer available. Ask the host for a new link."); }
  })();
}

function worldIdFromPath() {
  return path.match(/^\/worlds\/([a-z0-9_-]+)$/)?.[1] || "";
}
function catalogWorldDetail(world) {
  const range = String(world.roles || "1").match(/\d+/g)?.map(Number) || [1];
  const minPlayers = range[0] || 1;
  const maxPlayers = range.at(-1) || minPlayers;
  return {
    worldId: world.id,
    status: world.playable ? "playable" : "coming_soon",
    genre: world.category,
    categoryLabel: world.category,
    title: world.title,
    subtitle: world.copy,
    description: world.detail || world.copy,
    heroCover: `/assets/bg/${world.image}.png`,
    durationLabel: world.duration,
    roleCount: world.rolePreview?.length || maxPlayers,
    minHumanPlayers: minPlayers,
    maxHumanPlayers: maxPlayers,
    modes: world.playable ? ["solo", "multiplayer"] : [],
    roles: (world.rolePreview || []).map((role, index) => ({
      key: role.key || `role-${index + 1}`,
      name: role.name,
      publicInfo: role.copy,
      portrait: role.portrait
    }))
  };
}
function worldPlayerRange(world) {
  const min = Number(world.minHumanPlayers || 1);
  const max = Number(world.maxHumanPlayers || min);
  return min === max ? `${min} Role` : `${min}–${max} Roles`;
}
function worldRoleCards(world) {
  return (world.roles || []).map((role) => `<article class="role-card" data-role-key="${esc(role.key)}"><img class="portrait" data-role-portrait src="${esc(role.portrait)}" alt="${esc(role.name)}"><div><strong>${esc(role.name)}</strong><p>${esc(role.publicInfo || role.identity)}</p></div></article>`).join("");
}
function worldModeCards(world) {
  const worldId = esc(world.worldId);
  const cards = [];
  if (world.modes?.includes("solo")) cards.push(`<article class="mode-card"><span class="mode-icon">♙</span><div><h2>Play Solo</h2><p>Choose one role and AI controls every unclaimed role.</p></div><button class="btn primary" data-action="world-solo" data-world-id="${worldId}">Choose a Role</button></article>`);
  if (world.modes?.includes("multiplayer")) cards.push(`<article class="mode-card"><span class="mode-icon">♧</span><div><h2>Play Multiplayer</h2><p>Create or join a room. AI fills every role not claimed by a person.</p></div><button class="btn primary" data-action="world-rooms" data-world-id="${worldId}">Find a Room</button></article>`);
  return cards.join("");
}
function worldDetailMarkup(world) {
  const playable = world.status === "playable";
  const background = world.heroCover || world.presentation?.sceneBackground;
  const roleCards = worldRoleCards(world);
  return `<section class="page-frame" data-world-detail data-world-id="${esc(world.worldId)}">${backLink("/worlds")}<div class="world-hero" data-world-id="${esc(world.worldId)}"><div><div class="eyebrow">${esc(world.genre)}</div><h1>${esc(world.title)}</h1><p class="world-lead">${esc(world.subtitle)}</p><p class="world-copy">${esc(world.description)}</p><div class="meta-row"><span class="meta">♧ &nbsp; ${esc(worldPlayerRange(world))}</span><span class="meta">◷ &nbsp; ${esc(world.durationLabel)}</span><span class="meta">♜ &nbsp; ${esc(world.categoryLabel || world.genre)}</span><span class="meta">♙ &nbsp; ${esc(world.roleCount)} Characters</span></div></div><img class="world-image" data-world-background src="${esc(background)}" alt="${esc(world.title)}"></div><h2 class="role-title">Role Preview</h2><div class="role-preview">${roleCards || '<p class="muted">Role details will be announced later.</p>'}</div>${playable ? `<div class="mode-grid">${worldModeCards(world)}</div><p class="world-cost">Starts from 20 World Credits</p>` : '<p class="world-coming">Coming Soon</p>'}</section>`;
}
async function renderWorld() {
  const worldId = worldIdFromPath();
  if (!worldId) { location.assign("/worlds"); return; }
  const fallback = worldCatalog.find((entry) => entry.id === worldId);
  if (fallback) appShell(worldDetailMarkup(catalogWorldDetail(fallback)), "worlds");
  else appShell(`<section class="page-frame" data-world-detail-state="loading">${backLink("/worlds")}<p class="muted">Loading world…</p></section>`, "worlds");
  try {
    const world = await request(`/api/v4/worlds/${encodeURIComponent(worldId)}`);
    appShell(worldDetailMarkup(world), "worlds");
  } catch (error) {
    if (!fallback) appShell(`<section class="page-frame" data-world-detail-error>${backLink("/worlds")}<h1>World unavailable</h1><p class="muted">${esc(error.message || "This world could not be loaded.")}</p></section>`, "worlds");
  }
}
function roomRow(room, index, view = "open") {
  const status = roomStatus(room, view);
  const action = roomAction(room, view);
  const playerCount = Array.isArray(room.players) ? room.players.length : 0;
  return `<article class="room-table room-row"><div class="world-cell"><img class="thumb" src="${roomWorldImage(room.worldId, index)}" alt=""><strong>${esc(roomWorldLabel(room.worldId))}</strong><span class="world-flourish" aria-hidden="true">❧</span></div><span class="room-name">${esc(roomDisplayTitle(room) || room.title || "Untitled room")}</span><span class="player-count">${playerCount} of ${esc(room.maxPlayers || "—")}</span><span><span class="badge ${status.tone}"><i aria-hidden="true"></i>${status.label}</span></span><span><button class="btn small room-action" ${action.attributes}>${action.label}</button></span></article>`;
}
function renderRooms() {
  roomsView = { activeTab: "open", openRooms: [], myRooms: [] };
  const worldFilter = String(params.get("worldId") || "");
  const signedIn = Boolean(sessionToken());
  appShell(`<section class="page-frame rooms-page"><div class="rooms-heading"><div><h1>Rooms</h1><p>Join an open room, create your own, or continue a room you already joined.</p></div><div class="action-row"><button class="btn rooms-join-code" data-action="join-code"><span aria-hidden="true">⌗</span>Join with Code</button><button class="btn primary rooms-create" data-action="create-room"><span aria-hidden="true">＋</span>Create Room</button></div></div><div class="tab-strip rooms-tabs" role="tablist" aria-label="Room lists"><button class="active" role="tab" aria-selected="true" data-action="open-tab">Open Rooms</button><button role="tab" aria-selected="false" data-action="my-tab">My Rooms</button></div><div data-notice class="notice" hidden></div><div class="rooms-layout"><div class="filters"><label class="select-box"><span aria-hidden="true">◎</span><select data-world-filter aria-label="Filter rooms by world"><option value="" selected>All Worlds</option><option value="sangtian">嘉靖财政危局</option><option value="caesar">Caesar: The Last Spring of the Republic</option></select><span class="select-chevron" aria-hidden="true">⌄</span></label>${roomFilterChip(worldFilter)}</div><section class="rooms-table-card" aria-live="polite"><div class="room-table head"><span>World</span><span>Room</span><span>Players</span><span>Status</span><span>Action</span></div><div data-live-rooms><p class="rooms-empty-state">Loading available rooms…</p></div></section><p class="refresh-note" data-room-refresh-note ${signedIn ? "" : "hidden"}><span aria-hidden="true">❧</span>Rooms refresh automatically.<span aria-hidden="true">❧</span></p></div></section>`, "rooms");
  restoreRoomDialogDraft();
}
function renderRoom() {
  appShell(sharedMultiplayerRoomMarkup({ world: null, roles: [], players: [] }, { loading: true }), "rooms");
}
function visualIcon(id, label, extra = "") {
  const glyphs = { 4: "▶　", 5: "♧　", 8: "←　", 10: "◎　", 12: "◎", 15: extra === "session-icon" ? "◉　" : "✓", 17: "♙", 25: "♎　", 31: "☆" };
  return glyphs[id] || "";
}
function renderResult() {
  const fixture = params.get("runId") === "fixture-caesar-finished";
  appShell(`<section class="page-frame">${backLink("/worlds")}<div class="result-run"><img src="/assets/bg/1.png" alt="Rome"><div><h1>Caesar: The Last Spring of the Republic</h1><span class="session-complete">${visualIcon(15, "", "session-icon")}Session Complete</span></div></div><h1 class="result-title">A Republic Without a Master</h1><p class="result-lead">Caesar survived, but accepted limits on his authority.<br>Rome avoided civil war—for now.</p><div class="summary-grid"><article class="summary-card"><span class="mode-icon">${visualIcon(17, "")}</span><div><h2>Your Role</h2><img class="portrait" src="/assets/portrait/1.png" alt="Brutus"><strong>Brutus</strong></div></article><article class="summary-card"><span class="mode-icon">${visualIcon(31, "")}</span><div><h2>Your Ending</h2><strong>The Reluctant Architect</strong><p>You chose restraint over power, building guardrails that may hold—if others keep faith.</p></div></article><article class="summary-card"><span class="mode-icon">${visualIcon(12, "")}</span><div><h2>World State</h2><strong>Fragile Stability</strong><p>Rome stands together, but old rivalries smolder and the future is uncertain.</p></div></article></div><div class="lower-grid"><section class="lower-card"><h2>${visualIcon(25, "", "section-icon")}Key Decisions</h2><div class="decision-item"><span class="number-dot">1</span><span>You opposed the dictatorship and pushed for limits on power.</span></div><div class="decision-item"><span class="number-dot">2</span><span>You brokered a compromise between the Senate and Caesar.</span></div><div class="decision-item"><span class="number-dot">3</span><span>You secured support from key allies to pass reforms.</span></div></section><section class="lower-card"><h2>${visualIcon(10, "", "section-icon")}Goals Completed <span class="badge progress">2 / 3</span></h2><div class="goal-item"><span class="check">${visualIcon(15, "")}</span><span>Prevent Caesar from becoming an unrestrained dictator.</span></div><div class="goal-item"><span class="check">${visualIcon(15, "")}</span><span>Avoid a civil war.</span></div><div class="goal-item"><span class="open-check">◯</span><span>Pass meaningful reforms to strengthen the Republic.</span></div></section></div><div class="result-actions"><button class="btn primary" data-action="play-again">${visualIcon(4, "", "button-icon inverted")}Play Again</button><button class="btn" data-action="other-role">${visualIcon(5, "", "button-icon")}Try Another Role</button><button class="btn" data-action="back-worlds">${visualIcon(8, "", "button-icon")}Back to Worlds</button></div></section>`, "worlds");
  root.querySelector(".result-actions")?.insertAdjacentHTML("afterend", `<button class="result-share-recap" data-action="share-recap" ${fixture ? "" : "disabled"}>${fixture ? "Share Recap" : "Loading recap…"}</button>`);
  bind();
  root.querySelector("a.back-link")?.setAttribute("href", "/worlds");
  if (!fixture) void hydrateResult(params.get("runId")).then((loaded) => {
    const shareButton = root.querySelector('[data-action="share-recap"]');
    if (!loaded || !shareButton) return;
    shareButton.disabled = false;
    shareButton.textContent = "Share Recap";
  });
}

async function hydrateResult(runId) {
  if (!runId || !sessionToken()) { location.assign(`/auth?returnTo=${encodeURIComponent(`/game/result?runId=${runId || ""}`)}`); return; }
  try {
    const result = await request(`/api/v4/rooms/${encodeURIComponent(runId)}/result`);
    const title = result.room.worldId === "sangtian" ? "嘉靖财政危局" : "Caesar: The Last Spring of the Republic";
    const chapter = result.chapter || {};
    const highlights = Array.isArray(chapter.highlights) ? chapter.highlights : [];
    const shell = root.querySelector(".page-frame");
    shell.querySelector(".back-link").href = "/worlds";
    shell.querySelector(".result-run h1").textContent = title;
    shell.querySelector(".result-run img").alt = title;
    shell.querySelector(".result-title").textContent = chapter.title || `${title} — Session Complete`;
    shell.querySelector(".result-lead").textContent = chapter.content || "All seven rounds have been resolved.";
    const cards = shell.querySelectorAll(".summary-card");
    cards[0].querySelector("strong").textContent = result.player?.roleName || "Participant";
    cards[1].querySelector("strong").textContent = "Seven rounds resolved";
    cards[1].querySelector("p").textContent = result.player?.personalGoal || "Your decisions are recorded in this completed chapter.";
    cards[2].querySelector("strong").textContent = "Chapter archived";
    cards[2].querySelector("p").textContent = `${result.completedNodes || 7} shared rounds were resolved by the room.`;
    const decisionItems = shell.querySelector(".lower-card");
    decisionItems.innerHTML = `<h2>♎　 Key Decisions</h2>${highlights.length ? highlights.map((item, index) => `<div class="decision-item"><span class="number-dot">${index + 1}</span><span>${esc(typeof item === "string" ? item : item?.text || item?.title || "Shared decision")}</span></div>`).join("") : `<div class="decision-item"><span class="number-dot">1</span><span>All room actions have been recorded in the completed chapter.</span></div>`}`;
    return true;
  } catch (error) { notice(error.message || "Unable to load this result."); return false; }
}

async function loadImageSource(source) {
  const image = new Image(); image.src = source;
  await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = () => reject(new Error("Image could not be loaded")); });
  return image;
}

async function buildResultPoster(title, qrDataUrl) {
  const canvas = document.createElement("canvas"); canvas.width = 1080; canvas.height = 1350;
  const ctx = canvas.getContext("2d");
  const gradient = ctx.createLinearGradient(0, 0, 1080, 1350); gradient.addColorStop(0, "#24105d"); gradient.addColorStop(.55, "#5e35d9"); gradient.addColorStop(1, "#9b78f0");
  ctx.fillStyle = gradient; ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "rgba(255,255,255,.10)"; ctx.beginPath(); ctx.arc(930, 180, 280, 0, Math.PI * 2); ctx.fill(); ctx.beginPath(); ctx.arc(130, 1180, 330, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "#fff"; ctx.font = "600 56px Arial"; ctx.fillText(BRAND_NAME, 80, 120); ctx.font = "700 72px Arial"; wrapPosterText(ctx, title, 80, 300, 900, 88);
  ctx.font = "400 34px Arial"; ctx.fillStyle = "#eee8ff"; ctx.fillText("A seven-round shared story recap", 80, 565);
  const qr = await loadImageSource(qrDataUrl); ctx.fillStyle = "#fff"; ctx.fillRect(610, 755, 390, 390); ctx.drawImage(qr, 630, 775, 350, 350);
  ctx.fillStyle = "#fff"; ctx.font = "600 36px Arial"; ctx.fillText("Scan to read the public recap", 80, 1115); ctx.font = "400 27px Arial"; ctx.fillStyle = "#e7ddff"; ctx.fillText("Private goals, actions and player identities are not included.", 80, 1170);
  return canvas.toDataURL("image/png");
}

async function openResultShare() {
  const runId = String(params.get("runId") || "").trim();
  if (!runId || !requireSession()) return;
  const dialog = document.createElement("dialog"); dialog.className = "share-dialog result-share-dialog";
  dialog.innerHTML = `<button class="dialog-close" type="button" aria-label="Close">×</button><p class="eyebrow">SAFE RESULT SHARE</p><h2>Create a public recap</h2><p class="muted">The public page excludes player identities, private goals, hidden intent, clues, raw actions and reasoning traces.</p><form data-result-share-form class="result-share-form"><label>Link expires<select name="expiresInDays"><option value="1">In 24 hours</option><option value="7" selected>In 7 days</option><option value="30">In 30 days</option></select></label><label class="share-role-option"><input type="checkbox" name="includeRoleName"> Include my role name (never the private goal)</label><button class="btn primary" type="submit">Create secure link</button></form><section data-result-share-output hidden></section>`;
  document.body.append(dialog); dialog.showModal(); dialog.querySelector(".dialog-close").addEventListener("click", () => dialog.close()); dialog.addEventListener("close", () => dialog.remove(), { once:true });
  dialog.querySelector("[data-result-share-form]").addEventListener("submit", async (event) => {
    event.preventDefault(); const form = event.currentTarget; const button = form.querySelector("button"); button.disabled = true;
    const data = new FormData(form);
    try {
      const share = await request(`/api/v4/rooms/${encodeURIComponent(runId)}/result/shares`, { method:"POST", body:JSON.stringify({ expiresInDays:Number(data.get("expiresInDays")), includeRoleName:data.get("includeRoleName") === "on", channel:"LINK" }) });
      const title = root.querySelector(".result-title")?.textContent?.trim() || `An ${BRAND_NAME} story recap`;
      const poster = await buildResultPoster(title, share.qrDataUrl);
      const output = dialog.querySelector("[data-result-share-output]"); form.hidden = true; output.hidden = false;
      output.innerHTML = `<div class="secure-share-status"><strong>Secure link ready</strong><span>Expires ${esc(new Date(share.expiresAt).toLocaleString())}</span></div><label class="share-link-label"><span>↗</span><input readonly value="${esc(share.url)}"><button type="button" data-copy-result>Copy link</button></label><div class="share-network-row result-network-row"><button data-result-channel="WHATSAPP"><b>◉</b>WhatsApp</button><button data-result-channel="TELEGRAM"><b>➤</b>Telegram</button><button data-result-channel="FACEBOOK"><b>f</b>Facebook</button><button data-result-channel="X"><b>𝕏</b>X</button><button data-result-native><b>↗</b>Share</button></div><div class="result-poster"><img src="${poster}" alt="Result share poster"><button class="btn" type="button" data-download-result>Download poster</button></div><button class="btn danger revoke-share" type="button" data-revoke-result>Revoke this link</button>`;
      const copy = async () => { try { await navigator.clipboard.writeText(share.url); notice("Secure result link copied."); } catch { const input = output.querySelector("input"); input.focus(); input.select(); notice("Copy was blocked. The link is selected."); } };
      output.querySelector("[data-copy-result]").addEventListener("click", copy);
      output.querySelectorAll("[data-result-channel]").forEach((channelButton) => channelButton.addEventListener("click", () => { const channel = channelButton.dataset.resultChannel; const url = encodeURIComponent(share.url); const text = encodeURIComponent(`Read my ${BRAND_NAME} recap: ${title}`); const links = { WHATSAPP:`https://wa.me/?text=${text}%20${url}`, TELEGRAM:`https://t.me/share/url?url=${url}&text=${text}`, FACEBOOK:`https://www.facebook.com/sharer/sharer.php?u=${url}`, X:`https://x.com/intent/post?text=${text}%20${url}` }; window.open(links[channel], "_blank", "noopener,noreferrer"); }));
      output.querySelector("[data-result-native]").addEventListener("click", async () => { if (navigator.share) { try { await navigator.share({ title, text:`An ${BRAND_NAME} story recap`, url:share.url }); } catch {} } else await copy(); });
      output.querySelector("[data-download-result]").addEventListener("click", () => { const link = document.createElement("a"); link.download = `many-worlds-result-${runId.slice(-8)}.png`; link.href = poster; link.click(); });
      output.querySelector("[data-revoke-result]").addEventListener("click", async (clickEvent) => { if (!confirm("Revoke this public link now? Anyone using it will immediately lose access.")) return; clickEvent.currentTarget.disabled = true; try { await request(`/api/v4/rooms/${encodeURIComponent(runId)}/result/shares/${encodeURIComponent(share.id)}`, { method:"DELETE" }); notice("Result link revoked."); dialog.close(); } catch (error) { clickEvent.currentTarget.disabled = false; notice(error.message || "Unable to revoke this link."); } });
    } catch (error) { button.disabled = false; notice(error.message || "Unable to create a secure result link."); }
  });
}

function renderSharedResult() {
  const token = String(params.get("token") || "").trim();
  appShell(`<section class="page-frame public-result-frame"><div class="public-result-brand"><img src="/assets/brand/many-worlds-logo.png" alt=""><strong>${BRAND_NAME}</strong></div><div data-public-result><p class="muted">Loading the shared recap…</p></div></section>`);
  if (!token) { root.querySelector("[data-public-result]").innerHTML = '<div class="public-result-error"><h1>Link not found</h1><p>This result link is incomplete.</p><a class="btn primary" href="/">Explore Our Many Worlds</a></div>'; return; }
  void request(`/api/v4/public/results/${encodeURIComponent(token)}`).then((result) => {
    const highlights = Array.isArray(result.recap?.highlights) ? result.recap.highlights : [];
    root.querySelector("[data-public-result]").innerHTML = `<p class="eyebrow">SHARED STORY RECAP</p><h1>${esc(result.recap?.title || result.room?.title || "A completed story")}</h1><p class="public-result-meta">${esc(result.room?.title || BRAND_NAME)} · ${esc(String(result.room?.completedNodes || 7))} rounds completed</p>${result.recap?.roleName ? `<p class="public-role">Shared from the perspective of <strong>${esc(result.recap.roleName)}</strong></p>` : ""}<section class="public-highlights"><h2>Turning points</h2>${highlights.length ? highlights.map((item, index) => `<article><span>${index + 1}</span><p>${esc(item)}</p></article>`).join("") : '<p>This public recap contains no private story details.</p>'}</section><aside class="privacy-note"><strong>Privacy protected</strong><p>Player identities, private goals, hidden intent, clues, raw actions and reasoning traces were removed from this public view.</p><small>This link expires ${esc(new Date(result.share.expiresAt).toLocaleString())}.</small></aside><a class="btn primary public-result-cta" href="/">Create your own world</a>`;
  }).catch((error) => { root.querySelector("[data-public-result]").innerHTML = `<div class="public-result-error"><h1>This link is unavailable</h1><p>${esc(error.message || "It may have expired or been revoked.")}</p><a class="btn primary" href="/">Explore Our Many Worlds</a></div>`; });
}
async function fetchInviteQr(roomCode) {
  const response = await fetch(apiUrl(`/api/v4/referrals/qr?room=${encodeURIComponent(roomCode)}`), { credentials: "include" });
  if (!response.ok) { const error = await response.json().catch(() => ({})); throw new Error(error.message || "Unable to generate invitation QR code"); }
  const blob = await response.blob(); const objectUrl = URL.createObjectURL(blob); const image = new Image(); image.src = objectUrl;
  await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = () => reject(new Error("Invitation QR code could not be loaded")); });
  return { objectUrl, image };
}
async function downloadInvitePoster({ title, inviteUrl, code, qr }) {
  const canvas = document.createElement("canvas"); canvas.width = 1080; canvas.height = 1350;
  await document.fonts?.ready; const ctx = canvas.getContext("2d"); const background = new Image(); background.src = "/assets/poster/invite-background.png"; await new Promise((resolve, reject) => { background.onload = resolve; background.onerror = () => reject(new Error("Invitation poster background could not be loaded")); }); ctx.drawImage(background, 0, 0, canvas.width, canvas.height); const gradient = ctx.createLinearGradient(0, 0, 1080, 1350); gradient.addColorStop(0, "rgba(83,56,174,.20)"); gradient.addColorStop(1, "rgba(207,190,255,.14)"); ctx.fillStyle = gradient; ctx.fillRect(0, 0, 1080, 1350);
  ctx.fillStyle = "#fff"; ctx.font = '600 64px "MW Inter", Arial, sans-serif'; ctx.fillText(BRAND_NAME, 90, 150); ctx.font = '700 78px "MW Inter", Arial, sans-serif'; wrapPosterText(ctx, title, 90, 340, 900, 94); ctx.font = '400 36px "MW Inter", Arial, sans-serif'; ctx.fillStyle = "#e9ddff"; ctx.fillText(BRAND_TAGLINE, 90, 610); ctx.fillStyle = "#fff"; ctx.font = '600 42px "MW Inter", Arial, sans-serif'; ctx.fillText("A shared story room awaits", 90, 710);
  const size = 360, left = 630, top = 850; ctx.fillStyle = "#fff"; ctx.fillRect(left - 24, top - 24, size + 48, size + 48); ctx.drawImage(qr.image, left, top, size, size);
  ctx.fillStyle = "#e9ddff"; ctx.font = '400 28px "MW Inter", Arial, sans-serif'; ctx.fillText("Scan to choose a role and join the story", 90, 1210); const link = document.createElement("a"); link.download = `many-worlds-${code}-invite.png`; link.href = canvas.toDataURL("image/png"); link.click();
}
function wrapPosterText(ctx, text, x, y, maxWidth, lineHeight) { const words = String(text).split(/\s+/); let line = "", offset = 0; words.forEach((word) => { const next = `${line}${line ? " " : ""}${word}`; if (ctx.measureText(next).width > maxWidth && line) { ctx.fillText(line, x, y + offset); line = word; offset += lineHeight; } else line = next; }); if (line) ctx.fillText(line, x, y + offset); }
async function buildInvitePoster({ title }) {
  const canvas = document.createElement("canvas");
  canvas.width = 1080;
  canvas.height = 950;
  await document.fonts?.ready;
  const ctx = canvas.getContext("2d");
  const background = await loadCanvasImage("/assets/poster/invite-promo-background.png");
  const logo = await loadCanvasImage("/assets/brand/many-worlds-logo.png");
  ctx.fillStyle = "#f4efff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.save();
  ctx.filter = "blur(2px) saturate(.62) contrast(.78)";
  ctx.drawImage(background, 0, 0, background.width, background.height, -8, -8, canvas.width + 16, canvas.height + 16);
  ctx.restore();
  const wash = ctx.createLinearGradient(0, 0, 0, canvas.height);
  wash.addColorStop(0, "rgba(255,255,255,.58)");
  wash.addColorStop(.52, "rgba(255,253,255,.46)");
  wash.addColorStop(1, "rgba(239,232,255,.28)");
  ctx.fillStyle = wash;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.save();
  ctx.globalAlpha = .94;
  ctx.drawImage(logo, 310, 55, 88, 88);
  ctx.restore();
  ctx.fillStyle = "#182044";
  ctx.font = '700 36px "MW Inter", "Segoe UI", sans-serif';
  ctx.fillText(BRAND_NAME, 414, 94);
  ctx.fillStyle = "#68718d";
  ctx.font = '400 21px "MW Inter", "Segoe UI", sans-serif';
  ctx.fillText(BRAND_TAGLINE, 414, 125);

  ctx.textAlign = "center";
  ctx.fillStyle = "#111a42";
  ctx.font = '700 58px "MW Inter", "Segoe UI", sans-serif';
  ctx.fillText("Play living story worlds", canvas.width / 2, 286);
  ctx.fillText("together on the web", canvas.width / 2, 354);
  ctx.fillStyle = "#4f5877";
  ctx.font = '400 29px "MW Inter", "Segoe UI", sans-serif';
  ctx.fillText("Explore different worlds. Join a shared room.", canvas.width / 2, 434);
  ctx.fillText("Choose a role, share decisions, and shape the outcome.", canvas.width / 2, 472);

  ctx.fillStyle = "#6944dc";
  ctx.font = '600 23px "MW Inter", "Segoe UI", sans-serif';
  ctx.fillText("Historical intrigue  ·  Sci-fi crisis  ·  Social drama  ·  Fantasy", canvas.width / 2, 564);

  const buttonWidth = 410, buttonHeight = 94, buttonX = (canvas.width - buttonWidth) / 2, buttonY = 686;
  const buttonGradient = ctx.createLinearGradient(buttonX, buttonY, buttonX + buttonWidth, buttonY + buttonHeight);
  buttonGradient.addColorStop(0, "#7650e2");
  buttonGradient.addColorStop(1, "#6640dc");
  ctx.fillStyle = buttonGradient;
  roundRect(ctx, buttonX, buttonY, buttonWidth, buttonHeight, 47);
  ctx.fill();
  ctx.fillStyle = "#ffffff";
  ctx.font = '700 31px "MW Inter", "Segoe UI", sans-serif';
  ctx.fillText("Start on the web", canvas.width / 2, buttonY + 58);
  ctx.fillStyle = "#40356b";
  ctx.font = '600 28px "MW Inter", "Segoe UI", sans-serif';
  ctx.fillText("ourmanyworlds.com", canvas.width / 2, 864);

  ctx.fillStyle = "rgba(111,75,220,.38)";
  [[112,170,8],[936,144,6],[158,616,5],[914,594,8],[848,844,5]].forEach(([x,y,radius]) => {
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
  });
  ctx.textAlign = "start";
  return await new Promise((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(URL.createObjectURL(blob)) : reject(new Error("Invitation poster could not be encoded")), "image/png"));
}
function roundRect(ctx, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
}
async function copyInviteLink(dialog, inviteUrl) { try { await navigator.clipboard.writeText(inviteUrl); notice("Invite link copied. Sharing alone does not grant credits."); } catch { const field = dialog.querySelector(".share-link-label input"); field.value = inviteUrl; field.focus(); field.select(); notice("Copy was blocked. The invitation link is selected so you can copy it manually."); } }
function shareUiIcon(name) {
  const paths = {
    gift: '<path d="M4 10h16v10H4z"/><path d="M2.5 6.5h19v4h-19zM12 6.5V20"/><path d="M12 6.5c-2.8 0-5.2-.5-5.2-2.4C6.8 2.9 7.7 2 9 2c1.7 0 3 2 3 4.5Zm0 0c2.8 0 5.2-.5 5.2-2.4 0-1.2-.9-2.1-2.2-2.1-1.7 0-3 2-3 4.5Z"/>',
    link: '<path d="M10.5 13.5 13.5 10"/><path d="M7.2 16.8 5.6 18.4a3.4 3.4 0 0 1-4.8-4.8l3.8-3.8a3.4 3.4 0 0 1 4.8 0"/><path d="m16.8 7.2 1.6-1.6a3.4 3.4 0 1 1 4.8 4.8l-3.8 3.8a3.4 3.4 0 0 1-4.8 0"/>',
    copy: '<rect x="8" y="8" width="11" height="11" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>',
    share: '<path d="M12 3v12"/><path d="m7 8 5-5 5 5"/><path d="M5 13v6h14v-6"/>',
    download: '<path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 20h14"/>',
    clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5v5l3.4 1.9"/>',
    players: '<path d="M16.2 18.5v-1.3c0-1.7-1.5-3-3.4-3h-5.6c-1.9 0-3.4 1.3-3.4 3v1.3"/><circle cx="10" cy="8.4" r="2.9"/><path d="M18.7 18.1v-1c0-1-.7-1.9-1.8-2.4"/><path d="M15.8 6.2c1.4.2 2.4 1.3 2.4 2.7 0 1.4-1 2.5-2.4 2.7"/>',
    whatsapp: '<circle cx="12" cy="12" r="9"/><path d="M8.5 7.8c.6 4 3.6 7 7.7 7.7l1.2-1.9-2.8-1.3-1 1c-1.6-.7-2.2-1.3-2.9-2.9l1-1-1.3-2.8Z"/>',
    telegram: '<path d="m3 11 18-7-6.5 16-3.8-5.6L16 9l-7 4.2Z"/>',
    discord: '<path d="M7 7c3-1.4 7-1.4 10 0l2 10c-1.4 1.5-2.8 2.3-4.3 2.9l-1-1.8c.8-.3 1.5-.7 2.1-1.2-2.5 1.1-5.1 1.1-7.6 0 .6.5 1.3.9 2.1 1.2l-1 1.8C7.8 19.3 6.4 18.5 5 17Z"/><circle cx="9.5" cy="13" r="1"/><circle cx="14.5" cy="13" r="1"/>',
    facebook: '<path d="M14.6 5.2h2V2.4h-2.5c-2.7 0-4.3 1.6-4.3 4.4v2H7.5v2.9h2.3v7h3.2v-7h2.7l.5-2.9H13V7c0-1.1.5-1.8 1.6-1.8Z"/>',
    x: '<path d="m5 4 14 16"/><path d="M18.7 4 13 10.2"/><path d="M11 12.6 5.3 20"/><path d="M9.3 4H5l9.8 16H19Z"/>'
  };
  return `<svg class="share-ui-icon" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${paths[name] || ""}</svg>`;
}
async function loadCanvasImage(src) {
  const image = new Image();
  image.src = src;
  await new Promise((resolve, reject) => {
    image.onload = resolve;
    image.onerror = () => reject(new Error(`Image could not be loaded: ${src}`));
  });
  return image;
}
async function buildInvitePosterRefined({ worldTitle, roomTitle, qr }) {
  const canvas = document.createElement("canvas");
  canvas.width = 1080;
  canvas.height = 1350;
  await document.fonts?.ready;
  const ctx = canvas.getContext("2d");
  const background = await loadCanvasImage("/assets/poster/invite-background.png");
  const logo = await loadCanvasImage("/assets/brand/many-worlds-logo.png");
  ctx.drawImage(background, 0, 0, canvas.width, canvas.height);
  const overlay = ctx.createLinearGradient(0, 0, 0, canvas.height);
  overlay.addColorStop(0, "rgba(20,18,46,.08)");
  overlay.addColorStop(.48, "rgba(91,61,195,.12)");
  overlay.addColorStop(1, "rgba(23,18,48,.34)");
  ctx.fillStyle = overlay;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const glow = ctx.createLinearGradient(86, 88, 888, 880);
  glow.addColorStop(0, "rgba(255,255,255,.22)");
  glow.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(74, 82, 916, 930);
  ctx.drawImage(logo, 92, 90, 112, 112);
  ctx.fillStyle = "#ffffff";
  ctx.font = '600 34px "MW Inter", "Segoe UI", sans-serif';
  ctx.fillText(BRAND_NAME, 224, 144);
  ctx.fillStyle = "rgba(244,238,255,.84)";
  ctx.font = '400 24px "MW Inter", "Segoe UI", sans-serif';
  ctx.fillText(BRAND_TAGLINE, 224, 182);
  ctx.fillStyle = "#ffffff";
  ctx.font = '700 72px Georgia, "Times New Roman", serif';
  wrapPosterText(ctx, worldTitle, 92, 332, 890, 82);
  const chipX = 92, chipY = 840, chipWidth = 352, chipHeight = 58;
  ctx.fillStyle = "rgba(252,248,255,.20)";
  roundRect(ctx, chipX, chipY, chipWidth, chipHeight, 29);
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,.28)";
  ctx.lineWidth = 2;
  roundRect(ctx, chipX, chipY, chipWidth, chipHeight, 29);
  ctx.stroke();
  ctx.fillStyle = "#ffffff";
  ctx.font = '600 28px "MW Inter", "Segoe UI", sans-serif';
  ctx.fillText(roomTitle || "Shared room", chipX + 26, chipY + 37);
  ctx.fillStyle = "rgba(240,232,255,.94)";
  ctx.font = '600 26px "MW Inter", "Segoe UI", sans-serif';
  ctx.fillText("A shared story room awaits", 92, 744);
  ctx.font = '400 26px "MW Inter", "Segoe UI", sans-serif';
  ctx.fillText("Choose a role. Shape one outcome.", 92, 788);
  const qrSize = 286, qrLeft = 686, qrTop = 922;
  ctx.fillStyle = "#ffffff";
  roundRect(ctx, qrLeft - 22, qrTop - 22, qrSize + 44, qrSize + 44, 26);
  ctx.fill();
  ctx.drawImage(qr.image, qrLeft, qrTop, qrSize, qrSize);
  ctx.fillStyle = "#efe8ff";
  ctx.font = '600 26px "MW Inter", "Segoe UI", sans-serif';
  ctx.fillText("Scan to join", qrLeft + 34, qrTop + qrSize + 60);
  ctx.fillStyle = "rgba(239,231,255,.84)";
  ctx.font = '400 24px "MW Inter", "Segoe UI", sans-serif';
  ctx.fillText("manyworlds.com/join", 92, 1232);
  return await new Promise((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(URL.createObjectURL(blob)) : reject(new Error("Invitation poster could not be encoded")), "image/png"));
}
async function openInviteShareRefined() {
  if (!activeRoom || !requireSession()) return;
  try {
    const opener = document.activeElement;
    const referral = await request("/api/v4/referrals/me");
    const inviteUrl = `${location.origin}/join?room=${encodeURIComponent(activeRoom.code)}&ref=${encodeURIComponent(referral.code)}&channel=LINK`;
    const shareText = `Join my ${BRAND_NAME} room: ${activeRoom.title}. Complete the opening together and we can earn ${referral.rewardPerQualifiedInvite} bonus credits.`;
    const rewardCap = Math.max(1, Number(referral.maxRewardedInvites || 2));
    const rewardPerInvite = Math.max(0, Number(referral.rewardPerQualifiedInvite || 25));
    const rewarded = Math.max(0, rewardCap - Number(referral.remainingRewardSlots || 0));
    const rewardPercent = Math.min(100, (rewarded / rewardCap) * 100);
    const worldTitle = roomWorldTitle(activeRoom);
    const roomTitle = roomDisplayTitle(activeRoom);
    const displayInviteUrl = `${location.host}/join`;
    const dialog = document.createElement("dialog");
    dialog.className = "share-dialog invite-share-dialog invite-share-dialog-v2";
    dialog.innerHTML = `<button type="button" class="dialog-close" data-close-share aria-label="Close">×</button><section class="share-room-head"><img src="${roomWorldImage(activeRoom.worldId, 0)}" alt="${esc(worldTitle)}"><div class="share-room-copy"><h2>Shared Story Room</h2><p>${esc(worldTitle)} · ${esc(roomTitle)}</p><div class="share-room-meta"><span class="share-status">${shareUiIcon("clock")}<b>Waiting</b></span><span class="share-player-count">${shareUiIcon("players")}<b>${activeRoom.players?.length || 1} / ${activeRoom.maxPlayers || 3} players</b></span></div></div></section><section class="share-reward-card"><span class="share-reward-emblem">${shareUiIcon("gift")}</span><div class="share-reward-copy"><p>Invite friends & earn rewards</p><strong>Earn up to ${rewardCap * rewardPerInvite} Bonus Credits</strong><span>Get ${rewardPerInvite} Bonus Credits for each new friend who joins and completes the opening.</span><div class="reward-progress"><i style="width:${rewardPercent}%"></i></div><small class="reward-progress-label">${rewarded} of ${rewardCap} rewards unlocked</small><small class="reward-honesty-note">Sharing alone does not grant Credits.</small></div><img class="share-reward-coins" src="/assets/payment/credits-stack-transparent.png" alt=""></section><div class="share-modal-grid"><section class="share-channels"><span class="share-card-accent" aria-hidden="true"></span><h3>Share your invitation</h3><p>Invite friends to join your shared room on ${BRAND_NAME}.</p><div class="share-network-row"><button type="button" data-share-channel="WHATSAPP"><b>${shareUiIcon("whatsapp")}</b>WhatsApp</button><button type="button" data-share-channel="TELEGRAM"><b>${shareUiIcon("telegram")}</b>Telegram</button><button type="button" data-share-channel="DISCORD"><b>${shareUiIcon("discord")}</b>Discord</button><button type="button" data-share-channel="FACEBOOK"><b>${shareUiIcon("facebook")}</b>Facebook</button><button type="button" data-share-channel="X"><b>${shareUiIcon("x")}</b>X</button><button type="button" data-copy-invite><b>${shareUiIcon("copy")}</b>Copy link</button></div><button type="button" class="btn primary share-native" data-native-share>${shareUiIcon("share")}<span>Share invitation</span></button></section><section class="poster-preview"><h3>Invite poster</h3><div class="poster-preview-shell"><img data-poster-preview alt="Invitation poster preview"></div><button type="button" class="btn" data-download-poster>${shareUiIcon("download")}<span>Download poster</span></button><small>Perfect for group chats and social posts.</small></section></div><label class="share-link-label">${shareUiIcon("link")}<input readonly value="${esc(displayInviteUrl)}" data-full-invite-url="${esc(inviteUrl)}" aria-label="Invitation link"><button type="button" data-copy-invite>${shareUiIcon("copy")}<span>Copy link</span></button></label>`;
    document.body.append(dialog);
    dialog.showModal();
    dialog.querySelector("[data-close-share]").addEventListener("click", () => dialog.close());
    const qr = await fetchInviteQr(activeRoom.code);
    const posterUrl = await buildInvitePosterRefined({ worldTitle, roomTitle, qr });
    dialog.querySelector("[data-poster-preview]").src = posterUrl;
    dialog.querySelectorAll("[data-copy-invite]").forEach((button) => button.addEventListener("click", () => copyInviteLink(dialog, inviteUrl)));
    dialog.querySelectorAll("[data-share-channel]").forEach((button) => button.addEventListener("click", async () => {
      const channel = button.dataset.shareChannel;
      await request("/api/v4/referrals/share-events", { method:"POST", body:JSON.stringify({ channel, runId:activeRoom.id }) });
      const channelUrl = `${location.origin}/join?room=${encodeURIComponent(activeRoom.code)}&ref=${encodeURIComponent(referral.code)}&channel=${encodeURIComponent(channel)}`;
      const encodedUrl = encodeURIComponent(channelUrl);
      const encodedText = encodeURIComponent(shareText);
      const links = {
        WHATSAPP:`https://wa.me/?text=${encodedText}%20${encodedUrl}`,
        TELEGRAM:`https://t.me/share/url?url=${encodedUrl}&text=${encodedText}`,
        DISCORD:"https://discord.com/channels/@me",
        FACEBOOK:`https://www.facebook.com/sharer/sharer.php?u=${encodedUrl}`,
        X:`https://x.com/intent/post?text=${encodedText}%20${encodedUrl}`
      };
      if (!window.open(links[channel] || inviteUrl, "_blank", "noopener,noreferrer")) await copyInviteLink(dialog, inviteUrl);
    }));
    dialog.querySelector("[data-native-share]").addEventListener("click", async () => {
      await request("/api/v4/referrals/share-events", { method:"POST", body:JSON.stringify({ channel:"NATIVE", runId:activeRoom.id }) });
      if (navigator.share) {
        try { await navigator.share({ title:BRAND_NAME, text:shareText, url:inviteUrl }); } catch {}
      } else await copyInviteLink(dialog, inviteUrl);
    });
    dialog.querySelector("[data-download-poster]").addEventListener("click", () => {
      const link = document.createElement("a");
      link.download = `many-worlds-${activeRoom.code}-invite.png`;
      link.href = posterUrl;
      link.click();
    });
    dialog.addEventListener("close", () => {
      URL.revokeObjectURL(qr.objectUrl);
      URL.revokeObjectURL(posterUrl);
      dialog.remove();
      opener?.focus?.();
    }, { once:true });
  } catch (error) { notice(error.message || "Unable to prepare the invitation link."); }
}
async function openInviteShare() {
  if (!activeRoom || !requireSession()) return;
  try {
    const opener = document.activeElement; const referral = await request("/api/v4/referrals/me");
    const inviteUrl = `${location.origin}/join?room=${encodeURIComponent(activeRoom.code)}&ref=${encodeURIComponent(referral.code)}&channel=LINK`;
    const shareText = `Join my ${BRAND_NAME} room: ${activeRoom.title}. Complete the opening together and we can earn ${referral.rewardPerQualifiedInvite} bonus credits.`;
    const rewardCap = Math.max(1, Number(referral.maxRewardedInvites || 2));
    const rewardPerInvite = Math.max(0, Number(referral.rewardPerQualifiedInvite || 25));
    const rewarded = Math.max(0, rewardCap - Number(referral.remainingRewardSlots || 0));
    const rewardPercent = Math.min(100, (rewarded / rewardCap) * 100);
    const worldTitle = roomWorldTitle(activeRoom);
    const roomTitle = roomDisplayTitle(activeRoom);
    const displayInviteUrl = `${location.host}/join`;
    const dialog = document.createElement("dialog"); dialog.className = "share-dialog invite-share-dialog";
    dialog.innerHTML = `<button type="button" class="dialog-close" data-close-share aria-label="Close">×</button><section class="share-room-head"><img src="${roomWorldImage(activeRoom.worldId, 0)}" alt="${esc(worldTitle)}"><div class="share-room-copy"><h2>Shared Story Room</h2><p>${esc(worldTitle)} · ${esc(roomTitle)}</p><div class="share-room-meta"><span class="share-status">◷ <b>Waiting</b></span><span class="share-player-count">♧ ${activeRoom.players?.length || 1} / ${activeRoom.maxPlayers || 3} players</span></div></div></section><section class="share-reward-card"><span class="share-reward-emblem">${shareUiIcon("gift")}</span><div class="share-reward-copy"><p>Invite friends & earn rewards</p><strong>Earn up to ${rewardCap * rewardPerInvite} Bonus Credits</strong><span>Get ${rewardPerInvite} Bonus Credits for each new friend who joins and completes the opening.</span><div class="reward-progress"><i style="width:${rewardPercent}%"></i></div><small class="reward-progress-label">${rewarded} of ${rewardCap} rewards unlocked</small><small class="reward-honesty-note">ⓘ Sharing alone does not grant Credits.</small></div><img class="share-reward-coins" src="/assets/payment/credits-stack-transparent.png" alt=""></section><div class="share-modal-grid"><section class="share-channels"><h3>Share your invitation</h3><p>Invite friends to this room on ${BRAND_NAME}.</p><div class="share-network-row"><button type="button" data-share-channel="WHATSAPP"><b>${shareUiIcon("whatsapp")}</b>WhatsApp</button><button type="button" data-share-channel="TELEGRAM"><b>${shareUiIcon("telegram")}</b>Telegram</button><button type="button" data-share-channel="DISCORD"><b>${shareUiIcon("discord")}</b>Discord</button><button type="button" data-share-channel="FACEBOOK"><b class="share-letter-icon">f</b>Facebook</button><button type="button" data-share-channel="X"><b class="share-letter-icon share-x-icon">𝕏</b>X</button><button type="button" data-copy-invite><b>${shareUiIcon("copy")}</b>Copy link</button></div><button type="button" class="btn primary share-native" data-native-share>${shareUiIcon("share")}<span>Share invitation</span></button></section><section class="poster-preview"><h3>Invite poster</h3><img data-poster-preview alt="Invitation poster preview"><button type="button" class="btn" data-download-poster>${shareUiIcon("download")}<span>Download poster</span></button><small>Perfect for group chats and social posts.</small></section></div><label class="share-link-label">${shareUiIcon("link")}<input readonly value="${esc(displayInviteUrl)}" data-full-invite-url="${esc(inviteUrl)}" aria-label="Invitation link"><button type="button" data-copy-invite>${shareUiIcon("copy")}<span>Copy link</span></button></label>`;
    document.body.append(dialog); dialog.showModal(); dialog.querySelector("[data-close-share]").addEventListener("click", () => dialog.close());
    const posterUrl = await buildInvitePoster({ title:activeRoom.title }); dialog.querySelector("[data-poster-preview]").src = posterUrl;
    dialog.querySelectorAll("[data-copy-invite]").forEach((button) => button.addEventListener("click", () => copyInviteLink(dialog, inviteUrl)));
    dialog.querySelectorAll("[data-share-channel]").forEach((button) => button.addEventListener("click", async () => { const channel = button.dataset.shareChannel; await request("/api/v4/referrals/share-events", { method:"POST", body:JSON.stringify({ channel, runId:activeRoom.id }) }); const channelUrl = `${location.origin}/join?room=${encodeURIComponent(activeRoom.code)}&ref=${encodeURIComponent(referral.code)}&channel=${encodeURIComponent(channel)}`; const encodedUrl = encodeURIComponent(channelUrl); const encodedText = encodeURIComponent(shareText); const links = { WHATSAPP:`https://wa.me/?text=${encodedText}%20${encodedUrl}`, TELEGRAM:`https://t.me/share/url?url=${encodedUrl}&text=${encodedText}`, DISCORD:"https://discord.com/channels/@me", FACEBOOK:`https://www.facebook.com/sharer/sharer.php?u=${encodedUrl}`, X:`https://x.com/intent/post?text=${encodedText}%20${encodedUrl}` }; if (!window.open(links[channel] || inviteUrl, "_blank", "noopener,noreferrer")) await copyInviteLink(dialog, inviteUrl); }));
    dialog.querySelector("[data-native-share]").addEventListener("click", async () => { await request("/api/v4/referrals/share-events", { method:"POST", body:JSON.stringify({ channel:"NATIVE", runId:activeRoom.id }) }); if (navigator.share) { try { await navigator.share({ title:BRAND_NAME, text:shareText, url:inviteUrl }); } catch {} } else await copyInviteLink(dialog, inviteUrl); });
    dialog.querySelector("[data-download-poster]").addEventListener("click", () => { const link = document.createElement("a"); link.download = `many-worlds-${activeRoom.code}-invite.png`; link.href = posterUrl; link.click(); });
    dialog.addEventListener("close", () => { URL.revokeObjectURL(posterUrl); dialog.remove(); opener?.focus?.(); }, { once:true });
  } catch (error) { notice(error.message || "Unable to prepare the invitation link."); }
}
function sessionToken() { return hasSessionCookie() ? "cookie-session" : ""; }
function loginUrl(returnTo) { return `/auth?returnTo=${encodeURIComponent(safeReturnTo(returnTo))}`; }
async function openAuthenticatedRoute(returnTo) {
  const target = safeReturnTo(returnTo);
  if (!sessionToken()) {
    location.assign(loginUrl(target));
    return;
  }
  try {
    await request("/api/v4/auth/me");
    location.assign(target);
  } catch (error) {
    if (error?.status === 401) location.assign(loginUrl(target));
    else notice(error?.message || "Unable to verify your login. Please try again.");
  }
}
function requireSession() { if (sessionToken()) return true; location.assign(loginUrl(path + location.search)); return false; }
async function request(url, options = {}) { const response = await fetch(apiUrl(url), { ...options, credentials: "include", headers: { "content-type":"application/json", ...(options.headers || {}) } }); const data = await response.json().catch(() => ({})); if (response.status === 401) clearSessionHint(); if (!response.ok) { const error = new Error(data.message || data.code || `Request failed: ${response.status}`); error.code = data.code || null; error.status = response.status; throw error; } return data; }
function roomWorldLabel(worldId) {
  if (worldId === "sangtian") return "Sangtian Edict";
  if (worldId === "caesar") return "Caesar";
  return worldCatalog.find((world) => world.id === worldId)?.title || String(worldId || "World").replace(/[-_]/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}
function roomWorldImage(worldId, index) { return `/assets/bg/${worldId === "sangtian" ? 2 : worldId === "caesar" ? 1 : (index % 5) + 1}.png`; }
function roomStatus(room, view) {
  if (view === "open") return { label: "Open", tone: "open" };
  if (room.status === "playing") return { label: "In Progress", tone: "progress" };
  if (room.status === "chapter_generated") return { label: "Complete", tone: "complete" };
  return { label: room.players?.length >= room.maxPlayers ? "Full" : "Waiting", tone: room.players?.length >= room.maxPlayers ? "full" : "wait" };
}
function roomAction(room, view) {
  if (view === "open") return { label: "Join", attributes: `data-open-room="${esc(room.id)}" data-join-code="${esc(room.code || "")}"` };
  const action = room.nextAction || "open";
  const label = action === "continue" ? "Continue" : action === "view_result" ? "View Result" : "Start";
  return { label, attributes: `data-my-room="${esc(room.id)}" data-next-action="${esc(action)}"` };
}
function roomRows(rooms, view = "open") {
  const emptyCopy = view === "open" ? "No open rooms yet. Create the first room." : "You have not joined a room yet.";
  return rooms.map((room, index) => roomRow(room, index, view)).join("") || `<p class="rooms-empty-state">${emptyCopy}</p>`;
}
function renderRoomsView() {
  const target = root.querySelector("[data-live-rooms]");
  if (!target) return;
  root.querySelectorAll(".rooms-tabs [role='tab']").forEach((tab) => {
    const active = tab.dataset.action === `${roomsView.activeTab}-tab`;
    tab.classList.toggle("active", active);
    tab.setAttribute("aria-selected", String(active));
  });
  if (!sessionToken()) {
    target.innerHTML = `<p class="rooms-empty-state">${roomsView.activeTab === "my" ? "Log in to view your rooms." : "Log in to view live rooms."}</p>`;
    root.querySelector("[data-room-refresh-note]")?.setAttribute("hidden", "");
    return;
  }
  const activeRooms = roomsView.activeTab === "open" ? roomsView.openRooms : roomsView.myRooms;
  target.innerHTML = roomRows(activeRooms, roomsView.activeTab);
}
function setRoomsTab(activeTab) {
  roomsView.activeTab = activeTab === "my" ? "my" : "open";
  renderRoomsView();
  bindRoomActions();
}
function bindRoomActions() { root.querySelectorAll("[data-open-room]").forEach((button) => button.addEventListener("click", async () => { if (!requireSession() || button.disabled) return; const roomId = button.dataset.openRoom; return runMutationOnce(`join-open-room:${roomId}`, button, "Joining…", async () => { try { if (button.dataset.joinCode) await request("/api/v4/rooms/join-by-code", { method:"POST", body:JSON.stringify({ code: button.dataset.joinCode }) }); location.assign(`/rooms/${roomId}`); } catch (error) { notice(error.message || "Unable to join this room."); } }); })); root.querySelectorAll("[data-my-room]").forEach((button) => button.addEventListener("click", () => { const id = button.dataset.myRoom; const action = button.dataset.nextAction; location.assign(action === "continue" ? `/game?runId=${encodeURIComponent(id)}` : action === "view_result" ? `/game/result?runId=${encodeURIComponent(id)}` : `/rooms/${encodeURIComponent(id)}`); })); }
async function hydrateRooms() { try { const data = await request(`/api/v4/rooms${params.get("worldId") ? `?worldId=${encodeURIComponent(params.get("worldId"))}` : ""}`); roomsView.openRooms = Array.isArray(data.rooms) ? data.rooms : []; roomsView.myRooms = Array.isArray(data.myRooms) ? data.myRooms : []; renderRoomsView(); bindRoomActions(); clearNotice(); } catch (error) { notice(error.code === "INTERNAL_ERROR" ? "Rooms are temporarily unavailable. Retrying automatically…" : error.message || "Unable to load rooms."); const target = root.querySelector("[data-live-rooms]"); if (target) target.innerHTML = `<p class="rooms-empty-state rooms-load-error">Rooms could not be loaded. Please try again.</p>`; } }
function roomWorldTitle(room) {
  const declaredTitle = String(room?.world?.title || "").trim();
  if (declaredTitle) return declaredTitle;
  const persistedTitle = String(room?.title || "").trim();
  return persistedTitle || "Shared Story World";
}
function roomDisplayTitle(room) {
  const title = String(room?.title || "").trim();
  if (!title) return "Shared Story Room";
  const worldTitle = roomWorldTitle(room);
  for (const separator of ["：", ":"]) {
    const prefix = `${worldTitle}${separator}`;
    if (title.startsWith(prefix)) return title.slice(prefix.length).trim() || worldTitle;
  }
  return title;
}

function sharedMultiplayerRoomMarkup(room, { loading = false } = {}) {
  const roomRoles = Array.isArray(room?.roles) ? room.roles : [];
  const rolePortraits = new Map(roomRoles.map((role) => [role.id, role.portrait || ""]));
  const selectedRole = roomRoles.find((role) => role.claimedByCurrentUser);
  const currentPlayer = selectedRole ? room?.players?.find((player) => player.roleId === selectedRole.id) : null;
  const allPlayersReady = Boolean(
    room?.hostRoleLocked &&
    room?.players?.length >= room?.minPlayers &&
    room.players.every((player) => player.roleId && player.ready)
  );
  let footerMessage = "Choose a role before marking yourself ready.";
  if (currentPlayer?.roleId && !currentPlayer.ready) footerMessage = "Confirm that your role is selected and you are ready to begin.";
  if (currentPlayer?.ready && !room?.isHost) footerMessage = "You are ready. Waiting for the host to start the game.";
  if (currentPlayer?.ready && room?.isHost && !allPlayersReady) footerMessage = "You are ready. Waiting for every player to be ready.";
  if (room?.isHost && allPlayersReady) footerMessage = "All players are ready. You can start the game.";
  const players = (room?.players || []).map((player, index) => ({
    name: player.nickname,
    ready: player.ready,
    artwork: player.roleId ? rolePortraits.get(player.roleId) || "" : "",
    statusLabel: player.roleName || "No role selected"
  }));
  while (!loading && players.length < Number(room?.maxPlayers || 0)) players.push({ name: "Open Seat", ready: false, statusLabel: "—" });

  return renderRoomSelectionPage({
    mode: "multiplayer",
    worldId: room?.worldId || "",
    title: loading ? "Loading shared room…" : roomWorldTitle(room),
    bannerArtwork: room?.world?.bannerArtwork || "",
    sessionLabel: loading ? "Please wait for the live room details." : roomDisplayTitle(room),
    roles: roomRoles.map((role, index) => {
      const mine = role.claimedByCurrentUser;
      const available = room.status === "waiting_players" && (role.status === "available" || mine);
      return {
        id: role.id,
        key: role.roleKey || role.id,
        name: role.roleName,
        tagline: role.publicInfo || role.identity || "A role in this world.",
        artwork: role.portrait || roomRoleArtwork(room.worldId, role.roleKey, index),
        selected: mine,
        disabled: !available,
        statusLabel: mine ? "Selected by You" : available ? "Available" : "Taken",
        traits: role.traits?.length ? role.traits : ["Loyalty · Republic", "Influence · High", "Risk · Medium"]
      };
    }),
    selectedRole: selectedRole?.roleKey || selectedRole?.id || "",
    players,
    inviteCode: loading ? "Loading…" : room?.code,
    playerCountLabel: loading ? "Loading players…" : `${room.players.length} / ${room.maxPlayers}`,
    statusLabel: loading ? "Loading status…" : `${room.players.length} / ${room.maxPlayers} players  ·  Waiting for players`,
    infoText: loading ? "Loading role guidance…" : room.isHost ? "As the room creator, you choose roles first." : "Choose an available role and mark yourself ready.",
    footerMessage: loading ? "Loading live room status…" : footerMessage,
    backHref: room?.worldId ? `/worlds/${encodeURIComponent(room.worldId)}` : "/worlds",
    isHost: Boolean(room?.isHost),
    canReady: Boolean(currentPlayer?.roleId && !currentPlayer?.ready),
    canStart: allPlayersReady,
    readyLabel: currentPlayer?.ready ? "Ready ✓" : "Ready",
    loading
  });
}
async function refreshRoomsList() {
  const currentPath = location.pathname.replace(/\/$/, "") || "/";
  // A background list refresh must never interrupt a person who is entering an
  // invite code or choosing a world. Resume polling as soon as the dialog is
  // closed instead of rebuilding any room-list state underneath it.
  const roomDialogOpen = Boolean(document.querySelector(".join-code-dialog[open], .create-room-dialog[open]"));
  if (currentPath !== "/rooms" || roomsRefreshPending || roomDialogOpen) return;
  roomsRefreshPending = true;
  try { await hydrateRooms(); }
  finally { roomsRefreshPending = false; }
}
function readRoomDialogDraft() { try { const value = JSON.parse(sessionStorage.getItem(roomDialogDraftKey)); return value?.type ? value : null; } catch { return null; } }
function saveRoomDialogDraft(value) { try { sessionStorage.setItem(roomDialogDraftKey, JSON.stringify(value)); } catch {} }
function clearRoomDialogDraft() { try { sessionStorage.removeItem(roomDialogDraftKey); } catch {} }
function restoreRoomDialogDraft() {
  const draft = readRoomDialogDraft();
  if (draft?.type === "join") openJoinCodeDialog(draft);
  else if (draft?.type === "create") openCreateRoomDialog(draft);
}

function openJoinCodeDialog(restoredDraft = null) {
  if (!requireSession() || document.querySelector(".join-code-dialog")) return;
  const initialCode = restoredDraft?.type === "join" ? String(restoredDraft.code || "") : "";
  saveRoomDialogDraft({ type: "join", code: initialCode });
  const dialog = document.createElement("dialog");
  dialog.className = "join-code-dialog";
  dialog.setAttribute("aria-labelledby", "join-code-title");
  dialog.innerHTML = `<button class="dialog-close" type="button" aria-label="Close invite code dialog">×</button><p class="eyebrow">JOIN A PRIVATE ROOM</p><h2 id="join-code-title">Enter your invite code</h2><p class="muted">Ask the room host for the six-character code shown in their room.</p><label class="join-code-field">Invite code<input name="inviteCode" maxlength="6" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="ABC123"></label><p class="join-code-error" role="alert" hidden></p><div class="join-code-actions"><button class="btn" type="button" data-cancel>Cancel</button><button class="btn primary" type="button" data-submit>Join Room</button></div>`;
  document.body.append(dialog);
  const input = dialog.querySelector('input[name="inviteCode"]');
  const error = dialog.querySelector(".join-code-error");
  const submit = dialog.querySelector("[data-submit]");
  input.value = initialCode;
  const close = () => { clearRoomDialogDraft(); dialog.close(); dialog.remove(); };
  const join = async () => {
    const code = input.value.trim().toUpperCase();
    if (!/^[A-Z0-9]{6}$/.test(code)) {
      error.textContent = "Enter the six-character invite code.";
      error.hidden = false;
      input.focus();
      return;
    }
    return runMutationOnce(`join-room:${code}`, submit, "Joining…", async () => {
      error.hidden = true;
      try {
        const room = await request("/api/v4/rooms/join-by-code", { method:"POST", body:JSON.stringify({ code }) });
        clearRoomDialogDraft();
        location.assign(`/rooms/${room.id}`);
      } catch (joinError) {
        error.textContent = joinError.message || "Unable to join this room.";
        error.hidden = false;
      }
    });
  };
  dialog.querySelector(".dialog-close").addEventListener("click", close);
  dialog.querySelector("[data-cancel]").addEventListener("click", close);
  submit.addEventListener("click", join);
  input.addEventListener("input", () => { saveRoomDialogDraft({ type: "join", code: input.value }); });
  input.addEventListener("keydown", (event) => { if (event.key === "Enter") { event.preventDefault(); void join(); } });
  dialog.addEventListener("cancel", () => { clearRoomDialogDraft(); }, { once:true });
  dialog.addEventListener("close", () => { dialog.remove(); }, { once:true });
  dialog.showModal();
  input.focus();
}
function openCreateRoomDialog(restoredDraft = null) {
  if (!requireSession() || document.querySelector(".create-room-dialog")) return;
  const initialWorldId = restoredDraft?.type === "create" ? String(restoredDraft.worldId || "") : String(params.get("worldId") || "");
  saveRoomDialogDraft({ type: "create", worldId: initialWorldId });
  const opener = document.activeElement;
  const dialog = document.createElement("dialog");
  dialog.className = "create-room-dialog";
  dialog.setAttribute("aria-labelledby", "create-room-title");
  dialog.innerHTML = `<button class="dialog-close" type="button" aria-label="Close world selection">×</button><p class="eyebrow">CREATE A SHARED STORY ROOM</p><h2 id="create-room-title">Choose the world you want to play</h2><p class="muted">Every player in this room will enter the same world. Choose before the room is created.</p><div class="create-world-list" data-world-list><p class="create-world-loading">Loading playable worlds…</p></div><p class="create-room-error" role="alert" hidden></p><div class="create-room-actions"><button class="btn" type="button" data-cancel>Cancel</button><button class="btn primary" type="button" data-submit disabled>Create Room</button></div>`;
  document.body.append(dialog);
  const list = dialog.querySelector("[data-world-list]");
  const error = dialog.querySelector(".create-room-error");
  const submit = dialog.querySelector("[data-submit]");
  const close = () => { clearRoomDialogDraft(); dialog.close(); };
  const selectedWorldId = () => dialog.querySelector('input[name="worldId"]:checked')?.value || "";
  const syncSubmit = () => {
    const worldId = selectedWorldId();
    submit.disabled = !worldId;
    saveRoomDialogDraft({ type: "create", worldId });
  };
  const create = async () => {
    const worldId = selectedWorldId();
    if (!worldId) {
      error.textContent = "Choose a world before creating the room.";
      error.hidden = false;
      return;
    }
    const idempotencyStorageKey = `many-worlds:create-room:${worldId}`;
    const idempotencyKey = pendingMutationKey(idempotencyStorageKey);
    return runMutationOnce(`create-room:${worldId}`, submit, "Creating room…", async () => {
      error.hidden = true;
      try {
        const room = await request("/api/v4/rooms", { method:"POST", body:JSON.stringify({ worldId, idempotencyKey }) });
        localStorage.removeItem(idempotencyStorageKey);
        clearRoomDialogDraft();
        location.assign(`/rooms/${room.id}`);
      } catch (createError) {
        error.textContent = createError.message || "Unable to create this room.";
        error.hidden = false;
      }
    });
  };
  dialog.querySelector(".dialog-close").addEventListener("click", close);
  dialog.querySelector("[data-cancel]").addEventListener("click", close);
  submit.addEventListener("click", create);
  dialog.addEventListener("cancel", () => { clearRoomDialogDraft(); }, { once:true });
  dialog.addEventListener("close", () => { dialog.remove(); opener?.focus?.(); }, { once:true });
  dialog.showModal();
  void (async () => {
    try {
      const data = await request("/api/v4/worlds");
      const worlds = (Array.isArray(data.worlds) ? data.worlds : []).filter((world) => world.playable && world.modes?.includes("multiplayer"));
      if (!worlds.length) throw new Error("No multiplayer worlds are currently available.");
      const preferred = initialWorldId;
      list.innerHTML = worlds.map((world) => {
        const checked = world.id === preferred ? "checked" : "";
        const playerLabel = `${world.minHumanPlayers || 1}–${world.maxHumanPlayers || world.maxPlayers || 1} human players`;
        return `<label class="create-world-choice"><input type="radio" name="worldId" value="${esc(world.id)}" ${checked}><span><strong>${esc(world.title)}</strong><small>${esc(playerLabel)} · ${esc(world.totalDays || 7)} rounds</small><em>${esc(world.description || "A shared story world.")}</em></span></label>`;
      }).join("");
      list.querySelectorAll('input[name="worldId"]').forEach((input) => input.addEventListener("change", syncSubmit));
      syncSubmit();
      list.querySelector('input[name="worldId"]:checked')?.focus();
    } catch (loadError) {
      list.innerHTML = "";
      error.textContent = loadError.message || "Unable to load playable worlds.";
      error.hidden = false;
    }
  })();
}
async function hydrateSharedRoom(roomId) {
  try {
    const room = await request(`/api/v4/rooms/${encodeURIComponent(roomId)}`);
    activeRoom = room;
    if (room.status === "playing") {
      location.assign(`/game?runId=${encodeURIComponent(room.id)}`);
      return;
    }
    root.innerHTML = sharedMultiplayerRoomMarkup(room);
    bind();
  } catch (error) {
    notice(error.message || "Unable to load this room.");
  }
}

const actions = {
  "toggle-password": (_event, element) => { const input = root.querySelector('input[name="password"]'); if (!input) return; const reveal = input.type === "password"; input.type = reveal ? "text" : "password"; element.textContent = reveal ? "Hide" : "Show"; element.setAttribute("aria-label", reveal ? "Hide password" : "Show password"); },
  forgot: async () => { const email = root.querySelector('input[name="email"]')?.value?.trim(); if (!email) return notice("Enter your verified email address first."); try { await request("/api/v4/auth/password-reset/request", { method:"POST", body:JSON.stringify({ email }) }); notice("If this verified account exists, a password-reset email has been sent."); } catch (error) { notice(error.message || "Unable to request a password reset."); } },
  "resend-verification": async () => { const email = root.querySelector('input[name="email"]')?.value?.trim(); if (!email) return notice("Enter the email address that needs verification first."); try { await request("/api/v4/auth/verification/resend", { method:"POST", body:JSON.stringify({ email, returnTo: safeReturnTo(params.get("returnTo")) }) }); notice("If this account still needs verification, a new email has been sent."); } catch (error) { notice(error.message || "Unable to resend the verification email."); } },
  "edit-profile": () => openProfileEditor(),
  "retry-purchases": () => { void hydratePurchases(); },
  "view-refund": (_event, element) => openPurchaseStatus(element.dataset.purchaseId),
  "view-dispute": (_event, element) => openPurchaseStatus(element.dataset.purchaseId, true),
  "account-logout": async (_event, element) => { if (element?.disabled) return; element.disabled = true; try { await request("/api/v4/auth/logout", { method:"POST", body:"{}" }); try { globalThis.google?.accounts?.id?.disableAutoSelect?.(); } catch {} clearSessionHint(); location.assign("/"); } catch (error) { element.disabled = false; notice(error.message || "Unable to log out."); } },
  solo: (_event, element) => runMutationOnce("solo:caesar", element, "Checking login…", () => openAuthenticatedRoute("/role-select?story=caesar")), rooms: () => location.assign("/rooms?worldId=caesar"),
  "sangtian-solo": (_event, element) => runMutationOnce("solo:sangtian", element, "Checking login…", () => openAuthenticatedRoute("/role-select?story=sangtian")), "sangtian-rooms": () => location.assign("/rooms?worldId=sangtian"),
  "world-solo": (_event, element) => {
    const worldId = String(element?.dataset.worldId || "");
    if (!worldId) return;
    return runMutationOnce(`world-solo:${worldId}`, element, "Checking login…", () => openAuthenticatedRoute(`/role-select?story=${encodeURIComponent(worldId)}`));
  },
  "world-rooms": (_event, element) => location.assign(`/rooms?worldId=${encodeURIComponent(element.dataset.worldId)}`),
  "join-code": () => { openJoinCodeDialog(); },
  "create-room": () => { openCreateRoomDialog(); },
  "share-invite": () => { void openInviteShare(); },
  "select-role": async (_event, element) => {
    if (!activeRoom || !requireSession() || element?.disabled) return;
    const roomId = activeRoom.id;
    return runMutationOnce(`room:${roomId}:select-role`, element, "", async () => {
      try {
        await request(`/api/v4/rooms/${roomId}/role`, { method:"POST", body:JSON.stringify({ roleId: element.dataset.roleId }) });
        if (activeRoom?.id === roomId && activeRoom.isHost && !activeRoom.hostRoleLocked) await request(`/api/v4/rooms/${roomId}/role/lock`, { method:"POST", body:"{}" });
        await hydrateSharedRoom(roomId);
      } catch (error) { notice(error.message || "Unable to select that role."); }
    });
  },
  ready: async (_event, element) => {
    if (!activeRoom || !requireSession() || element?.disabled) return;
    const roomId = activeRoom.id;
    return runMutationOnce(`room:${roomId}:ready`, element, "Saving…", async () => {
      try {
        await request(`/api/v4/rooms/${roomId}/ready`, { method:"POST", body:JSON.stringify({ ready:true }) });
        await hydrateSharedRoom(roomId);
      } catch (error) {
        notice(error.message || "Unable to mark ready.");
        await hydrateSharedRoom(roomId).catch(() => {});
      }
    });
  },
  "start-game": async (_event, element) => {
    if (!activeRoom || !requireSession() || element?.disabled) return;
    const roomId = activeRoom.id;
    return runMutationOnce(`room:${roomId}:start`, element, "Starting…", async () => {
      try {
        const started = await request(`/api/v4/rooms/${roomId}/start`, { method:"POST", body:"{}" });
        const runId = started.runId || started.roomId || roomId;
        location.assign(`/game?runId=${encodeURIComponent(runId)}`);
      } catch (error) {
        notice(error.message || "Room is not ready to start.");
        await hydrateSharedRoom(roomId).catch(() => {});
      }
    });
  },
  "request-refund": (_event, element) => openRefundRequest(element.dataset.purchaseId),
  "play-again": () => location.assign("/role-select?story=caesar"), "other-role": () => location.assign("/role-select?story=caesar"), "back-worlds": () => location.assign("/worlds"), "share-recap": () => { void openResultShare(); }, "open-tab": () => setRoomsTab("open"), "my-tab": () => setRoomsTab("my"), "clear-world-filter": () => location.assign("/rooms")
};
async function initializePlatform() {
  await migrateLegacySession();
  if (path === "/auth") renderAuth(); else if (path === "/account") renderAccount(); else if (path === "/admin/refunds") renderAdminRefunds(); else if (path === "/shared/result") renderSharedResult(); else if (path === "/join") renderJoin(); else if (path.startsWith("/worlds/")) await renderWorld(); else if (path === "/rooms") renderRooms(); else if (path.startsWith("/rooms/")) renderRoom(); else if (path === "/game/result") renderResult(); else location.assign("/");
}
void initializePlatform();
