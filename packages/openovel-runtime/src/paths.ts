import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

export function findRepoRoot(start = process.cwd()): string {
  let current = resolve(start);
  while (true) {
    const packagePath = join(current, "package.json");
    if (existsSync(packagePath)) {
      // Avoid importing the JSON so this helper works from both CommonJS and tsx.
      const pnpmWorkspacePath = join(current, "pnpm-workspace.yaml");
      if (existsSync(pnpmWorkspacePath)) return current;
    }
    const parent = dirname(current);
    if (parent === current) throw new Error(`Could not find repository root from ${start}`);
    current = parent;
  }
}

export function openovelPaths(repoRoot = findRepoRoot()) {
  const packageRoot = join(repoRoot, "packages", "openovel-runtime");
  const generatedRoot = join(packageRoot, "generated", "source-evidence");
  return {
    repoRoot,
    packageRoot,
    authoringSchemaPath: join(packageRoot, "schemas", "evidence-authoring.schema.json"),
    reviewSchemaPath: join(packageRoot, "schemas", "evidence-review.schema.json"),
    worldBibleAuthoringSchemaPath: join(packageRoot, "schemas", "world-bible-authoring.schema.json"),
    authoringPath: join(packageRoot, "data", "sangtian", "evidence-authoring.json"),
    worldBibleAuthoringPath: join(packageRoot, "data", "sangtian", "world-bible-authoring.json"),
    reviewQueuePath: join(packageRoot, "reviews", "sangtian-evidence-review.json"),
    fixturePath: join(packageRoot, "data", "sangtian", "runtime-shadow-fixture.json"),
    generatedRoot,
    manifestPath: join(generatedRoot, "manifest.json"),
    chapterIndexPath: join(generatedRoot, "chapter-index.json"),
    scenesPath: join(generatedRoot, "scenes.json"),
    claimsPath: join(generatedRoot, "claims.jsonl"),
    continuityPath: join(generatedRoot, "continuity.json"),
    worldBibleRoot: join(packageRoot, "generated", "world-bible"),
    worldBiblePath: join(packageRoot, "generated", "world-bible", "world-bible.json"),
    worldBibleSourceMapPath: join(packageRoot, "generated", "world-bible", "source-map.json"),
    outputRoot: join(repoRoot, "outputs", "openovel-runtime")
  };
}
