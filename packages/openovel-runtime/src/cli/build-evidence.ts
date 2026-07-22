import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { prettyJson } from "../canonical";
import { compileEvidencePackage, writeEvidencePackage } from "../evidence-compiler";
import { validateEvidencePackage } from "../evidence-validator";
import { openovelPaths } from "../paths";

const paths = openovelPaths();
const evidencePackage = compileEvidencePackage(paths.repoRoot);
const report = validateEvidencePackage(evidencePackage, paths.repoRoot);
if (!report.valid) {
  console.error(prettyJson(report));
  process.exitCode = 1;
} else {
  writeEvidencePackage(evidencePackage, paths.repoRoot);
  mkdirSync(paths.outputRoot, { recursive: true });
  writeFileSync(join(paths.outputRoot, "evidence-validation.json"), prettyJson(report), "utf8");
  console.log(`EVIDENCE_BUILD_PASS package=${report.packageId} claims=${evidencePackage.claims.length} scenes=${evidencePackage.scenes.length} source=${report.sourceSha256}`);
}
