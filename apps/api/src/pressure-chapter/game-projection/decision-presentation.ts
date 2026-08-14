import { sha256Canonical } from "@ai-story/shared";
import {
  loadSangtianPressureStorySourceV1,
} from "@ai-story/templates";
import { PRESSURE_DECISION_OUTPUT_REQUIREMENTS_V1 } from "../production-config/pressure-prompt-layers";
import type {
  PressureGameChapterProjectionV1,
  PressureGameDecisionProjectionV1,
  PressureGameMetricProjectionV1,
  PressureGameNarrativeProjectionV1,
  PressureGameResourceProjectionV1,
  PressureGameSituationProjectionV1,
  PressureGameViewerProjectionV1,
} from "./contracts";

export interface PressureDecisionPresentationContextV1 {
  schemaVersion: "pressure_decision_presentation_context_v1";
  chapter: Pick<
    PressureGameChapterProjectionV1,
    "chapterId" | "chapterRuntimeId" | "title" | "workingRevision"
  >;
  viewer: Pick<PressureGameViewerProjectionV1, "seatId" | "roleName">;
  playerIdentity: ReturnType<typeof loadSangtianPressureStorySourceV1>["playerIdentity"];
  characterRules: Omit<
    ReturnType<typeof loadSangtianPressureStorySourceV1>["characterRules"],
    "dialogueSeeds"
  >;
  dialogueExamples: readonly string[];
  worldAndStyle: ReturnType<typeof loadSangtianPressureStorySourceV1>["worldAndStyle"];
  currentScene: Readonly<{
    phase: "OPENING" | "CONTINUATION";
    title: string;
    text: string;
  }>;
  situation: PressureGameSituationProjectionV1;
  metrics: PressureGameMetricProjectionV1[];
  resources: PressureGameResourceProjectionV1[];
  previousNarrative: Pick<
    PressureGameNarrativeProjectionV1,
    "projectionKind" | "sourceId" | "sourceCommitHash" | "text"
  > & Readonly<{ authority: "CONTINUITY_ONLY" }>;
  pressureGuidance: string;
  decisionPointId: string;
  legalActionContracts: Array<{
    actionType: string;
    intendedAction: string;
    realTradeoff: string | null;
    fallbackLabel: string;
  }>;
  factBoundary: Readonly<{
    identityAndCharacterRulesAreNotEvents: true;
    previousNarrativeIsNotAuthority: true;
    durableStateSources: readonly ["CURRENT_STATE", "SITUATION", "LEGAL_ACTION_CONTRACTS"];
    forbiddenInferences: readonly string[];
  }>;
  continuityExcerpt: string;
  outputExample: Readonly<{
    sceneText: string;
    question: string;
    options: Array<{
      actionType: string;
      label: string;
      description: string;
    }>;
  }>;
  outputRequirements: typeof PRESSURE_DECISION_OUTPUT_REQUIREMENTS_V1;
  instruction: string;
  contextHash: string;
}

export interface PressureDecisionPresentationCandidateV1 {
  sceneText: string;
  question: string;
  options: Array<{
    actionType: string;
    label: string;
    description: string;
  }>;
}

export interface PressureDecisionPresentationProviderPortV1 {
  renderDecisionPresentation(
    context: Readonly<PressureDecisionPresentationContextV1>,
  ): Promise<unknown>;
}

export interface PressureDecisionPresentationInputV1 {
  chapter: PressureGameChapterProjectionV1;
  viewer: PressureGameViewerProjectionV1;
  situation: PressureGameSituationProjectionV1;
  metrics: PressureGameMetricProjectionV1[];
  resources: PressureGameResourceProjectionV1[];
  narrative: PressureGameNarrativeProjectionV1;
  decision: PressureGameDecisionProjectionV1;
}

const ENGINEERING_COPY = /(actionType|decisionPointId|WorkingDelta|stateAfter|Catalog|Pressure\s*Spine|系统字段|规则结算)/iu;
const FALSE_GUARANTEE = /(一定成功|必然成功|彻底解决|全部解决|保证成功|直接获胜|已经完成全部)/u;

/**
 * Read-only, fail-open presentation enrichment. Authority and action identity
 * never enter the Provider output: invalid output returns the original
 * Catalog/Pressure presentation as one whole fallback.
 */
export class PressureDecisionPresentationServiceV1 {
  private readonly cache = new Map<
    string,
    Promise<PressureGameDecisionProjectionV1>
  >();

  constructor(
    private readonly provider: PressureDecisionPresentationProviderPortV1 | null,
  ) {}

  async present(
    input: Readonly<PressureDecisionPresentationInputV1>,
  ): Promise<PressureGameDecisionProjectionV1> {
    const fallback = structuredClone(input.decision);
    if (input.narrative.projectionKind === "GENESIS_NARRATIVE") {
      const storySource = loadSangtianPressureStorySourceV1(
        input.chapter.chapterId,
        input.viewer.seatId,
      );
      return {
        ...fallback,
        summary: storySource.currentScene.text,
      };
    }
    if (
      !this.provider
      || input.decision.options.length === 0
    ) return fallback;
    const context = compilePressureDecisionPresentationContextV1(input);
    const cached = this.cache.get(context.contextHash);
    if (cached) {
      try {
        return structuredClone(await cached);
      } catch {
        this.cache.delete(context.contextHash);
        return fallback;
      }
    }
    const pending = this.generate(context, fallback);
    this.cache.set(context.contextHash, pending);
    try {
      return structuredClone(await pending);
    } catch {
      this.cache.delete(context.contextHash);
      return fallback;
    }
  }

  private async generate(
    context: PressureDecisionPresentationContextV1,
    fallback: PressureGameDecisionProjectionV1,
  ): Promise<PressureGameDecisionProjectionV1> {
    try {
      const raw = await this.provider!.renderDecisionPresentation(
        structuredClone(context),
      );
      const candidate = validatePressureDecisionPresentationCandidateV1(
        raw,
        context,
      );
      const generatedByAction = new Map(
        candidate.options.map((option) => [option.actionType, option]),
      );
      return {
        ...structuredClone(fallback),
        title: candidate.question,
        summary: candidate.sceneText,
        options: fallback.options.map((option) => {
          const generated = generatedByAction.get(option.actionType)!;
          return {
            ...option,
            label: generated.label,
            description: generated.description,
          };
        }),
      };
    } catch (error) {
      console.warn(JSON.stringify({
        event: "PRESSURE_DECISION_PRESENTATION_FALLBACK",
        contextHash: context.contextHash,
        chapterId: context.chapter.chapterId,
        decisionPointId: context.decisionPointId,
        reason: error instanceof Error ? error.message : "UNKNOWN",
      }));
      throw error;
    }
  }
}

export function compilePressureDecisionPresentationContextV1(
  input: Readonly<PressureDecisionPresentationInputV1>,
): PressureDecisionPresentationContextV1 {
  if (input.chapter.chapterId === "P0") {
    throw new Error("PRESSURE_DECISION_PRESENTATION_P0_FORBIDDEN");
  }
  const storySource = loadSangtianPressureStorySourceV1(
    input.chapter.chapterId,
    input.viewer.seatId,
  );
  const continuityText = input.narrative.text?.trim()
    || storySource.currentScene.postBeatFrame.text.trim();
  if (!continuityText) {
    throw new Error("PRESSURE_DECISION_PRESENTATION_CONTINUITY_REQUIRED");
  }
  const continuityExcerpt = decisionContinuityExcerpt(continuityText);
  const base = {
    schemaVersion: "pressure_decision_presentation_context_v1" as const,
    chapter: {
      chapterId: input.chapter.chapterId,
      chapterRuntimeId: input.chapter.chapterRuntimeId,
      title: input.chapter.title,
      workingRevision: input.chapter.workingRevision,
    },
    viewer: {
      seatId: input.viewer.seatId,
      roleName: input.viewer.roleName,
    },
    playerIdentity: structuredClone(storySource.playerIdentity),
    characterRules: {
      privatePressure: storySource.characterRules.privatePressure,
      ruleHint: storySource.characterRules.ruleHint,
    },
    dialogueExamples: structuredClone(storySource.characterRules.dialogueSeeds),
    worldAndStyle: structuredClone(storySource.worldAndStyle),
    currentScene: input.narrative.projectionKind === "GENESIS_NARRATIVE"
      ? {
          phase: "OPENING" as const,
          title: storySource.currentScene.title,
          text: storySource.currentScene.text,
        }
      : {
          phase: "CONTINUATION" as const,
          title: storySource.currentScene.postBeatFrame.title,
          text: storySource.currentScene.postBeatFrame.text,
        },
    situation: structuredClone(input.situation),
    metrics: structuredClone(input.metrics),
    resources: structuredClone(input.resources),
    previousNarrative: {
      projectionKind: input.narrative.projectionKind,
      sourceId: input.narrative.sourceId,
      sourceCommitHash: input.narrative.sourceCommitHash,
      text: continuityText,
      authority: "CONTINUITY_ONLY" as const,
    },
    pressureGuidance: input.decision.summary,
    decisionPointId: input.decision.decisionPointId,
    legalActionContracts: input.decision.options.map((option) => ({
      actionType: option.actionType,
      intendedAction: option.description,
      realTradeoff: explicitRealTradeoff(option),
      fallbackLabel: option.label,
    })),
    factBoundary: {
      identityAndCharacterRulesAreNotEvents: true as const,
      previousNarrativeIsNotAuthority: true as const,
      durableStateSources: [
        "CURRENT_STATE",
        "SITUATION",
        "LEGAL_ACTION_CONTRACTS",
      ] as const,
      forbiddenInferences: [
        "身份背景中的长期压力不等于当前现场已经发生对应事件。",
        "合法行动方向不等于执行该行动所需人物、物件或证据已经出现在现场。",
        "压力正在上升不等于灾害、伤亡、抓捕、冲突或其他结果已经发生。",
        "上一段剧情中的临时文学细节不等于下一轮权威事实，也不能生成新的效果或代价。",
      ],
    },
    continuityExcerpt,
    outputExample: {
      sceneText: input.narrative.projectionKind === "GENESIS_NARRATIVE"
        ? storySource.currentScene.text
        : continuityExcerpt,
      question: "由现场最后一个压力自然逼出的具体问题？",
      options: input.decision.options.map((option) => ({
        actionType: option.actionType,
        label: option.label,
        description: `自然改写“${option.description}”并说明直接目的；realTradeoff为null时不补写代价或其他选项。`,
      })),
    },
    outputRequirements: PRESSURE_DECISION_OUTPUT_REQUIREMENTS_V1,
    instruction: [
      "只写当前玩家可见的连续中文戏剧场景，承接上一段真实叙事。",
      "通过人物动作、消息、追问和压力自然逼出当前问题。",
      "逐一改写已有合法行动的表达，不新增行动，不宣告行动结果。",
      "sceneText 是决策前剧情，question 是人物此刻必须回答的问题。",
    ].join(" "),
  };
  return {
    ...base,
    contextHash: sha256Canonical(base),
  };
}

function explicitRealTradeoff(
  option: Readonly<PressureGameDecisionProjectionV1["options"][number]>,
): string | null {
  const value = (option as unknown as { realTradeoff?: unknown }).realTradeoff;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function decisionContinuityExcerpt(value: string): string {
  const paragraphs = value
    .split(/\n\s*\n/u)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
  const selected: string[] = [];
  for (let index = paragraphs.length - 1; index >= 0; index -= 1) {
    selected.unshift(paragraphs[index]!);
    if ([...selected.join("\n\n")].length >= 30) break;
  }
  const excerpt = selected.join("\n\n") || value.trim();
  return [...excerpt].length <= 1_200
    ? excerpt
    : [...excerpt].slice(-1_200).join("");
}

export function validatePressureDecisionPresentationCandidateV1(
  value: unknown,
  context: Readonly<PressureDecisionPresentationContextV1>,
): PressureDecisionPresentationCandidateV1 {
  const candidate = plainObject(value, "candidate");
  exactKeys(candidate, ["sceneText", "question", "options"], "candidate");
  const sceneText = boundedText(candidate.sceneText, "candidate.sceneText", 30, 1_200);
  const question = boundedText(candidate.question, "candidate.question", 4, 80);
  if (ENGINEERING_COPY.test(sceneText) || ENGINEERING_COPY.test(question)) {
    throw new Error("PRESSURE_DECISION_PRESENTATION_ENGINEERING_COPY");
  }
  if (FALSE_GUARANTEE.test(sceneText) || FALSE_GUARANTEE.test(question)) {
    throw new Error("PRESSURE_DECISION_PRESENTATION_FALSE_GUARANTEE");
  }
  if (
    context.currentScene.phase === "OPENING"
    && sceneText === context.continuityExcerpt
  ) {
    throw new Error("PRESSURE_DECISION_PRESENTATION_OPENING_NOT_GENERATED");
  }
  if (!Array.isArray(candidate.options)
    || candidate.options.length !== context.legalActionContracts.length) {
    throw new Error("PRESSURE_DECISION_PRESENTATION_OPTION_COUNT");
  }
  const allowed = new Set(context.legalActionContracts.map((option) => option.actionType));
  const seen = new Set<string>();
  const options = candidate.options.map((raw, index) => {
    const option = plainObject(raw, `candidate.options[${index}]`);
    requiredKeys(option, ["actionType", "label", "description"], `candidate.options[${index}]`);
    const actionType = boundedText(option.actionType, `candidate.options[${index}].actionType`, 1, 120);
    const label = boundedText(option.label, `candidate.options[${index}].label`, 2, 32);
    const description = boundedText(option.description, `candidate.options[${index}].description`, 8, 120);
    if (!allowed.has(actionType) || seen.has(actionType)) {
      throw new Error("PRESSURE_DECISION_PRESENTATION_ACTION_BINDING");
    }
    if (ENGINEERING_COPY.test(label) || ENGINEERING_COPY.test(description)
      || FALSE_GUARANTEE.test(label) || FALSE_GUARANTEE.test(description)) {
      throw new Error("PRESSURE_DECISION_PRESENTATION_UNSAFE_OPTION_COPY");
    }
    seen.add(actionType);
    return { actionType, label, description };
  });
  if (seen.size !== allowed.size) {
    throw new Error("PRESSURE_DECISION_PRESENTATION_ACTION_SET");
  }
  return { sceneText, question, options };
}

function plainObject(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`PRESSURE_DECISION_PRESENTATION_OBJECT:${path}`);
  }
  return value as Record<string, unknown>;
}

function requiredKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  path: string,
): void {
  const missing = required.filter((key) => !Object.hasOwn(value, key));
  if (missing.length > 0) {
    throw new Error(`PRESSURE_DECISION_PRESENTATION_KEYS:${path}`);
  }
}

function exactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
  path: string,
): void {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length
    || actual.some((key, index) => key !== wanted[index])) {
    throw new Error(`PRESSURE_DECISION_PRESENTATION_KEYS:${path}`);
  }
}

function boundedText(
  value: unknown,
  path: string,
  minimum: number,
  maximum: number,
): string {
  if (typeof value !== "string") {
    throw new Error(`PRESSURE_DECISION_PRESENTATION_TEXT:${path}`);
  }
  const text = value.trim();
  const length = [...text].length;
  if (length < minimum || length > maximum) {
    throw new Error(`PRESSURE_DECISION_PRESENTATION_LENGTH:${path}:${length}`);
  }
  return text;
}
