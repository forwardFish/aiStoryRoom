#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { MANUAL_ANNOTATIONS } from "./manual-annotations.mjs";

const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const path = resolve(root, "p00-historical-blockers.sanitized.json");
const corpus = JSON.parse(await readFile(path, "utf8"));
const corpusIds = corpus.records.map((record) => record.auditId).sort();
const annotationIds = Object.keys(MANUAL_ANNOTATIONS).sort();
if (JSON.stringify(corpusIds) !== JSON.stringify(annotationIds)) throw new Error("Manual annotation IDs do not exactly cover the corpus");
for (const record of corpus.records) {
  [record.humanClassification, record.classificationRationale] = MANUAL_ANNOTATIONS[record.auditId];
}
await writeFile(path, `${JSON.stringify(corpus, null, 2)}\n`);
console.log(`Applied ${corpus.records.length} manual P00 annotations`);
