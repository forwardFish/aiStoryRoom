import {
  validatePressureReplayActionV1,
  type PressureReplayActionV1,
  type PressureReplayCommandV1,
} from "@ai-story/shared";
import {
  PRESSURE_RESULT_READ_ERROR_CODES as ERROR,
  failPressureResultRead,
} from "../result/errors";
import type {
  PressureReplayPolicyPort,
  ReplayPolicySourceV1,
  ResultViewerContextV1,
} from "../result/ports";

const ACTION_ORDER: Readonly<Record<PressureReplayActionV1["type"], number>> =
  Object.freeze({
    RESTART_SAME_EXPERIENCE: 0,
    START_LATEST_EXPERIENCE: 1,
    CHANGE_ROLE: 2,
    BACK_TO_WORLDS: 3,
  });

export interface AuthorizedReplayCommandV1 {
  action: PressureReplayActionV1;
  requestedRoleId: PressureReplayCommandV1["requestedRoleId"];
}

/** Recomputes server-issued replay actions for both Result CTA and Command. */
export class PressureReplayPolicyEvaluatorV1 {
  private readonly navigationAllowlist: ReadonlySet<string>;

  constructor(
    private readonly policy: PressureReplayPolicyPort,
    navigationAllowlist: readonly string[] = ["/worlds"],
  ) {
    this.navigationAllowlist = new Set(navigationAllowlist);
  }

  async listActions(
    source: Readonly<ReplayPolicySourceV1>,
    viewer: Readonly<ResultViewerContextV1>,
  ): Promise<PressureReplayActionV1[]> {
    const raw = await this.policy.listActions(source, viewer);
    if (!Array.isArray(raw)) {
      failPressureResultRead(ERROR.REPLAY_ACTION_NOT_ISSUED, "replayActions", "ARRAY_REQUIRED");
    }
    const actions = raw.map((entry, index) =>
      validatePressureReplayActionV1(entry, `replayActions[${index}]`),
    );
    const actionIds = new Set<string>();
    const types = new Set<string>();
    for (const action of actions) {
      if (actionIds.has(action.actionId) || types.has(action.type)) {
        failPressureResultRead(ERROR.REPLAY_ACTION_NOT_ISSUED, "replayActions", "DUPLICATE_ACTION");
      }
      actionIds.add(action.actionId);
      types.add(action.type);
      this.assertActionMatchesSource(action, source);
    }
    return actions
      .map((action) => structuredClone(action))
      .sort((left, right) => ACTION_ORDER[left.type] - ACTION_ORDER[right.type]);
  }

  async authorizeCommand(
    source: Readonly<ReplayPolicySourceV1>,
    viewer: Readonly<ResultViewerContextV1>,
    command: Readonly<PressureReplayCommandV1>,
  ): Promise<AuthorizedReplayCommandV1> {
    const actions = await this.listActions(source, viewer);
    const action = actions.find((candidate) => candidate.actionId === command.actionId);
    if (!action || action.actionFingerprint !== command.actionFingerprint) {
      failPressureResultRead(
        ERROR.REPLAY_ACTION_NOT_ISSUED,
        "replayCommand.actionFingerprint",
        "SERVER_ACTION_MISMATCH",
      );
    }
    if (!action.enabled) {
      failPressureResultRead(
        ERROR.REPLAY_ACTION_DISABLED,
        "replayCommand.actionId",
        action.disabledReason ?? "DISABLED",
      );
    }
    if (action.type === "CHANGE_ROLE") {
      if (
        command.requestedRoleId === null ||
        command.requestedRoleId === viewer.seatId ||
        !viewer.allowedReplayRoleIds.includes(command.requestedRoleId)
      ) {
        failPressureResultRead(
          ERROR.REPLAY_ROLE_NOT_ALLOWED,
          "replayCommand.requestedRoleId",
        );
      }
    } else if (command.requestedRoleId !== null) {
      failPressureResultRead(
        ERROR.REPLAY_ROLE_NOT_ALLOWED,
        "replayCommand.requestedRoleId",
        "ONLY_CHANGE_ROLE_ACCEPTS_ROLE",
      );
    }
    return { action: structuredClone(action), requestedRoleId: command.requestedRoleId };
  }

  private assertActionMatchesSource(
    action: PressureReplayActionV1,
    source: Readonly<ReplayPolicySourceV1>,
  ): void {
    if (action.launchKind === "NAVIGATE") {
      if (!action.href || !this.navigationAllowlist.has(action.href)) {
        failPressureResultRead(
          ERROR.REPLAY_ACTION_NOT_ISSUED,
          "replayAction.href",
          "NAVIGATION_NOT_ALLOWLISTED",
        );
      }
      return;
    }
    if (action.targetParticipantMode !== source.participantMode) {
      failPressureResultRead(
        ERROR.REPLAY_ACTION_NOT_ISSUED,
        "replayAction.targetParticipantMode",
        "PARTICIPANT_MODE_CHANGE_FORBIDDEN",
      );
    }
    const expectedLaunch = source.participantMode === "SOLO" ? "CREATE_RUN" : "CREATE_LOBBY";
    if (action.launchKind !== expectedLaunch) {
      failPressureResultRead(
        ERROR.REPLAY_ACTION_NOT_ISSUED,
        "replayAction.launchKind",
        `EXPECTED_${expectedLaunch}`,
      );
    }
  }
}
