const SCHEMA = "endgame_presentation_v3";
const RESULT_TYPES = new Set(["SOLO_PART_END", "SOLO_STORY_END", "LEGACY_ENDING"]);
const DIRECTIONS = new Set(["HIGH_GOOD", "LOW_GOOD", "CONTEXTUAL"]);
const LAYOUTS = new Set(["LIST", "TWO_COLUMN", "TIMELINE", "CARDS"]);
const REPLAY_TYPES = new Set(["RESTART_SAME_STORY", "CHANGE_ROLE", "CONTINUE_NEXT_PART", "BACK_TO_WORLDS"]);

export function normalizeEndgamePresentationV3(value) {
  if (!record(value) || value.schemaVersion !== SCHEMA || !RESULT_TYPES.has(value.resultType)) return null;
  const world = identity(value.world, "worldId", "worldTitle");
  const role = identity(value.role, "roleId", "roleTitle");
  const axes = array(value.axes).map(normalizeAxis);
  const metrics = array(value.metrics).map(normalizeMetric);
  const sections = array(value.sections).map(normalizeSection);
  const replayActions = array(value.replayActions).map(normalizeReplayAction);
  const style = value.style === null ? null : normalizeStyle(value.style);
  if (!world || !role || axes.some((item) => !item) || metrics.some((item) => !item)
    || sections.some((item) => !item) || replayActions.some((item) => !item)
    || (value.style !== null && !style) || !text(value.title) || typeof value.dynamicSubtitle !== "string"
    || typeof value.narrative !== "string" || typeof value.replayHint !== "string"
    || !/^[0-9a-f]{64}$/u.test(String(value.endingFingerprint || ""))) return null;
  return {
    schemaVersion: SCHEMA,
    resultType: value.resultType,
    world,
    role,
    title: value.title.trim(),
    axes: axes.filter(Boolean),
    metrics: metrics.filter(Boolean),
    dynamicSubtitle: value.dynamicSubtitle,
    style,
    narrative: value.narrative,
    sections: sections.filter(Boolean),
    replayHint: value.replayHint,
    endingFingerprint: value.endingFingerprint,
    replayActions: replayActions.filter(Boolean)
  };
}

export function adaptEndgamePresentationV3ForGame(presentation) {
  const firstAxis = presentation.axes[0];
  return {
    schemaVersion: SCHEMA,
    resultType: presentation.resultType,
    globalEnding: { title: presentation.title, narrative: presentation.dynamicSubtitle || firstAxis?.summary || "" },
    personalEnding: {
      rank: presentation.style?.label || presentation.role.roleTitle,
      title: firstAxis?.title || presentation.title,
      narrative: presentation.narrative || presentation.dynamicSubtitle,
      futureAftermath: ""
    },
    causalExplanation: { keyMovesThatSavedYou: [], keyMovesThatHurtYou: [], fateDebts: [] }
  };
}

export function renderEndgamePresentationV3Html(presentation) {
  const metricHtml = presentation.metrics.length ? `<section class="endgame-v3-metrics" data-testid="ending-metrics">${presentation.metrics.map((metric) => `<article><span>${esc(metric.label)}</span><b>${esc(metric.formattedValue)}</b>${metric.initialValue === null ? "" : `<small>初始 ${esc(metric.initialValue)}</small>`}</article>`).join("")}</section>` : "";
  const axesHtml = `<section class="endgame-v3-axes" data-testid="ending-axes">${presentation.axes.map((axis) => `<article><small>${esc(axis.label)}</small><h3>${esc(axis.title)}</h3><p>${esc(axis.summary)}</p></article>`).join("")}</section>`;
  const sectionsHtml = presentation.sections.map((section) => `<section class="endgame-v3-section layout-${section.layout.toLowerCase()}" data-section-id="${esc(section.sectionId)}"><h3>${esc(section.label)}</h3>${section.layout === "TIMELINE" ? `<ol>${section.items.map(renderItem).join("")}</ol>` : `<ul>${section.items.map(renderItem).join("")}</ul>`}</section>`).join("");
  const actionsHtml = `<div class="actions endgame-v3-actions" data-testid="ending-replay-actions">${presentation.replayActions.map((action) => action.enabled && action.href
    ? `<a href="${esc(action.href)}" data-replay-action="${esc(action.type)}">${esc(action.label)}</a>`
    : `<button type="button" disabled data-replay-action="${esc(action.type)}" title="${esc(action.disabledReason || "当前不可用")}">${esc(action.label)}</button>`).join("")}</div>`;
  return `<div data-endgame-v3="details"><p class="final-kicker">${presentation.resultType === "SOLO_STORY_END" ? "故事终章" : "本部分终章"}</p><h2>${esc(presentation.title)}</h2>${presentation.dynamicSubtitle ? `<p class="final-global">${esc(presentation.dynamicSubtitle)}</p>` : ""}${axesHtml}${metricHtml}<div class="endgame-v3-narrative" data-testid="ending-narrative">${paragraphs(presentation.narrative)}</div>${sectionsHtml}${presentation.replayHint ? `<p class="fate-debt" data-testid="ending-replay-hint"><b>下一局可以尝试：</b>${esc(presentation.replayHint)}</p>` : ""}${actionsHtml}</div>`;
}

export function enhanceEndgameResultPage(documentRef, presentation) {
  const final = documentRef?.querySelector?.('[data-testid="final-judgement"]');
  if (!final || !presentation) return false;
  final.dataset.endgameSchema = SCHEMA;
  final.innerHTML = renderEndgamePresentationV3Html(presentation);
  return true;
}

function normalizeAxis(value) { return record(value) && [value.axisId, value.label, value.outcomeId, value.title, value.summary].every(text) ? { axisId:value.axisId, label:value.label, outcomeId:value.outcomeId, title:value.title, summary:value.summary } : null; }
function normalizeMetric(value) { return record(value) && [value.metricId, value.label, value.formattedValue].every(text) && finite(value.value) && DIRECTIONS.has(value.direction) && (value.initialValue === null || finite(value.initialValue)) ? { metricId:value.metricId, label:value.label, value:value.value, formattedValue:value.formattedValue, direction:value.direction, initialValue:value.initialValue } : null; }
function normalizeStyle(value) { return record(value) && text(value.styleId) && text(value.label) ? { styleId:value.styleId, label:value.label } : null; }
function normalizeSection(value) { if (!record(value) || !text(value.sectionId) || !text(value.label) || !LAYOUTS.has(value.layout)) return null; const items = array(value.items).map(normalizeItem); return items.some((item) => !item) ? null : { sectionId:value.sectionId, label:value.label, layout:value.layout, items:items.filter(Boolean) }; }
function normalizeItem(value) { return record(value) && text(value.title) && text(value.text) && (value.actorName === null || text(value.actorName)) && (value.stageIndex === null || (Number.isInteger(value.stageIndex) && value.stageIndex >= 0)) ? { title:value.title, text:value.text, actorName:value.actorName, stageIndex:value.stageIndex } : null; }
function normalizeReplayAction(value) { if (!record(value) || !REPLAY_TYPES.has(value.type) || !text(value.label) || typeof value.enabled !== "boolean") return null; const href = value.href === null ? null : safeHref(value.href); if (value.enabled && href === null) return null; return { type:value.type, label:value.label, href, enabled:value.enabled, disabledReason:value.disabledReason === null ? null : (text(value.disabledReason) ? value.disabledReason : null) }; }
function identity(value, idKey, titleKey) { return record(value) && text(value[idKey]) && text(value[titleKey]) ? { [idKey]:value[idKey], [titleKey]:value[titleKey] } : null; }
function safeHref(value) { const href = text(value) ? value.trim() : ""; if (!href.startsWith("/") || href.startsWith("//") || href.includes("\\") || /[\u0000-\u001f\u007f]/u.test(href)) return null; try { const url = new URL(href, "https://our-many-worlds.invalid"); return url.origin === "https://our-many-worlds.invalid" ? `${url.pathname}${url.search}${url.hash}` : null; } catch { return null; } }
function renderItem(item) { return `<li>${item.stageIndex === null ? "" : `<small>第 ${item.stageIndex} 回合</small>`}<b>${esc(item.title)}</b><p>${esc(item.text)}</p>${item.actorName ? `<em>${esc(item.actorName)}</em>` : ""}</li>`; }
function paragraphs(value) { return String(value || "").split(/\n{2,}/u).filter(Boolean).map((part) => `<p>${esc(part).replace(/\n/gu, "<br>")}</p>`).join(""); }
function esc(value) { return String(value ?? "").replace(/[&<>"']/gu, (char) => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" })[char]); }
function record(value) { return Boolean(value) && typeof value === "object" && !Array.isArray(value); }
function array(value) { return Array.isArray(value) ? value : []; }
function text(value) { return typeof value === "string" && value.trim().length > 0; }
function finite(value) { return typeof value === "number" && Number.isFinite(value); }
