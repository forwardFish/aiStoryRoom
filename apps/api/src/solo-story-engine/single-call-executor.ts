import { transitionAttempt, createAttemptRecord, incrementProviderCallCount } from "./attempt-state";
import { compileSoloStoryContext } from "./context-compiler";
import { validatePlayerIntent } from "./local-validator";
import { parseStoryTurnOutput } from "./output-parser";
import { validateStoryTurnOutput } from "./output-validator";
import { normalizePlayerIntent } from "./player-intent";
import { buildSoloStoryTurnPrompt } from "./prompt-builder";
import { arbitratePlayerIntent } from "./rules-arbiter";
import type { ConfirmedResolution, ExecuteSoloStoryFailure, ExecuteSoloStoryOpeningInput, ExecuteSoloStoryOpeningResult, ExecuteSoloStorySuccess, ExecuteSoloStoryTurnInput, ExecuteSoloStoryTurnResult, PlayerIntent } from "./types";
import { buildGenerationKey } from "./types";

export async function executeSoloStoryTurn(input: ExecuteSoloStoryTurnInput): Promise<ExecuteSoloStoryTurnResult> {
  const normalized = normalizePlayerIntent(input.rawAction);
  let attempt = createAttemptRecord({
    attemptId: input.attemptId,
    generationKey: buildGenerationKey({ attemptId: input.attemptId, playerIntentHash: normalized.ok ? normalized.intent.immutableIntentHash : null, contextSnapshotHash: null })
  });

  if (!normalized.ok) {
    attempt = transitionAttempt(attempt, "REJECTED", normalized.issues[0]?.code || "ACTION_INVALID");
    return { ok: false, attempt, playerIntent: null, issues: normalized.issues };
  }

  const playerIntent = normalized.intent;
  const validation = validatePlayerIntent(playerIntent, input.role, input.availableTargets);
  if (!validation.ok) {
    attempt = transitionAttempt(attempt, validation.decision === "REWRITE_NEEDED" ? "REJECTED" : "REJECTED", validation.issues[0]?.code || "ACTION_REJECTED");
    return { ok: false, attempt, playerIntent, issues: validation.issues };
  }

  const actionResolution = arbitratePlayerIntent({ role: input.role, intent: playerIntent, validation });
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
    availableTargets: input.availableTargets,
    openingTrigger: null,
    maxTokenEstimate: input.maxTokenEstimate ?? 6_000
  });
  if (!compiled.ok) {
    attempt = transitionAttempt(attempt, "REJECTED", compiled.code);
    return { ok: false, attempt, playerIntent, issues: compiled.issues };
  }

  return callWriterOnce({ input, playerIntent, actionResolution, context: compiled.context });
}

export async function executeSoloStoryOpening(input: ExecuteSoloStoryOpeningInput): Promise<ExecuteSoloStoryOpeningResult> {
  const actionResolution: ConfirmedResolution = {
    resolutionId: `opening:${input.openingTrigger.triggerId}`,
    legality: "LEGAL",
    actionType: "OPENING",
    accepted: true,
    acceptedWithCost: false,
    actionStarted: "故事从当前时刻开始，浙江总督尚未作出行动。",
    immediateObservableResult: [],
    summary: "故事从当前时刻开始；浙江总督尚未下令、答复或选择任何行动。",
    costSummary: null,
    consumedLeverageKeys: [],
    pendingConsequences: [],
    factsModelMayStateAsConfirmed: [],
    factsStillUnknown: []
  };
  const compiled = compileSoloStoryContext({
    role: input.role,
    scene: input.scene,
    facts: input.facts,
    recentCanon: input.recentCanon,
    pendingConsequences: input.pendingConsequences,
    activePressures: input.activePressures,
    relevantScriptCards: input.relevantScriptCards,
    actionResolution,
    playerIntent: null,
    availableTargets: input.availableTargets,
    openingTrigger: input.openingTrigger,
    maxTokenEstimate: input.maxTokenEstimate ?? 6_000
  });
  if (!compiled.ok) {
    const attempt = transitionAttempt(createAttemptRecord({
      attemptId: input.attemptId,
      generationKey: buildGenerationKey({ attemptId: input.attemptId, playerIntentHash: null, contextSnapshotHash: null })
    }), "REJECTED", compiled.code);
    return { ok: false, attempt, playerIntent: null, issues: compiled.issues };
  }
  return callWriterOnce({ input, playerIntent: null, actionResolution, context: compiled.context });
}

async function callWriterOnce<TIntent extends PlayerIntent | null>(args: {
  input: ExecuteSoloStoryTurnInput | ExecuteSoloStoryOpeningInput;
  playerIntent: TIntent;
  actionResolution: ConfirmedResolution;
  context: Extract<ReturnType<typeof compileSoloStoryContext>, { ok: true }>["context"];
}): Promise<ExecuteSoloStorySuccess<TIntent> | ExecuteSoloStoryFailure> {
  const { input, playerIntent, actionResolution, context } = args;
  let attempt = createAttemptRecord({
    attemptId: input.attemptId,
    generationKey: buildGenerationKey({ attemptId: input.attemptId, playerIntentHash: playerIntent?.immutableIntentHash || null, contextSnapshotHash: context.snapshotHash })
  });
  attempt = transitionAttempt(attempt, "GENERATING");
  const prompt = buildSoloStoryTurnPrompt(context);

  try {
    await input.onBeforeProviderCall?.();
    attempt = incrementProviderCallCount(attempt);
    const response = await input.transport.generate({
      attemptId: input.attemptId,
      prompt,
      context
    });
    const parsed = parseStoryTurnOutput(response.rawText);
    const validated = validateStoryTurnOutput(parsed, context);
    if (!validated.ok) {
      attempt = transitionAttempt(attempt, "FAILED_RETRYABLE", validated.issues[0]?.code || "OUTPUT_INVALID");
      return { ok: false, attempt, playerIntent, actionResolution, context, prompt, provider: response, issues: validated.issues };
    }
    attempt = transitionAttempt(attempt, "SUCCEEDED");
    return {
      ok: true,
      attempt,
      playerIntent,
      actionResolution,
      context,
      prompt,
      provider: response,
      output: validated.output
    };
  } catch (error) {
    const code = error instanceof SyntaxError ? "MODEL_JSON_INVALID" : "MODEL_CALL_FAILED";
    attempt = transitionAttempt(attempt, "FAILED_RETRYABLE", code);
    return {
      ok: false,
      attempt,
      playerIntent,
      actionResolution,
      context,
      prompt,
      issues: [{ code, message: error instanceof Error ? error.message : String(error) }]
    };
  }
}
