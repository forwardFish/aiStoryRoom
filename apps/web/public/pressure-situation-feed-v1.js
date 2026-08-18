const FEED_SCHEMA_V1 = "a_emotion_feed_page_v1";
const FILTERS = Object.freeze(["ALL", "RELATED", "PUBLIC", "SUSPICIOUS"]);
const CATEGORY_LABELS = Object.freeze({
  RELATED: "与你有关",
  PUBLIC: "公开",
  SUSPICIOUS: "可疑",
});

export function createPressureSituationFeedStateV1() {
  return {
    activeTab: "feed",
    expanded: false,
    filter: "ALL",
    selectedEventId: null,
  };
}

export function hasPressureSituationFeedV1(view) {
  const page = view?.pressureProjection?.feedPage;
  return Boolean(
    page
    && page.schemaVersion === FEED_SCHEMA_V1
    && Array.isArray(page.items),
  );
}

export function renderPressureRightRailV1({ view, uiState, maneuverHtml }) {
  if (!hasPressureSituationFeedV1(view)) return maneuverHtml;
  const state = normalizeState(uiState);
  const feedActive = state.activeTab === "feed";
  return `<section class="pressure-right-rail" data-testid="pressure-right-rail">
    <div class="pressure-right-tabs" role="tablist" aria-label="右栏功能">
      <button type="button" role="tab" data-pressure-right-tab="feed" aria-selected="${feedActive}" class="${feedActive ? "active" : ""}"><span aria-hidden="true">▣</span>局势动向</button>
      <button type="button" role="tab" data-pressure-right-tab="maneuver" aria-selected="${!feedActive}" class="${!feedActive ? "active" : ""}"><span aria-hidden="true">⚑</span>谋划中枢</button>
    </div>
    <div class="pressure-right-tab-panel" role="tabpanel">
      ${feedActive ? renderPressureSituationFeedV1(view, state) : maneuverHtml}
    </div>
  </section>`;
}

export function renderPressureSituationFeedV1(view, uiState = createPressureSituationFeedStateV1()) {
  const page = view?.pressureProjection?.feedPage;
  if (!page || page.schemaVersion !== FEED_SCHEMA_V1 || !Array.isArray(page.items)) {
    return emptyFeed("局势动向暂未更新");
  }
  if (page.items.length === 0) return emptyFeed("局势动向暂未更新");
  const state = normalizeState(uiState);
  const filtered = page.items.filter((item) => state.filter === "ALL" || item?.category === state.filter);
  const visible = state.expanded ? filtered : filtered.slice(0, 3);
  const selected = page.items.find((item) => item?.eventId === state.selectedEventId) || null;
  const countLabel = Number(page.unreadCount) > 0 ? `${Number(page.unreadCount)} 条未读` : "暂无未读";

  return `<section class="pressure-situation-feed" data-testid="pressure-situation-feed" aria-label="局势动向">
    <header class="pressure-feed-head">
      <div><b>局势动向 · ${page.items.length}</b><small>${esc(countLabel)}</small></div>
      <label class="pressure-feed-filter"><span aria-hidden="true">▽</span><span class="sr-only">筛选局势动向</span><select data-pressure-feed-filter aria-label="筛选局势动向">${filterOptions(state.filter)}</select></label>
    </header>
    <p class="pressure-feed-guidance">关注世界正在发生的变化</p>
    <div class="pressure-feed-list">
      ${visible.length ? visible.map((item) => feedItem(item, selected?.eventId === item?.eventId)).join("") : '<p class="pressure-feed-empty">当前筛选条件下暂无动态</p>'}
    </div>
    ${selected ? feedDetail(selected) : ""}
    ${filtered.length > 3 ? `<button type="button" class="pressure-feed-expand" data-pressure-feed-expand>${state.expanded ? "收起动态" : "查看全部动态"}<span aria-hidden="true">›</span></button>` : ""}
  </section>`;
}

function feedItem(item, selected) {
  const category = CATEGORY_LABELS[item?.category] || "动态";
  const eventId = esc(item?.eventId || "");
  const unread = item?.isUnread === true;
  return `<button type="button" class="pressure-feed-item category-${String(item?.category || "public").toLowerCase()} ${unread ? "unread" : ""} ${selected ? "selected" : ""}" data-pressure-feed-event="${eventId}" aria-expanded="${selected}">
    <span class="pressure-feed-item-title"><em>【${esc(category)}】</em><strong>${esc(item?.title || "局势出现新的变化")}</strong></span>
    <small>${esc(item?.statusLabel || "状态待确认")} · ${esc(formatFeedTime(item?.occurredAt))}</small>
    <i aria-hidden="true"></i>
  </button>`;
}

function feedDetail(item) {
  const impacts = Array.isArray(item?.visibleImpacts) ? item.visibleImpacts : [];
  return `<section class="pressure-feed-detail" data-testid="pressure-feed-detail">
    <h3>${esc(item?.title || "局势详情")}</h3>
    <p>${esc(item?.safeSummary || "这项变化尚无更多可公开细节。")}</p>
    ${impacts.length ? `<div>${impacts.map((impact) => `<span><b>${esc(impact?.label || "影响")}</b>${esc(impact?.value || "")}</span>`).join("")}</div>` : ""}
  </section>`;
}

function emptyFeed(message) {
  return `<section class="pressure-situation-feed" data-testid="pressure-situation-feed" aria-label="局势动向"><header class="pressure-feed-head"><div><b>局势动向</b></div></header><p class="pressure-feed-empty" role="status">${esc(message)}</p></section>`;
}

function normalizeState(value) {
  return {
    activeTab: value?.activeTab === "maneuver" ? "maneuver" : "feed",
    expanded: value?.expanded === true,
    filter: FILTERS.includes(value?.filter) ? value.filter : "ALL",
    selectedEventId: typeof value?.selectedEventId === "string" ? value.selectedEventId : null,
  };
}

function filterOptions(selected) {
  return [
    ["ALL", "全部"],
    ["RELATED", "与你有关"],
    ["PUBLIC", "公开"],
    ["SUSPICIOUS", "可疑"],
  ].map(([value, label]) => `<option value="${value}" ${selected === value ? "selected" : ""}>${label}</option>`).join("");
}

function formatFeedTime(value) {
  const time = Date.parse(String(value || ""));
  if (!Number.isFinite(time)) return "刚刚";
  const elapsedMinutes = Math.max(0, Math.floor((Date.now() - time) / 60_000));
  if (elapsedMinutes < 1) return "刚刚";
  if (elapsedMinutes < 60) return `${elapsedMinutes} 分钟前`;
  const hours = Math.floor(elapsedMinutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  return `${Math.floor(hours / 24)} 天前`;
}

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[char]);
}
