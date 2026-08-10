import type { RawOpenNovelResult, SoloResultRunRecord } from "./solo-ending-result";

export const GENERIC_ENDGAME_ARTIFACT_SCHEMA = "generic_endgame_result_artifact_v1" as const;
export const GENERIC_ENDGAME_PRESENTATION_SCHEMA = "endgame_presentation_v3" as const;

type ReplayAction = {
  type: "RESTART_SAME_STORY" | "CHANGE_ROLE" | "CONTINUE_NEXT_PART" | "BACK_TO_WORLDS";
  label: string;
  href: string | null;
  enabled: boolean;
  disabledReason: string | null;
};

export type EndgamePresentationV3 = {
  schemaVersion: typeof GENERIC_ENDGAME_PRESENTATION_SCHEMA;
  resultType: "SOLO_PART_END" | "SOLO_STORY_END" | "LEGACY_ENDING";
  world: { worldId: string; worldTitle: string };
  role: { roleId: string; roleTitle: string };
  title: string;
  axes: Array<{ axisId: string; label: string; outcomeId: string; title: string; summary: string }>;
  metrics: Array<{ metricId: string; label: string; value: number; formattedValue: string; direction: "HIGH_GOOD" | "LOW_GOOD" | "CONTEXTUAL"; initialValue: number | null }>;
  dynamicSubtitle: string;
  style: null | { styleId: string; label: string };
  narrative: string;
  sections: Array<{ sectionId: string; label: string; layout: "LIST" | "TWO_COLUMN" | "TIMELINE" | "CARDS"; items: Array<{ title: string; text: string; actorName: string | null; stageIndex: number | null }> }>;
  replayHint: string;
  endingFingerprint: string;
  replayActions: ReplayAction[];
};

export type GenericEndgameArtifactV1 = {
  schemaVersion: typeof GENERIC_ENDGAME_ARTIFACT_SCHEMA;
  sourceRevision: number;
  presentation: EndgamePresentationV3;
};

export function compileGenericOpenNovelResultV3(input: {
  raw: RawOpenNovelResult;
  run: SoloResultRunRecord;
  roleKey: string;
  artifact: unknown;
}) {
  const artifact = parseArtifact(input.artifact);
  if (artifact.sourceRevision !== input.raw.ending.sourceRevision
    || artifact.presentation.world.worldId !== input.run.templateKey
    || artifact.presentation.role.roleId !== input.roleKey
    || (input.raw.ending.scope === "PART" && artifact.presentation.resultType !== "SOLO_PART_END")
    || (input.raw.ending.scope === "STORY" && artifact.presentation.resultType !== "SOLO_STORY_END")) {
    throw new Error("GENERIC_ENDGAME_IDENTITY_MISMATCH");
  }
  return {
    ...input.raw,
    schemaVersion: "openovel_result_v3" as const,
    presentation: artifact.presentation,
  };
}

export function genericEndgameArtifactFromEnding(ending: unknown): unknown | null {
  const row = record(ending);
  return row && Object.hasOwn(row, "genericEndgame") ? row.genericEndgame : null;
}

function parseArtifact(value: unknown): GenericEndgameArtifactV1 {
  const artifact = record(value);
  if (!artifact || artifact.schemaVersion !== GENERIC_ENDGAME_ARTIFACT_SCHEMA
    || !positiveInteger(artifact.sourceRevision)) throw new Error("GENERIC_ENDGAME_ARTIFACT_INVALID");
  return {
    schemaVersion: GENERIC_ENDGAME_ARTIFACT_SCHEMA,
    sourceRevision: artifact.sourceRevision as number,
    presentation: parsePresentation(artifact.presentation),
  };
}

function parsePresentation(value: unknown): EndgamePresentationV3 {
  const row = record(value);
  if (!row || row.schemaVersion !== GENERIC_ENDGAME_PRESENTATION_SCHEMA
    || !["SOLO_PART_END", "SOLO_STORY_END", "LEGACY_ENDING"].includes(String(row.resultType))
    || !text(row.title) || typeof row.dynamicSubtitle !== "string" || typeof row.narrative !== "string"
    || typeof row.replayHint !== "string" || !/^[0-9a-f]{64}$/.test(String(row.endingFingerprint || ""))) {
    throw new Error("GENERIC_ENDGAME_PRESENTATION_INVALID");
  }
  const world = identity(row.world, "worldId", "worldTitle");
  const role = identity(row.role, "roleId", "roleTitle");
  const axes = list(row.axes, axis);
  const metrics = list(row.metrics, metric);
  const sections = list(row.sections, section);
  const replayActions = list(row.replayActions, replayAction);
  const style = row.style === null ? null : identity(row.style, "styleId", "label");
  if (!world || !role || style === undefined) throw new Error("GENERIC_ENDGAME_PRESENTATION_INVALID");
  return {
    schemaVersion: GENERIC_ENDGAME_PRESENTATION_SCHEMA,
    resultType: row.resultType as EndgamePresentationV3["resultType"],
    world: world as EndgamePresentationV3["world"],
    role: role as EndgamePresentationV3["role"],
    title: row.title as string,
    axes,
    metrics,
    dynamicSubtitle: row.dynamicSubtitle as string,
    style: style as EndgamePresentationV3["style"],
    narrative: row.narrative as string,
    sections,
    replayHint: row.replayHint as string,
    endingFingerprint: row.endingFingerprint as string,
    replayActions,
  };
}

function axis(value: unknown) { const row = record(value); return row && [row.axisId,row.label,row.outcomeId,row.title,row.summary].every(text) ? row as EndgamePresentationV3["axes"][number] : null; }
function metric(value: unknown) { const row = record(value); return row && [row.metricId,row.label,row.formattedValue].every(text) && finite(row.value) && ["HIGH_GOOD","LOW_GOOD","CONTEXTUAL"].includes(String(row.direction)) && (row.initialValue === null || finite(row.initialValue)) ? row as EndgamePresentationV3["metrics"][number] : null; }
function section(value: unknown) { const row = record(value); if (!row || !text(row.sectionId) || !text(row.label) || !["LIST","TWO_COLUMN","TIMELINE","CARDS"].includes(String(row.layout))) return null; const items = list(row.items, item); return { sectionId:row.sectionId, label:row.label, layout:row.layout, items } as EndgamePresentationV3["sections"][number]; }
function item(value: unknown) { const row = record(value); return row && text(row.title) && text(row.text) && (row.actorName === null || text(row.actorName)) && (row.stageIndex === null || nonNegativeInteger(row.stageIndex)) ? row as EndgamePresentationV3["sections"][number]["items"][number] : null; }
function replayAction(value: unknown) { const row = record(value); if (!row || !["RESTART_SAME_STORY","CHANGE_ROLE","CONTINUE_NEXT_PART","BACK_TO_WORLDS"].includes(String(row.type)) || !text(row.label) || typeof row.enabled !== "boolean") return null; const href = row.href === null ? null : safeHref(row.href); if (row.enabled && href === null) return null; return { ...row, href, disabledReason:row.disabledReason === null ? null : (text(row.disabledReason) ? row.disabledReason : null) } as ReplayAction; }
function identity(value: unknown, id: string, title: string) { const row = record(value); return row && text(row[id]) && text(row[title]) ? { [id]:row[id], [title]:row[title] } : undefined; }
function list<T>(value: unknown, parser: (value: unknown) => T | null): T[] { if (!Array.isArray(value)) throw new Error("GENERIC_ENDGAME_PRESENTATION_INVALID"); const parsed = value.map(parser); if (parsed.some((item) => item === null)) throw new Error("GENERIC_ENDGAME_PRESENTATION_INVALID"); return parsed as T[]; }
function safeHref(value: unknown) { const href = text(value) ? String(value).trim() : ""; if (!href.startsWith("/") || href.startsWith("//") || href.includes("\\") || /[\u0000-\u001f\u007f]/.test(href)) return null; try { const url = new URL(href, "https://our-many-worlds.invalid"); return url.origin === "https://our-many-worlds.invalid" ? `${url.pathname}${url.search}${url.hash}` : null; } catch { return null; } }
function record(value: unknown): Record<string, any> | null { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : null; }
function text(value: unknown): value is string { return typeof value === "string" && value.trim().length > 0; }
function finite(value: unknown): value is number { return typeof value === "number" && Number.isFinite(value); }
function positiveInteger(value: unknown): value is number { return Number.isInteger(value) && Number(value) > 0; }
function nonNegativeInteger(value: unknown): value is number { return Number.isInteger(value) && Number(value) >= 0; }
