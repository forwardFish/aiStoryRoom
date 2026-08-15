import {
  PRESSURE_METRIC_AUTHORITY_ERROR_CODES_V1 as ERROR,
  PressureMetricAuthorityErrorV1,
  assertPressureFinaleScaleCompatibleV1,
  compilePublicTrackMetricDefinitionsV1,
  type PressureFinaleScaleAuditV1,
} from "./metric-authority";
import { loadSangtianPressureChapterPackageV1 } from "./content/loader";

export interface SangtianFrozenFinaleScaleSourceV1 {
  contentPackageSha256: string;
  frozenChapterBundles: readonly Readonly<{
    chapterId: string;
    bundleHash: string;
    frozenWorldState: Readonly<{
      tracks: Readonly<{
        values: Readonly<Record<string, number>>;
      }>;
    }>;
  }>[];
  finalWorldState: Readonly<{
    tracks: Readonly<{
      values: Readonly<Record<string, number>>;
    }>;
  }>;
}

/**
 * Production M0 gate. The accepted package supplies Genesis values and every
 * legal Settlement branch; frozen bundles supply the committed snapshots.
 * No Provider output, page state or caller declaration participates.
 */
export function assertSangtianFinaleMetricScaleCompatibleV1(
  source: Readonly<SangtianFrozenFinaleScaleSourceV1>,
): Readonly<PressureFinaleScaleAuditV1> {
  const loaded = loadSangtianPressureChapterPackageV1();
  if (source.contentPackageSha256 !== loaded.manifest.contentSha256) {
    throw new PressureMetricAuthorityErrorV1(
      ERROR.CONTRACT_INVALID,
      "finaleScale.contentPackageSha256",
      `EXPECTED_${loaded.manifest.contentSha256}`,
    );
  }
  if (source.frozenChapterBundles.length !== loaded.content.chapters.length) {
    throw new PressureMetricAuthorityErrorV1(
      ERROR.CONTRACT_INVALID,
      "finaleScale.frozenChapterBundles",
      `EXPECTED_${loaded.content.chapters.length}`,
    );
  }
  const lastBundle = source.frozenChapterBundles.at(-1);
  if (
    !lastBundle
    || !sameTrackValues(
      lastBundle.frozenWorldState.tracks.values,
      source.finalWorldState.tracks.values,
    )
  ) {
    throw new PressureMetricAuthorityErrorV1(
      ERROR.CONTRACT_INVALID,
      "finaleScale.finalWorldState",
      "LAST_BUNDLE_MISMATCH",
    );
  }
  const definitions = compilePublicTrackMetricDefinitionsV1(
    loaded.content.genesis.tracks,
    loaded.content.finale.worldOutcomeRuleRefs,
  );
  return assertPressureFinaleScaleCompatibleV1({
    definitions,
    chapters: source.frozenChapterBundles.map((bundle, index) => {
      const chapter = loaded.content.chapters[index]!;
      if (bundle.chapterId !== chapter.chapterId) {
        throw new PressureMetricAuthorityErrorV1(
          ERROR.CONTRACT_INVALID,
          `finaleScale.frozenChapterBundles[${index}].chapterId`,
          `EXPECTED_${chapter.chapterId}`,
        );
      }
      return {
        chapterId: bundle.chapterId,
        snapshotValues: bundle.frozenWorldState.tracks.values,
        snapshotEvidenceRef: bundle.bundleHash,
        settlementBranches: chapter.settlementPolicy.branches.map((branch) => ({
          branchRef: branch.branchId,
          delta: branch.trackDelta,
        })),
      };
    }),
  });
}

function sameTrackValues(
  left: Readonly<Record<string, number>>,
  right: Readonly<Record<string, number>>,
): boolean {
  const keys = [...new Set([...Object.keys(left), ...Object.keys(right)])].sort();
  return keys.every((key) => left[key] === right[key]);
}
