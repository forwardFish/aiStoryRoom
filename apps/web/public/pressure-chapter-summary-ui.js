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
  const confirmed = summary.confirmationState === "CONFIRMED";
  return `<section class="result-narrative chapter-summary-narrative" data-testid="pressure-chapter-summary">
    <div class="result-copy">
      <span class="chapter-summary-kicker">${escapeHtml(summary.chapterId)} · 章末总结</span>
      <h1>${escapeHtml(summary.title)}</h1>
      <p class="chapter-summary-literary-copy">${lineBreaks(summary.closingNarrative)}</p>
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
