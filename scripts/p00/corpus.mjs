import { readFile } from "node:fs/promises";

export const BASELINE_SHA = "d5aff3096f901cc41ed4fd9c5e290855a46f480e";
export const CORPUS_SCHEMA = "p00-historical-blocker-corpus-v1";
export const CLASSIFICATIONS = ["REAL_P0", "FALSE_POSITIVE", "UNCERTAIN"];

const isStringArray = (value) => Array.isArray(value) && value.every((item) => typeof item === "string");

export async function loadCorpus(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

export function validateCorpus(corpus) {
  const errors = [];
  if (!corpus || typeof corpus !== "object" || Array.isArray(corpus)) errors.push("corpus must be an object");
  if (corpus?.schemaVersion !== CORPUS_SCHEMA) errors.push(`schemaVersion must be ${CORPUS_SCHEMA}`);
  if (corpus?.baselineCommit !== BASELINE_SHA) errors.push(`baselineCommit must be ${BASELINE_SHA}`);
  if (JSON.stringify(corpus?.allowedClassifications) !== JSON.stringify(CLASSIFICATIONS)) {
    errors.push("allowedClassifications must contain the stable P00 classification order");
  }
  for (const key of ["runDirectories", "shadowAuditFiles", "auditRecords", "blockingRecords"]) {
    if (!Number.isInteger(corpus?.counts?.[key]) || corpus.counts[key] < 0) errors.push(`counts.${key} must be a non-negative integer`);
  }
  if (!Array.isArray(corpus?.records)) errors.push("records must be an array");
  const ids = new Set();
  for (const [index, record] of (corpus?.records ?? []).entries()) {
    const at = `records[${index}]`;
    if (typeof record?.auditId !== "string" || !/^B\d{3}$/.test(record.auditId)) errors.push(`${at}.auditId is invalid`);
    if (ids.has(record?.auditId)) errors.push(`${at}.auditId is duplicated`);
    ids.add(record?.auditId);
    if (typeof record?.sourceRef !== "string" || !/^[a-f0-9]{16}$/.test(record.sourceRef)) errors.push(`${at}.sourceRef is invalid`);
    if (typeof record?.turnId !== "string" || !/^T\d{2}$/.test(record.turnId)) errors.push(`${at}.turnId is invalid`);
    if (!record?.auditFinding || typeof record.auditFinding !== "object") errors.push(`${at}.auditFinding is required`);
    for (const field of ["suspectedDurableConflicts", "authorityWarnings", "knowledgeWarnings", "sectionDriftWarnings"]) {
      if (!isStringArray(record?.auditFinding?.[field])) errors.push(`${at}.auditFinding.${field} must be a string array`);
    }
    if (!CLASSIFICATIONS.includes(record?.humanClassification)) errors.push(`${at}.humanClassification is invalid`);
    if (typeof record?.classificationRationale !== "string" || record.classificationRationale.trim().length < 12) {
      errors.push(`${at}.classificationRationale must contain an auditable reason of at least 12 characters`);
    }
    if (!record?.reviewEvidence || typeof record.reviewEvidence !== "object") {
      errors.push(`${at}.reviewEvidence is required`);
    }
    for (const field of ["excerpt", "speechAct", "assertedPredicate", "expectedPredicateEvidence"]) {
      if (typeof record?.reviewEvidence?.[field] !== "string" || record.reviewEvidence[field].trim().length < 4) {
        errors.push(`${at}.reviewEvidence.${field} must be a non-empty review field`);
      }
    }
  }
  if (corpus?.records?.length !== corpus?.counts?.blockingRecords) errors.push("records length must equal counts.blockingRecords");
  return errors;
}

export function filterRecords(records, filters = {}) {
  const keyword = filters.keyword?.toLocaleLowerCase("zh-CN");
  return [...records]
    .filter((record) => !filters.classification || record.humanClassification === filters.classification)
    .filter((record) => !filters.severity || record.auditFinding.severity === filters.severity)
    .filter((record) => !filters.turnId || record.turnId === filters.turnId)
    .filter((record) => !keyword || JSON.stringify(record).toLocaleLowerCase("zh-CN").includes(keyword))
    .sort((a, b) => a.auditId.localeCompare(b.auditId));
}

export function calculateStats(corpus, records = corpus.records) {
  const classifications = Object.fromEntries(CLASSIFICATIONS.map((key) => [key, 0]));
  const severity = {};
  const turnId = {};
  for (const record of records) {
    classifications[record.humanClassification] += 1;
    severity[record.auditFinding.severity] = (severity[record.auditFinding.severity] ?? 0) + 1;
    turnId[record.turnId] = (turnId[record.turnId] ?? 0) + 1;
  }
  return {
    source: { ...corpus.counts },
    selectedRecords: records.length,
    classifications,
    severity: Object.fromEntries(Object.entries(severity).sort()),
    turnId: Object.fromEntries(Object.entries(turnId).sort()),
  };
}
