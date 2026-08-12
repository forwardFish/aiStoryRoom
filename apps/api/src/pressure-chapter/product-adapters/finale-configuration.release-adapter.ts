import {
  compareCanonicalText,
  hashWithoutField,
  sha256Canonical,
  validateSangtianFinaleInputV1,
} from "@ai-story/shared";
import {
  compileSangtianContentFinalePolicyV1,
  compileTerminalResultContextV1,
  createPublishedSangtianPressureChapterRegistryV1,
  loadPublishedSangtianActionReleaseV1,
} from "@ai-story/templates";
import type { FrozenFinaleConfigurationResolverPortV1 } from "../persistence";
import {
  PRESSURE_PRODUCT_ADAPTER_ERROR_CODES_V1 as ERROR,
  failPressureProductAdapterV1,
} from "./errors";

/**
 * Content-owned, deterministic Finale configuration for the one published
 * Sangtian Pressure route. The timestamp is supplied by the Serializable N7
 * authority reader and is copied into the terminal context without alteration.
 */
export class FrozenSangtianFinaleConfigurationResolverV1
implements FrozenFinaleConfigurationResolverPortV1 {
  async resolve(
    input: Parameters<FrozenFinaleConfigurationResolverPortV1["resolve"]>[0],
  ): ReturnType<FrozenFinaleConfigurationResolverPortV1["resolve"]> {
    const release = loadPublishedSangtianActionReleaseV1();
    const registry = createPublishedSangtianPressureChapterRegistryV1(
      release.routeConfiguration,
    );
    const route = input.route;
    const registration = release.routeRegistration;
    if (
      route.registryVersion !== registry.registryVersion
      || route.registryHash !== registry.registryHash
      || route.routeKey !== registration.routeKey
      || sha256Canonical(registration) !== sha256Canonical(registry.routes[0])
      || route.snapshot.routeHash !== hashWithoutField(
        route.snapshot as unknown as Record<string, unknown>,
        "routeHash",
      )
      || route.snapshot.contentPackageVersion !== registration.contentPackageVersion
      || route.snapshot.contentPackageSha256 !== registration.contentPackageSha256
      || route.snapshot.orchestrationPackageVersion
        !== registration.orchestrationPackageVersion
      || route.snapshot.orchestrationPackageSha256
        !== registration.orchestrationPackageSha256
      || route.snapshot.runtimeContractVersion !== registration.runtimeContractVersion
      || route.snapshot.runtimeContractSha256 !== registration.runtimeContractSha256
      || route.snapshot.testMatrixVersion !== registration.testMatrixVersion
      || route.snapshot.testMatrixSha256 !== registration.testMatrixSha256
      || route.snapshot.narrativeProfileVersion !== registration.narrativeProfileVersion
      || route.snapshot.featureSetVersion !== registration.featureSetVersion
      || route.snapshot.resultContractRegistryVersion
        !== registration.resultContractRegistryVersion
      || route.snapshot.controlTopologyVersion !== registration.controlTopologyVersion
      || !registration.participantModes.includes(route.snapshot.participantMode)
      || route.handlerKey !== registration.handlerKey
      || route.resultAdapterKey !== registration.resultAdapterKey
      || route.presentationSchemaVersion !== registration.presentationSchemaVersion
      || route.rendererKey !== registration.rendererKey
      || sha256Canonical(route.snapshot.route) !== sha256Canonical(registration.route)
    ) {
      return failPressureProductAdapterV1(
        ERROR.AUTHORITY_MISMATCH,
        "finaleConfiguration.route",
        "PUBLISHED_ROUTE_PIN_MISMATCH",
      );
    }

    const policy = compileSangtianContentFinalePolicyV1({
      contentPackageVersion: route.snapshot.contentPackageVersion,
      contentPackageSha256: route.snapshot.contentPackageSha256,
    });
    const causalEdges = input.frozenChapterBundles
      .flatMap((bundle) => structuredClone(bundle.causalEdges))
      .sort((left, right) => compareCanonicalText(
        `${left.causeRef}\u0000${left.effectRef}\u0000${left.relation}`,
        `${right.causeRef}\u0000${right.effectRef}\u0000${right.relation}`,
      ));
    const finaleInputWithoutHash = {
      schemaVersion: "sangtian_finale_input_v1" as const,
      runId: route.runId,
      routeHash: route.snapshot.routeHash,
      runSeed: route.snapshot.runSeed,
      genesisHash: input.genesisHash,
      frozenChapterBundles: structuredClone(input.frozenChapterBundles),
      finalWorldState: structuredClone(input.finalWorldState),
      causalEdges,
      policyVersion: policy.policyVersion,
      policyHash: policy.policyHash,
    };
    const finaleInput = validateSangtianFinaleInputV1({
      ...finaleInputWithoutHash,
      inputHash: sha256Canonical(finaleInputWithoutHash),
    });
    const terminalResultContext = compileTerminalResultContextV1({
      roomId: route.runId,
      participantMode: route.snapshot.participantMode,
      completedAt: input.terminalCommittedAt,
      frozenRoute: structuredClone(route.snapshot.route),
      resultContractRegistryVersion: route.snapshot.resultContractRegistryVersion,
      narrativeProfileVersion: route.snapshot.narrativeProfileVersion,
      finaleInput,
    });
    return {
      policy: structuredClone(policy),
      terminalResultContext: structuredClone(terminalResultContext),
    };
  }
}
