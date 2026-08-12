import type { PrismaService } from "../../prisma.service";
import type { PressureLiveClockV1 } from "../live-adapters";
import { PressureGenericFinaleShadowReadOnlyAdapterV1 } from "../generic-shadow";
import {
  createPressureReplayProductionBundleV1,
  type PressureReplayProductionOptionsV1,
} from "../replay-production";
import { PrismaAuthoritativeChapterWorldReaderV1 } from "./authoritative-world.prisma-adapter";
import { FailClosedSangtianAEmotionObserverResolverV1 } from "./a-emotion-observer.stage-policy";
import { PrismaDeterministicDefaultAuthorityAdapterV1 } from "./default-authority.prisma-adapter";
import { FrozenSangtianFinaleConfigurationResolverV1 } from "./finale-configuration.release-adapter";
import { PrismaDurableN7FinaleHandoffReaderV1 } from "./n7-finale-handoff.prisma-adapter";
import {
  createPressureChapterNarrativeProductionBundleV1,
  type PressureChapterNarrativeProductionOptionsV1,
} from "./narrative-production.bundle";
import {
  ContentBoundSeatPrivateProjectionPortV1,
  SangtianFrozenSeatPresentationCatalogV1,
} from "./seat-private-content.adapters";
import {
  FrozenAEmotionPresentationAdapterV1,
  PrismaAEmotionSeatDeliveryBindingAdapterV1,
  PrismaAEmotionStoryDayAdapterV1,
  PrismaProductPressureGameCapabilityReaderV1,
} from "./live-and-a-emotion.adapters";

export interface PressureChapterInternalProductionAdapterOptionsV1 {
  capabilityClock?: PressureLiveClockV1;
  narrative?: PressureChapterNarrativeProductionOptionsV1;
  replay?: PressureReplayProductionOptionsV1;
}

export async function createPressureChapterInternalProductionPortsV1(
  prisma: PrismaService,
  options: PressureChapterInternalProductionAdapterOptionsV1 = {},
) {
  const narrative = await createPressureChapterNarrativeProductionBundleV1(
    prisma,
    options.narrative,
  );
  const replay = createPressureReplayProductionBundleV1(prisma, options.replay);
  return Object.freeze({
    replayPolicy: replay.replayPolicy,
    replayTargetRouteResolver: replay.replayTargetRouteResolver,
    replayTargetFactory: replay.replayTargetFactory,
    narrativeProjectorVersion: narrative.narrativeProjectorVersion,
    narrativeOutboxSignal: narrative.narrativeOutboxSignal,
    narrativeSnapshotCompiler: narrative.narrativeSnapshotCompiler,
    openNovelNarrativeProjector: narrative.openNovelNarrativeProjector,
    narrativeConsumer: narrative.consumer,
    narrativeWorker: narrative.worker,
    narrativeExecution: narrative.execution,
    narrativeProviderMode: narrative.providerMode,
    authoritativeChapterWorld: new PrismaAuthoritativeChapterWorldReaderV1(prisma),
    deterministicDefaultAuthority: new PrismaDeterministicDefaultAuthorityAdapterV1(prisma),
    n7FinaleHandoff: new PrismaDurableN7FinaleHandoffReaderV1(prisma),
    finaleConfiguration: new FrozenSangtianFinaleConfigurationResolverV1(),
    genericFinaleShadow: new PressureGenericFinaleShadowReadOnlyAdapterV1(),
    gameCapabilities: new PrismaProductPressureGameCapabilityReaderV1(prisma, options.capabilityClock),
    seatPresentationCatalog: new SangtianFrozenSeatPresentationCatalogV1(prisma),
    seatPrivateProjection: new ContentBoundSeatPrivateProjectionPortV1(prisma),
    aEmotionSeatBindings: new PrismaAEmotionSeatDeliveryBindingAdapterV1(prisma),
    aEmotionStoryDay: new PrismaAEmotionStoryDayAdapterV1(prisma),
    aEmotionObserverResolver: new FailClosedSangtianAEmotionObserverResolverV1(),
    aEmotionPresentation: new FrozenAEmotionPresentationAdapterV1(),
  });
}
