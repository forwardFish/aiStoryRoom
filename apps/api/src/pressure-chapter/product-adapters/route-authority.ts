import { sha256Canonical } from "@ai-story/shared";
import { loadPublishedSangtianActionReleaseV1 } from "@ai-story/templates";
import {
  assertStoredRunRouteRecord,
  type StoredRunRouteRecordV1,
} from "../run-router";
import { createPublishedSangtianRouteRegistryPortV1 } from "../integration";
import {
  PRESSURE_PRODUCT_ADAPTER_ERROR_CODES_V1 as ERROR,
  failPressureProductAdapterV1,
} from "./errors";

export interface PressurePinnedRouteReadClientV1 {
  pressureRunRouteSnapshot: {
    findUnique(input: {
      where: { runId: string };
      select: { runId: true; routeHash: true; routeJson: true };
    }): Promise<{ runId: string; routeHash: string; routeJson: unknown } | null>;
  };
}

/** Reads the lossless route record and proves it still resolves in the pinned release. */
export async function readPinnedPressureRouteV1(
  client: PressurePinnedRouteReadClientV1,
  runId: string,
  expectedRouteHash?: string,
): Promise<StoredRunRouteRecordV1> {
  if (!runId.trim()) {
    return failPressureProductAdapterV1(ERROR.RECORD_INVALID, "runId", "EMPTY");
  }
  const row = await client.pressureRunRouteSnapshot.findUnique({
    where: { runId },
    select: { runId: true, routeHash: true, routeJson: true },
  });
  if (!row) {
    return failPressureProductAdapterV1(ERROR.AUTHORITY_NOT_FOUND, "PressureRunRouteSnapshot", runId);
  }
  let record: StoredRunRouteRecordV1;
  try {
    record = assertStoredRunRouteRecord(row.routeJson as StoredRunRouteRecordV1);
  } catch (cause) {
    return failPressureProductAdapterV1(
      ERROR.RECORD_INVALID,
      "PressureRunRouteSnapshot.routeJson",
      cause instanceof Error ? cause.message : String(cause),
    );
  }
  if (
    row.runId !== runId
    || record.runId !== runId
    || row.routeHash !== record.snapshot.routeHash
    || (expectedRouteHash !== undefined && row.routeHash !== expectedRouteHash)
  ) {
    return failPressureProductAdapterV1(ERROR.AUTHORITY_MISMATCH, "PressureRunRouteSnapshot", "ROW_BINDING");
  }

  const release = loadPublishedSangtianActionReleaseV1();
  const registry = createPublishedSangtianRouteRegistryPortV1(release.routeConfiguration);
  let resolved;
  try {
    resolved = registry.resolveStored(record.routeKey, record.snapshot.route);
  } catch (cause) {
    return failPressureProductAdapterV1(
      ERROR.AUTHORITY_MISMATCH,
      "PressureRunRouteSnapshot.release",
      cause instanceof Error ? cause.message : String(cause),
    );
  }
  if (
    record.registryVersion !== registry.registryVersion
    || record.registryHash !== registry.registryHash
    || record.routeKey !== release.routeRegistration.routeKey
    || sha256Canonical(resolved) !== sha256Canonical(release.routeRegistration)
    || record.handlerKey !== resolved.handlerKey
    || record.resultAdapterKey !== resolved.resultAdapterKey
    || record.presentationSchemaVersion !== resolved.presentationSchemaVersion
    || record.rendererKey !== resolved.rendererKey
    || record.snapshot.contentPackageVersion !== resolved.contentPackageVersion
    || record.snapshot.contentPackageSha256 !== resolved.contentPackageSha256
    || record.snapshot.orchestrationPackageVersion !== resolved.orchestrationPackageVersion
    || record.snapshot.orchestrationPackageSha256 !== resolved.orchestrationPackageSha256
    || record.snapshot.runtimeContractVersion !== resolved.runtimeContractVersion
    || record.snapshot.runtimeContractSha256 !== resolved.runtimeContractSha256
    || record.snapshot.testMatrixVersion !== resolved.testMatrixVersion
    || record.snapshot.testMatrixSha256 !== resolved.testMatrixSha256
    || record.snapshot.narrativeProfileVersion !== resolved.narrativeProfileVersion
    || record.snapshot.featureSetVersion !== resolved.featureSetVersion
    || record.snapshot.resultContractRegistryVersion !== resolved.resultContractRegistryVersion
    || record.snapshot.controlTopologyVersion !== resolved.controlTopologyVersion
  ) {
    return failPressureProductAdapterV1(ERROR.AUTHORITY_MISMATCH, "PressureRunRouteSnapshot.release", "PIN_MISMATCH");
  }
  return structuredClone(record);
}
