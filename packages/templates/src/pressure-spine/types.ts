export const PRESSURE_SPINE_IMPORTER_VERSION = "pressure-spine-importer-v1" as const;
export const PRESSURE_SPINE_SOURCE_DIRECTORY = "source" as const;

export type PressureSpineRuntimeProfile = string;
export type PressureSpineFileMap = Map<string, Uint8Array>;

export type PressureSpineValidationIssue = {
  code: string;
  path: string;
  message: string;
};

export type PressureSpineValidationReport = {
  verdict: "PASS" | "FAIL";
  issues: PressureSpineValidationIssue[];
  counts: Record<string, number>;
  sourceSha256: string | null;
  packageId: string | null;
  packageVersion: string | null;
};

export type PressureSpineValidationOptions = {
  expectedSourceSha256?: string;
  expectedSourceLineCount?: number;
  expectedNodeIds?: string[];
  expectedSeatCount?: number;
  sourceText?: string;
  validateInventory?: boolean;
  requireNativeAuditPass?: boolean;
};

export type PressureSpineArtifactRecord = {
  path: string;
  byteSize: number;
  sha256: string;
};

export type PressureSpineRuntimeIndex = {
  schemaVersion: "pressure_spine_runtime_index_v1";
  worldId: string;
  runtimeProfile: PressureSpineRuntimeProfile;
  registeredPackageVersion: string;
  packageId: string;
  packageVersion: string;
  sourceSha256: string;
  nodeIds: string[];
  seatIds: string[];
  roleKeys: string[];
  actorIds: string[];
  objectIds: string[];
  claimIds: string[];
  adaptationDecisionIds: string[];
  sceneIds: string[];
  handoffIds: string[];
  branchIds: string[];
  frozenResultIds: string[];
  openingProjectionIds: string[];
  objectVersionIds: string[];
  dialogueSeedIds: string[];
  nodes: Array<{
    nodeId: string;
    sequence: number;
    nextNodeId: string | null;
    actionBudget: {
      preparePerSeat: number;
      commitPerSeat: number;
      reactionPerSeat: number;
    };
    contestedObjectIds: string[];
    branchIds: string[];
    frozenResultIds: string[];
    openingProjectionIds: string[];
    files: Record<string, string>;
  }>;
  finale: {
    worldTrackIds: string[];
    seatVerdictSeatIds: string[];
    inputRule: string;
  };
  counts: Record<string, number>;
};

export type PressureSpineManifestLock = {
  schemaVersion: "pressure_spine_manifest_lock_v1";
  worldId: string;
  runtimeProfile: PressureSpineRuntimeProfile;
  registeredPackageVersion: string;
  packageId: string;
  packageVersion: string;
  sourcePackageSha256: string;
  sourcePackageByteSize: number;
  sourcePackageArchivePath: string;
  sourceSha256: string;
  sourceLineCount: number;
  contentTreeSha256: string;
  runtimeIndexSha256: string;
  importerVersion: typeof PRESSURE_SPINE_IMPORTER_VERSION;
  artifactIndex: PressureSpineArtifactRecord[];
  legacyStrategyLocks: Record<string, string>;
};

export type PressureSpineRegistrationManifest = {
  schemaVersion: "pressure_spine_registration_manifest_v1";
  contentVersion: string;
  templateKey: string;
  runtimeProfile: PressureSpineRuntimeProfile;
  packageId: string;
  packageVersion: string;
  sourceDirectory: typeof PRESSURE_SPINE_SOURCE_DIRECTORY;
  sourceFileCount: number;
  sourcePackageSha256: string;
  sourcePackageByteSize: number;
  sourcePackageArchivePath: string;
  sourceSha256: string;
  sourceLineCount: number;
  runtimeIndexPath: "runtime-index.json";
  runtimeIndexSha256: string;
  manifestLockPath: "manifest.lock.json";
  manifestLockSha256: string;
};

export type PressureSpineRegistryEntry = {
  artifactDirectory: string;
  manifestSha256: string;
  status: "development" | "published";
};

export type PressureSpineRegistry = {
  schemaVersion: "strategy_registry_v1";
  defaultStrategyVersion: string;
  strategies: Record<string, PressureSpineRegistryEntry>;
};

export type LoadedPressureSpinePackage = {
  registry: PressureSpineRegistry;
  registryEntry: PressureSpineRegistryEntry;
  registrationManifest: PressureSpineRegistrationManifest;
  manifestLock: PressureSpineManifestLock;
  runtimeIndex: PressureSpineRuntimeIndex;
  artifactRoot: string;
};
