import {
  activateContextCards,
  compileForegroundContext,
} from "./foreground.js";
import {
  renderConfirmedManeuverRuntimeContext,
  takeConfirmedManeuverRuntimeContext,
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
    const activatedCardSlugs = await activateContextCards(
      input.paths,
      input.action,
      input.snapshot.foregroundGuidance,
    );
    const snapshot = await input.refreshSnapshot();
    const compiled = await compileForegroundContext(input.paths, snapshot);
    const confirmed = takeConfirmedManeuverRuntimeContext(
      snapshot.metadata.runId,
      snapshot.metadata.turnNumber,
    );
    if (!confirmed) {
      return { activatedCardSlugs, snapshot, compiled };
    }
    const contextText = renderConfirmedManeuverRuntimeContext(confirmed);
    return {
      activatedCardSlugs,
      snapshot,
      compiled: {
        ...compiled,
        foregroundGuidance: appendSection(compiled.foregroundGuidance, contextText),
        durableMemory: appendSection(compiled.durableMemory, contextText),
        report: {
          ...compiled.report,
          usedChars: compiled.report.usedChars + contextText.length,
          budgets: {
            ...compiled.report.budgets,
            confirmedManeuverContext: contextText.length,
          },
        },
      },
    };
  }

  compileExisting(input: {
    paths: WorkspacePaths;
    snapshot: StorySnapshot;
  }) {
    return compileForegroundContext(input.paths, input.snapshot);
  }
}

function appendSection(current: string, addition: string) {
  return [String(current || "").trim(), addition.trim()].filter(Boolean).join("\n\n");
}
