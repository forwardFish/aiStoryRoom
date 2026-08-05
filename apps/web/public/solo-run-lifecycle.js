export function soloWorldId(view) {
  const candidates = [
    view?.run?.storyId,
    view?.run?.templateKey,
    view?.room?.worldId,
    view?.presentation?.storyId,
  ];
  return candidates.map((value) => String(value || "").trim()).find(Boolean) || "";
}

export function playAgainUrl(view) {
  const worldId = soloWorldId(view);
  return worldId
    ? `/role-select?story=${encodeURIComponent(worldId)}&start=new`
    : "/worlds";
}

export function navigateToFreshSoloRun({ browserWindow, view } = {}) {
  if (!browserWindow?.location?.assign) return false;
  browserWindow.location.assign(playAgainUrl(view));
  return true;
}

export function renderPlayAgainDialog() {
  return `<div class="play-again-backdrop" data-play-again-backdrop>
    <section class="play-again-dialog" role="dialog" aria-modal="true" aria-labelledby="play-again-title" aria-describedby="play-again-description" tabindex="-1">
      <div class="play-again-mark" aria-hidden="true">↻</div>
      <p class="play-again-eyebrow">新开故事线</p>
      <h2 id="play-again-title">再来一局</h2>
      <p id="play-again-description">从开场重新进入同一段故事，当前进度仍会保留。</p>
      <div class="play-again-summary" aria-label="再来一局说明">
        <div class="play-again-summary-item">
          <span class="play-again-summary-label">当前这一局</span>
          <strong>保留原进度</strong>
        </div>
        <div class="play-again-summary-item">
          <span class="play-again-summary-label">确认之后</span>
          <strong>开始新一局</strong>
        </div>
      </div>
      <p class="play-again-note">你将重新选择角色，并从完整开场开始。</p>
      <p class="play-again-sr-only">当前这一局及历史记录都会保留。确认后，你将重新选择角色，并创建一条全新的故事线。</p>
      <div class="play-again-actions">
        <button id="playAgainCancelBtn" class="play-again-secondary" type="button">留在当前一局</button>
        <button id="playAgainConfirmBtn" class="play-again-primary" type="button">开始新一局</button>
      </div>
    </section>
  </div>`;
}
