import {
  PRESSURE_CHAPTER_SEAT_IDS_V1,
  computePressureReplayActionFingerprint,
  isSha256,
  validateFrozenRunRouteV1,
  validatePressureReplayActionV1,
  type ParticipantModeV1,
  type PressureReplayActionV1,
} from "@ai-story/shared";
import type {
  PressureReplayPolicyPort,
  ReplayPolicySourceV1,
  ResultViewerContextV1,
} from "../result";
import {
  PRESSURE_RESULT_READ_ERROR_CODES as ERROR,
  failPressureResultRead,
} from "../result/errors";

const ACTIONS = Object.freeze({
  SAME: Object.freeze({
    actionId: "replay-same",
    type: "RESTART_SAME_EXPERIENCE",
    label: "Replay the same version",
  }),
  LATEST: Object.freeze({
    actionId: "replay-latest",
    type: "START_LATEST_EXPERIENCE",
    label: "Play the latest version",
  }),
  CHANGE_ROLE: Object.freeze({
    actionId: "replay-role",
    type: "CHANGE_ROLE",
    label: "Choose another role",
  }),
  BACK: Object.freeze({
    actionId: "back-worlds",
    type: "BACK_TO_WORLDS",
    label: "Back to worlds",
  }),
} as const);

/** Server-owned Pressure replay CTA policy shared by Result and Command. */
export class SangtianPressureReplayPolicyV1
implements PressureReplayPolicyPort {
  async listActions(
    sourceValue: Readonly<ReplayPolicySourceV1>,
    viewerValue: Readonly<ResultViewerContextV1>,
  ): Promise<readonly PressureReplayActionV1[]> {
    const source = validateSource(sourceValue);
    const viewer = validateViewer(viewerValue, source.runId);
    const launchKind = source.participantMode === "SOLO"
      ? "CREATE_RUN" as const
      : "CREATE_LOBBY" as const;
    const roleEnabled = viewer.allowedReplayRoleIds.length > 0;
    return Object.freeze([
      creationAction({
        ...ACTIONS.SAME,
        targetExperience: "SAME_FROZEN_ROUTE",
        participantMode: source.participantMode,
        launchKind,
        enabled: true,
        disabledReason: null,
      }),
      creationAction({
        ...ACTIONS.LATEST,
        targetExperience: "LATEST_REGISTERED_ROUTE",
        participantMode: source.participantMode,
        launchKind,
        enabled: true,
        disabledReason: null,
      }),
      creationAction({
        ...ACTIONS.CHANGE_ROLE,
        targetExperience: "SAME_FROZEN_ROUTE",
        participantMode: source.participantMode,
        launchKind,
        enabled: roleEnabled,
        disabledReason: roleEnabled ? null : "NO_AVAILABLE_ROLE",
      }),
      action({
        ...ACTIONS.BACK,
        targetExperience: null,
        targetParticipantMode: null,
        launchKind: "NAVIGATE",
        href: "/worlds",
        enabled: true,
        disabledReason: null,
      }),
    ]);
  }
}

function creationAction(input: {
  actionId: string;
  type:
    | "RESTART_SAME_EXPERIENCE"
    | "START_LATEST_EXPERIENCE"
    | "CHANGE_ROLE";
  label: string;
  targetExperience: "SAME_FROZEN_ROUTE" | "LATEST_REGISTERED_ROUTE";
  participantMode: ParticipantModeV1;
  launchKind: "CREATE_RUN" | "CREATE_LOBBY";
  enabled: boolean;
  disabledReason: string | null;
}): PressureReplayActionV1 {
  return action({
    actionId: input.actionId,
    type: input.type,
    label: input.label,
    targetExperience: input.targetExperience,
    targetParticipantMode: input.participantMode,
    launchKind: input.launchKind,
    href: null,
    enabled: input.enabled,
    disabledReason: input.disabledReason,
  });
}

function action(
  input: Omit<
    PressureReplayActionV1,
    "requestSchemaVersion" | "actionFingerprint"
  >,
): PressureReplayActionV1 {
  const withoutFingerprint = {
    ...input,
    requestSchemaVersion: "pressure_replay_command_v1" as const,
  };
  return Object.freeze(validatePressureReplayActionV1({
    ...withoutFingerprint,
    actionFingerprint: computePressureReplayActionFingerprint(withoutFingerprint),
  }));
}

function validateSource(
  value: Readonly<ReplayPolicySourceV1>,
): ReplayPolicySourceV1 {
  if (
    !value
    || typeof value !== "object"
    || !value.runId?.trim()
    || value.worldId !== "sangtian"
    || (value.participantMode !== "SOLO" && value.participantMode !== "MULTIPLAYER")
    || !isSha256(value.frozenRouteHash)
    || !value.resultContractRegistryVersion?.trim()
  ) invalid("replayPolicy.source", "INVALID");
  try {
    validateFrozenRunRouteV1(value.frozenRoute);
  } catch (cause) {
    invalid(
      "replayPolicy.source.frozenRoute",
      cause instanceof Error ? cause.message : "INVALID",
    );
  }
  return structuredClone(value);
}

function validateViewer(
  value: Readonly<ResultViewerContextV1>,
  runId: string,
): ResultViewerContextV1 {
  if (
    !value
    || typeof value !== "object"
    || value.runId !== runId
    || !value.viewerId?.trim()
    || !PRESSURE_CHAPTER_SEAT_IDS_V1.includes(value.seatId)
    || !Array.isArray(value.allowedReplayRoleIds)
    || value.allowedReplayRoleIds.some((seatId) => (
      !PRESSURE_CHAPTER_SEAT_IDS_V1.includes(seatId)
      || seatId === value.seatId
    ))
    || new Set(value.allowedReplayRoleIds).size !== value.allowedReplayRoleIds.length
  ) invalid("replayPolicy.viewer", "INVALID");
  return structuredClone(value);
}

function invalid(path: string, detail: string): never {
  return failPressureResultRead(ERROR.REPLAY_ACTION_NOT_ISSUED, path, detail);
}
