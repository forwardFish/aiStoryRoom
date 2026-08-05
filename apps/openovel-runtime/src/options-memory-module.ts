import type {
  AuthoredDecisionAdapter,
  PreparedAuthoredDecision,
} from "./decision-adapter.js";
import { buildOptionsMessages } from "./foreground.js";
import { parseOptions } from "./options.js";
import type { FileStoryWorkspace } from "./workspace.js";
import type {
  CausalDelta,
  CompiledForegroundContext,
  OpenNovelOption,
  OpenNovelProvider,
  ProviderResult,
  RuntimeWarning,
  StorySnapshot,
  TurnEvent,
  TurnResult,
} from "./types.js";

export type OptionsAndMemoryInput = {
  runId: string;
  turnId: string;
  action: string;
  result: TurnResult;
  currentSnapshot: StorySnapshot;
  compiled: CompiledForegroundContext;
  publishedNarration: string;
  factNarration: string;
  narrativeOwner?: "COMPOSED" | "NARRATOR" | "FALLBACK" | "PROTECTED_RENDERER";
  shadowClaims: unknown[];
  selectedOption: OpenNovelOption | null;
  causalDelta: CausalDelta;
  preparedDecision: PreparedAuthoredDecision | null;
  authoredAdapter?: AuthoredDecisionAdapter;
  emit: (event: TurnEvent) => void;
};

export type OptionsAndMemoryOutput = {
  options: OpenNovelOption[];
  framing: string;
  tension: string;
  storyComplete: boolean;
  optionsProvider?: ProviderResult;
  warnings: RuntimeWarning[];
};

/** Post-Canon options and memory maintenance. Failures never invalidate Canon. */
export interface OptionsAndMemoryModule {
  readonly moduleId: string;
  afterCommit(input: OptionsAndMemoryInput): Promise<OptionsAndMemoryOutput>;
}

export class DefaultOptionsAndMemory implements OptionsAndMemoryModule {
  readonly moduleId = "openovel.options-and-memory.v1";

  constructor(
    private readonly workspace: FileStoryWorkspace,
    private readonly provider: OpenNovelProvider,
    private readonly storykeeper: { kick(runId: string): Promise<void> | void },
  ) {}

  async afterCommit(input: OptionsAndMemoryInput): Promise<OptionsAndMemoryOutput> {
    const warnings: RuntimeWarning[] = [];
    await this.enqueueMemory(input, warnings);
    const output = input.preparedDecision && input.authoredAdapter
      ? await this.authoredOptions(input, warnings)
      : await this.modelOptions(input, warnings);
    try {
      await this.workspace.publishTurnOptions(input.runId, {
        turnId: input.turnId,
        options: output.options,
        framing: output.framing,
        tension: output.tension,
        storyComplete: output.storyComplete,
        warnings: [...input.result.warnings, ...warnings],
        completedAt: new Date().toISOString(),
      });
      return { ...output, warnings };
    } catch (error) {
      const warning = runtimeWarning("OPTIONS_PERSIST_FAILED", error);
      warnings.push(warning);
      input.emit({ type: "runtime.warning", data: warning });
      input.emit({
        type: "options.complete",
        data: { options: [], framing: "", error: warning.message },
      });
      await this.workspace.publishTurnOptions(input.runId, {
        turnId: input.turnId,
        options: [],
        framing: "",
        tension: output.tension,
        storyComplete: false,
        warnings: [...input.result.warnings, ...warnings],
        completedAt: new Date().toISOString(),
      }).catch(() => {});
      return {
        options: [],
        framing: "",
        tension: output.tension,
        storyComplete: false,
        warnings,
      };
    }
  }

  private async enqueueMemory(
    input: OptionsAndMemoryInput,
    warnings: RuntimeWarning[],
  ) {
    try {
      await this.workspace.enqueueStorykeeper(input.runId, {
        id: `inbox_${input.turnId}_${Date.now()}`,
        turnId: input.turnId,
        narrativeOwner: input.narrativeOwner,
        action: input.action,
        narration: input.factNarration,
        publishedNarration: input.publishedNarration,
        shadowClaims: input.shadowClaims,
        recentCanonBefore: input.compiled.recentCanonExcerpt,
        selectedEffect: input.selectedOption?.effect || null,
        causalDelta: input.causalDelta,
        warnings: input.result.warnings,
        createdAt: input.result.committedAt,
      });
      Promise.resolve(this.storykeeper.kick(input.runId)).catch(() => {});
    } catch (error) {
      const warning = runtimeWarning("STORYKEEPER_ENQUEUE_DEFERRED", error);
      warnings.push(warning);
      input.emit({ type: "runtime.warning", data: warning });
    }
  }

  private async authoredOptions(
    input: OptionsAndMemoryInput,
    warnings: RuntimeWarning[],
  ): Promise<Omit<OptionsAndMemoryOutput, "warnings">> {
    let options: OpenNovelOption[] = [];
    let optionSource = "STORY_COMPLETE";
    if (!input.preparedDecision!.storyComplete) {
      try {
        const committedOptions = await input.authoredAdapter!.currentOptions(
          this.workspace,
          input.runId,
        );
        if (committedOptions?.length) {
          options = committedOptions;
          optionSource = "COMMITTED_WORLD_STATE";
        } else {
          options = input.result.options.length
            ? input.result.options
            : input.authoredAdapter!.nextOptions(input.preparedDecision!);
          optionSource = "PRECOMMIT_AFFORDANCE_FALLBACK";
          const warning = runtimeWarning(
            "AUTHORED_OPTIONS_COMMITTED_STATE_EMPTY",
            "Committed world state exposed no next Affordance",
          );
          warnings.push(warning);
          input.emit({ type: "runtime.warning", data: warning });
        }
      } catch (error) {
        options = input.result.options.length
          ? input.result.options
          : input.authoredAdapter!.nextOptions(input.preparedDecision!);
        optionSource = "PRECOMMIT_AFFORDANCE_FALLBACK";
        const warning = runtimeWarning(
          "AUTHORED_OPTIONS_COMMITTED_STATE_UNAVAILABLE",
          error,
        );
        warnings.push(warning);
        input.emit({ type: "runtime.warning", data: warning });
      }
    }
    input.emit({ type: "options.complete", data: { options, framing: "" } });
    await this.workspace.recordSceneEvent(input.runId, {
      type: "foreground_authored_options",
      turnId: input.turnId,
      optionSource,
      optionIds: options.map((option) => option.id),
    });
    return {
      options,
      framing: "",
      tension: "reader-directed",
      storyComplete: input.preparedDecision!.storyComplete,
    };
  }

  private async modelOptions(
    input: OptionsAndMemoryInput,
    warnings: RuntimeWarning[],
  ): Promise<Omit<OptionsAndMemoryOutput, "warnings">> {
    const request = buildOptionsRequest(
      input.action,
      input.publishedNarration,
      input.currentSnapshot,
      input.compiled,
    );
    let providerResult: ProviderResult | undefined;
    try {
      providerResult = await this.provider.generate(request);
      await this.workspace.recordModelCall(
        input.runId,
        input.turnId,
        "options",
        request,
        providerResult,
      ).catch(() => {});
      const parsed = parseOptions(
        providerResult.text,
        input.turnId,
        input.action,
        input.currentSnapshot.previousOptions,
        optionsKnownContext(input.compiled, input.publishedNarration),
      );
      input.emit({
        type: "options.complete",
        data: { options: parsed.options, framing: parsed.framing },
      });
      return {
        options: parsed.options,
        framing: parsed.framing,
        tension: parsed.tension,
        storyComplete: parsed.storyComplete,
        optionsProvider: providerResult,
      };
    } catch (error) {
      await this.workspace.recordModelCall(
        input.runId,
        input.turnId,
        "options",
        request,
        providerResult,
        error,
      ).catch(() => {});
      const warning = runtimeWarning("OPTIONS_UNAVAILABLE", error);
      warnings.push(warning);
      input.emit({ type: "runtime.warning", data: warning });
      input.emit({
        type: "options.complete",
        data: { options: [], framing: "", error: warning.message },
      });
      await this.workspace.recordSceneEvent(input.runId, {
        type: "shadow_warning",
        turnId: input.turnId,
        ...warning,
      }).catch(() => {});
      return {
        options: [],
        framing: "",
        tension: "reader-directed",
        storyComplete: false,
      };
    }
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
  snapshot: StorySnapshot,
  compiled: CompiledForegroundContext,
) {
  return {
    profile: "options" as const,
    messages: buildOptionsMessages(action, narration, snapshot, compiled),
    temperature: 0.55,
    maxTokens: 1_200,
    json: true,
    stream: true,
    timeoutMs: optionsTimeoutMs(),
  };
}

function optionsKnownContext(
  compiled: CompiledForegroundContext,
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

function runtimeWarning(code: string, error: unknown): RuntimeWarning {
  return {
    code,
    message: String((error as Error)?.message || error),
    severity: "LOW",
    blocksPlayer: false,
  };
}
