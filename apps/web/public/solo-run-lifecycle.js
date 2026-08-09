import { ContinuousStoryV2LegacyStorage } from "./continuous-story-v2-legacy-storage.js?v=20260806-opening-sequence-v1";
import { installSoloEndgamePresentationV1 } from "./solo-endgame-presentation-v1.js?v=20260809-authoritative-v1";

// app.js imports this module before it asks the already-created Story V2
// storage instance to restore. Patching the class prototype here therefore
// replaces the completed OpenNovel placeholder with the authoritative Result
// API projection without changing the existing three-column game layout.
installSoloEndgamePresentationV1(ContinuousStoryV2LegacyStorage);

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
      <p id="play-again-description">当前进度会保留；新一局将重新选择角色，并从完整开场开始。</p>
      <div class="play-again-actions">
        <button id="playAgainCancelBtn" class="play-again-secondary" type="button">留在当前一局</button>
        <button id="playAgainConfirmBtn" class="play-again-primary" type="button">开始新一局</button>
      </div>
    </section>
  </div>`;
}
