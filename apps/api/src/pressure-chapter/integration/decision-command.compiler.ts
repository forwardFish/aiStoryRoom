import {
  PRESSURE_CHAPTER_GAME_COMMAND_SCHEMA_V1,
  compareCanonicalText,
  computeDecisionActionRequestFingerprint,
  isSha256,
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
  loadSangtianPressureChapterBeatAuthoringV1,
  type PublishedSangtianActionReleaseV1,
} from "@ai-story/templates";
import { currentIndependentSeatDecisionPointV1 } from "../multiplayer-seat-progression/current-decision";
import type {
  PressureChapterGameProjectionV1,
  PressureGameCapabilitiesV1,
  PressureGameChapterReaderPort,
  PressureGameDecisionOptionV1,
  PressureGameViewerReaderPort,
} from "../game-projection/contracts";
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
  AuthoredDecisionRuntimeV1,
  SubmitOrchestratedActionCommandV1,
  WorkingProjectionReaderPort,
} from "../orchestrator/contracts";
import type {
  DecisionConvergenceSnapshotReaderPortV1,
  DecisionSubmitSnapshotV1,
} from "../decision-automation/contracts";
import { withDecisionSubmitSnapshotHashV1 } from "../decision-automation/prisma-snapshot";
import { withDecisionConvergenceSnapshotHashV1 } from "../decision-automation/convergence.service";
import { assertStoredRunRouteRecord } from "../run-router";
import type { StoredRunRouteRecordV1 } from "../run-router/types";
import type {
  WorkingActionIntentV1,
  WorkingLedgerProjectionV1,
} from "../working-ledger/contracts";
import { PressureCatalogCustomActionGuardV1 } from "./custom-action.guard";
import { failPressureChapterIntegration } from "./errors";
import {
  LEGACY_MULTIPLAYER_ONLY_BEAT_SUBMIT_POLICY_V1,
  type PressureBeatSubmitPolicyPortV1,
} from "../beat-submit-policy/policy";

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

export interface PressureDecisionAuthorityReaderV1 {
  chapter: {
    readCurrentWithProjection(input: {
      runId: string;
      routeHash: string;
      viewerSeatId: SeatIdV1;
    }): Promise<Readonly<{
      chapter: NonNullable<Awaited<ReturnType<PressureGameChapterReaderPort["readCurrent"]>>>;
      projection: Awaited<ReturnType<WorkingProjectionReaderPort["load"]>>;
    }> | null>;
  };
  viewer: Pick<PressureGameViewerReaderPort, "readViewer">;
  capabilities: {
    readCapabilities(input: Parameters<PressureGameCapabilitiesReaderV1["readCapabilities"]>[0]): ReturnType<PressureGameCapabilitiesReaderV1["readCapabilities"]>;
  };
}

interface PressureGameCapabilitiesReaderV1 {
  readCapabilities(input: {
    runId: string;
    routeHash: string;
    subjectId: string;
    viewerSeatId: SeatIdV1;
    chapterRuntimeId: string;
    decisionPointId: string | null;
  }): Promise<PressureGameCapabilitiesV1>;
}

type PreparedDecisionAuthorityV1 = Readonly<{
  decision: NonNullable<Awaited<ReturnType<PressureGameChapterReaderPort["readCurrent"]>>>["decision"];
  projection: WorkingLedgerProjectionV1;
}>;

const INVESTIGATION_ACTION_TYPES = Object.freeze([
  "INVESTIGATE_LEDGER_SOURCE",
  "CONFIRM_LEDGER_SOURCE_WITH_EVIDENCE",
] as const);

type InvestigationActionTypeV1 = (typeof INVESTIGATION_ACTION_TYPES)[number];

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
    private readonly authority?: PressureDecisionAuthorityReaderV1,
    private readonly submitSnapshots?: DecisionConvergenceSnapshotReaderPortV1,
    private readonly aiPolicyArtifactHash?: string,
    private readonly customActions = new PressureCatalogCustomActionGuardV1(),
    private readonly beatSubmitPolicy: PressureBeatSubmitPolicyPortV1 =
      LEGACY_MULTIPLAYER_ONLY_BEAT_SUBMIT_POLICY_V1,
  ) {}

  async compile(input: Readonly<{
    access: PressureChapterHttpAccessV1;
    storedRoute: StoredRunRouteRecordV1;
    command: PressureChapterSubmitDecisionCommandV1;
    nowMs: number;
  }>): Promise<SubmitOrchestratedActionCommandV1> {
    return this.compileInternal(input, null);
  }

  async compileWithSnapshot(input: Readonly<{
    access: PressureChapterHttpAccessV1;
    storedRoute: StoredRunRouteRecordV1;
    command: PressureChapterSubmitDecisionCommandV1;
    nowMs: number;
  }>): Promise<Readonly<{
    command: SubmitOrchestratedActionCommandV1;
    snapshot: DecisionSubmitSnapshotV1 | null;
    preparedWorkingProjection?: WorkingLedgerProjectionV1 | null;
  }>> {
    const access = validateAccess(input.access);
    const storedRoute = assertStoredRunRouteRecord(input.storedRoute);
    const route = validateRunRouteSnapshotV1(storedRoute.snapshot);
    const publicCommand = validatePublicCommand(input.command);
    if (
      !this.submitSnapshots?.captureSubmit
      || !this.aiPolicyArtifactHash
      || storedRoute.runId !== route.runId
      || access.runId !== route.runId
      || publicCommand.runId !== route.runId
      || publicCommand.routeHash !== route.routeHash
    ) mismatch("decision.submitSnapshot", "UNAVAILABLE_OR_ROUTE_MISMATCH");
    const snapshot = await this.submitSnapshots.captureSubmit({
      runId: route.runId,
      expectedRouteHash: route.routeHash,
      aiPolicyArtifactHash: this.aiPolicyArtifactHash,
      capturedAtMs: input.nowMs,
      roomId: access.roomId,
      subjectId: access.subjectId,
      seatId: publicCommand.seatId,
      chapterRuntimeId: publicCommand.chapterRuntimeId,
      decisionPointId: publicCommand.decisionPointId,
      expectedWorkingRevision: publicCommand.expectedWorkingRevision,
      expectedControlEpoch: publicCommand.controlEpoch,
      expectedSubmissionFenceToken: publicCommand.submissionFenceToken,
    });
    if (!snapshot) mismatch("decision.submitSnapshot", "NOT_FOUND");
    const validatedSnapshot = validateSubmitSnapshot(
      snapshot,
      access,
      publicCommand,
      this.aiPolicyArtifactHash,
      this.beatSubmitPolicy.usesIndependentSeatBeats({
        participantMode: route.participantMode,
        chapterId: publicCommand.chapterId,
      }),
    );
    const command = await this.compileInternal(input, validatedSnapshot);
    return {
      command,
      snapshot: structuredClone(validatedSnapshot),
      preparedWorkingProjection: structuredClone(validatedSnapshot.authority.projection),
    };
  }

  async compileAuthoritatively(input: Readonly<{
    roomId: string;
    subjectId: string;
    viewerId: string;
    command: PressureChapterSubmitDecisionCommandV1;
    nowMs: number;
  }>): Promise<Readonly<{
    access: PressureChapterHttpAccessV1;
    storedRoute: StoredRunRouteRecordV1;
    command: SubmitOrchestratedActionCommandV1;
    snapshot: DecisionSubmitSnapshotV1;
    preparedWorkingProjection: WorkingLedgerProjectionV1;
  }>> {
    const publicCommand = validatePublicCommand(input.command);
    if (
      !input.roomId.trim()
      || input.roomId !== publicCommand.runId
      || !input.subjectId.trim()
      || input.subjectId !== input.viewerId
      || !this.submitSnapshots?.captureSubmitAuthority
      || !this.aiPolicyArtifactHash
    ) mismatch("decision.authoritativeSubmit", "UNAVAILABLE_OR_INVALID_SCOPE");
    const bundle = await this.submitSnapshots.captureSubmitAuthority({
      runId: publicCommand.runId,
      expectedRouteHash: publicCommand.routeHash,
      aiPolicyArtifactHash: this.aiPolicyArtifactHash,
      capturedAtMs: input.nowMs,
      roomId: input.roomId,
      subjectId: input.subjectId,
      seatId: publicCommand.seatId,
      chapterRuntimeId: publicCommand.chapterRuntimeId,
      decisionPointId: publicCommand.decisionPointId,
      expectedWorkingRevision: publicCommand.expectedWorkingRevision,
      expectedControlEpoch: publicCommand.controlEpoch,
      expectedSubmissionFenceToken: publicCommand.submissionFenceToken,
    });
    if (!bundle) mismatch("decision.authoritativeSubmit", "NOT_FOUND");
    const storedRoute = assertStoredRunRouteRecord(bundle.storedRoute);
    const route = validateRunRouteSnapshotV1(storedRoute.snapshot);
    const access: PressureChapterHttpAccessV1 = {
      schemaVersion: "pressure_chapter_http_access_v1",
      roomId: input.roomId,
      runId: publicCommand.runId,
      subjectId: input.subjectId,
      viewerId: input.viewerId,
      participantMode: route.participantMode,
    };
    const snapshot = validateSubmitSnapshot(
      bundle.snapshot,
      access,
      publicCommand,
      this.aiPolicyArtifactHash,
      this.beatSubmitPolicy.usesIndependentSeatBeats({
        participantMode: route.participantMode,
        chapterId: publicCommand.chapterId,
      }),
    );
    const command = await this.compileInternal({
      access,
      storedRoute,
      command: publicCommand,
      nowMs: input.nowMs,
    }, snapshot);
    return {
      access,
      storedRoute,
      command,
      snapshot: structuredClone(snapshot),
      preparedWorkingProjection: structuredClone(snapshot.authority.projection),
    };
  }

  /** SQL7 bridge: compiles from the already captured one-statement snapshot. */
  async compileFromCapturedSnapshot(input: Readonly<{
    access: PressureChapterHttpAccessV1;
    storedRoute: StoredRunRouteRecordV1;
    command: PressureChapterSubmitDecisionCommandV1;
    nowMs: number;
    snapshot: DecisionSubmitSnapshotV1;
  }>): Promise<SubmitOrchestratedActionCommandV1> {
    if (!this.aiPolicyArtifactHash) {
      mismatch("decision.submitSnapshot", "AI_POLICY_ARTIFACT_UNAVAILABLE");
    }
    const access = validateAccess(input.access);
    const publicCommand = validatePublicCommand(input.command);
    const validatedSnapshot = validateSubmitSnapshot(
      input.snapshot,
      access,
      publicCommand,
      this.aiPolicyArtifactHash,
      this.beatSubmitPolicy.usesIndependentSeatBeats({
        participantMode: input.snapshot.authority.routeSnapshot.participantMode,
        chapterId: publicCommand.chapterId,
      }),
    );
    return this.compileInternal({
      access,
      storedRoute: assertStoredRunRouteRecord(input.storedRoute),
      command: publicCommand,
      nowMs: input.nowMs,
    }, validatedSnapshot);
  }

  private async compileInternal(input: Readonly<{
    access: PressureChapterHttpAccessV1;
    storedRoute: StoredRunRouteRecordV1;
    command: PressureChapterSubmitDecisionCommandV1;
    nowMs: number;
  }>, submitSnapshot: DecisionSubmitSnapshotV1 | null,
  preparedAuthority: PreparedDecisionAuthorityV1 | null = null,
  preparedProjection: WorkingLedgerProjectionV1 | null = null,
  ): Promise<SubmitOrchestratedActionCommandV1> {
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
    const independentSeatFlow = this.beatSubmitPolicy.usesIndependentSeatBeats({
      participantMode: route.participantMode,
      chapterId: publicCommand.chapterId,
    });
    const authority = preparedAuthority
      ?? (!submitSnapshot && this.authority
        ? await this.readDecisionAuthority(route, access, publicCommand)
        : null);
    const multiplayerProjection = independentSeatFlow
      ? submitSnapshot?.authority.projection
        ?? preparedProjection
        ?? authority?.projection
        ?? await this.working.load({
          runId: route.runId,
          chapterRuntimeId: publicCommand.chapterRuntimeId,
        })
      : null;
    const multiplayerPrior = multiplayerProjection?.actionsByIdempotencyKey.get(
      publicCommand.idempotencyKey,
    );
    if (multiplayerPrior) {
      const viewer = !authority && this.authority
        ? await this.authority.viewer.readViewer({
            runId: route.runId,
            subjectId: access.subjectId,
          })
        : null;
      if (
        (!authority && (
          !viewer
          || viewer.runId !== publicCommand.runId
          || viewer.roomId !== access.roomId
          || viewer.routeHash !== publicCommand.routeHash
          || viewer.subjectId !== access.subjectId
          || viewer.viewer.seatId !== publicCommand.seatId
          || viewer.viewer.control.controlEpoch !== publicCommand.controlEpoch
          || viewer.viewer.control.submissionFenceToken !== publicCommand.submissionFenceToken
        ))
        || multiplayerPrior.action.runId !== route.runId
        || multiplayerPrior.action.chapterRuntimeId !== publicCommand.chapterRuntimeId
        || multiplayerPrior.action.chapterId !== publicCommand.chapterId
        || multiplayerPrior.action.decisionPointId !== publicCommand.decisionPointId
        || multiplayerPrior.action.seatId !== publicCommand.seatId
        || multiplayerPrior.action.controlEpoch !== publicCommand.controlEpoch
        || multiplayerPrior.action.expectedWorkingRevision !== publicCommand.expectedWorkingRevision
        || multiplayerPrior.action.idempotencyKey !== publicCommand.idempotencyKey
        || !matchesPriorPublicCommandV1(multiplayerPrior.action.payload, publicCommand)
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
          action: structuredClone(multiplayerPrior.action),
          intent: structuredClone(multiplayerPrior.intent),
          inputFingerprint: multiplayerPrior.inputFingerprint,
          nowMs: input.nowMs,
        },
      });
    }
    const game = authority || submitSnapshot
      ? null
      : await this.games.read({
          runId: route.runId,
          subjectId: access.subjectId,
        });
    const projection = submitSnapshot?.authority.projection
      ?? authority?.projection
      ?? multiplayerProjection
      ?? await this.working.load({
      runId: route.runId,
      chapterRuntimeId: publicCommand.chapterRuntimeId,
    });
    const multiplayerDecisionPointId = independentSeatFlow
      ? multiplayerDecisionPointForSeatV1({
          route,
          projection,
          chapterRuntimeId: publicCommand.chapterRuntimeId,
          chapterId: publicCommand.chapterId,
          seatId: publicCommand.seatId,
        })
      : null;
    if (
      projection.key.runId !== route.runId
      || projection.key.chapterRuntimeId !== publicCommand.chapterRuntimeId
      || projection.routeHash !== route.routeHash
      || projection.chapterId !== publicCommand.chapterId
      || projection.state.revision !== publicCommand.expectedWorkingRevision
      || (
        independentSeatFlow
          ? multiplayerDecisionPointId !== publicCommand.decisionPointId
          : projection.nextDecisionPin?.decisionPointId !== publicCommand.decisionPointId
      )
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
    const decision: DecisionCompilationViewV1 = submitSnapshot
      ? decisionFromSubmittedAuthority(authored, projection.state.revision)
      : authority?.decision ?? requireViewerDecision(game!);
    const option = publicCommand.optionCode === null
      ? null
      : decision.options.find((candidate) => candidate.code === publicCommand.optionCode);
    let customActionType: string | null = null;
    if (publicCommand.customText !== null) {
      if (!decision.customActionAllowed || !publicCommand.customText.trim()) {
        mismatch("decision.customText", "NOT_ALLOWED");
      }
      const guarded = this.customActions.bind({
        customText: publicCommand.customText,
        visibleOptions: decision.options,
        allowedActionTypes: authored.execution.allowedActionTypes,
      });
      if (!guarded.accepted) {
        mismatch("decision.customText", guarded.code);
      }
      customActionType = guarded.actionType;
    }
    if (!option && publicCommand.optionCode !== null) {
      mismatch("decision.optionCode", "UNKNOWN_OPTION");
    }
    if (!option && publicCommand.customText === null) {
      mismatch("decision.optionCode", "OPTION_OR_CUSTOM_REQUIRED");
    }
    const actionType = option?.actionType ?? customActionType ?? "DEFAULT_PASS";
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
    const investigation = INVESTIGATION_ACTION_TYPES.includes(actionType as InvestigationActionTypeV1)
      ? compileInvestigationBinding({
          game: await this.games.read({ runId: route.runId, subjectId: access.subjectId }),
          publicCommand,
          actionType,
          releasedIntent,
        })
      : null;
    if (!investigation && publicCommand.sourceEventId !== null) {
      mismatch("decision.sourceEventId", "NON_INVESTIGATION_MUST_BE_NULL");
    }
    const payload: CanonicalJsonObject = investigation?.payload ?? {
      optionCode: publicCommand.optionCode,
      customText: publicCommand.customText,
    };
    const intent = investigation?.intent ?? releasedIntent;
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

  private async readDecisionAuthority(
    route: ReturnType<typeof validateRunRouteSnapshotV1>,
    access: PressureChapterHttpAccessV1,
    command: PressureChapterSubmitDecisionCommandV1,
  ): Promise<{
    decision: NonNullable<Awaited<ReturnType<PressureGameChapterReaderPort["readCurrent"]>>>["decision"];
    projection: Awaited<ReturnType<WorkingProjectionReaderPort["load"]>>;
  }> {
    const [authorityChapter, viewer] = await Promise.all([
      this.authority!.chapter.readCurrentWithProjection({
        runId: route.runId,
        routeHash: route.routeHash,
        viewerSeatId: command.seatId,
      }),
      this.authority!.viewer.readViewer({
        runId: route.runId,
        subjectId: access.subjectId,
      }),
    ]);
    const chapter = authorityChapter?.chapter ?? null;
    const projection = authorityChapter?.projection ?? null;
    if (!chapter || !viewer) mismatch("decision.authority", "NOT_FOUND");
    if (!projection) mismatch("decision.authority", "WORKING_PROJECTION_MISSING");
    if (
      chapter.runId !== command.runId
      || chapter.routeHash !== command.routeHash
      || chapter.viewerSeatId !== command.seatId
      || chapter.chapter.chapterRuntimeId !== command.chapterRuntimeId
      || chapter.chapter.chapterId !== command.chapterId
      || chapter.chapter.workingRevision !== command.expectedWorkingRevision
      || projection.key.runId !== command.runId
      || projection.key.chapterRuntimeId !== command.chapterRuntimeId
      || projection.routeHash !== command.routeHash
      || projection.chapterId !== command.chapterId
      || projection.state.revision !== command.expectedWorkingRevision
      || (
        this.beatSubmitPolicy.usesIndependentSeatBeats({
          participantMode: route.participantMode,
          chapterId: command.chapterId,
        })
          ? multiplayerDecisionPointForSeatV1({
              route,
              projection,
              chapterRuntimeId: command.chapterRuntimeId,
              chapterId: command.chapterId,
              seatId: command.seatId,
            }) !== command.decisionPointId
          : projection.nextDecisionPin?.decisionPointId !== command.decisionPointId
      )
      || viewer.runId !== command.runId
      || viewer.roomId !== access.roomId
      || viewer.routeHash !== command.routeHash
      || viewer.subjectId !== access.subjectId
      || viewer.viewer.seatId !== command.seatId
      || viewer.viewer.control.controlEpoch !== command.controlEpoch
      || viewer.viewer.control.submissionFenceToken !== command.submissionFenceToken
      || !viewer.viewer.control.canSubmit
      || !chapter.decision
      || chapter.decision.decisionPointId !== command.decisionPointId
      || chapter.decision.expectedWorkingRevision !== command.expectedWorkingRevision
    ) mismatch("decision.authority", "STALE_OR_NOT_AUTHORIZED");
    if (this.beatSubmitPolicy.usesIndependentSeatBeats({
      participantMode: route.participantMode,
      chapterId: command.chapterId,
    })) {
      return { decision: chapter.decision, projection };
    }
    const capabilities = await this.authority!.capabilities.readCapabilities({
      runId: command.runId,
      routeHash: command.routeHash,
      subjectId: access.subjectId,
      viewerSeatId: command.seatId,
      chapterRuntimeId: command.chapterRuntimeId,
      decisionPointId: command.decisionPointId,
    });
    if (!capabilities.canSubmitDecision) mismatch("decision.capabilities", "NOT_ALLOWED");
    return { decision: chapter.decision, projection };
  }
}

function multiplayerDecisionPointForSeatV1(input: Readonly<{
  route: ReturnType<typeof validateRunRouteSnapshotV1>;
  projection: Awaited<ReturnType<WorkingProjectionReaderPort["load"]>>;
  chapterRuntimeId: string;
  chapterId: PressureChapterSubmitDecisionCommandV1["chapterId"];
  seatId: SeatIdV1;
}>): string | null {
  if (input.chapterId === "P0") {
    mismatch("decision.chapterId", "P0_HAS_NO_FORMAL_DECISION");
  }
  return currentIndependentSeatDecisionPointV1({
    routeSnapshot: input.route,
    projection: input.projection,
    chapterRuntimeId: input.chapterRuntimeId,
    chapterId: input.chapterId,
    seatId: input.seatId,
  });
}

function matchesPriorPublicCommandV1(
  payload: CanonicalJsonObject,
  command: PressureChapterSubmitDecisionCommandV1,
): boolean {
  if (payload.interactionKind === "A_EMOTION_INVESTIGATION") {
    return payload.investigationCode === command.optionCode
      && payload.responseToEventId === command.sourceEventId
      && command.customText === null;
  }
  return (payload.optionCode ?? null) === command.optionCode
    && (payload.customText ?? null) === command.customText
    && command.sourceEventId === null;
}

interface DecisionCompilationViewV1 {
  options: PressureGameDecisionOptionV1[];
  customActionAllowed: boolean;
}

function decisionFromSubmittedAuthority(
  authored: AuthoredDecisionRuntimeV1,
  workingRevision: number,
): DecisionCompilationViewV1 {
  if (!Number.isSafeInteger(workingRevision) || workingRevision < 0) {
    mismatch("decision.workingRevision", "NON_NEGATIVE_SAFE_INTEGER");
  }
  return {
    options: authored.execution.allowedActionTypes.map((actionType) => ({
      code: actionType,
      label: actionType,
      description: actionType,
      actionType,
      preferredEntry: "DEFER",
    })),
    customActionAllowed: true,
  };
}

function validateSubmitSnapshot(
  raw: DecisionSubmitSnapshotV1,
  access: PressureChapterHttpAccessV1,
  command: PressureChapterSubmitDecisionCommandV1,
  aiPolicyArtifactHash: string,
  independentSeatFlow: boolean,
): DecisionSubmitSnapshotV1 {
  if (
    raw.schemaVersion !== "pressure_decision_submit_snapshot_v1"
    || !isSha256(raw.submitSnapshotHash)
    || raw.viewer.roomId !== access.roomId
    || raw.viewer.runId !== access.runId
    || raw.viewer.subjectId !== access.subjectId
    || raw.viewer.humanControllerId !== access.subjectId
    || raw.viewer.seatId !== command.seatId
    || raw.authority.routeSnapshot.runId !== command.runId
    || raw.authority.routeSnapshot.routeHash !== command.routeHash
    || raw.authority.aiPolicyArtifactHash !== aiPolicyArtifactHash
    || raw.authority.chapter.chapterRuntimeId !== command.chapterRuntimeId
    || raw.authority.chapter.currentChapterId !== command.chapterId
    || (
      independentSeatFlow
        ? currentIndependentSeatDecisionPointV1({
            routeSnapshot: raw.authority.routeSnapshot,
            projection: raw.authority.projection,
            chapterRuntimeId: command.chapterRuntimeId,
            chapterId: command.chapterId,
            seatId: command.seatId,
          }) !== command.decisionPointId
        : raw.authority.chapter.activeDecision?.decisionPointId !== command.decisionPointId
    )
    || raw.authority.projection.state.revision !== command.expectedWorkingRevision
  ) mismatch("decision.submitSnapshot", "INVALID_BINDING");
  const expectedAuthority = withDecisionConvergenceSnapshotHashV1({
    schemaVersion: raw.authority.schemaVersion,
    routeSnapshot: raw.authority.routeSnapshot,
    chapter: raw.authority.chapter,
    projection: raw.authority.projection,
    seatAuthority: raw.authority.seatAuthority,
    aiPolicyArtifactHash: raw.authority.aiPolicyArtifactHash,
    capturedAtMs: raw.authority.capturedAtMs,
  });
  const expectedSubmit = withDecisionSubmitSnapshotHashV1({
    schemaVersion: raw.schemaVersion,
    authority: expectedAuthority,
    viewer: raw.viewer,
  });
  if (
    expectedAuthority.snapshotHash !== raw.authority.snapshotHash
    || expectedSubmit.submitSnapshotHash !== raw.submitSnapshotHash
  ) mismatch("decision.submitSnapshot", "SELF_HASH_MISMATCH");
  return expectedSubmit;
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
  ) {
    mismatch("decision.publicCommand", "INVALID_FIELDS");
  }
  return structuredClone(value);
}

function compileInvestigationBinding(input: Readonly<{
  game: PressureChapterGameProjectionV1;
  publicCommand: PressureChapterSubmitDecisionCommandV1;
  actionType: string;
  releasedIntent: WorkingActionIntentV1;
}>): { payload: CanonicalJsonObject; intent: WorkingActionIntentV1 } | null {
  const actionType = INVESTIGATION_ACTION_TYPES.find((candidate) => candidate === input.actionType);
  if (!actionType) {
    if (input.publicCommand.sourceEventId !== null) {
      mismatch("decision.sourceEventId", "NON_INVESTIGATION_MUST_BE_NULL");
    }
    return null;
  }
  if (
    input.publicCommand.chapterId !== "N6"
    || input.publicCommand.decisionPointId !== "N6.ledger_exchange"
    || input.publicCommand.seatId !== "qingliu_law"
    || input.publicCommand.customText !== null
    || input.publicCommand.optionCode !== actionType
    || input.publicCommand.sourceEventId === null
  ) {
    mismatch("decision.investigation", "FROZEN_N6_CONTEXT_REQUIRED");
  }
  const source = input.game.feedPage.items.find(
    (item) => item.eventId === input.publicCommand.sourceEventId,
  );
  const expectedDisclosure = actionType === "INVESTIGATE_LEDGER_SOURCE"
    ? "HIDDEN"
    : "SUSPECTED";
  if (
    !source
    || source.roomId !== input.game.roomId
    || source.runId !== input.game.runId
    || source.viewerSeatId !== "qingliu_law"
    || !source.isAcknowledged
    || source.isResolved
    || source.disclosure !== expectedDisclosure
    || !source.responseOptions.some((option) => option.code === actionType)
  ) {
    mismatch("decision.sourceEventId", "NOT_VISIBLE_ACKNOWLEDGED_LATEST_SOURCE");
  }
  const evidenceRefs = actionType === "CONFIRM_LEDGER_SOURCE_WITH_EVIDENCE"
    ? [`evidence.a-emotion.${sha256Canonical({
        schemaVersion: "pressure_a_emotion_investigation_evidence_v1",
        runId: input.game.runId,
        viewerSeatId: input.game.viewer.seatId,
        sourceEventId: source.eventId,
        sourceProjectionVersion: source.projectionVersion,
        sourceProjectionHash: source.projectionHash,
        disclosure: source.disclosure,
      })}`]
    : [];
  return {
    payload: {
      interactionKind: "A_EMOTION_INVESTIGATION",
      investigationCode: actionType as InvestigationActionTypeV1,
      responseToEventId: source.eventId,
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
    || (value.participantMode !== undefined
      && value.participantMode !== "SOLO"
      && value.participantMode !== "MULTIPLAYER")
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
