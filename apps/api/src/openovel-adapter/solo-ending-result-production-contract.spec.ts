import assert from "node:assert/strict";
import test from "node:test";
import {
  compileOpenNovelResultV2,
  extractCommittedSoloEndingEvidence,
  type RawOpenNovelResult,
  type SoloResultActionRecord,
  type SoloResultRunRecord,
} from "./solo-ending-result";

const ROLE_ID = "role-governor";
const run: SoloResultRunRecord = {
  id: "run-1",
  ownerUserId: "user-1",
  templateKey: "sangtian",
  engineVersion: "openovel_v1",
  selectedRoleKey: "zhejiang_governor",
  status: "chapter_generated",
  updatedAt: "2026-08-09T00:00:00.000Z",
  players: [{
    userId: "user-1",
    role: {
      id: ROLE_ID,
      roleKey: "zhejiang_governor",
      roleName: "浙江总督",
      personalGoal: "稳住浙江。",
    },
  }],
};

function cause(turnNumber: number, factText: string, direction = "HELPED") {
  return {
    sourceTurnId: `T${String(turnNumber).padStart(2, "0")}`,
    sourceRevision: turnNumber,
    sourceEventId: `event-${turnNumber}`,
    authority: "PREDICATE",
    visibility: "PLAYER",
    criterion: `CRITERION_${turnNumber}`,
    factText,
    direction,
  };
}

function ending(causes: unknown[], reveal: unknown = null) {
  return {
    schemaVersion: "openovel_ending_v1" as const,
    scope: "PART" as const,
    endingKey: "guarded_people_bore_responsibility",
    title: "守土担责",
    finalSceneNarrative: "驿骑带着首报离开杭州。",
    protagonistFate: "问责落到了总督自己名下。",
    aftermath: ["这段公开余波不自动获得 reveal 权限。"],
    sourceTurnId: "T20",
    sourceRevision: 20,
    playerEvidence: {
      schemaVersion: "openovel_player_ending_evidence_v1",
      endingKey: "guarded_people_bore_responsibility",
      scope: "PART",
      sourceTurnId: "T20",
      sourceRevision: 20,
      causes,
      reveal,
    },
  } as any;
}

function action(
  id: string,
  turnNumber: number,
  overrides: Partial<SoloResultActionRecord> = {},
): SoloResultActionRecord {
  return {
    id,
    runId: "run-1",
    userId: "user-1",
    roleId: ROLE_ID,
    status: "resolved",
    method: `行动 ${turnNumber}`,
    immediateJson: { boundOption: { label: `选择 ${turnNumber}` } },
    resolvedJson: {
      turnId: `T${String(turnNumber).padStart(2, "0")}`,
      turnNumber,
      narration: "你赢了，并看见了一段不得被原因投影读取的小说正文。",
      causalDelta: {
        requiredNarrativeFacts: ["未获授权的旧字段"],
        durableHints: [{ note: "内部 note", presentThisTurn: false }],
        scenePacket: { visibleFacts: ["未获授权的旧投影"] },
      },
    },
    resolvedAt: "2026-08-09T00:00:00.000Z",
    createdAt: "2026-08-09T00:00:00.000Z",
    ...overrides,
  };
}

function evidence(endingValue: any, actions: SoloResultActionRecord[]) {
  return extractCommittedSoloEndingEvidence({
    actions,
    runId: run.id,
    viewerUserId: "user-1",
    viewerRoleId: ROLE_ID,
    roleName: "浙江总督",
    ending: endingValue,
  });
}

test("production-sanitized action without explicit ending evidence is not a cause", () => {
  const withoutEvidence = { ...ending([]), playerEvidence: undefined } as any;
  assert.deepEqual(evidence(withoutEvidence, [action("action-1", 1)]), []);
});

test("only server-produced evidence linked to committed role-bound turns becomes a cause", () => {
  const causes = evidence(
    ending([cause(1, "复核程序已经进入权威状态。", "HELPED")]),
    [action("action-1", 1), action("other-run", 20, { runId: "run-2" })],
  );
  assert.deepEqual(causes.map((item) => item.sourceActionId), ["action-1"]);
  assert.equal(causes[0]?.factText, "复核程序已经进入权威状态。");
  assert.doesNotMatch(causes[0]?.factText || "", /小说正文|内部 note|旧字段/);
});

test("valid evidence for a different role is not authorized", () => {
  const causes = evidence(
    ending([cause(20, "角色私有事实。", "DECISIVE")]),
    [action("a20", 20, { roleId: "role-other" })],
  );
  assert.deepEqual(causes, []);
});

test("cause selection never uses recency or action count as a score", () => {
  const causes = evidence(
    ending([
      cause(2, "第二回合建立的事实。", "HURT"),
      cause(1, "第一回合建立的事实。", "HELPED"),
      cause(20, "最终回合建立的事实。", "DECISIVE"),
    ]),
    [action("a01", 1), action("a02", 2), action("a03", 3), action("a20", 20)],
  );
  assert.deepEqual(causes.map((item) => item.sourceActionId), ["a02", "a01", "a20"]);
  assert.deepEqual(causes.map((item) => item.direction), ["HURT", "HELPED", "DECISIVE"]);
});

test("zero verified causes blocks result readiness", () => {
  const raw: RawOpenNovelResult = {
    room: { id: run.id },
    ending: ending([]),
    completedNodes: 20,
  };
  assert.throws(() => compileOpenNovelResultV2({
    raw,
    run,
    viewerUserId: "user-1",
    actions: [action("a20", 20)],
  }), /AUTHORITATIVE_CAUSES_MISSING/);
});

test("aftermath is not a reveal and explicit role-authorized reveal is allowed", () => {
  const withoutReveal = compileOpenNovelResultV2({
    raw: { room: { id: run.id }, ending: ending([cause(20, "问责已提交。", "DECISIVE")]), completedNodes: 20 },
    run,
    viewerUserId: "user-1",
    actions: [action("a20", 20)],
  });
  assert.equal(withoutReveal.presentation.reveal, null);

  const reveal = {
    sourceTurnId: "T20",
    sourceRevision: 20,
    sourceEventId: "event-20",
    authority: "CAUSAL_EVENT",
    visibility: "PLAYER",
    title: "第一部分之后",
    text: "京师对责任链的处理仍要进入后续部分。",
  };
  const withReveal = compileOpenNovelResultV2({
    raw: {
      room: { id: run.id },
      ending: ending([cause(20, "问责已提交。", "DECISIVE")], reveal),
      completedNodes: 20,
    },
    run,
    viewerUserId: "user-1",
    actions: [action("a20", 20)],
  });
  assert.equal(withReveal.presentation.reveal?.title, "第一部分之后");
});

test("invalid reveal visibility is null without invalidating verified causes", () => {
  const invalidReveal = {
    sourceTurnId: "T20",
    sourceRevision: 20,
    sourceEventId: "event-20",
    authority: "CAUSAL_EVENT",
    visibility: "INTERNAL",
    title: "内部答案",
    text: "不得显示",
  };
  const result = compileOpenNovelResultV2({
    raw: {
      room: { id: run.id },
      ending: ending([cause(20, "问责已提交。", "DECISIVE")], invalidReveal),
      completedNodes: 20,
    },
    run,
    viewerUserId: "user-1",
    actions: [action("a20", 20)],
  });
  assert.equal(result.presentation.reveal, null);
  assert.equal(result.presentation.causes.length, 1);
});

test("failed actions fail closed and an envelope actionTitle field cannot override the committed action", () => {
  const sourceEnding = ending([cause(20, "问责已提交。", "DECISIVE")]);
  assert.deepEqual(evidence(sourceEnding, [action("a20", 20, { status: "failed" })]), []);
  sourceEnding.playerEvidence.causes[0].actionTitle = "不能覆盖数据库里的行动标题";
  const projected = evidence(sourceEnding, [action("a20", 20)]);
  assert.equal(projected[0]?.actionTitle, "选择 20");
});
