const CATEGORY_ICONS = {
  全部: gridIcon(),
  权谋历史: crownIcon(),
  都市职场: buildingIcon(),
  悬疑推理: searchIcon(),
  科幻未来: chipIcon(),
  奇幻冒险: compassIcon(),
  情感沉浸: heartIcon(),
  成长励志: briefcaseIcon()
};

export function createLobbyApp({ root, window: browserWindow = globalThis.window, fetchImpl = browserWindow?.fetch?.bind(browserWindow) } = {}) {
  if (!root) throw new TypeError("createLobbyApp requires a root element");
  if (typeof fetchImpl !== "function") throw new TypeError("createLobbyApp requires fetch");

  const state = {
    loading: true,
    error: "",
    catalog: null,
    category: "全部",
    search: ""
  };

  async function boot() {
    state.loading = true;
    state.error = "";
    render();
    try {
      const response = await fetchImpl(`${apiBase(browserWindow?.location)}/v4/stories`, { headers: { accept: "application/json" } });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.featured || !Array.isArray(payload?.sections)) {
        throw new Error(payload?.message || `故事局目录加载失败（HTTP ${response.status}）`);
      }
      state.catalog = payload;
    } catch (error) {
      state.error = error instanceof Error ? error.message : String(error);
    } finally {
      state.loading = false;
      render();
    }
  }

  function setCategory(category) {
    state.category = category;
    render();
  }

  function setSearch(value) {
    state.search = String(value || "").trim();
    const sectionsRoot = root.querySelector("#storySectionsRoot");
    if (sectionsRoot && state.catalog) {
      sectionsRoot.innerHTML = renderSections(state.catalog.sections || [], state.category, state.search);
    }
  }

  function render() {
    if (state.loading) {
      root.innerHTML = `<section class="page-loading"><div class="brand-orbit" aria-hidden="true"><span></span><span></span></div><p>正在打开故事局大厅……</p></section>`;
      return;
    }
    if (!state.catalog) {
      root.innerHTML = `<section class="page-loading page-error"><div class="brand-orbit" aria-hidden="true"><span></span><span></span></div><h1>故事局大厅暂不可用</h1><p>${escapeHtml(state.error || "请确认 API 服务已经启动。")}</p><button id="retryCatalog">重新连接</button></section>`;
      root.querySelector("#retryCatalog")?.addEventListener("click", boot);
      return;
    }

    const catalog = state.catalog;
    root.innerHTML = `
      <div class="lobby-shell">
        ${renderHeader(state)}
        <main class="lobby-main">
          ${renderHero(catalog.featured)}
          <section class="announcement" aria-label="平台公告">
            <span class="announcement-icon">${megaphoneIcon()}</span>
            <b>公告</b>
            <p>${escapeHtml(catalog.announcement || "多人 AI 梦想对话已开启，支持跨时区游玩。")}</p>
            <button type="button" aria-label="查看公告详情">${arrowRightIcon()}</button>
          </section>
          ${renderCategories(catalog.categories || [], state.category)}
          <div id="storySectionsRoot">${renderSections(catalog.sections || [], state.category, state.search)}</div>
        </main>
      </div>`;
    bindEvents();
  }

  function bindEvents() {
    root.querySelectorAll("[data-category]").forEach((button) => {
      button.addEventListener("click", () => setCategory(button.dataset.category));
    });
    const input = root.querySelector("#storySearch");
    input?.addEventListener("input", (event) => setSearch(event.target.value));
    root.querySelectorAll("[data-story-enter]").forEach((button) => {
      button.addEventListener("click", () => enterStory(button.dataset.storyEnter));
    });
    root.querySelectorAll("[data-story-detail]").forEach((button) => {
      button.addEventListener("click", () => enterStory(button.dataset.storyDetail));
    });
  }

  function enterStory(storyId) {
    const id = encodeURIComponent(storyId || "sangtian");
    browserWindow.location.href = `/role-select?story=${id}`;
  }

  return { boot, render, setCategory, setSearch, getState: () => state };
}

function renderHeader(state) {
  return `<header class="lobby-header">
    <a class="lobby-brand" href="/" aria-label="AI 故事局首页">
      <span class="brand-orbit" aria-hidden="true"><span></span><span></span></span>
      <span><strong>故事局</strong><small>AI 多人局</small></span>
    </a>
    <nav aria-label="主导航">
      <a class="active" href="/">首页</a>
      <a href="#storySectionsRoot">分类</a>
      <a href="/role-select?story=sangtian">创建局</a>
      <a href="#storySectionsRoot">剧本库</a>
    </nav>
    <label class="lobby-search">
      <span>${searchIcon()}</span>
      <input id="storySearch" value="${escapeHtml(state.search)}" placeholder="搜索故事局 / 剧本 / 角色" aria-label="搜索故事局" />
      <kbd>⌘ K</kbd>
    </label>
    <div class="header-actions">
      <button class="icon-button" type="button" aria-label="通知">${bellIcon()}<span class="notification-dot">5</span></button>
      <button class="user-button" type="button"><span class="user-avatar">安</span><b>长安客</b>${chevronDownIcon()}</button>
    </div>
  </header>`;
}

function renderHero(featured) {
  return `<section class="hero-carousel" aria-label="推荐故事局">
    <article class="hero-side hero-side-left ${artClass(featured.sideLeft?.cover || '/assets/stories/story-promotion.webp')}">
      <div><strong>${escapeHtml(featured.sideLeft?.title || "晋升名单公布前")}</strong><span>${escapeHtml(featured.sideLeft?.subtitle || "职场权力博弈故事局")}</span></div>
      <button type="button" aria-label="上一个故事">${chevronLeftIcon()}</button>
    </article>
    <article class="hero-main ${artClass(featured.cover)}">
      <div class="hero-copy">
        <span class="hero-eyebrow">本周首发 · AI 动态推演</span>
        <h1>${escapeHtml(featured.displayTitle || featured.title)}</h1>
        <p>${escapeHtml(featured.subtitle)}</p>
        <div class="hero-tags">${(featured.tags || []).map((tag) => `<span>${escapeHtml(tag)}</span>`).join("")}</div>
        <div class="hero-actions">
          <button class="primary-action" type="button" data-story-enter="${escapeAttr(featured.id)}">立即入局 ${arrowRightIcon()}</button>
          <button class="secondary-action" type="button" data-story-detail="${escapeAttr(featured.id)}">查看详情</button>
        </div>
      </div>
      <div class="hero-dots" aria-hidden="true"><i class="active"></i><i></i><i></i><i></i><i></i></div>
    </article>
    <article class="hero-side hero-side-right ${artClass(featured.sideRight?.cover || '/assets/stories/story-starship.webp')}">
      <button type="button" aria-label="下一个故事">${chevronRightIcon()}</button>
      <div><strong>${escapeHtml(featured.sideRight?.title || "末日救援小队")}</strong><span>${escapeHtml(featured.sideRight?.subtitle || "生存协作故事局")}</span></div>
    </article>
  </section>`;
}

function renderCategories(categories, selectedCategory) {
  return `<section class="category-strip" aria-label="故事分类">
    ${categories.map((category) => `<button type="button" class="${category === selectedCategory ? "active" : ""}" data-category="${escapeAttr(category)}">${CATEGORY_ICONS[category] || gridIcon()}<span>${escapeHtml(category)}</span></button>`).join("")}
  </section>`;
}

function renderSections(sections, category, search) {
  const normalizedSearch = search.toLowerCase();
  const html = sections.map((section) => {
    const stories = (section.stories || []).filter((story) => {
      const matchesCategory = category === "全部" || story.category === category;
      const haystack = [story.title, story.subtitle, story.category, ...(story.tags || [])].join(" ").toLowerCase();
      return matchesCategory && (!normalizedSearch || haystack.includes(normalizedSearch));
    });
    if (!stories.length) return "";
    return `<section class="story-section">
      <div class="section-heading"><div><span class="section-icon ${section.tone || "purple"}">${section.icon === "hot" ? flameIcon() : starIcon()}</span><h2>${escapeHtml(section.title)}</h2></div><button type="button">查看全部 ${arrowRightIcon()}</button></div>
      <div class="story-grid">${stories.map(renderStoryCard).join("")}</div>
    </section>`;
  }).join("");
  return html || `<section class="empty-state"><h2>没有找到匹配的故事局</h2><p>换一个分类或关键词再试试。</p></section>`;
}

function renderStoryCard(story) {
  const playable = story.status === "playable";
  return `<article class="story-card ${playable ? 'is-playable' : ''} ${artClass(story.cover)}">
    <div class="story-card-top"><span>${escapeHtml(story.category)}</span>${story.badge ? `<em>${escapeHtml(story.badge)}</em>` : ""}</div>
    <div class="story-card-copy">
      <h3>${escapeHtml(story.title)}</h3>
      <p>${escapeHtml(story.subtitle)}</p>
      <footer><span>${usersIcon()} ${escapeHtml(story.players)}</span><span>${flameIcon()} ${formatHeat(story.heat)}</span></footer>
    </div>
    <button type="button" data-story-enter="${escapeAttr(story.id)}" aria-label="进入${escapeAttr(story.title)}"></button>
  </article>`;
}

function artClass(path) {
  const key = String(path || "").split("/").pop().replace(/\.[^.]+$/, "");
  return `art-${key.replace(/[^a-zA-Z0-9_-]/g, "")}`;
}

function apiBase(location = globalThis.location) {
  if (!location) return "/api";
  if (location.port === "5177") return `${location.protocol}//${location.hostname}:3001/api`;
  return "/api";
}

function formatHeat(value) {
  const number = Number(value);
  return Number.isFinite(number) ? new Intl.NumberFormat("zh-CN").format(number) : "--";
}

function icon(path, viewBox = "0 0 24 24") {
  return `<svg viewBox="${viewBox}" aria-hidden="true" focusable="false">${path}</svg>`;
}
function gridIcon(){return icon('<rect x="4" y="4" width="6" height="6" rx="1"/><rect x="14" y="4" width="6" height="6" rx="1"/><rect x="4" y="14" width="6" height="6" rx="1"/><rect x="14" y="14" width="6" height="6" rx="1"/>');}
function crownIcon(){return icon('<path d="m4 8 4 3 4-6 4 6 4-3-2 10H6L4 8Z"/><path d="M6 21h12"/>');}
function buildingIcon(){return icon('<path d="M4 21V7l8-4 8 4v14"/><path d="M8 10h2m4 0h2M8 14h2m4 0h2M8 18h8"/>');}
function searchIcon(){return icon('<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>');}
function chipIcon(){return icon('<rect x="6" y="6" width="12" height="12" rx="2"/><path d="M9 2v4m6-4v4M9 18v4m6-4v4M2 9h4m-4 6h4m12-6h4m-4 6h4M10 10h4v4h-4z"/>');}
function compassIcon(){return icon('<circle cx="12" cy="12" r="9"/><path d="m15 9-2 4-4 2 2-4 4-2Z"/>');}
function heartIcon(){return icon('<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z"/>');}
function briefcaseIcon(){return icon('<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M3 12h18M10 12v2h4v-2"/>');}
function bellIcon(){return icon('<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/>');}
function megaphoneIcon(){return icon('<path d="m3 11 14-5v12L3 13v-2Z"/><path d="M11.6 16 13 21H8l-1-6"/>');}
function starIcon(){return icon('<path d="m12 3 2.7 5.5 6.1.9-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1-4.4-4.3 6.1-.9L12 3Z"/>');}
function flameIcon(){return icon('<path d="M12 22c4.4 0 8-3 8-7.5 0-3.2-1.8-6.2-5.1-8.9.1 2.4-1 4.2-2.3 5.2.1-3.7-2.1-6.8-5.1-8.8.2 4.3-3.5 6.5-3.5 11.2C4 18.5 7.6 22 12 22Z"/>');}
function usersIcon(){return icon('<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8"/>');}
function arrowRightIcon(){return icon('<path d="M5 12h14m-6-6 6 6-6 6"/>');}
function chevronLeftIcon(){return icon('<path d="m15 18-6-6 6-6"/>');}
function chevronRightIcon(){return icon('<path d="m9 18 6-6-6-6"/>');}
function chevronDownIcon(){return icon('<path d="m6 9 6 6 6-6"/>');}

function escapeHtml(value) {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\"/g, "&quot;").replace(/'/g, "&#039;");
}
function escapeAttr(value) { return escapeHtml(value); }

if (typeof window !== "undefined" && typeof document !== "undefined" && !window.__AI_STORY_DISABLE_AUTO_BOOT__) {
  const root = document.getElementById("homeApp");
  if (root) createLobbyApp({ root, window }).boot();
}
