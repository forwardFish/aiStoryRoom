import { createHash } from "node:crypto";

export const PRESSURE_CHAPTER_ROUTE_REGISTRY_SCHEMA_V1 =
  "pressure_chapter_route_registry_v1" as const;

export const PRESSURE_CHAPTER_ROUTE_TUPLE_V1 = Object.freeze({
  engineVersion: "pressure_chapter_v1",
  strategyVersion: "sangtian_pressure_chapter_v1_0",
  runtimeProfile: "SANGTIAN_CONTINUOUS_CHAPTER_V1",
  endgamePolicyVersion: "sangtian_content_finale_v1",
  resultSchemaVersion: "sangtian_pressure_result_v1",
} as const);

export type PressureChapterParticipantModeV1 = "SOLO" | "MULTIPLAYER";

export interface PressureChapterRegistryRouteV1 {
  engineVersion: string;
  strategyVersion: string;
  runtimeProfile: string;
  endgamePolicyVersion: string;
  resultSchemaVersion: string;
}

export interface PressureChapterRouteRegistrationV1 {
  routeKey: string;
  worldId: "sangtian";
  status: "PUBLISHED" | "DISABLED";
  createEnabled: boolean;
  participantModes: PressureChapterParticipantModeV1[];
  route: PressureChapterRegistryRouteV1;
  contentPackageVersion: string;
  contentPackageSha256: string;
  orchestrationPackageVersion: string;
  orchestrationPackageSha256: string;
  runtimeContractVersion: string;
  runtimeContractSha256: string;
  testMatrixVersion: string;
  testMatrixSha256: string;
  narrativeProfileVersion: string;
  featureSetVersion: string;
  resultContractRegistryVersion: string;
  controlTopologyVersion: string;
  handlerKey: "pressure_chapter_v1";
  resultAdapterKey: "SangtianPressureResultV1Adapter";
  presentationSchemaVersion: "sangtian_pressure_result_v1";
  rendererKey: "sangtian_pressure_endgame_v1";
}

export interface PressureChapterRouteRegistryV1 {
  schemaVersion: typeof PRESSURE_CHAPTER_ROUTE_REGISTRY_SCHEMA_V1;
  registryVersion: string;
  defaultRouteKey: string;
  routes: PressureChapterRouteRegistrationV1[];
  registryHash: string;
}

export type PressureChapterRouteRegistryErrorCode =
  | "ROUTE_REGISTRY_INVALID"
  | "ROUTE_REGISTRY_DUPLICATE"
  | "ROUTE_REGISTRY_HASH_MISMATCH"
  | "RUN_ROUTE_UNREGISTERED"
  | "RUN_ROUTE_INCOMPLETE"
  | "RUNTIME_PROFILE_UNSUPPORTED"
  | "ENDGAME_POLICY_MISMATCH"
  | "RESULT_SCHEMA_UNSUPPORTED"
  | "ROUTE_HANDLER_MISMATCH";

export class PressureChapterRouteRegistryError extends Error {
  constructor(
    readonly code: PressureChapterRouteRegistryErrorCode,
    readonly path: string,
    readonly detail?: string,
  ) {
    super(`${code}:${path}${detail ? `:${detail}` : ""}`);
    this.name = "PressureChapterRouteRegistryError";
  }
}

type Raw = Record<string, unknown>;
const SHA256 = /^[a-f0-9]{64}$/;
const ROUTE_KEY = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/;

const REGISTRY_KEYS = [
  "schemaVersion",
  "registryVersion",
  "defaultRouteKey",
  "routes",
  "registryHash",
] as const;

const ENTRY_KEYS = [
  "routeKey",
  "worldId",
  "status",
  "createEnabled",
  "participantModes",
  "route",
  "contentPackageVersion",
  "contentPackageSha256",
  "orchestrationPackageVersion",
  "orchestrationPackageSha256",
  "runtimeContractVersion",
  "runtimeContractSha256",
  "testMatrixVersion",
  "testMatrixSha256",
  "narrativeProfileVersion",
  "featureSetVersion",
  "resultContractRegistryVersion",
  "controlTopologyVersion",
  "handlerKey",
  "resultAdapterKey",
  "presentationSchemaVersion",
  "rendererKey",
] as const;

const ROUTE_KEYS = [
  "engineVersion",
  "strategyVersion",
  "runtimeProfile",
  "endgamePolicyVersion",
  "resultSchemaVersion",
] as const;

export function canonicalPressureRegistryJson(value: unknown): string {
  return canonical(value, "$", new WeakSet<object>());
}

export function computePressureChapterRouteRegistryHash(
  registry: Omit<PressureChapterRouteRegistryV1, "registryHash">,
): string {
  return createHash("sha256")
    .update(canonicalPressureRegistryJson(registry))
    .digest("hex");
}

export function validatePressureChapterRouteRegistryV1(
  value: unknown,
): PressureChapterRouteRegistryV1 {
  const registry = object(value, "registry");
  exact(registry, REGISTRY_KEYS, "registry");
  literal(
    registry.schemaVersion,
    PRESSURE_CHAPTER_ROUTE_REGISTRY_SCHEMA_V1,
    "registry.schemaVersion",
  );
  version(registry.registryVersion, "registry.registryVersion");
  const defaultRouteKey = key(registry.defaultRouteKey, "registry.defaultRouteKey");
  if (!Array.isArray(registry.routes) || registry.routes.length === 0) {
    fail("ROUTE_REGISTRY_INVALID", "registry.routes", "NON_EMPTY_ARRAY");
  }
  const routes = registry.routes.map((entry, index) => validateEntry(entry, index));
  for (let index = 1; index < routes.length; index += 1) {
    if (routes[index - 1]!.routeKey >= routes[index]!.routeKey) {
      const duplicate = routes[index - 1]!.routeKey === routes[index]!.routeKey;
      fail(
        duplicate ? "ROUTE_REGISTRY_DUPLICATE" : "ROUTE_REGISTRY_INVALID",
        "registry.routes",
        duplicate ? routes[index]!.routeKey : "ROUTE_KEY_ORDER",
      );
    }
  }
  const selectedDefault = routes.find((entry) => entry.routeKey === defaultRouteKey);
  if (!selectedDefault) {
    fail("RUN_ROUTE_UNREGISTERED", "registry.defaultRouteKey", defaultRouteKey);
  }
  if (selectedDefault.status !== "PUBLISHED" || !selectedDefault.createEnabled) {
    fail("RUN_ROUTE_UNREGISTERED", "registry.defaultRouteKey", "DEFAULT_NOT_CREATABLE");
  }
  hash(registry.registryHash, "registry.registryHash");
  const expectedHash = computePressureChapterRouteRegistryHash(
    Object.fromEntries(
      Object.entries(registry).filter(([field]) => field !== "registryHash"),
    ) as unknown as Omit<PressureChapterRouteRegistryV1, "registryHash">,
  );
  if (registry.registryHash !== expectedHash) {
    fail(
      "ROUTE_REGISTRY_HASH_MISMATCH",
      "registry.registryHash",
      `EXPECTED_${expectedHash}`,
    );
  }
  return registry as unknown as PressureChapterRouteRegistryV1;
}

export class PressureChapterRouteRegistry {
  private readonly registrations = new Map<string, PressureChapterRouteRegistrationV1>();
  readonly registryVersion: string;
  readonly registryHash: string;
  readonly defaultRouteKey: string;

  constructor(value: unknown) {
    const registry = validatePressureChapterRouteRegistryV1(value);
    this.registryVersion = registry.registryVersion;
    this.registryHash = registry.registryHash;
    this.defaultRouteKey = registry.defaultRouteKey;
    for (const entry of registry.routes) this.registrations.set(entry.routeKey, entry);
  }

  resolveCreate(
    routeKey: string | null | undefined,
    participantMode: PressureChapterParticipantModeV1,
  ): PressureChapterRouteRegistrationV1 {
    const selectedKey = routeKey ?? this.defaultRouteKey;
    const entry = this.registrations.get(selectedKey);
    if (!entry) fail("RUN_ROUTE_UNREGISTERED", "routeKey", selectedKey);
    if (entry.status !== "PUBLISHED" || !entry.createEnabled) {
      fail("RUN_ROUTE_UNREGISTERED", "routeKey", "ROUTE_NOT_CREATABLE");
    }
    if (!entry.participantModes.includes(participantMode)) {
      fail("RUN_ROUTE_UNREGISTERED", "participantMode", participantMode);
    }
    return structuredClone(entry);
  }

  resolveStored(
    routeKey: string,
    route: PressureChapterRegistryRouteV1,
  ): PressureChapterRouteRegistrationV1 {
    const entry = this.registrations.get(routeKey);
    if (!entry) fail("RUN_ROUTE_UNREGISTERED", "routeKey", routeKey);
    for (const field of ROUTE_KEYS) {
      if (route[field] !== entry.route[field]) {
        fail(routeMismatchCode(field), `route.${field}`, `EXPECTED_${entry.route[field]}`);
      }
    }
    return structuredClone(entry);
  }
}

function validateEntry(value: unknown, index: number): PressureChapterRouteRegistrationV1 {
  const path = `registry.routes[${index}]`;
  const entry = object(value, path);
  exact(entry, ENTRY_KEYS, path);
  key(entry.routeKey, `${path}.routeKey`);
  literal(entry.worldId, "sangtian", `${path}.worldId`);
  oneOf(entry.status, ["PUBLISHED", "DISABLED"], `${path}.status`);
  if (typeof entry.createEnabled !== "boolean") {
    fail("ROUTE_REGISTRY_INVALID", `${path}.createEnabled`, "BOOLEAN");
  }
  if (
    !Array.isArray(entry.participantModes) ||
    entry.participantModes.length !== 2 ||
    entry.participantModes[0] !== "SOLO" ||
    entry.participantModes[1] !== "MULTIPLAYER"
  ) {
    fail(
      "ROUTE_REGISTRY_INVALID",
      `${path}.participantModes`,
      "EXACT_SOLO_MULTIPLAYER_ORDER",
    );
  }
  validateRoute(entry.route, `${path}.route`);
  for (const field of [
    "contentPackageVersion",
    "orchestrationPackageVersion",
    "runtimeContractVersion",
    "testMatrixVersion",
    "narrativeProfileVersion",
    "featureSetVersion",
    "resultContractRegistryVersion",
    "controlTopologyVersion",
  ] as const) {
    version(entry[field], `${path}.${field}`);
  }
  for (const field of [
    "contentPackageSha256",
    "orchestrationPackageSha256",
    "runtimeContractSha256",
    "testMatrixSha256",
  ] as const) {
    hash(entry[field], `${path}.${field}`);
  }
  literal(entry.handlerKey, "pressure_chapter_v1", `${path}.handlerKey`, "ROUTE_HANDLER_MISMATCH");
  literal(
    entry.resultAdapterKey,
    "SangtianPressureResultV1Adapter",
    `${path}.resultAdapterKey`,
    "ROUTE_HANDLER_MISMATCH",
  );
  literal(
    entry.presentationSchemaVersion,
    "sangtian_pressure_result_v1",
    `${path}.presentationSchemaVersion`,
    "RESULT_SCHEMA_UNSUPPORTED",
  );
  literal(
    entry.rendererKey,
    "sangtian_pressure_endgame_v1",
    `${path}.rendererKey`,
    "ROUTE_HANDLER_MISMATCH",
  );
  if (entry.status === "DISABLED" && entry.createEnabled) {
    fail("ROUTE_REGISTRY_INVALID", `${path}.createEnabled`, "DISABLED_ROUTE");
  }
  return entry as unknown as PressureChapterRouteRegistrationV1;
}

function validateRoute(value: unknown, path: string): void {
  const route = object(value, path);
  exact(route, ROUTE_KEYS, path);
  for (const [field, expected] of Object.entries(PRESSURE_CHAPTER_ROUTE_TUPLE_V1) as Array<
    [keyof typeof PRESSURE_CHAPTER_ROUTE_TUPLE_V1, string]
  >) {
    literal(route[field], expected, `${path}.${field}`, routeMismatchCode(field));
  }
}

function routeMismatchCode(
  field: keyof PressureChapterRegistryRouteV1,
): PressureChapterRouteRegistryErrorCode {
  if (field === "runtimeProfile") return "RUNTIME_PROFILE_UNSUPPORTED";
  if (field === "endgamePolicyVersion") return "ENDGAME_POLICY_MISMATCH";
  if (field === "resultSchemaVersion") return "RESULT_SCHEMA_UNSUPPORTED";
  return "RUN_ROUTE_UNREGISTERED";
}

function object(value: unknown, path: string): Raw {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("ROUTE_REGISTRY_INVALID", path, "OBJECT");
  }
  return value as Raw;
}

function exact(value: Raw, fields: readonly string[], path: string): void {
  const unknown = Object.keys(value).find((field) => !fields.includes(field));
  if (unknown) fail("ROUTE_REGISTRY_INVALID", `${path}.${unknown}`, "UNKNOWN_FIELD");
  const missing = fields.find((field) => !(field in value));
  if (missing) fail("RUN_ROUTE_INCOMPLETE", `${path}.${missing}`, "MISSING_FIELD");
}

function key(value: unknown, path: string): string {
  if (typeof value !== "string" || !ROUTE_KEY.test(value)) {
    fail("ROUTE_REGISTRY_INVALID", path, "ROUTE_KEY");
  }
  return value;
}

function version(value: unknown, path: string): string {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    /^(?:TBD|TODO|UNKNOWN)$/i.test(value)
  ) {
    fail("RUN_ROUTE_INCOMPLETE", path, "VERSION");
  }
  return value;
}

function hash(value: unknown, path: string): string {
  if (typeof value !== "string" || !SHA256.test(value)) {
    fail("RUN_ROUTE_INCOMPLETE", path, "SHA256_LOWER_HEX");
  }
  return value;
}

function literal<T>(
  value: unknown,
  expected: T,
  path: string,
  code: PressureChapterRouteRegistryErrorCode = "ROUTE_REGISTRY_INVALID",
): T {
  if (value !== expected) fail(code, path, `EXPECTED_${String(expected)}`);
  return expected;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], path: string): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    fail("ROUTE_REGISTRY_INVALID", path, `ALLOWED_${allowed.join("|")}`);
  }
  return value as T;
}

function fail(
  code: PressureChapterRouteRegistryErrorCode,
  path: string,
  detail?: string,
): never {
  throw new PressureChapterRouteRegistryError(code, path, detail);
}

function canonical(value: unknown, path: string, ancestors: WeakSet<object>): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value)) {
    return Object.is(value, -0) ? "0" : JSON.stringify(value);
  }
  if (!value || typeof value !== "object") {
    fail("ROUTE_REGISTRY_INVALID", path, "NON_JSON_VALUE");
  }
  if (ancestors.has(value)) fail("ROUTE_REGISTRY_INVALID", path, "CYCLIC_VALUE");
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      for (let index = 0; index < value.length; index += 1) {
        if (!(index in value)) {
          fail("ROUTE_REGISTRY_INVALID", `${path}[${index}]`, "SPARSE_ARRAY");
        }
      }
      const extraKey = Object.keys(value).find(
        (key) => !/^(?:0|[1-9]\d*)$/.test(key) || Number(key) >= value.length,
      );
      if (extraKey || Object.getOwnPropertySymbols(value).length > 0) {
        fail("ROUTE_REGISTRY_INVALID", path, "ARRAY_EXTRA_PROPERTY");
      }
      return `[${value
        .map((item, index) => canonical(item, `${path}[${index}]`, ancestors))
        .join(",")}]`;
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      fail("ROUTE_REGISTRY_INVALID", path, "NON_PLAIN_OBJECT");
    }
    if (Object.getOwnPropertySymbols(value).length > 0) {
      fail("ROUTE_REGISTRY_INVALID", path, "SYMBOL_PROPERTY");
    }
    const record = value as Raw;
    return `{${Object.keys(record)
      .sort()
      .map((field) => `${JSON.stringify(field)}:${canonical(record[field], `${path}.${field}`, ancestors)}`)
      .join(",")}}`;
  } finally {
    ancestors.delete(value);
  }
}
