import {
  validateEndgamePresentationV1,
  type EndgamePresentationV1,
} from "@ai-story/shared";
import {
  legacySoloEndgamePresentation,
  toSoloEndgamePresentation,
  type SoloEndingEvidenceCandidate,
  type SoloEndingSource,
  type SoloReplayCapabilities,
} from "./solo-ending-presentation";

export type SoloResultActionRecord = {
  id: string;
  runId: string;
  userId: string | null;
  status: string;
  method: string;
  immediateJson: unknown;
  resolvedJson: unknown;
  resolvedAt: Date | string | null;
  createdAt: Date | string;
};

export type SoloResultRunRecord = {
  id: string;
  ownerUserId: string;
  templateKey: string;
  engineVersion: string;
  selectedRoleKey: string | null;
  updatedAt: Date | string;
  players: Array<{
    userId: string | null;
    role: null | { roleKey: string; roleName: string; personalGoal: string };
  }>;
};

export type RawOpenNovelResult = {
  room: { id: string; title?: string; worldId?: string; completedAt?: unknown };
  player?: null | {
    roleName?: string;
    personalGoal?: string;
    endingTitle?: string;
    protagonistFate?: string;
  };
  ending: SoloEndingSource;
  completedNodes?: number;
  [key: string]: unknown;
};

export type OpenNovelResultV2 = RawOpenNovelResult & {
  schemaVersion: "openovel_result_v2";
  presentation: EndgamePresentationV1;
};

type RankedEvidence = SoloEndingEvidenceCandidate & { score: number };

export function isRawOpenNovelResult(value: unknown): value is RawOpenNovelResult {
  const root = object(value);
  const room = object(root?.room);
  const ending = object(root?.ending);
  return Boolean(room?.id
    && ending?.schemaVersion === "openovel_ending_v1"
    && typeof ending.endingKey === "string");
}

export function compileOpenNovelResultV2(input: {
  raw: RawOpenNovelResult;
  run: SoloResultRunRecord;
  viewerUserId: string;
  actions: SoloResultActionRecord[];
  supportedRoleKeys?: string[];
  nextPart?: SoloReplayCapabilities["nextPart"];
}): OpenNovelResultV2 {
  const role = membership(input.run, input.viewerUserId);
  if (input.raw.room.id !== input.run.id) throw new Error("SOLO_RESULT_RUN_MISMATCH");
  const presentation = toSoloEndgamePresentation({
    ending: input.raw.ending,
    evidence: extractCommittedSoloEndingEvidence({
      actions: input.actions,
      runId: input.run.id,
      viewerUserId: input.viewerUserId,
      roleName: role.roleName,
    }),
    revealCandidates: aftermathReveal(input.raw.ending),
    replay: replay(input.run, role.roleKey, input.supportedRoleKeys, input.nextPart),
  });
  assertPresentation(presentation);
  return { ...input.raw, schemaVersion: "openovel_result_v2", presentation };
}

export function compileLegacyOpenNovelResult(input: {
  run: SoloResultRunRecord;
  viewerUserId: string;
  completedNodes: number;
  ending?: SoloEndingSource | null;
  supportedRoleKeys?: string[];
}) {
  const role = membership(input.run, input.viewerUserId);
  const presentation = legacySoloEndgamePresentation({
    ending: input.ending || null,
    replay: replay(input.run, role.roleKey, input.supportedRoleKeys, null),
  });
  assertPresentation(presentation);
  return {
    schemaVersion: "openovel_result_v2" as const,
    room: {
      id: input.run.id,
      worldId: input.run.templateKey,
      completedAt: iso(input.run.updatedAt),
    },
    player: { roleKey: role.roleKey, roleName: role.roleName, personalGoal: role.personalGoal },
    ending: input.ending || null,
    completedNodes: input.completedNodes,
    presentation,
  };
}

/** Production SSE removes private causalDelta. A resolved PlayerAction is still
 * an allowed authoritative cause; generated narration is never parsed. */
export function extractCommittedSoloEndingEvidence(input: {
  actions: readonly SoloResultActionRecord[];
  runId: string;
  viewerUserId: string;
  roleName: string;
}): SoloEndingEvidenceCandidate[] {
  return input.actions
    .filter((action) => action.runId === input.runId
      && action.userId === input.viewerUserId
      && action.status === "resolved")
    .map((action) => evidence(action, input.roleName))
    .filter((row): row is RankedEvidence => Boolean(row))
    .sort((a, b) => b.score - a.score
      || Number(b.stageIndex || 0) - Number(a.stageIndex || 0)
      || String(a.sourceActionId).localeCompare(String(b.sourceActionId)))
    .slice(0, 3)
    .sort((a, b) => Number(a.stageIndex || 0) - Number(b.stageIndex || 0)
      || String(a.sourceActionId).localeCompare(String(b.sourceActionId)))
    .map(({ score: _score, ...row }) => row);
}

function evidence(action: SoloResultActionRecord, roleName: string): RankedEvidence | null {
  const result = object(action.resolvedJson);
  if (!result) return null;
  const turn = positive(result.turnNumber) || turnFromId(result.turnId);
  const immediate = object(action.immediateJson);
  const bound = object(immediate?.boundOption);
  const delta = object(result.causalDelta);
  const explicit = object(result.endingEvidence);
  const explicitFacts = explicit?.schemaVersion === "openovel_player_ending_evidence_v1"
    ? strings(explicit.facts) : [];
  const required = strings(delta?.requiredNarrativeFacts);
  const durable = hints(delta?.durableHints);
  const visible = strings(object(delta?.scenePacket)?.visibleFacts);
  const actionTitle = first([
    typeof bound?.label === "string" ? bound.label : "",
    typeof delta?.readerAction === "string" ? delta.readerAction : "",
    action.method,
  ]);
  if (!actionTitle) return null;
  const factText = first([...explicitFacts, ...required, ...durable, ...visible])
    || (turn
      ? `该选择已由权威结算提交，并进入第 ${turn} 回合的最终 Canon。`
      : "该选择已由权威结算提交，并进入本局最终 Canon。");
  return {
    authority: "PLAYER_ACTION",
    committed: true,
    authorized: true,
    stageIndex: turn,
    sourceActionId: action.id,
    sourceRoleName: roleName,
    actionTitle,
    factText,
    direction: "DECISIVE",
    score: (turn === 20 ? 1_000 : 0) + Number(turn || 0)
      + explicitFacts.length * 10 + required.length * 5
      + durable.length * 3 + visible.length * 2,
  };
}

function membership(run: SoloResultRunRecord, viewerUserId: string) {
  const role = run.players.find((player) => player.userId === viewerUserId)?.role;
  if (run.ownerUserId !== viewerUserId || !role) throw new Error("SOLO_RESULT_VIEWER_FORBIDDEN");
  return role;
}

function replay(
  run: SoloResultRunRecord,
  roleKey: string,
  supportedRoleKeys?: string[],
  nextPart?: SoloReplayCapabilities["nextPart"],
): SoloReplayCapabilities {
  return {
    worldId: run.templateKey,
    currentRoleKey: roleKey,
    supportedRoleKeys: supportedRoleKeys?.length ? [...new Set(supportedRoleKeys)] : [roleKey],
    nextPart: nextPart || null,
  };
}

function aftermathReveal(ending: SoloEndingSource) {
  const text = ending.aftermath.map((item) => String(item || "").trim()).filter(Boolean).join(" ");
  return text ? [{
    committed: true,
    authorized: true,
    visibility: "PLAYER" as const,
    title: ending.scope === "PART" ? "第一部分之后" : "尾声余波",
    text,
  }] : [];
}

function assertPresentation(value: EndgamePresentationV1) {
  const validation = validateEndgamePresentationV1(value);
  if (!validation.ok) throw new Error(`SOLO_ENDGAME_PRESENTATION_INVALID:${validation.errors.join("|")}`);
}

function hints(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const hint = object(item);
    return hint ? [hint.note, hint.surfaceAnchor, typeof hint.value === "string" ? hint.value : ""]
      .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0) : [];
  });
}

function turnFromId(value: unknown) {
  const match = /^T(\d+)$/.exec(String(value || ""));
  return match ? positive(match[1]) : null;
}
function positive(value: unknown): number | null {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}
function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : [];
}
function first(values: readonly string[]) {
  return values.map((value) => value.trim()).find(Boolean) || "";
}
function object(value: unknown): Record<string, any> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, any> : null;
}
function iso(value: Date | string) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? new Date(0).toISOString() : date.toISOString();
}
