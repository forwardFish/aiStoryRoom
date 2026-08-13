import {
  PRESSURE_CHAPTER_GAME_COMMAND_SCHEMA_V1,
  compareCanonicalText,
  computeDecisionActionRequestFingerprint,
  sha256Canonical,
  validateDecisionActionV1,
  validateRunRouteSnapshotV1,
  type CanonicalJsonObject,
  type ChapterIdV1,
  type PressureChapterSubmitDecisionCommandV1,
  type SeatIdV1,
} from "@ai-story/shared";
import {
  loadPublishedSangtianActionReleaseV1,
  type PublishedSangtianActionReleaseV1,
} from "@ai-story/templates";
import type { PressureChapterGameProjectionV1 } from "../game-projection/contracts";
import type {
  PressureChapterHttpAccessV1,
  PressureChapterHttpDecisionCompilerPort,
  PressureChapterHttpGamePort,
} from "../http/contracts";
import {
  canonicalizeWorkingActionIntentV1,
  computeFormalInteractionInputFingerprint,
} from "../interaction/formal-interaction.service";
import type {
  AuthoredChapterContentPort,
  SubmitOrchestratedActionCommandV1,
  WorkingProjectionReaderPort,
} from "../orchestrator/contracts";
import { assertStoredRunRouteRecord } from "../run-router";
import type { StoredRunRouteRecordV1 } from "../run-router/types";
import type { WorkingActionIntentV1 } from "../working-ledger/contracts";
import { failPressureChapterIntegration } from "./errors";

export interface ServerDecisionWorkingIntentCompilerPortV1 {
  compile(input: Readonly<{
    routeHash: string;
    chapterRuntimeId: string;
    chapterId: ChapterIdV1;
    decisionPointId: string;
    seatId: SeatIdV1;
    actionType: string;
  }>): WorkingActionIntentV1;
}

const INVESTIGATION_ACTION_TYPES = Object.freeze([
  "INVESTIGATE_LEDGER_SOURCE",
  "CONFIRM_LEDGER_SOURCE_WITH_EVIDENCE",
] as const);

type InvestigationActionTypeV1 = (typeof INVESTIGATION_ACTION_TYPES)[number];

export interface PressureResponseEventAuthorityV1 {
  roomId: string;
  runId: string;
  viewerSeatId: SeatIdV1;
  sourceEventId: string;
  projectionVersion: number;
  projectionHash: string;
  disclosure: "HIDDEN" | "SUSPECTED" | "CONFIRMED";
  responseOptions: Array<{
    code: string;
    preferredEntry: "TALK" | "INVESTIGATE" | "TOKEN" | "PLAN" | "DEFER";
    consumesManeuverOnSubmit: boolean;
  }>;
  acknowledged: boolean;
  resolved: boolean;
}

/** Read-only, viewer-scoped authority required for every response command. */
export interface PressureResponseEventAuthorityPortV1 {
  readCurrent(input: Readonly<{
    roomId: string;
    runId: string;
    viewerSeatId: SeatIdV1;
    sourceEventId: string;
  }>): Promise<PressureResponseEventAuthorityV1 | null>;
}

/** Explicit test fixture only; production composition must use the release compiler. */
export class EmptyServerDecisionWorkingIntentCompilerV1
implements ServerDecisionWorkingIntentCompilerPortV1 {
  compile(): WorkingActionIntentV1 {
    return {
      visibility: "PRIVATE",
      targetSeatIds: [],
      evidenceRefs: [],
      resourceReservations: [],
      commitmentMutations: [],
      knowledgeGrants: [],
      seatArcProgress: [],
    };
  }
}

/**
 * Expands a server-derived action identity through the published Sangtian
 * action-effect release. No WorkingIntent member is accepted from HTTP JSON.
 */
export class SangtianServerDecisionWorkingIntentCompilerV1
implements ServerDecisionWorkingIntentCompilerPortV1 {
  constructor(
    private readonly release: PublishedSangtianActionReleaseV1 =
      loadPublishedSangtianActionReleaseV1(),
  ) {}

  compile(input: Readonly<{
    routeHash: string;
    chapterRuntimeId: string;
    chapterId: ChapterIdV1;
    decisionPointId: string;
    seatId: SeatIdV1;
    actionType: string;
  }>): WorkingActionIntentV1 {
    try {
      return structuredClone(this.release.compileActionBinding({
        chapterId: input.chapterId,
        decisionPointKey: input.decisionPointId,
        seatId: input.seatId,
        actionType: input.actionType,
      }).workingIntent);
    } catch (error) {
      return releaseMismatch("decision.actionEffectBinding", error);
    }
  }
}

/**
 * Server-side public command compiler. Client JSON never supplies actionType,
 * action ordinal/revision, WorkingActionIntent, authority hashes or rule facts.
 */
export class PressureDecisionCommandCompilerV1
implements PressureChapterHttpDecisionCompilerPort {
  constructor(
    private readonly games: PressureChapterHttpGamePort,
    private readonly working: WorkingProjectionReaderPort,
    private readonly content: AuthoredChapterContentPort,
    private readonly intents: ServerDecisionWorkingIntentCompilerPortV1,
    private readonly responseEvents: PressureResponseEventAuthorityPortV1 | null = null,
  ) {}

  async compile(input: Readonly<{
    access: PressureChapterHttpAccessV1;
    storedRoute: StoredRunRouteRecordV1;
    command: PressureChapterSubmitDecisionCommandV1;
    nowMs: number;
  }>): Promise<SubmitOrchestratedActionCommandV1> {
    const access = validateAccess(input.access);
    const storedRoute = assertStoredRunRouteRecord(input.storedRoute);
    const route = validateRunRouteSnapshotV1(storedRoute.snapshot);
    const publicCommand = validatePublicCommand(input.command);
    const chapterId = publicCommand.chapterId;
    if (chapterId === "P0") {
      mismatch("decision.chapterId", "P0_HAS_NO_FORMAL_DECISION");
    }
    if (!Number.isSafeInteger(input.nowMs) || input.nowMs < 0) {
      mismatch("decision.nowMs", "NON_NEGATIVE_SAFE_INTEGER");
    }
    if (
      storedRoute.runId !== route.runId
      || access.runId !== route.runId
      || publicCommand.runId !== route.runId
      || publicCommand.routeHash !== route.routeHash
    ) {
      mismatch("decision.route", "STORED_ROUTE_BINDING_MISMATCH");
    }
    const game = await this.games.read({
      runId: route.runId,
      subjectId: access.subjectId,
    });
    validateViewerProjection(game, publicCommand, access);
    const decision = requireViewerDecision(game);
    if (
      !game.capabilities.canSubmitDecision
      || !game.viewer.control.canSubmit
      || game.viewer.control.submissionFenceToken !== publicCommand.submissionFenceToken
    ) {
      mismatch("decision.submissionFence", "NOT_ACTIVE_OR_STALE");
    }
    const projection = await this.working.load({
      runId: route.runId,
      chapterRuntimeId: publicCommand.chapterRuntimeId,
    });
    if (
      projection.key.runId !== route.runId
      || projection.key.chapterRuntimeId !== publicCommand.chapterRuntimeId
      || projection.routeHash !== route.routeHash
      || projection.chapterId !== publicCommand.chapterId
      || projection.state.revision !== publicCommand.expectedWorkingRevision
      || projection.nextDecisionPin?.decisionPointId !== publicCommand.decisionPointId
    ) {
      mismatch("decision.workingProjection", "STALE_OR_WRONG_DECISION");
    }
    const descriptor = await this.content.load({
      routeSnapshot: route,
      chapterId,
    });
    const authored = descriptor.decisions.find(
      (candidate) => candidate.decisionPointId === publicCommand.decisionPointId,
    );
    if (!authored || authored.seatRequirements[publicCommand.seatId] !== "REQUIRED") {
      mismatch("decision.authored", "SEAT_OR_DECISION_NOT_ALLOWED");
    }
    const option = publicCommand.optionCode === null
      ? null
      : decision.options.find((candidate) => candidate.code === publicCommand.optionCode);
    if (publicCommand.customText !== null) {
      if (!decision.customActionAllowed || !publicCommand.customText.trim()) {
        mismatch("decision.customText", "NOT_ALLOWED");
      }
    }
    if (!option && publicCommand.optionCode !== null) {
      mismatch("decision.optionCode", "UNKNOWN_OPTION");
    }
    if (!option && publicCommand.customText === null) {
      mismatch("decision.optionCode", "OPTION_OR_CUSTOM_REQUIRED");
    }
    const actionType = option?.actionType ?? "CUSTOM_TEXT";
    if (!authored.execution.allowedActionTypes.includes(actionType)) {
      mismatch("decision.actionType", "NOT_AUTHORED");
    }
    const releasedIntent = canonicalizeWorkingActionIntentV1(this.intents.compile({
      routeHash: route.routeHash,
      chapterRuntimeId: publicCommand.chapterRuntimeId,
      chapterId: publicCommand.chapterId,
      decisionPointId: publicCommand.decisionPointId,
      seatId: publicCommand.seatId,
      actionType,
    }));
    const response = await compileResponseBinding({
      game,
      publicCommand,
      actionType,
      releasedIntent,
      responseEvents: this.responseEvents,
    });
    const payload: CanonicalJsonObject = response?.payload ?? {
      optionCode: publicCommand.optionCode,
      customText: publicCommand.customText,
    };
    const intent = response?.intent ?? releasedIntent;
    const prior = projection.actionsByIdempotencyKey.get(publicCommand.idempotencyKey);
    if (prior) {
      if (
        prior.action.runId !== route.runId
        || prior.action.chapterRuntimeId !== publicCommand.chapterRuntimeId
        || prior.action.decisionPointId !== publicCommand.decisionPointId
        || prior.action.seatId !== publicCommand.seatId
        || prior.action.actionType !== actionType
        || sha256Canonical(prior.action.payload) !== sha256Canonical(payload)
        || sha256Canonical(prior.intent) !== sha256Canonical(intent)
      ) {
        mismatch("decision.idempotencyKey", "REUSED_WITH_DIFFERENT_COMMAND");
      }
      return compileCommand({
        routeHash: route.routeHash,
        access,
        publicCommand,
        command: {
          routeSnapshot: route,
          subjectId: access.subjectId,
          action: structuredClone(prior.action),
          intent: structuredClone(prior.intent),
          inputFingerprint: prior.inputFingerprint,
          nowMs: input.nowMs,
        },
      });
    }
    const actionOrdinal = [...projection.acceptedActions.values()].filter(
      (accepted) =>
        accepted.action.decisionPointId === publicCommand.decisionPointId
        && accepted.action.seatId === publicCommand.seatId,
    ).length + 1;
    const budget = authored.execution.perSeatActionBudget[publicCommand.seatId];
    if (!budget || actionOrdinal > budget) {
      mismatch("decision.actionOrdinal", "BUDGET_EXCEEDED");
    }
    const actionId = `action_${sha256Canonical({
      schemaVersion: "pressure_server_action_identity_v1",
      runId: route.runId,
      chapterRuntimeId: publicCommand.chapterRuntimeId,
      decisionPointId: publicCommand.decisionPointId,
      seatId: publicCommand.seatId,
      idempotencyKey: publicCommand.idempotencyKey,
    })}`;
    const actionBase = {
      schemaVersion: "sangtian_decision_action_v1" as const,
      actionId,
      runId: route.runId,
      chapterRuntimeId: publicCommand.chapterRuntimeId,
      chapterId: publicCommand.chapterId,
      decisionPointId: publicCommand.decisionPointId,
      seatId: publicCommand.seatId,
      actionOrdinal,
      actionRevision: 1,
      controlEpoch: publicCommand.controlEpoch,
      expectedWorkingRevision: publicCommand.expectedWorkingRevision,
      status: "SEALED" as const,
      actionType,
      payload,
      payloadHash: sha256Canonical(payload),
      idempotencyKey: publicCommand.idempotencyKey,
    };
    const requestFingerprint = computeDecisionActionRequestFingerprint(actionBase);
    const sealedBase = { ...actionBase, requestFingerprint };
    const action = validateDecisionActionV1({
      ...sealedBase,
      sealedHash: sha256Canonical(sealedBase),
    });
    const inputFingerprint = computeFormalInteractionInputFingerprint({
      routeSnapshot: route,
      action,
      intent,
    });
    return compileCommand({
      routeHash: route.routeHash,
      access,
      publicCommand,
      command: {
        routeSnapshot: route,
        subjectId: access.subjectId,
        action,
        intent,
        inputFingerprint,
        nowMs: input.nowMs,
      },
    });
  }
}

function compileCommand(input: {
  routeHash: string;
  access: PressureChapterHttpAccessV1;
  publicCommand: PressureChapterSubmitDecisionCommandV1;
  command: SubmitOrchestratedActionCommandV1;
}): SubmitOrchestratedActionCommandV1 {
  const publicCommandHash = sha256Canonical(input.publicCommand);
  // Kept as an internal diagnostic binding. It is deliberately not a second
  // command contract crossing the HTTP/application boundary.
  sha256Canonical({
    schemaVersion: "pressure_server_decision_compilation_v1",
    routeHash: input.routeHash,
    access: {
      roomId: input.access.roomId,
      runId: input.access.runId,
      subjectId: input.access.subjectId,
      viewerId: input.access.viewerId,
    },
    publicCommandHash,
    submissionFenceToken: input.publicCommand.submissionFenceToken,
    actionSealedHash: input.command.action.sealedHash,
    inputFingerprint: input.command.inputFingerprint,
  });
  return structuredClone(input.command);
}

function validatePublicCommand(
  value: PressureChapterSubmitDecisionCommandV1,
): PressureChapterSubmitDecisionCommandV1 {
  const expected = [
    "schemaVersion", "commandType", "runId", "routeHash",
    "chapterRuntimeId", "chapterId", "seatId", "controlEpoch",
    "expectedWorkingRevision", "decisionPointId", "submissionFenceToken",
    "idempotencyKey", "optionCode", "customText", "sourceEventId",
    "responseActionCode",
  ].sort(compareCanonicalText);
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    mismatch("decision.publicCommand", "OBJECT");
  }
  const actual = Object.keys(value).sort(compareCanonicalText);
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    mismatch("decision.publicCommand", "EXACT_FIELDS");
  }
  if (
    value.schemaVersion !== PRESSURE_CHAPTER_GAME_COMMAND_SCHEMA_V1
    || value.commandType !== "SUBMIT_DECISION"
    || !value.runId.trim()
    || !value.chapterRuntimeId.trim()
    || !value.decisionPointId.trim()
    || !value.idempotencyKey.trim()
    || !/^[a-f0-9]{64}$/.test(value.routeHash)
    || !/^[a-f0-9]{64}$/.test(value.submissionFenceToken)
    || !Number.isSafeInteger(value.controlEpoch)
    || value.controlEpoch < 1
    || !Number.isSafeInteger(value.expectedWorkingRevision)
    || value.expectedWorkingRevision < 0
    || (value.optionCode !== null && !value.optionCode.trim())
    || (value.customText !== null && typeof value.customText !== "string")
    || (value.sourceEventId !== null
      && (typeof value.sourceEventId !== "string" || !value.sourceEventId.trim()))
    || (value.responseActionCode !== null
      && (typeof value.responseActionCode !== "string" || !value.responseActionCode.trim()))
    || ((value.sourceEventId === null) !== (value.responseActionCode === null))
  ) {
    mismatch("decision.publicCommand", "INVALID_FIELDS");
  }
  return structuredClone(value);
}

async function compileResponseBinding(input: Readonly<{
  game: PressureChapterGameProjectionV1;
  publicCommand: PressureChapterSubmitDecisionCommandV1;
  actionType: string;
  releasedIntent: WorkingActionIntentV1;
  responseEvents: PressureResponseEventAuthorityPortV1 | null;
}>): Promise<{ payload: CanonicalJsonObject; intent: WorkingActionIntentV1 } | null> {
  const actionType = INVESTIGATION_ACTION_TYPES.find((candidate) => candidate === input.actionType);
  if (input.publicCommand.sourceEventId === null) {
    if (actionType) mismatch("decision.responseBinding", "INVESTIGATION_RESPONSE_REQUIRED");
    return null;
  }
  if (!input.responseEvents || input.publicCommand.responseActionCode === null) {
    mismatch("decision.responseBinding", "AUTHORITY_READER_REQUIRED");
  }
  const source = await input.responseEvents.readCurrent({
    roomId: input.game.roomId,
    runId: input.game.runId,
    viewerSeatId: input.game.viewer.seatId,
    sourceEventId: input.publicCommand.sourceEventId,
  });
  const responseOption = source?.responseOptions.find(
    (option) => option.code === input.publicCommand.responseActionCode,
  );
  const decisionOption = input.game.decision?.options.find(
    (option) => option.code === input.publicCommand.optionCode,
  );
  if (
    !source
    || source.roomId !== input.game.roomId
    || source.runId !== input.game.runId
    || source.viewerSeatId !== input.game.viewer.seatId
    || source.sourceEventId !== input.publicCommand.sourceEventId
    || source.resolved
    || !responseOption
    || responseOption.preferredEntry === "DEFER"
    || !decisionOption
    || decisionOption.actionType !== input.actionType
    || decisionOption.preferredEntry !== responseOption.preferredEntry
    || input.publicCommand.responseActionCode !== input.actionType
  ) {
    mismatch("decision.responseBinding", "NOT_CURRENT_VISIBLE_ACKNOWLEDGED_OR_ALLOWED");
  }
  if (!actionType) {
    return {
      payload: {
        optionCode: input.publicCommand.optionCode,
        customText: input.publicCommand.customText,
        responseToEventId: source.sourceEventId,
        responseActionCode: input.publicCommand.responseActionCode,
        responseWorkbench: responseOption.preferredEntry,
        sourceProjectionVersion: source.projectionVersion,
      },
      intent: input.releasedIntent,
    };
  }
  if (
    input.publicCommand.chapterId !== "N6"
    || input.publicCommand.decisionPointId !== "N6.ledger_exchange"
    || input.publicCommand.seatId !== "qingliu_law"
    || input.publicCommand.customText !== null
    || input.publicCommand.optionCode !== actionType
  ) mismatch("decision.investigation", "FROZEN_N6_CONTEXT_REQUIRED");
  const expectedDisclosure = actionType === "INVESTIGATE_LEDGER_SOURCE" ? "HIDDEN" : "SUSPECTED";
  if (source.disclosure !== expectedDisclosure) {
    mismatch("decision.responseBinding", "DISCLOSURE_NOT_ALLOWED");
  }
  const evidenceRefs = actionType === "CONFIRM_LEDGER_SOURCE_WITH_EVIDENCE"
    ? [`evidence.a-emotion.${sha256Canonical({
        schemaVersion: "pressure_a_emotion_investigation_evidence_v1",
        runId: input.game.runId,
        viewerSeatId: input.game.viewer.seatId,
        sourceEventId: source.sourceEventId,
        sourceProjectionVersion: source.projectionVersion,
        sourceProjectionHash: source.projectionHash,
        disclosure: source.disclosure,
      })}`]
    : [];
  return {
    payload: {
      interactionKind: "A_EMOTION_INVESTIGATION",
      investigationCode: actionType as InvestigationActionTypeV1,
      responseToEventId: source.sourceEventId,
      sharedObjectId: "original-grain-ledger",
    },
    intent: canonicalizeWorkingActionIntentV1({
      ...input.releasedIntent,
      evidenceRefs,
    }),
  };
}

function validateAccess(value: PressureChapterHttpAccessV1): PressureChapterHttpAccessV1 {
  if (
    value.schemaVersion !== "pressure_chapter_http_access_v1"
    || !value.roomId.trim()
    || !value.runId.trim()
    || !value.subjectId.trim()
    || !value.viewerId.trim()
  ) {
    mismatch("decision.access", "INVALID_AUTHORIZED_ACCESS");
  }
  return structuredClone(value);
}

function validateViewerProjection(
  game: PressureChapterGameProjectionV1,
  command: PressureChapterSubmitDecisionCommandV1,
  access: PressureChapterHttpAccessV1,
): void {
  const decision = game.decision;
  if (!decision) {
    mismatch("decision.viewerProjection", "ACTIVE_DECISION_MISSING");
  }
  if (
    game.runId !== command.runId
    || game.roomId !== access.roomId
    || game.route.routeHash !== command.routeHash
    || game.chapter.chapterRuntimeId !== command.chapterRuntimeId
    || game.chapter.chapterId !== command.chapterId
    || game.chapter.workingRevision !== command.expectedWorkingRevision
    || game.viewer.seatId !== command.seatId
    || game.viewer.control.controlEpoch !== command.controlEpoch
    || decision.decisionPointId !== command.decisionPointId
    || decision.expectedWorkingRevision !== command.expectedWorkingRevision
  ) {
    mismatch("decision.viewerProjection", "STALE_OR_NOT_AUTHORIZED");
  }
}

function requireViewerDecision(
  game: PressureChapterGameProjectionV1,
): NonNullable<PressureChapterGameProjectionV1["decision"]> {
  if (!game.decision) {
    mismatch("decision.activeDecision", "MISSING");
  }
  return game.decision;
}

function mismatch(path: string, detail?: string): never {
  return failPressureChapterIntegration(
    "INTEGRATION_DECISION_COMMAND_MISMATCH",
    path,
    detail,
  );
}

function releaseMismatch(path: string, error: unknown): never {
  return failPressureChapterIntegration(
    "INTEGRATION_CONTENT_MISMATCH",
    path,
    error instanceof Error ? error.message : "RELEASE_COMPILATION_FAILED",
  );
}
