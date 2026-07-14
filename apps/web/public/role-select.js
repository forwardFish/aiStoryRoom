import { storyRunStorageKey } from "./api-story-storage.js";

export function createRoleSelectApp({ root, window: browserWindow = globalThis.window, fetchImpl = browserWindow?.fetch?.bind(browserWindow) } = {}) {
  if (!root) throw new TypeError("createRoleSelectApp requires a root element");
  if (typeof fetchImpl !== "function") throw new TypeError("createRoleSelectApp requires fetch");

  const params = new URLSearchParams(browserWindow?.location?.search || "");
  const storyId = params.get("story") || "sangtian";
  const state = { loading: true, busy: false, error: "", story: null, selectedRoleKey: "" };

  async function boot() {
    state.loading = true;
    state.error = "";
    render();
    try {
      const response = await fetchImpl(`${apiBase(browserWindow?.location)}/v4/stories/${encodeURIComponent(storyId)}`, { headers: { accept: "application/json" } });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.id || !Array.isArray(payload.roles)) {
        throw new Error(payload?.message || `剧本读取失败（HTTP ${response.status}）`);
      }
      state.story = payload;
      state.selectedRoleKey = payload.roles.find((role) => role.playable)?.key || payload.roles[0]?.key || "";
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
    if (!role?.playable || state.busy) return;
    state.busy = true;
    state.error = "";
    render();
    try {
      const isPlatformSolo = state.story.id === "caesar";
      const response = await fetchImpl(isPlatformSolo ? `${apiBase(browserWindow?.location)}/v4/rooms/solo` : `${apiBase(browserWindow?.location)}/v4/stories/${encodeURIComponent(state.story.id)}/runs`, {
        method: "POST",
        headers: { accept: "application/json", "content-type": "application/json", ...(isPlatformSolo && sessionToken(browserWindow) ? { authorization: `Bearer ${sessionToken(browserWindow)}` } : {}) },
        body: JSON.stringify(isPlatformSolo ? { worldId: state.story.id, roleKey: role.key } : { storyId: state.story.id, roleKey: role.key, mode: "single" })
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !(isPlatformSolo ? payload?.id : payload?.run?.id)) throw new Error(payload?.message || `创建故事局失败（HTTP ${response.status}）`);
      const runId = isPlatformSolo ? payload?.id : payload?.run?.id;
      if (!runId) throw new Error("Story run was not created");
      browserWindow.localStorage?.setItem(storyRunStorageKey, runId);
      const override = apiOverride(browserWindow?.location);
      browserWindow.location.href = isPlatformSolo ? `/room-game?runId=${encodeURIComponent(runId)}` : `/game?runId=${encodeURIComponent(runId)}${override ? `&apiBase=${encodeURIComponent(override)}` : ""}`;
    } catch (error) {
      state.error = error instanceof Error ? error.message : String(error);
      state.busy = false;
      render();
    }
  }

  function render() {
    if (state.loading) {
      root.innerHTML = `<section class="role-loading"><div class="seal-mark">局</div><p>正在展开角色名册……</p></section>`;
      return;
    }
    if (!state.story) {
      root.innerHTML = `<section class="role-loading role-error"><div class="seal-mark">局</div><h1>角色名册暂不可用</h1><p>${escapeHtml(state.error || "请确认 API 服务已经启动。")}</p><button id="retryRole">重新连接</button><a href="/">返回大厅</a></section>`;
      root.querySelector("#retryRole")?.addEventListener("click", boot);
      return;
    }

    const story = state.story;
    const role = selectedRole(state);
    root.innerHTML = `
      <div class="role-shell">
        ${renderHeader()}
        ${renderSteps()}
        ${renderStoryBanner(story)}
        <section class="role-content">
          <div class="role-heading"><span></span><h2>请选择你的角色</h2><span></span></div>
          <div class="role-layout">
            <div class="role-card-grid">${story.roles.map((item) => renderRoleCard(item, item.key === state.selectedRoleKey)).join("")}</div>
            ${renderSelectionPanel(role)}
          </div>
          <div class="role-actions">
            <a class="back-button" href="/">返回上一页</a>
            <button id="enterRole" class="enter-button" type="button" ${!role?.playable || state.busy ? "disabled" : ""}>${state.busy ? "正在创建故事局……" : role?.playable ? "确认角色并进入" : "该角色将在多人版开放"}</button>
          </div>
          ${state.error ? `<div class="role-alert" role="alert">${escapeHtml(state.error)}</div>` : ""}
        </section>
      </div>`;
    root.querySelectorAll("[data-role-key]").forEach((button) => button.addEventListener("click", () => selectRole(button.dataset.roleKey)));
    root.querySelector("#enterRole")?.addEventListener("click", createRun);
  }

  return { boot, render, createRun, selectRole, getState: () => state };
}

function renderHeader() {
  return `<header class="role-header">
    <a class="role-brand" href="/"><img src="/assets/brand/many-worlds-logo.png" alt="Many Worlds logo"/><strong>Many Worlds</strong></a>
    <div class="role-header-actions"><a href="#help">${helpIcon()} 帮助</a><button type="button" aria-label="用户菜单">${userIcon()} ${chevronDownIcon()}</button></div>
  </header>`;
}

function renderSteps() {
  return `<nav class="role-steps" aria-label="创建故事局步骤">
    <div><span>1</span><b>剧本简介</b></div><i></i>
    <div class="active"><span>2</span><b>选择角色</b></div><i></i>
    <div><span>3</span><b>开始游戏</b></div>
  </nav>`;
}

function renderStoryBanner(story) {
  return `<section class="story-banner ${artClass(story.heroCover)}">
    <div class="story-banner-copy"><span class="story-seal">诏</span><h1>${escapeHtml(story.title)}</h1><p>${escapeHtml(story.description)}</p></div>
    <div class="story-meta">
      <span>${calendarIcon()} ${escapeHtml(story.totalDays)}天</span>
      <span>${usersIcon()} ${escapeHtml(story.modeLabel)}</span>
      <span>${clockIcon()} ${escapeHtml(story.durationLabel)}</span>
    </div>
  </section>`;
}

function renderRoleCard(role, selected) {
  return `<button type="button" class="role-card ${selected ? "selected" : ""} ${role.playable ? "playable" : "preview"}" data-role-key="${escapeAttr(role.key)}" aria-pressed="${selected}">
    ${selected ? `<span class="selected-ribbon">✓ 已选择</span>` : ""}
    ${!role.playable ? `<span class="preview-ribbon">多人版</span>` : ""}
    <div class="role-art ${artClass(role.portrait)}" role="img" aria-label="${escapeAttr(role.name)}"></div>
    <div class="role-card-name"><strong>${escapeHtml(role.name)}</strong><span>${roleIcon(role.key)} ${escapeHtml(role.tagline)}</span></div>
  </button>`;
}

function renderSelectionPanel(role) {
  if (!role) return `<aside class="selection-panel"><p>请选择一个角色。</p></aside>`;
  return `<aside class="selection-panel">
    <div class="panel-title"><span></span><b>当前选择</b><span></span></div>
    <div class="selected-portrait ${artClass(role.portrait)}" role="img" aria-label="${escapeAttr(role.name)}"></div>
    <div class="selected-name">${escapeHtml(role.name)}</div>
    <p>${escapeHtml(role.identity)}</p>
    <div class="trait-grid">${(role.traits || []).slice(0, 3).map((trait) => `<span>${traitIcon(trait.icon)}<b>${escapeHtml(trait.label)}</b></span>`).join("")}</div>
    <dl><div><dt>公开目标</dt><dd>${escapeHtml(role.publicGoal)}</dd></div><div><dt>命运问题</dt><dd>${escapeHtml(role.fateQuestion)}</dd></div></dl>
  </aside>`;
}

function artClass(path) {
  const key = String(path || "").split("/").pop().replace(/\.[^.]+$/, "");
  return `art-${key.replace(/[^a-zA-Z0-9_-]/g, "")}`;
}

function selectedRole(state) {
  return state.story?.roles?.find((role) => role.key === state.selectedRoleKey) || null;
}

function sessionToken(browserWindow) {
  return browserWindow?.localStorage?.getItem("many-worlds-token") || "";
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

function roleIcon(roleKey) {
  if (roleKey === "zhejiang_governor") return compassIcon();
  if (roleKey === "xunfu") return medalIcon();
  if (roleKey === "county_magistrate") return ledgerIcon();
  if (roleKey === "merchant") return coinsIcon();
  return eyeIcon();
}
function traitIcon(name) {
  return ({ strategy: compassIcon, power: crownIcon, risk: shieldIcon, reputation: medalIcon, evidence: ledgerIcon, wealth: coinsIcon, insight: eyeIcon }[name] || shieldIcon)();
}
function icon(path){return `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">${path}</svg>`;}
function helpIcon(){return icon('<circle cx="12" cy="12" r="9"/><path d="M9.8 9a2.4 2.4 0 1 1 3.9 1.9c-1 .7-1.7 1.1-1.7 2.6M12 17h.01"/>');}
function userIcon(){return icon('<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>');}
function chevronDownIcon(){return icon('<path d="m6 9 6 6 6-6"/>');}
function calendarIcon(){return icon('<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01"/>');}
function usersIcon(){return icon('<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8"/>');}
function clockIcon(){return icon('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>');}
function compassIcon(){return icon('<circle cx="12" cy="12" r="9"/><path d="m15 9-2 4-4 2 2-4 4-2Z"/>');}
function crownIcon(){return icon('<path d="m4 8 4 3 4-6 4 6 4-3-2 10H6L4 8Z"/>');}
function shieldIcon(){return icon('<path d="M12 3 4 6v5c0 5 3.4 8.5 8 10 4.6-1.5 8-5 8-10V6l-8-3Z"/>');}
function medalIcon(){return icon('<circle cx="12" cy="9" r="5"/><path d="m8.5 13-1.5 8 5-3 5 3-1.5-8"/>');}
function ledgerIcon(){return icon('<path d="M6 3h12v18H6zM9 7h6M9 11h6M9 15h4"/>');}
function coinsIcon(){return icon('<ellipse cx="12" cy="6" rx="7" ry="3"/><path d="M5 6v5c0 1.7 3.1 3 7 3s7-1.3 7-3V6M5 11v5c0 1.7 3.1 3 7 3s7-1.3 7-3v-5"/>');}
function eyeIcon(){return icon('<path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>');}

function escapeHtml(value) { return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\"/g, "&quot;").replace(/'/g, "&#039;"); }
function escapeAttr(value) { return escapeHtml(value); }

if (typeof window !== "undefined" && typeof document !== "undefined" && !window.__AI_STORY_DISABLE_AUTO_BOOT__) {
  const root = document.getElementById("roleApp");
  if (root) createRoleSelectApp({ root, window }).boot();
}
