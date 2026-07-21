import {
  GAME_PROJECTION_V2_SCHEMA_VERSION,
  type DecisionCandidateV2,
  type GameProjectionV2,
  type IntentTargetTypeV2,
  type StoryTimelineEntryV2
} from "@ai-story/shared";
import { gamePageProjection } from "../game-page-projection";
import type { CreditControlProjection } from "@ai-story/shared";

type JsonRecord = Record<string, unknown>;

export type SoloProjectionSource = {
  run: any;
  player: any;
  role: any;
  control: any | null;
  thread: any | null;
  turn: any | null;
  decisionSet: any | null;
  narratives: any[];
  facts: any[];
  assets: any[];
  roles: any[];
  latestAttempt?: any | null;
  creditControl: CreditControlProjection;
};

export function buildSoloStoryProjection(source: SoloProjectionSource): GameProjectionV2 {
  const { run, player, role, control, thread, turn, decisionSet } = source;
  const world = gamePageProjection(run.templateKey);
  const timeline = source.narratives
    .map(toTimelineEntry)
    .filter((entry): entry is StoryTimelineEntryV2 => Boolean(entry))
    .sort((left, right) => left.worldSequence - right.worldSequence || left.createdAt.localeCompare(right.createdAt));
  const visibleFactKeys = new Set(readStringArray(turn?.visibleFactKeysJson));
  const visibleFacts = source.facts
    .filter((fact) => visibleFactKeys.has(fact.factKey))
    .map((fact) => ({ factKey: String(fact.factKey), content: String(fact.content) }));
  const context = asRecord(turn?.contextJson);
  const availableTargets = readTargets(context.availableTargets);
  const decisions = readDecisions(decisionSet?.candidatesJson);
  const completed = run.status === "chapter_generated" || thread?.status === "COMPLETED";
  const canHumanAct = !completed && ["HUMAN_ACTIVE", "HUMAN_OFFLINE_GRACE"].includes(String(control?.mode || "HUMAN_ACTIVE"));
  const currentTurn = turn ? {
    id: String(turn.id),
    revision: Number(turn.revision || 1),
    stageIndex: Number(turn.stageIndex || 1),
    turnIndex: Number(turn.turnIndex || 1),
    baseWorldSequence: Number(turn.baseWorldSequence || 0),
    status: normalizeTurnStatus(turn.status),
    title: String(turn.situationTitle || "眼前的局势"),
    narrative: String(turn.situationNarrative || ""),
    visibleFacts,
    framing: String(decisionSet?.framing || context.framing || "在这个情境里，你准备怎么做？"),
    decisions,
    availableTargets,
    customActionAllowed: true
  } satisfies GameProjectionV2["currentTurn"] : null;

  return {
    schemaVersion: GAME_PROJECTION_V2_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    worldSequence: Number(run.worldSequence || 0),
    room: {
      id: String(run.id),
      title: String(run.title),
      worldId: String(run.templateKey),
      status: String(run.status),
      mode: "solo",
      ownerUserId: String(run.ownerUserId)
    },
    world,
    player: {
      userId: String(player.userId),
      roleId: String(role.id),
      roleKey: String(role.roleKey),
      roleName: String(role.roleName),
      identity: String(role.identity),
      personalGoal: String(role.personalGoal)
    },
    control: {
      mode: String(control?.mode || "HUMAN_ACTIVE"),
      epoch: Number(control?.epoch || 1),
      canHumanAct
    },
    currentTurn,
    timeline,
    otherActors: source.roles.map((other) => ({
      roleId: String(other.id),
      roleName: String(other.roleName),
      controllerKind: other.id === role.id && canHumanAct ? "HUMAN" as const : "AI" as const,
      stageIndex: other.id === role.id ? Number(thread?.currentStageIndex || 1) : Number(run.currentDay || 1)
    })),
    visibleAssets: source.assets.map((asset) => ({
      assetKey: String(asset.assetKey),
      kind: String(asset.kind),
      label: String(asRecord(asset.stateJson).label || asset.assetKey),
      quantity: Number(asset.quantity || 0),
      status: String(asset.status)
    })),
    evidenceHoldings: source.assets
      .filter((asset) => ["EVIDENCE", "MATERIAL", "DOCUMENT"].includes(String(asset.kind).toUpperCase()))
      .map((asset) => ({
        assetKey: String(asset.assetKey),
        kind: String(asset.kind),
        label: String(asRecord(asset.stateJson).label || asset.assetKey),
        quantity: Number(asset.quantity || 0),
        status: String(asset.status)
      })),
    commitments: [],
    armedConditions: [],
    pendingInteractions: [],
    observableTraces: timeline
      .filter((entry) => entry.kind === "OBSERVABLE_TRACE")
      .map((entry) => ({ id: entry.id, content: entry.content, worldSequence: entry.worldSequence, createdAt: entry.createdAt })),
    access: {
      state: "GRANTED",
      requiresUnlock: false,
      requiredCredits: 0,
      canCurrentUserUnlock: false,
      unlockEndpoint: null
    },
    creditControl: source.creditControl,
    completed,
    resultUrl: completed ? `/game/result?runId=${encodeURIComponent(run.id)}` : null
  };
}

function toTimelineEntry(entry: any): StoryTimelineEntryV2 | null {
  const kind = normalizeEntryType(entry.entryType);
  if (!kind) return null;
  const metadata = asRecord(readJson(entry.sourceEventIdsJson));
  return {
    id: String(entry.id),
    kind,
    title: String(metadata.title || titleForEntry(kind)),
    content: String(entry.content || ""),
    worldSequence: Number(entry.worldSequence || 0),
    createdAt: new Date(entry.createdAt).toISOString(),
    ...(metadata.decisionForm ? { decisionForm: String(metadata.decisionForm) as StoryTimelineEntryV2["decisionForm"] } : {})
  };
}

function normalizeEntryType(value: unknown): StoryTimelineEntryV2["kind"] | null {
  const normalized = String(value || "").toUpperCase();
  return ["OPENING", "RESULT", "CROSS_IMPACT", "OBSERVABLE_TRACE", "NEXT_SITUATION", "ENDING"].includes(normalized)
    ? normalized as StoryTimelineEntryV2["kind"]
    : null;
}

function titleForEntry(kind: StoryTimelineEntryV2["kind"]) {
  return ({
    OPENING: "故事开始",
    RESULT: "你的行动之后",
    CROSS_IMPACT: "他人的行动影响了你",
    OBSERVABLE_TRACE: "你看见的痕迹",
    NEXT_SITUATION: "新的局势",
    ENDING: "你的结局"
  })[kind];
}

function normalizeTurnStatus(value: unknown): "OPEN" | "RESOLVING" | "RESOLVED" | "COMPLETED" {
  const normalized = String(value || "OPEN").toUpperCase();
  if (normalized === "RESOLVING") return "RESOLVING";
  if (normalized === "RESOLVED") return "RESOLVED";
  if (normalized === "COMPLETED") return "COMPLETED";
  return "OPEN";
}

function readDecisions(value: unknown): DecisionCandidateV2[] {
  return Array.isArray(value) ? value as DecisionCandidateV2[] : [];
}

function readTargets(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item) => item && typeof item === "object")
    .map((item: any) => ({ type: String(item.type) as IntentTargetTypeV2, id: String(item.id), label: String(item.label) }));
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String) : [];
}

function readJson(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try { return JSON.parse(value); } catch { return {}; }
}

function asRecord(value: unknown): JsonRecord {
  const parsed = readJson(value);
  return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as JsonRecord : {};
}
