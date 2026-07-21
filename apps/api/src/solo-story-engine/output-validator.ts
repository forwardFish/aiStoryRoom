import type {
  CompiledStoryContext,
  StoryDecision,
  StoryTurnModelOutput,
  StoryTurnPublishedOutput,
  StoryTurnValidatedOutput,
  ValidationIssue
} from "./types";

type ValidationResponse =
  | { ok: true; output: StoryTurnValidatedOutput; issues: ValidationIssue[] }
  | { ok: false; issues: ValidationIssue[] };

/**
 * Publication gate for facts the application can prove without another model.
 * Literary quality, motivation, player-agency nuance and prose style belong in
 * the soft review report and the shared human test, never in keyword regexes.
 */
export function validateStoryTurnOutput(
  output: StoryTurnModelOutput,
  context: CompiledStoryContext
): ValidationResponse {
  const issues: ValidationIssue[] = [];

  if (output?.schemaVersion !== "solo-story-turn-v1") {
    issues.push({ code: "OUTPUT_SCHEMA_VERSION_INVALID", message: "剧情输出协议版本或结果类型不正确。" });
  }
  if (output?.resultType === "ACTION_NEEDS_CLARIFICATION") {
    if (context.triggerType !== "PLAYER_ACTION") {
      issues.push({ code: "OPENING_CANNOT_REQUEST_CLARIFICATION", message: "开场必须发布剧情，不能要求玩家澄清行动。" });
    }
    requireText(output.clarification?.reason, "CLARIFICATION_REASON_REQUIRED", "澄清请求缺少原因。", issues);
    requireText(output.clarification?.question, "CLARIFICATION_QUESTION_REQUIRED", "澄清请求缺少具体问题。", issues);
    const fields = Array.isArray(output.clarification?.ambiguousFields) ? output.clarification.ambiguousFields : [];
    const allowedFields = new Set(["TARGET", "METHOD", "OBJECTIVE", "LEVERAGE"]);
    if (!fields.length || fields.some((field) => !allowedFields.has(field))) {
      issues.push({ code: "CLARIFICATION_FIELDS_INVALID", message: "澄清请求必须指出无法唯一理解的目标、方式、目的或筹码。" });
    }
    return issues.length ? { ok: false, issues } : { ok: true, output, issues: [] };
  }
  if (output?.resultType !== "PUBLISHED_TURN") {
    issues.push({ code: "OUTPUT_RESULT_TYPE_INVALID", message: "剧情输出结果类型不正确。" });
    return { ok: false, issues };
  }
  requireText(output?.story?.title, "STORY_TITLE_REQUIRED", "剧情缺少标题。", issues);
  requireText(output?.story?.resultNarrative, "RESULT_NARRATIVE_REQUIRED", "剧情缺少行动结果正文。", issues);
  requireText(output?.story?.nextSituationNarrative, "NEXT_SITUATION_REQUIRED", "剧情缺少下一局势正文。", issues);

  if (output?.resolution?.confirmedResolutionId !== context.actionResolution.resolutionId) {
    issues.push({ code: "RESOLUTION_ID_MISMATCH", message: "模型返回的确定性结算 ID 与本轮输入不一致。" });
  }
  if (!(["APPLIED", "BLOCKED"] as unknown[]).includes(output?.resolution?.outcome)) {
    issues.push({ code: "RESOLUTION_OUTCOME_INVALID", message: "行动结果必须是 APPLIED 或 BLOCKED。" });
  }
  requireText(output?.resolution?.observableOutcome, "OBSERVABLE_OUTCOME_REQUIRED", "输出缺少玩家可观察到的行动结果。", issues);

  requireText(output?.endingState?.timeLabel, "ENDING_TIME_REQUIRED", "输出缺少当前时间。", issues);
  requireText(output?.endingState?.locationLabel, "ENDING_LOCATION_REQUIRED", "输出缺少当前地点。", issues);
  requireText(output?.endingState?.tension, "ENDING_TENSION_REQUIRED", "输出缺少可继续承接的当前压力。", issues);
  requireArray(output?.endingState?.presentEntityRefs, "PRESENT_ENTITY_REFS_REQUIRED", "endingState 必须提供在场实体引用数组。", issues);
  requireArray(output?.endingState?.visibleChanges, "VISIBLE_CHANGES_REQUIRED", "endingState 必须提供可见变化数组。", issues);
  requireArray(output?.endingState?.surfacedConsequenceIds, "SURFACED_CONSEQUENCES_REQUIRED", "endingState 必须提供已兑现后果数组。", issues);

  validateAllowedArray(output?.endingState?.presentEntityRefs, context.allowedReferences.entityRefs, "ENTITY_REF_UNKNOWN", "在场实体", issues);
  validateAllowedArray(output?.endingState?.surfacedConsequenceIds, context.allowedReferences.pendingConsequenceIds, "CONSEQUENCE_ID_UNKNOWN", "后果", issues);

  const grounding = output?.grounding;
  validateAllowedArray(grounding?.usedScriptSourceIds, context.allowedReferences.scriptSourceIds, "SCRIPT_SOURCE_ID_UNKNOWN", "剧本来源", issues);
  validateAllowedArray(grounding?.usedStoryCardIds, context.allowedReferences.storyCardIds, "STORY_CARD_ID_UNKNOWN", "故事卡", issues);
  validateAllowedArray(grounding?.usedCanonFactIds, context.allowedReferences.canonFactIds, "CANON_FACT_ID_UNKNOWN", "事实", issues);
  validateAllowedArray(grounding?.advancedMainlineQuestionIds, context.allowedReferences.mainlineQuestionIds, "MAINLINE_QUESTION_ID_UNKNOWN", "主线问题", issues);
  validateAllowedArray(grounding?.paidPendingConsequenceIds, context.allowedReferences.pendingConsequenceIds, "PAID_CONSEQUENCE_ID_UNKNOWN", "已兑现后果", issues);
  if (grounding?.stagedDirectedBeatId !== null && grounding?.stagedDirectedBeatId !== undefined && !context.allowedReferences.directedBeatIds.includes(grounding.stagedDirectedBeatId)) {
    issues.push({ code: "DIRECTED_BEAT_ID_UNKNOWN", message: `模型引用了本轮未提供的外部推进：${grounding.stagedDirectedBeatId}` });
  }

  validatePendingConsequences(output, context, issues);

  const decisions = Array.isArray(output?.decisions) ? output.decisions : [];
  if (decisions.length < 2 || decisions.length > 4) {
    issues.push({ code: "DECISION_COUNT_INVALID", message: "下一步决策必须有 2 到 4 项。" });
  }
  const validDecisions = decisions.filter((decision) => validateDecision(decision, context, issues));
  if (validDecisions.length < 2) {
    issues.push({ code: "NOT_ENOUGH_VALID_DECISIONS", message: "删除结构非法的选项后，有效决策少于两项。" });
  }

  if (issues.length) return { ok: false, issues };
  return { ok: true, output: { ...output, decisions: validDecisions }, issues: [] };
}

function validateDecision(
  decision: StoryDecision,
  context: CompiledStoryContext,
  issues: ValidationIssue[]
) {
  const before = issues.length;
  requireText(decision?.decisionId, "DECISION_ID_REQUIRED", "存在缺少 ID 的决策。", issues);
  requireText(decision?.label, "DECISION_LABEL_REQUIRED", "存在缺少可读标题的决策。", issues);
  requireText(decision?.description, "DECISION_DESCRIPTION_REQUIRED", "存在缺少执行说明的决策。", issues);
  requireText(decision?.intent, "DECISION_INTENT_REQUIRED", "存在缺少即时目标的决策。", issues);
  requireText(decision?.method, "DECISION_METHOD_REQUIRED", "存在缺少执行方式的决策。", issues);
  requireText(decision?.distinctAxis, "DECISION_AXIS_REQUIRED", "存在缺少差异方向的决策。", issues);
  requireText(decision?.concreteCost, "DECISION_COST_REQUIRED", "存在缺少真实代价的决策。", issues);
  requireText(decision?.expectedCountermove, "DECISION_COUNTERMOVE_REQUIRED", "存在缺少可能回应的决策。", issues);

  const target = decision?.targetRef;
  const allowedTarget = target && context.availableTargets.find((candidate) => candidate.id === target.id);
  if (!allowedTarget || allowedTarget.type !== target.type || allowedTarget.label !== target.label) {
    issues.push({ code: "DECISION_TARGET_UNKNOWN", message: `决策引用了不可接触或不一致的目标：${target?.id || "(missing)"}` });
  }
  if (!(["PRIVATE", "LIMITED", "OBSERVABLE", "PUBLIC"] as unknown[]).includes(decision?.visibility)) {
    issues.push({ code: "DECISION_VISIBILITY_INVALID", message: "决策 visibility 不在允许集合中。" });
  }
  if (!(["LOW", "MEDIUM", "HIGH"] as unknown[]).includes(decision?.riskTolerance)) {
    issues.push({ code: "DECISION_RISK_INVALID", message: "决策 riskTolerance 不在允许集合中。" });
  }
  validateAllowedArray(decision?.leverageKeys, context.allowedReferences.assetKeys, "DECISION_ASSET_UNKNOWN", "决策筹码", issues);
  if (!Array.isArray(decision?.groundingIds) || !decision.groundingIds.length) {
    issues.push({ code: "DECISION_GROUNDING_REQUIRED", message: "决策缺少本轮 grounding。" });
  } else {
    validateAllowedArray(decision.groundingIds, context.allowedReferences.groundingIds, "DECISION_GROUNDING_UNKNOWN", "决策 grounding", issues);
  }
  return issues.length === before;
}

function validatePendingConsequences(
  output: StoryTurnPublishedOutput,
  context: CompiledStoryContext,
  issues: ValidationIssue[]
) {
  const paid = new Set(output?.grounding?.paidPendingConsequenceIds || []);
  const deferredRows = Array.isArray(output?.grounding?.deferredConsequences) ? output.grounding.deferredConsequences : [];
  const deferred = new Set<string>();
  for (const row of deferredRows) {
    if (!context.allowedReferences.pendingConsequenceIds.includes(row?.consequenceId)) {
      issues.push({ code: "DEFERRED_CONSEQUENCE_ID_UNKNOWN", message: `延期了本轮未提供的后果：${row?.consequenceId || "(missing)"}` });
      continue;
    }
    if (!String(row.reason || "").trim() || !String(row.nextDueLabel || "").trim()) {
      issues.push({ code: "DEFERRED_CONSEQUENCE_INCOMPLETE", message: `延期后果 ${row.consequenceId} 缺少原因或下一期限。` });
      continue;
    }
    deferred.add(row.consequenceId);
  }
  for (const consequence of context.sections.pendingConsequences.items.filter((item) => item.priority === "P0")) {
    if (!paid.has(consequence.consequenceId) && !deferred.has(consequence.consequenceId)) {
      issues.push({ code: "P0_CONSEQUENCE_UNACCOUNTED", message: `P0 后果没有兑现或合法延期：${consequence.consequenceId}` });
    }
  }
  for (const id of output?.endingState?.surfacedConsequenceIds || []) {
    if (!paid.has(id)) {
      issues.push({ code: "SURFACED_CONSEQUENCE_NOT_PAID", message: `endingState 声称后果已浮现，但 grounding 未标记兑现：${id}` });
    }
  }
}

function requireText(value: unknown, code: string, message: string, issues: ValidationIssue[]) {
  if (typeof value !== "string" || !value.trim()) issues.push({ code, message });
}

function requireArray(value: unknown, code: string, message: string, issues: ValidationIssue[]) {
  if (!Array.isArray(value)) issues.push({ code, message });
}

function validateAllowedArray(
  value: unknown,
  allowed: string[],
  code: string,
  label: string,
  issues: ValidationIssue[]
) {
  if (!Array.isArray(value)) {
    issues.push({ code: `${code}_ARRAY_REQUIRED`, message: `${label}必须是数组。` });
    return;
  }
  const allowedSet = new Set(allowed);
  const unknown = value.find((item) => typeof item !== "string" || !allowedSet.has(item));
  if (unknown !== undefined) issues.push({ code, message: `${label}引用了本轮不允许的 ID：${String(unknown)}` });
}
