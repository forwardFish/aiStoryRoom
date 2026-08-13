import type { NarrativeContextV1, NarrativeRenderCandidateV1 } from "@apps/openovel-runtime/pressure-narrative/contracts";
import type { PressureDecisionStoryPackV1 } from "./decision-story-pack";

const CLASSIFICATIONS = Object.freeze([
  "TEXTURE_OR_TRANSIENT",
  "SUPPORTED_DURABLE",
  "UNSUPPORTED_DURABLE",
] as const);

type PressureNarrativeUnitClassificationV1 = (typeof CLASSIFICATIONS)[number];

export type PressureNarrativeReviewUnitV1 = Readonly<{
  unitId: string;
  text: string;
}>;

export type PressureNarrativeTruthReviewV1 = Readonly<{
  assessments: readonly Readonly<{
    unitId: string;
    classification: PressureNarrativeUnitClassificationV1;
    supportRefs: readonly string[];
  }>[];
  missingRequiredRefs: readonly string[];
}>;

export function buildPressureNarrativeTruthReviewInstructionV1(): string {
  return [
    "你是互动剧情的Truth Reviewer，不是Narrator，也不负责润色、改写或续写。",
    "只返回一个JSON对象，字段必须且只能是assessments、missingRequiredRefs，不得输出Markdown。",
    "必须按reviewUnits原顺序为每个unitId返回且只返回一项assessment，不能跳过任何叙事单元。",
    "classification只能是TEXTURE_OR_TRANSIENT、SUPPORTED_DURABLE、UNSUPPORTED_DURABLE。",
    "先问：删除该细节后，结算、资源账、灾情、证据状态、责任、关系、行动完成度或节点推进是否改变？如果不改变，通常属于TEXTURE_OR_TRANSIENT且supportRefs必须为空。",
    "人物神情、停顿、手势、灯影、脚步、衣袖、普通纸张、无名路人、环境声响、不产生状态变化的对白、合理的相对时间过渡，以及已授权行动的普通工具、物资、无名执行者和现场过程，都可以是TEXTURE_OR_TRANSIENT。",
    "具体时间、数量、物资名称或人物称谓本身不自动成为持久事实；只有当它们改变期限、被跟踪数量或成本、资源来源或所有权、正式编制、行动效果，或者后续必须据此结算时，才按持久断言审查。",
    "必须审查的持久断言只包括：灾情与伤亡结果；被跟踪资源的获得、消耗或转移；证据的存在、真伪、毁损、封存与保管；正式命令、承诺和玩家决定；责任、因果、关系、秘密；行动是否完成；章节或下一压力是否推进。",
    "持久断言获得authority支持时才是SUPPORTED_DURABLE并填写supportRefs；未获得支持或与authority冲突时是UNSUPPORTED_DURABLE且supportRefs为空。不要因为一个单元含有普通文学纹理，就要求authority逐项支持这些纹理。",
    "抽象结果可以写成不超过该结果层级的可感知反馈：例如‘得到增援’允许描写人员、普通物资和现场施工，但不授权被跟踪数量、成本、来源耗尽、堰口已经稳固或危机解除；‘行动尚未开始’与该行动已经执行相冲突。",
    "storyPack存在时playerAction是已授权玩家行动；storyPack不存在时以authority中的玩家行动事实为准。不得把已获支持的玩家行动误判为越权，但不得替玩家追加另一个正式行动。",
    "逐项检查required claims的语义是否在正文中出现；完全缺失才写入missingRequiredRefs，措辞不同不能算缺失。",
    "previousNarrative和storyPack中的CONTINUITY_ONLY内容只能帮助衔接，不得作为持久断言的supportRef；持久支持只能来自authority。",
    "既不能因为文字流畅就放过无来源的持久状态变化，也不能因为细节没有逐字写在authority里就拒绝不影响结算的文学纹理。",
  ].join("\n");
}

export function buildPressureNarrativeReviewUnitsV1(text: string): readonly PressureNarrativeReviewUnitV1[] {
  const parts = String(text)
    .split(/(?<=[。！？!?；;])|\n+/u)
    .map((item) => item.trim())
    .filter(Boolean);
  return Object.freeze(parts.map((item, index) => Object.freeze({
    unitId: `unit-${String(index + 1).padStart(3, "0")}`,
    text: item,
  })));
}

export function pressureNarrativeTruthReviewPayloadV1(input: Readonly<{
  storyPack: PressureDecisionStoryPackV1 | null;
  authority: NarrativeContextV1;
  candidate: NarrativeRenderCandidateV1;
}>): Readonly<Record<string, unknown>> {
  return Object.freeze({
    storyPack: input.storyPack,
    authority: Object.freeze({
      facts: input.authority.facts,
      objects: input.authority.objects,
      knowledge: input.authority.knowledge,
      allowedClaims: input.authority.allowedClaims,
      temporalInstruction: input.authority.temporalInstruction,
    }),
    requiredClaims: input.authority.allowedClaims.filter((claim) => claim.required),
    reviewUnits: buildPressureNarrativeReviewUnitsV1(input.candidate.text),
  });
}

export function validatePressureNarrativeTruthReviewV1(
  value: unknown,
  units: readonly PressureNarrativeReviewUnitV1[],
  allowedSupportRefs: readonly string[],
  requiredRefs: readonly string[],
): PressureNarrativeTruthReviewV1 {
  const review = plainObject(value, "review");
  exactKeys(review, ["assessments", "missingRequiredRefs"], "review");
  if (!Array.isArray(review.assessments) || !Array.isArray(review.missingRequiredRefs)) {
    throw new Error("PRESSURE_NARRATIVE_TRUTH_REVIEW_INVALID");
  }
  if (review.assessments.length !== units.length) {
    throw new Error("PRESSURE_NARRATIVE_TRUTH_REVIEW_UNIT_COUNT");
  }
  const allowedRefs = new Set(allowedSupportRefs);
  const assessments = review.assessments.map((entry, index) => {
    const item = plainObject(entry, `review.assessments[${index}]`);
    exactKeys(item, ["unitId", "classification", "supportRefs"], `review.assessments[${index}]`);
    const unitId = boundedText(item.unitId, `review.assessments[${index}].unitId`, 1, 80);
    if (unitId !== units[index]?.unitId) {
      throw new Error("PRESSURE_NARRATIVE_TRUTH_REVIEW_UNIT_ORDER");
    }
    const classification = boundedText(item.classification, `review.assessments[${index}].classification`, 1, 80);
    if (!CLASSIFICATIONS.includes(classification as PressureNarrativeUnitClassificationV1)) {
      throw new Error("PRESSURE_NARRATIVE_TRUTH_REVIEW_CLASSIFICATION_INVALID");
    }
    if (!Array.isArray(item.supportRefs)) {
      throw new Error("PRESSURE_NARRATIVE_TRUTH_REVIEW_SUPPORT_REFS_INVALID");
    }
    const supportRefs = item.supportRefs.map((ref, refIndex) => {
      const supportRef = boundedText(ref, `review.assessments[${index}].supportRefs[${refIndex}]`, 1, 200);
      if (!allowedRefs.has(supportRef)) {
        throw new Error("PRESSURE_NARRATIVE_TRUTH_REVIEW_SUPPORT_REF_UNKNOWN");
      }
      return supportRef;
    });
    if (new Set(supportRefs).size !== supportRefs.length) {
      throw new Error("PRESSURE_NARRATIVE_TRUTH_REVIEW_SUPPORT_REF_DUPLICATE");
    }
    if ((classification === "SUPPORTED_DURABLE") !== (supportRefs.length > 0)) {
      throw new Error("PRESSURE_NARRATIVE_TRUTH_REVIEW_SUPPORT_REF_MISMATCH");
    }
    return {
      unitId,
      classification: classification as PressureNarrativeUnitClassificationV1,
      supportRefs: Object.freeze([...supportRefs].sort()),
    };
  });
  const allowedRequiredRefs = new Set(requiredRefs);
  const missingRequiredRefs = review.missingRequiredRefs.map((entry, index) => {
    const ref = boundedText(entry, `review.missingRequiredRefs[${index}]`, 1, 200);
    if (!allowedRequiredRefs.has(ref)) {
      throw new Error("PRESSURE_NARRATIVE_TRUTH_REVIEW_REQUIRED_REF_INVALID");
    }
    return ref;
  });
  if (new Set(missingRequiredRefs).size !== missingRequiredRefs.length) {
    throw new Error("PRESSURE_NARRATIVE_TRUTH_REVIEW_REQUIRED_REF_DUPLICATE");
  }
  return Object.freeze({
    assessments: Object.freeze(assessments.map((item) => Object.freeze(item))),
    missingRequiredRefs: Object.freeze([...missingRequiredRefs].sort()),
  });
}

function plainObject(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`PRESSURE_NARRATIVE_TRUTH_REVIEW_OBJECT:${path}`);
  }
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[], path: string): void {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    throw new Error(`PRESSURE_NARRATIVE_TRUTH_REVIEW_KEYS:${path}`);
  }
}

function boundedText(value: unknown, path: string, minimum: number, maximum: number): string {
  if (typeof value !== "string") throw new Error(`PRESSURE_NARRATIVE_TRUTH_REVIEW_TEXT:${path}`);
  const text = value.trim();
  const length = [...text].length;
  if (length < minimum || length > maximum) {
    throw new Error(`PRESSURE_NARRATIVE_TRUTH_REVIEW_LENGTH:${path}:${length}`);
  }
  return text;
}
