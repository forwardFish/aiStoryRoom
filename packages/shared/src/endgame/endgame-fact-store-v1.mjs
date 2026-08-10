import { createHash } from "node:crypto";
import {
  canonicalizeJcs,
  DELAYED_EVENT_STATUSES
} from "./endgame-package-v1.contract.mjs";
import { resolveFrozenEndgamePackageForRunV1 } from "./endgame-package-loader-v1.mjs";

export const ENDGAME_FACT_SCHEMA_VERSION = "endgame_fact_v1";
export const ENDGAME_FACT_STORE_SCHEMA_VERSION = "endgame_fact_store_v1";
export const ENDGAME_FACT_COMMIT_SCHEMA_VERSION = "endgame_fact_commit_v1";

export const ENDGAME_FACT_SOURCE_TYPES = Object.freeze([
  "PLAYER_ACTION",
  "METRIC_CHANGE",
  "CAUSAL_EVENT",
  "RELATIONSHIP_CHANGE",
  "PROMISE",
  "RESOURCE_CHANGE",
  "RIGHT_CHANGE",
  "DELAYED_EVENT",
  "CANON_FACT"
]);
export const ENDGAME_FACT_CATEGORIES = Object.freeze([
  "ACTION",
  "ACHIEVEMENT",
  "COST",
  "RELATIONSHIP",
  "OBLIGATION",
  "ASSET",
  "RIGHT",
  "PUBLIC_AFTERMATH",
  "POLITICAL_AFTERMATH",
  "POLICY_AFTERMATH",
  "SCENE_ANCHOR",
  "UNRESOLVED_HOOK",
  "CUSTOM"
]);
export const ENDGAME_FACT_POLARITIES = Object.freeze(["POSITIVE", "NEGATIVE", "MIXED", "NEUTRAL"]);
export const ENDGAME_FACT_VISIBILITIES = Object.freeze(["PLAYER", "PUBLIC", "PRIVATE_OTHER", "INTERNAL"]);

const FACT_KEYS = Object.freeze([
  "schemaVersion",
  "factId",
  "sourceType",
  "category",
  "title",
  "text",
  "tags",
  "polarity",
  "status",
  "magnitude",
  "actorIds",
  "targetIds",
  "locationIds",
  "objectIds",
  "metricImpacts",
  "visibility",
  "stageIndex",
  "sourceActionId",
  "sourceRevision"
]);
const METRIC_IMPACT_KEYS = Object.freeze(["metricId", "delta"]);
const STORE_KEYS = Object.freeze(["schemaVersion", "runId", "packageRef", "revision", "facts", "commits"]);
const PACKAGE_REF_KEYS = Object.freeze(["policyId", "policyVersion", "packageHash"]);
const COMMIT_KEYS = Object.freeze([
  "schemaVersion",
  "submissionId",
  "sourceRevision",
  "factIds",
  "requestHash",
  "committedRevision"
]);
const COMMIT_REQUEST_KEYS = Object.freeze([
  "runPackageBinding",
  "factStore",
  "submissionId",
  "expectedRevision",
  "sourceRevision",
  "facts"
]);
const COLLECT_KEYS = Object.freeze(["runPackageBinding", "factStore", "visibility"]);
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/u;
const HASH_PATTERN = /^[0-9a-f]{64}$/u;
const FORBIDDEN_RECORD_KEYS = new Set(["__proto__", "prototype", "constructor"]);

export class EndgameFactStoreError extends Error {
  constructor(code, message, details = {}) {
    super(`${code}: ${message}`);
    this.name = "EndgameFactStoreError";
    this.code = code;
    this.details = deepFreeze(structuredClone(details));
  }
}

export function createEndgameFactStoreV1(runPackageBinding) {
  resolveFrozenEndgamePackageForRunV1(runPackageBinding);
  return deepFreeze({
    schemaVersion: ENDGAME_FACT_STORE_SCHEMA_VERSION,
    runId: runPackageBinding.runId,
    packageRef: structuredClone(runPackageBinding.packageRef),
    revision: 0,
    facts: [],
    commits: []
  });
}

export function normalizeEndgameFactV1(runPackageBinding, fact) {
  const snapshot = resolveFrozenEndgamePackageForRunV1(runPackageBinding);
  assertExactObject(fact, FACT_KEYS, "fact");
  if (fact.schemaVersion !== ENDGAME_FACT_SCHEMA_VERSION) {
    throw new EndgameFactStoreError("ENDGAME_FACT_VERSION_UNSUPPORTED", "Unknown EndgameFact version.");
  }
  assertStableId(fact.factId, "fact.factId");
  assertEnum(fact.sourceType, ENDGAME_FACT_SOURCE_TYPES, "fact.sourceType", "ENDGAME_FACT_SOURCE_TYPE_INVALID");
  assertEnum(fact.category, ENDGAME_FACT_CATEGORIES, "fact.category", "ENDGAME_FACT_CATEGORY_INVALID");
  assertText(fact.title, "fact.title", 1, 500);
  assertText(fact.text, "fact.text", 1, 4000);
  const tags = normalizeStringArray(fact.tags, "fact.tags", { stableIds: false, maxItems: 128 });
  assertEnum(fact.polarity, ENDGAME_FACT_POLARITIES, "fact.polarity", "ENDGAME_FACT_POLARITY_INVALID");
  assertEnum(fact.status, DELAYED_EVENT_STATUSES, "fact.status", "ENDGAME_FACT_STATUS_INVALID");
  assertFinite(fact.magnitude, "fact.magnitude");
  if (fact.magnitude < 0) {
    throw new EndgameFactStoreError("ENDGAME_FACT_MAGNITUDE_INVALID", "Fact magnitude must be non-negative.");
  }
  const actorIds = normalizeStringArray(fact.actorIds, "fact.actorIds", { stableIds: true, maxItems: 64 });
  const targetIds = normalizeStringArray(fact.targetIds, "fact.targetIds", { stableIds: true, maxItems: 64 });
  const locationIds = normalizeStringArray(fact.locationIds, "fact.locationIds", { stableIds: true, maxItems: 64 });
  const objectIds = normalizeStringArray(fact.objectIds, "fact.objectIds", { stableIds: true, maxItems: 64 });
  assertEnum(fact.visibility, ENDGAME_FACT_VISIBILITIES, "fact.visibility", "ENDGAME_FACT_VISIBILITY_INVALID");
  if (fact.stageIndex !== null && (!Number.isInteger(fact.stageIndex) || fact.stageIndex < 0)) {
    throw new EndgameFactStoreError("ENDGAME_FACT_STAGE_INVALID", "stageIndex must be null or a non-negative integer.");
  }
  if (fact.sourceActionId !== null) assertStableId(fact.sourceActionId, "fact.sourceActionId");
  if (fact.sourceType === "PLAYER_ACTION" && fact.sourceActionId === null) {
    throw new EndgameFactStoreError(
      "ENDGAME_FACT_ACTION_SOURCE_REQUIRED",
      "PLAYER_ACTION facts require sourceActionId."
    );
  }
  if (!Number.isInteger(fact.sourceRevision) || fact.sourceRevision < 0) {
    throw new EndgameFactStoreError("ENDGAME_FACT_SOURCE_REVISION_INVALID", "sourceRevision must be a non-negative integer.");
  }

  if (!Array.isArray(fact.metricImpacts) || fact.metricImpacts.length > 64) {
    throw new EndgameFactStoreError("ENDGAME_FACT_METRIC_IMPACTS_INVALID", "metricImpacts must be an array of at most 64 items.");
  }
  const knownMetricIds = new Set(snapshot.packageDocument.metrics.map((definition) => definition.metricId));
  const metricIds = new Set();
  const metricImpacts = fact.metricImpacts.map((impact, index) => {
    assertExactObject(impact, METRIC_IMPACT_KEYS, `fact.metricImpacts[${index}]`);
    assertStableId(impact.metricId, `fact.metricImpacts[${index}].metricId`);
    if (!knownMetricIds.has(impact.metricId)) {
      throw new EndgameFactStoreError(
        "ENDGAME_FACT_METRIC_UNKNOWN",
        "metricImpacts may reference only package-defined base metrics.",
        { metricId: impact.metricId }
      );
    }
    if (metricIds.has(impact.metricId)) {
      throw new EndgameFactStoreError(
        "ENDGAME_FACT_METRIC_DUPLICATE",
        "A fact must aggregate each metric into one impact.",
        { metricId: impact.metricId }
      );
    }
    metricIds.add(impact.metricId);
    assertFinite(impact.delta, `fact.metricImpacts[${index}].delta`);
    return { metricId: impact.metricId, delta: normalizeNegativeZero(impact.delta) };
  }).sort((left, right) => compareText(left.metricId, right.metricId));

  return deepFreeze({
    schemaVersion: ENDGAME_FACT_SCHEMA_VERSION,
    factId: fact.factId,
    sourceType: fact.sourceType,
    category: fact.category,
    title: fact.title,
    text: fact.text,
    tags,
    polarity: fact.polarity,
    status: fact.status,
    magnitude: normalizeNegativeZero(fact.magnitude),
    actorIds,
    targetIds,
    locationIds,
    objectIds,
    metricImpacts,
    visibility: fact.visibility,
    stageIndex: fact.stageIndex,
    sourceActionId: fact.sourceActionId,
    sourceRevision: fact.sourceRevision
  });
}

export function commitEndgameFactsV1(request) {
  assertAllowedObject(request, COMMIT_REQUEST_KEYS, COMMIT_REQUEST_KEYS, "fact commit request");
  const {
    runPackageBinding,
    factStore,
    submissionId,
    expectedRevision,
    sourceRevision,
    facts
  } = request;
  assertEndgameFactStoreV1(runPackageBinding, factStore);
  assertStableId(submissionId, "submissionId");
  if (!Number.isInteger(sourceRevision) || sourceRevision < 0) {
    throw new EndgameFactStoreError("ENDGAME_FACT_COMMIT_SOURCE_REVISION_INVALID", "sourceRevision must be a non-negative integer.");
  }
  if (!Array.isArray(facts) || facts.length < 1 || facts.length > 256) {
    throw new EndgameFactStoreError("ENDGAME_FACT_COMMIT_FACTS_INVALID", "A fact commit must contain 1..256 facts.");
  }
  const normalizedFacts = facts
    .map((fact) => normalizeEndgameFactV1(runPackageBinding, fact))
    .sort(compareFacts);
  const batchIds = normalizedFacts.map((fact) => fact.factId).sort(compareText);
  if (new Set(batchIds).size !== batchIds.length) {
    throw new EndgameFactStoreError("ENDGAME_FACT_COMMIT_DUPLICATE_ID", "One fact commit cannot repeat factId.");
  }
  for (const fact of normalizedFacts) {
    if (fact.sourceRevision !== sourceRevision) {
      throw new EndgameFactStoreError(
        "ENDGAME_FACT_COMMIT_REVISION_MISMATCH",
        "Every fact in a commit must use the commit sourceRevision.",
        { factId: fact.factId, factSourceRevision: fact.sourceRevision, sourceRevision }
      );
    }
  }
  const requestHash = computeCommitHash({ submissionId, sourceRevision, facts: normalizedFacts });
  const existing = factStore.commits.find((commit) => commit.submissionId === submissionId);
  if (existing) {
    if (existing.requestHash !== requestHash) {
      throw new EndgameFactStoreError(
        "ENDGAME_FACT_IDEMPOTENCY_CONFLICT",
        "The same submissionId cannot be reused for different facts.",
        { submissionId }
      );
    }
    return deepFreeze({ factStore, committed: false, idempotent: true, facts: [] });
  }
  if (!Number.isInteger(expectedRevision) || expectedRevision !== factStore.revision) {
    throw new EndgameFactStoreError(
      "ENDGAME_FACT_REVISION_CONFLICT",
      "expectedRevision does not match the durable fact store.",
      { expectedRevision, actualRevision: factStore.revision }
    );
  }
  const lastSourceRevision = factStore.commits.at(-1)?.sourceRevision ?? -1;
  if (sourceRevision < lastSourceRevision) {
    throw new EndgameFactStoreError(
      "ENDGAME_FACT_SOURCE_REVISION_REGRESSION",
      "Fact commits must not move backward in sourceRevision.",
      { sourceRevision, lastSourceRevision }
    );
  }
  const existingIds = new Set(factStore.facts.map((fact) => fact.factId));
  const duplicate = normalizedFacts.find((fact) => existingIds.has(fact.factId));
  if (duplicate) {
    throw new EndgameFactStoreError(
      "ENDGAME_FACT_ID_REUSED",
      "factId must be globally unique within a run.",
      { factId: duplicate.factId }
    );
  }

  const committedRevision = factStore.revision + 1;
  const commit = deepFreeze({
    schemaVersion: ENDGAME_FACT_COMMIT_SCHEMA_VERSION,
    submissionId,
    sourceRevision,
    factIds: batchIds,
    requestHash,
    committedRevision
  });
  const nextStore = deepFreeze({
    schemaVersion: ENDGAME_FACT_STORE_SCHEMA_VERSION,
    runId: factStore.runId,
    packageRef: structuredClone(factStore.packageRef),
    revision: committedRevision,
    facts: [...factStore.facts, ...normalizedFacts].sort(compareFacts),
    commits: [...factStore.commits, commit]
  });
  assertEndgameFactStoreV1(runPackageBinding, nextStore);
  return deepFreeze({ factStore: nextStore, committed: true, idempotent: false, facts: normalizedFacts });
}

export function assertEndgameFactStoreV1(runPackageBinding, factStore) {
  resolveFrozenEndgamePackageForRunV1(runPackageBinding);
  assertExactObject(factStore, STORE_KEYS, "factStore");
  if (factStore.schemaVersion !== ENDGAME_FACT_STORE_SCHEMA_VERSION) {
    throw new EndgameFactStoreError("ENDGAME_FACT_STORE_VERSION_UNSUPPORTED", "Unknown fact store version.");
  }
  if (factStore.runId !== runPackageBinding.runId) {
    throw new EndgameFactStoreError("ENDGAME_FACT_STORE_RUN_MISMATCH", "Fact store belongs to a different run.");
  }
  assertExactObject(factStore.packageRef, PACKAGE_REF_KEYS, "factStore.packageRef");
  if (canonicalizeJcs(factStore.packageRef) !== canonicalizeJcs(runPackageBinding.packageRef)) {
    throw new EndgameFactStoreError("ENDGAME_FACT_STORE_PACKAGE_MISMATCH", "Fact store packageRef does not match the frozen run package.");
  }
  if (!Number.isInteger(factStore.revision) || factStore.revision < 0) {
    throw new EndgameFactStoreError("ENDGAME_FACT_STORE_REVISION_INVALID", "Fact store revision must be non-negative.");
  }
  if (!Array.isArray(factStore.facts) || !Array.isArray(factStore.commits)) {
    throw new EndgameFactStoreError("ENDGAME_FACT_STORE_COLLECTIONS_INVALID", "Fact store collections must be arrays.");
  }
  if (factStore.revision !== factStore.commits.length) {
    throw new EndgameFactStoreError("ENDGAME_FACT_STORE_COMMIT_COUNT_MISMATCH", "Fact store revision must equal the number of commits.");
  }

  const normalizedFacts = factStore.facts.map((fact) => normalizeEndgameFactV1(runPackageBinding, fact));
  if (canonicalizeJcs(normalizedFacts) !== canonicalizeJcs(factStore.facts)) {
    throw new EndgameFactStoreError("ENDGAME_FACT_STORE_FACTS_NOT_NORMALIZED", "Stored facts must use canonical normalized array ordering.");
  }
  const factsById = new Map();
  for (const fact of normalizedFacts) {
    if (factsById.has(fact.factId)) {
      throw new EndgameFactStoreError("ENDGAME_FACT_STORE_DUPLICATE_ID", "Stored factIds must be unique.", { factId: fact.factId });
    }
    factsById.set(fact.factId, fact);
  }
  const sortedFacts = [...normalizedFacts].sort(compareFacts);
  if (canonicalizeJcs(sortedFacts) !== canonicalizeJcs(normalizedFacts)) {
    throw new EndgameFactStoreError("ENDGAME_FACT_STORE_ORDER_INVALID", "Stored facts must use stable sourceRevision/factId ordering.");
  }

  const submissionIds = new Set();
  const committedFactIds = new Set();
  let previousSourceRevision = -1;
  for (const [index, commit] of factStore.commits.entries()) {
    assertExactObject(commit, COMMIT_KEYS, `factStore.commits[${index}]`);
    if (commit.schemaVersion !== ENDGAME_FACT_COMMIT_SCHEMA_VERSION) {
      throw new EndgameFactStoreError("ENDGAME_FACT_COMMIT_VERSION_UNSUPPORTED", "Unknown fact commit version.");
    }
    assertStableId(commit.submissionId, `factStore.commits[${index}].submissionId`);
    if (submissionIds.has(commit.submissionId)) {
      throw new EndgameFactStoreError("ENDGAME_FACT_COMMIT_SUBMISSION_DUPLICATE", "submissionId must be unique.");
    }
    submissionIds.add(commit.submissionId);
    if (!Number.isInteger(commit.sourceRevision) || commit.sourceRevision < previousSourceRevision) {
      throw new EndgameFactStoreError("ENDGAME_FACT_COMMIT_SOURCE_ORDER_INVALID", "Commit sourceRevision must be non-decreasing.");
    }
    previousSourceRevision = commit.sourceRevision;
    if (commit.committedRevision !== index + 1) {
      throw new EndgameFactStoreError("ENDGAME_FACT_COMMIT_ORDER_INVALID", "committedRevision must be contiguous.");
    }
    if (!Array.isArray(commit.factIds) || commit.factIds.length < 1 || new Set(commit.factIds).size !== commit.factIds.length) {
      throw new EndgameFactStoreError("ENDGAME_FACT_COMMIT_FACT_IDS_INVALID", "Commit factIds must be a non-empty unique array.");
    }
    const sortedFactIds = [...commit.factIds].sort(compareText);
    if (canonicalizeJcs(sortedFactIds) !== canonicalizeJcs(commit.factIds)) {
      throw new EndgameFactStoreError("ENDGAME_FACT_COMMIT_FACT_IDS_ORDER_INVALID", "Commit factIds must be sorted.");
    }
    if (typeof commit.requestHash !== "string" || !HASH_PATTERN.test(commit.requestHash)) {
      throw new EndgameFactStoreError("ENDGAME_FACT_COMMIT_HASH_INVALID", "requestHash must be lowercase SHA-256 hex.");
    }
    const commitFacts = commit.factIds.map((factId) => {
      assertStableId(factId, `factStore.commits[${index}].factIds`);
      if (committedFactIds.has(factId)) {
        throw new EndgameFactStoreError("ENDGAME_FACT_COMMIT_FACT_REUSED", "A fact may belong to only one commit.", { factId });
      }
      committedFactIds.add(factId);
      const fact = factsById.get(factId);
      if (!fact) {
        throw new EndgameFactStoreError("ENDGAME_FACT_COMMIT_FACT_MISSING", "Commit references a missing fact.", { factId });
      }
      if (fact.sourceRevision !== commit.sourceRevision) {
        throw new EndgameFactStoreError("ENDGAME_FACT_COMMIT_SOURCE_MISMATCH", "Committed fact sourceRevision does not match its commit.", {
          factId
        });
      }
      return fact;
    }).sort(compareFacts);
    const computedHash = computeCommitHash({
      submissionId: commit.submissionId,
      sourceRevision: commit.sourceRevision,
      facts: commitFacts
    });
    if (computedHash !== commit.requestHash) {
      throw new EndgameFactStoreError("ENDGAME_FACT_COMMIT_HASH_MISMATCH", "Commit hash does not match committed facts.", {
        submissionId: commit.submissionId
      });
    }
  }
  if (committedFactIds.size !== factsById.size) {
    throw new EndgameFactStoreError("ENDGAME_FACT_STORE_UNCOMMITTED_FACT", "Every stored fact must belong to exactly one durable commit.");
  }
  return factStore;
}

export function collectCommittedEndgameFactsV1(request) {
  assertAllowedObject(request, COLLECT_KEYS, ["runPackageBinding", "factStore"], "fact collector request");
  const { runPackageBinding, factStore, visibility = null } = request;
  assertEndgameFactStoreV1(runPackageBinding, factStore);
  if (visibility !== null) {
    if (!Array.isArray(visibility) || visibility.length < 1 || new Set(visibility).size !== visibility.length) {
      throw new EndgameFactStoreError("ENDGAME_FACT_COLLECT_VISIBILITY_INVALID", "visibility must be null or a unique non-empty array.");
    }
    for (const item of visibility) assertEnum(item, ENDGAME_FACT_VISIBILITIES, "visibility", "ENDGAME_FACT_VISIBILITY_INVALID");
  }
  const allowed = visibility === null ? null : new Set(visibility);
  return deepFreeze(factStore.facts.filter((fact) => allowed === null || allowed.has(fact.visibility)).map((fact) => fact));
}

function computeCommitHash({ submissionId, sourceRevision, facts }) {
  return createHash("sha256")
    .update(Buffer.from(canonicalizeJcs({ submissionId, sourceRevision, facts }), "utf8"))
    .digest("hex");
}

function compareFacts(left, right) {
  return left.sourceRevision - right.sourceRevision
    || (left.stageIndex ?? -1) - (right.stageIndex ?? -1)
    || compareText(left.factId, right.factId);
}

function normalizeStringArray(value, label, { stableIds, maxItems }) {
  if (!Array.isArray(value) || value.length > maxItems || new Set(value).size !== value.length) {
    throw new EndgameFactStoreError("ENDGAME_FACT_STRING_ARRAY_INVALID", `${label} must be a unique array of at most ${maxItems} strings.`);
  }
  const normalized = value.map((item, index) => {
    if (stableIds) assertStableId(item, `${label}[${index}]`);
    else assertText(item, `${label}[${index}]`, 1, 128);
    return item;
  }).sort(compareText);
  return Object.freeze(normalized);
}

function assertExactObject(value, allowedKeys, label) {
  assertAllowedObject(value, allowedKeys, allowedKeys, label);
}

function assertAllowedObject(value, allowedKeys, requiredKeys, label) {
  if (!isRecord(value)) {
    throw new EndgameFactStoreError("ENDGAME_FACT_CLOSED_OBJECT_REQUIRED", `${label} must be an object.`);
  }
  const unknown = Object.keys(value).filter((key) => !allowedKeys.includes(key));
  const missing = requiredKeys.filter((key) => !(key in value));
  if (unknown.length > 0 || missing.length > 0) {
    throw new EndgameFactStoreError("ENDGAME_FACT_CLOSED_OBJECT_VIOLATION", `${label} has unknown or missing fields.`, {
      unknown,
      missing
    });
  }
}

function assertStableId(value, label) {
  if (typeof value !== "string" || !ID_PATTERN.test(value) || FORBIDDEN_RECORD_KEYS.has(value)) {
    throw new EndgameFactStoreError("ENDGAME_FACT_ID_INVALID", `${label} must be a stable identifier.`);
  }
}

function assertText(value, label, minLength, maxLength) {
  if (typeof value !== "string" || value.length < minLength || value.length > maxLength || /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/u.test(value)) {
    throw new EndgameFactStoreError("ENDGAME_FACT_TEXT_INVALID", `${label} must be valid bounded text.`);
  }
}

function assertFinite(value, label) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new EndgameFactStoreError("ENDGAME_FACT_NON_FINITE", `${label} must be finite.`);
  }
}

function assertEnum(value, allowed, label, code) {
  if (!allowed.includes(value)) {
    throw new EndgameFactStoreError(code, `${label} is not allowed.`, { value });
  }
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function normalizeNegativeZero(value) {
  return Object.is(value, -0) ? 0 : value;
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function deepFreeze(value) {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}
