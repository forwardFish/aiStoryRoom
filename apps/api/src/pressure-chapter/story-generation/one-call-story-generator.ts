import { sha256Canonical } from "@ai-story/shared";
import type {
  GeneratePressureOneCallStoryInputV1,
  PressureChapterSummaryAuthorityV1,
  PressureGeneratedChapterSummaryV1,
  PressureGeneratedTurnV1,
  PressureOneCallStoryOutputV1,
  PressureOneCallStoryProviderPortV1,
} from "./contracts";

const UNSAFE = /(actionType|factId|metricId|Provider|Prompt|Reviewer|fence|hash|数据库字段|必然成功|保证获胜)/iu;

export class PressureOneCallStoryGeneratorV1 {
  private readonly cache = new Map<string, Promise<PressureOneCallStoryOutputV1>>();

  constructor(private readonly provider: PressureOneCallStoryProviderPortV1 | null) {}

  async generate(input: Readonly<GeneratePressureOneCallStoryInputV1>): Promise<PressureOneCallStoryOutputV1> {
    const context = compileContext(input);
    const key = sha256Canonical(context);
    const cached = this.cache.get(key);
    if (cached) return structuredClone(await cached);
    const pending = this.generateUncached(input, context);
    this.cache.set(key, pending);
    try {
      return structuredClone(await pending);
    } catch {
      this.cache.delete(key);
      return fallback(input);
    }
  }

  private async generateUncached(
    input: Readonly<GeneratePressureOneCallStoryInputV1>,
    context: Readonly<Record<string, unknown>>,
  ): Promise<PressureOneCallStoryOutputV1> {
    if (!this.provider) return fallback(input);
    try {
      const raw = await this.provider.renderOneCallStory(structuredClone(context));
      return input.mode === "TURN"
        ? validateTurn(raw, input)
        : validateSummary(raw, requiredSummary(input), input.storyPack.identity.chapterId);
    } catch {
      return fallback(input);
    }
  }
}

export function compilePressureOneCallStoryContextV1(
  input: Readonly<GeneratePressureOneCallStoryInputV1>,
): Readonly<Record<string, unknown>> {
  return compileContext(input);
}

function compileContext(input: Readonly<GeneratePressureOneCallStoryInputV1>): Readonly<Record<string, unknown>> {
  if (input.mode === "TURN") {
    if (!input.turnFallback || input.summaryAuthority) throw new Error("PRESSURE_ONE_CALL_TURN_INPUT_INVALID");
    return Object.freeze({
      schemaVersion: "pressure_one_call_story_context_v1",
      mode: "TURN",
      storyPack: structuredClone(input.storyPack),
      outputContract: {
        fields: ["sceneText", "question", "options"],
        legalActionRefs: input.storyPack.decision.legalActionRefs,
        oneCallOnly: true,
        authorityMayNotChange: true,
      },
    });
  }
  const summary = requiredSummary(input);
  return Object.freeze({
    schemaVersion: "pressure_one_call_story_context_v1",
    mode: "CHAPTER_SUMMARY",
    storyPack: structuredClone(input.storyPack),
    summaryAuthority: structuredClone(summary),
    outputContract: {
      fields: [
        "closingNarrative", "playerActions", "actualResults", "completedObjectives",
        "incompleteObjectives", "metricChanges", "remainingPressures", "nextChapterHook",
      ],
      metricValuesReadOnly: true,
      referenceSetsMustMatch: true,
      oneCallOnly: true,
    },
  });
}

function validateTurn(value: unknown, input: Readonly<GeneratePressureOneCallStoryInputV1>): PressureGeneratedTurnV1 {
  const raw = exact(value, ["sceneText", "question", "options"], "turn");
  const sceneText = text(raw.sceneText, "turn.sceneText", 80, 1_600);
  const question = text(raw.question, "turn.question", 4, 120);
  if (!Array.isArray(raw.options) || raw.options.length !== input.storyPack.decision.catalogActions.length) {
    throw new Error("PRESSURE_ONE_CALL_TURN_OPTION_COUNT");
  }
  const expected = new Map(input.storyPack.decision.catalogActions.map((item) => [item.actionRef, item]));
  const seen = new Set<string>();
  const options = raw.options.map((item, index) => {
    const option = exact(item, ["actionRef", "label", "description"], `turn.options[${index}]`);
    const actionRef = text(option.actionRef, `turn.options[${index}].actionRef`, 1, 180);
    const authority = expected.get(actionRef);
    if (!authority || seen.has(actionRef)) throw new Error("PRESSURE_ONE_CALL_TURN_ACTION_BINDING");
    seen.add(actionRef);
    return {
      actionRef,
      actionType: authority.actionType,
      label: text(option.label, `turn.options[${index}].label`, 2, 40),
      description: text(option.description, `turn.options[${index}].description`, 8, 160),
    };
  });
  if (seen.size !== expected.size) throw new Error("PRESSURE_ONE_CALL_TURN_ACTION_SET");
  return hashed({ mode: "TURN" as const, sceneText, question, options, renderMode: "PROVIDER" as const });
}

function validateSummary(
  value: unknown,
  authority: PressureChapterSummaryAuthorityV1,
  storyPackChapterId: string,
): PressureGeneratedChapterSummaryV1 {
  if (authority.chapterId !== storyPackChapterId) throw new Error("PRESSURE_ONE_CALL_SUMMARY_CHAPTER_MISMATCH");
  const raw = exact(value, [
    "closingNarrative", "playerActions", "actualResults", "completedObjectives",
    "incompleteObjectives", "metricChanges", "remainingPressures", "nextChapterHook",
  ], "summary");
  const playerActions = validateRefTextArray(raw.playerActions, authority.playerActions, "actionId", "summary.playerActions");
  const actualResults = validateRefTextArray(raw.actualResults, authority.actualResults, "resultRef", "summary.actualResults");
  const completedObjectives = validateRefTextArray(raw.completedObjectives, authority.completedObjectives, "objectiveRef", "summary.completedObjectives");
  const incompleteObjectives = validateRefTextArray(raw.incompleteObjectives, authority.incompleteObjectives, "objectiveRef", "summary.incompleteObjectives");
  const remainingPressures = validateRefTextArray(raw.remainingPressures, authority.remainingPressures, "pressureRef", "summary.remainingPressures");
  if (!Array.isArray(raw.metricChanges) || raw.metricChanges.length !== authority.metricChanges.length) {
    throw new Error("PRESSURE_ONE_CALL_SUMMARY_METRICS");
  }
  const metrics = new Map(authority.metricChanges.map((item) => [item.metricRef, item]));
  const seen = new Set<string>();
  const metricChanges = raw.metricChanges.map((item, index) => {
    const candidate = exact(item, ["metricRef", "label", "before", "delta", "after"], `summary.metricChanges[${index}]`);
    const metricRef = text(candidate.metricRef, `summary.metricChanges[${index}].metricRef`, 1, 160);
    const expected = metrics.get(metricRef);
    if (!expected || seen.has(metricRef)) throw new Error("PRESSURE_ONE_CALL_SUMMARY_METRIC_BINDING");
    if (candidate.before !== expected.before || candidate.delta !== expected.delta || candidate.after !== expected.after) {
      throw new Error("PRESSURE_ONE_CALL_SUMMARY_METRIC_MUTATION");
    }
    seen.add(metricRef);
    return {
      label: text(candidate.label, `summary.metricChanges[${index}].label`, 1, 80),
      before: expected.before,
      delta: expected.delta,
      after: expected.after,
      displayBefore: expected.displayBefore,
      displayDelta: expected.displayDelta,
      displayAfter: expected.displayAfter,
    };
  });
  if (seen.size !== metrics.size) throw new Error("PRESSURE_ONE_CALL_SUMMARY_METRIC_SET");
  return hashed({
    mode: "CHAPTER_SUMMARY" as const,
    chapterId: authority.chapterId,
    title: authority.title,
    closingNarrative: text(raw.closingNarrative, "summary.closingNarrative", 80, 2_400),
    playerActions,
    actualResults,
    completedObjectives,
    incompleteObjectives,
    metricChanges,
    remainingPressures,
    nextChapterHook: text(raw.nextChapterHook, "summary.nextChapterHook", 8, 300),
    sourceCommitHash: authority.sourceCommitHash,
    renderMode: "PROVIDER" as const,
  });
}

function fallback(input: Readonly<GeneratePressureOneCallStoryInputV1>): PressureOneCallStoryOutputV1 {
  if (input.mode === "TURN") {
    if (!input.turnFallback) throw new Error("PRESSURE_ONE_CALL_TURN_FALLBACK_REQUIRED");
    return hashed({
      mode: "TURN" as const,
      sceneText: input.turnFallback.sceneText,
      question: input.turnFallback.question,
      options: input.storyPack.decision.catalogActions.map((item) => ({
        actionRef: item.actionRef,
        actionType: item.actionType,
        label: item.label,
        description: item.description,
      })),
      renderMode: "DETERMINISTIC_FALLBACK" as const,
    });
  }
  const authority = requiredSummary(input);
  return hashed({
    mode: "CHAPTER_SUMMARY" as const,
    chapterId: authority.chapterId,
    title: authority.title,
    closingNarrative: authority.closingNarrativeFallback,
    playerActions: authority.playerActions.map((item) => item.text),
    actualResults: authority.actualResults.map((item) => item.text),
    completedObjectives: authority.completedObjectives.map((item) => item.text),
    incompleteObjectives: authority.incompleteObjectives.map((item) => item.text),
    metricChanges: authority.metricChanges.map(({ metricRef: _metricRef, ...item }) => item),
    remainingPressures: authority.remainingPressures.map((item) => item.text),
    nextChapterHook: authority.nextChapterHookFallback,
    sourceCommitHash: authority.sourceCommitHash,
    renderMode: "DETERMINISTIC_FALLBACK" as const,
  });
}

function validateRefTextArray(
  value: unknown,
  authority: readonly Record<string, string>[],
  refKey: string,
  path: string,
): string[] {
  if (!Array.isArray(value) || value.length !== authority.length) throw new Error("PRESSURE_ONE_CALL_SUMMARY_REFERENCE_COUNT");
  const expected = new Map(authority.map((item) => [item[refKey]!, item]));
  const seen = new Set<string>();
  const result = value.map((item, index) => {
    const candidate = exact(item, [refKey, "text"], `${path}[${index}]`);
    const ref = text(candidate[refKey], `${path}[${index}].${refKey}`, 1, 180);
    if (!expected.has(ref) || seen.has(ref)) throw new Error("PRESSURE_ONE_CALL_SUMMARY_REFERENCE_BINDING");
    seen.add(ref);
    return text(candidate.text, `${path}[${index}].text`, 1, 300);
  });
  if (seen.size !== expected.size) throw new Error("PRESSURE_ONE_CALL_SUMMARY_REFERENCE_SET");
  return result;
}

function requiredSummary(input: Readonly<GeneratePressureOneCallStoryInputV1>): PressureChapterSummaryAuthorityV1 {
  if (!input.summaryAuthority || input.turnFallback) throw new Error("PRESSURE_ONE_CALL_SUMMARY_INPUT_INVALID");
  return input.summaryAuthority;
}

function exact(value: unknown, keys: readonly string[], path: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`PRESSURE_ONE_CALL_INVALID:${path}`);
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some((key) => !keys.includes(key)) || keys.some((key) => !(key in record))) {
    throw new Error(`PRESSURE_ONE_CALL_KEYS:${path}`);
  }
  return record;
}

function text(value: unknown, path: string, min: number, max: number): string {
  if (typeof value !== "string") throw new Error(`PRESSURE_ONE_CALL_TEXT:${path}`);
  const result = value.trim();
  const size = [...result].length;
  if (size < min || size > max || UNSAFE.test(result)) throw new Error(`PRESSURE_ONE_CALL_TEXT:${path}`);
  return result;
}

function hashed<T extends Record<string, unknown>>(body: T): T & { generationHash: string } {
  return { ...body, generationHash: sha256Canonical(body) };
}
