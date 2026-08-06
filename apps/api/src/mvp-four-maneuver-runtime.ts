import type { MvpView } from "./mvp-types";
import {
  getLeverageDefinition,
  getManeuverActor,
  getManeuverSceneConfig,
  INITIAL_MVP_LEVERAGE_KEYS,
  LEGACY_LEVERAGE_NAME_TO_KEY
} from "./mvp-maneuver-config";
import {
  MvpStoryEngine,
  ensureMvpCausalView,
  projectPublicMvpView
} from "./mvp-causal-runtime";


export type FourManeuverType = "contact" | "investigate" | "leverage" | "custom";
export interface FourManeuverState {
  usageDay: number;
  maneuverOpportunitiesPerDay: number;
  maneuversUsedToday: number;
  maneuverOpportunitiesRemaining: number;
  totalManeuversUsed: number;
  usedTypesToday: FourManeuverType[];
  usedLeverageKeys: string[];
  discoveredFactKeys: string[];
}
export interface FourManeuverPanelProjection {
  sceneKey: string | null; enabled: boolean; disabledReason: string | null;
  quota: { perDay: number; usedToday: number; remaining: number; usedTypesToday: FourManeuverType[] };
  contact: { enabled: boolean; usedToday: boolean; count: number; disabledReason: string | null; options: Array<{ roleKey: string; displayName: string; publicIdentity: string; relevance: string; portrait?: string }> };
  investigate: { enabled: boolean; usedToday: boolean; count: number; disabledReason: string | null; options: Array<{ intentKey: string; title: string; summary: string }> };
  leverage: { enabled: boolean; usedToday: boolean; count: number; disabledReason: string | null; options: Array<{ leverageKey: string; label: string; description: string; consumptionLabel: "使用后消失"; requiresTarget: boolean; targets: Array<{ roleKey: string; displayName: string }> }> };
  custom: { enabled: boolean; usedToday: boolean; disabledReason: string | null; maxLength: 200 };
}
export interface FourLeverageHandProjection { availableCount: number; items: Array<{ leverageKey: string; label: string; description: string }> }

const INSTALL_MARK = Symbol.for("our-many-worlds:mvp-four-maneuver-runtime-v1");
const MANEUVER_TYPES: FourManeuverType[] = ["contact", "investigate", "leverage", "custom"];

function unique<T>(items: T[]): T[] {
  return [...new Set(items)];
}

function isManeuverType(value: unknown): value is FourManeuverType {
  return MANEUVER_TYPES.includes(String(value) as FourManeuverType);
}

function eventTypesForCurrentDay(view: MvpView): FourManeuverType[] {
  const day = Number(view.run.currentDay);
  return unique((view.events || [])
    .filter((item) => item.type === "maneuver" || item.type === "maneuver_submitted")
    .filter((item) => {
      const eventDay = Number(item.payload?.day);
      return !Number.isFinite(eventDay) || eventDay === day;
    })
    .map((item) => item.payload?.maneuverType)
    .filter(isManeuverType));
}

function factsFromEvents(view: MvpView): string[] {
  return unique((view.events || [])
    .filter((item) => item.type === "fact_discovered")
    .flatMap((item) => Array.isArray(item.payload?.factKeys)
      ? item.payload.factKeys.map(String)
      : item.payload?.factKey ? [String(item.payload.factKey)] : []));
}

function leverageKeysFromPlayer(view: MvpView): string[] {
  const player = view.player as Record<string, any>;
  if (Array.isArray(player.leverageKeys) && player.leverageKeys.length) {
    return unique(player.leverageKeys.map(String));
  }
  const legacy = Array.isArray(player.leverage) ? player.leverage.map(String) : [];
  const mapped = legacy.map((label) => LEGACY_LEVERAGE_NAME_TO_KEY[label]).filter(Boolean);
  return unique(mapped.length ? mapped : [...INITIAL_MVP_LEVERAGE_KEYS]);
}

export function ensureFourManeuverState(view: MvpView): MvpView {
  ensureMvpCausalView(view);
  const prior = (view.maneuverState || {}) as Partial<FourManeuverState>;
  const reconstructedTypes = eventTypesForCurrentDay(view);
  const reconstructedFacts = factsFromEvents(view);
  const sameUsageDay = Number(prior.usageDay) === Number(view.run.currentDay);
  const usedTypesToday = unique([
    ...(sameUsageDay && Array.isArray(prior.usedTypesToday) ? prior.usedTypesToday.filter(isManeuverType) : []),
    ...reconstructedTypes
  ]);
  const perDay = Math.max(0, Number(prior.maneuverOpportunitiesPerDay ?? 2));
  const remaining = sameUsageDay
    ? Math.max(0, Number(prior.maneuverOpportunitiesRemaining ?? perDay - usedTypesToday.length))
    : Math.max(0, perDay - usedTypesToday.length);
  (view as any).maneuverState = {
    usageDay: Number(view.run.currentDay),
    maneuverOpportunitiesPerDay: perDay,
    maneuversUsedToday: usedTypesToday.length,
    maneuverOpportunitiesRemaining: remaining,
    totalManeuversUsed: Math.max(0, Number(prior.totalManeuversUsed ?? 0)),
    usedTypesToday,
    usedLeverageKeys: unique(Array.isArray(prior.usedLeverageKeys) ? prior.usedLeverageKeys.map(String) : []),
    discoveredFactKeys: unique([
      ...(Array.isArray(prior.discoveredFactKeys) ? prior.discoveredFactKeys.map(String) : []),
      ...reconstructedFacts
    ])
  };
  const player = view.player as Record<string, any>;
  player.leverageKeys = leverageKeysFromPlayer(view);
  return view;
}

function globalDisabledReason(view: MvpView): string | null {
  if (Number(view.run.currentDay) >= 7 || view.run.status === "awaiting_day_advance") return "今日剧情已经结束";
  if (view.run.status !== "awaiting_decision" || !view.activeDecision) return "当前阶段不能使用主动谋划";
  if (Number(view.maneuverState.maneuverOpportunitiesRemaining) <= 0) return "今日谋划机会已用完";
  return null;
}

function typeDisabledReason(
  view: MvpView,
  type: FourManeuverType,
  hasContent: boolean,
  contentReason: string
): string | null {
  const global = globalDisabledReason(view);
  if (global) return global;
  if (((view.maneuverState as any).usedTypesToday || []).includes(type)) {
    const labels: Record<FourManeuverType, string> = {
      contact: "人物交谈",
      investigate: "派遣调查",
      leverage: "使用筹码",
      custom: "自拟谋划"
    };
    return `今日已使用${labels[type]}`;
  }
  if (!hasContent) return contentReason;
  return null;
}

export function projectLeverageHand(view: MvpView): FourLeverageHandProjection {
  ensureFourManeuverState(view);
  const owned = leverageKeysFromPlayer(view);
  const used = new Set(view.maneuverState.usedLeverageKeys);
  const items = owned
    .filter((key) => !used.has(key))
    .map((key) => getLeverageDefinition(key))
    .filter((item): item is NonNullable<typeof item> => Boolean(item))
    .map((item) => ({ leverageKey: item.leverageKey, label: item.label, description: item.description }));
  return { availableCount: items.length, items };
}

export function projectManeuverPanel(view: MvpView): FourManeuverPanelProjection {
  ensureFourManeuverState(view);
  const sceneKey = view.activeDecision?.decisionKey || null;
  const config = sceneKey ? getManeuverSceneConfig(sceneKey) : null;
  const usedTypes: FourManeuverType[] = unique<FourManeuverType>(((view.maneuverState as any).usedTypesToday || []).filter(isManeuverType));
  const globallyDisabled = globalDisabledReason(view);
  const remaining = globallyDisabled && (view.run.status === "awaiting_day_advance" || Number(view.run.currentDay) >= 7)
    ? 0
    : Math.max(0, Number(view.maneuverState.maneuverOpportunitiesRemaining));

  const contactOptions = (config?.contacts || []).map((item) => ({
    roleKey: item.roleKey,
    displayName: item.displayName,
    publicIdentity: item.publicIdentity,
    relevance: item.relevance,
    ...(item.portrait ? { portrait: item.portrait } : {})
  }));
  const investigationOptions = (config?.investigations || []).map((item) => ({
    intentKey: item.intentKey,
    title: item.title,
    summary: item.summary
  }));
  const usedLeverage = new Set(view.maneuverState.usedLeverageKeys);
  const ownedLeverage = new Set(leverageKeysFromPlayer(view));
  const leverageOptions = (config?.playableLeverageKeys || [])
    .filter((key) => ownedLeverage.has(key) && !usedLeverage.has(key))
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
        .map((actor) => ({ roleKey: actor.roleKey, displayName: actor.displayName }))
    }));

  const contactReason = typeDisabledReason(view, "contact", contactOptions.length > 0, "当前没有可交谈人物");
  const investigateReason = typeDisabledReason(view, "investigate", investigationOptions.length > 0, "当前没有可调查事项");
  const leverageReason = typeDisabledReason(view, "leverage", leverageOptions.length > 0, "当前剧情没有合适的出牌时机");
  const customReason = typeDisabledReason(view, "custom", Boolean(config?.customEnabled), "当前阶段不能自拟谋划");

  return {
    sceneKey,
    enabled: !globallyDisabled,
    disabledReason: globallyDisabled,
    quota: {
      perDay: Number(view.maneuverState.maneuverOpportunitiesPerDay),
      usedToday: Number(view.maneuverState.maneuversUsedToday),
      remaining,
      usedTypesToday: usedTypes
    },
    contact: {
      enabled: !contactReason,
      usedToday: usedTypes.includes("contact"),
      count: contactOptions.length,
      disabledReason: contactReason,
      options: contactOptions
    },
    investigate: {
      enabled: !investigateReason,
      usedToday: usedTypes.includes("investigate"),
      count: investigationOptions.length,
      disabledReason: investigateReason,
      options: investigationOptions
    },
    leverage: {
      enabled: !leverageReason,
      usedToday: usedTypes.includes("leverage"),
      count: leverageOptions.length,
      disabledReason: leverageReason,
      options: leverageOptions
    },
    custom: {
      enabled: !customReason,
      usedToday: usedTypes.includes("custom"),
      disabledReason: customReason,
      maxLength: 200
    }
  };
}

export function projectFourManeuverView(source: MvpView): MvpView {
  const view = ensureFourManeuverState(structuredClone(source));
  const projected = projectPublicMvpView(view) as MvpView;
  const panel = projectManeuverPanel(view);
  projected.maneuverState = structuredClone(view.maneuverState);
  projected.maneuverState.maneuverOpportunitiesRemaining = panel.quota.remaining;
  (projected as any).maneuverPanel = panel;
  (projected as any).leverageHand = projectLeverageHand(view);
  return projected;
}

async function loadAndProject(engine: any, runId: string) {
  const view = await engine.storage.load(runId);
  return projectFourManeuverView(view);
}

/**
 * Installs the simplified scene-driven projection without changing the legacy
 * MvpStoryEngine import used by StoryService. Later stages replace only the
 * maneuver mutation path; all main-decision behavior remains delegated.
 */
export function installFourManeuverRuntime() {
  const proto = MvpStoryEngine.prototype as any;
  if (proto[INSTALL_MARK]) return;
  proto[INSTALL_MARK] = true;

  const original = {
    create: proto.create,
    submitDecision: proto.submitDecision,
    startCriticalResponse: proto.startCriticalResponse,
    deferCriticalEvent: proto.deferCriticalEvent,
    submitManeuver: proto.submitManeuver,
    advanceDay: proto.advanceDay,
    finalize: proto.finalize
  };

  proto.get = async function(runId: string) {
    return loadAndProject(this, runId);
  };

  proto.create = async function(input: Record<string, unknown> = {}) {
    const result = await original.create.call(this, input);
    return loadAndProject(this, String(result?.run?.id || ""));
  };

  for (const method of ["submitDecision", "startCriticalResponse", "deferCriticalEvent", "submitManeuver", "advanceDay", "finalize"] as const) {
    proto[method] = async function(...args: any[]) {
      const result = await original[method].apply(this, args);
      if (result?.accepted === false) return result;
      return loadAndProject(this, String(args[0] || result?.run?.id || ""));
    };
  }
}
