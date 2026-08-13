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
import type { PressureSql7FirstSubmitServiceV1 } from "../sql7-fast-path/service";
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
  ) {}

  getGame(
    principalValue: PressureChapterHttpPrincipalV1,
    roomIdValue: string,
    queryValue: PressureChapterGameHttpQueryV1 = {},
  ) {
    return pressureHttpBoundary(async () => {
      const principal = parsePrincipal(principalValue);
      const roomId = requiredString(roomIdValue, "roomId");
      const query = parseGameQuery(queryValue);
      const context = await this.resolveContext(principal, roomId, "GAME");
      return this.game.read({
        runId: context.access.runId,
        subjectId: context.access.subjectId,
        ...query,
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
      const principal = parsePrincipal(principalValue);
      const roomId = requiredString(roomIdValue, "roomId");
      const command = parseSubmitDecisionCommand(bodyValue);
      if (this.sql7 && command.chapterId === "N1") {
        const sql7NowMs = requiredInteger(this.clock.nowMs(), "clock.nowMs", 0);
        const sql7 = await this.sql7.submit({
          principal: structuredClone(principal),
          roomId,
          command: structuredClone(command),
          nowMs: sql7NowMs,
        });
        if (sql7.status === "COMMITTED") return sql7.response;
        if (sql7.status === "REPLAYED") {
          const replayContext = await this.resolveContext(principal, roomId, "ACTION");
          assertPublicDecisionScope(command, replayContext.access, replayContext.stored);
          const projection = await this.game.read({
            runId: replayContext.access.runId,
            subjectId: replayContext.access.subjectId,
          });
          return {
            schemaVersion: "pressure_chapter_submit_decision_http_response_v1",
            idempotencyKey: sql7.idempotencyKey,
            projection,
          };
        }
      }
      const context = await this.resolveContext(principal, roomId, "ACTION");
      assertPublicDecisionScope(command, context.access, context.stored);
      const nowMs = requiredInteger(this.clock.nowMs(), "clock.nowMs", 0);
      const compilerInput = {
        access: structuredClone(context.access),
        storedRoute: structuredClone(context.stored),
        command: structuredClone(command),
        nowMs,
      };
      const compilation = this.decisionCompiler.compileWithSnapshot
        ? await this.decisionCompiler.compileWithSnapshot(compilerInput)
        : {
            command: await this.decisionCompiler.compile(compilerInput),
            snapshot: null,
          };
      const compiled = validateCompiledDecisionCommand(
        compilation.command,
        context.access,
        context.stored,
        command,
        nowMs,
      );
      const humanSubmitStartedAt = performance.now();
      if (!this.convergence) {
        await this.actions.submitAction(compiled);
      }
      const humanSubmitMs = elapsed(humanSubmitStartedAt);
      const postSubmitNowMs = requiredInteger(this.clock.nowMs(), "clock.nowMs", 0);
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
      const projectionStartedAt = performance.now();
      const projection = convergence?.committedAuthority
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
      return {
        schemaVersion: "pressure_chapter_submit_decision_http_response_v1",
        idempotencyKey: command.idempotencyKey,
        projection,
      };
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
    const accessValue = await this.access.authorize({
      roomId,
      subjectId: principal.subjectId,
      viewerId: principal.viewerId,
    });
    if (accessValue === null) {
      failPressureChapterHttp(ERROR.ACCESS_DENIED, "roomId");
    }
    const access = parseAccess(accessValue, roomId, principal);
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

function elapsed(startedAt: number): number {
  return Math.max(0, performance.now() - startedAt);
}
