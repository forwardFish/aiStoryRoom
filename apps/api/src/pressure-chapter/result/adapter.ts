import {
  computePressurePresentationHash,
  computePressureStructuredResultHash,
  validateSangtianPressureResultEnvelopeV1,
  type PressureReplayActionV1,
  type SangtianPressureResultEnvelopeV1,
  type SangtianPressureResultV1,
} from "@ai-story/shared";
import {
  PRESSURE_RESULT_READ_ERROR_CODES as ERROR,
  failPressureResultRead,
} from "./errors";
import type { ViewerSafePressureProjectionV1 } from "./audience-projector";
import type { ResultContractBindingV1 } from "./registry";

export const SANGTIAN_PRESSURE_RESULT_ADAPTER_KEY_V1 =
  "SangtianPressureResultV1Adapter" as const;

export interface PressureResultAdapterInputV1 {
  projection: Readonly<ViewerSafePressureProjectionV1>;
  replayActions: readonly PressureReplayActionV1[];
  binding: Readonly<ResultContractBindingV1>;
}

/** A field mapper and validator only; it has no adjudication or persistence port. */
export class SangtianPressureResultV1Adapter {
  readonly adapterKey = SANGTIAN_PRESSURE_RESULT_ADAPTER_KEY_V1;

  assemble(input: PressureResultAdapterInputV1): SangtianPressureResultEnvelopeV1 {
    if (input.binding.adapterKey !== this.adapterKey) {
      failPressureResultRead(
        ERROR.RESULT_ADAPTER_UNAVAILABLE,
        "binding.adapterKey",
        input.binding.adapterKey,
      );
    }
    if (
      input.binding.payloadSchemaVersion !== "sangtian_pressure_result_v1" ||
      input.binding.presentationSchemaVersion !== "sangtian_pressure_result_v1" ||
      input.binding.rendererKey !== "sangtian_pressure_endgame_v1"
    ) {
      failPressureResultRead(ERROR.RESULT_ADAPTER_UNAVAILABLE, "binding", "PRESSURE_BINDING_REQUIRED");
    }

    const payload: SangtianPressureResultV1 = {
      schemaVersion: "sangtian_pressure_result_v1",
      resultType:
        input.projection.room.participantMode === "SOLO"
          ? "SANGTIAN_PRESSURE_SOLO_END"
          : "SANGTIAN_PRESSURE_SHARED_END",
      room: structuredClone(input.projection.room),
      route: structuredClone(input.projection.route),
      worldOutcome: structuredClone(input.projection.worldOutcome),
      tracks: structuredClone(input.projection.tracks),
      viewerSeat: structuredClone(input.projection.viewerSeat),
      visibleOutcomes: structuredClone(input.projection.visibleOutcomes),
      reveal: structuredClone(input.projection.reveal),
      narrative: structuredClone(input.projection.narrative),
      replayHint: input.projection.replayHint,
      replayActions: input.replayActions.map((action) => structuredClone(action)),
      continueNextPartCapability: null,
      decisionHash: input.projection.decisionHash,
      structuredResultHash: "0".repeat(64),
      presentationHash: null,
    };
    payload.structuredResultHash = computePressureStructuredResultHash(payload);
    if (
      payload.narrative.status === "PUBLISHED" ||
      payload.narrative.status === "FALLBACK_PUBLISHED"
    ) {
      payload.presentationHash = computePressurePresentationHash(payload);
    }

    const envelope: SangtianPressureResultEnvelopeV1 = {
      envelopeSchemaVersion: "endgame_result_envelope_v1",
      roomId: input.projection.envelopeMetadata.roomId,
      runId: input.projection.envelopeMetadata.runId,
      worldId: input.projection.envelopeMetadata.worldId,
      frozenRoute: structuredClone(input.projection.envelopeMetadata.frozenRoute),
      resultContractRegistryVersion:
        input.projection.envelopeMetadata.resultContractRegistryVersion,
      payloadSchemaVersion: "sangtian_pressure_result_v1",
      presentationSchemaVersion: "sangtian_pressure_result_v1",
      rendererKey: "sangtian_pressure_endgame_v1",
      authoritativeResultStatus: "FINALIZED",
      runtimeTerminalState: "FINALE_FROZEN",
      narrativeStatus: payload.narrative.status,
      sourceCommitHash: input.projection.envelopeMetadata.sourceCommitHash,
      decisionHash: input.projection.envelopeMetadata.decisionHash,
      presentationHash: payload.presentationHash,
      payload,
    };
    return deepFreeze(
      validateSangtianPressureResultEnvelopeV1(envelope),
    );
  }
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) {
      deepFreeze(child);
    }
  }
  return value;
}
