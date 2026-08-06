import assert from "node:assert/strict";
import test from "node:test";
import {
  ActionTargetV1,
  EvidenceCardStateV1,
  ManeuverCompileContextV1,
  ManeuverValidationError,
  combineEvidenceV1,
  createActionPreviewV1,
  parseCreateActionPreviewCommandV1,
  projectEvidenceForRoleV1,
  projectInvestigationLeadsV1,
  resolveInvestigationV1,
} from "../src/maneuver-v1";

function context(overrides: Partial<ManeuverCompileContextV1> = {}): ManeuverCompileContextV1 {
  const targets: ActionTargetV1[] = [
    { type: "LOCATION", id: "location.archive", label: "档案室" },
    { type: "WORLD_ENTITY", id: "entity.crate", label: "封箱" },
    { type: "INSTITUTION", id: "institution.council", label: "理事会" },
  ];
  return {
    runId: "run-1",
    actorTurnId: "turn-1",
    actorRoleId: "role-investigator",
    actorRoleKey: "investigator",
    actorId: "actor-investigator",
    actorLabel: "调查负责人",
    slot: "MANEUVER_1",
    turnRevision: 3,
    stateRevision: 17,
    maneuverWindowVersion: 1,
    controlEpoch: 4,
    contextHash: "ctx-17",
    contacts: [
      {
        actorId: "actor-custodian",
        roleId: "role-custodian",
        displayName: "档案保管员",
        publicIdentity: "掌管档案出入",
        currentAccess: "可以私下约见",
        whyRelevant: "他接触过出入记录",
        canReceiveEvidence: true,
        visibilityOptions: ["LIMITED", "PUBLIC"],
        accessibleByRoleIds: ["role-investigator"],
      },
    ],
    traces: [
      {
        traceId: "trace-cart",
        runId: "run-1",
        title: "昨夜离开的运输车",
        narrativeHook: "雨水正在冲淡轮迹。",
        traceType: "PHYSICAL",
        subjectEntityIds: ["entity.crate"],
        sourceEventIds: ["event-move"],
        supportedClaimKeys: ["claim.cart_left"],
        sourceGroupKey: "event-move",
        accessRoleIds: ["role-investigator"],
        routeIds: ["route-registry", "route-ruts"],
        visibility: { scope: "LIMITED", roleIds: ["role-investigator"] },
        status: "ACTIVE",
        createdAtRevision: 16,
        expiresAtStage: 2,
      },
    ],
    investigationRoutes: [
      {
        routeId: "route-registry",
        traceId: "trace-cart",
        label: "查阅出入记录",
        narrativeMethod: "核对昨夜登记、领车人和离开时辰",
        requiredCapabilityIds: ["capability.inspect_records"],
        requiredResourceCosts: [{ resourceId: "staff", amount: 1, label: "助手" }],
        optionalCardTags: ["RECORD_ACCESS"],
        revealRules: [
          {
            claimKey: "claim.cart_left",
            statement: "一辆运输车在午夜后离开档案室。",
            strength: 2,
            when: "ALWAYS",
          },
        ],
        evidenceCeiling: "CORROBORATION",
        mayLearn: ["车辆离开的时辰", "登记人和领车人"],
        cannotProve: ["封箱中的具体内容", "谁在幕后下令"],
        settlementMoment: { kind: "BEFORE_MAIN_LOCK" },
        observableTrail: {
          summary: "档案保管员可能发现有人翻查昨夜记录。",
          audiencePolicyId: "archive-observers",
        },
        counterTags: ["RECORD_FORGED", "ACCESS_BLOCKED"],
        expiresWithTrace: true,
      },
      {
        routeId: "route-ruts",
        traceId: "trace-cart",
        label: "沿轮迹追踪",
        narrativeMethod: "沿泥地轮迹追查车辆停靠地点",
        requiredCapabilityIds: ["capability.track"],
        requiredResourceCosts: [{ resourceId: "staff", amount: 1, label: "助手" }],
        optionalCardTags: [],
        revealRules: [
          {
            claimKey: "claim.cart_route",
            statement: "车辆经过西门并转向仓库区。",
            strength: 2,
            when: "ALWAYS",
          },
        ],
        evidenceCeiling: "CORROBORATION",
        mayLearn: ["车辆经过的路线", "可能停靠的区域"],
        cannotProve: ["谁签发命令", "箱内物品"],
        settlementMoment: { kind: "NEXT_ACTOR_TURN" },
        observableTrail: {
          summary: "被跟踪的人可能察觉身后有人。",
          audiencePolicyId: "tracked-party",
        },
        counterTags: ["WEATHER_ERASED", "TAIL_DETECTED"],
        expiresWithTrace: true,
      },
    ],
    ruleCards: [
      {
        cardKey: "seal-token",
        label: "封存令牌",
        tags: ["AUTHORITY"],
        allowedRoleKeys: ["investigator"],
        timing: ["ACTIVE", "SET", "REACTION", "ATTACH"],
        legalTargetTypes: ["LOCATION"],
        capabilityId: "capability.seal_location",
        triggerPatternIds: ["entity_transfer_attempt"],
        guaranteedEffects: ["普通人员会被阻止继续搬运。"],
        duration: { kind: "UNTIL_TURN_END" },
        visibility: {
          beforeTrigger: { scope: "PRIVATE", roleIds: ["role-investigator"] },
          afterTrigger: { scope: "PUBLIC" },
        },
        consumption: "COOLDOWN",
        cooldownStages: 2,
        counterTags: ["HIGHER_AUTHORITY", "TRANSFER_ALREADY_COMPLETED"],
        playerFacingLimitations: ["不能追回已经离开现场的物品。"],
      },
    ],
    ruleCardHoldings: [
      {
        cardAssetKey: "asset-seal-token",
        cardKey: "seal-token",
        ownerRoleId: "role-investigator",
        status: "AVAILABLE",
      },
    ],
    actionBindings: [
      {
        bindingId: "binding.seal.location",
        effectKey: "seal_location",
        capabilityId: "capability.seal_location",
        labels: {
          actionTitle: "封锁档案室",
          method: "封锁",
          guaranteedStart: ["命令会送达现场，执行人员开始前往目标地点。"],
          contestedOutcome: ["执行人员能否在目标物品离开前建立封锁。"],
          notGuaranteed: ["目标物品仍然留在现场。"],
          confirmLabel: "确认封锁档案室",
        },
        legalTargetTypes: ["LOCATION"],
        defaultVisibility: { scope: "PUBLIC" },
        tracePolicy: { leavesTrace: true, playerSafeHint: "所有在场者都会看到执行人员到达。" },
        reactionPolicy: { mode: "ALWAYS", playerSafeHint: "控制该地点的人可能获得应变机会。" },
        timing: { startsAt: "ON_COMMIT", settlesAt: { kind: "CURRENT_SETTLEMENT" }, playerLabel: "本场景结算时" },
        costs: [{ kind: "RESOURCE", id: "guards", amount: 1, label: "守卫 1 队" }],
      },
      {
        bindingId: "binding.move.entity",
        effectKey: "move_entity",
        capabilityId: "capability.move_entity",
        labels: {
          actionTitle: "转移封箱",
          method: "转移",
          guaranteedStart: ["搬运命令会送达执行者。"],
          contestedOutcome: ["封箱能否在被发现前离开。"],
          notGuaranteed: ["搬运过程不会留下痕迹。"],
          confirmLabel: "确认转移封箱",
        },
        legalTargetTypes: ["WORLD_ENTITY"],
        defaultVisibility: { scope: "OBSERVABLE" },
        tracePolicy: { leavesTrace: true, playerSafeHint: "搬运可能留下人员、登记或路线痕迹。" },
        reactionPolicy: { mode: "IF_OBSERVED", playerSafeHint: "察觉搬运的人可能应变。" },
        timing: { startsAt: "ON_COMMIT", settlesAt: { kind: "CURRENT_SETTLEMENT" }, playerLabel: "本场景结算时" },
        costs: [],
      },
    ],
    targets,
    evidence: [],
    capabilityIds: ["capability.inspect_records", "capability.track", "capability.seal_location", "capability.move_entity"],
    resourceAmounts: { staff: 2, guards: 1 },
    currentStage: 1,
    nowIso: "2026-08-05T05:00:00.000Z",
    previewTtlSeconds: 300,
    ...overrides,
  };
}

function command(draft: unknown) {
  return {
    idempotencyKey: "preview-run-1-turn-1-draft-1",
    turnRevision: 3,
    expectedStateRevision: 17,
    expectedManeuverWindowVersion: 1,
    controlEpoch: 4,
    draft,
  };
}

test("validator is fail-closed for unknown fields and too many attachments", () => {
  assert.throws(
    () => parseCreateActionPreviewCommandV1({
      ...command({
        schemaVersion: "maneuver_draft_v1",
        kind: "CUSTOM_PLAN",
        rawText: "封锁档案室",
        attachmentAssetKeys: [],
      }),
      compiledAction: { forged: true },
    }),
    (error: unknown) => error instanceof ManeuverValidationError && error.code === "MANEUVER_UNKNOWN_FIELD",
  );

  assert.throws(
    () => parseCreateActionPreviewCommandV1(command({
      schemaVersion: "maneuver_draft_v1",
      kind: "CUSTOM_PLAN",
      rawText: "封锁档案室",
      attachmentAssetKeys: ["a", "b"],
    })),
    (error: unknown) => error instanceof ManeuverValidationError && error.code === "MANEUVER_TOO_MANY_ATTACHMENTS",
  );
});

test("conversation preview clearly separates message delivery from compliance", () => {
  const result = createActionPreviewV1(command({
    schemaVersion: "maneuver_draft_v1",
    kind: "CONVERSATION",
    targetActorId: "actor-custodian",
    message: "把昨夜出入记录交给我，我可以暂不公开追责。",
    purpose: "PROPOSE_TERM",
    visibility: "LIMITED",
    attachmentAssetKeys: [],
    formalAgreementRequested: false,
  }), context());

  assert.equal(result.decision, "READY");
  assert.equal(result.compiledAction?.primaryEffect.kind, "OPEN_INTERACTION");
  assert.match(result.presentation?.narrative || "", /把昨夜出入记录交给我/u);
  assert.ok(result.presentation?.sections.some((section) => section.kind === "CANNOT_GUARANTEE"));
  assert.ok(result.compiledAction?.notGuaranteed.some((item) => /说真话/u.test(item.statement)));
});

test("investigation starts from a visible trace and route, not a free-form omniscient question", () => {
  const result = createActionPreviewV1(command({
    schemaVersion: "maneuver_draft_v1",
    kind: "INVESTIGATION",
    traceId: "trace-cart",
    routeId: "route-registry",
    executorAssetKey: "助手甲",
    attachmentAssetKeys: [],
  }), context());

  assert.equal(result.decision, "READY");
  assert.equal(result.compiledAction?.primaryEffect.kind, "START_INVESTIGATION");
  assert.match(result.presentation?.title || "", /昨夜离开的运输车/u);
  assert.deepEqual(
    result.presentation?.sections.find((section) => section.kind === "CANNOT_GUARANTEE")?.lines,
    ["封箱中的具体内容", "谁在幕后下令"],
  );
  assert.match(result.presentation?.confirmLabel || "", /一名助手/u);
  assert.doesNotMatch(result.presentation?.narrative || "", /助手甲/u);
});

test("investigation preview never trusts a client-supplied executor label", () => {
  const result = createActionPreviewV1(command({
    schemaVersion: "maneuver_draft_v1",
    kind: "INVESTIGATION",
    traceId: "trace-cart",
    routeId: "route-registry",
    executorAssetKey: "<img src=x onerror=alert(1)>",
    attachmentAssetKeys: [],
  }), context());

  assert.equal(result.decision, "READY");
  assert.match(result.presentation?.confirmLabel || "", /一名助手/u);
  assert.doesNotMatch(JSON.stringify(result.presentation), /onerror|<img/u);
});

test("investigation resolution creates a private evidence card with explicit limits", () => {
  const ctx = context();
  const resolution = resolveInvestigationV1({
    trace: ctx.traces[0],
    route: ctx.investigationRoutes[0],
    actorRoleId: ctx.actorRoleId,
    actorCapabilityIds: ctx.capabilityIds,
    availableResources: ctx.resourceAmounts,
    evidenceId: "evidence-registry",
    evidenceTitle: "昨夜运输车出入记录",
    acquiredAtRevision: 18,
  });

  assert.equal(resolution.status, "EVIDENCE_ACQUIRED");
  assert.equal(resolution.evidence?.level, "CORROBORATION");
  assert.equal(resolution.evidence?.visibility, "PRIVATE");
  assert.equal(resolution.evidence?.supports[0].claimKey, "claim.cart_left");
  assert.ok(resolution.evidence?.cannotProve.includes("谁在幕后下令"));
});

test("investigation projection exposes only traces visible to the current role", () => {
  const ctx = context({
    traces: [
      ...context().traces,
      {
        ...context().traces[0],
        traceId: "trace-secret",
        title: "另一角色的私密痕迹",
        accessRoleIds: ["role-other"],
      },
    ],
  });
  const projection = projectInvestigationLeadsV1({
    traces: ctx.traces,
    routes: ctx.investigationRoutes,
    roleId: "role-investigator",
    currentStage: 1,
  });
  assert.deepEqual(projection.map((item) => item.traceId), ["trace-cart"]);
  assert.equal(projection[0].routes.length, 2);
});

test("private evidence cannot be projected to an unauthorized role", () => {
  const card: EvidenceCardStateV1 = {
    schemaVersion: "evidence_card_v1",
    evidenceId: "evidence-private",
    title: "私密记录",
    level: "CORROBORATION",
    authenticity: "SUPPORTED",
    supports: [{ claimKey: "claim.x", statement: "有限命题 X", strength: 2 }],
    cannotProve: ["命题 Y"],
    source: {
      traceId: "trace-cart",
      routeId: "route-registry",
      sourceGroupKey: "source-one",
      sourceEventIds: ["event-secret"],
    },
    ownerRoleId: "role-investigator",
    visibility: "PRIVATE",
    sharedWithRoleIds: [],
    acquiredAtRevision: 18,
    derivedFromEvidenceIds: [],
  };
  assert.equal(projectEvidenceForRoleV1(card, "role-other"), null);
  assert.deepEqual(projectEvidenceForRoleV1(card, "role-investigator")?.source.sourceEventIds, ["event-secret"]);
});

test("same-source evidence cannot impersonate independent corroboration", () => {
  const baseCard = (id: string, sourceGroupKey: string, strength: 1 | 2 | 3): EvidenceCardStateV1 => ({
    schemaVersion: "evidence_card_v1",
    evidenceId: id,
    title: id,
    level: "CORROBORATION",
    authenticity: "SUPPORTED",
    supports: [{ claimKey: "claim.cart_route", statement: "车辆进入仓库区", strength }],
    cannotProve: ["谁下令"],
    source: {
      traceId: `trace-${id}`,
      routeId: "route",
      sourceGroupKey,
      sourceEventIds: [`event-${sourceGroupKey}`],
    },
    ownerRoleId: "role-investigator",
    visibility: "PRIVATE",
    sharedWithRoleIds: [],
    acquiredAtRevision: 18,
    derivedFromEvidenceIds: [],
  });

  const rule = {
    claimKey: "claim.cart_route",
    label: "车辆进入仓库区",
    requiredIndependentSourceGroups: 2,
    minimumTotalStrength: 4,
    resultingLevel: "PROOF" as const,
    resultingStatement: "两份独立记录确认同一车辆进入仓库区。",
    forbiddenSameSourceStacking: true,
  };

  const rejected = combineEvidenceV1({
    evidenceId: "combined-rejected",
    title: "重复来源",
    ownerRoleId: "role-investigator",
    acquiredAtRevision: 19,
    cards: [baseCard("a", "same", 2), baseCard("b", "same", 2)],
    rule,
  });
  assert.equal(rejected.accepted, false);
  assert.match(rejected.reason || "", /同一来源/u);

  const accepted = combineEvidenceV1({
    evidenceId: "combined-accepted",
    title: "独立证据链",
    ownerRoleId: "role-investigator",
    acquiredAtRevision: 19,
    cards: [baseCard("a", "one", 2), baseCard("b", "two", 2)],
    rule,
  });
  assert.equal(accepted.accepted, true);
  assert.equal(accepted.evidence?.level, "PROOF");
  assert.deepEqual(accepted.evidence?.derivedFromEvidenceIds, ["a", "b"]);
});

test("custom plan reroutes information-seeking, conversation and card play", () => {
  const ctx = context();
  const investigate = createActionPreviewV1(command({
    schemaVersion: "maneuver_draft_v1",
    kind: "CUSTOM_PLAN",
    rawText: "派人调查运输车去了哪里",
    attachmentAssetKeys: [],
  }), ctx);
  assert.equal(investigate.decision, "REROUTE_REQUIRED");
  assert.equal(investigate.rerouteKind, "INVESTIGATION");

  const talk = createActionPreviewV1(command({
    schemaVersion: "maneuver_draft_v1",
    kind: "CUSTOM_PLAN",
    rawText: "询问档案保管员昨夜看到了什么",
    attachmentAssetKeys: [],
  }), ctx);
  assert.equal(talk.decision, "REROUTE_REQUIRED");
  assert.equal(talk.rerouteKind, "CONVERSATION");

  const card = createActionPreviewV1(command({
    schemaVersion: "maneuver_draft_v1",
    kind: "CUSTOM_PLAN",
    rawText: "使用封存令牌阻止搬运",
    attachmentAssetKeys: [],
  }), ctx);
  assert.equal(card.decision, "REROUTE_REQUIRED");
  assert.equal(card.rerouteKind, "CARD_LAYOUT");
});

test("custom plan splits multiple effects and refuses controlling another player", () => {
  const split = createActionPreviewV1(command({
    schemaVersion: "maneuver_draft_v1",
    kind: "CUSTOM_PLAN",
    rawText: "封锁档案室，然后转移封箱",
    attachmentAssetKeys: [],
  }), context());
  assert.equal(split.decision, "SPLIT_REQUIRED");
  assert.equal(split.splitOptions?.length, 2);

  const blocked = createActionPreviewV1(command({
    schemaVersion: "maneuver_draft_v1",
    kind: "CUSTOM_PLAN",
    rawText: "命令另一个玩家必须支持我",
    attachmentAssetKeys: [],
  }), context());
  assert.equal(blocked.decision, "BLOCKED");
  assert.ok(blocked.safeDebug?.riskFlags.includes("CONTROL_OTHER_PLAYER"));
});

test("concise and verbose expression compile to the same bounded effect", () => {
  const concise = createActionPreviewV1(command({
    schemaVersion: "maneuver_draft_v1",
    kind: "CUSTOM_PLAN",
    rawText: "封锁档案室",
    attachmentAssetKeys: [],
  }), context());
  const verbose = createActionPreviewV1(command({
    schemaVersion: "maneuver_draft_v1",
    kind: "CUSTOM_PLAN",
    rawText: "我决定立刻调动最可靠的人手，以最严密的方式封锁档案室",
    attachmentAssetKeys: [],
  }), context());

  assert.equal(concise.decision, "READY");
  assert.equal(verbose.decision, "READY");
  assert.equal(
    concise.compiledAction?.primaryEffect.kind === "APPLY_CAPABILITY" ? concise.compiledAction.primaryEffect.effectKey : null,
    verbose.compiledAction?.primaryEffect.kind === "APPLY_CAPABILITY" ? verbose.compiledAction.primaryEffect.effectKey : null,
  );
  assert.deepEqual(concise.compiledAction?.costs, verbose.compiledAction?.costs);
});

test("card layout enforces holding, timing, target and trigger", () => {
  const set = createActionPreviewV1(command({
    schemaVersion: "maneuver_draft_v1",
    kind: "CARD_LAYOUT",
    cardAssetKey: "asset-seal-token",
    playMode: "SET",
    targetId: "location.archive",
    triggerPatternId: "entity_transfer_attempt",
  }), context());
  assert.equal(set.decision, "READY");
  assert.equal(set.compiledAction?.primaryEffect.kind, "PLAY_RULE_CARD");
  assert.match(set.presentation?.confirmLabel || "", /伏下/u);

  const badTrigger = createActionPreviewV1(command({
    schemaVersion: "maneuver_draft_v1",
    kind: "CARD_LAYOUT",
    cardAssetKey: "asset-seal-token",
    playMode: "SET",
    targetId: "location.archive",
    triggerPatternId: "arbitrary_script",
  }), context());
  assert.equal(badTrigger.decision, "BLOCKED");
});

test("stale preview is rejected before compilation", () => {
  const stale = createActionPreviewV1({
    ...command({
      schemaVersion: "maneuver_draft_v1",
      kind: "CUSTOM_PLAN",
      rawText: "封锁档案室",
      attachmentAssetKeys: [],
    }),
    expectedStateRevision: 16,
  }, context());
  assert.equal(stale.decision, "BLOCKED");
  assert.ok(stale.safeDebug?.riskFlags.includes("ACTION_PREVIEW_STALE"));
});

test("custom plan can disclose an owned evidence card without expanding its claims", () => {
  const evidence: EvidenceCardStateV1 = {
    schemaVersion: "evidence_card_v1",
    evidenceId: "evidence-registry",
    title: "昨夜运输车出入记录",
    level: "CORROBORATION",
    authenticity: "SUPPORTED",
    supports: [{ claimKey: "claim.cart_left", statement: "一辆运输车在午夜后离开档案室。", strength: 2 }],
    cannotProve: ["封箱中的具体内容", "谁在幕后下令"],
    source: {
      traceId: "trace-cart",
      routeId: "route-registry",
      sourceGroupKey: "event-move",
      sourceEventIds: ["event-move"],
    },
    ownerRoleId: "role-investigator",
    visibility: "PRIVATE",
    sharedWithRoleIds: [],
    acquiredAtRevision: 18,
    derivedFromEvidenceIds: [],
  };
  const result = createActionPreviewV1(command({
    schemaVersion: "maneuver_draft_v1",
    kind: "CUSTOM_PLAN",
    rawText: "向理事会公开这份证据材料",
    attachmentAssetKeys: [evidence.evidenceId],
    visibilityPreference: "PUBLIC",
  }), context({ evidence: [evidence] }));

  assert.equal(result.decision, "READY");
  assert.equal(result.compiledAction?.primaryEffect.kind, "DISCLOSE_EVIDENCE");
  if (result.compiledAction?.primaryEffect.kind === "DISCLOSE_EVIDENCE") {
    assert.deepEqual(result.compiledAction.primaryEffect.evidenceAssetIds, [evidence.evidenceId]);
    assert.equal(result.compiledAction.primaryEffect.audience, "PUBLIC");
  }
  assert.ok(result.compiledAction?.notGuaranteed.some((item) => /不能证明/u.test(item.statement)));
  assert.match(result.presentation?.confirmLabel || "", /公开/u);
});

test("reaction is event-triggered, hold costs nothing, and reaction cards require the proper timing", () => {
  const held = createActionPreviewV1(command({
    schemaVersion: "maneuver_draft_v1",
    kind: "REACTION",
    reactionId: "reaction-1",
    hold: true,
  }), context({ slot: "REACTION" }));
  assert.equal(held.decision, "READY");
  assert.equal(held.compiledAction?.slot, "REACTION");
  assert.deepEqual(held.compiledAction?.costs, []);
  assert.equal(held.compiledAction?.tracePolicy.leavesTrace, false);

  const withCard = createActionPreviewV1(command({
    schemaVersion: "maneuver_draft_v1",
    kind: "REACTION",
    reactionId: "reaction-1",
    optionId: "protect",
    cardAssetKey: "asset-seal-token",
    hold: false,
  }), context({ slot: "REACTION" }));
  assert.equal(withCard.decision, "READY");
  assert.deepEqual(withCard.compiledAction?.attachedAssetKeys, ["asset-seal-token"]);

  const withoutTiming = context({
    slot: "REACTION",
    ruleCards: context().ruleCards.map((card) => ({ ...card, timing: ["ACTIVE"] })),
  });
  const rejected = createActionPreviewV1(command({
    schemaVersion: "maneuver_draft_v1",
    kind: "REACTION",
    reactionId: "reaction-1",
    optionId: "protect",
    cardAssetKey: "asset-seal-token",
    hold: false,
  }), withoutTiming);
  assert.equal(rejected.decision, "BLOCKED");
});
