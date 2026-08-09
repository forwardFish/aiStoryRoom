import {
  fail,
  integerAtLeast,
  isRecord,
  nonEmptyString,
  onlyKeys,
  pass,
  type ValidationResult,
} from "./schema-utils";

export const ENDGAME_PRESENTATION_V1_SCHEMA = "endgame_presentation_v1" as const;

export type EndgameResultTypeV1 =
  | "SOLO_PART_END"
  | "SOLO_STORY_END"
  | "MULTIPLAYER_SHARED_END"
  | "LEGACY_ENDING";

export type EndgameVerdictV1 =
  | "WIN"
  | "COSTLY_WIN"
  | "LOSS"
  | "UNRESOLVED"
  | "UNAVAILABLE";

export type EndgameCauseDirectionV1 = "HELPED" | "HURT" | "DECISIVE";

export type EndgameCauseV1 = {
  stageIndex: number | null;
  sourceActionId: string | null;
  sourceRoleName: string | null;
  actionTitle: string;
  factText: string;
  direction: EndgameCauseDirectionV1;
};

export type EndgameRevealV1 = null | {
  title: string;
  text: string;
};

export type EndgameReplayActionTypeV1 =
  | "RESTART_SAME_STORY"
  | "CHANGE_ROLE"
  | "CONTINUE_NEXT_PART"
  | "BACK_TO_WORLDS";

export type EndgameReplayActionV1 = {
  type: EndgameReplayActionTypeV1;
  label: string;
  href: string | null;
  enabled: boolean;
  disabledReason: string | null;
};

/**
 * Shared player-visible contract only. Solo and Multiplayer deliberately keep
 * separate adjudicators and only converge on this safe presentation surface.
 */
export type EndgamePresentationV1 = {
  schemaVersion: typeof ENDGAME_PRESENTATION_V1_SCHEMA;
  resultType: EndgameResultTypeV1;
  verdict: EndgameVerdictV1;
  verdictLabel: string;
  title: string;
  verdictLine: string;
  narrative: string;
  gain: string[];
  loss: string[];
  causes: EndgameCauseV1[];
  reveal: EndgameRevealV1;
  replayHint: string;
  replayActions: EndgameReplayActionV1[];
};

const TOP_LEVEL_KEYS = [
  "schemaVersion",
  "resultType",
  "verdict",
  "verdictLabel",
  "title",
  "verdictLine",
  "narrative",
  "gain",
  "loss",
  "causes",
  "reveal",
  "replayHint",
  "replayActions",
] as const;

const RESULT_TYPES = new Set<EndgameResultTypeV1>([
  "SOLO_PART_END",
  "SOLO_STORY_END",
  "MULTIPLAYER_SHARED_END",
  "LEGACY_ENDING",
]);

const VERDICTS = new Set<EndgameVerdictV1>([
  "WIN",
  "COSTLY_WIN",
  "LOSS",
  "UNRESOLVED",
  "UNAVAILABLE",
]);

const DIRECTIONS = new Set<EndgameCauseDirectionV1>([
  "HELPED",
  "HURT",
  "DECISIVE",
]);

const REPLAY_ACTION_TYPES = new Set<EndgameReplayActionTypeV1>([
  "RESTART_SAME_STORY",
  "CHANGE_ROLE",
  "CONTINUE_NEXT_PART",
  "BACK_TO_WORLDS",
]);

export function validateEndgamePresentationV1(
  value: unknown,
): ValidationResult<EndgamePresentationV1> {
  if (!isRecord(value)) return fail(["endgame presentation must be an object"]);

  const errors = onlyKeys(value, TOP_LEVEL_KEYS);
  if (value.schemaVersion !== ENDGAME_PRESENTATION_V1_SCHEMA) {
    errors.push("invalid schemaVersion");
  }
  if (!RESULT_TYPES.has(value.resultType as EndgameResultTypeV1)) {
    errors.push("invalid resultType");
  }
  if (!VERDICTS.has(value.verdict as EndgameVerdictV1)) {
    errors.push("invalid verdict");
  }
  for (const key of ["verdictLabel", "title", "verdictLine"] as const) {
    if (!nonEmptyString(value[key])) errors.push(`${key} is required`);
  }
  if (typeof value.narrative !== "string") errors.push("narrative must be a string");
  if (!stringArray(value.gain)) errors.push("gain must be a string array");
  if (!stringArray(value.loss)) errors.push("loss must be a string array");
  if (typeof value.replayHint !== "string") errors.push("replayHint must be a string");

  validateCauses(value.causes, errors);
  validateReveal(value.reveal, errors);
  validateReplayActions(value.replayActions, errors);
  validateResultVerdictPair(value.resultType, value.verdict, errors);

  return errors.length
    ? fail(errors)
    : pass(value as EndgamePresentationV1);
}

function validateCauses(value: unknown, errors: string[]) {
  if (!Array.isArray(value)) {
    errors.push("causes must be an array");
    return;
  }
  if (value.length > 3) errors.push("causes must contain at most three items");
  for (const [index, item] of value.entries()) {
    if (!isRecord(item)) {
      errors.push(`causes[${index}] must be an object`);
      continue;
    }
    errors.push(...onlyKeys(item, [
      "stageIndex",
      "sourceActionId",
      "sourceRoleName",
      "actionTitle",
      "factText",
      "direction",
    ]).map((error) => `causes[${index}]: ${error}`));
    if (item.stageIndex !== null && !integerAtLeast(item.stageIndex, 0)) {
      errors.push(`causes[${index}].stageIndex must be null or a non-negative integer`);
    }
    if (!nullableNonEmptyString(item.sourceActionId)) {
      errors.push(`causes[${index}].sourceActionId must be null or a non-empty string`);
    }
    if (!nullableNonEmptyString(item.sourceRoleName)) {
      errors.push(`causes[${index}].sourceRoleName must be null or a non-empty string`);
    }
    if (!nonEmptyString(item.actionTitle)) {
      errors.push(`causes[${index}].actionTitle is required`);
    }
    if (!nonEmptyString(item.factText)) {
      errors.push(`causes[${index}].factText is required`);
    }
    if (!DIRECTIONS.has(item.direction as EndgameCauseDirectionV1)) {
      errors.push(`causes[${index}].direction is invalid`);
    }
  }
}

function validateReveal(value: unknown, errors: string[]) {
  if (value === null) return;
  if (!isRecord(value)) {
    errors.push("reveal must be null or an object");
    return;
  }
  errors.push(...onlyKeys(value, ["title", "text"]).map((error) => `reveal: ${error}`));
  if (!nonEmptyString(value.title)) errors.push("reveal.title is required");
  if (!nonEmptyString(value.text)) errors.push("reveal.text is required");
}

function validateReplayActions(value: unknown, errors: string[]) {
  if (!Array.isArray(value)) {
    errors.push("replayActions must be an array");
    return;
  }
  const seen = new Set<string>();
  for (const [index, item] of value.entries()) {
    if (!isRecord(item)) {
      errors.push(`replayActions[${index}] must be an object`);
      continue;
    }
    errors.push(...onlyKeys(item, [
      "type",
      "label",
      "href",
      "enabled",
      "disabledReason",
    ]).map((error) => `replayActions[${index}]: ${error}`));
    if (!REPLAY_ACTION_TYPES.has(item.type as EndgameReplayActionTypeV1)) {
      errors.push(`replayActions[${index}].type is invalid`);
    } else if (seen.has(String(item.type))) {
      errors.push(`replayActions contains duplicate type ${String(item.type)}`);
    } else {
      seen.add(String(item.type));
    }
    if (!nonEmptyString(item.label)) errors.push(`replayActions[${index}].label is required`);
    if (!nullableNonEmptyString(item.href)) {
      errors.push(`replayActions[${index}].href must be null or a non-empty string`);
    }
    if (typeof item.enabled !== "boolean") {
      errors.push(`replayActions[${index}].enabled must be boolean`);
    }
    if (!nullableNonEmptyString(item.disabledReason)) {
      errors.push(`replayActions[${index}].disabledReason must be null or a non-empty string`);
    }
    if (item.enabled === true && !nonEmptyString(item.href)) {
      errors.push(`replayActions[${index}] enabled actions require href`);
    }
    if (item.enabled === false && !nonEmptyString(item.disabledReason)) {
      errors.push(`replayActions[${index}] disabled actions require disabledReason`);
    }
  }
}

function validateResultVerdictPair(
  resultType: unknown,
  verdict: unknown,
  errors: string[],
) {
  if (resultType === "LEGACY_ENDING") {
    if (verdict !== "UNAVAILABLE") {
      errors.push("LEGACY_ENDING requires UNAVAILABLE verdict");
    }
    return;
  }
  if (verdict === "UNAVAILABLE") {
    errors.push("UNAVAILABLE verdict is reserved for LEGACY_ENDING");
  }
  if (resultType === "MULTIPLAYER_SHARED_END" && verdict === "UNRESOLVED") {
    errors.push("MULTIPLAYER_SHARED_END cannot use UNRESOLVED verdict");
  }
}

function nullableNonEmptyString(value: unknown): value is string | null {
  return value === null || nonEmptyString(value);
}

function stringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(nonEmptyString);
}
