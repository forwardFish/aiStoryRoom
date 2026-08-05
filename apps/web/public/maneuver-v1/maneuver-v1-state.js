export const MANEUVER_KINDS_V1 = Object.freeze(["CONTACT", "INVESTIGATE", "LEVERAGE", "CUSTOM"]);

export function createManeuverV1State() {
  return {
    active: false,
    selectedKind: "CONTACT",
    projection: null,
    drafts: {
      CONTACT: { targetId: "", rawText: "", leverageAssetId: "" },
      INVESTIGATE: { traceId: "", routeId: "", leverageAssetId: "" },
      LEVERAGE: { targetId: "", leverageAssetId: "", rawText: "" },
      CUSTOM: { rawText: "", leverageAssetId: "" },
    },
    preview: null,
    previewCommitKey: "",
    busy: false,
    error: "",
    notice: "",
  };
}

export function normalizeManeuverProjectionV1(input) {
  if (!isRecord(input) || input.schemaVersion !== "maneuver_projection_v1") {
    throw new TypeError("Unsupported maneuver projection");
  }
  const maxPerTurn = 2;
  const remaining = clampInteger(input.remaining, 0, maxPerTurn);
  const windowState = input.windowState === "OPEN" ? "OPEN" : "CLOSED";
  const contacts = array(input.contacts).flatMap((entry) => {
    if (!isRecord(entry) || !text(entry.id) || !text(entry.label)) return [];
    return [{ id: text(entry.id), label: text(entry.label) }];
  });
  const traces = array(input.traces).flatMap((entry) => {
    if (!isRecord(entry) || !text(entry.traceId) || !text(entry.label) || !text(entry.description)) return [];
    const routeOptions = array(entry.routeOptions).flatMap((route) => {
      if (!isRecord(route) || !text(route.routeId) || !text(route.label) || !text(route.method)) return [];
      return [{ routeId: text(route.routeId), label: text(route.label), method: text(route.method) }];
    });
    if (!routeOptions.length) return [];
    const sourceKind = ["DOCUMENT", "PERSON", "LOCATION", "RESOURCE", "EVENT"].includes(entry.sourceKind)
      ? entry.sourceKind
      : "EVENT";
    return [{ traceId: text(entry.traceId), label: text(entry.label), description: text(entry.description), sourceKind, routeOptions }];
  });
  const leverageAssets = array(input.leverageAssets).flatMap((entry) => {
    if (!isRecord(entry) || !text(entry.id) || !text(entry.label) || !text(entry.effectSummary)) return [];
    return [{ id: text(entry.id), label: text(entry.label), effectSummary: text(entry.effectSummary) }];
  });
  const inProgress = array(input.inProgress).flatMap((entry) => {
    if (!isRecord(entry) || !text(entry.actionId) || !text(entry.label) || !text(entry.status)) return [];
    return [{ actionId: text(entry.actionId), label: text(entry.label), status: text(entry.status) }];
  });
  const privateEvidence = array(input.privateEvidence).flatMap((entry) => {
    if (!isRecord(entry) || entry.visibility !== "PRIVATE") return [];
    const required = ["evidenceId", "title", "summary", "supports", "cannotProve", "sourceKind"];
    if (required.some((key) => !text(entry[key]))) return [];
    return [{
      evidenceId: text(entry.evidenceId),
      title: text(entry.title),
      summary: text(entry.summary),
      supports: text(entry.supports),
      cannotProve: text(entry.cannotProve),
      sourceKind: text(entry.sourceKind),
      visibility: "PRIVATE",
    }];
  });
  return {
    schemaVersion: "maneuver_projection_v1",
    maxPerTurn,
    remaining,
    windowState,
    stateRevision: clampInteger(input.stateRevision, 0, Number.MAX_SAFE_INTEGER),
    turnRevision: clampInteger(input.turnRevision, 0, Number.MAX_SAFE_INTEGER),
    contacts,
    traces,
    leverageAssets,
    inProgress,
    privateEvidence,
  };
}

export function applyManeuverProjectionV1(state, projectionInput) {
  const previous = state.projection;
  const projection = normalizeManeuverProjectionV1(projectionInput);
  state.projection = projection;
  state.active = true;
  const revisionChanged = Boolean(previous && (
    previous.stateRevision !== projection.stateRevision
    || previous.turnRevision !== projection.turnRevision
  ));
  if (revisionChanged && state.preview?.decision === "READY") {
    state.preview = { decision: "STALE", clarificationPrompt: "局势已经发生变化，请根据最新剧情重新预演。" };
    state.previewCommitKey = "";
  }
  hydrateDraftDefaultsV1(state);
  return projection;
}

export function hydrateDraftDefaultsV1(state) {
  const projection = state.projection;
  if (!projection) return;
  if (!state.drafts.CONTACT.targetId && projection.contacts[0]) state.drafts.CONTACT.targetId = projection.contacts[0].id;
  if (!state.drafts.INVESTIGATE.traceId && projection.traces[0]) {
    state.drafts.INVESTIGATE.traceId = projection.traces[0].traceId;
    state.drafts.INVESTIGATE.routeId = projection.traces[0].routeOptions[0]?.routeId || "";
  }
  if (!state.drafts.LEVERAGE.leverageAssetId && projection.leverageAssets[0]) state.drafts.LEVERAGE.leverageAssetId = projection.leverageAssets[0].id;
  if (!state.drafts.LEVERAGE.targetId) state.drafts.LEVERAGE.targetId = projection.contacts[0]?.id || projection.traces[0]?.traceId || "";
}

export function selectManeuverKindV1(state, kind) {
  if (!MANEUVER_KINDS_V1.includes(kind)) return false;
  state.selectedKind = kind;
  state.error = "";
  state.notice = "";
  return true;
}

export function updateManeuverDraftV1(state, kind, patch) {
  if (!MANEUVER_KINDS_V1.includes(kind) || !isRecord(patch)) return false;
  state.drafts[kind] = { ...state.drafts[kind], ...patch };
  if (kind === "INVESTIGATE" && Object.prototype.hasOwnProperty.call(patch, "traceId")) {
    const trace = state.projection?.traces.find((entry) => entry.traceId === patch.traceId);
    state.drafts.INVESTIGATE.routeId = trace?.routeOptions[0]?.routeId || "";
  }
  state.error = "";
  state.notice = "";
  return true;
}

export function buildManeuverDraftV1(state) {
  const projection = state.projection;
  if (!projection) throw new ManeuverInputErrorV1("当前局势尚未加载。");
  if (projection.windowState !== "OPEN") throw new ManeuverInputErrorV1("主线决策正在锁定，当前不能提交新的谋划。");
  if (projection.remaining <= 0) throw new ManeuverInputErrorV1("本场景的谋划机会已经用完。");
  const expectedTurnRevision = projection.turnRevision;
  const kind = state.selectedKind;
  const source = state.drafts[kind];
  if (kind === "CONTACT") {
    requireText(source.targetId, "请先选择一个可以交谈的人物。");
    requireText(source.rawText, "请写下你准备询问、试探或交涉的具体内容。");
    return compact({ kind, targetId: source.targetId, rawText: source.rawText, leverageAssetId: source.leverageAssetId, expectedTurnRevision });
  }
  if (kind === "INVESTIGATE") {
    requireText(source.traceId, "请先选择一条当前可见的痕迹。");
    requireText(source.routeId, "请先选择一条具体调查路线。");
    return compact({ kind, traceId: source.traceId, routeId: source.routeId, leverageAssetId: source.leverageAssetId, expectedTurnRevision });
  }
  if (kind === "LEVERAGE") {
    requireText(source.leverageAssetId, "请先选择当前角色真实持有的一项筹码。");
    requireText(source.targetId, "请先选择筹码要作用的对象。");
    return compact({ kind, targetId: source.targetId, leverageAssetId: source.leverageAssetId, rawText: source.rawText, expectedTurnRevision });
  }
  requireText(source.rawText, "请只写下一件准备真正推进的事。");
  return compact({ kind: "CUSTOM", rawText: source.rawText, leverageAssetId: source.leverageAssetId, expectedTurnRevision });
}

export function applyManeuverPreviewV1(state, response, createCommitKey = defaultCommitKey) {
  const remainingBefore = state.projection?.remaining;
  const decision = String(response?.decision || "BLOCKED");
  if (decision === "REROUTE") {
    const target = MANEUVER_KINDS_V1.includes(response?.rerouteTo) ? response.rerouteTo : null;
    if (target) state.selectedKind = target;
    state.preview = null;
    state.previewCommitKey = "";
    state.notice = text(response?.clarificationPrompt) || "这项表达需要按另一类行动规则继续。";
  } else if (decision === "READY" && text(response?.previewToken) && isRecord(response?.presentation)) {
    state.preview = {
      decision: "READY",
      previewToken: text(response.previewToken),
      expiresAt: text(response.expiresAt),
      presentation: {
        title: text(response.presentation.title),
        description: text(response.presentation.description),
        visibleEffect: text(response.presentation.visibleEffect),
        visibleRisk: text(response.presentation.visibleRisk),
        confirmLabel: text(response.presentation.confirmLabel) || "确认这一步",
      },
    };
    state.previewCommitKey = createCommitKey();
    state.notice = "";
  } else {
    state.preview = {
      decision: decision === "CLARIFY" ? "CLARIFY" : decision === "STALE" ? "STALE" : "BLOCKED",
      clarificationPrompt: text(response?.clarificationPrompt) || "这项谋划暂时不能提交，请重新调整。",
    };
    state.previewCommitKey = "";
  }
  if (state.projection && Number.isInteger(remainingBefore)) state.projection.remaining = remainingBefore;
  return state.preview;
}

export function clearManeuverPreviewV1(state) {
  state.preview = null;
  state.previewCommitKey = "";
  state.error = "";
}

export function safeControllerStateV1(state) {
  return {
    active: state.active,
    selectedKind: state.selectedKind,
    busy: state.busy,
    hasPreview: Boolean(state.preview),
    remaining: state.projection?.remaining ?? null,
    evidenceCount: state.projection?.privateEvidence.length ?? 0,
    inProgressCount: state.projection?.inProgress.length ?? 0,
  };
}

export class ManeuverInputErrorV1 extends Error {
  constructor(message) { super(message); this.name = "ManeuverInputErrorV1"; }
}

function defaultCommitKey() {
  const id = globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 14)}`;
  return `commit:maneuver:${id}`;
}
function requireText(value, message) { if (!text(value)) throw new ManeuverInputErrorV1(message); }
function compact(value) { return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== "" && entry !== undefined && entry !== null)); }
function clampInteger(value, minimum, maximum) { const number = Number(value); return Number.isInteger(number) ? Math.min(maximum, Math.max(minimum, number)) : minimum; }
function text(value) { return typeof value === "string" ? value.trim() : ""; }
function array(value) { return Array.isArray(value) ? value : []; }
function isRecord(value) { return Boolean(value) && typeof value === "object" && !Array.isArray(value); }
