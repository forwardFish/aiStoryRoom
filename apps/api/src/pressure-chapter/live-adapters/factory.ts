import type { PrismaService } from "../../prisma.service";
import type {
  PressureGameAEmotionFeedPort,
  PressureGameChapterReaderPort,
  PressureGameViewerReaderPort,
} from "../game-projection/contracts";
import { PressureChapterGameProjectionService } from "../game-projection/game-projection.service";
import type { GenesisAtomicCommitPort } from "../genesis";
import { AEmotionPressureGameFeedReaderAdapterV1 } from "./delegating.adapters";
import { PrismaPressureGameCapabilityReaderV1 } from "./capability.adapter";
import { PrismaPressureGameNarrativeReaderV1 } from "./narrative.adapter";
import {
  createPrismaPressureGameWorldReaderV1,
  PrismaStoredRunRouteReaderAdapterV1,
} from "./route-world.adapters";
import { CommittedGenesisSeatControlAuthorityReaderV1 } from "./seat-control.adapters";
import { PrismaCanonicalSeatViewerAuthorityReaderV1 } from "./viewer-authority.adapter";
import type { AEmotionFeedServiceV1 } from "../a-emotion/feed.service";

/**
 * Minimal Nest-facing read factory. PrismaService is the sole database
 * dependency; chapter/viewer/feed remain explicit authority dependencies.
 */
export function createPressureLiveReadAdaptersFromPrismaV1(
  prisma: PrismaService,
) {
  const canonicalViewers = new PrismaCanonicalSeatViewerAuthorityReaderV1(prisma);
  return {
    routes: new PrismaStoredRunRouteReaderAdapterV1(prisma),
    canonicalViewers,
    world: createPrismaPressureGameWorldReaderV1(prisma),
    narrative: new PrismaPressureGameNarrativeReaderV1(prisma),
    capabilities: new PrismaPressureGameCapabilityReaderV1(prisma, canonicalViewers),
  };
}

export function createCommittedGenesisSeatControlReaderV1(
  genesis: Pick<GenesisAtomicCommitPort, "readCommitted">,
) {
  return new CommittedGenesisSeatControlAuthorityReaderV1(genesis);
}

export function createPressureGameFeedReaderV1(
  feed: Pick<AEmotionFeedServiceV1, "list">,
): PressureGameAEmotionFeedPort {
  return new AEmotionPressureGameFeedReaderAdapterV1(feed);
}

export interface PressureGameLiveServiceDependenciesV1 {
  routes: ReturnType<typeof createPressureLiveReadAdaptersFromPrismaV1>["routes"];
  chapter: PressureGameChapterReaderPort;
  viewer: PressureGameViewerReaderPort;
  world: ReturnType<typeof createPressureLiveReadAdaptersFromPrismaV1>["world"];
  narrative: ReturnType<typeof createPressureLiveReadAdaptersFromPrismaV1>["narrative"];
  feed: PressureGameAEmotionFeedPort;
  capabilities: ReturnType<typeof createPressureLiveReadAdaptersFromPrismaV1>["capabilities"];
}

export function createPressureChapterGameProjectionServiceV1(
  dependencies: PressureGameLiveServiceDependenciesV1,
): PressureChapterGameProjectionService {
  return new PressureChapterGameProjectionService(
    dependencies.routes,
    dependencies.chapter,
    dependencies.viewer,
    dependencies.world,
    dependencies.narrative,
    dependencies.feed,
    dependencies.capabilities,
  );
}
