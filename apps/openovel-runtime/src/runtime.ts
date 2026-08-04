import { createHash } from "node:crypto";

/*
 * Turn ordering and failure behavior are derived from Feed-Scription/openovel:
 * src/runtime/sessionProcessor.js and src/lib/narrator.js.
 * Licensed under Apache-2.0. Modified for Our Many Worlds on 2026-07-27.
 */
import {
  buildOptionsMessages,
  compileForegroundContext,
  previousNarrationOpening,
} from "./foreground.js";
import {
  buildCausalDelta,
} from "./causal-context.js";
import { parseOptions } from "./options.js";
import {
  DefaultOptionsAndMemory,
  type OptionsAndMemoryModule,
} from "./options-memory-module.js";import {
  validatePreparedAuthoredDecision,
  type AuthoredDecisionAdapter,
} from "./decision-adapter.js";
import { SceneExpressionPipeline, type ScenePipelineModules } from "./scene-pipeline.js";
import type { AtomicNarrativeEvidence } from "./atomic-turn.js";
import { DefaultActionGateway, type ActionGatewayModule } from "./action-gateway.js";
import {
  FileAtomicCommitter,
  type AtomicCommitterModule,
} from "./atomic-committer-module.js";import {
  DefaultContextCompiler,
  type ContextCompilerModule,
} from "./context-compiler-module.js";
import {
  DefaultPlayerProjection,
  type PlayerProjectionModule,
} from "./player-projection-module.js";import {
  ProviderNarrativeRenderer,
  type NarrativeRendererModule,
} from "./narrative-renderer.js";
import { DefaultSurfaceGuard, type SurfaceGuardModule } from "./surface-guard-module.js";
import {
  DefaultSceneRenderPlanner,
  DeterministicProtectedSceneRenderer,
  assertSingleSceneOwner,
  type ProtectedSceneRendererModule,
  type SceneRenderPlannerModule,
} from "./scene-render-plan.js";
import {
  executeTurnModule,
  TurnModuleRegistry,
  type TurnModuleDescriptor,
  type TurnModuleExecutionRecord,
} from "./turn-modules.js";import type { FileStoryWorkspace } from "./workspace.js";
import type {
  BoundOption,
  EventMirror,
  OpenNovelOption,
  OpenNovelProvider,
  ProviderResult,
  RuntimeWarning,
  TurnEvent,
  TurnResult,
} from "./types.js";
import { isRuntimeActionError } from "./runtime-errors.js";

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
      /** Replace or disable observation/review without changing Narrator or Settlement. */
      scenePipelineModules?: ScenePipelineModules;
      actionGateway?: ActionGatewayModule;
      atomicCommitter?: AtomicCommitterModule;
      contextCompiler?: ContextCompilerModule;
      playerProjection?: PlayerProjectionModule;
      narrativeRenderer?: NarrativeRendererModule;
      sceneRenderPlanner?: SceneRenderPlannerModule;
      protectedSceneRenderer?: ProtectedSceneRendererModule;
      optionsAndMemory?: OptionsAndMemoryModule;
      surfaceGuard?: SurfaceGuardModule;
    } = {},
  ) {
    this.describeTurnModules();
  }

  describeTurnModules(): TurnModuleDescriptor[] {
    const authored = this.authoredDecisionAdapter();
    return new TurnModuleRegistry([
      { kind: "ACTION_GATEWAY", moduleId: this.actionGateway().moduleId, mode: "REQUIRED" },
      { kind: "PLAYER_PROJECTION", moduleId: this.playerProjection().moduleId, mode: "REQUIRED" },
      { kind: "CONTEXT_COMPILER", moduleId: this.contextCompiler().moduleId, mode: "REQUIRED" },
      {
        kind: "FACT_SETTLEMENT",
        moduleId: authored?.moduleIds?.factSettlement || "legacy.causal-delta-settlement.v1",
        mode: "REQUIRED",
      },
      {
        kind: "NEXT_BEAT_PLANNER",
        moduleId: authored?.moduleIds?.nextBeatPlanner || "legacy.narrator-led-beat.v1",
        mode: "REQUIRED",
      },
      {
        kind: "SCENE_RENDER_PLANNER",
        moduleId: this.sceneRenderPlanner().moduleId,
        mode: "REQUIRED",
      },
      {
        kind: "PROTECTED_SCENE_RENDERER",
        moduleId: this.protectedSceneRenderer().moduleId,
        mode: "FALLBACK_ONLY",
        fallbackModuleId: this.protectedSceneRenderer().moduleId,
      },
      { kind: "NARRATIVE_RENDERER", moduleId: this.narrativeRenderer().moduleId, mode: "REQUIRED" },
      { kind: "SURFACE_GUARD", moduleId: this.surfaceGuard().moduleId, mode: "REQUIRED" },
      {
        kind: "TRUTH_OBSERVER",
        moduleId: "openovel.truth-observer.background-only.v1",
        mode: "DISABLED",
      },
      {
        kind: "REVIEW_POLICY",
        moduleId: "openovel.review-policy.background-only.v1",
        mode: "DISABLED",
      },
      { kind: "ATOMIC_COMMITTER", moduleId: this.atomicCommitter().moduleId, mode: "REQUIRED" },
      { kind: "OPTIONS_AND_MEMORY", moduleId: this.optionsAndMemory().moduleId, mode: "REQUIRED" },
    ]).list();
  }

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
    const rawAction = String(input.action || "");
    let action = rawAction.trim();
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
      const current = await this.workspace.metadata(input.runId);
      const turnId = `T${String(current.turnNumber + 1).padStart(2, "0")}`;
      const gateway = this.actionGateway();
      const validated = await executeTurnModule({
        runId: input.runId,
        turnId,
        descriptor: {
          kind: "ACTION_GATEWAY",
          moduleId: gateway.moduleId,
          mode: "REQUIRED",
        },
        value: {
          rawAction,
          expectedStateRevision: input.expectedStateRevision,
          currentStateRevision: current.turnNumber,
        },
        execute: () => gateway.validate({
          runId: input.runId,
          rawAction,
          expectedStateRevision: input.expectedStateRevision,
          currentStateRevision: current.turnNumber,
        }),
        onRecord: (record) => this.recordModuleExecution(input.runId, record),
      });
      action = validated.action;
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

      const compiled = await this.contextCompiler().compileExisting({
        paths: this.workspace.paths(runId),
        snapshot,
      });
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
    const atomicCommitter = this.atomicCommitter();
    const atomicRepository = authoredAdapter
      ? atomicCommitter.open(this.workspace.paths(input.runId))
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
    const resolvedOption = this.actionGateway().resolveBoundOption(
      input.boundOption || null,
      snapshot.previousOptions,
      input.action,
    );
    const preparedDecisionCandidate = authoredAdapter
      ? await authoredAdapter.prepare(this.workspace, {
          runId: input.runId,
          turnNumber,
          action: input.action,
          selectedOption: resolvedOption,
        })
      : null;
    const preparedDecision = preparedDecisionCandidate
      ? validatePreparedAuthoredDecision(preparedDecisionCandidate)
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
    const contextCompiler = this.contextCompiler();
    const compiledTurn = await executeTurnModule({
      runId: input.runId,
      turnId,
      descriptor: {
        kind: "CONTEXT_COMPILER",
        moduleId: contextCompiler.moduleId,
        mode: "REQUIRED",
      },
      value: {
        action: input.action,
        foregroundGuidance: snapshot.foregroundGuidance,
        stateRevision: snapshot.metadata.turnNumber,
      },
      execute: () => contextCompiler.compileTurn({
        paths,
        action: input.action,
        snapshot,
        refreshSnapshot: () => this.workspace.snapshot(input.runId),
      }),
      onRecord: (record) => this.recordModuleExecution(input.runId, record),
    });
    const currentSnapshot = compiledTurn.snapshot;
    const compiled = compiledTurn.compiled;
    const previousOpening = previousNarrationOpening(currentSnapshot);
    const sceneRenderPlanner = this.sceneRenderPlanner();
    const renderPlan = await executeTurnModule({
      runId: input.runId,
      turnId,
      descriptor: {
        kind: "SCENE_RENDER_PLANNER",
        moduleId: sceneRenderPlanner.moduleId,
        mode: "REQUIRED",
      },
      value: {
        preparedDecision: preparedDecision
          ? { sourceRef: preparedDecision.sourceRef, beatManifest: preparedDecision.beatManifest }
          : null,
      },
      execute: () => sceneRenderPlanner.plan({ turnId, preparedDecision }),
      onRecord: (record) => this.recordModuleExecution(input.runId, record),
    });
    const holdNarrationUntilValidated = Boolean(
      renderPlan.mode === "COMPOSED_SCENE"
      || causalDelta.forbiddenKnowledge.length > 0
      || causalDelta.beatContract?.sourceRef,
    );
    const projectionModule = this.playerProjection();
    const narratorProjection = await executeTurnModule({
      runId: input.runId,
      turnId,
      descriptor: {
        kind: "PLAYER_PROJECTION",
        moduleId: projectionModule.moduleId,
        mode: "REQUIRED",
      },
      value: {
        causalDelta,
        compiled,
        beatManifest: preparedDecision?.beatManifest || null,
      },
      execute: () => projectionModule.project({
        causalDelta,
        compiled,
        beatManifest: preparedDecision?.beatManifest,
      }),
      onRecord: (record) => this.recordModuleExecution(input.runId, record),
    });
    let narrator: ProviderResult;
    const modelLedger: unknown[] = [];
    let atomicNarrative: AtomicNarrativeEvidence;
    let contextNarration = "";
    let factNarration = "";
    let structuredShadowClaims: unknown[] = [];
    const reviewWarnings: RuntimeWarning[] = [];
    const surfaceGuard = this.surfaceGuard();

    {
      try {
        const renderer = this.narrativeRenderer();
        const rendererInput = {
          runId: input.runId,
          turnId,
          messages: narratorProjection.messages,
          previousOpening,
          onEvent: holdNarrationUntilValidated ? undefined : emit,
        };
        narrator = await executeTurnModule({
          runId: input.runId,
          turnId,
          descriptor: {
            kind: "NARRATIVE_RENDERER",
            moduleId: renderer.moduleId,
            mode: "REQUIRED",
          },
          value: {
            messages: narratorProjection.messages,
            previousOpening,
          },
          execute: () => renderer.render(rendererInput),
          telemetry: (result) => ({
            model: result.model,
            inputTokens: result.usage.inputTokens,
            outputTokens: result.usage.outputTokens,
          }),
          onRecord: (record) => this.recordModuleExecution(input.runId, record),
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
      modelLedger.push({
        stage: "narrator",
        model: narrator.model,
        requestId: narrator.requestId || null,
        usage: narrator.usage,
        latencyMs: narrator.latencyMs,
      });
      atomicNarrative = {
        originalText: narrator.text,
        narrativeOwner: "NARRATOR",
        renderPlan,
        contextText: narrator.text,
        factText: narrator.text,
        shadowClaims: [],
        disposition: { kind: "USE_ORIGINAL", draftId: turnId + ".draft.original" },
      };
      contextNarration = narrator.text;
      factNarration = narrator.text;
    }

    if (preparedDecision) {
      const originalText = narrator.text;
      const scene = await new SceneExpressionPipeline(
        this.provider,
        "ADVISORY",
      ).resolve({
        turnId,
        runId: input.runId,
        worldRevision: turnNumber,
        narratorRaw: narrator.text,
        manifest: preparedDecision.beatManifest,
        fallbackDraft: preparedDecision.fallbackDraft,
        truthContexts: preparedDecision.truthContexts,
        onModuleRecord: (record) => this.recordModuleExecution(input.runId, record),
      });
      for (const call of scene.calls) {
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
      narrator = { ...narrator, text: scene.finalText };
      const narrativeOwner = scene.disposition.kind === "USE_FALLBACK"
        ? "FALLBACK" as const
        : scene.draft.owner === "COMPOSED"
          ? "COMPOSED" as const
          : "NARRATOR" as const;
      assertSingleSceneOwner({ plan: renderPlan, actualOwner: narrativeOwner });
      contextNarration = scene.contextText;
      factNarration = scene.factText;
      structuredShadowClaims = scene.shadowClaims;
      atomicNarrative = {
        originalText,
        narrativeOwner,
        renderPlan,
        contextText: scene.contextText,
        factText: scene.factText,
        shadowClaims: scene.shadowClaims,
        disposition: scene.disposition,
        sceneDraft: scene.draft,
        sceneAudit: scene.audit,
        assemblyManifest: scene.assemblyManifest,
        fallbackReason: scene.fallbackReason,
      };
      reviewWarnings.push(...scene.shadowClaims.map((claim) => ({
        code: "TRUTH_REVIEW_SHADOW",
        message: claim.reason,
        severity: "LOW" as const,
        blocksPlayer: false,
        details: claim.exactQuote ? { exactQuote: claim.exactQuote } : undefined,
      })));
      await this.workspace.recordSceneEvent(input.runId, {
        type: "foreground_narrative_disposition",
        turnId,
        disposition: scene.disposition,
        sceneAudit: scene.audit,
        assemblyManifest: scene.assemblyManifest,
        fallbackReason: scene.fallbackReason || null,
        reviewObservation: scene.reviewObservation,
      }).catch(() => {});
    } else if (!preparedDecision) {
      const settledNarrative = String(
        causalDelta.beatContract?.settledNarrative || "",
      ).trim();
      if (settledNarrative) {
        narrator = {
          ...narrator,
          text: surfaceGuard.normalize(
            settledNarrative + "\n\n" + String(narrator.text || "").trim(),
          ),
        };
      }
    }
    const guardedSurface = await executeTurnModule({
      runId: input.runId,
      turnId,
      descriptor: {
        kind: "SURFACE_GUARD",
        moduleId: surfaceGuard.moduleId,
        mode: "REQUIRED",
      },
      value: { text: narrator.text, previousOpening },
      execute: () => surfaceGuard.inspect({ text: narrator.text, previousOpening }),
      onRecord: (record) => this.recordModuleExecution(input.runId, record),
    });
    narrator = { ...narrator, text: guardedSurface.text };
    contextNarration = surfaceGuard.normalize(contextNarration || narrator.text);
    factNarration = surfaceGuard.normalize(factNarration || contextNarration);
    const surface = guardedSurface.integrity;
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
    // Authored choices are a deterministic projection of the already-settled
    // next decision point. Compute them after the final narration is known but
    // before publishing the atomic Head, so Canon, state and choices recover
    // together after interruption.
    const atomicAuthoredOptions = preparedDecision && authoredAdapter && !preparedDecision.storyComplete
      ? authoredAdapter.nextOptions(preparedDecision)
      : [];
    const result: TurnResult = {
      runId: input.runId,
      turnId,
      turnNumber,
      narration: narrator.text,
      options: atomicAuthoredOptions,
      framing: "",
      tension: "reader-directed",
      storyComplete: preparedDecision?.storyComplete || false,
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
          contextNarration,
          shadowClaims: structuredShadowClaims,
        }),
        ...(projection.materializedViews || []),
      ];
      const commitInput = {
        runId: input.runId,
        submissionId,
        turnId,
        turnNumber,
        action: input.action,
        selectedOption,
        result,
        beatManifest: preparedDecision.beatManifest,
        narrative: atomicNarrative,
        projection,
        modelLedger,
        previousCanon: currentSnapshot.chapters,
        previousContextCanon: currentSnapshot.contextChapters,
      };
      await executeTurnModule({
        runId: input.runId,
        turnId,
        descriptor: {
          kind: "ATOMIC_COMMITTER",
          moduleId: atomicCommitter.moduleId,
          mode: "REQUIRED",
        },
        value: commitInput,
        execute: () => atomicCommitter.commitAuthored(atomicRepository!, commitInput),
        onRecord: (record) => this.recordModuleExecution(input.runId, record),
      });
      await this.workspace.recordSceneEvent(input.runId, {
        type: "foreground_authored_state_committed",
        turnId,
        ...preparedDecision.audit,
      });
    } else {
      await executeTurnModule({
        runId: input.runId,
        turnId,
        descriptor: {
          kind: "ATOMIC_COMMITTER",
          moduleId: atomicCommitter.moduleId,
          mode: "REQUIRED",
        },
        value: { action: input.action, result, selectedOption },
        execute: () => atomicCommitter.commitLegacy({
          workspace: this.workspace,
          runId: input.runId,
          turnId,
          action: input.action,
          result,
          selectedOption,
        }),
        onRecord: (record) => this.recordModuleExecution(input.runId, record),
      });
    }
    const optionsAndMemory = this.optionsAndMemory();
    const postCommit = await executeTurnModule({
      runId: input.runId,
      turnId,
      descriptor: {
        kind: "OPTIONS_AND_MEMORY",
        moduleId: optionsAndMemory.moduleId,
        mode: "REQUIRED",
      },
      value: {
        action: input.action,
        committedAt: result.committedAt,
        preparedDecision: preparedDecision
          ? { sourceRef: preparedDecision.sourceRef, storyComplete: preparedDecision.storyComplete }
          : null,
        publishedNarration: narrator.text,
        factNarration,
        shadowClaims: structuredShadowClaims,
      },
      execute: () => optionsAndMemory.afterCommit({
        runId: input.runId,
        turnId,
        action: input.action,
        result,
        currentSnapshot,
        compiled,
        publishedNarration: narrator.text,
        factNarration,
        shadowClaims: structuredShadowClaims,
        selectedOption,
        causalDelta,
        preparedDecision,
        authoredAdapter,
        emit,
      }),
      telemetry: (output) => ({
        model: output.optionsProvider?.model || null,
        inputTokens: output.optionsProvider?.usage.inputTokens || null,
        outputTokens: output.optionsProvider?.usage.outputTokens || null,
      }),
      onRecord: (record) => this.recordModuleExecution(input.runId, record),
    });
    result.options = postCommit.options;
    result.framing = postCommit.framing;
    result.tension = postCommit.tension;
    result.storyComplete = postCommit.storyComplete;
    result.optionsProvider = postCommit.optionsProvider;
    result.warnings.push(...postCommit.warnings);

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

  private atomicCommitter() {
    return this.runtimeOptions.atomicCommitter || new FileAtomicCommitter();
  }

  private actionGateway() {
    return this.runtimeOptions.actionGateway || new DefaultActionGateway();
  }

  private contextCompiler() {
    return this.runtimeOptions.contextCompiler || new DefaultContextCompiler();
  }

  private playerProjection() {
    return this.runtimeOptions.playerProjection || new DefaultPlayerProjection();
  }

  private optionsAndMemory() {
    return this.runtimeOptions.optionsAndMemory
      || new DefaultOptionsAndMemory(this.workspace, this.provider, this.storykeeper);
  }

  private narrativeRenderer() {
    return this.runtimeOptions.narrativeRenderer
      || new ProviderNarrativeRenderer(this.provider, this.workspace);
  }

  private sceneRenderPlanner() {
    return this.runtimeOptions.sceneRenderPlanner || new DefaultSceneRenderPlanner();
  }

  private protectedSceneRenderer() {
    return this.runtimeOptions.protectedSceneRenderer
      || new DeterministicProtectedSceneRenderer();
  }

  private surfaceGuard() {
    return this.runtimeOptions.surfaceGuard || new DefaultSurfaceGuard();
  }

  private async recordModuleExecution(
    runId: string,
    record: TurnModuleExecutionRecord,
  ) {
    await this.workspace.recordSceneEvent(runId, {
      type: "turn_module_execution",
      ...record,
    }).catch(() => {});
  }
}

function optionsTimeoutMs() {
  const configured = Number(process.env.OPENOVEL_OPTIONS_TIMEOUT_MS || 120_000);
  if (!Number.isFinite(configured)) return 120_000;
  return Math.min(180_000, Math.max(5_000, Math.trunc(configured)));
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
