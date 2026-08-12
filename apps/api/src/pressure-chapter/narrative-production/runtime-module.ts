import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type {
  NarrativePublisherV1,
  NarrativeRendererV1,
  OpenNovelNarrativeProjectorV1,
  validateAudienceSafeNarrativeSourceV1,
  validateNarrativeProjectionJobV1,
} from "@apps/openovel-runtime/pressure-narrative";
import {
  PRESSURE_NARRATIVE_PRODUCTION_ERROR_CODES as ERROR,
  failPressureNarrativeProduction,
} from "./errors";

/**
 * Explicit CommonJS-to-ESM in-process boundary.
 *
 * The API build must not emit a relative `require()` for OpenNovel's ESM
 * source tree. The process composition layer instead supplies the real loaded
 * module namespace (normally via `import()` of the deployed OpenNovel entry).
 */
export interface OpenNovelPressureNarrativeRuntimeModuleV1 {
  OpenNovelNarrativeProjectorV1: typeof OpenNovelNarrativeProjectorV1;
  NarrativeRendererV1: typeof NarrativeRendererV1;
  NarrativePublisherV1: typeof NarrativePublisherV1;
  validateNarrativeProjectionJobV1: typeof validateNarrativeProjectionJobV1;
  validateAudienceSafeNarrativeSourceV1:
    typeof validateAudienceSafeNarrativeSourceV1;
}

export interface OpenNovelPressureNarrativeRuntimeLoaderPortV1 {
  load(): Promise<unknown>;
}

export interface DeployedOpenNovelPressureNarrativeRuntimeLoaderOptionsV1 {
  /** Explicit file URL or absolute path for packaged deployments. */
  moduleLocation?: string;
  /** Source loading is for the repository tsx process only, never plain Node. */
  allowTypeScriptSource?: boolean;
}

const nativeDynamicImport = new Function(
  "specifier",
  "return import(specifier);",
) as (specifier: string) => Promise<unknown>;

/**
 * Loads the real deployed OpenNovel ESM artifact without emitting CommonJS
 * require() calls. Production resolves dist first; repository dev/test may
 * explicitly allow the TypeScript source handled by tsx.
 */
export function deployedOpenNovelPressureNarrativeRuntimeLoaderV1(
  options: DeployedOpenNovelPressureNarrativeRuntimeLoaderOptionsV1 = {},
): OpenNovelPressureNarrativeRuntimeLoaderPortV1 {
  return Object.freeze({
    async load(): Promise<unknown> {
      const location = resolveRuntimeLocation(options);
      if (location === null) {
        return failPressureNarrativeProduction(
          ERROR.RUNTIME_MODULE_UNAVAILABLE,
          "openNovelRuntimeModule.location",
          "BUILD_OPENOVEL_RUNTIME_OR_SUPPLY_MODULE_LOCATION",
        );
      }
      try {
        const module = await nativeDynamicImport(toImportSpecifier(location));
        return validateOpenNovelPressureNarrativeRuntimeModuleV1(module);
      } catch (cause) {
        return failPressureNarrativeProduction(
          ERROR.RUNTIME_MODULE_UNAVAILABLE,
          "openNovelRuntimeModule.import",
          cause instanceof Error ? `${cause.name}:${cause.message}` : String(cause),
        );
      }
    },
  });
}

export function staticOpenNovelPressureNarrativeRuntimeLoaderV1(
  module: OpenNovelPressureNarrativeRuntimeModuleV1,
): OpenNovelPressureNarrativeRuntimeLoaderPortV1 {
  const validated = validateOpenNovelPressureNarrativeRuntimeModuleV1(module);
  return Object.freeze({ async load() { return validated; } });
}

export function validateOpenNovelPressureNarrativeRuntimeModuleV1(
  value: unknown,
): OpenNovelPressureNarrativeRuntimeModuleV1 {
  if (!value || typeof value !== "object") {
    return failPressureNarrativeProduction(
      ERROR.RUNTIME_MODULE_UNAVAILABLE,
      "openNovelRuntimeModule",
      "OBJECT",
    );
  }
  const module = value as Record<string, unknown>;
  for (const field of [
    "OpenNovelNarrativeProjectorV1",
    "NarrativeRendererV1",
    "NarrativePublisherV1",
    "validateNarrativeProjectionJobV1",
    "validateAudienceSafeNarrativeSourceV1",
  ] as const) {
    if (typeof module[field] !== "function") {
      return failPressureNarrativeProduction(
        ERROR.RUNTIME_MODULE_UNAVAILABLE,
        `openNovelRuntimeModule.${field}`,
        "FUNCTION",
      );
    }
  }
  return module as unknown as OpenNovelPressureNarrativeRuntimeModuleV1;
}

function resolveRuntimeLocation(
  options: DeployedOpenNovelPressureNarrativeRuntimeLoaderOptionsV1,
): string | null {
  if (options.moduleLocation !== undefined) {
    if (!options.moduleLocation.trim()) {
      return failPressureNarrativeProduction(
        ERROR.PRODUCTION_CONFIG_INVALID,
        "runtimeLoader.moduleLocation",
        "NON_EMPTY_STRING",
      );
    }
    return options.moduleLocation;
  }
  const dist = resolve(
    __dirname,
    "../../../../openovel-runtime/dist/pressure-narrative/index.js",
  );
  if (existsSync(dist)) return dist;
  if (options.allowTypeScriptSource === true) {
    const source = resolve(
      __dirname,
      "../../../../openovel-runtime/src/pressure-narrative/index.ts",
    );
    if (existsSync(source)) return source;
  }
  return null;
}

function toImportSpecifier(location: string): string {
  if (
    /^[a-zA-Z][a-zA-Z\d+.-]*:/.test(location)
    && !/^[a-zA-Z]:[\\/]/.test(location)
  ) return location;
  return pathToFileURL(resolve(location)).href;
}
