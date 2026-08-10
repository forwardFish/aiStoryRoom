import { createHash } from "node:crypto";
import { canonicalizeJcs } from "./endgame-package-v1.contract.mjs";
import { resolveFrozenEndgamePackageForRunV1 } from "./endgame-package-loader-v1.mjs";

export const ENDGAME_METRIC_LEDGER_SCHEMA_VERSION = "endgame_metric_ledger_v1";
export const ENDGAME_METRIC_CHANGE_RECORD_SCHEMA_VERSION = "metric_change_record_v1";

const LEDGER_KEYS = Object.freeze([
  "schemaVersion",
  "runId",
  "packageRef",
  "revision",
  "metrics",
  "trajectory",
  "appliedSubmissions",
  "appliedChangeIds"
]);
const PACKAGE_REF_KEYS = Object.freeze(["policyId", "policyVersion", "packageHash"]);
const CHANGE_KEYS = Object.freeze(["changeId", "metricId", "delta", "reasonCode", "reasonText", "sourceFactIds"]);
const RECORD_KEYS = Object.freeze([
  "schemaVersion",
  "submissionId",
  "changeId",
  "metricId",
  "before",
  "requestedDelta",
  "delta",
  "after",
  "clamped",
  "stageIndex",
  "sourceActionId",
  "sourceFactIds",
  "reasonCode",
  "reasonText",
  "committedRevision"
]);
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/u;
const FORBIDDEN_RECORD_KEYS = new Set(["__proto__", "prototype", "constructor"]);

export class EndgameMetricLedgerError extends Error {
  constructor(code, message, details = {}) {
    super(`${code}: ${message}`);
    this.name = "EndgameMetricLedgerError";
    this.code = code;
    this.details = deepFreeze(structuredClone(details));
  }
}

export function createEndgameMetricLedgerV1(runPackageBinding) {
  const snapshot = resolveFrozenEndgamePackageForRunV1(runPackageBinding);
  const metrics = {};
  for (const definition of snapshot.packageDocument.metrics) metrics[definition.metricId] = definition.initialValue;
  return deepFreeze({
    schemaVersion: ENDGAME_METRIC_LEDGER_SCHEMA_VERSION,
    runId: runPackageBinding.runId,
    packageRef: structuredClone(runPackageBinding.packageRef),
    revision: 0,
    metrics,
    trajectory: [],
    appliedSubmissions: {},
    appliedChangeIds: []
  });
}

export function applyEndgameMetricChangesV1({
  runPackageBinding,
  ledger,
  submissionId,
  expectedRevision,
  stageIndex,
  sourceActionId = null,
  changes
}) {
  const snapshot = resolveFrozenEndgamePackageForRunV1(runPackageBinding);
  assertEndgameMetricLedgerV1(runPackageBinding, ledger);
  assertStableId(submissionId, "submissionId");
  if (!Number.isInteger(stageIndex) || stageIndex < 0) {
    throw new EndgameMetricLedgerError("ENDGAME_METRIC_STAGE_INVALID", "stageIndex must be a non-negative integer.");
  }
  if (sourceActionId !== null) assertStableId(sourceActionId, "sourceActionId");
  const normalizedChanges = normalizeMetricChanges(changes, snapshot.packageDocument.metrics);
  const requestFingerprint = sha256Hex(canonicalizeJcs({
    submissionId,
    stageIndex,
    sourceActionId,
    changes: normalizedChanges
  }));

  const existingFingerprint = Object.hasOwn(ledger.appliedSubmissions, submissionId)
    ? ledger.appliedSubmissions[submissionId]
    : undefined;
  if (existingFingerprint !== undefined) {
    if (existingFingerprint !== requestFingerprint) {
      throw new EndgameMetricLedgerError(
        "ENDGAME_METRIC_IDEMPOTENCY_CONFLICT",
        "The same submissionId cannot be reused with different metric changes.",
        { submissionId }
      );
    }
    return deepFreeze({ ledger, applied: false, idempotent: true, records: [] });
  }
  if (!Number.isInteger(expectedRevision) || expectedRevision !== ledger.revision) {
    throw new EndgameMetricLedgerError("ENDGAME_METRIC_REVISION_CONFLICT", "expectedRevision does not match the durable ledger.", {
      expectedRevision,
      actualRevision: ledger.revision
    });
  }

  const knownChangeIds = new Set(ledger.appliedChangeIds);
  for (const change of normalizedChanges) {
    if (knownChangeIds.has(change.changeId)) {
      throw new EndgameMetricLedgerError("ENDGAME_METRIC_CHANGE_ID_REUSED", "changeId must be globally unique within a run.", {
        changeId: change.changeId
      });
    }
  }

  const metrics = { ...ledger.metrics };
  const nextRevision = ledger.revision + 1;
  const definitions = new Map(snapshot.packageDocument.metrics.map((definition) => [definition.metricId, definition]));
  const records = normalizedChanges.map((change) => {
    const definition = definitions.get(change.metricId);
    const before = metrics[change.metricId];
    const requestedAfter = before + change.delta;
    let after = requestedAfter;
    let clamped = false;
    if (requestedAfter < definition.min || requestedAfter > definition.max) {
      if (!definition.changePolicy.clamp) {
        throw new EndgameMetricLedgerError("ENDGAME_METRIC_RANGE_VIOLATION", "Metric change would leave the configured range.", {
          metricId: change.metricId,
          before,
          requestedDelta: change.delta,
          min: definition.min,
          max: definition.max
        });
      }
      after = Math.max(definition.min, Math.min(definition.max, requestedAfter));
      clamped = true;
    }
    const delta = normalizeNegativeZero(after - before);
    metrics[change.metricId] = after;
    return {
      schemaVersion: ENDGAME_METRIC_CHANGE_RECORD_SCHEMA_VERSION,
      submissionId,
      changeId: change.changeId,
      metricId: change.metricId,
      before,
      requestedDelta: change.delta,
      delta,
      after,
      clamped,
      stageIndex,
      sourceActionId,
      sourceFactIds: [...change.sourceFactIds],
      reasonCode: change.reasonCode,
      reasonText: change.reasonText,
      committedRevision: nextRevision
    };
  });

  const nextLedger = deepFreeze({
    schemaVersion: ENDGAME_METRIC_LEDGER_SCHEMA_VERSION,
    runId: ledger.runId,
    packageRef: structuredClone(ledger.packageRef),
    revision: nextRevision,
    metrics: sortRecord(metrics),
    trajectory: [...ledger.trajectory, ...records],
    appliedSubmissions: sortRecord({ ...ledger.appliedSubmissions, [submissionId]: requestFingerprint }),
    appliedChangeIds: [...ledger.appliedChangeIds, ...records.map((record) => record.changeId)].sort(compareText)
  });
  assertEndgameMetricLedgerV1(runPackageBinding, nextLedger);
  return deepFreeze({ ledger: nextLedger, applied: true, idempotent: false, records: deepFreeze(records) });
}

export function assertEndgameMetricLedgerV1(runPackageBinding, ledger) {
  const snapshot = resolveFrozenEndgamePackageForRunV1(runPackageBinding);
  assertExactObject(ledger, LEDGER_KEYS, "metric ledger");
  if (ledger.schemaVersion !== ENDGAME_METRIC_LEDGER_SCHEMA_VERSION) {
    throw new EndgameMetricLedgerError("ENDGAME_METRIC_LEDGER_VERSION_UNSUPPORTED", "Unknown metric ledger version.");
  }
  if (ledger.runId !== runPackageBinding.runId) {
    throw new EndgameMetricLedgerError("ENDGAME_METRIC_RUN_MISMATCH", "Metric ledger belongs to a different run.");
  }
  assertExactObject(ledger.packageRef, PACKAGE_REF_KEYS, "metric ledger packageRef");
  if (canonicalizeJcs(ledger.packageRef) !== canonicalizeJcs(runPackageBinding.packageRef)) {
    throw new EndgameMetricLedgerError("ENDGAME_METRIC_PACKAGE_MISMATCH", "Metric ledger packageRef does not match the frozen run package.");
  }
  if (!Number.isInteger(ledger.revision) || ledger.revision < 0) {
    throw new EndgameMetricLedgerError("ENDGAME_METRIC_LEDGER_REVISION_INVALID", "Ledger revision must be a non-negative integer.");
  }
  if (!isRecord(ledger.metrics) || !Array.isArray(ledger.trajectory) || !isRecord(ledger.appliedSubmissions) || !Array.isArray(ledger.appliedChangeIds)) {
    throw new EndgameMetricLedgerError("ENDGAME_METRIC_LEDGER_SHAPE_INVALID", "Metric ledger collections are malformed.");
  }

  const definitions = new Map(snapshot.packageDocument.metrics.map((definition) => [definition.metricId, definition]));
  const actualMetricIds = Object.keys(ledger.metrics).sort(compareText);
  const expectedMetricIds = [...definitions.keys()].sort(compareText);
  if (canonicalizeJcs(actualMetricIds) !== canonicalizeJcs(expectedMetricIds)) {
    throw new EndgameMetricLedgerError("ENDGAME_METRIC_SET_MISMATCH", "Ledger metrics must exactly match package-defined metricIds.", {
      actualMetricIds,
      expectedMetricIds
    });
  }
  for (const [metricId, value] of Object.entries(ledger.metrics)) {
    assertFinite(value, `metrics.${metricId}`);
    const definition = definitions.get(metricId);
    if (value < definition.min || value > definition.max) {
      throw new EndgameMetricLedgerError("ENDGAME_METRIC_RANGE_INVALID", "Stored metric is outside the configured range.", { metricId, value });
    }
  }

  const replayed = replayTrajectory(snapshot.packageDocument.metrics, ledger.trajectory);
  if (canonicalizeJcs(replayed.metrics) !== canonicalizeJcs(ledger.metrics)) {
    throw new EndgameMetricLedgerError("ENDGAME_METRIC_REPLAY_MISMATCH", "Trajectory does not replay to the stored metric snapshot.");
  }
  if (replayed.revision !== ledger.revision) {
    throw new EndgameMetricLedgerError("ENDGAME_METRIC_REPLAY_REVISION_MISMATCH", "Trajectory revision does not match the durable ledger.");
  }

  const changeIds = ledger.trajectory.map((record) => record.changeId).sort(compareText);
  if (canonicalizeJcs(changeIds) !== canonicalizeJcs([...ledger.appliedChangeIds].sort(compareText))) {
    throw new EndgameMetricLedgerError("ENDGAME_METRIC_CHANGE_INDEX_MISMATCH", "appliedChangeIds must exactly index trajectory records.");
  }
  if (new Set(ledger.appliedChangeIds).size !== ledger.appliedChangeIds.length) {
    throw new EndgameMetricLedgerError("ENDGAME_METRIC_CHANGE_INDEX_DUPLICATE", "appliedChangeIds must be unique.");
  }
  const submissionIds = Object.keys(ledger.appliedSubmissions);
  if (submissionIds.length !== ledger.revision) {
    throw new EndgameMetricLedgerError("ENDGAME_METRIC_SUBMISSION_INDEX_MISMATCH", "Each committed revision must have one durable submission fingerprint.");
  }
  for (const [submissionId, fingerprint] of Object.entries(ledger.appliedSubmissions)) {
    assertStableId(submissionId, "applied submissionId");
    if (typeof fingerprint !== "string" || !/^[0-9a-f]{64}$/u.test(fingerprint)) {
      throw new EndgameMetricLedgerError("ENDGAME_METRIC_SUBMISSION_HASH_INVALID", "Submission fingerprints must be lowercase SHA-256 hex.");
    }
  }
  return ledger;
}

export function replayEndgameMetricLedgerV1(runPackageBinding, ledger) {
  const snapshot = resolveFrozenEndgamePackageForRunV1(runPackageBinding);
  assertEndgameMetricLedgerV1(runPackageBinding, ledger);
  return deepFreeze(replayTrajectory(snapshot.packageDocument.metrics, ledger.trajectory));
}

export function projectEndgameMetricsForPlayerV1({ runPackageBinding, ledger, phase = "RUN" }) {
  const snapshot = resolveFrozenEndgamePackageForRunV1(runPackageBinding);
  assertEndgameMetricLedgerV1(runPackageBinding, ledger);
  if (!['RUN', 'ENDING'].includes(phase)) {
    throw new EndgameMetricLedgerError("ENDGAME_METRIC_PROJECTION_PHASE_INVALID", "Projection phase must be RUN or ENDING.");
  }
  const visible = snapshot.packageDocument.metrics
    .filter((definition) => phase === "RUN" ? definition.display.visibleDuringRun : definition.display.visibleAtEnding)
    .sort((left, right) => left.display.order - right.display.order || compareText(left.metricId, right.metricId));
  return deepFreeze(visible.map((definition) => {
    const latest = [...ledger.trajectory].reverse().find((record) => record.metricId === definition.metricId) ?? null;
    return {
      metricId: definition.metricId,
      label: definition.label,
      value: ledger.metrics[definition.metricId],
      formattedValue: formatMetricValueV1(definition, ledger.metrics[definition.metricId]),
      direction: definition.direction,
      initialValue: definition.initialValue,
      trend: definition.display.showTrend && latest ? {
        before: latest.before,
        delta: latest.delta,
        after: latest.after,
        stageIndex: latest.stageIndex,
        committedRevision: latest.committedRevision
      } : null
    };
  }));
}

export function projectEndgameTrajectoryForPlayerV1({ runPackageBinding, ledger, phase = "RUN" }) {
  if (!["RUN", "ENDING"].includes(phase)) {
    throw new EndgameMetricLedgerError("ENDGAME_METRIC_PROJECTION_PHASE_INVALID", "Projection phase must be RUN or ENDING.");
  }
  const snapshot = resolveFrozenEndgamePackageForRunV1(runPackageBinding);
  assertEndgameMetricLedgerV1(runPackageBinding, ledger);
  const visibleDefinitions = new Map(snapshot.packageDocument.metrics
    .filter((definition) => phase === "RUN" ? definition.display.visibleDuringRun : definition.display.visibleAtEnding)
    .map((definition) => [definition.metricId, definition]));
  return deepFreeze(ledger.trajectory
    .filter((record) => visibleDefinitions.has(record.metricId))
    .map((record) => ({
      metricId: record.metricId,
      label: visibleDefinitions.get(record.metricId).label,
      before: record.before,
      delta: record.delta,
      after: record.after,
      stageIndex: record.stageIndex,
      committedRevision: record.committedRevision
    })));
}

export function formatMetricValueV1(definition, value) {
  assertFinite(value, `metric ${definition?.metricId ?? "unknown"}`);
  const decimals = definition.format.decimals;
  const numeric = definition.format.kind === "INTEGER" ? String(Math.round(value)) : value.toFixed(decimals);
  if (definition.format.kind === "PERCENT") return `${numeric}${definition.format.suffix || "%"}`;
  if (definition.format.kind === "CURRENCY") return `${definition.format.suffix}${numeric}`;
  return `${numeric}${definition.format.suffix}`;
}

function normalizeMetricChanges(changes, metricDefinitions) {
  if (!Array.isArray(changes) || changes.length === 0 || changes.length > 64) {
    throw new EndgameMetricLedgerError("ENDGAME_METRIC_CHANGES_INVALID", "A settlement must contain 1..64 metric changes.");
  }
  const definitions = new Map(metricDefinitions.map((definition) => [definition.metricId, definition]));
  const seenMetrics = new Set();
  const seenChangeIds = new Set();
  const normalized = changes.map((change, index) => {
    assertExactObject(change, CHANGE_KEYS, `metric change ${index}`);
    assertStableId(change.changeId, `changes[${index}].changeId`);
    assertStableId(change.metricId, `changes[${index}].metricId`);
    if (seenChangeIds.has(change.changeId)) {
      throw new EndgameMetricLedgerError("ENDGAME_METRIC_CHANGE_ID_DUPLICATE", "A settlement cannot repeat changeId.", { changeId: change.changeId });
    }
    if (seenMetrics.has(change.metricId)) {
      throw new EndgameMetricLedgerError("ENDGAME_METRIC_DUPLICATE_IN_SUBMISSION", "A settlement must aggregate each metric into one change.", {
        metricId: change.metricId
      });
    }
    seenChangeIds.add(change.changeId);
    seenMetrics.add(change.metricId);
    const definition = definitions.get(change.metricId);
    if (!definition) {
      throw new EndgameMetricLedgerError("ENDGAME_METRIC_UNKNOWN", "metricId is not defined by the frozen package.", {
        metricId: change.metricId
      });
    }
    assertFinite(change.delta, `changes[${index}].delta`);
    if (Math.abs(change.delta) > definition.changePolicy.maxAbsoluteDeltaPerSettlement) {
      throw new EndgameMetricLedgerError("ENDGAME_METRIC_DELTA_LIMIT", "Metric delta exceeds maxAbsoluteDeltaPerSettlement.", {
        metricId: change.metricId,
        delta: change.delta,
        maxAbsoluteDeltaPerSettlement: definition.changePolicy.maxAbsoluteDeltaPerSettlement
      });
    }
    if (typeof change.reasonCode !== "string" || change.reasonCode.length === 0) {
      throw new EndgameMetricLedgerError("ENDGAME_METRIC_REASON_CODE_INVALID", "reasonCode is required.");
    }
    if (typeof change.reasonText !== "string" || change.reasonText.length === 0) {
      throw new EndgameMetricLedgerError("ENDGAME_METRIC_REASON_TEXT_INVALID", "reasonText is required.");
    }
    if (!Array.isArray(change.sourceFactIds) || new Set(change.sourceFactIds).size !== change.sourceFactIds.length) {
      throw new EndgameMetricLedgerError("ENDGAME_METRIC_SOURCE_FACTS_INVALID", "sourceFactIds must be a unique array.");
    }
    for (const factId of change.sourceFactIds) assertStableId(factId, `changes[${index}].sourceFactIds`);
    return {
      changeId: change.changeId,
      metricId: change.metricId,
      delta: normalizeNegativeZero(change.delta),
      reasonCode: change.reasonCode,
      reasonText: change.reasonText,
      sourceFactIds: [...change.sourceFactIds].sort(compareText)
    };
  });
  return normalized.sort((left, right) => compareText(left.metricId, right.metricId) || compareText(left.changeId, right.changeId));
}

function replayTrajectory(metricDefinitions, trajectory) {
  const definitions = new Map(metricDefinitions.map((definition) => [definition.metricId, definition]));
  const metrics = Object.fromEntries(metricDefinitions.map((definition) => [definition.metricId, definition.initialValue]));
  const changeIds = new Set();
  const submissionRevisions = new Map();
  let highestRevision = 0;
  let previousRevision = 0;
  for (const [index, record] of trajectory.entries()) {
    assertExactObject(record, RECORD_KEYS, `trajectory[${index}]`);
    if (record.schemaVersion !== ENDGAME_METRIC_CHANGE_RECORD_SCHEMA_VERSION) {
      throw new EndgameMetricLedgerError("ENDGAME_METRIC_RECORD_VERSION_UNSUPPORTED", "Unknown trajectory record version.");
    }
    assertStableId(record.submissionId, `trajectory[${index}].submissionId`);
    assertStableId(record.changeId, `trajectory[${index}].changeId`);
    assertStableId(record.metricId, `trajectory[${index}].metricId`);
    if (changeIds.has(record.changeId)) {
      throw new EndgameMetricLedgerError("ENDGAME_METRIC_TRAJECTORY_DUPLICATE", "Trajectory contains duplicate changeId.", {
        changeId: record.changeId
      });
    }
    changeIds.add(record.changeId);
    const definition = definitions.get(record.metricId);
    if (!definition) {
      throw new EndgameMetricLedgerError("ENDGAME_METRIC_TRAJECTORY_UNKNOWN_METRIC", "Trajectory references an unknown metric.", {
        metricId: record.metricId
      });
    }
    for (const key of ["before", "requestedDelta", "delta", "after"]) assertFinite(record[key], `trajectory[${index}].${key}`);
    if (record.before !== metrics[record.metricId]) {
      throw new EndgameMetricLedgerError("ENDGAME_METRIC_TRAJECTORY_BEFORE_MISMATCH", "Trajectory before value is not replayable.", {
        index,
        metricId: record.metricId
      });
    }
    if (normalizeNegativeZero(record.after - record.before) !== normalizeNegativeZero(record.delta)) {
      throw new EndgameMetricLedgerError("ENDGAME_METRIC_TRAJECTORY_DELTA_MISMATCH", "Trajectory delta must equal after - before.");
    }
    if (!record.clamped && normalizeNegativeZero(record.requestedDelta) !== normalizeNegativeZero(record.delta)) {
      throw new EndgameMetricLedgerError("ENDGAME_METRIC_TRAJECTORY_REQUEST_MISMATCH", "Unclamped records must preserve the requested delta.");
    }
    if (Math.abs(record.requestedDelta) > definition.changePolicy.maxAbsoluteDeltaPerSettlement) {
      throw new EndgameMetricLedgerError("ENDGAME_METRIC_TRAJECTORY_DELTA_LIMIT", "Trajectory exceeds the package delta limit.");
    }
    if (record.after < definition.min || record.after > definition.max) {
      throw new EndgameMetricLedgerError("ENDGAME_METRIC_TRAJECTORY_RANGE", "Trajectory value leaves the package range.");
    }
    if (typeof record.clamped !== "boolean" || !Number.isInteger(record.stageIndex) || record.stageIndex < 0) {
      throw new EndgameMetricLedgerError("ENDGAME_METRIC_TRAJECTORY_METADATA_INVALID", "Trajectory metadata is invalid.");
    }
    if (record.sourceActionId !== null) assertStableId(record.sourceActionId, `trajectory[${index}].sourceActionId`);
    if (!Array.isArray(record.sourceFactIds) || new Set(record.sourceFactIds).size !== record.sourceFactIds.length) {
      throw new EndgameMetricLedgerError("ENDGAME_METRIC_TRAJECTORY_FACTS_INVALID", "Trajectory sourceFactIds must be unique.");
    }
    if (!Number.isInteger(record.committedRevision) || record.committedRevision < 1) {
      throw new EndgameMetricLedgerError("ENDGAME_METRIC_TRAJECTORY_REVISION_INVALID", "Trajectory revision must be positive.");
    }
    if (record.committedRevision < previousRevision || record.committedRevision > previousRevision + 1) {
      throw new EndgameMetricLedgerError("ENDGAME_METRIC_TRAJECTORY_ORDER_INVALID", "Trajectory revisions must be stable and contiguous.");
    }
    const knownRevision = submissionRevisions.get(record.submissionId);
    if (knownRevision !== undefined && knownRevision !== record.committedRevision) {
      throw new EndgameMetricLedgerError("ENDGAME_METRIC_SUBMISSION_REVISION_CONFLICT", "One submissionId cannot span revisions.");
    }
    submissionRevisions.set(record.submissionId, record.committedRevision);
    previousRevision = record.committedRevision;
    highestRevision = Math.max(highestRevision, record.committedRevision);
    metrics[record.metricId] = record.after;
  }
  const revisions = [...new Set(submissionRevisions.values())].sort((left, right) => left - right);
  if (revisions.some((revision, index) => revision !== index + 1)) {
    throw new EndgameMetricLedgerError("ENDGAME_METRIC_TRAJECTORY_REVISION_GAP", "Committed revisions must be contiguous.");
  }
  return { metrics: sortRecord(metrics), revision: highestRevision };
}

function assertExactObject(value, allowedKeys, label) {
  if (!isRecord(value)) {
    throw new EndgameMetricLedgerError("ENDGAME_METRIC_CLOSED_OBJECT_REQUIRED", `${label} must be an object.`);
  }
  const unknown = Object.keys(value).filter((key) => !allowedKeys.includes(key));
  const missing = allowedKeys.filter((key) => !(key in value));
  if (unknown.length > 0 || missing.length > 0) {
    throw new EndgameMetricLedgerError("ENDGAME_METRIC_CLOSED_OBJECT_VIOLATION", `${label} has unknown or missing fields.`, {
      unknown,
      missing
    });
  }
}

function assertStableId(value, label) {
  if (typeof value !== "string" || !ID_PATTERN.test(value) || FORBIDDEN_RECORD_KEYS.has(value)) {
    throw new EndgameMetricLedgerError("ENDGAME_METRIC_ID_INVALID", `${label} must be a stable identifier.`);
  }
}

function assertFinite(value, label) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new EndgameMetricLedgerError("ENDGAME_METRIC_NON_FINITE", `${label} must be finite.`);
  }
}

function sortRecord(record) {
  return Object.fromEntries(Object.entries(record).sort(([left], [right]) => compareText(left, right)));
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function normalizeNegativeZero(value) {
  return Object.is(value, -0) ? 0 : value;
}

function sha256Hex(value) {
  return createHash("sha256").update(Buffer.from(value, "utf8")).digest("hex");
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function deepFreeze(value) {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}
