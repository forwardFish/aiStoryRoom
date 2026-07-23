import {
  authorizedPartOneProceduralDerivations,
  containsUnauthorizedPartOneDiscovery
} from "./part-one-prose-guard";
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
    const effectiveMinCharacters = minCharacters;
    const effectiveMaxCharacters = maxCharacters;
    if (count < effectiveMinCharacters || count > effectiveMaxCharacters) {
      issues.push({
        code: "NARRATIVE_STYLE_BUDGET_VIOLATION",
        message: `正文长度 ${count} 不在 ${effectiveMinCharacters}—${effectiveMaxCharacters} 字范围内。`
      });
    }
    const paragraphCount = prose.split(/\n\s*\n/).filter((paragraph) => paragraph.trim()).length;
    if (paragraphCount < 3 || paragraphCount > 12) {
      issues.push({
        code: "NARRATIVE_PARAGRAPH_BUDGET_VIOLATION",
        message: `正文共有 ${paragraphCount} 个自然段，第一部分要求 3—12 段。`
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
    recentCanon,
    ...context.sections.currentScene.items.map((scene) =>
      `${scene.title} ${scene.timeLabel} ${scene.locationLabel} ${scene.situation}`
    ),
    context.actionResolution.actionStarted,
    context.actionResolution.summary,
    ...context.actionResolution.immediateObservableResult,
    ...context.sections.roleKnowledge.items.map((fact) => fact.content),
    ...(event?.authoritativeObservableFacts || []),
    ...(event?.authoritativeNpcReactions.map((reaction) => reaction.action) || []),
    ...(event?.authoritativeWorldMoves.map((move) => move.action) || []),
    JSON.stringify(event?.narrativePlan.sceneStart.documentStates || []),
    JSON.stringify(event?.narrativePlan.sceneEnd.documentStates || []),
    JSON.stringify(event?.narrativePlan.sceneStart.objectStates || []),
    JSON.stringify(event?.narrativePlan.sceneEnd.objectStates || []),
    ...authorizedProseDerivations(event)
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
    const inventedQuantity = [
      ...prose.matchAll(
        /(?:\d+|[一二三四五六七八九十百千万两半余剩]+)(?:个)?(?:成|钱|户|家|铺|人|年|月|日|夜|时辰|石|担|亩|里|县)/g
      )
    ].find((match) =>
      !isAuthorizedPartOneQuantity(
        match[0],
        authoritativeCorpus,
        prose,
        match.index ?? 0,
        event?.narrativePlan || null
      )
      && !isNonFactualTemporalComparison(prose, match.index ?? 0, match[0])
    )?.[0];
    if (inventedQuantity) {
      issues.push({
        code: "UNSUPPORTED_PART_ONE_QUANTITY",
        message: `正文新增了未结算的数字或期限：${inventedQuantity}`
      });
    }
    const actorCountContradiction = event
      ? findActorCountContradiction(prose, event.narrativePlan)
      : null;
    if (actorCountContradiction) {
      issues.push({
        code: "PART_ONE_CONTINUITY_CONTRADICTION",
        message: `正文写错了当前场景的在场人数：${actorCountContradiction}`
      });
    }
    const documentCountContradiction = event
      ? findDocumentCountContradiction(prose, event.narrativePlan)
      : null;
    if (documentCountContradiction) {
      issues.push({
        code: "PART_ONE_CONTINUITY_CONTRADICTION",
        message: `正文写错了当前场景实际在场的文书数量：${documentCountContradiction}`
      });
    }
    const quotedCharacterCountContradiction = findQuotedCharacterCountContradiction(prose);
    if (quotedCharacterCountContradiction) {
      issues.push({
        code: "PART_ONE_CONTINUITY_CONTRADICTION",
        message: `正文写错了紧随其后的台词字数：${quotedCharacterCountContradiction}`
      });
    }
    const eventText = event
      ? [
          event.actionText,
          ...event.authoritativeObservableFacts,
          ...event.authoritativeNpcReactions.map((reaction) => reaction.action),
          ...event.authoritativeWorldMoves.map((move) => move.action)
        ].join("\n")
      : "";
    if (
      eventText.includes("清流县令亲随")
      && /(?:总督(?:府|自己的)?|自己(?:的)?|另一名|另一个|持令(?:的)?)亲随/.test(prose)
    ) {
      issues.push({
        code: "UNAUTHORIZED_PART_ONE_ACTOR",
        message: "正文把已经明确的清流县令亲随拆成了另一名亲随。"
      });
    }
    if (
      eventText.includes("巡抚书吏")
      && (
        /巡抚书吏(?!方向|那边|所在|面前|身后)[^。！？]{0,24}(?:出了?内厅|步出内厅|离开内厅|离府|去而复返|又回来了|又返回|回来复命)/.test(prose)
        || /(?:去而复返|又回来了|又返回|回来复命)[^。！？]{0,16}巡抚书吏/.test(prose)
      )
    ) {
      issues.push({
        code: "UNAUTHORIZED_PART_ONE_SCENE_TRANSITION",
        message: "正文让在场代表离场送信或经过未经结算的时间后返回。"
      });
    }
    const unauthorizedTimeAdvance = findUnauthorizedTimeAdvance(prose, authoritativeCorpus);
    if (unauthorizedTimeAdvance) {
      issues.push({
        code: "UNAUTHORIZED_PART_ONE_TIME_ADVANCE",
        message: `正文推进了本轮没有结算的时间：${unauthorizedTimeAdvance}`
      });
    }
    const unauthorizedDeadlineAnchor = findUnauthorizedDeadlineAnchor(prose);
    if (unauthorizedDeadlineAnchor) {
      issues.push({
        code: "UNAUTHORIZED_PART_ONE_DEADLINE_ANCHOR",
        message: `正文擅自改变了既有期限的起算点：${unauthorizedDeadlineAnchor}`
      });
    }
    const unauthorizedActorAction = event
      ? findUnauthorizedActorActionForPlan(prose, event.narrativePlan)
      : null;
    if (unauthorizedActorAction) {
      issues.push({
        code: "UNAUTHORIZED_PART_ONE_ACTOR_ACTION",
        message: `正文让不在本轮场景名单中的人物到场或行动：${unauthorizedActorAction}`
      });
    }
    const unauthorizedActorIdentity = findUnauthorizedActorIdentity(
      prose,
      authoritativeCorpus
    );
    if (unauthorizedActorIdentity) {
      issues.push({
        code: "UNAUTHORIZED_PART_ONE_ACTOR_IDENTITY",
        message: `正文给工作集中的无名人物新增了姓名或专属称呼：${unauthorizedActorIdentity}`
      });
    }
    const unauthorizedDocumentIntroduction = findUnauthorizedDocumentIntroduction(
      prose,
      authoritativeCorpus
    );
    if (unauthorizedDocumentIntroduction) {
      issues.push({
        code: "UNAUTHORIZED_PART_ONE_DOCUMENT_INTRODUCTION",
        message: `正文让人物取出或递上了本轮未授权的新文书：${unauthorizedDocumentIntroduction}`
      });
    }
    const documentStateContradiction = event
      ? findDocumentStateContradiction(
          prose,
          event.narrativePlan.sceneStart.documentStates || []
        )
      : null;
    if (documentStateContradiction) {
      issues.push({
        code: "PART_ONE_CONTINUITY_CONTRADICTION",
        message: `正文改写了已经确定的文书状态：${documentStateContradiction}`
      });
    }
    const remoteDocumentProcedure = event
      ? findRemoteDocumentProcedurePhysicalization(
          prose,
          event.actionText,
          event.narrativePlan
        )
      : null;
    if (remoteDocumentProcedure) {
      issues.push({
        code: "PART_ONE_CONTINUITY_CONTRADICTION",
        message: `正文在目标文书不在场时虚构了当场实物操作：${remoteDocumentProcedure}`
      });
    }
    const objectHolderContradiction = event
      ? findObjectHolderContradiction(
          prose,
          event.narrativePlan.sceneStart.objectStates || [],
          event.narrativePlan.sceneEnd.objectStates || []
        )
      : null;
    if (objectHolderContradiction) {
      issues.push({
        code: "PART_ONE_CONTINUITY_CONTRADICTION",
        message: `正文改写了已经确定的物件持有关系：${objectHolderContradiction}`
      });
    }
    const absentObjectAppearance = event
      ? findAbsentObjectAppearance(prose, event.narrativePlan)
      : null;
    if (absentObjectAppearance) {
      issues.push({
        code: "PART_ONE_CONTINUITY_CONTRADICTION",
        message: `正文把由离场人物持有的物件重新写回当前现场：${absentObjectAppearance}`
      });
    }
    const unauthorizedMaterialAttribute = findUnauthorizedMaterialAttribute(
      prose,
      authoritativeCorpus,
      event?.narrativePlan || null
    );
    if (unauthorizedMaterialAttribute) {
      issues.push({
        code: "UNAUTHORIZED_PART_ONE_MATERIAL_ATTRIBUTE",
        message: `正文给既有物件增加了未结算的鉴别属性：${unauthorizedMaterialAttribute}`
      });
    }
    const unauthorizedPlayerSpeech = event
      ? findUnauthorizedPlayerSpeech(prose, event.narrativePlan.authorizedPlayerSpeech)
      : null;
    if (unauthorizedPlayerSpeech) {
      issues.push({
        code: "UNAUTHORIZED_PART_ONE_PLAYER_SPEECH",
        message: `正文替玩家说了未获批的原话：${unauthorizedPlayerSpeech}`
      });
    }
    const unauthorizedCommitment = findUnauthorizedPlayerCommitment(
      prose,
      event?.actionText || ""
    );
    if (unauthorizedCommitment) {
      issues.push({
        code: "UNAUTHORIZED_PART_ONE_PLAYER_COMMITMENT",
        message: `正文替玩家追加了未结算的承诺或办理方式：${unauthorizedCommitment}`
      });
    }
    const unauthorizedNpcCommitment = findUnauthorizedNpcCommitment(
      prose,
      authoritativeCorpus
    );
    if (unauthorizedNpcCommitment) {
      issues.push({
        code: "UNAUTHORIZED_PART_ONE_NPC_COMMITMENT",
        message: `正文替 NPC 新增了工作集未授权的办理承诺：${unauthorizedNpcCommitment}`
      });
    }
  }

  if (event) {
    const requiredBeats = event.narrativePlan.sceneBeats
      .filter((beat) => beat.mustAppear)
      .map((beat) => ({
        beatId: beat.beatId,
        label: beat.sourceType,
        text: beat.action,
        requiredTermGroups: beat.requiredTermGroups,
        requireAllTermGroups:
          beat.sourceType === "WORLD_MOVE" || beat.sourceType === "PLAYER_ACTION",
        threshold: beat.sourceType === "PLAYER_ACTION" ? 0.16 : 0.11
      }));
    for (const beat of requiredBeats) {
      const departureRendered = beat.beatId.startsWith("SCENE-DEPARTURE-")
        && actorDepartureRendered(beat.requiredTermGroups[0] || [], prose);
      const groupsRendered = departureRendered || (
        beat.requiredTermGroups.length > 0
        && beat.requiredTermGroups.every((group) => termGroupRendered(group, prose))
      );
      const missing = beat.requireAllTermGroups
        ? !groupsRendered
        : !groupsRendered && ngramCoverage(beat.text, prose) < beat.threshold;
      if (beat.text && missing) {
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

function authorizedProseDerivations(
  event: CompiledStoryContext["sections"]["partOneSettlement"]["items"][number] | null
) {
  if (!event) return [];
  const eventText = [
    event.actionText,
    ...event.authoritativeObservableFacts,
    ...event.authoritativeNpcReactions.map((reaction) => reaction.action),
    ...event.authoritativeWorldMoves.map((move) => move.action)
  ].join("\n");
  return authorizedPartOneProceduralDerivations(eventText);
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
    const legalRoute = runtime?.decisionAffordances.find(
      (route) => route.affordanceTemplateId === decision.routeKey
    );
    if (legalRoute && decision.description.trim() !== legalRoute.actionText.trim()) {
      issues.push({
        code: "DECISION_DESCRIPTION_EXCEEDS_ACTION_BOUNDARY",
        message: `玩家行动必须逐字使用已审批的行动边界：${decision.routeKey}`
      });
    }
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

function termGroupRendered(terms: string[], prose: string) {
  if (
    terms.includes("写进放行文书")
    && /(?:放行文书|改桑执行回文|回文)[^。！？]{0,36}(?:提笔|落笔|落字|写明|写下|写了|写成)|(?:提笔|落笔|落字|写明|写下|写了|写成)[^。！？]{0,36}(?:放行文书|改桑执行回文|回文)/.test(prose)
  ) {
    return true;
  }
  return terms.some((term) => {
    if (!term) return false;
    if (prose.includes(term)) return true;
    const normalized = fingerprint(term);
    return normalized.length >= 4 && ngramCoverage(term, prose) >= 0.5;
  });
}

function actorDepartureRendered(actorTerms: string[], prose: string) {
  for (const actorTerm of actorTerms) {
    if (!actorTerm) continue;
    let actorIndex = prose.indexOf(actorTerm);
    while (actorIndex >= 0) {
      const tail = prose.slice(actorIndex, actorIndex + 260);
      const movesToExit =
        /(?:转身|退后|躬身)[^。！？]{0,60}(?:朝|向|走向|迈向)?[^。！？]{0,12}(?:厅门|门边|门槛|门帘|门外)|(?:朝|向|走向|迈向)[^。！？]{0,12}(?:厅门|门边|门槛|门帘|门外)/.test(tail);
      const exitCompleted =
        /(?:出了|退出|离开|迈出[^。！？]{0,16}(?:门框|门槛|厅门)|背影[^。！？]{0,16}(?:消失|不见)|步出(?:内厅|厅门)|跨过门槛|(?:侧身|闪身|迈步|举步|转身)而出|脚步声[^。！？]{0,20}(?:远|听不见)|门帘[^。！？]{0,20}(?:落下|合上)|厅(?:中|里)[^。！？]{0,18}(?:少了|只剩))/.test(tail);
      if (movesToExit && exitCompleted) return true;
      actorIndex = prose.indexOf(actorTerm, actorIndex + actorTerm.length);
    }
  }
  return false;
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

function isNonFactualTemporalComparison(prose: string, matchIndex: number, quantity: string) {
  if (!/[日夜]$/.test(quantity)) return false;
  const sentenceStart = Math.max(
    prose.lastIndexOf("。", matchIndex - 1),
    prose.lastIndexOf("！", matchIndex - 1),
    prose.lastIndexOf("？", matchIndex - 1)
  ) + 1;
  const sentenceEndCandidates = ["。", "！", "？"]
    .map((mark) => prose.indexOf(mark, matchIndex))
    .filter((index) => index >= 0);
  const sentenceEnd = sentenceEndCandidates.length
    ? Math.min(...sentenceEndCandidates)
    : prose.length;
  const sentence = prose.slice(sentenceStart, sentenceEnd);
  const escaped = escapeRegExp(quantity);
  return new RegExp(`${escaped}[^。！？]{0,24}(?:便|就|则|愈|更|多)[^。！？]{0,12}${escaped}`).test(sentence);
}

function isAuthorizedPartOneQuantity(
  quantity: string,
  authoritativeCorpus: string,
  prose: string,
  matchIndex: number,
  plan: CompiledStoryContext["sections"]["partOneSettlement"]["items"][number]["narrativePlan"] | null
) {
  if (authoritativeCorpus.includes(quantity)) return true;
  const normalized = quantity.replace(/^(?:只余|尚余|余|剩余|剩|尚有|还有)/, "");
  if (normalized && normalized !== quantity && authoritativeCorpus.includes(normalized)) return true;
  if (quantity === "一县") {
    if (/[哪这该同本]/.test(prose.slice(Math.max(0, matchIndex - 1), matchIndex))) {
      return true;
    }
    const prefix = prose.slice(Math.max(0, matchIndex - 6), matchIndex);
    for (let size = 2; size <= Math.min(4, prefix.length); size += 1) {
      const place = prefix.slice(-size);
      if (authoritativeCorpus.includes(`${place}县`)) return true;
    }
    if (paragraphReferencesAuthorizedCounty(prose, matchIndex, authoritativeCorpus)) {
      return true;
    }
  }
  if (
    quantity === "二日"
    && prose.slice(Math.max(0, matchIndex - 1), matchIndex) === "第"
    && /(?:次日|五月初九)/.test(authoritativeCorpus)
  ) {
    return true;
  }
  if (
    quantity === "一个人"
    && /(?:每|任何)$/.test(prose.slice(Math.max(0, matchIndex - 2), matchIndex))
  ) {
    return true;
  }
  if (quantity.endsWith("人") && plan) {
    const actorQuantity = quantity
      .replace(/^(?:只余|尚余|余|剩余|剩|尚有|还有)/, "")
      .replace(/个?人$/, "");
    const value = parseSmallChineseNumber(actorQuantity);
    const authorizedCounts = new Set([
      plan.sceneStartActorLabels.length,
      plan.sceneEndActorLabels.length,
      plan.authorizedActorArrivals.length,
      plan.authorizedActorDepartures.length
    ]);
    if (value !== null && authorizedCounts.has(value)) return true;
    if (
      value === 2
      && sentenceNamesActorPair(prose, matchIndex, plan.sceneEndActorLabels)
    ) {
      return true;
    }
    if (
      value !== null
      && sentenceNamesNonPlayerActors(
        prose,
        matchIndex,
        plan.sceneEndActorLabels,
        value
      )
    ) {
      return true;
    }
  }
  return false;
}

function paragraphReferencesAuthorizedCounty(
  prose: string,
  matchIndex: number,
  authoritativeCorpus: string
) {
  const paragraphBoundary = prose.lastIndexOf("\n\n", Math.max(0, matchIndex - 1));
  const paragraphStart = paragraphBoundary >= 0 ? paragraphBoundary + 2 : 0;
  const prefix = prose.slice(Math.max(paragraphStart, matchIndex - 180), matchIndex);
  for (const countyMatch of prefix.matchAll(/[\u4e00-\u9fff]{1,6}县/g)) {
    const mention = countyMatch[0];
    for (let size = 2; size <= Math.min(5, mention.length); size += 1) {
      const countyLabel = mention.slice(-size);
      if (authoritativeCorpus.includes(countyLabel)) return true;
    }
  }
  return false;
}

function findActorCountContradiction(
  prose: string,
  plan: CompiledStoryContext["sections"]["partOneSettlement"]["items"][number]["narrativePlan"]
) {
  const pattern =
    /(?:厅里|厅内|内厅|屋里|房中|堂中|签押房)[^。！？]{0,10}(?:只剩|剩下|共有|总共)[^。！？]{0,5}([一二三四五六七八九十两]+)(?:个)?人/g;
  for (const match of prose.matchAll(pattern)) {
    const count = parseSmallChineseNumber(match[1] || "");
    if (count !== null && count !== plan.sceneEndActorLabels.length) return match[0];
  }
  const rosterPattern =
    /(?:厅里|厅内|厅中|内厅|屋里|房中|堂中|签押房)[^。！？]{0,10}(?:只剩|剩下)([^。！？]{1,60})/g;
  for (const match of prose.matchAll(rosterPattern)) {
    const roster = match[1] || "";
    if (/(?:的)?(?:动静|声音|声响|脚步声|呼吸声|落笔声|风声|雨声)/.test(roster)) {
      continue;
    }
    const mentionedActors = plan.sceneEndActorLabels.filter((label) =>
      actorLabelAppears(label, roster, plan.sceneEndActorLabels)
    );
    if (
      mentionedActors.length > 0
      && mentionedActors.length !== plan.sceneEndActorLabels.length
    ) {
      return match[0];
    }
  }
  return null;
}

function findDocumentCountContradiction(
  prose: string,
  plan: CompiledStoryContext["sections"]["partOneSettlement"]["items"][number]["narrativePlan"]
) {
  const presentDocumentCount = (
    states: typeof plan.sceneStart.documentStates
  ) => (states || []).filter((document) => document.accessState !== "NOT_PRESENT").length;
  const startCount = presentDocumentCount(plan.sceneStart.documentStates);
  const endCount = presentDocumentCount(plan.sceneEnd.documentStates);
  const transitionBoundary = plan.transitionAllowed
    ? transitionBoundaryIndex(prose, plan.sceneEnd.timeLabel, plan.sceneEnd.locationLabel)
    : -1;
  const pattern =
    /(?:案上|案前|桌上|几案上)[^。！？]{0,50}?([一二三四五六七八九十两]+)(?:份|封|张|册)(?:文书|公文|纸张|卷册)/g;
  for (const match of prose.matchAll(pattern)) {
    const count = parseSmallChineseNumber(match[1] || "");
    if (count === null) continue;
    if (transitionBoundary >= 0) {
      const expected = (match.index ?? 0) >= transitionBoundary ? endCount : startCount;
      if (count !== expected) return match[0];
      continue;
    }
    if (count !== startCount && count !== endCount) return match[0];
  }
  return null;
}

function actorLabelAppears(label: string, prose: string, allLabels: string[]) {
  return actorAliases(label, allLabels).some((alias) => prose.includes(alias));
}

function sentenceNamesActorPair(
  prose: string,
  matchIndex: number,
  actorLabels: string[]
) {
  const sentenceStart = Math.max(
    prose.lastIndexOf("。", matchIndex),
    prose.lastIndexOf("！", matchIndex),
    prose.lastIndexOf("？", matchIndex),
    prose.lastIndexOf("\n", matchIndex)
  ) + 1;
  const endings = [
    prose.indexOf("。", matchIndex),
    prose.indexOf("！", matchIndex),
    prose.indexOf("？", matchIndex),
    prose.indexOf("\n", matchIndex)
  ].filter((index) => index >= 0);
  const sentenceEnd = endings.length ? Math.min(...endings) : prose.length;
  const sentence = prose.slice(sentenceStart, sentenceEnd);
  const aliases = actorLabels.map((label) => actorAliases(label, actorLabels));
  for (let left = 0; left < aliases.length; left += 1) {
    for (let right = left + 1; right < aliases.length; right += 1) {
      for (const leftAlias of aliases[left]!) {
        for (const rightAlias of aliases[right]!) {
          const leftFirst = new RegExp(
            `${escapeRegExp(leftAlias)}(?:与|和|、)${escapeRegExp(rightAlias)}`
          );
          const rightFirst = new RegExp(
            `${escapeRegExp(rightAlias)}(?:与|和|、)${escapeRegExp(leftAlias)}`
          );
          if (leftFirst.test(sentence) || rightFirst.test(sentence)) return true;
        }
      }
    }
  }
  return false;
}

function sentenceNamesNonPlayerActors(
  prose: string,
  matchIndex: number,
  actorLabels: string[],
  expectedCount: number
) {
  const sentenceStart = Math.max(
    prose.lastIndexOf("。", matchIndex),
    prose.lastIndexOf("！", matchIndex),
    prose.lastIndexOf("？", matchIndex),
    prose.lastIndexOf("\n", matchIndex)
  ) + 1;
  const sentence = prose.slice(sentenceStart, matchIndex);
  const namedNonPlayerActors = actorLabels
    .filter((label) => label !== "浙江总督")
    .filter((label) =>
      actorAliases(label, actorLabels).some((alias) => sentence.includes(alias))
    );
  return new Set(namedNonPlayerActors).size === expectedCount;
}

function actorAliases(label: string, allLabels: string[] = []) {
  const aliases = [label];
  if (label === "浙江总督") aliases.push("总督", "督宪", "部堂");
  if (label === "浙江巡抚") aliases.push("巡抚", "中丞", "抚台");
  if (label === "巡抚幕僚") aliases.push("幕僚");
  if (label === "清流县令") aliases.push("县令", "县尊");
  if (label === "改桑书吏") aliases.push("改桑书吏", "书吏");
  if (
    label === "巡抚书吏"
    && allLabels.filter((candidate) => candidate.includes("书吏")).length === 1
  ) {
    aliases.push("书吏");
  }
  return [...new Set(aliases)];
}

function findQuotedCharacterCountContradiction(prose: string) {
  const pattern = /说了([一二三四五六七八九十两]+)个字[：:]\s*[“"]([^”"]+)[”"]/g;
  for (const match of prose.matchAll(pattern)) {
    const declared = parseSmallChineseNumber(match[1] || "");
    const actual = [...String(match[2] || "").replace(/[\s，。！？；：、“”‘’—…]/g, "")].length;
    if (declared !== null && declared !== actual) return match[0];
  }
  return null;
}

function parseSmallChineseNumber(value: string) {
  const normalized = value === "两" ? "二" : value;
  const digits: Record<string, number> = {
    一: 1, 二: 2, 三: 3, 四: 4, 五: 5,
    六: 6, 七: 7, 八: 8, 九: 9, 十: 10
  };
  if (normalized in digits) return digits[normalized]!;
  if (/^十[一二三四五六七八九]$/.test(normalized)) {
    return 10 + digits[normalized[1]!]!;
  }
  if (/^[二三四五六七八九]十$/.test(normalized)) {
    return digits[normalized[0]!]! * 10;
  }
  return null;
}

function findUnauthorizedDocumentIntroduction(prose: string, authoritativeCorpus: string) {
  const blankDocument = prose.match(
    /(?:(?:空白的?|尚未落字的?)(?:回文纸|文纸|札纸|纸页|纸张|契纸|公文|文书)|空文纸)/
  )?.[0];
  if (blankDocument && !authoritativeCorpus.includes(blankDocument)) return blankDocument;

  const patterns = [
    /(?:袖中|怀中|案下|身后)?[^。！？]{0,10}(?:取出|掏出|拿出|递上|递向|呈上|展开)[^。！？]{0,14}(手本|札子|札纸|便笺|字条|节略|底稿|底簿|清单|公函|公文|文书|纸页|纸张|附件|附页|手令|批文|册子|空册)/g,
    /(?:搬入|搬来|搬了|搬进|捧来|抱来|带来|抬进|搁下|放下)[^。！？]{0,14}(?:一摞|一叠|一册|几册)?(册子|空册|底簿|文书|公文|清单|底稿)/g
  ];
  for (const pattern of patterns) {
    for (const match of prose.matchAll(pattern)) {
      const documentKind = match[1] || "";
      if (!documentKind || !authoritativeCorpus.includes(documentKind)) return match[0];
    }
  }
  return null;
}

function findDocumentStateContradiction(
  prose: string,
  documentStates: Array<{
    label: string;
    accessState: string;
    holderRef: string | null;
  }>
) {
  for (const document of documentStates) {
    if (document.accessState === "NOT_PRESENT") {
      for (const label of uniqueDocumentLabels(document.label)) {
        const escaped = escapeRegExp(label);
        const physicalAppearance = prose.match(
          new RegExp(
            `(?:捧着|拿着|取出|拿出|递上|呈上|摊开|展开|翻开|摆着|摆在|放在|搁在)[^。！？]{0,12}${escaped}|${escaped}[^。！？]{0,16}(?:已经|已然|正|仍)?(?:摆在|放在|搁在|摊在|呈到|送到|拿到|翻开|启封|验看|查验|核验)`
          )
        )?.[0];
        if (
          physicalAppearance
          && !/(?:(?:随时|尚待|待|将|准备)(?:可以|可|能够|能)?|(?:可以|可|能够|能))(?:呈到|送到|拿到)/.test(
            physicalAppearance
          )
        ) {
          return physicalAppearance;
        }
      }
      continue;
    }
    if (!["OPENED", "READ", "WRITTEN"].includes(document.accessState)) continue;
    const labels = uniqueDocumentLabels(document.label);
    for (const label of labels) {
      const escaped = escapeRegExp(label);
      const unread = prose.match(
        new RegExp(
          `${escaped}[^。！？]{0,24}(?:尚未|还未|未曾|并未|没有|不曾)(?:拆阅|拆开|启封|看过|读过)|${escaped}[^。！？]{0,16}(?:封口完好|仍然封着|仍未启封)`
        )
      )?.[0];
      if (unread) return unread;
    }
  }
  return null;
}

function findRemoteDocumentProcedurePhysicalization(
  prose: string,
  actionText: string,
  plan: CompiledStoryContext["sections"]["partOneSettlement"]["items"][number]["narrativePlan"]
) {
  const targetsAbsentDocument = (plan.sceneStart.documentStates || []).some((document) => {
    if (document.accessState !== "NOT_PRESENT") return false;
    if (actionText.includes(document.label)) return true;
    if (document.label.includes("原件") && /(?:原册|原件)/.test(actionText)) return true;
    if (document.label.includes("副本") && /(?:副本|抄本)/.test(actionText)) return true;
    return false;
  });
  if (!targetsAbsentDocument) return null;
  return prose.match(
    /(?:递上|递出|取出|拿出|拿起|捏着|握着|手里|手中)[^。！？]{0,16}(?:封条|封样|红纸)|(?:封条|封样|红纸)[^。！？]{0,18}(?:递上|递给|交给|压印|盖印|落印|捏着|握着|拿着|在[^。！？]{0,6}手中)/
  )?.[0] || null;
}

function findObjectHolderContradiction(
  prose: string,
  sceneStartObjects: Array<{
    label: string;
    holderRef: string | null;
    contentsState?: string;
    closureState?: string;
  }>,
  sceneEndObjects: Array<{
    label: string;
    holderRef: string | null;
    contentsState?: string;
    closureState?: string;
  }>
) {
  const sceneEndByLabel = new Map(sceneEndObjects.map((object) => [object.label, object]));
  const sceneStartLabels = new Set(sceneStartObjects.map((object) => object.label));
  const objectTransitions = [
    ...sceneStartObjects.map((object) => ({
      sceneStart: object,
      sceneEnd: sceneEndByLabel.get(object.label) || object
    })),
    ...sceneEndObjects
      .filter((object) => !sceneStartLabels.has(object.label))
      .map((object) => ({ sceneStart: object, sceneEnd: object }))
  ];
  for (const { sceneStart, sceneEnd } of objectTransitions) {
    const object = sceneEnd;
    for (const label of uniqueDocumentLabels(object.label)) {
      const escaped = escapeRegExp(label);
      const governorIsAuthorizedHolder = [
        sceneStart.holderRef,
        sceneEnd.holderRef
      ].includes("actor.zhejiang_governor");
      if (
        !governorIsAuthorizedHolder
        && sceneStart.holderRef
        && sceneEnd.holderRef
      ) {
        const governorMovesObject = prose.match(
          new RegExp(
            `(?:浙江总督|总督)[^。！？]{0,8}(?:将|把)?[^。！？]{0,6}${escaped}[^。！？]{0,12}(?:搁|放|推|收起|打开|合上|拿起|取走)|(?:浙江总督|总督)[^。！？]{0,8}(?:取过|拿过|接过|拿起|收起|打开|合上)[^。！？]{0,8}${escaped}`
          )
        )?.[0];
        if (governorMovesObject) return governorMovesObject;
      }
      const contentsRemainEmpty = sceneStart.contentsState === "EMPTY"
        && sceneEnd.contentsState === "EMPTY";
      if (contentsRemainEmpty) {
        const changedContents = prose.match(
          new RegExp(
            `(?:${escaped}|空匣)[^。！？]{0,26}(?:比来时|较来时|分量)[^。！？]{0,10}(?:轻|重)|(?:${escaped}|空匣)[^。！？]{0,26}(?:没有一丝|毫无)分量|(?:捧来的东西|匣中之物)[^。！？]{0,28}(?:捧回去|如今|眼下)[^。！？]{0,12}(?:不一样|不同)|${escaped}[^。！？]{0,16}(?:装着|盛着|已有|放着)[^。！？]{0,10}(?:回文|文书|纸页)`
          )
        )?.[0];
        if (changedContents) return changedContents;
      }
      const closureRemainsClosed = sceneStart.closureState === "CLOSED"
        && sceneEnd.closureState === "CLOSED";
      if (closureRemainsClosed) {
        const closurePattern = new RegExp(
          `${escaped}[^。！？]{0,12}(?:匣盖)?(?:虚掩|半开|敞开|打开|开启)|匣盖[^。！？]{0,10}(?:虚掩|半开|敞开|打开|开启)`,
          "g"
        );
        for (const changedClosure of prose.matchAll(closurePattern)) {
          if (
            !isNegatedOrHypotheticalClosureChange(
              prose,
              changedClosure.index ?? 0,
              changedClosure[0]
            )
          ) {
            return changedClosure[0];
          }
        }
      }
      if (/令牌/.test(label)) {
        const inventedPlacement = prose.match(
          new RegExp(
            `${escaped}[^。！？]{0,10}(?:收入|藏入|拢入|塞入|悬在|挂在|放在|搁在|藏在)[^。！？]{0,6}(?:袖中|袖内|怀中|怀前|腰间|案后|案下|案角|案旁)|(?:袖中|袖内|怀中|怀前|腰间)[^。！？]{0,8}${escaped}|(?:从|自)(?:袖中|袖内|怀中|怀前|腰间|案后|案下|案角|案旁)[^。！？]{0,8}(?:取出|拿出)[^。！？]{0,8}${escaped}`
          )
        )?.[0];
        if (inventedPlacement) return inventedPlacement;
      }
    }
  }
  return null;
}

function isNegatedOrHypotheticalClosureChange(
  prose: string,
  matchIndex: number,
  matchedText: string
) {
  const sentenceStart = Math.max(
    prose.lastIndexOf("。", Math.max(0, matchIndex - 1)),
    prose.lastIndexOf("！", Math.max(0, matchIndex - 1)),
    prose.lastIndexOf("？", Math.max(0, matchIndex - 1)),
    prose.lastIndexOf("\n", Math.max(0, matchIndex - 1))
  ) + 1;
  const clauseStart = Math.max(
    sentenceStart,
    prose.lastIndexOf("，", Math.max(0, matchIndex - 1)) + 1,
    prose.lastIndexOf("；", Math.max(0, matchIndex - 1)) + 1,
    prose.lastIndexOf("：", Math.max(0, matchIndex - 1)) + 1
  );
  const context = prose.slice(
    Math.max(clauseStart, matchIndex - 36),
    matchIndex + matchedText.length
  );
  return /(?:没有|并未|未曾|不曾|未|不)(?:去)?[^。！？]{0,8}(?:打开|开启)/.test(context)
    || /(?:是否|该不该|要不要|能不能|能否|可不可|可否|会不会)[^。！？]{0,16}(?:打开|开启)/.test(
      context
    );
}

function findAbsentObjectAppearance(
  prose: string,
  plan: CompiledStoryContext["sections"]["partOneSettlement"]["items"][number]["narrativePlan"]
) {
  const presentActors = new Set(plan.sceneStart.presentActorRefs || []);
  for (const object of plan.sceneStart.objectStates || []) {
    if (!object.holderRef || presentActors.has(object.holderRef)) continue;
    for (const label of uniqueDocumentLabels(object.label)) {
      const escaped = escapeRegExp(label);
      const physicalReference = prose.match(
        new RegExp(
          `(?:拿|取|碰|摸|按|推|搁|放|摆|压|递|握|收|藏)[^。！？]{0,10}(?:那枚|那块|那只|这个|这枚)?${escaped}|${escaped}[^。！？]{0,12}(?:摆在|搁在|放在|压在|仍在|就在|手边|案上)`
        )
      )?.[0];
      if (physicalReference) return physicalReference;
    }
  }
  const activeAliases = new Set(
    [
      ...(plan.sceneStart.objectStates || []),
      ...(plan.sceneEnd.objectStates || [])
    ].flatMap((object) => uniqueDocumentLabels(object.label))
  );
  const knownPhysicalObjectPatterns = [
    { aliases: ["巡抚回文匣", "回文匣", "空匣"], key: "回文匣" },
    { aliases: ["总督封缄令牌", "封缄令牌", "令牌"], key: "封缄令牌" }
  ];
  for (const object of knownPhysicalObjectPatterns) {
    if (object.aliases.some((alias) => activeAliases.has(alias))) continue;
    const aliasPattern = object.aliases.map(escapeRegExp).join("|");
    const physicalReference = prose.match(
      new RegExp(
        `(?:拿|取|碰|摸|按|推|搁|放|摆|压|递|握|收|藏|手边|案上)[^。！？]{0,14}(?:${aliasPattern})|(?:${aliasPattern})[^。！？]{0,14}(?:摆在|搁在|放在|压在|仍在|就在|手边|案上|手中)`
      )
    )?.[0];
    if (physicalReference) return physicalReference;
  }
  return null;
}

function uniqueDocumentLabels(label: string) {
  const values = [label];
  const shortLabel = label.replace(/^(?:浙江)?(?:巡抚|清流县令)/, "");
  if (shortLabel.length >= 2) values.push(shortLabel);
  const placeShortLabel = label.replace(/^清流/, "");
  if (placeShortLabel.length >= 2) values.push(placeShortLabel);
  const officeShortLabel = label.replace(/^总督/, "");
  if (officeShortLabel.length >= 2) values.push(officeShortLabel);
  if (label.includes("回文匣")) values.push("回文匣", "空匣");
  return [...new Set(values)];
}

function findUnauthorizedPlayerCommitment(prose: string, actionText: string) {
  const commitmentTerms = [
    "亲自",
    "届时",
    "书面",
    "另行",
    "具名",
    "具结",
    "具复",
    "具报",
    "复核令",
    "启封",
    "保证",
    "定会",
    "必会",
    "一定",
    "绝不"
  ].filter((term) => !actionText.includes(term));
  if (!commitmentTerms.length) return null;
  for (const playerSpeech of collectAttributedPlayerSpeech(prose)) {
    const term = commitmentTerms.find((candidate) => playerSpeech.includes(candidate));
    if (term) return term;
  }
  return null;
}

function findUnauthorizedNpcCommitment(
  prose: string,
  authoritativeCorpus: string
) {
  for (const sentence of proseSentences(prose)) {
    if (!/(?:县令|幕僚|书吏|会首|织造使)/.test(sentence)) continue;
    const commitment = sentence.match(
      /(?:随时|即刻|立刻|当日|明日|马上)?(?:可以|可|能够|能|会|愿意|保证|负责)[^。！？]{0,10}(?:呈到|送到|交出|拿来|调来|送来|开仓|交粮|提供|完成)/
    )?.[0];
    if (commitment && !authoritativeCorpus.includes(commitment)) return commitment;
  }
  return null;
}

function findUnauthorizedPlayerSpeech(prose: string, authorizedPhrases: string[]) {
  const allowed = new Set(authorizedPhrases.map(fingerprint));
  for (const playerSpeech of collectAttributedPlayerSpeech(prose)) {
    if (!allowed.has(fingerprint(playerSpeech))) return playerSpeech;
  }
  return null;
}

function collectAttributedPlayerSpeech(prose: string) {
  const speeches: string[] = [];
  for (const paragraph of String(prose || "").split(/\n\s*\n/)) {
    const explicitOpenSpeech = [
      ...paragraph.matchAll(
        /(?:总督|督宪|部堂)[^。！？“”"]{0,24}(?:才|便|遂|终于)?开口[^。！？“”"]{0,64}[：:]\s*[“"]([^”"]+)[”"]/g
      )
    ]
      .filter((match) => !isGovernorObjectMention(paragraph, match.index ?? 0))
      .map((match) => match[1]);
    const attributedSpeech = [
      ...paragraph.matchAll(
        /(?:总督|督宪)(?:(?!书吏|亲随|县令|巡抚|中丞|会首|幕僚|织造使)[^。！？“”"]){0,80}(?:道|说|答|回道|开口|朗声|沉声)(?:(?!书吏|亲随|县令|巡抚|中丞|会首|幕僚|织造使)[^“”"]){0,8}[“"]([^”"]+)[”"]/g
      )
    ]
      .filter((match) => !isGovernorObjectMention(paragraph, match.index ?? 0))
      .map((match) => match[1]);
    const adjacentSpeech = [
      ...paragraph.matchAll(
        /(?:总督|督宪)(?:(?!书吏|亲随|县令|巡抚|中丞|会首|幕僚|织造使)[^。！？“”"]){0,24}(?:转向|抬眼|开口|道|说|答|回道|朗声|沉声)(?:(?!书吏|亲随|县令|巡抚|中丞|会首|幕僚|织造使)[^“”"]){0,8}[“"]([^”"]+)[”"]/g
      )
    ]
      .filter((match) => !isGovernorObjectMention(paragraph, match.index ?? 0))
      .map((match) => match[1]);
    const selfNamedSpeech = [...paragraph.matchAll(/[“"]([^”"]*本督[^”"]*)[”"]/g)]
      .map((match) => match[1]);
    speeches.push(...explicitOpenSpeech, ...attributedSpeech, ...adjacentSpeech, ...selfNamedSpeech);
  }
  return [...new Set(speeches.map((speech) => speech.trim()).filter(Boolean))];
}

function isGovernorObjectMention(paragraph: string, mentionIndex: number) {
  const prefix = paragraph.slice(Math.max(0, mentionIndex - 6), mentionIndex);
  return /(?:看见|看向|看着|望向|望着|对着|朝着|扫过|落在|回到|移到|移向|听见)$/.test(prefix)
    || /(?:他|书吏|幕僚|县令|会首|织造使|亲随)(?:等|看见|看向|看着|望向|望着|听见)[^。！？]{0,4}$/.test(
      prefix
    );
}

function findUnauthorizedTimeAdvance(prose: string, authoritativeCorpus: string) {
  const match = prose.match(
    /(?:日头|日影|斜阳|日光)[^。！？]{0,18}(?:偏过|偏向|西斜|落下|移到|移向|移过|挪到|过了檐角|越过檐角)|(?:窗光|光影|光线|窗棂(?:外|里)?的光|光从窗棂)[^。！？]{0,18}(?:移到|移向|移过|移来|挪到|偏过|偏向|又移|移了)|(?:天色|暮色)[^。！？]{0,12}(?:暗下|转暗|黑了|亮起)|晨光[^。！？]{0,12}亮起|(?:已近|将近|临近)(?:正午|午时|黄昏|日暮|入夜)/
  )?.[0];
  return match && !authoritativeCorpus.includes(match) ? match : null;
}

function findUnauthorizedDeadlineAnchor(prose: string) {
  return prose.match(
    /(?:三日|期限|限期)[^。！？]{0,12}(?:从|自)(?:此刻|这一刻|现在|眼下|本轮|这时)[^。！？]{0,8}(?:起算|算起|重新计算|重算|开始(?:走|计算|起算|算))/
  )?.[0] || null;
}

function findUnauthorizedActorActionForPlan(
  prose: string,
  plan: CompiledStoryContext["sections"]["partOneSettlement"]["items"][number]["narrativePlan"]
) {
  if (!plan.transitionAllowed) {
    return findUnauthorizedNamedActorAction(
      prose,
      [...new Set([...plan.sceneStartActorLabels, ...plan.sceneEndActorLabels])]
    );
  }
  const boundary = transitionBoundaryIndex(prose, plan.sceneEnd.timeLabel, plan.sceneEnd.locationLabel);
  if (boundary < 0) {
    return findUnauthorizedNamedActorAction(
      prose,
      [...new Set([...plan.sceneStartActorLabels, ...plan.sceneEndActorLabels])]
    );
  }
  return findUnauthorizedNamedActorAction(
    prose.slice(0, boundary),
    plan.sceneStartActorLabels
  ) || findUnauthorizedNamedActorAction(
    prose.slice(boundary),
    plan.sceneEndActorLabels
  );
}

function findUnauthorizedActorIdentity(prose: string, authoritativeCorpus: string) {
  const surname =
    "赵钱孙李周吴郑王冯陈褚卫蒋沈韩杨朱秦尤许何吕施张孔曹严华金魏陶姜戚谢邹喻柏水窦章云苏潘葛奚范彭郎鲁韦昌马苗凤花方俞任袁柳鲍史唐费廉岑薛雷贺倪汤滕殷罗毕郝邬安常乐于时傅皮卞齐康伍余元卜顾孟平黄和穆萧尹姚邵湛汪祁毛禹狄米贝明臧计伏成戴宋茅庞熊纪舒屈项祝董梁杜阮蓝闵席季麻强贾路娄危江童颜郭梅盛林刁钟徐邱骆高夏蔡田樊胡凌霍虞万支柯管卢莫经房裘缪干解应宗丁宣邓郁单杭洪包诸左石崔吉龚程邢裴陆荣翁荀羊甄曲封储靳汲邴糜松井段富巫乌焦巴弓牧隗山谷车侯宓蓬全郗班仰秋仲伊宫宁仇栾暴甘钭厉戎祖武符刘景詹束龙叶幸司韶郜黎蓟薄印宿白怀蒲邰从鄂索咸籍赖卓蔺屠蒙池乔阴胥苍闻莘党翟谭贡劳逄姬申扶堵冉宰郦雍郤璩桑桂濮牛寿通边扈燕冀浦尚农温别庄晏柴瞿阎充慕连茹习宦艾鱼容向古易慎戈廖庾终暨居衡步都耿满弘匡国文寇广禄阙东欧殳沃利蔚越夔隆师巩厍聂晁勾敖融冷訾辛阚那简饶空曾毋沙乜养鞠须丰巢关蒯相查后荆红游竺权逯盖益桓公";
  const identityPattern = new RegExp(
    `([${surname}][\\u4e00-\\u9fff]?(?:先生|大人|老爷|员外|掌柜|公子|姑娘|某))`,
    "g"
  );
  for (const match of prose.matchAll(identityPattern)) {
    const identity = match[1] || "";
    if (identity && !authoritativeCorpus.includes(identity)) return identity;
  }
  return null;
}

function transitionBoundaryIndex(prose: string, timeLabel: string, locationLabel: string) {
  const timeSuffix = timeLabel.replace(/^嘉靖三十五年/, "");
  const hour = timeLabel.match(/[子丑寅卯辰巳午未申酉戌亥]时/)?.[0] || "";
  const locationSuffix = locationLabel.replace(/^杭州总督府/, "");
  const markers = [
    timeLabel,
    timeSuffix,
    hour ? `次日${hour}` : "",
    locationLabel,
    locationSuffix
  ].filter(Boolean);
  const indexes = markers
    .map((marker) => prose.indexOf(marker))
    .filter((index) => index >= 0);
  return indexes.length ? Math.min(...indexes) : -1;
}

function findUnauthorizedNamedActorAction(prose: string, allowedActorLabels: string[]) {
  const allowed = new Set(allowedActorLabels);
  const specs = [
    {
      label: "浙江巡抚",
      pattern: /(?:浙江巡抚本人|巡抚本人)|(?:浙江巡抚|巡抚(?!书吏|幕僚|衙门|一方|方面|那边|来文|公文|催问|立场|要求|所))[^\n。！？]{0,28}(?:入(?:了)?(?:内)?厅|进(?:了)?(?:内)?厅|走进|站在|坐下|落座|起身|开口|说道|道：|抬手|目光|行礼|呈上|取出|走到|退后|点头|摇头|穿着|穿青|公服|腰间)/
    },
    {
      label: "清流县令",
      pattern: /清流县令(?!亲随)[^\n。！？]{0,18}(?:入厅|进厅|走进|坐下|起身|开口|说道|道：|抬手|行礼|呈上|取出|点头|摇头)/
    },
    {
      label: "巡抚书吏",
      pattern: /巡抚书吏[^\n。！？]{0,18}(?:入厅|进厅|走进|站在|退在|坐下|起身|开口|说道|道：|捧着|抬手|行礼|呈上|取出|点头|摇头)/
    },
    {
      label: "清流县令亲随",
      pattern: /清流县令亲随[^\n。！？]{0,18}(?:入厅|进厅|走进|站在|退在|坐下|起身|开口|说道|道：|拿着|持着|抬手|行礼|呈上|取出|点头|摇头)/
    },
    {
      label: "巡抚幕僚",
      pattern: /巡抚幕僚[^\n。！？]{0,18}(?:入厅|进厅|走进|站在|坐下|起身|开口|说道|道：|抬手|行礼|呈上|取出|点头|摇头|目光)/
    },
    {
      label: "改桑书吏",
      pattern: /改桑书吏[^\n。！？]{0,18}(?:入厅|进厅|走进|坐下|起身|开口|说道|道：|抬手|行礼|呈上|取出|点头|摇头)/
    },
    {
      label: "江南商会会首",
      pattern: /(?:江南商会会首|商会会首)[^\n。！？]{0,18}(?:入厅|进厅|走进|坐下|起身|开口|说道|道：|抬手|行礼|呈上|取出|点头|摇头)/
    },
    {
      label: "司礼监织造使",
      pattern: /(?:司礼监织造使|织造使)[^\n。！？]{0,18}(?:入厅|进厅|走进|坐下|起身|开口|说道|道：|抬手|行礼|呈上|取出|点头|摇头)/
    }
  ];
  for (const spec of specs) {
    if (allowed.has(spec.label)) continue;
    const match = prose.match(spec.pattern)?.[0];
    if (match) return match;
  }
  return null;
}

function findUnauthorizedMaterialAttribute(
  prose: string,
  authoritativeCorpus: string,
  plan: CompiledStoryContext["sections"]["partOneSettlement"]["items"][number]["narrativePlan"] | null
) {
  const transitionBoundary = plan?.transitionAllowed
    ? transitionBoundaryIndex(prose, plan.sceneEnd.timeLabel, plan.sceneEnd.locationLabel)
    : -1;
  const currentActionWritesDocument = Boolean(
    plan && /(?:写|落笔|签署|签名|具名|批明|批复|记入|写入|行文)/.test(
      plan.actionAlreadyOccurred
    )
  );
  const patterns = [
    /(?:墨迹|字迹|印泥|封条|纸页|纸张|纸角|纸面|册页|公文|密信|文书|封套|令牌)[^。！？]{0,18}(干透|已干|未干|尚新|极新|陈旧|发黄|泛黄|褪色|破损|残损|折痕|印信|虫蛀|发脆|受潮|潮湿|水渍|微卷|卷曲|卷起|发软|变软|铸着|铸有|刻着|刻有)/g,
    /(?:回文匣|空匣|匣子)[^。！？]{0,14}(铜扣|铜锁|锁扣|雕纹|漆色|木纹|裂痕|划痕)/g,
    /(?:墨色|字色|字迹)[^。！？]{0,12}(比别处沉|比别处深|深浅不一|浓淡不一|格外深|格外沉|更深|更沉)/g,
    /(?:砚池|砚台|墨锭)[^。！？]{0,24}(昨日|昨夜|前夜)[^。！？]{0,18}(残渍|墨痕|残墨|干涸)/g
  ];
  for (const pattern of patterns) {
    for (const match of prose.matchAll(pattern)) {
      const phrase = match[0];
      const attribute = match[1] || "";
      const attributeAuthorized =
        attribute !== "干透"
        && Boolean(attribute)
        && authoritativeCorpus.includes(attribute);
      const negativeDryingAuthorized =
        attribute === "干透"
        && /(?:没|未)干透/.test(phrase)
        && /墨迹(?:还没|尚未)干透/.test(authoritativeCorpus);
      const driedAfterAuthorizedTransition =
        currentActionWritesDocument
        && transitionBoundary >= 0
        && (match.index ?? 0) >= transitionBoundary
        && /^(?:已干|干透)$/.test(attribute);
      const inheritedDrynessAuthorized =
        !currentActionWritesDocument
        && /(?:墨迹|字迹)(?:已经|已然|早已|业已)?(?:已)?(?:干透|干了)|(?:墨迹|字迹)已干/.test(
          authoritativeCorpus
        )
        && /(?:墨迹|字迹)/.test(phrase)
        && /^(?:已干|干透)$/.test(attribute);
      const sentenceStart = Math.max(
        prose.lastIndexOf("。", match.index ?? 0),
        prose.lastIndexOf("！", match.index ?? 0),
        prose.lastIndexOf("？", match.index ?? 0)
      ) + 1;
      const sentenceEndCandidates = [
        prose.indexOf("。", match.index ?? 0),
        prose.indexOf("！", match.index ?? 0),
        prose.indexOf("？", match.index ?? 0)
      ].filter((index) => index >= 0);
      const sentenceEnd = sentenceEndCandidates.length
        ? Math.min(...sentenceEndCandidates)
        : prose.length;
      const sentence = prose.slice(sentenceStart, sentenceEnd);
      const benignAdministrativeDryness =
        attribute === "已干"
        && sentence.includes("催办公文")
        && !/(?:今早|今日|昨日|昨夜|新添|补写|改写|伪造|鉴定|鉴伪)/.test(sentence);
      if (
        !authoritativeCorpus.includes(phrase)
        && !attributeAuthorized
        && !negativeDryingAuthorized
        && !driedAfterAuthorizedTransition
        && !inheritedDrynessAuthorized
        && !benignAdministrativeDryness
      ) {
        return phrase;
      }
    }
  }
  return null;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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
