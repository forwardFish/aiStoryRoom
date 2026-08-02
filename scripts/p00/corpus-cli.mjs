#!/usr/bin/env node
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { calculateStats, CLASSIFICATIONS, filterRecords, loadCorpus, validateCorpus } from "./corpus.mjs";

const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const args = process.argv.slice(2);
const value = (flag) => { const i = args.indexOf(flag); return i < 0 ? undefined : args[i + 1]; };
const unknown = args.filter((arg, index) => arg.startsWith("--") && !["--classification", "--severity", "--turn-id", "--keyword", "--stats", "--json"].includes(arg));
if (unknown.length) throw new Error(`Unknown option: ${unknown.join(", ")}`);

const corpus = await loadCorpus(resolve(root, "p00-historical-blockers.sanitized.json"));
const errors = validateCorpus(corpus);
if (errors.length) {
  console.error(JSON.stringify({ ok: false, errors }, null, 2));
  process.exitCode = 1;
} else {
  const filters = { classification: value("--classification"), severity: value("--severity"), turnId: value("--turn-id"), keyword: value("--keyword") };
  if (filters.classification && !CLASSIFICATIONS.includes(filters.classification)) throw new Error(`Invalid classification: ${filters.classification}`);
  const records = filterRecords(corpus.records, filters);
  const output = args.includes("--stats")
    ? calculateStats(corpus, records)
    : records.map(({ auditId, turnId, auditFinding, humanClassification, classificationRationale }) => ({ auditId, turnId, severity: auditFinding.severity, humanClassification, classificationRationale }));
  console.log(JSON.stringify(output, null, args.includes("--json") ? 0 : 2));
}
