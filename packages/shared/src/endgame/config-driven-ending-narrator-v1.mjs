import { canonicalizeJcs } from "./endgame-package-v1.contract.mjs";
import { resolveFrozenEndgamePackageForRunV1 } from "./endgame-package-loader-v1.mjs";
import { assertEndgameAdjudicationV3 } from "./config-driven-endgame-adjudicator-v1.mjs";
import { compareText, deepFreeze, isRecord } from "./ending-detail-common-v1.mjs";

export const NARRATED_ENDING_SCHEMA_VERSION = "narrated_ending_v1";

const TOP_LEVEL_KEYS = Object.freeze(["schemaVersion", "paragraphs"]);
const PARAGRAPH_KEYS = Object.freeze(["paragraphId", "purpose", "text", "factRefs"]);
const INPUT_KEYS = Object.freeze(["runPackageBinding", "adjudication", "blueprint"]);
const VALIDATION_INPUT_KEYS = Object.freeze(["runPackageBinding", "adjudication", "blueprint", "narratedEnding"]);
const ORCHESTRATOR_KEYS = Object.freeze(["runPackageBinding", "adjudication", "blueprint", "provider"]);
const INTERNAL_FIELD_NAMES = Object.freeze([
  "packageHash",
  "endingFingerprint",
  "metricId",
  "factId",
  "outcomeId",
  "Prompt",
  "Reviewer"
]);

export class ConfigDrivenEndingNarratorError extends Error {
  constructor(code, message, details = {}) {
    super(`${code}: ${message}`);
    this.name = "ConfigDrivenEndingNarratorError";
    this.code = code;
    this.details = deepFreeze(structuredClone(details));
  }
}

export function buildConfigDrivenEndingNarratorPromptV1(input) {
  const context = prepareContext(input);
  const payload = {
    contract: {
      schemaVersion: NARRATED_ENDING_SCHEMA_VERSION,
      outputKeys: TOP_LEVEL_KEYS,
      paragraphKeys: PARAGRAPH_KEYS,
      paragraphPlan: context.paragraphPlan,
      requiredFactRefs: "Each non-atmosphere paragraph must cite committed allowed factRefs used in its text.",
      immutable: ["resolvedAxes", "finalMetrics", "sourceRevision"]
    },
    scope: context.scope,
    language: context.narrative.language,
    pointOfView: context.narrative.pointOfView,
    tone: context.narrative.tone,
    pacing: context.narrative.pacing,
    length: context.narrative.length,
    worldImagery: context.narrative.worldImagery,
    forbiddenPhrases: context.narrative.forbiddenPhrases,
    scopeConstraint: context.scopeConstraint,
    resolvedAxes: context.blueprint.resolvedAxes,
    finalMetrics: context.adjudication.finalMetrics,
    slots: context.blueprint.slots,
    scene: context.blueprint.scene,
    allowedFactRefs: context.blueprint.allowedFactRefs,
    sourceRevision: context.blueprint.sourceRevision
  };
  return deepFreeze({
    system: [
      "Render only the supplied authoritative ending blueprint.",
      "Return one JSON object matching the closed narrated_ending_v1 contract.",
      "Do not create facts, people, organizations, places, objects, numbers, outcomes, metrics, or future events.",
      "Write the ending as a final passage of a novel, not as a settlement report, task list, dashboard, or instruction.",
      "Let the emotional temperature follow the supplied resolved outcomes and costs: restrained celebration for a clearly favorable result, restrained sorrow for a costly or failed result, and bittersweet restraint when gain and loss coexist.",
      "End on one concrete image or unresolved pressure that fits the supplied scene and scope; do not add a new event.",
      "Do not expose internal identifiers. Every factual sentence must be supported by its paragraph factRefs.",
      "A PART ending must remain open when the configured scope requires an unresolved hook."
    ].join(" "),
    payload
  });
}

export function validateNarratedEndingV1(input) {
  assertExactObject(input, VALIDATION_INPUT_KEYS, "narrative validation input");
  const context = prepareContext({
    runPackageBinding: input.runPackageBinding,
    adjudication: input.adjudication,
    blueprint: input.blueprint
  });
  return validateNarratedEndingAgainstContext(input.narratedEnding, context, { enforceMinimumLength: true });
}

export function renderConfigDrivenEndingFallbackV1(input) {
  const context = prepareContext(input);
  const templates = context.narrative.fallback.paragraphTemplates[context.scope];
  if (!Array.isArray(templates) || templates.length === 0) {
    fail("ENDGAME_NARRATIVE_FALLBACK_MISSING", "The frozen package has no fallback templates for this scope.");
  }

  const rendered = templates.map((template) => renderTemplate(template, context));
  const buckets = allocateTemplates(rendered, context.paragraphPlan);
  const paragraphs = context.paragraphPlan.map((plan, index) => {
    const bucket = buckets[index];
    let text = bucket.map((item) => item.text).join("\n").trim();
    const refs = new Set(bucket.flatMap((item) => item.factRefs));

    for (const slotId of plan.requiredSlots) {
      const items = context.blueprint.slots[slotId];
      const selected = items.find((item) => item.evidenceRefs.length > 0) ?? items[0];
      if (!selected) fail("ENDGAME_NARRATIVE_REQUIRED_SLOT_EMPTY", "Fallback cannot satisfy a required slot.", { slotId });
      if (!text.includes(selected.text)) text = `${text}${text ? "\n" : ""}${selected.text}`;
      for (const factRef of selected.evidenceRefs) refs.add(factRef);
    }
    for (const axisId of plan.requiredAxes) {
      const axis = context.axisById.get(axisId);
      if (!text.includes(axis.summary) && !text.includes(axis.title)) {
        text = `${text}${text ? "\n" : ""}${axis.summary}`;
      }
    }
    return {
      paragraphId: plan.paragraphId,
      purpose: plan.purpose,
      text,
      factRefs: [...refs].sort(compareText)
    };
  });

  const narratedEnding = {
    schemaVersion: NARRATED_ENDING_SCHEMA_VERSION,
    paragraphs
  };
  return validateNarratedEndingAgainstContext(narratedEnding, context, { enforceMinimumLength: false });
}

export async function narrateConfigDrivenEndingV1(input) {
  assertExactObject(input, ORCHESTRATOR_KEYS, "narrator orchestration input");
  const baseInput = {
    runPackageBinding: input.runPackageBinding,
    adjudication: input.adjudication,
    blueprint: input.blueprint
  };
  const prompt = buildConfigDrivenEndingNarratorPromptV1(baseInput);
  const failures = [];

  if (input.provider !== null && input.provider !== undefined) {
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      try {
        const raw = await callProvider(input.provider, deepFreeze({
          ...prompt,
          attempt,
          retryReason: attempt === 2 ? failures[0] : null
        }));
        const narratedEnding = parseProviderOutput(raw);
        const validated = validateNarratedEndingV1({ ...baseInput, narratedEnding });
        return deepFreeze({ generationMode: "MODEL", attempts: attempt, narratedEnding: validated });
      } catch (error) {
        failures.push(errorSummary(error));
      }
    }
  }

  const narratedEnding = renderConfigDrivenEndingFallbackV1(baseInput);
  return deepFreeze({
    generationMode: "TEMPLATE_FALLBACK",
    attempts: failures.length,
    narratedEnding,
    failures
  });
}

function prepareContext(input) {
  assertExactObject(input, INPUT_KEYS, "narrator input");
  const { runPackageBinding, adjudication, blueprint } = input;
  const snapshot = resolveFrozenEndgamePackageForRunV1(runPackageBinding);
  assertEndgameAdjudicationV3(runPackageBinding, adjudication);
  if (!isRecord(blueprint) || blueprint.schemaVersion !== "ending_detail_blueprint_v2") {
    fail("ENDGAME_NARRATIVE_BLUEPRINT_INVALID", "Narrator requires ending_detail_blueprint_v2.");
  }
  if (blueprint.sourceRevision !== adjudication.sourceRevision) {
    fail("ENDGAME_NARRATIVE_REVISION_MISMATCH", "Blueprint and adjudication revisions must match.");
  }
  if (canonicalizeJcs(blueprint.resolvedAxes) !== canonicalizeJcs(adjudication.resolvedAxes.map((resolved) => {
    const enriched = blueprint.resolvedAxes.find((axis) => axis.axisId === resolved.axisId);
    return enriched;
  }))) {
    fail("ENDGAME_NARRATIVE_AXES_MISMATCH", "Blueprint axes do not match the authoritative adjudication.");
  }

  const packageDocument = snapshot.packageDocument;
  const narrative = packageDocument.narrative;
  const scope = packageDocument.scope;
  const paragraphPlan = narrative.paragraphPlan.filter((paragraph) => paragraph.appliesTo.includes(scope));
  if (paragraphPlan.length === 0) {
    fail("ENDGAME_NARRATIVE_PARAGRAPH_PLAN_EMPTY", "No narrative paragraphs apply to the frozen scope.");
  }
  const axisById = new Map(blueprint.resolvedAxes.map((axis) => [axis.axisId, axis]));
  for (const plan of paragraphPlan) {
    for (const axisId of plan.requiredAxes) {
      if (!axisById.has(axisId)) fail("ENDGAME_NARRATIVE_REQUIRED_AXIS_UNKNOWN", "Paragraph requires an unresolved axis.", { paragraphId: plan.paragraphId, axisId });
    }
    for (const slotId of plan.requiredSlots) {
      if (!Array.isArray(blueprint.slots[slotId]) || blueprint.slots[slotId].length === 0) {
        fail("ENDGAME_NARRATIVE_REQUIRED_SLOT_EMPTY", "Paragraph requires a missing or empty slot.", { paragraphId: plan.paragraphId, slotId });
      }
    }
  }
  return {
    runPackageBinding,
    adjudication,
    blueprint,
    packageDocument,
    narrative,
    scope,
    scopeConstraint: narrative.scopeConstraints[scope],
    paragraphPlan,
    axisById
  };
}

function validateNarratedEndingAgainstContext(narratedEnding, context, { enforceMinimumLength }) {
  assertExactObject(narratedEnding, TOP_LEVEL_KEYS, "narrated ending");
  if (narratedEnding.schemaVersion !== NARRATED_ENDING_SCHEMA_VERSION) {
    fail("ENDGAME_NARRATIVE_SCHEMA_VERSION", "Unknown narrated ending schema version.");
  }
  if (!Array.isArray(narratedEnding.paragraphs) || narratedEnding.paragraphs.length !== context.paragraphPlan.length) {
    fail("ENDGAME_NARRATIVE_PARAGRAPH_COUNT", "Narrated paragraphs must exactly match the applicable paragraph plan.");
  }

  const allowedFactRefs = new Set(context.blueprint.allowedFactRefs);
  let atmosphereOnlyCount = 0;
  const paragraphs = narratedEnding.paragraphs.map((paragraph, index) => {
    assertExactObject(paragraph, PARAGRAPH_KEYS, `paragraph ${index}`);
    const plan = context.paragraphPlan[index];
    if (paragraph.paragraphId !== plan.paragraphId || paragraph.purpose !== plan.purpose) {
      fail("ENDGAME_NARRATIVE_PARAGRAPH_PLAN_MISMATCH", "Paragraph identity or purpose differs from the frozen plan.", { index });
    }
    if (typeof paragraph.text !== "string" || paragraph.text.trim() !== paragraph.text || paragraph.text.length === 0) {
      fail("ENDGAME_NARRATIVE_TEXT_INVALID", "Paragraph text must be a non-empty trimmed string.", { paragraphId: plan.paragraphId });
    }
    if (!Array.isArray(paragraph.factRefs) || paragraph.factRefs.some((ref) => typeof ref !== "string" || ref.length === 0)) {
      fail("ENDGAME_NARRATIVE_FACT_REFS_INVALID", "factRefs must be an array of non-empty strings.", { paragraphId: plan.paragraphId });
    }
    if (new Set(paragraph.factRefs).size !== paragraph.factRefs.length) {
      fail("ENDGAME_NARRATIVE_FACT_REF_DUPLICATE", "A paragraph cannot repeat a factRef.", { paragraphId: plan.paragraphId });
    }
    for (const factRef of paragraph.factRefs) {
      if (!allowedFactRefs.has(factRef)) fail("ENDGAME_NARRATIVE_FACT_REF_NOT_ALLOWED", "Narrator cited a fact outside the compiled allowlist.", { factRef });
    }

    if (paragraph.factRefs.length === 0) {
      atmosphereOnlyCount += 1;
      if (!plan.allowAtmosphereOnly) fail("ENDGAME_NARRATIVE_FACT_REF_REQUIRED", "Non-atmosphere paragraphs require at least one factRef.", { paragraphId: plan.paragraphId });
    }
    verifyRequiredSlots(paragraph, plan, context);
    verifyRequiredAxes(paragraph, plan, context);
    verifyTextSafety(paragraph.text, context);
    return {
      paragraphId: paragraph.paragraphId,
      purpose: paragraph.purpose,
      text: paragraph.text,
      factRefs: [...paragraph.factRefs]
    };
  });
  if (atmosphereOnlyCount > 1) fail("ENDGAME_NARRATIVE_ATMOSPHERE_LIMIT", "At most one paragraph may be atmosphere-only.");

  const totalChars = [...paragraphs.map((paragraph) => paragraph.text).join("")].length;
  if (totalChars > context.narrative.length.maxChars || (enforceMinimumLength && totalChars < context.narrative.length.minChars)) {
    fail("ENDGAME_NARRATIVE_LENGTH", "Narrated ending is outside configured character limits.", {
      totalChars,
      minChars: context.narrative.length.minChars,
      maxChars: context.narrative.length.maxChars
    });
  }
  const hasUnresolved = paragraphs.some((paragraph) => paragraph.purpose === "UNRESOLVED_HOOK");
  if (context.scopeConstraint.requireUnresolvedHook && !hasUnresolved) {
    fail("ENDGAME_NARRATIVE_UNRESOLVED_HOOK_REQUIRED", "This scope requires an unresolved hook paragraph.");
  }
  if (!context.scopeConstraint.allowLifetimeClosure && paragraphs.some((paragraph) => paragraph.purpose === "STORY_CLOSURE")) {
    fail("ENDGAME_NARRATIVE_SCOPE_CLOSURE_FORBIDDEN", "A PART ending cannot contain a story-closure paragraph.");
  }
  return deepFreeze({ schemaVersion: NARRATED_ENDING_SCHEMA_VERSION, paragraphs });
}

function verifyRequiredSlots(paragraph, plan, context) {
  for (const slotId of plan.requiredSlots) {
    const items = context.blueprint.slots[slotId];
    const matched = items.some((item) => {
      const visibleAnchor = paragraph.text.includes(item.text) || paragraph.text.includes(item.title);
      const refsBound = item.evidenceRefs.length === 0 || item.evidenceRefs.some((ref) => paragraph.factRefs.includes(ref));
      return visibleAnchor && refsBound;
    });
    if (!matched) {
      fail("ENDGAME_NARRATIVE_REQUIRED_SLOT_UNMENTIONED", "Paragraph does not render its required compiled slot.", {
        paragraphId: plan.paragraphId,
        slotId
      });
    }
  }
}

function verifyRequiredAxes(paragraph, plan, context) {
  for (const axisId of plan.requiredAxes) {
    const axis = context.axisById.get(axisId);
    if (!paragraph.text.includes(axis.summary) && !paragraph.text.includes(axis.title)) {
      fail("ENDGAME_NARRATIVE_REQUIRED_AXIS_UNMENTIONED", "Paragraph does not render its required resolved axis.", {
        paragraphId: plan.paragraphId,
        axisId
      });
    }
  }
}

function verifyTextSafety(text, context) {
  for (const phrase of context.narrative.forbiddenPhrases) {
    if (text.includes(phrase)) fail("ENDGAME_NARRATIVE_FORBIDDEN_PHRASE", "Narrative contains a package-forbidden phrase.", { phrase });
  }
  for (const name of INTERNAL_FIELD_NAMES) {
    if (text.includes(name)) fail("ENDGAME_NARRATIVE_INTERNAL_FIELD_LEAK", "Narrative exposes an internal field name.", { name });
  }
  const forbiddenIdentifiers = new Set([
    context.runPackageBinding.packageRef.policyId,
    context.runPackageBinding.packageRef.packageHash,
    context.blueprint.endingFingerprint,
    ...Object.keys(context.adjudication.finalMetrics),
    ...context.blueprint.allowedFactRefs
  ]);
  for (const identifier of forbiddenIdentifiers) {
    if (identifier && containsIdentifier(text, identifier)) {
      fail("ENDGAME_NARRATIVE_INTERNAL_IDENTIFIER_LEAK", "Narrative exposes an internal identifier.", { identifier });
    }
  }

  const allowedNumbers = collectAllowedNumbers(context);
  for (const number of text.match(/-?\d+(?:\.\d+)?/g) ?? []) {
    if (!allowedNumbers.has(number)) fail("ENDGAME_NARRATIVE_UNKNOWN_NUMBER", "Narrative contains a number not present in authoritative inputs.", { number });
  }
}

function collectAllowedNumbers(context) {
  const visible = [
    ...context.blueprint.resolvedAxes.flatMap((axis) => [axis.title, axis.summary]),
    ...Object.values(context.blueprint.slots).flatMap((items) => items.flatMap((item) => [item.title, item.text])),
    context.blueprint.scene.label,
    ...Object.values(context.adjudication.finalMetrics).map(String)
  ].join(" ");
  return new Set(visible.match(/-?\d+(?:\.\d+)?/g) ?? []);
}

function containsIdentifier(text, identifier) {
  if (/^[A-Za-z0-9_]+$/.test(identifier)) {
    return new RegExp(`(?<![A-Za-z0-9_])${escapeRegExp(identifier)}(?![A-Za-z0-9_])`).test(text);
  }
  return text.includes(identifier);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function renderTemplate(template, context) {
  if (typeof template !== "string") fail("ENDGAME_NARRATIVE_FALLBACK_TEMPLATE_INVALID", "Fallback template must be a string.");
  const factRefs = new Set();
  const placeholders = [];
  const text = template.replace(/\{\{([^{}]+)\}\}/g, (_match, rawPath) => {
    const path = rawPath.trim();
    placeholders.push(path);
    if (!context.narrative.fallback.allowedPlaceholders.includes(path)) {
      fail("ENDGAME_NARRATIVE_FALLBACK_PLACEHOLDER_FORBIDDEN", "Fallback placeholder is not on the frozen allowlist.", { path });
    }
    const value = resolvePlaceholder(path, context, factRefs);
    if (typeof value !== "string" || value.length === 0) {
      fail("ENDGAME_NARRATIVE_FALLBACK_PLACEHOLDER_EMPTY", "Fallback placeholder resolved to an empty or non-string value.", { path });
    }
    return value;
  });
  if (/\{\{|\}\}/.test(text)) fail("ENDGAME_NARRATIVE_FALLBACK_TEMPLATE_SYNTAX", "Fallback template contains unresolved template syntax.");
  return { text: text.trim(), factRefs: [...factRefs].sort(compareText), placeholders };
}

function resolvePlaceholder(path, context, factRefs) {
  const parts = path.split(".");
  if (parts[0] === "axis" && parts.length === 3) {
    const axis = context.axisById.get(parts[1]);
    if (!axis || !["title", "summary"].includes(parts[2])) fail("ENDGAME_NARRATIVE_FALLBACK_AXIS_UNKNOWN", "Fallback references an unknown axis field.", { path });
    return axis[parts[2]];
  }
  if (parts.length === 3 && /^\d+$/.test(parts[1]) && ["title", "text"].includes(parts[2])) {
    const item = context.blueprint.slots[parts[0]]?.[Number(parts[1])];
    if (!item) fail("ENDGAME_NARRATIVE_FALLBACK_SLOT_UNKNOWN", "Fallback references an unknown slot item.", { path });
    for (const factRef of item.evidenceRefs) factRefs.add(factRef);
    return item[parts[2]];
  }
  fail("ENDGAME_NARRATIVE_FALLBACK_PLACEHOLDER_INVALID", "Fallback placeholder shape is unsupported.", { path });
}

function allocateTemplates(items, paragraphPlan) {
  const buckets = Array.from({ length: paragraphPlan.length }, () => []);
  items.forEach((item, index) => {
    const scores = paragraphPlan.map((plan, planIndex) => ({
      planIndex,
      score: item.placeholders.reduce((score, path) => {
        if (plan.requiredSlots.some((slotId) => path.startsWith(`${slotId}.`))) return score + 2;
        if (plan.requiredAxes.some((axisId) => path.startsWith(`axis.${axisId}.`))) return score + 2;
        return score;
      }, 0)
    })).sort((left, right) => right.score - left.score || left.planIndex - right.planIndex);
    const chosen = scores[0].score > 0 ? scores[0].planIndex : Math.min(index, paragraphPlan.length - 1);
    buckets[chosen].push(item);
  });
  return buckets;
}

async function callProvider(provider, request) {
  if (typeof provider === "function") return provider(request);
  if (isRecord(provider) && typeof provider.generate === "function") return provider.generate(request);
  fail("ENDGAME_NARRATIVE_PROVIDER_INVALID", "Provider must be a function or expose generate().");
}

function parseProviderOutput(raw) {
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw);
    } catch (error) {
      fail("ENDGAME_NARRATIVE_PROVIDER_JSON_INVALID", "Provider returned invalid JSON.", { cause: errorSummary(error) });
    }
  }
  if (!isRecord(raw)) fail("ENDGAME_NARRATIVE_PROVIDER_OUTPUT_INVALID", "Provider output must be a JSON object or JSON string.");
  return raw;
}

function assertExactObject(value, allowedKeys, label) {
  if (!isRecord(value)) fail("ENDGAME_NARRATIVE_CLOSED_OBJECT_REQUIRED", `${label} must be an object.`);
  const actual = Object.keys(value);
  const unknown = actual.filter((key) => !allowedKeys.includes(key));
  const missing = allowedKeys.filter((key) => !actual.includes(key));
  if (unknown.length > 0 || missing.length > 0) {
    fail("ENDGAME_NARRATIVE_CLOSED_OBJECT_VIOLATION", `${label} has unknown or missing fields.`, { unknown, missing });
  }
}

function errorSummary(error) {
  return error instanceof Error ? { name: error.name, code: error.code ?? null, message: error.message } : { name: "UnknownError", code: null, message: String(error) };
}

function fail(code, message, details = {}) {
  throw new ConfigDrivenEndingNarratorError(code, message, details);
}
