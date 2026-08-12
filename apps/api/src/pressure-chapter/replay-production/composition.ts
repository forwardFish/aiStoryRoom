import { loadPublishedSangtianActionReleaseV1 } from "@ai-story/templates";
import { createPublishedSangtianRouteRegistryPortV1 } from "../integration";
import {
  PrismaRunRouteRepository,
  type RunRoutePrismaClient,
} from "../persistence";
import {
  PrismaPressureReplayNewTargetFactoryV1,
  type PressureReplayNewTargetFactoryOptionsV1,
} from "./new-target.factory";
import { SangtianPressureReplayPolicyV1 } from "./replay-policy";
import { AuthoritativePressureReplayTargetRouteResolverV1 } from "./route-target.resolver";

export interface PressureReplayProductionOptionsV1
extends PressureReplayNewTargetFactoryOptionsV1 {}

/** Complete production Replay bundle; only server identity generation is injectable. */
export function createPressureReplayProductionBundleV1(
  prisma: RunRoutePrismaClient,
  options: PressureReplayProductionOptionsV1 = {},
) {
  const release = loadPublishedSangtianActionReleaseV1();
  const registry = createPublishedSangtianRouteRegistryPortV1(
    release.routeConfiguration,
  );
  return Object.freeze({
    replayPolicy: new SangtianPressureReplayPolicyV1(),
    replayTargetRouteResolver:
      new AuthoritativePressureReplayTargetRouteResolverV1(
        new PrismaRunRouteRepository(prisma),
        registry,
      ),
    replayTargetFactory: new PrismaPressureReplayNewTargetFactoryV1(options),
  });
}
