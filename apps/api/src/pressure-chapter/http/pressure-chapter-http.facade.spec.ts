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
import type { PressureGameReadModeV1 } from "../observability/game-read-observation";
import type {
  PressureGameReadRuntimeObserverPortV1,
  PressureGameReadSafeRequestInputV1,
} from "../observability/game-read-runtime-observer";
import { computePressureChatRequestFingerprint } from "../interaction/chat.service";
import { computeFormalInteractionInputFingerprint } from "../interaction/formal-interaction.service";
import type {
  PressureChatMessageV1,
  SubmitPressureChatCommandV1,
} from "../interaction/contracts";
import type { SubmitOrchestratedActionCommandV1 } from "../orchestrator/contracts";
import { PressureSql7CommitErrorV1 } from "../sql7-fast-path/commit-contract";
import type { PressureSql7SubmitResultV1 } from "../sql7-fast-path/service";
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
  PressureChapterHttpGamePort,
  PressureChapterHttpReplayPort,
  PressureChapterHttpResultPort,
  PressureChapterHttpRoutePort,
} from "./contracts";

const RUN_ID = "run-pressure-http-1";
const ROOM_ID = "room-pressure-http-1";
const USER_ID = "user-pressure-http-1";
const SEAT_ID = "cabinet_finance" as const;

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

test("GET game alone uses the dedicated mode-bound reader and preserves pagination", async () => {
  const explicit = createHarness({ dedicatedGameRead: true });
  await explicit.facade.getGame(explicit.principal, ROOM_ID, {
    feedCursor: "opaque-http-cursor",
    feedLimit: 7,
  });
  assert.deepEqual(explicit.calls.slice(0, 4), [
    "access",
    "route:GAME",
    "stored-route",
    "selected-game-read",
  ]);
  assert.equal(explicit.selectedGameReads, 1);
  assert.equal(explicit.gameReads, 0);
  assert.deepEqual(explicit.selectedGameReadQueries, [{
    runId: RUN_ID,
    subjectId: USER_ID,
    feedCursor: "opaque-http-cursor",
    feedLimit: 7,
  }]);

  await explicit.facade.submitDecision(
    explicit.principal,
    ROOM_ID,
    decisionCommand(explicit.stored.snapshot.routeHash),
  );
  assert.equal(explicit.selectedGameReads, 1);
  assert.equal(explicit.gameReads, 1, "POST projection remains on the legacy game port");

  const defaults = createHarness({ dedicatedGameRead: true });
  await defaults.facade.getGame(defaults.principal, ROOM_ID);
  assert.deepEqual(defaults.selectedGameReadQueries, [{
    runId: RUN_ID,
    subjectId: USER_ID,
  }]);
});

test("FAST GET authorizes once and enters the dedicated reader without legacy route pre-reads", async () => {
  const harness = createHarness({
    dedicatedGameRead: true,
    gameReadMode: "FAST",
  });

  const value = await harness.facade.getGame(harness.principal, ROOM_ID, {
    feedCursor: "opaque-fast-cursor",
    feedLimit: 6,
  });

  assert.equal(value.runId, RUN_ID);
  assert.deepEqual(harness.calls, ["access", "selected-game-read"]);
  assert.equal(harness.selectedGameReads, 1);
  assert.equal(harness.gameReads, 0);
  assert.deepEqual(harness.selectedGameReadQueries, [{
    runId: RUN_ID,
    subjectId: USER_ID,
    feedCursor: "opaque-fast-cursor",
    feedLimit: 6,
  }]);
});

test("FAST access denial preserves the public 403 and stops before route or game readers", async () => {
  const harness = createHarness({
    deny: true,
    dedicatedGameRead: true,
    gameReadMode: "FAST",
  });

  await expectHttpCode(
    () => harness.facade.getGame(harness.principal, ROOM_ID),
    PRESSURE_CHAPTER_HTTP_ERROR_CODES.ACCESS_DENIED,
    403,
  );

  assert.deepEqual(harness.calls, ["access"]);
  assert.equal(harness.selectedGameReads, 0);
  assert.equal(harness.gameReads, 0);
});

test("FAST reader errors preserve public identity or existing mapping without route fallback", async () => {
  const publicError = new PressureChapterHttpException(
    PRESSURE_CHAPTER_HTTP_ERROR_CODES.DEPENDENCY_FAILURE,
    500,
    "gameRead",
  );
  const identity = createHarness({
    dedicatedGameRead: true,
    gameReadMode: "FAST",
    selectedGameReadError: publicError,
  });
  await assert.rejects(
    () => identity.facade.getGame(identity.principal, ROOM_ID),
    (error: unknown) => error === publicError,
  );
  assert.deepEqual(identity.calls, ["access", "selected-game-read"]);
  assert.equal(identity.selectedGameReads, 1);
  assert.equal(identity.gameReads, 0);

  const mapped = createHarness({
    dedicatedGameRead: true,
    gameReadMode: "FAST",
    selectedGameReadError: {
      code: "GAME_READ_SNAPSHOT_SCOPE_MISMATCH",
      path: "gameRead.snapshot",
    },
  });
  await expectHttpCode(
    () => mapped.facade.getGame(mapped.principal, ROOM_ID),
    PRESSURE_CHAPTER_HTTP_ERROR_CODES.ROUTE_MISMATCH,
    409,
  );
  assert.deepEqual(mapped.calls, ["access", "selected-game-read"]);
  assert.equal(mapped.selectedGameReads, 1);
  assert.equal(mapped.gameReads, 0);
});

test("REPLAY and SHADOW retain route dispatch and stored-route validation before reading", async () => {
  for (const mode of ["REPLAY", "SHADOW"] as const) {
    const success = createHarness({
      dedicatedGameRead: true,
      gameReadMode: mode,
    });
    const projection = await success.facade.getGame(success.principal, ROOM_ID);
    assert.deepEqual(projection, {
      schemaVersion: "pressure_chapter_game_projection_v1",
      runId: RUN_ID,
      roomId: ROOM_ID,
    });
    assert.deepEqual(success.calls, [
      "access",
      "route:GAME",
      "stored-route",
      "selected-game-read",
    ], mode);

    const mismatch = createHarness({
      dedicatedGameRead: true,
      gameReadMode: mode,
      dispatchRouteHash: sha256Canonical(`wrong-route-${mode}`),
    });
    await expectHttpCode(
      () => mismatch.facade.getGame(mismatch.principal, ROOM_ID),
      PRESSURE_CHAPTER_HTTP_ERROR_CODES.ROUTE_MISMATCH,
      409,
    );
    assert.deepEqual(mismatch.calls, [
      "access",
      "route:GAME",
      "stored-route",
    ], mode);
    assert.equal(mismatch.selectedGameReads, 0);
    assert.equal(mismatch.gameReads, 0);
  }
});

test("GET observation wraps exactly once, preserves success/error identity, and excludes other methods", async () => {
  const observed: Array<{
    mode: PressureGameReadModeV1;
    input: Readonly<PressureGameReadSafeRequestInputV1>;
  }> = [];
  const observedErrors: unknown[] = [];
  const observer: PressureGameReadRuntimeObserverPortV1 = {
    async observe<T>(
      mode: PressureGameReadModeV1,
      input: Readonly<PressureGameReadSafeRequestInputV1>,
      operation: () => Promise<T>,
    ): Promise<T> {
      observed.push({ mode, input });
      try {
        return await operation();
      } catch (error) {
        observedErrors.push(error);
        throw error;
      }
    },
    report() {},
  };
  const harness = createHarness({
    dedicatedGameRead: true,
    gameReadMode: "FAST",
    gameReadObserver: observer,
  });
  const query = { feedCursor: "opaque-observed-cursor", feedLimit: 4 };

  const value = await harness.facade.getGame(harness.principal, ROOM_ID, query);
  assert.deepEqual(value, {
    schemaVersion: "pressure_chapter_game_projection_v1",
    runId: RUN_ID,
    roomId: ROOM_ID,
  });
  assert.deepEqual(harness.calls, ["access", "selected-game-read"]);
  assert.equal(observed.length, 1);
  assert.equal(observed[0]!.mode, "FAST");
  assert.equal(observed[0]!.input.roomId, ROOM_ID);
  assert.equal(observed[0]!.input.principal, harness.principal);
  assert.equal(observed[0]!.input.query, query);

  await harness.facade.getResult(harness.principal, ROOM_ID);
  assert.deepEqual(harness.calls.slice(2), [
    "access",
    "route:RESULT",
    "stored-route",
    "result-read",
  ]);
  assert.equal(observed.length, 1, "RESULT must not be observed by the GET /game observer");

  let rejected: unknown;
  try {
    await harness.facade.getGame(harness.principal, "");
  } catch (error) {
    rejected = error;
  }
  assert.ok(rejected instanceof PressureChapterHttpException);
  assert.equal(rejected.code, PRESSURE_CHAPTER_HTTP_ERROR_CODES.INPUT_INVALID);
  assert.equal(observed.length, 2);
  assert.equal(observedErrors.length, 1);
  assert.equal(rejected, observedErrors[0], "the exact business error object must survive");
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

test("production convergence receives the player action without invoking the legacy action writer", async () => {
  const harness = createHarness({ convergence: true });
  const body = decisionCommand(harness.stored.snapshot.routeHash);

  await harness.facade.submitDecision(harness.principal, ROOM_ID, body);

  assert.equal(harness.actionWrites, 0);
  assert.equal(harness.convergenceCommands.length, 1);
  assert.equal(
    harness.convergenceCommands[0]?.humanAction?.action.idempotencyKey,
    body.idempotencyKey,
  );
  assert.doesNotMatch(harness.calls.join(","), /action-write/u);
});

test("HTTP compiler snapshot is reused by convergence without a second authority read", async () => {
  const harness = createHarness({ convergence: true, sharedSnapshot: true });
  const body = decisionCommand(harness.stored.snapshot.routeHash);

  await harness.facade.submitDecision(harness.principal, ROOM_ID, body);

  assert.equal(harness.convergenceCommands.length, 1);
  assert.equal(
    harness.convergenceCommands[0]?.authoritySnapshot?.snapshotHash,
    sha256Canonical("shared-http-authority"),
  );
  assert.match(harness.calls.join(","), /decision-compile-with-snapshot/u);
  assert.doesNotMatch(harness.calls.join(","), /decision-compile,/u);
});

test("committed authority projection skips the full post-submit game read", async () => {
  const harness = createHarness({
    convergence: true,
    sharedSnapshot: true,
    committedAuthority: true,
  });
  await harness.facade.submitDecision(
    harness.principal,
    ROOM_ID,
    decisionCommand(harness.stored.snapshot.routeHash),
  );
  assert.equal(harness.gameReads, 0);
  assert.equal(harness.seededGameReads, 1);
  assert.doesNotMatch(harness.calls.join(","), /game-read(?:,|$)/u);
  assert.match(harness.calls.join(","), /game-read-committed/u);
});

test("GET Narrative update authorizes once and skips full game and route dispatch reads", async () => {
  const harness = createHarness();
  const value = await harness.facade.getNarrativeUpdate(
    harness.principal,
    ROOM_ID,
    "chapter-runtime-2",
  );
  assert.equal(value.schemaVersion, "pressure_game_narrative_update_v1");
  assert.deepEqual(harness.calls, ["access", "narrative-update-read"]);
  assert.equal(harness.gameReads, 0);
});

test("FAST post-submit projection uses the configured aggregate reader", async () => {
  const harness = createHarness({
    convergence: true,
    sharedSnapshot: true,
    committedAuthority: true,
    dedicatedGameRead: true,
    gameReadMode: "FAST",
  });
  await harness.facade.submitDecision(
    harness.principal,
    ROOM_ID,
    decisionCommand(harness.stored.snapshot.routeHash),
  );
  assert.equal(harness.selectedGameReads, 1);
  assert.equal(harness.gameReads, 0);
  assert.equal(harness.seededGameReads, 0);
  assert.match(harness.calls.join(","), /selected-game-read/u);
  assert.doesNotMatch(harness.calls.join(","), /game-read-committed/u);
});

test("SQL7 COMMITTED returns directly without legacy authorization or reads", async () => {
  const harness = createHarness({ sql7: "COMMITTED" });
  const response = await harness.facade.submitDecision(
    harness.principal,
    ROOM_ID,
    decisionCommand(harness.stored.snapshot.routeHash),
  );

  assert.equal(response.projection.runId, RUN_ID);
  assert.deepEqual(harness.calls, ["sql7"]);
  assert.equal(harness.sql7Submits, 1);
  assert.equal(harness.gameReads, 0);
  assert.equal(harness.actionWrites, 0);
  assert.equal(harness.compilerInputs.length, 0);
});

test("SQL7 NOT_APPLICABLE falls back through the complete legacy path", async () => {
  const harness = createHarness({ sql7: "NOT_APPLICABLE" });
  const response = await harness.facade.submitDecision(
    harness.principal,
    ROOM_ID,
    decisionCommand(harness.stored.snapshot.routeHash),
  );

  assert.equal(response.projection.runId, RUN_ID);
  assert.equal(harness.sql7Submits, 1);
  assert.deepEqual(harness.calls.slice(0, 4), [
    "sql7",
    "access",
    "route:ACTION",
    "stored-route",
  ]);
  assert.match(harness.calls.join(","), /decision-compile,action-write,game-read/u);
  assert.equal(harness.actionWrites, 1);
  assert.equal(harness.gameReads, 1);
});

test("SQL7 REPLAYED performs no write and returns the currently authorized projection", async () => {
  const harness = createHarness({ sql7: "REPLAYED" });
  const response = await harness.facade.submitDecision(
    harness.principal,
    ROOM_ID,
    decisionCommand(harness.stored.snapshot.routeHash),
  );

  assert.equal(response.idempotencyKey, "action-http-key-1");
  assert.equal(response.projection.runId, RUN_ID);
  assert.deepEqual(harness.calls, [
    "sql7",
    "access",
    "route:ACTION",
    "stored-route",
    "game-read",
  ]);
  assert.equal(harness.actionWrites, 0);
  assert.equal(harness.gameReads, 1);
});

test("SQL7 authority fence mismatch is a public command conflict without legacy fallback", async () => {
  const harness = createHarness({ sql7: "AUTHORITY_FENCE_MISMATCH" });
  await expectHttpCode(
    () => harness.facade.submitDecision(
      harness.principal,
      ROOM_ID,
      decisionCommand(harness.stored.snapshot.routeHash),
    ),
    PRESSURE_CHAPTER_HTTP_ERROR_CODES.COMMAND_REJECTED,
    409,
  );

  assert.deepEqual(harness.calls, ["sql7"]);
  assert.equal(harness.actionWrites, 0);
  assert.equal(harness.gameReads, 0);
});

test("SQL7 infrastructure errors and Prisma unique conflicts have stable public mappings", async () => {
  for (const code of [
    "INVALID_PLAN",
    "PERSISTED_COUNT_MISMATCH",
    "QUERY_BUDGET_EXCEEDED",
  ] as const) {
    await expectHttpCode(
      () => pressureHttpBoundary(async () => {
        throw new PressureSql7CommitErrorV1(code, "private SQL7 detail");
      }),
      PRESSURE_CHAPTER_HTTP_ERROR_CODES.DEPENDENCY_FAILURE,
      500,
    );
  }
  await expectHttpCode(
    () => pressureHttpBoundary(async () => {
      throw Object.assign(new Error("private unique detail"), { code: "P2002" });
    }),
    PRESSURE_CHAPTER_HTTP_ERROR_CODES.IDEMPOTENCY_CONFLICT,
    409,
  );
});

test("safe stale decision mismatches are recoverable conflicts without leaking authority details", async () => {
  let caught: unknown;
  try {
    await pressureHttpBoundary(async () => {
      throw Object.assign(new Error("private authority detail"), {
        code: "PRESSURE_DECISION_AUTOMATION_PORT_RESULT_INVALID",
        details: {
          path: "submit.authority",
          detail: "STALE_OR_NOT_AUTHORIZED",
          mismatchKeys: ["decision.completion", "working.revision"],
        },
      });
    });
  } catch (error) {
    caught = error;
  }

  assert.ok(caught instanceof PressureChapterHttpException);
  assert.equal(caught.code, PRESSURE_CHAPTER_HTTP_ERROR_CODES.STALE_DECISION);
  assert.equal(caught.getStatus(), 409);
  const response = caught.getResponse();
  assert.doesNotMatch(JSON.stringify(response), /decision\.completion|working\.revision|private authority/u);
});

test("control authority mismatches remain non-recoverable", async () => {
  await expectHttpCode(
    () => pressureHttpBoundary(async () => {
      throw Object.assign(new Error("private control detail"), {
        code: "PRESSURE_DECISION_AUTOMATION_PORT_RESULT_INVALID",
        details: {
          path: "submit.authority",
          detail: "STALE_OR_NOT_AUTHORIZED",
          mismatchKeys: ["control.fence"],
        },
      });
    }),
    PRESSURE_CHAPTER_HTTP_ERROR_CODES.DEPENDENCY_FAILURE,
    500,
  );
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
  assert.equal(harness.compilerInputs.length, 2, "invalid bodies never reach the compiler");
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
  convergence?: boolean;
  sharedSnapshot?: boolean;
  committedAuthority?: boolean;
  sql7?: "COMMITTED" | "REPLAYED" | "NOT_APPLICABLE" | "AUTHORITY_FENCE_MISMATCH";
  dedicatedGameRead?: boolean;
  selectedGameReadError?: unknown;
  gameReadMode?: PressureGameReadModeV1;
  gameReadObserver?: PressureGameReadRuntimeObserverPortV1;
} = {}) {
  const calls: string[] = [];
  const stored = storedRoute();
  let actionWrites = 0;
  let chatWrites = 0;
  let replayWrites = 0;
  let gameReads = 0;
  let selectedGameReads = 0;
  let seededGameReads = 0;
  let resultReads = 0;
  let sql7Submits = 0;
  const selectedGameReadQueries: Parameters<PressureChapterHttpGamePort["read"]>[0][] = [];
  const actionCommands: SubmitOrchestratedActionCommandV1[] = [];
  const compilerInputs: Parameters<PressureChapterHttpDecisionCompilerPort["compile"]>[0][] = [];
  const chatCommands: SubmitPressureChatCommandV1[] = [];
  const replayCommands: unknown[] = [];
  const replayViewerIds: string[] = [];
  const convergenceCommands: Array<Record<string, any>> = [];
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
      } as unknown as PressureChapterGameProjectionV1;
    },
    async readFromCommittedAuthority() {
      calls.push("game-read-committed");
      seededGameReads += 1;
      return {
        schemaVersion: "pressure_chapter_game_projection_v1",
        runId: RUN_ID,
        roomId: ROOM_ID,
      } as unknown as PressureChapterGameProjectionV1;
    },
    async readNarrativeUpdate(input) {
      calls.push("narrative-update-read");
      return {
        schemaVersion: "pressure_game_narrative_update_v1",
        runId: input.runId,
        routeHash: stored.snapshot.routeHash,
        chapterRuntimeId: input.chapterRuntimeId,
        viewerSeatId: SEAT_ID,
        narrative: null,
      };
    },
  };
  const selectedGameRead = options.dedicatedGameRead ? {
    async read(query: Parameters<PressureChapterHttpGamePort["read"]>[0]) {
      calls.push("selected-game-read");
      selectedGameReads += 1;
      selectedGameReadQueries.push(structuredClone(query));
      if (options.selectedGameReadError !== undefined) {
        throw options.selectedGameReadError;
      }
      return {
        schemaVersion: "pressure_chapter_game_projection_v1",
        runId: RUN_ID,
        roomId: ROOM_ID,
      } as unknown as PressureChapterGameProjectionV1;
    },
  } : undefined;
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
  if (options.sharedSnapshot) {
    decisionCompiler.compileWithSnapshot = async (input) => {
      calls.push("decision-compile-with-snapshot");
      compilerInputs.push(structuredClone(input));
      return {
        command: compiledDecisionCommand(input, options.compilerSeatId ?? input.command.seatId),
        snapshot: {
          schemaVersion: "pressure_decision_submit_snapshot_v1",
          authority: {
            snapshotHash: sha256Canonical("shared-http-authority"),
            routeSnapshot: structuredClone(stored.snapshot),
          },
          viewer: { seatId: SEAT_ID },
          submitSnapshotHash: sha256Canonical("shared-http-submit"),
        } as any,
      };
    };
  }
  const actions: PressureChapterHttpActionPort = {
    async submitAction(command) {
      calls.push("action-write");
      actionCommands.push(structuredClone(command));
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
  const sql7 = options.sql7 ? {
    async submit(): Promise<PressureSql7SubmitResultV1> {
      calls.push("sql7");
      sql7Submits += 1;
      if (options.sql7 === "AUTHORITY_FENCE_MISMATCH") {
        throw new PressureSql7CommitErrorV1(
          "AUTHORITY_FENCE_MISMATCH",
          "private stale authority detail",
        );
      }
      if (options.sql7 === "NOT_APPLICABLE") {
        return { status: "NOT_APPLICABLE", reason: "SNAPSHOT_UNAVAILABLE" };
      }
      if (options.sql7 === "REPLAYED") {
        return {
          status: "REPLAYED",
          idempotencyKey: "action-http-key-1",
          applicationSqlCount: 1,
        };
      }
      return {
        status: "COMMITTED",
        response: {
          schemaVersion: "pressure_chapter_submit_decision_http_response_v1",
          idempotencyKey: "action-http-key-1",
          projection: {
            schemaVersion: "pressure_chapter_game_projection_v1",
            runId: RUN_ID,
            roomId: ROOM_ID,
          } as unknown as PressureChapterGameProjectionV1,
        },
        authority: {} as Extract<
          PressureSql7SubmitResultV1,
          { status: "COMMITTED" }
        >["authority"],
        applicationSqlCount: 6,
      } as PressureSql7SubmitResultV1;
    },
  } : undefined;
  const facade = new PressureChapterHttpFacade(
    access,
    routes,
    game,
    decisionCompiler,
    actions,
    chat,
    result,
    replay,
    { nowMs: () => 1_700_000_000_000 },
    options.convergence ? {
      async converge(command) {
        calls.push("convergence");
        convergenceCommands.push(structuredClone(command));
        return {
          schemaVersion: "pressure_decision_convergence_result_v1",
          batchId: "test-batch",
          outcome: "BATCH_COMPLETED",
          actionIds: [command.humanAction!.action.actionId],
          chapter: null,
          committedAuthority: options.committedAuthority
            ? {
                chapter: { runId: RUN_ID },
                workingProjection: { key: { runId: RUN_ID } },
                chapterDescriptor: { chapterId: "N1" },
              }
            : null,
          metrics: {},
        } as any;
      },
      async recordHttpCompletion() {},
    } : undefined,
    sql7,
    selectedGameRead,
    options.gameReadMode,
    options.gameReadObserver,
  );
  return {
    facade,
    principal: { subjectId: USER_ID, viewerId: USER_ID },
    stored,
    calls,
    compilerInputs,
    actionCommands,
    chatCommands,
    replayCommands,
    replayViewerIds,
    convergenceCommands,
    selectedGameReadQueries,
    get actionWrites() { return actionWrites; },
    get chatWrites() { return chatWrites; },
    get replayWrites() { return replayWrites; },
    get gameReads() { return gameReads; },
    get selectedGameReads() { return selectedGameReads; },
    get seededGameReads() { return seededGameReads; },
    get resultReads() { return resultReads; },
    get sql7Submits() { return sql7Submits; },
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
