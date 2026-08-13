import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import {
  PRESSURE_CHAPTER_ROUTE_REGISTRY_SCHEMA_V1,
  PRESSURE_CHAPTER_ROUTE_TUPLE_V1,
  PressureChapterRouteRegistry,
  PressureChapterRouteRegistryError,
  computePressureChapterRouteRegistryHash,
  validatePressureChapterRouteRegistryV1,
  type PressureChapterRouteRegistryErrorCode,
  type PressureChapterRouteRegistryV1,
} from "../src/runtime-contract/pressure-chapter-registry";

const sha = (value: string): string =>
  createHash("sha256").update(value).digest("hex");

function registry(): PressureChapterRouteRegistryV1 {
  const base = {
    schemaVersion: PRESSURE_CHAPTER_ROUTE_REGISTRY_SCHEMA_V1,
    registryVersion: "pressure-route-registry-1.0.0",
    defaultRouteKey: "sangtian.pressure.chapter.v1",
    routes: [{
      routeKey: "sangtian.pressure.chapter.v1",
      worldId: "sangtian" as const,
      status: "PUBLISHED" as const,
      createEnabled: true,
      participantModes: ["SOLO", "MULTIPLAYER"] as ["SOLO", "MULTIPLAYER"],
      route: { ...PRESSURE_CHAPTER_ROUTE_TUPLE_V1 },
      contentPackageVersion: "sangtian-content-1.0.0",
      contentPackageSha256: sha("content"),
      orchestrationPackageVersion: "sangtian-orchestration-1.0.0",
      orchestrationPackageSha256: sha("orchestration"),
      runtimeContractVersion: "pressure-runtime-contract-1.0.0",
      runtimeContractSha256: sha("runtime-contract"),
      testMatrixVersion: "pressure-test-matrix-1.0.0",
      testMatrixSha256: sha("test-matrix"),
      narrativeProfileVersion: "openovel-pressure-1.0.0",
      featureSetVersion: "pressure-feature-set-1.0.0",
      resultContractRegistryVersion: "result-contract-registry-1.0.0",
      controlTopologyVersion: "six-seat-control-1.0.0",
      handlerKey: "pressure_chapter_v1" as const,
      resultAdapterKey: "SangtianPressureResultV1Adapter" as const,
      presentationSchemaVersion: "sangtian_pressure_result_v1" as const,
      rendererKey: "sangtian_pressure_endgame_v1" as const,
    }],
  };
  return {
    ...base,
    registryHash: computePressureChapterRouteRegistryHash(base),
  };
}

function expectCode(fn: () => unknown, code: PressureChapterRouteRegistryErrorCode): void {
  assert.throws(fn, (error: unknown) => {
    assert.equal(error instanceof PressureChapterRouteRegistryError, true);
    assert.equal((error as PressureChapterRouteRegistryError).code, code);
    return true;
  });
}

test("the published Pressure registry resolves the same route for Solo and Multiplayer", () => {
  const value = registry();
  assert.equal(validatePressureChapterRouteRegistryV1(value).registryHash, value.registryHash);
  const routes = new PressureChapterRouteRegistry(value);
  assert.deepEqual(routes.resolveCreate(null, "SOLO").route, PRESSURE_CHAPTER_ROUTE_TUPLE_V1);
  assert.deepEqual(
    routes.resolveCreate("sangtian.pressure.chapter.v1", "MULTIPLAYER").route,
    PRESSURE_CHAPTER_ROUTE_TUPLE_V1,
  );
});

test("unknown routes fail closed instead of falling back to the default", () => {
  const routes = new PressureChapterRouteRegistry(registry());
  expectCode(
    () => routes.resolveCreate("sangtian.unknown.runtime", "SOLO"),
    "RUN_ROUTE_UNREGISTERED",
  );
  expectCode(
    () => routes.resolveStored("sangtian.pressure.chapter.v1", {
      ...PRESSURE_CHAPTER_ROUTE_TUPLE_V1,
      runtimeProfile: "OPENNOVEL_T20_V1",
    }),
    "RUNTIME_PROFILE_UNSUPPORTED",
  );
});

test("registry hash, unknown fields and handler mismatches are rejected", () => {
  const badHash = structuredClone(registry());
  badHash.registryHash = sha("wrong-registry");
  expectCode(() => validatePressureChapterRouteRegistryV1(badHash), "ROUTE_REGISTRY_HASH_MISMATCH");

  const unknown = structuredClone(registry()) as any;
  unknown.routes[0].fallbackRuntime = "OPENNOVEL_T20_V1";
  unknown.registryHash = computePressureChapterRouteRegistryHash(
    Object.fromEntries(
      Object.entries(unknown).filter(([field]) => field !== "registryHash"),
    ) as any,
  );
  expectCode(() => validatePressureChapterRouteRegistryV1(unknown), "ROUTE_REGISTRY_INVALID");

  const wrongHandler = structuredClone(registry()) as any;
  wrongHandler.routes[0].handlerKey = "openovel-runtime";
  wrongHandler.registryHash = computePressureChapterRouteRegistryHash(
    Object.fromEntries(
      Object.entries(wrongHandler).filter(([field]) => field !== "registryHash"),
    ) as any,
  );
  expectCode(() => validatePressureChapterRouteRegistryV1(wrongHandler), "ROUTE_HANDLER_MISMATCH");
});

test("registry entries cannot contain incomplete package or contract references", () => {
  const incomplete = structuredClone(registry()) as any;
  incomplete.routes[0].runtimeContractVersion = "TBD";
  incomplete.registryHash = computePressureChapterRouteRegistryHash(
    Object.fromEntries(
      Object.entries(incomplete).filter(([field]) => field !== "registryHash"),
    ) as any,
  );
  expectCode(() => validatePressureChapterRouteRegistryV1(incomplete), "RUN_ROUTE_INCOMPLETE");
});
