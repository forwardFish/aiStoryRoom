import { hashWithoutField, sha256Canonical } from "./canonical";
import {
  PRESSURE_CHAPTER_CONTRACT_ERROR_CODES as ERROR,
  failPressureContract,
} from "./errors";
import {
  TRACK_IDS_V1,
  validateSeatIdV1,
  validateTrackIdV1,
  type SeatIdV1,
  type TrackIdV1,
} from "./domain";
import {
  NARRATIVE_STATUSES_V1,
  type NarrativeStatusV1,
} from "./narrative";
import {
  PRESSURE_CHAPTER_ROUTE_V1,
  type FrozenRunRouteV1,
  type ParticipantModeV1,
} from "./route";
import {
  assertHashEqual,
  assertOrderedBy,
  assertSelfHash,
  contractArray,
  contractBoolean,
  contractEnum,
  contractLiteral,
  contractObject,
  contractSha256,
  contractString,
  contractStringArray,
  contractVersion,
  exactContractKeys,
  isoTimestamp,
  type RawContract,
} from "./validation";

export type PressureResultType =
  | "SANGTIAN_PRESSURE_SOLO_END"
  | "SANGTIAN_PRESSURE_SHARED_END";

export interface PressureResultCauseV1 {
  sourceStageId: "P0" | "N1" | "N2" | "N3" | "N4" | "N5" | "N6" | "N7";
  sourceKind: "GENESIS" | "CHAPTER_SETTLEMENT";
  chapterSettlementId: string | null;
  frozenSourceHash: string;
  sourceDecisionActionIds: string[];
  frozenFactRef: string;
  title: string;
  factText: string;
  direction: "HELPED" | "HURT" | "DECISIVE";
}

export interface PressureReplayActionV1 {
  actionId: string;
  requestSchemaVersion: "pressure_replay_command_v1";
  type:
    | "RESTART_SAME_EXPERIENCE"
    | "START_LATEST_EXPERIENCE"
    | "CHANGE_ROLE"
    | "BACK_TO_WORLDS";
  label: string;
  targetExperience: "SAME_FROZEN_ROUTE" | "LATEST_REGISTERED_ROUTE" | null;
  targetParticipantMode: ParticipantModeV1 | null;
  launchKind: "CREATE_RUN" | "CREATE_LOBBY" | "NAVIGATE";
  href: string | null;
  enabled: boolean;
  disabledReason: string | null;
  actionFingerprint: string;
}

export interface PressureReplayCommandV1 {
  schemaVersion: "pressure_replay_command_v1";
  sourceRunId: string;
  actionId: string;
  actionFingerprint: string;
  requestedRoleId: SeatIdV1 | null;
  idempotencyKey: string;
  requestFingerprint: string;
}

export interface ReplayCreationReceiptV1 {
  schemaVersion: "replay_creation_receipt_v1";
  sourceRunId: string;
  actionId: string;
  launchKind: "CREATE_RUN" | "CREATE_LOBBY" | "NAVIGATE";
  createdRunId: string | null;
  createdLobbyId: string | null;
  navigationTarget: string | null;
  frozenTargetRouteHash: string | null;
  receiptHash: string;
}

export interface SangtianPressureResultV1 {
  schemaVersion: "sangtian_pressure_result_v1";
  resultType: PressureResultType;
  room: {
    roomId: string;
    runId: string;
    worldId: "sangtian";
    participantMode: ParticipantModeV1;
    completedAt: string;
  };
  route: {
    engineVersion: string;
    strategyVersion: string;
    runtimeProfile: "SANGTIAN_CONTINUOUS_CHAPTER_V1";
    endgamePolicyVersion: string;
    contentPackageVersion: string;
    contentPackageSha256: string;
  };
  worldOutcome: {
    outcomeId: string;
    title: string;
    verdictLine: string;
    summary: string;
  };
  tracks: Array<{
    trackId: TrackIdV1;
    label: string;
    level: "LOW" | "MID" | "HIGH";
    summary: string;
    evidenceRefs: string[];
  }>;
  viewerSeat: {
    seatId: SeatIdV1;
    roleKey: string;
    roleName: string;
    verdict: "WIN" | "COSTLY_WIN" | "LOSS";
    verdictLabel: string;
    gain: string[];
    loss: string[];
    causes: PressureResultCauseV1[];
  };
  visibleOutcomes: Array<{
    kind: "OBJECT" | "EVIDENCE" | "RESPONSIBILITY";
    outcomeId: string;
    title: string;
    summary: string;
    sourceRefs: string[];
  }>;
  reveal: null | {
    title: string;
    text: string;
    sourceRefs: string[];
  };
  narrative: {
    status: NarrativeStatusV1;
    text: string | null;
    contentHash: string | null;
    sourceCommitHash: string;
    sourceDecisionHash: string;
  };
  replayHint: string;
  replayActions: PressureReplayActionV1[];
  continueNextPartCapability: null;
  decisionHash: string;
  structuredResultHash: string;
  presentationHash: string | null;
}

export interface EndgameResultEnvelopeV1<TPayload = unknown> {
  envelopeSchemaVersion: "endgame_result_envelope_v1";
  roomId: string;
  runId: string;
  worldId: string;
  frozenRoute: FrozenRunRouteV1;
  resultContractRegistryVersion: string;
  payloadSchemaVersion:
    | "openovel_result_v2"
    | "continuous_story_result_v3"
    | "sangtian_pressure_result_v1"
    | "endgame_presentation_v3";
  presentationSchemaVersion:
    | "endgame_presentation_v1"
    | "sangtian_pressure_result_v1"
    | "endgame_presentation_v3";
  rendererKey:
    | "legacy_openovel_endgame_v1"
    | "legacy_continuous_story_endgame_v1"
    | "sangtian_pressure_endgame_v1"
    | "generic_endgame_v3";
  authoritativeResultStatus: "FINALIZED";
  runtimeTerminalState:
    | "FINALE_FROZEN"
    | "PART_COMPLETE"
    | "STORY_COMPLETE"
    | "RESULT_READY"
    | "COMPLETED"
    | "GENERIC_ENDGAME_FINALIZED";
  narrativeStatus: NarrativeStatusV1;
  sourceCommitHash: string;
  decisionHash: string;
  presentationHash: string | null;
  payload: TPayload;
}

export type SangtianPressureResultEnvelopeV1 = EndgameResultEnvelopeV1<SangtianPressureResultV1>;

export function computePressureReplayActionFingerprint(
  action: Omit<PressureReplayActionV1, "actionFingerprint">,
): string {
  return sha256Canonical(action);
}

export function validatePressureReplayActionV1(
  value: unknown,
  path = "replayAction",
): PressureReplayActionV1 {
  const action = contractObject(value, path);
  exactContractKeys(action, [
    "actionId",
    "requestSchemaVersion",
    "type",
    "label",
    "targetExperience",
    "targetParticipantMode",
    "launchKind",
    "href",
    "enabled",
    "disabledReason",
    "actionFingerprint",
  ], path);
  contractString(action.actionId, `${path}.actionId`);
  contractLiteral(action.requestSchemaVersion, "pressure_replay_command_v1", `${path}.requestSchemaVersion`);
  const type = contractEnum(action.type, [
    "RESTART_SAME_EXPERIENCE",
    "START_LATEST_EXPERIENCE",
    "CHANGE_ROLE",
    "BACK_TO_WORLDS",
  ] as const, `${path}.type`);
  contractString(action.label, `${path}.label`);
  const targetExperience = action.targetExperience === null
    ? null
    : contractEnum(
        action.targetExperience,
        ["SAME_FROZEN_ROUTE", "LATEST_REGISTERED_ROUTE"] as const,
        `${path}.targetExperience`,
      );
  const participantMode = action.targetParticipantMode === null
    ? null
    : contractEnum(action.targetParticipantMode, ["SOLO", "MULTIPLAYER"] as const, `${path}.targetParticipantMode`);
  const launchKind = contractEnum(
    action.launchKind,
    ["CREATE_RUN", "CREATE_LOBBY", "NAVIGATE"] as const,
    `${path}.launchKind`,
  );
  if (action.href !== null) contractString(action.href, `${path}.href`);
  const enabled = contractBoolean(action.enabled, `${path}.enabled`);
  if (action.disabledReason !== null) contractString(action.disabledReason, `${path}.disabledReason`);
  if (enabled && action.disabledReason !== null) {
    failPressureContract(ERROR.CONTRACT_FIELD_INVALID, `${path}.disabledReason`, "ENABLED_REQUIRES_NULL");
  }
  if (!enabled && action.disabledReason === null) {
    failPressureContract(ERROR.CONTRACT_FIELD_INVALID, `${path}.disabledReason`, "DISABLED_REQUIRES_REASON");
  }
  if (launchKind === "NAVIGATE") {
    if (action.href === null || targetExperience !== null || participantMode !== null) {
      failPressureContract(ERROR.CONTRACT_FIELD_INVALID, path, "NAVIGATE_TARGET_MISMATCH");
    }
  } else if (targetExperience === null || participantMode === null || action.href !== null) {
    failPressureContract(ERROR.CONTRACT_FIELD_INVALID, path, "CREATE_TARGET_MISMATCH");
  }
  if (
    (type === "RESTART_SAME_EXPERIENCE" && targetExperience !== "SAME_FROZEN_ROUTE") ||
    (type === "START_LATEST_EXPERIENCE" && targetExperience !== "LATEST_REGISTERED_ROUTE") ||
    (type === "BACK_TO_WORLDS" && launchKind !== "NAVIGATE")
  ) {
    failPressureContract(ERROR.CONTRACT_REFERENCE_MISMATCH, path, "TYPE_TARGET_MISMATCH");
  }
  const typed = action as unknown as PressureReplayActionV1;
  assertHashEqual(
    action.actionFingerprint,
    computePressureReplayActionFingerprint(
      Object.fromEntries(
        Object.entries(typed).filter(([key]) => key !== "actionFingerprint"),
      ) as unknown as Omit<PressureReplayActionV1, "actionFingerprint">,
    ),
    `${path}.actionFingerprint`,
    ERROR.CONTRACT_FINGERPRINT_MISMATCH,
  );
  return typed;
}

export function computePressureReplayRequestFingerprint(
  command: Omit<PressureReplayCommandV1, "requestFingerprint">,
): string {
  return sha256Canonical(command);
}

export function validatePressureReplayCommandV1(value: unknown): PressureReplayCommandV1 {
  const command = contractObject(value, "replayCommand");
  exactContractKeys(command, [
    "schemaVersion",
    "sourceRunId",
    "actionId",
    "actionFingerprint",
    "requestedRoleId",
    "idempotencyKey",
    "requestFingerprint",
  ], "replayCommand");
  contractLiteral(
    command.schemaVersion,
    "pressure_replay_command_v1",
    "replayCommand.schemaVersion",
    ERROR.SCHEMA_VERSION_UNSUPPORTED,
  );
  for (const field of ["sourceRunId", "actionId", "idempotencyKey"] as const) {
    contractString(command[field], `replayCommand.${field}`);
  }
  contractSha256(command.actionFingerprint, "replayCommand.actionFingerprint");
  if (command.requestedRoleId !== null) {
    validateSeatIdV1(command.requestedRoleId, "replayCommand.requestedRoleId");
  }
  const typed = command as unknown as PressureReplayCommandV1;
  const withoutFingerprint = Object.fromEntries(
    Object.entries(typed).filter(([key]) => key !== "requestFingerprint"),
  ) as unknown as Omit<PressureReplayCommandV1, "requestFingerprint">;
  assertHashEqual(
    command.requestFingerprint,
    computePressureReplayRequestFingerprint(withoutFingerprint),
    "replayCommand.requestFingerprint",
    ERROR.CONTRACT_FINGERPRINT_MISMATCH,
  );
  return typed;
}

export function validateReplayCreationReceiptV1(value: unknown): ReplayCreationReceiptV1 {
  const receipt = contractObject(value, "replayReceipt");
  exactContractKeys(receipt, [
    "schemaVersion",
    "sourceRunId",
    "actionId",
    "launchKind",
    "createdRunId",
    "createdLobbyId",
    "navigationTarget",
    "frozenTargetRouteHash",
    "receiptHash",
  ], "replayReceipt");
  contractLiteral(
    receipt.schemaVersion,
    "replay_creation_receipt_v1",
    "replayReceipt.schemaVersion",
    ERROR.SCHEMA_VERSION_UNSUPPORTED,
  );
  contractString(receipt.sourceRunId, "replayReceipt.sourceRunId");
  contractString(receipt.actionId, "replayReceipt.actionId");
  const launchKind = contractEnum(
    receipt.launchKind,
    ["CREATE_RUN", "CREATE_LOBBY", "NAVIGATE"] as const,
    "replayReceipt.launchKind",
  );
  for (const field of ["createdRunId", "createdLobbyId", "navigationTarget"] as const) {
    if (receipt[field] !== null) contractString(receipt[field], `replayReceipt.${field}`);
  }
  if (receipt.frozenTargetRouteHash !== null) {
    contractSha256(receipt.frozenTargetRouteHash, "replayReceipt.frozenTargetRouteHash");
  }
  const valid = launchKind === "CREATE_RUN"
    ? receipt.createdRunId !== null && receipt.createdLobbyId === null && receipt.navigationTarget === null && receipt.frozenTargetRouteHash !== null
    : launchKind === "CREATE_LOBBY"
      ? receipt.createdRunId === null && receipt.createdLobbyId !== null && receipt.navigationTarget === null && receipt.frozenTargetRouteHash !== null
      : receipt.createdRunId === null && receipt.createdLobbyId === null && receipt.navigationTarget !== null && receipt.frozenTargetRouteHash === null;
  if (!valid) {
    failPressureContract(ERROR.CONTRACT_FIELD_INVALID, "replayReceipt", "LAUNCH_RECEIPT_MISMATCH");
  }
  assertSelfHash(receipt, "receiptHash", "replayReceipt");
  return receipt as unknown as ReplayCreationReceiptV1;
}

export function computePressureStructuredResultHash(
  result: SangtianPressureResultV1,
): string {
  return sha256Canonical({
    schemaVersion: result.schemaVersion,
    resultType: result.resultType,
    room: result.room,
    route: result.route,
    worldOutcome: result.worldOutcome,
    tracks: result.tracks,
    viewerSeat: result.viewerSeat,
    visibleOutcomes: result.visibleOutcomes,
    reveal: result.reveal,
    decisionHash: result.decisionHash,
  });
}

export function computePressurePresentationHash(
  result: SangtianPressureResultV1,
): string {
  return sha256Canonical({
    structuredResultHash: result.structuredResultHash,
    narrative: result.narrative,
    replayHint: result.replayHint,
    replayActions: result.replayActions,
    continueNextPartCapability: result.continueNextPartCapability,
  });
}

export function validateSangtianPressureResultV1(
  value: unknown,
  expectedDecisionHash?: string,
): SangtianPressureResultV1 {
  const result = contractObject(value, "pressureResult");
  exactContractKeys(result, [
    "schemaVersion",
    "resultType",
    "room",
    "route",
    "worldOutcome",
    "tracks",
    "viewerSeat",
    "visibleOutcomes",
    "reveal",
    "narrative",
    "replayHint",
    "replayActions",
    "continueNextPartCapability",
    "decisionHash",
    "structuredResultHash",
    "presentationHash",
  ], "pressureResult");
  contractLiteral(
    result.schemaVersion,
    "sangtian_pressure_result_v1",
    "pressureResult.schemaVersion",
    ERROR.SCHEMA_VERSION_UNSUPPORTED,
  );
  const resultType = contractEnum(
    result.resultType,
    ["SANGTIAN_PRESSURE_SOLO_END", "SANGTIAN_PRESSURE_SHARED_END"] as const,
    "pressureResult.resultType",
  );
  const participantMode = validateResultRoom(result.room);
  if (
    (participantMode === "SOLO" && resultType !== "SANGTIAN_PRESSURE_SOLO_END") ||
    (participantMode === "MULTIPLAYER" && resultType !== "SANGTIAN_PRESSURE_SHARED_END")
  ) {
    failPressureContract(ERROR.CONTRACT_REFERENCE_MISMATCH, "pressureResult.resultType");
  }
  validateResultRoute(result.route);
  validateResultWorldOutcome(result.worldOutcome);
  validateResultTracks(result.tracks);
  validateViewerSeat(result.viewerSeat);
  validateVisibleOutcomes(result.visibleOutcomes);
  validateReveal(result.reveal);
  contractSha256(result.decisionHash, "pressureResult.decisionHash");
  if (expectedDecisionHash && result.decisionHash !== expectedDecisionHash) {
    failPressureContract(
      ERROR.CONTRACT_REFERENCE_MISMATCH,
      "pressureResult.decisionHash",
      `EXPECTED_${expectedDecisionHash}`,
    );
  }
  validateResultNarrative(result.narrative, String(result.decisionHash));
  contractString(result.replayHint, "pressureResult.replayHint");
  const actions = contractArray(result.replayActions, "pressureResult.replayActions")
    .map((action, index) => validatePressureReplayActionV1(action, `pressureResult.replayActions[${index}]`));
  const actionTypes = actions.map((action) => action.type);
  if (new Set(actionTypes).size !== actionTypes.length) {
    failPressureContract(ERROR.CONTRACT_DUPLICATE_VALUE, "pressureResult.replayActions.type");
  }
  if (result.continueNextPartCapability !== null) {
    failPressureContract(
      ERROR.CONTRACT_FIELD_INVALID,
      "pressureResult.continueNextPartCapability",
      "PRESSURE_V1_REQUIRES_NULL",
    );
  }
  const typed = result as unknown as SangtianPressureResultV1;
  assertHashEqual(
    result.structuredResultHash,
    computePressureStructuredResultHash(typed),
    "pressureResult.structuredResultHash",
    ERROR.CONTRACT_HASH_MISMATCH,
  );
  const narrative = typed.narrative;
  const published = narrative.status === "PUBLISHED" || narrative.status === "FALLBACK_PUBLISHED";
  if (published) {
    assertHashEqual(
      result.presentationHash,
      computePressurePresentationHash(typed),
      "pressureResult.presentationHash",
      ERROR.CONTRACT_HASH_MISMATCH,
    );
  } else if (result.presentationHash !== null) {
    failPressureContract(
      ERROR.CONTRACT_FIELD_INVALID,
      "pressureResult.presentationHash",
      "UNPUBLISHED_REQUIRES_NULL",
    );
  }
  return typed;
}

export function validateSangtianPressureResultEnvelopeV1(
  value: unknown,
): SangtianPressureResultEnvelopeV1 {
  const envelope = contractObject(value, "resultEnvelope");
  exactContractKeys(envelope, [
    "envelopeSchemaVersion",
    "roomId",
    "runId",
    "worldId",
    "frozenRoute",
    "resultContractRegistryVersion",
    "payloadSchemaVersion",
    "presentationSchemaVersion",
    "rendererKey",
    "authoritativeResultStatus",
    "runtimeTerminalState",
    "narrativeStatus",
    "sourceCommitHash",
    "decisionHash",
    "presentationHash",
    "payload",
  ], "resultEnvelope");
  contractLiteral(envelope.envelopeSchemaVersion, "endgame_result_envelope_v1", "resultEnvelope.envelopeSchemaVersion");
  contractString(envelope.roomId, "resultEnvelope.roomId");
  contractString(envelope.runId, "resultEnvelope.runId");
  contractLiteral(envelope.worldId, "sangtian", "resultEnvelope.worldId");
  validatePressureFrozenRoute(envelope.frozenRoute);
  contractVersion(envelope.resultContractRegistryVersion, "resultEnvelope.resultContractRegistryVersion");
  contractLiteral(envelope.payloadSchemaVersion, "sangtian_pressure_result_v1", "resultEnvelope.payloadSchemaVersion", ERROR.RESULT_SCHEMA_UNSUPPORTED);
  contractLiteral(envelope.presentationSchemaVersion, "sangtian_pressure_result_v1", "resultEnvelope.presentationSchemaVersion");
  contractLiteral(envelope.rendererKey, "sangtian_pressure_endgame_v1", "resultEnvelope.rendererKey");
  contractLiteral(envelope.authoritativeResultStatus, "FINALIZED", "resultEnvelope.authoritativeResultStatus");
  contractLiteral(envelope.runtimeTerminalState, "FINALE_FROZEN", "resultEnvelope.runtimeTerminalState");
  contractEnum(envelope.narrativeStatus, NARRATIVE_STATUSES_V1, "resultEnvelope.narrativeStatus");
  contractSha256(envelope.sourceCommitHash, "resultEnvelope.sourceCommitHash");
  contractSha256(envelope.decisionHash, "resultEnvelope.decisionHash");
  if (envelope.presentationHash !== null) {
    contractSha256(envelope.presentationHash, "resultEnvelope.presentationHash");
  }
  const payload = validateSangtianPressureResultV1(envelope.payload, String(envelope.decisionHash));
  for (const [field, expected] of [
    ["roomId", payload.room.roomId],
    ["runId", payload.room.runId],
    ["narrativeStatus", payload.narrative.status],
    ["sourceCommitHash", payload.narrative.sourceCommitHash],
    ["decisionHash", payload.decisionHash],
    ["presentationHash", payload.presentationHash],
  ] as const) {
    if (envelope[field] !== expected) {
      failPressureContract(
        ERROR.CONTRACT_REFERENCE_MISMATCH,
        `resultEnvelope.${field}`,
        `EXPECTED_${String(expected)}`,
      );
    }
  }
  return envelope as unknown as SangtianPressureResultEnvelopeV1;
}

function validateResultRoom(value: unknown): ParticipantModeV1 {
  const room = contractObject(value, "pressureResult.room");
  exactContractKeys(room, ["roomId", "runId", "worldId", "participantMode", "completedAt"], "pressureResult.room");
  contractString(room.roomId, "pressureResult.room.roomId");
  contractString(room.runId, "pressureResult.room.runId");
  contractLiteral(room.worldId, "sangtian", "pressureResult.room.worldId");
  const mode = contractEnum(room.participantMode, ["SOLO", "MULTIPLAYER"] as const, "pressureResult.room.participantMode");
  isoTimestamp(room.completedAt, "pressureResult.room.completedAt");
  return mode;
}

function validateResultRoute(value: unknown): void {
  const route = contractObject(value, "pressureResult.route");
  exactContractKeys(route, [
    "engineVersion",
    "strategyVersion",
    "runtimeProfile",
    "endgamePolicyVersion",
    "contentPackageVersion",
    "contentPackageSha256",
  ], "pressureResult.route");
  contractLiteral(route.engineVersion, PRESSURE_CHAPTER_ROUTE_V1.engineVersion, "pressureResult.route.engineVersion", ERROR.RUN_ROUTE_UNREGISTERED);
  contractLiteral(route.strategyVersion, PRESSURE_CHAPTER_ROUTE_V1.strategyVersion, "pressureResult.route.strategyVersion", ERROR.RUN_ROUTE_UNREGISTERED);
  contractLiteral(route.runtimeProfile, PRESSURE_CHAPTER_ROUTE_V1.runtimeProfile, "pressureResult.route.runtimeProfile", ERROR.RUNTIME_PROFILE_UNSUPPORTED);
  contractLiteral(route.endgamePolicyVersion, PRESSURE_CHAPTER_ROUTE_V1.endgamePolicyVersion, "pressureResult.route.endgamePolicyVersion", ERROR.ENDGAME_POLICY_MISMATCH);
  contractVersion(route.contentPackageVersion, "pressureResult.route.contentPackageVersion");
  contractSha256(route.contentPackageSha256, "pressureResult.route.contentPackageSha256");
}

function validateResultWorldOutcome(value: unknown): void {
  const outcome = contractObject(value, "pressureResult.worldOutcome");
  exactContractKeys(outcome, ["outcomeId", "title", "verdictLine", "summary"], "pressureResult.worldOutcome");
  for (const field of ["outcomeId", "title", "verdictLine", "summary"] as const) {
    contractString(outcome[field], `pressureResult.worldOutcome.${field}`);
  }
}

function validateResultTracks(value: unknown): void {
  const tracks = contractArray(value, "pressureResult.tracks").map((item, index) => {
    const path = `pressureResult.tracks[${index}]`;
    const track = contractObject(item, path);
    exactContractKeys(track, ["trackId", "label", "level", "summary", "evidenceRefs"], path);
    validateTrackIdV1(track.trackId, `${path}.trackId`);
    contractString(track.label, `${path}.label`);
    contractEnum(track.level, ["LOW", "MID", "HIGH"] as const, `${path}.level`);
    contractString(track.summary, `${path}.summary`);
    contractStringArray(track.evidenceRefs, `${path}.evidenceRefs`, { sorted: true });
    return track;
  });
  if (tracks.length !== TRACK_IDS_V1.length) {
    failPressureContract(ERROR.CONTRACT_FIELD_INVALID, "pressureResult.tracks", "EXACT_FIVE_TRACKS");
  }
  assertOrderedBy(tracks, (track) => String(track.trackId), "pressureResult.tracks", TRACK_IDS_V1);
}

function validateViewerSeat(value: unknown): void {
  const seat = contractObject(value, "pressureResult.viewerSeat");
  exactContractKeys(seat, [
    "seatId",
    "roleKey",
    "roleName",
    "verdict",
    "verdictLabel",
    "gain",
    "loss",
    "causes",
  ], "pressureResult.viewerSeat");
  validateSeatIdV1(seat.seatId, "pressureResult.viewerSeat.seatId");
  for (const field of ["roleKey", "roleName", "verdictLabel"] as const) {
    contractString(seat[field], `pressureResult.viewerSeat.${field}`);
  }
  contractEnum(seat.verdict, ["WIN", "COSTLY_WIN", "LOSS"] as const, "pressureResult.viewerSeat.verdict");
  contractStringArray(seat.gain, "pressureResult.viewerSeat.gain");
  contractStringArray(seat.loss, "pressureResult.viewerSeat.loss");
  const causes = contractArray(seat.causes, "pressureResult.viewerSeat.causes");
  if (causes.length > 3) {
    failPressureContract(ERROR.CONTRACT_FIELD_INVALID, "pressureResult.viewerSeat.causes", "MAX_THREE");
  }
  causes.forEach((cause, index) => validatePressureResultCauseV1(cause, `pressureResult.viewerSeat.causes[${index}]`));
}

function validatePressureResultCauseV1(value: unknown, path: string): PressureResultCauseV1 {
  const cause = contractObject(value, path);
  exactContractKeys(cause, [
    "sourceStageId",
    "sourceKind",
    "chapterSettlementId",
    "frozenSourceHash",
    "sourceDecisionActionIds",
    "frozenFactRef",
    "title",
    "factText",
    "direction",
  ], path);
  const stage = contractEnum(cause.sourceStageId, ["P0", "N1", "N2", "N3", "N4", "N5", "N6", "N7"] as const, `${path}.sourceStageId`);
  const kind = contractEnum(cause.sourceKind, ["GENESIS", "CHAPTER_SETTLEMENT"] as const, `${path}.sourceKind`);
  if (cause.chapterSettlementId !== null) contractString(cause.chapterSettlementId, `${path}.chapterSettlementId`);
  contractSha256(cause.frozenSourceHash, `${path}.frozenSourceHash`);
  const actions = contractStringArray(cause.sourceDecisionActionIds, `${path}.sourceDecisionActionIds`, { sorted: true });
  for (const field of ["frozenFactRef", "title", "factText"] as const) {
    contractString(cause[field], `${path}.${field}`);
  }
  contractEnum(cause.direction, ["HELPED", "HURT", "DECISIVE"] as const, `${path}.direction`);
  if (
    (kind === "GENESIS" && (stage !== "P0" || cause.chapterSettlementId !== null || actions.length !== 0)) ||
    (kind === "CHAPTER_SETTLEMENT" && (stage === "P0" || cause.chapterSettlementId === null))
  ) {
    failPressureContract(ERROR.CONTRACT_REFERENCE_MISMATCH, path, "SOURCE_KIND_STAGE_MISMATCH");
  }
  return cause as unknown as PressureResultCauseV1;
}

function validateVisibleOutcomes(value: unknown): void {
  const outcomes = contractArray(value, "pressureResult.visibleOutcomes").map((item, index) => {
    const path = `pressureResult.visibleOutcomes[${index}]`;
    const outcome = contractObject(item, path);
    exactContractKeys(outcome, ["kind", "outcomeId", "title", "summary", "sourceRefs"], path);
    contractEnum(outcome.kind, ["OBJECT", "EVIDENCE", "RESPONSIBILITY"] as const, `${path}.kind`);
    for (const field of ["outcomeId", "title", "summary"] as const) {
      contractString(outcome[field], `${path}.${field}`);
    }
    contractStringArray(outcome.sourceRefs, `${path}.sourceRefs`, { sorted: true });
    return outcome;
  });
  assertOrderedBy(
    outcomes,
    (outcome) => `${String(outcome.kind)}\u0000${String(outcome.outcomeId)}`,
    "pressureResult.visibleOutcomes",
  );
}

function validateReveal(value: unknown): void {
  if (value === null) return;
  const reveal = contractObject(value, "pressureResult.reveal");
  exactContractKeys(reveal, ["title", "text", "sourceRefs"], "pressureResult.reveal");
  contractString(reveal.title, "pressureResult.reveal.title");
  contractString(reveal.text, "pressureResult.reveal.text");
  contractStringArray(reveal.sourceRefs, "pressureResult.reveal.sourceRefs", { nonEmpty: true, sorted: true });
}

function validateResultNarrative(value: unknown, decisionHash: string): void {
  const narrative = contractObject(value, "pressureResult.narrative");
  exactContractKeys(narrative, [
    "status",
    "text",
    "contentHash",
    "sourceCommitHash",
    "sourceDecisionHash",
  ], "pressureResult.narrative");
  const status = contractEnum(narrative.status, NARRATIVE_STATUSES_V1, "pressureResult.narrative.status");
  contractSha256(narrative.sourceCommitHash, "pressureResult.narrative.sourceCommitHash");
  assertHashEqual(
    narrative.sourceDecisionHash,
    decisionHash,
    "pressureResult.narrative.sourceDecisionHash",
    ERROR.CONTRACT_REFERENCE_MISMATCH,
  );
  const published = status === "PUBLISHED" || status === "FALLBACK_PUBLISHED";
  if (published) {
    contractString(narrative.text, "pressureResult.narrative.text");
    contractSha256(narrative.contentHash, "pressureResult.narrative.contentHash");
  } else if (narrative.text !== null || narrative.contentHash !== null) {
    failPressureContract(
      ERROR.CONTRACT_FIELD_INVALID,
      "pressureResult.narrative",
      "UNPUBLISHED_REQUIRES_NULL_CONTENT",
    );
  }
}

function validatePressureFrozenRoute(value: unknown): void {
  const route = contractObject(value, "resultEnvelope.frozenRoute");
  exactContractKeys(route, [
    "engineVersion",
    "strategyVersion",
    "runtimeProfile",
    "endgamePolicyVersion",
    "resultSchemaVersion",
  ], "resultEnvelope.frozenRoute");
  for (const [field, expected, code] of [
    ["engineVersion", PRESSURE_CHAPTER_ROUTE_V1.engineVersion, ERROR.RUN_ROUTE_UNREGISTERED],
    ["strategyVersion", PRESSURE_CHAPTER_ROUTE_V1.strategyVersion, ERROR.RUN_ROUTE_UNREGISTERED],
    ["runtimeProfile", PRESSURE_CHAPTER_ROUTE_V1.runtimeProfile, ERROR.RUNTIME_PROFILE_UNSUPPORTED],
    ["endgamePolicyVersion", PRESSURE_CHAPTER_ROUTE_V1.endgamePolicyVersion, ERROR.ENDGAME_POLICY_MISMATCH],
    ["resultSchemaVersion", PRESSURE_CHAPTER_ROUTE_V1.resultSchemaVersion, ERROR.RESULT_SCHEMA_UNSUPPORTED],
  ] as const) {
    contractLiteral(route[field], expected, `resultEnvelope.frozenRoute.${field}`, code);
  }
}

export function recomputeReplayReceiptHash(receipt: ReplayCreationReceiptV1): string {
  return hashWithoutField(receipt as unknown as RawContract, "receiptHash");
}
