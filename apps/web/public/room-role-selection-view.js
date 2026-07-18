/**
 * Stateless room role-selection markup shared by solo and multiplayer rooms.
 * Event binding deliberately lives in the callers so this module remains safe
 * to render on the server, in tests, and during client-side state updates.
 */

export function roomRoleArtwork(_worldId, _roleKey, fallbackIndex = 0) {
  return `/assets/portrait/${(safeIndex(fallbackIndex) % 7) + 1}.png`;
}

export function renderRoomSelectionPage(model = {}) {
  const mode = model.mode === "multiplayer" ? "multiplayer" : "solo";
  const roles = Array.isArray(model.roles) ? model.roles : [];
  const selected = roles.find((role) => role?.selected || role?.key === model.selectedRole) || null;
  const isDisabled = (role) => Boolean(role?.disabled || model.loading || model.busy);
  const title = model.title || (mode === "solo" ? "Choose your role" : "Choose a role for this room");
  const bannerArtwork = model.bannerArtwork || "";

  return `<div class="mw-room-page" data-room-mode="${mode}">
    <a class="mw-room-brand" href="/worlds"><strong>Our Many Worlds</strong><small>Real players. Living worlds.</small></a>
    <a class="mw-room-back" href="${escapeAttr(model.backHref || "/worlds")}">← ${escapeHtml(model.backLabel || "Back to worlds")}</a>
    <header class="mw-room-header">
      <div class="mw-room-title-block room-world">${bannerArtwork ? `<img class="mw-room-banner" src="${escapeAttr(bannerArtwork)}" alt="" loading="eager" decoding="sync" fetchpriority="high">` : ""}<div><h1>${escapeHtml(title)}</h1><p class="mw-room-session">${escapeHtml(model.sessionLabel || (mode === "solo" ? "Play Solo" : "Shared room"))}</p></div></div>
      ${mode === "multiplayer" ? renderInviteCard(model) : renderSoloCard(model)}
    </header>
    <section class="mw-room-info" role="status"><span>${escapeHtml(model.statusLabel || defaultStatus(mode, model))}</span>${model.infoText ? `<p>${escapeHtml(model.infoText)}</p>` : ""}</section>
    <main class="mw-room-body">
      ${mode === "multiplayer" ? renderRoster(model) : ""}
      <section class="mw-room-role-layout" aria-label="Role selection">
        <div class="mw-room-role-grid">${roles.map((role, index) => renderRoleCard(role, model, index, isDisabled(role))).join("") || `<p class="mw-room-empty">No roles are available.</p>`}</div>
        ${renderChoiceAside(selected, model)}
      </section>
    </main>
    ${renderFooter(mode, model, selected)}
  </div>`;
}

function renderInviteCard(model) {
  const code = model.inviteCode || "—";
  return `<aside class="mw-room-invite-card"><span>Invite code</span><strong>${escapeHtml(code)}</strong><button class="mw-room-button mw-room-button-secondary mw-room-button-compact" type="button" data-action="share-invite" ${disabled(model.loading || model.busy)}>${controlIcon("share")}<span>Share invite</span></button></aside>`;
}

function renderSoloCard(model) {
  return `<aside class="mw-room-solo-card">
    <span class="mw-room-mode-emblem" aria-hidden="true">${controlIcon("solo")}</span>
    <span class="mw-room-mode-kicker">One player chronicle</span>
    <strong>Solo Mode</strong>
    <p>${escapeHtml(model.modeDescription || "Choose one role. AI will take the remaining roles and drive the world around your decisions.")}</p>
    <span class="mw-room-mode-ornament" aria-hidden="true"><i></i><b>◆</b><i></i></span>
  </aside>`;
}

function renderRoster(model) {
  const players = Array.isArray(model.players) ? model.players : [];
  return `<section class="mw-room-roster"><div><h2>Players</h2><span>${escapeHtml(model.playerCountLabel || `${players.length} player${players.length === 1 ? "" : "s"}`)}</span></div><ul>${players.map((player, index) => `<li class="${player?.ready ? "is-ready" : ""}">${player?.artwork ? `<img src="${escapeAttr(player.artwork)}" alt="">` : `<span class="mw-room-open-seat" aria-hidden="true">${index + 1}</span>`}<span><b>${escapeHtml(player?.name || player?.displayName || "Player")}</b><small>${escapeHtml(player?.statusLabel || (player?.ready ? "Ready" : "Choosing"))}</small></span><em>${player?.ready ? "Ready" : "Not Ready"}</em></li>`).join("") || "<li><span>Waiting for players</span></li>"}</ul></section>`;
}

function renderRoleCard(role = {}, model, index, isDisabled) {
  const key = role.key || role.id || `role-${index + 1}`;
  const selected = Boolean(role.selected || key === model.selectedRole);
  const status = role.statusLabel || (role.disabled ? "Taken" : selected ? "Selected" : "Available");
  const artwork = role.artwork || roomRoleArtwork(model.worldId, role.key || role.name, index);
  const classes = ["mw-room-role-card", selected ? "is-selected" : "", role.disabled ? "is-taken" : "", isDisabled ? "is-disabled" : ""].filter(Boolean).join(" ");
  const multiplayerAction = model.mode === "multiplayer" ? ` data-action="select-role" data-role-id="${escapeAttr(role.id || key)}"` : "";
  return `<button type="button" class="${classes}" data-room-role-key="${escapeAttr(key)}"${multiplayerAction} aria-pressed="${selected}" ${disabled(isDisabled)}>
    <img src="${escapeAttr(artwork)}" alt="${escapeAttr(role.name || key)}" loading="eager" decoding="sync" fetchpriority="high">
    <span class="mw-room-role-status">${escapeHtml(status)}</span>
    <strong>${escapeHtml(role.name || key)}</strong>
    ${role.tagline ? `<em>${escapeHtml(role.tagline)}</em>` : ""}
    ${renderTraits(role.traits)}
  </button>`;
}

function renderTraits(traits) {
  if (!Array.isArray(traits) || !traits.length) return "";
  return `<ul class="mw-room-role-traits">${traits.map((trait) => renderTrait(trait)).join("")}</ul>`;
}

function renderTrait(trait) {
  const label = String(typeof trait === "string" ? trait : trait?.label || trait?.name || "");
  const [name, ...detail] = label.split(/\s*·\s*/);
  return `<li><span class="mw-room-trait-glyph" aria-hidden="true"></span><span><b>${escapeHtml(name)}</b>${detail.length ? `<small>${escapeHtml(detail.join(" · "))}</small>` : ""}</span></li>`;
}

function renderChoiceAside(role, model) {
  if (!role) return `<aside class="mw-room-current-choice"><h2>Current choice</h2><p>Select a role to see its details.</p></aside>`;
  const artwork = role.artwork || roomRoleArtwork(model.worldId, role.key || role.name, 0);
  return `<aside class="mw-room-current-choice"><h2>Current choice</h2><img src="${escapeAttr(artwork)}" alt="${escapeAttr(role.name || role.key || "Selected role")}" loading="eager" decoding="sync" fetchpriority="high"><strong>${escapeHtml(role.name || role.key || "Selected role")}</strong>${role.tagline ? `<p>${escapeHtml(role.tagline)}</p>` : ""}${renderTraits(role.traits)}</aside>`;
}

function renderFooter(mode, model, role) {
  if (mode === "solo") {
    const label = model.footerMessage || "You will begin alone. AI will play every remaining role.";
    return `<footer class="mw-room-footer room-footer mw-room-footer-solo"><p>${escapeHtml(label)}</p><a class="mw-room-button mw-room-button-secondary" href="${escapeAttr(model.backHref || "/worlds")}">${controlIcon("back")}<span>Back</span></a><button class="mw-room-button mw-room-button-primary" id="enterRole" type="button" ${disabled(!role || role.disabled || model.loading || model.busy)}>${controlIcon("confirm")}<span>${model.busy ? "Entering…" : escapeHtml(model.confirmLabel || "Confirm Role and Begin")}</span></button></footer>`;
  }
  const readyLabel = model.busy ? "Saving…" : model.readyLabel || "Ready";
  const footerMessage = model.footerMessage || (model.isHost ? "Start when everyone is ready." : "Tell the host when you are ready.");
  return `<footer class="mw-room-footer room-footer mw-room-footer-multiplayer"><p>${escapeHtml(footerMessage)}</p><div><button class="mw-room-button mw-room-button-secondary" type="button" data-action="ready" ${disabled(!model.canReady || model.loading || model.busy)}>${controlIcon("ready")}<span>${escapeHtml(readyLabel)}</span></button>${model.isHost ? `<button class="mw-room-button mw-room-button-primary" type="button" data-action="start-game" ${disabled(!model.canStart || model.loading || model.busy)}>${controlIcon("start")}<span>Start Game</span></button>` : ""}</div></footer>`;
}

const CONTROL_ICON_PATHS = {
  back: '<path d="M20 12H5m6-6-6 6 6 6"/>',
  confirm: '<path d="M7 12.5 10.2 16 17.5 8.5"/><path d="M4.5 8.5c-1 2.3-.8 5 .6 7.1M19.5 8.5c1 2.3.8 5-.6 7.1"/>',
  ready: '<path d="m5 12 4 4L19 6"/>',
  share: '<rect x="8" y="8" width="10" height="11" rx="2"/><path d="M15 8V5a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h2"/>',
  solo: '<path d="M12 5v14"/><path d="M12 8C8.5 5 5.8 5.3 4 7.2c2.1 3 4.8 4 8 3.8M12 12c3.5-3 6.2-2.7 8-0.8-2.1 3-4.8 4-8 3.8"/>',
  start: '<path d="m9 6 9 6-9 6V6Z"/>'
};

function controlIcon(name) {
  return `<svg class="mw-room-control-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${CONTROL_ICON_PATHS[name] || CONTROL_ICON_PATHS.confirm}</svg>`;
}

function safeIndex(value) {
  return Number.isFinite(Number(value)) && Number(value) >= 0 ? Math.floor(Number(value)) : 0;
}

function defaultStatus(mode, model) {
  if (model.loading) return "Loading roles…";
  return mode === "solo" ? "Choose a role to begin." : "Choose a role and get ready.";
}

function disabled(condition) { return condition ? "disabled" : ""; }

function escapeHtml(value) {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

function escapeAttr(value) { return escapeHtml(value); }

globalThis.MANY_WORLDS_ROOM_SELECTION = Object.freeze({
  renderRoomSelectionPage,
  roomRoleArtwork
});
