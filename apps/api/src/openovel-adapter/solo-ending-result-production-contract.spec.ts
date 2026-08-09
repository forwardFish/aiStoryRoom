import assert from "node:assert/strict";
import test from "node:test";
import {
  compileOpenNovelResultV2,
  extractCommittedSoloEndingEvidence,
  type RawOpenNovelResult,
  type SoloResultActionRecord,
  type SoloResultRunRecord,
} from "./solo-ending-result";

const ending = {
  schemaVersion: "openovel_ending_v1" as const,
  scope: "PART" as const,
  endingKey: "guarded_people_bore_responsibility",
  title: "守土担责",
  finalSceneNarrative: "驿骑带着首报离开杭州。",
  protagonistFate: "问责落到了总督自己名下。",
  aftermath: ["证据链仍可追索。", "粮路代价仍待处理。"],
  sourceTurnId: "T20",
  sourceRevision: 20,
};

const run: SoloResultRunRecord = {
  id: "run-1",
  ownerUserId: "user-1",
  templateKey: "sangtian",
  engineVersion: "openovel_v1",
  selectedRoleKey: "zhejiang_governor",
  updatedAt: "2026-08-09T00:00:00.000Z",
  players: [{
    userId: "user-1",
    role: {
      roleKey: "zhejiang_governor",
      roleName: "浙江总督",
      personalGoal: "稳住浙江。",
    },
  }],
};

function action(
  id: string,
  turnNumber: number,
  overrides: Partial<SoloResultActionRecord> & { causalDelta?: unknown } = {},
): SoloResultActionRecord {
  const { causalDelta, ...recordOverrides } = overrides;
  return {
    id,
    runId: "run-1",
    userId: "user-1",
    status: "resolved",
    method: `行动 ${turnNumber}`,
    immediateJson: { boundOption: { label: `选择 ${turnNumber}` } },
    resolvedJson: {
      turnId: `T${String(turnNumber).padStart(2, "0")}`,
      turnNumber,
      narration: "你赢了，并看见了一段不应被原因投影读取的小说正文。",
      ...(causalDelta ? { causalDelta } : {}),
    },
    resolvedAt: "2026-08-09T00:00:00.000Z",
    createdAt: "2026-08-09T00:00:00.000Z",
    ...recordOverrides,
  };
}

test("production-sanitized resolved actions remain real causes without narration parsing", () => {
  const causes = extractCommittedSoloEndingEvidence({
    actions: [action("action-1", 1)],
    runId: run.id,
    viewerUserId: "user-1",
    roleName: "浙江总督",
  });
  assert.equal(causes.length, 1);
  assert.match(causes[0].factText, /权威结算提交/);
  assert.doesNotMatch(causes[0].factText, /你赢了|小说正文/);
});

test("structured safe evidence is preferred and another run cannot contaminate causes", () => {
  const causes = extractCommittedSoloEndingEvidence({
    actions: [
      action("action-1", 1, {
        causalDelta: {
          readerAction: "设立复核程序",
          requiredNarrativeFacts: ["复核程序已经进入权威状态。"],
          durableHints: [],
          scenePacket: { visibleFacts: [] },
        },
      }),
      action("other-run", 20, { runId: "run-2" }),
    ],
    runId: run.id,
    viewerUserId: "user-1",
    roleName: "浙江总督",
  });
  assert.deepEqual(causes.map((cause) => cause.sourceActionId), ["action-1"]);
  assert.equal(causes[0].factText, "复核程序已经进入权威状态。");
});

test("cause selection caps at three while retaining the final submitted action", () => {
  const causes = extractCommittedSoloEndingEvidence({
    actions: [action("a01", 1), action("a02", 2), action("a03", 3), action("a20", 20)],
    runId: run.id,
    viewerUserId: "user-1",
    roleName: "浙江总督",
  });
  assert.equal(causes.length, 3);
  assert.ok(causes.some((cause) => cause.sourceActionId === "a20"));
});

test("compiled result exposes authorized Part aftermath without inventing a secret", () => {
  const raw: RawOpenNovelResult = {
    room: { id: run.id },
    ending,
    completedNodes: 20,
  };
  const result = compileOpenNovelResultV2({
    raw,
    run,
    viewerUserId: "user-1",
    actions: [action("a20", 20)],
  });
  assert.equal(result.presentation.resultType, "SOLO_PART_END");
  assert.equal(result.presentation.causes.length, 1);
  assert.equal(result.presentation.reveal?.title, "第一部分之后");
  assert.match(result.presentation.reveal?.text || "", /证据链仍可追索/);
});
