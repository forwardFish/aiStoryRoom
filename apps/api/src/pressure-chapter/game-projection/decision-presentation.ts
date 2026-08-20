import { sha256Canonical } from "@ai-story/shared";
import { performance } from "node:perf_hooks";
import { loadSangtianPressureStorySourceV1 } from "@ai-story/templates";
import { PRESSURE_TURN_OUTPUT_REQUIREMENTS_V1 } from "../production-config/pressure-prompt-layers";
import type {
  PressureGameChapterProjectionV1,
  PressureGameDecisionProjectionV1,
  PressureGameMetricProjectionV1,
  PressureGameNarrativeProjectionV1,
  PressureGameResourceProjectionV1,
  PressureGameSituationProjectionV1,
  PressureGameViewerProjectionV1,
} from "./contracts";
import {
  compilePressureTurnAuthorityDraftV1,
  type PressureTurnAuthorityDraftV1,
} from "./turn-authority-draft";

export interface PressureTurnPresentationContextV1 {
  schemaVersion: "pressure_turn_presentation_context_v1";
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
  authorityDraft: PressureTurnAuthorityDraftV1;
  previousNarrative: Pick<
    PressureGameNarrativeProjectionV1,
    "projectionKind" | "sourceId" | "sourceCommitHash" | "text"
  > & Readonly<{ authority: "CONTINUITY_ONLY" }>;
  pressureGuidance: string;
  previousPlayerAction: Readonly<{
    decisionPointId: string;
    actionType: string;
    displayText: string;
    effectText: string;
    authority: "WORKING_LEDGER_ACCEPTED_ACTION";
  }> | null;
  authorialGuidance: Readonly<{
    beatId: string;
    title: string;
    storyPurpose: string;
    materials: readonly {
      materialRef: string;
      title: string;
      text: string;
      stopCondition: string | null;
      requiredFactRefs: readonly string[];
      supportedByAuthority: boolean;
    }[];
    authority: "AUTHORIAL_GUIDANCE_ONLY";
  }> | null;
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
    legalActionsAreNotCompletedResults: true;
    authorialGuidanceIsNotAuthority: true;
    durableStateSources: readonly ["TURN_AUTHORITY_DRAFT", "VIEWER_ACCEPTED_ACTION"];
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
  outputRequirements: typeof PRESSURE_TURN_OUTPUT_REQUIREMENTS_V1;
  instruction: string;
  contextHash: string;
}

export interface PressureTurnPresentationCandidateV1 {
  sceneText: string;
  question: string;
  options: Array<{
    actionType: string;
    label: string;
    description: string;
  }>;
  usedFactRefs: string[];
  claims: [];
}

export interface PressureTurnPresentationProviderPortV1 {
  renderTurnPresentation(
    context: Readonly<PressureTurnPresentationContextV1>,
  ): Promise<unknown>;
}

export interface PressureTurnPresentationInputV1 {
  chapter: PressureGameChapterProjectionV1;
  viewer: PressureGameViewerProjectionV1;
  situation: PressureGameSituationProjectionV1;
  metrics: PressureGameMetricProjectionV1[];
  resources: PressureGameResourceProjectionV1[];
  narrative: PressureGameNarrativeProjectionV1;
  decision: PressureGameDecisionProjectionV1;
  previousPlayerAction?: Readonly<{
    decisionPointId: string;
    actionType: string;
    displayText: string;
    effectText: string;
  }> | null;
  currentBeatStory?: Readonly<{
    beatId: string;
    title: string;
    storyPurpose: string;
    authorialMaterials: readonly {
      materialRef: string;
      title: string;
      text: string;
      stopCondition: string | null;
      requiredFactRefs: readonly string[];
      supportedByAuthority: boolean;
    }[];
  }> | null;
}

const ENGINEERING_COPY = /(actionType|decisionPointId|WorkingDelta|stateAfter|Catalog|Pressure\s*Spine|系统字段|规则结算)/iu;
const FALSE_GUARANTEE = /(一定成功|必然成功|彻底解决|全部解决|保证成功|直接获胜|已经完成全部)/u;
const QUESTION_DISPLAY_MAX = 80;
const QUESTION_PROVIDER_HARD_MAX = 600;

type PressureTurnPresentationTimingStatusV1 =
  | "FALLBACK_NO_PROVIDER"
  | "FALLBACK_NO_OPTIONS"
  | "CACHE_HIT"
  | "CACHE_REJECTED_FALLBACK"
  | "PROVIDER_SUCCESS"
  | "PROVIDER_FALLBACK"
  | "PRESENTATION_FAILURE";

type PressureTurnPresentationStageTimingsV1 = {
  fallbackBuildMs: number;
  genesisStorySourceMs: number;
  contextCompileMs: number;
  cacheWaitMs: number;
  providerMs: number;
  validationMs: number;
  optionMappingMs: number;
  resultCloneMs: number;
};

/**
 * Read-only, fail-open presentation enrichment. Authority and action identity
 * never enter the Provider output: invalid output returns the original
 * Catalog/Pressure presentation as one whole fallback.
 */
export class PressureTurnPresentationServiceV1 {
  private readonly cache = new Map<
    string,
    Promise<PressureGameDecisionProjectionV1>
  >();

  constructor(
    private readonly provider: PressureTurnPresentationProviderPortV1 | null,
  ) {}

  async present(
    input: Readonly<PressureTurnPresentationInputV1>,
  ): Promise<PressureGameDecisionProjectionV1> {
    const startedAt = performance.now();
    const timings = emptyTurnPresentationStageTimings();
    let status: PressureTurnPresentationTimingStatusV1 = "PRESENTATION_FAILURE";
    let contextHash: string | null = null;
    try {
      const fallbackStartedAt = performance.now();
      const fallback = fallbackTurnPresentation(input);
      timings.fallbackBuildMs = elapsedTurnPresentationMs(fallbackStartedAt);
      if (!this.provider) {
        status = "FALLBACK_NO_PROVIDER";
        return fallback;
      }
      if (input.decision.options.length === 0) {
        status = "FALLBACK_NO_OPTIONS";
        return fallback;
      }
      const contextStartedAt = performance.now();
      const context = compilePressureTurnPresentationContextV1(input);
      timings.contextCompileMs = elapsedTurnPresentationMs(contextStartedAt);
      contextHash = context.contextHash;
      const cached = this.cache.get(context.contextHash);
      if (cached) {
        const cacheStartedAt = performance.now();
        try {
          const result = structuredClone(await cached);
          timings.resultCloneMs = elapsedTurnPresentationMs(cacheStartedAt);
          status = "CACHE_HIT";
          return result;
        } catch {
          this.cache.delete(context.contextHash);
          status = "CACHE_REJECTED_FALLBACK";
          return fallback;
        } finally {
          timings.cacheWaitMs = elapsedTurnPresentationMs(cacheStartedAt);
        }
      }
      const generationOutcome: {
        status: "PROVIDER_SUCCESS" | "PROVIDER_FALLBACK";
      } = { status: "PROVIDER_FALLBACK" };
      const pending = this.generate(
        context,
        fallback,
        timings,
        generationOutcome,
      );
      this.cache.set(context.contextHash, pending);
      try {
        const generated = await pending;
        const cloneStartedAt = performance.now();
        const result = structuredClone(generated);
        timings.resultCloneMs = elapsedTurnPresentationMs(cloneStartedAt);
        status = generationOutcome.status;
        return result;
      } catch {
        this.cache.delete(context.contextHash);
        status = "PROVIDER_FALLBACK";
        return fallback;
      }
    } finally {
      logPressureTurnPresentationTimingV1({
        chapterId: input.chapter.chapterId,
        chapterRuntimeId: input.chapter.chapterRuntimeId,
        decisionPointId: input.decision.decisionPointId,
        viewerSeatId: input.viewer.seatId,
        contextHash,
        status,
        totalMs: elapsedTurnPresentationMs(startedAt),
        timings,
      });
    }
  }

  private async generate(
    context: PressureTurnPresentationContextV1,
    fallback: PressureGameDecisionProjectionV1,
    timings: PressureTurnPresentationStageTimingsV1,
    outcome: { status: "PROVIDER_SUCCESS" | "PROVIDER_FALLBACK" },
  ): Promise<PressureGameDecisionProjectionV1> {
    try {
      const providerStartedAt = performance.now();
      let raw: unknown;
      try {
        raw = await this.provider!.renderTurnPresentation(
          structuredClone(context),
        );
      } finally {
        timings.providerMs = elapsedTurnPresentationMs(providerStartedAt);
      }
      const validationStartedAt = performance.now();
      let candidate: PressureTurnPresentationCandidateV1;
      try {
        candidate = validatePressureTurnPresentationCandidateV1(
          raw,
          context,
        );
      } finally {
        timings.validationMs = elapsedTurnPresentationMs(validationStartedAt);
      }
      const mappingStartedAt = performance.now();
      let result: PressureGameDecisionProjectionV1;
      try {
        const generatedByAction = new Map(
          candidate.options.map((option) => [option.actionType, option]),
        );
        result = {
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
      } finally {
        timings.optionMappingMs = elapsedTurnPresentationMs(mappingStartedAt);
      }
      outcome.status = "PROVIDER_SUCCESS";
      return result;
    } catch (error) {
      outcome.status = "PROVIDER_FALLBACK";
      console.warn(JSON.stringify({
        event: "PRESSURE_TURN_PRESENTATION_FALLBACK",
        contextHash: context.contextHash,
        chapterId: context.chapter.chapterId,
        decisionPointId: context.decisionPointId,
        reason: error instanceof Error ? error.message : "UNKNOWN",
      }));
      return structuredClone(fallback);
    }
  }
}

function emptyTurnPresentationStageTimings(): PressureTurnPresentationStageTimingsV1 {
  return {
    fallbackBuildMs: 0,
    genesisStorySourceMs: 0,
    contextCompileMs: 0,
    cacheWaitMs: 0,
    providerMs: 0,
    validationMs: 0,
    optionMappingMs: 0,
    resultCloneMs: 0,
  };
}

function logPressureTurnPresentationTimingV1(input: Readonly<{
  chapterId: string;
  chapterRuntimeId: string;
  decisionPointId: string;
  viewerSeatId: string;
  contextHash: string | null;
  status: PressureTurnPresentationTimingStatusV1;
  totalMs: number;
  timings: PressureTurnPresentationStageTimingsV1;
}>): void {
  try {
    console.error("Pressure turn presentation timing", JSON.stringify(input));
  } catch {
    // Observability must not change the presentation response.
  }
}

function elapsedTurnPresentationMs(startedAt: number): number {
  return Math.max(0, performance.now() - startedAt);
}

function fallbackTurnPresentation(
  input: Readonly<PressureTurnPresentationInputV1>,
): PressureGameDecisionProjectionV1 {
  const fallback = structuredClone(input.decision);
  const publishedNarrative = String(input.narrative.text ?? "").trim();
  if (!isOpeningDecisionV1(input)) {
    // decision.summary is internal pressure guidance for the Provider. It is
    // never safe player copy when a continuation Narrative is unavailable.
    fallback.title = "你准备如何应对？";
    const storySource = loadSangtianPressureStorySourceV1(
      input.chapter.chapterId,
      input.viewer.seatId,
    );
    const beatFallback = input.currentBeatStory
      ? compileBeatSceneGuidanceV1(input.currentBeatStory).text
      : storySource.currentScene.postBeatFrame.text;
    const continuityFallback = input.narrative.projectionKind === "GENESIS_NARRATIVE"
      ? beatFallback
      : publishedNarrative || beatFallback;
    fallback.summary = input.previousPlayerAction
      ? [
          input.previousPlayerAction.displayText,
          input.previousPlayerAction.effectText,
          continuityFallback,
        ].map((item) => item.trim()).filter(Boolean).join("\n\n")
      : continuityFallback;
    return fallback;
  }
  if (publishedNarrative) {
    fallback.summary = publishedNarrative;
  }
  return fallback;
}

export function compilePressureTurnPresentationContextV1(
  input: Readonly<PressureTurnPresentationInputV1>,
): PressureTurnPresentationContextV1 {
  if (input.chapter.chapterId === "P0") {
    throw new Error("PRESSURE_DECISION_PRESENTATION_P0_FORBIDDEN");
  }
  const storySource = loadSangtianPressureStorySourceV1(
    input.chapter.chapterId,
    input.viewer.seatId,
  );
  const openingDecision = isOpeningDecisionV1(input);
  const continuationScene = input.currentBeatStory
    ? compileBeatSceneGuidanceV1(input.currentBeatStory)
    : {
        title: storySource.currentScene.postBeatFrame.title,
        text: storySource.currentScene.postBeatFrame.text,
      };
  const continuityText = openingDecision
    ? input.narrative.text?.trim() || storySource.currentScene.text.trim()
    : input.narrative.projectionKind !== "GENESIS_NARRATIVE"
      ? input.narrative.text?.trim() || continuationScene.text.trim()
      : continuationScene.text.trim();
  if (!continuityText) {
    throw new Error("PRESSURE_DECISION_PRESENTATION_CONTINUITY_REQUIRED");
  }
  const continuityExcerpt = decisionContinuityExcerpt(continuityText);
  const authorityDraft = compilePressureTurnAuthorityDraftV1(input);
  const base = {
    schemaVersion: "pressure_turn_presentation_context_v1" as const,
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
    currentScene: openingDecision
      ? {
          phase: "OPENING" as const,
          title: storySource.currentScene.title,
          text: storySource.currentScene.text,
        }
      : {
          phase: "CONTINUATION" as const,
          title: continuationScene.title,
          text: continuationScene.text,
        },
    situation: structuredClone(input.situation),
    metrics: structuredClone(input.metrics),
    resources: structuredClone(input.resources),
    authorityDraft,
    previousNarrative: {
      projectionKind: input.narrative.projectionKind,
      sourceId: input.narrative.sourceId,
      sourceCommitHash: input.narrative.sourceCommitHash,
      text: continuityText,
      authority: "CONTINUITY_ONLY" as const,
    },
    pressureGuidance: input.decision.summary,
    previousPlayerAction: input.previousPlayerAction
      ? {
          ...structuredClone(input.previousPlayerAction),
          authority: "WORKING_LEDGER_ACCEPTED_ACTION" as const,
        }
      : null,
    authorialGuidance: input.currentBeatStory
      ? {
          beatId: input.currentBeatStory.beatId,
          title: input.currentBeatStory.title,
          storyPurpose: input.currentBeatStory.storyPurpose,
          materials: structuredClone(input.currentBeatStory.authorialMaterials),
          authority: "AUTHORIAL_GUIDANCE_ONLY" as const,
        }
      : null,
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
      legalActionsAreNotCompletedResults: true as const,
      authorialGuidanceIsNotAuthority: true as const,
      durableStateSources: ["TURN_AUTHORITY_DRAFT", "VIEWER_ACCEPTED_ACTION"] as const,
      forbiddenInferences: [
        "身份背景中的长期压力不等于当前现场已经发生对应事件。",
        "合法行动方向不等于执行该行动所需人物、物件或证据已经出现在现场。",
        "压力正在上升不等于灾害、伤亡、抓捕、冲突或其他结果已经发生。",
        "上一段剧情中的临时文学细节不等于下一轮权威事实，也不能生成新的效果或代价。",
      ],
    },
    continuityExcerpt,
    outputExample: {
      sceneText: openingDecision
        ? storySource.currentScene.text
        : continuityExcerpt,
      question: "由现场最后一个压力自然逼出的具体问题？",
      options: input.decision.options.map((option) => ({
        actionType: option.actionType,
        label: option.label,
        description: `自然改写“${option.description}”并说明直接目的；realTradeoff为null时不补写代价或其他选项。`,
      })),
    },
    outputRequirements: PRESSURE_TURN_OUTPUT_REQUIREMENTS_V1,
    instruction: [
      "一次完成当前玩家可见的连续中文文学剧情，以及紧接着的决策表达。",
      ...(input.previousPlayerAction
        ? [
            `首先自然表现玩家上一行动“${input.previousPlayerAction.displayText}”已经发生，并表现其权威效果“${input.previousPlayerAction.effectText}”，再承接当前状态。`,
            ...(input.previousPlayerAction.actionType === "DEFAULT_PASS"
              ? ["这是一次明确的不行动：必须让当前作者材料中已经出现的人物通过催促、等待落空、不满、留下记录或接管事务作出即时可见反应；不得把玩家写成已经履职，也不得凭空新增持久关系、数值或惩罚。"]
              : []),
          ]
        : []),
      ...(input.currentBeatStory
        ? ["使用本轮作者材料塑造场景和人物冲突；supportedByAuthority=false的材料只能作为未决压力或备选冲突，不得写成已经发生的结果。"]
        : []),
      "先写完整场景，再由场景末尾的具体压力自然逼出问题。",
      "逐一改写已有合法行动，不新增行动，不替玩家执行行动，不宣告行动结果。",
      "每个选项都必须使用当前viewer对应角色的身份、权限和dialogueExamples语气，写成他在现场会说出的命令、表态或内心决断；不得写成流程说明或功能目录。",
      "临时文学细节只服务本轮阅读，不得升级成claims或下一轮权威状态。",
    ].join(" "),
  };
  return {
    ...base,
    contextHash: sha256Canonical(base),
  };
}

function compileBeatSceneGuidanceV1(
  story: NonNullable<PressureTurnPresentationInputV1["currentBeatStory"]>,
): { title: string; text: string } {
  const parts = [
    story.storyPurpose,
    ...story.authorialMaterials
      .filter((material) => material.supportedByAuthority)
      .map((material) => material.text),
  ].map((item) => item.trim()).filter(Boolean);
  const text = parts.join("\n\n");
  return {
    title: story.title,
    text: [...text].slice(0, 6_000).join("") || story.storyPurpose,
  };
}

function isOpeningDecisionV1(
  input: Readonly<Pick<
    PressureTurnPresentationInputV1,
    "narrative" | "previousPlayerAction"
  >>,
): boolean {
  return input.narrative.projectionKind === "GENESIS_NARRATIVE"
    && !input.previousPlayerAction;
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

export function validatePressureTurnPresentationCandidateV1(
  value: unknown,
  context: Readonly<PressureTurnPresentationContextV1>,
): PressureTurnPresentationCandidateV1 {
  const candidate = plainObject(value, "candidate");
  exactKeys(
    candidate,
    ["sceneText", "question", "options", "usedFactRefs", "claims"],
    "candidate",
  );
  const sceneText = boundedText(candidate.sceneText, "candidate.sceneText", 180, 1_200);
  const question = normalizePlayerQuestion(candidate.question);
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
  if (!Array.isArray(candidate.usedFactRefs)) {
    throw new Error("PRESSURE_TURN_PRESENTATION_FACT_REFS");
  }
  const allowedFactRefs = new Set(
    context.authorityDraft.currentAuthorityState.map((fact) => fact.factId),
  );
  const usedFactRefs = candidate.usedFactRefs.map((value, index) => {
    const factRef = boundedText(value, `candidate.usedFactRefs[${index}]`, 1, 160);
    if (!allowedFactRefs.has(factRef)) {
      throw new Error("PRESSURE_TURN_PRESENTATION_UNKNOWN_FACT_REF");
    }
    return factRef;
  });
  if (new Set(usedFactRefs).size !== usedFactRefs.length) {
    throw new Error("PRESSURE_TURN_PRESENTATION_DUPLICATE_FACT_REF");
  }
  if (context.previousPlayerAction) {
    for (const requiredFactRef of ["player.previousAction", "player.previousActionEffect"]) {
      if (!usedFactRefs.includes(requiredFactRef)) {
        throw new Error(`PRESSURE_TURN_PRESENTATION_PREVIOUS_ACTION_MISSING:${requiredFactRef}`);
      }
    }
  }
  if (!Array.isArray(candidate.claims) || candidate.claims.length !== 0) {
    throw new Error("PRESSURE_TURN_PRESENTATION_CLAIMS_FORBIDDEN");
  }
  return { sceneText, question, options, usedFactRefs, claims: [] };
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

/**
 * Question length is presentation-only. A modest Provider overrun must not
 * discard an otherwise valid literary scene and action binding.
 */
function normalizePlayerQuestion(value: unknown): string {
  const text = boundedText(
    value,
    "candidate.question",
    4,
    QUESTION_PROVIDER_HARD_MAX,
  );
  const characters = [...text];
  if (characters.length <= QUESTION_DISPLAY_MAX) return text;
  const prefix = characters
    .slice(0, QUESTION_DISPLAY_MAX - 1)
    .join("")
    .replace(/[，、；：。！？?\s]+$/u, "");
  return `${prefix || characters.slice(0, QUESTION_DISPLAY_MAX - 1).join("")}？`;
}
