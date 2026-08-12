import {
  PRESSURE_CHAPTER_ROUTE_V1,
  PRESSURE_CHAPTER_SEAT_IDS_V1,
  TRACK_IDS_V1,
  computePressureReplayActionFingerprint,
  computePressureReplayRequestFingerprint,
  sha256Canonical,
  validateAuthoritativePressureResultSnapshotV1,
  type AuthoritativePressureResultSnapshotV1,
  type NarrativeStatusV1,
  type ParticipantModeV1,
  type PressureReplayActionV1,
  type PressureReplayCommandV1,
  type SeatIdV1,
} from "@ai-story/shared";
import type {
  PressureResultNarrativeReadSetV1,
  PressureResultReadModelInputV1,
  PressureResultReadModelSourceV1,
  ResultViewerContextV1,
} from "./ports";
import { RESULT_CONTRACT_REGISTRY_VERSION_V1 } from "./registry";

export function pressureResultSourceFixture(
  participantMode: ParticipantModeV1 = "MULTIPLAYER",
): AuthoritativePressureResultSnapshotV1 {
  const sourceCommitHash = sha256Canonical("finale-commit");
  const decisionHash = sha256Canonical("finale-decision");
  const frozenSourceHash = sha256Canonical("n7-frozen");
  const frozenRouteHash = sha256Canonical({
    route: PRESSURE_CHAPTER_ROUTE_V1,
    contentPackageVersion: "sangtian_content_v1",
  });
  const impacts = [
    {
      kind: "EVIDENCE" as const,
      outcomeId: "impact-public-record",
      title: "Public record",
      summary: "The common record is now public.",
      sourceRefs: ["fact-public"],
      visibility: "PUBLIC" as const,
      authorizedSeatIds: [] as SeatIdV1[],
      privateOriginSeatId: null,
    },
    ...PRESSURE_CHAPTER_SEAT_IDS_V1.map((seatId) => ({
      kind: "RESPONSIBILITY" as const,
      outcomeId: `impact-private-${seatId}`,
      title: `Authorized impact for ${seatId}`,
      summary: `IMPACT_SECRET_FOR_${seatId}`,
      sourceRefs: [`fact-private-${seatId}`],
      visibility: "AUTHORIZED" as const,
      authorizedSeatIds: [seatId],
      privateOriginSeatId: seatId,
    })),
  ].sort((left, right) =>
    `${left.kind}\u0000${left.outcomeId}` < `${right.kind}\u0000${right.outcomeId}`
      ? -1
      : 1,
  );

  const withoutHash = {
    schemaVersion: "authoritative_pressure_result_snapshot_v1",
    roomId: "room-pressure-1",
    runId: "run-pressure-1",
    worldId: "sangtian",
    participantMode,
    completedAt: "2026-08-12T00:00:00.000Z",
    frozenRoute: structuredClone(PRESSURE_CHAPTER_ROUTE_V1),
    frozenRouteHash,
    resultContractRegistryVersion: RESULT_CONTRACT_REGISTRY_VERSION_V1,
    payloadSchemaVersion: "sangtian_pressure_result_v1",
    presentationSchemaVersion: "sangtian_pressure_result_v1",
    rendererKey: "sangtian_pressure_endgame_v1",
    authoritativeResultStatus: "FINALIZED",
    runtimeTerminalState: "FINALE_FROZEN",
    sourceCommitHash,
    decisionHash,
    terminalContextHash: sha256Canonical("terminal-result-context"),
    contentPackageVersion: "sangtian_content_v1",
    contentPackageSha256: sha256Canonical("sangtian-content-package"),
    worldOutcome: {
      outcomeId: "world-balanced-survival",
      sourceRuleRef: "finale.world-balanced-survival",
      title: "A costly balance",
      verdictLine: "The realm survives at a visible price.",
      summary: "All six institutions changed the same world.",
    },
    tracks: TRACK_IDS_V1.map((trackId) => ({
      trackId,
      label: `Track ${trackId}`,
      level: "MID" as const,
      summary: `Summary for ${trackId}`,
      evidenceRefs: [`evidence-${trackId}`],
    })),
    seatOutcomes: PRESSURE_CHAPTER_SEAT_IDS_V1.map((seatId, index) => ({
      seatId,
      roleKey: `role.${seatId}`,
      roleName: `Role ${index + 1}`,
      verdict: index % 3 === 0 ? "WIN" as const : index % 3 === 1 ? "COSTLY_WIN" as const : "LOSS" as const,
      verdictLabel: `Verdict ${index + 1}`,
      gain: [`SEAT_SECRET_FOR_${seatId}`],
      loss: [`Cost ${index + 1}`],
      causes: [{
        sourceStageId: "N7" as const,
        sourceKind: "CHAPTER_SETTLEMENT" as const,
        chapterSettlementId: "settlement-n7",
        frozenSourceHash,
        sourceDecisionActionIds: [`action-${seatId}`],
        frozenFactRef: `fact-${seatId}`,
        title: `Cause ${index + 1}`,
        factText: `Authorized cause for ${seatId}`,
        direction: index % 2 === 0 ? "HELPED" as const : "HURT" as const,
      }],
    })),
    impacts,
    reveals: PRESSURE_CHAPTER_SEAT_IDS_V1.map((seatId) => ({
      revealId: `reveal-${seatId}`,
      authorizedSeatIds: [seatId],
      title: `Reveal for ${seatId}`,
      text: `REVEAL_SECRET_FOR_${seatId}`,
      sourceRefs: [`reveal-fact-${seatId}`],
    })).sort((left, right) => left.revealId < right.revealId ? -1 : 1),
    replayHint: "Start a new run to explore another choice.",
  };
  return validateAuthoritativePressureResultSnapshotV1({
    ...withoutHash,
    snapshotHash: sha256Canonical(withoutHash),
  });
}

export function pressureNarrativeReadSetFixture(
  authority: AuthoritativePressureResultSnapshotV1 = pressureResultSourceFixture(),
  status: NarrativeStatusV1 = "PENDING",
): PressureResultNarrativeReadSetV1 {
  const published = status === "PUBLISHED" || status === "FALLBACK_PUBLISHED";
  return {
    schemaVersion: "pressure_result_narrative_read_set_v1",
    runId: authority.runId,
    sourceCommitHash: authority.sourceCommitHash,
    sourceDecisionHash: authority.decisionHash,
    narratives: PRESSURE_CHAPTER_SEAT_IDS_V1.map((seatId) => {
      const text = published ? `NARRATIVE_FOR_${seatId}` : null;
      return {
        seatId,
        status,
        text,
        contentHash: text === null ? null : sha256Canonical(text),
        sourceCommitHash: authority.sourceCommitHash,
        sourceDecisionHash: authority.decisionHash,
      };
    }),
  };
}

export function pressureResultReadModelFixture(
  participantMode: ParticipantModeV1 = "MULTIPLAYER",
  status: NarrativeStatusV1 = "PENDING",
): PressureResultReadModelSourceV1 {
  const authority = pressureResultSourceFixture(participantMode);
  return {
    authority,
    narratives: pressureNarrativeReadSetFixture(authority, status).narratives,
  };
}

export function pressureResultReadModelInputFixture(
  participantMode: ParticipantModeV1 = "MULTIPLAYER",
  status: NarrativeStatusV1 = "PENDING",
): PressureResultReadModelInputV1 {
  const authority = pressureResultSourceFixture(participantMode);
  return {
    authority,
    narrativeReadSet: pressureNarrativeReadSetFixture(authority, status),
  };
}

export function viewerFixture(
  seatId: SeatIdV1,
  viewerId = `viewer-${seatId}`,
): ResultViewerContextV1 {
  return {
    runId: "run-pressure-1",
    viewerId,
    seatId,
    authorizedImpactIds: [`impact-private-${seatId}`],
    authorizedRevealIds: [`reveal-${seatId}`],
    allowedReplayRoleIds: PRESSURE_CHAPTER_SEAT_IDS_V1.filter(
      (candidate) => candidate !== seatId,
    ),
  };
}

export function replayActionsFixture(
  participantMode: ParticipantModeV1,
): PressureReplayActionV1[] {
  const launchKind = participantMode === "SOLO" ? "CREATE_RUN" : "CREATE_LOBBY";
  return [
    action({
      actionId: "replay-same",
      requestSchemaVersion: "pressure_replay_command_v1",
      type: "RESTART_SAME_EXPERIENCE",
      label: "Replay the same version",
      targetExperience: "SAME_FROZEN_ROUTE",
      targetParticipantMode: participantMode,
      launchKind,
      href: null,
      enabled: true,
      disabledReason: null,
    }),
    action({
      actionId: "replay-latest",
      requestSchemaVersion: "pressure_replay_command_v1",
      type: "START_LATEST_EXPERIENCE",
      label: "Play the latest version",
      targetExperience: "LATEST_REGISTERED_ROUTE",
      targetParticipantMode: participantMode,
      launchKind,
      href: null,
      enabled: true,
      disabledReason: null,
    }),
    action({
      actionId: "replay-role",
      requestSchemaVersion: "pressure_replay_command_v1",
      type: "CHANGE_ROLE",
      label: "Choose another role",
      targetExperience: "SAME_FROZEN_ROUTE",
      targetParticipantMode: participantMode,
      launchKind,
      href: null,
      enabled: true,
      disabledReason: null,
    }),
    action({
      actionId: "back-worlds",
      requestSchemaVersion: "pressure_replay_command_v1",
      type: "BACK_TO_WORLDS",
      label: "Back to worlds",
      targetExperience: null,
      targetParticipantMode: null,
      launchKind: "NAVIGATE",
      href: "/worlds",
      enabled: true,
      disabledReason: null,
    }),
  ];
}

export function replayCommandFixture(
  action: PressureReplayActionV1,
  options: { idempotencyKey?: string; requestedRoleId?: SeatIdV1 | null } = {},
): PressureReplayCommandV1 {
  const withoutFingerprint: Omit<PressureReplayCommandV1, "requestFingerprint"> = {
    schemaVersion: "pressure_replay_command_v1",
    sourceRunId: "run-pressure-1",
    actionId: action.actionId,
    actionFingerprint: action.actionFingerprint,
    requestedRoleId: options.requestedRoleId ?? null,
    idempotencyKey: options.idempotencyKey ?? "replay-key-1",
  };
  return {
    ...withoutFingerprint,
    requestFingerprint: computePressureReplayRequestFingerprint(withoutFingerprint),
  };
}

function action(
  value: Omit<PressureReplayActionV1, "actionFingerprint">,
): PressureReplayActionV1 {
  return {
    ...value,
    actionFingerprint: computePressureReplayActionFingerprint(value),
  };
}
