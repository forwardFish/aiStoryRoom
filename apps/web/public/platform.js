const root = document.querySelector("#platform-app");
const path = location.pathname.replace(/\/$/, "") || "/";
const params = new URLSearchParams(location.search);
const isLocalRuntime = location.hostname === "localhost" || location.hostname === "127.0.0.1";
const deployedApiBase = "/api";
const platformApiBase = (params.get("apiBase") || (isLocalRuntime ? "/api" : deployedApiBase)).replace(/\/$/, "");
const purple = "#6434d7";
let activeRoom = null;
let roomRefreshTimer = null;
let currentAccount = null;
let accountPurchaseCache = new Map();
const roles = [
  ["Brutus", "I serve Rome, not any man.", "/assets/portrait/1.png"],
  ["Caesar", "I came, I saw, I changed Rome.", "/assets/portrait/2.png"],
  ["Cassius", "Liberty isn't given. It's taken.", "/assets/portrait/3.png"],
  ["Mark Antony", "I speak for Rome. And I remember.", "/assets/portrait/4.png"],
  ["Decimus", "I watch. I learn. I will decide.", "/assets/portrait/5.png"],
  ["Cicero", "Words are my sharpest weapon.", "/assets/portrait/6.png"]
];

function esc(value) { return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[char]); }
function emailInitial(value) { return String(value || "M").trim().charAt(0).toUpperCase() || "M"; }
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
  if (active === "auth") return `<header class="mw-header"><a class="brand" href="/"><span class="brand-mark">◉</span><span>Many Worlds</span></a>${utility}</header>`;
  return `<header class="mw-header"><a class="brand" href="/"><span class="brand-mark">◉</span><span>Many Worlds</span></a><nav class="mw-nav"><a class="${active === "worlds" ? "active" : ""}" href="/worlds/caesar">Explore Worlds</a><a class="${active === "rooms" ? "active" : ""}" href="/rooms">Rooms</a><a href="/credits">World Credits</a></nav>${utility}</header>`;
}
function appShell(content, active = "") {
  if (roomRefreshTimer) { clearInterval(roomRefreshTimer); roomRefreshTimer = null; }
  // Global platform header is temporarily disabled on every platform page.
  // Keep `header()` above intact so the navigation can be restored later.
  // root.innerHTML = `${header(active || (path === "/auth" ? "auth" : ""))}${content}`;
  root.innerHTML = content;
  if (path !== "/auth" && path !== "/rooms") root.querySelector(".page-frame")?.classList.add("visual-tight");
  bind();
  if (path === "/rooms" && sessionToken()) void hydrateRooms();
  const roomMatch = path.match(/^\/rooms\/([^/]+)$/);
  if (roomMatch && !roomMatch[1].startsWith("fixture-") && sessionToken()) {
    void hydrateRoom(roomMatch[1]);
    roomRefreshTimer = setInterval(() => { if (location.pathname === path) void hydrateRoom(roomMatch[1]); }, 5000);
  }
}
function bind() {
  root.querySelectorAll("[data-action]").forEach((element) => { element.onclick = (event) => actions[element.dataset.action]?.(event, element); });
}
function notice(message) { let target = root.querySelector("[data-notice]"); if (!target) { target = document.createElement("p"); target.dataset.notice = ""; target.className = "notice"; root.querySelector(".page-frame")?.prepend(target); } if (target) { target.textContent = message; target.hidden = false; } }

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
            ? "This email already has a Many Worlds account. Log in with your password, then open My Account to link Google."
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
  // An existing Many Worlds session wins over a stale or bookmarked login URL,
  // but verification links must consume their token before session restore.
  // Account switching is handled by an explicit logout.
  if (!isVerificationLink && !skipRestore && hasSessionCookie()) {
    restoreBrowserSession(returnTo);
    return;
  }
  appShell(`<section class="page-frame auth-frame"><form class="auth-card" data-auth-form novalidate><h1 class="auth-title">Welcome to Many Worlds</h1><p class="auth-subtitle">Log in or create an account to continue.</p><div class="auth-tabs"><button type="button" class="active" data-auth-tab="login">Log in</button><button type="button" data-auth-tab="signup">Sign up</button></div><div data-notice class="notice" hidden></div><div class="google-signin" data-google-signin hidden></div><p class="google-unavailable" data-google-unavailable hidden>Google sign-in is unavailable here. You can still use email.</p><div class="auth-divider google-divider"><span>or continue with email</span></div><label class="field"><span>Email address</span><input required name="email" type="email" autocomplete="email" placeholder="you@example.com"></label><label class="field"><span>Password</span><span class="password-field"><input required name="password" type="password" autocomplete="current-password" minlength="8" placeholder="Enter your password"><button type="button" class="password-reveal" data-action="toggle-password" aria-label="Show password">Show</button></span></label><label class="field signup-only" hidden><span>Display name</span><input name="nickname" maxlength="80" autocomplete="nickname" placeholder="Enter your display name"></label><div class="auth-options login-only"><label><input type="checkbox" name="remember"> Remember me</label><span><button type="button" class="text-link" data-action="forgot">Forgot password?</button> <button type="button" class="text-link" data-action="resend-verification">Resend verification</button></span></div><button class="btn primary" type="submit">Log in</button><p class="auth-legal">By continuing, you agree to our <a href="/terms">Terms of Service</a> and <a href="/privacy">Privacy Policy</a>.</p></form></section>`);
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
  appShell(`<section class="page-frame account-page"><a class="back-link account-back" href="/">Back to home</a><header class="account-heading"><h1>My Account</h1><p>View your profile and purchase history.</p></header><div data-notice class="notice account-notice" hidden></div><section class="account-profile-card" data-account-summary aria-label="Account profile"><div class="account-profile-loading">Loading your profile…</div></section><section class="account-purchases-card"><header class="account-purchases-header"><h2>Purchases &amp; refunds</h2><a class="account-add-credits" href="/credits">Add Credits</a></header><div class="account-table-wrap"><table class="account-purchase-table"><thead><tr><th>Order number</th><th>Purchase date</th><th>World Credits</th><th>Amount</th><th>Payment status</th><th>Refund status</th><th>Action</th></tr></thead><tbody data-purchase-records><tr><td colspan="7" class="account-table-message">Loading purchase records…</td></tr></tbody></table></div></section><button class="account-logout" type="button" data-action="account-logout"><span aria-hidden="true">↪</span>Log out</button></section>`);
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
  const name = account.nickname || "Many Worlds player";
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
  appShell(`<section class="page-frame admin-refund-frame"><a class="back-link" href="/account">Back to My Account</a><p class="eyebrow">PAYMENT OPERATIONS</p><h1>Refund requests</h1><p class="muted">Approval submits the refund through the configured Creem provider adapter. Credit reversal waits for the signed refund webhook.</p><div data-notice class="notice" hidden></div><div class="refund-filter"><button class="btn small" data-refund-filter="PENDING">Pending</button><button class="btn small" data-refund-filter="">All</button></div><section data-admin-refund-list><p>Loading requests…</p></section></section>`);
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

async function hydrateWorldRegistry(worldId) {
  try {
    const world = await request(`/api/v4/worlds/${encodeURIComponent(worldId)}`);
    const hero = root.querySelector(".world-hero");
    if (!hero || !world?.id) return;
    hero.dataset.worldId = world.id;
    const title = hero.querySelector("h1");
    if (title && world.title) title.textContent = world.title;
    root.querySelectorAll(".role-card strong").forEach((element, index) => {
      if (world.roles?.[index]?.name) element.textContent = world.roles[index].name;
    });
  } catch {
    // A static first render remains usable during a transient catalog outage.
  }
}

function renderWorld() {
  if (path === "/worlds/sangtian") { renderSangtianWorld(); void hydrateWorldRegistry("sangtian"); return; }
  const roleCards = roles.map(([name, copy, portrait]) => `<article class="role-card"><img class="portrait" src="${portrait}" alt="${name}"><div><strong>${name}</strong><p>${copy}</p></div></article>`).join("");
  appShell(`<section class="page-frame"><a class="back-link" href="/">Back to worlds</a><div class="world-hero"><div><div class="eyebrow">Historical · Alternate History</div><h1>Caesar: The Last Spring of the Republic</h1><p class="world-lead">Caesar trusts you. The conspirators need you.<br>Rome will judge whatever survives.</p><p class="world-copy">The Republic teeters on a knife’s edge. Ambition clashes with loyalty, and every choice writes a different history. Navigate alliances, secrets, and betrayal in the final days before everything changes.</p><div class="meta-row"><span class="meta">♧ &nbsp; 1–6 Roles</span><span class="meta">◷ &nbsp; 40–60 Minutes</span><span class="meta">♜ &nbsp; History &amp; Power</span><span class="meta">♙ &nbsp; Private Objectives</span></div></div><div class="world-image" role="img" aria-label="Rome at sunset"></div></div><h2 class="role-title">Role Preview</h2><div class="role-preview">${roleCards}</div><div class="mode-grid"><article class="mode-card"><span class="mode-icon">♙</span><div><h2>Play Solo</h2><p>Choose one role and AI controls the rest of the world.</p></div><button class="btn primary" data-action="solo">Choose a Role</button></article><article class="mode-card"><span class="mode-icon">♧</span><div><h2>Play Multiplayer</h2><p>Join or create a room and each player takes a different role.</p></div><button class="btn primary" data-action="rooms">Find a Room</button></article></div><p class="world-cost">Starts from 20 World Credits</p></section>`, "worlds");
  void hydrateWorldRegistry("caesar");
}
function renderSangtianWorld() {
  const sangtianRoles = [["浙江总督", "Hold the whole province together.", 1], ["浙江巡抚", "Reform cannot outrun the evidence.", 2], ["清流县令", "Protect the people and preserve the records.", 3], ["江南商会", "Grain and silver have their own politics.", 4], ["司礼监织造使", "The court watches every silver road.", 5]];
  const roleCards = sangtianRoles.map(([name, copy, portrait]) => `<article class="role-card"><img class="portrait" src="/assets/portrait/${portrait}.png" alt="${name}"><div><strong>${name}</strong><p>${copy}</p></div></article>`).join("");
  appShell(`<section class="page-frame"><a class="back-link" href="/">Back to worlds</a><div class="world-hero"><div><div class="eyebrow">Historical · Political Strategy</div><h1>嘉靖财政危局</h1><p class="world-lead">银路将断，粮价已起。<br>七日之内，所有人都要为自己的证词负责。</p><p class="world-copy">在嘉靖朝的财政危机中，浙江总督、巡抚与县令必须在改革、民生、证据与朝廷压力之间协作或角力。每一轮行动都会改变其他人的下一次选择。</p><div class="meta-row"><span class="meta">♧ &nbsp; 1–3 Roles</span><span class="meta">◷ &nbsp; 40–60 Minutes</span><span class="meta">♜ &nbsp; History &amp; Power</span><span class="meta">♙ &nbsp; Private Objectives</span></div></div><div class="world-image" role="img" aria-label="Jiajing fiscal crisis"></div></div><h2 class="role-title">Role Preview</h2><div class="role-preview">${roleCards}</div><div class="mode-grid"><article class="mode-card"><span class="mode-icon">♙</span><div><h2>Play Solo</h2><p>Play the existing 嘉靖财政危局 single-player experience.</p></div><button class="btn primary" data-action="sangtian-solo">Choose a Role</button></article><article class="mode-card"><span class="mode-icon">♧</span><div><h2>Play Multiplayer</h2><p>Create a room for three human roles and AI-supported world roles.</p></div><button class="btn primary" data-action="sangtian-rooms">Find a Room</button></article></div><p class="world-cost">Starts from 20 World Credits</p></section>`, "worlds");
}
function roomRow(world, room, players, status, tone, disabled = false) { return `<div class="room-table room-row ${room === "Board Vote" ? "last" : ""}"><div class="world-cell"><img class="thumb" src="/assets/bg/${tone}.png" alt=""><strong>${world}</strong></div><span>${room}</span><span>${players}</span><span class="badge ${status === "Open" ? "" : status === "Waiting" ? "wait" : status === "In Progress" ? "progress" : "full"}">● &nbsp;${status}</span><button class="btn small" ${disabled ? "disabled" : ""} data-action="join-room">${disabled ? "Full" : "Join"}</button></div>`; }
function renderRooms() {
  appShell(`<section class="page-frame"><div class="page-heading"><div><h1>Rooms</h1><p>Join an open room, create your own, or continue a room you already joined.</p></div><div class="action-row"><button class="btn" data-action="join-code">Join with Code</button><button class="btn primary" data-action="create-room">Create Room</button></div></div><div class="tab-strip"><button class="active" data-action="open-tab">Open Rooms</button><button data-action="my-tab">My Rooms</button></div><div data-notice class="notice" hidden></div><div class="rooms-layout"><section><div class="filters"><button class="select-box" type="button">All Worlds</button></div><div class="room-table head"><span>World</span><span>Room</span><span>Players</span><span>Status</span><span>Action</span></div><div data-live-rooms><p class="refresh-note">Loading available rooms…</p></div><p class="refresh-note">Rooms refresh automatically.</p></section><aside class="my-rooms"><h2>My Rooms</h2><p class="refresh-note">Loading your rooms…</p></aside></div></section>`, "rooms");
}
function renderRoom() {
  const playerRows = [["Alex Morgan","Host · Brutus","/assets/portrait/1.png",true],["Jordan Lee","Caesar","/assets/portrait/2.png",true],["Taylor Kim","No role selected","/assets/portrait/7.png",false]];
  const roleTiles = roles.map(([name, copy, portrait], index) => `<button class="select-role ${index === 0 ? "selected" : ""}" data-role="${index}"><img class="portrait" src="${portrait}" alt="${name}"><strong>${name}</strong><p>${copy}</p><span class="role-state ${index === 0 ? "selected" : ""}">${index === 0 ? "✓　Selected by You" : index === 1 ? "Taken" : "Available"}</span></button>`).join("");
  appShell(`<section class="page-frame"><div class="room-top"><div class="room-world"><img src="/assets/bg/1.png" alt="Rome"><div><h1>Caesar: The Last Spring of the Republic</h1><p>Night Council</p></div></div><div class="room-stat">♧　3 / 6 players</div><div class="room-stat purple">◷　Waiting for players</div><div class="invite"><span>Invite friends</span><strong>ROME-4421</strong><button class="btn small" data-action="share-invite">Share &amp; reward</button></div></div><div class="info-bar">ⓘ　 As the room creator, you choose roles first.</div><div data-notice class="notice" hidden></div><div class="room-main"><aside class="player-panel"><h2 class="panel-title">Players (3 / 6)</h2>${playerRows.map(([name, meta, avatar, ready]) => `<div class="player-line"><img class="avatar" src="${avatar}" alt=""><div><strong>${name}</strong><span>${meta}</span></div><span class="ready-badge ${ready ? "" : "off"}">${ready ? "Ready" : "Not Ready"}</span></div>`).join("")}<div class="player-line"><span class="avatar open-seat">♙</span><span>Open Seat</span><span class="ready-badge off">–</span></div><div class="player-line"><span class="avatar open-seat">♙</span><span>Open Seat</span><span class="ready-badge off">–</span></div><div class="player-line"><span class="avatar open-seat">♙</span><span>Open Seat</span><span class="ready-badge off">–</span></div></aside><section class="roles-panel"><h2 class="panel-title">Choose Your Role　 <span class="eyebrow">☆ Creator Advantage</span></h2><div class="role-grid">${roleTiles}</div></section></div><footer class="room-footer"><p>ⓘ　Waiting for all players to be ready. Minimum players: 3.<br>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;AI will fill any unselected roles.</p><button class="btn" data-action="ready">Ready</button><button class="btn primary" data-action="start-game">Start Game</button></footer></section>`, "rooms");
}
function visualIcon(id, label, extra = "") {
  const glyphs = { 4: "▶　", 5: "♧　", 8: "←　", 10: "◎　", 12: "◎", 15: extra === "session-icon" ? "◉　" : "✓", 17: "♙", 25: "♎　", 31: "☆" };
  return glyphs[id] || "";
}
function renderResult() {
  const fixture = params.get("runId") === "fixture-caesar-finished";
  appShell(`<section class="page-frame"><a class="back-link" href="/worlds/caesar">Back to worlds</a><div class="result-run"><img src="/assets/bg/1.png" alt="Rome"><div><h1>Caesar: The Last Spring of the Republic</h1><span class="session-complete">${visualIcon(15, "", "session-icon")}Session Complete</span></div></div><h1 class="result-title">A Republic Without a Master</h1><p class="result-lead">Caesar survived, but accepted limits on his authority.<br>Rome avoided civil war—for now.</p><div class="summary-grid"><article class="summary-card"><span class="mode-icon">${visualIcon(17, "")}</span><div><h2>Your Role</h2><img class="portrait" src="/assets/portrait/1.png" alt="Brutus"><strong>Brutus</strong></div></article><article class="summary-card"><span class="mode-icon">${visualIcon(31, "")}</span><div><h2>Your Ending</h2><strong>The Reluctant Architect</strong><p>You chose restraint over power, building guardrails that may hold—if others keep faith.</p></div></article><article class="summary-card"><span class="mode-icon">${visualIcon(12, "")}</span><div><h2>World State</h2><strong>Fragile Stability</strong><p>Rome stands together, but old rivalries smolder and the future is uncertain.</p></div></article></div><div class="lower-grid"><section class="lower-card"><h2>${visualIcon(25, "", "section-icon")}Key Decisions</h2><div class="decision-item"><span class="number-dot">1</span><span>You opposed the dictatorship and pushed for limits on power.</span></div><div class="decision-item"><span class="number-dot">2</span><span>You brokered a compromise between the Senate and Caesar.</span></div><div class="decision-item"><span class="number-dot">3</span><span>You secured support from key allies to pass reforms.</span></div></section><section class="lower-card"><h2>${visualIcon(10, "", "section-icon")}Goals Completed <span class="badge progress">2 / 3</span></h2><div class="goal-item"><span class="check">${visualIcon(15, "")}</span><span>Prevent Caesar from becoming an unrestrained dictator.</span></div><div class="goal-item"><span class="check">${visualIcon(15, "")}</span><span>Avoid a civil war.</span></div><div class="goal-item"><span class="open-check">◯</span><span>Pass meaningful reforms to strengthen the Republic.</span></div></section></div><div class="result-actions"><button class="btn primary" data-action="play-again">${visualIcon(4, "", "button-icon inverted")}Play Again</button><button class="btn" data-action="other-role">${visualIcon(5, "", "button-icon")}Try Another Role</button><button class="btn" data-action="back-worlds">${visualIcon(8, "", "button-icon")}Back to Worlds</button></div></section>`, "worlds");
  root.querySelector(".result-actions")?.insertAdjacentHTML("afterend", `<button class="result-share-recap" data-action="share-recap" ${fixture ? "" : "disabled"}>${fixture ? "Share Recap" : "Loading recap…"}</button>`);
  bind();
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
    shell.querySelector(".back-link").href = result.room.worldId === "sangtian" ? "/worlds/sangtian" : "/worlds/caesar";
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
  ctx.fillStyle = "#fff"; ctx.font = "600 56px Arial"; ctx.fillText("Many Worlds", 80, 120); ctx.font = "700 72px Arial"; wrapPosterText(ctx, title, 80, 300, 900, 88);
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
      const title = root.querySelector(".result-title")?.textContent?.trim() || "A Many Worlds story recap";
      const poster = await buildResultPoster(title, share.qrDataUrl);
      const output = dialog.querySelector("[data-result-share-output]"); form.hidden = true; output.hidden = false;
      output.innerHTML = `<div class="secure-share-status"><strong>Secure link ready</strong><span>Expires ${esc(new Date(share.expiresAt).toLocaleString())}</span></div><label class="share-link-label"><span>↗</span><input readonly value="${esc(share.url)}"><button type="button" data-copy-result>Copy link</button></label><div class="share-network-row result-network-row"><button data-result-channel="WHATSAPP"><b>◉</b>WhatsApp</button><button data-result-channel="TELEGRAM"><b>➤</b>Telegram</button><button data-result-channel="FACEBOOK"><b>f</b>Facebook</button><button data-result-channel="X"><b>𝕏</b>X</button><button data-result-native><b>↗</b>Share</button></div><div class="result-poster"><img src="${poster}" alt="Result share poster"><button class="btn" type="button" data-download-result>Download poster</button></div><button class="btn danger revoke-share" type="button" data-revoke-result>Revoke this link</button>`;
      const copy = async () => { try { await navigator.clipboard.writeText(share.url); notice("Secure result link copied."); } catch { const input = output.querySelector("input"); input.focus(); input.select(); notice("Copy was blocked. The link is selected."); } };
      output.querySelector("[data-copy-result]").addEventListener("click", copy);
      output.querySelectorAll("[data-result-channel]").forEach((channelButton) => channelButton.addEventListener("click", () => { const channel = channelButton.dataset.resultChannel; const url = encodeURIComponent(share.url); const text = encodeURIComponent(`Read my Many Worlds recap: ${title}`); const links = { WHATSAPP:`https://wa.me/?text=${text}%20${url}`, TELEGRAM:`https://t.me/share/url?url=${url}&text=${text}`, FACEBOOK:`https://www.facebook.com/sharer/sharer.php?u=${url}`, X:`https://x.com/intent/post?text=${text}%20${url}` }; window.open(links[channel], "_blank", "noopener,noreferrer"); }));
      output.querySelector("[data-result-native]").addEventListener("click", async () => { if (navigator.share) { try { await navigator.share({ title, text:"A Many Worlds story recap", url:share.url }); } catch {} } else await copy(); });
      output.querySelector("[data-download-result]").addEventListener("click", () => { const link = document.createElement("a"); link.download = `many-worlds-result-${runId.slice(-8)}.png`; link.href = poster; link.click(); });
      output.querySelector("[data-revoke-result]").addEventListener("click", async (clickEvent) => { if (!confirm("Revoke this public link now? Anyone using it will immediately lose access.")) return; clickEvent.currentTarget.disabled = true; try { await request(`/api/v4/rooms/${encodeURIComponent(runId)}/result/shares/${encodeURIComponent(share.id)}`, { method:"DELETE" }); notice("Result link revoked."); dialog.close(); } catch (error) { clickEvent.currentTarget.disabled = false; notice(error.message || "Unable to revoke this link."); } });
    } catch (error) { button.disabled = false; notice(error.message || "Unable to create a secure result link."); }
  });
}

function renderSharedResult() {
  const token = String(params.get("token") || "").trim();
  appShell(`<section class="page-frame public-result-frame"><div class="public-result-brand"><img src="/assets/brand/many-worlds-logo.png" alt=""><strong>Many Worlds</strong></div><div data-public-result><p class="muted">Loading the shared recap…</p></div></section>`);
  if (!token) { root.querySelector("[data-public-result]").innerHTML = '<div class="public-result-error"><h1>Link not found</h1><p>This result link is incomplete.</p><a class="btn primary" href="/">Explore Many Worlds</a></div>'; return; }
  void request(`/api/v4/public/results/${encodeURIComponent(token)}`).then((result) => {
    const highlights = Array.isArray(result.recap?.highlights) ? result.recap.highlights : [];
    root.querySelector("[data-public-result]").innerHTML = `<p class="eyebrow">SHARED STORY RECAP</p><h1>${esc(result.recap?.title || result.room?.title || "A completed story")}</h1><p class="public-result-meta">${esc(result.room?.title || "Many Worlds")} · ${esc(String(result.room?.completedNodes || 7))} rounds completed</p>${result.recap?.roleName ? `<p class="public-role">Shared from the perspective of <strong>${esc(result.recap.roleName)}</strong></p>` : ""}<section class="public-highlights"><h2>Turning points</h2>${highlights.length ? highlights.map((item, index) => `<article><span>${index + 1}</span><p>${esc(item)}</p></article>`).join("") : '<p>This public recap contains no private story details.</p>'}</section><aside class="privacy-note"><strong>Privacy protected</strong><p>Player identities, private goals, hidden intent, clues, raw actions and reasoning traces were removed from this public view.</p><small>This link expires ${esc(new Date(result.share.expiresAt).toLocaleString())}.</small></aside><a class="btn primary public-result-cta" href="/">Create your own world</a>`;
  }).catch((error) => { root.querySelector("[data-public-result]").innerHTML = `<div class="public-result-error"><h1>This link is unavailable</h1><p>${esc(error.message || "It may have expired or been revoked.")}</p><a class="btn primary" href="/">Explore Many Worlds</a></div>`; });
}
async function openInviteShareLegacy() {
  if (!activeRoom || !requireSession()) return;
  try {
    const referral = await request("/api/v4/referrals/me");
    const inviteUrl = `${location.origin}/join?room=${encodeURIComponent(activeRoom.code)}&ref=${encodeURIComponent(referral.code)}&channel=LINK`;
    const shareText = `Join my Many Worlds room: ${activeRoom.title}. Complete the opening together and we can earn ${referral.rewardPerQualifiedInvite} bonus credits.`;
    const dialog = document.createElement("dialog");
    dialog.className = "share-dialog";
    dialog.innerHTML = `<button class="dialog-close" data-close-share aria-label="Close">×</button><p class="eyebrow">INVITE FRIENDS</p><h2>Share a room, earn together.</h2><p class="muted">When a new friend joins and completes the opening, you earn <strong>${referral.rewardPerQualifiedInvite} Bonus Credits</strong>. ${referral.remainingRewardSlots} reward slot${referral.remainingRewardSlots === 1 ? "" : "s"} remaining. Sharing alone never grants credits.</p><label class="share-link-label">Your room link<input readonly value="${esc(inviteUrl)}"></label><div class="share-network-row"><button data-share-channel="WHATSAPP">WhatsApp</button><button data-share-channel="TELEGRAM">Telegram</button><button data-share-channel="DISCORD">Discord</button><button data-share-channel="FACEBOOK">Facebook</button><button data-share-channel="X">X</button><button data-copy-invite>Copy link</button></div><section class="poster-preview"><img data-poster-qr alt="Invitation QR code"><div><span>Many Worlds</span><strong>${esc(activeRoom.title)}</strong><small>Scan or open the invitation to join this shared story.</small></div><button class="btn" data-download-poster>Download invitation poster</button></section>`;
    document.body.append(dialog); dialog.showModal();
    const close = () => { dialog.close(); dialog.remove(); };
    dialog.querySelector("[data-close-share]").addEventListener("click", close);
    const qr = await fetchInviteQr(activeRoom.code);
    dialog.querySelector("[data-poster-qr]").src = qr.objectUrl;
    dialog.querySelector("[data-copy-invite]").addEventListener("click", async () => { await navigator.clipboard.writeText(inviteUrl); notice("Invite link copied. Share it with a friend to start their journey."); });
    dialog.querySelectorAll("[data-share-channel]").forEach((button) => button.addEventListener("click", async () => {
      const channel = button.dataset.shareChannel;
      await request("/api/v4/referrals/share-events", { method:"POST", body:JSON.stringify({ channel, runId:activeRoom.id }) });
      const channelUrl = `${location.origin}/join?room=${encodeURIComponent(activeRoom.code)}&ref=${encodeURIComponent(referral.code)}&channel=${encodeURIComponent(channel)}`; const encodedUrl = encodeURIComponent(channelUrl); const encodedText = encodeURIComponent(shareText);
      const links = { WHATSAPP:`https://wa.me/?text=${encodedText}%20${encodedUrl}`, TELEGRAM:`https://t.me/share/url?url=${encodedUrl}&text=${encodedText}`, DISCORD:"https://discord.com/channels/@me", FACEBOOK:`https://www.facebook.com/sharer/sharer.php?u=${encodedUrl}`, X:`https://x.com/intent/post?text=${encodedText}%20${encodedUrl}` };
      window.open(links[channel] || inviteUrl, "_blank", "noopener,noreferrer");
    }));
    dialog.querySelector("[data-download-poster]").addEventListener("click", async () => { try { await downloadInvitePoster({ title:activeRoom.title, inviteUrl, code:activeRoom.code, qr }); } catch (error) { notice(error.message || "Unable to create the invitation poster. Please try again."); } });
    dialog.addEventListener("close", () => URL.revokeObjectURL(qr.objectUrl), { once:true });
  } catch (error) { notice(error.message || "Unable to prepare the invitation link."); }
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
  ctx.fillStyle = "#fff"; ctx.font = "600 64px Arial"; ctx.fillText("Many Worlds", 90, 150); ctx.font = "700 78px Arial"; wrapPosterText(ctx, title, 90, 340, 900, 94); ctx.font = "400 36px Arial"; ctx.fillStyle = "#e9ddff"; ctx.fillText("Join my shared story", 90, 610); ctx.fillStyle = "#fff"; ctx.font = "600 42px Arial"; ctx.fillText(`Room code: ${code}`, 90, 710);
  const size = 360, left = 630, top = 850; ctx.fillStyle = "#fff"; ctx.fillRect(left - 24, top - 24, size + 48, size + 48); ctx.drawImage(qr.image, left, top, size, size);
  ctx.fillStyle = "#e9ddff"; ctx.font = "400 28px Arial"; ctx.fillText("Open the invitation link to join", 90, 1210); const link = document.createElement("a"); link.download = `many-worlds-${code}-invite.png`; link.href = canvas.toDataURL("image/png"); link.click();
}
function wrapPosterText(ctx, text, x, y, maxWidth, lineHeight) { const words = String(text).split(/\s+/); let line = "", offset = 0; words.forEach((word) => { const next = `${line}${line ? " " : ""}${word}`; if (ctx.measureText(next).width > maxWidth && line) { ctx.fillText(line, x, y + offset); line = word; offset += lineHeight; } else line = next; }); if (line) ctx.fillText(line, x, y + offset); }
async function buildInvitePoster({ title, code, qr }) {
  const canvas = document.createElement("canvas"); canvas.width = 1080; canvas.height = 1350;
  await document.fonts?.ready; const ctx = canvas.getContext("2d"); const background = new Image(); background.src = "/assets/poster/invite-background.png";
  await new Promise((resolve, reject) => { background.onload = resolve; background.onerror = () => reject(new Error("Invitation poster background could not be loaded")); });
  ctx.drawImage(background, 0, 0, canvas.width, canvas.height); const gradient = ctx.createLinearGradient(0, 0, 1080, 1350); gradient.addColorStop(0, "rgba(83,56,174,.20)"); gradient.addColorStop(1, "rgba(207,190,255,.14)"); ctx.fillStyle = gradient; ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#fff"; ctx.font = "600 64px Arial"; ctx.fillText("Many Worlds", 90, 150); ctx.font = "700 70px Arial"; wrapPosterText(ctx, title, 90, 350, 900, 84); ctx.font = "400 36px Arial"; ctx.fillStyle = "#e9ddff"; ctx.fillText("Play AI-powered story worlds on the web", 90, 620); ctx.fillStyle = "#fff"; ctx.font = "600 42px Arial"; ctx.fillText("Join a shared room with friends", 90, 706);
  const size = 360, left = 630, top = 850; ctx.fillStyle = "#fff"; ctx.fillRect(left - 24, top - 24, size + 48, size + 48); ctx.drawImage(qr.image, left, top, size, size); ctx.fillStyle = "#e9ddff"; ctx.font = "400 28px Arial"; ctx.fillText(`Room code: ${code}`, 90, 1200); ctx.fillText("Scan to join the story", 90, 1248);
  return await new Promise((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(URL.createObjectURL(blob)) : reject(new Error("Invitation poster could not be encoded")), "image/png"));
}
async function copyInviteLink(dialog, inviteUrl) { try { await navigator.clipboard.writeText(inviteUrl); notice("Invite link copied. Sharing alone does not grant credits."); } catch { const field = dialog.querySelector(".share-link-label input"); field.focus(); field.select(); notice("Copy was blocked. The invitation link is selected so you can copy it manually."); } }
async function openInviteShare() {
  if (!activeRoom || !requireSession()) return;
  try {
    const opener = document.activeElement; const referral = await request("/api/v4/referrals/me");
    const inviteUrl = `${location.origin}/join?room=${encodeURIComponent(activeRoom.code)}&ref=${encodeURIComponent(referral.code)}&channel=LINK`;
    const shareText = `Join my Many Worlds room: ${activeRoom.title}. Complete the opening together and we can earn ${referral.rewardPerQualifiedInvite} bonus credits.`;
    const rewarded = Math.max(0, Number(referral.maxRewardedInvites || 2) - Number(referral.remainingRewardSlots || 0));
    const dialog = document.createElement("dialog"); dialog.className = "share-dialog";
    dialog.innerHTML = `<button class="dialog-close" data-close-share aria-label="Close">×</button><section class="share-room-head"><img src="/assets/bg/1.png" alt=""><div><h2>Shared Story Room</h2><p>${esc(activeRoom.title)}</p><span>◷ Waiting　♧ ${activeRoom.players?.length || 1} / ${activeRoom.maxPlayers || 3} players</span></div></section><section class="share-reward-card"><p>Invite friends & earn rewards</p><strong>Earn up to ${referral.maxRewardedInvites * referral.rewardPerQualifiedInvite} Bonus Credits</strong><span>Get ${referral.rewardPerQualifiedInvite} Bonus Credits for each new friend who joins and completes the opening.</span><div class="reward-progress"><i style="width:${(rewarded / referral.maxRewardedInvites) * 100}%"></i></div><small>${rewarded} of ${referral.maxRewardedInvites} rewards unlocked · Sharing alone does not grant Credits.</small></section><div class="share-modal-grid"><section class="share-channels"><h3>Share your invitation</h3><p>Invite friends to join your shared room on Many Worlds.</p><div class="share-network-row"><button data-share-channel="WHATSAPP"><b>◉</b>WhatsApp</button><button data-share-channel="TELEGRAM"><b>➤</b>Telegram</button><button data-share-channel="DISCORD"><b>♣</b>Discord</button><button data-share-channel="FACEBOOK"><b>f</b>Facebook</button><button data-share-channel="X"><b>𝕏</b>X</button><button data-copy-invite><b>▣</b>Copy link</button></div><button class="btn primary share-native" data-native-share>↗　Share invitation</button></section><section class="poster-preview"><h3>Invite poster</h3><img data-poster-preview alt="Invitation poster preview"><button class="btn" data-download-poster>⇩　Download poster</button><small>Perfect for group chats and social posts.</small></section></div><label class="share-link-label"><span>↗</span><input readonly value="${esc(inviteUrl)}"><button data-copy-invite>Copy link</button></label>`;
    document.body.append(dialog); dialog.showModal(); dialog.querySelector("[data-close-share]").addEventListener("click", () => dialog.close());
    const qr = await fetchInviteQr(activeRoom.code); const posterUrl = await buildInvitePoster({ title:activeRoom.title, code:activeRoom.code, qr }); dialog.querySelector("[data-poster-preview]").src = posterUrl;
    dialog.querySelectorAll("[data-copy-invite]").forEach((button) => button.addEventListener("click", () => copyInviteLink(dialog, inviteUrl)));
    dialog.querySelectorAll("[data-share-channel]").forEach((button) => button.addEventListener("click", async () => { const channel = button.dataset.shareChannel; await request("/api/v4/referrals/share-events", { method:"POST", body:JSON.stringify({ channel, runId:activeRoom.id }) }); const channelUrl = `${location.origin}/join?room=${encodeURIComponent(activeRoom.code)}&ref=${encodeURIComponent(referral.code)}&channel=${encodeURIComponent(channel)}`; const encodedUrl = encodeURIComponent(channelUrl); const encodedText = encodeURIComponent(shareText); const links = { WHATSAPP:`https://wa.me/?text=${encodedText}%20${encodedUrl}`, TELEGRAM:`https://t.me/share/url?url=${encodedUrl}&text=${encodedText}`, DISCORD:"https://discord.com/channels/@me", FACEBOOK:`https://www.facebook.com/sharer/sharer.php?u=${encodedUrl}`, X:`https://x.com/intent/post?text=${encodedText}%20${encodedUrl}` }; if (!window.open(links[channel] || inviteUrl, "_blank", "noopener,noreferrer")) await copyInviteLink(dialog, inviteUrl); }));
    dialog.querySelector("[data-native-share]").addEventListener("click", async () => { await request("/api/v4/referrals/share-events", { method:"POST", body:JSON.stringify({ channel:"NATIVE", runId:activeRoom.id }) }); if (navigator.share) { try { await navigator.share({ title:"Many Worlds", text:shareText, url:inviteUrl }); } catch {} } else await copyInviteLink(dialog, inviteUrl); });
    dialog.querySelector("[data-download-poster]").addEventListener("click", () => { const link = document.createElement("a"); link.download = `many-worlds-${activeRoom.code}-invite.png`; link.href = posterUrl; link.click(); });
    dialog.addEventListener("close", () => { URL.revokeObjectURL(qr.objectUrl); URL.revokeObjectURL(posterUrl); dialog.remove(); opener?.focus?.(); }, { once:true });
  } catch (error) { notice(error.message || "Unable to prepare the invitation link."); }
}
function sessionToken() { return hasSessionCookie() ? "cookie-session" : ""; }
function requireSession() { if (sessionToken()) return true; location.assign(`/auth?returnTo=${encodeURIComponent(path + location.search)}`); return false; }
async function request(url, options = {}) { const response = await fetch(apiUrl(url), { ...options, credentials: "include", headers: { "content-type":"application/json", ...(options.headers || {}) } }); const data = await response.json().catch(() => ({})); if (response.status === 401) clearSessionHint(); if (!response.ok) { const error = new Error(data.message || data.code || `Request failed: ${response.status}`); error.code = data.code || null; error.status = response.status; throw error; } return data; }
function roomRows(rooms) { return rooms.map((room, index) => `<div class="room-table room-row"><div class="world-cell"><img class="thumb" src="/assets/bg/${(index % 5) + 1}.png" alt=""><strong>${esc(room.worldId === "sangtian" ? "嘉靖财政危局" : "Caesar")}</strong></div><span>${esc(room.title)}</span><span>${room.players.length} of ${room.maxPlayers}</span><span class="badge">Open</span><button class="btn small" data-open-room="${esc(room.id)}" data-join-code="${esc(room.code || "")}">Join</button></div>`).join("") || `<p class="refresh-note">No open rooms yet. Create the first room.</p>`; }
function myRoomRows(rooms) { return rooms.map((room, index) => { const action = room.nextAction === "continue" ? "Continue" : room.nextAction === "view_result" ? "View Result" : "Open"; return `<div class="my-room"><img src="/assets/bg/${(index % 5) + 1}.png" alt=""><div><strong>${esc(room.title)}</strong><span>${esc(room.worldId === "sangtian" ? "嘉靖财政危局" : "Caesar")}</span></div><button class="btn small" data-my-room="${esc(room.id)}" data-next-action="${esc(room.nextAction || "open")}">${action}</button></div>`; }).join("") || `<p class="refresh-note">No rooms yet.</p>`; }
function bindRoomActions() { root.querySelectorAll("[data-open-room]").forEach((button) => button.addEventListener("click", async () => { try { if (button.dataset.joinCode) await request("/api/v4/rooms/join-by-code", { method:"POST", body:JSON.stringify({ code: button.dataset.joinCode }) }); location.assign(`/rooms/${button.dataset.openRoom}`); } catch (error) { notice(error.message || "Unable to join this room."); } })); root.querySelectorAll("[data-my-room]").forEach((button) => button.addEventListener("click", () => { const id = button.dataset.myRoom; const action = button.dataset.nextAction; location.assign(action === "continue" ? `/room-game?runId=${encodeURIComponent(id)}` : action === "view_result" ? `/game/result?runId=${encodeURIComponent(id)}` : `/rooms/${encodeURIComponent(id)}`); })); }
async function hydrateRooms() { try { const data = await request(`/api/v4/rooms${params.get("worldId") ? `?worldId=${encodeURIComponent(params.get("worldId"))}` : ""}`); const heading = root.querySelector(".room-table.head"); if (!heading) return; root.querySelectorAll(".room-row").forEach((node) => node.remove()); root.querySelectorAll("[data-live-rooms]").forEach((node) => node.remove()); heading.insertAdjacentHTML("afterend", `<div data-live-rooms>${roomRows(data.rooms || [])}</div>`); const mine = root.querySelector(".my-rooms"); if (mine) mine.innerHTML = `<h2>My Rooms</h2>${myRoomRows(data.myRooms || [])}`; bindRoomActions(); } catch (error) { notice(error.message || "Unable to load rooms."); } }
function roomWorldTitle(worldId) { return worldId === "sangtian" ? "嘉靖财政危局" : "Caesar: The Last Spring of the Republic"; }
function roomDisplayTitle(room) {
  const title = String(room.title || "").trim();
  const prefixes = room.worldId === "sangtian" ? ["桑田诏：嘉靖财政危局", "嘉靖财政危局"] : [roomWorldTitle(room.worldId)];
  for (const prefix of prefixes) {
    for (const separator of ["：", ": "]) {
      const fullPrefix = `${prefix}${separator}`;
      if (title.startsWith(fullPrefix)) return title.slice(fullPrefix.length).trim();
    }
  }
  return title;
}
async function hydrateRoom(roomId) { try { const room = await request(`/api/v4/rooms/${encodeURIComponent(roomId)}`); activeRoom = room; const heading = root.querySelector(".room-world h1"); if (heading) heading.textContent = roomWorldTitle(room.worldId); const subtitle = root.querySelector(".room-world p"); if (subtitle) subtitle.textContent = roomDisplayTitle(room); const code = root.querySelector(".invite strong"); if (code) code.textContent = room.code; const playerCount = root.querySelector(".room-stat"); if (playerCount) playerCount.textContent = `${room.players.length} / ${room.maxPlayers} players`; const panelTitle = root.querySelector(".player-panel .panel-title"); if (panelTitle) panelTitle.textContent = `Players (${room.players.length} / ${room.maxPlayers})`; const panel = root.querySelector(".player-panel"); if (panel) panel.innerHTML = `<h2 class="panel-title">Players (${room.players.length} / ${room.maxPlayers})</h2>${room.players.map((player, index) => `<div class="player-line"><img class="avatar" src="/assets/portrait/${(index % 7) + 1}.png" alt=""><div><strong>${esc(player.nickname)}</strong><span>${esc(player.roleName || "No role selected")}</span></div><span class="ready-badge ${player.ready ? "" : "off"}">${player.ready ? "Ready" : "Not Ready"}</span></div>`).join("")}`; const grid = root.querySelector(".role-grid"); if (grid) { grid.innerHTML = room.roles.map((role, index) => { const mine = role.claimedByCurrentUser; const available = room.status === "waiting_players" && (role.status === "available" || mine); return `<button class="select-role ${mine ? "selected" : ""}" data-action="select-role" data-role-id="${esc(role.id)}" ${available ? "" : "disabled"}><img class="portrait" src="/assets/portrait/${(index % 7) + 1}.png" alt="${esc(role.roleName)}"><strong>${esc(role.roleName)}</strong><p>${esc(role.publicInfo || role.identity || "A role in this world.")}</p><span class="role-state ${mine ? "selected" : ""}">${mine ? "Selected by You" : available ? "Available" : "Taken"}</span></button>`; }).join(""); } const footer = root.querySelector(".room-footer"); if (footer) { if (room.status === "playing") footer.innerHTML = `<p>The host has started the shared session. Your role is ready for the next decision.</p><a class="btn primary" href="/room-game?runId=${encodeURIComponent(room.id)}">Continue Game</a>`; else if (room.status === "chapter_generated") footer.innerHTML = `<p>All seven rounds are complete. The shared result is ready.</p><a class="btn primary" href="/game/result?runId=${encodeURIComponent(room.id)}">View Result</a>`; else { const currentRole = room.roles.find((role) => role.claimedByCurrentUser); const currentPlayer = room.players.find((player) => player.roleId && player.roleId === currentRole?.id); const currentPlayerReady = Boolean(currentPlayer?.ready); const enoughPlayers = room.players.length >= room.minPlayers; const allPlayersReady = enoughPlayers && room.players.every((player) => player.ready); const readyDisabled = !currentPlayer?.roleId || currentPlayerReady; const footerMessage = allPlayersReady ? "All players are ready. The host can start the game." : currentPlayerReady ? "You are ready. Waiting for the other players." : "Confirm that you are ready when your role is selected."; footer.innerHTML = `<p>${footerMessage}<br>Minimum players: ${room.minPlayers}. AI will fill any unselected roles.</p><button class="btn" data-action="ready" ${readyDisabled ? "disabled" : ""}>${currentPlayerReady ? "Ready ✓" : "Ready"}</button>${room.isHost ? `<button class="btn primary" data-action="start-game" ${allPlayersReady ? "" : "disabled"}>Start Game</button>` : ""}`; } } bind(); } catch (error) { notice(error.message || "Unable to load this room."); } }
const actions = {
  "toggle-password": (_event, element) => { const input = root.querySelector('input[name="password"]'); if (!input) return; const reveal = input.type === "password"; input.type = reveal ? "text" : "password"; element.textContent = reveal ? "Hide" : "Show"; element.setAttribute("aria-label", reveal ? "Hide password" : "Show password"); },
  forgot: async () => { const email = root.querySelector('input[name="email"]')?.value?.trim(); if (!email) return notice("Enter your verified email address first."); try { await request("/api/v4/auth/password-reset/request", { method:"POST", body:JSON.stringify({ email }) }); notice("If this verified account exists, a password-reset email has been sent."); } catch (error) { notice(error.message || "Unable to request a password reset."); } },
  "resend-verification": async () => { const email = root.querySelector('input[name="email"]')?.value?.trim(); if (!email) return notice("Enter the email address that needs verification first."); try { await request("/api/v4/auth/verification/resend", { method:"POST", body:JSON.stringify({ email, returnTo: safeReturnTo(params.get("returnTo")) }) }); notice("If this account still needs verification, a new email has been sent."); } catch (error) { notice(error.message || "Unable to resend the verification email."); } },
  "edit-profile": () => openProfileEditor(),
  "retry-purchases": () => { void hydratePurchases(); },
  "view-refund": (_event, element) => openPurchaseStatus(element.dataset.purchaseId),
  "view-dispute": (_event, element) => openPurchaseStatus(element.dataset.purchaseId, true),
  "account-logout": async (_event, element) => { if (element?.disabled) return; element.disabled = true; try { await request("/api/v4/auth/logout", { method:"POST", body:"{}" }); try { globalThis.google?.accounts?.id?.disableAutoSelect?.(); } catch {} clearSessionHint(); location.assign("/"); } catch (error) { element.disabled = false; notice(error.message || "Unable to log out."); } },
  solo: () => location.assign("/role-select?story=caesar"), rooms: () => location.assign("/rooms?worldId=caesar"),
  "sangtian-solo": () => location.assign("/role-select?story=sangtian"), "sangtian-rooms": () => location.assign("/rooms?worldId=sangtian"),
  "join-code": async () => { if (!requireSession()) return; const code = prompt("Enter an invite code"); if (!code) return; try { const room = await request("/api/v4/rooms/join-by-code", { method:"POST", body:JSON.stringify({ code: code.trim().toUpperCase() }) }); location.assign(`/rooms/${room.id}`); } catch (error) { notice(error.message || "Unable to join this room."); } },
  "create-room": async (_event, element) => { if (!requireSession()) return; const previousLabel = element?.textContent; if (element) { element.disabled = true; element.textContent = "Creating room…"; } notice("Creating a durable room…"); try { const room = await request("/api/v4/rooms", { method:"POST", body:JSON.stringify({ worldId: params.get("worldId") || "caesar" }) }); location.assign(`/rooms/${room.id}`); } catch (error) { if (element) { element.disabled = false; element.textContent = previousLabel || "＋  Create Room"; } notice(error.message || "Unable to create a room."); } }, "join-room": () => location.assign("/rooms/fixture-caesar-waiting"),
  "share-invite": () => { void openInviteShare(); },
  "select-role": async (_event, element) => { if (!activeRoom || !requireSession()) return; try { await request(`/api/v4/rooms/${activeRoom.id}/role`, { method:"POST", body:JSON.stringify({ roleId: element.dataset.roleId }) }); if (activeRoom.isHost && !activeRoom.hostRoleLocked) await request(`/api/v4/rooms/${activeRoom.id}/role/lock`, { method:"POST", body:"{}" }); await hydrateRoom(activeRoom.id); } catch (error) { notice(error.message || "Unable to select that role."); } },
  ready: async () => { if (!activeRoom || !requireSession()) return; try { await request(`/api/v4/rooms/${activeRoom.id}/ready`, { method:"POST", body:JSON.stringify({ ready:true }) }); await hydrateRoom(activeRoom.id); } catch (error) { notice(error.message || "Unable to mark ready."); } }, "start-game": async () => { if (!activeRoom || !requireSession()) return; try { const started = await request(`/api/v4/rooms/${activeRoom.id}/start`, { method:"POST", body:"{}" }); location.assign(`/room-game?runId=${encodeURIComponent(started.id)}`); } catch (error) { notice(error.message || "Room is not ready to start."); } },
  "request-refund": (_event, element) => openRefundRequest(element.dataset.purchaseId),
  "play-again": () => location.assign("/role-select?story=caesar"), "other-role": () => location.assign("/role-select?story=caesar"), "back-worlds": () => location.assign("/worlds/caesar"), "share-recap": () => { void openResultShare(); }, "open-tab": () => {}, "my-tab": () => root.querySelector(".my-rooms")?.scrollIntoView({ behavior: "smooth", block: "start" })
};
async function initializePlatform() {
  await migrateLegacySession();
  if (path === "/auth") renderAuth(); else if (path === "/account") renderAccount(); else if (path === "/admin/refunds") renderAdminRefunds(); else if (path === "/shared/result") renderSharedResult(); else if (path === "/join") renderJoin(); else if (path.startsWith("/worlds/")) renderWorld(); else if (path === "/rooms") renderRooms(); else if (path.startsWith("/rooms/")) renderRoom(); else if (path === "/game/result") renderResult(); else location.assign("/");
}
void initializePlatform();
