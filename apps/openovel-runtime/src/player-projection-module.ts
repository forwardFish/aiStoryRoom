import { buildNarratorMessages } from "./foreground.js";
import type { BeatManifest } from "./scene-expression.js";
import type {
  CausalDelta,
  CompiledForegroundContext,
  ModelMessage,
} from "./types.js";

export type PlayerProjectionInput = {
  causalDelta: CausalDelta;
  compiled: CompiledForegroundContext;
  beatManifest?: BeatManifest;
};

export type NarratorPlayerProjection = {
  messages: ModelMessage[];
};

/**
 * This is the sole boundary that converts server state into model-visible
 * player knowledge. NarrativeRenderer receives only the resulting messages.
 */
export interface PlayerProjectionModule {
  readonly moduleId: string;
  project(input: PlayerProjectionInput): NarratorPlayerProjection;
}

export class DefaultPlayerProjection implements PlayerProjectionModule {
  readonly moduleId = "openovel.single-player-projection.v1";

  project(input: PlayerProjectionInput): NarratorPlayerProjection {
    return {
      messages: buildNarratorMessages(
        input.causalDelta,
        input.compiled,
        input.beatManifest,
      ),
    };
  }
}
