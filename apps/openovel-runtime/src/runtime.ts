import { createHash } from "node:crypto";

/*
 * Turn ordering and failure behavior are derived from Feed-Scription/openovel:
 * src/runtime/sessionProcessor.js and src/lib/narrator.js.
 * Licensed under Apache-2.0. Modified for Our Many Worlds on 2026-07-27.
 */
import {
  activateContextCards,
  buildNarratorMessages,
  buildOptionsMessages,
  compileForegroundContext,
  openingKey,
  previousNarrationOpening,
} from "./foreground.js";
import {
  buildCausalDelta,
} from "./causal-context.js";
import { parseOptions } from "./options.js";
import {
  normalizeNarrativeSurface,
  validateForegroundSurface,
} from "./surface-integrity.js";
import type { AuthoredDecisionAdapter } from "./decision-adapter.js";
import {
  NarrativeSafetyPipeline,
  type ReviewerFailurePolicy,
} from "./narrative-safety.js";
import { FileAtomicTurnRepository, type AtomicNarrativeEvidence } from "./atomic-turn.js";
import type { FileStoryWorkspace } from "./workspace.js";
import type {
  BoundOption,
  EventMirror,
  OpenNovelOption,
  OpenNovelProvider,
  RuntimeWarning,
  TurnEvent,
  TurnResult,
} from "./types.js";
import { isRuntimeActionError } from "./runtime-errors.js";
import { actionConflict } from "./runtime-errors.js";

export class OpenNovelRuntime {
  private readonly foregroundLocks = new Set<string>();

  constructor(
    private readonly workspace: FileStoryWorkspace,
    private readonly provider: OpenNovelProvider,
    private readonly storykeeper: { kick(runId: string): Promise<void> | void },
    private readonly mirror: EventMirror,
    private readonly runtimeOptions: {
      decisionMode?: "MODEL" | "AUTHORED_WHEN_AVAILABLE";
      authoredDecisionAdapter?: AuthoredDecisionAdapter;
      reviewerFailurePolicy?: ReviewerFailurePolicy;
    } = {},
  ) {}

  async createRun(input: {
    runId: string;
    worldId: string;
    roleId: string;
    storyPackageVersion?: string;
    openingVersion?: string;
  }) {
    const run = await this.workspace.createRun(input);
    await this.mirror.publish({ kind: "run.created", runId: input.runId, payload: run }).catch(() => {});
    this.storykeeper.kick(input.runId);
    return run;
  }

  async getRun(runId: string) {
    return this.workspace.readPublicRun(runId);
  }

  async processAction(input: {
    runId: string;
    action: string;
    submissionId?: string;
    expectedStateRevision?: number;
    boundOption?: BoundOption | null;
    onEvent?: (event: TurnEvent) => void;
  }): Promise<TurnResult> {
    const action = String(input.action || "").trim();
    if (!action) throw new Error("action is required");
    if (action.length > 2_000) throw new Error("action is too long");
    if (this.foregroundLocks.has(input.runId)) {
      throw new Error("RUN_FOREGROUND_BUSY");
    }
    this.foregroundLocks.add(input.runId);
    let releaseLease: (() => Promise<void>) | undefined;
    try {
      releaseLease = await this.workspace.acquireForegroundLease(input.runId);
    } catch (error) {
      this.foregroundLocks.delete(input.runId);
      throw error;
    }
    try {
      if (input.expectedStateRevision !== undefined) {
        const current = await this.workspace.metadata(input.runId);
        if (input.expectedStateRevision !== current.turnNumber) {
          throw actionConflict("STATE_REVISION_CONFLICT");
        }
      }
      return await this.runTurn({ ...input, action });
    } catch (error) {
      const message = String((error as Error).message || error);
      if (isRuntimeActionError(error)) {
        await this.workspace.updateMetadata(input.runId, {
          status: "READY",
          lastError: undefined,
        }).catch(() => {});
        await this.workspace.recordSceneEvent(input.runId, {
          type: "foreground_action_rejected",
          action,
          code: error.code,
          status: error.status,
        }).catch(() => {});
        throw error;
      }
      await this.workspace.updateMetadata(input.runId, {
        status: "FAILED",
        lastError: message.slice(0, 1_000),
      }).catch(() => {});
      await this.workspace.recordSceneEvent(input.runId, {
        type: "foreground_failed",
        turnId: `T${String((await this.workspace.metadata(input.runId).catch(() => ({ turnNumber: 0 }))).turnNumber + 1).padStart(2, "0")}`,
        action,
        error: message.slice(0, 1_000),
      }).catch(() => {});
      throw error;
    } finally {
      await releaseLease().catch(() => {});
      this.foregroundLocks.delete(input.runId);
    }
  }

  isBusy(runId: string) {
    return this.foregroundLocks.has(runId);
  }

  private authoredDecisionAdapter() {
    if (this.runtimeOptions.decisionMode !== "AUTHORED_WHEN_AVAILABLE") {
      return undefined;
    }
    return this.runtimeOptions.authoredDecisionAdapter;
  }

  async recoverOptions(runId: string) {
    if (this.foregroundLocks.has(runId)) throw new Error("RUN_FOREGROUND_BUSY");
    this.foregroundLocks.add(runId);
    let releaseLease: (() => Promise<void>) | undefined;
    try {
      releaseLease = await this.workspace.acquireForegroundLease(runId);
      const snapshot = await this.workspace.snapshot(runId);
      if (snapshot.previousOptions.length) throw new Error("OPTIONS_ALREADY_AVAILABLE");
      const committed = await this.workspace.latestCommittedForegroundTurn(runId);
      if (!committed) throw new Error("NO_COMMITTED_TURN_FOR_OPTIONS");
      const expectedTurnId = `T${String(snapshot.metadata.turnNumber).padStart(2, "0")}`;
      if (committed.turnId !== expectedTurnId) throw new Error("LATEST_TURN_MISMATCH");
      const authoredAdapter = this.authoredDecisionAdapter();
      if (authoredAdapter) {
        const authoredOptions = await authoredAdapter.currentOptions(this.workspace, runId);
        if (authoredOptions?.length) {
          await this.workspace.publishTurnOptions(runId, {
            turnId: committed.turnId,
            options: authoredOptions,
            framing: "",
            tension: "reader-directed",
            storyComplete: false,
            warnings: [],
            completedAt: new Date().toISOString(),
          });
          await this.workspace.recordSceneEvent(runId, {
            type: "foreground_authored_options_recovered",
            turnId: committed.turnId,
            optionIds: authoredOptions.map((option) => option.id),
          });
          return {
            turnId: committed.turnId,
            options: authoredOptions,
            framing: "",
            tension: "reader-directed",
            storyComplete: false,
            optionsProvider: undefined,
          };
        }
      }

      const compiled = await compileForegroundContext(this.workspace.paths(runId), snapshot);
      const request = buildOptionsRequest(
        committed.action,
        committed.narration,
        snapshot,
        compiled,
      );
      const attempt = await this.workspace.nextModelCallAttempt(runId, committed.turnId, "options");
      let provider;
      try {
        provider = await this.provider.generate(request);
        await this.workspace.recordModelCall(
          runId,
          committed.turnId,
          "options",
          request,
          provider,
          undefined,
          attempt,
        );
        const parsed = parseOptions(
          provider.text,
          committed.turnId,
          committed.action,
          [],
          optionsKnownContext(compiled, committed.narration),
        );
        await this.workspace.publishTurnOptions(runId, {
          turnId: committed.turnId,
          options: parsed.options,
          framing: parsed.framing,
          tension: parsed.tension,
          storyComplete: parsed.storyComplete,
          warnings: [],
          completedAt: new Date().toISOString(),
        });
        await this.workspace.recordSceneEvent(runId, {
          type: "foreground_options_recovered",
          turnId: committed.turnId,
          attempt,
          optionCount: parsed.options.length,
        });
        return {
          turnId: committed.turnId,
          ...parsed,
          optionsProvider: provider,
        };
      } catch (error) {
        await this.workspace.recordModelCall(
          runId,
          committed.turnId,
          "options",
          request,
          provider,
          error,
          attempt,
        ).catch(() => {});
        await this.workspace.recordSceneEvent(runId, {
          type: "foreground_options_recovery_failed",
          turnId: committed.turnId,
          attempt,
          error: String((error as Error).message || error).slice(0, 1_000),
        }).catch(() => {});
        throw error;
      }
    } finally {
      await releaseLease?.().catch(() => {});
      this.foregroundLocks.delete(runId);
    }
  }

  private async runTurn(input: {
    runId: string;
    action: string;
    submissionId?: string;
    boundOption?: BoundOption | null;
    onEvent?: (event: TurnEvent) => void;
  }) {
    const authoredAdapter = this.authoredDecisionAdapter();
    const atomicRepository = authoredAdapter
      ? new FileAtomicTurnRepository(this.workspace.paths(input.runId))
      : null;
    if (atomicRepository) await atomicRepository.restoreMaterializedViews();
    const snapshot = await this.workspace.snapshot(input.runId);
    const turnNumber = snapshot.metadata.turnNumber + 1;
    const turnId = `T${String(turnNumber).padStart(2, "0")}`;
    const submissionId = normalizeSubmissionId(input.submissionId)
      || deterministicSubmissionId(input.runId, turnId, input.action);
    const alreadyCommitted = atomicRepository
      ? await atomicRepository.resultBySubmission(submissionId, input.action)
      : null;
    if (alreadyCommitted) {
      const currentOptions = await authoredAdapter!.currentOptions(this.workspace, input.runId);
      return { ...alreadyCommitted, options: currentOptions || alreadyCommitted.options };
    }
    const resolvedOption = resolveBoundOption(
      input.boundOption || null,
      snapshot.previousOptions,
      input.action,
    );
    const preparedDecision = authoredAdapter
      ? await authoredAdapter.prepare(this.workspace, {
          runId: input.runId,
          turnNumber,
          action: input.action,
          selectedOption: resolvedOption,
        })
      : null;
    const selectedOption = preparedDecision?.selectedOption || resolvedOption;
    const causalDelta = buildCausalDelta({
      turnId,
      action: input.action,
      selectedOption,
    });
    const emit = (event: TurnEvent) => {
      try {
        input.onEvent?.(event);
      } catch {
        // A disconnected or faulty presentation callback must never change Canon.
      }
    };
    await this.workspace.updateMetadata(input.runId, {
      status: "FOREGROUND_RUNNING",
      lastError: undefined,
    });
    await this.workspace.recordSceneEvent(input.runId, {
      type: "reader_action",
      turnId,
      action: input.action,
      source: selectedOption ? "option" : "free-text",
      selectedOption,
      causalDelta,
    });

    const paths = this.workspace.paths(input.runId);
    await activateContextCards(paths, input.action, snapshot.foregroundGuidance);
    const currentSnapshot = await this.workspace.snapshot(input.runId);
    const compiled = await compileForegroundContext(paths, currentSnapshot);
    const previousOpening = previousNarrationOpening(currentSnapshot);
    const holdNarrationUntilValidated = Boolean(
      causalDelta.forbiddenKnowledge.length > 0
      || causalDelta.beatContract?.sourceRef,
    );
    let narrator;
    try {
      narrator = await this.generateNarration({
        runId: input.runId,
        turnId,
        causalDelta,
        compiled,
        previousOpening,
        onEvent: holdNarrationUntilValidated ? undefined : emit,
      });
    } catch (error) {
      if (!preparedDecision) throw error;
      narrator = {
        text: "",
        model: this.provider.describe().model,
        usage: { inputTokens: 0, outputTokens: 0 },
        latencyMs: 0,
      };
      await this.workspace.recordSceneEvent(input.runId, {
        type: "foreground_narrator_unavailable",
        turnId,
        error: String((error as Error).message || error).slice(0, 500),
      }).catch(() => {});
    }
    const modelLedger: unknown[] = [{
      stage: "narrator",
      model: narrator.model,
      requestId: narrator.requestId || null,
      usage: narrator.usage,
      latencyMs: narrator.latencyMs,
    }];
    let atomicNarrative: AtomicNarrativeEvidence = {
      originalText: narrator.text,
      disposition: "USE_ORIGINAL",
    };
    const reviewWarnings: RuntimeWarning[] = [];
    if (preparedDecision) {
      const originalText = narrator.text;
      const safety = await new NarrativeSafetyPipeline(this.provider, {
        reviewerFailurePolicy: this.runtimeOptions.reviewerFailurePolicy || "SHADOW",
      }).resolve({
        turnId,
        draft: narrator.text,
        previousOpening,
        protectedBlocks: preparedDecision.protectedBlocks,
        fallbackText: preparedDecision.fallbackText,
        truthContext: preparedDecision.truthContext,
      });
      for (const call of safety.calls) {
        modelLedger.push({
          stage: call.stage,
          attempt: call.attempt,
          model: call.result?.model || null,
          requestId: call.result?.requestId || null,
          usage: call.result?.usage || null,
          latencyMs: call.result?.latencyMs || null,
          error: call.error || null,
        });
        await this.workspace.recordModelCall(
          input.runId,
          turnId,
          call.stage,
          call.request,
          call.result,
          call.error ? new Error(call.error) : undefined,
          call.attempt,
        ).catch(() => {});
      }
      narrator = { ...narrator, text: safety.finalText };
      atomicNarrative = {
        originalText,
        repairedText: safety.repairText,
        disposition: safety.disposition,
        originalReview: safety.originalReview,
        finalReview: safety.finalReview,
        originalComparison: safety.originalComparison,
        finalComparison: safety.finalComparison,
        fallbackReason: safety.fallbackReason,
      };
      const shadow = [
        ...(safety.originalComparison?.shadow || []),
        ...(safety.finalComparison?.shadow || []),
      ];
      reviewWarnings.push(...shadow.map((item) => ({
        code: "TRUTH_REVIEW_SHADOW",
        message: item.reason,
        severity: "LOW" as const,
        blocksPlayer: false,
        details: item.exactQuote ? { exactQuote: item.exactQuote } : undefined,
      })));
      await this.workspace.recordSceneEvent(input.runId, {
        type: "foreground_narrative_disposition",
        turnId,
        disposition: safety.disposition,
        originalReview: safety.originalReview || null,
        finalReview: safety.finalReview || null,
        originalComparison: safety.originalComparison || null,
        finalComparison: safety.finalComparison || null,
        fallbackReason: safety.fallbackReason || null,
      }).catch(() => {});
    } else {
      const settledNarrative = String(
        causalDelta.beatContract?.settledNarrative || "",
      ).trim();
      if (settledNarrative) {
        narrator = {
          ...narrator,
          text: normalizeNarrativeSurface(
            `${settledNarrative}\n\n${String(narrator.text || "").trim()}`,
          ),
        };
      }
    }
    narrator = {
      ...narrator,
      text: normalizeNarrativeSurface(narrator.text),
    };
    const surface = validateForegroundSurface(narrator.text, previousOpening);
    if (!surface.ok) {
      await this.workspace.updateMetadata(input.runId, {
        status: "FAILED",
        lastError: surface.reason || "NARRATION_REJECTED",
      });
      throw new Error(surface.reason || "NARRATION_REJECTED");
    }
    const preflightWarnings: RuntimeWarning[] = [
      ...surface.warnings,
      ...reviewWarnings,
    ];
    if (holdNarrationUntilValidated) {
      emit({
        type: "narration.delta",
        data: { text: narrator.text },
      });
    }
    emit({
      type: "narration.complete",
      data: { narration: narrator.text },
    });

    const warnings: RuntimeWarning[] = [...preflightWarnings];
    for (const warning of preflightWarnings) {
      emit({ type: "runtime.warning", data: warning });
      await this.workspace.recordSceneEvent(input.runId, {
        type: "shadow_warning",
        turnId,
        ...warning,
      }).catch(() => {});
    }
    await this.workspace.updateMetadata(input.runId, { status: "COMMITTING" });
    const result: TurnResult = {
      runId: input.runId,
      turnId,
      turnNumber,
      narration: narrator.text,
      options: [],
      framing: "",
      tension: "reader-directed",
      storyComplete: false,
      causalDelta,
      warnings,
      narrator,
      committedAt: new Date().toISOString(),
    };
    if (preparedDecision) {
      const projection = await authoredAdapter!.projectCommit(
        this.workspace,
        input.runId,
        preparedDecision,
      );
      projection.materializedViews = [
        ...await this.workspace.atomicNarrationViews(input.runId, {
          turnId,
          action: input.action,
          result,
          selectedOption,
        }),
        ...(projection.materializedViews || []),
      ];
      await atomicRepository!.commit({
        runId: input.runId,
        submissionId,
        turnId,
        turnNumber,
        action: input.action,
        selectedOption,
        result,
        protectedBlocks: preparedDecision.protectedBlocks,
        narrative: atomicNarrative,
        projection,
        modelLedger,
        previousCanon: currentSnapshot.chapters,
      });
      await atomicRepository!.restoreMaterializedViews();
      await this.workspace.recordSceneEvent(input.runId, {
        type: "foreground_authored_state_committed",
        turnId,
        ...preparedDecision.audit,
      });
    } else {
      await this.workspace.commitNarration(input.runId, {
        turnId,
        action: input.action,
        result,
        selectedOption,
      });
    }
    try {
      await this.workspace.enqueueStorykeeper(input.runId, {
        id: `inbox_${turnId}_${Date.now()}`,
        turnId,
        action: input.action,
        narration: narrator.text,
        recentCanonBefore: compiled.recentCanonExcerpt,
        selectedEffect: selectedOption?.effect || null,
        causalDelta,
        warnings,
        createdAt: result.committedAt,
      });
      Promise.resolve(this.storykeeper.kick(input.runId)).catch(() => {});
    } catch (error) {
      const warning: RuntimeWarning = {
        code: "STORYKEEPER_ENQUEUE_DEFERRED",
        message: String((error as Error).message || error),
        severity: "LOW",
        blocksPlayer: false,
      };
      result.warnings.push(warning);
      emit({ type: "runtime.warning", data: warning });
    }

    let optionsProvider;
    if (preparedDecision) {
      result.options = authoredAdapter!.nextOptions(preparedDecision);
      result.framing = "";
      result.tension = "reader-directed";
      result.storyComplete = preparedDecision.storyComplete;
      emit({
        type: "options.complete",
        data: { options: result.options, framing: result.framing },
      });
      await this.workspace.recordSceneEvent(input.runId, {
        type: "foreground_authored_options",
        turnId,
        optionIds: result.options.map((option) => option.id),
      });
    } else {
      const optionsRequest = buildOptionsRequest(
        input.action,
        narrator.text,
        currentSnapshot,
        compiled,
      );
      try {
        optionsProvider = await this.provider.generate(optionsRequest);
        await this.workspace.recordModelCall(
          input.runId,
          turnId,
          "options",
          optionsRequest,
          optionsProvider,
        ).catch(() => {});
        const parsed = parseOptions(
          optionsProvider.text,
          turnId,
          input.action,
          currentSnapshot.previousOptions,
          optionsKnownContext(compiled, narrator.text),
        );
        result.framing = parsed.framing;
        result.options = parsed.options;
        result.tension = parsed.tension;
        result.storyComplete = parsed.storyComplete;
        result.optionsProvider = optionsProvider;
        emit({ type: "options.complete", data: { options: result.options, framing: result.framing } });
      } catch (error) {
        const message = String((error as Error).message || error);
        await this.workspace.recordModelCall(
          input.runId,
          turnId,
          "options",
          optionsRequest,
          optionsProvider,
          error,
        ).catch(() => {});
        const warning: RuntimeWarning = {
          code: "OPTIONS_UNAVAILABLE",
          message,
          severity: "LOW",
          blocksPlayer: false,
        };
        warnings.push(warning);
        emit({ type: "runtime.warning", data: warning });
        emit({ type: "options.complete", data: { options: [], framing: "", error: message } });
        await this.workspace.recordSceneEvent(input.runId, {
          type: "shadow_warning",
          turnId,
          ...warning,
        }).catch(() => {});
      }
    }

    try {
      await this.workspace.publishTurnOptions(input.runId, {
        turnId,
        options: result.options,
        framing: result.framing,
        tension: result.tension,
        storyComplete: result.storyComplete,
        warnings: result.warnings,
        completedAt: new Date().toISOString(),
      });
    } catch (error) {
      const warning: RuntimeWarning = {
        code: "OPTIONS_PERSIST_FAILED",
        message: String((error as Error).message || error),
        severity: "LOW",
        blocksPlayer: false,
      };
      result.options = [];
      result.framing = "";
      result.warnings.push(warning);
      emit({ type: "runtime.warning", data: warning });
      emit({ type: "options.complete", data: { options: [], framing: "", error: warning.message } });
      await this.workspace.publishTurnOptions(input.runId, {
        turnId,
        options: [],
        framing: "",
        tension: result.tension,
        storyComplete: false,
        warnings: result.warnings,
        completedAt: new Date().toISOString(),
      }).catch(() => {});
    }
    await this.mirror.publish({
      kind: "turn.committed",
      runId: input.runId,
      payload: {
        submissionId: normalizeSubmissionId(input.submissionId),
        result,
      },
    }).catch(async (error) => {
      const warning: RuntimeWarning = {
        code: "DATABASE_MIRROR_DEFERRED",
        message: String((error as Error).message || error),
        severity: "MEDIUM",
        blocksPlayer: false,
      };
      result.warnings.push(warning);
      emit({ type: "runtime.warning", data: warning });
    });
    emit({ type: "turn.committed", data: result });
    return result;
  }

  private async generateNarration(input: {
    runId: string;
    turnId: string;
    causalDelta: ReturnType<typeof buildCausalDelta>;
    compiled: Awaited<ReturnType<typeof compileForegroundContext>>;
    previousOpening: string;
    onEvent?: (event: TurnEvent) => void;
  }) {
    const messages = buildNarratorMessages(
      input.causalDelta,
      input.compiled,
    );
    const stream = new RepeatAwareStream(input.previousOpening, (text) => {
      input.onEvent?.({ type: "narration.delta", data: { text } });
    });
    const request = {
      profile: "narrator" as const,
      messages,
      temperature: narratorTemperature(),
      maxTokens: narratorMaxTokens(),
      json: false,
      stream: true,
      onDelta: (text: string) => stream.push(text),
    };
    let generatedResult;
    try {
      const result = await this.provider.generate(request);
      generatedResult = result;
      stream.finish(result.text);
      if (result.finishReason === "length") {
        throw new Error("MODEL_OUTPUT_TRUNCATED");
      }
      await this.workspace.recordModelCall(
        input.runId,
        input.turnId,
        "narrator",
        request,
        result,
      ).catch(() => {});
      return result;
    } catch (error) {
      await this.workspace.recordModelCall(
        input.runId,
        input.turnId,
        "narrator",
        request,
        generatedResult,
        error,
      ).catch(() => {});
      throw error;
    }
  }
}

function optionsTimeoutMs() {
  const configured = Number(process.env.OPENOVEL_OPTIONS_TIMEOUT_MS || 120_000);
  if (!Number.isFinite(configured)) return 120_000;
  return Math.min(180_000, Math.max(5_000, Math.trunc(configured)));
}

function narratorMaxTokens() {
  const configured = Number(process.env.OPENOVEL_NARRATOR_MAX_TOKENS || 4_000);
  if (!Number.isFinite(configured)) return 4_000;
  return Math.min(8_000, Math.max(2_000, Math.trunc(configured)));
}

function buildOptionsRequest(
  action: string,
  narration: string,
  snapshot: Awaited<ReturnType<FileStoryWorkspace["snapshot"]>>,
  compiled: Awaited<ReturnType<typeof compileForegroundContext>>,
) {
  return {
    profile: "options" as const,
    messages: buildOptionsMessages(action, narration, snapshot, compiled),
    temperature: 0.55,
    maxTokens: 1_200,
    json: true,
    // GLM's OpenAI-compatible endpoint is materially more reliable for
    // structured output when streamed. This remains a separate post-Canon
    // Options call; streaming here is transport, not UI narration.
    stream: true,
    timeoutMs: optionsTimeoutMs(),
  };
}

function optionsKnownContext(
  compiled: Awaited<ReturnType<typeof compileForegroundContext>>,
  narration: string,
) {
  return [
    compiled.foregroundGuidance,
    compiled.durableMemory,
    compiled.storyMemory,
    compiled.recentCanonExcerpt,
    narration,
  ].filter(Boolean).join("\n");
}

function normalizeSubmissionId(value: unknown) {
  const id = String(value || "").trim();
  return /^[A-Za-z0-9_-]{6,128}$/.test(id) ? id : null;
}

function deterministicSubmissionId(runId: string, turnId: string, action: string) {
  const digest = createHash("sha256")
    .update(`${runId}\0${turnId}\0${action}`, "utf8")
    .digest("hex")
    .slice(0, 24);
  return `auto_${turnId}_${digest}`;
}

function narratorTemperature() {
  const configured = Number(process.env.OPENOVEL_NARRATOR_TEMPERATURE || 0.86);
  return Number.isFinite(configured)
    ? Math.max(0.2, Math.min(1.2, configured))
    : 0.86;
}

class RepeatAwareStream {
  private buffer = "";
  private decided = false;
  private repeated = false;

  constructor(
    private readonly previousOpening: string,
    private readonly forward: (text: string) => void,
  ) {}

  push(text: string) {
    if (this.decided) {
      if (!this.repeated) this.forward(text);
      return;
    }
    this.buffer += text;
    const current = openingKey(this.buffer);
    if (!this.previousOpening) {
      this.decide(false);
      return;
    }
    if (!this.previousOpening.startsWith(current)) {
      this.decide(false);
      return;
    }
    if (current.length >= this.previousOpening.length) this.decide(true);
  }

  finish(fullText: string) {
    if (!this.decided) {
      const repeated = Boolean(this.previousOpening)
        && openingKey(fullText) === this.previousOpening;
      this.decide(repeated);
    }
    return this.repeated;
  }

  private decide(repeated: boolean) {
    this.decided = true;
    this.repeated = repeated;
    if (!repeated && this.buffer) this.forward(this.buffer);
    this.buffer = "";
  }
}

function resolveBoundOption(
  bound: BoundOption | null,
  options: OpenNovelOption[],
  action: string,
) {
  if (!bound) return null;
  const match = options.find((option) => option.id === bound.id && option.label === bound.label);
  if (!match || match.label !== action) return null;
  return match;
}
