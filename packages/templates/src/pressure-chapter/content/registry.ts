import {
  PRESSURE_CHAPTER_ROUTE_REGISTRY_SCHEMA_V1,
  PRESSURE_CHAPTER_ROUTE_TUPLE_V1,
  computePressureChapterRouteRegistryHash,
  validatePressureChapterRouteRegistryV1,
  type PressureChapterRouteRegistryV1,
} from "../../runtime-contract/pressure-chapter-registry";
import { loadSangtianPressureChapterPackageV1 } from "./loader";
import type { LoadedSangtianPressureChapterPackageV1 } from "./types";

export const SANGTIAN_PRESSURE_CHAPTER_ROUTE_KEY_V1 =
  "sangtian_pressure_chapter_v1" as const;

export interface PublishSangtianPressureChapterRouteInputV1 {
  registryVersion: string;
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
  package?: LoadedSangtianPressureChapterPackageV1;
}

/** Publish one route shared by 1+5 AI Solo and 2-6 human Multiplayer. */
export function createPublishedSangtianPressureChapterRegistryV1(
  input: PublishSangtianPressureChapterRouteInputV1,
): PressureChapterRouteRegistryV1 {
  const loaded = input.package ?? loadSangtianPressureChapterPackageV1();
  const withoutHash: Omit<PressureChapterRouteRegistryV1, "registryHash"> = {
    schemaVersion: PRESSURE_CHAPTER_ROUTE_REGISTRY_SCHEMA_V1,
    registryVersion: input.registryVersion,
    defaultRouteKey: SANGTIAN_PRESSURE_CHAPTER_ROUTE_KEY_V1,
    routes: [{
      routeKey: SANGTIAN_PRESSURE_CHAPTER_ROUTE_KEY_V1,
      worldId: "sangtian",
      status: "PUBLISHED",
      createEnabled: true,
      participantModes: ["SOLO", "MULTIPLAYER"],
      route: { ...PRESSURE_CHAPTER_ROUTE_TUPLE_V1 },
      contentPackageVersion: loaded.manifest.packageVersion,
      contentPackageSha256: loaded.manifest.contentSha256,
      orchestrationPackageVersion: input.orchestrationPackageVersion,
      orchestrationPackageSha256: input.orchestrationPackageSha256,
      runtimeContractVersion: input.runtimeContractVersion,
      runtimeContractSha256: input.runtimeContractSha256,
      testMatrixVersion: input.testMatrixVersion,
      testMatrixSha256: input.testMatrixSha256,
      narrativeProfileVersion: input.narrativeProfileVersion,
      featureSetVersion: input.featureSetVersion,
      resultContractRegistryVersion: input.resultContractRegistryVersion,
      controlTopologyVersion: input.controlTopologyVersion,
      handlerKey: "pressure_chapter_v1",
      resultAdapterKey: "SangtianPressureResultV1Adapter",
      presentationSchemaVersion: "sangtian_pressure_result_v1",
      rendererKey: "sangtian_pressure_endgame_v1",
    }],
  };
  return validatePressureChapterRouteRegistryV1({
    ...withoutHash,
    registryHash: computePressureChapterRouteRegistryHash(withoutHash),
  });
}
