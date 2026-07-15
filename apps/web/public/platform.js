const root = document.querySelector("#platform-app");
const path = location.pathname.replace(/\/$/, "") || "/";
const params = new URLSearchParams(location.search);
const isLocalRuntime = location.hostname === "localhost" || location.hostname === "127.0.0.1";
const deployedApiBase = "https://appsapi-test.up.railway.app/api";
const platformApiBase = (params.get("apiBase") || (isLocalRuntime ? "/api" : deployedApiBase)).replace(/\/$/, "");
const purple = "#6434d7";
let activeRoom = null;
let roomRefreshTimer = null;
const roles = [
  ["Brutus", "I serve Rome, not any man.", "/assets/portrait/1.png"],
  ["Caesar", "I came, I saw, I changed Rome.", "/assets/portrait/2.png"],
  ["Cassius", "Liberty isn't given. It's taken.", "/assets/portrait/3.png"],
  ["Mark Antony", "I speak for Rome. And I remember.", "/assets/portrait/4.png"],
  ["Decimus", "I watch. I learn. I will decide.", "/assets/portrait/5.png"],
  ["Cicero", "Words are my sharpest weapon.", "/assets/portrait/6.png"]
];

function esc(value) { return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[char]); }
function safeReturnTo(value) {
  if (typeof value !== "string" || value.includes("\\") || value.startsWith("//")) return "/";
  try {
    const url = new URL(value, "https://manyworlds.invalid");
    const allowed = new Set(["/", "/join", "/rooms", "/game", "/game/result", "/credits", "/credits/status", "/credits/cancel", "/credits/failed", "/role-select", "/trio"]);
    if (url.origin !== "https://manyworlds.invalid" || !(allowed.has(url.pathname) || /^\/rooms\/[A-Za-z0-9_-]+$/.test(url.pathname) || /^\/worlds\/[A-Za-z0-9_-]+$/.test(url.pathname))) return "/";
    return `${url.pathname}${url.search}`;
  } catch { return "/"; }
}
function apiUrl(url) { return url.startsWith("/api/") ? `${platformApiBase}${url.slice(4)}` : url; }
function header(active = "") {
  const profile = `<a class="profile-icon" aria-label="Account" href="/auth?returnTo=${encodeURIComponent(path + location.search)}"></a>`;
  const utility = `<div class="header-right"><a href="/#faq">Help</a><span class="divider"></span><span class="language-label" aria-label="Language">English⌄</span>${profile}</div>`;
  if (active === "auth") return `<header class="mw-header"><a class="brand" href="/"><span class="brand-mark">◉</span><span>Many Worlds</span></a>${utility}</header>`;
  return `<header class="mw-header"><a class="brand" href="/"><span class="brand-mark">◉</span><span>Many Worlds</span></a><nav class="mw-nav"><a class="${active === "worlds" ? "active" : ""}" href="/worlds/caesar">Explore Worlds</a><a class="${active === "rooms" ? "active" : ""}" href="/rooms">Rooms</a><a href="/credits">World Credits</a></nav>${utility}</header>`;
}
function appShell(content, active = "") {
  if (roomRefreshTimer) { clearInterval(roomRefreshTimer); roomRefreshTimer = null; }
  root.innerHTML = `${header(active || (path === "/auth" ? "auth" : ""))}${content}`;
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
          localStorage.setItem("many-worlds-token", session.accessToken || session.token);
          location.assign(safeReturnTo(session.returnTo || returnTo));
        } catch (error) {
          notice(error.message || "Google sign-in could not be completed.");
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


function renderAuth() {
  const returnTo = safeReturnTo(params.get("returnTo"));
  const legacyResetToken = String(params.get("token") || "").trim();
  if (params.get("mode") === "reset" && legacyResetToken) {
    location.replace(`/reset-password?token=${encodeURIComponent(legacyResetToken)}`);
    return;
  }
  appShell(`<section class="page-frame auth-frame"><form class="auth-card" data-auth-form novalidate><h1 class="auth-title">Welcome to Many Worlds</h1><p class="auth-subtitle">Log in or create an account to continue.</p><div class="auth-tabs"><button type="button" class="active" data-auth-tab="login">Log in</button><button type="button" data-auth-tab="signup">Sign up</button></div><div data-notice class="notice" hidden></div><div class="google-signin" data-google-signin hidden></div><p class="google-unavailable" data-google-unavailable hidden>Google sign-in is unavailable here. You can still use email.</p><div class="auth-divider google-divider"><span>or continue with email</span></div><label class="field"><span>Email address</span><input required name="email" type="email" autocomplete="email" placeholder="you@example.com"></label><label class="field"><span>Password</span><span class="password-field"><input required name="password" type="password" autocomplete="current-password" minlength="8" placeholder="Enter your password"><button type="button" class="password-reveal" data-action="toggle-password" aria-label="Show password">Show</button></span></label><label class="field signup-only" hidden><span>Display name</span><input name="nickname" maxlength="80" autocomplete="nickname" placeholder="Enter your display name"></label><div class="auth-options login-only"><label><input type="checkbox" name="remember"> Remember me</label><span><button type="button" class="text-link" data-action="forgot">Forgot password?</button> <button type="button" class="text-link" data-action="resend-verification">Resend verification</button></span></div><button class="btn primary" type="submit">Log in</button><p class="auth-legal">By continuing, you agree to our <a href="/terms">Terms of Service</a> and <a href="/privacy">Privacy Policy</a>.</p></form></section>`);
  let mode = "login";
  const form = root.querySelector("[data-auth-form]");
  const applyMode = (next) => { mode = next; root.querySelectorAll("[data-auth-tab]").forEach((tab) => tab.classList.toggle("active", tab.dataset.authTab === next)); root.querySelectorAll(".signup-only").forEach((node) => node.hidden = next !== "signup"); root.querySelectorAll(".login-only").forEach((node) => node.hidden = next !== "login"); form.querySelector("button[type=submit]").textContent = next === "login" ? "Log in" : "Create account"; form.querySelector("input[name=password]").autocomplete = next === "login" ? "current-password" : "new-password"; };
  root.querySelectorAll("[data-auth-tab]").forEach((tab) => tab.addEventListener("click", () => applyMode(tab.dataset.authTab)));
  form.addEventListener("submit", async (event) => { event.preventDefault(); const data = Object.fromEntries(new FormData(form)); const email = String(data.email || "").trim(); const password = String(data.password || ""); if (!email || password.length < 8) return notice("Enter a valid email and a password of at least 8 characters."); try { const endpoint = mode === "login" ? "/api/v4/auth/login" : "/api/v4/auth/register"; const response = await request(endpoint, { method:"POST", body: JSON.stringify(mode === "signup" ? { email, password, nickname: data.nickname, returnTo } : { email, password }) }); if (mode === "signup") { applyMode("login"); form.elements.email.value = email; form.elements.password.value = ""; notice("Account created. Check your email to verify it, then log in."); return; } localStorage.setItem("many-worlds-token", response.accessToken || response.token); location.assign(returnTo); } catch (error) { notice(error.message || "Unable to authenticate. Please try again."); } });
  const resetToken = String(params.get("token") || "").trim();
  if (params.get("mode") === "verify" && resetToken) {
    notice("Verifying your email…");
    void request("/api/v4/auth/verify", { method: "POST", body: JSON.stringify({ token: resetToken }) }).then((session) => {
      localStorage.setItem("many-worlds-token", session.accessToken || session.token);
      location.assign(returnTo);
    }).catch((error) => notice(error.message || "This verification link is invalid or expired."));
  }
  void mountGoogleSignIn(returnTo);
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
  root.querySelector(".result-actions")?.insertAdjacentHTML("afterend", '<button class="result-share-recap" data-action="share-recap">Share Recap</button>');
  bind();
  if (!fixture) hydrateResult(params.get("runId"));
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
  } catch (error) { notice(error.message || "Unable to load this result."); }
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
  const response = await fetch(apiUrl(`/api/v4/referrals/qr?room=${encodeURIComponent(roomCode)}`), { headers: { authorization:`Bearer ${sessionToken()}` } });
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
function sessionToken() { return localStorage.getItem("many-worlds-token") || ""; }
function requireSession() { if (sessionToken()) return true; location.assign(`/auth?returnTo=${encodeURIComponent(path + location.search)}`); return false; }
async function request(url, options = {}) { const authorization = url.startsWith("/api/v4/") && sessionToken() ? { authorization: `Bearer ${sessionToken()}` } : {}; const response = await fetch(apiUrl(url), { ...options, headers: { "content-type":"application/json", ...authorization, ...(options.headers || {}) } }); const data = await response.json().catch(() => ({})); if (!response.ok) throw new Error(data.message || data.code || `Request failed: ${response.status}`); return data; }
function roomRows(rooms) { return rooms.map((room, index) => `<div class="room-table room-row"><div class="world-cell"><img class="thumb" src="/assets/bg/${(index % 5) + 1}.png" alt=""><strong>${esc(room.worldId === "sangtian" ? "嘉靖财政危局" : "Caesar")}</strong></div><span>${esc(room.title)}</span><span>${room.players.length} of ${room.maxPlayers}</span><span class="badge">Open</span><button class="btn small" data-open-room="${esc(room.id)}" data-join-code="${esc(room.code || "")}">Join</button></div>`).join("") || `<p class="refresh-note">No open rooms yet. Create the first room.</p>`; }
function myRoomRows(rooms) { return rooms.map((room, index) => { const action = room.nextAction === "continue" ? "Continue" : room.nextAction === "view_result" ? "View Result" : "Open"; return `<div class="my-room"><img src="/assets/bg/${(index % 5) + 1}.png" alt=""><div><strong>${esc(room.title)}</strong><span>${esc(room.worldId === "sangtian" ? "嘉靖财政危局" : "Caesar")}</span></div><button class="btn small" data-my-room="${esc(room.id)}" data-next-action="${esc(room.nextAction || "open")}">${action}</button></div>`; }).join("") || `<p class="refresh-note">No rooms yet.</p>`; }
function bindRoomActions() { root.querySelectorAll("[data-open-room]").forEach((button) => button.addEventListener("click", async () => { try { if (button.dataset.joinCode) await request("/api/v4/rooms/join-by-code", { method:"POST", body:JSON.stringify({ code: button.dataset.joinCode }) }); location.assign(`/rooms/${button.dataset.openRoom}`); } catch (error) { notice(error.message || "Unable to join this room."); } })); root.querySelectorAll("[data-my-room]").forEach((button) => button.addEventListener("click", () => { const id = button.dataset.myRoom; const action = button.dataset.nextAction; location.assign(action === "continue" ? `/room-game?runId=${encodeURIComponent(id)}` : action === "view_result" ? `/game/result?runId=${encodeURIComponent(id)}` : `/rooms/${encodeURIComponent(id)}`); })); }
async function hydrateRooms() { try { const data = await request(`/api/v4/rooms${params.get("worldId") ? `?worldId=${encodeURIComponent(params.get("worldId"))}` : ""}`); const heading = root.querySelector(".room-table.head"); if (!heading) return; root.querySelectorAll(".room-row").forEach((node) => node.remove()); root.querySelectorAll("[data-live-rooms]").forEach((node) => node.remove()); heading.insertAdjacentHTML("afterend", `<div data-live-rooms>${roomRows(data.rooms || [])}</div>`); const mine = root.querySelector(".my-rooms"); if (mine) mine.innerHTML = `<h2>My Rooms</h2>${myRoomRows(data.myRooms || [])}`; bindRoomActions(); } catch (error) { notice(error.message || "Unable to load rooms."); } }
async function hydrateRoom(roomId) { try { const room = await request(`/api/v4/rooms/${encodeURIComponent(roomId)}`); activeRoom = room; const heading = root.querySelector(".room-world h1"); if (heading) heading.textContent = room.worldId === "sangtian" ? "嘉靖财政危局" : "Caesar: The Last Spring of the Republic"; const subtitle = root.querySelector(".room-world p"); if (subtitle) subtitle.textContent = room.title; const code = root.querySelector(".invite strong"); if (code) code.textContent = room.code; const playerCount = root.querySelector(".room-stat"); if (playerCount) playerCount.textContent = `${room.players.length} / ${room.maxPlayers} players`; const panelTitle = root.querySelector(".player-panel .panel-title"); if (panelTitle) panelTitle.textContent = `Players (${room.players.length} / ${room.maxPlayers})`; const panel = root.querySelector(".player-panel"); if (panel) panel.innerHTML = `<h2 class="panel-title">Players (${room.players.length} / ${room.maxPlayers})</h2>${room.players.map((player, index) => `<div class="player-line"><img class="avatar" src="/assets/portrait/${(index % 7) + 1}.png" alt=""><div><strong>${esc(player.nickname)}</strong><span>${esc(player.roleName || "No role selected")}</span></div><span class="ready-badge ${player.ready ? "" : "off"}">${player.ready ? "Ready" : "Not Ready"}</span></div>`).join("")}`; const grid = root.querySelector(".role-grid"); if (grid) { grid.innerHTML = room.roles.map((role, index) => { const mine = role.claimedByCurrentUser; const available = room.status === "waiting_players" && (role.status === "available" || mine); return `<button class="select-role ${mine ? "selected" : ""}" data-action="select-role" data-role-id="${esc(role.id)}" ${available ? "" : "disabled"}><img class="portrait" src="/assets/portrait/${(index % 7) + 1}.png" alt="${esc(role.roleName)}"><strong>${esc(role.roleName)}</strong><p>${esc(role.publicInfo || role.identity || "A role in this world.")}</p><span class="role-state ${mine ? "selected" : ""}">${mine ? "Selected by You" : available ? "Available" : "Taken"}</span></button>`; }).join(""); } const footer = root.querySelector(".room-footer"); if (footer) { if (room.status === "playing") footer.innerHTML = `<p>The host has started the shared session. Your role is ready for the next decision.</p><a class="btn primary" href="/room-game?runId=${encodeURIComponent(room.id)}">Continue Game</a>`; else if (room.status === "chapter_generated") footer.innerHTML = `<p>All seven rounds are complete. The shared result is ready.</p><a class="btn primary" href="/game/result?runId=${encodeURIComponent(room.id)}">View Result</a>`; else { const message = footer.querySelector("p"); if (message) message.innerHTML = `Waiting for all players to be ready. Minimum players: ${room.minPlayers}.<br>AI will fill any unselected roles.`; } } bind(); } catch (error) { notice(error.message || "Unable to load this room."); } }
const actions = {
  "toggle-password": (_event, element) => { const input = root.querySelector('input[name="password"]'); if (!input) return; const reveal = input.type === "password"; input.type = reveal ? "text" : "password"; element.textContent = reveal ? "Hide" : "Show"; element.setAttribute("aria-label", reveal ? "Hide password" : "Show password"); },
  forgot: async () => { const email = root.querySelector('input[name="email"]')?.value?.trim(); if (!email) return notice("Enter your verified email address first."); try { await request("/api/v4/auth/password-reset/request", { method:"POST", body:JSON.stringify({ email }) }); notice("If this verified account exists, a password-reset email has been sent."); } catch (error) { notice(error.message || "Unable to request a password reset."); } },
  "resend-verification": async () => { const email = root.querySelector('input[name="email"]')?.value?.trim(); if (!email) return notice("Enter the email address that needs verification first."); try { await request("/api/v4/auth/verification/resend", { method:"POST", body:JSON.stringify({ email, returnTo: safeReturnTo(params.get("returnTo")) }) }); notice("If this account still needs verification, a new email has been sent."); } catch (error) { notice(error.message || "Unable to resend the verification email."); } },
  solo: () => location.assign("/role-select?story=caesar"), rooms: () => location.assign("/rooms?worldId=caesar"),
  "sangtian-solo": () => location.assign("/role-select?story=sangtian"), "sangtian-rooms": () => location.assign("/rooms?worldId=sangtian"),
  "join-code": async () => { if (!requireSession()) return; const code = prompt("Enter an invite code"); if (!code) return; try { const room = await request("/api/v4/rooms/join-by-code", { method:"POST", body:JSON.stringify({ code: code.trim().toUpperCase() }) }); location.assign(`/rooms/${room.id}`); } catch (error) { notice(error.message || "Unable to join this room."); } },
  "create-room": async (_event, element) => { if (!requireSession()) return; const previousLabel = element?.textContent; if (element) { element.disabled = true; element.textContent = "Creating room…"; } notice("Creating a durable room…"); try { const room = await request("/api/v4/rooms", { method:"POST", body:JSON.stringify({ worldId: params.get("worldId") || "caesar" }) }); location.assign(`/rooms/${room.id}`); } catch (error) { if (element) { element.disabled = false; element.textContent = previousLabel || "＋  Create Room"; } notice(error.message || "Unable to create a room."); } }, "join-room": () => location.assign("/rooms/fixture-caesar-waiting"),
  "share-invite": () => { void openInviteShare(); },
  "select-role": async (_event, element) => { if (!activeRoom || !requireSession()) return; try { await request(`/api/v4/rooms/${activeRoom.id}/role`, { method:"POST", body:JSON.stringify({ roleId: element.dataset.roleId }) }); if (activeRoom.isHost && !activeRoom.hostRoleLocked) await request(`/api/v4/rooms/${activeRoom.id}/role/lock`, { method:"POST", body:"{}" }); await hydrateRoom(activeRoom.id); } catch (error) { notice(error.message || "Unable to select that role."); } },
  ready: async () => { if (!activeRoom || !requireSession()) return; try { await request(`/api/v4/rooms/${activeRoom.id}/ready`, { method:"POST", body:JSON.stringify({ ready:true }) }); await hydrateRoom(activeRoom.id); } catch (error) { notice(error.message || "Unable to mark ready."); } }, "start-game": async () => { if (!activeRoom || !requireSession()) return; try { const started = await request(`/api/v4/rooms/${activeRoom.id}/start`, { method:"POST", body:"{}" }); location.assign(`/room-game?runId=${encodeURIComponent(started.id)}`); } catch (error) { notice(error.message || "Room is not ready to start."); } },
  "play-again": () => location.assign("/role-select?story=caesar"), "other-role": () => location.assign("/role-select?story=caesar"), "back-worlds": () => location.assign("/worlds/caesar"), "share-recap": () => notice("Sharing recap is coming next."), "open-tab": () => {}, "my-tab": () => root.querySelector(".my-rooms")?.scrollIntoView({ behavior: "smooth", block: "start" })
};
if (path === "/auth") renderAuth(); else if (path === "/join") renderJoin(); else if (path.startsWith("/worlds/")) renderWorld(); else if (path === "/rooms") renderRooms(); else if (path.startsWith("/rooms/")) renderRoom(); else if (path === "/game/result") renderResult(); else location.assign("/");
