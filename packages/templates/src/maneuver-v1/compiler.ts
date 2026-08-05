import { createHash } from "node:crypto";
import {
  ActionPreviewResponseV1,
  ActionTargetV1,
  CardLayoutDraftV1,
  CompiledManeuverActionV1,
  ConversationDraftV1,
  CreateActionPreviewCommandV1,
  CustomPlanCandidateV1,
  CustomPlanDraftV1,
  EvidenceCardStateV1,
  InvestigationDraftV1,
  InvestigationRouteV1,
  ManeuverActionBindingV1,
  ManeuverCompileContextV1,
  ManeuverDraftV1,
  ManeuverKindV1,
  ReactionDraftV1,
  RuleCardDefinitionV1,
} from "./types";
import {
  buildCardLayoutPresentation,
  buildConversationPresentation,
  buildCustomPlanPresentation,
  buildInvestigationPresentation,
  buildReactionPresentation,
  settlementMomentLabel,
} from "./presentation";
import { parseCreateActionPreviewCommandV1 } from "./validation";

const ASK_PATTERNS = [/(?:询问|追问|试探|劝说|说服|谈判|交谈|告诉|威胁|要求)/u, /(?:ask|tell|persuade|negotiate|threaten)\b/i];
const INVESTIGATE_PATTERNS = [/(?:调查|查明|核查|追查|跟踪|验证|核验|查阅|检查|辨认|寻找线索)/u, /(?:investigate|verify|trace|inspect|follow|check records)\b/i];
const CARD_PATTERNS = [/(?:使用|打出|伏置|埋伏|发动|亮出).{0,16}(?:筹码|卡|令牌|技能|权限|密信|渠道)/u, /(?:play|set|use).{0,12}(?:card|token|ability)/i];
const DISCLOSE_EVIDENCE_PATTERNS = [
  /(?:公开|出示|展示|提交|呈交|转交|发布|揭露).{0,24}(?:证据|记录|文书|账页|密信|材料)/u,
  /(?:disclose|show|share|submit|publish|reveal).{0,20}(?:evidence|record|document)/i,
];
const CONTROL_OTHER_PATTERNS = [/(?:让|命令|强迫|控制).{0,20}(?:玩家|角色).{0,10}(?:必须|立即|一定|支持|反对|背叛|投票)/u, /(?:force|make).{0,12}(?:player|character).{0,12}(?:support|betray|vote)/i];
const DECLARE_SUCCESS_PATTERNS = [/(?:确保|保证|宣布|直接).{0,16}(?:成功|已经完成|必然获胜|全部拿回|彻底控制)/u, /(?:guarantee|declare).{0,12}(?:success|victory|completed)/i];
const FUTURE_OR_MIND_PATTERNS = [/(?:读取|查清|看穿).{0,12}(?:内心|私人目标|未来选择|一定会不会|下一步一定)/u, /(?:read).{0,12}(?:mind|private goal|future choice)/i];

const CLAUSE_SPLIT = /(?:；|;|。|\n|然后|同时|并且|随后|接着|之后)/u;
const ACTION_VERB = /(?:问|询问|试探|谈|说服|交换|威胁|调查|查明|核查|追查|跟踪|验证|核验|查阅|检查|使用|打出|伏置|亮出|调动|派|封锁|控制|转移|保护|公开|隐藏|支持|削弱|推进|拖延|提交|上奏|逮捕|限制|拦截|夺取|命令)/u;

const PURPOSE_LABELS: Record<NonNullable<ConversationDraftV1["purpose"]>, string> = {
  ASK: "询问一项信息",
  TEST: "试探对方的反应",
  PERSUADE: "说服对方",
  EXCHANGE: "交换信息或条件",
  PRESSURE: "向对方施压",
  PROPOSE_TERM: "提出一项条件",
};

function previewId(command: CreateActionPreviewCommandV1, context: ManeuverCompileContextV1): string {
  return `preview_${createHash("sha256")
    .update(`${context.runId}|${context.actorTurnId}|${command.idempotencyKey}|${JSON.stringify(command.draft)}`)
    .digest("hex")
    .slice(0, 24)}`;
}

function expiresAt(context: ManeuverCompileContextV1): string {
  const base = Date.parse(context.nowIso);
  const validBase = Number.isFinite(base) ? base : Date.now();
  return new Date(validBase + context.previewTtlSeconds * 1000).toISOString();
}

function baseAction(
  context: ManeuverCompileContextV1,
  kind: ManeuverKindV1,
  target: ActionTargetV1,
): Pick<CompiledManeuverActionV1,
  | "schemaVersion"
  | "actionKind"
  | "slot"
  | "runId"
  | "actorTurnId"
  | "actorRoleId"
  | "actorId"
  | "target"
  | "turnRevision"
  | "stateRevision"
  | "maneuverWindowVersion"
  | "controlEpoch"
  | "contextHash"
> {
  return {
    schemaVersion: "compiled_maneuver_action_v1",
    actionKind: kind,
    slot: context.slot,
    runId: context.runId,
    actorTurnId: context.actorTurnId,
    actorRoleId: context.actorRoleId,
    actorId: context.actorId,
    target,
    turnRevision: context.turnRevision,
    stateRevision: context.stateRevision,
    maneuverWindowVersion: context.maneuverWindowVersion,
    controlEpoch: context.controlEpoch,
    contextHash: context.contextHash,
  };
}

function ready(
  command: CreateActionPreviewCommandV1,
  context: ManeuverCompileContextV1,
  compiledAction: CompiledManeuverActionV1,
  presentation: NonNullable<ActionPreviewResponseV1["presentation"]>,
  matchedRuleIds: string[],
): ActionPreviewResponseV1 {
  return {
    schemaVersion: "action_preview_response_v1",
    decision: "READY",
    previewId: previewId(command, context),
    expiresAt: expiresAt(context),
    compiledAction,
    presentation,
    safeDebug: { matchedRuleIds, riskFlags: [] },
  };
}

function blocked(reason: string, riskFlags: string[] = []): ActionPreviewResponseV1 {
  return {
    schemaVersion: "action_preview_response_v1",
    decision: "BLOCKED",
    previewId: null,
    expiresAt: null,
    reason,
    safeDebug: { matchedRuleIds: [], riskFlags },
  };
}

function reroute(kind: ManeuverKindV1, reason: string, suggestedDraft?: ManeuverDraftV1): ActionPreviewResponseV1 {
  return {
    schemaVersion: "action_preview_response_v1",
    decision: "REROUTE_REQUIRED",
    previewId: null,
    expiresAt: null,
    rerouteKind: kind,
    reason,
    suggestedDraft,
    safeDebug: { matchedRuleIds: [`reroute:${kind}`], riskFlags: [] },
  };
}

function compileConversation(
  command: CreateActionPreviewCommandV1,
  context: ManeuverCompileContextV1,
  draft: ConversationDraftV1,
): ActionPreviewResponseV1 {
  const contact = context.contacts.find((item) => item.actorId === draft.targetActorId && item.accessibleByRoleIds.includes(context.actorRoleId));
  if (!contact) return blocked("当前角色无法接触这个人物。", ["TARGET_NOT_VISIBLE"]);
  if (!contact.visibilityOptions.includes(draft.visibility)) {
    return blocked("这个人物当前不允许以所选范围交谈。", ["VISIBILITY_NOT_ALLOWED"]);
  }
  if (draft.attachmentAssetKeys.length > 0) {
    const assetKey = draft.attachmentAssetKeys[0];
    const ownsEvidence = context.evidence.some((card) => card.evidenceId === assetKey && card.ownerRoleId === context.actorRoleId);
    const holding = context.ruleCardHoldings.find((item) => item.cardAssetKey === assetKey && item.ownerRoleId === context.actorRoleId && item.status === "AVAILABLE");
    const attachableCard = holding && context.ruleCards.find((item) => item.cardKey === holding.cardKey && item.timing.includes("ATTACH"));
    if (!ownsEvidence && !attachableCard) {
      return blocked("附加的筹码或证据不在当前角色手中，或不能附加到人物交谈。", ["ATTACHMENT_NOT_ALLOWED"]);
    }
  }
  const purpose = draft.purpose || "ASK";
  const action: CompiledManeuverActionV1 = {
    ...baseAction(context, "CONVERSATION", { type: "ACTOR", id: contact.actorId, label: contact.displayName }),
    objective: PURPOSE_LABELS[purpose],
    method: draft.message,
    primaryEffect: { kind: "OPEN_INTERACTION", targetActorId: contact.actorId, requestKind: purpose },
    guaranteedStart: [{ statement: `${contact.displayName}会收到这段话。` }],
    contestedOutcome: [{ statement: `${contact.displayName}如何回答，以及是否接受其中的条件。` }],
    notGuaranteed: [
      { statement: `${contact.displayName}会回答。` },
      { statement: `${contact.displayName}会说真话、相信你或照你的要求行动。` },
      ...(draft.formalAgreementRequested ? [{ statement: "对方会接受正式协议。" }] : []),
    ],
    costs: [{ kind: "OPPORTUNITY", amount: 1, label: "1 次谋划" }],
    timing: {
      startsAt: "ON_COMMIT",
      settlesAt: { kind: "CURRENT_SETTLEMENT" },
      playerLabel: "对方回应后揭晓",
    },
    visibility: draft.visibility === "PUBLIC" ? { scope: "PUBLIC" } : { scope: "LIMITED", actorIds: [context.actorId, contact.actorId] },
    tracePolicy: {
      leavesTrace: true,
      playerSafeHint: draft.visibility === "PUBLIC"
        ? "所有在场者都会知道你公开找过对方。"
        : `${contact.displayName}会知道你正在关注这件事。`,
    },
    reactionPolicy: { mode: "NONE", playerSafeHint: null },
    attachedAssetKeys: [...draft.attachmentAssetKeys],
    sourceEvidenceIds: draft.attachmentAssetKeys.filter((key) => context.evidence.some((card) => card.evidenceId === key)),
    settlementBindingId: "maneuver.conversation.v1",
  };
  return ready(
    command,
    context,
    action,
    buildConversationPresentation(action, {
      actorLabel: context.actorLabel,
      targetLabel: contact.displayName,
      message: draft.message,
      purposeLabel: PURPOSE_LABELS[purpose],
    }),
    ["conversation.boundary.v1"],
  );
}


function safeExecutorLabel(route: InvestigationRouteV1): string {
  const label = route.requiredResourceCosts[0]?.label?.trim();
  if (!label) return "一名可靠的执行者";
  if (/^(一名|一位|一队|一个|1\s*)/u.test(label)) return label;
  return `一名${label}`;
}

function compileInvestigation(
  command: CreateActionPreviewCommandV1,
  context: ManeuverCompileContextV1,
  draft: InvestigationDraftV1,
): ActionPreviewResponseV1 {
  const trace = context.traces.find((item) => item.traceId === draft.traceId && item.accessRoleIds.includes(context.actorRoleId));
  if (!trace) return blocked("当前角色没有发现这条可追查痕迹。", ["TRACE_NOT_VISIBLE"]);
  if (trace.status !== "ACTIVE" && trace.status !== "OBSCURED") {
    return blocked("这条痕迹已经不能继续追查。", [`TRACE_${trace.status}`]);
  }
  const route = context.investigationRoutes.find((item) => item.routeId === draft.routeId && item.traceId === trace.traceId && trace.routeIds.includes(item.routeId));
  if (!route) return blocked("这条调查路线不属于当前痕迹。", ["ROUTE_NOT_ALLOWED"]);
  for (const capability of route.requiredCapabilityIds) {
    if (!context.capabilityIds.includes(capability)) return blocked("当前角色缺少执行这条路线所需的能力。", [`CAPABILITY_REQUIRED:${capability}`]);
  }
  for (const cost of route.requiredResourceCosts) {
    if ((context.resourceAmounts[cost.resourceId] || 0) < cost.amount) {
      return blocked(`当前资源不足：${cost.label}。`, [`RESOURCE_REQUIRED:${cost.resourceId}`]);
    }
  }
  if (draft.attachmentAssetKeys.length > 0) {
    const holding = context.ruleCardHoldings.find((item) => item.cardAssetKey === draft.attachmentAssetKeys[0] && item.ownerRoleId === context.actorRoleId && item.status === "AVAILABLE");
    const card = holding && context.ruleCards.find((item) => item.cardKey === holding.cardKey);
    if (!holding || !card || !card.timing.includes("ATTACH")) {
      return blocked("所选筹码不能附加到当前调查。", ["ATTACHMENT_NOT_ALLOWED"]);
    }
  }
  const resourceCosts = route.requiredResourceCosts.map((cost) => ({
    kind: "RESOURCE" as const,
    id: cost.resourceId,
    amount: cost.amount,
    label: `${cost.label} ${cost.amount}`,
  }));
  // The client may carry an executor asset key for a future selector, but it is
  // not an authoritative display label.  Until the compile context exposes an
  // allow-listed executor holding, derive a safe role label from the route
  // contract so arbitrary client text cannot enter narrative previews.
  const executor = safeExecutorLabel(route);
  const action: CompiledManeuverActionV1 = {
    ...baseAction(context, "INVESTIGATION", { type: "TRACE", id: trace.traceId, label: trace.title }),
    objective: `沿“${trace.title}”取得有限证据`,
    method: route.narrativeMethod,
    primaryEffect: { kind: "START_INVESTIGATION", traceId: trace.traceId, routeId: route.routeId },
    guaranteedStart: [{ statement: `调查者会沿“${trace.title}”执行“${route.label}”。` }],
    contestedOutcome: route.mayLearn.map((statement) => ({ statement })),
    notGuaranteed: route.cannotProve.map((statement) => ({ statement })),
    costs: [
      { kind: "OPPORTUNITY", amount: 1, label: "1 次谋划" },
      ...resourceCosts,
      ...(draft.attachmentAssetKeys.length > 0
        ? [{ kind: "ASSET_LOCK" as const, id: draft.attachmentAssetKeys[0], label: "附加 1 张筹码" }]
        : []),
    ],
    timing: {
      startsAt: "ON_COMMIT",
      settlesAt: route.settlementMoment,
      playerLabel: settlementMomentLabel(route),
    },
    visibility: { scope: "PRIVATE", roleIds: [context.actorRoleId] },
    tracePolicy: {
      leavesTrace: Boolean(route.observableTrail),
      playerSafeHint: route.observableTrail?.summary || null,
    },
    reactionPolicy: {
      mode: route.observableTrail ? "IF_OBSERVED" : "NONE",
      playerSafeHint: route.observableTrail ? "察觉调查痕迹的人可能改变做法。" : null,
      eligibleAudiencePolicyId: route.observableTrail?.audiencePolicyId,
    },
    attachedAssetKeys: [...draft.attachmentAssetKeys],
    sourceEvidenceIds: [],
    settlementBindingId: `maneuver.investigation.${route.routeId}`,
  };
  return ready(
    command,
    context,
    action,
    buildInvestigationPresentation(action, {
      actorLabel: context.actorLabel,
      route,
      executorLabel: executor,
      traceTitle: trace.title,
    }),
    [`investigation.route:${route.routeId}`],
  );
}

function cardForDraft(
  context: ManeuverCompileContextV1,
  draft: CardLayoutDraftV1,
): { card: RuleCardDefinitionV1; target: ActionTargetV1 } | ActionPreviewResponseV1 {
  const holding = context.ruleCardHoldings.find((item) => item.cardAssetKey === draft.cardAssetKey && item.ownerRoleId === context.actorRoleId);
  if (!holding || holding.status !== "AVAILABLE") return blocked("这张筹码当前不在可用状态。", ["CARD_NOT_AVAILABLE"]);
  const card = context.ruleCards.find((item) => item.cardKey === holding.cardKey);
  if (!card || !card.allowedRoleKeys.includes(context.actorRoleKey)) return blocked("当前角色不能使用这张筹码。", ["CARD_ROLE_DENIED"]);
  if (!card.timing.includes(draft.playMode)) return blocked("这张筹码不能在所选时机使用。", ["CARD_TIMING_DENIED"]);
  if (draft.playMode === "SET" && (!draft.triggerPatternId || !card.triggerPatternIds.includes(draft.triggerPatternId))) {
    return blocked("所选触发条件不在这张筹码的牌面规则中。", ["CARD_TRIGGER_DENIED"]);
  }
  const target = context.targets.find((item) => item.id === draft.targetId);
  if (!target || !card.legalTargetTypes.includes(target.type)) return blocked("这张筹码不能作用于所选目标。", ["CARD_TARGET_DENIED"]);
  return { card, target };
}

function compileCardLayout(
  command: CreateActionPreviewCommandV1,
  context: ManeuverCompileContextV1,
  draft: CardLayoutDraftV1,
): ActionPreviewResponseV1 {
  const selected = cardForDraft(context, draft);
  if ("decision" in selected) return selected;
  const { card, target } = selected;
  const set = draft.playMode === "SET";
  const action: CompiledManeuverActionV1 = {
    ...baseAction(context, "CARD_LAYOUT", target),
    objective: set ? `在“${target.label}”上伏置“${card.label}”` : `对“${target.label}”打出“${card.label}”`,
    method: set ? "按牌面允许的触发条件秘密伏置" : "主动打出规则筹码",
    primaryEffect: {
      kind: "PLAY_RULE_CARD",
      cardAssetKey: draft.cardAssetKey,
      playMode: draft.playMode,
      triggerPatternId: draft.triggerPatternId,
    },
    guaranteedStart: card.guaranteedEffects.map((statement) => ({ statement })),
    contestedOutcome: card.counterTags.length > 0
      ? [{ statement: `筹码能否避开或压过允许的反制：${card.counterTags.join("、")}。` }]
      : [],
    notGuaranteed: card.playerFacingLimitations.map((statement) => ({ statement })),
    costs: [
      { kind: "OPPORTUNITY", amount: 1, label: "1 次谋划" },
      {
        kind: card.consumption === "CONSUME" ? "ASSET_CONSUME" : card.consumption === "COOLDOWN" ? "COOLDOWN" : "ASSET_LOCK",
        id: draft.cardAssetKey,
        label: card.consumption === "CONSUME"
          ? "消耗 1 张筹码"
          : card.consumption === "COOLDOWN"
            ? `进入冷却${card.cooldownStages ? ` ${card.cooldownStages} 阶段` : ""}`
            : "锁定 1 张筹码",
      },
    ],
    timing: {
      startsAt: set ? "ON_TRIGGER" : "ON_COMMIT",
      settlesAt: set ? { kind: "ON_WORLD_EVENT", eventPatternId: draft.triggerPatternId! } : { kind: "CURRENT_SETTLEMENT" },
      playerLabel: set ? "条件出现时自动进入结算" : "本场景结算时",
    },
    visibility: set ? card.visibility.beforeTrigger : card.visibility.afterTrigger,
    tracePolicy: {
      leavesTrace: !set || card.visibility.beforeTrigger.scope !== "PRIVATE",
      playerSafeHint: set ? "伏置本身保持秘密，但准备过程可能产生世界允许的异常。" : "筹码生效后，相关人物会看到牌面允许的变化。",
    },
    reactionPolicy: {
      mode: "IF_OBSERVED",
      playerSafeHint: "受到牌面效果直接影响的人可能获得应变机会。",
    },
    attachedAssetKeys: [draft.cardAssetKey],
    sourceEvidenceIds: [],
    settlementBindingId: `maneuver.card.${card.cardKey}`,
  };
  return ready(
    command,
    context,
    action,
    buildCardLayoutPresentation(action, {
      actorLabel: context.actorLabel,
      card,
      targetLabel: target.label,
      playMode: draft.playMode,
      triggerLabel: draft.triggerPatternId,
    }),
    [`card:${card.cardKey}`, `timing:${draft.playMode}`],
  );
}

function contains(patterns: RegExp[], text: string): boolean {
  return patterns.some((pattern) => pattern.test(text));
}

function splitCustomClauses(text: string): string[] {
  return text
    .split(CLAUSE_SPLIT)
    .map((part) => part.trim())
    .filter((part) => part.length > 0 && ACTION_VERB.test(part));
}

function findTarget(context: ManeuverCompileContextV1, text: string): ActionTargetV1 | null {
  const normalized = text.toLowerCase();
  const matches = context.targets
    .map((target) => {
      const terms = [target.label, target.id, ...(target.aliases || [])]
        .map((term) => term.toLowerCase())
        .filter((term) => term.length > 0);
      const matchedTerm = terms
        .filter((term) => normalized.includes(term))
        .sort((a, b) => b.length - a.length)[0];
      return matchedTerm ? { target, score: matchedTerm.length } : null;
    })
    .filter((item): item is { target: ActionTargetV1; score: number } => Boolean(item))
    .sort((a, b) => b.score - a.score || b.target.label.length - a.target.label.length);
  return matches[0]?.target || null;
}

function candidatesForCustom(context: ManeuverCompileContextV1, draft: CustomPlanDraftV1): CustomPlanCandidateV1[] {
  const clauses = splitCustomClauses(draft.rawText);
  const effectiveClauses = clauses.length > 0 ? clauses : [draft.rawText];
  const result: CustomPlanCandidateV1[] = [];
  for (const [index, clause] of effectiveClauses.entries()) {
    const target = findTarget(context, clause) || findTarget(context, draft.rawText);
    if (!target) continue;
    const normalizedClause = clause.toLowerCase();
    const compatible = context.actionBindings.filter((item) => item.legalTargetTypes.includes(target.type));
    const binding = compatible
      .map((item) => {
        const terms = [
          item.labels.actionTitle,
          item.effectKey,
          item.labels.method,
          ...(item.matchTerms || []),
        ].map((term) => term.toLowerCase()).filter(Boolean);
        const matched = terms.filter((term) => normalizedClause.includes(term)).sort((a, b) => b.length - a.length)[0];
        return matched ? { item, score: matched.length } : null;
      })
      .filter((entry): entry is { item: ManeuverActionBindingV1; score: number } => Boolean(entry))
      .sort((a, b) => b.score - a.score)[0]?.item
      || compatible[0];
    if (!binding || !context.capabilityIds.includes(binding.capabilityId)) continue;
    result.push({
      candidateId: `candidate_${index + 1}`,
      label: binding.labels.actionTitle,
      objective: binding.labels.actionTitle,
      target,
      effectKey: binding.effectKey,
      capabilityId: binding.capabilityId,
      matchedBindingId: binding.bindingId,
      rawText: clause,
    });
  }
  return result;
}

function suggestedConversation(context: ManeuverCompileContextV1, draft: CustomPlanDraftV1): ConversationDraftV1 | undefined {
  const contact = context.contacts.find((item) => draft.rawText.includes(item.displayName) || draft.rawText.includes(item.actorId));
  if (!contact) return undefined;
  return {
    schemaVersion: "maneuver_draft_v1",
    kind: "CONVERSATION",
    targetActorId: contact.actorId,
    message: draft.rawText,
    purpose: "ASK",
    visibility: "LIMITED",
    attachmentAssetKeys: [...draft.attachmentAssetKeys],
    formalAgreementRequested: false,
  };
}

function suggestedInvestigation(context: ManeuverCompileContextV1): InvestigationDraftV1 | undefined {
  const trace = context.traces.find((item) => item.accessRoleIds.includes(context.actorRoleId) && (item.status === "ACTIVE" || item.status === "OBSCURED"));
  const route = trace && context.investigationRoutes.find((item) => item.traceId === trace.traceId && trace.routeIds.includes(item.routeId));
  if (!trace || !route) return undefined;
  return {
    schemaVersion: "maneuver_draft_v1",
    kind: "INVESTIGATION",
    traceId: trace.traceId,
    routeId: route.routeId,
    attachmentAssetKeys: [],
  };
}

function suggestedCard(context: ManeuverCompileContextV1): CardLayoutDraftV1 | undefined {
  const holding = context.ruleCardHoldings.find((item) => item.ownerRoleId === context.actorRoleId && item.status === "AVAILABLE");
  const card = holding && context.ruleCards.find((item) => item.cardKey === holding.cardKey && item.timing.includes("ACTIVE"));
  const target = card && context.targets.find((item) => card.legalTargetTypes.includes(item.type));
  if (!holding || !card || !target) return undefined;
  return {
    schemaVersion: "maneuver_draft_v1",
    kind: "CARD_LAYOUT",
    cardAssetKey: holding.cardAssetKey,
    playMode: "ACTIVE",
    targetId: target.id,
  };
}

function compileEvidenceDisclosure(
  command: CreateActionPreviewCommandV1,
  context: ManeuverCompileContextV1,
  draft: CustomPlanDraftV1,
  evidence: EvidenceCardStateV1,
): ActionPreviewResponseV1 {
  const mentionedTarget = findTarget(context, draft.rawText);
  const publicTarget = context.targets.find((item) => item.type === "PUBLIC_FRAME")
    || context.targets.find((item) => item.type === "INSTITUTION");
  const target = mentionedTarget || publicTarget;
  if (!target) {
    return {
      schemaVersion: "action_preview_response_v1",
      decision: "REWRITE_REQUIRED",
      previewId: null,
      expiresAt: null,
      reason: "请说明你准备把这份证据出示给谁，或者明确公开给所有人。",
      safeDebug: { matchedRuleIds: [], riskFlags: ["DISCLOSURE_AUDIENCE_REQUIRED"] },
    };
  }
  const directTarget = ["ROLE", "ACTOR", "PERSON"].includes(target.type);
  const publicAudience = draft.visibilityPreference === "PUBLIC" || (!directTarget && target.type === "PUBLIC_FRAME");
  const audience = publicAudience ? "PUBLIC" as const : directTarget ? "TARGET" as const : "ACTOR_SET" as const;
  const visibility = publicAudience
    ? { scope: "PUBLIC" as const }
    : directTarget
      ? { scope: "LIMITED" as const, actorIds: [context.actorId, target.id] }
      : { scope: "OBSERVABLE" as const };
  const action: CompiledManeuverActionV1 = {
    ...baseAction(context, "CUSTOM_PLAN", target),
    objective: publicAudience ? `公开《${evidence.title}》` : `向“${target.label}”出示《${evidence.title}》`,
    method: draft.rawText,
    primaryEffect: {
      kind: "DISCLOSE_EVIDENCE",
      evidenceAssetIds: [evidence.evidenceId],
      audience,
    },
    guaranteedStart: [{ statement: publicAudience ? "证据牌面允许公开的内容会进入公共记录。" : `${target.label}会看到这张证据允许共享的内容。` }],
    contestedOutcome: [{ statement: "接收者会怎样解释、质疑或利用这份证据。" }],
    notGuaranteed: [
      { statement: "所有人会相信这份证据。" },
      { statement: "证据能够证明牌面“不能证明”栏目之外的事实。" },
    ],
    costs: [
      { kind: "OPPORTUNITY", amount: 1, label: "1 次谋划" },
      { kind: "ASSET_LOCK", id: evidence.evidenceId, label: "出示 1 张证据" },
    ],
    timing: { startsAt: "ON_COMMIT", settlesAt: { kind: "CURRENT_SETTLEMENT" }, playerLabel: publicAudience ? "公开后" : "送达后" },
    visibility,
    tracePolicy: { leavesTrace: true, playerSafeHint: publicAudience ? "证据公开后，所有有资格的角色都能看到牌面命题。" : "接收者会知道你持有并出示了这份证据。" },
    reactionPolicy: { mode: publicAudience ? "ALWAYS" : "IF_OBSERVED", playerSafeHint: "被证据直接影响的人可能获得回应机会。" },
    attachedAssetKeys: [evidence.evidenceId],
    sourceEvidenceIds: [evidence.evidenceId],
    settlementBindingId: "maneuver.evidence.disclose.v1",
  };
  return ready(
    command,
    context,
    action,
    buildCustomPlanPresentation(action, {
      actorLabel: context.actorLabel,
      title: publicAudience ? `公开《${evidence.title}》` : `向${target.label}出示《${evidence.title}》`,
      narrative: publicAudience
        ? `你准备把《${evidence.title}》的可公开内容送入公共记录。系统只会确认牌面列明的有限命题。`
        : `你准备把《${evidence.title}》出示给${target.label}。对方只会看到这张证据允许共享的内容。`,
      confirmLabel: publicAudience ? "确认公开这份证据" : `向${target.label}出示证据`,
    }),
    ["evidence.disclosure.v1"],
  );
}

function compileCustomPlan(
  command: CreateActionPreviewCommandV1,
  context: ManeuverCompileContextV1,
  draft: CustomPlanDraftV1,
): ActionPreviewResponseV1 {
  if (contains(CONTROL_OTHER_PATTERNS, draft.rawText)) {
    return blocked("你可以向其他玩家提出要求或施压，但不能直接决定他们的选择。", ["CONTROL_OTHER_PLAYER"]);
  }
  if (contains(DECLARE_SUCCESS_PATTERNS, draft.rawText)) {
    return {
      schemaVersion: "action_preview_response_v1",
      decision: "REWRITE_REQUIRED",
      previewId: null,
      expiresAt: null,
      reason: "请描述你实际采取的手段，而不是直接宣布已经成功。",
      safeDebug: { matchedRuleIds: [], riskFlags: ["DECLARE_RESULT"] },
    };
  }
  if (contains(FUTURE_OR_MIND_PATTERNS, draft.rawText)) {
    return blocked("行动不能读取另一名玩家的内心、私人目标或未来选择。", ["UNKNOWN_INFORMATION"]);
  }
  const attachedEvidence = draft.attachmentAssetKeys.length === 1
    ? context.evidence.find((item) => item.evidenceId === draft.attachmentAssetKeys[0] && item.ownerRoleId === context.actorRoleId)
    : undefined;
  if (attachedEvidence && contains(DISCLOSE_EVIDENCE_PATTERNS, draft.rawText)) {
    return compileEvidenceDisclosure(command, context, draft, attachedEvidence);
  }
  if (contains(INVESTIGATE_PATTERNS, draft.rawText)) {
    return reroute("INVESTIGATION", "这项谋划的主要效果是获得信息，将按“派遣调查”的痕迹与路线规则执行。", suggestedInvestigation(context));
  }
  if (contains(ASK_PATTERNS, draft.rawText)) {
    return reroute("CONVERSATION", "这项谋划的主要效果是让一个人物回应，将按“人物交谈”规则执行。", suggestedConversation(context, draft));
  }
  if (contains(CARD_PATTERNS, draft.rawText)) {
    return reroute("CARD_LAYOUT", "这项谋划的主要效果来自一张规则筹码，将按“筹码布局”规则执行。", suggestedCard(context));
  }

  const candidates = candidatesForCustom(context, draft);
  const clauses = splitCustomClauses(draft.rawText);
  if (clauses.length > 1 || candidates.length > 1) {
    const options = (candidates.length > 0 ? candidates : clauses.map((clause, index) => ({
      candidateId: `candidate_${index + 1}`,
      label: clause,
      rawText: clause,
    }))).map((candidate) => ({
      optionId: candidate.candidateId,
      label: candidate.label,
      draft: {
        schemaVersion: "maneuver_draft_v1" as const,
        kind: "CUSTOM_PLAN" as const,
        rawText: candidate.rawText,
        attachmentAssetKeys: [...draft.attachmentAssetKeys],
        visibilityPreference: draft.visibilityPreference,
      },
    }));
    return {
      schemaVersion: "action_preview_response_v1",
      decision: "SPLIT_REQUIRED",
      previewId: null,
      expiresAt: null,
      reason: `这段谋划包含 ${options.length} 项独立主要行动，本次只能执行一项。`,
      splitOptions: options,
      safeDebug: { matchedRuleIds: [], riskFlags: ["MULTIPLE_PRIMARY_EFFECTS"] },
    };
  }
  if (candidates.length === 0) {
    return {
      schemaVersion: "action_preview_response_v1",
      decision: "REWRITE_REQUIRED",
      previewId: null,
      expiresAt: null,
      reason: "系统还不能把这段话收敛成一个明确目标、一个主要效果和一种可执行手段。请具体说明你要作用于什么，以及真正准备做什么。",
      safeDebug: { matchedRuleIds: [], riskFlags: ["NO_SUPPORTED_BINDING"] },
    };
  }

  const candidate = candidates[0];
  const binding = context.actionBindings.find((item) => item.bindingId === candidate.matchedBindingId)!;
  if (draft.attachmentAssetKeys.length > 0) {
    const attachment = context.ruleCardHoldings.find((item) => item.cardAssetKey === draft.attachmentAssetKeys[0] && item.ownerRoleId === context.actorRoleId && item.status === "AVAILABLE");
    const card = attachment && context.ruleCards.find((item) => item.cardKey === attachment.cardKey && item.timing.includes("ATTACH"));
    const evidence = context.evidence.find((item) => item.evidenceId === draft.attachmentAssetKeys[0] && item.ownerRoleId === context.actorRoleId);
    if (!card && !evidence) return blocked("附加的筹码或证据不在当前角色手中，或不能附加到这项行动。", ["ATTACHMENT_NOT_ALLOWED"]);
  }
  const visibility = draft.visibilityPreference === "PUBLIC"
    ? { scope: "PUBLIC" as const }
    : draft.visibilityPreference === "QUIET"
      ? { scope: "OBSERVABLE" as const }
      : binding.defaultVisibility;
  const action: CompiledManeuverActionV1 = {
    ...baseAction(context, "CUSTOM_PLAN", candidate.target),
    objective: candidate.objective,
    method: candidate.rawText,
    primaryEffect: {
      kind: "APPLY_CAPABILITY",
      capabilityId: candidate.capabilityId,
      effectKey: candidate.effectKey,
    },
    guaranteedStart: binding.labels.guaranteedStart.map((statement) => ({ statement })),
    contestedOutcome: binding.labels.contestedOutcome.map((statement) => ({ statement })),
    notGuaranteed: binding.labels.notGuaranteed.map((statement) => ({ statement })),
    costs: [
      { kind: "OPPORTUNITY", amount: 1, label: "1 次谋划" },
      ...binding.costs,
      ...(draft.attachmentAssetKeys.length > 0
        ? [{ kind: "ASSET_LOCK" as const, id: draft.attachmentAssetKeys[0], label: "附加 1 项筹码或证据" }]
        : []),
    ],
    timing: binding.timing,
    visibility,
    tracePolicy: binding.tracePolicy,
    reactionPolicy: binding.reactionPolicy,
    attachedAssetKeys: [...draft.attachmentAssetKeys],
    sourceEvidenceIds: draft.attachmentAssetKeys.filter((key) => context.evidence.some((card) => card.evidenceId === key)),
    settlementBindingId: binding.bindingId,
  };
  return ready(
    command,
    context,
    action,
    buildCustomPlanPresentation(action, {
      actorLabel: context.actorLabel,
      title: binding.labels.actionTitle,
      narrative: `你决定采用这样的手段：${candidate.rawText}。系统只会执行其中一个主要效果，并把其余结果交给世界规则结算。`,
      confirmLabel: binding.labels.confirmLabel,
    }),
    [binding.bindingId],
  );
}

function compileReaction(
  command: CreateActionPreviewCommandV1,
  context: ManeuverCompileContextV1,
  draft: ReactionDraftV1,
): ActionPreviewResponseV1 {
  const hold = draft.hold === true;
  if (draft.cardAssetKey) {
    const holding = context.ruleCardHoldings.find((item) => (
      item.cardAssetKey === draft.cardAssetKey
      && item.ownerRoleId === context.actorRoleId
      && item.status === "AVAILABLE"
    ));
    const card = holding && context.ruleCards.find((item) => item.cardKey === holding.cardKey && item.timing.includes("REACTION"));
    if (!holding || !card) return blocked("这张筹码不在当前角色手中，或不能在应变时使用。", ["REACTION_CARD_NOT_ALLOWED"]);
  }
  const target: ActionTargetV1 = { type: "WORLD_ENTITY", id: draft.reactionId, label: "当前突发局势" };
  const action: CompiledManeuverActionV1 = {
    ...baseAction({ ...context, slot: "REACTION" }, "REACTION", target),
    objective: hold ? "暂不应变" : "回应当前突发局势",
    method: hold ? "保留应变机会" : draft.rawText || draft.optionId || draft.cardAssetKey || "按当前合法选项应变",
    primaryEffect: {
      kind: "REACTION_RESPONSE",
      reactionId: draft.reactionId,
      optionId: draft.optionId,
      hold,
    },
    guaranteedStart: hold ? [] : [{ statement: "你的应变方式会进入当前事件的结算。" }],
    contestedOutcome: hold ? [] : [{ statement: "这项应变能在事件完成前改变多少结果。" }],
    notGuaranteed: hold ? [] : [{ statement: "应变会完全消除已经发生的影响。" }],
    costs: hold
      ? []
      : draft.cardAssetKey
        ? [{ kind: "ASSET_LOCK", id: draft.cardAssetKey, label: "使用 1 张应变牌" }]
        : [{ kind: "REACTION", amount: 1, label: "使用当前应变窗口" }],
    timing: { startsAt: "ON_COMMIT", settlesAt: { kind: "CURRENT_SETTLEMENT" }, playerLabel: "当前事件结算时" },
    visibility: { scope: "OBSERVABLE" },
    tracePolicy: { leavesTrace: !hold, playerSafeHint: hold ? null : "直接受到影响的人可能看到你的应变。" },
    reactionPolicy: { mode: "NONE", playerSafeHint: null },
    attachedAssetKeys: draft.cardAssetKey ? [draft.cardAssetKey] : [],
    sourceEvidenceIds: [],
    settlementBindingId: "maneuver.reaction.v1",
  };
  return ready(
    command,
    context,
    action,
    buildReactionPresentation(action, {
      actorLabel: context.actorLabel,
      title: hold ? "暂不应变" : "回应突发局势",
      narrative: hold
        ? "你决定暂时不在这一刻出手。当前局势会继续结算，但你的应变机会不会因为这个选择被消耗。"
        : `你准备这样回应：${action.method}。`,
      hold,
    }),
    ["reaction.boundary.v1"],
  );
}

function assertContextVersions(command: CreateActionPreviewCommandV1, context: ManeuverCompileContextV1): ActionPreviewResponseV1 | null {
  if (command.turnRevision !== context.turnRevision
      || command.expectedStateRevision !== context.stateRevision
      || command.expectedManeuverWindowVersion !== context.maneuverWindowVersion
      || command.controlEpoch !== context.controlEpoch) {
    return blocked("局势已经发生变化，请刷新后重新预演。", ["ACTION_PREVIEW_STALE"]);
  }
  return null;
}

export function createActionPreviewV1(
  rawCommand: unknown,
  context: ManeuverCompileContextV1,
): ActionPreviewResponseV1 {
  const command = parseCreateActionPreviewCommandV1(rawCommand);
  const stale = assertContextVersions(command, context);
  if (stale) return stale;
  switch (command.draft.kind) {
    case "CONVERSATION": return compileConversation(command, context, command.draft);
    case "INVESTIGATION": return compileInvestigation(command, context, command.draft);
    case "CARD_LAYOUT": return compileCardLayout(command, context, command.draft);
    case "CUSTOM_PLAN": return compileCustomPlan(command, context, command.draft);
    case "REACTION": return compileReaction(command, context, command.draft);
  }
}

export function stablePreviewRequestHashV1(command: CreateActionPreviewCommandV1): string {
  return createHash("sha256").update(JSON.stringify(command)).digest("hex");
}

export function detectCustomPlanClausesV1(text: string): string[] {
  return splitCustomClauses(text);
}
