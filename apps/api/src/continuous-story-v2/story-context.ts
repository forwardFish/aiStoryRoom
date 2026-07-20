import { createHash } from "node:crypto";

export type StoryContextPriorityV2 = "P0" | "P1" | "P2" | "P3";
export type StoryContextVisibilityV2 = "PRIVATE" | "LIMITED" | "OBSERVABLE" | "PUBLIC";
export type StoryContextPurposeV2 =
  | "OPENING"
  | "RESULT"
  | "IMPACT"
  | "NEXT_SITUATION"
  | "DECISION"
  | "ENDING"
  | "AGENT_DECISION";

export type StoryContextSourceTypeV2 =
  | "ROLE_IDENTITY"
  | "ROLE_AUTHORITY"
  | "KNOWLEDGE_BOUNDARY"
  | "WORLD_BIBLE"
  | "CURRENT_SCENE"
  | "ACTIVE_PRESSURE"
  | "DEADLINE"
  | "RECENT_CANON"
  | "VISIBLE_FACT"
  | "PLAYER_INTENT"
  | "RULE_RESOLUTION"
  | "OPEN_THREAD"
  | "COMMITMENT"
  | "ACTIVE_CONDITION"
  | "UNANSWERED_INTERACTION"
  | "INJURY_OR_LOSS"
  | "ASSET_OR_EVIDENCE"
  | "RELATIONSHIP"
  | "PROMISE_OR_DEBT"
  | "INCOMING_IMPACT"
  | "ARC_GUIDANCE"
  | "ACTION_AFFORDANCE";

export type StoryContextIdentityV2 = {
  runId: string;
  templateKey: string;
  engineVersion: string;
  roleId: string;
  actorTurnId: string;
  macroStageKey: string;
  worldSequence: number;
  turnRevision: number;
  controlEpoch: number;
};

export type StoryContextAudienceV2 = {
  roleName: string;
  publicIdentity: string;
  authority: string[];
  cannotDo: string[];
  privateGoal: string;
  knowledgeBoundary: string[];
};

export type StoryContextSourceV2 = {
  itemId: string;
  sourceType: StoryContextSourceTypeV2;
  sourceId: string;
  title: string;
  content: string;
  visibility: StoryContextVisibilityV2;
  knownByRoleIds: string[];
  basedOnWorldSequence: number;
  inclusionReason: string;
  priority: StoryContextPriorityV2;
  mustPreserve: boolean;
  chronologicalOrder?: number;
};

export type StoryContextIncludedItemV2 = {
  itemId: string;
  sourceType: StoryContextSourceTypeV2;
  sourceId: string;
  title: string;
  content: string;
  priority: StoryContextPriorityV2;
  visibility: StoryContextVisibilityV2;
  basedOnWorldSequence: number;
  chars: number;
  tokenEstimate: number;
  reason: string;
  contentHash: string;
};

export type ContextReportV2 = {
  runId: string;
  roleId: string;
  actorTurnId: string;
  purpose: StoryContextPurposeV2;
  worldSequence: number;
  turnRevision: number;
  snapshotHash: string | null;
  status: "READY" | "REJECTED";
  issueCodes: string[];
  included: Array<{
    itemId: string;
    sourceType: StoryContextSourceTypeV2;
    chars: number;
    tokenEstimate: number;
    reason: string;
    contentHash: string;
  }>;
  truncated: Array<{
    itemId: string;
    beforeChars: number;
    afterChars: number;
    retainedAnchors: string[];
  }>;
  dropped: Array<{
    itemId: string;
    sourceType: StoryContextSourceTypeV2;
    priority: StoryContextPriorityV2;
    reason: "ACL_DENIED" | "BUDGET_EXHAUSTED" | "P0_BUDGET_EXCEEDED" | "EMPTY_CONTENT";
  }>;
  budgets: {
    total: { used: number; max: number };
    byPriority: Record<StoryContextPriorityV2, { used: number; includedItems: number }>;
  };
  aclDecisionHash: string;
  requiredSourceTypes: StoryContextSourceTypeV2[];
  missingRequiredSourceTypes: StoryContextSourceTypeV2[];
};

export type StoryContextSnapshotV2 = {
  identity: StoryContextIdentityV2 & { snapshotHash: string };
  purpose: StoryContextPurposeV2;
  audience: StoryContextAudienceV2;
  items: StoryContextIncludedItemV2[];
  recentCanon: StoryContextIncludedItemV2[];
  renderedWorkingSet: string;
  contextReport: ContextReportV2;
};

export type CompileStoryContextInputV2 = {
  identity: StoryContextIdentityV2;
  purpose: StoryContextPurposeV2;
  audience: StoryContextAudienceV2;
  sources: StoryContextSourceV2[];
  maxTokenEstimate: number;
  requiredSourceTypes?: StoryContextSourceTypeV2[];
};

export type CompileStoryContextResultV2 =
  | { ok: true; snapshot: StoryContextSnapshotV2; report: ContextReportV2 }
  | { ok: false; report: ContextReportV2 };

const PRIORITY_ORDER: Record<StoryContextPriorityV2, number> = { P0: 0, P1: 1, P2: 2, P3: 3 };

const SECTION_ORDER: StoryContextSourceTypeV2[] = [
  "ROLE_IDENTITY",
  "ROLE_AUTHORITY",
  "KNOWLEDGE_BOUNDARY",
  "WORLD_BIBLE",
  "CURRENT_SCENE",
  "ACTIVE_PRESSURE",
  "DEADLINE",
  "VISIBLE_FACT",
  "COMMITMENT",
  "ACTIVE_CONDITION",
  "UNANSWERED_INTERACTION",
  "INJURY_OR_LOSS",
  "ASSET_OR_EVIDENCE",
  "RELATIONSHIP",
  "PROMISE_OR_DEBT",
  "OPEN_THREAD",
  "INCOMING_IMPACT",
  "ARC_GUIDANCE",
  "ACTION_AFFORDANCE",
  "RULE_RESOLUTION",
  "RECENT_CANON",
  "PLAYER_INTENT"
];

const SECTION_LABELS: Record<StoryContextSourceTypeV2, string> = {
  ROLE_IDENTITY: "角色身份",
  ROLE_AUTHORITY: "权限与边界",
  KNOWLEDGE_BOUNDARY: "角色已知与未知",
  WORLD_BIBLE: "世界与时代约束",
  CURRENT_SCENE: "当前场景",
  ACTIVE_PRESSURE: "眼前压力",
  DEADLINE: "有效期限",
  RECENT_CANON: "最近完整正文（当前连续性的最高权威）",
  VISIBLE_FACT: "已确认可见事实",
  PLAYER_INTENT: "玩家本轮真实行动",
  RULE_RESOLUTION: "确定性规则结算",
  OPEN_THREAD: "尚未解决的线索",
  COMMITMENT: "尚未履行的承诺",
  ACTIVE_CONDITION: "已经布置的条件后手",
  UNANSWERED_INTERACTION: "正在等待本人回应的交互",
  INJURY_OR_LOSS: "伤害与损失",
  ASSET_OR_EVIDENCE: "当前持有的筹码与证据",
  RELATIONSHIP: "关系、信任与敌意",
  PROMISE_OR_DEBT: "未清偿的许诺与债务",
  INCOMING_IMPACT: "他人行动造成的可见影响",
  ARC_GUIDANCE: "宏观张力方向",
  ACTION_AFFORDANCE: "此刻真实可用的能力"
};

const DEFAULT_REQUIRED: Record<StoryContextPurposeV2, StoryContextSourceTypeV2[]> = {
  OPENING: ["ROLE_IDENTITY", "ROLE_AUTHORITY", "KNOWLEDGE_BOUNDARY", "WORLD_BIBLE", "CURRENT_SCENE", "ACTIVE_PRESSURE"],
  RESULT: ["ROLE_IDENTITY", "ROLE_AUTHORITY", "KNOWLEDGE_BOUNDARY", "CURRENT_SCENE", "RECENT_CANON", "PLAYER_INTENT", "RULE_RESOLUTION"],
  IMPACT: ["ROLE_IDENTITY", "ROLE_AUTHORITY", "KNOWLEDGE_BOUNDARY", "CURRENT_SCENE", "INCOMING_IMPACT"],
  NEXT_SITUATION: ["ROLE_IDENTITY", "ROLE_AUTHORITY", "KNOWLEDGE_BOUNDARY", "CURRENT_SCENE", "RECENT_CANON", "ACTIVE_PRESSURE"],
  DECISION: ["ROLE_IDENTITY", "ROLE_AUTHORITY", "KNOWLEDGE_BOUNDARY", "CURRENT_SCENE", "RECENT_CANON", "ACTIVE_PRESSURE", "ACTION_AFFORDANCE"],
  ENDING: ["ROLE_IDENTITY", "ROLE_AUTHORITY", "KNOWLEDGE_BOUNDARY", "RECENT_CANON", "RULE_RESOLUTION"],
  AGENT_DECISION: ["ROLE_IDENTITY", "ROLE_AUTHORITY", "KNOWLEDGE_BOUNDARY", "CURRENT_SCENE", "RECENT_CANON", "ACTIVE_PRESSURE", "ACTION_AFFORDANCE"]
};

export function compileStoryContextV2(input: CompileStoryContextInputV2): CompileStoryContextResultV2 {
  if (!Number.isInteger(input.maxTokenEstimate) || input.maxTokenEstimate <= 0) {
    throw new Error("maxTokenEstimate must be a positive integer");
  }

  const requiredSourceTypes = unique(input.requiredSourceTypes ?? DEFAULT_REQUIRED[input.purpose]);
  const aclDecisions: Array<{ itemId: string; allowed: boolean; visibility: StoryContextVisibilityV2; knownByRoleIds: string[] }> = [];
  const dropped: ContextReportV2["dropped"] = [];
  const authorized: StoryContextSourceV2[] = [];

  for (const source of input.sources) {
    const allowed = isSourceVisibleToRole(source, input.identity.roleId);
    aclDecisions.push({
      itemId: source.itemId,
      allowed,
      visibility: source.visibility,
      knownByRoleIds: [...source.knownByRoleIds].sort()
    });
    if (!allowed) {
      dropped.push({ itemId: source.itemId, sourceType: source.sourceType, priority: source.priority, reason: "ACL_DENIED" });
      continue;
    }
    if (source.content.trim().length === 0) {
      dropped.push({ itemId: source.itemId, sourceType: source.sourceType, priority: source.priority, reason: "EMPTY_CONTENT" });
      continue;
    }
    authorized.push(normalizeSource(source));
  }

  const authorizedTypes = new Set(authorized.map((source) => source.sourceType));
  const missingRequiredSourceTypes = requiredSourceTypes.filter((sourceType) => !authorizedTypes.has(sourceType));
  const aclDecisionHash = sha256(stableStringify(aclDecisions.sort((a, b) => a.itemId.localeCompare(b.itemId))));
  const sorted = [...authorized].sort(compareSources);
  const selected: StoryContextIncludedItemV2[] = [];
  const byPriority: ContextReportV2["budgets"]["byPriority"] = {
    P0: { used: 0, includedItems: 0 },
    P1: { used: 0, includedItems: 0 },
    P2: { used: 0, includedItems: 0 },
    P3: { used: 0, includedItems: 0 }
  };
  let used = estimateAudienceTokens(input.audience);
  let p0Overflow = false;

  for (const source of sorted) {
    const item = toIncludedItem(source);
    const itemCost = estimateRenderedItemTokens(item);
    const mandatory = source.priority === "P0" || source.mustPreserve;
    if (used + itemCost > input.maxTokenEstimate) {
      if (mandatory) {
        p0Overflow = true;
        dropped.push({ itemId: source.itemId, sourceType: source.sourceType, priority: source.priority, reason: "P0_BUDGET_EXCEEDED" });
      } else {
        dropped.push({ itemId: source.itemId, sourceType: source.sourceType, priority: source.priority, reason: "BUDGET_EXHAUSTED" });
      }
      continue;
    }
    selected.push(item);
    used += itemCost;
    byPriority[source.priority].used += itemCost;
    byPriority[source.priority].includedItems += 1;
  }

  const issueCodes: string[] = [];
  if (missingRequiredSourceTypes.length > 0) issueCodes.push("MISSING_REQUIRED_CONTEXT");
  if (p0Overflow) issueCodes.push("P0_CONTEXT_BUDGET_EXCEEDED");

  const baseReport: ContextReportV2 = {
    runId: input.identity.runId,
    roleId: input.identity.roleId,
    actorTurnId: input.identity.actorTurnId,
    purpose: input.purpose,
    worldSequence: input.identity.worldSequence,
    turnRevision: input.identity.turnRevision,
    snapshotHash: null,
    status: issueCodes.length === 0 ? "READY" : "REJECTED",
    issueCodes,
    included: selected.map((item) => ({
      itemId: item.itemId,
      sourceType: item.sourceType,
      chars: item.chars,
      tokenEstimate: item.tokenEstimate,
      reason: item.reason,
      contentHash: item.contentHash
    })),
    truncated: [],
    dropped,
    budgets: { total: { used, max: input.maxTokenEstimate }, byPriority },
    aclDecisionHash,
    requiredSourceTypes,
    missingRequiredSourceTypes
  };

  if (issueCodes.length > 0) return { ok: false, report: baseReport };

  const canonicalSnapshot = {
    identity: input.identity,
    purpose: input.purpose,
    audience: input.audience,
    items: selected.map(({ chars: _chars, tokenEstimate: _tokens, ...item }) => item),
    aclDecisionHash
  };
  const snapshotHash = sha256(stableStringify(canonicalSnapshot));
  const report: ContextReportV2 = { ...baseReport, snapshotHash };
  const snapshot: StoryContextSnapshotV2 = {
    identity: { ...input.identity, snapshotHash },
    purpose: input.purpose,
    audience: input.audience,
    items: selected,
    recentCanon: selected.filter((item) => item.sourceType === "RECENT_CANON"),
    renderedWorkingSet: renderWorkingSet(input.audience, selected),
    contextReport: report
  };
  return { ok: true, snapshot, report };
}

export function validateStoryContextFreshnessV2(
  snapshot: StoryContextSnapshotV2,
  current: Pick<StoryContextIdentityV2, "runId" | "roleId" | "actorTurnId" | "worldSequence" | "turnRevision" | "controlEpoch">
): { status: "CURRENT" | "SUPERSEDED"; reasons: string[] } {
  const reasons: string[] = [];
  if (snapshot.identity.runId !== current.runId) reasons.push("RUN_CHANGED");
  if (snapshot.identity.roleId !== current.roleId) reasons.push("ROLE_CHANGED");
  if (snapshot.identity.actorTurnId !== current.actorTurnId) reasons.push("ACTOR_TURN_CHANGED");
  if (snapshot.identity.worldSequence !== current.worldSequence) reasons.push("WORLD_SEQUENCE_CHANGED");
  if (snapshot.identity.turnRevision !== current.turnRevision) reasons.push("TURN_REVISION_CHANGED");
  if (snapshot.identity.controlEpoch !== current.controlEpoch) reasons.push("CONTROL_EPOCH_CHANGED");
  return { status: reasons.length === 0 ? "CURRENT" : "SUPERSEDED", reasons };
}

export function hashStoryTextV2(text: string): string {
  return sha256(text.trim());
}

export function estimateStoryContextTokensV2(text: string): number {
  let units = 0;
  for (const character of text) units += character.charCodeAt(0) <= 0x7f ? 0.25 : 1;
  return Math.max(1, Math.ceil(units));
}

function normalizeSource(source: StoryContextSourceV2): StoryContextSourceV2 {
  return {
    ...source,
    title: source.title.trim(),
    content: source.content.trim(),
    knownByRoleIds: unique(source.knownByRoleIds).sort()
  };
}

function isSourceVisibleToRole(source: StoryContextSourceV2, roleId: string): boolean {
  if (source.visibility === "PUBLIC") return true;
  return source.knownByRoleIds.includes(roleId);
}

function compareSources(left: StoryContextSourceV2, right: StoryContextSourceV2): number {
  const priority = PRIORITY_ORDER[left.priority] - PRIORITY_ORDER[right.priority];
  if (priority !== 0) return priority;
  const section = SECTION_ORDER.indexOf(left.sourceType) - SECTION_ORDER.indexOf(right.sourceType);
  if (section !== 0) return section;
  const chronology = (left.chronologicalOrder ?? left.basedOnWorldSequence) - (right.chronologicalOrder ?? right.basedOnWorldSequence);
  if (chronology !== 0) return chronology;
  return left.itemId.localeCompare(right.itemId);
}

function toIncludedItem(source: StoryContextSourceV2): StoryContextIncludedItemV2 {
  return {
    itemId: source.itemId,
    sourceType: source.sourceType,
    sourceId: source.sourceId,
    title: source.title,
    content: source.content,
    priority: source.priority,
    visibility: source.visibility,
    basedOnWorldSequence: source.basedOnWorldSequence,
    chars: source.content.length,
    tokenEstimate: estimateStoryContextTokensV2(source.content),
    reason: source.inclusionReason,
    contentHash: sha256(source.content)
  };
}

function estimateRenderedItemTokens(item: StoryContextIncludedItemV2): number {
  return estimateStoryContextTokensV2(`## ${SECTION_LABELS[item.sourceType]}\n### ${item.title}\n${item.content}`);
}

function estimateAudienceTokens(audience: StoryContextAudienceV2): number {
  return estimateStoryContextTokensV2(renderAudience(audience));
}

function renderWorkingSet(audience: StoryContextAudienceV2, items: StoryContextIncludedItemV2[]): string {
  const grouped = new Map<StoryContextSourceTypeV2, StoryContextIncludedItemV2[]>();
  for (const item of items) {
    const group = grouped.get(item.sourceType) ?? [];
    group.push(item);
    grouped.set(item.sourceType, group);
  }
  const sections = [renderAudience(audience)];
  for (const sourceType of SECTION_ORDER) {
    const group = grouped.get(sourceType);
    if (!group || group.length === 0) continue;
    sections.push(`## ${SECTION_LABELS[sourceType]}\n${group.map((item) => `### ${item.title}\n${item.content}`).join("\n\n")}`);
  }
  return sections.join("\n\n");
}

function renderAudience(audience: StoryContextAudienceV2): string {
  return [
    "## 本角色视角",
    `${audience.roleName}（${audience.publicIdentity}）`,
    `可用权限：${audience.authority.join("；") || "无额外权限"}`,
    `不可越过：${audience.cannotDo.join("；") || "遵守世界与角色边界"}`,
    `私人目标：${audience.privateGoal}`,
    `知识边界：${audience.knowledgeBoundary.join("；") || "只使用当前角色已经知道的事实"}`
  ].join("\n");
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((entry) => stableStringify(entry)).join(",")}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(object[key])}`).join(",")}}`;
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}
