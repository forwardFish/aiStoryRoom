import {
  activateContextCards,
  compileForegroundContext,
} from "./foreground.js";
import {
  renderConfirmedManeuverRuntimeContext,
  takeConfirmedManeuverRuntimeContext,
  type RuntimeConfirmedManeuverContextV1,
} from "./confirmed-maneuver-context.js";
import type { WorkspacePaths } from "./paths.js";
import type { CompiledForegroundContext, StorySnapshot } from "./types.js";

export type CompiledTurnContext = {
  activatedCardSlugs: string[];
  snapshot: StorySnapshot;
  compiled: CompiledForegroundContext;
};

/** Context compilation owns selection, ordering and budgets, never plot choice. */
export interface ContextCompilerModule {
  readonly moduleId: string;
  compileTurn(input: {
    paths: WorkspacePaths;
    action: string;
    snapshot: StorySnapshot;
    refreshSnapshot: () => Promise<StorySnapshot>;
  }): Promise<CompiledTurnContext>;
  compileExisting(input: {
    paths: WorkspacePaths;
    snapshot: StorySnapshot;
  }): Promise<CompiledForegroundContext>;
}

export class DefaultContextCompiler implements ContextCompilerModule {
  readonly moduleId = "openovel.context-compiler.v1";

  async compileTurn(input: {
    paths: WorkspacePaths;
    action: string;
    snapshot: StorySnapshot;
    refreshSnapshot: () => Promise<StorySnapshot>;
  }): Promise<CompiledTurnContext> {
    // Consume the staged context before any awaited compilation step. If the
    // turn fails, the API will authenticate and stage it again on retry.
    const confirmed = takeConfirmedManeuverRuntimeContext(
      input.snapshot.metadata.runId,
      input.snapshot.metadata.turnNumber,
    );
    const activatedCardSlugs = await activateContextCards(
      input.paths,
      input.action,
      input.snapshot.foregroundGuidance,
    );
    const snapshot = await input.refreshSnapshot();
    const compiled = await compileForegroundContext(input.paths, snapshot);
    return {
      activatedCardSlugs,
      snapshot,
      compiled: mergeConfirmedManeuverContext(compiled, confirmed),
    };
  }

  compileExisting(input: {
    paths: WorkspacePaths;
    snapshot: StorySnapshot;
  }) {
    return compileForegroundContext(input.paths, input.snapshot);
  }
}

export function mergeConfirmedManeuverContext(
  compiled: CompiledForegroundContext,
  context: RuntimeConfirmedManeuverContextV1 | null,
): CompiledForegroundContext {
  if (!context) return compiled;
  const budget = Math.max(1_000, Number(compiled.report.budgets.durableMemory || 8_000));
  const full = renderConfirmedManeuverRuntimeContext(context);
  const rendered = full.slice(0, budget);
  const separator = compiled.durableMemory.trim() ? "\n\n" : "";
  const remaining = Math.max(0, budget - rendered.length - separator.length);
  const base = compiled.durableMemory.slice(0, remaining).trimEnd();
  const durableMemory = `${base}${base ? separator : ""}${rendered}`;
  return {
    ...compiled,
    durableMemory,
    report: {
      ...compiled.report,
      usedChars: compiled.report.usedChars - compiled.durableMemory.length + durableMemory.length,
      truncated: [
        ...compiled.report.truncated,
        ...(compiled.durableMemory.length > remaining ? ["durableMemory:confirmed-maneuver-reserve"] : []),
        ...(full.length > rendered.length ? ["confirmedManeuverContext"] : []),
      ],
    },
  };
}
