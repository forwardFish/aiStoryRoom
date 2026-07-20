import type {
  DecisionCandidateV2,
  PlayerIntentV2,
  WorldBoundaryDecisionV2,
  WorldBoundaryResultV2
} from "@ai-story/shared";
import type { MainCard, StageDefinition } from "@ai-story/templates";
import { sha256Canonical } from "../continuous-strategy/canonical";
import { assetDisplayName } from "./asset-language";
import type { ResolvedStoryAction, StoryRoleContext, VisibleFact } from "./story-content";

export type IntentAssetContext = {
  assetKey: string;
  kind: string;
  ownerRoleId: string | null;
  quantity: number;
  status: string;
  stateJson?: unknown;
};

export type IntentFactContext = {
  factKey: string;
  content: string;
  visibility: string;
  knownByRoleIds: string[];
};

export type IntentGuardContext = {
  role: StoryRoleContext;
  allRoles: Array<{ id: string; roleKey: string; roleName: string }>;
  visibleFacts: VisibleFact[];
  allFacts: IntentFactContext[];
  assets: IntentAssetContext[];
  stage: StageDefinition;
};

export type PlannedIntentAction = ResolvedStoryAction & {
  normalizedIntent: PlayerIntentV2;
  immutableIntentHash: string;
  guardDecision: WorldBoundaryResultV2;
  effectHooks: string[];
  observableTraceText: string | null;
  requiresTargetResponse: boolean;
  interactionRequestKind: string | null;
  leverageDispositions: Array<{ assetKey: string; disposition: "REFERENCE" | "TRANSFER" | "CONSUME" | "CLAIM" | "SET_STATE" }>;
};

const TARGET_TYPES = new Set(["ROLE", "PERSON", "EVIDENCE", "RESOURCE", "LOCATION", "INSTITUTION", "PUBLIC_FRAME"]);
const VISIBILITIES = new Set(["PRIVATE", "LIMITED", "OBSERVABLE", "PUBLIC"]);
const RISKS = new Set(["LOW", "MEDIUM", "HIGH"]);
const FALLBACK_TRIGGERS = new Set(["PRIMARY_BLOCKED", "PRIMARY_PARTIAL", "TARGET_REFUSED"]);

const OUT_OF_WORLD = /互联网|手机|电话|卫星|摄像头|无人机|飞机|宇宙飞船|外太空|电脑|区块链|社交媒体|电子邮件|短信|现代银行|GPS/i;
const CONTROL_OTHER = /直接控制(?:所有|其他|对方|该)?角色|替(?:他|她|对方|目标角色)决定|无需(?:他|她|对方|目标角色)同意|强制玩家选择|让所有人服从|控制所有角色/i;
const DECLARE_RESULT = /必定成功|保证成功|宣布(?:已经)?成功|直接判定|直接处死皇帝|已经迫使|已经让.+(?:交出|背叛|认罪|公开秘密|改变阵营)/i;
const CAUSAL_GAP = /无需调查|无需证据|无需过程|瞬间完成|凭空得到|直接知道全部|立即掌握所有|跳过(?:审讯|核验|交涉|递送|查验)/i;
const HIGH_COST = /背叛|抗命|销毁|焚毁|伪造|扣押|查封|公开秘密|越级弹劾|截留|灭口|行贿|威胁/i;
const REQUEST_TARGET = /要求|请求|劝说|交涉|谈判|索取|请.+(?:交出|承认|公开|签押|作证)|施压|逼问|限期答复|交换/i;

export function normalizePlayerIntentV2(input: PlayerIntentV2): PlayerIntentV2 {
  const targetType = String(input?.target?.type || "").toUpperCase();
  const visibility = String(input?.visibility || "").toUpperCase();
  const risk = String(input?.riskTolerance || "").toUpperCase();
  const fallbackTrigger = input?.fallback ? String(input.fallback.triggerOn || "").toUpperCase() : "";
  const leverageKeys = Array.isArray(input?.leverageKeys)
    ? [...new Set(input.leverageKeys.map((value) => compact(value, 120)).filter(Boolean))].sort()
    : [];
  return {
    objective: compact(input?.objective, 600),
    target: {
      type: (TARGET_TYPES.has(targetType) ? targetType : "PUBLIC_FRAME") as PlayerIntentV2["target"]["type"],
      id: compact(input?.target?.id, 180),
      label: compact(input?.target?.label, 180)
    },
    method: compact(input?.method, 900),
    leverageKeys,
    visibility: (VISIBILITIES.has(visibility) ? visibility : "PRIVATE") as PlayerIntentV2["visibility"],
    riskTolerance: (RISKS.has(risk) ? risk : "MEDIUM") as PlayerIntentV2["riskTolerance"],
    fallback: input?.fallback && compact(input.fallback.method, 600) && FALLBACK_TRIGGERS.has(fallbackTrigger)
      ? { method: compact(input.fallback.method, 600), triggerOn: fallbackTrigger as NonNullable<PlayerIntentV2["fallback"]>["triggerOn"] }
      : null,
    condition: input?.condition && compact(input.condition.eventType, 120)
      ? {
          eventType: compact(input.condition.eventType, 120),
          ...(compact(input.condition.actorRoleId, 180) ? { actorRoleId: compact(input.condition.actorRoleId, 180) } : {}),
          ...(compact(input.condition.targetId, 180) ? { targetId: compact(input.condition.targetId, 180) } : {}),
          ...(Number.isInteger(input.condition.expiresAtStage) ? { expiresAtStage: Math.max(1, Math.min(99, Number(input.condition.expiresAtStage))) } : {})
        }
      : null,
    ...(compact(input?.freeText, 1200) ? { freeText: compact(input.freeText, 1200) } : {})
  };
}

export function guardPlayerIntentV2(raw: PlayerIntentV2, context: IntentGuardContext): WorldBoundaryResultV2 {
  const intent = normalizePlayerIntentV2(raw);
  const text = `${intent.objective} ${intent.method} ${intent.freeText || ""}`;
  const matchedRules: string[] = [];
  const riskFlags: string[] = [];
  let decision: WorldBoundaryDecisionV2 = "ACCEPT";
  let reason = "这项行动在当前世界、角色权限、知识和因果边界内存在现实尝试路径。";
  let suggestedRewrite: PlayerIntentV2 | null = null;

  const reject = (next: WorldBoundaryDecisionV2, rule: string, message: string, rewriteMethod?: string) => {
    if (decision !== "ACCEPT") return;
    decision = next;
    matchedRules.push(rule);
    reason = message;
    suggestedRewrite = rewriteMethod ? { ...intent, method: rewriteMethod } : null;
  };

  if (!intent.objective || !intent.method || !intent.target.id || !intent.target.label) {
    reject("REWRITE_NEEDED", "INTENT_FIELDS_REQUIRED", "行动必须写清目标、对象和实际做法。", `${intent.method || "说明你准备采取的具体步骤"}，并写明经手人、对象和可复核回执`);
  }
  if (decision === "ACCEPT" && intent.method.replace(/\s/g, "").length < 6) {
    reject("REWRITE_NEEDED", "METHOD_TOO_VAGUE", "当前做法仍只是态度，无法形成可裁决的因果链。", `${intent.method || "着手处理"}；写明由谁通过何种公文、交涉或查验路径执行`);
  }
  if (decision === "ACCEPT" && intent.condition && !intent.fallback) {
    reject("REWRITE_NEEDED", "CONDITION_REQUIRES_FALLBACK", "条件行动必须同时写明触发后真正执行的后手，不能只登记一个抽象条件。" );
  }
  if (decision === "ACCEPT" && OUT_OF_WORLD.test(text)) {
    reject("REJECT_OUT_OF_WORLD", "ERA_TECHNOLOGY_BOUNDARY", "这项做法使用了嘉靖时代不存在的技术或制度。", `${intent.method.replace(OUT_OF_WORLD, "驿递、公文、耳目或当面查验")}（保留原目标，改用当时可行的渠道）`);
  }
  if (decision === "ACCEPT" && CONTROL_OTHER.test(text)) {
    reject("REJECT_CONTROL_OTHER_PLAYER", "OTHER_PLAYER_AGENCY", "你可以施压、请求或设置条件，但不能替另一名角色决定。", `向${intent.target.label}提出“${intent.objective}”的要求并留下现实压力，由对方自行回应`);
  }
  if (decision === "ACCEPT" && DECLARE_RESULT.test(text)) {
    reject("REJECT_DECLARE_RESULT", "OUTCOME_OWNERSHIP", "玩家可以声明尝试和目标，不能直接宣布成功或替裁决写下结果。", `${intent.method.replace(DECLARE_RESULT, "尝试推动")}；结果由证据、资源、对方回应和世界状态裁决`);
  }
  if (decision === "ACCEPT" && CAUSAL_GAP.test(text)) {
    reject("REJECT_CAUSAL_GAP", "CAUSAL_PROCESS_REQUIRED", "这项行动跳过了取得证据、递送、核验或交涉所需的关键过程。", `${intent.method.replace(CAUSAL_GAP, "先完成必要的查验、递送或交涉")}，再争取${intent.objective}`);
  }

  if (decision === "ACCEPT") {
    for (const forbidden of context.role.cannotDo) {
      const terms = forbidden.split(/[、，。；\s]/).filter((term) => term.length >= 4);
      if (terms.some((term) => text.includes(term))) {
        reject("REJECT_ROLE_IMPOSSIBLE", "ROLE_CAPABILITY_BOUNDARY", `这项做法超出${context.role.roleName}当前拥有的现实权限路径。`, `通过${context.role.abilityText || context.role.identity}能够实际调用的公文、人员或证据渠道尝试${intent.objective}`);
        break;
      }
    }
  }

  if (decision === "ACCEPT") {
    const unknownFact = context.allFacts.find((fact) => !fact.knownByRoleIds.includes(context.role.id)
      && fact.visibility !== "public"
      && anchors(fact.content).some((anchor) => normalize(text).includes(normalize(anchor))));
    if (unknownFact) {
      reject("REJECT_UNKNOWN_INFORMATION", "ROLE_KNOWLEDGE_BOUNDARY", "这项行动使用了当前角色尚未得知的私密事实。", `先通过${context.role.abilityText || "查验、询问或公文调取"}核实相关线索，再尝试${intent.objective}`);
    }
  }

  if (decision === "ACCEPT") {
    const contradiction = context.visibleFacts.find((fact) => anchors(fact.content).some((anchor) => normalize(text).includes(normalize(anchor)))
      && /不存在|从未发生|并未发生|全部是假的|完全相反/.test(text));
    if (contradiction) {
      reject("REJECT_WORLD_CONTRADICTION", "CONFIRMED_FACT_CONTRADICTION", "这项行动直接否认了角色已经确认的世界事实。", `承认“${anchors(contradiction.content)[0] || contradiction.content}”已经存在，并以${intent.method}争取${intent.objective}`);
    }
  }

  if (decision === "ACCEPT" && intent.target.type === "ROLE" && !context.allRoles.some((role) => role.id === intent.target.id)) {
    reject("REWRITE_NEEDED", "TARGET_NOT_AVAILABLE", "目标角色不在当前世界的可行动对象中。", `把行动对象改为当前故事中确实存在且${context.role.roleName}能够接触的角色`);
  }
  if (decision === "ACCEPT" && intent.target.type === "EVIDENCE" && !context.visibleFacts.some((fact) => fact.factKey === intent.target.id)) {
    reject("REJECT_UNKNOWN_INFORMATION", "EVIDENCE_NOT_KNOWN", "当前角色尚未掌握这项证据。", `先查验或调取“${intent.target.label}”，确认后再以它推动${intent.objective}`);
  }
  if (decision === "ACCEPT") {
    const unavailable = intent.leverageKeys.find((key) => !context.assets.some((asset) => asset.assetKey === key && asset.ownerRoleId === context.role.id && asset.status === "ACTIVE" && asset.quantity > 0));
    if (unavailable) {
      const displayName = assetDisplayName(unavailable);
      reject("REWRITE_NEEDED", "LEVERAGE_NOT_HELD", `角色并未实际持有“${displayName}”，不能把它写成已经投入。`, `保留目标“${intent.objective}”，改用当前确实持有的筹码，或先取得“${displayName}”`);
    }
  }

  if (decision === "ACCEPT" && (HIGH_COST.test(text) || intent.riskTolerance === "HIGH")) {
    decision = "ACCEPT_WITH_COST";
    matchedRules.push("WORLD_INTERNAL_HIGH_COST");
    riskFlags.push(...riskTerms(text));
    reason = "这项行动在世界内可行，但会产生公开责任、关系破裂、证据灭失或政治反制等高代价；系统不会因其危险或不道德而阻止。";
  }

  return {
    decision,
    reason,
    matchedRules: [...new Set(matchedRules)],
    riskFlags: [...new Set(riskFlags)],
    normalizedIntent: intent,
    suggestedRewrite
  };
}

export function planIntentAction(input: {
  intent: PlayerIntentV2;
  guard: WorldBoundaryResultV2;
  role: StoryRoleContext;
  visibleFacts: VisibleFact[];
  stage: StageDefinition;
  allRoles: Array<{ id: string; roleKey: string; roleName: string }>;
  candidate?: DecisionCandidateV2 | null;
  card?: MainCard | null;
}): PlannedIntentAction {
  const intent = input.guard.normalizedIntent;
  const immutableIntentHash = sha256Canonical(intent);
  const unchangedCandidate = Boolean(input.candidate?.intentDraft && sha256Canonical(normalizePlayerIntentV2(input.candidate.intentDraft)) === immutableIntentHash);
  const source = input.candidate ? (unchangedCandidate ? "SUGGESTED" : "EDITED_SUGGESTED") : "CUSTOM";
  const targetRole = intent.target.type === "ROLE" ? input.allRoles.find((role) => role.id === intent.target.id) || null : null;
  const factPrefix = source === "CUSTOM" ? "custom" : source === "EDITED_SUGGESTED" ? "edited" : "candidate";
  const independentFactKey = `${factPrefix}_fact_${immutableIntentHash.slice(0, 20)}`;
  const effectFactKeys = source === "SUGGESTED" && input.card?.effect.factKeys.length
    ? [...new Set(input.card.effect.factKeys)]
    : [independentFactKey];
  const actionKey = source === "CUSTOM" ? `custom:${immutableIntentHash}` : source === "EDITED_SUGGESTED" ? `edited:${immutableIntentHash}` : String(input.card?.actionKey || input.candidate?.actionKey || `intent:${immutableIntentHash}`);
  const leverageText = intent.leverageKeys.length ? `，并明确投入${intent.leverageKeys.map(assetDisplayName).join("、")}` : "，且未动用未选择的筹码";
  const claimedAssets = source === "SUGGESTED"
    ? input.card?.assetMutations.filter((mutation) => mutation.mutationType === "CLAIM").map((mutation) => assetDisplayName(mutation.assetKey)) || []
    : [];
  const claimText = claimedAssets.length ? `；若这一步落实，${input.role.roleName}将取得${claimedAssets.join("、")}` : "";
  const fallbackText = intent.fallback ? `；若主方案${fallbackLabel(intent.fallback.triggerOn)}，则改用“${intent.fallback.method}”` : "";
  const conditionText = intent.condition ? `；这项后手只有在“${intent.condition.eventType}”真实发生后才会另行结算` : "";
  const targetText = intent.target.label || input.stage.commonContest.title;
  const receiptText = `${input.role.roleName}已经让经手人按“${intent.method}”开始执行，目标是“${intent.objective}”，对象为${targetText}${leverageText}${claimText}${fallbackText}${conditionText}；执行时辰、传递渠道和第一份回执已经登记，但结果仍要由证据与他人回应决定`;
  const requiresTargetResponse = intent.target.type === "ROLE" && REQUEST_TARGET.test(`${intent.objective} ${intent.method}`);
  const observableTraceText = intent.visibility === "OBSERVABLE"
    ? `${input.stage.title}期间，${targetText}附近出现了与“${input.stage.commonContest.title}”有关的新公文、人员调动或查验痕迹；旁观者能确认局势被人推动，却无法仅凭这些痕迹知道行动者、完整方法或秘密目的。`
    : null;
  const effectHooks = [
    ...effectFactKeys.map((key) => `WORLD_FACT:${key}`),
    `TARGET:${intent.target.type}:${intent.target.id}`,
    `VISIBILITY:${intent.visibility}`,
    `METHOD:${actionVerb(intent.method)}`,
    ...intent.leverageKeys.map((key) => `LEVERAGE:${key}`),
    ...(requiresTargetResponse ? ["INTERACTION:TARGET_RESPONSE_REQUIRED"] : []),
    ...(intent.condition ? [`CONDITION:${intent.condition.eventType}`] : []),
    ...(intent.fallback ? [`FALLBACK:${intent.fallback.triggerOn}`] : [])
  ];
  return {
    actionKey,
    source,
    visibility: intent.visibility,
    label: actionLabel(intent),
    description: intent.method,
    intent: intent.objective,
    risk: intent.riskTolerance === "HIGH" ? "HIGH" : intent.riskTolerance === "LOW" ? "LOW" : "NORMAL",
    targetRoleId: targetRole?.id || null,
    targetRoleName: targetRole?.roleName || (intent.target.type === "ROLE" ? intent.target.label : null),
    basisFactKeys: [...new Set([
      ...(intent.target.type === "EVIDENCE" ? [intent.target.id] : []),
      ...input.visibleFacts.slice(-3).map((fact) => fact.factKey)
    ])],
    requiredAssetKeys: intent.leverageKeys,
    receiptText,
    effectFactKeys,
    influenceEdges: targetRole ? [{ affectedRoleKey: targetRole.roleKey, effectKey: `intent:${immutableIntentHash.slice(0, 16)}`, visibility: intent.visibility }] : [],
    nextStateKey: `${source.toLowerCase()}:${immutableIntentHash.slice(0, 24)}`,
    normalizedIntent: intent,
    immutableIntentHash,
    guardDecision: input.guard,
    effectHooks,
    observableTraceText,
    requiresTargetResponse,
    interactionRequestKind: requiresTargetResponse ? inferInteractionKind(intent) : null,
    leverageDispositions: source === "SUGGESTED" && input.card
      ? input.card.assetMutations.map((mutation) => ({ assetKey: mutation.assetKey, disposition: cardMutationDisposition(mutation.mutationType) }))
      : intent.leverageKeys.map((assetKey) => ({ assetKey, disposition: leverageDisposition(intent.method) }))
  };
}

export function candidateIntentDraft(input: {
  card: MainCard;
  fallbackCard?: MainCard | null;
  targetRoleId?: string | null;
  targetRoleName?: string | null;
  publicFrameId: string;
  publicFrameLabel: string;
}): PlayerIntentV2 {
  const target = input.targetRoleId || input.card.targetRoleKey
    ? { type: "ROLE" as const, id: input.targetRoleId || input.card.targetRoleKey || "unknown-role", label: input.targetRoleName || input.card.targetRoleKey || "相关角色" }
    : { type: "PUBLIC_FRAME" as const, id: input.publicFrameId, label: input.publicFrameLabel };
  return normalizePlayerIntentV2({
    objective: input.card.objective,
    target,
    method: input.card.title,
    leverageKeys: [...new Set(input.card.assetMutations
      .filter((mutation) => mutation.mutationType !== "CLAIM")
      .map((mutation) => mutation.assetKey))],
    visibility: input.card.visibility,
    riskTolerance: input.card.risk === "NORMAL" ? "MEDIUM" : input.card.risk,
    fallback: input.fallbackCard ? { method: `${input.fallbackCard.title}：${input.fallbackCard.objective}`, triggerOn: "PRIMARY_BLOCKED" } : null,
    condition: null
  });
}

export function intentInvariantDiff(expected: PlayerIntentV2, actual: PlayerIntentV2): string[] {
  const left = normalizePlayerIntentV2(expected);
  const right = normalizePlayerIntentV2(actual);
  const issues: string[] = [];
  for (const key of ["objective", "target", "leverageKeys", "visibility", "riskTolerance", "fallback", "condition"] as const) {
    if (sha256Canonical(left[key]) !== sha256Canonical(right[key])) issues.push(`INTENT_CHANGED:${key}`);
  }
  return issues;
}

export function boundaryAccepted(decision: WorldBoundaryDecisionV2) {
  return decision === "ACCEPT" || decision === "ACCEPT_WITH_COST";
}

function compact(value: unknown, maximum: number) {
  return String(value || "").trim().replace(/\s+/g, " ").slice(0, maximum);
}

function normalize(value: string) {
  return String(value || "").toLowerCase().replace(/[\s，。；、：:,.!?！？“”"']/g, "");
}

function anchors(value: string) {
  return String(value || "").split(/[，。；、：:\s]/).map((item) => item.trim()).filter((item) => item.length >= 6).slice(0, 10);
}

function riskTerms(value: string) {
  const values = ["背叛", "抗命", "销毁", "焚毁", "伪造", "扣押", "查封", "公开秘密", "越级弹劾", "截留", "灭口", "行贿", "威胁"];
  return values.filter((term) => value.includes(term)).map((term) => `HIGH_COST:${term}`);
}

function actionVerb(method: string) {
  return compact(method.split(/[，。；、\s]/)[0], 40) || "执行";
}

function actionLabel(intent: PlayerIntentV2) {
  const method = compact(intent.method.split(/[；。！？]/)[0], 42);
  return method.length >= 4 ? method : compact(`${intent.target.label}：${intent.objective}`, 42);
}

function inferInteractionKind(intent: PlayerIntentV2) {
  const value = `${intent.objective} ${intent.method}`;
  if (/交出|移交|原件|副本/.test(value)) return "REQUEST_EVIDENCE_TRANSFER";
  if (/作证|承认|签押/.test(value)) return "REQUEST_TESTIMONY";
  if (/公开|表态|改变阵营|背叛/.test(value)) return "REQUEST_PUBLIC_POSITION";
  if (/交换|承诺|条件/.test(value)) return "REQUEST_NEGOTIATION";
  return "REQUEST_RESPONSE";
}

function leverageDisposition(method: string): "REFERENCE" | "TRANSFER" | "CONSUME" {
  if (/销毁|焚毁|耗用|用尽|花掉/.test(method)) return "CONSUME";
  if (/交出|移交|转交|交付/.test(method)) return "TRANSFER";
  return "REFERENCE";
}

function cardMutationDisposition(mutationType: string): PlannedIntentAction["leverageDispositions"][number]["disposition"] {
  if (mutationType === "CLAIM") return "CLAIM";
  if (mutationType === "SPEND") return "CONSUME";
  if (mutationType === "SET_STATE") return "SET_STATE";
  return "REFERENCE";
}

function fallbackLabel(trigger: NonNullable<PlayerIntentV2["fallback"]>["triggerOn"]) {
  if (trigger === "TARGET_REFUSED") return "被对方拒绝";
  if (trigger === "PRIMARY_PARTIAL") return "只完成一部分";
  return "受阻";
}
