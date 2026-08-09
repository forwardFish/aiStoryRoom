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
  type RawOpenNovelResult,
  type SoloResultActionRecord,
  type SoloResultRunRecord,
} from "./solo-ending-result";

const user = { id: "user-1", openid: "openid-1" } as any;

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
    actionTitle: `选择 ${turnNumber}`,
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
    protagonistFate: "问贪h��到了总督自己名下。",
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
    updatedAt: new Date("2026-08-09T00:00:00.000Z"),
    players: [{
      userId: user.id,
      role: {
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
    status: "resolved",
    method: `行动 ${turnNumber}`,
    immediateJson: { boundOption: { label: `选择 ${turnNumber}` } },
    resolvedJson: {
      turnId: `T${String(turnNumber).padStart(2, "0")}`,
      turnNumber,
      narration: "这段文学筣文不得被当成结构化事实。",
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

test("Result compiler filters other viewers, unresolved actions and ambiguous turns", () => {
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
    roleName: "浙江总督",
    ending: raw({ playerEvidence: authoritative.playerEvidence }).ending,
  });
  assert.deepEqual(causes.map((cause) => cause.sourceActionId), ["mine"]);
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

test("T19, wrong revision and illegal Sangtian scope fail closed", () => {
  for (const endingOverrides of [
    { sourceTurnId: "T19", sourceRevision: 19, playerEvidence: null },
    { sourceTurnId: "T20", sourceRevision: 19, playerEvidence: null },
    { scope: "STORY", playerEvidence: null },
  ]) {
    assert.throws(() => compileOpenNovelResultV2({
      raw: raw(endingOverrides),
      run: run(),
      viewerUserId: user.id,
      actions: [action("a20", 20)],
    }), /SOLO_RESULT_NOT_READY/);
  }
});

test("Result service validates runtime completion before publishing presentation", async () => {
  let runtimeReads = 0;
  const prisma = {
    storyRun: { findUnique: async () => run() },
    playerAction: { findMany: async () => [action("a20", 20)] },
  } as any;
  const runtimeClient = {
    getRun: async () => { runtimeReads += 1; return runtime(); },
  } as any;
  const service = new SoloEndingResultService(prisma, runtimeClient);
  const result = await service.present(user, "solo-run-1", raw()) as any;
  assert.equal(result.presentation.schemaVersion, "endgame_presentation_v1");
  assert.equal(runtimeReads, 1);
});

test("Result service rejects incomplete runtime and ending identity mismatch", async () => {
  const prisma = {
    storyRun: { findUnique: async () => run() },
    playerAction: { findMany: async () => [action("a20", 20)] },
  } as any;
  for (const runtimeResult of [
    runtime({ status: "READY" }),
    runtime({ turnNumber: 19 }),
    runtime({ ending: ending({ sourceTurnId: "T19", sourceRevision: 19, playerEvidence: null }) }),
    runtime({ ending: ending({ endingKey: "crisis_unresolved", playerEvidence: null }) }),
  ]) {
    const service = new SoloEndingResultService(prisma, { getRun: async () => runtimeResult } as any);
    await assert.rejects(service.present(user, "solo-run-1", raw()), (error: any) => error?.getResponse?.().code === "RESULT_NOT_READY");
  }
});

test("Result service does not transform non-OpenNovel results", async () => {
  const payload = { schemaVersion: "continuous_story_result_v2" };
  const service = new SoloEndingResultService({} as any, {} as any);
  assert.equal(await service.present(user, "room-1", payload), payload);
});

test("historical recovery is limited to completed OpenNovel run with missing Ending", async () => {
  const prisma = {
    storyRun: { findUnique: async () => run() },
    playerAction: { findMany: async () => [] },
  } as any;
  const service = new SoloEndingResultService(prisma, { getRun: async () => runtime({ ending: null }) } as any);
  assert.equal(await service.recoverCompletedLegacy(user, "solo-run-1", new Error("other")), null);
  const recovered = await service.recoverCompletedLegacy(user, "solo-run-1", new ConflictException({ code: "RESULT_NOT_READY" })) as any;
  assert.equal(recovered.presentation.resultType, "LEGACY_ENDING");
});

test("valid Ending without causes cannot be misclassified as historical legacy", async () => {
  const prisma = { storyRun: { findUnique: async () => run() } } as any;
  const service = new SoloEndingResultService(prisma, { getRun: async () => runtime() } as any);
  assert.equal(await service.recoverCompletedLegacy(user, "solo-run-1", new ConflictException({ code: "RESULT_NOT_READY" })), null);
});

test("global interceptor transforms only the real rooms result route", async () => {
  const calls: string[] = [];
  const results = {
    present: async (_user: any, runId: string, payload: any) => { calls.push(`present:${runId}`); return { ...payload, presentation: { schemaVersion: "endgame_presentation_v1" } }; },
    recoverCompletedLegacy: async () => null,
  } as any;
  const interceptor = new SoloEndingResultInterceptor(results);
  const context = { switchToHttp: () => ({ getRequest: () => ({ method: "GET", originalUrl: "/api/v4/rooms/solo-run-1/result", params: { roomId: "solo-run-1" }, user }) }) } as any;
  const output = await lastValueFrom(interceptor.intercept(context, { handle: () => of(raw()) } as any));
  assert.equal((coutput as any).presentation.schemaVersion, "endgame_presentation_v1");
  assert.deepEqual(calls, ["present:solo-run-1"]);
});

test("global interceptor preserves unrelated errors", async () => {
  const original = new ConflictException({ code: "SOME_OTHER_CONFLICT" });
  const results = { present: async (_user: any, _runId: string, payload: any) => payload, recoverCompletedLegacy: async () => null } as any;
  const interceptor = new SoloEndingResultInterceptor(results);
  const context = { switchToHttp: () => ({ getRequest: () => ({ method: "GET", originalUrl: "/api/v4/rooms/solo-run-1/result", params: { roomId: "solo-run-1" }, user }) }) } as any;
  await assert.rejects(lastValueFrom(interceptor.intercept(context, { handle: () => throwError(() => original) } as any)), (error: unknown) => error === original);
});
