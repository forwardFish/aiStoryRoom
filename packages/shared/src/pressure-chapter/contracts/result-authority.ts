import { hashWithoutField } from "./canonical";
import {
  PRESSURE_CHAPTER_CONTRACT_ERROR_CODES as ERROR,
  failPressureContract,
} from "./errors";
import {
  TRACK_IDS_V1,
  validateSeatIdV1,
  type SeatIdV1,
  type TrackIdV1,
} from "./domain";
import type { PressureResultCauseV1 } from "./result";
import {
  PRESSURE_CHAPTER_SEAT_IDS_V1,
  assertSangtianPressureRouteV1,
  validateFrozenRunRouteV1,
  type FrozenRunRouteV1,
  type ParticipantModeV1,
} from "./route";
import {
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

export interface FrozenResultReferenceV1 {
  referenceId: string;
  kind: "FACT" | "RULE" | "OBJECT" | "EVIDENCE" | "RESPONSIBILITY";
  title: string;
  summary: string;
  sourceRefs: string[];
  visibility: "PUBLIC" | "AUTHORIZED";
  authorizedSeatIds: SeatIdV1[];
  privateOriginSeatId: SeatIdV1 | null;
  sourceStageId: "P0" | "N1" | "N2" | "N3" | "N4" | "N5" | "N6" | "N7";
  sourceKind: "GENESIS" | "CHAPTER_SETTLEMENT";
  chapterSettlementId: string | null;
  frozenSourceHash: string;
  sourceDecisionActionIds: string[];
  revealEligible: boolean;
  revealText: string | null;
}

export interface FrozenSangtianResultCatalogV1 {
  schemaVersion: "frozen_sangtian_result_catalog_v1";
  locale: "zh-CN";
  worldOutcomes: Array<{
    outcomeId: string;
    sourceRuleRef: string;
    title: string;
    verdictLine: string;
    summary: string;
  }>;
  tracks: Array<{
    trackId: TrackIdV1;
    label: string;
    summaries: { LOW: string; MID: string; HIGH: string };
  }>;
  seats: Array<{
    seatId: SeatIdV1;
    roleKey: string;
    roleName: string;
    verdictLabels: { WIN: string; COSTLY_WIN: string; LOSS: string };
  }>;
  references: FrozenResultReferenceV1[];
  replayHint: string;
  catalogHash: string;
}

export interface TerminalResultContextV1 {
  schemaVersion: "terminal_result_context_v1";
  roomId: string;
  runId: string;
  worldId: "sangtian";
  participantMode: ParticipantModeV1;
  completedAt: string;
  frozenRoute: FrozenRunRouteV1;
  frozenRouteHash: string;
  resultContractRegistryVersion: string;
  payloadSchemaVersion: "sangtian_pressure_result_v1";
  presentationSchemaVersion: "sangtian_pressure_result_v1";
  rendererKey: "sangtian_pressure_endgame_v1";
  contentPackageVersion: string;
  contentPackageSha256: string;
  narrativeProfileVersion: string;
  catalog: FrozenSangtianResultCatalogV1;
  contextHash: string;
}

export interface AuthoritativePressureResultSnapshotV1 {
  schemaVersion: "authoritative_pressure_result_snapshot_v1";
  roomId: string;
  runId: string;
  worldId: "sangtian";
  participantMode: ParticipantModeV1;
  completedAt: string;
  frozenRoute: FrozenRunRouteV1;
  frozenRouteHash: string;
  resultContractRegistryVersion: string;
  payloadSchemaVersion: "sangtian_pressure_result_v1";
  presentationSchemaVersion: "sangtian_pressure_result_v1";
  rendererKey: "sangtian_pressure_endgame_v1";
  authoritativeResultStatus: "FINALIZED";
  runtimeTerminalState: "FINALE_FROZEN";
  sourceCommitHash: string;
  decisionHash: string;
  terminalContextHash: string;
  contentPackageVersion: string;
  contentPackageSha256: string;
  worldOutcome: {
    outcomeId: string;
    sourceRuleRef: string;
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
  seatOutcomes: Array<{
    seatId: SeatIdV1;
    roleKey: string;
    roleName: string;
    verdict: "WIN" | "COSTLY_WIN" | "LOSS";
    verdictLabel: string;
    gain: string[];
    loss: string[];
    causes: PressureResultCauseV1[];
  }>;
  impacts: Array<{
    kind: "OBJECT" | "EVIDENCE" | "RESPONSIBILITY";
    outcomeId: string;
    title: string;
    summary: string;
    sourceRefs: string[];
    visibility: "PUBLIC" | "AUTHORIZED";
    authorizedSeatIds: SeatIdV1[];
    privateOriginSeatId: SeatIdV1 | null;
  }>;
  reveals: Array<{
    revealId: string;
    authorizedSeatIds: SeatIdV1[];
    title: string;
    text: string;
    sourceRefs: string[];
  }>;
  replayHint: string;
  snapshotHash: string;
}

export function validateFrozenSangtianResultCatalogV1(
  value: unknown,
): FrozenSangtianResultCatalogV1 {
  const catalog = contractObject(value, "resultCatalog");
  exactContractKeys(catalog, [
    "schemaVersion", "locale", "worldOutcomes", "tracks", "seats",
    "references", "replayHint", "catalogHash",
  ], "resultCatalog");
  contractLiteral(catalog.schemaVersion, "frozen_sangtian_result_catalog_v1", "resultCatalog.schemaVersion");
  contractLiteral(catalog.locale, "zh-CN", "resultCatalog.locale");
  const outcomes = contractArray(catalog.worldOutcomes, "resultCatalog.worldOutcomes").map((item, index) => {
    const path = `resultCatalog.worldOutcomes[${index}]`;
    const outcome = contractObject(item, path);
    exactContractKeys(outcome, ["outcomeId", "sourceRuleRef", "title", "verdictLine", "summary"], path);
    for (const field of ["outcomeId", "sourceRuleRef", "title", "verdictLine", "summary"] as const) {
      contractString(outcome[field], `${path}.${field}`);
    }
    return outcome;
  });
  assertOrderedBy(outcomes, (item) => String(item.outcomeId), "resultCatalog.worldOutcomes");
  const tracks = contractArray(catalog.tracks, "resultCatalog.tracks");
  if (tracks.length !== TRACK_IDS_V1.length) invalid("resultCatalog.tracks", "EXACT_FIVE");
  tracks.forEach((item, index) => {
    const path = `resultCatalog.tracks[${index}]`;
    const track = contractObject(item, path);
    exactContractKeys(track, ["trackId", "label", "summaries"], path);
    contractLiteral(track.trackId, TRACK_IDS_V1[index], `${path}.trackId`);
    contractString(track.label, `${path}.label`);
    const summaries = contractObject(track.summaries, `${path}.summaries`);
    exactContractKeys(summaries, ["LOW", "MID", "HIGH"], `${path}.summaries`);
    for (const level of ["LOW", "MID", "HIGH"] as const) contractString(summaries[level], `${path}.summaries.${level}`);
  });
  const seats = contractArray(catalog.seats, "resultCatalog.seats");
  if (seats.length !== PRESSURE_CHAPTER_SEAT_IDS_V1.length) invalid("resultCatalog.seats", "EXACT_SIX");
  seats.forEach((item, index) => {
    const path = `resultCatalog.seats[${index}]`;
    const seat = contractObject(item, path);
    exactContractKeys(seat, ["seatId", "roleKey", "roleName", "verdictLabels"], path);
    contractLiteral(seat.seatId, PRESSURE_CHAPTER_SEAT_IDS_V1[index], `${path}.seatId`);
    contractString(seat.roleKey, `${path}.roleKey`);
    contractString(seat.roleName, `${path}.roleName`);
    const labels = contractObject(seat.verdictLabels, `${path}.verdictLabels`);
    exactContractKeys(labels, ["WIN", "COSTLY_WIN", "LOSS"], `${path}.verdictLabels`);
    for (const verdict of ["WIN", "COSTLY_WIN", "LOSS"] as const) contractString(labels[verdict], `${path}.verdictLabels.${verdict}`);
  });
  const references = contractArray(catalog.references, "resultCatalog.references")
    .map((item, index) => validateFrozenResultReference(item, `resultCatalog.references[${index}]`));
  assertOrderedBy(references, (item) => item.referenceId, "resultCatalog.references");
  contractString(catalog.replayHint, "resultCatalog.replayHint");
  assertSelfHash(catalog, "catalogHash", "resultCatalog");
  return catalog as unknown as FrozenSangtianResultCatalogV1;
}

export function validateTerminalResultContextV1(value: unknown): TerminalResultContextV1 {
  const context = contractObject(value, "terminalResultContext");
  exactContractKeys(context, [
    "schemaVersion", "roomId", "runId", "worldId", "participantMode", "completedAt",
    "frozenRoute", "frozenRouteHash", "resultContractRegistryVersion", "payloadSchemaVersion",
    "presentationSchemaVersion", "rendererKey", "contentPackageVersion", "contentPackageSha256",
    "narrativeProfileVersion", "catalog", "contextHash",
  ], "terminalResultContext");
  contractLiteral(context.schemaVersion, "terminal_result_context_v1", "terminalResultContext.schemaVersion");
  for (const field of ["roomId", "runId"] as const) contractString(context[field], `terminalResultContext.${field}`);
  contractLiteral(context.worldId, "sangtian", "terminalResultContext.worldId");
  contractEnum(context.participantMode, ["SOLO", "MULTIPLAYER"] as const, "terminalResultContext.participantMode");
  isoTimestamp(context.completedAt, "terminalResultContext.completedAt");
  const route = validateFrozenRunRouteV1(context.frozenRoute);
  assertSangtianPressureRouteV1(route);
  contractSha256(context.frozenRouteHash, "terminalResultContext.frozenRouteHash");
  contractVersion(context.resultContractRegistryVersion, "terminalResultContext.resultContractRegistryVersion");
  contractLiteral(context.payloadSchemaVersion, "sangtian_pressure_result_v1", "terminalResultContext.payloadSchemaVersion");
  contractLiteral(context.presentationSchemaVersion, "sangtian_pressure_result_v1", "terminalResultContext.presentationSchemaVersion");
  contractLiteral(context.rendererKey, "sangtian_pressure_endgame_v1", "terminalResultContext.rendererKey");
  contractVersion(context.contentPackageVersion, "terminalResultContext.contentPackageVersion");
  contractSha256(context.contentPackageSha256, "terminalResultContext.contentPackageSha256");
  contractVersion(context.narrativeProfileVersion, "terminalResultContext.narrativeProfileVersion");
  validateFrozenSangtianResultCatalogV1(context.catalog);
  assertSelfHash(context, "contextHash", "terminalResultContext");
  return context as unknown as TerminalResultContextV1;
}

export function validateAuthoritativePressureResultSnapshotV1(
  value: unknown,
  expectedRunId?: string,
): AuthoritativePressureResultSnapshotV1 {
  const snapshot = contractObject(value, "authorityResultSnapshot");
  exactContractKeys(snapshot, [
    "schemaVersion", "roomId", "runId", "worldId", "participantMode", "completedAt",
    "frozenRoute", "frozenRouteHash", "resultContractRegistryVersion", "payloadSchemaVersion",
    "presentationSchemaVersion", "rendererKey", "authoritativeResultStatus", "runtimeTerminalState",
    "sourceCommitHash", "decisionHash", "terminalContextHash", "contentPackageVersion",
    "contentPackageSha256", "worldOutcome", "tracks", "seatOutcomes", "impacts", "reveals",
    "replayHint", "snapshotHash",
  ], "authorityResultSnapshot");
  contractLiteral(snapshot.schemaVersion, "authoritative_pressure_result_snapshot_v1", "authorityResultSnapshot.schemaVersion");
  for (const field of ["roomId", "runId"] as const) contractString(snapshot[field], `authorityResultSnapshot.${field}`);
  if (expectedRunId && snapshot.runId !== expectedRunId) invalid("authorityResultSnapshot.runId", `EXPECTED_${expectedRunId}`);
  contractLiteral(snapshot.worldId, "sangtian", "authorityResultSnapshot.worldId");
  contractEnum(snapshot.participantMode, ["SOLO", "MULTIPLAYER"] as const, "authorityResultSnapshot.participantMode");
  isoTimestamp(snapshot.completedAt, "authorityResultSnapshot.completedAt");
  const route = validateFrozenRunRouteV1(snapshot.frozenRoute);
  assertSangtianPressureRouteV1(route);
  for (const field of ["frozenRouteHash", "sourceCommitHash", "decisionHash", "terminalContextHash", "contentPackageSha256"] as const) {
    contractSha256(snapshot[field], `authorityResultSnapshot.${field}`);
  }
  contractVersion(snapshot.resultContractRegistryVersion, "authorityResultSnapshot.resultContractRegistryVersion");
  contractLiteral(snapshot.payloadSchemaVersion, "sangtian_pressure_result_v1", "authorityResultSnapshot.payloadSchemaVersion");
  contractLiteral(snapshot.presentationSchemaVersion, "sangtian_pressure_result_v1", "authorityResultSnapshot.presentationSchemaVersion");
  contractLiteral(snapshot.rendererKey, "sangtian_pressure_endgame_v1", "authorityResultSnapshot.rendererKey");
  contractLiteral(snapshot.authoritativeResultStatus, "FINALIZED", "authorityResultSnapshot.authoritativeResultStatus");
  contractLiteral(snapshot.runtimeTerminalState, "FINALE_FROZEN", "authorityResultSnapshot.runtimeTerminalState");
  contractVersion(snapshot.contentPackageVersion, "authorityResultSnapshot.contentPackageVersion");
  validateSnapshotWorldOutcome(snapshot.worldOutcome);
  validateSnapshotTracks(snapshot.tracks);
  validateSnapshotSeats(snapshot.seatOutcomes);
  validateSnapshotImpacts(snapshot.impacts);
  validateSnapshotReveals(snapshot.reveals);
  contractString(snapshot.replayHint, "authorityResultSnapshot.replayHint");
  assertSelfHash(snapshot, "snapshotHash", "authorityResultSnapshot");
  return snapshot as unknown as AuthoritativePressureResultSnapshotV1;
}

export function recomputeAuthorityResultSnapshotHashV1(
  snapshot: AuthoritativePressureResultSnapshotV1,
): string {
  return hashWithoutField(snapshot as unknown as RawContract, "snapshotHash");
}

function validateFrozenResultReference(value: unknown, path: string): FrozenResultReferenceV1 {
  const reference = contractObject(value, path);
  exactContractKeys(reference, [
    "referenceId", "kind", "title", "summary", "sourceRefs", "visibility",
    "authorizedSeatIds", "privateOriginSeatId", "sourceStageId", "sourceKind",
    "chapterSettlementId", "frozenSourceHash", "sourceDecisionActionIds",
    "revealEligible", "revealText",
  ], path);
  for (const field of ["referenceId", "title", "summary"] as const) contractString(reference[field], `${path}.${field}`);
  contractEnum(reference.kind, ["FACT", "RULE", "OBJECT", "EVIDENCE", "RESPONSIBILITY"] as const, `${path}.kind`);
  contractStringArray(reference.sourceRefs, `${path}.sourceRefs`, { nonEmpty: true, sorted: true });
  const visibility = contractEnum(reference.visibility, ["PUBLIC", "AUTHORIZED"] as const, `${path}.visibility`);
  const authorized = orderedSeats(reference.authorizedSeatIds, `${path}.authorizedSeatIds`);
  if (reference.privateOriginSeatId !== null) validateSeatIdV1(reference.privateOriginSeatId, `${path}.privateOriginSeatId`);
  if (visibility === "PUBLIC" && (authorized.length || reference.privateOriginSeatId !== null)) invalid(path, "PUBLIC_ACL_MISMATCH");
  if (visibility === "AUTHORIZED" && authorized.length === 0) invalid(path, "AUTHORIZED_REQUIRES_SEAT");
  contractEnum(reference.sourceStageId, ["P0", "N1", "N2", "N3", "N4", "N5", "N6", "N7"] as const, `${path}.sourceStageId`);
  const sourceKind = contractEnum(reference.sourceKind, ["GENESIS", "CHAPTER_SETTLEMENT"] as const, `${path}.sourceKind`);
  if (reference.chapterSettlementId !== null) contractString(reference.chapterSettlementId, `${path}.chapterSettlementId`);
  assertFrozenSourceBinding(
    sourceKind,
    reference.sourceStageId as FrozenResultReferenceV1["sourceStageId"],
    reference.chapterSettlementId,
    path,
  );
  contractSha256(reference.frozenSourceHash, `${path}.frozenSourceHash`);
  const actionIds = contractStringArray(
    reference.sourceDecisionActionIds,
    `${path}.sourceDecisionActionIds`,
    { sorted: true },
  );
  if (sourceKind === "GENESIS" && actionIds.length !== 0) {
    invalid(path, "GENESIS_CANNOT_REFERENCE_DECISION_ACTIONS");
  }
  const revealEligible = contractBoolean(reference.revealEligible, `${path}.revealEligible`);
  if (reference.revealText !== null) contractString(reference.revealText, `${path}.revealText`);
  if (revealEligible && (visibility !== "AUTHORIZED" || reference.revealText === null)) invalid(path, "REVEAL_ACL_MISMATCH");
  if (!revealEligible && reference.revealText !== null) invalid(path, "NON_REVEAL_REQUIRES_NULL");
  return reference as unknown as FrozenResultReferenceV1;
}

function validateSnapshotWorldOutcome(value: unknown): void {
  const outcome = contractObject(value, "authorityResultSnapshot.worldOutcome");
  exactContractKeys(outcome, ["outcomeId", "sourceRuleRef", "title", "verdictLine", "summary"], "authorityResultSnapshot.worldOutcome");
  for (const field of ["outcomeId", "sourceRuleRef", "title", "verdictLine", "summary"] as const) contractString(outcome[field], `authorityResultSnapshot.worldOutcome.${field}`);
}

function validateSnapshotTracks(value: unknown): void {
  const tracks = contractArray(value, "authorityResultSnapshot.tracks");
  if (tracks.length !== TRACK_IDS_V1.length) invalid("authorityResultSnapshot.tracks", "EXACT_FIVE");
  tracks.forEach((item, index) => {
    const path = `authorityResultSnapshot.tracks[${index}]`;
    const track = contractObject(item, path);
    exactContractKeys(track, ["trackId", "label", "level", "summary", "evidenceRefs"], path);
    contractLiteral(track.trackId, TRACK_IDS_V1[index], `${path}.trackId`);
    contractString(track.label, `${path}.label`);
    contractEnum(track.level, ["LOW", "MID", "HIGH"] as const, `${path}.level`);
    contractString(track.summary, `${path}.summary`);
    contractStringArray(track.evidenceRefs, `${path}.evidenceRefs`, { sorted: true });
  });
}

function validateSnapshotSeats(value: unknown): void {
  const seats = contractArray(value, "authorityResultSnapshot.seatOutcomes");
  if (seats.length !== PRESSURE_CHAPTER_SEAT_IDS_V1.length) invalid("authorityResultSnapshot.seatOutcomes", "EXACT_SIX");
  seats.forEach((item, index) => {
    const path = `authorityResultSnapshot.seatOutcomes[${index}]`;
    const seat = contractObject(item, path);
    exactContractKeys(seat, ["seatId", "roleKey", "roleName", "verdict", "verdictLabel", "gain", "loss", "causes"], path);
    contractLiteral(seat.seatId, PRESSURE_CHAPTER_SEAT_IDS_V1[index], `${path}.seatId`);
    for (const field of ["roleKey", "roleName", "verdictLabel"] as const) contractString(seat[field], `${path}.${field}`);
    contractEnum(seat.verdict, ["WIN", "COSTLY_WIN", "LOSS"] as const, `${path}.verdict`);
    contractStringArray(seat.gain, `${path}.gain`);
    contractStringArray(seat.loss, `${path}.loss`);
    const causes = contractArray(seat.causes, `${path}.causes`);
    if (causes.length > 3) invalid(`${path}.causes`, "MAX_THREE");
    causes.forEach((cause, causeIndex) => validateSnapshotCause(cause, `${path}.causes[${causeIndex}]`));
  });
}

function validateSnapshotCause(value: unknown, path: string): void {
  const cause = contractObject(value, path);
  exactContractKeys(cause, [
    "sourceStageId", "sourceKind", "chapterSettlementId", "frozenSourceHash",
    "sourceDecisionActionIds", "frozenFactRef", "title", "factText", "direction",
  ], path);
  const stage = contractEnum(cause.sourceStageId, ["P0", "N1", "N2", "N3", "N4", "N5", "N6", "N7"] as const, `${path}.sourceStageId`);
  const kind = contractEnum(cause.sourceKind, ["GENESIS", "CHAPTER_SETTLEMENT"] as const, `${path}.sourceKind`);
  if (cause.chapterSettlementId !== null) contractString(cause.chapterSettlementId, `${path}.chapterSettlementId`);
  contractSha256(cause.frozenSourceHash, `${path}.frozenSourceHash`);
  const actionIds = contractStringArray(
    cause.sourceDecisionActionIds,
    `${path}.sourceDecisionActionIds`,
    { sorted: true },
  );
  if (kind === "GENESIS" && actionIds.length !== 0) {
    invalid(path, "GENESIS_CANNOT_REFERENCE_DECISION_ACTIONS");
  }
  for (const field of ["frozenFactRef", "title", "factText"] as const) contractString(cause[field], `${path}.${field}`);
  contractEnum(cause.direction, ["HELPED", "HURT", "DECISIVE"] as const, `${path}.direction`);
  assertFrozenSourceBinding(
    kind,
    stage,
    cause.chapterSettlementId,
    path,
  );
}

function assertFrozenSourceBinding(
  sourceKind: "GENESIS" | "CHAPTER_SETTLEMENT",
  sourceStageId: FrozenResultReferenceV1["sourceStageId"],
  chapterSettlementId: unknown,
  path: string,
): void {
  if (sourceKind === "GENESIS") {
    if (sourceStageId !== "P0" || chapterSettlementId !== null) {
      invalid(path, "GENESIS_REQUIRES_P0_WITHOUT_SETTLEMENT");
    }
    return;
  }
  if (sourceStageId === "P0" || typeof chapterSettlementId !== "string" || !chapterSettlementId.trim()) {
    invalid(path, "CHAPTER_SETTLEMENT_REQUIRES_N1_N7_AND_SETTLEMENT_ID");
  }
}

function validateSnapshotImpacts(value: unknown): void {
  const impacts = contractArray(value, "authorityResultSnapshot.impacts").map((item, index) => {
    const path = `authorityResultSnapshot.impacts[${index}]`;
    const impact = contractObject(item, path);
    exactContractKeys(impact, ["kind", "outcomeId", "title", "summary", "sourceRefs", "visibility", "authorizedSeatIds", "privateOriginSeatId"], path);
    contractEnum(impact.kind, ["OBJECT", "EVIDENCE", "RESPONSIBILITY"] as const, `${path}.kind`);
    for (const field of ["outcomeId", "title", "summary"] as const) contractString(impact[field], `${path}.${field}`);
    contractStringArray(impact.sourceRefs, `${path}.sourceRefs`, { nonEmpty: true, sorted: true });
    const visibility = contractEnum(impact.visibility, ["PUBLIC", "AUTHORIZED"] as const, `${path}.visibility`);
    const authorized = orderedSeats(impact.authorizedSeatIds, `${path}.authorizedSeatIds`);
    if (impact.privateOriginSeatId !== null) validateSeatIdV1(impact.privateOriginSeatId, `${path}.privateOriginSeatId`);
    if (visibility === "PUBLIC" && (authorized.length || impact.privateOriginSeatId !== null)) invalid(path, "PUBLIC_ACL_MISMATCH");
    if (visibility === "AUTHORIZED" && authorized.length === 0) invalid(path, "AUTHORIZED_REQUIRES_SEAT");
    return impact;
  });
  assertOrderedBy(impacts, (item) => `${String(item.kind)}\u0000${String(item.outcomeId)}`, "authorityResultSnapshot.impacts");
}

function validateSnapshotReveals(value: unknown): void {
  const reveals = contractArray(value, "authorityResultSnapshot.reveals").map((item, index) => {
    const path = `authorityResultSnapshot.reveals[${index}]`;
    const reveal = contractObject(item, path);
    exactContractKeys(reveal, ["revealId", "authorizedSeatIds", "title", "text", "sourceRefs"], path);
    contractString(reveal.revealId, `${path}.revealId`);
    orderedSeats(reveal.authorizedSeatIds, `${path}.authorizedSeatIds`, true);
    for (const field of ["title", "text"] as const) contractString(reveal[field], `${path}.${field}`);
    contractStringArray(reveal.sourceRefs, `${path}.sourceRefs`, { nonEmpty: true, sorted: true });
    return reveal;
  });
  assertOrderedBy(reveals, (item) => String(item.revealId), "authorityResultSnapshot.reveals");
}

function orderedSeats(value: unknown, path: string, nonEmpty = false): SeatIdV1[] {
  const seats = contractArray(value, path).map((seat, index) => validateSeatIdV1(seat, `${path}[${index}]`));
  if (nonEmpty && seats.length === 0) invalid(path, "NON_EMPTY");
  assertOrderedBy(seats, (seat) => seat, path, PRESSURE_CHAPTER_SEAT_IDS_V1);
  return seats;
}

function invalid(path: string, detail?: string): never {
  failPressureContract(ERROR.CONTRACT_FIELD_INVALID, path, detail);
}
