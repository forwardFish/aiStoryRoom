export interface OpenNovelPressureNarrativeRuntimeModuleV1 {
  OpenNovelNarrativeProjectorV1: (...args: any[]) => unknown;
  NarrativeRendererV1: (...args: any[]) => unknown;
  NarrativePublisherV1: (...args: any[]) => unknown;
  validateNarrativeProjectionJobV1: (...args: any[]) => unknown;
  validateAudienceSafeNarrativeSourceV1: (...args: any[]) => unknown;
}

export interface OpenNovelPressureNarrativePackageExportsV1 {
  packageName: string;
  subpath: "./pressure-narrative";
  importTarget: string;
  requireTarget: string;
}

export interface OpenNovelPressureNarrativeRequireLoaderPortV1 {
  load(): OpenNovelPressureNarrativeRuntimeModuleV1;
}

