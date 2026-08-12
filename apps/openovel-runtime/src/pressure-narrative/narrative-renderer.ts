import {
  validateNarrativeRenderCandidateV1,
  type NarrativeContextV1,
  type NarrativeProfileV1,
  type NarrativeRenderCandidateV1,
} from "./contracts.js";
import {
  PRESSURE_NARRATIVE_ERROR_CODES as ERROR,
  PressureNarrativeError,
  failPressureNarrative,
} from "./errors.js";
import type { NarrativeProviderPortV1, NarrativeRendererPortV1 } from "./ports.js";

export class NarrativeRendererV1 implements NarrativeRendererPortV1 {
  constructor(private readonly provider: NarrativeProviderPortV1) {}

  async render(
    context: NarrativeContextV1,
    profile: NarrativeProfileV1,
  ): Promise<NarrativeRenderCandidateV1> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const timeout = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new PressureNarrativeError(ERROR.PROVIDER_TIMEOUT, "provider.render")),
          profile.providerTimeoutMs,
        );
      });
      const value = await Promise.race([this.provider.render(structuredClone(context)), timeout]);
      return validateNarrativeRenderCandidateV1(value);
    } catch (error) {
      if (error instanceof PressureNarrativeError) throw error;
      return failPressureNarrative(ERROR.PROVIDER_FAILURE, "provider.render", safeErrorName(error));
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }
}

function safeErrorName(error: unknown): string {
  return error instanceof Error && error.name.trim() ? error.name : "UNKNOWN";
}
