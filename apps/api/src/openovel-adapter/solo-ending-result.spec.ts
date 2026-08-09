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

const authoritativeEnding = {
  schemaVersion: "openovel_ending_v1" as const,
  scope: "PART" as const,
  endingKey: "guarded_people_bore_responsibility",
  title: "守土担责",
  finalSceneNarrative: "驿骑带着首报离开杭州。",
  protagonistFate: "问责落到了总督自己名下。",
  aftermath: [],
  sourceTurnId: "T20",
  sourceRevision: 20,
};

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
  factText: string,
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
      narration: "这段文学正文不得被当成结构化事实。",
      causalDelta: {
        readerAction: `行动 ${turnNumber}`,
        requiredNarrativeFacts: factText ? [factText] : [],
        durableHints: [],
        scenePacket: { visibleFacts: [] },
      },
    },
    resolvedAt: new Date("2026-08-09T00:00:00.000Z"),
    createdAt: new Date("2026-08-09T00:00:00.000Z"),
    ...overrides,
  };
}

function raw(): RawOpenNovelResult {
  return {
    room: { id: "solo-run-1", title: "桑田诏", worldId: "sangtian" },
    player: { roleName: "浙江总督" },
    ending: authoritativeEnding,
    completedNodes: 20,
  };
}

test("Result compiler projects only committed structured causes", () => {
  const result = compileOpenNovelResultV2({
    raw: raw(),
    run: run(),
    viewerUserId: user.id,
    actions: [
      action("a01", 1, "复核程序已经写入权威状态。"),
      action("a20", 20, "首份奏报已经离开浙江。"),
    ],
  });
  assert.equal(result.schemaVersion, "openovel_result_v2");
  assert.equal(result.presentation.resultType, "SOLO_PART_END");
  assert.deepEqual(result.presentation.causes.map((cause) => cause.sourceActionId), ["a20", "a01"]);
  assert.equal(result.presentation.causes[0]?.direction, "DECISIVE");
});

test("Result compiler never falls back to narration for a cause", () => {
  const causes = extractCommittedSoloEndingEvidence({
    actions: [action("a01", 1, "")],
    viewerUserId: user.id,
    roleName: "浙江总督",
    endingKey: authoritativeEnding.endingKey,
  });
  assert.deepEqual(causes, []);
});

test("Result compiler filters other viewers and unresolved actions", () => {
  const causes = extractCommittedSoloEndingEvidence({
    actions: [
      action("other", 1, "他人的事实", { userId: "user-2" }),
      action("pending", 2, "未提交事实", { status: "generating" }),
      action("mine", 3, "我的已提交事实"),
    ],
    viewerUserId: user.id,
    roleName: "浙江总督",
    endingKey: authoritativeEnding.endingKey,
  });
  assert.deepEqual(causes.map((cause) => cause.sourceActionId), ["mine"]);
});

test("Result compiler is deterministic across refresh and restart reads", () => {
  const input = {
    raw: raw(),
    run: run(),
    viewerUserId: user.id,
    actions: [action("a01", 1, "复核已成立")],
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
    actions: [],
  }), /SOLO_RESULT_RUN_MISMATCH/);
  assert.throws(() => compileLegacyOpenNovelResult({
    run: run(),
    viewerUserId: "user-2",
    completedNodes: 20,
  }), /SOLO_RESULT_VIEWER_FORBIDDEN/);
});

test("Result service appends presentation without calling the runtime or a model", async () => {
  let runtimeReads = 0;
  const prisma = {
    storyRun: { findUnique: async () => run() },
    playerAction: { findMany: async () => [action("a20", 20, "奏报已发出")] },
  } as any;
  const runtime = { getRun: async () => { runtimeReads += 1; return null; } } as any;
  const service = new SoloEndingResultService(prisma, runtime);
  const result = await service.present(user, "solo-run-1", raw()) as any;
  assert.equal(result.presentation.schemaVersion, "endgame_presentation_v1");
  assert.equal(runtimeReads, 0);
});

test("Result service does not transform non-OpenNovel results", async () => {
  const payload = { schemaVersion: "continuous_story_result_v2" };
  const service = new SoloEndingResultService({} as any, {} as any);
  assert.equal(await service.present(user, "room-1", payload), payload);
});

test("historical recovery is limited to completed OpenNovel RESULT_NOT_READY", async () => {
  const prisma = {
    storyRun: { findUnique: async () => run() },
    playerAction: { findMany: async () => [] },
  } as any;
  const runtime = {
    getRun: async () => ({
      runId: "solo-run-1",
      worldId: "sangtian",
      roleId: "zhejiang_governor",
      runtimeMode: "OPENOVEL_V1",
      turnNumber: 20,
      status: "COMPLETED",
      canon: "",
      recentCanon: "",
      ending: null,
      options: [],
      updatedAt: "2026-08-09T00:00:00.000Z",
    }),
  } as any;
  const service = new SoloEndingResultService(prisma, runtime);
  assert.equal(await service.recoverCompletedLegacy(user, "solo-run-1", new Error("other")), null);
  const recovered = await service.recoverCompletedLegacy(
    user,
    "solo-run-1",
    new ConflictException({ code: "RESULT_NOT_READY" }),
  ) as any;
  assert.equal(recovered.presentation.resultType, "LEGACY_ENDING");
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
