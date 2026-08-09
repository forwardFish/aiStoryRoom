import assert from "node:assert/strict";
import test from "node:test";
import { ConflictException } from "@nestjs/common";
import { lastValueFrom, of, throwError } from "rxjs";
import { SoloEndingResultInterceptor } from "./solo-ending-result.interceptor";
import { SoloEndingResultService } from "./solo-ending-result.service";
import {
  compileLegacyOpenNovelResult,
  compileOpenNovelResultV2,
  extractCommittedSoloEndingEvidence,
  stripPrivateSoloEndingEvidence,
  stripPrivateSoloEndingEvidenceFromEvent,
  type RawOpenNovelResult,
  type SoloResultActionRecord,
  type SoloResultRunRecord,
} from "./solo-ending-result";

const user = { id: "user-1", openid: "openid-1" } as any;
const ROLE_ID = "role-governor";

function evidenceCause(
  turnNumber: number,
  factText: string,
  direction: "HELPED" | "HURT" | "DECISIVE",
  overrides: Record<string, unknown> = {},
) {
  return {
    sourceTurnId: `T${String(turnNumber).padStart(2, "0")}`,
    sourceRevision: turnNumber,
    sourceEventId: `event-${turnNumber}`,
    authority: "PREDICATE",
    visibility: "PLAYER",
    criterion: `CRITERION_${turnNumber}`,
    factText,
    direction,
    ...overrides,
  };
}

function ending(overrides: Record<string, unknown> = {}) {
  const base = {
    schemaVersion: "openovel_ending_v1" as const,
    scope: "PART" as const,
    endingKey: "guarded_people_bore_responsibility",
    title: "守土担责",
    finalSceneNarrative: "驿骑带着首报离开杭州。",
    protagonistFate: "问责落到了总督自己名下。",
    aftermath: ["这只是第一部分之后的公开余波。"],
    sourceTurnId: "T20",
    sourceRevision: 20,
  };
  const merged = { ...base, ...overrides } as any;
  if (!("playerEvidence" in overrides)) {
    merged.playerEvidence = {
      schemaVersion: "openovel_player_ending_evidence_v1",
      endingKey: merged.endingKey,
      scope: merged.scope,
      sourceTurnId: merged.sourceTurnId,
      sourceRevision: merged.sourceRevision,
      causes: [evidenceCause(20, "总督本人已经进入明确问责范围。", "DECISIVE")],
      reveal: null,
    };
  }
  return merged;
}

function run(overrides: Partial<SoloResultRunRecord> = {}): SoloResultRunRecord & { title: string } {
  return {
    id: "solo-run-1",
    title: "桑田诏",
    ownerUserId: user.id,
    templateKey: "sangtian",
    engineVersion: "openovel_v1",
    selectedRoleKey: "zhejiang_governor",
    status: "chapter_generated",
    updatedAt: new Date("2026-08-09T00:00:00.000Z"),
    players: [{
      userId: user.id,
      role: {
        id: ROLE_ID,
        roleKey: "zhejiang_governor",
        roleName: "浙江总督",
        personalGoal: "稳住浙江并避免皇帝认定你欺瞒。",
      },
    }],
    ...overrides,
  };
}

function action(
  id: string,
  turnNumber: number,
  overrides: Partial<SoloResultActionRecord> = {},
): SoloResultActionRecord {
  return {
    id,
    runId: "solo-run-1",
    userId: user.id,
    roleId: ROLE_ID,
    status: "resolved",
    method: `行动 ${turnNumber}`,
    immediateJson: { boundOption: { label: `选择 ${turnNumber}` } },
    resolvedJson: {
      turnId: `T${String(turnNumber).padStart(2, "0")}`,
      turnNumber,
      narration: "这段文学正文不得被当成结构化事实。",
      causalDelta: {
        requiredNarrativeFacts: ["这个旧字段不得再成为原因。"],
        durableHints: [{ note: "内部 note 不得泄漏", presentThisTurn: false }],
        scenePacket: { visibleFacts: ["旧投影也不得自动授权"] },
      },
    },
    resolvedAt: new Date("2026-08-09T00:00:00.000Z"),
    createdAt: new Date("2026-08-09T00:00:00.000Z"),
    ...overrides,
  };
}

function raw(endingOverrides: Record<string, unknown> = {}): RawOpenNovelResult {
  return {
    room: { id: "solo-run-1", title: "桑田诏", worldId: "sangtian" },
    player: { roleName: "浙江总督" },
    ending: ending(endingOverrides),
    completedNodes: 20,
  };
}

function runtime(overrides: Record<string, unknown> = {}) {
  return {
    runId: "solo-run-1",
    worldId: "sangtian",
    roleId: "zhejiang_governor",
    runtimeMode: "OPENOVEL_V1",
    turnNumber: 20,
    status: "COMPLETED",
    canon: "",
    recentCanon: "",
    ending: ending(),
    options: [],
    updatedAt: "2026-08-09T00:00:00.000Z",
    ...overrides,
  };
}

function prismaFor(actions: SoloResultActionRecord[], runValue = run()) {
  return {
    storyRun: { findUnique: async () => runValue },
    playerAction: { findMany: async () => actions },
  } as any;
}

function response(error: unknown) {
  return (error as any)?.getResponse?.() || {};
}

test("Result compiler follows explicit evidence order instead of recency score", () => {
  const authoritative = ending();
  authoritative.playerEvidence.causes = [
    evidenceCause(20, "首份奏报已经离开浙江。", "DECISIVE"),
    evidenceCause(1, "复核程序已经写入权威状态。", "HELPED"),
  ];
  const result = compileOpenNovelResultV2({
    raw: raw({ playerEvidence: authoritative.playerEvidence }),
    run: run(),
    viewerUserId: user.id,
    actions: [action("a01", 1), action("a20", 20)],
  });
  assert.equal(result.schemaVersion, "openovel_result_v2");
  assert.equal(result.presentation.resultType, "SOLO_PART_END");
  assert.deepEqual(result.presentation.causes.map((cause) => cause.sourceActionId), ["a20", "a01"]);
  assert.deepEqual(result.presentation.causes.map((cause) => cause.direction), ["DECISIVE", "HELPED"]);
});

test("Result compiler never falls back to narration, causalDelta or generic cause text", () => {
  const authoritative = ending();
  authoritative.playerEvidence.causes = [];
  const noEvidence = raw({ playerEvidence: authoritative.playerEvidence });
  assert.deepEqual(extractCommittedSoloEndingEvidence({
    actions: [action("a01", 1)],
    runId: "solo-run-1",
    viewerUserId: user.id,
    viewerRoleId: ROLE_ID,
    roleName: "浙江总督",
    ending: noEvidence.ending,
  }), []);
  assert.throws(() => compileOpenNovelResultV2({
    raw: noEvidence,
    run: run(),
    viewerUserId: user.id,
    actions: [action("a01", 1)],
  }), /AUTHORITATIVE_CAUSES_MISSING/);
});

test("Result compiler filters other viewers, unresolved actions, wrong runs and ambiguous turns", () => {
  const authoritative = ending();
  authoritative.playerEvidence.causes = [evidenceCause(3, "我的已提交事实。", "HELPED")];
  const causes = extractCommittedSoloEndingEvidence({
    actions: [
      action("other", 3, { userId: "user-2" }),
      action("pending", 3, { status: "generating" }),
      action("mine", 3),
      action("another-run", 3, { runId: "solo-run-2" }),
    ],
    runId: "solo-run-1",
    viewerUserId: user.id,
    viewerRoleId: ROLE_ID,
    roleName: "浙江总督",
    ending: raw({ playerEvidence: authoritative.playerEvidence }).ending,
  });
  assert.deepEqual(causes.map((cause) => cause.sourceActionId), ["mine"]);
});

test("persisted authorized and committed booleans are ignored rather than trusted", () => {
  const authoritative = ending();
  authoritative.playerEvidence.causes = [evidenceCause(20, "权威事实。", "DECISIVE", {
    committed: false,
    authorized: false,
  })];
  const causes = extractCommittedSoloEndingEvidence({
    actions: [action("a20", 20)],
    runId: "solo-run-1",
    viewerUserId: user.id,
    viewerRoleId: ROLE_ID,
    roleName: "浙江总督",
    ending: authoritative,
  });
  assert.equal(causes.length, 1);
  assert.equal(causes[0]?.committed, true);
  assert.equal(causes[0]?.authorized, true);
});

test("structurally valid PLAYER evidence is unauthorized for another bound role", () => {
  const authoritative = ending();
  authoritative.playerEvidence.causes = [evidenceCause(20, "只属于当前角色的事实。", "DECISIVE")];
  const causes = extractCommittedSoloEndingEvidence({
    actions: [action("a20", 20, { roleId: "role-other" })],
    runId: "solo-run-1",
    viewerUserId: user.id,
    viewerRoleId: ROLE_ID,
    roleName: "浙江总督",
    ending: authoritative,
  });
  assert.deepEqual(causes, []);
});

test("invalid or internal evidence visibility fails closed", () => {
  const authoritative = ending();
  authoritative.playerEvidence.causes = [evidenceCause(20, "内部事实", "DECISIVE", {
    visibility: "INTERNAL",
  })];
  assert.throws(() => compileOpenNovelResultV2({
    raw: raw({ playerEvidence: authoritative.playerEvidence }),
    run: run(),
    viewerUserId: user.id,
    actions: [action("a20", 20)],
  }), /AUTHORITATIVE_CAUSES_MISSING/);
});

test("Result compiler is deterministic across refresh and restart reads", () => {
  const input = {
    raw: raw(),
    run: run(),
    viewerUserId: user.id,
    actions: [action("a20", 20)],
  };
  assert.deepEqual(compileOpenNovelResultV2(input), compileOpenNovelResultV2(input));
});

test("completed historical run without Ending fails closed", () => {
  const result = compileLegacyOpenNovelResult({
    run: run(),
    viewerUserId: user.id,
    completedNodes: 20,
    ending: null,
  });
  assert.equal(result.presentation.resultType, "LEGACY_ENDING");
  assert.equal(result.presentation.verdict, "UNAVAILABLE");
  assert.deepEqual(result.presentation.causes, []);
});

test("run and viewer mismatches fail closed", () => {
  assert.throws(() => compileOpenNovelResultV2({
    raw: { ...raw(), room: { id: "another-run" } },
    run: run(),
    viewerUserId: user.id,
    actions: [action("a20", 20)],
  }), /SOLO_RESULT_RUN_MISMATCH/);
  assert.throws(() => compileLegacyOpenNovelResult({
    run: run(),
    viewerUserId: "user-2",
    completedNodes: 20,
  }), /SOLO_RESULT_VIEWER_FORBIDDEN/);
});

test("T19, mismatched revision and invalid scope fail closed", () => {
  for (const endingOverrides of [
    { sourceTurnId: "T19", sourceRevision: 19, playerEvidence: null },
    { sourceTurnId: "T20", sourceRevision: 19, playerEvidence: null },
    { scope: "INVALID", playerEvidence: null },
  ]) {
    assert.throws(() => compileOpenNovelResultV2({
      raw: raw(endingOverrides),
      run: run(),
      viewerUserId: user.id,
      actions: [action("a20", 20)],
    }), /SOLO_RESULT_NOT_READY/);
  }
});

test("Result service rejects a non-member before reading runtime state", async () => {
  let runtimeReads = 0;
  const deniedRun = run({ ownerUserId: "user-2", players: [] });
  const service = new SoloEndingResultService({
    storyRun: { findUnique: async () => deniedRun },
  } as any, {
    getRun: async () => { runtimeReads += 1; return runtime(); },
  } as any);
  await assert.rejects(
    service.present(user, "solo-run-1", raw()),
    (error: any) => response(error).code === "OPENOVEL_RUN_ACCESS_DENIED",
  );
  assert.equal(runtimeReads, 0);
});

test("Result service validates runtime completion and queries only the viewer role actions", async () => {
  let runtimeReads = 0;
  let actionWhere: Record<string, unknown> | undefined;
  const prisma = {
    storyRun: { findUnique: async () => run() },
    playerAction: { findMany: async (query: any) => { actionWhere = query.where; return [action("a20", 20)]; } },
  } as any;
  const service = new SoloEndingResultService(prisma, {
    getRun: async () => { runtimeReads += 1; return runtime(); },
  } as any);
  const result = await service.present(user, "solo-run-1", raw()) as any;
  assert.equal(result.presentation.schemaVersion, "endgame_presentation_v1");
  assert.equal(runtimeReads, 1);
  assert.equal(actionWhere?.runId, "solo-run-1");
  assert.equal(actionWhere?.userId, user.id);
  assert.equal(actionWhere?.roleId, ROLE_ID);
});

test("Result service rejects non-COMPLETED runtime with stable semantics", async () => {
  const service = new SoloEndingResultService(prismaFor([action("a20", 20)]), {
    getRun: async () => runtime({ status: "READY" }),
  } as any);
  await assert.rejects(service.present(user, "solo-run-1", raw()), (error: any) => {
    const value = response(error);
    return value.code === "RESULT_NOT_READY" && value.reason === "RUNTIME_NOT_AUTHORITATIVELY_COMPLETED";
  });
});

test("COMPLETED runtime with active options is not terminal", async () => {
  const service = new SoloEndingResultService(prismaFor([action("a20", 20)]), {
    getRun: async () => runtime({ options: [{ id: "next", label: "still active" }] }),
  } as any);
  await assert.rejects(service.present(user, "solo-run-1", raw()), (error: any) => {
    const value = response(error);
    return value.code === "RESULT_NOT_READY" && value.reason === "RUNTIME_HAS_ACTIVE_DECISION";
  });
});

test("COMPLETED runtime with an explicit next decision is not terminal", async () => {
  const service = new SoloEndingResultService(prismaFor([action("a20", 20)]), {
    getRun: async () => runtime({ nextDecisionPointId: "decision-after-ending" }),
  } as any);
  await assert.rejects(service.present(user, "solo-run-1", raw()), (error: any) => {
    const value = response(error);
    return value.code === "RESULT_NOT_READY" && value.reason === "RUNTIME_HAS_ACTIVE_DECISION";
  });
});

test("Result service rejects T19, wrong revision and ending identity mismatch", async () => {
  for (const runtimeRun of [
    runtime({ turnNumber: 19 }),
    runtime({ ending: ending({ sourceTurnId: "T19", sourceRevision: 19, playerEvidence: null }) }),
    runtime({ ending: ending({ endingKey: "crisis_unresolved", playerEvidence: null }) }),
  ]) {
    const service = new SoloEndingResultService(prismaFor([action("a20", 20)]), {
      getRun: async () => runtimeRun,
    } as any);
    await assert.rejects(
      service.present(user, "solo-run-1", raw()),
      (error: any) => response(error).code === "RESULT_NOT_READY",
    );
  }
});

test("Result service rejects an unfinished database mirror and selected-role drift", async () => {
  for (const runValue of [
    run({ status: "playing" }),
    run({ selectedRoleKey: "another_role" }),
  ]) {
    const service = new SoloEndingResultService(
      prismaFor([action("a20", 20)], runValue),
      { getRun: async () => runtime() } as any,
    );
    await assert.rejects(service.present(user, "solo-run-1", raw()), (error: any) => {
      const value = response(error);
      return value.code === "RESULT_NOT_READY"
        && value.reason === "RUNTIME_NOT_AUTHORITATIVELY_COMPLETED";
    });
  }
});

test("service derives evidence authorization and rejects a different role action", async () => {
  const service = new SoloEndingResultService(
    prismaFor([action("a20", 20, { roleId: "role-other" })]),
    { getRun: async () => runtime() } as any,
  );
  await assert.rejects(service.present(user, "solo-run-1", raw()), (error: any) => {
    const value = response(error);
    return value.code === "RESULT_NOT_READY" && value.reason === "AUTHORITATIVE_CAUSES_MISSING";
  });
});

test("raw payload cannot replace the authoritative Runtime evidence envelope", async () => {
  const forged = ending();
  forged.playerEvidence.causes = [evidenceCause(1, "伪造原因。", "HELPED")];
  const authoritative = ending();
  authoritative.playerEvidence.causes = [evidenceCause(20, "权威原因。", "DECISIVE")];
  const service = new SoloEndingResultService(
    prismaFor([action("a01", 1), action("a20", 20)]),
    { getRun: async () => runtime({ ending: authoritative }) } as any,
  );
  const result = await service.present(user, "solo-run-1", raw({ playerEvidence: forged.playerEvidence })) as any;
  assert.deepEqual(result.presentation.causes.map((item: any) => item.sourceActionId), ["a20"]);
  assert.equal(result.presentation.causes[0]?.factText, "权威原因。");
});

test("Result service does not transform non-OpenNovel results", async () => {
  const payload = { schemaVersion: "continuous_story_result_v2" };
  const service = new SoloEndingResultService({} as any, {} as any);
  assert.equal(await service.present(user, "room-1", payload), payload);
});

test("historical recovery is limited to completed OpenNovel run with missing Ending", async () => {
  const service = new SoloEndingResultService(prismaFor([]), {
    getRun: async () => runtime({ ending: null }),
  } as any);
  assert.equal(await service.recoverCompletedLegacy(user, "solo-run-1", new Error("other")), null);
  const recovered = await service.recoverCompletedLegacy(
    user,
    "solo-run-1",
    new ConflictException({ code: "RESULT_NOT_READY" }),
  ) as any;
  assert.equal(recovered.presentation.resultType, "LEGACY_ENDING");
});

test("historical recovery does not classify an active runtime as LEGACY_ENDING", async () => {
  const service = new SoloEndingResultService(prismaFor([]), {
    getRun: async () => runtime({ ending: null, options: [{ id: "next", label: "continue" }] }),
  } as any);
  assert.equal(await service.recoverCompletedLegacy(
    user,
    "solo-run-1",
    new ConflictException({ code: "RESULT_NOT_READY" }),
  ), null);
});

test("valid Ending without causes cannot be misclassified as historical legacy", async () => {
  const service = new SoloEndingResultService(prismaFor([]), {
    getRun: async () => runtime(),
  } as any);
  assert.equal(await service.recoverCompletedLegacy(
    user,
    "solo-run-1",
    new ConflictException({ code: "RESULT_NOT_READY" }),
  ), null);
});

test("private ending evidence is removed from direct projections and SSE", () => {
  const payload = { runId: "solo-run-1", ending: ending() };
  const projected = stripPrivateSoloEndingEvidence(payload) as any;
  assert.equal(projected.ending.playerEvidence, undefined);
  assert.equal(projected.ending.endingKey, "guarded_people_bore_responsibility");
  const event = stripPrivateSoloEndingEvidenceFromEvent({ type: "turn.committed", data: payload }) as any;
  assert.equal(event.data.ending.playerEvidence, undefined);
  assert.deepEqual(stripPrivateSoloEndingEvidenceFromEvent(event), event);
});

test("direct OpenNovel GET interceptor strips private evidence", async () => {
  const results = { present: async () => null, recoverCompletedLegacy: async () => null } as any;
  const interceptor = new SoloEndingResultInterceptor(results);
  const context = {
    switchToHttp: () => ({
      getRequest: () => ({
        method: "GET",
        originalUrl: "/api/v4/openovel/runs/solo-run-1",
        params: { runId: "solo-run-1" },
        user,
      }),
    }),
  } as any;
  const output = await lastValueFrom(interceptor.intercept(
    context,
    { handle: () => of({ runId: "solo-run-1", ending: ending() }) } as any,
  )) as any;
  assert.equal(output.ending.playerEvidence, undefined);
});

test("global interceptor transforms only the real rooms result route", async () => {
  const calls: string[] = [];
  const results = {
    present: async (_user: any, runId: string, payload: any) => {
      calls.push(`present:${runId}`);
      return { ...payload, presentation: { schemaVersion: "endgame_presentation_v1" } };
    },
    recoverCompletedLegacy: async () => null,
  } as any;
  const interceptor = new SoloEndingResultInterceptor(results);
  const context = {
    switchToHttp: () => ({
      getRequest: () => ({
        method: "GET",
        originalUrl: "/api/v4/rooms/solo-run-1/result",
        params: { roomId: "solo-run-1" },
        user,
      }),
    }),
  } as any;
  const output = await lastValueFrom(interceptor.intercept(context, { handle: () => of(raw()) } as any));
  assert.equal((output as any).presentation.schemaVersion, "endgame_presentation_v1");
  assert.deepEqual(calls, ["present:solo-run-1"]);
});

test("global interceptor preserves unrelated errors", async () => {
  const original = new ConflictException({ code: "SOME_OTHER_CONFLICT" });
  const results = {
    present: async (_user: any, _runId: string, payload: any) => payload,
    recoverCompletedLegacy: async () => null,
  } as any;
  const interceptor = new SoloEndingResultInterceptor(results);
  const context = {
    switchToHttp: () => ({
      getRequest: () => ({
        method: "GET",
        originalUrl: "/api/v4/rooms/solo-run-1/result",
        params: { roomId: "solo-run-1" },
        user,
      }),
    }),
  } as any;
  await assert.rejects(
    lastValueFrom(interceptor.intercept(context, { handle: () => throwError(() => original) } as any)),
    (error: unknown) => error === original,
  );
});
