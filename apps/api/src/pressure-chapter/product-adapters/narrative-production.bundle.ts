import type { PrismaService } from "../../prisma.service";
import {
  createPrismaPressureNarrativeProductBundleV1,
  type PrismaPressureNarrativeProductBundleInputV1,
  type PressureNarrativeProductBundleV1,
} from "../narrative-production";

export type PressureChapterNarrativeProductionOptionsV1 = Omit<
  PrismaPressureNarrativeProductBundleInputV1,
  "prisma" | "startWorker"
>;

/**
 * Product-owned alias over the complete production Narrative graph. Keeping
 * this seam here lets the root consume four exact ports without knowing the
 * OpenNovel worker's internal composition.
 */
export function createPressureChapterNarrativeProductionBundleV1(
  prisma: PrismaService,
  options: PressureChapterNarrativeProductionOptionsV1 = {},
): Promise<PressureNarrativeProductBundleV1> {
  return createPrismaPressureNarrativeProductBundleV1({
    prisma,
    ...options,
    // Nest/ProductRoot owns the one process lifecycle. Composition must not
    // start an untracked worker before onModuleInit or leak it at shutdown.
    startWorker: false,
  });
}
