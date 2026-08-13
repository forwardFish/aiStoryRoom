export const PRESSURE_WORKBENCH_BRIDGE_SCOPE_V1 = "EXISTING_WORKBENCH_ONLY";

const WORKBENCH_TO_MANEUVER = Object.freeze({
  TALK: "contact",
  INVESTIGATE: "investigate",
  TOKEN: "leverage",
  PLAN: "custom",
});

const CAPABILITY_BY_WORKBENCH = Object.freeze({
  TALK: "canTalk",
  INVESTIGATE: "canInvestigate",
  TOKEN: "canUseToken",
  PLAN: "canPlan",
});

const ACTION_POSITIONS = Object.freeze(["primaryAction", "secondaryAction", "tertiaryAction"]);

export function pressureWorkbenchToExistingManeuverTypeV1(value) {
  return WORKBENCH_TO_MANEUVER[value] || null;
}

/**
 * Builds only the data consumed by the already-approved maneuver-four-ui.js.
 * This module intentionally renders no workbench DOM of its own.
 */
export function buildPressureManeuverPanelV1(projection) {
  const active = projection?.chapter?.phase === "ACTIVE"
    && projection?.viewer?.control?.mode === "HUMAN_ACTIVE";
  const capabilities = projection?.capabilities || {};
  const decisionOptions = Array.isArray(projection?.decision?.options)
    ? projection.decision.options
    : [];
  const responseEntries = collectResponseEntries(projection);
  const disabledReason = active ? null : "当前章节正在推进，请稍候";

  const decisionFor = (entry) => decisionOptions
    .filter((item) => item?.preferredEntry === entry)
    .map((item) => ({
      code: String(item.code || ""),
      label: String(item.label || ""),
      description: String(item.description || ""),
      preferredEntry: entry,
      sourceEventId: null,
    }));
  const responseFor = (entry) => responseEntries.filter((item) => item.preferredEntry === entry);

  const talk = dedupeByCode([...decisionFor("TALK"), ...responseFor("TALK")]);
  const investigate = dedupeByCode([...decisionFor("INVESTIGATE"), ...responseFor("INVESTIGATE")]);
  const tokenActions = dedupeByCode([...decisionFor("TOKEN"), ...responseFor("TOKEN")]);
  const plan = dedupeByCode([...decisionFor("PLAN"), ...responseFor("PLAN")]);
  const tokens = Array.isArray(projection?.tokens)
    ? projection.tokens.filter((item) => item?.available === true && Number(item?.quantity) > 0)
    : [];

  const enabledFor = (entry, hasOptions) => active
    && capabilities[CAPABILITY_BY_WORKBENCH[entry]] === true
    && hasOptions;

  return {
    enabled: active,
    disabledReason,
    sceneKey: `${projection?.chapter?.chapterRuntimeId || "pressure"}:${projection?.chapter?.workingRevision ?? 0}`,
    quota: {
      perDay: 2,
      remaining: active ? 2 : 0,
      usedToday: 0,
      usedTypesToday: [],
    },
    contact: {
      enabled: enabledFor("TALK", talk.length > 0),
      disabledReason: talk.length > 0 ? disabledReason : "当前无可交谈人物",
      options: talk.map((item) => ({
        roleKey: item.code,
        displayName: "相关经手方",
        publicIdentity: "当前事件相关方",
        relevance: item.label || item.description || "可就当前事件进行交涉",
        portrait: "",
      })),
    },
    investigate: {
      enabled: enabledFor("INVESTIGATE", investigate.length > 0),
      disabledReason: investigate.length > 0 ? disabledReason : "当前无调查事项",
      options: investigate.map((item) => ({
        intentKey: item.code,
        title: item.label || "派遣调查",
        summary: item.description || "核查当前已知异常与证据链。",
      })),
    },
    leverage: {
      enabled: enabledFor("TOKEN", tokenActions.length > 0 && tokens.length > 0),
      disabledReason: tokenActions.length > 0 && tokens.length > 0
        ? disabledReason
        : "当前无合适出牌时机",
      options: tokens.map((item) => ({
        leverageKey: String(item.tokenId || ""),
        label: String(item.label || "筹码"),
        description: String(item.description || ""),
        requiresTarget: false,
        targets: [],
      })),
    },
    custom: {
      enabled: enabledFor("PLAN", plan.length > 0),
      disabledReason: plan.length > 0 ? disabledReason : "当前不能自拟",
      maxLength: 200,
    },
  };
}

/**
 * Opens one of the existing four workbenches. No replacement form or panel is
 * mounted. The response context stays in the Pressure storage adapter and is
 * revalidated again immediately before submission.
 */
export function openPressureResponseInExistingWorkbenchV1({
  app,
  root,
  storage,
  item,
  action,
  window: win = globalThis.window,
} = {}) {
  const maneuverType = pressureWorkbenchToExistingManeuverTypeV1(action?.preferredEntry);
  if (!maneuverType || !app || !root || !storage) return false;
  storage.setResponseContext(item, action);

  const state = app.getState?.();
  if (state?.activeManeuverType !== maneuverType) {
    const opened = app.chooseManeuver?.(maneuverType);
    if (opened === false) {
      storage.clearResponseContext();
      return false;
    }
  } else {
    app.render?.();
  }

  schedule(win, () => selectAndFocusExistingWorkbench(root, maneuverType, action));
  return true;
}

export function collectPressureResponseActionsV1(projection) {
  return collectResponseEntries(projection).map((entry) => ({ ...entry }));
}

function collectResponseEntries(projection) {
  const items = Array.isArray(projection?.feedPage?.items) ? projection.feedPage.items : [];
  const result = [];
  for (const item of items) {
    const actions = Array.isArray(item?.responseOptions)
      ? item.responseOptions
      : ACTION_POSITIONS.map((key) => item?.centerCard?.[key]).filter(Boolean);
    for (const action of actions) {
      if (!isAction(action)) continue;
      result.push({
        code: action.code,
        label: action.label,
        description: String(item?.safeSummary || item?.centerCard?.summary || ""),
        preferredEntry: action.preferredEntry,
        sourceEventId: String(item?.eventId || ""),
      });
    }
  }
  return result;
}

function selectAndFocusExistingWorkbench(root, maneuverType, action) {
  if (maneuverType === "investigate") {
    const selector = `[data-investigation-key="${cssEscape(action.code)}"]`;
    const option = root.querySelector(selector);
    option?.click?.();
    schedule(globalThis.window, () => {
      root.querySelector(selector)?.focus?.({ preventScroll: true });
    });
    return;
  }
  if (maneuverType === "contact") {
    const selector = `[data-contact-role="${cssEscape(action.code)}"]`;
    const option = root.querySelector(selector);
    option?.click?.();
    schedule(globalThis.window, () => {
      const textarea = root.querySelector("#contactMessageText");
      textarea?.focus?.({ preventScroll: true });
    });
    return;
  }
  if (maneuverType === "leverage") {
    const option = root.querySelector("[data-leverage-key]");
    option?.click?.();
    schedule(globalThis.window, () => option?.focus?.({ preventScroll: true }));
    return;
  }
  schedule(globalThis.window, () => {
    root.querySelector("#customManeuverText")?.focus?.({ preventScroll: true });
  });
}

function schedule(win, callback) {
  const set = win?.setTimeout?.bind(win) || globalThis.setTimeout;
  set(callback, 0);
}

function dedupeByCode(values) {
  const byCode = new Map();
  for (const value of values) {
    if (!value?.code || byCode.has(value.code)) continue;
    byCode.set(value.code, value);
  }
  return [...byCode.values()];
}

function isAction(value) {
  return Boolean(
    value
    && typeof value === "object"
    && typeof value.code === "string"
    && value.code.trim()
    && typeof value.label === "string"
    && value.label.trim()
    && Object.prototype.hasOwnProperty.call(WORKBENCH_TO_MANEUVER, value.preferredEntry),
  );
}

function cssEscape(value) {
  const text = String(value || "");
  if (globalThis.CSS?.escape) return globalThis.CSS.escape(text);
  return text.replace(/["\\]/g, "\\$&");
}
