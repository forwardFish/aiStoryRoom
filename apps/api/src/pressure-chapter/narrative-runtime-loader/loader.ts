import type {
  OpenNovelPressureNarrativePackageExportsV1,
  OpenNovelPressureNarrativeRequireLoaderPortV1,
  OpenNovelPressureNarrativeRuntimeModuleV1,
} from "./contracts";
import {
  PRESSURE_NARRATIVE_RUNTIME_LOADER_ERROR_CODES as ERROR,
  PressureNarrativeRuntimeLoaderError,
} from "./errors";

const DEFAULT_PACKAGE_NAME = "@apps/openovel-runtime";
const DEFAULT_SUBPATH = "./pressure-narrative" as const;
const DEFAULT_RUNTIME_ID = `${DEFAULT_PACKAGE_NAME}/pressure-narrative`;

export interface OpenNovelPressureNarrativeRequireLoaderOptionsV1 {
  packageName?: string;
  requireFn?: NodeRequire;
}

export class RequireBackedOpenNovelPressureNarrativeRuntimeLoaderV1
implements OpenNovelPressureNarrativeRequireLoaderPortV1 {
  private readonly packageName: string;
  private readonly requireFn: NodeRequire;

  constructor(options: OpenNovelPressureNarrativeRequireLoaderOptionsV1 = {}) {
    this.packageName = options.packageName ?? DEFAULT_PACKAGE_NAME;
    this.requireFn = options.requireFn ?? require;
  }

  load(): OpenNovelPressureNarrativeRuntimeModuleV1 {
    const exportsMap = readPressureNarrativeExportsV1(
      this.requireFn,
      this.packageName,
    );
    validatePressureNarrativeExportsV1(exportsMap, this.packageName);
    const moduleValue = this.requireFn(`${this.packageName}/pressure-narrative`);
    return validateOpenNovelPressureNarrativeRuntimeModuleV1(moduleValue);
  }
}

export function readPressureNarrativeExportsV1(
  requireFn: NodeRequire,
  packageName = DEFAULT_PACKAGE_NAME,
): OpenNovelPressureNarrativePackageExportsV1 {
  const manifest = requireFn(`${packageName}/package.json`) as Record<string, unknown>;
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    throw new PressureNarrativeRuntimeLoaderError(
      ERROR.PACKAGE_MANIFEST_INVALID,
      "OpenNovel runtime package manifest must be an object",
      { packageName },
    );
  }
  const exportsValue = manifest.exports;
  if (!exportsValue || typeof exportsValue !== "object" || Array.isArray(exportsValue)) {
    throw new PressureNarrativeRuntimeLoaderError(
      ERROR.PACKAGE_EXPORTS_INVALID,
      "OpenNovel runtime package must declare exports",
      { packageName },
    );
  }
  const subpath = (exportsValue as Record<string, unknown>)[DEFAULT_SUBPATH];
  if (!subpath || typeof subpath !== "object" || Array.isArray(subpath)) {
    throw new PressureNarrativeRuntimeLoaderError(
      ERROR.PACKAGE_EXPORTS_INVALID,
      "OpenNovel runtime package must export ./pressure-narrative",
      { packageName },
    );
  }
  const exportRecord = subpath as Record<string, unknown>;
  return {
    packageName,
    subpath: DEFAULT_SUBPATH,
    importTarget: requireText(exportRecord.import, "exports['./pressure-narrative'].import"),
    requireTarget: requireText(exportRecord.require, "exports['./pressure-narrative'].require"),
  };
}

export function validatePressureNarrativeExportsV1(
  value: OpenNovelPressureNarrativePackageExportsV1,
  expectedPackageName = DEFAULT_PACKAGE_NAME,
): OpenNovelPressureNarrativePackageExportsV1 {
  if (value.packageName !== expectedPackageName) {
    throw new PressureNarrativeRuntimeLoaderError(
      ERROR.PACKAGE_EXPORTS_INVALID,
      "OpenNovel runtime packageName mismatch",
      { expectedPackageName, actualPackageName: value.packageName },
    );
  }
  if (value.subpath !== DEFAULT_SUBPATH) {
    throw new PressureNarrativeRuntimeLoaderError(
      ERROR.PACKAGE_EXPORTS_INVALID,
      "OpenNovel runtime subpath mismatch",
      { subpath: value.subpath },
    );
  }
  assertJsExport(value.importTarget, "importTarget");
  assertJsExport(value.requireTarget, "requireTarget");
  if (value.importTarget !== "./dist/pressure-narrative/index.js") {
    throw new PressureNarrativeRuntimeLoaderError(
      ERROR.PACKAGE_EXPORTS_INVALID,
      "OpenNovel runtime import export must target the built ESM pressure-narrative entry",
      { importTarget: value.importTarget },
    );
  }
  if (value.requireTarget !== "./dist-cjs/pressure-narrative/index.js") {
    throw new PressureNarrativeRuntimeLoaderError(
      ERROR.PACKAGE_EXPORTS_INVALID,
      "OpenNovel runtime require export must target the built CJS pressure-narrative entry",
      { requireTarget: value.requireTarget },
    );
  }
  return value;
}

export function validateOpenNovelPressureNarrativeRuntimeModuleV1(
  value: unknown,
): OpenNovelPressureNarrativeRuntimeModuleV1 {
  if (!value || typeof value !== "object") {
    throw new PressureNarrativeRuntimeLoaderError(
      ERROR.RUNTIME_MODULE_INVALID,
      "OpenNovel runtime module must be an object",
      { runtimeId: DEFAULT_RUNTIME_ID },
    );
  }
  const moduleValue = value as Record<string, unknown>;
  for (const field of [
    "OpenNovelNarrativeProjectorV1",
    "NarrativeRendererV1",
    "NarrativePublisherV1",
    "validateNarrativeProjectionJobV1",
    "validateAudienceSafeNarrativeSourceV1",
  ] as const) {
    if (typeof moduleValue[field] !== "function") {
      throw new PressureNarrativeRuntimeLoaderError(
        ERROR.RUNTIME_MODULE_INVALID,
        "OpenNovel runtime module is missing a required export",
        { runtimeId: DEFAULT_RUNTIME_ID, field },
      );
    }
  }
  return moduleValue as unknown as OpenNovelPressureNarrativeRuntimeModuleV1;
}

function requireText(value: unknown, path: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new PressureNarrativeRuntimeLoaderError(
      ERROR.PACKAGE_EXPORTS_INVALID,
      "OpenNovel runtime export target must be a non-empty string",
      { path },
    );
  }
  return value;
}

function assertJsExport(value: string, field: string): void {
  if (!value.startsWith("./") || !value.endsWith(".js")) {
    throw new PressureNarrativeRuntimeLoaderError(
      ERROR.PACKAGE_EXPORTS_INVALID,
      "OpenNovel runtime export target must be a relative .js file",
      { field, value },
    );
  }
}
