import assert from "node:assert/strict";
import test from "node:test";
import { buildContinuousStoryV2ManeuverPackageV1 } from "./continuous-story-v2-package";

function world(input: {
  runId: string;
  actorId: string;
  actorKey: string;
  actorName: string;
  otherId: string;
  otherKey: string;
  otherName: string;
  factKey: string;
  fact: string;
  assetKey: string;
  assetLabel: string;
}) {
  return buildContinuousStoryV2ManeuverPackageV1({
    runId: input.runId,
    actorRole: {
      id: input.actorId,
      roleKey: input.actorKey,
      roleName: input.actorName,
      identity: input.actorName,
      publicInfo: "可公开身份",
    },
    roles: [
      { id: input.actorId, roleKey: input.actorKey, roleName: input.actorName },
      { id: input.otherId, roleKey: input.otherKey, roleName: input.otherName, publicInfo: "相关参与者" },
    ],
    visibleFacts: [{ factKey: input.factKey, content: input.fact, visibility: "public" }],
    observableEntries: [],
    assets: [{
      assetKey: input.assetKey,
      kind: "RULE_CARD",
      ownerRoleId: input.actorId,
      quantity: 1,
      status: "ACTIVE",
      visibility: "PRIVATE",
      stateJson: {},
      label: input.assetLabel,
    }],
    availableTargets: [
      { type: "LOCATION", id: `${input.runId}:location`, label: "当前地点" },
    ],
    currentStage: 1,
    currentRevision: 1,
    currentTurnId: `${input.runId}:turn:1`,
  });
}

test("continuous-story-v2 maneuver package is world-agnostic and produces traces, contacts and finite cards", () => {
  const research = world({
    runId: "run-research",
    actorId: "role.scientist",
    actorKey: "scientist",
    actorName: "研究员",
    otherId: "role.security",
    otherKey: "security",
    otherName: "安保主管",
    factKey: "sample.freezer.opened",
    fact: "冷冻样本柜在凌晨被打开过。",
    assetKey: "lab_access_override",
    assetLabel: "实验室访问覆写权限",
  });
  const board = world({
    runId: "run-board",
    actorId: "role.cfo",
    actorKey: "cfo",
    actorName: "财务负责人",
    otherId: "role.counsel",
    otherKey: "counsel",
    otherName: "公司法务",
    factKey: "memo.printed.after_hours",
    fact: "董事会备忘录在下班后被打印。",
    assetKey: "audit_channel",
    assetLabel: "审计委员会直报渠道",
  });

  for (const value of [research, board]) {
    assert.equal(value.contacts.length, 1);
    assert.ok(value.traces.length >= 1);
    assert.ok(value.investigationRoutes.length >= 2);
    assert.equal(value.ruleCards.length, 1);
    assert.equal(value.ruleCardHoldings.length, 1);
    assert.ok(value.actionBindings.length >= 4);
    assert.ok(value.targets.some((target) => target.type === "ROLE"));
    assert.ok(value.targets.some((target) => target.type === "LOCATION"));
  }

  assert.match(research.traces[0].narrativeHook, /冷冻样本柜/u);
  assert.match(board.traces[0].narrativeHook, /董事会备忘录/u);
  const serialized = JSON.stringify([research, board]);
  for (const forbidden of ["巡抚", "田契", "档房", "凯撒", "元老院"]) {
    assert.doesNotMatch(serialized, new RegExp(forbidden, "u"));
  }
});

test("evidence assets stay role-scoped and are not converted into generic rule cards", () => {
  const evidenceState = {
    schemaVersion: "evidence_card_v1",
    evidenceId: "evidence.private",
    title: "门禁日志副本",
    level: "CORROBORATION",
    authenticity: "SUPPORTED",
    supports: [{ claimKey: "claim.entry", statement: "凌晨有人刷卡进入", strength: 2 }],
    cannotProve: ["进入者拿走了样本"],
    source: {
      traceId: "trace.entry",
      routeId: "route.log",
      sourceGroupKey: "access-log",
      sourceEventIds: ["event.entry"],
    },
    ownerRoleId: "role.scientist",
    visibility: "PRIVATE",
    sharedWithRoleIds: [],
    acquiredAtRevision: 2,
    derivedFromEvidenceIds: [],
  };
  const result = buildContinuousStoryV2ManeuverPackageV1({
    runId: "run-private",
    actorRole: { id: "role.scientist", roleKey: "scientist", roleName: "研究员" },
    roles: [
      { id: "role.scientist", roleKey: "scientist", roleName: "研究员" },
      { id: "role.security", roleKey: "security", roleName: "安保主管" },
    ],
    visibleFacts: [],
    observableEntries: [],
    assets: [
      {
        assetKey: "evidence.private",
        kind: "EVIDENCE_CARD_V1",
        ownerRoleId: "role.scientist",
        quantity: 1,
        status: "ACTIVE",
        visibility: "PRIVATE",
        stateJson: evidenceState,
        label: "门禁日志副本",
      },
    ],
    availableTargets: [],
    currentStage: 1,
    currentRevision: 2,
    currentTurnId: "turn.private.1",
  });

  assert.equal(result.evidence.length, 1);
  assert.equal(result.evidence[0].ownerRoleId, "role.scientist");
  assert.equal(result.evidence[0].visibility, "PRIVATE");
  assert.equal(result.ruleCards.length, 0);
  assert.equal(result.ruleCardHoldings.length, 0);
});


test("a set card expires with its original turn instead of remaining locked forever", () => {
  const packageData = buildContinuousStoryV2ManeuverPackageV1({
    runId: "run-expired-card",
    actorRole: { id: "role.one", roleKey: "one", roleName: "角色一" },
    roles: [
      { id: "role.one", roleKey: "one", roleName: "角色一" },
      { id: "role.two", roleKey: "two", roleName: "角色二" },
    ],
    visibleFacts: [],
    observableEntries: [],
    assets: [{
      assetKey: "authority.seal",
      kind: "AUTHORITY",
      ownerRoleId: "role.one",
      quantity: 1,
      status: "LOCKED",
      visibility: "PRIVATE",
      stateJson: {
        maneuverRulesV1: {
          status: "ARMED",
          actionId: "action.old",
          expiresAtTurnId: "turn.old",
          targetId: "location.archive",
          triggerPatternId: "asset_transfer_attempt",
        },
      },
      label: "封缄权限",
    }],
    availableTargets: [{ type: "LOCATION", id: "location.archive", label: "档案室" }],
    currentStage: 2,
    currentRevision: 4,
    currentTurnId: "turn.current",
  });

  assert.equal(packageData.ruleCardHoldings[0].status, "AVAILABLE");
});
