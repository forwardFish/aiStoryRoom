import { buildSoloNarratorPrompt } from "./narrator-prompt-builder";
import type { CompiledStoryContext } from "./types";

/**
 * Compatibility export for diagnostics that still import the former combined
 * prompt builder. The combined story/decision protocol no longer exists.
 */
export function buildSoloStoryTurnPrompt(context: CompiledStoryContext) {
  return buildSoloNarratorPrompt(context);
}
