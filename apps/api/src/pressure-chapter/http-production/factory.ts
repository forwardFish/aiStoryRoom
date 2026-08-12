import type { InjectionToken, Provider } from "@nestjs/common";
import { PRESSURE_CHAPTER_HTTP_TOKENS } from "../http/contracts";
import { PrismaPressureChapterHttpAccessAdapterV1 } from "./access.adapter";
import { SystemPressureChapterHttpClockV1 } from "./clock.adapter";
import type { PressureChapterHttpProductionPrismaPortV1 } from "./ports";

export function createPressureChapterHttpProductionAdaptersV1(
  prisma: PressureChapterHttpProductionPrismaPortV1,
) {
  return {
    access: new PrismaPressureChapterHttpAccessAdapterV1(prisma),
    clock: new SystemPressureChapterHttpClockV1(),
  };
}

/** Providers can be spread into AppModule once that integration is authorized. */
export function createPressureChapterHttpProductionProvidersV1(
  prismaToken: InjectionToken,
): Provider[] {
  return [
    {
      provide: PRESSURE_CHAPTER_HTTP_TOKENS.ACCESS,
      inject: [prismaToken],
      useFactory: (prisma: PressureChapterHttpProductionPrismaPortV1) => (
        new PrismaPressureChapterHttpAccessAdapterV1(prisma)
      ),
    },
    {
      provide: PRESSURE_CHAPTER_HTTP_TOKENS.CLOCK,
      useClass: SystemPressureChapterHttpClockV1,
    },
  ];
}
