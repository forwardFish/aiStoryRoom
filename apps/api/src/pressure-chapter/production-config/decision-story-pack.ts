import type { NarrativeContextV1 } from "@apps/openovel-runtime/pressure-narrative/contracts";
import { loadSangtianPressureStorySourceV1 } from "@ai-story/templates";
import { sha256Canonical } from "@ai-story/shared";
import {
  PRESSURE_SIMULATION_PROMPT_TEMPLATE_V1,
  PRESSURE_STORY_OUTPUT_REQUIREMENTS_V1,
  assertPressurePromptLayerContractV1,
} from "./pressure-prompt-layers";

export const ENABLED_PRESSURE_STORY_PACK_CHAPTERS_V1 = Object.freeze(new Set(["N1"]));

export type PressureDecisionStoryPackV1 = Readonly<{
  schemaVersion: "pressure_decision_story_pack_v1";
  chapterId: string;
  promptTemplate: typeof PRESSURE_SIMULATION_PROMPT_TEMPLATE_V1;
  worldAndStyle: ReturnType<typeof loadSangtianPressureStorySourceV1>["worldAndStyle"];
  playerIdentity: ReturnType<typeof loadSangtianPressureStorySourceV1>["playerIdentity"];
  characterRules: Omit<
    ReturnType<typeof loadSangtianPressureStorySourceV1>["characterRules"],
    "dialogueSeeds"
  >;
  openingSetting: Readonly<{
    title: string;
    sceneFrame: readonly string[];
  }>;
  dialogueExamples: readonly string[];
  currentState: Readonly<{
    settledResult: readonly string[];
    visibleOtherSeatActions: readonly string[];
  }>;
  previousNarrative: Readonly<{
    source: "AUTHORED_CURRENT_SCENE_CONTINUITY";
    text: string;
    authority: "CONTINUITY_ONLY";
  }>;
  creativeLicense: Readonly<{
    allowed: readonly string[];
    forbidden: readonly string[];
  }>;
  playerAction: Readonly<{
    sealedActionSummary: string;
    ruleBindingIsNotNarrative: true;
  }>;
  playerInput: string | null;
  unresolvedPressure: readonly string[];
  nextDirection: string;
  outputRequirements: typeof PRESSURE_STORY_OUTPUT_REQUIREMENTS_V1;
  requiredClaims: readonly Readonly<NarrativeContextV1["allowedClaims"][number]>[];
}>;

/**
 * Chapter-neutral Provider compiler. The explicit enable gate keeps the new
 * path on N1 until player acceptance; input is already audience-safe.
 */
export function compilePressureDecisionStoryPackV1(
  context: NarrativeContextV1,
): PressureDecisionStoryPackV1 | null {
  if (context.projectionKind !== "BEAT_NARRATIVE"
    || context.variant.kind !== "BEAT"
    || !ENABLED_PRESSURE_STORY_PACK_CHAPTERS_V1.has(context.variant.chapterId)
    || context.audience.kind !== "SEAT"
    || context.audience.seatId == null) return null;

  const chapterId = context.variant.chapterId;
  const source = loadSangtianPressureStorySourceV1(chapterId, context.audience.seatId);
  const ownAction = oneFact(context, `story.player_action.${context.audience.seatId}`);
  const visibleActions = context.facts
    .filter((fact) => fact.factId.startsWith("story.visible_action."))
    .filter((fact) => fact.factId !== `story.visible_action.${context.audience.seatId}`)
    .map((fact) => fact.text);
  const pack: PressureDecisionStoryPackV1 = Object.freeze({
    schemaVersion: "pressure_decision_story_pack_v1",
    chapterId,
    promptTemplate: PRESSURE_SIMULATION_PROMPT_TEMPLATE_V1,
    worldAndStyle: source.worldAndStyle,
    playerIdentity: source.playerIdentity,
    characterRules: Object.freeze({
      privatePressure: source.characterRules.privatePressure,
      ruleHint: source.characterRules.ruleHint,
    }),
    openingSetting: Object.freeze({
      title: source.currentScene.postBeatFrame.title,
      sceneFrame: Object.freeze([source.currentScene.postBeatFrame.text]),
    }),
    dialogueExamples: source.characterRules.dialogueSeeds,
    currentState: Object.freeze({
      settledResult: Object.freeze(factsWithPrefix(context, "story.result.")),
      visibleOtherSeatActions: Object.freeze(visibleActions),
    }),
    previousNarrative: Object.freeze({
      source: "AUTHORED_CURRENT_SCENE_CONTINUITY" as const,
      text: source.currentScene.text,
      authority: "CONTINUITY_ONLY" as const,
    }),
    creativeLicense: Object.freeze({
      allowed: Object.freeze([
        "已出现人物的动作、停顿、神情、语气与不改变持久状态的对白",
        "灯影、脚步、衣袖、雨声、普通纸张、无名路人等不改变持久状态的场景纹理",
        "不影响结算的相对时间过渡，以及已授权行动所需的普通工具、物资与执行动作",
        "把playerAction与currentState改写成可见行动、追问、回答和人物反应",
      ]),
      forbidden: Object.freeze([
        "新增没有权威支持的灾情或伤亡结果、被跟踪资源增减、证据存在真伪或保管变化",
        "新增玩家未选择的正式命令、承诺、决定、持久关系、责任归属、行动完成或节点推进",
        "把瞬时文学纹理写成后续必须记住的持久人物、物件或状态",
      ]),
    }),
    playerAction: Object.freeze({
      sealedActionSummary: ownAction,
      ruleBindingIsNotNarrative: true as const,
    }),
    playerInput: optionalFact(context, `story.player_input.${context.audience.seatId}`),
    unresolvedPressure: Object.freeze(factsWithPrefix(context, "story.unresolved_pressure.")),
    nextDirection: oneFact(context, "story.next_direction"),
    outputRequirements: PRESSURE_STORY_OUTPUT_REQUIREMENTS_V1,
    requiredClaims: Object.freeze(context.allowedClaims
      .filter((claim) => claim.required)
      .map((claim) => Object.freeze({ ...claim }))),
  });
  assertPressurePromptLayerContractV1(pack);
  assertStoryPackBudgetV1(pack);
  return pack;
}

export type PressureStoryPackLogModeV1 = "off" | "summary" | "full";

export function parsePressureStoryPackLogModeV1(value: string | undefined): PressureStoryPackLogModeV1 {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!normalized || normalized === "0" || normalized === "off") return "off";
  if (normalized === "summary") return "summary";
  if (normalized === "1" || normalized === "full") return "full";
  throw new Error("PRESSURE_DECISION_STORY_PACK_LOG_INVALID");
}

export function pressureStoryPackDiagnosticLogV1(
  pack: PressureDecisionStoryPackV1,
  context: NarrativeContextV1,
  mode: Exclude<PressureStoryPackLogModeV1, "off">,
): string {
  const serializedBytes = utf8Bytes(JSON.stringify(pack));
  const base = {
    event: "PRESSURE_DECISION_STORY_PACK",
    mode,
    chapterId: pack.chapterId,
    viewerSeatId: context.audience.kind === "SEAT" ? context.audience.seatId : null,
    sourceId: context.sourceId,
    sourceContentHash: context.sourceContentHash,
    storyPackHash: sha256Canonical(pack),
    serializedBytes,
    requiredClaimIds: pack.requiredClaims.map((claim) => claim.refId),
    visibleActionCount: pack.currentState.visibleOtherSeatActions.length,
    resultAnchorCount: pack.currentState.settledResult.length,
    sources: {
      promptTemplate: "PRESSURE_SIMULATION_TEMPLATE_V1",
      worldAndStyle: "SANGTIAN_STORY_PACKAGE_AND_PRESSURE_SPINE",
      playerIdentity: "VIEWER_SEAT_AND_ROLE_CATALOG",
      characterRules: `${pack.chapterId}_CHARACTER_RULES`,
      openingSetting: `${pack.chapterId}_SCENE_FLOW_POST_BEAT_FRAME`,
      dialogueExamples: `${pack.chapterId}_CURRENT_VIEWER_DIALOGUE_SEEDS`,
      currentState: "WORKING_DELTA_STATE_AFTER_AND_VIEWER_SAFE_ACTIONS",
      previousNarrative: `${pack.chapterId}_AUTHORED_CURRENT_SCENE_CONTINUITY_ONLY`,
      creativeLicense: "PRESSURE_NARRATIVE_CREATIVE_LICENSE_V1",
      playerAction: "SEALED_ACTION",
      playerInput: "SEALED_ACTION_PAYLOAD_CUSTOM_TEXT",
      unresolvedPressure: "POST_BEAT_FACTS_AND_NEXT_DECISION_PIN",
      nextDirection: "CURRENT_DECISION_CATALOG",
      outputRequirements: "PRESSURE_STORY_OUTPUT_REQUIREMENTS_V1",
    },
  };
  return JSON.stringify(mode === "full" ? { ...base, storyPack: pack } : base);
}

function oneFact(context: NarrativeContextV1, factId: string): string {
  const matches = context.facts.filter((fact) => fact.factId === factId);
  if (matches.length !== 1) throw new Error(`PRESSURE_DECISION_STORY_PACK_INVALID:${factId}:${matches.length}`);
  return matches[0]!.text;
}

function optionalFact(context: NarrativeContextV1, factId: string): string | null {
  const matches = context.facts.filter((fact) => fact.factId === factId);
  if (matches.length > 1) {
    throw new Error(`PRESSURE_DECISION_STORY_PACK_INVALID:${factId}:${matches.length}`);
  }
  return matches[0]?.text ?? null;
}

function factsWithPrefix(context: NarrativeContextV1, prefix: string): string[] {
  return context.facts
    .filter((fact) => fact.factId.startsWith(prefix))
    .sort((left, right) => left.factId.localeCompare(right.factId))
    .map((fact) => fact.text);
}

function assertStoryPackBudgetV1(pack: PressureDecisionStoryPackV1): void {
  const serializedBytes = utf8Bytes(JSON.stringify(pack));
  if (serializedBytes > 8_192) {
    throw new Error(`PRESSURE_DECISION_STORY_PACK_TOO_LARGE:${serializedBytes}`);
  }
  if (pack.requiredClaims.length > 5) {
    throw new Error(`PRESSURE_DECISION_STORY_PACK_TOO_MANY_REQUIRED_CLAIMS:${pack.requiredClaims.length}`);
  }
  const longClaim = pack.requiredClaims.find((claim) => [...claim.statement].length > 32);
  if (longClaim) {
    throw new Error(`PRESSURE_DECISION_STORY_PACK_REQUIRED_CLAIM_TOO_LONG:${longClaim.refId}`);
  }
  if (pack.unresolvedPressure.length > 2) {
    throw new Error(`PRESSURE_DECISION_STORY_PACK_TOO_MANY_PRESSURES:${pack.unresolvedPressure.length}`);
  }
}

function utf8Bytes(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}
