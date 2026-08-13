import assert from "node:assert/strict";
import test from "node:test";
import {
  PRESSURE_CHAPTER_ROUTE_V1,
  PRESSURE_CHAPTER_SEAT_IDS_V1,
  computeDecisionActionRequestFingerprint,
  computePressureReplayRequestFingerprint,
  sha256Canonical,
  withRunRouteHash,
  type PressureChapterSubmitDecisionCommandV1,
  type ReplayCreationReceiptV1,
  type SangtianPressureResultEnvelopeV1,
} from "@ai-story/shared";
import type { PressureChapterGameProjectionV1 } from "../game-projection";
import { computePressureChatRequestFingerprint } from "../interaction/chat.service";
import { computeFormalInteractionInputFingerprint } from "../interaction/formal-interaction.service";
import type {
  PressureChatMessageV1,
  SubmitPressureChatCommandV1,
} from "../interaction/contracts";
import type { SubmitOrchestratedActionCommandV1 } from "../orchestrator/contracts";
import type {
  StoredRunRouteDispatchV1,
  StoredRunRouteRecordV1,
} from "../run-router";
import {
  PRESSURE_CHAPTER_HTTP_ERROR_CODES,
  PressureChapterHttpException,
  pressureHttpBoundary,
} from "./errors";
import { PressureChapterHttpFacade } from "./pressure-chapter-http.facade";
import type {
  PressureChapterHttpAccessPort,
  PressureChapterHttpActionPort,
  PressureChapterHttpChatPort,
  PressureChapterHttpDecisionCompilerPort,
  PressureChapterHttpDeliveryPort,
  PressureChapterHttpGamePort,
  PressureChapterHttpReplayPort,
  PressureChapterHttpResponseAcknowledgerPort,
  PressureChapterHttpResultPort,
  PressureChapterHttpRoutePort,
} from "./contracts";

const RUN_ID = "run-pressure-http-1";
const ROOM_ID = "room-pressure-http-1";
const USER_ID = "user-pressure-http-1";
const SEAT_ID = "cabinet_finance" as const;

test("delivery command uses authenticated membership scope and returns server readback", async () => {
  const harness = createHarness();
  const response = await harness.facade.markFeedDelivery(
    harness.principal,
    ROOM_ID,
    {
      schemaVersion: "pressure_chapter_game_command_v1",
      commandType: "DELIVERY_MARK",
      eventId: "modal-event-1",
      projectionVersion: 7,
      operation: "MODAL_SHOWN",
      idempotencyKey: "modal-shown-1",
    },
  );
  assert.equal(response.idempotencyKey, "modal-shown-1");
  assert.equal(response.projection.runId, RUN_ID);
  assert.deepEqual(harness.deliveryInputs, [{
    roomId: ROOM_ID,
    runId: RUN_ID,
    viewerSeatId: SEAT_ID,
    command: {
      schemaVersion: "pressure_chapter_game_command_v1",
      commandType: "DELIVERY_MARK",
      eventId: "modal-event-1",
      projectionVersion: 7,
      operation: "MODAL_SHOWN",
      idempotencyKey: "modal-shown-1",
    },
    occurredAt: "2023-11-14T22:13:20.000Z",
  }]);
  assert.equal(harness.gameReads, 2, "eligibility read plus persisted readback");
});

test("delivery command rejects client scope, unsupported operations and unknown fields", async () => {
  for (const extra of [
    { roomId: ROOM_ID },
    { runId: RUN_ID },
    { viewerSeatId: SEAT_ID },
    { operation: "ACKNOWLEDGED" },
    { operation: "RESOLVED" },
    { projectionVersion: 0 },
  ]) {
    const harness = createHarness();
    await expectHttpCode(
      () => harness.facade.markFeedDelivery(harness.principal, ROOM_ID, {
        schemaVersion: "pressure_chapter_game_command_v1",
        commandType: "DELIVERY_MARK",
        eventId: "modal-event-1",
        projectionVersion: 7,
        operation: "MODAL_SHOWN",
        idempotencyKey: "modal-shown-1",
        ...extra,
      }),
      PRESSURE_CHAPTER_HTTP_ERROR_CODES.INPUT_INVALID,
      400,
    );
    assert.equal(harness.deliveryInputs.length, 0);
  }
});

test("GET game and result authorize first, honor frozen route and perform zero command writes", async () => {
  const harness = createHarness();
  const game = await harness.facade.getGame(harness.principal, ROOM_ID);
  const result = await harness.facade.getResult(harness.principal, ROOM_ID);

  assert.equal(game.runId, RUN_ID);
  assert.equal(result.runId, RUN_ID);
  assert.deepEqual(harness.calls.slice(0, 4), [
    "access",
    "route:GAME",
    "stored-route",
    "game-read",
  ]);
  assert.equal(harness.actionWrites, 0);
  assert.equal(harness.chatWrites, 0);
  assert.equal(harness.replayWrites, 0);
  assert.equal(harness.resultReads, 1);
});

test("unauthorized viewer stops before stored route or game/result reads", async () => {
  const harness = createHarness({ deny: true });
  await expectHttpCode(
    () => harness.facade.getGame(harness.principal, ROOM_ID),
    PRESSURE_CHAPTER_HTTP_ERROR_CODES.ACCESS_DENIED,
    403,
  );
  assert.deepEqual(harness.calls, ["access"]);
  assert.equal(harness.gameReads, 0);
  assert.equal(harness.resultReads, 0);
});

test("invalid or changed stored route fails closed before projection", async () => {
  const harness = createHarness({ dispatchRouteHash: sha256Canonical("wrong-route") });
  await expectHttpCode(
    () => harness.facade.getGame(harness.principal, ROOM_ID),
    PRESSURE_CHAPTER_HTTP_ERROR_CODES.ROUTE_MISMATCH,
    409,
  );
  assert.equal(harness.gameReads, 0);
});

test("public decision is server-compiled and same-key replay writes once", async () => {
  const harness = createHarness();
  const body = decisionCommand(harness.stored.snapshot.routeHash);
  const first = await harness.facade.submitDecision(
    harness.principal,
    ROOM_ID,
    body,
  );
  const second = await harness.facade.submitDecision(
    harness.principal,
    ROOM_ID,
    structuredClone(body),
  );

  assert.deepEqual(Object.keys(first).sort(), ["idempotencyKey", "projection", "schemaVersion"]);
  assert.equal(first.schemaVersion, "pressure_chapter_submit_decision_http_response_v1");
  assert.equal(first.idempotencyKey, body.idempotencyKey);
  assert.equal(first.projection.runId, RUN_ID);
  assert.equal(second.schemaVersion, "pressure_chapter_submit_decision_http_response_v1");
  assert.equal(second.idempotencyKey, body.idempotencyKey);
  assert.equal(second.projection.runId, RUN_ID);
  assert.equal(harness.actionWrites, 1);
  assert.equal(harness.actionCommands.length, 2);
  assert.equal(harness.compilerInputs.length, 2);
  assert.deepEqual(harness.compilerInputs[0]?.command, body);
  assert.equal(harness.compilerInputs[0]?.access.subjectId, USER_ID);
  assert.equal(harness.compilerInputs[0]?.storedRoute.recordHash, harness.stored.recordHash);
  assert.equal(harness.compilerInputs[0]?.nowMs, 1_700_000_000_000);
  const firstCommand = harness.actionCommands[0]!;
  const secondCommand = harness.actionCommands[1]!;
  assert.equal(firstCommand.subjectId, USER_ID);
  assert.equal(firstCommand.routeSnapshot.runId, RUN_ID);
  assert.equal(firstCommand.routeSnapshot.routeHash, harness.stored.snapshot.routeHash);
  assert.equal(firstCommand.action.actionId, secondCommand.action.actionId);
  assert.equal(firstCommand.action.sealedHash, secondCommand.action.sealedHash);
  assert.equal(firstCommand.inputFingerprint, secondCommand.inputFingerprint);
  assert.equal(firstCommand.action.actionOrdinal, 7, "ordinal is server-generated");
  assert.equal(firstCommand.action.actionRevision, 3, "revision is server-generated");
  assert.equal(firstCommand.action.actionType, "DECIDE", "actionType is server-generated");
  assert.deepEqual(firstCommand.intent, {
    visibility: "PRIVATE",
    targetSeatIds: [],
    evidenceRefs: [],
    resourceReservations: [],
    commitmentMutations: [],
    knowledgeGrants: [],
    seatArcProgress: [],
  });
});

test("changed public input conflicts and client authority or intent fields fail closed", async () => {
  const harness = createHarness();
  const first = decisionCommand(harness.stored.snapshot.routeHash);
  await harness.facade.submitDecision(harness.principal, ROOM_ID, first);

  const changed = {
    ...first,
    optionCode: "B",
  };
  await expectHttpCode(
    () => harness.facade.submitDecision(harness.principal, ROOM_ID, changed),
    PRESSURE_CHAPTER_HTTP_ERROR_CODES.IDEMPOTENCY_CONFLICT,
    409,
  );
  assert.equal(harness.actionWrites, 1);

  const forbiddenClientAuthority = [
    { actionOrdinal: 999 },
    { actionRevision: 999 },
    { actionType: "INJECTED_ACTION" },
    { payload: { grantAllResources: true } },
    {
      intent: {
        visibility: "PUBLIC",
        adminOverride: true,
      },
    },
    { requestFingerprint: sha256Canonical("client-fingerprint") },
    { sourceEventId: " " },
    { sourceEventId: 42 },
    { responseActionCode: " " },
    { responseActionCode: 42 },
  ];
  for (const injected of forbiddenClientAuthority) {
    await expectHttpCode(
      () => harness.facade.submitDecision(
        harness.principal,
        ROOM_ID,
        { ...first, ...injected },
      ),
      PRESSURE_CHAPTER_HTTP_ERROR_CODES.INPUT_INVALID,
      400,
    );
  }
  const { sourceEventId: _omittedSourceEventId, ...missingSourceEventId } = first;
  await expectHttpCode(
    () => harness.facade.submitDecision(harness.principal, ROOM_ID, missingSourceEventId),
    PRESSURE_CHAPTER_HTTP_ERROR_CODES.INPUT_INVALID,
    400,
  );
  const { responseActionCode: _omittedResponseActionCode, ...missingResponseActionCode } = first;
  await expectHttpCode(
    () => harness.facade.submitDecision(harness.principal, ROOM_ID, missingResponseActionCode),
    PRESSURE_CHAPTER_HTTP_ERROR_CODES.INPUT_INVALID,
    400,
  );
  assert.equal(harness.compilerInputs.length, 2, "invalid bodies never reach the compiler");
});

test("response binding is transported through the existing endpoint with replay and collision semantics", async () => {
  const harness = createHarness();
  const routeHash = harness.stored.snapshot.routeHash;
  const body = {
    ...decisionCommand(routeHash),
    idempotencyKey: "response-http-key-1",
    sourceEventId: "safe-projected-event-1",
    responseActionCode: "SIGNED_RESPONSE_A",
  };
  await harness.facade.submitDecision(harness.principal, ROOM_ID, body);
  await harness.facade.submitDecision(harness.principal, ROOM_ID, structuredClone(body));
  assert.equal(harness.actionWrites, 1);
  assert.equal(harness.acknowledgementInputs.length, 2);
  assert.deepEqual(harness.acknowledgementInputs[0], {
    roomId: ROOM_ID,
    runId: RUN_ID,
    viewerSeatId: SEAT_ID,
    sourceEventId: "safe-projected-event-1",
    responseActionCode: "SIGNED_RESPONSE_A",
    occurredAt: "2023-11-14T22:13:20.000Z",
  });
  assert.ok(
    harness.calls.indexOf("response-acknowledge") > harness.calls.indexOf("action-write"),
    "delivery acknowledgement is a post-success recovery receipt",
  );
  assert.equal(harness.compilerInputs[0]?.command.sourceEventId, "safe-projected-event-1");
  assert.equal(harness.compilerInputs[0]?.command.responseActionCode, "SIGNED_RESPONSE_A");

  await expectHttpCode(
    () => harness.facade.submitDecision(harness.principal, ROOM_ID, {
      ...body,
      responseActionCode: "SIGNED_RESPONSE_B",
    }),
    PRESSURE_CHAPTER_HTTP_ERROR_CODES.IDEMPOTENCY_CONFLICT,
    409,
  );
  assert.equal(harness.actionWrites, 1);
});

test("post-success ACK fallback recovers on same-key replay and failed actions write zero ACK", async () => {
  const routeHash = storedRoute().snapshot.routeHash;
  const body = {
    ...decisionCommand(routeHash),
    idempotencyKey: "response-http-recovery-1",
    sourceEventId: "safe-projected-event-recovery",
    responseActionCode: "SIGNED_RESPONSE_A",
  };
  const recoverable = createHarness({ acknowledgementFailures: 1 });
  await expectHttpCode(
    () => recoverable.facade.submitDecision(recoverable.principal, ROOM_ID, body),
    PRESSURE_CHAPTER_HTTP_ERROR_CODES.DEPENDENCY_FAILURE,
    500,
  );
  assert.equal(recoverable.actionWrites, 1, "authority action committed before fallback outage");
  assert.equal(recoverable.acknowledgementInputs.length, 1);
  await recoverable.facade.submitDecision(recoverable.principal, ROOM_ID, structuredClone(body));
  assert.equal(recoverable.actionWrites, 1, "same-key recovery replays authority exactly once");
  assert.equal(recoverable.acknowledgementInputs.length, 2, "replay retries the idempotent ACK receipt");

  const rejected = createHarness({ actionErrorCode: "PRESSURE_INTERACTION_APPEND_CONFLICT" });
  await expectHttpCode(
    () => rejected.facade.submitDecision(rejected.principal, ROOM_ID, body),
    PRESSURE_CHAPTER_HTTP_ERROR_CODES.COMMAND_REJECTED,
    422,
  );
  assert.equal(rejected.actionWrites, 0);
  assert.equal(rejected.acknowledgementInputs.length, 0, "failed authority writes must emit zero ACK");
});

test("run route chapter and compiler seat scope mismatches fail closed", async () => {
  const routeHash = storedRoute().snapshot.routeHash;
  for (const command of [
    { ...decisionCommand(routeHash), runId: "other-run" },
    { ...decisionCommand(routeHash), routeHash: sha256Canonical("other-route") },
    { ...decisionCommand(routeHash), chapterId: "P0" },
    { ...decisionCommand(routeHash), seatId: "foreign-seat" },
  ]) {
    const harness = createHarness();
    await assert.rejects(
      () => harness.facade.submitDecision(harness.principal, ROOM_ID, command),
      (error: unknown) => {
        assert.ok(error instanceof PressureChapterHttpException);
        assert.ok(new Set<string>([
          PRESSURE_CHAPTER_HTTP_ERROR_CODES.INPUT_INVALID,
          PRESSURE_CHAPTER_HTTP_ERROR_CODES.ROUTE_MISMATCH,
        ]).has(error.code));
        return true;
      },
    );
    assert.equal(harness.actionWrites, 0);
    assert.equal(harness.compilerInputs.length, 0);
  }

  const harness = createHarness({ compilerSeatId: "qingliu_law" });
  await expectHttpCode(
    () => harness.facade.submitDecision(
      harness.principal,
      ROOM_ID,
      decisionCommand(harness.stored.snapshot.routeHash),
    ),
    PRESSURE_CHAPTER_HTTP_ERROR_CODES.ROUTE_MISMATCH,
    409,
  );
  assert.equal(harness.actionWrites, 0);
});

test("compiler and seat-control fence mismatches reject before action writes", async () => {
  for (const compilerErrorCode of [
    "INTEGRATION_DECISION_COMMAND_MISMATCH",
    "SEAT_CONTROL_FENCE_REJECTED",
  ]) {
    const harness = createHarness({ compilerErrorCode });
    await expectHttpCode(
      () => harness.facade.submitDecision(
        harness.principal,
        ROOM_ID,
        decisionCommand(harness.stored.snapshot.routeHash),
      ),
      PRESSURE_CHAPTER_HTTP_ERROR_CODES.COMMAND_REJECTED,
      422,
    );
    assert.equal(harness.compilerInputs.length, 1);
    assert.equal(harness.actionWrites, 0);
  }
});

test("chat derives subject and frozen route on server and preserves strict fingerprint", async () => {
  const harness = createHarness();
  const route = harness.stored.snapshot;
  const commandBase = {
    routeSnapshot: route,
    senderSeatId: SEAT_ID,
    chapterRuntimeId: "chapter-runtime-n1",
    chapterId: "N1" as const,
    visibility: "PUBLIC" as const,
    targetSeatIds: [],
    text: "共议河工。",
    idempotencyKey: "chat-key-1",
  };
  const requestFingerprint = computePressureChatRequestFingerprint(commandBase);
  const response = await harness.facade.submitChat(
    harness.principal,
    ROOM_ID,
    {
      schemaVersion: "pressure_chapter_chat_http_v1",
      chapterRuntimeId: commandBase.chapterRuntimeId,
      chapterId: commandBase.chapterId,
      senderSeatId: commandBase.senderSeatId,
      visibility: commandBase.visibility,
      targetSeatIds: commandBase.targetSeatIds,
      text: commandBase.text,
      idempotencyKey: commandBase.idempotencyKey,
      requestFingerprint,
    },
  );
  assert.equal(response.status, "APPENDED");
  assert.equal(harness.chatCommands[0]?.subjectId, USER_ID);
  assert.equal(harness.chatCommands[0]?.routeSnapshot.routeHash, route.routeHash);
});

test("legacy slot endpoints are rejected for Pressure without invoking old action authority", async () => {
  const harness = createHarness();
  await expectHttpCode(
    () => harness.facade.rejectLegacySlotEndpoint(
      harness.principal,
      ROOM_ID,
      "MANEUVER",
    ),
    PRESSURE_CHAPTER_HTTP_ERROR_CODES.LEGACY_SLOT_ENDPOINT_REJECTED,
    409,
  );
  assert.equal(harness.actionWrites, 0);
});

test("replay uses the existing route, viewer identity and exact shared command contract", async () => {
  const harness = createHarness();
  const withoutFingerprint = {
    schemaVersion: "pressure_replay_command_v1" as const,
    sourceRunId: RUN_ID,
    actionId: "replay-same",
    actionFingerprint: sha256Canonical("replay-action"),
    requestedRoleId: null,
    idempotencyKey: "replay-http-key-1",
  };
  const command = {
    ...withoutFingerprint,
    requestFingerprint:
      computePressureReplayRequestFingerprint(withoutFingerprint),
  };
  const receipt = await harness.facade.replay(
    harness.principal,
    ROOM_ID,
    command,
  );
  assert.equal(receipt.sourceRunId, RUN_ID);
  assert.equal(harness.replayWrites, 1);
  assert.equal(harness.replayViewerIds[0], USER_ID);
  assert.deepEqual(harness.replayCommands[0], command);

  await expectHttpCode(
    () => harness.facade.replay(
      harness.principal,
      ROOM_ID,
      { ...command, sourceRunId: "other-run" },
    ),
    PRESSURE_CHAPTER_HTTP_ERROR_CODES.INPUT_INVALID,
    400,
  );
  const otherSourceBase = {
    ...withoutFingerprint,
    sourceRunId: "other-run",
  };
  await expectHttpCode(
    () => harness.facade.replay(
      harness.principal,
      ROOM_ID,
      {
        ...otherSourceBase,
        requestFingerprint:
          computePressureReplayRequestFingerprint(otherSourceBase),
      },
    ),
    PRESSURE_CHAPTER_HTTP_ERROR_CODES.ROUTE_MISMATCH,
    409,
  );
});

test("dependency detail values are never reflected as public HTTP paths", async () => {
  const internalSeatOrKey = "secret-seat-or-idempotency-key";
  await assert.rejects(
    () => pressureHttpBoundary(async () => {
      throw {
        code: "PRESSURE_INTERACTION_TARGET_FORBIDDEN",
        detail: internalSeatOrKey,
      };
    }),
    (error: unknown) => {
      assert.ok(error instanceof PressureChapterHttpException);
      assert.equal(error.code, PRESSURE_CHAPTER_HTTP_ERROR_CODES.COMMAND_REJECTED);
      assert.equal(error.path, "pressureChapter");
      assert.doesNotMatch(JSON.stringify(error.getResponse()), /secret-seat/);
      return true;
    },
  );
});

function createHarness(options: {
  deny?: boolean;
  dispatchRouteHash?: string;
  compilerSeatId?: typeof SEAT_ID | "qingliu_law";
  compilerErrorCode?: string;
  actionErrorCode?: string;
  acknowledgementFailures?: number;
} = {}) {
  const calls: string[] = [];
  const stored = storedRoute();
  let actionWrites = 0;
  let chatWrites = 0;
  let replayWrites = 0;
  let gameReads = 0;
  let resultReads = 0;
  let acknowledgementFailures = options.acknowledgementFailures ?? 0;
  const actionCommands: SubmitOrchestratedActionCommandV1[] = [];
  const compilerInputs: Parameters<PressureChapterHttpDecisionCompilerPort["compile"]>[0][] = [];
  const acknowledgementInputs: Parameters<PressureChapterHttpResponseAcknowledgerPort["acknowledgeCurrent"]>[0][] = [];
  const deliveryInputs: Parameters<PressureChapterHttpDeliveryPort["mark"]>[0][] = [];
  const chatCommands: SubmitPressureChatCommandV1[] = [];
  const replayCommands: unknown[] = [];
  const replayViewerIds: string[] = [];
  const actionByKey = new Map<string, string>();

  const access: PressureChapterHttpAccessPort = {
    async authorize() {
      calls.push("access");
      if (options.deny) return null;
      return {
        schemaVersion: "pressure_chapter_http_access_v1",
        roomId: ROOM_ID,
        runId: RUN_ID,
        subjectId: USER_ID,
        viewerId: USER_ID,
      };
    },
  };
  const routes: PressureChapterHttpRoutePort = {
    async readStoredRoute() {
      calls.push("stored-route");
      return structuredClone(stored);
    },
    resolveGame: () => resolve("GAME"),
    resolveAction: () => resolve("ACTION"),
    resolveResult: () => resolve("RESULT"),
    resolveReplay: () => resolve("REPLAY"),
  };
  function resolve(operation: StoredRunRouteDispatchV1["operation"]) {
    calls.push("route:" + operation);
    const dispatch: StoredRunRouteDispatchV1 = {
      schemaVersion: "pressure_stored_route_dispatch_v1",
      operation,
      runId: RUN_ID,
      routeKey: stored.routeKey,
      routeHash: options.dispatchRouteHash ?? stored.snapshot.routeHash,
      route: { ...stored.snapshot.route },
      handlerKey: "pressure_chapter_v1",
      resultAdapterKey: "SangtianPressureResultV1Adapter",
      presentationSchemaVersion: "sangtian_pressure_result_v1",
      rendererKey: "sangtian_pressure_endgame_v1",
    };
    return Promise.resolve(dispatch);
  }
  const game: PressureChapterHttpGamePort = {
    async read() {
      calls.push("game-read");
      gameReads += 1;
      return {
        schemaVersion: "pressure_chapter_game_projection_v1",
        runId: RUN_ID,
        roomId: ROOM_ID,
        viewer: { seatId: SEAT_ID },
      } as unknown as PressureChapterGameProjectionV1;
    },
  };
  const responseAcknowledger: PressureChapterHttpResponseAcknowledgerPort = {
    async acknowledgeCurrent(input) {
      calls.push("response-acknowledge");
      acknowledgementInputs.push(structuredClone(input));
      if (acknowledgementFailures > 0) {
        acknowledgementFailures -= 1;
        throw new Error("SIMULATED_ACK_OUTAGE");
      }
      return true;
    },
  };
  const delivery: PressureChapterHttpDeliveryPort = {
    async mark(input) { deliveryInputs.push(structuredClone(input)); },
  };
  const decisionCompiler: PressureChapterHttpDecisionCompilerPort = {
    async compile(input) {
      calls.push("decision-compile");
      compilerInputs.push(structuredClone(input));
      if (options.compilerErrorCode) {
        throw {
          code: options.compilerErrorCode,
          detail: "private-submission-fence",
        };
      }
      return compiledDecisionCommand(
        input,
        options.compilerSeatId ?? input.command.seatId,
      );
    },
  };
  const actions: PressureChapterHttpActionPort = {
    async submitAction(command) {
      calls.push("action-write");
      actionCommands.push(structuredClone(command));
      if (options.actionErrorCode) {
        throw { code: options.actionErrorCode };
      }
      const prior = actionByKey.get(command.action.idempotencyKey);
      if (prior === undefined) {
        actionByKey.set(command.action.idempotencyKey, command.inputFingerprint);
        actionWrites += 1;
      } else if (prior !== command.inputFingerprint) {
        throw {
          code: "PRESSURE_INTERACTION_IDEMPOTENCY_MISMATCH",
          detail: command.action.idempotencyKey,
        };
      }
      return {};
    },
  };
  const chat: PressureChapterHttpChatPort = {
    async submit(command) {
      calls.push("chat-write");
      chatWrites += 1;
      chatCommands.push(structuredClone(command));
      const message = chatMessage(command);
      return { status: "APPENDED", message };
    },
  };
  const result: PressureChapterHttpResultPort = {
    async getResult() {
      calls.push("result-read");
      resultReads += 1;
      return {
        schemaVersion: "sangtian_pressure_result_envelope_v1",
        runId: RUN_ID,
      } as unknown as SangtianPressureResultEnvelopeV1;
    },
  };
  const replay: PressureChapterHttpReplayPort = {
    async replay(viewerId, command) {
      calls.push("replay-write");
      replayWrites += 1;
      replayViewerIds.push(viewerId);
      replayCommands.push(structuredClone(command));
      return {
        schemaVersion: "replay_creation_receipt_v1",
        sourceRunId: RUN_ID,
        actionId: "replay-same",
        launchKind: "CREATE_RUN",
        createdRunId: "new-run",
        createdLobbyId: null,
        navigationTarget: null,
        frozenTargetRouteHash: stored.snapshot.routeHash,
        receiptHash: sha256Canonical("receipt"),
      } satisfies ReplayCreationReceiptV1;
    },
  };
  const facade = new PressureChapterHttpFacade(
    access,
    routes,
    game,
    responseAcknowledger,
    decisionCompiler,
    actions,
    chat,
    result,
    replay,
    { nowMs: () => 1_700_000_000_000 },
    undefined,
    delivery,
  );
  return {
    facade,
    principal: { subjectId: USER_ID, viewerId: USER_ID },
    stored,
    calls,
    compilerInputs,
    acknowledgementInputs,
    deliveryInputs,
    actionCommands,
    chatCommands,
    replayCommands,
    replayViewerIds,
    get actionWrites() { return actionWrites; },
    get chatWrites() { return chatWrites; },
    get replayWrites() { return replayWrites; },
    get gameReads() { return gameReads; },
    get resultReads() { return resultReads; },
  };
}

function storedRoute(): StoredRunRouteRecordV1 {
  const topologyBase = {
    schemaVersion: "pressure_initial_role_control_topology_v1" as const,
    controlTopologyVersion: "six-seat-control-v1",
    participantMode: "SOLO" as const,
    seatControls: PRESSURE_CHAPTER_SEAT_IDS_V1.map((seatId, index) => ({
      seatId,
      mode: index === 0 ? "HUMAN_ACTIVE" as const : "AI_ACTIVE" as const,
    })),
  };
  const controlTopology = {
    ...topologyBase,
    topologyHash: sha256Canonical(topologyBase),
  };
  const snapshot = withRunRouteHash({
    schemaVersion: "pressure_run_route_snapshot_v1",
    runId: RUN_ID,
    route: { ...PRESSURE_CHAPTER_ROUTE_V1 },
    contentPackageVersion: "sangtian-content-v1",
    contentPackageSha256: sha256Canonical("content"),
    orchestrationPackageVersion: "sangtian-orchestration-v1",
    orchestrationPackageSha256: sha256Canonical("orchestration"),
    runtimeContractVersion: "pressure-runtime-v1",
    runtimeContractSha256: sha256Canonical("runtime"),
    testMatrixVersion: "pressure-tests-v1",
    testMatrixSha256: sha256Canonical("tests"),
    runSeed: "run-seed-http",
    narrativeProfileVersion: "openovel-pressure-v1",
    featureSetVersion: "pressure-features-v1",
    resultContractRegistryVersion: "result-registry-v1",
    participantMode: "SOLO",
    seatIds: [...PRESSURE_CHAPTER_SEAT_IDS_V1],
    humanSeatIdsAtStart: [SEAT_ID],
    controlTopologyVersion: controlTopology.controlTopologyVersion,
    initialRoleControlSnapshotHash: controlTopology.topologyHash,
  });
  const base = {
    schemaVersion: "pressure_stored_run_route_v1" as const,
    runId: RUN_ID,
    routeKey: "sangtian-pressure",
    registryVersion: "pressure-registry-v1",
    registryHash: sha256Canonical("registry"),
    handlerKey: "pressure_chapter_v1" as const,
    resultAdapterKey: "SangtianPressureResultV1Adapter" as const,
    presentationSchemaVersion: "sangtian_pressure_result_v1" as const,
    rendererKey: "sangtian_pressure_endgame_v1" as const,
    createRequestFingerprint: sha256Canonical("create"),
    snapshot,
    controlTopology,
  };
  return { ...base, recordHash: sha256Canonical(base) };
}

function decisionCommand(routeHash: string): PressureChapterSubmitDecisionCommandV1 {
  return {
    schemaVersion: "pressure_chapter_game_command_v1",
    commandType: "SUBMIT_DECISION",
    runId: RUN_ID,
    routeHash,
    chapterRuntimeId: "chapter-runtime-n1",
    chapterId: "N1" as const,
    decisionPointId: "n1-decision-1",
    seatId: SEAT_ID,
    controlEpoch: 2,
    expectedWorkingRevision: 0,
    submissionFenceToken: sha256Canonical("submission-fence"),
    idempotencyKey: "action-http-key-1",
    optionCode: "A",
    customText: "核验粮册",
    sourceEventId: null,
    responseActionCode: null,
  };
}

function compiledDecisionCommand(
  input: Parameters<PressureChapterHttpDecisionCompilerPort["compile"]>[0],
  seatId: PressureChapterSubmitDecisionCommandV1["seatId"],
): SubmitOrchestratedActionCommandV1 {
  if (input.command.chapterId === "P0") {
    throw new Error("P0 cannot compile a formal decision");
  }
  const payload = {
    optionCode: input.command.optionCode,
    customText: input.command.customText,
    ...(input.command.sourceEventId === null ? {} : {
      responseToEventId: input.command.sourceEventId,
      responseActionCode: input.command.responseActionCode,
    }),
  };
  const actionIdentityHash = sha256Canonical({
    runId: input.command.runId,
    chapterRuntimeId: input.command.chapterRuntimeId,
    seatId,
    idempotencyKey: input.command.idempotencyKey,
  });
  const base = {
    schemaVersion: "sangtian_decision_action_v1" as const,
    actionId: "action_" + actionIdentityHash,
    runId: input.command.runId,
    chapterRuntimeId: input.command.chapterRuntimeId,
    chapterId: input.command.chapterId,
    decisionPointId: input.command.decisionPointId,
    seatId,
    actionOrdinal: 7,
    actionRevision: 3,
    controlEpoch: input.command.controlEpoch,
    expectedWorkingRevision: input.command.expectedWorkingRevision,
    status: "SEALED" as const,
    actionType: "DECIDE",
    payload,
    payloadHash: sha256Canonical(payload),
    idempotencyKey: input.command.idempotencyKey,
  };
  const withRequest = {
    ...base,
    requestFingerprint: computeDecisionActionRequestFingerprint(base),
  };
  const action = {
    ...withRequest,
    sealedHash: sha256Canonical(withRequest),
  };
  const intent = {
    visibility: "PRIVATE" as const,
    targetSeatIds: [],
    evidenceRefs: [],
    resourceReservations: [],
    commitmentMutations: [],
    knowledgeGrants: [],
    seatArcProgress: [],
  };
  return {
    routeSnapshot: structuredClone(input.storedRoute.snapshot),
    subjectId: input.access.subjectId,
    action,
    intent,
    inputFingerprint: computeFormalInteractionInputFingerprint({
      routeSnapshot: input.storedRoute.snapshot,
      action,
      intent,
    }),
    nowMs: input.nowMs,
  };
}

function chatMessage(
  command: SubmitPressureChatCommandV1,
): PressureChatMessageV1 {
  const base = {
    schemaVersion: "pressure_chapter_chat_message_v1" as const,
    messageId: "chat-message-1",
    runId: RUN_ID,
    chapterRuntimeId: command.chapterRuntimeId,
    chapterId: command.chapterId,
    senderSeatId: command.senderSeatId,
    visibility: command.visibility,
    audienceSeatIds: [...PRESSURE_CHAPTER_SEAT_IDS_V1],
    text: command.text,
    idempotencyKey: command.idempotencyKey,
    requestFingerprint: command.requestFingerprint,
  };
  return { ...base, messageHash: sha256Canonical(base) };
}

async function expectHttpCode(
  operation: () => Promise<unknown>,
  code: string,
  status: number,
): Promise<void> {
  await assert.rejects(operation, (error: unknown) => {
    assert.ok(error instanceof PressureChapterHttpException);
    assert.equal(error.code, code);
    assert.equal(error.getStatus(), status);
    return true;
  });
}
test("every rejected response path leaves delivery ACK/MODAL_SHOWN state unchanged", async () => {
  const rejectedAckMutations: Array<{ path: string; count: number }> = [];
  const responseCommand = (routeHash: string, idempotencyKey: string) => ({
    ...decisionCommand(routeHash),
    idempotencyKey,
    sourceEventId: `safe-projected-${idempotencyKey}`,
    responseActionCode: "SIGNED_RESPONSE_A",
  });
  for (const compilerErrorCode of [
    "INTEGRATION_DECISION_COMMAND_MISMATCH",
    "SEAT_CONTROL_FENCE_REJECTED",
  ]) {
    const harness = createHarness({ compilerErrorCode });
    await expectHttpCode(
      () => harness.facade.submitDecision(
        harness.principal,
        ROOM_ID,
        responseCommand(harness.stored.snapshot.routeHash, `reject-${compilerErrorCode}`),
      ),
      PRESSURE_CHAPTER_HTTP_ERROR_CODES.COMMAND_REJECTED,
      422,
    );
    rejectedAckMutations.push({
      path: compilerErrorCode,
      count: harness.acknowledgementInputs.length,
    });
    assert.equal(harness.actionWrites, 0);
  }

  const wrongSeat = createHarness({ compilerSeatId: "qingliu_law" });
  await expectHttpCode(
    () => wrongSeat.facade.submitDecision(
      wrongSeat.principal,
      ROOM_ID,
      responseCommand(wrongSeat.stored.snapshot.routeHash, "reject-wrong-seat"),
    ),
    PRESSURE_CHAPTER_HTTP_ERROR_CODES.ROUTE_MISMATCH,
    409,
  );
  rejectedAckMutations.push({
    path: "COMPILED_SEAT_MISMATCH",
    count: wrongSeat.acknowledgementInputs.length,
  });

  const casRejected = createHarness({ actionErrorCode: "PRESSURE_WORKING_LEDGER_HEAD_MISMATCH" });
  await assert.rejects(
    () => casRejected.facade.submitDecision(
      casRejected.principal,
      ROOM_ID,
      responseCommand(casRejected.stored.snapshot.routeHash, "reject-cas"),
    ),
    (error: unknown) => error instanceof PressureChapterHttpException,
  );
  rejectedAckMutations.push({
    path: "WORKING_LEDGER_CAS_REJECTED",
    count: casRejected.acknowledgementInputs.length,
  });
  assert.equal(casRejected.actionWrites, 0);

  const collision = createHarness();
  const first = {
    ...decisionCommand(collision.stored.snapshot.routeHash),
    idempotencyKey: "zero-ack-collision-key",
    sourceEventId: "safe-projected-event-zero-ack",
    responseActionCode: "SIGNED_RESPONSE_A",
  };
  await collision.facade.submitDecision(collision.principal, ROOM_ID, first);
  const ackAfterCommit = collision.acknowledgementInputs.length;
  await expectHttpCode(
    () => collision.facade.submitDecision(collision.principal, ROOM_ID, {
      ...first,
      responseActionCode: "DIFFERENT_RESPONSE",
    }),
    PRESSURE_CHAPTER_HTTP_ERROR_CODES.IDEMPOTENCY_CONFLICT,
    409,
  );
  rejectedAckMutations.push({
    path: "IDEMPOTENCY_COLLISION_DELTA",
    count: collision.acknowledgementInputs.length - ackAfterCommit,
  });
  assert.deepEqual(rejectedAckMutations, [
    { path: "INTEGRATION_DECISION_COMMAND_MISMATCH", count: 0 },
    { path: "SEAT_CONTROL_FENCE_REJECTED", count: 0 },
    { path: "COMPILED_SEAT_MISMATCH", count: 0 },
    { path: "WORKING_LEDGER_CAS_REJECTED", count: 0 },
    { path: "IDEMPOTENCY_COLLISION_DELTA", count: 0 },
  ]);
});
