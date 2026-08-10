import {
  adaptEndgamePresentationV3ForGame,
  enhanceEndgameResultPage,
  normalizeEndgamePresentationV3
} from "./endgame-result-renderer.js?v=20260810-generic-endgame-v3";

const INSTALL_FLAG = Symbol.for("our-many-worlds.solo-endgame-presentation-v1");
const RESULT_CACHE = new WeakMap();
let latestPresentation = null;
let observer = null;

export function installSoloEndgamePresentationV1(StorageClass, browser = globalThis) {
  if (!StorageClass?.prototype || StorageClass.prototype[INSTALL_FLAG]) {
    installPageObserver(browser);
    return;
  }
  Object.defineProperty(StorageClass.prototype, INSTALL_FLAG, { value: true });
  for (const methodName of ["restoreOrCreate", "getRun", "submitDecision", "submitManeuver"]) {
    const original = StorageClass.prototype[methodName];
    if (typeof original !== "function") continue;
    StorageClass.prototype[methodName] = async function (...args) {
      const view = await original.apply(this, args);
      return applyAuthoritativeSoloEndgame(this, view, browser);
    };
  }
  installPageObserver(browser);
}

export async function applyAuthoritativeSoloEndgame(storage, view, browser = globalThis) {
  const projection = storage?.projection;
  const runId = String(projection?.room?.id || view?.run?.id || "");
  if (projection?.room?.mode !== "solo" || projection?.completed !== true
    || !/^solo_ovl_[a-f0-9]{32}$/.test(runId)) return view;
  let result = RESULT_CACHE.get(storage);
  if (!result || result.runId !== runId) {
    try {
      const payload = await storage.loadResult();
      const presentation = normalizeEndgamePresentationV3(payload?.presentation)
        || normalizeEndgamePresentationV1(payload?.presentation);
      result = { runId, presentation, error: presentation ? "" : "终局展示合同无效。" };
      if (presentation) RESULT_CACHE.set(storage, result);
      else RESULT_CACHE.delete(storage);
    } catch (error) {
      result = { runId, presentation: null, error: String(error?.message || "终局结果暂时无法读取。") };
      RESULT_CACHE.delete(storage);
    }
  }
  if (!result.presentation) {
    return {
      ...view,
      finalJudgement: null,
      endgamePresentation: null,
      endgameResultError: result.error,
    };
  }
  publishPresentation(result.presentation, browser);
  return {
    ...view,
    finalJudgement: result.presentation.schemaVersion === "endgame_presentation_v3"
      ? adaptEndgamePresentationV3ForGame(result.presentation)
      : adaptPresentationForExistingFinalRenderer(result.presentation),
    endgamePresentation: result.presentation,
    replayActions: result.presentation.replayActions,
    endgameResultError: "",
  };
}

export function normalizeEndgamePresentationV1(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  if (value.schemaVersion !== "endgame_presentation_v1") return null;
  const allowedResultTypes = new Set(["SOLO_PART_END", "SOLO_STORY_END", "LEGACY_ENDING"]);
  const allowedVerdicts = new Set(["WIN", "COSTLY_WIN", "LOSS", "UNRESOLVED", "UNAVAILABLE"]);
  if (!allowedResultTypes.has(value.resultType) || !allowedVerdicts.has(value.verdict)) return null;
  if (![value.verdictLabel, value.title, value.verdictLine].every(nonEmptyString)) return null;
  if (typeof value.narrative !== "string") return null;
  if (!Array.isArray(value.gain) || !value.gain.every(nonEmptyString)
    || !Array.isArray(value.loss) || !value.loss.every(nonEmptyString)
    || !Array.isArray(value.causes) || !Array.isArray(value.replayActions)
    || typeof value.replayHint !== "string") return null;
  if (value.causes.length > 3) return null;
  if (value.resultType === "LEGACY_ENDING" && value.verdict !== "UNAVAILABLE") return null;
  if (value.resultType !== "LEGACY_ENDING" && value.verdict === "UNAVAILABLE") return null;
  const causes = value.causes.map(normalizeCause);
  if (causes.some((cause) => !cause)) return null;
  const reveal = normalizeReveal(value.reveal);
  if (value.reveal !== null && !reveal) return null;
  const replayActions = value.replayActions.map(normalizeReplayAction);
  if (replayActions.some((action) => !action)) return null;
  const replayTypes = replayActions.map((action) => action?.type);
  if (new Set(replayTypes).size !== replayTypes.length) return null;
  return {
    schemaVersion: "endgame_presentation_v1",
    resultType: value.resultType,
    verdict: value.verdict,
    verdictLabel: value.verdictLabel,
    title: value.title,
    verdictLine: value.verdictLine,
    narrative: value.narrative,
    gain: strings(value.gain),
    loss: strings(value.loss),
    causes: causes.filter(Boolean),
    reveal,
    replayHint: typeof value.replayHint === "string" ? value.replayHint : "",
    replayActions: replayActions.filter(Boolean),
  };
}

export function adaptPresentationForExistingFinalRenderer(presentation) {
  return {
    schemaVersion: "endgame_presentation_v1",
    resultType: presentation.resultType,
    globalEnding: {
      title: presentation.title,
      narrative: presentation.verdictLine,
    },
    personalEnding: {
      rank: presentation.verdictLabel,
      title: presentation.title,
      narrative: presentation.narrative || presentation.verdictLine,
      futureAftermath: "",
    },
    causalExplanation: {
      keyMovesThatSavedYou: [],
      keyMovesThatHurtYou: [],
      fateDebts: [],
    },
  };
}

export function enhanceSoloEndgamePage(documentRef, presentation) {
  const final = documentRef?.querySelector?.('[data-testid="final-judgement"]');
  if (!final || !presentation) return false;
  final.querySelectorAll("[data-solo-endgame-v1]").forEach((node) => node.remove());
  final.dataset.endgameSchema = "endgame_presentation_v1";

  const kicker = final.querySelector(".final-kicker");
  if (kicker) {
    kicker.textContent = presentation.resultType === "SOLO_PART_END"
      ? "《桑田诏》第一部分结局"
      : presentation.resultType === "SOLO_STORY_END"
        ? "整部故事结局"
        : "历史结局";
  }
  const title = final.querySelector("h2");
  if (title) title.textContent = presentation.title;
  const globalLine = final.querySelector(".final-global");
  if (globalLine) globalLine.textContent = presentation.verdictLine;

  const badge = documentRef.createElement("p");
  badge.dataset.soloEndgameV1 = "verdict";
  badge.dataset.testid = "ending-verdict";
  badge.className = "final-kicker ending-verdict-label";
  badge.textContent = presentation.verdictLabel;
  (title || final.firstChild)?.before?.(badge);

  const details = documentRef.createElement("section");
  details.dataset.soloEndgameV1 = "details";
  details.className = "final-grid solo-endgame-details";
  appendListArticle(documentRef, details, "你得到", presentation.gain, "ending-gain");
  appendListArticle(documentRef, details, "你失去", presentation.loss, "ending-loss");
  if (presentation.causes.length) {
    const article = documentRef.createElement("article");
    article.dataset.testid = "ending-causes";
    const heading = documentRef.createElement("h3");
    heading.textContent = "为什么会这样";
    article.append(heading);
    const list = documentRef.createElement("ol");
    for (const cause of presentation.causes) {
      const item = documentRef.createElement("li");
      const prefix = cause.stageIndex === null ? "关键选择" : `第 ${cause.stageIndex} 回合`;
      item.textContent = `${prefix} · ${cause.actionTitle}：${cause.factText}`;
      list.append(item);
    }
    article.append(list);
    details.append(article);
  }
  if (presentation.reveal) {
    const article = documentRef.createElement("article");
    article.dataset.testid = "ending-reveal";
    const heading = documentRef.createElement("h3");
    heading.textContent = presentation.reveal.title;
    const text = documentRef.createElement("p");
    text.textContent = presentation.reveal.text;
    article.append(heading, text);
    details.append(article);
  }
  final.append(details);

  if (presentation.replayHint) {
    const hint = documentRef.createElement("p");
    hint.dataset.soloEndgameV1 = "replay-hint";
    hint.dataset.testid = "ending-replay-hint";
    hint.className = "fate-debt";
    const strong = documentRef.createElement("b");
    strong.textContent = "下一局值得尝试：";
    hint.append(strong, documentRef.createTextNode(presentation.replayHint));
    final.append(hint);
  }

  const actions = documentRef.createElement("div");
  actions.dataset.soloEndgameV1 = "replay-actions";
  actions.dataset.testid = "ending-replay-actions";
  actions.className = "actions solo-endgame-replay-actions";
  for (const action of presentation.replayActions) {
    if (action.enabled && action.href) {
      const link = documentRef.createElement("a");
      link.href = action.href;
      link.textContent = action.label;
      link.dataset.replayAction = action.type;
      actions.append(link);
    } else {
      const button = documentRef.createElement("button");
      button.type = "button";
      button.disabled = true;
      button.textContent = action.label;
      button.title = action.disabledReason || "当前不可用";
      button.dataset.replayAction = action.type;
      actions.append(button);
      if (action.disabledReason) {
        const reason = documentRef.createElement("small");
        reason.textContent = action.disabledReason;
        actions.append(reason);
      }
    }
  }
  final.append(actions);
  const localReset = final.querySelector("#resetDecisionBtn");
  if (localReset) {
    localReset.hidden = true;
    localReset.setAttribute("aria-hidden", "true");
    localReset.tabIndex = -1;
  }
  return true;
}

function publishPresentation(presentation, browser) {
  latestPresentation = presentation;
  browser.__SOLO_ENDGAME_PRESENTATION__ = presentation;
  const documentRef = browser.document;
  if (documentRef) queueTask(browser, () => enhancePresentationPage(documentRef, presentation));
}

function installPageObserver(browser) {
  const documentRef = browser?.document;
  const Observer = browser?.MutationObserver;
  if (!documentRef || typeof Observer !== "function" || observer) return;
  observer = new Observer(() => {
    const presentation = browser.__SOLO_ENDGAME_PRESENTATION__ || latestPresentation;
    if (presentation) enhancePresentationPage(documentRef, presentation);
  });
  observer.observe(documentRef.documentElement || documentRef.body, { childList: true, subtree: true });
}

function enhancePresentationPage(documentRef, presentation) {
  return presentation?.schemaVersion === "endgame_presentation_v3"
    ? enhanceEndgameResultPage(documentRef, presentation)
    : enhanceSoloEndgamePage(documentRef, presentation);
}

function appendListArticle(documentRef, parent, headingText, values, testid) {
  const article = documentRef.createElement("article");
  article.dataset.testid = testid;
  const heading = documentRef.createElement("h3");
  heading.textContent = headingText;
  article.append(heading);
  const list = documentRef.createElement("ul");
  for (const value of values) {
    const item = documentRef.createElement("li");
    item.textContent = value;
    list.append(item);
  }
  article.append(list);
  parent.append(article);
}

function normalizeCause(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  if (!nonEmptyString(value.actionTitle) || !nonEmptyString(value.factText)) return null;
  if (!["HELPED", "HURT", "DECISIVE"].includes(value.direction)) return null;
  return {
    stageIndex: Number.isInteger(value.stageIndex) && value.stageIndex >= 0 ? value.stageIndex : null,
    // Internal action identifiers are useful to the server audit contract but
    // are deliberately discarded before the legacy view is handed to the DOM.
    sourceActionId: null,
    sourceRoleName: nonEmptyString(value.sourceRoleName) ? value.sourceRoleName : null,
    actionTitle: value.actionTitle,
    factText: value.factText,
    direction: value.direction,
  };
}

function normalizeReveal(value) {
  if (value === null) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return nonEmptyString(value.title) && nonEmptyString(value.text)
    ? { title: value.title, text: value.text }
    : null;
}

function normalizeReplayAction(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const allowedTypes = new Set([
    "RESTART_SAME_STORY",
    "CHANGE_ROLE",
    "CONTINUE_NEXT_PART",
    "BACK_TO_WORLDS",
  ]);
  if (!allowedTypes.has(value.type) || !nonEmptyString(value.label) || typeof value.enabled !== "boolean") return null;
  const href = safeHref(value.href);
  if (value.enabled && !href) return null;
  return {
    type: value.type,
    label: value.label,
    href,
    enabled: value.enabled,
    disabledReason: nonEmptyString(value.disabledReason) ? value.disabledReason : null,
  };
}

function safeHref(value) {
  const href = typeof value === "string" ? value.trim() : "";
  if (!href.startsWith("/") || href.startsWith("//") || href.includes("\\")
    || /[\u0000-\u001f\u007f]/.test(href)) return null;
  try {
    const url = new URL(href, "https://our-many-worlds.invalid");
    if (url.origin !== "https://our-many-worlds.invalid") return null;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return null;
  }
}
function strings(value) { return array(value).filter(nonEmptyString); }
function array(value) { return Array.isArray(value) ? value : []; }
function nonEmptyString(value) { return typeof value === "string" && value.trim().length > 0; }
function queueTask(browser, callback) { (browser.queueMicrotask || queueMicrotask)(callback); }
