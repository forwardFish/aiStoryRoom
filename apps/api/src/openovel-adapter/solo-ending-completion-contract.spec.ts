import assert from "node:assert/strict";
import test from "node:test";
import { SoloEndingResultService } from "./solo-ending-result.service";
import {
  compileOpenNovelResultV2,
  type RawOpenNovelResult,
  type SoloResultActionRecord,
  type SoloResultRunRecord,
} from "./solo-ending-result";
import { resolveSoloEndingCompletionContract } from "./solo-ending-presentation";

const USER_ID = "user-1";
const ROLE_ID = "role-governor";
const user = { id: USER_ID, openid: "openid-1" } as any;

function run(): SoloResultRunRecord {
  return {
    id: "solo-run-contract",
    ownerUserId: USER_ID,
    templateKey: "sangtian",
    engineVersion: "openovel_v1",
    selectedRoleKey: "zhejiang_governor",
    status: "chapter_generated",
    updatedAt: "2026-08-09T00:00:00.000Z",
    players: [{
      userId: USER_ID,
      role: {
        id: ROLE_ID,
        roleKey: "zhejiang_governor",
        roleName: "浙江总督",
        personalGoal: "稳住浙江。",
      },
    }],
  };
}

function ending(turnNumber: number) {
  const turnId = `T${String(turnNumber).padStart(2, "0")}`;
  return {
    schemaVersion: "openovel_ending_v1" as const,
    scope: "PART" as const,
    endingKey: "guarded_people_bore_responsibility",
    title: "守土担责",
    finalSceneNarrative: "最后一幕。",
    protagonistFate: "问责落到了总督自己名下。",
    aftermath: [],
    sourceTurnId: turnId,
    sourceRevision: turnNumber,
    playerEvidence: {
      schemaVersion: "openovel_player_ending_evidence_v1",
      endingKey: "guarded_people_bore_responsibility",
      scope: "PART",
      sourceTurnId: turnId,
      sourceRevision: turnNumber,
      causes: [{
        sourceTurnId: turnId,
        sourceRevision: turnNumber,
        sourceEventId: `event-${turnNumber}`,
        authority: "PREDICATE",
        visibility: "PLAYER",
        criterion: "GOVERNOR_RESPONSIBILITY",
        factText: "总督本人已经进入明确问责范围。",
        direction: "DECISIVE",
      }],
      reveal: null,
    },
  } as any;
}

function raw(turnNumber: number): RawOpenNovelResult {
  return {
    room: { id: "solo-run-contract", worldId: "sangtian" },
    ending: ending(turnNumber),
    completedNodes: turnNumber,
  };
}

function action(turnNumber: number): SoloResultActionRecord {
  return {
    id: `action-${turnNumber}`,
    runId: "solo-run-contract",
    userId: USER_ID,
    roleId: ROLE_ID,
    status: "resolved",
    method: `行动 ${turnNumber}`,
    immediateJson: { boundOption: { label: `选择 ${turnNumber}` } },
    resolvedJson: {
      turnId: `T${String(turnNumber).padStart(2, "0")}`,
      turnNumber,
      narration: "这段正文不参与裁定。",
    },
    resolvedAt: "2026-08-09T00:00:00.000Z",
    createdAt: "2026-08-09T00:00:00.000Z",
  };
}

function runtime(turnNumber: number) {
  return {
    runId: "solo-run-contract",
    worldId: "sangtian",
    roleId: "zhejiang_governor",
    runtimeMode: "OPENOVEL_V1",
    turnNumber,
    status: "COMPLETED",
    canon: "",
    recentCanon: "",
    ending: ending(turnNumber),
    options: [],
    updatedAt: "2026-08-09T00:00:00.000Z",
  };
}

test("Sangtian Part One completion contract carries engine, template, role and part identity", () => {
  const contract = resolveSoloEndingCompletionContract({
    engineVersion: "openovel_v1",
    templateKey: "sangtian",
    roleKey: "zhejiang_governor",
  });
  assert.deepEqual(contract, {
    schemaVersion: "openovel_completion_contract_v1",
    contractId: "openovel.sangtian.part-01.zhejiang-governor.v1",
    engineVersion: "openovel_v1",
    templateKey: "sangtian",
    roleKey: "zhejiang_governor",
    partId: "PART-01",
    terminalScope: "PART",
    terminalTurnId: "T20",
    terminalRevision: 20,
  });
});

test("internally self-consistent Sangtian T19 data still fails the authoritative completion contract", () => {
  assert.throws(() => compileOpenNovelResultV2({
    raw: raw(19),
    run: run(),
    viewerUserId: USER_ID,
    actions: [action(19)],
  }), (error: any) => (
    error?.code === "SOLO_RESULT_NOT_READY"
    && error?.reason === "ENDING_COMPLETION_CONTRACT_MISMATCH"
  ));
});

test("Result service converts coherent T19 rejection to stable RESULT_NOT_READY", async () => {
  const prisma = {
    storyRun: { findUnique: async () => run() },
    playerAction: { findMany: async () => [action(19)] },
  } as any;
  const service = new SoloEndingResultService(
    prisma,
    { getRun: async () => runtime(19) } as any,
  );
  await assert.rejects(
    service.present(user, "solo-run-contract", raw(19)),
    (error: any) => {
      const response = error?.getResponse?.() || {};
      return response.code === "RESULT_NOT_READY"
        && response.reason === "ENDING_COMPLETION_CONTRACT_MISMATCH";
    },
  );
});

test("the same structured chain is accepted at the authoritative T20 boundary", () => {
  const result = compileOpenNovelResultV2({
    raw: raw(20),
    run: run(),
    viewerUserId: USER_ID,
    actions: [action(20)],
  });
  assert.equal(result.presentation.resultType, "SOLO_PART_END");
  assert.equal(result.presentation.causes[0]?.sourceActionId, "action-20");
});
