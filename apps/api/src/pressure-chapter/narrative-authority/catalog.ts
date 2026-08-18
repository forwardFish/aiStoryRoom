import {
  hashWithoutField,
  isSha256,
} from "@ai-story/shared";
import {
  loadPublishedSangtianActionReleaseV1,
  loadSangtianPressureChapterPackageV1,
  type LoadedSangtianPressureChapterPackageV1,
  type PublishedSangtianActionReleaseV1,
} from "@ai-story/templates";
import {
  PRESSURE_NARRATIVE_AUTHORITY_ERROR_CODES_V1 as ERROR,
  failPressureNarrativeAuthorityV1,
} from "./errors";

export const SANGTIAN_NARRATIVE_AUTHORITY_TARGET_V1 = Object.freeze({
  runtimeProfile: "SANGTIAN_CONTINUOUS_CHAPTER_V1",
  sourceCommitSha: "5badb6fa62a823de7019ce6a046efffbd74268d8",
  contentPackageVersion: "1.0.2",
  contentPackageSha256: "9e195a3443853c928b44c0f9d58568427c23946cb601c65adf866fa8e9e738d4",
  orchestrationPackageSha256: "f2aedf4e9ee8dda6e48fdfd0133300a375bd0fe9e9a0d6422dffd90a85a05d8e",
  narrativeProfileVersion: "openovel-pressure-1.0.0",
} as const);

export interface SangtianNarrativeAuthorityCatalogV1 {
  package: LoadedSangtianPressureChapterPackageV1;
  release: PublishedSangtianActionReleaseV1;
}

export function loadSangtianNarrativeAuthorityCatalogV1(): SangtianNarrativeAuthorityCatalogV1 {
  const loaded = loadSangtianPressureChapterPackageV1();
  const release = loadPublishedSangtianActionReleaseV1();
  const catalog = { package: loaded, release };
  assertSangtianNarrativeAuthorityCatalogV1(catalog);
  return deepFreeze(catalog);
}

/**
 * Rechecks the immutable release descriptor at this trust boundary. The
 * presentation hash is deliberately read from the loader-returned catalog and
 * verified as its self hash; this compiler does not maintain a second release
 * hash constant that can drift from the published manifest.
 */
export function assertSangtianNarrativeAuthorityCatalogV1(
  catalog: SangtianNarrativeAuthorityCatalogV1,
): void {
  const loaded = catalog.package;
  const release = catalog.release;
  const target = SANGTIAN_NARRATIVE_AUTHORITY_TARGET_V1;
  if (
    loaded.manifest.runtimeProfile !== target.runtimeProfile
    || loaded.manifest.sourceCommitSha !== target.sourceCommitSha
    || loaded.manifest.packageVersion !== target.contentPackageVersion
    || loaded.manifest.contentSha256 !== target.contentPackageSha256
    || release.route.contentPackageVersion !== target.contentPackageVersion
    || release.route.contentPackageSha256 !== target.contentPackageSha256
    || release.routeRegistration.route.runtimeProfile !== target.runtimeProfile
    || release.routeRegistration.orchestrationPackageSha256
      !== target.orchestrationPackageSha256
    || release.routeConfiguration.narrativeProfileVersion
      !== target.narrativeProfileVersion
    || release.catalog.schemaVersion !== "sangtian_action_presentation_catalog_v1"
    || release.catalog.runtimeProfile !== target.runtimeProfile
    || release.catalog.sourceBinding.contentPackageVersion
      !== target.contentPackageVersion
    || release.catalog.sourceBinding.contentPackageSha256
      !== target.contentPackageSha256
    || !isSha256(release.catalog.catalogSha256)
    || hashWithoutField(
      release.catalog as unknown as Record<string, unknown>,
      "catalogSha256",
    ) !== release.catalog.catalogSha256
  ) {
    failPressureNarrativeAuthorityV1(
      ERROR.RELEASE_BINDING_INVALID,
      "sangtianNarrativeAuthorityCatalog",
      "FINAL_TARGET_HASH_MISMATCH",
    );
  }
}

function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value as Record<string, unknown>)) {
    deepFreeze(child);
  }
  return value;
}
