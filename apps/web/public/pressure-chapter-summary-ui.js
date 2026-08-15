export function pressureChapterSummaryFromView(view) {
  const summary = view?.pressureProjection?.chapterSummary ?? view?.chapterSummary ?? null;
  if (!summary || typeof summary !== "object") return null;
  return summary;
}

export function shouldShowPressureChapterSummary(view) {
  return pressureChapterSummaryFromView(view)?.confirmationState === "AWAITING_CONFIRMATION";
}

export function renderPressureChapterSummary(view, { busy = false } = {}) {
  const summary = pressureChapterSummaryFromView(view);
  if (!summary) return "";
  const list = (title, items) => Array.isArray(items) && items.length
    ? `<section class="chapter-summary-section"><h3>${escapeHtml(title)}</h3><ul>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul></section>`
    : "";
  const metrics = Array.isArray(summary.metricChanges) && summary.metricChanges.length
    ? `<section class="chapter-summary-section"><h3>数值变化</h3><div class="chapter-summary-metrics">${summary.metricChanges.map((metric) => `<div class="chapter-summary-metric"><span>${escapeHtml(metric.label)}</span><b>${escapeHtml(metric.displayBefore)} → ${escapeHtml(metric.displayAfter)}</b><em>${escapeHtml(metric.displayDelta)}</em></div>`).join("")}</div></section>`
    : "";
  const confirmed = summary.confirmationState === "CONFIRMED";
  return `<section class="result-narrative chapter-summary-narrative" data-testid="pressure-chapter-summary">
    <div class="result-copy">
      <span class="chapter-summary-kicker">${escapeHtml(summary.chapterId)} · 章末总结</span>
      <h1>${escapeHtml(summary.title)}</h1>
      <p>${lineBreaks(summary.closingNarrative)}</p>
      ${list("你的行动", summary.playerActions)}
      ${list("实际结果", summary.actualResults)}
      ${list("已完成目标", summary.completedObjectives)}
      ${list("未完成目标", summary.incompleteObjectives)}
      ${metrics}
      ${list("仍在逼近的压力", summary.remainingPressures)}
      <section class="chapter-summary-hook"><h3>下一章</h3><p>${lineBreaks(summary.nextChapterHook)}</p></section>
    </div>
    <div class="result-continue"><button id="confirmChapterSummaryBtn" type="button" ${busy || confirmed ? "disabled" : ""}>${confirmed ? "下一章已开启" : busy ? "正在进入下一章……" : "进入下一章"}</button></div>
  </section>`;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[character]));
}

function lineBreaks(value) {
  return escapeHtml(value).replace(/\n/g, "<br>");
}
