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
  authorizedNarrativeIntent,
  buildCausalDelta,
} from "./causal-delta.js";
import { validateDurableTruth } from "./durable-truth-gate.js";
import { parseOptions } from "./options.js";
import {
  normalizeCanonicalRoleTerms,
  normalizeNarrativeSurface,
  validateForegroundSurface,
} from "./surface-guard.js";
import {
  commitSangtianDecision,
  currentSangtianOptions,
  nextSangtianOptions,
  prepareSangtianDecision,
} from "./sangtian-decisions.js";
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

export class OpenNovelRuntime {
  private readonly foregroundLocks = new Set<string>();

  constructor(
    private readonly workspace: FileStoryWorkspace,
    private readonly provider: OpenNovelProvider,
    private readonly storykeeper: { kick(runId: string): Promise<void> | void },
    private readonly mirror: EventMirror,
    private readonly runtimeOptions: {
      decisionMode?: "MODEL" | "AUTHORED_WHEN_AVAILABLE";
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
      return await this.runTurn({ ...input, action });
    } catch (error) {
      const message = String((error as Error).message || error);
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
      if (this.runtimeOptions.decisionMode === "AUTHORED_WHEN_AVAILABLE") {
        const authoredOptions = await currentSangtianOptions(this.workspace, runId);
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
    const snapshot = await this.workspace.snapshot(input.runId);
    const turnNumber = snapshot.metadata.turnNumber + 1;
    const turnId = `T${String(turnNumber).padStart(2, "0")}`;
    const resolvedOption = resolveBoundOption(
      input.boundOption || null,
      snapshot.previousOptions,
      input.action,
    );
    const preparedDecision = this.runtimeOptions.decisionMode === "AUTHORED_WHEN_AVAILABLE"
      ? await prepareSangtianDecision(this.workspace, {
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
    const playerAuthorizedAction = [
      causalDelta.readerAction,
      authorizedNarrativeIntent(causalDelta.immediateIntent),
      ...(causalDelta.beatContract?.authorizedPlayerActions || []),
    ].filter(Boolean).join("\n");
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
    let narrator = await this.generateNarration({
      runId: input.runId,
      turnId,
      causalDelta,
      compiled,
      previousOpening,
      onEvent: holdNarrationUntilValidated ? undefined : emit,
    });
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
      await this.workspace.recordSceneEvent(input.runId, {
        type: "foreground_settled_narrative_applied",
        turnId,
        sourceRef: causalDelta.beatContract?.sourceRef || null,
      }).catch(() => {});
    }
    narrator = {
      ...narrator,
      text: normalizeCanonicalRoleTerms(
        normalizeNarrativeSurface(narrator.text),
        currentSnapshot.metadata.worldId,
        currentSnapshot.metadata.roleId,
      ),
    };
    let surface = validateForegroundSurface(narrator.text, previousOpening);
    if (!surface.ok) {
      await this.workspace.updateMetadata(input.runId, {
        status: "FAILED",
        lastError: surface.reason || "NARRATION_REJECTED",
      });
      throw new Error(surface.reason || "NARRATION_REJECTED");
    }
    // OPENOVEL_V1 keeps uncertain location/custody claims in Shadow, but a
    // narrator may never invent a consequential player command, exact
    // evidence content, secret, transfer, or secrecy order. Those are true
    // authority-boundary failures and are rejected before Options or Canon.
    const knownContext = [
      compiled.foregroundGuidance,
      compiled.durableMemory,
      compiled.storyMemory,
      compiled.recentCanonExcerpt,
    ].join("\n");
    const policy = durablePolicy(
      currentSnapshot.metadata.worldId,
      causalDelta.evidenceSubjects,
      preparedDecision?.settlement.event.sceneBefore.objectStates,
      preparedDecision?.settlement.event.narrativePlan.incidentalTextureAllowances,
    );
    const auditNarration = (text: string, checkedSurface = validateForegroundSurface(
      text,
      previousOpening,
    )) => {
      const durableAudit = validateDurableTruth({
        narration: text,
        readerAction: playerAuthorizedAction,
        knownContext,
        causalDelta,
        authorizedWorldMoves: [
          ...(causalDelta.beatContract?.moves || []),
          causalDelta.beatContract?.stopCondition || "",
        ].join("\n"),
        policy,
      });
      const preflightWarnings: RuntimeWarning[] = [
        ...checkedSurface.warnings,
        ...durableAudit.shadowWarnings,
        ...durableAudit.hardIssues,
      ];
      return { surface: checkedSurface, preflightWarnings };
    };
    const audited = auditNarration(narrator.text, surface);
    const preflightWarnings = audited.preflightWarnings;
    const blockingWarning = preflightWarnings.find(isForegroundBlockingWarning);
    // P0 Durable Truth is never repaired by deleting or rewriting prose.
    // A clear violation is retained as evidence and rejected; all ambiguous
    // findings have already been downgraded to non-blocking Shadow warnings.
    if (blockingWarning) {
      await this.workspace.recordSceneEvent(input.runId, {
        type: "foreground_rejected",
        turnId,
        code: blockingWarning.code,
        message: blockingWarning.message,
        details: blockingWarning.details,
      }).catch(() => {});
      await this.workspace.recordShadowAudit(input.runId, {
        runId: input.runId,
        turnId,
        readerAction: input.action,
        suspectedDurableConflicts: [blockingWarning.message],
        authorityWarnings: [blockingWarning.message],
        severity: "HIGH",
        blocksPlayer: true,
        observedAt: new Date().toISOString(),
      }).catch(() => {});
      throw new Error(blockingWarning.code);
    }
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
    await this.workspace.recordShadowAudit(input.runId, {
      runId: input.runId,
      turnId,
      readerAction: input.action,
      suspectedDurableConflicts: preflightWarnings
        .filter((warning) => warning.severity === "HIGH")
        .map((warning) => warning.message),
      knowledgeWarnings: preflightWarnings
        .filter((warning) => warning.code.includes("SECRET"))
        .map((warning) => warning.message),
      authorityWarnings: preflightWarnings
        .filter((warning) => /ACTION|COMMITMENT|AUTHORITY/.test(warning.code))
        .map((warning) => warning.message),
      sectionDriftWarnings: [],
      severity: preflightWarnings.some((warning) => warning.severity === "HIGH")
        ? "HIGH"
        : preflightWarnings.some((warning) => warning.severity === "MEDIUM")
          ? "MEDIUM"
          : preflightWarnings.length ? "LOW" : "NONE",
      blocksPlayer: false,
      observedAt: new Date().toISOString(),
    }).catch(() => {});

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
    await this.workspace.commitNarration(input.runId, {
      turnId,
      action: input.action,
      result,
      selectedOption,
    });
    if (preparedDecision) {
      await commitSangtianDecision(
        this.workspace,
        input.runId,
        preparedDecision,
        narrator.text,
      );
      await this.workspace.recordSceneEvent(input.runId, {
        type: "foreground_authored_state_committed",
        turnId,
        eventId: preparedDecision.settlement.event.eventId,
        decisionKernelId: preparedDecision.settlement.event.decisionKernelId,
        affordanceTemplateId:
          preparedDecision.settlement.event.affordanceTemplateId,
        changedStatePaths:
          preparedDecision.settlement.event.changedStatePaths,
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
      const authoredOptions = nextSangtianOptions(preparedDecision);
      if (authoredOptionsNeedNarrativeBridge(narrator.text, authoredOptions)) {
        const optionsRequest = buildOptionsRequest(
          input.action,
          narrator.text,
          currentSnapshot,
          compiled,
          true,
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
          result.options = parsed.options.slice(0, 2);
          result.tension = parsed.tension;
          result.storyComplete = parsed.storyComplete;
          result.optionsProvider = optionsProvider;
          emit({ type: "options.complete", data: { options: result.options, framing: result.framing } });
          await this.workspace.recordSceneEvent(input.runId, {
            type: "foreground_narrative_bridge_options",
            turnId,
            authoredDecisionKernelId: authoredOptions[0]?.id.split("-OPT-")[0] || null,
            optionIds: result.options.map((option) => option.id),
          });
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
        }
      } else {
        result.options = authoredOptions;
        result.framing = "";
        result.tension = "reader-directed";
        result.storyComplete =
          preparedDecision.settlement.proposedState.partCompletionStatus ===
          "HANDOFF_READY";
        emit({
          type: "options.complete",
          data: { options: result.options, framing: result.framing },
        });
        await this.workspace.recordSceneEvent(input.runId, {
          type: "foreground_authored_options",
          turnId,
          decisionKernelId: result.options[0]?.id.split("-OPT-")[0] || null,
          optionIds: result.options.map((option) => option.id),
        });
      }
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
    const baseMessages = buildNarratorMessages(
      input.causalDelta,
      input.compiled,
    );
    let lastError: unknown;
    for (let attempt = 1; attempt <= (input.previousOpening ? 2 : 1); attempt += 1) {
      const messages = attempt === 1
        ? baseMessages
        : [
            ...baseMessages,
            {
              role: "user" as const,
              content: "上一稿完整重复了 Recent Canon 的开头。丢弃那一稿，从 Canon 最后一句之后写全新的向前 beat；不要复述或换词重演。",
            },
          ];
      const stream = new RepeatAwareStream(input.previousOpening, (text) => {
        input.onEvent?.({ type: "narration.delta", data: { text } });
      });
      const request = {
        profile: "narrator" as const,
        messages,
        temperature: narratorTemperature(input.causalDelta),
        // Match OpenNovel's fast-register runaway ceiling. The prose contract
        // owns the natural stop; this ceiling only prevents a model from
        // streaming an entire scene after it has passed the next decision.
        // GLM may count hidden deliberation against max_tokens even when its
        // relay is asked to disable thinking. A 2k ceiling produced a
        // 139-character half-sentence with completion_tokens=2000. Leave room
        // for deliberation while the prose contract still caps visible text.
        maxTokens: narratorMaxTokens(),
        json: false,
        stream: true,
        onDelta: (text: string) => stream.push(text),
      };
      let generatedResult;
      let modelCallRecorded = false;
      try {
        const result = await this.provider.generate(request);
        generatedResult = result;
        const repeated = stream.finish(result.text);
        if (result.finishReason === "length") {
          const truncation = new Error("MODEL_OUTPUT_TRUNCATED");
          await this.workspace.recordModelCall(
            input.runId,
            input.turnId,
            "narrator",
            request,
            result,
            truncation,
            attempt,
          ).catch(() => {});
          modelCallRecorded = true;
          throw truncation;
        }
        await this.workspace.recordModelCall(
          input.runId,
          input.turnId,
          "narrator",
          request,
          result,
          undefined,
          attempt,
        ).catch(() => {});
        modelCallRecorded = true;
        if (repeated && attempt === 1) {
          lastError = new Error("REPEATED_OPENING");
          continue;
        }
        const validation = validateForegroundSurface(result.text, input.previousOpening);
        if (!validation.ok && validation.reason === "REPEATED_OPENING" && attempt === 1) {
          lastError = new Error(validation.reason);
          continue;
        }
        return result;
      } catch (error) {
        lastError = error;
        if (!modelCallRecorded) {
          await this.workspace.recordModelCall(
            input.runId,
            input.turnId,
            "narrator",
            request,
            generatedResult,
            error,
            attempt,
          ).catch(() => {});
        }
        if (attempt === 1 && String((error as Error).message).includes("REPEATED_OPENING")) continue;
        throw error;
      }
    }
    throw lastError || new Error("Narrator failed");
  }
}

function isForegroundBlockingWarning(warning: RuntimeWarning) {
  return warning.blocksPlayer === true;
}

/**
 * Curated affordances remain the causal backbone, but they must not replace an
 * unanswered question at the actual end of Canon. When the ending asks about
 * a different institutional axis, let the separate Options model offer one
 * conversational bridge first. Selecting that bridge is treated as free text;
 * the authored decision kernel remains open for the following turn.
 */
export function authoredOptionsNeedNarrativeBridge(
  narration: string,
  authoredOptions: OpenNovelOption[],
) {
  if (!authoredOptions.length) return false;
  const tail = actualDecisionTail(narration);
  if (!tail) {
    return false;
  }
  const topicPatterns = [
    /(?:责任|担责|具名|署名|干系)/u,
    /(?:签发|落印|回文|放行|试办|照办|压价)/u,
    /(?:复核|清单|见证|主持|查验)/u,
    /(?:原册|县册|封样|封条|保管|移交|抄录)/u,
    /(?:奏报|具报|入京|京师)/u,
    /(?:粮价|米价|开仓|赈粮|粮食)/u,
  ];
  const endingTopics = topicPatterns.filter((pattern) => pattern.test(tail));
  if (!endingTopics.length) return false;
  return !authoredOptions.every((option) => (
    endingTopics.some((pattern) => pattern.test(authoredOptionDecisionText(option)))
  ));
}

function authoredOptionDecisionText(option: OpenNovelOption) {
  return [
    option.label,
    option.effect?.intent,
    authoredKernelCapabilities(option.id),
  ].filter(Boolean).join("\n");
}

function authoredKernelCapabilities(optionId: string) {
  const id = String(optionId || "");
  if (id.includes("EXECUTION-SCOPE")) {
    return "签发 落印 回文 放行 试办 照办 压价 复核范围 复核方式";
  }
  if (id.includes("CUSTODY") || id.includes("WITNESS") || id.includes("PROCEDURE")) {
    return "复核 原册 县册 封样 封条 保管 移交 抄录 查验 见证 主持";
  }
  if (id.includes("RESPONSIBILITY")) {
    return "责任 担责 具名 署名 联署 干系";
  }
  if (id.includes("REPORT") || id.includes("CAPITAL")) {
    return "奏报 具报 入京 京师 署名 附件";
  }
  if (id.includes("GRAIN") || id.includes("MERCHANT") || id.includes("LAND")) {
    return "粮价 米价 开仓 赈粮 粮食 商会 民田 买田";
  }
  return "";
}

function actualDecisionTail(narration: string) {
  const tail = String(narration || "").trim().slice(-520);
  if (!tail) return "";
  const questionIndex = Math.max(tail.lastIndexOf("？"), tail.lastIndexOf("?"));
  if (questionIndex >= 0) {
    const before = tail.slice(0, questionIndex);
    const sentenceStart = Math.max(
      before.lastIndexOf("。"),
      before.lastIndexOf("！"),
      before.lastIndexOf("!"),
      before.lastIndexOf("\n"),
    );
    return tail.slice(Math.max(sentenceStart + 1, questionIndex - 180), questionIndex + 1);
  }
  const demand = tail.match(
    /((?:要|须|请).{0,48}(?:说清|示下|答复|回话)|(?:等|候).{0,36}(?:回答|答复|回话))[^。！\n]*[。！]?$/u,
  );
  return demand?.[1] || "";
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
  narrativeBridge = false,
) {
  const optionsSnapshot = narrativeBridge
    ? {
        ...snapshot,
        // A bridge exists precisely because the curated kernel does not answer
        // the last spoken question. Do not let its stale menu philosophy pull
        // the model away from the actual ending again.
        optionsGuidance: "只围绕 narrative_so_far 最后一项尚待回答的问题给出直接行动。",
      }
    : snapshot;
  return {
    profile: "options" as const,
    messages: buildOptionsMessages(action, narration, optionsSnapshot, compiled),
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

function narratorTemperature(delta?: ReturnType<typeof buildCausalDelta>) {
  const configured = Number(process.env.OPENOVEL_NARRATOR_TEMPERATURE || 0.86);
  const base = Number.isFinite(configured)
    ? Math.max(0.2, Math.min(1.2, configured))
    : 0.86;
  const hasSceneTransition = Boolean(delta && hasAuthoredSceneTransition(delta));
  const hasQuantitativeCeiling = (delta?.beatContract?.constraints || []).some((constraint) => (
    /(?:只能定性|不得.{0,40}(?:精确数字|数量|频率|报价))/u.test(constraint)
  ));
  const hasClosedFormalDocumentContract = (delta?.beatContract?.constraints || []).some((constraint) => (
    /(?:(?:文中|其中|回文中|奏报中|公文中|责任说明中)只(?:写|载)|正文只载)/u.test(constraint)
  ));
  if (hasClosedFormalDocumentContract) {
    return Math.min(base, 0.1);
  }
  if (hasSceneTransition && hasQuantitativeCeiling) {
    return Math.min(base, 0.25);
  }
  if ((delta?.beatContract?.requiredDurableAnchorGroups || []).length >= 4) {
    return Math.min(base, 0.25);
  }
  // OpenNovel can run every beat at 0.86 because it accepts most prose into
  // Canon and repairs later. Our evidence-bearing turns have a narrower hard
  // truth boundary: lower sampling only while a character is answering inside
  // that boundary, then return to the normal high-creativity Narrator profile.
  if (delta?.forbiddenKnowledge.length || delta?.evidenceSubjects.length) {
    return Math.min(base, 0.68);
  }
  if (hasQuantitativeCeiling) {
    return Math.min(base, 0.4);
  }
  if (hasSceneTransition) {
    return Math.min(base, 0.72);
  }
  if (delta?.requiredNarrativeFacts.length) return Math.min(base, 0.72);
  return base;
}

function hasAuthoredSceneTransition(delta: ReturnType<typeof buildCausalDelta>) {
  return (delta.beatContract?.moves || []).some((move) => (
    /(?:议事|场面|镜头).{0,12}(?:转到|移到|进入)|(?:转到|进入).{0,28}(?:府|县|厅|房|衙|仓|码头|市)/u.test(move)
  ));
}

function durablePolicy(
  worldId: string,
  authoredEvidenceSubjects: string[] = [],
  registeredObjectStates: Array<{
    label: string;
    contentsState?: string;
    closureState?: string;
  }> = [],
  incidentalTextureAllowances: Array<{
    textureClass: "CREATION_SUBSTRATE";
    lifecycle: "CONSUMED_INTO_TARGET";
    targetEntityKind: "DOCUMENT" | "OBJECT";
    targetEntityRef: string;
    targetEntityLabel: string;
  }> = [],
) {
  if (worldId !== "sangtian") return { protectedSubjects: [], forbidLatinWords: false };
  const evidenceSubjects = [...new Set(authoredEvidenceSubjects
    .map((value) => String(value || "").trim())
    .filter(Boolean))];
  return {
    forbidLatinWords: true,
    registeredObjectStates: registeredObjectStates.map((item) => ({
      subject: item.label,
      contentsState: item.contentsState,
      closureState: item.closureState,
    })),
    incidentalTextureAllowances,
    existingEvidenceSubjects: [
      "密信",
      "公文",
      "县册",
      "原册",
    ],
    allowedFormalArtifacts: [
      "公文",
      "回文",
      "奏报",
      "奏疏",
    ],
    knownFormalArtifacts: ["公文", "回文", "奏报", "奏疏"],
    durableClaimSubjects: [
      "改桑",
      "桑田",
      "改田",
      "田主",
      "户头",
      "田亩",
      "县册",
      "原册",
      "复核",
      "粮价",
      "米价",
      "期限",
      "公文",
      "回文",
    ],
    evidenceSubjects: [...new Set([
      ...evidenceSubjects,
      "密信",
      "公文",
      "县册",
      "原册",
      "册子",
      "册页",
      "田契",
      "仓单",
      "暗账",
    ])],
    trackedLocations: [
      "清流",
      "清流县",
      "清流县衙",
      "县衙",
      "档房",
      "总督府",
      "巡抚衙门",
      "杭州",
      "京师",
    ],
    protectedSubjects: [...new Set([
      ...evidenceSubjects,
      "粮价",
      "米价",
      "米行",
      "粮仓",
      "官仓",
      "田亩",
      "田地",
      "银两",
      "赋税",
      "县册",
      "原册",
      "册子",
      "册页",
      "原件",
      "田契",
      "仓单",
      "暗账",
      "密信",
      "经手人",
      "回文",
      "答复",
      "具报",
      "期限",
    ])],
    registeredObjects: registeredObjectStates.map((item) => ({
      subject: item.label,
      contentsState: item.contentsState,
      closureState: item.closureState,
    })),
    protagonistLabels: ["浙江总督", "总督", "制台"],
    secretClaims: ["巡抚就是幕后主使", "商会就是幕后主使"],
  };
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
