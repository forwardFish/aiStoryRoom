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
  ModelMessage,
  OpenNovelOption,
  OpenNovelProvider,
  ProviderResult,
  RuntimeWarning,
  TurnEvent,
  TurnResult,
} from "./types.js";
import { actionRejected, isRuntimeActionError } from "./runtime-errors.js";
import { BasicEndingModule, type EndingModule } from "./ending-module.js";
import type { WorldModuleRegistry } from "./world-module-registry.js";

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
      endingModule?: EndingModule;
      worldModules?: WorldModuleRegistry;
    } = {},
  ) {
    this.describeTurnModules();
  }

  describeTurnModules(worldId?: string): TurnModuleDescriptor[] {
    const authored = this.authoredDecisionAdapter(worldId);
    const sceneReview = this.runtimeOptions.scenePipelineModules;
    return new TurnModuleRegistry([
      { kind: "ACTION_GATEWAY", moduleId: this.actionGateway().moduleId, mode: "REQUIRED" },
      { kind: "PLAYER_PROJECTION", moduleId: this.playerProjection().moduleId, mode: "REQUIRED" },
      { kind: "CONTEXT_COMPILER", moduleId: this.contextCompiler().moduleId, mode: "REQUIRED" },
      {
        kind: "FACT_SETTLEMENT",
        moduleId: authored?.moduleIds?.factSettlement
          || (this.runtimeOptions.worldModules
            ? "openovel.world-module-registry.fact-settlement.v1"
            : "legacy.causal-delta-settlement.v1"),
        mode: "REQUIRED",
      },
      {
        kind: "NEXT_BEAT_PLANNER",
        moduleId: authored?.moduleIds?.nextBeatPlanner
          || (this.runtimeOptions.worldModules
            ? "openovel.world-module-registry.next-beat.v1"
            : "legacy.narrator-led-beat.v1"),
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
        moduleId: sceneReview?.observer.moduleId || "openovel.truth-observer.disabled.v1",
        mode: sceneReview ? "OPTIONAL" : "DISABLED",
      },
      {
        kind: "REVIEW_POLICY",
        moduleId: sceneReview?.policy.moduleId || "openovel.review-policy.disabled.v1",
        mode: sceneReview ? "OPTIONAL" : "DISABLED",
      },
      { kind: "ENDING", moduleId: this.endingModule(worldId).moduleId, mode: "REQUIRED" },
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
      if (current.status === "COMPLETED") {
        const completedSubmissionId = normalizeSubmissionId(input.submissionId);
        const completedAuthoredAdapter = this.authoredDecisionAdapter(current.worldId);
        if (completedSubmissionId && completedAuthoredAdapter) {
          const completedRepository = this.atomicCommitter().open(
            this.workspace.paths(input.runId),
          );
          await completedRepository.restoreMaterializedViews();
          const replayed = await completedRepository.resultBySubmission(
            completedSubmissionId,
            action,
          );
          if (replayed) {
            const currentOptions = await completedAuthoredAdapter.currentOptions(
              this.workspace,
              input.runId,
            );
            return {
              ...replayed,
              options: currentOptions || replayed.options,
            };
          }
        }
        throw actionRejected("RUN_COMPLETED");
      }
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
        const currentStatus = await this.workspace.metadata(input.runId)
          .then((metadata) => metadata.status)
          .catch(() => "READY" as const);
        await this.workspace.updateMetadata(input.runId, {
          status: currentStatus === "COMPLETED" ? "COMPLETED" : "READY",
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

  private authoredDecisionAdapter(worldId?: string) {
    if (this.runtimeOptions.decisionMode !== "AUTHORED_WHEN_AVAILABLE") {
      return undefined;
    }
    if (worldId && this.runtimeOptions.worldModules) {
      return this.runtimeOptions.worldModules.require(worldId).decisionAdapter;
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
      if (snapshot.metadata.status === "COMPLETED") {
        throw actionRejected("RUN_COMPLETED");
      }
      if (snapshot.previousOptions.length) throw new Error("OPTIONS_ALREADY_AVAILABLE");
      const committed = await this.workspace.latestCommittedForegroundTurn(runId);
      if (!committed) throw new Error("NO_COMMITTED_TURN_FOR_OPTIONS");
      const expectedTurnId = `T${String(snapshot.metadata.turnNumber).padStart(2, "0")}`;
      if (committed.turnId !== expectedTurnId) throw new Error("LATEST_TURN_MISMATCH");
      const authoredAdapter = this.authoredDecisionAdapter(snapshot.metadata.worldId);
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
    const snapshot = await this.workspace.snapshot(input.runId);
    const authoredAdapter = this.authoredDecisionAdapter(snapshot.metadata.worldId);
    const atomicCommitter = this.atomicCommitter();
    const atomicRepository = authoredAdapter
      ? atomicCommitter.open(this.workspace.paths(input.runId))
      : null;
    if (atomicRepository) await atomicRepository.restoreMaterializedViews();
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
    const narratorMessages = endingAwareNarratorMessages(
      narratorProjection.messages,
      preparedDecision?.storyComplete === true,
    );
    let narrator: ProviderResult;
    const modelLedger: unknown[] = [];
    let atomicNarrative: AtomicNarrativeEvidence;
    let contextNarration = "";
    let factNarration = "";
    let structuredShadowClaims: unknown[] = [];
    const reviewWarnings: RuntimeWarning[] = [];
    const surfaceGuard = this.surfaceGuard();
      try {
        const renderer = this.narrativeRenderer();
        const rendererInput = {
          runId: input.runId,
          turnId,
          messages: narratorMessages,
          previousOpening,
          // Provider streaming stays inside the runtime until the atomic Head
          // owns both the prose and the settled state. A player must never see
          // a draft that recovery would later discard.
          onEvent: undefined,
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
            messages: narratorMessages,
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

    if (preparedDecision) {
      const originalText = narrator.text;
      const scene = await new SceneExpressionPipeline(
        this.provider,
        this.runtimeOptions.scenePipelineModules || "ADVISORY",
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
      const renderProtectedScene = () => executeTurnModule({
        runId: input.runId,
        turnId,
        descriptor: {
          kind: "PROTECTED_SCENE_RENDERER" as const,
          moduleId: this.protectedSceneRenderer().moduleId,
          mode: "FALLBACK_ONLY" as const,
          fallbackModuleId: this.protectedSceneRenderer().moduleId,
        },
        value: {
          renderPlan,
          sourceRef: preparedDecision.sourceRef,
        },
        execute: () => this.protectedSceneRenderer().render({
          plan: renderPlan,
          preparedDecision,
        }),
        onRecord: (record) => this.recordModuleExecution(input.runId, record),
      });
      let protectedScene = scene.disposition.kind === "USE_FALLBACK"
        && renderPlan.mode === "COMPOSED_SCENE"
        ? await renderProtectedScene()
        : null;
      const finalText = protectedScene?.text || scene.finalText;
      const finalContextText = protectedScene?.contextText || scene.contextText;
      const finalFactText = protectedScene?.factText || scene.factText;
      const finalDraft = protectedScene?.draft || scene.draft;
      const finalAudit = protectedScene?.audit || scene.audit;
      const finalAssemblyManifest = protectedScene?.assemblyManifest || scene.assemblyManifest;
      narrator = protectedScene
        ? { ...protectedScene.providerResult, text: finalText }
        : { ...narrator, text: finalText };
      const narrativeOwner = protectedScene
        ? "PROTECTED_RENDERER" as const
        : scene.disposition.kind === "USE_FALLBACK"
          ? "FALLBACK" as const
          : scene.draft.owner === "COMPOSED"
            ? "COMPOSED" as const
            : "NARRATOR" as const;
      assertSingleSceneOwner({ plan: renderPlan, actualOwner: narrativeOwner });
      contextNarration = finalContextText;
      factNarration = finalFactText;
      structuredShadowClaims = protectedScene ? [] : scene.shadowClaims;
      reviewWarnings.push(...scene.reviewObservation.nonCriticalFindings.map((finding) => ({
        code: "TRUTH_REVIEW_ADVISORY",
        message: finding,
        severity: "LOW" as const,
        blocksPlayer: false,
      })));
      atomicNarrative = {
        originalText,
        narrativeOwner,
        renderPlan,
        contextText: finalContextText,
        factText: finalFactText,
        shadowClaims: structuredShadowClaims,
        disposition: scene.disposition,
        sceneDraft: finalDraft,
        sceneAudit: finalAudit,
        assemblyManifest: finalAssemblyManifest,
        fallbackReason: scene.fallbackReason,
      };
      reviewWarnings.push(...structuredShadowClaims.map((claim: any) => ({
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
        narrativeOwner,
        protectedRendererModuleId: protectedScene ? this.protectedSceneRenderer().moduleId : null,
        sceneAudit: finalAudit,
        assemblyManifest: finalAssemblyManifest,
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
    let guardedSurface = await executeTurnModule({
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
    if (!guardedSurface.integrity.ok
      && preparedDecision
      && renderPlan.mode === "COMPOSED_SCENE") {
      const protectedScene = await executeTurnModule({
        runId: input.runId,
        turnId,
        descriptor: {
          kind: "PROTECTED_SCENE_RENDERER",
          moduleId: this.protectedSceneRenderer().moduleId,
          mode: "FALLBACK_ONLY",
          fallbackModuleId: this.protectedSceneRenderer().moduleId,
        },
        value: {
          renderPlan,
          sourceRef: preparedDecision.sourceRef,
          fallbackReason: guardedSurface.integrity.reason || "SURFACE_GUARD_REJECTED",
        },
        execute: () => this.protectedSceneRenderer().render({
          plan: renderPlan,
          preparedDecision,
        }),
        onRecord: (record) => this.recordModuleExecution(input.runId, record),
      });
      narrator = { ...protectedScene.providerResult, text: protectedScene.text };
      contextNarration = protectedScene.contextText;
      factNarration = protectedScene.factText;
      structuredShadowClaims = [];
      atomicNarrative = {
        ...atomicNarrative,
        narrativeOwner: "PROTECTED_RENDERER",
        contextText: protectedScene.contextText,
        factText: protectedScene.factText,
        shadowClaims: [],
        disposition: {
          kind: "USE_FALLBACK",
          fallbackId: protectedScene.draft.draftId,
          reason: guardedSurface.integrity.reason || "SURFACE_GUARD_REJECTED",
        },
        sceneDraft: protectedScene.draft,
        sceneAudit: protectedScene.audit,
        assemblyManifest: protectedScene.assemblyManifest,
        fallbackReason: guardedSurface.integrity.reason || "SURFACE_GUARD_REJECTED",
      };
      guardedSurface = await executeTurnModule({
        runId: input.runId,
        turnId,
        descriptor: {
          kind: "SURFACE_GUARD",
          moduleId: surfaceGuard.moduleId,
          mode: "REQUIRED",
        },
        value: { text: protectedScene.text, previousOpening, fallback: true },
        execute: () => surfaceGuard.inspect({ text: protectedScene.text, previousOpening }),
        onRecord: (record) => this.recordModuleExecution(input.runId, record),
      });
      await this.workspace.recordSceneEvent(input.runId, {
        type: "foreground_surface_fallback",
        turnId,
        reason: atomicNarrative.fallbackReason,
        protectedRendererModuleId: this.protectedSceneRenderer().moduleId,
      }).catch(() => {});
    }
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
    const ending = preparedDecision?.storyComplete
      ? await executeTurnModule({
          runId: input.runId,
          turnId,
          descriptor: {
            kind: "ENDING",
            moduleId: this.endingModule(currentSnapshot.metadata.worldId).moduleId,
            mode: "REQUIRED",
          },
          value: {
            turnNumber,
            finalNarration: narrator.text,
            sourceRef: preparedDecision.sourceRef,
          },
          execute: () => this.endingModule(currentSnapshot.metadata.worldId).build({
            runId: input.runId,
            turnId,
            turnNumber,
            finalNarration: narrator.text,
            preparedDecision,
          }),
          onRecord: (record) => this.recordModuleExecution(input.runId, record),
        })
      : undefined;
    const result: TurnResult = {
      runId: input.runId,
      turnId,
      turnNumber,
      narration: narrator.text,
      options: atomicAuthoredOptions,
      framing: "",
      tension: "reader-directed",
      storyComplete: preparedDecision?.storyComplete || false,
      ...(ending ? { ending } : {}),
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
        narrativeOwner: atomicNarrative.narrativeOwner,
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
        narrativeOwner: atomicNarrative.narrativeOwner,
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
    // Player-visible prose is commit-gated. The provider may stream internally,
    // but only text referenced by the successful atomic Head is published.
    emit({ type: "narration.delta", data: { text: narrator.text } });
    emit({
      type: "narration.complete",
      data: { narration: narrator.text },
    });
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

  private endingModule(worldId?: string) {
    if (worldId && this.runtimeOptions.worldModules) {
      return this.runtimeOptions.worldModules.require(worldId).endingModule
        || this.runtimeOptions.endingModule
        || new BasicEndingModule();
    }
    return this.runtimeOptions.endingModule || new BasicEndingModule();
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

export function endingAwareNarratorMessages(
  messages: ModelMessage[],
  storyComplete: boolean,
): ModelMessage[] {
  if (!storyComplete) return messages;
  return [
    ...messages,
    {
      role: "system",
      content: [
        "这是本部分最后一回，请把正文写成小说终章，而不是结算报告、任务清单或说明文字。",
        "只使用本轮已经提供并由服务器结算的事实，不新增人物、命令、数字、转折或未来事件。",
        "正文自然完成三件事：收住最后现场；让读者感到玩家最终保住了什么并付出了什么；以一个仍未解决的局势或具体画面收尾。",
        "若结果有利，庆祝要克制；若代价沉重，悲伤要克制；得失并存时保持悲欣交集的余韵。",
        "不要输出标题、指标、选项或按钮文案，只输出可直接放进游戏中央阅读区的终章正文。",
      ].join(" "),
    },
  ];
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
