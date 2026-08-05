import { createHash } from "node:crypto";
import type {
  ActionTargetV1,
  ContactDefinitionV1,
  EvidenceCardStateV1,
  InvestigationRouteV1,
  ManeuverActionBindingV1,
  RuleCardDefinitionV1,
  RuleCardHoldingV1,
  WorldTraceV1,
} from "@ai-story/templates";

export type ManeuverRoleLikeV1 = {
  id: string;
  roleKey: string;
  roleName: string;
  identity?: string | null;
  publicInfo?: string | null;
};

export type ManeuverAssetLikeV1 = {
  assetKey: string;
  kind: string;
  ownerRoleId: string | null;
  quantity: number;
  status: string;
  visibility?: string | null;
  stateJson?: unknown;
  label: string;
};

export type ManeuverFactLikeV1 = {
  factKey: string;
  content: string;
  visibility?: string | null;
};

export type ManeuverTimelineLikeV1 = {
  id: string;
  entryType: string;
  content: string;
  worldSequence: number | null;
  visibility: string;
  roleId: string | null;
};

export type ContinuousStoryV2ManeuverPackageInputV1 = {
  runId: string;
  actorRole: ManeuverRoleLikeV1;
  roles: ManeuverRoleLikeV1[];
  visibleFacts: ManeuverFactLikeV1[];
  observableEntries: ManeuverTimelineLikeV1[];
  assets: ManeuverAssetLikeV1[];
  availableTargets: ActionTargetV1[];
  currentStage: number;
  currentRevision: number;
  currentTurnId: string;
};

export type ContinuousStoryV2ManeuverPackageV1 = {
  contacts: ContactDefinitionV1[];
  traces: WorldTraceV1[];
  investigationRoutes: InvestigationRouteV1[];
  ruleCards: RuleCardDefinitionV1[];
  ruleCardHoldings: RuleCardHoldingV1[];
  actionBindings: ManeuverActionBindingV1[];
  targets: ActionTargetV1[];
  evidence: EvidenceCardStateV1[];
  capabilityIds: string[];
  resourceAmounts: Record<string, number>;
};

function shortHash(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function evidenceFromAsset(asset: ManeuverAssetLikeV1): EvidenceCardStateV1 | null {
  if (asset.kind !== "EVIDENCE_CARD_V1" || asset.quantity < 1 || asset.status !== "ACTIVE") return null;
  const value = asRecord(asset.stateJson);
  if (value.schemaVersion !== "evidence_card_v1") return null;
  const source = asRecord(value.source);
  const supports = Array.isArray(value.supports)
    ? value.supports.flatMap((item) => {
        const entry = asRecord(item);
        const strength = Number(entry.strength);
        if (typeof entry.claimKey !== "string" || typeof entry.statement !== "string" || ![1, 2, 3].includes(strength)) return [];
        return [{ claimKey: entry.claimKey, statement: entry.statement, strength: strength as 1 | 2 | 3 }];
      })
    : [];
  if (!asset.ownerRoleId || typeof value.evidenceId !== "string" || typeof value.title !== "string" || supports.length === 0) return null;
  const level = ["LEAD", "CORROBORATION", "PROOF"].includes(String(value.level)) ? value.level as EvidenceCardStateV1["level"] : "LEAD";
  const authenticity = ["UNVERIFIED", "SUPPORTED", "AUTHENTICATED", "DISPUTED"].includes(String(value.authenticity))
    ? value.authenticity as EvidenceCardStateV1["authenticity"]
    : "UNVERIFIED";
  const visibility = ["PRIVATE", "SHARED", "PUBLIC"].includes(String(value.visibility))
    ? value.visibility as EvidenceCardStateV1["visibility"]
    : "PRIVATE";
  return {
    schemaVersion: "evidence_card_v1",
    evidenceId: value.evidenceId,
    title: value.title,
    level,
    authenticity,
    supports,
    cannotProve: asStringArray(value.cannotProve),
    source: {
      traceId: String(source.traceId || "unknown"),
      routeId: String(source.routeId || "unknown"),
      sourceGroupKey: String(source.sourceGroupKey || asset.assetKey),
      sourceEventIds: asStringArray(source.sourceEventIds),
    },
    ownerRoleId: asset.ownerRoleId,
    visibility,
    sharedWithRoleIds: asStringArray(value.sharedWithRoleIds),
    acquiredAtRevision: Number.isInteger(Number(value.acquiredAtRevision)) ? Number(value.acquiredAtRevision) : 0,
    derivedFromEvidenceIds: asStringArray(value.derivedFromEvidenceIds),
  };
}

function traceAndRoutesForFact(input: ContinuousStoryV2ManeuverPackageInputV1, fact: ManeuverFactLikeV1) {
  const digest = shortHash(`${input.runId}|fact|${fact.factKey}`);
  const traceId = `trace.fact.${digest}`;
  const claimKey = `claim.fact.${digest}`;
  const verifyRouteId = `route.fact.${digest}.verify_source`;
  const compareRouteId = `route.fact.${digest}.compare_record`;
  const trace: WorldTraceV1 = {
    traceId,
    runId: input.runId,
    title: fact.content.length > 34 ? `${fact.content.slice(0, 34)}…` : fact.content,
    narrativeHook: fact.content,
    traceType: /册|账|文书|记录|letter|record|ledger/i.test(fact.content) ? "RECORD" : "BEHAVIOR",
    subjectEntityIds: [fact.factKey],
    sourceEventIds: [fact.factKey],
    supportedClaimKeys: [claimKey],
    sourceGroupKey: `fact:${fact.factKey}`,
    accessRoleIds: [input.actorRole.id],
    routeIds: [verifyRouteId, compareRouteId],
    visibility: { scope: "PRIVATE", roleIds: [input.actorRole.id] },
    status: "ACTIVE",
    createdAtRevision: input.currentRevision,
    expiresAtStage: input.currentStage + 1,
  };
  const commonCannotProve = ["相关人物真正的私人动机", "尚未执行、也没有留下痕迹的计划"];
  const routes: InvestigationRouteV1[] = [
    {
      routeId: verifyRouteId,
      traceId,
      label: "核验来源与经手记录",
      narrativeMethod: `沿“${trace.title}”查验最接近原始来源的记录、经手人和时辰`,
      requiredCapabilityIds: ["capability.common.investigate"],
      requiredResourceCosts: [],
      optionalCardTags: ["RECORD_ACCESS", "RELATION", "AUTHORITY"],
      revealRules: [{ claimKey, statement: `现有来源能够有限支持：${fact.content}`, strength: 2, when: "ALWAYS" }],
      evidenceCeiling: "CORROBORATION",
      mayLearn: ["这条说法最接近原始来源的依据", "经手人与时间关系"],
      cannotProve: commonCannotProve,
      settlementMoment: { kind: "IMMEDIATE_AFTER_COMMIT" },
      observableTrail: { summary: "相关经手人可能察觉有人正在核验这条说法。", audiencePolicyId: "source-custodian" },
      counterTags: ["SOURCE_HIDDEN", "SOURCE_FORGED", "ACCESS_BLOCKED"],
      expiresWithTrace: true,
    },
    {
      routeId: compareRouteId,
      traceId,
      label: "寻找独立记录交叉核对",
      narrativeMethod: `不依赖同一转述，另找一份独立记录或证人核对“${trace.title}”`,
      requiredCapabilityIds: ["capability.common.investigate"],
      requiredResourceCosts: [],
      optionalCardTags: ["RECORD_ACCESS", "WITNESS", "RELATION"],
      revealRules: [{ claimKey, statement: `另一来源与现有痕迹在有限范围内相互吻合：${fact.content}`, strength: 2, when: "ALWAYS" }],
      evidenceCeiling: "CORROBORATION",
      mayLearn: ["是否存在独立来源支持同一有限命题", "两份记录一致和矛盾的部分"],
      cannotProve: commonCannotProve,
      settlementMoment: { kind: "BEFORE_MAIN_LOCK" },
      observableTrail: null,
      counterTags: ["WITNESS_SILENCED", "SOURCE_FORGED", "ACCESS_BLOCKED"],
      expiresWithTrace: true,
    },
  ];
  return { trace, routes };
}

function traceAndRoutesForEntry(input: ContinuousStoryV2ManeuverPackageInputV1, entry: ManeuverTimelineLikeV1) {
  const digest = shortHash(`${input.runId}|entry|${entry.id}`);
  const traceId = `trace.entry.${digest}`;
  const claimKey = `claim.entry.${digest}`;
  const routeId = `route.entry.${digest}.follow`;
  const trace: WorldTraceV1 = {
    traceId,
    runId: input.runId,
    title: entry.content.length > 34 ? `${entry.content.slice(0, 34)}…` : entry.content,
    narrativeHook: entry.content,
    traceType: "BEHAVIOR",
    subjectEntityIds: entry.roleId ? [entry.roleId] : [entry.id],
    sourceEventIds: [entry.id],
    supportedClaimKeys: [claimKey],
    sourceGroupKey: `entry:${entry.id}`,
    accessRoleIds: [input.actorRole.id],
    routeIds: [routeId],
    visibility: { scope: entry.visibility.toLowerCase() === "public" ? "PUBLIC" : "LIMITED", roleIds: [input.actorRole.id] },
    status: "ACTIVE",
    createdAtRevision: Number(entry.worldSequence || input.currentRevision),
    expiresAtStage: input.currentStage + 1,
  };
  const route: InvestigationRouteV1 = {
    routeId,
    traceId,
    label: "沿可见行动痕迹继续追查",
    narrativeMethod: `从“${trace.title}”留下的经手、地点或记录继续往下查`,
    requiredCapabilityIds: ["capability.common.investigate"],
    requiredResourceCosts: [],
    optionalCardTags: ["RELATION", "WITNESS", "RECORD_ACCESS"],
    revealRules: [{ claimKey, statement: `可以确认这项可见变化确实发生过：${entry.content}`, strength: 1, when: "ALWAYS" }],
    evidenceCeiling: "LEAD",
    mayLearn: ["这项变化经过了哪些可观察环节", "下一条可以继续追查的方向"],
    cannotProve: ["行动者没有留下痕迹的全部安排", "行动者的私人目标"],
    settlementMoment: { kind: "NEXT_ACTOR_TURN" },
    observableTrail: { summary: "沿这条痕迹追查可能让原经手人察觉。", audiencePolicyId: "trace-origin" },
    counterTags: ["TRACE_CLEANED", "TAIL_DETECTED"],
    expiresWithTrace: true,
  };
  return { trace, routes: [route] };
}

function genericRuleCard(asset: ManeuverAssetLikeV1, roleKey: string): RuleCardDefinitionV1 {
  const authorityLike = /authority|seal|order|command|channel|令|印|奏|权/i.test(`${asset.kind} ${asset.assetKey} ${asset.label}`);
  const timing: RuleCardDefinitionV1["timing"] = authorityLike
    ? ["ACTIVE", "SET", "ATTACH", "REACTION"]
    : ["ACTIVE", "ATTACH"];
  return {
    cardKey: `card.${asset.assetKey}`,
    label: asset.label,
    tags: authorityLike ? ["AUTHORITY", "ROLE_ASSET"] : ["RELATION", "ROLE_ASSET"],
    allowedRoleKeys: [roleKey],
    timing,
    legalTargetTypes: ["ROLE", "ACTOR", "PERSON", "DOCUMENT", "EVIDENCE", "RESOURCE", "LOCATION", "INSTITUTION", "PUBLIC_FRAME", "WORLD_ENTITY"],
    capabilityId: `capability.asset.${asset.assetKey}`,
    triggerPatternIds: authorityLike ? ["target_action_detected", "asset_transfer_attempt"] : [],
    guaranteedEffects: [`“${asset.label}”会按牌面身份正式进入所选行动。`],
    duration: { kind: authorityLike ? "UNTIL_TURN_END" : "INSTANT" },
    visibility: {
      beforeTrigger: { scope: "PRIVATE" },
      afterTrigger: { scope: authorityLike ? "OBSERVABLE" : "LIMITED" },
    },
    consumption: authorityLike ? "COOLDOWN" : "REUSABLE",
    cooldownStages: authorityLike ? 1 : undefined,
    counterTags: authorityLike ? ["HIGHER_AUTHORITY", "TARGET_MOVED", "TIMING_MISSED"] : ["SOURCE_DISPUTED"],
    playerFacingLimitations: ["不能替代另一名玩家的选择", "不能证明牌面之外的事实", "不能追回已经完成且不可逆的结果"],
  };
}

const GENERIC_ACTION_BINDINGS: ManeuverActionBindingV1[] = [
  {
    bindingId: "maneuver.binding.control",
    effectKey: "control_or_block",
    capabilityId: "capability.common.control",
    matchTerms: ["封锁", "控制", "限制", "拦截", "扣押", "接管", "block", "seal", "control", "intercept"],
    labels: {
      actionTitle: "控制或封锁目标",
      method: "封锁",
      guaranteedStart: ["命令或调动会正式发出，执行者开始接近目标。"],
      contestedOutcome: ["能否在目标状态改变之前建立控制", "现场权限、资源和其他行动会怎样回应"],
      notGuaranteed: ["目标仍然停留在原处", "已经完成的转移会被自动追回", "其他玩家会服从你的要求"],
      confirmLabel: "确认采取控制行动",
    },
    legalTargetTypes: ["LOCATION", "DOCUMENT", "RESOURCE", "WORLD_ENTITY"],
    defaultVisibility: { scope: "OBSERVABLE" },
    tracePolicy: { leavesTrace: true, playerSafeHint: "调动、命令或封锁会留下可观察过程。" },
    reactionPolicy: { mode: "IF_OBSERVED", playerSafeHint: "受到直接影响、并且察觉行动的人可能获得应变机会。" },
    timing: { startsAt: "ON_COMMIT", settlesAt: { kind: "CURRENT_SETTLEMENT" }, playerLabel: "本场景结算时" },
    costs: [],
  },
  {
    bindingId: "maneuver.binding.move",
    effectKey: "move_or_transfer",
    capabilityId: "capability.common.move",
    matchTerms: ["转移", "搬运", "送走", "运走", "移交", "护送", "move", "transfer", "transport"],
    labels: {
      actionTitle: "转移目标",
      method: "转移",
      guaranteedStart: ["经手人会收到转移安排，并开始接触目标。"],
      contestedOutcome: ["目标能否在被发现、封锁或拦截前离开原处"],
      notGuaranteed: ["转移过程不会留下经手、路线或登记痕迹", "目标内容一定完整真实"],
      confirmLabel: "确认开始转移",
    },
    legalTargetTypes: ["DOCUMENT", "EVIDENCE", "RESOURCE", "WORLD_ENTITY"],
    defaultVisibility: { scope: "OBSERVABLE" },
    tracePolicy: { leavesTrace: true, playerSafeHint: "搬运或转交可能留下经手、时间和路线痕迹。" },
    reactionPolicy: { mode: "IF_OBSERVED", playerSafeHint: "察觉转移的人可能应变。" },
    timing: { startsAt: "ON_COMMIT", settlesAt: { kind: "CURRENT_SETTLEMENT" }, playerLabel: "本场景结算时" },
    costs: [],
  },
  {
    bindingId: "maneuver.binding.protect",
    effectKey: "protect_target",
    capabilityId: "capability.common.protect",
    matchTerms: ["保护", "保全", "藏匿", "掩护", "守护", "protect", "secure", "safeguard"],
    labels: {
      actionTitle: "保护目标",
      method: "保护",
      guaranteedStart: ["保护安排会送达，可信人手开始接触目标。"],
      contestedOutcome: ["保护能否在压力、转移或限制生效前建立"],
      notGuaranteed: ["目标会完全信任你", "保护会消除已经发生的全部影响"],
      confirmLabel: "确认安排保护",
    },
    legalTargetTypes: ["ROLE", "ACTOR", "PERSON", "DOCUMENT", "EVIDENCE", "RESOURCE"],
    defaultVisibility: { scope: "OBSERVABLE" },
    tracePolicy: { leavesTrace: true, playerSafeHint: "被保护者及其周围的人可能察觉安排。" },
    reactionPolicy: { mode: "IF_OBSERVED", playerSafeHint: "原本控制或威胁目标的人可能改变做法。" },
    timing: { startsAt: "ON_COMMIT", settlesAt: { kind: "CURRENT_SETTLEMENT" }, playerLabel: "本场景结算时" },
    costs: [],
  },
  {
    bindingId: "maneuver.binding.disclose",
    effectKey: "disclose_or_submit",
    capabilityId: "capability.common.disclose",
    matchTerms: ["公开", "提交", "上奏", "发布", "呈交", "揭露", "disclose", "publish", "submit", "report"],
    labels: {
      actionTitle: "公开或提交材料",
      method: "公开",
      guaranteedStart: ["材料会按你选择的范围送出或公开。"],
      contestedOutcome: ["接收者如何解释、质疑或利用材料"],
      notGuaranteed: ["所有人会相信材料", "材料能证明其牌面之外的命题"],
      confirmLabel: "确认送出材料",
    },
    legalTargetTypes: ["DOCUMENT", "EVIDENCE", "INSTITUTION", "PUBLIC_FRAME"],
    defaultVisibility: { scope: "PUBLIC" },
    tracePolicy: { leavesTrace: true, playerSafeHint: "材料的发送、公开和接收都会留下记录。" },
    reactionPolicy: { mode: "ALWAYS", playerSafeHint: "被材料直接影响的人可能获得回应机会。" },
    timing: { startsAt: "ON_COMMIT", settlesAt: { kind: "CURRENT_SETTLEMENT" }, playerLabel: "公开或送达后" },
    costs: [],
  },
  {
    bindingId: "maneuver.binding.influence",
    effectKey: "support_or_delay",
    capabilityId: "capability.common.influence",
    matchTerms: ["支持", "推动", "拖延", "反对", "投入", "施压", "推进", "support", "delay", "oppose", "influence"],
    labels: {
      actionTitle: "推动局势",
      method: "推进",
      guaranteedStart: ["你的立场、资源或正式要求会进入当前争点。"],
      contestedOutcome: ["局势会朝哪个方向移动，以及其他参与者如何加码或反制"],
      notGuaranteed: ["争点会立即按你的期望结束", "其他玩家会公开站在你一边"],
      confirmLabel: "确认推动这项局势",
    },
    legalTargetTypes: ["PUBLIC_FRAME", "INSTITUTION", "ROLE", "RESOURCE"],
    defaultVisibility: { scope: "PUBLIC" },
    tracePolicy: { leavesTrace: true, playerSafeHint: "你的公开站位或投入会改变其他人的预期。" },
    reactionPolicy: { mode: "ALWAYS", playerSafeHint: "争点中的其他参与者可能回应。" },
    timing: { startsAt: "ON_COMMIT", settlesAt: { kind: "CURRENT_SETTLEMENT" }, playerLabel: "当前争点结算时" },
    costs: [],
  },
];

export function buildContinuousStoryV2ManeuverPackageV1(input: ContinuousStoryV2ManeuverPackageInputV1): ContinuousStoryV2ManeuverPackageV1 {
  const contacts: ContactDefinitionV1[] = input.roles
    .filter((role) => role.id !== input.actorRole.id)
    .map((role) => ({
      actorId: role.id,
      roleId: role.id,
      displayName: role.roleName,
      publicIdentity: role.identity || role.publicInfo || "当前局势中的独立角色",
      currentAccess: "可以发起一次定向交谈",
      whyRelevant: role.publicInfo || role.identity || "他的选择可能影响共同世界",
      canReceiveEvidence: true,
      visibilityOptions: ["LIMITED", "PUBLIC"],
      accessibleByRoleIds: [input.actorRole.id],
    }));

  const dynamic = [
    ...input.visibleFacts.slice(-6).map((fact) => traceAndRoutesForFact(input, fact)),
    ...input.observableEntries.slice(-4).map((entry) => traceAndRoutesForEntry(input, entry)),
  ];
  const traceMap = new Map<string, WorldTraceV1>();
  const routeMap = new Map<string, InvestigationRouteV1>();
  for (const item of dynamic) {
    traceMap.set(item.trace.traceId, item.trace);
    for (const route of item.routes) routeMap.set(route.routeId, route);
  }

  const ownedAssets = input.assets.filter((asset) => (
    asset.ownerRoleId === input.actorRole.id
    && asset.quantity > 0
    && ["ACTIVE", "LOCKED"].includes(asset.status)
    && asset.kind !== "EVIDENCE_CARD_V1"
  ));
  const ruleCards = ownedAssets.map((asset) => genericRuleCard(asset, input.actorRole.roleKey));
  const ruleCardHoldings: RuleCardHoldingV1[] = ownedAssets.map((asset) => {
    const maneuver = asRecord(asRecord(asset.stateJson).maneuverRulesV1);
    const cooldownUntilStage = Number(maneuver.cooldownUntilStage || 0);
    const armedForCurrentTurn = maneuver.status === "ARMED"
      && (!maneuver.expiresAtTurnId || maneuver.expiresAtTurnId === input.currentTurnId);
    const staleTurnLock = maneuver.status === "ARMED"
      && typeof maneuver.expiresAtTurnId === "string"
      && maneuver.expiresAtTurnId !== input.currentTurnId;
    const status: RuleCardHoldingV1["status"] = (asset.status === "LOCKED" && !staleTurnLock) || armedForCurrentTurn
      ? "LOCKED"
      : maneuver.status === "COOLDOWN" && cooldownUntilStage > input.currentStage
        ? "COOLDOWN"
        : "AVAILABLE";
    return {
      cardAssetKey: asset.assetKey,
      cardKey: `card.${asset.assetKey}`,
      ownerRoleId: input.actorRole.id,
      status,
      ...(cooldownUntilStage > 0 ? { cooldownUntilStage } : {}),
    };
  });
  const evidence = input.assets.flatMap((asset) => {
    const card = evidenceFromAsset(asset);
    return card ? [card] : [];
  });

  const roleTargets: ActionTargetV1[] = input.roles
    .filter((role) => role.id !== input.actorRole.id)
    .map((role) => ({ type: "ROLE", id: role.id, label: role.roleName, aliases: [role.roleKey] }));
  const targetMap = new Map<string, ActionTargetV1>();
  for (const target of [...input.availableTargets, ...roleTargets]) targetMap.set(target.id, target);

  return {
    contacts,
    traces: [...traceMap.values()],
    investigationRoutes: [...routeMap.values()],
    ruleCards,
    ruleCardHoldings,
    actionBindings: GENERIC_ACTION_BINDINGS,
    targets: [...targetMap.values()],
    evidence,
    capabilityIds: [
      "capability.common.investigate",
      "capability.common.control",
      "capability.common.move",
      "capability.common.protect",
      "capability.common.disclose",
      "capability.common.influence",
      ...ruleCards.map((card) => card.capabilityId),
    ],
    resourceAmounts: {},
  };
}
