import { sha256Canonical, type ParticipantModeV1 } from "@ai-story/shared";
import type { PressureChapterRouteRegistrationV1 } from "@ai-story/templates";
import type {
  ReplayResolvedTargetV1,
  ReplayTargetRouteResolverPort,
} from "../replay";
import {
  PRESSURE_RESULT_READ_ERROR_CODES as ERROR,
  failPressureResultRead,
} from "../result/errors";
import {
  buildPressurePinnedRouteRegistrationV1,
  type PressureChapterRouteRegistryPort,
  type RunRouteRepositoryPort,
  type StoredRunRouteRecordV1,
} from "../run-router";

/** Resolves SAME/LATEST exclusively from server-owned stored/published route authority. */
export class AuthoritativePressureReplayTargetRouteResolverV1
implements ReplayTargetRouteResolverPort {
  constructor(
    private readonly routes: RunRouteRepositoryPort,
    private readonly registry: PressureChapterRouteRegistryPort,
  ) {}

  async resolveSamePressureRoute(
    sourceRunId: string,
    participantMode: ParticipantModeV1,
    expectedSourceRouteHash: string,
  ): Promise<ReplayResolvedTargetV1 | null> {
    const source = await this.routes.findByRunId(required(sourceRunId, "sourceRunId"));
    if (!source) return null;
    if (
      source.snapshot.routeHash !== expectedSourceRouteHash ||
      source.snapshot.participantMode !== participantMode
    ) {
      return failPressureResultRead(
        ERROR.REPLAY_TARGET_UNAVAILABLE,
        "replayTarget.sourceRoute",
        "SOURCE_ROUTE_OR_MODE_MISMATCH",
      );
    }
    const registration = resolveStored(this.registry, source);
    assertRegistrationMatchesSource(registration, source, participantMode);
    return buildTarget({
      sourceRunId,
      targetExperience: "SAME_FROZEN_ROUTE",
      participantMode,
      sourceRouteHash: source.snapshot.routeHash,
      registry: this.registry,
      registration,
    });
  }

  async resolveLatestPressureRoute(
    sourceRunId: string,
    participantMode: ParticipantModeV1,
  ): Promise<ReplayResolvedTargetV1 | null> {
    required(sourceRunId, "sourceRunId");
    let registration: PressureChapterRouteRegistrationV1;
    try {
      registration = this.registry.resolveCreate(null, participantMode);
    } catch (cause) {
      return failPressureResultRead(
        ERROR.REPLAY_TARGET_UNAVAILABLE,
        "replayTarget.latestRegistration",
        cause instanceof Error ? cause.message : "UNRESOLVED",
      );
    }
    return buildTarget({
      sourceRunId,
      targetExperience: "LATEST_REGISTERED_ROUTE",
      participantMode,
      sourceRouteHash: null,
      registry: this.registry,
      registration,
    });
  }
}

function resolveStored(
  registry: PressureChapterRouteRegistryPort,
  source: StoredRunRouteRecordV1,
): PressureChapterRouteRegistrationV1 {
  try {
    return registry.resolveStored(source.routeKey, source.snapshot.route);
  } catch (cause) {
    return failPressureResultRead(
      ERROR.REPLAY_TARGET_UNAVAILABLE,
      "replayTarget.sameRegistration",
      cause instanceof Error ? cause.message : "UNRESOLVED",
    );
  }
}

function assertRegistrationMatchesSource(
  registration: PressureChapterRouteRegistrationV1,
  source: StoredRunRouteRecordV1,
  participantMode: ParticipantModeV1,
): void {
  const snapshot = source.snapshot;
  const matches =
    registration.status === "PUBLISHED" &&
    registration.createEnabled === true &&
    registration.participantModes.includes(participantMode) &&
    registration.routeKey === source.routeKey &&
    sha256Canonical(registration.route) === sha256Canonical(snapshot.route) &&
    registration.contentPackageVersion === snapshot.contentPackageVersion &&
    registration.contentPackageSha256 === snapshot.contentPackageSha256 &&
    registration.orchestrationPackageVersion === snapshot.orchestrationPackageVersion &&
    registration.orchestrationPackageSha256 === snapshot.orchestrationPackageSha256 &&
    registration.runtimeContractVersion === snapshot.runtimeContractVersion &&
    registration.runtimeContractSha256 === snapshot.runtimeContractSha256 &&
    registration.testMatrixVersion === snapshot.testMatrixVersion &&
    registration.testMatrixSha256 === snapshot.testMatrixSha256 &&
    registration.narrativeProfileVersion === snapshot.narrativeProfileVersion &&
    registration.featureSetVersion === snapshot.featureSetVersion &&
    registration.resultContractRegistryVersion === snapshot.resultContractRegistryVersion &&
    registration.controlTopologyVersion === snapshot.controlTopologyVersion &&
    registration.handlerKey === source.handlerKey &&
    registration.resultAdapterKey === source.resultAdapterKey &&
    registration.presentationSchemaVersion === source.presentationSchemaVersion &&
    registration.rendererKey === source.rendererKey;
  if (!matches) {
    failPressureResultRead(
      ERROR.REPLAY_TARGET_UNAVAILABLE,
      "replayTarget.sameRegistration",
      "SOURCE_PIN_DRIFT",
    );
  }
}

function buildTarget(input: {
  sourceRunId: string;
  targetExperience: ReplayResolvedTargetV1["targetExperience"];
  participantMode: ParticipantModeV1;
  sourceRouteHash: string | null;
  registry: PressureChapterRouteRegistryPort;
  registration: PressureChapterRouteRegistrationV1;
}): ReplayResolvedTargetV1 {
  const pinnedRegistration = buildPressurePinnedRouteRegistrationV1({
    registryVersion: input.registry.registryVersion,
    registryHash: input.registry.registryHash,
    registration: input.registration,
  });
  const base = {
    schemaVersion: "pressure_replay_route_target_v1" as const,
    sourceRunId: input.sourceRunId,
    targetExperience: input.targetExperience,
    participantMode: input.participantMode,
    pinnedRegistration,
    sourceRouteHash: input.sourceRouteHash,
  };
  return {
    ...base,
    targetDescriptorHash: sha256Canonical(base),
  };
}

function required(value: string, path: string): string {
  if (typeof value !== "string" || !value.trim()) {
    return failPressureResultRead(
      ERROR.REPLAY_TARGET_UNAVAILABLE,
      path,
      "NON_EMPTY_STRING",
    );
  }
  return value.trim();
}
