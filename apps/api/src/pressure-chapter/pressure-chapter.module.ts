import {
  Module,
  type DynamicModule,
  type InjectionToken,
  type ModuleMetadata,
  type Provider,
} from "@nestjs/common";
import { PrismaService } from "../prisma.service";
import {
  PRESSURE_CHAPTER_HTTP_TOKENS,
  PressureChapterHttpControllerMethods,
  PressureChapterHttpFacade,
} from "./http";
import {
  PRESSURE_CHAPTER_PRODUCT_TOKENS,
  createPressureChapterProductRootV1,
  type PressureChapterProductOptionsV1,
  type PressureChapterProductRootV1,
} from "./product";
import { createPressureNarrativeProviderFromEnvV1 } from "./production-config";

export interface PressureChapterModuleOptionsV1
extends Pick<ModuleMetadata, "imports"> {
  productOptions?: Partial<PressureChapterProductOptionsV1>;
}

const HTTP_PORT_BINDINGS = Object.freeze([
  [PRESSURE_CHAPTER_HTTP_TOKENS.ACCESS, "access"],
  [PRESSURE_CHAPTER_HTTP_TOKENS.ROUTES, "routes"],
  [PRESSURE_CHAPTER_HTTP_TOKENS.GAME, "game"],
  [PRESSURE_CHAPTER_HTTP_TOKENS.DECISION_COMPILER, "decisionCompiler"],
  [PRESSURE_CHAPTER_HTTP_TOKENS.ACTIONS, "actions"],
  [PRESSURE_CHAPTER_HTTP_TOKENS.CHAT, "chat"],
  [PRESSURE_CHAPTER_HTTP_TOKENS.RESULT, "result"],
  [PRESSURE_CHAPTER_HTTP_TOKENS.REPLAY, "replay"],
  [PRESSURE_CHAPTER_HTTP_TOKENS.CLOCK, "clock"],
] as const);

/**
 * Nest integration for the one Pressure production composition root.
 *
 * Zero-external production entry point. Every Pressure capability is composed
 * from the one Nest PrismaService plus hash-verified published artifacts.
 */
@Module({})
export class PressureChapterModule {
  static forRoot(
    options: PressureChapterModuleOptionsV1 = {},
  ): DynamicModule {
    const providers: Provider[] = [
      {
        provide: PRESSURE_CHAPTER_PRODUCT_TOKENS.ROOT,
        inject: [PrismaService],
        useFactory: async (
          prisma: PrismaService,
        ) => {
          const narrative = createPressureNarrativeProviderFromEnvV1(process.env);
          const configuredOptions = options.productOptions ?? {};
          return await createPressureChapterProductRootV1({
            prisma,
            options: {
              ...configuredOptions,
              internalAdapters: {
                ...(configuredOptions.internalAdapters ?? {}),
                narrative: {
                  ...(configuredOptions.internalAdapters?.narrative ?? {}),
                  provider: configuredOptions.internalAdapters?.narrative?.provider
                    ?? narrative.provider,
                },
              },
            },
            narrativeProviderReadiness: configuredOptions.internalAdapters?.narrative?.provider
              ? {
                  ready: true,
                  mode: "EXTERNAL_PROVIDER",
                  externalProviderConfigured: true,
                  degraded: false,
                  provider: "deepseek",
                  model: null,
                }
              : narrative.readiness,
          });
        },
      },
      rootBinding(
        PRESSURE_CHAPTER_PRODUCT_TOKENS.PRODUCTION_BRIDGE,
        (root) => root.productionBridge,
      ),
      rootBinding(
        PRESSURE_CHAPTER_PRODUCT_TOKENS.ROOMS_GATEWAY,
        (root) => root.roomsGateway,
      ),
      // The classifier and the Rooms command facade are deliberately the same
      // fail-closed gateway; there is no legacy fallback implementation.
      rootBinding(
        PRESSURE_CHAPTER_PRODUCT_TOKENS.IS_PRESSURE,
        (root) => root.roomsGateway,
      ),
      rootBinding(
        PRESSURE_CHAPTER_PRODUCT_TOKENS.HTTP_CONTROLLER_METHODS,
        (root) => root.httpControllerMethods,
      ),
      rootBinding(
        PRESSURE_CHAPTER_PRODUCT_TOKENS.SEAT_TRANSPORT,
        (root) => root.seatTransport,
      ),
      rootBinding(
        PRESSURE_CHAPTER_PRODUCT_TOKENS.PROMISES,
        (root) => root.promises,
      ),
      rootBinding(
        PRESSURE_CHAPTER_PRODUCT_TOKENS.RUNTIME,
        (root) => root.runtime,
      ),
      rootBinding(
        PRESSURE_CHAPTER_PRODUCT_TOKENS.A_EMOTION_PIPELINE,
        (root) => root.aEmotion.pipeline,
      ),
      rootBinding(
        PRESSURE_CHAPTER_PRODUCT_TOKENS.PROGRESS_WORKER,
        (root) => root.progress.worker,
      ),
      // This is the only object registered with Nest lifecycle hooks. The
      // underlying supervisor remains a child of ProductRoot, preventing a
      // second start/stop sequence for the same timers.
      rootBinding(
        PRESSURE_CHAPTER_PRODUCT_TOKENS.WORKER_LIFECYCLE,
        (root) => root.workerLifecycle,
      ),
      rootBinding(
        PRESSURE_CHAPTER_PRODUCT_TOKENS.OPERATIONAL_READINESS,
        (root) => root.operationalReadiness,
      ),
      rootBinding(PressureChapterHttpFacade, (root) => root.httpFacade),
      rootBinding(
        PressureChapterHttpControllerMethods,
        (root) => root.httpControllerMethods,
      ),
      ...HTTP_PORT_BINDINGS.map(([token, key]) =>
        rootBinding(token, (root) => root.httpPorts[key])),
    ];

    return {
      module: PressureChapterModule,
      imports: options.imports ?? [],
      providers,
      exports: [
        PRESSURE_CHAPTER_PRODUCT_TOKENS.ROOT,
        PRESSURE_CHAPTER_PRODUCT_TOKENS.PRODUCTION_BRIDGE,
        PRESSURE_CHAPTER_PRODUCT_TOKENS.ROOMS_GATEWAY,
        PRESSURE_CHAPTER_PRODUCT_TOKENS.IS_PRESSURE,
        PRESSURE_CHAPTER_PRODUCT_TOKENS.HTTP_CONTROLLER_METHODS,
        PRESSURE_CHAPTER_PRODUCT_TOKENS.SEAT_TRANSPORT,
        PRESSURE_CHAPTER_PRODUCT_TOKENS.PROMISES,
        PRESSURE_CHAPTER_PRODUCT_TOKENS.RUNTIME,
        PRESSURE_CHAPTER_PRODUCT_TOKENS.A_EMOTION_PIPELINE,
        PRESSURE_CHAPTER_PRODUCT_TOKENS.PROGRESS_WORKER,
        PRESSURE_CHAPTER_PRODUCT_TOKENS.WORKER_LIFECYCLE,
        PRESSURE_CHAPTER_PRODUCT_TOKENS.OPERATIONAL_READINESS,
        PressureChapterHttpFacade,
        PressureChapterHttpControllerMethods,
        ...HTTP_PORT_BINDINGS.map(([token]) => token),
      ],
    };
  }
}

function rootBinding(
  provide: InjectionToken,
  select: (root: PressureChapterProductRootV1) => unknown,
): Provider {
  return {
    provide,
    inject: [PRESSURE_CHAPTER_PRODUCT_TOKENS.ROOT],
    useFactory: select,
  };
}
