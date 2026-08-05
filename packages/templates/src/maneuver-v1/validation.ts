import {
  CardLayoutDraftV1,
  CreateActionPreviewCommandV1,
  CustomPlanDraftV1,
  InvestigationDraftV1,
  ManeuverDraftV1,
  ReactionDraftV1,
  ConversationDraftV1,
} from "./types";

export class ManeuverValidationError extends Error {
  readonly code: string;
  readonly path: string;

  constructor(code: string, message: string, path = "$") {
    super(message);
    this.name = "ManeuverValidationError";
    this.code = code;
    this.path = path;
  }
}

const TOP_LEVEL_COMMAND_KEYS = new Set([
  "idempotencyKey",
  "turnRevision",
  "expectedStateRevision",
  "expectedManeuverWindowVersion",
  "controlEpoch",
  "draft",
]);

const DRAFT_KEYS: Record<ManeuverDraftV1["kind"], Set<string>> = {
  CONVERSATION: new Set([
    "schemaVersion",
    "kind",
    "targetActorId",
    "message",
    "purpose",
    "visibility",
    "attachmentAssetKeys",
    "formalAgreementRequested",
  ]),
  INVESTIGATION: new Set([
    "schemaVersion",
    "kind",
    "traceId",
    "routeId",
    "executorAssetKey",
    "attachmentAssetKeys",
  ]),
  CARD_LAYOUT: new Set([
    "schemaVersion",
    "kind",
    "cardAssetKey",
    "playMode",
    "targetId",
    "triggerPatternId",
  ]),
  CUSTOM_PLAN: new Set([
    "schemaVersion",
    "kind",
    "rawText",
    "attachmentAssetKeys",
    "visibilityPreference",
  ]),
  REACTION: new Set([
    "schemaVersion",
    "kind",
    "reactionId",
    "optionId",
    "rawText",
    "cardAssetKey",
    "hold",
  ]),
};

function requireObject(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ManeuverValidationError("MANEUVER_DRAFT_INVALID", `${path} 必须是对象。`, path);
  }
  return value as Record<string, unknown>;
}

function rejectUnknownKeys(value: Record<string, unknown>, allowed: Set<string>, path: string): void {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      throw new ManeuverValidationError("MANEUVER_UNKNOWN_FIELD", `${path}.${key} 不是允许的字段。`, `${path}.${key}`);
    }
  }
}

function requireString(value: unknown, path: string, { min = 1, max = 500 }: { min?: number; max?: number } = {}): string {
  if (typeof value !== "string") {
    throw new ManeuverValidationError("MANEUVER_DRAFT_INVALID", `${path} 必须是字符串。`, path);
  }
  const normalized = value.trim();
  if (normalized.length < min || normalized.length > max) {
    throw new ManeuverValidationError(
      "MANEUVER_DRAFT_INVALID",
      `${path} 长度必须在 ${min} 到 ${max} 个字符之间。`,
      path,
    );
  }
  return normalized;
}

function requireInteger(value: unknown, path: string, min = 0): number {
  if (!Number.isInteger(value) || Number(value) < min) {
    throw new ManeuverValidationError("MANEUVER_DRAFT_INVALID", `${path} 必须是大于等于 ${min} 的整数。`, path);
  }
  return Number(value);
}

function requireBoolean(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") {
    throw new ManeuverValidationError("MANEUVER_DRAFT_INVALID", `${path} 必须是布尔值。`, path);
  }
  return value;
}

function requireEnum<T extends string>(value: unknown, allowed: readonly T[], path: string): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    throw new ManeuverValidationError(
      "MANEUVER_DRAFT_INVALID",
      `${path} 必须是 ${allowed.join("、")} 之一。`,
      path,
    );
  }
  return value as T;
}

function requireStringArray(value: unknown, path: string, maxItems = 1): string[] {
  if (!Array.isArray(value)) {
    throw new ManeuverValidationError("MANEUVER_DRAFT_INVALID", `${path} 必须是数组。`, path);
  }
  if (value.length > maxItems) {
    throw new ManeuverValidationError(
      "MANEUVER_TOO_MANY_ATTACHMENTS",
      `${path} 最多允许 ${maxItems} 项。`,
      path,
    );
  }
  const result = value.map((item, index) => requireString(item, `${path}[${index}]`, { max: 160 }));
  if (new Set(result).size !== result.length) {
    throw new ManeuverValidationError("MANEUVER_DRAFT_INVALID", `${path} 不能包含重复项。`, path);
  }
  return result;
}

function parseConversation(value: Record<string, unknown>): ConversationDraftV1 {
  rejectUnknownKeys(value, DRAFT_KEYS.CONVERSATION, "$.draft");
  return {
    schemaVersion: requireEnum(value.schemaVersion, ["maneuver_draft_v1"], "$.draft.schemaVersion"),
    kind: "CONVERSATION",
    targetActorId: requireString(value.targetActorId, "$.draft.targetActorId", { max: 160 }),
    message: requireString(value.message, "$.draft.message", { max: 1000 }),
    purpose: value.purpose === undefined
      ? undefined
      : requireEnum(value.purpose, ["ASK", "TEST", "PERSUADE", "EXCHANGE", "PRESSURE", "PROPOSE_TERM"] as const, "$.draft.purpose"),
    visibility: requireEnum(value.visibility, ["LIMITED", "PUBLIC"], "$.draft.visibility"),
    attachmentAssetKeys: requireStringArray(value.attachmentAssetKeys, "$.draft.attachmentAssetKeys"),
    formalAgreementRequested: requireBoolean(value.formalAgreementRequested, "$.draft.formalAgreementRequested"),
  };
}

function parseInvestigation(value: Record<string, unknown>): InvestigationDraftV1 {
  rejectUnknownKeys(value, DRAFT_KEYS.INVESTIGATION, "$.draft");
  return {
    schemaVersion: requireEnum(value.schemaVersion, ["maneuver_draft_v1"], "$.draft.schemaVersion"),
    kind: "INVESTIGATION",
    traceId: requireString(value.traceId, "$.draft.traceId", { max: 160 }),
    routeId: requireString(value.routeId, "$.draft.routeId", { max: 160 }),
    executorAssetKey: value.executorAssetKey === undefined
      ? undefined
      : requireString(value.executorAssetKey, "$.draft.executorAssetKey", { max: 160 }),
    attachmentAssetKeys: requireStringArray(value.attachmentAssetKeys, "$.draft.attachmentAssetKeys"),
  };
}

function parseCardLayout(value: Record<string, unknown>): CardLayoutDraftV1 {
  rejectUnknownKeys(value, DRAFT_KEYS.CARD_LAYOUT, "$.draft");
  const playMode = requireEnum(value.playMode, ["ACTIVE", "SET"], "$.draft.playMode");
  const triggerPatternId = value.triggerPatternId === undefined
    ? undefined
    : requireString(value.triggerPatternId, "$.draft.triggerPatternId", { max: 160 });
  if (playMode === "SET" && !triggerPatternId) {
    throw new ManeuverValidationError(
      "MANEUVER_DRAFT_INVALID",
      "伏置筹码必须选择一个允许的触发条件。",
      "$.draft.triggerPatternId",
    );
  }
  if (playMode === "ACTIVE" && triggerPatternId) {
    throw new ManeuverValidationError(
      "MANEUVER_DRAFT_INVALID",
      "主动打出的筹码不能同时提交伏置触发条件。",
      "$.draft.triggerPatternId",
    );
  }
  return {
    schemaVersion: requireEnum(value.schemaVersion, ["maneuver_draft_v1"], "$.draft.schemaVersion"),
    kind: "CARD_LAYOUT",
    cardAssetKey: requireString(value.cardAssetKey, "$.draft.cardAssetKey", { max: 160 }),
    playMode,
    targetId: requireString(value.targetId, "$.draft.targetId", { max: 160 }),
    triggerPatternId,
  };
}

function parseCustomPlan(value: Record<string, unknown>): CustomPlanDraftV1 {
  rejectUnknownKeys(value, DRAFT_KEYS.CUSTOM_PLAN, "$.draft");
  return {
    schemaVersion: requireEnum(value.schemaVersion, ["maneuver_draft_v1"], "$.draft.schemaVersion"),
    kind: "CUSTOM_PLAN",
    rawText: requireString(value.rawText, "$.draft.rawText", { max: 1200 }),
    attachmentAssetKeys: requireStringArray(value.attachmentAssetKeys, "$.draft.attachmentAssetKeys"),
    visibilityPreference: value.visibilityPreference === undefined
      ? undefined
      : requireEnum(value.visibilityPreference, ["QUIET", "NORMAL", "PUBLIC"] as const, "$.draft.visibilityPreference"),
  };
}

function parseReaction(value: Record<string, unknown>): ReactionDraftV1 {
  rejectUnknownKeys(value, DRAFT_KEYS.REACTION, "$.draft");
  const hold = value.hold === undefined ? false : requireBoolean(value.hold, "$.draft.hold");
  const optionId = value.optionId === undefined ? undefined : requireString(value.optionId, "$.draft.optionId", { max: 160 });
  const rawText = value.rawText === undefined ? undefined : requireString(value.rawText, "$.draft.rawText", { max: 800 });
  const cardAssetKey = value.cardAssetKey === undefined
    ? undefined
    : requireString(value.cardAssetKey, "$.draft.cardAssetKey", { max: 160 });
  if (hold && (optionId || rawText || cardAssetKey)) {
    throw new ManeuverValidationError(
      "REACTION_HOLD_CONFLICT",
      "选择暂不应变时，不能同时提交应变选项、自由文本或筹码。",
      "$.draft",
    );
  }
  if (!hold && !optionId && !rawText && !cardAssetKey) {
    throw new ManeuverValidationError(
      "MANEUVER_DRAFT_INVALID",
      "应变必须选择一个选项、写下应变方式、使用一张应变牌，或者明确暂不应变。",
      "$.draft",
    );
  }
  return {
    schemaVersion: requireEnum(value.schemaVersion, ["maneuver_draft_v1"], "$.draft.schemaVersion"),
    kind: "REACTION",
    reactionId: requireString(value.reactionId, "$.draft.reactionId", { max: 160 }),
    optionId,
    rawText,
    cardAssetKey,
    hold,
  };
}

export function parseManeuverDraftV1(input: unknown): ManeuverDraftV1 {
  const value = requireObject(input, "$.draft");
  const kind = requireEnum(
    value.kind,
    ["CONVERSATION", "INVESTIGATION", "CARD_LAYOUT", "CUSTOM_PLAN", "REACTION"],
    "$.draft.kind",
  );
  switch (kind) {
    case "CONVERSATION": return parseConversation(value);
    case "INVESTIGATION": return parseInvestigation(value);
    case "CARD_LAYOUT": return parseCardLayout(value);
    case "CUSTOM_PLAN": return parseCustomPlan(value);
    case "REACTION": return parseReaction(value);
  }
}

export function parseCreateActionPreviewCommandV1(input: unknown): CreateActionPreviewCommandV1 {
  const value = requireObject(input, "$");
  rejectUnknownKeys(value, TOP_LEVEL_COMMAND_KEYS, "$");
  return {
    idempotencyKey: requireString(value.idempotencyKey, "$.idempotencyKey", { max: 240 }),
    turnRevision: requireInteger(value.turnRevision, "$.turnRevision"),
    expectedStateRevision: requireInteger(value.expectedStateRevision, "$.expectedStateRevision"),
    expectedManeuverWindowVersion: requireInteger(value.expectedManeuverWindowVersion, "$.expectedManeuverWindowVersion"),
    controlEpoch: requireInteger(value.controlEpoch, "$.controlEpoch"),
    draft: parseManeuverDraftV1(value.draft),
  };
}
