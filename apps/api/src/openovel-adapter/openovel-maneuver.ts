import { BadRequestException, ConflictException } from "@nestjs/common";
import { createHash } from "node:crypto";
import type { PlayerIntentV2 } from "@ai-story/shared";
import type { MvpAiBudget } from "../mvp-ai-budget";
import {
  createMvpAiBudget,
} from "../mvp-ai-budget";
import {
  getLeverageDefinition,
  getManeuverActor,
  getManeuverSceneConfig,
  INITIAL_MVP_LEVERAGE_KEYS,
} from "../mvp-maneuver-config";
import { guardPlayerIntentV2 } from "../continuous-story-v2/player-intent";

export type OpenNovelManeuverType = "contact" | "investigate" | "leverage" | "custom";
export type OpenNovelManeuverDecisionForm = "CONVERSATION" | "INVESTIGATION" | "LEVERAGE" | "CUSTOM_PLAN";

export type OpenNovelManeuverCommand = {
  version?: unknown;
  idempotencyKey?: unknown;
  maneuverType?: unknown;
  targetRoleKey?: unknown;
  messageText?: unknown;
  intentKey?: unknown;
  leverageKey?: unknown;
  customText?: unknown;
};

export type OpenNovelManeuverResult = {
  id: string;
  turnNumber: number;
  usageDay: number;
  sceneKey: string;
  maneuverType: OpenNovelManeuverType;
  decisionForm: OpenNovelManeuverDecisionForm;
  title: string;
  narrative: string;
  targetRoleKey: string | null;
  consumedLeverageKey: string | null;
  discoveredFactKeys: string[];
  traces: string[];
  statePatch: Record<string, number>;
  idempotencyKey: string;
  requestFingerprint: string;
  createdAt: string;
};

export type OpenNovelManeuverState = {
  schemaVersion: "openovel_maneuver_state_v1";
  usageDay: number;
  sceneKey: string;
  maneuverOpportunitiesPerDay: 2;
  maneuversUsedToday: number;
  maneuverOpportunitiesRemaining: number;
  totalManeuversUsed: number;
  usedTypesToday: OpenNovelManeuverType[];
  usedLeverageKeys: string[];
  discoveredFactKeys: string[];
  metrics: Record<string, number>;
  aiBudget: MvpAiBudget;
  results: OpenNovelManeuverResult[];
};

export type OpenNovelManeuverPanelProjection = {
  sceneKey: string | null;
  enabled: boolean;
  disabledReason: string | null;
  quota: {
    perDay: 2;
    usedToday: number;
    remaining: number;
    usedTypesToday: OpenNovelManeuverType[];
  };
  contact: {
    enabled: boolean;
    usedToday: boolean;
    count: number;
    disabledReason: string | null;
    options: Array<{
      roleKey: string;
      displayName: string;
      publicIdentity: string;
      relevance: string;
      portrait?: string;
    }>;
  };
  investigate: {
    enabled: boolean;
    usedToday: boolean;
    count: number;
    disabledReason: string | null;
    options: Array<{ intentKey: string; title: string; summary: string }>;
  };
  leverage: {
    enabled: boolean;
    usedToday: boolean;
    count: number;
    disabledReason: string | null;
    options: Array<{
      leverageKey: string;
      label: string;
      description: string;
      consumptionLabel: "使用后消失";
      requiresTarget: boolean;
      targets: Array<{ roleKey: string; displayName: string }>;
    }>;
  };
  custom: {
    enabled: boolean;
    usedToday: boolean;
    disabledReason: string | null;
    maxLength: 200;
  };
};

export type OpenNovelLeverageHandProjection = {
  availableCount: number;
  items: Array<{ leverageKey: string; label: string; description: string }>;
};

export type OpenNovelManeuverProjection = {
  state: OpenNovelManeuverState;
  maneuverState: Omit<OpenNovelManeuverState, "metrics" | "aiBudget" | "results">;
  maneuverPanel: OpenNovelManeuverPanelProjection;
  leverageHand: OpenNovelLeverageHandProjection;
};

export type OpenNovelManeuverPlan = {
  maneuverType: OpenNovelManeuverType;
  decisionForm: OpenNovelManeuverDecisionForm;
  sceneKey: string;
  usageDay: number;
  title: string;
  fallbackNarrative: string;
  targetRoleKey: string | null;
  consumedLeverageKey: string | null;
  factKeys: string[];
  traces: string[];
  statePatch: Record<string, number>;
  needsAiNarrative: boolean;
  playerMessage: string;
};

export type OpenNovelManeuverGuardResult = {
  accepted: false;
  code: "ACTION_BLOCKED";
  reason: string;
  suggestedRewrite: string;
};

const MANEUVER_TYPES: OpenNovelManeuverType[] = ["contact", "investigate", "leverage", "custom"];
const SCENE_KEYS = [
  "d1_1", "d1_2",
  "d2_1", "d2_2",
  "d3_1", "d3_2",
  "d4_1", "d4_2",
  "d5_1", "d5_2",
  "d6_1", "d6_2",
] as const;
const EXPECTED_OPENOVEL_TURNS = 20;

export function openNovelManeuverClock(turnNumberValue: unknown) {
  const turnNumber = Math.max(0, Math.floor(Number(turnNumberValue) || 0));
  const activeTurn = Math.min(EXPECTED_OPENOVEL_TURNS - 1, turnNumber);
  const sceneIndex = Math.min(
    SCENE_KEYS.length - 1,
    Math.floor((activeTurn * SCENE_KEYS.length) / EXPECTED_OPENOVEL_TURNS),
  );
  return {
    turnNumber,
    sceneIndex,
    sceneKey: SCENE_KEYS[sceneIndex],
    usageDay: Math.floor(sceneIndex / 2) + 1,
  };
}

export function openNovelManeuverFingerprint(input: OpenNovelManeuverCommand) {
  return createHash("sha256").update(JSON.stringify({
    maneuverType: text(input.maneuverType),
    targetRoleKey: text(input.targetRoleKey),
    messageText: text(input.messageText),
    intentKey: text(input.intentKey),
    leverageKey: text(input.leverageKey),
    customText: text(input.customText),
  })).digest("hex");
}

export function ensureOpenNovelManeuverState(
  stateJson: unknown,
  turnNumber: number,
): OpenNovelManeuverState {
  const root = record(stateJson);
  const prior = record(root.openovelManeuver);
  const clock = openNovelManeuverClock(turnNumber);
  const priorResults = array(prior.results)
    .map(normalizeResult)
    .filter((item): item is OpenNovelManeuverResult => Boolean(item));
  const sameUsageDay = Number(prior.usageDay) === clock.usageDay;
  const resultsToday = priorResults.filter((item) => item.usageDay === clock.usageDay);
  const usedTypesToday = unique([
    ...(sameUsageDay ? array(prior.usedTypesToday).map(String).filter(isManeuverType) : []),
    ...resultsToday.map((item) => item.maneuverType),
  ]);
  const usedLeverageKeys = unique([
    ...array(prior.usedLeverageKeys).map(String),
    ...priorResults.map((item) => item.consumedLeverageKey || "").filter(Boolean),
  ]);
  const discoveredFactKeys = unique([
    ...array(prior.discoveredFactKeys).map(String),
    ...priorResults.flatMap((item) => item.discoveredFactKeys),
  ]);
  const remaining = Math.max(0, 2 - usedTypesToday.length);
  return {
    schemaVersion: "openovel_maneuver_state_v1",
    usageDay: clock.usageDay,
    sceneKey: clock.sceneKey,
    maneuverOpportunitiesPerDay: 2,
    maneuversUsedToday: usedTypesToday.length,
    maneuverOpportunitiesRemaining: remaining,
    totalManeuversUsed: Math.max(
      priorResults.length,
      Math.max(0, Math.floor(Number(prior.totalManeuversUsed) || 0)),
    ),
    usedTypesToday,
    usedLeverageKeys,
    discoveredFactKeys,
    metrics: numericRecord(prior.metrics),
    aiBudget: normalizeAiBudget(prior.aiBudget),
    results: priorResults,
  };
}

export function withOpenNovelManeuverState(
  stateJson: unknown,
  state: OpenNovelManeuverState,
) {
  return {
    ...record(stateJson),
    openovelManeuver: structuredClone(state),
  };
}

export function projectOpenNovelManeuvers(input: {
  stateJson: unknown;
  turnNumber: number;
  runtimeStatus: string;
  mainDecisionOpen: boolean;
  canHumanAct: boolean;
}): OpenNovelManeuverProjection {
  const state = ensureOpenNovelManeuverState(input.stateJson, input.turnNumber);
  const config = getManeuverSceneConfig(state.sceneKey);
  const globallyDisabled = globalDisabledReason({
    runtimeStatus: input.runtimeStatus,
    mainDecisionOpen: input.mainDecisionOpen,
    canHumanAct: input.canHumanAct,
    remaining: state.maneuverOpportunitiesRemaining,
  });
  const contactOptions = (config?.contacts || []).map((item) => ({
    roleKey: item.roleKey,
    displayName: item.displayName,
    publicIdentity: item.publicIdentity,
    relevance: item.relevance,
    ...(item.portrait ? { portrait: item.portrait } : {}),
  }));
  const investigationOptions = (config?.investigations || []).map((item) => ({
    intentKey: item.intentKey,
    title: item.title,
    summary: item.summary,
  }));
  const usedLeverage = new Set(state.usedLeverageKeys);
  const leverageOptions = (config?.playableLeverageKeys || [])
    .filter((key) => !usedLeverage.has(key))
    .map((key) => getLeverageDefinition(key))
    .filter((item): item is NonNullable<typeof item> => Boolean(item))
    .map((item) => ({
      leverageKey: item.leverageKey,
      label: item.label,
      description: item.description,
      consumptionLabel: "使用后消失" as const,
      requiresTarget: item.requiresTarget,
      targets: item.targetRoleKeys
        .map((roleKey) => getManeuverActor(roleKey))
        .filter((actor): actor is NonNullable<typeof actor> => Boolean(actor))
        .map((actor) => ({ roleKey: actor.roleKey, displayName: actor.displayName })),
    }));
  const contactReason = typeDisabledReason(state, "contact", contactOptions.length > 0, "当前没有可交谈人物", globallyDisabled);
  const investigateReason = typeDisabledReason(state, "investigate", investigationOptions.length > 0, "当前没有可调查事项", globallyDisabled);
  const leverageReason = typeDisabledReason(state, "leverage", leverageOptions.length > 0, "当前剧情没有合适的出牌时机", globallyDisabled);
  const customReason = typeDisabledReason(state, "custom", Boolean(config?.customEnabled), "当前阶段不能自拟谋划", globallyDisabled);
  const leverageHandItems = INITIAL_MVP_LEVERAGE_KEYS
    .filter((key) => !usedLeverage.has(key))
    .map((key) => getLeverageDefinition(key))
    .filter((item): item is NonNullable<typeof item> => Boolean(item))
    .map((item) => ({
      leverageKey: item.leverageKey,
      label: item.label,
      description: item.description,
    }));

  return {
    state,
    maneuverState: publicManeuverState(state),
    maneuverPanel: {
      sceneKey: state.sceneKey,
      enabled: !globallyDisabled,
      disabledReason: globallyDisabled,
      quota: {
        perDay: 2,
        usedToday: state.maneuversUsedToday,
        remaining: globallyDisabled && !input.mainDecisionOpen ? 0 : state.maneuverOpportunitiesRemaining,
        usedTypesToday: [...state.usedTypesToday],
      },
      contact: {
        enabled: !contactReason,
        usedToday: state.usedTypesToday.includes("contact"),
        count: contactOptions.length,
        disabledReason: contactReason,
        options: contactOptions,
      },
      investigate: {
        enabled: !investigateReason,
        usedToday: state.usedTypesToday.includes("investigate"),
        count: investigationOptions.length,
        disabledReason: investigateReason,
        options: investigationOptions,
      },
      leverage: {
        enabled: !leverageReason,
        usedToday: state.usedTypesToday.includes("leverage"),
        count: leverageOptions.length,
        disabledReason: leverageReason,
        options: leverageOptions,
      },
      custom: {
        enabled: !customReason,
        usedToday: state.usedTypesToday.includes("custom"),
        disabledReason: customReason,
        maxLength: 200,
      },
    },
    leverageHand: {
      availableCount: leverageHandItems.length,
      items: leverageHandItems,
    },
  };
}

export function compileOpenNovelManeuverPlan(input: {
  command: OpenNovelManeuverCommand;
  projection: OpenNovelManeuverProjection;
  game: any;
  roleKey: string;
  turnNumber: number;
}): OpenNovelManeuverPlan | OpenNovelManeuverGuardResult {
  const type = text(input.command.maneuverType) as OpenNovelManeuverType;
  if (!MANEUVER_TYPES.includes(type)) {
    throw new BadRequestException({ code: "MANEUVER_TYPE_INVALID", message: "不支持的谋划类型" });
  }
  assertManeuverTypeAvailable(input.projection.maneuverPanel, type);
  const sceneKey = input.projection.state.sceneKey;
  const usageDay = input.projection.state.usageDay;
  const config = getManeuverSceneConfig(sceneKey);
  if (!config) {
    throw new ConflictException({ code: "MANEUVER_WINDOW_CLOSED", message: "当前剧情没有主动谋划配置" });
  }

  if (type === "contact") {
    const roleKey = text(input.command.targetRoleKey);
    const messageText = text(input.command.messageText);
    const option = input.projection.maneuverPanel.contact.options.find((item) => item.roleKey === roleKey);
    if (!option) throw new BadRequestException({ code: "CONTACT_TARGET_UNAVAILABLE", message: "当前人物不在可交谈列表中" });
    if (!messageText) throw new BadRequestException({ code: "CONTACT_MESSAGE_REQUIRED", message: "请写下要对这个人物说的话" });
    if (messageText.length > 200) throw new BadRequestException({ code: "CONTACT_MESSAGE_TOO_LONG", message: "人物交谈最多 200 字" });
    const definition = config.contacts.find((item) => item.roleKey === roleKey);
    if (!definition) throw new BadRequestException({ code: "CONTACT_TARGET_UNAVAILABLE", message: "当前人物不能交谈" });
    return {
      maneuverType: type,
      decisionForm: "CONVERSATION",
      sceneKey,
      usageDay,
      title: definition.fallbackTitle,
      fallbackNarrative: `你向${definition.displayName}说明了来意。\n\n${definition.displayName}回道：“${definition.fallbackReply}”`,
      targetRoleKey: roleKey,
      consumedLeverageKey: null,
      factKeys: [],
      traces: [`${definition.displayName}交谈记录`],
      statePatch: { ...definition.statePatch },
      needsAiNarrative: true,
      playerMessage: messageText,
    };
  }

  if (type === "investigate") {
    const intentKey = text(input.command.intentKey);
    const definition = config.investigations.find((item) => item.intentKey === intentKey);
    if (!definition) throw new BadRequestException({ code: "INVESTIGATION_UNAVAILABLE", message: "当前调查项不存在或已经失效" });
    return {
      maneuverType: type,
      decisionForm: "INVESTIGATION",
      sceneKey,
      usageDay,
      title: definition.resultTitle,
      fallbackNarrative: definition.resultText,
      targetRoleKey: null,
      consumedLeverageKey: null,
      factKeys: [...definition.factKeys],
      traces: [...definition.traces],
      statePatch: { ...definition.statePatch },
      needsAiNarrative: false,
      playerMessage: "",
    };
  }

  if (type === "leverage") {
    const leverageKey = text(input.command.leverageKey);
    const option = input.projection.maneuverPanel.leverage.options.find((item) => item.leverageKey === leverageKey);
    if (!option) throw new ConflictException({ code: "LEVERAGE_NOT_AVAILABLE", message: "筹码不存在、已使用或当前不可用" });
    const definition = getLeverageDefinition(leverageKey);
    if (!definition) throw new ConflictException({ code: "LEVERAGE_NOT_AVAILABLE", message: "筹码不存在" });
    const targetRoleKey = text(input.command.targetRoleKey);
    if (definition.requiresTarget && !targetRoleKey) {
      throw new BadRequestException({ code: "LEVERAGE_TARGET_REQUIRED", message: "请先选择筹码使用对象" });
    }
    if (targetRoleKey && !option.targets.some((target) => target.roleKey === targetRoleKey)) {
      throw new BadRequestException({ code: "LEVERAGE_TARGET_INVALID", message: "这张筹码不能用于当前目标" });
    }
    const target = targetRoleKey ? getManeuverActor(targetRoleKey) : null;
    const response = definition.fixedResultText || definition.fallbackReply || "这张牌已经改变了谈判条件。";
    return {
      maneuverType: type,
      decisionForm: "LEVERAGE",
      sceneKey,
      usageDay,
      title: definition.resultTitle,
      fallbackNarrative: target
        ? `你向${target.displayName}打出了“${definition.label}”。\n\n${target.displayName}回应：“${response}”\n\n筹码已消耗：${definition.label}`
        : `${response}\n\n筹码已消耗：${definition.label}`,
      targetRoleKey: targetRoleKey || null,
      consumedLeverageKey: leverageKey,
      factKeys: [...definition.factKeys],
      traces: [`筹码使用记录：${definition.label}`],
      statePatch: { ...definition.statePatch },
      needsAiNarrative: definition.resolutionMode === "AI_REACTION",
      playerMessage: "",
    };
  }

  const customText = text(input.command.customText);
  if (!customText) throw new BadRequestException({ code: "MANEUVER_CUSTOM_TEXT_REQUIRED", message: "自拟谋划需要填写内容" });
  if (customText.length > 200) {
    return {
      accepted: false,
      code: "ACTION_BLOCKED",
      reason: "自拟谋划最多 200 字，请把意图收束成一项可执行的布局。",
      suggestedRewrite: customText.slice(0, 200),
    };
  }
  const guarded = guardCustomManeuver(customText, input.game, input.roleKey, input.turnNumber);
  if (guarded) return guarded;
  return {
    maneuverType: type,
    decisionForm: "CUSTOM_PLAN",
    sceneKey,
    usageDay,
    title: "自拟谋划已执行",
    fallbackNarrative: `你拟定的布局“${customText}”被拆成一项当前可执行的幕僚任务。它没有替代主线决策，但会成为后续剧情可引用的行动记录。`,
    targetRoleKey: null,
    consumedLeverageKey: null,
    factKeys: [],
    traces: ["自拟谋划原文", "幕僚执行回执"],
    statePatch: { "总督权威": 2, "暗账完整度": 4, "清算风险": 1 },
    needsAiNarrative: false,
    playerMessage: customText,
  };
}

export function applyOpenNovelManeuverPlan(input: {
  state: OpenNovelManeuverState;
  plan: OpenNovelManeuverPlan;
  result: Omit<OpenNovelManeuverResult, "usageDay" | "sceneKey" | "maneuverType" | "decisionForm" | "targetRoleKey" | "consumedLeverageKey" | "discoveredFactKeys" | "traces" | "statePatch">;
  aiBudget?: MvpAiBudget;
}) {
  const state = structuredClone(input.state);
  if (state.usedTypesToday.includes(input.plan.maneuverType)) {
    throw new ConflictException({ code: "MANEUVER_TYPE_ALREADY_USED", message: "今日已使用这类主动谋划" });
  }
  state.usedTypesToday = unique([...state.usedTypesToday, input.plan.maneuverType]);
  state.maneuversUsedToday = state.usedTypesToday.length;
  state.maneuverOpportunitiesRemaining = Math.max(0, 2 - state.maneuversUsedToday);
  state.totalManeuversUsed += 1;
  state.discoveredFactKeys = unique([...state.discoveredFactKeys, ...input.plan.factKeys]);
  if (input.plan.consumedLeverageKey) {
    state.usedLeverageKeys = unique([...state.usedLeverageKeys, input.plan.consumedLeverageKey]);
  }
  for (const [key, delta] of Object.entries(input.plan.statePatch)) {
    state.metrics[key] = clampMetric(Number(state.metrics[key] || 0) + Number(delta || 0));
  }
  if (input.aiBudget) state.aiBudget = structuredClone(input.aiBudget);
  const result: OpenNovelManeuverResult = {
    ...input.result,
    usageDay: input.plan.usageDay,
    sceneKey: input.plan.sceneKey,
    maneuverType: input.plan.maneuverType,
    decisionForm: input.plan.decisionForm,
    targetRoleKey: input.plan.targetRoleKey,
    consumedLeverageKey: input.plan.consumedLeverageKey,
    discoveredFactKeys: [...input.plan.factKeys],
    traces: [...input.plan.traces],
    statePatch: { ...input.plan.statePatch },
  };
  state.results.push(result);
  return { state, result };
}

export function assertManeuverVersion(currentVersion: number, supplied: unknown) {
  const version = Number(supplied);
  if (!Number.isInteger(version)) {
    throw new ConflictException({ code: "VERSION_REQUIRED", message: "body.version is required", currentVersion });
  }
  if (version !== currentVersion) {
    throw new ConflictException({
      code: "VERSION_CONFLICT",
      message: "story run version conflict",
      expectedVersion: version,
      currentVersion,
    });
  }
}

function assertManeuverTypeAvailable(
  panel: OpenNovelManeuverPanelProjection,
  type: OpenNovelManeuverType,
) {
  const section = panel[type];
  if (section.enabled) return;
  const code = section.usedToday
    ? "MANEUVER_TYPE_ALREADY_USED"
    : panel.quota.remaining <= 0
      ? "MANEUVER_LIMIT_REACHED"
      : "MANEUVER_WINDOW_CLOSED";
  throw new ConflictException({
    code,
    message: section.disabledReason || panel.disabledReason || "当前不能执行这项主动谋划",
  });
}

function guardCustomManeuver(
  customText: string,
  game: any,
  roleKey: string,
  turnNumber: number,
): OpenNovelManeuverGuardResult | null {
  const roleDefinition = array(game?.roles).find((item) => String(item?.roleKey) === roleKey)
    || array(game?.roles)[0]
    || {};
  const allRoles = array(game?.roles).map((item) => ({
    id: String(item.roleKey || ""),
    roleKey: String(item.roleKey || ""),
    roleName: String(item.roleName || item.identity || item.roleKey || ""),
  }));
  const target = {
    type: "PUBLIC_FRAME" as const,
    id: `openovel:turn:${turnNumber}`,
    label: "当前局势",
  };
  const intent: PlayerIntentV2 = {
    objective: customText,
    target,
    method: customText,
    leverageKeys: [],
    visibility: "PRIVATE",
    riskTolerance: "MEDIUM",
    fallback: null,
    condition: null,
    freeText: customText,
  };
  const guard = guardPlayerIntentV2(intent, {
    role: {
      id: String(roleDefinition.roleKey || roleKey),
      roleKey: String(roleDefinition.roleKey || roleKey),
      roleName: String(roleDefinition.roleName || roleDefinition.identity || roleKey),
      identity: String(roleDefinition.identity || ""),
      publicInfo: String(roleDefinition.publicInfo || ""),
      personalGoal: String(roleDefinition.personalGoal || ""),
      currentState: String(roleDefinition.currentState || ""),
      abilityText: String(roleDefinition.abilityText || ""),
      arcText: String(roleDefinition.arcText || ""),
      knownInfo: array(roleDefinition.knownInfo).map(String),
      cannotDo: array(roleDefinition.cannotDo).map(String),
    } as any,
    allRoles,
    visibleFacts: [],
    allFacts: [],
    assets: [],
    stage: {} as any,
  });
  if (guard.decision === "ACCEPT" || guard.decision === "ACCEPT_WITH_COST") return null;
  return {
    accepted: false,
    code: "ACTION_BLOCKED",
    reason: guard.reason,
    suggestedRewrite: guard.suggestedRewrite?.method || "",
  };
}

function globalDisabledReason(input: {
  runtimeStatus: string;
  mainDecisionOpen: boolean;
  canHumanAct: boolean;
  remaining: number;
}) {
  if (input.runtimeStatus === "COMPLETED") return "故事已经结束";
  if (input.runtimeStatus === "FAILED") return "当前故事正在恢复";
  if (!input.canHumanAct) return "当前角色暂时由 AI 控制";
  if (!input.mainDecisionOpen) return "当前主线决策尚未开放";
  if (input.remaining <= 0) return "今日谋划机会已用完";
  return null;
}

function typeDisabledReason(
  state: OpenNovelManeuverState,
  type: OpenNovelManeuverType,
  hasContent: boolean,
  contentReason: string,
  globallyDisabled: string | null,
) {
  if (globallyDisabled) return globallyDisabled;
  if (state.usedTypesToday.includes(type)) {
    return `今日已使用${({
      contact: "人物交谈",
      investigate: "派遣调查",
      leverage: "使用筹码",
      custom: "自拟谋划",
    } as const)[type]}`;
  }
  if (!hasContent) return contentReason;
  return null;
}

function publicManeuverState(state: OpenNovelManeuverState) {
  const {
    metrics: _metrics,
    aiBudget: _aiBudget,
    results: _results,
    ...publicState
  } = structuredClone(state);
  return publicState;
}

function normalizeResult(value: unknown): OpenNovelManeuverResult | null {
  const source = record(value);
  const maneuverType = text(source.maneuverType);
  const decisionForm = text(source.decisionForm);
  if (!text(source.id) || !isManeuverType(maneuverType)) return null;
  if (!["CONVERSATION", "INVESTIGATION", "LEVERAGE", "CUSTOM_PLAN"].includes(decisionForm)) return null;
  return {
    id: text(source.id),
    turnNumber: Math.max(0, Math.floor(Number(source.turnNumber) || 0)),
    usageDay: Math.max(1, Math.floor(Number(source.usageDay) || 1)),
    sceneKey: text(source.sceneKey),
    maneuverType,
    decisionForm: decisionForm as OpenNovelManeuverDecisionForm,
    title: text(source.title),
    narrative: text(source.narrative),
    targetRoleKey: text(source.targetRoleKey) || null,
    consumedLeverageKey: text(source.consumedLeverageKey) || null,
    discoveredFactKeys: array(source.discoveredFactKeys).map(String),
    traces: array(source.traces).map(String),
    statePatch: numericRecord(source.statePatch),
    idempotencyKey: text(source.idempotencyKey),
    requestFingerprint: text(source.requestFingerprint),
    createdAt: text(source.createdAt) || new Date(0).toISOString(),
  };
}

function normalizeAiBudget(value: unknown): MvpAiBudget {
  const defaults = createMvpAiBudget();
  const source = record(value);
  return {
    maxCalls: nonNegativeInteger(source.maxCalls, defaults.maxCalls),
    maxTotalTokens: nonNegativeInteger(source.maxTotalTokens, defaults.maxTotalTokens),
    costLimitMinor: source.costLimitMinor === null
      ? null
      : source.costLimitMinor === undefined
        ? defaults.costLimitMinor
        : nonNegativeInteger(source.costLimitMinor, 0),
    calls: nonNegativeInteger(source.calls, 0),
    totalTokens: nonNegativeInteger(source.totalTokens, 0),
    totalCostMinor: nonNegativeInteger(source.totalCostMinor, 0),
    exhausted: source.exhausted === true,
    lastFallbackReason: text(source.lastFallbackReason) || null,
  };
}

function nonNegativeInteger(value: unknown, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : fallback;
}

function clampMetric(value: number) {
  return Math.max(0, Math.min(100, Math.round(Number(value) || 0)));
}

function numericRecord(value: unknown) {
  return Object.fromEntries(
    Object.entries(record(value))
      .map(([key, item]) => [key, Number(item)])
      .filter(([, item]) => Number.isFinite(item)),
  );
}

function isManeuverType(value: unknown): value is OpenNovelManeuverType {
  return MANEUVER_TYPES.includes(String(value) as OpenNovelManeuverType);
}

function unique<T>(items: T[]) {
  return [...new Set(items)];
}

function array(value: unknown): any[] {
  return Array.isArray(value) ? value : [];
}

function record(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, any>
    : {};
}

function text(value: unknown) {
  return String(value || "").trim();
}
