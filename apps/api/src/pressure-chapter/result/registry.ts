import {
  PRESSURE_CHAPTER_ROUTE_V1,
  type FrozenRunRouteV1,
} from "@ai-story/shared";
import {
  PRESSURE_RESULT_READ_ERROR_CODES as ERROR,
  failPressureResultRead,
} from "./errors";

export const RESULT_CONTRACT_REGISTRY_VERSION_V1 =
  "result-contract-registry-1.0.0" as const;

export interface ResultContractBindingV1 {
  runtimeProfile: string;
  payloadSchemaVersion:
    | "openovel_result_v2"
    | "continuous_story_result_v3"
    | "sangtian_pressure_result_v1"
    | "endgame_presentation_v3";
  adapterKey:
    | "OpenNovelResultV2Adapter"
    | "ContinuousStoryResultV3Adapter"
    | "SangtianPressureResultV1Adapter"
    | "GenericEndgameV3Adapter";
  presentationSchemaVersion:
    | "endgame_presentation_v1"
    | "sangtian_pressure_result_v1"
    | "endgame_presentation_v3";
  rendererKey:
    | "legacy_openovel_endgame_v1"
    | "legacy_continuous_story_endgame_v1"
    | "sangtian_pressure_endgame_v1"
    | "generic_endgame_v3";
}

export const RESULT_CONTRACT_BINDINGS_V1: readonly ResultContractBindingV1[] =
  Object.freeze([
    Object.freeze({
      runtimeProfile: "OPENNOVEL_T20_V1",
      payloadSchemaVersion: "openovel_result_v2",
      adapterKey: "OpenNovelResultV2Adapter",
      presentationSchemaVersion: "endgame_presentation_v1",
      rendererKey: "legacy_openovel_endgame_v1",
    }),
    Object.freeze({
      runtimeProfile: "CONTINUOUS_STORY_ACTOR_THREAD_V2",
      payloadSchemaVersion: "continuous_story_result_v3",
      adapterKey: "ContinuousStoryResultV3Adapter",
      presentationSchemaVersion: "endgame_presentation_v1",
      rendererKey: "legacy_continuous_story_endgame_v1",
    }),
    Object.freeze({
      runtimeProfile: PRESSURE_CHAPTER_ROUTE_V1.runtimeProfile,
      payloadSchemaVersion: "sangtian_pressure_result_v1",
      adapterKey: "SangtianPressureResultV1Adapter",
      presentationSchemaVersion: "sangtian_pressure_result_v1",
      rendererKey: "sangtian_pressure_endgame_v1",
    }),
    Object.freeze({
      runtimeProfile: "CONFIG_ENDGAME_RUNTIME_V1",
      payloadSchemaVersion: "endgame_presentation_v3",
      adapterKey: "GenericEndgameV3Adapter",
      presentationSchemaVersion: "endgame_presentation_v3",
      rendererKey: "generic_endgame_v3",
    }),
  ] satisfies ResultContractBindingV1[]);

export interface StoredResultContractDeclarationV1 {
  resultContractRegistryVersion: string;
  frozenRoute: FrozenRunRouteV1;
  payloadSchemaVersion: string;
  presentationSchemaVersion: string;
  rendererKey: string;
}

/**
 * Read-side contract selector. There is deliberately no default/fallback entry.
 * A stored Run must match one and only one frozen binding.
 */
export class ResultContractRegistryV1 {
  constructor(
    readonly registryVersion = RESULT_CONTRACT_REGISTRY_VERSION_V1,
    private readonly bindings: readonly ResultContractBindingV1[] =
      RESULT_CONTRACT_BINDINGS_V1,
  ) {
    const keys = new Set<string>();
    for (const binding of bindings) {
      const key = `${binding.runtimeProfile}\u0000${binding.payloadSchemaVersion}`;
      if (keys.has(key)) {
        failPressureResultRead(ERROR.RESULT_REGISTRY_UNAVAILABLE, "resultRegistry", "DUPLICATE_BINDING");
      }
      keys.add(key);
    }
  }

  resolvePressure(
    stored: StoredResultContractDeclarationV1,
  ): ResultContractBindingV1 {
    if (stored.resultContractRegistryVersion !== this.registryVersion) {
      failPressureResultRead(
        ERROR.RESULT_REGISTRY_UNAVAILABLE,
        "resultContractRegistryVersion",
        stored.resultContractRegistryVersion,
      );
    }
    const candidates = this.bindings.filter(
      (binding) =>
        binding.runtimeProfile === stored.frozenRoute.runtimeProfile &&
        binding.payloadSchemaVersion === stored.frozenRoute.resultSchemaVersion,
    );
    if (candidates.length !== 1) {
      failPressureResultRead(
        ERROR.RESULT_REGISTRY_UNAVAILABLE,
        "frozenRoute",
        candidates.length === 0 ? "UNREGISTERED" : "AMBIGUOUS",
      );
    }
    const binding = candidates[0]!;
    if (binding.adapterKey !== "SangtianPressureResultV1Adapter") {
      failPressureResultRead(
        ERROR.RESULT_ADAPTER_UNAVAILABLE,
        "adapterKey",
        binding.adapterKey,
      );
    }
    if (stored.payloadSchemaVersion !== binding.payloadSchemaVersion) {
      failPressureResultRead(
        ERROR.RESULT_ADAPTER_UNAVAILABLE,
        "payloadSchemaVersion",
        stored.payloadSchemaVersion,
      );
    }
    if (stored.presentationSchemaVersion !== binding.presentationSchemaVersion) {
      failPressureResultRead(
        ERROR.RESULT_RENDERER_UNAVAILABLE,
        "presentationSchemaVersion",
        stored.presentationSchemaVersion,
      );
    }
    if (stored.rendererKey !== binding.rendererKey) {
      failPressureResultRead(
        ERROR.RESULT_RENDERER_UNAVAILABLE,
        "rendererKey",
        stored.rendererKey,
      );
    }
    return structuredClone(binding);
  }
}
