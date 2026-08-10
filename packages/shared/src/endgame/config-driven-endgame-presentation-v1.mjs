import { canonicalizeJcs, evaluateBooleanExpression } from "./endgame-package-v1.contract.mjs";
import { resolveFrozenEndgamePackageForRunV1 } from "./endgame-package-loader-v1.mjs";
import { assertEndgameAdjudicationV3 } from "./config-driven-endgame-adjudicator-v1.mjs";
import {
  renderConfigDrivenEndingFallbackV1,
  validateNarratedEndingV1
} from "./config-driven-ending-narrator-v1.mjs";
import { formatMetricValueV1 } from "./endgame-metric-ledger-v1.mjs";
import { compareText, deepFreeze, isRecord } from "./ending-detail-common-v1.mjs";

export const ENDGAME_PRESENTATION_SCHEMA_VERSION = "endgame_presentation_v3";

const INPUT_KEYS = Object.freeze([
  "runPackageBinding",
  "adjudication",
  "blueprint",
  "narratedEnding",
  "world",
  "role",
  "state",
  "facts",
  "replayActions"
]);
const REPLAY_TYPES = new Set([
  "RESTART_SAME_STORY",
  "CHANGE_ROLE",
  "CONTINUE_NEXT_PART",
  "BACK_TO_WORLDS"
]);

export class ConfigDrivenEndgamePresentationError extends Error {
  constructor(code, message, details = {}) {
    super(`${code}: ${message}`);
    this.name = "ConfigDrivenEndgamePresentationError";
    this.code = code;
    this.details = deepFreeze(structuredClone(details));
  }
}

export function composeEndgamePresentationV3(input) {
  assertExactObject(input, INPUT_KEYS, "presentation input");
  const snapshot = resolveFrozenEndgamePackageForRunV1(input.runPackageBinding);
  assertEndgameAdjudicationV3(input.runPackageBinding, input.adjudication);
  const narratedEnding = validatedNarrative(input);
  assertBlueprint(input.blueprint, input.adjudication);
  const packageDocument = snapshot.packageDocument;
  const world = normalizeIdentity(input.world, "world", "worldId", "worldTitle");
  const role = normalizeIdentity(input.role, "role", "roleId", "roleTitle");
  if (world.worldId !== packageDocument.worldId) fail("ENDGAME_PRESENTATION_WORLD_MISMATCH", "World identity does not match the frozen package.");

  const axisById = new Map(input.blueprint.resolvedAxes.map((axis) => [axis.axisId, axis]));
  const axisDefinitionById = new Map(packageDocument.outcomeAxes.map((axis) => [axis.axisId, axis]));
  const axes = packageDocument.presentation.axisOrder.map((axisId) => {
    const axis = axisById.get(axisId);
    const definition = axisDefinitionById.get(axisId);
    if (!axis || !definition) fail("ENDGAME_PRESENTATION_AXIS_MISSING", "Configured presentation axis is missing.", { axisId });
    return {
      axisId: axis.axisId,
      label: definition.label,
      outcomeId: axis.outcomeId,
      title: axis.title,
      summary: axis.summary
    };
  });
  const metricById = new Map(packageDocument.metrics.map((metric) => [metric.metricId, metric]));
  const metrics = packageDocument.presentation.metricOrder.map((metricId) => {
    const definition = metricById.get(metricId);
    const value = input.adjudication.finalMetrics[metricId];
    if (!definition || typeof value !== "number" || !Number.isFinite(value)) {
      fail("ENDGAME_PRESENTATION_METRIC_MISSING", "Configured presentation metric is missing.", { metricId });
    }
    return {
      metricId,
      label: definition.label,
      value,
      formattedValue: formatMetricValueV1(definition, value),
      direction: definition.direction,
      initialValue: packageDocument.presentation.showInitialMetricValue ? definition.initialValue : null
    };
  });
  const sections = packageDocument.presentation.sections.map((section) => ({
    sectionId: section.sectionId,
    label: section.label,
    layout: section.layout,
    items: section.slotIds.flatMap((slotId) => {
      const items = input.blueprint.slots[slotId];
      if (!Array.isArray(items)) fail("ENDGAME_PRESENTATION_SLOT_MISSING", "Configured presentation slot is missing.", { slotId });
      return items.map((item) => ({
        title: item.title,
        text: item.text,
        actorName: null,
        stageIndex: null
      }));
    })
  }));
  const axisOutcomes = Object.fromEntries(axes.map((axis) => [axis.axisId, axis.outcomeId]));
  const ruleContext = {
    metrics: input.adjudication.finalMetrics,
    state: normalizeRecord(input.state, "state"),
    facts: normalizeFacts(input.facts),
    axisOutcomes
  };
  const replayHint = packageDocument.replay.hintTemplates.find((item) => evaluateRule(item.when, ruleContext))?.text
    ?? packageDocument.replay.fallbackHint;
  const presentation = {
    schemaVersion: ENDGAME_PRESENTATION_SCHEMA_VERSION,
    resultType: packageDocument.scope === "STORY" ? "SOLO_STORY_END" : "SOLO_PART_END",
    world,
    role,
    title: packageDocument.presentation.title,
    axes,
    metrics,
    dynamicSubtitle: renderDynamicSubtitle(packageDocument.detailCompilation.dynamicSubtitleTemplate, input.blueprint.slots),
    style: input.blueprint.style === null ? null : {
      styleId: input.blueprint.style.styleId,
      label: input.blueprint.style.label
    },
    narrative: narratedEnding.paragraphs.map((paragraph) => paragraph.text).join("\n\n"),
    sections,
    replayHint,
    endingFingerprint: input.blueprint.endingFingerprint,
    replayActions: normalizeReplayActions(input.replayActions)
  };
  assertEndgamePresentationV3(presentation);
  return deepFreeze(presentation);
}

export function assertEndgamePresentationV3(value) {
  if (!isRecord(value) || value.schemaVersion !== ENDGAME_PRESENTATION_SCHEMA_VERSION) {
    fail("ENDGAME_PRESENTATION_VERSION_UNSUPPORTED", "Expected endgame_presentation_v3.");
  }
  const requiredStrings = ["title", "dynamicSubtitle", "narrative", "replayHint", "endingFingerprint"];
  if (!requiredStrings.every((key) => typeof value[key] === "string")
    || !/^[0-9a-f]{64}$/u.test(value.endingFingerprint)
    || !["SOLO_PART_END", "SOLO_STORY_END", "LEGACY_ENDING"].includes(value.resultType)
    || !Array.isArray(value.axes) || !Array.isArray(value.metrics)
    || !Array.isArray(value.sections) || !Array.isArray(value.replayActions)) {
    fail("ENDGAME_PRESENTATION_INVALID", "Presentation V3 is incomplete.");
  }
  return value;
}

function renderDynamicSubtitle(template, slots) {
  return String(template || "").replace(/\{\{([A-Za-z0-9_.:-]+)\}\}/gu, (_match, path) => {
    const [slotId, rawIndex, field] = path.split(".");
    const index = Number(rawIndex);
    const value = Number.isInteger(index) ? slots?.[slotId]?.[index]?.[field] : undefined;
    if (typeof value !== "string") fail("ENDGAME_PRESENTATION_SUBTITLE_PLACEHOLDER", "Subtitle references unavailable slot data.", { path });
    return value;
  });
}

function normalizeReplayActions(actions) {
  if (!Array.isArray(actions)) fail("ENDGAME_PRESENTATION_REPLAY_ACTIONS_INVALID", "Replay actions must be an array.");
  const seen = new Set();
  return actions.map((action, index) => {
    assertExactObject(action, ["type", "label", "href", "enabled", "disabledReason"], `replay action ${index}`);
    if (!REPLAY_TYPES.has(action.type) || seen.has(action.type) || !text(action.label) || typeof action.enabled !== "boolean") {
      fail("ENDGAME_PRESENTATION_REPLAY_ACTION_INVALID", "Replay action is invalid or duplicated.", { index });
    }
    seen.add(action.type);
    const href = action.href === null ? null : safeHref(action.href);
    if (action.enabled && href === null) fail("ENDGAME_PRESENTATION_REPLAY_HREF_REQUIRED", "Enabled replay actions require a safe relative href.", { index });
    return {
      type: action.type,
      label: action.label.trim(),
      href,
      enabled: action.enabled,
      disabledReason: action.disabledReason === null ? null : text(action.disabledReason)
    };
  });
}

function safeHref(value) {
  const href = text(value);
  if (!href || !href.startsWith("/") || href.startsWith("//") || href.includes("\\") || /[\u0000-\u001f\u007f]/u.test(href)) return null;
  try {
    const url = new URL(href, "https://our-many-worlds.invalid");
    return url.origin === "https://our-many-worlds.invalid" ? `${url.pathname}${url.search}${url.hash}` : null;
  } catch { return null; }
}

function assertBlueprint(blueprint, adjudication) {
  if (!isRecord(blueprint) || blueprint.schemaVersion !== "ending_detail_blueprint_v2"
    || blueprint.sourceRevision !== adjudication.sourceRevision
    || !Array.isArray(blueprint.resolvedAxes) || !isRecord(blueprint.slots)
    || !/^[0-9a-f]{64}$/u.test(blueprint.endingFingerprint)) {
    fail("ENDGAME_PRESENTATION_BLUEPRINT_INVALID", "Presentation requires the frozen S4 blueprint.");
  }
}

function validatedNarrative(input) {
  const validationInput = {
    runPackageBinding: input.runPackageBinding,
    adjudication: input.adjudication,
    blueprint: input.blueprint,
    narratedEnding: input.narratedEnding
  };
  try {
    return validateNarratedEndingV1(validationInput);
  } catch (error) {
    // S5 intentionally permits its deterministic package template fallback to
    // be shorter than the model target. Accept only the byte-identical S5
    // fallback; arbitrary short model output still fails closed.
    if (error?.code !== "ENDGAME_NARRATIVE_LENGTH") throw error;
    const fallback = renderConfigDrivenEndingFallbackV1({
      runPackageBinding: input.runPackageBinding,
      adjudication: input.adjudication,
      blueprint: input.blueprint
    });
    if (canonicalizeJcs(fallback) !== canonicalizeJcs(input.narratedEnding)) throw error;
    return fallback;
  }
}

function normalizeIdentity(value, label, idKey, titleKey) {
  assertExactObject(value, [idKey, titleKey], label);
  const id = text(value[idKey]);
  const title = text(value[titleKey]);
  if (!id || !title) fail("ENDGAME_PRESENTATION_IDENTITY_INVALID", `${label} identity is incomplete.`);
  return { [idKey]: id, [titleKey]: title };
}
function normalizeRecord(value, label) { if (!isRecord(value)) fail("ENDGAME_PRESENTATION_CONTEXT_INVALID", `${label} must be an object.`); return value; }
function normalizeFacts(value) { if (!Array.isArray(value)) fail("ENDGAME_PRESENTATION_FACTS_INVALID", "facts must be an array."); return value; }
function evaluateRule(expression, context) { try { return evaluateBooleanExpression(expression, context); } catch { return false; } }
function assertExactObject(value, keys, label) { if (!isRecord(value) || Object.keys(value).some((key) => !keys.includes(key))) fail("ENDGAME_PRESENTATION_CLOSED_OBJECT", `${label} contains unknown fields.`); }
function text(value) { return typeof value === "string" && value.trim() ? value.trim() : null; }
function fail(code, message, details) { throw new ConfigDrivenEndgamePresentationError(code, message, details); }
