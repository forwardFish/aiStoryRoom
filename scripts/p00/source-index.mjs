import { readFile } from "node:fs/promises";
import { BASELINE_SHA } from "./corpus.mjs";

export const SOURCE_INDEX_SCHEMA = "p00-sanitized-source-index-v1";
export const SOURCE_COUNT_KEYS = ["runDirectories", "shadowAuditFiles", "auditRecords", "blockingRecords"];

export async function loadSourceIndex(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

export function calculateSourceCounts(sourceIndex) {
  const runs = Array.isArray(sourceIndex?.runs) ? sourceIndex.runs : [];
  return {
    runDirectories: runs.length,
    shadowAuditFiles: runs.filter((run) => run.hasShadowAudit === true).length,
    auditRecords: runs.reduce((sum, run) => sum + (Number.isInteger(run.auditRecordCount) ? run.auditRecordCount : 0), 0),
    blockingRecords: runs.reduce((sum, run) => sum + (Number.isInteger(run.blockingRecordCount) ? run.blockingRecordCount : 0), 0),
  };
}

export function validateSourceIndex(sourceIndex, corpus) {
  const errors = [];
  if (!sourceIndex || typeof sourceIndex !== "object" || Array.isArray(sourceIndex)) errors.push("source index must be an object");
  if (sourceIndex?.schemaVersion !== SOURCE_INDEX_SCHEMA) errors.push(`source index schemaVersion must be ${SOURCE_INDEX_SCHEMA}`);
  if (sourceIndex?.baselineCommit !== BASELINE_SHA) errors.push(`source index baselineCommit must be ${BASELINE_SHA}`);
  if (!Array.isArray(sourceIndex?.runs)) errors.push("source index runs must be an array");
  const refs = new Set();
  for (const [index, run] of (sourceIndex?.runs ?? []).entries()) {
    const at = `runs[${index}]`;
    if (typeof run?.runRef !== "string" || !/^[a-f0-9]{16}$/.test(run.runRef)) errors.push(`${at}.runRef is invalid`);
    if (refs.has(run?.runRef)) errors.push(`${at}.runRef is duplicated`);
    refs.add(run?.runRef);
    if (typeof run?.hasShadowAudit !== "boolean") errors.push(`${at}.hasShadowAudit must be boolean`);
    for (const field of ["auditRecordCount", "blockingRecordCount"]) {
      if (!Number.isInteger(run?.[field]) || run[field] < 0) errors.push(`${at}.${field} must be a non-negative integer`);
    }
    if (Number.isInteger(run?.blockingRecordCount) && Number.isInteger(run?.auditRecordCount)
      && run.blockingRecordCount > run.auditRecordCount) errors.push(`${at}.blockingRecordCount exceeds auditRecordCount`);
    if (run?.hasShadowAudit === false) {
      if (run.auditFileSha256 !== null) errors.push(`${at}.auditFileSha256 must be null without an audit`);
      if (run.auditRecordCount !== 0 || run.blockingRecordCount !== 0) errors.push(`${at} counts must be zero without an audit`);
    } else if (run?.hasShadowAudit === true && (typeof run.auditFileSha256 !== "string" || !/^[a-f0-9]{64}$/.test(run.auditFileSha256))) {
      errors.push(`${at}.auditFileSha256 must be a complete SHA-256 with an audit`);
    }
  }
  const calculated = calculateSourceCounts(sourceIndex);
  for (const key of SOURCE_COUNT_KEYS) {
    if (sourceIndex?.counts?.[key] !== calculated[key]) errors.push(`source index counts.${key} does not match calculated value ${calculated[key]}`);
    if (corpus?.counts?.[key] !== calculated[key]) errors.push(`corpus counts.${key} does not match source index calculated value ${calculated[key]}`);
  }
  if (corpus && calculated.blockingRecords !== corpus.records?.length) {
    errors.push(`source index blockingRecords ${calculated.blockingRecords} does not match corpus records length ${corpus.records?.length}`);
  }
  return errors;
}
