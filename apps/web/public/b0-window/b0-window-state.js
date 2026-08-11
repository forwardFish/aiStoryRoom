export function createB0WindowState() {
  return {
    active: false,
    projection: null,
    clockOffsetMs: 0,
    busy: false,
    error: "",
  };
}

export function normalizeB0WindowProjection(input) {
  if (!record(input) || input.schemaVersion !== "b0-player-window-projection-v1") {
    throw new TypeError("Unsupported B0 player window projection");
  }
  const window = record(input.window);
  const actor = record(input.actor);
  const settlement = record(input.settlement);
  if (!window || !actor || !settlement || !text(window.id) || !text(window.status)) {
    throw new TypeError("Invalid B0 player window projection");
  }
  const allowedWindowStatus = ["OPEN", "LOCKED", "SETTLING", "COMMITTED", "PUBLISHING", "COMPLETED", "FAILED_RETRYABLE", "FAILED_HARD", "ABORTED"];
  const status = allowedWindowStatus.includes(window.status) ? window.status : "FAILED_HARD";
  const plan = normalizePlan(input.plan);
  const results = array(input.structuredResults).flatMap((entry) => {
    if (!record(entry) || !text(entry.resultId) || !text(entry.resultKind) || !text(entry.summary)) return [];
    return [{
      resultId: text(entry.resultId),
      resultKind: text(entry.resultKind),
      visibility: text(entry.visibility),
      summary: text(entry.summary),
      outcomeStatus: optionalText(entry.outcomeStatus),
      changes: array(entry.changes).flatMap((change) => record(change) && text(change.kind) && text(change.operation)
        ? [{ kind: text(change.kind), operation: text(change.operation), numericDelta: finiteOrNull(change.numericDelta) }]
        : []),
      reasons: array(entry.reasons).flatMap((reason) => record(reason) && text(reason.kind) && text(reason.summary)
        ? [{ kind: text(reason.kind), summary: text(reason.summary) }]
        : []),
    }];
  });
  const narrativeInput = record(input.narrative);
  const narrativeStatus = narrativeInput && ["PENDING", "GENERATING", "VALIDATING", "PUBLISHED", "FALLBACK_PUBLISHED", "FAILED_RETRYABLE"].includes(narrativeInput.status)
    ? narrativeInput.status
    : null;
  if (narrativeStatus && !text(narrativeInput.sourceCommitHash)) {
    throw new TypeError("Narrative projection requires sourceCommitHash");
  }
  return {
    schemaVersion: "b0-player-window-projection-v1",
    serverNow: iso(input.serverNow),
    window: {
      id: text(window.id),
      ordinal: integer(window.ordinal, 1),
      situationId: text(window.situationId),
      status,
      openedAt: iso(window.openedAt),
      locksAt: optionalIso(window.locksAt),
      lockedAt: optionalIso(window.lockedAt),
      committedAt: optionalIso(window.committedAt),
      completedAt: optionalIso(window.completedAt),
      lockReason: optionalText(window.lockReason),
      rulesetVersion: text(window.rulesetVersion),
    },
    actor: {
      ready: actor.ready === true,
      readyRevision: integer(actor.readyRevision, 0),
    },
    readyCount: integer(input.readyCount, 0),
    expectedCount: Math.max(1, integer(input.expectedCount, 1)),
    plan,
    settlement: { status: text(settlement.status) || "NOT_STARTED" },
    structuredResults: results,
    narrative: narrativeStatus && narrativeInput ? {
      schemaVersion: "openovel-narrative-projection-v1",
      authoritativeResultStatus: "FINALIZED",
      structuredResultReady: true,
      status: narrativeStatus,
      sourceCommitHash: text(narrativeInput.sourceCommitHash),
      presentationHash: optionalText(narrativeInput.presentationHash),
      content: ["PUBLISHED", "FALLBACK_PUBLISHED"].includes(narrativeStatus) ? optionalText(narrativeInput.content) : null,
      updatedAt: optionalIso(narrativeInput.updatedAt),
    } : null,
  };
}

export function applyB0WindowProjection(state, input, now = Date.now()) {
  const projection = normalizeB0WindowProjection(input);
  state.projection = projection;
  state.active = true;
  state.clockOffsetMs = Date.parse(projection.serverNow) - Number(now);
  state.error = "";
  return projection;
}

export function b0WindowRemainingMs(state, now = Date.now()) {
  const locksAt = state.projection?.window?.locksAt;
  if (!locksAt || state.projection?.window?.status !== "OPEN") return 0;
  return Math.max(0, Date.parse(locksAt) - (Number(now) + state.clockOffsetMs));
}

export function b0PlanRevision(state) {
  return state.projection?.plan?.revision ?? 0;
}

export function b0CanEdit(state) {
  return state.active
    && state.projection?.window?.status === "OPEN"
    && state.projection?.actor?.ready !== true;
}

export function b0CanConfirm(state) {
  return b0CanEdit(state) && state.projection?.plan?.status === "DRAFT";
}

export function b0CanReady(state) {
  return state.active
    && state.projection?.window?.status === "OPEN"
    && state.projection?.actor?.ready !== true
    && state.projection?.plan?.status === "CONFIRMED";
}

export function safeB0WindowState(state) {
  return {
    active: state.active,
    status: state.projection?.window?.status ?? null,
    planStatus: state.projection?.plan?.status ?? null,
    ready: state.projection?.actor?.ready ?? false,
    readyCount: state.projection?.readyCount ?? null,
    expectedCount: state.projection?.expectedCount ?? null,
    structuredResultCount: state.projection?.structuredResults?.length ?? 0,
    narrativeStatus: state.projection?.narrative?.status ?? null,
  };
}

function normalizePlan(value) {
  if (value === null || value === undefined) return null;
  if (!record(value) || !["DRAFT", "CONFIRMED", "LOCKED"].includes(value.status)) return null;
  const presentation = record(value.presentation);
  if (!presentation) return null;
  const required = ["title", "description", "visibleEffect", "confirmLabel"];
  if (required.some((key) => !text(presentation[key]))) return null;
  return {
    status: value.status,
    revision: integer(value.revision, 0),
    visibility: ["PUBLIC", "PRIVATE", "COVERT", "CONDITIONAL"].includes(value.visibility) ? value.visibility : "PRIVATE",
    presentation: {
      title: text(presentation.title),
      description: text(presentation.description),
      visibleEffect: text(presentation.visibleEffect),
      visibleRisk: optionalText(presentation.visibleRisk),
      confirmLabel: text(presentation.confirmLabel),
    },
  };
}

function integer(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}
function finiteOrNull(value) { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : null; }
function text(value) { return typeof value === "string" ? value.trim() : ""; }
function optionalText(value) { const result = text(value); return result || null; }
function array(value) { return Array.isArray(value) ? value : []; }
function record(value) { return Boolean(value) && typeof value === "object" && !Array.isArray(value) ? value : null; }
function iso(value) { const time = Date.parse(String(value || "")); if (!Number.isFinite(time)) throw new TypeError("Invalid B0 server timestamp"); return new Date(time).toISOString(); }
function optionalIso(value) { if (!value) return null; return iso(value); }
