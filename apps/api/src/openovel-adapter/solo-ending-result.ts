import {
  validateEndgamePresentationV1,
  type EndgameCauseDirectionV1,
  type EndgamePresentationV1,
} from "@ai-story/shared";
import {
  legacySoloEndgamePresentation,
  toSoloEndgamePresentation,
  type SoloEndingEvidenceAuthority,
  type SoloEndingEvidenceCandidate,
  type SoloEndingRevealCandidate,
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
  status?: string;
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

type EvidenceVisibility = "PUBLIC" | "PLAYER";
type EvidenceCause = {
  sourceTurnId: string;
  sourceRevision: number;
  sourceEventId: string;
  authority: SoloEndingEvidenceAuthority;
  visibility: EvidenceVisibility;
  criterion: string;
  actionTitle: string | null;
  factText: string;
  direction: EndgameCauseDirectionV1;
};
type EvidenceReveal = {
  sourceTurnId: string;
  sourceRevision: number;
  sourceEventId: string;
  authority: SoloEndingEvidenceAuthority;
  visibility: EvidenceVisibility;
  title: string;
  text: string;
};
type EvidenceEnvelope = {
  schemaVersion: "openovel_player_ending_evidence_v1";
  endingKey: string;
  scope: "STORY" | "PART";
  sourceTurnId: string;
  sourceRevision: number;
  causes: EvidenceCause[];
  reveal: EvidenceReveal | null;
};

const AUTHORITIES = new Set<SoloEndingEvidenceAuthority>([
  "PLAYER_ACTION",
  "PREDICATE",
  "CAUSAL_EVENT",
  "DELAYED_EVENT",
  "PLAYER_CANON",
]);
const DIRECTIONS = new Set<EndgameCauseDirectionV1>(["HELPED", "HURT", "DECISIVE"]);
const VISIBILITIES = new Set<EvidenceVisibility>(["PUBLIC", "PLAYER"]);

export class SoloResultNotReadyError extends Error {
  readonly code = "SOLO_RESULT_NOT_READY";
  constructor(readonly reason: string) {
    super(`SOLO_RESULT_NOT_READY:${reason}`);
  }
}

export function isSoloResultNotReadyError(error: unknown): error is SoloResultNotReadyError {
  return error instanceof SoloResultNotReadyError
    || Boolean(error && typeof error === "object" && "code" in error
      && (error as { code?: unknown }).code === "SOLO_RESULT_NOT_READY");
}

export function isRawOpenNovelResult(value: unknown): value is RawOpenNovelResult {
  const root = record(value);
  const room = record(root?.room);
  const ending = record(root?.ending);
  return Boolean(room?.id
    && ending?.schemaVersion === "openovel_ending_v1"
    && typeof ending.endingKey === "string");
}

export function compileOpenNovelResultV2(input: {
  raw: RawOpenNovelResult;
  authoritativeEnding?: SoloEndingSource;
  run: SoloResultRunRecord;
  viewerUserId: string;
  actions: SoloResultActionRecord[];
  supportedRoleKeys?: string[];
  nextPart?: SoloReplayCapabilities["nextPart"];
}): OpenNovelResultV2 {
  const role = membership(input.run, input.viewerUserId);
  if (input.raw.room.id !== input.run.id) throw new Error("SOLO_RESULT_RUN_MISMATCH");
  const authoritativeEnding = input.authoritativeEnding || input.raw.ending;
  assertEndingIdentity(input.raw.ending, authoritativeEnding);
  assertEndingReady(input.run, authoritativeEnding, input.raw.completedNodes);

  const evidence = extractCommittedSoloEndingEvidence({
    actions: input.actions,
    runId: input.run.id,
    viewerUserId: input.viewerUserId,
    roleName: role.roleName,
    ending: authoritativeEnding,
  });
  const presentation = toSoloEndgamePresentation({
    ending: publicEnding(authoritativeEnding),
    evidence,
    revealCandidates: extractAuthorizedSoloEndingReveal({
      actions: input.actions,
      runId: input.run.id,
      viewerUserId: input.viewerUserId,
      ending: authoritativeEnding,
    }),
    replay: replay(input.run, role.roleKey, input.supportedRoleKeys, input.nextPart),
  });
  if (presentation.resultType !== "LEGACY_ENDING" && presentation.causes.length === 0) {
    throw new SoloResultNotReadyError("AUTHORITATIVE_CAUSES_MISSING");
  }
  assertPresentation(presentation);
  return {
    ...input.raw,
    ending: publicEnding(authoritativeEnding),
    schemaVersion: "openovel_result_v2",
    presentation,
  };
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
    player: {
      roleKey: role.roleKey,
      roleName: role.roleName,
      personalGoal: role.personalGoal,
    },
    ending: input.ending || null,
    completedNodes: input.completedNodes,
    presentation,
  };
}

/**
 * Only the server-produced final Ending envelope is accepted. Narrative text,
 * causalDelta, durableHints and visibleFacts are never interpreted as causes.
 */
export function extractCommittedSoloEndingEvidence(input: {
  actions: readonly SoloResultActionRecord[];
  runId: string;
  viewerUserId: string;
  roleName: string;
  ending: SoloEndingSource;
}): SoloEndingEvidenceCandidate[] {
  const envelope = endingEvidence(input.ending);
  if (!envelope) return [];
  const actionByTurn = uniqueCommittedActionByTurn(
    input.actions,
    input.runId,
    input.viewerUserId,
  );
  const usedActions = new Set<string>();
  const output: SoloEndingEvidenceCandidate[] = [];
  for (const cause of envelope.causes) {
    const action = actionByTurn.get(turnKey(cause.sourceTurnId, cause.sourceRevision));
    if (!action || usedActions.has(action.id)) continue;
    const actionTitle = playerActionTitle(action);
    if (!actionTitle) continue;
    usedActions.add(action.id);
    output.push({
      authority: cause.authority,
      committed: true,
      authorized: true,
      stageIndex: cause.sourceRevision,
      sourceActionId: action.id,
      sourceRoleName: input.roleName,
      actionTitle,
      factText: cause.factText,
      direction: cause.direction,
    });
    if (output.length === 3) break;
  }
  return output;
}

export function extractAuthorizedSoloEndingReveal(input: {
  actions: readonly SoloResultActionRecord[];
  runId: string;
  viewerUserId: string;
  ending: SoloEndingSource;
}): SoloEndingRevealCandidate[] {
  const reveal = endingEvidence(input.ending)?.reveal;
  if (!reveal) return [];
  const action = uniqueCommittedActionByTurn(
    input.actions,
    input.runId,
    input.viewerUserId,
  ).get(turnKey(reveal.sourceTurnId, reveal.sourceRevision));
  if (!action) return [];
  return [{
    committed: true,
    authorized: true,
    visibility: reveal.visibility,
    title: reveal.title,
    text: reveal.text,
  }];
}

function endingEvidence(ending: SoloEndingSource): EvidenceEnvelope | null {
  const root = record((ending as SoloEndingSource & { playerEvidence?: unknown }).playerEvidence);
  if (!root || root.schemaVersion !== "openovel_player_ending_evidence_v1") return null;
  if (root.endingKey !== ending.endingKey
    || root.scope !== ending.scope
    || root.sourceTurnId !== ending.sourceTurnId
    || root.sourceRevision !== ending.sourceRevision
    || !Array.isArray(root.causes)
    || root.causes.length > 3) return null;
  const causes = root.causes.map(parseCause);
  if (causes.some((cause) => cause === null)) return null;
  const reveal = root.reveal === null ? null : parseReveal(root.reveal);
  return {
    schemaVersion: "openovel_player_ending_evidence_v1",
    endingKey: ending.endingKey,
    scope: ending.scope,
    sourceTurnId: ending.sourceTurnId,
    sourceRevision: ending.sourceRevision,
    causes: causes as EvidenceCause[],
    reveal,
  };
}

function parseCause(value: unknown): EvidenceCause | null {
  const row = record(value);
  if (!row) return null;
  const sourceTurnId = text(row.sourceTurnId);
  const sourceRevision = positiveInteger(row.sourceRevision);
  const sourceEventId = text(row.sourceEventId);
  const authority = text(row.authority) as SoloEndingEvidenceAuthority;
  const visibility = text(row.visibility) as EvidenceVisibility;
  const criterion = text(row.criterion);
  const actionTitle = text(row.actionTitle) || null;
  const factText = text(row.factText);
  const direction = text(row.direction) as EndgameCauseDirectionV1;
  if (!sourceTurnId
    || !sourceRevision
    || turnNumber(sourceTurnId) !== sourceRevision
    || !sourceEventId
    || !AUTHORITIES.has(authority)
    || !VISIBILITIES.has(visibility)
    || !/^[A-Z][A-Z0-9_]{2,80}$/.test(criterion)
    || !factText
    || !DIRECTIONS.has(direction)) return null;
  return {
    sourceTurnId,
    sourceRevision,
    sourceEventId,
    authority,
    visibility,
    criterion,
    actionTitle,
    factText,
    direction,
  };
}

function parseReveal(value: unknown): EvidenceReveal | null {
  const row = record(value);
  if (!row) return null;
  const sourceTurnId = text(row.sourceTurnId);
  const sourceRevision = positiveInteger(row.sourceRevision);
  const sourceEventId = text(row.sourceEventId);
  const authority = text(row.authority) as SoloEndingEvidenceAuthority;
  const visibility = text(row.visibility) as EvidenceVisibility;
  const title = text(row.title);
  const body = text(row.text);
  if (!sourceTurnId
    || !sourceRevision
    || turnNumber(sourceTurnId) !== sourceRevision
    || !sourceEventId
    || !AUTHORITIES.has(authority)
    || !VISIBILITIES.has(visibility)
    || !title
    || !body) return null;
  return {
    sourceTurnId,
    sourceRevision,
    sourceEventId,
    authority,
    visibility,
    title,
    text: body,
  };
}

function uniqueCommittedActionByTurn(
  actions: readonly SoloResultActionRecord[],
  runId: string,
  viewerUserId: string,
) {
  const candidates = new Map<string, SoloResultActionRecord[]>();
  for (const action of actions) {
    if (action.runId !== runId
      || action.userId !== viewerUserId
      || action.status !== "resolved") continue;
    const result = record(action.resolvedJson);
    const sourceTurnId = text(result?.turnId);
    const sourceRevision = positiveInteger(result?.turnNumber);
    if (!sourceTurnId
      || !sourceRevision
      || turnNumber(sourceTurnId) !== sourceRevision) continue;
    const key = turnKey(sourceTurnId, sourceRevision);
    candidates.set(key, [...(candidates.get(key) || []), action]);
  }
  const unique = new Map<string, SoloResultActionRecord>();
  for (const [key, rows] of candidates) {
    if (rows.length === 1) unique.set(key, rows[0]!);
  }
  return unique;
}

function playerActionTitle(action: SoloResultActionRecord) {
  const bound = record(record(action.immediateJson)?.boundOption);
  return firstText([
    typeof bound?.label === "string" ? bound.label : "",
    action.method,
  ]);
}

function assertEndingReady(
  run: SoloResultRunRecord,
  ending: SoloEndingSource,
  completedNodes: number | undefined,
) {
  if (!new Set(["PART", "STORY"]).has(ending.scope)) {
    throw new SoloResultNotReadyError("ENDING_SCOPE_INVALID");
  }
  if (run.templateKey === "sangtian"
    && (ending.scope !== "PART"
      || ending.sourceTurnId !== "T20"
      || ending.sourceRevision !== 20
      || completedNodes !== 20)) {
    throw new SoloResultNotReadyError("SANGTIAN_FINAL_REVISION_INVALID");
  }
}

function assertEndingIdentity(
  returned: SoloEndingSource,
  authoritative: SoloEndingSource,
) {
  if (returned.schemaVersion !== authoritative.schemaVersion
    || returned.endingKey !== authoritative.endingKey
    || returned.scope !== authoritative.scope
    || returned.sourceTurnId !== authoritative.sourceTurnId
    || returned.sourceRevision !== authoritative.sourceRevision
    || returned.title !== authoritative.title
    || returned.finalSceneNarrative !== authoritative.finalSceneNarrative
    || returned.protagonistFate !== authoritative.protagonistFate
    || JSON.stringify(returned.aftermath) !== JSON.stringify(authoritative.aftermath)) {
    throw new SoloResultNotReadyError("ENDING_IDENTITY_MISMATCH");
  }
}

function publicEnding(ending: SoloEndingSource): SoloEndingSource {
  const { playerEvidence: _private, ...visible } = ending as SoloEndingSource & {
    playerEvidence?: unknown;
  };
  return visible;
}

/** Remove the private evidence envelope from owner-facing OpenNovel APIs. */
export function stripPrivateSoloEndingEvidence(value: unknown): unknown {
  const root = record(value);
  const ending = record(root?.ending);
  if (!root || !ending || !("playerEvidence" in ending)) return value;
  const { playerEvidence: _private, ...visibleEnding } = ending;
  return { ...root, ending: visibleEnding };
}

export function stripPrivateSoloEndingEvidenceFromEvent<
  T extends { type?: string; data?: unknown },
>(event: T): T {
  if (event?.type !== "turn.committed") return event;
  return { ...event, data: stripPrivateSoloEndingEvidence(event.data) };
}

function membership(run: SoloResultRunRecord, viewerUserId: string) {
  const role = run.players.find((player) => player.userId === viewerUserId)?.role;
  if (run.ownerUserId !== viewerUserId || !role) {
    throw new Error("SOLO_RESULT_VIEWER_FORBIDDEN");
  }
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
    supportedRoleKeys: supportedRoleKeys?.length
      ? [...new Set(supportedRoleKeys)]
      : [roleKey],
    nextPart: nextPart || null,
  };
}

function assertPresentation(value: EndgamePresentationV1) {
  const validation = validateEndgamePresentationV1(value);
  if (!validation.ok) {
    throw new Error(`SOLO_ENDGAME_PRESENTATION_INVALID:${validation.errors.join("|")}`);
  }
}

function turnKey(turnId: string, revision: number) {
  return `${turnId}\u0000${revision}`;
}
function turnNumber(value: unknown) {
  const match = /^T(\d+)$/.exec(String(value || ""));
  return match ? positiveInteger(match[1]) : null;
}
function positiveInteger(value: unknown): number | null {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}
function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}
function firstText(values: readonly string[]) {
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
