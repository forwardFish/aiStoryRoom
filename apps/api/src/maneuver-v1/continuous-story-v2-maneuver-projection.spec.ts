import assert from "node:assert/strict";
import test from "node:test";
import { ContinuousStoryV2ManeuverService } from "./continuous-story-v2-maneuver.service";

function fakePrisma() {
  const actorActions = [{
    id: "action-conversation",
    actionType: "MANEUVER_CONVERSATION_V1",
    actionSlot: "MANEUVER:turn-1:1",
    status: "OPEN",
    intent: "询问记录",
    immediateJson: { title: "私下询问" },
    resolvedJson: {},
    createdAt: new Date("2026-08-05T00:00:00Z"),
  }];
  const incoming = [{
    id: "action-incoming",
    runId: "run-1",
    actionType: "MANEUVER_CUSTOM_PLAN_V1",
    targetRoleId: "role-1",
    targetText: "档案室",
    method: "封锁档案室",
    intent: "限制文件继续转移",
    immediateJson: { title: "有人正在封锁档案室", narrative: "一队人员已经开始接管出入口。" },
    resolvedJson: { resultNarrative: "一队人员已经开始接管出入口。" },
    status: "OPEN",
    role: { roleName: "安保主管" },
    createdAt: new Date("2026-08-05T00:01:00Z"),
  }];
  return {
    playerAction: {
      findMany: async ({ where }: any) => {
        if (where?.targetRoleId) return incoming;
        if (where?.OR) return actorActions;
        return actorActions;
      },
    },
  };
}

function evidenceAsset() {
  return {
    id: "asset-evidence",
    assetKey: "evidence.private",
    kind: "EVIDENCE_CARD_V1",
    ownerRoleId: "role-1",
    quantity: 1,
    status: "ACTIVE",
    visibility: "PRIVATE",
    stateJson: {
      schemaVersion: "evidence_card_v1",
      evidenceId: "evidence.private",
      title: "门禁日志副本",
      level: "CORROBORATION",
      authenticity: "SUPPORTED",
      supports: [{ claimKey: "claim.entry", statement: "凌晨有人进入档案室", strength: 2 }],
      cannotProve: ["进入者取走了文件"],
      source: { traceId: "trace.entry", routeId: "route.log", sourceGroupKey: "access-log", sourceEventIds: ["event.entry"] },
      ownerRoleId: "role-1",
      visibility: "PRIVATE",
      sharedWithRoleIds: [],
      acquiredAtRevision: 3,
      derivedFromEvidenceIds: [],
    },
  };
}

test("V2 projection uses server actions for opportunity counts and keeps reaction event-triggered", async () => {
  const service = new ContinuousStoryV2ManeuverService(fakePrisma() as any, { publish: async () => undefined } as any);
  const projection: any = await service.buildProjectionAsync({
    run: { id: "run-1", templateKey: "sangtian", worldSequence: 4, currentNodeId: "node-1" },
    role: { id: "role-1", roleKey: "investigator", roleName: "调查负责人", identity: "负责人" } as any,
    roles: [
      { id: "role-1", roleKey: "investigator", roleName: "调查负责人", identity: "负责人" },
      { id: "role-2", roleKey: "security", roleName: "安保主管", identity: "安保主管" },
    ] as any,
    control: { roleId: "role-1", mode: "HUMAN_ACTIVE", epoch: 1 } as any,
    turn: { id: "turn-1", status: "OPEN", stageIndex: 1, revision: 2, situationTitle: "档案封条异常" } as any,
    visibleFacts: [{ factKey: "archive.opened", content: "档案室的封条已经断裂。" }],
    entries: [],
    assets: [
      evidenceAsset() as any,
      {
        id: "asset-card",
        assetKey: "authority.seal",
        kind: "AUTHORITY",
        ownerRoleId: "role-1",
        quantity: 1,
        status: "ACTIVE",
        visibility: "PRIVATE",
        stateJson: {},
      } as any,
    ],
    availableTargets: [{ type: "LOCATION", id: "location.archive", label: "档案室" }],
  });

  assert.equal(projection.enabled, true);
  assert.equal(projection.window.remainingOpportunities, 1);
  assert.equal(projection.window.formLimits.conversationRemaining, 0);
  assert.equal(projection.window.formLimits.investigationRemaining, 1);
  assert.equal(projection.window.usedSlots.length, 1);
  assert.equal(projection.evidenceCards.length, 1);
  assert.equal(projection.evidenceCards[0].evidenceId, "evidence.private");
  assert.equal(projection.reactions.length, 1);
  assert.match(projection.reactions[0].storyNotice.title, /封锁档案室/u);
  assert.ok(projection.reactions[0].options.length >= 2);
  assert.ok(projection.reactions[0].eligibleCardAssetKeys.length >= 1);
});
