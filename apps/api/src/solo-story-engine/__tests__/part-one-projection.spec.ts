import assert from "node:assert/strict";
import test from "node:test";
import { buildSoloStoryProjection } from "../solo-story-projection";

function project(executionMode: string, progress = "NOT_STARTED") {
  return buildSoloStoryProjection({
    run: {
      id: "solo_projection_test",
      title: "桑田诏",
      templateKey: "sangtian",
      status: "active",
      ownerUserId: "user-1",
      worldSequence: 1,
      currentDay: 1,
      stateJson: {
        partOne: {
          partId: "PART-01",
          reform: { executionMode, progress }
        }
      }
    },
    player: { userId: "user-1" },
    role: {
      id: "role-1",
      roleKey: "zhejiang_governor",
      roleName: "浙江总督",
      identity: "统筹浙江军政的封疆大吏",
      personalGoal: "稳住浙江"
    },
    control: { mode: "HUMAN_ACTIVE", epoch: 1 },
    thread: null,
    turn: null,
    decisionSet: null,
    narratives: [],
    facts: [],
    assets: [],
    creditControl: {} as any
  });
}

function reformProgress(projection: ReturnType<typeof project>) {
  assert.ok(projection.world);
  return projection.world.presentation.statusMetrics.find((metric) => metric.key === "reform_progress")?.value;
}

test("Part One visible reform progress starts at zero and follows the deterministic execution state", () => {
  assert.equal(reformProgress(project("UNKNOWN")), 0);
  assert.equal(reformProgress(project("TEMPORARILY_PAUSED")), 0);
  assert.equal(reformProgress(project("LIMITED_TRIAL")), 10);
  assert.equal(reformProgress(project("PROVISIONAL_RELEASE")), 20);
  assert.equal(reformProgress(project("UNKNOWN", "STARTED")), 20);
});

test("T20 exposes a read-only Part Two handoff decision set without opening T21", () => {
  const candidate = (id: string, label: string) => ({
    id,
    actionKey: null,
    label,
    description: `${label}的具体做法`,
    intent: `${label}的具体做法`,
    targetRoleId: null,
    targetRoleName: null,
    risk: "NORMAL",
    basisFactKeys: ["part-one-handoff"],
    requiredAssetKeys: [],
    authorityBasis: "总督职权",
    intendedOutcome: `${label}的具体做法`,
    concreteCost: `${label}的直接代价`,
    expectedCountermove: `${label}引起的对方反制`,
    visibility: "PRIVATE",
    effectHooks: ["partTwoHandoffPreview:readonly"],
    intentDraft: {
      objective: `${label}的具体做法`,
      target: { type: "PUBLIC_FRAME", id: "public_frame", label: "第二部分入口局势" },
      method: `${label}的具体做法`,
      leverageKeys: [],
      visibility: "PRIVATE",
      riskTolerance: "MEDIUM",
      fallback: null,
      condition: null
    }
  });
  const projection = buildSoloStoryProjection({
    run: {
      id: "solo_projection_t20",
      title: "桑田诏",
      templateKey: "sangtian",
      status: "chapter_generated",
      ownerUserId: "user-1",
      worldSequence: 21,
      currentDay: 20,
      stateJson: {
        partOne: { partId: "PART-01", reform: { executionMode: "LIMITED_TRIAL", progress: "STARTED" } },
        soloStory: {
          terminalHandoff: {
            title: "第一部分收束：急令与暗册",
            framing: "如果继续，你先处理什么？",
            narrative: "第一部分已经收束，第二部分仍有真实未决问题。",
            decisions: [candidate("grain", "先查粮路"), candidate("land", "先查卖田")]
          }
        }
      }
    },
    player: { userId: "user-1" },
    role: {
      id: "role-1",
      roleKey: "zhejiang_governor",
      roleName: "浙江总督",
      identity: "统筹浙江军政的封疆大吏",
      personalGoal: "稳住浙江"
    },
    control: { mode: "HUMAN_ACTIVE", epoch: 1 },
    thread: { status: "COMPLETED", currentStageIndex: 20 },
    turn: {
      id: "turn-20",
      revision: 1,
      stageIndex: 20,
      turnIndex: 20,
      baseWorldSequence: 20,
      status: "RESOLVED",
      situationTitle: "旧的 T20 入站局势",
      situationNarrative: "旧的 T20 入站决策不能冒充下一部分入口。",
      visibleFactKeysJson: [],
      contextJson: {}
    },
    decisionSet: { framing: "旧选择", candidatesJson: [candidate("old-a", "旧选择 A"), candidate("old-b", "旧选择 B")] },
    narratives: [],
    facts: [],
    assets: [],
    creditControl: {} as any
  });
  assert.equal(projection.completed, true);
  assert.equal(projection.currentTurn?.status, "COMPLETED");
  assert.equal(projection.currentTurn?.title, "第一部分收束：急令与暗册");
  assert.equal(projection.currentTurn?.narrative, "第一部分已经收束，第二部分仍有真实未决问题。");
  assert.deepEqual(projection.currentTurn?.decisions.map((item) => item.label), ["先查粮路", "先查卖田"]);
  assert.equal(projection.currentTurn?.actionAvailability?.storyChoice.state, "LOCKED");
});
