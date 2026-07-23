import { transitionAttempt, createAttemptRecord, incrementProviderCallCount } from "./attempt-state";
import { compileSoloStoryContext } from "./context-compiler";
import { buildSoloDecisionPrompt } from "./decision-prompt-builder";
import { validatePlayerIntent } from "./local-validator";
import { buildSoloNarratorPrompt } from "./narrator-prompt-builder";
import { parseDecisionCopyOutput, parseNarratorDraft } from "./output-parser";
import {
  validateDecisionCopy,
  validateNarratorDraft,
  validateStoryTurnOutput
} from "./output-validator";
import { normalizePlayerIntent } from "./player-intent";
import { bindStoryTurnReferences } from "./reference-binder";
import { arbitratePlayerIntent } from "./rules-arbiter";
import type {
  CompiledStoryContext,
  ConfirmedResolution,
  ExecuteSoloStoryFailure,
  ExecuteSoloStorySuccess,
  ExecuteSoloStoryTurnInput,
  ExecuteSoloStoryTurnResult,
  PlayerIntent,
  StoryDecision,
  StoryDecisionCopyOutput,
  StoryNarratorDraft,
  StoryProviderStage,
  StoryTurnPublishedOutput,
  StoryTurnTransportResponse,
  ValidationIssue
} from "./types";
import { buildGenerationKey } from "./types";

/**
 * One atomic generation attempt with two role-separated provider calls:
 *
 * 1. Narrator returns prose only.
 * 2. Decision editor reads the accepted prose endpoint and returns copy only.
 *
 * No fallback prose, option template, provider retry, or post-generation prose
 * rewrite exists in this executor.
 */
export async function executeSoloStoryTurn(
  input: ExecuteSoloStoryTurnInput
): Promise<ExecuteSoloStoryTurnResult> {
  const normalized = normalizePlayerIntent(input.rawAction);
  let attempt = createAttemptRecord({
    attemptId: input.attemptId,
    generationKey: buildGenerationKey({
      attemptId: input.attemptId,
      playerIntentHash: normalized.ok ? normalized.intent.immutableIntentHash : null,
      contextSnapshotHash: null
    })
  });

  if (!normalized.ok) {
    attempt = transitionAttempt(
      attempt,
      "REJECTED",
      normalized.issues[0]?.code || "ACTION_INVALID"
    );
    return { ok: false, attempt, playerIntent: null, issues: normalized.issues };
  }

  const playerIntent = normalized.intent;
  const validation = validatePlayerIntent(playerIntent, input.role, input.availableTargets);
  if (!validation.ok) {
    attempt = transitionAttempt(
      attempt,
      "REJECTED",
      validation.issues[0]?.code || "ACTION_REJECTED"
    );
    return { ok: false, attempt, playerIntent, issues: validation.issues };
  }

  const actionResolution = arbitratePlayerIntent({
    role: input.role,
    intent: playerIntent,
    validation
  });
  const compiled = compileSoloStoryContext({
    role: input.role,
    scene: input.scene,
    facts: input.facts,
    recentCanon: input.recentCanon,
    pendingConsequences: input.pendingConsequences,
    activePressures: input.activePressures,
    relevantScriptCards: input.relevantScriptCards,
    actionResolution,
    playerIntent,
    availableTargets: input.nextAvailableTargets || input.availableTargets,
    openingTrigger: null,
    partOneRuntime: input.partOneRuntime || null,
    partOneSettlement: input.partOneSettlement || null,
    maxTokenEstimate: input.maxTokenEstimate ?? 6_000
  });
  if (!compiled.ok) {
    attempt = transitionAttempt(attempt, "REJECTED", compiled.code);
    return { ok: false, attempt, playerIntent, issues: compiled.issues };
  }

  return executeTwoStageWriter({
    input,
    playerIntent,
    actionResolution,
    context: compiled.context
  });
}

async function executeTwoStageWriter(args: {
  input: ExecuteSoloStoryTurnInput;
  playerIntent: PlayerIntent;
  actionResolution: ConfirmedResolution;
  context: CompiledStoryContext;
}): Promise<ExecuteSoloStorySuccess<PlayerIntent> | ExecuteSoloStoryFailure> {
  const { input, playerIntent, actionResolution, context } = args;
  let attempt = createAttemptRecord({
    attemptId: input.attemptId,
    generationKey: buildGenerationKey({
      attemptId: input.attemptId,
      playerIntentHash: playerIntent.immutableIntentHash,
      contextSnapshotHash: context.snapshotHash
    })
  });
  attempt = transitionAttempt(attempt, "GENERATING");
  const narratorPrompt = buildSoloNarratorPrompt(context);
  let narratorProvider: StoryTurnTransportResponse | undefined;
  let decisionProvider: StoryTurnTransportResponse | undefined;
  let decisionPrompt: ReturnType<typeof buildSoloDecisionPrompt> | undefined;

  try {
    await input.onBeforeProviderCall?.("NARRATOR");
    attempt = incrementProviderCallCount(attempt, "NARRATOR");
    narratorProvider = await input.transport.generate({
      attemptId: input.attemptId,
      stage: "NARRATOR",
      prompt: narratorPrompt,
      context,
      onTextDelta: input.onProviderTextDelta
    });
    requireProviderStage(narratorProvider, "NARRATOR");
  } catch (error) {
    return fail({
      attempt,
      playerIntent,
      actionResolution,
      context,
      failedStage: "NARRATOR",
      narratorPrompt,
      narratorProvider,
      error,
      defaultCode: "NARRATOR_PROVIDER_FAILED"
    });
  }

  let narration: StoryNarratorDraft;
  try {
    narration = parseNarratorDraft(narratorProvider.rawText);
  } catch (error) {
    return fail({
      attempt,
      playerIntent,
      actionResolution,
      context,
      failedStage: "NARRATOR",
      narratorPrompt,
      narratorProvider,
      error,
      defaultCode: "NARRATOR_OUTPUT_INVALID"
    });
  }
  const narrationValidation = validateNarratorDraft(narration, context);
  if (!narrationValidation.ok) {
    attempt = transitionAttempt(
      attempt,
      "FAILED_RETRYABLE",
      narrationValidation.issues[0]?.code || "NARRATOR_OUTPUT_INVALID"
    );
    return {
      ok: false,
      attempt,
      playerIntent,
      actionResolution,
      context,
      failedStage: "NARRATOR",
      narratorPrompt,
      narratorProvider,
      issues: narrationValidation.issues
    };
  }

  decisionPrompt = buildSoloDecisionPrompt(context, narration);
  let decisionCopy: StoryDecisionCopyOutput;
  try {
    await input.onBeforeProviderCall?.("DECISION");
    attempt = incrementProviderCallCount(attempt, "DECISION");
    decisionProvider = await input.transport.generate({
      attemptId: input.attemptId,
      stage: "DECISION",
      prompt: decisionPrompt,
      context
    });
    requireProviderStage(decisionProvider, "DECISION");
    decisionCopy = parseDecisionCopyOutput(decisionProvider.rawText);
  } catch (error) {
    return fail({
      attempt,
      playerIntent,
      actionResolution,
      context,
      failedStage: "DECISION",
      narratorPrompt,
      decisionPrompt,
      narratorProvider,
      decisionProvider,
      error,
      defaultCode: "DECISION_OUTPUT_INVALID"
    });
  }
  const decisionValidation = validateDecisionCopy(decisionCopy, context);
  if (!decisionValidation.ok) {
    attempt = transitionAttempt(
      attempt,
      "FAILED_RETRYABLE",
      decisionValidation.issues[0]?.code || "DECISION_OUTPUT_INVALID"
    );
    return {
      ok: false,
      attempt,
      playerIntent,
      actionResolution,
      context,
      failedStage: "DECISION",
      narratorPrompt,
      decisionPrompt,
      narratorProvider,
      decisionProvider,
      issues: decisionValidation.issues
    };
  }

  const output = buildPublishedOutput({
    context,
    narration,
    decisionCopy
  });
  const bound = bindStoryTurnReferences(output, context);
  if (
    bound.resultType !== "PUBLISHED_TURN"
    || bound.story.resultNarrative !== narration.resultNarrative
    || bound.story.nextSituationNarrative !== narration.nextSituationNarrative
  ) {
    attempt = transitionAttempt(attempt, "FAILED_RETRYABLE", "NARRATIVE_IMMUTABILITY_BROKEN");
    return {
      ok: false,
      attempt,
      playerIntent,
      actionResolution,
      context,
      failedStage: "DECISION",
      narratorPrompt,
      decisionPrompt,
      narratorProvider,
      decisionProvider,
      issues: [{
        code: "NARRATIVE_IMMUTABILITY_BROKEN",
        message: "服务器绑定阶段改变了 Narrator 正文。"
      }]
    };
  }
  const validated = validateStoryTurnOutput(bound, context);
  if (!validated.ok) {
    attempt = transitionAttempt(
      attempt,
      "FAILED_RETRYABLE",
      validated.issues[0]?.code || "OUTPUT_INVALID"
    );
    return {
      ok: false,
      attempt,
      playerIntent,
      actionResolution,
      context,
      failedStage: "DECISION",
      narratorPrompt,
      decisionPrompt,
      narratorProvider,
      decisionProvider,
      issues: validated.issues
    };
  }

  attempt = transitionAttempt(attempt, "SUCCEEDED");
  return {
    ok: true,
    attempt,
    playerIntent,
    actionResolution,
    context,
    narratorPrompt,
    decisionPrompt,
    narratorProvider,
    decisionProvider,
    output: validated.output
  };
}

function buildPublishedOutput(input: {
  context: CompiledStoryContext;
  narration: StoryNarratorDraft;
  decisionCopy: StoryDecisionCopyOutput;
}): StoryTurnPublishedOutput {
  const { context, narration, decisionCopy } = input;
  const runtime = context.sections.partOneRuntime.items[0] || null;
  const scene = context.sections.currentScene.items[0] || null;
  const event = context.sections.partOneSettlement.items[0] || null;
  const decisions = decisionCopy.decisions.map((copy, index) => {
    const basis = runtime?.decisionAffordances.find((route) =>
      route.affordanceTemplateId === copy.routeKey
    );
    const fallbackTarget = context.availableTargets[index]
      || context.availableTargets.find((target) => target.type === "PUBLIC_FRAME")
      || { type: "PUBLIC_FRAME" as const, id: "public_frame", label: "当前局势" };
    const target = basis?.target || fallbackTarget;
    const groundingIds = [
      target.id,
      scene?.sceneId ? `scene:${scene.sceneId}` : null,
      runtime ? `part-one-runtime:${runtime.retrievalTrace.decisionKernelId}` : null
    ].filter((value): value is string =>
      Boolean(value) && context.allowedReferences.groundingIds.includes(value as string)
    );
    return {
      decisionId: `d${index + 1}`,
      label: basis?.title || copy.description,
      description: copy.description,
      intent: basis?.immediateIntent || copy.description,
      targetRef: target,
      method: basis?.method || copy.description,
      leverageKeys: [],
      visibility: "OBSERVABLE",
      riskTolerance: "MEDIUM",
      distinctAxis: basis?.method || target.type,
      concreteCost: basis?.visibleTradeoff || "另一项压力会继续累积",
      expectedCountermove: hiddenCountermove(basis?.visibleTradeoff),
      groundingIds: [...new Set(groundingIds)],
      decisionKernelId: basis?.decisionKernelId,
      affordanceTemplateId: basis?.affordanceTemplateId
    } satisfies StoryDecision;
  });
  const paidConsequenceIds = context.sections.pendingConsequences.items
    .filter((consequence) => consequence.priority === "P0")
    .map((consequence) => consequence.consequenceId);
  const visibleChanges = event
    ? [
        ...event.authoritativeObservableFacts,
        ...event.authoritativeNpcReactions.map((reaction) => reaction.action)
      ]
    : context.actionResolution.immediateObservableResult;
  const presentEntityRefs = event
    ? [...new Set(event.authoritativeNpcReactions.flatMap((reaction) => reaction.actorRefs))]
      .filter((ref) => context.allowedReferences.entityRefs.includes(ref))
    : [];

  return {
    schemaVersion: "solo-story-turn-v1",
    resultType: "PUBLISHED_TURN",
    story: {
      title: runtime?.section.title || scene?.title || "眼前的局势",
      resultNarrative: narration.resultNarrative,
      nextSituationNarrative: narration.nextSituationNarrative
    },
    resolution: {
      confirmedResolutionId: context.actionResolution.resolutionId,
      outcome: context.actionResolution.accepted ? "APPLIED" : "BLOCKED",
      observableOutcome: visibleChanges.join("；") || context.actionResolution.summary
    },
    endingState: {
      timeLabel: scene?.timeLabel || "",
      locationLabel: scene?.locationLabel || "",
      tension: runtime?.nextDecisionPressure?.summary || scene?.situation || "",
      presentEntityRefs,
      visibleChanges,
      surfacedConsequenceIds: paidConsequenceIds
    },
    decisions,
    grounding: {
      usedScriptSourceIds: [...context.allowedReferences.scriptSourceIds],
      usedStoryCardIds: [...context.allowedReferences.storyCardIds],
      usedCanonFactIds: [...context.allowedReferences.canonFactIds],
      advancedMainlineQuestionIds: [...context.allowedReferences.mainlineQuestionIds],
      paidPendingConsequenceIds: paidConsequenceIds,
      stagedDirectedBeatId: context.allowedReferences.directedBeatIds[0] || null,
      deferredConsequences: []
    }
  };
}

function hiddenCountermove(visibleTradeoff?: string) {
  return visibleTradeoff
    ? `受影响的一方会利用程序、时限或责任归属放大这项代价：${visibleTradeoff}`
    : "受影响的一方会利用程序、时限或责任归属要求书面回应。";
}

function requireProviderStage(
  response: StoryTurnTransportResponse,
  stage: StoryProviderStage
) {
  if (response.stage !== stage) throw new Error(`PROVIDER_STAGE_MISMATCH:${response.stage}:${stage}`);
}

function fail(input: {
  attempt: ReturnType<typeof createAttemptRecord>;
  playerIntent: PlayerIntent;
  actionResolution: ConfirmedResolution;
  context: CompiledStoryContext;
  failedStage: StoryProviderStage;
  narratorPrompt: ReturnType<typeof buildSoloNarratorPrompt>;
  decisionPrompt?: ReturnType<typeof buildSoloDecisionPrompt>;
  narratorProvider?: StoryTurnTransportResponse;
  decisionProvider?: StoryTurnTransportResponse;
  error: unknown;
  defaultCode: string;
}): ExecuteSoloStoryFailure {
  const message = input.error instanceof Error ? input.error.message : String(input.error);
  const code = stableFailureCode(message, input.defaultCode);
  const attempt = transitionAttempt(input.attempt, "FAILED_RETRYABLE", code);
  return {
    ok: false,
    attempt,
    playerIntent: input.playerIntent,
    actionResolution: input.actionResolution,
    context: input.context,
    failedStage: input.failedStage,
    narratorPrompt: input.narratorPrompt,
    decisionPrompt: input.decisionPrompt,
    narratorProvider: input.narratorProvider,
    decisionProvider: input.decisionProvider,
    issues: [{ code, message }]
  };
}

function stableFailureCode(message: string, fallback: string) {
  const candidate = message.match(/(?:NARRATOR|DECISION|PROVIDER)_[A-Z0-9_]+/)?.[0];
  return candidate || fallback;
}
