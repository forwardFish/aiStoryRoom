import { performance } from "node:perf_hooks";
import { Inject, Injectable } from "@nestjs/common";
import {
  assertSangtianPressureRouteV1,
  sha256Canonical,
  validateDecisionActionV1,
  validatePressureReplayCommandV1,
  type PressureChapterSubmitDecisionCommandV1,
} from "@ai-story/shared";
import type { PressureDecisionConvergencePortV1 } from "../decision-automation/contracts";
import type { MultiplayerSeatProgressionPortV1 } from "../multiplayer-seat-progression/contracts";
import type { MultiplayerChapterConvergencePortV1 } from "../multiplayer-chapter-convergence/contracts";
import {
  LEGACY_MULTIPLAYER_ONLY_BEAT_SUBMIT_POLICY_V1,
  type PressureBeatSubmitPolicyPortV1,
} from "../beat-submit-policy/policy";
import type { PressurePostCommitTurnUpdatePortV1 } from "../post-commit-turn-update/contracts";
import type { PressureSql7FirstSubmitServiceV1 } from "../sql7-fast-path/service";
import type { PressureGameReadModeV1 } from "../observability/game-read-observation";
import {
  NoopPressureGameReadRuntimeObserverV1,
  type PressureGameReadRuntimeObserverPortV1,
} from "../observability/game-read-runtime-observer";
import {
  logPressureDecisionBackendResponseV1,
  logPressureDecisionFailureV1,
  logPressureDecisionTimingV1,
  pressureDecisionFailureCodeV1,
} from "../observability/decision-timing-log";
import { computePressureChatRequestFingerprint } from "../interaction/chat.service";
import {
  canonicalizeWorkingActionIntentV1,
  computeFormalInteractionInputFingerprint,
} from "../interaction/formal-interaction.service";
import {
  assertStoredRunRouteRecord,
  type StoredRunRouteRecordV1,
} from "../run-router";
import {
  PRESSURE_CHAPTER_HTTP_ERROR_CODES as ERROR,
  failPressureChapterHttp,
  pressureHttpBoundary,
} from "./errors";
import {
  PRESSURE_CHAPTER_HTTP_TOKENS as TOKEN,
  type LegacyPressureSlotEndpointV1,
  type PressureChapterChatHttpResponseV1,
  type PressureChapterGameHttpQueryV1,
  type PressureChapterHttpAccessV1,
  type PressureChapterHttpAccessPort,
  type PressureChapterHttpActionPort,
  type PressureChapterHttpChatPort,
  type PressureChapterHttpClockPort,
  type PressureChapterHttpDecisionCompilerPort,
  type PressureChapterHttpGamePort,
  type PressureChapterHttpPrincipalV1,
  type PressureChapterHttpReplayPort,
  type PressureChapterHttpResultPort,
  type PressureChapterHttpRoutePort,
  type PressureChapterSubmitDecisionHttpResponseV1,
} from "./contracts";
import {
  parseAccess,
  parseChatBody,
  parseGameQuery,
  parseLegacyEndpoint,
  parsePrincipal,
  parseSubmitDecisionCommand,
  requiredInteger,
  requiredString,
} from "./validation";

type HttpOperation = "GAME" | "ACTION" | "RESULT" | "REPLAY";

/**
 * Thin application boundary. It owns no game state and cannot calculate rules:
 * every read or command delegates to the already authoritative feature module.
 */
@Injectable()
export class PressureChapterHttpFacade {
  constructor(
    @Inject(TOKEN.ACCESS)
    private readonly access: PressureChapterHttpAccessPort,
    @Inject(TOKEN.ROUTES)
    private readonly routes: PressureChapterHttpRoutePort,
    @Inject(TOKEN.GAME)
    private readonly game: PressureChapterHttpGamePort,
    @Inject(TOKEN.DECISION_COMPILER)
    private readonly decisionCompiler: PressureChapterHttpDecisionCompilerPort,
    @Inject(TOKEN.ACTIONS)
    private readonly actions: PressureChapterHttpActionPort,
    @Inject(TOKEN.CHAT)
    private readonly chat: PressureChapterHttpChatPort,
    @Inject(TOKEN.RESULT)
    private readonly result: PressureChapterHttpResultPort,
    @Inject(TOKEN.REPLAY)
    private readonly replayPort: PressureChapterHttpReplayPort,
    @Inject(TOKEN.CLOCK)
    private readonly clock: PressureChapterHttpClockPort,
    private readonly convergence: PressureDecisionConvergencePortV1 | undefined = undefined,
    private readonly sql7: Pick<PressureSql7FirstSubmitServiceV1, "submit"> | undefined = undefined,
    private readonly gameRead: Pick<PressureChapterHttpGamePort, "read"> = game,
    private readonly gameReadMode: PressureGameReadModeV1 = "REPLAY",
    private readonly gameReadObserver: PressureGameReadRuntimeObserverPortV1 =
      new NoopPressureGameReadRuntimeObserverV1(),
    private readonly multiplayerProgression: MultiplayerSeatProgressionPortV1 | null = null,
    private readonly multiplayerChapterConvergence: MultiplayerChapterConvergencePortV1 | null = null,
    private readonly beatSubmitPolicy: PressureBeatSubmitPolicyPortV1 =
      LEGACY_MULTIPLAYER_ONLY_BEAT_SUBMIT_POLICY_V1,
    private readonly postCommitTurnUpdates: PressurePostCommitTurnUpdatePortV1 | null = null,
  ) {}

  getGame(
    principalValue: PressureChapterHttpPrincipalV1,
    roomIdValue: string,
    queryValue: PressureChapterGameHttpQueryV1 = {},
  ) {
    return pressureHttpBoundary(() => this.gameReadObserver.observe(
      this.gameReadMode,
      {
        roomId: roomIdValue,
        principal: principalValue,
        query: queryValue,
      },
      async () => {
        const principal = parsePrincipal(principalValue);
        const roomId = requiredString(roomIdValue, "roomId");
        const query = parseGameQuery(queryValue);
        const access = this.gameReadMode === "FAST"
          ? await this.resolveAccess(principal, roomId)
          : (await this.resolveContext(principal, roomId, "GAME")).access;
        const multiplayer = access.participantMode === "MULTIPLAYER";
        const reader = multiplayer
          ? this.game
          : this.gameRead;
        const projection = await reader.read({
          runId: access.runId,
          subjectId: access.subjectId,
          ...query,
        });
        if (
          access.participantMode !== undefined
          && this.beatSubmitPolicy.usesIndependentSeatBeats({
              participantMode: access.participantMode,
              chapterId: projection.chapter.chapterId,
            })
          && this.multiplayerChapterConvergence
          && projection.chapter.chapterId !== "P0"
          && ["RESOLVING_BEAT", "SETTLING"].includes(projection.chapter.phase)
        ) {
          const stored = assertStoredRunRouteRecord(
            await this.routes.readStoredRoute(access.runId),
          );
          const recovery = await this.multiplayerChapterConvergence.convergeIfReady({
            routeSnapshot: stored.snapshot,
            chapterRuntimeId: projection.chapter.chapterRuntimeId,
            chapterId: projection.chapter.chapterId,
            nowMs: requiredInteger(this.clock.nowMs(), "clock.nowMs", 0),
          });
          if (recovery.status === "CONVERGED") {
            return reader.read({
              runId: access.runId,
              subjectId: access.subjectId,
              ...query,
            });
          }
        }
        return projection;
      },
    ));
  }

  getNarrativeUpdate(
    principalValue: PressureChapterHttpPrincipalV1,
    roomIdValue: string,
    chapterRuntimeIdValue: string,
    updateKeyValue?: string,
  ) {
    return pressureHttpBoundary(async () => {
      const principal = parsePrincipal(principalValue);
      const roomId = requiredString(roomIdValue, "roomId");
      const chapterRuntimeId = requiredString(
        chapterRuntimeIdValue,
        "chapterRuntimeId",
      );
      if (updateKeyValue && this.postCommitTurnUpdates) {
        return this.postCommitTurnUpdates.read({
          runId: roomId,
          subjectId: principal.subjectId,
          updateKey: requiredString(updateKeyValue, "updateKey"),
          chapterRuntimeId,
        });
      }
      const access = await this.resolveAccess(principal, roomId);
      if (!this.game.readNarrativeUpdate) {
        failPressureChapterHttp(ERROR.DEPENDENCY_FAILURE, "game.readNarrativeUpdate");
      }
      return this.game.readNarrativeUpdate({
        runId: access.runId,
        subjectId: access.subjectId,
        chapterRuntimeId,
      });
    });
  }

  getResult(
    principalValue: PressureChapterHttpPrincipalV1,
    roomIdValue: string,
  ) {
    return pressureHttpBoundary(async () => {
      const principal = parsePrincipal(principalValue);
      const roomId = requiredString(roomIdValue, "roomId");
      const context = await this.resolveContext(principal, roomId, "RESULT");
      return this.result.getResult({
        runId: context.access.runId,
        viewerId: context.access.viewerId,
      });
    });
  }

  submitDecision(
    principalValue: PressureChapterHttpPrincipalV1,
    roomIdValue: string,
    bodyValue: unknown,
  ): Promise<PressureChapterSubmitDecisionHttpResponseV1> {
    return pressureHttpBoundary(async () => {
      const endToEndStartedAt = performance.now();
      let failureStage = "INPUT_VALIDATION";
      let responseStatus: "SUCCESS" | "FAILURE" = "FAILURE";
      let responseOutcome = "FAILED";
      let responseStage = failureStage;
      let responseFailureCode: string | null = null;
      const httpTimings: Record<string, number> = {
        sql7AttemptMs: 0,
        accessContextMs: 0,
        commandCompileMs: 0,
        humanSubmitMs: 0,
        convergenceMs: 0,
        projectionMs: 0,
        totalMs: 0,
      };
      const requestLog = decisionRequestLogIdentity(roomIdValue, bodyValue);
      try {
      const principal = parsePrincipal(principalValue);
      const roomId = requiredString(roomIdValue, "roomId");
      const command = parseSubmitDecisionCommand(bodyValue);
      if (this.sql7 && command.chapterId === "N1") {
        const sql7NowMs = requiredInteger(this.clock.nowMs(), "clock.nowMs", 0);
        failureStage = "SQL7_SUBMIT";
        const sql7StartedAt = performance.now();
        const sql7 = await this.sql7.submit({
            principal: structuredClone(principal),
            roomId,
            command: structuredClone(command),
            nowMs: sql7NowMs,
          }).catch((error: unknown) => {
          console.error("Pressure SQL7 submit failed", JSON.stringify({
            runId: command.runId,
            chapterId: command.chapterId,
            code: error && typeof error === "object" && "code" in error
              ? String(error.code)
              : "UNKNOWN",
            message: error instanceof Error
              ? error.message.replace(/[\r\n]+/g, " ").slice(0, 500)
              : "UNKNOWN",
          }));
           throw error;
           });
        httpTimings.sql7AttemptMs = elapsed(sql7StartedAt);
        if (sql7.status === "COMMITTED") {
          responseStatus = "SUCCESS";
          responseOutcome = "SQL7_COMMITTED";
          responseStage = "RESPONSE_READY";
          httpTimings.totalMs = elapsed(endToEndStartedAt);
          logPressureDecisionTimingV1({
            path: "HTTP",
            runId: command.runId,
            chapterId: command.chapterId,
            decisionPointId: command.decisionPointId,
            outcome: "SQL7_COMMITTED",
            failureCode: null,
            timings: httpTimings,
          });
          return sql7.response;
        }
        if (sql7.status === "REPLAYED") {
          const replayContext = await this.resolveContext(principal, roomId, "ACTION");
          assertPublicDecisionScope(command, replayContext.access, replayContext.stored);
          const projection = await this.game.read({
            runId: replayContext.access.runId,
            subjectId: replayContext.access.subjectId,
          });
          responseStatus = "SUCCESS";
          responseOutcome = "SQL7_REPLAYED";
          responseStage = "RESPONSE_READY";
          return {
            schemaVersion: "pressure_chapter_submit_decision_http_response_v1",
            idempotencyKey: sql7.idempotencyKey,
            projection,
          };
        }
      }
      const nowMs = requiredInteger(this.clock.nowMs(), "clock.nowMs", 0);
      failureStage = "COMMAND_COMPILE";
      const commandCompileStartedAt = performance.now();
      const authoritativeCompilation = this.decisionCompiler.compileAuthoritatively
        ? await this.decisionCompiler.compileAuthoritatively({
            roomId,
            subjectId: principal.subjectId,
            viewerId: principal.viewerId,
            command: structuredClone(command),
            nowMs,
          })
        : null;
      const context = authoritativeCompilation
        ? {
            access: authoritativeCompilation.access,
            stored: authoritativeCompilation.storedRoute,
          }
        : await (async () => {
            failureStage = "ACCESS_CONTEXT";
            const contextStartedAt = performance.now();
            const resolved = await this.resolveContext(principal, roomId, "ACTION");
            httpTimings.accessContextMs = elapsed(contextStartedAt);
            return resolved;
          })();
      assertPublicDecisionScope(command, context.access, context.stored);
      const compilerInput = {
        access: structuredClone(context.access),
        storedRoute: structuredClone(context.stored),
        command: structuredClone(command),
        nowMs,
      };
      const compilation = authoritativeCompilation ?? (
        this.decisionCompiler.compileWithSnapshot
          ? await this.decisionCompiler.compileWithSnapshot(compilerInput)
          : {
              command: await this.decisionCompiler.compile(compilerInput),
              snapshot: null,
              preparedWorkingProjection: null,
            }
      );
      httpTimings.commandCompileMs = elapsed(commandCompileStartedAt);
      const compiled = validateCompiledDecisionCommand(
        compilation.command,
        context.access,
        context.stored,
        command,
        nowMs,
      );
      if (this.beatSubmitPolicy.usesIndependentSeatBeats({
        participantMode: context.stored.snapshot.participantMode,
        chapterId: compiled.action.chapterId,
      })) {
        if (!this.multiplayerProgression || !this.multiplayerChapterConvergence) {
          failPressureChapterHttp(
            ERROR.DEPENDENCY_FAILURE,
            "multiplayerSeatFlow",
          );
        }
        failureStage = "HUMAN_SUBMIT";
        const humanSubmitStartedAt = performance.now();
        const seatProgression = await this.multiplayerProgression.submit(
          compiled,
          compilation.preparedWorkingProjection ?? null,
        );
        httpTimings.humanSubmitMs = elapsed(humanSubmitStartedAt);
        if (
          seatProgression.cursor.status === "AWAITING_DECISION"
          && this.postCommitTurnUpdates
        ) {
          const receipt = this.postCommitTurnUpdates.start({
            runId: context.access.runId,
            subjectId: context.access.subjectId,
            idempotencyKey: command.idempotencyKey,
            chapterRuntimeId: compiled.action.chapterRuntimeId,
            chapterId: compiled.action.chapterId,
            viewerSeatId: compiled.action.seatId,
            savedActionId: compiled.action.actionId,
            nextBeatId: seatProgression.cursor.beatId,
            nextDecisionPointId: seatProgression.cursor.decisionPointId,
            load: () => this.game.read({
              runId: context.access.runId,
              subjectId: context.access.subjectId,
            }),
          });
          responseStatus = "SUCCESS";
          responseOutcome = "ACTION_SAVED";
          responseStage = "RESPONSE_READY";
          return {
            schemaVersion: "pressure_chapter_submit_decision_http_response_v1" as const,
            idempotencyKey: command.idempotencyKey,
            projection: null,
            receipt,
          };
        }
        if (seatProgression.cursor.status === "CHAPTER_READY_FOR_CONVERGENCE") {
          failureStage = "CONVERGENCE";
          const convergenceStartedAt = performance.now();
          await this.multiplayerChapterConvergence.convergeIfReady({
            routeSnapshot: context.stored.snapshot,
            chapterRuntimeId: compiled.action.chapterRuntimeId,
            chapterId: compiled.action.chapterId,
            nowMs: requiredInteger(this.clock.nowMs(), "clock.nowMs", 0),
          });
          httpTimings.convergenceMs = elapsed(convergenceStartedAt);
        }
        failureStage = "PAGE_PROJECTION";
        const projectionStartedAt = performance.now();
        const projection = await this.game.read({
          runId: context.access.runId,
          subjectId: context.access.subjectId,
        });
        httpTimings.projectionMs = elapsed(projectionStartedAt);
        responseStatus = "SUCCESS";
        responseOutcome = seatProgression.cursor.status;
        responseStage = "RESPONSE_READY";
        return {
          schemaVersion: "pressure_chapter_submit_decision_http_response_v1",
          idempotencyKey: command.idempotencyKey,
          projection,
        };
      }
      failureStage = "HUMAN_SUBMIT";
      const humanSubmitStartedAt = performance.now();
      if (!this.convergence) {
        await this.actions.submitAction(compiled);
      }
      const humanSubmitMs = elapsed(humanSubmitStartedAt);
      httpTimings.humanSubmitMs = humanSubmitMs;
      const postSubmitNowMs = requiredInteger(this.clock.nowMs(), "clock.nowMs", 0);
      failureStage = "CONVERGENCE";
      const convergenceStartedAt = performance.now();
      const convergence = this.convergence
        ? await this.convergence.converge({
            trigger: "HTTP_POST_SUBMIT",
            runId: context.access.runId,
            expectedRouteHash: context.stored.snapshot.routeHash,
            source: {
              chapterRuntimeId: compiled.action.chapterRuntimeId,
              chapterId: compiled.action.chapterId,
              decisionPointId: compiled.action.decisionPointId,
            },
            nowMs: postSubmitNowMs,
            humanSubmitMs,
            humanAction: structuredClone(compiled),
            authoritySnapshot: compilation.snapshot
              ? structuredClone(compilation.snapshot.authority)
              : null,
          })
        : null;
      httpTimings.convergenceMs = elapsed(convergenceStartedAt);
      failureStage = "PAGE_PROJECTION";
      const projectionStartedAt = performance.now();
      const projection = this.gameReadMode !== "REPLAY"
        ? await this.gameRead.read({
            runId: context.access.runId,
            subjectId: context.access.subjectId,
          })
        : convergence?.committedAuthority
          && compilation.snapshot
          && this.game.readFromCommittedAuthority
          ? await this.game.readFromCommittedAuthority({
            runId: context.access.runId,
            subjectId: context.access.subjectId,
            roomId: compilation.snapshot.viewer.roomId,
            routeSnapshot: structuredClone(
              compilation.snapshot.authority.routeSnapshot,
            ),
            viewerSeatId: compilation.snapshot.viewer.seatId,
            chapter: structuredClone(convergence.committedAuthority.chapter),
            workingProjection: structuredClone(
              convergence.committedAuthority.workingProjection,
            ),
            chapterDescriptor: structuredClone(
              convergence.committedAuthority.chapterDescriptor,
            ),
            })
          : await this.game.read({
            runId: context.access.runId,
            subjectId: context.access.subjectId,
            });
      const projectionMs = elapsed(projectionStartedAt);
      httpTimings.projectionMs = projectionMs;
      if (this.convergence && convergence) {
        try {
          const recording = this.convergence.recordHttpCompletion(convergence, {
            projectionMs,
            endToEndMs: elapsed(endToEndStartedAt),
          });
          // Post-authority diagnostics may never keep the player response open.
          void Promise.resolve(recording).catch((error: unknown) => {
            logConvergenceDiagnosticsFailure(
              context.access.runId,
              convergence.batchId,
              error,
            );
          });
        } catch (error) {
          logConvergenceDiagnosticsFailure(
            context.access.runId,
            convergence.batchId,
            error,
          );
        }
      }
      httpTimings.totalMs = elapsed(endToEndStartedAt);
      logPressureDecisionTimingV1({
        path: "HTTP",
        runId: command.runId,
        chapterId: command.chapterId,
        decisionPointId: command.decisionPointId,
        outcome: convergence?.outcome ?? "LEGACY_SUBMIT",
        failureCode: null,
        timings: httpTimings,
      });
      responseStatus = "SUCCESS";
      responseOutcome = convergence?.outcome ?? "LEGACY_SUBMIT";
      responseStage = "RESPONSE_READY";
      return {
        schemaVersion: "pressure_chapter_submit_decision_http_response_v1",
        idempotencyKey: command.idempotencyKey,
        projection,
      };
      } catch (error) {
        httpTimings.totalMs = elapsed(endToEndStartedAt);
        responseStage = failureStage;
        responseFailureCode = pressureDecisionFailureCodeV1(error);
        logPressureDecisionFailureV1({
          path: "HTTP",
          traceId: requestLog.traceId,
          runId: requestLog.runId,
          chapterId: requestLog.chapterId,
          decisionPointId: requestLog.decisionPointId,
          stage: failureStage,
          timings: httpTimings,
          error,
        });
        throw error;
      } finally {
        httpTimings.totalMs = elapsed(endToEndStartedAt);
        logPressureDecisionBackendResponseV1({
          traceId: requestLog.traceId,
          runId: requestLog.runId,
          chapterId: requestLog.chapterId,
          decisionPointId: requestLog.decisionPointId,
          status: responseStatus,
          outcome: responseOutcome,
          stage: responseStage,
          failureCode: responseFailureCode,
          backendResponseReadyMs: httpTimings.totalMs,
          timings: httpTimings,
        });
      }
    });
  }

  submitChat(
    principalValue: PressureChapterHttpPrincipalV1,
    roomIdValue: string,
    bodyValue: unknown,
  ): Promise<PressureChapterChatHttpResponseV1> {
    return pressureHttpBoundary(async () => {
      const principal = parsePrincipal(principalValue);
      const roomId = requiredString(roomIdValue, "roomId");
      const context = await this.resolveContext(principal, roomId, "ACTION");
      const body = parseChatBody(bodyValue);
      const command = {
        routeSnapshot: context.stored.snapshot,
        subjectId: context.access.subjectId,
        senderSeatId: body.senderSeatId,
        chapterRuntimeId: body.chapterRuntimeId,
        chapterId: body.chapterId,
        visibility: body.visibility,
        targetSeatIds: body.targetSeatIds,
        text: body.text,
        idempotencyKey: body.idempotencyKey,
        requestFingerprint: body.requestFingerprint,
      };
      if (computePressureChatRequestFingerprint(command) !== body.requestFingerprint) {
        failPressureChapterHttp(ERROR.IDEMPOTENCY_CONFLICT, "body.requestFingerprint");
      }
      const submitted = await this.chat.submit(command);
      return {
        schemaVersion: "pressure_chapter_chat_http_response_v1",
        status: submitted.status,
        message: structuredClone(submitted.message),
      };
    });
  }

  replay(
    principalValue: PressureChapterHttpPrincipalV1,
    roomIdValue: string,
    bodyValue: unknown,
  ) {
    return pressureHttpBoundary(async () => {
      const principal = parsePrincipal(principalValue);
      const roomId = requiredString(roomIdValue, "roomId");
      const context = await this.resolveContext(principal, roomId, "REPLAY");
      let command;
      try {
        command = validatePressureReplayCommandV1(bodyValue);
      } catch {
        failPressureChapterHttp(ERROR.INPUT_INVALID, "body");
      }
      if (command.sourceRunId !== context.access.runId) {
        failPressureChapterHttp(ERROR.ROUTE_MISMATCH, "body.sourceRunId");
      }
      return this.replayPort.replay(context.access.viewerId, command);
    });
  }

  /**
   * Existing main/maneuver/reaction endpoints call this before legacy logic.
   * A Pressure route is rejected instead of translated into a second action model.
   */
  rejectLegacySlotEndpoint(
    principalValue: PressureChapterHttpPrincipalV1,
    roomIdValue: string,
    endpoint: LegacyPressureSlotEndpointV1,
  ): Promise<never> {
    return pressureHttpBoundary(async () => {
      parseLegacyEndpoint(endpoint);
      const principal = parsePrincipal(principalValue);
      const roomId = requiredString(roomIdValue, "roomId");
      await this.resolveContext(principal, roomId, "ACTION");
      failPressureChapterHttp(
        ERROR.LEGACY_SLOT_ENDPOINT_REJECTED,
        "legacySlot." + endpoint,
      );
    });
  }

  private async resolveContext(
    principal: PressureChapterHttpPrincipalV1,
    roomId: string,
    operation: HttpOperation,
  ) {
    const access = await this.resolveAccess(principal, roomId);
    const dispatch = await this.resolveDispatch(access.runId, operation);
    const stored = assertStoredRunRouteRecord(
      await this.routes.readStoredRoute(access.runId),
    );
    try {
      assertSangtianPressureRouteV1(dispatch.route);
    } catch {
      failPressureChapterHttp(ERROR.ROUTE_MISMATCH, "storedRoute.route");
    }
    if (
      dispatch.schemaVersion !== "pressure_stored_route_dispatch_v1" ||
      dispatch.operation !== operation ||
      dispatch.runId !== access.runId ||
      dispatch.runId !== stored.runId ||
      dispatch.routeKey !== stored.routeKey ||
      dispatch.routeHash !== stored.snapshot.routeHash ||
      dispatch.handlerKey !== "pressure_chapter_v1" ||
      dispatch.resultAdapterKey !== "SangtianPressureResultV1Adapter" ||
      dispatch.presentationSchemaVersion !== "sangtian_pressure_result_v1" ||
      dispatch.rendererKey !== "sangtian_pressure_endgame_v1"
    ) {
      failPressureChapterHttp(ERROR.ROUTE_MISMATCH, "storedRoute.dispatch");
    }
    return { access, stored };
  }

  private async resolveAccess(
    principal: PressureChapterHttpPrincipalV1,
    roomId: string,
  ): Promise<PressureChapterHttpAccessV1> {
    const accessValue = await this.access.authorize({
      roomId,
      subjectId: principal.subjectId,
      viewerId: principal.viewerId,
    });
    if (accessValue === null) {
      failPressureChapterHttp(ERROR.ACCESS_DENIED, "roomId");
    }
    return parseAccess(accessValue, roomId, principal);
  }

  private resolveDispatch(runId: string, operation: HttpOperation) {
    switch (operation) {
      case "GAME":
        return this.routes.resolveGame(runId);
      case "ACTION":
        return this.routes.resolveAction(runId);
      case "RESULT":
        return this.routes.resolveResult(runId);
      case "REPLAY":
        return this.routes.resolveReplay(runId);
    }
  }
}

function assertPublicDecisionScope(
  command: PressureChapterSubmitDecisionCommandV1,
  access: PressureChapterHttpAccessV1,
  stored: StoredRunRouteRecordV1,
): void {
  if (
    command.runId !== access.runId
    || command.runId !== stored.runId
    || command.routeHash !== stored.snapshot.routeHash
    || command.chapterId === "P0"
    || !stored.snapshot.seatIds.includes(command.seatId)
    || !stored.controlTopology.seatControls.some((seat) => seat.seatId === command.seatId)
  ) {
    failPressureChapterHttp(ERROR.ROUTE_MISMATCH, "body.scope");
  }
}

function validateCompiledDecisionCommand(
  raw: Awaited<ReturnType<PressureChapterHttpDecisionCompilerPort["compile"]>>,
  access: PressureChapterHttpAccessV1,
  stored: StoredRunRouteRecordV1,
  publicCommand: PressureChapterSubmitDecisionCommandV1,
  nowMs: number,
) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    failPressureChapterHttp(ERROR.DEPENDENCY_FAILURE, "decisionCompiler");
  }
  const keys = Object.keys(raw).sort();
  const expectedKeys = [
    "action",
    "inputFingerprint",
    "intent",
    "nowMs",
    "routeSnapshot",
    "subjectId",
  ].sort();
  if (keys.length !== expectedKeys.length || keys.some((key, index) => key !== expectedKeys[index])) {
    failPressureChapterHttp(ERROR.DEPENDENCY_FAILURE, "decisionCompiler");
  }
  const action = validateDecisionActionV1(raw.action);
  const intent = canonicalizeWorkingActionIntentV1(raw.intent);
  const expectedInputFingerprint = computeFormalInteractionInputFingerprint({
    routeSnapshot: stored.snapshot,
    action,
    intent,
  });
  if (
    raw.subjectId !== access.subjectId
    || raw.nowMs !== nowMs
    || sha256Canonical(raw.routeSnapshot) !== sha256Canonical(stored.snapshot)
    || action.runId !== publicCommand.runId
    || action.chapterRuntimeId !== publicCommand.chapterRuntimeId
    || action.chapterId !== publicCommand.chapterId
    || action.decisionPointId !== publicCommand.decisionPointId
    || action.seatId !== publicCommand.seatId
    || action.controlEpoch !== publicCommand.controlEpoch
    || action.expectedWorkingRevision !== publicCommand.expectedWorkingRevision
    || action.idempotencyKey !== publicCommand.idempotencyKey
    || raw.inputFingerprint !== expectedInputFingerprint
  ) {
    failPressureChapterHttp(ERROR.ROUTE_MISMATCH, "decisionCompiler.scope");
  }
  return {
    routeSnapshot: structuredClone(stored.snapshot),
    subjectId: access.subjectId,
    action,
    intent,
    inputFingerprint: expectedInputFingerprint,
    nowMs,
  };
}

function logConvergenceDiagnosticsFailure(
  runId: string,
  batchId: string,
  error: unknown,
): void {
  if (process.env.PRESSURE_CHAPTER_DIAGNOSTIC_ERRORS !== "1") return;
  console.error("Pressure convergence diagnostics failed", {
    runId,
    batchId,
    message: error instanceof Error ? error.message : "UNKNOWN",
  });
}

function decisionRequestLogIdentity(roomIdValue: string, bodyValue: unknown): {
  traceId: string;
  runId: string;
  chapterId: string;
  decisionPointId: string;
} {
  const body = bodyValue && typeof bodyValue === "object" && !Array.isArray(bodyValue)
    ? bodyValue as Record<string, unknown>
    : {};
  const roomId = typeof roomIdValue === "string" ? roomIdValue : "UNKNOWN";
  const runId = typeof body.runId === "string" ? body.runId : roomId;
  const chapterId = typeof body.chapterId === "string" ? body.chapterId : "UNKNOWN";
  const decisionPointId = typeof body.decisionPointId === "string"
    ? body.decisionPointId
    : "UNKNOWN";
  const idempotencyKey = typeof body.idempotencyKey === "string"
    ? body.idempotencyKey
    : "UNKNOWN";
  return {
    traceId: sha256Canonical({ roomId, runId, chapterId, decisionPointId, idempotencyKey })
      .slice(0, 16),
    runId,
    chapterId,
    decisionPointId,
  };
}

function elapsed(startedAt: number): number {
  return Math.max(0, performance.now() - startedAt);
}
