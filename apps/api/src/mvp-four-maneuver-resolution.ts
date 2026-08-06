import { BadRequestException, ConflictException } from "@nestjs/common";
import { createHash, randomUUID } from "node:crypto";
import { MvpStoryEngine } from "./mvp-causal-runtime";
import type { MvpView } from "./mvp-types";
import {
  getInvestigationDefinition,
  getLeverageDefinition,
  getManeuverActor,
  getManeuverSceneConfig
} from "./mvp-maneuver-config";
import {
  ensureFourManeuverState,
  projectFourManeuverView,
  projectManeuverPanel,
  type FourManeuverPanelProjection,
  type FourManeuverState,
  type FourManeuverType
} from "./mvp-four-maneuver-runtime";

const MARK = Symbol.for("our-many-worlds:mvp-four-maneuver-resolution-v1");
const TYPES: FourManeuverType[] = ["contact", "investigate", "leverage", "custom"];

type Command = {
  version: number;
  idempotencyKey?: unknown;
  maneuverType?: unknown;
  targetRoleKey?: unknown;
  messageText?: unknown;
  intentKey?: unknown;
  leverageKey?: unknown;
  customText?: unknown;
};

type Plan = {
  maneuverType: FourManeuverType;
  sceneKey: string;
  originEventId: string;
  title: string;
  narrative: string;
  statePatch: Record<string, number>;
  factKeys: string[];
  traces: string[];
  eventType: "contact_resolved" | "investigation_resolved" | "leverage_used" | "custom_maneuver_resolved";
  targetRoleKey?: string;
  consumedLeverageKey?: string;
};

const uniq = <T>(items: T[]) => [...new Set(items)];
const text = (value: unknown) => String(value || "").trim();
const eventId = (prefix: string) => `${prefix}_${Date.now().toString(36)}_${randomUUID().slice(0, 8)}`;
const typeOf = (input: Command) => text(input.maneuverType) as FourManeuverType;

function fingerprint(input: Command) {
  const value = {
    maneuverType: text(input.maneuverType),
    targetRoleKey: text(input.targetRoleKey),
    messageText: text(input.messageText),
    intentKey: text(input.intentKey),
    leverageKey: text(input.leverageKey),
    customText: text(input.customText)
  };
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function assertVersion(view: MvpView, version: number) {
  if (!Number.isInteger(version)) throw new ConflictException({ code: "VERSION_REQUIRED", message: "body.version is required", currentVersion: view.run.version });
  if (version !== view.run.version) throw new ConflictException({ code: "VERSION_CONFLICT", message: "story run version conflict", expectedVersion: version, currentVersion: view.run.version });
}

function assertType(panel: FourManeuverPanelProjection, type: FourManeuverType) {
  const section = panel[type];
  if (section.enabled) return;
  const code = section.usedToday ? "MANEUVER_TYPE_ALREADY_USED"
    : panel.quota.remaining <= 0 ? "MANEUVER_LIMIT_REACHED"
      : "MANEUVER_WINDOW_CLOSED";
  throw new ConflictException({ code, message: section.disabledReason || panel.disabledReason || "当前不能执行这项主动谋划" });
}

function guardCustom(value: string) {
  if (/一百万兵|跳到第\s*7\s*天|直接裁决|命令巡抚立即认罪/.test(value)) {
    return { accepted: false, code: "ACTION_BLOCKED", reason: "这项谋划超出当前身份、资源或阶段边界，不能直接改写主线责任。", rewriteSuggestion: "可改为：派幕僚暗查驿站登记，确认巡抚急奏的经手人员。" };
  }
  if (value.length > 200) return { accepted: false, code: "ACTION_BLOCKED", reason: "自拟谋划最多 200 字，请把意图收束成一项可执行的布局。", rewriteSuggestion: value.slice(0, 200) };
  return null;
}

function origin() { return eventId("evt_maneuver"); }

function contactPlan(panel: FourManeuverPanelProjection, input: Command): Plan {
  const roleKey = text(input.targetRoleKey);
  const messageText = text(input.messageText);
  if (!roleKey || !panel.contact.options.some((item) => item.roleKey === roleKey)) throw new BadRequestException({ code: "CONTACT_TARGET_UNAVAILABLE", message: "当前人物不在可交谈列表中" });
  if (!messageText) throw new BadRequestException({ code: "CONTACT_MESSAGE_REQUIRED", message: "请写下要对这个人物说的话" });
  if (messageText.length > 200) throw new BadRequestException({ code: "CONTACT_MESSAGE_TOO_LONG", message: "人物交谈最多 200 字" });
  const definition = getManeuverSceneConfig(panel.sceneKey || "")?.contacts.find((item) => item.roleKey === roleKey);
  if (!definition) throw new BadRequestException({ code: "CONTACT_TARGET_UNAVAILABLE", message: "当前人物不能交谈" });
  return {
    maneuverType: "contact", sceneKey: panel.sceneKey || "", originEventId: origin(),
    title: definition.fallbackTitle,
    narrative: `你向${definition.displayName}说明了来意。\n\n${definition.displayName}回道：“${definition.fallbackReply}”`,
    statePatch: definition.statePatch, factKeys: [], traces: [`${definition.displayName}交谈记录`],
    targetRoleKey: roleKey, eventType: "contact_resolved"
  };
}

function investigationPlan(panel: FourManeuverPanelProjection, input: Command): Plan {
  const intentKey = text(input.intentKey);
  if (!intentKey || !panel.investigate.options.some((item) => item.intentKey === intentKey)) throw new BadRequestException({ code: "INVESTIGATION_UNAVAILABLE", message: "当前调查项不存在或已经失效" });
  const definition = getInvestigationDefinition(intentKey);
  if (!definition) throw new BadRequestException({ code: "INVESTIGATION_UNAVAILABLE", message: "当前调查项不存在" });
  return {
    maneuverType: "investigate", sceneKey: panel.sceneKey || "", originEventId: origin(),
    title: definition.resultTitle, narrative: definition.resultText, statePatch: definition.statePatch,
    factKeys: definition.factKeys, traces: definition.traces, eventType: "investigation_resolved"
  };
}

function leveragePlan(panel: FourManeuverPanelProjection, input: Command): Plan {
  const leverageKey = text(input.leverageKey);
  const option = panel.leverage.options.find((item) => item.leverageKey === leverageKey);
  if (!option) throw new ConflictException({ code: "LEVERAGE_NOT_AVAILABLE", message: "筹码不存在、已使用或当前不可用" });
  const definition = getLeverageDefinition(leverageKey);
  if (!definition) throw new ConflictException({ code: "LEVERAGE_NOT_AVAILABLE", message: "筹码不存在" });
  const targetRoleKey = text(input.targetRoleKey);
  if (definition.requiresTarget && !targetRoleKey) throw new BadRequestException({ code: "LEVERAGE_TARGET_REQUIRED", message: "请先选择筹码使用对象" });
  if (targetRoleKey && !option.targets.some((target) => target.roleKey === targetRoleKey)) throw new BadRequestException({ code: "LEVERAGE_TARGET_INVALID", message: "这张筹码不能用于当前目标" });
  const target = targetRoleKey ? getManeuverActor(targetRoleKey) : null;
  const response = definition.fixedResultText || definition.fallbackReply || "这张牌已经改变了谈判条件。";
  return {
    maneuverType: "leverage", sceneKey: panel.sceneKey || "", originEventId: origin(),
    title: definition.resultTitle,
    narrative: target ? `你向${target.displayName}打出了“${definition.label}”。\n\n${target.displayName}回应：“${response}”\n\n筹码已消耗：${definition.label}` : `${response}\n\n筹码已消耗：${definition.label}`,
    statePatch: definition.statePatch, factKeys: definition.factKeys, traces: [`筹码使用记录：${definition.label}`],
    targetRoleKey: targetRoleKey || undefined, consumedLeverageKey: leverageKey, eventType: "leverage_used"
  };
}

function customPlan(panel: FourManeuverPanelProjection, input: Command): Plan | Record<string, unknown> {
  const value = text(input.customText);
  if (!value) throw new BadRequestException({ code: "MANEUVER_CUSTOM_TEXT_REQUIRED", message: "自拟谋划需要填写内容" });
  const blocked = guardCustom(value);
  if (blocked) return blocked;
  return {
    maneuverType: "custom", sceneKey: panel.sceneKey || "", originEventId: origin(), title: "自拟谋划已执行",
    narrative: `你拟定的布局“${value}”被拆成一项当前可执行的幕僚任务。它没有替代主线决策，但会成为后续剧情可引用的行动记录。`,
    statePatch: { "总督权威": 2, "暗账完整度": 4, "清算风险": 1 }, factKeys: [],
    traces: ["自拟谋划原文", "幕僚执行回执"], eventType: "custom_maneuver_resolved"
  };
}

function compile(panel: FourManeuverPanelProjection, input: Command) {
  const type = typeOf(input);
  if (type === "contact") return contactPlan(panel, input);
  if (type === "investigate") return investigationPlan(panel, input);
  if (type === "leverage") return leveragePlan(panel, input);
  return customPlan(panel, input);
}

function clamp(value: number) { return Math.max(0, Math.min(100, Math.round(Number(value) || 0))); }
function applyPatch(view: MvpView, patch: Record<string, number>) {
  const world = Array.isArray(view.dashboard.worldState) ? view.dashboard.worldState : [];
  const roles = view.dashboard.roleState && typeof view.dashboard.roleState === "object" ? view.dashboard.roleState : (view.dashboard.roleState = {});
  for (const [key, delta] of Object.entries(patch)) {
    const row = world.find((item: any) => Array.isArray(item) && String(item[0]) === key);
    if (row) row[1] = clamp(Number(row[1]) + delta);
    else roles[key] = clamp(Number(roles[key] || 0) + delta);
  }
  view.dashboard.latestChanges = Object.entries(patch).map(([key, delta]) => `${key} ${delta >= 0 ? "+" : ""}${delta}`);
}

function evt(type: string, payload: Record<string, unknown>) { return { id: eventId("event"), type, payload, createdAt: new Date().toISOString() }; }
function message(view: MvpView, plan: Plan) {
  return {
    id: eventId("msg"), day: view.run.currentDay, time: "主劢谋划", type: "maneuver_result", label: "主劢谋划",
    title: plan.title, body: plan.narrative, maneuverType: plan.maneuverType, originEventId: plan.originEventId,
    ...(plan.consumedLeverageKey ? { consumedLeverageKey: plan.consumedLeverageKey } : {}),
    ...(plan.factKeys.length ? { discoveredFactKeys: plan.factKeys } : {})
  };
}

async function submit(engine: any, runId: string, input: Command) {
  const stored = ensureFourManeuverState(await engine.storage.load(runId));
  const idempotencyKey = text(input.idempotencyKey);
  if (!idempotencyKey) throw new BadRequestException({ code: "IDEMPOTENCY_KEY_REQUIRED", message: "idempotencyKey is required" });
  const requestFingerprint = fingerprint(input);
  const previous = stored.events.find((item) => item.type === "maneuver_submitted" && text(item.payload?.idempotencyKey) === idempotencyKey);
  if (previous) {
    if (text(previous.payload?.requestFingerprint) !== requestFingerprint) throw new ConflictException({ code: "IDEMPOTENCY_KEY_REUSED", message: "同一幂等键不能用于不同主劢谋划" });
    return projectFourManeuverView(stored);
  }
  assertVersion(stored, Number(input.version));
  const type = typeOf(input);
  if (!TYPES.includes(type)) throw new BadRequestException({ code: "MANEUVER_TYPE_INVALID", message: "不支持的谋划类型" });
  const panel = projectManeuverPanel(stored);
  assertType(panel, type);
  const planOrGuard = compile(panel, input);
  if ((planOrGuard as any).accepted === false) return planOrGuard;
  const plan = planOrGuard as Plan;
  const expectedVersion = stored.run.version;
  const view = ensureFourManeuverState(structuredClone(stored));
  applyPatch(view, plan.statePatch);
  view.dashboard.traces = uniq([...(Array.isArray(view.dashboard.traces) ? view.dashboard.traces.map(String) : []), ...plan.traces]);
  const state = view.maneuverState as unknown as FourManeuverState;
  state.usedTypesToday = uniq([...state.usedTypesToday, type]);
  state.discoveredFactKeys = uniq([...state.discoveredFactKeys, ...plan.factKeys]);
  if (plan.consumedLeverageKey) state.usedLeverageKeys = uniq([...state.usedLeverageKeys, plan.consumedLeverageKey]);
  state.maneuversUsedToday += 1;
  state.maneuverOpportunitiesRemaining = Math.max(0, state.maneuverOpportunitiesRemaining - 1);
  state.totalManeuversUsed += 1;
  view.messages.push(message(view, plan));
  const common = { day: view.run.currentDay, sceneKey: plan.sceneKey, originEventId: plan.originEventId };
  view.events.push(evt("maneuver", { ...common, maneuverType: type }));
  view.events.push(evt("maneuver_submitted", {
    ...common, idempotencyKey, requestFingerprint, maneuverType: type, targetRoleKey: plan.targetRoleKey || "",
    messageText: type === "contact" ? text(input.messageText) : "", intentKey: type === "investigate" ? text(input.intentKey) : "",
    leverageKey: type === "leverage" ? text(input.leverageKey) : "", customText: type === "custom" ? text(input.customText) : ""
  }));
  view.events.push(evt(plan.eventType, { ...common, targetRoleKey: plan.targetRoleKey || "", consumedLeverageKey: plan.consumedLeverageKey || "", factKeys: plan.factKeys }));
  view.events.push(evt("maneuver_result", { ...common, patch: plan.statePatch }));
  view.events.push(evt("state_patch", { ...common, patch: plan.statePatch }));
  for (const factKey of plan.factKeys) view.events.push(evt("fact_discovered", { ...common, factKey, factKeys: [factKey] }));
  view.run.version = expectedVersion + 1;
  view.run.updatedAt = new Date().toISOString();
  await engine.storage.save(view, expectedVersion);
  return projectFourManeuverView(view);
}

export function installFourManeuverResolution() {
  const proto = MvpStoryEngine.prototype as any;
  if (proto[MARK]) return;
  proto[MARK] = true;
  proto.submitManeuver = function(runId: string, input: Command) { return submit(this, runId, input); };
}
