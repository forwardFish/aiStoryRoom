import type { EndgameCauseDirectionV1, EndgamePresentationV1 } from "@ai-story/shared";
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
    role: null | {
      roleKey: string;
      roleName: string;
      personalGoal: string;
    };
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

const ENDING_DIRECTION: Readonly<Record<string, Exclude<EndgameCauseDirectionV1, "DECISIVE">>> = Object.freeze({
  guarded_people_bore_responsibility: "HELPED",
  guarded_people_preserved_evidence: "HELPED",
  evidence_entered_capital: "HELPED",
  executed_policy_lost_people: "HURT",
  crisis_unresolved: "HURT",
});

export function isRawOpenNovelResult(value: unknown): value is RawOpenNovelResult {
  const root = record(value);
  const room = record(root?.room);
  const ending = record(root?.ending);
  return Boolean(
    room?.id
    && ending?.schemaVersion === "openovel_ending_v1"
    && typeof ending.endingKey === "string",
  );
}

export function compileOpenNovelResultV2(input: {
  raw: RawOpenNovelResult;
  run: SoloResultRunRecord;
  viewerUserId: string;
  actions: SoloResultActionRecord[];
  supportedRoleKeys?: string[];
  nextPart?: SoloReplayCapabilities["nextPart"];
}): OpenNovelResultV2 {
  if (input.raw.room.id !== input.run.id) throw new Error("SOLO_RESULT_RUN_MISMATCH");
  const membership = input.run.players.find((player) => player.userId === input.viewerUserId);
  if (input.run.ownerUserId !== input.viewerUserId || !membership?.role) {
    throw new Error("SOLO_RESULT_VIEWER_FORBIDDEN");
  }
  const replay: SoloReplayCapabilities = {
    worldId: input.run.templateKey,
    currentRoleKey: membership.role.roleKey,
    supportedRoleKeys: input.supportedRoleKeys?.length
      ? [...new Set(input.supportedRoleKeys)]
      : [membership.role.roleKey],
    nextPart: input.nextPart || null,
  };
  const evidence = extractCommittedSoloEndingEvidence({
    actions: input.actions,
    viewerUserId: input.viewerUserId,
    roleName: membership.role.roleName,
    endingKey: input.raw.ending.endingKey,
  });
  return {
    ...input.raw,
    schemaVersion: "openovel_result_v2",
    presentation: toSoloEndgamePresentation({
      ending: input.raw.ending,
      evidence,
      revealCandidates: [],
      replay,
    }),
  };
}

export function compileLegacyOpenNovelResult(input: {
  run: SoloResultRunRecord;
  viewerUserId: string;
  completedNodes: number;
  ending?: SoloEndingSource | null;
}): {
  schemaVersion: "openovel_result_v2";
  room: { id: string; worldId: string; completedAt: string };
  player: { roleKey: string; roleName: string; personalGoal: string };
  ending: SoloEndingSource | null;
  completedNodes: number;
  presentation: EndgamePresentationV1;
} {
  const membership = input.run.players.find((player) => player.userId === input.viewerUserId);
  if (input.run.ownerUserId !== input.viewerUserId || !membership?.role) {
    throw new Error("SOLO_RESULT_VIEWER_FORBIDDEN");
  }
  const replay: SoloReplayCapabilities = {
    worldId: input.run.templateKey,
    currentRoleKey: membership.role.roleKey,
    supportedRoleKeys: [membership.role.roleKey],
    nextPart: null,
  };
  return {
    schemaVersion: "openovel_result_v2",
    room: {
      id: input.run.id,
      worldId: input.run.templateKey,
      completedAt: iso(input.run.updatedAt),
    },
    player: {
      roleKey: membership.role.roleKey,
      roleName: membership.role.roleName,
      personalGoal: membership.role.personalGoal,
    },
    ending: input.ending || null,
    completedNodes: input.completedNodes,
    presentation: legacySoloEndgamePresentation({
      ending: input.ending || null,
      replay,
    }),
  };
}

export function extractCommittedSoloEndingEvidence(input: {
  actions: readonly SoloResultActionRecord[];
  viewerUserId: string;
  roleName: string;
  endingKey: string;
}): SoloEndingEvidenceCandidate[] {
  const direction = ENDING_DIRECTION[input.endingKey] || "HURT";
  const rows = input.actions
    .filter((action) => (
      action.userId === input.viewerUserId
      && action.status === "resolved"
      && action.runId.length > 0
    ))
    .map((action) => evidenceRow(action, input.roleName, direction))
    .filter((row): row is NonNullable<ReturnType<typeof evidenceRow>> => Boolean(row))
    .sort((left, right) => (
      Number(right.stageIndex || 0) - Number(left.stageIndex || 0)
      || String(left.sourceActionId).localeCompare(String(right.sourceActionId))
    ));
  if (rows.length) rows[0] = { ...rows[0], direction: "DECISIVE" };
  return rows;
}

function evidenceRow(
  action: SoloResultActionRecord,
  roleName: string,
  direction: Exclude<EndgameCauseDirectionV1, "DECISIVE">,
): SoloEndingEvidenceCandidate | null {
  const result = record(action.resolvedJson);
  const causalDelta = record(result?.causalDelta);
  if (!result || !causalDelta) return null;
  const factText = firstNonEmpty([
    ...strings(causalDelta.requiredNarrativeFacts),
    ...hintTexts(causalDelta.durableHints),
    ...strings(record(causalDelta.scenePacket)?.visibleFacts),
  ]);
  if (!factText) return null;
  const immediate = record(action.immediateJson);
  const boundOption = record(immediate?.boundOption);
  const actionTitle = firstNonEmpty([
    typeof boundOption?.label === "string" ? boundOption.label : "",
    typeof causalDelta.readerAction === "string" ? causalDelta.readerAction : "",
    action.method,
  ]);
  if (!actionTitle) return null;
  const turnNumber = positiveInteger(result.turnNumber)
    || turnNumberFromId(result.turnId)
    || null;
  return {
    authority: "PLAYER_ACTION",
    committed: true,
    authorized: true,
    stageIndex: turnNumber,
    sourceActionId: action.id,
    sourceRoleName: roleName,
    actionTitle,
    factText,
    direction,
  };
}

function hintTexts(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const hint = record(item);
    if (!hint) return [];
    return [hint.note, hint.surfaceAnchor, typeof hint.value === "string" ? hint.value : ""]
      .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0);
  });
}

function turnNumberFromId(value: unknown) {
  const match = /^T(\d+)$/.exec(String(value || ""));
  return match ? positiveInteger(Number(match[1])) : null;
}

function positiveInteger(value: unknown): number | null {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
}

function firstNonEmpty(values: readonly string[]) {
  return values.map((value) => value.trim()).find(Boolean) || "";
}

function record(value: unknown): Record<string, any> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, any>
    : null;
}

function iso(value: Date | string) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? new Date(0).toISOString() : date.toISOString();
}
