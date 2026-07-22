import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { prettyJson } from "../canonical";
import { validateGeneratedFiles } from "../evidence-validator";
import { openovelPaths } from "../paths";

const paths = openovelPaths();
const report = validateGeneratedFiles(paths.repoRoot);
mkdirSync(paths.outputRoot, { recursive: true });
writeFileSync(join(paths.outputRoot, "evidence-validation.json"), prettyJson(report), "utf8");
console.log(`${report.valid ? "EVIDENCE_VALIDATION_PASS" : "EVIDENCE_VALIDATION_FAIL"} package=${report.packageId} issues=${report.issues.length}`);
if (!report.valid) process.exitCode = 1;
