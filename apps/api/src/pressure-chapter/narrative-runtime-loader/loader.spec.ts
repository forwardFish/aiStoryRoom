import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { createRequire } from "node:module";
import {
  PRESSURE_NARRATIVE_RUNTIME_LOADER_ERROR_CODES as ERROR,
  PressureNarrativeRuntimeLoaderError,
} from "./errors";
import { RequireBackedOpenNovelPressureNarrativeRuntimeLoaderV1 } from "./loader";

test("loader requires the public pressure-narrative subpath through declared CJS exports", async () => {
  const fixture = await createFixturePackage({
    exportsRecord: {
      "./package.json": "./package.json",
      "./pressure-narrative": {
        import: "./dist/pressure-narrative/index.js",
        require: "./dist-cjs/pressure-narrative/index.js",
      },
    },
    runtimeSource: `
      class OpenNovelNarrativeProjectorV1 {}
      class NarrativeRendererV1 {}
      class NarrativePublisherV1 {}
      function validateNarrativeProjectionJobV1(value) { return value; }
      function validateAudienceSafeNarrativeSourceV1(value) { return value; }
      module.exports = {
        OpenNovelNarrativeProjectorV1,
        NarrativeRendererV1,
        NarrativePublisherV1,
        validateNarrativeProjectionJobV1,
        validateAudienceSafeNarrativeSourceV1,
      };
    `,
  });

  try {
    const loader = new RequireBackedOpenNovelPressureNarrativeRuntimeLoaderV1({
      requireFn: fixture.requireFn,
    });
    const runtime = loader.load();

    assert.equal(typeof runtime.OpenNovelNarrativeProjectorV1, "function");
    assert.equal(typeof runtime.NarrativeRendererV1, "function");
    assert.equal(typeof runtime.NarrativePublisherV1, "function");
    assert.equal(typeof runtime.validateNarrativeProjectionJobV1, "function");
    assert.equal(typeof runtime.validateAudienceSafeNarrativeSourceV1, "function");
  } finally {
    await fs.rm(fixture.rootDir, { recursive: true, force: true });
  }
});

test("loader rejects malformed public exports before requiring the runtime subpath", async () => {
  const fixture = await createFixturePackage({
    exportsRecord: {
      "./package.json": "./package.json",
      "./pressure-narrative": {
        import: "./src/pressure-narrative/index.ts",
        require: "./dist-cjs/pressure-narrative/index.js",
      },
    },
    runtimeSource: "module.exports = {};",
  });

  try {
    const loader = new RequireBackedOpenNovelPressureNarrativeRuntimeLoaderV1({
      requireFn: fixture.requireFn,
    });
    await assert.rejects(
      async () => loader.load(),
      (error: unknown) =>
        error instanceof PressureNarrativeRuntimeLoaderError
        && error.code === ERROR.PACKAGE_EXPORTS_INVALID,
    );
  } finally {
    await fs.rm(fixture.rootDir, { recursive: true, force: true });
  }
});

async function createFixturePackage(input: {
  exportsRecord: Record<string, unknown>;
  runtimeSource: string;
}) {
  const rootDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "pressure-narrative-loader-"),
  );
  const packageRoot = path.join(
    rootDir,
    "node_modules",
    "@apps",
    "openovel-runtime",
  );
  await fs.mkdir(path.join(packageRoot, "dist-cjs", "pressure-narrative"), {
    recursive: true,
  });
  await fs.writeFile(
    path.join(packageRoot, "package.json"),
    `${JSON.stringify({
      name: "@apps/openovel-runtime",
      type: "module",
      exports: input.exportsRecord,
    }, null, 2)}\n`,
    "utf8",
  );
  await fs.writeFile(
    path.join(packageRoot, "dist-cjs", "pressure-narrative", "package.json"),
    `${JSON.stringify({ type: "commonjs" }, null, 2)}\n`,
    "utf8",
  );
  await fs.writeFile(
    path.join(packageRoot, "dist-cjs", "pressure-narrative", "index.js"),
    `${input.runtimeSource}\n`,
    "utf8",
  );
  await fs.writeFile(
    path.join(rootDir, "entry.cjs"),
    "module.exports = {};",
    "utf8",
  );
  return {
    rootDir,
    requireFn: createRequire(path.join(rootDir, "entry.cjs")),
  };
}
