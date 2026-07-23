import { containsUnauthorizedPartOneDiscovery } from "./part-one-prose-guard";
import { inspectPlayerFacingNarrative } from "./player-facing-narrative-guard";
import type {
  CompiledStoryContext,
  StoryDecisionCopyOutput,
  StoryNarratorDraft,
  StoryTurnModelOutput,
  StoryTurnPublishedOutput,
  StoryTurnValidatedOutput,
  ValidationIssue
} from "./types";

type ValidationResponse =
  | { ok: true; output: StoryTurnValidatedOutput; issues: ValidationIssue[] }
  | { ok: false; issues: ValidationIssue[] };

export function validateNarratorDraft(
  draft: StoryNarratorDraft,
  context: CompiledStoryContext
): { ok: true; issues: [] } | { ok: false; issues: ValidationIssue[] } {
  const issues: ValidationIssue[] = [];
  const runtime = context.sections.partOneRuntime.items[0] || null;
  const event = context.sections.partOneSettlement.items[0] || null;
  const prose = draft.rawProse;

  if (`${draft.resultNarrative}\n\n${draft.nextSituationNarrative}` !== prose) {
    issues.push({
      code: "NARRATIVE_IMMUTABILITY_BROKEN",
      message: "拆分后的玩家正文与 Narrator 原文不完全一致。"
    });
  }
  if (/<\/?[a-z][^>]*>|^#{1,6}\s|^\s*[-*]\s/m.test(prose)) {
    issues.push({
      code: "NARRATIVE_FORMAT_NOT_PROSE",
      message: "Narrator 返回了界面标记、标题或列表，而不是纯小说正文。"
    });
  }

  const playerFacingIssues = inspectPlayerFacingNarrative({
    text: prose,
    forbiddenFlattening: (runtime?.narrativeScenePatterns || []).flatMap((asset) =>
      Array.isArray(asset.payload.forbiddenFlattening)
        ? asset.payload.forbiddenFlattening.map(String)
        : []
    ),
    requireSceneMotion: true
  });
  for (const issue of playerFacingIssues) {
    issues.push({ code: issue.code, message: issue.detail });
  }

  if (runtime) {
    const count = [...prose.replace(/\s/g, "")].length;
    const { minCharacters, maxCharacters } = runtime.styleProfile.narrativeBudget;
    if (count < minCharacters || count > maxCharacters) {
      issues.push({
        code: "NARRATIVE_STYLE_BUDGET_VIOLATION",
        message: `正文长度 ${count} 不在 ${minCharacters}—${maxCharacters} 字范围内。`
      });
    }
    const forbidden = [
      ...runtime.styleProfile.forbiddenModernPhrases,
      ...runtime.styleProfile.forbiddenSystemPhrases,
      ...runtime.styleProfile.forbiddenAiSummaryPatterns
    ].find((phrase) => phrase && prose.includes(phrase));
    if (forbidden) {
      issues.push({
        code: "NARRATIVE_FORBIDDEN_STYLE_PHRASE",
        message: `正文出现禁用表达：${forbidden}`
      });
    }
    const reveal = runtime.forbiddenEarlyReveals.find((phrase) => phrase && prose.includes(phrase));
    if (reveal) {
      issues.push({
        code: "FORBIDDEN_EARLY_REVEAL",
        message: `正文提前确认了本节禁止揭晓的事实：${reveal}`
      });
    }
  }

  const recentCanon = context.sections.recentCanon.items.map((entry) => entry.narrative).join("\n");
  if (recentCanon) {
    const repeated = proseSentences(prose).find((sentence) =>
      fingerprint(sentence).length >= 18 && fingerprint(recentCanon).includes(fingerprint(sentence))
    );
    if (repeated) {
      issues.push({
        code: "RECENT_CANON_REPLAYED",
        message: `正文复写了已经发生的句子：${repeated}`
      });
    }
  }

  const authoritativeCorpus = [
    context.actionResolution.actionStarted,
    context.actionResolution.summary,
    ...context.actionResolution.immediateObservableResult,
    ...context.sections.roleKnowledge.items.map((fact) => fact.content),
    ...context.sections.relevantScriptCards.items.map((card) => `${card.title} ${card.summary}`),
    ...(event?.authoritativeObservableFacts || []),
    ...(event?.authoritativeNpcReactions.map((reaction) => reaction.action) || []),
    runtime?.nextDecisionPressure?.summary || ""
  ].join("\n");
  if (runtime) {
    for (const sentence of proseSentences(prose)) {
      if (containsUnauthorizedPartOneDiscovery(sentence, authoritativeCorpus)) {
        issues.push({
          code: "UNSUPPORTED_PART_ONE_DISCOVERY",
          message: `正文出现本轮工作集未授权的新发现：${sentence}`
        });
        break;
      }
    }
  }
  if (runtime) {
    const inventedQuantity = prose.match(
      /(?:又|再|已|共|只剩|多出|增加|减少|上涨|下跌)[^。！？\n]{0,10}(?:\d+|[一二三四五六七八九十百千万两半]+)(?:成|分|册|份|人|日|时辰|石|担|亩|里)/
    )?.[0];
    if (inventedQuantity && !authoritativeCorpus.includes(inventedQuantity)) {
      issues.push({
        code: "UNSUPPORTED_PART_ONE_QUANTITY",
        message: `正文新增了未结算的数字或期限：${inventedQuantity}`
      });
    }
  }

  if (event) {
    const requiredBeats = [
      { label: "玩家行动", text: event.actionText, threshold: 0.16 },
      ...event.authoritativeNpcReactions.map((reaction) => ({
        label: "NPC 回应",
        text: reaction.action,
        threshold: 0.13
      }))
    ];
    for (const beat of requiredBeats) {
      if (beat.text && ngramCoverage(beat.text, prose) < beat.threshold) {
        issues.push({
          code: "COMMITTED_EVENT_NOT_RENDERED",
          message: `${beat.label}没有在正文中得到可辨认的场景化呈现：${beat.text}`
        });
      }
    }
  }

  const duplicate = duplicateCurrentSentence(prose);
  if (duplicate) {
    issues.push({
      code: "CURRENT_TURN_REPETITION",
      message: `同一回合重复写了同一句内容：${duplicate}`
    });
  }
  return issues.length ? { ok: false, issues } : { ok: true, issues: [] };
}

export function validateDecisionCopy(
  output: StoryDecisionCopyOutput,
  context: CompiledStoryContext
): { ok: true; issues: [] } | { ok: false; issues: ValidationIssue[] } {
  const issues: ValidationIssue[] = [];
  const runtime = context.sections.partOneRuntime.items[0] || null;
  const legalRouteKeys = runtime
    ? runtime.decisionAffordances.map((route) => route.affordanceTemplateId)
    : context.availableTargets.slice(0, 2)
      .map((target, index) => `target:${target.type}:${target.id}:${index + 1}`);
  const returnedKeys = output.decisions.map((decision) => decision.routeKey);
  if (
    output.decisions.length !== 2
    || new Set(returnedKeys).size !== 2
    || returnedKeys.some((key) => !legalRouteKeys.includes(key))
  ) {
    issues.push({
      code: "DECISION_ROUTE_SET_INVALID",
      message: "Decision 阶段没有逐一使用本轮两条合法行动路线。"
    });
  }
  const normalizedDescriptions = output.decisions.map((decision) => fingerprint(decision.description));
  if (new Set(normalizedDescriptions).size !== normalizedDescriptions.length) {
    issues.push({ code: "DECISION_DESCRIPTIONS_DUPLICATED", message: "两条玩家行动的实际含义重复。" });
  }
  for (const decision of output.decisions) {
    const generic = decision.description.match(
      /推进方案|协调资源|纳入控制|说明代价|争取支持|谨慎处理|妥善处置|视情况|综合考虑|权衡利弊/
    )?.[0];
    if (generic) {
      issues.push({
        code: "DECISION_DESCRIPTION_GENERIC",
        message: `玩家行动仍是抽象方案语言：${generic}`
      });
    }
    const analysis = decision.description.match(
      /(?:代价|风险|好处|坏处|可能导致|这样可以|这样能够|以便确保|从而保证)[：:]?/
    )?.[0];
    if (analysis) {
      issues.push({
        code: "DECISION_DESCRIPTION_CONTAINS_ANALYSIS",
        message: `前端行动文字混入了后台分析：${analysis}`
      });
    }
  }
  return issues.length ? { ok: false, issues } : { ok: true, issues: [] };
}

/**
 * Final structural publication gate. At this point prose has already passed
 * validateNarratorDraft and all hidden fields were deterministically bound.
 */
export function validateStoryTurnOutput(
  output: StoryTurnModelOutput,
  context: CompiledStoryContext
): ValidationResponse {
  const issues: ValidationIssue[] = [];
  if (output?.schemaVersion !== "solo-story-turn-v1" || output?.resultType !== "PUBLISHED_TURN") {
    return {
      ok: false,
      issues: [{ code: "OUTPUT_ENVELOPE_INVALID", message: "发布结果协议不正确。" }]
    };
  }

  requireText(output.story?.title, "STORY_TITLE_REQUIRED", issues);
  requireText(output.story?.resultNarrative, "RESULT_NARRATIVE_REQUIRED", issues);
  requireText(output.story?.nextSituationNarrative, "NEXT_SITUATION_REQUIRED", issues);
  if (output.resolution?.confirmedResolutionId !== context.actionResolution.resolutionId) {
    issues.push({ code: "RESOLUTION_ID_MISMATCH", message: "结算 ID 与本轮输入不一致。" });
  }
  requireText(output.resolution?.observableOutcome, "OBSERVABLE_OUTCOME_REQUIRED", issues);
  requireText(output.endingState?.timeLabel, "ENDING_TIME_REQUIRED", issues);
  requireText(output.endingState?.locationLabel, "ENDING_LOCATION_REQUIRED", issues);
  requireText(output.endingState?.tension, "ENDING_TENSION_REQUIRED", issues);
  requireArray(output.endingState?.presentEntityRefs, "PRESENT_ENTITY_REFS_REQUIRED", issues);
  requireArray(output.endingState?.visibleChanges, "VISIBLE_CHANGES_REQUIRED", issues);
  requireArray(output.endingState?.surfacedConsequenceIds, "SURFACED_CONSEQUENCES_REQUIRED", issues);

  const decisions = Array.isArray(output.decisions) ? output.decisions : [];
  if (decisions.length !== 2) {
    issues.push({ code: "DECISION_COUNT_INVALID", message: "发布结果必须恰好包含两项决策。" });
  }
  const runtime = context.sections.partOneRuntime.items[0] || null;
  for (const decision of decisions) {
    requireText(decision.decisionId, "DECISION_ID_REQUIRED", issues);
    requireText(decision.description, "DECISION_DESCRIPTION_REQUIRED", issues);
    const target = context.availableTargets.find((candidate) =>
      candidate.id === decision.targetRef?.id
      && candidate.type === decision.targetRef?.type
      && candidate.label === decision.targetRef?.label
    );
    if (!target) {
      issues.push({ code: "DECISION_TARGET_UNKNOWN", message: "决策目标不在当前合法对象中。" });
    }
    if (runtime) {
      const basis = runtime.decisionAffordances.find((route) =>
        route.affordanceTemplateId === decision.affordanceTemplateId
      );
      if (!basis || decision.decisionKernelId !== runtime.openDecisionKernel.assetId) {
        issues.push({
          code: "DECISION_NOT_BOUND_TO_OPEN_KERNEL",
          message: "决策没有绑定到当前开放内核。"
        });
      }
    }
  }
  if (
    runtime
    && new Set(decisions.map((decision) => decision.affordanceTemplateId)).size !== decisions.length
  ) {
    issues.push({ code: "DECISION_AFFORDANCE_DUPLICATED", message: "两项决策绑定了同一条路线。" });
  }

  validateAllowedArray(
    output.endingState.presentEntityRefs,
    context.allowedReferences.entityRefs,
    "ENTITY_REF_UNKNOWN",
    issues
  );
  validateAllowedArray(
    output.endingState.surfacedConsequenceIds,
    context.allowedReferences.pendingConsequenceIds,
    "CONSEQUENCE_ID_UNKNOWN",
    issues
  );
  validateGrounding(output, context, issues);

  return issues.length
    ? { ok: false, issues }
    : { ok: true, output: output as StoryTurnValidatedOutput, issues: [] };
}

function validateGrounding(
  output: StoryTurnPublishedOutput,
  context: CompiledStoryContext,
  issues: ValidationIssue[]
) {
  validateAllowedArray(output.grounding.usedScriptSourceIds, context.allowedReferences.scriptSourceIds, "SCRIPT_SOURCE_ID_UNKNOWN", issues);
  validateAllowedArray(output.grounding.usedStoryCardIds, context.allowedReferences.storyCardIds, "STORY_CARD_ID_UNKNOWN", issues);
  validateAllowedArray(output.grounding.usedCanonFactIds, context.allowedReferences.canonFactIds, "CANON_FACT_ID_UNKNOWN", issues);
  validateAllowedArray(output.grounding.advancedMainlineQuestionIds, context.allowedReferences.mainlineQuestionIds, "MAINLINE_QUESTION_ID_UNKNOWN", issues);
  validateAllowedArray(output.grounding.paidPendingConsequenceIds, context.allowedReferences.pendingConsequenceIds, "PAID_CONSEQUENCE_ID_UNKNOWN", issues);
  if (
    output.grounding.stagedDirectedBeatId
    && !context.allowedReferences.directedBeatIds.includes(output.grounding.stagedDirectedBeatId)
  ) {
    issues.push({ code: "DIRECTED_BEAT_ID_UNKNOWN", message: "发布结果引用了未知的外部推进。" });
  }
}

function ngramCoverage(source: string, target: string) {
  const sourceNgrams = new Set(ngrams(fingerprint(source), 2));
  const targetNgrams = new Set(ngrams(fingerprint(target), 2));
  if (!sourceNgrams.size) return 1;
  let shared = 0;
  for (const gram of sourceNgrams) if (targetNgrams.has(gram)) shared += 1;
  return shared / sourceNgrams.size;
}

function ngrams(text: string, size: number) {
  if (text.length <= size) return text ? [text] : [];
  return Array.from({ length: text.length - size + 1 }, (_, index) => text.slice(index, index + size));
}

function duplicateCurrentSentence(prose: string) {
  const seen = new Set<string>();
  for (const sentence of proseSentences(prose)) {
    const key = fingerprint(sentence);
    if (key.length < 18) continue;
    if (seen.has(key)) return sentence;
    seen.add(key);
  }
  return null;
}

function proseSentences(value: string) {
  return String(value || "")
    .split(/(?<=[。！？])/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

function fingerprint(value: string) {
  return String(value || "").replace(/[\s，。；：、“”‘’！？、—…]/g, "");
}

function requireText(value: unknown, code: string, issues: ValidationIssue[]) {
  if (typeof value !== "string" || !value.trim()) issues.push({ code, message: code });
}

function requireArray(value: unknown, code: string, issues: ValidationIssue[]) {
  if (!Array.isArray(value)) issues.push({ code, message: code });
}

function validateAllowedArray(
  value: unknown,
  allowed: string[],
  code: string,
  issues: ValidationIssue[]
) {
  if (!Array.isArray(value)) {
    issues.push({ code: `${code}_ARRAY_REQUIRED`, message: `${code}_ARRAY_REQUIRED` });
    return;
  }
  const allowedSet = new Set(allowed);
  const unknown = value.find((item) => typeof item !== "string" || !allowedSet.has(item));
  if (unknown !== undefined) issues.push({ code, message: `${code}:${String(unknown)}` });
}
