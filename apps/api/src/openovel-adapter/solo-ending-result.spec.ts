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
const cause = (turn: number, direction: "HELPED" | "HURT" | "DECISIVE", text = `事实 ${turn}`) => ({
  sourceTurnId: `T${String(turn).padStart(2, "0")}`,
  sourceRevision: turn,
  sourceEventId: `event-${turn}`,
  authority: "PREDICATE",
  committed: true,
  authorized: true,
  visibility: "PLAYER",
  criterion: `CRITERION_${turn}`,
  actionTitle: `选择 ${turn}`,
  factText: text,
  direction,
});
function ending(overrides: Record<string, unknown> = {}) {
  const value: any = {
    schemaVersion: "openovel_ending_v1",
    scope: "PART",
    endingKey: "guarded_people_bore_responsibility",
    title: "守土担责",
    finalSceneNarrative: "驿骑带着首报离开杭州。",
    protagonistFate: "问责落到了总督自己名下。",
    aftermath: ["第一部分之后仍有未决问题。"],
    sourceTurnId: "T20",
    sourceRevision: 20,
    ...overrides,
  };
  if (!("playerEvidence" in overrides)) value.playerEvidence = {
    schemaVersion: "openovel_player_ending_evidence_v1",
    endingKey: value.endingKey,
    scope: value.scope,
    sourceTurnId: value.sourceTurnId,
    sourceRevision: value.sourceRevision,
    causes: [cause(20, "DECISIVE", "总督本人已进入明确问责范围。")],
    reveal: null,
  };
  return value;
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
    players: [{ userId: user.id, role: { roleKey: "zhejiang_governor", roleName: "浙江总督", personalGoal: "稳住浙江。" } }],
    ...overrides,
  };
}
function action(id: string, turn: number, overrides: Partial<SoloResultActionRecord> = {}): SoloResultActionRecord {
  return {
    id,
    runId: "solo-run-1",
    userId: user.id,
    status: "resolved",
    method: `行动 ${turn}`,
    immediateJson: { boundOption: { label: `选择 ${turn}` } },
    resolvedJson: {
      turnId: `T${String(turn).padStart(2, "0")}`,
      turnNumber: turn,
      narration: "文学正文不能作为原因。",
      causalDelta: {
        requiredNarrativeFacts: ["旧字段不能作为原因"],
        durableHints: [{ note: "内部 note", presentThisTurn: false }],
        scenePacket: { visibleFacts: ["旧投影不能自动授权"] },
      },
    },
    resolvedAt: new Date("2026-08-09T00:00:00.000Z"),
    createdAt: new Date("2026-08-09T00:00:00.000Z"),
    ...overrides,
  };
}
const raw = (overrides: Record<string, unknown> = {}): RawOpenNovelResult => ({
  room: { id: "solo-run-1", title: "桑田诏", worldId: "sangtian" },
  player: { roleName: "浙江总督" },
  ending: ending(overrides),
  completedNodes: 20,
});
const runtime = (overrides: Record<string, unknown> = {}) => ({
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
});

test("explicit evidence order and structured directions win over recency", () => {
  const source = ending();
  source.playerEvidence.causes = [cause(20, "DECISIVE"), cause(1, "HELPED"), cause(3, "HURT")];
  const result = compileOpenNovelResultV2({
    raw: raw({ playerEvidence: source.playerEvidence }), run: run(), viewerUserId: user.id,
    actions: [action("a01", 1), action("a03", 3), action("a20", 20)],
  });
  assert.deepEqual(result.presentation.causes.map((item) => item.sourceActionId), ["a20", "a01", "a03"]);
  assert.deepEqual(result.presentation.causes.map((item) => item.direction), ["DECISIVE", "HELPED", "HURT"]);
});

test("other viewers, unresolved drafts, wrong runs and ambiguous turns are filtered", () => {
  const source = ending();
  source.playerEvidence.causes = [cause(3, "HELPED")];
  const output = extractCommittedSoloEndingEvidence({
    actions: [
      action("other", 3, { userId: "user-2" }),
      action("pending", 3, { status: "generating" }),
      action("mine", 3),
      action("wrong-run", 3, { runId: "solo-run-2" }),
    ],
    runId: "solo-run-1", viewerUserId: user.id, roleName: "浙江总督", ending: source,
  });
  assert.deepEqual(output.map((item) => item.sourceActionId), ["mine"]);
});

test("no envelope or zero authorized causes never falls back to prose or causalDelta", () => {
  const without = raw({ playerEvidence: undefined });
  assert.deepEqual(extractCommittedSoloEndingEvidence({
    actions: [action("a20", 20)], runId: "solo-run-1", viewerUserId: user.id,
    roleName: "浙江总督", ending: without.ending,
  }), []);
  assert.throws(() => compileOpenNovelResultV2({ raw: without, run: run(), viewerUserId: user.id, actions: [action("a20", 20)] }), /AUTHORITATIVE_CAUSES_MISSING/);

  const invalid = ending();
  invalid.playerEvidence.causes = [cause(20, "DECISIVE")];
  invalid.playerEvidence.causes[0].authorized = false;
  assert.throws(() => compileOpenNovelResultV2({ raw: raw({ playerEvidence: invalid.playerEvidence }), run: run(), viewerUserId: user.id, actions: [action("a20", 20)] }), /AUTHORITATIVE_CAUSES_MISSING/);
});

test("unapproved reveal is null and repeated reads are deterministic", () => {
  const first = compileOpenNovelResultV2({ raw: raw(), run: run(), viewerUserId: user.id, actions: [action("a20", 20)] });
  const second = compileOpenNovelResultV2({ raw: raw(), run: run(), viewerUserId: user.id, actions: [action("a20", 20)] });
  assert.equal(first.presentation.reveal, null);
  assert.deepEqual(first, second);
});

test("T19, wrong revision, illegal scope and viewer mismatch fail closed", () => {
  for (const overrides of [
    { sourceTurnId: "T19", sourceRevision: 19, playerEvidence: null },
    { sourceRevision: 19, playerEvidence: null },
    { scope: "STORY", playerEvidence: null },
  ]) assert.throws(() => compileOpenNovelResultV2({ raw: raw(overrides), run: run(), viewerUserId: user.id, actions: [action("a20", 20)] }), /SOLO_RESULT_NOT_READY/);
  assert.throws(() => compileOpenNovelResultV2({ raw: { ...raw(), room: { id: "wrong" } }, run: run(), viewerUserId: user.id, actions: [action("a20", 20)] }), /SOLO_RESULT_RUN_MISMATCH/);
  assert.throws(() => compileLegacyOpenNovelResult({ run: run(), viewerUserId: "user-2", completedNodes: 20 }), /SOLO_RESULT_VIEWER_FORBIDDEN/);
});

test("historical completed run missing Ending remains LEGACY_ENDING", () => {
  const result = compileLegacyOpenNovelResult({ run: run(), viewerUserId: user.id, completedNodes: 20, ending: null });
  assert.equal(result.presentation.resultType, "LEGACY_ENDING");
  assert.equal(result.presentation.verdict, "UNAVAILABLE");
});

test("service checks membership before runtime and publishes only authoritative completion", async () => {
  let reads = 0;
  const denied = new SoloEndingResultService({ storyRun: { findUnique: async () => run({ ownerUserId: "user-2", players: [] }) } } as any, { getRun: async () => { reads += 1; return runtime(); } } as any);
  await assert.rejects(denied.present(user, "solo-run-1", raw()), (error: any) => error?.getResponse?.().code === "OPENOVEL_RUN_ACCESS_DENIED");
  assert.equal(reads, 0);

  const service = new SoloEndingResultService({
    storyRun: { findUnique: async () => run() },
    playerAction: { findMany: async () => [action("a20", 20)] },
  } as any, { getRun: async () => { reads += 1; return runtime(); } } as any);
  const result = await service.present(user, "solo-run-1", raw()) as any;
  assert.equal(result.presentation.schemaVersion, "endgame_presentation_v1");
  assert.equal(reads, 1);
});

test("service rejects non-COMPLETED, active options and ending identity mismatch", async () => {
  const prisma = { storyRun: { findUnique: async () => run() }, playerAction: { findMany: async () => [action("a20", 20)] } } as any;
  for (const value of [
    runtime({ status: "READY" }), runtime({ turnNumber: 19 }), runtime({ options: [{ id: "x", label: "still active" }] }),
    runtime({ ending: ending({ endingKey: "crisis_unresolved", playerEvidence: null }) }),
  ]) {
    const service = new SoloEndingResultService(prisma, { getRun: async () => value } as any);
    await assert.rejects(service.present(user, "solo-run-1", raw()), (error: any) => error?.getResponse?.().code === "RESULT_NOT_READY");
  }
});

test("legacy recovery is limited to completed OpenNovel runs with missing Ending", async () => {
  const service = new SoloEndingResultService({ storyRun: { findUnique: async () => run() } } as any, { getRun: async () => runtime({ ending: null }) } as any);
  assert.equal(await service.recoverCompletedLegacy(user, "solo-run-1", new Error("other")), null);
  const recovered = await service.recoverCompletedLegacy(user, "solo-run-1", new ConflictException({ code: "RESULT_NOT_READY" })) as any;
  assert.equal(recovered.presentation.resultType, "LEGACY_ENDING");
});

test("private evidence is stripped from direct projections and SSE", () => {
  const payload = { runId: "solo-run-1", ending: ending() };
  const projected = stripPrivateSoloEndingEvidence(payload) as any;
  assert.equal(projected.ending.playerEvidence, undefined);
  const event = stripPrivateSoloEndingEvidenceFromEvent({ type: "turn.committed", data: payload }) as any;
  assert.equal(event.data.ending.playerEvidence, undefined);
  assert.deepEqual(stripPrivateSoloEndingEvidenceFromEvent(event), event);
});

test("interceptor transforms only result route and preserves unrelated errors", async () => {
  const calls: string[] = [];
  const results = {
    present: async (_user: any, runId: string, payload: any) => { calls.push(runId); return { ...payload, presentation: { schemaVersion: "endgame_presentation_v1" } }; },
    recoverCompletedLegacy: async () => null,
  } as any;
  const request = { method: "GET", originalUrl: "/api/v4/rooms/solo-run-1/result", params: { roomId: "solo-run-1" }, user };
  const interceptor = new SoloEndingResultInterceptor(results);
  const context = { switchToHttp: () => ({ getRequest: () => request }) } as any;
  const output = await lastValueFrom(interceptor.intercept(context, { handle: () => of(raw()) } as any)) as any;
  assert.equal(output.presentation.schemaVersion, "endgame_presentation_v1");
  assert.deepEqual(calls, ["solo-run-1"]);

  const original = new ConflictException({ code: "OTHER" });
  await assert.rejects(lastValueFrom(interceptor.intercept(context, { handle: () => throwError(() => original) } as any)), (error: unknown) => error === original);
});
