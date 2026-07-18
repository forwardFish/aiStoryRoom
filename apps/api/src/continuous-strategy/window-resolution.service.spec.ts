import assert from "node:assert/strict";
import {
  buildFinalPersonalEndingNarrative,
  buildFinalPublicEndingNarrative,
  endingEvidenceTitles,
  freeRoundsUsedAfterStage,
  WindowResolutionService
} from "./window-resolution.service";

type FaultResult = {
  checkpointKey: string;
  checkpointOrdinal?: number;
  runId: string;
  windowId: string;
  stageIndex: number;
  createdCheckpoint: boolean;
};

const service = Object.create(WindowResolutionService.prototype) as WindowResolutionService;
const invoke = (result: FaultResult) => (service as any).maybeFailAfterCheckpoint(result);

const prior = {
  NODE_ENV: process.env.NODE_ENV,
  STORY_WORKER_PROCESS: process.env.STORY_WORKER_PROCESS,
  FAIL_AFTER_CHECKPOINT: process.env.FAIL_AFTER_CHECKPOINT,
  FAIL_AFTER_CHECKPOINT_RUN_ID: process.env.FAIL_AFTER_CHECKPOINT_RUN_ID,
  FAIL_AFTER_CHECKPOINT_WINDOW_ID: process.env.FAIL_AFTER_CHECKPOINT_WINDOW_ID,
  FAIL_AFTER_CHECKPOINT_STAGE: process.env.FAIL_AFTER_CHECKPOINT_STAGE
};

try {
  process.env.NODE_ENV = "test";
  process.env.STORY_WORKER_PROCESS = "true";
  process.env.FAIL_AFTER_CHECKPOINT = "RULES_APPLIED";
  process.env.FAIL_AFTER_CHECKPOINT_RUN_ID = "run-target";
  process.env.FAIL_AFTER_CHECKPOINT_STAGE = "3";

  assert.doesNotThrow(() => invoke({
    checkpointKey: "RULES_APPLIED",
    runId: "run-other",
    windowId: "window-other",
    stageIndex: 3,
    createdCheckpoint: true
  }), "a fault profile must not affect another run");

  assert.throws(() => invoke({
    checkpointKey: "RULES_APPLIED",
    runId: "run-target",
    windowId: "window-target",
    stageIndex: 3,
    createdCheckpoint: true
  }), (error: any) => error?.code === "INJECTED_CHECKPOINT_EXIT" && error?.exitCode === 86);

  process.env.FAIL_AFTER_CHECKPOINT = "ROLE_PROJECTED:2";
  assert.doesNotThrow(() => invoke({
    checkpointKey: "ROLE_PROJECTED:role-a",
    checkpointOrdinal: 1,
    runId: "run-target",
    windowId: "window-target",
    stageIndex: 3,
    createdCheckpoint: true
  }));
  assert.throws(() => invoke({
    checkpointKey: "ROLE_PROJECTED:role-b",
    checkpointOrdinal: 2,
    runId: "run-target",
    windowId: "window-target",
    stageIndex: 3,
    createdCheckpoint: true
  }), (error: any) => error?.code === "INJECTED_CHECKPOINT_EXIT");

  assert.doesNotThrow(() => invoke({
    checkpointKey: "ROLE_PROJECTED:role-b",
    checkpointOrdinal: 2,
    runId: "run-target",
    windowId: "window-target",
    stageIndex: 3,
    createdCheckpoint: false
  }), "replaying an existing checkpoint must not inject a second exit");

  const actions = [
    { roleId: "role-a", stageIndex: 1, actionSlot: "MAIN", method: "封存证据并交叉核验" },
    { roleId: "role-b", stageIndex: 4, actionSlot: "MAIN", method: "推进本职方案并说明代价" },
    { roleId: "role-c", stageIndex: 7, actionSlot: "MAIN", method: "御前保全证据来源" },
    { roleId: "role-a", stageIndex: 7, actionSlot: "MANEUVER", method: "maneuver_s7_internal_key" }
  ];
  const publicEnding = buildFinalPublicEndingNarrative(
    "以问责个人封住危局",
    7,
    [{ id: "role-a" }, { id: "role-b" }, { id: "role-c" }],
    actions
  );
  const personalEnding = buildFinalPersonalEndingNarrative(
    "统筹有功但担责",
    7,
    actions.filter((action) => action.roleId === "role-a")
  );
  assert.match(publicEnding, /封存证据并交叉核验/);
  assert.match(publicEnding, /第 1 轮“封存证据并交叉核验”/);
  assert.match(publicEnding, /第 7 轮“御前保全证据来源”/);
  assert.match(publicEnding, /推进本职方案并说明代价/);
  assert.match(publicEnding, /御前保全证据来源/);
  assert.match(personalEnding, /封存证据并交叉核验/);
  assert.match(personalEnding, /第 1 轮“封存证据并交叉核验”/);
  assert.doesNotMatch(publicEnding, /\b(?:global|personal|state|asset|internal|main|maneuver|reaction|system)_[a-z0-9_]+\b/i);
  assert.doesNotMatch(personalEnding, /\b(?:global|personal|state|asset|internal|main|maneuver|reaction|system)_[a-z0-9_]+\b/i);
  assert.deepEqual(endingEvidenceTitles(actions, 4), [
    "封存证据并交叉核验",
    "推进本职方案并说明代价",
    "御前保全证据来源"
  ]);
  assert.equal(freeRoundsUsedAfterStage(0, 1, 3), 1);
  assert.equal(freeRoundsUsedAfterStage(1, 2, 3), 2);
  assert.equal(freeRoundsUsedAfterStage(2, 3, 3), 3);
  assert.equal(freeRoundsUsedAfterStage(3, 4, 3), 3);
  assert.equal(freeRoundsUsedAfterStage(3, 7, 3), 3);
  assert.equal(freeRoundsUsedAfterStage(3, 2, 3), 3, "replay must never move the free-round ledger backwards");

  console.log("window-resolution targeted fault injection contracts: PASS");
} finally {
  for (const [key, value] of Object.entries(prior)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}
