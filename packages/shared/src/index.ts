export type RunMode = "single" | "invite" | "public_later" | "ai-trio";
export type RiskLevel = "safe" | "normal" | "risky";
export type ActionType =
  | "observe"
  | "ask"
  | "hide"
  | "cooperate"
  | "investigate"
  | "confront"
  | "choose"
  | "custom";

export type SubmitActionInput = {
  runId?: string;
  roleId: string;
  actionType: ActionType;
  targetType?: "location" | "object" | "npc" | "player_role" | "self" | "unknown";
  targetId?: string;
  targetText?: string;
  method: string;
  intent: string;
  riskLevel: RiskLevel;
  freeText?: string;
};

export type MockLoginInput = {
  mockOpenid?: string;
  nickname?: string;
  avatarUrl?: string;
};

export type CreateStoryRunInput = {
  templateId: string;
  mode: RunMode;
  maxPlayers: number;
  aiPlayerCount: number;
  tone?: string;
  ownerAsPlayer?: boolean;
};

export type ClaimRoleResponse = {
  roleId: string;
  roleName: string;
  playerId: string;
};

export type FateLineView = {
  personalHook: string;
  destinyQuestion: string;
  privateClues: string[];
};

export type ActionGuardStatus = "ok" | "rewrite_needed" | "blocked";

export type ActionGuardContract = {
  status: "accepted" | "rejected";
  accepted: boolean;
  rejected: boolean;
  guardStatus: ActionGuardStatus;
  matchedRules: string[];
  suggestedRewrite: { method: string; intent: string; strategy?: string } | null;
  reason: string;
};

export type EchoView = {
  roleId?: string;
  roleName?: string;
  personalEcho: string;
  otherEcho: string;
  worldEcho: string;
};

export type CrossImpactView = {
  sourceRoleId?: string;
  sourceRoleName?: string;
  targetRoleId?: string;
  targetRoleName?: string;
  impactType: "clue_change" | "relation_shift" | "risk" | "opportunity" | "delayed_effect";
  title: string;
  description: string;
  visibility: "public" | "source_private" | "target_private" | "hidden";
};

export type PovSectionView = {
  roleId?: string;
  roleName: string;
  title: string;
  content: string;
};

export type PersonalStoryCardView = {
  roleId?: string;
  roleName: string;
  title: string;
  hook: string;
  highlight: string;
  unresolvedQuestion: string;
};

export {
  directorTaskMeta,
  generateChapterWithDirector,
  resolveNodeWithDirector,
  type DirectorChapterInput,
  type DirectorChapterOutput,
  type DirectorNodeInput,
  type DirectorNodeOutput,
  type DirectorProviderMeta,
  type DirectorProviderName,
  type DirectorUsage
} from "./director-provider";

export function derivePersonalHook(role: {
  roleKey?: string;
  roleName?: string;
  publicInfo?: string;
  personalGoal?: string;
  knownInfoJson?: unknown;
  knownInfo?: unknown;
}): string {
  const knownInfo = asStringArray((role as { knownInfoJson?: unknown }).knownInfoJson ?? (role as { knownInfo?: unknown }).knownInfo);
  const firstKnown = knownInfo[0];
  const name = role.roleName || "这个角色";
  if (role.roleKey === "lin_lu") return "你在收银机里发现一枚不属于今晚账目的旧硬币。";
  if (role.roleKey === "chen_zhou") return "你接到一份没有平台记录的订单，收货人是你自己。";
  if (role.roleKey === "gu_yan") return "你找到父亲十年前留下的旧新闻，照片里出现午夜便利店。";
  return firstKnown || role.personalGoal || role.publicInfo || `${name}的选择会改变本章走向。`;
}

export function deriveDestinyQuestion(role: { roleKey?: string; personalGoal?: string; roleName?: string }): string {
  if (role.roleKey === "lin_lu") return "你到底是被困者，还是下一任守夜人？";
  if (role.roleKey === "chen_zhou") return "这份订单是让你送货，还是让你替别人留下？";
  if (role.roleKey === "gu_yan") return "你是在调查旧案，还是在重走亲人失踪前的路？";
  return role.personalGoal ? `${role.personalGoal}，你愿意为此付出什么代价？` : "你的命运线会把所有人带向哪里？";
}

export function derivePrivateClues(role: { hiddenSecret?: string | null; knownInfoJson?: unknown; knownInfo?: unknown }): string[] {
  return [role.hiddenSecret, ...asStringArray(role.knownInfoJson ?? role.knownInfo)].filter(Boolean) as string[];
}

export function enrichFateLine<T extends Record<string, unknown>>(role: T): T & FateLineView {
  return {
    ...role,
    personalHook: typeof role.personalHook === "string" ? role.personalHook : derivePersonalHook(role),
    destinyQuestion: typeof role.destinyQuestion === "string" ? role.destinyQuestion : deriveDestinyQuestion(role),
    privateClues: Array.isArray(role.privateClues) ? (role.privateClues as string[]) : derivePrivateClues(role)
  };
}

export function buildEchoes(actions: Array<{ roleId?: string; roleName?: string; method?: string }>, summary: string): EchoView[] {
  return actions.map((action) => ({
    roleId: action.roleId,
    roleName: action.roleName,
    personalEcho: `${action.roleName || "角色"}的行动让自己的命运问题更接近答案。`,
    otherEcho: `${action.roleName || "角色"}的选择改变了其他人的判断与信任。`,
    worldEcho: summary || "世界状态记录了这次选择的后果。"
  }));
}

export function buildCrossImpacts(actions: Array<{ roleId?: string; roleName?: string }>, summary: string): CrossImpactView[] {
  if (actions.length === 0) return [];
  return actions.map((action, index) => {
    const target = actions[(index + 1) % actions.length];
    return {
      sourceRoleId: action.roleId,
      sourceRoleName: action.roleName,
      targetRoleId: target?.roleId,
      targetRoleName: target?.roleName,
      impactType: index % 2 === 0 ? "clue_change" : "relation_shift",
      visibility: "public",
      title: `${action.roleName || "某个角色"}影响了${target?.roleName || "局势"}`,
      description: summary || "一次行动让线索、关系或危险等级发生变化。"
    };
  });
}

export function buildPovSections(
  roles: Array<{ id?: string; roleName?: string; personalGoal?: string }>,
  content: string
): PovSectionView[] {
  const fallback = content || "本章尚未生成正文。";
  return roles.map((role, index) => ({
    roleId: role.id,
    roleName: role.roleName || `角色 ${index + 1}`,
    title: `第 ${index + 1} 节：${role.roleName || "未知角色"}`,
    content: `${role.roleName || "这个角色"}沿着自己的命运线推进：${role.personalGoal || fallback.slice(0, 80)}`
  }));
}

export function buildPersonalCards(
  roles: Array<{ id?: string; roleName?: string; personalGoal?: string; roleKey?: string; knownInfoJson?: unknown; knownInfo?: unknown; publicInfo?: string }>,
  summary: string
): PersonalStoryCardView[] {
  return roles.map((role) => ({
    roleId: role.id,
    roleName: role.roleName || "未知角色",
    title: `${role.roleName || "角色"}的个人故事卡`,
    hook: derivePersonalHook(role),
    highlight: `${role.roleName || "角色"}在本章留下了关键选择：${summary || role.personalGoal || "继续调查异常"}`,
    unresolvedQuestion: deriveDestinyQuestion(role)
  }));
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.length > 0) : [];
}
